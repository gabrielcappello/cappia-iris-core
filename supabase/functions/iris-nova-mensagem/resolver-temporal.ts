import { EntradaInvalidaError } from './erros.ts';
import type { Periodo, RestricaoHoraria } from './disponibilidade-tipos.ts';
import {
  MAXIMO_ATOMOS_TEMPORAIS,
  type AtomoDataAbsoluta,
  type AtomoDiaSemana,
  type AtomoHorarioExato,
  type AtomoRestricao,
  type AtomoTemporal,
  type DiaDaSemana,
  type EntradaResolucaoTemporal,
  type FormaHorario,
  type IntencaoTemporal,
  type MotivoAmbiguidadeTemporal,
  type MotivoConflitoTemporal,
  type MotivoIncompletudeTemporal,
  type MotivoInvalidoTemporal,
  type MotivoPassadoTemporal,
  type ParteDia,
  type QualificadorDiaSemana,
  type ResolucaoTemporalOficial,
  type ResultadoResolucaoTemporal,
  type TipoRestricao,
} from './temporal-tipos.ts';

/**
 * Resolvedor temporal deterministico (specs/resolvedor-temporal-v1.md).
 *
 * Converte fatos temporais JA INTERPRETADOS pela IA (atomos estruturados,
 * nunca texto livre, nunca data ou horario calculados) em fatos temporais
 * OFICIAIS: data civil, minuto local, periodo, restricao e intencao.
 *
 * Funcao pura: nao chama IA, nao acessa banco, nao acessa calendario, nao le
 * relogio da maquina, nao considera procedimento, dentista ou duracao, nao
 * gera opcoes de horario, nao altera estado e nao cria efeitos.
 *
 * **Nenhum `Date`, `Intl`, locale ou timezone de maquina** (secao 8): todo o
 * calendario e aritmetica civil pura sobre `instante_atual.data`. O construtor
 * do JavaScript aceita `2026-02-30` e desliza silenciosamente para marco --
 * exatamente a correcao automatica que a secao 9 proibe.
 *
 * **Precedencia global fixa** (secao 21), sempre aplicada e INDEPENDENTE da
 * ordem dos atomos na lista:
 *
 *   1. erro estrutural de entrada -> `EntradaInvalidaError` (excecao)
 *   2. erro de configuracao       -> `erro_configuracao`
 *   3. quantidade excedida / atomo invalido -> `invalido`
 *   4. conflito                   -> `conflito`
 *   5. passado                    -> `passado`
 *   6. mais de uma interpretacao  -> `ambiguo`
 *   7. informacao insuficiente    -> `incompleto`
 *   8. criterio oficial completo  -> `resolvido`
 *
 * Dentro de cada camada os motivos aplicaveis de TODOS os atomos sao
 * coletados e o desempate usa uma ordem de prioridade fixa -- nunca o
 * primeiro atomo encontrado, que faria o resultado depender da ordem.
 *
 * Lanca `EntradaInvalidaError` somente para violacao de contrato de FORMA
 * (tipo errado, propriedade desconhecida, discriminador invalido). Fato
 * temporal invalido, ambiguo, passado, conflitante ou incompleto NAO e
 * excecao: e resultado tipado.
 */
export function resolverTemporal(entrada: EntradaResolucaoTemporal): ResultadoResolucaoTemporal {
  // Nivel 1 -- barreira estrutural, antes de qualquer regra de dominio.
  const atomos = validarFormaEntrada(entrada);

  // Nivel 2 -- configuracao da clinica e contrato de `instante_atual`.
  const config = avaliarConfiguracao(entrada);
  if (config.erro) return config.erro;
  const { hoje, agora } = config;

  // Nivel 3 (parte 1) -- quantidade, antes de qualquer analise de dominio.
  // Truncar a lista em silencio esta explicitamente proibido (secao 5).
  if (atomos.length > MAXIMO_ATOMOS_TEMPORAIS) {
    return { tipo: 'invalido', motivo: 'quantidade_atomica_excedida' };
  }

  // Normalizacao por CATEGORIA antes de qualquer regra (secao 5): e o que
  // permite detectar "duas datas" como categoria, nunca por comparacao ad-hoc
  // entre itens especificos, e o que torna o resultado independente da ordem.
  const analise = analisar(atomos, hoje, agora);

  return (
    // Nivel 3 (parte 2)
    avaliarInvalidez(analise) ??
    // Nivel 4
    avaliarConflito(analise) ??
    // Nivel 5
    avaliarPassado(analise) ??
    // Nivel 6 / 7 (com a guarda de classificacao unica da secao 17)
    avaliarRecorrencia(analise) ??
    avaliarAmbiguidade(analise) ??
    avaliarIncompletude(analise) ??
    // Nivel 8
    montarResolvido(entrada.clinica_id, analise)
  );
}

// =====================================================================
// Nivel 2 -- configuracao
// =====================================================================

type ResultadoConfiguracao =
  | { erro: ResultadoResolucaoTemporal; hoje?: undefined; agora?: undefined }
  | { erro: null; hoje: string; agora: number };

/**
 * `fuso` ausente e `fuso` mal formado sao motivos DISTINTOS (secao 7).
 * Nenhum dos dois vira fuso padrao inventado nem assuncao de UTC.
 *
 * Este componente NUNCA valida a existencia real do fuso na tzdb -- isso
 * pertence ao adaptador futuro, que ja tera resolvido `instante_atual` a
 * partir de um fuso valido antes desta chamada.
 */
function avaliarConfiguracao(entrada: EntradaResolucaoTemporal): ResultadoConfiguracao {
  const fuso: unknown = entrada.fuso;
  if (fuso === undefined || fuso === null) {
    return { erro: { tipo: 'erro_configuracao', motivo: 'fuso_ausente' } };
  }
  if (typeof fuso !== 'string' || fuso.trim() === '') {
    return { erro: { tipo: 'erro_configuracao', motivo: 'fuso_formato_invalido' } };
  }

  const instante: unknown = entrada.instante_atual;
  if (instante === null || typeof instante !== 'object' || Array.isArray(instante)) {
    return { erro: { tipo: 'erro_configuracao', motivo: 'instante_atual_invalido' } };
  }
  const { data, minuto_min } = instante as Record<string, unknown>;
  if (!dataCivilValida(data) || !minutoPontualValido(minuto_min)) {
    return { erro: { tipo: 'erro_configuracao', motivo: 'instante_atual_invalido' } };
  }

  return { erro: null, hoje: data, agora: minuto_min };
}

// =====================================================================
// Analise por categoria
// =====================================================================

/** Resolucao de UM atomo de data. `passada` ainda carrega a data resolvida:
 * o nivel 4 (`multiplas_datas`) precisa compara-la antes do nivel 5. */
type ResolucaoData =
  | { estado: 'resolvida'; data: string }
  | { estado: 'passada'; data: string; motivo: MotivoPassadoTemporal }
  | { estado: 'invalida'; motivo: MotivoInvalidoTemporal }
  | { estado: 'ambigua'; motivo: MotivoAmbiguidadeTemporal };

