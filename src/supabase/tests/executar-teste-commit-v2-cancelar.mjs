// Runner do teste transacional de
// 20260815121000_iris_nova_commit_turno_v2_cancelar.sql
//
// Projeto-alvo: cappia-iris-core-dev (bcmuqautblvjdqzhjfbw) -- ambiente
// isolado de desenvolvimento e testes da Iris Nova.
//
// STATUS: NAO EXECUTADO -- e nao foi necessario. O teste de sessao unica que
// este runner serviria foi executado e APROVADO em 2026-08-15 por outra via:
// composicao numa unica chamada SQL pelo acesso Supabase ja conectado (ver
// 20260815121000_iris_nova_commit_turno_v2_cancelar_fixtures.sql).
//
// O runner permanece como referencia da mesma execucao por driver direto. O
// caminho por `pg` que ele inaugurou foi de fato usado no teste CONCORRENTE
// A×B (executar-teste-axb-commit-v2-cancelar.mjs), esse sim executado e
// aprovado -- concorrencia real exige duas sessoes e nao e composivel numa
// chamada unica.
//
// ── POR QUE UM RUNNER, E NAO supabase-js ────────────────────────────────
// `@supabase/supabase-js` fala PostgREST: cada chamada e uma requisicao HTTP
// independente, sem sessao. `BEGIN`/`ROLLBACK` nao teriam efeito alem da
// propria chamada -- e o efeito do caso 9 (um agendamento REALMENTE
// cancelado) ficaria PERSISTIDO. Este teste exige uma unica sessao de banco
// do inicio ao fim, entao usa o driver `pg` com uma conexao direta.
//
// ── POR QUE CARREGA A MIGRATION REAL ────────────────────────────────────
// A funcao sob teste e lida do ARQUIVO da migration e executada dentro da
// transacao. Nao existe copia do corpo no teste: se a migration mudar, o
// teste passa a exercitar a versao nova automaticamente. Uma copia poderia
// divergir em silencio e validar uma funcao que nao existe mais.
//
// ── GARANTIA DE ROLLBACK ────────────────────────────────────────────────
// O ROLLBACK e emitido em `finally`, e o encerramento da conexao em um
// `finally` aninhado. Isso cobre TODOS os caminhos: falha no DDL da coluna,
// falha ao criar a funcao, falha de assertiva dentro do bloco `do`, erro de
// conexao, ou excecao inesperada do proprio runner. Nao existe COMMIT em
// nenhum ponto -- nem no caminho de sucesso.
//
// Se o proprio ROLLBACK falhar (conexao ja perdida, por exemplo), o erro e
// reportado, mas a conexao e encerrada mesmo assim: uma transacao sem commit
// cuja conexao cai e desfeita pelo servidor.
//
// ── CREDENCIAIS ─────────────────────────────────────────────────────────
// Somente via variavel de ambiente DATABASE_URL, carregada por
// `node --env-file` a partir do cofre canonico (.iris-secrets). Este arquivo
// nunca abre, le, imprime ou persiste o valor -- nem em log, nem em erro.
//
// ── COMANDO (NAO EXECUTAR AINDA) ────────────────────────────────────────
//   cd C:\Users\Gabriel\cappia-iris-core\src
//   node --env-file="C:\Users\Gabriel\.iris-secrets\<arquivo>.env" \
//     supabase/tests/executar-teste-commit-v2-cancelar.mjs
//
// Requer o pacote `pg` (NAO instalado no momento desta escrita) e o nome
// exato do arquivo .env, ambos a confirmar com o Gabriel antes de rodar.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const AQUI = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(AQUI, '..', 'migrations', '20260815121000_iris_nova_commit_turno_v2_cancelar.sql');
const COLUNA = join(AQUI, '..', 'migrations', '20260815120000_iris_nova_aguardando_resposta.sql');
const FIXTURES = join(AQUI, '20260815121000_iris_nova_commit_turno_v2_cancelar_fixtures.sql');

// Projeto autorizado. Qualquer outro host aborta antes de conectar -- o
// projeto operacional (udizowyfjnhuhgxkeayk) nunca pode ser alvo deste teste.
const PROJETO_AUTORIZADO = 'bcmuqautblvjdqzhjfbw';

function abortar(mensagem) {
  console.error(`\nABORTADO: ${mensagem}\n`);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  abortar('DATABASE_URL ausente. Carregue o .env do cofre com --env-file.');
}

// Confere o projeto SEM imprimir a URL (ela contem a senha).
if (!url.includes(PROJETO_AUTORIZADO)) {
  abortar(
    `a DATABASE_URL nao aponta para o projeto autorizado (${PROJETO_AUTORIZADO}). ` +
      'Este teste executa efeito real e so pode rodar no ambiente isolado de dev.'
  );
}

const cliente = new pg.Client({ connectionString: url });

// Cada `notice` do Postgres (os `OK casoN` do bloco `do`) aparece aqui.
cliente.on('notice', (n) => console.log(`  ${n.message}`));

let falhou = false;

try {
  await cliente.connect();
  console.log(`\nConectado ao projeto ${PROJETO_AUTORIZADO}.\n`);

  const sqlColuna = await readFile(COLUNA, 'utf8');
  const sqlMigration = await readFile(MIGRATION, 'utf8');
  const sqlFixtures = await readFile(FIXTURES, 'utf8');

  await cliente.query('begin');
  console.log('BEGIN -- tudo a partir daqui sera desfeito.\n');

  // 1. A coluna de que a funcao depende. A migration usa `add column` simples;
  //    `if not exists` aqui torna o teste valido tambem se ela ja tiver sido
  //    aplicada no dev. Quando ja existe, o rollback NAO a remove (nao foi
  //    criada por esta transacao) -- o banco termina como estava nos dois casos.
  console.log('Criando coluna aguardando_resposta (se ausente)...');
  await cliente.query(sqlColuna.replace(/add column aguardando_resposta/i, 'add column if not exists aguardando_resposta'));

  // 2. A MIGRATION REAL, sem copia. Se o corpo nao compilar, falha aqui.
  console.log('Carregando a migration real da funcao...');
  await cliente.query(sqlMigration);
  console.log('OK: a funcao compilou a partir do arquivo real.\n');

  // 3. Fixtures e assertivas.
  console.log('Executando os casos:');
  await cliente.query(sqlFixtures);

  console.log('\nRESULTADO: todos os casos passaram.');
} catch (erro) {
  falhou = true;
  console.error('\nRESULTADO: FALHOU.');
  console.error(`  ${erro.message}`);
  if (erro.hint) console.error(`  hint: ${erro.hint}`);
  if (erro.where) console.error(`  where: ${erro.where}`);
} finally {
  // ROLLBACK SEMPRE -- sucesso, assertiva reprovada, DDL quebrado ou erro
  // inesperado. Nao ha caminho que faca commit.
  try {
    await cliente.query('rollback');
    console.log('\nROLLBACK executado: nenhuma alteracao persistida.');
  } catch (erroRollback) {
    falhou = true;
    console.error(`\nAVISO: o ROLLBACK falhou (${erroRollback.message}).`);
    console.error('A conexao sera encerrada -- transacao sem commit e desfeita pelo servidor.');
  } finally {
    await cliente.end().catch(() => {});
    console.log('Conexao encerrada.');
  }
}

process.exit(falhou ? 1 : 0);
