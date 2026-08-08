-- Rollback de 20260807120000_iris_nova_historico_conversa_legado.sql
-- Projeto-alvo: udizowyfjnhuhgxkeayk. Uma unica coluna aditiva, sem
-- dependencias -- nenhuma ordem especial necessaria.
--
-- Perder o conteudo desta coluna e seguro por construcao: historico_conversa
-- e memoria auxiliar de continuidade conversacional para a IA interpretadora
-- e a IA redatora, nunca fonte de disponibilidade e nunca autoridade para
-- reserva. Sem ela, a Iris perde continuidade entre turnos -- nunca agenda
-- errado.
--
-- Este rollback e da coluna NOVA -- nao reverte nem depende da coluna legada
-- `ultima_troca`, que continua intacta ate a migration de remocao separada
-- (specs/historico-conversacional-v1.md secao 0.2).

alter table estado_conversa
  drop column if exists historico_conversa;
