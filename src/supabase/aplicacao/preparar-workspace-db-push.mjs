// Prepara um WORKSPACE TEMPORARIO para `supabase db push`, de modo que as migrations
// pendentes sejam registradas no historico remoto com A VERSAO DO PROPRIO ARQUIVO
// (revisao do Codex, bloqueador 2 da sexta revisao) -- sem `migration repair` e
// sem "aplicar por um mecanismo que gera outra versao para depois renomear".
//
// POR QUE ISTO EXISTE
// - `apply_migration` do MCP do Supabase so aceita `name` e `query`: o SERVIDOR gera
//   a versao (timestamp do momento). Nao ha como preservar a versao do arquivo por
//   ali -- foi exatamente o que descasou 20260915120000 (arquivo) de 20260919204030
//   (registrada).
// - `supabase db push` registra a versao DO NOME DO ARQUIVO. Mas ele exige que TODA
//   versao ja presente no historico remoto exista como arquivo local (senao aborta
//   pedindo `migration repair`), e o diretorio de migrations do repositorio nao e o
//   diretorio padrao da CLI nem espelha o historico remoto inteiro. Solucao: um
//   workspace descartavel com (a) um ARQUIVO-MARCADOR vazio para cada versao ja
//   registrada no remoto (nunca reaplicado: a CLI so aplica o que falta no historico)
//   e (b) copias BYTE-IDENTICAS das migrations pendentes.
//
// Este script NUNCA conecta a banco algum nem le credenciais: so monta arquivos.
//
// Uso:
//   node preparar-workspace-db-push.mjs \
//     --versoes-remotas=<json-do-list_migrations> \
//     --pendentes=<arquivo.sql>[,<arquivo.sql>...] \
//     --destino=<diretorio-que-nao-existe-ou-esta-vazio>
// O JSON de versoes remotas e a saida (array) de `list_migrations`: objetos com
// `version` (14 digitos) e `name`.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOME_VALIDO = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const MARCADOR = '-- ARQUIVO-MARCADOR: versao JA registrada no historico remoto. Nao contem SQL e nunca e reaplicada.\n';

export class ErroPreparoWorkspace extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroPreparoWorkspace';
  }
}

const sha256 = (caminho) => createHash('sha256').update(readFileSync(caminho)).digest('hex');
const soAlfanumerico = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * @param {{ versoesRemotas: {version: string, name?: string}[], pendentes: string[], destino: string,
 *           permitirAnteriorAoRemoto?: boolean }} entrada
 */
export function prepararWorkspaceDbPush({ versoesRemotas, pendentes, destino, permitirAnteriorAoRemoto = false }) {
  if (!Array.isArray(versoesRemotas) || versoesRemotas.length === 0) {
    throw new ErroPreparoWorkspace('versoesRemotas vazio: sem o historico remoto (list_migrations) nao ha como montar o workspace.');
  }
  if (!Array.isArray(pendentes) || pendentes.length === 0) throw new ErroPreparoWorkspace('nenhuma migration pendente informada.');

  const remotas = new Map();
  for (const item of versoesRemotas) {
    const versao = String(item?.version ?? '');
    if (!/^\d{14}$/.test(versao)) throw new ErroPreparoWorkspace(`versao remota invalida (esperado 14 digitos): '${versao}'`);
    if (remotas.has(versao)) throw new ErroPreparoWorkspace(`versao remota duplicada: ${versao}`);
    remotas.set(versao, soAlfanumerico(item.name) || 'migration_remota');
  }
  const maiorRemota = [...remotas.keys()].sort().at(-1);

  const alvos = pendentes.map((caminho) => {
    const nome = basename(caminho);
    const m = NOME_VALIDO.exec(nome);
    if (!m) throw new ErroPreparoWorkspace(`nome de migration invalido: '${nome}' (esperado <14 digitos>_<snake_case>.sql)`);
    if (!existsSync(caminho)) throw new ErroPreparoWorkspace(`arquivo pendente nao existe: ${caminho}`);
    return { caminho: resolve(caminho), nome, versao: m[1] };
  });

  const vistas = new Set();
  for (const alvo of alvos) {
    if (vistas.has(alvo.versao)) throw new ErroPreparoWorkspace(`versao pendente duplicada: ${alvo.versao}`);
    vistas.add(alvo.versao);
    if (remotas.has(alvo.versao)) {
      throw new ErroPreparoWorkspace(`a versao pendente ${alvo.versao} JA esta registrada no remoto -- nao reaplicar, nao renomear.`);
    }
    if (alvo.versao < maiorRemota && !permitirAnteriorAoRemoto) {
      throw new ErroPreparoWorkspace(
        `a versao pendente ${alvo.versao} e ANTERIOR a ultima versao remota (${maiorRemota}); a CLI exigiria --include-all. ` +
          'Recusado por padrao: escolha uma versao de arquivo posterior ao historico remoto (renomear o arquivo PENDENTE antes de aplicar e permitido -- ainda nao foi aplicado).'
      );
    }
  }

  if (existsSync(destino) && readdirSync(destino).length > 0) throw new ErroPreparoWorkspace(`destino nao esta vazio: ${destino}`);
  const dirMigrations = join(destino, 'supabase', 'migrations');
  mkdirSync(dirMigrations, { recursive: true });
  writeFileSync(join(destino, 'supabase', 'config.toml'), '# workspace descartavel para `supabase db push` -- gerado por preparar-workspace-db-push.mjs\n');

  for (const [versao, nome] of remotas) writeFileSync(join(dirMigrations, `${versao}_${nome}.sql`), MARCADOR);

  const copias = alvos
    .sort((a, b) => a.versao.localeCompare(b.versao))
    .map((alvo) => {
      const destinoArquivo = join(dirMigrations, alvo.nome);
      copyFileSync(alvo.caminho, destinoArquivo);
      const origem = sha256(alvo.caminho);
      const copiado = sha256(destinoArquivo);
      if (origem !== copiado) throw new ErroPreparoWorkspace(`copia de ${alvo.nome} nao ficou byte-identica`);
      return { nome: alvo.nome, versao: alvo.versao, sha256: origem };
    });

  return { destino: resolve(destino), marcadores: remotas.size, maiorRemota, pendentes: copias };
}

// ── CLI ───────────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
  try {
    const arquivoVersoes = arg('versoes-remotas');
    const pendentes = (arg('pendentes') ?? '').split(',').filter(Boolean);
    const destino = arg('destino');
    if (!arquivoVersoes || pendentes.length === 0 || !destino) {
      throw new ErroPreparoWorkspace('uso: --versoes-remotas=<json> --pendentes=<a.sql,b.sql> --destino=<dir>');
    }
    const versoesRemotas = JSON.parse(readFileSync(arquivoVersoes, 'utf8'));
    const r = prepararWorkspaceDbPush({ versoesRemotas, pendentes, destino });
    console.log(`Workspace pronto em ${r.destino}`);
    console.log(`  marcadores (versoes ja no remoto): ${r.marcadores} | maior versao remota: ${r.maiorRemota}`);
    for (const p of r.pendentes) console.log(`  pendente: ${p.nome} | versao ${p.versao} | sha256 ${p.sha256}`);
    console.log('\nProximos passos (a partir do workspace; NAO executados por este script):');
    console.log('  1) supabase db push --dry-run --workdir <workspace> --db-url <url percent-encoded>   # DEVE listar EXATAMENTE as versoes pendentes acima');
    console.log('  2) supabase db push            --workdir <workspace> --db-url <url percent-encoded>   # so apos autorizacao explicita');
  } catch (e) {
    console.error(`ERRO: ${e.message}`);
    process.exit(1);
  }
}
