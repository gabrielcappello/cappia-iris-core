// Testes da guarda que impede "nao encontrei esse profissional" numa
// mensagem que nao mencionou profissional nenhum.
//
// O caso real (2026-08-19): a Iris anunciou "Canal molar (dente 26)", o
// paciente respondeu "perfeito, sim vamos agendar para sexta feira 10hrs" e
// recebeu de volta "Nao encontrei esse profissional aqui". A IA devolveu
// `dentistas_candidatos: []` -- que no contrato significa "mencionou alguem
// inexistente" -- para uma mensagem sobre data e horario.

import test from 'node:test';
import assert from 'node:assert/strict';

import { descartarListaVaziaSemMencao } from './guarda-lista-vazia-dentistas.ts';
import type { AlteracoesDados } from './tipos.ts';

test('CASO REAL: lista vazia + data e horario -> vira null', () => {
  const alteracoes: AlteracoesDados = {
    data_texto: { acao: 'informar', valor: 'sexta feira' },
    horario_texto: { acao: 'informar', valor: '10:00' },
    procedimento_id: { acao: 'informar', valor: 'canal_molar' },
  };

  const r = descartarListaVaziaSemMencao([], alteracoes);
  assert.equal(r.candidatos, null, 'a lista vazia deveria virar null -- foi ela que gerou "nao encontrei esse profissional"');
  assert.equal(r.descartou, true);
});

test('cada campo de agendamento, sozinho, ja basta', () => {
  for (const campo of ['data_texto', 'horario_texto', 'periodo', 'confirmacao']) {
    const r = descartarListaVaziaSemMencao([], { [campo]: { acao: 'informar', valor: 'x' } } as AlteracoesDados);
    assert.equal(r.candidatos, null, `${campo} sozinho deveria acionar a guarda`);
  }
});

test('lista vazia SEM contexto de agendamento passa intacta', () => {
  // "quero com a Dra. Marta" numa clinica sem Marta: o `[]` e legitimo e
  // precisa continuar produzindo "nao encontrei esse profissional".
  const r = descartarListaVaziaSemMencao([], {});
  assert.deepEqual(r.candidatos, []);
  assert.equal(r.descartou, false);
});

test('lista vazia com procedimento apenas NAO aciona a guarda', () => {
  // Procedimento nao e sinal de agendamento em curso -- o paciente pode
  // dizer "quero um canal com a Dra. Marta" e ela nao existir.
  const r = descartarListaVaziaSemMencao([], { procedimento_id: { acao: 'informar', valor: 'canal_molar' } });
  assert.deepEqual(r.candidatos, []);
  assert.equal(r.descartou, false);
});

test('null passa intacto -- a guarda so olha o caso da lista vazia', () => {
  const r = descartarListaVaziaSemMencao(null, { data_texto: { acao: 'informar', valor: 'sexta' } });
  assert.equal(r.candidatos, null);
  assert.equal(r.descartou, false);
});

test('candidatos REAIS passam intactos, mesmo com data no turno', () => {
  // "sexta as 10h com o Dr. Diego" -- a escolha do profissional e legitima
  // e nao pode ser descartada.
  const r = descartarListaVaziaSemMencao(['dentista-1'], { data_texto: { acao: 'informar', valor: 'sexta' } });
  assert.deepEqual(r.candidatos, ['dentista-1']);
  assert.equal(r.descartou, false);
});

test('varios candidatos com data tambem passam -- o sistema ainda precisa perguntar', () => {
  const r = descartarListaVaziaSemMencao(['d1', 'd2'], { horario_texto: { acao: 'informar', valor: '10:00' } });
  assert.deepEqual(r.candidatos, ['d1', 'd2']);
  assert.equal(r.descartou, false);
});
