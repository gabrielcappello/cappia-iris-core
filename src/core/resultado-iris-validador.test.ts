// Testes do validador estrutural de `ResultadoIris`
// (specs/contexto-conversacional-unificado-v2.md).
//
// SOMENTE ESTRUTURAL. Nenhum teste aqui chama produção, rede ou modelo -- só
// exercita as funções puras de `resultado-iris-validador.ts`.
//
// Toda entrada passada às funções `validar*` é `unknown` deliberadamente --
// inclusive quando o teste constrói um objeto "bem formado" na mão, ele
// nunca é anotado com o tipo TS de destino antes de entrar na função. Isso é
// o que garante que o teste exercita o CAMINHO RUNTIME, não apenas confirma
// que o compilador aceitaria a entrada.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RESULTADO_IRIS_SCHEMA,
  validarAcao,
  validarAlternativa,
  validarInformacao,
  validarPerguntaPendente,
  validarResultadoIris,
} from './resultado-iris-validador.ts';
import type { Acao, Informacao, ResultadoIris } from './resultado-iris-tipos.ts';

// ── tipo ResultadoIris: união discriminada, checagem em tempo de compilação ─

test('tipo ResultadoIris: compreendida exige acao (TS não compila sem o campo)', () => {
  // @ts-expect-error -- acao é obrigatório quando tipo: 'compreendida'.
  const semAcao: ResultadoIris = { tipo: 'compreendida', informacoes_fornecidas: [] };
  void semAcao;
});

test('tipo ResultadoIris: nao_compreendida não aceita acao não nula (TS não compila)', () => {
  const acaoConversar: Acao = { tipo: 'conversar', objetivo: 'cumprimentar' };
  // @ts-expect-error -- acao deve ser exatamente null neste ramo.
  const acaoInvalida: ResultadoIris = {
    tipo: 'nao_compreendida',
    acao: acaoConversar,
    informacoes_fornecidas: [],
  };
  void acaoInvalida;
});

test('tipo ResultadoIris: nao_compreendida não aceita informacoes_fornecidas com item (TS não compila)', () => {
  const umFato: readonly Informacao[] = [{ campo: 'nome', operacao: 'informou', valor: 'Maria' }];
  // @ts-expect-error -- informacoes_fornecidas deve ser readonly [] neste ramo.
  const listaNaoVazia: ResultadoIris = {
    tipo: 'nao_compreendida',
    acao: null,
    informacoes_fornecidas: umFato,
  };
  void listaNaoVazia;
});

test('tipo ResultadoIris: nao_compreendida bem formado compila', () => {
  const valido: ResultadoIris = { tipo: 'nao_compreendida', acao: null, informacoes_fornecidas: [] };
  assert.equal(valido.tipo, 'nao_compreendida');
});

function assertOk<T>(resultado: { ok: boolean; erro?: string }): asserts resultado is { ok: true; valor: T } {
  assert.equal(resultado.ok, true, `esperado ok, recebido erro: ${'erro' in resultado ? resultado.erro : ''}`);
}

function assertErro(resultado: { ok: boolean }): asserts resultado is { ok: false; erro: string } {
  assert.equal(resultado.ok, false, 'esperado erro, recebido ok');
}

// ── JSON Schema: raiz plana, sem anyOf/oneOf de nível superior ─────────────

test('JSON Schema: raiz é um único objeto plano, sem anyOf/oneOf no nível superior', () => {
  assert.equal(RESULTADO_IRIS_SCHEMA.type, 'object');
  assert.ok(!('anyOf' in RESULTADO_IRIS_SCHEMA));
  assert.ok(!('oneOf' in RESULTADO_IRIS_SCHEMA));
  assert.deepEqual([...RESULTADO_IRIS_SCHEMA.required].sort(), ['acao', 'informacoes_fornecidas', 'tipo']);
});

