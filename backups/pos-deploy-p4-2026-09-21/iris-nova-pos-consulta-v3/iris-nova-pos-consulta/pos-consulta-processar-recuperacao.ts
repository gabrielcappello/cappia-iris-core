// Caso de uso "recuperar entrega pendente" -- coordena a RPC de recuperacao
// (pos-consulta-recuperar-entrega.ts) com a redacao da mensagem que faltou
// entregar (sexta revisao do Codex, bloqueador 1).
//
// Como em processarInicioPosConsulta/processarRespostaPosConsulta (B2), esta funcao
// AUTORIZA/RECLAMA a entrega e devolve o texto pronto -- NUNCA confirma. O CHAMADOR
// (n8n) envia `resposta` e SO DEPOIS chama `confirmar` com `confirmacao`.
//
// O QUE E REDIGIDO -- sempre reconstruido dos fatos JA GRAVADOS na jornada, nunca de
// algo que o n8n mande:
//   - `aguardando_inicio` (primeira entrega) -> a pergunta de satisfacao;
//   - `finalizando` (segunda entrega)         -> o agradecimento, COM convite
//     Google somente se a jornada gravou `convite_pendente` (satisfacao positiva ja
//     confirmada), senao SEM convite.
// A mensagem ORIGINAL do paciente nao e guardada na jornada (nao se persiste
// texto do paciente so para isto): a segunda entrega recuperada e redigida a
// partir do OBJETIVO e dos fatos, sem citar o texto dele.
//
// O link do Google vem do SNAPSHOT gravado na jornada (o mesmo que o fluxo
// reativo usa) -- nunca da configuracao atual da clinica.

import { recuperarEntregaPosConsulta } from './pos-consulta-recuperar-entrega.ts';
import type { MotivoAbandonoPosConsulta } from './pos-consulta-recuperar-entrega.ts';
import { gerarRespostaPosConsulta } from './pos-consulta-gerar-resposta.ts';
import type { MotivoFallbackRespostaPosConsulta } from './pos-consulta-gerar-resposta.ts';
import type { ContextoFatosPosConsulta } from './pos-consulta-fatos-autorizados.ts';
import type { DecisaoPosConsulta } from './pos-consulta-jornada.ts';
import type { ConfirmacaoPendentePosConsulta } from './pos-consulta-processar-inicio.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';
import type { ClienteRedatorPosConsulta } from './cliente-modelo-redator-pos-consulta-openai.ts';

export interface EntradaProcessarRecuperacaoPosConsulta {
  /** `clinica_id` derivado da instancia autenticada -- NUNCA de um campo enviado pelo chamador. */
  clinicaId: string;
  agendamentoId: string;
  pacienteId: string;
  /** Telefone OFICIAL atual, relido em fonte autoritativa (`null` se nao existe mais). */
  telefoneNormalizado: string | null;
  /** Fatos cosmeticos e orientacoes; o `linkAvaliacaoGoogle` daqui e IGNORADO (vale o snapshot da jornada). */
  contexto: ContextoFatosPosConsulta;
}

export type ResultadoProcessarRecuperacaoPosConsulta =
  | {
      tipo: 'entrega_pendente';
      etapa: 'aguardando_inicio' | 'finalizando';
      resposta: string;
      motivo_fallback: MotivoFallbackRespostaPosConsulta | null;
      confirmacao: ConfirmacaoPendentePosConsulta;
    }
  // NUNCA enviar mensagem em nenhum dos demais casos.
  | { tipo: 'em_andamento' }
  | { tipo: 'nao_pendente'; etapa: string }
  | { tipo: 'jornada_nao_encontrada' }
  | { tipo: 'abandonada'; motivo: MotivoAbandonoPosConsulta };

export async function processarRecuperacaoPosConsulta(
  clienteRpc: ClienteRpc,
  clienteRedator: ClienteRedatorPosConsulta | null,
  entrada: EntradaProcessarRecuperacaoPosConsulta
): Promise<ResultadoProcessarRecuperacaoPosConsulta> {
  const recuperacao = await recuperarEntregaPosConsulta(clienteRpc, {
    clinica_id: entrada.clinicaId,
    agendamento_id: entrada.agendamentoId,
    paciente_id: entrada.pacienteId,
    telefone_normalizado: entrada.telefoneNormalizado,
  });

  if (recuperacao.tipo === 'abandonada') return { tipo: 'abandonada', motivo: recuperacao.motivo };
  if (recuperacao.tipo !== 'pendente') return recuperacao;

  // A decisao vem SEMPRE do que a jornada gravou -- nunca recalculada aqui.
  const decisao: DecisaoPosConsulta =
    recuperacao.etapa === 'aguardando_inicio'
      ? { tipo: 'perguntar_satisfacao' }
      : recuperacao.convite_pendente
        ? { tipo: 'agradecer_e_convidar_avaliacao_google' }
        : { tipo: 'agradecer_sem_convite' };

  // Link SO do snapshot da jornada, e SO quando a decisao convida (o adaptador ja
  // garantiu que convite_pendente implica link + positiva + modo com Google).
  const { linkAvaliacaoGoogle: _ignorado, ...contextoSemLink } = entrada.contexto;
  const contexto: ContextoFatosPosConsulta = {
    ...contextoSemLink,
    ...(decisao.tipo === 'agradecer_e_convidar_avaliacao_google' && recuperacao.link_avaliacao_google !== undefined
      ? { linkAvaliacaoGoogle: recuperacao.link_avaliacao_google }
      : {}),
  };

  const resultadoResposta = await gerarRespostaPosConsulta(clienteRedator, { decisao, contexto });

  return {
    tipo: 'entrega_pendente',
    etapa: recuperacao.etapa,
    resposta: resultadoResposta.resposta,
    motivo_fallback: resultadoResposta.motivo_fallback,
    confirmacao: {
      agendamentoId: entrada.agendamentoId,
      entregaId: recuperacao.entrega_id,
      claimToken: recuperacao.claim_token,
    },
  };
}
