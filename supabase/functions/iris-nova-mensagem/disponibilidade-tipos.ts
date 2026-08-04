// Tipos do dominio de disponibilidade.
//
// Contrato: specs/disponibilidade.md. Estruturas de DOMINIO, nunca schema
// fisico -- a spec nao define tabelas (secao 18: representacao das jornadas
// recorrentes segue pendente), e o gerador recebe jornadas, bloqueios e
// ocupacoes prontos em vez de consultar banco ou calendario.

// --- Modelo temporal ---
//
// O nucleo puro opera com DATA CIVIL + MINUTO LOCAL da clinica. Nenhuma
// conversao de fuso acontece aqui: `Date`, UTC, offset e parsing dependente
// do ambiente ficam de fora, o que torna o calculo identico em qualquer
// maquina. O `fuso` viaja no snapshot porque a spec (secao 16) exige que a
// opcao oficial o preserve, e porque a traducao de fontes externas para
// minuto local pertence ao transporte futuro -- nunca a este componente.
//
// `tratamento de horarios ambiguos em fusos com mudanca de horario`
// permanece pendencia declarada da spec (secao 18) e nao e decidido aqui.

/** Minutos desde a meia-noite local, no dominio `[0, 1440]`. */
export const MINUTO_MINIMO = 0;
export const MINUTO_MAXIMO = 1440;

/**
 * Intervalo SEMIABERTO `[inicio_min, fim_min)` (secao 3).
 *
 * Adjacencia nao e sobreposicao: um atendimento pode terminar exatamente
 * quando outro comeca. A mesma convencao vale para jornadas, bloqueios,
 * ocupacoes, intervalos livres e opcoes.
 */
export interface IntervaloMinutos {
  inicio_min: number;
  fim_min: number;
}

/**
 * Jornada oficial de UM dentista em UMA data. Somente minutos cobertos por
 * alguma jornada podem ser considerados livres (secao 3).
 */
export interface JornadaDentista extends IntervaloMinutos {
  clinica_id: string;
  dentista_id: string;
  data: string;
}

/**
 * Origem da indisponibilidade. Conjunto fechado exatamente com as fontes
 * que a secao 3 enumera ("subtrair almoco, bloqueios, agendamentos ativos e
 * eventos externos autorizados").
 *
 * Todas sao subtraidas de forma identica -- a origem existe so para
 * auditoria tecnica, nunca altera o calculo. `evento_externo` chega ja
 * traduzido para minuto local pelo transporte futuro: este componente nunca
 * consulta Google Calendar (secao 14).
 */
export type OrigemIndisponibilidade = 'almoco' | 'bloqueio' | 'agendamento' | 'evento_externo';

/** Intervalo indisponivel de UM dentista em UMA data. */
export interface IntervaloIndisponivel extends IntervaloMinutos {
  clinica_id: string;
  dentista_id: string;
  data: string;
  origem: OrigemIndisponibilidade;
}

/**
 * Periodos canonicos (secao 8), classificados pelo HORARIO DE INICIO da
 * opcao, no fuso da clinica:
 *
 * - manha: inicio <= 12:00;
 * - tarde: inicio > 12:00 e < 18:00;
 * - noite: inicio >= 18:00.
 *
 * "Na operacao padrao a Iris pergunta somente manha ou tarde. Noite e
 * compreendida e respeitada quando o paciente pedir explicitamente."
 */
export type Periodo = 'manha' | 'tarde' | 'noite';

/**
 * Restricao horaria declarada pelo paciente (secao 13). As DUAS intencoes
 * sao distintas e nunca equivalentes:
 *
 * - `inicio_ate` -- "antes das 11h": interpretacao INCLUSIVA pelo horario de
 *   inicio; `11:00` entra, e nao se exige termino ate 11:00;
 * - `termino_ate` -- "preciso terminar ate as 11h": so vale quando o
 *   paciente declarar explicitamente que precisa terminar/sair ate aquele
 *   horario; exige `fim <= minuto_min`.
 *
 * Qual das duas o paciente expressou e decisao da camada de interpretacao --
 * este gerador NUNCA infere a intencao, apenas aplica a que recebeu.
 */
export interface RestricaoHoraria {
  tipo: 'inicio_ate' | 'termino_ate';
  minuto_min: number;
}

/**
 * Modo da consulta. Modos distintos NUNCA se misturam na mesma chamada.
 *
 * `grade` cobre o pedido por data (com ou sem periodo, com ou sem restricao
 * horaria). A busca entre DIAS (secao 11: data especifica vs. proxima
 * disponibilidade) pertence ao controlador -- este gerador e estritamente
 * DIARIO e nunca atravessa datas.
 *
 * `proximo_disponivel` devolve o PRIMEIRO horario disponivel da data, em
 * qualquer periodo (secao 10, item 5). Nao aceita periodo nem restricao: se
 * aceitasse, deixaria de ser "o primeiro disponivel".
 */
export type ModoConsulta =
  | { tipo: 'grade'; periodo?: Periodo; restricao?: RestricaoHoraria }
  | { tipo: 'proximo_disponivel' }
  | { tipo: 'horario_exato'; horario_min: number };

/**
 * Instante oficial atual, ja traduzido para data civil + minuto local da
 * clinica pelo transporte. OBRIGATORIO: sem ele o gerador nao teria como
 * cumprir a secao 15 ("nunca oferecer horarios passados") e ofereceria
 * silenciosamente horario vencido -- exatamente a falha que o invariante
 * proibe. Torna-lo opcional seria falha ABERTA.
 *
 * O nucleo puro nao le relogio: `Date`, UTC e offset ficam no transporte.
 */
