// JSON Schema e validação runtime de forma do contrato `ResultadoIris`
// (specs/contexto-conversacional-unificado-v2.md, aprovada por Gabriel em
// 2026-08-15 -- aprovação CONDICIONADA, spec §15; tipos aprovados pelo Codex).
//
// SOMENTE ESTRUTURAL, SEM LIGAÇÃO COM PRODUÇÃO. Nenhuma função deste arquivo é
// chamada por qualquer decisão de atendimento, escrita em `estado_conversa` ou
// pela redatora -- não é importado por nenhum módulo de `src/core/` além dos
// seus próprios testes.
//
// PURO: sem I/O, sem relógio, sem rede. Todo o resultado é derivado da saída
// recebida.
//
// O QUE ESTE VALIDADOR NÃO FAZ, DE PROPÓSITO:
// - não normaliza nem completa saída inválida -- qualquer defeito de forma é
//   recusado inteiro, nunca corrigido em silêncio (mesmo princípio de
//   `guarda-contexto-unificado.ts`);
// - não implementa a regra M2 (spec §6: alternativa fora das ofertadas exige
//   `data` explícita) -- é regra CONTEXTUAL, depende do que foi oferecido no
//   turno, e este módulo só valida forma;
// - não valida fatos de turno (`agendamento_em_remarcacao`,
//   `agendamento_a_cancelar`, spec §8) -- pertencem à próxima etapa;
// - não valida existência/pertencimento de nenhum ID (`dentista_ids`,
//   `procedimento_id`, `agendamento_id`) contra catálogo, clínica ou paciente
//   -- é responsabilidade do Core (spec §5), não deste validador estrutural.

import type { Acao, Alternativa, CampoResultadoIris, Informacao, ResultadoIris } from './resultado-iris-tipos.ts';
import type { PerguntaPendente } from './contexto-unificado-tipos.ts';

// ── JSON SCHEMA ──────────────────────────────────────────────────────────────
// Espelha exatamente `resultado-iris-tipos.ts`, incluindo os dois ramos de
// `confirmar` (spec §2, invariante de `agendamento_id`) -- o schema não aceita
// a combinação inválida nem estruturalmente, antes mesmo da validação runtime.

const ALTERNATIVA_SCHEMA = {
  type: 'object',
  properties: {
    data: { type: ['string', 'null'] },
    horario: { type: ['string', 'null'] },
    periodo: { type: ['string', 'null'], enum: ['manha', 'tarde', 'noite', null] },
  },
  required: ['data', 'horario', 'periodo'],
  additionalProperties: false,
} as const;

const INFORMACAO_SCHEMA = {
  type: 'object',
  properties: {
    campo: { type: 'string', enum: ['nome', 'cpf', 'data_nascimento', 'email'] },
    operacao: { type: 'string', enum: ['informou', 'corrigiu'] },
    valor: { type: ['string', 'null'] },
  },
  required: ['campo', 'operacao', 'valor'],
  additionalProperties: false,
} as const;

function acaoSchema(tipoLiteral: string, propriedades: Record<string, unknown>, obrigatorios: string[]) {
  return {
    type: 'object',
    properties: { tipo: { type: 'string', enum: [tipoLiteral] }, ...propriedades },
    required: ['tipo', ...obrigatorios],
    additionalProperties: false,
  } as const;
}

const DENTISTA_IDS_NULAVEL_SCHEMA = {
  anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
} as const;

const ALTERNATIVAS_ARRAY_SCHEMA = { type: 'array', items: ALTERNATIVA_SCHEMA } as const;

