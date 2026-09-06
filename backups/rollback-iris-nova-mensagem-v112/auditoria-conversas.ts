// Auditoria de conversas para o painel /admin
// (specs/auditoria-conversas-admin-v1.md).
//
// Gravação em `conversas_auditoria`, NUNCA lida por orquestrador.ts, por
// nenhuma IA, nem por historico-conversa.ts -- existe exclusivamente para
// leitura humana via /admin. Efeito paralelo (EdgeRuntime.waitUntil no
// index.ts), nunca aguardado antes do `return`, best-effort: uma falha
// aqui (rede, timeout, erro de escrita) é absorvida em silêncio e nunca
// pode transformar um turno bem-sucedido em erro para o paciente, nem
// atrasar a resposta.
//
// ESCOPO (spec seção 1.2): só grava depois que a Edge Function já validou
// POST + payload parseado + variáveis de ambiente presentes + instância
// autorizada. Tráfego anterior a isso (metodo_nao_permitido,
// payload_invalido e variações, configuracao_ausente,
// instancia_nao_autorizada) NUNCA gera linha -- não representa conversa
// real, e no caso de configuracao_ausente a própria gravação seria
// tecnicamente impossível.

import type { ClienteBancoDados } from './tipos.ts';
import type { MotivoFallbackResposta } from './gerar-resposta-conversacional.ts';

/** Vocabulário fechado, mapeado 1:1 aos ramos de `tratarErroDoTurno` (index.ts). */
export type ResultadoTurno =
  | 'sucesso'
  | 'clinica_nao_encontrada'
  | 'entrada_invalida'
  | 'resposta_truncada_apos_retry'
  | 'erro_interno';

export interface GravarAuditoriaSucessoEntrada {
  clinicaId: string;
  telefoneNormalizado: string;
  mensagemPaciente: string;
  respostaIris: string;
  motivoFallback: MotivoFallbackResposta | null;
}

/**
 * Ponto de gravação de SUCESSO (spec seção 1.2, item 1) -- chamado depois
 * que a resposta ao paciente já foi decidida, nunca antes.
 */
export async function gravarAuditoriaSucesso(
  cliente: ClienteBancoDados,
  entrada: GravarAuditoriaSucessoEntrada
): Promise<void> {
  await inserirLinha(cliente, {
    clinica_id: entrada.clinicaId,
    telefone_normalizado: entrada.telefoneNormalizado,
    mensagem_paciente: entrada.mensagemPaciente,
    resposta_iris: entrada.respostaIris,
    motivo_fallback: entrada.motivoFallback,
    resultado_turno: 'sucesso',
  });
}

export interface GravarAuditoriaFalhaEntrada {
  /** Provider e instância do payload -- usados para resolver clinica_id (ver abaixo). */
  provider: string;
  instanciaWhatsapp: string;
  telefoneNormalizado: string;
  mensagemPaciente: string;
  /** Texto fixo devolvido, quando houver (ex.: resposta truncada). `null` para erro técnico sem texto de conversa. */
  respostaIris: string | null;
  resultadoTurno: ResultadoTurno;
}

/**
 * Ponto de gravação de FALHA (spec seção 1.2, item 2) -- chamado somente
 * dentro do escopo já descrito acima (nunca para tráfego anterior à
 * instância autorizada).
 *
 * Resolução de `clinica_id` best-effort (spec seção 1.2): quando
 * `processarMensagem` lança, o handler não tem mais acesso a nenhum
 * `clinica_id` já resolvido internamente pelo Core -- o erro interrompe o
 * fluxo antes de devolvê-lo. Para que falhas de uma clínica real ainda
 * apareçam na tela por clínica, esta função refaz a MESMA consulta que
 * `identificacao.ts::buscarClinica` já faz (provider + instancia_whatsapp),
 * antes de gravar. Não encontrando -- ou quando `resultadoTurno` já é
 * `'clinica_nao_encontrada'` -- `clinica_id` permanece `null`, e a linha
 * não aparece em nenhuma tela do /admin nesta v1 (spec seção 2).
 *
 * Esta consulta extra nunca toca `orquestrador.ts` nem qualquer módulo do
 * Core, e sua falha é absorvida em silêncio como o resto da gravação.
 */
export async function gravarAuditoriaFalha(
  cliente: ClienteBancoDados,
  entrada: GravarAuditoriaFalhaEntrada
): Promise<void> {
  const clinicaId =
    entrada.resultadoTurno === 'clinica_nao_encontrada'
      ? null
      : await resolverClinicaIdBestEffort(cliente, entrada.provider, entrada.instanciaWhatsapp);

  await inserirLinha(cliente, {
    clinica_id: clinicaId,
    telefone_normalizado: entrada.telefoneNormalizado,
    mensagem_paciente: entrada.mensagemPaciente,
    resposta_iris: entrada.respostaIris,
    motivo_fallback: null,
    resultado_turno: entrada.resultadoTurno,
  });
}

async function resolverClinicaIdBestEffort(
  cliente: ClienteBancoDados,
  provider: string,
  instanciaWhatsapp: string
): Promise<string | null> {
  try {
    const { data } = await cliente
      .from('clinicas')
      .select('id')
      .eq('provider', provider)
      .eq('instancia_whatsapp', instanciaWhatsapp)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

async function inserirLinha(cliente: ClienteBancoDados, valores: Record<string, unknown>): Promise<void> {
  try {
    await cliente.from('conversas_auditoria').insert(valores).select('id').maybeSingle();
  } catch {
    // Best-effort por contrato (spec seção 1.2.2): nunca lança, nunca
    // retenta, nunca pode afetar o turno já decidido.
  }
}
