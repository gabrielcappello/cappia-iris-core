import assert from 'node:assert/strict';
import { test } from 'node:test';
import { montarFatosTemporais } from './montar-fatos-temporais.ts';

test('nenhum dado: lista vazia', () => {
  assert.deepEqual(montarFatosTemporais({}), []);
});

test('hoje: data_relativa + intencao data_especifica', () => {
  assert.deepEqual(montarFatosTemporais({ data_texto: 'hoje' }), [
    { tipo: 'data_relativa', valor: 'hoje' },
    { tipo: 'intencao', valor: 'data_especifica' },
  ]);
});

test('amanha (com til) normaliza igual amanha sem til', () => {
  assert.deepEqual(montarFatosTemporais({ data_texto: 'amanhã' }), [
    { tipo: 'data_relativa', valor: 'amanha' },
    { tipo: 'intencao', valor: 'data_especifica' },
  ]);
  assert.deepEqual(montarFatosTemporais({ data_texto: 'Amanha' }), [
    { tipo: 'data_relativa', valor: 'amanha' },
    { tipo: 'intencao', valor: 'data_especifica' },
  ]);
});

test('data explicita DD/MM: ano null (ano omitido)', () => {
  assert.deepEqual(montarFatosTemporais({ data_texto: '15/08' }), [
    { tipo: 'data_absoluta', dia: 15, mes: 8, ano: null },
    { tipo: 'intencao', valor: 'data_especifica' },
  ]);
});

test('data explicita DD/MM/AAAA: ano preenchido', () => {
  assert.deepEqual(montarFatosTemporais({ data_texto: '15/08/2026' }), [
    { tipo: 'data_absoluta', dia: 15, mes: 8, ano: 2026 },
    { tipo: 'intencao', valor: 'data_especifica' },
  ]);
});

test('texto de data fora do vocabulario simples (dia da semana): nenhum atomo de data', () => {
  assert.deepEqual(montarFatosTemporais({ data_texto: 'sexta que vem' }), []);
});

test('periodo manha/tarde: atomo proprio, passthrough do valor ja canonico', () => {
  assert.deepEqual(montarFatosTemporais({ periodo: 'manha' }), [{ tipo: 'periodo', valor: 'manha' }]);
  assert.deepEqual(montarFatosTemporais({ periodo: 'tarde' }), [{ tipo: 'periodo', valor: 'tarde' }]);
});

test('periodo fora do vocabulario fechado: ignorado, nunca atomo invalido', () => {
  assert.deepEqual(montarFatosTemporais({ periodo: 'madrugada' }), []);
});

test('horario explicito HH:MM', () => {
  assert.deepEqual(montarFatosTemporais({ horario_texto: '14:00' }), [
    { tipo: 'horario_exato', forma: 'horario_24h', hora: 14, minuto: 0, parte_dia: null },
  ]);
});

test('horario explicito HHh e HHhMM', () => {
  assert.deepEqual(montarFatosTemporais({ horario_texto: '14h' }), [
    { tipo: 'horario_exato', forma: 'horario_24h', hora: 14, minuto: 0, parte_dia: null },
  ]);
  assert.deepEqual(montarFatosTemporais({ horario_texto: '14h30' }), [
    { tipo: 'horario_exato', forma: 'horario_24h', hora: 14, minuto: 30, parte_dia: null },
  ]);
});

test('horario fora do vocabulario simples ("depois das 15h"): nenhum atomo', () => {
  assert.deepEqual(montarFatosTemporais({ horario_texto: 'depois das 15h' }), []);
});

test('combinacao completa: data + periodo + horario, todos os atomos juntos', () => {
  assert.deepEqual(montarFatosTemporais({ data_texto: 'amanha', periodo: 'tarde', horario_texto: '15:30' }), [
    { tipo: 'data_relativa', valor: 'amanha' },
    { tipo: 'intencao', valor: 'data_especifica' },
    { tipo: 'periodo', valor: 'tarde' },
    { tipo: 'horario_exato', forma: 'horario_24h', hora: 15, minuto: 30, parte_dia: null },
  ]);
});
