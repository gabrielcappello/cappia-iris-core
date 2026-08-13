// ETAPA 0 da Arquitetura V2 (docs/07-arquitetura-v2.md secao 10):
// INSTRUMENTO DE MEDICAO fiel.
//
// ── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────
// `src/core/cliente-modelo-openai.ts` e um adaptador de UM contrato, nao um
// cliente generico. Ele esta preso ao contrato de extracao em QUATRO pontos
// independentes, nao um:
//
//   1. SCHEMA   -- o parametro `schema` de `executar()` e ignorado; o corpo
//                  real sempre leva SCHEMA_PORTATIL_APROVADO (linha ~461).
//   2. PAYLOAD  -- montado campo a campo, com as chaves fixas de
//                  EntradaInterpretacao; qualquer chave nova e descartada
//                  em silencio (linhas ~391-454).
//   3. INSTRUCAO-- `construirInstrucoesPortatil` EXIGE que o texto contenha
//                  uma frase estrutural especifica exatamente uma vez, e
//                  lanca se nao contiver (linha ~980).
//   4. RESPOSTA -- `classificarEConverter` devolve uma forma fixa e recusa
//                  qualquer chave raiz alem das quatro conhecidas (~708).
//
// Medir um contrato novo atraves dele nao e dificil: e IMPOSSIVEL. Qualquer
// tentativa mede o contrato antigo de novo -- exatamente o vies que a
// auditoria de 2026-08-12 identificou como causa das medicoes 0/20, 1/20 e
// 3/20.
//
// ── O QUE ESTE CLIENTE E, E O QUE NAO E ─────────────────────────────────
// E um instrumento de MEDICAO, usado somente por runners de `src/eval/`.
// NAO e chamado por producao, nao substitui o cliente de producao, e nao
// deve ser importado por nenhum modulo de `src/core/`.
//
// FIEL onde importa (para a medicao valer para producao): mesmo modelo,
// mesmo endpoint, mesma forma de transporte (system+user), mesmo
// Structured Outputs com `strict: true`, mesmos limites de token.
// GENERICO onde precisa ser (para medir o que ainda nao existe): schema,
// instrucao e payload passam INTACTOS, sem reescrita nem filtro.
//
// A fidelidade nao e afirmada por comentario: `validacao-cliente-medicao.ts`
// reproduz, por este cliente, o resultado ja conhecido do contrato antigo.

const URL_RESPONSES = 'https://api.openai.com/v1/responses';

/** Mesmo modelo das medicoes anteriores e da producao. */
export const MODELO_MEDICAO = 'gpt-4.1-mini-2025-04-14';

/** Mesmo limite do cliente de producao -- truncamento acontece nos mesmos pontos. */
const MAX_OUTPUT_TOKENS = 512;

const TIMEOUT_PADRAO_MS = 20000;

export type CategoriaErroMedicao =
  | 'configuracao'
  | 'http'
  | 'timeout'
  | 'rede'
  | 'resposta_truncada'
  | 'recusa_ou_filtro'
  | 'resposta_invalida';

/**
 * Nunca carrega a chave de API, nem o corpo bruto da resposta. Carrega o
 * status HTTP e um codigo tecnico fixo -- o suficiente para um runner
 * decidir se repete.
 *
 * DIFERENCA DELIBERADA em relacao ao cliente de producao: la, um erro de
 * PROGRAMACAO (ex.: instrucoes sem a frase estrutural exigida) e capturado
 * pelo `catch` generico de `executarUmaTentativa` e reclassificado como
 * `indisponibilidade/erro_de_rede` -- que esta em CATEGORIAS_REPETIVEIS e
 * portanto ainda e repetido uma vez, inutilmente. Foi exatamente o que
 * aconteceu na sonda de 2026-08-12: o erro real ficou invisivel atras de
 * "erro_de_rede". Aqui, erro de configuracao/programacao nunca vira erro de
 * rede.
 */
export class ErroClienteMedicao extends Error {
  categoria: CategoriaErroMedicao;
  codigo: string;
  statusHttp: number | null;

  constructor(categoria: CategoriaErroMedicao, codigo: string, statusHttp: number | null = null) {
    super(`cliente de medicao: categoria=${categoria} codigo=${codigo}`);
    this.name = 'ErroClienteMedicao';
    this.categoria = categoria;
    this.codigo = codigo;
    this.statusHttp = statusHttp;
  }
}

export interface ConfiguracaoClienteMedicao {
  chaveApi: string;
  /** Default: MODELO_MEDICAO. Explicito quando a medicao comparar modelos. */
  modelo?: string;
  timeoutMs?: number;
}

export interface ChamadaMedicao {
  /** Enviado como mensagem `system`, LITERAL -- nunca reescrito. */
  instrucoes: string;
  /** JSON Schema enviado como está. Precisa ser valido para `strict: true`. */
  schema: object;
  /** Serializado como mensagem `user`. Qualquer forma -- nenhuma chave e filtrada. */
  payload: unknown;
  /** Nome do schema no protocolo da OpenAI. Irrelevante para o resultado. */
  nomeSchema?: string;
}

