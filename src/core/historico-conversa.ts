// Historico conversacional recente: os ultimos MAX_PARES_HISTORICO pares
// (mensagem do paciente + resposta da Iris), para a IA interpretadora e a IA
// redatora entenderem a mensagem atual em relacao ao que veio antes -- nunca
// so a mensagem atual isolada.
//
// Contrato: specs/historico-conversacional-v1.md.
//
// Tres responsabilidades, deliberadamente separadas (mesmo padrao de
// contexto-horarios.ts):
//
// 1. `validarHistoricoConversa` -- fronteira de confianca na LEITURA. Falha
//    ABERTA: valor malformado vira `null`, nunca derruba a identificacao. UM
//    UNICO par malformado invalida o array INTEIRO -- descartar so o par
//    ruim abriria um buraco silencioso no meio da conversa, e um historico
//    com um turno faltando no meio e pior para a compreensao do que nenhum
//    historico (a IA leria uma sequencia que nunca existiu).
// 2. `historicoValidoParaEnvio` -- filtro de IDADE na leitura, par a par.
//    Expiracao e SOMENTE de leitura: a coluna nunca e apagada por tempo,
//    nenhum job, nenhuma rotina de limpeza.
// 3. `gravarHistoricoConversa` -- efeito. Anexa o par novo ao historico lido
//    no INICIO do turno (nunca relido aqui), corta para os
//    MAX_PARES_HISTORICO mais recentes, e grava com CAS encadeado sobre o
//    `atualizado_em` que `gravarContextoHorarios` devolveu. Uma unica
//    instrucao UPDATE, nunca rele, nunca repete, nunca rebaseia.
//
// SEM SANITIZACAO nesta V1 (spec secao 0.1, decisao de produto do Gabriel
// 2026-08-07): "nao adicionar complexidade para um problema que o fluxo
// atual praticamente nao produz" -- a Iris hoje so pede "nome" no fluxo de
// cadastro, nunca cpf/email/data_nascimento, e nenhum desses tres jamais foi
// preenchido em producao. O texto do paciente e gravado exatamente como
// chegou. Revisar quando o fluxo de cadastro completo existir (spec secao 11).

import type { ClienteBancoDados, HistoricoConversa, ParConversa } from './tipos.ts';

/** Janela de validade da memoria conversacional. Aprovada por Gabriel em 2026-08-06. */
export const VALIDADE_HISTORICO_MS = 24 * 60 * 60 * 1000;

/** Tamanho maximo do historico. Aprovado por Gabriel em 2026-08-07 como valor definitivo. */
export const MAX_PARES_HISTORICO = 10;

function parValido(valor: unknown): valor is ParConversa {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const { mensagem_paciente, resposta_iris, gerada_em } = valor as Record<string, unknown>;
  if (typeof mensagem_paciente !== 'string' || mensagem_paciente.trim() === '') return false;
  if (typeof resposta_iris !== 'string' || resposta_iris.trim() === '') return false;
  if (typeof gerada_em !== 'string' || Number.isNaN(Date.parse(gerada_em))) return false;
  return true;
}

/**
 * Fronteira de confianca na LEITURA (identificacao.ts). Falha ABERTA de
 * proposito, mesmo criterio de validarContextoHorarios: este campo e
 * puramente auxiliar de continuidade conversacional -- nada operacional
 * depende dele, e perde-lo so faz a Iris responder sem contexto do que veio
 * antes. Um array vazio nunca e um valor valido (secao 2 da spec: "nenhum
 * turno anterior" e sempre `null`, nunca `[]`).
 */
export function validarHistoricoConversa(valor: unknown): HistoricoConversa | null {
  if (valor === null || valor === undefined) return null;
  if (!Array.isArray(valor) || valor.length === 0) return null;
  if (!valor.every(parValido)) return null;
  return valor as HistoricoConversa;
}

/**
 * Filtro de idade aplicado no PONTO DE LEITURA para os dois modelos (spec
 * secao 6), par a par -- nunca por apagamento da coluna. `undefined` (nunca
 * `null`, nunca `[]`) quando NENHUM par sobrevive -- e o formato que os
 * payloads usam para "campo ausente". Por construcao os pares expirados sao
 * sempre um prefixo do array (ordem cronologica), mas o filtro NAO assume
 * isso -- avalia par a par e preserva a ordem do que sobra.
 */
export function historicoValidoParaEnvio(
  historico: HistoricoConversa | null,
  agoraMs: number
): HistoricoConversa | undefined {
  if (historico === null) return undefined;
  const validos = historico.filter((par) => agoraMs - new Date(par.gerada_em).getTime() <= VALIDADE_HISTORICO_MS);
  return validos.length > 0 ? validos : undefined;
}

export interface GravarHistoricoEntrada {
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
  /**
   * O historico lido no INICIO deste turno (ResultadoOrquestrador), nunca
   * relido -- `null` quando a conversa ainda nao tem nenhum par. E sobre ele
   * que o par novo e anexado, em memoria, sem nenhum SELECT.
   */
  historico_anterior: HistoricoConversa | null;
  mensagem_paciente: string;
  /** EXATAMENTE a resposta final decidida para este turno (redacao aprovada ou fallback) -- nunca um rascunho reprovado. */
  resposta_iris: string;
}

/**
 * Anexa o par novo ao historico anterior, corta para os
 * MAX_PARES_HISTORICO mais recentes preservando a ordem, e grava com CAS.
 * NUNCA lanca: esta escrita e auxiliar e best-effort por contrato (spec
 * secao 3), igual gravarContextoHorarios. Perde-la degrada a continuidade
 * da proxima resposta e nunca produz erro ao paciente nem altera a resposta
 * ja decidida e enviada -- esta gravacao acontece DEPOIS que a resposta ja
 * foi determinada.
 *
 * Ao falhar o CAS: abandona imediatamente. Sem reler, sem retry, sem
 * rebase. Nao ha nada a encadear depois desta escrita (e a ultima do
 * turno), entao o retorno e `void`.
 */
export async function gravarHistoricoConversa(cliente: ClienteBancoDados, entrada: GravarHistoricoEntrada): Promise<void> {
  const novo: ParConversa = {
    mensagem_paciente: entrada.mensagem_paciente,
    resposta_iris: entrada.resposta_iris,
    gerada_em: new Date().toISOString(),
  };
  const historico = [...(entrada.historico_anterior ?? []), novo].slice(-MAX_PARES_HISTORICO);

  try {
    await cliente
      .from('estado_conversa')
      .update({
        historico_conversa: historico,
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
  // aqui: nenhuma escrita posterior depende do resultado desta -- e sempre a
  // ultima do turno.
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