function coletarObjetos(no: unknown, acumulado: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (no === null || typeof no !== 'object') return acumulado;
  const obj = no as Record<string, unknown>;
  if (obj.type === 'object' && obj.properties) acumulado.push(obj);
  for (const valor of Object.values(obj)) {
    if (Array.isArray(valor)) valor.forEach((v) => coletarObjetos(v, acumulado));
    else if (valor !== null && typeof valor === 'object') coletarObjetos(valor, acumulado);
  }
  return acumulado;
}

test('JSON Schema: todo objeto (em qualquer profundidade) tem additionalProperties false e required cobrindo todas as properties', () => {
  const objetos = coletarObjetos(RESULTADO_IRIS_SCHEMA);
  assert.ok(objetos.length > 0);
  for (const obj of objetos) {
    assert.equal(obj.additionalProperties, false, `objeto sem additionalProperties:false -- ${JSON.stringify(obj.properties)}`);
    const props = Object.keys(obj.properties as Record<string, unknown>);
    const obrigatorios = obj.required as string[];
    assert.deepEqual(
      [...obrigatorios].sort(),
      [...props].sort(),
      `required diverge de properties -- ${JSON.stringify(obj.properties)}`
    );
  }
});

test('JSON Schema: acao aceita 12 ramos de ação + null (11 ações, confirmar dividido em 2)', () => {
  const acaoSchema = RESULTADO_IRIS_SCHEMA.properties.acao as unknown as { anyOf: unknown[] };
  assert.equal(acaoSchema.anyOf.length, 13);
});

// ── validarResultadoIris: entradas bem formadas ──────────────────────────────

test('validarResultadoIris: nao_compreendida com acao null e lista vazia é aceito', () => {
  const entrada: unknown = { tipo: 'nao_compreendida', acao: null, informacoes_fornecidas: [] };
  const resultado = validarResultadoIris(entrada);
  assertOk(resultado);
  assert.equal(resultado.valor.tipo, 'nao_compreendida');
  assert.equal(resultado.valor.acao, null);
  assert.deepEqual(resultado.valor.informacoes_fornecidas, []);
});

test('validarResultadoIris: compreendida com acao e informacoes válidas é aceito', () => {
  const entrada: unknown = {
    tipo: 'compreendida',
    acao: { tipo: 'conversar', objetivo: 'cumprimentar' },
    informacoes_fornecidas: [{ campo: 'nome', operacao: 'informou', valor: 'Maria' }],
  };
  const resultado = validarResultadoIris(entrada);
  assertOk(resultado);
  assert.equal(resultado.valor.acao?.tipo, 'conversar');
});

// ── acao obrigatória quando compreendida (checagem runtime) ────────────────

test('validarResultadoIris: compreendida com acao null é recusado', () => {
  const entrada: unknown = { tipo: 'compreendida', acao: null, informacoes_fornecidas: [] };
  const resultado = validarResultadoIris(entrada);
  assertErro(resultado);
  assert.match(resultado.erro, /acao nunca é null/);
});

test('validarResultadoIris: nao_compreendida com acao não nula é recusado', () => {
  const entrada: unknown = {
    tipo: 'nao_compreendida',
    acao: { tipo: 'conversar', objetivo: 'cumprimentar' },
    informacoes_fornecidas: [],
  };
  const resultado = validarResultadoIris(entrada);
  assertErro(resultado);
  assert.match(resultado.erro, /acao deve ser null/);
});

// ── nao_compreendida exige informacoes_fornecidas vazia ─────────────────────

test('validarResultadoIris: nao_compreendida com informacoes_fornecidas não vazia é recusado', () => {
  const entrada: unknown = {
    tipo: 'nao_compreendida',
    acao: null,
    informacoes_fornecidas: [{ campo: 'nome', operacao: 'informou', valor: 'Maria' }],
  };
  const resultado = validarResultadoIris(entrada);
  assertErro(resultado);
  assert.match(resultado.erro, /informacoes_fornecidas deve ser vazia/);
});

