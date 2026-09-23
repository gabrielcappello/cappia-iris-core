import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarInicioPosConsulta } from './pos-consulta-processar-inicio.ts';
import { confirmarEntregaPosConsulta } from './pos-consulta-confirmar-entrega.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import { ClienteRedatorPosConsultaFalso } from './teste-cliente-redator-pos-consulta-falso.ts';

const CLINICA = '11111111-1111-1111-1111-111111111111';
const AGENDAMENTO = '22222222-2222-2222-2222-222222222222';
const PACIENTE = '33333333-3333-3333-3333-333333333333';
const JORNADA = '44444444-4444-4444-4444-444444444444';
const TOKEN = '55555555-5555-5555-5555-555555555555';
const ENTREGA_ID = '66666666-6666-6666-6666-666666666666';
const LINK = 'https://g.page/r/exemplo/review';

const ENTRADA_BASE = {
  clinicaId: CLINICA,
  agendamentoId: AGENDAMENTO,
  pacienteId: PACIENTE,
  telefoneNormalizado: '5511999999999',
  contexto: {},
};

test('criterio 1 -- modo satisfacao reserva a pergunta e nunca envia link', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: {
      data: { resultado: 'pendente', jornada_id: JORNADA, entrega_id: ENTREGA_ID, claim_token: TOKEN, modo: 'satisfacao', convite_pendente: false },
      error: null,
    },
  });
  const redator = new ClienteRedatorPosConsultaFalso('Oi! Como foi sua consulta?');
  const resultado = await processarInicioPosConsulta(rpc, redator, { ...ENTRADA_BASE, modo: 'satisfacao' });

  assert.equal(resultado.tipo, 'entrega_pendente');
  if (resultado.tipo === 'entrega_pendente') {
    assert.ok(!resultado.resposta.toLowerCase().includes(LINK));
    assert.deepEqual(resultado.confirmacao, { agendamentoId: AGENDAMENTO, entregaId: ENTREGA_ID, claimToken: TOKEN });
  }
});

// Revisao final do Codex (bloqueador 1): o modo 'google' NAO envia mais o link
// direto -- a primeira mensagem e a pergunta de satisfacao, sem convite
// pendente, e um texto com URL vindo da redatora e barrado pela guarda.
test('criterio 2 (revisado) -- modo google reserva a PERGUNTA, sem convite pendente e sem link', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: {
      data: { resultado: 'pendente', jornada_id: JORNADA, entrega_id: ENTREGA_ID, claim_token: TOKEN, modo: 'google', convite_pendente: false },
      error: null,
    },
  });
  const redator = new ClienteRedatorPosConsultaFalso(`Como foi sua consulta? Avalie a gente aqui: ${LINK}`);
  const resultado = await processarInicioPosConsulta(rpc, redator, {
    ...ENTRADA_BASE,
    modo: 'google',
    contexto: { linkAvaliacaoGoogle: LINK },
  });

  assert.equal(resultado.tipo, 'entrega_pendente');
  assert.equal(rpc.chamadas[0]!.parametros.p_convite_pendente, false);
  if (resultado.tipo === 'entrega_pendente') {
    // A redatora tentou incluir o link; a guarda barra e o fallback (pergunta fixa) nao tem URL.
    assert.equal(resultado.motivo_fallback, 'link_nao_autorizado');
    assert.ok(!resultado.resposta.includes(LINK));
    assert.equal(resultado.confirmacao.entregaId, ENTREGA_ID);
  }
});

test('nenhum modo envia convite pendente na primeira entrega (p_convite_pendente sempre false)', async () => {
  for (const modo of ['satisfacao', 'google', 'ambos'] as const) {
    const rpc = new ClienteRpcFalso({
      cappia_pos_consulta_iniciar_jornada: {
        data: { resultado: 'pendente', jornada_id: JORNADA, entrega_id: ENTREGA_ID, claim_token: TOKEN, modo, convite_pendente: false },
        error: null,
      },
    });
    await processarInicioPosConsulta(rpc, new ClienteRedatorPosConsultaFalso('Oi! Como foi sua consulta?'), {
      ...ENTRADA_BASE,
      modo,
      contexto: { linkAvaliacaoGoogle: LINK },
    });
    assert.equal(rpc.chamadas[0]!.parametros.p_convite_pendente, false, modo);
  }
});

test('fora_da_janela -- a RPC recusou autorizar: nao gera resposta nem confirmacao', async () => {
  const rpc = new ClienteRpcFalso({ cappia_pos_consulta_iniciar_jornada: { data: { resultado: 'fora_da_janela' }, error: null } });
  const resultado = await processarInicioPosConsulta(rpc, null, { ...ENTRADA_BASE, modo: 'satisfacao' });
  assert.deepEqual(resultado, { tipo: 'fora_da_janela' });
});

test('criterio 3 -- modo ambos nunca envia link na primeira mensagem', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: {
      data: { resultado: 'pendente', jornada_id: JORNADA, entrega_id: ENTREGA_ID, claim_token: TOKEN, modo: 'ambos', convite_pendente: false },
      error: null,
    },
  });
  const redator = new ClienteRedatorPosConsultaFalso('Oi! Como foi sua consulta?');
  const resultado = await processarInicioPosConsulta(rpc, redator, {
    ...ENTRADA_BASE,
    modo: 'ambos',
    contexto: { linkAvaliacaoGoogle: LINK },
  });

  assert.equal(resultado.tipo, 'entrega_pendente');
  assert.equal(rpc.chamadas[0]!.parametros.p_convite_pendente, false);
  if (resultado.tipo === 'entrega_pendente') {
    assert.ok(!resultado.resposta.includes(LINK));
  }
});

