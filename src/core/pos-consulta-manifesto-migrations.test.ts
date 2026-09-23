import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

// O MANIFESTO de migrations e o registro de quais arquivos foram (ou serao)
// aplicados e com que SHA-256. Este teste impede que ele fique defasado: os hashes
// e as versoes das migrations de pos-consulta que ele cita precisam bater com os
// arquivos reais (sexta revisao do Codex, bloqueador 2 -- a versao do arquivo e a
// que vai para o historico remoto).

const DIR = new URL('../supabase/migrations/', import.meta.url);
const manifesto = readFileSync(new URL('MANIFESTO.md', DIR), 'utf8');
const sha = (arquivo: string) => createHash('sha256').update(readFileSync(new URL(arquivo, DIR))).digest('hex');
const arquivosPosConsulta = readdirSync(DIR).filter((f) => /^\d{14}_iris_nova_pos_consulta_.*\.sql$/.test(f)).sort();

test('existem as tres migrations de pos-consulta, com versoes crescentes', () => {
  assert.deepEqual(arquivosPosConsulta.map((f) => f.slice(0, 14)), ['20260919204030', '20260920230000', '20260921000000']);
});

test('cada migration de pos-consulta aparece no MANIFESTO com o SHA-256 REAL do arquivo', () => {
  for (const arquivo of arquivosPosConsulta) {
    assert.ok(manifesto.includes(arquivo), `${arquivo} deveria constar no MANIFESTO`);
    assert.ok(manifesto.includes(sha(arquivo)), `o SHA-256 de ${arquivo} no MANIFESTO esta defasado (real: ${sha(arquivo)})`);
  }
});

test('a migration ja registrada no operacional mantem o conteudo aplicado (mesmo SHA-256 de antes da renomeacao)', () => {
  assert.equal(sha('20260919204030_iris_nova_pos_consulta_v1.sql'), '2b089287d45fc4648c32bc259211c32b5edf7eafc49f9d011aa13fc8dd75427c');
});

test('o plano do MANIFESTO nao manda aplicar por apply_migration nem renomear/reparar depois', () => {
  assert.match(manifesto, /NAO serao aplicadas por `apply_migration`/);
  assert.match(manifesto, /supabase db push/);
  assert.match(manifesto, /dry-run/i);
  for (const arquivo of arquivosPosConsulta.slice(1)) {
    const texto = readFileSync(new URL(arquivo, DIR), 'utf8');
    assert.match(texto, /NAO use `apply_migration`|NAO aplique por `apply_migration`/, `${arquivo} deve alertar contra apply_migration`);
    assert.doesNotMatch(texto, /Logo depois de aplicar, conferir[\s\S]{0,80}RENOMEAR/, `${arquivo} nao pode mais mandar renomear depois de aplicar`);
  }
});
