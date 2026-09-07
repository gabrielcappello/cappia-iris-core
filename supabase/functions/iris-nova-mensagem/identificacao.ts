import {
  ClinicaNaoEncontradaError,
  ConflitoConcorrenteError,
  ConversaNaoEncontradaError,
  EntradaInvalidaError,
} from './erros.ts';
import { telefoneNormalizadoValido } from './telefone.ts';
import { validarContextoHorarios } from './contexto-horarios.ts';
import { validarHistoricoConversa } from './historico-conversa.ts';
import { lerAguardandoResposta } from './aguardando-resposta.ts';
import type {
  CadastroPaciente,
  ClienteBancoDados,
  ContextoHorarios,
  EstadoConversa,
  HistoricoConversa,
  IdentificarConversaInput,
  PacienteDoContato,
  ResultadoIdentificacao,
  VinculoPaciente,
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
// `aguardando_resposta` (specs/contexto-conversacional-unificado-v2.md secao
// 14.6) e a pergunta que a Iris de fato fez no turno anterior. Vem NESTA
// MESMA consulta, sem SELECT novo -- e o que a spec exige. Ao contrario das
// duas anteriores, ela NAO degrada para `null` quando malformada: ver
// aguardando-resposta.ts.
const COLUNAS_ESTADO_CONVERSA =
  'id, estado, dados, paciente_id, atualizado_em, contexto_horarios, historico_conversa, aguardando_resposta';

interface LinhaEstadoConversa {
  id: string;
  estado: string;
  dados: unknown;
  paciente_id: string | null;
  atualizado_em: string;
  contexto_horarios: ContextoHorarios | null;
  historico_conversa: HistoricoConversa | null;
  // Bruto de proposito: a classificacao (ausente/presente/invalido) e feita
  // por `lerAguardandoResposta`, nao aqui -- malformado NUNCA vira `null`.
  aguardando_resposta: unknown;
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
    // Falha FECHADA, ao contrario das duas acima: passa BRUTO e a
    // classificacao fica com `lerAguardandoResposta`. Se fosse validado aqui
    // como os outros, malformado viraria `null` -- isto e, "nao ha pergunta
    // em aberto" --, que e uma afirmacao factual que o dado corrompido nao
    // autoriza (spec v2 secao 14.6).
    aguardando_resposta: valor.aguardando_resposta,
  };
}

