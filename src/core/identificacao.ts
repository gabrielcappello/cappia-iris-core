import { ClinicaNaoEncontradaError, EntradaInvalidaError } from './erros.ts';
import { telefoneNormalizadoValido } from './telefone.ts';
import type { ClienteBancoDados, EstadoConversa, IdentificarConversaInput, ResultadoIdentificacao } from './tipos.ts';

interface LinhaEstadoConversa {
  id: string;
  estado: string;
  dados: unknown;
  paciente_id: string | null;
}

/**
 * Etapa 1 do roadmap (docs/06-roadmap.md): identifica clinica e paciente a
 * partir do transporte ja normalizado, e garante a existencia de um unico
 * estado de conversa oficial. Nao registra mensagem, nao cria paciente, nao
 * decide nada alem de identificacao.
 */
export async function identificarConversa(
  cliente: ClienteBancoDados,
  entrada: IdentificarConversaInput
): Promise<ResultadoIdentificacao> {
  validarEntrada(entrada);

  const clinica = await buscarClinica(cliente, entrada.provider, entrada.instancia_whatsapp);
  if (!clinica) {
    throw new ClinicaNaoEncontradaError(entrada.provider, entrada.instancia_whatsapp);
  }

  const paciente = await buscarPaciente(cliente, clinica.id, entrada.telefone_normalizado);

  const conversa = await obterOuCriarEstadoConversa(
    cliente,
    clinica.id,
    entrada.telefone_normalizado,
    paciente?.id ?? null
  );

  return {
    clinica_id: clinica.id,
    paciente: {
      encontrado: paciente !== null,
      id: paciente?.id ?? null,
    },
    conversa: {
      id: conversa.id,
      estado: conversa.estado as EstadoConversa,
      dados: (conversa.dados as Record<string, unknown>) ?? {},
    },
  };
}

function validarEntrada(entrada: IdentificarConversaInput): void {
  if (!entrada.provider || entrada.provider.trim() === '') {
    throw new EntradaInvalidaError('provider', 'provider e obrigatorio');
  }
  if (!entrada.instancia_whatsapp || entrada.instancia_whatsapp.trim() === '') {
    throw new EntradaInvalidaError('instancia_whatsapp', 'instancia_whatsapp e obrigatorio');
  }
  if (!telefoneNormalizadoValido(entrada.telefone_normalizado)) {
    throw new EntradaInvalidaError(
      'telefone_normalizado',
      'telefone_normalizado fora do formato brasileiro canonico (55 + 10 ou 11 digitos)'
    );
  }
}

async function buscarClinica(
  cliente: ClienteBancoDados,
  provider: string,
  instanciaWhatsapp: string
): Promise<{ id: string } | null> {
  const { data, error } = await cliente
    .from('clinicas')
    .select('id')
    .eq('provider', provider)
    .eq('instancia_whatsapp', instanciaWhatsapp)
    .maybeSingle();

  if (error) throw new Error(`falha ao buscar clinica: ${error.message}`);
  return (data as { id: string } | null) ?? null;
}

async function buscarPaciente(
  cliente: ClienteBancoDados,
  clinicaId: string,
  telefoneNormalizado: string
): Promise<{ id: string } | null> {
  const { data, error } = await cliente
    .from('pacientes')
    .select('id')
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .maybeSingle();

  if (error) throw new Error(`falha ao buscar paciente: ${error.message}`);
  return (data as { id: string } | null) ?? null;
}

async function obterOuCriarEstadoConversa(
  cliente: ClienteBancoDados,
  clinicaId: string,
  telefoneNormalizado: string,
  pacienteId: string | null
): Promise<LinhaEstadoConversa> {
  const { data: existente, error: erroSelect } = await cliente
    .from('estado_conversa')
    .select('id, estado, dados, paciente_id')
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .maybeSingle();

  if (erroSelect) throw new Error(`falha ao buscar estado da conversa: ${erroSelect.message}`);

  if (existente) {
    const linha = existente as LinhaEstadoConversa;
    // O estado ja existe: nunca alteramos seu campo `estado` aqui. So
    // vinculamos o paciente se ele foi encontrado agora e o estado ainda
    // nao tinha paciente_id -- nunca sobrescrevemos um vinculo existente.
    if (pacienteId && linha.paciente_id === null) {
      return await vincularPacienteAoEstado(cliente, clinicaId, telefoneNormalizado, pacienteId, linha);
    }
    return linha;
  }

  // Insercao segura sob concorrencia: o conflito e resolvido pela unique
  // constraint (clinica_id, telefone_normalizado) em estado_conversa
  // (verificada em 20260729_iris_nova_identificacao_v1.sql). Se outra
  // chamada venceu a corrida entre o select acima e este upsert, o upsert
  // com ignoreDuplicates nao retorna linha e reconsultamos o estado ja
  // criado — nunca duas linhas para a mesma conversa. Um estado so nasce
  // como 'atendimento' quando e realmente criado aqui.
  const { data: inserida, error: erroInsert } = await cliente
    .from('estado_conversa')
    .upsert(
      {
        clinica_id: clinicaId,
        telefone_normalizado: telefoneNormalizado,
        paciente_id: pacienteId,
        estado: 'atendimento',
        dados: {},
      },
      { onConflict: 'clinica_id,telefone_normalizado', ignoreDuplicates: true }
    )
    .select('id, estado, dados, paciente_id')
    .maybeSingle();

  if (erroInsert) throw new Error(`falha ao criar estado da conversa: ${erroInsert.message}`);
  if (inserida) return inserida as LinhaEstadoConversa;

  const { data: concorrente, error: erroReconsulta } = await cliente
    .from('estado_conversa')
    .select('id, estado, dados, paciente_id')
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .maybeSingle();

  if (erroReconsulta) throw new Error(`falha ao reconsultar estado da conversa: ${erroReconsulta.message}`);
  if (!concorrente) throw new Error('estado_conversa nao encontrado apos insercao concorrente');
  return concorrente as LinhaEstadoConversa;
}

async function vincularPacienteAoEstado(
  cliente: ClienteBancoDados,
  clinicaId: string,
  telefoneNormalizado: string,
  pacienteId: string,
  estadoAtual: LinhaEstadoConversa
): Promise<LinhaEstadoConversa> {
  // A condicao paciente_id IS NULL faz parte do WHERE da propria atualizacao:
  // sob concorrencia, so a primeira chamada encontra a linha (paciente_id
  // ainda nulo) e a atualiza; a segunda nao encontra nenhuma linha (o
  // paciente_id ja deixou de ser nulo) e cai na reconsulta abaixo — nunca
  // sobrescrevendo o vinculo que a primeira acabou de criar.
  const { data: atualizada, error: erroUpdate } = await cliente
    .from('estado_conversa')
    .update({ paciente_id: pacienteId })
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .is('paciente_id', null)
    .select('id, estado, dados, paciente_id')
    .maybeSingle();

  if (erroUpdate) throw new Error(`falha ao vincular paciente ao estado da conversa: ${erroUpdate.message}`);
  if (atualizada) return atualizada as LinhaEstadoConversa;

  const { data: reconsultada, error: erroReconsulta } = await cliente
    .from('estado_conversa')
    .select('id, estado, dados, paciente_id')
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .maybeSingle();

  if (erroReconsulta) throw new Error(`falha ao reconsultar estado da conversa apos vinculo: ${erroReconsulta.message}`);
  return (reconsultada as LinhaEstadoConversa | null) ?? estadoAtual;
}
