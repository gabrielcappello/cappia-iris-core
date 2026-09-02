// `dentistas_candidatos` representa SOMENTE profissional que o paciente
// mencionou -- nunca um herdado de agendamento, tratamento ou historico.
//
// ── O DEFEITO QUE ISTO FECHA (2026-09-01/02) ────────────────────────────
// A instrucao da interpretadora tinha uma regra ("preferencia natural")
// mandando copiar para `dentistas_candidatos` o dentista de um agendamento
// existente quando o paciente pedia algo novo SEM dizer com quem. Isso
// contradizia as duas regras vizinhas -- uma define o campo como "a quem o
// paciente se refere", a outra proibe explicitamente copiar o dentista de um
// tratamento pendente para ele.
//
// O efeito medido era DUPLO, e os dois lados sao piores que o problema que a
// regra tentava resolver:
//
//   1. `aplicarDentistaPreferido` (dentista habitual, deduzido do historico)
//      DESISTE quando `candidatosDaIA !== null`. A regra o desligava
//      exatamente no cenario para o qual ele existe.
//   2. `aplicarDentistaDoTratamento` le UM candidato diferente do plano como
//      "escolha inequivoca do paciente" e CEDE. Com a regra, um dentista que
//      o paciente nunca citou derrubava a definicao clinica da clinica.
//
// O caso real (WhatsApp, Cleardent, 2026-09-01): plano com Dr. Pablo Arruda,
// paciente respondeu "pode ser pra hoje" sem citar ninguem, e a Iris ofereceu
// horarios do Dr. Diego Perez. `6181c2c` corrigiu a CONSEQUENCIA (dois
// candidatos deixaram de derrubar o plano); este arquivo cobre a CAUSA.
//
// ── PENDENTE: TESTE REAL POR WHATSAPP, antes de considerar fechado ──────
// Estes testes provam o mecanismo, nao a conversa. O deploy foi
// deliberadamente adiado: e mudanca no contrato da interpretadora, e quem
// valida tom e fluxo e uma conversa real.
//
// Cenario: paciente COM agendamento marcado pede um procedimento novo sem
// mencionar nenhum profissional.
//
// Criterios de aceite (os tres precisam valer juntos):
//   1. a Iris NAO pergunta com qual dentista ele quer -- a pergunta e
//      desnecessaria quando o Core ja sabe deduzir;
//   2. o profissional aplicado e o correto (o do plano, do agendamento ou do
//      historico, conforme a regra do Core) -- verificavel no agendamento
//      criado e no log `dentista_efetivo`;
//   3. um profissional DIFERENTE so aparece quando o paciente o mencionar ou
//      escolher explicitamente.
//
// Estado no momento deste commit: Edge Function na v106, SEM esta correcao.

// Estes testes exercitam os mecanismos do Core diretamente: eles ja se
// comportam corretamente quando recebem `null`. A correcao foi so na
// instrucao -- nenhuma linha de Core mudou.

import test from 'node:test';
import assert from 'node:assert/strict';

import { aplicarDentistaPreferido } from './dentista-preferido-do-paciente.ts';
import { aplicarDentistaDoTratamento } from './dentista-do-tratamento.ts';
import type { TratamentoNoPayload } from './dentista-do-tratamento.ts';
import type { AlteracoesDados } from './tipos.ts';

const RAMOZ = 'b77e8425-3b6a-4ec3-95cb-57efce6bc878';
const PEREZ = '9c693b86-5113-41d4-b97d-be52a579ae8c';
const PABLO = 'b8942daf-55fb-4129-acaa-da69f118d309';

const pedidoNovo = () =>
  ({ procedimento_id: { acao: 'informar', valor: 'cleaning' } }) as AlteracoesDados;

const planoCom = (dentistaId: string): TratamentoNoPayload[] => [
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental', dentista_id: dentistaId, assunto_atual: true },
];

// ── PAR A/B: e o que prova o mecanismo ──────────────────────────────────
// Mesma entrada, variando SO `dentistas_candidatos`. Os dois lados precisam
// DIFERIR -- e o que impede este teste de passar caso a correcao nao tenha
// efeito nenhum (docs/00-principios.md, principio do teste isolado).

test('PAR A/B -- dentista habitual: null LIGA a deducao, valor herdado a DESLIGA', async () => {
  const carregarHistorico = async () => [RAMOZ];

  const comNull = await aplicarDentistaPreferido(pedidoNovo(), null, undefined, {}, carregarHistorico);
  const comHerdado = await aplicarDentistaPreferido(pedidoNovo(), [RAMOZ], undefined, {}, carregarHistorico);

  assert.equal(comNull.aplicou, true, 'sem candidato, o Core deduz o dentista habitual -- e o comportamento certo');
  assert.deepEqual(comNull.alteracoes.dentista_id, { acao: 'informar', valor: RAMOZ });

  assert.equal(
    comHerdado.aplicou,
    false,
    'a regra antiga preenchia o campo e DESLIGAVA a deducao no unico cenario para o qual ela existe',
  );
  assert.notDeepEqual(comNull.aplicou, comHerdado.aplicou, 'os dois lados precisam diferir');
});

