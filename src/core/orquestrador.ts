import { identificarConversa } from './identificacao.ts';
import { interpretarEAplicar } from './interpretar-e-aplicar.ts';
import { resolverDentista } from './resolver-dentista.ts';
import { resolverDuracao } from './resolver-duracao.ts';
import { montarFatosTemporais } from './montar-fatos-temporais.ts';
import { resolverTemporal } from './resolver-temporal.ts';
import { carregarEntradaDisponibilidade } from './carregar-disponibilidade.ts';
import { carregarCatalogo } from './carregar-catalogo.ts';
import { reservarAgendamento } from './reservar-agendamento.ts';
import { buscarAgendamentoAtivo } from './buscar-agendamento-ativo.ts';
import { remarcarAgendamento } from './remarcar-agendamento.ts';
import { cancelarAgendamento } from './cancelar-agendamento.ts';
import { persistirPaciente } from './persistir-paciente.ts';
import { trocarTelefonePaciente } from './trocar-telefone-paciente.ts';
import { calcularCadastroFaltante, comporVisaoEfetivaCadastro } from './cadastro-paciente.ts';
import { derivarAcaoContextoHorarios, gravarContextoHorarios } from './contexto-horarios.ts';
import { historicoValidoParaEnvio } from './historico-conversa.ts';
import { aplicarDados } from './aplicar-dados.ts';
import { formatarData } from './gerar-resposta-paciente.ts';
import { ErroRpcTecnico } from './erros.ts';
import { CAMPOS_CADASTRAIS_INTERPRETACAO } from './interpretacao-tipos.ts';
import type { CadastroPaciente, CampoDadosConversa, ClienteBancoDados, ContextoConversa, ContextoHorarios } from './tipos.ts';
import type { ClienteModeloEstruturado, NaturezaMensagem, RespostaTrocaTelefone } from './interpretacao-tipos.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';
import type { InstanteAtual, ModoConsulta, OpcaoHorario } from './disponibilidade-tipos.ts';
import type { ResolucaoTemporalOficial } from './temporal-tipos.ts';
import type { AgendamentoAtivo } from './buscar-agendamento-ativo.ts';
import type {
  CatalogoClinica,
  ContextoSombraCapacidadeV2,
  DecisaoOrquestrador,
  EntradaOrquestrador,
  ResultadoOrquestrador,
} from './orquestrador-tipos.ts';
import type { ResultadoCarregarCatalogo } from './carregar-catalogo.ts';

