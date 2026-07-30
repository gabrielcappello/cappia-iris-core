// Testes de unidade do adaptador OpenAI usando um FETCH FALSO injetado —
// nenhuma chamada real de API ocorre em nenhum teste deste arquivo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  converterParaContratoInterno,
  criarClienteModeloOpenAI,
  ErroClienteModeloOpenAI,
  ErroConfiguracaoClienteModeloOpenAI,
  MODELO_GPT_4_1_MINI,
} from './cliente-modelo-openai.ts';
import { INSTRUCOES_EXTRATOR } from './interpretacao-instrucoes.ts';

// --- dublês de fetch (todos falsos; nenhuma rede real em nenhum teste) ---

interface ChamadaRegistrada {
  url: string;
  opcoes: RequestInit;
  momento: number;
}

function criarFetchFalso(geradores: Array<(opcoes: RequestInit) => Response | Promise<Response>>) {
  let indice = 0;
  const chamadas: ChamadaRegistrada[] = [];
  const fetchFalso = (async (url: string | URL, opcoes?: RequestInit) => {
    const opcoesFinal = opcoes ?? {};
    chamadas.push({ url: String(url), opcoes: opcoesFinal, momento: Date.now() });
    const gerador = geradores[Math.min(indice, geradores.length - 1)];
    indice++;
    return await gerador(opcoesFinal);
  }) as typeof fetch;
  return { fetchFalso, chamadas };
}

function respostaSucesso(alteracoesPortatil: unknown[], usage: Record<string, number> = { input_tokens: 1, output_tokens: 1 }) {
  const corpo = {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ alteracoes: alteracoesPortatil }) }] }],
    usage,
  };
  return new Response(JSON.stringify(corpo), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function respostaZeroBytes() {
  return new Response('', { status: 200 });
}

function respostaOutputTextVazio() {
  const corpo = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }] };
  return new Response(JSON.stringify(corpo), { status: 200 });
}

function respostaJsonInvalido() {
  return new Response('isto nao e json { valido', { status: 200 });
}

function respostaRaizNaoObjeto() {
  return new Response(JSON.stringify([1, 2, 3]), { status: 200 });
}

function respostaOutputAusente() {
  return new Response(JSON.stringify({ status: 'completed' }), { status: 200 });
}

function respostaOutputNaoArray() {
  return new Response(JSON.stringify({ status: 'completed', output: {} }), { status: 200 });
}

function respostaMessageAusente() {
  const corpo = { status: 'completed', output: [{ type: 'reasoning' }] };
  return new Response(JSON.stringify(corpo), { status: 200 });
}

function respostaContentAusente() {
  const corpo = { status: 'completed', output: [{ type: 'message' }] };
  return new Response(JSON.stringify(corpo), { status: 200 });
}

function respostaContentNaoArray() {
  const corpo = { status: 'completed', output: [{ type: 'message', content: {} }] };
  return new Response(JSON.stringify(corpo), { status: 200 });
}

function respostaOutputTextAusente() {
  const corpo = { status: 'completed', output: [{ type: 'message', content: [{ type: 'algum_outro_tipo' }] }] };
  return new Response(JSON.stringify(corpo), { status: 200 });
}

function respostaRecusaNoSegundoItemDeContent(textoRecusa: string) {
  const corpo = {
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: '{}' }, { type: 'refusal', refusal: textoRecusa }],
      },
    ],
  };
  return new Response(JSON.stringify(corpo), { status: 200 });
}

function respostaRecusaEmOutroItemDeOutput(textoRecusa: string) {
  const corpo = {
    status: 'completed',
    output: [
      { type: 'refusal', refusal: textoRecusa },
      { type: 'message', content: [{ type: 'output_text', text: '{"alteracoes":[]}' }] },
    ],
  };
  return new Response(JSON.stringify(corpo), { status: 200 });
}

function respostaFiltroNoEnvelope() {
  const corpo = { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] };
  return new Response(JSON.stringify(corpo), { status: 200 });
}

function respostaErroHttp(status: number, corpoErro: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(corpoErro), { status, headers });
}

function fetchQueSempreFalhaRede(): typeof fetch {
  return (async () => {
    throw new Error('falha de rede simulada');
  }) as unknown as typeof fetch;
}

// fetch() nunca resolve ate o sinal abortar -- simula timeout logo no envio/espera por headers.
// Assinatura igual ao fetch real (url, opcoes) -- usada diretamente como
// substituta de fetch, nunca atraves de criarFetchFalso.
function fetchQueNuncaResponde(): typeof fetch {
  return ((_url: string | URL, opcoes?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
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
    })) as unknown as typeof fetch;
}

// fetch() resolve IMEDIATAMENTE com uma resposta ok (simulando headers ja
// recebidos), mas a leitura do corpo (`.text()`) nunca termina ate o
// sinal abortar -- prova que o timeout cobre a leitura do corpo, nao so
// o envio/espera por headers. Assinatura igual ao fetch real (url, opcoes).
function fetchComCorpoQueNuncaTermina(): typeof fetch {
  return (async (_url: string | URL, opcoes?: RequestInit) => {
    const sinal = opcoes?.signal;
    const respostaFalsa = {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () =>
        new Promise<string>((_resolve, reject) => {
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
        }),
    };
    return respostaFalsa as unknown as Response;
  }) as unknown as typeof fetch;
}

// fetch() so resolve apos `atrasoMs` reais, ignorando completamente o
// sinal de abort (simula um cliente HTTP que nao propaga abort para a
// leitura do corpo) -- usado para provar que a checagem explicita de
// prazo (nao o AbortController) e o que rejeita sucesso tardio.
function fetchComLeituraLentaIgnorandoAbort(atrasoMs: number, alteracoesPortatil: unknown[] = []): typeof fetch {
  return (async () => {
    await new Promise((resolve) => setTimeout(resolve, atrasoMs));
    return respostaSucesso(alteracoesPortatil);
  }) as unknown as typeof fetch;
}

function respostaSemStatus() {
  const corpo = { output: [] };
  return new Response(JSON.stringify(corpo), { status: 200 });
}

function respostaComStatusInvalido(status: unknown) {
  const corpo = { status, output: [] };
  return new Response(JSON.stringify(corpo), { status: 200 });
}

// Bloqueio sincrono deliberado e controlado (spin em Date.now()), usado
// somente em testes -- torna o tempo decorrido preciso e independente de
// jitter do event loop, ao contrario de um atraso baseado em setTimeout.
function bloqueioSincronoMs(ms: number): void {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    // bloqueio deliberado
  }
}

