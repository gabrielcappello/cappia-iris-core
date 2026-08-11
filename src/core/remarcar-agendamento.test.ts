import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import { remarcarAgendamento } from './remarcar-agendamento.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';

const ENTRADA = {
  clinica_id: crypto.randomUUID(),
  paciente_id: crypto.randomUUID(),
  agendamento_id: crypto.randomUUID(),
  dentista_id: crypto.randomUUID(),
  procedimento_id: 'cleaning',
  duracao_min: 60,
  nova_data: '2026-08-20',
  novo_horario: '14:00',
};

const NOVO_ID = crypto.randomUUID();

function sucesso(extra: Record<string, unknown> = {}) {
  return {
    cappia_remarcar_agendamento_v2: {
      data: {
        sucesso: true,
        agendamento_id: NOVO_ID,
        agendamento_id_antigo: ENTRADA.agendamento_id,
        dentista_id: ENTRADA.dentista_id,
        duracao_min: 60,
        data: ENTRADA.nova_data,
        horario: ENTRADA.novo_horario,
        ...extra,
      },
      error: null,
    },
  };
}

test('sucesso: retorno escalar traduzido, ja_remarcado ausente vira false', async () => {
  const cliente = new ClienteRpcFalso(sucesso());

  const resultado = await remarcarAgendamento(cliente, ENTRADA);
  assert.equal(resultado.tipo, 'remarcado');
  if (resultado.tipo !== 'remarcado') return;
  assert.equal(resultado.agendamento_id, NOVO_ID);
  assert.equal(resultado.agendamento_id_antigo, ENTRADA.agendamento_id);
  assert.equal(resultado.ja_remarcado, false);
});

test('replay: ja_remarcado=true continua sendo SUCESSO, nunca falha', async () => {
  const cliente = new ClienteRpcFalso(sucesso({ ja_remarcado: true }));

  const resultado = await remarcarAgendamento(cliente, ENTRADA);
  assert.equal(resultado.tipo, 'remarcado');
  if (resultado.tipo !== 'remarcado') return;
  assert.equal(resultado.ja_remarcado, true);
  // O sucessor devolvido e o MESMO da primeira execucao.
  assert.equal(resultado.agendamento_id, NOVO_ID);
});

test('parametros enviados usam os identificadores ja resolvidos, nunca recalculados', async () => {
  const cliente = new ClienteRpcFalso(sucesso());
  await remarcarAgendamento(cliente, ENTRADA);

  assert.equal(cliente.chamadas.length, 1);
  assert.deepEqual(cliente.chamadas[0]!.parametros, {
    p_clinica_id: ENTRADA.clinica_id,
    p_paciente_id: ENTRADA.paciente_id,
    p_agendamento_id: ENTRADA.agendamento_id,
    p_dentista_id: ENTRADA.dentista_id,
    p_procedimento_id: ENTRADA.procedimento_id,
    p_duracao_min: ENTRADA.duracao_min,
    p_nova_data: ENTRADA.nova_data,
    p_novo_horario: ENTRADA.novo_horario,
  });
});

test('nunca chama a RPC legada nem cappia_disponibilidade_canonica', async () => {
  const cliente = new ClienteRpcFalso(sucesso());
  await remarcarAgendamento(cliente, ENTRADA);

  const nomes = cliente.chamadas.map((c) => c.nome);
  assert.deepEqual(nomes, ['cappia_remarcar_agendamento_v2']);
  assert.ok(!nomes.includes('cappia_remarcar_agendamento'));
  assert.ok(!nomes.includes('cappia_disponibilidade_canonica'));
});

test('cada motivo do vocabulario aprovado vira falhou com o motivo preservado', async () => {
  for (const motivo of [
    'agendamento_nao_encontrado',
    'nao_confirmado',
    'data_invalida',
    'horario_invalido',
    'duracao_invalida',
    'horario_ocupado',
    'erro_insercao',
  ]) {
    const cliente = new ClienteRpcFalso({
      cappia_remarcar_agendamento_v2: { data: { sucesso: false, motivo }, error: null },
    });
    assert.deepEqual(await remarcarAgendamento(cliente, ENTRADA), { tipo: 'falhou', motivo }, motivo);
  }
});

test('motivo fora do vocabulario aprovado: erro tecnico, nunca aceito as-is', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_remarcar_agendamento_v2: { data: { sucesso: false, motivo: 'motivo_inventado' }, error: null },
  });
  await assert.rejects(() => remarcarAgendamento(cliente, ENTRADA), ErroRpcTecnico);
});

test('sucesso sem agendamento_id_antigo: erro tecnico, nunca vinculo silenciosamente ausente', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_remarcar_agendamento_v2: {
      data: {
        sucesso: true,
        agendamento_id: NOVO_ID,
        dentista_id: ENTRADA.dentista_id,
        duracao_min: 60,
        data: ENTRADA.nova_data,
        horario: ENTRADA.novo_horario,
      },
      error: null,
    },
  });
  await assert.rejects(() => remarcarAgendamento(cliente, ENTRADA), ErroRpcTecnico);
});

test('ja_remarcado com tipo invalido: erro tecnico, nunca coagido', async () => {
  const cliente = new ClienteRpcFalso(sucesso({ ja_remarcado: 'sim' }));
  await assert.rejects(() => remarcarAgendamento(cliente, ENTRADA), ErroRpcTecnico);
});

test('erro do cliente supabase: nunca vaza error.message', async () => {
  const cliente = new ClienteRpcFalso({
    cappia_remarcar_agendamento_v2: { data: null, error: { message: 'detalhe interno do banco, nunca deve vazar' } },
  });

  try {
    await remarcarAgendamento(cliente, ENTRADA);
    assert.fail('deveria ter lancado');
  } catch (erro) {
    assert.ok(erro instanceof ErroRpcTecnico);
    assert.ok(!String(erro.message).includes('detalhe interno'));
  }
});

test('entrada invalida rejeita antes de qualquer chamada', async () => {
  const invalidas: Record<string, unknown>[] = [
    { clinica_id: 'nao-e-uuid' },
    { paciente_id: 'nao-e-uuid' },
    { agendamento_id: 'nao-e-uuid' },
    { dentista_id: 'nao-e-uuid' },
    { procedimento_id: '' },
    { duracao_min: 0 },
    { duracao_min: -30 },
    { duracao_min: 45.5 },
    { nova_data: '20/08/2026' },
    { novo_horario: '14h' },
  ];

  for (const override of invalidas) {
    const cliente = new ClienteRpcFalso({});
    await assert.rejects(
      () => remarcarAgendamento(cliente, { ...ENTRADA, ...override }),
      EntradaInvalidaError,
      JSON.stringify(override)
    );
    assert.equal(cliente.chamadas.length, 0, JSON.stringify(override));
  }
});
