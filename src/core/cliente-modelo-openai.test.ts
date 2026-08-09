// Testes de unidade do adaptador OpenAI usando um FETCH FALSO injetado —
// nenhuma chamada real de API ocorre em nenhum teste deste arquivo.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
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

function respostaSucesso(
  alteracoesPortatil: unknown[],
  usage: Record<string, number> = { input_tokens: 1, output_tokens: 1 },
  naturezaMensagem: string = 'pedido'
) {
  const corpo = {
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [
          { type: 'output_text', text: JSON.stringify({ natureza_mensagem: naturezaMensagem, alteracoes: alteracoesPortatil }) },
        ],
      },
    ],
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
    payload: { mensagens_atuais: ['quero uma limpeza'], dados_atuais: {}, campos_cadastrais_preenchidos: [] },
    ...overrides,
  } as never;
}

// timeoutPorTentativaMs era 60 e causava falha intermitente na suite
// completa (nao isolada): ~40 testes deste arquivo usam este default sem
// nenhum controle de Date.now/timers (diferente dos testes de precisao de
// timeout, que sempre sobrescrevem timeoutPorTentativaMs explicitamente e/ou
// controlam o relogio) -- um AbortController real de 60ms competindo com
// promises reais sob carga da suite inteira (varios arquivos de teste
// concorrentes) e uma corrida genuina, nao um bug de logica. Investigado em
// 2026-08-05: arquivo isolado sempre passa (90/90); 3 execucoes seguidas da
// suite completa depois do ajuste passaram com 0 falhas. Valor elevado para
// dar margem real contra jitter de agendamento do SO, sem afetar os testes
// que ja controlam o relogio ou que sobrescrevem este campo por conta propria.
const TEMPOS_RAPIDOS = {
  timeoutPorTentativaMs: 2000,
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
    assert.deepEqual(resultado, { natureza_mensagem: 'pedido', alteracoes: {} });
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

test('22: Retry-After em segundos e respeitado -- provado por orcamento, sem espera real', async () => {
  // Retry-After: "1" -> 1000ms de espera aplicavel. Com prazoTotalMs=1000
  // (insuficiente para comportar espera(1000)+tentativa completa(100)), o
  // gate de orcamento -- que roda ANTES de qualquer espera real -- bloqueia
  // a segunda tentativa. Uma unica chamada prova que "1" foi interpretado
  // como 1000ms, sem nunca esperar de verdade.
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': '1' }),
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
  assert.equal(erro.tentativas, 1, '"1" deveria ser interpretado como 1000ms de espera, orcamento insuficiente para a segunda tentativa');
  assert.equal(chamadas.length, 1);
});

// Teste 23 (Retry-After como data HTTP e respeitado) foi removido: a
// mesma garantia -- HTTP-date canonica aceita, provada sem nenhuma espera
// real -- ja e demonstrada deterministicamente por correcao4-1 (secao
// isolada ao final do arquivo, relogio congelado + orcamento insuficiente).

// Teste 24 (Retry-After invalido usa somente a espera configurada) foi
// removido: a mesma garantia -- formato invalido cai para o fallback,
// provado por duas chamadas ao fetch, sem medir duracao -- ja e coberta
// por correcao4 (loop, secao isolada, agora incluindo o texto arbitrario
// "nao-e-um-valor-valido" que esse teste usava) e por correcao4-5
// (decimal "1.5", com Date.parse controlado para o pior caso).

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
      { campo: 'procedimento_id', acao: 'corrigir', valor: 'limpeza' },
    ],
  });
  assert.deepEqual(resultado, {
    nome: { acao: 'informar', valor: 'Joao' },
    procedimento_id: { acao: 'corrigir', valor: 'limpeza' },
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

test('conversao: confirmacao sim converte para o mapa interno', () => {
  const resultado = converterParaContratoInterno({ alteracoes: [{ campo: 'confirmacao', acao: 'informar', valor: 'sim' }] });
  assert.deepEqual(resultado, { confirmacao: { acao: 'informar', valor: 'sim' } });
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

test('requisicao: schema enviado inclui confirmacao no enum de campo', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });

  await cliente.executar(entradaValida());

  const corpo = JSON.parse(chamadas[0].opcoes.body as string);
  const enumCampo = corpo.text.format.schema.properties.alteracoes.items.properties.campo.enum;
  assert.ok(enumCampo.includes('confirmacao'));
});

test('requisicao: somente instrucoes e payload autorizado sao enviados', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });

  const entrada = entradaValida({
    payload: {
      mensagens_atuais: ['quero uma limpeza'],
      dados_atuais: {},
      campos_cadastrais_preenchidos: [],
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
  assert.deepEqual(Object.keys(payloadEnviado).sort(), [
    'campos_cadastrais_preenchidos',
    'dados_atuais',
    'mensagens_atuais',
  ]);

  const corpoBrutoCompleto = JSON.stringify(corpo);
  assert.ok(!corpoBrutoCompleto.includes('clinica-x'));
  assert.ok(!corpoBrutoCompleto.includes('conversa-x'));
  assert.ok(!corpoBrutoCompleto.includes('paciente-x'));
  assert.ok(!corpoBrutoCompleto.includes('5511999999999'));
  assert.ok(!corpoBrutoCompleto.includes('chave-de-teste'));
});

// --- Propagacao dos indicadores cadastrais ate o corpo HTTP ---
//
// Todos os cenarios abaixo inspecionam o conteudo EFETIVAMENTE
// SERIALIZADO no body do fetch, nunca o objeto intermediario.
// Dados sinteticos (specs/interpretacao-ia.md, "Entrada e PII").

const NOME_SINTETICO_HTTP = 'Zulmira Quaresma Bettencourt';
const CPF_SINTETICO_HTTP = '52998224725';
const NASCIMENTO_SINTETICO_HTTP = '1974-03-19';
const EMAIL_SINTETICO_HTTP = 'zulmira.bettencourt@exemplo-sintetico.test';

async function payloadHttpDe(payload: Record<string, unknown>) {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });

  await cliente.executar(entradaValida({ payload }));

  const corpoBruto = chamadas[0].opcoes.body as string;
  const corpo = JSON.parse(corpoBruto);
  const mensagemUsuario = corpo.input.find((m: { role: string }) => m.role === 'user');
  return { payloadEnviado: JSON.parse(mensagemUsuario.content), corpoBruto };
}

