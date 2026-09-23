// Testes do cliente da IA CLASSIFICADORA de pos-consulta. Nada aqui toca
// rede real: `fetch` e injetado (mesmo padrao de
// cliente-modelo-redator-openai.test.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  criarClienteClassificadorPosConsultaOpenAI,
  ErroClienteClassificadorPosConsulta,
} from './cliente-modelo-classificador-pos-consulta-openai.ts';

const CONFIG_BASE = { chaveApi: 'chave-de-teste', modelo: 'gpt-teste', timeoutMs: 5_000 };

function respostaSucesso(classificacao: string): Response {
  return new Response(
    JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ classificacao }) }] }],
    }),
    { status: 200 }
  );
}

function fetchFalso(resposta: () => Response) {
  const corpos: Record<string, unknown>[] = [];
  const fn: typeof fetch = (_url, init) => {
    corpos.push(JSON.parse((init as RequestInit).body as string) as Record<string, unknown>);
    return Promise.resolve(resposta());
  };
  return { fn, corpos };
}

test('configuracao invalida lanca antes de qualquer chamada de rede', () => {
  assert.throws(
    () => criarClienteClassificadorPosConsultaOpenAI({ ...CONFIG_BASE, chaveApi: '' }),
    ErroClienteClassificadorPosConsulta
  );
  assert.throws(
    () => criarClienteClassificadorPosConsultaOpenAI({ ...CONFIG_BASE, modelo: '' }),
    ErroClienteClassificadorPosConsulta
  );
  assert.throws(
    () => criarClienteClassificadorPosConsultaOpenAI({ ...CONFIG_BASE, timeoutMs: 0 }),
    ErroClienteClassificadorPosConsulta
  );
});

test('classificacao positiva chega intacta ao chamador', async () => {
  const { fn } = fetchFalso(() => respostaSucesso('positiva'));
  const cliente = criarClienteClassificadorPosConsultaOpenAI({ ...CONFIG_BASE, fetch: fn });
  const resultado = await cliente.classificar({
    instrucoes: 'instrucoes',
    mensagemPaciente: 'foi otimo',
  });
  assert.equal(resultado, 'positiva');
});

test('corpo HTTP usa Structured Outputs estrito com o schema fechado de 3 valores', async () => {
  const { fn, corpos } = fetchFalso(() => respostaSucesso('incerta'));
  const cliente = criarClienteClassificadorPosConsultaOpenAI({ ...CONFIG_BASE, fetch: fn });
  await cliente.classificar({ instrucoes: 'instrucoes', mensagemPaciente: 'x' });

  const corpo = corpos[0]!;
  const formato = (corpo.text as { format: Record<string, unknown> }).format;
  assert.equal(formato.type, 'json_schema');
  assert.equal(formato.strict, true);
  const schema = formato.schema as { properties: { classificacao: { enum: string[] } } };
  assert.deepEqual(schema.properties.classificacao.enum, ['positiva', 'nao_positiva', 'incerta']);
  assert.deepEqual(corpo.tools, undefined); // nunca 'tools'
});

test('classificacao fora do vocabulario fechado falha fechado (nunca vira incerta silenciosamente aqui)', async () => {
  const { fn } = fetchFalso(() => respostaSucesso('super_positiva'));
  const cliente = criarClienteClassificadorPosConsultaOpenAI({ ...CONFIG_BASE, fetch: fn });
  await assert.rejects(
    () => cliente.classificar({ instrucoes: 'i', mensagemPaciente: 'x' }),
    ErroClienteClassificadorPosConsulta
  );
});

test('erro HTTP (5xx) lanca ErroClienteClassificadorPosConsulta, sem retry', async () => {
  const { fn } = fetchFalso(() => new Response('erro interno', { status: 500 }));
  const cliente = criarClienteClassificadorPosConsultaOpenAI({ ...CONFIG_BASE, fetch: fn });
  await assert.rejects(
    () => cliente.classificar({ instrucoes: 'i', mensagemPaciente: 'x' }),
    ErroClienteClassificadorPosConsulta
  );
});

test('corpo HTTP vazio lanca, nunca trata como classificacao valida', async () => {
  const { fn } = fetchFalso(() => new Response('', { status: 200 }));
  const cliente = criarClienteClassificadorPosConsultaOpenAI({ ...CONFIG_BASE, fetch: fn });
  await assert.rejects(
    () => cliente.classificar({ instrucoes: 'i', mensagemPaciente: 'x' }),
    ErroClienteClassificadorPosConsulta
  );
});

test('timeout aborta e lanca codigo timeout', async () => {
  const fnLento: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = (init as RequestInit).signal;
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  const cliente = criarClienteClassificadorPosConsultaOpenAI({ ...CONFIG_BASE, fetch: fnLento, timeoutMs: 10 });
  await assert.rejects(
    () => cliente.classificar({ instrucoes: 'i', mensagemPaciente: 'x' }),
    (erro: unknown) => erro instanceof ErroClienteClassificadorPosConsulta && erro.codigo === 'timeout'
  );
});