export interface InstanteAtual {
  data: string;
  minuto_min: number;
}

/**
 * Snapshot autorizado. Todas as identidades ja foram resolvidas pelos
 * componentes anteriores -- este gerador nunca resolve procedimento,
 * dentista ou duracao, e nunca aceita nome no lugar de identidade.
 */
export interface EntradaDisponibilidade {
  clinica_id: string;
  procedimento_id: string;
  dentista_id: string;
  data: string;
  fuso: string;
  duracao_min: number;
  jornadas: readonly JornadaDentista[];
  indisponiveis: readonly IntervaloIndisponivel[];
  modo: ModoConsulta;
  instante_atual: InstanteAtual;
}

/**
 * Opcao oficial de horario (secao 16).
 *
 * O "vinculo oficial do dentista com o procedimento" e o "contexto ou
 * revisao para detectar obsolescencia" que a secao 16 tambem lista NAO sao
 * produzidos aqui: o vinculo nao possui identidade propria em
 * `dentistas-vinculos-v1.md`, e a referencia de revisao e coberta pelo
 * estado da conversa e pelas versoes de escolha/resumo
 * (`persistencia-v1.md` secao 17). Ambos sao anexados pelo chamador.
 */
export interface OpcaoHorario {
  clinica_id: string;
  procedimento_id: string;
  dentista_id: string;
  data: string;
  fuso: string;
  duracao_min: number;
  inicio_min: number;
  fim_min: number;
}

/**
 * Motivo de configuracao invalida. Falha fechada -- nunca corrigida
 * silenciosamente, nunca compensada por fallback.
 */
export type MotivoConfiguracaoInvalida =
  /** Duracao fora do contrato de `duracao-v1.md` (inteira, 10..240, multipla de 10). */
  | 'duracao_invalida'
  /** Data civil ausente ou fora do formato `YYYY-MM-DD`, ou data inexistente no calendario. */
  | 'data_invalida'
  /** Fuso oficial da clinica ausente. */
  | 'fuso_invalido'
  /** Horario exato pedido fora do dominio `[0, 1440]`. */
  | 'horario_solicitado_invalido'
  /** Restricao horaria da secao 13 fora do dominio `[0, 1440]`. */
  | 'restricao_invalida'
  /** Instante oficial atual ausente, mal formado ou fora do dominio. */
  | 'instante_atual_invalido'
  /** Nenhuma jornada oficial para a clinica, o dentista e a data recebidos. */
  | 'sem_jornada';

/**
 * Coordenadas de um intervalo ofensor, para auditoria.
 *
 * Ambos os campos sao OPCIONAIS e cada um so aparece quando o valor recebido
 * e um numero finito. Qualquer outra coisa -- string, objeto, array,
 * booleano, `symbol`, `bigint`, funcao, `null`, `undefined`, `NaN`,
 * `Infinity`, `-Infinity` -- faz o campo ser OMITIDO.
 *
 * Omitir e a unica saida segura: o valor bruto poderia carregar PII e
 * nenhum substituto e aceitavel. `NaN` e infinito viram `null` no
 * `JSON.stringify` (perda silenciosa de informacao) e `bigint` faz o
 * `JSON.stringify` LANCAR; um marcador textual como `"invalido"` poluiria um
 * campo numerico. Por isso o resultado publico e sempre serializavel e faz
 * round-trip exato.
 */
export interface IntervaloOfensor {
  inicio_min?: number;
  fim_min?: number;
}

/** Codigos fechados de erro estrutural de intervalo. */
export type CodigoErroIntervalos =
  /** `inicio_min >= fim_min` -- nunca corrigido nem invertido silenciosamente. */
  | 'intervalo_invertido'
  /** Minuto fora do dominio `[0, 1440]`, ou intervalo que atravessaria a meia-noite. */
  | 'minuto_fora_do_dominio';

/**
 * Resultado tipado: exatamente uma das seis variantes previstas. Uniao
 * discriminada por `tipo`.
 */
export type ResultadoDisponibilidade =
  /** Modo `grade`: uma ou mais opcoes reais, ordenadas e deduplicadas. */
  | { tipo: 'opcoes'; opcoes: readonly OpcaoHorario[] }
  /** Nenhuma opcao real na data (e no periodo, quando informado). */
  | { tipo: 'sem_disponibilidade' }
  /** Modo `horario_exato`: o horario pedido cabe integralmente e esta livre. */
  | { tipo: 'horario_exato_disponivel'; opcao: OpcaoHorario }
  /**
   * Modo `horario_exato`: o horario pedido nao esta livre. Vizinhos reais
   * mais proximos (secao 9): "oferecer ambos quando existirem; somente um
   * quando existir apenas um". Ausentes quando nao houver vizinho valido.
   */
  | { tipo: 'horario_exato_indisponivel'; anterior?: OpcaoHorario; posterior?: OpcaoHorario }
  | { tipo: 'configuracao_invalida'; motivo: MotivoConfiguracaoInvalida }
  /**
   * Erro estrutural nos intervalos recebidos. Os intervalos ofensores sao
   * agregados e ordenados deterministicamente -- nunca o primeiro conforme
   * a ordem de entrada -- e carregam somente minutos finitos.
   */
  | { tipo: 'erro_intervalos'; codigo: CodigoErroIntervalos; intervalos: readonly IntervaloOfensor[] };