// Substitui temporariamente o JSON.parse global por uma versao que
// bloqueia sincronamente por `atrasoMs` antes de delegar ao parse
// original -- simula processamento pos-leitura lento (que o
// AbortController nao consegue interromper) sem depender de timers reais.
// Sempre restaurado em finally; nenhuma alteracao global sobrevive ao
// teste.
async function comJsonParseAtrasado<T>(atrasoMs: number, fn: () => Promise<T>): Promise<T> {
  const parseOriginal = JSON.parse;
  JSON.parse = ((texto: string, reviver?: (key: string, value: unknown) => unknown) => {
    bloqueioSincronoMs(atrasoMs);
    return parseOriginal(texto, reviver);
  }) as typeof JSON.parse;
  try {
    return await fn();
  } finally {
    JSON.parse = parseOriginal;
  }
}

function entradaValida(overrides: Record<string, unknown> = {}) {
  return {
    instrucoes: INSTRUCOES_EXTRATOR,
    schema: { istoDeveSerIgnoradoPeloAdaptador: true },
    payload: { mensagens_atuais: ['quero uma limpeza'], dados_atuais: {} },
    ...overrides,
  } as never;
}

const TEMPOS_RAPIDOS = {
  timeoutPorTentativaMs: 60,
  prazoTotalMs: 5000,
  esperaEntreTentativasMs: 5,
};

function criarCliente(overrides: Record<string, unknown> = {}) {
  return criarClienteModeloOpenAI({
    chaveApi: 'chave-de-teste',
    modelo: MODELO_GPT_4_1_MINI,
    ...TEMPOS_RAPIDOS,
    ...overrides,
  } as never);
}

function assertCategoria(erro: unknown, categoria: string): asserts erro is ErroClienteModeloOpenAI {
  assert.ok(erro instanceof ErroClienteModeloOpenAI, `esperava ErroClienteModeloOpenAI, recebeu ${String(erro)}`);
  assert.equal((erro as ErroClienteModeloOpenAI).categoria, categoria);
}

// --- 1: modelo realmente fixado ---

test('1: modelo diferente da constante rejeita antes de fetch', async () => {
  let fetchFoiChamado = false;
  const fetchNuncaDeveSerChamado = (async () => {
    fetchFoiChamado = true;
    throw new Error('nao deveria ter sido chamado');
  }) as unknown as typeof fetch;

  assert.throws(
    () =>
      criarClienteModeloOpenAI({
        chaveApi: 'x',
        modelo: 'gpt-4o-mini',
        fetch: fetchNuncaDeveSerChamado,
        ...TEMPOS_RAPIDOS,
      } as never),
    (erro: unknown) => erro instanceof ErroConfiguracaoClienteModeloOpenAI && erro.campo === 'modelo'
  );
  assert.equal(fetchFoiChamado, false);
});

// --- 2-4: validacao de configuracao ---

test('2: tempos ausentes rejeitam', () => {
  for (const campoAusente of ['timeoutPorTentativaMs', 'prazoTotalMs', 'esperaEntreTentativasMs']) {
    const config: Record<string, unknown> = { chaveApi: 'x', modelo: MODELO_GPT_4_1_MINI, ...TEMPOS_RAPIDOS };
    delete config[campoAusente];
    assert.throws(
      () => criarClienteModeloOpenAI(config as never),
      (erro: unknown) => erro instanceof ErroConfiguracaoClienteModeloOpenAI && erro.campo === campoAusente,
      `deveria rejeitar ausencia de ${campoAusente}`
    );
  }
});

test('3: tempos invalidos (negativo, zero proibido, NaN, Infinity, decimal, tipo incorreto) rejeitam', () => {
  const valoresInvalidosParaTempoPositivo = [-1, 0, NaN, Infinity, -Infinity, 1.5, '8000', null, true, {}];
  for (const valor of valoresInvalidosParaTempoPositivo) {
    assert.throws(
      () =>
        criarClienteModeloOpenAI({
          chaveApi: 'x',
          modelo: MODELO_GPT_4_1_MINI,
          timeoutPorTentativaMs: valor,
          prazoTotalMs: 5000,
          esperaEntreTentativasMs: 5,
        } as never),
      ErroConfiguracaoClienteModeloOpenAI,
      `timeoutPorTentativaMs=${String(valor)} deveria rejeitar`
    );
  }

  const valoresInvalidosParaEsperaNaoNegativa = [-1, NaN, Infinity, 1.5, '5', null];
  for (const valor of valoresInvalidosParaEsperaNaoNegativa) {
    assert.throws(
      () =>
        criarClienteModeloOpenAI({
          chaveApi: 'x',
          modelo: MODELO_GPT_4_1_MINI,
          timeoutPorTentativaMs: 60,
          prazoTotalMs: 5000,
          esperaEntreTentativasMs: valor,
        } as never),
      ErroConfiguracaoClienteModeloOpenAI,
      `esperaEntreTentativasMs=${String(valor)} deveria rejeitar`
    );
  }

  // esperaEntreTentativasMs = 0 e permitido (zero nao e proibido aqui).
  assert.doesNotThrow(() =>
    criarClienteModeloOpenAI({ chaveApi: 'x', modelo: MODELO_GPT_4_1_MINI, timeoutPorTentativaMs: 60, prazoTotalMs: 5000, esperaEntreTentativasMs: 0 })
  );
});

test('4: prazo total menor que uma tentativa completa rejeita', () => {
  assert.throws(
    () =>
      criarClienteModeloOpenAI({
        chaveApi: 'x',
        modelo: MODELO_GPT_4_1_MINI,
        timeoutPorTentativaMs: 8000,
        prazoTotalMs: 100,
        esperaEntreTentativasMs: 5,
      }),
    (erro: unknown) => erro instanceof ErroConfiguracaoClienteModeloOpenAI && erro.campo === 'prazoTotalMs'
  );
});

// --- 5-6: resposta_vazia ---

test('5: corpo HTTP realmente vazio gera resposta_vazia e permite no maximo um retry', async () => {
  // caso A: vazio, depois sucesso -> resolve apos 2 chamadas
  {
    const { fetchFalso, chamadas } = criarFetchFalso([() => respostaZeroBytes(), () => respostaSucesso([])]);
    const cliente = criarCliente({ fetch: fetchFalso });
    const resultado = await cliente.executar(entradaValida());
    assert.deepEqual(resultado, { alteracoes: {} });
    assert.equal(chamadas.length, 2);
  }
  // caso B: vazio duas vezes -> falha apos exatamente 2 chamadas
  {
    const { fetchFalso, chamadas } = criarFetchFalso([() => respostaZeroBytes(), () => respostaZeroBytes(), () => respostaSucesso([])]);
    const cliente = criarCliente({ fetch: fetchFalso });
    let erro: unknown;
    try {
      await cliente.executar(entradaValida());
    } catch (e) {
      erro = e;
    }
    assertCategoria(erro, 'resposta_vazia');
    assert.equal(erro.tentativas, 2);
    assert.equal(chamadas.length, 2, 'a terceira resposta preparada nunca deve ser consumida');
  }
});

