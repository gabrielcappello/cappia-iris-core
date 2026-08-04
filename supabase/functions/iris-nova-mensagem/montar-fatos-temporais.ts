// Conversor minimo: dados_texto/periodo/horario_texto (ja extraidos pela IA
// como texto, formato de hoje em estado_conversa.dados) -> fatos temporais
// estruturados que resolverTemporal ja exige (temporal-tipos.ts,
// specs/resolvedor-temporal-v1.md secao 5).
//
// Escopo estritamente FECHADO aos seis casos simples autorizados: hoje,
// amanha, data explicita (DD/MM ou DD/MM/AAAA), manha, tarde, horario
// explicito (HH:MM ou HHh[MM]). Qualquer outro texto (dia da semana,
// "proxima semana", "depois das 15h", "assim que puder", etc.) NAO produz
// atomo -- nunca um palpite, nunca um atomo aproximado. Sem atomo de data,
// resolverTemporal ja devolve 'incompleto' (data_ausente/intencao_ausente)
// pelo caminho que ja existe, sem nenhuma alteracao la.
//
// Nao reimplementa nenhuma validacao de dominio (hora/minuto fora de
// faixa, data impossivel, etc.) -- so reconhece o formato e monta o atomo;
// resolverTemporal (nao alterado) valida tudo o resto.
//
// Este arquivo NAO substitui a IA emitindo atomos diretamente (que e o
// destino documentado em resolvedor-temporal-v1.md) -- e uma ponte
// deliberadamente minima para os casos simples, enquanto isso nao muda o
// contrato de extracao da IA (fora de escopo desta etapa).

import { normalizarTextoCanonico, textoAusenteParaResolucao } from './normalizacao-texto.ts';
import type { Periodo } from './disponibilidade-tipos.ts';
import type { AtomoTemporal } from './temporal-tipos.ts';

export interface DadosParaFatosTemporais {
  data_texto?: string;
  periodo?: string;
  horario_texto?: string;
}

const PERIODOS_VALIDOS: ReadonlySet<string> = new Set(['manha', 'tarde', 'noite']);

// DD/MM ou DD/MM/AAAA -- unico formato de data explicita reconhecido nesta
// fatia minima. Ano de 4 digitos ou ausente (nunca 2 digitos: resolverTemporal
// ja trata ano ausente/2-digitos com regras proprias, nao duplicadas aqui).
const REGEX_DATA_EXPLICITA = /^([0-9]{1,2})\/([0-9]{1,2})(?:\/([0-9]{4}))?$/;

// HH:MM ou HHh ou HHhMM -- formas explicitas simples. Nada com am/pm por
// extenso, nada relativo ("daqui a uma hora") -- fora de escopo.
const REGEX_HORARIO_HHMM = /^([0-9]{1,2}):([0-9]{2})$/;
const REGEX_HORARIO_H = /^([0-9]{1,2})h([0-9]{2})?$/;

/**
 * Monta a lista de fatos temporais para os seis casos simples autorizados.
 * Pura, deterministica, nunca lanca excecao por texto nao reconhecido --
 * texto fora do vocabulario fechado simplesmente nao produz atomo.
 */
export function montarFatosTemporais(dados: DadosParaFatosTemporais): AtomoTemporal[] {
  const atomos: AtomoTemporal[] = [];

  const atomoData = atomoDeDataTexto(dados.data_texto);
  if (atomoData) {
    atomos.push(atomoData);
    // Os seis casos simples autorizados sao todos de data especifica --
    // "assim que puder" (proxima_disponibilidade) fica fora desta fatia.
    atomos.push({ tipo: 'intencao', valor: 'data_especifica' });
  }

  if (typeof dados.periodo === 'string' && PERIODOS_VALIDOS.has(dados.periodo)) {
    atomos.push({ tipo: 'periodo', valor: dados.periodo as Periodo });
  }

  const atomoHorario = atomoDeHorarioTexto(dados.horario_texto);
  if (atomoHorario) atomos.push(atomoHorario);

  return atomos;
}

function atomoDeDataTexto(dataTexto: string | undefined): AtomoTemporal | null {
  if (textoAusenteParaResolucao(dataTexto)) return null;
  const normalizado = normalizarTextoCanonico(dataTexto as string);

  if (normalizado === 'hoje') return { tipo: 'data_relativa', valor: 'hoje' };
  if (normalizado === 'amanha') return { tipo: 'data_relativa', valor: 'amanha' };

  const partes = REGEX_DATA_EXPLICITA.exec(normalizado);
  if (!partes) return null;
  return {
    tipo: 'data_absoluta',
    dia: Number(partes[1]),
    mes: Number(partes[2]),
    ano: partes[3] !== undefined ? Number(partes[3]) : null,
  };
}

function atomoDeHorarioTexto(horarioTexto: string | undefined): AtomoTemporal | null {
  if (textoAusenteParaResolucao(horarioTexto)) return null;
  const normalizado = normalizarTextoCanonico(horarioTexto as string);

  const doisPontos = REGEX_HORARIO_HHMM.exec(normalizado);
  if (doisPontos) {
    return montarAtomoHorario(Number(doisPontos[1]), Number(doisPontos[2]));
  }

  const comH = REGEX_HORARIO_H.exec(normalizado);
  if (comH) {
    return montarAtomoHorario(Number(comH[1]), comH[2] !== undefined ? Number(comH[2]) : 0);
  }

  return null;
}

function montarAtomoHorario(hora: number, minuto: number): AtomoTemporal {
  return { tipo: 'horario_exato', forma: 'horario_24h', hora, minuto, parte_dia: null };
}
