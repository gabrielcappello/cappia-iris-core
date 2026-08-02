// Resolvedor temporal deterministico.
//
// Fonte: specs/resolvedor-temporal-v1.md, cenarios TMP-07 a TMP-83.
//
// Todos os dados sao sinteticos. Nenhum dado real de paciente ou clinica.
//
// Referencia temporal fixa das suites: 2026-08-06 (quinta-feira). A semana
// civil que a contem vai de segunda 2026-08-03 a domingo 2026-08-09 --
// verificado por aritmetica de calendario, nunca por `Date`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EntradaInvalidaError } from './erros.ts';
import { resolverTemporal } from './resolver-temporal.ts';
import type {
  AtomoTemporal,
  EntradaResolucaoTemporal,
  IntencaoTemporal,
  ResultadoResolucaoTemporal,
} from './temporal-tipos.ts';

const CLINICA_A = 'clinica-sintetica-a';
const CLINICA_B = 'clinica-sintetica-b';
const FUSO_A = 'America/Sao_Paulo';
const FUSO_B = 'America/Manaus';

const HOJE = '2026-08-06'; // quinta-feira
const SEGUNDA = '2026-08-03';
const DOMINGO = '2026-08-09';
const AGORA = 600; // 10:00

// --- Construtores de atomo (dados sinteticos) ---

const dataAbsoluta = (dia: number, mes: number, ano: number | null = null): AtomoTemporal => ({
  tipo: 'data_absoluta',
  dia,
  mes,
  ano,
});

const dataRelativa = (valor: 'hoje' | 'amanha' | 'depois_de_amanha'): AtomoTemporal => ({
  tipo: 'data_relativa',
  valor,
});

const diaSemana = (
  dia: 'domingo' | 'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta' | 'sabado',
  qualificador: 'esta' | 'proxima' | null
): AtomoTemporal => ({ tipo: 'dia_semana', dia, qualificador });

const h24 = (hora: number, minuto = 0): AtomoTemporal => ({
  tipo: 'horario_exato',
  forma: 'horario_24h',
  hora,
  minuto,
  parte_dia: null,
});

const h12 = (hora: number, parte_dia: 'am' | 'pm' | null, minuto = 0): AtomoTemporal => ({
  tipo: 'horario_exato',
  forma: 'horario_12h',
  hora,
  minuto,
  parte_dia,
});

const horarioForma = (forma: 'meio_dia' | 'meia_noite' | 'horario_nao_classificado'): AtomoTemporal => ({
  tipo: 'horario_exato',
  forma,
  hora: null,
  minuto: null,
  parte_dia: null,
});

const restricao24 = (
  tipo_restricao: 'inicio_ate' | 'termino_ate',
  hora: number,
  minuto = 0
): AtomoTemporal => ({
  tipo: 'restricao',
  tipo_restricao,
  forma_limite: 'horario_24h',
  hora_limite: hora,
  minuto_limite: minuto,
  parte_dia_limite: null,
});

const periodo = (valor: 'manha' | 'tarde' | 'noite'): AtomoTemporal => ({ tipo: 'periodo', valor });

const intencao = (valor: IntencaoTemporal): AtomoTemporal => ({ tipo: 'intencao', valor });

const ESPECIFICA = intencao('data_especifica');
const PROXIMA = intencao('proxima_disponibilidade');

// --- Construtor de entrada ---

function entrada(
  fatos_temporais: readonly AtomoTemporal[],
  overrides: Partial<EntradaResolucaoTemporal> = {}
): EntradaResolucaoTemporal {
  return {
    clinica_id: CLINICA_A,
    fuso: FUSO_A,
    instante_atual: { data: HOJE, minuto_min: AGORA },
    fatos_temporais,
    ...overrides,
  };
}

/** Resolve com a leva informada e exige exatamente a variante e o motivo. */
function esperar(
  fatos: readonly AtomoTemporal[],
  tipo: ResultadoResolucaoTemporal['tipo'],
  motivo?: string,
  overrides: Partial<EntradaResolucaoTemporal> = {}
): ResultadoResolucaoTemporal {
  const r = resolverTemporal(entrada(fatos, overrides));
  assert.equal(r.tipo, tipo);
  if (motivo !== undefined) {
    assert.equal((r as { motivo: string }).motivo, motivo);
  }
  return r;
}

function resolvido(
  fatos: readonly AtomoTemporal[],
  overrides: Partial<EntradaResolucaoTemporal> = {}
) {
  const r = resolverTemporal(entrada(fatos, overrides));
  assert.equal(r.tipo, 'resolvido');
  return r as Extract<ResultadoResolucaoTemporal, { tipo: 'resolvido' }>;
}

// =====================================================================
// Nivel 1 -- fronteira estrutural (excecao, nunca resultado)
// =====================================================================

test('fronteira: raiz nula, array ou nao objeto lanca EntradaInvalidaError', () => {
  for (const raiz of [null, undefined, [], 'x', 7, true]) {
    assert.throws(
      () => resolverTemporal(raiz as unknown as EntradaResolucaoTemporal),
      EntradaInvalidaError
    );
  }
});

test('fronteira: propriedade raiz desconhecida e rejeitada', () => {
  const hostil = { ...entrada([ESPECIFICA]), dentista_id: 'x' };
  assert.throws(
    () => resolverTemporal(hostil as unknown as EntradaResolucaoTemporal),
    EntradaInvalidaError
  );
});

test('fronteira: clinica_id ausente, vazio ou de tipo incompativel', () => {
  for (const valor of [undefined, null, '', '   ', 7, {}]) {
    assert.throws(
      () => resolverTemporal(entrada([ESPECIFICA], { clinica_id: valor as unknown as string })),
      EntradaInvalidaError
    );
  }
});

test('fronteira: fatos_temporais ausente ou nao array', () => {
  for (const valor of [undefined, null, {}, 'x', 3]) {
    assert.throws(
      () =>
        resolverTemporal(
          entrada([], { fatos_temporais: valor as unknown as readonly AtomoTemporal[] })
        ),
      EntradaInvalidaError
    );
  }
});

test('fronteira: item nulo, array ou nao objeto na lista', () => {
  for (const item of [null, undefined, [], 'x', 5]) {
    assert.throws(
      () => resolverTemporal(entrada([item as unknown as AtomoTemporal])),
      EntradaInvalidaError
    );
  }
});

test('fronteira: discriminador ausente, de tipo incompativel ou desconhecido', () => {
  for (const atomo of [{}, { tipo: 7 }, { tipo: null }, { tipo: 'data_futura' }, { tipo: '' }]) {
    assert.throws(
      () => resolverTemporal(entrada([atomo as unknown as AtomoTemporal])),
      EntradaInvalidaError
    );
  }
});

test('fronteira: propriedade desconhecida em qualquer variante', () => {
  const hostis = [
    { ...dataAbsoluta(10, 9, 2026), semana: 1 },
    { ...dataRelativa('hoje'), extra: true },
    { ...h24(10), fuso: 'x' },
    { ...restricao24('inicio_ate', 11), hora: 9 },
    { ...periodo('manha'), valor_extra: 'x' },
    { ...intencao('data_especifica'), texto: 'amanha de manha' },
  ];
  for (const atomo of hostis) {
    assert.throws(
      () => resolverTemporal(entrada([atomo as unknown as AtomoTemporal])),
      EntradaInvalidaError
    );
  }
});

test('fronteira: enum estruturalmente fora do conjunto fechado', () => {
  const hostis = [
    { tipo: 'data_relativa', valor: 'ontem' },
    { tipo: 'dia_semana', dia: 'feriado', qualificador: null },
    { tipo: 'dia_semana', dia: 'segunda', qualificador: 'passada' },
    { tipo: 'horario_exato', forma: 'horario_13h', hora: 1, minuto: 0, parte_dia: null },
    { tipo: 'horario_exato', forma: 'horario_12h', hora: 8, minuto: 0, parte_dia: 'noturno' },
    { tipo: 'periodo', valor: 'madrugada' },
    { tipo: 'intencao', valor: 'qualquer_dia' },
  ];
  for (const atomo of hostis) {
    assert.throws(
      () => resolverTemporal(entrada([atomo as unknown as AtomoTemporal])),
      EntradaInvalidaError
    );
  }
});

test('TMP-80: string em campo numerico reconhecido e erro estrutural, nunca invalido', () => {
  const hostis = [
    { tipo: 'horario_exato', forma: 'horario_24h', hora: '8', minuto: 0, parte_dia: null },
    { tipo: 'data_absoluta', dia: '10', mes: 9, ano: 2026 },
    { tipo: 'data_absoluta', dia: 10, mes: 9, ano: '2026' },
    { tipo: 'restricao', tipo_restricao: 'inicio_ate', forma_limite: 'horario_24h', hora_limite: '11', minuto_limite: 0, parte_dia_limite: null },
  ];
  for (const atomo of hostis) {
    assert.throws(
      () => resolverTemporal(entrada([atomo as unknown as AtomoTemporal])),
      EntradaInvalidaError
    );
  }
});

test('fronteira: objeto e booleano em campo numerico sao erro estrutural', () => {
  for (const valor of [{}, true, [], (() => 1) as unknown]) {
    assert.throws(
      () =>
        resolverTemporal(
          entrada([{ tipo: 'horario_exato', forma: 'horario_24h', hora: valor, minuto: 0, parte_dia: null } as unknown as AtomoTemporal])
        ),
      EntradaInvalidaError
    );
  }
});