test('http: campos_cadastrais_preenchidos chega ao corpo serializado, com a ordem preservada', async () => {
  const { payloadEnviado } = await payloadHttpDe({
    mensagens_atuais: ['oi'],
    dados_atuais: {},
    campos_cadastrais_preenchidos: ['nome', 'cpf', 'data_nascimento', 'email'],
  });

  assert.deepEqual(payloadEnviado.campos_cadastrais_preenchidos, ['nome', 'cpf', 'data_nascimento', 'email']);
});

test('http: array vazio e enviado quando nenhum campo cadastral esta preenchido', async () => {
  const { payloadEnviado } = await payloadHttpDe({
    mensagens_atuais: ['oi'],
    dados_atuais: {},
    campos_cadastrais_preenchidos: [],
  });

  assert.deepEqual(payloadEnviado.campos_cadastrais_preenchidos, []);
  assert.ok(Array.isArray(payloadEnviado.campos_cadastrais_preenchidos));
});

test('http: preenchimento parcial e enviado exatamente como derivado', async () => {
  const { payloadEnviado } = await payloadHttpDe({
    mensagens_atuais: ['oi'],
    dados_atuais: {},
    campos_cadastrais_preenchidos: ['nome', 'email'],
  });

  assert.deepEqual(payloadEnviado.campos_cadastrais_preenchidos, ['nome', 'email']);
});

test('http: dados_atuais continua contendo apenas campos operacionais', async () => {
  const { payloadEnviado } = await payloadHttpDe({
    mensagens_atuais: ['oi'],
    dados_atuais: { intencao: 'novo_agendamento', procedimento_id: 'limpeza' },
    campos_cadastrais_preenchidos: ['nome', 'cpf'],
  });

  assert.deepEqual(payloadEnviado.dados_atuais, {
    intencao: 'novo_agendamento',
    procedimento_id: 'limpeza',
  });
  for (const proibido of ['nome', 'cpf', 'data_nascimento', 'email', 'telefone']) {
    assert.ok(!(proibido in payloadEnviado.dados_atuais));
  }
});

test('http: nenhum valor cadastral oficial aparece no JSON final, mesmo com todos os indicadores', async () => {
  const { corpoBruto } = await payloadHttpDe({
    mensagens_atuais: ['quero remarcar'],
    dados_atuais: {},
    campos_cadastrais_preenchidos: ['nome', 'cpf', 'data_nascimento', 'email'],
  });

  for (const valor of [
    NOME_SINTETICO_HTTP,
    CPF_SINTETICO_HTTP,
    '529.982.247-25',
    NASCIMENTO_SINTETICO_HTTP,
    '19/03/1974',
    EMAIL_SINTETICO_HTTP,
    '5511999999999',
  ]) {
    assert.ok(!corpoBruto.includes(valor), 'valor cadastral nao pode aparecer no corpo HTTP');
  }
});

