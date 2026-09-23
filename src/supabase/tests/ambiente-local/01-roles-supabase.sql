-- Ambiente LOCAL DESCARTAVEL -- passo 1: papeis no modelo do Supabase.
--
-- Reproduz, num Postgres comum, o que o Supabase hospedado ja entrega pronto:
-- os papeis `anon`, `authenticated`, `service_role` (este com BYPASSRLS) e os
-- DEFAULT PRIVILEGES do schema public. Isso importa para a prova de B1: no
-- Supabase, toda tabela/funcao nova em `public` nasce com privilegios para
-- esses tres papeis, e e exatamente por isso que a migration de pos-consulta
-- precisa de `revoke ... from anon, authenticated` explicito. Sem replicar os
-- default privileges, os testes de ACL negativa passariam por vacuidade
-- (ninguem teria grant nenhum de qualquer jeito).
--
-- Idempotente: pode rodar tambem sobre um `supabase start` (Docker), onde estes
-- papeis ja existem -- nesse caso nao muda nada.
--
-- NAO e o stack Supabase completo (sem PostgREST, GoTrue, Edge runtime):
-- serve so para o runner SQL, que fala direto com o Postgres.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- Como no hospedado, o papel de login (`postgres`) e membro dos tres --
-- necessario para o runner fazer `SET ROLE service_role/anon/authenticated`.
grant anon, authenticated, service_role to postgres;

grant usage on schema public to anon, authenticated, service_role;

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
