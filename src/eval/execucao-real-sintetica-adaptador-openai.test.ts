// Testes do runner de execucao real sintetica -- TODOS usam fetch
// inteiramente falso. Nenhuma chamada real de API ocorre neste arquivo;
// nenhuma credencial real e lida (chaveApi e sempre uma string sintetica
// obviamente falsa, nunca process.env.IRIS_EVAL_OPENAI_API_KEY).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAMPOS_ESPERADOS,
  PAYLOAD_SINTETICO_AUTORIZADO,
  criarFetchComLimiteExterno,
  executarPrincipal,
  executarUma,
  inspecionarCorpoRequisicao,
  validarConversao,
} from './execucao-real-sintetica-adaptador-openai.ts';

const PROPRIEDADES_SUCESSO_ESPERADAS = [
  'aprovado',
  'status_http',
  'modelo_ok',
  'store_false',
  'strict_true',
  'tools_ausentes',
  'conversao_ok',
  'campos',
  'invocacoes_fetch',
  'chamadas_externas',
  'segunda_chamada_bloqueada',
  'duracao_ms',
].sort();

const PROPRIEDADES_ERRO_ESPERADAS = [
  'aprovado',
  'categoria',
  'codigo',
  'status_http',
  'invocacoes_fetch',
  'chamadas_externas',
  'segunda_chamada_bloqueada',
  'duracao_ms',
].sort();

const CHAVE_FALSA = 'sk-teste-marcador-chave-XYZ789-nunca-deve-aparecer-em-lugar-nenhum';
const MARCADOR_RESPOSTA_BRUTA = 'MARCADOR_RESPOSTA_BRUTA_UNICO_XYZ123_NUNCA_DEVE_VAZAR';
const TEXTO_MENSAGEM_PAYLOAD = 'Quero agendar uma limpeza amanhã à tarde.';

function corpoEnvelopeValido(): Record<string, unknown> {
  return {
    status: 'completed',
    // campo extra e inofensivo (o adaptador so le status/output) -- usado
    // so para provar que o conteudo bruto do envelope nunca vaza na
    // evidencia, mesmo estando presente na resposta.
    __marcador_teste__: MARCADOR_RESPOSTA_BRUTA,
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              alteracoes: [
                { campo: 'intencao', acao: 'informar', valor: 'novo_agendamento' },
                { campo: 'procedimento_texto', acao: 'informar', valor: 'Limpeza' },
                { campo: 'data_texto', acao: 'informar', valor: 'Amanhã' },
                { campo: 'periodo', acao: 'informar', valor: 'TARDE' },
              ],
            }),
          },
        ],
      },
    ],
  };
}

function respostaSucessoValida(): Response {
  return new Response(JSON.stringify(corpoEnvelopeValido()), { status: 200 });
}

function respostaErroHttp(status: number): Response {
  return new Response(JSON.stringify({ error: { message: MARCADOR_RESPOSTA_BRUTA } }), { status });
}

// Fetch falso com contador PROPRIO e independente do wrapper -- usado para
// confirmar, de fora, quantas vezes a rede (falsa) foi realmente
// alcancada, sem depender da contagem que o proprio wrapper reporta.
function criarFetchFalsoComContadorReal(gerador: () => Response) {
  let chamadasReais = 0;
  const fetchFalso = (async () => {
    chamadasReais++;
    return gerador();
  }) as typeof fetch;
  return { fetchFalso, obterChamadasReais: () => chamadasReais };
}

// Fetch falso que reprova o teste se for chamado -- usado em cenarios que
// devem bloquear antes de qualquer tentativa de rede (chave ausente,
// estrutura invalida, etc.).
function criarFetchQueNuncaDeveSerChamado(): typeof fetch {
  return (async () => {
    throw new Error('fetch nao deveria ter sido chamado neste cenario');
  }) as unknown as typeof fetch;
}

// --- inspecionarCorpoRequisicao ---

function corpoValidoSerializado(): string {
  return JSON.stringify({
    model: 'gpt-4.1-mini-2025-04-14',
    store: false,
    text: { format: { type: 'json_schema', strict: true } },
    input: [
      { role: 'system', content: 'instrucoes' },
      {
        role: 'user',
        content: JSON.stringify({
          mensagens_atuais: PAYLOAD_SINTETICO_AUTORIZADO.mensagens_atuais,
          dados_atuais: PAYLOAD_SINTETICO_AUTORIZADO.dados_atuais,
        }),
      },
    ],
  });
}

