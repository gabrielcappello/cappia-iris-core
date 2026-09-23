// Caso de uso "processar resposta de satisfacao" -- usado quando a mensagem
// do paciente NAO tem nenhum pedido operacional concorrente (ver
// pos-consulta-integracao-mensagem.ts para o caso misto, Proposta C).
// Coordena a reivindicacao (classificacao + RPC, pos-consulta-reivindicar-
// resposta.ts) com a redacao PROPRIA de pos-consulta.
//
// CORRECAO B2 (reviews/revisao-pos-consulta-conversacional-v1.md): esta
// funcao AUTORIZA e RESERVA a entrega, e devolve o texto pronto -- NUNCA
// confirma a etapa por conta propria. O CHAMADOR e responsavel por enviar
// `resposta` e SO DEPOIS chamar confirmarEntregaPosConsulta com os dados em
// `confirmacao`. A etapa de destino NAO viaja mais aqui (segunda revisao,
// B2): confirmarEntregaPosConsulta agora deriva sozinha.

import { reivindicarRespostaPosConsulta } from './pos-consulta-reivindicar-resposta.ts';
import type {
  EntradaReivindicarRespostaPosConsulta,
  JornadaAbertaParaResposta,
} from './pos-consulta-reivindicar-resposta.ts';
import { gerarRespostaPosConsulta } from './pos-consulta-gerar-resposta.ts';
import type { ContextoFatosPosConsulta } from './pos-consulta-fatos-autorizados.ts';
import type { DecisaoPosConsulta } from './pos-consulta-jornada.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';
import type { ClienteClassificadorPosConsulta } from './cliente-modelo-classificador-pos-consulta-openai.ts';
import type { ClienteRedatorPosConsulta } from './cliente-modelo-redator-pos-consulta-openai.ts';
import type { MotivoFallbackRespostaPosConsulta } from './pos-consulta-gerar-resposta.ts';
import type { ConfirmacaoPendentePosConsulta } from './pos-consulta-processar-inicio.ts';

export type { JornadaAbertaParaResposta };

export interface EntradaProcessarRespostaPosConsulta extends EntradaReivindicarRespostaPosConsulta {
  contexto: ContextoFatosPosConsulta;
}

export type ResultadoProcessarRespostaPosConsulta =
  | {
      tipo: 'entrega_pendente';
      resposta: string;
      motivo_fallback: MotivoFallbackRespostaPosConsulta | null;
      confirmacao: ConfirmacaoPendentePosConsulta;
    }
  // Outra chamada ja reservou esta mesma entrega e o lease ainda vale --
  // NUNCA enviar mensagem.
  | { tipo: 'em_andamento' }
  // Corrida perdida, replay, ou reentrega -- OUTRA execucao ja confirmou
  // esta transicao. NUNCA envia mensagem de novo (criterio de aceite 6).
  | { tipo: 'ja_processada' }
  // A linha sumiu entre a leitura (buscarJornadaAbertaPosConsulta) e esta
  // chamada -- tratado como "nada a fazer", nunca como erro do turno.
  | { tipo: 'jornada_nao_encontrada' }
  // A jornada ainda esta em 'aguardando_inicio' (a primeira mensagem nunca
  // foi confirmada como entregue) -- nao deveria ocorrer no fluxo normal;
  // falha fechado em vez de presumir.
  | { tipo: 'jornada_nao_aguarda_resposta' };

export async function processarRespostaPosConsulta(
  clienteRpc: ClienteRpc,
  clienteClassificador: ClienteClassificadorPosConsulta | null,
  clienteRedator: ClienteRedatorPosConsulta | null,
  entrada: EntradaProcessarRespostaPosConsulta
): Promise<ResultadoProcessarRespostaPosConsulta> {
  const reivindicacao = await reivindicarRespostaPosConsulta(clienteRpc, clienteClassificador, {
    clinicaId: entrada.clinicaId,
    jornada: entrada.jornada,
    mensagemPaciente: entrada.mensagemPaciente,
  });

  if (reivindicacao.tipo !== 'pendente') return { tipo: reivindicacao.tipo };

  // SEMPRE o valor EFETIVO devolvido pela RPC (via reivindicarRespostaPosConsulta)
  // -- nunca uma proposta local, que pode ter sido substituida por um reclaim.
  const decisao: DecisaoPosConsulta = reivindicacao.convitePendente
    ? { tipo: 'agradecer_e_convidar_avaliacao_google' }
    : { tipo: 'agradecer_sem_convite' };

  const resultadoResposta = await gerarRespostaPosConsulta(clienteRedator, {
    decisao,
    mensagemPaciente: entrada.mensagemPaciente,
    contexto: entrada.contexto,
  });

  return {
    tipo: 'entrega_pendente',
    resposta: resultadoResposta.resposta,
    motivo_fallback: resultadoResposta.motivo_fallback,
    confirmacao: {
      agendamentoId: entrada.jornada.agendamentoId,
      entregaId: reivindicacao.entregaId,
      claimToken: reivindicacao.claimToken,
    },
  };
}