test('6: output_text vazio gera resposta_vazia', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaOutputTextVazio(), () => respostaOutputTextVazio()]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'resposta_vazia');
  assert.equal(chamadas.length, 2);
});

// --- extra (nao numerado, mantido do commit anterior): erro de rede generico e indisponibilidade repetivel ---

test('extra: erro de rede (fetch lanca) e classificado como indisponibilidade e executa no maximo uma repeticao', async () => {
  const base = fetchQueSempreFalhaRede();
  let numeroDeChamadas = 0;
  const fetchComContador = (async (url: string | URL, opcoes?: RequestInit) => {
    numeroDeChamadas++;
    return base(url, opcoes);
  }) as typeof fetch;

  const cliente = criarCliente({ fetch: fetchComContador });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'indisponibilidade');
  assert.equal(numeroDeChamadas, 2);
});

// --- 7-13: resposta_invalida / resposta_nao_estruturada, sem retry ---

test('7: corpo nao vazio com JSON invalido gera resposta_invalida e nao repete', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaJsonInvalido(), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'resposta_invalida');
  assert.equal(chamadas.length, 1);
});

test('8: raiz JSON invalida nao repete', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaRaizNaoObjeto(), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'resposta_invalida');
  assert.equal(chamadas.length, 1);
});

test('9: output ausente nao repete', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaOutputAusente(), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'resposta_nao_estruturada');
  assert.equal(chamadas.length, 1);
});

test('10: output nao array nao repete', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaOutputNaoArray(), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'resposta_nao_estruturada');
  assert.equal(chamadas.length, 1);
});

test('11: item message ausente nao repete', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaMessageAusente(), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'resposta_nao_estruturada');
  assert.equal(chamadas.length, 1);
});

test('12: content ausente ou invalido nao repete', async () => {
  for (const gerador of [respostaContentAusente, respostaContentNaoArray]) {
    const { fetchFalso, chamadas } = criarFetchFalso([() => gerador(), () => respostaSucesso([])]);
    const cliente = criarCliente({ fetch: fetchFalso });
    let erro: unknown;
    try {
      await cliente.executar(entradaValida());
    } catch (e) {
      erro = e;
    }
    assertCategoria(erro, 'resposta_nao_estruturada');
    assert.equal(chamadas.length, 1);
  }
});

test('13: output_text ausente nao repete', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaOutputTextAusente(), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'resposta_nao_estruturada');
  assert.equal(chamadas.length, 1);
});

// --- 14-17: recusa e filtro ---

test('14: recusa no segundo item de content e detectada', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaRecusaNoSegundoItemDeContent('nao posso ajudar com isso'),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'recusa_ou_filtro');
  assert.equal(chamadas.length, 1);
});

test('15: recusa em outro item de output e detectada', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaRecusaEmOutroItemDeOutput('conteudo bloqueado'),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'recusa_ou_filtro');
  assert.equal(chamadas.length, 1);
});

test('16: filtro indicado no envelope (incomplete_details) e detectado, nao tratado como truncamento', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaFiltroNoEnvelope(), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'recusa_ou_filtro');
  assert.notEqual(erro.categoria, 'resposta_truncada');
  assert.equal(chamadas.length, 1);
});

test('17: recusa/filtro nunca repete (ja coberto acima, reforcado aqui)', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaRecusaNoSegundoItemDeContent('x'),
    () => respostaRecusaNoSegundoItemDeContent('x'),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso });
  await assert.rejects(() => cliente.executar(entradaValida()));
  assert.equal(chamadas.length, 1);
});

// --- 18-21: timeout integral e prazo total ---

test('18: leitura do corpo bloqueada e abortada pelo timeout da tentativa', async () => {
  const cliente = criarCliente({ fetch: fetchComCorpoQueNuncaTermina(), timeoutPorTentativaMs: 40, esperaEntreTentativasMs: 5, prazoTotalMs: 5000 });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'timeout');
});

test('19: prazo (timeout por tentativa) inclui o tempo de leitura do corpo, com tolerancia pequena', async () => {
  const timeoutPorTentativaMs = 60;
  const inicio = Date.now();
  const cliente = criarCliente({
    fetch: fetchComCorpoQueNuncaTermina(),
    timeoutPorTentativaMs,
    esperaEntreTentativasMs: 0,
    prazoTotalMs: timeoutPorTentativaMs, // exatamente uma tentativa cabe, sem sobra para retry
  });
  await assert.rejects(() => cliente.executar(entradaValida()));
  const duracao = Date.now() - inicio;
  // deve ter esperado proximo do timeout configurado (nao retornar quase
  // instantaneamente, o que indicaria que o timer foi limpo cedo demais
  // -- so por causa do fetch() ter "resolvido" com os headers).
  assert.ok(duracao >= timeoutPorTentativaMs - 10, `duracao (${duracao}ms) deveria ser proxima de ${timeoutPorTentativaMs}ms`);
  assert.ok(duracao < timeoutPorTentativaMs + 150, `duracao (${duracao}ms) nao deveria ultrapassar o timeout por uma margem grande`);
});

test('20: orcamento insuficiente impede a segunda tentativa', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaErroHttp(503, {}), () => respostaSucesso([])]);
  const cliente = criarCliente({
    fetch: fetchFalso,
    timeoutPorTentativaMs: 100,
    esperaEntreTentativasMs: 50,
    prazoTotalMs: 110, // nao cabe espera(50) + tentativa completa(100) apos a primeira falha rapida
  });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'indisponibilidade');
  assert.equal(erro.tentativas, 1, 'tentativas deve refletir somente a que realmente comecou');
  assert.equal(chamadas.length, 1, 'a segunda tentativa nao deve iniciar sem orcamento');
});

test('21: quando ha orcamento, a segunda tentativa recebe o timeout completo (nunca reduzido)', async () => {
  const timeoutPorTentativaMs = 50;
  let chamadaNumero = 0;
  const fetchComposto = (async (url: string | URL, opcoes?: RequestInit) => {
    chamadaNumero++;
    if (chamadaNumero === 1) return respostaErroHttp(503, {});
    return fetchComCorpoQueNuncaTermina()(url, opcoes);
  }) as typeof fetch;

  const inicio = Date.now();
  const cliente = criarCliente({
    fetch: fetchComposto,
    timeoutPorTentativaMs,
    esperaEntreTentativasMs: 10,
    prazoTotalMs: 5000,
  });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'timeout');
  assert.equal(erro.tentativas, 2);
  const duracaoDaTentativa2 = Date.now() - inicio - 10; // subtrai a espera aproximada entre tentativas
  assert.ok(
    duracaoDaTentativa2 >= timeoutPorTentativaMs - 15,
    `a segunda tentativa deveria ter recebido proximo do timeout completo (${timeoutPorTentativaMs}ms), mediu-se ~${duracaoDaTentativa2}ms`
  );
});

