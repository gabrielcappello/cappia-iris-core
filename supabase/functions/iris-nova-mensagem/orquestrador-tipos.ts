// Tipos do orquestrador minimo do primeiro fluxo (docs/06-roadmap.md,
// passos 1-3). Ver orquestrador.ts para o escopo exato e o que fica de fora
// por decisao explicita (moratoria P4, AGENTS.md "Simplicidade e prioridade
// de entrega").

import type { ProcedimentoOficial } from './procedimento-tipos.ts';
import type { CadastroPaciente } from './tipos.ts';
import type { DentistaApto, DentistaOficial, ResultadoResolucaoDentista, VinculoDentistaProcedimento } from './dentista-tipos.ts';
import type { ConfiguracaoDuracao, ResultadoResolucaoDuracao } from './duracao-tipos.ts';
import type { CampoCadastralInterpretacao, Conflito, NaturezaMensagem } from './interpretacao-tipos.ts';
import type {
  InstanteAtual,
  MotivoSemExpediente,
  OpcaoHorario,
  ResultadoDisponibilidade,
} from './disponibilidade-tipos.ts';
import type { ResultadoResolucaoTemporal } from './temporal-tipos.ts';
import type { MotivoErroReserva } from './reservar-agendamento.ts';
import type { MotivoErroRemarcacao } from './remarcar-agendamento.ts';
import type { MotivoErroCancelamento } from './cancelar-agendamento.ts';
import type { AgendamentoAtivo } from './buscar-agendamento-ativo.ts';
import type { HistoricoConversa } from './tipos.ts';
import type { ContextoUnificadoSemMensagem } from './sombra-contexto-unificado.ts';
import type { ClinicaConhecida } from './clinica-conhecida.ts';
import type { DentistaDaClinica } from './dentistas-da-clinica.ts';
import type { TratamentoAprovado } from './tratamentos-aprovados.ts';
import type { PrecosClinica } from './precos-clinica.ts';

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
  /**
   * Dados da propria clinica (nome, endereco, maps_link, telefone, horario) e
   * precos ja filtrados pelo consentimento -- 2026-08-17.
   *
   * Percorrem o MESMO caminho de `exigirEmail`: nascem em carregar-catalogo,
   * atravessam o catalogo e chegam a redatora como fato autorizado. Opcionais
   * porque uma clinica pode nao ter nada preenchido -- e nesse caso a Iris
   * simplesmente nao menciona o que nao sabe.
   */
  clinicaConhecida?: ClinicaConhecida;
  precos?: PrecosClinica;
  /** Quem atende na clinica, com especialidades (2026-08-18). */
  dentistasDaClinica?: readonly DentistaDaClinica[];
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
  // `procedimento_oferecido` presente = a Iris esta de fato oferecendo a
  // Consulta/Avaliacao neste turno, e a oferta precisa existir no ESTADO
  // (contexto-horarios grava `oferta_procedimento_pendente`). Mesmo campo e
  // mesmo significado de `sem_dentista_disponivel`, abaixo.
  //
  // Ate 2026-08-30 este desfecho oferecia a avaliacao ao paciente pela
  // redatora (orquestrador: `procedimento_avaliacao_disponivel`) sem registrar
  // nada -- a pergunta existia na tela e nao no estado, e a resposta do turno
  // seguinte chegava a interpretadora sem pergunta pendente declarada.
  //
  // `sem_expediente_na_data_pedida` (2026-08-30) e um FATO ADICIONAL do turno,
  // nunca o desfecho dele: o paciente pediu um dia em que a clinica nao
  // atende, mas o procedimento continua faltando -- entao a decisao segue
  // sendo `aguardando_procedimento`, e este campo apenas atravessa o
  // fechamento para a redatora poder dize-lo junto da pergunta.
  //
  // Presente SO quando a data pedida ja e resolvivel E cai em dia sem
  // expediente da CLINICA (domingo). Data ausente, ambigua ou invalida nunca
  // produz este fato -- nao afirmar fechamento e a unica saida honesta quando
  // nao se sabe qual dia o paciente quis.
  //
  // Nao vira `sem_expediente_no_dia` (decisao de fluxo): aquela decisao
  // pressupoe procedimento, dentista e duracao resolvidos, e aqui nao ha
  // nenhum dos tres. Ver a nota em `decidir`.
  | {
      tipo: 'aguardando_procedimento';
      procedimento_oferecido?: string;
      sem_expediente_na_data_pedida?: { data: string; motivo: MotivoSemExpediente };
    }
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
  | {
      tipo: 'aguardando_data_horario';
      resultado: Exclude<ResultadoResolucaoTemporal, { tipo: 'resolvido' }>;
      /**
       * Nome do profissional JA definido para este agendamento (2026-08-18).
       *
       * Ausente quando o dentista ainda nao esta resolvido -- ha caminhos que
       * chegam aqui antes disso (ex.: erro de fuso). Presente, diz a redatora
       * que a escolha do profissional ja aconteceu: sem esse fato ela pegava o
       * nome da mensagem crua do paciente e escrevia "Obrigada, Diego Ramoz",
       * como se o proprio paciente se chamasse assim.
       */
      dentista_nome_exibido?: string;
    }
  | {
      tipo: 'horarios_disponiveis';
      procedimento_id: string;
      dentista_id: string;
      /**
       * Nome exibivel do profissional de quem sao estes horarios
       * (2026-08-17).
       *
       * Defeito real que isto corrige: com dois dentistas aptos, a Iris
       * perguntou qual o paciente queria, ele respondeu "Diego ramoz", o Core
       * resolveu corretamente e decidiu `horarios_disponiveis` -- mas os
       * fatos enviados a redatora traziam SO os horarios. Sem saber que a
       * escolha ja estava feita, ela repetiu a pergunta do dentista junto com
       * a lista ("prefere o Dr. Diego ou o Dr. Pablo? Alem disso, estes sao
       * os horarios...").
       *
       * A correcao e dar o FATO, nunca proibir a pergunta: a redatora precisa
       * seguir livre para perguntar quando o paciente e ambiguo -- e o valor
       * dela. O que faltava era ela saber que aquela pergunta ja tinha
       * resposta.
       */
      dentista_nome_exibido: string;
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
  | {
      tipo: 'cadastro_necessario';
      campos_faltantes: readonly CampoCadastralInterpretacao[];
      /**
       * Campos que o paciente INFORMOU NESTE TURNO e que o Core REJEITOU por
       * serem invalidos (specs/cadastro-conversacional-v1.md secao 4).
       *
       * Existe porque "nunca informou" e "informou errado" sao situacoes
       * diferentes para quem esta conversando, e ate 2026-08-16 eram
       * indistinguiveis: o valor invalido era descartado EM SILENCIO e a Iris
       * repetia o mesmo pedido, sem dizer o motivo.
       *
       * Defeito medido em conversa real (WhatsApp, 2026-08-16): o paciente
       * enviou um CPF de 10 digitos, o Core descartou, e a Iris pediu "nome,
       * CPF e data de nascimento" de novo -- inteiro, como se ele nao tivesse
       * respondido nada. Ele repetiu os mesmos dados e o ciclo se fecharia
       * indefinidamente, porque nada indicava QUAL campo estava errado.
       *
       * Carrega SO o nome do campo -- nunca o valor rejeitado, que e PII.
       * Ausente quando nada foi rejeitado neste turno.
       */
      campos_invalidos?: readonly CampoCadastralInterpretacao[];
    }
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
      /**
       * Nomes EXIBIVEIS do que foi agendado (2026-08-16), para a Iris fechar
       * com um resumo conferivel em vez de so data e horario.
       *
       * Ate aqui o fechamento dizia apenas "agendado para 17/08 as 13:00" --
       * o paciente nao via o profissional nem o procedimento e nao tinha como
       * conferir se ficou certo. Pedido do Gabriel apos leitura de conversa
       * real (2026-08-16).
       *
       * Sao os mesmos valores ja gravados na linha do agendamento -- nao ha
       * consulta nova nem dado inventado. `nome_paciente` NAO entra: a
       * redatora ja o recebe pelo cadastro, e repeti-lo aqui duplicaria PII
       * sem necessidade.
       */
      dentista_nome_exibido: string;
      procedimento_nome: string;
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
      /**
       * Nomes exibiveis do que ficou remarcado (2026-08-17) -- mesmo papel
       * que em `reserva_criada`: sem eles o fechamento diz so a data e o
       * horario novos, e o paciente nao confere com quem nem para que.
       *
       * Opcionais porque vem da linha do agendamento ATUAL, onde podem estar
       * nulos. Ausentes = a redatora nao os cita.
       */
      dentista_nome_exibido?: string;
      procedimento_nome?: string;
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
   * Visao EFETIVA do cadastro no fim do turno -- a ficha do banco combinada
   * com o que o paciente acabou de informar (2026-08-17).
   *
   * Exposto para a redatora poder conferir um dado com ele e reconhecer quem
   * ja tem ficha, em vez de pedir de novo o que a clinica ja sabe. Antes
   * dessa data nenhum dado pessoal chegava a ela.
   *
   * `{}` quando nao ha nada conhecido.
   */
  cadastro_conhecido: CadastroPaciente;
  /**
   * Dados da PROPRIA clinica e precos liberados, vindos do catalogo
   * (2026-08-17). Expostos pelo mesmo motivo de `cadastro_conhecido`: a
   * redatora precisa deles para responder "qual e a clinica? fica onde" --
   * pergunta que ate esta data recebia "somos a clinica odontologica",
   * porque o dado nunca saia do banco.
   *
   * Ausentes quando a clinica nao preencheu nada.
   */
  clinica_conhecida?: ClinicaConhecida;
  precos?: PrecosClinica;
  /** Quem atende na clinica -- exposto para a redatora (2026-08-18). */
  dentistas_da_clinica?: readonly DentistaDaClinica[];
  /** Tratamentos aprovados e por agendar (2026-08-18). */
  tratamentos_aprovados?: readonly TratamentoAprovado[];
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
   * 3). O filtro de idade (12h) e aplicado no ponto de leitura para os dois
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
   * Paciente identificado sem NENHUM atendimento `concluido` nesta clinica
   * (specs/recomendacao-avaliacao-paciente-novo-v1.md). Mesma natureza de
   * `substituicao_por_avaliacao` e `agendamentos_do_paciente` acima: nao e
   * estado, nao e decisao, e um fato deste turno anexado FORA do switch de
   * `derivarFatosAutorizados`. O `objetivo` da resposta nunca muda por causa
   * dele -- o Core disponibiliza, a redatora decide se e relevante explicar
   * que o caminho e comecar por uma avaliacao.
   *
   * "Novo" e definido por HISTORICO DE ATENDIMENTO, nunca por ausencia de
   * cadastro nem por ausencia de agendamento futuro: um paciente com
   * agendamento `confirmado` pendente mas nenhum `concluido` ainda e novo
   * para este fato. `clinica_id` sempre no predicado -- o mesmo paciente
   * pode ser novo numa clinica e nao em outra.
   *
   * PRESENTE SOMENTE nas mesmas tres decisoes conversacionais de
   * `agendamentos_do_paciente` (`saudacao`, `duvida_livre`,
   * `mensagem_nao_compreendida`) mais `aguardando_procedimento` -- o
   * desfecho exato de "a IA nao conseguiu resolver procedimento", momento em
   * que a duvida real do paciente se manifesta no Core
   * (specs/procedimento-semantico-v1.md secao 4). Nos passos seguintes de
   * agendamento (dentista, horario, confirmacao) o procedimento ja esta
   * resolvido e este fato deixa de ser relevante -- por isso NAO acompanha
   * `agendamentos_do_paciente` em todas as decisoes, so nestas quatro.
   * `desistencia` fica de fora, mesmo motivo de `agendamentos_do_paciente`.
   *
   * AUSENTE (nunca `false` explicito) quando o paciente NAO e novo, ou
   * quando a decisao do turno nao e uma das quatro acima -- mesma disciplina
   * das demais chaves opcionais do Core.
   */
  paciente_novo_na_clinica?: true;
  /**
   * Nome (nome_pt) da Avaliacao/Consulta, SOMENTE quando a decisao e
   * `aguardando_procedimento` (paciente tentou agendar sem dizer o
   * procedimento) E o catalogo da clinica tem esse item ativo.
   *
   * DELIBERADAMENTE um nome UNICO, nunca a lista inteira: uma tentativa
   * anterior mandava `procedimentos_ativos_da_clinica` tambem aqui, com
   * instrucao pedindo para a redatora mencionar so a avaliacao -- medido
   * contra a IA real e reprovado repetidas vezes (2026-08-22): a lista
   * inteira visivel no payload pesava mais que a instrucao de texto, e a
   * redatora listava tudo mesmo assim. Mandar so este fato torna a
   * violacao fisicamente impossivel.
   */
  procedimento_avaliacao_disponivel?: string;
  /**
   * Nomes (nome_pt) de TODOS os procedimentos ATIVOS da clinica, SOMENTE
   * quando a decisao e `duvida_livre` (pergunta livre do tipo "quais
   * procedimentos vocês fazem?") -- o momento em que descrever as opcoes
   * faz sentido de verdade. NUNCA acompanha `procedimento_avaliacao_
   * disponivel` no mesmo turno -- as duas decisoes sao mutuamente
   * exclusivas (specs/catalogo-avaliacao-obrigatoria-gratuita-v1.md nao
   * cobre isto; achado de 2026-08-22, sem spec propria ainda).
   *
   * AUSENTE quando a lista esta vazia ou a decisao nao e essa -- mesma
   * disciplina das demais chaves opcionais.
   */
  procedimentos_ativos_da_clinica?: string[];
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
  /**
   * SOMBRA do contrato unificado (specs/contexto-conversacional-unificado-v1.md).
   * EXPERIMENTAL, SOMENTE MEDICAO -- nunca lido por nenhuma decisao de
   * producao, nunca alimenta escrita nenhuma. Montado em `finalizar` a partir
   * de fatos ja calculados neste turno.
   *
   * SEM a mensagem crua do turno -- quem despacha completa com
   * `completarContextoUnificado`. Ver `ContextoUnificadoSemMensagem`.
   */
  contexto_unificado_sombra?: ContextoUnificadoSemMensagem;
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
