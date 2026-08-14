// Gerador deterministico de disponibilidade.
//
// Fonte: specs/disponibilidade.md · cenarios DIS-01 a DIS-22 de
// tests/cenarios-obrigatorios.md.
//
// Todos os dados sao sinteticos. Nenhum dado real de paciente ou clinica.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  EntradaDisponibilidade,
  IntervaloIndisponivel,
  JornadaDentista,
  ModoConsulta,
  OpcaoHorario,
  ResultadoDisponibilidade,
} from './disponibilidade-tipos.ts';
import { resolverDisponibilidade } from './resolver-disponibilidade.ts';
import { EntradaInvalidaError } from './erros.ts';

const CLINICA_A = 'clinica-sintetica-a';
const CLINICA_B = 'clinica-sintetica-b';
const DENTISTA_A = 'dentista-sintetico-a';
const DENTISTA_B = 'dentista-sintetico-b';
const PROCEDIMENTO = 'proc-sintetico-limpeza';
const DATA = '2026-09-15';
const FUSO = 'America/Sao_Paulo';

/** Vespera da data consultada: nenhum recorte de passado, salvo teste proprio. */
const ONTEM = { data: '2026-09-14', minuto_min: 480 };

// --- Auxiliares ---

function min(hora: number, minuto = 0): number {
  return hora * 60 + minuto;
}