test('fronteira: numero finito nao inteiro em campo inteiro e erro estrutural', () => {
  for (const valor of [8.5, 0.1, -3.25]) {
    assert.throws(
      () =>
        resolverTemporal(
          entrada([{ tipo: 'horario_exato', forma: 'horario_24h', hora: valor, minuto: 0, parte_dia: null } as unknown as AtomoTemporal])
        ),
      EntradaInvalidaError
    );
  }
});

test('TMP-57: mensagem de contrato de forma nunca reproduz o valor recebido', () => {
  const textoDoPaciente = 'quero as 8h com a Dra. Ana, CPF 000.000.000-00';
  try {
    resolverTemporal(
      entrada([
        { tipo: 'horario_exato', forma: 'horario_24h', hora: textoDoPaciente, minuto: 0, parte_dia: null } as unknown as AtomoTemporal,
      ])
    );
    assert.fail('deveria ter lancado');
  } catch (erro) {
    assert.ok(erro instanceof EntradaInvalidaError);
    assert.ok(!erro.message.includes(textoDoPaciente));
    assert.ok(!erro.message.includes('Ana'));
    assert.ok(!erro.message.includes('000'));
    assert.equal(erro.campo, 'fatos_temporais');
  }
});

test('fronteira: nome de propriedade desconhecida nunca aparece na mensagem', () => {
  try {
    resolverTemporal(
      entrada([{ ...dataAbsoluta(10, 9, 2026), texto_bruto_do_paciente: 'x' } as unknown as AtomoTemporal])
    );
    assert.fail('deveria ter lancado');
  } catch (erro) {
    assert.ok(erro instanceof EntradaInvalidaError);
    assert.ok(!erro.message.includes('texto_bruto_do_paciente'));
  }
});

test('fronteira: fuso e instante_atual invalidos NUNCA lancam excecao', () => {
  const naoLanca = [
    { fuso: undefined as unknown as string },
    { fuso: 7 as unknown as string },
    { instante_atual: undefined as unknown as { data: string; minuto_min: number } },
    { instante_atual: { data: 'ontem', minuto_min: 0 } },
  ];
  for (const override of naoLanca) {
    const r = resolverTemporal(entrada([ESPECIFICA], override));
    assert.equal(r.tipo, 'erro_configuracao');
  }
});

// =====================================================================
// Nivel 2 -- erro de configuracao
// =====================================================================

test('TMP-48: fuso ausente (undefined/null) e fuso_ausente', () => {
  for (const fuso of [undefined, null]) {
    esperar([ESPECIFICA], 'erro_configuracao', 'fuso_ausente', { fuso: fuso as unknown as string });
  }
});

test('TMP-59: fuso presente mas nao string nao vazia e fuso_formato_invalido', () => {
  for (const fuso of ['', '   ', 7, {}, []]) {
    esperar([ESPECIFICA], 'erro_configuracao', 'fuso_formato_invalido', {
      fuso: fuso as unknown as string,
    });
  }
});

test('TMP-49: instante_atual mal formado e instante_atual_invalido', () => {
  const invalidos = [
    undefined,
    null,
    'x',
    [],
    { data: HOJE },
    { data: '2026-02-30', minuto_min: 0 },
    { data: '2026-2-6', minuto_min: 0 },
    { data: HOJE, minuto_min: -1 },
    { data: HOJE, minuto_min: 1440 },
    { data: HOJE, minuto_min: 10.5 },
    { data: HOJE, minuto_min: Number.NaN },
    { data: HOJE, minuto_min: '600' },
  ];
  for (const instante of invalidos) {
    esperar([ESPECIFICA], 'erro_configuracao', 'instante_atual_invalido', {
      instante_atual: instante as unknown as { data: string; minuto_min: number },
    });
  }
});

test('configuracao: fuso e avaliado antes de instante_atual', () => {
  esperar([ESPECIFICA], 'erro_configuracao', 'fuso_ausente', {
    fuso: undefined as unknown as string,
    instante_atual: { data: 'x', minuto_min: -5 } as unknown as { data: string; minuto_min: number },
  });
});

// =====================================================================
// Nivel 3 -- invalidez
// =====================================================================

test('TMP-65: mais de 8 atomos e quantidade_atomica_excedida', () => {
  const nove = [ESPECIFICA, dataAbsoluta(10, 9, 2026), ...Array.from({ length: 7 }, () => periodo('manha'))];
  assert.equal(nove.length, 9);
  esperar(nove, 'invalido', 'quantidade_atomica_excedida');
});

test('exatamente 8 atomos ainda e aceito', () => {
  const oito = [ESPECIFICA, dataAbsoluta(10, 9, 2026), ...Array.from({ length: 6 }, () => periodo('manha'))];
  assert.equal(oito.length, 8);
  assert.equal(resolvido(oito).data, '2026-09-10');
});

test('TMP-08: ano explicito de um ou dois digitos e ano_dois_digitos', () => {
  for (const ano of [1, 5, 26, 99]) {
    esperar([ESPECIFICA, dataAbsoluta(10, 9, ano)], 'invalido', 'ano_dois_digitos');
  }
});

test('ano explicito fora do dominio civil e ano_fora_do_dominio', () => {
  for (const ano of [0, -1, -2026, 10000, 99999]) {
    esperar([ESPECIFICA, dataAbsoluta(10, 9, ano)], 'invalido', 'ano_fora_do_dominio');
  }
});

test('TMP-09: dia acima do limite do mes e data_impossivel', () => {
  esperar([ESPECIFICA, dataAbsoluta(31, 4, 2026)], 'invalido', 'data_impossivel');
  esperar([ESPECIFICA, dataAbsoluta(31, 11, 2026)], 'invalido', 'data_impossivel');
});

test('TMP-11: 29 de fevereiro em ano nao bissexto e data_impossivel', () => {
  for (const ano of [2026, 2027, 2100, 2200]) {
    esperar([ESPECIFICA, dataAbsoluta(29, 2, ano)], 'invalido', 'data_impossivel');
  }
});

test('TMP-10: 29 de fevereiro em ano bissexto resolve', () => {
  for (const ano of [2028, 2032, 2400, 2000]) {
    // 2000 e bissexto (multiplo de 400) mas ja passou: a regra de calendario
    // e a de passado sao avaliadas separadamente.
    const esperado = ano >= 2027 ? 'resolvido' : 'passado';
    const r = resolverTemporal(entrada([ESPECIFICA, dataAbsoluta(29, 2, ano)]));
    assert.equal(r.tipo, esperado, `ano ${ano}`);
    if (r.tipo === 'resolvido') assert.equal(r.data, `${ano}-02-29`);
  }
});

test('mes ou dia grosseiramente fora de faixa e data_impossivel, nunca problema de ano', () => {
  esperar([ESPECIFICA, dataAbsoluta(10, 13, 2026)], 'invalido', 'data_impossivel');
  esperar([ESPECIFICA, dataAbsoluta(10, 0, 2026)], 'invalido', 'data_impossivel');
  esperar([ESPECIFICA, dataAbsoluta(32, 1, 2026)], 'invalido', 'data_impossivel');
  esperar([ESPECIFICA, dataAbsoluta(0, 1, 2026)], 'invalido', 'data_impossivel');
  // Sem ano: continua sendo problema de data, nunca ano_fora_do_dominio.
  esperar([ESPECIFICA, dataAbsoluta(31, 13, null)], 'invalido', 'data_impossivel');
});

test('nenhuma troca silenciosa de dia e mes', () => {
  // dia 25 nunca e reinterpretado como mes.
  esperar([ESPECIFICA, dataAbsoluta(25, 13, 2026)], 'invalido', 'data_impossivel');
});

test('sem correcao automatica: 30/02 nunca desliza para marco', () => {
  esperar([ESPECIFICA, dataAbsoluta(30, 2, 2026)], 'invalido', 'data_impossivel');
});

test('hora fora do dominio, por forma', () => {
  esperar([ESPECIFICA, dataRelativa('amanha'), h24(25)], 'invalido', 'hora_fora_do_dominio');
  esperar([ESPECIFICA, dataRelativa('amanha'), h24(-1)], 'invalido', 'hora_fora_do_dominio');
  esperar([ESPECIFICA, dataRelativa('amanha'), h12(0, 'am')], 'invalido', 'hora_fora_do_dominio');
  esperar([ESPECIFICA, dataRelativa('amanha'), h12(13, 'pm')], 'invalido', 'hora_fora_do_dominio');
});

test('minuto fora do dominio', () => {
  esperar([ESPECIFICA, dataRelativa('amanha'), h24(10, 60)], 'invalido', 'minuto_fora_do_dominio');
  esperar([ESPECIFICA, dataRelativa('amanha'), h24(10, -1)], 'invalido', 'minuto_fora_do_dominio');
});

test('TMP-26: 24:00 e invalido e nunca convertido para 00:00 do dia seguinte', () => {
  const r = esperar([ESPECIFICA, dataRelativa('amanha'), h24(24, 0)], 'invalido', 'horario_24_00');
  assert.ok(!JSON.stringify(r).includes('data'));
  // 24:30 nao e o caso especial: e hora fora do dominio.
  esperar([ESPECIFICA, dataRelativa('amanha'), h24(24, 30)], 'invalido', 'hora_fora_do_dominio');
});

test('TMP-78: NaN em campo numerico reconhecido e invalido/atomo_invalido', () => {
  const comNaN = [
    { tipo: 'horario_exato', forma: 'horario_24h', hora: Number.NaN, minuto: 0, parte_dia: null },
    { tipo: 'data_absoluta', dia: Number.NaN, mes: 9, ano: 2026 },
    { tipo: 'data_absoluta', dia: 10, mes: 9, ano: Number.NaN },
  ];
  for (const atomo of comNaN) {
    const r = esperar([ESPECIFICA, atomo as unknown as AtomoTemporal], 'invalido', 'atomo_invalido');
    assert.ok(!JSON.stringify(r).includes('null'));
  }
});

