import { identificarConversa } from './identificacao.ts';
import { interpretarEAplicar } from './interpretar-e-aplicar.ts';
import { resolverDentista } from './resolver-dentista.ts';
import { resolverDuracao } from './resolver-duracao.ts';
import { montarFatosTemporais } from './montar-fatos-temporais.ts';
import { resolverTemporal } from './resolver-temporal.ts';
import { carregarEntradaDisponibilidade } from './carregar-disponibilidade.ts';
import { carregarCatalogo } from './carregar-catalogo.ts';
import { reservarAgendamento } from './reservar-agendamento.ts';
import { derivarAcaoContextoHorarios, gravarContextoHorarios } from './contexto-horarios.ts';
import { historicoValidoParaEnvio } from './historico-conversa.ts';
import type { ClienteBancoDados } from './tipos.ts';
import type { ClienteModeloEstruturado, NaturezaMensagem } from './interpretacao-tipos.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';
import type { InstanteAtual, ModoConsulta, OpcaoHorario } from './disponibilidade-tipos.ts';
import type { ResolucaoTemporalOficial } from './temporal-tipos.ts';
import type { CatalogoClinica, DecisaoOrquestrador, EntradaOrquestrador, ResultadoOrquestrador } from './orquestrador-tipos.ts';

/**
 * Orquestrador minimo do primeiro fluxo: identificacao -> interpretacao ->
 * resolvedores de dominio ja publicados -> resolucao temporal (fatia minima)
 * -> disponibilidade real -> confirmacao explicita -> reserva
 * (cappia_reservar_agendamento, RPC ja em producao, ver orquestrador-tipos.ts).
 * Ver orquestrador-tipos.ts para o vocabulario temporal exato coberto e o
 * que fica de fora por decisao do Gabriel.
 *
 * Nao gera texto de resposta ao paciente (redacao/NLG e P5, fora de escopo)
 * -- devolve uma decisao estruturada para o chamador formatar. Nao toca
 * remarcacao, cancelamento, consulta de agendamento, outbox nem cadastro de
 * paciente novo (ver decisao 'cadastro_necessario').
 */
