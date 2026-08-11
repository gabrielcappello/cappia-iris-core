// Fatos autorizados que o Core entrega a IA redatora (specs/resposta-
// conversacional-v1.md secao 2). Funcao pura: nao chama IA, nao acessa
// banco, so traduz a decisao ja tomada pelo orquestrador em fatos e num
// objetivo de resposta -- exatamente o mesmo papel que gerar-resposta-
// paciente.ts ja tem para o texto fixo, so que aqui o "texto" fica por
// conta da IA.
//
// Regra estrutural (spec secao 2): FatosAutorizados carrega FATOS, nunca
// frases prontas. Nenhum campo aqui pode conter texto de resposta -- so
// dados que a redatora usa para escrever.

import { formatarData, formatarMinutos } from './gerar-resposta-paciente.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';

/**
 * ITEMIZADO desde 2026-08-10 (specs/cadastro-conversacional-v1.md secao 8): o
 * valor monolitico `'cadastro'` saiu. Ele dizia apenas "falta cadastro", sem
 * dizer o que falta -- e a redatora nao tinha como pedir so o que ainda nao se
 * sabe. Os quatro campos cadastrais entram no lugar dele.
 */
export type CampoFaltante =
  | 'procedimento'
  | 'data'
  | 'horario'
  | 'nome'
  | 'cpf'
  | 'data_nascimento'
  | 'email';

/**
 * ATENCAO (achado da implementacao, 2026-08-06): a spec aprovada previa
 * exatamente 14 valores. Duas decisoes (`cadastro_necessario` e
 * `sem_dentista_disponivel`) precisam de um objetivo proprio para receber o
 * fallback deterministico dedicado que a propria spec exige na secao 6 --
 * nenhum dos 14 valores originais descreve essas duas situacoes sem
 * distorcer o significado. Os dois valores abaixo marcados 2026-08-06 foram
 * adicionados para manter o mapeamento exaustivo e honesto; nenhum dado ou
 * comportamento novo foi introduzido alem disso. Ver relatorio de
 * implementacao para revisao independente.
 */
export type ObjetivoResposta =
  | 'cumprimentar_e_oferecer_ajuda'
  | 'pedir_procedimento'
  | 'escolher_entre_procedimentos'
  | 'escolher_entre_dentistas'
  | 'pedir_data_ou_horario'
  | 'apresentar_horarios'
  | 'informar_sem_disponibilidade'
  | 'pedir_confirmacao'
  | 'informar_reserva_criada'
  | 'informar_horario_indisponivel'
  | 'acolher_e_retomar'
  | 'pedir_reformulacao'
  | 'encerrar_cordialmente'
  | 'informar_falha_tecnica'
  | 'pedir_cadastro' // 2026-08-06 -- cadastro_necessario nao cabia em nenhum dos 14 originais.
  | 'informar_sem_profissional' // 2026-08-06 -- sem_dentista_disponivel, idem.
  | 'informar_combinacao_indisponivel' // 2026-08-09 -- combinacao_indisponivel (specs/dentista-semantico-v1.md).
  | 'informar_cpf_ja_cadastrado' // 2026-08-10 -- specs/cadastro-conversacional-v1.md secao 7.
  | 'perguntar_troca_telefone' // 2026-08-10 -- specs/cpf-outro-telefone-v1.md secao 3.
  | 'acatar_recusa_troca_telefone' // 2026-08-10 -- idem; recusa tem desfecho proprio.
  | 'informar_substituicao_por_avaliacao' // 2026-08-09 -- o procedimento cedeu para preservar o dentista escolhido.
  | 'informar_sem_agendamento_para_remarcar' // 2026-08-11 -- specs/remarcacao-conversacional-v1.md secao 2.
  | 'escolher_entre_agendamentos' // 2026-08-11 -- idem, secao 3.
  | 'pedir_confirmacao_remarcacao' // 2026-08-11 -- idem, secao 5.
  | 'informar_remarcacao_criada'; // 2026-08-11 -- idem, secao 6.

