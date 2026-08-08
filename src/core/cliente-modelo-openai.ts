// Adaptador fino de ClienteModeloEstruturado para a OpenAI Responses API.
// Nao decide fluxo, nao acessa banco, nao chama outro modulo do Core alem
// dos tipos e das constantes de campos/acoes ja aprovadas. Nao le
// process.env diretamente -- toda configuracao (chave, modelo, fetch,
// tempos) e injetada pelo chamador; a Edge Function futura sera
// responsavel por fornecer o secret.
//
// Este arquivo NAO e chamado por nenhum fluxo de producao ainda -- nao ha
// integracao com interpretarEAplicar nem com a Edge Function nesta etapa.
import { ACOES_PERMITIDAS, CAMPOS_PERMITIDOS } from './aplicar-dados.ts';
import { NATUREZAS_MENSAGEM_PERMITIDAS } from './interpretacao-tipos.ts';
import type { ClienteModeloEstruturado, EntradaInterpretacao, NaturezaMensagem } from './interpretacao-tipos.ts';
import type { AcaoAlteracaoDados, AlteracoesDados, CampoDadosConversa } from './tipos.ts';

export const MODELO_GPT_4_1_MINI = 'gpt-4.1-mini-2025-04-14';

const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const MAX_OUTPUT_TOKENS = 512;

// Valores de referencia aprovados -- nunca usados como default silencioso.
// O chamador deve fornecer os tres tempos explicitamente em toda chamada.
export const TIMEOUT_POR_TENTATIVA_MS_APROVADO = 8000;
export const PRAZO_TOTAL_MS_APROVADO = 18000;
export const ESPERA_ENTRE_TENTATIVAS_MS_APROVADO = 500;

// --- Schema portatil aprovado (identico ao usado no smoke test e no
// avaliador semantico -- unica forma ja validada contra o Structured
// Outputs estrito da OpenAI). Sempre usado no corpo real da requisicao,
// independente do `schema` recebido em `executar()`. ---
const SCHEMA_PORTATIL_APROVADO = {
  type: 'object',
  properties: {
    natureza_mensagem: {
      type: 'string',
      enum: [...NATUREZAS_MENSAGEM_PERMITIDAS],
    },
    alteracoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          campo: {
            type: 'string',
            enum: [
              'intencao',
              'procedimento_texto',
              'dentista_texto',
              'data_texto',
              'periodo',
              'horario_texto',
              'confirmacao',
              'nome',
              'cpf',
              'data_nascimento',
              'email',
            ],
          },
          acao: {
            type: 'string',
            enum: ['informar', 'corrigir', 'remover'],
          },
          valor: {
            type: ['string', 'null'],
          },
        },
        required: ['campo', 'acao', 'valor'],
        additionalProperties: false,
      },
    },
  },
  required: ['natureza_mensagem', 'alteracoes'],
  additionalProperties: false,
} as const;

// --- Categorias de erro controladas ---
export type CategoriaErroModelo =
  | 'autenticacao'
  | 'limite_taxa'
  | 'indisponibilidade'
  | 'timeout'
  | 'resposta_vazia'
  | 'resposta_nao_estruturada'
  | 'resposta_truncada'
  | 'recusa_ou_filtro'
  | 'resposta_invalida';

// resposta_vazia e repetivel (pode ser um hiccup transitorio do provedor).
// Todas as demais categorias de conteudo/estrutura invalida NUNCA repetem
// -- repetir uma resposta estruturalmente invalida so reproduziria o
// mesmo resultado.
const CATEGORIAS_REPETIVEIS = new Set<CategoriaErroModelo>([
  'limite_taxa',
  'indisponibilidade',
  'timeout',
  'resposta_vazia',
]);

// WeakMap privado do modulo, nunca exportado: guarda o Retry-After ja
// convertido para milissegundos (number | null), associado a cada
// instancia de ErroClienteModeloOpenAI como chave. Como o valor vive
// inteiramente FORA do objeto (nenhuma propriedade e criada na
// instancia, nem enumeravel nem oculta), ele nao aparece em
// Object.keys, for...in, JSON.stringify, Object.getOwnPropertySymbols,
// Object.getOwnPropertyNames nem Reflect.ownKeys -- inclusive quando o
// erro esta aninhado dentro de outro objeto serializado. So e lido
// internamente por obterRetryAfterMs(), usado pelo orquestrador de retry.
const mapaRetryAfterMs = new WeakMap<ErroClienteModeloOpenAI, number | null>();

