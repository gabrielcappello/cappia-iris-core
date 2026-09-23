// Adaptador fino da IA REDATORA de pos-consulta para a OpenAI Responses API.
// Copia estrutural DELIBERADA de cliente-modelo-redator-openai.ts (mesmo
// endpoint, mesmo formato de corpo, texto livre sem schema) -- nao
// reaproveitado diretamente porque `EntradaRedator.fatos` la e tipado para
// `FatosAutorizados` (dominio de agendamento), e este dominio (pos-consulta)
// nao tem nenhuma relacao operacional com aquele (ver cabecalho de
// pos-consulta-tipos.ts). Mesmo precedente do projeto: cliente-modelo-
// redator-openai.ts ja e separado de cliente-modelo-openai.ts pelo mesmo
// motivo (contratos diferentes, arquivos dedicados).
//
// Unica tentativa, sem retry -- qualquer falha cai no fallback
// deterministico (pos-consulta-gerar-resposta-fallback.ts), exatamente como
// no redator de agendamento.

import type { FatosAutorizadosPosConsulta } from './pos-consulta-fatos-autorizados.ts';
import type { ParConversa } from './tipos.ts';

const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const MAX_OUTPUT_TOKENS = 300;
const ESFORCO_RACIOCINIO = 'none';

export const TIMEOUT_REDATOR_POS_CONSULTA_MS_APROVADO = 6000;

export interface EntradaRedatorPosConsulta {
  instrucoes: string;
  /**
   * AUSENTE quando esta e a mensagem que ABRE a jornada (a Iris fala
   * primeiro, sem resposta do paciente ainda a reagir) -- presente quando
   * esta redacao responde a uma mensagem real do paciente.
   */
  mensagemPaciente?: string;
  fatos: FatosAutorizadosPosConsulta;
  /** Ultimos turnos desta jornada, quando houver -- mesmo formato de historico-conversa.ts. */
  historicoRecente?: ParConversa[];
}

export interface ClienteRedatorPosConsulta {
  redigir(entrada: EntradaRedatorPosConsulta): Promise<string>;
}

export class ErroClienteRedatorPosConsulta extends Error {
  codigo: string;
  constructor(codigo: string) {
    super(`cliente de modelo redator de pos-consulta: codigo=${codigo}`);
    this.name = 'ErroClienteRedatorPosConsulta';
    this.codigo = codigo;
  }
}

export interface ConfiguracaoClienteRedatorPosConsultaOpenAI {
  chaveApi: string;
  modelo: string;
  fetch?: typeof fetch;
  timeoutMs: number;
}

export function criarClienteRedatorPosConsultaOpenAI(
  configuracao: ConfiguracaoClienteRedatorPosConsultaOpenAI
): ClienteRedatorPosConsulta {
  if (typeof configuracao.chaveApi !== 'string' || configuracao.chaveApi.trim() === '') {
    throw new ErroClienteRedatorPosConsulta('configuracao_chave_api_invalida');
  }
  if (typeof configuracao.modelo !== 'string' || configuracao.modelo.trim() === '') {
    throw new ErroClienteRedatorPosConsulta('configuracao_modelo_invalido');
  }
  if (!Number.isFinite(configuracao.timeoutMs) || configuracao.timeoutMs <= 0) {
    throw new ErroClienteRedatorPosConsulta('configuracao_timeout_invalido');
  }

  const fetchInjetado = configuracao.fetch ?? fetch;

  return {
    async redigir(entrada: EntradaRedatorPosConsulta): Promise<string> {
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
                ...(entrada.mensagemPaciente !== undefined ? { mensagem_paciente: entrada.mensagemPaciente } : {}),
                fatos_autorizados: entrada.fatos,
                ...(entrada.historicoRecente !== undefined ? { historico_recente: entrada.historicoRecente } : {}),
              }),
            },
          ],
          max_output_tokens: MAX_OUTPUT_TOKENS,
          reasoning: { effort: ESFORCO_RACIOCINIO },
          store: false,
          stream: false,
          background: false,
          // Sem 'text.format': texto livre, sem schema. Sem 'tools'.
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
            throw new ErroClienteRedatorPosConsulta('timeout');
          }
          throw new ErroClienteRedatorPosConsulta('erro_de_rede');
        }

        if (!resposta.ok) {
          throw new ErroClienteRedatorPosConsulta(`erro_http_${resposta.status}`);
        }

        const textoCorpo = await resposta.text();
        if (textoCorpo === '') {
          throw new ErroClienteRedatorPosConsulta('corpo_http_vazio');
        }

        let envelope: unknown;
        try {
          envelope = JSON.parse(textoCorpo);
        } catch {
          throw new ErroClienteRedatorPosConsulta('corpo_nao_e_json_valido');
        }

        const texto = extrairTextoDaResposta(envelope);
        if (texto === null || texto.trim() === '') {
          throw new ErroClienteRedatorPosConsulta('resposta_vazia');
        }

        return texto;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

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