/** Resolucao de UM horario (exato ou limite de restricao). `chave` identifica
 * o VALOR para deduplicacao: dois atomos que expressam o mesmo instante por
 * formas diferentes nao sao "valores diferentes" (secao 20). */
type ResolucaoHorario =
  | { estado: 'resolvido'; minuto: number; chave: string }
  | { estado: 'invalido'; motivo: MotivoInvalidoTemporal; chave: string }
  | { estado: 'ambiguo'; motivo: MotivoAmbiguidadeTemporal; chave: string }
  | { estado: 'conflito'; motivo: MotivoConflitoTemporal; chave: string };

interface ResolucaoRestricao {
  tipo_restricao: TipoRestricao;
  horario: ResolucaoHorario;
}

interface Analise {
  hoje: string;
  agora: number;
  datas: readonly ResolucaoData[];
  horarios: readonly ResolucaoHorario[];
  restricoes: readonly ResolucaoRestricao[];
  /** Distintos, ordenados -- o resultado nao pode depender da ordem de entrada. */
  periodos: readonly Periodo[];
  /** NUNCA deduplicado: duas ocorrencias identicas sao multiplicidade real (secao 20). */
  intencoes: readonly IntencaoTemporal[];
  /** Atomos reconhecidos pelo discriminador cuja forma interna e invalida. */
  invalidosEstruturais: readonly MotivoInvalidoTemporal[];
  temAtomoData: boolean;
  temHorarioExato: boolean;
}

const VALORES_DATA_RELATIVA: readonly string[] = ['hoje', 'amanha', 'depois_de_amanha'];
const VALORES_PERIODO: readonly string[] = ['manha', 'tarde', 'noite'];
const VALORES_INTENCAO: readonly string[] = ['data_especifica', 'proxima_disponibilidade'];
const VALORES_TIPO_RESTRICAO: readonly string[] = ['inicio_ate', 'termino_ate'];

function analisar(atomos: readonly AtomoTemporal[], hoje: string, agora: number): Analise {
  const datas: ResolucaoData[] = [];
  const horarios: ResolucaoHorario[] = [];
  const restricoes: ResolucaoRestricao[] = [];
  const periodosBrutos: Periodo[] = [];
  const intencoes: IntencaoTemporal[] = [];
  const invalidosEstruturais: MotivoInvalidoTemporal[] = [];

  // Um campo obrigatorio AUSENTE nao e violacao de contrato de forma (a secao
  // 19 classifica "atomo `restricao` sem `tipo_restricao`" como
  // `atomo_invalido`, um resultado, nunca uma excecao). Mas ele tambem nunca
  // pode ser aceito em silencio: sem esta barreira um `data_relativa` sem
  // `valor` resolveria para hoje, um `intencao` sem `valor` produziria um
  // `resolvido` sem intencao e um `restricao` sem `tipo_restricao` vazaria uma
  // `RestricaoHoraria` malformada para o resultado publico.
  for (const atomo of atomos) {
    switch (atomo.tipo) {
      case 'periodo':
        if (!VALORES_PERIODO.includes(atomo.valor)) {
          invalidosEstruturais.push('atomo_invalido');
          break;
        }
        periodosBrutos.push(atomo.valor);
        break;
      case 'intencao':
        if (!VALORES_INTENCAO.includes(atomo.valor)) {
          invalidosEstruturais.push('atomo_invalido');
          break;
        }
        intencoes.push(atomo.valor);
        break;
      default:
        break;
    }
  }

  // O periodo participa da resolucao de horario 12h sem `parte_dia`, por isso
  // e apurado ANTES dos horarios. Com mais de um periodo distinto a resolucao
  // fica indefinida: nenhum e escolhido em silencio -- o nivel 6 devolve
  // `expressao_temporal_nao_classificada`.
  const periodos = ordenarPeriodos([...new Set(periodosBrutos)]);
  const periodoUnico = periodos.length === 1 ? periodos[0] : null;

  for (const atomo of atomos) {
    switch (atomo.tipo) {
      case 'data_absoluta':
        datas.push(resolverDataAbsoluta(atomo, hoje));
        break;
      case 'data_relativa':
        datas.push(
          VALORES_DATA_RELATIVA.includes(atomo.valor)
            ? // O avanco pode esbarrar no teto civil quando `hoje` esta a menos
              // de dois dias de `9999-12-31` (secao 10, "Fronteira do teto
              // civil"): nesse caso o fato e invalido, nunca uma data no ano
              // `10000` e nunca um wrap para o inicio do dominio.
              resolucaoDeDataOuTeto(somarDias(hoje, DIAS_RELATIVOS[atomo.valor]))
            : { estado: 'invalida', motivo: 'atomo_invalido' }
        );
        break;
      case 'dia_semana':
        datas.push(resolverDiaSemana(atomo, hoje));
        break;
      case 'horario_exato':
        horarios.push(resolverHorarioExato(atomo, periodoUnico));
        break;
      case 'restricao':
        if (!VALORES_TIPO_RESTRICAO.includes(atomo.tipo_restricao)) {
          invalidosEstruturais.push('atomo_invalido');
          break;
        }
        restricoes.push({
          tipo_restricao: atomo.tipo_restricao,
          horario: resolverHorarioLimite(atomo, periodoUnico),
        });
        break;
      default:
        break;
    }
  }

  return {
    hoje,
    agora,
    datas,
    horarios,
    restricoes,
    periodos,
    intencoes,
    invalidosEstruturais,
    temAtomoData: datas.length > 0,
    temHorarioExato: horarios.length > 0,
  };
}

// =====================================================================
// Nivel 3 -- invalidez
// =====================================================================

/**
 * Ordem de prioridade FIXA. Motivo mais especifico sempre prevalece sobre
 * `atomo_invalido` (secao 19): um valor finito fora de dominio recebe o motivo
 * nomeado; `atomo_invalido` fica reservado para o que sobra depois de
 * descartados todos os nomeados -- inclusive numero nao finito, para o qual
 * nao existe motivo mais especifico.
 */
const PRIORIDADE_INVALIDEZ: readonly MotivoInvalidoTemporal[] = [
  'quantidade_atomica_excedida',
  'ano_dois_digitos',
  'ano_fora_do_dominio',
  'data_impossivel',
  'hora_fora_do_dominio',
  'minuto_fora_do_dominio',
  'horario_24_00',
  'atomo_invalido',
];

function avaliarInvalidez(analise: Analise): ResultadoResolucaoTemporal | null {
  const motivos: MotivoInvalidoTemporal[] = [...analise.invalidosEstruturais];

  for (const data of analise.datas) {
    if (data.estado === 'invalida') motivos.push(data.motivo);
  }
  for (const horario of todosOsHorarios(analise)) {
    if (horario.estado === 'invalido') motivos.push(horario.motivo);
  }

  const motivo = escolherPorPrioridade(motivos, PRIORIDADE_INVALIDEZ);
  return motivo ? { tipo: 'invalido', motivo } : null;
}