// A interface publica da instancia so pode conter: categoria, codigo
// tecnico fixo, numero de tentativas realmente iniciadas, duracao,
// modelo (sempre a constante aprovada), e status HTTP quando existir --
// alem das propriedades padrao de qualquer Error (name, message, stack).
// Nunca mensagem do paciente, dados_atuais, resposta bruta, valores
// interpretados, PII, chave, corpo bruto de erro da API ou Retry-After.
export class ErroClienteModeloOpenAI extends Error {
  categoria: CategoriaErroModelo;
  codigo: string;
  tentativas: number;
  duracaoMs: number;
  modelo: string;
  statusHttp: number | null;

  constructor(
    categoria: CategoriaErroModelo,
    codigo: string,
    tentativas: number,
    duracaoMs: number,
    modelo: string,
    statusHttp: number | null = null,
    retryAfterMs: number | null = null
  ) {
    super(`cliente de modelo OpenAI: categoria=${categoria} codigo=${codigo} tentativas=${tentativas}`);
    this.name = 'ErroClienteModeloOpenAI';
    this.categoria = categoria;
    this.codigo = codigo;
    this.tentativas = tentativas;
    this.duracaoMs = duracaoMs;
    this.modelo = modelo;
    this.statusHttp = statusHttp;

    mapaRetryAfterMs.set(this, retryAfterMs);
  }
}

function obterRetryAfterMs(erro: ErroClienteModeloOpenAI): number | null {
  return mapaRetryAfterMs.get(erro) ?? null;
}

// Erro de configuracao, lancado sincronamente em criarClienteModeloOpenAI,
// antes de qualquer rede. So pode conter o nome do campo e uma mensagem
// fixa -- nunca o valor arbitrario recebido do chamador.
export class ErroConfiguracaoClienteModeloOpenAI extends Error {
  campo: string;
  constructor(campo: string, mensagem: string) {
    super(mensagem);
    this.name = 'ErroConfiguracaoClienteModeloOpenAI';
    this.campo = campo;
  }
}

// Erro interno de conversao (nunca exposto fora deste arquivo) -- carrega
// somente um codigo tecnico fixo, nunca o valor recebido.
class ErroConversaoPortatil extends Error {
  codigo: string;
  constructor(codigo: string) {
    super(`conversao portatil invalida: ${codigo}`);
    this.name = 'ErroConversaoPortatil';
    this.codigo = codigo;
  }
}

export interface ConfiguracaoClienteModeloOpenAI {
  chaveApi: string;
  modelo: string;
  fetch?: typeof fetch;
  timeoutPorTentativaMs: number;
  prazoTotalMs: number;
  esperaEntreTentativasMs: number;
}

/**
 * Cria um ClienteModeloEstruturado concreto para a OpenAI Responses API.
 * Toda a configuracao e validada sincronamente aqui, antes de qualquer
 * rede -- se algo for invalido, a criacao falha e `executar()` nunca
 * chega a existir. Config injetada, nunca lida de process.env.
 */
export function criarClienteModeloOpenAI(configuracao: ConfiguracaoClienteModeloOpenAI): ClienteModeloEstruturado {
  validarConfiguracao(configuracao);

  const chaveApi = configuracao.chaveApi;
  const modelo = MODELO_GPT_4_1_MINI; // sempre a constante -- validarConfiguracao ja garantiu que configuracao.modelo e igual a ela.
  const fetchInjetado = configuracao.fetch ?? fetch;
  const timeoutPorTentativaMs = configuracao.timeoutPorTentativaMs;
  const prazoTotalMs = configuracao.prazoTotalMs;
  const esperaEntreTentativasMs = configuracao.esperaEntreTentativasMs;

  return {
    async executar(entrada: { instrucoes: string; schema: object; payload: EntradaInterpretacao }): Promise<unknown> {
      return executarComRetry({
        entrada,
        chaveApi,
        modelo,
        fetchInjetado,
        timeoutPorTentativaMs,
        prazoTotalMs,
        esperaEntreTentativasMs,
      });
    },
  };
}

function validarConfiguracao(configuracao: ConfiguracaoClienteModeloOpenAI): void {
  if (typeof configuracao.chaveApi !== 'string' || configuracao.chaveApi.trim() === '') {
    throw new ErroConfiguracaoClienteModeloOpenAI('chaveApi', 'chaveApi deve ser uma string nao vazia');
  }

  if (configuracao.modelo !== MODELO_GPT_4_1_MINI) {
    throw new ErroConfiguracaoClienteModeloOpenAI(
      'modelo',
      `modelo deve ser exatamente a constante aprovada MODELO_GPT_4_1_MINI (${MODELO_GPT_4_1_MINI})`
    );
  }

  if (configuracao.fetch !== undefined && typeof configuracao.fetch !== 'function') {
    throw new ErroConfiguracaoClienteModeloOpenAI('fetch', 'fetch, quando fornecido, deve ser uma funcao');
  }

  exigirInteiroExplicito(configuracao.timeoutPorTentativaMs, 'timeoutPorTentativaMs', { permitirZero: false });
  exigirInteiroExplicito(configuracao.prazoTotalMs, 'prazoTotalMs', { permitirZero: false });
  exigirInteiroExplicito(configuracao.esperaEntreTentativasMs, 'esperaEntreTentativasMs', { permitirZero: true });

  if (configuracao.prazoTotalMs < configuracao.timeoutPorTentativaMs) {
    throw new ErroConfiguracaoClienteModeloOpenAI(
      'prazoTotalMs',
      'prazoTotalMs deve comportar pelo menos uma tentativa completa (>= timeoutPorTentativaMs)'
    );
  }
}

