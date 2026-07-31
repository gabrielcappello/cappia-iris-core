// Testes de unidade de aplicar-interpretacao-condicional.ts usando o dublê
// ClienteRpcFalso (nenhum acesso a rede ou banco real).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aplicarInterpretacaoCondicional } from './aplicar-interpretacao-condicional.ts';
import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
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

test('teste9b: retorno como objeto unico (nao array) e rejeitado -- nenhuma tolerancia a formatos alternativos', async () => {
  const cliente = new ClienteRpcFalso({
    aplicar_interpretacao_condicional: {
      data: { resultado: 'conflito_concorrente', conversa_id: null, dados: null, atualizado_em: null },
      error: null,
    },
  });

  await assert.rejects(() => aplicarInterpretacaoCondicional(cliente, ENTRADA), ErroRpcTecnico);
});

test('teste10: erro tecnico reportado pelo cliente e propagado como ErroRpcTecnico com motivo fixo', async () => {
  const cliente = new ClienteRpcFalso({
    aplicar_interpretacao_condicional: { data: null, error: { message: 'timeout' } },
  });

  await assert.rejects(
    () => aplicarInterpretacaoCondicional(cliente, ENTRADA),
    (erro: unknown) => {
      assert.ok(erro instanceof ErroRpcTecnico);
      assert.equal(erro.rpc, 'aplicar_interpretacao_condicional');
      assert.ok(erro.message.includes('cliente_supabase_falhou'), 'motivo deve ser o codigo tecnico fixo');
      return true;
    }
  );
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

// --- teste12: formato invalido dos campos de saida (UUID/timestamp) ---

test('teste12: persistida com conversa_id que nao e UUID e rejeitado', async () => {
  const cliente = new ClienteRpcFalso({
    aplicar_interpretacao_condicional: {
      data: [{ resultado: 'persistida', conversa_id: 'nao-e-um-uuid', dados: { nome: 'Joao' }, atualizado_em: new Date().toISOString() }],
      error: null,
    },
  });

  await assert.rejects(() => aplicarInterpretacaoCondicional(cliente, ENTRADA), ErroRpcTecnico);
});

test('teste13: persistida com atualizado_em que nao e timestamp valido e rejeitado', async () => {
  const cliente = new ClienteRpcFalso({
    aplicar_interpretacao_condicional: {
      data: [{ resultado: 'persistida', conversa_id: ENTRADA.conversa_id, dados: { nome: 'Joao' }, atualizado_em: 'ontem' }],
      error: null,
    },
  });

  await assert.rejects(() => aplicarInterpretacaoCondicional(cliente, ENTRADA), ErroRpcTecnico);
});

// --- teste14: sanitizacao -- error.message do cliente Supabase nunca vaza ---

test('teste14: error.message do cliente contendo telefone/CPF/claim_token/SQL nunca aparece no erro propagado', async () => {
  const mensagemSensivel = [
    `telefone=${ENTRADA.telefone_normalizado}`,
    'cpf=11122233344',
    `claim_token=${ENTRADA.claim_token}`,
    "update estado_conversa set dados = '{}' where id = '123'",
  ].join(' ');
  const cliente = new ClienteRpcFalso({
    aplicar_interpretacao_condicional: { data: null, error: { message: mensagemSensivel } },
  });

  await assert.rejects(
    () => aplicarInterpretacaoCondicional(cliente, ENTRADA),
    (erro: unknown) => {
      assert.ok(erro instanceof ErroRpcTecnico);
      const serializado = JSON.stringify(erro);
      const propriedadesPublicas = (Object.keys(erro) as (keyof ErroRpcTecnico)[]).map((chave) => String(erro[chave]));
      for (const trecho of [ENTRADA.telefone_normalizado, '11122233344', ENTRADA.claim_token, 'update estado_conversa']) {
        assert.ok(!erro.message.includes(trecho), `erro.message nao deve conter: ${trecho}`);
        assert.ok(!erro.stack?.includes(trecho), `stack nao deve conter: ${trecho}`);
        assert.ok(!serializado?.includes(trecho), `JSON.stringify nao deve conter: ${trecho}`);
        assert.ok(!propriedadesPublicas.some((valor) => valor.includes(trecho)), `propriedades publicas nao devem conter: ${trecho}`);
      }
      return true;
    }
  );
});

// --- teste15: validacao minima das entradas, antes de qualquer chamada ao Supabase ---

async function esperarRejeicaoSemChamada(
  entrada: AplicarInterpretacaoCondicionalEntrada,
  valorInvalido: string
): Promise<void> {
  const cliente = new ClienteRpcFalso({
    aplicar_interpretacao_condicional: {
      data: [{ resultado: 'conflito_concorrente', conversa_id: null, dados: null, atualizado_em: null }],
      error: null,
    },
  });

  await assert.rejects(
    () => aplicarInterpretacaoCondicional(cliente, entrada),
    (erro: unknown) => {
      assert.ok(erro instanceof EntradaInvalidaError);
      if (valorInvalido !== '') {
        assert.ok(!erro.message.includes(valorInvalido), 'mensagem de erro nao deve conter o valor invalido');
      }
      return true;
    }
  );
  assert.equal(cliente.chamadas.length, 0, 'entrada invalida nao deve chamar o cliente Supabase');
}

test('teste15: mensagem_recebida_id com UUID invalido e rejeitado antes do Supabase', async () => {
  await esperarRejeicaoSemChamada({ ...ENTRADA, mensagem_recebida_id: 'nao-e-um-uuid' }, 'nao-e-um-uuid');
});

test('teste16: clinica_id com UUID invalido e rejeitado antes do Supabase', async () => {
  await esperarRejeicaoSemChamada({ ...ENTRADA, clinica_id: 'nao-e-um-uuid' }, 'nao-e-um-uuid');
});

test('teste17: telefone_normalizado invalido e rejeitado antes do Supabase', async () => {
  await esperarRejeicaoSemChamada({ ...ENTRADA, telefone_normalizado: '11999999999' }, '11999999999');
});

test('teste18: claim_token com UUID invalido e rejeitado antes do Supabase', async () => {
  await esperarRejeicaoSemChamada({ ...ENTRADA, claim_token: 'nao-e-um-uuid' }, 'nao-e-um-uuid');
});

test('teste19: conversa_id com UUID invalido e rejeitado antes do Supabase', async () => {
  await esperarRejeicaoSemChamada({ ...ENTRADA, conversa_id: 'nao-e-um-uuid' }, 'nao-e-um-uuid');
});

test('teste20: snapshot_atualizado_em invalido e rejeitado antes do Supabase', async () => {
  await esperarRejeicaoSemChamada({ ...ENTRADA, snapshot_atualizado_em: 'ontem' }, 'ontem');
});

test('teste21: alteracoes_aplicaveis como array e rejeitado antes do Supabase', async () => {
  await esperarRejeicaoSemChamada({ ...ENTRADA, alteracoes_aplicaveis: [] } as never, '');
});
