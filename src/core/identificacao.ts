import { ClinicaNaoEncontradaError, EntradaInvalidaError } from './erros.ts';
import { telefoneNormalizadoValido } from './telefone.ts';
import { validarContextoHorarios } from './contexto-horarios.ts';
import { validarHistoricoConversa } from './historico-conversa.ts';
import type {
  CadastroPaciente,
  ClienteBancoDados,
  ContextoHorarios,
  EstadoConversa,
  HistoricoConversa,
  IdentificarConversaInput,
  ResultadoIdentificacao,
} from './tipos.ts';

// Colunas lidas de estado_conversa por este modulo. `atualizado_em` e
// `contexto_horarios` sao aditivas (specs/contexto-pendente-interpretacao-v1.md):
// a primeira permite gravar o snapshot com CAS sobre o estado EXATO da decisao,
// sem reler; a segunda alimenta a interpretacao do turno seguinte.
// `historico_conversa` (specs/historico-conversacional-v1.md) e os ultimos 10
// pares da conversa, enviados tanto a IA interpretadora quanto a redatora.
// `ultima_troca` (coluna legada, specs/memoria-conversacional-minima-v1.md)
// deixa de ser lida por este modulo -- permanece no banco ate a migration de
// remocao (spec secao 0.2), mas nenhum codigo novo a consulta.
const COLUNAS_ESTADO_CONVERSA = 'id, estado, dados, paciente_id, atualizado_em, contexto_horarios, historico_conversa';

interface LinhaEstadoConversa {
  id: string;
  estado: string;
  dados: unknown;
  paciente_id: string | null;
  atualizado_em: string;
  contexto_horarios: ContextoHorarios | null;
  historico_conversa: HistoricoConversa | null;
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
    // Mesma falha ABERTA, mesmo motivo -- ver historico-conversa.ts.
    historico_conversa: validarHistoricoConversa(valor.historico_conversa),
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
      cadastro: paciente?.cadastro ?? {},
    },
    conversa: {
      id: conversa.id,
      estado: conversa.estado as EstadoConversa,
      dados: (conversa.dados as Record<string, unknown>) ?? {},
      atualizado_em: conversa.atualizado_em,
      contexto_horarios: conversa.contexto_horarios,
      historico_conversa: conversa.historico_conversa,
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

// Colunas lidas de `pacientes`. As quatro cadastrais entraram em 2026-08-09
// (subetapa "integracao do Core com paciente"): sem elas, um paciente ja
// cadastrado comecava toda conversa como se a clinica nao soubesse nada
// dele, e a Iris pedia de novo dado que ja estava na ficha.
//
// `documento` e a coluna fisica; no dominio ela se chama `cpf`. Este SELECT e
// o unico ponto de leitura onde a traducao acontece.
const COLUNAS_PACIENTE = 'id, nome, documento, data_nascimento, email';

interface LinhaPaciente {
  id: string;
  cadastro: CadastroPaciente;
}

/**
 * Converte uma coluna cadastral crua em valor de dominio.
 *
 * Devolve `undefined` (que vira chave ausente) para NULL, para tipo
 * inesperado e para string so de espacos -- "preenchido" e sempre presenca de
 * conteudo real, nunca presenca de coluna. Mesma regra ja usada por
 * `derivarCamposCadastraisPreenchidos`.
 */
function campoCadastral(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const limpo = valor.trim();
  return limpo === '' ? undefined : limpo;
}

async function buscarPaciente(
  cliente: ClienteBancoDados,
  clinicaId: string,
  telefoneNormalizado: string
): Promise<LinhaPaciente | null> {
  const { data, error } = await cliente
    .from('pacientes')
    .select(COLUNAS_PACIENTE)
    // Isolamento por clinica: as duas igualdades precisam casar na MESMA
    // linha. Um paciente com o mesmo telefone em outra clinica nunca e
    // carregado aqui.
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .maybeSingle();

  if (error) throw new Error(`falha ao buscar paciente: ${error.message}`);
  if (!data) return null;

  const bruto = data as Record<string, unknown>;
  if (typeof bruto.id !== 'string' || bruto.id.trim() === '') {
    throw new Error('pacientes retornou id em formato invalido');
  }

  // Montagem campo a campo a partir de chaves FECHADAS -- nunca por spread da
  // linha crua. Mesmo que o SELECT mudasse, nenhuma coluna inesperada (nem
  // uma PII nova) entraria no cadastro de dominio por acidente.
  const cadastro: CadastroPaciente = {};
  const nome = campoCadastral(bruto.nome);
  if (nome !== undefined) cadastro.nome = nome;
  const cpf = campoCadastral(bruto.documento);
  if (cpf !== undefined) cadastro.cpf = cpf;
  const dataNascimento = campoCadastral(bruto.data_nascimento);
  if (dataNascimento !== undefined) cadastro.data_nascimento = dataNascimento;
  const email = campoCadastral(bruto.email);
  if (email !== undefined) cadastro.email = email;

  return { id: bruto.id, cadastro };
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
