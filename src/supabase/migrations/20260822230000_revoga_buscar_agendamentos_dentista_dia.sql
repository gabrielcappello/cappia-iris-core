-- Fecha `buscar_agendamentos_confirmados_dentista_dia` ao acesso publico.
--
-- Estado confirmado imediatamente antes desta migration:
-- - funcao SECURITY DEFINER executavel por PUBLIC/anon/authenticated;
-- - zero dos 12 dentistas possui `token_acesso`;
-- - unico consumidor encontrado no n8n (`l6pNUaIccr2h4Gid`) esta desativado;
-- - nenhum outro workflow do n8n referencia a funcao.
--
-- A funcao e preservada para rollback simples e eventual uso interno futuro.
-- Somente a `service_role` permanece autorizada.
--
-- ACL anterior (rollback):
--   =X/postgres | postgres=X | service_role=X
-- Restaurar, se houver consumidor legitimo comprovado:
--   grant execute on function
--     public.buscar_agendamentos_confirmados_dentista_dia(uuid, date, text)
--     to public;

revoke execute on function
  public.buscar_agendamentos_confirmados_dentista_dia(uuid, date, text)
  from public, anon, authenticated;

grant execute on function
  public.buscar_agendamentos_confirmados_dentista_dia(uuid, date, text)
  to service_role;
