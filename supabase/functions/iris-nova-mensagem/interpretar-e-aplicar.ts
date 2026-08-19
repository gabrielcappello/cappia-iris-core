import { aplicarDados, buscarEstadoConversa, validarContexto } from './aplicar-dados.ts';
import { EntradaInvalidaError } from './erros.ts';
import {
  construirEntradaMinimizada,
  extrairAlteracoes,
  validarMensagensAtuais,
  validarSnapshotOficial,
} from './interpretacao-extrator.ts';
import { CAMPOS_CADASTRAIS_INTERPRETACAO } from './interpretacao-tipos.ts';
import { preAplicar } from './pre-aplicacao.ts';
import { normalizarCampoCadastral } from './validar-cadastro.ts';
import { descartarNomeDeEscolhaDeDentista } from './guarda-nome-escolha-dentista.ts';
import { descartarListaVaziaSemMencao } from './guarda-lista-vazia-dentistas.ts';
import { aplicarDentistaDoTratamento } from './dentista-do-tratamento.ts';
import { aplicarProcedimentoDoAnuncio } from './procedimento-do-anuncio.ts';
import type { TratamentoNoPayload } from './dentista-do-tratamento.ts';
import type {
  AlteracoesDados,
  CadastroPaciente,
  ClienteBancoDados,
  ContextoConversa,
  ParConversa,
  ResultadoAplicarDados,
} from './tipos.ts';
import type {
  CampoCadastralInterpretacao,
  ClienteModeloEstruturado,
  Conflito,
  EventoCandidatoIA,
  NaturezaMensagem,
  RespostaTrocaTelefone,
  ResultadoInterpretacao,
  SnapshotOficialConversa,
} from './interpretacao-tipos.ts';

export interface InterpretarEAplicarInput extends ContextoConversa {
  mensagens_atuais: string[];
  /**
   * Tratamentos que o dentista planejou e a assistente anunciou. Repassados
   * a IA como contexto E lidos pelo Core, que aplica o `dentista_id`
   * definido no painel (dentista-do-tratamento.ts, 2026-08-19).
   */
  tratamentos_pendentes?: readonly TratamentoNoPayload[];
  /**
   * Horarios ja apresentados ao paciente na ultima pergunta gerada
   * (contexto-horarios.ts). Repassado a IA como contexto de interpretacao;
   * nunca influencia persistencia, disponibilidade ou reserva.
   */
  horarios_oferecidos?: string[];
  /**
   * Proposta concreta (data + horario) que o Core apresentou ao paciente na
   * ultima pergunta gerada, aguardando confirmacao (contexto-horarios.ts,
   * acao `propor`). Repassado a IA para a regra de confirmacao por
   * significado (specs/resposta-conversacional-v1.md secao 5); nunca
   * influencia persistencia, disponibilidade ou reserva.
   */
  proposta_pendente?: { data: string; horario: string };
  /**
   * Ultimos turnos da conversa (contexto-horarios.ts padrao, historico-
   * conversa.ts), ja filtrados por validade. Repassado a IA como contexto de
   * interpretacao (specs/historico-conversacional-v1.md secao 6); nunca
   * influencia persistencia, disponibilidade ou reserva.
   */
  historico_recente?: ParConversa[];
  /**
   * Catalogo ativo minimo da clinica (specs/procedimento-semantico-v1.md).
   * Repassado a IA para que ela resolva o pedido do paciente diretamente
   * para `procedimento_id`; nunca influencia persistencia, disponibilidade
   * ou reserva -- a integridade do ID e conferida depois pelo Core.
   */
  procedimentos_disponiveis?: { procedimento_id: string; nome_pt: string }[];
  /**
   * Dentistas ativos da clinica (specs/dentista-semantico-v1.md). Mesmo
   * papel do catalogo acima, para `dentista_id`. Nao filtrada por aptidao:
   * o vinculo e conferido depois pelo Core, contra o procedimento resolvido.
   */
  dentistas_disponiveis?: { dentista_id: string; nome_exibido: string }[];
  /**
   * Oferta de procedimento feita no turno anterior, aguardando resposta
   * (specs/contexto-pendente-interpretacao-v1.md secao 11). Contexto de
   * interpretacao; nunca influencia persistencia, disponibilidade ou reserva
   * -- o procedimento aceito passa pela validacao de integridade de sempre.
   */
  oferta_procedimento_pendente?: { procedimento_id: string };
  /**
   * Pergunta de troca de telefone feita no turno anterior, aguardando sim/nao
   * (specs/cpf-outro-telefone-v1.md secao 1). Contexto de interpretacao E
   * gate de autorizacao: sem ele, um evento `aceitar_troca_telefone` que
   * chegue mesmo assim e ignorado, e uma `natureza_mensagem` de negacao nao e
   * lida como recusa -- `resposta_troca_telefone` sai `null` nos dois casos.
   */
  troca_telefone_pendente?: true;
  /**
   * Agendamentos ativos do paciente, quando ha uma escolha de remarcacao
   * pendente (specs/remarcacao-conversacional-v1.md secao 3). Contexto de
   * interpretacao E lista de integridade: `validarEscolhaAgendamento`, mais
   * abaixo, so aceita um `agendamento_id` emitido pela IA se ele estiver
   * dentro desta mesma lista -- fora dela, o campo e descartado, nunca
   * aceito.
   */
  agendamentos_ativos?: { agendamento_id: string; descricao: string }[];
  /**
   * Agendamentos que o paciente JA TEM -- puro CONTEXTO (2026-08-17).
   *
   * Diferente de `agendamentos_ativos`: aquele significa "ha uma escolha
   * pendente entre estes, responda qual" (contrato fechado por medicao
   * 2026-08-11); este apenas informa o que existe, sem pergunta em aberto.
   *
   * Existe porque a interpretadora trabalhava sem saber que o paciente tinha
   * consulta marcada -- e por isso nao resolvia "o mesmo dentista da
   * avaliacao", "mesma data", nem reconhecia "pode trocar para 10hrs" como
   * remarcacao. Tres conversas reais quebraram por isso no mesmo dia; numa
   * delas o Core repetiu a mesma pergunta sete vezes.
   */
  agendamentos_do_paciente?: {
    agendamento_id: string;
    descricao: string;
    dentista_id?: string;
    procedimento_id?: string;
    data: string;
    horario: string;
  }[];
  /**
   * Cadastro JA PERSISTIDO do paciente (identificacao.ts). SEGUNDA ORIGEM de
   * dado cadastral, ao lado do snapshot da conversa.
   *
   * Entra APENAS na derivacao de `campos_cadastrais_preenchidos` -- presenca,
   * nunca valor. Nenhum valor daqui atravessa a fronteira do modelo
   * (specs/interpretacao-ia.md, "Entrada e PII").
   *
   * NAO e copiado para `estado_conversa.dados`: a composicao acontece em
   * memoria, e o que o paciente disse nesta conversa prevalece sobre a ficha
   * (comporVisaoEfetivaCadastro, em cadastro-paciente.ts).
   */
  cadastro_paciente?: CadastroPaciente;
  /**
   * Data de hoje (YYYY-MM-DD) do `instante_atual` ja injetado no orquestrador.
   * Usada SOMENTE para recusar data de nascimento futura -- este modulo, como
   * resolverTemporal e resolverDisponibilidade, nunca chama Date.now().
   * Ausente, a checagem de futuro e pulada; as demais continuam valendo.
   */
  data_referencia?: string;
}