test('inspecionarCorpoRequisicao: corpo valido (modelo, store, json_schema, strict, sem tools, payload autorizado) e todo aprovado', () => {
  const inspecao = inspecionarCorpoRequisicao(corpoValidoSerializado());
  assert.deepEqual(inspecao, {
    modeloOk: true,
    storeFalse: true,
    formatoJsonSchema: true,
    strictTrue: true,
    toolsAusentes: true,
    payloadAutorizado: true,
  });
});

test('inspecionarCorpoRequisicao: modelo diferente do fixado e detectado', () => {
  const corpo = JSON.parse(corpoValidoSerializado());
  corpo.model = 'gpt-4o-mini';
  const inspecao = inspecionarCorpoRequisicao(JSON.stringify(corpo));
  assert.equal(inspecao.modeloOk, false);
});

test('inspecionarCorpoRequisicao: store diferente de false e detectado', () => {
  const corpo = JSON.parse(corpoValidoSerializado());
  corpo.store = true;
  const inspecao = inspecionarCorpoRequisicao(JSON.stringify(corpo));
  assert.equal(inspecao.storeFalse, false);
});

test('inspecionarCorpoRequisicao: strict ausente ou false e detectado', () => {
  const corpo = JSON.parse(corpoValidoSerializado());
  corpo.text.format.strict = false;
  const inspecao = inspecionarCorpoRequisicao(JSON.stringify(corpo));
  assert.equal(inspecao.strictTrue, false);
});

test('inspecionarCorpoRequisicao: text.format.type diferente de json_schema e detectado', () => {
  const corpo = JSON.parse(corpoValidoSerializado());
  corpo.text.format.type = 'text';
  const inspecao = inspecionarCorpoRequisicao(JSON.stringify(corpo));
  assert.equal(inspecao.formatoJsonSchema, false);
});

test('inspecionarCorpoRequisicao: presenca de tools e detectada', () => {
  const corpo = JSON.parse(corpoValidoSerializado());
  corpo.tools = [];
  const inspecao = inspecionarCorpoRequisicao(JSON.stringify(corpo));
  assert.equal(inspecao.toolsAusentes, false);
});

test('inspecionarCorpoRequisicao: payload com propriedade extra (ex.: clinica_id) e detectado como nao autorizado', () => {
  const corpo = JSON.parse(corpoValidoSerializado());
  corpo.input[1].content = JSON.stringify({
    mensagens_atuais: PAYLOAD_SINTETICO_AUTORIZADO.mensagens_atuais,
    dados_atuais: PAYLOAD_SINTETICO_AUTORIZADO.dados_atuais,
    clinica_id: 'x',
  });
  const inspecao = inspecionarCorpoRequisicao(JSON.stringify(corpo));
  assert.equal(inspecao.payloadAutorizado, false);
});

test('inspecionarCorpoRequisicao: corpo que nao e JSON valido reprova todos os campos', () => {
  const inspecao = inspecionarCorpoRequisicao('isto nao e json {');
  assert.deepEqual(inspecao, {
    modeloOk: false,
    storeFalse: false,
    formatoJsonSchema: false,
    strictTrue: false,
    toolsAusentes: false,
    payloadAutorizado: false,
  });
});

// --- Validacao integral do array `input` (nao usa .find(); nao aceita a
// primeira ocorrencia de um role) -- cada cenario abaixo precisa reprovar
// a inspecao E bloquear o wrapper antes de qualquer chamada a rede. ---

const CONTEUDO_USER_VALIDO = JSON.stringify({
  mensagens_atuais: [...PAYLOAD_SINTETICO_AUTORIZADO.mensagens_atuais],
  dados_atuais: {},
});
const ITEM_SYSTEM_VALIDO = { role: 'system', content: 'instrucoes' };
const ITEM_USER_VALIDO = { role: 'user', content: CONTEUDO_USER_VALIDO };