// =====================================================================
// Nivel 4 -- conflito
// =====================================================================

/** Ordem de prioridade FIXA, seguindo a enumeracao da secao 20. */
const PRIORIDADE_CONFLITO: readonly MotivoConflitoTemporal[] = [
  'multiplas_datas',
  'data_especifica_com_proxima_disponibilidade',
  'multiplas_intencoes',
  'multiplos_horarios_exatos',
  'restricoes_conflitantes',
  'periodo_incompativel_com_horario',
  'horario_viola_inicio_ate',
];

function avaliarConflito(analise: Analise): ResultadoResolucaoTemporal | null {
  const motivos: MotivoConflitoTemporal[] = [];

  // Duas datas DIFERENTES (secao 20). Datas repetidas que apontam para o
  // mesmo dia civil nao sao conflito -- a comparacao e por valor resolvido,
  // nunca por quantidade de atomos.
  if (datasDistintas(analise.datas).size > 1) motivos.push('multiplas_datas');

  motivos.push(...conflitosDeIntencao(analise));

  // Horarios exatos com valores diferentes. Intencionalmente por VALOR: dois
  // atomos que expressam 12:00 por `meio_dia` e por `horario_24h` sao o mesmo
  // criterio, nao dois criterios incompativeis.
  if (chavesDistintas(analise.horarios).size > 1) motivos.push('multiplos_horarios_exatos');

  // Duas restricoes simultaneas, do mesmo tipo com limites diferentes ou de
  // tipos diferentes (secao 15). Este resolvedor nunca combina duas
  // restricoes em uma so.
  const chavesRestricao = new Set(
    analise.restricoes.map((r) => `${r.tipo_restricao}|${r.horario.chave}`)
  );
  if (chavesRestricao.size > 1) motivos.push('restricoes_conflitantes');

  for (const horario of todosOsHorarios(analise)) {
    if (horario.estado === 'conflito') motivos.push(horario.motivo);
  }

  if (violaInicioAte(analise)) motivos.push('horario_viola_inicio_ate');

  const motivo = escolherPorPrioridade(motivos, PRIORIDADE_CONFLITO);
  return motivo ? { tipo: 'conflito', motivo } : null;
}

/**
 * A distincao entre os dois motivos de multiplicidade e puramente sobre QUAIS
 * e QUANTOS atomos de intencao estao presentes (secao 20):
 *
 * - exatamente duas, uma de cada tipo -> caso canonico;
 * - toda demais multiplicidade (repeticao do mesmo tipo, tres ou mais) ->
 *   `multiplas_intencoes`, motivo efetivamente produzido, nunca reservado.
 *
 * Intencoes NUNCA sao deduplicadas: duas ocorrencias identicas sao
 * multiplicidade real, nao ruido a descartar em silencio.
 *
 * `proxima_disponibilidade` acompanhada de uma data explicita tambem produz o
 * caso canonico: `docs/04-decisoes-canonicas.md` fixa que "data especifica
 * rigida junto com essa intencao e conflito", e a secao 16 so define o inicio
 * em "hoje" para a intencao SEM data.
 */
function conflitosDeIntencao(analise: Analise): MotivoConflitoTemporal[] {
  const { intencoes } = analise;
  const motivos: MotivoConflitoTemporal[] = [];

  if (intencoes.length >= 2) {
    const especificas = intencoes.filter((i) => i === 'data_especifica').length;
    const proximas = intencoes.length - especificas;
    motivos.push(
      intencoes.length === 2 && especificas === 1 && proximas === 1
        ? 'data_especifica_com_proxima_disponibilidade'
        : 'multiplas_intencoes'
    );
  }

  if (intencoes.includes('proxima_disponibilidade') && analise.temAtomoData) {
    motivos.push('data_especifica_com_proxima_disponibilidade');
  }

  return motivos;
}

/**
 * `inicio_ate` restringe DIRETAMENTE o mesmo valor que o horario exato ja
 * fornece (o minuto de inicio) -- nenhuma duracao e necessaria para a
 * comparacao, por isso ela pode ser feita aqui (secao 15).
 *
 * `termino_ate` NUNCA passa por aqui: ele restringe o FIM (`inicio +
 * duracao`), e este resolvedor jamais recebe duracao. Horario exato e
 * `termino_ate` simultaneos sao sempre PRESERVADOS como criterios oficiais
 * simultaneos; a compatibilidade final e verificada pela disponibilidade.
 */
function violaInicioAte(analise: Analise): boolean {
  const horario = horarioResolvidoUnico(analise);
  if (horario === null) return false;

  const limites = analise.restricoes.filter((r) => r.tipo_restricao === 'inicio_ate');
  if (limites.length !== 1) return false;

  const limite = limites[0].horario;
  return limite.estado === 'resolvido' && horario > limite.minuto;
}

// =====================================================================
// Nivel 5 -- passado
// =====================================================================

/**
 * Ordem de prioridade FIXA (secao 16). Os casos de data e os casos de horario
 * sao mutuamente exclusivos por construcao -- `horario_passado`,
 * `inicio_ate_passado` e `termino_ate_passado` so existem quando a data
 * resolvida e HOJE, enquanto `data_passada` e `dia_semana_esta_passado` so
 * existem quando ela e anterior a hoje.
 */
const PRIORIDADE_PASSADO: readonly MotivoPassadoTemporal[] = [
  'data_passada',
  'horario_passado',
  'inicio_ate_passado',
  'termino_ate_passado',
  'dia_semana_esta_passado',
];

function avaliarPassado(analise: Analise): ResultadoResolucaoTemporal | null {
  const motivos: MotivoPassadoTemporal[] = [];

  for (const data of analise.datas) {
    if (data.estado === 'passada') motivos.push(data.motivo);
  }

  // As regras de horario so valem quando a data oficial resolvida e HOJE. Uma
  // data estritamente futura nunca e passado, qualquer que seja o horario
  // associado (secao 16).
  if (dataOficial(analise) === analise.hoje) {
    const horario = horarioResolvidoUnico(analise);
    // Comparacao ESTRITA, identica a `inicioNoFuturo` da disponibilidade: um
    // inicio exatamente igual ao instante atual nunca e oferecido.
    if (horario !== null && horario <= analise.agora) motivos.push('horario_passado');

    for (const restricao of analise.restricoes) {
      if (restricao.horario.estado !== 'resolvido') continue;
      if (restricao.horario.minuto > analise.agora) continue;
      // Nenhum inicio valido poderia satisfazer o limite e ainda ser futuro;
      // para `termino_ate`, pela mesma razao, ja que duracao e sempre positiva.
      motivos.push(
        restricao.tipo_restricao === 'inicio_ate' ? 'inicio_ate_passado' : 'termino_ate_passado'
      );
    }
  }

  const motivo = escolherPorPrioridade(motivos, PRIORIDADE_PASSADO);
  return motivo ? { tipo: 'passado', motivo } : null;
}

// =====================================================================
// Nivel 6 / 7 -- recorrencia, ambiguidade, incompletude
// =====================================================================