/**
 * Traduz o candidato `aceitar_opcao` em uma alteracao concreta de
 * `procedimento_id` -- deterministicamente, no Core.
 *
 * Regras, todas obrigatorias:
 *
 * - exige o evento E a oferta oficial. Falta qualquer um, nada acontece;
 * - o id aplicado vem do snapshot oficial do Core, nunca do evento;
 * - a ACAO e decidida aqui, nao pela IA: `corrigir` quando ja existe outro
 *   procedimento em `dados_atuais`, `informar` quando nao existe. Isso
 *   elimina uma falha real medida em 2026-08-09 -- quando a IA escolhia a
 *   acao, um `informar` sobre campo ja preenchido virava conflito em
 *   `preAplicar` e a aceitacao era descartada em silencio;
 * - se o paciente ja pediu explicitamente outro procedimento NESTA mensagem,
 *   o pedido explicito vence: a oferta nao sobrescreve o que ele acabou de
 *   dizer.
 *
 * `referencia_textual` do evento e deliberadamente ignorada aqui: existe uma
 * unica oferta por vez, entao nao ha o que desambiguar. Ela permanece no
 * contrato para quando `aceitar_opcao` cobrir escolha de horario.
 */
function aplicarAceitacaoDeOferta(
  alteracoes: AlteracoesDados,
  eventos: readonly EventoCandidatoIA[],
  naturezaMensagem: NaturezaMensagem,
  ofertaPendente: { procedimento_id: string } | undefined,
  snapshotOficial: SnapshotOficialConversa
): AlteracoesDados {
  const aceitou = eventos.some((e) => e.tipo === 'aceitar_opcao');
  if (!aceitou || ofertaPendente === undefined) return alteracoes;

  // SINAIS INCOMPATIVEIS (eventos-conversacionais-v1.md secao 7: "candidatos
  // logicamente incompativeis na mesma mensagem nunca autorizam acao").
  // `negacao` e aceitacao no mesmo turno se contradizem -- o Core nao escolhe
  // qual acreditar, simplesmente nao aplica.
  //
  // Nao e regra de linguagem: e coerencia entre dois sinais que a propria IA
  // produziu. Medido em 2026-08-09: "prefiro outra coisa" vinha com
  // `natureza=negacao` E `aceitar_opcao`, e sem esta checagem o paciente
  // recusava e acabava com a oferta aplicada.
  if (naturezaMensagem === 'negacao') return alteracoes;

  // Pedido explicito na mesma mensagem tem precedencia sobre a oferta.
  if (alteracoes.procedimento_id !== undefined) return alteracoes;

  const jaTemOutro =
    typeof snapshotOficial.procedimento_id === 'string' &&
    snapshotOficial.procedimento_id.trim() !== '' &&
    snapshotOficial.procedimento_id !== ofertaPendente.procedimento_id;

  return {
    ...alteracoes,
    procedimento_id: { acao: jaTemOutro ? 'corrigir' : 'informar', valor: ofertaPendente.procedimento_id },
  };
}

