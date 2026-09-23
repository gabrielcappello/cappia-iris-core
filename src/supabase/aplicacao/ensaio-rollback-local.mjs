// ENSAIO LOCAL DO ROLLBACK das migrations pendentes de pos-consulta (ordem operacional: "rollback preparado
// ANTES de aplicar"). Prova, no Postgres LOCAL DESCARTAVEL, que:
//   v1 -> +20260920230000 -> +20260921000000 -> rollback 3 -> estado == depois da 20260920230000
//                                            -> rollback 2 -> estado == depois da v1
// comparando o estado COMPLETO (corpo e ACL de cada funcao, colunas, constraints, triggers, grants da tabela),
// e que a TRAVA do rollback 3 recusa apagar dados em uso.
//
// NUNCA toca o operacional nem projeto hospedado: mesmas travas dos outros ensaios (loopback estrito + marca
// `iris.ambiente_teste_descartavel = 'local'` no banco + `--confirmo-projeto=local`).
//
// Uso (a partir de cappia-iris-core/src):
//   node supabase/tests/ambiente-local/ambiente-local.mjs subir
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/iris_teste_local \
//     node supabase/aplicacao/ensaio-rollback-local.mjs --confirmo-projeto=local

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { refsDaConexao } from '../tests/identidade-conexao.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const MIG = (n) => readFileSync(join(AQUI, '..', 'migrations', n), 'utf8');
const RB = (n) => readFileSync(join(AQUI, '..', 'rollbacks', n), 'utf8');
const V1 = '20260919204030_iris_nova_pos_consulta_v1.sql';
const M2 = '20260920230000_iris_nova_pos_consulta_google_so_apos_satisfacao_e_janela.sql';
const M3 = '20260921000000_iris_nova_pos_consulta_recuperacao_entrega_pendente.sql';
const RB2 = M2.replace('.sql', '_rollback.sql');
const RB3 = M3.replace('.sql', '_rollback.sql');
const PROJETO_PROIBIDO = 'udizowyfjnhuhgxkeayk';

const log = (m) => console.log(m);
const abortar = (m) => { console.error(`\nABORTADO: ${m}\n`); process.exit(1); };
const assert = (c, m) => { if (!c) throw new Error(`ASSERCAO FALHOU: ${m}`); };

const url = process.env.DATABASE_URL;
if (!url) abortar('DATABASE_URL ausente.');
if (process.argv.find((a) => a.startsWith('--confirmo-projeto=')) !== '--confirmo-projeto=local') abortar('passe --confirmo-projeto=local.');
{
  const u = new URL(url);
  for (const k of ['host', 'hostaddr', 'service']) if (u.searchParams.has(k)) abortar(`parametro de query '${k}' recusado.`);
}
const id = refsDaConexao(url, { permitirLocal: true });
if (!id.ok) abortar(id.erro);
if (id.refs.includes(PROJETO_PROIBIDO)) abortar('a DATABASE_URL aponta para o projeto operacional. Recusado.');
if (!id.refs.every((r) => r === 'local')) abortar('a DATABASE_URL nao e do ambiente local.');

const c = new pg.Client({ connectionString: url });

const SNAPSHOT = `
select jsonb_build_object(
  'funcoes', (select coalesce(jsonb_agg(jsonb_build_object('assinatura', p.oid::regprocedure::text, 'def', pg_get_functiondef(p.oid), 'acl', p.proacl::text)
                     order by p.oid::regprocedure::text), '[]'::jsonb)
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname like 'cappia_pos_consulta_%'),
  'colunas', (select coalesce(jsonb_agg(jsonb_build_object('n', column_name, 't', data_type, 'd', column_default, 'nulo', is_nullable) order by column_name), '[]'::jsonb)
                from information_schema.columns where table_schema = 'public' and table_name = 'pos_consulta_jornadas'),
  'constraints', (select coalesce(jsonb_agg(jsonb_build_object('n', conname, 'd', pg_get_constraintdef(oid)) order by conname), '[]'::jsonb)
                    from pg_constraint where conrelid = 'public.pos_consulta_jornadas'::regclass),
  'triggers', (select coalesce(jsonb_agg(tgname order by tgname), '[]'::jsonb)
                 from pg_trigger where tgrelid = 'public.pos_consulta_jornadas'::regclass and not tgisinternal),
  'grants', (select coalesce(jsonb_agg(jsonb_build_object('g', grantee, 'p', privilege_type) order by grantee, privilege_type), '[]'::jsonb)
               from information_schema.role_table_grants where table_schema = 'public' and table_name = 'pos_consulta_jornadas')
) as s`;
const snap = async () => (await c.query(SNAPSHOT)).rows[0].s;
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const nomes = (s) => s.funcoes.map((f) => f.assinatura.replace('public.', '')).join(', ');

async function limpar() {
  await c.query(`
    do $$ declare r record; begin
      for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname like 'cappia_pos_consulta_%' loop
        execute 'drop function if exists ' || r.f || ' cascade';
      end loop;
    end $$;
    drop table if exists public.pos_consulta_jornadas cascade;`);
}