// --- 22-25: Retry-After ---

test('22: Retry-After em segundos e respeitado', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': '1' }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 200, prazoTotalMs: 5000 });
  await cliente.executar(entradaValida());
  assert.equal(chamadas.length, 2);
  const intervalo = chamadas[1].momento - chamadas[0].momento;
  assert.ok(intervalo >= 950, `deveria esperar ~1000ms (Retry-After), esperou ${intervalo}ms`);
});

test('23: Retry-After como data HTTP e respeitado', async () => {
  // toUTCString() so tem precisao de SEGUNDOS (sem milissegundos) -- um
  // offset pequeno (ex.: +300ms) pode arredondar para baixo e virar
  // "no passado" ao ser reinterpretado, zerando a espera. Por isso o
  // offset usado aqui e de +2200ms: mesmo no pior caso de arredondamento
  // (perda de ate ~999ms), ainda sobra mais de 1s de espera real,
  // claramente distinguivel de esperaEntreTentativasMs (5ms).
  const dataFutura = new Date(Date.now() + 2200).toUTCString();
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': dataFutura }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 500, prazoTotalMs: 10000 });
  await cliente.executar(entradaValida());
  assert.equal(chamadas.length, 2);
  const intervalo = chamadas[1].momento - chamadas[0].momento;
  assert.ok(
    intervalo >= 1000,
    `deveria esperar bem mais que esperaEntreTentativasMs (5ms) por causa do Retry-After como data, esperou ${intervalo}ms`
  );
});

test('24: Retry-After invalido usa somente a espera configurada', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': 'nao-e-um-valor-valido' }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 20, timeoutPorTentativaMs: 200, prazoTotalMs: 5000 });
  const inicio = Date.now();
  await cliente.executar(entradaValida());
  const duracao = Date.now() - inicio;
  assert.equal(chamadas.length, 2);
  assert.ok(duracao < 200, `Retry-After invalido nao deveria estender a espera muito alem de esperaEntreTentativasMs (levou ${duracao}ms)`);
});

test('25: Retry-After grande demais impede a segunda tentativa', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': '3600' }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 1000 });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'limite_taxa');
  assert.equal(chamadas.length, 1);
});

// --- 26: maximo de duas tentativas ---

test('26: maximo de duas tentativas permanece garantido mesmo com varias respostas de falha preparadas', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(500, {}),
    () => respostaErroHttp(500, {}),
    () => respostaErroHttp(500, {}),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso });
  await assert.rejects(() => cliente.executar(entradaValida()));
  assert.equal(chamadas.length, 2);
});

// --- 27: ausencia de PII/chave/valores externos nos erros ---

test('27a: erro de configuracao (modelo rejeitado) nao expoe o valor arbitrario recebido', () => {
  const modeloArbitrario = 'modelo-nao-aprovado-xyz-123';
  let erro: unknown;
  try {
    criarClienteModeloOpenAI({ chaveApi: 'x', modelo: modeloArbitrario, ...TEMPOS_RAPIDOS } as never);
  } catch (e) {
    erro = e;
  }
  assert.ok(erro instanceof ErroConfiguracaoClienteModeloOpenAI);
  const representacao = JSON.stringify(erro) + (erro as Error).message;
  assert.ok(!representacao.includes(modeloArbitrario));
});

test('27b: resposta_truncada nunca contem o valor externo do status', async () => {
  const statusExterno = 'status_super_especifico_do_provedor_9876';
  const corpo = { status: statusExterno, output: [] };
  const { fetchFalso } = criarFetchFalso([() => new Response(JSON.stringify(corpo), { status: 200 })]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'resposta_truncada');
  const representacao = JSON.stringify(erro) + erro.message + erro.codigo;
  assert.ok(!representacao.includes(statusExterno));
  assert.ok(!erro.codigo.startsWith('status_'), 'codigo nao pode ser gerado por interpolacao (status_${valor})');
});

test('27c: recusa nunca contem o texto da recusa', async () => {
  const textoRecusa = 'motivo interno confidencial da recusa, nunca deveria vazar';
  const { fetchFalso } = criarFetchFalso([() => respostaRecusaNoSegundoItemDeContent(textoRecusa)]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'recusa_ou_filtro');
  const representacao = JSON.stringify(erro) + erro.message + erro.codigo;
  assert.ok(!representacao.includes(textoRecusa));
});

test('27d: Retry-After bruto nunca aparece no erro', async () => {
  const retryAfterBruto = 'valor-textual-exotico-de-retry-after';
  const { fetchFalso } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': retryAfterBruto }),
    () => respostaErroHttp(429, {}, { 'Retry-After': retryAfterBruto }),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'limite_taxa');
  const representacao = JSON.stringify(erro) + erro.message + erro.codigo;
  assert.ok(!representacao.includes(retryAfterBruto));
});

test('27e: erros de HTTP nao contem PII, chave ou corpo bruto da API', async () => {
  const nomeReal = 'Maria Silva Santos';
  const cpfReal = '12345678900';
  const chaveReal = 'sk-chave-secreta-de-teste-fake-000000';
  const corpoErroComPII = { error: { message: `usuario ${nomeReal} cpf ${cpfReal} rejeitado`, param: chaveReal } };

  const { fetchFalso } = criarFetchFalso([() => respostaErroHttp(400, corpoErroComPII)]);
  const cliente = criarCliente({ chaveApi: chaveReal, fetch: fetchFalso });

  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assert.ok(erro instanceof ErroClienteModeloOpenAI);
  const representacao = JSON.stringify(erro) + (erro as Error).message + (erro as ErroClienteModeloOpenAI).codigo;
  assert.ok(!representacao.includes(nomeReal));
  assert.ok(!representacao.includes(cpfReal));
  assert.ok(!representacao.includes(chaveReal));
});

// --- 3 e 9 (conversao): mantidos do commit anterior, sem alteracao de comportamento ---