/**
 * DERIVA a resposta do paciente a pergunta de troca de telefone
 * (specs/cpf-outro-telefone-v1.md secao 2). A IA nunca emite `sim`/`nao`: ela
 * emite (ou nao) o evento de aceite, e classifica a mensagem em
 * `natureza_mensagem`. Este e o unico lugar que combina os dois sinais.
 *
 * EXIGE OS DOIS LADOS, exatamente como `aplicarAceitacaoDeOferta`: o sinal da
 * IA E a pergunta pendente do proprio Core. Sem o marcador oficial, nada e
 * interpretado -- a IA nao tem como fazer o Core trocar telefone nenhum por
 * conta propria, ainda que emita o evento indevidamente. Medido: o evento
 * VAZA mesmo sem marcador (3/3 contratos testados em 2026-08-10), entao este
 * gate nao e teorico.
 *
 * POR QUE A RECUSA NAO TEM EVENTO PROPRIO: toda a instrucao ensina que recusa
 * e a AUSENCIA do evento -- e assim que `aceitar_opcao` funciona. Um
 * `recusar_troca_telefone` foi medido contra a IA real e emitido em ZERO
 * casos. `natureza_mensagem === 'negacao'` acertou 14/15 nas mesmas medicoes,
 * com ZERO aceites por engano. Nao e regra de linguagem no Core: e a
 * classificacao que a propria IA ja produz em todo turno, combinada com o
 * evento -- mesma tecnica ja usada em `aplicarAceitacaoDeOferta` para sinais
 * incompativeis.
 *
 * SINAIS INCOMPATIVEIS -- A NEGACAO VENCE O EVENTO, e a ordem abaixo e o
 * mecanismo. Medido contra a IA real em 2026-08-10: "nao, deixa como esta"
 * chegou com `natureza=negacao` E `aceitar_troca_telefone` no mesmo turno.
 * Checando o evento primeiro, uma RECUSA EXPLICITA virava troca de telefone
 * -- o unico desfecho inaceitavel desta spec. Nao e regra nova: e exatamente
 * a mesma disciplina de `aplicarAceitacaoDeOferta` logo acima ("o Core nao
 * escolhe qual acreditar"), aplicada de forma consistente. Aqui ela vai alem
 * de nao-aplicar: com a pergunta pendente, `negacao` E a recusa, entao o
 * desfecho e `nao`, que tambem nao escreve nada.
 *
 * UMA DUVIDA TAMBEM NAO AUTORIZA -- mesmo mecanismo, mesma disciplina.
 * Medido em 2026-08-10, ~1 em 5 execucoes: "por que voces precisam disso?"
 * chegou com `natureza=duvida` E `aceitar_troca_telefone` no mesmo turno.
 * Uma PERGUNTA e logicamente incompativel com um aceite, exatamente como uma
 * negacao -- e aqui nao havia guarda, entao o telefone seria trocado sem a
 * confirmacao explicita que `persistencia-v1.md` secao 6 exige.
 *
 * Diferente da negacao, uma duvida NAO e recusa: o desfecho e `null`, e a
 * Iris repete a pergunta. Nunca `nao`, que encerraria o agendamento de quem
 * so queria entender o motivo.
 *
 * FALHA SEGURA nos dois lados: recusa que a IA nao classificou como `negacao`
 * e que tambem nao trouxe o evento (medido 1/15) devolve `null` -- a Iris
 * apenas repete a pergunta. Nunca troca telefone por engano.
 *
 * Nunca escreve nada em `dados`: a resposta e transitoria, consumida no mesmo
 * processamento. Um `sim` persistido autorizaria, sozinho, uma troca num
 * turno futuro em que ninguem perguntou nada.
 */
function lerRespostaTrocaTelefone(
  eventos: readonly EventoCandidatoIA[],
  naturezaMensagem: NaturezaMensagem,
  trocaTelefonePendente: true | undefined
): RespostaTrocaTelefone | null {
  if (trocaTelefonePendente === undefined) return null;
  if (naturezaMensagem === 'negacao') return 'nao';
  if (naturezaMensagem === 'duvida') return null;
  return eventos.some((e) => e.tipo === 'aceitar_troca_telefone') ? 'sim' : null;
}

