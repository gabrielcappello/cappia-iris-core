// Carregador minimo: busca no banco somente os dados que
// resolver-disponibilidade.ts precisa (specs/disponibilidade.md) para UM
// dentista, UMA data. Nao decide nada de dominio -- so traduz o schema real
// (jornada semanal recorrente em clinicas.dentistas, bloqueios em
// horarios_bloqueados, reservas em agendamentos) para o contrato ja
// aprovado. Chama resolverDuracao (ja pronto) para a duracao e devolve o
// objeto pronto para resolverDisponibilidade (ja pronto) -- nenhum dos dois
// e alterado aqui.
//
// Fora de escopo, por decisao explicita: modo 'manual' (descartado),
// remarcacao/cancelamento, confirmacao, geracao de resposta ao paciente.
// Domingo nunca tem jornada (nenhuma clinica atende) -- nao e erro, e
// ausencia esperada, coberta pelo resultado 'sem_jornada' que
// resolverDisponibilidade ja produz para jornada vazia.

import { EntradaInvalidaError } from './erros.ts';
import { resolverDuracao } from './resolver-duracao.ts';
import { resolverDisponibilidade } from './resolver-disponibilidade.ts';
import type { ConfiguracaoDuracao, ResultadoResolucaoDuracao } from './duracao-tipos.ts';
import type {
  MotivoSemExpediente,
  EntradaDisponibilidade,
  InstanteAtual,
  IntervaloIndisponivel,
  JornadaDentista,
  ModoConsulta,
  ResultadoDisponibilidade,
} from './disponibilidade-tipos.ts';
import type { ClienteBancoDados } from './tipos.ts';

export interface EntradaCarregarDisponibilidade {
  clinica_id: string;
  dentista_id: string;
  procedimento_id: string;
  data: string;
  instante_atual: InstanteAtual;
  modo: ModoConsulta;
}

export type ResultadoCarregarDisponibilidade =
  | { tipo: 'carregado'; entrada: EntradaDisponibilidade; resultado: ResultadoDisponibilidade }
  | { tipo: 'clinica_nao_encontrada' }
  | { tipo: 'dentista_nao_encontrado' }
  | { tipo: 'duracao_nao_resolvida'; resultado: ResultadoResolucaoDuracao };

/**
 * Busca jornada (a partir do template semanal do dentista), bloqueios e
 * agendamentos confirmados do dia, resolve a duracao (via resolverDuracao,
 * ja pronto) e chama resolverDisponibilidade (ja pronto) com o resultado.
 * Falha fechada em qualquer ausencia: dado malformado ou ausente nunca vira
 * jornada inventada, so "sem disponibilidade" pelo caminho ja existente do
 * resolvedor.
 */
export async function carregarEntradaDisponibilidade(
  cliente: ClienteBancoDados,
  entrada: EntradaCarregarDisponibilidade
): Promise<ResultadoCarregarDisponibilidade> {
  validarFormaEntrada(entrada);

  const clinica = await buscarClinica(cliente, entrada.clinica_id);
  if (!clinica) return { tipo: 'clinica_nao_encontrada' };

  const dentista = encontrarDentista(clinica.dentistas, entrada.dentista_id);
  if (!dentista) return { tipo: 'dentista_nao_encontrado' };

  const configuracoes = configuracoesDuracao(
    entrada.clinica_id,
    entrada.dentista_id,
    entrada.procedimento_id,
    dentista
  );
  const resultadoDuracao = resolverDuracao({
    clinica_id: entrada.clinica_id,
    dentista_id: entrada.dentista_id,
    procedimento_id: entrada.procedimento_id,
    configuracoes,
  });
  if (resultadoDuracao.tipo !== 'resolvida') {
    return { tipo: 'duracao_nao_resolvida', resultado: resultadoDuracao };
  }

  const resultadoJornadas = construirJornadas(entrada.clinica_id, entrada.dentista_id, entrada.data, dentista);
  const jornadas = resultadoJornadas.tipo === 'expediente' ? resultadoJornadas.jornadas : [];
  const almoco = construirAlmoco(entrada.clinica_id, entrada.dentista_id, entrada.data, dentista);
  const bloqueios = await buscarBloqueios(cliente, entrada.clinica_id, entrada.dentista_id, entrada.data);
  const agendamentos = await buscarAgendamentosConfirmados(
    cliente,
    entrada.clinica_id,
    entrada.dentista_id,
    entrada.data
  );

  const entradaDisponibilidade: EntradaDisponibilidade = {
    clinica_id: entrada.clinica_id,
    procedimento_id: entrada.procedimento_id,
    dentista_id: entrada.dentista_id,
    data: entrada.data,
    fuso: clinica.fuso_horario,
    duracao_min: resultadoDuracao.duracao_min,
    jornadas,
    sem_expediente_no_dia: resultadoJornadas.tipo === 'sem_expediente_no_dia' ? resultadoJornadas.motivo : null,
    indisponiveis: [...almoco, ...bloqueios, ...agendamentos],
    modo: entrada.modo,
    instante_atual: entrada.instante_atual,
  };

  return {
    tipo: 'carregado',
    entrada: entradaDisponibilidade,
    resultado: resolverDisponibilidade(entradaDisponibilidade),
  };
}

