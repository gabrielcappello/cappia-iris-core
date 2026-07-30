// Testes de unidade de reivindicar-mensagem.ts usando o dublê ClienteRpcFalso
// (nenhum acesso a rede ou banco real — respostas de RPC sinteticas em memoria).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reivindicarMensagem } from './reivindicar-mensagem.ts';
import { ErroRpcTecnico } from './erros.ts';
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
  const claimToken = crypto.randomUUID();
  const leaseExpiraEm = new Date().toISOString();
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: {
      data: [
        {
          resultado: 'reivindicada_interpretar',
          mensagem_recebida_id: 'msg-1',
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
  assert.equal(resultado.mensagem_recebida_id, 'msg-1');
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
          mensagem_recebida_id: 'msg-2',
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

test('teste3: nao_elegivel retorna claim_token e demais campos de reivindicacao nulos', async () => {
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

test('teste4: nao_elegivel com claim_token preenchido e rejeitado (payload nao confiavel)', async () => {
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: {
      data: [
        {
          resultado: 'nao_elegivel',
          mensagem_recebida_id: null,
          claim_token: crypto.randomUUID(),
          lease_expira_em: null,
          interpretacao_persistida_em: null,
        },
      ],
      error: null,
    },
  });

  await assert.rejects(() => reivindicarMensagem(cliente, ENTRADA), ErroRpcTecnico);
});

for (const campoAusente of ['claim_token', 'mensagem_recebida_id', 'lease_expira_em'] as const) {
  test(`teste5: reivindicada_interpretar sem ${campoAusente} e rejeitado`, async () => {
    const linha: Record<string, unknown> = {
      resultado: 'reivindicada_interpretar',
      mensagem_recebida_id: 'msg-1',
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

test('teste10: retorno como objeto unico (nao array) tambem e aceito', async () => {
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: {
      data: { resultado: 'nao_elegivel', mensagem_recebida_id: null, claim_token: null, lease_expira_em: null, interpretacao_persistida_em: null },
      error: null,
    },
  });

  const resultado = await reivindicarMensagem(cliente, ENTRADA);
  assert.equal(resultado.resultado, 'nao_elegivel');
});

test('teste11: erro tecnico reportado pelo cliente e propagado como ErroRpcTecnico', async () => {
  const cliente = new ClienteRpcFalso({
    reivindicar_mensagem: { data: null, error: { message: 'conexao interrompida' } },
  });

  await assert.rejects(() => reivindicarMensagem(cliente, ENTRADA), ErroRpcTecnico);
  assert.equal(cliente.chamadas.length, 1);
});

test('teste12: mensagens de erro nunca incluem claim_token ou telefone usados no teste', async () => {
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