function construirCorpoComInput(input: unknown): string {
  return JSON.stringify({
    model: 'gpt-4.1-mini-2025-04-14',
    store: false,
    text: { format: { type: 'json_schema', strict: true } },
    input,
  });
}

// Nota: "payload user com propriedade extra" (cenario 17 da revisao) ja e
// coberto, isoladamente, pelo teste "payload com propriedade extra (ex.:
// clinica_id)" acima -- nao duplicado aqui.
const CENARIOS_INPUT_INVALIDO: Array<{ nome: string; input: unknown }> = [
  { nome: '1: input ausente', input: undefined },
  { nome: '2: input nao e array', input: 'nao-array' },
  { nome: '3: input vazio', input: [] },
  { nome: '4: input contem somente system', input: [ITEM_SYSTEM_VALIDO] },
  { nome: '5: input contem somente user', input: [ITEM_USER_VALIDO] },
  { nome: '6: tres ou mais mensagens (extra generica apos o par valido)', input: [ITEM_SYSTEM_VALIDO, ITEM_USER_VALIDO, ITEM_SYSTEM_VALIDO] },
  { nome: '7: user autorizada seguida de outra user', input: [ITEM_SYSTEM_VALIDO, ITEM_USER_VALIDO, ITEM_USER_VALIDO] },
  { nome: '8: user autorizada seguida de assistant', input: [ITEM_SYSTEM_VALIDO, ITEM_USER_VALIDO, { role: 'assistant', content: 'x' }] },
  { nome: '9: user autorizada seguida de developer', input: [ITEM_SYSTEM_VALIDO, ITEM_USER_VALIDO, { role: 'developer', content: 'x' }] },
  { nome: '10: user autorizada seguida de role desconhecido', input: [ITEM_SYSTEM_VALIDO, ITEM_USER_VALIDO, { role: 'ferramenta_x', content: 'x' }] },
  { nome: '11: duas mensagens system', input: [ITEM_SYSTEM_VALIDO, ITEM_SYSTEM_VALIDO] },
  { nome: '12: ordem invertida (user antes de system)', input: [ITEM_USER_VALIDO, ITEM_SYSTEM_VALIDO] },
  { nome: '13: role system com content nao string', input: [{ role: 'system', content: 123 }, ITEM_USER_VALIDO] },
  { nome: '14: role user com content nao string', input: [ITEM_SYSTEM_VALIDO, { role: 'user', content: 123 }] },
  { nome: '15: propriedade extra no objeto system', input: [{ role: 'system', content: 'instrucoes', extra: 'y' }, ITEM_USER_VALIDO] },
  { nome: '16: propriedade extra no objeto user', input: [ITEM_SYSTEM_VALIDO, { role: 'user', content: CONTEUDO_USER_VALIDO, extra: 'y' }] },
  {
    nome: '18: payload user com mensagens_atuais diferente',
    input: [ITEM_SYSTEM_VALIDO, { role: 'user', content: JSON.stringify({ mensagens_atuais: ['outro texto qualquer'], dados_atuais: {} }) }],
  },
  {
    nome: '19: payload user com mais de uma mensagem',
    input: [
      ITEM_SYSTEM_VALIDO,
      { role: 'user', content: JSON.stringify({ mensagens_atuais: [...PAYLOAD_SINTETICO_AUTORIZADO.mensagens_atuais, 'outra mensagem'], dados_atuais: {} }) },
    ],
  },
  {
    nome: '20: payload user com dados_atuais nao vazio',
    input: [ITEM_SYSTEM_VALIDO, { role: 'user', content: JSON.stringify({ mensagens_atuais: [...PAYLOAD_SINTETICO_AUTORIZADO.mensagens_atuais], dados_atuais: { nome: 'x' } }) }],
  },
  { nome: '21: payload user que nao e JSON valido', input: [ITEM_SYSTEM_VALIDO, { role: 'user', content: 'isto nao e json {' }] },
];

test('inspecionarCorpoRequisicao: 20 cenarios de input invalido (sem .find(), validacao integral do array) reprovam payloadAutorizado', () => {
  for (const cenario of CENARIOS_INPUT_INVALIDO) {
    const inspecao = inspecionarCorpoRequisicao(construirCorpoComInput(cenario.input));
    assert.equal(inspecao.payloadAutorizado, false, `cenario "${cenario.nome}" deveria reprovar payloadAutorizado`);
  }
});

