// Gerador deterministico de disponibilidade.
//
// Contrato: specs/disponibilidade.md. Este arquivo NAO redefine nenhuma
// regra de geracao -- a grade vem inteira de `gerar-opcoes.ts` (secoes 5, 6
// e 7) e a sobreposicao vem inteira de `intervalo.ts` (secao 3).
//
// Funcao pura: nao chama IA, nao acessa banco, nao acessa Google Calendar,
// nao le relogio, nao altera estado e nao cria efeitos. Recebe jornadas,
// indisponibilidades, duracao e instante atual ja resolvidos e devolve
// resultado tipado.

import { EntradaInvalidaError } from './erros.ts';
import {
  MINUTO_MAXIMO,
  MINUTO_MINIMO,
  type EntradaDisponibilidade,
  type IntervaloMinutos,
  type IntervaloOfensor,
  type ModoConsulta,
  type OpcaoHorario,
  type Periodo,
  type RestricaoHoraria,
  type ResultadoDisponibilidade,
} from './disponibilidade-tipos.ts';
import { gerarIniciosDeIntervalos } from './gerar-opcoes.ts';
import { contido, minutoNoDominio, subtrairIntervalos, unirIntervalos } from './intervalo.ts';

/** Limites da secao 2 de `specs/duracao-v1.md`, revalidados aqui. */
const DURACAO_MINIMA_MIN = 10;
const DURACAO_MAXIMA_MIN = 240;
const BLOCO_MIN = 10;

/** Fronteiras dos periodos canonicos (secao 8), em minutos locais. */
const MEIO_DIA_MIN = 720;
const INICIO_NOITE_MIN = 1080;

/** Granularidade tecnica da busca por vizinhos (secao 9). */
const PASSO_VIZINHOS_MIN = 10;

/**
 * Resolve a disponibilidade de UM dentista em UMA data.
 *
 * Escopo estritamente DIARIO: a busca entre datas (secao 11 -- data
 * especifica que para vs. proxima disponibilidade que avanca) pertence ao
 * controlador, que chama esta funcao uma vez por data candidata. Nada aqui
 * atravessa datas, e nada aqui decide quando avancar.
 *
 * Escopo estritamente de UM dentista: "qualquer profissional" (secao 12)
 * significa uma chamada por dentista, com listas jamais misturadas. Esta
 * funcao nunca troca de dentista, de procedimento nem de clinica.
 *
 * Falha fechada: configuracao invalida ou intervalo estruturalmente quebrado
 * devolve resultado tipado -- nunca e corrigida em silencio, nunca vira
 * disponibilidade inventada.
 *
 * Lanca `EntradaInvalidaError` somente para violacao de contrato de forma da
 * entrada (tipo errado, chave desconhecida).
 */
