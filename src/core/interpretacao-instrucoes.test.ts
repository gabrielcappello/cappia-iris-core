import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INSTRUCOES_EXTRATOR, SCHEMA_SAIDA_INTERPRETACAO } from './interpretacao-instrucoes.ts';

// Navega o schema estrutural (JSON Schema puro, sem biblioteca de validacao
// no projeto) ate o oneOf de 'confirmacao' -- mesma forma que os demais
// campos fechados (periodo/intencao) ja usam.
function oneOfDoCampo(campo: string): unknown[] {
  const schema = SCHEMA_SAIDA_INTERPRETACAO as {
    properties: { alteracoes: { properties: Record<string, { oneOf: unknown[] }> } };
  };
  return schema.properties.alteracoes.properties[campo].oneOf;
}

interface RamoInformarCorrigir {
  required: string[];
  properties: { valor: { type: string; enum?: string[] } };
}

function ramoInformarCorrigir(oneOf: unknown[]): RamoInformarCorrigir {
  const ramo = (oneOf as RamoInformarCorrigir[]).find((r) => r.required.includes('valor'));
  if (!ramo) throw new Error('ramo informar/corrigir nao encontrado no oneOf');
  return ramo;
}

test('schema: confirmacao aceita exclusivamente o enum ["sim"], nunca string livre', () => {
  const ramo = ramoInformarCorrigir(oneOfDoCampo('confirmacao'));
  assert.deepEqual(ramo.properties.valor, { type: 'string', enum: ['sim'] });
});

test('schema: confirmacao nao tem minLength solto (nao cai no fallback de string livre)', () => {
  const ramo = ramoInformarCorrigir(oneOfDoCampo('confirmacao'));
  assert.equal('minLength' in ramo.properties.valor, false);
});

test('instrucoes: explicam quando emitir confirmacao e quando omitir', () => {
  assert.match(INSTRUCOES_EXTRATOR, /duvida, pergunta, hesitacao ou resposta negativa/);
  assert.match(INSTRUCOES_EXTRATOR, /Valores permitidos para confirmacao: sim\./);
});

// specs/resposta-conversacional-v1.md secao 5 (2026-08-06): a regra deixou
// de ser um repertorio fechado de frases -- agora depende de
// "proposta_pendente" estar presente no payload.
test('instrucoes: confirmacao por significado depende de proposta_pendente, sem repertorio fechado', () => {
  assert.match(INSTRUCOES_EXTRATOR, /"proposta_pendente" estiver presente no payload/);
  assert.match(INSTRUCOES_EXTRATOR, /sem repertorio fechado de frases/);
  assert.match(INSTRUCOES_EXTRATOR, /"ok", "certo", "fechado", "esse mesmo", "pode ser"/);
  assert.match(INSTRUCOES_EXTRATOR, /NAO estiver presente no payload.*NUNCA emite confirmacao = sim/s);
});

test('instrucoes: proposta_pendente nunca e copiado para data_texto/horario_texto por conta propria', () => {
  assert.match(INSTRUCOES_EXTRATOR, /nunca copie proposta_pendente\.data ou proposta_pendente\.horario/);
});

test('instrucoes: nunca instruem a emitir confirmacao para negativa', () => {
  // Garante que a regra fala em "nunca emita" perto de resposta negativa,
  // nao apenas menciona a palavra solta em outro contexto.
  const trechoNegativa = INSTRUCOES_EXTRATOR.slice(INSTRUCOES_EXTRATOR.indexOf('resposta negativa') - 120);
  assert.match(trechoNegativa, /nunca emita/);
});

