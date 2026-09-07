-- Rollback de 20260907130000_iris_nova_contato_multiplos_pacientes_v1_fase_c.sql
--
-- DIRETAMENTE EXECUTAVEL. Nada a colar: a RPC de 6 params esta reproduzida
-- POR INTEIRO abaixo (corpo identico ao de
-- 20260809120000_iris_nova_persistencia_paciente_v1.sql -- qualquer
-- divergencia entre os dois deve ser tratada como defeito).
--
-- Este arquivo acompanha a migration da FASE C: quando a FASE C for movida
-- para src/supabase/migrations/ (apos o deploy B), mover este rollback junto,
-- para src/supabase/rollbacks/, mantendo o nome.
--
-- ── SEGURANCA ──────────────────────────────────────────────────────────
-- So e seguro ENQUANTO nenhum dado novo do modelo multi-paciente existir:
--   - nenhum pacientes com telefone_normalizado duplicado dentro da mesma
--     clinica (senao a recriacao das UNIQUEs de telefone falha);
--   - nenhuma linha de estado_conversa.paciente_id apontando para paciente
--     cujo (id, clinica_id, telefone_normalizado) nao case (senao a
--     recriacao da FK composta com telefone falha).
-- Depois que a feature "dependente / outra pessoa com o mesmo numero" tiver
-- criado a primeira ficha, este rollback deixa de ser aplicavel.
--
-- Ordem: primeiro as UNIQUEs de telefone de pacientes sao recriadas (a FK
-- composta com telefone da estado_conversa depende delas), depois a FK de
-- estado_conversa volta a forma com telefone, depois o NOT NULL sai, e por
-- fim a RPC de 6 params e recriada e a de 9 params e removida.

begin;

-- ── recriar as UNIQUEs de telefone de pacientes (ANTES da FK) ────────
-- Nome de producao (auto-gerado). No schema LOCAL a UNIQUE (clinica_id,
-- telefone_normalizado) chamava-se pacientes_clinica_telefone_key; ao
-- recriar aqui usamos o nome de producao, que e o alvo real do rollback.
alter table public.pacientes
  add constraint pacientes_clinica_id_telefone_normalizado_key unique (clinica_id, telefone_normalizado);

alter table public.pacientes
  add constraint pacientes_id_clinica_telefone_key unique (id, clinica_id, telefone_normalizado);

-- ── reverter a FK de estado_conversa para a forma COM telefone ─────────
alter table public.estado_conversa
  drop constraint if exists estado_conversa_paciente_clinica_fk;

alter table public.estado_conversa
  add constraint estado_conversa_paciente_clinica_telefone_fk
  foreign key (paciente_id, clinica_id, telefone_normalizado)
  references public.pacientes (id, clinica_id, telefone_normalizado);

-- ── tirar o NOT NULL de contato_id (a v114 volta a nao preencher) ──────
alter table public.pacientes
  alter column contato_id drop not null;

-- ── recriar a RPC cappia_persistir_paciente de 6 params (COMPLETA) ────
-- Corpo identico ao de 20260809120000_iris_nova_persistencia_paciente_v1.sql.
create or replace function public.cappia_persistir_paciente(
  p_clinica_id uuid,
  p_telefone_normalizado text,
  p_nome text,
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
  v_paciente_id uuid;
  v_constraint  text;
begin
  if p_clinica_id is null then
    return jsonb_build_object('sucesso', false, 'motivo', 'clinica_id_ausente');
  end if;

  v_telefone := btrim(coalesce(p_telefone_normalizado, ''));
  if v_telefone = '' then
    return jsonb_build_object('sucesso', false, 'motivo', 'telefone_normalizado_ausente');
  end if;

  -- nome e exigido em TODA chamada, criacao ou atualizacao. O Core chama com
  -- o estado cadastral atual conhecido, nao apenas com o campo digitado no
  -- turno -- decisao do Gabriel em 2026-08-09, que evita subconsulta interna,
  -- corrida especial e distincao criacao/atualizacao dentro da funcao.
  v_nome := btrim(coalesce(p_nome, ''));
  if v_nome = '' then
    return jsonb_build_object('sucesso', false, 'motivo', 'nome_ausente');
  end if;

  insert into pacientes
    (clinica_id, telefone_normalizado, nome, documento, data_nascimento, email)
  values (
    p_clinica_id,
    v_telefone,
    v_nome,
    nullif(btrim(p_documento), ''),
    p_data_nascimento,
    nullif(btrim(p_email), '')
  )
  on conflict (clinica_id, telefone_normalizado) do update
    -- nome sobrescreve porque e sempre enviado; os demais usam coalesce para
    -- que campo ausente NUNCA apague valor ja existente. A assimetria e
    -- deliberada e decorre da regra acima.
    set nome            = excluded.nome,
        documento       = coalesce(excluded.documento, pacientes.documento),
        data_nascimento = coalesce(excluded.data_nascimento, pacientes.data_nascimento),
        email           = coalesce(excluded.email, pacientes.email)
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

revoke all on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) from public;
revoke all on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) from anon;
revoke all on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) from authenticated;
grant execute on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) to service_role;

-- ── remover a RPC de 9 params (volta a ser exclusiva da FASE A) ───────
drop function if exists public.cappia_persistir_paciente(uuid, uuid, text, text, text, uuid, text, date, text);

commit;

-- Para reverter TAMBEM a FASE A depois desta, aplicar em seguida
-- src/supabase/rollbacks/20260907120000_iris_nova_contato_multiplos_pacientes_v1_fase_a_rollback.sql.