export function resolverDisponibilidade(
  entrada: EntradaDisponibilidade
): ResultadoDisponibilidade {
  validarFormaEntrada(entrada);

  // --- Configuracao (ordem fixa, do escalar ao estrutural) ---

  if (!duracaoValida(entrada.duracao_min)) {
    return { tipo: 'configuracao_invalida', motivo: 'duracao_invalida' };
  }
  if (!dataCivilValida(entrada.data)) {
    return { tipo: 'configuracao_invalida', motivo: 'data_invalida' };
  }
  // O fuso nao e convertido aqui (o nucleo opera em minuto local), mas e
  // exigido porque toda opcao oficial precisa carrega-lo (secao 16).
  if (typeof entrada.fuso !== 'string' || entrada.fuso.trim() === '') {
    return { tipo: 'configuracao_invalida', motivo: 'fuso_invalido' };
  }
  if (entrada.modo.tipo === 'horario_exato' && !minutoNoDominio(entrada.modo.horario_min)) {
    return { tipo: 'configuracao_invalida', motivo: 'horario_solicitado_invalido' };
  }
  if (
    entrada.modo.tipo === 'grade' &&
    entrada.modo.restricao !== undefined &&
    !minutoNoDominio(entrada.modo.restricao.minuto_min)
  ) {
    return { tipo: 'configuracao_invalida', motivo: 'restricao_invalida' };
  }
  if (!instanteAtualValido(entrada)) {
    return { tipo: 'configuracao_invalida', motivo: 'instante_atual_invalido' };
  }

  // --- Escopo ---
  //
  // Isolamento por clinica + dentista + data ANTES de qualquer validacao
  // estrutural: jornada ou bloqueio de OUTRA clinica, de OUTRO dentista ou
  // de OUTRA data nunca influencia este resultado -- nem gerando opcao, nem
  // bloqueando horario, nem derrubando a consulta por estar quebrado.
  const jornadas = entrada.jornadas.filter((j) => noEscopo(j, entrada));
  const indisponiveis = entrada.indisponiveis.filter((i) => noEscopo(i, entrada));

  // Dia sem expediente NAO e defeito: e o resultado normal de perguntar por um
  // sabado que o profissional nao atende, ou por um domingo. Vem antes da
  // validacao estrutural porque nao ha nada de estrutural para validar -- nao
  // existe agenda nesse dia, e nunca deveria existir (2026-08-14).
  if (entrada.sem_expediente_no_dia !== null) {
    return { tipo: 'sem_expediente_no_dia', motivo: entrada.sem_expediente_no_dia };
  }

  // Ausencia estrutural de agenda e diferente de agenda cheia: sem jornada
  // oficial nao existe minuto livre algum a considerar (secao 3). Chegar aqui
  // com a lista vazia significa que o dia TINHA expediente previsto e a
  // configuracao nao foi legivel -- isso sim e defeito.
  if (jornadas.length === 0) {
    return { tipo: 'configuracao_invalida', motivo: 'sem_jornada' };
  }

  // --- Estrutura dos intervalos recebidos ---

  const erro = validarIntervalos([...jornadas, ...indisponiveis]);
  if (erro) return erro;

  // --- Intervalos livres (secao 3) ---
  //
  // Unir jornadas adjacentes primeiro: dois blocos contiguos formam um bloco
  // continuo e a grade nao pode reiniciar artificialmente no meio dele. Em
  // seguida subtrair almoco, bloqueios, agendamentos ativos e eventos
  // externos autorizados -- todos tratados de forma identica.
  const livres = subtrairIntervalos(unirIntervalos(jornadas), indisponiveis);

  switch (entrada.modo.tipo) {
    case 'grade':
      return resolverGrade(entrada, livres, entrada.modo);
    case 'proximo_disponivel':
      return resolverProximoDisponivel(entrada, livres);
    case 'horario_exato':
      return resolverHorarioExato(entrada, livres, entrada.modo.horario_min);
    default: {
      const _exaustivo: never = entrada.modo;
      return _exaustivo;
    }
  }
}

// --- Modos ---

/**
 * Modo `grade`: todas as opcoes geradas da data, filtradas por periodo e/ou
 * restricao horaria quando informados.
 *
 * O filtro e aplicado DEPOIS da geracao, nunca antes (secao 8: "apresentar
 * todos os horarios **gerados** e disponiveis daquele periodo"). Recortar o
 * intervalo livre pelo periodo antes de gerar mudaria o inicio real e o
 * ultimo inicio possivel, produzindo uma grade diferente da oficial.
 *
 * Sem cap de quatro opcoes, sem paginacao, sem truncamento e sem reordenacao
 * (secao 8 e invariantes).
 */
function resolverGrade(
  entrada: EntradaDisponibilidade,
  livres: readonly IntervaloMinutos[],
  modo: Extract<ModoConsulta, { tipo: 'grade' }>
): ResultadoDisponibilidade {
  const opcoes = gerarIniciosDeIntervalos(livres, entrada.duracao_min)
    .filter((inicio) => inicioNoFuturo(inicio, entrada))
    .map((inicio) => montarOpcao(entrada, inicio))
    .filter((opcao) => modo.periodo === undefined || periodoDe(opcao.inicio_min) === modo.periodo)
    .filter((opcao) => modo.restricao === undefined || atendeRestricao(opcao, modo.restricao));

  return opcoes.length > 0 ? { tipo: 'opcoes', opcoes } : { tipo: 'sem_disponibilidade' };
}

