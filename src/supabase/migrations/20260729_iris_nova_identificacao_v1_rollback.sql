-- Rollback de 20260729_iris_nova_identificacao_v1.sql
-- Ordem inversa de dependencia.

drop table if exists mensagens_recebidas;
drop table if exists estado_conversa;
drop table if exists pacientes;
drop table if exists clinicas;
