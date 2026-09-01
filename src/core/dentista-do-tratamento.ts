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
// O paciente, quando ele REALMENTE nomeou um profissional. Um pedido
// explicito nunca e sobrescrito pela definicao do painel.
//
// ── O DEFEITO DE 2026-09-01: "candidato" NAO e "o paciente escolheu" ─────
//   Plano:    Limpeza dental (profilaxia) -- com Dr. Diego Ramoz
//   Iris:     "Ficou combinado este procedimento (...) com Dr. Diego Ramoz"
//   Paciente: (audio) "pode ser pra hoje"        <- nao cita profissional
//   Iris:     "Para hoje, com o Dr. Diego Perez, tenho estes horarios"
//
// Provado nos logs do turno (12:39:59): `ia_candidatos=2`. O paciente tinha
// agendamento com DOIS profissionais naquele dia (Ramoz 14:10, Perez 16:00),
// e a instrucao de "preferencia natural" faz a IA colocar em
// `dentistas_candidatos` o dentista de um agendamento existente quando o
// paciente pede algo novo sem dizer com quem. Ela devolveu os dois, sem
// escolher -- exatamente como o contrato dela manda ("voce NUNCA escolhe
// entre varios plausiveis").
//
// A guarda antiga lia isso como "o paciente nomeou alguem" e descartava a
// definicao da clinica. Ninguem depois resolvia o empate: o passo seguinte
// (`aplicarCandidatoUnicoDeDentista`) exige exatamente UM candidato. O
// agendamento saiu com o profissional errado.
//
// ── A REGRA (decisao do Gabriel, 2026-09-01) ────────────────────────────
// O dentista do plano e decisao CLINICA da clinica, nao preferencia: quem
// avalia nem sempre executa. Entao candidato so derruba o plano quando e
// escolha inequivoca do paciente -- UM candidato, e diferente do que o plano
// define. Dois ou mais nunca sao escolha: sao a IA em duvida, e ai o plano
// manda.
//
// Distincao ESTRUTURAL (quantidade e identidade), nunca leitura do texto do
// paciente -- `docs/00-principios.md`.

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
 *   - o turno nao identificou procedimento;
 *   - o procedimento nao tem dentista definido;
 *   - ja existe um `dentista_id` na conversa (respeita o que veio antes);
 *   - o paciente escolheu OUTRO profissional de forma inequivoca -- UM
 *     candidato, diferente do que o plano define. Dois ou mais candidatos
 *     sao duvida da IA, nunca escolha, e nao derrubam o plano.
 */
export function aplicarDentistaDoTratamento(
  alteracoes: AlteracoesDados,
  candidatosDaIA: string[] | null,
  tratamentos: readonly TratamentoNoPayload[] | undefined,
  snapshotOficial: Record<string, string | undefined>
): ResultadoDentistaDoTratamento {
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

  // ESCOLHA INEQUIVOCA DO PACIENTE -- e so aqui que o plano cede.
  //
  // UM candidato, diferente do que o plano define: o paciente nomeou outro
  // profissional, e a escolha dele vale.
  //
  // DOIS OU MAIS: a IA nao escolheu, esta em duvida entre plausiveis (o
  // contrato dela proibe escolher). Duvida da IA nunca derruba a definicao
  // clinica -- foi exatamente o defeito de 2026-09-01.
  //
  // UM candidato IGUAL ao do plano: concordam, nada a decidir; segue o plano.
  const escolhaDoPaciente =
    candidatosDaIA !== null &&
    candidatosDaIA.length === 1 &&
    candidatosDaIA[0] !== dentistaId;
  if (escolhaDoPaciente) {
    return { alteracoes, aplicou: false };
  }

  return {
    alteracoes: { ...alteracoes, dentista_id: { acao: 'informar', valor: dentistaId } },
    aplicou: true,
  };
}