/**
 * Modo `proximo_disponivel`: o primeiro horario real da data, em QUALQUER
 * periodo (secao 10, item 5). Nao aplica filtro de periodo nem de restricao
 * -- se aplicasse, deixaria de ser "o primeiro disponivel".
 *
 * Devolver `sem_disponibilidade` aqui significa apenas "esta data nao tem
 * opcao": nunca "nao existe disponibilidade". A continuidade da busca e do
 * controlador (secao 11).
 */
function resolverProximoDisponivel(
  entrada: EntradaDisponibilidade,
  livres: readonly IntervaloMinutos[]
): ResultadoDisponibilidade {
  // A lista ja vem ordenada: o primeiro elemento sobrevivente e o menor
  // inicio canonico estritamente posterior ao instante atual.
  const inicios = gerarIniciosDeIntervalos(livres, entrada.duracao_min).filter((inicio) =>
    inicioNoFuturo(inicio, entrada)
  );
  if (inicios.length === 0) return { tipo: 'sem_disponibilidade' };
  return { tipo: 'opcoes', opcoes: [montarOpcao(entrada, inicios[0])] };
}

/**
 * Modo `horario_exato` (secao 9): a validacao e INDEPENDENTE da grade de
 * apresentacao. Basta que `[H, H + D)` caiba integralmente dentro de um
 * intervalo livre -- nunca se exige que `H` pertenca a grade hora a hora.
 */
function resolverHorarioExato(
  entrada: EntradaDisponibilidade,
  livres: readonly IntervaloMinutos[],
  horario_min: number
): ResultadoDisponibilidade {
  const alvo: IntervaloMinutos = {
    inicio_min: horario_min,
    fim_min: horario_min + entrada.duracao_min,
  };

  // Caber num intervalo livre nao basta: um horario vencido nunca e
  // oferecido, nem quando o paciente o pediu nominalmente (secao 15).
  if (inicioNoFuturo(horario_min, entrada) && livres.some((livre) => contido(alvo, livre))) {
    return { tipo: 'horario_exato_disponivel', opcao: montarOpcao(entrada, horario_min) };
  }

  // Vizinho tambem e oferta: a mesma regra estrita se aplica, entao nenhum
  // vizinho comeca antes do instante atual nem exatamente nele.
  const candidatos = candidatosVizinhos(livres, entrada.duracao_min).filter((c) =>
    inicioNoFuturo(c, entrada)
  );
  const anteriores = candidatos.filter((c) => c < horario_min);
  const posteriores = candidatos.filter((c) => c > horario_min);

  // "Oferecer ambos quando existirem; somente um quando existir apenas um."
  // Nenhum vizinho e inventado quando nao existe.
  const anterior =
    anteriores.length > 0 ? montarOpcao(entrada, anteriores[anteriores.length - 1]) : undefined;
  const posterior = posteriores.length > 0 ? montarOpcao(entrada, posteriores[0]) : undefined;

  return {
    tipo: 'horario_exato_indisponivel',
    ...(anterior !== undefined ? { anterior } : {}),
    ...(posterior !== undefined ? { posterior } : {}),
  };
}

/**
 * Candidatos tecnicos a vizinho (secao 9): granularidade de 10 minutos,
 * "incluindo adicionalmente o inicio real de cada intervalo e o ultimo
 * inicio possivel de cada intervalo".
 *
 * Deliberadamente NAO restrito a grade hora a hora: as alternativas podem
 * diferir por 10, 20, 30, 40, 50 ou 60 minutos. Todo candidato produzido
 * cabe integralmente em algum intervalo livre, por construcao (`m <= L`).
 */
function candidatosVizinhos(
  livres: readonly IntervaloMinutos[],
  duracao_min: number
): number[] {
  const candidatos: number[] = [];

  for (const livre of livres) {
    const ultimoInicio = livre.fim_min - duracao_min;
    if (ultimoInicio < livre.inicio_min) continue;

    candidatos.push(livre.inicio_min, ultimoInicio);

    const primeiroMultiplo =
      Math.ceil(livre.inicio_min / PASSO_VIZINHOS_MIN) * PASSO_VIZINHOS_MIN;
    for (let m = primeiroMultiplo; m <= ultimoInicio; m += PASSO_VIZINHOS_MIN) {
      candidatos.push(m);
    }
  }

  return [...new Set(candidatos)].sort((a, b) => a - b);
}

