// Tipos do dominio de resolucao temporal.
//
// Contrato: specs/resolvedor-temporal-v1.md. Estruturas de DOMINIO, nunca
// schema fisico -- a spec (secao 29) declara que a persistencia dos atomos
// temporais e a migracao de `AlteracoesDados` permanecem pendencia explicita.
//
// NENHUM tipo publicado e redefinido aqui. `InstanteAtual`, `Periodo` e
// `RestricaoHoraria` sao IMPORTADOS de `disponibilidade-tipos.ts` e usados
// exatamente como existem la (spec, cabecalho): o resolvedor precisa produzir
// fatos compativeis com `EntradaDisponibilidade` sem alterar aquele contrato.

import type { InstanteAtual, Periodo, RestricaoHoraria } from './disponibilidade-tipos.ts';

/** Limite fechado de atomos por leva de fatos (secao 5). */
export const MAXIMO_ATOMOS_TEMPORAIS = 8;

// --- Vocabulario fechado dos atomos (secao 5) ---

/**
 * Cinco formas fechadas de horario. Vale igualmente para `horario_exato`
 * (`forma`) e para o horario-limite de `restricao` (`forma_limite`) -- mesma
 * forma, campos com nome distinto, nunca compartilhados (secao 5).
 *
 * `horario_nao_classificado` existe para a IA sinalizar "havia um horario na
 * mensagem, mas nao coube em nenhuma das outras quatro formas": nunca e
 * descartado em silencio nem tratado como ausencia de horario -- produz
 * sempre `ambiguo` (secao 17), nunca `invalido`.
 */
export type FormaHorario =
  | 'horario_24h'
  | 'horario_12h'
  | 'meio_dia'
  | 'meia_noite'
  | 'horario_nao_classificado';

/** Fechado, tres valores (secao 10). `ontem` e `semana que vem` estao fora da v1. */
export type ValorDataRelativa = 'hoje' | 'amanha' | 'depois_de_amanha';

export type DiaDaSemana =
  | 'domingo'
  | 'segunda'
  | 'terca'
  | 'quarta'
  | 'quinta'
  | 'sexta'
  | 'sabado';

/**
 * A IA decide o qualificador ANTES de produzir o atomo (secao 5): o
 * resolvedor nunca ve o texto original e nunca infere "esta"/"proxima" a
 * partir de palavras como "que vem". Ausente (`null`) e sempre `ambiguo`.
 */
export type QualificadorDiaSemana = 'esta' | 'proxima';

export type ParteDia = 'am' | 'pm';

/**
 * Reutiliza o discriminador ja publicado em `RestricaoHoraria` -- as duas
 * unicas variantes canonicas. Nao existe limite inferior nesta v1 (secao 15):
 * "depois das 15h" nao e representavel e nunca e convertido para `inicio_ate`.
 */
export type TipoRestricao = RestricaoHoraria['tipo'];

/** Mesma distincao ja canonica em `novo-agendamento.md` secao 9. */
export type IntencaoTemporal = 'data_especifica' | 'proxima_disponibilidade';

// --- Atomos temporais (secao 5, camada 3: tipos internos normalizados) ---

/** `ano` ausente (`null`) aciona a regra de ano omitido (secao 11). */
export interface AtomoDataAbsoluta {
  tipo: 'data_absoluta';
  dia: number;
  mes: number;
  ano: number | null;
}

export interface AtomoDataRelativa {
  tipo: 'data_relativa';
  valor: ValorDataRelativa;
}

export interface AtomoDiaSemana {
  tipo: 'dia_semana';
  dia: DiaDaSemana;
  qualificador: QualificadorDiaSemana | null;
}

/**
 * Atomo proprio, com campos proprios -- NUNCA compartilhados com `restricao`.
 * `hora`/`minuto` sao preenchidos em `horario_24h`/`horario_12h`; `parte_dia`
 * somente em `horario_12h`.
 */
export interface AtomoHorarioExato {
  tipo: 'horario_exato';
  forma: FormaHorario;
  hora: number | null;
  minuto: number | null;
  parte_dia: ParteDia | null;
}

