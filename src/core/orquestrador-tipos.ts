// Tipos do orquestrador minimo do primeiro fluxo (docs/06-roadmap.md,
// passos 1-3). Ver orquestrador.ts para o escopo exato e o que fica de fora
// por decisao explicita (moratoria P4, AGENTS.md "Simplicidade e prioridade
// de entrega").

import type { ProcedimentoOficial } from './procedimento-tipos.ts';
import type { DentistaApto, DentistaOficial, ResultadoResolucaoDentista, VinculoDentistaProcedimento } from './dentista-tipos.ts';
import type { ConfiguracaoDuracao, ResultadoResolucaoDuracao } from './duracao-tipos.ts';
import type { CampoCadastralInterpretacao, Conflito, NaturezaMensagem } from './interpretacao-tipos.ts';
import type { InstanteAtual, OpcaoHorario, ResultadoDisponibilidade } from './disponibilidade-tipos.ts';
import type { ResultadoResolucaoTemporal } from './temporal-tipos.ts';
import type { MotivoErroReserva } from './reservar-agendamento.ts';
import type { MotivoErroRemarcacao } from './remarcar-agendamento.ts';
import type { MotivoErroCancelamento } from './cancelar-agendamento.ts';
import type { AgendamentoAtivo } from './buscar-agendamento-ativo.ts';
import type { HistoricoConversa } from './tipos.ts';

/**
 * Catalogo de UMA clinica. Montado internamente pelo orquestrador, via
 * carregar-catalogo.ts, a partir de clinicas.dentistas + procedimentos_
 * catalogo (schema real) -- nunca mais recebido pronto de fora. Continua
 * sendo so o formato de entrada que os resolvedores de procedimento/
 * dentista/duracao ja exigiam (nenhum dos tres foi alterado).
 */
export interface CatalogoClinica {
  procedimentos: readonly ProcedimentoOficial[];
  dentistas: readonly DentistaOficial[];
  vinculos: readonly VinculoDentistaProcedimento[];
  configuracoesDuracao: readonly ConfiguracaoDuracao[];
  /**
   * `clinicas.automatizacoes.solicitar_email` (specs/cadastro-conversacional-v1.md
   * secao 2). Quando `true`, o e-mail entra nos obrigatorios do cadastro.
   * Ausente ou malformada no banco ⇒ `false`: a obrigacao precisa ser
   * afirmativa.
   */
  exigirEmail: boolean;
}

export interface EntradaOrquestrador {
  provider: string;
  instancia_whatsapp: string;
  telefone_normalizado: string;
  mensagens_atuais: string[];
  // O orquestrador nunca le relogio -- mesmo principio ja fixo em
  // resolverTemporal/resolverDisponibilidade (nenhum dos dois chama
  // Date.now()). Fornecido pelo chamador (futuro transporte/Edge Function).
  instante_atual: InstanteAtual;
}

/**
 * Uniao discriminada por `tipo`. `aguardando_data_horario` e
 * `horarios_disponiveis` sao os dois desfechos depois de procedimento/
 * dentista/duracao resolvidos -- via montar-fatos-temporais.ts (fatia
 * minima: hoje, amanha, data explicita DD/MM[/AAAA], manha, tarde, horario
 * explicito HH:MM/HHh[MM]) + resolverTemporal + carregarEntradaDisponibilidade
 * (nenhum dos dois alterado). Texto fora desse vocabulario fechado nao
 * produz atomo -- cai naturalmente em `aguardando_data_horario` com motivo
 * `incompleto`, o mesmo caminho que resolverTemporal ja usa pra "faltou
 * dado". Casos complexos (dia da semana, restricao "depois das Xh", datas
 * relativas alem de hoje/amanha) ficam de fora desta etapa, por decisao do
 * Gabriel -- nao inventados aqui.
 */