/**
 * Persiste `dentista_id` quando -- e somente quando -- a IA identificou
 * exatamente UM candidato (specs/dentista-semantico-v1.md secao 12).
 *
 * `null` (nao mencionou), `[]` (mencionou e nenhum corresponde) e varios
 * candidatos NAO escrevem nada: os dois ultimos viram pergunta ao paciente,
 * no orquestrador. Escrever qualquer coisa neles seria escolher por ele.
 *
 * A ACAO e decidida aqui, nunca pela IA: `corrigir` quando ja havia outro
 * dentista, `informar` quando nao havia -- mesma disciplina de
 * `aplicarAceitacaoDeOferta`, pelo mesmo motivo (um `informar` sobre campo ja
 * preenchido vira conflito em `preAplicar` e some em silencio).
 *
 * A integridade do id (existe, e da clinica, esta ativo, tem vinculo) NAO e
 * conferida aqui: isso e do orquestrador, que tem o catalogo. Mesmo criterio
 * de quando a IA emitia `dentista_id` diretamente.
 */
function aplicarCandidatoUnicoDeDentista(
  alteracoes: AlteracoesDados,
  candidatos: string[] | null,
  snapshotOficial: SnapshotOficialConversa
): AlteracoesDados {
  if (candidatos === null || candidatos.length !== 1) return alteracoes;

  const escolhido = candidatos[0];
  const jaTemOutro =
    typeof snapshotOficial.dentista_id === 'string' &&
    snapshotOficial.dentista_id.trim() !== '' &&
    snapshotOficial.dentista_id !== escolhido;

  return {
    ...alteracoes,
    dentista_id: { acao: jaTemOutro ? 'corrigir' : 'informar', valor: escolhido },
  };
}

/**
 * Valida `agendamento_id` contra a lista OFICIALMENTE OFERECIDA neste turno
 * (specs/remarcacao-conversacional-v1.md secao 3, contrato fechado por
 * medicao 2026-08-11: 11/11 casos contra a IA real, sem evento, sem
 * `referencia_textual`). A IA correlaciona semanticamente e devolve o id
 * direto -- ela nunca resolve "o segundo"/"a limpeza" para indice ou id por
 * conta propria, e o Core NUNCA interpreta essas referencias aqui (seria
 * recriar o parser textual que a medicao provou desnecessario).
 *
 * `agendamentos_ativos` so chega no payload quando ha uma escolha pendente
 * (orquestrador.ts) -- entao a AUSENCIA da chave ja e prova de que nao
 * havia pergunta em aberto, e qualquer `agendamento_id` emitido mesmo assim
 * e descartado.
 *
 * ID fora da lista tambem e descartado -- nunca usado para localizar
 * agendamento, mesmo que exista de fato no banco (poderia pertencer a outra
 * pergunta, outro turno, ou ser uma alucinacao do modelo). O campo continua
 * ausente, e o orquestrador mantem `aguardando_escolha_agendamento`.
 */
function validarEscolhaAgendamento(
  alteracoes: AlteracoesDados,
  agendamentosAtivos: { agendamento_id: string; descricao: string }[] | undefined
): AlteracoesDados {
  const alteracao = alteracoes.agendamento_id;
  if (alteracao === undefined || alteracao.acao === 'remover') return alteracoes;

  const idsValidos = new Set((agendamentosAtivos ?? []).map((item) => item.agendamento_id));
  if (idsValidos.has(alteracao.valor as string)) return alteracoes;

  const { agendamento_id: _descartado, ...resto } = alteracoes;
  return resto;
}

/**
 * Intencoes cujo fluxo executa uma acao sobre um agendamento JA EXISTENTE e
 * portanto exige confirmacao explicita nova ao ser iniciado. Novo agendamento
 * nao entra: ele nunca escreve `intencao` e nao tem agendamento previo a
 * proteger.
 */
const INTENCOES_QUE_LIMPAM_CONFIRMACAO: readonly string[] = ['remarcacao', 'cancelamento'];

/**
 * Limpa `confirmacao` ao ENTRAR em remarcacao ou cancelamento
 * (specs/remarcacao-conversacional-v1.md e
 * specs/cancelamento-conversacional-v1.md secao 4, decisoes do Gabriel
 * 2026-08-11). Sem isso, um "sim" remanescente de um agendamento concluido
 * antes na MESMA conversa autorizaria a operacao sozinho, sem ninguem ter
 * perguntado nada -- mesmo defeito que cpf-outro-telefone-v1.md ja impediu ao
 * recusar reusar `confirmacao` naquele fluxo.
 *
 * "Entrar" e a TRANSICAO: `intencao` esta sendo escrita para um desses valores
 * NESTE turno E o snapshot oficial ainda nao era esse valor. Turnos seguintes,
 * ja dentro do fluxo, nunca passam por aqui -- a confirmacao da proposta
 * (secao 5 da spec de remarcacao, secao 4 da de cancelamento) segue intacta.
 *
 * Forca a remocao mesmo que a IA tenha emitido `confirmacao` neste MESMO
 * turno: nao existe `proposta_pendente` deste fluxo neste ponto (ela so nasce
 * depois, quando o Core localiza o agendamento ou encontra um horario livre),
 * entao nenhum valor legitimo de confirmacao pode existir para ele agora.
 *
 * NAO E A UNICA PROTECAO no cancelamento. Esta cobre o "sim" que vem de OUTRO
 * fluxo; o "sim" que sobra DENTRO do mesmo fluxo (entre uma pergunta de
 * confirmacao e a seguinte, quando `intencao` ja era 'cancelamento' e portanto
 * nao ha transicao) e barrado no orquestrador, pela exigencia de
 * `proposta_pendente` correspondente ao agendamento (spec secao 4, condicao 3).
 */
