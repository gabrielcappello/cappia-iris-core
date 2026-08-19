// Testes de dentista-preferido-do-paciente.ts.
//
// Caso real (2026-08-19):
//   Paciente: "gostaria de uma limpeza para amanha"
//   Iris:     "prefere com o Dr. Diego Ramoz ou com o Dr. Pablo Arruda?"
//
// Ele tinha DOIS agendamentos, os dois com o Dr. Diego. Perguntar quem faz a
// limpeza obriga o paciente a repetir uma escolha que ele ja fez.

import test from 'node:test';
import assert from 'node:assert/strict';

import { aplicarDentistaPreferido } from './dentista-preferido-do-paciente.ts';
import type { AgendamentoComDentista } from './dentista-preferido-do-paciente.ts';
import type { AlteracoesDados } from './tipos.ts';

const DIEGO = 'b77e8425-3b6a-4ec3-95cb-57efce6bc878';
const PABLO = 'b8942daf-55fb-4129-acaa-da69f118d309';

/** Os dois agendamentos REAIS do paciente -- ambos com o Diego. */
const SO_DIEGO: AgendamentoComDentista[] = [{ dentista_id: DIEGO }, { dentista_id: DIEGO }];

const informar = (valor: string) => ({ acao: 'informar', valor });

test('CASO REAL: dois agendamentos com o MESMO dentista -> usa ele', () => {
  const r = aplicarDentistaPreferido(
    { procedimento_id: informar('cleaning'), data_texto: informar('amanha') },
    null, SO_DIEGO, {}
  );
  assert.equal(r.aplicou, true);
  assert.deepEqual(r.alteracoes.dentista_id, { acao: 'informar', valor: DIEGO });
});

test('um unico agendamento ja basta', () => {
  const r = aplicarDentistaPreferido({}, null, [{ dentista_id: DIEGO }], {});
  assert.equal(r.aplicou, true);
});

test('dentistas DIFERENTES -> nao ha preferencia unica, a Iris pergunta', () => {
  // Escolher um seria decidir pelo paciente.
  const r = aplicarDentistaPreferido({}, null, [{ dentista_id: DIEGO }, { dentista_id: PABLO }], {});
  assert.equal(r.aplicou, false);
  assert.equal(r.alteracoes.dentista_id, undefined);
});

test('o PACIENTE nomeou alguem -> a escolha dele prevalece', () => {
  const r = aplicarDentistaPreferido({}, [PABLO], SO_DIEGO, {});
  assert.equal(r.aplicou, false);
});

test('conversa que JA tem dentista nao e sobrescrita', () => {
  assert.equal(aplicarDentistaPreferido({}, null, SO_DIEGO, { dentista_id: PABLO }).aplicou, false);
});

test('dentista ja definido NESTE turno tambem prevalece', () => {
  // Ex.: o dentista do plano de tratamento, aplicado no passo anterior.
  const r = aplicarDentistaPreferido({ dentista_id: informar(PABLO) }, null, SO_DIEGO, {});
  assert.equal(r.aplicou, false);
  assert.deepEqual(r.alteracoes.dentista_id, { acao: 'informar', valor: PABLO });
});

test('sem agendamentos -> nao ha preferencia', () => {
  assert.equal(aplicarDentistaPreferido({}, null, undefined, {}).aplicou, false);
  assert.equal(aplicarDentistaPreferido({}, null, [], {}).aplicou, false);
});

test('agendamentos SEM dentista registrado -> nao adivinha', () => {
  assert.equal(aplicarDentistaPreferido({}, null, [{}, {}], {}).aplicou, false);
  assert.equal(aplicarDentistaPreferido({}, null, [{ dentista_id: '  ' }], {}).aplicou, false);
});

test('preserva os campos do turno', () => {
  const alteracoes: AlteracoesDados = { procedimento_id: informar('cleaning') };
  const r = aplicarDentistaPreferido(alteracoes, null, SO_DIEGO, {});
  assert.deepEqual(r.alteracoes.procedimento_id, { acao: 'informar', valor: 'cleaning' });
});
