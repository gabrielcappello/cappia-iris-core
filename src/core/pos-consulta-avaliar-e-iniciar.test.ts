import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avaliarEIniciarPosConsulta } from './pos-consulta-avaliar-e-iniciar.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import { ClienteRedatorPosConsultaFalso } from './teste-cliente-redator-pos-consulta-falso.ts';

const CLINICA = '11111111-1111-1111-1111-111111111111';
const AGENDAMENTO = '22222222-2222-2222-2222-222222222222';
const PACIENTE = '33333333-3333-3333-3333-333333333333';
const JORNADA = '44444444-4444-4444-4444-444444444444';
const ENTREGA_ID = '55555555-5555-5555-5555-555555555555';
const TOKEN = '66666666-6666-6666-6666-666666666666';

const ENTRADA_BASE = {
  clinicaId: CLINICA,
  agendamentoId: AGENDAMENTO,
  pacienteId: PACIENTE,
  agendamento: {
    clinicaId: CLINICA,
    status: 'concluido',
    telefoneNormalizado: '5511999999999',
    concluidoEm: '2026-09-01T12:00:00.000Z',
  },
  configuracao: { modo: 'satisfacao' as const, prazoMinutos: 60 },
  agora: '2026-09-01T13:00:00.000Z',
  contexto: {},
};

test('defesa em profundidade -- reavalia elegibilidade mesmo que o n8n ja tenha filtrado, e recusa quando invalida', async () => {
  const rpc = new ClienteRpcFalso({});
  const redator = new ClienteRedatorPosConsultaFalso('nao deveria ser chamado');
  const resultado = await avaliarEIniciarPosConsulta(rpc, redator, {
    ...ENTRADA_BASE,
    agendamento: { ...ENTRADA_BASE.agendamento, status: 'confirmado', concluidoEm: null }, // ainda nao concluido
  });
  assert.deepEqual(resultado, { tipo: 'nao_elegivel', motivo: 'status_nao_concluido' });
  assert.equal(rpc.chamadas.length, 0);
  assert.equal(redator.chamadas.length, 0);
});

test('elegivel -- inicia a jornada de verdade', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: {
      data: { resultado: 'pendente', jornada_id: JORNADA, entrega_id: ENTREGA_ID, claim_token: TOKEN, modo: 'satisfacao', convite_pendente: false },
      error: null,
    },
  });
  const redator = new ClienteRedatorPosConsultaFalso('Oi! Como foi sua consulta?');
  const resultado = await avaliarEIniciarPosConsulta(rpc, redator, ENTRADA_BASE);
  assert.equal(resultado.tipo, 'entrega_pendente');
});

test('clinica divergente (agendamento de outra clinica) nunca inicia, mesmo que o resto pareca valido', async () => {
  const rpc = new ClienteRpcFalso({});
  const redator = new ClienteRedatorPosConsultaFalso('nao deveria ser chamado');
  const resultado = await avaliarEIniciarPosConsulta(rpc, redator, {
    ...ENTRADA_BASE,
    agendamento: { ...ENTRADA_BASE.agendamento, clinicaId: 'outra-clinica' },
  });
  assert.deepEqual(resultado, { tipo: 'nao_elegivel', motivo: 'clinica_divergente' });
});

test('modo google sem link valido nunca inicia', async () => {
  const rpc = new ClienteRpcFalso({});
  const redator = new ClienteRedatorPosConsultaFalso('nao deveria ser chamado');
  const resultado = await avaliarEIniciarPosConsulta(rpc, redator, {
    ...ENTRADA_BASE,
    configuracao: { modo: 'google', prazoMinutos: 60 },
  });
  assert.deepEqual(resultado, { tipo: 'nao_elegivel', motivo: 'link_google_ausente' });
});

// ── Revisao final do Codex, bloqueador 2: janela maxima de idade ─────────────
test('agendamento fora da janela maxima nunca chega a RPC nem a redatora (inelegivel em memoria)', async () => {
  const rpc = new ClienteRpcFalso({});
  const redator = new ClienteRedatorPosConsultaFalso('nao deveria ser chamado');
  const resultado = await avaliarEIniciarPosConsulta(rpc, redator, {
    ...ENTRADA_BASE,
    agendamento: { ...ENTRADA_BASE.agendamento, concluidoEm: '2026-08-24T12:00:00.000Z' }, // semanas atras
  });
  assert.deepEqual(resultado, { tipo: 'nao_elegivel', motivo: 'janela_maxima_excedida' });
  assert.equal(rpc.chamadas.length, 0);
  assert.equal(redator.chamadas.length, 0);
});

test('a RPC (autoritativa, sob lock) recusar por janela vira nao_elegivel/janela_maxima_excedida, sem mensagem', async () => {
  // Elegivel em memoria, mas o banco discorda (corrida com o relogio ou reclaim fora da janela).
  const rpc = new ClienteRpcFalso({ cappia_pos_consulta_iniciar_jornada: { data: { resultado: 'fora_da_janela' }, error: null } });
  const redator = new ClienteRedatorPosConsultaFalso('nao deveria ser chamado');
  const resultado = await avaliarEIniciarPosConsulta(rpc, redator, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'nao_elegivel', motivo: 'janela_maxima_excedida' });
  assert.equal(redator.chamadas.length, 0);
});

// ── Revisao final do Codex, bloqueador 1: nenhum modo envia Google no turno 0 ─
test('modo google elegivel inicia PERGUNTANDO (convite pendente false), nunca com o link', async () => {
  const LINK = 'https://g.page/r/exemplo/review';
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: {
      data: { resultado: 'pendente', jornada_id: JORNADA, entrega_id: ENTREGA_ID, claim_token: TOKEN, modo: 'google', convite_pendente: false },
      error: null,
    },
  });
  const redator = new ClienteRedatorPosConsultaFalso('Oi! Como foi sua consulta?');
  const resultado = await avaliarEIniciarPosConsulta(rpc, redator, {
    ...ENTRADA_BASE,
    configuracao: { modo: 'google', prazoMinutos: 60, linkAvaliacaoGoogle: LINK },
    contexto: { linkAvaliacaoGoogle: LINK },
  });
  assert.equal(resultado.tipo, 'entrega_pendente');
  assert.equal(rpc.chamadas[0]!.parametros.p_convite_pendente, false);
  if (resultado.tipo === 'entrega_pendente') assert.ok(!resultado.resposta.includes(LINK));
});
