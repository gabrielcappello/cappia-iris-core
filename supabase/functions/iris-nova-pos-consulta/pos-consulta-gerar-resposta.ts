// Orquestracao da resposta conversacional de pos-consulta. Funcao fina:
// deriva os fatos autorizados da decisao ja tomada (pos-consulta-jornada.ts),
// tenta a redacao natural via IA, verifica pela guarda, e cai no fallback
// deterministico em qualquer ponto de falha. Mesma forma de
// gerar-resposta-conversacional.ts, dominio proprio.

import { derivarFatosAutorizadosPosConsulta } from './pos-consulta-fatos-autorizados.ts';
import type { ContextoFatosPosConsulta, FatosAutorizadosPosConsulta } from './pos-consulta-fatos-autorizados.ts';
import { verificarRespostaRedatoraPosConsulta } from './pos-consulta-guarda-redatora.ts';
import type { MotivoReprovacaoGuardaPosConsulta } from './pos-consulta-guarda-redatora.ts';
import { gerarRespostaPosConsultaFallback } from './pos-consulta-gerar-resposta-fallback.ts';
import { INSTRUCOES_REDATOR_POS_CONSULTA } from './pos-consulta-redator-instrucoes.ts';
import type { ClienteRedatorPosConsulta } from './cliente-modelo-redator-pos-consulta-openai.ts';
import type { DecisaoPosConsulta } from './pos-consulta-jornada.ts';
import type { ParConversa } from './tipos.ts';

export type MotivoFallbackRespostaPosConsulta =
  | 'redator_nao_configurado'
  | 'falha_redatora'
  | MotivoReprovacaoGuardaPosConsulta;

export interface ResultadoRespostaPosConsulta {
  resposta: string;
  /** Nunca exposto ao paciente -- so para log/telemetria interna. */
  motivo_fallback: MotivoFallbackRespostaPosConsulta | null;
}

export interface GerarRespostaPosConsultaEntrada {
  decisao: DecisaoPosConsulta;
  /** AUSENTE quando esta mensagem ABRE a jornada (ver EntradaRedatorPosConsulta). */
  mensagemPaciente?: string;
  contexto: ContextoFatosPosConsulta;
  historicoRecente?: ParConversa[];
}

/** `clienteRedator: null` cobre configuracao ausente -- cai direto no fallback. */
export async function gerarRespostaPosConsulta(
  clienteRedator: ClienteRedatorPosConsulta | null,
  entrada: GerarRespostaPosConsultaEntrada
): Promise<ResultadoRespostaPosConsulta> {
  const fatos: FatosAutorizadosPosConsulta = derivarFatosAutorizadosPosConsulta(entrada.decisao, entrada.contexto);

  if (clienteRedator === null) {
    return { resposta: gerarRespostaPosConsultaFallback(fatos), motivo_fallback: 'redator_nao_configurado' };
  }

  let textoRedigido: string;
  try {
    textoRedigido = await clienteRedator.redigir({
      instrucoes: INSTRUCOES_REDATOR_POS_CONSULTA,
      fatos,
      ...(entrada.mensagemPaciente !== undefined ? { mensagemPaciente: entrada.mensagemPaciente } : {}),
      ...(entrada.historicoRecente !== undefined ? { historicoRecente: entrada.historicoRecente } : {}),
    });
  } catch {
    return { resposta: gerarRespostaPosConsultaFallback(fatos), motivo_fallback: 'falha_redatora' };
  }

  const resultadoGuarda = verificarRespostaRedatoraPosConsulta(textoRedigido, fatos);
  if (!resultadoGuarda.aprovado) {
    return { resposta: gerarRespostaPosConsultaFallback(fatos), motivo_fallback: resultadoGuarda.motivo };
  }

  return { resposta: textoRedigido.trim(), motivo_fallback: null };
}