try {
  await c.connect();
  const marca = (await c.query(`select current_setting('iris.ambiente_teste_descartavel', true) as m`)).rows[0].m;
  if (marca !== 'local') abortar('o banco nao tem a marca de ambiente local descartavel.');
  const pre = (await c.query(`select (select count(*) from information_schema.tables where table_schema='public' and table_name='pos_consulta_jornadas')::int t,
      (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'cappia_pos_consulta_%')::int f`)).rows[0];
  if (pre.t + pre.f > 0) abortar('o ambiente local nao esta limpo.');

  // ── aplica em ordem, guardando o estado depois de cada uma ──────────────────────────
  await c.query(MIG(V1));
  const sV1 = await snap();
  log(`[1] apos a v1: ${sV1.funcoes.length} funcoes, ${sV1.constraints.length} constraints, ${sV1.colunas.length} colunas`);
  await c.query(MIG(M2));
  const sM2 = await snap();
  assert(!igual(sV1, sM2), 'a 20260920230000 deveria mudar o estado');
  log(`[2] apos a 20260920230000: ${sM2.funcoes.length} funcoes, ${sM2.constraints.length} constraints`);
  await c.query(MIG(M3));
  const sM3 = await snap();
  assert(!igual(sM2, sM3), 'a 20260921000000 deveria mudar o estado');
  log(`[3] apos a 20260921000000: ${sM3.funcoes.length} funcoes, ${sM3.constraints.length} constraints, ${sM3.colunas.length} colunas`);

  // ── TRAVA do rollback 3: com dados em uso, RECUSA e nada muda ────────────────────────
  log('\n[4] Trava do rollback da 20260921000000 (dados em uso)...');
  const clinica = randomUUID(), paciente = randomUUID(), agendamento = randomUUID();
  await c.query(`insert into clinicas (id, provider, nome, email, slug, whatsapp_instancia) values ($1,'teste-rollback','Clinica RB','rb-'||$2||'@teste.invalid','rb-'||$2,'rb-'||$2)`, [clinica, clinica.slice(0, 8)]);
  await c.query(`insert into pacientes (id, clinica_id, nome, telefone) values ($1,$2,'Paciente RB','11999995555')`, [paciente, clinica]);
  await c.query(`insert into agendamentos (id, clinica_id, paciente_id, data, horario, status, procedimento_id, concluido_em)
                 values ($1,$2,$3,current_date - 1,'10:00','concluido','proc-teste', now() - interval '3 hours')`, [agendamento, clinica, paciente]);
  await c.query(`insert into pos_consulta_jornadas (clinica_id, agendamento_id, paciente_id, telefone_normalizado, modo, etapa, entrega_id, entrega_claim_token, entrega_lease_expira_em)
                 values ($1,$2,$3,'5511999995555','ambos','aguardando_inicio',gen_random_uuid(),gen_random_uuid(), now() + interval '3 minutes')`, [clinica, agendamento, paciente]);
  await c.query(`update pos_consulta_jornadas set etapa='encerrada', entrega_id=null, entrega_claim_token=null, entrega_lease_expira_em=null, encerramento_motivo='abandonada_janela' where agendamento_id=$1`, [agendamento]);
  const antesTrava = await snap();
  let recusou = false;
  try { await c.query(RB(RB3)); } catch (e) { recusou = /ROLLBACK RECUSADO/.test(e.message); }
  assert(recusou, 'o rollback da 20260921000000 deveria ser RECUSADO com jornada usando encerramento_motivo');
  assert(igual(antesTrava, await snap()), 'a recusa nao pode ter alterado NADA (estado identico)');
  log('  OK: o rollback recusou apagar dados em uso e nada mudou.');
  await c.query('delete from pos_consulta_jornadas where agendamento_id = $1', [agendamento]);
  await c.query('delete from agendamentos where id = $1', [agendamento]);
  await c.query('delete from pacientes where id = $1', [paciente]);
  await c.query('delete from clinicas where id = $1', [clinica]);

  // ── rollback 3: volta ao estado da 20260920230000 ───────────────────────────────────
  log('\n[5] Rollback da 20260921000000 (tabela sem dados em uso)...');
  await c.query(RB(RB3));
  const aposRb3 = await snap();
  assert(igual(aposRb3, sM2), `apos o rollback 3 o estado deveria ser IDENTICO ao da 20260920230000.\n  antes: ${nomes(sM2)}\n  depois: ${nomes(aposRb3)}`);
  log('  OK: estado identico ao de depois da 20260920230000 (funcoes com corpo e ACL, colunas, constraints, triggers, grants).');

  // ── rollback 2: volta ao estado da v1 ───────────────────────────────────────────────
  log('\n[6] Rollback da 20260920230000...');
  await c.query(RB(RB2));
  const aposRb2 = await snap();
  assert(igual(aposRb2, sV1), `apos o rollback 2 o estado deveria ser IDENTICO ao da v1.\n  antes: ${nomes(sV1)}\n  depois: ${nomes(aposRb2)}`);
  log('  OK: estado identico ao de depois da v1 (a migration ja registrada no operacional).');

  // ── reaplicar depois do rollback funciona (o rollback nao deixa residuo) ─────────────
  log('\n[7] Reaplicando as duas migrations depois do rollback...');
  await c.query(MIG(M2));
  await c.query(MIG(M3));
  assert(igual(await snap(), sM3), 'reaplicar depois do rollback deveria reproduzir o estado final');
  log('  OK: reaplicar reproduz exatamente o estado final (o rollback nao deixa residuo).');

  log('\n✅ ENSAIO DE ROLLBACK PASSOU: os dois rollbacks devolvem o estado exato anterior; a trava protege dados em uso.\n');
} catch (e) {
  console.error(`\n❌ FALHOU: ${e.message}\n`);
  process.exitCode = 1;
} finally {
  try { await limpar(); log('Limpeza: objetos do ensaio removidos do banco local.'); } catch (e) { console.error(`AVISO: limpeza incompleta: ${e.message}`); }
  await c.end().catch(() => {});
}