export async function processarMensagem(
  clienteModelo: ClienteModeloEstruturado,
  clienteBanco: ClienteBancoDados,
  clienteRpc: ClienteRpc,
  entrada: EntradaOrquestrador
): Promise<ResultadoOrquestrador> {
  const identificacao = await identificarConversa(clienteBanco, {
    provider: entrada.provider,
    instancia_whatsapp: entrada.instancia_whatsapp,
    telefone_normalizado: entrada.telefone_normalizado,
  });

  // Filtro de validade (24h) aplicado AQUI, no ponto de leitura para a
  // interpretadora (specs/historico-conversacional-v1.md secao 6) -- o
  // valor cru (sem filtro) e o que segue para ResultadoOrquestrador.historico_conversa,
  // usado depois na gravacao (seção 3 da mesma spec).
  const historicoParaInterpretacao = historicoValidoParaEnvio(identificacao.conversa.historico_conversa, Date.now());

  // CARREGAR CEDO, CHECAR TARDE (specs/procedimento-semantico-v1.md secao 1).
  // O catalogo precisa existir ANTES da interpretacao, porque e ele que
  // permite a IA resolver o pedido ate `procedimento_id`. Mas a checagem de
  // `clinica_sem_catalogo` continua LA EMBAIXO, depois do early-return
  // conversacional: subi-la junto faria uma saudacao numa clinica sem
  // catalogo devolver erro tecnico em vez de cumprimentar.
  const catalogoCarregado = await carregarCatalogo(clienteBanco, { clinica_id: identificacao.clinica_id });
  const procedimentosDisponiveis =
    catalogoCarregado.tipo === 'carregado'
      ? catalogoCarregado.catalogo.procedimentos
          .filter((p) => p.ativo)
          .map((p) => ({ procedimento_id: p.procedimento_id, nome_pt: p.nome_pt }))
      : [];
  // Dentistas ATIVOS, sem filtro de aptidao (specs/dentista-semantico-v1.md
  // secao 1): o vinculo depende do `procedimento_id`, que so existe DEPOIS
  // desta interpretacao. Filtrar faria um dentista sem vinculo sumir da
  // lista, a IA omitir o campo, e o Core seguir com outro em silencio.
  const dentistasDisponiveis =
    catalogoCarregado.tipo === 'carregado'
      ? catalogoCarregado.catalogo.dentistas
          .filter((d) => d.ativo)
          .map((d) => ({ dentista_id: d.dentista_id, nome_exibido: d.nome_exibido }))
      : [];

  const interpretacao = await interpretarEAplicar(clienteModelo, clienteBanco, {
    conversa_id: identificacao.conversa.id,
    clinica_id: identificacao.clinica_id,
    telefone_normalizado: entrada.telefone_normalizado,
    mensagens_atuais: entrada.mensagens_atuais,
    // Horarios ja oferecidos na ultima pergunta gerada, quando houver --
    // contexto de interpretacao, nunca fonte de disponibilidade
    // (specs/contexto-pendente-interpretacao-v1.md). `horarios` e opcional
    // no snapshot desde specs/resposta-conversacional-v1.md secao 5 --
    // ausente quando o snapshot representa so uma `proposta_pendente`.
    ...(identificacao.conversa.contexto_horarios?.horarios !== undefined
      ? { horarios_oferecidos: identificacao.conversa.contexto_horarios.horarios }
      : {}),
    // Proposta concreta aguardando confirmacao, quando houver -- e o que
    // permite a IA reconhecer "pode confirmar"/"esse mesmo" como resposta a
    // ELA especificamente (specs/resposta-conversacional-v1.md secao 5).
    ...(identificacao.conversa.contexto_horarios?.proposta_pendente !== undefined
      ? { proposta_pendente: identificacao.conversa.contexto_horarios.proposta_pendente }
      : {}),
    // Ultimos turnos da conversa, quando houver algum dentro da janela de
    // validade -- reversao declarada de memoria-conversacional-minima-v1.md
    // (specs/historico-conversacional-v1.md secao 6): a interpretadora
    // passa a receber contexto, nunca so a mensagem atual isolada.
    ...(historicoParaInterpretacao !== undefined ? { historico_recente: historicoParaInterpretacao } : {}),
    // Catalogo ativo minimo: a IA resolve o pedido do paciente diretamente
    // para `procedimento_id` (specs/procedimento-semantico-v1.md). Chave
    // AUSENTE quando a clinica nao tem catalogo carregavel -- nunca `[]`.
    ...(procedimentosDisponiveis.length > 0 ? { procedimentos_disponiveis: procedimentosDisponiveis } : {}),
    // Dentistas ativos: a IA correlaciona "o Carlos"/"a Dra. Vanesa" com um
    // `dentista_id` real (specs/dentista-semantico-v1.md). Chave AUSENTE
    // quando nao ha nenhum ativo -- nunca `[]`.
    ...(dentistasDisponiveis.length > 0 ? { dentistas_disponiveis: dentistasDisponiveis } : {}),
    // Oferta de procedimento feita no turno anterior, quando houver. O
    // `procedimento_id` segue para o Core (que e quem aplica), e NAO para a
    // IA -- `construirEntradaMinimizada` converte para um simples `true`
    // antes de montar o payload (specs/contexto-pendente-interpretacao-v1.md
    // secao 11). A IA so precisa saber que ha uma oferta em aberto.
    ...(identificacao.conversa.contexto_horarios?.oferta_procedimento_pendente !== undefined
      ? { oferta_procedimento_pendente: identificacao.conversa.contexto_horarios.oferta_procedimento_pendente }
      : {}),
  });

  // `atualizado_em` EXATO do estado sobre o qual a decisao desta mensagem
  // sera calculada: o valor apos aplicarDados quando houve aplicacao, ou o
  // lido na identificacao quando nada foi aplicado. Nunca relido antes do
  // UPDATE do snapshot -- reler rebasearia uma operacao obsoleta sobre um
  // estado novo (spec secao 5).
  const atualizadoEmDaDecisao = interpretacao.aplicacao?.atualizado_em ?? identificacao.conversa.atualizado_em;

  // aplicacao.dados so vem preenchido quando houve pelo menos uma alteracao
  // aplicavel (interpretar-e-aplicar.ts); sem isso, o snapshot ja
  // identificado continua sendo o oficial.
  const dados = (interpretacao.aplicacao?.dados ?? identificacao.conversa.dados) as Record<string, string | undefined>;

  // natureza_mensagem (specs/interpretacao-natureza-mensagem-v1.md) so
  // decide a acao comunicativa quando esta mensagem nao produziu nenhuma
  // alteracao -- `alteracoes` sempre tem precedencia sobre
  // `natureza_mensagem` para a evolucao do fluxo (mesma spec, secao 3).
  // Nao consulta catalogo, nao muda `dados`: puramente conversacional.
  // Todo desfecho passa por aqui: grava o snapshot de horarios derivado da
  // decisao final e so entao devolve o resultado. A gravacao e auxiliar e
  // best-effort por contrato -- nunca lanca, nunca altera a decisao ja
  // tomada, nunca afeta a resposta ao paciente.
  const finalizar = async (
    decisao: DecisaoOrquestrador,
    substituicao?: { dentista_nome_exibido: string }
  ): Promise<ResultadoOrquestrador> => {
    const atualizadoEmFinal = await gravarContextoHorarios(clienteBanco, {
      conversa_id: identificacao.conversa.id,
      clinica_id: identificacao.clinica_id,
      telefone_normalizado: entrada.telefone_normalizado,
      atualizado_em_da_decisao: atualizadoEmDaDecisao,
      acao: derivarAcaoContextoHorarios(decisao),
    });

    return {
      clinica_id: identificacao.clinica_id,
      conversa_id: identificacao.conversa.id,
      conflitos: interpretacao.conflitos,
      decisao,
      atualizado_em: atualizadoEmFinal,
      natureza_mensagem: interpretacao.natureza_mensagem,
      historico_conversa: identificacao.conversa.historico_conversa,
      ...(substituicao !== undefined ? { substituicao_por_avaliacao: substituicao } : {}),
    };
  };

  if (Object.keys(interpretacao.alteracoes_interpretadas).length === 0) {
    const decisaoConversacional = decidirPorNatureza(interpretacao.natureza_mensagem, dados);
    if (decisaoConversacional !== null) {
      return await finalizar(decisaoConversacional);
    }
  }

  // Checagem TARDE (ver "carregar cedo, checar tarde" acima): o catalogo ja
  // foi carregado antes da interpretacao, mas so aqui a ausencia dele vira
  // decisao -- depois do early-return conversacional.
  if (catalogoCarregado.tipo !== 'carregado') {
    return await finalizar({ tipo: 'clinica_sem_catalogo' });
  }

  const resultadoDecisao = await decidir(
    clienteBanco,
    clienteRpc,
    identificacao.clinica_id,
    identificacao.paciente.id,
    entrada.telefone_normalizado,
    dados,
    catalogoCarregado.catalogo,
    entrada.instante_atual,
    interpretacao.dentistas_candidatos
  );

  return await finalizar(resultadoDecisao.decisao, resultadoDecisao.substituicao);
}

