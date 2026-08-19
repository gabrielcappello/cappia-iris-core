// Aplica o procedimento que a assistente ACABOU DE ANUNCIAR quando o
// paciente responde sobre data ou horario sem nomear nada.
//
// ── O CASO REAL (2026-08-19) ────────────────────────────────────────────
//   Iris:     "Ficou combinado este procedimento para agendarmos:
//              Ajuste mensal braquetes (dente 36)"
//   Paciente: "pode ser pra segunda feira 15hrs"
//   Iris:     "Qual procedimento ou atendimento voce esta buscando?"
//
// ── A PROVA DE QUE O DADO CHEGAVA ───────────────────────────────────────
// Os logs do turno:
//
//   tratamentos_para_interpretacao recebidos=2 com_dentista=1
//                                  assunto=braces_adjustment
//   interpretacao_tratamentos      no_payload=2 assunto=braces_adjustment
//                                  ia_procedimento=-
//                                  campos=data_texto,horario_texto
//
// O procedimento estava no payload, marcado como assunto. A IA extraiu data
// e horario e simplesmente NAO preencheu `procedimento_id`.
//
// ── POR QUE INSTRUIR NAO RESOLVEU ───────────────────────────────────────
// A instrucao da interpretadora tem 42 regras e ~18 mil caracteres. A regra
// dos tratamentos e uma delas, competindo com todas as outras. Reescreve-la
// mais uma vez seria repetir o que ja falhou tres vezes hoje.
//
// A escolha nao depende de compreender linguagem: se ha UM procedimento
// anunciado e o paciente respondeu sobre quando, e daquele que ele fala.
// Isso e deducao estrutural -- lugar do Core, nao da IA.
//
// ── QUEM PREVALECE ──────────────────────────────────────────────────────
// A IA. Se ela identificou um procedimento (o paciente nomeou outro), essa
// leitura vale. Isto so preenche o VAZIO.

import type { AlteracoesDados } from './tipos.ts';
import type { TratamentoNoPayload } from './dentista-do-tratamento.ts';

/** Campos que indicam resposta sobre QUANDO -- data, horario ou periodo. */
const CAMPOS_TEMPORAIS = ['data_texto', 'horario_texto', 'periodo'] as const;

export interface ResultadoProcedimentoDoAnuncio {
  alteracoes: AlteracoesDados;
  /** `true` quando o procedimento anunciado foi aplicado -- para log. */
  aplicou: boolean;
}

/**
 * Escreve `procedimento_id` com o tratamento ANUNCIADO quando o paciente
 * respondeu sobre data/horario e nenhum procedimento foi identificado.
 *
 * Nao faz nada quando:
 *   - a IA ja identificou um procedimento (a leitura dela manda);
 *   - a conversa ja tem procedimento definido (respeita o que veio antes);
 *   - o turno nao trouxe data, horario nem periodo;
 *   - nenhum tratamento esta marcado como `assunto_atual`.
 */
export function aplicarProcedimentoDoAnuncio(
  alteracoes: AlteracoesDados,
  tratamentos: readonly TratamentoNoPayload[] | undefined,
  snapshotOficial: Record<string, string | undefined>
): ResultadoProcedimentoDoAnuncio {
  // A IA leu um procedimento -- a leitura dela prevalece.
  if (alteracoes.procedimento_id !== undefined) {
    return { alteracoes, aplicou: false };
  }
  // A conversa ja tem um procedimento em curso.
  const jaDefinido = snapshotOficial.procedimento_id;
  if (typeof jaDefinido === 'string' && jaDefinido.trim() !== '') {
    return { alteracoes, aplicou: false };
  }
  if (tratamentos === undefined || tratamentos.length === 0) {
    return { alteracoes, aplicou: false };
  }

  // O turno precisa ser uma resposta sobre QUANDO. Sem isso, "oi" ou uma
  // duvida qualquer passariam a fixar o procedimento sem o paciente ter
  // decidido nada.
  const respondeuSobreQuando = CAMPOS_TEMPORAIS.some(
    (campo) => alteracoes[campo] !== undefined
  );
  if (!respondeuSobreQuando) {
    return { alteracoes, aplicou: false };
  }

  const anunciado = tratamentos.find((t) => t.assunto_atual === true);
  if (anunciado === undefined || anunciado.procedimento_id.trim() === '') {
    return { alteracoes, aplicou: false };
  }

  return {
    alteracoes: {
      ...alteracoes,
      procedimento_id: { acao: 'informar', valor: anunciado.procedimento_id },
    },
    aplicou: true,
  };
}
