// Aplica o dentista que o profissional DEFINIU no painel para o tratamento
// que o paciente acabou de escolher.
//
// ── O CASO REAL (2026-08-19) ────────────────────────────────────────────
//   Painel:   dentista define "Dr. Diego Ramoz" para o Canal pre-molar
//   Iris:     "Ficou combinado: Canal pre-molar (2 raizes) (dente 12)"
//   Paciente: "sexta 16hrs"
//   Iris:     "voce prefere o Dr. Diego Ramoz ou o Dr. Pablo Arruda?"
//
// O `dentista_id` chegava ao payload da interpretadora -- verificado: o
// objeto enviado tinha `dentista_id` e `assunto_atual: true`. Mesmo assim a
// pergunta acontecia.
//
// ── POR QUE A INSTRUCAO NAO BASTOU ──────────────────────────────────────
// `dentistas_candidatos` responde a UMA pergunta, escrita no contrato:
// "quando o paciente menciona um profissional, a quem ele se refere?". E
// exige copiar de `dentistas_disponiveis`. O paciente NAO mencionou
// ninguem -- entao a IA devolve `null`, obedecendo a regra principal.
//
// Pedir que ela copie um dentista que o paciente nao citou contradiz o
// proprio campo. A escolha do painel nao e interpretacao de linguagem: e um
// FATO do banco. Por isso ela e aplicada aqui, no Core, depois da IA.
//
// ── QUEM PREVALECE ──────────────────────────────────────────────────────
// O paciente. Se ele nomeou um profissional (a IA devolveu candidatos), essa
// escolha vale -- inclusive quando difere da do painel. Um pedido explicito
// nunca e sobrescrito por um padrao.

import type { AlteracoesDados } from './tipos.ts';
/**
 * A forma como o tratamento chega no PAYLOAD da interpretadora -- `nome_pt`
 * em vez de `procedimento`. Aceitamos esse formato (e nao
 * `TratamentoAprovado`) porque e o objeto que ja existe neste ponto do
 * fluxo: converter de volta so para satisfazer um tipo seria ruido.
 */
export interface TratamentoNoPayload {
  procedimento_id: string;
  nome_pt: string;
  dente?: string;
  dentista_id?: string;
  assunto_atual?: true;
}

export interface ResultadoDentistaDoTratamento {
  alteracoes: AlteracoesDados;
  /** `true` quando o dentista do painel foi aplicado -- para log. */
  aplicou: boolean;
}

/**
 * Escreve `dentista_id` quando o procedimento escolhido tem um profissional
 * definido no painel e o paciente nao pediu outro.
 *
 * Nao faz nada quando:
 *   - a IA ja devolveu candidatos (o paciente nomeou alguem);
 *   - o turno nao identificou procedimento;
 *   - o procedimento nao tem dentista definido;
 *   - ja existe um `dentista_id` na conversa (respeita o que veio antes).
 */
export function aplicarDentistaDoTratamento(
  alteracoes: AlteracoesDados,
  candidatosDaIA: string[] | null,
  tratamentos: readonly TratamentoNoPayload[] | undefined,
  snapshotOficial: Record<string, string | undefined>
): ResultadoDentistaDoTratamento {
  // O paciente nomeou alguem -- a escolha dele manda.
  if (candidatosDaIA !== null && candidatosDaIA.length > 0) {
    return { alteracoes, aplicou: false };
  }
  if (tratamentos === undefined || tratamentos.length === 0) {
    return { alteracoes, aplicou: false };
  }
  // A conversa ja tem um profissional definido -- nao sobrescreve.
  const jaDefinido = snapshotOficial.dentista_id;
  if (typeof jaDefinido === 'string' && jaDefinido.trim() !== '') {
    return { alteracoes, aplicou: false };
  }

  // O procedimento deste turno: o que a IA acabou de identificar, ou o que
  // ja estava na conversa.
  const procedimentoId =
    alteracoes.procedimento_id?.valor ?? snapshotOficial.procedimento_id;
  if (typeof procedimentoId !== 'string' || procedimentoId.trim() === '') {
    return { alteracoes, aplicou: false };
  }

  const tratamento = tratamentos.find((t) => t.procedimento_id === procedimentoId);
  const dentistaId = tratamento?.dentista_id;
  if (dentistaId === undefined || dentistaId.trim() === '') {
    return { alteracoes, aplicou: false };
  }

  return {
    alteracoes: { ...alteracoes, dentista_id: { acao: 'informar', valor: dentistaId } },
    aplicou: true,
  };
}
