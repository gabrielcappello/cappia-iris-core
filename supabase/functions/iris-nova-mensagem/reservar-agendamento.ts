// Adaptador fino para a RPC publica.cappia_reservar_agendamento (Postgres,
// ja em producao -- ver docs/iris-v3/08-auditoria-rpcs-sql.md em
// cappia-estado, classificacao "reutilizar diretamente"). Nao reimplementa
// a logica de reserva nem a trava de concorrencia -- so chama a funcao ja
// testada com os identificadores JA resolvidos por este Core (procedimento_
// id/dentista_id/duracao_min/data/horario), nunca recalculados aqui.
//
// mesmo padrao de aplicar-interpretacao-condicional.ts: uma unica chamada,
// sem retry, validacao estrita de entrada e saida, nunca vaza
// error.message nem o payload bruto da RPC.

import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';

const NOME_RPC = 'cappia_reservar_agendamento';

// Vocabulario de erro exatamente como auditado (RETURNS jsonb, motivo).
// 'horario_ocupado' e tratado a parte (vira 'conflito', nunca 'falhou') --
// e o unico caso em que o chamador deve pedir uma nova escolha, nao um erro
// tecnico a reportar.
const MOTIVOS_ERRO: readonly string[] = [
  'data_invalida',
  'horario_invalido',
  'dentista_nao_informado',
  'dentista_nao_encontrado',
  'dentista_ambiguo',
  'procedimento_obrigatorio',
  'procedimento_nao_encontrado',
  'procedimento_nao_disponivel_para_dentista',
  'horario_ocupado',
  'erro_insercao',
];

export type MotivoErroReserva = Exclude<(typeof MOTIVOS_ERRO)[number], 'horario_ocupado'>;

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATA_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const HORARIO_REGEX = /^[0-9]{1,2}:[0-9]{2}$/;

export interface ReservarAgendamentoEntrada {
  clinica_id: string;
  procedimento_id: string;
  dentista_id: string;
  paciente_id: string;
  data: string; // YYYY-MM-DD
  horario: string; // HH:MM
  telefone_normalizado: string;
}

export type ResultadoReservaAgendamento =
  | {
      tipo: 'reservado';
      agendamento_id: string;
      dentista_id: string;
      duracao_min: number;
      data: string;
      horario: string;
    }
  | { tipo: 'conflito' }
  | { tipo: 'falhou'; motivo: MotivoErroReserva };

export async function reservarAgendamento(
  cliente: ClienteRpc,
  entrada: ReservarAgendamentoEntrada
): Promise<ResultadoReservaAgendamento> {
  validarEntrada(entrada);

  const { data, error } = await cliente.rpc(NOME_RPC, {
    p_clinica_id: entrada.clinica_id,
    p_data: entrada.data,
    p_horario: entrada.horario,
    p_procedimento_id: entrada.procedimento_id,
    p_paciente_id: entrada.paciente_id,
    p_dentista_id: entrada.dentista_id,
    p_telefone: entrada.telefone_normalizado,
  });

  if (error) {
    // Nunca propaga error.message (pode conter SQL/detalhe de linha).
    throw new ErroRpcTecnico(NOME_RPC, 'cliente_supabase_falhou');
  }

  return validarSaida(data);
}

function validarEntrada(entrada: ReservarAgendamentoEntrada): void {
  validarUuid('clinica_id', entrada.clinica_id);
  validarUuid('dentista_id', entrada.dentista_id);
  validarUuid('paciente_id', entrada.paciente_id);
  if (typeof entrada.procedimento_id !== 'string' || entrada.procedimento_id.trim() === '') {
    throw new EntradaInvalidaError('procedimento_id', 'procedimento_id deve ser uma string nao vazia');
  }
  if (typeof entrada.data !== 'string' || !DATA_REGEX.test(entrada.data)) {
    throw new EntradaInvalidaError('data', 'data deve estar no formato YYYY-MM-DD');
  }
  if (typeof entrada.horario !== 'string' || !HORARIO_REGEX.test(entrada.horario)) {
    throw new EntradaInvalidaError('horario', 'horario deve estar no formato HH:MM');
  }
  if (typeof entrada.telefone_normalizado !== 'string' || entrada.telefone_normalizado.trim() === '') {
    throw new EntradaInvalidaError('telefone_normalizado', 'telefone_normalizado deve ser uma string nao vazia');
  }
}

function validarUuid(campo: string, valor: string): void {
  if (typeof valor !== 'string' || !UUID_REGEX.test(valor)) {
    throw new EntradaInvalidaError(campo, `${campo} deve estar no formato UUID valido`);
  }
}

// RETURNS jsonb (escalar) -- ao contrario de aplicar_interpretacao_condicional
// (RETURNS TABLE), o retorno chega como objeto direto, nunca envolto em array.
function validarSaida(data: unknown): ResultadoReservaAgendamento {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErroRpcTecnico(NOME_RPC, 'retorno da RPC deve ser um objeto');
  }
  const bruto = data as Record<string, unknown>;

  if (typeof bruto.sucesso !== 'boolean') {
    throw new ErroRpcTecnico(NOME_RPC, "campo 'sucesso' ausente ou invalido");
  }

  if (bruto.sucesso) {
    const { agendamento_id, dentista_id, duracao_min, data: dataResultado, horario } = bruto;
    if (
      typeof agendamento_id !== 'string' ||
      typeof dentista_id !== 'string' ||
      typeof duracao_min !== 'number' ||
      typeof dataResultado !== 'string' ||
      typeof horario !== 'string'
    ) {
      throw new ErroRpcTecnico(
        NOME_RPC,
        "sucesso=true deve retornar agendamento_id, dentista_id, duracao_min, data e horario"
      );
    }
    return { tipo: 'reservado', agendamento_id, dentista_id, duracao_min, data: dataResultado, horario };
  }

  const motivo = bruto.motivo;
  if (typeof motivo !== 'string' || !MOTIVOS_ERRO.includes(motivo)) {
    throw new ErroRpcTecnico(NOME_RPC, "campo 'motivo' ausente ou fora do vocabulario aprovado");
  }
  if (motivo === 'horario_ocupado') return { tipo: 'conflito' };
  return { tipo: 'falhou', motivo: motivo as MotivoErroReserva };
}