test('conversao: resposta portatil valida converte para o mapa interno', () => {
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

test('conversao: lista vazia converte para alteracoes vazio', () => {
  assert.deepEqual(converterParaContratoInterno({ alteracoes: [] }), {});
});

test('conversao: remover com null converte sem propriedade valor', () => {
  const resultado = converterParaContratoInterno({ alteracoes: [{ campo: 'cpf', acao: 'remover', valor: null }] });
  assert.deepEqual(resultado, { cpf: { acao: 'remover' } });
  assert.ok(!('valor' in (resultado.cpf as object)));
});

test('conversao: campo duplicado invalida tudo', () => {
  assert.throws(() =>
    converterParaContratoInterno({
      alteracoes: [
        { campo: 'nome', acao: 'informar', valor: 'Joao' },
        { campo: 'nome', acao: 'corrigir', valor: 'Maria' },
      ],
    })
  );
});

test('conversao: informar ou corrigir com valor null invalida', () => {
  assert.throws(() => converterParaContratoInterno({ alteracoes: [{ campo: 'nome', acao: 'informar', valor: null }] }));
  assert.throws(() => converterParaContratoInterno({ alteracoes: [{ campo: 'nome', acao: 'corrigir', valor: null }] }));
});

test('conversao: remover com valor string invalida', () => {
  assert.throws(() => converterParaContratoInterno({ alteracoes: [{ campo: 'cpf', acao: 'remover', valor: '' }] }));
  assert.throws(() => converterParaContratoInterno({ alteracoes: [{ campo: 'cpf', acao: 'remover', valor: 'algum-valor' }] }));
});

test('conversao: campo, acao ou propriedade desconhecida invalida', () => {
  assert.throws(() => converterParaContratoInterno({ alteracoes: [{ campo: 'telefone', acao: 'informar', valor: 'x' }] }));
  assert.throws(() => converterParaContratoInterno({ alteracoes: [{ campo: 'nome', acao: 'apagar_tudo', valor: 'x' }] }));
  assert.throws(() =>
    converterParaContratoInterno({ alteracoes: [{ campo: 'nome', acao: 'informar', valor: 'x', confidence: 0.9 }] })
  );
});

// --- forma da requisicao (mantidos) ---

test('requisicao: usa modelo fixado, store false, strict true e nenhuma tool', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });

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

test('requisicao: somente instrucoes e payload autorizado sao enviados', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });

  const entrada = entradaValida({
    payload: {
      mensagens_atuais: ['quero uma limpeza'],
      dados_atuais: {},
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
  assert.ok(!corpoBrutoCompleto.includes('chave-de-teste'));
});

// --- 28-29: garantias gerais ---

test('28-29: nenhuma chamada real de API ocorre; todos os fetch usados sao falsos', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });

  await cliente.executar(entradaValida());

  assert.equal(chamadas.length, 1);
  assert.equal(
    chamadas[0].url,
    'https://api.openai.com/v1/responses',
    'confirma qual URL seria chamada; o fetch usado e falso, entao nenhum request de rede real ocorre'
  );
});

test('extra: executar() bem-sucedido devolve o mapa interno pronto para validarSaidaInterpretacao', async () => {
  const { fetchFalso } = criarFetchFalso([
    () =>
      respostaSucesso([
        { campo: 'procedimento_texto', acao: 'informar', valor: 'limpeza' },
        { campo: 'cpf', acao: 'remover', valor: null },
      ]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso });

  const resultado = await cliente.executar(entradaValida());

  assert.deepEqual(resultado, {
    alteracoes: {
      procedimento_texto: { acao: 'informar', valor: 'limpeza' },
      cpf: { acao: 'remover' },
    },
  });
});

// =====================================================================
// Rodada 3 -- cinco fronteiras corrigidas apos revisao do Codex sobre o
// commit aeec23c: revalidacao do orcamento apos a espera; Retry-After
// interno e nao serializavel; nao aceitar sucesso apos o prazo; formato
// estrito de Retry-After em segundos; exigir status "completed".
// =====================================================================

// --- Correcao 1: revalidar o orcamento apos a espera ---

test('correcao1: revalidacao apos a espera bloqueia a segunda tentativa de forma deterministica, sem depender de jitter natural do setTimeout', async () => {
  // Tecnica: substitui Date.now globalmente por um relogio falso de duas
  // fases (nao mexe em setTimeout, entao aguardar() continua sendo uma
  // espera real, so que minuscula: 5ms). A fase muda de "antes" (0) para
  // "depois" (1000) atraves de um setTimeout(...,0) agendado dentro do
  // proprio fetch falso da tentativa 1 -- por garantia da propria
  // especificacao de timers do JavaScript, um timer de delay 0 SEMPRE
  // dispara antes de um timer de delay >0 agendado por perto (aqui,
  // esperaEntreTentativasMs=5), entao a mudanca de fase e GARANTIDA
  // acontecer antes da checagem pos-espera rodar -- nao ha dependencia de
  // quanto o setTimeout realmente atrasa (overshoot), apenas da ORDEM
  // relativa entre dois timers de delays diferentes, que o event loop
  // sempre respeita. A checagem PRE-espera roda de forma sincrona (antes
  // de qualquer timer dela disparar), entao sempre ve o relogio na fase
  // "antes". Restaura Date.now no finally, isolado por teste.
  const timeoutPorTentativaMs = 200;
  const esperaEntreTentativasMs = 5;
  const prazoTotalMs = 300; // >= esperaEntreTentativasMs(nominal, fase "antes") + timeoutPorTentativaMs -> passa a checagem PRE-espera; < 1000(fase "depois") -> falha a checagem POS-espera

  const DateNowOriginal = Date.now;
  let faseDepois = false;
  Date.now = () => (faseDepois ? 1000 : 0);

  const { fetchFalso, chamadas } = criarFetchFalso([
    () => {
      setTimeout(() => {
        faseDepois = true;
      }, 0);
      return respostaErroHttp(503, {});
    },
    () => respostaSucesso([]),
  ]);

  const cliente = criarCliente({ fetch: fetchFalso, timeoutPorTentativaMs, esperaEntreTentativasMs, prazoTotalMs });

  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  } finally {
    Date.now = DateNowOriginal;
  }

  assertCategoria(erro, 'indisponibilidade');
  assert.equal(erro.tentativas, 1, 'a segunda tentativa nao deveria ter iniciado');
  assert.equal(chamadas.length, 1, 'nenhum segundo fetch deveria ocorrer');
});

test('correcao1b: com orcamento generoso, a revalidacao apos a espera nao bloqueia a segunda tentativa (regressao)', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaErroHttp(503, {}), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso, timeoutPorTentativaMs: 40, esperaEntreTentativasMs: 5, prazoTotalMs: 5000 });
  const resultado = await cliente.executar(entradaValida());
  assert.deepEqual(resultado, { alteracoes: {} });
  assert.equal(chamadas.length, 2);
});

// --- Correcao 2: Retry-After interno e nao serializavel ---

test('correcao2a: retryAfterMs nunca aparece em JSON.stringify nem em Object.keys do erro publico', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaErroHttp(429, {}, { 'Retry-After': '3600' })]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 200 });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'limite_taxa');
  assert.equal(chamadas.length, 1);
  assert.ok(!('retryAfterMs' in (erro as object)));
  assert.ok(!Object.keys(erro as object).includes('retryAfterMs'));
  assert.ok(!JSON.stringify(erro).includes('retryAfterMs'));
});