function exigirInteiroExplicito(valor: unknown, campo: string, opcoes: { permitirZero: boolean }): void {
  if (valor === undefined) {
    throw new ErroConfiguracaoClienteModeloOpenAI(campo, `${campo} deve ser fornecido explicitamente -- nao ha default silencioso`);
  }
  if (typeof valor !== 'number' || !Number.isFinite(valor) || !Number.isInteger(valor)) {
    throw new ErroConfiguracaoClienteModeloOpenAI(campo, `${campo} deve ser um numero inteiro finito`);
  }
  const minimoValido = opcoes.permitirZero ? 0 : 1;
  if (valor < minimoValido) {
    throw new ErroConfiguracaoClienteModeloOpenAI(
      campo,
      opcoes.permitirZero ? `${campo} deve ser maior ou igual a zero` : `${campo} deve ser positivo`
    );
  }
}

interface ContextoChamada {
  entrada: { instrucoes: string; schema: object; payload: EntradaInterpretacao };
  chaveApi: string;
  modelo: string;
  fetchInjetado: typeof fetch;
  timeoutPorTentativaMs: number;
  prazoTotalMs: number;
  esperaEntreTentativasMs: number;
}

// Estrutura fixa: tentativa 1 sempre com o timeout completo (o orcamento
// total ja garante isso, validado na configuracao). Se falhar de forma
// repetivel, o orcamento e validado DUAS vezes antes da tentativa 2: uma
// vez antes de esperar (para decidir se vale a pena esperar) e outra vez
// IMEDIATAMENTE APOS a espera (para garantir que o tempo realmente gasto
// esperando -- que pode nao ser exatamente o previsto -- ainda deixa
// timeoutPorTentativaMs inteiro disponivel). Se qualquer uma das duas
// checagens falhar, a tentativa 2 nunca inicia (nenhum fetch), e o erro
// da tentativa 1 e devolvido com tentativas=1. Tentativa 2, quando
// ocorre, sempre recebe o timeout completo -- nunca reduzido. Nunca ha
// uma terceira tentativa -- nao existe nenhum laco que permita isso.
async function executarComRetry(contexto: ContextoChamada): Promise<unknown> {
  const inicioTotal = Date.now();

  try {
    return await executarUmaTentativa(contexto, 1, contexto.timeoutPorTentativaMs, inicioTotal);
  } catch (erroTentativa1) {
    if (!(erroTentativa1 instanceof ErroClienteModeloOpenAI)) throw erroTentativa1;
    if (!CATEGORIAS_REPETIVEIS.has(erroTentativa1.categoria)) throw erroTentativa1;

    const esperaAplicavel = Math.max(contexto.esperaEntreTentativasMs, obterRetryAfterMs(erroTentativa1) ?? 0);

    const restanteAntesDeEsperar = contexto.prazoTotalMs - (Date.now() - inicioTotal);
    if (restanteAntesDeEsperar < esperaAplicavel + contexto.timeoutPorTentativaMs) {
      // Orcamento insuficiente para espera + uma tentativa completa:
      // nao inicia a segunda tentativa, devolve o ultimo erro sanitizado.
      throw erroTentativa1;
    }

    if (esperaAplicavel > 0) {
      await aguardar(esperaAplicavel);
    }

    // Revalidacao apos a espera: o tempo real de espera pode nao
    // corresponder exatamente ao previsto (jitter do event loop). So
    // inicia a tentativa 2 se ainda sobrar timeoutPorTentativaMs INTEIRO
    // -- nunca reduz o timeout da tentativa 2 para compensar.
    const restanteAposEsperar = contexto.prazoTotalMs - (Date.now() - inicioTotal);
    if (restanteAposEsperar < contexto.timeoutPorTentativaMs) {
      throw erroTentativa1;
    }

    // Tentativa 2 -- sempre com o timeout completo, nunca reduzido.
    // Se falhar, o erro propaga diretamente: nunca ha terceira tentativa.
    return await executarUmaTentativa(contexto, 2, contexto.timeoutPorTentativaMs, inicioTotal);
  }
}

