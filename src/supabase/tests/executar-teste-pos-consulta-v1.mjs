// Teste SQL REAL de 20260919204030_iris_nova_pos_consulta_v1.sql -- prova
// contra Postgres de verdade (nao dublê) as correcoes de
// reviews/revisao-pos-consulta-conversacional-v1.md: B1 (grants sob o papel
// service_role de verdade, nao o admin), B2 (identidade estavel da entrega
// -- entrega_id preservado no reclaim -- e as fronteiras antes/durante/
// depois do ack, incluindo lease_expirado distinto de token_invalido), B3
// (vinculo clinica/paciente/agendamento/TELEFONE OFICIAL) e B4 (jornada
// unica por telefone).
//
// STATUS (2026-09-19): EXECUTADO com sucesso (exit 0) contra o ambiente LOCAL
// DESCARTAVEL (Postgres 17.10 em 127.0.0.1, ambiente-local/LEIA-ME.md) --
// nunca contra um projeto hospedado. Todos os cenarios passam. Ressalvas que
// qualificam esse "passou": (1) o schema local e uma RECONSTRUCAO das tres
// tabelas a partir dos tipos gerados + migrations-legado (02-schema-legado-
// minimo.sql), nao o schema operacional real -- compatibilidade com o
// operacional segue exigindo o PREFLIGHT read-only da migration, com
// autorizacao; (2) e Postgres comum com o modelo de papeis/default privileges
// do Supabase reproduzido, nao o stack Supabase completo.
//
// A PRIMEIRA execucao real revelou dois defeitos DESTE RUNNER (nenhum da
// migration): (a) a corrida B4 "mesmo agendamento" usava o telefone de um
// paciente que ja tinha jornada ativa (criada em B1), entao o indice parcial
// de telefone recusava as duas chamadas -- cada corrida agora usa telefone
// novo; (b) fixtures escritas para o schema do antigo dev (excluido) davam
// INSERT em colunas GERADAS do operacional (`pacientes.telefone_normalizado`,
// `clinicas.instancia_whatsapp`) e omitiam colunas NOT NULL (`nome`, `email`,
// `slug`) -- adaptadas ao schema operacional.
//
// ── PROJETO-ALVO -- CORRIGIDO (o "projeto dev bcmuqautblvjdqzhjfbw" citado
//    em versoes anteriores desta secao NAO ESTA MAIS DISPONIVEL; ver nota
//    abaixo) ────────────────────────────────────────────────────────────
// O UNICO Supabase real e ATIVO da Iris hoje e o OPERACIONAL
// (`udizowyfjnhuhgxkeayk`) -- e continua PROIBIDO para este script (ele
// cria e apaga linhas de verdade). Versoes anteriores deste arquivo
// assumiam um projeto "dev" (`bcmuqautblvjdqzhjfbw`) como alvo autorizado.
// Correcao historica: esse projeto EXISTIU, mas foi EXCLUIDO -- nao e mais
// alcancavel, e o ref nao deve ser reaproveitado como um alvo fixo de novo
// (um project ref excluido pode, em tese, ser reciclado pela Supabase para
// outro projeto no futuro; nunca assumir que esse ref especifico ainda
// significa "o dev da Iris"). Ainda NAO existe um ambiente de teste
// decidido -- ver PROPOSTA_AMBIENTE_TESTE.md (ao lado deste arquivo) para
// as opcoes levantadas (Supabase local via CLI, projeto dev novo, ou o
// projeto `eipuzacdfmeqkjbexqqo`/"cappia-tales" ja existente na mesma
// organizacao, hoje pausado -- auditoria read-only em andamento) e o que
// cada uma exige. Ate essa decisao, o unico requisito de alvo deste script
// e NAO SER o operacional -- ver `PROJETO_PROIBIDO` abaixo. Quando o
// ambiente for decidido, trocar essa checagem de volta para um allowlist
// explicito de UM projeto so, como esta secao tinha antes.
//
// ── CORRECAO DESTA VERSAO (achado da segunda revisao do Codex) ──────────
// A versao anterior deste script abria `clienteA`/`clienteB` com a MESMA
// `DATABASE_URL` do admin, sem `SET ROLE service_role` -- se a URL
// autentica como `postgres` (superusuario/owner), a prova de B1 passava
// mesmo que os grants de `service_role` estivessem errados, porque o
// admin nunca esbarra em ACL nenhuma. Corrigido: `clienteA`/`clienteB`
// agora executam `SET ROLE service_role` logo apos conectar -- as chamadas
// de RPC saem sob o PAPEL RESTRITO de verdade. Pressupoe que a role de
// login usada em `DATABASE_URL` e membro de `service_role` (verdadeiro
// para o papel de conexao direta padrao do Supabase); se `SET ROLE`
// falhar, o script aborta em vez de prosseguir sob um papel diferente do
// pretendido. Acrescentadas tambem duas conexoes extras (`clienteAnon`,
// `clienteAuthenticated`) que provam que `anon`/`authenticated` NUNCA
// alcancam nem `select` nem `execute` -- defesa em profundidade, nao so
// ausencia de grant.
//
// ── CORRECAO DESTA VERSAO (E1/E3, quinta revisao) ───────────────────────
// Cobertura nova para `cappia_pos_consulta_candidatos` (adicionada na
// revisao 4, D3): preflight agora tambem exige essa funcao ausente antes de
// `--aplicar`; ACL negativa (anon/authenticated) cobre a nova funcao; um
// cenario funcional novo cobre E1 -- a RPC devolve `instancia_whatsapp`
// (autenticacao da Edge Function) e `whatsapp_instancia` (instanceName da
// Evolution) sob nomes distintos, cada um igual a coluna homonima, e o corpo
// da funcao mapeia cada coluna sob o proprio nome. (No operacional a primeira
// e coluna GERADA da segunda -- valores sempre iguais no banco; o teste com
// valores DIFERENTES esta em src/core/pos-consulta-n8n-instancias.test.ts.) E dois
// cenarios negativos (prazo ainda nao vencido; `pos_consulta_tipo`
// desligado) provando que a RPC continua sendo so um pre-filtro correto, "
// nao autoritativo. Rollback (tanto no cabecalho da migration quanto na
// limpeza deste script) dropa `cappia_pos_consulta_candidatos` ANTES da
// tabela, junto das outras tres funcoes.
//
// ── REVISAO FINAL DO CODEX (2026-09-20), BLOQUEADORES 1 E 2 ─────────────
// O runner agora aplica DUAS migrations em ordem (a original, versao registrada
// 20260919204030, e a aditiva 20260920230000) e cobre:
//   G -- Google SO apos satisfacao positiva confirmada: G1 a primeira entrega
//        recusa convite em nenhum modo; G2 o modo 'google' pergunta primeiro
//        (confirmar leva a 'aguardando_satisfacao', nao 'encerrada') e so a
//        positiva autoriza/grava o convite; G3 seis combinacoes invalidas
//        recusadas sem gravar nada; G4 os tres CHECKs da tabela barram ate
//        UPDATE direto do admin, inclusive com classificacao NULL.
//   J -- janela maxima de idade (48h de concluido_em): J1 iniciar_jornada
//        (47h cria; 49h e sem concluido_em recusam 'fora_da_janela' sem gravar);
//        J2 reclaim fora da janela recusado com token intacto; J3 candidatos
//        exclui 49h e inclui 47h.
// As fixtures de B1-B4 agora gravam `concluido_em` (3h atras), porque a janela
// recusa agendamento sem essa coluna. Controle negativo feito na entrega: o
// mesmo runner so com a migration original FALHA em G1.
//
// ── O QUE ESTE SCRIPT FAZ ────────────────────────────────────────────────
// 1. Aplica as migrations (se ainda nao existirem -- preflight estrito, aborta
//    se algum objeto ja existir e nao foi criado por esta execucao).
// 2. Cria fixtures minimas: DUAS clinicas, um paciente e DOIS agendamentos
//    concluidos na clinica 1 para o MESMO paciente/telefone (para B4); mais
//    duas clinicas extras (com `automatizacoes` e instancias distintas) so
//    para os cenarios de `cappia_pos_consulta_candidatos` (E1/E3).
// 3. B1 -- chama as tres RPCs de jornada SOB `service_role` de verdade (nao
//    o admin) e confirma que `anon`/`authenticated` nunca alcancam a tabela
//    nem as quatro funcoes (incluindo `cappia_pos_consulta_candidatos`).
// 4. B3 -- chama iniciar_jornada com p_clinica_id da clinica 2 mas
//    p_agendamento_id/p_paciente_id da clinica 1 (vinculo cruzado), e
//    depois com o vinculo correto mas um TELEFONE que nao e o oficial do
//    paciente -- exige que a RPC RECUSE (excecao) nos dois casos.
// 5. B4 -- duas chamadas CONCORRENTES de iniciar_jornada para os dois
//    agendamentos do MESMO telefone -- exige exatamente UM 'pendente' e UM
//    'conflito_telefone_ativo'.
// 6. B2 -- identidade estavel + fronteiras de entrega:
//    a) ANTES da entrega: iniciar_jornada reserva mas NAO avanca a etapa;
//    b) DURANTE (queda simulada): forca o lease a expirar (UPDATE direto,
//       so possivel nesta sessao de teste com privilegio elevado -- NUNCA
//       um caminho do Core) e chama iniciar_jornada de novo -- exige
//       reclaim com CLAIM_TOKEN NOVO mas o MESMO entrega_id;
//    c) confirmar com o claim_token ANTIGO (pre-reclaim, ja substituido)
//       exige 'token_invalido'; confirmar com o NOVO mas com o LEASE
//       forcado a expirar de novo exige 'lease_expirado' (distinto de
//       token_invalido); confirmar dentro do lease vigente exige
//       'confirmada'; confirmar de novo com o mesmo token ja consumido
//       exige 'token_invalido' (nunca reaplica efeito).
// 7. E1/E3 -- `cappia_pos_consulta_candidatos`: um cenario positivo (dois
//    campos de instancia com valores DIFERENTES, devolvidos sob os nomes
//    corretos) e dois negativos (prazo nao vencido; pos_consulta_tipo
//    desligado).
// 8. Limpeza completa (fixtures + objetos criados por esta execucao) em
//    `finally`, com verificacao de zero residuo.
//
// ── COMANDO (NAO EXECUTAR SEM CONFIRMAR O PROJETO) ──────────────────────
// <ref> = o project ref REAL do ambiente de teste escolhido (ver
// PROPOSTA_AMBIENTE_TESTE.md) -- NUNCA udizowyfjnhuhgxkeayk.
//   cd C:\Users\Gabriel\cappia-iris-core\src
//   node --env-file="<cofre>/<arquivo-com-DATABASE_URL-do-ambiente-de-teste>.env" \
//     supabase/tests/executar-teste-pos-consulta-v1.mjs --aplicar --confirmo-projeto=<ref>

import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { refsDaConexao } from './identidade-conexao.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
// DUAS migrations, aplicadas nesta ordem: a original (versao registrada no
// operacional, 20260919204030) e a ADITIVA da revisao final do Codex
// (Google so apos satisfacao positiva + janela maxima de idade).
const SQL_MIGRATIONS = [
  join(AQUI, '..', 'migrations', '20260919204030_iris_nova_pos_consulta_v1.sql'),
  join(AQUI, '..', 'migrations', '20260920230000_iris_nova_pos_consulta_google_so_apos_satisfacao_e_janela.sql'),
  // Recuperacao de entregas pendentes com lease vencido (sexta revisao do Codex, bloqueador 1).
  join(AQUI, '..', 'migrations', '20260921000000_iris_nova_pos_consulta_recuperacao_entrega_pendente.sql'),
];

// O UNICO Supabase real da Iris -- nunca alvo deste script, em nenhuma circunstancia.
const PROJETO_PROIBIDO = 'udizowyfjnhuhgxkeayk';

const STATEMENT_TIMEOUT_MS = 15000;
const aplicarDDL = process.argv.includes('--aplicar');
const marcador = randomUUID();

function log(m) { console.log(m); }
function abortar(m) { console.error(`\nABORTADO: ${m}\n`); process.exit(1); }
function assert(cond, msg) { if (!cond) throw new Error(`ASSERCAO FALHOU: ${msg}`); }

