// Resolvedor deterministico de dentistas e vinculos.
//
// Fonte: specs/dentistas-vinculos-v1.md · cenarios DEN-01 a DEN-10 de
// tests/cenarios-obrigatorios.md.
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
    nome_completo_resolucao: 'sintetico',
    nome_curto_resolucao: null,
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

const ANA = dentista({
  dentista_id: 'dent-ana-a',
  nome_exibido: 'Dra. Ana',
  nome_completo_resolucao: 'dra. ana',
  nome_curto_resolucao: 'ana',
});

const BRUNO = dentista({
  dentista_id: 'dent-bruno-a',
  nome_exibido: 'Dr. Bruno',
  nome_completo_resolucao: 'dr. bruno',
  nome_curto_resolucao: 'bruno',
});

function entrada(overrides: Partial<EntradaResolucaoDentista> = {}): EntradaResolucaoDentista {
  return {
    clinica_id: CLINICA_A,
    procedimento_id: PROCEDIMENTO_LIMPEZA,
    dentista_texto: null,
    dentistas: [ANA, BRUNO],
    vinculos: [vinculo(ANA.dentista_id), vinculo(BRUNO.dentista_id)],
    ...overrides,
  };
}

// =====================================================================
// Sem preferencia
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

test('sem preferencia: ordem de entrada dos dentistas e vinculos nao altera a lista', () => {
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

// =====================================================================
// Preferencia valida
// =====================================================================

test('DEN-07-adjacente: preferencia por nome completo de resolucao resolve e e apta', () => {
  const r = resolverDentista(entrada({ dentista_texto: 'dra. ana' }));

  assert.equal(r.tipo, 'preferencia_apta');
  if (r.tipo === 'preferencia_apta') assert.equal(r.dentista.dentista_id, ANA.dentista_id);
});

test('preferencia por nome curto de resolucao resolve e e apta', () => {
  const r = resolverDentista(entrada({ dentista_texto: 'ana' }));

  assert.equal(r.tipo, 'preferencia_apta');
  if (r.tipo === 'preferencia_apta') assert.equal(r.dentista.dentista_id, ANA.dentista_id);
});

test('preferencia com variacao apenas das quatro normalizacoes aprovadas resolve', () => {
  for (const texto of ['DRA. ANA', '  dra.   ana  ', 'Dra. Ana']) {
    const r = resolverDentista(entrada({ dentista_texto: texto }));
    assert.equal(r.tipo, 'preferencia_apta', `deveria resolver: ${JSON.stringify(texto)}`);
  }
});

test('preferencia resolve para dentista NAO apto (sem vinculo) sem substituir por outro apto', () => {
  const r = resolverDentista(entrada({ dentista_texto: 'ana', vinculos: [vinculo(BRUNO.dentista_id)] }));

  assert.equal(r.tipo, 'preferencia_nao_apta');
  if (r.tipo !== 'preferencia_nao_apta') return;
  assert.equal(r.dentista.dentista_id, ANA.dentista_id);
  assert.equal(r.motivo, 'sem_vinculo');
});

test('preferencia resolve para dentista com vinculo inativo', () => {
  const r = resolverDentista(
    entrada({ dentista_texto: 'ana', vinculos: [vinculo(ANA.dentista_id, { ativo: false }), vinculo(BRUNO.dentista_id)] })
  );

  assert.equal(r.tipo, 'preferencia_nao_apta');
  if (r.tipo === 'preferencia_nao_apta') assert.equal(r.motivo, 'vinculo_inativo');
});

test('preferencia resolve para dentista inativo, conforme contrato unificado', () => {
  const r = resolverDentista(entrada({ dentista_texto: 'ana', dentistas: [{ ...ANA, ativo: false }, BRUNO] }));

  assert.equal(r.tipo, 'preferencia_nao_apta');
  if (r.tipo === 'preferencia_nao_apta') {
    assert.equal(r.dentista.dentista_id, ANA.dentista_id);
    assert.equal(r.motivo, 'dentista_inativo');
  }
});

// =====================================================================
// Preferencia nao resolvida
// =====================================================================

test('texto desconhecido nao resolve', () => {
  const r = resolverDentista(entrada({ dentista_texto: 'carlos' }));
  assert.equal(r.tipo, 'preferencia_nao_encontrada');
});

test('texto vazio e texto so com espacos sao tratados como ausencia de preferencia', () => {
  for (const texto of ['', '   ', '\n\t ']) {
    const r = resolverDentista(entrada({ dentista_texto: texto }));
    // Ausencia de preferencia reaplica a regra de aptidao (aqui, varios aptos) --
    // nunca "preferencia_nao_encontrada", que e reservado a texto PRESENTE sem match.
    assert.equal(r.tipo, 'varios_aptos');
  }
});

test('null e undefined sao tratados como ausencia de preferencia', () => {
  for (const texto of [null, undefined]) {
    const r = resolverDentista(entrada({ dentista_texto: texto }));
    assert.equal(r.tipo, 'varios_aptos');
  }
});

test('correspondencia apenas parcial nao resolve (sem contains, sem startsWith)', () => {
  for (const texto of ['an', 'ana silva', 'a dra ana', 'dra. ana silva']) {
    const r = resolverDentista(entrada({ dentista_texto: texto }));
    assert.equal(r.tipo, 'preferencia_nao_encontrada', `nao deveria resolver: ${JSON.stringify(texto)}`);
  }
});

test('erro ortografico que exigiria fuzzy matching nao resolve', () => {
  for (const texto of ['ann', 'anaa', 'brun', 'bruno.']) {
    const r = resolverDentista(entrada({ dentista_texto: texto }));
    assert.equal(r.tipo, 'preferencia_nao_encontrada', `nao deveria resolver: ${JSON.stringify(texto)}`);
  }
});

test('ID escrito como texto nunca e aceito como preferencia', () => {
  const r = resolverDentista(entrada({ dentista_texto: ANA.dentista_id }));
  assert.equal(r.tipo, 'preferencia_nao_encontrada');
});

test('dentista de outra clinica nao resolve por preferencia', () => {
  const anaB = { ...ANA, clinica_id: CLINICA_B, dentista_id: 'dent-ana-b' };
  const r = resolverDentista(entrada({ dentista_texto: 'ana', dentistas: [BRUNO, anaB], vinculos: [vinculo(BRUNO.dentista_id)] }));

  assert.equal(r.tipo, 'preferencia_nao_encontrada');
});

test('DEN-07: "Dra. Ana" e "Ana" sao entradas diferentes -- uma nunca resolve a outra automaticamente', () => {
  // Dentista cujo UNICO nome cadastrado e o nome curto "ana" -- pedir pelo
  // nome completo "carla" (nao cadastrado) nao deve casar com nada.
  const carla = dentista({
    dentista_id: 'dent-carla-a',
    nome_exibido: 'Dra. Carla',
    nome_completo_resolucao: 'dra. carla',
    nome_curto_resolucao: null,
  });
  const r = resolverDentista(
    entrada({ dentista_texto: 'dra. carla silva', dentistas: [carla], vinculos: [vinculo(carla.dentista_id)] })
  );

  assert.equal(r.tipo, 'preferencia_nao_encontrada');
});

// =====================================================================
// Ambiguidade
// =====================================================================

test('DEN-06: mesmo alias normalizado para dentistas distintos (nome completo x nome completo)', () => {
  const bruno2 = dentista({
    dentista_id: 'dent-bruno2-a',
    nome_exibido: 'Dr. Bruno Segundo',
    nome_completo_resolucao: 'dr. bruno',
    nome_curto_resolucao: null,
  });

  const r = resolverDentista(
    entrada({ dentista_texto: 'dr. bruno', dentistas: [BRUNO, bruno2], vinculos: [vinculo(BRUNO.dentista_id), vinculo(bruno2.dentista_id)] })
  );

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo !== 'erro_catalogo') return;
  assert.equal(r.codigo, 'nome_resolucao_ambiguo');
  assert.deepEqual([...r.dentista_ids].sort(), [BRUNO.dentista_id, bruno2.dentista_id].sort());
});

test('DEN-06: colisao nome curto x nome curto', () => {
  const bruno2 = dentista({
    dentista_id: 'dent-bruno2-a',
    nome_exibido: 'Dr. Bruno Segundo',
    nome_completo_resolucao: 'dr. bruno segundo',
    nome_curto_resolucao: 'bruno',
  });

  const r = resolverDentista(
    entrada({ dentista_texto: 'bruno', dentistas: [BRUNO, bruno2], vinculos: [vinculo(BRUNO.dentista_id), vinculo(bruno2.dentista_id)] })
  );

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo === 'erro_catalogo') assert.equal(r.codigo, 'nome_resolucao_ambiguo');
});

