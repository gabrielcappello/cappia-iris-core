// Testes locais das duas guardas do teste A×B. NAO tocam banco, nao abrem
// conexao e nao leem credencial: toda URL aqui e sintetica e inventada.
//
// Rodar:  node --test supabase/tests/identidade-conexao.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refsDaConexao } from './identidade-conexao.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const AUTORIZADO = 'bcmuqautblvjdqzhjfbw';
const PROIBIDO = 'udizowyfjnhuhgxkeayk';

// ── GUARDA 1: identidade do projeto por hostname/username ───────────────

test('conexao direta ao projeto autorizado e identificada', () => {
  const r = refsDaConexao(`postgresql://postgres:senha@db.${AUTORIZADO}.supabase.co:5432/postgres`);
  assert.deepEqual(r, { ok: true, refs: [AUTORIZADO] });
});

test('pooler oficial identifica o ref pelo username', () => {
  const r = refsDaConexao(`postgresql://postgres.${AUTORIZADO}:senha@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`);
  assert.deepEqual(r, { ok: true, refs: [AUTORIZADO] });
});

test('conexao direta ao projeto OPERACIONAL e identificada (para ser recusada)', () => {
  const r = refsDaConexao(`postgresql://postgres:senha@db.${PROIBIDO}.supabase.co:5432/postgres`);
  assert.deepEqual(r, { ok: true, refs: [PROIBIDO] });
});

// -- o furo que `includes` tinha --

test('ref autorizado na SENHA nao mascara host operacional', () => {
  // `includes(AUTORIZADO)` diria "sim" -- e a conexao iria para producao.
  const r = refsDaConexao(`postgresql://postgres:${AUTORIZADO}@db.${PROIBIDO}.supabase.co:5432/postgres`);
  assert.deepEqual(r, { ok: true, refs: [PROIBIDO] }, 'o ref precisa vir do host, nunca da senha');
});

test('ref autorizado no NOME DO BANCO nao mascara host alheio', () => {
  const r = refsDaConexao(`postgresql://postgres:x@db.outroprojeto.supabase.co:5432/${AUTORIZADO}`);
  assert.deepEqual(r, { ok: true, refs: ['outroprojeto'] });
});

test('ref autorizado em PARAMETRO DE QUERY nao mascara host alheio', () => {
  const r = refsDaConexao(`postgresql://postgres:x@db.outroprojeto.supabase.co:5432/postgres?options=${AUTORIZADO}`);
  assert.deepEqual(r, { ok: true, refs: ['outroprojeto'] });
});

// -- a correcao pedida: username so vale no pooler oficial --

test('username correto em HOST EXTERNO e recusado (nao identificavel)', () => {
  const r = refsDaConexao(`postgresql://postgres.${AUTORIZADO}:senha@db.evil.com:5432/postgres`);
  assert.equal(r.ok, false, 'host externo nao pode ser validado pelo username');
  assert.match(r.erro, /nao foi possivel identificar o projeto/);
});

test('username correto em host que só TERMINA parecido e recusado', () => {
  // `pooler.supabase.com.evil.com` nao casa com o ancoramento em `$`.
  const r = refsDaConexao(`postgresql://postgres.${AUTORIZADO}:x@aws-0-sa-east-1.pooler.supabase.com.evil.com:6543/postgres`);
  assert.equal(r.ok, false);
  assert.match(r.erro, /nao foi possivel identificar o projeto/);
});

test('pooler oficial com username de OUTRO projeto devolve aquele projeto', () => {
  const r = refsDaConexao(`postgresql://postgres.${PROIBIDO}:x@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`);
  assert.deepEqual(r, { ok: true, refs: [PROIBIDO] });
});

// -- formas invalidas --

test('URL malformada, protocolo errado e host nao-Supabase sao recusados', () => {
  for (const u of ['nao-e-url', 'https://db.x.supabase.co/', 'postgresql://postgres:x@localhost:5432/postgres']) {
    assert.equal(refsDaConexao(u).ok, false, `deveria recusar: ${u}`);
  }
});

// ── GUARDA 2: telefone sintetico da fixture ─────────────────────────────
// O CHECK `pacientes_telefone_formato` exige `^[0-9]+$`. Um telefone
// derivado do marcador (uuid) carregaria a-f e violaria o CHECK na primeira
// execucao.

const CHECK_TELEFONE = /^[0-9]+$/;

test('a fixture A×B nao deriva telefone do marcador', async () => {
  const sql = await readFile(join(AQUI, '20260815121000_iris_nova_commit_turno_v2_cancelar_axb_fixtures.sql'), 'utf8');
  const insercao = sql.match(/insert into pacientes[\s\S]*?;/i);
  assert.ok(insercao, 'insert de pacientes nao encontrado');
  // O marcador ($1) e legitimo em `nome` e no WHERE -- o que nao pode e ele
  // alcancar o telefone. A projecao do SELECT tem a ordem das colunas do
  // INSERT: (clinica_id, telefone_normalizado, nome); o telefone e o 2o item.
  const projecao = insercao[0].match(/select\s+([\s\S]*?)\s+from\s/i);
  assert.ok(projecao, 'projecao do select nao encontrada');
  const telefone = projecao[1].split(',')[1].trim();
  assert.doesNotMatch(
    telefone,
    /\$1|substr|replace/i,
    `o telefone nao pode derivar do marcador (veio: ${telefone}) -- uuid tem a-f e viola o CHECK`
  );
});

