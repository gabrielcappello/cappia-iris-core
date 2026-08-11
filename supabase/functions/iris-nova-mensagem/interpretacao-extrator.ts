import {
  ACOES_PERMITIDAS,
  CAMPOS_EMITIVEIS_PELA_IA,
  CAMPOS_PERMITIDOS,
  CONFIRMACOES_PERMITIDAS,
  INTENCOES_PERMITIDAS,
  PERIODOS_PERMITIDOS,
} from './aplicar-dados.ts';
import { comporVisaoEfetivaCadastro } from './cadastro-paciente.ts';
import { EntradaInvalidaError, InterpretacaoInvalidaError } from './erros.ts';
import { INSTRUCOES_EXTRATOR, SCHEMA_SAIDA_INTERPRETACAO } from './interpretacao-instrucoes.ts';
import {
  CAMPOS_CADASTRAIS_INTERPRETACAO,
  CAMPOS_OPERACIONAIS_INTERPRETACAO,
  NATUREZAS_MENSAGEM_PERMITIDAS,
  TIPOS_EVENTO_CANDIDATO_PERMITIDOS,
} from './interpretacao-tipos.ts';
import type { AcaoAlteracaoDados, CadastroPaciente, CampoDadosConversa, ParConversa } from './tipos.ts';
import type {
  CampoCadastralInterpretacao,
  CampoOperacionalInterpretacao,
  ClienteModeloEstruturado,
  EntradaInterpretacao,
  EventoCandidatoIA,
  NaturezaMensagem,
  SaidaInterpretacao,
  SnapshotOficialConversa,
} from './interpretacao-tipos.ts';

/**
 * Extrator estruturado: constroi a solicitacao aprovada (instrucoes +
 * schema fechado + payload), chama o cliente de modelo injetado, e valida
 * INTEGRALMENTE a resposta antes de devolve-la. Nenhuma aceitacao parcial:
 * qualquer violacao do contrato invalida a saida inteira.
 */
export async function extrairAlteracoes(
  cliente: ClienteModeloEstruturado,
  entradaBruta: unknown
): Promise<SaidaInterpretacao> {
  validarEntradaInterpretacao(entradaBruta);

  // Payload construido campo a campo a partir de listas FECHADAS --
  // nunca por spread nem por passagem direta do objeto recebido. Mesmo
  // que algo escapasse da validacao acima, um campo cadastral nao teria
  // por onde entrar em `dados_atuais`.
  const payload: EntradaInterpretacao = {
    mensagens_atuais: [...entradaBruta.mensagens_atuais],
    dados_atuais: selecionarCamposOperacionais(entradaBruta.dados_atuais),
    campos_cadastrais_preenchidos: [...entradaBruta.campos_cadastrais_preenchidos],
    // Chave OMITIDA (nunca `undefined` explicito) quando nao ha snapshot --
    // mesma disciplina ja usada nos resultados opcionais do Core, garante
    // round-trip exato por JSON e um corpo de requisicao sem chave morta.
    ...(entradaBruta.horarios_oferecidos !== undefined
      ? { horarios_oferecidos: [...entradaBruta.horarios_oferecidos] }
      : {}),
    ...(entradaBruta.proposta_pendente !== undefined ? { proposta_pendente: entradaBruta.proposta_pendente } : {}),
    ...(entradaBruta.procedimentos_disponiveis !== undefined
      ? { procedimentos_disponiveis: [...entradaBruta.procedimentos_disponiveis] }
      : {}),
    ...(entradaBruta.dentistas_disponiveis !== undefined
      ? { dentistas_disponiveis: [...entradaBruta.dentistas_disponiveis] }
      : {}),
    ...(entradaBruta.oferta_procedimento_pendente !== undefined
      ? { oferta_procedimento_pendente: entradaBruta.oferta_procedimento_pendente }
      : {}),
    ...(entradaBruta.troca_telefone_pendente !== undefined
      ? { troca_telefone_pendente: entradaBruta.troca_telefone_pendente }
      : {}),
    ...(entradaBruta.agendamentos_ativos !== undefined
      ? { agendamentos_ativos: [...entradaBruta.agendamentos_ativos] }
      : {}),
    ...(entradaBruta.historico_recente !== undefined ? { historico_recente: [...entradaBruta.historico_recente] } : {}),
  };

  const saidaBruta = await cliente.executar({
    instrucoes: INSTRUCOES_EXTRATOR,
    schema: SCHEMA_SAIDA_INTERPRETACAO,
    payload,
  });

  validarSaidaInterpretacao(saidaBruta);
  return saidaBruta;
}

// --- Construcao minimizada do payload (specs/interpretacao-ia.md,
// "Entrada e PII") ---

