-- Iris Nova - contato de WhatsApp com varios pacientes (v1) -- FASE A (aditiva)
--
-- Base normativa: specs/contato-multiplos-pacientes-v1.md (aprovada 2026-09-07).
-- Handoff: handoffs/2026-09-07-contato-multiplos-pacientes.md (secao deploy/rollback).
--
-- ── STATUS: CANDIDATA LOCAL, NAO APLICADA, NAO AUTORIZADA ─────────────────
-- CANDIDATA, compativel com o SCHEMA VERIFICADO (leitura de pg_constraint em
-- udizowyfjnhuhgxkeayk, 2026-09-07). PENDENTE DE:
--   1. teste real num BRANCH descartavel do Supabase de dev (bcmuqautblvjdqzhjfbw);
--   2. autorizacao explicita do Gabriel, por acao, antes de aplicar em QUALQUER projeto.
--
-- ── POR QUE DUAS FASES, EM DIRETORIOS DIFERENTES ───────────────────────
-- A migration original era um arquivo unico que, no MESMO commit de schema,
-- (a) adicionava contatos_whatsapp/contato_id/vinculo E (b) removia a RPC de
-- 6 params e as UNIQUEs de telefone de `pacientes` -- constraints das quais o
-- codigo em producao (v114) DEPENDE (a RPC antiga faz `INSERT ... ON CONFLICT
-- (clinica_id, telefone_normalizado)`, que exige a UNIQUE). Aplicar "partes"
-- de um arquivo unico nao e seguro.
--
-- A CLI Supabase (>= 2.111.0) NAO tem opcao de "parar apos a primeira":
-- `supabase db push` aplica TODAS as migrations pendentes em
-- src/supabase/migrations/. Para forcar A -> deploy B -> C fisicamente:
--
--   FASE A (este arquivo, JA em src/supabase/migrations/) -- ADITIVA,
--     retrocompativel com a v114: cria contatos_whatsapp; adiciona
--     pacientes.contato_id (NULLABLE) e pacientes.vinculo; backfill; UNIQUE
--     pacientes (id, clinica_id); FK composta de contato_id; indice; e CRIA a
--     RPC de 9 params AO LADO da de 6 params (nenhum DROP). NADA que a v114
--     usa e removido -- as UNIQUEs de telefone e a FK de estado_conversa
--     continuam intactas. `db push` aplica SO esta fase (a fase C ainda nem
--     esta no diretorio scaneado).
--
--   FASE C -- DESTRUTIVA. Ela e seu rollback ficam em
--     src/supabase/migrations-pendentes-fase-c/ (fora do diretorio que a CLI
--     escaneia). DEPOIS do deploy B, so a MIGRATION entra em
--     src/supabase/migrations/ e o ROLLBACK vai para src/supabase/rollbacks/
--     -- NUNCA o rollback no caminho escaneado pela CLI. Caminhos EXPLICITOS,
--     nada de wildcard:
--       git mv src/supabase/migrations-pendentes-fase-c/20260907130000_iris_nova_contato_multiplos_pacientes_v1_fase_c.sql src/supabase/migrations/
--       git mv src/supabase/migrations-pendentes-fase-c/20260907130000_iris_nova_contato_multiplos_pacientes_v1_fase_c_rollback.sql src/supabase/rollbacks/
--       supabase db push
--     e so entao a Fase C e aplicada -- e ela e a unica pendente nesse
--     momento. Sem selecao manual arriscada.
--
-- ── SEQUENCIA OBRIGATORIA: A -> B -> C, em JANELA CONTROLADA ─────────────
--   A. `supabase db push` -> aplica SO esta fase (v114 continua funcionando;
--      nada regride);
--   B. deploy do codigo desta frente (Core + Edge). A partir daqui o codigo
--      novo chama SO a RPC de 9 params. A funcionalidade de "dependente /
--      outra pessoa" que INSERE paciente com telefone ja usado por outro
--      AINDA NAO funciona -- ela colide com a UNIQUE (clinica_id,
--      telefone_normalizado) que so a fase C remove. Nada REGRIDE nesse
--      intervalo (a feature e nova);
--   C. `git mv` a MIGRATION da fase C para src/supabase/migrations/ e o
--      ROLLBACK dela para src/supabase/rollbacks/ (dois `git mv` explicitos,
--      ver acima), e `supabase db push` de novo, IMEDIATAMENTE apos B, sem
--      teste entre B e C (a sequencia inteira devera ser testada em branch
--      descartavel antes da producao). So depois de C a funcionalidade esta
--      pronta.
--
-- Rollback de cada fase: arquivo dedicado, diretamente executavel, em
-- src/supabase/rollbacks/ (fase A) e
-- src/supabase/migrations-pendentes-fase-c/ (fase C, ao lado da migration).
-- Valido ENQUANTO nenhum dado novo do modelo multi-paciente existir (nenhum
-- dependente criado, nenhuma selecao cross-contato gravada).
--
-- ── PRE-CONDICAO VERIFICADA (leitura de producao, 2026-09-07 -- spec 2.2) ──
-- Os 21 pacientes hoje em udizowyfjnhuhgxkeayk tem todos telefone_normalizado
-- preenchido -- o backfill nao encontra registro com telefone nulo. O RAISE
-- de guarda cobre o caso futuro.
--
-- ── NAO APLICADA EM NENHUM PROJETO. ─────────────────────────────────────

