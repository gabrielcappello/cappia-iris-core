// Resolvedor deterministico de duracao.
//
// Fonte: specs/duracao-v1.md · cenarios DUR-01 a DUR-09 de
// tests/cenarios-obrigatorios.md.
//
// Todos os dados sao sinteticos. Nenhum dado real de paciente ou clinica.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConfiguracaoDuracao, EntradaResolucaoDuracao } from './duracao-tipos.ts';
import { resolverDuracao } from './resolver-duracao.ts';
import { EntradaInvalidaError } from './erros.ts';

const CLINICA_A = 'clinica-sintetica-a';
const CLINICA_B = 'clinica-sintetica-b';
const LIMPEZA = 'proc-limpeza-a';
const IMPLANTE = 'proc-implante-a';
// A duracao passou a ser resolvida POR DENTISTA (2026-08-30). Os dois ids
// abaixo representam profissionais distintos da MESMA clinica.
const DENTISTA_1 = 'dent-sintetico-1';
const DENTISTA_2 = 'dent-sintetico-2';

function config(
  duracao_min: number,
  overrides: Partial<ConfiguracaoDuracao> = {}
): ConfiguracaoDuracao {
  return {
    clinica_id: CLINICA_A,
    dentista_id: DENTISTA_1,
    procedimento_id: LIMPEZA,
    duracao_min,
    ...overrides,
  };
}

function entrada(overrides: Partial<EntradaResolucaoDuracao> = {}): EntradaResolucaoDuracao {
  return {
    clinica_id: CLINICA_A,
    dentista_id: DENTISTA_1,
    procedimento_id: LIMPEZA,
    configuracoes: [config(50)],
    ...overrides,
  };
}

// =====================================================================
// Resolucao valida
// =====================================================================

test('DUR-01: configuracao unica valida resolve normalmente', () => {
  const r = resolverDuracao(entrada());

  assert.equal(r.tipo, 'resolvida');
  if (r.tipo !== 'resolvida') return;
  assert.equal(r.clinica_id, CLINICA_A);
  assert.equal(r.procedimento_id, LIMPEZA);
  assert.equal(r.duracao_min, 50);
});

test('DUR-01: duracao minima canonica (10) e valida', () => {
  const r = resolverDuracao(entrada({ configuracoes: [config(10)] }));

  assert.equal(r.tipo, 'resolvida');
  if (r.tipo === 'resolvida') assert.equal(r.duracao_min, 10);
});

test('DUR-01: duracao maxima canonica (240) e valida', () => {
  const r = resolverDuracao(entrada({ configuracoes: [config(240)] }));

  assert.equal(r.tipo, 'resolvida');
  if (r.tipo === 'resolvida') assert.equal(r.duracao_min, 240);
});

test('DUR-01: multiplos de 10 dentro dos limites sao validos', () => {
  for (const minutos of [10, 20, 30, 60, 90, 120, 150, 200, 240]) {
    const r = resolverDuracao(entrada({ configuracoes: [config(minutos)] }));
    assert.equal(r.tipo, 'resolvida', `deveria resolver: ${minutos}`);
    if (r.tipo === 'resolvida') assert.equal(r.duracao_min, minutos);
  }
});

test('duplicatas equivalentes nao geram ambiguidade', () => {
  const r = resolverDuracao(entrada({ configuracoes: [config(50), config(50), config(50)] }));

  assert.equal(r.tipo, 'resolvida');
  if (r.tipo === 'resolvida') assert.equal(r.duracao_min, 50);
});

// =====================================================================
// DURACAO POR DENTISTA (2026-08-30, decisao do Gabriel)
//
// SUBSTITUI a regra anterior ("a duracao nao depende de dentista -- a entrada
// nem aceita dentista"), que valia enquanto duracao por profissional estava
// fora da v1. Um caso real de producao (v91) mostrou o custo dela: tres
// dentistas com duracoes legitimamente diferentes para a mesma avaliacao
// (Perez 60, Ramoz 30, Arruda 30) faziam TODA a clinica cair em
// `duracao_conflitante` -- o paciente escolhia o Perez e recebia "instabilidade
// tecnica".
//
// Regra nova: cada dentista usa exclusivamente a propria duracao.
// =====================================================================