// O timer desta tentativa so e limpo apos processarTentativa terminar
// (sucesso ou falha) -- ou seja, apos envio da requisicao, espera pelos
// headers, leitura integral do corpo e parse necessario para classificar
// a resposta. Nao e limpo so por causa de `fetch()` ter retornado.
async function executarUmaTentativa(
  contexto: ContextoChamada,
  tentativa: number,
  timeoutMs: number,
  inicioTotal: number
): Promise<unknown> {
  const inicioTentativa = Date.now();
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    return await processarTentativa(contexto, tentativa, inicioTotal, inicioTentativa, timeoutMs, controlador.signal);
  } catch (erro) {
    if (erro instanceof ErroClienteModeloOpenAI) throw erro;

    const duracao = Date.now() - inicioTotal;
    const foiAbort = controlador.signal.aborted || (erro instanceof Error && erro.name === 'AbortError');
    if (foiAbort) {
      throw new ErroClienteModeloOpenAI('timeout', 'tempo_esgotado_na_tentativa', tentativa, duracao, contexto.modelo);
    }
    throw new ErroClienteModeloOpenAI('indisponibilidade', 'erro_de_rede', tentativa, duracao, contexto.modelo);
  } finally {
    clearTimeout(timer);
  }
}

async function processarTentativa(
  contexto: ContextoChamada,
  tentativa: number,
  inicioTotal: number,
  inicioTentativa: number,
  timeoutTentativaMs: number,
  signal: AbortSignal
): Promise<unknown> {
  const instrucoesPortatil = construirInstrucoesPortatil(contexto.entrada.instrucoes);

  const corpo = {
    model: contexto.modelo,
    input: [
      { role: 'system', content: instrucoesPortatil },
      {
        role: 'user',
        content: JSON.stringify({
          mensagens_atuais: contexto.entrada.payload.mensagens_atuais,
          dados_atuais: contexto.entrada.payload.dados_atuais,
          campos_cadastrais_preenchidos: contexto.entrada.payload.campos_cadastrais_preenchidos,
          // Chave OMITIDA quando nao ha snapshot -- nunca `undefined`
          // explicito, que JSON.stringify descartaria de forma implicita.
          ...(contexto.entrada.payload.horarios_oferecidos !== undefined
            ? { horarios_oferecidos: contexto.entrada.payload.horarios_oferecidos }
            : {}),
          ...(contexto.entrada.payload.proposta_pendente !== undefined
            ? { proposta_pendente: contexto.entrada.payload.proposta_pendente }
            : {}),
        }),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'alteracoes_iris',
        schema: SCHEMA_PORTATIL_APROVADO,
        strict: true,
      },
    },
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false,
    stream: false,
    background: false,
  };
  // nenhuma chave 'tools' incluida em nenhuma hipotese. Desde
  // specs/historico-conversacional-v1.md (2026-08-07), o corpo tambem pode
  // levar "historico_recente" (texto de conversa dos ultimos turnos, sem
  // sanitizacao -- ver spec secao 0.1); nenhum valor cadastral estruturado
  // (nome/cpf/data_nascimento/email) atravessa por fora de
  // mensagens_atuais/dados_atuais/historico_recente.

  const resposta = await contexto.fetchInjetado(URL_RESPONSES, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${contexto.chaveApi}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(corpo),
    signal,
  });

  const duracao = () => Date.now() - inicioTotal;

  if (!resposta.ok) {
    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroClienteModeloOpenAI('autenticacao', 'nao_autorizado', tentativa, duracao(), contexto.modelo, resposta.status);
    }
    if (resposta.status === 429) {
      const retryAfterMs = interpretarRetryAfter(resposta.headers?.get?.('Retry-After') ?? null);
      throw new ErroClienteModeloOpenAI(
        'limite_taxa',
        'limite_de_taxa_excedido',
        tentativa,
        duracao(),
        contexto.modelo,
        resposta.status,
        retryAfterMs
      );
    }
    if (resposta.status >= 500) {
      const retryAfterMs = interpretarRetryAfter(resposta.headers?.get?.('Retry-After') ?? null);
      throw new ErroClienteModeloOpenAI(
        'indisponibilidade',
        'erro_do_servidor',
        tentativa,
        duracao(),
        contexto.modelo,
        resposta.status,
        retryAfterMs
      );
    }
    throw new ErroClienteModeloOpenAI(
      'resposta_invalida',
      'erro_http_nao_recuperavel',
      tentativa,
      duracao(),
      contexto.modelo,
      resposta.status
    );
  }

  // Le o corpo integralmente ANTES de classificar -- o timer da tentativa
  // (em executarUmaTentativa) permanece ativo durante esta leitura.
  const textoCorpo = await resposta.text();

  // Checagem explicita do prazo da tentativa e do prazo total, logo apos
  // a leitura integral do corpo: o AbortController nao interrompe
  // processamento sincrono (JSON.parse, classificacao, conversao) que
  // aconteca DEPOIS da leitura terminar -- entao verificamos aqui por
  // conta propria.
  verificarPrazoOuLancarTimeout(tentativa, inicioTentativa, timeoutTentativaMs, inicioTotal, contexto.prazoTotalMs, duracao(), contexto.modelo);

  try {
    const resultado = classificarEConverter(textoCorpo, resposta.status, tentativa, duracao, contexto.modelo);

    // Ultima checagem, imediatamente antes de aceitar como sucesso: o
    // prazo da tentativa e o prazo total (parse/classificacao/conversao
    // tambem sao processamento sincrono, nao interrompido pelo
    // AbortController).
    verificarPrazoOuLancarTimeout(
      tentativa,
      inicioTentativa,
      timeoutTentativaMs,
      inicioTotal,
      contexto.prazoTotalMs,
      duracao(),
      contexto.modelo
    );

    return resultado;
  } catch (erroClassificacao) {
    if (!(erroClassificacao instanceof ErroClienteModeloOpenAI)) throw erroClassificacao;

    // O prazo pode ter se esgotado DURANTE o processamento (JSON invalido,
    // raiz invalida, status invalido, truncamento, recusa/filtro, output
    // ausente, message ausente, content ausente, output_text ausente ou
    // invalido, conversao portatil invalida) -- nesses casos, timeout
    // prevalece sobre a classificacao estrutural/semantica, que nunca e
    // devolvida tardiamente. Se o prazo ainda nao se esgotou, a
    // classificacao original e preservada sem alteracao.
    verificarPrazoOuLancarTimeout(
      tentativa,
      inicioTentativa,
      timeoutTentativaMs,
      inicioTotal,
      contexto.prazoTotalMs,
      duracao(),
      contexto.modelo
    );
    throw erroClassificacao;
  }
}

