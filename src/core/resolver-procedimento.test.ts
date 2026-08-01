// Resolvedor deterministico de procedimento.
//
// Fonte: specs/procedimentos-v1.md · cenarios PRO-01 a PRO-08 de
// tests/cenarios-obrigatorios.md.
//
// Todos os dados sao sinteticos. Nenhum dado real de paciente ou clinica.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EntradaInvalidaError } from './erros.ts';
import { resolverProcedimento } from './resolver-procedimento.ts';
import type {
  AliasProcedimento,
  EntradaResolucaoProcedimento,
  ProcedimentoOficial,
} from './procedimento-tipos.ts';

const CLINICA_A = 'clinica-sintetica-a';
const CLINICA_B = 'clinica-sintetica-b';

const LIMPEZA: ProcedimentoOficial = {
  procedimento_id: 'proc-limpeza-a',
  clinica_id: CLINICA_A,
  nome_pt: 'Limpeza dental',
  ativo: true,
  eh_consulta_avaliacao: false,
};

const AVALIACAO: ProcedimentoOficial = {
  procedimento_id: 'proc-avaliacao-a',
  clinica_id: CLINICA_A,
  nome_pt: 'Consulta / Avaliação',
  ativo: true,
  eh_consulta_avaliacao: true,
};

function alias(texto: string, procedimento_id: string, extra: Partial<AliasProcedimento> = {}): AliasProcedimento {
  return { clinica_id: CLINICA_A, procedimento_id, texto, ativo: true, ...extra };
}

const ALIASES_PADRAO: AliasProcedimento[] = [
  alias('Limpeza dental', LIMPEZA.procedimento_id),
  alias('limpeza', LIMPEZA.procedimento_id),
  alias('profilaxia', LIMPEZA.procedimento_id),
  alias('Consulta / Avaliação', AVALIACAO.procedimento_id),
  alias('avaliação', AVALIACAO.procedimento_id),
];

function entrada(
  procedimento_texto: string | null | undefined,
  overrides: Partial<EntradaResolucaoProcedimento> = {}
): EntradaResolucaoProcedimento {
  return {
    clinica_id: CLINICA_A,
    procedimento_texto,
    catalogo: [LIMPEZA, AVALIACAO],
    aliases: ALIASES_PADRAO,
    ...overrides,
  };
}

// =====================================================================
// Resolucao valida
// =====================================================================

test('PRO-01: aliases distintos resolvem para o mesmo procedimento_id', () => {
  const ids = ['limpeza', 'Limpeza dental', 'profilaxia'].map((texto) => {
    const r = resolverProcedimento(entrada(texto));
    assert.equal(r.tipo, 'resolvido');
    return r.tipo === 'resolvido' ? r.procedimento_id : null;
  });

  assert.deepEqual(ids, [LIMPEZA.procedimento_id, LIMPEZA.procedimento_id, LIMPEZA.procedimento_id]);
});

test('PRO-01: nome oficial cadastrado como alias resolve normalmente', () => {
  const r = resolverProcedimento(entrada('Limpeza dental'));

  assert.equal(r.tipo, 'resolvido');
  if (r.tipo !== 'resolvido') return;
  assert.equal(r.procedimento_id, LIMPEZA.procedimento_id);
  assert.equal(r.nome_pt, 'Limpeza dental');
});

test('PRO-02: variacao coberta pelas quatro normalizacoes resolve (nome oficial)', () => {
  for (const texto of ['LIMPEZA DENTAL', '  limpeza   dental  ', 'Limpeza Dental']) {
    const r = resolverProcedimento(entrada(texto));
    assert.equal(r.tipo, 'resolvido', `deveria resolver: ${JSON.stringify(texto)}`);
    if (r.tipo === 'resolvido') assert.equal(r.procedimento_id, LIMPEZA.procedimento_id);
  }
});