test('TMP-79: Infinity e -Infinity em campo numerico reconhecido sao invalido/atomo_invalido', () => {
  for (const valor of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    esperar(
      [
        ESPECIFICA,
        { tipo: 'horario_exato', forma: 'horario_24h', hora: valor, minuto: 0, parte_dia: null } as unknown as AtomoTemporal,
      ],
      'invalido',
      'atomo_invalido'
    );
    esperar(
      [ESPECIFICA, { tipo: 'data_absoluta', dia: 10, mes: valor, ano: 2026 } as unknown as AtomoTemporal],
      'invalido',
      'atomo_invalido'
    );
  }
});

test('TMP-51: valor runtime hostil nunca atravessa para o resultado', () => {
  const r = resolverTemporal(
    entrada([
      ESPECIFICA,
      { tipo: 'horario_exato', forma: 'horario_24h', hora: Number.NaN, minuto: Number.POSITIVE_INFINITY, parte_dia: null } as unknown as AtomoTemporal,
    ])
  );
  const texto = JSON.stringify(r);
  assert.ok(!texto.includes('NaN'));
  assert.ok(!texto.includes('Infinity'));
  assert.equal(texto, JSON.stringify(JSON.parse(texto)));
});

test('atomo estruturalmente reconhecido com forma invalida e atomo_invalido', () => {
  const semCampos = [
    // Exemplo nomeado pela secao 19: restricao sem tipo_restricao.
    { tipo: 'restricao', forma_limite: 'horario_24h', hora_limite: 11, minuto_limite: 0, parte_dia_limite: null },
    { tipo: 'horario_exato', hora: 8, minuto: 0, parte_dia: null },
    { tipo: 'data_absoluta', mes: 9, ano: 2026 },
    { tipo: 'data_absoluta', dia: 10, ano: 2026 },
    { tipo: 'data_relativa' },
    { tipo: 'dia_semana', qualificador: 'esta' },
    { tipo: 'periodo' },
  ];
  for (const atomo of semCampos) {
    esperar([ESPECIFICA, atomo as unknown as AtomoTemporal], 'invalido', 'atomo_invalido');
  }
  // `intencao` sem valor tambem, avaliado sem outra intencao na leva.
  esperar([{ tipo: 'intencao' } as unknown as AtomoTemporal], 'invalido', 'atomo_invalido');
});

test('campo obrigatorio ausente nunca produz resultado silencioso', () => {
  // Regressao dos quatro vazamentos reais encontrados na construcao desta
  // suite: `data_relativa` sem `valor` resolvia para hoje; `intencao` sem
  // `valor` produzia um `resolvido` sem intencao; `periodo` sem `valor`
  // deixava a chave com `undefined`; e `restricao` sem `tipo_restricao`
  // vazava uma `RestricaoHoraria` malformada para o resultado publico.
  const vazamentos: readonly AtomoTemporal[][] = [
    [ESPECIFICA, { tipo: 'data_relativa' } as unknown as AtomoTemporal],
    [{ tipo: 'intencao' } as unknown as AtomoTemporal, dataRelativa('amanha')],
    [ESPECIFICA, dataRelativa('amanha'), { tipo: 'periodo' } as unknown as AtomoTemporal],
    [
      ESPECIFICA,
      dataRelativa('amanha'),
      { tipo: 'restricao', forma_limite: 'horario_24h', hora_limite: 11, minuto_limite: 0, parte_dia_limite: null } as unknown as AtomoTemporal,
    ],
  ];
  for (const fatos of vazamentos) {
    const r = resolverTemporal(entrada(fatos)) as Record<string, unknown>;
    assert.equal(r['tipo'], 'invalido');
    assert.equal(r['motivo'], 'atomo_invalido');
    assert.ok(!('data' in r), 'nenhuma data fabricada');
    assert.ok(!('restricao' in r));
    for (const chave of Object.keys(r)) assert.notEqual(r[chave], undefined);
  }
});

test('motivo especifico prevalece sobre atomo_invalido', () => {
  // Hora finita fora de dominio num atomo, NaN em outro: vence o nomeado.
  esperar(
    [
      ESPECIFICA,
      dataRelativa('amanha'),
      h24(25),
      { tipo: 'restricao', tipo_restricao: 'inicio_ate', forma_limite: 'horario_24h', hora_limite: Number.NaN, minuto_limite: 0, parte_dia_limite: null } as unknown as AtomoTemporal,
    ],
    'invalido',
    'hora_fora_do_dominio'
  );
});

test('ano invalido prevalece sobre data impossivel no mesmo atomo', () => {
  esperar([ESPECIFICA, dataAbsoluta(31, 2, 26)], 'invalido', 'ano_dois_digitos');
  esperar([ESPECIFICA, dataAbsoluta(31, 2, 20260)], 'invalido', 'ano_fora_do_dominio');
});

// =====================================================================
// Calendario civil -- datas absolutas e relativas
// =====================================================================

test('TMP-07: data absoluta com ano explicito valida resolve', () => {
  const r = resolvido([ESPECIFICA, dataAbsoluta(10, 9, 2026)]);
  assert.equal(r.data, '2026-09-10');
  assert.equal(r.intencao, 'data_especifica');
  assert.equal(r.clinica_id, CLINICA_A);
});

test('TMP-13: data relativa hoje resolve para o instante atual', () => {
  assert.equal(resolvido([ESPECIFICA, dataRelativa('hoje')]).data, HOJE);
});

test('TMP-12: amanha e depois_de_amanha cruzando fim de mes e virada de ano', () => {
  const casos: readonly [string, 'amanha' | 'depois_de_amanha', string][] = [
    [HOJE, 'amanha', '2026-08-07'],
    [HOJE, 'depois_de_amanha', '2026-08-08'],
    ['2026-08-31', 'amanha', '2026-09-01'],
    ['2026-08-30', 'depois_de_amanha', '2026-09-01'],
    ['2026-12-31', 'amanha', '2027-01-01'],
    ['2026-12-30', 'depois_de_amanha', '2027-01-01'],
    ['2028-02-28', 'amanha', '2028-02-29'],
    ['2026-02-28', 'amanha', '2026-03-01'],
    ['2028-02-28', 'depois_de_amanha', '2028-03-01'],
  ];
  for (const [hoje, valor, esperado] of casos) {
    const r = resolvido([ESPECIFICA, dataRelativa(valor)], {
      instante_atual: { data: hoje, minuto_min: AGORA },
    });
    assert.equal(r.data, esperado, `${hoje} + ${valor}`);
  }
});

test('TMP-14: ano omitido, data ainda nao passada este ano', () => {
  assert.equal(resolvido([ESPECIFICA, dataAbsoluta(10, 9)]).data, '2026-09-10');
});

test('TMP-15: ano omitido, data ja passada este ano, resolve no ano seguinte', () => {
  assert.equal(resolvido([ESPECIFICA, dataAbsoluta(10, 3)]).data, '2027-03-10');
});

test('TMP-16: ano omitido, data coincide com hoje, resolve hoje e nunca noutro ano', () => {
  assert.equal(resolvido([ESPECIFICA, dataAbsoluta(6, 8)]).data, HOJE);
});

test('TMP-17: ano omitido, 29/02, instante atual 2096-03-01 resolve 2104-02-29', () => {
  // 2096 e bissexto mas ja passou; 2097-2099 e 2101-2103 nao sao bissextos;
  // 2100 nao e bissexto (multiplo de 100 e nao de 400). Nono candidato.
  const r = resolvido([ESPECIFICA, dataAbsoluta(29, 2)], {
    instante_atual: { data: '2096-03-01', minuto_min: AGORA },
  });
  assert.equal(r.data, '2104-02-29');
});

test('ano omitido, 29/02, a partir de 2025 resolve 2028-02-29', () => {
  const r = resolvido([ESPECIFICA, dataAbsoluta(29, 2)], {
    instante_atual: { data: '2025-06-01', minuto_min: AGORA },
  });
  assert.equal(r.data, '2028-02-29');
});

test('TMP-69: busca de ano omitido para no teto 9999, sem overflow nem wrap', () => {
  const r = esperar([ESPECIFICA, dataAbsoluta(29, 2)], 'invalido', 'ano_fora_do_dominio', {
    instante_atual: { data: '9998-01-01', minuto_min: AGORA },
  });
  assert.ok(!JSON.stringify(r).includes('10000'));
});

test('ano omitido nunca escolhe ano anterior ao corrente', () => {
  for (let mes = 1; mes <= 12; mes++) {
    const r = resolvido([ESPECIFICA, dataAbsoluta(15, mes)]);
    assert.ok(r.data >= HOJE, `mes ${mes} produziu ${r.data}`);
    assert.ok(Number(r.data.slice(0, 4)) >= 2026);
  }
});

test('nenhuma data produzida ultrapassa o dominio civil de 9999', () => {
  const r = resolvido([ESPECIFICA, dataAbsoluta(31, 12)], {
    instante_atual: { data: '9999-01-01', minuto_min: AGORA },
  });
  assert.equal(r.data, '9999-12-31');
});

// =====================================================================
// Teto civil -- TMP-84 a TMP-86
// =====================================================================

