import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import { cancelarAgendamento } from './cancelar-agendamento.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';

const ENTRADA = {
  clinica_id: crypto.randomUUID(),
  paciente_id: crypto.randomUUID(),
  agendamento_id: crypto.randomUUID(),
};

function sucesso(extra: Record<string, unknown> = {}) {
  return {
    cappia_cancelar_agendamento_v2: {
      data: { sucesso: true, agendamento_id: ENTRADA.agendamento_id, status: 'cancelado', ...extra },
      error: null,
    },
  };
}

test('sucesso: retorno escalar traduzido, ja_cancelado ausente vira false', async () => {
  const cliente = new ClienteRpcFalso(sucesso());

  const resultado = await cancelarAgendamento(cliente, ENTRADA);
  assert.equal(resultado.tipo, 'cancelado');
  if (resultado.tipo !== 'cancelado') return;
  assert.equal(resultado.agendamento_id, ENTRADA.agendamento_id);
  assert.equal(resultado.ja_cancelado, false);
});

test('replay: ja_cancelado=true continua sendo SUCESSO, nunca falha', async () => {
  const cliente = new ClienteRpcFalso(sucesso({ ja_cancelado: true }));

  const resultado = await cancelarAgendamento(cliente, ENTRADA);
  assert.equal(resultado.tipo, 'cancelado');
  if (resultado.tipo !== 'cancelado') return;
  assert.equal(resultado.ja_cancelado, true);
});

test('parametros enviados incluem paciente_id -- e o que impede cancelar agendamento alheio', async () => {
  const cliente = new ClienteRpcFalso(sucesso());

  await cancelarAgendamento(cliente, ENTRADA);
  assert.equal(cliente.chamadas.length, 1);
  assert.equal(cliente.chamadas[0]!.nome, 'cappia_cancelar_agendamento_v2');
  assert.deepEqual(cliente.chamadas[0]!.parametros, {
    p_clinica_id: ENTRADA.clinica_id,
    p_paciente_id: ENTRADA.paciente_id,
    p_agendamento_id: ENTRADA.agendamento_id,
  });
});

test('a RPC LEGADA (sem sufixo) nunca e chamada', async () => {
  const cliente = new ClienteRpcFalso(sucesso());

  await cancelarAgendamento(cliente, ENTRADA);
  assert.ok(!cliente.chamadas.some((c) => c.nome === 'cappia_cancelar_agendamento'));
});

test('os tres motivos do vocabulario fechado viram falha tipada', async () => {
  for (const motivo of ['agendamento_nao_encontrado', 'nao_confirmado', 'erro_insercao']) {
    const cliente = new ClienteRpcFalso({
      cappia_cancelar_agendamento_v2: { data: { sucesso: false, motivo }, error: null },
    });
    const resultado = await cancelarAgendamento(cliente, ENTRADA);
    assert.equal(resultado.tipo, 'falhou');
    if (resultado.tipo !== 'falhou') return;
    assert.equal(resultado.motivo, motivo);
  }
});

test('motivo fora do vocabulario FALHA FECHADO, nunca vira falha generica', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_cancelar_agendamento_v2: { data: { sucesso: false, motivo: 'motivo_inventado' }, error: null },
  });
  await assert.rejects(() => cancelarAgendamento(cliente, ENTRADA), ErroRpcTecnico);
});

test('saida malformada FALHA FECHADO', async () => {
  const casos: unknown[] = [
    null,
    'texto',
    [{ sucesso: true }],
    { sucesso: 'sim' },
    { sucesso: true }, // sem agendamento_id
    { sucesso: true, agendamento_id: 'nao-e-uuid' },
    { sucesso: true, agendamento_id: crypto.randomUUID(), ja_cancelado: 'talvez' },
    { sucesso: false },
  ];
  for (const data of casos) {
    const cliente = new ClienteRpcFalso({ cappia_cancelar_agendamento_v2: { data, error: null } });
    await assert.rejects(() => cancelarAgendamento(cliente, ENTRADA), ErroRpcTecnico);
  }
});

test('erro do cliente nunca vaza a mensagem original', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_cancelar_agendamento_v2: { data: null, error: { message: 'SELECT ... paciente Joao CPF 123' } },
  });
  await assert.rejects(
    () => cancelarAgendamento(cliente, ENTRADA),
    (erro: unknown) => {
      assert.ok(erro instanceof ErroRpcTecnico);
      assert.ok(!String((erro as Error).message).includes('Joao'));
      assert.ok(!String((erro as Error).message).includes('123'));
      return true;
    }
  );
});

test('entrada invalida e rejeitada ANTES de qualquer chamada', async () => {
  for (const campo of ['clinica_id', 'paciente_id', 'agendamento_id'] as const) {
    const cliente = new ClienteRpcFalso(sucesso());
    const entrada = { ...ENTRADA, [campo]: 'nao-e-uuid' };
    await assert.rejects(() => cancelarAgendamento(cliente, entrada), EntradaInvalidaError);
    assert.equal(cliente.chamadas.length, 0);
  }
});