/**
 * Traduz `natureza_mensagem` (specs/interpretacao-natureza-mensagem-v1.md)
 * numa decisao conversacional, ou `null` quando a mensagem deve seguir
 * pelo caminho normal de resolucao (nenhuma acao conversacional
 * autorizada para este caso). So chamada quando `alteracoes` desta
 * mensagem ja esta vazio (processarMensagem) -- nunca decide nada sobre
 * procedimento, dentista, duracao, disponibilidade ou reserva.
 */
/**
 * "Ainda nao ha procedimento conhecido nesta conversa". Desde
 * specs/procedimento-semantico-v1.md o campo e `procedimento_id` -- um
 * identificador OPACO do catalogo, nunca texto livre do paciente. Por isso a
 * checagem e de PRESENCA, e nao mais `textoAusenteParaResolucao` (que
 * normalizava acento/caixa para comparar contra alias; nao faz sentido sobre
 * um id).
 */
function procedimentoAusente(dados: Record<string, string | undefined>): boolean {
  const id = dados.procedimento_id;
  return typeof id !== 'string' || id.trim() === '';
}

function decidirPorNatureza(
  natureza: NaturezaMensagem,
  dados: Record<string, string | undefined>
): DecisaoOrquestrador | null {
  switch (natureza) {
    case 'saudacao':
      // So cumprimenta se ainda nao ha procedimento conhecido nesta
      // conversa (de qualquer mensagem anterior) -- uma saudacao no meio
      // de um fluxo em andamento nunca o reabre.
      return procedimentoAusente(dados) ? { tipo: 'saudacao' } : null;
    case 'duvida':
      // So acolhe como duvida livre se ainda nao ha procedimento conhecido
      // nesta conversa -- com procedimento ja conhecido, a duvida nao pode
      // interromper o fluxo em andamento: segue pelo caminho normal, que
      // retoma exatamente a pergunta pendente (data/horario/confirmacao).
      return procedimentoAusente(dados) ? { tipo: 'duvida_livre' } : null;
    case 'negacao':
      return { tipo: 'desistencia' };
    case 'nao_compreendida':
      return { tipo: 'mensagem_nao_compreendida' };
    case 'pedido':
    case 'resposta':
    case 'correcao':
      // Nao ha decisao conversacional propria para estes tres -- segue
      // pelo caminho normal (que, com alteracoes vazio, produz o mesmo
      // desfecho de sempre, ex.: aguardando_procedimento).
      return null;
  }
}