/**
 * Orquestrador minimo do primeiro fluxo: identificacao -> interpretacao ->
 * resolvedores de dominio ja publicados -> resolucao temporal (fatia minima)
 * -> disponibilidade real -> confirmacao explicita -> reserva
 * (cappia_reservar_agendamento, RPC ja em producao, ver orquestrador-tipos.ts).
 * Ver orquestrador-tipos.ts para o vocabulario temporal exato coberto e o
 * que fica de fora por decisao do Gabriel.
 *
 * Nao gera texto de resposta ao paciente (redacao/NLG e P5, fora de escopo)
 * -- devolve uma decisao estruturada para o chamador formatar. Desde
 * 2026-08-11 tambem cobre REMARCACAO (specs/remarcacao-conversacional-v1.md),
 * roteada por `dados.intencao === 'remarcacao'` -- ver `decidirRemarcacao`.
 * Continua sem tocar cancelamento, consulta completa de agendamento, outbox
 * nem cadastro de paciente novo (ver decisao 'cadastro_necessario').
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

  // REMARCACAO -- construir a lista de agendamentos ativos para a IA
  // correlacionar, SOMENTE quando ha uma escolha pendente do turno anterior
  // (specs/remarcacao-conversacional-v1.md secao 3). Sem marcador, a lista
  // nunca e enviada -- e o proprio ENVIO que sinaliza "ha uma pergunta em
  // aberto" (contrato fechado por medicao 2026-08-11: nao existe um
  // booleano separado, so a lista). Busca SEMPRE fresca -- nunca confia nas
  // descricoes de um turno anterior, mesmo principio ja usado em toda
  // disponibilidade do Core.
  const escolhaAgendamentoPendente = identificacao.conversa.contexto_horarios?.escolha_agendamento_pendente;
  let agendamentosAtivosParaIA: { agendamento_id: string; descricao: string }[] | undefined;
  if (escolhaAgendamentoPendente !== undefined && identificacao.paciente.id !== null) {
    const buscaParaContexto = await buscarAgendamentoAtivo(clienteBanco, {
      clinica_id: identificacao.clinica_id,
      paciente_id: identificacao.paciente.id,
      instante_atual: entrada.instante_atual,
    });
    const candidatos: readonly AgendamentoAtivo[] =
      buscaParaContexto.tipo === 'unico'
        ? [buscaParaContexto.agendamento]
        : buscaParaContexto.tipo === 'multiplos'
          ? buscaParaContexto.agendamentos
          : [];
    // So os que ainda estao na lista OFERECIDA (marcador), na mesma ordem
    // em que foram apresentados -- nunca todos os ativos de agora, mesmo
    // que existam mais (spec secao 3: "a ordem do array e a ordem em que a
    // Iris apresentou as opcoes").
    const descritos = escolhaAgendamentoPendente.agendamento_ids
      .map((id) => candidatos.find((a) => a.agendamento_id === id))
      .filter((a): a is AgendamentoAtivo => a !== undefined)
      .map((a) => ({ agendamento_id: a.agendamento_id, descricao: descreverAgendamentoAtivo(a) }));
    if (descritos.length > 0) agendamentosAtivosParaIA = descritos;
  }

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
    // Pergunta de troca de telefone feita no turno anterior, quando houver
    // (specs/cpf-outro-telefone-v1.md secao 1). E contexto de interpretacao E
    // gate de autorizacao: `interpretarEAplicar` so devolve
    // `resposta_troca_telefone` diferente de `null` quando esta chave chega
    // aqui -- um evento sem pergunta pendente nunca autoriza a troca.
    ...(identificacao.conversa.contexto_horarios?.troca_telefone_pendente !== undefined
      ? { troca_telefone_pendente: identificacao.conversa.contexto_horarios.troca_telefone_pendente }
      : {}),
    // Agendamentos ativos, quando ha escolha de remarcacao pendente
    // (montado acima). AUSENTE quando nao ha escolha pendente ou a lista
    // ficou vazia apos o cruzamento com a busca fresca.
    ...(agendamentosAtivosParaIA !== undefined ? { agendamentos_ativos: agendamentosAtivosParaIA } : {}),
    // Cadastro ja persistido do paciente, quando ele existe e tem algum dado.
    // Serve para a Iris nao pedir de novo o que ja esta na ficha: entra
    // somente na derivacao de `campos_cadastrais_preenchidos` (presenca,
    // nunca valor). Chave AUSENTE quando nao ha nada cadastrado -- nunca `{}`,
    // mesma disciplina das demais chaves opcionais acima.
    ...(Object.keys(identificacao.paciente.cadastro).length > 0
      ? { cadastro_paciente: identificacao.paciente.cadastro }
      : {}),
    // Hoje, para recusar data de nascimento futura na validacao cadastral
    // (specs/cadastro-conversacional-v1.md secao 4). Vem do instante ja
    // injetado -- nem o orquestrador nem a validacao leem relogio.
    data_referencia: entrada.instante_atual.data,
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
  // ETAPA 2 da Arquitetura V2 (docs/07-arquitetura-v2.md secao 10) --
  // EXPERIMENTAL, SOMENTE PARA MEDICAO EM SHADOW MODE.
  //
  // Monta o contexto que o comparador-sombra (index.ts) vai usar -- puramente
  // dados ja calculados neste turno, ZERO chamada de rede, ZERO decisao. Este
  // helper nao pode, por construcao, influenciar `decisao`: e chamado DEPOIS
  // que `decisao` ja chegou em `finalizar`, e seu resultado so e anexado ao
  // objeto de retorno, nunca lido de volta por nenhuma logica deste arquivo.
  function montarContextoSombraV2(
    dadosAtuais: Record<string, string | undefined>,
    contextoHorarios: ContextoHorarios | null,
    catalogo: ResultadoCarregarCatalogo,
    agendamentosDoPaciente: readonly AgendamentoAtivo[] | undefined
  ): ContextoSombraCapacidadeV2 | undefined {
    const nomeProcedimento =
      catalogo.tipo === 'carregado' && typeof dadosAtuais.procedimento_id === 'string'
        ? catalogo.catalogo.procedimentos.find((p) => p.procedimento_id === dadosAtuais.procedimento_id)?.nome_pt
        : undefined;

    const dadosConhecidos: NonNullable<ContextoSombraCapacidadeV2['dados_conhecidos']> = {};
    if (nomeProcedimento !== undefined) dadosConhecidos.procedimento = nomeProcedimento;
    if (typeof dadosAtuais.data_texto === 'string') dadosConhecidos.data = dadosAtuais.data_texto;
    if (typeof dadosAtuais.horario_texto === 'string') dadosConhecidos.horario = dadosAtuais.horario_texto;
    if (typeof dadosAtuais.periodo === 'string') dadosConhecidos.periodo = dadosAtuais.periodo;

    const primeiroAgendamento = agendamentosDoPaciente?.[0];

    const resultado: ContextoSombraCapacidadeV2 = {
      ...(Object.keys(dadosConhecidos).length > 0 ? { dados_conhecidos: dadosConhecidos } : {}),
      ...(contextoHorarios?.horarios !== undefined ? { horarios_oferecidos: contextoHorarios.horarios } : {}),
      ...(primeiroAgendamento !== undefined
        ? {
            agendamento_futuro: {
              data: primeiroAgendamento.data,
              horario: primeiroAgendamento.horario,
              ...(primeiroAgendamento.procedimento !== null ? { procedimento: primeiroAgendamento.procedimento } : {}),
              ...(primeiroAgendamento.dentista_nome !== null
                ? { dentista_nome: primeiroAgendamento.dentista_nome }
                : {}),
            },
          }
        : {}),
    };

    return Object.keys(resultado).length > 0 ? resultado : undefined;
  }

  const finalizar = async (
    decisao: DecisaoOrquestrador,
    substituicao?: { dentista_nome_exibido: string }
  ): Promise<ResultadoOrquestrador> => {
    // PONTO UNICO DE BUSCA, EM TODO TURNO (2026-08-14). Ate aqui os
    // agendamentos do paciente so eram buscados dentro do ramo conversacional,
    // e so chegavam a redatora em 3 das 30 decisoes. Em todas as outras a Iris
    // respondia SEM SABER que o paciente tem consulta marcada -- o fato estava
    // no banco, a uma consulta de distancia, e nao era entregue.
    //
    // Efeito medido em producao (2026-08-13): logo apos agendar, o paciente
    // perguntou "qual o nome do dentista?" e a Iris respondeu que nao tinha
    // essa informacao; noutro turno perguntou de novo qual procedimento ele
    // queria, para um agendamento que ela mesma acabara de criar.
    //
    // A busca fica DEPOIS da decisao de proposito: assim a lista e sempre
    // coerente com o desfecho deste turno (inclui a reserva recem-criada). Era
    // essa a objecao registrada na spec original, e ela deixa de valer aqui.
    let agendamentosDoPaciente: readonly AgendamentoAtivo[] | undefined;
    let erroBuscaAgendamentos: unknown = null;
    try {
      agendamentosDoPaciente = await buscarAgendamentosParaContexto(
        clienteBanco,
        identificacao.clinica_id,
        identificacao.paciente.id,
        entrada.instante_atual
      );
    } catch (erro) {
      erroBuscaAgendamentos = erro;
    }

    // POLITICA DE FALHA, deliberadamente diferente por caminho:
    //
    // - nas tres decisoes conversacionais, onde esta busca JA era obrigatoria,
    //   o erro continua propagando (decisao de 2026-08-12, preservada): "sem
    //   agendamento" e um fato, um erro de banco nao e esse fato;
    // - nos demais turnos, onde a busca e NOVA, o erro e absorvido e a
    //   redatora apenas nao recebe o fato. Propagar ali criaria um modo de
    //   falha que nao existia -- uma reserva bem-sucedida viraria erro para o
    //   paciente por causa de uma consulta auxiliar.
    if (erroBuscaAgendamentos !== null && DECISOES_COM_CONTEXTO_DE_AGENDAMENTO.includes(decisao.tipo)) {
      throw erroBuscaAgendamentos;
    }

    // `desistencia` continua FORA (decisao do Gabriel, 2026-08-12): o paciente
    // esta encerrando, e trazer um agendamento futuro ali reabriria assunto
    // justamente quando ele quis fechar.
    const agendamentosParaRedatora = decisao.tipo === 'desistencia' ? undefined : agendamentosDoPaciente;

    let atualizadoEmParaContexto = atualizadoEmDaDecisao;

    // LIMPEZA DE ESTADO OPERACIONAL AO CONCLUIR (specs/remarcacao-conversacional-v1.md,
    // ciclo de vida, decisao do Gabriel 2026-08-11 -- estendida a reserva_criada
    // em 2026-08-12, mesmo padrao, bug real de producao). Sucesso ou
    // desistencia DENTRO de um fluxo encerram o estado operacional daquele
    // fluxo definitivamente. Sem isso, o turno seguinte sem conteudo novo
    // (ex.: "obrigado" apos reserva_criada) reentraria no mesmo fluxo com os
    // campos velhos, ou continuaria "preso" numa intencao que o paciente ja
    // abandonou.
    const camposParaLimpar = camposParaLimparAoConcluir(decisao, dados);
    if (camposParaLimpar !== null) {
      atualizadoEmParaContexto = await limparCamposDeEstadoConcluido(
        clienteBanco,
        {
          conversa_id: identificacao.conversa.id,
          clinica_id: identificacao.clinica_id,
          telefone_normalizado: entrada.telefone_normalizado,
        },
        camposParaLimpar,
        atualizadoEmParaContexto
      );
    }

    const atualizadoEmFinal = await gravarContextoHorarios(clienteBanco, {
      conversa_id: identificacao.conversa.id,
      clinica_id: identificacao.clinica_id,
      telefone_normalizado: entrada.telefone_normalizado,
      atualizado_em_da_decisao: atualizadoEmParaContexto,
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
      // AUSENTE quando nao ha agendamento futuro -- nunca `[]` (spec secao 3).
      ...(agendamentosParaRedatora !== undefined && agendamentosParaRedatora.length > 0
        ? { agendamentos_do_paciente: agendamentosParaRedatora }
        : {}),
      ...((() => {
        const contextoSombra = montarContextoSombraV2(
          dados,
          identificacao.conversa.contexto_horarios,
          catalogoCarregado,
          agendamentosDoPaciente
        );
        return contextoSombra !== undefined ? { contexto_sombra_v2: contextoSombra } : {};
      })()),
    };
  };

  if (Object.keys(interpretacao.alteracoes_interpretadas).length === 0) {
    const decisaoConversacional = decidirPorNatureza(interpretacao.natureza_mensagem, dados);
    if (decisaoConversacional !== null) {
      // A busca dos agendamentos deixou de morar aqui (2026-08-14): virou
      // ponto unico dentro de `finalizar`, que TODO desfecho atravessa.
      return await finalizar(decisaoConversacional);
    }
  }

  // CANCELAMENTO -- roteado exclusivamente por `dados.intencao === 'cancelamento'`
  // (specs/cancelamento-conversacional-v1.md). Mesma disciplina da remarcacao:
  // NUNCA inferido pela existencia de um agendamento ativo. Quem distingue
  // "cancela isso" (desistir desta conversa) de "cancela minha consulta"
  // (cancelar o que ja existe) e a IA, lendo a frase -- e o contexto que ela
  // ja recebe hoje distingue os dois melhor do que qualquer regra de prompt
  // acrescentada (medicao de 2026-08-11, spec secao 3).
  //
  // ANTES DA CHECAGEM DE CATALOGO, de proposito (revisao independente,
  // 2026-08-11): cancelar NAO depende de catalogo, procedimento, dentista,
  // disponibilidade nem resolucao temporal -- o agendamento ja existe e todos
  // os identificadores saem dele. Uma clinica sem catalogo carregavel
  // impediria o paciente de cancelar o proprio agendamento por um motivo que
  // nao tem relacao nenhuma com a operacao.
  //
  // A remarcacao continua DEPOIS da checagem, porque ela realmente precisa do
  // catalogo (resolverDuracao a partir de `configuracoesDuracao`).
  //
  // `proposta_pendente` vem do contexto lido no INICIO deste turno (antes de
  // qualquer escrita) -- e a condicao 3 da spec secao 4, o que impede um "sim"
  // remanescente de autorizar um cancelamento que ninguem confirmou agora.
  if (dados.intencao === 'cancelamento') {
    const resultadoCancelamento = await decidirCancelamento(
      clienteBanco,
      clienteRpc,
      identificacao.clinica_id,
      identificacao.paciente.id,
      dados,
      entrada.instante_atual,
      identificacao.conversa.contexto_horarios?.proposta_pendente
    );
    return await finalizar(resultadoCancelamento.decisao);
  }

  // Checagem TARDE (ver "carregar cedo, checar tarde" acima): o catalogo ja
  // foi carregado antes da interpretacao, mas so aqui a ausencia dele vira
  // decisao -- depois do early-return conversacional e do cancelamento.
  if (catalogoCarregado.tipo !== 'carregado') {
    return await finalizar({ tipo: 'clinica_sem_catalogo' });
  }

  // REMARCACAO -- roteada exclusivamente por `dados.intencao === 'remarcacao'`
  // (specs/remarcacao-conversacional-v1.md). NUNCA inferida pela existencia
  // de um agendamento ativo: um paciente com consulta marcada que peca outro
  // procedimento esta pedindo um SEGUNDO agendamento, nao remarcando o
  // primeiro -- quem distingue e a IA, lendo a frase.
  if (dados.intencao === 'remarcacao') {
    const resultadoRemarcacao = await decidirRemarcacao(
      clienteBanco,
      clienteRpc,
      identificacao.clinica_id,
      identificacao.paciente.id,
      dados,
      catalogoCarregado.catalogo,
      entrada.instante_atual
    );
    return await finalizar(resultadoRemarcacao.decisao);
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
    interpretacao.dentistas_candidatos,
    identificacao.paciente.cadastro,
    interpretacao.resposta_troca_telefone
  );

  return await finalizar(resultadoDecisao.decisao, resultadoDecisao.substituicao);
}

/**
 * Decisoes conversacionais que recebem os agendamentos futuros do paciente
 * como CONTEXTO (specs/consulta-agendamento-conversacional-v1.md secao 2).
 *
 * `desistencia` sai da MESMA `decidirPorNatureza` e foi DELIBERADAMENTE
 * excluida (decisao do Gabriel, 2026-08-12): o paciente esta encerrando, e
 * mencionar um agendamento futuro ali reabriria assunto justamente quando ele
 * quis fechar. Por isso a lista e explicita, e nao "tudo que `decidirPorNatureza`
 * devolve".
 */