/**
 * Guarda de CLASSIFICACAO UNICA (secao 17): `proxima_disponibilidade`
 * combinada com horario exato produz sempre `incompleto`, nunca `ambiguo` --
 * "nao ha alternativa entre os dois para esse caso". Por isso e avaliada
 * antes do nivel 6, e nao na ordem normal da secao 18.
 *
 * Buscar o mesmo horario em varios dias nao existe nesta v1: o controlador
 * deve perguntar se o paciente quer uma data especifica ou qualquer horario
 * mais proximo, nunca inferir uma das duas.
 */
function avaliarRecorrencia(analise: Analise): ResultadoResolucaoTemporal | null {
  if (analise.intencoes.includes('proxima_disponibilidade') && analise.temHorarioExato) {
    return { tipo: 'incompleto', motivo: 'horario_recorrente_nao_suportado' };
  }
  return null;
}

/** Ordem de prioridade FIXA, seguindo a enumeracao da secao 17. */
const PRIORIDADE_AMBIGUIDADE: readonly MotivoAmbiguidadeTemporal[] = [
  'dia_semana_sem_qualificador',
  'horario_sem_parte_dia',
  'horario_nao_classificado',
  'hora_12_com_parte_dia_ambigua',
  'expressao_temporal_nao_classificada',
];

function avaliarAmbiguidade(analise: Analise): ResultadoResolucaoTemporal | null {
  const motivos: MotivoAmbiguidadeTemporal[] = [];

  for (const data of analise.datas) {
    if (data.estado === 'ambigua') motivos.push(data.motivo);
  }
  for (const horario of todosOsHorarios(analise)) {
    if (horario.estado === 'ambiguo') motivos.push(horario.motivo);
  }
  // Mais de um periodo distinto na mesma leva: nenhum e escolhido em
  // silencio. A secao 20 nao preve motivo de conflito para periodo, e a secao
  // 17 reserva este motivo exatamente para o recebido-mas-nao-classificavel.
  if (analise.periodos.length > 1) motivos.push('expressao_temporal_nao_classificada');

  const motivo = escolherPorPrioridade(motivos, PRIORIDADE_AMBIGUIDADE);
  return motivo ? { tipo: 'ambiguo', motivo } : null;
}

/**
 * Ordem de precedencia interna FIXA da secao 18 -- nenhuma entrada produz
 * mais de um destes simultaneamente.
 *
 * `intencao_ausente` vem primeiro porque, sem intencao conhecida, o resolvedor
 * nao tem como determinar qual conjunto de dados e obrigatorio. E por isso que
 * a leva vazia e sempre `intencao_ausente`, nunca `data_ausente`.
 */
function avaliarIncompletude(analise: Analise): ResultadoResolucaoTemporal | null {
  const motivo = motivoDeIncompletude(analise);
  return motivo ? { tipo: 'incompleto', motivo } : null;
}

function motivoDeIncompletude(analise: Analise): MotivoIncompletudeTemporal | null {
  if (analise.intencoes.length === 0) return 'intencao_ausente';

  // `data_especifica` EXIGE data explicita -- com ou sem horario exato,
  // restricao ou periodo simultaneos. Nao existe motivo residual separado para
  // "horario sem data" ou "restricao sem data" (secao 18): ambos sao sempre
  // subsumidos aqui. `proxima_disponibilidade` nunca produz este motivo, porque
  // a data pode ser omitida e passa a valer hoje.
  if (analise.intencoes[0] === 'data_especifica' && !analise.temAtomoData) {
    return 'data_ausente';
  }
  return null;
}

// =====================================================================
// Nivel 8 -- resolvido
// =====================================================================

/**
 * Somente os fatos estritamente necessarios (secao 21). Campos opcionais sao
 * OMITIDOS quando ausentes -- nunca `undefined` explicito, que quebraria o
 * round-trip exato por JSON.
 *
 * Nunca incluidos, em nenhuma variante: texto livre, PII, agenda, duracao,
 * `dentista_id`, `procedimento_id`, `fuso` ou valor runtime bruto.
 */
function montarResolvido(clinica_id: string, analise: Analise): ResolucaoTemporalOficial {
  const resultado: ResolucaoTemporalOficial = {
    tipo: 'resolvido',
    clinica_id,
    intencao: analise.intencoes[0],
    data: dataOficial(analise) as string,
  };

  if (analise.periodos.length === 1) resultado.periodo = analise.periodos[0];

  const horario = horarioResolvidoUnico(analise);
  if (horario !== null) resultado.horario_min = horario;

  const restricao = restricaoOficial(analise);
  if (restricao !== null) resultado.restricao = restricao;

  return resultado;
}

/**
 * Produz o CRITERIO (`RestricaoHoraria`), nunca a verificacao contra opcoes
 * reais -- essa aplicacao pertence a disponibilidade, que conhece a duracao.
 *
 * A unicidade e apurada por VALOR, nunca por quantidade de atomos: duas
 * restricoes identicas expressam o mesmo criterio oficial (e por isso nao sao
 * conflito no nivel 4), entao tambem precisam produzir esse criterio aqui.
 */
function restricaoOficial(analise: Analise): RestricaoHoraria | null {
  const distintas = new Set(
    analise.restricoes.map((r) => `${r.tipo_restricao}|${r.horario.chave}`)
  );
  if (distintas.size !== 1) return null;

  const { tipo_restricao, horario } = analise.restricoes[0];
  if (horario.estado !== 'resolvido') return null;
  return { tipo: tipo_restricao, minuto_min: horario.minuto };
}

// =====================================================================
// Datas
// =====================================================================

const DIAS_RELATIVOS = { hoje: 0, amanha: 1, depois_de_amanha: 2 } as const;

const ANO_MINIMO_CIVIL = 1;
const ANO_MAXIMO_CIVIL = 9999;
/** Ano EXPLICITO aceito na entrada -- subconjunto do dominio civil (secao 9). */
const ANO_MINIMO_EXPLICITO = 100;
/** Janela de nove candidatos: o ano atual MAIS os oito seguintes (secao 11). */
const AVANCO_MAXIMO_ANOS = 8;