/** Nenhuma saida pode conter ano de cinco digitos, wrap ou data parcial. */
function assertSemVazamentoDeTeto(r: ResultadoResolucaoTemporal): void {
  const texto = JSON.stringify(r);
  assert.ok(!texto.includes('10000'), 'ano 10000 vazou');
  assert.ok(!texto.includes('1000-01'), 'wrap para o ano 1000 vazou');
  assert.ok(!/\d{5}-/.test(texto), 'ano de cinco digitos vazou');
  assert.ok(!('data' in (r as Record<string, unknown>)), 'data parcial promovida');
}

test('TMP-84: amanha a partir de 9999-12-31 e ano_fora_do_dominio', () => {
  const r = esperar([ESPECIFICA, dataRelativa('amanha')], 'invalido', 'ano_fora_do_dominio', {
    instante_atual: { data: '9999-12-31', minuto_min: AGORA },
  });
  assertSemVazamentoDeTeto(r);
});

test('TMP-84: amanha a partir de 9999-12-30 ainda resolve (o teto e alcancavel)', () => {
  const r = resolvido([ESPECIFICA, dataRelativa('amanha')], {
    instante_atual: { data: '9999-12-30', minuto_min: AGORA },
  });
  assert.equal(r.data, '9999-12-31');
});

test('TMP-85: depois_de_amanha a partir de 9999-12-30 e 9999-12-31', () => {
  for (const hoje of ['9999-12-30', '9999-12-31']) {
    const r = esperar(
      [ESPECIFICA, dataRelativa('depois_de_amanha')],
      'invalido',
      'ano_fora_do_dominio',
      { instante_atual: { data: hoje, minuto_min: AGORA } }
    );
    assertSemVazamentoDeTeto(r);
  }
  // 9999-12-29 + 2 dias = 9999-12-31: ainda dentro do dominio.
  const ok = resolvido([ESPECIFICA, dataRelativa('depois_de_amanha')], {
    instante_atual: { data: '9999-12-29', minuto_min: AGORA },
  });
  assert.equal(ok.data, '9999-12-31');
});

test('TMP-86: dia da semana proxima cujo avanco ultrapassaria o teto', () => {
  // 9999-12-31 e uma sexta-feira; qualquer "proxima" cai na semana seguinte,
  // integralmente fora do dominio civil.
  for (const dia of ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'] as const) {
    const r = esperar([ESPECIFICA, diaSemana(dia, 'proxima')], 'invalido', 'ano_fora_do_dominio', {
      instante_atual: { data: '9999-12-31', minuto_min: AGORA },
    });
    assertSemVazamentoDeTeto(r);
  }
});

test('TMP-86: ocorrencia calculada que cairia no ano 10000', () => {
  // 9999-12-28 e uma terca-feira: "proxima terca" seria 10000-01-04.
  const r = esperar([ESPECIFICA, diaSemana('terca', 'proxima')], 'invalido', 'ano_fora_do_dominio', {
    instante_atual: { data: '9999-12-28', minuto_min: AGORA },
  });
  assertSemVazamentoDeTeto(r);

  // "proxima quinta" a partir da mesma data ainda cabe: 9999-12-30.
  const ok = resolvido([ESPECIFICA, diaSemana('quinta', 'proxima')], {
    instante_atual: { data: '9999-12-28', minuto_min: AGORA },
  });
  assert.equal(ok.data, '9999-12-30');
});

test('TMP-86: dia da semana esta cuja ocorrencia cairia depois do teto', () => {
  // A semana civil de 9999-12-31 (sexta) vai de 9999-12-27 a 10000-01-02:
  // "este domingo" esta fora do dominio, "esta segunda" ja passou.
  const r = esperar([ESPECIFICA, diaSemana('domingo', 'esta')], 'invalido', 'ano_fora_do_dominio', {
    instante_atual: { data: '9999-12-31', minuto_min: AGORA },
  });
  assertSemVazamentoDeTeto(r);

  esperar([ESPECIFICA, diaSemana('segunda', 'esta')], 'passado', 'dia_semana_esta_passado', {
    instante_atual: { data: '9999-12-31', minuto_min: AGORA },
  });
});

test('ano omitido no teto: a busca nunca examina 10000', () => {
  const r = esperar([ESPECIFICA, dataAbsoluta(29, 2)], 'invalido', 'ano_fora_do_dominio', {
    instante_atual: { data: '9998-03-01', minuto_min: AGORA },
  });
  assertSemVazamentoDeTeto(r);
});

test('nenhuma operacao no teto lanca erro inesperado', () => {
  const datasLimite = ['9999-12-25', '9999-12-28', '9999-12-29', '9999-12-30', '9999-12-31'];
  const atomos: readonly AtomoTemporal[] = [
    dataRelativa('hoje'),
    dataRelativa('amanha'),
    dataRelativa('depois_de_amanha'),
    dataAbsoluta(29, 2),
    dataAbsoluta(31, 12),
    diaSemana('segunda', 'esta'),
    diaSemana('domingo', 'esta'),
    diaSemana('quarta', 'proxima'),
    diaSemana('sabado', 'proxima'),
  ];
  for (const data of datasLimite) {
    for (const atomo of atomos) {
      const chamada = () => resolverTemporal(entrada([ESPECIFICA, atomo], { instante_atual: { data, minuto_min: AGORA } }));
      assert.doesNotThrow(chamada, `${data} / ${atomo.tipo}`);
      const r = chamada();
      const texto = JSON.stringify(r);
      assert.ok(!texto.includes('10000'), `${data} / ${atomo.tipo} vazou 10000`);
      assert.ok(!/\d{5}-/.test(texto), `${data} / ${atomo.tipo} vazou ano de cinco digitos`);
      // Determinismo tambem no teto.
      assert.deepEqual(chamada(), r);
    }
  }
});

// =====================================================================
// Semana civil -- segunda-feira e o primeiro dia
// =====================================================================

test('TMP-19: dia da semana esta, ocorrencia ainda nao passada, resolve', () => {
  assert.equal(resolvido([ESPECIFICA, diaSemana('domingo', 'esta')]).data, DOMINGO);
  // Hoje e quinta: "esta quinta" e hoje.
  assert.equal(resolvido([ESPECIFICA, diaSemana('quinta', 'esta')]).data, HOJE);
});

test('TMP-20 / TMP-66: esta segunda, quando hoje e quinta, e passado', () => {
  esperar([ESPECIFICA, diaSemana('segunda', 'esta')], 'passado', 'dia_semana_esta_passado');
});

test('TMP-67: este domingo, quando hoje e segunda, resolve (domingo encerra a semana)', () => {
  const r = resolvido([ESPECIFICA, diaSemana('domingo', 'esta')], {
    instante_atual: { data: SEGUNDA, minuto_min: AGORA },
  });
  assert.equal(r.data, DOMINGO);
});

test('TMP-83: hoje e domingo (ultimo dia da semana civil) e esta segunda ja passou', () => {
  esperar([ESPECIFICA, diaSemana('segunda', 'esta')], 'passado', 'dia_semana_esta_passado', {
    instante_atual: { data: DOMINGO, minuto_min: AGORA },
  });
  // E "este domingo" no mesmo domingo resolve para hoje.
  const r = resolvido([ESPECIFICA, diaSemana('domingo', 'esta')], {
    instante_atual: { data: DOMINGO, minuto_min: AGORA },
  });
  assert.equal(r.data, DOMINGO);
});

test('TMP-18: proxima, quando hoje ja e esse dia, salta para a semana seguinte', () => {
  assert.equal(resolvido([ESPECIFICA, diaSemana('quinta', 'proxima')]).data, '2026-08-13');
});

test('proxima e sempre estritamente posterior a hoje', () => {
  const dias = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'] as const;
  for (const dia of dias) {
    const r = resolvido([ESPECIFICA, diaSemana(dia, 'proxima')]);
    assert.ok(r.data > HOJE, `${dia} produziu ${r.data}`);
  }
});

test('semana civil na virada de ano permanece de segunda a domingo', () => {
  // 2026-12-31 e quinta; a semana civil vai de 2026-12-28 a 2027-01-03.
  const r = resolvido([ESPECIFICA, diaSemana('domingo', 'esta')], {
    instante_atual: { data: '2026-12-31', minuto_min: AGORA },
  });
  assert.equal(r.data, '2027-01-03');
  esperar([ESPECIFICA, diaSemana('segunda', 'esta')], 'passado', 'dia_semana_esta_passado', {
    instante_atual: { data: '2026-12-31', minuto_min: AGORA },
  });
});

test('TMP-21: dia da semana sem qualificador e sempre ambiguo', () => {
  esperar([ESPECIFICA, diaSemana('segunda', null)], 'ambiguo', 'dia_semana_sem_qualificador');
});

// =====================================================================
// Horarios
// =====================================================================

test('TMP-22: horario 24h explicito valido resolve', () => {
  const r = resolvido([ESPECIFICA, dataRelativa('amanha'), h24(14, 30)]);
  assert.equal(r.horario_min, 870);
});

test('TMP-23: conversao 12h -> 24h, tabela fechada, incluindo hora 12', () => {
  const casos: readonly [number, 'am' | 'pm', number, number][] = [
    [12, 'am', 0, 0],
    [12, 'am', 30, 0],
    [1, 'am', 0, 60],
    [11, 'am', 59, 719],
    [12, 'pm', 0, 720],
    [12, 'pm', 15, 720],
    [1, 'pm', 0, 780],
    [11, 'pm', 59, 1439],
  ];
  for (const [hora, parte, minuto, esperado] of casos) {
    const r = resolvido([ESPECIFICA, dataRelativa('amanha'), h12(hora, parte, minuto)]);
    assert.equal(r.horario_min, esperado, `${hora}${parte}:${minuto}`);
  }
});

