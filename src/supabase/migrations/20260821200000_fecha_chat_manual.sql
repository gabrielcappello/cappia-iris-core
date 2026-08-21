-- Fecha `conversas_manuais` e `mensagens_manuais` ao acesso público
--
-- ── O QUE ESTAVA ABERTO ─────────────────────────────────────────────────
-- Ambas tinham RLS ligado E uma política `allow_all` (`qual: true`, roles
-- `{public}`, comando `ALL`) -- ou seja, liberada para todos --, somada a
-- GRANT de leitura/escrita para `anon` e `authenticated`.
--
-- Resultado: conversa entre a clínica e o paciente acessível pela API
-- pública, sem login.
--
-- ── ESTADO ANTES (para rollback) ────────────────────────────────────────
--   conversas_manuais: rls=on, política `allow_all`
--     postgres=arwdDxtm | anon=arwDxtm | authenticated=arwDxtm | service_role
--   mensagens_manuais: rls=on, política `allow_all`
--     postgres=arwdDxtm | anon=rDxtm  | authenticated=rDxtm  | service_role
--
--   Dados: conversas_manuais = 0 linhas, mensagens_manuais = 11 linhas.
--   NADA é apagado aqui -- só permissões mudam.
--
-- ── POR QUE NÃO CRIAR "POLÍTICA DE NEGAÇÃO" ─────────────────────────────
-- Correção de uma proposta minha anterior: com RLS ligado, a AUSÊNCIA de
-- política já nega. Políticas do Postgres são permissivas -- somam acesso,
-- nunca subtraem --, então uma "política que nega" não existe como
-- mecanismo. Remover `allow_all` e não pôr nada no lugar é o correto.
--
-- ── POR QUE REMOVER `allow_all` SE O REVOKE JÁ BASTA ────────────────────
-- O `revoke` sozinho já bloquearia: RLS e GRANT precisam permitir ao mesmo
-- tempo. Mas deixar uma política chamada `allow_all` para trás é uma
-- armadilha: um `grant` futuro feito sem atenção reabriria tudo em
-- silêncio. As duas camadas fecham.
--
-- `service_role` é PRESERVADO: é quem o n8n e as rotas do painel usam.

drop policy if exists allow_all on public.conversas_manuais;
drop policy if exists allow_all on public.mensagens_manuais;

revoke all on table public.conversas_manuais from public, anon, authenticated;
revoke all on table public.mensagens_manuais from public, anon, authenticated;

grant select, insert, update on table public.conversas_manuais to service_role;
grant select, insert, update on table public.mensagens_manuais to service_role;

-- ── ROLLBACK ────────────────────────────────────────────────────────────
-- Restaura exatamente o estado anterior:
--
--   create policy allow_all on public.conversas_manuais for all using (true);
--   create policy allow_all on public.mensagens_manuais for all using (true);
--   grant select, insert, update, delete, references, trigger
--     on table public.conversas_manuais to anon, authenticated;
--   grant select, references, trigger
--     on table public.mensagens_manuais to anon, authenticated;
--
-- Gatilho para rollback: o chat manual deixar de gravar no histórico após o
-- teste de envio real.
