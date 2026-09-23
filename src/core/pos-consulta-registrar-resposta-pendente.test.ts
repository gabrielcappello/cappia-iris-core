import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registrarRespostaPendentePosConsulta } from './pos-consulta-registrar-resposta-pendente.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';

const UUID_1 = '11111111-1111-1111-1111-111111111111';
const UUID_2 = '22222222-2222-2222-2222-222222222222';
const TOKEN = '33333333-3333-3333-3333-333333333333';
const ENTREGA_ID = '44444444-4444-4444-4444-444444444444';

const ENTRADA_BASE = {
  clinica_id: UUID_1,
  agendamento_id: UUID_2,
  classificacao: 'positiva' as const,
  convite_pendente: true,
};

test('pendente -- reserva a segunda entrega com os valores propostos', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: {
      data: { resultado: 'pendente', entrega_id: ENTREGA_ID, claim_token: TOKEN, classificacao: 'positiva', convite_pendente: true },
      error: null,
    },
  });
  const resultado = await registrarRespostaPendentePosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, {
    tipo: 'pendente',
    entrega_id: ENTREGA_ID,
    claim_token: TOKEN,
    classificacao: 'positiva',
    convite_pendente: true,
  });
});

test('B2 -- reclaim devolve a classificacao/convite JA GRAVADOS, podem diferir do que este chamador propos', async () => {
  // O chamador propos 'positiva'/true, mas a linha ja tinha 'nao_positiva'/false
  // gravados por uma tentativa anterior -- a RPC deve devolver o EFETIVO.
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: {
      data: { resultado: 'pendente', entrega_id: ENTREGA_ID, claim_token: TOKEN, classificacao: 'nao_positiva', convite_pendente: false },
      error: null,
    },
  });
  const resultado = await registrarRespostaPendentePosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, {
    tipo: 'pendente',
    entrega_id: ENTREGA_ID,
    claim_token: TOKEN,
    classificacao: 'nao_positiva',
    convite_pendente: false,
  });
});

test('em_andamento -- outra chamada ja reservou e o lease ainda vale', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: { data: { resultado: 'em_andamento' }, error: null },
  });
  const resultado = await registrarRespostaPendentePosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'em_andamento' });
});

test('criterio 6 -- ja_processada nunca deve gerar um segundo convite', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: { data: { resultado: 'ja_processada' }, error: null },
  });
  const resultado = await registrarRespostaPendentePosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'ja_processada' });
});

test('jornada_nao_encontrada e um desfecho valido e distinto', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: { data: { resultado: 'jornada_nao_encontrada' }, error: null },
  });
  const resultado = await registrarRespostaPendentePosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'jornada_nao_encontrada' });
});

test('jornada_nao_aguarda_resposta (resposta chegou antes da primeira entrega confirmada) e tratado explicitamente', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: { data: { resultado: 'jornada_nao_aguarda_resposta' }, error: null },
  });
  const resultado = await registrarRespostaPendentePosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'jornada_nao_aguarda_resposta' });
});

test('parametros enviados usam exatamente os nomes p_* esperados', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: {
      data: { resultado: 'pendente', entrega_id: ENTREGA_ID, claim_token: TOKEN, classificacao: 'positiva', convite_pendente: true },
      error: null,
    },
  });
  await registrarRespostaPendentePosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(cliente.chamadas[0]!.parametros, {
    p_clinica_id: UUID_1,
    p_agendamento_id: UUID_2,
    p_classificacao: 'positiva',
    p_convite_pendente: true,
  });
});

test('classificacao fora do vocabulario fechado nunca chega a chamar a RPC', async () => {
  const cliente = new ClienteRpcFalso({});
  await assert.rejects(
    () => registrarRespostaPendentePosConsulta(cliente, { ...ENTRADA_BASE, classificacao: 'muito_feliz' as never }),
    EntradaInvalidaError
  );
  assert.equal(cliente.chamadas.length, 0);
});

test('erro do cliente supabase nunca propaga error.message -- so ErroRpcTecnico', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: { data: null, error: { message: 'detalhe interno do Postgres' } },
  });
  await assert.rejects(() => registrarRespostaPendentePosConsulta(cliente, ENTRADA_BASE), ErroRpcTecnico);
});

test('retorno "pendente" sem entrega_id em formato UUID falha fechado (B2)', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: {
      data: { resultado: 'pendente', entrega_id: 'nao-e-uuid', claim_token: TOKEN, classificacao: 'positiva', convite_pendente: true },
      error: null,
    },
  });
  await assert.rejects(() => registrarRespostaPendentePosConsulta(cliente, ENTRADA_BASE), ErroRpcTecnico);
});

test('resultado fora do vocabulario aprovado falha fechado', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: { data: { resultado: 'algo_inesperado' }, error: null },
  });
  await assert.rejects(() => registrarRespostaPendentePosConsulta(cliente, ENTRADA_BASE), ErroRpcTecnico);
});