// --- Periodo e restricao ---

/**
 * Classificacao pelo HORARIO DE INICIO (secao 8): manha ate 12:00
 * inclusive, tarde depois de 12:00 e antes de 18:00, noite a partir de
 * 18:00. A duracao nunca reclassifica o periodo -- uma opcao que comeca as
 * 12:00 e de manha ainda que termine a tarde.
 */
function periodoDe(inicio_min: number): Periodo {
  if (inicio_min <= MEIO_DIA_MIN) return 'manha';
  if (inicio_min < INICIO_NOITE_MIN) return 'tarde';
  return 'noite';
}

/**
 * Aplica a restricao da secao 13. As duas intencoes NUNCA se confundem:
 * "antes das 11h" limita o INICIO e inclui 11:00; "preciso terminar ate as
 * 11h" limita o TERMINO.
 */
function atendeRestricao(opcao: OpcaoHorario, restricao: RestricaoHoraria): boolean {
  // `switch` exaustivo em vez de ternario: um ternario faria QUALQUER
  // discriminante desconhecido cair silenciosamente em `termino_ate`.
  // A validacao de forma ja rejeita esse caso; aqui a garantia e estrutural.
  switch (restricao.tipo) {
    case 'inicio_ate':
      return opcao.inicio_min <= restricao.minuto_min;
    case 'termino_ate':
      return opcao.fim_min <= restricao.minuto_min;
    default: {
      const _exaustivo: never = restricao.tipo;
      return _exaustivo;
    }
  }
}

// --- Passado (secao 15) ---

/**
 * Um inicio so pode ser oferecido quando e ESTRITAMENTE posterior ao
 * instante oficial atual (secao 15).
 *
 * O passado NAO e tratado como bloqueio administrativo: os intervalos livres
 * sao construidos so a partir de jornadas menos indisponibilidades reais, a
 * grade canonica e gerada intacta, e so entao os inicios vencidos sao
 * descartados. Recortar o intervalo antes de gerar transformaria o instante
 * presente num novo "inicio real" e criaria uma opcao que a grade oficial
 * nao contem -- com jornada 08:00–12:00, D40 e agora 09:15, produziria
 * `09:15, 10:00, 11:20` em vez de `10:00, 11:20`.
 *
 * A comparacao e estrita: um inicio exatamente igual ao instante atual e
 * descartado, porque a spec exige instantes POSTERIORES ao atual.
 *
 * Comparacao de datas por ordem lexicografica: com `YYYY-MM-DD` de largura
 * fixa (ja validado), ela coincide exatamente com a ordem cronologica, sem
 * `Date` nem fuso.
 */
function inicioNoFuturo(inicio_min: number, entrada: EntradaDisponibilidade): boolean {
  const { data, instante_atual } = entrada;

  if (data < instante_atual.data) return false;
  if (data > instante_atual.data) return true;
  return inicio_min > instante_atual.minuto_min;
}

// --- Opcao oficial ---

/**
 * Monta a opcao oficial (secao 16). O vinculo dentista/procedimento e a
 * referencia de revisao sao anexados pelo chamador -- ver a nota em
 * `disponibilidade-tipos.ts`.
 */
function montarOpcao(entrada: EntradaDisponibilidade, inicio_min: number): OpcaoHorario {
  return {
    clinica_id: entrada.clinica_id,
    procedimento_id: entrada.procedimento_id,
    dentista_id: entrada.dentista_id,
    data: entrada.data,
    fuso: entrada.fuso,
    duracao_min: entrada.duracao_min,
    inicio_min,
    fim_min: inicio_min + entrada.duracao_min,
  };
}

// --- Escopo ---

function noEscopo(
  registro: { clinica_id: string; dentista_id: string; data: string },
  entrada: EntradaDisponibilidade
): boolean {
  return (
    registro.clinica_id === entrada.clinica_id &&
    registro.dentista_id === entrada.dentista_id &&
    registro.data === entrada.data
  );
}