test('wrapper: os mesmos 20 cenarios de input invalido bloqueiam ANTES da rede (chamadasExternas=0, rede falsa nunca alcancada)', async () => {
  for (const cenario of CENARIOS_INPUT_INVALIDO) {
    const { fetchFalso, obterChamadasReais } = criarFetchFalsoComContadorReal(() => respostaSucessoValida());
    const { fetchWrapper, obterContadores } = criarFetchComLimiteExterno(fetchFalso);
    await assert.rejects(
      () => fetchWrapper('https://api.openai.com/v1/responses', { method: 'POST', body: construirCorpoComInput(cenario.input) }),
      new RegExp('.*'),
      `cenario "${cenario.nome}" deveria bloquear antes da rede`
    );
    assert.equal(obterContadores().chamadasExternas, 0, `cenario "${cenario.nome}": chamadasExternas deveria ser 0`);
    assert.equal(obterChamadasReais(), 0, `cenario "${cenario.nome}": a rede falsa nunca deveria ser alcancada`);
  }
});

test('wrapper: body ausente, undefined, nao-string ou principal invalido bloqueiam antes da rede (cenarios 22-25)', async () => {
  const casosBody: Array<{ nome: string; opcoes: RequestInit }> = [
    { nome: '22: body ausente', opcoes: { method: 'POST' } },
    { nome: '23: body undefined', opcoes: { method: 'POST', body: undefined } },
    { nome: '24a: body e um objeto (nao string)', opcoes: { method: 'POST', body: { foo: 'bar' } as unknown as BodyInit } },
    { nome: '24b: body e um Buffer (nao string)', opcoes: { method: 'POST', body: Buffer.from('x') as unknown as BodyInit } },
    { nome: '25: corpo principal nao e JSON valido', opcoes: { method: 'POST', body: 'isto nao e json {' } },
  ];

  for (const caso of casosBody) {
    const { fetchFalso, obterChamadasReais } = criarFetchFalsoComContadorReal(() => respostaSucessoValida());
    const { fetchWrapper, obterContadores } = criarFetchComLimiteExterno(fetchFalso);
    await assert.rejects(
      () => fetchWrapper('https://api.openai.com/v1/responses', caso.opcoes),
      new RegExp('.*'),
      `cenario "${caso.nome}" deveria bloquear antes da rede`
    );
    assert.equal(obterContadores().chamadasExternas, 0, `cenario "${caso.nome}": chamadasExternas deveria ser 0`);
    assert.equal(obterChamadasReais(), 0, `cenario "${caso.nome}": a rede falsa nunca deveria ser alcancada`);
  }
});

// --- validarConversao ---

test('validarConversao: exatamente os quatro campos esperados, informar, com tolerancia de espaco/caixa/acento', () => {
  const ok = validarConversao({
    alteracoes: {
      intencao: { acao: 'informar', valor: 'novo_agendamento' },
      procedimento_texto: { acao: 'informar', valor: '  Limpeza  ' },
      data_texto: { acao: 'informar', valor: 'AMANHÃ' },
      periodo: { acao: 'informar', valor: 'Tarde' },
    },
  });
  assert.equal(ok, true);
});

test('validarConversao: campo extra (ex.: nome) reprova', () => {
  const ok = validarConversao({
    alteracoes: {
      intencao: { acao: 'informar', valor: 'novo_agendamento' },
      procedimento_texto: { acao: 'informar', valor: 'limpeza' },
      data_texto: { acao: 'informar', valor: 'amanhã' },
      periodo: { acao: 'informar', valor: 'tarde' },
      nome: { acao: 'informar', valor: 'Joao' },
    },
  });
  assert.equal(ok, false);
});

test('validarConversao: campo ausente reprova', () => {
  const ok = validarConversao({
    alteracoes: {
      intencao: { acao: 'informar', valor: 'novo_agendamento' },
      procedimento_texto: { acao: 'informar', valor: 'limpeza' },
      data_texto: { acao: 'informar', valor: 'amanhã' },
    },
  });
  assert.equal(ok, false);
});