// --- Clinica + dentista (clinicas.dentistas, jsonb) ---

interface ClinicaCarregada {
  dentistas: unknown;
  fuso_horario: string;
}

async function buscarClinica(cliente: ClienteBancoDados, clinicaId: string): Promise<ClinicaCarregada | null> {
  const { data, error } = await cliente
    .from('clinicas')
    .select('dentistas, fuso_horario')
    .eq('id', clinicaId)
    .maybeSingle();

  if (error) throw new Error(`falha ao buscar clinica: ${error.message}`);
  if (!data) return null;

  const fuso = (data as Record<string, unknown>).fuso_horario;
  if (typeof fuso !== 'string' || fuso.trim() === '') return null;

  return { dentistas: (data as Record<string, unknown>).dentistas, fuso_horario: fuso };
}

// Forma real observada em producao (clinicas.dentistas[i]): id, modo
// ('auto'|'procedimento' -- 'manual' descartado por decisao do Gabriel,
// tratado aqui como configuracao ausente se aparecer), inicio/fim (seg-sex),
// sabado (bool) + sab_ini/sab_fim, alm_ini/alm_fim, dur (modo auto),
// procedimentos[] com {id, tempo, ativo} (modo procedimento). Sem campo de
// domingo -- nenhuma clinica atende, tratado como jornada sempre vazia.
//
// dias_semana (specs/dias-atendimento-dentista-v1.md): liga/desliga cada dia
// de segunda a sexta individualmente SO para a oferta automatica da Iris.
// Campo ou chave ausente = true (compat com dentista cadastrado antes desta
// mudanca). Nao afeta sabado/domingo nem o agendamento manual -- este
// carregador so alimenta resolverDisponibilidade, nunca a rota manual.
interface DiasSemanaConfig {
  seg?: unknown;
  ter?: unknown;
  qua?: unknown;
  qui?: unknown;
  sex?: unknown;
}

interface DentistaCarregado {
  modo: unknown;
  inicio: unknown;
  fim: unknown;
  dias_semana: unknown;
  sabado: unknown;
  sab_ini: unknown;
  sab_fim: unknown;
  alm_ini: unknown;
  alm_fim: unknown;
  dur: unknown;
  procedimentos: unknown;
}

function encontrarDentista(dentistasBrutos: unknown, dentistaId: string): DentistaCarregado | null {
  if (!Array.isArray(dentistasBrutos)) return null;
  const registro = dentistasBrutos.find(
    (d) => d !== null && typeof d === 'object' && (d as Record<string, unknown>).id === dentistaId
  ) as Record<string, unknown> | undefined;
  if (!registro || registro.ativo !== true) return null;

  return {
    modo: registro.modo,
    inicio: registro.inicio,
    fim: registro.fim,
    dias_semana: registro.dias_semana,
    sabado: registro.sabado,
    sab_ini: registro.sab_ini,
    sab_fim: registro.sab_fim,
    alm_ini: registro.alm_ini,
    alm_fim: registro.alm_fim,
    dur: registro.dur,
    procedimentos: registro.procedimentos,
  };
}

