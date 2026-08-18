// A distincao PERGUNTAR SOBRE dentistas x ESCOLHER um deles.
//
// ── CASO REAL QUE ORIGINOU ISTO (2026-08-18) ────────────────────────────
//   Paciente: "mais eu quero saber os dentistas que trabalham na clinica
//              primeiro"
//   Iris:     "...Para seguir com o agendamento, pode me informar qual data
//              voce prefere?"
//   Paciente: "para hoje fim do dia"
//   Iris:     "Os dentistas que atendem sao o Dr. Diego e o Dr. Pablo.
//              Qual data seria melhor para voce?"
//
// O Core tinha entendido TUDO -- o estado gravado no banco naquele turno era
// {data_texto: "hoje", periodo: "tarde", dentista_id: "b77e...",
// procedimento_id: "consultation_evaluation"}. Nada faltava.
//
// O que travou: a instrucao definia `dentistas_candidatos` como resposta a
// UMA pergunta -- "a quem ele se refere?". A frase do paciente MENCIONA
// profissionais mas nao SE REFERE a nenhum: e pedido de informacao. Sem esse
// caso na instrucao, a IA marcou os dois como candidatos, e o Core aplicou
// sua regra de contagem:
//
//     if (plausiveis.length > 1) -> aguardando_escolha_dentista
//
// O objetivo do turno virou "escolher entre dentistas" e ficou preso ali: a
// data respondida no turno seguinte nao era o que o Core esperava.
//
// Este arquivo NAO testa o modelo (nao ha rede aqui) -- ele guarda a
// INSTRUCAO. Se a distincao for removida ou reescrita sem os dois lados, o
// defeito volta em silencio e nenhum outro teste acusa.

import test from 'node:test';
import assert from 'node:assert/strict';

import { INSTRUCOES_EXTRATOR } from './interpretacao-instrucoes.ts';

test('a instrucao distingue PERGUNTAR SOBRE de ESCOLHER um profissional', () => {
  assert.match(
    INSTRUCOES_EXTRATOR,
    /PERGUNTAR SOBRE os profissionais nao e ESCOLHER um deles/,
    'a distincao sumiu da instrucao -- "quais dentistas trabalham ai?" volta a virar escolha'
  );
});

test('a instrucao diz o que fazer no caso informativo: null + duvida', () => {
  const trecho = INSTRUCOES_EXTRATOR.slice(
    INSTRUCOES_EXTRATOR.indexOf('PERGUNTAR SOBRE os profissionais')
  ).split('\n')[0];

  assert.match(trecho, /null/, 'nao diz que dentistas_candidatos e null');
  assert.match(trecho, /duvida/, 'nao diz que a natureza e duvida');
});

test('a instrucao cobre a frase REAL que travou a conversa', () => {
  const trecho = INSTRUCOES_EXTRATOR.slice(
    INSTRUCOES_EXTRATOR.indexOf('PERGUNTAR SOBRE os profissionais')
  ).split('\n')[0];

  // As formas que um paciente usa de verdade -- a terceira e a do caso real.
  for (const forma of ['quais dentistas trabalham', 'quem atende', 'quero saber os dentistas primeiro']) {
    assert.ok(
      trecho.includes(forma),
      `a instrucao nao exemplifica "${forma}" -- foi uma das formas reais que travaram a conversa`
    );
  }
});

test('a instrucao cobre o caso "no meio de um agendamento em andamento"', () => {
  // O caso real aconteceu DEPOIS de o procedimento ja estar escolhido. Sem
  // essa ressalva, a IA pode tratar a pergunta como escolha justamente ali.
  const trecho = INSTRUCOES_EXTRATOR.slice(
    INSTRUCOES_EXTRATOR.indexOf('PERGUNTAR SOBRE os profissionais')
  ).split('\n')[0];
  assert.match(trecho, /agendamento em andamento/);
});

test('a instrucao PRESERVA o caso de escolha real -- a correcao nao pode zerar o outro lado', () => {
  // Se a instrucao passasse a devolver null SEMPRE, "quero com o Dr. Diego"
  // deixaria de funcionar. Os dois lados precisam estar escritos.
  const trecho = INSTRUCOES_EXTRATOR.slice(
    INSTRUCOES_EXTRATOR.indexOf('PERGUNTAR SOBRE os profissionais')
  ).split('\n')[0];
  assert.match(trecho, /quero com o Dr\./, 'sumiu o exemplo de escolha explicita');
  assert.match(trecho, /UM profissional especifico/, 'sumiu a regra de quando PREENCHER');
});

test('a regra original de dentistas_candidatos continua intacta', () => {
  // A correcao e ADITIVA: a regra de contagem (um / varios / vazio) nao foi
  // tocada, e o Core depende dela.
  assert.match(INSTRUCOES_EXTRATOR, /"dentistas_candidatos" e sempre obrigatorio/);
  assert.match(INSTRUCOES_EXTRATOR, /a lista vazia quando nenhum dos profissionais da clinica corresponder/);
  assert.match(INSTRUCOES_EXTRATOR, /Voce NUNCA escolhe entre varios plausiveis/);
});