/**
 * Deriva a entrada do modelo a partir do snapshot oficial, minimizando
 * PII: os campos operacionais seguem por valor; os campos cadastrais
 * viram apenas a indicacao de PRESENCA. Nenhum valor cadastral -- bruto,
 * formatado, normalizado, truncado ou mascarado -- atravessa esta funcao.
 *
 * `cadastroPaciente` (2026-08-09) e a SEGUNDA ORIGEM de dado cadastral: a
 * ficha ja persistida em `pacientes`. Ela entra APENAS na derivacao de
 * presenca -- `dados_atuais` continua saindo exclusivamente do snapshot da
 * conversa, e continua sem nenhum campo cadastral. Sem ela, um paciente ja
 * cadastrado comecava a conversa com `campos_cadastrais_preenchidos: []` e a
 * Iris pedia de novo dado que ja estava na ficha.
 *
 * A precedencia (conversa vence ficha) fica em comporVisaoEfetivaCadastro --
 * aqui so se consome o resultado.
 */
export function construirEntradaMinimizada(
  mensagensAtuais: string[],
  snapshotOficial: SnapshotOficialConversa,
  horariosOferecidos?: string[],
  propostaPendente?: { data: string; horario: string },
  historicoRecente?: ParConversa[],
  procedimentosDisponiveis?: { procedimento_id: string; nome_pt: string }[],
  dentistasDisponiveis?: { dentista_id: string; nome_exibido: string }[],
  ofertaProcedimentoPendente?: true,
  cadastroPaciente?: CadastroPaciente,
  trocaTelefonePendente?: true,
  agendamentosAtivos?: { agendamento_id: string; descricao: string }[]
): EntradaInterpretacao {
  return {
    mensagens_atuais: [...mensagensAtuais],
    dados_atuais: selecionarCamposOperacionais(snapshotOficial),
    campos_cadastrais_preenchidos: derivarCamposCadastraisPreenchidos(
      comporVisaoEfetivaCadastro(cadastroPaciente, snapshotOficial)
    ),
    ...(horariosOferecidos !== undefined ? { horarios_oferecidos: [...horariosOferecidos] } : {}),
    ...(propostaPendente !== undefined ? { proposta_pendente: propostaPendente } : {}),
    ...(procedimentosDisponiveis !== undefined ? { procedimentos_disponiveis: [...procedimentosDisponiveis] } : {}),
    ...(dentistasDisponiveis !== undefined ? { dentistas_disponiveis: [...dentistasDisponiveis] } : {}),
    ...(ofertaProcedimentoPendente !== undefined
      ? { oferta_procedimento_pendente: ofertaProcedimentoPendente }
      : {}),
    ...(trocaTelefonePendente !== undefined ? { troca_telefone_pendente: trocaTelefonePendente } : {}),
    ...(agendamentosAtivos !== undefined ? { agendamentos_ativos: [...agendamentosAtivos] } : {}),
    ...(historicoRecente !== undefined ? { historico_recente: [...historicoRecente] } : {}),
  };
}

function selecionarCamposOperacionais(
  origem: Partial<Record<string, string>>
): Partial<Record<CampoOperacionalInterpretacao, string>> {
  const selecionados: Partial<Record<CampoOperacionalInterpretacao, string>> = {};
  for (const campo of CAMPOS_OPERACIONAIS_INTERPRETACAO) {
    const valor = origem[campo];
    if (typeof valor === 'string' && valor.trim() !== '') {
      selecionados[campo] = valor;
    }
  }
  return selecionados;
}

/**
 * Presenca, nunca valor. Um campo so conta como preenchido quando possui
 * string nao vazia apos trim -- string vazia ou so espacos e tratada como
 * ausente. A ordem segue a lista canonica, para ser deterministica.
 */
export function derivarCamposCadastraisPreenchidos(
  origem: Partial<Record<CampoCadastralInterpretacao, string>>
): CampoCadastralInterpretacao[] {
  return CAMPOS_CADASTRAIS_INTERPRETACAO.filter((campo) => {
    const valor = origem[campo];
    return typeof valor === 'string' && valor.trim() !== '';
  });
}

// --- Validacao da entrada (payload do modelo) ---

const CHAVES_ENTRADA_INTERPRETACAO = [
  'mensagens_atuais',
  'dados_atuais',
  'campos_cadastrais_preenchidos',
] as const;

// Chaves opcionais: podem estar ausentes, mas quando presentes precisam ser
// validadas. A entrada continua FECHADA -- qualquer chave fora da uniao
// (obrigatorias + opcionais) rejeita a entrada inteira, como sempre.
export const CHAVES_OPCIONAIS_INTERPRETACAO = [
  'horarios_oferecidos',
  'proposta_pendente',
  'procedimentos_disponiveis',
  'dentistas_disponiveis',
  'oferta_procedimento_pendente',
  'troca_telefone_pendente',
  'agendamentos_ativos',
  'historico_recente',
] as const;