const DECISOES_COM_CONTEXTO_DE_AGENDAMENTO: readonly DecisaoOrquestrador['tipo'][] = [
  'saudacao',
  'duvida_livre',
  'mensagem_nao_compreendida',
];

/**
 * Busca os agendamentos futuros do paciente para servirem de CONTEXTO a
 * redatora. Nunca decide nada, nunca escreve, nunca altera a decisao ja
 * tomada -- so disponibiliza fato.
 *
 * Devolve `undefined` (nunca `[]`) quando nao ha o que informar: decisao fora
 * da lista, paciente sem ficha, ou nenhum agendamento futuro. A disciplina
 * "ausente, nunca vazio" ja e canonica no Core.
 *
 * FALHA DE BANCO NAO E ENGOLIDA (revisao independente, 2026-08-12): esta
 * funcao NAO tem try/catch proprio. Um erro de `buscarAgendamentoAtivo`
 * propaga normalmente, pelo mesmo caminho tecnico ja existente para qualquer
 * outra falha de leitura no orquestrador (`decidirRemarcacao`,
 * `decidirCancelamento` tampouco engolem). "Sem agendamento" e um FATO ("o
 * paciente nao tem nenhum"); um erro de banco nao e esse fato, e nunca deveria
 * virar silenciosamente a mesma coisa.
 */
async function buscarAgendamentosParaContexto(
  clienteBanco: ClienteBancoDados,
  clinicaId: string,
  pacienteId: string | null,
  instanteAtual: InstanteAtual
): Promise<readonly AgendamentoAtivo[] | undefined> {
  // Paciente sem ficha nao tem agendamento por definicao -- sem consulta ao
  // banco (spec secao 3).
  if (pacienteId === null) return undefined;

  const busca = await buscarAgendamentoAtivo(clienteBanco, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    instante_atual: instanteAtual,
  });
  if (busca.tipo === 'unico') return [busca.agendamento];
  if (busca.tipo === 'multiplos') return busca.agendamentos;
  return undefined;
}