/**
 * Etapa 1 do roadmap (docs/06-roadmap.md): identifica clinica e contato a
 * partir do transporte ja normalizado, lista os pacientes vinculados ao
 * contato, e garante a existencia de um unico estado de conversa oficial.
 * Nao registra mensagem, nao cria paciente, nao decide nada alem de
 * identificacao.
 *
 * MUDANCA (specs/contato-multiplos-pacientes-v1.md secao 5.1): a resolucao
 * e em duas etapas -- primeiro o `contato_whatsapp` por `(clinica_id,
 * telefone_normalizado)`, depois a LISTA de pacientes vinculados a esse
 * `contato_id` (0, 1 ou N). O paciente RESOLVIDO do turno sai, nesta ordem:
 *
 *   (a) a selecao ja gravada em `estado_conversa.paciente_id`, quando ela
 *       ainda aponta para um vinculo valido DESTE contato;
 *   (b) SELECAO CROSS-CONTATO (spec secao 4.5, passo 5): quando `dados`
 *       carrega `telefone_novo_paciente` (fluxo "numero proprio" em
 *       andamento), a selecao pode apontar para um paciente do contato DE
 *       DESTINO (o telefone informado para a outra pessoa), que tem telefone
 *       diferente do desta conversa -- e legitimo, e resolvido relendo
 *       `telefone_novo_paciente` a cada turno, sem coluna nova;
 *   (c) o unico paciente do contato desta conversa, quando ha exatamente um.
 *
 * Fora disso, `paciente.id` fica `null` e o orquestrador pergunta.
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

  const contatoId = await obterOuCriarContato(cliente, clinica.id, entrada.telefone_normalizado);
  const pacientesDoContato = await listarPacientesDoContato(cliente, clinica.id, contatoId);

  // O estado de conversa e chaveado por (clinica_id, telefone_normalizado),
  // que representa a conversa com o CONTATO -- chave inalterada (spec secao
  // 2.1). Nao propagamos nenhum paciente_id na criacao: a selecao agora e
  // decidida DEPOIS, contra a lista fresca do contato (podendo mudar entre
  // assuntos, spec secao 4.4). Um estado recem-criado nasce sem selecao.
  const conversa = await obterOuCriarEstadoConversa(
    cliente,
    clinica.id,
    entrada.telefone_normalizado
  );

  let resolvido = resolverPacienteSelecionado(pacientesDoContato, conversa.paciente_id);

  // (b) SELECAO CROSS-CONTATO: a selecao aponta para alguem que NAO esta na
  // lista deste contato, MAS `dados` carrega um `telefone_novo_paciente` em
  // andamento (spec secao 4.5, passo 5). Relemos esse telefone, resolvemos o
  // contato de destino e aceitamos a selecao se ela pertencer a ele. Nunca
  // aceita uma selecao arbitraria: ela precisa estar vinculada ao contato
  // que aquele telefone resolve.
  if (resolvido === null && conversa.paciente_id !== null) {
    const telefoneDestino = lerTelefoneNovoPaciente(conversa.dados);
    if (telefoneDestino !== null && telefoneDestino !== entrada.telefone_normalizado) {
      const contatoDestinoId = await buscarContato(cliente, clinica.id, telefoneDestino);
      if (contatoDestinoId !== null) {
        const pacientesDestino = await listarPacientesDoContato(cliente, clinica.id, contatoDestinoId);
        resolvido = pacientesDestino.find((p) => p.id === conversa.paciente_id) ?? null;
      }
    }
  }

  return {
    clinica_id: clinica.id,
    contato_id: contatoId,
    pacientes: pacientesDoContato.map((p) => ({
      paciente_id: p.id,
      nome: p.nome,
      vinculo: p.vinculo,
    })),
    paciente: {
      encontrado: resolvido !== null,
      id: resolvido?.id ?? null,
      cadastro: resolvido?.cadastro ?? {},
    },
    conversa: {
      id: conversa.id,
      estado: conversa.estado as EstadoConversa,
      dados: (conversa.dados as Record<string, unknown>) ?? {},
      atualizado_em: conversa.atualizado_em,
      contexto_horarios: conversa.contexto_horarios,
      historico_conversa: conversa.historico_conversa,
      // Classificada aqui, uma vez, para o chamador nao precisar repetir a
      // distincao. `invalido` e desfecho de primeira classe: quem consome
      // desvia o turno em vez de tratar como "sem pergunta".
      aguardando_resposta: lerAguardandoResposta(conversa.aguardando_resposta),
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
// o unico ponto de leitura onde a traducao acontece. `vinculo` entrou em
// 2026-09-07 (specs/contato-multiplos-pacientes-v1.md).
const COLUNAS_PACIENTE = 'id, nome, documento, data_nascimento, email, vinculo';

const VINCULOS_VALIDOS: readonly VinculoPaciente[] = ['titular', 'dependente'];

interface LinhaPaciente {
  id: string;
  nome: string;
  vinculo: VinculoPaciente;
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

/**
 * `estado_conversa.dados.telefone_novo_paciente`, quando presente e nao
 * vazio (spec secao 4.5, contrato fisico). `null` caso contrario. Nunca
 * normaliza nem valida formato aqui -- so devolve o que esta gravado.
 */
