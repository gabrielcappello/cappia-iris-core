// Runner do teste CONCORRENTE A×B de
// 20260815121000_iris_nova_commit_turno_v2_cancelar.sql
//
// Projeto-alvo: cappia-iris-core-dev (bcmuqautblvjdqzhjfbw).
//
// STATUS: EXECUTADO E APROVADO em 2026-08-15, no projeto dev
// bcmuqautblvjdqzhjfbw -- e REEXECUTADO sobre a versao corrigida da RPC (com
// `estado_conversa.paciente_id = p_paciente_id` no passo 1), confirmando que
// o predicado novo NAO alterou a concorrencia. Passou integralmente nas duas
// rodadas. Provou, sob concorrencia REAL:
//   - A venceu o lock e executou;
//   - B esperou (barreira confirmada por wait_event_type='Lock' E
//     pg_blocking_pids(pid_B) contendo pid_A -- nunca por sleep);
//   - apos o COMMIT de A, B leu a versao avancada e retornou
//     turno_obsoleto/versao_divergente;
//   - UM UNICO efeito e UMA UNICA gravacao de estado (`dados.turno` = 'A');
//   - nenhum retry deixou B executar: repetindo a mesma versao_inicial,
//     turno_obsoleto; relendo a versao nova, recusado por
//     confirmacao_ausente (a autorizacao foi consumida por A);
//   - limpeza completa, zero residuos. Producao intocada.
//
// DOIS DEFEITOS DO PROPRIO TESTE, corrigidos antes da execucao valida (a RPC
// nao foi alterada em nenhum dos dois):
//   1. telefone da fixture derivado do marcador (uuid tem a-f) violava o
//      CHECK `^[0-9]+$` -- agora e constante e so com digitos;
//   2. PERDA DE PRECISAO NO TRANSPORTE DA VERSAO: `pg` mapeia timestamptz
//      para `Date`, que so guarda MILISSEGUNDOS, enquanto a RPC calcula
//      `versao + 1 microsegundo`. O round-trip truncava a 6a casa e o CAS
//      por igualdade estrita reprovava -- a primeira chamada de A ja voltava
//      turno_obsoleto sem nada ter mudado. Corrigido lendo `atualizado_em`
//      como `::text` e comparando o avanco no proprio SQL. Coberto por
//      teste local em identidade-conexao.test.mjs.
//
// Nao aplica migration por conta propria -- ver "PRE-REQUISITO" abaixo.
//
// ── O QUE ESTE TESTE PROVA ──────────────────────────────────────────────
// Que o `SELECT ... FOR UPDATE` do passo 1 da RPC impede DUPLA EXECUCAO sob
// concorrencia real: duas sessoes, mesma conversa, MESMA `versao_inicial`,
// autorizacoes ambas VALIDAS e identicas. So o lock decide. E a razao de a
// funcao existir, e sessao unica nao alcanca.
//
// ── POR QUE A PRECISA COMMITAR (e por que nao ha rollback protegendo) ───
// B so observa a versao avancada DEPOIS do commit de A. Com rollback em A,
// B acordaria, leria `atualizado_em` inalterado, o CAS conferiria e B
// EXECUTARIA -- provando o oposto do que se quer provar. Entao A commita
// efeito real, e a limpeza passa a ser responsabilidade EXPLICITA deste
// runner (DELETE por marcador, terceira conexao, `finally`).
//
// ── PRE-REQUISITO: A MIGRATION PRECISA ESTAR APLICADA ───────────────────
// DDL dentro de transacao nao e visivel a outra sessao, entao a funcao e a
// coluna precisam existir DE FATO no banco antes deste teste. O runner
// aplica os dois no inicio (`--aplicar`) e os REMOVE no fim, na ordem
// inversa -- mas so quando invocado com essa flag explicita, nunca por
// padrao. Sem a flag, exige que ja existam e nao remove nada.
//
// ── CREDENCIAL ──────────────────────────────────────────────────────────
// Lida EXCLUSIVAMENTE de process.env.DATABASE_URL, populada por
// `node --env-file=<arquivo do cofre .iris-secrets>`. Este runner:
//   - NUNCA imprime, loga ou persiste a URL (ela carrega a senha);
//   - NUNCA cria, deriva ou adivinha credencial;
//   - NUNCA abre nada dentro de .iris-secrets por conta propria -- quem
//     carrega e o `--env-file` do Node, e o valor so existe em memoria.
// O unico dado da conexao que aparece em log e o REF DO PROJETO, comparado
// com a allowlist abaixo.
//
// ── COMANDO (NAO EXECUTAR AINDA) ────────────────────────────────────────
//   cd C:\Users\Gabriel\cappia-iris-core\src
//   node --env-file="C:\Users\Gabriel\.iris-secrets\<arquivo>.env" \
//     supabase/tests/executar-teste-axb-commit-v2-cancelar.mjs --aplicar