test('o telefone literal da fixture passa no CHECK numerico', async () => {
  const sql = await readFile(join(AQUI, '20260815121000_iris_nova_commit_turno_v2_cancelar_axb_fixtures.sql'), 'utf8');
  const insercao = sql.match(/insert into pacientes[\s\S]*?;/i)[0];
  const literais = [...insercao.matchAll(/'(\d{8,})'/g)].map((m) => m[1]);
  assert.ok(literais.length > 0, 'nenhum telefone literal encontrado no insert');
  for (const t of literais) {
    assert.match(t, CHECK_TELEFONE, `telefone ${t} violaria pacientes_telefone_formato`);
  }
});

test('um telefone derivado de uuid REALMENTE violaria o CHECK (prova do bug evitado)', () => {
  // Reproduz a forma antiga: '5511' + 9 primeiros caracteres do uuid sem
  // hifens. Um uuid sempre tem digitos hexadecimais; a chance de os 9
  // primeiros serem todos numericos e desprezivel, entao fixamos um caso
  // representativo em vez de sortear.
  const derivado = '5511' + '1c32597fd5de4545'.replace(/-/g, '').substring(0, 9);
  assert.doesNotMatch(derivado, CHECK_TELEFONE, 'a forma antiga precisa mesmo falhar o CHECK');
});

// ── GUARDA 3: transporte da versao (timestamptz) sem perda ──────────────
// `pg` mapeia timestamptz para `Date`, que guarda MILISSEGUNDOS. A RPC
// calcula `greatest(now(), versao + 1 microsegundo)` e o CAS compara por
// igualdade ESTRITA -- entao um round-trip por `Date` trunca o microssegundo
// e a chamada seguinte volta turno_obsoleto/versao_divergente sem que nada
// tenha mudado. Foi exatamente o que aconteceu na primeira execucao do A×B.

// Duas versoes distantes 1µs -- a forma que a RPC produz.
const VERSAO_BASE = '2026-08-15 18:04:05.123456+00';
const VERSAO_MAIS_1US = '2026-08-15 18:04:05.123457+00';

test('a forma ANTIGA (Date) perde microssegundos e confunde duas versoes distintas', () => {
  const comoDate = (s) => new Date(s);
  const a = comoDate(VERSAO_BASE);
  const b = comoDate(VERSAO_MAIS_1US);

  // Os dois instantes sao DIFERENTES no Postgres, mas viram o mesmo Date.
  assert.equal(a.getTime(), b.getTime(), 'Date colapsa 1µs de diferenca em milissegundos');

  // E o round-trip por toISOString() devolve 3 casas, nao 6: o valor que
  // voltaria ao banco ja nao e o que de la saiu.
  assert.equal(a.toISOString(), '2026-08-15T18:04:05.123Z');
  assert.notEqual(
    a.toISOString(),
    VERSAO_BASE,
    'o texto reenviado difere do original -- e o CAS por igualdade estrita falha'
  );
});

test('a forma TEXTUAL preserva os microssegundos e distingue as duas versoes', () => {
  // `::text` devolve a string do Postgres tal como esta; passa-la de volta
  // ao parametro timestamptz nao perde nada.
  assert.notEqual(VERSAO_BASE, VERSAO_MAIS_1US, 'como texto, 1µs continua sendo diferenca');
  assert.match(VERSAO_BASE, /\.\d{6}/, 'a precisao de 6 casas fica preservada');
  // Identidade do round-trip: o que vai ao banco e exatamente o que veio.
  const trafegado = String(VERSAO_BASE);
  assert.equal(trafegado, VERSAO_BASE, 'texto vai e volta identico -- o CAS estrito confere');
});

test('o runner A×B le a versao como ::text e nao compara datas em JavaScript', async () => {
  const src = await readFile(join(AQUI, 'executar-teste-axb-commit-v2-cancelar.mjs'), 'utf8');
  const codigo = src.replace(/^\s*\/\/.*$/gm, '');

  // Toda leitura SQL de atualizado_em precisa ser ::text -- o que vem depois
  // de `select`/`,` dentro de uma query. (`.rows[0].atualizado_em` e acesso
  // ao resultado ja convertido, nao leitura, e nao entra nesta regra.)
  const leiturasSql = codigo.match(/(?:select|,)\s+e?\.?atualizado_em\b(?!\s*::text)[^\n]*/gi) ?? [];
  for (const leitura of leiturasSql) {
    assert.ok(
      /::text|>\s*\$\d+::timestamptz/.test(leitura),
      `leitura SQL de atualizado_em sem ::text: ${leitura.trim()}`
    );
  }
  assert.ok(codigo.includes('atualizado_em::text'), 'a versao precisa ser lida como ::text');
  // Nenhuma comparacao de versao em JavaScript.
  assert.doesNotMatch(codigo, /getTime\(\)/, 'comparacao de versao nao pode acontecer em JavaScript');
  assert.doesNotMatch(codigo, /toISOString\(\)/, 'a versao nao pode ser reserializada por Date');
  // O avanco e provado no proprio SQL.
  assert.match(codigo, /atualizado_em\s*>\s*\$\d+::timestamptz/, 'o avanco deve ser comparado no SQL');
});
