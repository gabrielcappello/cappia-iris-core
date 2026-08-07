-- Rollback de 20260806120000_iris_nova_ultima_troca.sql
-- Projeto-alvo: bcmuqautblvjdqzhjfbw. Uma unica coluna aditiva, sem
-- dependencias -- nenhuma ordem especial necessaria.
--
-- Perder o conteudo desta coluna e seguro por construcao: ultima_troca e
-- memoria auxiliar de continuidade conversacional para a IA redatora, nunca
-- fonte de disponibilidade e nunca autoridade para reserva. Sem ela, a Iris
-- perde continuidade de um turno para o outro -- nunca agenda errado.

alter table estado_conversa
  drop column if exists ultima_troca;