export function validarEntradaInterpretacao(entrada: unknown): asserts entrada is EntradaInterpretacao {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new EntradaInvalidaError('entrada', 'entrada deve ser um objeto');
  }

  // Entrada fechada: somente as tres chaves do contrato sao aceitas.
  // Qualquer propriedade adicional (telefone, IDs, historico, etc.)
  // invalida a entrada inteira. O nome da propriedade desconhecida nunca e
  // reproduzido no erro.
  const chaves = Object.keys(entrada as Record<string, unknown>);
  const obrigatorias: readonly string[] = CHAVES_ENTRADA_INTERPRETACAO;
  const permitidas: readonly string[] = [...CHAVES_ENTRADA_INTERPRETACAO, ...CHAVES_OPCIONAIS_INTERPRETACAO];
  if (!obrigatorias.every((chave) => chaves.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada nao contem todas as chaves obrigatorias');
  }
  if (!chaves.every((chave) => permitidas.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada contem propriedade nao permitida');
  }

  const {
    mensagens_atuais,
    dados_atuais,
    campos_cadastrais_preenchidos,
    horarios_oferecidos,
    proposta_pendente,
    procedimentos_disponiveis,
    dentistas_disponiveis,
    oferta_procedimento_pendente,
    troca_telefone_pendente,
    agendamentos_ativos,
    historico_recente,
  } = entrada as Record<string, unknown>;
  validarMensagensAtuais(mensagens_atuais);
  validarDadosAtuais(dados_atuais);
  validarCamposCadastraisPreenchidos(campos_cadastrais_preenchidos);
  if (horarios_oferecidos !== undefined) validarHorariosOferecidos(horarios_oferecidos);
  if (proposta_pendente !== undefined) validarPropostaPendente(proposta_pendente);
  if (procedimentos_disponiveis !== undefined) validarProcedimentosDisponiveis(procedimentos_disponiveis);
  if (dentistas_disponiveis !== undefined) validarDentistasDisponiveis(dentistas_disponiveis);
  if (oferta_procedimento_pendente !== undefined) validarOfertaProcedimentoPendente(oferta_procedimento_pendente);
  if (troca_telefone_pendente !== undefined) validarTrocaTelefonePendente(troca_telefone_pendente);
  if (agendamentos_ativos !== undefined) validarAgendamentosAtivos(agendamentos_ativos);
  if (historico_recente !== undefined) validarHistoricoRecente(historico_recente);
}

/**
 * Pergunta de troca de telefone aguardando sim/nao (contexto-horarios.ts,
 * acao `perguntar_troca_telefone`). Fechada a `true`, exatamente como
 * `oferta_procedimento_pendente`: "nao ha pergunta em aberto" se representa
 * pela AUSENCIA da chave, nunca por `false`.
 *
 * Nenhum dado da outra ficha trafega -- nem CPF, nem paciente_id, nem
 * telefone anterior (specs/cpf-outro-telefone-v1.md secao 4). A IA so
 * precisa saber que ha um sim/nao em aberto.
 */
export function validarTrocaTelefonePendente(valor: unknown): asserts valor is true {
  if (valor !== true) {
    throw new EntradaInvalidaError(
      'troca_telefone_pendente',
      'troca_telefone_pendente deve ser exatamente true quando presente'
    );
  }
}

/**
 * Oferta de procedimento aguardando resposta (contexto-horarios.ts, acao
 * `oferecer`). Fechada a exatamente `procedimento_id`, string nao vazia --
 * quem produz esse valor e sempre o proprio Core, nunca a IA nem o paciente.
 * Nao valida se o id existe no catalogo: a integridade e conferida depois, na
 * mesma checagem de sempre, quando o procedimento aceito volta pelo fluxo.
 */
export function validarOfertaProcedimentoPendente(valor: unknown): asserts valor is true {
  // Fechado a `true`. O `procedimento_id` oferecido NAO trafega ate a IA
  // (specs/contexto-pendente-interpretacao-v1.md secao 11): ele fica so no
  // snapshot oficial, e quem aplica e o Core. `false` tambem e rejeitado --
  // "nao ha oferta" se representa pela AUSENCIA da chave, como as demais.
  if (valor !== true) {
    throw new EntradaInvalidaError(
      'oferta_procedimento_pendente',
      'oferta_procedimento_pendente deve ser exatamente true quando presente'
    );
  }
}

/**
 * Dentistas ATIVOS da clinica (specs/dentista-semantico-v1.md). Mesma
 * disciplina de `procedimentos_disponiveis`: fechada a arrays nao vazios de
 * pares {dentista_id, nome_exibido}, ambos strings nao vazias -- "nenhum
 * dentista ativo" se representa pela AUSENCIA da chave, nunca por `[]`. Nao
 * valida se o id existe nem se ha vinculo: quem produz este valor e sempre o
 * proprio Core (carregarCatalogo), e a aptidao e conferida DEPOIS, no
 * orquestrador, contra o procedimento ja resolvido.
 */
export function validarDentistasDisponiveis(
  valor: unknown
): asserts valor is { dentista_id: string; nome_exibido: string }[] {
  if (!Array.isArray(valor)) {
    throw new EntradaInvalidaError('dentistas_disponiveis', 'dentistas_disponiveis deve ser um array');
  }
  if (valor.length === 0) {
    throw new EntradaInvalidaError('dentistas_disponiveis', 'dentistas_disponiveis nao pode ser um array vazio');
  }
  for (const item of valor) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new EntradaInvalidaError('dentistas_disponiveis', 'dentistas_disponiveis contem item que nao e objeto');
    }
    const chaves = Object.keys(item as Record<string, unknown>).sort();
    if (JSON.stringify(chaves) !== JSON.stringify(['dentista_id', 'nome_exibido'])) {
      throw new EntradaInvalidaError(
        'dentistas_disponiveis',
        'dentistas_disponiveis contem item com chaves diferentes de dentista_id/nome_exibido'
      );
    }
    const { dentista_id, nome_exibido } = item as Record<string, unknown>;
    if (typeof dentista_id !== 'string' || dentista_id.trim() === '') {
      throw new EntradaInvalidaError('dentistas_disponiveis', 'dentistas_disponiveis contem dentista_id invalido');
    }
    if (typeof nome_exibido !== 'string' || nome_exibido.trim() === '') {
      throw new EntradaInvalidaError('dentistas_disponiveis', 'dentistas_disponiveis contem nome_exibido invalido');
    }
  }
}

