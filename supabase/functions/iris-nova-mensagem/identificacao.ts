import { ClinicaNaoEncontradaError, EntradaInvalidaError } from './erros.ts';
import { telefoneNormalizadoValido } from './telefone.ts';
import { validarContextoHorarios } from './contexto-horarios.ts';
import { validarUltimaTroca } from './ultima-troca.ts';
import type {
  ClienteBancoDados,
  ContextoHorarios,
  EstadoConversa,
  IdentificarConversaInput,
  ResultadoIdentificacao,
  UltimaTroca,
} from './tipos.ts';

// Colunas lidas de estado_conversa por este modulo. `atualizado_em` e
// `contexto_horarios` sao aditivas (specs/contexto-pendente-interpretacao-v1.md):
// a primeira permite gravar o snapshot com CAS sobre o estado EXATO da decisao,
// sem reler; a segunda alimenta a interpretacao do turno seguinte.
// `ultima_troca` (specs/memoria-conversacional-minima-v1.md) e a mesma ideia
// para a camada de redacao: memoria de um unico turno, nunca enviada a IA
// interpretadora.
const COLUNAS_ESTADO_CONVERSA = 'id, estado, dados, paciente_id, atualizado_em, contexto_horarios, ultima_troca';

interface LinhaEstadoConversa {
  id: string;
  estado: string;
  dados: unknown;
  paciente_id: string | null;
  atualizado_em: string;
  contexto_horarios: ContextoHorarios | null;
  ultima_troca: UltimaTroca | null;
}

// Mesmo vocabulario canonico de EstadoConversa (tipos.ts) -- os seis estados
// aprovados em specs/novo-agendamento.md (secao 19).
const ESTADOS_VALIDOS: readonly EstadoConversa[] = [
  'atendimento',
  'aguardando_escolha',
  'coletando_cadastro',
  'aguardando_confirmacao',
  'executando',
  'concluido',
];

// Valida a linha crua retornada por estado_conversa antes de qualquer uso —
// nunca confia cegamente no formato devolvido pelo cliente de banco (real ou
// dublê de teste). Verifica somente os quatro campos realmente lidos por
// este modulo. Mensagens fixas: nunca inclui o payload recebido nem PII.
function validarLinhaEstadoConversa(valor: Record<string, unknown>): LinhaEstadoConversa {
  if (typeof valor.id !== 'string' || valor.id.trim() === '') {
    throw new Error('estado_conversa retornou id em formato invalido');
  }
  if (typeof valor.estado !== 'string' || !ESTADOS_VALIDOS.includes(valor.estado as EstadoConversa)) {
    throw new Error('estado_conversa retornou estado fora do vocabulario aprovado');
  }
  if (valor.dados === null || typeof valor.dados !== 'object' || Array.isArray(valor.dados)) {
    throw new Error('estado_conversa retornou dados em formato invalido');
  }
  if (valor.paciente_id !== null && typeof valor.paciente_id !== 'string') {
    throw new Error('estado_conversa retornou paciente_id em formato invalido');
  }
  if (typeof valor.atualizado_em !== 'string' || Number.isNaN(Date.parse(valor.atualizado_em))) {
    throw new Error('estado_conversa retornou atualizado_em em formato invalido');
  }
  return {
    id: valor.id,
    estado: valor.estado,
    dados: valor.dados,
    paciente_id: valor.paciente_id as string | null,
    atualizado_em: valor.atualizado_em,
    // Falha ABERTA de proposito: um snapshot malformado (ou de uma versao
    // futura do formato) nunca derruba a identificacao -- e so contexto
    // auxiliar de interpretacao, entao vira `null` e a conversa segue sem
    // ele. Nada operacional depende deste campo.
    contexto_horarios: validarContextoHorarios(valor.contexto_horarios),
    // Mesma falha ABERTA, mesmo motivo -- ver ultima-troca.ts.
    ultima_troca: validarUltimaTroca(valor.ultima_troca),
  };
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
      atualizado_em: conversa.atualizado_em,
      contexto_horarios: conversa.contexto_horarios,
      ultima_troca: conversa.ultima_troca,
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
    .select(COLUNAS_ESTADO_CONVERSA)
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .maybeSingle();

  if (erroSelect) throw new Error(`falha ao buscar estado da conversa: ${erroSelect.message}`);

  if (existente) {
    const linha = validarLinhaEstadoConversa(existente);
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
    .select(COLUNAS_ESTADO_CONVERSA)
    .maybeSingle();

  if (erroInsert) throw new Error(`falha ao criar estado da conversa: ${erroInsert.message}`);
  if (inserida) return validarLinhaEstadoConversa(inserida);

  const { data: concorrente, error: erroReconsulta } = await cliente
    .from('estado_conversa')
    .select(COLUNAS_ESTADO_CONVERSA)
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .maybeSingle();

  if (erroReconsulta) throw new Error(`falha ao reconsultar estado da conversa: ${erroReconsulta.message}`);
  if (!concorrente) throw new Error('estado_conversa nao encontrado apos insercao concorrente');
  return validarLinhaEstadoConversa(concorrente);
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
    .select(COLUNAS_ESTADO_CONVERSA)
    .maybeSingle();

  if (erroUpdate) throw new Error(`falha ao vincular paciente ao estado da conversa: ${erroUpdate.message}`);
  if (atualizada) return validarLinhaEstadoConversa(atualizada);

  const { data: reconsultada, error: erroReconsulta } = await cliente
    .from('estado_conversa')
    .select(COLUNAS_ESTADO_CONVERSA)
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .maybeSingle();

  if (erroReconsulta) throw new Error(`falha ao reconsultar estado da conversa apos vinculo: ${erroReconsulta.message}`);
  return reconsultada ? validarLinhaEstadoConversa(reconsultada) : estadoAtual;
}