test('PRO-02: variacao coberta pelas quatro normalizacoes resolve (alias com acento)', () => {
  for (const texto of ['avaliação', 'AVALIAÇÃO', 'avaliacao', '  Avaliação  ']) {
    const r = resolverProcedimento(entrada(texto));
    assert.equal(r.tipo, 'resolvido', `deveria resolver: ${JSON.stringify(texto)}`);
    if (r.tipo === 'resolvido') assert.equal(r.procedimento_id, AVALIACAO.procedimento_id);
  }
});

test('PRO-01: nome oficial e alias convergindo no mesmo procedimento nao geram ambiguidade', () => {
  // Dois aliases distintos cujo texto normalizado difere, ambos apontando
  // para o mesmo procedimento: deduplicado por identidade oficial.
  const r = resolverProcedimento(
    entrada('limpeza', {
      aliases: [alias('Limpeza dental', LIMPEZA.procedimento_id), alias('limpeza', LIMPEZA.procedimento_id)],
    })
  );

  assert.equal(r.tipo, 'resolvido');
  if (r.tipo === 'resolvido') assert.equal(r.procedimento_id, LIMPEZA.procedimento_id);
});

test('PRO-01: aliases duplicados byte a byte para o mesmo procedimento nao geram dois candidatos', () => {
  const r = resolverProcedimento(
    entrada('limpeza', {
      aliases: [alias('limpeza', LIMPEZA.procedimento_id), alias('limpeza', LIMPEZA.procedimento_id)],
    })
  );

  assert.equal(r.tipo, 'resolvido');
});

test('resolucao devolve identidade oficial, clinica e alias normalizado auditavel', () => {
  const r = resolverProcedimento(entrada('  LIMPEZA  '));

  assert.equal(r.tipo, 'resolvido');
  if (r.tipo !== 'resolvido') return;
  assert.equal(r.procedimento_id, LIMPEZA.procedimento_id);
  assert.equal(r.clinica_id, CLINICA_A);
  assert.equal(r.nome_pt, 'Limpeza dental');
  assert.equal(r.eh_consulta_avaliacao, false);
  assert.equal(r.alias_normalizado, 'limpeza');
});

test('PRO-07: Consulta/Avaliacao por pedido direto resolve como qualquer procedimento', () => {
  const r = resolverProcedimento(entrada('avaliação'));

  assert.equal(r.tipo, 'resolvido');
  if (r.tipo !== 'resolvido') return;
  assert.equal(r.procedimento_id, AVALIACAO.procedimento_id);
  assert.equal(r.eh_consulta_avaliacao, true);
});

test('o resolvedor NUNCA escolhe Consulta/Avaliacao como alternativa', () => {
  // Texto sem correspondencia com Consulta/Avaliacao ativa e disponivel no
  // catalogo: mesmo assim o resultado e nao resolvido, nunca um fallback.
  const r = resolverProcedimento(entrada('implante'));

  assert.equal(r.tipo, 'nao_resolvido');
});

// =====================================================================
// Nao resolvido
// =====================================================================

test('PRO-03: texto sem correspondencia', () => {
  const r = resolverProcedimento(entrada('implante dentario'));

  assert.equal(r.tipo, 'nao_resolvido');
  if (r.tipo === 'nao_resolvido') assert.equal(r.motivo, 'sem_correspondencia');
});

test('texto vazio e texto so com espacos', () => {
  for (const texto of ['', '   ', '\n\t ']) {
    const r = resolverProcedimento(entrada(texto));
    assert.equal(r.tipo, 'nao_resolvido');
    if (r.tipo === 'nao_resolvido') assert.equal(r.motivo, 'texto_ausente');
  }
});

test('texto omitido pela IA (null/undefined) resolve como nao resolvido, nunca erro', () => {
  for (const texto of [null, undefined]) {
    const r = resolverProcedimento(entrada(texto));
    assert.equal(r.tipo, 'nao_resolvido');
    if (r.tipo === 'nao_resolvido') assert.equal(r.motivo, 'texto_ausente');
  }
});

test('catalogo vazio resolve como nao resolvido, sem inventar procedimento', () => {
  const r = resolverProcedimento(entrada('limpeza', { catalogo: [], aliases: [] }));

  assert.equal(r.tipo, 'nao_resolvido');
  if (r.tipo === 'nao_resolvido') assert.equal(r.motivo, 'sem_correspondencia');
});