/**
 * Agendamentos ativos do paciente, quando ha uma escolha de remarcacao
 * pendente (specs/remarcacao-conversacional-v1.md secao 3). Mesma
 * disciplina de `procedimentos_disponiveis`/`dentistas_disponiveis`: fechada
 * a arrays nao vazios de pares {agendamento_id, descricao}, ambos strings
 * nao vazias -- "nenhuma escolha pendente" se representa pela AUSENCIA da
 * chave, nunca por `[]`. Nao valida se o id existe: quem produz este valor
 * e sempre o proprio Core (buscarAgendamentoAtivo), nunca a IA nem o
 * paciente.
 */
export function validarAgendamentosAtivos(
  valor: unknown
): asserts valor is { agendamento_id: string; descricao: string }[] {
  if (!Array.isArray(valor)) {
    throw new EntradaInvalidaError('agendamentos_ativos', 'agendamentos_ativos deve ser um array');
  }
  if (valor.length === 0) {
    throw new EntradaInvalidaError('agendamentos_ativos', 'agendamentos_ativos nao pode ser um array vazio');
  }
  for (const item of valor) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new EntradaInvalidaError('agendamentos_ativos', 'agendamentos_ativos contem item que nao e objeto');
    }
    const chaves = Object.keys(item as Record<string, unknown>).sort();
    if (JSON.stringify(chaves) !== JSON.stringify(['agendamento_id', 'descricao'])) {
      throw new EntradaInvalidaError(
        'agendamentos_ativos',
        'agendamentos_ativos contem item com chaves diferentes de agendamento_id/descricao'
      );
    }
    const { agendamento_id, descricao } = item as Record<string, unknown>;
    if (typeof agendamento_id !== 'string' || agendamento_id.trim() === '') {
      throw new EntradaInvalidaError('agendamentos_ativos', 'agendamentos_ativos contem agendamento_id invalido');
    }
    if (typeof descricao !== 'string' || descricao.trim() === '') {
      throw new EntradaInvalidaError('agendamentos_ativos', 'agendamentos_ativos contem descricao invalida');
    }
  }
}

/**
 * Catalogo ativo minimo da clinica (specs/procedimento-semantico-v1.md).
 * Fechado a arrays nao vazios de pares {procedimento_id, nome_pt}, ambos
 * strings nao vazias -- "clinica sem catalogo" se representa pela AUSENCIA
 * da chave, nunca por `[]`, pelo mesmo motivo de horarios_oferecidos. Nao
 * valida se o id existe de fato: quem produz este valor e sempre o proprio
 * Core (carregarCatalogo), nunca a IA nem o paciente.
 */
