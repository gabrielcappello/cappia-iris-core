// Leitura de `estado_conversa.aguardando_resposta` -- a pergunta que a Iris de
// fato fez no turno anterior (spec contexto-conversacional-unificado-v2.md
// secoes 14.5 e 14.6).
//
// ── PARA QUE ESTE CAMPO EXISTE ──────────────────────────────────────────
// Hoje a Iris nao tem registro estrutural do que ela mesma perguntou: quando
// o paciente responde "o primeiro", o unico jeito de saber a que ele se
// refere e deduzir do texto da conversa. Este campo e a anotacao explicita --
// "eu perguntei X" -- gravada por quem sabe o fato e lida no turno seguinte.
//
// ── REGIME DE FALHA: FECHADA, ao contrario de contexto_horarios ─────────
// `contexto_horarios` degrada para `null` quando vem malformado (falha
// ABERTA), porque e so contexto auxiliar de interpretacao -- nada operacional
// depende dele.
//
// Aqui NAO. `null` significa "nao ha pergunta em aberto", que e uma AFIRMACAO
// FACTUAL: dado corrompido nao pode virar essa afirmacao. Este campo e a
// ancora que autoriza montar `agendamento_em_remarcacao`/
// `agendamento_a_cancelar` (spec secao 8) e, na rota com efeito, e a
// autorizacao que a RPC transacional exige. Converter corrompido em "nao ha
// pergunta" faria o turno seguinte decidir sobre uma premissa inventada.
//
// Por isso a leitura tem TRES resultados, nunca dois:
//   - `ausente`  -- coluna nula/indefinida. Caso NORMAL, nao e recusa;
//   - `presente` -- valor valido, ja tipado como `PerguntaPendente`;
//   - `invalido` -- malformado. O chamador desvia para a rota V1 naquele turno
//                   (piloto) e, apos o corte, falha fechado.
//
// A validacao de forma vive em `validarPerguntaPendente`
// (resultado-iris-validador.ts) e nao e reimplementada aqui: este modulo so
// traduz o resultado dela para o vocabulario de leitura acima.

import { validarPerguntaPendente } from './resultado-iris-validador.ts';
import type { PerguntaPendente } from './contexto-unificado-tipos.ts';

/**
 * Resultado da leitura da coluna. Os tres casos sao distintos de proposito --
 * ver o bloco "REGIME DE FALHA" acima.
 */
export type LeituraAguardandoResposta =
  | { situacao: 'ausente' }
  | { situacao: 'presente'; pergunta: PerguntaPendente }
  | { situacao: 'invalido'; motivo: string };

/**
 * Le o valor bruto da coluna (jsonb) e classifica.
 *
 * `null`/`undefined` sao o caso normal de "nenhuma pergunta em aberto" --
 * jamais confundidos com dado corrompido.
 */
export function lerAguardandoResposta(bruto: unknown): LeituraAguardandoResposta {
  if (bruto === null || bruto === undefined) {
    return { situacao: 'ausente' };
  }

  const validacao = validarPerguntaPendente(bruto);
  if (!validacao.ok) {
    return { situacao: 'invalido', motivo: validacao.erro };
  }

  return { situacao: 'presente', pergunta: validacao.valor };
}

/**
 * Atalho para os consumidores que so precisam do valor utilizavel e ja
 * trataram o caso `invalido` antes (desviando o turno).
 *
 * NAO usar para decidir rota: `invalido` e `ausente` devolvem `null` aqui, e
 * essa e exatamente a confusao que `lerAguardandoResposta` existe para
 * impedir. Serve apenas depois que a distincao ja foi feita.
 */
export function perguntaOuNull(leitura: LeituraAguardandoResposta): PerguntaPendente | null {
  return leitura.situacao === 'presente' ? leitura.pergunta : null;
}