test('POR DENTISTA: cada profissional resolve a SUA duracao (Perez 60, Ramoz 30)', () => {
  // O caso real: mesma clinica, mesmo procedimento, duracoes diferentes.
  const configuracoes = [
    config(60, { dentista_id: DENTISTA_1 }),
    config(30, { dentista_id: DENTISTA_2 }),
  ];

  const perez = resolverDuracao(entrada({ dentista_id: DENTISTA_1, configuracoes }));
  assert.equal(perez.tipo, 'resolvida', 'escolher o primeiro dentista precisa resolver, nunca conflitar');
  if (perez.tipo === 'resolvida') assert.equal(perez.duracao_min, 60);

  const ramoz = resolverDuracao(entrada({ dentista_id: DENTISTA_2, configuracoes }));
  assert.equal(ramoz.tipo, 'resolvida');
  if (ramoz.tipo === 'resolvida') assert.equal(ramoz.duracao_min, 30);
});

test('POR DENTISTA: alterar a duracao de um profissional nao muda a do outro', () => {
  const antes = resolverDuracao(
    entrada({
      dentista_id: DENTISTA_1,
      configuracoes: [config(60, { dentista_id: DENTISTA_1 }), config(30, { dentista_id: DENTISTA_2 })],
    })
  );
  // So o valor do OUTRO dentista muda -- 30 vira 45.
  const depois = resolverDuracao(
    entrada({
      dentista_id: DENTISTA_1,
      configuracoes: [config(60, { dentista_id: DENTISTA_1 }), config(45, { dentista_id: DENTISTA_2 })],
    })
  );

  assert.deepEqual(antes, depois, 'a configuracao de outro profissional nunca pode influenciar esta resolucao');
});

test('POR DENTISTA: duracoes diferentes entre profissionais NUNCA geram conflito', () => {
  // Tres dentistas, tres configuracoes, duas duracoes distintas -- exatamente
  // a forma que derrubava a clinica inteira antes.
  const configuracoes = [
    config(60, { dentista_id: DENTISTA_1 }),
    config(30, { dentista_id: DENTISTA_2 }),
    config(30, { dentista_id: 'dent-sintetico-3' }),
  ];

  for (const [dentista, esperado] of [
    [DENTISTA_1, 60],
    [DENTISTA_2, 30],
    ['dent-sintetico-3', 30],
  ] as const) {
    const r = resolverDuracao(entrada({ dentista_id: dentista, configuracoes }));
    assert.equal(r.tipo, 'resolvida', `${dentista} deveria resolver`);
    if (r.tipo === 'resolvida') assert.equal(r.duracao_min, esperado);
  }
});

test('POR DENTISTA: contradicao DENTRO do mesmo dentista continua sendo conflito', () => {
  // A protecao nao foi enfraquecida: duas configuracoes divergentes para o
  // MESMO profissional e o MESMO procedimento seguem falhando fechado.
  const r = resolverDuracao(
    entrada({
      dentista_id: DENTISTA_1,
      configuracoes: [
        config(30, { dentista_id: DENTISTA_1 }),
        config(60, { dentista_id: DENTISTA_1 }),
        // ruido de outro profissional -- nao entra na comparacao
        config(90, { dentista_id: DENTISTA_2 }),
      ],
    })
  );

  assert.equal(r.tipo, 'erro_configuracao');
  if (r.tipo !== 'erro_configuracao') return;
  assert.equal(r.codigo, 'duracao_conflitante');
  assert.deepEqual(r.duracoes_conflitantes, [30, 60], 'so as duracoes DESTE dentista entram no conflito');
});

test('POR DENTISTA: configuracao de outro profissional nunca vira fallback', () => {
  // O dentista pedido nao tem configuracao; outro tem. Isso e
  // `nao_configurada` -- nunca "usa a do colega".
  const r = resolverDuracao(
    entrada({ dentista_id: DENTISTA_1, configuracoes: [config(30, { dentista_id: DENTISTA_2 })] })
  );

  assert.equal(r.tipo, 'nao_configurada');
});

test('POR DENTISTA: dentista_id ausente ou vazio e rejeitado', () => {
  const { dentista_id: _omitido, ...semDentista } = entrada();
  assert.throws(
    () => resolverDuracao(semDentista as unknown as EntradaResolucaoDuracao),
    EntradaInvalidaError,
    'sem dentista_id a resolucao voltaria a comparar profissionais diferentes -- tem que falhar alto'
  );
  assert.throws(() => resolverDuracao(entrada({ dentista_id: '   ' })), EntradaInvalidaError);
});

