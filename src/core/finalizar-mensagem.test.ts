// Testes de unidade de finalizar-mensagem.ts usando o dublê ClienteFalso
// (nenhum acesso a rede ou banco real — dados sinteticos apenas em memoria).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { concluirMensagemCondicional, falharMensagemCondicional } from './finalizar-mensagem.ts';
import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import type { ClienteBancoDados, ConsultaEncadeavel } from './tipos.ts';
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

// Dublê minimo que faz .update(...) retornar um erro fabricado, para testar
// sanitizacao -- ClienteFalso nao simula erro de UPDATE nativamente.
function clienteComErroDeUpdate(mensagemErro: string): ClienteBancoDados {
  const consultaComErro: ConsultaEncadeavel = {
    eq: () => consultaComErro,
    is: () => consultaComErro,
    not: () => consultaComErro,
    select: () => consultaComErro,
    maybeSingle: async () => ({ data: null, error: { message: mensagemErro } }),
  };
  return {
    from: () => ({
      select: () => consultaComErro,
      upsert: () => consultaComErro,
      update: () => consultaComErro,
    }),
  };
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
  assert.equal(tabelas.mensagens_recebidas[0].concluido_em, null, 'zero linhas afetadas nao deve preencher concluido_em');
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
  assert.equal(tabelas.mensagens_recebidas[0].concluido_em, null, 'zero linhas afetadas nao deve preencher concluido_em');
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

// --- teste15: validacao minima da entrada (claim), antes de qualquer UPDATE ---

const CAMPOS_CLAIM = ['mensagem_recebida_id', 'clinica_id', 'claim_token'] as const;

for (const campo of CAMPOS_CLAIM) {
  test(`teste15: concluirMensagemCondicional com ${campo} invalido e rejeitado antes do Supabase`, async () => {
    const tabelas = criarTabelasFalsasVazias();
    const { claim } = semearMensagem(tabelas);
    const cliente = new ClienteFalso(tabelas);
    const claimInvalido = { ...claim, [campo]: 'nao-e-um-uuid' };

    await assert.rejects(
      () => concluirMensagemCondicional(cliente, claimInvalido),
      (erro: unknown) => {
        assert.ok(erro instanceof EntradaInvalidaError);
        assert.ok(!erro.message.includes('nao-e-um-uuid'), 'mensagem de erro nao deve conter o valor invalido');
        return true;
      }
    );
    assert.equal(cliente.estatisticas.chamadasUpdate['mensagens_recebidas'] ?? 0, 0, 'entrada invalida nao deve chamar o Supabase');
    assert.equal(tabelas.mensagens_recebidas[0].status_processamento, 'processando', 'linha nao deve ser alterada');
  });

  test(`teste15: falharMensagemCondicional com ${campo} invalido e rejeitado antes do Supabase`, async () => {
    const tabelas = criarTabelasFalsasVazias();
    const { claim } = semearMensagem(tabelas, { interpretacao_persistida_em: null });
    const cliente = new ClienteFalso(tabelas);
    const claimInvalido = { ...claim, [campo]: 'nao-e-um-uuid' };

    await assert.rejects(
      () => falharMensagemCondicional(cliente, claimInvalido),
      (erro: unknown) => {
        assert.ok(erro instanceof EntradaInvalidaError);
        assert.ok(!erro.message.includes('nao-e-um-uuid'), 'mensagem de erro nao deve conter o valor invalido');
        return true;
      }
    );
    assert.equal(cliente.estatisticas.chamadasUpdate['mensagens_recebidas'] ?? 0, 0, 'entrada invalida nao deve chamar o Supabase');
  });
}

// --- teste16: sanitizacao -- error.message do cliente Supabase nunca vaza ---

test('teste16: concluirMensagemCondicional -- error.message do cliente contendo telefone/CPF/claim_token/SQL nunca aparece no erro propagado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas);
  const claimTokenSensivel = claim.claim_token;
  const mensagemSensivel = [
    'telefone=5511999999999',
    'cpf=11122233344',
    `claim_token=${claimTokenSensivel}`,
    "update mensagens_recebidas set status_processamento = 'concluida' where id = '123'",
  ].join(' ');
  const cliente = clienteComErroDeUpdate(mensagemSensivel);

  await assert.rejects(
    () => concluirMensagemCondicional(cliente, claim),
    (erro: unknown) => {
      assert.ok(erro instanceof ErroRpcTecnico);
      assert.equal(erro.rpc, 'concluir_mensagem_condicional');
      const serializado = JSON.stringify(erro);
      for (const trecho of ['5511999999999', '11122233344', claimTokenSensivel, 'update mensagens_recebidas']) {
        assert.ok(!erro.message.includes(trecho), `erro.message nao deve conter: ${trecho}`);
        assert.ok(!erro.stack?.includes(trecho), `stack nao deve conter: ${trecho}`);
        assert.ok(!serializado?.includes(trecho), `JSON.stringify nao deve conter: ${trecho}`);
      }
      assert.ok(erro.message.includes('cliente_supabase_falhou'), 'motivo deve ser o codigo tecnico fixo');
      return true;
    }
  );
});