test('validarConversao: acao diferente de informar reprova', () => {
  const ok = validarConversao({
    alteracoes: {
      intencao: { acao: 'corrigir', valor: 'novo_agendamento' },
      procedimento_texto: { acao: 'informar', valor: 'limpeza' },
      data_texto: { acao: 'informar', valor: 'amanhã' },
      periodo: { acao: 'informar', valor: 'tarde' },
    },
  });
  assert.equal(ok, false);
});

test('validarConversao: valor incompativel (mesmo apos normalizacao) reprova', () => {
  const ok = validarConversao({
    alteracoes: {
      intencao: { acao: 'informar', valor: 'cancelamento' },
      procedimento_texto: { acao: 'informar', valor: 'limpeza' },
      data_texto: { acao: 'informar', valor: 'amanhã' },
      periodo: { acao: 'informar', valor: 'tarde' },
    },
  });
  assert.equal(ok, false);
});

// --- criarFetchComLimiteExterno ---

test('criarFetchComLimiteExterno: primeira invocacao alcanca a rede (falsa); contadores corretos', async () => {
  const { fetchFalso, obterChamadasReais } = criarFetchFalsoComContadorReal(() => respostaSucessoValida());
  const { fetchWrapper, obterContadores } = criarFetchComLimiteExterno(fetchFalso);
  const resposta = await fetchWrapper('https://api.openai.com/v1/responses', {
    method: 'POST',
    body: corpoValidoSerializado(),
  });
  assert.equal(resposta.status, 200);
  assert.equal(obterChamadasReais(), 1, 'a rede falsa deveria ter sido alcancada exatamente uma vez');
  assert.deepEqual(obterContadores(), { invocacoesRecebidas: 1, chamadasExternas: 1, segundaChamadaBloqueada: false });
});

test('criarFetchComLimiteExterno: segunda invocacao e bloqueada ANTES da rede, mesmo que a estrutura fosse valida', async () => {
  const { fetchFalso, obterChamadasReais } = criarFetchFalsoComContadorReal(() => respostaSucessoValida());
  const { fetchWrapper, obterContadores } = criarFetchComLimiteExterno(fetchFalso);

  await fetchWrapper('https://api.openai.com/v1/responses', { method: 'POST', body: corpoValidoSerializado() });
  await assert.rejects(() => fetchWrapper('https://api.openai.com/v1/responses', { method: 'POST', body: corpoValidoSerializado() }));

  assert.equal(obterChamadasReais(), 1, 'a segunda invocacao nunca deveria alcancar a rede falsa');
  assert.deepEqual(obterContadores(), { invocacoesRecebidas: 2, chamadasExternas: 1, segundaChamadaBloqueada: true });
});

test('criarFetchComLimiteExterno: estrutura invalida bloqueia antes da rede, sem incrementar chamadasExternas', async () => {
  const { fetchFalso, obterChamadasReais } = criarFetchFalsoComContadorReal(() => respostaSucessoValida());
  const { fetchWrapper, obterContadores, obterInspecao } = criarFetchComLimiteExterno(fetchFalso);

  const corpo = JSON.parse(corpoValidoSerializado());
  corpo.text.format.strict = false;

  await assert.rejects(() => fetchWrapper('https://api.openai.com/v1/responses', { method: 'POST', body: JSON.stringify(corpo) }));

  assert.equal(obterChamadasReais(), 0, 'estrutura invalida nunca deveria alcancar a rede falsa');
  assert.equal(obterContadores().chamadasExternas, 0);
  assert.equal(obterInspecao()?.strictTrue, false);
});

// --- executarUma (fim a fim, fetch inteiramente falso) ---

test('executarUma: cenario de sucesso -- saida sanitizada com os quatro campos, aprovado=true', async () => {
  const { fetchFalso } = criarFetchFalsoComContadorReal(() => respostaSucessoValida());
  const evidencia = await executarUma(fetchFalso, CHAVE_FALSA);

  assert.equal(evidencia.aprovado, true);
  if (!evidencia.aprovado) return; // guarda de tipo
  assert.equal(evidencia.status_http, 200);
  assert.equal(evidencia.modelo_ok, true);
  assert.equal(evidencia.store_false, true);
  assert.equal(evidencia.strict_true, true);
  assert.equal(evidencia.tools_ausentes, true);
  assert.equal(evidencia.conversao_ok, true);
  assert.deepEqual(evidencia.campos, [...CAMPOS_ESPERADOS].sort());
  assert.equal(evidencia.invocacoes_fetch, 1);
  assert.equal(evidencia.chamadas_externas, 1);
  assert.equal(evidencia.segunda_chamada_bloqueada, false);
  assert.equal(typeof evidencia.duracao_ms, 'number');
});

