// Reivindica a SEGUNDA entrega de pos-consulta (classifica a resposta do
// paciente + reserva a pendencia via RPC) SEM redigir nada -- extraido de
// pos-consulta-processar-resposta.ts para ser reusado tambem pela
// integracao com o fluxo principal (Proposta C, mensagens mistas:
// reviews/revisao-pos-consulta-conversacional-v1.md, segunda revisao,
// aprovada pelo Gabriel em 2026-09-16).
//
// Duas chamadoras usam este mesmo primitivo:
// - pos-consulta-processar-resposta.ts (mensagem SEM pedido operacional
//   concorrente): reivindica e redige com o redator PROPRIO de pos-consulta.
// - pos-consulta-integracao-mensagem.ts (mensagem COM pedido operacional
//   concorrente, Proposta C): reivindica aqui, mas a redacao final e feita
//   pelo redator PRINCIPAL (fatos aditivos), nunca pelo redator proprio.
//
// Em ambos os casos, a classificacao/decisao que PREVALECE e sempre a
// devolvida pela RPC (`convite_pendente` efetivo) -- nunca a calculada
// localmente, que serve so de PROPOSTA (ver comentario em
// pos-consulta-jornada.ts sobre reclaim preservar a decisao original).

import { classificarRespostaPosConsulta } from './pos-consulta-classificar-resposta.ts';
import { registrarRespostaSatisfacao } from './pos-consulta-jornada.ts';
import { registrarRespostaPendentePosConsulta } from './pos-consulta-registrar-resposta-pendente.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';
import type { ClienteClassificadorPosConsulta } from './cliente-modelo-classificador-pos-consulta-openai.ts';
import type { ClassificacaoSatisfacao, ModoPosConsulta } from './pos-consulta-tipos.ts';
import { EntradaInvalidaError } from './erros.ts';

export interface JornadaAbertaParaResposta {
  agendamentoId: string;
  /** 'nenhum' nunca ocorre aqui -- a jornada so existe para modos que perguntam. */
  modo: Exclude<ModoPosConsulta, 'nenhum'>;
}

export interface EntradaReivindicarRespostaPosConsulta {
  /** `clinica_id` derivado da instancia autenticada -- NUNCA da mensagem do paciente. */
  clinicaId: string;
  jornada: JornadaAbertaParaResposta;
  mensagemPaciente: string;
}

export type ResultadoReivindicarRespostaPosConsulta =
  | {
      tipo: 'pendente';
      classificacao: ClassificacaoSatisfacao;
      /** Valor EFETIVO (pode vir de reclaim) -- nunca o proposto localmente. */
      convitePendente: boolean;
      entregaId: string;
      claimToken: string;
    }
  | { tipo: 'em_andamento' }
  | { tipo: 'ja_processada' }
  | { tipo: 'jornada_nao_encontrada' }
  | { tipo: 'jornada_nao_aguarda_resposta' };

export async function reivindicarRespostaPosConsulta(
  clienteRpc: ClienteRpc,
  clienteClassificador: ClienteClassificadorPosConsulta | null,
  entrada: EntradaReivindicarRespostaPosConsulta
): Promise<ResultadoReivindicarRespostaPosConsulta> {
  if (typeof entrada.mensagemPaciente !== 'string' || entrada.mensagemPaciente.trim() === '') {
    throw new EntradaInvalidaError('mensagemPaciente', 'mensagemPaciente nao pode ser vazia');
  }

  const classificacao = await classificarRespostaPosConsulta(clienteClassificador, {
    mensagemPaciente: entrada.mensagemPaciente,
  });

  // Decisao PRELIMINAR -- so para saber que convite PROPOR a RPC.
  const preliminar = registrarRespostaSatisfacao({
    etapaAtual: 'aguardando_satisfacao',
    modo: entrada.jornada.modo,
    classificacao,
  });
  const convitePendenteProposto = preliminar.decisao.tipo === 'agradecer_e_convidar_avaliacao_google';

  const resultadoRpc = await registrarRespostaPendentePosConsulta(clienteRpc, {
    clinica_id: entrada.clinicaId,
    agendamento_id: entrada.jornada.agendamentoId,
    classificacao,
    convite_pendente: convitePendenteProposto,
  });

  if (resultadoRpc.tipo === 'em_andamento') return { tipo: 'em_andamento' };
  if (resultadoRpc.tipo === 'ja_processada') return { tipo: 'ja_processada' };
  if (resultadoRpc.tipo === 'jornada_nao_encontrada') return { tipo: 'jornada_nao_encontrada' };
  if (resultadoRpc.tipo === 'jornada_nao_aguarda_resposta') return { tipo: 'jornada_nao_aguarda_resposta' };

  return {
    tipo: 'pendente',
    // A CLASSIFICACAO efetiva tambem pode vir de reclaim -- a RPC nao a
    // devolve separadamente hoje (so `convite_pendente`), mas o valor
    // localmente calculado e o mesmo enviado como proposta; em reclaim, o
    // `convite_pendente` efetivo ja reflete a decisao original gravada, que
    // e o que importa para o roteamento (Proposta C nunca le
    // `classificacao` para decidir link, so `convitePendente`).
    classificacao: resultadoRpc.classificacao,
    convitePendente: resultadoRpc.convite_pendente,
    entregaId: resultadoRpc.entrega_id,
    claimToken: resultadoRpc.claim_token,
  };
}