// dia local 0=segunda .. 4=sexta -> chave em dias_semana. Ausencia da chave,
// do objeto inteiro, ou valor que nao seja booleano estrito = dia ativo
// (mesma regra de compat que o resto do carregador aplica a campos novos).
const CHAVE_DIA_SEMANA: Record<number, keyof DiasSemanaConfig> = {
  0: 'seg',
  1: 'ter',
  2: 'qua',
  3: 'qui',
  4: 'sex',
};

function diaUtilAtivo(dentista: DentistaCarregado, diaSemana: number): boolean {
  const config = dentista.dias_semana;
  if (config === null || typeof config !== 'object') return true;
  const chave = CHAVE_DIA_SEMANA[diaSemana];
  const valor = (config as Record<string, unknown>)[chave];
  return valor !== false;
}

// --- Duracao (alimenta resolverDuracao, ja pronto -- nunca reimplementado) ---

function configuracoesDuracao(
  clinicaId: string,
  dentistaId: string,
  procedimentoId: string,
  dentista: DentistaCarregado
): ConfiguracaoDuracao[] {
  if (dentista.modo === 'auto') {
    if (typeof dentista.dur !== 'number') return [];
    return [{ clinica_id: clinicaId, dentista_id: dentistaId, procedimento_id: procedimentoId, duracao_min: dentista.dur }];
  }

  if (dentista.modo === 'procedimento') {
    if (!Array.isArray(dentista.procedimentos)) return [];
    const item = dentista.procedimentos.find(
      (p) =>
        p !== null &&
        typeof p === 'object' &&
        (p as Record<string, unknown>).id === procedimentoId &&
        (p as Record<string, unknown>).ativo === true
    ) as Record<string, unknown> | undefined;
    if (!item || typeof item.tempo !== 'number') return [];
    return [
      { clinica_id: clinicaId, dentista_id: dentistaId, procedimento_id: procedimentoId, duracao_min: item.tempo },
    ];
  }

  // modo 'manual' ou qualquer valor desconhecido: sem configuracao --
  // resolverDuracao devolve nao_configurada, nunca um valor inventado.
  return [];
}

// --- Jornada do dia (template semanal -> UM dia concreto) ---

/**
 * Lista vazia dizia duas coisas OPOSTAS: "o profissional nao atende nesse dia"
 * (normal) e "a configuracao esta ilegivel" (defeito). O resolvedor nao tinha
 * como separar as duas, e as duas viravam falha tecnica para o paciente
 * (caso real do sabado 15/08/2026). O motivo agora viaja junto.
 */
type ResultadoJornadas =
  | { tipo: 'expediente'; jornadas: JornadaDentista[] }
  | { tipo: 'sem_expediente_no_dia'; motivo: MotivoSemExpediente }
  | { tipo: 'configuracao_ilegivel' };

function construirJornadas(
  clinicaId: string,
  dentistaId: string,
  data: string,
  dentista: DentistaCarregado
): ResultadoJornadas {
  const diaSemana = diaDaSemanaLocal(data);
  // Data que nao vira dia da semana e defeito, nunca "nao atende".
  if (diaSemana === null) return { tipo: 'configuracao_ilegivel' };

  // 0=segunda .. 6=domingo (mesma convencao de resolver-temporal.ts,
  // reimplementada aqui isoladamente -- ver nota de rodape do arquivo).
  if (diaSemana === 6) return { tipo: 'sem_expediente_no_dia', motivo: 'domingo' };

  let inicio: unknown;
  let fim: unknown;
  if (diaSemana === 5) {
    if (dentista.sabado !== true) return { tipo: 'sem_expediente_no_dia', motivo: 'profissional_nao_atende' };
    inicio = dentista.sab_ini;
    fim = dentista.sab_fim;
  } else {
    if (!diaUtilAtivo(dentista, diaSemana)) return { tipo: 'sem_expediente_no_dia', motivo: 'profissional_nao_atende' };
    inicio = dentista.inicio;
    fim = dentista.fim;
  }

  const inicioMin = minutosDeHHMM(inicio);
  const fimMin = minutosDeHHMM(fim);
  // Aqui o dia TEM expediente previsto -- o horario e que esta ilegivel.
  if (inicioMin === null || fimMin === null) return { tipo: 'configuracao_ilegivel' };

  return {
    tipo: 'expediente',
    jornadas: [{ clinica_id: clinicaId, dentista_id: dentistaId, data, inicio_min: inicioMin, fim_min: fimMin }],
  };
}

