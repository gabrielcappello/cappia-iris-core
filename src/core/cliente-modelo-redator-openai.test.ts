// Testes do cliente da IA REDATORA -- a que escreve a mensagem ao paciente.
//
// ── POR QUE ESTE ARQUIVO EXISTE (2026-08-17) ────────────────────────────
// Este cliente nao tinha NENHUM teste. O corpo HTTP enviado ao modelo e
// montado campo a campo, a mao -- e essa e uma classe de falha ja conhecida
// neste projeto: em 2026-08-08 `historico_recente` existia no contrato, era
// preenchido, e NUNCA chegava ao corpo. A IA nunca o recebeu, e nada
// acusava, porque "estava implementado".
//
// A interpretadora ganhou uma guarda de fronteira depois daquele caso, e ela
// pegou exatamente o mesmo erro em 2026-08-17 (`agendamentos_do_paciente`
// preparado e nao enviado). A redatora seguia sem equivalente -- e no mesmo
// dia ela recebeu TRES campos novos (`cadastro_conhecido`,
// `dentista_dos_horarios`/`dentista_confirmado`, `data_hoje`), verificados
// so a mao.
//
// A GUARDA GERAL abaixo fecha isso: todo campo opcional de `EntradaRedator`
// precisa aparecer no corpo HTTP. Um campo novo que alguem esqueca de copiar
// falha aqui, antes do deploy.
//
// Nada aqui toca rede: `fetch` e injetado.

import test from 'node:test';
import assert from 'node:assert/strict';

import { criarClienteModeloRedatorOpenAI } from './cliente-modelo-redator-openai.ts';
import type { EntradaRedator } from './cliente-modelo-redator-openai.ts';
import type { FatosAutorizados } from './fatos-autorizados.ts';

const CONFIG_BASE = { chaveApi: 'chave-de-teste', modelo: 'gpt-teste', timeoutMs: 5_000 };

/**
 * Envelope no formato REAL da API: o item precisa de `type: 'message'` e o
 * conteudo de `type: 'output_text'` -- e assim que `extrairTextoDaResposta`
 * navega. Um envelope aproximado passaria a impressao de sucesso e nao
 * exercitaria o caminho verdadeiro.
 */
function respostaSucesso(texto: string): Response {
  return new Response(
    JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: texto }] }] }),
    { status: 200 }
  );
}

/** Captura o corpo enviado, sem nenhuma chamada real. */
function fetchFalso(resposta: () => Response) {
  const corpos: Record<string, unknown>[] = [];
  const fn: typeof fetch = (_url, init) => {
    corpos.push(JSON.parse((init as RequestInit).body as string) as Record<string, unknown>);
    return Promise.resolve(resposta());
  };
  return { fn, corpos };
}

/** O que o modelo de fato recebe: o conteudo da mensagem `user`, ja parseado. */
function conteudoUsuario(corpo: Record<string, unknown>): Record<string, unknown> {
  const input = corpo.input as { role: string; content: string }[];
  const user = input.find((i) => i.role === 'user');
  assert.ok(user, 'corpo sem mensagem de usuario');
  return JSON.parse(user.content) as Record<string, unknown>;
}

const FATOS_EXEMPLO: FatosAutorizados = { objetivo: 'apresentar_horarios', horarios_disponiveis: ['09:00'] };

// ── A GUARDA GERAL -- o motivo deste arquivo ────────────────────────────