export function validarProcedimentosDisponiveis(
  valor: unknown
): asserts valor is { procedimento_id: string; nome_pt: string }[] {
  if (!Array.isArray(valor)) {
    throw new EntradaInvalidaError('procedimentos_disponiveis', 'procedimentos_disponiveis deve ser um array');
  }
  if (valor.length === 0) {
    throw new EntradaInvalidaError('procedimentos_disponiveis', 'procedimentos_disponiveis nao pode ser um array vazio');
  }
  for (const item of valor) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new EntradaInvalidaError('procedimentos_disponiveis', 'procedimentos_disponiveis contem item que nao e objeto');
    }
    const chaves = Object.keys(item as Record<string, unknown>).sort();
    if (JSON.stringify(chaves) !== JSON.stringify(['nome_pt', 'procedimento_id'])) {
      throw new EntradaInvalidaError(
        'procedimentos_disponiveis',
        'procedimentos_disponiveis contem item com chaves diferentes de procedimento_id/nome_pt'
      );
    }
    const { procedimento_id, nome_pt } = item as Record<string, unknown>;
    if (typeof procedimento_id !== 'string' || procedimento_id.trim() === '') {
      throw new EntradaInvalidaError('procedimentos_disponiveis', 'procedimentos_disponiveis contem procedimento_id invalido');
    }
    if (typeof nome_pt !== 'string' || nome_pt.trim() === '') {
      throw new EntradaInvalidaError('procedimentos_disponiveis', 'procedimentos_disponiveis contem nome_pt invalido');
    }
  }
}

/**
 * Proposta concreta que o Core apresentou ao paciente, aguardando
 * confirmacao (contexto-horarios.ts, acao `propor`). Fechada a exatamente
 * `data` e `horario`, ambas strings nao vazias -- quem produz esses valores
 * e sempre o proprio Core (mesma formatacao que o texto ja mostrou ao
 * paciente), nunca a IA nem o paciente.
 */
export function validarPropostaPendente(valor: unknown): asserts valor is { data: string; horario: string } {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new EntradaInvalidaError('proposta_pendente', 'proposta_pendente deve ser um objeto');
  }
  const chaves = Object.keys(valor as Record<string, unknown>).sort();
  if (JSON.stringify(chaves) !== JSON.stringify(['data', 'horario'])) {
    throw new EntradaInvalidaError('proposta_pendente', 'proposta_pendente deve conter exatamente data e horario');
  }
  const { data, horario } = valor as Record<string, unknown>;
  if (typeof data !== 'string' || data.trim() === '') {
    throw new EntradaInvalidaError('proposta_pendente', 'proposta_pendente.data deve ser uma string nao vazia');
  }
  if (typeof horario !== 'string' || horario.trim() === '') {
    throw new EntradaInvalidaError('proposta_pendente', 'proposta_pendente.horario deve ser uma string nao vazia');
  }
}

/**
 * Lista de horarios ja apresentados ao paciente (contexto-horarios.ts).
 * Fechada a strings nao vazias; lista vazia e rejeitada porque "nenhum
 * horario oferecido" se representa pela AUSENCIA da chave, nunca por `[]`
 * -- um array vazio no payload sugeriria ao modelo que houve uma oferta sem
 * opcoes. Nao valida o formato `HH:MM`: quem produz esses valores e o
 * proprio Core (mesma funcao que formata o texto ao paciente), nunca a IA
 * nem o paciente.
 */
export function validarHorariosOferecidos(valor: unknown): asserts valor is string[] {
  if (!Array.isArray(valor)) {
    throw new EntradaInvalidaError('horarios_oferecidos', 'horarios_oferecidos deve ser um array');
  }
  if (valor.length === 0) {
    throw new EntradaInvalidaError('horarios_oferecidos', 'horarios_oferecidos nao pode ser um array vazio');
  }
  for (const horario of valor) {
    if (typeof horario !== 'string' || horario.trim() === '') {
      throw new EntradaInvalidaError('horarios_oferecidos', 'horarios_oferecidos contem item que nao e string nao vazia');
    }
  }
}

/**
 * Ultimos turnos da conversa (historico-conversa.ts). Fechada a arrays nao
 * vazios de pares {mensagem_paciente, resposta_iris, gerada_em}, todos
 * strings nao vazias -- "nenhum turno anterior" se representa pela AUSENCIA
 * da chave, nunca por `[]`, pelo mesmo motivo de horarios_oferecidos. Nao
 * valida ordem cronologica nem janela de validade: quem produz este valor e
 * sempre o proprio Core (historicoValidoParaEnvio), nunca a IA nem o paciente.
 */