// Toda a classificacao estrutural/semantica do corpo ja lido, mais a
// conversao para o contrato interno. Extraida a parte para que
// processarTentativa possa envolve-la num unico ponto de checagem de
// prazo (ver verificarPrazoOuLancarTimeout acima).
function classificarEConverter(
  textoCorpo: string,
  statusHttpResposta: number,
  tentativa: number,
  duracao: () => number,
  modelo: string
): { natureza_mensagem: NaturezaMensagem; alteracoes: AlteracoesDados } {
  if (textoCorpo === '') {
    // Corpo HTTP com zero bytes: unico caso, junto com output_text vazio
    // mais abaixo, classificado como resposta_vazia (repetivel).
    throw new ErroClienteModeloOpenAI('resposta_vazia', 'corpo_http_vazio', tentativa, duracao(), modelo, statusHttpResposta);
  }

  let corpoResposta: unknown;
  try {
    corpoResposta = JSON.parse(textoCorpo);
  } catch {
    throw new ErroClienteModeloOpenAI('resposta_invalida', 'corpo_nao_e_json_valido', tentativa, duracao(), modelo, statusHttpResposta);
  }

  if (corpoResposta === null || typeof corpoResposta !== 'object' || Array.isArray(corpoResposta)) {
    throw new ErroClienteModeloOpenAI('resposta_invalida', 'raiz_json_nao_e_objeto', tentativa, duracao(), modelo, statusHttpResposta);
  }
  const envelope = corpoResposta as Record<string, unknown>;

  // Recusa/filtro precisa ser detectada ANTES de qualquer classificacao
  // generica de status/truncamento -- examina todos os itens de output,
  // todos os itens de content, e incomplete_details quando presente.
  if (detectarRecusaOuFiltro(envelope)) {
    throw new ErroClienteModeloOpenAI('recusa_ou_filtro', 'recusa_ou_filtro_detectado', tentativa, duracao(), modelo, statusHttpResposta);
  }

  // status precisa ser exatamente a string "completed" para a resposta
  // ser aceita. Ausente, null ou de tipo diferente de string -> envelope
  // estruturalmente incompatível (resposta_nao_estruturada, sem retry).
  // Presente como string mas diferente de "completed" -> truncamento
  // (resposta_truncada, sem retry, codigo fixo -- nunca interpola o
  // valor externo).
  const status = envelope.status;
  if (status === undefined || status === null || typeof status !== 'string') {
    throw new ErroClienteModeloOpenAI(
      'resposta_nao_estruturada',
      'status_ausente_ou_invalido',
      tentativa,
      duracao(),
      modelo,
      statusHttpResposta
    );
  }
  if (status !== 'completed') {
    throw new ErroClienteModeloOpenAI('resposta_truncada', 'resposta_incompleta', tentativa, duracao(), modelo, statusHttpResposta);
  }

  const output = envelope.output;
  if (!Array.isArray(output)) {
    throw new ErroClienteModeloOpenAI(
      'resposta_nao_estruturada',
      'output_ausente_ou_invalido',
      tentativa,
      duracao(),
      modelo,
      statusHttpResposta
    );
  }

  const itemMensagem = output.find((item) => (item as { type?: string })?.type === 'message') as
    | { content?: unknown }
    | undefined;
  if (!itemMensagem) {
    throw new ErroClienteModeloOpenAI('resposta_nao_estruturada', 'item_mensagem_ausente', tentativa, duracao(), modelo, statusHttpResposta);
  }

  const conteudo = itemMensagem.content;
  if (!Array.isArray(conteudo)) {
    throw new ErroClienteModeloOpenAI(
      'resposta_nao_estruturada',
      'conteudo_ausente_ou_invalido',
      tentativa,
      duracao(),
      modelo,
      statusHttpResposta
    );
  }

  const itemTexto = conteudo.find((item) => (item as { type?: string })?.type === 'output_text') as
    | { text?: unknown }
    | undefined;
  const textoBruto = itemTexto?.text;
  if (!itemTexto || typeof textoBruto !== 'string') {
    throw new ErroClienteModeloOpenAI(
      'resposta_nao_estruturada',
      'canal_estruturado_ausente',
      tentativa,
      duracao(),
      modelo,
      statusHttpResposta
    );
  }

  if (textoBruto === '') {
    throw new ErroClienteModeloOpenAI('resposta_vazia', 'output_text_vazio', tentativa, duracao(), modelo, statusHttpResposta);
  }

  // Nenhuma tentativa de consertar/reinterpretar: JSON.parse direto, sem
  // extracao de markdown, sem busca de JSON em texto.
  let objetoPortatil: unknown;
  try {
    objetoPortatil = JSON.parse(textoBruto);
  } catch {
    throw new ErroClienteModeloOpenAI('resposta_invalida', 'output_text_json_invalido', tentativa, duracao(), modelo, statusHttpResposta);
  }

  let naturezaMensagem: NaturezaMensagem;
  let alteracoesInternas: AlteracoesDados;
  try {
    if (objetoPortatil === null || typeof objetoPortatil !== 'object' || Array.isArray(objetoPortatil)) {
      throw new ErroConversaoPortatil('raiz_invalida');
    }
    const chavesRaizPortatil = Object.keys(objetoPortatil as Record<string, unknown>).sort();
    if (JSON.stringify(chavesRaizPortatil) !== JSON.stringify(['alteracoes', 'natureza_mensagem'])) {
      throw new ErroConversaoPortatil('propriedade_extra');
    }
    const { natureza_mensagem, alteracoes } = objetoPortatil as { natureza_mensagem: unknown; alteracoes: unknown };
    if (typeof natureza_mensagem !== 'string' || !NATUREZAS_MENSAGEM_PERMITIDAS.includes(natureza_mensagem as NaturezaMensagem)) {
      throw new ErroConversaoPortatil('natureza_mensagem_invalida');
    }
    naturezaMensagem = natureza_mensagem as NaturezaMensagem;
    alteracoesInternas = converterParaContratoInterno({ alteracoes });
  } catch (erroConversao) {
    const codigo = erroConversao instanceof ErroConversaoPortatil ? erroConversao.codigo : 'objeto_portatil_invalido';
    throw new ErroClienteModeloOpenAI('resposta_invalida', codigo, tentativa, duracao(), modelo, statusHttpResposta);
  }

  return { natureza_mensagem: naturezaMensagem, alteracoes: alteracoesInternas };
}

