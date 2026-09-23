import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmarEntregaPosConsulta } from './pos-consulta-confirmar-entrega.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';

const UUID_1 = '11111111-1111-1111-1111-111111111111';
const UUID_2 = '22222222-2222-2222-2222-222222222222';
const TOKEN = '33333333-3333-3333-3333-333333333333';

const ENTRADA_BASE = {
  clinica_id: UUID_1,
  agendamento_id: UUID_2,
  claim_token: TOKEN,
};

test('confirmada -- efeito aplicado', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_confirmar_entrega: { data: { resultado: 'confirmada' }, error: null },
  });
  const resultado = await confirmarEntregaPosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'confirmada' });
});

test('B2 -- token_invalido nunca reaplica efeito (retry com token obsoleto)', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_confirmar_entrega: { data: { resultado: 'token_invalido' }, error: null },
  });
  const resultado = await confirmarEntregaPosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'token_invalido' });
});

test('B2 (segunda revisao) -- lease_expirado nunca reaplica efeito, mesmo com token batendo', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_confirmar_entrega: { data: { resultado: 'lease_expirado' }, error: null },
  });
  const resultado = await confirmarEntregaPosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'lease_expirado' });
});

test('jornada_nao_encontrada e um desfecho valido e distinto', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_confirmar_entrega: { data: { resultado: 'jornada_nao_encontrada' }, error: null },
  });
  const resultado = await confirmarEntregaPosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'jornada_nao_encontrada' });
});

test('jornada_nao_pendente e um desfecho valido e distinto', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_confirmar_entrega: { data: { resultado: 'jornada_nao_pendente' }, error: null },
  });
  const resultado = await confirmarEntregaPosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'jornada_nao_pendente' });
});

test('B4 -- conflito_telefone_ativo ao confirmar para aguardando_satisfacao nunca aplica o avanco', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_confirmar_entrega: { data: { resultado: 'conflito_telefone_ativo' }, error: null },
  });
  const resultado = await confirmarEntregaPosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(resultado, { tipo: 'conflito_telefone_ativo' });
});

test('parametros enviados usam exatamente os nomes p_* esperados -- SEM etapa_confirmada (a RPC deriva sozinha, B2)', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_confirmar_entrega: { data: { resultado: 'confirmada' }, error: null },
  });
  await confirmarEntregaPosConsulta(cliente, ENTRADA_BASE);
  assert.deepEqual(cliente.chamadas[0]!.parametros, {
    p_clinica_id: UUID_1,
    p_agendamento_id: UUID_2,
    p_claim_token: TOKEN,
  });
});

test('claim_token malformado nunca chega a chamar a RPC', async () => {
  const cliente = new ClienteRpcFalso({});
  await assert.rejects(
    () => confirmarEntregaPosConsulta(cliente, { ...ENTRADA_BASE, claim_token: 'nao-e-uuid' }),
    EntradaInvalidaError
  );
  assert.equal(cliente.chamadas.length, 0);
});

test('resultado fora do vocabulario aprovado falha fechado', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_pos_consulta_confirmar_entrega: { data: { resultado: 'algo_inesperado' }, error: null },
  });
  await assert.rejects(() => confirmarEntregaPosConsulta(cliente, ENTRADA_BASE), ErroRpcTecnico);
});
