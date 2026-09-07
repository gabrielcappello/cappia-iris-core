-- Iris Nova - um contato de WhatsApp pode representar varios pacientes (v1)
--
-- Base normativa: specs/contato-multiplos-pacientes-v1.md (aprovada 2026-09-07).
--
-- Projeto-alvo: cappia-iris-core-dev (bcmuqautblvjdqzhjfbw) -- ambiente
-- isolado de desenvolvimento e testes da Iris Nova. PROIBIDO aplicar em
-- udizowyfjnhuhgxkeayk sem migration irma propria e autorizacao explicita:
-- os dois esquemas divergiram (ver historico em
-- 20260809120000_iris_nova_persistencia_paciente_v1.sql).
--
-- ── ESTADO REAL DE PRODUCAO (verificado por leitura de pg_constraint em
--    udizowyfjnhuhgxkeayk, 2026-09-07 -- registrado na spec secao 2.2) ─────
--   - pacientes_id_clinica_telefone_key unique (id, clinica_id, telefone_normalizado): EXISTE
--   - estado_conversa_paciente_clinica_telefone_fk (paciente_id, clinica_id,
--     telefone_normalizado) -> pacientes(id, clinica_id, telefone_normalizado): EXISTE
--   - pacientes_clinica_id_telefone_normalizado_key unique (clinica_id,
--     telefone_normalizado): EXISTE (nome auto-gerado; a migration local
--     20260729_iris_nova_identificacao_v1.sql a declara como
--     pacientes_clinica_telefone_key, mas producao tem o nome auto-gerado)
--   - pacientes_id_clinica_key unique (id, clinica_id): NAO existe -- foi
--     dropada pela 20260729_iris_nova_identificacao_v1_correcao.sql como
--     "redundante" ao criar pacientes_id_clinica_telefone_key
--   - agendamentos_paciente_id_fkey (paciente_id) -> pacientes(id): FK SIMPLES,
--     sem clinica_id. Esta migration NAO a altera (spec secao 1.3 e 6).
--
-- Este arquivo tenta cobrir os DOIS jogos de nomes de constraint (local e
-- producao) para a UNIQUE de telefone, via DO/EXCEPTION -- ver bloco final.
--
-- ── ESCOPO (spec secao 2.1 e 6) ──────────────────────────────────────────
--   1 tabela nova: contatos_whatsapp
--   2 colunas novas em pacientes: contato_id (FK composta com clinica_id),
--     vinculo ('titular' | 'dependente')
--   recria pacientes unique (id, clinica_id) (alvo da nova FK de estado_conversa)
--   troca estado_conversa_paciente_clinica_telefone_fk -> forma sem telefone
--   remove a proteção write-once de estado_conversa.paciente_id: fica so na
--     aplicacao (identificacao.ts) -- nada a fazer no schema aqui
--   remove as UNIQUEs de telefone de pacientes (telefone deixa de ser
--     identidade de paciente)
--
-- NAO cria: relacao muitos-para-muitos, tabela intermediaria, fiscal,
-- heuristica, coluna nova em estado_conversa. NAO altera a FK de agendamentos.
-- NAO repara os dados ja corrompidos (Carlos/Marta) -- operacao separada.
--
-- ── PRE-CONDICAO VERIFICADA (leitura de producao, 2026-09-07 -- spec 2.2) ──
-- Os 21 pacientes hoje presentes em udizowyfjnhuhgxkeayk tem todos
-- telefone_normalizado preenchido -- o backfill nao encontra registro com
-- telefone nulo no estado atual. Nenhum tratamento adicional para
-- telefone_normalizado nulo e criado aqui.
--
-- ── ORDEM DA TRANSICAO (spec secao 2.2, 7 passos) ────────────────────────
--   1. criar contatos_whatsapp (com unique (id, clinica_id))
--   2. uma linha em contatos_whatsapp por (clinica_id, telefone_normalizado)
--      distinto hoje em pacientes
--   3. preencher pacientes.contato_id de cada paciente com o contato do seu
--      proprio telefone; vinculo = 'titular' (comportamento atual preservado)
--   4. recriar pacientes unique (id, clinica_id)
--   5. trocar estado_conversa_paciente_clinica_telefone_fk -> (paciente_id,
--      clinica_id) references pacientes(id, clinica_id)
--   6. so entao remover as UNIQUEs de telefone de pacientes e aplicar
--      NOT NULL em pacientes.contato_id
--   7. (dados corrompidos migram como estao -- fora de escopo)
--
-- ── NAO APLICADA em nenhum projeto no momento desta escrita. ─────────────

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
-- contato_id nasce NULLABLE (o backfill do passo 3 preenche antes de o
-- passo 6 aplicar NOT NULL). vinculo com default 'titular': todo paciente
-- hoje cadastrado e titular do proprio contato (passo 3).
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
-- transacao ABORTA aqui em vez de aplicar NOT NULL depois e falhar sem
-- contexto. Pre-condicao verificada diz que isso nao acontece no estado
-- atual -- este RAISE existe para o caso futuro (spec secao 2.2).
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
-- como alvo da nova FK de estado_conversa (passo 5).
alter table public.pacientes
  add constraint pacientes_id_clinica_key unique (id, clinica_id);