export type DecisaoOrquestrador =
  // Nao deveria ocorrer na pratica (identificarConversa ja confirmou a
  // clinica antes do orquestrador chegar aqui) -- tratado explicitamente,
  // nunca uma excecao nao tratada nem um catalogo vazio inventado.
  | { tipo: 'clinica_sem_catalogo' }
  // Os quatro tipos abaixo (saudacao, duvida_livre, mensagem_nao_compreendida,
  // desistencia) vem da classificacao natureza_mensagem da IA
  // (specs/interpretacao-natureza-mensagem-v1.md), nunca de deteccao por
  // texto bruto -- so disparam quando `alteracoes` desta mensagem esta
  // vazio (a mesma spec: alteracoes sempre tem precedencia sobre
  // natureza_mensagem para a evolucao do fluxo).
  //
  // Mensagem e uma saudacao pura e ainda nao ha procedimento conhecido
  // nesta conversa.
  | { tipo: 'saudacao' }
  // Duvida ou comentario fora do vocabulario de agendamento (situacao
  // "Conversa basica", atendimento-v1.md secao 5).
  | { tipo: 'duvida_livre' }
  // Nao foi possivel classificar a mensagem com seguranca.
  | { tipo: 'mensagem_nao_compreendida' }
  // Recusa ou desistencia explicita, sem outro conteudo acionavel
  // (situacao "Desistencia", atendimento-v1.md secao 5). Nunca cancela
  // agendamento existente.
  | { tipo: 'desistencia' }
  // Sem payload desde 2026-08-08 (specs/procedimento-semantico-v1.md): a IA
  // devolve `procedimento_id` e o Core so confere integridade. ID ausente,
  // inexistente, de outra clinica ou inativo caem todos aqui -- os motivos
  // internos ja eram equivalentes perante o paciente, entao nao ha nuance a
  // transportar. `erro_catalogo_procedimento` foi REMOVIDO junto: sem
  // aliases, nao existe alias ambiguo/orfao/de outra clinica a reportar.
  | { tipo: 'aguardando_procedimento' }
  // `dentistas` sao os candidatos a apresentar -- NAO necessariamente todos os
  // aptos (specs/dentista-semantico-v1.md secao 12):
  //
  // - varios candidatos plausiveis ("a Vanessa", com duas Vanessas): sao SO
  //   esses, sem filtro de aptidao. Filtrar removeria justamente quem o
  //   paciente pediu; o turno seguinte resolve para um e a regra de vinculo
  //   (CASO 2) roda normalmente;
  // - `preferencia_nao_localizada`: o paciente mencionou alguem que nao existe
  //   na clinica, entao `dentistas` traz os APTOS reais e a resposta comeca
  //   dizendo que nao encontrou quem ele pediu;
  // - sem preferencia e varios aptos: os aptos, como sempre.
  //
  // Pode carregar UM unico elemento (antes so ocorria com >= 2) -- e o caso
  // "nao encontrei a Dra. Beatriz; temos o Dr. Carlos Turiak, pode ser com
  // ele?", que e honesto e nao existia antes.
  | {
      tipo: 'aguardando_escolha_dentista';
      dentistas: readonly DentistaApto[];
      preferencia_nao_localizada?: true;
    }
  // `procedimento_oferecido` presente = a Iris esta de fato oferecendo esse
  // procedimento como alternativa, e a resposta pode fazer essa pergunta
  // (specs/contexto-pendente-interpretacao-v1.md secao 11). So vem preenchido
  // quando a oferta e POSSIVEL: o pedido nao e a propria avaliacao, ela existe
  // e esta ativa, e tem ao menos um dentista apto.
  //
  // AUSENTE = nao ha alternativa real. A resposta nao faz a pergunta e nada e
  // gravado no contexto pendente. Sem essa guarda, aceitar uma oferta
  // impossivel devolveria zero aptos para a propria avaliacao e ofereceria de
  // novo, em ciclo -- o que `dentistas-vinculos-v1.md` secao 12 regra 1 proibe.
  | { tipo: 'sem_dentista_disponivel'; procedimento_oferecido?: string }
  // O paciente escolheu um profissional que nao realiza o procedimento
  // pedido, e a Consulta/Avaliacao COM ELE tambem nao e possivel -- ou
  // porque ele nao tem vinculo ativo com ela, ou porque o proprio
  // procedimento pedido ja era a avaliacao (specs/dentista-semantico-v1.md
  // secao 5, casos 2.2 e 2.3-falho).
  //
  // Terminal e sem pergunta: nunca troca de profissional em silencio, nunca
  // oferece a avaliacao de novo (o que criaria ciclo). Uma decisao SO para
  // os dois casos -- nao ha nenhuma diferenca operacional entre eles (nao
  // consultam disponibilidade, nao reservam, gravam `limpar`), so de frase,
  // e a redatora adapta pelo fato abaixo mais a mensagem crua do paciente.
  | { tipo: 'combinacao_indisponivel'; dentista_nome_exibido: string }
  | { tipo: 'erro_catalogo_dentista'; resultado: ResultadoResolucaoDentista }
  | { tipo: 'duracao_nao_configurada' }
  | { tipo: 'erro_configuracao_duracao'; resultado: ResultadoResolucaoDuracao }
  // 'resolvido' e excluido do tipo aqui de proposito (2026-08-05): quando
  // resultadoTemporal.tipo === 'resolvido', o orquestrador nunca monta esta
  // decisao (segue para disponibilidade) -- entao 'resolvido' chegando aqui
  // seria inconsistencia interna impossivel, nunca uma situacao real do
  // paciente. O contrato de tipo reflete isso: nenhum gerador de resposta
  // pode inventar um fallback pra um caso que nao deveria poder existir.
  | { tipo: 'aguardando_data_horario'; resultado: Exclude<ResultadoResolucaoTemporal, { tipo: 'resolvido' }> }
  | {
      tipo: 'horarios_disponiveis';
      procedimento_id: string;
      dentista_id: string;
      duracao_min: number;
      resultado: ResultadoDisponibilidade;
    }
  // O paciente escolheu um horario exato e ele esta livre (resolverDisponibilidade
  // ja devolveu horario_exato_disponivel), mas ainda nao disse "sim" -- nunca
  // reserva sem essa confirmacao explicita (campo `confirmacao`, dados.ts).
  | { tipo: 'aguardando_confirmacao'; procedimento_id: string; dentista_id: string; opcao: OpcaoHorario }
  // Confirmado e horario livre, mas faltam dados cadastrais obrigatorios
  // (specs/cadastro-conversacional-v1.md secoes 1 e 2).
  //
  // Vale para paciente NOVO e para paciente EXISTENTE INCOMPLETO -- o gatilho
  // deixou de ser "nao ha paciente" e passou a ser "falta dado". Paciente
  // existente e completo nunca cai aqui: o cadastro nao interrompe o
  // agendamento dele.
  //
  // `campos_faltantes` e itemizado e sai da VISAO EFETIVA (ficha + conversa),
  // entao nunca inclui algo que ja se sabe. O Core autoriza QUAIS campos
  // faltam; a redatora e quem formula a pergunta -- nao existe sequencia
  // rigida de textos.
  | { tipo: 'cadastro_necessario'; campos_faltantes: readonly CampoCadastralInterpretacao[] }
  // Desfecho TERMINAL de encaminhamento a recepcao. Ate 2026-08-10 cobria
  // tambem o primeiro contato com o conflito de CPF; desde
  // specs/cpf-outro-telefone-v1.md secao 3, aquele caso virou
  // `troca_telefone_pendente` (que PERGUNTA), e este ficou com os dois
  // desfechos tecnicos terminais da troca:
  //
  // - `telefone_de_outro_paciente` -- persistencia-v1.md secao 7, detectada e
  //   nao resolvida nesta rodada;
  // - `cpf_nao_encontrado` -- corrida real, o CPF sumiu entre a pergunta e a
  //   resposta.
  //
  // Nao duplica paciente, nao atualiza telefone, nao investiga de quem e o
  // CPF. Uma decisao so para os dois: o desfecho para o paciente e o mesmo, e
  // distingui-los no texto exporia a situacao da ficha alheia.
  | { tipo: 'cpf_ja_cadastrado' }
  // O CPF informado pertence a outra ficha desta clinica, e a Iris esta
  // PERGUNTANDO se pode passar o telefone oficial daquela ficha para o numero
  // desta conversa (specs/cpf-outro-telefone-v1.md secao 3).
  //
  // Nao carrega paciente_id, nome nem qualquer dado da outra ficha: o Core
  // nunca a leu, e a redatora nao precisa disso para fazer a pergunta (spec
  // secao 4). Nada foi escrito ainda -- so a pergunta existe.
  | { tipo: 'troca_telefone_pendente' }
  // O paciente recusou a troca (specs/cpf-outro-telefone-v1.md secao 3).
  // Nenhuma escrita, nenhum paciente novo, e o agendamento NAO continua: sem
  // a troca nao existe associacao segura entre este telefone e aquela ficha.
  //
  // Isso REVOGA a regra antiga de persistencia-v1.md secao 6 ("permitir que o
  // agendamento continue normalmente" na recusa) -- revogacao registrada por
  // escrito na spec, nunca reconciliada em silencio.
  | { tipo: 'troca_telefone_recusada' }
  | {
      tipo: 'reserva_criada';
      agendamento_id: string;
      dentista_id: string;
      procedimento_id: string;
      duracao_min: number;
      data: string;
      horario: string;
    }
  // O horario estava livre na leitura, mas cappia_reservar_agendamento (trava
  // real, ja testada em producao) recusou por sobreposição -- nunca insiste
  // sozinho, devolve conflito para o chamador pedir uma nova escolha.
  //
  // REUTILIZADA pela remarcacao (specs/remarcacao-conversacional-v1.md secao
  // 6): `cappia_remarcar_agendamento_v2` usa o MESMO lock/conflito de
  // `cappia_reservar_agendamento`, e o desfecho para o paciente e
  // literalmente o mesmo -- escolher outro horario. Uma segunda decisao so
  // para dizer a mesma frase seria duplicacao.
  | { tipo: 'reserva_conflito' }
  // REUTILIZADA pela remarcacao pelo mesmo motivo (spec secao 6, auditoria
  // de `remarcacao_falhou`): nenhum dos motivos de falha e lido em nenhum
  // lugar do Core (so tres consumidores existem, e todos colapsam no MESMO
  // texto tecnico generico) -- criar uma decisao propria so anteciparia um
  // palpite sobre um campo que ninguem le. `motivo` aceita o vocabulario das
  // DUAS RPCs: `Exclude<..., 'horario_ocupado'>` porque esse motivo especifico
  // da remarcacao sempre vira `reserva_conflito` acima, nunca chega aqui.
  //
  // REUTILIZADA TAMBEM pelo cancelamento (2026-08-11,
  // specs/cancelamento-conversacional-v1.md secao 7), pela MESMA auditoria
  // reaplicada sem mudanca de raciocinio: `agendamento_nao_encontrado` e
  // `nao_confirmado` colapsam na mesma corrida real (o agendamento mudou entre
  // a busca e a confirmacao -- o turno seguinte se autocorrige devolvendo
  // `sem_agendamento_para_cancelar`, a mensagem verdadeira), e `erro_insercao`
  // e tecnico. Nenhum dos tres tem consumidor que leia `motivo`.
  | {
      tipo: 'reserva_falhou';
      motivo: MotivoErroReserva | Exclude<MotivoErroRemarcacao, 'horario_ocupado'> | MotivoErroCancelamento;
    }
  // Nenhum agendamento ativo encontrado para remarcar -- zero resultados da
  // busca, ou paciente sem ficha (specs/remarcacao-conversacional-v1.md
  // secao 2). Paciente sem cadastro nao recebe oferta de cadastro aqui: sem
  // ficha nao ha agendamento por definicao.
  | { tipo: 'sem_agendamento_para_remarcar' }
  // Mais de um agendamento ativo -- a Iris precisa perguntar qual
  // (spec secao 3). `agendamentos` e a lista OFERECIDA, na ordem em que sera
  // apresentada; o contexto pendente persiste so os IDs, nesta mesma ordem.
  | { tipo: 'aguardando_escolha_agendamento'; agendamentos: readonly AgendamentoAtivo[] }
  // Horario novo encontrado e livre, aguardando confirmacao explicita (spec
  // secao 5). Decisao SEPARADA de `aguardando_confirmacao`: a resposta
  // precisa comunicar de ONDE para ONDE (agendamento atual -> horario
  // novo), nao so pedir um "sim" -- diferenca de significado operacional,
  // nunca de conveniencia estrutural. `procedimento_id`/`dentista_id` sao os
  // do agendamento ja localizado, NUNCA re-resolvidos.
  | {
      tipo: 'aguardando_confirmacao_remarcacao';
      agendamento_atual: AgendamentoAtivo;
      procedimento_id: string;
      dentista_id: string;
      opcao: OpcaoHorario;
    }
  // Remarcacao concluida com sucesso (spec secao 6), inclusive replay
  // (`ja_remarcado: true` na RPC) -- o desfecho para o paciente e o mesmo:
  // uma confirmacao verdadeira, nunca um erro de retentativa.
  | {
      tipo: 'remarcacao_criada';
      agendamento_id: string;
      agendamento_id_antigo: string;
      dentista_id: string;
      procedimento_id: string;
      duracao_min: number;
      data: string;
      horario: string;
    }
  // --- Cancelamento (2026-08-11, specs/cancelamento-conversacional-v1.md) ---
  //
  // Nenhum agendamento ativo encontrado para cancelar -- zero resultados da
  // busca, ou paciente sem ficha (spec secao 2). Mesma disciplina de
  // `sem_agendamento_para_remarcar`: paciente sem cadastro nao recebe oferta
  // de cadastro aqui, porque sem ficha nao ha agendamento por definicao.
  | { tipo: 'sem_agendamento_para_cancelar' }
  // Mais de um agendamento ativo -- a Iris precisa perguntar qual CANCELAR
  // (spec secao 5). Decisao SEPARADA de `aguardando_escolha_agendamento`
  // apenas porque o texto ao paciente difere ("qual voce quer cancelar?" vs
  // "remarcar?") -- o MECANISMO inteiro e reusado sem uma linha de mudanca:
  // mesmo `agendamentos_ativos` no payload, mesma instrucao (que ja e generica
  // -- "QUAL DESSES AGENDAMENTOS", sem verbo), mesmo `agendamento_id` validado
  // contra a lista oferecida, mesmo marcador `escolha_agendamento_pendente`.
  | { tipo: 'aguardando_escolha_agendamento_cancelamento'; agendamentos: readonly AgendamentoAtivo[] }
  // O agendamento esta localizado e a Iris esta PERGUNTANDO se pode cancelar
  // (spec secao 4) -- a protecao central desta spec. `intencao = cancelamento`
  // NUNCA, por si so, executa cancelamento: um falso positivo da classificacao
  // so pode, na pior hipotese, chegar ate aqui e ser negado pelo paciente.
  //
  // Carrega o agendamento INTEIRO (procedimento, dentista, data, horario)
  // porque a exigencia e mostrar CLARAMENTE o que sera cancelado -- nunca um
  // "confirma?" generico.
  //
  // `confirmacao_nao_compreendida` (2026-08-11, spec secao 4): a pergunta JA
  // tinha sido feita para ESTE mesmo agendamento e a resposta do paciente nao
  // autorizou nem encerrou o fluxo -- ou seja, a confirmacao nao ficou clara.
  // A Iris deve reconhecer isso e pedir esclarecimento de forma natural, em
  // vez de repetir a mesma pergunta mecanicamente.
  //
  // DERIVADO no turno, NUNCA persistido: sai da comparacao entre a
  // `proposta_pendente` lida no inicio do turno e o agendamento em questao.
  // Nao existe contador de tentativas -- a primeira resposta que nao resolve
  // ja produz o esclarecimento (docs: "nao criar complexidade para casos que
  // uma pergunta natural resolve").
  //
  // Mesma forma de `preferencia_nao_localizada` em `aguardando_escolha_dentista`
  // e de `procedimento_oferecido` em `sem_dentista_disponivel`: campo opcional
  // numa decisao que ja existe, nunca decisao nova.
  | {
      tipo: 'aguardando_confirmacao_cancelamento';
      agendamento: AgendamentoAtivo;
      confirmacao_nao_compreendida?: true;
    }
  // Cancelamento concluido com sucesso (spec secao 7), inclusive replay
  // (`ja_cancelado: true` na RPC) -- o desfecho para o paciente e o mesmo:
  // uma confirmacao verdadeira, nunca um erro de retentativa.
  | {
      tipo: 'cancelamento_criado';
      agendamento_id: string;
      procedimento_id: string | null;
      dentista_id: string | null;
      data: string;
      horario: string;
    };