/**
 * Atomo proprio, com campos proprios do horario-limite. Separar os dois
 * atomos e o que permite representar "10h e preciso terminar ate 11h" como
 * dois fatos simultaneos e compativeis (secao 5), nunca um unico atomo
 * tentando carregar os dois valores.
 */
export interface AtomoRestricao {
  tipo: 'restricao';
  tipo_restricao: TipoRestricao;
  forma_limite: FormaHorario;
  hora_limite: number | null;
  minuto_limite: number | null;
  parte_dia_limite: ParteDia | null;
}

export interface AtomoPeriodo {
  tipo: 'periodo';
  valor: Periodo;
}

export interface AtomoIntencao {
  tipo: 'intencao';
  valor: IntencaoTemporal;
}

/**
 * Uniao discriminada fechada por `tipo`. Multiplos fatos da mesma categoria
 * (duas datas, duas restricoes, duas intencoes) sao representados por
 * multiplos ITENS da lista, nunca por aninhamento dentro de um atomo.
 */
export type AtomoTemporal =
  | AtomoDataAbsoluta
  | AtomoDataRelativa
  | AtomoDiaSemana
  | AtomoHorarioExato
  | AtomoRestricao
  | AtomoPeriodo
  | AtomoIntencao;

// --- Entrada ---

/**
 * `fuso` e campo IRMAO de `clinica_id`, nunca aninhado dentro de
 * `InstanteAtual` (secao 4) -- `InstanteAtual` ja e a forma fechada usada por
 * `EntradaDisponibilidade`, e alterar sua forma quebraria aquele contrato.
 *
 * `clinica_id` serve exclusivamente para isolamento e rastreabilidade (secao
 * 26): as regras civis sao universais e `clinica_id` nunca altera uma regra
 * de calendario ou de conversao 12h/24h.
 *
 * `fatos_temporais` e SEMPRE uma lista (secao 5), nunca um objeto unico
 * achatado por mensagem -- so a lista representa fatos simultaneos.
 */
export interface EntradaResolucaoTemporal {
  clinica_id: string;
  fuso: string;
  instante_atual: InstanteAtual;
  fatos_temporais: readonly AtomoTemporal[];
}

// --- Motivos fechados (secoes 16 a 20) ---

/**
 * Uniao fechada de EXATAMENTE tres motivos, avaliados na ordem de precedencia
 * interna fixa da secao 18 -- nenhuma entrada produz mais de um destes
 * simultaneamente.
 *
 * Nao existe motivo residual para "horario sem data" ou "restricao sem data":
 * ambos sao sempre subsumidos por um dos tres abaixo, conforme a intencao
 * presente (secao 13, secao 15, secao 18).
 */
export type MotivoIncompletudeTemporal =
  /** Nenhum atomo de intencao na leva -- inclui a leva vazia (secao 18). */
  | 'intencao_ausente'
  /** `proxima_disponibilidade` com horario exato: classificacao unica, nunca `ambiguo`. */
  | 'horario_recorrente_nao_suportado'
  /** `data_especifica` presente e nenhum atomo de data -- com ou sem horario/restricao. */
  | 'data_ausente';

/** `ambiguo` nunca carrega "melhor tentativa" nem valor parcial (secao 17). */
export type MotivoAmbiguidadeTemporal =
  | 'dia_semana_sem_qualificador'
  /** Hora `1..11` sem `parte_dia` e sem periodo que resolva de forma inequivoca. */
  | 'horario_sem_parte_dia'
  | 'horario_nao_classificado'
  /** Hora `12` sem `parte_dia` nem classificacao explicita de meio-dia/meia-noite. */
  | 'hora_12_com_parte_dia_ambigua'
  /** Atomo de `tipo` reconhecido cuja forma interna nao se classifica em variante fechada. */
  | 'expressao_temporal_nao_classificada';

