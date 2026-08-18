import assert from 'node:assert/strict';
import { test } from 'node:test';
import { montarFatosTemporais } from './montar-fatos-temporais.ts';

test('nenhum dado: lista vazia', () => {
  assert.deepEqual(montarFatosTemporais({}), []);
});

test('hoje: data_relativa + intencao data_especifica', () => {
  assert.deepEqual(montarFatosTemporais({ data_texto: 'hoje' }), [
    { tipo: 'data_relativa', valor: 'hoje' },
    { tipo: 'intencao', valor: 'data_especifica' },
  ]);
});

test('amanha (com til) normaliza igual amanha sem til', () => {
  assert.deepEqual(montarFatosTemporais({ data_texto: 'amanhã' }), [
    { tipo: 'data_relativa', valor: 'amanha' },
    { tipo: 'intencao', valor: 'data_especifica' },
  ]);
  assert.deepEqual(montarFatosTemporais({ data_texto: 'Amanha' }), [
    { tipo: 'data_relativa', valor: 'amanha' },
    { tipo: 'intencao', valor: 'data_especifica' },
  ]);
});

test('data explicita DD/MM: ano null (ano omitido)', () => {
  assert.deepEqual(montarFatosTemporais({ data_texto: '15/08' }), [
    { tipo: 'data_absoluta', dia: 15, mes: 8, ano: null },
    { tipo: 'intencao', valor: 'data_especifica' },
  ]);
});

test('data explicita DD/MM/AAAA: ano preenchido', () => {
  assert.deepEqual(montarFatosTemporais({ data_texto: '15/08/2026' }), [
    { tipo: 'data_absoluta', dia: 15, mes: 8, ano: 2026 },
    { tipo: 'intencao', valor: 'data_especifica' },
  ]);
});

// DIA DA SEMANA entrou no vocabulario em 2026-08-17. Antes deste teste
// afirmar o contrario, "sexta que vem" nao produzia atomo nenhum -- e isso
// travou conversa real: o paciente pediu "quarta-feira 15hrs" e a Iris ficou
// pedindo a data em quatro turnos seguidos. `resolverTemporal` sempre soube
// resolver `dia_semana`; faltava reconhecer o texto aqui.

test('dia da semana: com e sem "feira", com hifen ou espaco', () => {
  // REGRESSAO: a primeira versao so aceitava "sexta-feira" (hifen) e "sexta".
  // Em conversa real o paciente escreveu "sexta feira", com ESPACO -- nao
  // casava, e a Iris pediu a data em dois turnos seguidos.
  for (const [texto, dia] of [
    ['quarta', 'quarta'],
    ['quarta-feira', 'quarta'],
    ['quarta feira', 'quarta'],
    ['segunda-feira', 'segunda'],
    ['segunda feira', 'segunda'],
    ['sexta feira', 'sexta'],
    ['terca', 'terca'],
    ['sabado', 'sabado'],
    ['domingo', 'domingo'],
  ] as const) {
    assert.deepEqual(
      montarFatosTemporais({ data_texto: texto }),
      [
        { tipo: 'dia_semana', dia, qualificador: null },
        { tipo: 'intencao', valor: 'data_especifica' },
      ],
      `texto ${texto}`
    );
  }
});

test('qualificador explicito e preservado -- "que vem" e "proxima" viram `proxima`', () => {
  for (const texto of ['sexta que vem', 'proxima sexta', 'sexta feira que vem', 'proxima sexta-feira']) {
    assert.deepEqual(
      montarFatosTemporais({ data_texto: texto }),
      [
        { tipo: 'dia_semana', dia: 'sexta', qualificador: 'proxima' },
        { tipo: 'intencao', valor: 'data_especifica' },
      ],
      `texto ${texto}`
    );
  }
});

test('"esta"/"nesta" viram qualificador `esta`', () => {
  for (const texto of ['esta quarta', 'nesta quarta']) {
    assert.deepEqual(
      montarFatosTemporais({ data_texto: texto }),
      [
        { tipo: 'dia_semana', dia: 'quarta', qualificador: 'esta' },
        { tipo: 'intencao', valor: 'data_especifica' },
      ],
      `texto ${texto}`
    );
  }
});

