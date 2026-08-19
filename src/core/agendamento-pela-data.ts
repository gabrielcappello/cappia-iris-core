// Identifica QUAL agendamento o paciente quer remarcar, pela data que ele
// mencionou.
//
// ── O CASO REAL (2026-08-19) ────────────────────────────────────────────
//   Iris:     "Voce tem: 20/08 as 13h restauracao, 24/08 as 15h ajuste,
//              25/08 as 15h colocacao. Qual deles quer remarcar?"
//   Paciente: "o da terca feira dia 25-8. queria para o mesmo dia"
//   Iris:     "Quais outros horarios voce gostaria de ver para esse dia?"
//   Paciente: "me fale voce. quais horarios tem disponivel?"
//   Iris:     "para o dia 25/08 nao temos outros horarios"
//
// FALSO: o Dr. Diego atende das 08:00 as 18:00 e tinha UM unico agendamento
// naquele dia -- o proprio. O dia estava quase todo livre.
//
// ── A CAUSA ─────────────────────────────────────────────────────────────
// O estado gravado era `{intencao: "remarcacao", data_texto: "25-8"}` --
// SEM `agendamento_id`. A IA anotou a data e nao anotou QUAL agendamento.
//
// Sem saber qual, o Core nao sabe o dentista nem o procedimento, entao nao
// calcula disponibilidade nenhuma. A redatora recebeu um pacote sem
// horarios e escreveu "nao temos outros" -- uma afirmacao inventada a
// partir de um vazio.
//
// ── POR QUE NAO INSISTIR NA INSTRUCAO ───────────────────────────────────
// A regra existe e e clara ("uma mencao a data E a resposta a essa
// pergunta"). Mas ela vive entre 42 outras, e hoje ja perdi tres rodadas
// tentando reescrever instrucao para resolver o mesmo tipo de problema.
//
// Casar uma data com o agendamento daquela data nao exige compreender
// linguagem: e comparacao. Lugar do Core.

import type { AlteracoesDados } from './tipos.ts';

/** O que o Core precisa saber de cada agendamento para casar pela data. */
export interface AgendamentoParaEscolha {
  agendamento_id: string;
  /** `YYYY-MM-DD`. */
  data: string;
}

export interface ResultadoAgendamentoPelaData {
  alteracoes: AlteracoesDados;
  /** `true` quando o agendamento foi identificado pela data -- para log. */
  identificou: boolean;
}

/**
 * Escreve `agendamento_id` quando a data mencionada aponta para UM unico
 * agendamento da lista.
 *
 * Nao faz nada quando:
 *   - a IA ja identificou o agendamento (a leitura dela manda);
 *   - o turno nao trouxe data;
 *   - a data nao foi resolvida para um dia concreto;
 *   - a data casa com NENHUM ou com VARIOS agendamentos (ai o sistema
 *     precisa mesmo perguntar -- escolher seria chutar).
 */
export function identificarAgendamentoPelaData(
  alteracoes: AlteracoesDados,
  agendamentos: readonly AgendamentoParaEscolha[] | undefined,
  dataResolvida: string | undefined
): ResultadoAgendamentoPelaData {
  // A IA leu o agendamento -- a leitura dela prevalece.
  if (alteracoes.agendamento_id !== undefined) {
    return { alteracoes, identificou: false };
  }
  if (agendamentos === undefined || agendamentos.length === 0) {
    return { alteracoes, identificou: false };
  }
  if (dataResolvida === undefined || dataResolvida.trim() === '') {
    return { alteracoes, identificou: false };
  }

  const naquelaData = agendamentos.filter((a) => a.data === dataResolvida);
  // Zero: a data nao corresponde a nada -- deixa o sistema perguntar.
  // Varios: dois atendimentos no mesmo dia; escolher seria chutar.
  if (naquelaData.length !== 1) {
    return { alteracoes, identificou: false };
  }

  return {
    alteracoes: {
      ...alteracoes,
      agendamento_id: { acao: 'informar', valor: naquelaData[0].agendamento_id },
    },
    identificou: true,
  };
}
