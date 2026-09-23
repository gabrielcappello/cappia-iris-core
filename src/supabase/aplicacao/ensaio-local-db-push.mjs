// ENSAIO LOCAL do plano de aplicacao das migrations pendentes (revisao do Codex,
// bloqueador 2 da sexta revisao): prova, contra o Postgres LOCAL DESCARTAVEL e a CLI
// real do Supabase, que `supabase db push` a partir do workspace preparado por
// preparar-workspace-db-push.mjs (a) lista EXATAMENTE as migrations pendentes no
// dry-run, (b) registra no historico a VERSAO DE CADA ARQUIVO (nenhuma versao gerada
// pelo servidor, nenhuma renomeacao depois) e (c) nao precisa de `migration repair`.
//
// NUNCA toca o operacional nem qualquer projeto hospedado: mesmas travas do runner
// SQL (loopback estrito + marca `iris.ambiente_teste_descartavel = 'local'` no proprio
// banco + `--confirmo-projeto=local`).
//
// Uso (a partir de cappia-iris-core/src):
//   node supabase/tests/ambiente-local/ambiente-local.mjs subir
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/iris_teste_local \
//     node supabase/aplicacao/ensaio-local-db-push.mjs --confirmo-projeto=local

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { refsDaConexao } from '../tests/identidade-conexao.mjs';
import { prepararWorkspaceDbPush } from './preparar-workspace-db-push.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIR_MIGRATIONS = join(AQUI, '..', 'migrations');
const VERSAO_JA_REGISTRADA = '20260919204030'; // pos_consulta_v1 -- ja aplicada no operacional
const PROJETO_PROIBIDO = 'udizowyfjnhuhgxkeayk';

const log = (m) => console.log(m);
const abortar = (m) => { console.error(`\nABORTADO: ${m}\n`); process.exit(1); };
const assert = (cond, msg) => { if (!cond) throw new Error(`ASSERCAO FALHOU: ${msg}`); };
const semAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

const url = process.env.DATABASE_URL;
if (!url) abortar('DATABASE_URL ausente.');
if (process.argv.find((a) => a.startsWith('--confirmo-projeto=')) !== '--confirmo-projeto=local') abortar('passe --confirmo-projeto=local (este ensaio so roda no ambiente local descartavel).');
{
  const u = new URL(url);
  for (const chave of ['host', 'hostaddr', 'service']) if (u.searchParams.has(chave)) abortar(`parametro de query '${chave}' recusado.`);
}
const identidade = refsDaConexao(url, { permitirLocal: true });
if (!identidade.ok) abortar(identidade.erro);
if (identidade.refs.includes(PROJETO_PROIBIDO)) abortar('a DATABASE_URL aponta para o projeto operacional. Recusado.');
if (!identidade.refs.every((r) => r === 'local')) abortar('a DATABASE_URL nao e do ambiente local.');

// Migrations PENDENTES = todas com versao > a ja registrada no "remoto simulado".
const arquivos = readdirSync(DIR_MIGRATIONS).filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f));
const pendentes = arquivos.filter((f) => f.slice(0, 14) > VERSAO_JA_REGISTRADA && f.slice(0, 14) >= '20260920').sort();
const arquivoV1 = arquivos.find((f) => f.startsWith(VERSAO_JA_REGISTRADA));
assert(arquivoV1 !== undefined, `migration ${VERSAO_JA_REGISTRADA}_*.sql nao encontrada`);
assert(pendentes.length >= 1, 'nenhuma migration pendente encontrada');

const cliente = new pg.Client({ connectionString: url });
let workspace;

async function limparTudo() {
  await cliente.query(`
    do $$ declare r record; begin
      for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname like 'cappia_pos_consulta_%' loop
        execute 'drop function if exists ' || r.f || ' cascade';
      end loop;
    end $$;
    drop table if exists public.pos_consulta_jornadas cascade;
    drop schema if exists supabase_migrations cascade;
  `);
}