test('http: nenhuma propriedade adicional do payload e serializada', async () => {
  const { payloadEnviado } = await payloadHttpDe({
    mensagens_atuais: ['oi'],
    dados_atuais: {},
    campos_cadastrais_preenchidos: ['nome'],
    pendente: 'opcao',
    eventos_candidatos: [{ tipo: 'aceitar_opcao' }],
    paciente_id: 'paciente-y',
  });

  assert.deepEqual(Object.keys(payloadEnviado).sort(), [
    'campos_cadastrais_preenchidos',
    'dados_atuais',
    'mensagens_atuais',
  ]);
  assert.ok(!('pendente' in payloadEnviado));
  assert.ok(!('eventos_candidatos' in payloadEnviado));
});

test('http: mensagem atual permanece presente e intacta no corpo serializado', async () => {
  const mensagens = ['meu nome e Zulmira Quaresma Bettencourt', 'quero uma limpeza'];
  const { payloadEnviado } = await payloadHttpDe({
    mensagens_atuais: mensagens,
    dados_atuais: {},
    campos_cadastrais_preenchidos: ['nome'],
  });

  assert.deepEqual(payloadEnviado.mensagens_atuais, mensagens);
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
        { campo: 'procedimento_id', acao: 'informar', valor: 'limpeza' },
        { campo: 'cpf', acao: 'remover', valor: null },
      ]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso });

  const resultado = await cliente.executar(entradaValida());

  assert.deepEqual(resultado, {
    natureza_mensagem: 'pedido',
    alteracoes: {
      procedimento_id: { acao: 'informar', valor: 'limpeza' },
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

test(
  'correcao1: revalidacao apos a espera bloqueia a segunda tentativa -- provado observando os proprios timers falsos (setTimeout/clearTimeout) do node:test, sem contagem arbitraria de microtarefas',
  async (t) => {
    // t.mock.timers.enable() mocka setTimeout/clearTimeout e Date juntos:
    // t.mock.timers.tick(ms) dispara os timers cujo prazo caiba dentro de
    // ms E avanca Date.now() pela mesma quantia, na mesma operacao
    // atomica -- sem nenhuma espera real. O node:test restaura os timers
    // reais automaticamente ao fim deste teste.
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });

    const timeoutPorTentativaMs = 100;
    const esperaEntreTentativasMs = 50;
    // No instante 0, esperaEntreTentativasMs(50)+timeoutPorTentativaMs(100)
    // = 150 <= prazoTotalMs(200) -> a checagem PRE-espera passa com folga.
    const prazoTotalMs = 200;

    // Captura as referencias JA FALSIFICADAS por t.mock.timers.enable
    // (nao as reais -- enable() ja rodou acima) -- os wrappers abaixo
    // existem so para OBSERVAR delay/handle de cada chamada, delegando
    // sempre para essas referencias falsas capturadas.
    const setTimeoutFalso = globalThis.setTimeout;
    const clearTimeoutFalso = globalThis.clearTimeout;

    let handleTentativa1: unknown = null;
    let timeoutTentativa1Cancelado = false;
    let timerEsperaRegistrado = false;
    let resolverBarreira!: () => void;
    // Barreira OBSERVAVEL: resolve somente quando os proprios timers
    // falsos confirmam as duas condicoes abaixo -- nenhuma contagem fixa
    // de microtarefas, nenhum pressuposto sobre ordem de agendamento.
    const barreiraTimersObservados = new Promise<void>((resolve) => {
      resolverBarreira = resolve;
    });

    function verificarBarreira(): void {
      if (timeoutTentativa1Cancelado && timerEsperaRegistrado) resolverBarreira();
    }

    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      const handle = setTimeoutFalso(fn as never, delay, ...args);
      if (delay === timeoutPorTentativaMs && handleTentativa1 === null) {
        handleTentativa1 = handle; // timer de abort da tentativa 1
      } else if (delay === esperaEntreTentativasMs) {
        timerEsperaRegistrado = true; // timer interno de aguardar()
        verificarBarreira();
      }
      return handle;
    }) as typeof setTimeout;

    globalThis.clearTimeout = ((handle: unknown) => {
      if (handleTentativa1 !== null && handle === handleTentativa1) {
        timeoutTentativa1Cancelado = true;
        verificarBarreira();
      }
      return clearTimeoutFalso(handle as never);
    }) as typeof clearTimeout;

    try {
      const { fetchFalso, chamadas } = criarFetchFalso([() => respostaErroHttp(503, {}), () => respostaSucesso([])]);
      const cliente = criarCliente({ fetch: fetchFalso, timeoutPorTentativaMs, esperaEntreTentativasMs, prazoTotalMs });

      const promessa = cliente.executar(entradaValida());
      promessa.catch(() => {}); // evita aviso de rejeicao nao tratada entre a criacao e o await final

      await barreiraTimersObservados;

      // Confirma ANTES do tick, via os timers falsos observados (nao via
      // duracao nem contagem de microtarefas):
      assert.equal(chamadas.length, 1, 'exatamente um fetch deveria ter ocorrido antes do tick');
      assert.equal(
        timeoutTentativa1Cancelado,
        true,
        'o timeout (abort) da tentativa 1 deveria ter sido cancelado (clearTimeout) antes do tick'
      );
      assert.equal(
        timerEsperaRegistrado,
        true,
        'o timer de aguardar(esperaEntreTentativasMs) deveria ter sido registrado antes do tick -- prova que a checagem PRE-espera permitiu chegar a espera, em vez de bloquear sincronamente'
      );

      // Avanca o relogio falso muito alem do orcamento disponivel: 200 e
      // mais que suficiente para disparar o timer da espera (50ms) E, na
      // mesma operacao, avancar Date.now() para 200 -- fazendo a checagem
      // POS-espera (que roda logo depois do timer disparar) enxergar um
      // relogio ja alem do prazo total (200), sem sobrar timeoutPorTentativaMs
      // completo.
      t.mock.timers.tick(200);

      let erro: unknown;
      try {
        await promessa;
      } catch (e) {
        erro = e;
      }

      assertCategoria(erro, 'indisponibilidade');
      assert.equal(erro.tentativas, 1, 'a segunda tentativa nao deveria ter iniciado');
      assert.equal(chamadas.length, 1, 'nenhum segundo fetch deveria ocorrer');
    } finally {
      globalThis.setTimeout = setTimeoutFalso;
      globalThis.clearTimeout = clearTimeoutFalso;
    }
  }
);