test('validarResultadoIris: nao_compreendida com informacoes_fornecidas vazia é aceito', () => {
  const entrada: unknown = { tipo: 'nao_compreendida', acao: null, informacoes_fornecidas: [] };
  const resultado = validarResultadoIris(entrada);
  assertOk(resultado);
  assert.deepEqual(resultado.valor.informacoes_fornecidas, []);
});

test('validarResultadoIris: nao_compreendida recusa informacoes_fornecidas não vazia mesmo com item internamente inválido (chave ausente por primeiro)', () => {
  // Garante que a regra de lista vazia é aplicada mesmo quando o item, se
  // fosse validado isoladamente, teria seu próprio motivo de recusa -- aqui
  // o item É válido, só não é permitido neste ramo.
  const entrada: unknown = {
    tipo: 'nao_compreendida',
    acao: null,
    informacoes_fornecidas: [{ campo: 'cpf', operacao: 'corrigiu', valor: null }],
  };
  const resultado = validarResultadoIris(entrada);
  assertErro(resultado);
  assert.match(resultado.erro, /informacoes_fornecidas deve ser vazia/);
});

// ── invariantes de confirmar (via validarAcao, entrada unknown) ────────────

test('validarAcao: confirmar/criar com agendamento_id null é válido', () => {
  const resultado = validarAcao({ tipo: 'confirmar', operacao: 'criar', agendamento_id: null });
  assertOk(resultado);
});

test('validarAcao: confirmar/remarcar com agendamento_id string é válido', () => {
  const resultado = validarAcao({ tipo: 'confirmar', operacao: 'remarcar', agendamento_id: 'ag-1' });
  assertOk(resultado);
});

test('validarAcao: confirmar/cancelar com agendamento_id string é válido', () => {
  const resultado = validarAcao({ tipo: 'confirmar', operacao: 'cancelar', agendamento_id: 'ag-1' });
  assertOk(resultado);
});

test('validarAcao: confirmar/criar com agendamento_id não nulo é recusado', () => {
  const resultado = validarAcao({ tipo: 'confirmar', operacao: 'criar', agendamento_id: 'ag-1' });
  assertErro(resultado);
  assert.match(resultado.erro, /criar.*nunca carrega agendamento_id/);
});

test('validarAcao: confirmar/remarcar com agendamento_id null é recusado', () => {
  const resultado = validarAcao({ tipo: 'confirmar', operacao: 'remarcar', agendamento_id: null });
  assertErro(resultado);
  assert.match(resultado.erro, /remarcar.*exige agendamento_id/);
});

test('validarAcao: confirmar/cancelar com agendamento_id null é recusado', () => {
  const resultado = validarAcao({ tipo: 'confirmar', operacao: 'cancelar', agendamento_id: null });
  assertErro(resultado);
  assert.match(resultado.erro, /cancelar.*exige agendamento_id/);
});

test('validarAcao: confirmar/remarcar com agendamento_id string vazia é recusado', () => {
  const resultado = validarAcao({ tipo: 'confirmar', operacao: 'remarcar', agendamento_id: '' });
  assertErro(resultado);
});

// ── informou / corrigiu / string vazia ───────────────────────────────────────

test('validarInformacao: informou com valor não vazio é válido', () => {
  const resultado = validarInformacao({ campo: 'nome', operacao: 'informou', valor: 'Maria' });
  assertOk(resultado);
});

test('validarInformacao: informou com valor null é recusado', () => {
  const resultado = validarInformacao({ campo: 'nome', operacao: 'informou', valor: null });
  assertErro(resultado);
  assert.match(resultado.erro, /informou exige valor não vazio/);
});

test('validarInformacao: informou com string vazia é recusado', () => {
  const resultado = validarInformacao({ campo: 'nome', operacao: 'informou', valor: '' });
  assertErro(resultado);
  assert.match(resultado.erro, /string vazia/);
});