function hhmm(minutos: number): string {
  const h = String(Math.floor(minutos / 60)).padStart(2, '0');
  const m = String(minutos % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function jornada(
  inicio_min: number,
  fim_min: number,
  overrides: Partial<JornadaDentista> = {}
): JornadaDentista {
  return {
    clinica_id: CLINICA_A,
    dentista_id: DENTISTA_A,
    data: DATA,
    inicio_min,
    fim_min,
    ...overrides,
  };
}

function bloqueio(
  inicio_min: number,
  fim_min: number,
  overrides: Partial<IntervaloIndisponivel> = {}
): IntervaloIndisponivel {
  return {
    clinica_id: CLINICA_A,
    dentista_id: DENTISTA_A,
    data: DATA,
    origem: 'bloqueio',
    inicio_min,
    fim_min,
    ...overrides,
  };
}

function entrada(overrides: Partial<EntradaDisponibilidade> = {}): EntradaDisponibilidade {
  return {
    clinica_id: CLINICA_A,
    procedimento_id: PROCEDIMENTO,
    dentista_id: DENTISTA_A,
    data: DATA,
    fuso: FUSO,
    duracao_min: 40,
    jornadas: [jornada(min(8), min(12))],
    indisponiveis: [],
    modo: { tipo: 'grade' },
    sem_expediente_no_dia: null,
    instante_atual: ONTEM,
    ...overrides,
  };
}

/** Horarios de inicio de um resultado `opcoes`, formatados. Falha se for outro tipo. */
function iniciosDe(resultado: ResultadoDisponibilidade): string[] {
  assert.equal(resultado.tipo, 'opcoes');
  if (resultado.tipo !== 'opcoes') throw new Error('inalcancavel');
  return resultado.opcoes.map((o) => hhmm(o.inicio_min));
}

/** Grade de UM intervalo livre, sem bloqueios, com a duracao informada. */
function gradeDe(inicio_min: number, fim_min: number, duracao_min: number): string[] {
  return iniciosDe(
    resolverDisponibilidade(
      entrada({ duracao_min, jornadas: [jornada(inicio_min, fim_min)] })
    )
  );
}

function semDisponibilidade(inicio_min: number, fim_min: number, duracao_min: number): boolean {
  const r = resolverDisponibilidade(
    entrada({ duracao_min, jornadas: [jornada(inicio_min, fim_min)] })
  );
  return r.tipo === 'sem_disponibilidade';
}

// =====================================================================
// DIS-01 a DIS-09 — geracao canonica (secoes 5, 6 e 7)
// =====================================================================

test('DIS-01: intervalo menor que a duracao nao produz nenhuma opcao', () => {
  assert.equal(semDisponibilidade(min(8), min(8, 30), 40), true);
  assert.equal(semDisponibilidade(min(8), min(8, 39), 40), true);
});

test('DIS-02: intervalo igual a duracao produz somente o inicio', () => {
  assert.deepEqual(gradeDe(min(8), min(8, 40), 40), ['08:00']);
  // Tambem no ramo amplo: 240 minutos de intervalo com D240 (`L === I`).
  assert.deepEqual(gradeDe(min(8), min(12), 240), ['08:00']);
});

test('DIS-03: intervalo curto (<= 120) produz inicio e ultimo inicio possivel', () => {
  assert.deepEqual(gradeDe(min(8), min(10), 40), ['08:00', '09:20']);
  assert.deepEqual(gradeDe(min(9, 20), min(11, 20), 40), ['09:20', '10:40']);
  // Exatamente 120 minutos ainda e curto: o limite e inclusivo.
  assert.deepEqual(gradeDe(min(8), min(10), 30), ['08:00', '09:30']);
});

test('DIS-03: D10 em intervalo curto segue a regra da secao 5', () => {
  assert.deepEqual(gradeDe(min(8), min(9, 30), 10), ['08:00', '09:20']);
});

test('DIS-04: intervalo amplo (> 120) produz grade hora a hora com ajuste do fim', () => {
  assert.deepEqual(gradeDe(min(8), min(13), 40), [
    '08:00',
    '09:00',
    '10:00',
    '11:00',
    '12:20',
  ]);
  // 121 minutos ja e amplo. Com um unico horario regular (09:00), e ele
  // proprio que cede lugar a `L` -- o inicio real nunca.
  assert.deepEqual(gradeDe(min(8), min(10, 1), 40), ['08:00', '09:21']);
});

test('DIS-04: D10 em intervalo amplo segue a regra da secao 6', () => {
  assert.deepEqual(gradeDe(min(8), min(12), 10), ['08:00', '09:00', '10:00', '11:50']);
});

test('DIS-05: os seis exemplos canonicos de 08:00-12:00 (secao 6)', () => {
  const canonicos: ReadonlyArray<readonly [number, readonly string[]]> = [
    [20, ['08:00', '09:00', '10:00', '11:40']],
    [30, ['08:00', '09:00', '10:00', '11:30']],
    [40, ['08:00', '09:00', '10:00', '11:20']],
    [60, ['08:00', '09:00', '10:00', '11:00']],
    [90, ['08:00', '09:00', '10:30']],
    [120, ['08:00', '09:00', '10:00']],
  ];

  for (const [duracao, esperado] of canonicos) {
    assert.deepEqual(gradeDe(min(8), min(12), duracao), [...esperado], `D${duracao}`);
  }
});

test('DIS-06: caso degenerado 08:00-11:00 com D150 preserva o inicio real', () => {
  const grade = gradeDe(min(8), min(11), 150);
  assert.deepEqual(grade, ['08:00', '08:30']);
  // Nunca substituir 08:00 por 08:30: o inicio real jamais e removido.
  assert.equal(grade.includes('08:00'), true);
});

test('DIS-07: minutos quebrados nao se propagam pela grade', () => {
  const apos = (inicio: number): string[] => gradeDe(inicio, min(18), 40).slice(1, 3);

  assert.deepEqual(apos(min(8, 10)), ['09:00', '10:00']);
  assert.deepEqual(apos(min(8, 20)), ['09:00', '10:00']);
  assert.deepEqual(apos(min(8, 30)), ['09:00', '10:00']);
  // Em 08:40 a hora cheia 09:00 esta a apenas 20 minutos e nao e apresentada.
  assert.deepEqual(apos(min(8, 40)), ['10:00', '11:00']);
});

test('DIS-08: intervalo 15:10-18:00 com D40 resulta em 15:10, 16:00, 17:20', () => {
  assert.deepEqual(gradeDe(min(15, 10), min(18), 40), ['15:10', '16:00', '17:20']);
});

test('DIS-09: o passo e hora a hora independentemente da duracao', () => {
  const esperado: ReadonlyArray<readonly [number, readonly string[]]> = [
    [10, ['08:00', '09:00', '10:00', '11:50']],
    [20, ['08:00', '09:00', '10:00', '11:40']],
    [40, ['08:00', '09:00', '10:00', '11:20']],
    [60, ['08:00', '09:00', '10:00', '11:00']],
    [90, ['08:00', '09:00', '10:30']],
    [120, ['08:00', '09:00', '10:00']],
    [150, ['08:00', '09:30']],
    [240, ['08:00']],
  ];

  for (const [duracao, lista] of esperado) {
    assert.deepEqual(gradeDe(min(8), min(12), duracao), [...lista], `D${duracao}`);
  }

  // O intervalo entre horarios REGULARES e sempre 60 minutos, nunca a
  // duracao: com D90 a grade vai de 08:00 para 09:00, nao para 09:30.
  assert.deepEqual(gradeDe(min(8), min(12), 90).slice(0, 2), ['08:00', '09:00']);
});

test('DIS-09: a regra vale em intervalos diferentes de 08:00-12:00', () => {
  assert.deepEqual(gradeDe(min(7), min(12), 40), ['07:00', '08:00', '09:00', '10:00', '11:20']);
  assert.deepEqual(gradeDe(min(9), min(13), 40), ['09:00', '10:00', '11:00', '12:20']);
  assert.deepEqual(gradeDe(min(7), min(17), 60), [
    '07:00',
    '08:00',
    '09:00',
    '10:00',
    '11:00',
    '12:00',
    '13:00',
    '14:00',
    '15:00',
    '16:00',
  ]);
  // Minuto quebrado fora das 08:00.
  assert.deepEqual(gradeDe(min(13, 25), min(17), 60), ['13:25', '14:00', '15:00', '16:00']);
});

test('opcoes cabem integralmente no intervalo e podem se sobrepor entre si', () => {
  const r = resolverDisponibilidade(entrada({ duracao_min: 90 }));
  assert.equal(r.tipo, 'opcoes');
  if (r.tipo !== 'opcoes') return;

  for (const opcao of r.opcoes) {
    assert.equal(opcao.fim_min - opcao.inicio_min, 90);
    assert.equal(opcao.inicio_min >= min(8), true);
    assert.equal(opcao.fim_min <= min(12), true);
  }

  // 09:00-10:30 e 10:30-12:00 nao se sobrepoem, mas 08:00-09:30 e
  // 09:00-10:30 sim: alternativas mutuamente excludentes, nenhuma removida.
  assert.deepEqual(iniciosDe(r), ['08:00', '09:00', '10:30']);
});

// =====================================================================
// DIS-10 — intervalos livres, adjacencia e origens
// =====================================================================

test('DIS-10: adjacencia no fim e valida (atendimento termina quando a ocupacao comeca)', () => {
  const r = resolverDisponibilidade(
    entrada({ indisponiveis: [bloqueio(min(9), min(12))] })
  );
  // Livre: [08:00, 09:00). A opcao 08:20-09:00 encosta na ocupacao e vale.
  assert.deepEqual(iniciosDe(r), ['08:00', '08:20']);
});

test('DIS-10: adjacencia no comeco e valida (atendimento comeca quando a ocupacao termina)', () => {
  const r = resolverDisponibilidade(
    entrada({ indisponiveis: [bloqueio(min(8), min(9))] })
  );
  // Livre: [09:00, 12:00). A opcao 09:00 encosta no fim do bloqueio e vale.
  assert.deepEqual(iniciosDe(r), ['09:00', '10:00', '11:20']);
});

test('almoco divide a jornada em dois intervalos livres independentes', () => {
  const r = resolverDisponibilidade(
    entrada({
      jornadas: [jornada(min(8), min(18))],
      indisponiveis: [bloqueio(min(12), min(13), { origem: 'almoco' })],
    })
  );
  assert.deepEqual(iniciosDe(r), [
    '08:00',
    '09:00',
    '10:00',
    '11:20',
    '13:00',
    '14:00',
    '15:00',
    '16:00',
    '17:20',
  ]);
});

test('jornadas adjacentes formam um bloco continuo e a grade nao reinicia', () => {
  const continuo = iniciosDe(
    resolverDisponibilidade(
      entrada({ jornadas: [jornada(min(8), min(12)), jornada(min(12), min(18))] })
    )
  );
  const partido = iniciosDe(
    resolverDisponibilidade(
      entrada({
        jornadas: [jornada(min(8), min(12)), jornada(min(12), min(18))],
        indisponiveis: [bloqueio(min(12), min(12, 10))],
      })
    )
  );

  // Unido: a grade segue de hora em hora atravessando o meio-dia.
  assert.equal(continuo.includes('11:00'), true);
  assert.equal(continuo.includes('11:20'), false);
  // Realmente partido: reinicia no inicio do segundo intervalo livre.
  assert.equal(partido.includes('11:20'), true);
  assert.equal(partido.includes('12:10'), true);
  assert.notDeepEqual(continuo, partido);
});

test('ocupacao que cobre a jornada inteira nao deixa opcao', () => {
  const r = resolverDisponibilidade(
    entrada({ indisponiveis: [bloqueio(min(7), min(13))] })
  );
  assert.equal(r.tipo, 'sem_disponibilidade');
});

test('ocupacao parcialmente fora da jornada corta somente a intersecao', () => {
  const r = resolverDisponibilidade(
    entrada({ indisponiveis: [bloqueio(min(6), min(9))] })
  );
  assert.deepEqual(iniciosDe(r), ['09:00', '10:00', '11:20']);
});

test('as quatro origens de indisponibilidade sao subtraidas de forma identica', () => {
  const origens = ['almoco', 'bloqueio', 'agendamento', 'evento_externo'] as const;
  const resultados = origens.map((origem) =>
    iniciosDe(
      resolverDisponibilidade(
        entrada({ indisponiveis: [bloqueio(min(9), min(10), { origem })] })
      )
    )
  );

  for (const resultado of resultados) {
    assert.deepEqual(resultado, resultados[0]);
  }
});

// =====================================================================
// DIS-11 e DIS-12 — horario exato (secao 9)
// =====================================================================

test('DIS-11: horario exato livre e oferecido mesmo fora da grade', () => {
  // 09:20 nao pertence a grade 08:00, 09:00, 10:00, 11:20.
  assert.equal(gradeDe(min(8), min(12), 40).includes('09:20'), false);

  const r = resolverDisponibilidade(
    entrada({ modo: { tipo: 'horario_exato', horario_min: min(9, 20) } })
  );
  assert.equal(r.tipo, 'horario_exato_disponivel');
  if (r.tipo !== 'horario_exato_disponivel') return;
  assert.equal(r.opcao.inicio_min, min(9, 20));
  assert.equal(r.opcao.fim_min, min(10));
});

test('DIS-12: horario exato ocupado devolve anterior e posterior mais proximos', () => {
  const r = resolverDisponibilidade(
    entrada({
      indisponiveis: [bloqueio(min(9), min(10))],
      modo: { tipo: 'horario_exato', horario_min: min(9) },
    })
  );

  assert.equal(r.tipo, 'horario_exato_indisponivel');
  if (r.tipo !== 'horario_exato_indisponivel') return;
  assert.equal(hhmm(r.anterior?.inicio_min ?? -1), '08:20');
  assert.equal(hhmm(r.posterior?.inicio_min ?? -1), '10:00');
  // As alternativas nao ficam restritas a grade hora a hora: aqui distam 40
  // e 60 minutos do pedido.
  assert.equal(min(9) - (r.anterior?.inicio_min ?? 0), 40);
  assert.equal((r.posterior?.inicio_min ?? 0) - min(9), 60);
});

test('DIS-12: somente anterior quando nao existe posterior valido', () => {
  const r = resolverDisponibilidade(
    entrada({
      jornadas: [jornada(min(8), min(10))],
      modo: { tipo: 'horario_exato', horario_min: min(9, 30) },
    })
  );

  assert.equal(r.tipo, 'horario_exato_indisponivel');
  if (r.tipo !== 'horario_exato_indisponivel') return;
  assert.equal(hhmm(r.anterior?.inicio_min ?? -1), '09:20');
  assert.equal(r.posterior, undefined);
});

test('DIS-12: somente posterior quando nao existe anterior valido', () => {
  const r = resolverDisponibilidade(
    entrada({
      jornadas: [jornada(min(10), min(12))],
      modo: { tipo: 'horario_exato', horario_min: min(9) },
    })
  );

  assert.equal(r.tipo, 'horario_exato_indisponivel');
  if (r.tipo !== 'horario_exato_indisponivel') return;
  assert.equal(r.anterior, undefined);
  assert.equal(hhmm(r.posterior?.inicio_min ?? -1), '10:00');
});

test('DIS-12: nenhum vizinho e inventado quando nao existe inicio valido', () => {
  const r = resolverDisponibilidade(
    entrada({
      jornadas: [jornada(min(8), min(8, 30))],
      modo: { tipo: 'horario_exato', horario_min: min(8) },
    })
  );

  assert.equal(r.tipo, 'horario_exato_indisponivel');
  if (r.tipo !== 'horario_exato_indisponivel') return;
  assert.equal(r.anterior, undefined);
  assert.equal(r.posterior, undefined);
});

test('DIS-12: a busca por vizinho usa granularidade de 10 minutos', () => {
  const r = resolverDisponibilidade(
    entrada({
      indisponiveis: [bloqueio(min(9, 10), min(10))],
      modo: { tipo: 'horario_exato', horario_min: min(9, 10) },
    })
  );

  assert.equal(r.tipo, 'horario_exato_indisponivel');
  if (r.tipo !== 'horario_exato_indisponivel') return;
  // Livre [08:00, 09:10): ultimo inicio possivel 08:30. O vizinho anterior
  // dista 40 minutos do pedido, valor impossivel numa grade hora a hora.
  assert.equal(hhmm(r.anterior?.inicio_min ?? -1), '08:30');
});

// =====================================================================
// DIS-13, DIS-14 e DIS-15 — periodos e restricoes (secoes 8 e 13)
// =====================================================================

test('DIS-13: fronteiras de periodo 12:00 (manha), 12:10 (tarde) e 18:00 (noite)', () => {
  const manha = iniciosDe(
    resolverDisponibilidade(
      entrada({ jornadas: [jornada(min(8), min(18))], modo: { tipo: 'grade', periodo: 'manha' } })
    )
  );
  assert.deepEqual(manha, ['08:00', '09:00', '10:00', '11:00', '12:00']);

  const tarde = iniciosDe(
    resolverDisponibilidade(
      entrada({
        jornadas: [jornada(min(12, 10), min(18))],
        modo: { tipo: 'grade', periodo: 'tarde' },
      })
    )
  );
  assert.equal(tarde[0], '12:10');

  const noite = iniciosDe(
    resolverDisponibilidade(
      entrada({ jornadas: [jornada(min(18), min(21))], modo: { tipo: 'grade', periodo: 'noite' } })
    )
  );
  assert.equal(noite[0], '18:00');
});

test('DIS-13: o periodo e classificado pelo INICIO, nunca pelo termino', () => {
  // 12:00 + 90min termina as 13:30, na tarde -- e continua sendo manha.
  const r = resolverDisponibilidade(
    entrada({
      duracao_min: 90,
      jornadas: [jornada(min(12), min(15))],
      modo: { tipo: 'grade', periodo: 'manha' },
    })
  );
  assert.deepEqual(iniciosDe(r), ['12:00']);
});

test('DIS-13: o filtro de periodo e aplicado DEPOIS da geracao', () => {
  const completa = gradeDe(min(8), min(18), 40);
  const tarde = iniciosDe(
    resolverDisponibilidade(
      entrada({ jornadas: [jornada(min(8), min(18))], modo: { tipo: 'grade', periodo: 'tarde' } })
    )
  );

  // A grade da tarde e um SUBCONJUNTO da grade completa. Recortar o
  // intervalo livre antes de gerar produziria 12:00 como inicio real e
  // 17:20 vindo de outro calculo -- grade diferente da oficial.
  for (const horario of tarde) {
    assert.equal(completa.includes(horario), true, horario);
  }
  assert.deepEqual(tarde, ['13:00', '14:00', '15:00', '16:00', '17:20']);
});

test('DIS-15: todas as opcoes do periodo, sem cap de quatro, paginacao ou truncamento', () => {
  const tarde = iniciosDe(
    resolverDisponibilidade(
      entrada({ jornadas: [jornada(min(8), min(18))], modo: { tipo: 'grade', periodo: 'tarde' } })
    )
  );
  assert.equal(tarde.length > 4, true);
  assert.equal(tarde.length, 5);
});

test('DIS-14: "antes das 11h" e inclusivo pelo inicio e nao exige termino ate 11:00', () => {
  const r = resolverDisponibilidade(
    entrada({
      jornadas: [jornada(min(8), min(18))],
      modo: { tipo: 'grade', restricao: { tipo: 'inicio_ate', minuto_min: min(11) } },
    })
  );

  assert.deepEqual(iniciosDe(r), ['08:00', '09:00', '10:00', '11:00']);
  assert.equal(r.tipo, 'opcoes');
  if (r.tipo !== 'opcoes') return;
  // A opcao das 11:00 termina as 11:40 e mesmo assim e valida.
  const onzeHoras = r.opcoes.find((o) => o.inicio_min === min(11)) as OpcaoHorario;
  assert.equal(onzeHoras.fim_min, min(11, 40));
});

test('DIS-14: "preciso terminar ate as 11h" e intencao distinta e exige o termino', () => {
  const r = resolverDisponibilidade(
    entrada({
      jornadas: [jornada(min(8), min(18))],
      modo: { tipo: 'grade', restricao: { tipo: 'termino_ate', minuto_min: min(11) } },
    })
  );

  assert.deepEqual(iniciosDe(r), ['08:00', '09:00', '10:00']);
  assert.equal(r.tipo, 'opcoes');
  if (r.tipo !== 'opcoes') return;
  for (const opcao of r.opcoes) {
    assert.equal(opcao.fim_min <= min(11), true);
  }
});

// =====================================================================
// DIS-16, DIS-17 e DIS-18 — modos e continuidade da busca (secao 11)
// =====================================================================

test('DIS-16: data especifica sem disponibilidade devolve sem_disponibilidade, sem avancar', () => {
  const r = resolverDisponibilidade(
    entrada({ indisponiveis: [bloqueio(min(8), min(12))] })
  );

  assert.equal(r.tipo, 'sem_disponibilidade');
  // O gerador e estritamente diario: nao existe campo de outra data no
  // resultado. Avancar ou parar e decisao do controlador.
  assert.deepEqual(Object.keys(r), ['tipo']);
});

test('DIS-17: proximo_disponivel devolve o primeiro horario real da data', () => {
  const r = resolverDisponibilidade(
    entrada({
      jornadas: [jornada(min(8), min(18))],
      indisponiveis: [bloqueio(min(8), min(13))],
      modo: { tipo: 'proximo_disponivel' },
    })
  );

  // Primeiro horario do dia mesmo estando em OUTRO periodo (secao 10, item 5).
  assert.deepEqual(iniciosDe(r), ['13:00']);
});

test('DIS-17: proximo_disponivel ignora periodo e devolve exatamente uma opcao', () => {
  const r = resolverDisponibilidade(
    entrada({ jornadas: [jornada(min(8), min(18))], modo: { tipo: 'proximo_disponivel' } })
  );
  assert.deepEqual(iniciosDe(r), ['08:00']);
});

test('DIS-18: sem_disponibilidade e por DATA e nunca resultado final da busca', () => {
  // O controlador chama uma vez por data; datas vazias nao encerram a busca.
  const vazias = ['2026-09-15', '2026-09-16', '2026-09-17'].map((data) =>
    resolverDisponibilidade(
      entrada({
        data,
        jornadas: [jornada(min(8), min(12), { data })],
        indisponiveis: [bloqueio(min(8), min(12), { data })],
        modo: { tipo: 'proximo_disponivel' },
      })
    )
  );
  for (const r of vazias) assert.equal(r.tipo, 'sem_disponibilidade');

  const primeiraLivre = resolverDisponibilidade(
    entrada({
      data: '2026-09-18',
      jornadas: [jornada(min(8), min(12), { data: '2026-09-18' })],
      modo: { tipo: 'proximo_disponivel' },
    })
  );
  assert.deepEqual(iniciosDe(primeiraLivre), ['08:00']);
});

// =====================================================================
// DIS-19 e DIS-20 — dentistas (secao 12) e isolamento por clinica
// =====================================================================

test('DIS-19: dentista especifico nunca e trocado silenciosamente', () => {
  const r = resolverDisponibilidade(
    entrada({
      jornadas: [
        jornada(min(8), min(10)),
        jornada(min(14), min(18), { dentista_id: DENTISTA_B }),
      ],
      indisponiveis: [bloqueio(min(8), min(9), { dentista_id: DENTISTA_B })],
    })
  );

  assert.deepEqual(iniciosDe(r), ['08:00', '09:20']);
  assert.equal(r.tipo, 'opcoes');
  if (r.tipo !== 'opcoes') return;
  for (const opcao of r.opcoes) {
    assert.equal(opcao.dentista_id, DENTISTA_A);
  }
});

test('DIS-20: cada dentista e calculado separadamente e as listas nunca se misturam', () => {
  const jornadas = [
    jornada(min(8), min(10)),
    jornada(min(14), min(16), { dentista_id: DENTISTA_B }),
  ];

  const a = resolverDisponibilidade(entrada({ jornadas }));
  const b = resolverDisponibilidade(entrada({ dentista_id: DENTISTA_B, jornadas }));

  assert.deepEqual(iniciosDe(a), ['08:00', '09:20']);
  assert.deepEqual(iniciosDe(b), ['14:00', '15:20']);
  assert.equal(a.tipo === 'opcoes' && a.opcoes.every((o) => o.dentista_id === DENTISTA_A), true);
  assert.equal(b.tipo === 'opcoes' && b.opcoes.every((o) => o.dentista_id === DENTISTA_B), true);
});

test('isolamento entre clinicas: agenda de outra clinica nunca influencia o resultado', () => {
  const r = resolverDisponibilidade(
    entrada({
      jornadas: [
        jornada(min(8), min(10)),
        jornada(min(10), min(18), { clinica_id: CLINICA_B }),
      ],
      indisponiveis: [bloqueio(min(8), min(9), { clinica_id: CLINICA_B })],
    })
  );

  assert.deepEqual(iniciosDe(r), ['08:00', '09:20']);
  assert.equal(r.tipo, 'opcoes');
  if (r.tipo !== 'opcoes') return;
  for (const opcao of r.opcoes) {
    assert.equal(opcao.clinica_id, CLINICA_A);
  }
});

test('agenda de outra data nunca influencia o resultado', () => {
  const r = resolverDisponibilidade(
    entrada({
      jornadas: [jornada(min(8), min(10)), jornada(min(10), min(18), { data: '2026-09-16' })],
      indisponiveis: [bloqueio(min(8), min(9), { data: '2026-09-16' })],
    })
  );
  assert.deepEqual(iniciosDe(r), ['08:00', '09:20']);
});

test('somente jornada de outra clinica equivale a nao haver jornada', () => {
  const r = resolverDisponibilidade(
    entrada({ jornadas: [jornada(min(8), min(12), { clinica_id: CLINICA_B })] })
  );
  assert.deepEqual(r, { tipo: 'configuracao_invalida', motivo: 'sem_jornada' });
});

// =====================================================================
// DIS-21 — Google Calendar (secao 14)
// =====================================================================

test('DIS-21: ausencia de evento externo nao bloqueia a agenda Cappia', () => {
  const semGoogle = resolverDisponibilidade(entrada({ indisponiveis: [] }));
  assert.deepEqual(iniciosDe(semGoogle), ['08:00', '09:00', '10:00', '11:20']);
});

test('DIS-21: evento externo autorizado entra como bloqueio adicional identico', () => {
  const comGoogle = resolverDisponibilidade(
    entrada({ indisponiveis: [bloqueio(min(9), min(10), { origem: 'evento_externo' })] })
  );
  const comBloqueioInterno = resolverDisponibilidade(
    entrada({ indisponiveis: [bloqueio(min(9), min(10), { origem: 'bloqueio' })] })
  );

  assert.deepEqual(comGoogle, comBloqueioInterno);
  // Livres [08:00, 09:00) e [10:00, 12:00): ambos curtos, cada um rende o
  // inicio real e o ultimo inicio possivel.
  assert.deepEqual(iniciosDe(comGoogle), ['08:00', '08:20', '10:00', '11:20']);
});

// =====================================================================
// DIS-22 — passado (secao 15)
// =====================================================================

test('DIS-22: data anterior ao instante atual nunca oferece horario', () => {
  const r = resolverDisponibilidade(
    entrada({ instante_atual: { data: '2026-09-16', minuto_min: min(9) } })
  );
  assert.equal(r.tipo, 'sem_disponibilidade');
});

test('DIS-22: exemplo canonico 08:00-12:00, D40, agora 09:15 resulta em 10:00, 11:20', () => {
  const r = resolverDisponibilidade(
    entrada({ instante_atual: { data: DATA, minuto_min: min(9, 15) } })
  );

  assert.deepEqual(iniciosDe(r), ['10:00', '11:20']);
  assert.equal(r.tipo, 'opcoes');
  if (r.tipo !== 'opcoes') return;
  for (const opcao of r.opcoes) {
    assert.equal(opcao.inicio_min > min(9, 15), true);
  }
});

test('DIS-22: o instante atual nunca vira uma nova opcao de grade', () => {
  const comAgora = iniciosDe(
    resolverDisponibilidade(entrada({ instante_atual: { data: DATA, minuto_min: min(9, 15) } }))
  );
  const gradeOficial = gradeDe(min(8), min(12), 40);

  // Toda opcao devolvida pertence a grade canonica intacta: 09:15 nao e
  // inventado como inicio real do que restou do intervalo.
  assert.equal(comAgora.includes('09:15'), false);
  for (const horario of comAgora) {
    assert.equal(gradeOficial.includes(horario), true, horario);
  }
});

test('DIS-22: inicio exatamente igual ao instante atual e excluido', () => {
  const r = resolverDisponibilidade(
    entrada({ instante_atual: { data: DATA, minuto_min: min(8) } })
  );
  // A comparacao e estrita: a spec exige instantes POSTERIORES ao atual.
  assert.deepEqual(iniciosDe(r), ['09:00', '10:00', '11:20']);
});

test('DIS-22: inicio anterior ao instante atual e excluido', () => {
  const r = resolverDisponibilidade(
    entrada({ instante_atual: { data: DATA, minuto_min: min(9) + 1 } })
  );
  assert.deepEqual(iniciosDe(r), ['10:00', '11:20']);
});

test('DIS-22: a primeira opcao estritamente posterior e preservada', () => {
  const r = resolverDisponibilidade(
    entrada({ instante_atual: { data: DATA, minuto_min: min(9) - 1 } })
  );
  assert.deepEqual(iniciosDe(r), ['09:00', '10:00', '11:20']);
});

test('DIS-22: jornada inteiramente no passado nao deixa opcao', () => {
  const r = resolverDisponibilidade(
    entrada({ instante_atual: { data: DATA, minuto_min: min(12) } })
  );
  assert.equal(r.tipo, 'sem_disponibilidade');
});

test('DIS-22: horario exato anterior ao instante atual e indisponivel', () => {
  const r = resolverDisponibilidade(
    entrada({
      instante_atual: { data: DATA, minuto_min: min(10) },
      modo: { tipo: 'horario_exato', horario_min: min(9) },
    })
  );

  // 09:00 cabe folgado em [08:00, 12:00) e ainda assim esta vencido.
  assert.equal(r.tipo, 'horario_exato_indisponivel');
  if (r.tipo !== 'horario_exato_indisponivel') return;
  assert.equal(r.anterior, undefined);
  // 10:00 tambem esta fora: e igual ao instante atual, nao posterior.
  assert.equal(hhmm(r.posterior?.inicio_min ?? -1), '10:10');
});

test('DIS-22: horario exato igual ao instante atual e indisponivel', () => {
  const r = resolverDisponibilidade(
    entrada({
      instante_atual: { data: DATA, minuto_min: min(9, 20) },
      modo: { tipo: 'horario_exato', horario_min: min(9, 20) },
    })
  );

  assert.equal(r.tipo, 'horario_exato_indisponivel');
  if (r.tipo !== 'horario_exato_indisponivel') return;
  assert.equal(r.anterior, undefined);
  assert.equal(hhmm(r.posterior?.inicio_min ?? -1), '09:30');
});

test('DIS-22: horario exato posterior ao instante atual e livre continua disponivel', () => {
  const r = resolverDisponibilidade(
    entrada({
      instante_atual: { data: DATA, minuto_min: min(9, 20) },
      modo: { tipo: 'horario_exato', horario_min: min(9, 21) },
    })
  );

  assert.equal(r.tipo, 'horario_exato_disponivel');
  if (r.tipo !== 'horario_exato_disponivel') return;
  assert.equal(r.opcao.inicio_min, min(9, 21));
});

test('DIS-22: vizinho com inicio igual ao instante atual e descartado', () => {
  const agora = min(9, 20);
  const r = resolverDisponibilidade(
    entrada({
      instante_atual: { data: DATA, minuto_min: agora },
      indisponiveis: [bloqueio(min(10), min(11))],
      modo: { tipo: 'horario_exato', horario_min: min(10) },
    })
  );

  assert.equal(r.tipo, 'horario_exato_indisponivel');
  if (r.tipo !== 'horario_exato_indisponivel') return;
  // Livre [08:00, 10:00): o ultimo inicio possivel e 09:20, exatamente o
  // instante atual -- e por isso descartado, sem sobrar vizinho anterior.
  assert.equal(r.anterior, undefined);
  assert.equal(hhmm(r.posterior?.inicio_min ?? -1), '11:00');
});

test('DIS-22: vizinho estritamente posterior ao instante atual e mantido', () => {
  const agora = min(9, 10);
  const r = resolverDisponibilidade(
    entrada({
      instante_atual: { data: DATA, minuto_min: agora },
      indisponiveis: [bloqueio(min(10), min(11))],
      modo: { tipo: 'horario_exato', horario_min: min(10) },
    })
  );

  assert.equal(r.tipo, 'horario_exato_indisponivel');
  if (r.tipo !== 'horario_exato_indisponivel') return;
  assert.equal(hhmm(r.anterior?.inicio_min ?? -1), '09:20');
  assert.equal(hhmm(r.posterior?.inicio_min ?? -1), '11:00');
  for (const vizinho of [r.anterior, r.posterior]) {
    assert.equal((vizinho?.inicio_min ?? -1) > agora, true);
  }
});

test('DIS-22: proximo_disponivel devolve o menor inicio estritamente posterior', () => {
  const r = resolverDisponibilidade(
    entrada({
      instante_atual: { data: DATA, minuto_min: min(9) },
      modo: { tipo: 'proximo_disponivel' },
    })
  );

  // 08:00 esta vencido e 09:00 e igual ao instante atual: sobra 10:00.
  assert.deepEqual(iniciosDe(r), ['10:00']);
});

test('DIS-22: data futura nao sofre nenhum recorte', () => {
  const r = resolverDisponibilidade(
    entrada({ instante_atual: { data: '2026-01-05', minuto_min: min(23, 59) } })
  );
  assert.deepEqual(iniciosDe(r), ['08:00', '09:00', '10:00', '11:20']);
});

// =====================================================================
// Configuracao invalida (falha fechada)
// =====================================================================

test('duracao fora do contrato de duracao-v1 devolve duracao_invalida', () => {
  const invalidas: readonly unknown[] = [
    0,
    5,
    250,
    45,
    40.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '40',
    null,
  ];

  for (const duracao of invalidas) {
    const r = resolverDisponibilidade(entrada({ duracao_min: duracao as number }));
    assert.deepEqual(
      r,
      { tipo: 'configuracao_invalida', motivo: 'duracao_invalida' },
      String(duracao)
    );
  }
});

test('data inexistente no calendario devolve data_invalida', () => {
  const invalidas = ['2026-02-30', '2026-13-01', '2026-00-10', '2026-09-31', '15/09/2026', ''];

  for (const data of invalidas) {
    const r = resolverDisponibilidade(entrada({ data }));
    assert.deepEqual(r, { tipo: 'configuracao_invalida', motivo: 'data_invalida' }, data);
  }
});

test('29 de fevereiro e valido em ano bissexto e invalido fora dele', () => {
  const bissexto = resolverDisponibilidade(
    entrada({ data: '2028-02-29', jornadas: [jornada(min(8), min(12), { data: '2028-02-29' })] })
  );
  assert.equal(bissexto.tipo, 'opcoes');

  const naoBissexto = resolverDisponibilidade(entrada({ data: '2027-02-29' }));
  assert.deepEqual(naoBissexto, { tipo: 'configuracao_invalida', motivo: 'data_invalida' });

  // 2100 nao e bissexto (regra dos multiplos de 100).
  const seculo = resolverDisponibilidade(entrada({ data: '2100-02-29' }));
  assert.deepEqual(seculo, { tipo: 'configuracao_invalida', motivo: 'data_invalida' });
});

test('fuso ausente devolve fuso_invalido', () => {
  for (const fuso of ['', '   ']) {
    const r = resolverDisponibilidade(entrada({ fuso }));
    assert.deepEqual(r, { tipo: 'configuracao_invalida', motivo: 'fuso_invalido' });
  }
});

test('horario exato fora do dominio devolve horario_solicitado_invalido', () => {
  for (const horario_min of [-10, 1441, 90.5, Number.NaN]) {
    const r = resolverDisponibilidade(
      entrada({ modo: { tipo: 'horario_exato', horario_min } })
    );
    assert.deepEqual(
      r,
      { tipo: 'configuracao_invalida', motivo: 'horario_solicitado_invalido' },
      String(horario_min)
    );
  }
});

test('restricao horaria fora do dominio devolve restricao_invalida', () => {
  const r = resolverDisponibilidade(
    entrada({ modo: { tipo: 'grade', restricao: { tipo: 'inicio_ate', minuto_min: 2000 } } })
  );
  assert.deepEqual(r, { tipo: 'configuracao_invalida', motivo: 'restricao_invalida' });
});

test('instante atual ausente ou mal formado devolve instante_atual_invalido', () => {
  const invalidos: readonly unknown[] = [
    null,
    {},
    { data: DATA },
    { data: '2026-02-30', minuto_min: 600 },
    { data: DATA, minuto_min: -1 },
    { data: DATA, minuto_min: 1441 },
    { data: DATA, minuto_min: '600' },
  ];

  for (const instante of invalidos) {
    const r = resolverDisponibilidade(
      entrada({ instante_atual: instante as EntradaDisponibilidade['instante_atual'] })
    );
    assert.deepEqual(
      r,
      { tipo: 'configuracao_invalida', motivo: 'instante_atual_invalido' },
      JSON.stringify(instante)
    );
  }
});

test('ausencia total de jornada devolve sem_jornada, nunca sem_disponibilidade', () => {
  const r = resolverDisponibilidade(entrada({ jornadas: [] }));
  assert.deepEqual(r, { tipo: 'configuracao_invalida', motivo: 'sem_jornada' });
});

// =====================================================================
// Erro estrutural de intervalos (determinismo e sanitizacao)
// =====================================================================

test('intervalos invertidos sao TODOS agregados, nunca somente o primeiro', () => {
  const r = resolverDisponibilidade(
    entrada({
      jornadas: [jornada(min(12), min(8)), jornada(min(18), min(14))],
      indisponiveis: [bloqueio(min(16), min(15))],
    })
  );

  assert.equal(r.tipo, 'erro_intervalos');
  if (r.tipo !== 'erro_intervalos') return;
  assert.equal(r.codigo, 'intervalo_invertido');
  assert.deepEqual(r.intervalos, [
    { inicio_min: min(12), fim_min: min(8) },
    { inicio_min: min(16), fim_min: min(15) },
    { inicio_min: min(18), fim_min: min(14) },
  ]);
});

test('intervalo degenerado (inicio igual ao fim) e invertido', () => {
  const r = resolverDisponibilidade(entrada({ jornadas: [jornada(min(9), min(9))] }));
  assert.equal(r.tipo, 'erro_intervalos');
  if (r.tipo !== 'erro_intervalos') return;
  assert.equal(r.codigo, 'intervalo_invertido');
});

test('minutos fora do dominio sao TODOS agregados', () => {
  const r = resolverDisponibilidade(
    entrada({
      jornadas: [jornada(-60, min(10)), jornada(min(9), 1500)],
      indisponiveis: [bloqueio(min(9), 90.5)],
    })
  );

  assert.equal(r.tipo, 'erro_intervalos');
  if (r.tipo !== 'erro_intervalos') return;
  assert.equal(r.codigo, 'minuto_fora_do_dominio');
  assert.equal(r.intervalos.length, 3);
});

test('minuto_fora_do_dominio tem precedencia sobre intervalo_invertido', () => {
  const r = resolverDisponibilidade(
    entrada({ jornadas: [jornada(min(12), min(8)), jornada(-30, min(10))] })
  );

  assert.equal(r.tipo, 'erro_intervalos');
  if (r.tipo !== 'erro_intervalos') return;
  assert.equal(r.codigo, 'minuto_fora_do_dominio');
  // Somente o ofensor de dominio e reportado sob este codigo.
  assert.deepEqual(r.intervalos, [{ inicio_min: -30, fim_min: min(10) }]);
});

test('o resultado nao depende da ordem de entrada dos intervalos quebrados', () => {
  const quebradas = [jornada(min(18), min(14)), jornada(min(12), min(8)), jornada(min(16), min(15))];
  const invertidas = [...quebradas].reverse();

  const a = resolverDisponibilidade(entrada({ jornadas: quebradas }));
  const b = resolverDisponibilidade(entrada({ jornadas: invertidas }));

  assert.deepEqual(a, b);
});

test('valor runtime nao numerico nunca vaza para o resultado publico', () => {
  const contaminada = jornada(min(8), min(12));
  const sujo = { cpf: '52998224725' };
  (contaminada as unknown as Record<string, unknown>).inicio_min = sujo;
  (contaminada as unknown as Record<string, unknown>).fim_min = 'segredo-paciente';

  const r = resolverDisponibilidade(entrada({ jornadas: [contaminada] }));

  assert.equal(r.tipo, 'erro_intervalos');
  if (r.tipo !== 'erro_intervalos') return;
  assert.equal(r.codigo, 'minuto_fora_do_dominio');
  // Nenhuma das duas coordenadas e segura: ambas as chaves sao OMITIDAS.
  assert.deepEqual(r.intervalos, [{}]);
  assert.equal('inicio_min' in r.intervalos[0], false);
  assert.equal('fim_min' in r.intervalos[0], false);

  const serializado = JSON.stringify(r);
  assert.equal(serializado.includes('segredo-paciente'), false);
  assert.equal(serializado.includes('52998224725'), false);
});

test('a coordenada finita e preservada quando so a outra e insegura', () => {
  const contaminada = jornada(min(8), min(12));
  (contaminada as unknown as Record<string, unknown>).inicio_min = 'texto';

  const r = resolverDisponibilidade(entrada({ jornadas: [contaminada] }));

  assert.equal(r.tipo, 'erro_intervalos');
  if (r.tipo !== 'erro_intervalos') return;
  assert.deepEqual(r.intervalos, [{ fim_min: min(12) }]);
});

test('minuto finito porem fora do dominio viaja intacto para auditoria', () => {
  const r = resolverDisponibilidade(entrada({ jornadas: [jornada(-30, 1500)] }));

  assert.equal(r.tipo, 'erro_intervalos');
  if (r.tipo !== 'erro_intervalos') return;
  assert.deepEqual(r.intervalos, [{ inicio_min: -30, fim_min: 1500 }]);
});

test('valores nao finitos nao tornam o resultado dependente da ordem', () => {
  const construir = (ordem: readonly number[]): ResultadoDisponibilidade =>
    resolverDisponibilidade(
      entrada({ jornadas: ordem.map((inicio) => jornada(inicio, min(12))) })
    );

  assert.deepEqual(
    construir([Number.NaN, min(8)]),
    construir([min(8), Number.NaN])
  );
});

test('intervalo quebrado fora do escopo nao derruba a consulta', () => {
  const r = resolverDisponibilidade(
    entrada({
      jornadas: [
        jornada(min(8), min(10)),
        jornada(min(18), min(14), { dentista_id: DENTISTA_B }),
        jornada(-90, min(12), { clinica_id: CLINICA_B }),
        jornada(min(20), min(19), { data: '2026-09-16' }),
      ],
    })
  );

  assert.deepEqual(iniciosDe(r), ['08:00', '09:20']);
});

// =====================================================================
// Identidade da opcao (secao 16)
// =====================================================================

test('cada opcao preserva a identidade oficial completa', () => {
  const r = resolverDisponibilidade(entrada());

  assert.equal(r.tipo, 'opcoes');
  if (r.tipo !== 'opcoes') return;
  for (const opcao of r.opcoes) {
    assert.deepEqual(Object.keys(opcao).sort(), [
      'clinica_id',
      'data',
      'dentista_id',
      'duracao_min',
      'fim_min',
      'fuso',
      'inicio_min',
      'procedimento_id',
    ]);
    assert.equal(opcao.clinica_id, CLINICA_A);
    assert.equal(opcao.procedimento_id, PROCEDIMENTO);
    assert.equal(opcao.dentista_id, DENTISTA_A);
    assert.equal(opcao.data, DATA);
    assert.equal(opcao.fuso, FUSO);
    assert.equal(opcao.duracao_min, 40);
  }
});

test('as opcoes saem ordenadas e sem duplicatas', () => {
  const r = resolverDisponibilidade(
    entrada({ jornadas: [jornada(min(8), min(12)), jornada(min(8), min(12))] })
  );

  const inicios = iniciosDe(r);
  assert.deepEqual(inicios, ['08:00', '09:00', '10:00', '11:20']);
  assert.deepEqual([...new Set(inicios)], inicios);
});

// =====================================================================
// Contrato de forma da entrada
// =====================================================================

test('entrada que nao e objeto e rejeitada', () => {
  for (const invalida of [null, 'x', 42, []]) {
    assert.throws(
      () => resolverDisponibilidade(invalida as unknown as EntradaDisponibilidade),
      EntradaInvalidaError
    );
  }
});

test('propriedade desconhecida na entrada e rejeitada sem reproduzir valores', () => {
  const comExtra = { ...entrada(), telefone: '+5511999999999' };

  assert.throws(
    () => resolverDisponibilidade(comExtra as unknown as EntradaDisponibilidade),
    (erro: unknown) => {
      assert.equal(erro instanceof EntradaInvalidaError, true);
      assert.equal((erro as Error).message.includes('+5511999999999'), false);
      assert.equal((erro as Error).message.includes('telefone'), false);
      return true;
    }
  );
});

test('identidades ausentes ou vazias sao rejeitadas', () => {
  for (const campo of ['clinica_id', 'procedimento_id', 'dentista_id'] as const) {
    for (const valor of ['', '   ', 42, null]) {
      const invalida = { ...entrada(), [campo]: valor };
      assert.throws(
        () => resolverDisponibilidade(invalida as unknown as EntradaDisponibilidade),
        (erro: unknown) => {
          assert.equal(erro instanceof EntradaInvalidaError, true);
          assert.equal((erro as EntradaInvalidaError).campo, campo);
          return true;
        }
      );
    }
  }
});

test('jornadas e indisponiveis precisam ser arrays', () => {
  assert.throws(
    () =>
      resolverDisponibilidade({
        ...entrada(),
        jornadas: null,
      } as unknown as EntradaDisponibilidade),
    EntradaInvalidaError
  );
  assert.throws(
    () =>
      resolverDisponibilidade({
        ...entrada(),
        indisponiveis: 'nenhum',
      } as unknown as EntradaDisponibilidade),
    EntradaInvalidaError
  );
});

// =====================================================================
// Forma minima dos itens de `jornadas` e `indisponiveis`
// =====================================================================

/** Um item sem estrutura minima nao pode ser filtrado por escopo. */
const ITENS_SEM_ESTRUTURA: ReadonlyArray<readonly [string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['string', 'texto'],
  ['numero', 123],
  ['array', []],
  ['booleano', false],
  ['funcao', () => 480],
  ['symbol', Symbol('jornada')],
  ['bigint', 10n],
];

function rejeitaItemDeColecao(campo: 'jornadas' | 'indisponiveis', item: unknown, rotulo: string): void {
  const invalida = { ...entrada(), [campo]: [item] };

  assert.throws(
    () => resolverDisponibilidade(invalida as unknown as EntradaDisponibilidade),
    (erro: unknown) => {
      assert.equal(erro instanceof EntradaInvalidaError, true, `${rotulo}: tipo de erro`);
      // A regressao original era exatamente esta: `TypeError` ao ler
      // `clinica_id` de um item sem propriedades.
      assert.equal(erro instanceof TypeError, false, `${rotulo}: TypeError`);
      assert.equal((erro as EntradaInvalidaError).campo, campo, `${rotulo}: campo`);
      return true;
    },
    `${campo} ${rotulo}`
  );
}

test('item sem estrutura minima em jornadas falha de forma controlada', () => {
  for (const [rotulo, item] of ITENS_SEM_ESTRUTURA) {
    rejeitaItemDeColecao('jornadas', item, rotulo);
  }
});

test('item sem estrutura minima em indisponiveis falha de forma controlada', () => {
  for (const [rotulo, item] of ITENS_SEM_ESTRUTURA) {
    rejeitaItemDeColecao('indisponiveis', item, rotulo);
  }
});

test('item quebrado nunca e descartado em silencio', () => {
  // Antes da barreira, um primitivo em `indisponiveis` nao casava com o
  // escopo e sumia: o resolvedor devolvia `opcoes` e oferecia como livre um
  // horario que deveria estar bloqueado. Nenhuma variante publica pode
  // sair de uma colecao com item quebrado.
  for (const [rotulo, item] of ITENS_SEM_ESTRUTURA) {
    for (const campo of ['jornadas', 'indisponiveis'] as const) {
      const invalida = { ...entrada(), [campo]: [item] };
      let resultado: unknown;
      try {
        resultado = resolverDisponibilidade(invalida as unknown as EntradaDisponibilidade);
      } catch {
        continue;
      }
      assert.fail(`${campo} ${rotulo}: devolveu ${JSON.stringify(resultado)} em vez de falhar`);
    }
  }
});

test('o erro de item quebrado nao reproduz o valor recebido', () => {
  const invalida = { ...entrada(), jornadas: ['52998224725'] };

  assert.throws(
    () => resolverDisponibilidade(invalida as unknown as EntradaDisponibilidade),
    (erro: unknown) => {
      const mensagem = (erro as Error).message;
      assert.equal(mensagem.includes('52998224725'), false);
      assert.equal(mensagem, 'jornadas contem item que nao e um objeto');
      return true;
    }
  );
});

test('a ordem dos itens quebrados nao altera o erro observavel', () => {
  const capturar = (campo: 'jornadas' | 'indisponiveis', itens: readonly unknown[]): string => {
    try {
      resolverDisponibilidade({ ...entrada(), [campo]: itens } as unknown as EntradaDisponibilidade);
    } catch (erro) {
      const controlado = erro as EntradaInvalidaError;
      return `${controlado.name}|${controlado.campo}|${controlado.message}`;
    }
    return 'sem erro';
  };

  for (const campo of ['jornadas', 'indisponiveis'] as const) {
    assert.equal(capturar(campo, [null, undefined]), capturar(campo, [undefined, null]));
    assert.notEqual(capturar(campo, [null, undefined]), 'sem erro');
  }
});

test('a barreira de forma nao afeta itens validos', () => {
  // Propriedade adicional inerte, item de outra clinica, de outro dentista e
  // de outra data continuam aceitos e apenas filtrados pelo escopo.
  const comExtras = jornada(min(8), min(12));
  (comExtras as unknown as Record<string, unknown>).observacao = 'anotacao interna';

  const r = resolverDisponibilidade(
    entrada({
      jornadas: [
        comExtras,
        jornada(min(14), min(18), { clinica_id: CLINICA_B }),
        jornada(min(14), min(18), { dentista_id: DENTISTA_B }),
        jornada(min(14), min(18), { data: '2026-09-16' }),
      ],
      indisponiveis: [bloqueio(min(9), min(10), { clinica_id: CLINICA_B })],
    })
  );

  assert.deepEqual(iniciosDe(r), ['08:00', '09:00', '10:00', '11:20']);
});

test('coordenada invalida em item bem formado continua produzindo erro_intervalos', () => {
  // A nova barreira nao pode transformar erro de coordenada em erro de forma.
  const dentroDoEscopo = resolverDisponibilidade(entrada({ jornadas: [jornada(-30, min(10))] }));
  assert.equal(dentroDoEscopo.tipo, 'erro_intervalos');

  const foraDoEscopo = resolverDisponibilidade(
    entrada({
      jornadas: [jornada(min(8), min(12)), jornada(-30, min(10), { clinica_id: CLINICA_B })],
    })
  );
  assert.deepEqual(iniciosDe(foraDoEscopo), ['08:00', '09:00', '10:00', '11:20']);
});

test('modo desconhecido e rejeitado', () => {
  for (const modo of [null, {}, { tipo: 'qualquer_horario' }, { tipo: 42 }, []]) {
    assert.throws(
      () =>
        resolverDisponibilidade({ ...entrada(), modo } as unknown as EntradaDisponibilidade),
      EntradaInvalidaError
    );
  }
});

// =====================================================================
// Serializacao publica
// =====================================================================

/**
 * Percorre o resultado inteiro e recusa qualquer folha que nao seja string,
 * numero finito ou booleano. Isso elimina de uma vez `null`, `undefined`,
 * `NaN`, infinitos, `symbol`, `bigint`, funcao e objeto runtime bruto.
 */
function auditarValorPublico(valor: unknown, caminho: string): void {
  if (typeof valor === 'number') {
    assert.equal(Number.isFinite(valor), true, `${caminho}: numero nao finito`);
    return;
  }
  if (typeof valor === 'string' || typeof valor === 'boolean') return;

  if (Array.isArray(valor)) {
    valor.forEach((item, indice) => auditarValorPublico(item, `${caminho}[${indice}]`));
    return;
  }

  if (
    valor !== null &&
    typeof valor === 'object' &&
    Object.getPrototypeOf(valor) === Object.prototype
  ) {
    assert.equal(Object.getOwnPropertySymbols(valor).length, 0, `${caminho}: chave symbol`);
    for (const [chave, item] of Object.entries(valor)) {
      auditarValorPublico(item, `${caminho}.${chave}`);
    }
    return;
  }

  assert.fail(`${caminho}: valor nao permitido no resultado publico (${typeof valor})`);
}

function verificarSerializacao(resultado: ResultadoDisponibilidade, rotulo: string): void {
  auditarValorPublico(resultado, rotulo);

  let json = '';
  // `bigint` faria o proprio stringify lancar.
  assert.doesNotThrow(() => {
    json = JSON.stringify(resultado);
  }, rotulo);

  // `null` no JSON so poderia vir de `NaN` ou infinito serializados: nenhum
  // identificador sintetico deste arquivo contem o texto "null".
  assert.equal(json.includes('null'), false, `${rotulo}: null derivado da serializacao`);
  assert.deepEqual(JSON.parse(json), resultado, `${rotulo}: round-trip`);
}

test('todas as variantes publicas fazem round-trip por JSON com seguranca', () => {
  const variantes: ReadonlyArray<readonly [string, ResultadoDisponibilidade]> = [
    ['opcoes', resolverDisponibilidade(entrada())],
    [
      'sem_disponibilidade',
      resolverDisponibilidade(entrada({ indisponiveis: [bloqueio(min(8), min(12))] })),
    ],
    [
      'horario_exato_disponivel',
      resolverDisponibilidade(
        entrada({ modo: { tipo: 'horario_exato', horario_min: min(9, 20) } })
      ),
    ],
    [
      'horario_exato_indisponivel (dois vizinhos)',
      resolverDisponibilidade(
        entrada({
          indisponiveis: [bloqueio(min(9), min(10))],
          modo: { tipo: 'horario_exato', horario_min: min(9) },
        })
      ),
    ],
    [
      'horario_exato_indisponivel (sem vizinho)',
      resolverDisponibilidade(
        entrada({
          jornadas: [jornada(min(8), min(8, 30))],
          modo: { tipo: 'horario_exato', horario_min: min(8) },
        })
      ),
    ],
    ['configuracao_invalida', resolverDisponibilidade(entrada({ jornadas: [] }))],
    [
      'erro_intervalos (invertido)',
      resolverDisponibilidade(entrada({ jornadas: [jornada(min(12), min(8))] })),
    ],
    [
      'erro_intervalos (fora do dominio)',
      resolverDisponibilidade(entrada({ jornadas: [jornada(-30, 1500)] })),
    ],
  ];

  const tiposCobertos = new Set(variantes.map(([, r]) => r.tipo));
  assert.equal(tiposCobertos.size, 6, 'as seis variantes precisam estar cobertas');

  for (const [rotulo, resultado] of variantes) {
    verificarSerializacao(resultado, rotulo);
  }
});

test('nenhum valor runtime hostil atravessa para o resultado publico', () => {
  const hostis: ReadonlyArray<readonly [string, unknown]> = [
    ['string', 'texto-arbitrario'],
    ['objeto', { cpf: '52998224725' }],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['null', null],
    ['undefined', undefined],
    ['array', [480, 720]],
    ['booleano', true],
    ['symbol', Symbol('minuto')],
    ['bigint', 10n],
    ['funcao', () => 480],
  ];

  for (const [rotulo, hostil] of hostis) {
    // A entrada NAO e sanitizada antes da chamada: o valor bruto chega ao
    // resolvedor exatamente como viria da configuracao.
    const contaminada = jornada(min(8), min(12));
    (contaminada as unknown as Record<string, unknown>).inicio_min = hostil;

    const r = resolverDisponibilidade(entrada({ jornadas: [contaminada] }));

    assert.equal(r.tipo, 'erro_intervalos', rotulo);
    if (r.tipo !== 'erro_intervalos') continue;
    assert.equal(r.codigo, 'minuto_fora_do_dominio', rotulo);
    // A coordenada insegura some; a finita permanece.
    assert.deepEqual(r.intervalos, [{ fim_min: min(12) }], rotulo);
    verificarSerializacao(r, rotulo);
  }
});

test('erros equivalentes sao deterministicos e sobrevivem ao round-trip', () => {
  const construir = (jornadas: readonly JornadaDentista[]): ResultadoDisponibilidade =>
    resolverDisponibilidade(entrada({ jornadas }));

  const quebradas = [jornada(min(18), min(14)), jornada(min(12), min(8)), jornada(min(16), min(15))];
  const a = construir(quebradas);
  const b = construir([...quebradas].reverse());

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  verificarSerializacao(a, 'ordem original');
  verificarSerializacao(b, 'ordem invertida');
});

// =====================================================================
// Validacao runtime de `modo`
// =====================================================================

function rejeitaContrato(modo: unknown, rotulo: string): void {
  assert.throws(
    () => resolverDisponibilidade({ ...entrada(), modo } as unknown as EntradaDisponibilidade),
    (erro: unknown) => {
      assert.equal(erro instanceof EntradaInvalidaError, true, `${rotulo}: tipo de erro`);
      assert.equal(erro instanceof TypeError, false, `${rotulo}: TypeError`);
      return true;
    },
    rotulo
  );
}

test('modo mal formado e rejeitado de forma controlada, nunca com TypeError', () => {
  const invalidos: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['array', []],
    ['string', 'grade'],
    ['numero', 42],
    ['objeto vazio', {}],
    ['tipo ausente', { periodo: 'manha' }],
    ['tipo undefined', { tipo: undefined }],
    ['tipo nao string', { tipo: 42 }],
    ['discriminante desconhecido', { tipo: 'qualquer_horario' }],
  ];

  for (const [rotulo, modo] of invalidos) rejeitaContrato(modo, rotulo);
});

test('cada variante de modo rejeita propriedade adicional e campo de outra variante', () => {
  const invalidos: ReadonlyArray<readonly [string, unknown]> = [
    ['grade com propriedade adicional', { tipo: 'grade', limite: 4 }],
    ['grade com campo de horario exato', { tipo: 'grade', horario_min: min(9) }],
    ['proximo com periodo', { tipo: 'proximo_disponivel', periodo: 'manha' }],
    [
      'proximo com restricao',
      { tipo: 'proximo_disponivel', restricao: { tipo: 'inicio_ate', minuto_min: min(11) } },
    ],
    ['proximo com horario exato', { tipo: 'proximo_disponivel', horario_min: min(9) }],
    ['proximo com propriedade adicional', { tipo: 'proximo_disponivel', extra: true }],
    ['horario exato sem horario', { tipo: 'horario_exato' }],
    ['horario exato com periodo', { tipo: 'horario_exato', horario_min: min(9), periodo: 'manha' }],
    [
      'horario exato com restricao',
      {
        tipo: 'horario_exato',
        horario_min: min(9),
        restricao: { tipo: 'inicio_ate', minuto_min: min(11) },
      },
    ],
    ['horario exato nao numerico', { tipo: 'horario_exato', horario_min: '540' }],
    ['horario exato nulo', { tipo: 'horario_exato', horario_min: null }],
  ];

  for (const [rotulo, modo] of invalidos) rejeitaContrato(modo, rotulo);
});

test('as tres variantes bem formadas continuam aceitas', () => {
  const validos: readonly ModoConsulta[] = [
    { tipo: 'grade' },
    { tipo: 'grade', periodo: 'manha' },
    { tipo: 'grade', restricao: { tipo: 'inicio_ate', minuto_min: min(11) } },
    { tipo: 'grade', periodo: 'manha', restricao: { tipo: 'termino_ate', minuto_min: min(11) } },
    { tipo: 'proximo_disponivel' },
    { tipo: 'horario_exato', horario_min: min(9, 20) },
  ];

  for (const modo of validos) {
    assert.doesNotThrow(() => resolverDisponibilidade(entrada({ modo })), JSON.stringify(modo));
  }
});

// =====================================================================
// Validacao runtime de `periodo`
// =====================================================================

test('periodo previsto pela spec e aceito', () => {
  for (const periodo of ['manha', 'tarde', 'noite'] as const) {
    const r = resolverDisponibilidade(
      entrada({ jornadas: [jornada(min(8), min(21))], modo: { tipo: 'grade', periodo } })
    );
    assert.equal(r.tipo, 'opcoes', periodo);
  }
});

test('periodo invalido e rejeitado e NUNCA vira sem_disponibilidade', () => {
  const invalidos: ReadonlyArray<readonly [string, unknown]> = [
    ['desconhecido', 'madrugada'],
    ['string vazia', ''],
    ['null', null],
    ['numero', 1],
    ['objeto', { periodo: 'manha' }],
    ['array', ['manha']],
    ['booleano', true],
  ];

  for (const [rotulo, periodo] of invalidos) {
    rejeitaContrato({ tipo: 'grade', periodo }, `periodo ${rotulo}`);
  }
});

// =====================================================================
// Validacao runtime de `restricao`
// =====================================================================

test('restricao mal formada e rejeitada, sem cair em termino_ate por default', () => {
  const invalidas: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['array', []],
    ['string', 'inicio_ate'],
    ['objeto vazio', {}],
    ['discriminante ausente', { minuto_min: min(11) }],
    ['discriminante undefined', { tipo: undefined, minuto_min: min(11) }],
    ['discriminante desconhecido', { tipo: 'inicio_depois', minuto_min: min(11) }],
    ['discriminante nao string', { tipo: 7, minuto_min: min(11) }],
    ['limite ausente', { tipo: 'inicio_ate' }],
    ['limite nao numerico', { tipo: 'inicio_ate', minuto_min: '660' }],
    ['limite nulo', { tipo: 'termino_ate', minuto_min: null }],
    ['propriedade adicional', { tipo: 'inicio_ate', minuto_min: min(11), inclusivo: true }],
  ];

  for (const [rotulo, restricao] of invalidas) {
    rejeitaContrato({ tipo: 'grade', restricao }, `restricao ${rotulo}`);
  }
});