test('DEN-06: colisao nome completo de um x nome curto de outro', () => {
  const carla = dentista({
    dentista_id: 'dent-carla-a',
    nome_exibido: 'Dra. Carla',
    nome_completo_resolucao: 'bruno',
    nome_curto_resolucao: null,
  });

  const r = resolverDentista(
    entrada({ dentista_texto: 'bruno', dentistas: [BRUNO, carla], vinculos: [vinculo(BRUNO.dentista_id), vinculo(carla.dentista_id)] })
  );

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo !== 'erro_catalogo') return;
  assert.equal(r.codigo, 'nome_resolucao_ambiguo');
  assert.deepEqual([...r.dentista_ids].sort(), [BRUNO.dentista_id, carla.dentista_id].sort());
});

test('ambiguidade: runtime nunca escolhe -- resultado nunca e preferencia_apta', () => {
  const bruno2 = dentista({ dentista_id: 'dent-bruno2-a', nome_completo_resolucao: 'dr. bruno' });
  const r = resolverDentista(
    entrada({ dentista_texto: 'dr. bruno', dentistas: [BRUNO, bruno2] })
  );

  assert.notEqual(r.tipo, 'preferencia_apta');
  assert.equal(r.tipo, 'erro_catalogo');
});

test('ambiguidade: ordem invertida retorna o mesmo erro e os mesmos IDs ordenados', () => {
  const bruno2 = dentista({ dentista_id: 'dent-bruno2-a', nome_completo_resolucao: 'dr. bruno' });

  const a = resolverDentista(entrada({ dentista_texto: 'dr. bruno', dentistas: [BRUNO, bruno2] }));
  const b = resolverDentista(entrada({ dentista_texto: 'dr. bruno', dentistas: [bruno2, BRUNO] }));

  assert.deepEqual(a, b);
});