test('DUR-06: isolamento por clinica continua valendo mesmo com o mesmo dentista_id', () => {
  const r = resolverDuracao(
    entrada({ configuracoes: [config(30, { clinica_id: CLINICA_B, dentista_id: DENTISTA_1 })] })
  );

  assert.equal(r.tipo, 'nao_configurada', 'configuracao de outra clinica nunca e consultada');
});

// =====================================================================
// Nao configurada
// =====================================================================

test('DUR-03: lista de configuracoes vazia', () => {
  const r = resolverDuracao(entrada({ configuracoes: [] }));
  assert.equal(r.tipo, 'nao_configurada');
});

test('DUR-03: nenhuma configuracao para o procedimento pedido', () => {
  const r = resolverDuracao(entrada({ configuracoes: [config(50, { procedimento_id: IMPLANTE })] }));
  assert.equal(r.tipo, 'nao_configurada');
});

test('DUR-06: somente configuracao de outra clinica', () => {
  const r = resolverDuracao(entrada({ configuracoes: [config(50, { clinica_id: CLINICA_B })] }));
  assert.equal(r.tipo, 'nao_configurada');
});

test('DUR-03: ausencia nunca vira fallback -- nem 30, nem 60, nem catalogo-base', () => {
  const r = resolverDuracao(entrada({ configuracoes: [] }));

  assert.equal(r.tipo, 'nao_configurada');
  // Nenhuma variante do resultado carrega duracao quando nao configurada.
  assert.ok(!('duracao_min' in r));
});

test('DUR-05: ausencia de duracao nao produz Consulta/Avaliacao nem qualquer outro desvio', () => {
  const r = resolverDuracao(entrada({ configuracoes: [] }));

  // Falha fechada pura: um unico desfecho, sem sugestao alternativa.
  assert.deepEqual(r, { tipo: 'nao_configurada' });
});

// =====================================================================
// Duracao invalida
// =====================================================================

test('DUR-04: zero e valores negativos ficam abaixo do minimo', () => {
  for (const minutos of [0, -1, -10, -240]) {
    const r = resolverDuracao(entrada({ configuracoes: [config(minutos)] }));
    assert.equal(r.tipo, 'invalida', `deveria ser invalida: ${minutos}`);
    if (r.tipo === 'invalida') {
      assert.equal(r.motivo, 'abaixo_do_minimo');
      assert.equal(r.valor_recebido, minutos);
    }
  }
});

test('DUR-04: valor abaixo de 10 e invalido', () => {
  for (const minutos of [1, 5, 9]) {
    const r = resolverDuracao(entrada({ configuracoes: [config(minutos)] }));
    assert.equal(r.tipo, 'invalida');
    if (r.tipo === 'invalida') assert.equal(r.motivo, 'abaixo_do_minimo');
  }
});

test('DUR-04: valor acima de 240 e invalido', () => {
  for (const minutos of [250, 300, 1440]) {
    const r = resolverDuracao(entrada({ configuracoes: [config(minutos)] }));
    assert.equal(r.tipo, 'invalida');
    if (r.tipo === 'invalida') assert.equal(r.motivo, 'acima_do_maximo');
  }
});

test('DUR-04: decimal e invalido e nunca truncado', () => {
  const r = resolverDuracao(entrada({ configuracoes: [config(30.5)] }));

  assert.equal(r.tipo, 'invalida');
  if (r.tipo !== 'invalida') return;
  assert.equal(r.motivo, 'nao_inteira');
  // Valor preservado exatamente como recebido -- nao virou 30 nem 31.
  assert.equal(r.valor_recebido, 30.5);
});

test('DUR-04: nao multiplo de 10 e invalido e nunca arredondado', () => {
  for (const minutos of [15, 25, 45, 55, 235]) {
    const r = resolverDuracao(entrada({ configuracoes: [config(minutos)] }));
    assert.equal(r.tipo, 'invalida', `deveria ser invalida: ${minutos}`);
    if (r.tipo === 'invalida') {
      assert.equal(r.motivo, 'nao_multipla_de_10');
      // Nunca ajustado para o multiplo de 10 mais proximo.
      assert.equal(r.valor_recebido, minutos);
    }
  }
});

