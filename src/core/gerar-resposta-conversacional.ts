// Orquestracao da resposta conversacional (specs/resposta-conversacional-v1.md).
// Funcao fina: deriva os fatos autorizados da decisao ja tomada pelo
// orquestrador, tenta a redacao natural via IA, verifica o resultado pela
// guarda, e cai no fallback deterministico (gerar-resposta-paciente.ts) em
// qualquer ponto de falha. Nao decide fluxo, nao acessa banco, nao chama o
// orquestrador -- recebe a DecisaoOrquestrador ja pronta, mesmo papel que
// gerar-resposta-paciente.ts sempre teve, so que agora com um caminho
// natural na frente dele.
//
// `motivo_fallback` e SEMPRE interno (telemetria) -- nunca aparece na
// resposta ao paciente, que recebe unicamente o fallback determinístico
// normal do estado (spec secao 4: "os fatos do Core estavam corretos, so a
// redacao falhou").

import { derivarFatosAutorizados } from './fatos-autorizados.ts';
import { verificarRespostaRedatora } from './guarda-resposta-redatora.ts';
import { gerarRespostaPaciente } from './gerar-resposta-paciente.ts';
import { INSTRUCOES_REDATOR } from './redator-instrucoes.ts';
import { historicoValidoParaEnvio } from './historico-conversa.ts';
import type { ClienteModeloRedator } from './cliente-modelo-redator-openai.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';
import type { NaturezaMensagem } from './interpretacao-tipos.ts';
import type { HistoricoConversa } from './tipos.ts';

export type MotivoFallbackResposta = 'redator_nao_configurado' | 'falha_redatora' | 'texto_vazio' | 'horario_nao_autorizado';

export interface ResultadoRespostaConversacional {
  resposta: string;
  /** Nunca exposto ao paciente -- so para log/telemetria interna. */
  motivo_fallback: MotivoFallbackResposta | null;
}

export interface GerarRespostaConversacionalEntrada {
  decisao: DecisaoOrquestrador;
  mensagemPaciente: string;
  naturezaMensagem: NaturezaMensagem;
  nomeClinica?: string;
  /**
   * Valor CRU lido no inicio do turno (ResultadoOrquestrador.historico_conversa)
   * -- `null` quando nao ha nenhum turno anterior. O filtro de validade (24h)
   * e aplicado AQUI, no ponto de leitura para a redatora
   * (specs/historico-conversacional-v1.md secao 6), nunca antes.
   */
  historicoConversa: HistoricoConversa | null;
}

/**
 * `clienteRedator: null` cobre configuracao ausente (ex.: variavel de
 * ambiente nao definida) sem exigir que o chamador trate isso como erro
 * fatal -- cai direto no fallback deterministico, mesmo comportamento de
 * qualquer outra falha da redatora.
 */
export async function gerarRespostaConversacional(
  clienteRedator: ClienteModeloRedator | null,
  entrada: GerarRespostaConversacionalEntrada
): Promise<ResultadoRespostaConversacional> {
  const fatos = derivarFatosAutorizados(entrada.decisao);
  const historicoParaEnvio = historicoValidoParaEnvio(entrada.historicoConversa, Date.now());

  if (clienteRedator === null) {
    return { resposta: gerarRespostaPaciente(entrada.decisao), motivo_fallback: 'redator_nao_configurado' };
  }

  let textoRedigido: string;
  try {
    textoRedigido = await clienteRedator.redigir({
      instrucoes: INSTRUCOES_REDATOR,
      mensagemPaciente: entrada.mensagemPaciente,
      naturezaMensagem: entrada.naturezaMensagem,
      fatos,
      ...(historicoParaEnvio !== undefined ? { historicoRecente: historicoParaEnvio } : {}),
      ...(entrada.nomeClinica !== undefined ? { nomeClinica: entrada.nomeClinica } : {}),
    });
  } catch {
    return { resposta: gerarRespostaPaciente(entrada.decisao), motivo_fallback: 'falha_redatora' };
  }

  const resultadoGuarda = verificarRespostaRedatora(textoRedigido, fatos);
  if (!resultadoGuarda.aprovado) {
    return { resposta: gerarRespostaPaciente(entrada.decisao), motivo_fallback: resultadoGuarda.motivo };
  }

  return { resposta: textoRedigido.trim(), motivo_fallback: null };
}