test('restricao sem discriminante nao e silenciosamente tratada como termino_ate', () => {
  // Se caisse em `termino_ate`, o resultado seria 08:00, 09:00 e 10:00.
  rejeitaContrato({ tipo: 'grade', restricao: { minuto_min: min(11) } }, 'sem discriminante');
});

test('limite fora do dominio devolve configuracao_invalida, nao excecao', () => {
  for (const minuto_min of [-1, 1441, 90.5, Number.NaN]) {
    const r = resolverDisponibilidade(
      entrada({ modo: { tipo: 'grade', restricao: { tipo: 'termino_ate', minuto_min } } })
    );
    assert.deepEqual(
      r,
      { tipo: 'configuracao_invalida', motivo: 'restricao_invalida' },
      String(minuto_min)
    );
  }
});

test('as duas restricoes validas preservam o comportamento aprovado', () => {
  const porInicio = resolverDisponibilidade(
    entrada({
      jornadas: [jornada(min(8), min(18))],
      modo: { tipo: 'grade', restricao: { tipo: 'inicio_ate', minuto_min: min(11) } },
    })
  );
  const porTermino = resolverDisponibilidade(
    entrada({
      jornadas: [jornada(min(8), min(18))],
      modo: { tipo: 'grade', restricao: { tipo: 'termino_ate', minuto_min: min(11) } },
    })
  );

  assert.deepEqual(iniciosDe(porInicio), ['08:00', '09:00', '10:00', '11:00']);
  assert.deepEqual(iniciosDe(porTermino), ['08:00', '09:00', '10:00']);
  assert.notDeepEqual(iniciosDe(porInicio), iniciosDe(porTermino));
});