async function decidir(
  clienteBanco: ClienteBancoDados,
  clienteRpc: ClienteRpc,
  clinicaId: string,
  pacienteId: string | null,
  telefoneNormalizado: string,
  dados: Record<string, string | undefined>,
  catalogo: CatalogoClinica,
  instanteAtual: InstanteAtual,
  dentistasCandidatos: string[] | null
): Promise<{ decisao: DecisaoOrquestrador; substituicao?: { dentista_nome_exibido: string } }> {
  // INTEGRIDADE, NUNCA INTERPRETACAO (specs/procedimento-semantico-v1.md
  // secao 4). Quem entendeu o pedido do paciente foi a IA, que devolveu um
  // `procedimento_id` canonico; aqui o Core so confere tres coisas -- o ID
  // existe, pertence a esta clinica, e esta ativo. Nao normaliza texto, nao
  // compara nome, nao rele a mensagem.
  //
  // ID ausente, inexistente, de outra clinica ou inativo caem todos no MESMO
  // desfecho: `aguardando_procedimento`, a mesma pergunta de sempre. Os
  // motivos ja eram equivalentes perante o paciente por decisao de spec
  // (specs/procedimentos-v1.md secao 7: nunca revelar que um procedimento
  // existe mas esta inativo), entao colapsa-los nao muda nada do que ele ve.
  const procedimento = catalogo.procedimentos.find(
    (p) => p.procedimento_id === dados.procedimento_id && p.clinica_id === clinicaId && p.ativo
  );
  if (!procedimento) {
    return { decisao: { tipo: 'aguardando_procedimento' } };
  }

  // REGRA DE CONTAGEM DOS CANDIDATOS (specs/dentista-semantico-v1.md secao
  // 12). Vem ANTES da resolucao normal porque `varios` e `nenhum` sao
  // perguntas ao paciente -- nao ha escolha a validar ainda, e um
  // `dados.dentista_id` antigo nao pode prevalecer sobre a mencao atual.
  //
  // O caso de UM candidato nao aparece aqui: ele ja foi persistido em
  // `dados.dentista_id` por interpretar-e-aplicar.ts, e segue pelo CASO 2 de
  // sempre, logo abaixo, sem uma linha de mudanca.
  const analise = analisarCandidatos(clinicaId, procedimento.procedimento_id, dentistasCandidatos, catalogo);
  if ('decisao' in analise) return { decisao: analise.decisao };

  const resolucaoDentista = resolverDentistaEProcedimento(
    clinicaId,
    procedimento.procedimento_id,
    // A mencao ATUAL prevalece sobre um dentista escolhido em turno anterior.
    analise.dentistaId ?? dados.dentista_id,
    catalogo
  );
  if ('decisaoAntecipada' in resolucaoDentista) return { decisao: resolucaoDentista.decisaoAntecipada };

  // Do ponto de vista de duracao, disponibilidade e reserva, o procedimento
  // oficial deste turno e o EFETIVO -- que difere do pedido somente quando
  // cedeu lugar a Consulta/Avaliacao para preservar o dentista escolhido.
  const procedimentoIdEfetivo = resolucaoDentista.procedimentoIdEfetivo;
  const substituicao = resolucaoDentista.substituicao;
  const comSubstituicao = (decisao: DecisaoOrquestrador) => ({
    decisao,
    ...(substituicao !== undefined ? { substituicao } : {}),
  });

  const resultadoDuracao = resolverDuracao({
    clinica_id: clinicaId,
    procedimento_id: procedimentoIdEfetivo,
    configuracoes: catalogo.configuracoesDuracao,
  });

  if (resultadoDuracao.tipo === 'nao_configurada') return comSubstituicao({ tipo: 'duracao_nao_configurada' });
  if (resultadoDuracao.tipo !== 'resolvida') {
    return comSubstituicao({ tipo: 'erro_configuracao_duracao', resultado: resultadoDuracao });
  }

  // fuso ausente (clinica sem configuracao, ou linha nao encontrada) nao e
  // validado aqui por conta propria -- passa direto pra resolverTemporal,
  // que ja tem o motivo de erro proprio (erro_configuracao/fuso_ausente),
  // em vez de duplicar essa checagem no orquestrador.
  const fuso = await buscarFusoHorario(clienteBanco, clinicaId);

  const resultadoTemporal = resolverTemporal({
    clinica_id: clinicaId,
    fuso: fuso ?? '',
    instante_atual: instanteAtual,
    fatos_temporais: montarFatosTemporais({
      data_texto: dados.data_texto,
      periodo: dados.periodo,
      horario_texto: dados.horario_texto,
    }),
  });

  if (resultadoTemporal.tipo !== 'resolvido') {
    return comSubstituicao({ tipo: 'aguardando_data_horario', resultado: resultadoTemporal });
  }

  const carregado = await carregarEntradaDisponibilidade(clienteBanco, {
    clinica_id: clinicaId,
    dentista_id: resolucaoDentista.dentistaId,
    procedimento_id: procedimentoIdEfetivo,
    data: resultadoTemporal.data,
    instante_atual: instanteAtual,
    modo: derivarModoConsulta(resultadoTemporal),
  });

  switch (carregado.tipo) {
    case 'carregado':
      // horario_exato_disponivel = o paciente escolheu um horario especifico
      // (via horario_texto -> montarFatosTemporais -> modo horario_exato) e
      // ele esta livre: e o unico desfecho que pode levar a reserva. Todos
      // os outros (opcoes/sem_disponibilidade/horario_exato_indisponivel/
      // erros de configuracao) so mostram o que ha, nunca reservam.
      if (carregado.resultado.tipo === 'horario_exato_disponivel') {
        return comSubstituicao(
          await decidirConfirmacaoOuReserva(
            clienteRpc,
            clinicaId,
            pacienteId,
            telefoneNormalizado,
            procedimentoIdEfetivo,
            resolucaoDentista.dentistaId,
            resultadoDuracao.duracao_min,
            carregado.resultado.opcao,
            dados.confirmacao
          )
        );
      }
      return comSubstituicao({
        tipo: 'horarios_disponiveis',
        procedimento_id: procedimentoIdEfetivo,
        dentista_id: resolucaoDentista.dentistaId,
        duracao_min: resultadoDuracao.duracao_min,
        resultado: carregado.resultado,
      });
    case 'clinica_nao_encontrada':
      // Nao deveria ocorrer (identificarConversa ja confirmou a clinica
      // antes desta funcao ser chamada) -- tratado como configuracao
      // temporal ausente, nunca uma excecao nao tratada.
      return comSubstituicao({
        tipo: 'aguardando_data_horario',
        resultado: { tipo: 'erro_configuracao', motivo: 'fuso_ausente' },
      });
    case 'dentista_nao_encontrado':
      return comSubstituicao({ tipo: 'sem_dentista_disponivel' });
    case 'duracao_nao_resolvida':
      return comSubstituicao(
        carregado.resultado.tipo === 'nao_configurada'
          ? { tipo: 'duracao_nao_configurada' }
          : { tipo: 'erro_configuracao_duracao', resultado: carregado.resultado }
      );
  }
}