import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { refsDaConexao } from './identidade-conexao.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SQL_COLUNA = join(AQUI, '..', 'migrations', '20260815120000_iris_nova_aguardando_resposta.sql');
const SQL_RPC = join(AQUI, '..', 'migrations', '20260815121000_iris_nova_commit_turno_v2_cancelar.sql');
const SQL_FIXTURES = join(AQUI, '20260815121000_iris_nova_commit_turno_v2_cancelar_axb_fixtures.sql');

// ── SALVAGUARDAS ────────────────────────────────────────────────────────
const PROJETO_AUTORIZADO = 'bcmuqautblvjdqzhjfbw';
// Nunca pode ser alvo. Verificado explicitamente, alem da allowlist acima.
const PROJETO_PROIBIDO = 'udizowyfjnhuhgxkeayk';

// Timeouts: nenhuma sessao pode ficar presa indefinidamente.
const STATEMENT_TIMEOUT_MS = 15000;
// lock_timeout de B e DELIBERADAMENTE alto: B PRECISA esperar A. Um valor
// baixo faria B falhar por timeout em vez de observar a versao avancada --
// mascararia o comportamento sob teste como erro de infraestrutura.
const LOCK_TIMEOUT_B_MS = 30000;
const LOCK_TIMEOUT_PADRAO_MS = 5000;
// Barreira: se B nao aparecer bloqueado POR A dentro disso, o cenario nao se
// formou e o teste e INCONCLUSIVO (nunca "passou").
const BARREIRA_TIMEOUT_MS = 10000;
const BARREIRA_INTERVALO_MS = 100;

const aplicarDDL = process.argv.includes('--aplicar');
const marcador = randomUUID();

function log(m) { console.log(m); }
function abortar(m) { console.error(`\nABORTADO: ${m}\n`); process.exit(1); }

const url = process.env.DATABASE_URL;
if (!url) abortar('DATABASE_URL ausente. Carregue o .env do cofre com --env-file.');

