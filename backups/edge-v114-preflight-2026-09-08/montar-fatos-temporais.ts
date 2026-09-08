// Conversor minimo: dados_texto/periodo/horario_texto (ja extraidos pela IA
// como texto, formato de hoje em estado_conversa.dados) -> fatos temporais
// estruturados que resolverTemporal ja exige (temporal-tipos.ts,
// specs/resolvedor-temporal-v1.md secao 5).
//
// Escopo FECHADO aos casos autorizados: hoje, amanha, DIA DA SEMANA
// (2026-08-17 -- "quarta", "quarta-feira", "proxima quarta", "quarta que
// vem"), data explicita (DD/MM ou DD/MM/AAAA), manha, tarde, horario
// explicito (HH:MM ou HHh[MM]). Qualquer outro texto ("proxima semana",
// "depois das 15h", "assim que puder", etc.) NAO produz atomo -- nunca um
// palpite, nunca um atomo aproximado. Sem atomo de data, resolverTemporal ja
// devolve 'incompleto' (data_ausente/intencao_ausente) pelo caminho que ja
// existe, sem nenhuma alteracao la.
//
// O dia da semana entrou porque a ausencia dele quebrava conversa real: o
// paciente pediu "quarta-feira 15hrs" e a Iris ficou pedindo a data em
// quatro turnos seguidos. `resolverTemporal` sempre soube resolver
// `dia_semana` -- so faltava reconhecer o texto aqui.
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
import type { AtomoTemporal, DiaDaSemana, QualificadorDiaSemana } from './temporal-tipos.ts';

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

// SO O DIA -- "20", "dia 20", "no dia 20" (2026-08-17). O mes fica `null` e
// `resolverTemporal` o resolve como a proxima ocorrencia daquele dia.
//
// Defeito real: a Iris propos "quinta-feira, dia 20/08", o paciente confirmou
// com "sim dia 20", e a interpretadora gravou `data_texto: "20"`. Como o Core
// so entendia `DD/MM`, a data se perdia e ele perguntava "para qual data?"
// logo depois de te-la anunciado.
//
// Ate 31 apenas: numero maior nao e dia de mes nenhum e nao vira palpite.
const REGEX_DIA_SOZINHO = /^(?:(?:no|na|para|pra|pro|em)\s+)?(?:o\s+)?(?:dia\s+)?([0-9]{1,2})$/;

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

/**
 * Dia da semana -> atomo (2026-08-17).
 *
 * Defeito real medido em conversa: o paciente pediu remarcacao para
 * "quarta-feira 15hrs". "quarta-feira" nao produzia atomo NENHUM, a resolucao
 * caia em `incompleto`, e a Iris pedia a data de novo -- quatro turnos, com o
 * paciente repetindo "falei que sim, quantas vezes vai perguntar". A propria
 * IA tinha entendido (respondeu "quarta-feira, dia 19/08?"), mas o Core nao.
 *
 * `resolverTemporal` JA sabe resolver `dia_semana` (temporal-tipos.ts,
 * `AtomoDiaSemana`) -- inclusive o qualificador `esta`/`proxima` e a
 * ambiguidade quando ele falta. Nada de novo foi criado no resolvedor: o que
 * faltava era so o reconhecimento do texto aqui.
 *
 * Aceita as formas que uma pessoa escreve: com e sem "-feira", com e sem
 * acento (o texto ja vem normalizado), e "sabado"/"domingo" sozinhos.
 */
const DIAS_DA_SEMANA: ReadonlyMap<string, DiaDaSemana> = new Map([
  ['domingo', 'domingo'],
  ['segunda', 'segunda'],
  ['terca', 'terca'],
  ['quarta', 'quarta'],
  ['quinta', 'quinta'],
  ['sexta', 'sexta'],
  ['sabado', 'sabado'],
]);

