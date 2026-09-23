import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carregarConfiguracaoPosConsulta, derivarConfiguracaoPosConsulta } from './pos-consulta-carregar-configuracao.ts';
import { ClienteFalso, criarTabelasFalsasVazias } from './teste-cliente-falso.ts';

const CLINICA = '11111111-1111-1111-1111-111111111111';

// ── derivarConfiguracaoPosConsulta (pura) ────────────────────────────────
// Contrato real do painel (D1, quarta revisao): chaves PLANAS em
// `automatizacoes`, confirmado em
// portal-iris-principal/src/app/dashboard/page.tsx (AutomacoesSection).

test('automatizacoes ausente: modo nenhum, nunca lanca', () => {
  assert.deepEqual(derivarConfiguracaoPosConsulta(undefined), { modo: 'nenhum', prazoMinutos: 0 });
  assert.deepEqual(derivarConfiguracaoPosConsulta(null), { modo: 'nenhum', prazoMinutos: 0 });
});

test('automatizacoes sem pos_consulta_tipo: modo nenhum', () => {
  assert.deepEqual(derivarConfiguracaoPosConsulta({ solicitar_email: true }), { modo: 'nenhum', prazoMinutos: 0 });
});

test('pos_consulta_tipo explicito "nenhum" (toggle desligado no painel): modo nenhum', () => {
  assert.deepEqual(
    derivarConfiguracaoPosConsulta({ pos_consulta_tipo: 'nenhum', pos_consulta_tempo: '2h' }),
    { modo: 'nenhum', prazoMinutos: 0 }
  );
});

test('configuracao valida (modo ambos, tempo 4h): extraida e convertida corretamente', () => {
  const resultado = derivarConfiguracaoPosConsulta({
    pos_consulta_tipo: 'ambos',
    pos_consulta_tempo: '4h',
    pos_consulta_google_link: 'https://g.page/r/exemplo/review',
    pos_consulta_mensagem: 'seja breve',
  });
  assert.deepEqual(resultado, {
    modo: 'ambos',
    prazoMinutos: 240,
    linkAvaliacaoGoogle: 'https://g.page/r/exemplo/review',
    orientacoes: 'seja breve',
  });
});

test('conversao deterministica de pos_consulta_tempo: 2h=120, 4h=240, 24h=1440', () => {
  assert.equal(derivarConfiguracaoPosConsulta({ pos_consulta_tipo: 'google', pos_consulta_tempo: '2h' }).prazoMinutos, 120);
  assert.equal(derivarConfiguracaoPosConsulta({ pos_consulta_tipo: 'google', pos_consulta_tempo: '4h' }).prazoMinutos, 240);
  assert.equal(derivarConfiguracaoPosConsulta({ pos_consulta_tipo: 'google', pos_consulta_tempo: '24h' }).prazoMinutos, 1440);
});

test('modo fora do vocabulario fechado: config inteira desligada (falha fechado, nunca so o campo)', () => {
  const resultado = derivarConfiguracaoPosConsulta({
    pos_consulta_tipo: 'sempre',
    pos_consulta_tempo: '2h',
    pos_consulta_google_link: 'https://g.page/r/exemplo/review',
  });
  assert.deepEqual(resultado, { modo: 'nenhum', prazoMinutos: 0 });
});

test('pos_consulta_tempo ausente ou fora do vocabulario fechado: config inteira desligada, mesmo com modo valido', () => {
  assert.deepEqual(derivarConfiguracaoPosConsulta({ pos_consulta_tipo: 'satisfacao' }), {
    modo: 'nenhum',
    prazoMinutos: 0,
  });
  assert.deepEqual(derivarConfiguracaoPosConsulta({ pos_consulta_tipo: 'satisfacao', pos_consulta_tempo: '60' }), {
    modo: 'nenhum',
    prazoMinutos: 0,
  });
  assert.deepEqual(derivarConfiguracaoPosConsulta({ pos_consulta_tipo: 'satisfacao', pos_consulta_tempo: 60 }), {
    modo: 'nenhum',
    prazoMinutos: 0,
  });
  assert.deepEqual(derivarConfiguracaoPosConsulta({ pos_consulta_tipo: 'satisfacao', pos_consulta_tempo: 'sessenta' }), {
    modo: 'nenhum',
    prazoMinutos: 0,
  });
});

test('modo satisfacao nunca exige link -- ausente e valido', () => {
  const resultado = derivarConfiguracaoPosConsulta({ pos_consulta_tipo: 'satisfacao', pos_consulta_tempo: '2h' });
  assert.deepEqual(resultado, { modo: 'satisfacao', prazoMinutos: 120 });
});

test('pos_consulta_mensagem em branco (so espacos) e tratada como ausente', () => {
  const resultado = derivarConfiguracaoPosConsulta({
    pos_consulta_tipo: 'satisfacao',
    pos_consulta_tempo: '2h',
    pos_consulta_mensagem: '   ',
  });
  assert.deepEqual(resultado, { modo: 'satisfacao', prazoMinutos: 120 });
});

// ── carregarConfiguracaoPosConsulta (le do banco) ────────────────────────

test('carrega do banco corretamente quando a clinica existe', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.clinicas.push({
    id: CLINICA,
    automatizacoes: { pos_consulta_tipo: 'google', pos_consulta_tempo: '24h', pos_consulta_google_link: 'https://g.page/r/x' },
  });
  const cliente = new ClienteFalso(tabelas);
  const resultado = await carregarConfiguracaoPosConsulta(cliente, CLINICA);
  assert.deepEqual(resultado, { modo: 'google', prazoMinutos: 1440, linkAvaliacaoGoogle: 'https://g.page/r/x' });
});

test('clinica inexistente: modo nenhum, nunca lanca', async () => {
  const cliente = new ClienteFalso(criarTabelasFalsasVazias());
  const resultado = await carregarConfiguracaoPosConsulta(cliente, CLINICA);
  assert.deepEqual(resultado, { modo: 'nenhum', prazoMinutos: 0 });
});
