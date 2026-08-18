// Runner do teste CONCORRENTE A×B de
// 20260815122000_iris_nova_commit_turno_v2_criar.sql
//
// Projeto-alvo: cappia-iris-core-dev (bcmuqautblvjdqzhjfbw).
//
// STATUS: EXECUTADO E APROVADO em 2026-08-15, no projeto dev
// bcmuqautblvjdqzhjfbw. Os DOIS cenarios passaram, cada um com sua barreira
// confirmada por pg_blocking_pids -- linha da conversa no cenario 1, advisory
// lock no cenario 2. Limpeza completa, zero residuos, producao intocada.
//
// DOIS DEFEITOS DO PROPRIO RUNNER, corrigidos antes da aprovacao (a RPC nao
// foi alterada em nenhum deles):
//   1. as fixtures usam quantidades DIFERENTES de parametros por statement
//      ($1 so, $1+$2, ou os tres), e o runner mandava sempre os tres -- o
//      protocolo estendido exige correspondencia exata, e o primeiro insert
//      falhava com "bind message supplies 3 parameters";
//   2. entre os cenarios, `dados` nao era restaurado: o cenario 1 termina com
//      `dados = {"turno":"A"}` (comportamento CORRETO da RPC, que grava o
//      parametro do turno que concluiu), o que apaga dentista_id/
//      procedimento_id -- entao o cenario 2 recusava por `dentista_divergente`
//      e nunca chegava ao advisory lock.
//
// ── DOIS CENARIOS, DOIS MECANISMOS ──────────────────────────────────────
//   1. MESMA CONVERSA -- dois turnos do mesmo paciente, MESMA
//      `versao_inicial`. Separados pelo `FOR UPDATE` da conversa. Criterio da
//      spec v2 secao 14.9: EXATAMENTE UMA linha nova.
//   2. CONVERSAS DIFERENTES, MESMO INTERVALO -- dois pacientes, versoes
//      proprias e validas, disputando o mesmo dentista/horario. O lock da
//      conversa NAO os separa: quem decide e o advisory lock por (clinica,
//      dentista, dia) + conflito por tsrange. Um cria, o outro recebe
//      `horario_ocupado`.
//
// Sem o cenario 2, o advisory lock -- unico mecanismo novo em relacao ao
// cancelamento -- ficaria sem prova.
//
// ── BARREIRA OBJETIVA, NUNCA sleep ──────────────────────────────────────
// Exige SIMULTANEAMENTE `wait_event_type='Lock'` em B e
// `pg_blocking_pids(pid_B)` contendo `pid_A`. Vale para os dois cenarios: no
// 1 o bloqueio e na linha de estado_conversa, no 2 e no advisory lock -- a
// tecnica de deteccao e a mesma. Timeout => INCONCLUSIVO, nunca aprovacao.
//
// ── PRECISAO DA VERSAO ──────────────────────────────────────────────────
// `atualizado_em` trafega como `::text`. `pg` mapeia timestamptz para `Date`
// (milissegundos) e a RPC calcula `versao + 1 microsegundo` -- por Date o
// microssegundo some e o CAS estrito reprova. Mesma correcao ja provada no
// A×B do cancelamento (identidade-conexao.test.mjs).
//
// ── SEM ROLLBACK: LIMPEZA EXPLICITA ─────────────────────────────────────
// A precisa commitar (B so observa depois). Limpeza por marcador, terceira
// conexao, `finally`, com verificacao de zero residuos e comandos manuais
// impressos se algo sobrar.
//
// ── CREDENCIAL ──────────────────────────────────────────────────────────
// So `process.env.DATABASE_URL`, populada por `node --env-file` a partir do
// cofre. Nunca impressa, logada ou persistida. A identidade do projeto e
// validada por hostname/username (identidade-conexao.mjs), nunca por
// `includes` sobre a URL.
//
// ── COMANDO (NAO EXECUTAR AINDA) ────────────────────────────────────────
//   cd C:\Users\Gabriel\cappia-iris-core\src
//   node --env-file="C:\Users\Gabriel\.iris-secrets\<arquivo>.env" \
//     supabase/tests/executar-teste-axb-commit-v2-criar.mjs --aplicar