export interface ResultadoOrquestrador {
  clinica_id: string;
  conversa_id: string;
  conflitos: readonly Conflito[];
  decisao: DecisaoOrquestrador;
  /**
   * `atualizado_em` da linha APOS a gravacao do snapshot de horarios desta
   * mensagem -- o valor que `gravarContextoHorarios` devolveu (ver seu
   * comentario para o contrato de 3 casos). Exposto (aditivo,
   * specs/memoria-conversacional-minima-v1.md) para que a gravacao do
   * historico, que so acontece depois que a resposta final existe (fora do
   * orquestrador), encadeie seu CAS sobre este valor exato, sem reler.
   */
  atualizado_em: string;
  /**
   * Classificacao da mensagem atual (interpretacao-tipos.ts). Exposta
   * (aditiva) para a IA redatora -- specs/memoria-conversacional-minima-v1.md
   * secao 3.
   */
  natureza_mensagem: NaturezaMensagem;
  /**
   * Historico conversacional (ate 10 pares), lido no INICIO deste turno
   * (antes de qualquer escrita) -- `null` quando nao ha nenhum turno
   * anterior. SEM filtro de validade aqui: e sobre este valor cru que a
   * gravacao anexa o par novo (specs/historico-conversacional-v1.md secao
   * 3). O filtro de idade (24h) e aplicado no ponto de leitura para os dois
   * modelos (orquestrador.ts, para a interpretadora; gerar-resposta-
   * conversacional.ts, para a redatora), nunca aqui.
   */
  historico_conversa: HistoricoConversa | null;
  /**
   * Presente SOMENTE quando o procedimento pedido cedeu lugar a
   * Consulta/Avaliacao para preservar o dentista que o paciente escolheu
   * (specs/dentista-semantico-v1.md secao 5, caso 2.3). A troca precisa ser
   * INFORMADA na resposta -- ela dispensa nova pergunta de aceitacao, nunca
   * o dever de comunicar.
   *
   * Nao e estado, nao e decisao: e um fato deste turno, repassado a
   * `derivarFatosAutorizados` junto com a decisao. A substituicao nao e
   * persistida -- `dados.procedimento_id` continua com o que o paciente
   * pediu, e o turno seguinte re-deriva o mesmo resultado.
   */
  substituicao_por_avaliacao?: { dentista_nome_exibido: string };
  /**
   * Agendamentos futuros do paciente, disponibilizados a redatora como
   * CONTEXTO da conversa (specs/consulta-agendamento-conversacional-v1.md).
   *
   * Mesma natureza de `substituicao_por_avaliacao` logo acima -- nao e
   * estado, nao e decisao, e um fato deste turno anexado FORA do switch de
   * `derivarFatosAutorizados`. O `objetivo` da resposta nunca muda por causa
   * dele: o Core disponibiliza, a redatora decide se e relevante mencionar.
   *
   * PRESENTE SOMENTE em decisao conversacional (`saudacao`, `duvida_livre`,
   * `mensagem_nao_compreendida`) e com paciente identificado (spec secao 2).
   * `desistencia` fica DE FORA de proposito, embora saia da mesma
   * `decidirPorNatureza` (decisao do Gabriel, 2026-08-12): o paciente esta
   * encerrando, e mencionar um agendamento futuro ali reabriria assunto
   * justamente quando ele quis fechar.
   *
   * Os fluxos operacionais (novo agendamento, remarcacao, cancelamento)
   * NUNCA recebem este fato -- eles ja fazem as proprias buscas, com
   * exigencia de frescor propria, e uma lista lida antes da decisao poderia
   * contradizer o desfecho do turno (ex.: `reserva_criada`).
   *
   * AUSENTE quando nao ha nenhum agendamento futuro -- nunca `[]`, mesma
   * disciplina das demais chaves opcionais do Core.
   */
  agendamentos_do_paciente?: readonly AgendamentoAtivo[];
  /**
   * ETAPA 2 da Arquitetura V2 (docs/07-arquitetura-v2.md secao 10) --
   * EXPERIMENTAL, SOMENTE PARA MEDICAO EM SHADOW MODE.
   *
   * Contexto factual, ja disponivel neste turno, para o despachante-sombra
   * comparar sua propria decisao contra a decisao REAL do orquestrador --
   * em paralelo, depois da resposta ja estar decidida, sem nenhum efeito no
   * fluxo real. NUNCA lido por nenhuma decisao de producao (nem
   * `decidirPorNatureza`, nem `decidir`, nem a redatora); existe somente
   * para ser consumido pelo comparador-sombra em `index.ts`.
   *
   * NENHUM dado cadastral (nome/cpf/data_nascimento/email) -- so os campos
   * operacionais ja existentes em `dados` e o agendamento futuro ja
   * calculado, quando houver. AUSENTE (nunca objeto vazio) quando nao ha
   * nada a oferecer, mesma disciplina das demais chaves opcionais do Core.
   */
  contexto_sombra_v2?: ContextoSombraCapacidadeV2;
}

/** Ver o comentario de `ResultadoOrquestrador.contexto_sombra_v2`. */
export interface ContextoSombraCapacidadeV2 {
  dados_conhecidos?: {
    procedimento?: string;
    data?: string;
    horario?: string;
    periodo?: string;
  };
  horarios_oferecidos?: readonly string[];
  agendamento_futuro?: {
    data: string;
    horario: string;
    procedimento?: string;
    dentista_nome?: string;
  };
}