test('GUARDA DE FRONTEIRA: todo campo opcional de EntradaRedator chega ao corpo HTTP', async () => {
  // Entrada com TODOS os campos preenchidos. Um campo novo que nao seja
  // exercitado aqui tambem nao sera coberto -- por isso a lista abaixo, que
  // falha quando o tipo cresce e este teste nao acompanha.
  const entradaCompleta: Required<EntradaRedator> = {
    instrucoes: 'instrucoes de teste',
    mensagemPaciente: 'quero marcar',
    naturezaMensagem: 'pedido',
    fatos: FATOS_EXEMPLO,
    nomeClinica: 'Clinica Teste',
    historicoRecente: [
      { mensagem_paciente: 'oi', resposta_iris: 'ola', gerada_em: '2026-08-17T12:00:00.000Z' },
    ],
    dataHoje: '2026-08-17',
  };

  const { fn, corpos } = fetchFalso(() => respostaSucesso('texto'));
  const cliente = criarClienteModeloRedatorOpenAI({ ...CONFIG_BASE, fetch: fn });
  await cliente.redigir(entradaCompleta);

  const enviado = conteudoUsuario(corpos[0]);

  // Mapeamento entre o campo do tipo e a chave enviada ao modelo. Quando um
  // campo novo entrar em `EntradaRedator`, acrescente-o aqui -- e se ele nao
  // estiver sendo copiado no cliente, este teste falha.
  const CAMPOS_ESPERADOS: Record<keyof EntradaRedator, string | null> = {
    // `instrucoes` vai na mensagem `system`, nao no conteudo do usuario.
    instrucoes: null,
    mensagemPaciente: 'mensagem_paciente',
    naturezaMensagem: 'natureza_mensagem',
    fatos: 'fatos_autorizados',
    nomeClinica: 'nome_clinica',
    historicoRecente: 'historico_recente',
    dataHoje: 'data_hoje',
  };

  for (const [campo, chave] of Object.entries(CAMPOS_ESPERADOS)) {
    if (chave === null) continue;
    assert.ok(
      chave in enviado,
      `o campo "${campo}" existe em EntradaRedator mas a chave "${chave}" NAO chegou ao corpo HTTP -- ` +
        'o corpo e montado campo a campo em cliente-modelo-redator-openai.ts e essa chave foi esquecida la'
    );
  }

  // A guarda da guarda: se o tipo ganhar um campo e ninguem o mapear acima,
  // falha aqui -- mesma disciplina da interpretadora.
  for (const campo of Object.keys(entradaCompleta)) {
    assert.ok(
      campo in CAMPOS_ESPERADOS,
      `o campo "${campo}" existe em EntradaRedator mas nao esta em CAMPOS_ESPERADOS -- ` +
        'adicione-o, senao a guarda nao o cobre'
    );
  }
});

test('as instrucoes vao na mensagem system, separadas do conteudo do usuario', async () => {
  const { fn, corpos } = fetchFalso(() => respostaSucesso('texto'));
  const cliente = criarClienteModeloRedatorOpenAI({ ...CONFIG_BASE, fetch: fn });
  await cliente.redigir({
    instrucoes: 'REGRAS DA IRIS',
    mensagemPaciente: 'oi',
    naturezaMensagem: 'saudacao',
    fatos: FATOS_EXEMPLO,
  });

  const input = corpos[0].input as { role: string; content: string }[];
  assert.equal(input[0].role, 'system');
  assert.equal(input[0].content, 'REGRAS DA IRIS');
});

test('campos ausentes NAO viram chave nula no corpo -- simplesmente nao vao', async () => {
  const { fn, corpos } = fetchFalso(() => respostaSucesso('texto'));
  const cliente = criarClienteModeloRedatorOpenAI({ ...CONFIG_BASE, fetch: fn });
  await cliente.redigir({
    instrucoes: 'x',
    mensagemPaciente: 'oi',
    naturezaMensagem: 'saudacao',
    fatos: FATOS_EXEMPLO,
  });

  const enviado = conteudoUsuario(corpos[0]);
  for (const chave of ['historico_recente', 'nome_clinica', 'data_hoje']) {
    assert.equal(chave in enviado, false, `"${chave}" nao deveria estar no corpo quando ausente`);
  }
});

// ── Nunca pede ferramenta nem schema ────────────────────────────────────

