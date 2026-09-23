// Testes do preparador de workspace para `supabase db push` (sexta revisao do Codex,
// bloqueador 2). Rodar: node --test supabase/aplicacao/preparar-workspace-db-push.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ErroPreparoWorkspace, prepararWorkspaceDbPush } from './preparar-workspace-db-push.mjs';

const REMOTAS = [
  { version: '20260729033207', name: 'iris_nova_identificacao_v1' },
  { version: '20260919204030', name: 'iris_nova_pos_consulta_v1' },
];

function ambiente() {
  const raiz = mkdtempSync(join(tmpdir(), 'iris-prep-test-'));
  const dirPend = join(raiz, 'pendentes');
  mkdirSync(dirPend);
  const pend = (nome, sql = `select 1; -- ${nome}\n`) => {
    const caminho = join(dirPend, nome);
    writeFileSync(caminho, sql);
    return caminho;
  };
  return { raiz, pend, destino: join(raiz, 'ws'), limpar: () => rmSync(raiz, { recursive: true, force: true }) };
}
const sha = (caminho) => createHash('sha256').update(readFileSync(caminho)).digest('hex');

test('monta marcadores para as versoes remotas e copias BYTE-IDENTICAS das pendentes, com a versao do arquivo', () => {
  const a = ambiente();
  try {
    const p1 = a.pend('20260920230000_janela.sql', 'create table t1 (id int);\n-- acentuação ç ã\n');
    const p2 = a.pend('20260921000000_recuperacao.sql');
    const r = prepararWorkspaceDbPush({ versoesRemotas: REMOTAS, pendentes: [p2, p1], destino: a.destino });

    const dir = join(a.destino, 'supabase', 'migrations');
    assert.deepEqual(readdirSync(dir).sort(), [
      '20260729033207_iris_nova_identificacao_v1.sql',
      '20260919204030_iris_nova_pos_consulta_v1.sql',
      '20260920230000_janela.sql',
      '20260921000000_recuperacao.sql',
    ]);
    assert.equal(sha(join(dir, '20260920230000_janela.sql')), sha(p1), 'copia byte-identica (inclusive acentos)');
    assert.equal(sha(join(dir, '20260921000000_recuperacao.sql')), sha(p2));
    assert.deepEqual(r.pendentes.map((p) => p.versao), ['20260920230000', '20260921000000'], 'ordenadas por versao, com a versao do ARQUIVO');
    assert.equal(r.marcadores, 2);
    assert.equal(r.maiorRemota, '20260919204030');
    // marcadores nao contem SQL executavel
    assert.ok(!/create|insert|drop|alter/i.test(readFileSync(join(dir, '20260729033207_iris_nova_identificacao_v1.sql'), 'utf8').replace(/^--.*$/gm, '')));
    assert.ok(existsSync(join(a.destino, 'supabase', 'config.toml')));
  } finally {
    a.limpar();
  }
});

test('recusa versao pendente JA registrada no remoto (nunca reaplicar nem renomear)', () => {
  const a = ambiente();
  try {
    const p = a.pend('20260919204030_iris_nova_pos_consulta_v1.sql');
    assert.throws(() => prepararWorkspaceDbPush({ versoesRemotas: REMOTAS, pendentes: [p], destino: a.destino }), /JA esta registrada/);
    assert.ok(!existsSync(a.destino), 'nada foi criado');
  } finally {
    a.limpar();
  }
});

test('recusa versao pendente ANTERIOR a ultima remota (a CLI exigiria --include-all)', () => {
  const a = ambiente();
  try {
    const p = a.pend('20260801000000_antiga.sql');
    assert.throws(() => prepararWorkspaceDbPush({ versoesRemotas: REMOTAS, pendentes: [p], destino: a.destino }), /ANTERIOR a ultima versao remota/);
    // so com opt-in explicito
    const r = prepararWorkspaceDbPush({ versoesRemotas: REMOTAS, pendentes: [p], destino: a.destino, permitirAnteriorAoRemoto: true });
    assert.equal(r.pendentes.length, 1);
  } finally {
    a.limpar();
  }
});

test('recusa nomes invalidos, versoes duplicadas, arquivo inexistente e historico remoto vazio', () => {
  const a = ambiente();
  try {
    assert.throws(() => prepararWorkspaceDbPush({ versoesRemotas: REMOTAS, pendentes: [a.pend('migration_sem_versao.sql')], destino: a.destino }), /nome de migration invalido/);
    assert.throws(() => prepararWorkspaceDbPush({ versoesRemotas: REMOTAS, pendentes: [a.pend('20260920230000_ABC.sql')], destino: a.destino }), /nome de migration invalido/);
    const x = a.pend('20260920230000_a.sql');
    const y = a.pend('20260920230000_b.sql');
    assert.throws(() => prepararWorkspaceDbPush({ versoesRemotas: REMOTAS, pendentes: [x, y], destino: a.destino }), /versao pendente duplicada/);
    assert.throws(() => prepararWorkspaceDbPush({ versoesRemotas: REMOTAS, pendentes: [join(a.raiz, 'nao-existe', '20260920230000_z.sql')], destino: a.destino }), /nao existe/);
    assert.throws(() => prepararWorkspaceDbPush({ versoesRemotas: [], pendentes: [x], destino: a.destino }), ErroPreparoWorkspace);
    assert.throws(() => prepararWorkspaceDbPush({ versoesRemotas: [{ version: '2026', name: 'x' }], pendentes: [x], destino: a.destino }), /versao remota invalida/);
    assert.throws(() => prepararWorkspaceDbPush({ versoesRemotas: [...REMOTAS, REMOTAS[0]], pendentes: [x], destino: a.destino }), /versao remota duplicada/);
  } finally {
    a.limpar();
  }
});

test('recusa destino que ja tem conteudo (nunca mistura com um workspace anterior)', () => {
  const a = ambiente();
  try {
    mkdirSync(a.destino);
    writeFileSync(join(a.destino, 'lixo.txt'), 'x');
    assert.throws(() => prepararWorkspaceDbPush({ versoesRemotas: REMOTAS, pendentes: [a.pend('20260920230000_a.sql')], destino: a.destino }), /destino nao esta vazio/);
  } finally {
    a.limpar();
  }
});

test('o preparador nunca conecta a rede nem le credenciais: so usa fs/crypto/path', () => {
  const fonte = readFileSync(new URL('./preparar-workspace-db-push.mjs', import.meta.url), 'utf8');
  assert.ok(!/from 'node:(net|http|https|child_process|tls|dns)'|from 'pg'|process\.env|fetch\(/.test(fonte));
});