test('PRO-04: procedimento inativo nunca resolve, mesmo com alias ativo correspondente', () => {
  const r = resolverProcedimento(
    entrada('limpeza', { catalogo: [{ ...LIMPEZA, ativo: false }, AVALIACAO] })
  );

  assert.equal(r.tipo, 'nao_resolvido');
  if (r.tipo === 'nao_resolvido') assert.equal(r.motivo, 'procedimento_inativo');
});

test('alias inativo nao participa da resolucao', () => {
  const r = resolverProcedimento(
    entrada('limpeza', { aliases: [alias('limpeza', LIMPEZA.procedimento_id, { ativo: false })] })
  );

  assert.equal(r.tipo, 'nao_resolvido');
  if (r.tipo === 'nao_resolvido') assert.equal(r.motivo, 'alias_inativo');
});

test('alias inativo nao mascara alias ativo equivalente', () => {
  const r = resolverProcedimento(
    entrada('limpeza', {
      aliases: [
        alias('limpeza', 'proc-obsoleto', { ativo: false }),
        alias('limpeza', LIMPEZA.procedimento_id),
      ],
    })
  );

  assert.equal(r.tipo, 'resolvido');
  if (r.tipo === 'resolvido') assert.equal(r.procedimento_id, LIMPEZA.procedimento_id);
});

test('correspondencia apenas parcial nao resolve (sem contains, sem startsWith)', () => {
  for (const texto of ['limp', 'limpeza dent', 'quero uma limpeza', 'limpeza dental completa']) {
    const r = resolverProcedimento(entrada(texto));
    assert.equal(r.tipo, 'nao_resolvido', `nao deveria resolver: ${JSON.stringify(texto)}`);
  }
});

test('erro ortografico que exigiria fuzzy matching nao resolve', () => {
  for (const texto of ['limpesa', 'limpza', 'limpeza dentaria', 'profilaxa']) {
    const r = resolverProcedimento(entrada(texto));
    assert.equal(r.tipo, 'nao_resolvido', `nao deveria resolver: ${JSON.stringify(texto)}`);
  }
});

test('ID escrito como texto nunca e aceito como procedimento', () => {
  for (const texto of [LIMPEZA.procedimento_id, AVALIACAO.procedimento_id]) {
    const r = resolverProcedimento(entrada(texto));
    assert.equal(r.tipo, 'nao_resolvido', `id nao pode resolver: ${texto}`);
  }
});

test('nome de procedimento existente apenas em outra clinica nao resolve', () => {
  const procedimentoB: ProcedimentoOficial = {
    procedimento_id: 'proc-clareamento-b',
    clinica_id: CLINICA_B,
    nome_pt: 'Clareamento',
    ativo: true,
    eh_consulta_avaliacao: false,
  };

  const r = resolverProcedimento(
    entrada('clareamento', {
      catalogo: [LIMPEZA, AVALIACAO, procedimentoB],
      aliases: [...ALIASES_PADRAO, { ...alias('clareamento', procedimentoB.procedimento_id), clinica_id: CLINICA_B }],
    })
  );

  assert.equal(r.tipo, 'nao_resolvido');
  if (r.tipo === 'nao_resolvido') assert.equal(r.motivo, 'sem_correspondencia');
});

// =====================================================================
// Erro estrutural de catalogo
// =====================================================================

test('PRO-05: mesmo alias normalizado ligado a dois procedimentos ativos e erro de catalogo', () => {
  const r = resolverProcedimento(
    entrada('limpeza', {
      aliases: [alias('limpeza', LIMPEZA.procedimento_id), alias('Limpeza', AVALIACAO.procedimento_id)],
    })
  );

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo !== 'erro_catalogo') return;
  assert.equal(r.codigo, 'alias_ambiguo');
  assert.deepEqual([...r.procedimento_ids].sort(), [AVALIACAO.procedimento_id, LIMPEZA.procedimento_id].sort());
});