test('PAR A/B -- plano de tratamento: null PRESERVA o plano, valor herdado o DERRUBA', () => {
  const comNull = aplicarDentistaDoTratamento(pedidoNovo(), null, planoCom(PABLO), {});
  const comHerdado = aplicarDentistaDoTratamento(pedidoNovo(), [PEREZ], planoCom(PABLO), {});

  assert.equal(comNull.aplicou, true);
  assert.deepEqual(comNull.alteracoes.dentista_id, { acao: 'informar', valor: PABLO }, 'o plano define quem atende');

  assert.equal(
    comHerdado.aplicou,
    false,
    'UM candidato diferente e lido como escolha do paciente -- por isso herdar sem ele ter falado derruba o plano',
  );
  assert.notDeepEqual(comNull.aplicou, comHerdado.aplicou, 'os dois lados precisam diferir');
});

// ── Os sete cenarios do contrato ────────────────────────────────────────
// Cada um descreve o que a INTERPRETADORA deve devolver, e o efeito disso no
// Core. Sao o contrato em forma executavel.

test('1. tem agendamento com Ramoz e pede procedimento novo sem citar ninguem -> null', async () => {
  // A IA devolve null; o Core aplica Ramoz pelo historico, por regra propria.
  const r = await aplicarDentistaPreferido(pedidoNovo(), null, [{ dentista_id: RAMOZ }], {}, async () => [RAMOZ]);
  assert.equal(r.aplicou, true, 'o profissional vem do Core, nunca de um candidato inventado');
});

test('2. tem agendamento com Ramoz e pede EXPLICITAMENTE Perez -> so o id de Perez', () => {
  // Mencao real do paciente: o campo e preenchido, e a escolha dele prevalece
  // sobre o plano -- que e exatamente o desenho aprovado.
  const r = aplicarDentistaDoTratamento(pedidoNovo(), [PEREZ], planoCom(PABLO), {});
  assert.equal(r.aplicou, false, 'pedido explicito nunca e sobrescrito pela definicao da clinica');
});

test('3. "com o mesmo dentista" -> e mencao do paciente, o campo E preenchido', () => {
  // Referencia explicita a um profissional, resolvida contra um agendamento.
  // Nao e inferencia silenciosa: o paciente falou dele. Um candidato IGUAL ao
  // do plano nao gera conflito -- concordam, e o plano segue.
  const r = aplicarDentistaDoTratamento(pedidoNovo(), [PABLO], planoCom(PABLO), {});
  assert.equal(r.aplicou, true);
  assert.deepEqual(r.alteracoes.dentista_id, { acao: 'informar', valor: PABLO });
});

test('4. tratamento pendente com Pablo, sem mencao -> null, e o Core preserva Pablo', () => {
  const r = aplicarDentistaDoTratamento(pedidoNovo(), null, planoCom(PABLO), {});
  assert.equal(r.aplicou, true);
  assert.deepEqual(r.alteracoes.dentista_id, { acao: 'informar', valor: PABLO });
});

test('5. "quais dentistas trabalham ai?" -> null, nenhum mecanismo dispara', async () => {
  // Pergunta sobre a clinica, sem procedimento e sem mencao: nada a aplicar.
  const semPedido = {} as AlteracoesDados;
  const r = await aplicarDentistaPreferido(semPedido, null, undefined, {}, async () => [RAMOZ]);
  assert.equal(r.aplicou, false, 'sem fluxo de agendamento, nao se deduz profissional nenhum');
});

test('6. menciona profissional que NAO existe na clinica -> lista vazia, nunca null', async () => {
  // `[]` e `null` nao sao a mesma coisa: `[]` significa "falou de alguem que
  // nao existe aqui" e faz o sistema responder isso. Qualquer array interrompe
  // a deducao do habitual -- inclusive o vazio.
  const r = await aplicarDentistaPreferido(pedidoNovo(), [], undefined, {}, async () => [RAMOZ]);
  assert.equal(r.aplicou, false, 'preferencia declarada e nao localizada nunca vira dentista habitual em silencio');
});

test('7. escolhe entre dois profissionais apresentados -> so quando a escolha e inequivoca', () => {
  // DOIS candidatos sao duvida da IA, nunca escolha: o plano manda (6181c2c).
  const doisCandidatos = aplicarDentistaDoTratamento(pedidoNovo(), [PABLO, PEREZ], planoCom(PABLO), {});
  assert.equal(doisCandidatos.aplicou, true, 'duvida da IA nao derruba a definicao clinica');

  // UM candidato, e diferente do plano: escolha inequivoca, o plano cede.
  const umCandidato = aplicarDentistaDoTratamento(pedidoNovo(), [PEREZ], planoCom(PABLO), {});
  assert.equal(umCandidato.aplicou, false);
});