/**
 * So chega aqui com um horario ja comprovadamente livre na leitura
 * (resolverDisponibilidade ja devolveu horario_exato_disponivel). Nunca
 * recalcula procedimento/dentista/duracao/horario -- todos os quatro
 * chegam exatamente como ja resolvidos por decidir(), sem nova consulta.
 */
async function decidirConfirmacaoOuReserva(
  clienteRpc: ClienteRpc,
  clinicaId: string,
  pacienteId: string | null,
  telefoneNormalizado: string,
  procedimentoId: string,
  dentistaId: string,
  duracaoMin: number,
  opcao: OpcaoHorario,
  confirmacao: string | undefined
): Promise<DecisaoOrquestrador> {
  // Regra absoluta: nunca reservar sem confirmacao explicita ('sim',
  // vocabulario fechado ja validado por aplicar-dados.ts). Ausencia ou
  // qualquer outro valor -- nunca tratado como confirmacao implicita.
  if (confirmacao !== 'sim') {
    return { tipo: 'aguardando_confirmacao', procedimento_id: procedimentoId, dentista_id: dentistaId, opcao };
  }

  // cappia_reservar_agendamento exige paciente_id (nao tem default) -- sem
  // paciente ja cadastrado pelo telefone, nao ha o que reservar. Cadastro de
  // paciente novo fica fora desta etapa, por decisao do Gabriel.
  if (pacienteId === null) {
    return { tipo: 'cadastro_necessario' };
  }

  const horario = minutosParaHHMM(opcao.inicio_min);
  const resultadoReserva = await reservarAgendamento(clienteRpc, {
    clinica_id: clinicaId,
    procedimento_id: procedimentoId,
    dentista_id: dentistaId,
    paciente_id: pacienteId,
    data: opcao.data,
    horario,
    telefone_normalizado: telefoneNormalizado,
  });

  switch (resultadoReserva.tipo) {
    case 'reservado':
      return {
        tipo: 'reserva_criada',
        agendamento_id: resultadoReserva.agendamento_id,
        dentista_id: resultadoReserva.dentista_id,
        procedimento_id: procedimentoId,
        duracao_min: resultadoReserva.duracao_min,
        data: resultadoReserva.data,
        horario: resultadoReserva.horario,
      };
    case 'conflito':
      // A trava real da RPC (testada em producao) recusou por sobreposicao,
      // mesmo com a leitura anterior indicando livre (corrida real) --
      // nunca insiste sozinho, devolve conflito para pedir nova escolha.
      return { tipo: 'reserva_conflito' };
    case 'falhou':
      return { tipo: 'reserva_falhou', motivo: resultadoReserva.motivo };
  }
}