test('PRO-05: runtime nunca escolhe nem pergunta diante de alias ambiguo', () => {
  const r = resolverProcedimento(
    entrada('limpeza', {
      aliases: [alias('limpeza', LIMPEZA.procedimento_id), alias('limpeza', AVALIACAO.procedimento_id)],
    })
  );

  // Nem o primeiro, nem o menor id, nem o mais "provavel": nenhum resolvido.
  assert.equal(r.tipo, 'erro_catalogo');
  assert.notEqual(r.tipo, 'resolvido');
});

test('nome oficial e alias normalizados apontando para procedimentos diferentes e erro', () => {
  // O texto do nome oficial de LIMPEZA foi cadastrado como alias de outro
  // procedimento: mesma colisao normalizada, dois destinos.
  const r = resolverProcedimento(
    entrada('limpeza dental', {
      aliases: [
        alias('Limpeza dental', LIMPEZA.procedimento_id),
        alias('limpeza dental', AVALIACAO.procedimento_id),
      ],
    })
  );

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo === 'erro_catalogo') assert.equal(r.codigo, 'alias_ambiguo');
});

test('alias apontando para procedimento de outra clinica e erro de catalogo', () => {
  const procedimentoB: ProcedimentoOficial = {
    procedimento_id: 'proc-clareamento-b',
    clinica_id: CLINICA_B,
    nome_pt: 'Clareamento',
    ativo: true,
    eh_consulta_avaliacao: false,
  };

  const r = resolverProcedimento(
    entrada('clareamento', {
      catalogo: [LIMPEZA, AVALIACAO, procedimentoB],
      // Alias DA clinica A apontando para procedimento da clinica B.
      aliases: [alias('clareamento', procedimentoB.procedimento_id)],
    })
  );

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo !== 'erro_catalogo') return;
  assert.equal(r.codigo, 'alias_clinica_divergente');
  assert.deepEqual(r.procedimento_ids, [procedimentoB.procedimento_id]);
});

test('alias orfao (procedimento inexistente em qualquer catalogo) e erro de catalogo', () => {
  const r = resolverProcedimento(
    entrada('limpeza', { aliases: [alias('limpeza', 'proc-que-nao-existe')] })
  );

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo !== 'erro_catalogo') return;
  assert.equal(r.codigo, 'alias_orfao');
  assert.deepEqual(r.procedimento_ids, ['proc-que-nao-existe']);
});

// --- procedimento_id_inconsistente: escopo restrito aos IDs correspondentes ---
//
// Correcao 0143: a validacao de identidade so examina os `procedimento_id`
// efetivamente apontados pelo alias que casou com o texto pedido -- nunca
// o catalogo inteiro da clinica.

test('identidade contraditoria no proprio ID correspondente e erro de catalogo', () => {
  const r = resolverProcedimento(
    entrada('limpeza', { catalogo: [LIMPEZA, { ...LIMPEZA, nome_pt: 'Outro nome' }, AVALIACAO] })
  );

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo !== 'erro_catalogo') return;
  assert.equal(r.codigo, 'procedimento_id_inconsistente');
  assert.deepEqual(r.procedimento_ids, [LIMPEZA.procedimento_id]);
});

test('identidade contraditoria em procedimento NAO relacionado nao bloqueia a resolucao pedida', () => {
  // proc-implante (nao pedido) aparece duplicado com conteudo divergente;
  // proc-limpeza (pedido, via alias unico "limpeza") esta coerente.
  const implanteVersao1: ProcedimentoOficial = {
    procedimento_id: 'proc-implante-a',
    clinica_id: CLINICA_A,
    nome_pt: 'Implante',
    ativo: true,
    eh_consulta_avaliacao: false,
  };
  const implanteVersao2: ProcedimentoOficial = { ...implanteVersao1, nome_pt: 'Implante dentário' };

  const r = resolverProcedimento(
    entrada('limpeza', {
      catalogo: [LIMPEZA, AVALIACAO, implanteVersao1, implanteVersao2],
      aliases: [alias('limpeza', LIMPEZA.procedimento_id)],
    })
  );

  assert.equal(r.tipo, 'resolvido');
  if (r.tipo !== 'resolvido') return;
  assert.equal(r.procedimento_id, LIMPEZA.procedimento_id);
});

