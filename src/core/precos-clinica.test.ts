// Testes de precos-clinica.ts.
//
// O TESTE CENTRAL e o primeiro: o padrao e NAO informar preco. Um valor so
// atravessa para a redatora quando a clinica ligou "INFORMA VALOR?" no
// painel. Tudo o mais aqui existe para garantir que nenhum caminho lateral
// (valor zero, item inativo, dado malformado) vire preco anunciado.

import test from 'node:test';
import assert from 'node:assert/strict';

import { derivarPrecosClinica } from './precos-clinica.ts';

// Itens REAIS do cadastro da ClearDent (2026-08-17): todos com
// mostrar_valor:false, que e o padrao do produto.
const REAIS = [
  { esp: '🦷 Clínico Geral', nome: 'Consulta / Avaliação', ativo: true, tempo: 30, valor: 120, mostrar_valor: false },
  { esp: '🦷 Clínico Geral', nome: 'Limpeza dental (profilaxia)', ativo: true, tempo: 50, valor: 45, mostrar_valor: false },
  { esp: '🔧 Endodontia', nome: 'Canal molar (3+ raízes)', ativo: true, tempo: 90, valor: 1300, mostrar_valor: false },
  { esp: '🔪 Cirurgia', nome: 'Extração complexa / siso', ativo: true, tempo: 90, valor: 0, mostrar_valor: false },
];

test('PADRAO DO PRODUTO: nenhum valor atravessa quando a clinica nao liberou', () => {
  const p = derivarPrecosClinica(REAIS);
  assert.ok(p);
  assert.equal(p.liberados, undefined, 'nenhum preco pode estar liberado no cadastro real');
  assert.equal(p.sob_avaliacao?.length, 4);

  // O numero NUNCA pode aparecer em lugar nenhum do fato.
  const serializado = JSON.stringify(p);
  for (const proibido of ['120', '45', '1300']) {
    assert.ok(!serializado.includes(proibido), `o valor ${proibido} vazou: ${serializado}`);
  }
});

test('a clinica liga "INFORMA VALOR?" e SO esses valores passam', () => {
  const p = derivarPrecosClinica([
    { ...REAIS[1], mostrar_valor: true },   // Limpeza: liberada
    REAIS[2],                                // Canal: nao liberado
  ]);
  assert.deepEqual(p!.liberados, [{ procedimento: 'Limpeza dental (profilaxia)', valor: 'R$ 45,00' }]);
  assert.deepEqual(p!.sob_avaliacao, ['Canal molar (3+ raízes)']);
  assert.ok(!JSON.stringify(p).includes('1300'), 'valor nao liberado vazou');
});

test('valor ZERO nunca vira "R$ 0,00", mesmo liberado -- zero e "ainda nao definido"', () => {
  const p = derivarPrecosClinica([{ ...REAIS[3], mostrar_valor: true }]);
  assert.equal(p!.liberados, undefined);
  assert.deepEqual(p!.sob_avaliacao, ['Extração complexa / siso']);
});

test('valor negativo tambem nao passa', () => {
  const p = derivarPrecosClinica([{ esp: 'X', nome: 'Y', ativo: true, valor: -50, mostrar_valor: true }]);
  assert.equal(p!.liberados, undefined);
});

test('procedimento INATIVO some por completo -- nem como sob_avaliacao', () => {
  const p = derivarPrecosClinica([
    { esp: 'X', nome: 'Desativado', ativo: false, valor: 200, mostrar_valor: true },
  ]);
  assert.equal(p, undefined);
});

test('formatacao em Real, com centavos', () => {
  const p = derivarPrecosClinica([
    { esp: 'X', nome: 'A', ativo: true, valor: 1500, mostrar_valor: true },
    { esp: 'X', nome: 'B', ativo: true, valor: 99.9, mostrar_valor: true },
  ]);
  assert.deepEqual(p!.liberados, [
    { procedimento: 'A', valor: 'R$ 1500,00' },
    { procedimento: 'B', valor: 'R$ 99,90' },
  ]);
});

test('mostrar_valor precisa ser true DE VERDADE -- "true", 1 ou {} nao liberam', () => {
  for (const impostor of ['true', 1, {}, [], 'sim']) {
    const p = derivarPrecosClinica([
      { esp: 'X', nome: 'A', ativo: true, valor: 300, mostrar_valor: impostor },
    ]);
    assert.equal(p!.liberados, undefined, `valor vazou com mostrar_valor=${JSON.stringify(impostor)}`);
  }
});

