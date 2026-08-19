// Testes de procedimento-do-anuncio.ts.
//
// O caso real (2026-08-19), com os logs que o comprovam:
//
//   Iris:     "Ficou combinado: Ajuste mensal braquetes (dente 36)"
//   Paciente: "pode ser pra segunda feira 15hrs"
//   Iris:     "Qual procedimento ou atendimento voce esta buscando?"
//
//   interpretacao_tratamentos no_payload=2 assunto=braces_adjustment
//                             ia_procedimento=- campos=data_texto,horario_texto
//
// O dado chegou; a IA extraiu data e horario e nao preencheu o procedimento.

import test from 'node:test';
import assert from 'node:assert/strict';

import { aplicarProcedimentoDoAnuncio } from './procedimento-do-anuncio.ts';
import type { TratamentoNoPayload } from './dentista-do-tratamento.ts';
import type { AlteracoesDados } from './tipos.ts';

const TRATAMENTOS: TratamentoNoPayload[] = [
  { procedimento_id: 'braces_adjustment', nome_pt: 'Ajuste mensal braquetes', dente: '36', assunto_atual: true },
  { procedimento_id: 'canal_premolar', nome_pt: 'Canal pré-molar (2 raízes)', dente: '26' },
];

const informar = (valor: string) => ({ acao: 'informar', valor });

test('CASO REAL: data + horario, sem procedimento -> aplica o ANUNCIADO', () => {
  const alteracoes: AlteracoesDados = {
    data_texto: informar('segunda feira'),
    horario_texto: informar('15:00'),
  };

  const r = aplicarProcedimentoDoAnuncio(alteracoes, TRATAMENTOS, {});
  assert.equal(r.aplicou, true);
  assert.deepEqual(r.alteracoes.procedimento_id, { acao: 'informar', valor: 'braces_adjustment' });
});

test('so o periodo ja basta -- "pode ser de tarde"', () => {
  const r = aplicarProcedimentoDoAnuncio({ periodo: informar('tarde') }, TRATAMENTOS, {});
  assert.equal(r.aplicou, true);
  assert.deepEqual(r.alteracoes.procedimento_id, { acao: 'informar', valor: 'braces_adjustment' });
});

test('a IA identificou OUTRO procedimento -> a leitura dela prevalece', () => {
  const r = aplicarProcedimentoDoAnuncio(
    { data_texto: informar('segunda'), procedimento_id: informar('canal_premolar') },
    TRATAMENTOS, {}
  );
  assert.equal(r.aplicou, false);
  assert.deepEqual(r.alteracoes.procedimento_id, { acao: 'informar', valor: 'canal_premolar' });
});

test('conversa que JA tem procedimento nao e sobrescrita', () => {
  const r = aplicarProcedimentoDoAnuncio(
    { data_texto: informar('segunda') }, TRATAMENTOS,
    { procedimento_id: 'canal_premolar' }
  );
  assert.equal(r.aplicou, false);
});

test('turno SEM data/horario/periodo nao fixa procedimento nenhum', () => {
  // "oi", uma duvida, um agradecimento -- nada disso e escolha de
  // procedimento, e fixar um aqui decidiria pelo paciente.
  const r = aplicarProcedimentoDoAnuncio({ nome: informar('gabriel') }, TRATAMENTOS, {});
  assert.equal(r.aplicou, false);
  assert.equal(r.alteracoes.procedimento_id, undefined);
});

test('alteracoes vazias -> nao aplica', () => {
  assert.equal(aplicarProcedimentoDoAnuncio({}, TRATAMENTOS, {}).aplicou, false);
});

test('nenhum tratamento marcado como assunto -> nao adivinha', () => {
  // Sem `assunto_atual` nao ha como saber qual foi anunciado; escolher o
  // primeiro seria chutar.
  const semAssunto = TRATAMENTOS.map(({ assunto_atual: _a, ...resto }) => resto);
  const r = aplicarProcedimentoDoAnuncio({ data_texto: informar('segunda') }, semAssunto, {});
  assert.equal(r.aplicou, false);
});

test('sem tratamentos no payload -> nao faz nada', () => {
  const alteracoes = { data_texto: informar('segunda') };
  assert.equal(aplicarProcedimentoDoAnuncio(alteracoes, undefined, {}).aplicou, false);
  assert.equal(aplicarProcedimentoDoAnuncio(alteracoes, [], {}).aplicou, false);
});

test('procedimento_id vazio no anunciado e ignorado', () => {
  const r = aplicarProcedimentoDoAnuncio(
    { data_texto: informar('segunda') },
    [{ procedimento_id: '  ', nome_pt: 'X', assunto_atual: true }], {}
  );
  assert.equal(r.aplicou, false);
});

test('preserva os campos que a IA extraiu', () => {
  const r = aplicarProcedimentoDoAnuncio(
    { data_texto: informar('segunda feira'), horario_texto: informar('15:00') },
    TRATAMENTOS, {}
  );
  assert.deepEqual(r.alteracoes.data_texto, { acao: 'informar', valor: 'segunda feira' });
  assert.deepEqual(r.alteracoes.horario_texto, { acao: 'informar', valor: '15:00' });
});