// resolverDisponibilidade opera em minutos locais (secao 2 de
// specs/disponibilidade.md); cappia_reservar_agendamento espera HH:MM
// (auditado). Unica conversao necessaria pra reaproveitar a RPC existente.
function minutosParaHHMM(minutos: number): string {
  const hora = Math.floor(minutos / 60);
  const minuto = minutos % 60;
  return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
}

async function buscarFusoHorario(cliente: ClienteBancoDados, clinicaId: string): Promise<string | null> {
  const { data, error } = await cliente.from('clinicas').select('fuso_horario').eq('id', clinicaId).maybeSingle();
  if (error) throw new Error(`falha ao buscar fuso da clinica: ${error.message}`);
  const fuso = (data as Record<string, unknown> | null)?.fuso_horario;
  return typeof fuso === 'string' && fuso.trim() !== '' ? fuso : null;
}

// Traduz o resultado temporal resolvido pro modo que resolverDisponibilidade
// espera (ja publicado, nao alterado): horario explicito tem prioridade
// (modo 'horario_exato' nao aceita periodo simultaneamente, pelo proprio
// contrato fechado de ModoConsulta); sem horario, usa periodo quando
// informado; sem os dois, grade do dia inteiro.
function derivarModoConsulta(resultado: ResolucaoTemporalOficial): ModoConsulta {
  if (resultado.horario_min !== undefined) {
    return { tipo: 'horario_exato', horario_min: resultado.horario_min };
  }
  if (resultado.periodo !== undefined) {
    return { tipo: 'grade', periodo: resultado.periodo };
  }
  return { tipo: 'grade' };
}

/**
 * Identidade canonica da Consulta/Avaliacao
 * (specs/dentista-semantico-v1.md secao 5, decisao do Gabriel 2026-08-09).
 *
 * `procedimentos_catalogo` e uma tabela GLOBAL (nao tem `clinica_id`), entao
 * o id e estavel em todas as clinicas. Nao e match textual: e um
 * identificador opaco fixo, usado SO em operacao deterministica do Core --
 * no fluxo normal quem chega a este mesmo id e a interpretadora,
 * semanticamente.
 *
 * Por que nao uma coluna `eh_consulta_avaliacao`: ela nunca existiu no
 * banco; antes de 2026-08-08 era `false` hardcoded para todos os
 * procedimentos, logo o fallback que dependia dela sempre foi inalcancavel.
 * Identificar por nome e impossivel -- quatro procedimentos do catalogo
 * casariam ("Consulta pediatrica", "Consulta / Avaliacao",
 * "Consulta / Planejamento", "Consulta ortodontia").
 */
export const CONSULTA_AVALIACAO_ID = 'consultation_evaluation';

/**
 * Regra de contagem de `dentistas_candidatos` (specs/dentista-semantico-v1.md
 * secao 12). Uma regra, quatro entradas.
 *
 * | Entrada | Aqui |
 * |---|---|
 * | `null` (nao mencionou) | segue sem preferencia nova -- vale o que ja estava em `dados` |
 * | um candidato valido | e a preferencia deste turno |
 * | varios validos | pergunta, apresentando SO esses |
 * | `[]` (nenhum corresponde) | pergunta, apresentando os APTOS reais, avisando que nao localizou |
 *
 * Os candidatos NAO sao filtrados por aptidao: filtrar removeria justamente
 * quem o paciente pediu -- o defeito que esta spec eliminou. So a INTEGRIDADE
 * e conferida (existe, e da clinica, esta ativo). O turno seguinte resolve
 * para um e a regra de vinculo (CASO 2) roda normalmente, inclusive a
 * substituicao por avaliacao.
 *
 * Candidatos que nao sobrevivem a integridade simplesmente somem. Se nenhum
 * sobreviver, isso NAO vira "nao localizei" -- vira ausencia de preferencia,
 * mesma disciplina de um `procedimento_id` invalido: e falha de integridade
 * do que a IA devolveu, nao uma afirmacao sobre o que o paciente disse. So o
 * `[]` EXPLICITO significa "mencionou e nenhum corresponde".
 */
