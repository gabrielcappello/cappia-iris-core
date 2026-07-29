// Testes de unidade do adaptador OpenAI usando um FETCH FALSO injetado —
// nenhuma chamada real de API ocorre em nenhum teste deste arquivo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  converterParaContratoInterno,
  criarClienteModeloOpenAI,
  ErroClienteModeloOpenAI,
  MODELO_GPT_4_1_MINI,
} from './cliente-modelo-openai.ts';
import { INSTRUCOES_EXTRATOR } from './interpretacao-instrucoes.ts';

// --- dublês de fetch ---

function criarFetchFalso(geradores: Array<() => Response | Promise<Response>>) {
  let indice = 0;
  const chamadas: Array<{ url: string; opcoes: RequestInit }> = [];
  const fetchFalso = (async (url: string | URL, opcoes?: RequestInit) => {
    chamadas.push({ url: String(url), opcoes: opcoes ?? {} });
    const gerador = geradores[Math.min(indice, geradores.length - 1)];
    indice++;
    return await gerador();
  }) as typeof fetch;
  return { fetchFalso, chamadas };
}

function respostaSucesso(alteracoesPortatil: unknown[], usage: Record<string, number> = { input_tokens: 1, output_tokens: 1 }) {
  const corpo = {
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify({ alteracoes: alteracoesPortatil }) }],
      },
    ],
    usage,
  };
  return new Response(JSON.stringify(corpo), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function respostaRecusa() {
  const corpo = {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'nao posso ajudar com isso' }] }],
  };
  return new Response(JSON.stringify(corpo), { status: 200 });
}

function respostaNaoEstruturada() {
  const corpo = {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'algum_outro_tipo', texto: 'nao e o canal esperado' }] }],
  };
  return new Response(JSON.stringify(corpo), { status: 200 });
}

function respostaTruncada() {
  const corpo = { status: 'incomplete', output: [] };
  return new Response(JSON.stringify(corpo), { status: 200 });
}

function respostaErroHttp(status: number, corpoErro: unknown) {
  return new Response(JSON.stringify(corpoErro), { status });
}

function fetchQueSempreFalhaRede(): typeof fetch {
  return (async () => {
    throw new Error('falha de rede simulada');
  }) as unknown as typeof fetch;
}

function fetchQueNuncaResponde(): typeof fetch {
  return (async (_url: string | URL, opcoes?: RequestInit) => {
    return await new Promise<Response>((_resolve, reject) => {
      const sinal = opcoes?.signal;
      const rejeitarComAbort = () => {
        const erro = new Error('This operation was aborted');
        erro.name = 'AbortError';
        reject(erro);
      };
      if (sinal) {
        if (sinal.aborted) {
          rejeitarComAbort();
          return;
        }
        sinal.addEventListener('abort', rejeitarComAbort);
      }
    });
  }) as unknown as typeof fetch;
}

function entradaValida(overrides: Record<string, unknown> = {}) {
  return {
    instrucoes: INSTRUCOES_EXTRATOR,
    schema: { istoDeveSerIgnoradoPeloAdaptador: true },
    payload: { mensagens_atuais: ['quero uma limpeza'], dados_atuais: {} },
    ...overrides,
  } as never;
}

const CONFIG_TEMPO_RAPIDO = {
  timeoutPorTentativaMs: 50,
  prazoTotalMs: 5000,
  esperaEntreTentativasMs: 5,
};

// --- 1-2: forma da requisicao ---

test('teste1: requisicao usa modelo fixado, store false, strict true e nenhuma tool', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarClienteModeloOpenAI({
    chaveApi: 'chave-de-teste',
    modelo: MODELO_GPT_4_1_MINI,
    fetch: fetchFalso,
    ...CONFIG_TEMPO_RAPIDO,
  });

  await cliente.executar(entradaValida());

  assert.equal(chamadas.length, 1);
  const corpo = JSON.parse(chamadas[0].opcoes.body as string);
  assert.equal(corpo.model, MODELO_GPT_4_1_MINI);
  assert.equal(corpo.store, false);
  assert.equal(corpo.stream, false);
  assert.equal(corpo.background, false);
  assert.equal(corpo.text.format.type, 'json_schema');
  assert.equal(corpo.text.format.strict, true);
  assert.ok(!('tools' in corpo));
});