function limparConfirmacaoAoEntrarEmFluxoDeAgendamentoExistente(
  alteracoes: AlteracoesDados,
  snapshotOficial: SnapshotOficialConversa
): AlteracoesDados {
  const alteracaoIntencao = alteracoes.intencao;
  if (alteracaoIntencao === undefined || alteracaoIntencao.acao === 'remover') return alteracoes;

  const valor = alteracaoIntencao.valor;
  const entrandoAgora =
    typeof valor === 'string' &&
    INTENCOES_QUE_LIMPAM_CONFIRMACAO.includes(valor) &&
    snapshotOficial.intencao !== valor;

  if (!entrandoAgora) return alteracoes;

  return { ...alteracoes, confirmacao: { acao: 'remover' } };
}

/**
 * Descarta valor cadastral que nao passa na validacao deterministica
 * (specs/cadastro-conversacional-v1.md secao 4).
 *
 * Roda ANTES de `preAplicar`, no mesmo padrao das duas transformacoes acima:
 * funcao pura sobre `alteracoes`, sem banco e sem excecao. Nunca lanca de
 * proposito -- um CPF malformado nao pode derrubar a mensagem inteira, e
 * `validarAlteracoes` (aplicar-dados.ts) lancaria.
 *
 * Duas coisas acontecem aqui, e so aqui:
 *
 * - NORMALIZACAO: o valor aplicado e o conferido (CPF so com digitos, nome
 *   com espacos colapsados), nunca o texto cru que a IA devolveu;
 * - DESCARTE: valor invalido some da lista. O campo continua faltante e volta
 *   a ser pedido no turno seguinte -- nao existe estado persistido de
 *   "invalido", nem contador de tentativas, nem mensagem de erro dedicada.
 *   Isso mantem uma regra so em todo o sistema: faltante = ausente.
 *
 * `remover` passa intacto: apagar um campo nao tem valor a validar.
 */
function descartarCadastroInvalido(
  alteracoes: AlteracoesDados,
  dataReferencia: string | undefined
): { alteracoes: AlteracoesDados; invalidos: CampoCadastralInterpretacao[] } {
  const resultado: AlteracoesDados = {};
  // Quais campos o paciente informou NESTE turno e o Core rejeitou. Ate
  // 2026-08-16 esta informacao se perdia: o valor era descartado em silencio
  // e a Iris repetia o mesmo pedido sem dizer o motivo -- o paciente
  // reenviava o mesmo dado errado e o ciclo nao terminava. So o NOME do
  // campo e propagado; o valor rejeitado e PII e nunca sai daqui.
  const invalidos: CampoCadastralInterpretacao[] = [];

  for (const [campo, alteracao] of Object.entries(alteracoes)) {
    if (!CAMPOS_CADASTRAIS_INTERPRETACAO.includes(campo as CampoCadastralInterpretacao)) {
      resultado[campo] = alteracao;
      continue;
    }
    if (alteracao.acao === 'remover') {
      resultado[campo] = alteracao;
      continue;
    }

    const normalizado = normalizarCampoCadastral(
      campo as CampoCadastralInterpretacao,
      alteracao.valor as string,
      dataReferencia
    );
    if (normalizado === undefined) {
      invalidos.push(campo as CampoCadastralInterpretacao);
      continue;
    }
    resultado[campo] = { ...alteracao, valor: normalizado };
  }

  return { alteracoes: resultado, invalidos };
}

const CHAVES_ENTRADA_INTEGRADA = ['conversa_id', 'clinica_id', 'telefone_normalizado', 'mensagens_atuais'] as const;
const CHAVES_OPCIONAIS_INTEGRADA = [
  'horarios_oferecidos',
  'proposta_pendente',
  'historico_recente',
  'procedimentos_disponiveis',
  'dentistas_disponiveis',
  'oferta_procedimento_pendente',
  'troca_telefone_pendente',
  'agendamentos_ativos',
  'agendamentos_do_paciente',
  'cadastro_paciente',
  'data_referencia',
  // 2026-08-19: FALTAVA AQUI. O campo foi acrescentado ao payload sem entrar
  // nesta lista, e a validacao de chaves rejeitava a entrada inteira --
  // TODA mensagem numa conversa com historico virava 400 e a Iris parava de
  // responder. Um campo novo no payload precisa SEMPRE entrar aqui.
  'tratamentos_pendentes',
] as const;