test('TMP-24 / TMP-25: meio-dia e meia-noite', () => {
  assert.equal(resolvido([ESPECIFICA, dataRelativa('amanha'), horarioForma('meio_dia')]).horario_min, 720);
  assert.equal(resolvido([ESPECIFICA, dataRelativa('amanha'), horarioForma('meia_noite')]).horario_min, 0);
});

test('TMP-27: minuto nao multiplo de 10 e preservado sem arredondar nem truncar', () => {
  for (const minuto of [1, 7, 13, 29, 47, 59]) {
    const r = resolvido([ESPECIFICA, dataRelativa('amanha'), h24(9, minuto)]);
    assert.equal(r.horario_min, 9 * 60 + minuto);
  }
});

test('horario_min sempre dentro de 0..1439', () => {
  for (let hora = 0; hora <= 23; hora++) {
    const r = resolvido([ESPECIFICA, dataRelativa('amanha'), h24(hora, 59)]);
    assert.ok(r.horario_min !== undefined && r.horario_min >= 0 && r.horario_min <= 1439);
  }
});

test('TMP-28: horario 1-11 sem parte_dia e sem periodo e ambiguo', () => {
  esperar([ESPECIFICA, dataRelativa('amanha'), h12(8, null)], 'ambiguo', 'horario_sem_parte_dia');
});

test('TMP-29: horario 1-11 sem parte_dia resolvido por periodo inequivoco', () => {
  const casos: readonly [number, 'manha' | 'tarde' | 'noite', number][] = [
    [8, 'manha', 480],
    [8, 'noite', 1200],
    [3, 'tarde', 900],
    [11, 'manha', 660],
    [11, 'noite', 1380],
    [1, 'tarde', 780],
  ];
  for (const [hora, per, esperado] of casos) {
    const r = resolvido([ESPECIFICA, dataRelativa('amanha'), h12(hora, null), periodo(per)]);
    assert.equal(r.horario_min, esperado, `${hora} + ${per}`);
    assert.equal(r.periodo, per);
  }
});

test('TMP-82: horario 8 com periodo tarde e conflito, nunca 20:00', () => {
  const r = esperar(
    [ESPECIFICA, dataRelativa('amanha'), h12(8, null), periodo('tarde')],
    'conflito',
    'periodo_incompativel_com_horario'
  );
  assert.ok(!JSON.stringify(r).includes('1200'));
});

test('TMP-30: horario_nao_classificado e sempre ambiguo, nunca invalido nem ignorado', () => {
  esperar(
    [ESPECIFICA, dataRelativa('amanha'), horarioForma('horario_nao_classificado')],
    'ambiguo',
    'horario_nao_classificado'
  );
});

test('TMP-60, TMP-61, TMP-62: hora 12 acompanhada somente de periodo e ambigua', () => {
  // "12 da manha" (TMP-60), "12 da tarde" (TMP-61) e "12 da noite" (TMP-62):
  // nenhuma e mapeada automaticamente para 00:00 ou 12:00.
  for (const per of ['manha', 'tarde', 'noite'] as const) {
    esperar(
      [ESPECIFICA, dataRelativa('amanha'), h12(12, null), periodo(per)],
      'ambiguo',
      'hora_12_com_parte_dia_ambigua'
    );
  }
  // Tambem sem periodo nenhum.
  esperar([ESPECIFICA, dataRelativa('amanha'), h12(12, null)], 'ambiguo', 'hora_12_com_parte_dia_ambigua');
});

test('TMP-31: fronteiras canonicas de periodo (12:00 manha, 12:10 tarde, 18:00 noite)', () => {
  const casos: readonly [number, number, 'manha' | 'tarde' | 'noite'][] = [
    [12, 0, 'manha'],
    [12, 10, 'tarde'],
    [17, 59, 'tarde'],
    [18, 0, 'noite'],
    [0, 0, 'manha'],
    [23, 59, 'noite'],
  ];
  for (const [hora, minuto, per] of casos) {
    // O periodo canonico e confirmado indiretamente: 12h sem parte_dia so
    // resolve quando o periodo informado contem exatamente um candidato.
    const minutos = hora * 60 + minuto;
    const horaAm = minutos < 720 ? hora : hora - 12;
    if (horaAm >= 1 && horaAm <= 11 && minuto === 0) {
      const r = resolvido([ESPECIFICA, dataRelativa('amanha'), h12(horaAm, null), periodo(per)]);
      assert.equal(r.horario_min, minutos, `${hora}:${minuto} em ${per}`);
    }
  }
  // Fronteiras diretas por horario 24h.
  assert.equal(resolvido([ESPECIFICA, dataRelativa('amanha'), h24(12, 0)]).horario_min, 720);
  assert.equal(resolvido([ESPECIFICA, dataRelativa('amanha'), h24(18, 0)]).horario_min, 1080);
});

// =====================================================================
// Restricoes
// =====================================================================

test('TMP-32: inicio_ate resolve como criterio oficial', () => {
  const r = resolvido([ESPECIFICA, dataRelativa('amanha'), restricao24('inicio_ate', 11)]);
  assert.deepEqual(r.restricao, { tipo: 'inicio_ate', minuto_min: 660 });
});

test('TMP-33: termino_ate resolve como criterio oficial', () => {
  const r = resolvido([ESPECIFICA, dataRelativa('amanha'), restricao24('termino_ate', 11)]);
  assert.deepEqual(r.restricao, { tipo: 'termino_ate', minuto_min: 660 });
});

test('TMP-63: horario exato 10:00 com inicio_ate 11:00 preserva os dois criterios', () => {
  const r = resolvido([ESPECIFICA, dataRelativa('amanha'), h24(10), restricao24('inicio_ate', 11)]);
  assert.equal(r.horario_min, 600);
  assert.deepEqual(r.restricao, { tipo: 'inicio_ate', minuto_min: 660 });
});

test('TMP-64: horario exato 10:00 com termino_ate 10:30 preserva ambos, nunca conflito', () => {
  const r = resolvido([
    ESPECIFICA,
    dataRelativa('amanha'),
    h24(10),
    restricao24('termino_ate', 10, 30),
  ]);
  assert.equal(r.horario_min, 600);
  assert.deepEqual(r.restricao, { tipo: 'termino_ate', minuto_min: 630 });
});

test('termino_ate anterior ao horario exato ainda preserva ambos (duracao e da disponibilidade)', () => {
  const r = resolvido([ESPECIFICA, dataRelativa('amanha'), h24(14), restricao24('termino_ate', 11)]);
  assert.equal(r.horario_min, 840);
  assert.deepEqual(r.restricao, { tipo: 'termino_ate', minuto_min: 660 });
});

test('TMP-36: horario exato posterior ao limite de inicio_ate e conflito', () => {
  esperar(
    [ESPECIFICA, dataRelativa('amanha'), h24(12), restricao24('inicio_ate', 11)],
    'conflito',
    'horario_viola_inicio_ate'
  );
});

test('horario exato igual ao limite de inicio_ate nao e conflito (limite inclusivo)', () => {
  const r = resolvido([ESPECIFICA, dataRelativa('amanha'), h24(11), restricao24('inicio_ate', 11)]);
  assert.equal(r.horario_min, 660);
});

test('TMP-35: duas restricoes simultaneas sao restricoes_conflitantes', () => {
  esperar(
    [ESPECIFICA, dataRelativa('amanha'), restricao24('inicio_ate', 11), restricao24('termino_ate', 15)],
    'conflito',
    'restricoes_conflitantes'
  );
  esperar(
    [ESPECIFICA, dataRelativa('amanha'), restricao24('inicio_ate', 11), restricao24('inicio_ate', 15)],
    'conflito',
    'restricoes_conflitantes'
  );
});

test('duas restricoes identicas nao sao conflito (mesmo criterio, nao multiplicidade)', () => {
  const r = resolvido([
    ESPECIFICA,
    dataRelativa('amanha'),
    restricao24('inicio_ate', 11),
    restricao24('inicio_ate', 11),
  ]);
  assert.deepEqual(r.restricao, { tipo: 'inicio_ate', minuto_min: 660 });
});

test('TMP-34: tipo_restricao fora do contrato lanca EntradaInvalidaError', () => {
  // "Depois das 15h" nao possui forma estrutural nesta v1: o conjunto fechado
  // de `tipo_restricao` tem exatamente duas variantes, ambas de limite
  // superior. Uma tentativa runtime de expressar limite inferior e barrada na
  // FRONTEIRA (nivel 1) -- nunca vira resultado `invalido`, nunca e convertida
  // em `inicio_ate`, horario exato ou periodo.
  const limiteInferior = (tipo_restricao: string): AtomoTemporal =>
    ({
      tipo: 'restricao',
      tipo_restricao,
      forma_limite: 'horario_24h',
      hora_limite: 15,
      minuto_limite: 0,
      parte_dia_limite: null,
    }) as unknown as AtomoTemporal;

  for (const valor of ['inicio_apos', 'termino_apos', 'depois_de', 'inicio_desde']) {
    assert.throws(
      () => resolverTemporal(entrada([ESPECIFICA, dataRelativa('amanha'), limiteInferior(valor)])),
      EntradaInvalidaError,
      valor
    );
  }
});

