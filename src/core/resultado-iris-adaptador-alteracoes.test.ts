// Testes do adaptador `informacoes_fornecidas → AlteracoesDados`
// (specs/contexto-conversacional-unificado-v2.md §13, item 1).
//
// SEM LIGAÇÃO COM PRODUÇÃO. Testa só `adaptarInformacoesParaAlteracoes`,
// isolada de `aplicarDados` e de qualquer módulo de produção.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adaptarInformacoesParaAlteracoes } from './resultado-iris-adaptador-alteracoes.ts';
import type { Informacao } from './resultado-iris-tipos.ts';

function assertOk(resultado: { ok: boolean }): asserts resultado is { ok: true; alteracoes: Record<string, unknown> } {
  assert.equal(resultado.ok, true, 'esperado ok');
}

function assertErro(resultado: { ok: boolean }): asserts resultado is { ok: false; erro: string } {
  assert.equal(resultado.ok, false, 'esperado erro');
}

// ── lista vazia ──────────────────────────────────────────────────────────────

test('lista vazia produz AlteracoesDados vazio', () => {
  const resultado = adaptarInformacoesParaAlteracoes([]);
  assertOk(resultado);
  assert.deepEqual(resultado.alteracoes, {});
});

// ── informou → informar ──────────────────────────────────────────────────────

test('informou com valor vira acao informar com o mesmo valor', () => {
  const entrada: Informacao[] = [{ campo: 'nome', operacao: 'informou', valor: 'Maria' }];
  const resultado = adaptarInformacoesParaAlteracoes(entrada);
  assertOk(resultado);
  assert.deepEqual(resultado.alteracoes, { nome: { acao: 'informar', valor: 'Maria' } });
});

// ── corrigiu + valor → corrigir ──────────────────────────────────────────────

test('corrigiu com valor não vazio vira acao corrigir com o mesmo valor', () => {
  const entrada: Informacao[] = [{ campo: 'cpf', operacao: 'corrigiu', valor: '12345678900' }];
  const resultado = adaptarInformacoesParaAlteracoes(entrada);
  assertOk(resultado);
  assert.deepEqual(resultado.alteracoes, { cpf: { acao: 'corrigir', valor: '12345678900' } });
});

// ── corrigiu + null → remover, sem campo valor ──────────────────────────────

test('corrigiu com valor null vira acao remover, sem propriedade valor', () => {
  const entrada: Informacao[] = [{ campo: 'email', operacao: 'corrigiu', valor: null }];
  const resultado = adaptarInformacoesParaAlteracoes(entrada);
  assertOk(resultado);
  assert.deepEqual(resultado.alteracoes, { email: { acao: 'remover' } });
  assert.ok(!('valor' in (resultado.alteracoes.email as object)), 'remover não deve carregar valor');
});

// ── múltiplos campos distintos, cada um traduzido corretamente ─────────────

test('múltiplos campos distintos são traduzidos independentemente', () => {
  const entrada: Informacao[] = [
    { campo: 'nome', operacao: 'informou', valor: 'Maria' },
    { campo: 'cpf', operacao: 'corrigiu', valor: '11122233344' },
    { campo: 'data_nascimento', operacao: 'corrigiu', valor: null },
  ];
  const resultado = adaptarInformacoesParaAlteracoes(entrada);
  assertOk(resultado);
  assert.deepEqual(resultado.alteracoes, {
    nome: { acao: 'informar', valor: 'Maria' },
    cpf: { acao: 'corrigir', valor: '11122233344' },
    data_nascimento: { acao: 'remover' },
  });
});

// ── campo duplicado: recusa a lista inteira ─────────────────────────────────

test('campo duplicado (duas entradas para nome) é recusado inteiro', () => {
  const entrada: Informacao[] = [
    { campo: 'nome', operacao: 'informou', valor: 'Maria' },
    { campo: 'nome', operacao: 'corrigiu', valor: 'Mariana' },
  ];
  const resultado = adaptarInformacoesParaAlteracoes(entrada);
  assertErro(resultado);
  assert.match(resultado.erro, /campo duplicado/);
  assert.match(resultado.erro, /nome/);
});

test('campo duplicado é recusado mesmo quando as duas entradas seriam idênticas', () => {
  const entrada: Informacao[] = [
    { campo: 'cpf', operacao: 'informou', valor: '11122233344' },
    { campo: 'cpf', operacao: 'informou', valor: '11122233344' },
  ];
  const resultado = adaptarInformacoesParaAlteracoes(entrada);
  assertErro(resultado);
  assert.match(resultado.erro, /campo duplicado/);
});

test('campo duplicado não escolhe "última vence" nem "primeira vence" -- a lista inteira é descartada, nada é retornado como alteracoes', () => {
  const entrada: Informacao[] = [
    { campo: 'nome', operacao: 'informou', valor: 'Maria' },
    { campo: 'cpf', operacao: 'informou', valor: '11122233344' },
    { campo: 'nome', operacao: 'corrigiu', valor: 'Mariana' },
  ];
  const resultado = adaptarInformacoesParaAlteracoes(entrada);
  assertErro(resultado);
  assert.ok(!('alteracoes' in resultado));
});

// ── forma exata compatível com AlteracoesDados / aplicar-dados.ts ──────────

test('forma de saída: informar e corrigir sempre têm valor string; remover nunca tem valor', () => {
  const entrada: Informacao[] = [
    { campo: 'nome', operacao: 'informou', valor: 'Maria' },
    { campo: 'cpf', operacao: 'corrigiu', valor: '11122233344' },
    { campo: 'email', operacao: 'corrigiu', valor: null },
  ];
  const resultado = adaptarInformacoesParaAlteracoes(entrada);
  assertOk(resultado);
  assert.equal(typeof (resultado.alteracoes.nome as { valor?: unknown }).valor, 'string');
  assert.equal(typeof (resultado.alteracoes.cpf as { valor?: unknown }).valor, 'string');
  assert.equal((resultado.alteracoes.email as { valor?: unknown }).valor, undefined);
});