begin;

-- ── PASSO 1: contatos_whatsapp ──────────────────────────────────────────
-- Mesma disciplina de contatos_excecao_iris (20260828120000): clinica_id
-- not null, RLS habilitada, revoke explicito de public/anon/authenticated,
-- so service_role. `unique (id, clinica_id)` e alvo da FK composta de
-- pacientes.contato_id (spec secao 2.3).
create table public.contatos_whatsapp (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references public.clinicas(id),
  telefone_normalizado text not null,
  criado_em timestamptz not null default now(),
  constraint contatos_whatsapp_clinica_telefone_key unique (clinica_id, telefone_normalizado),
  -- alvo da FK composta (contato_id, clinica_id) em pacientes
  constraint contatos_whatsapp_id_clinica_key unique (id, clinica_id),
  -- mesmo formato brasileiro canonico ja exigido em pacientes/estado_conversa
  -- pela 20260729_iris_nova_identificacao_v1_correcao.sql
  constraint contatos_whatsapp_telefone_formato check (telefone_normalizado ~ '^55[0-9]{10,11}$')
);

alter table public.contatos_whatsapp enable row level security;
revoke all on table public.contatos_whatsapp from public, anon, authenticated;
grant select, insert, update, delete on table public.contatos_whatsapp to service_role;

-- ── PASSO 1b: colunas novas em pacientes ────────────────────────────────
-- contato_id nasce NULLABLE (o backfill do passo 3 preenche; o NOT NULL fica
-- para a FASE C). vinculo com default 'titular': todo paciente hoje
-- cadastrado e titular do proprio contato (passo 3).
alter table public.pacientes
  add column contato_id uuid,
  add column vinculo text not null default 'titular'
    constraint pacientes_vinculo_valido check (vinculo in ('titular', 'dependente'));

-- ── PASSO 2: uma linha de contato por telefone distinto ─────────────────
insert into public.contatos_whatsapp (clinica_id, telefone_normalizado)
select distinct clinica_id, telefone_normalizado
from public.pacientes
where telefone_normalizado is not null;

-- ── PASSO 3: backfill de pacientes.contato_id (titular do proprio contato) ─
update public.pacientes p
set contato_id = c.id
from public.contatos_whatsapp c
where c.clinica_id = p.clinica_id
  and c.telefone_normalizado = p.telefone_normalizado;

-- Guarda: se algum paciente ficou sem contato_id (telefone nulo), a
-- transacao ABORTA aqui em vez de a FASE C aplicar NOT NULL e falhar sem
-- contexto. Pre-condicao verificada diz que isso nao acontece hoje -- este
-- RAISE existe para o caso futuro (spec secao 2.2).
do $$
declare
  v_orfaos integer;
begin
  select count(*) into v_orfaos from public.pacientes where contato_id is null;
  if v_orfaos > 0 then
    raise exception 'backfill contato_id incompleto: % paciente(s) sem telefone_normalizado', v_orfaos;
  end if;
end $$;

-- ── PASSO 4: recriar pacientes unique (id, clinica_id) ──────────────────
-- Dropada pela 20260729_iris_nova_identificacao_v1_correcao.sql. Necessaria
-- como alvo da nova FK de estado_conversa (aplicada na FASE C). Criar aqui,
-- na FASE A, e aditivo -- nada passa a falhar.
alter table public.pacientes
  add constraint pacientes_id_clinica_key unique (id, clinica_id);

-- ── PASSO 1c: FK composta de pacientes.contato_id ──────────────────────
-- (contato_id, clinica_id) -> contatos_whatsapp(id, clinica_id): um
-- paciente nunca aponta para um contato de OUTRA clinica (spec secao 2.3).
-- Aplicada aqui, depois do backfill: nao ha linha invalida a barrar. A v114
-- nunca escreve contato_id, entao esta FK nao a afeta.
alter table public.pacientes
  add constraint pacientes_contato_clinica_fk
  foreign key (contato_id, clinica_id)
  references public.contatos_whatsapp (id, clinica_id);

-- ── Indice de apoio: pacientes por contato ─────────────────────────────
-- buscarPaciente (codigo da FASE B) passa a listar pacientes de um contato
-- (identificacao.ts, spec secao 5.1). Sem indice, vira full scan a cada
-- turno. Aditivo -- criar ja na FASE A.
create index pacientes_contato_id_idx on public.pacientes (contato_id);

