// Testes de unidade de reivindicar-mensagem.ts usando o dublê ClienteRpcFalso
// (nenhum acesso a rede ou banco real — respostas de RPC sinteticas em memoria).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reivindicarMensagem } from './reivindicar-mensagem.ts';
import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import type { ReivindicarMensagemEntrada } from './mensagens-recebidas-tipos.ts';

const ENTRADA: ReivindicarMensagemEntrada = {
  provider: 'evolution',
  instancia_whatsapp: 'CAPPIA',
  message_id: 'wamid.123',
  clinica_id: crypto.randomUUID(),
  telefone_normalizado: '5511999999999',
};

test('teste1: reivindicada_interpretar mapeia todos os campos e envia os parametros p_* corretos', async () => {
  const mensagemRecebidaId = crypto.randomUUID();
  const claimToken = crypto.randomUUID();
  const leaseExpiraEm = new Date().toISOString();
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: {
      data: [
        {
          resultado: 'reivindicada_interpretar',
          mensagem_recebida_id: mensagemRecebidaId,
          claim_token: claimToken,
          lease_expira_em: leaseExpiraEm,
          interpretacao_persistida_em: null,
        },
      ],
      error: null,
    },
  });

  const resultado = await reivindicarMensagem(cliente, ENTRADA);

  assert.equal(resultado.resultado, 'reivindicada_interpretar');
  assert.equal(resultado.mensagem_recebida_id, mensagemRecebidaId);
  assert.equal(resultado.claim_token, claimToken);
  assert.equal(resultado.lease_expira_em, leaseExpiraEm);
  assert.equal(resultado.interpretacao_persistida_em, null);
  assert.equal(cliente.chamadas.length, 1);
  assert.deepEqual(cliente.chamadas[0].parametros, {
    p_provider: ENTRADA.provider,
    p_instancia_whatsapp: ENTRADA.instancia_whatsapp,
    p_message_id: ENTRADA.message_id,
    p_clinica_id: ENTRADA.clinica_id,
    p_telefone_normalizado: ENTRADA.telefone_normalizado,
  });
});

test('teste2: reivindicada_resposta_fixa mapeia o marcador ja preenchido', async () => {
  const claimToken = crypto.randomUUID();
  const leaseExpiraEm = new Date().toISOString();
  const marcador = new Date().toISOString();
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: {
      data: [
        {
          resultado: 'reivindicada_resposta_fixa',
          mensagem_recebida_id: crypto.randomUUID(),
          claim_token: claimToken,
          lease_expira_em: leaseExpiraEm,
          interpretacao_persistida_em: marcador,
        },
      ],
      error: null,
    },
  });

  const resultado = await reivindicarMensagem(cliente, ENTRADA);

  assert.equal(resultado.resultado, 'reivindicada_resposta_fixa');
  assert.equal(resultado.interpretacao_persistida_em, marcador);
});

test('teste3: nao_elegivel retorna todos os campos de reivindicacao nulos', async () => {
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: {
      data: [
        {
          resultado: 'nao_elegivel',
          mensagem_recebida_id: null,
          claim_token: null,
          lease_expira_em: null,
          interpretacao_persistida_em: null,
        },
      ],
      error: null,
    },
  });

  const resultado = await reivindicarMensagem(cliente, ENTRADA);

  assert.equal(resultado.resultado, 'nao_elegivel');
  assert.equal(resultado.claim_token, null);
  assert.equal(resultado.mensagem_recebida_id, null);
  assert.equal(resultado.lease_expira_em, null);
});

// --- teste4: nao_elegivel deve rejeitar cada campo individualmente preenchido ---

const NAO_ELEGIVEL_BASE = {
  resultado: 'nao_elegivel',
  mensagem_recebida_id: null,
  claim_token: null,
  lease_expira_em: null,
  interpretacao_persistida_em: null,
} as const;

for (const campoPreenchido of ['mensagem_recebida_id', 'claim_token', 'lease_expira_em', 'interpretacao_persistida_em'] as const) {
  test(`teste4: nao_elegivel com ${campoPreenchido} preenchido e rejeitado (payload nao confiavel)`, async () => {
    const valorPreenchido =
      campoPreenchido === 'mensagem_recebida_id' || campoPreenchido === 'claim_token'
        ? crypto.randomUUID()
        : new Date().toISOString();
    const linha = { ...NAO_ELEGIVEL_BASE, [campoPreenchido]: valorPreenchido };
    const cliente = new ClienteRpcFalso({ reivindicar_mensagem: { data: [linha], error: null } });

    await assert.rejects(() => reivindicarMensagem(cliente, ENTRADA), ErroRpcTecnico);
  });
}

