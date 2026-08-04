-- Rollback de 20260804204134_iris_nova_compatibilidade_pacientes_legado.sql
-- Projeto-alvo: udizowyfjnhuhgxkeayk (mesmo alvo da migration). PROIBIDO
-- aplicar em bcmuqautblvjdqzhjfbw ou em qualquer outro projeto.
--
-- Reverte a constraint e a coluna aditivas em pacientes. `telefone`
-- original nunca foi tocado pela migration, entao nao ha nada a restaurar
-- nele. Ordem: constraint antes da coluna (a constraint depende da
-- coluna).

alter table pacientes drop constraint if exists pacientes_clinica_id_telefone_normalizado_key;
alter table pacientes drop column if exists telefone_normalizado;