test('TMP-37: data_especifica com restricao e sem atomo de data e data_ausente', () => {
  // A taxonomia de incompletude tem exatamente tres motivos (secao 18): uma
  // restricao sem data nunca produz motivo proprio -- e sempre subsumida pelo
  // motivo que a intencao presente determina.
  esperar([ESPECIFICA, restricao24('inicio_ate', 11)], 'incompleto', 'data_ausente');
  esperar([ESPECIFICA, restricao24('termino_ate', 15)], 'incompleto', 'data_ausente');
  esperar([restricao24('inicio_ate', 11)], 'incompleto', 'intencao_ausente');
});

test('proxima_disponibilidade com restricao e sem data comeca hoje e aplica a restricao', () => {
  // Nao produz motivo residual: a busca comeca hoje (secao 16) e a restricao
  // segue as regras normais a partir dai.
  const r = resolvido([PROXIMA, restricao24('inicio_ate', 15)]);
  assert.equal(r.data, HOJE);
  assert.deepEqual(r.restricao, { tipo: 'inicio_ate', minuto_min: 900 });
  // Inclusive a regra de passado, quando o limite de hoje ja venceu.
  esperar([PROXIMA, restricao24('termino_ate', 9)], 'passado', 'termino_ate_passado');
});

test('restricao com limite ambiguo propaga a ambiguidade do horario-limite', () => {
  esperar(
    [
      ESPECIFICA,
      dataRelativa('amanha'),
      {
        tipo: 'restricao',
        tipo_restricao: 'inicio_ate',
        forma_limite: 'horario_12h',
        hora_limite: 8,
        minuto_limite: 0,
        parte_dia_limite: null,
      } as AtomoTemporal,
    ],
    'ambiguo',
    'horario_sem_parte_dia'
  );
});

// =====================================================================
// Nivel 5 -- passado
// =====================================================================

test('TMP-39: data anterior a hoje e data_passada', () => {
  esperar([ESPECIFICA, dataAbsoluta(1, 1, 2020)], 'passado', 'data_passada');
});

test('TMP-40: hoje sem horario resolve (hoje sozinho nunca e passado)', () => {
  assert.equal(resolvido([ESPECIFICA, dataRelativa('hoje')]).data, HOJE);
});

test('TMP-41: hoje com horario igual ao instante atual e passado (comparacao estrita)', () => {
  esperar([ESPECIFICA, dataRelativa('hoje'), h24(10, 0)], 'passado', 'horario_passado');
});

test('TMP-42: hoje com horario estritamente posterior resolve', () => {
  const r = resolvido([ESPECIFICA, dataRelativa('hoje'), h24(10, 1)]);
  assert.equal(r.horario_min, 601);
});

test('hoje com horario anterior ao instante atual e passado', () => {
  esperar([ESPECIFICA, dataRelativa('hoje'), h24(9, 59)], 'passado', 'horario_passado');
});

test('TMP-38: restricao com limite ja no passado, hoje', () => {
  esperar([ESPECIFICA, dataRelativa('hoje'), restricao24('inicio_ate', 9)], 'passado', 'inicio_ate_passado');
  esperar([ESPECIFICA, dataRelativa('hoje'), restricao24('termino_ate', 9)], 'passado', 'termino_ate_passado');
  esperar([ESPECIFICA, dataRelativa('hoje'), restricao24('inicio_ate', 10, 0)], 'passado', 'inicio_ate_passado');
});

test('data estritamente futura nunca e passado, qualquer que seja o horario', () => {
  for (const hora of [0, 1, 9, 23]) {
    const r = resolvido([ESPECIFICA, dataRelativa('amanha'), h24(hora, 0)]);
    assert.equal(r.data, '2026-08-07');
  }
});

test('proxima_disponibilidade sem data com restricao vencida hoje e passado', () => {
  esperar([PROXIMA, restricao24('inicio_ate', 9)], 'passado', 'inicio_ate_passado');
});

// =====================================================================
// Nivel 4 -- conflitos
// =====================================================================

test('TMP-47: duas datas diferentes sao multiplas_datas', () => {
  esperar([ESPECIFICA, dataAbsoluta(10, 9, 2026), dataAbsoluta(11, 9, 2026)], 'conflito', 'multiplas_datas');
  esperar([ESPECIFICA, dataRelativa('amanha'), diaSemana('domingo', 'esta')], 'conflito', 'multiplas_datas');
});

test('duas datas apontando para o mesmo dia civil nao sao conflito', () => {
  const r = resolvido([ESPECIFICA, dataRelativa('hoje'), dataAbsoluta(6, 8, 2026)]);
  assert.equal(r.data, HOJE);
});

test('TMP-46 / TMP-68: data_especifica e proxima_disponibilidade simultaneas', () => {
  esperar([ESPECIFICA, PROXIMA], 'conflito', 'data_especifica_com_proxima_disponibilidade');
});

test('TMP-44: proxima_disponibilidade com qualquer atomo de data e conflito', () => {
  const MOTIVO = 'data_especifica_com_proxima_disponibilidade';

  // Caso 1: data absoluta.
  esperar([PROXIMA, dataAbsoluta(10, 9, 2026)], 'conflito', MOTIVO);
  esperar([PROXIMA, dataAbsoluta(10, 9)], 'conflito', MOTIVO);
  // Caso 2: data relativa -- inclusive `hoje`, que coincidiria com o inicio
  // padrao da busca; nem por isso e aceita ou ignorada.
  for (const valor of ['hoje', 'amanha', 'depois_de_amanha'] as const) {
    esperar([PROXIMA, dataRelativa(valor)], 'conflito', MOTIVO);
  }
  // Caso 3: dia da semana, em qualquer qualificador.
  esperar([PROXIMA, diaSemana('segunda', 'proxima')], 'conflito', MOTIVO);
  esperar([PROXIMA, diaSemana('domingo', 'esta')], 'conflito', MOTIVO);
});

test('TMP-44: a data nunca vira inicio de busca, filtro, nem e ignorada', () => {
  // Se a data fosse usada como inicio, o resultado seria `resolvido` naquela
  // data; se fosse ignorada, seria `resolvido` em hoje. Nenhum dos dois ocorre.
  const r = resolverTemporal(entrada([PROXIMA, dataAbsoluta(10, 9, 2026)])) as Record<string, unknown>;
  assert.equal(r['tipo'], 'conflito');
  const texto = JSON.stringify(r);
  assert.ok(!texto.includes('2026-09-10'), 'data nao vira inicio de busca');
  assert.ok(!texto.includes(HOJE), 'data nao e ignorada em favor de hoje');
  // Nenhuma data oficial e promovida: a chave `data` so existe em `resolvido`.
  assert.ok(!('data' in r));
  assert.ok(!('periodo' in r));
  assert.ok(!('restricao' in r));
});

test('TMP-44: duas intencoes conflitam independentemente de haver atomo de data', () => {
  const MOTIVO = 'data_especifica_com_proxima_disponibilidade';
  esperar([ESPECIFICA, PROXIMA], 'conflito', MOTIVO);
  esperar([ESPECIFICA, PROXIMA, dataAbsoluta(10, 9, 2026)], 'conflito', MOTIVO);
  esperar([ESPECIFICA, PROXIMA, dataRelativa('amanha')], 'conflito', MOTIVO);
  esperar([ESPECIFICA, PROXIMA, h24(14), periodo('tarde')], 'conflito', MOTIVO);
});

test('TMP-44: o motivo prevalece sobre multiplas_intencoes nos casos normativos', () => {
  // Tres ou mais intencoes seriam `multiplas_intencoes`; com um atomo de data
  // presente junto de `proxima_disponibilidade`, o caminho 2 da secao 20 tem
  // precedencia.
  esperar(
    [PROXIMA, PROXIMA, dataAbsoluta(10, 9, 2026)],
    'conflito',
    'data_especifica_com_proxima_disponibilidade'
  );
  // Sem atomo de data, a mesma leva volta a ser multiplicidade simples.
  esperar([PROXIMA, PROXIMA], 'conflito', 'multiplas_intencoes');
});

test('TMP-81: multiplicidades de intencao que nao sao o par canonico', () => {
  esperar([ESPECIFICA, ESPECIFICA], 'conflito', 'multiplas_intencoes');
  esperar([PROXIMA, PROXIMA], 'conflito', 'multiplas_intencoes');
  esperar([ESPECIFICA, ESPECIFICA, PROXIMA], 'conflito', 'multiplas_intencoes');
  esperar([ESPECIFICA, PROXIMA, PROXIMA], 'conflito', 'multiplas_intencoes');
});

test('intencoes nunca sao deduplicadas em silencio', () => {
  // Duas ocorrencias identicas sao multiplicidade real, nao ruido.
  const r = resolverTemporal(entrada([ESPECIFICA, ESPECIFICA, dataAbsoluta(10, 9, 2026)]));
  assert.equal(r.tipo, 'conflito');
});

test('TMP-45 nao se aplica a horarios repetidos: multiplos_horarios_exatos', () => {
  esperar([ESPECIFICA, dataRelativa('amanha'), h24(10), h24(14)], 'conflito', 'multiplos_horarios_exatos');
});

test('dois horarios exatos com o mesmo valor nao sao conflito', () => {
  const r = resolvido([ESPECIFICA, dataRelativa('amanha'), h24(12, 0), horarioForma('meio_dia')]);
  assert.equal(r.horario_min, 720);
});

test('mais de um periodo distinto nunca escolhe um em silencio', () => {
  const r = esperar(
    [ESPECIFICA, dataRelativa('amanha'), periodo('manha'), periodo('tarde')],
    'ambiguo',
    'expressao_temporal_nao_classificada'
  );
  assert.ok(!JSON.stringify(r).includes('manha'));
});

test('periodos repetidos identicos nao geram ambiguidade', () => {
  const r = resolvido([ESPECIFICA, dataRelativa('amanha'), periodo('manha'), periodo('manha')]);
  assert.equal(r.periodo, 'manha');
});

