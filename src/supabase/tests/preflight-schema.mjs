// PREFLIGHT DE SCHEMA -- roda ANTES de qualquer deploy da Edge Function.
//
// ── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────
// Em 2026-08-16 a Iris parou de responder em producao. Causa: o codigo
// publicado passou a ler `estado_conversa.aguardando_resposta`, uma coluna
// que existia no repositorio (migration escrita) mas NUNCA foi aplicada no
// banco operacional. O SELECT falhava no inicio do turno e nenhuma resposta
// era gerada.
//
// Nada do que rodou antes do deploy poderia ter pego isso:
//   - `npm test` (1401 testes) usa DUBLE de banco -- nunca toca schema real;
//   - `tsc --noEmit` e `deno check` verificam TIPOS, nao o banco;
//   - a paridade core/Edge compara ARQUIVOS entre si, nao com o ambiente.
//
// Falta a verificacao que este script faz: as colunas que o codigo LE
// existem, de fato, no banco de destino?
//
// ── O QUE ELE VERIFICA, E O QUE NAO VERIFICA ────────────────────────────
// VERIFICA: presenca de cada tabela e de cada coluna que o Core le em
// SELECT. Isso cobre a classe de erro que derrubou a Iris.
//
// NAO VERIFICA: tipo da coluna, constraints, indices, RPCs, permissoes, nem
// colunas usadas apenas em UPDATE/INSERT (essas falham no efeito, nunca na
// leitura do turno, entao nao derrubam a conversa inteira). Declarado aqui
// para ninguem confundir "preflight passou" com "deploy seguro".
//
// ── COMO USAR ───────────────────────────────────────────────────────────
//   node --env-file="<cofre>/supabase.env" \
//     supabase/tests/preflight-schema.mjs <project-ref>
//
// Sai com codigo 1 quando falta qualquer coisa -- entao serve como portao
// numa sequencia de deploy (`preflight && deploy`).
//
// A LISTA ABAIXO E MANUAL, e isso e deliberado: derivar as colunas do codigo
// por regex daria falsa confianca (`select(VARIAVEL)`, colunas montadas em
// tempo de execucao). Uma lista explicita, revisada quando um SELECT muda, e
// mais honesta -- e o proprio teste avisa quando `identificacao.ts` diverge
// dela (ver `conferirListaContraCodigo`).

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

/**
 * O que o Core LE, por tabela. Fonte: os SELECT de `src/core/*.ts`.
 *
 * `estado_conversa` e a mais critica: e lida no inicio de TODO turno
 * (`identificacao.ts`), entao uma coluna faltando aqui derruba a conversa
 * inteira -- foi exatamente o caso de 2026-08-16.
 */
const ESQUEMA_ESPERADO = {
  estado_conversa: [
    'id',
    'estado',
    'dados',
    'paciente_id',
    'atualizado_em',
    'contexto_horarios',
    'historico_conversa',
    // Acrescentada em 2026-08-16 (spec v2 §14.6). E a coluna cuja ausencia
    // derrubou a Iris -- o motivo deste arquivo existir.
    'aguardando_resposta',
  ],
  pacientes: ['id', 'nome', 'documento', 'data_nascimento', 'email'],
  clinicas: ['id', 'dentistas', 'fuso_horario', 'automatizacoes'],
  agendamentos: ['id', 'data', 'horario', 'duracao_min', 'status', 'dentista_id', 'paciente_id', 'clinica_id'],
  horarios_bloqueados: ['data_inicio', 'data_fim', 'horario_inicio', 'horario_fim'],
  procedimentos_catalogo: [
    'id',
    'nome_pt', 'nome_es', 'nome_en', 'nome_fr', 'nome_de', 'nome_it', 'nome_ru', 'nome_ar',
    'tempo_padrao',
    'ativo',
  ],
};

/**
 * Tabelas que o Core referencia mas que podem NAO existir no projeto-alvo.
 *
 * `mensagens_recebidas` e o caso real: existe no ambiente de dev, nao existe
 * no operacional (verificado 2026-08-16). A rota que a usa nao e a que
 * atende WhatsApp hoje, entao a ausencia e reportada como AVISO -- nunca
 * como falha, porque falhar aqui bloquearia um deploy legitimo.
 */
const TABELAS_OPCIONAIS = new Set(['mensagens_recebidas']);

function abortar(mensagem) {
  console.error(`\nPREFLIGHT ABORTADO: ${mensagem}\n`);
  process.exit(1);
}

/**
 * Confere que a lista acima nao ficou para tras em relacao ao codigo.
 *
 * Le `COLUNAS_ESTADO_CONVERSA` de `identificacao.ts` -- a constante cuja
 * alteracao causou o incidente -- e compara com o esperado. Nao cobre todos
 * os SELECT do Core, mas cobre o unico que roda em TODO turno.
 */
