-- Rollback de 20260805120000_iris_nova_contexto_horarios_legado.sql
-- Projeto-alvo: udizowyfjnhuhgxkeayk. Uma unica coluna aditiva, sem
-- dependencias -- nenhuma ordem especial necessaria.
--
-- Perder o conteudo desta coluna e seguro por construcao: contexto_horarios
-- e auxiliar de interpretacao do turno seguinte, nunca fonte de
-- disponibilidade e nunca autoridade para reserva. Sem ela, a Iris pode
-- repetir uma lista de horarios -- nunca agenda errado.

alter table estado_conversa
  drop column if exists contexto_horarios;
