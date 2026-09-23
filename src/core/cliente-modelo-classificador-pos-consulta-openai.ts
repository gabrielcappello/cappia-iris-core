// Adaptador fino da IA CLASSIFICADORA de satisfacao para a OpenAI Responses
// API (specs/pos-consulta-conversacional-v1.md secao 4.1). Arquivo NOVO e
// DEDICADO, no mesmo espirito de cliente-modelo-redator-openai.ts ser
// separado de cliente-modelo-openai.ts: o contrato aqui (Structured Outputs
// de UM campo fechado, sobre um dominio que nao tem nenhuma relacao com
// agendamento) e pequeno e proprio -- reaproveitar o cliente da
// interpretadora normal exigiria ou distorcer EntradaInterpretacao (payload
// de agendamento) para caber uma resposta de pos-consulta, ou tornar aquele
// cliente generico sobre o schema, o que a producao hoje explicitamente NAO
// faz (ver sombra-capacidade-v2.ts, mesma decisao ja tomada e documentada).
//
// UMA UNICA TENTATIVA, sem retry (mesma razao do redator): qualquer falha
// (rede, timeout, resposta invalida) tem um fallback SEGURO e determinado --
// classificar como 'incerta', que e a leitura conservadora, nunca aciona
// envio de link nem afirma satisfacao (spec secao 6: 'incerta' nunca envia
// Google). Falhar fechado aqui significa "silencio custa uma automacao
// opcional perdida", nunca "risco de afirmar algo errado ao paciente".

const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const MAX_OUTPUT_TOKENS = 50;
const ESFORCO_RACIOCINIO = 'none';

// Unica tentativa, sem retry -- valor de referencia aprovado, nunca default
// silencioso: o chamador fornece timeoutMs explicitamente.
export const TIMEOUT_CLASSIFICADOR_MS_APROVADO = 6000;

const SCHEMA_CLASSIFICACAO_POS_CONSULTA = {
  type: 'object',
  properties: {
    classificacao: {
      type: 'string',
      enum: ['positiva', 'nao_positiva', 'incerta'],
    },
  },
  required: ['classificacao'],
  additionalProperties: false,
} as const;

export type ClassificacaoSatisfacaoIA = 'positiva' | 'nao_positiva' | 'incerta';

export interface EntradaClassificadorPosConsulta {
  instrucoes: string;
  /**
   * Mensagem crua do paciente, a ser classificada. O CONTEXTO ("isto e uma
   * resposta a uma pergunta de pos-consulta sobre uma consulta concluida")
   * ja esta nas instrucoes -- o estado minimo da jornada (spec secao 5) nao
   * inclui historico de mensagens, entao nao ha pergunta literal anterior a
   * transportar aqui.
   */
  mensagemPaciente: string;
}

export interface ClienteClassificadorPosConsulta {
  classificar(entrada: EntradaClassificadorPosConsulta): Promise<ClassificacaoSatisfacaoIA>;
}

export class ErroClienteClassificadorPosConsulta extends Error {
  codigo: string;
  constructor(codigo: string) {
    super(`cliente classificador de pos-consulta: codigo=${codigo}`);
    this.name = 'ErroClienteClassificadorPosConsulta';
    this.codigo = codigo;
  }
}

export interface ConfiguracaoClienteClassificadorPosConsultaOpenAI {
  chaveApi: string;
  modelo: string;
  fetch?: typeof fetch;
  timeoutMs: number;
}

export function criarClienteClassificadorPosConsultaOpenAI(
  configuracao: ConfiguracaoClienteClassificadorPosConsultaOpenAI
): ClienteClassificadorPosConsulta {
  if (typeof configuracao.chaveApi !== 'string' || configuracao.chaveApi.trim() === '') {
    throw new ErroClienteClassificadorPosConsulta('configuracao_chave_api_invalida');
  }
  if (typeof configuracao.modelo !== 'string' || configuracao.modelo.trim() === '') {
    throw new ErroClienteClassificadorPosConsulta('configuracao_modelo_invalido');
  }
  if (!Number.isFinite(configuracao.timeoutMs) || configuracao.timeoutMs <= 0) {
    throw new ErroClienteClassificadorPosConsulta('configuracao_timeout_invalido');
  }

  const fetchInjetado = configuracao.fetch ?? fetch;

  return {
    async classificar(entrada: EntradaClassificadorPosConsulta): Promise<ClassificacaoSatisfacaoIA> {
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
              }),
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'classificacao_pos_consulta',
              schema: SCHEMA_CLASSIFICACAO_POS_CONSULTA,
              strict: true,
            },
          },
          max_output_tokens: MAX_OUTPUT_TOKENS,
          reasoning: { effort: ESFORCO_RACIOCINIO },
          store: false,
          stream: false,
          background: false,
          // Sem 'tools' em nenhuma hipotese -- a IA classificadora nunca
          // executa nada (mesma proibicao da redatora e da interpretadora).
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
            throw new ErroClienteClassificadorPosConsulta('timeout');
          }
          throw new ErroClienteClassificadorPosConsulta('erro_de_rede');
        }

        if (!resposta.ok) {
          throw new ErroClienteClassificadorPosConsulta(`erro_http_${resposta.status}`);
        }

        const textoCorpo = await resposta.text();
        if (textoCorpo === '') {
          throw new ErroClienteClassificadorPosConsulta('corpo_http_vazio');
        }

        let envelope: unknown;
        try {
          envelope = JSON.parse(textoCorpo);
        } catch {
          throw new ErroClienteClassificadorPosConsulta('corpo_nao_e_json_valido');
        }

        const textoSaida = extrairTextoDaResposta(envelope);
        if (textoSaida === null || textoSaida.trim() === '') {
          throw new ErroClienteClassificadorPosConsulta('resposta_vazia');
        }

        let saida: unknown;
        try {
          saida = JSON.parse(textoSaida);
        } catch {
          throw new ErroClienteClassificadorPosConsulta('saida_nao_e_json_valido');
        }

        return validarSaida(saida);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// Vocabulario fechado (spec secao 4.1) -- classificacao fora deste conjunto
// falha fechado, nunca vira 'incerta' silenciosamente por coincidencia: o
// chamador (pos-consulta-classificar-resposta.ts) e quem decide degradar
// falha para 'incerta', nao este adaptador.
function validarSaida(saida: unknown): ClassificacaoSatisfacaoIA {
  if (saida === null || typeof saida !== 'object' || Array.isArray(saida)) {
    throw new ErroClienteClassificadorPosConsulta('saida_nao_e_objeto');
  }
  const classificacao = (saida as Record<string, unknown>).classificacao;
  if (classificacao !== 'positiva' && classificacao !== 'nao_positiva' && classificacao !== 'incerta') {
    throw new ErroClienteClassificadorPosConsulta('classificacao_fora_do_vocabulario');
  }
  return classificacao;
}

// Mesmo formato de envelope da Responses API que cliente-modelo-openai.ts
// ja le -- aqui o "output_text" e JSON a ser parseado (Structured Outputs),
// igual a interpretadora, diferente da redatora (texto livre).
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