/**
 * Intencoes cujo fluxo opera sobre um agendamento JA EXISTENTE e por isso
 * precisa de um ponto de saida explicito (specs/remarcacao-conversacional-v1.md
 * e specs/cancelamento-conversacional-v1.md secao 1, ciclo de vida).
 */
const INTENCOES_SOBRE_AGENDAMENTO_EXISTENTE: readonly string[] = ['remarcacao', 'cancelamento'];

/**
 * Campos de preenchimento do NOVO agendamento (specs/novo-agendamento.md) --
 * tudo que `decidir()` le de `dados` para resolver procedimento, dentista,
 * data/horario e confirmacao. Lista propria, separada de
 * `intencao`+`agendamento_id` (remarcacao/cancelamento): sao os dois conjuntos
 * de campos que os dois fluxos acumulam, nunca a mesma coisa.
 */
const CAMPOS_NOVO_AGENDAMENTO: readonly CampoDadosConversa[] = [
  'intencao',
  'procedimento_id',
  'dentista_id',
  'data_texto',
  'periodo',
  'horario_texto',
  'confirmacao',
];

/**
 * Decisao conversacional (fora de `decidir`/`decidirRemarcacao`/
 * `decidirCancelamento`): toda decisao que ENCERRA um fluxo operacional --
 * reserva criada, remarcacao criada, cancelamento criado, ou desistencia
 * DENTRO de um fluxo sobre agendamento existente -- precisa fechar o estado
 * operacional que levou ate ali, para a proxima mensagem sem conteudo novo
 * (ex.: "obrigado") nunca reentrar no mesmo fluxo com dados velhos. Cada
 * desfecho limpa exatamente os campos que ELE acumulou -- nunca os dois
 * conjuntos ao mesmo tempo, nunca um campo do outro fluxo. A checagem de
 * `dados.intencao` na desistencia garante que uma negacao qualquer, sem
 * relacao com remarcacao/cancelamento, nunca dispara aquela limpeza.
 */
function camposParaLimparAoConcluir(
  decisao: DecisaoOrquestrador,
  dados: Record<string, string | undefined>
): readonly CampoDadosConversa[] | null {
  if (decisao.tipo === 'reserva_criada') return CAMPOS_NOVO_AGENDAMENTO;
  if (decisao.tipo === 'remarcacao_criada' || decisao.tipo === 'cancelamento_criado') {
    return ['intencao', 'agendamento_id'];
  }
  if (
    decisao.tipo === 'desistencia' &&
    typeof dados.intencao === 'string' &&
    INTENCOES_SOBRE_AGENDAMENTO_EXISTENTE.includes(dados.intencao)
  ) {
    return ['intencao', 'agendamento_id'];
  }
  return null;
}

/**
 * Segunda escrita do turno, SOMENTE quando `camposParaLimparAoConcluir`
 * devolve uma lista. `aplicarDados` faz sua propria leitura+CAS internamente
 * (nunca usa `atualizadoEmAtual` como base) -- o parametro serve so para o
 * caso de falha, abaixo.
 *
 * BEST-EFFORT, NUNCA LANCA (mesmo padrao de `gravarContextoHorarios`): um
 * fluxo ja concluido com sucesso (ou uma desistencia ja aceita) nunca pode
 * virar erro tecnico para o paciente so porque esta limpeza auxiliar falhou.
 * Pior caso de falha: o turno seguinte reencontra os campos antigos (ex.:
 * `procedimento_id`/`data_texto`/`horario_texto` do agendamento ja
 * reservado, ou `intencao='remarcacao'` com o agendamento antigo, ja
 * 'remarcado' e portanto fora da busca de ativos) e reprocessa/recomeca a
 * pergunta -- nunca um risco de escrita duplicada, porque `confirmacao`
 * sempre exige uma nova proposta pendente para autorizar de novo
 * (interpretar-e-aplicar.ts).
 */
async function limparCamposDeEstadoConcluido(
  clienteBanco: ClienteBancoDados,
  contexto: ContextoConversa,
  campos: readonly CampoDadosConversa[],
  atualizadoEmAtual: string
): Promise<string> {
  try {
    const alteracoes = Object.fromEntries(campos.map((campo) => [campo, { acao: 'remover' as const }]));
    const resultado = await aplicarDados(clienteBanco, { ...contexto, alteracoes });
    return resultado.atualizado_em;
  } catch {
    return atualizadoEmAtual;
  }
}

// Nomes do dia da semana civil, na mesma convencao (0=segunda..6=domingo) ja
// usada por resolver-temporal.ts (diaDaSemana) e carregar-disponibilidade.ts
// (diaDaSemanaLocal). Usado SOMENTE para redigir a descricao abaixo -- nunca
// para calcular disponibilidade, nunca para resolver data.
const NOMES_DIA_SEMANA = [
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
  'domingo',
] as const;

// Algoritmo de Howard Hinnant (days_from_civil), REIMPLEMENTADO aqui pelo
// mesmo motivo ja documentado em carregar-disponibilidade.ts: este arquivo
// nao pode alterar resolver-temporal.ts nem carregar-disponibilidade.ts so
// para exportar 12 linhas de aritmetica de calendario pura.
//
// Contrato fechado por medicao (specs/remarcacao-conversacional-v1.md, secao
// 3, medicao de 2026-08-11): a IA NUNCA calcula o dia da semana -- so casa
// texto ja pronto. Sem o dia da semana calculado aqui, "o de sexta" chegou a
// ESCOLHER O AGENDAMENTO ERRADO (a IA inferindo mal a partir da data); com
// ele, 10/10 em duas rodadas identicas contra a IA real.
function diaDaSemanaCivil(data: string): string | null {
  const partes = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(data);
  if (!partes) return null;
  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);

  const y = mes <= 2 ? ano - 1 : ano;
  const era = Math.floor(y / 400);
  const anoDaEra = y - era * 400;
  const diaDoAno = Math.floor((153 * (mes + (mes > 2 ? -3 : 9)) + 2) / 5) + dia - 1;
  const diaDaEra = anoDaEra * 365 + Math.floor(anoDaEra / 4) - Math.floor(anoDaEra / 100) + diaDoAno;
  const dias = era * 146097 + diaDaEra - 719468;
  const indice = (((dias + 3) % 7) + 7) % 7;
  return NOMES_DIA_SEMANA[indice] ?? null;
}

// Texto que a IA LE para correlacionar semanticamente qual agendamento o
// paciente quer remarcar (specs/remarcacao-conversacional-v1.md secao 3).
// Mesma formatacao de data que o paciente ja ve nas demais respostas
// (formatarData) -- `horario` de AgendamentoAtivo ja vem em HH:MM, sem
// necessidade de conversao. Dia da semana calculado deterministicamente pelo
// Core (nunca pela IA) -- contrato fechado por medicao, ver diaDaSemanaCivil.
//
// Data malformada (nunca deveria ocorrer -- AgendamentoAtivo.data ja vem
// validada por buscar-agendamento-ativo.ts) faz `diaDaSemanaCivil` devolver
// `null`; a descricao cai para o formato antigo, sem dia da semana, em vez
// de lancar ou inventar um dia.
function descreverAgendamentoAtivo(agendamento: AgendamentoAtivo): string {
  const procedimento = agendamento.procedimento ?? agendamento.procedimento_id ?? 'atendimento';
  const dentista = agendamento.dentista_nome ?? 'profissional';
  const dataFormatada = formatarData(agendamento.data);
  const diaSemana = diaDaSemanaCivil(agendamento.data);
  const dataComDia = diaSemana !== null ? `${diaSemana}, ${dataFormatada}` : dataFormatada;
  return `${procedimento} com ${dentista} — ${dataComDia} às ${agendamento.horario}`;
}

