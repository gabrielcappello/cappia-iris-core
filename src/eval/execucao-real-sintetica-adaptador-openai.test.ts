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
  executarUma,
  inspecionarCorpoRequisicao,
  validarConversao,
} from './execucao-real-sintetica-adaptador-openai.ts';

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