test('determinismo: inverter a ordem dos registros contraditorios preserva o mesmo erro', () => {
  const versao1 = LIMPEZA;
  const versao2 = { ...LIMPEZA, nome_pt: 'Outro nome' };

  const ordemA = resolverProcedimento(entrada('limpeza', { catalogo: [versao1, versao2, AVALIACAO] }));
  const ordemB = resolverProcedimento(entrada('limpeza', { catalogo: [versao2, versao1, AVALIACAO] }));

  assert.deepEqual(ordemA, ordemB);
  assert.equal(ordemA.tipo, 'erro_catalogo');
  if (ordemA.tipo !== 'erro_catalogo') return;
  assert.equal(ordemA.codigo, 'procedimento_id_inconsistente');
  assert.deepEqual(ordemA.procedimento_ids, [LIMPEZA.procedimento_id]);
});

// --- Precedencia 0145: ambiguidade antes de qualquer validacao de identidade ---

test('dois IDs ambiguos, ambos com identidade contraditoria, produzem alias_ambiguo com os dois IDs', () => {
  // p-a (LIMPEZA) e p-b (AVALIACAO) tem cada um dois registros divergentes
  // no catalogo, E o mesmo alias normalizado aponta para os dois. O
  // resultado precisa ser a ambiguidade -- nunca inconsistencia de um dos
  // dois lados, que dependeria de qual catalogo o resolvedor examinasse
  // primeiro.
  const limpezaV1 = LIMPEZA;
  const limpezaV2 = { ...LIMPEZA, nome_pt: 'Outro nome' };
  const avaliacaoV1 = AVALIACAO;
  const avaliacaoV2 = { ...AVALIACAO, nome_pt: 'Outro nome' };

  const aliasesAmbiguos = [alias('x', LIMPEZA.procedimento_id), alias('x', AVALIACAO.procedimento_id)];

  const catalogoOrdemA = [limpezaV1, limpezaV2, avaliacaoV1, avaliacaoV2];
  const catalogoOrdemB = [avaliacaoV2, avaliacaoV1, limpezaV2, limpezaV1];
  const aliasesOrdemA = aliasesAmbiguos;
  const aliasesOrdemB = [...aliasesAmbiguos].reverse();

  const resultados = [
    resolverProcedimento(entrada('x', { catalogo: catalogoOrdemA, aliases: aliasesOrdemA })),
    resolverProcedimento(entrada('x', { catalogo: catalogoOrdemB, aliases: aliasesOrdemA })),
    resolverProcedimento(entrada('x', { catalogo: catalogoOrdemA, aliases: aliasesOrdemB })),
    resolverProcedimento(entrada('x', { catalogo: catalogoOrdemB, aliases: aliasesOrdemB })),
  ];

  for (const r of resultados) {
    assert.equal(r.tipo, 'erro_catalogo');
    if (r.tipo !== 'erro_catalogo') continue;
    assert.equal(r.codigo, 'alias_ambiguo');
    assert.deepEqual([...r.procedimento_ids].sort(), [AVALIACAO.procedimento_id, LIMPEZA.procedimento_id].sort());
  }

  // Estruturalmente identicos entre si, nas quatro combinacoes de ordem.
  assert.deepEqual(resultados[0], resultados[1]);
  assert.deepEqual(resultados[0], resultados[2]);
  assert.deepEqual(resultados[0], resultados[3]);

  // IDs sempre na mesma ordem determinada (ordenacao estavel), nao na
  // ordem em que os aliases ou o catalogo foram fornecidos.
  const idsEsperados = [AVALIACAO.procedimento_id, LIMPEZA.procedimento_id].sort();
  for (const r of resultados) {
    if (r.tipo === 'erro_catalogo') assert.deepEqual(r.procedimento_ids, idsEsperados);
  }
});