test('correcao1b: com orcamento generoso, a revalidacao apos a espera nao bloqueia a segunda tentativa (regressao)', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaErroHttp(503, {}), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso, timeoutPorTentativaMs: 40, esperaEntreTentativasMs: 5, prazoTotalMs: 5000 });
  const resultado = await cliente.executar(entradaValida());
  assert.deepEqual(resultado, { natureza_mensagem: 'pedido', alteracoes: {} });
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
  assert.deepEqual(resultado, {
    natureza_mensagem: 'pedido',
    alteracoes: { nome: { acao: 'informar', valor: 'Joao' } },
  });
});

// --- Correcao 4: Retry-After em segundos so no formato estrito ^[0-9]+$ ---
//
// O teste com a lista completa de formatos numericos invalidos (correcao4)
// agora usa Date.parse controlado para provar rejeicao mesmo no pior caso
// -- fica na secao isolada ao final do arquivo.

test('correcao4b: Retry-After em segundos cujo valor convertido ultrapassa Number.MAX_SAFE_INTEGER e ignorado -- provado por chamadas, sem duracao', async () => {
  const segundosEnormes = '9999999999999999999999'; // digitos puros, finito, mas muito maior que MAX_SAFE_INTEGER
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': segundosEnormes }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 15, timeoutPorTentativaMs: 200, prazoTotalMs: 5000 });
  await cliente.executar(entradaValida());
  assert.equal(chamadas.length, 2, 'valor acima de MAX_SAFE_INTEGER deveria ser ignorado, permitindo a segunda tentativa via fallback');
});

test('correcao4c: Retry-After em segundos puros continua sendo aceito (regressao, inclui zero)', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaErroHttp(429, {}, { 'Retry-After': '0' }), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 200, prazoTotalMs: 5000 });
  await cliente.executar(entradaValida());
  assert.equal(chamadas.length, 2);
});

test('correcao4d: Retry-After com digitos suficientes para estourar para Infinity e ignorado -- provado por chamadas, sem duracao', async () => {
  const segundosQueEstouram = '9'.repeat(320);
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': segundosQueEstouram }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 200, prazoTotalMs: 5000 });
  await cliente.executar(entradaValida());
  assert.equal(chamadas.length, 2, 'valor que estoura para Infinity deveria ser ignorado, permitindo a segunda tentativa via fallback');
});

test('correcao4e: Retry-After com zeros a esquerda (ex.: "003") corresponde ao formato estrito e e aceito -- provado por orcamento, sem espera real', async () => {
  // "003" -> 3000ms de espera aplicavel. Com prazoTotalMs=1000, esse
  // orcamento jamais comporta espera(3000)+tentativa completa(100): se
  // "003" fosse (corretamente) aceito como 3000ms, a segunda tentativa
  // nunca comeca (uma unica chamada). Se fosse (incorretamente) rejeitado,
  // o fallback (5ms) caberia facilmente, permitindo a segunda tentativa.
  // O gate de orcamento (que roda ANTES de qualquer espera real) decide
  // isso sem nunca chegar a esperar de verdade.
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaErroHttp(429, {}, { 'Retry-After': '003' }), () => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 1000 });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'limite_taxa');
  assert.equal(erro.tentativas, 1, '"003" deveria ser interpretado como 3000ms de espera, orcamento insuficiente para a segunda tentativa');
  assert.equal(chamadas.length, 1);
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
//
// Os cenarios que exigem relogio controlado (HTTP-date aceita provada por
// orcamento; decimal "1.5" provado com Date.parse manipulado) ficam na
// secao isolada ao final do arquivo. Os tres abaixo (ISO, data local,
// espacamento nao canonico, e o numerico ambiguo) nao precisam de relogio
// controlado: a decisao de aceitar/rejeitar independe do valor de
// Date.now, e a prova e inteiramente por orcamento + numero de chamadas
// (nunca por duracao medida).

