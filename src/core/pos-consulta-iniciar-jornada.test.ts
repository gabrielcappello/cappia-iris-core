import assert from 'node:assert/strict';
import { test } from 'node:test';
import { iniciarJornadaPosConsulta } from './pos-consulta-iniciar-jornada.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';

const UUID_1 = '11111111-1111-1111-1111-111111111111';
const UUID_2 = '22222222-2222-2222-2222-222222222222';
const UUID_3 = '33333333-3333-3333-3333-333333333333';
const JORNADA_ID = '44444444-4444-4444-4444-444444444444';
const TOKEN = '55555555-5555-5555-5555-555555555555';
const ENTREGA_ID = '66666666-6666-6666-6666-666666666666';

const ENTRADA_BASE = {
  clinica_id: UUID_1,
  agendamento_id: UUID_2,
  paciente_id: UUID_3,
  telefone_normalizado: '5511999999999',
  modo: 'satisfacao' as const,
  convite_pendente: false as const,
};

test('pendente -- o chamador deve gerar, enviar, e so entao confirmar com o claim_token', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: {
      data: {
        resultado: 'pendente',
        jornada_id: JORNADA_ID,
        entrega_id: ENTREGA_ID,
        claim_token: TOKEN,
        modo: 'satisfacao',
        convite_pendente: false,
      },
      error: null,
    },
  });
  const resultado = await iniciarJornadaPosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, {
    tipo: 'pendente',
    jornada_id: JORNADA_ID,
    entrega_id: ENTREGA_ID,
    claim_token: TOKEN,
    modo: 'satisfacao',
    convite_pendente: false,
  });
});

test('em_andamento -- outra chamada ja reservou e o lease ainda vale, nunca enviar mensagem', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: { data: { resultado: 'em_andamento' }, error: null },
  });
  const resultado = await iniciarJornadaPosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'em_andamento' });
});

test('criterio 7 -- ja_existia (corrida perdida) nunca deve gerar segunda mensagem', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: {
      data: { resultado: 'ja_existia', jornada_id: JORNADA_ID, etapa: 'aguardando_satisfacao' },
      error: null,
    },
  });
  const resultado = await iniciarJornadaPosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'ja_existia', jornada_id: JORNADA_ID, etapa: 'aguardando_satisfacao' });
});

test('B4 -- conflito_telefone_ativo e um desfecho valido e distinto, nunca enviar mensagem', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: { data: { resultado: 'conflito_telefone_ativo' }, error: null },
  });
  const resultado = await iniciarJornadaPosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'conflito_telefone_ativo' });
});

test('parametros enviados a RPC usam exatamente os nomes p_* esperados, incluindo convite_pendente e telefone_normalizado (B3)', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: {
      data: {
        resultado: 'pendente',
        jornada_id: JORNADA_ID,
        entrega_id: ENTREGA_ID,
        claim_token: TOKEN,
        modo: 'google',
        convite_pendente: false,
      },
      error: null,
    },
  });
  await iniciarJornadaPosConsulta(cliente, { ...ENTRADA_BASE, modo: 'google' });
  assert.equal(cliente.chamadas.length, 1);
  assert.deepEqual(cliente.chamadas[0]!.parametros, {
    p_clinica_id: UUID_1,
    p_agendamento_id: UUID_2,
    p_paciente_id: UUID_3,
    p_telefone_normalizado: '5511999999999',
    p_modo: 'google',
    p_convite_pendente: false,
    p_link_avaliacao_google: null,
  });
});

test('link_avaliacao_google (Proposta C): enviado quando fornecido, null quando ausente', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: {
      data: {
        resultado: 'pendente',
        jornada_id: JORNADA_ID,
        entrega_id: ENTREGA_ID,
        claim_token: TOKEN,
        modo: 'google',
        convite_pendente: false,
        link_avaliacao_google: 'https://g.page/r/exemplo/review',
      },
      error: null,
    },
  });
  const resultado = await iniciarJornadaPosConsulta(cliente, {
    ...ENTRADA_BASE,
    modo: 'google',
    link_avaliacao_google: 'https://g.page/r/exemplo/review',
  });
  assert.equal(cliente.chamadas[0]!.parametros.p_link_avaliacao_google, 'https://g.page/r/exemplo/review');
  assert.equal(resultado.tipo, 'pendente');
  if (resultado.tipo === 'pendente') {
    assert.equal(resultado.link_avaliacao_google, 'https://g.page/r/exemplo/review');
  }
});