/**
 * Orquestracao minima: valida o contexto (reutilizando a validacao
 * canonica de aplicarDados e do extrator, sem duplicar regex de UUID nem
 * regra de telefone), busca o snapshot OFICIAL de estado_conversa (nunca
 * confia em dados_atuais fornecido pelo chamador — a entrada nem aceita
 * essa chave), interpreta a janela, pre-aplica os conflitos
 * deterministicamente, chama aplicarDados (ja existente) somente com as
 * alteracoes inicialmente aplicaveis, e reconcilia o resultado final com o
 * que aplicarDados realmente persistiu (cobre a janela de concorrencia
 * entre a leitura do snapshot e a chamada a aplicarDados). Nao duplica
 * persistencia nem controle de concorrencia — isso continua inteiramente
 * dentro de aplicarDados.
 */
export async function interpretarEAplicar(
  clienteModelo: ClienteModeloEstruturado,
  clienteBanco: ClienteBancoDados,
  entradaBruta: InterpretarEAplicarInput
): Promise<ResultadoInterpretacao> {
  validarFormaEntradaIntegrada(entradaBruta);
  const entrada = entradaBruta;

  // 1. validar o contexto antes de qualquer consulta ou chamada ao modelo.
  validarContexto(entrada);
  validarMensagensAtuais(entrada.mensagens_atuais);

  // 2-3. buscar estado_conversa oficial e obter dados diretamente da linha
  // (mesma consulta que aplicarDados usa — nunca o dados_atuais do chamador).
  const linhaOficial = await buscarEstadoConversa(clienteBanco, entrada);

  // 4. validar os dados oficiais contra o contrato ATUAL e usar o snapshot
  // ja filtrado dai em diante (nunca o bruto lido do banco). Um campo que
  // pertenceu a uma versao anterior do contrato (ex.: `procedimento_texto`,
  // substituido por `procedimento_id`) e descartado em silencio aqui, nunca
  // bloqueia a conversa -- ver validarSnapshotOficial.
  const snapshotOficial = validarSnapshotOficial(linhaOficial.dados ?? {});

  // 5. derivar do snapshot oficial APENAS o contexto autorizado e enviar
  // ao modelo. Os campos operacionais seguem por valor; os cadastrais
  // (nome, cpf, data_nascimento, email) seguem somente como indicacao de
  // presenca -- nenhum valor cadastral atravessa esta fronteira
  // (specs/interpretacao-ia.md, "Entrada e PII"; cenarios INT-11/INT-12).
  // O snapshot completo permanece no servidor, para preAplicar e para a
  // reconciliacao adiante.
  const saida = await extrairAlteracoes(
    clienteModelo,
    construirEntradaMinimizada(
      entrada.mensagens_atuais,
      snapshotOficial,
      entrada.horarios_oferecidos,
      entrada.proposta_pendente,
      entrada.historico_recente,
      entrada.procedimentos_disponiveis,
      entrada.dentistas_disponiveis,
      entrada.oferta_procedimento_pendente !== undefined ? true : undefined,
      // Segunda origem de dado cadastral (a ficha em `pacientes`). Vai
      // inteira para dentro de construirEntradaMinimizada, que extrai
      // PRESENCA e descarta os valores -- nenhum valor cadastral, de
      // qualquer origem, chega ao modelo.
      entrada.cadastro_paciente,
      entrada.troca_telefone_pendente,
      entrada.agendamentos_ativos,
      entrada.agendamentos_do_paciente
    )
  );

  // 5b. ACEITACAO DE OFERTA -- quem aplica e o Core, nunca a IA
  // (specs/contexto-pendente-interpretacao-v1.md secao 11 +
  // eventos-conversacionais-v1.md secao 1: evento da IA e sempre candidato).
  //
  // Exige os DOIS lados: o candidato `aceitar_opcao` E uma oferta oficial
  // pendente. Um evento sem oferta e simplesmente ignorado -- a IA nao tem
  // como fazer o Core aplicar procedimento nenhum por conta propria.
  //
  // O `procedimento_id` vem SEMPRE do snapshot oficial, nunca do evento: o
  // evento nao carrega id, e por isso mesmo nao ha o que forjar.
  const alteracoesComOferta = aplicarAceitacaoDeOferta(
    saida.alteracoes,
    saida.eventos_candidatos,
    saida.natureza_mensagem,
    entrada.oferta_procedimento_pendente,
    snapshotOficial
  );

  // 5c. CANDIDATO UNICO DE DENTISTA -- quem escreve `dentista_id` e o Core
  // (specs/dentista-semantico-v1.md secao 12). A IA nao emite esse campo: ela
  // devolve `dentistas_candidatos`, e so o caso de UM candidato vira dado
  // persistido aqui. Zero e varios nao escrevem nada -- viram decisao no
  // orquestrador, que precisa perguntar ao paciente antes de haver escolha.
  // 5b-bis. LISTA VAZIA SEM MENCAO A PROFISSIONAL (2026-08-19).
  // `[]` significa "falou de alguem que nao existe" e produz "nao encontrei
  // esse profissional". Quando o turno trouxe data/horario/confirmacao, a
  // mensagem era sobre AGENDAR -- ver guarda-lista-vazia-dentistas.ts.
  const guardaLista = descartarListaVaziaSemMencao(saida.dentistas_candidatos, alteracoesComOferta);
  if (guardaLista.descartou) {
    console.log('guarda_lista_vazia_dentistas descartada=1');
  }

  // 5b-ter. DENTISTA DEFINIDO NO PAINEL (2026-08-19).
  // Quando o dentista escolheu quem realiza o procedimento, essa decisao vale
  // sem o paciente precisar responder -- ela e clinica, nao dele. Aplicada
  // AQUI, no Core, e nao por instrucao: `dentistas_candidatos` responde a
  // "a quem o paciente se refere", e ele nao se referiu a ninguem.
  // Ver dentista-do-tratamento.ts.
  // DIAGNOSTICO (2026-08-19): o par [o que ENTROU no payload, o que a IA
  // DEVOLVEU]. Sem isto nao da para saber se a Iris perguntou o procedimento
  // porque o dado nao chegou ou porque a IA nao o usou.
  //
  // Sem PII: contagens e ids canonicos do catalogo, nunca texto do paciente.
  console.log(
    'interpretacao_tratamentos' +
      ` no_payload=${entrada.tratamentos_pendentes?.length ?? 0}` +
      ` assunto=${entrada.tratamentos_pendentes?.find((t) => t.assunto_atual)?.procedimento_id ?? '-'}` +
      ` ia_procedimento=${alteracoesComOferta.procedimento_id?.valor ?? '-'}` +
      ` ia_candidatos=${saida.dentistas_candidatos === null ? 'null' : String(saida.dentistas_candidatos.length)}` +
      ` campos=${Object.keys(alteracoesComOferta).join(',') || '-'}`
  );

  // 5b-quater. PROCEDIMENTO ANUNCIADO (2026-08-19).
  // Quando a assistente acabou de anunciar UM procedimento e o paciente
  // responde sobre data/horario, e daquele que ele fala. Aplicado no Core:
  // a instrucao da interpretadora tem 42 regras, e esta se perdia entre
  // elas -- ver procedimento-do-anuncio.ts.
  //
  // Vem ANTES do dentista de proposito: o dentista e escolhido a partir do
  // procedimento, entao o procedimento precisa existir primeiro.
  const procedimentoAnunciado = aplicarProcedimentoDoAnuncio(
    alteracoesComOferta,
    entrada.tratamentos_pendentes,
    snapshotOficial
  );
  if (procedimentoAnunciado.aplicou) {
    console.log('procedimento_do_anuncio_aplicado=1');
  }

  const dentistaDoPlano = aplicarDentistaDoTratamento(
    procedimentoAnunciado.alteracoes,
    guardaLista.candidatos,
    entrada.tratamentos_pendentes,
    snapshotOficial
  );
  if (dentistaDoPlano.aplicou) {
    console.log('dentista_do_plano_aplicado=1');
  }

  const alteracoesFinais = aplicarCandidatoUnicoDeDentista(
    dentistaDoPlano.alteracoes,
    guardaLista.candidatos,
    snapshotOficial
  );

  // 5c-alfa. ESCOLHER PROFISSIONAL NAO IDENTIFICA O PACIENTE.
  //
  // Defeito real (WhatsApp, 2026-08-16): "pode ser o dr. pablo arruda"
  // produziu, no mesmo turno, o dentista escolhido E `nome = "Arruda"` -- o
  // sobrenome do PROFISSIONAL virou o nome do PACIENTE na ficha.
  //
  // A regra ja existia em `guarda-contexto-unificado.ts`, mas so rodava no
  // shadow, que apenas mede. Aqui ela entra na rota que atende de fato.
  // Deteccao ESTRUTURAL (co-ocorrencia dos dois campos), nunca comparacao de
  // texto -- ver guarda-nome-escolha-dentista.ts.
  const guardaNome = descartarNomeDeEscolhaDeDentista(alteracoesFinais, guardaLista.candidatos);

  // 5c-bis. ESCOLHA DE AGENDAMENTO -- gate de integridade contra a lista
  // oficialmente oferecida neste turno (specs/remarcacao-conversacional-v1.md
  // secao 3). Id fora da lista (ou sem lista nenhuma) nunca e persistido.
  const alteracoesComEscolhaAgendamento = validarEscolhaAgendamento(
    guardaNome.alteracoes,
    entrada.agendamentos_ativos
  );

  // 5c-ter. LIMPEZA DE CONFIRMACAO AO ENTRAR EM REMARCACAO/CANCELAMENTO -- um
  // "sim" de outro fluxo, na mesma conversa, nunca autoriza uma operacao sobre
  // agendamento existente que ninguem confirmou.
  const alteracoesComRemarcacao = limparConfirmacaoAoEntrarEmFluxoDeAgendamentoExistente(
    alteracoesComEscolhaAgendamento,
    snapshotOficial
  );

  // 5d. VALIDACAO CADASTRAL -- o Core confere o que a IA extraiu
  // (specs/cadastro-conversacional-v1.md secao 4). Valor invalido e
  // descartado aqui, antes de virar dado da conversa; valor valido segue
  // NORMALIZADO.
  const validacaoCadastral = descartarCadastroInvalido(alteracoesComRemarcacao, entrada.data_referencia);
  const alteracoesValidadas = validacaoCadastral.alteracoes;

  // 6. pre-aplicacao deterministica usando o mesmo snapshot.
  const preAplicacao = preAplicar(snapshotOficial, alteracoesValidadas);
  const conflitos: Conflito[] = [...preAplicacao.conflitos];
  let alteracoesAplicaveis = { ...preAplicacao.alteracoes_aplicaveis };

  // 7. chamar aplicarDados somente com as alteracoes inicialmente aplicaveis.
  let aplicacao: ResultadoAplicarDados | null = null;
  if (Object.keys(alteracoesAplicaveis).length > 0) {
    aplicacao = await aplicarDados(clienteBanco, {
      conversa_id: entrada.conversa_id,
      clinica_id: entrada.clinica_id,
      telefone_normalizado: entrada.telefone_normalizado,
      alteracoes: alteracoesAplicaveis,
    });

    // 8. reconciliar: entre a leitura do snapshot e aplicarDados, outra
    // operacao pode ter alterado a conversa. Um `informar` que o snapshot
    // considerava aplicavel (campo ausente ou com o mesmo valor) pode ter
    // sido preservado por aplicarDados porque o valor oficial mudou nesse
    // meio-tempo. Nesse caso vira conflito agora, com o valor oficial FINAL
    // (nunca o snapshot desatualizado) -- nunca escolhido nem descartado
    // silenciosamente.
    const camposJaEmConflito = new Set(conflitos.map((conflito) => conflito.campo));
    const camposParaRemoverDeAplicaveis: string[] = [];
    const dadosFinais = (aplicacao.dados as Record<string, string>) ?? {};

    for (const [campo, alteracao] of Object.entries(alteracoesAplicaveis)) {
      if (alteracao.acao !== 'informar') continue;
      if (!aplicacao.campos_preservados.includes(campo)) continue;
      if (camposJaEmConflito.has(campo)) continue;

      const valorFinal = dadosFinais[campo];
      if (valorFinal !== alteracao.valor) {
        conflitos.push({ campo, valor_atual: valorFinal, valor_informado: alteracao.valor as string });
        camposParaRemoverDeAplicaveis.push(campo);
      }
    }

    if (camposParaRemoverDeAplicaveis.length > 0) {
      alteracoesAplicaveis = Object.fromEntries(
        Object.entries(alteracoesAplicaveis).filter(([campo]) => !camposParaRemoverDeAplicaveis.includes(campo))
      );
    }
  }

  return {
    natureza_mensagem: saida.natureza_mensagem,
    alteracoes_interpretadas: saida.alteracoes,
    alteracoes_aplicaveis: alteracoesAplicaveis,
    conflitos,
    // Campos cadastrais que o paciente informou NESTE turno e o Core
    // rejeitou por invalidos. Transitorio: existe so para a redatora poder
    // dizer QUAL campo estava errado, em vez de repetir o pedido inteiro.
    ...(validacaoCadastral.invalidos.length > 0
      ? { campos_cadastrais_invalidos: validacaoCadastral.invalidos }
      : {}),
    aplicacao,
    dentistas_candidatos: guardaLista.candidatos,
    // Transitoria por construcao: sai daqui para o orquestrador e nunca e
    // gravada em `dados` (specs/cpf-outro-telefone-v1.md secao 2).
    resposta_troca_telefone: lerRespostaTrocaTelefone(
      saida.eventos_candidatos,
      saida.natureza_mensagem,
      entrada.troca_telefone_pendente
    ),
  };
}

function validarFormaEntradaIntegrada(entrada: unknown): asserts entrada is InterpretarEAplicarInput {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new EntradaInvalidaError('entrada', 'entrada deve ser um objeto');
  }

  // Entrada fechada: somente os quatro campos obrigatorios mais
  // `horarios_oferecidos` (opcional). `dados_atuais` (ou qualquer outra
  // chave) e tratado como propriedade extra e rejeitado -- o chamador nunca
  // fornece o snapshot de dados, ele e sempre lido do banco.
  const chaves = Object.keys(entrada as Record<string, unknown>);
  const obrigatorias: readonly string[] = CHAVES_ENTRADA_INTEGRADA;
  const permitidas: readonly string[] = [...CHAVES_ENTRADA_INTEGRADA, ...CHAVES_OPCIONAIS_INTEGRADA];
  if (!obrigatorias.every((chave) => chaves.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada integrada nao contem todas as chaves obrigatorias');
  }
  if (!chaves.every((chave) => permitidas.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada integrada contem propriedade nao permitida');
  }
}