test('a restricao nao depende da ordem das jornadas nem cria intervalo novo', () => {
  const jornadas = [jornada(min(13), min(18)), jornada(min(8), min(12))];
  const modo = { tipo: 'grade', restricao: { tipo: 'inicio_ate', minuto_min: min(14) } } as const;

  const a = resolverDisponibilidade(entrada({ jornadas, modo }));
  const b = resolverDisponibilidade(entrada({ jornadas: [...jornadas].reverse(), modo }));

  assert.deepEqual(a, b);
  // Cada horario restrito pertence a grade completa: nenhum inicio novo em
  // 14:00 foi fabricado pelo limite.
  const completa = iniciosDe(resolverDisponibilidade(entrada({ jornadas })));
  for (const horario of iniciosDe(a)) {
    assert.equal(completa.includes(horario), true, horario);
  }
});

test('a entrada nunca e mutada pelo resolvedor', () => {
  const original = entrada({
    jornadas: [jornada(min(8), min(12)), jornada(min(12), min(18))],
    indisponiveis: [bloqueio(min(13), min(14), { origem: 'almoco' })],
  });
  const copia = structuredClone(original);

  resolverDisponibilidade(original);

  assert.deepEqual(original, copia);
});

// ── DIA SEM EXPEDIENTE ≠ AGENDA CHEIA ≠ CONFIGURACAO QUEBRADA ────────────────
//
// Caso real, 2026-08-14: o paciente pediu um turno para sabado 15/08. Os dois
// dentistas da clinica tem `sabado: false`, entao nao havia jornada nesse dia.
// Lista de jornadas vazia caia em `configuracao_invalida/sem_jornada`, que
// virava `informar_falha_tecnica`, e o paciente ouviu:
//
//   "estamos com uma falha tecnica e nao conseguimos confirmar agendamentos"
//
// Nao havia falha nenhuma. O profissional so nao atende no sabado.