function resolverDataAbsoluta(atomo: AtomoDataAbsoluta, hoje: string): ResolucaoData {
  const { dia, mes, ano } = atomo;

  // Campo reconhecido com numero nao finito: nao existe motivo mais
  // especifico (secao 19), entao `atomo_invalido`.
  if (!ehInteiroFinito(dia)) return { estado: 'invalida', motivo: 'atomo_invalido' };

  // MES OMITIDO ("dia 20") -> a PROXIMA ocorrencia daquele dia (2026-08-17).
  // Mesmo criterio do ano omitido, logo abaixo, e do dia da semana sem
  // qualificador: avanca ate encontrar uma data que nao esteja no passado.
  if (mes === null || mes === undefined) {
    if (dia < 1 || dia > 31) return { estado: 'invalida', motivo: 'data_impossivel' };
    return resolverMesOmitido(dia, hoje);
  }

  if (!ehInteiroFinito(mes)) return { estado: 'invalida', motivo: 'atomo_invalido' };

  // Mes ou dia grosseiramente fora de faixa e impossivel em QUALQUER ano --
  // checagem de valor unico, nunca uma busca. Sem ela, `31/13` sem ano seria
  // classificado como problema de ANO, o que seria falso.
  if (mes < 1 || mes > 12) return { estado: 'invalida', motivo: 'data_impossivel' };
  if (dia < 1 || dia > 31) return { estado: 'invalida', motivo: 'data_impossivel' };

  if (ano === null || ano === undefined) return resolverAnoOmitido(dia, mes, hoje);

  if (!ehInteiroFinito(ano)) return { estado: 'invalida', motivo: 'atomo_invalido' };

  // Quatro faixas fechadas e mutuamente exclusivas (secao 9). Um ano de um ou
  // dois digitos e SEMPRE invalido -- nenhum seculo e inferido, em nenhuma
  // circunstancia.
  if (ano >= ANO_MINIMO_CIVIL && ano < ANO_MINIMO_EXPLICITO) {
    return { estado: 'invalida', motivo: 'ano_dois_digitos' };
  }
  if (ano < ANO_MINIMO_CIVIL || ano > ANO_MAXIMO_CIVIL) {
    return { estado: 'invalida', motivo: 'ano_fora_do_dominio' };
  }
  if (dia > diasNoMes(ano, mes)) return { estado: 'invalida', motivo: 'data_impossivel' };

  const data = formatarData(ano, mes, dia);
  return data < hoje
    ? { estado: 'passada', data, motivo: 'data_passada' }
    : { estado: 'resolvida', data };
}

/**
 * Primeira ocorrencia civil valida de `(dia, mes)` que nao esteja no passado.
 *
 * Janela de NOVE candidatos: o ano de `instante_atual.data` mais os oito
 * seguintes -- suficiente para cobrir integralmente o ciclo de 29 de
 * fevereiro, inclusive o caso secular (2096 -> 2104, passando por 2100, que
 * nao e bissexto por ser multiplo de 100 e nao de 400).
 *
 * Hoje E permitido: uma candidata igual a `instante_atual.data` resolve para
 * hoje, nunca avanca para outro ano. Nenhum ano anterior ao corrente e
 * escolhido, e nenhum ano acima de `9999` e examinado -- sem overflow, wrap
 * ou inferencia alem do teto.
 */
/**
 * "dia 20" -- so o dia, sem mes (2026-08-17).
 *
 * Avanca mes a mes ate encontrar uma data real que nao esteja no passado:
 * o mes corrente quando o dia ainda nao passou, o seguinte quando ja passou.
 * Pula meses em que o dia nao existe (31 em fevereiro, por exemplo) -- nunca
 * desliza para o dia 1 do mes seguinte, como o construtor de `Date` faria.
 *
 * O teto de 13 meses cobre qualquer dia do calendario com folga: o pior caso
 * real e o dia 29 em ano nao bissexto, que reaparece em ate 12 meses.
 */
function resolverMesOmitido(dia: number, hoje: string): ResolucaoData {
  let ano = Number(hoje.slice(0, 4));
  let mes = Number(hoje.slice(5, 7));

  for (let avanco = 0; avanco <= 13; avanco++) {
    if (ano > ANO_MAXIMO_CIVIL) break;
    if (dia <= diasNoMes(ano, mes)) {
      const data = formatarData(ano, mes, dia);
      if (data >= hoje) return { estado: 'resolvida', data };
    }
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }

  return { estado: 'invalida', motivo: 'data_impossivel' };
}

function resolverAnoOmitido(dia: number, mes: number, hoje: string): ResolucaoData {
  const anoAtual = Number(hoje.slice(0, 4));

  for (let avanco = 0; avanco <= AVANCO_MAXIMO_ANOS; avanco++) {
    const ano = anoAtual + avanco;
    if (ano > ANO_MAXIMO_CIVIL) break;
    if (dia > diasNoMes(ano, mes)) continue;

    const data = formatarData(ano, mes, dia);
    if (data >= hoje) return { estado: 'resolvida', data };
  }

  // O problema e o ANO, nunca o par `(dia, mes)` em si (secao 19).
  return { estado: 'invalida', motivo: 'ano_fora_do_dominio' };
}

const INDICE_DIA_SEMANA: Record<DiaDaSemana, number> = {
  segunda: 0,
  terca: 1,
  quarta: 2,
  quinta: 3,
  sexta: 4,
  sabado: 5,
  domingo: 6,
};

/**
 * SEGUNDA-FEIRA E O PRIMEIRO DIA DA SEMANA CIVIL; domingo e o ultimo. Fixo e
 * universal (secao 12) -- nao depende de locale, sistema operacional,
 * biblioteca de data ou timezone da maquina, e nao e configuravel por clinica.
 *
 * Sem qualificador o resultado e SEMPRE `ambiguo`: nunca se escolhe em
 * silencio entre "esta" e "proxima".
 */
function resolverDiaSemana(atomo: AtomoDiaSemana, hoje: string): ResolucaoData {
  const indice = INDICE_DIA_SEMANA[atomo.dia];
  if (indice === undefined) return { estado: 'invalida', motivo: 'atomo_invalido' };

  // SEM QUALIFICADOR = A PROXIMA OCORRENCIA (2026-08-17, decisao do Gabriel).
  //
  // Ate aqui isto era `ambiguo/dia_semana_sem_qualificador`: o Core se
  // recusava a escolher entre "esta quarta" e "a proxima quarta". Na pratica
  // isso travou conversa real -- o paciente pediu "quarta-feira 15hrs" e a
  // Iris ficou pedindo a data em quatro turnos seguidos.
  //
  // Por que a proxima ocorrencia e o padrao certo: e como as pessoas falam.
  // Quem diz "quarta" quer a quarta que vem a seguir; quem quer outra semana
  // diz explicitamente ("nao esta, a proxima"). E o risco de errar o dia e
  // ZERO -- o Core sempre PROPOE a data e espera confirmacao antes de
  // agendar, entao o paciente ve "quarta, 19/08?" e corrige se preciso.
  //
  // `dia_semana_sem_qualificador` permanece no vocabulario de motivos
  // (temporal-tipos.ts) e continua alcancavel por outros caminhos -- nada foi
  // removido do contrato.
  const qualificador: QualificadorDiaSemana = atomo.qualificador ?? 'proxima';

  if (qualificador === 'proxima') {
    // Estritamente posterior a hoje: hoje nunca conta, mesmo quando hoje ja e
    // esse dia da semana. O avanco de ate sete dias pode ultrapassar o teto
    // civil quando `hoje` esta na ultima semana do dominio (secao 12,
    // "Fronteira do teto civil").
    const avanco = ((indice - diaDaSemana(hoje) + 7) % 7) || 7;
    return resolucaoDeDataOuTeto(somarDias(hoje, avanco));
  }

  // O mesmo vale para `esta`: a ocorrencia pedida dentro da semana civil
  // corrente pode cair depois de `9999-12-31` quando a semana atravessa o teto.
  const segunda = segundaDaSemana(hoje);
  const data = segunda === null ? null : somarDias(segunda, indice);
  if (data === null) return { estado: 'invalida', motivo: 'ano_fora_do_dominio' };

  return data < hoje
    ? { estado: 'passada', data, motivo: 'dia_semana_esta_passado' }
    : { estado: 'resolvida', data };
}