function lerTelefoneNovoPaciente(dados: unknown): string | null {
  if (dados === null || typeof dados !== 'object') return null;
  const valor = (dados as Record<string, unknown>).telefone_novo_paciente;
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

/**
 * Busca o `contato_whatsapp` por `(clinica_id, telefone_normalizado)` SEM
 * criar -- usado para o contato de DESTINO do fluxo "numero proprio" (spec
 * secao 4.5, passo 4/5): o contato so passa a existir se um paciente for de
 * fato cadastrado com ele. `null` quando ainda nao existe.
 */
async function buscarContato(
  cliente: ClienteBancoDados,
  clinicaId: string,
  telefoneNormalizado: string
): Promise<string | null> {
  const { data, error } = await cliente
    .from('contatos_whatsapp')
    .select('id')
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .maybeSingle();

  if (error) throw new Error(`falha ao buscar contato de destino: ${error.message}`);
  const id = (data as Record<string, unknown> | null)?.id;
  return typeof id === 'string' && id.trim() !== '' ? id : null;
}

/**
 * Resolve (ou cria) o `contato_whatsapp` desta conversa por `(clinica_id,
 * telefone_normalizado)` -- a mesma chave que antes identificava o paciente,
 * agora movida para onde semanticamente pertence (spec secao 2.1). Mesma
 * disciplina de concorrencia de `obterOuCriarEstadoConversa`: upsert com
 * `ignoreDuplicates` e reconsulta quando outra chamada venceu a corrida.
 */
async function obterOuCriarContato(
  cliente: ClienteBancoDados,
  clinicaId: string,
  telefoneNormalizado: string
): Promise<string> {
  const { data: existente, error: erroSelect } = await cliente
    .from('contatos_whatsapp')
    .select('id')
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .maybeSingle();

  if (erroSelect) throw new Error(`falha ao buscar contato: ${erroSelect.message}`);
  if (existente) {
    const id = (existente as Record<string, unknown>).id;
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('contatos_whatsapp retornou id em formato invalido');
    }
    return id;
  }

  const { data: inserida, error: erroInsert } = await cliente
    .from('contatos_whatsapp')
    .upsert(
      { clinica_id: clinicaId, telefone_normalizado: telefoneNormalizado },
      { onConflict: 'clinica_id,telefone_normalizado', ignoreDuplicates: true }
    )
    .select('id')
    .maybeSingle();

  if (erroInsert) throw new Error(`falha ao criar contato: ${erroInsert.message}`);
  if (inserida) {
    const id = (inserida as Record<string, unknown>).id;
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('contatos_whatsapp retornou id em formato invalido');
    }
    return id;
  }

  const { data: concorrente, error: erroReconsulta } = await cliente
    .from('contatos_whatsapp')
    .select('id')
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .maybeSingle();

  if (erroReconsulta) throw new Error(`falha ao reconsultar contato: ${erroReconsulta.message}`);
  const id = (concorrente as Record<string, unknown> | null)?.id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('contatos_whatsapp nao encontrado apos insercao concorrente');
  }
  return id;
}

/**
 * Lista os pacientes vinculados a um contato (spec secao 5.1). `.maybeSingle()`
 * de antes some: a query devolve 0, 1 ou N linhas. Escopada por `clinica_id`
 * TAMBEM (nao so `contato_id`): a FK composta ja garante que um contato
 * pertence a uma clinica, mas a igualdade dupla mantem o mesmo padrao de
 * isolamento de toda leitura do Core.
 */
async function listarPacientesDoContato(
  cliente: ClienteBancoDados,
  clinicaId: string,
  contatoId: string
): Promise<LinhaPaciente[]> {
  const { data, error } = await cliente
    .from('pacientes')
    .select(COLUNAS_PACIENTE)
    .eq('clinica_id', clinicaId)
    .eq('contato_id', contatoId);

  if (error) throw new Error(`falha ao listar pacientes do contato: ${error.message}`);
  const linhas = (data ?? []) as Record<string, unknown>[];

  return linhas.map((bruto) => {
    if (typeof bruto.id !== 'string' || bruto.id.trim() === '') {
      throw new Error('pacientes retornou id em formato invalido');
    }
    const nome = campoCadastral(bruto.nome);
    // `vinculo` e NOT NULL no schema com default 'titular' -- um valor fora
    // do vocabulario e schema inesperado, falha fechado.
    const vinculo = typeof bruto.vinculo === 'string' && VINCULOS_VALIDOS.includes(bruto.vinculo as VinculoPaciente)
      ? (bruto.vinculo as VinculoPaciente)
      : (() => {
          throw new Error('pacientes retornou vinculo fora do vocabulario aprovado');
        })();

    // Montagem campo a campo a partir de chaves FECHADAS -- nunca por spread
    // da linha crua. Mesmo que o SELECT mudasse, nenhuma coluna inesperada
    // (nem uma PII nova) entraria no cadastro de dominio por acidente.
    const cadastro: CadastroPaciente = {};
    if (nome !== undefined) cadastro.nome = nome;
    const cpf = campoCadastral(bruto.documento);
    if (cpf !== undefined) cadastro.cpf = cpf;
    const dataNascimento = campoCadastral(bruto.data_nascimento);
    if (dataNascimento !== undefined) cadastro.data_nascimento = dataNascimento;
    const email = campoCadastral(bruto.email);
    if (email !== undefined) cadastro.email = email;

    return { id: bruto.id, nome: nome ?? '', vinculo, cadastro };
  });
}

/** Um paciente de um contato, para consumo externo (orquestrador). */
export interface PacienteVinculado {
  paciente_id: string;
  nome: string;
  vinculo: VinculoPaciente;
  cadastro: CadastroPaciente;
}

