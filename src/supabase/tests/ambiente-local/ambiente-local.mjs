// Ambiente LOCAL DESCARTAVEL de Postgres para o runner SQL de pos-consulta.
//
// Aprovado pelo Gabriel (Opcao A de PROPOSTA_AMBIENTE_TESTE.md): nada aqui
// toca nenhum projeto Supabase hospedado -- tudo roda em 127.0.0.1, num
// diretorio de dados que se apaga com `destruir`.
//
// USO (a partir de cappia-iris-core/src):
//   node supabase/tests/ambiente-local/ambiente-local.mjs subir
//   node supabase/tests/ambiente-local/ambiente-local.mjs parar
//   node supabase/tests/ambiente-local/ambiente-local.mjs destruir
//
// Este script e o caminho SEM ADMIN (binarios reais do Postgres 17 via o pacote
// npm `embedded-postgres`, instalado FORA do repositorio). Se o Docker Desktop
// estiver disponivel, o caminho `supabase start` da LEIA-ME.md e equivalente e
// mais fiel ao hospedado -- mas exige WSL2/Docker (passos de administrador).
//
// Variaveis (todas opcionais):
//   IRIS_PG_LOCAL_BIN   diretorio com initdb/pg_ctl/postgres
//   IRIS_PG_LOCAL_DATA  diretorio de dados (default ~/.local/iris-pg-local/data)
//   IRIS_PG_LOCAL_PORT  porta (default 54329)
//
// AUTORIZACAO EXPLICITA DO AMBIENTE LOCAL: `subir` grava no proprio banco a
// marca `iris.ambiente_teste_descartavel = 'local'` (ALTER DATABASE ... SET).
// O runner SQL so aceita uma conexao local se essa marca existir -- assim, um
// tunel/port-forward que leve `localhost` ate o banco OPERACIONAL nunca passa
// pelo modo local (o operacional nao tem essa marca).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_TOOLS = join(homedir(), '.local', 'iris-pg-local');
const BIN = process.env.IRIS_PG_LOCAL_BIN ?? join(RAIZ_TOOLS, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');
const DATA = process.env.IRIS_PG_LOCAL_DATA ?? join(RAIZ_TOOLS, 'data');
const PORTA = Number(process.env.IRIS_PG_LOCAL_PORT ?? 54329);
const BANCO = 'iris_teste_local';
const MARCA_ARQUIVO = join(DATA, 'iris-ambiente-local.marker');
const exe = (nome) => join(BIN, `${nome}.exe`);

function abortar(m) { console.error(`\nABORTADO: ${m}\n`); process.exit(1); }
function log(m) { console.log(m); }

function pgCtl(...args) {
  // stdio 'ignore' de proposito: com 'pipe', o postmaster (filho do pg_ctl no
  // Windows) herda os handles do pipe e o execFileSync nunca ve o EOF -- trava
  // para sempre mesmo com o servidor ja no ar. O log vai para data/log.txt (-l).
  execFileSync(exe('pg_ctl'), ['-D', DATA, ...args], { stdio: 'ignore' });
}
function emExecucao() {
  // `pg_ctl status` sai com 0 se o servidor esta no ar, 3 se parado.
  try { pgCtl('status'); return true; } catch { return false; }
}

async function conectar(banco) {
  const c = new pg.Client({ host: '127.0.0.1', port: PORTA, user: 'postgres', password: 'postgres', database: banco });
  await c.connect();
  return c;
}

async function subir() {
  if (!existsSync(exe('initdb'))) abortar(`binarios do Postgres nao encontrados em ${BIN}. Ver LEIA-ME.md (instalar embedded-postgres).`);

  if (!existsSync(join(DATA, 'PG_VERSION'))) {
    log(`Inicializando cluster novo em ${DATA} ...`);
    mkdirSync(DATA, { recursive: true });
    const pwfile = join(tmpdir(), `iris-pg-pw-${process.pid}.txt`);
    writeFileSync(pwfile, 'postgres\n');
    try {
      execFileSync(exe('initdb'), ['-D', DATA, '-U', 'postgres', '--auth=scram-sha-256', `--pwfile=${pwfile}`, '-E', 'UTF8', '--no-locale'], { stdio: 'pipe' });
    } finally {
      unlinkSync(pwfile);
    }
    writeFileSync(MARCA_ARQUIVO, 'criado por ambiente-local.mjs -- seguro apagar com `destruir`\n');
  }

  if (!emExecucao()) {
    log(`Iniciando Postgres em 127.0.0.1:${PORTA} ...`);
    pgCtl('-o', `-p ${PORTA} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`, '-l', join(DATA, 'log.txt'), '-w', 'start');
  } else {
    log('Postgres ja estava em execucao.');
  }

  const admin = await conectar('postgres');
  try {
    const { rows } = await admin.query('select 1 from pg_database where datname = $1', [BANCO]);
    if (rows.length === 0) {
      await admin.query(`create database ${BANCO}`);
      log(`Banco ${BANCO} criado.`);
    }
    // Autorizacao explicita do ambiente local (ver cabecalho).
    await admin.query(`alter database ${BANCO} set iris.ambiente_teste_descartavel = 'local'`);
  } finally {
    await admin.end();
  }

  const c = await conectar(BANCO);
  try {
    await c.query(await readFile(join(AQUI, '01-roles-supabase.sql'), 'utf8'));
    const { rows } = await c.query(`select to_regclass('public.clinicas') as t`);
    if (rows[0].t === null) {
      await c.query(await readFile(join(AQUI, '02-schema-legado-minimo.sql'), 'utf8'));
      log('Schema minimo (clinicas/pacientes/agendamentos) criado.');
    } else {
      log('Schema minimo ja existia -- mantido.');
    }
  } finally {
    await c.end();
  }

  log('\nPRONTO. Use:');
  log(`  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${PORTA}/${BANCO}`);
  log('  ... executar-teste-pos-consulta-v1.mjs --aplicar --confirmo-projeto=local');
}

function parar() {
  if (!existsSync(join(DATA, 'PG_VERSION'))) return log('Nada a parar: cluster inexistente.');
  if (!emExecucao()) return log('Ja estava parado.');
  pgCtl('-m', 'fast', '-w', 'stop');
  log('Parado.');
}

function destruir() {
  if (!existsSync(MARCA_ARQUIVO)) {
    abortar(`recusado: ${DATA} nao tem a marca deste script (${MARCA_ARQUIVO}). Nao vou apagar um diretorio que nao criei.`);
  }
  if (emExecucao()) pgCtl('-m', 'immediate', '-w', 'stop');
  rmSync(DATA, { recursive: true, force: true });
  log(`Removido ${DATA}.`);
}

const comando = process.argv[2];
if (comando === 'subir') await subir();
else if (comando === 'parar') parar();
else if (comando === 'destruir') destruir();
else abortar('uso: ambiente-local.mjs <subir|parar|destruir>');
