// Testes de agendamento-pela-data.ts.
//
// Caso real (2026-08-19): a Iris listou tres agendamentos e perguntou qual
// remarcar. O paciente respondeu "o da terca feira dia 25-8". A IA anotou a
// data e NAO o agendamento -- e sem saber qual, o Core nao calculou
// disponibilidade. A resposta saiu "para o dia 25/08 nao temos outros
// horarios", quando o dentista tinha o dia quase todo livre.

import test from 'node:test';
import assert from 'node:assert/strict';

import { identificarAgendamentoPelaData } from './agendamento-pela-data.ts';
import type { AgendamentoParaEscolha } from './agendamento-pela-data.ts';
import type { AlteracoesDados } from './tipos.ts';

// Os tres agendamentos REAIS que a Iris ofereceu.
const OFERECIDOS: AgendamentoParaEscolha[] = [
  { agendamento_id: 'ag-restauracao', data: '2026-08-20' },
  { agendamento_id: 'ag-ajuste', data: '2026-08-24' },
  { agendamento_id: 'ag-colocacao', data: '2026-08-25' },
];

const informar = (valor: string) => ({ acao: 'informar', valor });

test('CASO REAL: "o da terca dia 25-8" identifica o agendamento daquele dia', () => {
  const r = identificarAgendamentoPelaData({}, OFERECIDOS, '2026-08-25');
  assert.equal(r.identificou, true);
  assert.deepEqual(r.alteracoes.agendamento_id, { acao: 'informar', valor: 'ag-colocacao' });
});

test('cada uma das tres datas aponta para o agendamento certo', () => {
  const casos: [string, string][] = [
    ['2026-08-20', 'ag-restauracao'],
    ['2026-08-24', 'ag-ajuste'],
    ['2026-08-25', 'ag-colocacao'],
  ];
  for (const [data, esperado] of casos) {
    const r = identificarAgendamentoPelaData({}, OFERECIDOS, data);
    assert.equal(r.alteracoes.agendamento_id?.valor, esperado, `data ${data}`);
  }
});

test('a IA ja identificou -> a leitura dela prevalece', () => {
  const alteracoes: AlteracoesDados = { agendamento_id: informar('ag-ajuste') };
  const r = identificarAgendamentoPelaData(alteracoes, OFERECIDOS, '2026-08-25');
  assert.equal(r.identificou, false);
  assert.deepEqual(r.alteracoes.agendamento_id, { acao: 'informar', valor: 'ag-ajuste' });
});

test('data que nao casa com nenhum -> nao adivinha', () => {
  const r = identificarAgendamentoPelaData({}, OFERECIDOS, '2026-08-30');
  assert.equal(r.identificou, false);
  assert.equal(r.alteracoes.agendamento_id, undefined);
});

test('DOIS agendamentos no mesmo dia -> nao escolhe, o sistema pergunta', () => {
  // Escolher um dos dois seria chutar, e remarcar o errado e pior que
  // perguntar de novo.
  const doisNoMesmoDia: AgendamentoParaEscolha[] = [
    { agendamento_id: 'ag-manha', data: '2026-08-25' },
    { agendamento_id: 'ag-tarde', data: '2026-08-25' },
  ];
  const r = identificarAgendamentoPelaData({}, doisNoMesmoDia, '2026-08-25');
  assert.equal(r.identificou, false);
});

test('sem data resolvida -> nao faz nada', () => {
  assert.equal(identificarAgendamentoPelaData({}, OFERECIDOS, undefined).identificou, false);
  assert.equal(identificarAgendamentoPelaData({}, OFERECIDOS, '  ').identificou, false);
});

test('sem agendamentos oferecidos -> nao faz nada', () => {
  assert.equal(identificarAgendamentoPelaData({}, undefined, '2026-08-25').identificou, false);
  assert.equal(identificarAgendamentoPelaData({}, [], '2026-08-25').identificou, false);
});

test('preserva os demais campos do turno', () => {
  const alteracoes: AlteracoesDados = { periodo: informar('tarde') };
  const r = identificarAgendamentoPelaData(alteracoes, OFERECIDOS, '2026-08-25');
  assert.deepEqual(r.alteracoes.periodo, { acao: 'informar', valor: 'tarde' });
  assert.equal(r.alteracoes.agendamento_id?.valor, 'ag-colocacao');
});