test('DUR-04: string em runtime e invalida, nunca convertida e nunca propagada', () => {
  const r = resolverDuracao(
    entrada({ configuracoes: [config('30' as unknown as number)] })
  );

  assert.equal(r.tipo, 'invalida');
  if (r.tipo !== 'invalida') return;
  assert.equal(r.motivo, 'nao_numerica');
  // Correcao 0155: valor nao finito nunca viaja no resultado.
  assert.ok(!('valor_recebido' in r));
  assert.ok(!JSON.stringify(r).includes('30'));
});

test('DUR-04: NaN e infinitos sao invalidos', () => {
  for (const valor of [NaN, Infinity, -Infinity]) {
    const r = resolverDuracao(entrada({ configuracoes: [config(valor)] }));
    assert.equal(r.tipo, 'invalida');
    if (r.tipo === 'invalida') assert.equal(r.motivo, 'nao_numerica');
  }
});

test('DUR-04: null e undefined em runtime sao invalidos', () => {
  for (const valor of [null, undefined]) {
    const r = resolverDuracao(entrada({ configuracoes: [config(valor as unknown as number)] }));
    assert.equal(r.tipo, 'invalida');
    if (r.tipo === 'invalida') assert.equal(r.motivo, 'nao_numerica');
  }
});

test('DUR-04: horas nunca sao convertidas para minutos', () => {
  // 1 (uma "hora") permanece abaixo do minimo em minutos -- nunca vira 60.
  const r = resolverDuracao(entrada({ configuracoes: [config(1)] }));

  assert.equal(r.tipo, 'invalida');
  if (r.tipo === 'invalida') {
    assert.equal(r.motivo, 'abaixo_do_minimo');
    assert.equal(r.valor_recebido, 1);
  }
});

test('DUR-05: duracao invalida nao produz Consulta/Avaliacao nem consulta disponibilidade', () => {
  const r = resolverDuracao(entrada({ configuracoes: [config(15)] }));

  // Falha fechada: so o motivo e o valor recebido, nada mais.
  assert.deepEqual(r, { tipo: 'invalida', motivo: 'nao_multipla_de_10', valor_recebido: 15 });
});

// =====================================================================
// Erro estrutural
// =====================================================================

test('mesmo procedimento com duas duracoes distintas e erro de configuracao', () => {
  const r = resolverDuracao(entrada({ configuracoes: [config(30), config(50)] }));

  assert.equal(r.tipo, 'erro_configuracao');
  if (r.tipo !== 'erro_configuracao') return;
  assert.equal(r.codigo, 'duracao_conflitante');
  assert.deepEqual(r.procedimento_ids, [LIMPEZA]);
  assert.deepEqual(r.duracoes_conflitantes, [30, 50]);
});

test('conflito nunca escolhe primeiro, ultimo, menor nem maior', () => {
  const r = resolverDuracao(entrada({ configuracoes: [config(30), config(50)] }));

  assert.equal(r.tipo, 'erro_configuracao');
  assert.notEqual(r.tipo, 'resolvida');
});

test('conflito: inversao da ordem nao muda o erro nem os valores', () => {
  const a = resolverDuracao(entrada({ configuracoes: [config(30), config(50)] }));
  const b = resolverDuracao(entrada({ configuracoes: [config(50), config(30)] }));

  assert.deepEqual(a, b);
});

test('conflito com mais de dois valores: todos agregados, deduplicados e ordenados', () => {
  const r = resolverDuracao(
    entrada({ configuracoes: [config(100), config(30), config(50), config(30), config(100)] })
  );

  assert.equal(r.tipo, 'erro_configuracao');
  if (r.tipo !== 'erro_configuracao') return;
  // Ordenacao NUMERICA (nao lexicografica: 100 nao vem antes de 30).
  assert.deepEqual(r.duracoes_conflitantes, [30, 50, 100]);
});

test('conflito tem precedencia sobre invalidez: dois valores invalidos ainda sao conflito', () => {
  const a = resolverDuracao(entrada({ configuracoes: [config(15), config(25)] }));
  const b = resolverDuracao(entrada({ configuracoes: [config(25), config(15)] }));

  assert.equal(a.tipo, 'erro_configuracao');
  if (a.tipo === 'erro_configuracao') {
    assert.equal(a.codigo, 'duracao_conflitante');
    assert.deepEqual(a.duracoes_conflitantes, [15, 25]);
  }
  // Deterministico: nunca reporta a invalidez de um dos dois conforme a ordem.
  assert.deepEqual(a, b);
});