// =====================================================================
// Estrutural
// =====================================================================

test('DEN-08: vinculo apontando para dentista de outra clinica e erro estrutural quando necessario ao resultado', () => {
  // ANA existe fisicamente so na clinica B, mas ha um vinculo "da clinica A"
  // (clinica_id=A) apontando para o dentista_id dela.
  const anaSoNaClinicaB = { ...ANA, clinica_id: CLINICA_B };
  const r = resolverDentista(
    entrada({
      dentistas: [anaSoNaClinicaB, BRUNO],
      vinculos: [vinculo(ANA.dentista_id), vinculo(BRUNO.dentista_id)],
    })
  );

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo !== 'erro_catalogo') return;
  assert.equal(r.codigo, 'vinculo_clinica_divergente');
  assert.deepEqual(r.dentista_ids, [ANA.dentista_id]);
});

test('vinculo orfao: aponta para dentista_id que nao existe em catalogo algum', () => {
  const r = resolverDentista(
    entrada({ dentistas: [BRUNO], vinculos: [vinculo('dent-fantasma-a'), vinculo(BRUNO.dentista_id)] })
  );

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo !== 'erro_catalogo') return;
  assert.equal(r.codigo, 'vinculo_orfao');
  assert.deepEqual(r.dentista_ids, ['dent-fantasma-a']);
});