test('validarInformacao: informou com string só espaços é recusado', () => {
  const resultado = validarInformacao({ campo: 'nome', operacao: 'informou', valor: '   ' });
  assertErro(resultado);
  assert.match(resultado.erro, /string vazia/);
});

test('validarInformacao: corrigiu com valor não vazio é válido', () => {
  const resultado = validarInformacao({ campo: 'cpf', operacao: 'corrigiu', valor: '12345678900' });
  assertOk(resultado);
});

test('validarInformacao: corrigiu com valor null é válido (remoção)', () => {
  const resultado = validarInformacao({ campo: 'cpf', operacao: 'corrigiu', valor: null });
  assertOk(resultado);
});

test('validarInformacao: corrigiu com string vazia é recusado (use null para remover)', () => {
  const resultado = validarInformacao({ campo: 'cpf', operacao: 'corrigiu', valor: '' });
  assertErro(resultado);
  assert.match(resultado.erro, /string vazia/);
});

test('validarInformacao: campo desconhecido é recusado', () => {
  const resultado = validarInformacao({ campo: 'procedimento', operacao: 'informou', valor: 'limpeza' });
  assertErro(resultado);
  assert.match(resultado.erro, /valor desconhecido/);
});

test('validarInformacao não normaliza: string com espaços nas bordas mas conteúdo real passa intocada', () => {
  const resultado = validarInformacao({ campo: 'nome', operacao: 'informou', valor: '  Maria  ' });
  assertOk(resultado);
  assert.equal(resultado.valor.valor, '  Maria  ');
});

// ── cardinalidade de alternativas por ação ───────────────────────────────────

test('validarAcao: consultar_disponibilidade com alternativas vazio é recusado', () => {
  const resultado = validarAcao({
    tipo: 'consultar_disponibilidade',
    procedimento_id: null,
    dentista_ids: null,
    alternativas: [],
  });
  assertErro(resultado);
  assert.match(resultado.erro, /ao menos 1 alternativa/);
});

test('validarAcao: consultar_disponibilidade com 1 alternativa é válido', () => {
  const resultado = validarAcao({
    tipo: 'consultar_disponibilidade',
    procedimento_id: null,
    dentista_ids: null,
    alternativas: [{ data: '2026-08-20', horario: null, periodo: null }],
  });
  assertOk(resultado);
});

test('validarAcao: pedir_agendamento com alternativas vazio é válido', () => {
  const resultado = validarAcao({
    tipo: 'pedir_agendamento',
    procedimento_id: null,
    dentista_ids: null,
    alternativas: [],
  });
  assertOk(resultado);
});

test('validarAcao: remarcar com alternativas vazio é válido', () => {
  const resultado = validarAcao({ tipo: 'remarcar', agendamento_id: 'ag-1', alternativas: [] });
  assertOk(resultado);
});

test('validarAcao: nenhum máximo é aplicado a alternativas', () => {
  const muitas = Array.from({ length: 50 }, () => ({ data: '2026-08-20', horario: null, periodo: null }));
  const resultado = validarAcao({
    tipo: 'consultar_disponibilidade',
    procedimento_id: null,
    dentista_ids: null,
    alternativas: muitas,
  });
  assertOk(resultado);
});

test('validarAlternativa: todos os campos null é aceito estruturalmente (dado faltante é do Core, não do validador)', () => {
  const resultado = validarAlternativa({ data: null, horario: null, periodo: null });
  assertOk(resultado);
});

// ── escolher_dentista.dentista_ids aceitando [] ─────────────────────────────

test('validarAcao: escolher_dentista com dentista_ids vazio é válido', () => {
  const resultado = validarAcao({ tipo: 'escolher_dentista', dentista_ids: [] });
  assertOk(resultado);
});

test('validarAcao: escolher_dentista com um candidato é válido', () => {
  const resultado = validarAcao({ tipo: 'escolher_dentista', dentista_ids: ['dent-1'] });
  assertOk(resultado);
});

