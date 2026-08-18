// O profissional escolhido chega a redatora no turno em que ela pede a data.
//
// ── CASO REAL (2026-08-18) ──────────────────────────────────────────────
//   Iris:     "voce pode escolher entre o Dr. Diego Ramoz e o Dr. Pablo
//              Arruda. Qual deles voce prefere?"
//   Paciente: "Diego RAmoz"
//   Iris:     "Obrigada, Diego Ramoz. Qual data e horario voce prefere?"
//
// O banco estava CERTO -- `dentista_id` correto, nenhum campo `nome`
// gravado, nenhum paciente criado (a guarda de 2026-08-17 fez seu papel).
// O defeito era so de redacao: o turno entregava apenas
// `objetivo: pedir_data_ou_horario`, sem dizer QUEM tinha sido escolhido.
// Sem esse fato, a redatora pegou o nome da mensagem crua do paciente e
// agradeceu como se fosse o nome DELE.

import test from 'node:test';
import assert from 'node:assert/strict';

import { derivarFatosAutorizados } from './fatos-autorizados.ts';
import { INSTRUCOES_REDATOR } from './redator-instrucoes.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';

const HOJE = '2026-08-18';

function pedirData(nome?: string): DecisaoOrquestrador {
  return {
    tipo: 'aguardando_data_horario',
    resultado: { tipo: 'ausente' },
    ...(nome !== undefined ? { dentista_nome_exibido: nome } : {}),
  } as DecisaoOrquestrador;
}

test('o profissional escolhido CHEGA aos fatos ao pedir a data', () => {
  const fatos = derivarFatosAutorizados(pedirData('Dr. Diego Ramoz'), HOJE);
  assert.equal(fatos.objetivo, 'pedir_data_ou_horario');
  assert.equal(
    fatos.dentista_confirmado,
    'Dr. Diego Ramoz',
    'sem este fato a redatora nao sabe que a escolha ja aconteceu -- foi o que gerou "Obrigada, Diego Ramoz"'
  );
});

test('sem dentista resolvido, o fato simplesmente nao existe', () => {
  // Ha caminhos que chegam aqui antes de o dentista existir (ex.: erro de
  // fuso). Fato ausente, nunca vazio.
  const fatos = derivarFatosAutorizados(pedirData(), HOJE);
  assert.equal(fatos.objetivo, 'pedir_data_ou_horario');
  assert.equal(fatos.dentista_confirmado, undefined);
});

test('o pedido de data continua sendo feito -- o fato novo nao substitui o objetivo', () => {
  const fatos = derivarFatosAutorizados(pedirData('Dr. Diego Ramoz'), HOJE);
  assert.deepEqual(fatos.dados_faltantes, ['data']);
});

test('a instrucao proibe agradecer ao paciente pelo nome do dentista', () => {
  assert.match(INSTRUCOES_REDATOR, /Nunca agradeca ao paciente pelo nome do dentista/);
  assert.match(INSTRUCOES_REDATOR, /Obrigada, Diego Ramoz/, 'o exemplo concreto do erro real sumiu');
});

test('a instrucao pede o comportamento humano: reconhecer e oferecer o proximo passo', () => {
  const trecho = INSTRUCOES_REDATOR.slice(
    INSTRUCOES_REDATOR.indexOf('ACABA de escolher o profissional')
  ).split('\n')[0];
  assert.match(trecho, /preferencia de data ou horario/);
  assert.match(trecho, /proximos horarios disponiveis/);
});

test('a instrucao separa o nome do PROFISSIONAL do nome do PACIENTE', () => {
  const trecho = INSTRUCOES_REDATOR.slice(
    INSTRUCOES_REDATOR.indexOf('ACABA de escolher o profissional')
  ).split('\n')[0];
  assert.match(trecho, /cadastro_conhecido/, 'nao diz onde esta o nome do paciente');
});