// AbortController so cancela I/O pendente (fetch/leitura do corpo) -- nao
// interrompe processamento sincrono que aconteca depois. Por isso, alem
// do timeout via AbortController, verificamos explicitamente o relogio
// de parede: logo apos a leitura integral do corpo, imediatamente antes
// de aceitar a resposta como sucesso, e imediatamente antes de propagar
// qualquer erro de classificacao produzido nesse intervalo -- nesse
// ultimo caso, se o prazo ja se esgotou, timeout prevalece sobre a
// classificacao original. O prazo e considerado esgotado com >=, nunca
// apenas com > (nao aceita sucesso ou classificacao tardia exatamente no
// limite).
function verificarPrazoOuLancarTimeout(
  tentativa: number,
  inicioTentativa: number,
  timeoutTentativaMs: number,
  inicioTotal: number,
  prazoTotalMs: number,
  duracaoTotal: number,
  modelo: string
): void {
  const decorridoNaTentativa = Date.now() - inicioTentativa;
  if (decorridoNaTentativa >= timeoutTentativaMs) {
    throw new ErroClienteModeloOpenAI('timeout', 'prazo_da_tentativa_excedido', tentativa, duracaoTotal, modelo);
  }
  const decorridoTotal = Date.now() - inicioTotal;
  if (decorridoTotal >= prazoTotalMs) {
    throw new ErroClienteModeloOpenAI('timeout', 'prazo_total_excedido', tentativa, duracaoTotal, modelo);
  }
}