export function validarHistoricoRecente(valor: unknown): asserts valor is { mensagem_paciente: string; resposta_iris: string; gerada_em: string }[] {
  if (!Array.isArray(valor)) {
    throw new EntradaInvalidaError('historico_recente', 'historico_recente deve ser um array');
  }
  if (valor.length === 0) {
    throw new EntradaInvalidaError('historico_recente', 'historico_recente nao pode ser um array vazio');
  }
  for (const par of valor) {
    if (par === null || typeof par !== 'object' || Array.isArray(par)) {
      throw new EntradaInvalidaError('historico_recente', 'historico_recente contem item que nao e objeto');
    }
    const chaves = Object.keys(par as Record<string, unknown>).sort();
    if (JSON.stringify(chaves) !== JSON.stringify(['gerada_em', 'mensagem_paciente', 'resposta_iris'])) {
      throw new EntradaInvalidaError('historico_recente', 'historico_recente contem par com chaves diferentes de mensagem_paciente/resposta_iris/gerada_em');
    }
    const { mensagem_paciente, resposta_iris, gerada_em } = par as Record<string, unknown>;
    if (typeof mensagem_paciente !== 'string' || mensagem_paciente.trim() === '') {
      throw new EntradaInvalidaError('historico_recente', 'historico_recente contem mensagem_paciente invalida');
    }
    if (typeof resposta_iris !== 'string' || resposta_iris.trim() === '') {
      throw new EntradaInvalidaError('historico_recente', 'historico_recente contem resposta_iris invalida');
    }
    if (typeof gerada_em !== 'string' || Number.isNaN(Date.parse(gerada_em))) {
      throw new EntradaInvalidaError('historico_recente', 'historico_recente contem gerada_em invalida');
    }
  }
}

export function validarCamposCadastraisPreenchidos(
  campos: unknown
): asserts campos is CampoCadastralInterpretacao[] {
  if (!Array.isArray(campos)) {
    throw new EntradaInvalidaError(
      'campos_cadastrais_preenchidos',
      'campos_cadastrais_preenchidos deve ser um array'
    );
  }
  const vistos = new Set<string>();
  for (const campo of campos) {
    // Somente nomes de campo cadastral canonicos. Um valor (ex.: o CPF
    // em si) nunca pertence a esta lista -- e o nome bruto recebido nao e
    // reproduzido no erro, porque poderia ser justamente uma PII.
    if (typeof campo !== 'string' || !CAMPOS_CADASTRAIS_INTERPRETACAO.includes(campo as CampoCadastralInterpretacao)) {
      throw new EntradaInvalidaError(
        'campos_cadastrais_preenchidos',
        'campos_cadastrais_preenchidos contem campo nao permitido'
      );
    }
    if (vistos.has(campo)) {
      throw new EntradaInvalidaError(
        'campos_cadastrais_preenchidos',
        'campos_cadastrais_preenchidos contem campo repetido'
      );
    }
    vistos.add(campo);
  }
}

export function validarMensagensAtuais(mensagens: unknown): asserts mensagens is string[] {
  if (!Array.isArray(mensagens)) {
    throw new EntradaInvalidaError('mensagens_atuais', 'mensagens_atuais deve ser um array');
  }
  if (mensagens.length === 0) {
    throw new EntradaInvalidaError('mensagens_atuais', 'mensagens_atuais deve possuir pelo menos uma mensagem');
  }
  mensagens.forEach((mensagem, indice) => {
    if (typeof mensagem !== 'string') {
      throw new EntradaInvalidaError('mensagens_atuais', `mensagens_atuais[${indice}] deve ser string`);
    }
    if (mensagem.trim() === '') {
      throw new EntradaInvalidaError('mensagens_atuais', `mensagens_atuais[${indice}] nao pode ser vazia`);
    }
  });
  // A ordem recebida e preservada exatamente como esta (nenhuma
  // ordenacao/concatenacao/aplicacao separada acontece aqui nem em
  // extrairAlteracoes) — o array e repassado ao payload sem transformacao.
}

/**
 * Valida `dados_atuais` do PAYLOAD do modelo: somente os seis campos
 * operacionais. Um campo cadastral aqui e violacao do contrato de PII e
 * invalida a entrada inteira.
 */
export function validarDadosAtuais(
  dadosAtuais: unknown
): asserts dadosAtuais is Partial<Record<CampoOperacionalInterpretacao, string>> {
  validarMapaDeCampos(dadosAtuais, 'dados_atuais', CAMPOS_OPERACIONAIS_INTERPRETACAO);
}

/**
 * Valida o SNAPSHOT oficial lido de estado_conversa: os dez campos, com
 * valores cadastrais inclusive. Uso interno do servidor -- este objeto
 * alimenta preAplicar e a reconciliacao, e nunca e entregue ao modelo.
 */
export function validarSnapshotOficial(
  snapshot: unknown
): asserts snapshot is SnapshotOficialConversa {
  validarMapaDeCampos(snapshot, 'dados_atuais', CAMPOS_PERMITIDOS);
}

