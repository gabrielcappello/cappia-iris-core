-- Iris Nova - pos-consulta: (1) Google SO apos satisfacao positiva confirmada
-- e (2) janela maxima de idade do agendamento.
--
-- Base: revisao final do Codex (2026-09-20), bloqueadores 1 e 2 antes da
-- ativacao recorrente. ADITIVA sobre
-- 20260919204030_iris_nova_pos_consulta_v1.sql (aplicada no operacional, versao
-- registrada 20260919204030) -- NUNCA reescreve aquele arquivo; so
-- `alter table ... add constraint` e `create or replace function` (mesmas
-- assinaturas). NAO APLICADA em nenhum banco no momento desta escrita.
-- Aplicacao depende de autorizacao explicita, por acao (AGENTS.md).
--
-- COMO APLICAR -- PLANO CORRIGIDO (sexta revisao do Codex, bloqueador 2).
-- A versao deste ARQUIVO (20260920230000) e a que precisa constar no historico
-- remoto. NAO aplique por `apply_migration` do MCP: ele so aceita `name` e
-- `query` e o SERVIDOR gera a versao (timestamp do momento) -- o que descasou
-- 20260915120000 (arquivo) de 20260919204030 (registrada) e obrigaria a
-- renomear depois. Aplique com `supabase db push` a partir do workspace
-- preparado por src/supabase/aplicacao/preparar-workspace-db-push.mjs: a CLI
-- registra a versao DO NOME DO ARQUIVO, sem renomear depois e sem `migration
-- repair`. Esta migration e 20260921000000_..._recuperacao_entrega_pendente.sql
-- sao aplicadas JUNTAS, nesta ordem, no mesmo push. Roteiro (dry-run
-- obrigatorio + verificacao) em MANIFESTO.md; ensaiado contra o Postgres local
-- em src/supabase/aplicacao/ensaio-local-db-push.mjs.
--
-- ── (1) GOOGLE SO APOS SATISFACAO POSITIVA CONFIRMADA ────────────────────
-- Decisao do Gabriel: nenhum modo envia o convite/link do Google sem a
-- satisfacao positiva CONFIRMADA. Antes desta migration, o modo 'google'
-- enviava o convite direto na primeira entrega e encerrava a jornada
-- (`confirmar_entrega`: 'aguardando_inicio' + 'google' -> 'encerrada'), e o
-- Core marcava `convite_pendente = true` ja na primeira entrega. Agora:
--   - a PRIMEIRA entrega nunca e convite, em NENHUM modo: `iniciar_jornada`
--     recusa `p_convite_pendente` diferente de false;
--   - `confirmar_entrega` de 'aguardando_inicio' leva SEMPRE a
--     'aguardando_satisfacao' (o modo 'google' passa a perguntar primeiro, como
--     'ambos'; o convite so existe na SEGUNDA entrega);
--   - `registrar_resposta_pendente` so aceita `p_convite_pendente = true` com
--     classificacao 'positiva' E jornada em modo com Google ('google'/'ambos');
--     'satisfacao' nunca envia link;
--   - o proprio ESQUEMA impede o estado invalido (tres CHECKs abaixo): nem um
--     UPDATE direto de quem tenha privilegio consegue gravar convite pendente
--     ou `convite_google_em` sem 'positiva' + modo com Google, nem convite na
--     primeira entrega.
-- A tabela esta VAZIA no operacional (0 linhas) quando esta migration foi
-- escrita; mesmo assim os CHECKs validam linhas existentes ao serem criados.
--
-- ── (2) JANELA MAXIMA DE IDADE ───────────────────────────────────────────
-- Sem janela, `cappia_pos_consulta_candidatos` alcancaria hoje 90
-- agendamentos historicos da Clear Dent (24/08-09/09) e o fluxo enviaria
-- pergunta de satisfacao sobre consultas de semanas atras. A janela e contada
-- a partir de `agendamentos.concluido_em`; agendamento SEM `concluido_em` esta
-- fora da janela (falha fechado).
--   VALOR: 2880 minutos (48 horas) -- DECISAO DE PRODUTO A CONFIRMAR pelo
--   Gabriel ANTES de aplicar (a spec nao define o numero). Vive em UM lugar no
--   banco (`cappia_pos_consulta_janela_maxima_minutos()`) e em UM lugar no Core
--   (`JANELA_MAXIMA_POS_CONSULTA_MINUTOS`, pos-consulta-elegibilidade.ts); um
--   teste do Core le este arquivo e falha se os dois divergirem. O prazo
--   configuravel das clinicas (2h/4h/24h) e sempre MENOR que a janela.
--   - `cappia_pos_consulta_candidatos` (pre-filtro): exclui fora da janela;
--   - `iniciar_jornada` (autoritativo, sob lock): recusa com
--     'fora_da_janela' qualquer chamada que AUTORIZARIA uma entrega (jornada
--     nova OU reclaim) para agendamento fora da janela; replay de jornada ja
--     confirmada ('ja_existia') e lease vigente ('em_andamento') nao mudam;
--   - a elegibilidade autoritativa da Edge Function (pos-consulta-
--     elegibilidade.ts) passa a devolver 'janela_maxima_excedida'.
--
-- ── O QUE ESTA MIGRATION NAO FAZ ─────────────────────────────────────────
--   - nao cria nem altera tabela alem dos tres CHECKs;
--   - nao altera `confirmar_entrega` alem da derivacao de etapa;
--   - nao mexe no fluxo de inconformidade nem na divisao em varias mensagens
--     (frentes futuras);
--   - nao replica os demais filtros da RPC legada (`pos_consulta_enviado`,
--     `whatsapp_status`, telefone do agendamento) -- fora do escopo desta
--     rodada.
--
-- PREFLIGHT (obrigatorio, read-only, imediatamente antes de aplicar):
--   select count(*) from public.pos_consulta_jornadas;         -- esperado 0
--   select conname from pg_constraint
--    where conrelid = 'public.pos_consulta_jornadas'::regclass
--      and conname like 'pos_consulta_jornadas_%_ck';         -- VAZIO
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public'
--      and p.proname = 'cappia_pos_consulta_janela_maxima_minutos'; -- VAZIO
-- Se houver linhas em pos_consulta_jornadas, PARAR: os CHECKs poderiam falhar.