test('registro duplicado byte a byte do mesmo procedimento NAO e erro', () => {
  const r = resolverProcedimento(entrada('limpeza', { catalogo: [LIMPEZA, { ...LIMPEZA }, AVALIACAO] }));

  assert.equal(r.tipo, 'resolvido');
  if (r.tipo === 'resolvido') assert.equal(r.procedimento_id, LIMPEZA.procedimento_id);
});

// --- PRO-08: unicidade de Consulta/Avaliacao ---
//
// A regra de produto (secao 8: no maximo uma Consulta/Avaliacao ativa por
// clinica) continua valendo, mas NAO e validada aqui. Este resolvedor so
// faz `texto -> normalizacao -> match exato de alias -> resultado`; a
// duplicidade global falhara fechado no componente que avaliar o fallback,
// quando essa etapa for autorizada. Os testes abaixo fixam exatamente essa
// fronteira.

const SEGUNDA_AVALIACAO: ProcedimentoOficial = {
  procedimento_id: 'proc-avaliacao-2-a',
  clinica_id: CLINICA_A,
  nome_pt: 'Avaliação inicial',
  ativo: true,
  eh_consulta_avaliacao: true,
};

test('PRO-08: procedimento independente resolve mesmo com duas Consultas/Avaliacoes ativas', () => {
  const r = resolverProcedimento(
    entrada('limpeza', {
      catalogo: [LIMPEZA, AVALIACAO, SEGUNDA_AVALIACAO],
      aliases: [alias('limpeza', LIMPEZA.procedimento_id)],
    })
  );

  assert.equal(r.tipo, 'resolvido');
  if (r.tipo === 'resolvido') assert.equal(r.procedimento_id, LIMPEZA.procedimento_id);
});

test('PRO-08: pedido direto por Consulta/Avaliacao com alias unico segue o match normal', () => {
  // Duas entidades marcadas como Consulta/Avaliacao, mas so uma casa com o
  // alias pedido: resolve pela regra normal, sem validacao global.
  const r = resolverProcedimento(
    entrada('avaliação', {
      catalogo: [LIMPEZA, AVALIACAO, SEGUNDA_AVALIACAO],
      aliases: [alias('avaliação', AVALIACAO.procedimento_id), alias('avaliação inicial', SEGUNDA_AVALIACAO.procedimento_id)],
    })
  );

  assert.equal(r.tipo, 'resolvido');
  if (r.tipo !== 'resolvido') return;
  assert.equal(r.procedimento_id, AVALIACAO.procedimento_id);
  assert.equal(r.eh_consulta_avaliacao, true);
});

test('PRO-08: alias ambiguo entre duas Consultas/Avaliacoes continua sendo alias_ambiguo', () => {
  const r = resolverProcedimento(
    entrada('avaliação', {
      catalogo: [LIMPEZA, AVALIACAO, SEGUNDA_AVALIACAO],
      aliases: [alias('avaliação', AVALIACAO.procedimento_id), alias('Avaliação', SEGUNDA_AVALIACAO.procedimento_id)],
    })
  );

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo !== 'erro_catalogo') return;
  assert.equal(r.codigo, 'alias_ambiguo');
  assert.deepEqual([...r.procedimento_ids].sort(), [AVALIACAO.procedimento_id, SEGUNDA_AVALIACAO.procedimento_id].sort());
});

test('PRO-08: texto sem correspondencia nao vira fallback, com uma ou varias Consultas/Avaliacoes', () => {
  for (const catalogo of [[LIMPEZA, AVALIACAO], [LIMPEZA, AVALIACAO, SEGUNDA_AVALIACAO]]) {
    const r = resolverProcedimento(entrada('implante dentario', { catalogo }));
    assert.equal(r.tipo, 'nao_resolvido');
    if (r.tipo === 'nao_resolvido') assert.equal(r.motivo, 'sem_correspondencia');
  }
});

test('PRO-08: segunda Consulta/Avaliacao inativa nao interfere na resolucao', () => {
  const avaliacaoInativa: ProcedimentoOficial = {
    procedimento_id: 'proc-avaliacao-antiga-a',
    clinica_id: CLINICA_A,
    nome_pt: 'Avaliação (descontinuada)',
    ativo: false,
    eh_consulta_avaliacao: true,
  };

  const r = resolverProcedimento(entrada('limpeza', { catalogo: [LIMPEZA, AVALIACAO, avaliacaoInativa] }));

  assert.equal(r.tipo, 'resolvido');
});

