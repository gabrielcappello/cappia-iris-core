-- Fecha `atualizar_cor_dentista` ao acesso público
--
-- ── O QUE ESTAVA ABERTO ─────────────────────────────────────────────────
-- `SECURITY DEFINER` (faz `UPDATE clinicas` ignorando RLS), com
-- `EXECUTE` para PUBLIC, anon e authenticated -- estes dois por grant
-- EXPLÍCITO, não herdado.
--
-- Pior: aceitava como credencial o `id`, o `token_acesso` OU o NOME do
-- dentista. Nenhum dos três é segredo -- o `id` chega ao navegador dentro de
-- `clinica.dentistas`, e o nome é público por definição.
--
-- Qualquer pessoa com a chave publicável (embutida no bundle) e um desses
-- identificadores escrevia em `clinicas`.
--
-- ── SÓ AGORA, E NESTA ORDEM ─────────────────────────────────────────────
-- A rota `/api/secure/cor-dentista` já está no ar e testada (401 sem
-- sessão). Ela exige sessão de DONO e tira `clinica_id` do cookie.
--
-- Revogar antes de migrar quebraria o seletor de cor do calendário -- por
-- isso este passo vem depois, como combinado na revisão.
--
-- ── ACL ANTES (rollback) ────────────────────────────────────────────────
--   =X/postgres | postgres=X | service_role=X | anon=X | authenticated=X
--
-- Restaurar:
--   grant execute on function
--     public.atualizar_cor_dentista(uuid, text, text) to anon, authenticated;
--
-- Gatilho: o seletor de cor parar de funcionar no painel.
--
-- `service_role` é PRESERVADO -- a rota nova o usa. A função continua
-- existindo; só deixa de ser chamável de fora.

revoke execute on function public.atualizar_cor_dentista(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.atualizar_cor_dentista(uuid, text, text)
  to service_role;