// --- Validacao estrutural dos intervalos ---

/**
 * Valida os intervalos JA filtrados pelo escopo, agregando TODOS os
 * ofensores antes de devolver.
 *
 * Duas garantias herdadas das correcoes 0145/0150/0155:
 *
 * 1. **nunca retornar no primeiro ofensor encontrado** -- isso tornaria o
 *    resultado dependente da ordem de entrada;
 * 2. **sanitizar antes de agregar** -- `inicio_min` e `fim_min` sao tipados
 *    como `number`, mas chegam de configuracao e podem ser qualquer coisa em
 *    runtime. Um valor nao finito (string, objeto, `NaN`, `Infinity`) e
 *    substituido por `NaN` no resultado publico: assim nenhum valor bruto
 *    vaza para fora e duas permutacoes da mesma entrada produzem resultado
 *    estruturalmente identico.
 *
 * `minuto_fora_do_dominio` tem precedencia sobre `intervalo_invertido`: sem
 * minutos validos, comparar inicio com fim nao significa nada.
 */
function validarIntervalos(
  intervalos: readonly IntervaloMinutos[]
): Extract<ResultadoDisponibilidade, { tipo: 'erro_intervalos' }> | null {
  const foraDoDominio = intervalos.filter(
    (i) => !minutoNoDominio(i.inicio_min) || !minutoNoDominio(i.fim_min)
  );
  if (foraDoDominio.length > 0) {
    return {
      tipo: 'erro_intervalos',
      codigo: 'minuto_fora_do_dominio',
      intervalos: ordenarOfensores(foraDoDominio),
    };
  }

  // A partir daqui todos os minutos sao inteiros dentro de `[0, 1440]` --
  // a comparacao abaixo e segura. Um intervalo que atravessaria a meia-noite
  // ja caiu no dominio acima; nunca e "corrigido" partindo-se em dois.
  const invertidos = intervalos.filter((i) => i.inicio_min >= i.fim_min);
  if (invertidos.length > 0) {
    return {
      tipo: 'erro_intervalos',
      codigo: 'intervalo_invertido',
      intervalos: ordenarOfensores(invertidos),
    };
  }

  return null;
}

/**
 * Ordena os ofensores de forma total e independente da ordem de entrada,
 * depois de omitir todo minuto inseguro. Nao deduplica: a quantidade de
 * registros quebrados e informacao de auditoria.
 *
 * A ordenacao compara `(presenca, valor)`: campo ausente vai por ultimo, e
 * todo valor presente e finito, entao a subtracao e sempre segura. Dois
 * ofensores que empatam em ambas as chaves sao objetos identicos -- por isso
 * duas permutacoes quaisquer da mesma entrada produzem exatamente o mesmo
 * array.
 */
function ordenarOfensores(intervalos: readonly IntervaloMinutos[]): IntervaloOfensor[] {
  return intervalos
    .map((intervalo) => montarOfensor(intervalo))
    .sort(
      (a, b) =>
        compararMinutoOpcional(a.inicio_min, b.inicio_min) ||
        compararMinutoOpcional(a.fim_min, b.fim_min)
    );
}