test('PRO-08: eh_consulta_avaliacao em clinicas diferentes nao colide', () => {
  const avaliacaoB: ProcedimentoOficial = {
    procedimento_id: 'proc-avaliacao-b',
    clinica_id: CLINICA_B,
    nome_pt: 'Consulta / Avaliação',
    ativo: true,
    eh_consulta_avaliacao: true,
  };

  const r = resolverProcedimento(entrada('limpeza', { catalogo: [LIMPEZA, AVALIACAO, avaliacaoB] }));

  assert.equal(r.tipo, 'resolvido');
});

// =====================================================================
// Isolamento multiclinica (PRO-06) e seguranca
// =====================================================================

test('PRO-06: mesmo alias em clinicas diferentes resolve para IDs distintos, sem conflito', () => {
  const limpezaB: ProcedimentoOficial = {
    procedimento_id: 'proc-limpeza-b',
    clinica_id: CLINICA_B,
    nome_pt: 'Limpeza dental',
    ativo: true,
    eh_consulta_avaliacao: false,
  };
  const catalogo = [LIMPEZA, AVALIACAO, limpezaB];
  const aliases = [
    alias('limpeza', LIMPEZA.procedimento_id),
    { ...alias('limpeza', limpezaB.procedimento_id), clinica_id: CLINICA_B },
  ];

  const naClinicaA = resolverProcedimento(entrada('limpeza', { catalogo, aliases }));
  const naClinicaB = resolverProcedimento(entrada('limpeza', { clinica_id: CLINICA_B, catalogo, aliases }));

  assert.equal(naClinicaA.tipo, 'resolvido');
  assert.equal(naClinicaB.tipo, 'resolvido');
  if (naClinicaA.tipo !== 'resolvido' || naClinicaB.tipo !== 'resolvido') return;
  assert.equal(naClinicaA.procedimento_id, LIMPEZA.procedimento_id);
  assert.equal(naClinicaB.procedimento_id, limpezaB.procedimento_id);
  assert.notEqual(naClinicaA.procedimento_id, naClinicaB.procedimento_id);
});

test('PRO-06: resultado nunca contem procedimento de outra clinica', () => {
  const limpezaB: ProcedimentoOficial = {
    procedimento_id: 'proc-limpeza-b',
    clinica_id: CLINICA_B,
    nome_pt: 'Limpeza dental',
    ativo: true,
    eh_consulta_avaliacao: false,
  };

  const r = resolverProcedimento(
    entrada('limpeza', {
      catalogo: [limpezaB, LIMPEZA, AVALIACAO],
      aliases: [{ ...alias('limpeza', limpezaB.procedimento_id), clinica_id: CLINICA_B }, alias('limpeza', LIMPEZA.procedimento_id)],
    })
  );

  assert.equal(r.tipo, 'resolvido');
  if (r.tipo !== 'resolvido') return;
  assert.equal(r.clinica_id, CLINICA_A);
  assert.notEqual(r.procedimento_id, limpezaB.procedimento_id);
});

test('procedimento e alias de outra clinica sozinhos nunca resolvem', () => {
  const limpezaB: ProcedimentoOficial = {
    procedimento_id: 'proc-limpeza-b',
    clinica_id: CLINICA_B,
    nome_pt: 'Limpeza dental',
    ativo: true,
    eh_consulta_avaliacao: false,
  };

  const r = resolverProcedimento(
    entrada('limpeza', {
      catalogo: [limpezaB],
      aliases: [{ ...alias('limpeza', limpezaB.procedimento_id), clinica_id: CLINICA_B }],
    })
  );

  assert.equal(r.tipo, 'nao_resolvido');
});