test('correcao4-2: Retry-After em formato ISO 8601 e rejeitado -- provado por orcamento e chamadas, sem medir duracao', async () => {
  // Offset grande (500s) deliberado: se o ISO fosse (incorretamente)
  // aceito como uma data futura, representaria ~500_000ms de espera,
  // que jamais caberia no orcamento (prazoTotalMs=1000) -- so uma
  // chamada ocorreria. A rejeicao correta usa o fallback
  // (esperaEntreTentativasMs=5ms), que cabe facilmente, permitindo a
  // segunda tentativa. Duas chamadas provam a rejeicao sem medir tempo.
  const dataIso = new Date(Date.now() + 500_000).toISOString();
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': dataIso }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 1000 });
  await cliente.executar(entradaValida());
  assert.equal(chamadas.length, 2, 'ISO 8601 deveria ser rejeitado, permitindo a segunda tentativa via fallback');
});

test('correcao4-3: Retry-After em formato de data local (toString) e rejeitado -- provado por orcamento e chamadas, sem medir duracao', async () => {
  const dataLocal = new Date(Date.now() + 500_000).toString();
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': dataLocal }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 1000 });
  await cliente.executar(entradaValida());
  assert.equal(chamadas.length, 2, 'data local deveria ser rejeitada, permitindo a segunda tentativa via fallback');
});

test('correcao4-6: data valida mas com espacamento fora do padrao canonico e rejeitada -- provado por orcamento e chamadas, sem medir duracao', async () => {
  const dataFutura = new Date(Date.now() + 500_000).toUTCString();
  const dataComEspacoExtra = dataFutura.replace(', ', ',  '); // espaco duplo apos a virgula
  const { fetchFalso, chamadas } = criarFetchFalso([
    () => respostaErroHttp(429, {}, { 'Retry-After': dataComEspacoExtra }),
    () => respostaSucesso([]),
  ]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 1000 });
  await cliente.executar(entradaValida());
  assert.equal(chamadas.length, 2, 'espacamento fora do padrao deveria ser rejeitado, permitindo a segunda tentativa via fallback');
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

// correcao4-1 (HTTP-date canonica aceita) e correcao4-5 (decimal "1.5",
// com Date.parse controlado) ficam na secao isolada ao final do arquivo
// -- ambas exigem relogio/Date.parse controlado para provar o resultado
// sem depender de espera real ou de duracao medida.

// --- Correcao 2: WeakMap privado, nenhuma forma de reflexao revela Retry-After ---

// Conjunto exato de propriedades publicas que a instancia de
// ErroClienteModeloOpenAI pode ter: os seis campos aprovados mais as tres
// propriedades padrao de qualquer instancia de Error (name, message,
// stack). Usado para comparacao de conjunto exato (nao so "pertence a
// lista"), tanto em Object.getOwnPropertyNames quanto em Reflect.ownKeys
// -- qualquer propriedade a mais (ex.: retryAfterMs) ou a menos deve
// fazer o teste falhar.
const PROPRIEDADES_PUBLICAS_ESPERADAS_DO_ERRO = [
  'categoria',
  'codigo',
  'tentativas',
  'duracaoMs',
  'modelo',
  'statusHttp',
  'name',
  'message',
  'stack',
].sort();

test('correcao4-7: Object.getOwnPropertyNames corresponde exatamente as nove propriedades permitidas (nenhuma a mais, nenhuma a menos)', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaErroHttp(429, {}, { 'Retry-After': '3600' })]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 200 });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'limite_taxa');
  const nomes = Object.getOwnPropertyNames(erro as object).sort();
  assert.deepEqual(nomes, PROPRIEDADES_PUBLICAS_ESPERADAS_DO_ERRO);
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

test('correcao4-9: Reflect.ownKeys corresponde exatamente as mesmas nove chaves string, sem nenhum Symbol', async () => {
  const { fetchFalso } = criarFetchFalso([() => respostaErroHttp(429, {}, { 'Retry-After': '3600' })]);
  const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 200 });
  let erro: unknown;
  try {
    await cliente.executar(entradaValida());
  } catch (e) {
    erro = e;
  }
  assertCategoria(erro, 'limite_taxa');
  const chaves = Reflect.ownKeys(erro as object);
  assert.equal(chaves.length, PROPRIEDADES_PUBLICAS_ESPERADAS_DO_ERRO.length, 'nenhuma chave alem das nove esperadas (nem string extra, nem symbol)');
  assert.deepEqual(
    chaves.filter((chave) => typeof chave === 'symbol'),
    [],
    'nenhuma chave Symbol deveria existir'
  );
  const chavesString = chaves.filter((chave): chave is string => typeof chave === 'string').sort();
  assert.deepEqual(chavesString, PROPRIEDADES_PUBLICAS_ESPERADAS_DO_ERRO);
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
//
// Os seis cenarios (correcao4-11 a correcao4-16) usam comJsonParseAtrasado,
// que substitui JSON.parse globalmente -- ficam na secao isolada ao final
// do arquivo, junto com os demais testes que alteram globais.

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

