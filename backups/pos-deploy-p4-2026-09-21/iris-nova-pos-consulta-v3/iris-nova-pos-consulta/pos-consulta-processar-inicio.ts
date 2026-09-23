// Caso de uso "iniciar jornada" -- coordena a decisao pura
// (pos-consulta-jornada.ts) com o efeito real (RPC de reserva da entrega) e
// a redacao da primeira mensagem. NUNCA decide elegibilidade (isso e
// pos-consulta-elegibilidade.ts, chamado ANTES pelo ponto de entrada que
// aciona esta funcao) -- este modulo assume que a decisao de iniciar ja foi
// tomada, e so cuida de fazer isso com seguranca (idempotencia,
// concorrencia).
//
// CORRECAO B2 (reviews/revisao-pos-consulta-conversacional-v1.md): esta
// funcao AUTORIZA e RESERVA a entrega, e devolve o texto pronto -- NUNCA
// confirma a etapa por conta propria. O CHAMADOR e responsavel por: (1)
// enviar `resposta` pelo transporte real; (2) SO DEPOIS do envio ser aceito,
// chamar confirmarEntregaPosConsulta com os dados em `confirmacao`. Sem essa
// segunda chamada, a jornada permanece pendente (nunca "concluida sem
// entrega real") e pode ser retomada mais tarde (reclaim, apos o lease
// expirar) sem duplicar o registro.
//
// PONTO DE ENTRADA REAL desta funcao: pendente de decisao arquitetural (ver
// bloqueador B6 do handoff desta frente) -- este repositorio nao tem hoje
// nenhum mecanismo de disparo por tempo/cron. Esta funcao e o que um futuro
// disparador (nova Edge Function, pg_cron, ou n8n) deve chamar por
// agendamento elegivel, e o QUE ENVIA A MENSAGEM REAL deve chamar
// confirmarEntregaPosConsulta depois.

import { iniciarJornada } from './pos-consulta-jornada.ts';
import { iniciarJornadaPosConsulta } from './pos-consulta-iniciar-jornada.ts';
import { gerarRespostaPosConsulta } from './pos-consulta-gerar-resposta.ts';
import type { ContextoFatosPosConsulta } from './pos-consulta-fatos-autorizados.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';
import type { ClienteRedatorPosConsulta } from './cliente-modelo-redator-pos-consulta-openai.ts';
import type { MotivoFallbackRespostaPosConsulta } from './pos-consulta-gerar-resposta.ts';
import type { ModoPosConsulta } from './pos-consulta-tipos.ts';

export interface EntradaProcessarInicioPosConsulta {
  clinicaId: string;
  agendamentoId: string;
  pacienteId: string;
  telefoneNormalizado: string;
  /** 'nenhum' nunca chega aqui -- barrado pela elegibilidade antes desta chamada. */
  modo: Exclude<ModoPosConsulta, 'nenhum'>;
  contexto: ContextoFatosPosConsulta;
}

/**
 * Dados que o chamador precisa guardar para, DEPOIS do envio real, confirmar
 * a entrega. NAO carrega a etapa de destino (B2, segunda revisao) --
 * `confirmarEntregaPosConsulta` deriva sozinha, a partir do que ja esta
 * gravado na jornada; o chamador nunca decide isso.
 */
export interface ConfirmacaoPendentePosConsulta {
  agendamentoId: string;
  /** Identidade ESTAVEL da entrega -- chave idempotente para o transporte, quando suportado. */
  entregaId: string;
  claimToken: string;
}

export type ResultadoProcessarInicioPosConsulta =
  | {
      tipo: 'entrega_pendente';
      resposta: string;
      motivo_fallback: MotivoFallbackRespostaPosConsulta | null;
      confirmacao: ConfirmacaoPendentePosConsulta;
    }
  // Outra chamada ja reservou esta mesma entrega e o lease ainda vale --
  // NUNCA enviar mensagem.
  | { tipo: 'em_andamento' }
  // Corrida perdida ou reentrega -- a jornada JA FOI CONFIRMADA em alguma
  // etapa por outra execucao. NUNCA enviar mensagem aqui (criterio de
  // aceite 7).
  | { tipo: 'ja_existia' }
  // Janela maxima de idade (revisao final do Codex, bloqueador 2) -- a RPC,
  // sob lock, recusou autorizar. NUNCA enviar mensagem.
  | { tipo: 'fora_da_janela' }
  // B4 -- outra jornada do mesmo telefone ja esta ativa. NUNCA enviar
  // mensagem.
  | { tipo: 'conflito_telefone_ativo' };

export async function processarInicioPosConsulta(
  clienteRpc: ClienteRpc,
  clienteRedator: ClienteRedatorPosConsulta | null,
  entrada: EntradaProcessarInicioPosConsulta
): Promise<ResultadoProcessarInicioPosConsulta> {
  // A decisao do turno 0 e SEMPRE `perguntar_satisfacao` (revisao final do
  // Codex, bloqueador 1): a primeira entrega nunca e convite Google.
  const { decisao } = iniciarJornada({ modo: entrada.modo });

  const resultadoRpc = await iniciarJornadaPosConsulta(clienteRpc, {
    clinica_id: entrada.clinicaId,
    agendamento_id: entrada.agendamentoId,
    paciente_id: entrada.pacienteId,
    telefone_normalizado: entrada.telefoneNormalizado,
    modo: entrada.modo,
    convite_pendente: false,
    // Snapshot gravado na propria jornada (Proposta C) -- o fluxo reativo,
    // ao processar a resposta do paciente mais tarde, nao tem outra fonte
    // para este valor.
    ...(entrada.contexto.linkAvaliacaoGoogle !== undefined
      ? { link_avaliacao_google: entrada.contexto.linkAvaliacaoGoogle }
      : {}),
  });

  if (resultadoRpc.tipo === 'em_andamento') return { tipo: 'em_andamento' };
  if (resultadoRpc.tipo === 'ja_existia') return { tipo: 'ja_existia' };
  if (resultadoRpc.tipo === 'fora_da_janela') return { tipo: 'fora_da_janela' };
  if (resultadoRpc.tipo === 'conflito_telefone_ativo') return { tipo: 'conflito_telefone_ativo' };

  const resultadoResposta = await gerarRespostaPosConsulta(clienteRedator, {
    decisao,
    contexto: entrada.contexto,
  });

  return {
    tipo: 'entrega_pendente',
    resposta: resultadoResposta.resposta,
    motivo_fallback: resultadoResposta.motivo_fallback,
    confirmacao: {
      agendamentoId: entrada.agendamentoId,
      entregaId: resultadoRpc.entrega_id,
      claimToken: resultadoRpc.claim_token,
    },
  };
}
