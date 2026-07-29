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
import type { ClienteModeloEstruturado, EntradaInterpretacao } from './interpretacao-tipos.ts';
import type { AcaoAlteracaoDados, AlteracoesDados, CampoDadosConversa } from './tipos.ts';

export const MODELO_GPT_4_1_MINI = 'gpt-4.1-mini-2025-04-14';

const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const MAX_OUTPUT_TOKENS = 512;
const MAX_TENTATIVAS = 2;

const TIMEOUT_POR_TENTATIVA_MS_PADRAO = 8000;
const PRAZO_TOTAL_MS_PADRAO = 18000;
const ESPERA_ENTRE_TENTATIVAS_MS_PADRAO = 500;

// --- Schema portatil aprovado (identico ao usado no smoke test e no
// avaliador semantico -- unica forma ja validada contra o Structured
// Outputs estrito da OpenAI). Sempre usado no corpo real da requisicao,
// independente do `schema` recebido em `executar()`. ---
const SCHEMA_PORTATIL_APROVADO = {
  type: 'object',
  properties: {
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
  required: ['alteracoes'],
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

const CATEGORIAS_REPETIVEIS = new Set<CategoriaErroModelo>([
  'limite_taxa',
  'indisponibilidade',
  'timeout',
  'resposta_vazia',
]);

// So pode conter: categoria, codigo tecnico, numero de tentativas,
// duracao, modelo, status HTTP quando existir. Nunca mensagem do
// paciente, dados_atuais, resposta bruta, valores interpretados, PII,
// chave ou corpo bruto de erro da API.
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
    statusHttp: number | null = null
  ) {
    super(`cliente de modelo OpenAI: categoria=${categoria} codigo=${codigo} tentativas=${tentativas}`);
    this.name = 'ErroClienteModeloOpenAI';
    this.categoria = categoria;
    this.codigo = codigo;
    this.tentativas = tentativas;
    this.duracaoMs = duracaoMs;
    this.modelo = modelo;
    this.statusHttp = statusHttp;
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
  timeoutPorTentativaMs?: number;
  prazoTotalMs?: number;
  esperaEntreTentativasMs?: number;
}

/**
 * Cria um ClienteModeloEstruturado concreto para a OpenAI Responses API.
 * Nenhuma chamada e feita na criacao -- so na primeira invocacao de
 * `executar()`. Config injetada, nunca lida de process.env.
 */
export function criarClienteModeloOpenAI(configuracao: ConfiguracaoClienteModeloOpenAI): ClienteModeloEstruturado {
  if (!configuracao.chaveApi || configuracao.chaveApi.trim() === '') {
    throw new Error('criarClienteModeloOpenAI: chaveApi e obrigatoria');
  }
  if (!configuracao.modelo || configuracao.modelo.trim() === '') {
    throw new Error('criarClienteModeloOpenAI: modelo e obrigatorio');
  }

  const chaveApi = configuracao.chaveApi;
  const modelo = configuracao.modelo;
  const fetchInjetado = configuracao.fetch ?? fetch;
  const timeoutPorTentativaMs = configuracao.timeoutPorTentativaMs ?? TIMEOUT_POR_TENTATIVA_MS_PADRAO;
  const prazoTotalMs = configuracao.prazoTotalMs ?? PRAZO_TOTAL_MS_PADRAO;
  const esperaEntreTentativasMs = configuracao.esperaEntreTentativasMs ?? ESPERA_ENTRE_TENTATIVAS_MS_PADRAO;

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

interface ContextoChamada {
  entrada: { instrucoes: string; schema: object; payload: EntradaInterpretacao };
  chaveApi: string;
  modelo: string;
  fetchInjetado: typeof fetch;
  timeoutPorTentativaMs: number;
  prazoTotalMs: number;
  esperaEntreTentativasMs: number;
}

async function executarComRetry(contexto: ContextoChamada): Promise<unknown> {
  const inicioTotal = Date.now();
  let ultimoErro: ErroClienteModeloOpenAI | null = null;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const decorrido = Date.now() - inicioTotal;
    const restante = contexto.prazoTotalMs - decorrido;
    if (restante <= 0) {
      throw new ErroClienteModeloOpenAI('timeout', 'prazo_total_excedido', tentativa - 1, decorrido, contexto.modelo);
    }

    const timeoutEfetivo = Math.min(contexto.timeoutPorTentativaMs, restante);

    try {
      return await executarUmaTentativa(contexto, tentativa, timeoutEfetivo, inicioTotal);
    } catch (erro) {
      if (!(erro instanceof ErroClienteModeloOpenAI)) throw erro;
      ultimoErro = erro;

      if (!CATEGORIAS_REPETIVEIS.has(erro.categoria) || tentativa >= MAX_TENTATIVAS) {
        throw erro;
      }

      const restanteAposFalha = contexto.prazoTotalMs - (Date.now() - inicioTotal);
      if (restanteAposFalha <= 0) {
        throw erro;
      }
      const espera = Math.min(contexto.esperaEntreTentativasMs, restanteAposFalha);
      if (espera > 0) await aguardar(espera);
    }
  }

  throw (
    ultimoErro ??
    new ErroClienteModeloOpenAI('indisponibilidade', 'falha_desconhecida', MAX_TENTATIVAS, Date.now() - inicioTotal, contexto.modelo)
  );
}

async function executarUmaTentativa(
  contexto: ContextoChamada,
  tentativa: number,
  timeoutMs: number,
  inicioTotal: number
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
  // nenhuma chave 'tools' incluida em nenhuma hipotese; nenhum dado alem
  // de mensagens_atuais/dados_atuais chega no corpo.

  let resposta: Response;
  try {
    resposta = await chamarComTimeout(
      contexto.fetchInjetado,
      URL_RESPONSES,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${contexto.chaveApi}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(corpo),
      },
      timeoutMs
    );
  } catch (erroRede) {
    const duracao = Date.now() - inicioTotal;
    const foiAbort = erroRede instanceof Error && erroRede.name === 'AbortError';
    if (foiAbort) {
      throw new ErroClienteModeloOpenAI('timeout', 'tempo_esgotado_na_tentativa', tentativa, duracao, contexto.modelo);
    }
    throw new ErroClienteModeloOpenAI('indisponibilidade', 'erro_de_rede', tentativa, duracao, contexto.modelo);
  }

  const duracao = Date.now() - inicioTotal;

  if (!resposta.ok) {
    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroClienteModeloOpenAI('autenticacao', 'nao_autorizado', tentativa, duracao, contexto.modelo, resposta.status);
    }
    if (resposta.status === 429) {
      throw new ErroClienteModeloOpenAI('limite_taxa', 'limite_de_taxa_excedido', tentativa, duracao, contexto.modelo, resposta.status);
    }
    if (resposta.status >= 500) {
      throw new ErroClienteModeloOpenAI('indisponibilidade', 'erro_do_servidor', tentativa, duracao, contexto.modelo, resposta.status);
    }
    throw new ErroClienteModeloOpenAI(
      'resposta_invalida',
      'erro_http_nao_recuperavel',
      tentativa,
      duracao,
      contexto.modelo,
      resposta.status
    );
  }

  const corpoResposta = await resposta.json().catch(() => null);
  if (corpoResposta === null || typeof corpoResposta !== 'object') {
    throw new ErroClienteModeloOpenAI('resposta_vazia', 'corpo_nao_e_json', tentativa, duracao, contexto.modelo, resposta.status);
  }

  const status = (corpoResposta as { status?: unknown }).status;
  if (typeof status === 'string' && status !== 'completed') {
    throw new ErroClienteModeloOpenAI('resposta_truncada', `status_${status}`, tentativa, duracao, contexto.modelo, resposta.status);
  }

  const output = (corpoResposta as { output?: unknown }).output;
  const itemMensagem = Array.isArray(output)
    ? output.find((item: { type?: string }) => item?.type === 'message')
    : null;
  if (!itemMensagem) {
    throw new ErroClienteModeloOpenAI('resposta_vazia', 'sem_item_de_mensagem', tentativa, duracao, contexto.modelo, resposta.status);
  }

  const conteudo = Array.isArray((itemMensagem as { content?: unknown }).content)
    ? (itemMensagem as { content: unknown[] }).content[0]
    : null;
  if (!conteudo) {
    throw new ErroClienteModeloOpenAI('resposta_vazia', 'sem_conteudo', tentativa, duracao, contexto.modelo, resposta.status);
  }

  const tipoConteudo = (conteudo as { type?: string }).type;
  if (tipoConteudo === 'refusal') {
    throw new ErroClienteModeloOpenAI('recusa_ou_filtro', 'modelo_recusou', tentativa, duracao, contexto.modelo, resposta.status);
  }

  const textoBruto = (conteudo as { text?: unknown }).text;
  if (tipoConteudo !== 'output_text' || typeof textoBruto !== 'string') {
    throw new ErroClienteModeloOpenAI(
      'resposta_nao_estruturada',
      'canal_estruturado_ausente',
      tentativa,
      duracao,
      contexto.modelo,
      resposta.status
    );
  }

  // Nenhuma tentativa de consertar/reinterpretar: JSON.parse direto, sem
  // extracao de markdown, sem busca de JSON em texto.
  let objetoPortatil: unknown;
  try {
    objetoPortatil = JSON.parse(textoBruto);
  } catch {
    throw new ErroClienteModeloOpenAI('resposta_invalida', 'json_invalido', tentativa, duracao, contexto.modelo, resposta.status);
  }

  try {
    const alteracoesInternas = converterParaContratoInterno(objetoPortatil);
    return { alteracoes: alteracoesInternas };
  } catch (erroConversao) {
    const codigo = erroConversao instanceof ErroConversaoPortatil ? erroConversao.codigo : 'conversao_falhou';
    throw new ErroClienteModeloOpenAI('resposta_invalida', codigo, tentativa, duracao, contexto.modelo, resposta.status);
  }
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
  'Responda estritamente no formato do schema fornecido — nenhuma propriedade alem de "alteracoes" no nivel principal, nenhuma propriedade alem de "acao"/"valor" (ou somente "acao" para remover) dentro de cada alteracao.';

const FRASE_ESTRUTURAL_TRANSPORTE_PORTATIL =
  'Responda estritamente no formato do schema fornecido — a raiz contem somente "alteracoes"; "alteracoes" e uma lista; cada item da lista contem exatamente "campo", "acao" e "valor"; informar e corrigir usam "valor" como string; remover usa "valor": null; nenhuma propriedade adicional e permitida.';

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

async function chamarComTimeout(
  fetchFn: typeof fetch,
  url: string,
  opcoes: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...opcoes, signal: controlador.signal });
  } finally {
    clearTimeout(timer);
  }
}