function construirAlmoco(
  clinicaId: string,
  dentistaId: string,
  data: string,
  dentista: DentistaCarregado
): IntervaloIndisponivel[] {
  const inicioMin = minutosDeHHMM(dentista.alm_ini);
  const fimMin = minutosDeHHMM(dentista.alm_fim);
  if (inicioMin === null || fimMin === null) return [];

  return [
    {
      clinica_id: clinicaId,
      dentista_id: dentistaId,
      data,
      inicio_min: inicioMin,
      fim_min: fimMin,
      origem: 'almoco',
    },
  ];
}

// --- Bloqueios (horarios_bloqueados, tabela real) ---

async function buscarBloqueios(
  cliente: ClienteBancoDados,
  clinicaId: string,
  dentistaId: string,
  data: string
): Promise<IntervaloIndisponivel[]> {
  // Bloqueio do dentista especifico E bloqueio geral da clinica (dentista_id
  // null, ex.: feriado) contam os dois. ConsultaEncadeavel (tipos.ts) nao
  // expressa OR -- duas consultas, cada uma ja escopada por clinica_id
  // (achado do Codex: painel grava dentista_id null para bloqueio de
  // clinica inteira, e .eq('dentista_id', dentistaId) nunca casa com NULL,
  // entao esses bloqueios ficavam invisiveis para a Iris).
  const [especifico, geral] = await Promise.all([
    cliente
      .from('horarios_bloqueados')
      .select('data_inicio, data_fim, horario_inicio, horario_fim')
      .eq('clinica_id', clinicaId)
      .eq('dentista_id', dentistaId),
    cliente
      .from('horarios_bloqueados')
      .select('data_inicio, data_fim, horario_inicio, horario_fim')
      .eq('clinica_id', clinicaId)
      .is('dentista_id', null),
  ]);

  if (especifico.error) throw new Error(`falha ao buscar bloqueios: ${especifico.error.message}`);
  if (geral.error) throw new Error(`falha ao buscar bloqueios: ${geral.error.message}`);

  const resultado: IntervaloIndisponivel[] = [];
  for (const linha of [...(especifico.data ?? []), ...(geral.data ?? [])]) {
    const l = linha as Record<string, unknown>;
    const dataInicio = l.data_inicio;
    const dataFim = l.data_fim;
    if (typeof dataInicio !== 'string' || typeof dataFim !== 'string') continue;
    // Fora do escopo (data anterior/posterior ao intervalo bloqueado):
    // ignorado. Comparacao lexicografica em YYYY-MM-DD == ordem cronologica.
    if (data < dataInicio || data > dataFim) continue;

    // Dentro do intervalo bloqueado: o dia da consulta pode ser o primeiro,
    // o ultimo, ou um dia inteiramente no meio de um bloqueio multi-dia --
    // cada caso usa a janela de minutos que realmente se aplica a ESTE dia.
    let inicioMin = 0;
    let fimMin = 1440;
    if (data === dataInicio) {
      const m = minutosDeHHMM(l.horario_inicio);
      if (m !== null) inicioMin = m;
    }
    if (data === dataFim) {
      const m = minutosDeHHMM(l.horario_fim);
      if (m !== null) fimMin = m;
    }
    if (inicioMin >= fimMin) continue; // estrutura invalida: nunca bloco invertido.

    resultado.push({
      clinica_id: clinicaId,
      dentista_id: dentistaId,
      data,
      inicio_min: inicioMin,
      fim_min: fimMin,
      origem: 'bloqueio',
    });
  }
  return resultado;
}

// --- Agendamentos confirmados (agendamentos, tabela real) ---
//
// Mesmo criterio de ocupacao que cappia_reservar_agendamento ja usa em
// producao (specs/iris-v3/08-auditoria-rpcs-sql.md): so status='confirmado'
// ocupa horario. remarcado/cancelado/concluido/faltou nunca bloqueiam.

