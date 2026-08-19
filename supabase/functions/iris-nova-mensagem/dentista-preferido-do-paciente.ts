// Usa o dentista que ja atende o paciente quando ele pede algo novo sem
// dizer com quem.
//
// ── O CASO REAL (2026-08-19) ────────────────────────────────────────────
//   Paciente: "gostaria de uma limpeza para amanha"
//   Iris:     "prefere com o Dr. Diego Ramoz ou com o Dr. Pablo Arruda?"
//
// O paciente tinha DOIS agendamentos, os dois com o Dr. Diego. Perguntar
// quem faz a limpeza ignora o obvio -- e obriga o paciente a repetir uma
// escolha que ele ja fez.
//
// ── POR QUE A INSTRUCAO NAO BASTOU ──────────────────────────────────────
// A regra JA EXISTE na instrucao ("esse profissional e a preferencia
// natural: coloque o dentista_id dele em dentistas_candidatos") e a IA nao
// a seguiu. E uma entre 42 regras.
//
// Quarta vez hoje que a mesma solucao resolve: procedimento, dentista do
// plano, agendamento pela data -- e agora o dentista preferido. Escolher o
// unico profissional que ja atende o paciente e deducao, nao interpretacao
// de linguagem.
//
// ── QUANDO NAO AGE ──────────────────────────────────────────────────────
// - a IA leu um profissional (o paciente nomeou alguem);
// - a conversa ja tem dentista definido;
// - o paciente tem agendamentos com dentistas DIFERENTES -- ai nao ha
//   preferencia unica, e perguntar e o certo;
// - nao ha agendamento nenhum.

import type { AlteracoesDados } from './tipos.ts';

/** O minimo que o Core precisa saber de cada agendamento do paciente. */
export interface AgendamentoComDentista {
  dentista_id?: string;
}

export interface ResultadoDentistaPreferido {
  alteracoes: AlteracoesDados;
  /** `true` quando o dentista preferido foi aplicado -- para log. */
  aplicou: boolean;
}

/**
 * Escreve `dentista_id` com o profissional que ja atende este paciente,
 * quando ha um so e o turno nao trouxe outro.
 */
export function aplicarDentistaPreferido(
  alteracoes: AlteracoesDados,
  candidatosDaIA: string[] | null,
  agendamentos: readonly AgendamentoComDentista[] | undefined,
  snapshotOficial: Record<string, string | undefined>
): ResultadoDentistaPreferido {
  // O paciente nomeou alguem -- a escolha dele manda.
  if (candidatosDaIA !== null && candidatosDaIA.length > 0) {
    return { alteracoes, aplicou: false };
  }
  // A conversa ja definiu um profissional.
  const jaDefinido = snapshotOficial.dentista_id ?? alteracoes.dentista_id?.valor;
  if (typeof jaDefinido === 'string' && jaDefinido.trim() !== '') {
    return { alteracoes, aplicou: false };
  }
  if (agendamentos === undefined || agendamentos.length === 0) {
    return { alteracoes, aplicou: false };
  }

  const dentistas = new Set(
    agendamentos
      .map((a) => a.dentista_id)
      .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
  );

  // Zero: nenhum agendamento diz quem atendeu.
  // Varios: o paciente ja foi atendido por profissionais diferentes -- nao
  // ha preferencia unica, e escolher um seria decidir por ele.
  if (dentistas.size !== 1) {
    return { alteracoes, aplicou: false };
  }

  const [preferido] = [...dentistas];
  return {
    alteracoes: { ...alteracoes, dentista_id: { acao: 'informar', valor: preferido } },
    aplicou: true,
  };
}