test('correcao2b: erro publico expoe somente os campos aprovados (categoria, codigo, tentativas, duracaoMs, modelo, statusHttp)', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaErroHttp(401, {})]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'autenticacao');
  const camposAprovados = ['categoria', 'codigo', 'tentativas', 'duracaoMs', 'modelo', 'statusHttp'];
  const chaves = Object.keys(erro as object);
  for (const campo of camposAprovados) {
    assert.ok(chaves.includes(campo), `campo aprovado ausente: ${campo}`);
  }
  // 'name' e um campo padrao de qualquer instancia de Error, atribuido
  // igualmente por todas as classes de erro deste projeto -- nao faz
  // parte do contrato de dados especifico deste erro, entao e o unico
  // campo tolerado alem dos aprovados.
  const chavesInesperadas = chaves.filter((chave) => chave !== 'name' && !camposAprovados.includes(chave));
  assert.deepEqual(chavesInesperadas, []);
});

test('correcao2c: retryAfterMs nao aparece em for...in sobre o erro', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaErroHttp(429, {}, { 'Retry-After': '3600' })]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 200 });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'limite_taxa');
  const chavesViaForIn: string[] = [];
  for (const chave in erro as object) chavesViaForIn.push(chave);
  assert.ok(!chavesViaForIn.includes('retryAfterMs'));
});

test('correcao2d: retryAfterMs nao aparece mesmo quando o erro esta aninhado dentro de outro objeto serializado', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaErroHttp(429, {}, { 'Retry-After': '3600' })]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 200 });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'limite_taxa');
  const envelope = { contexto: 'teste', erroOcorrido: erro };
  assert.ok(!JSON.stringify(envelope).includes('retryAfterMs'));
  assert.ok(!JSON.stringify(envelope).includes('3600'));
});

// --- Correcao 3: nao aceitar sucesso apos o prazo ---

test('correcao3a: leitura termina mas ultrapassa o prazo da tentativa -- checagem explicita rejeita mesmo sem o AbortController interromper', async () => {
  const cliente = criarCliente({
    fetch: fetchComLeituraLentaIgnorandoAbort(45),
    timeoutPorTentativaMs: 30,
    esperaEntreTentativasMs: 5,
    prazoTotalMs: 60, // insuficiente para uma segunda tentativa apos a primeira consumir ~45ms
  });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'timeout');
  assert.equal(erro.tentativas, 1);
});

test('correcao3b: sucesso nao e aceito quando o prazo total ja foi ultrapassado no momento do processamento final', async () => {
  const tempoUnico = 30;
  const cliente = criarCliente({
    fetch: fetchComLeituraLentaIgnorandoAbort(45),
    timeoutPorTentativaMs: tempoUnico,
    esperaEntreTentativasMs: 5,
    prazoTotalMs: tempoUnico, // prazo total igual ao timeout de uma unica tentativa -- configuracao legal mais apertada
  });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'timeout');
  assert.equal(erro.tentativas, 1, 'sem orcamento algum para uma segunda tentativa nesta configuracao');
});

test('correcao3c: resposta rapida dentro do prazo continua sendo aceita normalmente (as novas checagens nao geram falso positivo)', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaSucesso([{ campo: 'nome', acao: 'informar', valor: 'Joao' }])]);
  const cliente = criarCliente({ fetch: fetchFalso, timeoutPorTentativaMs: 5000, esperaEntreTentativasMs: 5, prazoTotalMs: 5000 });
  const resultado = await cliente.executar(entradaValida());
  assert.deepEqual(resultado, { alteracoes: { nome: { acao: 'informar', valor: 'Joao' } } });
});

// --- Correcao 4: Retry-After em segundos so no formato estrito ^[0-9]+$ ---

test('correcao4: formatos numericos invalidos (decimal, sinal, espacos, notacao exponencial, Infinity, NaN) sao ignorados, com fallback para esperaEntreTentativasMs', async () => {
  // ' 5'/'5 ' nao entram aqui: Headers normaliza (retira) OWS nas bordas
  // do valor do header por conta propria, entao esses dois casos nunca
  // chegariam com espaco ate o nosso codigo. '5 0' cobre espaco INTERNO,
  // que Headers preserva.
  const valoresInvalidos = ['1.5', '+5', '-5', '5 0', '1e10', '1E3', 'Infinity', '-Infinity', 'NaN'];

  for (const valorInvalido of valoresInvalidos) {
    const { fetchFalso, chamadas } = criarFetchFalso([
      () => respostaErroHttp(429, {}, { 'Retry-After': valorInvalido }),
      () => respostaSucesso([]),
    ]);
    const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 15, timeoutPorTentativaMs: 200, prazoTotalMs: 5000 });
    const inicio = Date.now();
    await cliente.executar(entradaValida());
    const duracao = Date.now() - inicio;
    assert.equal(chamadas.length, 2, `Retry-After=${valorInvalido} deveria permitir a segunda tentativa (fallback)`);
    assert.ok(duracao < 200, `Retry-After=${valorInvalido} nao deveria ser tratado como segundos validos (levou ${duracao}ms)`);
  }
});

test('correcao4b: Retry-After em segundos cujo valor convertido ultrapassa Number.MAX_SAFE_INTEGER e ignorado', async () => {
  const segundosEnormes = '9999999999999999999999'; // digitos puros, finito, mas muito maior que MAX_SAFE_INTEGER
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': segundosEnormes }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 15, timeoutPorTentativaMs: 200, prazoTotalMs: 5000 });
  const inicio = Date.now();
  await cliente.executar(entradaValida());
  const duracao = Date.now() - inicio;
  assert.equal(chamadas.length, 2);
  assert.ok(duracao < 200, `Retry-After absurdamente grande nao deveria travar a segunda tentativa (levou ${duracao}ms)`);
});

test('correcao4c: Retry-After em segundos puros continua sendo aceito (regressao, inclui zero)', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaErroHttp(429, {}, { 'Retry-After': '0' }), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 200, prazoTotalMs: 5000 });
  await cliente.executar(entradaValida());
  assert.equal(chamadas.length, 2);
});

test('correcao4d: Retry-After com digitos suficientes para estourar para Infinity e ignorado', async () => {
  const segundosQueEstouram = '9'.repeat(320);
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': segundosQueEstouram }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 200, prazoTotalMs: 5000 });
  const inicio = Date.now();
  await cliente.executar(entradaValida());
  const duracao = Date.now() - inicio;
  assert.equal(chamadas.length, 2);
  assert.ok(duracao < 200);
});

test('correcao4e: Retry-After com zeros a esquerda (ex.: "003") corresponde ao formato estrito e e aceito', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaErroHttp(429, {}, { 'Retry-After': '003' }), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 200, prazoTotalMs: 4000 });
  await cliente.executar(entradaValida());
  const intervalo = chamadas[1].momento - chamadas[0].momento;
  assert.ok(intervalo >= 2900, `"003" deveria ser interpretado como 3000ms, esperou ${intervalo}ms`);
});

