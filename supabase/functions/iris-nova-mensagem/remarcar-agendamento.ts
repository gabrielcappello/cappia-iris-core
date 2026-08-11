// Adaptador fino para a RPC public.cappia_remarcar_agendamento_v2 (Postgres).
// Contrato: specs/remarcacao-operacional-v1.md secao 3.
//
// Mesmo padrao de reservar-agendamento.ts: uma unica chamada, sem retry,
// validacao estrita de entrada e saida, nunca vaza error.message nem o
// payload bruto da RPC.
//
// O NOME TEM SUFIXO `_v2` DE PROPOSITO: `cappia_remarcar_agendamento` (sem
// sufixo) EXISTE E ESTA VIVA no banco operacional, com outra assinatura e
// outra responsabilidade (resolve dentista/procedimento/duracao dentro do
// SQL). Sobrescreve-la trocaria o corpo de uma funcao legada em producao --
// proibido pela spec secao 6.
//
// Este Core NAO chama a legada, nem cappia_disponibilidade_canonica, nem
// nenhum resolver SQL: todos os identificadores chegam AQUI ja resolvidos em
// TypeScript.

import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';

const NOME_RPC = 'cappia_remarcar_agendamento_v2';

// Vocabulario fechado exatamente como a RPC o define (spec secao 3).
// `horario_ocupado` NAO e tratado a parte aqui (ao contrario de
// reservar-agendamento.ts, que o traduz para 'conflito'): na remarcacao ele
// chega junto dos demais e quem decide o que fazer e a camada conversacional,
// que ainda nao existe. Traduzi-lo agora seria decidir conversa neste
// adaptador.
const MOTIVOS_ERRO = [
  'agendamento_nao_encontrado',
  'nao_confirmado',
  'data_invalida',
  'horario_invalido',
  'duracao_invalida',
  'horario_ocupado',
  'erro_insercao',
] as const;

export type MotivoErroRemarcacao = (typeof MOTIVOS_ERRO)[number];

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATA_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const HORARIO_REGEX = /^[0-9]{1,2}:[0-9]{2}$/;

export interface RemarcarAgendamentoEntrada {
  clinica_id: string;
  paciente_id: string;
  /** Agendamento ATUAL, que sera marcado como 'remarcado'. */
  agendamento_id: string;
  /** Ja resolvido pelo Core -- a RPC nunca resolve dentista. */
  dentista_id: string;
  /** Ja resolvido pelo Core -- a RPC nunca resolve procedimento. */
  procedimento_id: string;
  /** Ja resolvida por resolverDuracao -- a RPC nunca calcula duracao. */
  duracao_min: number;
  nova_data: string; // YYYY-MM-DD
  novo_horario: string; // HH:MM
}

export type ResultadoRemarcarAgendamento =
  | {
      tipo: 'remarcado';
      agendamento_id: string;
      agendamento_id_antigo: string;
      dentista_id: string;
      duracao_min: number;
      data: string;
      horario: string;
      /**
       * `true` quando esta chamada NAO produziu escrita nova: a remarcacao ja
       * havia sido concluida antes e o que voltou foi o replay do sucessor
       * existente (spec secao 5). O desfecho para o paciente e o MESMO --
       * por isso e sucesso, nunca erro. Uma retentativa depois de um timeout
       * de rede cai aqui.
       */
      ja_remarcado: boolean;
    }
  | { tipo: 'falhou'; motivo: MotivoErroRemarcacao };

export async function remarcarAgendamento(
  cliente: ClienteRpc,
  entrada: RemarcarAgendamentoEntrada
): Promise<ResultadoRemarcarAgendamento> {
  validarEntrada(entrada);

  const { data, error } = await cliente.rpc(NOME_RPC, {
    p_clinica_id: entrada.clinica_id,
    p_paciente_id: entrada.paciente_id,
    p_agendamento_id: entrada.agendamento_id,
    p_dentista_id: entrada.dentista_id,
    p_procedimento_id: entrada.procedimento_id,
    p_duracao_min: entrada.duracao_min,
    p_nova_data: entrada.nova_data,
    p_novo_horario: entrada.novo_horario,
  });

  if (error) {
    // Nunca propaga error.message (pode conter SQL/detalhe de linha/PII).
    throw new ErroRpcTecnico(NOME_RPC, 'cliente_supabase_falhou');
  }

  return validarSaida(data);
}