test('clinica_id malformado nunca chega a chamar a RPC', async () => {
  const cliente = new ClienteRpcFalso({});
  await assert.rejects(
    () => iniciarJornadaPosConsulta(cliente, { ...ENTRADA_BASE, clinica_id: 'nao-e-uuid' }),
    EntradaInvalidaError
  );
  assert.equal(cliente.chamadas.length, 0);
});

test('modo fora do vocabulario fechado nunca chega a chamar a RPC', async () => {
  const cliente = new ClienteRpcFalso({});
  await assert.rejects(
    () => iniciarJornadaPosConsulta(cliente, { ...ENTRADA_BASE, modo: 'nenhum' as never }),
    EntradaInvalidaError
  );
  assert.equal(cliente.chamadas.length, 0);
});

test('erro do cliente supabase nunca propaga error.message -- so ErroRpcTecnico', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: { data: null, error: { message: 'detalhe interno do Postgres' } },
  });
  await assert.rejects(() => iniciarJornadaPosConsulta(cliente, ENTRADA_BASE), ErroRpcTecnico);
});

test('retorno "pendente" sem claim_token em formato UUID falha fechado', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: {
      data: {
        resultado: 'pendente',
        jornada_id: JORNADA_ID,
        entrega_id: ENTREGA_ID,
        claim_token: 'nao-e-uuid',
        modo: 'satisfacao',
        convite_pendente: false,
      },
      error: null,
    },
  });
  await assert.rejects(() => iniciarJornadaPosConsulta(cliente, ENTRADA_BASE), ErroRpcTecnico);
});

test('retorno "pendente" sem entrega_id em formato UUID falha fechado (B2)', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: {
      data: {
        resultado: 'pendente',
        jornada_id: JORNADA_ID,
        entrega_id: 'nao-e-uuid',
        claim_token: TOKEN,
        modo: 'satisfacao',
        convite_pendente: false,
      },
      error: null,
    },
  });
  await assert.rejects(() => iniciarJornadaPosConsulta(cliente, ENTRADA_BASE), ErroRpcTecnico);
});

test('resultado fora do vocabulario aprovado falha fechado', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: { data: { resultado: 'algo_inesperado' }, error: null },
  });
  await assert.rejects(() => iniciarJornadaPosConsulta(cliente, ENTRADA_BASE), ErroRpcTecnico);
});

// ── Revisao final do Codex, bloqueador 1: a PRIMEIRA entrega nunca e convite ──
test('convite_pendente verdadeiro e recusado ANTES de chamar a RPC (a primeira entrega nunca e convite Google)', async () => {
  const cliente = new ClienteRpcFalso({});
  for (const modo of ['satisfacao', 'google', 'ambos'] as const) {
    await assert.rejects(
      () => iniciarJornadaPosConsulta(cliente, { ...ENTRADA_BASE, modo, convite_pendente: true as never }),
      EntradaInvalidaError
    );
  }
  assert.equal(cliente.chamadas.length, 0);
});

test('convite_pendente ausente ou nao booleano tambem e recusado antes da RPC', async () => {
  const cliente = new ClienteRpcFalso({});
  await assert.rejects(() => iniciarJornadaPosConsulta(cliente, { ...ENTRADA_BASE, convite_pendente: undefined as never }), EntradaInvalidaError);
  await assert.rejects(() => iniciarJornadaPosConsulta(cliente, { ...ENTRADA_BASE, convite_pendente: 'false' as never }), EntradaInvalidaError);
  assert.equal(cliente.chamadas.length, 0);
});

test('defesa em profundidade -- RPC devolvendo pendente com convite_pendente verdadeiro na primeira entrega falha fechado', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: {
      data: {
        resultado: 'pendente',
        jornada_id: JORNADA_ID,
        entrega_id: ENTREGA_ID,
        claim_token: TOKEN,
        modo: 'google',
        convite_pendente: true,
      },
      error: null,
    },
  });
  await assert.rejects(() => iniciarJornadaPosConsulta(cliente, { ...ENTRADA_BASE, modo: 'google' }), ErroRpcTecnico);
});

// ── Revisao final do Codex, bloqueador 2: janela maxima de idade ──
test('fora_da_janela -- a RPC recusou autorizar (jornada nova ou reclaim), nunca enviar mensagem', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_iniciar_jornada: { data: { resultado: 'fora_da_janela' }, error: null },
  });
  const resultado = await iniciarJornadaPosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'fora_da_janela' });
});