// =====================================================================
// Sanitizacao runtime (correcao 0155)
//
// Valor nao numerico ou nao finito falha ANTES de qualquer agregacao de
// conflito. Antes desta correcao, `[NaN, 20]` produzia
// `duracoes_conflitantes: [null, 20]` e `[20, NaN]` produzia `[20, null]`
// -- saidas diferentes para a mesma configuracao. Pior: string e objeto
// vindos da configuracao atravessavam ate o resultado publico.
// =====================================================================

const TEXTO_ARBITRARIO = 'segredo-paciente-sintetico';

test('0155: NaN combinado com numero valido -- invalida, deterministico, sem conflito', () => {
  const a = resolverDuracao(entrada({ configuracoes: [config(NaN), config(20)] }));
  const b = resolverDuracao(entrada({ configuracoes: [config(20), config(NaN)] }));

  assert.deepEqual(a, b);
  assert.equal(a.tipo, 'invalida');
  if (a.tipo !== 'invalida') return;
  assert.equal(a.motivo, 'nao_numerica');
  assert.ok(!('valor_recebido' in a));
  // Nunca vira conflito, e nunca serializa `null` derivado de NaN.
  assert.ok(!('duracoes_conflitantes' in a));
  assert.ok(!JSON.stringify(a).includes('null'));
});

test('0155: infinitos combinados com numero valido -- invalida em qualquer ordem', () => {
  const combinacoes = [
    [config(Infinity), config(20)],
    [config(20), config(Infinity)],
    [config(-Infinity), config(20)],
    [config(20), config(-Infinity)],
    [config(Infinity), config(-Infinity), config(20)],
  ];

  const resultados = combinacoes.map((configuracoes) => resolverDuracao(entrada({ configuracoes })));

  for (const r of resultados) {
    assert.equal(r.tipo, 'invalida');
    if (r.tipo !== 'invalida') continue;
    assert.equal(r.motivo, 'nao_numerica');
    assert.ok(!('duracoes_conflitantes' in r));
    const serializado = JSON.stringify(r);
    assert.ok(!serializado.includes('null'));
    assert.ok(!serializado.includes('Infinity'));
  }

  // Todas estruturalmente identicas entre si.
  for (const r of resultados) assert.deepEqual(r, resultados[0]);
});

test('0155: string runtime combinada com numero valido nunca vaza no resultado', () => {
  const a = resolverDuracao(
    entrada({ configuracoes: [config(TEXTO_ARBITRARIO as unknown as number), config(20)] })
  );
  const b = resolverDuracao(
    entrada({ configuracoes: [config(20), config(TEXTO_ARBITRARIO as unknown as number)] })
  );

  assert.deepEqual(a, b);
  assert.equal(a.tipo, 'invalida');
  if (a.tipo !== 'invalida') return;
  assert.equal(a.motivo, 'nao_numerica');
  assert.ok(!('duracoes_conflitantes' in a));
  assert.ok(!JSON.stringify(a).includes(TEXTO_ARBITRARIO));
});

test('0155: objeto runtime nao e reproduzido nem quebra a serializacao', () => {
  const objetoSintetico = { cpf: '52998224725', nome: 'Zulmira Sintetica' };
  const r = resolverDuracao(
    entrada({ configuracoes: [config(objetoSintetico as unknown as number), config(20)] })
  );

  assert.equal(r.tipo, 'invalida');
  if (r.tipo !== 'invalida') return;
  assert.equal(r.motivo, 'nao_numerica');
  assert.ok(!('valor_recebido' in r));

  // Nem o objeto, nem qualquer um de seus campos.
  const serializado = JSON.stringify(r);
  assert.doesNotThrow(() => JSON.stringify(r));
  assert.ok(!serializado.includes('52998224725'));
  assert.ok(!serializado.includes('Zulmira'));
  assert.ok(!serializado.includes('cpf'));
});

test('0155: array e null runtime tambem sao invalidos sem propagacao', () => {
  for (const valor of [[10, 20], null, undefined, true]) {
    const r = resolverDuracao(
      entrada({ configuracoes: [config(valor as unknown as number), config(20)] })
    );
    assert.equal(r.tipo, 'invalida');
    if (r.tipo !== 'invalida') continue;
    assert.equal(r.motivo, 'nao_numerica');
    assert.ok(!('valor_recebido' in r));
    assert.ok(!('duracoes_conflitantes' in r));
  }
});