test('executarUma: nenhuma evidencia (sucesso) contem a chave, o texto do payload ou o marcador de resposta bruta', async () => {
  const { fetchFalso } = criarFetchFalsoComContadorReal(() => respostaSucessoValida());
  const evidencia = await executarUma(fetchFalso, CHAVE_FALSA);
  const serializado = JSON.stringify(evidencia);

  assert.ok(!serializado.includes(CHAVE_FALSA), 'a chave nunca pode aparecer na evidencia');
  assert.ok(!serializado.includes(TEXTO_MENSAGEM_PAYLOAD), 'o texto do payload nunca pode aparecer na evidencia');
  assert.ok(!serializado.includes(MARCADOR_RESPOSTA_BRUTA), 'nenhum conteudo bruto da resposta pode aparecer na evidencia');
  // "campos" deve conter somente NOMES de campo, nunca os valores interpretados
  assert.ok(!serializado.includes('novo_agendamento'));
  assert.ok(!serializado.toLowerCase().includes('limpeza'));
});

test('executarUma: campo extra na saida do modelo reprova (aprovado=false, sem expor valores)', async () => {
  const corpoComCampoExtra = {
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              alteracoes: [
                { campo: 'intencao', acao: 'informar', valor: 'novo_agendamento' },
                { campo: 'procedimento_texto', acao: 'informar', valor: 'limpeza' },
                { campo: 'data_texto', acao: 'informar', valor: 'amanhã' },
                { campo: 'periodo', acao: 'informar', valor: 'tarde' },
                { campo: 'nome', acao: 'informar', valor: 'Joao' },
              ],
            }),
          },
        ],
      },
    ],
  };
  const { fetchFalso } = criarFetchFalsoComContadorReal(
    () => new Response(JSON.stringify(corpoComCampoExtra), { status: 200 })
  );
  const evidencia = await executarUma(fetchFalso, CHAVE_FALSA);

  assert.equal(evidencia.aprovado, false);
  if (evidencia.aprovado) return;
  assert.equal(evidencia.codigo, 'conversao_nao_corresponde_ao_esperado');
  assert.equal(evidencia.invocacoes_fetch, 1);
  assert.equal(evidencia.chamadas_externas, 1);
});

test('executarUma: falha retentavel (503) -- a tentativa de retry e bloqueada pelo limite externo, reprovado', async () => {
  const { fetchFalso, obterChamadasReais } = criarFetchFalsoComContadorReal(() => respostaErroHttp(503));
  const evidencia = await executarUma(fetchFalso, CHAVE_FALSA);

  assert.equal(evidencia.aprovado, false);
  if (evidencia.aprovado) return;
  assert.equal(evidencia.invocacoes_fetch, 2, 'o adaptador deveria ter tentado uma segunda vez (503 e retentavel)');
  assert.equal(evidencia.chamadas_externas, 1, 'somente a primeira tentativa deveria ter alcancado a rede falsa');
  assert.equal(evidencia.segunda_chamada_bloqueada, true);
  assert.equal(obterChamadasReais(), 1, 'a rede falsa nunca deveria ser alcancada uma segunda vez');
  const serializado = JSON.stringify(evidencia);
  assert.ok(!serializado.includes(MARCADOR_RESPOSTA_BRUTA));
});

test('executarUma: erro de autenticacao (401) nao tenta segunda vez; reprovado com categoria sanitizada', async () => {
  const { fetchFalso, obterChamadasReais } = criarFetchFalsoComContadorReal(() => respostaErroHttp(401));
  const evidencia = await executarUma(fetchFalso, CHAVE_FALSA);

  assert.equal(evidencia.aprovado, false);
  if (evidencia.aprovado) return;
  assert.equal(evidencia.categoria, 'autenticacao');
  assert.equal(evidencia.status_http, 401);
  assert.equal(evidencia.invocacoes_fetch, 1);
  assert.equal(evidencia.chamadas_externas, 1);
  assert.equal(evidencia.segunda_chamada_bloqueada, false);
  assert.equal(obterChamadasReais(), 1);
  const serializado = JSON.stringify(evidencia);
  assert.ok(!serializado.includes(MARCADOR_RESPOSTA_BRUTA));
  assert.ok(!serializado.includes(CHAVE_FALSA));
});

