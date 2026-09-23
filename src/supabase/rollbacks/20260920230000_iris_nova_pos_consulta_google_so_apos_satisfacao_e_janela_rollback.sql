-- ROLLBACK da migration 20260920230000_iris_nova_pos_consulta_google_so_apos_satisfacao_e_janela.sql
-- (volta ao estado da 20260919204030). Arquivo de rollback: NUNCA entra no fluxo de migrations (DA-P4-03).
-- Gerado a partir dos corpos das funcoes da propria 20260919204030 (sem transcricao manual) e ENSAIADO no
-- Postgres local (src/supabase/aplicacao/ensaio-rollback-local.mjs: o estado volta identico).
--
-- USO: so com autorizacao explicita, por acao, DEPOIS do rollback da 20260921000000 e de decidir o que fazer com o
-- HISTORICO de migrations (ver reviews/runbook-aplicacao-pos-consulta-2026-09-20.md).
--
-- ATENCAO -- ISTO REINTRODUZ O COMPORTAMENTO QUE O CODEX CLASSIFICOU COMO BLOQUEADOR: o modo 'google' volta a enviar
-- o convite direto na primeira entrega (sem satisfacao positiva) e a janela de 48 h deixa de existir (o pre-filtro
-- voltaria a alcancar os agendamentos historicos). So restaurar com decisao explicita e com o Disparo A INATIVO.
--
-- TRAVA: se houver jornada 'encerrada' ja com convite gravado por este modelo nada e perdido, mas jornadas em
-- 'aguardando_satisfacao' de modo 'google' passam a seguir o comportamento antigo -- confira antes.

alter table public.pos_consulta_jornadas
  drop constraint if exists pos_consulta_jornadas_convite_gravado_so_se_positiva_ck,
  drop constraint if exists pos_consulta_jornadas_convite_so_se_positiva_ck,
  drop constraint if exists pos_consulta_jornadas_primeira_entrega_sem_convite_ck;

-- ── 2a. INICIAR JORNADA (autoriza e reivindica a PRIMEIRA entrega) ────────
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
begin
  if p_clinica_id is null or p_agendamento_id is null or p_paciente_id is null then
    raise exception 'identificador obrigatorio ausente' using errcode = 'check_violation';
  end if;
  if p_modo not in ('satisfacao', 'google', 'ambos') then
    raise exception 'modo fora do vocabulario aprovado' using errcode = 'check_violation';
  end if;

  -- ── B3: VINCULO SOB LOCK, incluindo o TELEFONE OFICIAL ────────────────
  -- Agendamento precisa pertencer a `p_clinica_id` E ser deste
  -- `p_paciente_id`; o paciente precisa pertencer a `p_clinica_id` E ter
  -- `telefone_normalizado` EXATAMENTE igual a `p_telefone_normalizado` --
  -- nunca um telefone arbitrario informado pelo chamador. As quatro
  -- condicoes juntas, nunca uma FK isolada.
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

  v_token := gen_random_uuid();
  v_entrega_id := gen_random_uuid();

  begin
    insert into pos_consulta_jornadas
      (clinica_id, agendamento_id, paciente_id, telefone_normalizado, modo,
       etapa, convite_pendente, link_avaliacao_google, entrega_id, entrega_claim_token, entrega_lease_expira_em)
    values
      (p_clinica_id, p_agendamento_id, p_paciente_id, p_telefone_normalizado, p_modo,
       'aguardando_inicio', p_convite_pendente, p_link_avaliacao_google, v_entrega_id, v_token, now() + make_interval(secs => 180))
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
      'modo', p_modo, 'convite_pendente', p_convite_pendente, 'link_avaliacao_google', p_link_avaliacao_google);
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
    -- RECLAIM: token NOVO, lease estendido -- mas `entrega_id` e
    -- `convite_pendente` PRESERVADOS (nunca regenerados/recalculados): a
    -- identidade da entrega e a decisao original permanecem estaveis.
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

-- ── 2b. REGISTRAR RESPOSTA PENDENTE (autoriza e reivindica a SEGUNDA
--        entrega, a partir da resposta de satisfacao ja classificada) ─────
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