export interface FatosAutorizados {
  objetivo: ObjetivoResposta;
  /**
   * NUNCA populado hoje (achado da implementacao, 2026-08-06): nenhuma
   * DecisaoOrquestrador carrega o nome resolvido do procedimento -- so o
   * `procedimento_id` opaco. gerar-resposta-paciente.ts ja documenta essa
   * mesma limitacao ("nomes de procedimento/dentista NAO aparecem no texto
   * porque a decisao nao os carrega, so IDs"); o campo permanece aqui
   * porque a spec aprovada o define, mas populá-lo exigiria o orquestrador
   * carregar nome_pt do catalogo para dentro de cada decisao -- mudanca de
   * escopo maior, nao feita aqui.
   */
  procedimento_resolvido?: string;
  /** Ver o mesmo achado acima -- nenhuma decisao de procedimento ambiguo existe hoje (resolver-procedimento.ts nao tem variante "varios candidatos"); campo nunca populado, objetivo correspondente (`escolher_entre_procedimentos`) hoje inalcancavel. */
  procedimentos_candidatos?: string[];
  /** Idem `procedimento_resolvido` -- nunca populado hoje. */
  dentista_resolvido?: string;
  /** Este SIM e populado: `aguardando_escolha_dentista` carrega `DentistaApto[]`, que ja tem `nome_exibido`. */
  dentistas_candidatos?: string[];
  /**
   * Nome do profissional que o paciente escolheu, quando a decisao gira em
   * torno dele (specs/dentista-semantico-v1.md). Populado em
   * `combinacao_indisponivel` e na substituicao por avaliacao. Dado de
   * catalogo, nunca PII do paciente.
   */
  dentista_preferido?: string;
  /**
   * Presente SOMENTE quando o procedimento pedido cedeu lugar a
   * Consulta/Avaliacao para preservar o dentista escolhido. A redatora
   * PRECISA comunicar isso -- a troca dispensa nova aceitacao, nunca o
   * dever de informar.
   */
  substituido_por_avaliacao?: true;
  /**
   * Presente somente quando `sem_dentista_disponivel` tem uma alternativa
   * REAL a oferecer (a Consulta/Avaliação existe, está ativa e tem dentista
   * apto). Sem este fato, a redatora não pode oferecer nada — não há
   * alternativa a propor (specs/contexto-pendente-interpretacao-v1.md secao 11).
   */
  avaliacao_oferecida?: true;
  /**
   * O paciente mencionou um profissional que nao existe nesta clinica
   * (specs/dentista-semantico-v1.md secao 12). A redatora deve dizer isso
   * antes de apresentar `dentistas_candidatos` -- que, neste caso, sao os
   * APTOS reais, nao os mencionados.
   *
   * O Core nao transporta o nome que o paciente usou: ele esta na mensagem
   * crua, que a redatora ja tem. Inventar um campo para isso seria duplicar
   * dado que ja atravessa.
   */
  preferencia_nao_localizada?: true;
  data_referencia?: string;
  horarios_disponiveis?: string[];
  agendamento_confirmado?: { data: string; horario: string };
  proposta_pendente?: { data: string; horario: string };
  dados_faltantes?: CampoFaltante[];
  falha_tecnica?: true;
  /**
   * Data e horario do agendamento ATUAL do paciente, na remarcacao
   * (specs/remarcacao-conversacional-v1.md secao 5) -- o "de onde" da
   * pergunta "de onde para onde". `proposta_pendente` continua sendo o "para
   * onde" (o horario novo, aguardando confirmacao) -- mesmo campo que o
   * novo agendamento ja usa, sem alteracao de significado.
   */
  agendamento_atual?: { data: string; horario: string };
  /**
   * Descricoes dos agendamentos ativos do paciente, quando ha mais de um e
   * ele precisa escolher qual remarcar (spec secao 3). Mesmo papel que
   * `dentistas_candidatos` ja tem para escolha de profissional -- texto
   * pronto, nunca IDs.
   */
  agendamentos_candidatos?: string[];
}

/**
 * Mapeamento puro e exaustivo: uma decisao nova sem `case` correspondente
 * nao compila (specs/resposta-conversacional-v1.md secao 2).
 *
 * `aguardando_data_horario` colapsa todos os motivos temporais (incompleto/
 * ambiguo/invalido/passado/conflito/erro_configuracao) num unico objetivo
 * generico -- ao contrario de gerar-resposta-paciente.ts, que tem texto
 * proprio por motivo. Achado da implementacao: a spec aprovada nao previu
 * um fato para carregar essa nuance; a IA redatora recebe a mensagem CRUA
 * do paciente e pode reagir ao contexto ("dia 15" no passado), mas perde
 * precisao estrutural que o texto fixo tinha. O fallback determinístico
 * (gerar-resposta-paciente.ts) preserva a nuance completa quando a redacao
 * falha ou e reprovada.
 */
