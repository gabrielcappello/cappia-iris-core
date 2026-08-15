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

/**
 * @param {string} bruta valor de DATABASE_URL
 * @returns {{ok: true, refs: string[]} | {ok: false, erro: string}}
 */
export function refsDaConexao(bruta) {
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