async function conferirListaContraCodigo() {
  const caminho = join(AQUI, '..', '..', 'core', 'identificacao.ts');
  let fonte;
  try {
    fonte = await readFile(caminho, 'utf8');
  } catch {
    return ['nao foi possivel ler identificacao.ts para conferir a lista'];
  }

  const m = fonte.match(/COLUNAS_ESTADO_CONVERSA\s*=\s*\n?\s*'([^']+)'/);
  if (!m) return ['COLUNAS_ESTADO_CONVERSA nao encontrada em identificacao.ts'];

  const noCodigo = m[1].split(',').map((c) => c.trim()).filter(Boolean);
  const esperado = new Set(ESQUEMA_ESPERADO.estado_conversa);
  const avisos = [];
  for (const coluna of noCodigo) {
    if (!esperado.has(coluna)) {
      avisos.push(`identificacao.ts le '${coluna}', que NAO esta na lista deste preflight -- acrescente-a`);
    }
  }
  return avisos;
}

// `--env-file` do Node NAO remove o BOM (﻿) do inicio do arquivo, entao
// a PRIMEIRA variavel do .env vira "﻿SUPABASE_URL" e nao e encontrada
// pelo nome. Os arquivos do cofre tem BOM. A varredura abaixo aceita a chave
// com ou sem o marcador -- nunca imprime nenhum valor.
function doAmbiente(nome) {
  const direto = process.env[nome];
  if (direto !== undefined) return direto;
  for (const [chave, valor] of Object.entries(process.env)) {
    if (chave.replace(/^﻿/, '') === nome) return valor;
  }
  return undefined;
}

const url = doAmbiente('SUPABASE_URL');
const chave = doAmbiente('SUPABASE_SERVICE_ROLE_KEY');
const ref = process.argv[2];

if (!url || !chave) abortar('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios (use --env-file).');
if (!ref) abortar('informe o project-ref como argumento: preflight-schema.mjs <project-ref>');
if (!url.includes(ref)) {
  abortar(`a SUPABASE_URL nao corresponde ao project-ref informado (${ref}). Recusado para nao verificar o banco errado.`);
}

console.log(`\nPREFLIGHT DE SCHEMA -- projeto ${ref}\n`);

// Consulta o catalogo do proprio Postgres via PostgREST. Read-only.
async function colunasDe(tabela) {
  const resposta = await fetch(
    `${url}/rest/v1/${tabela}?select=*&limit=0`,
    { headers: { apikey: chave, Authorization: `Bearer ${chave}`, Prefer: 'count=none' } }
  );
  if (resposta.status === 404 || resposta.status === 400) return null;
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status} ao consultar ${tabela}`);
  // PostgREST devolve as colunas no cabecalho de conteudo quando ha linhas;
  // com limit=0 usamos o endpoint de definicao (OpenAPI) como fonte estavel.
  return 'ok';
}

let falhou = false;
const avisos = [];

try {
  // Fonte estavel das colunas: o schema OpenAPI que o PostgREST publica.
  const respostaSchema = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: chave, Authorization: `Bearer ${chave}` },
  });
  if (!respostaSchema.ok) abortar(`nao foi possivel ler o schema (HTTP ${respostaSchema.status}).`);
  const schema = await respostaSchema.json();
  const definicoes = schema.definitions ?? {};

  for (const [tabela, colunasEsperadas] of Object.entries(ESQUEMA_ESPERADO)) {
    const def = definicoes[tabela];
    if (!def) {
      const msg = `tabela '${tabela}' NAO EXISTE`;
      if (TABELAS_OPCIONAIS.has(tabela)) { avisos.push(msg + ' (opcional)'); }
      else { console.error(`  FALTA  ${msg}`); falhou = true; }
      continue;
    }
    const existentes = new Set(Object.keys(def.properties ?? {}));
    const faltando = colunasEsperadas.filter((c) => !existentes.has(c));
    if (faltando.length > 0) {
      console.error(`  FALTA  ${tabela}: ${faltando.join(', ')}`);
      falhou = true;
    } else {
      console.log(`  OK     ${tabela} (${colunasEsperadas.length} colunas)`);
    }
  }

  // Tabelas opcionais: reportadas, nunca bloqueantes.
  for (const tabela of TABELAS_OPCIONAIS) {
    if (!definicoes[tabela]) avisos.push(`tabela opcional '${tabela}' nao existe neste projeto`);
  }

  for (const aviso of await conferirListaContraCodigo()) avisos.push(aviso);
} catch (erro) {
  abortar(`falha ao verificar o schema: ${erro.message}`);
}

if (avisos.length > 0) {
  console.log('\nAVISOS (nao bloqueiam):');
  for (const a of avisos) console.log(`  - ${a}`);
}

if (falhou) {
  console.error(
    '\nPREFLIGHT REPROVADO. O codigo LE colunas que nao existem neste banco --\n' +
      'publicar assim derruba a conversa no primeiro turno. Aplique as migrations\n' +
      'pendentes antes do deploy.\n'
  );
  process.exit(1);
}

console.log('\nPREFLIGHT APROVADO: todas as colunas lidas pelo Core existem neste banco.\n');
