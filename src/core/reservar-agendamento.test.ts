import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import { reservarAgendamento } from './reservar-agendamento.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';

const ENTRADA = {
  clinica_id: crypto.randomUUID(),
  procedimento_id: 'cleaning',
  dentista_id: crypto.randomUUID(),
  paciente_id: crypto.randomUUID(),
  data: '2026-08-03',
  horario: '09:00',
  telefone_normalizado: '5511999999999',
};

test('sucesso: retorno escalar (nao array) e aceito e traduzido', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_reservar_agendamento: {
      data: {
        sucesso: true,
        agendamento_id: crypto.randomUUID(),
        dentista_id: ENTRADA.dentista_id,
        duracao_min: 30,
        data: '2026-08-03',
        horario: '09:00',
      },
      error: null,
    },
  });

  const resultado = await reservarAgendamento(cliente, ENTRADA);
  assert.equal(resultado.tipo, 'reservado');
  if (resultado.tipo === 'reservado') {
    assert.equal(resultado.dentista_id, ENTRADA.dentista_id);
    assert.equal(resultado.duracao_min, 30);
  }
});

test('parametros enviados usam os identificadores ja resolvidos, nunca recalculados', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_reservar_agendamento: {
      data: {
        sucesso: true,
        agendamento_id: crypto.randomUUID(),
        dentista_id: ENTRADA.dentista_id,
        duracao_min: 30,
        data: ENTRADA.data,
        horario: ENTRADA.horario,
      },
      error: null,
    },
  });

  await reservarAgendamento(cliente, ENTRADA);

  assert.equal(cliente.chamadas.length, 1);
  assert.deepEqual(cliente.chamadas[0].parametros, {
    p_clinica_id: ENTRADA.clinica_id,
    p_data: ENTRADA.data,
    p_horario: ENTRADA.horario,
    p_procedimento_id: ENTRADA.procedimento_id,
    p_paciente_id: ENTRADA.paciente_id,
    p_dentista_id: ENTRADA.dentista_id,
    p_telefone: ENTRADA.telefone_normalizado,
  });
});

test('horario_ocupado vira conflito, nunca falhou', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_reservar_agendamento: { data: { sucesso: false, motivo: 'horario_ocupado' }, error: null },
  });

  const resultado = await reservarAgendamento(cliente, ENTRADA);
  assert.deepEqual(resultado, { tipo: 'conflito' });
});

test('outro motivo de erro vira falhou, com o motivo preservado', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_reservar_agendamento: { data: { sucesso: false, motivo: 'dentista_nao_encontrado' }, error: null },
  });

  const resultado = await reservarAgendamento(cliente, ENTRADA);
  assert.deepEqual(resultado, { tipo: 'falhou', motivo: 'dentista_nao_encontrado' });
});

test('erro do cliente supabase: nunca vaza error.message', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_reservar_agendamento: { data: null, error: { message: 'detalhe interno do banco, nunca deve vazar' } },
  });

  await assert.rejects(() => reservarAgendamento(cliente, ENTRADA), ErroRpcTecnico);
  try {
    await reservarAgendamento(cliente, ENTRADA);
    assert.fail('deveria ter lancado');
  } catch (erro) {
    assert.ok(erro instanceof ErroRpcTecnico);
    assert.ok(!String(erro.message).includes('detalhe interno'));
  }
});

test('clinica_id invalido: rejeita antes de qualquer chamada', async () => {
  const cliente = new ClienteRpcFalso({});
  await assert.rejects(
    () => reservarAgendamento(cliente, { ...ENTRADA, clinica_id: 'nao-e-uuid' }),
    EntradaInvalidaError
  );
  assert.equal(cliente.chamadas.length, 0);
});

test('horario fora do formato HH:MM: rejeita antes de qualquer chamada', async () => {
  const cliente = new ClienteRpcFalso({});
  await assert.rejects(() => reservarAgendamento(cliente, { ...ENTRADA, horario: '9h' }), EntradaInvalidaError);
  assert.equal(cliente.chamadas.length, 0);
});

test('resposta com motivo fora do vocabulario aprovado: erro tecnico, nunca aceito as-is', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_reservar_agendamento: { data: { sucesso: false, motivo: 'motivo_inventado' }, error: null },
  });
  await assert.rejects(() => reservarAgendamento(cliente, ENTRADA), ErroRpcTecnico);
});