/**
 * Converte o sinal fechado dos helpers civis (`null` = fora do dominio) na
 * resolucao de data correspondente. Ponto unico de traducao: nenhum chamador
 * inventa um comportamento proprio para o teto.
 */
function resolucaoDeDataOuTeto(data: string | null): ResolucaoData {
  return data === null
    ? { estado: 'invalida', motivo: 'ano_fora_do_dominio' }
    : { estado: 'resolvida', data };
}

// =====================================================================
// Horarios
// =====================================================================

const MINUTO_MAXIMO_PONTUAL = 1439;
const MINUTOS_POR_HORA = 60;
const MEIO_DIA_MIN = 720;
const MEIA_NOITE_MIN = 0;

function resolverHorarioExato(
  atomo: AtomoHorarioExato,
  periodo: Periodo | null
): ResolucaoHorario {
  return resolverHorario(atomo.forma, atomo.hora, atomo.minuto, atomo.parte_dia, periodo);
}

function resolverHorarioLimite(
  atomo: AtomoRestricao,
  periodo: Periodo | null
): ResolucaoHorario {
  return resolverHorario(
    atomo.forma_limite,
    atomo.hora_limite,
    atomo.minuto_limite,
    atomo.parte_dia_limite,
    periodo
  );
}

/**
 * Mesma logica fechada para `horario_exato` e para o horario-limite de
 * `restricao` -- campos com nomes distintos, regra identica (secao 13).
 *
 * Qualquer minuto civil valido e PRESERVADO exatamente como recebido: nenhum
 * arredondamento, nenhum truncamento. A granularidade de 10 minutos pertence
 * somente a busca de vizinhos da disponibilidade.
 */
function resolverHorario(
  forma: FormaHorario,
  hora: number | null,
  minuto: number | null,
  parte_dia: ParteDia | null,
  periodo: Periodo | null
): ResolucaoHorario {
  const chave = `est:${String(forma)}:${String(hora)}:${String(minuto)}:${String(parte_dia)}`;
  const invalido = (motivo: MotivoInvalidoTemporal): ResolucaoHorario => ({
    estado: 'invalido',
    motivo,
    chave,
  });
  const resolvido = (min: number): ResolucaoHorario => ({
    estado: 'resolvido',
    minuto: min,
    chave: `min:${min}`,
  });

  // `meio_dia` e `meia_noite` sao apenas formas alternativas de expressar os
  // mesmos dois instantes, nunca horarios distintos.
  if (forma === 'meio_dia') return resolvido(MEIO_DIA_MIN);
  if (forma === 'meia_noite') return resolvido(MEIA_NOITE_MIN);

  // Nunca descartado em silencio nem tratado como ausencia de horario.
  if (forma === 'horario_nao_classificado') {
    return { estado: 'ambiguo', motivo: 'horario_nao_classificado', chave };
  }

  if (forma !== 'horario_24h' && forma !== 'horario_12h') return invalido('atomo_invalido');
  if (!ehInteiroFinito(hora) || !ehInteiroFinito(minuto)) return invalido('atomo_invalido');
  if (minuto < 0 || minuto > 59) return invalido('minuto_fora_do_dominio');

  if (forma === 'horario_24h') {
    // `24:00` tem motivo proprio: nunca convertido para `00:00` do dia
    // seguinte, o que mudaria a DATA -- decisao que este resolvedor jamais
    // toma implicitamente a partir de um horario.
    if (hora === 24 && minuto === 0) return invalido('horario_24_00');
    if (hora < 0 || hora > 23) return invalido('hora_fora_do_dominio');
    return resolvido(hora * MINUTOS_POR_HORA + minuto);
  }

  if (hora < 1 || hora > 12) return invalido('hora_fora_do_dominio');

  // Tabela de conversao fechada (secao 13). A hora 12 e o unico caso em que a
  // conversao ingenua (`hora + 12`) produziria valor errado.
  if (parte_dia === 'am') {
    return resolvido(hora === 12 ? MEIA_NOITE_MIN : hora * MINUTOS_POR_HORA + minuto);
  }
  if (parte_dia === 'pm') {
    return resolvido(hora === 12 ? MEIO_DIA_MIN : (hora + 12) * MINUTOS_POR_HORA + minuto);
  }

  // "12 da manha", "12 da tarde" e "12 da noite" sao expressoes ambiguas por
  // si mesmas: nenhuma e mapeada automaticamente para AM/PM. Este resolvedor
  // nunca infere de qual dos dois instantes (00:00 ou 12:00) o paciente falou.
  if (hora === 12) {
    return { estado: 'ambiguo', motivo: 'hora_12_com_parte_dia_ambigua', chave };
  }

  // Hora 1..11 sem `parte_dia`: os dois candidatos distam exatamente 720
  // minutos e por isso NUNCA pertencem ao mesmo periodo -- o candidato "AM"
  // cabe so em manha; o "PM", em tarde ou noite.
  const candidatos = [
    hora * MINUTOS_POR_HORA + minuto,
    (hora + 12) * MINUTOS_POR_HORA + minuto,
  ];

  if (periodo === null) {
    // Nunca assumir manha por padrao, nunca escolher em silencio entre 08:00
    // e 20:00.
    return { estado: 'ambiguo', motivo: 'horario_sem_parte_dia', chave };
  }

  const compativeis = candidatos.filter((min) => periodoDoMinuto(min) === periodo);
  if (compativeis.length === 1) return resolvido(compativeis[0]);
  if (compativeis.length === 0) {
    // Os dois fatos sao individualmente compreensiveis, mas incompativeis com
    // os limites canonicos de periodo: `8` com `tarde` nunca resolve 20:00.
    return { estado: 'conflito', motivo: 'periodo_incompativel_com_horario', chave };
  }
  // Estruturalmente inalcancavel (os candidatos distam 720 minutos); mantido
  // como falha fechada em vez de escolha silenciosa.
  return { estado: 'ambiguo', motivo: 'horario_sem_parte_dia', chave };
}

/** Limites canonicos ja vigentes em `disponibilidade.md` secao 8, sem
 * configuracao por clinica nesta v1. */
function periodoDoMinuto(minuto: number): Periodo {
  if (minuto <= MEIO_DIA_MIN) return 'manha';
  if (minuto < 1080) return 'tarde';
  return 'noite';
}

const ORDEM_PERIODOS: readonly Periodo[] = ['manha', 'tarde', 'noite'];

function ordenarPeriodos(periodos: readonly Periodo[]): Periodo[] {
  return [...periodos].sort((a, b) => ORDEM_PERIODOS.indexOf(a) - ORDEM_PERIODOS.indexOf(b));
}

