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
  assert.match(INSTRUCOES_EXTRATOR, /confirmacao = sim somente quando o paciente confirmar afirmativamente/);
  assert.match(INSTRUCOES_EXTRATOR, /duvida, pergunta, hesitacao ou resposta negativa/);
  assert.match(INSTRUCOES_EXTRATOR, /Valores permitidos para confirmacao: sim\./);
});

test('instrucoes: nunca instruem a emitir confirmacao para negativa', () => {
  // Garante que a regra fala em "nunca emita" perto de resposta negativa,
  // nao apenas menciona a palavra solta em outro contexto.
  const trechoNegativa = INSTRUCOES_EXTRATOR.slice(INSTRUCOES_EXTRATOR.indexOf('resposta negativa') - 120);
  assert.match(trechoNegativa, /nunca emita/);
});