test('ativo precisa ser true DE VERDADE', () => {
  const p = derivarPrecosClinica([{ esp: 'X', nome: 'A', ativo: 'true', valor: 300, mostrar_valor: true }]);
  assert.equal(p, undefined);
});

test('entrada malformada nunca quebra nem inventa preco', () => {
  assert.equal(derivarPrecosClinica(null), undefined);
  assert.equal(derivarPrecosClinica(undefined), undefined);
  assert.equal(derivarPrecosClinica('texto'), undefined);
  assert.equal(derivarPrecosClinica({}), undefined);
  assert.equal(derivarPrecosClinica([]), undefined);
  assert.equal(derivarPrecosClinica([null, 'x', 42]), undefined);
});

test('item sem nome e ignorado, mesmo com valor liberado', () => {
  const p = derivarPrecosClinica([{ esp: 'X', nome: '  ', ativo: true, valor: 300, mostrar_valor: true }]);
  assert.equal(p, undefined);
});

test('valor nao numerico nao vira preco', () => {
  const p = derivarPrecosClinica([
    { esp: 'X', nome: 'A', ativo: true, valor: '300', mostrar_valor: true },
    { esp: 'X', nome: 'B', ativo: true, valor: NaN, mostrar_valor: true },
  ]);
  assert.equal(p!.liberados, undefined);
  assert.deepEqual(p!.sob_avaliacao, ['A', 'B']);
});

test('cadastro real INTEIRO (46 itens) nao libera nenhum valor', () => {
  // Reproduz a forma do cadastro real: todos ativos, todos mostrar_valor:false.
  const catalogo = Array.from({ length: 46 }, (_, i) => ({
    esp: 'Especialidade', nome: `Procedimento ${i}`, ativo: true, valor: 100 + i, mostrar_valor: false,
  }));
  const p = derivarPrecosClinica(catalogo);
  assert.equal(p!.liberados, undefined);
  assert.equal(p!.sob_avaliacao!.length, 46);
});

test('CENARIO DO PAINEL: liberar SO tres itens de Clinico Geral', () => {
  // Reproduz exatamente o que a tela de configuracao grava quando o dono
  // liga "INFORMA VALOR?" em Limpeza, Restauracao (1 face) e Extracao --
  // os demais da MESMA especialidade continuam sob avaliacao.
  const p = derivarPrecosClinica([
    { esp: '🦷 Clínico Geral', nome: 'Consulta / Avaliação', ativo: true, valor: 120, mostrar_valor: false },
    { esp: '🦷 Clínico Geral', nome: 'Limpeza dental (profilaxia)', ativo: true, valor: 45, mostrar_valor: true },
    { esp: '🦷 Clínico Geral', nome: 'Restauração / Cárie (1 face)', ativo: true, valor: 250, mostrar_valor: true },
    { esp: '🦷 Clínico Geral', nome: 'Restauração / Cárie (2+ faces)', ativo: true, valor: 350, mostrar_valor: false },
    { esp: '🦷 Clínico Geral', nome: 'Extração simples', ativo: true, valor: 250, mostrar_valor: true },
    { esp: '🦷 Clínico Geral', nome: 'Fluoretação', ativo: true, valor: 100, mostrar_valor: false },
  ]);

  assert.deepEqual(p!.liberados, [
    { procedimento: 'Limpeza dental (profilaxia)', valor: 'R$ 45,00' },
    { procedimento: 'Restauração / Cárie (1 face)', valor: 'R$ 250,00' },
    { procedimento: 'Extração simples', valor: 'R$ 250,00' },
  ]);
  assert.deepEqual(p!.sob_avaliacao, [
    'Consulta / Avaliação', 'Restauração / Cárie (2+ faces)', 'Fluoretação',
  ]);

  // Os valores NAO liberados da mesma especialidade nao podem vazar.
  const serializado = JSON.stringify(p);
  for (const proibido of ['120', '350', '100']) {
    assert.ok(!serializado.includes(proibido), `valor nao liberado vazou: ${proibido}`);
  }
});

test('desligar o procedimento zera o preco liberado (regra do painel)', () => {
  // O painel escreve `mostrar_valor: false` ao desativar; mesmo que algum
  // cadastro antigo tenha ficado inconsistente, item inativo nunca vira preco.
  const p = derivarPrecosClinica([
    { esp: 'X', nome: 'Desligado mas liberado', ativo: false, valor: 500, mostrar_valor: true },
  ]);
  assert.equal(p, undefined);
});

