// Geracao canonica de horarios a partir de UM intervalo livre.
//
// Contrato: specs/disponibilidade.md secoes 5, 6 e 7. Esta funcao e a
// transcricao literal do pseudocodigo publicado na secao 6 -- nenhuma
// regra adicional, nenhuma simplificacao.

import type { IntervaloMinutos } from './disponibilidade-tipos.ts';
import { extensao } from './intervalo.ts';

/**
 * Limite canonico entre intervalo CURTO e AMPLO (secoes 4, 5 e 6).
 *
 * Refere-se a EXTENSAO DO INTERVALO LIVRE -- nunca a duracao do
 * procedimento, ao horizonte de busca, a TTL ou a validade da opcao
 * (secao 4). O limite antigo de 180 minutos nao existe mais.
 */
const LIMITE_INTERVALO_CURTO_MIN = 120;

/** Passo da grade regular: hora a hora, INDEPENDENTEMENTE da duracao. */
const PASSO_GRADE_MIN = 60;

/**
 * Folga minima entre o inicio real e a primeira hora cheia da grade
 * (secao 6, passo 2). E o que impede os minutos quebrados de se propagarem
 * (secao 7).
 */
const FOLGA_PRIMEIRA_HORA_CHEIA_MIN = 30;

/**
 * Primeira hora cheia igual ou posterior a `inicio + 30min` (secao 6,
 * passo 2).
 *
 * E esta regra que faz a grade RETORNAR a hora cheia em vez de propagar o
 * minuto quebrado do inicio: para inicio 15:10 a grade segue em 16:00, nao
 * em 16:10. Para inicio 08:40, a hora cheia 09:00 esta a apenas 20 minutos
 * e nao e apresentada -- a grade retorna em 10:00 (secao 7).
 */
function primeiraHoraCheia(inicio_min: number): number {
  const minimo = inicio_min + FOLGA_PRIMEIRA_HORA_CHEIA_MIN;
  return Math.ceil(minimo / PASSO_GRADE_MIN) * PASSO_GRADE_MIN;
}

function ordenarEDeduplicar(minutos: readonly number[]): number[] {
  return [...new Set(minutos)].sort((a, b) => a - b);
}

/**
 * Gera os inicios canonicos de UM intervalo livre `[I, F)` para a duracao
 * `D`, em minutos locais.
 *
 * Transcricao do pseudocodigo da secao 6:
 *
 *     T = F − I
 *     se T < D: retornar []
 *     L = F − D
 *     se T <= 120: retornar ordenar_e_deduplicar([I, L])
 *     G = [I]
 *     regulares = []
 *     H = primeira hora cheia >= I + 30min
 *     enquanto H + D <= F:
 *         regulares.anexar(H); H = H + 60min
 *     G = G + regulares
 *     se L nao esta em G:
 *         se regulares nao vazio: G[ultimo] = L
 *         senao:                  G.anexar(L)
 *     retornar ordenar_e_deduplicar(G)
 *
 * Garantias da spec preservadas literalmente:
 *
 * - **o inicio real nunca e removido** -- so um horario REGULAR pode ser
 *   substituido por `L`; quando nao ha regular, `L` e ACRESCENTADO (por
 *   isso 08:00–11:00 com D150 devolve `08:00, 08:30`, nunca so `08:00`);
 * - o passo e hora a hora independentemente da duracao, nunca
 *   `max(60, duracao)`;
 * - as opcoes podem se sobrepor entre si: sao alternativas mutuamente
 *   excludentes, e um horario nunca e removido por sobrepor outro;
 * - toda opcao cabe integralmente no intervalo.
 *
 * A regra vale para QUALQUER intervalo valido -- nada aqui depende de a
 * jornada comecar as 08:00 ou terminar as 12:00.
 */
export function gerarIniciosCanonicos(intervalo: IntervaloMinutos, duracao_min: number): number[] {
  const { inicio_min: I, fim_min: F } = intervalo;
  const T = extensao(intervalo);

  if (T < duracao_min) return [];

  const L = F - duracao_min;

  // Intervalo curto (secao 5): somente o inicio real e o ultimo inicio
  // possivel. Quando a extensao e exatamente igual a duracao, `L === I` e a
  // deduplicacao deixa so o inicio.
  if (T <= LIMITE_INTERVALO_CURTO_MIN) {
    return ordenarEDeduplicar([I, L]);
  }

  // Intervalo amplo (secao 6).
  const regulares: number[] = [];
  let H = primeiraHoraCheia(I);
  while (H + duracao_min <= F) {
    regulares.push(H);
    H += PASSO_GRADE_MIN;
  }

  const G = [I, ...regulares];

  if (!G.includes(L)) {
    if (regulares.length > 0) {
      // Substitui o ULTIMO REGULAR -- o inicio real permanece intacto.
      G[G.length - 1] = L;
    } else {
      // Sem regular algum: acrescenta sem remover o inicio real.
      G.push(L);
    }
  }

  return ordenarEDeduplicar(G);
}

/**
 * Gera os inicios canonicos de VARIOS intervalos livres, ja ordenados e
 * deduplicados no conjunto.
 *
 * Intervalos distintos podem, em tese, produzir o mesmo inicio; a
 * deduplicacao global garante unicidade da lista apresentada.
 */
export function gerarIniciosDeIntervalos(
  intervalos: readonly IntervaloMinutos[],
  duracao_min: number
): number[] {
  const todos: number[] = [];
  for (const intervalo of intervalos) {
    todos.push(...gerarIniciosCanonicos(intervalo, duracao_min));
  }
  return ordenarEDeduplicar(todos);
}