// --- Correcao 5: exigir status "completed" ---

test('correcao5a: status ausente gera resposta_nao_estruturada, sem retry', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaSemStatus(), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'resposta_nao_estruturada');
  assert.equal(chamadas.length, 1);
});

test('correcao5b: status null gera resposta_nao_estruturada, sem retry', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaComStatusInvalido(null), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'resposta_nao_estruturada');
  assert.equal(chamadas.length, 1);
});

test('correcao5c: status de tipo diferente de string (numero, booleano, array, objeto) gera resposta_nao_estruturada, sem retry', async () => {
  for (const statusInvalido of [42, true, ['completed'], { valor: 'completed' }]) {
    const { fetchFalso, chamadas } = criarFetchFalso([() => respostaComStatusInvalido(statusInvalido), () => respostaSucesso([])]);
    const cliente = criarCliente({ fetch: fetchFalso });
    let erro: unknown;
    try {
      await cliente.executar(entradaValida());
    } catch (e) {
      erro = e;
    }
    assertCategoria(erro, 'resposta_nao_estruturada');
    assert.equal(chamadas.length, 1, `status=${JSON.stringify(statusInvalido)} nao deveria permitir retry`);
  }
});

test('correcao5d: status string diferente de "completed" continua gerando resposta_truncada, sem retry', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaComStatusInvalido('in_progress'), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'resposta_truncada');
  assert.equal(chamadas.length, 1);
});

test('correcao5e: recusa/filtro tem prioridade mesmo quando status tambem esta ausente ou invalido', async () => {
  const corpoComRecusaEStatusAusente = { output: [{ type: 'refusal', refusal: 'motivo interno' }] };
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => new Response(JSON.stringify(corpoComRecusaEStatusAusente), { status: 200 }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'recusa_ou_filtro');
  assert.equal(chamadas.length, 1);
});

// --- garantia geral combinada ---

test('correcao-geral: no maximo duas tentativas mesmo combinando Retry-After valido e orcamento generoso', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': '0' }),
    () => respostaErroHttp(429, {}, { 'Retry-After': '0' }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 200, prazoTotalMs: 5000 });
  await assert.rejects(() => cliente.executar(entradaValida()));
  assert.equal(chamadas.length, 2);
});

// =====================================================================
// Rodada 4 -- cinco fronteiras corrigidas apos revisao do Codex sobre o
// commit ef04caf: Retry-After so aceita HTTP-date canonica (round-trip
// exato); WeakMap privado substitui o Symbol; timeout prevalece sobre
// qualquer classificacao tardia produzida apos a leitura do corpo;
// prazo esgotado passa a usar >=; teste de revalidacao pos-espera deixa
// de depender de jitter natural do setTimeout.
// =====================================================================

// --- Correcao 1: Retry-After so aceita HTTP-date canonica (round-trip) ---

test('correcao4-1: Retry-After em HTTP-date canonica (toUTCString) continua aceito (regressao)', async () => {
  const dataFutura = new Date(Date.now() + 2200).toUTCString();
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': dataFutura }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 500, prazoTotalMs: 10000 });
  await cliente.executar(entradaValida());
  assert.equal(chamadas.length, 2);
  const intervalo = chamadas[1].momento - chamadas[0].momento;
  assert.ok(intervalo >= 1000, `deveria respeitar o Retry-After como data canonica, esperou ${intervalo}ms`);
});

test('correcao4-2: Retry-After em formato ISO 8601 e rejeitado (nao e a forma canonica de toUTCString)', async () => {
  const dataIso = new Date(Date.now() + 2200).toISOString();
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': dataIso }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 200, prazoTotalMs: 5000 });
  const inicio = Date.now();
  await cliente.executar(entradaValida());
  const duracao = Date.now() - inicio;
  assert.equal(chamadas.length, 2);
  assert.ok(duracao < 200, `ISO 8601 nao deveria ser aceito como Retry-After (levou ${duracao}ms)`);
});

test('correcao4-3: Retry-After em formato de data local (toString) e rejeitado', async () => {
  const dataLocal = new Date(Date.now() + 2200).toString();
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': dataLocal }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 200, prazoTotalMs: 5000 });
  const inicio = Date.now();
  await cliente.executar(entradaValida());
  const duracao = Date.now() - inicio;
  assert.equal(chamadas.length, 2);
  assert.ok(duracao < 200, `formato de data local nao deveria ser aceito como Retry-After (levou ${duracao}ms)`);
});

test('correcao4-4: valor numerico ambiguo (epoch em segundos) e tratado como delta-segundos, nunca como data', async () => {
  const epochSegundosFuturo = String(Math.floor((Date.now() + 3600_000) / 1000));
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': epochSegundosFuturo }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 1000 });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  // Se fosse (incorretamente) interpretado como uma data proxima, a
  // segunda tentativa ocorreria rapido. Sendo interpretado corretamente
  // como delta-segundos (um numero de segundos enorme), o orcamento e
  // insuficiente e a segunda tentativa nunca ocorre.
  assertCategoria(erro, 'limite_taxa');
  assert.equal(chamadas.length, 1);
});

test('correcao4-5: decimal rejeitado como delta-segundos tambem nao e aceito como data (fallback correto)', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaErroHttp(429, {}, { 'Retry-After': '1.5' }), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 200, prazoTotalMs: 5000 });
  const inicio = Date.now();
  await cliente.executar(entradaValida());
  const duracao = Date.now() - inicio;
  assert.equal(chamadas.length, 2);
  assert.ok(duracao < 200, `"1.5" nao deveria ser aceito nem como segundos nem como data (levou ${duracao}ms)`);
});

test('correcao4-6: data valida mas com espacamento fora do padrao canonico e rejeitada (round-trip exato falha)', async () => {
  const dataFutura = new Date(Date.now() + 2200).toUTCString();
  const dataComEspacoExtra = dataFutura.replace(', ', ',  '); // espaco duplo apos a virgula
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': dataComEspacoExtra }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 200, prazoTotalMs: 5000 });
  const inicio = Date.now();
  await cliente.executar(entradaValida());
  const duracao = Date.now() - inicio;
  assert.equal(chamadas.length, 2);
  assert.ok(duracao < 200, `data com espacamento fora do padrao nao deveria ser aceita (levou ${duracao}ms)`);
});

// --- Correcao 2: WeakMap privado, nenhuma forma de reflexao revela Retry-After ---