test('em_andamento -- nao gera resposta nem confirmacao', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: { data: { resultado: 'em_andamento' }, error: null },
  });
  const redator = new ClienteRedatorPosConsultaFalso('nao deveria ser chamado');
  const resultado = await processarInicioPosConsulta(rpc, redator, { ...ENTRADA_BASE, modo: 'satisfacao' });
  assert.deepEqual(resultado, { tipo: 'em_andamento' });
  assert.equal(redator.chamadas.length, 0);
});

test('criterio 7 -- ja_existia (corrida perdida) nunca produz segunda mensagem', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: {
      data: { resultado: 'ja_existia', jornada_id: JORNADA, etapa: 'aguardando_satisfacao' },
      error: null,
    },
  });
  const redator = new ClienteRedatorPosConsultaFalso('nao deveria ser chamado');
  const resultado = await processarInicioPosConsulta(rpc, redator, { ...ENTRADA_BASE, modo: 'satisfacao' });
  assert.deepEqual(resultado, { tipo: 'ja_existia' });
  assert.equal(redator.chamadas.length, 0);
});

test('B4 -- conflito_telefone_ativo nunca produz mensagem', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: { data: { resultado: 'conflito_telefone_ativo' }, error: null },
  });
  const redator = new ClienteRedatorPosConsultaFalso('nao deveria ser chamado');
  const resultado = await processarInicioPosConsulta(rpc, redator, { ...ENTRADA_BASE, modo: 'satisfacao' });
  assert.deepEqual(resultado, { tipo: 'conflito_telefone_ativo' });
  assert.equal(redator.chamadas.length, 0);
});

// ── B2: fronteiras de entrega -- antes, durante e depois, ate o ack ──────
test('B2 -- fronteira "antes da entrega": autorizar sem confirmar nunca avanca a etapa (a confirmacao e uma chamada SEPARADA)', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: {
      data: { resultado: 'pendente', jornada_id: JORNADA, entrega_id: ENTREGA_ID, claim_token: TOKEN, modo: 'satisfacao', convite_pendente: false },
      error: null,
    },
  });
  const redator = new ClienteRedatorPosConsultaFalso('Oi! Como foi sua consulta?');
  await processarInicioPosConsulta(rpc, redator, { ...ENTRADA_BASE, modo: 'satisfacao' });

  // Nenhuma chamada de confirmacao foi feita por processarInicioPosConsulta
  // -- so a de iniciar. A etapa so avanca quando o CHAMADOR (que enviaria a
  // mensagem de verdade) decide confirmar.
  assert.equal(rpc.chamadas.length, 1);
  assert.equal(rpc.chamadas[0]!.nome, 'cappia_pos_consulta_iniciar_jornada');
});

test('B2 -- fronteira "depois da entrega, antes do ack": confirmar com token invalido nunca reaplica efeito', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_confirmar_entrega: { data: { resultado: 'token_invalido' }, error: null },
  });
  const resultado = await confirmarEntregaPosConsulta(rpc, {
    clinica_id: CLINICA,
    agendamento_id: AGENDAMENTO,
    claim_token: TOKEN,
  });
  assert.deepEqual(resultado, { tipo: 'token_invalido' });
});

test('B2 (segunda revisao) -- confirmar com lease expirado (token ainda bate) nunca reaplica efeito', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_confirmar_entrega: { data: { resultado: 'lease_expirado' }, error: null },
  });
  const resultado = await confirmarEntregaPosConsulta(rpc, {
    clinica_id: CLINICA,
    agendamento_id: AGENDAMENTO,
    claim_token: TOKEN,
  });
  assert.deepEqual(resultado, { tipo: 'lease_expirado' });
});

test('B2 -- fronteira "durante a entrega": reclaim (segunda chamada de iniciar apos lease expirado) devolve claim_token NOVO, mas o MESMO entrega_id', async () => {
  const tokenNovo = '77777777-7777-7777-7777-777777777777';
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: [
      {
        data: { resultado: 'pendente', jornada_id: JORNADA, entrega_id: ENTREGA_ID, claim_token: TOKEN, modo: 'satisfacao', convite_pendente: false },
        error: null,
      },
      {
        // Simula: primeira tentativa caiu (nunca confirmou); o lease
        // expirou; esta segunda chamada reclama a MESMA jornada -- token
        // novo, mas entrega_id PRESERVADO (identidade estavel, B2 segunda
        // revisao).
        data: { resultado: 'pendente', jornada_id: JORNADA, entrega_id: ENTREGA_ID, claim_token: tokenNovo, modo: 'satisfacao', convite_pendente: false },
        error: null,
      },
    ],
  });
  const redator = new ClienteRedatorPosConsultaFalso('Oi! Como foi sua consulta?');

  const primeira = await processarInicioPosConsulta(rpc, redator, { ...ENTRADA_BASE, modo: 'satisfacao' });
  const segunda = await processarInicioPosConsulta(rpc, redator, { ...ENTRADA_BASE, modo: 'satisfacao' });

  assert.equal(primeira.tipo, 'entrega_pendente');
  assert.equal(segunda.tipo, 'entrega_pendente');
  if (primeira.tipo === 'entrega_pendente' && segunda.tipo === 'entrega_pendente') {
    assert.equal(primeira.confirmacao.agendamentoId, segunda.confirmacao.agendamentoId);
    assert.equal(primeira.confirmacao.entregaId, segunda.confirmacao.entregaId);
    assert.notEqual(primeira.confirmacao.claimToken, segunda.confirmacao.claimToken);
  }
});
