-- Rollback de 20260804202732_iris_nova_compatibilidade_clinicas_legado.sql
-- Projeto-alvo: udizowyfjnhuhgxkeayk (mesmo alvo da migration). PROIBIDO
-- aplicar em bcmuqautblvjdqzhjfbw ou em qualquer outro projeto.
--
-- Reverte as duas colunas aditivas em clinicas. Nenhuma tabela criada por
-- esta migration para reverter, nenhum dado copiado para desfazer.

alter table clinicas drop column if exists instancia_whatsapp;
alter table clinicas drop column if exists provider;