/**
 * Fluxo de remarcacao (specs/remarcacao-conversacional-v1.md). Reutiliza
 * INTEGRALMENTE data_texto/periodo/horario_texto -> resolverTemporal ->
 * carregarEntradaDisponibilidade (nenhum dos tres e alterado) e a RPC
 * `cappia_remarcar_agendamento_v2` ja aplicada nos dois bancos. Nunca
 * resolve dentista nem procedimento -- ambos vem do agendamento ja
 * localizado, nunca re-perguntados: remarcacao v1 mantem procedimento e
 * profissional.
 */
async function decidirRemarcacao(
  clienteBanco: ClienteBancoDados,
  clienteRpc: ClienteRpc,
  clinicaId: string,
  pacienteId: string | null,
  dados: Record<string, string | undefined>,
  catalogo: CatalogoClinica,
  instanteAtual: InstanteAtual
): Promise<{ decisao: DecisaoOrquestrador }> {
  // Paciente sem ficha nao tem agendamento por definicao -- esta v1 nao
  // oferece cadastro no fluxo de remarcacao (spec secao 2).
  if (pacienteId === null) {
    return { decisao: { tipo: 'sem_agendamento_para_remarcar' } };
  }

  const busca = await buscarAgendamentoAtivo(clienteBanco, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    instante_atual: instanteAtual,
  });

  let agendamentoEscolhido: AgendamentoAtivo;
  switch (busca.tipo) {
    case 'nenhum':
      return { decisao: { tipo: 'sem_agendamento_para_remarcar' } };
    case 'unico':
      // Unico agendamento: segue direto, sem anunciar informacao redundante
      // -- mesma regra canonica ja vigente para dentista unico apto
      // (04-decisoes-canonicas.md).
      agendamentoEscolhido = busca.agendamento;
      break;
    case 'multiplos': {
      // So avanca se `agendamento_id` (ja validado contra a lista OFERECIDA
      // por interpretar-e-aplicar.ts) casar com um dos agendamentos
      // REALMENTE ativos agora. ID ausente ou que nao casa mais (corrida:
      // remarcado por outra via entre a pergunta e a resposta) nunca
      // adivinha -- mantem a pergunta, com a lista atual.
      const escolhido = busca.agendamentos.find((a) => a.agendamento_id === dados.agendamento_id);
      if (escolhido === undefined) {
        return { decisao: { tipo: 'aguardando_escolha_agendamento', agendamentos: busca.agendamentos } };
      }
      agendamentoEscolhido = escolhido;
      break;
    }
  }

  // Linha sem dentista_id/procedimento_id (colunas nulaveis no operacional)
  // nao tem o que remarcar para o mesmo profissional/procedimento -- falha
  // tecnica real, nunca conversacional (nenhum dos dois campos e
  // re-perguntado nesta v1).
  const { dentista_id: dentistaId, procedimento_id: procedimentoId } = agendamentoEscolhido;
  if (dentistaId === null || procedimentoId === null) {
    return { decisao: { tipo: 'reserva_falhou', motivo: 'agendamento_nao_encontrado' } };
  }

  const resultadoDuracao = resolverDuracao({
    clinica_id: clinicaId,
    procedimento_id: procedimentoId,
    configuracoes: catalogo.configuracoesDuracao,
  });
  if (resultadoDuracao.tipo === 'nao_configurada') return { decisao: { tipo: 'duracao_nao_configurada' } };
  if (resultadoDuracao.tipo !== 'resolvida') {
    return { decisao: { tipo: 'erro_configuracao_duracao', resultado: resultadoDuracao } };
  }

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
    return { decisao: { tipo: 'aguardando_data_horario', resultado: resultadoTemporal } };
  }

  const carregado = await carregarEntradaDisponibilidade(clienteBanco, {
    clinica_id: clinicaId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: resultadoTemporal.data,
    instante_atual: instanteAtual,
    modo: derivarModoConsulta(resultadoTemporal),
  });

  switch (carregado.tipo) {
    case 'carregado':
      if (carregado.resultado.tipo === 'horario_exato_disponivel') {
        return {
          decisao: await decidirConfirmacaoOuExecutarRemarcacao(
            clienteRpc,
            clinicaId,
            pacienteId,
            agendamentoEscolhido,
            procedimentoId,
            dentistaId,
            resultadoDuracao.duracao_min,
            carregado.resultado.opcao,
            dados.confirmacao
          ),
        };
      }
      return {
        decisao: {
          tipo: 'horarios_disponiveis',
          procedimento_id: procedimentoId,
          dentista_id: dentistaId,
          duracao_min: resultadoDuracao.duracao_min,
          resultado: carregado.resultado,
        },
      };
    case 'clinica_nao_encontrada':
      return {
        decisao: { tipo: 'aguardando_data_horario', resultado: { tipo: 'erro_configuracao', motivo: 'fuso_ausente' } },
      };
    case 'dentista_nao_encontrado':
      return { decisao: { tipo: 'sem_dentista_disponivel' } };
    case 'duracao_nao_resolvida':
      return {
        decisao:
          carregado.resultado.tipo === 'nao_configurada'
            ? { tipo: 'duracao_nao_configurada' }
            : { tipo: 'erro_configuracao_duracao', resultado: carregado.resultado },
      };
  }
}

/**
 * Ultimo passo do fluxo de remarcacao: pede confirmacao explicita, ou
 * executa `cappia_remarcar_agendamento_v2` (RPC pronta,
 * remarcacao-operacional-v1.md) com os identificadores JA resolvidos --
 * nunca re-resolve dentista, procedimento, duracao ou disponibilidade
 * dentro da RPC.
 */
async function decidirConfirmacaoOuExecutarRemarcacao(
  clienteRpc: ClienteRpc,
  clinicaId: string,
  pacienteId: string,
  agendamentoAtual: AgendamentoAtivo,
  procedimentoId: string,
  dentistaId: string,
  duracaoMin: number,
  opcao: OpcaoHorario,
  confirmacao: string | undefined
): Promise<DecisaoOrquestrador> {
  // Regra absoluta, identica ao novo agendamento: nunca remarcar sem
  // confirmacao explicita ('sim', vocabulario fechado ja validado por
  // aplicar-dados.ts).
  if (confirmacao !== 'sim') {
    return {
      tipo: 'aguardando_confirmacao_remarcacao',
      agendamento_atual: agendamentoAtual,
      procedimento_id: procedimentoId,
      dentista_id: dentistaId,
      opcao,
    };
  }

  const resultado = await remarcarAgendamento(clienteRpc, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    agendamento_id: agendamentoAtual.agendamento_id,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    duracao_min: duracaoMin,
    nova_data: opcao.data,
    novo_horario: minutosParaHHMM(opcao.inicio_min),
  });

  if (resultado.tipo === 'remarcado') {
    return {
      tipo: 'remarcacao_criada',
      agendamento_id: resultado.agendamento_id,
      agendamento_id_antigo: resultado.agendamento_id_antigo,
      dentista_id: resultado.dentista_id,
      procedimento_id: procedimentoId,
      duracao_min: resultado.duracao_min,
      data: resultado.data,
      horario: resultado.horario,
    };
  }

  // horario_ocupado: a trava real da RPC (mesmo lock/conflito de
  // cappia_reservar_agendamento) recusou por sobreposicao -- reusa
  // reserva_conflito, mesmo desfecho para o paciente (spec secao 6).
  if (resultado.motivo === 'horario_ocupado') {
    return { tipo: 'reserva_conflito' };
  }
  return { tipo: 'reserva_falhou', motivo: resultado.motivo };
}

