-- Corrige privilegios de service_role em conversas_auditoria (achado do
-- Codex, 05/09): a migration anterior concedeu, sem intencao, TRUNCATE,
-- REFERENCES e TRIGGER alem de SELECT/INSERT/DELETE -- resultado padrao de
-- "grant select, insert, delete" quando a role ja possui outros privilegios
-- herdados/default no schema. O contrato original (spec
-- auditoria-conversas-admin-v1.md) e explicito: service_role so cria
-- (Edge Function) e apaga por retencao (job de limpeza), nunca truncate,
-- nunca referencia outras tabelas atraves desta, nunca trigger.
--
-- REVOKE ALL primeiro para zerar qualquer privilegio herdado, depois GRANT
-- exatamente os tres necessarios -- mesmo padrao ja usado na migration
-- original para public/anon/authenticated, agora aplicado tambem para
-- fechar service_role ao minimo.

revoke all on table public.conversas_auditoria from service_role;
grant select, insert, delete on table public.conversas_auditoria to service_role;