// =====================================================================
// Rodada 5 -- correcao apos revisao do Codex sobre o commit 79b5c61,
// que apontou tres lacunas exclusivamente nos testes (nenhuma mudanca de
// codigo de producao nesta rodada):
//
// 1. correcao4-7/correcao4-9 comparavam "toda propriedade encontrada
//    pertence a lista permitida", o que deixaria passar uma propriedade
//    FALTANDO sem detectar -- agora comparam o conjunto ORDENADO exato
//    via assert.deepEqual (ver PROPRIEDADES_PUBLICAS_ESPERADAS_DO_ERRO,
//    definida acima, junto de correcao4-7).
//
// 2. Todo teste que substitui Date.now, JSON.parse ou Date.parse
//    globalmente agora fica agrupado nesta unica describe com
//    concurrency explicitamente desativada (nao dependemos do
//    comportamento sequencial implicito do runner). Cada substituicao
//    salva a referencia original, ocorre dentro do proprio teste, e e
//    restaurada incondicionalmente em finally -- inclusive quando o
//    callback lanca. Duas provas de restauracao explicitas fecham a
//    secao.
//
// 3. Os testes de Retry-After que dependiam de duracao de parede
//    (duracao < Xms, ou esperar segundos de verdade) foram reescritos
//    para provar aceitacao/rejeicao somente por orcamento configurado +
//    numero de chamadas ao fetch + categoria/tentativas do erro --
//    quando a decisao correta so e distinguivel de uma aceitacao indevida
//    via uma data proxima/ambigua (caso do decimal "1.5", e da lista
//    completa de formatos invalidos), Date.parse e Date.now sao
//    controlados para forcar o pior caso (uma data futura distante) e
//    provar que o round-trip ainda assim rejeita.
// =====================================================================