test('teste16: falharMensagemCondicional -- error.message do cliente contendo telefone/CPF/claim_token/SQL nunca aparece no erro propagado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas, { interpretacao_persistida_em: null });
  const claimTokenSensivel = claim.claim_token;
  const mensagemSensivel = [
    'telefone=5511999999999',
    'cpf=11122233344',
    `claim_token=${claimTokenSensivel}`,
    "update mensagens_recebidas set status_processamento = 'falhou' where id = '123'",
  ].join(' ');
  const cliente = clienteComErroDeUpdate(mensagemSensivel);

  await assert.rejects(
    () => falharMensagemCondicional(cliente, claim),
    (erro: unknown) => {
      assert.ok(erro instanceof ErroRpcTecnico);
      assert.equal(erro.rpc, 'falhar_mensagem_condicional');
      const serializado = JSON.stringify(erro);
      for (const trecho of ['5511999999999', '11122233344', claimTokenSensivel, 'update mensagens_recebidas']) {
        assert.ok(!erro.message.includes(trecho), `erro.message nao deve conter: ${trecho}`);
        assert.ok(!erro.stack?.includes(trecho), `stack nao deve conter: ${trecho}`);
        assert.ok(!serializado?.includes(trecho), `JSON.stringify nao deve conter: ${trecho}`);
      }
      assert.ok(erro.message.includes('cliente_supabase_falhou'), 'motivo deve ser o codigo tecnico fixo');
      return true;
    }
  );
});

// --- teste17: timestamp terminal concluido_em (decisao aprovada, tarefa 0036) ---

test('teste17: concluido_em e uma string ISO UTC valida, gerada no momento da chamada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas);
  const cliente = new ClienteFalso(tabelas);

  const antes = Date.now();
  await concluirMensagemCondicional(cliente, claim);
  const depois = Date.now();

  const concluidoEm = tabelas.mensagens_recebidas[0].concluido_em as string;
  assert.match(concluidoEm, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'concluido_em deve ser ISO 8601 em UTC (sufixo Z)');
  const concluidoEmMs = new Date(concluidoEm).getTime();
  assert.ok(concluidoEmMs >= antes && concluidoEmMs <= depois, 'concluido_em deve refletir o momento da chamada');
});

test('teste17: falharMensagemCondicional -- concluido_em e uma string ISO UTC valida, gerada no momento da chamada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas, { interpretacao_persistida_em: null });
  const cliente = new ClienteFalso(tabelas);

  const antes = Date.now();
  await falharMensagemCondicional(cliente, claim);
  const depois = Date.now();

  const concluidoEm = tabelas.mensagens_recebidas[0].concluido_em as string;
  assert.match(concluidoEm, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'concluido_em deve ser ISO 8601 em UTC (sufixo Z)');
  const concluidoEmMs = new Date(concluidoEm).getTime();
  assert.ok(concluidoEmMs >= antes && concluidoEmMs <= depois, 'concluido_em deve refletir o momento da chamada');
});

test('teste18: concluido_em nunca e recebido como entrada -- sempre calculado internamente pelo runtime servidor', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { claim } = semearMensagem(tabelas);
  const cliente = new ClienteFalso(tabelas);

  // ClaimMensagem nao tem campo concluido_em (nao compila passar um valor
  // real); o cast `as ClaimMensagem` simula defensivamente uma tentativa de
  // burlar isso em runtime (ex.: objeto vindo de fora do TypeScript).
  const claimComTimestampForjado = { ...claim, concluido_em: '1999-01-01T00:00:00.000Z' } as ClaimMensagem;
  await concluirMensagemCondicional(cliente, claimComTimestampForjado);

  const concluidoEm = tabelas.mensagens_recebidas[0].concluido_em as string;
  assert.notEqual(concluidoEm, '1999-01-01T00:00:00.000Z', 'concluido_em nao deve aceitar um valor forjado vindo da entrada');
});