function compararMinutoOpcional(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

/**
 * Monta o detalhe de auditoria de UM intervalo ofensor, incluindo cada
 * coordenada SOMENTE quando ela e um numero finito. A chave e omitida (nunca
 * definida como `undefined`) para que o round-trip por JSON devolva
 * exatamente a mesma estrutura.
 */
function montarOfensor(intervalo: IntervaloMinutos): IntervaloOfensor {
  const inicio = minutoSeguro(intervalo.inicio_min);
  const fim = minutoSeguro(intervalo.fim_min);

  return {
    ...(inicio !== undefined ? { inicio_min: inicio } : {}),
    ...(fim !== undefined ? { fim_min: fim } : {}),
  };
}

/**
 * Fronteira de confianca runtime: devolve o valor apenas quando ele e um
 * numero finito; caso contrario `undefined`, e o campo some do resultado.
 *
 * Um minuto finito porem fora do dominio (`-30`, `1500`, `90.5`) E seguro e
 * viaja intacto -- e a configuracao real da clinica, sem PII, e util para o
 * diagnostico. O que nunca viaja e o valor de tipo errado.
 */
function minutoSeguro(valor: unknown): number | undefined {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : undefined;
}

// --- Validacao de configuracao escalar ---

/** Mesmo contrato de `duracao-v1.md` secao 2, revalidado na fronteira. */
function duracaoValida(valor: unknown): valor is number {
  return (
    typeof valor === 'number' &&
    Number.isInteger(valor) &&
    valor >= DURACAO_MINIMA_MIN &&
    valor <= DURACAO_MAXIMA_MIN &&
    valor % BLOCO_MIN === 0
  );
}

const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIAS_POR_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function anoBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

/**
 * Data civil `YYYY-MM-DD` existente no calendario. Sem `Date`: o construtor
 * do JavaScript aceita `2026-02-30` e desliza silenciosamente para marco, o
 * que produziria disponibilidade para um dia que nao existe.
 */
function dataCivilValida(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  const partes = FORMATO_DATA.exec(valor);
  if (!partes) return false;

  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);

  if (mes < 1 || mes > 12) return false;
  const limite = mes === 2 && anoBissexto(ano) ? 29 : DIAS_POR_MES[mes - 1];
  return dia >= 1 && dia <= limite;
}

function instanteAtualValido(entrada: EntradaDisponibilidade): boolean {
  const instante: unknown = entrada.instante_atual;
  if (instante === null || typeof instante !== 'object') return false;
  const { data, minuto_min } = instante as Record<string, unknown>;
  return dataCivilValida(data) && minutoNoDominio(minuto_min as number);
}

// --- Validacao de forma da entrada ---

const CHAVES_ENTRADA = [
  'clinica_id',
  'procedimento_id',
  'dentista_id',
  'data',
  'fuso',
  'duracao_min',
  'jornadas',
  'indisponiveis',
  'modo',
  'instante_atual',
  'sem_expediente_no_dia',
] as const;

const TIPOS_MODO: readonly string[] = ['grade', 'proximo_disponivel', 'horario_exato'];

// Contrato fechado de cada variante: chaves permitidas e chaves exigidas.
// Campo de uma variante presente em outra e propriedade nao permitida --
// `horario_min` num `grade`, `periodo` num `proximo_disponivel`, etc.
const CHAVES_MODO_GRADE: readonly string[] = ['tipo', 'periodo', 'restricao'];
const CHAVES_MODO_PROXIMO: readonly string[] = ['tipo'];
const CHAVES_MODO_EXATO: readonly string[] = ['tipo', 'horario_min'];
const CHAVES_RESTRICAO: readonly string[] = ['tipo', 'minuto_min'];

const PERIODOS: readonly string[] = ['manha', 'tarde', 'noite'];
const TIPOS_RESTRICAO: readonly string[] = ['inicio_ate', 'termino_ate'];

/**
 * Contrato fechado de um objeto de dominio: toda chave presente precisa ser
 * autorizada e toda chave exigida precisa existir.
 *
 * O nome da chave NAO AUTORIZADA nunca entra na mensagem -- poderia carregar
 * PII. O nome da chave FALTANTE entra, porque vem da nossa propria lista
 * fixa.
 */
function validarChavesFechadas(
  objeto: Record<string, unknown>,
  permitidas: readonly string[],
  obrigatorias: readonly string[],
  campo: string
): void {
  for (const chave of Object.keys(objeto)) {
    if (!permitidas.includes(chave)) {
      throw new EntradaInvalidaError(campo, `${campo} contem propriedade nao permitida`);
    }
  }
  for (const chave of obrigatorias) {
    if (!(chave in objeto)) {
      throw new EntradaInvalidaError(campo, `${campo} nao contem ${chave}`);
    }
  }
}