-- ── PASSO 5b: RPC cappia_persistir_paciente -- NOVA assinatura, AO LADO ──
-- Ganha p_contato_id (obrigatorio) e p_paciente_id (opcional). Nova regra de
-- conflito (spec secao 5.2):
--   - p_paciente_id informado: UPDATE ... WHERE id = p_paciente_id AND
--     contato_id = p_contato_id (nunca por telefone)
--   - p_paciente_id null: INSERT vinculado a p_contato_id, com vinculo
--     explicito (nunca ON CONFLICT por telefone)
--
-- IMPORTANTE (FASE A): a funcao de 6 params NAO e removida aqui. As duas
-- coexistem como overloads (aridades diferentes). A v114 chama a de 6; o
-- codigo da FASE B chama a de 9. O DROP da de 6 params e da FASE C.
create or replace function public.cappia_persistir_paciente(
  p_clinica_id uuid,
  p_contato_id uuid,
  p_telefone_normalizado text,
  p_nome text,
  p_vinculo text default 'titular',
  p_paciente_id uuid default null,
  p_documento text default null,
  p_data_nascimento date default null,
  p_email text default null
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_telefone    text;
  v_nome        text;
  v_vinculo     text;
  v_paciente_id uuid;
  v_constraint  text;
begin
  if p_clinica_id is null then
    return jsonb_build_object('sucesso', false, 'motivo', 'clinica_id_ausente');
  end if;

  if p_contato_id is null then
    return jsonb_build_object('sucesso', false, 'motivo', 'contato_id_ausente');
  end if;

  v_telefone := btrim(coalesce(p_telefone_normalizado, ''));
  if v_telefone = '' then
    return jsonb_build_object('sucesso', false, 'motivo', 'telefone_normalizado_ausente');
  end if;

  -- nome exigido em TODA chamada, criacao ou atualizacao (decisao do Gabriel
  -- 2026-08-09 -- inalterada).
  v_nome := btrim(coalesce(p_nome, ''));
  if v_nome = '' then
    return jsonb_build_object('sucesso', false, 'motivo', 'nome_ausente');
  end if;

  v_vinculo := btrim(coalesce(p_vinculo, ''));
  if v_vinculo not in ('titular', 'dependente') then
    return jsonb_build_object('sucesso', false, 'motivo', 'vinculo_invalido');
  end if;

  if p_paciente_id is not null then
    -- ATUALIZACAO de paciente ja selecionado. Nunca por telefone: a chave e
    -- (id, contato_id). Um paciente_id que nao pertenca a este contato nao e
    -- atualizado (0 linhas -> paciente_nao_encontrado).
    update public.pacientes
      set nome            = v_nome,
          documento       = coalesce(nullif(btrim(p_documento), ''), documento),
          data_nascimento = coalesce(p_data_nascimento, data_nascimento),
          email           = coalesce(nullif(btrim(p_email), ''), email)
    where id = p_paciente_id
      and contato_id = p_contato_id
      and clinica_id = p_clinica_id
    returning id into v_paciente_id;

    if v_paciente_id is null then
      return jsonb_build_object('sucesso', false, 'motivo', 'paciente_nao_encontrado');
    end if;

    return jsonb_build_object('sucesso', true, 'paciente_id', v_paciente_id);
  end if;

  -- CRIACAO de paciente novo, vinculado a p_contato_id. Sem ON CONFLICT por
  -- telefone.
  --
  -- NOTA DE JANELA (FASE A -> C): enquanto a UNIQUE (clinica_id,
  -- telefone_normalizado) existir (ou seja, ATE a FASE C), um INSERT aqui com
  -- um telefone JA usado por outro paciente da mesma clinica lanca
  -- unique_violation. E por isso que a feature "dependente / outra pessoa com
  -- o mesmo numero" so fica pronta APOS a FASE C. O bloco exception abaixo
  -- traduz `pacientes_clinica_id_documento_key` (CPF) e re-lanca o resto --
  -- inclusive essa colisao de telefone, que na janela A->C sobe como erro
  -- tecnico (esperado; a janela e curta e controlada).
  insert into public.pacientes
    (clinica_id, contato_id, telefone_normalizado, nome, vinculo, documento, data_nascimento, email)
  values (
    p_clinica_id,
    p_contato_id,
    v_telefone,
    v_nome,
    v_vinculo,
    nullif(btrim(p_documento), ''),
    p_data_nascimento,
    nullif(btrim(p_email), '')
  )
  returning id into v_paciente_id;

  return jsonb_build_object('sucesso', true, 'paciente_id', v_paciente_id);

exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'pacientes_clinica_id_documento_key' then
      return jsonb_build_object('sucesso', false, 'motivo', 'cpf_ja_cadastrado');
    end if;
    raise;
end;
$function$;

revoke all on function public.cappia_persistir_paciente(uuid, uuid, text, text, text, uuid, text, date, text) from public;
revoke all on function public.cappia_persistir_paciente(uuid, uuid, text, text, text, uuid, text, date, text) from anon;
revoke all on function public.cappia_persistir_paciente(uuid, uuid, text, text, text, uuid, text, date, text) from authenticated;
grant execute on function public.cappia_persistir_paciente(uuid, uuid, text, text, text, uuid, text, date, text) to service_role;

commit;

-- ── ROLLBACK: arquivo dedicado, diretamente executavel, em
--    src/supabase/rollbacks/20260907120000_iris_nova_contato_multiplos_pacientes_v1_fase_a_rollback.sql
--    (valido enquanto nenhum dado novo do modelo multi-paciente existir).
