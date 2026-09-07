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
-- ── ONDE ESTE ARQUIVO VIVE ─────────────────────────────────────────────
-- Enquanto a FASE A nao foi deployada (FASE B), este arquivo fica em
-- src/supabase/migrations-pendentes-fase-c/ -- FORA do diretorio que
-- `supabase db push` escaneia (src/supabase/migrations/). So depois do
-- deploy B ele e movido para src/supabase/migrations/ por um comando unico:
--   git mv src/supabase/migrations-pendentes-fase-c/*.sql src/supabase/migrations/
-- e so entao um novo `supabase db push` o aplica (unica migration pendente).
--
-- ── O QUE ESTA FASE FAZ (e por que so aqui) ────────────────────────────
-- Remove o que a v114 usava e que a FASE A deixou de pe para nao regredir:
--   - troca estado_conversa_paciente_clinica_telefone_fk -> forma sem telefone
--     (permite selecionar pacientes de telefones diferentes na mesma conversa);
--   - re-executa o backfill de pacientes.contato_id (a v114 pode ter inserido
--     paciente sem contato_id entre a FASE A e a FASE B) e ABORTA se ainda
--     restar algum contato_id IS NULL;
--   - aplica NOT NULL em pacientes.contato_id;
--   - remove as UNIQUEs de telefone de pacientes -- e o que hoje IMPEDE
--     inserir um dependente com o mesmo telefone do titular;
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

-- ── PASSO 6a: RE-BACKFILL + GUARDA, imediatamente antes do SET NOT NULL ──
-- Entre a FASE A e a FASE B a v114 continua ativa e pode ter inserido
-- paciente pela RPC de 6 params -- que NAO preenche contato_id. Antes de
-- aplicar NOT NULL, refaz o backfill dos que ficaram sem contato (mesma
-- regra da FASE A: cada paciente e titular do contato do seu proprio
-- telefone; cria a linha de contato se ainda nao existir).
insert into public.contatos_whatsapp (clinica_id, telefone_normalizado)
select distinct p.clinica_id, p.telefone_normalizado
from public.pacientes p
where p.contato_id is null
  and p.telefone_normalizado is not null
  and not exists (
    select 1 from public.contatos_whatsapp c
    where c.clinica_id = p.clinica_id
      and c.telefone_normalizado = p.telefone_normalizado
  );

-- vinculo NAO e tocado: a coluna nasceu (FASE A) `not null default 'titular'`,
-- entao um paciente inserido pela v114 entre A e B ja tem 'titular'.
update public.pacientes p
set contato_id = c.id
from public.contatos_whatsapp c
where p.contato_id is null
  and c.clinica_id = p.clinica_id
  and c.telefone_normalizado = p.telefone_normalizado;

-- GUARDA: se ainda restar QUALQUER paciente sem contato_id (telefone
-- nulo, unico caso possivel agora), a transacao ABORTA -- nunca aplica
-- NOT NULL a coluna com linha invalida.
do $$
declare
  v_orfaos integer;
begin
  select count(*) into v_orfaos from public.pacientes where contato_id is null;
  if v_orfaos > 0 then
    raise exception 'FASE C abortada: % paciente(s) ainda sem contato_id (telefone_normalizado nulo) -- resolver antes de aplicar NOT NULL', v_orfaos;
  end if;
end $$;

-- ── PASSO 6b: NOT NULL em pacientes.contato_id ─────────────────────────
alter table public.pacientes
  alter column contato_id set not null;

-- ── PASSO 6c: remover as UNIQUEs de telefone de pacientes ──────────────
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

-- ── PASSO 5c: DROP da RPC cappia_persistir_paciente de 6 params ─────────
-- A de 9 params (criada na FASE A) passa a ser a unica. Ate aqui as duas
-- coexistiam como overloads e a v114 ainda podia chamar a de 6 -- por isso
-- este DROP so na FASE C, apos o deploy B ja ter substituido a v114.
drop function if exists public.cappia_persistir_paciente(uuid, text, text, text, date, text);

commit;

-- ── ROLLBACK: arquivo dedicado, diretamente executavel (recria a RPC de
--    6 params por inteiro -- nada a colar), ao lado deste arquivo:
--    20260907130000_iris_nova_contato_multiplos_pacientes_v1_fase_c_rollback.sql
--    Valido enquanto nenhum dado novo do modelo multi-paciente existir
--    (nenhum dependente com telefone duplicado, nenhuma selecao cross-contato
--    gravada). Para reverter TAMBEM a FASE A, aplicar em seguida
--    src/supabase/rollbacks/20260907120000_..._v1_fase_a_rollback.sql.
