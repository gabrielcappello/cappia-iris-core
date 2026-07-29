import { ClinicaNaoEncontradaError, EntradaInvalidaError } from './erros.ts';
import { telefoneNormalizadoValido } from './telefone.ts';
import type { ClienteBancoDados, IdentificarConversaInput, ResultadoIdentificacao } from './tipos.ts';

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
      estado: conversa.estado as 'atendimento',
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
): Promise<{ id: string; estado: string; dados: unknown }> {
  const { data: existente, error: erroSelect } = await cliente
    .from('estado_conversa')
    .select('id, estado, dados')
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .maybeSingle();

  if (erroSelect) throw new Error(`falha ao buscar estado da conversa: ${erroSelect.message}`);
  if (existente) return existente as { id: string; estado: string; dados: unknown };

  // Insercao segura sob concorrencia: o conflito e resolvido pela unique
  // constraint (clinica_id, telefone_normalizado) em estado_conversa
  // (verificada em 20260729_iris_nova_identificacao_v1.sql). Se outra
  // chamada venceu a corrida entre o select acima e este upsert, o upsert
  // com ignoreDuplicates nao retorna linha e reconsultamos o estado ja
  // criado — nunca duas linhas para a mesma conversa.
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
    .select('id, estado, dados')
    .maybeSingle();

  if (erroInsert) throw new Error(`falha ao criar estado da conversa: ${erroInsert.message}`);
  if (inserida) return inserida as { id: string; estado: string; dados: unknown };

  const { data: concorrente, error: erroReconsulta } = await cliente
    .from('estado_conversa')
    .select('id, estado, dados')
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .maybeSingle();

  if (erroReconsulta) throw new Error(`falha ao reconsultar estado da conversa: ${erroReconsulta.message}`);
  if (!concorrente) throw new Error('estado_conversa nao encontrado apos insercao concorrente');
  return concorrente as { id: string; estado: string; dados: unknown };
}
