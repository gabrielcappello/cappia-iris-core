// Composicao "avaliar elegibilidade + iniciar jornada" -- o que o disparador
// (Edge Function iris-nova-pos-consulta, Disparo A aprovado pelo Gabriel em
// 2026-09-16) deve chamar por candidato.
//
// DECISAO DE ARQUITETURA (Disparo A): a leitura da CONFIGURACAO da clinica
// (modo/prazo/link/orientacoes) e dos FATOS do agendamento (status,
// concluido_em) continuam fora deste repositorio -- o painel (iris-portal-
// v2) e o schema real nao foram auditados nesta frente (ver handoff). Quem
// hoje ja tem essa leitura, para o fluxo determinístico antigo, e o
// transporte (n8n): por isso o Disparo A aprovado atribui a IDENTIFICACAO
// DO CANDIDATO e a CONFIGURACAO ao n8n (que ja faz isso hoje), e a este
// Core a DECISAO E EXECUCAO a partir do candidato + config recebidos. Esta
// funcao NUNCA confia cegamente no que o n8n filtrou -- reavalia a
// elegibilidade por conta propria (defesa em profundidade, mesmo principio
// de qualquer RPC deste projeto: "nunca confia que o chamador mandou algo
// coerente").
//
// `jornadaJaExiste` da elegibilidade e sempre passado como `false` aqui,
// deliberadamente: a UNICIDADE de fato (impedir duas jornadas para o mesmo
// agendamento OU duas ativas no mesmo telefone) e responsabilidade da RPC
// (`cappia_pos_consulta_iniciar_jornada`, constraints reais do banco) --
// mais forte que qualquer checagem em memoria feita aqui antes da corrida.
// A elegibilidade cobre as condicoes que a RPC NAO pode avaliar sozinha
// (prazo configurado, validade do link, o proprio modo estar ativo).

import { avaliarElegibilidadePosConsulta } from './pos-consulta-elegibilidade.ts';
import type { FatosAgendamentoParaElegibilidade } from './pos-consulta-elegibilidade.ts';
import { processarInicioPosConsulta } from './pos-consulta-processar-inicio.ts';
import type { ResultadoProcessarInicioPosConsulta } from './pos-consulta-processar-inicio.ts';
import type { ContextoFatosPosConsulta } from './pos-consulta-fatos-autorizados.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';
import type { ClienteRedatorPosConsulta } from './cliente-modelo-redator-pos-consulta-openai.ts';
import type { ModoPosConsulta } from './pos-consulta-tipos.ts';

export interface EntradaAvaliarEIniciarPosConsulta {
  /** `clinica_id` derivado da instancia autenticada -- NUNCA de um campo enviado pelo chamador. */
  clinicaId: string;
  agendamentoId: string;
  pacienteId: string;
  agendamento: FatosAgendamentoParaElegibilidade;
  configuracao: { modo: ModoPosConsulta; prazoMinutos: number; linkAvaliacaoGoogle?: string };
  /** Instante atual, ISO 8601, fornecido pelo chamador -- esta funcao nunca le relogio. */
  agora: string;
  contexto: ContextoFatosPosConsulta;
}

export type ResultadoAvaliarEIniciarPosConsulta =
  | { tipo: 'nao_elegivel'; motivo: string }
  | ResultadoProcessarInicioPosConsulta;

export async function avaliarEIniciarPosConsulta(
  clienteRpc: ClienteRpc,
  clienteRedator: ClienteRedatorPosConsulta | null,
  entrada: EntradaAvaliarEIniciarPosConsulta
): Promise<ResultadoAvaliarEIniciarPosConsulta> {
  const elegibilidade = avaliarElegibilidadePosConsulta({
    clinicaIdOrigem: entrada.clinicaId,
    agendamento: entrada.agendamento,
    configuracao: entrada.configuracao,
    // Ver comentario no topo do arquivo: a RPC de iniciar_jornada e quem
    // de fato garante unicidade -- nunca esta checagem em memoria.
    jornadaJaExiste: false,
    agora: entrada.agora,
  });

  if (!elegibilidade.elegivel) {
    return { tipo: 'nao_elegivel', motivo: elegibilidade.motivo };
  }

  // Elegivel implica telefoneNormalizado !== null (motivo 'telefone_ausente'
  // ja teria barrado acima) -- checagem explicita em vez de `?? ''`, nunca
  // passar string vazia adiante silenciosamente.
  const telefoneNormalizado = entrada.agendamento.telefoneNormalizado;
  if (telefoneNormalizado === null) {
    throw new Error('invariante violada: elegivel=true com telefoneNormalizado nulo');
  }

  // 'nenhum' ja foi barrado pela elegibilidade (motivo 'pos_consulta_desativado').
  const modo = entrada.configuracao.modo as Exclude<ModoPosConsulta, 'nenhum'>;

  const resultado = await processarInicioPosConsulta(clienteRpc, clienteRedator, {
    clinicaId: entrada.clinicaId,
    agendamentoId: entrada.agendamentoId,
    pacienteId: entrada.pacienteId,
    telefoneNormalizado,
    modo,
    contexto: entrada.contexto,
  });

  // A janela maxima tambem e decidida SOB LOCK pela RPC (autoritativa): se ela
  // recusar (ex.: corrida com o relogio, ou reclaim fora da janela), o resultado
  // sai como inelegivel com o MESMO motivo da elegibilidade em memoria.
  if (resultado.tipo === 'fora_da_janela') {
    return { tipo: 'nao_elegivel', motivo: 'janela_maxima_excedida' };
  }
  return resultado;
}