import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { refsDaConexao } from './identidade-conexao.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SQL_COLUNA = join(AQUI, '..', 'migrations', '20260815120000_iris_nova_aguardando_resposta.sql');
const SQL_RPC = join(AQUI, '..', 'migrations', '20260815122000_iris_nova_commit_turno_v2_criar.sql');
const SQL_FIXTURES = join(AQUI, '20260815122000_iris_nova_commit_turno_v2_criar_axb_fixtures.sql');

const PROJETO_AUTORIZADO = 'bcmuqautblvjdqzhjfbw';
const PROJETO_PROIBIDO = 'udizowyfjnhuhgxkeayk';

const STATEMENT_TIMEOUT_MS = 15000;
// lock_timeout de B e alto DE PROPOSITO: B precisa ESPERAR A. Um valor baixo
// faria B falhar por timeout em vez de observar o desfecho sob teste --
// mascararia o comportamento como erro de infraestrutura.
const LOCK_TIMEOUT_B_MS = 30000;
const LOCK_TIMEOUT_PADRAO_MS = 5000;
const BARREIRA_TIMEOUT_MS = 10000;
const BARREIRA_INTERVALO_MS = 100;

const aplicarDDL = process.argv.includes('--aplicar');
const marcador = randomUUID();
const dentistaId = randomUUID();

function log(m) { console.log(m); }
function abortar(m) { console.error(`\nABORTADO: ${m}\n`); process.exit(1); }

const url = process.env.DATABASE_URL;
if (!url) abortar('DATABASE_URL ausente. Carregue o .env do cofre com --env-file.');

const identidade = refsDaConexao(url);
if (!identidade.ok) abortar(identidade.erro);
if (identidade.refs.includes(PROJETO_PROIBIDO)) {
  abortar(`a DATABASE_URL aponta para o projeto OPERACIONAL (${PROJETO_PROIBIDO}). Este teste executa efeito real e commit. Recusado.`);
}
if (!identidade.refs.every((r) => r === PROJETO_AUTORIZADO)) {
  abortar(`a DATABASE_URL nao aponta para o projeto autorizado (${PROJETO_AUTORIZADO}). Identificado: ${identidade.refs.join(', ')}.`);
}