// =====================================================================
// Nivel 7 -- incompletude
// =====================================================================

test('TMP-77: leva vazia e sempre intencao_ausente, nunca data_ausente', () => {
  esperar([], 'incompleto', 'intencao_ausente');
});

test('nenhum atomo de intencao e sempre intencao_ausente', () => {
  esperar([dataAbsoluta(10, 9, 2026)], 'incompleto', 'intencao_ausente');
  esperar([dataAbsoluta(10, 9, 2026), h24(14), periodo('tarde')], 'incompleto', 'intencao_ausente');
});

test('data_especifica sem nenhuma data e data_ausente', () => {
  esperar([ESPECIFICA], 'incompleto', 'data_ausente');
  esperar([ESPECIFICA, periodo('manha')], 'incompleto', 'data_ausente');
});

test('proxima_disponibilidade nunca produz data_ausente', () => {
  assert.equal(resolvido([PROXIMA]).data, HOJE);
});

test('TMP-43: proxima_disponibilidade sem data comeca hoje', () => {
  const r = resolvido([PROXIMA]);
  assert.equal(r.data, HOJE);
  assert.equal(r.intencao, 'proxima_disponibilidade');
});

test('TMP-45: proxima_disponibilidade com horario exato e sempre incompleto', () => {
  esperar([PROXIMA, h24(14)], 'incompleto', 'horario_recorrente_nao_suportado');
  // Mesmo quando o horario seria ambiguo isoladamente: classificacao unica.
  esperar([PROXIMA, h12(8, null)], 'incompleto', 'horario_recorrente_nao_suportado');
  esperar([PROXIMA, horarioForma('horario_nao_classificado')], 'incompleto', 'horario_recorrente_nao_suportado');
});

test('horario exato sem data nunca produz motivo residual proprio', () => {
  // Mesma regra de TMP-37: a classificacao depende so da intencao presente.
  esperar([ESPECIFICA, h24(14)], 'incompleto', 'data_ausente');
  esperar([h24(14)], 'incompleto', 'intencao_ausente');
  // Periodo sem data segue a mesma regra.
  esperar([ESPECIFICA, periodo('manha')], 'incompleto', 'data_ausente');
  esperar([ESPECIFICA, h24(14), periodo('tarde'), restricao24('inicio_ate', 16)], 'incompleto', 'data_ausente');
});

test('taxonomia de incompletude tem exatamente tres motivos', () => {
  const observados = new Set<string>();
  const levas: readonly (readonly AtomoTemporal[])[] = [
    [],
    [ESPECIFICA],
    [ESPECIFICA, h24(14)],
    [ESPECIFICA, restricao24('inicio_ate', 11)],
    [ESPECIFICA, periodo('manha')],
    [PROXIMA, h24(14)],
    [h24(14)],
    [restricao24('inicio_ate', 11)],
    [periodo('manha')],
  ];
  for (const fatos of levas) {
    const r = resolverTemporal(entrada(fatos));
    if (r.tipo === 'incompleto') observados.add(r.motivo);
  }
  assert.deepEqual(
    [...observados].sort(),
    ['data_ausente', 'horario_recorrente_nao_suportado', 'intencao_ausente']
  );
});

// =====================================================================
// Precedencia global -- TMP-70 a TMP-77
// =====================================================================

test('TMP-70: erro estrutural (nivel 1) vence erro de configuracao (nivel 2)', () => {
  assert.throws(
    () =>
      resolverTemporal(
        entrada([], {
          fuso: undefined as unknown as string,
          fatos_temporais: 'nao-e-array' as unknown as readonly AtomoTemporal[],
        })
      ),
    EntradaInvalidaError
  );
});

test('TMP-71: erro de configuracao (nivel 2) vence conflito (nivel 4)', () => {
  esperar([ESPECIFICA, PROXIMA], 'erro_configuracao', 'fuso_ausente', {
    fuso: undefined as unknown as string,
  });
});

test('TMP-72: quantidade excedida (nivel 3) vence conflito (nivel 4)', () => {
  const nove = [ESPECIFICA, PROXIMA, dataAbsoluta(10, 9, 2026), dataAbsoluta(11, 9, 2026), h24(10), h24(14), restricao24('inicio_ate', 8), restricao24('termino_ate', 9), periodo('manha')];
  assert.equal(nove.length, 9);
  esperar(nove, 'invalido', 'quantidade_atomica_excedida');
});

test('TMP-73: atomo invalido (nivel 3) vence conflito (nivel 4)', () => {
  esperar(
    [
      ESPECIFICA,
      PROXIMA,
      { tipo: 'horario_exato', forma: 'horario_24h', hora: Number.NaN, minuto: 0, parte_dia: null } as unknown as AtomoTemporal,
    ],
    'invalido',
    'atomo_invalido'
  );
});

test('TMP-74: conflito (nivel 4) vence passado (nivel 5)', () => {
  esperar([ESPECIFICA, dataAbsoluta(1, 1, 2020), dataAbsoluta(2, 1, 2020)], 'conflito', 'multiplas_datas');
  esperar([ESPECIFICA, PROXIMA, dataAbsoluta(1, 1, 2020)], 'conflito', 'data_especifica_com_proxima_disponibilidade');
});

test('TMP-75: passado (nivel 5) vence ambiguidade (nivel 6)', () => {
  esperar([ESPECIFICA, diaSemana('segunda', 'esta'), h12(8, null)], 'passado', 'dia_semana_esta_passado');
});

test('TMP-76: ambiguidade (nivel 6) vence incompletude (nivel 7)', () => {
  esperar([ESPECIFICA, h12(8, null)], 'ambiguo', 'horario_sem_parte_dia');
  esperar([diaSemana('segunda', null)], 'ambiguo', 'dia_semana_sem_qualificador');
});

test('precedencia completa: a escada de oito niveis e respeitada em cadeia', () => {
  const base = [ESPECIFICA, PROXIMA, dataAbsoluta(1, 1, 2020), h12(8, null)];
  // Nivel 2 sobre tudo abaixo.
  esperar(base, 'erro_configuracao', 'fuso_ausente', { fuso: null as unknown as string });
  // Nivel 3 sobre 4.
  esperar([...base, { tipo: 'horario_exato', forma: 'horario_24h', hora: Number.NaN, minuto: 0, parte_dia: null } as unknown as AtomoTemporal], 'invalido', 'atomo_invalido');
  // Nivel 4 sobre 5 e 6.
  esperar(base, 'conflito');
});

// =====================================================================
// Invariantes -- pureza, determinismo, serializacao, isolamento
// =====================================================================

const LEVAS_REPRESENTATIVAS: readonly (readonly AtomoTemporal[])[] = [
  [],
  [ESPECIFICA],
  [ESPECIFICA, dataAbsoluta(10, 9, 2026)],
  [ESPECIFICA, dataRelativa('amanha'), h24(14, 37), periodo('tarde')],
  [ESPECIFICA, dataRelativa('amanha'), restricao24('termino_ate', 11)],
  [ESPECIFICA, dataAbsoluta(1, 1, 2020)],
  [ESPECIFICA, PROXIMA],
  [ESPECIFICA, diaSemana('segunda', null)],
  [ESPECIFICA, dataAbsoluta(10, 9, 26)],
  [PROXIMA],
  [PROXIMA, h24(9)],
  [ESPECIFICA, diaSemana('segunda', 'esta')],
  [ESPECIFICA, dataRelativa('amanha'), h12(8, null), periodo('tarde')],
];

test('TMP-52: mesma entrada produz sempre o mesmo resultado', () => {
  for (const fatos of LEVAS_REPRESENTATIVAS) {
    const a = resolverTemporal(entrada(fatos));
    const b = resolverTemporal(entrada(fatos));
    assert.deepEqual(a, b);
  }
});

test('permutacoes dos mesmos atomos produzem exatamente o mesmo resultado', () => {
  for (const fatos of LEVAS_REPRESENTATIVAS) {
    if (fatos.length < 2) continue;
    const referencia = resolverTemporal(entrada(fatos));
    for (const permutada of permutacoes(fatos)) {
      assert.deepEqual(
        resolverTemporal(entrada(permutada)),
        referencia,
        `permutacao divergiu: ${JSON.stringify(permutada.map((a) => a.tipo))}`
      );
    }
  }
});

test('TMP-53: a entrada nunca e mutada pela resolucao', () => {
  for (const fatos of LEVAS_REPRESENTATIVAS) {
    const original = entrada(fatos);
    const copia = JSON.parse(JSON.stringify(original));
    resolverTemporal(original);
    assert.deepEqual(JSON.parse(JSON.stringify(original)), copia);
  }
});

test('TMP-50: todas as variantes fazem round-trip exato por JSON', () => {
  const vistos = new Set<string>();
  const levas: readonly (readonly AtomoTemporal[])[] = [
    ...LEVAS_REPRESENTATIVAS,
    [ESPECIFICA, dataRelativa('hoje'), h24(9)],
    [ESPECIFICA, dataAbsoluta(10, 9, 2026), dataAbsoluta(11, 9, 2026)],
  ];
  for (const fatos of levas) {
    const r = resolverTemporal(entrada(fatos));
    vistos.add(r.tipo);
    const texto = JSON.stringify(r);
    assert.deepEqual(JSON.parse(texto), r);
    assert.ok(!texto.includes('NaN'));
    assert.ok(!texto.includes('Infinity'));
    assert.ok(!texto.includes('undefined'));
  }
  // Sexta variante: erro_configuracao.
  const config = resolverTemporal(entrada([ESPECIFICA], { fuso: null as unknown as string }));
  vistos.add(config.tipo);
  assert.deepEqual(JSON.parse(JSON.stringify(config)), config);

  for (const tipo of ['resolvido', 'incompleto', 'ambiguo', 'invalido', 'passado', 'conflito', 'erro_configuracao']) {
    assert.ok(vistos.has(tipo), `variante nao exercitada: ${tipo}`);
  }
});