export type MotivoInvalidoTemporal =
  /** `ano` explicito e `(dia, mes, ano)` fora do calendario gregoriano (secao 9). */
  | 'data_impossivel'
  /**
   * TODA operacao civil que exigiria alcancar ou ultrapassar um ano fora de
   * `1..9999` (secao 19, definicao ampliada): `ano` explicito fora do dominio;
   * busca de ano omitido esgotada (secao 11); e o avanco aritmetico de
   * `amanha`/`depois_de_amanha` (secao 10) ou de dia da semana (secao 12) que
   * passaria de `9999-12-31`. Nunca overflow para o ano `10000`, nunca wrap
   * para o inicio do dominio, nunca truncamento, nunca data parcial.
   */
  | 'ano_fora_do_dominio'
  /** `ano` explicito em `1..99` -- nunca expandido para nenhum seculo. */
  | 'ano_dois_digitos'
  | 'hora_fora_do_dominio'
  | 'minuto_fora_do_dominio'
  /** `24:00` -- nunca convertido para `00:00` do dia seguinte. */
  | 'horario_24_00'
  /** Numero nao finito em campo reconhecido, ou forma invalida sem motivo mais especifico. */
  | 'atomo_invalido'
  | 'quantidade_atomica_excedida';

export type MotivoPassadoTemporal =
  | 'data_passada'
  | 'horario_passado'
  | 'inicio_ate_passado'
  | 'termino_ate_passado'
  | 'dia_semana_esta_passado';

export type MotivoConflitoTemporal =
  | 'multiplas_datas'
  | 'data_especifica_com_proxima_disponibilidade'
  | 'multiplas_intencoes'
  | 'multiplos_horarios_exatos'
  | 'restricoes_conflitantes'
  | 'periodo_incompativel_com_horario'
  | 'horario_viola_inicio_ate';

/**
 * Nasce da configuracao da clinica (`fuso`) ou do contrato estrutural da
 * entrada (`instante_atual`) -- NUNCA dos fatos temporais em si (secao 20).
 * Estes tres motivos nunca aparecem em `invalido`.
 */
export type MotivoErroConfiguracaoTemporal =
  | 'fuso_ausente'
  | 'fuso_formato_invalido'
  | 'instante_atual_invalido';

// --- Resultado ---

/**
 * `fuso` NAO consta em `resolvido` (secao 21): ja pertence ao contexto oficial
 * da entrada e nunca e validado contra a tzdb aqui -- repeti-lo nao
 * acrescentaria fato oficial novo.
 *
 * `clinica_id` E mantido, seguindo o padrao dos quatro resolvedores ja
 * publicados, exclusivamente para isolamento e rastreabilidade.
 *
 * Campos opcionais sao OMITIDOS quando ausentes, nunca `undefined` explicito
 * -- garante round-trip exato por JSON (secao 23).
 */
export interface ResolucaoTemporalOficial {
  tipo: 'resolvido';
  clinica_id: string;
  intencao: IntencaoTemporal;
  /** Data civil `YYYY-MM-DD`, sempre com quatro digitos de ano. */
  data: string;
  periodo?: Periodo;
  /** Minutos desde a meia-noite local, dominio `0..1439`. */
  horario_min?: number;
  restricao?: RestricaoHoraria;
}

/**
 * Uniao fechada de sete variantes, discriminada por `tipo` (secao 21).
 *
 * `EntradaInvalidaError` NUNCA e adicionado a esta uniao: o nivel 1 da
 * precedencia global e sempre uma excecao lancada, nunca um valor de retorno.
 */
export type ResultadoResolucaoTemporal =
  | ResolucaoTemporalOficial
  | { tipo: 'incompleto'; motivo: MotivoIncompletudeTemporal }
  | { tipo: 'ambiguo'; motivo: MotivoAmbiguidadeTemporal }
  | { tipo: 'invalido'; motivo: MotivoInvalidoTemporal }
  | { tipo: 'passado'; motivo: MotivoPassadoTemporal }
  | { tipo: 'conflito'; motivo: MotivoConflitoTemporal }
  | { tipo: 'erro_configuracao'; motivo: MotivoErroConfiguracaoTemporal };
