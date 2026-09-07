-- Rollback de 20260907120000_iris_nova_contato_multiplos_pacientes_v1_fase_a.sql
--
-- Diretamente executavel (nada a colar). Ordem inversa da FASE A.
--
-- ── SEGURANCA ──────────────────────────────────────────────────────────
-- So e seguro ENQUANTO nenhum dado novo do modelo multi-paciente existir:
--   - nenhuma linha em contatos_whatsapp alem das criadas pelo backfill;
--   - nenhum pacientes.vinculo = 'dependente';
--   - nenhuma escrita de pacientes.contato_id fora do backfill (nenhum
--     paciente novo criado pela RPC de 9 params).
-- A FASE A nao removeu NADA da v114 (RPC de 6 params e UNIQUEs de telefone
-- continuam de pe), entao este rollback nao precisa restaurar nada dela --
-- apenas desfaz o que a FASE A adicionou.
--
-- `contatos_whatsapp` e derrubada por inteiro: como so contem o backfill,
-- nao ha perda de dado que importe (a informacao equivalente -- um contato
-- por telefone distinto -- e reconstruivel a qualquer momento a partir de
-- pacientes.telefone_normalizado).

begin;

-- A RPC de 9 params (criada AO LADO da de 6). A de 6 params permanece
-- intacta -- a FASE A nunca a tocou.
drop function if exists public.cappia_persistir_paciente(uuid, uuid, text, text, text, uuid, text, date, text);

drop index if exists public.pacientes_contato_id_idx;

alter table public.pacientes
  drop constraint if exists pacientes_contato_clinica_fk;

alter table public.pacientes
  drop constraint if exists pacientes_id_clinica_key;

alter table public.pacientes
  drop column if exists vinculo,
  drop column if exists contato_id;

drop table if exists public.contatos_whatsapp;

commit;