test('validarAcao: escolher_dentista com múltiplos candidatos é válido', () => {
  const resultado = validarAcao({ tipo: 'escolher_dentista', dentista_ids: ['dent-1', 'dent-2'] });
  assertOk(resultado);
});

// ── recusa de propriedades desconhecidas ─────────────────────────────────────

test('validarResultadoIris: chave desconhecida no envelope é recusada', () => {
  const resultado = validarResultadoIris({
    tipo: 'nao_compreendida',
    acao: null,
    informacoes_fornecidas: [],
    extra: 'x',
  });
  assertErro(resultado);
  assert.match(resultado.erro, /propriedade desconhecida/);
});

test('validarAcao: chave desconhecida em conversar é recusada', () => {
  const resultado = validarAcao({ tipo: 'conversar', objetivo: 'cumprimentar', extra: 'x' });
  assertErro(resultado);
  assert.match(resultado.erro, /propriedade desconhecida/);
});

test('validarInformacao: chave desconhecida é recusada', () => {
  const resultado = validarInformacao({ campo: 'nome', operacao: 'informou', valor: 'Maria', extra: 'x' });
  assertErro(resultado);
  assert.match(resultado.erro, /propriedade desconhecida/);
});

test('validarAlternativa: chave desconhecida é recusada', () => {
  const resultado = validarAlternativa({ data: null, horario: null, periodo: null, extra: 'x' });
  assertErro(resultado);
  assert.match(resultado.erro, /propriedade desconhecida/);
});

// ── entradas ARBITRARIAMENTE MALFORMADAS -- nunca lança, sempre recusa ─────

test('validarResultadoIris: null é recusado sem lançar', () => {
  assertErro(validarResultadoIris(null));
});

test('validarResultadoIris: undefined é recusado sem lançar', () => {
  assertErro(validarResultadoIris(undefined));
});

test('validarResultadoIris: string é recusada sem lançar', () => {
  assertErro(validarResultadoIris('compreendida'));
});

test('validarResultadoIris: número é recusado sem lançar', () => {
  assertErro(validarResultadoIris(42));
});

test('validarResultadoIris: booleano é recusado sem lançar', () => {
  assertErro(validarResultadoIris(true));
});

test('validarResultadoIris: array é recusado sem lançar', () => {
  assertErro(validarResultadoIris([1, 2, 3]));
});

test('validarResultadoIris: objeto vazio é recusado sem lançar', () => {
  assertErro(validarResultadoIris({}));
});

test('validarResultadoIris: tipo com valor fora do vocabulário é recusado sem lançar', () => {
  assertErro(validarResultadoIris({ tipo: 'talvez', acao: null, informacoes_fornecidas: [] }));
});

test('validarResultadoIris: tipo ausente é recusado sem lançar', () => {
  assertErro(validarResultadoIris({ acao: null, informacoes_fornecidas: [] }));
});

test('validarResultadoIris: informacoes_fornecidas ausente é recusado sem lançar', () => {
  assertErro(validarResultadoIris({ tipo: 'nao_compreendida', acao: null }));
});

test('validarResultadoIris: informacoes_fornecidas não-array é recusado sem lançar', () => {
  assertErro(validarResultadoIris({ tipo: 'nao_compreendida', acao: null, informacoes_fornecidas: 'nada' }));
});

test('validarResultadoIris: informacoes_fornecidas com item malformado profundamente é recusado sem lançar', () => {
  const resultado = validarResultadoIris({
    tipo: 'nao_compreendida',
    acao: null,
    informacoes_fornecidas: [{ campo: 'nome', operacao: 'informou', valor: { aninhado: true } }],
  });
  assertErro(resultado);
});

test('validarResultadoIris: acao é string em vez de objeto é recusado sem lançar', () => {
  const resultado = validarResultadoIris({ tipo: 'compreendida', acao: 'conversar', informacoes_fornecidas: [] });
  assertErro(resultado);
});