// GRATUIDADE (specs/catalogo-avaliacao-obrigatoria-gratuita-v1.md secao
// 2.2) -- escolha EXPLICITA da clinica via campo `gratuito`, nunca inferida
// de valor zerado.

test('gratuito:true vai para gratuitos, nunca liberados nem sob_avaliacao', () => {
  const p = derivarPrecosClinica([
    { esp: '🦷 Clínico Geral', nome: 'Consulta / Avaliação', ativo: true, valor: 120, mostrar_valor: false, gratuito: true },
  ]);
  assert.deepEqual(p!.gratuitos, ['Consulta / Avaliação']);
  assert.equal(p!.liberados, undefined);
  assert.equal(p!.sob_avaliacao, undefined);

  // O valor antigo (120) nunca pode vazar quando o item e gratuito.
  assert.ok(!JSON.stringify(p).includes('120'), 'valor vazou num item gratuito');
});

test('gratuito:true IGNORA mostrar_valor e valor -- nao precisam concordar', () => {
  const p = derivarPrecosClinica([
    { esp: 'X', nome: 'A', ativo: true, valor: 500, mostrar_valor: true, gratuito: true },
  ]);
  assert.deepEqual(p!.gratuitos, ['A']);
  assert.equal(p!.liberados, undefined);
});

test('gratuito:false (ou ausente) segue o fluxo normal de sempre -- comportamento inalterado', () => {
  const semCampo = derivarPrecosClinica([
    { esp: '🦷 Clínico Geral', nome: 'Consulta / Avaliação', ativo: true, valor: 120, mostrar_valor: true },
  ]);
  const comFalse = derivarPrecosClinica([
    { esp: '🦷 Clínico Geral', nome: 'Consulta / Avaliação', ativo: true, valor: 120, mostrar_valor: true, gratuito: false },
  ]);
  for (const p of [semCampo, comFalse]) {
    assert.deepEqual(p!.liberados, [{ procedimento: 'Consulta / Avaliação', valor: 'R$ 120,00' }]);
    assert.equal(p!.gratuitos, undefined);
  }
});

test('valor=0 continua "ainda nao definido", NUNCA vira gratuito por si so', () => {
  // A regra que ja existia (linha 90+ do modulo) nao pode ser revertida em
  // silencio -- so o campo `gratuito` explicito produz `gratuitos`.
  const p = derivarPrecosClinica([{ esp: 'X', nome: 'A', ativo: true, valor: 0, mostrar_valor: true }]);
  assert.equal(p!.gratuitos, undefined);
  assert.deepEqual(p!.sob_avaliacao, ['A']);
});

test('item gratuito porem INATIVO some por completo -- mesma regra de qualquer item inativo', () => {
  const p = derivarPrecosClinica([
    { esp: 'X', nome: 'A', ativo: false, valor: 100, mostrar_valor: false, gratuito: true },
  ]);
  assert.equal(p, undefined);
});

test('gratuito precisa ser true DE VERDADE -- "true", 1 ou {} nao contam', () => {
  for (const impostor of ['true', 1, {}, [], 'sim']) {
    const p = derivarPrecosClinica([{ esp: 'X', nome: 'A', ativo: true, valor: 300, mostrar_valor: true, gratuito: impostor }]);
    assert.equal(p!.gratuitos, undefined, `virou gratuito com gratuito=${JSON.stringify(impostor)}`);
    assert.deepEqual(p!.liberados, [{ procedimento: 'A', valor: 'R$ 300,00' }]);
  }
});

test('varios itens gratuitos e um liberado, misturados', () => {
  const p = derivarPrecosClinica([
    { esp: '🦷 Clínico Geral', nome: 'Consulta / Avaliação', ativo: true, valor: 0, mostrar_valor: false, gratuito: true },
    { esp: '🦷 Clínico Geral', nome: 'Limpeza dental (profilaxia)', ativo: true, valor: 45, mostrar_valor: true },
  ]);
  assert.deepEqual(p!.gratuitos, ['Consulta / Avaliação']);
  assert.deepEqual(p!.liberados, [{ procedimento: 'Limpeza dental (profilaxia)', valor: 'R$ 45,00' }]);
});
