// Testes de unidade de finalizar-mensagem.ts usando o dublê ClienteFalso
// (nenhum acesso a rede ou banco real — dados sinteticos apenas em memoria).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { concluirMensagemCondicional, falharMensagemCondicional } from './finalizar-mensagem.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import type { ClaimMensagem } from './mensagens-recebidas-tipos.ts';

const CLINICA_ID = crypto.randomUUID();

// `marcadorPreenchido` decide entre o estado exigido por
// concluirMensagemCondicional (marcador preenchido) e por
// falharMensagemCondicional (marcador null) — por padrao semeia uma linha
// valida para concluir; os testes de falha sobrescrevem via `overrides`.
function semearMensagem(
  tabelas: TabelasFalsas,
  overrides: Record<string, unknown> = {}
): { linha: Record<string, unknown>; claim: ClaimMensagem } {
  const claimToken = crypto.randomUUID();
  const linha = {
    id: crypto.randomUUID(),
    clinica_id: CLINICA_ID,
    provider: 'evolution',
    instancia_whatsapp: 'CAPPIA',
    message_id: 'wamid.1',
    telefone_normalizado: '5511999999999',
    status_processamento: 'processando',
    claim_token: claimToken,
    lease_expira_em: new Date(Date.now() + 60_000).toISOString(),
    interpretacao_persistida_em: new Date().toISOString(),
    concluido_em: null,
    ...overrides,
  };
  tabelas.mensagens_recebidas.push(linha);
  return { linha, claim: { mensagem_recebida_id: linha.id, clinica_id: linha.clinica_id, claim_token: claimToken } };
}

// --- concluirMensagemCondicional ---

test('teste1: concluirMensagemCondicional com todas as condicoes atendidas retorna concluida e atualiza status/concluido_em', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await concluirMensagemCondicional(cliente, claim);

  assert.equal(resultado, 'concluida');
  assert.equal(tabelas.mensagens_recebidas[0].status_processamento, 'concluida');
  assert.ok(tabelas.mensagens_recebidas[0].concluido_em, 'concluido_em deve ser preenchido');
});

test('teste2: concluirMensagemCondicional com id inexistente nao altera nada e retorna autorizacao_invalida', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearMensagem(tabelas);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await concluirMensagemCondicional(cliente, {
    mensagem_recebida_id: crypto.randomUUID(),
    clinica_id: CLINICA_ID,
    claim_token: crypto.randomUUID(),
  });

  assert.equal(resultado, 'autorizacao_invalida');
  assert.equal(tabelas.mensagens_recebidas[0].status_processamento, 'processando');
});

test('teste3: concluirMensagemCondicional com clinica_id incompativel retorna autorizacao_invalida sem alterar a linha', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await concluirMensagemCondicional(cliente, { ...claim, clinica_id: crypto.randomUUID() });

  assert.equal(resultado, 'autorizacao_invalida');
  assert.equal(tabelas.mensagens_recebidas[0].status_processamento, 'processando');
});

test('teste4: concluirMensagemCondicional com status_processamento diferente de processando retorna autorizacao_invalida', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas, { status_processamento: 'recebida' });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await concluirMensagemCondicional(cliente, claim);

  assert.equal(resultado, 'autorizacao_invalida');
  assert.equal(tabelas.mensagens_recebidas[0].status_processamento, 'recebida');
});

test('teste5: concluirMensagemCondicional com claim_token incompativel retorna autorizacao_invalida', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await concluirMensagemCondicional(cliente, { ...claim, claim_token: crypto.randomUUID() });

  assert.equal(resultado, 'autorizacao_invalida');
  assert.equal(tabelas.mensagens_recebidas[0].status_processamento, 'processando');
});

test('teste6: concluirMensagemCondicional com marcador nao preenchido retorna autorizacao_invalida', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas, { interpretacao_persistida_em: null });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await concluirMensagemCondicional(cliente, claim);

  assert.equal(resultado, 'autorizacao_invalida');
  assert.equal(tabelas.mensagens_recebidas[0].status_processamento, 'processando');
});

test('teste7: concluirMensagemCondicional nao exige lease vigente (lease expirado ainda conclui)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas, { lease_expira_em: new Date(Date.now() - 60_000).toISOString() });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await concluirMensagemCondicional(cliente, claim);

  assert.equal(resultado, 'concluida');
});

// --- falharMensagemCondicional ---

test('teste8: falharMensagemCondicional com todas as condicoes atendidas retorna falhou e atualiza status/concluido_em', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas, { interpretacao_persistida_em: null });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await falharMensagemCondicional(cliente, claim);

  assert.equal(resultado, 'falhou');
  assert.equal(tabelas.mensagens_recebidas[0].status_processamento, 'falhou');
  assert.ok(tabelas.mensagens_recebidas[0].concluido_em, 'concluido_em deve ser preenchido');
});

test('teste9: falharMensagemCondicional com id inexistente nao altera nada e retorna autorizacao_invalida', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearMensagem(tabelas, { interpretacao_persistida_em: null });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await falharMensagemCondicional(cliente, {
    mensagem_recebida_id: crypto.randomUUID(),
    clinica_id: CLINICA_ID,
    claim_token: crypto.randomUUID(),
  });

  assert.equal(resultado, 'autorizacao_invalida');
  assert.equal(tabelas.mensagens_recebidas[0].status_processamento, 'processando');
});

test('teste10: falharMensagemCondicional com clinica_id incompativel retorna autorizacao_invalida sem alterar a linha', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas, { interpretacao_persistida_em: null });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await falharMensagemCondicional(cliente, { ...claim, clinica_id: crypto.randomUUID() });

  assert.equal(resultado, 'autorizacao_invalida');
  assert.equal(tabelas.mensagens_recebidas[0].status_processamento, 'processando');
});

test('teste11: falharMensagemCondicional com status_processamento diferente de processando retorna autorizacao_invalida', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas, { status_processamento: 'concluida', interpretacao_persistida_em: null });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await falharMensagemCondicional(cliente, claim);

  assert.equal(resultado, 'autorizacao_invalida');
  assert.equal(tabelas.mensagens_recebidas[0].status_processamento, 'concluida');
});

test('teste12: falharMensagemCondicional com claim_token incompativel retorna autorizacao_invalida', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas, { interpretacao_persistida_em: null });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await falharMensagemCondicional(cliente, { ...claim, claim_token: crypto.randomUUID() });

  assert.equal(resultado, 'autorizacao_invalida');
  assert.equal(tabelas.mensagens_recebidas[0].status_processamento, 'processando');
});

test('teste13: falharMensagemCondicional com marcador ja preenchido retorna autorizacao_invalida (oposto de concluir)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas); // marcador preenchido por padrao
  const cliente = new ClienteFalso(tabelas);

  const resultado = await falharMensagemCondicional(cliente, claim);

  assert.equal(resultado, 'autorizacao_invalida');
  assert.equal(tabelas.mensagens_recebidas[0].status_processamento, 'processando');
});

test('teste14: falharMensagemCondicional nao exige lease vigente (lease expirado ainda marca falha)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas, {
    interpretacao_persistida_em: null,
    lease_expira_em: new Date(Date.now() - 60_000).toISOString(),
  });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await falharMensagemCondicional(cliente, claim);

  assert.equal(resultado, 'falhou');
});
