// Calculadora deterministica de APTIDAO de dentistas.
//
// Fonte: specs/dentistas-vinculos-v1.md secao 5 · cenarios DEN-01 a DEN-05 de
// tests/cenarios-obrigatorios.md.
//
// REESCRITO em 2026-08-09 (specs/dentista-semantico-v1.md). Foram removidos
// os ~22 testes do fluxo de PREFERENCIA TEXTUAL, junto com a propria
// maquinaria (`resolverPorPreferencia`, `nome_completo_resolucao`,
// `nome_curto_resolucao`, as tres variantes `preferencia_*`, as colisoes
// DEN-06 e o par DEN-07 "Dra. Ana" x "Ana"). Nao ha mais correspondencia de
// texto a testar: a preferencia chega como `dentista_id` ja resolvido pela
// interpretadora e e conferida no orquestrador -- a cobertura dessa parte
// vive em orquestrador.test.ts.
//
// Tambem sairam os testes de `vinculo_orfao`, `vinculo_clinica_divergente` e
// `vinculo_inconsistente`: os tres codigos eram inalcancaveis pelo unico
// produtor de catalogo em producao (ver dentista-tipos.ts). O que era
// coberto por eles esta preservado abaixo como "vinculo apontando para
// dentista ausente", agora sob o unico codigo restante.
//
// Todos os dados sao sinteticos. Nenhum dado real de paciente ou clinica.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  DentistaOficial,
  EntradaResolucaoDentista,
  VinculoDentistaProcedimento,
} from './dentista-tipos.ts';
import { resolverDentista } from './resolver-dentista.ts';
import { EntradaInvalidaError } from './erros.ts';

const CLINICA_A = 'clinica-sintetica-a';
const CLINICA_B = 'clinica-sintetica-b';
const PROCEDIMENTO_LIMPEZA = 'proc-limpeza-a';
const PROCEDIMENTO_CANAL = 'proc-canal-a';

function dentista(overrides: Partial<DentistaOficial> & { dentista_id: string }): DentistaOficial {
  return {
    clinica_id: CLINICA_A,
    nome_exibido: 'Dr. Sintetico',
    ativo: true,
    ...overrides,
  };
}

function vinculo(
  dentista_id: string,
  overrides: Partial<VinculoDentistaProcedimento> = {}
): VinculoDentistaProcedimento {
  return {
    clinica_id: CLINICA_A,
    dentista_id,
    procedimento_id: PROCEDIMENTO_LIMPEZA,
    ativo: true,
    ...overrides,
  };
}

const ANA = dentista({ dentista_id: 'dent-ana-a', nome_exibido: 'Dra. Ana' });
const BRUNO = dentista({ dentista_id: 'dent-bruno-a', nome_exibido: 'Dr. Bruno' });

function entrada(overrides: Partial<EntradaResolucaoDentista> = {}): EntradaResolucaoDentista {
  return {
    clinica_id: CLINICA_A,
    procedimento_id: PROCEDIMENTO_LIMPEZA,
    dentistas: [ANA, BRUNO],
    vinculos: [vinculo(ANA.dentista_id), vinculo(BRUNO.dentista_id)],
    ...overrides,
  };
}

// =====================================================================
// Zero, um ou varios aptos (secao 5)
// =====================================================================

test('DEN-03: zero aptos', () => {
  const r = resolverDentista(entrada({ vinculos: [] }));
  assert.equal(r.tipo, 'nenhum_apto');
});

test('DEN-01: exatamente um apto retorna diretamente, sem pedir preferencia', () => {
  const r = resolverDentista(entrada({ vinculos: [vinculo(ANA.dentista_id)] }));

  assert.equal(r.tipo, 'um_apto');
  if (r.tipo !== 'um_apto') return;
  assert.equal(r.dentista.dentista_id, ANA.dentista_id);
  assert.equal(r.dentista.nome_exibido, 'Dra. Ana');
});

test('DEN-02: varios aptos retornam todos, em ordem deterministica', () => {
  const r = resolverDentista(entrada());

  assert.equal(r.tipo, 'varios_aptos');
  if (r.tipo !== 'varios_aptos') return;
  assert.deepEqual(
    r.dentistas.map((d) => d.dentista_id),
    [ANA.dentista_id, BRUNO.dentista_id].sort()
  );
});