// ── VALIDACAO ESTRUTURAL, NUNCA `includes` ──────────────────────────────
// A logica vive em ./identidade-conexao.mjs, pura e testada localmente
// (identidade-conexao.test.mjs) sem banco nem credencial. Formas conhecidas:
//   direta:  postgresql://postgres@db.<ref>.supabase.co:5432/postgres
//   pooler:  postgresql://postgres.<ref>@aws-0-<regiao>.pooler.supabase.com:6543/postgres
const identidade = refsDaConexao(url);
if (!identidade.ok) abortar(identidade.erro);
const refs = identidade.refs;
if (refs.includes(PROJETO_PROIBIDO)) {
  abortar(`a DATABASE_URL aponta para o projeto OPERACIONAL (${PROJETO_PROIBIDO}). Este teste executa efeito real e commit. Recusado.`);
}
if (!refs.every((r) => r === PROJETO_AUTORIZADO)) {
  abortar(`a DATABASE_URL nao aponta para o projeto autorizado (${PROJETO_AUTORIZADO}). Identificado: ${refs.join(', ')}.`);
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

// ── BARREIRA OBJETIVA (correcao do Codex) ───────────────────────────────
// Nao basta B estar esperando ALGUM lock: e preciso que A seja quem o
// bloqueia. `pg_blocking_pids(pid_B)` contendo `pid_A` prova o vinculo --
// sem isso, um lock incidental passaria por confirmacao do cenario.
// As duas condicoes sao exigidas SIMULTANEAMENTE.
async function esperarBBloqueadoPorA(obs, pidA, pidB) {
  const limite = Date.now() + BARREIRA_TIMEOUT_MS;
  while (Date.now() < limite) {
    const { rows } = await obs.query(
      `select wait_event_type, pg_blocking_pids(pid) as bloqueadores
         from pg_stat_activity where pid = $1`,
      [pidB]
    );
    if (rows.length > 0) {
      const { wait_event_type, bloqueadores } = rows[0];
      if (wait_event_type === 'Lock' && (bloqueadores ?? []).includes(pidA)) {
        log(`  BARREIRA OK: B(${pidB}) em wait_event_type='Lock', bloqueado por A(${pidA}).`);
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
// Marcam o que ESTA execucao criou. A limpeza remove -- e sugere remover a
// mao -- SOMENTE objetos com a flag ligada. Ficam separadas de `aplicarDDL`
// de proposito: se o CREATE da funcao falhar depois de a coluna ter sido
// criada, apenas a coluna deve ser removida.
let colunaCriada = false;
let funcaoCriada = false;
const resultados = {};

try {
  log(`\nProjeto ${PROJETO_AUTORIZADO} | marcador da execucao: ${marcador}\n`);

  cn.obs = await conectar('OBSERVADOR', LOCK_TIMEOUT_PADRAO_MS);
  cn.a = await conectar('SESSAO A', LOCK_TIMEOUT_PADRAO_MS);
  cn.b = await conectar('SESSAO B', LOCK_TIMEOUT_B_MS);

  // ── DDL, se autorizado ────────────────────────────────────────────────
  if (aplicarDDL) {
    // PREFLIGHT ESTRITO: sob --aplicar, os dois objetos precisam estar
    // AUSENTES. Se algum ja existir, ele NAO e desta execucao -- e a limpeza
    // final removeria um objeto preexistente, que pode estar em uso. Aborta
    // antes de criar ou tocar qualquer coisa.
    const pre = (await cn.obs.cliente.query(
      `select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname='public' and p.proname='cappia_commit_turno_v2_cancelar')::int f,
              (select count(*) from information_schema.columns
                where table_schema='public' and table_name='estado_conversa'
                  and column_name='aguardando_resposta')::int col`)).rows[0];
    if (pre.f > 0 || pre.col > 0) {
      abortar(
        `--aplicar exige funcao e coluna AUSENTES, mas ja existem (funcao=${pre.f}, coluna=${pre.col}). ` +
          'Objetos preexistentes nao sao desta execucao e nao podem ser removidos por ela. ' +
          'Remova-os deliberadamente (rollbacks/) ou rode sem --aplicar.'
      );
    }

    log('\nAplicando DDL temporario (coluna + RPC)...');
    // `add column` sem `if not exists`: o preflight ja provou a ausencia, e
    // a forma estrita falha alto se algo mudou nesse intervalo.
    await cn.obs.cliente.query(await readFile(SQL_COLUNA, 'utf8'));
    colunaCriada = true;
    await cn.obs.cliente.query(await readFile(SQL_RPC, 'utf8'));
    funcaoCriada = true;
    log('  OK: coluna e funcao criadas POR ESTA EXECUCAO (serao removidas no final).');
  } else {
    const { rows } = await cn.obs.cliente.query(
      `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'cappia_commit_turno_v2_cancelar'`);
    if (rows[0].n === 0) abortar('a funcao nao existe no banco. Rode com --aplicar, ou aplique a migration antes.');
  }

  // ── FIXTURES (commitadas: as duas sessoes precisam ve-las) ────────────
  log('\nCriando fixtures sinteticas...');
  await cn.obs.cliente.query('begin');
  for (const stmt of (await readFile(SQL_FIXTURES, 'utf8')).split(/;\s*$/m)) {
    if (stmt.replace(/--.*$/gm, '').trim()) await cn.obs.cliente.query(stmt, [marcador]);
  }
  await cn.obs.cliente.query('commit');

  // ── A VERSAO TRAFEGA COMO TEXTO, NUNCA COMO Date ──────────────────────
  // `pg` mapeia timestamptz para `Date`, que so tem precisao de
  // MILISSEGUNDOS. A RPC calcula `greatest(now(), versao + 1 microsegundo)`,
  // entao o microssegundo e truncado no round-trip e o CAS por igualdade
  // estrita falha -- a primeira chamada de A ja voltava turno_obsoleto.
  // Lendo `::text`, o valor vai e volta com a precisao integral do Postgres,
  // e o parametro `timestamptz` da funcao faz o cast de volta sem perda.
  const ctx = (await cn.obs.cliente.query(
    `select e.id conversa, e.clinica_id, e.paciente_id, e.telefone_normalizado tel,
            e.atualizado_em::text versao, a.id agendamento
       from estado_conversa e
       join clinicas c on c.id = e.clinica_id
       join agendamentos a on a.clinica_id = c.id
      where c.instancia_whatsapp = 'teste-axb-clinica-' || $1`, [marcador])).rows[0];
  if (!ctx) throw new Error('fixtures nao criadas');
  log(`  OK: conversa ${ctx.conversa}, agendamento ${ctx.agendamento}`);
  // Sem toISOString(): `ctx.versao` ja e a string exata do Postgres.
  log(`  versao_inicial COMPARTILHADA (texto): ${ctx.versao}`);

  const args = [ctx.clinica_id, ctx.paciente_id, ctx.conversa, ctx.tel, ctx.versao, ctx.agendamento];
  const CHAMADA = 'select cappia_commit_turno_v2_cancelar($1,$2,$3,$4,$5,$6,$7) as r';

  // ── A: abre, chama, NAO commita ───────────────────────────────────────
  log('\nA: BEGIN e chamada (segura o FOR UPDATE, sem commit)...');
  await cn.a.cliente.query('begin');
  resultados.a = (await cn.a.cliente.query(CHAMADA, [...args, { turno: 'A' }])).rows[0].r;
  log(`  A retornou: ${JSON.stringify(resultados.a)}`);

  // ── B: mesma versao_inicial, dispara SEM aguardar (vai bloquear) ──────
  log('\nB: BEGIN e chamada com a MESMA versao_inicial (deve bloquear)...');
  await cn.b.cliente.query('begin');
  const promessaB = cn.b.cliente.query(CHAMADA, [...args, { turno: 'B' }]);
  let erroB = null;
  promessaB.catch((e) => { erroB = e; });

  // ── BARREIRA ──────────────────────────────────────────────────────────
  if (!await esperarBBloqueadoPorA(cn.obs.cliente, cn.a.pid, cn.b.pid)) {
    inconclusivo = true;
    throw new Error(
      'BARREIRA NAO CONFIRMADA: B nao apareceu bloqueado por A dentro do limite. ' +
      'O cenario de concorrencia nao se formou -- resultado INCONCLUSIVO, nunca aprovacao.');
  }

  // ── A commita: e aqui que B passa a enxergar a versao avancada ────────
  log('\nA: COMMIT (efeito real persistido)...');
  await cn.a.cliente.query('commit');

  const respostaB = await promessaB.catch(() => null);
  if (erroB) throw new Error(`B falhou inesperadamente: ${erroB.message}`);
  resultados.b = respostaB?.rows?.[0]?.r ?? null;
  log(`  B desbloqueou e retornou: ${JSON.stringify(resultados.b)}`);

  // ── RETRY de B: nem repetindo, nem relendo, B executa ─────────────────
  log('\nB: retry com a MESMA versao_inicial...');
  resultados.bRetry = (await cn.b.cliente.query(CHAMADA, [...args, { turno: 'B-retry' }])).rows[0].r;
  log(`  B retry: ${JSON.stringify(resultados.bRetry)}`);

  // Releitura tambem em `::text`, pelo mesmo motivo da leitura inicial.
  const versaoNova = (await cn.obs.cliente.query(
    'select atualizado_em::text from estado_conversa where id = $1', [ctx.conversa])).rows[0].atualizado_em;
  log('B: retry RELENDO a versao nova (autorizacao ja foi consumida por A)...');
  resultados.bRelendo = (await cn.b.cliente.query(
    CHAMADA, [ctx.clinica_id, ctx.paciente_id, ctx.conversa, ctx.tel, versaoNova, ctx.agendamento,
              { turno: 'B-relendo' }])).rows[0].r;
  log(`  B relendo: ${JSON.stringify(resultados.bRelendo)}`);
  await cn.b.cliente.query('rollback');

  // ── ASSERTIVAS (terceira conexao) ─────────────────────────────────────
  log('\n── ASSERTIVAS ──');
  const falhas = [];
  const ok = (c, m) => c ? log(`  OK: ${m}`) : falhas.push(m);

  ok(resultados.a?.resultado === 'executado' && resultados.a?.status === 'cancelado',
     'A venceu o lock e executou');
  ok(resultados.b?.resultado === 'turno_obsoleto' && resultados.b?.motivo === 'versao_divergente',
     'B leu a versao avancada e retornou turno_obsoleto/versao_divergente');
  ok(resultados.bRetry?.resultado === 'turno_obsoleto',
     'retry com a mesma versao continua turno_obsoleto');
  ok(resultados.bRelendo?.resultado === 'recusado' && resultados.bRelendo?.motivo === 'confirmacao_ausente',
     'retry relendo a versao nova e recusado (autorizacao consumida por A)');

  // `avancou` e resolvido NO POSTGRES (`atualizado_em > $2::timestamptz`),
  // com a precisao integral do banco. Comparar em JavaScript reintroduziria
  // a perda de microssegundos que este bloco existe para evitar: dois
  // instantes distantes 1µs viram o mesmo `Date` e a comparacao diria
  // "nao avancou" mesmo tendo avancado.
  const fin = (await cn.obs.cliente.query(
    `select a.status, e.dados ->> 'turno' as turno, e.aguardando_resposta, e.contexto_horarios,
            e.atualizado_em::text as atualizado_em,
            (e.atualizado_em > $2::timestamptz) as avancou
       from estado_conversa e
       join clinicas c on c.id = e.clinica_id
       join agendamentos a on a.clinica_id = c.id
      where c.instancia_whatsapp = 'teste-axb-clinica-' || $1`, [marcador, ctx.versao])).rows[0];

  ok(fin.status === 'cancelado', 'UM UNICO EFEITO: o agendamento esta cancelado');
  // A prova de "uma unica gravacao": se B tivesse gravado, o turno seria 'B'.
  ok(fin.turno === 'A', `UMA UNICA GRAVACAO DE ESTADO: dados.turno = 'A' (veio '${fin.turno}')`);
  ok(fin.aguardando_resposta === null, 'aguardando_resposta zerado por A');
  ok(fin.contexto_horarios === null, 'contexto_horarios zerado por A');
  ok(fin.avancou === true, 'versao avancou estritamente (comparado no proprio SQL)');

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
  // ── 1. FECHAR/CANCELAR A E B ANTES DA LIMPEZA ─────────────────────────
  // Uma sessao com transacao aberta manteria locks e faria o DELETE travar.
  log('\nEncerrando A e B antes da limpeza...');
  for (const [nome, c] of [['A', cn.a], ['B', cn.b]]) {
    if (!c) continue;
    try { await c.cliente.query('rollback'); } catch { /* ja abortada/commitada */ }
    try { await c.cliente.end(); } catch { /* ignora */ }
    log(`  ${nome} encerrada.`);
  }

  // ── 2. LIMPEZA EM TERCEIRA CONEXAO, SEMPRE ────────────────────────────
  // Conexao NOVA de proposito: o observador pode estar em estado ruim.
  // Ordem inversa das FKs. Filtro pelo MARCADOR DESTA execucao -- nunca um
  // LIKE amplo que alcance outra execucao ou dado real.
  let limpezaOk = false;
  const limp = new pg.Client({ connectionString: url });
  try {
    await limp.connect();
    await limp.query(`set statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await limp.query(`set lock_timeout = ${LOCK_TIMEOUT_PADRAO_MS}`);
    log('Limpando dados sinteticos (terceira conexao)...');

    const alvo = `(select id from clinicas where instancia_whatsapp = 'teste-axb-clinica-' || $1)`;
    await limp.query(`delete from agendamentos where clinica_id in ${alvo}`, [marcador]);
    await limp.query(`delete from estado_conversa where clinica_id in ${alvo}`, [marcador]);
    await limp.query(`delete from pacientes where clinica_id in ${alvo}`, [marcador]);
    await limp.query(`delete from clinicas where instancia_whatsapp = 'teste-axb-clinica-' || $1`, [marcador]);

    // ── 3. DDL REMOVIDO DEPOIS DOS DADOS (ordem correta) ────────────────
    // SOMENTE o que esta execucao criou. Um objeto preexistente nunca e
    // removido aqui -- o preflight ja garante que, sob --aplicar, nao havia
    // nenhum; e se o CREATE da funcao falhou, `funcaoCriada` continua false
    // e so a coluna sai.
    if (funcaoCriada) {
      log('Removendo a funcao criada por esta execucao...');
      await limp.query('drop function if exists public.cappia_commit_turno_v2_cancelar(uuid, uuid, uuid, text, timestamptz, uuid, jsonb)');
    }
    if (colunaCriada) {
      log('Removendo a coluna criada por esta execucao...');
      await limp.query('alter table estado_conversa drop column if exists aguardando_resposta');
    }

    // ── 4. VERIFICAR ZERO RESIDUOS ──────────────────────────────────────
    const r = (await limp.query(
      `select (select count(*) from clinicas where instancia_whatsapp = 'teste-axb-clinica-' || $1)::int c,
              (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname='public' and p.proname='cappia_commit_turno_v2_cancelar')::int f,
              (select count(*) from information_schema.columns
                where table_schema='public' and table_name='estado_conversa'
                  and column_name='aguardando_resposta')::int col`, [marcador])).rows[0];

    // So conta como residuo o que esta execucao criou: sem --aplicar, a
    // funcao e a coluna preexistentes devem MESMO continuar la.
    const residuoDDL = (funcaoCriada && r.f > 0) || (colunaCriada && r.col > 0);
    if (r.c === 0 && !residuoDDL) {
      limpezaOk = true;
      log(`  OK: zero residuos (clinicas=${r.c}, funcao=${r.f}, coluna=${r.col}).`);
    } else {
      console.error(`  RESIDUO DETECTADO: clinicas=${r.c}, funcao=${r.f}, coluna=${r.col}`);
    }
  } catch (e) {
    console.error(`  LIMPEZA FALHOU: ${e.message}`);
  } finally {
    await limp.end().catch(() => {});
    try { if (cn.obs) await cn.obs.cliente.end(); } catch { /* ignora */ }
  }

  if (!limpezaOk) {
    falhou = true;
    // Nunca terminar em silencio deixando residuo: o marcador torna o
    // resto rastreavel e removivel a mao.
    console.error(`\n!! LIMPEZA MANUAL NECESSARIA -- marcador ${marcador}:`);
    console.error(`   delete from agendamentos where clinica_id in (select id from clinicas where instancia_whatsapp = 'teste-axb-clinica-${marcador}');`);
    console.error(`   delete from estado_conversa where clinica_id in (select id from clinicas where instancia_whatsapp = 'teste-axb-clinica-${marcador}');`);
    console.error(`   delete from pacientes where clinica_id in (select id from clinicas where instancia_whatsapp = 'teste-axb-clinica-${marcador}');`);
    console.error(`   delete from clinicas where instancia_whatsapp = 'teste-axb-clinica-${marcador}';`);
    // Sugere remover SOMENTE o que esta execucao criou -- imprimir o DROP de
    // um objeto preexistente convidaria a apagar algo em uso.
    if (funcaoCriada) {
      console.error(`   drop function if exists public.cappia_commit_turno_v2_cancelar(uuid, uuid, uuid, text, timestamptz, uuid, jsonb);`);
    }
    if (colunaCriada) {
      console.error(`   alter table estado_conversa drop column if exists aguardando_resposta;`);
    }
  }
  log('Conexoes encerradas.');
}

process.exit(falhou ? 1 : 0);