test('erros de catalogo expoem somente IDs opacos, nunca o catalogo inteiro', () => {
  const r = resolverProcedimento(
    entrada('limpeza', {
      aliases: [alias('limpeza', LIMPEZA.procedimento_id), alias('limpeza', AVALIACAO.procedimento_id)],
    })
  );

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo !== 'erro_catalogo') return;
  const serializado = JSON.stringify(r);
  assert.ok(!serializado.includes('Limpeza dental'));
  assert.ok(!serializado.includes('Avaliação'));
});

// =====================================================================
// Determinismo
// =====================================================================

test('determinismo: ordem do catalogo nao altera o resultado', () => {
  const base = [LIMPEZA, AVALIACAO];
  const invertido = [AVALIACAO, LIMPEZA];

  const a = resolverProcedimento(entrada('limpeza', { catalogo: base }));
  const b = resolverProcedimento(entrada('limpeza', { catalogo: invertido }));

  assert.deepEqual(a, b);
});

test('determinismo: ordem dos aliases nao altera o resultado', () => {
  const a = resolverProcedimento(entrada('limpeza', { aliases: ALIASES_PADRAO }));
  const b = resolverProcedimento(entrada('limpeza', { aliases: [...ALIASES_PADRAO].reverse() }));

  assert.deepEqual(a, b);
});

test('determinismo: ordem dos aliases nao altera o erro de ambiguidade', () => {
  const ambiguos = [alias('limpeza', LIMPEZA.procedimento_id), alias('limpeza', AVALIACAO.procedimento_id)];

  const a = resolverProcedimento(entrada('limpeza', { aliases: ambiguos }));
  const b = resolverProcedimento(entrada('limpeza', { aliases: [...ambiguos].reverse() }));

  assert.deepEqual(a, b);
});

test('determinismo: duas execucoes com a mesma entrada retornam o mesmo resultado', () => {
  for (const texto of ['limpeza', 'implante', '', 'avaliação']) {
    assert.deepEqual(resolverProcedimento(entrada(texto)), resolverProcedimento(entrada(texto)));
  }
});

test('determinismo: a entrada nao e mutada pelo resolvedor', () => {
  const catalogo = [LIMPEZA, AVALIACAO];
  const aliases = [...ALIASES_PADRAO];
  const antes = JSON.stringify({ catalogo, aliases });

  resolverProcedimento(entrada('limpeza', { catalogo, aliases }));

  assert.equal(JSON.stringify({ catalogo, aliases }), antes);
});

// =====================================================================
// Contrato de entrada
// =====================================================================

test('clinica_id ausente ou vazio e violacao de contrato', () => {
  for (const clinica of ['', '   ']) {
    assert.throws(() => resolverProcedimento(entrada('limpeza', { clinica_id: clinica })), EntradaInvalidaError);
  }
});

test('entrada com propriedade adicional e rejeitada', () => {
  assert.throws(
    () =>
      resolverProcedimento({
        clinica_id: CLINICA_A,
        procedimento_texto: 'limpeza',
        catalogo: [LIMPEZA],
        aliases: ALIASES_PADRAO,
        procedimento_id: 'proc-vindo-da-ia',
      } as unknown as EntradaResolucaoProcedimento),
    EntradaInvalidaError
  );
});

test('catalogo ou aliases fora de array e violacao de contrato', () => {
  assert.throws(
    () => resolverProcedimento(entrada('limpeza', { catalogo: null as unknown as ProcedimentoOficial[] })),
    EntradaInvalidaError
  );
  assert.throws(
    () => resolverProcedimento(entrada('limpeza', { aliases: null as unknown as AliasProcedimento[] })),
    EntradaInvalidaError
  );
});

test('erro de contrato nunca reproduz o texto do paciente', () => {
  const textoDoPaciente = 'quero limpeza para Zulmira Bettencourt';
  let capturado: unknown;
  try {
    resolverProcedimento(entrada(textoDoPaciente, { clinica_id: '' }));
  } catch (erro) {
    capturado = erro;
  }

  assert.ok(capturado instanceof EntradaInvalidaError);
  const representacao = JSON.stringify(capturado) + (capturado as Error).message;
  assert.ok(!representacao.includes('Zulmira'));
  assert.ok(!representacao.includes(textoDoPaciente));
});
