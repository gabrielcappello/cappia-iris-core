// Adaptador fino da IA REDATORA para a OpenAI Responses API (specs/
// resposta-conversacional-v1.md secao 3). Separado de cliente-modelo-
// openai.ts de proposito: a interpretadora exige Structured Outputs
// estrito, retry com categorizacao fina de erro e orcamento de tempo em
// duas tentativas -- nenhuma dessas exigencias existe aqui. Qualquer falha
// da redatora (rede, timeout, resposta vazia) cai no MESMO lugar: o
// chamador usa o fallback deterministico (spec secao 6). Por isso uma UNICA
// tentativa, sem retry: o retry so reduziria a frequencia do fallback, e o
// fallback ja e a rede de seguranca exigida pela spec -- adicionar retry
// aqui duplicaria complexidade ja resolvida em cliente-modelo-openai.ts sem
// necessidade real.
//
// Nenhuma chave 'tools' e incluida em nenhuma hipotese (spec secao 9: "a
// IA redatora nunca executa nada").

import type { FatosAutorizados } from './fatos-autorizados.ts';
import type { NaturezaMensagem } from './interpretacao-tipos.ts';
import type { ParConversa } from './tipos.ts';

const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const MAX_OUTPUT_TOKENS = 300;

// Unica tentativa, sem retry (ver cabecalho do arquivo) -- valor de
// referencia aprovado, nunca usado como default silencioso: o chamador
// fornece timeoutMs explicitamente.
export const TIMEOUT_REDATOR_MS_APROVADO = 6000;

export interface EntradaRedator {
  instrucoes: string;
  mensagemPaciente: string;
  /** Classificacao da mensagem atual (specs/memoria-conversacional-minima-v1.md secao 3). */
  naturezaMensagem: NaturezaMensagem;
  fatos: FatosAutorizados;
  nomeClinica?: string;
  /** Ultimos turnos da conversa, quando dentro da janela de validade -- AUSENTE (nunca `null`) quando nao ha nenhum. Ver historico-conversa.ts. */
  historicoRecente?: ParConversa[];
  /**
   * Data de hoje neste turno (`YYYY-MM-DD`), a MESMA referencia que o Core
   * usou (2026-08-17).
   *
   * Ate aqui a instrucao dizia "voce nao sabe que dia e hoje" -- proibicao
   * herdada de um caso real de 2026-08-14, em que a redatora deduziu a
   * relacao errada ("amanha, 14/08" para uma proposta de HOJE). A protecao
   * necessaria era outra: nao CONTRADIZER a relacao que o Core informa.
   * Ignorar o calendario a impedia de entender "quarta-feira" ou "semana que
   * vem" -- e numa conversa real ela calculou a data certa, disse ao
   * paciente, e nao pode usar.
   */
  dataHoje?: string;
  // NAO existe `cadastroConhecido` aqui de proposito: o cadastro do paciente
  // chega ao modelo DENTRO de `fatos` (`fatos_autorizados.cadastro_conhecido`,
  // montado por `derivarFatosAutorizados`). Um campo proprio neste nivel
  // seria caminho morto -- e chegou a existir por engano em 2026-08-17, ate a
  // guarda de fronteira apontar que ele nunca chegava ao corpo HTTP.
}

export interface ClienteModeloRedator {
  redigir(entrada: EntradaRedator): Promise<string>;
}

export class ErroClienteModeloRedator extends Error {
  codigo: string;
  constructor(codigo: string) {
    super(`cliente de modelo redator: codigo=${codigo}`);
    this.name = 'ErroClienteModeloRedator';
    this.codigo = codigo;
  }
}

export interface ConfiguracaoClienteModeloRedatorOpenAI {
  chaveApi: string;
  modelo: string;
  fetch?: typeof fetch;
  timeoutMs: number;
}

