// Primitivas de intervalo semiaberto.
//
// Fonte: specs/disponibilidade.md secao 3 · cenario DIS-10 de
// tests/cenarios-obrigatorios.md.
//
// Todos os dados sao sinteticos. Nenhum dado real de paciente ou clinica.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IntervaloMinutos } from './disponibilidade-tipos.ts';
import {
  contido,
  extensao,
  intervaloInvertidoOuVazio,
  minutoNoDominio,
  ordenarIntervalos,
  sobrepoe,
  subtrairIntervalos,
  unirIntervalos,
} from './intervalo.ts';

function iv(inicio_min: number, fim_min: number): IntervaloMinutos {
  return { inicio_min, fim_min };
}

// =====================================================================
// Sobreposicao (secao 3)
// =====================================================================

test('DIS-10: adjacencia nao e sobreposicao', () => {
  assert.equal(sobrepoe(iv(480, 540), iv(540, 600)), false);
  assert.equal(sobrepoe(iv(540, 600), iv(480, 540)), false);
});

test('sobreposicao exige ao menos um minuto interno em comum', () => {
  assert.equal(sobrepoe(iv(480, 600), iv(539, 600)), true);
  assert.equal(sobrepoe(iv(480, 600), iv(480, 481)), true);
  assert.equal(sobrepoe(iv(480, 600), iv(599, 700)), true);
  assert.equal(sobrepoe(iv(480, 600), iv(600, 601)), false);
});

test('sobreposicao e simetrica', () => {
  const pares: ReadonlyArray<readonly [IntervaloMinutos, IntervaloMinutos]> = [
    [iv(480, 600), iv(540, 660)],
    [iv(480, 600), iv(600, 660)],
    [iv(480, 600), iv(490, 500)],
    [iv(480, 600), iv(700, 800)],
  ];
  for (const [a, b] of pares) {
    assert.equal(sobrepoe(a, b), sobrepoe(b, a));
  }
});

test('contido admite bordas coincidentes', () => {
  assert.equal(contido(iv(480, 600), iv(480, 600)), true);
  assert.equal(contido(iv(490, 590), iv(480, 600)), true);
  assert.equal(contido(iv(480, 601), iv(480, 600)), false);
  assert.equal(contido(iv(479, 600), iv(480, 600)), false);
});

test('extensao e a diferenca em minutos', () => {
  assert.equal(extensao(iv(480, 720)), 240);
  assert.equal(extensao(iv(480, 480)), 0);
});

// =====================================================================
// Dominio
// =====================================================================

test('o dominio do minuto e [0, 1440] inteiro', () => {
  assert.equal(minutoNoDominio(0), true);
  assert.equal(minutoNoDominio(1440), true);
  assert.equal(minutoNoDominio(-1), false);
  assert.equal(minutoNoDominio(1441), false);
  assert.equal(minutoNoDominio(90.5), false);
  assert.equal(minutoNoDominio(Number.NaN), false);
  assert.equal(minutoNoDominio(Number.POSITIVE_INFINITY), false);
});

test('intervalo invertido ou vazio e reconhecido sem correcao silenciosa', () => {
  assert.equal(intervaloInvertidoOuVazio(iv(600, 480)), true);
  assert.equal(intervaloInvertidoOuVazio(iv(480, 480)), true);
  assert.equal(intervaloInvertidoOuVazio(iv(480, 481)), false);
});

// =====================================================================
// Uniao
// =====================================================================

test('uniao junta sobrepostos E adjacentes', () => {
  assert.deepEqual(unirIntervalos([iv(480, 720), iv(720, 1080)]), [iv(480, 1080)]);
  assert.deepEqual(unirIntervalos([iv(480, 720), iv(600, 1080)]), [iv(480, 1080)]);
});

test('uniao preserva blocos separados por lacuna', () => {
  assert.deepEqual(unirIntervalos([iv(480, 720), iv(780, 1080)]), [iv(480, 720), iv(780, 1080)]);
});

test('uniao absorve intervalo totalmente contido em outro', () => {
  assert.deepEqual(unirIntervalos([iv(480, 1080), iv(600, 660)]), [iv(480, 1080)]);
});

test('uniao nao depende da ordem de entrada', () => {
  const entradas = [iv(780, 1080), iv(480, 720), iv(600, 800)];
  assert.deepEqual(unirIntervalos(entradas), unirIntervalos([...entradas].reverse()));
  assert.deepEqual(unirIntervalos(entradas), [iv(480, 1080)]);
});

test('ordenacao e por inicio e desempata por fim', () => {
  assert.deepEqual(ordenarIntervalos([iv(480, 700), iv(480, 600), iv(400, 900)]), [
    iv(400, 900),
    iv(480, 600),
    iv(480, 700),
  ]);
});

// =====================================================================
// Subtracao
// =====================================================================

test('subtracao de ocupacao central parte o intervalo em dois', () => {
  assert.deepEqual(subtrairIntervalos([iv(480, 1080)], [iv(720, 780)]), [
    iv(480, 720),
    iv(780, 1080),
  ]);
});

test('DIS-10: ocupacao adjacente nao remove nada', () => {
  assert.deepEqual(subtrairIntervalos([iv(480, 720)], [iv(720, 780)]), [iv(480, 720)]);
  assert.deepEqual(subtrairIntervalos([iv(480, 720)], [iv(420, 480)]), [iv(480, 720)]);
});

test('subtracao corta somente a intersecao quando a ocupacao extrapola a base', () => {
  assert.deepEqual(subtrairIntervalos([iv(480, 720)], [iv(360, 540)]), [iv(540, 720)]);
  assert.deepEqual(subtrairIntervalos([iv(480, 720)], [iv(660, 900)]), [iv(480, 660)]);
});

test('ocupacao que cobre a base elimina o intervalo', () => {
  assert.deepEqual(subtrairIntervalos([iv(480, 720)], [iv(400, 900)]), []);
  assert.deepEqual(subtrairIntervalos([iv(480, 720)], [iv(480, 720)]), []);
});

test('subtracao acumula multiplas ocupacoes e nao depende da ordem', () => {
  const base = [iv(480, 1080)];
  const ocupacoes = [iv(720, 780), iv(540, 600), iv(900, 960)];
  const esperado = [iv(480, 540), iv(600, 720), iv(780, 900), iv(960, 1080)];

  assert.deepEqual(subtrairIntervalos(base, ocupacoes), esperado);
  assert.deepEqual(subtrairIntervalos(base, [...ocupacoes].reverse()), esperado);
});

test('ocupacoes sobrepostas entre si sao normalizadas antes da subtracao', () => {
  assert.deepEqual(subtrairIntervalos([iv(480, 1080)], [iv(600, 800), iv(700, 900)]), [
    iv(480, 600),
    iv(900, 1080),
  ]);
});

test('subtracao sem ocupacao devolve a base intacta', () => {
  assert.deepEqual(subtrairIntervalos([iv(480, 720), iv(780, 1080)], []), [
    iv(480, 720),
    iv(780, 1080),
  ]);
});

test('subtracao nao muta a base recebida', () => {
  const base = [iv(480, 1080)];
  const copia = structuredClone(base);

  subtrairIntervalos(base, [iv(600, 660)]);

  assert.deepEqual(base, copia);
});
