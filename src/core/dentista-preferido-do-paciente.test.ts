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

test('CASO REAL: dois agendamentos com o MESMO dentista -> usa ele', async () => {
  const r = await aplicarDentistaPreferido(
    { procedimento_id: informar('cleaning'), data_texto: informar('amanha') },
    null, SO_DIEGO, {}
  );
  assert.equal(r.aplicou, true);
  assert.deepEqual(r.alteracoes.dentista_id, { acao: 'informar', valor: DIEGO });
});

test('um unico agendamento ja basta', async () => {
  // `intencao` no snapshot: o turno trata de agendamento, entao a deducao e
  // tentada (terceira guarda, specs/dentista-semantico-v1.md secao 13.5 --
  // acrescentada em 2026-08-31 para que uma saudacao nao dispare a leitura).
  const r = await aplicarDentistaPreferido({}, null, [{ dentista_id: DIEGO }], { intencao: 'novo_agendamento' });
  assert.equal(r.aplicou, true);
});

// CONTRAPARTE da guarda de assunto: mesma base do teste acima, mas conversa
// BASICA (sem intencao e sem procedimento) -- nao ha profissional a deduzir.
test('conversa basica: nao deduz dentista mesmo com um unico agendamento', async () => {
  const r = await aplicarDentistaPreferido({}, null, [{ dentista_id: DIEGO }], {});
  assert.equal(r.aplicou, false);
});

test('dentistas DIFERENTES -> nao ha preferencia unica, a Iris pergunta', async () => {
  // Escolher um seria decidir pelo paciente.
  const r = await aplicarDentistaPreferido({}, null, [{ dentista_id: DIEGO }, { dentista_id: PABLO }], {});
  assert.equal(r.aplicou, false);
  assert.equal(r.alteracoes.dentista_id, undefined);
});

test('o PACIENTE nomeou alguem -> a escolha dele prevalece', async () => {
  const r = await aplicarDentistaPreferido({}, [PABLO], SO_DIEGO, {});
  assert.equal(r.aplicou, false);
});

test('conversa que JA tem dentista nao e sobrescrita', async () => {
  assert.equal((await aplicarDentistaPreferido({}, null, SO_DIEGO, { dentista_id: PABLO })).aplicou, false);
});

test('dentista ja definido NESTE turno tambem prevalece', async () => {
  // Ex.: o dentista do plano de tratamento, aplicado no passo anterior.
  const r = await aplicarDentistaPreferido({ dentista_id: informar(PABLO) }, null, SO_DIEGO, {});
  assert.equal(r.aplicou, false);
  assert.deepEqual(r.alteracoes.dentista_id, { acao: 'informar', valor: PABLO });
});

test('sem agendamentos -> nao ha preferencia', async () => {
  assert.equal((await aplicarDentistaPreferido({}, null, undefined, {})).aplicou, false);
  assert.equal((await aplicarDentistaPreferido({}, null, [], {})).aplicou, false);
});

test('agendamentos SEM dentista registrado -> nao adivinha', async () => {
  assert.equal((await aplicarDentistaPreferido({}, null, [{}, {}], {})).aplicou, false);
  assert.equal((await aplicarDentistaPreferido({}, null, [{ dentista_id: '  ' }], {})).aplicou, false);
});

test('preserva os campos do turno', async () => {
  const alteracoes: AlteracoesDados = { procedimento_id: informar('cleaning') };
  const r = await aplicarDentistaPreferido(alteracoes, null, SO_DIEGO, {});
  assert.deepEqual(r.alteracoes.procedimento_id, { acao: 'informar', valor: 'cleaning' });
});