test('executarUma: nenhuma chamada real de rede ocorre (todas as respostas vem de fetch inteiramente falso)', async () => {
  const { fetchFalso, obterChamadasReais } = criarFetchFalsoComContadorReal(() => respostaSucessoValida());
  await executarUma(fetchFalso, CHAVE_FALSA);
  assert.equal(obterChamadasReais(), 1);
  // confirma que o fetch usado nunca e o global -- e sempre a funcao falsa local
  assert.notEqual(fetchFalso, globalThis.fetch);
});

test('executarUma: evidencia de sucesso contem exatamente o conjunto aprovado de propriedades', async () => {
  const { fetchFalso } = criarFetchFalsoComContadorReal(() => respostaSucessoValida());
  const evidencia = await executarUma(fetchFalso, CHAVE_FALSA);
  assert.deepEqual(Object.keys(evidencia).sort(), PROPRIEDADES_SUCESSO_ESPERADAS);
});

test('executarUma: evidencia de erro contem exatamente o conjunto aprovado de propriedades', async () => {
  const { fetchFalso } = criarFetchFalsoComContadorReal(() => respostaErroHttp(401));
  const evidencia = await executarUma(fetchFalso, CHAVE_FALSA);
  assert.deepEqual(Object.keys(evidencia).sort(), PROPRIEDADES_ERRO_ESPERADAS);
});

// --- executarPrincipal: exercita o MESMO caminho usado por main() em
// execucao real (dependencias injetaveis: fetch, leitura de chave, saida),
// sem nunca tocar rede, ambiente ou console de verdade. ---

test('executarPrincipal: sucesso -- saida chamada exatamente uma vez, aprovado=true, codigo de retorno 0, nada sensivel vaza', async () => {
  const { fetchFalso } = criarFetchFalsoComContadorReal(() => respostaSucessoValida());
  const chamadasSaida: unknown[] = [];
  const codigo = await executarPrincipal({
    fetchSubjacente: fetchFalso,
    obterChaveApi: () => CHAVE_FALSA,
    saida: (evidencia) => chamadasSaida.push(evidencia),
  });

  assert.equal(codigo, 0);
  assert.equal(chamadasSaida.length, 1, 'a funcao de saida deveria ter sido chamada exatamente uma vez');
  const evidencia = chamadasSaida[0] as Record<string, unknown>;
  assert.equal(evidencia.aprovado, true);
  assert.deepEqual(Object.keys(evidencia).sort(), PROPRIEDADES_SUCESSO_ESPERADAS);
  const serializado = JSON.stringify(evidencia);
  assert.ok(!serializado.includes(CHAVE_FALSA));
  assert.ok(!serializado.includes(TEXTO_MENSAGEM_PAYLOAD));
  assert.ok(!serializado.includes(MARCADOR_RESPOSTA_BRUTA));
});

test('executarPrincipal: erro 401 -- saida chamada exatamente uma vez, aprovado=false, codigo de retorno diferente de zero', async () => {
  const { fetchFalso } = criarFetchFalsoComContadorReal(() => respostaErroHttp(401));
  const chamadasSaida: unknown[] = [];
  const codigo = await executarPrincipal({
    fetchSubjacente: fetchFalso,
    obterChaveApi: () => CHAVE_FALSA,
    saida: (evidencia) => chamadasSaida.push(evidencia),
  });

  assert.notEqual(codigo, 0);
  assert.equal(chamadasSaida.length, 1);
  const evidencia = chamadasSaida[0] as Record<string, unknown>;
  assert.equal(evidencia.aprovado, false);
  assert.equal(evidencia.categoria, 'autenticacao');
  assert.deepEqual(Object.keys(evidencia).sort(), PROPRIEDADES_ERRO_ESPERADAS);
  const serializado = JSON.stringify(evidencia);
  assert.ok(!serializado.includes(MARCADOR_RESPOSTA_BRUTA));
  assert.ok(!serializado.includes(CHAVE_FALSA));
});

