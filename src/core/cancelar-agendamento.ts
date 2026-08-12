// Adaptador fino para a RPC public.cappia_cancelar_agendamento_v2 (Postgres).
// Contrato: specs/cancelamento-conversacional-v1.md secao 6.
//
// Mesmo padrao de remarcar-agendamento.ts e reservar-agendamento.ts: uma unica
// chamada, sem retry, validacao estrita de entrada e saida, nunca vaza
// error.message nem o payload bruto da RPC.
//
// O NOME TEM SUFIXO `_v2` DE PROPOSITO: `cappia_cancelar_agendamento` (sem
// sufixo) EXISTE E ESTA VIVA no banco operacional, com outra assinatura
// (`p_agendamento_id, p_clinica_id` -- SEM `p_paciente_id`) e sem checagem de
// dono. Sobrescreve-la trocaria o corpo de uma funcao legada em producao --
// proibido pela spec secao "Auditoria". A legada tambem nao valida
// `status = 'confirmado'` antes de cancelar, entao um agendamento ja
// concluido/remarcado/faltou poderia ser virado para 'cancelado' por ela.
// Nenhum dos dois defeitos e reproduzido aqui.
//
// NAO E CONSULTA e NAO E DISPONIBILIDADE: este adaptador nao le agenda, nao
// resolve horario e nao decide nada de conversa -- o agendamento chega AQUI ja
// localizado e ja confirmado pelo paciente.

import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';

const NOME_RPC = 'cappia_cancelar_agendamento_v2';

// Vocabulario fechado exatamente como a RPC o define (spec secao 6).
//
// Nenhum motivo e traduzido para desfecho conversacional aqui (ao contrario de
// reservar-agendamento.ts, que converte `horario_ocupado` em 'conflito'):
// cancelar nunca disputa horario, entao nao existe conflito a traduzir. Os
// tres motivos abaixo colapsam todos na mesma frase tecnica generica no
// orquestrador -- decisao auditada na spec secao 7.
const MOTIVOS_ERRO = ['agendamento_nao_encontrado', 'nao_confirmado', 'erro_insercao'] as const;

export type MotivoErroCancelamento = (typeof MOTIVOS_ERRO)[number];

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface CancelarAgendamentoEntrada {
  clinica_id: string;
  /**
   * Dono do agendamento. Participa do `WHERE` do `SELECT ... FOR UPDATE` --
   * e o que impede cancelar agendamento alheio, e a razao principal de a RPC
   * legada nao poder ser reaproveitada.
   */
  paciente_id: string;
  /** Agendamento a cancelar, ja localizado por buscarAgendamentoAtivo. */
  agendamento_id: string;
}

export type ResultadoCancelarAgendamento =
  | {
      tipo: 'cancelado';
      agendamento_id: string;
      /**
       * `true` quando esta chamada NAO produziu escrita nova: o agendamento ja
       * estava cancelado e o que voltou foi o replay (spec secao 6). O desfecho
       * para o paciente e o MESMO -- por isso e sucesso, nunca erro. Uma
       * retentativa depois de um timeout de rede cai aqui.
       */
      ja_cancelado: boolean;
    }
  | { tipo: 'falhou'; motivo: MotivoErroCancelamento };

export async function cancelarAgendamento(
  cliente: ClienteRpc,
  entrada: CancelarAgendamentoEntrada
): Promise<ResultadoCancelarAgendamento> {
  validarEntrada(entrada);

  const { data, error } = await cliente.rpc(NOME_RPC, {
    p_clinica_id: entrada.clinica_id,
    p_paciente_id: entrada.paciente_id,
    p_agendamento_id: entrada.agendamento_id,
  });

  if (error) {
    // Nunca propaga error.message (pode conter SQL/detalhe de linha/PII).
    throw new ErroRpcTecnico(NOME_RPC, 'cliente_supabase_falhou');
  }

  return validarSaida(data);
}

function validarEntrada(entrada: CancelarAgendamentoEntrada): void {
  validarUuid('clinica_id', entrada.clinica_id);
  validarUuid('paciente_id', entrada.paciente_id);
  validarUuid('agendamento_id', entrada.agendamento_id);
}

function validarUuid(campo: string, valor: string): void {
  if (typeof valor !== 'string' || !UUID_REGEX.test(valor)) {
    throw new EntradaInvalidaError(campo, `${campo} deve estar no formato UUID valido`);
  }
}

// RETURNS jsonb (escalar) -- o retorno chega como objeto direto, nunca envolto
// em array. Mesma forma de cappia_remarcar_agendamento_v2.
function validarSaida(data: unknown): ResultadoCancelarAgendamento {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErroRpcTecnico(NOME_RPC, 'retorno da RPC deve ser um objeto');
  }
  const bruto = data as Record<string, unknown>;

  if (typeof bruto.sucesso !== 'boolean') {
    throw new ErroRpcTecnico(NOME_RPC, "campo 'sucesso' ausente ou invalido");
  }

  if (bruto.sucesso) {
    const { agendamento_id } = bruto;
    if (typeof agendamento_id !== 'string' || !UUID_REGEX.test(agendamento_id)) {
      throw new ErroRpcTecnico(NOME_RPC, 'sucesso=true deve retornar agendamento_id em formato UUID');
    }
    // Ausente = false. `ja_cancelado` so aparece no replay; o cancelamento
    // normal nao carrega o campo (mesma forma de `ja_remarcado`).
    if (bruto.ja_cancelado !== undefined && typeof bruto.ja_cancelado !== 'boolean') {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'ja_cancelado' presente com tipo invalido");
    }
    return { tipo: 'cancelado', agendamento_id, ja_cancelado: bruto.ja_cancelado === true };
  }

  const motivo = bruto.motivo;
  // Motivo desconhecido FALHA FECHADO: nunca reinterpretado como um dos
  // conhecidos nem silenciado como falha generica.
  if (typeof motivo !== 'string' || !MOTIVOS_ERRO.includes(motivo as MotivoErroCancelamento)) {
    throw new ErroRpcTecnico(NOME_RPC, "campo 'motivo' ausente ou fora do vocabulario aprovado");
  }
  return { tipo: 'falhou', motivo: motivo as MotivoErroCancelamento };
}