for (const campoAusente of ['claim_token', 'mensagem_recebida_id', 'lease_expira_em'] as const) {
  test(`teste5: reivindicada_interpretar sem ${campoAusente} e rejeitado`, async () => {
    const linha: Record<string, unknown> = {
      resultado: 'reivindicada_interpretar',
      mensagem_recebida_id: crypto.randomUUID(),
      claim_token: crypto.randomUUID(),
      lease_expira_em: new Date().toISOString(),
      interpretacao_persistida_em: null,
    };
    linha[campoAusente] = null;
    const cliente = new ClienteRpcFalso({ reivindicar_mensagem: { data: [linha], error: null } });

    await assert.rejects(() => reivindicarMensagem(cliente, ENTRADA), ErroRpcTecnico);
  });
}

test('teste6: resultado fora do vocabulario aprovado e rejeitado', async () => {
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: {
      data: [{ resultado: 'reivindicada_para_sempre', mensagem_recebida_id: null, claim_token: null, lease_expira_em: null, interpretacao_persistida_em: null }],
      error: null,
    },
  });

  await assert.rejects(() => reivindicarMensagem(cliente, ENTRADA), ErroRpcTecnico);
});

test('teste7: campo resultado ausente e rejeitado', async () => {
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: { data: [{ mensagem_recebida_id: null, claim_token: null, lease_expira_em: null, interpretacao_persistida_em: null }], error: null },
  });

  await assert.rejects(() => reivindicarMensagem(cliente, ENTRADA), ErroRpcTecnico);
});

test('teste8: array vazio e rejeitado', async () => {
  const cliente = new ClienteRpcFalso({ reivindicar_mensagem: { data: [], error: null } });

  await assert.rejects(() => reivindicarMensagem(cliente, ENTRADA), ErroRpcTecnico);
});

test('teste9: array com mais de uma linha e rejeitado', async () => {
  const linha = {
    resultado: 'nao_elegivel',
    mensagem_recebida_id: null,
    claim_token: null,
    lease_expira_em: null,
    interpretacao_persistida_em: null,
  };
  const cliente = new ClienteRpcFalso({ reivindicar_mensagem: { data: [linha, linha], error: null } });

  await assert.rejects(() => reivindicarMensagem(cliente, ENTRADA), ErroRpcTecnico);
});

test('teste10: retorno como objeto unico (nao array) e rejeitado -- nenhuma tolerancia a formatos alternativos', async () => {
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: {
      data: { resultado: 'nao_elegivel', mensagem_recebida_id: null, claim_token: null, lease_expira_em: null, interpretacao_persistida_em: null },
      error: null,
    },
  });

  await assert.rejects(() => reivindicarMensagem(cliente, ENTRADA), ErroRpcTecnico);
});

test('teste11: erro tecnico reportado pelo cliente e propagado como ErroRpcTecnico com motivo fixo', async () => {
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: { data: null, error: { message: 'conexao interrompida' } },
  });

  await assert.rejects(
    () => reivindicarMensagem(cliente, ENTRADA),
    (erro: unknown) => {
      assert.ok(erro instanceof ErroRpcTecnico);
      assert.equal(erro.rpc, 'reivindicar_mensagem');
      assert.ok(erro.message.includes('cliente_supabase_falhou'), 'motivo deve ser o codigo tecnico fixo');
      return true;
    }
  );
  assert.equal(cliente.chamadas.length, 1);
});

// --- teste12: sanitizacao -- error.message do cliente Supabase nunca vaza ---

test('teste12: error.message do cliente contendo telefone/CPF/claim_token/SQL nunca aparece no erro propagado', async () => {
  const claimTokenSensivel = crypto.randomUUID();
  const mensagemSensivel = [
    `telefone=${ENTRADA.telefone_normalizado}`,
    'cpf=11122233344',
    `claim_token=${claimTokenSensivel}`,
    "update mensagens_recebidas set status_processamento = 'processando' where id = '123'",
  ].join(' ');
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: { data: null, error: { message: mensagemSensivel } },
  });

  await assert.rejects(
    () => reivindicarMensagem(cliente, ENTRADA),
    (erro: unknown) => {
      assert.ok(erro instanceof ErroRpcTecnico);
      const serializado = JSON.stringify(erro);
      const propriedadesPublicas = (Object.keys(erro) as (keyof ErroRpcTecnico)[]).map((chave) => String(erro[chave]));
      for (const trecho of [ENTRADA.telefone_normalizado, '11122233344', claimTokenSensivel, 'update mensagens_recebidas']) {
        assert.ok(!erro.message.includes(trecho), `erro.message nao deve conter: ${trecho}`);
        assert.ok(!erro.stack?.includes(trecho), `stack nao deve conter: ${trecho}`);
        assert.ok(!serializado?.includes(trecho), `JSON.stringify nao deve conter: ${trecho}`);
        assert.ok(!propriedadesPublicas.some((valor) => valor.includes(trecho)), `propriedades publicas nao devem conter: ${trecho}`);
      }
      return true;
    }
  );
});