async function buscarAgendamentosConfirmados(
  cliente: ClienteBancoDados,
  clinicaId: string,
  dentistaId: string,
  data: string
): Promise<IntervaloIndisponivel[]> {
  const { data: linhas, error } = await cliente
    .from('agendamentos')
    .select('horario, duracao_min')
    .eq('clinica_id', clinicaId)
    .eq('dentista_id', dentistaId)
    .eq('data', data)
    .eq('status', 'confirmado');

  if (error) throw new Error(`falha ao buscar agendamentos: ${error.message}`);

  const resultado: IntervaloIndisponivel[] = [];
  for (const linha of linhas ?? []) {
    const l = linha as Record<string, unknown>;
    const inicioMin = minutosDeHHMM(l.horario);
    const duracao = l.duracao_min;
    if (inicioMin === null || typeof duracao !== 'number') continue; // sem duracao gravada: nao entra como bloqueio inventado.

    resultado.push({
      clinica_id: clinicaId,
      dentista_id: dentistaId,
      data,
      inicio_min: inicioMin,
      fim_min: inicioMin + duracao,
      origem: 'agendamento',
    });
  }
  return resultado;
}

// --- Auxiliares puros ---

function minutosDeHHMM(valor: unknown): number | null {
  if (typeof valor !== 'string') return null;
  const partes = /^([0-9]{1,2}):([0-9]{2})$/.exec(valor);
  if (!partes) return null;
  const hora = Number(partes[1]);
  const minuto = Number(partes[2]);
  if (hora < 0 || hora > 23 || minuto < 0 || minuto > 59) return null;
  return hora * 60 + minuto;
}

// Dia da semana civil (0=segunda .. 6=domingo) por calculo puro -- sem
// `Date`. Mesmo algoritmo (Howard Hinnant, days_from_civil) usado por
// resolver-temporal.ts; reimplementado aqui, isolado, porque este arquivo
// nao pode alterar nenhum dos 4 resolvedores ja prontos (a funcao de origem
// nao e exportada de la).
function diaDaSemanaLocal(data: string): number | null {
  const partes = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(data);
  if (!partes) return null;
  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);

  const y = mes <= 2 ? ano - 1 : ano;
  const era = Math.floor(y / 400);
  const anoDaEra = y - era * 400;
  const diaDoAno = Math.floor((153 * (mes + (mes > 2 ? -3 : 9)) + 2) / 5) + dia - 1;
  const diaDaEra = anoDaEra * 365 + Math.floor(anoDaEra / 4) - Math.floor(anoDaEra / 100) + diaDoAno;
  const dias = era * 146097 + diaDaEra - 719468;
  // Formula original produz 0=quinta..6=quarta (epoca unix); deslocada aqui
  // para a convencao do projeto (0=segunda..6=domingo).
  return (((dias + 3) % 7) + 7) % 7;
}

// --- Validacao de forma da entrada ---

const CHAVES_ENTRADA = ['clinica_id', 'dentista_id', 'procedimento_id', 'data', 'instante_atual', 'modo'] as const;

function validarFormaEntrada(entrada: unknown): asserts entrada is EntradaCarregarDisponibilidade {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new EntradaInvalidaError('entrada', 'entrada deve ser um objeto');
  }
  const chaves = Object.keys(entrada as Record<string, unknown>);
  const esperadas: readonly string[] = CHAVES_ENTRADA;
  if (chaves.length !== esperadas.length || !esperadas.every((chave) => chaves.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada contem propriedade nao permitida');
  }

  const { clinica_id, dentista_id, procedimento_id, data } = entrada as Record<string, unknown>;
  if (typeof clinica_id !== 'string' || clinica_id.trim() === '') {
    throw new EntradaInvalidaError('clinica_id', 'clinica_id deve ser uma string nao vazia');
  }
  if (typeof dentista_id !== 'string' || dentista_id.trim() === '') {
    throw new EntradaInvalidaError('dentista_id', 'dentista_id deve ser uma string nao vazia');
  }
  if (typeof procedimento_id !== 'string' || procedimento_id.trim() === '') {
    throw new EntradaInvalidaError('procedimento_id', 'procedimento_id deve ser uma string nao vazia');
  }
  if (typeof data !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(data)) {
    throw new EntradaInvalidaError('data', 'data deve estar no formato YYYY-MM-DD');
  }
}