test('DEN-04: dentista inativo nao conta, mesmo com vinculo ativo', () => {
  const r = resolverDentista(
    entrada({ dentistas: [{ ...ANA, ativo: false }, BRUNO], vinculos: entrada().vinculos })
  );

  assert.equal(r.tipo, 'um_apto');
  if (r.tipo === 'um_apto') assert.equal(r.dentista.dentista_id, BRUNO.dentista_id);
});

test('DEN-04: vinculo inativo nao conta', () => {
  const r = resolverDentista(
    entrada({ vinculos: [vinculo(ANA.dentista_id, { ativo: false }), vinculo(BRUNO.dentista_id)] })
  );

  assert.equal(r.tipo, 'um_apto');
  if (r.tipo === 'um_apto') assert.equal(r.dentista.dentista_id, BRUNO.dentista_id);
});

test('vinculo de outro procedimento nao conta', () => {
  const r = resolverDentista(
    entrada({ vinculos: [vinculo(ANA.dentista_id, { procedimento_id: PROCEDIMENTO_CANAL }), vinculo(BRUNO.dentista_id)] })
  );

  assert.equal(r.tipo, 'um_apto');
  if (r.tipo === 'um_apto') assert.equal(r.dentista.dentista_id, BRUNO.dentista_id);
});

test('vinculo de outra clinica nao conta', () => {
  const r = resolverDentista(
    entrada({ vinculos: [{ ...vinculo(ANA.dentista_id), clinica_id: CLINICA_B }, vinculo(BRUNO.dentista_id)] })
  );

  assert.equal(r.tipo, 'um_apto');
  if (r.tipo === 'um_apto') assert.equal(r.dentista.dentista_id, BRUNO.dentista_id);
});

test('ordem de entrada dos dentistas e vinculos nao altera a lista', () => {
  const a = resolverDentista(entrada({ dentistas: [ANA, BRUNO], vinculos: entrada().vinculos }));
  const b = resolverDentista(
    entrada({ dentistas: [BRUNO, ANA], vinculos: [...entrada().vinculos].reverse() })
  );

  assert.deepEqual(a, b);
});

test('duplicatas equivalentes de dentista e de vinculo nao duplicam o apto', () => {
  const r = resolverDentista(
    entrada({
      dentistas: [ANA, { ...ANA }, BRUNO],
      vinculos: [vinculo(ANA.dentista_id), { ...vinculo(ANA.dentista_id) }, vinculo(BRUNO.dentista_id)],
    })
  );

  assert.equal(r.tipo, 'varios_aptos');
  if (r.tipo === 'varios_aptos') assert.equal(r.dentistas.length, 2);
});

test('com um unico apto, o resultado nunca pede escolha', () => {
  const r = resolverDentista(entrada({ vinculos: [vinculo(ANA.dentista_id)] }));

  assert.notEqual(r.tipo, 'varios_aptos');
  assert.equal(r.tipo, 'um_apto');
});

// =====================================================================
// Isolamento multiclinica (secao 11)
// =====================================================================

test('vinculo de outra clinica nunca revela dentista de outra clinica em varios_aptos', () => {
  const anaB = { ...ANA, clinica_id: CLINICA_B, dentista_id: 'dent-ana-b' };
  const r = resolverDentista(
    entrada({
      dentistas: [BRUNO, anaB],
      vinculos: [vinculo(BRUNO.dentista_id), { ...vinculo(anaB.dentista_id), clinica_id: CLINICA_B }],
    })
  );

  assert.equal(r.tipo, 'um_apto');
  if (r.tipo === 'um_apto') assert.equal(r.dentista.dentista_id, BRUNO.dentista_id);
});

// =====================================================================
// Consistencia estrutural -- o unico codigo que sobrou
// =====================================================================

test('mesmo dentista_id com conteudo divergente e erro de identidade', () => {
  const anaDivergente = { ...ANA, nome_exibido: 'Dra. Ana Maria' };
  const r = resolverDentista(entrada({ dentistas: [ANA, anaDivergente, BRUNO] }));

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo !== 'erro_catalogo') return;
  assert.equal(r.codigo, 'dentista_id_inconsistente');
  assert.deepEqual(r.dentista_ids, [ANA.dentista_id]);
});