const ACOES_SCHEMAS = [
  acaoSchema('conversar', { objetivo: { type: 'string', enum: ['cumprimentar', 'responder_duvida', 'conversa_geral'] } }, [
    'objetivo',
  ]),
  acaoSchema('desistir', {}, []),
  acaoSchema(
    'consultar_disponibilidade',
    {
      procedimento_id: { type: ['string', 'null'] },
      dentista_ids: DENTISTA_IDS_NULAVEL_SCHEMA,
      alternativas: ALTERNATIVAS_ARRAY_SCHEMA,
    },
    ['procedimento_id', 'dentista_ids', 'alternativas']
  ),
  acaoSchema('consultar_agendamento', { agendamento_id: { type: ['string', 'null'] } }, ['agendamento_id']),
  acaoSchema(
    'pedir_agendamento',
    {
      procedimento_id: { type: ['string', 'null'] },
      dentista_ids: DENTISTA_IDS_NULAVEL_SCHEMA,
      alternativas: ALTERNATIVAS_ARRAY_SCHEMA,
    },
    ['procedimento_id', 'dentista_ids', 'alternativas']
  ),
  // dentista_ids aceita [] (spec §5) -- nenhum minItems.
  acaoSchema('escolher_dentista', { dentista_ids: { type: 'array', items: { type: 'string' } } }, ['dentista_ids']),
  acaoSchema(
    'escolher_horario',
    { referencia: { type: 'string' }, operacao: { type: 'string', enum: ['criar', 'remarcar'] } },
    ['referencia', 'operacao']
  ),
  // Dois ramos (spec §2) -- `criar` nunca aceita agendamento_id não nulo;
  // `remarcar`/`cancelar` exigem string. Ver validarInvariantesConfirmar
  // abaixo para a checagem runtime equivalente sobre valor já decodificado.
  acaoSchema('confirmar', { operacao: { type: 'string', enum: ['criar'] }, agendamento_id: { type: 'null' } }, [
    'operacao',
    'agendamento_id',
  ]),
  acaoSchema(
    'confirmar',
    { operacao: { type: 'string', enum: ['remarcar', 'cancelar'] }, agendamento_id: { type: 'string' } },
    ['operacao', 'agendamento_id']
  ),
  acaoSchema('aceitar_oferta', { procedimento_id: { type: 'string' } }, ['procedimento_id']),
  // Nunca aciona efeito por si só (spec §4).
  acaoSchema('cancelar', { agendamento_id: { type: ['string', 'null'] } }, ['agendamento_id']),
  acaoSchema(
    'remarcar',
    { agendamento_id: { type: ['string', 'null'] }, alternativas: ALTERNATIVAS_ARRAY_SCHEMA },
    ['agendamento_id', 'alternativas']
  ),
];

/**
 * Schema estrito de `ResultadoIris` (spec §2). Objeto único e plano na raiz
 * -- Structured Outputs não aceita `anyOf`/`oneOf` como schema de nível
 * superior, só dentro de `properties`. `tipo`, `acao` e
 * `informacoes_fornecidas` estão SEMPRE presentes em `required`; `acao`
 * aceita `null` (via `anyOf` interno, permitido dentro de uma propriedade)
 * para representar `tipo: 'nao_compreendida'`.
 *
 * A correlação "acao nunca é null quando tipo é compreendida" não é
 * expressável aqui sem duplicar o objeto inteiro por tipo -- é
 * responsabilidade de `validarResultadoIris` (checagem runtime, abaixo).
 *
 * `additionalProperties: false` em todo nível -- nenhuma propriedade
 * desconhecida passa, nem no envelope, nem em `Acao`, nem em
 * `Alternativa`/`Informacao`.
 */
export const RESULTADO_IRIS_SCHEMA = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: ['compreendida', 'nao_compreendida'] },
    acao: { anyOf: [...ACOES_SCHEMAS, { type: 'null' }] },
    informacoes_fornecidas: { type: 'array', items: INFORMACAO_SCHEMA },
  },
  required: ['tipo', 'acao', 'informacoes_fornecidas'],
  additionalProperties: false,
} as const;

// ── VALIDAÇÃO RUNTIME RECURSIVA, A PARTIR DE `unknown` ──────────────────────
//
// NENHUMA função abaixo recebe `Acao`, `Informacao` ou `ResultadoIris` como
// parâmetro de entrada, e NENHUMA faz cast (`as Tipo`) sobre dado externo --
// isso seria confiar que o JSON já bate com o tipo TS, exatamente o que este
// validador existe para checar. A entrada é sempre `unknown`; cada função
// devolve um resultado discriminado (`ValidacaoOk<T> | ValidacaoErro`) e só
// produz o tipo de saída DEPOIS de confirmar sua forma em runtime, campo a
// campo. Nenhuma função lança -- entrada arbitrariamente malformada (string,
// número, array, `undefined`, objeto com chaves extras, profundamente
// aninhado ou circular) sempre devolve `{ ok: false }`, nunca uma exceção.

