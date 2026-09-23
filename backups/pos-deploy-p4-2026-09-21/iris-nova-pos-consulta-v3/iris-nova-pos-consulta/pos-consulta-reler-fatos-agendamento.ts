// Relê, em fonte autoritativa (banco), os fatos MUTAVEIS de elegibilidade de
// pos-consulta -- correcao C2 da terceira revisao
// (reviews/revisao-pos-consulta-conversacional-v1.md): a Edge Function
// iris-nova-pos-consulta NAO deve mais confiar em `status`/`concluido_em`/
// `telefone_normalizado` enviados pelo n8n no payload -- esses valores
// podem estar desatualizados entre o momento em que o n8n identificou o
// candidato e o momento em que esta chamada de fato executa. Mesmo
// espirito de buscar-agendamento-ativo.ts: SELECT direto, sem RPC, so
// traduz o schema para o contrato aprovado.

import { EntradaInvalidaError } from './erros.ts';
import type { ClienteBancoDados } from './tipos.ts';

export interface EntradaRelerFatosAgendamentoPosConsulta {
  clinica_id: string;
  agendamento_id: string;
}

export interface FatosAgendamentoRelidos {
  status: string;
  concluidoEm: string | null;
  pacienteId: string;
  /** Telefone OFICIAL atual do paciente (pacientes.telefone_normalizado) -- nunca o do payload. */
  telefoneNormalizado: string | null;
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function relerFatosAgendamentoPosConsulta(
  cliente: ClienteBancoDados,
  entrada: EntradaRelerFatosAgendamentoPosConsulta
): Promise<FatosAgendamentoRelidos | null> {
  if (typeof entrada.clinica_id !== 'string' || !UUID_REGEX.test(entrada.clinica_id)) {
    throw new EntradaInvalidaError('clinica_id', 'clinica_id deve estar no formato UUID valido');
  }
  if (typeof entrada.agendamento_id !== 'string' || !UUID_REGEX.test(entrada.agendamento_id)) {
    throw new EntradaInvalidaError('agendamento_id', 'agendamento_id deve estar no formato UUID valido');
  }

  const { data: linhaAgendamento, error: erroAgendamento } = await cliente
    .from('agendamentos')
    .select('status, concluido_em, paciente_id')
    .eq('id', entrada.agendamento_id)
    .eq('clinica_id', entrada.clinica_id)
    .maybeSingle();
  if (erroAgendamento) throw new Error(`falha ao reler agendamento: ${erroAgendamento.message}`);
  if (!linhaAgendamento) return null;

  const agendamento = linhaAgendamento as Record<string, unknown>;
  const status = agendamento.status;
  const pacienteId = agendamento.paciente_id;
  if (typeof status !== 'string' || typeof pacienteId !== 'string' || !UUID_REGEX.test(pacienteId)) {
    throw new Error('linha de agendamentos com status/paciente_id invalido');
  }
  const concluidoEm = agendamento.concluido_em;
  if (concluidoEm !== null && typeof concluidoEm !== 'string') {
    throw new Error('linha de agendamentos com concluido_em de tipo invalido');
  }

  // Telefone OFICIAL atual, nunca o do payload -- pode ter mudado entre a
  // identificacao do candidato pelo n8n e esta chamada.
  const { data: linhaPaciente, error: erroPaciente } = await cliente
    .from('pacientes')
    .select('telefone_normalizado')
    .eq('id', pacienteId)
    .eq('clinica_id', entrada.clinica_id)
    .maybeSingle();
  if (erroPaciente) throw new Error(`falha ao reler paciente: ${erroPaciente.message}`);

  const telefoneNormalizado =
    linhaPaciente !== null ? (linhaPaciente as Record<string, unknown>).telefone_normalizado : null;
  if (telefoneNormalizado !== null && typeof telefoneNormalizado !== 'string') {
    throw new Error('linha de pacientes com telefone_normalizado de tipo invalido');
  }

  return {
    status,
    concluidoEm,
    pacienteId,
    telefoneNormalizado: typeof telefoneNormalizado === 'string' ? telefoneNormalizado : null,
  };
}