/**
 * Fluxo de cancelamento (specs/cancelamento-conversacional-v1.md).
 *
 * MENOR que `decidirRemarcacao` por construcao, nao por omissao: cancelar nao
 * tem DESTINO. Nao resolve temporal, nao consulta disponibilidade, nao calcula
 * duracao, nao resolve dentista nem procedimento -- todos vem do agendamento
 * ja localizado, e nenhum deles muda.
 */
async function decidirCancelamento(
  clienteBanco: ClienteBancoDados,
  clienteRpc: ClienteRpc,
  clinicaId: string,
  pacienteId: string | null,
  dados: Record<string, string | undefined>,
  instanteAtual: InstanteAtual,
  propostaPendente: { data: string; horario: string } | undefined
): Promise<{ decisao: DecisaoOrquestrador }> {
  // Paciente sem ficha nao tem agendamento por definicao -- esta v1 nao
  // oferece cadastro no fluxo de cancelamento (spec secao 2), mesma decisao
  // ja vigente para remarcacao.
  if (pacienteId === null) {
    return { decisao: { tipo: 'sem_agendamento_para_cancelar' } };
  }

  const busca = await buscarAgendamentoAtivo(clienteBanco, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    instante_atual: instanteAtual,
  });

  let agendamentoEscolhido: AgendamentoAtivo;
  switch (busca.tipo) {
    case 'nenhum':
      return { decisao: { tipo: 'sem_agendamento_para_cancelar' } };
    case 'unico':
      // Unico agendamento: segue direto para a confirmacao. "Segue direto"
      // NUNCA significa cancelar direto -- a pergunta de confirmacao abaixo e
      // obrigatoria em todos os caminhos (spec secao 4).
      agendamentoEscolhido = busca.agendamento;
      break;
    case 'multiplos': {
      // So avanca se `agendamento_id` (ja validado contra a lista OFERECIDA
      // por interpretar-e-aplicar.ts) casar com um dos agendamentos REALMENTE
      // ativos agora. ID ausente ou que nao casa mais nunca adivinha --
      // mantem a pergunta, com a lista atual.
      const escolhido = busca.agendamentos.find((a) => a.agendamento_id === dados.agendamento_id);
      if (escolhido === undefined) {
        return {
          decisao: { tipo: 'aguardando_escolha_agendamento_cancelamento', agendamentos: busca.agendamentos },
        };
      }
      agendamentoEscolhido = escolhido;
      break;
    }
  }

  // PROTECAO CENTRAL (spec secao 4): `intencao = cancelamento` NUNCA, por si
  // so, executa. As tres condicoes sao exigidas juntas -- ver
  // `confirmacaoAutorizaCancelamento`.
  const jaPerguntado = propostaCorrespondeAoAgendamento(propostaPendente, agendamentoEscolhido);
  if (dados.confirmacao !== 'sim' || !jaPerguntado) {
    // CONFIRMACAO QUE NAO FICOU CLARA: a pergunta ja tinha sido feita para
    // ESTE agendamento e a resposta nao autorizou. Nao encerrou o fluxo por
    // nenhum caminho existente tambem -- negacao (`desistencia`) e duvida
    // (`duvida_livre`) saem antes, em `decidirPorNatureza`, e nunca chegam
    // aqui. Entao so resta um caso: o paciente respondeu algo que a IA nao
    // leu como concordancia. A Iris pede esclarecimento em vez de repetir.
    //
    // Sem o marcador (primeira pergunta do fluxo), o campo fica AUSENTE --
    // nunca `false`, mesma disciplina das demais chaves opcionais do Core.
    return {
      decisao: {
        tipo: 'aguardando_confirmacao_cancelamento',
        agendamento: agendamentoEscolhido,
        ...(jaPerguntado ? { confirmacao_nao_compreendida: true as const } : {}),
      },
    };
  }

  const resultado = await cancelarAgendamento(clienteRpc, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    agendamento_id: agendamentoEscolhido.agendamento_id,
  });

  if (resultado.tipo === 'cancelado') {
    // `ja_cancelado: true` (replay) e sucesso normal, sem texto proprio -- o
    // desfecho para o paciente e o mesmo, e verdadeiro (spec secao 7).
    // Os dados descritivos vem do agendamento localizado, nunca da RPC: ela
    // devolve so o identificador.
    return {
      decisao: {
        tipo: 'cancelamento_criado',
        agendamento_id: resultado.agendamento_id,
        procedimento_id: agendamentoEscolhido.procedimento_id,
        dentista_id: agendamentoEscolhido.dentista_id,
        data: agendamentoEscolhido.data,
        horario: agendamentoEscolhido.horario,
      },
    };
  }

  // Os tres motivos colapsam na frase tecnica generica ja existente (spec
  // secao 7) -- nenhuma decisao nova so para dizer a mesma coisa.
  return { decisao: { tipo: 'reserva_falhou', motivo: resultado.motivo } };
}

/**
 * As TRES condicoes da spec secao 4, exigidas juntas e verificadas no mesmo
 * turno. Nenhuma delas autoriza sozinha.
 *
 * 1. `confirmacao === 'sim'` -- o valor CANONICO INTERNO do campo, produzido
 *    pela IA depois de uma leitura SEMANTICA da mensagem. Nao existe, aqui nem
 *    em lugar nenhum do Core, comparacao com a palavra "sim" digitada pelo
 *    paciente: "pode", "ok", "isso", "beleza", "pode cancelar" chegam todas
 *    como `confirmacao = 'sim'`, pela regra de concordancia sem repertorio
 *    fechado que ja rege reserva e remarcacao (interpretacao-instrucoes.ts,
 *    inalterada por esta spec). Nenhum parser lexical, nenhum enum de frases.
 * 2. existe `proposta_pendente` -- houve de fato uma pergunta concreta em
 *    aberto no INICIO deste turno.
 * 3. essa proposta corresponde EXATAMENTE ao agendamento que esta prestes a
 *    ser cancelado.
 *
 * A condicao 3 e o que fecha o buraco que a reutilizacao de `proposta_pendente`
 * abriria. `confirmacao` e persistido em `dados` e sobrevive a turnos em que
 * deixou de fazer sentido -- por exemplo, quando a RPC falhou por corrida e
 * `intencao` continuou 'cancelamento' (entao a limpeza-na-entrada de
 * interpretar-e-aplicar.ts nao dispara, porque nao ha transicao). Sem esta
 * checagem, aquele "sim" velho autorizaria um cancelamento que ninguem
 * confirmou AGORA.
 *
 * Comparacao por igualdade estrita dos dois campos: os dois lados vem da MESMA
 * origem (a busca fresca de `buscarAgendamentoAtivo` a cada turno, sobre a
 * mesma linha do banco), entao sao identicos por construcao enquanto a linha
 * nao muda. Se ela mudou, a comparacao falha e o Core re-pergunta -- que e
 * exatamente o desfecho desejado.
 */