test('instrucoes: "hoje"/"amanha" preenchem data_texto mesmo em forma de pergunta (regressao: achado do teste real, "Pode ser hoje?" nao extraia data_texto)', () => {
  assert.match(INSTRUCOES_EXTRATOR, /Pode ser hoje\?" preenche data_texto = "hoje"/);
  assert.match(INSTRUCOES_EXTRATOR, /Pode ser amanha\?" preenche data_texto = "amanha"/);
  assert.match(INSTRUCOES_EXTRATOR, /nao e "duvida real"/);
});

// --- normalizacao de horario (regressao: achado real via WhatsApp,
// "15 hrs" preservado verbatim nunca batia no regex HH:MM/HHh[MM] de
// montar-fatos-temporais.ts, e o horario pedido pelo paciente era
// silenciosamente perdido) ---

test('instrucoes: data continua preservada literalmente, nunca calculada (regra inalterada)', () => {
  assert.match(INSTRUCOES_EXTRATOR, /Datas sao sempre preservadas como texto, exatamente como mencionadas — nunca calcule, resolva ou normalize datas relativas/);
});

// --- tolerancia GERAL a erro de digitacao, regra unica para todo
// vocabulario fechado (achado real via WhatsApp, 2026-08-22: "segunda
// feria" preservado verbatim nunca batia no sufixo "feira" de
// montar-fatos-temporais.ts, e a data dita pelo paciente era
// silenciosamente perdida. Corrigido primeiro so para dia da semana; o
// Gabriel pediu explicitamente uma regra UNICA que funcione para qualquer
// campo, nunca remendo campo por campo -- corrigido em seguida) ---

test('instrucoes: tolerancia a erro de digitacao e uma regra GERAL, para qualquer campo de vocabulario fechado', () => {
  assert.match(INSTRUCOES_EXTRATOR, /VOCABULARIO FECHADO/);
  assert.match(INSTRUCOES_EXTRATOR, /"qintafeaa", "sabao" por "sabado", "vcs trablaham"/);
  assert.match(INSTRUCOES_EXTRATOR, /NUNCA fique restrita a um unico campo por instrucao especifica/);
  assert.match(INSTRUCOES_EXTRATOR, /interpretar "segunda feria" como "segunda-feira" e leitura/);
});

test('instrucoes: tolerancia a erro de digitacao NUNCA se aplica a dados de identidade do paciente', () => {
  assert.match(INSTRUCOES_EXTRATOR, /ESSA TOLERANCIA NAO SE APLICA a dados de IDENTIDADE do paciente \("nome", "cpf", "data_nascimento", "email"\)/);
  assert.match(INSTRUCOES_EXTRATOR, /Se o paciente escreveu "Gabirel", o nome dele PODE ser exatamente esse/);
});

test('instrucoes: tratamento em foco vence grafia imperfeita; troca exige pedido semanticamente claro', () => {
  assert.match(INSTRUCOES_EXTRATOR, /erro de digitacao ou grafia imperfeita NAO autoriza procurar outro item parecido/);
  assert.match(INSTRUCOES_EXTRATOR, /preserve o id do assunto atual/);
  assert.match(INSTRUCOES_EXTRATOR, /Outro procedimento so prevalece quando o paciente expressar semanticamente um pedido claro/);
  assert.match(INSTRUCOES_EXTRATOR, /"qual dia pode fazer essa retaruação\?" continua sendo essa restauracao/);
});

test('instrucoes: dentista do tratamento e aplicado pelo Core, nao fingido como mencao do paciente', () => {
  assert.match(INSTRUCOES_EXTRATOR, /Nao o copie para "dentistas_candidatos"/);
  assert.match(INSTRUCOES_EXTRATOR, /esse campo continua respondendo somente a quem o PACIENTE mencionou/);
  assert.match(INSTRUCOES_EXTRATOR, /o sistema preservara o dentista definido no tratamento/);
});

test('instrucoes: horario e normalizado para HH:MM em 24h quando inequivoco', () => {
  assert.match(INSTRUCOES_EXTRATOR, /Horarios sao normalizados para o formato HH:MM em 24 horas/);
  assert.match(INSTRUCOES_EXTRATOR, /"15h", "15 hrs", "15 horas", "as 15" e "quinze horas" tornam-se todos "15:00"/);
  assert.match(INSTRUCOES_EXTRATOR, /"15:30" permanece "15:30"/);
});

test('instrucoes: normalizacao de horario nunca autoriza inventar ou inferir horario ausente', () => {
  assert.match(INSTRUCOES_EXTRATOR, /nunca invente um horario que o paciente nao mencionou/);
  assert.match(INSTRUCOES_EXTRATOR, /nunca infira um horario ausente a partir de outro dado/);
});

test('instrucoes: duvida real sobre horario continua omitindo o campo (mesma regra geral, reafirmada pra horario)', () => {
  const trechoHorario = INSTRUCOES_EXTRATOR.slice(INSTRUCOES_EXTRATOR.indexOf('Horarios sao normalizados'));
  assert.match(trechoHorario, /Em duvida real sobre qual horario foi mencionado, omita horario_texto/);
});
