// Testes de unidade de aplicar-interpretacao-condicional.ts usando o dublê
// ClienteRpcFalso (nenhum acesso a rede ou banco real).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aplicarInterpretacaoCondicional } from './aplicar-interpretacao-condicional.ts';
import { ErroRpcTecnico } from './erros.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import type { AplicarInterpretacaoCondicionalEntrada } from './mensagens-recebidas-tipos.ts';

const ENTRADA: AplicarInterpretacaoCondicionalEntrada = {
  mensagem_recebida_id: crypto.randomUUID(),
  clinica_id: crypto.randomUUID(),
  telefone_normalizado: '5511999999999',
  claim_token: crypto.randomUUID(),
  conversa_id: crypto.randomUUID(),
  snapshot_atualizado_em: new Date('2026-07-01T00:00:00.000Z').toISOString(),
  alteracoes_aplicaveis: { nome: { acao: 'informar', valor: 'Joao' } },
};

test('teste1: persistida retorna o estado oficial completo e envia os parametros p_* corretos', async () => {
  const atualizadoEm = new Date().toISOString();
  const cliente = new ClienteRpcFalso({
    aplicar_interpretacao_condicional: {
      data: [{ resultado: 'persistida', conversa_id: ENTRADA.conversa_id, dados: { nome: 'Joao' }, atualizado_em: atualizadoEm }],
      error: null,
    },
  });

  const resultado = await aplicarInterpretacaoCondicional(cliente, ENTRADA);

  assert.equal(resultado.resultado, 'persistida');
  assert.equal(resultado.conversa_id, ENTRADA.conversa_id);
  assert.deepEqual(resultado.dados, { nome: 'Joao' });
  assert.equal(resultado.atualizado_em, atualizadoEm);
  assert.equal(cliente.chamadas.length, 1);
  assert.deepEqual(cliente.chamadas[0].parametros, {
    p_mensagem_recebida_id: ENTRADA.mensagem_recebida_id,
    p_clinica_id: ENTRADA.clinica_id,
    p_telefone_normalizado: ENTRADA.telefone_normalizado,
    p_claim_token: ENTRADA.claim_token,
    p_conversa_id: ENTRADA.conversa_id,
    p_snapshot_atualizado_em: ENTRADA.snapshot_atualizado_em,
    p_alteracoes_aplicaveis: ENTRADA.alteracoes_aplicaveis,
  });
});

test('teste2: autorizacao_invalida nao retorna estado oficial', async () => {
  const cliente = new ClienteRpcFalso({
    aplicar_interpretacao_condicional: {
      data: [{ resultado: 'autorizacao_invalida', conversa_id: null, dados: null, atualizado_em: null }],
      error: null,
    },
  });

  const resultado = await aplicarInterpretacaoCondicional(cliente, ENTRADA);

  assert.equal(resultado.resultado, 'autorizacao_invalida');
  assert.equal(resultado.conversa_id, null);
  assert.equal(resultado.dados, null);
  assert.equal(resultado.atualizado_em, null);
});

test('teste3: conflito_concorrente nao retorna estado oficial', async () => {
  const cliente = new ClienteRpcFalso({
    aplicar_interpretacao_condicional: {
      data: [{ resultado: 'conflito_concorrente', conversa_id: null, dados: null, atualizado_em: null }],
      error: null,
    },
  });

  const resultado = await aplicarInterpretacaoCondicional(cliente, ENTRADA);

  assert.equal(resultado.resultado, 'conflito_concorrente');
  assert.equal(resultado.dados, null);
});

for (const campoAusente of ['conversa_id', 'dados', 'atualizado_em'] as const) {
  test(`teste4: persistida sem ${campoAusente} e rejeitado`, async () => {
    const linha: Record<string, unknown> = {
      resultado: 'persistida',
      conversa_id: ENTRADA.conversa_id,
      dados: { nome: 'Joao' },
      atualizado_em: new Date().toISOString(),
    };
    linha[campoAusente] = null;
    const cliente = new ClienteRpcFalso({ aplicar_interpretacao_condicional: { data: [linha], error: null } });

    await assert.rejects(() => aplicarInterpretacaoCondicional(cliente, ENTRADA), ErroRpcTecnico);
  });
}

