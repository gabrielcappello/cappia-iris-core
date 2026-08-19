// Impede que uma mensagem SEM mencao a profissional vire "nao encontrei esse
// profissional".
//
// ── O CASO REAL (2026-08-19) ────────────────────────────────────────────
//   Iris:     "Ficou combinado este procedimento para agendarmos:
//              Canal molar (3+ raizes) (dente 26)"
//   Paciente: "perfeito, sim vamos agendar para sexta feira 10hrs"
//   Iris:     "Nao encontrei esse profissional aqui. Para esse atendimento
//              temos: Dr. Diego Ramoz, Dr. Pablo Arruda. Qual voce prefere?"
//
// O Core tinha entendido tudo -- `data_texto: "sexta feira"`,
// `horario_texto: "10:00"`, `procedimento_id: "canal_molar"`. O que
// atravessou errado foi `dentistas_candidatos: []`.
//
// ── POR QUE ISSO ACONTECE ───────────────────────────────────────────────
// O contrato distingue duas coisas parecidas demais:
//
//   null -> "o paciente nao falou de profissional"
//   []   -> "falou de alguem que NAO EXISTE nesta clinica"
//
// `[]` faz o Core emitir `preferencia_nao_localizada`, que a redatora
// traduz em "nao encontrei esse profissional". Um `[]` indevido inventa uma
// mencao que nunca houve e trava a conversa: o paciente respondeu data e
// horario, e recebeu de volta uma pergunta sobre alguem que ele nao citou.
//
// A instrucao ja pedia `null` nesse caso. Instrucao sozinha nao bastou --
// mesma licao de `guarda-nome-escolha-dentista.ts`, e por isso a protecao
// vive aqui, no Core.
//
// ── O CRITERIO ──────────────────────────────────────────────────────────
// Nao tentamos interpretar portugues: isso seria repetir o erro que a IA
// acabou de cometer. A guarda usa um fato ESTRUTURAL do proprio turno -- se
// a IA extraiu data, horario, periodo ou confirmacao E devolveu `[]`, a
// mensagem era sobre AGENDAR, nao sobre escolher profissional. Nesse caso
// `[]` e tratado como `null`.
//
// Quando a mensagem so tem `[]` e mais nada, a guarda NAO intervem: pode ser
// mesmo um nome que nao existe ("quero com a Dra. Marta"), e esse caso
// precisa continuar funcionando.

import type { AlteracoesDados } from './tipos.ts';

/**
 * Campos cuja presenca indica que o turno tratava de AGENDAR -- data,
 * horario, periodo ou uma confirmacao. Nenhum deles nomeia profissional.
 */
const CAMPOS_DE_AGENDAMENTO = ['data_texto', 'horario_texto', 'periodo', 'confirmacao'] as const;

export interface ResultadoGuardaListaVazia {
  /** `null` quando a lista vazia foi descartada; senao o valor original. */
  candidatos: string[] | null;
  /** `true` quando a guarda interveio -- para log/telemetria. */
  descartou: boolean;
}

/**
 * Converte `[]` em `null` quando o turno era claramente sobre agendamento.
 *
 * `null` e `[varios]` passam intactos: a guarda so olha o caso `[]`, que e o
 * unico capaz de produzir "nao encontrei esse profissional".
 */
export function descartarListaVaziaSemMencao(
  candidatos: string[] | null,
  alteracoes: AlteracoesDados
): ResultadoGuardaListaVazia {
  if (candidatos === null || candidatos.length > 0) {
    return { candidatos, descartou: false };
  }

  const turnoEraSobreAgendar = CAMPOS_DE_AGENDAMENTO.some(
    (campo) => (alteracoes as Record<string, unknown>)[campo] !== undefined
  );

  return turnoEraSobreAgendar
    ? { candidatos: null, descartou: true }
    : { candidatos, descartou: false };
}
