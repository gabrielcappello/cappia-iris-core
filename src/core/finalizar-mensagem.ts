import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import type { ClienteBancoDados } from './tipos.ts';
import type { ClaimMensagem, ResultadoConclusao, ResultadoFalha } from './mensagens-recebidas-tipos.ts';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function validarClaim(claim: ClaimMensagem): void {
  validarUuid('mensagem_recebida_id', claim.mensagem_recebida_id);
  validarUuid('clinica_id', claim.clinica_id);
  validarUuid('claim_token', claim.claim_token);
}

function validarUuid(campo: string, valor: unknown): void {
  if (typeof valor !== 'string' || !UUID_REGEX.test(valor)) {
    throw new EntradaInvalidaError(campo, `${campo} deve estar no formato UUID valido`);
  }
}

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
 * `concluido_em`: decisao aprovada (Gabriel, tarefa 0036) — timestamp
 * terminal em UTC, gerado pelo runtime servidor da Edge Function
 * imediatamente antes deste UPDATE, nunca recebido como entrada e nunca
 * vindo do paciente, da IA ou de qualquer payload externo. Nenhuma RPC ou
 * trigger nova foi criada apenas para obter este timestamp.
 */
export async function concluirMensagemCondicional(
  cliente: ClienteBancoDados,
  claim: ClaimMensagem
): Promise<ResultadoConclusao> {
  validarClaim(claim);

  const concluidoEm = new Date().toISOString();

  const { data, error } = await cliente
    .from('mensagens_recebidas')
    .update({ status_processamento: 'concluida', concluido_em: concluidoEm })
    .eq('id', claim.mensagem_recebida_id)
    .eq('clinica_id', claim.clinica_id)
    .eq('status_processamento', 'processando')
    .eq('claim_token', claim.claim_token)
    .not('interpretacao_persistida_em', 'is', null)
    .select('id')
    .maybeSingle();

  if (error) {
    // Nunca propaga error.message do cliente Supabase — motivo tecnico fixo.
    throw new ErroRpcTecnico('concluir_mensagem_condicional', 'cliente_supabase_falhou');
  }
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
 * Mesma decisao aprovada sobre `concluido_em` de concluirMensagemCondicional:
 * timestamp terminal em UTC gerado pelo runtime servidor da Edge Function
 * imediatamente antes deste UPDATE, nunca recebido como entrada.
 */
export async function falharMensagemCondicional(
  cliente: ClienteBancoDados,
  claim: ClaimMensagem
): Promise<ResultadoFalha> {
  validarClaim(claim);

  const concluidoEm = new Date().toISOString();

  const { data, error } = await cliente
    .from('mensagens_recebidas')
    .update({ status_processamento: 'falhou', concluido_em: concluidoEm })
    .eq('id', claim.mensagem_recebida_id)
    .eq('clinica_id', claim.clinica_id)
    .eq('status_processamento', 'processando')
    .eq('claim_token', claim.claim_token)
    .is('interpretacao_persistida_em', null)
    .select('id')
    .maybeSingle();

  if (error) {
    // Nunca propaga error.message do cliente Supabase — motivo tecnico fixo.
    throw new ErroRpcTecnico('falhar_mensagem_condicional', 'cliente_supabase_falhou');
  }
  return data ? 'falhou' : 'autorizacao_invalida';
}
