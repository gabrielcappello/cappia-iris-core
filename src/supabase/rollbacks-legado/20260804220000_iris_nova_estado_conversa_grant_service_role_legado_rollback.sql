-- Rollback de 20260804220000_iris_nova_estado_conversa_grant_service_role_legado.sql
-- Projeto-alvo: udizowyfjnhuhgxkeayk (mesmo alvo da migration). PROIBIDO
-- aplicar em bcmuqautblvjdqzhjfbw ou em qualquer outro projeto.
--
-- Reverte o grant, retornando estado_conversa ao estado (quebrado) de logo
-- apos 20260804205444: service_role sem select/insert/update explicitos.
-- Nao reverter isoladamente sem tambem reverter 20260804205444 (a tabela
-- ficaria inacessivel de novo para a Edge Function).

revoke select, insert, update on table public.estado_conversa from service_role;