-- ── 1. CHECKs: o esquema impede convite sem satisfacao positiva ───────────
-- ATENCAO: um CHECK cuja expressao vale NULL PASSA. Com `classificacao` nula,
-- `classificacao = 'positiva'` seria NULL e o CHECK deixaria gravar convite sem
-- classificacao -- por isso `coalesce(classificacao = 'positiva', false)`.
alter table public.pos_consulta_jornadas
  add constraint pos_consulta_jornadas_primeira_entrega_sem_convite_ck
    check (etapa <> 'aguardando_inicio' or convite_pendente = false),
  add constraint pos_consulta_jornadas_convite_so_se_positiva_ck
    check (convite_pendente = false or (coalesce(classificacao = 'positiva', false) and modo in ('google', 'ambos'))),
  add constraint pos_consulta_jornadas_convite_gravado_so_se_positiva_ck
    check (convite_google_em is null or (coalesce(classificacao = 'positiva', false) and modo in ('google', 'ambos')));

-- ── 2. JANELA MAXIMA -- fonte unica no banco ──────────────────────────────
create or replace function public.cappia_pos_consulta_janela_maxima_minutos()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select 2880
$$;

revoke all on function public.cappia_pos_consulta_janela_maxima_minutos() from public;
revoke all on function public.cappia_pos_consulta_janela_maxima_minutos() from anon;
revoke all on function public.cappia_pos_consulta_janela_maxima_minutos() from authenticated;
grant execute on function public.cappia_pos_consulta_janela_maxima_minutos() to service_role;