test('executarPrincipal: falha retentavel (503) com segunda tentativa bloqueada -- saida chamada exatamente uma vez, reprovado', async () => {
  const { fetchFalso } = criarFetchFalsoComContadorReal(() => respostaErroHttp(503));
  const chamadasSaida: unknown[] = [];
  const codigo = await executarPrincipal({
    fetchSubjacente: fetchFalso,
    obterChaveApi: () => CHAVE_FALSA,
    saida: (evidencia) => chamadasSaida.push(evidencia),
  });

  assert.notEqual(codigo, 0);
  assert.equal(chamadasSaida.length, 1);
  const evidencia = chamadasSaida[0] as Record<string, unknown>;
  assert.equal(evidencia.aprovado, false);
  assert.equal(evidencia.segunda_chamada_bloqueada, true);
  assert.deepEqual(Object.keys(evidencia).sort(), PROPRIEDADES_ERRO_ESPERADAS);
  const serializado = JSON.stringify(evidencia);
  assert.ok(!serializado.includes(MARCADOR_RESPOSTA_BRUTA));
});

test('executarPrincipal: chave ausente -- nenhuma chamada ao fetch, saida chamada exatamente uma vez, codigo=chave_ausente', async () => {
  const chamadasSaida: unknown[] = [];
  const codigo = await executarPrincipal({
    fetchSubjacente: criarFetchQueNuncaDeveSerChamado(),
    obterChaveApi: () => undefined,
    saida: (evidencia) => chamadasSaida.push(evidencia),
  });

  assert.notEqual(codigo, 0);
  assert.equal(chamadasSaida.length, 1);
  const evidencia = chamadasSaida[0] as Record<string, unknown>;
  assert.equal(evidencia.aprovado, false);
  assert.equal(evidencia.codigo, 'chave_ausente');
  assert.equal(evidencia.invocacoes_fetch, 0);
  assert.equal(evidencia.chamadas_externas, 0);
  assert.deepEqual(Object.keys(evidencia).sort(), PROPRIEDADES_ERRO_ESPERADAS);
  assert.ok(!JSON.stringify(evidencia).includes(CHAVE_FALSA));
});

test('executarPrincipal: chave ausente tambem cobre string vazia', async () => {
  const chamadasSaida: unknown[] = [];
  const codigo = await executarPrincipal({
    fetchSubjacente: criarFetchQueNuncaDeveSerChamado(),
    obterChaveApi: () => '   ',
    saida: (evidencia) => chamadasSaida.push(evidencia),
  });
  assert.notEqual(codigo, 0);
  assert.equal((chamadasSaida[0] as Record<string, unknown>).codigo, 'chave_ausente');
});

test('executarPrincipal: erro inesperado no caminho principal -- saida sanitizada, sem mensagem nem stack do erro real', async () => {
  const MENSAGEM_SENSIVEL = 'mensagem sensivel de teste que nunca deveria vazar XYZ999';
  const chamadasSaida: unknown[] = [];
  const codigo = await executarPrincipal({
    fetchSubjacente: criarFetchQueNuncaDeveSerChamado(),
    obterChaveApi: () => {
      throw new Error(MENSAGEM_SENSIVEL);
    },
    saida: (evidencia) => chamadasSaida.push(evidencia),
  });

  assert.notEqual(codigo, 0);
  assert.equal(chamadasSaida.length, 1, 'a funcao de saida deveria ter sido chamada exatamente uma vez, mesmo com erro inesperado');
  const evidencia = chamadasSaida[0] as Record<string, unknown>;
  assert.equal(evidencia.aprovado, false);
  assert.equal(evidencia.codigo, 'erro_nao_tratado_no_runner');
  assert.deepEqual(Object.keys(evidencia).sort(), PROPRIEDADES_ERRO_ESPERADAS);
  const serializado = JSON.stringify(evidencia);
  assert.ok(!serializado.includes(MENSAGEM_SENSIVEL), 'a mensagem do erro real nunca pode vazar na evidencia');
  assert.ok(!serializado.toLowerCase().includes('stack'), 'nenhum stack deveria ser serializado');
});