-- ── 2c. CONFIRMAR ENTREGA ──────────────────────────────────────────────
-- Chamado pelo transporte/adaptador SO DEPOIS do envio real ter sido
-- aceito. NAO recebe mais a etapa de destino do chamador (B2) -- deriva
-- sozinha, a partir de `etapa`+`modo` ja gravados:
--   'aguardando_inicio' + modo 'google'            -> 'encerrada'
--   'aguardando_inicio' + modo 'satisfacao'/'ambos' -> 'aguardando_satisfacao'
--   'finalizando' (qualquer modo)                   -> 'encerrada'
-- Exige claim_token IGUAL ao gravado E lease AINDA VIGENTE (B2) -- um token
-- que bate mas cujo lease ja expirou e recusado ('lease_expirado'), porque
-- outro worker pode estar reclamando a mesma pendencia neste instante.
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
    v_etapa_confirmada := case when v_jornada.modo = 'google' then 'encerrada' else 'aguardando_satisfacao' end;
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
      -- Outra jornada do mesmo telefone ja esta ativa; a claim pendente
      -- NAO e liberada por esta chamada -- permanece disponivel para
      -- reclaim depois.
      return jsonb_build_object('resultado', 'conflito_telefone_ativo');
  end;

  return jsonb_build_object('resultado', 'confirmada');
end;
$$;

revoke all on function public.cappia_pos_consulta_confirmar_entrega(uuid, uuid, uuid) from public;
revoke all on function public.cappia_pos_consulta_confirmar_entrega(uuid, uuid, uuid) from anon;
revoke all on function public.cappia_pos_consulta_confirmar_entrega(uuid, uuid, uuid) from authenticated;
grant execute on function public.cappia_pos_consulta_confirmar_entrega(uuid, uuid, uuid) to service_role;

-- ── 2d. CANDIDATOS (PRE-FILTRO, NAO AUTORITATIVO) -- D3, revisao 4;
--        campos de instancia corrigidos -- E1, revisao 5 ─────────────────
-- Chamada pelo n8n (Disparo A) a cada ciclo, via PostgREST
-- (`rpc/cappia_pos_consulta_candidatos`), MESMO mecanismo ja usado em
-- producao por `pos_consulta_google_candidatos` (workflow legado
-- "Pos-Consulta - Avaliacao Google", intocado). Devolve so quem PODE ser
-- candidato -- todo campo aqui e recalculado do zero, em fonte autoritativa,
-- dentro de iris-nova-pos-consulta (C2). Esta funcao NUNCA decide
-- elegibilidade de verdade; existe so pra nao chamar a Edge Function pra
-- cada agendamento concluido que exista no banco.
--
-- E1 (quinta revisao) -- DOIS campos de instancia, sob nomes distintos,
-- nunca um so reaproveitado pro outro proposito.
-- FATO DESCOBERTO AO EXECUTAR O RUNNER (migrations-legado/
-- 20260804202732_iris_nova_compatibilidade_clinicas_legado.sql): no schema
-- OPERACIONAL, `clinicas.instancia_whatsapp` e uma coluna GERADA
-- (`generated always as (whatsapp_instancia) stored`). As duas colunas
-- existem, mas SEMPRE TEM O MESMO VALOR -- so os NOMES/PROPOSITOS diferem:
--   `instancia_whatsapp` -- usado por pos-consulta-resolver-clinica.ts
--     (identico a identificacao.ts/buscarClinica, ja em producao) para
--     RESOLVER/AUTENTICAR a clinica dentro da Edge Function
--     iris-nova-pos-consulta. E o valor que o n8n deve enviar no payload
--     `instancia_whatsapp` de "iniciar"/"confirmar".
--   `whatsapp_instancia` -- usado pelo node real de producao "RPC
--     pos_consulta_google_candidatos" (workflow legado) como
--     `instanceName` do node Evolution (n8n-nodes-evolution-api.evolutionApi)
--     -- confirmado por leitura do node "Montar Mensagem Deterministica",
--     que consome `item.whatsapp_instancia` direto da RPC legada. E o valor
--     que o n8n deve usar para ENVIAR pela Evolution, nunca para autenticar
--     a Edge Function.
-- A primeira versao desta funcao (D3) tinha os dois nomes colididos --
-- selecionava `c.whatsapp_instancia as instancia_whatsapp`. No operacional
-- isso era inofensivo na pratica (coluna gerada, valores iguais), mas era
-- fragil: se as colunas um dia deixarem de ser espelho (ex.: instancia
-- propria da Evolution por clinica), a Edge Function passaria a receber o
-- identificador errado. Corrigido selecionando as DUAS colunas, cada uma sob
-- o proprio nome. Provas: runner SQL (campo == coluna homonima; corpo da
-- funcao mapeia cada coluna sob o proprio nome) e
-- src/core/pos-consulta-n8n-instancias.test.ts (valores DIFERENTES no
-- payload do n8n, onde os dois campos podem de fato divergir).
--
-- Conversao de `pos_consulta_tempo` ('2h'/'4h'/'24h') pro mesmo mapeamento
-- deterministico de pos-consulta-carregar-configuracao.ts (D1) -- qualquer
-- outro valor (ausente, malformado) EXCLUI a clinica do resultado, nunca
-- aplica um prazo default silencioso.
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

drop function if exists public.cappia_pos_consulta_janela_maxima_minutos();
