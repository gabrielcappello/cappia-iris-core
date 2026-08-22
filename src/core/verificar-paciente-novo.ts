// Verifica se o paciente e NOVO nesta clinica (specs/recomendacao-avaliacao-
// paciente-novo-v1.md secao 1): nenhum atendimento CONCLUIDO em
// `agendamentos` para este paciente_id + clinica_id. Nunca "sem cadastro",
// nunca "sem agendamento futuro" -- so historico de atendimento realizado.
//
// Mesmo espirito de buscar-agendamento-ativo.ts: SELECT direto, sem RPC, sem
// decidir nada de dominio -- so traduz o schema real em booleano. NAO
// reaproveita buscarAgendamentoAtivo: aquela busca e sobre agendamento FUTURO
// (`status='confirmado'`, `data >= hoje`); esta e sobre HISTORICO
// (`status='concluido'`, sem corte de data).

import { EntradaInvalidaError } from './erros.ts';
import type { ClienteBancoDados } from './tipos.ts';

export interface EntradaVerificarPacienteNovo {
  clinica_id: string;
  paciente_id: string;
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * `true` quando NAO existe nenhuma linha `concluido` deste paciente nesta
 * clinica -- isolamento multiclinica sempre pelo par (paciente_id,
 * clinica_id), nunca so paciente_id (specs/recomendacao-avaliacao-paciente-
 * novo-v1.md secao 1).
 */
export async function verificarPacienteNovo(
  cliente: ClienteBancoDados,
  entrada: EntradaVerificarPacienteNovo
): Promise<boolean> {
  validarEntrada(entrada);

  const { data, error } = await cliente
    .from('agendamentos')
    .select('id')
    .eq('clinica_id', entrada.clinica_id)
    .eq('paciente_id', entrada.paciente_id)
    .eq('status', 'concluido');

  if (error) throw new Error(`falha ao verificar paciente novo: ${error.message}`);

  return (data ?? []).length === 0;
}

const CHAVES_ENTRADA = ['clinica_id', 'paciente_id'] as const;

function validarEntrada(entrada: unknown): asserts entrada is EntradaVerificarPacienteNovo {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new EntradaInvalidaError('entrada', 'entrada deve ser um objeto');
  }
  const chaves = Object.keys(entrada as Record<string, unknown>);
  const esperadas: readonly string[] = CHAVES_ENTRADA;
  if (chaves.length !== esperadas.length || !esperadas.every((chave) => chaves.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada contem propriedade nao permitida');
  }

  const { clinica_id, paciente_id } = entrada as Record<string, unknown>;
  if (typeof clinica_id !== 'string' || !UUID_REGEX.test(clinica_id)) {
    throw new EntradaInvalidaError('clinica_id', 'clinica_id deve estar no formato UUID valido');
  }
  if (typeof paciente_id !== 'string' || !UUID_REGEX.test(paciente_id)) {
    throw new EntradaInvalidaError('paciente_id', 'paciente_id deve estar no formato UUID valido');
  }
}