export interface ValidacaoErro {
  ok: false;
  erro: string;
}

export interface ValidacaoOk<T> {
  ok: true;
  valor: T;
}

export type Validacao<T> = ValidacaoOk<T> | ValidacaoErro;

function erro(mensagem: string): ValidacaoErro {
  return { ok: false, erro: mensagem };
}

function ok<T>(valor: T): ValidacaoOk<T> {
  return { ok: true, valor };
}

function ehObjetoSimples(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Recusa qualquer chave fora de `permitidas` -- equivalente runtime de `additionalProperties: false`. */
function checarChavesDesconhecidas(objeto: Record<string, unknown>, permitidas: readonly string[]): string | null {
  const desconhecidas = Object.keys(objeto).filter((chave) => !permitidas.includes(chave));
  if (desconhecidas.length > 0) {
    return `propriedade desconhecida: ${desconhecidas.join(', ')}`;
  }
  return null;
}

function checarStringNaoVazia(valor: unknown, campo: string): Validacao<string> {
  if (typeof valor !== 'string') return erro(`${campo}: esperado string, recebido ${tipoDescrito(valor)}`);
  if (valor.trim() === '') return erro(`${campo}: string vazia é sempre inválida`);
  return ok(valor);
}

function checarStringOuNull(valor: unknown, campo: string): Validacao<string | null> {
  if (valor === null) return ok(null);
  return checarStringNaoVazia(valor, campo);
}

function tipoDescrito(valor: unknown): string {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return 'array';
  return typeof valor;
}

const CAMPOS_INFORMACAO_VALIDOS: readonly CampoResultadoIris[] = ['nome', 'cpf', 'data_nascimento', 'email'];

/**
 * Valida uma `Informacao` a partir de `unknown` (spec §2, mesma regra de
 * forma de v1 §4): objeto simples, sem chave extra, `campo` num vocabulário
 * fechado, `operacao` em `informou | corrigiu`, string vazia sempre
 * inválida, `informou` exige valor não vazio, `corrigiu` aceita valor não
 * vazio ou `null`.
 */
export function validarInformacao(entrada: unknown): Validacao<Informacao> {
  if (!ehObjetoSimples(entrada)) {
    return erro(`informacao: esperado objeto, recebido ${tipoDescrito(entrada)}`);
  }
  const chaves = checarChavesDesconhecidas(entrada, ['campo', 'operacao', 'valor']);
  if (chaves !== null) return erro(`informacao: ${chaves}`);

  const { campo, operacao, valor } = entrada;
  if (typeof campo !== 'string' || !CAMPOS_INFORMACAO_VALIDOS.includes(campo as CampoResultadoIris)) {
    return erro(`informacao.campo: valor desconhecido -- ${JSON.stringify(campo)}`);
  }
  if (operacao !== 'informou' && operacao !== 'corrigiu') {
    return erro(`informacao.operacao: valor desconhecido -- ${JSON.stringify(operacao)}`);
  }
  if (valor !== null && typeof valor !== 'string') {
    return erro(`informacao.valor: esperado string ou null, recebido ${tipoDescrito(valor)}`);
  }
  if (valor !== null && valor.trim() === '') {
    return erro(`${campo}: string vazia é sempre inválida -- use null para remover`);
  }
  if (operacao === 'informou' && valor === null) {
    return erro(`${campo}: informou exige valor não vazio, nunca null`);
  }

  return ok({ campo: campo as CampoResultadoIris, operacao, valor });
}

/** Valida uma `Alternativa` a partir de `unknown`. Nenhuma regra semântica (M2) -- só forma. */
export function validarAlternativa(entrada: unknown): Validacao<Alternativa> {
  if (!ehObjetoSimples(entrada)) {
    return erro(`alternativa: esperado objeto, recebido ${tipoDescrito(entrada)}`);
  }
  const chaves = checarChavesDesconhecidas(entrada, ['data', 'horario', 'periodo']);
  if (chaves !== null) return erro(`alternativa: ${chaves}`);

  const data = checarStringOuNull(entrada.data, 'alternativa.data');
  if (!data.ok) return data;
  const horario = checarStringOuNull(entrada.horario, 'alternativa.horario');
  if (!horario.ok) return horario;

  const periodo = entrada.periodo;
  if (periodo !== null && periodo !== 'manha' && periodo !== 'tarde' && periodo !== 'noite') {
    return erro(`alternativa.periodo: valor desconhecido -- ${JSON.stringify(periodo)}`);
  }

  return ok({ data: data.valor, horario: horario.valor, periodo });
}

/** Valida um array de `Alternativa` a partir de `unknown`, aplicando o mínimo por ação (ver `validarAcao`). */
function validarAlternativas(entrada: unknown, contexto: string): Validacao<readonly Alternativa[]> {
  if (!Array.isArray(entrada)) {
    return erro(`${contexto}.alternativas: esperado array, recebido ${tipoDescrito(entrada)}`);
  }
  const resultado: Alternativa[] = [];
  for (let i = 0; i < entrada.length; i++) {
    const item = validarAlternativa(entrada[i]);
    if (!item.ok) return erro(`${contexto}.alternativas[${i}]: ${item.erro}`);
    resultado.push(item.valor);
  }
  return ok(resultado);
}

function validarDentistaIdsNulavel(entrada: unknown, contexto: string): Validacao<readonly string[] | null> {
  if (entrada === null) return ok(null);
  if (!Array.isArray(entrada)) {
    return erro(`${contexto}.dentista_ids: esperado array ou null, recebido ${tipoDescrito(entrada)}`);
  }
  const resultado: string[] = [];
  for (let i = 0; i < entrada.length; i++) {
    const item = entrada[i];
    if (typeof item !== 'string') {
      return erro(`${contexto}.dentista_ids[${i}]: esperado string, recebido ${tipoDescrito(item)}`);
    }
    resultado.push(item);
  }
  return ok(resultado);
}

/**
 * Valida uma `Acao` a partir de `unknown` -- dispatch por `tipo`, sem
 * nenhuma suposição sobre os demais campos até confirmá-los um a um. Cobre
 * na mesma passada: forma de cada campo, chaves desconhecidas por ramo, a
 * invariante de `confirmar.agendamento_id` (spec §2) e a cardinalidade de
 * `alternativas` por ação (desenho aprovado, 2026-08-15):
 * `consultar_disponibilidade` exige ao menos 1; `pedir_agendamento` e
 * `remarcar` aceitam `[]`; nenhum máximo é aplicado. Nenhuma regra M2 nem
 * validação semântica de campo interno de `Alternativa`.
 */
export function validarAcao(entrada: unknown): Validacao<Acao> {
  if (!ehObjetoSimples(entrada)) {
    return erro(`acao: esperado objeto, recebido ${tipoDescrito(entrada)}`);
  }
  const tipo = entrada.tipo;
  if (typeof tipo !== 'string') {
    return erro(`acao.tipo: esperado string, recebido ${tipoDescrito(tipo)}`);
  }

  switch (tipo) {
    case 'conversar': {
      const erroChaves = checarChavesDesconhecidas(entrada, ['tipo', 'objetivo']);
      if (erroChaves !== null) return erro(`acao(conversar): ${erroChaves}`);
      const objetivo = entrada.objetivo;
      if (objetivo !== 'cumprimentar' && objetivo !== 'responder_duvida' && objetivo !== 'conversa_geral') {
        return erro(`acao(conversar).objetivo: valor desconhecido -- ${JSON.stringify(objetivo)}`);
      }
      return ok({ tipo, objetivo });
    }
    case 'desistir': {
      const erroChaves = checarChavesDesconhecidas(entrada, ['tipo']);
      if (erroChaves !== null) return erro(`acao(desistir): ${erroChaves}`);
      return ok({ tipo });
    }
    case 'consultar_disponibilidade':
    case 'pedir_agendamento': {
      const erroChaves = checarChavesDesconhecidas(entrada, [
        'tipo',
        'procedimento_id',
        'dentista_ids',
        'alternativas',
      ]);
      if (erroChaves !== null) return erro(`acao(${tipo}): ${erroChaves}`);
      const procedimentoId = checarStringOuNull(entrada.procedimento_id, `acao(${tipo}).procedimento_id`);
      if (!procedimentoId.ok) return procedimentoId;
      const dentistaIds = validarDentistaIdsNulavel(entrada.dentista_ids, `acao(${tipo})`);
      if (!dentistaIds.ok) return dentistaIds;
      const alternativas = validarAlternativas(entrada.alternativas, `acao(${tipo})`);
      if (!alternativas.ok) return alternativas;
      if (tipo === 'consultar_disponibilidade' && alternativas.valor.length === 0) {
        return erro('acao(consultar_disponibilidade): exige ao menos 1 alternativa');
      }
      return ok({
        tipo,
        procedimento_id: procedimentoId.valor,
        dentista_ids: dentistaIds.valor,
        alternativas: alternativas.valor,
      });
    }
    case 'consultar_agendamento': {
      const erroChaves = checarChavesDesconhecidas(entrada, ['tipo', 'agendamento_id']);
      if (erroChaves !== null) return erro(`acao(consultar_agendamento): ${erroChaves}`);
      const agendamentoId = checarStringOuNull(entrada.agendamento_id, 'acao(consultar_agendamento).agendamento_id');
      if (!agendamentoId.ok) return agendamentoId;
      return ok({ tipo, agendamento_id: agendamentoId.valor });
    }
    case 'escolher_dentista': {
      const erroChaves = checarChavesDesconhecidas(entrada, ['tipo', 'dentista_ids']);
      if (erroChaves !== null) return erro(`acao(escolher_dentista): ${erroChaves}`);
      if (!Array.isArray(entrada.dentista_ids)) {
        return erro(`acao(escolher_dentista).dentista_ids: esperado array, recebido ${tipoDescrito(entrada.dentista_ids)}`);
      }
      const dentistaIds: string[] = [];
      for (let i = 0; i < entrada.dentista_ids.length; i++) {
        const item = entrada.dentista_ids[i];
        if (typeof item !== 'string') {
          return erro(`acao(escolher_dentista).dentista_ids[${i}]: esperado string, recebido ${tipoDescrito(item)}`);
        }
        dentistaIds.push(item);
      }
      return ok({ tipo, dentista_ids: dentistaIds });
    }
    case 'escolher_horario': {
      const erroChaves = checarChavesDesconhecidas(entrada, ['tipo', 'referencia', 'operacao']);
      if (erroChaves !== null) return erro(`acao(escolher_horario): ${erroChaves}`);
      const referencia = checarStringNaoVazia(entrada.referencia, 'acao(escolher_horario).referencia');
      if (!referencia.ok) return referencia;
      const operacao = entrada.operacao;
      if (operacao !== 'criar' && operacao !== 'remarcar') {
        return erro(`acao(escolher_horario).operacao: valor desconhecido -- ${JSON.stringify(operacao)}`);
      }
      return ok({ tipo, referencia: referencia.valor, operacao });
    }
    case 'confirmar': {
      const erroChaves = checarChavesDesconhecidas(entrada, ['tipo', 'operacao', 'agendamento_id']);
      if (erroChaves !== null) return erro(`acao(confirmar): ${erroChaves}`);
      const operacao = entrada.operacao;
      if (operacao !== 'criar' && operacao !== 'remarcar' && operacao !== 'cancelar') {
        return erro(`acao(confirmar).operacao: valor desconhecido -- ${JSON.stringify(operacao)}`);
      }
      const agendamentoId = entrada.agendamento_id;
      if (agendamentoId !== null && typeof agendamentoId !== 'string') {
        return erro(`acao(confirmar).agendamento_id: esperado string ou null, recebido ${tipoDescrito(agendamentoId)}`);
      }
      // Invariante spec §2: `criar` nunca carrega agendamento_id não nulo;
      // `remarcar`/`cancelar` sempre exigem um.
      if (operacao === 'criar') {
        if (agendamentoId !== null) return erro('acao(confirmar/criar): nunca carrega agendamento_id não nulo');
        return ok({ tipo, operacao, agendamento_id: null });
      }
      if (agendamentoId === null || agendamentoId.trim() === '') {
        return erro(`acao(confirmar/${operacao}): exige agendamento_id não nulo e não vazio`);
      }
      return ok({ tipo, operacao, agendamento_id: agendamentoId });
    }
    case 'aceitar_oferta': {
      const erroChaves = checarChavesDesconhecidas(entrada, ['tipo', 'procedimento_id']);
      if (erroChaves !== null) return erro(`acao(aceitar_oferta): ${erroChaves}`);
      const procedimentoId = checarStringNaoVazia(entrada.procedimento_id, 'acao(aceitar_oferta).procedimento_id');
      if (!procedimentoId.ok) return procedimentoId;
      return ok({ tipo, procedimento_id: procedimentoId.valor });
    }
    case 'cancelar': {
      const erroChaves = checarChavesDesconhecidas(entrada, ['tipo', 'agendamento_id']);
      if (erroChaves !== null) return erro(`acao(cancelar): ${erroChaves}`);
      const agendamentoId = checarStringOuNull(entrada.agendamento_id, 'acao(cancelar).agendamento_id');
      if (!agendamentoId.ok) return agendamentoId;
      return ok({ tipo, agendamento_id: agendamentoId.valor });
    }
    case 'remarcar': {
      const erroChaves = checarChavesDesconhecidas(entrada, ['tipo', 'agendamento_id', 'alternativas']);
      if (erroChaves !== null) return erro(`acao(remarcar): ${erroChaves}`);
      const agendamentoId = checarStringOuNull(entrada.agendamento_id, 'acao(remarcar).agendamento_id');
      if (!agendamentoId.ok) return agendamentoId;
      const alternativas = validarAlternativas(entrada.alternativas, 'acao(remarcar)');
      if (!alternativas.ok) return alternativas;
      return ok({ tipo, agendamento_id: agendamentoId.valor, alternativas: alternativas.valor });
    }
    default:
      return erro(`acao.tipo: valor desconhecido -- ${JSON.stringify(tipo)}`);
  }
}

/**
 * Valida um `ResultadoIris` a partir de `unknown` -- ponto de entrada único
 * para dado que ainda não foi checado (ex.: `JSON.parse` de uma resposta de
 * modelo). Não confia em nenhum cast: cada campo é confirmado em runtime
 * antes de compor o valor de saída.
 *
 * Regras cobertas, todas por checagem de valor (o schema estrito da seção
 * acima já recusa formato grosseiro quando usado via Structured Outputs, mas
 * este validador não depende disso -- vale para qualquer `unknown`):
 * - objeto simples, sem chave desconhecida no envelope;
 * - `tipo` em `compreendida | nao_compreendida`;
 * - `acao` nunca é `null` quando `tipo: 'compreendida'`, e é validada como
 *   `Acao` nesse caso;
 * - `tipo: 'nao_compreendida'` exige `acao: null` **e**
 *   `informacoes_fornecidas: []` -- uma saída não compreendida nunca declara
 *   fato extraído (união discriminada, `resultado-iris-tipos.ts`);
 * - `informacoes_fornecidas` é sempre array, cada item validado.
 *
 * Nunca normaliza, nunca completa, nunca lança -- qualquer defeito de forma,
 * em qualquer profundidade, é recusado inteiro (mesmo princípio de
 * `guarda-contexto-unificado.ts`).
 */
export function validarResultadoIris(entrada: unknown): Validacao<ResultadoIris> {
  if (!ehObjetoSimples(entrada)) {
    return erro(`resultado: esperado objeto, recebido ${tipoDescrito(entrada)}`);
  }
  const erroChaves = checarChavesDesconhecidas(entrada, ['tipo', 'acao', 'informacoes_fornecidas']);
  if (erroChaves !== null) return erro(`resultado: ${erroChaves}`);

  const tipo = entrada.tipo;
  if (tipo !== 'compreendida' && tipo !== 'nao_compreendida') {
    return erro(`resultado.tipo: valor desconhecido -- ${JSON.stringify(tipo)}`);
  }

  const informacoesEntrada = entrada.informacoes_fornecidas;
  if (!Array.isArray(informacoesEntrada)) {
    return erro(`resultado.informacoes_fornecidas: esperado array, recebido ${tipoDescrito(informacoesEntrada)}`);
  }
  const informacoes: Informacao[] = [];
  for (let i = 0; i < informacoesEntrada.length; i++) {
    const item = validarInformacao(informacoesEntrada[i]);
    if (!item.ok) return erro(`resultado.informacoes_fornecidas[${i}]: ${item.erro}`);
    informacoes.push(item.valor);
  }

  if (tipo === 'nao_compreendida') {
    if (entrada.acao !== null) {
      return erro('resultado(nao_compreendida): acao deve ser null');
    }
    if (informacoes.length > 0) {
      return erro('resultado(nao_compreendida): informacoes_fornecidas deve ser vazia');
    }
    return ok({ tipo, acao: null, informacoes_fornecidas: [] });
  }

  if (entrada.acao === null) {
    return erro('resultado(compreendida): acao nunca é null');
  }
  const acao = validarAcao(entrada.acao);
  if (!acao.ok) return erro(`resultado.acao: ${acao.erro}`);

  return ok({ tipo, acao: acao.valor, informacoes_fornecidas: informacoes });
}

// ── `aguardando_resposta` -- validação da COLUNA lida do banco ──────────────

const TIPOS_PERGUNTA_PENDENTE: readonly PerguntaPendente['tipo'][] = [
  'escolha_dentista',
  'escolha_horario',
  'confirmacao',
  'oferta_procedimento',
  'troca_telefone',
  'escolha_agendamento',
  'confirmacao_nome',
  'cadastro',
];

/**
 * UM ÚNICO CAMPO `operacao` (spec v2 §7 item 2 e §14.3), com os valores
 * aceitos definidos pelo CONTEXTO -- o `tipo` da pergunta --, nunca por um
 * segundo campo:
 *
 * - `escolha_agendamento` -- "qual agendamento, e para quê": `consultar` é
 *   legítimo (não produz efeito) e `criar` não cabe (não se escolhe entre
 *   agendamentos existentes para criar um novo);
 * - `confirmacao` -- "você autoriza este efeito": `criar` cabe e `consultar`
 *   NÃO, porque consulta não é efeito e nunca é confirmada.
 *
 * A separação que importa é preservada pelo par (`tipo`, `operacao`): um
 * `consultar` continua sem valer como confirmação, e `criar` continua
 * exprimível -- sem duplicar a chave que a RPC de commit lê.
 */
const OPERACOES_POR_TIPO: Partial<
  Record<PerguntaPendente['tipo'], readonly NonNullable<PerguntaPendente['operacao']>[]>
> = {
  escolha_agendamento: ['consultar', 'remarcar', 'cancelar'],
  confirmacao: ['criar', 'remarcar', 'cancelar'],
};

/** Únicos `tipo` que admitem `agendamento_id` (spec v2 §7 item 3 e §14.3). */
const TIPOS_COM_AGENDAMENTO_ID: readonly PerguntaPendente['tipo'][] = ['confirmacao', 'escolha_horario'];

/**
 * Valida `estado_conversa.aguardando_resposta` a partir de `unknown` -- o jsonb
 * lido no SELECT da identificação (spec v2 §14.6).
 *
 * MALFORMADO NUNCA VIRA `null` (spec v2 §14.6): esta função devolve ERRO, e o
 * chamador recusa a rota V2 naquele turno. Converter dado corrompido em `null`
 * transformaria "dado corrompido" na afirmação factual "não há pergunta em
 * aberto" -- regime oposto ao de `contexto_horarios`, que degrada para `null`
 * por ser snapshot auxiliar. Aqui o campo é a âncora que autoriza efeito.
 *
 * REGRAS POR TIPO, todas recusadas quando violadas:
 * - `operacao` só existe em `escolha_agendamento` e `confirmacao`, com o
 *   conjunto de valores aceitos definido pelo tipo (`OPERACOES_POR_TIPO`);
 * - em `confirmacao`, `operacao` é obrigatória;
 * - `agendamento_id` só existe em `confirmacao` e `escolha_horario`;
 * - `confirmacao` + `criar` PROÍBE `agendamento_id` (criação não referencia
 *   agendamento existente -- mesma invariante de `Acao.confirmar`, spec §2);
 * - `confirmacao` + `remarcar`/`cancelar` EXIGE `agendamento_id`.
 *
 * `null` legítimo (nenhuma pergunta em aberto) é representado pela ausência da
 * coluna e tratado pelo chamador -- esta função valida apenas valor presente.
 */
export function validarPerguntaPendente(entrada: unknown): Validacao<PerguntaPendente> {
  if (!ehObjetoSimples(entrada)) {
    return erro(`aguardando_resposta: esperado objeto, recebido ${tipoDescrito(entrada)}`);
  }
  const erroChaves = checarChavesDesconhecidas(entrada, ['tipo', 'opcoes', 'operacao', 'agendamento_id', 'detalhe']);
  if (erroChaves !== null) return erro(`aguardando_resposta: ${erroChaves}`);

  const tipo = entrada.tipo;
  if (typeof tipo !== 'string' || !TIPOS_PERGUNTA_PENDENTE.includes(tipo as PerguntaPendente['tipo'])) {
    return erro(`aguardando_resposta.tipo: valor desconhecido -- ${JSON.stringify(tipo)}`);
  }
  const tipoValido = tipo as PerguntaPendente['tipo'];

  const resultado: {
    tipo: PerguntaPendente['tipo'];
    opcoes?: readonly string[];
    operacao?: NonNullable<PerguntaPendente['operacao']>;
    agendamento_id?: string;
    detalhe?: Record<string, string>;
  } = { tipo: tipoValido };

  if (entrada.opcoes !== undefined) {
    if (!Array.isArray(entrada.opcoes)) {
      return erro(`aguardando_resposta.opcoes: esperado array, recebido ${tipoDescrito(entrada.opcoes)}`);
    }
    const opcoes: string[] = [];
    for (let i = 0; i < entrada.opcoes.length; i++) {
      const item = entrada.opcoes[i];
      if (typeof item !== 'string') {
        return erro(`aguardando_resposta.opcoes[${i}]: esperado string, recebido ${tipoDescrito(item)}`);
      }
      opcoes.push(item);
    }
    resultado.opcoes = opcoes;
  }

  // `operacao` -- admitida só nos tipos que a definem, com o conjunto de
  // valores do PRÓPRIO tipo. Nunca ignorada em silêncio: valor de outro
  // contexto (`consultar` numa confirmação, `criar` numa escolha) é recusado
  // como desconhecido, exatamente como um valor inexistente.
  if (entrada.operacao !== undefined) {
    const operacoesAceitas = OPERACOES_POR_TIPO[tipoValido];
    if (operacoesAceitas === undefined) {
      return erro(`aguardando_resposta(${tipoValido}): operacao não se aplica a este tipo`);
    }
    const operacao = entrada.operacao;
    if (
      typeof operacao !== 'string' ||
      !operacoesAceitas.includes(operacao as NonNullable<PerguntaPendente['operacao']>)
    ) {
      return erro(`aguardando_resposta.operacao: valor desconhecido -- ${JSON.stringify(operacao)}`);
    }
    resultado.operacao = operacao as NonNullable<PerguntaPendente['operacao']>;
  }

  if (entrada.agendamento_id !== undefined) {
    if (!TIPOS_COM_AGENDAMENTO_ID.includes(tipoValido)) {
      return erro(`aguardando_resposta(${tipoValido}): agendamento_id não se aplica a este tipo`);
    }
    const id = checarStringNaoVazia(entrada.agendamento_id, 'aguardando_resposta.agendamento_id');
    if (!id.ok) return id;
    resultado.agendamento_id = id.valor;
  }

  if (entrada.detalhe !== undefined) {
    if (!ehObjetoSimples(entrada.detalhe)) {
      return erro(`aguardando_resposta.detalhe: esperado objeto, recebido ${tipoDescrito(entrada.detalhe)}`);
    }
    const detalhe: Record<string, string> = {};
    for (const [chave, valor] of Object.entries(entrada.detalhe)) {
      if (typeof valor !== 'string') {
        return erro(`aguardando_resposta.detalhe.${chave}: esperado string, recebido ${tipoDescrito(valor)}`);
      }
      detalhe[chave] = valor;
    }
    resultado.detalhe = detalhe;
  }

  // Invariantes da confirmação -- ver o bloco de doc acima.
  if (tipoValido === 'confirmacao') {
    if (resultado.operacao === undefined) {
      return erro('aguardando_resposta(confirmacao): operacao é obrigatória');
    }
    if (resultado.operacao === 'criar') {
      if (resultado.agendamento_id !== undefined) {
        return erro('aguardando_resposta(confirmacao/criar): nunca carrega agendamento_id');
      }
    } else if (resultado.agendamento_id === undefined) {
      return erro(`aguardando_resposta(confirmacao/${resultado.operacao}): agendamento_id é obrigatório`);
    }
  }

  return ok(resultado);
}
