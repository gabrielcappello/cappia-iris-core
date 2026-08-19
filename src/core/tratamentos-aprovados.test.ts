// Testes de tratamentos-aprovados.ts.
//
// O ciclo real: o dentista planeja no odontograma -> gera o orcamento -> o
// paciente aprova -> e ninguem marca. Numa conversa real (2026-08-18) o
// paciente escreveu "ok. vou aprovar o orcamento" e a Iris respondeu pedindo
// qual procedimento ele queria agendar: ela nao sabia do orcamento.
//
// Os casos usam os valores REAIS lidos do banco, incluindo os ids canonicos
// (`canal_anterior`, `baby_tooth_extraction`) e os tempos que fazem a
// diferenca para a clinica: canal 70min, extracao 30min.

import test from 'node:test';
import assert from 'node:assert/strict';

import { derivarTratamentosAprovados, descreverTratamento } from './tratamentos-aprovados.ts';

const REAIS = [
  { descricao: 'Canal dente anterior (1 raiz)', dente: '26', procedimento_id: 'canal_anterior', para_agendar: false },
  { descricao: 'Extração de dente de leite', dente: '33', procedimento_id: 'baby_tooth_extraction', para_agendar: false },
];

test('os tratamentos REAIS do paciente chegam com id canonico e dente', () => {
  const r = derivarTratamentosAprovados(REAIS);
  assert.equal(r?.length, 2);
  assert.deepEqual(r?.[0], {
    procedimento: 'Canal dente anterior (1 raiz)',
    procedimento_id: 'canal_anterior',
    dente: '26',
  });
});

test('o id canonico e o que permite o Core resolver a DURACAO -- nunca pode faltar', () => {
  const r = derivarTratamentosAprovados(REAIS);
  for (const t of r ?? []) {
    assert.ok(t.procedimento_id.trim() !== '', `sem procedimento_id: ${t.procedimento}`);
  }
});

test('item SEM procedimento_id e descartado -- oferecer o que nao se agenda e um beco', () => {
  const r = derivarTratamentosAprovados([
    REAIS[0],
    { descricao: 'Procedimento fora do catalogo', dente: '11', procedimento_id: null },
  ]);
  assert.equal(r?.length, 1);
  assert.equal(r?.[0].procedimento_id, 'canal_anterior');
});

test('NUNCA carrega valor -- preco ja foi combinado entre dentista e paciente', () => {
  const r = derivarTratamentosAprovados([
    { ...REAIS[0], valor: 700, preco: 700 } as never,
  ]);
  const serializado = JSON.stringify(r);
  assert.ok(!serializado.includes('700'), `valor vazou: ${serializado}`);
});

test('marca do DENTISTA vira `indicado_pelo_dentista`', () => {
  const r = derivarTratamentosAprovados([{ ...REAIS[0], para_agendar: true }]);
  assert.equal(r?.[0].indicado_pelo_dentista, true);
});

test('sem a marca, o campo simplesmente nao existe -- ausente, nunca `false`', () => {
  const r = derivarTratamentosAprovados(REAIS);
  assert.equal('indicado_pelo_dentista' in (r?.[0] ?? {}), false);
});

test('`para_agendar` precisa ser true DE VERDADE', () => {
  for (const impostor of ['true', 1, {}, 'sim']) {
    const r = derivarTratamentosAprovados([{ ...REAIS[0], para_agendar: impostor }]);
    assert.equal(r?.[0].indicado_pelo_dentista, undefined);
  }
});

test('duplicata do MESMO procedimento no MESMO dente aparece uma vez so', () => {
  const r = derivarTratamentosAprovados([REAIS[0], REAIS[0]]);
  assert.equal(r?.length, 1);
});

test('mesmo procedimento em dentes DIFERENTES permanece separado -- sao dois atendimentos', () => {
  const r = derivarTratamentosAprovados([
    { descricao: 'Restauração', dente: '11', procedimento_id: 'restoration' },
    { descricao: 'Restauração', dente: '12', procedimento_id: 'restoration' },
  ]);
  assert.equal(r?.length, 2);
});

test('procedimento sem dente ainda e valido', () => {
  const r = derivarTratamentosAprovados([{ descricao: 'Limpeza', procedimento_id: 'cleaning' }]);
  assert.deepEqual(r, [{ procedimento: 'Limpeza', procedimento_id: 'cleaning' }]);
});

test('lista vazia ou malformada nao vira fato', () => {
  assert.equal(derivarTratamentosAprovados([]), undefined);
  assert.equal(derivarTratamentosAprovados(null), undefined);
  assert.equal(derivarTratamentosAprovados(undefined), undefined);
  assert.equal(derivarTratamentosAprovados('texto' as never), undefined);
  assert.equal(derivarTratamentosAprovados([null, 42] as never), undefined);
});

test('descricao vazia e descartada', () => {
  assert.equal(derivarTratamentosAprovados([{ descricao: '  ', procedimento_id: 'x' }]), undefined);
});

test('descricao para a redatora inclui o dente quando ha', () => {
  assert.equal(
    descreverTratamento({ procedimento: 'Canal dente anterior (1 raiz)', procedimento_id: 'canal_anterior', dente: '26' }),
    'Canal dente anterior (1 raiz) (dente 26)'
  );
  assert.equal(
    descreverTratamento({ procedimento: 'Limpeza', procedimento_id: 'cleaning' }),
    'Limpeza'
  );
});