export function derivarFatosAutorizados(
  decisao: DecisaoOrquestrador,
  substituicaoPorAvaliacao?: { dentista_nome_exibido: string }
): FatosAutorizados {
  const fatos = derivarPorDecisao(decisao);
  // A substituicao e um fato deste turno, ortogonal a decisao (ela pode
  // acompanhar horarios_disponiveis, aguardando_confirmacao, reserva_criada
  // ou qualquer outro desfecho depois da troca) -- por isso e anexada aqui,
  // e nao dentro de um `case` (specs/dentista-semantico-v1.md secao 5).
  if (substituicaoPorAvaliacao === undefined) return fatos;
  return {
    ...fatos,
    dentista_preferido: substituicaoPorAvaliacao.dentista_nome_exibido,
    substituido_por_avaliacao: true,
  };
}

function derivarPorDecisao(decisao: DecisaoOrquestrador): FatosAutorizados {
  switch (decisao.tipo) {
    case 'clinica_sem_catalogo':
    case 'erro_catalogo_dentista':
    case 'duracao_nao_configurada':
    case 'erro_configuracao_duracao':
    case 'reserva_falhou':
      return { objetivo: 'informar_falha_tecnica', falha_tecnica: true };

    case 'saudacao':
      return { objetivo: 'cumprimentar_e_oferecer_ajuda' };

    case 'duvida_livre':
      return { objetivo: 'acolher_e_retomar' };

    case 'mensagem_nao_compreendida':
      return { objetivo: 'pedir_reformulacao' };

    case 'desistencia':
      return { objetivo: 'encerrar_cordialmente' };

    case 'aguardando_procedimento':
      return { objetivo: 'pedir_procedimento', dados_faltantes: ['procedimento'] };

    case 'aguardando_escolha_dentista':
      return {
        objetivo: 'escolher_entre_dentistas',
        dentistas_candidatos: decisao.dentistas.map((d) => d.nome_exibido),
        // Derivado pelo Core a partir de `dentistas_candidatos: []`
        // (specs/dentista-semantico-v1.md secao 12) -- nunca um sinal proprio
        // da IA. So diz "o profissional mencionado nao existe aqui"; QUEM ele
        // mencionou esta na mensagem crua, que a redatora ja recebe.
        ...(decisao.preferencia_nao_localizada === true ? { preferencia_nao_localizada: true as const } : {}),
      };

    case 'sem_dentista_disponivel':
      // `avaliacao_oferecida` so aparece quando a alternativa e real -- sem
      // ela a redatora nao tem fato que autorize oferecer nada, e por isso
      // nao pode inventar a pergunta.
      return {
        objetivo: 'informar_sem_profissional',
        ...(decisao.procedimento_oferecido !== undefined ? { avaliacao_oferecida: true as const } : {}),
      };

    case 'combinacao_indisponivel':
      // O nome do profissional escolhido e o unico fato aqui -- nunca o nome
      // de outro dentista: sugerir substituto e exatamente o que esta
      // decisao existe para impedir.
      return { objetivo: 'informar_combinacao_indisponivel', dentista_preferido: decisao.dentista_nome_exibido };

    case 'aguardando_data_horario':
      return { objetivo: 'pedir_data_ou_horario', dados_faltantes: ['data'] };

    case 'horarios_disponiveis':
      return fatosParaHorariosDisponiveis(decisao.resultado);

    case 'aguardando_confirmacao':
      return {
        objetivo: 'pedir_confirmacao',
        proposta_pendente: { data: formatarData(decisao.opcao.data), horario: formatarMinutos(decisao.opcao.inicio_min) },
      };

    case 'cadastro_necessario':
      // O Core autoriza QUAIS campos faltam; a redatora e quem formula a
      // pergunta, no tom reciproco de sempre. Nao existe sequencia rigida de
      // textos nem uma pergunta fixa por campo.
      return { objetivo: 'pedir_cadastro', dados_faltantes: [...decisao.campos_faltantes] };

    case 'cpf_ja_cadastrado':
      return { objetivo: 'informar_cpf_ja_cadastrado' };

    // NENHUM fato sobre a outra ficha acompanha estes dois: o Core nunca a
    // leu, e a redatora nao precisa de nada dela para perguntar ou para
    // acatar a recusa (specs/cpf-outro-telefone-v1.md secao 4). Nem CPF, nem
    // nome, nem telefone anterior, nem paciente_id.
    case 'troca_telefone_pendente':
      return { objetivo: 'perguntar_troca_telefone' };

    case 'troca_telefone_recusada':
      return { objetivo: 'acatar_recusa_troca_telefone' };

    case 'reserva_criada':
      return {
        objetivo: 'informar_reserva_criada',
        agendamento_confirmado: { data: formatarData(decisao.data), horario: decisao.horario },
      };

    case 'reserva_conflito':
      // Mesma familia de "isso que voce escolheu nao esta mais livre" que
      // horario_exato_indisponivel -- sem alternativas conhecidas aqui (a
      // RPC so informou conflito, nao vizinhos), entao sem horarios_disponiveis.
      // REUTILIZADA pela remarcacao (spec secao 6): mesmo desfecho para o
      // paciente, escolher outro horario.
      return { objetivo: 'informar_horario_indisponivel' };

    // --- Remarcacao (2026-08-11, specs/remarcacao-conversacional-v1.md) ---
    case 'sem_agendamento_para_remarcar':
      return { objetivo: 'informar_sem_agendamento_para_remarcar' };

    case 'aguardando_escolha_agendamento':
      return {
        objetivo: 'escolher_entre_agendamentos',
        agendamentos_candidatos: decisao.agendamentos.map((a) => `${formatarData(a.data)} às ${a.horario}`),
      };

    case 'aguardando_confirmacao_remarcacao':
      return {
        objetivo: 'pedir_confirmacao_remarcacao',
        agendamento_atual: {
          data: formatarData(decisao.agendamento_atual.data),
          horario: decisao.agendamento_atual.horario,
        },
        proposta_pendente: { data: formatarData(decisao.opcao.data), horario: formatarMinutos(decisao.opcao.inicio_min) },
      };

    case 'remarcacao_criada':
      return {
        objetivo: 'informar_remarcacao_criada',
        agendamento_confirmado: { data: formatarData(decisao.data), horario: decisao.horario },
      };
  }
}