test('teste13: payload de retorno com claim_token/telefone sensiveis nunca aparece no erro de coerencia', async () => {
  const claimTokenSensivel = crypto.randomUUID();
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: {
      data: [
        {
          resultado: 'nao_elegivel',
          mensagem_recebida_id: null,
          claim_token: claimTokenSensivel,
          lease_expira_em: null,
          interpretacao_persistida_em: null,
        },
      ],
      error: null,
    },
  });

  await assert.rejects(
    () => reivindicarMensagem(cliente, ENTRADA),
    (erro: unknown) => {
      assert.ok(erro instanceof ErroRpcTecnico);
      assert.ok(!erro.message.includes(claimTokenSensivel), 'mensagem de erro nao deve conter o claim_token');
      assert.ok(!erro.message.includes(ENTRADA.telefone_normalizado), 'mensagem de erro nao deve conter o telefone');
      return true;
    }
  );
});

// --- teste14: coerencia do marcador por resultado (secao 12) ---

test('teste14: reivindicada_interpretar com interpretacao_persistida_em preenchido e rejeitado', async () => {
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: {
      data: [
        {
          resultado: 'reivindicada_interpretar',
          mensagem_recebida_id: crypto.randomUUID(),
          claim_token: crypto.randomUUID(),
          lease_expira_em: new Date().toISOString(),
          interpretacao_persistida_em: new Date().toISOString(), // marcador nao deveria estar preenchido
        },
      ],
      error: null,
    },
  });

  await assert.rejects(() => reivindicarMensagem(cliente, ENTRADA), ErroRpcTecnico);
});

test('teste15: reivindicada_resposta_fixa com interpretacao_persistida_em null e rejeitado', async () => {
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: {
      data: [
        {
          resultado: 'reivindicada_resposta_fixa',
          mensagem_recebida_id: crypto.randomUUID(),
          claim_token: crypto.randomUUID(),
          lease_expira_em: new Date().toISOString(),
          interpretacao_persistida_em: null, // marcador deveria estar preenchido
        },
      ],
      error: null,
    },
  });

  await assert.rejects(() => reivindicarMensagem(cliente, ENTRADA), ErroRpcTecnico);
});

// --- teste16: validacao minima das entradas, antes de qualquer chamada ao Supabase ---

async function esperarRejeicaoSemChamada(entrada: ReivindicarMensagemEntrada, campoInvalido: string, valorInvalido: string): Promise<void> {
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: {
      data: [{ resultado: 'nao_elegivel', mensagem_recebida_id: null, claim_token: null, lease_expira_em: null, interpretacao_persistida_em: null }],
      error: null,
    },
  });

  await assert.rejects(
    () => reivindicarMensagem(cliente, entrada),
    (erro: unknown) => {
      assert.ok(erro instanceof EntradaInvalidaError);
      if (valorInvalido !== '') {
        assert.ok(!erro.message.includes(valorInvalido), `mensagem de erro nao deve conter o valor invalido de ${campoInvalido}`);
      }
      return true;
    }
  );
  assert.equal(cliente.chamadas.length, 0, 'entrada invalida nao deve chamar o cliente Supabase');
}

test('teste16: clinica_id com UUID invalido e rejeitado antes do Supabase', async () => {
  await esperarRejeicaoSemChamada({ ...ENTRADA, clinica_id: 'nao-e-um-uuid' }, 'clinica_id', 'nao-e-um-uuid');
});

test('teste17: telefone_normalizado invalido e rejeitado antes do Supabase', async () => {
  await esperarRejeicaoSemChamada({ ...ENTRADA, telefone_normalizado: '11999999999' }, 'telefone_normalizado', '11999999999');
});

test('teste18: provider vazio e rejeitado antes do Supabase', async () => {
  await esperarRejeicaoSemChamada({ ...ENTRADA, provider: '   ' }, 'provider', '   ');
});

test('teste19: message_id vazio e rejeitado antes do Supabase', async () => {
  await esperarRejeicaoSemChamada({ ...ENTRADA, message_id: '' }, 'message_id', '');
});

test('teste20: instancia_whatsapp vazio e rejeitado antes do Supabase', async () => {
  await esperarRejeicaoSemChamada({ ...ENTRADA, instancia_whatsapp: '' }, 'instancia_whatsapp', '');
});
