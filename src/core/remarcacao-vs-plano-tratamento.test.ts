// Remarcacao so pode ser decidida quando o PACIENTE menciona o agendamento
// que ja tem marcado -- nunca por um agendamento que apareceu no
// `historico_recente` so porque a propria Iris o citou (lembrete, abertura,
// anuncio de tratamentos_pendentes).
//
// ── O DEFEITO QUE ISTO FECHA (2026-09-03) ───────────────────────────────
// Conversa real, WhatsApp, Cleardent (paciente Carlos Cappello,
// `estado_conversa.id = 4721855d-8f6d-479c-9e8e-348fc505899b`):
//
//   Iris:     "Boa tarde, Carlos! Alem do canal molar ja agendado para
//              amanha, voce ainda tem estes tratamentos aprovados [...]
//              Qual deles voce gostaria de agendar?"
//   Paciente: "Quero para segunda ao retratamento de canal dente 26"
//   Iris:     "Horarios livres para 07/09: [...] Qual voce prefere?"
//   Paciente: "8 hrs"
//   Iris:     "Voce esta com 04/09 as 08:40. Quer passar para 07/09 as
//              08:00?"                                          ← ERRADO
//
// O paciente nunca mencionou o agendamento de amanha -- ele escolheu um item
// do plano de tratamento e disse um horario para ele. A instrucao antiga
// mandava tratar qualquer "trocar horario logo depois de o agendamento ter
// sido tratado no historico_recente" como remarcacao, sem checar QUEM
// introduziu o agendamento na conversa (a Iris, no lembrete e na propria
// abertura -- nunca o paciente).
//
// Causa raiz: commit 578003d (18/08/2026) acrescentou essa frase de
// passagem, dentro de um commit sobre outro assunto (pergunta x escolha de
// dentista), sem teste proprio e contradizendo a spec ja aprovada de
// remarcacao (remarcacao-conversacional-v1.md, secao 1: "mencionar data ou
// horario, sozinho, nunca emite intencao").
//
// Spec da correcao: specs/plano-tratamento-vs-remarcacao-v1.md.
//
// Este arquivo NAO testa o modelo (nao ha rede aqui) -- ele guarda a
// INSTRUCAO. Se a regra por proximidade voltar, ou se a regra de precedencia
// do plano de tratamento sumir, o defeito volta em silencio e nenhum outro
// teste acusa.

import test from 'node:test';
import assert from 'node:assert/strict';

import { INSTRUCOES_EXTRATOR } from './interpretacao-instrucoes.ts';
import { INSTRUCOES_REDATOR } from './redator-instrucoes.ts';

test('a regra antiga por proximidade no historico_recente foi removida', () => {
  assert.doesNotMatch(
    INSTRUCOES_EXTRATOR,
    /logo depois de o proprio agendamento ter sido tratado/,
    'a regra por proximidade voltou -- ela nao distingue quem introduziu o agendamento na conversa'
  );
});

test('remarcacao exige que o PACIENTE tenha mencionado o agendamento existente', () => {
  assert.match(
    INSTRUCOES_EXTRATOR,
    /Emita intencao = remarcacao somente quando o PACIENTE tiver mencionado/,
    'a condicao de remarcacao nao esta ancorada em o paciente ter trazido o assunto'
  );
});

test('uma mencao da propria Iris ao agendamento (lembrete, abertura, plano) nao conta', () => {
  const trecho = INSTRUCOES_EXTRATOR.slice(
    INSTRUCOES_EXTRATOR.indexOf('Emita intencao = remarcacao somente')
  ).split('\n')[0];

  assert.match(
    trecho,
    /mencao ao agendamento existente feita SOMENTE por voce \(Iris\)/,
    'nao distingue explicitamente uma mencao da Iris de uma mencao do paciente'
  );
  assert.match(trecho, /lembrete/, 'nao cita o lembrete automatico como exemplo de mencao da Iris');
  assert.match(trecho, /tratamentos_pendentes/, 'nao cita o anuncio do plano como exemplo de mencao da Iris');
});

test('a regra de precedencia do plano de tratamento existe e cobre o caso real', () => {
  assert.match(
    INSTRUCOES_EXTRATOR,
    /PRECEDENCIA quando "tratamentos_pendentes" e um agendamento existente aparecem juntos/,
    'a regra de precedencia sumiu -- volta a ambiguidade entre plano e agendamento existente'
  );

  const trecho = INSTRUCOES_EXTRATOR.slice(
    INSTRUCOES_EXTRATOR.indexOf('PRECEDENCIA quando "tratamentos_pendentes"')
  ).split('\n')[0];

  assert.match(
    trecho,
    /se o paciente mencionou por ultimo, nesta janela, um item de "tratamentos_pendentes"/,
    'a precedencia nao esta ancorada em QUAL foi o ultimo assunto que o paciente trouxe'
  );
  assert.match(
    trecho,
    /continuam sobre ESSE item/,
    'nao diz explicitamente que um horario solto depois continua sobre o item do plano'
  );
});

test('a precedencia PRESERVA a duvida real quando o paciente nao deu nenhum sinal', () => {
  // A correcao nao pode zerar o outro lado: se o paciente nao mencionou nem
  // o agendamento nem um item do plano, a ambiguidade real continua valendo
  // (omitir intencao e procedimento, deixar o sistema perguntar).
  const trecho = INSTRUCOES_EXTRATOR.slice(
    INSTRUCOES_EXTRATOR.indexOf('PRECEDENCIA quando "tratamentos_pendentes"')
  ).split('\n')[0];

  assert.match(trecho, /duvida real/, 'sumiu a ressalva de duvida real para quando nao ha sinal nenhum');
  assert.match(
    trecho,
    /NAO tiver dado nenhum sinal/,
    'a condicao de duvida real nao esta restrita a "nenhum sinal", pode voltar a disparar demais'
  );
});

test('os exemplos de remarcacao explicita continuam preservados -- a correcao nao pode zerar o outro lado', () => {
  const trecho = INSTRUCOES_EXTRATOR.slice(
    INSTRUCOES_EXTRATOR.indexOf('Emita intencao = remarcacao somente')
  ).split('\n')[0];

  for (const forma of ['preciso remarcar minha consulta', 'pode trocar para 10hrs?']) {
    assert.ok(trecho.includes(forma), `sumiu o exemplo real "${forma}"`);
  }
});

test('a redatora recebe a regra de nao presumir qual dos dois assuntos quando os dois fatos coexistem', () => {
  assert.match(
    INSTRUCOES_REDATOR,
    /QUANDO "tratamentos_aprovados" E "agendamentos_do_paciente" VEM JUNTOS NO MESMO TURNO/,
    'a regra de abertura com os dois assuntos em aberto sumiu da redatora'
  );

  const trecho = INSTRUCOES_REDATOR.slice(
    INSTRUCOES_REDATOR.indexOf('QUANDO "tratamentos_aprovados" E "agendamentos_do_paciente"')
  ).split('\n')[0];

  assert.match(
    trecho,
    /nunca pergunte so "qual desses voce quer agendar\?"/,
    'nao proibe explicitamente a pergunta unilateral que causou o defeito real'
  );
});

test('a regra de tratamentos_aprovados sozinho continua intacta -- a correcao e aditiva', () => {
  assert.match(
    INSTRUCOES_REDATOR,
    /"tratamentos_aprovados" \(quando presente\): procedimentos que este paciente JA APROVOU/
  );
  assert.match(INSTRUCOES_REDATOR, /MENCIONE ISSO LOGO/);
});
