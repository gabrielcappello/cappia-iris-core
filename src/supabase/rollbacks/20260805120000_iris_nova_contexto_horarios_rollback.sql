-- Rollback de 20260805120000_iris_nova_contexto_horarios.sql
-- Projeto-alvo: bcmuqautblvjdqzhjfbw. Uma unica coluna aditiva, sem
-- dependencias -- nenhuma ordem especial necessaria.
--
-- Perder o conteudo desta coluna e seguro por construcao: contexto_horarios
-- e auxiliar de interpretacao do turno seguinte, nunca fonte de
-- disponibilidade e nunca autoridade para reserva.

alter table estado_conversa
  drop column if exists contexto_horarios;