test('teste2: somente instrucoes e payload autorizado sao enviados, nenhum identificador vaza', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarClienteModeloOpenAI({
    chaveApi: 'chave-de-teste',
    modelo: MODELO_GPT_4_1_MINI,
    fetch: fetchFalso,
    ...CONFIG_TEMPO_RAPIDO,
  });

  const entrada = entradaValida({
    payload: {
      mensagens_atuais: ['quero uma limpeza'],
      dados_atuais: {},
      // campos fora do contrato, presentes so em runtime -- provam que o
      // adaptador nao os repassa mesmo se chegarem no objeto.
      clinica_id: 'clinica-x',
      conversa_id: 'conversa-x',
      paciente_id: 'paciente-x',
      telefone: '5511999999999',
    },
  });

  await cliente.executar(entrada);

  const corpo = JSON.parse(chamadas[0].opcoes.body as string);
  const mensagemUsuario = corpo.input.find((m: { role: string }) => m.role === 'user');
  const payloadEnviado = JSON.parse(mensagemUsuario.content);
  assert.deepEqual(Object.keys(payloadEnviado).sort(), ['dados_atuais', 'mensagens_atuais']);

  const corpoBrutoCompleto = JSON.stringify(corpo);
  assert.ok(!corpoBrutoCompleto.includes('clinica-x'));
  assert.ok(!corpoBrutoCompleto.includes('conversa-x'));
  assert.ok(!corpoBrutoCompleto.includes('paciente-x'));
  assert.ok(!corpoBrutoCompleto.includes('5511999999999'));
  assert.ok(!corpoBrutoCompleto.includes('chave-de-teste'), 'a chave vai so no header Authorization, nunca no corpo');
});

// --- 3-9: conversao portatil -> contrato interno ---

test('teste3: resposta portatil valida converte para o mapa interno', () => {
  const resultado = converterParaContratoInterno({
    alteracoes: [
      { campo: 'nome', acao: 'informar', valor: 'Joao' },
      { campo: 'procedimento_texto', acao: 'corrigir', valor: 'limpeza' },
    ],
  });
  assert.deepEqual(resultado, {
    nome: { acao: 'informar', valor: 'Joao' },
    procedimento_texto: { acao: 'corrigir', valor: 'limpeza' },
  });
});

test('teste4: lista vazia converte para alteracoes vazio', () => {
  assert.deepEqual(converterParaContratoInterno({ alteracoes: [] }), {});
});

test('teste5: remover com null converte sem propriedade valor', () => {
  const resultado = converterParaContratoInterno({ alteracoes: [{ campo: 'cpf', acao: 'remover', valor: null }] });
  assert.deepEqual(resultado, { cpf: { acao: 'remover' } });
  assert.ok(!('valor' in (resultado.cpf as object)));
});

test('teste6: campo duplicado invalida tudo', () => {
  assert.throws(() =>
    converterParaContratoInterno({
      alteracoes: [
        { campo: 'nome', acao: 'informar', valor: 'Joao' },
        { campo: 'nome', acao: 'corrigir', valor: 'Maria' },
      ],
    })
  );
});

test('teste7: informar ou corrigir com valor null invalida', () => {
  assert.throws(() => converterParaContratoInterno({ alteracoes: [{ campo: 'nome', acao: 'informar', valor: null }] }));
  assert.throws(() => converterParaContratoInterno({ alteracoes: [{ campo: 'nome', acao: 'corrigir', valor: null }] }));
});

test('teste8: remover com valor string invalida', () => {
  assert.throws(() => converterParaContratoInterno({ alteracoes: [{ campo: 'cpf', acao: 'remover', valor: '' }] }));
  assert.throws(() => converterParaContratoInterno({ alteracoes: [{ campo: 'cpf', acao: 'remover', valor: 'algum-valor' }] }));
});

test('teste9: campo, acao ou propriedade desconhecida invalida', () => {
  assert.throws(() => converterParaContratoInterno({ alteracoes: [{ campo: 'telefone', acao: 'informar', valor: 'x' }] }));
  assert.throws(() => converterParaContratoInterno({ alteracoes: [{ campo: 'nome', acao: 'apagar_tudo', valor: 'x' }] }));
  assert.throws(() =>
    converterParaContratoInterno({ alteracoes: [{ campo: 'nome', acao: 'informar', valor: 'x', confidence: 0.9 }] })
  );
});

// --- 10-11: leitura da resposta ---