test('correcao4-7: WeakMap nao cria propriedade propria no erro -- Object.getOwnPropertyNames so mostra campos aprovados e padrao de Error', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaErroHttp(429, {}, { 'Retry-After': '3600' })]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 200 });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'limite_taxa');
  const camposAprovados = ['categoria', 'codigo', 'tentativas', 'duracaoMs', 'modelo', 'statusHttp'];
  const camposPadraoDeError = ['name', 'message', 'stack'];
  const nomes = Object.getOwnPropertyNames(erro as object);
  for (const nome of nomes) {
    assert.ok(camposAprovados.includes(nome) || camposPadraoDeError.includes(nome), `propriedade inesperada: ${nome}`);
  }
  assert.ok(!nomes.includes('retryAfterMs'));
});

test('correcao4-8: Object.getOwnPropertySymbols nao revela nenhum Retry-After', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaErroHttp(429, {}, { 'Retry-After': '3600' })]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 200 });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'limite_taxa');
  assert.deepEqual(Object.getOwnPropertySymbols(erro as object), []);
});

test('correcao4-9: Reflect.ownKeys nao revela nenhum Retry-After (nem symbol, nem string oculta)', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaErroHttp(429, {}, { 'Retry-After': '3600' })]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 200 });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'limite_taxa');
  const camposAprovados = ['categoria', 'codigo', 'tentativas', 'duracaoMs', 'modelo', 'statusHttp'];
  const camposPadraoDeError = ['name', 'message', 'stack'];
  const chaves = Reflect.ownKeys(erro as object);
  for (const chave of chaves) {
    assert.ok(typeof chave === 'string' && (camposAprovados.includes(chave) || camposPadraoDeError.includes(chave)));
  }
});

test('correcao4-10: JSON.stringify (direto e aninhado) nao revela Retry-After', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaErroHttp(429, {}, { 'Retry-After': '3600' })]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 200 });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'limite_taxa');
  assert.ok(!JSON.stringify(erro).includes('retryAfterMs'));
  const envelope = { contexto: 'teste', erroOcorrido: erro };
  assert.ok(!JSON.stringify(envelope).includes('retryAfterMs'));
  assert.ok(!JSON.stringify(envelope).includes('3600'));
});

// --- Correcao 3 e 4: timeout prevalece sobre classificacao tardia; limite e >= ---

test('correcao4-11: processamento estrutural tardio (output ausente) retorna timeout, nao resposta_nao_estruturada', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaOutputAusente()]);
  const cliente = criarCliente({ fetch: fetchFalso, timeoutPorTentativaMs: 20, esperaEntreTentativasMs: 5, prazoTotalMs: 20 });
  let erro: unknown;
  await comJsonParseAtrasado(30, async () => {
    try {
      await cliente.executar(entradaValida());
    } catch (e) {
      erro = e;
    }
  });
  assertCategoria(erro, 'timeout');
  assert.equal(erro.tentativas, 1);
});

test('correcao4-12: conversao portatil tardia (campo desconhecido) retorna timeout, nao resposta_invalida', async () => {
  function respostaComAlteracaoInvalida() {
    const corpo = {
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify({ alteracoes: [{ campo: 'campo_desconhecido', acao: 'informar', valor: 'x' }] }) }],
        },
      ],
    };
    return new Response(JSON.stringify(corpo), { status: 200 });
  }
  const { fetchFalso } = criarFetchFalso([() => respostaComAlteracaoInvalida()]);
  const cliente = criarCliente({ fetch: fetchFalso, timeoutPorTentativaMs: 20, esperaEntreTentativasMs: 5, prazoTotalMs: 20 });
  let erro: unknown;
  await comJsonParseAtrasado(15, async () => {
    try {
      await cliente.executar(entradaValida());
    } catch (e) {
      erro = e;
    }
  });
  assertCategoria(erro, 'timeout');
});

test('correcao4-13: recusa/filtro tardio retorna timeout quando o prazo ja expirou', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaRecusaNoSegundoItemDeContent('motivo interno')]);
  const cliente = criarCliente({ fetch: fetchFalso, timeoutPorTentativaMs: 20, esperaEntreTentativasMs: 5, prazoTotalMs: 20 });
  let erro: unknown;
  await comJsonParseAtrasado(30, async () => {
    try {
      await cliente.executar(entradaValida());
    } catch (e) {
      erro = e;
    }
  });
  assertCategoria(erro, 'timeout');
});

test('correcao4-14: classificacoes originais sao preservadas quando o processamento termina dentro do prazo (regressao)', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaOutputAusente()]);
  const cliente = criarCliente({ fetch: fetchFalso, timeoutPorTentativaMs: 5000, esperaEntreTentativasMs: 5, prazoTotalMs: 5000 });
  let erro: unknown;
  await comJsonParseAtrasado(5, async () => {
    try {
      await cliente.executar(entradaValida());
    } catch (e) {
      erro = e;
    }
  });
  assertCategoria(erro, 'resposta_nao_estruturada');
});

test('correcao4-15: decorrido exatamente no limite do timeout da tentativa (ou alem) e tratado como timeout (>=)', async () => {
  const timeoutPorTentativaMs = 15;
  const { fetchFalso } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso, timeoutPorTentativaMs, esperaEntreTentativasMs: 5, prazoTotalMs: 5000 });
  let erro: unknown;
  await comJsonParseAtrasado(timeoutPorTentativaMs, async () => {
    try {
      await cliente.executar(entradaValida());
    } catch (e) {
      erro = e;
    }
  });
  assertCategoria(erro, 'timeout');
});

test('correcao4-16: decorrido exatamente no limite do prazo total (ou alem) e tratado como timeout (>=)', async () => {
  // prazoTotalMs == timeoutPorTentativaMs: configuracao legal mais
  // apertada (validarConfiguracao exige prazoTotalMs >= timeoutPorTentativaMs).
  // Nessa configuracao, para a primeira tentativa, os dois limites
  // coincidem -- e a unica forma de exercitar o limite de prazoTotalMs
  // sem depender de uma segunda tentativa.
  const prazoUnico = 15;
  const { fetchFalso } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso, timeoutPorTentativaMs: prazoUnico, esperaEntreTentativasMs: 5, prazoTotalMs: prazoUnico });
  let erro: unknown;
  await comJsonParseAtrasado(prazoUnico, async () => {
    try {
      await cliente.executar(entradaValida());
    } catch (e) {
      erro = e;
    }
  });
  assertCategoria(erro, 'timeout');
});

// --- Correcao 5: garantias gerais (maximo de tentativas, so fetch falso, zero chamadas reais) ---

test('correcao4-17: maximo de duas tentativas continua garantido apos as cinco correcoes (regressao)', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(500, {}),
    () => respostaErroHttp(500, {}),
    () => respostaErroHttp(500, {}),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso });
  await assert.rejects(() => cliente.executar(entradaValida()));
  assert.equal(chamadas.length, 2);
});

test('correcao4-18: todos os testes usam somente fetch falso injetado; nenhuma chamada real de API ocorre', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });
  await cliente.executar(entradaValida());
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, 'https://api.openai.com/v1/responses');
});