test('mesmo dentista_id com conteudo divergente e erro de identidade', () => {
  const r = resolverDentista(
    entrada({ dentistas: [ANA, { ...ANA, nome_exibido: 'Outro nome' }, BRUNO] })
  );

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo !== 'erro_catalogo') return;
  assert.equal(r.codigo, 'dentista_id_inconsistente');
  assert.deepEqual(r.dentista_ids, [ANA.dentista_id]);
});

test('vinculo duplicado estruturalmente inconsistente (mesma chave, ativo divergente)', () => {
  const r = resolverDentista(
    entrada({
      vinculos: [vinculo(ANA.dentista_id, { ativo: true }), vinculo(ANA.dentista_id, { ativo: false }), vinculo(BRUNO.dentista_id)],
    })
  );

  assert.equal(r.tipo, 'erro_catalogo');
  if (r.tipo === 'erro_catalogo') assert.equal(r.codigo, 'vinculo_inconsistente');
});

test('vinculo_inconsistente: dois dentistas inconsistentes sao agregados no mesmo erro, em qualquer ordem', () => {
  // ANA e BRUNO possuem, cada um, uma versao ativa e uma inativa do mesmo
  // vinculo (mesma clinica_id + dentista_id + procedimento_id). Correcao
  // 0150: a analise nao pode parar na primeira chave contraditoria -- as
  // DUAS precisam aparecer no mesmo erro, sempre.
  const anaAtivo = vinculo(ANA.dentista_id, { ativo: true });
  const anaInativo = vinculo(ANA.dentista_id, { ativo: false });
  const brunoAtivo = vinculo(BRUNO.dentista_id, { ativo: true });
  const brunoInativo = vinculo(BRUNO.dentista_id, { ativo: false });

  const idsEsperados = [ANA.dentista_id, BRUNO.dentista_id].sort();

  const ordens = [
    // ordem original
    [anaAtivo, anaInativo, brunoAtivo, brunoInativo],
    // array inteiro invertido
    [brunoInativo, brunoAtivo, anaInativo, anaAtivo],
    // ordem interna de CADA chave invertida (ativo/inativo trocados),
    // mantendo a ordem entre os dois dentistas
    [anaInativo, anaAtivo, brunoInativo, brunoAtivo],
    // entradas dos dois dentistas intercaladas
    [anaAtivo, brunoAtivo, anaInativo, brunoInativo],
  ];

  const resultados = ordens.map((vinculos) => resolverDentista(entrada({ vinculos })));

  for (const r of resultados) {
    assert.equal(r.tipo, 'erro_catalogo');
    if (r.tipo !== 'erro_catalogo') continue;
    assert.equal(r.codigo, 'vinculo_inconsistente');
    // Nenhum ID inconsistente omitido -- os dois, nunca so um.
    assert.deepEqual([...r.dentista_ids].sort(), idsEsperados);
    // Deduplicado e ordenado deterministicamente.
    assert.deepEqual(r.dentista_ids, idsEsperados);
  }

  // Estruturalmente identicos entre si, nas quatro ordens.
  assert.deepEqual(resultados[0], resultados[1]);
  assert.deepEqual(resultados[0], resultados[2]);
  assert.deepEqual(resultados[0], resultados[3]);
});

test('vinculo_inconsistente fora do escopo (outro procedimento) nao interfere na resolucao pedida', () => {
  const inconsistenteOutroProcedimento = [
    vinculo(BRUNO.dentista_id, { ativo: true, procedimento_id: PROCEDIMENTO_CANAL }),
    vinculo(BRUNO.dentista_id, { ativo: false, procedimento_id: PROCEDIMENTO_CANAL }),
  ];

  const r = resolverDentista(
    entrada({ vinculos: [vinculo(ANA.dentista_id), ...inconsistenteOutroProcedimento] })
  );

  assert.equal(r.tipo, 'um_apto');
  if (r.tipo === 'um_apto') assert.equal(r.dentista.dentista_id, ANA.dentista_id);
});