/**
 * Forma MINIMA de cada item de `jornadas` e `indisponiveis`: objeto, nao
 * nulo, nao array. Roda antes de qualquer leitura de propriedade.
 *
 * Sem esta barreira o filtro de escopo lia `item.clinica_id` direto e
 * falhava de duas maneiras distintas, ambas graves:
 *
 * 1. `null` e `undefined` estouravam em `TypeError` -- erro nao controlado,
 *    fora do contrato de resultados tipados;
 * 2. primitivo e array eram SILENCIOSAMENTE DESCARTADOS, porque acessar
 *    `clinica_id` neles devolve `undefined` e o item simplesmente nao
 *    casava com o escopo. Uma jornada quebrada virava `sem_jornada` e --
 *    pior -- uma INDISPONIBILIDADE quebrada desaparecia, devolvendo
 *    `opcoes` e oferecendo como livre um horario que deveria estar
 *    bloqueado.
 *
 * Um item sem estrutura minima nao tem identidade suficiente para ser
 * filtrado por clinica, dentista ou data: precisa falhar ANTES da selecao
 * de escopo, nunca ser classificado como "de outra clinica".
 *
 * A validacao para no primeiro item invalido, sem indice e sem valor -- o
 * mesmo padrao das demais checagens de forma deste arquivo. Isso torna o
 * erro identico para `[null, undefined]` e `[undefined, null]`.
 *
 * Coordenadas NAO sao avaliadas aqui: um objeto bem formado com minuto
 * invalido continua produzindo `erro_intervalos`, como ja aprovado.
 */
function validarItensDeColecao(itens: readonly unknown[], campo: string): void {
  for (const item of itens) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new EntradaInvalidaError(campo, `${campo} contem item que nao e um objeto`);
    }
  }
}

/**
 * Fronteira runtime da uniao discriminada `ModoConsulta`.
 *
 * Rejeita de forma controlada -- `EntradaInvalidaError`, nunca `TypeError`,
 * nunca queda silenciosa em outra variante e nunca `sem_disponibilidade`:
 * `null`, nao-objeto, array, `tipo` ausente, discriminante desconhecido,
 * propriedade adicional, campo obrigatorio ausente e campo pertencente a
 * outra variante.
 *
 * Valor bem formado porem fora do dominio (`horario_min = 1441`) NAO cai
 * aqui: e configuracao invalida, resultado tipado, como ja aprovado.
 */
function validarModo(modo: unknown): void {
  if (modo === null || typeof modo !== 'object' || Array.isArray(modo)) {
    throw new EntradaInvalidaError('modo', 'modo deve ser um objeto');
  }

  const bruto = modo as Record<string, unknown>;
  const tipo = bruto.tipo;
  if (typeof tipo !== 'string' || !TIPOS_MODO.includes(tipo)) {
    throw new EntradaInvalidaError('modo', 'modo.tipo deve ser um dos modos previstos');
  }

  switch (tipo) {
    case 'grade':
      validarChavesFechadas(bruto, CHAVES_MODO_GRADE, ['tipo'], 'modo');
      if (bruto.periodo !== undefined) validarPeriodo(bruto.periodo);
      if (bruto.restricao !== undefined) validarRestricao(bruto.restricao);
      return;

    case 'proximo_disponivel':
      validarChavesFechadas(bruto, CHAVES_MODO_PROXIMO, ['tipo'], 'modo');
      return;

    default:
      validarChavesFechadas(bruto, CHAVES_MODO_EXATO, ['tipo', 'horario_min'], 'modo');
      if (typeof bruto.horario_min !== 'number') {
        throw new EntradaInvalidaError('modo', 'modo.horario_min deve ser um numero');
      }
      return;
  }
}

/**
 * Periodo e uniao fechada de tres literais (secao 8). String runtime
 * arbitraria, vazia, numero, objeto e `null` sao rejeitados -- nunca viram
 * ausencia de opcoes, o que faria a Iris afirmar indisponibilidade por causa
 * de um erro de contrato.
 */
function validarPeriodo(periodo: unknown): void {
  if (typeof periodo !== 'string' || !PERIODOS.includes(periodo)) {
    throw new EntradaInvalidaError('modo', 'modo.periodo deve ser um dos periodos previstos');
  }
}

/**
 * Restricao horaria (secao 13). As chaves sao validadas ANTES do
 * discriminante para que uma restricao sem `tipo` falhe explicitamente, em
 * vez de assumir qualquer uma das duas intencoes.
 */