/**
 * Resolve o contato de um telefone (SEM criar) e lista seus pacientes -- para
 * o orquestrador tratar o contato de DESTINO do fluxo "numero proprio" (spec
 * secao 4.5, passo 4): a cada turno o Core rele `telefone_novo_paciente`,
 * resolve de novo o contato de destino e monta `pacientes_do_contato` contra
 * ele. Nunca cria o contato aqui -- ele so passa a existir quando um paciente
 * e de fato cadastrado (via `resolverOuCriarContatoParaCadastro`).
 *
 * `contato_id === null` quando o telefone ainda nao tem contato.
 */
export async function resolverContatoDeDestino(
  cliente: ClienteBancoDados,
  clinicaId: string,
  telefoneNormalizado: string
): Promise<{ contato_id: string | null; pacientes: readonly PacienteVinculado[] }> {
  const contatoId = await buscarContato(cliente, clinicaId, telefoneNormalizado);
  if (contatoId === null) return { contato_id: null, pacientes: [] };
  const linhas = await listarPacientesDoContato(cliente, clinicaId, contatoId);
  return {
    contato_id: contatoId,
    pacientes: linhas.map((p) => ({ paciente_id: p.id, nome: p.nome, vinculo: p.vinculo, cadastro: p.cadastro })),
  };
}

/**
 * Resolve OU cria o `contato_whatsapp` de um telefone -- usado no momento em
 * que um paciente novo sera cadastrado com esse contato como o DEFINITIVO
 * (spec secao 4.5, passo 4, segundo ramo). Reusa exatamente
 * `obterOuCriarContato` (mesma disciplina de concorrencia).
 */
export async function resolverOuCriarContatoParaCadastro(
  cliente: ClienteBancoDados,
  clinicaId: string,
  telefoneNormalizado: string
): Promise<string> {
  return obterOuCriarContato(cliente, clinicaId, telefoneNormalizado);
}

/**
 * Decide o paciente RESOLVIDO do turno a partir da lista fresca do contato e
 * da selecao ja gravada (spec secao 4.4/5.1):
 *
 *   1. `pacienteSelecionadoId` presente E ainda aponta para um vinculo desta
 *      lista -> esse. (A revalidacao contra a lista fresca e o que impede
 *      uma selecao obsoleta -- ou de outro contato -- de sobreviver.)
 *   2. exatamente 1 paciente no contato -> esse (comportamento de hoje, 1
 *      telefone = 1 paciente, preservado para todos os dados ja existentes).
 *   3. caso contrario (0, ou >1 sem selecao valida) -> `null`: o orquestrador
 *      pergunta.
 */
function resolverPacienteSelecionado(
  pacientes: readonly LinhaPaciente[],
  pacienteSelecionadoId: string | null
): LinhaPaciente | null {
  if (pacienteSelecionadoId !== null) {
    const selecionado = pacientes.find((p) => p.id === pacienteSelecionadoId);
    if (selecionado !== undefined) return selecionado;
  }
  if (pacientes.length === 1) return pacientes[0];
  return null;
}