// Examina todos os itens de `output` (inclusive os que nao sao do tipo
// "message") e todos os itens de `content` dentro de cada item de
// mensagem, procurando por `type === 'refusal'`. Tambem verifica
// `incomplete_details.reason` para indicadores oficiais de filtro de
// conteudo. Nunca incorpora o texto da recusa nem o motivo bruto no
// retorno -- so um booleano.
function detectarRecusaOuFiltro(envelope: Record<string, unknown>): boolean {
  const output = envelope.output;
  if (Array.isArray(output)) {
    for (const itemOutput of output) {
      const item = itemOutput as { type?: string; content?: unknown } | null;
      if (item?.type === 'refusal') return true;
      if (Array.isArray(item?.content)) {
        for (const itemConteudo of item.content as unknown[]) {
          if ((itemConteudo as { type?: string } | null)?.type === 'refusal') return true;
        }
      }
    }
  }

  const detalheIncompleto = envelope.incomplete_details;
  if (detalheIncompleto && typeof detalheIncompleto === 'object') {
    const motivo = (detalheIncompleto as { reason?: unknown }).reason;
    if (typeof motivo === 'string') {
      const motivoNormalizado = motivo.toLowerCase();
      if (motivoNormalizado.includes('filter') || motivoNormalizado.includes('safety') || motivoNormalizado.includes('refusal')) {
        return true;
      }
    }
  }

  return false;
}

// Delta-seconds so e aceito quando o header corresponder integralmente a
// um numero inteiro nao negativo (sem sinal, sem decimal, sem notacao
// exponencial, sem espacos). Qualquer outro formato numerico cai para a
// tentativa de data HTTP; se essa tambem falhar, o valor e ignorado.
const REGEX_RETRY_AFTER_SEGUNDOS_INTEIROS = /^[0-9]+$/;

// Interpreta o header Retry-After em segundos (formato estrito acima) ou
// em data HTTP canonica, devolvendo sempre um numero de milissegundos ja
// convertido (nunca o texto bruto, nunca armazenado em nenhum lugar).
// Valor invalido, ausente, ou que gere milissegundos nao finitos / maiores
// que Number.MAX_SAFE_INTEGER -> null (o chamador usa somente
// esperaEntreTentativasMs nesse caso).
//
// O formato de data so e aceito quando o header for EXATAMENTE a forma
// canonica RFC 1123 que o proprio runtime produziria para aquele instante
// (round-trip via toUTCString): Date.parse aceita, deliberadamente, uma
// familia ampla de formatos (ISO 8601, data local, variantes com
// espacamento diferente, formatos dependentes de runtime) -- nenhum
// desses e aceito aqui. Sem trim, sem normalizacao: a comparacao e
// sempre contra o texto recebido, byte a byte.
function interpretarRetryAfter(valorHeader: string | null): number | null {
  if (!valorHeader) return null;

  if (REGEX_RETRY_AFTER_SEGUNDOS_INTEIROS.test(valorHeader)) {
    const comoSegundos = Number(valorHeader);
    const comoMs = comoSegundos * 1000;
    if (Number.isFinite(comoMs) && comoMs <= Number.MAX_SAFE_INTEGER) {
      return Math.round(comoMs);
    }
    return null;
  }

  const comoTimestamp = Date.parse(valorHeader);
  if (!Number.isNaN(comoTimestamp) && new Date(comoTimestamp).toUTCString() === valorHeader) {
    const diferencaMs = comoTimestamp - Date.now();
    return diferencaMs > 0 ? diferencaMs : 0;
  }

  return null;
}