function validarEntrada(entrada: RemarcarAgendamentoEntrada): void {
  validarUuid('clinica_id', entrada.clinica_id);
  validarUuid('paciente_id', entrada.paciente_id);
  validarUuid('agendamento_id', entrada.agendamento_id);
  validarUuid('dentista_id', entrada.dentista_id);

  if (typeof entrada.procedimento_id !== 'string' || entrada.procedimento_id.trim() === '') {
    throw new EntradaInvalidaError('procedimento_id', 'procedimento_id deve ser uma string nao vazia');
  }
  if (typeof entrada.duracao_min !== 'number' || !Number.isInteger(entrada.duracao_min) || entrada.duracao_min <= 0) {
    throw new EntradaInvalidaError('duracao_min', 'duracao_min deve ser um inteiro positivo');
  }
  if (typeof entrada.nova_data !== 'string' || !DATA_REGEX.test(entrada.nova_data)) {
    throw new EntradaInvalidaError('nova_data', 'nova_data deve estar no formato YYYY-MM-DD');
  }
  if (typeof entrada.novo_horario !== 'string' || !HORARIO_REGEX.test(entrada.novo_horario)) {
    throw new EntradaInvalidaError('novo_horario', 'novo_horario deve estar no formato HH:MM');
  }
}

function validarUuid(campo: string, valor: string): void {
  if (typeof valor !== 'string' || !UUID_REGEX.test(valor)) {
    throw new EntradaInvalidaError(campo, `${campo} deve estar no formato UUID valido`);
  }
}

// RETURNS jsonb (escalar) -- o retorno chega como objeto direto, nunca envolto
// em array. Mesma forma de cappia_reservar_agendamento.
function validarSaida(data: unknown): ResultadoRemarcarAgendamento {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErroRpcTecnico(NOME_RPC, 'retorno da RPC deve ser um objeto');
  }
  const bruto = data as Record<string, unknown>;

  if (typeof bruto.sucesso !== 'boolean') {
    throw new ErroRpcTecnico(NOME_RPC, "campo 'sucesso' ausente ou invalido");
  }

  if (bruto.sucesso) {
    const { agendamento_id, agendamento_id_antigo, dentista_id, duracao_min, data: dataResultado, horario } = bruto;
    if (
      typeof agendamento_id !== 'string' ||
      typeof agendamento_id_antigo !== 'string' ||
      typeof dentista_id !== 'string' ||
      typeof duracao_min !== 'number' ||
      typeof dataResultado !== 'string' ||
      typeof horario !== 'string'
    ) {
      throw new ErroRpcTecnico(
        NOME_RPC,
        'sucesso=true deve retornar agendamento_id, agendamento_id_antigo, dentista_id, duracao_min, data e horario'
      );
    }
    // Ausente = false. `ja_remarcado` so aparece no replay; a remarcacao
    // normal nao carrega o campo (mesma forma de `ja_cancelado` em
    // cappia_cancelar_agendamento).
    if (bruto.ja_remarcado !== undefined && typeof bruto.ja_remarcado !== 'boolean') {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'ja_remarcado' presente com tipo invalido");
    }
    return {
      tipo: 'remarcado',
      agendamento_id,
      agendamento_id_antigo,
      dentista_id,
      duracao_min,
      data: dataResultado,
      horario,
      ja_remarcado: bruto.ja_remarcado === true,
    };
  }

  const motivo = bruto.motivo;
  // Motivo desconhecido FALHA FECHADO: nunca reinterpretado como um dos
  // conhecidos nem silenciado como falha generica.
  if (typeof motivo !== 'string' || !MOTIVOS_ERRO.includes(motivo as MotivoErroRemarcacao)) {
    throw new ErroRpcTecnico(NOME_RPC, "campo 'motivo' ausente ou fora do vocabulario aprovado");
  }
  return { tipo: 'falhou', motivo: motivo as MotivoErroRemarcacao };
}
