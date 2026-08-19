// Testes de dentista-do-tratamento.ts.
//
// O caso real (2026-08-19): o dentista definiu "Dr. Diego Ramoz" para o
// Canal pre-molar no painel; a Iris anunciou o procedimento; o paciente
// respondeu "sexta 16hrs" -- e ela perguntou com qual dos dois profissionais
// ele queria. A escolha ja estava feita, e e clinica: o paciente nao tem
// como responder isso.

import test from 'node:test';
import assert from 'node:assert/strict';

import { aplicarDentistaDoTratamento } from './dentista-do-tratamento.ts';
import type { TratamentoNoPayload } from './dentista-do-tratamento.ts';
import type { AlteracoesDados } from './tipos.ts';

const DIEGO = 'b77e8425-3b6a-4ec3-95cb-57efce6bc878';
const PABLO = 'b8942daf-55fb-4129-acaa-da69f118d309';

const TRATAMENTOS: TratamentoNoPayload[] = [
  { procedimento_id: 'canal_premolar', nome_pt: 'Canal pré-molar (2 raízes)', dente: '12', dentista_id: DIEGO, assunto_atual: true },
  { procedimento_id: 'canal_molar', nome_pt: 'Canal molar (3+ raízes)', dente: '26' },
];

const informar = (valor: string) => ({ acao: 'informar', valor });

test('CASO REAL: procedimento com dentista definido -> aplica sem perguntar', () => {
  const alteracoes: AlteracoesDados = {
    procedimento_id: informar('canal_premolar'),
    data_texto: informar('sexta feira'),
    horario_texto: informar('16:00'),
  };

  const r = aplicarDentistaDoTratamento(alteracoes, null, TRATAMENTOS, {});
  assert.equal(r.aplicou, true);
  assert.deepEqual(r.alteracoes.dentista_id, { acao: 'informar', valor: DIEGO });
});

test('procedimento SEM dentista definido -> nao aplica, a Iris pergunta', () => {
  const r = aplicarDentistaDoTratamento(
    { procedimento_id: informar('canal_molar') }, null, TRATAMENTOS, {}
  );
  assert.equal(r.aplicou, false);
  assert.equal(r.alteracoes.dentista_id, undefined);
});

test('o PACIENTE nomeou alguem -> a escolha dele prevalece, mesmo diferente do painel', () => {
  const r = aplicarDentistaDoTratamento(
    { procedimento_id: informar('canal_premolar') }, [PABLO], TRATAMENTOS, {}
  );
  assert.equal(r.aplicou, false, 'um pedido explicito nunca pode ser sobrescrito pelo padrao');
  assert.equal(r.alteracoes.dentista_id, undefined);
});

test('conversa que JA tem dentista definido nao e sobrescrita', () => {
  const r = aplicarDentistaDoTratamento(
    { procedimento_id: informar('canal_premolar') }, null, TRATAMENTOS,
    { dentista_id: PABLO }
  );
  assert.equal(r.aplicou, false);
});

test('usa o procedimento que JA estava na conversa quando o turno nao traz um', () => {
  // "pode ser sexta" sozinho: o procedimento veio de um turno anterior.
  const r = aplicarDentistaDoTratamento(
    { data_texto: informar('sexta') }, null, TRATAMENTOS,
    { procedimento_id: 'canal_premolar' }
  );
  assert.equal(r.aplicou, true);
  assert.deepEqual(r.alteracoes.dentista_id, { acao: 'informar', valor: DIEGO });
});

test('sem procedimento identificado -> nao ha o que aplicar', () => {
  const r = aplicarDentistaDoTratamento({ data_texto: informar('sexta') }, null, TRATAMENTOS, {});
  assert.equal(r.aplicou, false);
});

test('sem tratamentos no payload -> nao faz nada', () => {
  const alteracoes = { procedimento_id: informar('canal_premolar') };
  assert.equal(aplicarDentistaDoTratamento(alteracoes, null, undefined, {}).aplicou, false);
  assert.equal(aplicarDentistaDoTratamento(alteracoes, null, [], {}).aplicou, false);
});

test('candidatos VAZIOS (nao nomeou ninguem) nao impedem a aplicacao', () => {
  // `[]` significa "mencionou alguem inexistente" -- a guarda de lista vazia
  // ja o converte em `null` num turno de agendamento. Aqui garantimos que
  // `null` (o caso comum) deixa o dentista do painel valer.
  const r = aplicarDentistaDoTratamento(
    { procedimento_id: informar('canal_premolar') }, null, TRATAMENTOS, {}
  );
  assert.equal(r.aplicou, true);
});

test('dentista_id vazio no payload e tratado como ausente', () => {
  const r = aplicarDentistaDoTratamento(
    { procedimento_id: informar('x') }, null,
    [{ procedimento_id: 'x', nome_pt: 'X', dentista_id: '   ' }], {}
  );
  assert.equal(r.aplicou, false);
});