test('validarResultadoIris: acao é array é recusado sem lançar', () => {
  const resultado = validarResultadoIris({ tipo: 'compreendida', acao: [], informacoes_fornecidas: [] });
  assertErro(resultado);
});

test('validarResultadoIris: acao.tipo ausente é recusado sem lançar', () => {
  const resultado = validarResultadoIris({
    tipo: 'compreendida',
    acao: { objetivo: 'cumprimentar' },
    informacoes_fornecidas: [],
  });
  assertErro(resultado);
});

test('validarResultadoIris: acao.tipo fora do vocabulário é recusado sem lançar', () => {
  const resultado = validarResultadoIris({
    tipo: 'compreendida',
    acao: { tipo: 'voar_para_lua' },
    informacoes_fornecidas: [],
  });
  assertErro(resultado);
});

test('validarResultadoIris: acao profundamente aninhada com tipos trocados é recusada sem lançar', () => {
  const resultado = validarResultadoIris({
    tipo: 'compreendida',
    acao: {
      tipo: 'consultar_disponibilidade',
      procedimento_id: 123,
      dentista_ids: 'nao-e-array',
      alternativas: [{ data: 42, horario: [], periodo: {} }],
    },
    informacoes_fornecidas: [],
  });
  assertErro(resultado);
});

test('validarResultadoIris: entrada circular não lança (schema recusa antes de percorrer referência circular)', () => {
  const circular: Record<string, unknown> = { tipo: 'compreendida', informacoes_fornecidas: [] };
  circular.acao = circular;
  assert.doesNotThrow(() => validarResultadoIris(circular));
  assertErro(validarResultadoIris(circular));
});

test('validarResultadoIris: entrada profundamente aninhada (1000 níveis) não lança', () => {
  let profundo: unknown = { data: null, horario: null, periodo: null };
  for (let i = 0; i < 1000; i++) {
    profundo = { aninhado: profundo };
  }
  const entrada = {
    tipo: 'compreendida',
    acao: {
      tipo: 'consultar_disponibilidade',
      procedimento_id: null,
      dentista_ids: null,
      alternativas: [profundo],
    },
    informacoes_fornecidas: [],
  };
  assert.doesNotThrow(() => validarResultadoIris(entrada));
  assertErro(validarResultadoIris(entrada));
});

test('validarAcao: dentista_ids com item não-string é recusado sem lançar', () => {
  const resultado = validarAcao({ tipo: 'escolher_dentista', dentista_ids: ['dent-1', 42, null] });
  assertErro(resultado);
});

test('validarAcao: escolher_horario com referencia vazia é recusado', () => {
  const resultado = validarAcao({ tipo: 'escolher_horario', referencia: '', operacao: 'criar' });
  assertErro(resultado);
});

test('validarAcao: escolher_horario com operacao fora do vocabulário é recusado', () => {
  const resultado = validarAcao({ tipo: 'escolher_horario', referencia: '14:00', operacao: 'apagar' });
  assertErro(resultado);
});

test('validarAcao: aceitar_oferta com procedimento_id vazio é recusado', () => {
  const resultado = validarAcao({ tipo: 'aceitar_oferta', procedimento_id: '' });
  assertErro(resultado);
});

test('validarAlternativa: entrada null é recusada sem lançar', () => {
  assertErro(validarAlternativa(null));
});

test('validarAlternativa: entrada array é recusada sem lançar', () => {
  assertErro(validarAlternativa([]));
});

test('validarInformacao: entrada null é recusada sem lançar', () => {
  assertErro(validarInformacao(null));
});

test('validarInformacao: entrada array é recusada sem lançar', () => {
  assertErro(validarInformacao([]));
});

// ── validarPerguntaPendente -- a ANCORA que autoriza efeito (spec v2 §14.3) ─

// -- confirmacao: `operacao` em criar | remarcar | cancelar, NUNCA consultar --

test('validarPerguntaPendente: confirmacao de criacao SEM agendamento_id é aceita', () => {
  const resultado = validarPerguntaPendente({ tipo: 'confirmacao', operacao: 'criar' });
  assertOk(resultado);
});