test('0155: numero finito invalido continua preservado em valor_recebido', () => {
  for (const minutos of [30.5, 0, 250, 15]) {
    const r = resolverDuracao(entrada({ configuracoes: [config(minutos)] }));
    assert.equal(r.tipo, 'invalida');
    if (r.tipo !== 'invalida') continue;
    assert.equal(r.valor_recebido, minutos);
    assert.equal(typeof r.valor_recebido, 'number');
  }
});

test('0155: propriedade de serializacao segura em todos os desfechos possiveis', () => {
  const objetoSintetico = { cpf: '52998224725' };
  const cenarios: unknown[][] = [
    [], // nao_configurada
    [config(50)], // resolvida
    [config(15)], // invalida finita
    [config(30), config(50)], // conflito numerico
    [config(NaN), config(20)], // nao numerica
    [config(Infinity), config(20)],
    [config(-Infinity), config(20)],
    [config(TEXTO_ARBITRARIO as unknown as number), config(20)],
    [config(objetoSintetico as unknown as number), config(20)],
    [config(null as unknown as number)],
  ];

  for (const configuracoes of cenarios) {
    const r = resolverDuracao(entrada({ configuracoes: configuracoes as never }));

    let serializado = '';
    assert.doesNotThrow(() => {
      serializado = JSON.stringify(r);
    });

    assert.ok(!serializado.includes('null'), `null em: ${serializado}`);
    assert.ok(!serializado.includes('NaN'), `NaN em: ${serializado}`);
    assert.ok(!serializado.includes('Infinity'), `Infinity em: ${serializado}`);
    assert.ok(!serializado.includes(TEXTO_ARBITRARIO), `texto arbitrario em: ${serializado}`);
    assert.ok(!serializado.includes('52998224725'), `objeto runtime em: ${serializado}`);

    // Round-trip preserva exatamente o mesmo resultado.
    assert.deepEqual(JSON.parse(serializado), r);
  }
});

// =====================================================================
// Escopo da validacao
// =====================================================================

test('DUR-10-escopo: conflito em OUTRO procedimento nao bloqueia a duracao pedida', () => {
  const r = resolverDuracao(
    entrada({
      configuracoes: [
        config(50),
        config(30, { procedimento_id: IMPLANTE }),
        config(90, { procedimento_id: IMPLANTE }),
      ],
    })
  );

  assert.equal(r.tipo, 'resolvida');
  if (r.tipo === 'resolvida') assert.equal(r.duracao_min, 50);
});

test('configuracao invalida de OUTRO procedimento nao interfere', () => {
  const r = resolverDuracao(
    entrada({ configuracoes: [config(50), config(7, { procedimento_id: IMPLANTE })] })
  );

  assert.equal(r.tipo, 'resolvida');
  if (r.tipo === 'resolvida') assert.equal(r.duracao_min, 50);
});

test('DUR-06: configuracao invalida ou conflitante de OUTRA clinica nao interfere', () => {
  const r = resolverDuracao(
    entrada({
      configuracoes: [
        config(50),
        config(7, { clinica_id: CLINICA_B }),
        config(30, { clinica_id: CLINICA_B }),
        config(90, { clinica_id: CLINICA_B }),
      ],
    })
  );

  assert.equal(r.tipo, 'resolvida');
  if (r.tipo === 'resolvida') assert.equal(r.duracao_min, 50);
});

test('DUR-06: duracao de outra clinica nunca e retornada', () => {
  // Mesma clinica sem configuracao; a outra clinica tem uma valida.
  const r = resolverDuracao(
    entrada({ configuracoes: [config(90, { clinica_id: CLINICA_B })] })
  );

  assert.equal(r.tipo, 'nao_configurada');
});

test('mesmo procedimento_id em clinicas diferentes resolve valores independentes', () => {
  const configuracoes = [config(50), config(90, { clinica_id: CLINICA_B })];

  const naA = resolverDuracao(entrada({ configuracoes }));
  const naB = resolverDuracao(entrada({ clinica_id: CLINICA_B, configuracoes }));

  assert.equal(naA.tipo, 'resolvida');
  assert.equal(naB.tipo, 'resolvida');
  if (naA.tipo !== 'resolvida' || naB.tipo !== 'resolvida') return;
  assert.equal(naA.duracao_min, 50);
  assert.equal(naB.duracao_min, 90);
});