test('teste10: resposta nao estruturada invalida (canal output_text ausente)', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaNaoEstruturada()]);
  const cliente = criarClienteModeloOpenAI({ chaveApi: 'x', modelo: MODELO_GPT_4_1_MINI, fetch: fetchFalso, ...CONFIG_TEMPO_RAPIDO });

  await assert.rejects(
    () => cliente.executar(entradaValida()),
    (erro: unknown) => erro instanceof ErroClienteModeloOpenAI && erro.categoria === 'resposta_nao_estruturada'
  );
});

test('teste11: resposta incompleta/truncada invalida', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaTruncada()]);
  const cliente = criarClienteModeloOpenAI({ chaveApi: 'x', modelo: MODELO_GPT_4_1_MINI, fetch: fetchFalso, ...CONFIG_TEMPO_RAPIDO });

  await assert.rejects(
    () => cliente.executar(entradaValida()),
    (erro: unknown) => erro instanceof ErroClienteModeloOpenAI && erro.categoria === 'resposta_truncada'
  );
});

// --- 12-18: retry e nao-retry ---

test('teste12: recusa nao e repetida', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaRecusa(), () => respostaSucesso([])]);
  const cliente = criarClienteModeloOpenAI({ chaveApi: 'x', modelo: MODELO_GPT_4_1_MINI, fetch: fetchFalso, ...CONFIG_TEMPO_RAPIDO });

  await assert.rejects(
    () => cliente.executar(entradaValida()),
    (erro: unknown) => erro instanceof ErroClienteModeloOpenAI && erro.categoria === 'recusa_ou_filtro'
  );
  assert.equal(chamadas.length, 1, 'nao deve repetir apos recusa');
});

test('teste13: autenticacao (401) nao e repetida', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(401, { error: { message: 'invalid api key' } }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarClienteModeloOpenAI({ chaveApi: 'x', modelo: MODELO_GPT_4_1_MINI, fetch: fetchFalso, ...CONFIG_TEMPO_RAPIDO });

  await assert.rejects(
    () => cliente.executar(entradaValida()),
    (erro: unknown) => erro instanceof ErroClienteModeloOpenAI && erro.categoria === 'autenticacao'
  );
  assert.equal(chamadas.length, 1);
});

test('teste14: 429 executa no maximo uma repeticao (2 chamadas no total)', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, { error: { message: 'rate limited' } }),
    () => respostaErroHttp(429, { error: { message: 'rate limited' } }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarClienteModeloOpenAI({ chaveApi: 'x', modelo: MODELO_GPT_4_1_MINI, fetch: fetchFalso, ...CONFIG_TEMPO_RAPIDO });

  await assert.rejects(
    () => cliente.executar(entradaValida()),
    (erro: unknown) => erro instanceof ErroClienteModeloOpenAI && erro.categoria === 'limite_taxa'
  );
  assert.equal(chamadas.length, 2, 'no maximo 2 tentativas no total');
});

test('teste15: 5xx executa no maximo uma repeticao', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(503, { error: { message: 'unavailable' } }),
    () => respostaErroHttp(503, { error: { message: 'unavailable' } }),
  ]);
  const cliente = criarClienteModeloOpenAI({ chaveApi: 'x', modelo: MODELO_GPT_4_1_MINI, fetch: fetchFalso, ...CONFIG_TEMPO_RAPIDO });

  await assert.rejects(
    () => cliente.executar(entradaValida()),
    (erro: unknown) => erro instanceof ErroClienteModeloOpenAI && erro.categoria === 'indisponibilidade'
  );
  assert.equal(chamadas.length, 2);
});

test('teste16: erro de rede executa no maximo uma repeticao', async () => {
  const base = fetchQueSempreFalhaRede();
  let numeroDeChamadas = 0;
  const fetchComContador = (async (url: string | URL, opcoes?: RequestInit) => {
    numeroDeChamadas++;
    return base(url, opcoes);
  }) as typeof fetch;

  const cliente = criarClienteModeloOpenAI({
    chaveApi: 'x',
    modelo: MODELO_GPT_4_1_MINI,
    fetch: fetchComContador,
    ...CONFIG_TEMPO_RAPIDO,
  });

  await assert.rejects(
    () => cliente.executar(entradaValida()),
    (erro: unknown) => erro instanceof ErroClienteModeloOpenAI && erro.categoria === 'indisponibilidade'
  );
  assert.equal(numeroDeChamadas, 2);
});