export interface ClienteMedicao {
  /** Devolve o objeto estruturado do modelo, JA parseado e SEM conversao. */
  executar(chamada: ChamadaMedicao): Promise<unknown>;
}

export function criarClienteMedicao(configuracao: ConfiguracaoClienteMedicao): ClienteMedicao {
  if (typeof configuracao.chaveApi !== 'string' || configuracao.chaveApi.trim() === '') {
    throw new ErroClienteMedicao('configuracao', 'chave_api_ausente');
  }
  const chaveApi = configuracao.chaveApi;
  const modelo = configuracao.modelo ?? MODELO_MEDICAO;
  const timeoutMs = configuracao.timeoutMs ?? TIMEOUT_PADRAO_MS;

  return {
    async executar(chamada: ChamadaMedicao): Promise<unknown> {
      if (typeof chamada.instrucoes !== 'string' || chamada.instrucoes.trim() === '') {
        throw new ErroClienteMedicao('configuracao', 'instrucoes_ausentes');
      }
      if (chamada.schema === null || typeof chamada.schema !== 'object') {
        throw new ErroClienteMedicao('configuracao', 'schema_ausente');
      }

      // MESMA forma de transporte do cliente de producao: duas mensagens
      // (system + user), payload como JSON no `user`.
      const corpo = {
        model: modelo,
        input: [
          { role: 'system', content: chamada.instrucoes },
          { role: 'user', content: JSON.stringify(chamada.payload) },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: chamada.nomeSchema ?? 'medicao',
            schema: chamada.schema,
            strict: true,
          },
        },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
        stream: false,
        background: false,
      };

      const controlador = new AbortController();
      const timer = setTimeout(() => controlador.abort(), timeoutMs);
      let resposta: Response;
      try {
        resposta = await fetch(URL_RESPONSES, {
          method: 'POST',
          headers: { Authorization: `Bearer ${chaveApi}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
          signal: controlador.signal,
        });
      } catch (erro) {
        if (controlador.signal.aborted) throw new ErroClienteMedicao('timeout', 'tempo_esgotado');
        throw new ErroClienteMedicao('rede', 'falha_de_rede');
      } finally {
        clearTimeout(timer);
      }

      if (!resposta.ok) {
        throw new ErroClienteMedicao('http', `http_${resposta.status}`, resposta.status);
      }

      const envelope = (await resposta.json()) as Record<string, unknown>;

      if (detectarRecusaOuFiltro(envelope)) {
        throw new ErroClienteMedicao('recusa_ou_filtro', 'recusa_ou_filtro_detectado');
      }
      if (envelope.status !== 'completed') {
        // Mesmo criterio do cliente de producao: qualquer status diferente
        // de "completed" e truncamento. Runners costumam repetir este caso.
        throw new ErroClienteMedicao('resposta_truncada', 'resposta_incompleta');
      }

      const texto = extrairTextoEstruturado(envelope);
      try {
        return JSON.parse(texto);
      } catch {
        throw new ErroClienteMedicao('resposta_invalida', 'saida_nao_e_json');
      }
    },
  };
}

function extrairTextoEstruturado(envelope: Record<string, unknown>): string {
  const output = envelope.output;
  if (!Array.isArray(output)) throw new ErroClienteMedicao('resposta_invalida', 'output_ausente');

  const mensagem = output.find((item) => (item as { type?: string })?.type === 'message') as
    | { content?: unknown }
    | undefined;
  if (!mensagem || !Array.isArray(mensagem.content)) {
    throw new ErroClienteMedicao('resposta_invalida', 'mensagem_ausente');
  }

  const item = mensagem.content.find((c) => (c as { type?: string })?.type === 'output_text') as
    | { text?: unknown }
    | undefined;
  if (!item || typeof item.text !== 'string' || item.text === '') {
    throw new ErroClienteMedicao('resposta_invalida', 'texto_estruturado_ausente');
  }
  return item.text;
}

// Mesma deteccao do cliente de producao, sem incorporar o texto da recusa.
function detectarRecusaOuFiltro(envelope: Record<string, unknown>): boolean {
  const output = envelope.output;
  if (Array.isArray(output)) {
    for (const itemOutput of output) {
      const item = itemOutput as { type?: string; content?: unknown } | null;
      if (item?.type === 'refusal') return true;
      if (Array.isArray(item?.content)) {
        for (const conteudo of item.content as unknown[]) {
          if ((conteudo as { type?: string } | null)?.type === 'refusal') return true;
        }
      }
    }
  }
  const incompleto = envelope.incomplete_details;
  if (incompleto && typeof incompleto === 'object') {
    const motivo = (incompleto as { reason?: unknown }).reason;
    if (typeof motivo === 'string') {
      const n = motivo.toLowerCase();
      if (n.includes('filter') || n.includes('safety') || n.includes('refusal')) return true;
    }
  }
  return false;
}