function analisarCandidatos(
  clinicaId: string,
  procedimentoId: string,
  candidatos: string[] | null,
  catalogo: CatalogoClinica
): { decisao: DecisaoOrquestrador } | { dentistaId: string | undefined } {
  if (candidatos === null) return { dentistaId: undefined };

  if (candidatos.length > 0) {
    const plausiveis = candidatos
      .map((id) => catalogo.dentistas.find((d) => d.dentista_id === id && d.clinica_id === clinicaId && d.ativo))
      .filter((d) => d !== undefined)
      .map((d) => ({ dentista_id: d.dentista_id, clinica_id: d.clinica_id, nome_exibido: d.nome_exibido }));

    if (plausiveis.length > 1) return { decisao: { tipo: 'aguardando_escolha_dentista', dentistas: plausiveis } };
    if (plausiveis.length === 1) return { dentistaId: plausiveis[0].dentista_id };
    return { dentistaId: undefined }; // nenhum sobreviveu a integridade
  }

  // `[]` EXPLICITO -- o paciente mencionou alguem que nao existe na clinica.
  const aptos = resolverDentista({
    clinica_id: clinicaId,
    procedimento_id: procedimentoId,
    dentistas: catalogo.dentistas,
    vinculos: catalogo.vinculos,
  });
  if (aptos.tipo === 'um_apto') {
    return {
      decisao: {
        tipo: 'aguardando_escolha_dentista',
        dentistas: [aptos.dentista],
        preferencia_nao_localizada: true,
      },
    };
  }
  if (aptos.tipo === 'varios_aptos') {
    return {
      decisao: { tipo: 'aguardando_escolha_dentista', dentistas: aptos.dentistas, preferencia_nao_localizada: true },
    };
  }
  if (aptos.tipo === 'erro_catalogo') return { decisao: { tipo: 'erro_catalogo_dentista', resultado: aptos } };
  return {
    decisao: {
      tipo: 'sem_dentista_disponivel',
      ...(avaliacaoOferecivel(clinicaId, procedimentoId, catalogo) ? { procedimento_oferecido: CONSULTA_AVALIACAO_ID } : {}),
    },
  };
}

type ResolucaoDentistaProcedimento =
  | { decisaoAntecipada: DecisaoOrquestrador }
  | {
      dentistaId: string;
      /** Difere do pedido SOMENTE quando cedeu lugar a Consulta/Avaliacao (caso 2.3). */
      procedimentoIdEfetivo: string;
      substituicao?: { dentista_nome_exibido: string };
    };

/**
 * Resolve o par (dentista, procedimento efetivo) deste turno
 * (specs/dentista-semantico-v1.md secao 5).
 *
 * INTEGRIDADE, NUNCA INTERPRETACAO. Quem entendeu a quem o paciente se
 * referia foi a IA, que devolveu um `dentista_id` canonico escolhido de
 * `dentistas_disponiveis`; aqui o Core so confere existencia, clinica,
 * `ativo` e vinculo. Nao normaliza texto, nao compara nome, nao rele a
 * mensagem.
 *
 * **A preferencia valida PREVALECE** -- quem cede e o procedimento, nunca o
 * profissional escolhido (inversao de prioridade aprovada em 2026-08-09,
 * altera `dentistas-vinculos-v1.md` secao 4). Trocar de dentista em silencio
 * deixou de ser possivel: a recursao `resolverDentistaComFallback`, que
 * fazia exatamente isso, foi REMOVIDA.
 */
function resolverDentistaEProcedimento(
  clinicaId: string,
  procedimentoId: string,
  dentistaIdPedido: string | undefined,
  catalogo: CatalogoClinica
): ResolucaoDentistaProcedimento {
  // Preferencia INVALIDA (ausente, inexistente, de outra clinica ou inativa)
  // colapsa em "sem preferencia" -- mesma disciplina de `procedimento_id`
  // invalido. A IA escolhe de uma lista real, entao isso e integridade, nao
  // conversa: nao ha nuance a transportar ao paciente.
  const preferido =
    typeof dentistaIdPedido === 'string' && dentistaIdPedido.trim() !== ''
      ? (catalogo.dentistas.find((d) => d.dentista_id === dentistaIdPedido && d.clinica_id === clinicaId && d.ativo) ??
        null)
      : null;

  if (preferido === null) return semPreferencia(clinicaId, procedimentoId, catalogo);

  // CASO 2.1 -- o profissional escolhido realiza o procedimento pedido.
  if (temVinculoAtivo(catalogo, clinicaId, preferido.dentista_id, procedimentoId)) {
    return { dentistaId: preferido.dentista_id, procedimentoIdEfetivo: procedimentoId };
  }

  // CASO 2.2 -- o pedido JA era a avaliacao. Nunca oferecer avaliacao de
  // novo: seria ciclo (`dentistas-vinculos-v1.md` secao 12, regra 1).
  if (procedimentoId === CONSULTA_AVALIACAO_ID) {
    return { decisaoAntecipada: { tipo: 'combinacao_indisponivel', dentista_nome_exibido: preferido.nome_exibido } };
  }

  // CASO 2.3 -- o procedimento cede, o profissional fica. Duas conferencias,
  // ambas obrigatorias.
  const avaliacaoAtiva = catalogo.procedimentos.some(
    (p) => p.procedimento_id === CONSULTA_AVALIACAO_ID && p.clinica_id === clinicaId && p.ativo
  );
  if (!avaliacaoAtiva || !temVinculoAtivo(catalogo, clinicaId, preferido.dentista_id, CONSULTA_AVALIACAO_ID)) {
    return { decisaoAntecipada: { tipo: 'combinacao_indisponivel', dentista_nome_exibido: preferido.nome_exibido } };
  }

  return {
    dentistaId: preferido.dentista_id,
    procedimentoIdEfetivo: CONSULTA_AVALIACAO_ID,
    substituicao: { dentista_nome_exibido: preferido.nome_exibido },
  };
}