try {
  await cliente.connect();
  const marca = (await cliente.query(`select current_setting('iris.ambiente_teste_descartavel', true) as m`)).rows[0].m;
  if (marca !== 'local') abortar('o banco nao tem a marca de ambiente local descartavel.');

  const pre = (await cliente.query(`
    select (select count(*) from information_schema.tables where table_schema='public' and table_name='pos_consulta_jornadas')::int t,
           (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'cappia_pos_consulta_%')::int f,
           (select count(*) from information_schema.schemata where schema_name='supabase_migrations')::int s`)).rows[0];
  if (pre.t + pre.f + pre.s > 0) abortar(`o ambiente local nao esta limpo (tabela=${pre.t}, funcoes=${pre.f}, schema de historico=${pre.s}).`);

  // ── 1) "REMOTO" SIMULADO: historico com versoes anteriores + a v1 ja aplicada ──
  log('\n[1] Simulando o historico remoto (versoes anteriores + pos_consulta_v1 ja aplicada)...');
  const remotas = [
    { version: '20260729033207', name: 'iris_nova_identificacao_v1' },
    { version: '20260731164424', name: 'iris_nova_interpretacao_v1' },
    { version: VERSAO_JA_REGISTRADA, name: 'iris_nova_pos_consulta_v1' },
  ];
  await cliente.query(`create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text)`);
  const sqlV1 = readFileSync(join(DIR_MIGRATIONS, arquivoV1), 'utf8');
  await cliente.query(sqlV1); // o remoto ja tem a v1
  for (const r of remotas) {
    await cliente.query('insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)', [r.version, r.name, r.version === VERSAO_JA_REGISTRADA ? [sqlV1] : ['-- historico simulado']]);
  }
  log(`  OK: ${remotas.length} versoes no historico simulado; v1 aplicada.`);

  // ── 2) WORKSPACE ─────────────────────────────────────────────────────
  log('\n[2] Preparando o workspace (marcadores + copias byte-identicas das pendentes)...');
  workspace = mkdtempSync(join(tmpdir(), `iris-dbpush-${randomUUID().slice(0, 8)}-`));
  rmSync(workspace, { recursive: true, force: true }); // o preparador exige destino vazio/inexistente
  const preparo = prepararWorkspaceDbPush({ versoesRemotas: remotas, pendentes: pendentes.map((f) => join(DIR_MIGRATIONS, f)), destino: workspace });
  log(`  OK: ${preparo.marcadores} marcadores; pendentes: ${preparo.pendentes.map((p) => p.versao).join(', ')}`);

  // Loopback sem caracteres especiais. O Postgres local nao tem SSL e a CLI o exige por padrao:
  // `sslmode=disable` SO neste ensaio local (o alvo real usa SSL normalmente).
  const urlCodificada = `${url}${url.includes('?') ? '&' : '?'}sslmode=disable`;
  const cli = (extra) => {
    const r = spawnSync('supabase', ['db', 'push', '--workdir', workspace, '--db-url', urlCodificada, ...extra], { encoding: 'utf8', timeout: 120000 });
    return { codigo: r.status, saida: semAnsi(`${r.stdout ?? ''}\n${r.stderr ?? ''}`) };
  };

  // ── 2b) CONTROLE NEGATIVO: sem os marcadores, a CLI RECUSA (pede `migration repair`) ──
  // E por isso o workspace precisa deles -- e o motivo de nao existir atalho "so com as pendentes".
  log('\n[2b] Controle negativo: workspace SO com as pendentes (sem marcadores) -- a CLI deve recusar...');
  const semMarcadores = mkdtempSync(join(tmpdir(), 'iris-dbpush-neg-'));
  try {
    mkdirSync(join(semMarcadores, 'supabase', 'migrations'), { recursive: true });
    writeFileSync(join(semMarcadores, 'supabase', 'config.toml'), '# negativo\n');
    for (const f of pendentes) copyFileSync(join(DIR_MIGRATIONS, f), join(semMarcadores, 'supabase', 'migrations', f));
    const neg = spawnSync('supabase', ['db', 'push', '--dry-run', '--workdir', semMarcadores, '--db-url', `${url}${url.includes('?') ? '&' : '?'}sslmode=disable`], { encoding: 'utf8', timeout: 120000 });
    const saidaNeg = semAnsi(`${neg.stdout ?? ''}\n${neg.stderr ?? ''}`);
    assert(neg.status !== 0, 'sem marcadores, a CLI deveria RECUSAR (historico remoto tem versoes sem arquivo local)');
    assert(/repair|not found|local migration/i.test(saidaNeg), `a recusa deveria citar o historico divergente: ${saidaNeg.slice(0, 300)}`);
    log('  OK: sem marcadores a CLI recusa e sugere `migration repair` -- por isso o workspace leva marcadores em vez de reparar o historico.');
  } finally {
    rmSync(semMarcadores, { recursive: true, force: true });
  }

  // ── 3) DRY-RUN: tem que listar EXATAMENTE as pendentes ────────────────────
  log('\n[3] supabase db push --dry-run ...');
  const seco = cli(['--dry-run']);
  assert(seco.codigo === 0, `dry-run falhou (codigo ${seco.codigo}): ${seco.saida.slice(0, 600)}`);
  const listadas = [...new Set([...seco.saida.matchAll(/(\d{14}_[a-z0-9_]+\.sql)/g)].map((m) => m[1]))].sort();
  assert(JSON.stringify(listadas) === JSON.stringify([...pendentes].sort()), `dry-run deveria listar EXATAMENTE ${JSON.stringify(pendentes)}, listou ${JSON.stringify(listadas)}`);
  log(`  OK: o dry-run lista exatamente as pendentes: ${listadas.join(' | ')}`);

  // ── 4) PUSH REAL (no banco LOCAL descartavel) ─────────────────────────────
  log('\n[4] supabase db push (real, no banco local)...');
  const real = cli(['--yes']);
  assert(real.codigo === 0, `push falhou (codigo ${real.codigo}): ${real.saida.slice(0, 800)}`);

  // ── 5) O HISTORICO TEM AS VERSOES DOS ARQUIVOS -- e so elas ────────────────
  log('\n[5] Conferindo o historico...');
  const historico = (await cliente.query('select version, name from supabase_migrations.schema_migrations order by version')).rows;
  const esperado = [...remotas.map((r) => r.version), ...pendentes.map((f) => f.slice(0, 14))].sort();
  assert(JSON.stringify(historico.map((h) => h.version)) === JSON.stringify(esperado), `historico deveria ter exatamente ${JSON.stringify(esperado)}, tem ${JSON.stringify(historico.map((h) => h.version))}`);
  for (const f of pendentes) {
    const linha = historico.find((h) => h.version === f.slice(0, 14));
    assert(linha !== undefined, `versao ${f.slice(0, 14)} ausente do historico`);
    assert(linha.name === f.slice(15, -4), `nome registrado '${linha.name}' diverge do nome do arquivo '${f.slice(15, -4)}'`);
  }
  log(`  OK: historico = ${historico.map((h) => h.version).join(', ')}`);
  log('  OK: cada pendente foi registrada com A VERSAO DO PROPRIO ARQUIVO (nenhuma versao gerada, nenhuma renomeacao, nenhum `migration repair`).');

  // ── 6) OS OBJETOS EXISTEM; UM SEGUNDO DRY-RUN NAO TEM MAIS NADA A FAZER ────
  const objetos = (await cliente.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname like 'cappia_pos_consulta_%' order by 1`)).rows.map((r) => r.proname);
  assert(objetos.includes('cappia_pos_consulta_janela_maxima_minutos'), 'a funcao da janela deveria existir apos o push');
  log(`  OK: ${objetos.length} funcoes cappia_pos_consulta_* presentes: ${objetos.join(', ')}`);
  const denovo = cli(['--dry-run']);
  assert(denovo.codigo === 0 && !/\d{14}_[a-z0-9_]+\.sql/.test(denovo.saida.replace(/supabase\/migrations/g, '')), `um segundo dry-run nao deveria listar migrations: ${denovo.saida.slice(0, 400)}`);
  log('  OK: um segundo dry-run nao lista nada (historico e objetos consistentes; nada a reaplicar).');

  log('\n✅ ENSAIO PASSOU: o plano `db push` a partir do workspace preserva a versao de cada arquivo no historico, sem `migration repair` e sem renomear depois.\n');
} catch (e) {
  console.error(`\n❌ FALHOU: ${e.message}\n`);
  process.exitCode = 1;
} finally {
  try {
    await limparTudo();
    log('Limpeza: objetos e schema de historico do ensaio removidos do banco local.');
  } catch (e) {
    console.error(`AVISO: limpeza incompleta -- rode ambiente-local destruir/subir se necessario. ${e.message}`);
  }
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  await cliente.end().catch(() => {});
}