test('validarPerguntaPendente: confirmacao de criacao COM agendamento_id é recusada', () => {
  const resultado = validarPerguntaPendente({
    tipo: 'confirmacao',
    operacao: 'criar',
    agendamento_id: 'ag-1',
  });
  assertErro(resultado);
  assert.match(resultado.erro, /criar.*nunca carrega agendamento_id/);
});

test('validarPerguntaPendente: confirmacao de remarcacao com alvo é aceita', () => {
  const resultado = validarPerguntaPendente({
    tipo: 'confirmacao',
    operacao: 'remarcar',
    agendamento_id: 'ag-1',
  });
  assertOk(resultado);
});

test('validarPerguntaPendente: confirmacao de cancelamento com alvo é aceita', () => {
  const resultado = validarPerguntaPendente({
    tipo: 'confirmacao',
    operacao: 'cancelar',
    agendamento_id: 'ag-1',
  });
  assertOk(resultado);
});

test('validarPerguntaPendente: confirmacao de remarcacao SEM agendamento_id é recusada', () => {
  const resultado = validarPerguntaPendente({ tipo: 'confirmacao', operacao: 'remarcar' });
  assertErro(resultado);
  assert.match(resultado.erro, /agendamento_id é obrigatório/);
});

test('validarPerguntaPendente: confirmacao de cancelamento SEM agendamento_id é recusada', () => {
  const resultado = validarPerguntaPendente({ tipo: 'confirmacao', operacao: 'cancelar' });
  assertErro(resultado);
  assert.match(resultado.erro, /agendamento_id é obrigatório/);
});

test('validarPerguntaPendente: confirmacao SEM operacao é recusada', () => {
  const resultado = validarPerguntaPendente({ tipo: 'confirmacao', agendamento_id: 'ag-1' });
  assertErro(resultado);
  assert.match(resultado.erro, /operacao é obrigatória/);
});

test('validarPerguntaPendente: confirmacao NUNCA aceita consultar', () => {
  const resultado = validarPerguntaPendente({ tipo: 'confirmacao', operacao: 'consultar' });
  assertErro(resultado);
  assert.match(resultado.erro, /valor desconhecido/);
});

// -- escolha_agendamento: `operacao` em consultar | remarcar | cancelar --

test('validarPerguntaPendente: escolha_agendamento aceita consultar, remarcar e cancelar', () => {
  assertOk(validarPerguntaPendente({ tipo: 'escolha_agendamento', operacao: 'consultar' }));
  assertOk(validarPerguntaPendente({ tipo: 'escolha_agendamento', operacao: 'remarcar' }));
  assertOk(validarPerguntaPendente({ tipo: 'escolha_agendamento', operacao: 'cancelar' }));
});

test('validarPerguntaPendente: escolha_agendamento NUNCA aceita criar', () => {
  const resultado = validarPerguntaPendente({ tipo: 'escolha_agendamento', operacao: 'criar' });
  assertErro(resultado);
  assert.match(resultado.erro, /valor desconhecido/);
});

test('validarPerguntaPendente: escolha_agendamento NÃO aceita agendamento_id', () => {
  const resultado = validarPerguntaPendente({
    tipo: 'escolha_agendamento',
    operacao: 'cancelar',
    agendamento_id: 'ag-1',
  });
  assertErro(resultado);
  assert.match(resultado.erro, /agendamento_id não se aplica/);
});

// -- campos recusados nos tipos em que não se aplicam --

test('validarPerguntaPendente: `operacao` é recusada fora de escolha_agendamento e confirmacao', () => {
  for (const tipo of ['escolha_dentista', 'escolha_horario', 'oferta_procedimento', 'troca_telefone', 'confirmacao_nome', 'cadastro']) {
    const resultado = validarPerguntaPendente({ tipo, operacao: 'cancelar' });
    assertErro(resultado);
    assert.match(resultado.erro, /operacao não se aplica/, `tipo ${tipo}`);
  }
});