const url = process.env.DATABASE_URL;
if (!url) abortar('DATABASE_URL ausente. Carregue o .env do cofre com --env-file.');

// ── GUARDA DE ALVO ────────────────────────────────────────────────────────
// Nao existe allowlist fixa de projeto de teste (o antigo "projeto dev
// bcmuqautblvjdqzhjfbw" existiu, mas foi EXCLUIDO -- ver cabecalho). Quem roda
// o script DECLARA contra qual alvo pretende rodar (--confirmo-projeto=<alvo>)
// e essa declaracao e CRUZADA com a identidade REAL da DATABASE_URL -- nem a
// flag sozinha, nem a URL sozinha, bastam.
//
// <alvo> e o project ref de um projeto de teste hospedado OU a palavra
// "local" (ambiente descartavel em 127.0.0.1, autorizado pelo Gabriel --
// ambiente-local/LEIA-ME.md). O OPERACIONAL e recusado em qualquer caminho.
const flagProjeto = process.argv.find((a) => a.startsWith('--confirmo-projeto='));
if (!flagProjeto) {
  abortar(
    'passe --confirmo-projeto=<alvo> explicitamente: o project ref do projeto de teste hospedado, ' +
      'ou "local" para o ambiente descartavel em 127.0.0.1 (ambiente-local/LEIA-ME.md).'
  );
}
const projetoConfirmado = flagProjeto.slice('--confirmo-projeto='.length);
if (projetoConfirmado === PROJETO_PROIBIDO) {
  abortar('--confirmo-projeto nao pode ser o projeto operacional -- isso nunca e permitido, mesmo com confirmacao explicita.');
}
const modoLocal = projetoConfirmado === 'local';

// Hardening do PROPRIO runner (vale nos dois modos): parametros de query que
// sobrescrevem o host real da conexao poderiam levar uma URL de aparencia
// inofensiva ate o operacional sem mudar o hostname.
{
  let u;
  try { u = new URL(url); } catch { abortar('DATABASE_URL malformada (nao e uma URL valida).'); }
  for (const chave of ['host', 'hostaddr', 'service']) {
    if (u.searchParams.has(chave)) {
      abortar(`a DATABASE_URL tem o parametro de query '${chave}', que pode redirecionar a conexao para outro host. Recusado.`);
    }
  }
}

const identidade = refsDaConexao(url, { permitirLocal: modoLocal });
if (!identidade.ok) abortar(identidade.erro);
if (identidade.refs.includes(PROJETO_PROIBIDO)) {
  abortar(`a DATABASE_URL aponta para o projeto OPERACIONAL (${PROJETO_PROIBIDO}). Este teste cria e apaga linhas reais. Recusado.`);
}
if (!identidade.refs.every((r) => r === projetoConfirmado)) {
  abortar(`--confirmo-projeto=${projetoConfirmado} nao bate com o(s) alvo(s) identificado(s) na DATABASE_URL: ${identidade.refs.join(', ')}.`);
}

