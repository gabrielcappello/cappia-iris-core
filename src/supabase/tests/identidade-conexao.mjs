// Identificacao do projeto Supabase a partir da DATABASE_URL.
//
// Extraido do runner A×B para ser TESTAVEL sem banco e sem credencial: aqui
// a funcao e pura -- devolve `{ ok, refs }` ou `{ ok: false, erro }`, nunca
// chama `process.exit`. Quem aborta e o runner.
//
// POR QUE NAO `includes` SOBRE A URL INTEIRA: o ref do projeto pode aparecer
// na senha, no nome do banco ou num parametro de query e satisfazer a
// checagem enquanto o hostname aponta para OUTRO lugar. A identidade sai do
// HOSTNAME e do USERNAME -- e o username so conta quando o host e o pooler
// oficial, porque quem decide o destino da conexao e o hostname.
//
// Nenhum valor de credencial e impresso, logado ou persistido por este
// modulo: ele so devolve os refs identificados.

// Hosts de loopback aceitos SOMENTE em modo local explicito (ver `permitirLocal`
// abaixo). Comparacao por IGUALDADE ESTRITA -- nunca `includes`/`startsWith`:
// `localhost.evil.com`, `127.0.0.1.evil.com` e afins nao podem passar por
// "local". Formas alternativas de escrever o loopback (127.1, 0x7f.0.0.1,
// 127.0.0.2, 0.0.0.0) tambem NAO sao aceitas de proposito -- falha fechado.
const HOSTS_LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// Parametros de query do libpq/node-postgres que podem SOBRESCREVER o host
// real da conexao. Numa URL "localhost" eles poderiam redirecionar a conexao
// para outro lugar (inclusive o operacional) sem que o hostname mude.
const PARAMETROS_QUE_SOBRESCREVEM_HOST = ['host', 'hostaddr', 'service'];

/**
 * @param {string} bruta valor de DATABASE_URL
 * @param {{ permitirLocal?: boolean }} [opcoes]
 *   `permitirLocal === true` (booleano estrito) faz um host de loopback ser
 *   identificado como o ambiente LOCAL descartavel (`refs: ['local']`). Sem
 *   isso, loopback continua recusado como "nao identificavel" -- o
 *   comportamento historico, do qual os outros runners dependem. O modulo e
 *   PURO: quem exige a confirmacao explicita do operador e a marca gravada no
 *   proprio banco e o runner, nao esta funcao. Nenhuma forma de "local" jamais
 *   e resolvida para um project ref do Supabase hospedado.
 * @returns {{ok: true, refs: string[]} | {ok: false, erro: string}}
 */
export function refsDaConexao(bruta, opcoes = {}) {
  let u;
  try {
    u = new URL(bruta);
  } catch {
    return { ok: false, erro: 'DATABASE_URL malformada (nao e uma URL valida).' };
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) {
    return { ok: false, erro: `protocolo inesperado na DATABASE_URL (${u.protocol}). Esperado postgres/postgresql.` };
  }

  const achados = new Set();

  // Ambiente LOCAL descartavel: so com opt-in explicito do chamador, so em
  // loopback estrito, e nunca com parametro de query que possa redirecionar o
  // host de verdade.
  if (opcoes.permitirLocal === true && HOSTS_LOOPBACK.has(u.hostname.toLowerCase())) {
    for (const chave of PARAMETROS_QUE_SOBRESCREVEM_HOST) {
      if (u.searchParams.has(chave)) {
        return {
          ok: false,
          erro: `DATABASE_URL local recusada: o parametro de query '${chave}' poderia redirecionar a conexao para outro host.`,
        };
      }
    }
    return { ok: true, refs: ['local'] };
  }

  // Conexao direta: db.<ref>.supabase.co
  const host = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.(co|com)$/i);
  if (host) achados.add(host[1]);

  // Pooler: postgres.<ref> no username -- SO quando o host e o pooler
  // oficial. Sem esse vinculo, `db.evil.com` com username
  // `postgres.<ref-autorizado>` passaria: o username e escolhido por quem
  // monta a URL e nao prova para onde a conexao vai.
  if (/\.pooler\.supabase\.com$/i.test(u.hostname)) {
    const user = decodeURIComponent(u.username || '').match(/^postgres\.([a-z0-9]+)$/i);
    if (user) achados.add(user[1]);
  }

  if (achados.size === 0) {
    return {
      ok: false,
      erro:
        'nao foi possivel identificar o projeto pelo hostname nem pelo username da DATABASE_URL. ' +
        'Recusado: sem identificar o alvo, este teste (que executa commit real) nao pode rodar.',
    };
  }
  return { ok: true, refs: [...achados] };
}