// =====================================================================
// Seguranca
// =====================================================================

test('resolucao ocorre somente por ID -- nome ou alias nunca participam', () => {
  // Uma configuracao cuja chave e o nome do procedimento, nao o ID, nao
  // pode ser encontrada.
  const r = resolverDuracao(
    entrada({ configuracoes: [config(50, { procedimento_id: 'Limpeza dental' })] })
  );

  assert.equal(r.tipo, 'nao_configurada');
});

test('erro de configuracao nao expoe nome de procedimento nem catalogo completo', () => {
  const r = resolverDuracao(entrada({ configuracoes: [config(30), config(50)] }));

  assert.equal(r.tipo, 'erro_configuracao');
  const serializado = JSON.stringify(r);
  assert.ok(!serializado.includes('Limpeza'));
  assert.ok(!serializado.includes('nome'));
});

// =====================================================================
// Determinismo e pureza
// =====================================================================

test('determinismo: ordem das configuracoes nao altera o resultado', () => {
  const base = [config(50), config(30, { procedimento_id: IMPLANTE }), config(90, { clinica_id: CLINICA_B })];

  const a = resolverDuracao(entrada({ configuracoes: base }));
  const b = resolverDuracao(entrada({ configuracoes: [...base].reverse() }));

  assert.deepEqual(a, b);
});

test('determinismo: mesma entrada retorna resultado igual', () => {
  const casos: ConfiguracaoDuracao[][] = [
    [config(50)],
    [],
    [config(15)],
    [config(30), config(50)],
    [config(50, { clinica_id: CLINICA_B })],
  ];

  for (const configuracoes of casos) {
    assert.deepEqual(resolverDuracao(entrada({ configuracoes })), resolverDuracao(entrada({ configuracoes })));
  }
});

test('determinismo: a entrada nao e mutada pelo resolvedor', () => {
  const configuracoes = [config(50), config(30, { procedimento_id: IMPLANTE })];
  const antes = JSON.stringify(configuracoes);

  resolverDuracao(entrada({ configuracoes }));

  assert.equal(JSON.stringify(configuracoes), antes);
});

test('propriedade: valores invalidos nunca sao ajustados para um valor valido', () => {
  for (const minutos of [0, 1, 5, 9, 15, 25, 30.5, 245, 250]) {
    const r = resolverDuracao(entrada({ configuracoes: [config(minutos)] }));
    assert.equal(r.tipo, 'invalida', `deveria ser invalida: ${minutos}`);
    if (r.tipo === 'invalida') assert.equal(r.valor_recebido, minutos);
  }
});

// =====================================================================
// Contrato de entrada
// =====================================================================

test('clinica_id ou procedimento_id ausente/vazio e violacao de contrato', () => {
  for (const overrides of [{ clinica_id: '' }, { clinica_id: '   ' }, { procedimento_id: '' }, { procedimento_id: '  ' }]) {
    assert.throws(() => resolverDuracao(entrada(overrides)), EntradaInvalidaError);
  }
});

test('entrada com propriedade adicional e rejeitada', () => {
  assert.throws(
    () =>
      resolverDuracao({
        ...entrada(),
        duracao_min: 60,
      } as unknown as EntradaResolucaoDuracao),
    EntradaInvalidaError
  );
});

test('configuracoes fora de array e violacao de contrato', () => {
  assert.throws(
    () => resolverDuracao(entrada({ configuracoes: null as unknown as ConfiguracaoDuracao[] })),
    EntradaInvalidaError
  );
});

test('erro de contrato nunca reproduz texto do paciente', () => {
  const textoDoPaciente = 'uma limpeza pra Zulmira Bettencourt';
  let capturado: unknown;
  try {
    resolverDuracao({
      clinica_id: '',
      procedimento_id: LIMPEZA,
      configuracoes: [],
      observacao: textoDoPaciente,
    } as unknown as EntradaResolucaoDuracao);
  } catch (erro) {
    capturado = erro;
  }

  assert.ok(capturado instanceof EntradaInvalidaError);
  const representacao = JSON.stringify(capturado) + (capturado as Error).message;
  assert.ok(!representacao.includes('Zulmira'));
  assert.ok(!representacao.includes(textoDoPaciente));
});
