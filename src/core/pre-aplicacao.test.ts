import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preAplicar } from './pre-aplicacao.ts';

test('teste8: informar em campo ausente e aplicavel', () => {
  const resultado = preAplicar({}, { nome: { acao: 'informar', valor: 'Joao' } });
  assert.deepEqual(resultado.alteracoes_aplicaveis, { nome: { acao: 'informar', valor: 'Joao' } });
  assert.deepEqual(resultado.conflitos, []);
});

test('teste9: informar igual ao valor acumulado e idempotente (aplicavel, sem conflito)', () => {
  const resultado = preAplicar({ nome: 'Joao' }, { nome: { acao: 'informar', valor: 'Joao' } });
  assert.deepEqual(resultado.alteracoes_aplicaveis, { nome: { acao: 'informar', valor: 'Joao' } });
  assert.deepEqual(resultado.conflitos, []);
});

test('teste10: informar diferente gera conflito', () => {
  const resultado = preAplicar(
    { procedimento_texto: 'limpeza' },
    { procedimento_texto: { acao: 'informar', valor: 'clareamento' } }
  );
  assert.deepEqual(resultado.alteracoes_aplicaveis, {});
  assert.deepEqual(resultado.conflitos, [
    { campo: 'procedimento_texto', valor_atual: 'limpeza', valor_informado: 'clareamento' },
  ]);
});

test('teste12: alteracao sem conflito da mesma saida continua aplicavel', () => {
  const resultado = preAplicar(
    { procedimento_texto: 'limpeza' },
    {
      procedimento_texto: { acao: 'informar', valor: 'clareamento' }, // conflita
      data_texto: { acao: 'informar', valor: 'sexta' }, // sem conflito
    }
  );
  assert.deepEqual(resultado.alteracoes_aplicaveis, { data_texto: { acao: 'informar', valor: 'sexta' } });
  assert.equal(resultado.conflitos.length, 1);
  assert.equal(resultado.conflitos[0].campo, 'procedimento_texto');
});

test('teste13: corrigir sempre e aplicavel (autoriza substituicao)', () => {
  const resultado = preAplicar({ nome: 'Joao' }, { nome: { acao: 'corrigir', valor: 'Maria' } });
  assert.deepEqual(resultado.alteracoes_aplicaveis, { nome: { acao: 'corrigir', valor: 'Maria' } });
  assert.deepEqual(resultado.conflitos, []);
});

test('teste14: remocao explicita sempre segue como aplicavel', () => {
  const resultadoExistente = preAplicar({ cpf: '11122233344' }, { cpf: { acao: 'remover' } });
  assert.deepEqual(resultadoExistente.alteracoes_aplicaveis, { cpf: { acao: 'remover' } });
  assert.deepEqual(resultadoExistente.conflitos, []);

  const resultadoInexistente = preAplicar({}, { cpf: { acao: 'remover' } });
  assert.deepEqual(resultadoInexistente.alteracoes_aplicaveis, { cpf: { acao: 'remover' } });
  assert.deepEqual(resultadoInexistente.conflitos, [], 'remover inexistente e aplicavel; aplicarDados trata a idempotencia');
});

test('multiplos campos: alteracoes vazias produzem resultado vazio', () => {
  const resultado = preAplicar({ nome: 'Joao' }, {});
  assert.deepEqual(resultado.alteracoes_aplicaveis, {});
  assert.deepEqual(resultado.conflitos, []);
});
