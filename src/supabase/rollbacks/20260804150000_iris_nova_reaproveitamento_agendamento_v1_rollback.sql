-- Rollback de 20260804150000_iris_nova_reaproveitamento_agendamento_v1.sql
-- Ordem inversa de dependencia: funcoes antes das tabelas (a funcao
-- principal depende das 3 auxiliares e das 3 tabelas). Ajustes feitos em
-- clinicas/pacientes (tabelas que ja existiam, nao criadas por esta
-- migration) sao revertidos por ultimo.

drop function if exists public.cappia_reservar_agendamento(uuid, date, text, text, uuid, uuid, text, text, text, text, text, text, text, text);
drop function if exists public.cappia__resolver_duracao(uuid, uuid, text);
drop function if exists public.cappia__resolver_procedimento(uuid, uuid, text, text);
drop function if exists public.cappia__resolver_dentista(uuid, uuid, text);

drop table if exists horarios_bloqueados;
drop table if exists agendamentos;
drop table if exists procedimentos_catalogo;

-- Correcoes de 2026-08-04 (Codex): reverter ajustes feitos em tabelas
-- existentes, nao dropadas por esta migration.
alter table pacientes drop constraint if exists pacientes_id_clinica_id_key;

alter table clinicas drop column if exists fuso_horario;
alter table clinicas drop column if exists dentistas;