test('teste17: timeout respeita o timeout por tentativa e o prazo total', async () => {
  const fetchFalso = fetchQueNuncaResponde();
  const inicio = Date.now();
  const cliente = criarClienteModeloOpenAI({
    chaveApi: 'x',
    modelo: MODELO_GPT_4_1_MINI,
    fetch: fetchFalso,
    timeoutPorTentativaMs: 50,
    prazoTotalMs: 130,
    esperaEntreTentativasMs: 10,
  });

  await assert.rejects(
    () => cliente.executar(entradaValida()),
    (erro: unknown) => erro instanceof ErroClienteModeloOpenAI && erro.categoria === 'timeout'
  );
  const duracao = Date.now() - inicio;
  assert.ok(duracao < 400, `nao deve ultrapassar muito o prazo total configurado (levou ${duracao}ms)`);
});

test('teste18: segunda falha encerra sem terceira tentativa', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(500, {}),
    () => respostaErroHttp(500, {}),
    () => respostaSucesso([]), // nunca deve ser consumida
  ]);
  const cliente = criarClienteModeloOpenAI({ chaveApi: 'x', modelo: MODELO_GPT_4_1_MINI, fetch: fetchFalso, ...CONFIG_TEMPO_RAPIDO });

  await assert.rejects(() => cliente.executar(entradaValida()));
  assert.equal(chamadas.length, 2, 'a terceira resposta preparada nunca deve ser consumida');
});

// --- 19-20: PII e ausencia de rede real ---

test('teste19: erros nao contem PII, chave ou corpo bruto de erro', async () => {
  const nomeReal = 'Maria Silva Santos';
  const cpfReal = '12345678900';
  const chaveReal = 'sk-chave-secreta-de-teste-fake-000000';
  const corpoErroComPII = { error: { message: `usuario ${nomeReal} cpf ${cpfReal} rejeitado`, param: chaveReal } };

  const { fetchFalso } = criarFetchFalso([() => respostaErroHttp(400, corpoErroComPII)]);
  const cliente = criarClienteModeloOpenAI({ chaveApi: chaveReal, modelo: MODELO_GPT_4_1_MINI, fetch: fetchFalso, ...CONFIG_TEMPO_RAPIDO });

  let erroCapturado: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (erro) {
    erroCapturado = erro;
  }

  assert.ok(erroCapturado instanceof ErroClienteModeloOpenAI);
  const erroTipado = erroCapturado as ErroClienteModeloOpenAI;
  const representacao = JSON.stringify(erroTipado) + erroTipado.message + erroTipado.codigo + erroTipado.categoria;
  assert.ok(!representacao.includes(nomeReal));
  assert.ok(!representacao.includes(cpfReal));
  assert.ok(!representacao.includes(chaveReal));
});

test('teste20: nenhuma chamada real de API ocorre nestes testes (fetch sempre injetado e falso)', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarClienteModeloOpenAI({ chaveApi: 'x', modelo: MODELO_GPT_4_1_MINI, fetch: fetchFalso, ...CONFIG_TEMPO_RAPIDO });

  await cliente.executar(entradaValida());

  assert.equal(chamadas.length, 1);
  assert.equal(
    chamadas[0].url,
    'https://api.openai.com/v1/responses',
    'confirma qual URL seria chamada; o fetch usado e falso, entao nenhum request de rede real ocorre'
  );
});

// --- extra: caminho feliz completo ---

test('extra: executar() bem-sucedido devolve o mapa interno pronto para validarSaidaInterpretacao', async () => {
  const { fetchFalso } = criarFetchFalso([
    () =>
      respostaSucesso([
        { campo: 'procedimento_texto', acao: 'informar', valor: 'limpeza' },
        { campo: 'cpf', acao: 'remover', valor: null },
      ]),
  ]);
  const cliente = criarClienteModeloOpenAI({ chaveApi: 'x', modelo: MODELO_GPT_4_1_MINI, fetch: fetchFalso, ...CONFIG_TEMPO_RAPIDO });

  const resultado = await cliente.executar(entradaValida());

  assert.deepEqual(resultado, {
    alteracoes: {
      procedimento_texto: { acao: 'informar', valor: 'limpeza' },
      cpf: { acao: 'remover' },
    },
  });
});