describe('testes que substituem globais (Date.now, JSON.parse, Date.parse) -- concurrency serializada explicitamente', { concurrency: 1 }, () => {
  // A revalidacao pos-espera (antigo "correcao1") agora e provada com
  // t.mock.timers (ver a secao "Correcao 1: revalidar o orcamento apos a
  // espera", perto do teste 21) -- os timers falsos do node:test tem
  // isolamento e restauracao proprios por TestContext, entao esse teste
  // nao precisa (nem deve) ficar agrupado com as substituicoes manuais de
  // Date.now/JSON.parse/Date.parse abaixo.

  test('correcao4: formatos numericos invalidos (decimal, sinal, espaco interno, notacao exponencial, Infinity, NaN, texto arbitrario) sao rejeitados -- provado por orcamento e chamadas, com Date.parse controlado para simular o pior caso', async () => {
    // ' 5'/'5 ' nao entram aqui: Headers normaliza (retira) OWS nas bordas
    // do valor do header por conta propria, entao esses dois casos nunca
    // chegariam com espaco ate o nosso codigo. '5 0' cobre espaco INTERNO,
    // que Headers preserva. 'nao-e-um-valor-valido' cobre texto arbitrario
    // sem nenhuma forma numerica (equivalente ao antigo teste 24, removido).
    const valoresInvalidos = ['1.5', '+5', '-5', '5 0', '1e10', '1E3', 'Infinity', '-Infinity', 'NaN', 'nao-e-um-valor-valido'];

    // Date.parse nativo ja rejeita (NaN) a maioria destes valores, mas
    // '+5' e '-5' retornam uma data valida (embora no passado) em alguns
    // runtimes -- para nao depender disso, forcamos TODOS os valores da
    // lista a produzir, via Date.parse, uma data FUTURA distante (que,
    // se fosse aceita pelo round-trip, tornaria o orcamento insuficiente
    // para a segunda tentativa). Assim, "duas chamadas ocorrem" so pode
    // significar que o round-trip corretamente rejeitou o texto literal
    // (nenhum deles pode ser igual a um toUTCString() real).
    const parseOriginal = Date.parse;
    const timestampFuturoSeAceito = Date.now() + 500_000;
    Date.parse = ((valor: string) => (valoresInvalidos.includes(valor) ? timestampFuturoSeAceito : parseOriginal(valor))) as typeof Date.parse;

    try {
      for (const valorInvalido of valoresInvalidos) {
        const { fetchFalso, chamadas } = criarFetchFalso([
          () => respostaErroHttp(429, {}, { 'Retry-After': valorInvalido }),
          () => respostaSucesso([]),
        ]);
        const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 1000 });
        await cliente.executar(entradaValida());
        assert.equal(
          chamadas.length,
          2,
          `Retry-After=${valorInvalido} deveria ser rejeitado (round-trip nunca bate com o texto literal), permitindo a segunda tentativa via fallback -- mesmo com Date.parse manipulado para simular uma aceitacao indevida como data futura distante`
        );
      }
    } finally {
      Date.parse = parseOriginal;
    }
    assert.equal(Date.parse, parseOriginal, 'Date.parse deve ser exatamente a referencia original apos o teste');
  });

  test('correcao4-1: Retry-After em HTTP-date canonica (toUTCString) e aceito -- provado por orcamento, sem espera real', async () => {
    // Relogio congelado num instante fixo: o header e construido como
    // exatamente agoraFixo+500_000ms via toUTCString (garantidamente
    // canonico, round-trip estavel). Com prazoTotalMs=1000, se a data for
    // aceita (como deve ser), a espera aplicavel (500_000ms) jamais cabe
    // no orcamento -- uma unica chamada ocorre, sem nenhuma espera real.
    const agoraFixo = 1_700_000_000_000;
    const segundosFuturos = 500;
    const dataCanonica = new Date(agoraFixo + segundosFuturos * 1000).toUTCString();

    const timeoutPorTentativaMs = 100;
    const esperaEntreTentativasMs = 5;
    const prazoTotalMs = 1000;

    const DateNowOriginal = Date.now;
    Date.now = () => agoraFixo;

    const { fetchFalso, chamadas } = criarFetchFalso([
      () => respostaErroHttp(429, {}, { 'Retry-After': dataCanonica }),
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

    assert.equal(Date.now, DateNowOriginal, 'Date.now deve ser exatamente a referencia original apos o teste');
    assertCategoria(erro, 'limite_taxa');
    assert.equal(erro.tentativas, 1, 'a data canonica deveria ter sido aceita como uma espera enorme, impedindo a segunda tentativa');
    assert.equal(chamadas.length, 1);
  });

  test('correcao4-5: decimal "1.5" e rejeitado de forma distinguivel -- Date.parse controlado simula uma aceitacao incorreta e prova que o round-trip a rejeita mesmo assim', async () => {
    const agoraFixo = 1_700_000_000_000;
    const timestampFuturoSeAceito = agoraFixo + 500_000; // se "1.5" fosse (incorretamente) aceito como data, resultaria numa espera enorme
    const parseOriginal = Date.parse;
    const DateNowOriginal = Date.now;

    Date.now = () => agoraFixo;
    Date.parse = ((valor: string) => (valor === '1.5' ? timestampFuturoSeAceito : parseOriginal(valor))) as typeof Date.parse;

    const { fetchFalso, chamadas } = criarFetchFalso([
      () => respostaErroHttp(429, {}, { 'Retry-After': '1.5' }),
      () => respostaSucesso([]),
    ]);

    try {
      const cliente = criarCliente({ fetch: fetchFalso, esperaEntreTentativasMs: 5, timeoutPorTentativaMs: 100, prazoTotalMs: 1000 });
      await cliente.executar(entradaValida());
    } finally {
      Date.parse = parseOriginal;
      Date.now = DateNowOriginal;
    }

    assert.equal(Date.parse, parseOriginal, 'Date.parse deve ser exatamente a referencia original apos o teste');
    assert.equal(Date.now, DateNowOriginal, 'Date.now deve ser exatamente a referencia original apos o teste');
    assert.equal(
      chamadas.length,
      2,
      '"1.5" deveria ser rejeitado (round-trip nunca produz "1.5"), permitindo a segunda tentativa via fallback -- mesmo com Date.parse manipulado para simular uma data futura plausivel'
    );
  });

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
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  natureza_mensagem: 'pedido',
                  alteracoes: [{ campo: 'campo_desconhecido', acao: 'informar', valor: 'x' }],
                }),
              },
            ],
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

  test('prova-restauracao: JSON.parse volta a ser a referencia original apos comJsonParseAtrasado, mesmo quando o callback lanca', async () => {
    const parseOriginal = JSON.parse;
    await assert.rejects(() =>
      comJsonParseAtrasado(1, async () => {
        throw new Error('erro proposital dentro do callback, para provar que o finally restaura mesmo assim');
      })
    );
    assert.equal(JSON.parse, parseOriginal, 'JSON.parse deve ser exatamente a referencia original apos o helper terminar, mesmo com excecao');
  });

  test('prova-restauracao: Date.now volta a ser a referencia original apos um teste que o substitui, mesmo quando cliente.executar lanca', async () => {
    const DateNowOriginal = Date.now;
    Date.now = () => 42;
    let erro: unknown;
    try {
      const { fetchFalso } = criarFetchFalso([() => respostaErroHttp(401, {})]);
      const cliente = criarCliente({ fetch: fetchFalso });
      await cliente.executar(entradaValida());
    } catch (e) {
      erro = e;
    } finally {
      Date.now = DateNowOriginal;
    }
    assert.equal(Date.now, DateNowOriginal, 'Date.now deve ser exatamente a referencia original apos o teste, mesmo com excecao lancada dentro do bloco protegido');
    assertCategoria(erro, 'autenticacao');
  });
});