test('vinculo apontando para dentista ausente do catalogo e erro estrutural, nunca escolha silenciosa', () => {
  const r = resolverDentista(
    entrada({ vinculos: [vinculo('dent-fantasma-a'), vinculo(ANA.dentista_id), vinculo(BRUNO.dentista_id)] })
  );

  // Nunca "varios_aptos" ignorando o vinculo quebrado, nunca "um_apto"
  // escolhendo so os validos -- o vinculo quebrado bloqueia o calculo inteiro.
  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo === 'erro_catalogo') assert.equal(r.codigo, 'dentista_id_inconsistente');
});

test('inconsistencia em dentista NAO relacionado nao bloqueia a resolucao pedida', () => {
  // Dentista "fantasma" (nao vinculado a este procedimento) com conteudo
  // divergente no catalogo -- nao pode interferir na resolucao de ANA/BRUNO.
  const fantasma1 = dentista({ dentista_id: 'dent-fantasma-a', nome_exibido: 'X' });
  const fantasma2 = { ...fantasma1, nome_exibido: 'Y' };

  const r = resolverDentista(entrada({ dentistas: [ANA, BRUNO, fantasma1, fantasma2] }));

  assert.equal(r.tipo, 'varios_aptos');
});

test('erros de catalogo expoem somente IDs opacos, nunca nome de dentista', () => {
  const anaDivergente = { ...ANA, nome_exibido: 'Dra. Ana Maria' };
  const r = resolverDentista(entrada({ dentistas: [ANA, anaDivergente] }));

  assert.equal(r.tipo, 'erro_catalogo');
  const serializado = JSON.stringify(r);
  assert.ok(!serializado.includes('Ana'));
});

// =====================================================================
// Determinismo geral
// =====================================================================

test('determinismo: mesma entrada retorna resultado igual', () => {
  for (const vinculos of [[], [vinculo(ANA.dentista_id)], entrada().vinculos]) {
    assert.deepEqual(resolverDentista(entrada({ vinculos })), resolverDentista(entrada({ vinculos })));
  }
});

test('determinismo: a entrada nao e mutada pelo resolvedor', () => {
  const dentistas = [ANA, BRUNO];
  const vinculos = [vinculo(ANA.dentista_id), vinculo(BRUNO.dentista_id)];
  const antes = JSON.stringify({ dentistas, vinculos });

  resolverDentista(entrada({ dentistas, vinculos }));

  assert.equal(JSON.stringify({ dentistas, vinculos }), antes);
});

// =====================================================================
// Contrato de entrada
// =====================================================================

test('clinica_id ou procedimento_id ausente/vazio e violacao de contrato', () => {
  for (const overrides of [{ clinica_id: '' }, { procedimento_id: '' }, { procedimento_id: '   ' }]) {
    assert.throws(() => resolverDentista(entrada(overrides)), EntradaInvalidaError);
  }
});

test('entrada com propriedade adicional e rejeitada', () => {
  assert.throws(
    () =>
      resolverDentista({
        ...entrada(),
        dentista_id: 'vindo-da-ia',
      } as unknown as EntradaResolucaoDentista),
    EntradaInvalidaError
  );
});

test('dentista_texto NAO e mais aceito na entrada -- o resolvedor nunca recebe texto do paciente', () => {
  // Guarda de regressao da propria remocao (specs/dentista-semantico-v1.md):
  // se alguem reintroduzir a preferencia textual aqui, este teste falha.
  assert.throws(
    () =>
      resolverDentista({
        ...entrada(),
        dentista_texto: 'quero com a Ana',
      } as unknown as EntradaResolucaoDentista),
    EntradaInvalidaError
  );
});

test('dentistas ou vinculos fora de array e violacao de contrato', () => {
  assert.throws(
    () => resolverDentista(entrada({ dentistas: null as unknown as DentistaOficial[] })),
    EntradaInvalidaError
  );
  assert.throws(
    () => resolverDentista(entrada({ vinculos: null as unknown as VinculoDentistaProcedimento[] })),
    EntradaInvalidaError
  );
});

test('erro de contrato nunca reproduz identificador de outra clinica', () => {
  let capturado: unknown;
  try {
    resolverDentista(entrada({ clinica_id: '' }));
  } catch (erro) {
    capturado = erro;
  }

  assert.ok(capturado instanceof EntradaInvalidaError);
  const representacao = JSON.stringify(capturado) + (capturado as Error).message;
  assert.ok(!representacao.includes(CLINICA_B));
});