-- ── PASSO 1c: FK composta de pacientes.contato_id ──────────────────────
-- (contato_id, clinica_id) -> contatos_whatsapp(id, clinica_id): um
-- paciente nunca aponta para um contato de OUTRA clinica (spec secao 2.3).
-- Aplicada aqui, depois do backfill: nao ha linha invalida a barrar.
alter table public.pacientes
  add constraint pacientes_contato_clinica_fk
  foreign key (contato_id, clinica_id)
  references public.contatos_whatsapp (id, clinica_id);

-- ── PASSO 5: trocar a FK de estado_conversa.paciente_id ─────────────────
-- Sai a forma composta com telefone (impossivel de satisfazer quando dois
-- pacientes de telefones diferentes puderem ser selecionados na mesma
-- conversa); entra a forma sem telefone, so com clinica_id.
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
-- inesperado, e ai a transacao deve abortar).
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

-- Agora que telefone nao e mais identidade e o backfill terminou:
alter table public.pacientes
  alter column contato_id set not null;

-- ── Indice de apoio: pacientes por contato ─────────────────────────────
-- buscarPaciente passa a listar pacientes de um contato (identificacao.ts,
-- spec secao 5.1). Sem indice, vira full scan em pacientes a cada turno.
create index pacientes_contato_id_idx on public.pacientes (contato_id);

-- ── PASSO 5b: RPC cappia_persistir_paciente -- nova assinatura ──────────
-- Ganha p_contato_id (obrigatorio) e p_paciente_id (opcional). Nova regra
-- de conflito (spec secao 5.2):
--   - p_paciente_id informado: UPDATE ... WHERE id = p_paciente_id AND
--     contato_id = p_contato_id (nunca por telefone)
--   - p_paciente_id null: INSERT vinculado a p_contato_id, com vinculo
--     explicito (nunca ON CONFLICT por telefone -- essa constraint nao
--     existe mais em pacientes)
--
-- p_telefone_normalizado CONTINUA na assinatura: e o telefone de contato
-- do paciente, gravado na linha de `pacientes` (a coluna nao muda). Deixa
-- de ser chave de conflito, nunca deixa de ser dado.
--
-- A funcao antiga (6 params) e removida: a nova tem aridade diferente,
-- entao as duas coexistiriam como overloads e o Core poderia chamar a
-- errada. DROP explicito.
drop function if exists public.cappia_persistir_paciente(uuid, text, text, text, date, text);

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
  -- telefone -- essa constraint nao existe mais.
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

-- ── ROLLBACK (ordem inversa; so seguro se nenhum paciente novo tiver
--    nascido com contato_id de outro telefone e nenhuma selecao cross-contato
--    tiver sido gravada em estado_conversa.paciente_id) ───────────────────
-- begin;
--   drop function if exists public.cappia_persistir_paciente(uuid, uuid, text, text, text, uuid, text, date, text);
--   -- recriar a funcao de 6 params a partir de
--   -- 20260809120000_iris_nova_persistencia_paciente_v1.sql
--   drop index if exists public.pacientes_contato_id_idx;
--   alter table public.pacientes alter column contato_id drop not null;
--   alter table public.pacientes add constraint pacientes_clinica_telefone_key unique (clinica_id, telefone_normalizado);
--   alter table public.pacientes add constraint pacientes_id_clinica_telefone_key unique (id, clinica_id, telefone_normalizado);
--   alter table public.estado_conversa drop constraint estado_conversa_paciente_clinica_fk;
--   alter table public.estado_conversa add constraint estado_conversa_paciente_clinica_telefone_fk
--     foreign key (paciente_id, clinica_id, telefone_normalizado)
--     references public.pacientes (id, clinica_id, telefone_normalizado);
--   alter table public.pacientes drop constraint pacientes_contato_clinica_fk;
--   alter table public.pacientes drop constraint pacientes_id_clinica_key;
--   alter table public.pacientes drop column contato_id, drop column vinculo;
--   drop table public.contatos_whatsapp;
-- commit;