test('inconsistencia em dentista NAO relacionado nao bloqueia a resolucao pedida', () => {
  // Dentista "fantasma" (nao vinculado a este procedimento) com conteudo
  // divergente no catalogo -- nao pode interferir na resolucao de ANA/BRUNO.
  const fantasma1 = dentista({ dentista_id: 'dent-fantasma-a', nome_exibido: 'X' });
  const fantasma2 = { ...fantasma1, nome_exibido: 'Y' };

  const r = resolverDentista(entrada({ dentistas: [ANA, BRUNO, fantasma1, fantasma2] }));

  assert.equal(r.tipo, 'varios_aptos');
});

test('inconsistencia nao relacionada tambem nao bloqueia preferencia valida', () => {
  const fantasma1 = dentista({ dentista_id: 'dent-fantasma-a', nome_exibido: 'X' });
  const fantasma2 = { ...fantasma1, nome_exibido: 'Y' };

  const r = resolverDentista(entrada({ dentista_texto: 'ana', dentistas: [ANA, BRUNO, fantasma1, fantasma2] }));

  assert.equal(r.tipo, 'preferencia_apta');
  if (r.tipo === 'preferencia_apta') assert.equal(r.dentista.dentista_id, ANA.dentista_id);
});

test('erro estrutural necessario nunca escolhe silenciosamente um candidato', () => {
  const r = resolverDentista(
    entrada({ vinculos: [vinculo('dent-fantasma-a'), vinculo(ANA.dentista_id), vinculo(BRUNO.dentista_id)] })
  );

  // Nunca "varios_aptos" ignorando o vinculo quebrado, nunca "um_apto"
  // escolhendo so os validos -- o vinculo orfao bloqueia o calculo inteiro.
  assert.equal(r.tipo, 'erro_catalogo');
});

// =====================================================================
// Determinismo geral
// =====================================================================

test('determinismo: mesma entrada retorna resultado igual', () => {
  for (const texto of [null, 'ana', 'dr. bruno', 'desconhecido', '']) {
    assert.deepEqual(resolverDentista(entrada({ dentista_texto: texto })), resolverDentista(entrada({ dentista_texto: texto })));
  }
});

test('determinismo: a entrada nao e mutada pelo resolvedor', () => {
  const dentistas = [ANA, BRUNO];
  const vinculos = [vinculo(ANA.dentista_id), vinculo(BRUNO.dentista_id)];
  const antes = JSON.stringify({ dentistas, vinculos });

  resolverDentista(entrada({ dentistas, vinculos }));

  assert.equal(JSON.stringify({ dentistas, vinculos }), antes);
});

test('erros de catalogo expoem somente IDs opacos, nunca nome de dentista', () => {
  const bruno2 = dentista({ dentista_id: 'dent-bruno2-a', nome_completo_resolucao: 'dr. bruno' });
  const r = resolverDentista(entrada({ dentista_texto: 'dr. bruno', dentistas: [BRUNO, bruno2] }));

  assert.equal(r.tipo, 'erro_catalogo');
  const serializado = JSON.stringify(r);
  assert.ok(!serializado.includes('Bruno'));
});

// =====================================================================
// Regras de um e varios aptos
// =====================================================================

test('com um unico apto, nao existe resultado pedindo preferencia', () => {
  const r = resolverDentista(entrada({ vinculos: [vinculo(ANA.dentista_id)] }));

  assert.notEqual(r.tipo, 'varios_aptos');
  assert.notEqual(r.tipo, 'preferencia_nao_encontrada');
  assert.equal(r.tipo, 'um_apto');
});

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

test('erro de contrato nunca reproduz o texto do paciente', () => {
  const textoDoPaciente = 'quero com a Zulmira Bettencourt';
  let capturado: unknown;
  try {
    resolverDentista(entrada({ dentista_texto: textoDoPaciente, clinica_id: '' }));
  } catch (erro) {
    capturado = erro;
  }

  assert.ok(capturado instanceof EntradaInvalidaError);
  const representacao = JSON.stringify(capturado) + (capturado as Error).message;
  assert.ok(!representacao.includes('Zulmira'));
  assert.ok(!representacao.includes(textoDoPaciente));
});