test('teste5: autorizacao_invalida com conversa_id preenchido e rejeitado (payload nao confiavel)', async () => {
  const cliente = new ClienteRpcFalso({
    aplicar_interpretacao_condicional: {
      data: [{ resultado: 'autorizacao_invalida', conversa_id: ENTRADA.conversa_id, dados: null, atualizado_em: null }],
      error: null,
    },
  });

  await assert.rejects(() => aplicarInterpretacaoCondicional(cliente, ENTRADA), ErroRpcTecnico);
});

test('teste6: campo dados como array e rejeitado (deve ser objeto ou null)', async () => {
  const cliente = new ClienteRpcFalso({
    aplicar_interpretacao_condicional: {
      data: [{ resultado: 'persistida', conversa_id: ENTRADA.conversa_id, dados: ['nome'], atualizado_em: new Date().toISOString() }],
      error: null,
    },
  });

  await assert.rejects(() => aplicarInterpretacaoCondicional(cliente, ENTRADA), ErroRpcTecnico);
});

test('teste7: resultado fora do vocabulario aprovado e rejeitado', async () => {
  const cliente = new ClienteRpcFalso({
    aplicar_interpretacao_condicional: {
      data: [{ resultado: 'persistida_parcialmente', conversa_id: null, dados: null, atualizado_em: null }],
      error: null,
    },
  });

  await assert.rejects(() => aplicarInterpretacaoCondicional(cliente, ENTRADA), ErroRpcTecnico);
});

test('teste8: array vazio e rejeitado', async () => {
  const cliente = new ClienteRpcFalso({ aplicar_interpretacao_condicional: { data: [], error: null } });

  await assert.rejects(() => aplicarInterpretacaoCondicional(cliente, ENTRADA), ErroRpcTecnico);
});

test('teste9: array com mais de uma linha e rejeitado', async () => {
  const linha = { resultado: 'conflito_concorrente', conversa_id: null, dados: null, atualizado_em: null };
  const cliente = new ClienteRpcFalso({ aplicar_interpretacao_condicional: { data: [linha, linha], error: null } });

  await assert.rejects(() => aplicarInterpretacaoCondicional(cliente, ENTRADA), ErroRpcTecnico);
});

test('teste10: erro tecnico reportado pelo cliente e propagado como ErroRpcTecnico', async () => {
  const cliente = new ClienteRpcFalso({
    aplicar_interpretacao_condicional: { data: null, error: { message: 'timeout' } },
  });

  await assert.rejects(() => aplicarInterpretacaoCondicional(cliente, ENTRADA), ErroRpcTecnico);
  assert.equal(cliente.chamadas.length, 1);
});

test('teste11: nunca ha releitura nem nova tentativa apos conflito_concorrente ou autorizacao_invalida', async () => {
  for (const resultado of ['persistida', 'autorizacao_invalida', 'conflito_concorrente'] as const) {
    const dados = resultado === 'persistida' ? { nome: 'Joao' } : null;
    const conversaId = resultado === 'persistida' ? ENTRADA.conversa_id : null;
    const atualizadoEm = resultado === 'persistida' ? new Date().toISOString() : null;
    const cliente = new ClienteRpcFalso({
      aplicar_interpretacao_condicional: { data: [{ resultado, conversa_id: conversaId, dados, atualizado_em: atualizadoEm }], error: null },
    });

    await aplicarInterpretacaoCondicional(cliente, ENTRADA);

    assert.equal(cliente.chamadas.length, 1, `resultado '${resultado}' deve disparar exatamente uma chamada .rpc()`);
  }
});