function confirmacaoAutorizaCancelamento(
  confirmacao: string | undefined,
  propostaPendente: { data: string; horario: string } | undefined,
  agendamento: AgendamentoAtivo
): boolean {
  if (confirmacao !== 'sim') return false;
  return propostaCorrespondeAoAgendamento(propostaPendente, agendamento);
}

/**
 * A pergunta de confirmacao JA foi feita, e foi sobre ESTE agendamento?
 *
 * Isola a condicao 3 acima, porque ela tem DOIS leitores com finalidades
 * diferentes e nao pode divergir entre eles:
 *
 * - `confirmacaoAutorizaCancelamento` (acima) -- junto com `confirmacao='sim'`,
 *   AUTORIZA a execucao;
 * - `decidirCancelamento` -- sozinha, e o que distingue "primeira pergunta"
 *   de "ja perguntei e a resposta nao ficou clara"
 *   (`confirmacao_nao_compreendida`).
 *
 * Igualdade estrita dos dois campos: os dois lados vem da MESMA origem (a
 * busca fresca a cada turno, sobre a mesma linha do banco), entao sao
 * identicos por construcao enquanto a linha nao muda.
 */
function propostaCorrespondeAoAgendamento(
  propostaPendente: { data: string; horario: string } | undefined,
  agendamento: AgendamentoAtivo
): boolean {
  if (propostaPendente === undefined) return false;
  return propostaPendente.data === agendamento.data && propostaPendente.horario === agendamento.horario;
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
  dentistasCandidatos: string[] | null,
  cadastroFicha: CadastroPaciente,
  respostaTrocaTelefone: RespostaTrocaTelefone | null
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
            nomeProcedimentoEfetivo(procedimentoIdEfetivo, catalogo),
            resolucaoDentista.dentistaId,
            resultadoDuracao.duracao_min,
            carregado.resultado.opcao,
            dados.confirmacao,
            cadastroFicha,
            comporVisaoEfetivaCadastro(cadastroFicha, dados),
            catalogo.exigirEmail,
            respostaTrocaTelefone
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
/**
 * A conversa trouxe algo que a ficha ainda nao tem (ou tem diferente)?
 *
 * Evita escrita inutil: paciente existente, completo e sem nada novo nesta
 * conversa nao precisa de UPDATE nenhum -- o `paciente_id` da identificacao
 * segue direto para a reserva (specs/cadastro-conversacional-v1.md secao 6).
 */
function cadastroDivergeDaFicha(visaoEfetiva: CadastroPaciente, ficha: CadastroPaciente): boolean {
  return CAMPOS_CADASTRAIS_INTERPRETACAO.some((campo) => visaoEfetiva[campo] !== ficha[campo]);
}

async function decidirConfirmacaoOuReserva(
  clienteRpc: ClienteRpc,
  clinicaId: string,
  pacienteId: string | null,
  telefoneNormalizado: string,
  procedimentoId: string,
  procedimentoNome: string,
  dentistaId: string,
  duracaoMin: number,
  opcao: OpcaoHorario,
  confirmacao: string | undefined,
  cadastroFicha: CadastroPaciente,
  visaoEfetiva: CadastroPaciente,
  exigirEmail: boolean,
  respostaTrocaTelefone: RespostaTrocaTelefone | null
): Promise<DecisaoOrquestrador> {
  // Regra absoluta: nunca reservar sem confirmacao explicita ('sim',
  // vocabulario fechado ja validado por aplicar-dados.ts). Ausencia ou
  // qualquer outro valor -- nunca tratado como confirmacao implicita.
  if (confirmacao !== 'sim') {
    return { tipo: 'aguardando_confirmacao', procedimento_id: procedimentoId, dentista_id: dentistaId, opcao };
  }

  // CADASTRO -- depois da confirmacao do horario, nunca antes
  // (specs/cadastro-conversacional-v1.md secao 1; novo-agendamento.md secao 12).
  //
  // O gatilho e "falta dado", nao "nao ha paciente": um paciente existente com
  // cadastro incompleto tambem para aqui, e um paciente existente e completo
  // nunca e interrompido.
  const faltantes = calcularCadastroFaltante(visaoEfetiva, exigirEmail);
  if (faltantes.length > 0) {
    return { tipo: 'cadastro_necessario', campos_faltantes: faltantes };
  }

  // RESPOSTA A PERGUNTA DE TROCA DE TELEFONE (specs/cpf-outro-telefone-v1.md).
  // Vem ANTES de `persistirPaciente` porque, com a resposta na mao, nao ha o
  // que tentar persistir: o paciente ja existe, e a unica escrita autorizada e
  // a troca do telefone.
  //
  // `respostaTrocaTelefone` so e diferente de `null` quando o MARCADOR oficial
  // estava presente (gate em interpretar-e-aplicar.ts). Um evento sem pergunta
  // pendente nunca chega ate aqui.
  //
  // Limitacao conhecida e aceita: se o horario tiver sido ocupado entre a
  // pergunta e a resposta, o fluxo nem alcanca esta funcao (volta a apresentar
  // horarios) e a resposta se perde junto com a pergunta. Ela deixa de fazer
  // sentido nesse cenario -- nao ha mais agendamento a destravar.
  if (respostaTrocaTelefone === 'nao') {
    // REVOGACAO EXPLICITA de persistencia-v1.md secao 6 ("a recusa permitia
    // que o agendamento continuasse normalmente"): sem a troca, nao existe
    // associacao segura entre ESTE telefone e aquela ficha, e agendar assim
    // gravaria um atendimento para um paciente cuja identidade nao foi
    // estabelecida por nenhum meio confirmado. Nenhuma escrita acontece.
    return { tipo: 'troca_telefone_recusada' };
  }

  if (respostaTrocaTelefone === 'sim') {
    // `cpf` esta necessariamente presente: `calcularCadastroFaltante` acabou
    // de garantir que nenhum obrigatorio falta, e o CPF e obrigatorio sempre.
    const troca = await trocarTelefonePaciente(clienteRpc, {
      clinica_id: clinicaId,
      cpf: visaoEfetiva.cpf as string,
      telefone_normalizado: telefoneNormalizado,
    });

    if (troca.tipo !== 'trocado') {
      // `telefone_de_outro_paciente` (persistencia-v1.md secao 7, detectada e
      // nao resolvida) e `cpf_nao_encontrado` (corrida real) terminam no MESMO
      // desfecho: encaminhar a recepcao. Distingui-los no texto exporia a
      // situacao de uma ficha alheia, e para o paciente a saida e a mesma.
      return { tipo: 'cpf_ja_cadastrado' };
    }

    // Encadeamento direto ate a reserva, no mesmo processamento: nao existe
    // decisao humana pendente entre trocar o telefone e reservar, pelo mesmo
    // motivo que nao existe `cadastro_concluido`. `persistirPaciente` NAO e
    // chamada aqui -- o paciente ja existe e a unica escrita autorizada por
    // esta spec ja aconteceu.
    return await reservar(clienteRpc, {
      clinicaId,
      procedimentoId,
      procedimentoNome,
      dentistaId,
      pacienteId: troca.paciente_id,
      opcao,
      telefoneNormalizado,
      visaoEfetiva,
    });
  }

  // Cadastro completo: garantir paciente_id antes da reserva. Persistir
  // somente quando ha o que persistir -- paciente novo, ou paciente existente
  // cujo cadastro esta diferente do que a conversa ja sabe. Paciente existente,
  // completo e sem nada novo segue direto, sem escrita nenhuma.
  let pacienteIdParaReserva: string;
  if (pacienteId === null || cadastroDivergeDaFicha(visaoEfetiva, cadastroFicha)) {
    const persistencia = await persistirPaciente(clienteRpc, {
      clinica_id: clinicaId,
      telefone_normalizado: telefoneNormalizado,
      // Sempre presente: `calcularCadastroFaltante` acabou de garantir que
      // nenhum obrigatorio falta, e `nome` e obrigatorio em toda chamada.
      nome: visaoEfetiva.nome as string,
      ...(visaoEfetiva.cpf !== undefined ? { cpf: visaoEfetiva.cpf } : {}),
      ...(visaoEfetiva.data_nascimento !== undefined ? { data_nascimento: visaoEfetiva.data_nascimento } : {}),
      ...(visaoEfetiva.email !== undefined ? { email: visaoEfetiva.email } : {}),
    });

    if (persistencia.tipo === 'cpf_ja_cadastrado') {
      // Ate 2026-08-10 isto PARAVA a conversa. Agora PERGUNTA
      // (specs/cpf-outro-telefone-v1.md secao 3): nao duplica, nao atualiza
      // telefone nenhum ainda, nao investiga de quem e o CPF -- so declara a
      // pergunta pendente, que o marcador do contexto grava no fim do turno.
      //
      // Re-derivado a cada turno em que o paciente nao responde, exatamente
      // como a oferta de procedimento. Isso tem um beneficio real: se a
      // recepcao corrigir a ficha no painel enquanto a pergunta esta aberta, o
      // turno seguinte simplesmente persiste e segue, sem estado preso.
      return { tipo: 'troca_telefone_pendente' };
    }
    if (persistencia.tipo === 'falhou') {
      // INVARIANTE DO CORE VIOLADA (spec secao 9): clinica_id_ausente,
      // telefone_normalizado_ausente e nome_ausente sao inalcancaveis se o
      // fluxo estiver correto -- chegar aqui e bug interno, nao situacao do
      // paciente. Falha fechado pelo mecanismo tecnico ja existente, em vez
      // de virar decisao conversacional ou de seguir para a reserva com
      // estado inconsistente.
      throw new ErroRpcTecnico('cappia_persistir_paciente', `invariante_violada:${persistencia.motivo}`);
    }

    pacienteIdParaReserva = persistencia.paciente_id;
  } else {
    // Ramo alcancado somente quando `pacienteId` nao e nulo (a condicao acima
    // ja o teria capturado) -- paciente existente, completo e sem nada novo.
    pacienteIdParaReserva = pacienteId;
  }

  // Encadeamento direto: nao ha decisao humana pendente entre cadastrar e
  // reservar, entao o mesmo processamento continua.
  return await reservar(clienteRpc, {
    clinicaId,
    procedimentoId,
    procedimentoNome,
    dentistaId,
    pacienteId: pacienteIdParaReserva,
    opcao,
    visaoEfetiva,
    telefoneNormalizado,
  });
}

/**
 * Ultimo passo do caminho feliz, extraido em 2026-08-10 porque passou a ter
 * DOIS chamadores: o cadastro normal e a troca de telefone aceita
 * (specs/cpf-outro-telefone-v1.md secao 6). Nenhuma regra foi alterada na
 * extracao -- os tres desfechos sao exatamente os de antes.
 *
 * Recebe o `paciente_id` ja resolvido; nunca decide qual e nem persiste
 * paciente.
 */
/**
 * Nome de exibicao do procedimento que sera REALMENTE reservado, para gravar
 * na coluna `agendamentos.procedimento`.
 *
 * Recebe o `procedimento_id` EFETIVO, nunca o pedido original: quando o Core
 * substitui o procedimento por Consulta/Avaliacao para preservar o dentista
 * escolhido (specs/dentista-semantico-v1.md), e a avaliacao que fica agendada
 * -- gravar o nome do pedido original seria registrar um atendimento que nao
 * vai acontecer.
 *
 * O `find` nao tem ramo de ausencia porque o id efetivo acabou de ser resolvido
 * contra este mesmo catalogo em `decidir`. Se ainda assim vier vazio,
 * `validarEntrada` do adaptador falha fechado -- nunca grava linha incompleta.
 */
function nomeProcedimentoEfetivo(procedimentoId: string, catalogo: CatalogoClinica): string {
  return catalogo.procedimentos.find((p) => p.procedimento_id === procedimentoId)?.nome_pt ?? '';
}

async function reservar(
  clienteRpc: ClienteRpc,
  entrada: {
    clinicaId: string;
    procedimentoId: string;
    procedimentoNome: string;
    dentistaId: string;
    pacienteId: string;
    opcao: OpcaoHorario;
    telefoneNormalizado: string;
    visaoEfetiva: CadastroPaciente;
  }
): Promise<DecisaoOrquestrador> {
  const horario = minutosParaHHMM(entrada.opcao.inicio_min);
  const resultadoReserva = await reservarAgendamento(clienteRpc, {
    clinica_id: entrada.clinicaId,
    procedimento_id: entrada.procedimentoId,
    dentista_id: entrada.dentistaId,
    paciente_id: entrada.pacienteId,
    data: entrada.opcao.data,
    horario,
    telefone_normalizado: entrada.telefoneNormalizado,
    // `nome`/`cpf` estao necessariamente preenchidos aqui: o fluxo so alcanca
    // a reserva depois de `calcularCadastroFaltante` confirmar que nenhum
    // obrigatorio falta. As asercoes documentam essa garantia -- se ela deixar
    // de valer, `validarEntrada` falha fechado em vez de gravar linha
    // incompleta.
    paciente_nome: entrada.visaoEfetiva.nome as string,
    paciente_documento: entrada.visaoEfetiva.cpf as string,
    procedimento_nome: entrada.procedimentoNome,
  });

  switch (resultadoReserva.tipo) {
    case 'reservado':
      return {
        tipo: 'reserva_criada',
        agendamento_id: resultadoReserva.agendamento_id,
        dentista_id: resultadoReserva.dentista_id,
        procedimento_id: entrada.procedimentoId,
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
