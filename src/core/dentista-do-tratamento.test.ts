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

// ── Defeito real de 2026-09-01 (WhatsApp, clinica Cleardent) ────────────
// Plano: "Limpeza dental (profilaxia) -- com Dr. Diego Ramoz". O paciente
// respondeu por audio "pode ser pra hoje", SEM citar profissional. Ele tinha
// agendamento com dois naquele dia (Ramoz 14:10, Perez 16:00), entao a IA
// devolveu OS DOIS em `dentistas_candidatos` (log: `ia_candidatos=2`), sem
// escolher. A guarda antiga leu isso como escolha do paciente, descartou o
// plano, e o agendamento saiu com o profissional errado.
const PEREZ = '9c693b86-5113-41d4-b97d-be52a579ae8c';

const LIMPEZA: TratamentoNoPayload[] = [
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental (profilaxia)', dente: '24', dentista_id: DIEGO, assunto_atual: true },
];

test('CASO REAL 01/09: DOIS candidatos e duvida da IA, nunca escolha -> o plano manda', () => {
  const r = aplicarDentistaDoTratamento(
    { procedimento_id: informar('cleaning'), data_texto: informar('hoje') },
    [DIEGO, PEREZ],
    LIMPEZA,
    {}
  );
  assert.equal(r.aplicou, true, 'duvida da IA nao pode derrubar a definicao clinica da clinica');
  assert.deepEqual(r.alteracoes.dentista_id, { acao: 'informar', valor: DIEGO });
});

test('tres ou mais candidatos tambem sao duvida -> o plano manda', () => {
  const r = aplicarDentistaDoTratamento(
    { procedimento_id: informar('cleaning') }, [DIEGO, PABLO, PEREZ], LIMPEZA, {}
  );
  assert.equal(r.aplicou, true);
  assert.deepEqual(r.alteracoes.dentista_id, { acao: 'informar', valor: DIEGO });
});

test('UM candidato IGUAL ao do plano -> concordam, segue o plano', () => {
  const r = aplicarDentistaDoTratamento(
    { procedimento_id: informar('cleaning') }, [DIEGO], LIMPEZA, {}
  );
  assert.equal(r.aplicou, true);
  assert.deepEqual(r.alteracoes.dentista_id, { acao: 'informar', valor: DIEGO });
});

test('UM candidato DIFERENTE do plano -> escolha do paciente prevalece', () => {
  const r = aplicarDentistaDoTratamento(
    { procedimento_id: informar('cleaning') }, [PEREZ], LIMPEZA, {}
  );
  assert.equal(r.aplicou, false, 'pedido explicito do paciente nunca e sobrescrito');
  assert.equal(r.alteracoes.dentista_id, undefined);
});

test('lista VAZIA (nomeou alguem que nao existe na clinica) -> o plano manda', () => {
  // `[]` significa "falou de alguem que nao existe aqui" -- nunca a escolha de
  // um profissional que existe, entao nao derruba o plano.
  //
  // `[]` CHEGA ate aqui: `descartarListaVaziaSemMencao` so o converte em
  // `null` quando o turno traz campo de agendamento. Sem esse campo, a lista
  // vazia sobrevive -- e este teste cobre exatamente esse caminho.
  const r = aplicarDentistaDoTratamento(
    { procedimento_id: informar('cleaning') }, [], LIMPEZA, {}
  );
  assert.equal(r.aplicou, true);
  assert.deepEqual(r.alteracoes.dentista_id, { acao: 'informar', valor: DIEGO });
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

test('candidatos NULL (nao mencionou profissional) nao impedem a aplicacao', () => {
  // `null` e o caso comum: o paciente nao falou de profissional nenhum.
  // Distinto do `[]` do teste acima, que e "falou de alguem inexistente" --
  // os dois deixam o dentista do painel valer, por motivos diferentes.
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