function validarMapaDeCampos(
  mapa: unknown,
  rotulo: string,
  camposAceitos: readonly string[]
): void {
  if (mapa === null || typeof mapa !== 'object' || Array.isArray(mapa)) {
    throw new EntradaInvalidaError(rotulo, `${rotulo} deve ser um objeto (nao nulo, nao array)`);
  }
  for (const [campo, valor] of Object.entries(mapa as Record<string, unknown>)) {
    // A chave bruta nunca deve aparecer aqui: este validator tambem roda
    // sobre o snapshot oficial do banco, entao uma chave desconhecida
    // poderia conter PII no proprio nome. Identificador generico fixo.
    if (!camposAceitos.includes(campo)) {
      throw new EntradaInvalidaError('campo_desconhecido', `${rotulo} contem campo nao permitido`);
    }
    if (typeof valor !== 'string' || valor.trim() === '') {
      throw new EntradaInvalidaError(campo, `valor de '${campo}' deve ser uma string nao vazia`);
    }
    if (campo === 'periodo' && !PERIODOS_PERMITIDOS.includes(valor)) {
      throw new EntradaInvalidaError(campo, `valor de '${campo}' invalido`);
    }
    if (campo === 'intencao' && !INTENCOES_PERMITIDAS.includes(valor)) {
      throw new EntradaInvalidaError(campo, `valor de '${campo}' invalido`);
    }
    if (campo === 'confirmacao' && !CONFIRMACOES_PERMITIDAS.includes(valor)) {
      throw new EntradaInvalidaError(campo, `valor de '${campo}' invalido`);
    }
  }
}

// --- Validacao integral da saida do modelo ---
//
// `codigo` e `caminho` sao construidos somente a partir de nomes de campo
// fixos ou nomes de chave recebidos (nunca valores) — nunca incluir o
// conteudo bruto retornado pelo modelo no erro.

export function validarSaidaInterpretacao(saida: unknown): asserts saida is SaidaInterpretacao {
  if (saida === null || typeof saida !== 'object' || Array.isArray(saida)) {
    throw new InterpretacaoInvalidaError('saida_invalida', 'saida');
  }

  const chavesNivelPrincipal = Object.keys(saida as Record<string, unknown>);
  if (
    !mesmasChaves(chavesNivelPrincipal, [
      'natureza_mensagem',
      'alteracoes',
      'eventos_candidatos',
      'dentistas_candidatos',
    ])
  ) {
    throw new InterpretacaoInvalidaError('propriedade_extra', 'saida');
  }

  const { natureza_mensagem, alteracoes, eventos_candidatos, dentistas_candidatos } = saida as {
    natureza_mensagem: unknown;
    alteracoes: unknown;
    eventos_candidatos: unknown;
    dentistas_candidatos: unknown;
  };
  validarEventosCandidatos(eventos_candidatos);
  validarDentistasCandidatos(dentistas_candidatos);
  if (
    typeof natureza_mensagem !== 'string' ||
    !NATUREZAS_MENSAGEM_PERMITIDAS.includes(natureza_mensagem as NaturezaMensagem)
  ) {
    throw new InterpretacaoInvalidaError('natureza_mensagem_invalida', 'saida.natureza_mensagem');
  }
  if (alteracoes === null || typeof alteracoes !== 'object' || Array.isArray(alteracoes)) {
    throw new InterpretacaoInvalidaError('alteracoes_invalida', 'saida.alteracoes');
  }

  for (const [campo, alteracao] of Object.entries(alteracoes as Record<string, unknown>)) {
    // A chave bruta `campo` nunca deve aparecer em nenhum erro: se ela nao
    // for um dos dez campos canonicos (fixos, sem PII), usamos um caminho
    // generico em vez de interpolar o nome recebido do modelo.
    // CAMPOS_EMITIVEIS_PELA_IA, nao CAMPOS_PERMITIDOS: `dentista_id` continua
    // persistivel, mas so o Core o escreve (specs/dentista-semantico-v1.md
    // secao 12). Se a IA o emitir, a saida inteira e invalida.
    if (!CAMPOS_EMITIVEIS_PELA_IA.includes(campo as CampoDadosConversa)) {
      throw new InterpretacaoInvalidaError('campo_desconhecido', 'saida.alteracoes.campo_desconhecido');
    }

    const caminhoCampo = `saida.alteracoes.${campo}`;
    if (alteracao === null || typeof alteracao !== 'object' || Array.isArray(alteracao)) {
      throw new InterpretacaoInvalidaError('alteracao_invalida', caminhoCampo);
    }

    const chavesAlteracao = Object.keys(alteracao as Record<string, unknown>);
    const { acao, valor } = alteracao as { acao?: unknown; valor?: unknown };

    if (typeof acao !== 'string' || !ACOES_PERMITIDAS.includes(acao as AcaoAlteracaoDados)) {
      throw new InterpretacaoInvalidaError('acao_desconhecida', `${caminhoCampo}.acao`);
    }

    if (acao === 'remover') {
      if (!mesmasChaves(chavesAlteracao, ['acao'])) {
        throw new InterpretacaoInvalidaError('propriedade_extra', caminhoCampo);
      }
      continue;
    }

    // acao === 'informar' | 'corrigir'
    if (!mesmasChaves(chavesAlteracao, ['acao', 'valor'])) {
      throw new InterpretacaoInvalidaError('propriedade_extra', caminhoCampo);
    }
    if (typeof valor !== 'string' || valor.trim() === '') {
      throw new InterpretacaoInvalidaError('valor_invalido', `${caminhoCampo}.valor`);
    }
    if (campo === 'periodo' && !PERIODOS_PERMITIDOS.includes(valor)) {
      throw new InterpretacaoInvalidaError('valor_fora_do_dominio', `${caminhoCampo}.valor`);
    }
    if (campo === 'intencao' && !INTENCOES_PERMITIDAS.includes(valor)) {
      throw new InterpretacaoInvalidaError('valor_fora_do_dominio', `${caminhoCampo}.valor`);
    }
    if (campo === 'confirmacao' && !CONFIRMACOES_PERMITIDAS.includes(valor)) {
      throw new InterpretacaoInvalidaError('valor_fora_do_dominio', `${caminhoCampo}.valor`);
    }
  }
}

