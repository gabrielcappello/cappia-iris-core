import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recuperarEntregaPosConsulta } from './pos-consulta-recuperar-entrega.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';

const UUID_1 = '11111111-1111-1111-1111-111111111111';
const UUID_2 = '22222222-2222-2222-2222-222222222222';
const UUID_3 = '33333333-3333-3333-3333-333333333333';
const ENTREGA_ID = '66666666-6666-6666-6666-666666666666';
const TOKEN = '55555555-5555-5555-5555-555555555555';
const LINK = 'https://g.page/r/exemplo/review';

const ENTRADA = { clinica_id: UUID_1, agendamento_id: UUID_2, paciente_id: UUID_3, telefone_normalizado: '5511999999999' };
const rpc = (data: unknown, error: { message: string } | null = null) =>
  new ClienteRpcFalso({ cappia_pos_consulta_recuperar_entrega: { data, error } });

const PENDENTE_INICIAL = {
  resultado: 'pendente', etapa: 'aguardando_inicio', modo: 'ambos', entrega_id: ENTREGA_ID, claim_token: TOKEN,
  classificacao: null, convite_pendente: false, link_avaliacao_google: null, tentativa: 2,
};
const PENDENTE_FINAL_CONVITE = {
  resultado: 'pendente', etapa: 'finalizando', modo: 'google', entrega_id: ENTREGA_ID, claim_token: TOKEN,
  classificacao: 'positiva', convite_pendente: true, link_avaliacao_google: LINK, tentativa: 2,
};

test('parametros enviados a RPC usam exatamente os nomes p_* esperados (telefone oficial relido)', async () => {
  const cliente = rpc(PENDENTE_INICIAL);
  await recuperarEntregaPosConsulta(cliente, ENTRADA);
  assert.deepEqual(cliente.chamadas[0]!.parametros, {
    p_clinica_id: UUID_1, p_agendamento_id: UUID_2, p_paciente_id: UUID_3, p_telefone_normalizado: '5511999999999',
  });
});

test('telefone null e aceito e enviado como null (a RPC encerra por vinculo invalido)', async () => {
  const cliente = rpc({ resultado: 'abandonada', motivo: 'abandonada_vinculo_invalido', etapa_anterior: 'aguardando_inicio' });
  const r = await recuperarEntregaPosConsulta(cliente, { ...ENTRADA, telefone_normalizado: null });
  assert.equal(cliente.chamadas[0]!.parametros.p_telefone_normalizado, null);
  assert.deepEqual(r, { tipo: 'abandonada', motivo: 'abandonada_vinculo_invalido', etapa_anterior: 'aguardando_inicio' });
});

test('pendente da PRIMEIRA entrega: reclamada, mesma entrega_id, sem convite e sem classificacao', async () => {
  const r = await recuperarEntregaPosConsulta(rpc(PENDENTE_INICIAL), ENTRADA);
  assert.deepEqual(r, {
    tipo: 'pendente', etapa: 'aguardando_inicio', modo: 'ambos', entrega_id: ENTREGA_ID, claim_token: TOKEN,
    classificacao: null, convite_pendente: false, tentativa: 2,
  });
});

test('pendente da SEGUNDA entrega: classificacao, convite e link do snapshot preservados', async () => {
  const r = await recuperarEntregaPosConsulta(rpc(PENDENTE_FINAL_CONVITE), ENTRADA);
  assert.deepEqual(r, {
    tipo: 'pendente', etapa: 'finalizando', modo: 'google', entrega_id: ENTREGA_ID, claim_token: TOKEN,
    classificacao: 'positiva', convite_pendente: true, link_avaliacao_google: LINK, tentativa: 2,
  });
});

test('desfechos sem mensagem: em_andamento, nao_pendente, jornada_nao_encontrada e abandonada (quatro motivos)', async () => {
  assert.deepEqual(await recuperarEntregaPosConsulta(rpc({ resultado: 'em_andamento' }), ENTRADA), { tipo: 'em_andamento' });
  assert.deepEqual(await recuperarEntregaPosConsulta(rpc({ resultado: 'nao_pendente', etapa: 'encerrada' }), ENTRADA), { tipo: 'nao_pendente', etapa: 'encerrada' });
  assert.deepEqual(await recuperarEntregaPosConsulta(rpc({ resultado: 'jornada_nao_encontrada' }), ENTRADA), { tipo: 'jornada_nao_encontrada' });
  for (const motivo of ['abandonada_automacao_desligada', 'abandonada_vinculo_invalido', 'abandonada_janela', 'abandonada_tentativas'] as const) {
    for (const etapa_anterior of ['aguardando_inicio', 'finalizando'] as const) {
      assert.deepEqual(await recuperarEntregaPosConsulta(rpc({ resultado: 'abandonada', motivo, etapa_anterior }), ENTRADA), { tipo: 'abandonada', motivo, etapa_anterior });
    }
  }
});