test('o corpo NUNCA carrega tools nem schema de saida -- a redatora devolve texto livre', async () => {
  const { fn, corpos } = fetchFalso(() => respostaSucesso('texto'));
  const cliente = criarClienteModeloRedatorOpenAI({ ...CONFIG_BASE, fetch: fn });
  await cliente.redigir({
    instrucoes: 'x',
    mensagemPaciente: 'oi',
    naturezaMensagem: 'saudacao',
    fatos: FATOS_EXEMPLO,
  });

  assert.equal('tools' in corpos[0], false, 'a redatora nunca chama ferramenta');
  assert.equal('text' in corpos[0], false, 'a redatora devolve texto livre, sem schema');
  assert.equal(corpos[0].store, false, 'a conversa nunca fica armazenada no provedor');
});

// O esforco de raciocinio precisa ser DECLARADO, nunca deixado ao padrao da
// API: omitir a chave nao e neutro -- a API aplica `medium`, e a Luna gasta
// esse raciocinio DENTRO dos 300 tokens da resposta. Medido em 2026-08-30
// (src/eval/matriz-esforco-redatora.ts): `medium` gastava 41 tokens de
// raciocinio por chamada para produzir os MESMOS ~36 tokens visiveis.
test('o corpo declara reasoning.effort explicitamente, e o limite de saida segue 300', async () => {
  const { fn, corpos } = fetchFalso(() => respostaSucesso('texto'));
  const cliente = criarClienteModeloRedatorOpenAI({ ...CONFIG_BASE, fetch: fn });
  await cliente.redigir({
    instrucoes: 'x',
    mensagemPaciente: 'oi',
    naturezaMensagem: 'saudacao',
    fatos: FATOS_EXEMPLO,
  });

  assert.deepEqual(
    corpos[0].reasoning,
    { effort: 'none' },
    'sem esta chave a API aplica `medium` por padrao -- o esforco tem que ser uma escolha explicita, nunca um default herdado'
  );
  assert.equal(corpos[0].max_output_tokens, 300, 'a decisao foi baixar o consumo, nao elevar o teto');
});

// ── Falhas viram erro proprio, nunca texto para o paciente ──────────────

test('HTTP nao-ok vira erro proprio', async () => {
  const { fn } = fetchFalso(() => new Response('falhou', { status: 500 }));
  const cliente = criarClienteModeloRedatorOpenAI({ ...CONFIG_BASE, fetch: fn });
  await assert.rejects(
    cliente.redigir({ instrucoes: 'x', mensagemPaciente: 'oi', naturezaMensagem: 'saudacao', fatos: FATOS_EXEMPLO }),
    /erro_http_500/
  );
});

test('resposta vazia vira erro proprio -- nunca uma mensagem em branco ao paciente', async () => {
  const { fn } = fetchFalso(() => respostaSucesso('   '));
  const cliente = criarClienteModeloRedatorOpenAI({ ...CONFIG_BASE, fetch: fn });
  await assert.rejects(
    cliente.redigir({ instrucoes: 'x', mensagemPaciente: 'oi', naturezaMensagem: 'saudacao', fatos: FATOS_EXEMPLO }),
    /resposta_vazia/
  );
});

test('corpo que nao e JSON valido vira erro proprio', async () => {
  const { fn } = fetchFalso(() => new Response('{quebrado', { status: 200 }));
  const cliente = criarClienteModeloRedatorOpenAI({ ...CONFIG_BASE, fetch: fn });
  await assert.rejects(
    cliente.redigir({ instrucoes: 'x', mensagemPaciente: 'oi', naturezaMensagem: 'saudacao', fatos: FATOS_EXEMPLO }),
    /corpo_nao_e_json_valido/
  );
});

// ── Configuracao invalida falha na criacao, nunca no meio do turno ──────

test('configuracao invalida falha ao criar o cliente', () => {
  assert.throws(() => criarClienteModeloRedatorOpenAI({ ...CONFIG_BASE, chaveApi: '' }), /chave_api/);
  assert.throws(() => criarClienteModeloRedatorOpenAI({ ...CONFIG_BASE, modelo: '  ' }), /modelo/);
  assert.throws(() => criarClienteModeloRedatorOpenAI({ ...CONFIG_BASE, timeoutMs: 0 }), /timeout/);
});
