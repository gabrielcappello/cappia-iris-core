// SHADOW do contrato `ResultadoIris` (spec contexto-conversacional-unificado-v2.md).
//
// ── O QUE ESTE MODULO E, E O QUE NAO E ──────────────────────────────────
// Mede, em paralelo ao atendimento real, se a IA produz a ACAO CERTA quando
// recebe o contexto unificado v2 -- incluindo `aguardando_resposta`, a
// anotacao do que a Iris perguntou no turno anterior.
//
// NAO decide nada. NAO executa capacidade. NAO altera `estado_conversa`. NAO
// muda a resposta ao paciente. So chama o modelo, compara com a decisao que o
// Core ja tomou, e escreve UMA linha de log com rotulos -- sem PII.
//
// Mesmo mecanismo ja validado em producao pelo shadow do contrato v1
// (`sombra-contexto-unificado.ts`): roda DEPOIS da resposta ja decidida e
// gravada, nunca e aguardado antes do `return`, e NUNCA lanca.
//
// ── POR QUE UM SHADOW SEPARADO, E NAO ESTENDER O V1 ─────────────────────
// Sao contratos diferentes, medindo coisas diferentes:
//   - v1 (`SaidaContratoUnificado`): `acao_solicitada: {tipo, referencia}`
//     generico, ja validado em shadow real de producao;
//   - v2 (`ResultadoIris`): `Acao` com parametros proprios por operacao --
//     `escolher_horario`, `confirmar {operacao}`, `cancelar {agendamento_id}`.
//
// Fundir os dois num modulo so misturaria duas medicoes com criterios
// distintos, e o v1 continua sendo o unico com shadow de producao aprovado.
// Quando o v2 tiver evidencia suficiente, o v1 sai -- nao antes.
//
// ── O QUE ESTE SHADOW MEDE ──────────────────────────────────────────────
// A concordancia entre a ACAO que a IA emite e a DECISAO que o Core tomou
// pelo caminho atual. Nao e "quem esta certo": e quanto os dois divergem, e
// em quais situacoes. Divergencia nao e defeito automatico -- pode ser o
// contrato novo acertando onde o atual erra, que e justamente o motivo da
// troca. Por isso o log registra o PAR, nunca um veredito.
//
// ── PII ─────────────────────────────────────────────────────────────────
// O log carrega somente ROTULOS: tipo da acao, tipo da decisao, tipo da
// pergunta pendente e contagens. Nunca texto do paciente, nunca valor de
// campo, nunca nome de pessoa, nunca id de agendamento.

import { INSTRUCOES_RESULTADO_IRIS, SCHEMA_RESULTADO_IRIS } from './resultado-iris-instrucoes.ts';
import type { ContextoUnificadoSemMensagem } from './sombra-contexto-unificado.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';

const URL_RESPONSES = 'https://api.openai.com/v1/responses';

/**
 * Modelo desta medicao. `gpt-5.6-luna` -- o mesmo das rodadas 1, 2 e 3 de
 * `prova-resultado-iris.ts`, e diferente do que atende producao hoje
 * (`gpt-4.1-mini`). E deliberado: o contrato v2 existe porque este modelo
 * trabalha melhor com acoes parametrizadas, e medir com o modelo antigo nao
 * responderia a pergunta que importa.
 */
const MODELO = 'gpt-5.6-luna';
const REASONING_EFFORT = 'none';
const MAX_OUTPUT_TOKENS = 800;
const TIMEOUT_MS = 10_000;

export type EstadoMedicaoIris =
  | 'ok'
  | 'timeout'
  | 'erro_rede'
  | 'erro_http'
  | 'erro_estrutural'
  | 'recusa';

export interface ResultadoMedicaoIris {
  estado: EstadoMedicaoIris;
  /** Rotulo da acao emitida (`confirmar`, `escolher_horario`...) ou `null`. */
  acao: string | null;
  /** `operacao` da acao, quando ela tem uma -- distingue criar/remarcar/cancelar. */
  operacao: string | null;
  /** Tipo da pergunta pendente que ENTROU no contexto, ou `null`. */
  pergunta_pendente: string | null;
  /** Tipo da decisao que o Core tomou pelo caminho atual, para comparacao. */
  decisao_atual: string;
  /** Quantos campos a IA declarou em `informacoes_fornecidas`. */
  campos: number;
  duracao_ms: number;
}

export interface EntradaMedicaoIris {
  chaveApi: string;
  contexto: ContextoUnificadoSemMensagem & { mensagem_atual: string };
  decisaoAtual: DecisaoOrquestrador['tipo'];
  fetchInjetado?: typeof fetch;
  timeoutMsInjetado?: number;
}