/**
 * Eventos candidatos (specs/eventos-conversacionais-v1.md secao 4).
 * Array obrigatorio, possivelmente vazio. Fechado aos tipos implementados:
 * tipo desconhecido ou evento repetido invalida a saida inteira -- nunca e
 * descartado em silencio.
 *
 * FORMA UNICA para todos os tipos (2026-08-10): os dois eventos afirmam a
 * mesma coisa, entao nao existe campo que um precise e o outro nao. Nenhum
 * deles tem versao de recusa -- recusar e nao emitir.
 */
export function validarEventosCandidatos(valor: unknown): asserts valor is EventoCandidatoIA[] {
  if (!Array.isArray(valor)) {
    throw new InterpretacaoInvalidaError('eventos_candidatos_invalido', 'saida.eventos_candidatos');
  }
  const vistos = new Set<string>();
  for (const item of valor) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new InterpretacaoInvalidaError('evento_invalido', 'saida.eventos_candidatos');
    }
    const chaves = Object.keys(item as Record<string, unknown>);
    if (!mesmasChaves(chaves, ['tipo', 'referencia_textual'])) {
      throw new InterpretacaoInvalidaError('propriedade_extra', 'saida.eventos_candidatos');
    }
    const { tipo, referencia_textual } = item as { tipo: unknown; referencia_textual: unknown };
    if (typeof tipo !== 'string' || !TIPOS_EVENTO_CANDIDATO_PERMITIDOS.includes(tipo as EventoCandidatoIA['tipo'])) {
      throw new InterpretacaoInvalidaError('evento_desconhecido', 'saida.eventos_candidatos.tipo');
    }
    // `null` e valido e e o caso NORMAL de concordancia deitica ("pode ser").
    if (referencia_textual !== null && typeof referencia_textual !== 'string') {
      throw new InterpretacaoInvalidaError('valor_invalido', 'saida.eventos_candidatos.referencia_textual');
    }
    if (vistos.has(tipo)) {
      throw new InterpretacaoInvalidaError('evento_repetido', 'saida.eventos_candidatos');
    }
    vistos.add(tipo);
  }
}

/**
 * `dentistas_candidatos` (specs/dentista-semantico-v1.md secao 12).
 * `null` (nao mencionou) ou array de ids nao vazios e distintos -- inclusive
 * `[]`, que significa "mencionou e nenhum corresponde". Nao confere se o id
 * existe no catalogo: isso e integridade, conferida depois pelo Core.
 */
export function validarDentistasCandidatos(valor: unknown): asserts valor is string[] | null {
  if (valor === null) return;
  if (!Array.isArray(valor)) {
    throw new InterpretacaoInvalidaError('dentistas_candidatos_invalido', 'saida.dentistas_candidatos');
  }
  const vistos = new Set<string>();
  for (const id of valor) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new InterpretacaoInvalidaError('valor_invalido', 'saida.dentistas_candidatos');
    }
    if (vistos.has(id)) {
      throw new InterpretacaoInvalidaError('candidato_repetido', 'saida.dentistas_candidatos');
    }
    vistos.add(id);
  }
}

function mesmasChaves(chaves: string[], esperadas: string[]): boolean {
  return chaves.length === esperadas.length && esperadas.every((chave) => chaves.includes(chave));
}