async function obterOuCriarEstadoConversa(
  cliente: ClienteBancoDados,
  clinicaId: string,
  telefoneNormalizado: string
): Promise<LinhaEstadoConversa> {
  const { data: existente, error: erroSelect } = await cliente
    .from('estado_conversa')
    .select(COLUNAS_ESTADO_CONVERSA)
    .eq('clinica_id', clinicaId)
    .eq('telefone_normalizado', telefoneNormalizado)
    .maybeSingle();

  if (erroSelect) throw new Error(`falha ao buscar estado da conversa: ${erroSelect.message}`);

  if (existente) {
    // O estado ja existe: nunca alteramos seu campo `estado` nem a selecao
    // de paciente aqui. A selecao (`paciente_id`) passou a ser MUTAVEL e a
    // ser escrita pelo orquestrador, contra a lista fresca do contato --
    // spec secao 4.4. A protecao write-once (`.is('paciente_id', null)`)
    // que existia aqui foi removida por esse motivo.
    return validarLinhaEstadoConversa(existente);
  }

  // Insercao segura sob concorrencia: o conflito e resolvido pela unique
  // constraint (clinica_id, telefone_normalizado) em estado_conversa
  // (verificada em 20260729_iris_nova_identificacao_v1.sql). Se outra
  // chamada venceu a corrida entre o select acima e este upsert, o upsert
  // com ignoreDuplicates nao retorna linha e reconsultamos o estado ja
  // criado — nunca duas linhas para a mesma conversa. Um estado so nasce
  // como 'atendimento' quando e realmente criado aqui, sem selecao de
  // paciente (spec secao 4.4).
  const { data: inserida, error: erroInsert } = await cliente
    .from('estado_conversa')
    .upsert(
      {
        clinica_id: clinicaId,
        telefone_normalizado: telefoneNormalizado,
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

const MAX_TENTATIVAS_SELECAO = 5;

/**
 * Escreve (ou limpa) a SELECAO de paciente em `estado_conversa.paciente_id`
 * (specs/contato-multiplos-pacientes-v1.md secao 4.4). A coluna existente e
 * reutilizada como "o paciente selecionado para esta conversa" -- MUTAVEL
 * entre assuntos, `null` ao concluir/desistir de um fluxo.
 *
 * `pacienteId = null` limpa a selecao. Qualquer outro valor grava a nova
 * selecao. Nao ha protecao write-once (a spec exige que a selecao possa
 * mudar), mas ha a MESMA disciplina de CAS/concorrencia de `aplicarDados`:
 * le `atualizado_em`, condiciona o UPDATE a ele, e relê+reaplica quando
 * outra escrita venceu a corrida, ate `MAX_TENTATIVAS_SELECAO`.
 *
 * FALHA FECHADA quando o UPDATE afeta ZERO linhas por motivo que NAO e
 * corrida (a conversa nao existe): `ConversaNaoEncontradaError`. Nunca segue
 * em silencio -- gravar a selecao de paciente e operacional, nao best-effort.
 *
 * O isolamento por clinica na FK composta `(paciente_id, clinica_id)
 * references pacientes(id, clinica_id)` e a segunda camada de defesa -- a
 * primeira e `validarEscolhaPaciente` (interpretar-e-aplicar.ts), que so
 * oferece IDs da lista fresca do contato.
 */
export async function gravarSelecaoPaciente(
  cliente: ClienteBancoDados,
  clinicaId: string,
  telefoneNormalizado: string,
  pacienteId: string | null
): Promise<void> {
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_SELECAO; tentativa++) {
    const { data: atual, error: erroLeitura } = await cliente
      .from('estado_conversa')
      .select('id, paciente_id, atualizado_em')
      .eq('clinica_id', clinicaId)
      .eq('telefone_normalizado', telefoneNormalizado)
      .maybeSingle();

    if (erroLeitura) throw new Error(`falha ao ler estado antes de gravar selecao: ${erroLeitura.message}`);
    if (!atual) throw new ConversaNaoEncontradaError();

    const bruto = atual as Record<string, unknown>;
    const timestampLido = bruto.atualizado_em;
    if (typeof timestampLido !== 'string' || Number.isNaN(Date.parse(timestampLido))) {
      throw new Error('estado_conversa retornou atualizado_em em formato invalido');
    }

    // Nada a fazer: a selecao ja e a desejada. Nenhum UPDATE, nenhum bump de
    // `atualizado_em` -- mesma idempotencia que `aplicarDados` aplica a
    // `dados` iguais.
    if ((bruto.paciente_id ?? null) === pacienteId) return;

    const novoTimestamp = proximoTimestampSelecao(timestampLido);
    const { data: atualizado, error: erroUpdate } = await cliente
      .from('estado_conversa')
      .update({ paciente_id: pacienteId, atualizado_em: novoTimestamp })
      .eq('clinica_id', clinicaId)
      .eq('telefone_normalizado', telefoneNormalizado)
      .eq('atualizado_em', timestampLido)
      .select('id')
      .maybeSingle();

    if (erroUpdate) throw new Error(`falha ao gravar selecao de paciente: ${erroUpdate.message}`);
    if (atualizado) return;

    // 0 linhas: `atualizado_em` mudou entre a leitura e o UPDATE -- outra
    // escrita venceu. Relê e tenta de novo. (A linha EXISTE: o `!atual`
    // acima ja teria lancado se nao existisse.)
  }
  throw new ConflitoConcorrenteError(MAX_TENTATIVAS_SELECAO);
}

function proximoTimestampSelecao(anteriorIso: string): string {
  const anteriorMs = new Date(anteriorIso).getTime();
  const agoraMs = Date.now();
  return new Date(agoraMs > anteriorMs ? agoraMs : anteriorMs + 1).toISOString();
}