// ── DEFESA EM PROFUNDIDADE: Google so apos satisfacao positiva confirmada ──────
test('primeira entrega recuperada NUNCA pode voltar com convite ou classificacao (falha fechado)', async () => {
  for (const extra of [{ convite_pendente: true, classificacao: 'positiva', link_avaliacao_google: LINK, modo: 'google' }, { classificacao: 'positiva' }]) {
    await assert.rejects(() => recuperarEntregaPosConsulta(rpc({ ...PENDENTE_INICIAL, ...extra }), ENTRADA), ErroRpcTecnico);
  }
});

test('convite so com classificacao positiva, modo com Google e link do snapshot (falha fechado)', async () => {
  const invalidos = [
    { classificacao: 'nao_positiva' },
    { classificacao: 'incerta' },
    { modo: 'satisfacao' },
    { link_avaliacao_google: null },
    { link_avaliacao_google: '   ' },
  ];
  for (const variacao of invalidos) {
    await assert.rejects(() => recuperarEntregaPosConsulta(rpc({ ...PENDENTE_FINAL_CONVITE, ...variacao }), ENTRADA), ErroRpcTecnico, JSON.stringify(variacao));
  }
});

test('segunda entrega sem classificacao falha fechado; sem convite e com nao_positiva e valida', async () => {
  await assert.rejects(() => recuperarEntregaPosConsulta(rpc({ ...PENDENTE_FINAL_CONVITE, classificacao: null, convite_pendente: false }), ENTRADA), ErroRpcTecnico);
  const r = await recuperarEntregaPosConsulta(rpc({ ...PENDENTE_FINAL_CONVITE, classificacao: 'nao_positiva', convite_pendente: false, link_avaliacao_google: null }), ENTRADA);
  assert.equal(r.tipo === 'pendente' && r.convite_pendente, false);
});

// ── entrada e saida estritas ─────────────────────────────────────────────────
test('ids malformados nunca chegam a chamar a RPC', async () => {
  const cliente = rpc({});
  for (const campo of ['clinica_id', 'agendamento_id', 'paciente_id'] as const) {
    await assert.rejects(() => recuperarEntregaPosConsulta(cliente, { ...ENTRADA, [campo]: 'nao-e-uuid' }), EntradaInvalidaError, campo);
  }
  await assert.rejects(() => recuperarEntregaPosConsulta(cliente, { ...ENTRADA, telefone_normalizado: '  ' }), EntradaInvalidaError);
  assert.equal(cliente.chamadas.length, 0);
});

test('erro do cliente supabase nunca propaga error.message -- so ErroRpcTecnico', async () => {
  await assert.rejects(() => recuperarEntregaPosConsulta(rpc(null, { message: 'detalhe interno do Postgres' }), ENTRADA), ErroRpcTecnico);
});

test('saidas invalidas falham fechado (resultado, etapa, motivo, tokens, tentativa)', async () => {
  const invalidas: unknown[] = [
    null, 'texto', [], {}, { resultado: 'algo_inesperado' },
    { resultado: 'nao_pendente' },
    { resultado: 'abandonada', motivo: 'motivo_inventado', etapa_anterior: 'aguardando_inicio' },
    { resultado: 'abandonada', motivo: 'abandonada_janela', etapa_anterior: 'encerrada' },
    // `abandonada_sem_resposta` e da EXPIRACAO de aguardando_satisfacao (Disparo A, direto no banco) -- nunca desta RPC
    { resultado: 'abandonada', motivo: 'abandonada_sem_resposta', etapa_anterior: 'aguardando_inicio' },
    { ...PENDENTE_INICIAL, etapa: 'aguardando_satisfacao' },
    { ...PENDENTE_INICIAL, modo: 'nenhum' },
    { ...PENDENTE_INICIAL, entrega_id: 'nao-e-uuid' },
    { ...PENDENTE_INICIAL, claim_token: 'nao-e-uuid' },
    { ...PENDENTE_INICIAL, tentativa: 1 },
    { ...PENDENTE_INICIAL, tentativa: '2' },
    { ...PENDENTE_INICIAL, convite_pendente: 'false' },
  ];
  for (const data of invalidas) {
    await assert.rejects(() => recuperarEntregaPosConsulta(rpc(data), ENTRADA), ErroRpcTecnico, JSON.stringify(data));
  }
});
