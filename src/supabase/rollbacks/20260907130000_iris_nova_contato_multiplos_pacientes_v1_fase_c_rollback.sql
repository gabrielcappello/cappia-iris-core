-- Rollback de 20260907130000_iris_nova_contato_multiplos_pacientes_v1_fase_c.sql
--
-- DIRETAMENTE EXECUTAVEL. Nada a colar: a RPC de 6 params esta reproduzida
-- POR INTEIRO abaixo.
--
-- ── CORPO DA RPC DE 6 PARAMS: a versao CORRIGIDA de
--    20260810182322_iris_nova_persistir_paciente_coluna_fonte_legado.sql,
--    NAO a de 20260809120000. No operacional udizowyfjnhuhgxkeayk,
--    pacientes.telefone_normalizado e GENERATED ALWAYS AS ('55' || telefone):
--    a de 20260809120000 grava direto nessa coluna gerada e falha
--    (SQLSTATE 428C9). O rollback tem que restaurar a RPC de 6 params que
--    de fato FUNCIONA neste banco -- a de 20260810182322, que valida o
--    formato canonico, calcula v_telefone_bruto := substr(v_telefone, 3) e
--    grava a coluna FONTE `telefone`. (Corrigido em 2026-09-08 apos a
--    validacao A->B->C revelar o defeito na RPC de 9 params.)
--
-- Este arquivo acompanha a migration da FASE C, mas vai para um diretorio
-- DIFERENTE na promocao (apos o deploy B): a migration para
-- src/supabase/migrations/, este rollback para src/supabase/rollbacks/. O
-- rollback NUNCA pode entrar no caminho escaneado por `supabase db push`.
-- Caminhos explicitos, sem wildcard:
--   git mv src/supabase/migrations-pendentes-fase-c/20260907130000_iris_nova_contato_multiplos_pacientes_v1_fase_c.sql src/supabase/migrations/
--   git mv src/supabase/migrations-pendentes-fase-c/20260907130000_iris_nova_contato_multiplos_pacientes_v1_fase_c_rollback.sql src/supabase/rollbacks/
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
-- NAO recria o indice bare `pacientes_clinica_telefone_unique` sobre
-- (clinica_id, telefone): a FASE C nunca o removeu (ele nao e constraint),
-- entao ele continua existindo e nao ha o que restaurar.
--
-- Ordem: primeiro as UNIQUEs de telefone_normalizado de pacientes sao
-- recriadas (a FK composta com telefone_normalizado da estado_conversa
-- depende delas), depois a FK de estado_conversa volta a forma com
-- telefone_normalizado, depois o NOT NULL de contato_id sai, e por fim a RPC
-- de 6 params (versao coluna-fonte) e recriada e a de 9 params e removida.

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
-- Corpo identico ao de 20260810182322_iris_nova_persistir_paciente_coluna_
-- fonte_legado.sql -- a versao CORRIGIDA para a coluna FONTE `telefone`
-- (NAO a de 20260809120000, que grava na coluna gerada e falha 428C9).
create or replace function public.cappia_persistir_paciente(
  p_clinica_id           uuid,
  p_telefone_normalizado text,
  p_nome                 text,
  p_documento            text default null,
  p_data_nascimento      date default null,
  p_email                text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_telefone       text;
  v_telefone_bruto text;
  v_nome           text;
  v_paciente_id    uuid;
  v_constraint     text;
begin
  if p_clinica_id is null then
    return jsonb_build_object('sucesso', false, 'motivo', 'clinica_id_ausente');
  end if;

  v_telefone := btrim(coalesce(p_telefone_normalizado, ''));
  if v_telefone = '' then
    return jsonb_build_object('sucesso', false, 'motivo', 'telefone_normalizado_ausente');
  end if;

  -- ── TRADUCAO NO LIMITE DA PERSISTENCIA ────────────────────────────────
  -- Formato canonico aprovado (src/core/telefone.ts): prefixo 55 + 10 ou 11
  -- digitos nacionais. Fora dele e INVARIANTE DO CORE violada -> RAISE
  -- (falha fechado, vira ErroRpcTecnico no adaptador), nunca motivo
  -- conversacional novo.
  if v_telefone !~ '^55[0-9]{10,11}$' then
    raise exception 'telefone_normalizado fora do formato canonico'
      using errcode = 'check_violation';
  end if;

  -- telefone_normalizado e GENERATED ALWAYS AS ('55' || telefone) NESTE
  -- banco. Inversao EXATA: os dois primeiros caracteres sao sempre '55'.
  v_telefone_bruto := substr(v_telefone, 3);

  -- nome e exigido em TODA chamada, criacao ou atualizacao. O Core chama com
  -- o estado cadastral atual conhecido, nao apenas com o campo digitado no
  -- turno -- decisao do Gabriel em 2026-08-09, que evita subconsulta interna,
  -- corrida especial e distincao criacao/atualizacao dentro da funcao.
  v_nome := btrim(coalesce(p_nome, ''));
  if v_nome = '' then
    return jsonb_build_object('sucesso', false, 'motivo', 'nome_ausente');
  end if;

  -- Grava a coluna FONTE `telefone`; o PostgreSQL deriva telefone_normalizado.
  insert into pacientes
    (clinica_id, telefone, nome, documento, data_nascimento, email)
  values (
    p_clinica_id,
    v_telefone_bruto,
    v_nome,
    nullif(btrim(p_documento), ''),
    p_data_nascimento,
    nullif(btrim(p_email), '')
  )
  -- Arbitra por (clinica_id, telefone_normalizado) -- a constraint que a
  -- 20260804204134_legado criou e da qual o .maybeSingle() do Core depende.
  -- Como telefone_normalizado e funcao bijetiva de telefone, arbitrar por
  -- uma nunca deixa a outra disparar unique_violation (o UPDATE atualiza a
  -- propria linha dona daqueles valores).
  on conflict (clinica_id, telefone_normalizado) do update
    -- nome sobrescreve porque e sempre enviado; os demais usam coalesce para
    -- que campo ausente NUNCA apague valor ja existente. A assimetria e
    -- deliberada e decorre da regra acima. Nenhum telefone e tocado aqui: a
    -- linha em conflito ja tem o telefone certo, que e a propria chave.
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
$$;

revoke all on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) from public;
revoke all on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) from anon;
revoke all on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) from authenticated;
grant execute on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) to service_role;

-- ── remover a RPC de 9 params (volta a ser exclusiva da FASE A) ───────
drop function if exists public.cappia_persistir_paciente(uuid, uuid, text, text, text, uuid, text, date, text);

commit;

-- Para reverter TAMBEM a FASE A depois desta, aplicar em seguida
-- src/supabase/rollbacks/20260907120000_iris_nova_contato_multiplos_pacientes_v1_fase_a_rollback.sql.