// =====================================================================
// Auxiliares de analise
// =====================================================================

function todosOsHorarios(analise: Analise): ResolucaoHorario[] {
  return [...analise.horarios, ...analise.restricoes.map((r) => r.horario)];
}

function datasDistintas(datas: readonly ResolucaoData[]): Set<string> {
  const distintas = new Set<string>();
  for (const data of datas) {
    if (data.estado === 'resolvida' || data.estado === 'passada') distintas.add(data.data);
  }
  return distintas;
}

function chavesDistintas(horarios: readonly ResolucaoHorario[]): Set<string> {
  return new Set(horarios.map((h) => h.chave));
}

/**
 * O horario oficial so existe quando ha exatamente um valor resolvido. Com
 * zero ou com multiplos valores distintos (ja tratados como conflito no nivel
 * 4) nao ha criterio unico a promover.
 */
function horarioResolvidoUnico(analise: Analise): number | null {
  const resolvidos = analise.horarios.filter((h) => h.estado === 'resolvido');
  if (resolvidos.length === 0) return null;
  const minutos = new Set(resolvidos.map((h) => (h as { minuto: number }).minuto));
  return minutos.size === 1 ? resolvidos[0].minuto : null;
}

/**
 * Data oficial da leva. `proxima_disponibilidade` SEM nenhum atomo de data
 * comeca hoje (secao 16); com data explicita ja teria sido conflito no nivel 4.
 */
function dataOficial(analise: Analise): string | null {
  const distintas = datasDistintas(analise.datas);
  if (distintas.size === 1) return [...distintas][0];
  if (distintas.size === 0 && analise.intencoes.includes('proxima_disponibilidade')) {
    return analise.hoje;
  }
  return null;
}

/**
 * Desempate por ordem de prioridade FIXA, nunca pelo primeiro atomo
 * encontrado -- e o que torna o resultado independente da ordem dos atomos na
 * lista (secao 5).
 */
function escolherPorPrioridade<T>(coletados: readonly T[], prioridade: readonly T[]): T | null {
  for (const motivo of prioridade) {
    if (coletados.includes(motivo)) return motivo;
  }
  return null;
}

// =====================================================================
// Calendario civil -- sem `Date`, sem `Intl`, sem locale
// =====================================================================

const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIAS_POR_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function anoBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

function diasNoMes(ano: number, mes: number): number {
  return mes === 2 && anoBissexto(ano) ? 29 : DIAS_POR_MES[mes - 1];
}

/**
 * Data civil `YYYY-MM-DD` existente no calendario gregoriano. Sem `Date`: o
 * construtor do JavaScript aceita `2026-02-30` e desliza silenciosamente para
 * marco, exatamente a correcao automatica que a secao 9 proibe.
 */
function dataCivilValida(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  const partes = FORMATO_DATA.exec(valor);
  if (!partes) return false;

  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);

  if (ano < ANO_MINIMO_CIVIL || ano > ANO_MAXIMO_CIVIL) return false;
  if (mes < 1 || mes > 12) return false;
  return dia >= 1 && dia <= diasNoMes(ano, mes);
}

/**
 * Sempre quatro digitos de ano (secao 9). So pode receber `ano` dentro de
 * `1..9999`: todo chamador ja barrou o avanco alem do teto antes de chegar
 * aqui, entao `padStart(4)` nunca precisa alargar a string para cinco digitos.
 */
function formatarData(ano: number, mes: number, dia: number): string {
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Avanca `n` dias civis (`n >= 0`), respeitando fim de mes e virada de ano.
 * `n` e sempre pequeno aqui: no maximo dois dias (data relativa) ou sete (dia
 * da semana).
 *
 * `null` significa EXATAMENTE "a data pedida esta fora do dominio civil" --
 * nunca uma data aproximada, nunca a ultima data valida como consolo. O tipo
 * de retorno obriga cada chamador a decidir o que fazer com o teto, em vez de
 * deixar um ano invalido viajar para ser detectado (ou nao) mais adiante.
 */
function somarDias(data: string, n: number): string | null {
  let atual = data;
  for (let i = 0; i < n; i++) {
    const seguinte = proximoDia(atual);
    if (seguinte === null) return null;
    atual = seguinte;
  }
  return atual;
}

/** `null` no teto superior do dominio civil (`9999-12-31` nao tem dia seguinte). */
function proximoDia(data: string): string | null {
  const [ano, mes, dia] = decompor(data);
  if (dia < diasNoMes(ano, mes)) return formatarData(ano, mes, dia + 1);
  if (mes < 12) return formatarData(ano, mes + 1, 1);
  if (ano >= ANO_MAXIMO_CIVIL) return null;
  return formatarData(ano + 1, 1, 1);
}

/** `null` no teto inferior do dominio civil (`0001-01-01` nao tem dia anterior). */
function diaAnterior(data: string): string | null {
  const [ano, mes, dia] = decompor(data);
  if (dia > 1) return formatarData(ano, mes, dia - 1);
  if (mes > 1) return formatarData(ano, mes - 1, diasNoMes(ano, mes - 1));
  if (ano <= ANO_MINIMO_CIVIL) return null;
  return formatarData(ano - 1, 12, 31);
}

function decompor(data: string): [number, number, number] {
  return [Number(data.slice(0, 4)), Number(data.slice(5, 7)), Number(data.slice(8, 10))];
}

/**
 * Dia da semana gregoriano, com SEGUNDA = 0 e domingo = 6. Contagem de dias
 * desde a epoca por aritmetica de calendario pura (algoritmo de eras), nunca
 * por `Date` -- o resultado e identico em qualquer maquina, locale ou fuso.
 *
 * `1970-01-01` e uma quinta-feira e corresponde a contagem `0`, o que fixa o
 * deslocamento de 3 usado abaixo.
 */
function diaDaSemana(data: string): number {
  const [ano, mes, dia] = decompor(data);
  const y = mes <= 2 ? ano - 1 : ano;
  const era = Math.floor(y / 400);
  const anoDaEra = y - era * 400;
  const diaDoAno = Math.floor((153 * (mes + (mes > 2 ? -3 : 9)) + 2) / 5) + dia - 1;
  const diaDaEra =
    anoDaEra * 365 + Math.floor(anoDaEra / 4) - Math.floor(anoDaEra / 100) + diaDoAno;
  const dias = era * 146097 + diaDaEra - 719468;
  return (((dias + 3) % 7) + 7) % 7;
}

/**
 * Segunda-feira da semana civil que contem `data` (secao 12). `null` so
 * ocorreria se a semana comecasse antes do dominio civil -- inalcancavel na
 * pratica, ja que `0001-01-01` e uma segunda-feira, mas propagado em vez de
 * assumido.
 */
function segundaDaSemana(data: string): string | null {
  let atual = data;
  for (let i = diaDaSemana(data); i > 0; i--) {
    const anterior = diaAnterior(atual);
    if (anterior === null) return null;
    atual = anterior;
  }
  return atual;
}

// =====================================================================
// Fronteira de confianca runtime
// =====================================================================

/**
 * Fronteira de confianca: os campos numericos sao tipados como `number`, mas
 * o dado chega de uma saida de modelo e pode ser qualquer coisa em tempo de
 * execucao. `unknown` aqui e deliberado -- so aparece nas fronteiras internas,
 * nunca no resultado publico.
 *
 * `NaN`, `Infinity` e `-Infinity` sao numeros RECONHECIDOS mas nao finitos:
 * nunca viram excecao estrutural (isso e reservado a tipo incompativel) e
 * nunca sao tratados como validos -- produzem `invalido` (secao 21).
 */
function ehInteiroFinito(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor);
}