/** CASO 1: zero/um/varios aptos, exatamente como a secao 5 da spec sempre definiu. */
function semPreferencia(
  clinicaId: string,
  procedimentoId: string,
  catalogo: CatalogoClinica
): ResolucaoDentistaProcedimento {
  const resultado = resolverDentista({
    clinica_id: clinicaId,
    procedimento_id: procedimentoId,
    dentistas: catalogo.dentistas,
    vinculos: catalogo.vinculos,
  });

  switch (resultado.tipo) {
    case 'um_apto':
      return { dentistaId: resultado.dentista.dentista_id, procedimentoIdEfetivo: procedimentoId };
    case 'varios_aptos':
      return { decisaoAntecipada: { tipo: 'aguardando_escolha_dentista', dentistas: resultado.dentistas } };
    case 'erro_catalogo':
      return { decisaoAntecipada: { tipo: 'erro_catalogo_dentista', resultado } };
    case 'nenhum_apto':
      // A resposta oferece Consulta/Avaliacao, e o contexto pendente grava
      // essa oferta para que a aceitacao do turno seguinte seja compreendida
      // (specs/contexto-pendente-interpretacao-v1.md secao 11). Só oferece o
      // que e possivel -- ver `avaliacaoOferecivel`.
      return {
        decisaoAntecipada: {
          tipo: 'sem_dentista_disponivel',
          ...(avaliacaoOferecivel(clinicaId, procedimentoId, catalogo)
            ? { procedimento_oferecido: CONSULTA_AVALIACAO_ID }
            : {}),
        },
      };
  }
}

/**
 * A Consulta/Avaliacao pode de fato ser oferecida como alternativa?
 * (`dentistas-vinculos-v1.md` secao 12, gatilho A.)
 *
 * Tres condicoes, todas obrigatorias. Sem elas a Iris faria uma pergunta que
 * nao tem como cumprir -- e, pior, o paciente que aceitasse cairia em zero
 * aptos para a propria avaliacao, que ofereceria a avaliacao de novo: o ciclo
 * que a regra 1 da mesma secao proibe.
 */
function avaliacaoOferecivel(clinicaId: string, procedimentoId: string, catalogo: CatalogoClinica): boolean {
  // 1. o pedido nao pode ser ja a propria avaliacao (regra 1: nunca oferecer
  //    de novo o que o paciente ja pediu).
  if (procedimentoId === CONSULTA_AVALIACAO_ID) return false;

  // 2. a avaliacao existe e esta ativa nesta clinica.
  const existe = catalogo.procedimentos.some(
    (p) => p.procedimento_id === CONSULTA_AVALIACAO_ID && p.clinica_id === clinicaId && p.ativo
  );
  if (!existe) return false;

  // 3. ha ao menos um dentista apto para ela -- mesma regra de aptidao de
  //    sempre, nunca uma checagem paralela.
  const resultado = resolverDentista({
    clinica_id: clinicaId,
    procedimento_id: CONSULTA_AVALIACAO_ID,
    dentistas: catalogo.dentistas,
    vinculos: catalogo.vinculos,
  });
  return resultado.tipo === 'um_apto' || resultado.tipo === 'varios_aptos';
}

function temVinculoAtivo(
  catalogo: CatalogoClinica,
  clinicaId: string,
  dentistaId: string,
  procedimentoId: string
): boolean {
  return catalogo.vinculos.some(
    (v) =>
      v.clinica_id === clinicaId &&
      v.dentista_id === dentistaId &&
      v.procedimento_id === procedimentoId &&
      v.ativo
  );
}
