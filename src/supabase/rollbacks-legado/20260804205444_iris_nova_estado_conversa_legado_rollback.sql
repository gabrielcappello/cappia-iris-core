-- Rollback de 20260804205444_iris_nova_estado_conversa_legado.sql
-- Projeto-alvo: udizowyfjnhuhgxkeayk (mesmo alvo da migration). PROIBIDO
-- aplicar em bcmuqautblvjdqzhjfbw ou em qualquer outro projeto.
--
-- Ordem inversa de dependencia: a tabela primeiro (a FK composta e a
-- constraint estado_conversa_clinica_telefone_key vao junto, por
-- pertencerem a propria tabela), depois a constraint aditiva em
-- pacientes que a FK exigia.

drop table if exists estado_conversa;

alter table pacientes drop constraint if exists pacientes_id_clinica_telefone_key;