function minutoPontualValido(valor: unknown): valor is number {
  return ehInteiroFinito(valor) && valor >= 0 && valor <= MINUTO_MAXIMO_PONTUAL;
}

// =====================================================================
// Nivel 1 -- validacao de forma da entrada
// =====================================================================

const CHAVES_ENTRADA: readonly string[] = [
  'clinica_id',
  'fuso',
  'instante_atual',
  'fatos_temporais',
];

/** Chaves permitidas por variante. Propriedade fora desta lista e violacao de
 * contrato de forma; propriedade AUSENTE nao e -- ela cai nas regras de
 * dominio (a secao 19 classifica "atomo `restricao` sem `tipo_restricao`"
 * como `atomo_invalido`, um resultado, nunca uma excecao). */
const CHAVES_POR_TIPO: Record<string, readonly string[]> = {
  data_absoluta: ['tipo', 'dia', 'mes', 'ano'],
  data_relativa: ['tipo', 'valor'],
  dia_semana: ['tipo', 'dia', 'qualificador'],
  horario_exato: ['tipo', 'forma', 'hora', 'minuto', 'parte_dia'],
  restricao: ['tipo', 'tipo_restricao', 'forma_limite', 'hora_limite', 'minuto_limite', 'parte_dia_limite'],
  periodo: ['tipo', 'valor'],
  intencao: ['tipo', 'valor'],
};

/** Campos numericos reconhecidos, por variante. */
const CAMPOS_NUMERICOS: Record<string, readonly string[]> = {
  data_absoluta: ['dia', 'mes', 'ano'],
  data_relativa: [],
  dia_semana: [],
  horario_exato: ['hora', 'minuto'],
  restricao: ['hora_limite', 'minuto_limite'],
  periodo: [],
  intencao: [],
};

/** Campos de enum reconhecidos, por variante, com o conjunto fechado de cada um. */
const CAMPOS_ENUM: Record<string, Readonly<Record<string, readonly string[]>>> = {
  data_absoluta: {},
  data_relativa: { valor: ['hoje', 'amanha', 'depois_de_amanha'] },
  dia_semana: {
    dia: ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'],
    qualificador: ['esta', 'proxima'],
  },
  horario_exato: {
    forma: ['horario_24h', 'horario_12h', 'meio_dia', 'meia_noite', 'horario_nao_classificado'],
    parte_dia: ['am', 'pm'],
  },
  restricao: {
    tipo_restricao: ['inicio_ate', 'termino_ate'],
    forma_limite: ['horario_24h', 'horario_12h', 'meio_dia', 'meia_noite', 'horario_nao_classificado'],
    parte_dia_limite: ['am', 'pm'],
  },
  periodo: { valor: ['manha', 'tarde', 'noite'] },
  intencao: { valor: ['data_especifica', 'proxima_disponibilidade'] },
};

/**
 * Barreira estrutural (nivel 1). Todas as mensagens usam somente nomes FIXOS
 * de campo -- nunca o valor recebido, nunca o nome de uma propriedade
 * desconhecida, que poderiam carregar texto do paciente (secao 25).
 *
 * `fuso` e `instante_atual` NAO sao validados aqui: ausencia ou forma
 * invalida deles produz `erro_configuracao` (nivel 2), nunca excecao.
 */
function validarFormaEntrada(entrada: unknown): readonly AtomoTemporal[] {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new EntradaInvalidaError('entrada', 'entrada deve ser um objeto');
  }

  for (const chave of Object.keys(entrada as Record<string, unknown>)) {
    if (!CHAVES_ENTRADA.includes(chave)) {
      throw new EntradaInvalidaError('entrada', 'entrada contem propriedade nao permitida');
    }
  }

  const { clinica_id, fatos_temporais } = entrada as Record<string, unknown>;

  // `clinica_id` vem da instancia autenticada, nunca da IA ou do paciente.
  if (typeof clinica_id !== 'string' || clinica_id.trim() === '') {
    throw new EntradaInvalidaError('clinica_id', 'clinica_id deve ser uma string nao vazia');
  }
  if (!Array.isArray(fatos_temporais)) {
    throw new EntradaInvalidaError('fatos_temporais', 'fatos_temporais deve ser um array');
  }

  for (const item of fatos_temporais) {
    validarFormaAtomo(item);
  }

  return fatos_temporais as readonly AtomoTemporal[];
}

function validarFormaAtomo(item: unknown): void {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new EntradaInvalidaError('fatos_temporais', 'atomo temporal deve ser um objeto');
  }

  const registro = item as Record<string, unknown>;
  const tipo = registro['tipo'];
  if (typeof tipo !== 'string') {
    throw new EntradaInvalidaError('fatos_temporais', 'atomo temporal exige discriminador tipo');
  }

  const permitidas = CHAVES_POR_TIPO[tipo];
  if (permitidas === undefined) {
    throw new EntradaInvalidaError('fatos_temporais', 'discriminador de atomo temporal desconhecido');
  }
  for (const chave of Object.keys(registro)) {
    if (!permitidas.includes(chave)) {
      throw new EntradaInvalidaError('fatos_temporais', 'atomo temporal contem propriedade nao permitida');
    }
  }

  // Tipo INCOMPATIVEL (string, objeto, booleano onde se espera numero) e
  // sempre erro estrutural. Numero reconhecido mas nao finito NAO e -- ele
  // segue para o nivel 3 como `atomo_invalido`. Os dois nunca sao alternativa
  // para o mesmo caso (secao 21).
  for (const campo of CAMPOS_NUMERICOS[tipo]) {
    const valor = registro[campo];
    if (valor === undefined || valor === null) continue;
    if (typeof valor !== 'number') {
      throw new EntradaInvalidaError('fatos_temporais', 'campo numerico de atomo temporal deve ser um numero');
    }
    if (Number.isFinite(valor) && !Number.isInteger(valor)) {
      throw new EntradaInvalidaError('fatos_temporais', 'campo numerico de atomo temporal deve ser inteiro');
    }
  }

  const enums = CAMPOS_ENUM[tipo];
  for (const campo of Object.keys(enums)) {
    const valor = registro[campo];
    if (valor === undefined || valor === null) continue;
    if (typeof valor !== 'string' || !enums[campo].includes(valor)) {
      throw new EntradaInvalidaError('fatos_temporais', 'campo de atomo temporal fora do conjunto fechado');
    }
  }
}