// --- Conversao deterministica: lista portatil -> mapa interno ---
//
// periodo e intencao continuam validados pelo Core existente
// (validarSaidaInterpretacao, chamado pelo chamador apos executar()) --
// esta funcao so trata das regras especificas do formato de lista
// (campo duplicado, coerencia acao/valor, forma de "remover"). Nenhuma
// aceitacao parcial: qualquer violacao invalida a resposta inteira.
export function converterParaContratoInterno(objetoPortatil: unknown): AlteracoesDados {
  if (objetoPortatil === null || typeof objetoPortatil !== 'object' || Array.isArray(objetoPortatil)) {
    throw new ErroConversaoPortatil('raiz_invalida');
  }
  const chavesRaiz = Object.keys(objetoPortatil as Record<string, unknown>);
  if (chavesRaiz.length !== 1 || chavesRaiz[0] !== 'alteracoes') {
    throw new ErroConversaoPortatil('propriedade_extra');
  }

  const alteracoes = (objetoPortatil as { alteracoes?: unknown }).alteracoes;
  if (!Array.isArray(alteracoes)) {
    throw new ErroConversaoPortatil('alteracoes_invalida');
  }

  const resultado: AlteracoesDados = {};
  const camposVistos = new Set<string>();

  for (const item of alteracoes) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new ErroConversaoPortatil('item_invalido');
    }
    const chavesItem = Object.keys(item as Record<string, unknown>).sort();
    if (JSON.stringify(chavesItem) !== JSON.stringify(['acao', 'campo', 'valor'])) {
      throw new ErroConversaoPortatil('item_propriedade_extra');
    }

    const { campo, acao, valor } = item as { campo: unknown; acao: unknown; valor: unknown };

    if (typeof campo !== 'string' || !CAMPOS_PERMITIDOS.includes(campo as CampoDadosConversa)) {
      throw new ErroConversaoPortatil('campo_desconhecido');
    }
    if (camposVistos.has(campo)) {
      throw new ErroConversaoPortatil('campo_duplicado');
    }
    camposVistos.add(campo);

    if (typeof acao !== 'string' || !ACOES_PERMITIDAS.includes(acao as AcaoAlteracaoDados)) {
      throw new ErroConversaoPortatil('acao_desconhecida');
    }

    if (acao === 'remover') {
      if (valor !== null) {
        throw new ErroConversaoPortatil('remover_com_valor');
      }
      resultado[campo] = { acao: 'remover' };
    } else {
      if (typeof valor !== 'string' || valor.trim() === '') {
        throw new ErroConversaoPortatil('valor_invalido');
      }
      resultado[campo] = { acao, valor };
    }
  }

  return resultado;
}

// --- Compatibilizacao da instrucao recebida com o transporte portatil ---
//
// `entrada.instrucoes` (INSTRUCOES_EXTRATOR, tal como hoje) descreve, na
// sua ultima regra estrutural, o formato interno antigo do Core -- mesma
// situacao ja resolvida no avaliador semantico (src/eval/). Substituimos
// EXCLUSIVAMENTE essa frase, preservando tudo o mais palavra por palavra.
// Nao importa nem duplica INSTRUCOES_EXTRATOR -- opera sobre o que foi
// efetivamente recebido em `entrada.instrucoes`.
const FRASE_ESTRUTURAL_FORMATO_INTERNO_ANTIGO =
  'Responda estritamente no formato do schema fornecido — nenhuma propriedade alem de "natureza_mensagem" e "alteracoes" no nivel principal, nenhuma propriedade alem de "acao"/"valor" (ou somente "acao" para remover) dentro de cada alteracao.';

const FRASE_ESTRUTURAL_TRANSPORTE_PORTATIL =
  'Responda estritamente no formato do schema fornecido — a raiz contem somente "natureza_mensagem" e "alteracoes"; "alteracoes" e uma lista; cada item da lista contem exatamente "campo", "acao" e "valor"; informar e corrigir usam "valor" como string; remover usa "valor": null; nenhuma propriedade adicional e permitida.';

function construirInstrucoesPortatil(instrucoesBase: string): string {
  const ocorrencias = instrucoesBase.split(FRASE_ESTRUTURAL_FORMATO_INTERNO_ANTIGO).length - 1;
  if (ocorrencias !== 1) {
    throw new Error(
      `instrucoes fornecidas nao contem a frase estrutural esperada exatamente uma vez (encontradas: ${ocorrencias}) -- abortando antes de qualquer chamada`
    );
  }
  const substituida = instrucoesBase.replace(FRASE_ESTRUTURAL_FORMATO_INTERNO_ANTIGO, FRASE_ESTRUTURAL_TRANSPORTE_PORTATIL);

  const restanteOriginal = instrucoesBase.replace(FRASE_ESTRUTURAL_FORMATO_INTERNO_ANTIGO, '');
  const restanteSubstituido = substituida.replace(FRASE_ESTRUTURAL_TRANSPORTE_PORTATIL, '');
  if (restanteOriginal !== restanteSubstituido) {
    throw new Error('a substituicao alterou algo alem da frase estrutural -- abortando antes de qualquer chamada');
  }

  return substituida;
}

function aguardar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
