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

export type CampoFaltante = 'procedimento' | 'data' | 'horario' | 'cadastro';

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
  | 'informar_sem_profissional'; // 2026-08-06 -- sem_dentista_disponivel, idem.

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
  data_referencia?: string;
  horarios_disponiveis?: string[];
  agendamento_confirmado?: { data: string; horario: string };
  proposta_pendente?: { data: string; horario: string };
  dados_faltantes?: CampoFaltante[];
  falha_tecnica?: true;
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
export function derivarFatosAutorizados(decisao: DecisaoOrquestrador): FatosAutorizados {
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
      };

    case 'sem_dentista_disponivel':
      return { objetivo: 'informar_sem_profissional' };

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
      return { objetivo: 'pedir_cadastro', dados_faltantes: ['cadastro'] };

    case 'reserva_criada':
      return {
        objetivo: 'informar_reserva_criada',
        agendamento_confirmado: { data: formatarData(decisao.data), horario: decisao.horario },
      };

    case 'reserva_conflito':
      // Mesma familia de "isso que voce escolheu nao esta mais livre" que
      // horario_exato_indisponivel -- sem alternativas conhecidas aqui (a
      // RPC so informou conflito, nao vizinhos), entao sem horarios_disponiveis.
      return { objetivo: 'informar_horario_indisponivel' };
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
