// Memoria conversacional minima: o ultimo par (mensagem do paciente +
// resposta da Iris), para a IA redatora manter continuidade no turno
// seguinte -- piada, "aquele que voce falou", retomada apos comentario
// lateral.
//
// Contrato: specs/memoria-conversacional-minima-v1.md.
//
// Tres responsabilidades, deliberadamente separadas (mesmo padrao de
// contexto-horarios.ts):
//
// 1. `validarUltimaTroca` -- fronteira de confianca na LEITURA. Falha
//    ABERTA: valor malformado vira `null`, nunca derruba a identificacao.
// 2. `ultimaTrocaValidaParaEnvio` -- filtro de IDADE na leitura para a
//    redatora. Expiracao e SOMENTE de leitura: a coluna nunca e apagada por
//    tempo, nenhum job, nenhuma rotina de limpeza (spec secao 3).
// 3. `gravarUltimaTroca` -- efeito. Uma unica instrucao UPDATE, com CAS
//    encadeado sobre o `atualizado_em` que `gravarContextoHorarios` (ou o
//    identificado no inicio do turno, quando nada foi escrito) devolveu.
//    Nunca rele, nunca repete, nunca rebaseia -- mesma disciplina de
//    contexto-horarios.ts.
//
// `ultima_troca` NUNCA chega a IA interpretadora -- e memoria exclusiva da
// camada de redacao, nunca fonte de fato operacional.

import type { ClienteBancoDados, UltimaTroca } from './tipos.ts';

/** Janela de validade da memoria conversacional. Aprovada por Gabriel em 2026-08-06. */
export const VALIDADE_ULTIMA_TROCA_MS = 24 * 60 * 60 * 1000;

/**
 * Fronteira de confianca na LEITURA (identificacao.ts). Falha ABERTA de
 * proposito, mesmo criterio de validarContextoHorarios: um valor malformado
 * vira `null` e a conversa segue sem memoria, em vez de derrubar a
 * identificacao. Justificado porque este campo e puramente auxiliar de
 * continuidade conversacional -- nada operacional depende dele, e perde-lo
 * so faz a Iris responder sem referenciar o turno anterior.
 */
export function validarUltimaTroca(valor: unknown): UltimaTroca | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'object' || Array.isArray(valor)) return null;

  const { mensagem_paciente, resposta_iris, gerada_em } = valor as Record<string, unknown>;
  if (typeof mensagem_paciente !== 'string' || mensagem_paciente.trim() === '') return null;
  if (typeof resposta_iris !== 'string' || resposta_iris.trim() === '') return null;
  if (typeof gerada_em !== 'string' || Number.isNaN(Date.parse(gerada_em))) return null;

  return { mensagem_paciente, resposta_iris, gerada_em };
}

/**
 * Filtro de idade aplicado no PONTO DE LEITURA para a redatora (spec secao
 * 3) -- nunca por apagamento da coluna. Um paciente que volta depois de
 * VALIDADE_ULTIMA_TROCA_MS nao deve receber uma resposta que referencia uma
 * conversa esquecida ("como eu te disse"). `undefined` (nao `null`) porque e
 * o formato que EntradaRedator usa para "campo ausente" -- omitido do
 * payload da IA, nunca enviado como `null`.
 */
export function ultimaTrocaValidaParaEnvio(ultimaTroca: UltimaTroca | null, agoraMs: number): UltimaTroca | undefined {
  if (ultimaTroca === null) return undefined;
  const geradaEmMs = new Date(ultimaTroca.gerada_em).getTime();
  if (agoraMs - geradaEmMs > VALIDADE_ULTIMA_TROCA_MS) return undefined;
  return ultimaTroca;
}

export interface GravarUltimaTrocaEntrada {
  conversa_id: string;
  clinica_id: string;
  telefone_normalizado: string;
  /**
   * `atualizado_em` da resposta desta mensagem -- o valor que
   * `gravarContextoHorarios` devolveu (ResultadoOrquestrador.atualizado_em),
   * nunca um valor relido. E o mecanismo de encadeamento dos dois CAS: se
   * aquela escrita falhou, este valor ja esta obsoleto de proposito, e o CAS
   * abaixo falha em seguida, sem tratamento especial.
   */
  atualizado_em_da_resposta: string;
  mensagem_paciente: string;
  /** EXATAMENTE a resposta final decidida para este turno (redacao aprovada ou fallback) -- nunca um rascunho reprovado. */
  resposta_iris: string;
}

/**
 * Grava o par com CAS. NUNCA lanca: esta escrita e auxiliar e best-effort
 * por contrato (spec secao 5), igual gravarContextoHorarios. Perde-la
 * degrada a continuidade da proxima resposta e nunca produz erro ao
 * paciente nem altera a resposta ja decidida e enviada -- esta gravacao
 * acontece DEPOIS que a resposta ja foi determinada.
 *
 * Ao falhar o CAS: abandona imediatamente. Sem reler, sem retry, sem
 * rebase. Nao ha nada a encadear depois desta escrita (e a ultima do
 * turno), entao o retorno e `void` -- ao contrario de gravarContextoHorarios,
 * nenhum CAS subsequente depende do resultado desta.
 */
export async function gravarUltimaTroca(cliente: ClienteBancoDados, entrada: GravarUltimaTrocaEntrada): Promise<void> {
  const ultimaTroca: UltimaTroca = {
    mensagem_paciente: entrada.mensagem_paciente,
    resposta_iris: entrada.resposta_iris,
    gerada_em: new Date().toISOString(),
  };

  try {
    await cliente
      .from('estado_conversa')
      .update({
        ultima_troca: ultimaTroca,
        atualizado_em: proximoTimestamp(entrada.atualizado_em_da_resposta),
      })
      .eq('id', entrada.conversa_id)
      .eq('clinica_id', entrada.clinica_id)
      .eq('telefone_normalizado', entrada.telefone_normalizado)
      .eq('atualizado_em', entrada.atualizado_em_da_resposta)
      .select('id')
      .maybeSingle();
  } catch {
    // Falha tecnica do cliente tambem e abandonada em silencio, pelo mesmo
    // motivo do CAS falho: esta escrita nunca pode transformar uma conversa
    // ja respondida com sucesso em erro para o paciente.
  }
  // `0` linhas afetadas (CAS falhou) nao precisa ser distinguido de sucesso
  // aqui: ao contrario de gravarContextoHorarios, nenhuma escrita posterior
  // depende do resultado desta -- e sempre a ultima do turno.
}

/**
 * Mesma garantia de aplicar-dados.ts/contexto-horarios.ts: timestamp
 * estritamente posterior ao anterior. Reimplementado aqui (4 linhas) em vez
 * de compartilhado, mesmo criterio ja usado nos demais modulos que precisam
 * dessa garantia.
 */
function proximoTimestamp(anteriorIso: string): string {
  const anteriorMs = new Date(anteriorIso).getTime();
  const agoraMs = Date.now();
  const novoMs = agoraMs > anteriorMs ? agoraMs : anteriorMs + 1;
  return new Date(novoMs).toISOString();
}
