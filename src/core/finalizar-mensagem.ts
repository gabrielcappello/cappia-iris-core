import type { ClienteBancoDados } from './tipos.ts';
import type { ClaimMensagem, ResultadoConclusao, ResultadoFalha } from './mensagens-recebidas-tipos.ts';

/**
 * UPDATE PostgREST condicional unico (sem RPC dedicada) para marcar uma
 * mensagem como concluida — specs/interpretacao-ia.md, "Contrato tecnico de
 * banco — Etapa 6" -> "Conclusao condicional". Todas as condicoes (id,
 * clinica_id, status processando, claim_token, marcador preenchido) estao
 * no mesmo UPDATE; nunca um SELECT de autorizacao seguido de UPDATE
 * separado. Nao exige lease vigente: o envio da resposta pode terminar
 * depois da expiracao do lease, e o claim_token ja impede um worker
 * substituido de concluir.
 *
 * `concluido_em` e gerado pelo Core (relogio do processo chamador) no
 * momento da chamada, nao pelo PostgreSQL — essa e a unica forma
 * tecnicamente possivel de preencher esse timestamp por um UPDATE PostgREST
 * simples, sem introduzir uma RPC ou trigger novos (fora do escopo desta
 * rodada).
 */
export async function concluirMensagemCondicional(
  cliente: ClienteBancoDados,
  claim: ClaimMensagem
): Promise<ResultadoConclusao> {
  const { data, error } = await cliente
    .from('mensagens_recebidas')
    .update({ status_processamento: 'concluida', concluido_em: new Date().toISOString() })
    .eq('id', claim.mensagem_recebida_id)
    .eq('clinica_id', claim.clinica_id)
    .eq('status_processamento', 'processando')
    .eq('claim_token', claim.claim_token)
    .not('interpretacao_persistida_em', 'is', null)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`falha ao concluir mensagem: ${error.message}`);
  return data ? 'concluida' : 'autorizacao_invalida';
}

/**
 * UPDATE PostgREST condicional unico (sem RPC dedicada) para marcar uma
 * mensagem como falhou — specs/interpretacao-ia.md, "Contrato tecnico de
 * banco — Etapa 6" -> "Finalizacao de falha anterior a persistencia". Usado
 * somente quando a falha ocorreu ANTES de interpretacao_persistida_em ser
 * preenchido: por isso exige marcador `null` (o oposto de
 * concluirMensagemCondicional), separando os dois caminhos terminais. Nao
 * exige lease vigente, pela mesma razao de concluirMensagemCondicional.
 *
 * Mesma ressalva sobre `concluido_em`: gerado pelo Core, nao pelo
 * PostgreSQL, pela mesma limitacao tecnica do UPDATE PostgREST simples.
 */
export async function falharMensagemCondicional(
  cliente: ClienteBancoDados,
  claim: ClaimMensagem
): Promise<ResultadoFalha> {
  const { data, error } = await cliente
    .from('mensagens_recebidas')
    .update({ status_processamento: 'falhou', concluido_em: new Date().toISOString() })
    .eq('id', claim.mensagem_recebida_id)
    .eq('clinica_id', claim.clinica_id)
    .eq('status_processamento', 'processando')
    .eq('claim_token', claim.claim_token)
    .is('interpretacao_persistida_em', null)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`falha ao marcar mensagem como falhou: ${error.message}`);
  return data ? 'falhou' : 'autorizacao_invalida';
}