export function criarClienteModeloRedatorOpenAI(configuracao: ConfiguracaoClienteModeloRedatorOpenAI): ClienteModeloRedator {
  if (typeof configuracao.chaveApi !== 'string' || configuracao.chaveApi.trim() === '') {
    throw new ErroClienteModeloRedator('configuracao_chave_api_invalida');
  }
  if (typeof configuracao.modelo !== 'string' || configuracao.modelo.trim() === '') {
    throw new ErroClienteModeloRedator('configuracao_modelo_invalido');
  }
  if (!Number.isFinite(configuracao.timeoutMs) || configuracao.timeoutMs <= 0) {
    throw new ErroClienteModeloRedator('configuracao_timeout_invalido');
  }

  const fetchInjetado = configuracao.fetch ?? fetch;

  return {
    async redigir(entrada: EntradaRedator): Promise<string> {
      const controlador = new AbortController();
      const timer = setTimeout(() => controlador.abort(), configuracao.timeoutMs);

      try {
        const corpo = {
          model: configuracao.modelo,
          input: [
            { role: 'system', content: entrada.instrucoes },
            {
              role: 'user',
              content: JSON.stringify({
                mensagem_paciente: entrada.mensagemPaciente,
                natureza_mensagem: entrada.naturezaMensagem,
                fatos_autorizados: entrada.fatos,
                ...(entrada.historicoRecente !== undefined ? { historico_recente: entrada.historicoRecente } : {}),
                ...(entrada.nomeClinica !== undefined ? { nome_clinica: entrada.nomeClinica } : {}),
                ...(entrada.dataHoje !== undefined ? { data_hoje: entrada.dataHoje } : {}),
              }),
            },
          ],
          max_output_tokens: MAX_OUTPUT_TOKENS,
          store: false,
          stream: false,
          background: false,
          // Sem 'text.format': texto livre, sem schema. Sem 'tools' em
          // nenhuma hipotese.
        };

        let resposta: Response;
        try {
          resposta = await fetchInjetado(URL_RESPONSES, {
            method: 'POST',
            headers: { Authorization: `Bearer ${configuracao.chaveApi}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo),
            signal: controlador.signal,
          });
        } catch (erroRede) {
          if (controlador.signal.aborted || (erroRede instanceof Error && erroRede.name === 'AbortError')) {
            throw new ErroClienteModeloRedator('timeout');
          }
          throw new ErroClienteModeloRedator('erro_de_rede');
        }

        if (!resposta.ok) {
          throw new ErroClienteModeloRedator(`erro_http_${resposta.status}`);
        }

        const textoCorpo = await resposta.text();
        if (textoCorpo === '') {
          throw new ErroClienteModeloRedator('corpo_http_vazio');
        }

        let envelope: unknown;
        try {
          envelope = JSON.parse(textoCorpo);
        } catch {
          throw new ErroClienteModeloRedator('corpo_nao_e_json_valido');
        }

        const texto = extrairTextoDaResposta(envelope);
        if (texto === null || texto.trim() === '') {
          throw new ErroClienteModeloRedator('resposta_vazia');
        }

        return texto;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// Mesmo formato de envelope da Responses API que cliente-modelo-openai.ts
// ja le -- so que aqui o "output_text" e a propria resposta final (nunca
// JSON a ser parseado de novo).
function extrairTextoDaResposta(envelope: unknown): string | null {
  if (envelope === null || typeof envelope !== 'object') return null;
  const output = (envelope as Record<string, unknown>).output;
  if (!Array.isArray(output)) return null;

  const itemMensagem = output.find((item) => (item as { type?: string })?.type === 'message') as
    | { content?: unknown }
    | undefined;
  if (!itemMensagem) return null;

  const conteudo = itemMensagem.content;
  if (!Array.isArray(conteudo)) return null;

  const itemTexto = conteudo.find((item) => (item as { type?: string })?.type === 'output_text') as
    | { text?: unknown }
    | undefined;
  const textoBruto = itemTexto?.text;
  return typeof textoBruto === 'string' ? textoBruto : null;
}