function fatosParaHorariosDisponiveis(
  resultado: Extract<DecisaoOrquestrador, { tipo: 'horarios_disponiveis' }>['resultado']
): FatosAutorizados {
  switch (resultado.tipo) {
    case 'opcoes':
      return {
        objetivo: 'apresentar_horarios',
        data_referencia: formatarData(resultado.opcoes[0].data),
        horarios_disponiveis: resultado.opcoes.map((opcao) => formatarMinutos(opcao.inicio_min)),
      };

    case 'sem_disponibilidade':
      return { objetivo: 'informar_sem_disponibilidade' };

    case 'horario_exato_disponivel':
      // Estruturalmente nunca ocorre aqui (orquestrador.ts intercepta esse
      // caso antes de montar 'horarios_disponiveis') -- tratado por
      // exaustividade, com o mesmo fato honesto que gerar-resposta-paciente.ts
      // ja usa nessa posicao.
      return {
        objetivo: 'apresentar_horarios',
        data_referencia: formatarData(resultado.opcao.data),
        horarios_disponiveis: [formatarMinutos(resultado.opcao.inicio_min)],
      };

    case 'horario_exato_indisponivel': {
      const horarios = [resultado.anterior, resultado.posterior]
        .filter((opcao) => opcao !== undefined)
        .map((opcao) => formatarMinutos(opcao.inicio_min));
      return {
        objetivo: 'informar_horario_indisponivel',
        ...(horarios.length > 0 ? { horarios_disponiveis: horarios } : {}),
      };
    }

    case 'configuracao_invalida':
    case 'erro_intervalos':
      return { objetivo: 'informar_falha_tecnica', falha_tecnica: true };
  }
}