/**
 * Remove o sufixo "feira" -- exato OU um erro de digitacao proximo dele --
 * com hifen OU com espaco.
 *
 * A primeira versao (2026-08-17) cadastrou so a forma com hifen
 * (`sexta-feira`) e a forma curta (`sexta`). Em conversa real o paciente
 * escreveu "sexta feira", com espaco -- que nao casava com nenhuma das duas,
 * e a Iris voltou a pedir a data em dois turnos seguidos. Como as duas
 * grafias sao igualmente comuns, o sufixo passou a ser removido em vez de
 * enumerado.
 *
 * ERRO DE DIGITACAO (2026-08-22): paciente real escreveu "segunda feria"
 * (letras trocadas -- "feria" em vez de "feira"). O texto e preservado
 * exatamente como veio ate aqui, por instrucao deliberada da IA
 * (interpretacao-instrucoes.ts nao corrige o paciente) -- sem tolerancia
 * aqui, o sufixo nao casava, `atomoDeDataTexto` devolvia `null`, e o Core
 * concluia "nenhuma data foi dita" para quem tinha acabado de dizer a data.
 *
 * TOLERANCIA POR DISTANCIA DE EDICAO, nunca lista de variacoes previstas
 * (decisao do Gabriel, 2026-08-22 -- uma lista fixa so cobre o erro que
 * alguem catalogou, nunca o proximo erro real que aparecer). A ULTIMA
 * palavra do texto (depois de separar por espaco/hifen) e comparada contra
 * "feira" por distancia de Levenshtein; ate 2 edicoes (trocar, inserir ou
 * remover uma letra) e tratada como o mesmo sufixo e removida. O NUCLEO do
 * dia (`segunda`, `terca`...) nunca passa por essa tolerancia -- so o
 * sufixo, que e sempre a mesma palavra e nao muda qual dia e; tolerar erro
 * no nucleo arriscaria confundir um dia com outro.
 */
function semSufixoFeira(texto: string): string {
  const partes = texto.split(/[\s-]+/);
  if (partes.length < 2) return texto;
  const ultima = partes[partes.length - 1]!;
  if (distanciaEdicao(ultima, 'feira') > 2) return texto;
  return partes.slice(0, -1).join(' ').trim();
}

/**
 * Distancia de Levenshtein classica (numero minimo de insercoes, remocoes
 * ou substituicoes de UM caractere para transformar `a` em `b`). Programacao
 * dinamica O(n*m), suficiente para palavras curtas como "feira".
 */
function distanciaEdicao(a: string, b: string): number {
  const linhas = a.length + 1;
  const colunas = b.length + 1;
  const matriz: number[][] = Array.from({ length: linhas }, () => new Array<number>(colunas).fill(0));

  for (let i = 0; i < linhas; i++) matriz[i]![0] = i;
  for (let j = 0; j < colunas; j++) matriz[0]![j] = j;

  for (let i = 1; i < linhas; i++) {
    for (let j = 1; j < colunas; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      matriz[i]![j] = Math.min(
        matriz[i - 1]![j]! + 1, // remocao
        matriz[i]![j - 1]! + 1, // insercao
        matriz[i - 1]![j - 1]! + custo // substituicao
      );
    }
  }

  return matriz[linhas - 1]![colunas - 1]!;
}

/**
 * Qualificador, quando o paciente o diz junto ("proxima quarta", "quarta que
 * vem"). Sem qualificador o atomo vai com `null` e quem decide e
 * `resolverTemporal` -- nunca um palpite aqui.
 */
function separarQualificador(texto: string): { qualificador: QualificadorDiaSemana | null; resto: string } {
  const semQueVem = texto.replace(/\s+que\s+vem$/, '').trim();
  if (semQueVem !== texto) return { qualificador: 'proxima', resto: semQueVem };

  const comPrefixo = /^(esta|essa|nesta|nessa|proxima|proximo)\s+(.+)$/.exec(texto);
  if (comPrefixo !== null) {
    const bruto = comPrefixo[1];
    return {
      qualificador: bruto === 'proxima' || bruto === 'proximo' ? 'proxima' : 'esta',
      resto: comPrefixo[2].trim(),
    };
  }
  return { qualificador: null, resto: texto };
}

function atomoDeDataTexto(dataTexto: string | undefined): AtomoTemporal | null {
  if (textoAusenteParaResolucao(dataTexto)) return null;
  const normalizado = normalizarTextoCanonico(dataTexto as string);

  if (normalizado === 'hoje') return { tipo: 'data_relativa', valor: 'hoje' };
  if (normalizado === 'amanha') return { tipo: 'data_relativa', valor: 'amanha' };

  // Dia da semana, com ou sem qualificador.
  const { qualificador, resto } = separarQualificador(normalizado);
  const dia = DIAS_DA_SEMANA.get(semSufixoFeira(resto));
  if (dia !== undefined) return { tipo: 'dia_semana', dia, qualificador };

  const partes = REGEX_DATA_EXPLICITA.exec(normalizado);
  if (partes !== null) {
    return {
      tipo: 'data_absoluta',
      dia: Number(partes[1]),
      mes: Number(partes[2]),
      ano: partes[3] !== undefined ? Number(partes[3]) : null,
    };
  }

  // So o dia: mes e ano ficam a cargo de `resolverTemporal` (proxima
  // ocorrencia). Dia fora de 1..31 nao produz atomo -- nunca um palpite.
  const soDia = REGEX_DIA_SOZINHO.exec(normalizado);
  if (soDia !== null) {
    const dia = Number(soDia[1]);
    if (dia >= 1 && dia <= 31) return { tipo: 'data_absoluta', dia, mes: null, ano: null };
  }

  return null;
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