test('dia sem expediente: resultado NORMAL, nunca configuracao_invalida', () => {
  const resultado = resolverDisponibilidade(
    entrada({ jornadas: [], sem_expediente_no_dia: 'profissional_nao_atende' })
  );

  assert.deepEqual(resultado, { tipo: 'sem_expediente_no_dia', motivo: 'profissional_nao_atende' });
});

test('domingo: mesmo resultado, motivo proprio -- e regra da clinica, nao do dentista', () => {
  const resultado = resolverDisponibilidade(entrada({ jornadas: [], sem_expediente_no_dia: 'domingo' }));

  assert.deepEqual(resultado, { tipo: 'sem_expediente_no_dia', motivo: 'domingo' });
});

test('agenda EXISTE e esta cheia: continua sem_disponibilidade, nunca sem_expediente', () => {
  const resultado = resolverDisponibilidade(
    entrada({
      jornadas: [jornada(min(8), min(12))],
      indisponiveis: [bloqueio(min(8), min(12))],
      sem_expediente_no_dia: null,
    })
  );

  assert.equal(resultado.tipo, 'sem_disponibilidade');
});

test('configuracao REALMENTE quebrada: segue configuracao_invalida -- a correcao nao a mascarou', () => {
  const resultado = resolverDisponibilidade(entrada({ jornadas: [], sem_expediente_no_dia: null }));

  assert.deepEqual(resultado, { tipo: 'configuracao_invalida', motivo: 'sem_jornada' });
});