// SO O DIA ("dia 20") entrou em 2026-08-17. Defeito real: a Iris propos
// "quinta-feira, dia 20/08", o paciente confirmou com "sim dia 20", a
// interpretadora gravou `data_texto: "20"` -- e o Core, que so entendia
// `DD/MM`, perdeu a data e perguntou "para qual data?" logo depois de te-la
// anunciado.

test('so o dia: produz data_absoluta com mes e ano nulos', () => {
  for (const texto of ['20', 'dia 20', 'no dia 20', 'para o dia 20']) {
    assert.deepEqual(
      montarFatosTemporais({ data_texto: texto }),
      [
        { tipo: 'data_absoluta', dia: 20, mes: null, ano: null },
        { tipo: 'intencao', valor: 'data_especifica' },
      ],
      `texto ${texto}`
    );
  }
});

test('dia fora de 1..31 NAO produz atomo -- nunca um palpite', () => {
  for (const texto of ['0', '32', '40', '99']) {
    assert.deepEqual(montarFatosTemporais({ data_texto: texto }), [], `texto ${texto}`);
  }
});

test('DD/MM continua tendo precedencia sobre a leitura de dia sozinho', () => {
  assert.deepEqual(montarFatosTemporais({ data_texto: '20/08' }), [
    { tipo: 'data_absoluta', dia: 20, mes: 8, ano: null },
    { tipo: 'intencao', valor: 'data_especifica' },
  ]);
});

test('texto fora do vocabulario continua SEM atomo -- nunca um palpite', () => {
  for (const texto of ['semana que vem', 'depois das 15h', 'assim que puder', 'quartinha', 'feira', 'banana']) {
    assert.deepEqual(montarFatosTemporais({ data_texto: texto }), [], `texto ${texto}`);
  }
});

test('periodo manha/tarde: atomo proprio, passthrough do valor ja canonico', () => {
  assert.deepEqual(montarFatosTemporais({ periodo: 'manha' }), [{ tipo: 'periodo', valor: 'manha' }]);
  assert.deepEqual(montarFatosTemporais({ periodo: 'tarde' }), [{ tipo: 'periodo', valor: 'tarde' }]);
});

test('periodo fora do vocabulario fechado: ignorado, nunca atomo invalido', () => {
  assert.deepEqual(montarFatosTemporais({ periodo: 'madrugada' }), []);
});

test('horario explicito HH:MM', () => {
  assert.deepEqual(montarFatosTemporais({ horario_texto: '14:00' }), [
    { tipo: 'horario_exato', forma: 'horario_24h', hora: 14, minuto: 0, parte_dia: null },
  ]);
});

test('horario explicito HHh e HHhMM', () => {
  assert.deepEqual(montarFatosTemporais({ horario_texto: '14h' }), [
    { tipo: 'horario_exato', forma: 'horario_24h', hora: 14, minuto: 0, parte_dia: null },
  ]);
  assert.deepEqual(montarFatosTemporais({ horario_texto: '14h30' }), [
    { tipo: 'horario_exato', forma: 'horario_24h', hora: 14, minuto: 30, parte_dia: null },
  ]);
});

test('horario fora do vocabulario simples ("depois das 15h"): nenhum atomo', () => {
  assert.deepEqual(montarFatosTemporais({ horario_texto: 'depois das 15h' }), []);
});

test('combinacao completa: data + periodo + horario, todos os atomos juntos', () => {
  assert.deepEqual(montarFatosTemporais({ data_texto: 'amanha', periodo: 'tarde', horario_texto: '15:30' }), [
    { tipo: 'data_relativa', valor: 'amanha' },
    { tipo: 'intencao', valor: 'data_especifica' },
    { tipo: 'periodo', valor: 'tarde' },
    { tipo: 'horario_exato', forma: 'horario_24h', hora: 15, minuto: 30, parte_dia: null },
  ]);
});
