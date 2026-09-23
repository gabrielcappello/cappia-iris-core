import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  autenticarChamadaInternaPosConsulta,
  CABECALHO_SEGREDO_INTERNO_POS_CONSULTA,
  TAMANHO_MINIMO_SEGREDO_INTERNO_POS_CONSULTA,
  VARIAVEL_SEGREDO_INTERNO_POS_CONSULTA,
} from './pos-consulta-autenticacao-interna.ts';

// Segredo FICTICIO so para teste (nao e credencial real de nenhum ambiente).
const SEGREDO = 'segredo-de-teste-0123456789-abcdefghijklmnop';

test('o segredo de teste tem o tamanho minimo exigido', () => {
  assert.ok(SEGREDO.length >= TAMANHO_MINIMO_SEGREDO_INTERNO_POS_CONSULTA);
});

test('segredo correto e autorizado', async () => {
  assert.deepEqual(await autenticarChamadaInternaPosConsulta(SEGREDO, SEGREDO), { autorizado: true });
});

test('segredo errado (mesmo tamanho) e recusado', async () => {
  const errado = SEGREDO.slice(0, -1) + 'X';
  assert.deepEqual(await autenticarChamadaInternaPosConsulta(errado, SEGREDO), { autorizado: false, motivo: 'segredo_invalido' });
});

test('prefixo do segredo e segredo mais longo sao recusados (nada de comparacao parcial)', async () => {
  assert.deepEqual(await autenticarChamadaInternaPosConsulta(SEGREDO.slice(0, 20), SEGREDO), { autorizado: false, motivo: 'segredo_invalido' });
  assert.deepEqual(await autenticarChamadaInternaPosConsulta(SEGREDO + 'extra', SEGREDO), { autorizado: false, motivo: 'segredo_invalido' });
});

test('cabecalho ausente, nulo ou vazio e recusado como cabecalho_ausente', async () => {
  for (const valor of [null, undefined, '', '   ']) {
    assert.deepEqual(await autenticarChamadaInternaPosConsulta(valor, SEGREDO), { autorizado: false, motivo: 'cabecalho_ausente' }, String(valor));
  }
});

// FALHA FECHADO: sem segredo forte configurado no servidor, NADA e autorizado --
// nem o valor vazio "casando" com o vazio, nem o cabecalho igual ao segredo curto.
test('segredo do servidor ausente, vazio ou curto recusa TUDO (falha fechado)', async () => {
  const curto = 'a'.repeat(TAMANHO_MINIMO_SEGREDO_INTERNO_POS_CONSULTA - 1);
  for (const esperado of [undefined, null, '', '   ', curto]) {
    for (const recebido of [undefined, '', curto, SEGREDO, String(esperado)]) {
      assert.deepEqual(
        await autenticarChamadaInternaPosConsulta(recebido, esperado),
        { autorizado: false, motivo: 'segredo_nao_configurado' },
        `esperado=${JSON.stringify(esperado)} recebido=${JSON.stringify(recebido)}`
      );
    }
  }
});

test('espacos nas pontas (ex.: quebra de linha ao gravar o secret) nao invalidam o segredo correto', async () => {
  assert.deepEqual(await autenticarChamadaInternaPosConsulta(SEGREDO, `${SEGREDO}\n`), { autorizado: true });
  assert.deepEqual(await autenticarChamadaInternaPosConsulta(` ${SEGREDO} `, SEGREDO), { autorizado: true });
});

test('a publishable key NUNCA basta: um JWT/chave publica no lugar do segredo e recusado', async () => {
  const publishableFalsa = 'sb_publishable_ficticia_abcdefghijklmnopqrstuvwxyz0123456789';
  assert.deepEqual(await autenticarChamadaInternaPosConsulta(publishableFalsa, SEGREDO), { autorizado: false, motivo: 'segredo_invalido' });
});

test('nomes do contrato (cabecalho e variavel de ambiente) sao os documentados', () => {
  assert.equal(CABECALHO_SEGREDO_INTERNO_POS_CONSULTA, 'x-iris-pos-consulta-segredo');
  assert.equal(VARIAVEL_SEGREDO_INTERNO_POS_CONSULTA, 'POS_CONSULTA_SEGREDO_INTERNO');
});

// ── O ENTRYPOINT da Edge Function exige a autenticacao ANTES de qualquer
// leitura de corpo, de banco ou de OpenAI ────────────────────────────────────
// (Prova estrutural sobre o codigo-fonte, no mesmo estilo dos testes do n8n:
// index.ts importa modulos "jsr:" de Deno e nao roda sob node --test. O teste
// de COMPORTAMENTO do handler roda sob Deno: ver
// supabase/functions/iris-nova-pos-consulta/index.autenticacao.test.ts.)
const INDEX = readFileSync(new URL('../../supabase/functions/iris-nova-pos-consulta/index.ts', import.meta.url), 'utf8');

test('index.ts importa o modulo de autenticacao interna e le o segredo da variavel de ambiente documentada', () => {
  assert.match(INDEX, /from "\.\/pos-consulta-autenticacao-interna\.ts"/);
  assert.match(INDEX, /Deno\.env\.get\(VARIAVEL_SEGREDO_INTERNO_POS_CONSULTA\)/);
  assert.match(INDEX, /req\.headers\.get\(CABECALHO_SEGREDO_INTERNO_POS_CONSULTA\)/);
});

test('no handler, a autenticacao interna vem ANTES de req.json(), do createClient e da chave da OpenAI', () => {
  const corpoHandler = INDEX.slice(INDEX.indexOf('export async function handler'));
  const posAuth = corpoHandler.indexOf('autenticarChamadaInternaPosConsulta(');
  assert.ok(posAuth > 0, 'handler deve chamar autenticarChamadaInternaPosConsulta');
  for (const marcador of ['req.json()', 'createClient(', 'OPENAI_API_KEY', 'INSTANCIA_WHATSAPP_AUTORIZADA', 'resolverClinicaPorInstancia(']) {
    const pos = corpoHandler.indexOf(marcador);
    assert.ok(pos > posAuth, `${marcador} deve aparecer DEPOIS da autenticacao interna`);
  }
});

test('o handler responde 401 para segredo ausente/invalido e 500 (nunca 401/200) para segredo NAO configurado', () => {
  assert.match(INDEX, /motivo === "segredo_nao_configurado"[\s\S]{0,300}configuracao_ausente[\s\S]{0,60}500/);
  assert.match(INDEX, /nao_autorizado[\s\S]{0,60}401/);
});

test('o modulo Core e o espelho da Edge Function sao byte-identicos', () => {
  const core = readFileSync(new URL('./pos-consulta-autenticacao-interna.ts', import.meta.url), 'utf8');
  const edge = readFileSync(
    new URL('../../supabase/functions/iris-nova-pos-consulta/pos-consulta-autenticacao-interna.ts', import.meta.url),
    'utf8'
  );
  assert.equal(edge, core);
});