test('marcador de sem expediente JUNTO com jornada e contraditorio: recusado, nunca resolvido', () => {
  // As duas afirmacoes nao podem ser verdadeiras ao mesmo tempo. Aceitar
  // significaria usar o marcador para IGNORAR a configuracao presente -- e um
  // dia com agenda suja passaria a responder "nao atendemos" em vez de expor o
  // defeito. A primeira versao desta correcao aceitava; estava errada.
  assert.throws(
    () => resolverDisponibilidade(entrada({ jornadas: [jornada(min(8), min(12))], sem_expediente_no_dia: 'domingo' })),
    EntradaInvalidaError
  );

  // Vale tambem com jornada estruturalmente invalida: a incoerencia da entrada
  // e recusada antes de qualquer outro julgamento.
  assert.throws(
    () => resolverDisponibilidade(entrada({ jornadas: [jornada(min(12), min(8))], sem_expediente_no_dia: 'domingo' })),
    EntradaInvalidaError
  );
});

test('sem_expediente_no_dia tem vocabulario FECHADO: qualquer outro valor e recusado', () => {
  for (const invalido of ['sabado', 'feriado', '', 'DOMINGO', 0, false, undefined, {}]) {
    assert.throws(
      () =>
        resolverDisponibilidade(
          entrada({ jornadas: [], sem_expediente_no_dia: invalido as never })
        ),
      EntradaInvalidaError,
      `valor ${JSON.stringify(invalido)} deveria ser recusado`
    );
  }
});
