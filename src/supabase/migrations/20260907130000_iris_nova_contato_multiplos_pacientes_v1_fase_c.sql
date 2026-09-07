-- Iris Nova - contato de WhatsApp com varios pacientes (v1) -- FASE C (destrutiva)
--
-- Base normativa: specs/contato-multiplos-pacientes-v1.md (aprovada 2026-09-07).
-- Handoff: handoffs/2026-09-07-contato-multiplos-pacientes.md (secao deploy/rollback).
-- Depende de: 20260907120000_..._v1_fase_a.sql JA APLICADA + deploy do codigo
-- desta frente (FASE B) JA feito.
--
-- ── STATUS: CANDIDATA LOCAL, NAO APLICADA, NAO AUTORIZADA ─────────────────
-- PENDENTE DE: (1) teste real da sequencia A->B->C num BRANCH descartavel de
-- dev; (2) autorizacao explicita do Gabriel, por acao.
--
-- ── O QUE ESTA FASE FAZ (e por que so aqui) ────────────────────────────
-- Remove o que a v114 usava e que a FASE A deixou de pe para nao regredir:
--   - troca estado_conversa_paciente_clinica_telefone_fk -> forma sem telefone
--     (permite selecionar pacientes de telefones diferentes na mesma conversa);
--   - remove as UNIQUEs de telefone de pacientes -- e o que hoje IMPEDE
--     inserir um dependente com o mesmo telefone do titular;
--   - aplica NOT NULL em pacientes.contato_id (backfill ja terminou na FASE A);
--   - DROP da RPC cappia_persistir_paciente de 6 params (a de 9 params, criada
--     na FASE A, passa a ser a unica).
--
-- ── JANELA CONTROLADA: aplicar IMEDIATAMENTE apos a FASE B, SEM TESTE
--    ENTRE B e C. O teste da sequencia inteira ja foi feito no branch
--    descartavel. Entre B e C a feature "dependente / outra pessoa com o
--    mesmo numero" nao funciona (colide com a UNIQUE de telefone); nada
--    REGRIDE. Depois de C a funcionalidade esta pronta. ───────────────────
--
-- ── NAO APLICADA EM NENHUM PROJETO. ─────────────────────────────────────

begin;

-- ── PASSO 5: trocar a FK de estado_conversa.paciente_id ─────────────────
-- Sai a forma composta com telefone (impossivel de satisfazer quando dois
-- pacientes de telefones diferentes puderem ser selecionados na mesma
-- conversa); entra a forma sem telefone, so com clinica_id. Alvo
-- (pacientes.pacientes_id_clinica_key) foi criado na FASE A.
alter table public.estado_conversa
  drop constraint estado_conversa_paciente_clinica_telefone_fk;

alter table public.estado_conversa
  add constraint estado_conversa_paciente_clinica_fk
  foreign key (paciente_id, clinica_id)
  references public.pacientes (id, clinica_id);

-- ── PASSO 6: remover as UNIQUEs de telefone de pacientes ────────────────
-- pacientes_id_clinica_telefone_key: a UNIQUE composta que INCLUI telefone
-- (criada pela migration de correcao). Removida para que telefone deixe de
-- ser parte da identidade de paciente.
alter table public.pacientes
  drop constraint if exists pacientes_id_clinica_telefone_key;

-- A UNIQUE (clinica_id, telefone_normalizado): local se chama
-- `pacientes_clinica_telefone_key`; producao tem o nome auto-gerado
-- `pacientes_clinica_id_telefone_normalizado_key`. Tenta os dois -- exige
-- que PELO MENOS um exista (nunca os dois ausentes: seria schema
-- inesperado, e ai a transacao deve abortar). REMOVER esta UNIQUE e o que
-- destrava a insercao de um dependente com o mesmo telefone do titular.
do $$
declare
  v_removidos integer := 0;
begin
  begin
    alter table public.pacientes drop constraint pacientes_clinica_telefone_key;
    v_removidos := v_removidos + 1;
  exception when undefined_object then null;
  end;
  begin
    alter table public.pacientes drop constraint pacientes_clinica_id_telefone_normalizado_key;
    v_removidos := v_removidos + 1;
  exception when undefined_object then null;
  end;
  if v_removidos = 0 then
    raise exception 'nenhuma UNIQUE (clinica_id, telefone_normalizado) encontrada em pacientes -- schema inesperado, abortando';
  end if;
end $$;

-- Agora que telefone nao e mais identidade e o backfill (FASE A) terminou:
alter table public.pacientes
  alter column contato_id set not null;

-- ── PASSO 5c: DROP da RPC cappia_persistir_paciente de 6 params ─────────
-- A de 9 params (criada na FASE A) passa a ser a unica. Ate aqui as duas
-- coexistiam como overloads e a v114 ainda podia chamar a de 6 -- por isso
-- este DROP so na FASE C, apos o deploy B ja ter substituido a v114.
drop function if exists public.cappia_persistir_paciente(uuid, text, text, text, date, text);

commit;

-- ── ROLLBACK DA FASE C (executavel; valido ENQUANTO nenhum dado novo do
--    modelo multi-paciente existir: nenhum dependente com telefone
--    duplicado, nenhuma selecao cross-contato gravada em
--    estado_conversa.paciente_id apontando para paciente de outro telefone).
--    Depois disso o rollback de C nao e mais seguro -- havera linhas que
--    violam as UNIQUEs de telefone recriadas. ────────────────────────────
--
-- begin;
--   -- recriar a RPC de 6 params a partir de
--   -- 20260809120000_iris_nova_persistencia_paciente_v1.sql (colar o
--   --  CREATE OR REPLACE FUNCTION ... (uuid, text, text, text, date, text) de la);
--   alter table public.pacientes alter column contato_id drop not null;
--   alter table public.pacientes
--     add constraint pacientes_clinica_id_telefone_normalizado_key unique (clinica_id, telefone_normalizado);
--   alter table public.pacientes
--     add constraint pacientes_id_clinica_telefone_key unique (id, clinica_id, telefone_normalizado);
--   alter table public.estado_conversa drop constraint estado_conversa_paciente_clinica_fk;
--   alter table public.estado_conversa
--     add constraint estado_conversa_paciente_clinica_telefone_fk
--     foreign key (paciente_id, clinica_id, telefone_normalizado)
--     references public.pacientes (id, clinica_id, telefone_normalizado);
-- commit;
--
-- Para reverter TAMBEM a FASE A depois desta, aplicar em seguida o bloco
-- -- ROLLBACK DA FASE A do arquivo 20260907120000_..._v1_fase_a.sql.