async function conectar(nome, lockTimeoutMs) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(`set statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
  await c.query(`set lock_timeout = ${lockTimeoutMs}`);
  const { rows } = await c.query('select pg_backend_pid() as pid');
  log(`  ${nome}: conectada (pid ${rows[0].pid})`);
  return { cliente: c, pid: rows[0].pid };
}

// Nao basta B esperar ALGUM lock: A precisa ser quem o bloqueia.
async function esperarBloqueadoPor(obs, pidA, pidB, rotulo) {
  const limite = Date.now() + BARREIRA_TIMEOUT_MS;
  while (Date.now() < limite) {
    const { rows } = await obs.query(
      `select wait_event_type, pg_blocking_pids(pid) as bloqueadores
         from pg_stat_activity where pid = $1`, [pidB]);
    if (rows.length > 0) {
      const { wait_event_type, bloqueadores } = rows[0];
      if (wait_event_type === 'Lock' && (bloqueadores ?? []).includes(pidA)) {
        log(`  BARREIRA OK (${rotulo}): B(${pidB}) em 'Lock', bloqueado por A(${pidA}).`);
        return true;
      }
    }
    await new Promise((r) => setTimeout(r, BARREIRA_INTERVALO_MS));
  }
  return false;
}

const cn = {};
let falhou = false;
let inconclusivo = false;
let colunaCriada = false;
let funcaoCriada = false;

const CHAMADA = `select cappia_commit_turno_v2_criar($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r`;

try {
  log(`\nProjeto ${PROJETO_AUTORIZADO} | marcador: ${marcador}\n`);

  cn.obs = await conectar('OBSERVADOR', LOCK_TIMEOUT_PADRAO_MS);
  cn.a = await conectar('SESSAO A', LOCK_TIMEOUT_PADRAO_MS);
  cn.b = await conectar('SESSAO B', LOCK_TIMEOUT_B_MS);

  if (aplicarDDL) {
    // PREFLIGHT ESTRITO: sob --aplicar os dois objetos precisam estar
    // AUSENTES. Objeto preexistente nao e desta execucao e nao pode ser
    // removido por ela.
    const pre = (await cn.obs.cliente.query(
      `select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='cappia_commit_turno_v2_criar')::int f,
              (select count(*) from information_schema.columns
                where table_schema='public' and table_name='estado_conversa'
                  and column_name='aguardando_resposta')::int col`)).rows[0];
    if (pre.f > 0 || pre.col > 0) {
      abortar(`--aplicar exige funcao e coluna AUSENTES, mas ja existem (funcao=${pre.f}, coluna=${pre.col}). ` +
        'Remova-os deliberadamente (rollbacks/) ou rode sem --aplicar.');
    }
    log('\nAplicando DDL temporario...');
    await cn.obs.cliente.query(await readFile(SQL_COLUNA, 'utf8'));
    colunaCriada = true;
    await cn.obs.cliente.query(await readFile(SQL_RPC, 'utf8'));
    funcaoCriada = true;
    log('  OK: coluna e funcao criadas POR ESTA EXECUCAO.');
  } else {
    const { rows } = await cn.obs.cliente.query(
      `select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='cappia_commit_turno_v2_criar'`);
    if (rows[0].n === 0) abortar('a funcao nao existe. Rode com --aplicar.');
  }

  // ── FIXTURES (commitadas: as duas sessoes precisam ve-las) ────────────
  log('\nCriando fixtures sinteticas...');
  const dataAlvo = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await cn.obs.cliente.query('begin');
  for (const stmt of (await readFile(SQL_FIXTURES, 'utf8')).split(/;\s*$/m)) {
    const corpo = stmt.replace(/--.*$/gm, '').trim();
    if (!corpo) continue;
    // Os statements usam QUANTIDADES DIFERENTES de parametros ($1 so, ou
    // $1+$2, ou os tres). O protocolo estendido do Postgres exige que o
    // numero enviado bata EXATAMENTE com o que o statement declara, entao
    // mandar sempre os tres falha em quem usa menos. Envia-se apenas ate o
    // maior indice que cada statement de fato referencia.
    const maior = Math.max(0, ...[...corpo.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    await cn.obs.cliente.query(corpo, [marcador, dentistaId, dataAlvo].slice(0, maior));
  }
  await cn.obs.cliente.query('commit');

  const ctxs = (await cn.obs.cliente.query(
    `select e.id conversa, e.clinica_id, e.paciente_id, e.telefone_normalizado tel,
            e.atualizado_em::text versao, p.nome
       from estado_conversa e
       join clinicas c on c.id = e.clinica_id
       join pacientes p on p.id = e.paciente_id
      where c.instancia_whatsapp = 'teste-axb-criar-clinica-' || $1
      order by e.telefone_normalizado`, [marcador])).rows;
  if (ctxs.length !== 2) throw new Error(`esperado 2 conversas, veio ${ctxs.length}`);
  const [um, dois] = ctxs;
  const proc = `teste-axb-criar-${marcador}`;
  log(`  OK: 2 conversas (${um.conversa}, ${dois.conversa}), dentista ${dentistaId}`);

  const args = (c, doc, turno, versao) =>
    [c.clinica_id, c.paciente_id, c.conversa, c.tel, versao ?? c.versao, dataAlvo, '10:00',
     dentistaId, proc, c.nome, doc, { turno }];

  const falhas = [];
  const ok = (cond, m) => cond ? log(`  OK: ${m}`) : falhas.push(m);

  // ══ CENARIO 1: MESMA CONVERSA, MESMA versao_inicial ══════════════════
  log('\n── CENARIO 1: mesma conversa, mesma versao_inicial ──');
  log('A: BEGIN e chamada (segura o FOR UPDATE da conversa)...');
  await cn.a.cliente.query('begin');
  const rA1 = (await cn.a.cliente.query(CHAMADA, args(um, '12345678901', 'A'))).rows[0].r;
  log(`  A retornou: ${JSON.stringify(rA1)}`);

  log('B: mesma conversa, MESMA versao_inicial (deve bloquear)...');
  await cn.b.cliente.query('begin');
  const promB1 = cn.b.cliente.query(CHAMADA, args(um, '12345678901', 'B'));
  let erroB1 = null;
  promB1.catch((e) => { erroB1 = e; });

  if (!await esperarBloqueadoPor(cn.obs.cliente, cn.a.pid, cn.b.pid, 'conversa')) {
    inconclusivo = true;
    throw new Error('BARREIRA NAO CONFIRMADA (cenario 1): B nao apareceu bloqueado por A. INCONCLUSIVO.');
  }

  log('A: COMMIT...');
  await cn.a.cliente.query('commit');
  const respB1 = await promB1.catch(() => null);
  if (erroB1) throw new Error(`B falhou inesperadamente: ${erroB1.message}`);
  const rB1 = respB1?.rows?.[0]?.r ?? null;
  log(`  B desbloqueou e retornou: ${JSON.stringify(rB1)}`);
  await cn.b.cliente.query('rollback');

  ok(rA1?.resultado === 'executado', 'cenario 1: A executou');
  ok(rB1?.resultado === 'turno_obsoleto' && rB1?.motivo === 'versao_divergente',
     'cenario 1: B recebeu turno_obsoleto/versao_divergente');

  const n1 = (await cn.obs.cliente.query(
    `select count(*)::int n from agendamentos a join clinicas c on c.id = a.clinica_id
      where c.instancia_whatsapp = 'teste-axb-criar-clinica-' || $1`, [marcador])).rows[0].n;
  // O criterio da spec 14.9: nao duas, nao zero.
  ok(n1 === 1, `cenario 1: EXATAMENTE 1 agendamento criado (veio ${n1})`);

  const est1 = (await cn.obs.cliente.query(
    `select aguardando_resposta, contexto_horarios, dados ->> 'turno' turno
       from estado_conversa where id = $1`, [um.conversa])).rows[0];
  ok(est1.turno === 'A', `cenario 1: UMA gravacao de estado -- dados.turno = 'A' (veio '${est1.turno}')`);
  ok(est1.aguardando_resposta === null && est1.contexto_horarios === null,
     'cenario 1: aguardando_resposta e contexto_horarios zerados por A');

  // ══ CENARIO 2: CONVERSAS DIFERENTES, MESMO INTERVALO ═════════════════
  // Aqui o lock da conversa NAO separa (linhas diferentes). Quem decide e o
  // advisory lock por (clinica, dentista, dia) + conflito por tsrange.
  log('\n── CENARIO 2: conversas diferentes disputando o mesmo intervalo ──');

  // O agendamento do cenario 1 ocupa o horario -- removo para que os dois
  // lados do cenario 2 partam de horario LIVRE, senao ambos recusariam por
  // conflito e o advisory lock nao seria exercitado.
  await cn.obs.cliente.query(
    `delete from agendamentos a using clinicas c
      where a.clinica_id = c.id and c.instancia_whatsapp = 'teste-axb-criar-clinica-' || $1`, [marcador]);
  // Reautoriza a conversa 1 (a autorizacao foi consumida) e recarrega as duas
  // versoes, agora vigentes e proprias de cada conversa.
  // `dados` TAMBEM precisa ser restaurado: no cenario 1 a RPC gravou
  // `dados = {"turno":"A"}` (comportamento correto -- e o parametro do turno
  // que concluiu), o que apagou `dentista_id`/`procedimento_id`. Sem
  // recoloca-los, o passo 3 recusa com `dentista_divergente` e o cenario 2
  // nem chega ao advisory lock -- foi exatamente o que aconteceu na primeira
  // tentativa.
  await cn.obs.cliente.query(
    `update estado_conversa
        set aguardando_resposta = jsonb_build_object('tipo','confirmacao','operacao','criar'),
            dados = jsonb_build_object('dentista_id', $3::text, 'procedimento_id', $4::text),
            contexto_horarios = jsonb_build_object('proposta_pendente',
              jsonb_build_object('data', $2::text, 'horario', '10:00'))
      where id = $1`, [um.conversa, dataAlvo, dentistaId, proc]);

  const vs = (await cn.obs.cliente.query(
    `select id, atualizado_em::text v from estado_conversa where id in ($1,$2)`,
    [um.conversa, dois.conversa])).rows;
  const vUm = vs.find((x) => x.id === um.conversa).v;
  const vDois = vs.find((x) => x.id === dois.conversa).v;

  log('A: conversa 1, BEGIN e chamada (segura o advisory lock do dia)...');
  await cn.a.cliente.query('begin');
  const rA2 = (await cn.a.cliente.query(CHAMADA, args(um, '12345678901', 'A2', vUm))).rows[0].r;
  log(`  A retornou: ${JSON.stringify(rA2)}`);

  log('B: conversa 2 (OUTRO paciente), mesmo dentista e horario (deve bloquear no advisory)...');
  await cn.b.cliente.query('begin');
  const promB2 = cn.b.cliente.query(CHAMADA, args(dois, '12345678902', 'B2', vDois));
  let erroB2 = null;
  promB2.catch((e) => { erroB2 = e; });

  if (!await esperarBloqueadoPor(cn.obs.cliente, cn.a.pid, cn.b.pid, 'advisory')) {
    inconclusivo = true;
    throw new Error('BARREIRA NAO CONFIRMADA (cenario 2): B nao apareceu bloqueado por A no advisory lock. INCONCLUSIVO.');
  }

  log('A: COMMIT...');
  await cn.a.cliente.query('commit');
  const respB2 = await promB2.catch(() => null);
  if (erroB2) throw new Error(`B falhou inesperadamente (cenario 2): ${erroB2.message}`);
  const rB2 = respB2?.rows?.[0]?.r ?? null;
  log(`  B desbloqueou e retornou: ${JSON.stringify(rB2)}`);
  await cn.b.cliente.query('rollback');

  ok(rA2?.resultado === 'executado', 'cenario 2: A criou');
  // B tinha versao PROPRIA e valida: nao e turno obsoleto. E o advisory lock
  // + tsrange que o barram, com horario_ocupado.
  ok(rB2?.resultado === 'recusado' && rB2?.motivo === 'horario_ocupado',
     `cenario 2: B recebeu recusado/horario_ocupado (veio ${JSON.stringify(rB2)})`);

  const n2 = (await cn.obs.cliente.query(
    `select count(*)::int n from agendamentos a join clinicas c on c.id = a.clinica_id
      where c.instancia_whatsapp = 'teste-axb-criar-clinica-' || $1`, [marcador])).rows[0].n;
  ok(n2 === 1, `cenario 2: EXATAMENTE 1 agendamento no intervalo disputado (veio ${n2})`);

  const est2 = (await cn.obs.cliente.query(
    `select aguardando_resposta from estado_conversa where id = $1`, [dois.conversa])).rows[0];
  // B recusou: recusa NAO escreve. A autorizacao dele continua pendente.
  ok(est2.aguardando_resposta !== null,
     'cenario 2: a recusa de B nao gravou estado (autorizacao dele segue pendente)');

  if (falhas.length > 0) {
    falhou = true;
    console.error('\nRESULTADO: FALHOU');
    for (const f of falhas) console.error(`  FALHA: ${f}`);
  } else {
    log('\nRESULTADO: todas as assertivas passaram.');
  }
} catch (erro) {
  falhou = true;
  console.error(inconclusivo ? '\nRESULTADO: INCONCLUSIVO' : '\nRESULTADO: ERRO');
  console.error(`  ${erro.message}`);
} finally {
  // ── 1. FECHAR A E B ANTES DA LIMPEZA (senao mantem locks) ─────────────
  log('\nEncerrando A e B antes da limpeza...');
  for (const [nome, c] of [['A', cn.a], ['B', cn.b]]) {
    if (!c) continue;
    try { await c.cliente.query('rollback'); } catch { /* ja abortada/commitada */ }
    try { await c.cliente.end(); } catch { /* ignora */ }
    log(`  ${nome} encerrada.`);
  }

  // ── 2. LIMPEZA EM TERCEIRA CONEXAO, SEMPRE ────────────────────────────
  let limpezaOk = false;
  const limp = new pg.Client({ connectionString: url });
  try {
    await limp.connect();
    await limp.query(`set statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await limp.query(`set lock_timeout = ${LOCK_TIMEOUT_PADRAO_MS}`);
    log('Limpando dados sinteticos (terceira conexao)...');

    const alvo = `(select id from clinicas where instancia_whatsapp = 'teste-axb-criar-clinica-' || $1)`;
    await limp.query(`delete from agendamentos where clinica_id in ${alvo}`, [marcador]);
    await limp.query(`delete from estado_conversa where clinica_id in ${alvo}`, [marcador]);
    await limp.query(`delete from pacientes where clinica_id in ${alvo}`, [marcador]);
    await limp.query(`delete from clinicas where instancia_whatsapp = 'teste-axb-criar-clinica-' || $1`, [marcador]);
    // Catalogo e global: apagar pelo id marcado.
    await limp.query(`delete from procedimentos_catalogo where id = 'teste-axb-criar-' || $1`, [marcador]);

    // ── 3. DDL: so o que ESTA execucao criou, funcao antes da coluna ────
    if (funcaoCriada) {
      log('Removendo a funcao criada por esta execucao...');
      await limp.query('drop function if exists public.cappia_commit_turno_v2_criar(uuid, uuid, uuid, text, timestamptz, date, text, uuid, text, text, text, jsonb)');
    }
    if (colunaCriada) {
      log('Removendo a coluna criada por esta execucao...');
      await limp.query('alter table estado_conversa drop column if exists aguardando_resposta');
    }

    // ── 4. VERIFICAR ZERO RESIDUOS ──────────────────────────────────────
    const r = (await limp.query(
      `select (select count(*) from clinicas where instancia_whatsapp = 'teste-axb-criar-clinica-' || $1)::int c,
              (select count(*) from procedimentos_catalogo where id = 'teste-axb-criar-' || $1)::int p,
              (select count(*) from pg_proc pr join pg_namespace n on n.oid=pr.pronamespace
                where n.nspname='public' and pr.proname='cappia_commit_turno_v2_criar')::int f,
              (select count(*) from information_schema.columns
                where table_schema='public' and table_name='estado_conversa'
                  and column_name='aguardando_resposta')::int col`, [marcador])).rows[0];

    const residuoDDL = (funcaoCriada && r.f > 0) || (colunaCriada && r.col > 0);
    if (r.c === 0 && r.p === 0 && !residuoDDL) {
      limpezaOk = true;
      log(`  OK: zero residuos (clinicas=${r.c}, catalogo=${r.p}, funcao=${r.f}, coluna=${r.col}).`);
    } else {
      console.error(`  RESIDUO: clinicas=${r.c}, catalogo=${r.p}, funcao=${r.f}, coluna=${r.col}`);
    }
  } catch (e) {
    console.error(`  LIMPEZA FALHOU: ${e.message}`);
  } finally {
    await limp.end().catch(() => {});
    try { if (cn.obs) await cn.obs.cliente.end(); } catch { /* ignora */ }
  }

  if (!limpezaOk) {
    falhou = true;
    console.error(`\n!! LIMPEZA MANUAL NECESSARIA -- marcador ${marcador}:`);
    console.error(`   delete from agendamentos where clinica_id in (select id from clinicas where instancia_whatsapp = 'teste-axb-criar-clinica-${marcador}');`);
    console.error(`   delete from estado_conversa where clinica_id in (select id from clinicas where instancia_whatsapp = 'teste-axb-criar-clinica-${marcador}');`);
    console.error(`   delete from pacientes where clinica_id in (select id from clinicas where instancia_whatsapp = 'teste-axb-criar-clinica-${marcador}');`);
    console.error(`   delete from clinicas where instancia_whatsapp = 'teste-axb-criar-clinica-${marcador}';`);
    console.error(`   delete from procedimentos_catalogo where id = 'teste-axb-criar-${marcador}';`);
    if (funcaoCriada) console.error(`   drop function if exists public.cappia_commit_turno_v2_criar(uuid, uuid, uuid, text, timestamptz, date, text, uuid, text, text, text, jsonb);`);
    if (colunaCriada) console.error(`   alter table estado_conversa drop column if exists aguardando_resposta;`);
  }
  log('Conexoes encerradas.');
}

process.exit(falhou ? 1 : 0);