test('validarPerguntaPendente: `operacao_confirmada` não existe mais -- é chave desconhecida', () => {
  const resultado = validarPerguntaPendente({
    tipo: 'confirmacao',
    operacao_confirmada: 'cancelar',
    agendamento_id: 'ag-1',
  });
  assertErro(resultado);
  assert.match(resultado.erro, /propriedade desconhecida: operacao_confirmada/);
});

test('validarPerguntaPendente: `agendamento_id` é recusado fora de confirmacao e escolha_horario', () => {
  for (const tipo of ['escolha_dentista', 'oferta_procedimento', 'troca_telefone', 'confirmacao_nome', 'cadastro']) {
    const resultado = validarPerguntaPendente({ tipo, agendamento_id: 'ag-1' });
    assertErro(resultado);
    assert.match(resultado.erro, /agendamento_id não se aplica/, `tipo ${tipo}`);
  }
});

test('validarPerguntaPendente: escolha_horario aceita agendamento_id (âncora de remarcação em curso)', () => {
  assertOk(validarPerguntaPendente({ tipo: 'escolha_horario', agendamento_id: 'ag-1' }));
});

// -- forma geral --

test('validarPerguntaPendente: tipos simples continuam válidos sozinhos', () => {
  assertOk(validarPerguntaPendente({ tipo: 'escolha_dentista' }));
  assertOk(validarPerguntaPendente({ tipo: 'cadastro' }));
  assertOk(validarPerguntaPendente({ tipo: 'troca_telefone' }));
  assertOk(validarPerguntaPendente({ tipo: 'oferta_procedimento' }));
});

test('validarPerguntaPendente: agendamento_id vazio é recusado', () => {
  const resultado = validarPerguntaPendente({
    tipo: 'confirmacao',
    operacao: 'cancelar',
    agendamento_id: '   ',
  });
  assertErro(resultado);
});

test('validarPerguntaPendente: opcoes e detalhe válidos são preservados', () => {
  const resultado = validarPerguntaPendente({
    tipo: 'escolha_agendamento',
    operacao: 'remarcar',
    opcoes: ['20/08 10:00', '22/08 11:00'],
  });
  assertOk(resultado);
  assert.deepEqual(resultado.valor.opcoes, ['20/08 10:00', '22/08 11:00']);
});

test('validarPerguntaPendente: detalhe com nome_proposto é preservado (guarda v1 §5.1)', () => {
  const resultado = validarPerguntaPendente({
    tipo: 'confirmacao_nome',
    detalhe: { nome_proposto: 'Maria' },
  });
  assertOk(resultado);
});

test('validarPerguntaPendente: tipo fora do vocabulário é recusado', () => {
  assertErro(validarPerguntaPendente({ tipo: 'inventado' }));
});

test('validarPerguntaPendente: chave desconhecida é recusada', () => {
  assertErro(validarPerguntaPendente({ tipo: 'cadastro', extra: 'x' }));
});

test('validarPerguntaPendente: entradas malformadas são recusadas sem lançar', () => {
  assertErro(validarPerguntaPendente(null));
  assertErro(validarPerguntaPendente(undefined));
  assertErro(validarPerguntaPendente('confirmacao'));
  assertErro(validarPerguntaPendente(42));
  assertErro(validarPerguntaPendente([]));
  assertErro(validarPerguntaPendente({}));
  assertErro(validarPerguntaPendente({ tipo: 'confirmacao', operacao: 'cancelar', agendamento_id: 42 }));
  assertErro(validarPerguntaPendente({ tipo: 'escolha_dentista', opcoes: 'nao-e-array' }));
  assertErro(validarPerguntaPendente({ tipo: 'escolha_dentista', opcoes: [1, 2] }));
  assertErro(validarPerguntaPendente({ tipo: 'confirmacao_nome', detalhe: { nome_proposto: 42 } }));
});