function falha(
  estado: EstadoMedicaoIris,
  entrada: EntradaMedicaoIris,
  duracaoMs: number
): ResultadoMedicaoIris {
  return {
    estado,
    acao: null,
    operacao: null,
    pergunta_pendente: rotuloPerguntaPendente(entrada.contexto),
    decisao_atual: entrada.decisaoAtual,
    campos: 0,
    duracao_ms: duracaoMs,
  };
}

/** So o TIPO da pergunta -- nunca as opcoes, que carregam data/horario/nome. */
function rotuloPerguntaPendente(contexto: ContextoUnificadoSemMensagem): string | null {
  const pendente = contexto.contexto_relevante?.aguardando_resposta;
  return pendente === null || pendente === undefined ? null : pendente.tipo;
}

/**
 * Mede o contrato v2 contra o modelo real. NUNCA LANCA -- toda falha vira um
 * `estado` proprio, porque esta funcao roda em producao ao lado do
 * atendimento e nao pode transformar um turno bem-sucedido em erro.
 */
export async function medirResultadoIris(
  entrada: EntradaMedicaoIris
): Promise<ResultadoMedicaoIris> {
  const inicio = Date.now();
  const fetchUsado = entrada.fetchInjetado ?? fetch;
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), entrada.timeoutMsInjetado ?? TIMEOUT_MS);

  try {
    let resposta: Response;
    try {
      resposta = await fetchUsado(URL_RESPONSES, {
        method: 'POST',
        headers: { Authorization: `Bearer ${entrada.chaveApi}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODELO,
          reasoning: { effort: REASONING_EFFORT },
          input: [
            { role: 'system', content: INSTRUCOES_RESULTADO_IRIS },
            { role: 'user', content: JSON.stringify(entrada.contexto) },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'resultado_iris_v2',
              schema: SCHEMA_RESULTADO_IRIS,
              strict: true,
            },
          },
          max_output_tokens: MAX_OUTPUT_TOKENS,
          store: false,
          stream: false,
          background: false,
        }),
        signal: controlador.signal,
      });
    } catch {
      return falha(controlador.signal.aborted ? 'timeout' : 'erro_rede', entrada, Date.now() - inicio);
    }

    if (!resposta.ok) return falha('erro_http', entrada, Date.now() - inicio);

    let envelope: Record<string, unknown>;
    try {
      envelope = (await resposta.json()) as Record<string, unknown>;
    } catch {
      return falha('erro_estrutural', entrada, Date.now() - inicio);
    }

    const output = envelope.output;
    if (!Array.isArray(output)) return falha('erro_estrutural', entrada, Date.now() - inicio);
    for (const item of output) {
      if ((item as { type?: string } | null)?.type === 'refusal') {
        return falha('recusa', entrada, Date.now() - inicio);
      }
    }

    const texto = extrairTexto(output);
    if (texto === null) return falha('erro_estrutural', entrada, Date.now() - inicio);

    let saida: Record<string, unknown>;
    try {
      saida = JSON.parse(texto) as Record<string, unknown>;
    } catch {
      return falha('erro_estrutural', entrada, Date.now() - inicio);
    }

    const acao = saida.acao as Record<string, unknown> | null | undefined;
    const informacoes = saida.informacoes_fornecidas;

    return {
      estado: 'ok',
      acao: typeof acao?.tipo === 'string' ? acao.tipo : null,
      operacao: typeof acao?.operacao === 'string' ? acao.operacao : null,
      pergunta_pendente: rotuloPerguntaPendente(entrada.contexto),
      decisao_atual: entrada.decisaoAtual,
      campos: Array.isArray(informacoes) ? informacoes.length : 0,
      duracao_ms: Date.now() - inicio,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extrairTexto(output: readonly unknown[]): string | null {
  for (const item of output) {
    const conteudo = (item as { content?: unknown } | null)?.content;
    if (!Array.isArray(conteudo)) continue;
    for (const parte of conteudo) {
      const p = parte as { type?: string; text?: unknown } | null;
      if (p?.type === 'output_text' && typeof p.text === 'string') return p.text;
    }
  }
  return null;
}

/**
 * Uma linha por turno, so com rotulos.
 *
 * `divergiu` e o sinal que interessa: quando a acao do contrato novo NAO
 * corresponde a decisao do caminho atual. Nao e veredito de erro -- e o par
 * que sera lido depois, agregado, para decidir o corte.
 */
export function registrarMedicaoIris(resultado: ResultadoMedicaoIris): void {
  console.log(
    `sombra_iris_v2 estado=${resultado.estado} ` +
      `acao=${resultado.acao ?? 'null'} operacao=${resultado.operacao ?? 'null'} ` +
      `pergunta_pendente=${resultado.pergunta_pendente ?? 'null'} ` +
      `decisao_atual=${resultado.decisao_atual} ` +
      `campos=${resultado.campos} duracao_ms=${resultado.duracao_ms}`
  );
}