// --- FRONTEIRA DE SAIDA: o que realmente vai no corpo HTTP ---
//
// Criados em 2026-08-08 depois de um bug REAL que chegou a producao:
// `historico_recente` foi adicionado a EntradaInterpretacao, ao extrator e ao
// orquestrador, mas NUNCA foi copiado para o corpo da requisicao -- este
// objeto e montado campo a campo, e a chave foi esquecida. O historico
// chegava ate o payload e morria na porta de saida.
//
// Nenhum teste existente pegou isso porque todos inspecionavam o OBJETO DE
// ENTRADA, nunca o JSON que sai no fetch. Estes testes fecham essa lacuna: o
// alvo e sempre `opcoes.body`, o que o servidor de fato recebe.

function corpoEnviado(chamadas: ChamadaRegistrada[]): Record<string, unknown> {
  assert.ok(chamadas.length > 0, 'esperava ao menos uma chamada a fetch');
  const corpo = JSON.parse(String(chamadas[0].opcoes.body)) as { input: Array<{ role: string; content: string }> };
  const mensagemUsuario = corpo.input.find((i) => i.role === 'user');
  assert.ok(mensagemUsuario, 'corpo deve conter a mensagem de role=user');
  return JSON.parse(mensagemUsuario.content) as Record<string, unknown>;
}

const HISTORICO_EXEMPLO = [
  { mensagem_paciente: 'quero marcar', resposta_iris: 'Você prefere manhã ou tarde?', gerada_em: '2026-08-08T12:00:00.000Z' },
];

test('fronteira: historico_recente presente no payload chega LITERALMENTE ao corpo HTTP enviado', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });

  await cliente.executar(
    entradaValida({
      payload: {
        mensagens_atuais: ['Tarde.'],
        dados_atuais: {},
        campos_cadastrais_preenchidos: [],
        historico_recente: HISTORICO_EXEMPLO,
      },
    })
  );

  const enviado = corpoEnviado(chamadas);
  // Este assert e o que FALHA se alguem remover a chave do corpo em
  // cliente-modelo-openai.ts -- e exatamente o bug de 2026-08-08.
  assert.deepEqual(
    enviado.historico_recente,
    HISTORICO_EXEMPLO,
    'historico_recente deve chegar byte a byte ao corpo HTTP -- se falhar aqui, a interpretadora esta cega por turno em producao'
  );
});

test('fronteira: historico_recente ausente no payload nao cria chave morta no corpo HTTP', async () => {
  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });

  await cliente.executar(entradaValida());

  assert.equal('historico_recente' in corpoEnviado(chamadas), false);
});

test('fronteira: GUARDA GERAL -- toda chave opcional do payload precisa aparecer no corpo HTTP', async () => {
  // Guarda contra a CLASSE do bug, nao contra a instancia: qualquer campo
  // opcional novo em EntradaInterpretacao que alguem esquecer de copiar para
  // o corpo faz este teste falhar, sem precisar escrever um teste dedicado.
  const payloadCompleto = {
    mensagens_atuais: ['Tarde.'],
    dados_atuais: { procedimento_id: 'limpeza' },
    campos_cadastrais_preenchidos: [],
    horarios_oferecidos: ['08:00', '09:00'],
    proposta_pendente: { data: '08/08', horario: '14:00' },
    historico_recente: HISTORICO_EXEMPLO,
  };

  const { fetchFalso, chamadas } = criarFetchFalso([() => respostaSucesso([])]);
  const cliente = criarCliente({ fetch: fetchFalso });
  await cliente.executar(entradaValida({ payload: payloadCompleto }));

  const enviado = corpoEnviado(chamadas);
  for (const chave of Object.keys(payloadCompleto)) {
    assert.ok(
      chave in enviado,
      `chave "${chave}" existe no payload mas NAO chegou ao corpo HTTP -- o corpo e montado campo a campo em cliente-modelo-openai.ts e essa chave foi esquecida la`
    );
  }
  assert.deepEqual(enviado, payloadCompleto, 'o corpo enviado deve ser exatamente o payload, sem perder nem inventar chave');
});