function validarRestricao(restricao: unknown): void {
  if (restricao === null || typeof restricao !== 'object' || Array.isArray(restricao)) {
    throw new EntradaInvalidaError('modo', 'modo.restricao deve ser um objeto');
  }

  const bruta = restricao as Record<string, unknown>;
  validarChavesFechadas(bruta, CHAVES_RESTRICAO, ['tipo', 'minuto_min'], 'modo');

  if (typeof bruta.tipo !== 'string' || !TIPOS_RESTRICAO.includes(bruta.tipo)) {
    throw new EntradaInvalidaError(
      'modo',
      'modo.restricao.tipo deve ser uma das restricoes previstas'
    );
  }
  if (typeof bruta.minuto_min !== 'number') {
    throw new EntradaInvalidaError('modo', 'modo.restricao.minuto_min deve ser um numero');
  }
}

/**
 * Contrato de forma. Nenhuma mensagem de erro reproduz valor recebido --
 * so nome de campo fixo (docs/03-seguranca.md).
 */
function validarFormaEntrada(entrada: unknown): asserts entrada is EntradaDisponibilidade {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new EntradaInvalidaError('entrada', 'entrada deve ser um objeto');
  }

  const chaves = Object.keys(entrada as Record<string, unknown>);
  const esperadas: readonly string[] = CHAVES_ENTRADA;
  if (chaves.length !== esperadas.length || !esperadas.every((chave) => chaves.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada contem propriedade nao permitida');
  }

  const bruta = entrada as Record<string, unknown>;

  // Identidades ja resolvidas pelos componentes anteriores: aqui so se
  // garante que existem. Nunca sao re-resolvidas a partir de texto, e nome
  // nunca substitui identidade.
  for (const campo of ['clinica_id', 'procedimento_id', 'dentista_id'] as const) {
    const valor = bruta[campo];
    if (typeof valor !== 'string' || valor.trim() === '') {
      throw new EntradaInvalidaError(campo, `${campo} deve ser uma string nao vazia`);
    }
  }

  if (!Array.isArray(bruta.jornadas)) {
    throw new EntradaInvalidaError('jornadas', 'jornadas deve ser um array');
  }
  validarItensDeColecao(bruta.jornadas, 'jornadas');

  if (!Array.isArray(bruta.indisponiveis)) {
    throw new EntradaInvalidaError('indisponiveis', 'indisponiveis deve ser um array');
  }
  validarItensDeColecao(bruta.indisponiveis, 'indisponiveis');

  validarSemExpediente(bruta.sem_expediente_no_dia, bruta.jornadas);

  validarModo(bruta.modo);
}

const MOTIVOS_SEM_EXPEDIENTE: readonly string[] = ['domingo', 'profissional_nao_atende'];

/**
 * Vocabulario FECHADO, e coerencia com `jornadas`.
 *
 * O marcador diz "nao ha expediente nessa data". Vir acompanhado de jornada e
 * entrada CONTRADITORIA -- as duas afirmacoes nao podem ser verdadeiras ao
 * mesmo tempo. Recusar e o unico desfecho correto: aceitar significaria usar o
 * marcador para ignorar a configuracao presente, que e como um dia com agenda
 * suja passaria a responder "nao atendemos" em vez de expor o defeito.
 *
 * Fail-closed, na mesma linha do resto deste validador: entrada incoerente
 * nunca vira resultado, vira erro.
 */
function validarSemExpediente(valor: unknown, jornadas: readonly unknown[]): void {
  if (valor === null) return;

  if (typeof valor !== 'string' || !MOTIVOS_SEM_EXPEDIENTE.includes(valor)) {
    throw new EntradaInvalidaError(
      'sem_expediente_no_dia',
      'sem_expediente_no_dia deve ser null, "domingo" ou "profissional_nao_atende"'
    );
  }

  if (jornadas.length > 0) {
    throw new EntradaInvalidaError(
      'sem_expediente_no_dia',
      'sem_expediente_no_dia exige jornadas vazias -- marcador de ausencia de expediente com jornada e contraditorio'
    );
  }
}
