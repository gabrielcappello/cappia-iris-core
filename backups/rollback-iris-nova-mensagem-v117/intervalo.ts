// Operacoes puras sobre intervalos semiabertos `[inicio_min, fim_min)`.
//
// Contrato: specs/disponibilidade.md secao 3. Este e o UNICO lugar do
// projeto onde "sobreposicao" e definida -- nunca manter duas definicoes
// diferentes.

import { MINUTO_MAXIMO, MINUTO_MINIMO, type IntervaloMinutos } from './disponibilidade-tipos.ts';

/**
 * Sobreposicao de intervalos SEMIABERTOS.
 *
 * `a` e `b` se sobrepoem sse compartilham ao menos um minuto interno:
 *
 *     a.inicio < b.fim  E  b.inicio < a.fim
 *
 * **Adjacencia nao e sobreposicao** (secao 3): `[08:00, 09:00)` e
 * `[09:00, 10:00)` nao se sobrepoem, entao um atendimento pode terminar
 * exatamente quando outro comeca, e comecar exatamente quando um bloqueio
 * termina.
 */
export function sobrepoe(a: IntervaloMinutos, b: IntervaloMinutos): boolean {
  return a.inicio_min < b.fim_min && b.inicio_min < a.fim_min;
}

/** `interno` cabe integralmente dentro de `externo` (bordas inclusive). */
export function contido(interno: IntervaloMinutos, externo: IntervaloMinutos): boolean {
  return interno.inicio_min >= externo.inicio_min && interno.fim_min <= externo.fim_min;
}

/** Extensao em minutos. */
export function extensao(intervalo: IntervaloMinutos): number {
  return intervalo.fim_min - intervalo.inicio_min;
}

/**
 * Intervalo estruturalmente valido: minutos inteiros dentro de
 * `[0, 1440]`, com `inicio < fim`.
 *
 * Um intervalo que atravessaria a meia-noite nao e autorizado pela spec e
 * cai aqui como fora do dominio -- nunca e "corrigido" partindo-se em dois.
 */
export function minutoNoDominio(minuto: number): boolean {
  return Number.isInteger(minuto) && minuto >= MINUTO_MINIMO && minuto <= MINUTO_MAXIMO;
}

export function intervaloInvertidoOuVazio(intervalo: IntervaloMinutos): boolean {
  return intervalo.inicio_min >= intervalo.fim_min;
}

/**
 * Ordenacao canonica: por inicio, desempatando por fim. Deterministica --
 * o resultado nunca depende da ordem em que os intervalos chegaram.
 */
export function ordenarIntervalos<T extends IntervaloMinutos>(intervalos: readonly T[]): T[] {
  return [...intervalos].sort((a, b) =>
    a.inicio_min !== b.inicio_min ? a.inicio_min - b.inicio_min : a.fim_min - b.fim_min
  );
}

/**
 * Une intervalos sobrepostos E adjacentes num conjunto normalizado
 * (secao 3: "Unir adjacentes").
 *
 * Duas jornadas contiguas `[08:00,12:00)` e `[12:00,18:00)` viram
 * `[08:00,18:00)` -- e por isso a grade nao reinicia artificialmente no
 * meio de um bloco continuo de trabalho. Jornadas separadas por almoco
 * permanecem separadas, porque nao sao adjacentes.
 */
export function unirIntervalos(intervalos: readonly IntervaloMinutos[]): IntervaloMinutos[] {
  const ordenados = ordenarIntervalos(intervalos);
  const unidos: IntervaloMinutos[] = [];

  for (const atual of ordenados) {
    const ultimo = unidos[unidos.length - 1];
    // `<=` porque adjacentes tambem se unem: fim de um igual ao inicio do
    // seguinte forma um bloco continuo.
    if (ultimo && atual.inicio_min <= ultimo.fim_min) {
      unidos[unidos.length - 1] = {
        inicio_min: ultimo.inicio_min,
        fim_min: Math.max(ultimo.fim_min, atual.fim_min),
      };
    } else {
      unidos.push({ inicio_min: atual.inicio_min, fim_min: atual.fim_min });
    }
  }

  return unidos;
}

/**
 * Subtrai `remover` de `base`, preservando a convencao semiaberta.
 *
 * Uma ocupacao adjacente nao remove nada; uma ocupacao parcialmente fora da
 * jornada so corta a parte que efetivamente intersecta; uma ocupacao que
 * cobre a base inteira elimina o intervalo.
 */
export function subtrairIntervalos(
  base: readonly IntervaloMinutos[],
  remover: readonly IntervaloMinutos[]
): IntervaloMinutos[] {
  const removerNormalizado = unirIntervalos(remover);
  let restante = base.map((i) => ({ inicio_min: i.inicio_min, fim_min: i.fim_min }));

  for (const bloqueio of removerNormalizado) {
    const proximo: IntervaloMinutos[] = [];
    for (const intervalo of restante) {
      if (!sobrepoe(intervalo, bloqueio)) {
        proximo.push(intervalo);
        continue;
      }
      // Sobra a esquerda, quando existir.
      if (intervalo.inicio_min < bloqueio.inicio_min) {
        proximo.push({ inicio_min: intervalo.inicio_min, fim_min: bloqueio.inicio_min });
      }
      // Sobra a direita, quando existir.
      if (bloqueio.fim_min < intervalo.fim_min) {
        proximo.push({ inicio_min: bloqueio.fim_min, fim_min: intervalo.fim_min });
      }
    }
    restante = proximo;
  }

  return ordenarIntervalos(restante);
}