-- ── 3a. INICIAR JORNADA -- primeira entrega nunca e convite; janela ───────
-- Corpo identico ao da migration 20260919204030, salvo: (a) recusa
-- `p_convite_pendente` diferente de false; (b) janela maxima antes de
-- autorizar (jornada nova OU reclaim), devolvendo 'fora_da_janela'.
create or replace function public.cappia_pos_consulta_iniciar_jornada(
  p_clinica_id            uuid,
  p_agendamento_id        uuid,
  p_paciente_id           uuid,
  p_telefone_normalizado  text,
  p_modo                  text,
  p_convite_pendente      boolean,
  p_link_avaliacao_google text default null::text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_entrega_id uuid;
  v_jornada pos_consulta_jornadas%rowtype;
  v_token uuid;
  v_concluido_em timestamptz;
  v_fora_da_janela boolean;
begin
  if p_clinica_id is null or p_agendamento_id is null or p_paciente_id is null then
    raise exception 'identificador obrigatorio ausente' using errcode = 'check_violation';
  end if;
  if p_modo not in ('satisfacao', 'google', 'ambos') then
    raise exception 'modo fora do vocabulario aprovado' using errcode = 'check_violation';
  end if;
  -- (1) A primeira entrega NUNCA e convite Google, em nenhum modo: a
  -- satisfacao positiva ainda nao foi confirmada.
  if p_convite_pendente is distinct from false then
    raise exception 'a primeira entrega nunca pode ser convite Google (satisfacao positiva ainda nao confirmada)' using errcode = 'check_violation';
  end if;

  -- ── B3: VINCULO SOB LOCK, incluindo o TELEFONE OFICIAL ────────────────
  perform 1
    from agendamentos a
    join pacientes p on p.id = a.paciente_id
   where a.id = p_agendamento_id
     and a.clinica_id = p_clinica_id
     and a.paciente_id = p_paciente_id
     and p.clinica_id = p_clinica_id
     and p.telefone_normalizado = p_telefone_normalizado
   for share of a, p;
  if not found then
    raise exception 'agendamento, paciente, clinica e telefone nao formam um vinculo valido' using errcode = 'check_violation';
  end if;

  -- (2) JANELA MAXIMA (autoritativa, sob o lock acima). Sem `concluido_em`,
  -- fora da janela (falha fechado).
  select a.concluido_em into v_concluido_em from agendamentos a where a.id = p_agendamento_id;
  v_fora_da_janela := v_concluido_em is null
    or v_concluido_em <= now() - make_interval(mins => public.cappia_pos_consulta_janela_maxima_minutos());

  -- Jornada NOVA fora da janela: nada e criado.
  if v_fora_da_janela and not exists (
    select 1 from pos_consulta_jornadas j
     where j.clinica_id = p_clinica_id and j.agendamento_id = p_agendamento_id
  ) then
    return jsonb_build_object('resultado', 'fora_da_janela');
  end if;

  v_token := gen_random_uuid();
  v_entrega_id := gen_random_uuid();

  begin
    insert into pos_consulta_jornadas
      (clinica_id, agendamento_id, paciente_id, telefone_normalizado, modo,
       etapa, convite_pendente, link_avaliacao_google, entrega_id, entrega_claim_token, entrega_lease_expira_em)
    values
      (p_clinica_id, p_agendamento_id, p_paciente_id, p_telefone_normalizado, p_modo,
       'aguardando_inicio', false, p_link_avaliacao_google, v_entrega_id, v_token, now() + make_interval(secs => 180))
    on conflict (clinica_id, agendamento_id) do nothing
    returning id into v_id;
  exception
    when unique_violation then
      -- So pode ser o indice parcial de telefone (B4): o de
      -- clinica_id+agendamento_id ja e absorvido pelo ON CONFLICT acima.
      return jsonb_build_object('resultado', 'conflito_telefone_ativo');
  end;

  if v_id is not null then
    return jsonb_build_object(
      'resultado', 'pendente', 'jornada_id', v_id, 'entrega_id', v_entrega_id, 'claim_token', v_token,
      'modo', p_modo, 'convite_pendente', false, 'link_avaliacao_google', p_link_avaliacao_google);
  end if;

  -- Corrida perdida para o MESMO agendamento -- ou reclaim de uma pendencia
  -- expirada, ou a jornada ja avancou (replay/reentrega).
  select * into v_jornada
    from pos_consulta_jornadas
   where clinica_id = p_clinica_id and agendamento_id = p_agendamento_id
   for update;

  if v_jornada.etapa = 'aguardando_inicio' then
    if v_jornada.entrega_lease_expira_em > now() then
      return jsonb_build_object('resultado', 'em_andamento');
    end if;
    -- RECLAIM tambem AUTORIZA uma entrega: fora da janela, nao.
    if v_fora_da_janela then
      return jsonb_build_object('resultado', 'fora_da_janela');
    end if;
    -- RECLAIM: token NOVO, lease estendido -- mas `entrega_id` e
    -- `convite_pendente` PRESERVADOS.
    update pos_consulta_jornadas
       set entrega_claim_token = v_token,
           entrega_lease_expira_em = now() + make_interval(secs => 180),
           atualizada_em = now()
     where id = v_jornada.id;
    return jsonb_build_object(
      'resultado', 'pendente', 'jornada_id', v_jornada.id, 'entrega_id', v_jornada.entrega_id, 'claim_token', v_token,
      'modo', v_jornada.modo, 'convite_pendente', v_jornada.convite_pendente,
      'link_avaliacao_google', v_jornada.link_avaliacao_google);
  end if;

  return jsonb_build_object('resultado', 'ja_existia', 'jornada_id', v_jornada.id, 'etapa', v_jornada.etapa);
end;
$$;

revoke all on function public.cappia_pos_consulta_iniciar_jornada(uuid, uuid, uuid, text, text, boolean, text) from public;
revoke all on function public.cappia_pos_consulta_iniciar_jornada(uuid, uuid, uuid, text, text, boolean, text) from anon;
revoke all on function public.cappia_pos_consulta_iniciar_jornada(uuid, uuid, uuid, text, text, boolean, text) from authenticated;
grant execute on function public.cappia_pos_consulta_iniciar_jornada(uuid, uuid, uuid, text, text, boolean, text) to service_role;

-- ── 3b. REGISTRAR RESPOSTA PENDENTE -- convite so com 'positiva' ──────────
-- Corpo identico ao da migration 20260919204030, salvo a guarda ANTES do
-- UPDATE que avanca para 'finalizando': `p_convite_pendente = true` exige
-- classificacao 'positiva' E modo com Google. Reclaim e replay nao mudam.
create or replace function public.cappia_pos_consulta_registrar_resposta_pendente(
  p_clinica_id       uuid,
  p_agendamento_id   uuid,
  p_classificacao    text,
  p_convite_pendente boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_jornada pos_consulta_jornadas%rowtype;
  v_token uuid;
  v_entrega_id uuid;
begin
  if p_clinica_id is null or p_agendamento_id is null then
    raise exception 'identificador obrigatorio ausente' using errcode = 'check_violation';
  end if;
  if p_classificacao not in ('positiva', 'nao_positiva', 'incerta') then
    raise exception 'classificacao fora do vocabulario aprovado' using errcode = 'check_violation';
  end if;
  if p_convite_pendente is null then
    raise exception 'convite_pendente obrigatorio' using errcode = 'check_violation';
  end if;

  select * into v_jornada
    from pos_consulta_jornadas
   where clinica_id = p_clinica_id and agendamento_id = p_agendamento_id
   for update;

  if not found then
    return jsonb_build_object('resultado', 'jornada_nao_encontrada');
  end if;

  if v_jornada.etapa = 'encerrada' then
    return jsonb_build_object('resultado', 'ja_processada');
  end if;

  if v_jornada.etapa = 'finalizando' then
    if v_jornada.entrega_lease_expira_em > now() then
      return jsonb_build_object('resultado', 'em_andamento');
    end if;
    v_token := gen_random_uuid();
    update pos_consulta_jornadas
       set entrega_claim_token = v_token,
           entrega_lease_expira_em = now() + make_interval(secs => 180),
           atualizada_em = now()
     where id = v_jornada.id;
    return jsonb_build_object(
      'resultado', 'pendente', 'entrega_id', v_jornada.entrega_id, 'claim_token', v_token,
      'classificacao', v_jornada.classificacao, 'convite_pendente', v_jornada.convite_pendente);
  end if;

  if v_jornada.etapa <> 'aguardando_satisfacao' then
    return jsonb_build_object('resultado', 'jornada_nao_aguarda_resposta');
  end if;

  -- Google SO com satisfacao positiva confirmada e modo que usa Google.
  if p_convite_pendente and (p_classificacao <> 'positiva' or v_jornada.modo not in ('google', 'ambos')) then
    raise exception 'convite Google exige satisfacao positiva confirmada e modo com Google' using errcode = 'check_violation';
  end if;

  v_token := gen_random_uuid();
  v_entrega_id := gen_random_uuid();
  update pos_consulta_jornadas
     set etapa = 'finalizando',
         classificacao = p_classificacao,
         convite_pendente = p_convite_pendente,
         entrega_id = v_entrega_id,
         entrega_claim_token = v_token,
         entrega_lease_expira_em = now() + make_interval(secs => 180),
         atualizada_em = now()
   where id = v_jornada.id;

  return jsonb_build_object(
    'resultado', 'pendente', 'entrega_id', v_entrega_id, 'claim_token', v_token,
    'classificacao', p_classificacao, 'convite_pendente', p_convite_pendente);
end;
$$;

revoke all on function public.cappia_pos_consulta_registrar_resposta_pendente(uuid, uuid, text, boolean) from public;
revoke all on function public.cappia_pos_consulta_registrar_resposta_pendente(uuid, uuid, text, boolean) from anon;
revoke all on function public.cappia_pos_consulta_registrar_resposta_pendente(uuid, uuid, text, boolean) from authenticated;
grant execute on function public.cappia_pos_consulta_registrar_resposta_pendente(uuid, uuid, text, boolean) to service_role;

-- ── 3c. CONFIRMAR ENTREGA -- nenhum modo encerra na primeira entrega ──────
-- Corpo identico ao da migration 20260919204030, salvo a derivacao de etapa:
--   'aguardando_inicio' (qualquer modo) -> 'aguardando_satisfacao'
--   'finalizando'       (qualquer modo) -> 'encerrada'
create or replace function public.cappia_pos_consulta_confirmar_entrega(
  p_clinica_id     uuid,
  p_agendamento_id uuid,
  p_claim_token    uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_jornada pos_consulta_jornadas%rowtype;
  v_etapa_confirmada text;
begin
  if p_clinica_id is null or p_agendamento_id is null or p_claim_token is null then
    raise exception 'identificador obrigatorio ausente' using errcode = 'check_violation';
  end if;

  select * into v_jornada
    from pos_consulta_jornadas
   where clinica_id = p_clinica_id and agendamento_id = p_agendamento_id
   for update;

  if not found then
    return jsonb_build_object('resultado', 'jornada_nao_encontrada');
  end if;

  if v_jornada.entrega_claim_token is null or v_jornada.entrega_claim_token <> p_claim_token then
    return jsonb_build_object('resultado', 'token_invalido');
  end if;

  if v_jornada.entrega_lease_expira_em <= now() then
    return jsonb_build_object('resultado', 'lease_expirado');
  end if;

  if v_jornada.etapa = 'aguardando_inicio' then
    v_etapa_confirmada := 'aguardando_satisfacao';
  elsif v_jornada.etapa = 'finalizando' then
    v_etapa_confirmada := 'encerrada';
  else
    -- Etapa ja confirmada (nao deveria ter token/lease preenchidos -- CHECK
    -- da tabela ja impede isso fisicamente). Falha fechado por exaustividade.
    return jsonb_build_object('resultado', 'jornada_nao_pendente');
  end if;

  begin
    update pos_consulta_jornadas
       set etapa = v_etapa_confirmada,
           entrega_id = null,
           entrega_claim_token = null,
           entrega_lease_expira_em = null,
           convite_google_em = case when convite_pendente then now() else convite_google_em end,
           convite_pendente = false,
           atualizada_em = now()
     where id = v_jornada.id;
  exception
    when unique_violation then
      -- B4 -- so pode ocorrer confirmando para 'aguardando_satisfacao'.
      return jsonb_build_object('resultado', 'conflito_telefone_ativo');
  end;

  return jsonb_build_object('resultado', 'confirmada');
end;
$$;

revoke all on function public.cappia_pos_consulta_confirmar_entrega(uuid, uuid, uuid) from public;
revoke all on function public.cappia_pos_consulta_confirmar_entrega(uuid, uuid, uuid) from anon;
revoke all on function public.cappia_pos_consulta_confirmar_entrega(uuid, uuid, uuid) from authenticated;
grant execute on function public.cappia_pos_consulta_confirmar_entrega(uuid, uuid, uuid) to service_role;

-- ── 3d. CANDIDATOS -- janela maxima (pre-filtro, nao autoritativo) ────────
-- Identica a da migration 20260919204030 (mesmas colunas e mesmos nomes de
-- instancia, E1), acrescida da janela maxima de idade.
create or replace function public.cappia_pos_consulta_candidatos(p_limit integer default 50)
returns table (
  clinica_id                 uuid,
  agendamento_id              uuid,
  paciente_id                 uuid,
  instancia_whatsapp           text,
  whatsapp_instancia           text,
  nome_clinica                text,
  procedimento_nome_exibido   text,
  dentista_nome_exibido       text
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select
    a.clinica_id,
    a.id as agendamento_id,
    a.paciente_id,
    c.instancia_whatsapp as instancia_whatsapp,
    c.whatsapp_instancia as whatsapp_instancia,
    c.nome as nome_clinica,
    a.procedimento as procedimento_nome_exibido,
    a.dentista_nome as dentista_nome_exibido
  from agendamentos a
  join clinicas c on c.id = a.clinica_id
  where a.status = 'concluido'
    and a.concluido_em is not null
    and (c.automatizacoes ->> 'pos_consulta_tipo') in ('satisfacao', 'google', 'ambos')
    and (c.automatizacoes ->> 'pos_consulta_tempo') in ('2h', '4h', '24h')
    and a.concluido_em + make_interval(mins => (case c.automatizacoes ->> 'pos_consulta_tempo'
           when '2h' then 120 when '4h' then 240 when '24h' then 1440 end)) <= now()
    -- JANELA MAXIMA de idade (mesma regra de iniciar_jornada).
    and a.concluido_em > now() - make_interval(mins => public.cappia_pos_consulta_janela_maxima_minutos())
    and not exists (
      select 1 from pos_consulta_jornadas j
       where j.clinica_id = a.clinica_id and j.agendamento_id = a.id
    )
  order by a.concluido_em asc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

revoke all on function public.cappia_pos_consulta_candidatos(integer) from public;
revoke all on function public.cappia_pos_consulta_candidatos(integer) from anon;
revoke all on function public.cappia_pos_consulta_candidatos(integer) from authenticated;
grant execute on function public.cappia_pos_consulta_candidatos(integer) to service_role;

-- ── ROLLBACK ────────────────────────────────────────────────────────────
-- 1) alter table public.pos_consulta_jornadas
--      drop constraint if exists pos_consulta_jornadas_convite_gravado_so_se_positiva_ck,
--      drop constraint if exists pos_consulta_jornadas_convite_so_se_positiva_ck,
--      drop constraint if exists pos_consulta_jornadas_primeira_entrega_sem_convite_ck;
-- 2) Reexecutar, na ordem, os `create or replace function` das quatro funcoes
--    (iniciar_jornada, registrar_resposta_pendente, confirmar_entrega,
--    candidatos) copiando os corpos de 20260919204030_iris_nova_pos_consulta_v1.sql
--    (secoes 2a-2d) -- isso RESTAURA o comportamento anterior (inclusive o
--    convite direto do modo 'google', que o Codex classificou como
--    bloqueador; so restaurar com decisao explicita).
-- 3) drop function if exists public.cappia_pos_consulta_janela_maxima_minutos();