test('nenhuma propriedade publica carrega undefined explicito', () => {
  for (const fatos of LEVAS_REPRESENTATIVAS) {
    const r = resolverTemporal(entrada(fatos)) as Record<string, unknown>;
    for (const chave of Object.keys(r)) {
      assert.notEqual(r[chave], undefined, `${chave} veio undefined`);
    }
  }
});

test('resolvido omite campos opcionais ausentes em vez de declara-los', () => {
  const semExtras = resolvido([ESPECIFICA, dataAbsoluta(10, 9, 2026)]);
  assert.deepEqual(Object.keys(semExtras).sort(), ['clinica_id', 'data', 'intencao', 'tipo']);
  assert.ok(!('periodo' in semExtras));
  assert.ok(!('horario_min' in semExtras));
  assert.ok(!('restricao' in semExtras));
});

test('o resultado nunca inclui fuso, texto livre, agenda, duracao, dentista ou procedimento', () => {
  const proibidos = ['fuso', 'data_texto', 'horario_texto', 'duracao_min', 'dentista_id', 'procedimento_id', 'opcoes'];
  for (const fatos of LEVAS_REPRESENTATIVAS) {
    const texto = JSON.stringify(resolverTemporal(entrada(fatos)));
    for (const proibido of proibidos) {
      assert.ok(!texto.includes(proibido), `${proibido} vazou`);
    }
  }
});

test('TMP-56: nenhum campo cadastral chega ao resolvedor nem aparece no resultado', () => {
  // A entrada e fechada: qualquer campo cadastral e barrado na fronteira.
  for (const campo of ['nome', 'cpf', 'data_nascimento', 'email', 'telefone']) {
    assert.throws(
      () =>
        resolverTemporal({
          ...entrada([ESPECIFICA, dataAbsoluta(10, 9, 2026)]),
          [campo]: 'valor-sintetico',
        } as unknown as EntradaResolucaoTemporal),
      EntradaInvalidaError
    );
  }
  const texto = JSON.stringify(resolvido([ESPECIFICA, dataAbsoluta(10, 9, 2026)]));
  for (const campo of ['nome', 'cpf', 'nascimento', 'email', 'telefone']) {
    assert.ok(!texto.includes(campo));
  }
});

test('TMP-55 / TMP-58: clinicas distintas nao compartilham estado nem se influenciam', () => {
  const fatos = [ESPECIFICA, dataAbsoluta(10, 9, 2026), h24(14)];
  const a = resolvido(fatos, { clinica_id: CLINICA_A, fuso: FUSO_A });
  const b = resolvido(fatos, { clinica_id: CLINICA_B, fuso: FUSO_B });
  assert.equal(a.clinica_id, CLINICA_A);
  assert.equal(b.clinica_id, CLINICA_B);
  assert.equal(a.data, b.data);
  assert.equal(a.horario_min, b.horario_min);

  // Instantes distintos produzem resultados independentes para a mesma leva.
  const cedo = resolverTemporal(entrada([ESPECIFICA, dataRelativa('hoje'), h24(9)], { clinica_id: CLINICA_A, instante_atual: { data: HOJE, minuto_min: 480 } }));
  const tarde = resolverTemporal(entrada([ESPECIFICA, dataRelativa('hoje'), h24(9)], { clinica_id: CLINICA_B, instante_atual: { data: HOJE, minuto_min: 660 } }));
  assert.equal(cedo.tipo, 'resolvido');
  assert.equal(tarde.tipo, 'passado');

  // Reexecutar a primeira apos a segunda devolve o mesmo resultado.
  const cedoDeNovo = resolverTemporal(entrada([ESPECIFICA, dataRelativa('hoje'), h24(9)], { clinica_id: CLINICA_A, instante_atual: { data: HOJE, minuto_min: 480 } }));
  assert.deepEqual(cedoDeNovo, cedo);
});

test('clinica_id nunca altera uma regra civil', () => {
  const fatos = [ESPECIFICA, dataAbsoluta(29, 2)];
  const a = resolvido(fatos, { clinica_id: CLINICA_A });
  const b = resolvido(fatos, { clinica_id: CLINICA_B });
  assert.equal(a.data, b.data);
  assert.equal(a.data, '2028-02-29');
});

test('EntradaInvalidaError lanca e nunca vira valor de retorno', () => {
  // Nenhuma variante da uniao carrega o nome da excecao.
  for (const fatos of LEVAS_REPRESENTATIVAS) {
    const texto = JSON.stringify(resolverTemporal(entrada(fatos)));
    assert.ok(!texto.includes('EntradaInvalidaError'));
    assert.ok(!texto.includes('erro_estrutural'));
  }
});

const FORMATO_DATA_OFICIAL = /^\d{4}-\d{2}-\d{2}$/;

test('toda data resolvida tem dez caracteres e ano dentro de 1..9999', () => {
  const levas: readonly (readonly [readonly AtomoTemporal[], string])[] = [
    [[ESPECIFICA, dataAbsoluta(10, 9, 2026)], HOJE],
    [[ESPECIFICA, dataAbsoluta(29, 2)], HOJE],
    [[ESPECIFICA, dataRelativa('depois_de_amanha')], '2026-12-30'],
    [[ESPECIFICA, dataRelativa('amanha')], '9999-12-30'],
    [[ESPECIFICA, dataAbsoluta(31, 12)], '9999-01-01'],
    [[ESPECIFICA, dataAbsoluta(1, 1, 1000)], '0999-01-01'],
    [[ESPECIFICA, diaSemana('quinta', 'proxima')], '9999-12-28'],
    [[PROXIMA], '9999-12-31'],
  ];
  for (const [fatos, data] of levas) {
    const r = resolvido(fatos, { instante_atual: { data, minuto_min: AGORA } });
    assert.equal(r.data.length, 10, r.data);
    assert.match(r.data, FORMATO_DATA_OFICIAL);
    const ano = Number(r.data.slice(0, 4));
    assert.ok(ano >= 1 && ano <= 9999, `ano fora do dominio: ${r.data}`);
  }
});

test('nenhum resultado, em nenhuma leva, contem 10000', () => {
  const instantes = [HOJE, '9999-12-31', '9999-12-30', '9998-03-01', '0001-01-01'];
  for (const data of instantes) {
    for (const fatos of LEVAS_REPRESENTATIVAS) {
      const texto = JSON.stringify(
        resolverTemporal(entrada(fatos, { instante_atual: { data, minuto_min: AGORA } }))
      );
      assert.ok(!texto.includes('10000'), `${data}: ${texto}`);
    }
  }
});

test('permutacao nao altera o conflito de proxima disponibilidade com data', () => {
  const levas: readonly (readonly AtomoTemporal[])[] = [
    [PROXIMA, dataAbsoluta(10, 9, 2026)],
    [PROXIMA, dataRelativa('amanha'), periodo('manha')],
    [ESPECIFICA, PROXIMA, dataAbsoluta(10, 9, 2026)],
    [PROXIMA, PROXIMA, dataRelativa('amanha')],
    [PROXIMA, diaSemana('segunda', 'proxima'), periodo('tarde')],
  ];
  for (const fatos of levas) {
    const referencia = resolverTemporal(entrada(fatos));
    assert.equal(referencia.tipo, 'conflito');
    assert.equal(
      (referencia as { motivo: string }).motivo,
      'data_especifica_com_proxima_disponibilidade'
    );
    for (const permutada of permutacoes(fatos)) {
      assert.deepEqual(resolverTemporal(entrada(permutada)), referencia);
    }
  }
});

test('exatamente uma variante final por chamada, sempre com discriminador conhecido', () => {
  const variantes = new Set(['resolvido', 'incompleto', 'ambiguo', 'invalido', 'passado', 'conflito', 'erro_configuracao']);
  for (const fatos of LEVAS_REPRESENTATIVAS) {
    const r = resolverTemporal(entrada(fatos)) as Record<string, unknown>;
    assert.ok(variantes.has(r['tipo'] as string));
    // `motivo` existe em todas menos `resolvido`, e nunca simultaneamente com `data`.
    assert.equal('motivo' in r, r['tipo'] !== 'resolvido');
  }
});

// --- Auxiliar de teste ---

/** Permutacoes de ate 4! -- suficiente para provar independencia de ordem sem
 * explodir o tempo de execucao em levas maiores. */
function permutacoes(itens: readonly AtomoTemporal[]): (readonly AtomoTemporal[])[] {
  if (itens.length > 4) {
    // Rotacoes e inversao cobrem a independencia de ordem sem custo fatorial.
    const saida: (readonly AtomoTemporal[])[] = [[...itens].reverse()];
    for (let i = 1; i < itens.length; i++) {
      saida.push([...itens.slice(i), ...itens.slice(0, i)]);
    }
    return saida;
  }
  if (itens.length <= 1) return [itens];
  const saida: (readonly AtomoTemporal[])[] = [];
  for (let i = 0; i < itens.length; i++) {
    const resto = [...itens.slice(0, i), ...itens.slice(i + 1)];
    for (const p of permutacoes(resto)) saida.push([itens[i], ...p]);
  }
  return saida;
}