async function conectar(nome, papel) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(`set statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
  if (papel) {
    try {
      await c.query(`set role ${papel}`);
    } catch (e) {
      throw new Error(
        `nao foi possivel 'SET ROLE ${papel}' na conexao ${nome} -- a role de login em DATABASE_URL precisa ser ` +
          `membro de '${papel}'. Sem isso, este script nao prova B1/ACL de verdade. Erro original: ${e.message}`
      );
    }
  }
  log(`  ${nome}: conectada${papel ? ` (SET ROLE ${papel})` : ''}`);
  return c;
}

let clienteAdmin;
let clienteA;
let clienteB;
let clienteAnon;
let clienteAuthenticated;
let migrationAplicadaPorEstaExecucao = false;
let clinica1;
let clinica2;
let paciente1;
let agendamento1;
let agendamento2;
// E1/E3 -- clinicas extras SO para os cenarios de cappia_pos_consulta_candidatos.
// Todas as clinicas de fixture (das duas frentes) vivem neste array unico
// para a limpeza nunca esquecer uma delas.
const todasClinicas = [];

async function limpar() {
  log('\nLimpando fixtures e residuos...');
  try {
    const clinicasCriadas = todasClinicas.filter(Boolean);
    if (clinicasCriadas.length > 0) {
      await clienteAdmin.query('delete from pos_consulta_jornadas where clinica_id = any($1)', [clinicasCriadas]);
      await clienteAdmin.query('delete from agendamentos where clinica_id = any($1)', [clinicasCriadas]);
      await clienteAdmin.query('delete from pacientes where clinica_id = any($1)', [clinicasCriadas]);
      await clienteAdmin.query('delete from clinicas where id = any($1)', [clinicasCriadas]);
      const residuo = await clienteAdmin.query('select count(*)::int n from pos_consulta_jornadas where clinica_id = any($1)', [
        clinicasCriadas,
      ]);
      assert(residuo.rows[0].n === 0, 'residuo de pos_consulta_jornadas apos limpeza');
      log('  OK: zero residuo confirmado.');
    }
  } catch (e) {
    console.error(`  AVISO: limpeza incompleta -- verificar manualmente. Marcador: ${marcador}. Erro: ${e.message}`);
  }

  if (migrationAplicadaPorEstaExecucao) {
    log('  Revertendo a migration (rollback embutido no cabecalho do arquivo)...');
    // E3 (quinta revisao) -- cappia_pos_consulta_candidatos e uma FUNCAO,
    // sem dependencia fisica da tabela, mas o rollback dropa TODAS as
    // funcoes antes da tabela, sempre -- mesma ordem do cabecalho da
    // migration (secao ROLLBACK).
    await clienteAdmin.query(`
      drop function if exists public.cappia_pos_consulta_candidatos(integer);
      drop function if exists public.cappia_pos_consulta_confirmar_entrega(uuid, uuid, uuid);
      drop function if exists public.cappia_pos_consulta_registrar_resposta_pendente(uuid, uuid, text, boolean);
      drop function if exists public.cappia_pos_consulta_iniciar_jornada(uuid, uuid, uuid, text, text, boolean, text);
      drop function if exists public.cappia_pos_consulta_encerrar_sem_resposta(integer);
      drop function if exists public.cappia_pos_consulta_expiracao_sem_resposta_minutos();
      drop function if exists public.cappia_pos_consulta_recuperar_entrega(uuid, uuid, uuid, text);
      drop function if exists public.cappia_pos_consulta_max_tentativas_entrega();
      drop function if exists public.cappia_pos_consulta_janela_maxima_minutos();
      drop table if exists public.pos_consulta_jornadas;
      drop function if exists public.cappia_pos_consulta_jornadas_tentativas_tg();
    `);
  }

  for (const c of [clienteAdmin, clienteA, clienteB, clienteAnon, clienteAuthenticated]) {
    if (c) await c.end().catch(() => {});
  }
}

try {
  log(`\nProjeto ${projetoConfirmado} | marcador: ${marcador}\n`);

  clienteAdmin = await conectar('ADMIN'); // sem SET ROLE -- so para DDL/fixtures/limpeza, nunca para provar ACL

  // MODO LOCAL -- autorizacao explicita, verificada NO PROPRIO BANCO antes de
  // qualquer escrita: o ambiente descartavel grava
  // `iris.ambiente_teste_descartavel = 'local'` no banco quando e criado
  // (ambiente-local.mjs). Um tunel/port-forward que leve "localhost" ate o
  // banco OPERACIONAL passaria na checagem de hostname, mas o operacional nao
  // tem essa marca -- entao morre aqui, antes de qualquer DDL ou fixture.
  if (modoLocal) {
    const marca = (await clienteAdmin.query(`select current_setting('iris.ambiente_teste_descartavel', true) as m, current_database() as banco`)).rows[0];
    if (marca.m !== 'local') {
      abortar(
        `o banco '${marca.banco}' em 127.0.0.1 NAO tem a marca de ambiente local descartavel ('iris.ambiente_teste_descartavel'). ` +
          'Recusado: pode ser um tunel para outro banco. Crie o ambiente com ambiente-local.mjs subir.'
      );
    }
    log(`  modo LOCAL confirmado: banco '${marca.banco}' tem a marca de ambiente descartavel.`);
  }
  clienteA = await conectar('SESSAO A (service_role)', 'service_role');
  clienteB = await conectar('SESSAO B (service_role)', 'service_role');
  clienteAnon = await conectar('SESSAO ANON', 'anon');
  clienteAuthenticated = await conectar('SESSAO AUTHENTICATED', 'authenticated');

  if (aplicarDDL) {
    const pre = (
      await clienteAdmin.query(`
        select
          (select count(*) from information_schema.tables where table_schema='public' and table_name='pos_consulta_jornadas')::int t,
          (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname in (
              'cappia_pos_consulta_iniciar_jornada',
              'cappia_pos_consulta_registrar_resposta_pendente',
              'cappia_pos_consulta_confirmar_entrega',
              'cappia_pos_consulta_candidatos',
              'cappia_pos_consulta_janela_maxima_minutos',
              'cappia_pos_consulta_recuperar_entrega',
              'cappia_pos_consulta_max_tentativas_entrega',
              'cappia_pos_consulta_jornadas_tentativas_tg',
              'cappia_pos_consulta_expiracao_sem_resposta_minutos',
              'cappia_pos_consulta_encerrar_sem_resposta'))::int f
      `)
    ).rows[0];
    if (pre.t > 0 || pre.f > 0) {
      abortar(`--aplicar exige tabela e funcoes AUSENTES, mas ja existem (tabela=${pre.t}, funcoes=${pre.f}).`);
    }
    log('\nAplicando as migrations em ordem...');
    for (const arquivo of SQL_MIGRATIONS) {
      await clienteAdmin.query(await readFile(arquivo, 'utf8'));
      migrationAplicadaPorEstaExecucao = true;
      log(`  OK: aplicada ${arquivo.split(/[\\/]/).pop()}`);
    }
    log('  OK: tabela, funcoes e CHECKs criados POR ESTA EXECUCAO.');
  } else {
    const { rows } = await clienteAdmin.query(`
      select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='cappia_pos_consulta_iniciar_jornada'
    `);
    if (rows[0].n === 0) abortar('as funcoes nao existem. Rode com --aplicar.');
  }

  // ── FIXTURES ────────────────────────────────────────────────────────
  log('\nCriando fixtures sinteticas...');
  clinica1 = randomUUID();
  clinica2 = randomUUID();
  paciente1 = randomUUID();
  agendamento1 = randomUUID();
  agendamento2 = randomUUID();
  // SCHEMA ALVO: a forma do banco OPERACIONAL (tipos gerados em
  // portal-iris-principal/src/lib/database.types.ts + migrations-legado/),
  // NAO a do antigo dev (que foi excluido). Duas colunas sao GERADAS e nao
  // aceitam INSERT: `clinicas.instancia_whatsapp` (= whatsapp_instancia) e
  // `pacientes.telefone_normalizado` ('55' || telefone). `clinicas` exige
  // nome/email/slug e `pacientes` exige nome.
  const telefoneLocal = '11999990000'; // grava-se `telefone`; o normalizado sai gerado
  const telefone = '55' + telefoneLocal; // = pacientes.telefone_normalizado
  todasClinicas.push(clinica1, clinica2);

  await clienteAdmin.query('begin');
  await clienteAdmin.query(
    `insert into clinicas (id, provider, nome, email, slug, whatsapp_instancia) values
       ($1, 'teste-pos-consulta', 'Clinica Teste 1', 'c1-' || $4 || '@teste.invalid', 'c1-' || $4, $3),
       ($2, 'teste-pos-consulta', 'Clinica Teste 2', 'c2-' || $4 || '@teste.invalid', 'c2-' || $4, $3 || '-2')`,
    [clinica1, clinica2, `teste-pos-consulta-${marcador}`, marcador]
  );
  await clienteAdmin.query(`insert into pacientes (id, clinica_id, nome, telefone) values ($1, $2, 'Paciente Teste', $3)`, [
    paciente1,
    clinica1,
    telefoneLocal,
  ]);
  // DOIS agendamentos concluidos, MESMA clinica, MESMO paciente/telefone --
  // fixture do teste B4 (jornada unica por telefone).
  // `concluido_em` DENTRO da janela maxima (48h): desde a revisao final do
  // Codex, `iniciar_jornada` recusa agendamento sem `concluido_em` ou fora da
  // janela ('fora_da_janela') -- fixtures de B1-B4 usam 3h atras.
  await clienteAdmin.query(
    `insert into agendamentos (id, clinica_id, paciente_id, data, horario, status, procedimento_id, concluido_em)
     values ($1, $2, $3, current_date - 1, '10:00', 'concluido', 'proc-teste', now() - interval '3 hours'),
            ($4, $2, $3, current_date - 1, '11:00', 'concluido', 'proc-teste', now() - interval '3 hours')`,
    [agendamento1, clinica1, paciente1, agendamento2]
  );
  await clienteAdmin.query('commit');
  log(`  OK: clinica1=${clinica1} clinica2=${clinica2} paciente1=${paciente1} agendamento1=${agendamento1} agendamento2=${agendamento2}`);

  const INICIAR = `select cappia_pos_consulta_iniciar_jornada($1,$2,$3,$4,$5,$6) as r`;
  const CONFIRMAR = `select cappia_pos_consulta_confirmar_entrega($1,$2,$3) as r`;

  // ── B1: GRANTS -- sob service_role DE VERDADE (nao o admin) ────────────
  log('\n[B1] Verificando grants sob service_role de verdade...');
  const b1 = (await clienteA.query(INICIAR, [clinica1, agendamento1, paciente1, telefone, 'satisfacao', false])).rows[0].r;
  assert(b1.resultado === 'pendente', `B1: esperado 'pendente', veio '${b1.resultado}' (verificar mensagem de erro se for excecao)`);
  log('  OK (B1): insert via RPC funcionou sob service_role -- grants corretos.');
  const tokenAgendamento1 = b1.claim_token;
  const entregaIdAgendamento1 = b1.entrega_id;
  assert(typeof entregaIdAgendamento1 === 'string' && entregaIdAgendamento1.length > 0, 'B2: entrega_id ausente no retorno de iniciar_jornada');

  // ── B1 (ACL negativa): anon/authenticated NUNCA alcancam a tabela nem as funcoes ──
  log('\n[B1] Verificando que anon/authenticated NUNCA tem acesso...');
  let anonSelectNegado = false;
  try {
    await clienteAnon.query('select 1 from pos_consulta_jornadas limit 1');
  } catch (e) {
    anonSelectNegado = /permission denied/i.test(e.message);
  }
  assert(anonSelectNegado, 'B1: anon deveria receber permission denied ao SELECT em pos_consulta_jornadas');
  let anonExecuteNegado = false;
  try {
    await clienteAnon.query(INICIAR, [clinica1, agendamento1, paciente1, telefone, 'satisfacao', false]);
  } catch (e) {
    anonExecuteNegado = /permission denied/i.test(e.message);
  }
  assert(anonExecuteNegado, 'B1: anon deveria receber permission denied ao chamar cappia_pos_consulta_iniciar_jornada');
  let authenticatedExecuteNegado = false;
  try {
    await clienteAuthenticated.query(INICIAR, [clinica1, agendamento1, paciente1, telefone, 'satisfacao', false]);
  } catch (e) {
    authenticatedExecuteNegado = /permission denied/i.test(e.message);
  }
  assert(authenticatedExecuteNegado, 'B1: authenticated deveria receber permission denied ao chamar cappia_pos_consulta_iniciar_jornada');
  log('  OK (B1): anon/authenticated recusados em SELECT e EXECUTE, sem excecao.');

  // E3 (quinta revisao) -- MESMA ACL negativa, agora tambem para
  // cappia_pos_consulta_candidatos (funcao adicionada na revisao 4, D3).
  log('\n[E3] Verificando que anon/authenticated NUNCA alcancam cappia_pos_consulta_candidatos...');
  let anonCandidatosNegado = false;
  try {
    await clienteAnon.query('select * from cappia_pos_consulta_candidatos(10)');
  } catch (e) {
    anonCandidatosNegado = /permission denied/i.test(e.message);
  }
  assert(anonCandidatosNegado, 'E3: anon deveria receber permission denied ao chamar cappia_pos_consulta_candidatos');
  let authenticatedCandidatosNegado = false;
  try {
    await clienteAuthenticated.query('select * from cappia_pos_consulta_candidatos(10)');
  } catch (e) {
    authenticatedCandidatosNegado = /permission denied/i.test(e.message);
  }
  assert(authenticatedCandidatosNegado, 'E3: authenticated deveria receber permission denied ao chamar cappia_pos_consulta_candidatos');
  log('  OK (E3): anon/authenticated recusados em cappia_pos_consulta_candidatos, sem excecao.');

  // ── B3: VINCULO -- clinica errada, e telefone que nao e o oficial ─────
  log('\n[B3] Verificando recusa de vinculo cruzado entre clinicas...');
  let b3FalhouComoEsperado = false;
  try {
    await clienteA.query(INICIAR, [clinica2, agendamento1, paciente1, telefone, 'satisfacao', false]);
  } catch (e) {
    b3FalhouComoEsperado = /vinculo/i.test(e.message);
  }
  assert(b3FalhouComoEsperado, 'B3: esperava excecao de vinculo invalido ao misturar clinica2 com agendamento1/paciente1 de clinica1');
  log('  OK (B3): vinculo cruzado (clinica) recusado com excecao.');

  log('[B3] Verificando recusa de telefone que nao e o oficial do paciente...');
  const agendamentoTelefoneErrado = randomUUID();
  await clienteAdmin.query(
    `insert into agendamentos (id, clinica_id, paciente_id, data, horario, status, procedimento_id, concluido_em)
     values ($1, $2, $3, current_date - 1, '13:00', 'concluido', 'proc-teste', now() - interval '3 hours')`,
    [agendamentoTelefoneErrado, clinica1, paciente1]
  );
  let b3TelefoneFalhouComoEsperado = false;
  try {
    await clienteA.query(INICIAR, [clinica1, agendamentoTelefoneErrado, paciente1, '5599999999999', 'satisfacao', false]);
  } catch (e) {
    b3TelefoneFalhouComoEsperado = /vinculo/i.test(e.message);
  }
  assert(b3TelefoneFalhouComoEsperado, 'B3: esperava excecao ao informar telefone diferente do oficial do paciente');
  log('  OK (B3): telefone divergente do oficial recusado com excecao.');

  // ── B4: JORNADA UNICA POR TELEFONE -- corridas reais, duas conexoes ────
  // ACHADO DA PRIMEIRA EXECUCAO REAL (falha do runner, nao da migration): a
  // versao anterior fazia a corrida "mesmo agendamento" com o telefone de
  // paciente1 -- que a essa altura JA TINHA jornada ativa (agendamento1, criada
  // em B1). O indice parcial de telefone recusava as duas chamadas
  // ('conflito_telefone_ativo' x2) antes de a constraint por agendamento
  // ter chance de aparecer. Cada corrida agora usa um telefone NOVO e limpo.
  log('\n[B4] Verificando corridas concorrentes (duas conexoes, service_role)...');
  const resultadoDe = (r) => (r.status === 'fulfilled' ? r.value.rows[0].r.resultado : `erro:${r.reason.message}`);
  const contar = (resultados) => resultados.reduce((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {});
  const novoPaciente = async (telLocal) => {
    const id = randomUUID();
    await clienteAdmin.query(`insert into pacientes (id, clinica_id, nome, telefone) values ($1, $2, 'Paciente Corrida', $3)`, [id, clinica1, telLocal]);
    return { id, telefone: '55' + telLocal };
  };
  // `horasAtras`: idade do `concluido_em` (padrao 3h, dentro da janela);
  // `null` grava agendamento SEM `concluido_em` (fora da janela, falha fechado).
  const novoAgendamento = async (pacienteId, horario, horasAtras = 3) => {
    const id = randomUUID();
    await clienteAdmin.query(
      `insert into agendamentos (id, clinica_id, paciente_id, data, horario, status, procedimento_id, concluido_em)
       values ($1, $2, $3, current_date - 1, $4, 'concluido', 'proc-teste',
               case when $5::numeric is null then null else now() - make_interval(secs => ($5::numeric * 3600)::int) end)`,
      [id, clinica1, pacienteId, horario, horasAtras]
    );
    return id;
  };

  // (i) MESMO agendamento, telefone novo: exatamente UMA cria a linha
  // ('pendente'); a outra ve o lease vigente ('em_andamento') -- nunca duas
  // linhas, nunca duas mensagens (criterio de aceite 7).
  const pacCorrida = await novoPaciente('11999990009');
  const agCorrida = await novoAgendamento(pacCorrida.id, '13:30');
  const corridaMesmoAg = await Promise.allSettled([
    clienteA.query(INICIAR, [clinica1, agCorrida, pacCorrida.id, pacCorrida.telefone, 'satisfacao', false]),
    clienteB.query(INICIAR, [clinica1, agCorrida, pacCorrida.id, pacCorrida.telefone, 'satisfacao', false]),
  ]);
  const resMesmoAg = corridaMesmoAg.map(resultadoDe);
  log(`  (i) mesmo agendamento, corrida real: ${resMesmoAg.join(', ')}`);
  const cMesmoAg = contar(resMesmoAg);
  assert(cMesmoAg.pendente === 1 && cMesmoAg.em_andamento === 1, `B4 (mesmo agendamento): esperado {pendente:1, em_andamento:1}, veio ${JSON.stringify(cMesmoAg)}`);

  // (ii) DOIS agendamentos DIFERENTES do MESMO telefone novo, ao mesmo tempo:
  // exatamente UMA jornada nasce; a outra e barrada pelo indice parcial de
  // telefone ('conflito_telefone_ativo').
  const pacTel = await novoPaciente('11999990010');
  const agTelA = await novoAgendamento(pacTel.id, '14:00');
  const agTelB = await novoAgendamento(pacTel.id, '14:30');
  const corridaMesmoTel = await Promise.allSettled([
    clienteA.query(INICIAR, [clinica1, agTelA, pacTel.id, pacTel.telefone, 'satisfacao', false]),
    clienteB.query(INICIAR, [clinica1, agTelB, pacTel.id, pacTel.telefone, 'satisfacao', false]),
  ]);
  const resMesmoTel = corridaMesmoTel.map(resultadoDe);
  log(`  (ii) agendamentos diferentes, mesmo telefone, corrida real: ${resMesmoTel.join(', ')}`);
  const cMesmoTel = contar(resMesmoTel);
  assert(cMesmoTel.pendente === 1 && cMesmoTel.conflito_telefone_ativo === 1, `B4 (mesmo telefone): esperado {pendente:1, conflito_telefone_ativo:1}, veio ${JSON.stringify(cMesmoTel)}`);
  const jornadasDoTel = (await clienteAdmin.query('select count(*)::int n from pos_consulta_jornadas where clinica_id=$1 and telefone_normalizado=$2', [clinica1, pacTel.telefone])).rows[0].n;
  assert(jornadasDoTel === 1, `B4 (mesmo telefone): esperado exatamente 1 jornada gravada, ha ${jornadasDoTel}`);

  // (iii) sequencial: agendamento1 (B1) segue 'aguardando_inicio' para o
  // telefone de paciente1 -- agendamento2 (mesmo telefone) deve ser recusado.
  const resB4c = resultadoDe((await Promise.allSettled([
    clienteA.query(INICIAR, [clinica1, agendamento2, paciente1, telefone, 'satisfacao', false]),
  ]))[0]);
  assert(resB4c === 'conflito_telefone_ativo', `B4: esperado 'conflito_telefone_ativo' para agendamento2 (telefone ja ativo via agendamento1), veio '${resB4c}'`);
  log('  OK (B4): (i) mesmo agendamento => 1 pendente + 1 em_andamento; (ii) mesmo telefone => 1 pendente + 1 conflito, 1 jornada gravada; (iii) segundo agendamento do telefone ativo recusado.');

  // ── B2: IDENTIDADE ESTAVEL + FRONTEIRAS DE ENTREGA ─────────────────────
  log('\n[B2] Verificando identidade estavel (entrega_id) e fronteiras de entrega...');

  // (a) ANTES da entrega: a etapa NAO deve ter avancado so por ter reservado (b1).
  const linha1 = (await clienteAdmin.query('select etapa, entrega_claim_token, entrega_id from pos_consulta_jornadas where clinica_id=$1 and agendamento_id=$2', [clinica1, agendamento1])).rows[0];
  assert(linha1.etapa === 'aguardando_inicio', `B2a: esperado etapa 'aguardando_inicio' antes de confirmar, veio '${linha1.etapa}'`);
  log('  OK (B2a): reservar nao avanca a etapa por si so.');

  // (b) DURANTE -- simula queda: forca o lease a expirar (SO um teste com
  // privilegio elevado pode fazer isto -- nunca um caminho do Core) e
  // reclama.
  await clienteAdmin.query(`update pos_consulta_jornadas set entrega_lease_expira_em = now() - interval '1 second' where clinica_id=$1 and agendamento_id=$2`, [clinica1, agendamento1]);
  const reclaim = (await clienteA.query(INICIAR, [clinica1, agendamento1, paciente1, telefone, 'satisfacao', false])).rows[0].r;
  assert(reclaim.resultado === 'pendente', `B2b: esperado reclaim 'pendente', veio '${reclaim.resultado}'`);
  assert(reclaim.claim_token !== tokenAgendamento1, 'B2b: reclaim deveria gerar um claim_token NOVO');
  assert(
    reclaim.entrega_id === entregaIdAgendamento1,
    `B2b (segunda revisao): reclaim deveria PRESERVAR o mesmo entrega_id (${entregaIdAgendamento1}), veio '${reclaim.entrega_id}'`
  );
  log('  OK (B2b): reclaim apos lease expirado gera claim_token novo, mas preserva entrega_id (identidade estavel).');

  // (c) DEPOIS, antes do ack: token ANTIGO (pre-reclaim, ja substituido)
  // deve ser recusado.
  const confirmComTokenAntigo = (await clienteA.query(CONFIRMAR, [clinica1, agendamento1, tokenAgendamento1])).rows[0].r;
  assert(confirmComTokenAntigo.resultado === 'token_invalido', `B2c: token antigo deveria ser recusado, veio '${confirmComTokenAntigo.resultado}'`);
  log('  OK (B2c): claim_token obsoleto (substituido por reclaim) recusado sem efeito.');

  // (c.2, segunda revisao) -- token NOVO ainda bate, mas o LEASE ja
  // expirou de novo (outro worker pode estar reclamando agora): deve ser
  // recusado com 'lease_expirado', DISTINTO de 'token_invalido'.
  await clienteAdmin.query(`update pos_consulta_jornadas set entrega_lease_expira_em = now() - interval '1 second' where clinica_id=$1 and agendamento_id=$2`, [clinica1, agendamento1]);
  const confirmComLeaseExpirado = (await clienteA.query(CONFIRMAR, [clinica1, agendamento1, reclaim.claim_token])).rows[0].r;
  assert(
    confirmComLeaseExpirado.resultado === 'lease_expirado',
    `B2c.2: esperado 'lease_expirado' com token batendo mas lease vencido, veio '${confirmComLeaseExpirado.resultado}'`
  );
  log("  OK (B2c.2): token batendo mas lease vencido recusado como 'lease_expirado' (nunca 'token_invalido').");

  // Restaura o lease (simula que na verdade nao passou tanto tempo -- so
  // este teste precisava forcar o vencimento para provar o ramo acima) e
  // confirma de verdade.
  await clienteAdmin.query(`update pos_consulta_jornadas set entrega_lease_expira_em = now() + interval '60 seconds' where clinica_id=$1 and agendamento_id=$2`, [clinica1, agendamento1]);
  const confirmComTokenNovo = (await clienteA.query(CONFIRMAR, [clinica1, agendamento1, reclaim.claim_token])).rows[0].r;
  assert(confirmComTokenNovo.resultado === 'confirmada', `B2c: token novo, lease vigente, deveria confirmar, veio '${confirmComTokenNovo.resultado}'`);
  const linhaConfirmada = (await clienteAdmin.query('select etapa from pos_consulta_jornadas where clinica_id=$1 and agendamento_id=$2', [clinica1, agendamento1])).rows[0];
  assert(
    linhaConfirmada.etapa === 'aguardando_satisfacao',
    `B2c: confirmar_entrega deveria DERIVAR 'aguardando_satisfacao' (modo satisfacao, primeira entrega), veio '${linhaConfirmada.etapa}'`
  );
  log('  OK (B2c): token vigente confirma, e a RPC derivou a etapa de destino sozinha (nunca recebida do chamador).');

  // Confirmar de novo com o MESMO token deve ser recusado -- o token ja
  // foi limpo pela confirmacao anterior (nunca reaplica efeito).
  const confirmDeNovo = (await clienteA.query(CONFIRMAR, [clinica1, agendamento1, reclaim.claim_token])).rows[0].r;
  assert(confirmDeNovo.resultado === 'token_invalido', `B2c (replay): segunda confirmacao com o mesmo token deveria achar token ja limpo, veio '${confirmDeNovo.resultado}'`);
  log('  OK (B2c replay): segunda confirmacao nunca reaplica efeito.');

  // ── G: GOOGLE SO APOS SATISFACAO POSITIVA CONFIRMADA ────────────────────
  // Bloqueador 1 da revisao final do Codex: NENHUM modo envia o convite/link do
  // Google sem a satisfacao positiva confirmada. Provado no banco em tres
  // camadas: (G1) a primeira entrega nunca e convite; (G2/G3) as RPCs; (G4)
  // os CHECKs da propria tabela, que valem ate contra UPDATE direto do admin.
  log('\n[G] Verificando que NENHUM modo envia Google sem satisfacao positiva confirmada...');
  const REGISTRAR = `select cappia_pos_consulta_registrar_resposta_pendente($1,$2,$3,$4) as r`;
  let seqTel = 20;
  let seqHorario = 0;
  const proxTel = () => `119999900${String(seqTel++).padStart(2, '0')}`;
  const proxHorario = () => `15:${String(seqHorario++).padStart(2, '0')}`;
  const excecaoDe = async (cliente, sql, params) => {
    try {
      await cliente.query(sql, params);
      return null;
    } catch (e) {
      return e.message;
    }
  };
  const linhaDe = async (ag) =>
    (await clienteAdmin.query('select * from pos_consulta_jornadas where clinica_id=$1 and agendamento_id=$2', [clinica1, ag])).rows[0];
  // Cria e CONFIRMA a primeira entrega -> jornada em 'aguardando_satisfacao'.
  const jornadaAguardandoSatisfacao = async (modo) => {
    const pac = await novoPaciente(proxTel());
    const ag = await novoAgendamento(pac.id, proxHorario());
    const ini = (await clienteA.query(INICIAR, [clinica1, ag, pac.id, pac.telefone, modo, false])).rows[0].r;
    assert(ini.resultado === 'pendente', `G: esperado 'pendente' ao iniciar (modo ${modo}), veio '${ini.resultado}'`);
    const conf = (await clienteA.query(CONFIRMAR, [clinica1, ag, ini.claim_token])).rows[0].r;
    assert(conf.resultado === 'confirmada', `G: esperado 'confirmada' (modo ${modo}), veio '${conf.resultado}'`);
    return { pac, ag };
  };

  // G1 -- a PRIMEIRA entrega nunca pode ser convite, em NENHUM modo.
  for (const modo of ['satisfacao', 'google', 'ambos']) {
    const pac = await novoPaciente(proxTel());
    const ag = await novoAgendamento(pac.id, proxHorario());
    const msg = await excecaoDe(clienteA, INICIAR, [clinica1, ag, pac.id, pac.telefone, modo, true]);
    assert(msg !== null && /convite google/i.test(msg), `G1 (${modo}): iniciar_jornada com convite_pendente=true deveria ser RECUSADO, veio: ${msg}`);
    assert((await linhaDe(ag)) === undefined, `G1 (${modo}): a recusa nao pode deixar jornada gravada`);
  }
  log('  OK (G1): primeira entrega com convite recusada nos tres modos, sem deixar linha.');

  // G2 -- modo 'google' agora PERGUNTA primeiro: a confirmacao da primeira
  // entrega leva a 'aguardando_satisfacao' (antes: 'encerrada'), sem convite;
  // so a satisfacao POSITIVA autoriza e grava o convite.
  const jGoogle = await jornadaAguardandoSatisfacao('google');
  const gPrimeira = await linhaDe(jGoogle.ag);
  assert(
    gPrimeira.etapa === 'aguardando_satisfacao' && gPrimeira.modo === 'google' && gPrimeira.convite_google_em === null && gPrimeira.convite_pendente === false,
    `G2: modo google, primeira entrega confirmada, deveria estar 'aguardando_satisfacao' sem convite; veio ${JSON.stringify({ etapa: gPrimeira.etapa, convite_google_em: gPrimeira.convite_google_em })}`
  );
  const gReg = (await clienteA.query(REGISTRAR, [clinica1, jGoogle.ag, 'positiva', true])).rows[0].r;
  assert(gReg.resultado === 'pendente' && gReg.convite_pendente === true, `G2: positiva + convite no modo google deveria ser aceita, veio ${JSON.stringify(gReg)}`);
  const gConf = (await clienteA.query(CONFIRMAR, [clinica1, jGoogle.ag, gReg.claim_token])).rows[0].r;
  assert(gConf.resultado === 'confirmada', `G2: esperado 'confirmada', veio '${gConf.resultado}'`);
  const gFim = await linhaDe(jGoogle.ag);
  assert(
    gFim.etapa === 'encerrada' && gFim.classificacao === 'positiva' && gFim.convite_google_em !== null,
    `G2: apos a positiva confirmada, esperado 'encerrada' + convite gravado; veio ${JSON.stringify({ etapa: gFim.etapa, classificacao: gFim.classificacao })}`
  );
  log("  OK (G2): modo google pergunta primeiro; so a positiva confirmada autoriza e grava o convite.");

  // G3 -- as RPCs recusam convite fora de 'positiva' + modo com Google, e
  // nao deixam NADA gravado.
  const combosRecusadas = [
    ['google', 'nao_positiva'],
    ['google', 'incerta'],
    ['ambos', 'nao_positiva'],
    ['ambos', 'incerta'],
    ['satisfacao', 'positiva'],
    ['satisfacao', 'nao_positiva'],
  ];
  for (const [modo, classificacao] of combosRecusadas) {
    const j = await jornadaAguardandoSatisfacao(modo);
    const msg = await excecaoDe(clienteA, REGISTRAR, [clinica1, j.ag, classificacao, true]);
    assert(msg !== null && /convite google/i.test(msg), `G3 (${modo}/${classificacao}): convite deveria ser RECUSADO, veio: ${msg}`);
    const l = await linhaDe(j.ag);
    assert(
      l.etapa === 'aguardando_satisfacao' && l.convite_pendente === false && l.classificacao === null,
      `G3 (${modo}/${classificacao}): a recusa nao pode ter gravado nada; veio ${JSON.stringify({ etapa: l.etapa, classificacao: l.classificacao })}`
    );
  }
  const jSat = await jornadaAguardandoSatisfacao('satisfacao');
  const regSat = (await clienteA.query(REGISTRAR, [clinica1, jSat.ag, 'positiva', false])).rows[0].r;
  assert(regSat.resultado === 'pendente' && regSat.convite_pendente === false, `G3: satisfacao positiva SEM convite deveria seguir normalmente, veio ${JSON.stringify(regSat)}`);
  log('  OK (G3): convite recusado em 6 combinacoes invalidas (nada gravado); satisfacao sem convite segue normal.');

  // G4 -- os CHECKs da TABELA valem ate contra UPDATE direto (admin), inclusive
  // com classificacao NULL (um CHECK ingenuo passaria por NULL).
  const violaCheck = async (sql, params, ck) => {
    const msg = await excecaoDe(clienteAdmin, sql, params);
    assert(msg !== null && msg.includes(ck), `G4: esperado violar ${ck}, veio: ${msg}`);
  };
  const UPD = (set) => `update pos_consulta_jornadas set ${set} where clinica_id = $1 and agendamento_id = $2`;
  const pacI = await novoPaciente(proxTel());
  const agI = await novoAgendamento(pacI.id, proxHorario());
  assert((await clienteA.query(INICIAR, [clinica1, agI, pacI.id, pacI.telefone, 'ambos', false])).rows[0].r.resultado === 'pendente', 'G4: preparo (aguardando_inicio)');
  // (positiva + ambos satisfaz o CHECK de "so se positiva" -- isola o da primeira entrega)
  await violaCheck(UPD(`classificacao = 'positiva', convite_pendente = true`), [clinica1, agI], 'pos_consulta_jornadas_primeira_entrega_sem_convite_ck');
  const jNula = await jornadaAguardandoSatisfacao('ambos');
  await violaCheck(UPD(`convite_pendente = true`), [clinica1, jNula.ag], 'pos_consulta_jornadas_convite_so_se_positiva_ck'); // classificacao NULL
  await violaCheck(UPD(`classificacao = 'nao_positiva', convite_pendente = true`), [clinica1, jNula.ag], 'pos_consulta_jornadas_convite_so_se_positiva_ck');
  await violaCheck(UPD(`classificacao = 'incerta', convite_pendente = true`), [clinica1, jNula.ag], 'pos_consulta_jornadas_convite_so_se_positiva_ck');
  const jSatCk = await jornadaAguardandoSatisfacao('satisfacao');
  await violaCheck(UPD(`classificacao = 'positiva', convite_pendente = true`), [clinica1, jSatCk.ag], 'pos_consulta_jornadas_convite_so_se_positiva_ck'); // modo satisfacao
  await violaCheck(UPD(`convite_google_em = now()`), [clinica1, jNula.ag], 'pos_consulta_jornadas_convite_gravado_so_se_positiva_ck'); // classificacao NULL
  await violaCheck(UPD(`classificacao = 'nao_positiva', convite_google_em = now()`), [clinica1, jNula.ag], 'pos_consulta_jornadas_convite_gravado_so_se_positiva_ck');
  await violaCheck(UPD(`classificacao = 'positiva', convite_google_em = now()`), [clinica1, jSatCk.ag], 'pos_consulta_jornadas_convite_gravado_so_se_positiva_ck'); // modo satisfacao
  log('  OK (G4): os tres CHECKs da tabela barram convite/registro de convite sem positiva+modo com Google (inclusive classificacao NULL e UPDATE direto).');

  // ── J: JANELA MAXIMA DE IDADE ───────────────────────────────────────────
  // Bloqueador 2 da revisao final do Codex.
  log('\n[J] Verificando a janela maxima de idade (48h a partir de concluido_em)...');
  const janelaMin = (await clienteA.query('select cappia_pos_consulta_janela_maxima_minutos() as m')).rows[0].m;
  assert(janelaMin === 2880, `J: a janela deveria ser 2880 min (48h), veio ${janelaMin}`);
  let anonJanelaNegado = false;
  try {
    await clienteAnon.query('select cappia_pos_consulta_janela_maxima_minutos()');
  } catch (e) {
    anonJanelaNegado = /permission denied/i.test(e.message);
  }
  assert(anonJanelaNegado, 'J: anon deveria receber permission denied na funcao da janela');

  // J1 -- iniciar_jornada (autoritativo, sob lock): dentro da janela cria;
  // fora, ou sem concluido_em, recusa com 'fora_da_janela' e NAO grava linha.
  const casosJanela = [
    { rotulo: '47h (dentro)', horas: 47, esperado: 'pendente' },
    { rotulo: '49h (fora)', horas: 49, esperado: 'fora_da_janela' },
    { rotulo: 'sem concluido_em (fora, falha fechado)', horas: null, esperado: 'fora_da_janela' },
  ];
  for (const caso of casosJanela) {
    const pac = await novoPaciente(proxTel());
    const ag = await novoAgendamento(pac.id, proxHorario(), caso.horas);
    const r = (await clienteA.query(INICIAR, [clinica1, ag, pac.id, pac.telefone, 'ambos', false])).rows[0].r;
    assert(r.resultado === caso.esperado, `J1 (${caso.rotulo}): esperado '${caso.esperado}', veio '${r.resultado}'`);
    const l = await linhaDe(ag);
    assert((l !== undefined) === (caso.esperado === 'pendente'), `J1 (${caso.rotulo}): linha gravada apenas quando dentro da janela`);
  }
  log('  OK (J1): dentro da janela cria; fora da janela ou sem concluido_em recusa, sem gravar nada.');

  // J2 -- RECLAIM tambem e uma autorizacao de entrega: fora da janela, nao;
  // de volta para dentro da janela, o reclaim volta a funcionar.
  const pacRec = await novoPaciente(proxTel());
  const agRec = await novoAgendamento(pacRec.id, proxHorario());
  const iniRec = (await clienteA.query(INICIAR, [clinica1, agRec, pacRec.id, pacRec.telefone, 'ambos', false])).rows[0].r;
  assert(iniRec.resultado === 'pendente', 'J2: preparo');
  await clienteAdmin.query(
    `update pos_consulta_jornadas set entrega_lease_expira_em = now() - interval '1 second' where clinica_id=$1 and agendamento_id=$2`,
    [clinica1, agRec]
  );
  await clienteAdmin.query(`update agendamentos set concluido_em = now() - interval '60 hours' where id = $1`, [agRec]);
  const recFora = (await clienteA.query(INICIAR, [clinica1, agRec, pacRec.id, pacRec.telefone, 'ambos', false])).rows[0].r;
  assert(recFora.resultado === 'fora_da_janela', `J2: reclaim fora da janela deveria ser 'fora_da_janela', veio '${recFora.resultado}'`);
  const lRec = await linhaDe(agRec);
  assert(lRec.entrega_claim_token === iniRec.claim_token, 'J2: a recusa nao pode ter girado o claim_token');
  await clienteAdmin.query(`update agendamentos set concluido_em = now() - interval '3 hours' where id = $1`, [agRec]);
  const recDentro = (await clienteA.query(INICIAR, [clinica1, agRec, pacRec.id, pacRec.telefone, 'ambos', false])).rows[0].r;
  assert(recDentro.resultado === 'pendente' && recDentro.claim_token !== iniRec.claim_token, `J2: reclaim dentro da janela deveria funcionar, veio ${JSON.stringify(recDentro)}`);
  log('  OK (J2): reclaim fora da janela recusado (token intacto); dentro da janela segue normal.');

  // ── E1/E3: cappia_pos_consulta_candidatos ──────────────────────────────
  // ATENCAO -- ao contrario das fixtures de B1-B4 (que deliberadamente
  // NUNCA gravam `agendamentos.concluido_em`, por causa da incerteza de
  // schema registrada no achado B5), este bloco PRECISA gravar
  // `concluido_em`: a elegibilidade de `cappia_pos_consulta_candidatos` e
  // baseada em tempo, entao nao ha como testar sem essa coluna. Essa
  // dependencia ja existe na propria RPC (nao e nova deste teste) -- se
  // `concluido_em` nao existir ou tiver outro nome no ambiente de teste, o `--aplicar`
  // desta migration ja falharia na criacao da funcao, antes mesmo de
  // chegar neste bloco. Mesma logica para `clinicas.whatsapp_instancia`
  // (inferida do node real de producao "Buscar Clinica -- Chat Manual",
  // nao verificada contra o schema nesta sessao -- ver comentario de E1 na
  // migration).
  log('\n[E1/E3] Verificando cappia_pos_consulta_candidatos (pre-filtro, D3/E1)...');

  const clinica3 = randomUUID(); // elegivel: pos_consulta ligado, prazo vencido
  const clinica4 = randomUUID(); // NAO elegivel: pos_consulta_tipo = 'nenhum'
  todasClinicas.push(clinica3, clinica4);
  const paciente3 = randomUUID();
  const paciente4 = randomUUID();
  const agendamentoElegivel = randomUUID();
  const agendamentoPrazoNaoVencido = randomUUID();
  const agendamentoConfigDesligada = randomUUID();

  // E1 -- ACHADO AO RODAR CONTRA O SCHEMA OPERACIONAL: `clinicas.instancia_whatsapp`
  // e uma coluna GERADA (= `whatsapp_instancia`, migrations-legado). No
  // operacional as duas SAO SEMPRE IGUAIS -- nao existe como gravar valores
  // diferentes nelas, entao "testar com valores diferentes" e impossivel NESTE
  // nivel. O que da para provar aqui: (1) cada campo devolvido pela RPC bate
  // com a coluna homonima da tabela; (2) o mapeamento no CORPO da funcao esta
  // certo (cada coluna sob o proprio nome, sem troca). O teste com valores
  // DIFERENTES vive no nivel do payload do n8n (onde os dois campos podem
  // divergir) -- src/core/pos-consulta-n8n-instancias.test.ts.
  const instanciaFixture = `evo-${marcador}`;

  await clienteAdmin.query('begin');
  await clienteAdmin.query(
    `insert into clinicas (id, provider, nome, email, slug, whatsapp_instancia, automatizacoes) values
       ($1, 'teste-pos-consulta', 'Clinica Teste 3', 'c3-' || $3 || '@teste.invalid', 'c3-' || $3, $4, $5::jsonb),
       ($2, 'teste-pos-consulta', 'Clinica Teste 4', 'c4-' || $3 || '@teste.invalid', 'c4-' || $3, $4 || '-4', $6::jsonb)`,
    [
      clinica3,
      clinica4,
      marcador,
      instanciaFixture,
      JSON.stringify({ pos_consulta_tipo: 'google', pos_consulta_tempo: '2h', pos_consulta_google_link: 'https://g.page/r/x' }),
      JSON.stringify({ pos_consulta_tipo: 'nenhum' }),
    ]
  );
  await clienteAdmin.query(
    `insert into pacientes (id, clinica_id, nome, telefone) values ($1, $2, 'Paciente Teste 3', $3), ($4, $5, 'Paciente Teste 4', $6)`,
    [paciente3, clinica3, '11999990001', paciente4, clinica4, '11999990002']
  );
  await clienteAdmin.query(
    `insert into agendamentos (id, clinica_id, paciente_id, data, horario, status, procedimento_id, concluido_em) values
       ($1, $2, $3, current_date - 1, '09:00', 'concluido', 'proc-teste', now() - interval '3 hours'),
       ($4, $2, $3, current_date - 1, '09:30', 'concluido', 'proc-teste', now() - interval '30 minutes'),
       ($5, $6, $7, current_date - 1, '10:00', 'concluido', 'proc-teste', now() - interval '3 hours')`,
    [agendamentoElegivel, clinica3, paciente3, agendamentoPrazoNaoVencido, agendamentoConfigDesligada, clinica4, paciente4]
  );
  // J3 -- janela maxima no pre-filtro: 47h (dentro) aparece; 49h (fora) nao.
  // Clinica 3 tem prazo de 2h, entao ambos ja passaram do prazo.
  const agendamentoDentroJanela = randomUUID();
  const agendamentoForaJanela = randomUUID();
  await clienteAdmin.query(
    `insert into agendamentos (id, clinica_id, paciente_id, data, horario, status, procedimento_id, concluido_em) values
       ($1, $3, $4, current_date - 3, '08:00', 'concluido', 'proc-teste', now() - interval '47 hours'),
       ($2, $3, $4, current_date - 3, '08:30', 'concluido', 'proc-teste', now() - interval '49 hours')`,
    [agendamentoDentroJanela, agendamentoForaJanela, clinica3, paciente3]
  );
  await clienteAdmin.query('commit');

  const candidatos = (await clienteA.query('select * from cappia_pos_consulta_candidatos(200)')).rows;
  const porAgendamento = Object.fromEntries(candidatos.map((c) => [c.agendamento_id, c]));

  // Positivo -- E1: os dois campos de instancia existem, sob nomes distintos, e
  // cada um bate com a coluna homonima da tabela.
  const candidatoElegivel = porAgendamento[agendamentoElegivel];
  assert(candidatoElegivel !== undefined, 'E1/E3: agendamento elegivel (prazo vencido, pos_consulta ligado) deveria aparecer como candidato');
  assert('instancia_whatsapp' in candidatoElegivel && 'whatsapp_instancia' in candidatoElegivel, 'E1: a RPC precisa devolver OS DOIS campos, sob nomes distintos');
  const colunas = (await clienteAdmin.query('select instancia_whatsapp, whatsapp_instancia from clinicas where id = $1', [clinica3])).rows[0];
  assert(
    candidatoElegivel.instancia_whatsapp === colunas.instancia_whatsapp,
    `E1: 'instancia_whatsapp' devolvido ('${candidatoElegivel.instancia_whatsapp}') deveria bater com clinicas.instancia_whatsapp ('${colunas.instancia_whatsapp}')`
  );
  assert(
    candidatoElegivel.whatsapp_instancia === colunas.whatsapp_instancia,
    `E1: 'whatsapp_instancia' devolvido ('${candidatoElegivel.whatsapp_instancia}') deveria bater com clinicas.whatsapp_instancia ('${colunas.whatsapp_instancia}')`
  );
  log(`  OK (E1): dois campos distintos devolvidos, cada um igual a coluna homonima (valores iguais entre si SO porque instancia_whatsapp e coluna gerada no operacional: '${colunas.whatsapp_instancia}').`);

  // E1 -- mapeamento no corpo da funcao (pega troca de colunas mesmo com
  // valores iguais): cada coluna sob o PROPRIO nome.
  const defFuncao = (await clienteAdmin.query(`select pg_get_functiondef('public.cappia_pos_consulta_candidatos(integer)'::regprocedure) as d`)).rows[0].d;
  const normalizada = defFuncao.replace(/\s+/g, ' ').toLowerCase();
  assert(normalizada.includes('c.instancia_whatsapp as instancia_whatsapp'), "E1: o corpo da RPC deve selecionar 'c.instancia_whatsapp as instancia_whatsapp'");
  assert(normalizada.includes('c.whatsapp_instancia as whatsapp_instancia'), "E1: o corpo da RPC deve selecionar 'c.whatsapp_instancia as whatsapp_instancia'");
  log('  OK (E1): mapeamento no corpo da funcao confere (cada coluna sob o proprio nome).');

  // Negativo 1 -- prazo (2h) ainda nao vencido (concluido ha so 30min): NUNCA candidato.
  assert(
    porAgendamento[agendamentoPrazoNaoVencido] === undefined,
    'E3: agendamento com prazo de 2h ainda nao vencido (concluido ha 30min) nao deveria aparecer como candidato'
  );
  log('  OK (E3): agendamento com prazo ainda nao vencido excluido corretamente.');

  // Negativo 2 -- pos_consulta_tipo = 'nenhum' (config desligada): NUNCA candidato,
  // mesmo com o prazo (se houvesse um) ja vencido.
  assert(
    porAgendamento[agendamentoConfigDesligada] === undefined,
    "E3: agendamento de clinica com pos_consulta_tipo='nenhum' nao deveria aparecer como candidato"
  );
  log("  OK (E3): agendamento de clinica com pos_consulta desligado excluido corretamente.");

  // J3 -- janela maxima de idade no pre-filtro.
  assert(porAgendamento[agendamentoDentroJanela] !== undefined, 'J3: agendamento concluido ha 47h (dentro da janela de 48h) deveria aparecer como candidato');
  assert(porAgendamento[agendamentoForaJanela] === undefined, 'J3: agendamento concluido ha 49h (fora da janela de 48h) NAO deveria aparecer como candidato');
  const defCandidatos = (await clienteAdmin.query(`select pg_get_functiondef('public.cappia_pos_consulta_candidatos(integer)'::regprocedure) as d`)).rows[0].d;
  assert(/cappia_pos_consulta_janela_maxima_minutos/.test(defCandidatos), 'J3: o corpo de candidatos deve usar a funcao unica da janela');
  log('  OK (J3): candidatos exclui agendamento fora da janela (49h) e inclui o de 47h.');

  // ── R: RECUPERACAO DE ENTREGAS PENDENTES COM LEASE VENCIDO ─────────────────
  // Sexta revisao do Codex, bloqueador 1: jornadas em 'aguardando_inicio' ou
  // 'finalizando' com o lease vencido NAO podem ficar orfas. Usa a clinica 3
  // (pos_consulta LIGADO) porque `candidatos` so lista clinicas com a automacao ligada.
  log('\n[R] Verificando a recuperacao de entregas pendentes (aguardando_inicio e finalizando)...');
  const RECUPERAR = `select cappia_pos_consulta_recuperar_entrega($1,$2,$3,$4) as r`;
  let seqTelR = 0;
  let seqHorR = 0;
  const pacR = async () => {
    const id = randomUUID();
    const telLocal = `119999901${String(seqTelR++).padStart(2, '0')}`;
    await clienteAdmin.query(`insert into pacientes (id, clinica_id, nome, telefone) values ($1, $2, 'Paciente Recuperacao', $3)`, [id, clinica3, telLocal]);
    return { id, telefone: '55' + telLocal, telLocal };
  };
  const agR = async (pacienteId, horasAtras = 3) => {
    const id = randomUUID();
    await clienteAdmin.query(
      `insert into agendamentos (id, clinica_id, paciente_id, data, horario, status, procedimento_id, concluido_em)
       values ($1, $2, $3, current_date - 1, $4, 'concluido', 'proc-teste', now() - make_interval(secs => ($5::numeric * 3600)::int))`,
      [id, clinica3, pacienteId, `16:${String(seqHorR++).padStart(2, '0')}`, horasAtras]
    );
    return id;
  };
  const linhaR = async (ag) => (await clienteAdmin.query('select * from pos_consulta_jornadas where clinica_id=$1 and agendamento_id=$2', [clinica3, ag])).rows[0];
  const expirarR = (ag) => clienteAdmin.query(`update pos_consulta_jornadas set entrega_lease_expira_em = now() - interval '1 second' where clinica_id=$1 and agendamento_id=$2`, [clinica3, ag]);
  const listaR = async () => (await clienteA.query('select * from cappia_pos_consulta_candidatos(200)')).rows;
  const naListaComo = async (ag) => (await listaR()).filter((c) => c.agendamento_id === ag).map((c) => c.acao_edge);
  const recuperarR = async (ag, pac, telefone = pac.telefone, pacienteId = pac.id) =>
    (await clienteA.query(RECUPERAR, [clinica3, ag, pacienteId, telefone])).rows[0].r;
  // pendencia da PRIMEIRA entrega (aguardando_inicio)
  const pendenciaInicial = async (modo = 'ambos', horasAtras = 3) => {
    const pac = await pacR();
    const ag = await agR(pac.id, horasAtras);
    const ini = (await clienteA.query(INICIAR, [clinica3, ag, pac.id, pac.telefone, modo, false])).rows[0].r;
    assert(ini.resultado === 'pendente', `R: preparo -- esperado 'pendente', veio '${ini.resultado}'`);
    return { pac, ag, ini };
  };

  // R1 -- aguardando_inicio: fora de lista com o lease vigente; listada como 'recuperar'
  // ao vencer; a recuperacao reclama a MESMA entrega e a confirmacao segue o fluxo normal.
  const r1 = await pendenciaInicial();
  assert((await naListaComo(r1.ag)).length === 0, 'R1: com o lease VIGENTE a jornada nao deve ser candidata');
  await expirarR(r1.ag);
  assert(JSON.stringify(await naListaComo(r1.ag)) === JSON.stringify(['recuperar']), "R1: com o lease vencido deve aparecer UMA vez, como 'recuperar'");
  const r1Linha = (await listaR()).find((c) => c.agendamento_id === r1.ag);
  assert(r1Linha.instancia_whatsapp && r1Linha.whatsapp_instancia && r1Linha.clinica_id === clinica3 && r1Linha.paciente_id === r1.pac.id, 'R1: a linha de recuperacao traz as mesmas colunas de um candidato novo');
  const r1Rec = await recuperarR(r1.ag, r1.pac);
  assert(r1Rec.resultado === 'pendente' && r1Rec.etapa === 'aguardando_inicio', `R1: esperado pendente/aguardando_inicio, veio ${JSON.stringify(r1Rec)}`);
  assert(r1Rec.entrega_id === r1.ini.entrega_id, 'R1: a recuperacao deve PRESERVAR o entrega_id');
  assert(r1Rec.claim_token !== r1.ini.claim_token && r1Rec.tentativa === 2, `R1: token novo e tentativa 2, veio ${JSON.stringify(r1Rec)}`);
  assert((await naListaComo(r1.ag)).length === 0, 'R1: depois de reclamada (lease vigente) sai da lista');
  const r1Conf = (await clienteA.query(CONFIRMAR, [clinica3, r1.ag, r1Rec.claim_token])).rows[0].r;
  const r1Fim = await linhaR(r1.ag);
  assert(r1Conf.resultado === 'confirmada' && r1Fim.etapa === 'aguardando_satisfacao', `R1: confirmar apos recuperar deve levar a aguardando_satisfacao, veio ${JSON.stringify({ r1Conf, etapa: r1Fim.etapa })}`);
  assert(r1Fim.entrega_tentativas === 1 && r1Fim.encerramento_motivo === null, 'R1: a confirmacao reinicia a contagem de tentativas (trigger) e nao grava motivo de encerramento');
  log('  OK (R1): aguardando_inicio -- listada so com o lease vencido, reclama a MESMA entrega e confirma normalmente.');

  // R2 -- finalizando: a segunda entrega (agradecimento/convite) tambem e recuperada,
  // com classificacao e convite_pendente PRESERVADOS.
  const pacR2 = await pacR();
  const agR2 = await agR(pacR2.id);
  const iniR2 = (await clienteA.query(INICIAR, [clinica3, agR2, pacR2.id, pacR2.telefone, 'google', false])).rows[0].r;
  assert((await clienteA.query(CONFIRMAR, [clinica3, agR2, iniR2.claim_token])).rows[0].r.resultado === 'confirmada', 'R2: preparo (primeira entrega)');
  const regR2 = (await clienteA.query(REGISTRAR, [clinica3, agR2, 'positiva', true])).rows[0].r;
  assert(regR2.resultado === 'pendente' && regR2.convite_pendente === true, 'R2: preparo (segunda entrega pendente)');
  assert((await linhaR(agR2)).entrega_tentativas === 1, 'R2: uma NOVA entrega comeca com 1 tentativa (trigger)');
  await expirarR(agR2);
  assert(JSON.stringify(await naListaComo(agR2)) === JSON.stringify(['recuperar']), "R2: 'finalizando' com lease vencido tambem e listada como 'recuperar'");
  const r2Rec = await recuperarR(agR2, pacR2);
  assert(r2Rec.resultado === 'pendente' && r2Rec.etapa === 'finalizando' && r2Rec.classificacao === 'positiva' && r2Rec.convite_pendente === true && r2Rec.modo === 'google', `R2: finalizando reclamada com decisao preservada, veio ${JSON.stringify(r2Rec)}`);
  assert(r2Rec.entrega_id === regR2.entrega_id && r2Rec.tentativa === 2, 'R2: mesma entrega, tentativa 2');
  const r2Conf = (await clienteA.query(CONFIRMAR, [clinica3, agR2, r2Rec.claim_token])).rows[0].r;
  const r2Fim = await linhaR(agR2);
  assert(r2Conf.resultado === 'confirmada' && r2Fim.etapa === 'encerrada' && r2Fim.convite_google_em !== null, `R2: confirmar apos recuperar encerra e grava o convite, veio ${JSON.stringify({ r2Conf, etapa: r2Fim.etapa })}`);
  log('  OK (R2): finalizando -- recuperada com classificacao e convite preservados; a confirmacao encerra e grava o convite.');

  // R3 -- tentativas limitadas: 1 (inicial) + 2 recuperacoes; a terceira recuperacao ENCERRA
  // sem mensagem e LIBERA o telefone.
  const r3 = await pendenciaInicial();
  for (const esperada of [2, 3]) {
    await expirarR(r3.ag);
    const rec = await recuperarR(r3.ag, r3.pac);
    assert(rec.resultado === 'pendente' && rec.tentativa === esperada, `R3: esperado pendente/tentativa ${esperada}, veio ${JSON.stringify(rec)}`);
  }
  await expirarR(r3.ag);
  const r3Abandono = await recuperarR(r3.ag, r3.pac);
  assert(r3Abandono.resultado === 'abandonada' && r3Abandono.motivo === 'abandonada_tentativas', `R3: apos 3 tentativas deveria abandonar, veio ${JSON.stringify(r3Abandono)}`);
  const r3Linha = await linhaR(r3.ag);
  assert(r3Linha.etapa === 'encerrada' && r3Linha.encerramento_motivo === 'abandonada_tentativas' && r3Linha.entrega_claim_token === null && r3Linha.entrega_id === null && r3Linha.convite_google_em === null, `R3: jornada abandonada deve estar encerrada, sem token/entrega e sem convite, veio ${JSON.stringify(r3Linha)}`);
  assert((await naListaComo(r3.ag)).length === 0, 'R3: abandonada nunca volta a ser candidata');
  const r3Novo = await agR(r3.pac.id);
  const r3Livre = (await clienteA.query(INICIAR, [clinica3, r3Novo, r3.pac.id, r3.pac.telefone, 'ambos', false])).rows[0].r;
  assert(r3Livre.resultado === 'pendente', `R3: o telefone deve ter sido LIBERADO (nova jornada), veio '${r3Livre.resultado}'`);
  log("  OK (R3): 3 tentativas, depois abandono sem mensagem ('abandonada_tentativas') -- o telefone e liberado.");

  // R4 -- janela: pendencia orfa fora da janela e ENCERRADA (nunca reenviada) e libera o telefone.
  const r4 = await pendenciaInicial();
  await expirarR(r4.ag);
  await clienteAdmin.query(`update agendamentos set concluido_em = now() - interval '60 hours' where id = $1`, [r4.ag]);
  assert(JSON.stringify(await naListaComo(r4.ag)) === JSON.stringify(['recuperar']), 'R4: fora da janela continua listada -- para ser encerrada, nunca esquecida');
  const r4Res = await recuperarR(r4.ag, r4.pac);
  assert(r4Res.resultado === 'abandonada' && r4Res.motivo === 'abandonada_janela', `R4: esperado abandonada_janela, veio ${JSON.stringify(r4Res)}`);
  assert((await linhaR(r4.ag)).etapa === 'encerrada' && (await naListaComo(r4.ag)).length === 0, 'R4: encerrada e fora da lista');
  log("  OK (R4): pendencia fora da janela de 48 h e encerrada sem mensagem ('abandonada_janela').");

  // R5 -- vinculo: paciente/telefone oficial que nao batem com o snapshot NUNCA recebem a mensagem.
  const r5a = await pendenciaInicial();
  await expirarR(r5a.ag);
  const r5aRes = await recuperarR(r5a.ag, r5a.pac, '5511888887777');
  assert(r5aRes.resultado === 'abandonada' && r5aRes.motivo === 'abandonada_vinculo_invalido', `R5a: telefone diferente do snapshot deveria abandonar, veio ${JSON.stringify(r5aRes)}`);
  const r5b = await pendenciaInicial();
  await expirarR(r5b.ag);
  const r5bRes = await recuperarR(r5b.ag, r5b.pac, null);
  assert(r5bRes.resultado === 'abandonada' && r5bRes.motivo === 'abandonada_vinculo_invalido', `R5b: telefone ausente deveria abandonar, veio ${JSON.stringify(r5bRes)}`);
  const r5c = await pendenciaInicial();
  await expirarR(r5c.ag);
  const r5cRes = await recuperarR(r5c.ag, r5c.pac, r5c.pac.telefone, randomUUID());
  assert(r5cRes.resultado === 'abandonada' && r5cRes.motivo === 'abandonada_vinculo_invalido', `R5c: paciente diferente deveria abandonar, veio ${JSON.stringify(r5cRes)}`);
  const r5d = await pendenciaInicial();
  await expirarR(r5d.ag);
  await clienteAdmin.query(`update pacientes set telefone = '11888887777' where id = $1`, [r5d.pac.id]); // o telefone OFICIAL mudou depois da jornada
  const r5dRes = await recuperarR(r5d.ag, r5d.pac, '5511888887777');
  assert(r5dRes.resultado === 'abandonada' && r5dRes.motivo === 'abandonada_vinculo_invalido', `R5d: telefone oficial trocado apos a jornada deveria abandonar (nunca enviar ao numero novo), veio ${JSON.stringify(r5dRes)}`);
  log("  OK (R5): telefone/paciente divergentes, ausentes ou trocados -> 'abandonada_vinculo_invalido' (nada enviado a outro numero).");

  // R6/R7 -- estados em que a recuperacao nao faz nada.
  const r6 = await pendenciaInicial();
  const r6Res = await recuperarR(r6.ag, r6.pac);
  assert(r6Res.resultado === 'em_andamento', `R6: lease vigente -> em_andamento, veio ${JSON.stringify(r6Res)}`);
  assert((await linhaR(r6.ag)).entrega_claim_token === r6.ini.claim_token, 'R6: em_andamento nao pode girar o token');
  assert(r1Fim.etapa === 'aguardando_satisfacao', 'R7: preparo');
  const r7a = await recuperarR(r1.ag, r1.pac);
  assert(r7a.resultado === 'nao_pendente' && r7a.etapa === 'aguardando_satisfacao', `R7a: aguardando_satisfacao nao e pendencia de entrega, veio ${JSON.stringify(r7a)}`);
  const r7b = await recuperarR(agR2, pacR2);
  assert(r7b.resultado === 'nao_pendente' && r7b.etapa === 'encerrada', `R7b: encerrada, veio ${JSON.stringify(r7b)}`);
  const r7c = (await clienteA.query(RECUPERAR, [clinica3, randomUUID(), r1.pac.id, r1.pac.telefone])).rows[0].r;
  assert(r7c.resultado === 'jornada_nao_encontrada', `R7c: sem jornada, veio ${JSON.stringify(r7c)}`);
  log('  OK (R6/R7): lease vigente, aguardando_satisfacao, encerrada e sem jornada -> a recuperacao nao faz nada.');

  // R8 -- AUTOMACAO DESLIGADA (setima revisao, item 2): a clinica que desligou o pos-consulta NAO
  // recebe mensagem, mas a pendencia e ENCERRADA em silencio e o telefone liberado. A jornada
  // continua LISTADA (senao ficaria orfa) e quem encerra e a RPC.
  const pacDesl = randomUUID();
  await clienteAdmin.query(`insert into pacientes (id, clinica_id, nome, telefone) values ($1, $2, 'Paciente Desligado', '11999990300')`, [pacDesl, clinica4]);
  const agDesl = randomUUID();
  await clienteAdmin.query(
    `insert into agendamentos (id, clinica_id, paciente_id, data, horario, status, procedimento_id, concluido_em)
     values ($1, $2, $3, current_date - 1, '17:00', 'concluido', 'proc-teste', now() - interval '3 hours')`,
    [agDesl, clinica4, pacDesl]
  );
  const iniDesl = (await clienteA.query(INICIAR, [clinica4, agDesl, pacDesl, '5511999990300', 'ambos', false])).rows[0].r;
  assert(iniDesl.resultado === 'pendente', 'R8: preparo');
  await clienteAdmin.query(`update pos_consulta_jornadas set entrega_lease_expira_em = now() - interval '1 second' where clinica_id=$1 and agendamento_id=$2`, [clinica4, agDesl]);
  assert(JSON.stringify((await listaR()).filter((c) => c.agendamento_id === agDesl).map((c) => c.acao_edge)) === JSON.stringify(['recuperar']), "R8: clinica com pos_consulta='nenhum' CONTINUA listada como 'recuperar' (para ser encerrada, nunca esquecida)");
  const r8Res = (await clienteA.query(RECUPERAR, [clinica4, agDesl, pacDesl, '5511999990300'])).rows[0].r;
  assert(r8Res.resultado === 'abandonada' && r8Res.motivo === 'abandonada_automacao_desligada', `R8: esperado abandonada_automacao_desligada, veio ${JSON.stringify(r8Res)}`);
  const r8Linha = (await clienteAdmin.query('select * from pos_consulta_jornadas where clinica_id=$1 and agendamento_id=$2', [clinica4, agDesl])).rows[0];
  assert(r8Linha.etapa === 'encerrada' && r8Linha.encerramento_motivo === 'abandonada_automacao_desligada' && r8Linha.entrega_claim_token === null && r8Linha.convite_google_em === null, `R8: encerrada em silencio, sem token e sem convite, veio ${JSON.stringify({ etapa: r8Linha.etapa, motivo: r8Linha.encerramento_motivo })}`);
  const agDesl2 = randomUUID();
  await clienteAdmin.query(
    `insert into agendamentos (id, clinica_id, paciente_id, data, horario, status, procedimento_id, concluido_em)
     values ($1, $2, $3, current_date - 1, '17:10', 'concluido', 'proc-teste', now() - interval '3 hours')`,
    [agDesl2, clinica4, pacDesl]
  );
  assert((await clienteA.query(INICIAR, [clinica4, agDesl2, pacDesl, '5511999990300', 'ambos', false])).rows[0].r.resultado === 'pendente', 'R8: o telefone deve ter sido LIBERADO');
  // chave ausente ou com valor invalido tambem conta como desligada; ligada-mas-INCOMPLETA nao encerra
  for (const [rotulo, automatizacoes, esperado] of [
    ['sem a chave pos_consulta_tipo', {}, 'abandonada'],
    ['valor invalido', { pos_consulta_tipo: 'xyz' }, 'abandonada'],
    ['tipo nenhum', { pos_consulta_tipo: 'nenhum' }, 'abandonada'],
    ['ligada porem INCOMPLETA (sem tempo nem link)', { pos_consulta_tipo: 'google' }, 'pendente'],
  ]) {
    const p = await pendenciaInicial();
    await expirarR(p.ag);
    const original = (await clienteAdmin.query('select automatizacoes from clinicas where id=$1', [clinica3])).rows[0].automatizacoes;
    await clienteAdmin.query('update clinicas set automatizacoes = $2::jsonb where id = $1', [clinica3, JSON.stringify(automatizacoes)]);
    let res;
    try {
      res = await recuperarR(p.ag, p.pac);
    } finally {
      await clienteAdmin.query('update clinicas set automatizacoes = $2::jsonb where id = $1', [clinica3, JSON.stringify(original)]);
    }
    assert(res.resultado === esperado, `R8 (${rotulo}): esperado '${esperado}', veio ${JSON.stringify(res)}`);
    if (esperado === 'abandonada') assert(res.motivo === 'abandonada_automacao_desligada', `R8 (${rotulo}): motivo ${res.motivo}`);
  }
  log("  OK (R8): automacao desligada (tipo nenhum/ausente/invalido) -> continua listada e e ENCERRADA em silencio ('abandonada_automacao_desligada'), telefone liberado; ligada-mas-incompleta NAO encerra.");

  // R11 -- VINCULO ROMPIDO (setima revisao, item 1): se o agendamento ou o paciente mudou de
  // CLINICA/vinculo, a jornada NAO pode sumir da lista por um JOIN -- tem que ser alcancada e
  // encerrada por `abandonada_vinculo_invalido` (nunca enviada).
  const r11a = await pendenciaInicial();
  await expirarR(r11a.ag);
  await clienteAdmin.query(`update agendamentos set clinica_id = $2 where id = $1`, [r11a.ag, clinica4]); // o agendamento mudou de clinica
  const r11aLista = (await listaR()).filter((c) => c.agendamento_id === r11a.ag);
  assert(r11aLista.length === 1 && r11aLista[0].acao_edge === 'recuperar' && r11aLista[0].clinica_id === clinica3, `R11a: a jornada deve continuar listada (na clinica DELA), veio ${JSON.stringify(r11aLista.map((c) => [c.acao_edge, c.clinica_id]))}`);
  assert(r11aLista[0].procedimento_nome_exibido === null && r11aLista[0].dentista_nome_exibido === null, 'R11a: nomes cosmeticos NAO podem vir de um agendamento de OUTRA clinica');
  assert(r11aLista[0].instancia_whatsapp && r11aLista[0].whatsapp_instancia, 'R11a: as instancias sao as da clinica da jornada');
  const r11aRes = await recuperarR(r11a.ag, r11a.pac);
  assert(r11aRes.resultado === 'abandonada' && r11aRes.motivo === 'abandonada_vinculo_invalido', `R11a: esperado abandonada_vinculo_invalido, veio ${JSON.stringify(r11aRes)}`);
  assert((await linhaR(r11a.ag)).etapa === 'encerrada', 'R11a: encerrada');

  const r11b = await pendenciaInicial();
  await expirarR(r11b.ag);
  await clienteAdmin.query(`update pacientes set clinica_id = $2 where id = $1`, [r11b.pac.id, clinica4]); // o PACIENTE mudou de clinica
  assert(JSON.stringify(await naListaComo(r11b.ag)) === JSON.stringify(['recuperar']), 'R11b: continua listada');
  const r11bRes = await recuperarR(r11b.ag, r11b.pac);
  assert(r11bRes.resultado === 'abandonada' && r11bRes.motivo === 'abandonada_vinculo_invalido', `R11b: esperado abandonada_vinculo_invalido, veio ${JSON.stringify(r11bRes)}`);

  const r11c = await pendenciaInicial();
  await expirarR(r11c.ag);
  const outroPac = await pacR();
  await clienteAdmin.query(`update agendamentos set paciente_id = $2 where id = $1`, [r11c.ag, outroPac.id]); // o agendamento passou a OUTRO paciente
  assert(JSON.stringify(await naListaComo(r11c.ag)) === JSON.stringify(['recuperar']), 'R11c: continua listada');
  const r11cRes = await recuperarR(r11c.ag, r11c.pac);
  assert(r11cRes.resultado === 'abandonada' && r11cRes.motivo === 'abandonada_vinculo_invalido', `R11c: esperado abandonada_vinculo_invalido, veio ${JSON.stringify(r11cRes)}`);
  log("  OK (R11): agendamento ou paciente em OUTRA clinica, ou agendamento de outro paciente -> a jornada continua listada e e encerrada por 'abandonada_vinculo_invalido'.");

  // S -- JORNADA SEM RESPOSTA (setima revisao, item 3): aguardando_satisfacao expira em silencio
  // apos 7 dias (`abandonada_sem_resposta`), liberando o telefone; resposta posterior segue o fluxo normal.
  log('\n[S] Verificando a expiracao silenciosa de aguardando_satisfacao (7 dias)...');
  assert((await clienteA.query('select cappia_pos_consulta_expiracao_sem_resposta_minutos() as m')).rows[0].m === 10080, 'S: a expiracao deve ser de 10080 min (7 dias)');
  const ENCERRAR = 'select cappia_pos_consulta_encerrar_sem_resposta($1) as n';
  const envelhecer = (ag, intervalo) => clienteAdmin.query(`update pos_consulta_jornadas set atualizada_em = now() - $3::interval where clinica_id=$1 and agendamento_id=$2`, [clinica3, ag, intervalo]);
  const aguardando = async (modo = 'ambos') => {
    const p = await pendenciaInicial(modo);
    assert((await clienteA.query(CONFIRMAR, [clinica3, p.ag, p.ini.claim_token])).rows[0].r.resultado === 'confirmada', 'S: preparo (primeira entrega confirmada)');
    return p;
  };
  const s1 = await aguardando();
  const s1Recente = await aguardando();
  const s1Limite = await aguardando();
  await envelhecer(s1.ag, '8 days');
  await envelhecer(s1Recente.ag, '6 days 23 hours');
  await envelhecer(s1Limite.ag, '10080 minutes'); // exatamente 7 dias (a chamada vem depois: idade >= 7 dias)
  const s1N = (await clienteA.query(ENCERRAR, [200])).rows[0].n;
  assert(s1N === 2, `S1: esperado 2 jornadas encerradas (8 dias e exatamente 7 dias), veio ${s1N}`);
  const s1Linha = await linhaR(s1.ag);
  assert(s1Linha.etapa === 'encerrada' && s1Linha.encerramento_motivo === 'abandonada_sem_resposta' && s1Linha.classificacao === null && s1Linha.convite_google_em === null && s1Linha.convite_pendente === false && s1Linha.entrega_id === null, `S1: encerrada em silencio, sem classificacao nem convite, veio ${JSON.stringify({ etapa: s1Linha.etapa, motivo: s1Linha.encerramento_motivo })}`);
  assert((await linhaR(s1Limite.ag)).etapa === 'encerrada', 'S1: exatamente 7 dias ja expira');
  assert((await linhaR(s1Recente.ag)).etapa === 'aguardando_satisfacao', 'S1: 6 dias e 23 h NAO expira');
  // o telefone foi liberado e uma resposta POSTERIOR nao encontra jornada aberta (segue o fluxo normal)
  const abertaDepois = (await clienteAdmin.query(`select count(*)::int n from pos_consulta_jornadas where clinica_id=$1 and telefone_normalizado=$2 and etapa='aguardando_satisfacao'`, [clinica3, s1.pac.telefone])).rows[0].n;
  assert(abertaDepois === 0, 'S1: depois de expirar, nao ha jornada ABERTA para o telefone (resposta posterior segue o fluxo normal)');
  const s1Tardia = (await clienteA.query(REGISTRAR, [clinica3, s1.ag, 'positiva', true])).rows[0].r;
  assert(s1Tardia.resultado === 'ja_processada', `S1: registrar resposta tardia na jornada expirada nao pode reabrir nem convidar, veio ${JSON.stringify(s1Tardia)}`);
  assert((await linhaR(s1.ag)).convite_google_em === null, 'S1: ausencia de resposta nunca autoriza convite');
  const s1Novo = await agR(s1.pac.id);
  assert((await clienteA.query(INICIAR, [clinica3, s1Novo, s1.pac.id, s1.pac.telefone, 'ambos', false])).rows[0].r.resultado === 'pendente', 'S1: o telefone foi LIBERADO (nova jornada)');

  // S2 -- so aguardando_satisfacao expira: as etapas pendentes nao (a recuperacao cuida delas).
  const s2 = await pendenciaInicial();
  await envelhecer(s2.ag, '30 days');
  assert((await clienteA.query(ENCERRAR, [200])).rows[0].n === 0, 'S2: nada mais a encerrar');
  assert((await linhaR(s2.ag)).etapa === 'aguardando_inicio', 'S2: aguardando_inicio antigo NAO e tocado pela expiracao (e da recuperacao)');

  // S3 -- limite por chamada e idempotencia.
  const s3a = await aguardando();
  const s3b = await aguardando();
  await envelhecer(s3a.ag, '9 days');
  await envelhecer(s3b.ag, '10 days');
  assert((await clienteA.query(ENCERRAR, [1])).rows[0].n === 1, 'S3: p_limit=1 encerra uma');
  assert((await linhaR(s3b.ag)).etapa === 'encerrada' && (await linhaR(s3a.ag)).etapa === 'aguardando_satisfacao', 'S3: a mais ANTIGA primeiro');
  assert((await clienteA.query(ENCERRAR, [200])).rows[0].n === 1, 'S3: a segunda chamada encerra a restante');
  assert((await clienteA.query(ENCERRAR, [200])).rows[0].n === 0, 'S3: idempotente -- nada mais a encerrar');

  // S4 -- CHECK do motivo e ACL.
  const violaS = async (sql, params, ck) => {
    const msg = await excecaoDe(clienteAdmin, sql, params);
    assert(msg !== null && msg.includes(ck), `S4: esperado violar ${ck}, veio: ${msg}`);
  };
  await violaS(`update pos_consulta_jornadas set encerramento_motivo = 'abandonada_sem_resposta' where clinica_id=$1 and agendamento_id=$2`, [clinica3, s1Recente.ag], 'pos_consulta_jornadas_encerramento_motivo_ck'); // ainda aguardando_satisfacao
  for (const [rotulo, cliente] of [['anon', clienteAnon], ['authenticated', clienteAuthenticated]]) {
    for (const sql of ['select cappia_pos_consulta_encerrar_sem_resposta(10)', 'select cappia_pos_consulta_expiracao_sem_resposta_minutos()']) {
      const msg = await excecaoDe(cliente, sql, []);
      assert(msg !== null && /permission denied/i.test(msg), `S4: ${rotulo} deveria receber permission denied em ${sql}`);
    }
  }
  log("  OK (S): aguardando_satisfacao expira em silencio aos 7 dias ('abandonada_sem_resposta'), libera o telefone, nao convida, nao toca as etapas pendentes; resposta tardia nao reabre.");

  // R9 -- recuperacoes vem ANTES dos novos.
  const r9 = await pendenciaInicial();
  await expirarR(r9.ag);
  const pacNovo = await pacR();
  const agNovo = await agR(pacNovo.id);
  const ordem = (await listaR()).map((c) => c.acao_edge);
  const primeiroIniciar = ordem.indexOf('iniciar');
  const ultimoRecuperar = ordem.lastIndexOf('recuperar');
  assert(primeiroIniciar >= 0 && ultimoRecuperar >= 0 && ultimoRecuperar < primeiroIniciar, `R9: todas as recuperacoes devem preceder os novos, ordem: ${ordem.join(',')}`);
  assert((await naListaComo(agNovo)).join() === 'iniciar', "R9: um agendamento novo continua listado como 'iniciar'");
  log('  OK (R9): recuperacoes listadas ANTES dos candidatos novos; novos seguem como iniciar.');

  // R10 -- CHECKs novos e ACL.
  const violaR = async (sql, params, ck) => {
    const msg = await excecaoDe(clienteAdmin, sql, params);
    assert(msg !== null && msg.includes(ck), `R10: esperado violar ${ck}, veio: ${msg}`);
  };
  await violaR(`update pos_consulta_jornadas set entrega_tentativas = 0 where clinica_id=$1 and agendamento_id=$2`, [clinica3, r6.ag], 'pos_consulta_jornadas_entrega_tentativas_ck');
  await violaR(`update pos_consulta_jornadas set encerramento_motivo = 'abandonada_janela' where clinica_id=$1 and agendamento_id=$2`, [clinica3, r6.ag], 'pos_consulta_jornadas_encerramento_motivo_ck'); // nao encerrada
  await violaR(`update pos_consulta_jornadas set encerramento_motivo = 'motivo_inventado' where clinica_id=$1 and agendamento_id=$2`, [clinica3, r3.ag], 'pos_consulta_jornadas_encerramento_motivo_ck'); // vocabulario fechado
  for (const [rotulo, cliente] of [['anon', clienteAnon], ['authenticated', clienteAuthenticated]]) {
    const negados = [];
    for (const sql of ['select cappia_pos_consulta_recuperar_entrega($1,$2,$3,$4)', 'select cappia_pos_consulta_max_tentativas_entrega()']) {
      const msg = await excecaoDe(cliente, sql, sql.includes('$1') ? [clinica3, randomUUID(), randomUUID(), '5511999990000'] : []);
      negados.push(msg !== null && /permission denied/i.test(msg));
    }
    assert(negados.every(Boolean), `R10: ${rotulo} deveria receber permission denied nas funcoes de recuperacao`);
  }
  assert((await clienteA.query('select cappia_pos_consulta_max_tentativas_entrega() as m')).rows[0].m === 3, 'R10: limite de tentativas deveria ser 3');
  log('  OK (R10): CHECKs de tentativas/encerramento (vocabulario fechado) e ACL negativa das funcoes novas.');

  log('\n✅ TODOS OS CENARIOS PASSARAM (B1 com service_role real + ACL negativa, B2 com identidade estavel, B3 com telefone oficial, B4, E1/E3 com cappia_pos_consulta_candidatos, G Google so apos positiva, J janela maxima de idade, R recuperacao de entregas pendentes, S expiracao sem resposta).\n');
} catch (e) {
  console.error(`\n❌ FALHOU: ${e.message}\n`);
  process.exitCode = 1;
} finally {
  await limpar();
}
