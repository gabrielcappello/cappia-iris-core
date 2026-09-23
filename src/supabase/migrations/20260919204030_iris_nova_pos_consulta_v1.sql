-- Iris Nova - pos-consulta conversacional (specs/pos-consulta-conversacional-v1.md)
--
-- Base normativa: specs/pos-consulta-conversacional-v1.md, aprovada pelo
-- Gabriel em 2026-09-15. Autoriza escrever esta migration em branch propria
-- -- NAO AUTORIZA aplicar em nenhum banco. Ver AGENTS.md: aplicacao depende
-- de aprovacao explicita, por acao, depois da revisao do Codex.
--
-- NAO APLICADA em nenhum projeto no momento desta escrita (nem dev, nem
-- operacional).
--
-- ── REVISAO 3 (esta versao) -- correcoes da SEGUNDA revisao do Codex
--    (reviews/revisao-pos-consulta-conversacional-v1.md, secao "Segunda
--    revisao -- 2026-09-16") ────────────────────────────────────────────
-- B1 -- os GRANTS SQL ja estavam corretos desde a revisao anterior; o achado
--   desta rodada era do RUNNER DE TESTE (nao desta migration): ele abria
--   `clienteA`/`clienteB` com a mesma `DATABASE_URL` do admin, sem
--   `set local role service_role`, entao a prova de B1 nunca exercitava o
--   papel restrito. Corrigido em
--   src/supabase/tests/executar-teste-pos-consulta-v1.mjs -- ver esse
--   arquivo. Esta migration ganhou, adicionalmente, asserts explicitos de
--   que `anon`/`authenticated` NUNCA tem privilegio nenhum (defesa em
--   profundidade, nao so ausencia de grant).
-- B2 -- DUAS correcoes:
--   1. `entrega_id` (coluna nova, uuid): identidade ESTAVEL da entrega
--      pendente, gerada UMA VEZ quando a pendencia comeca e PRESERVADA em
--      todo reclaim -- ao contrario de `entrega_claim_token` (que E a
--      autoridade transitoria do worker atual e GIRA a cada reclaim,
--      confusao apontada na revisao). `entrega_id` e o que o
--      adaptador/transporte deve usar como chave idempotente ao chamar o
--      provedor de WhatsApp, quando o provedor suportar deduplicacao por
--      chave externa.
--   2. `cappia_pos_consulta_confirmar_entrega` NAO recebe mais
--      `p_etapa_confirmada` do chamador -- a funcao DERIVA o destino a
--      partir de `etapa` + `modo` JA GRAVADOS na linha (nunca confia no
--      chamador para essa decisao, que e responsabilidade do Core, ja
--      fixada no momento da criacao/registro da pendencia). Confirmacao
--      agora TAMBEM exige `entrega_lease_expira_em > now()` -- um token que
--      ainda bate mas cujo lease ja expirou e recusado (`lease_expirado`,
--      resultado NOVO e distinto de `token_invalido`), porque outro worker
--      pode estar no meio de um reclaim concorrente.
-- B3 -- `iniciar_jornada` agora TAMBEM valida, sob o MESMO lock/join, que
--   `p_telefone_normalizado` e EXATAMENTE `pacientes.telefone_normalizado`
--   do paciente vinculado -- nunca um telefone arbitrario informado pelo
--   chamador. Sem isso, era possivel criar uma jornada correta (clinica,
--   agendamento e paciente validos) apontando para o telefone de outra
--   pessoa.
--
-- ── ACRESCIMO desta versao -- achado proprio ao implementar a Proposta C
--    (mensagens mistas, aprovada pelo Gabriel em 2026-09-16) ─────────────
-- `link_avaliacao_google` (coluna nova, nullable): o Disparo A (n8n) tem o
-- link no momento de INICIAR a jornada -- mas o fluxo REATIVO
-- (iris-nova-mensagem), que processa a RESPOSTA do paciente dias/minutos
-- depois, nao tem NENHUMA outra fonte para esse valor (n8n so reenvia a
-- mensagem crua, nunca a configuracao da clinica de novo). Sem persistir o
-- link na propria jornada, o modo 'ambos' seria estruturalmente incapaz de
-- montar o convite na resposta -- gap descoberto so ao implementar o
-- roteamento de mensagem mista, nunca antes. Gravado em `iniciar_jornada`
-- (so quando o modo usa Google); lido por
-- `pos-consulta-buscar-jornada-aberta.ts` para a integracao de mensagem
-- mista. NUNCA usado para decidir autorizacao -- `confirmar_entrega`
-- continua ignorando esta coluna por completo; quem autoriza o convite
-- continua sendo exclusivamente `convite_pendente`.
--
-- ── REVISAO 4 (esta versao) -- correcoes D1/D3 da QUARTA revisao do Codex
--    (reviews/revisao-pos-consulta-conversacional-v1.md) ───────────────────
-- D1 nao muda esta migration -- e uma correcao do LEITOR de configuracao no
--   Core (pos-consulta-carregar-configuracao.ts), que passou a ler as
--   chaves PLANAS reais do painel (`automatizacoes.pos_consulta_tipo` etc.),
--   nunca o objeto aninhado `automatizacoes.pos_consulta.*` que este arquivo
--   tinha inferido errado. Citada aqui so para registro -- ver esse arquivo.
-- D3 -- "workflow n8n nao e executavel": faltava a ORIGEM DOS CANDIDATOS.
--   Adicionada a funcao `cappia_pos_consulta_candidatos` (secao 2d abaixo),
--   no MESMO espirito da RPC ja usada em producao pelo workflow legado
--   (`pos_consulta_google_candidatos`, chamada via PostgREST a cada 15min) --
--   um PRE-FILTRO barato, NAO autoritativo: le `clinicas.automatizacoes` e
--   `agendamentos` so para reduzir o volume antes de chamar a Edge Function,
--   que RELE tudo de novo em fonte autoritativa (C2). Isso muda a garantia
--   "nao le configuracao de clinica" desta migration -- ver bullet
--   atualizado abaixo.
--
-- ── REVISAO 5 (esta versao) -- correcao E1 da QUINTA revisao do Codex ────
-- E1 -- a primeira versao de `cappia_pos_consulta_candidatos` (revisao 4)
--   selecionava `c.whatsapp_instancia as instancia_whatsapp`, colidindo DOIS
--   campos que tem propositos diferentes -- ver comentario detalhado na
--   secao 2d abaixo. Corrigido para devolver as duas colunas, cada uma sob o
--   proprio nome. (CORRECAO FACTUAL posterior, ao executar o runner SQL: no
--   schema OPERACIONAL `clinicas.instancia_whatsapp` e uma coluna GERADA
--   igual a `whatsapp_instancia` -- as duas nunca divergem no banco; a
--   distincao de nomes/propositos continua correta e util, mas a colisao
--   antiga nao causaria falha real la. Ver secao 2d.)
--
-- ── O QUE ESTA MIGRATION FAZ ─────────────────────────────────────────────
-- 1. Tabela nova `pos_consulta_jornadas` -- estado MINIMO exigido pela spec
--    secao 5, com os campos adicionais de autorizacao/entrega (B2). NUNCA
--    reaproveita `estado_conversa` nem o booleano legado
--    `agendamentos.pos_consulta_enviado`.
-- 2. Quatro funcoes: `cappia_pos_consulta_iniciar_jornada`,
--    `cappia_pos_consulta_registrar_resposta_pendente`,
--    `cappia_pos_consulta_confirmar_entrega` e (D3, revisao 4)
--    `cappia_pos_consulta_candidatos`. Nada alem disso.
--
-- ── O QUE ESTA MIGRATION NAO FAZ ─────────────────────────────────────────
--   - nao ESCREVE em `agendamentos` (so LEITURA, na RPC de candidatos, D3);
--   - nao ESCREVE configuracao de clinica -- so LEITURA, na RPC de
--     candidatos (D3), sempre como PRE-FILTRO nao autoritativo; a decisao
--     que de fato autoriza uma jornada continua sendo, exclusivamente, a
--     releitura feita pela Edge Function (C2);
--   - nao move nem apaga os registros da automacao deterministica antiga;
--   - nao desliga nem altera o workflow n8n antigo de avaliacao Google;
--   - nao cria disparador (cron/n8n) -- isso e codigo de transporte, fora de
--     migration; ver supabase/functions/iris-nova-pos-consulta/ (Disparo A,
--     aprovado pelo Gabriel em 2026-09-16, ainda nao publicado nem
--     deployado).
--
-- PREFLIGHT (obrigatorio, read-only, imediatamente antes de aplicar):
--   select table_name from information_schema.tables
--    where table_schema='public' and table_name='pos_consulta_jornadas';
--                                                           -- VAZIO
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public'
--      and p.proname in ('cappia_pos_consulta_iniciar_jornada',
--                         'cappia_pos_consulta_registrar_resposta_pendente',
--                         'cappia_pos_consulta_confirmar_entrega');
--                                                           -- VAZIO

-- ── 1. TABELA DE ESTADO DA JORNADA ────────────────────────────────────
create table public.pos_consulta_jornadas (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references public.clinicas(id) on delete cascade,
  agendamento_id uuid not null references public.agendamentos(id) on delete cascade,
  paciente_id uuid not null references public.pacientes(id) on delete cascade,
  -- Snapshot do telefone OFICIAL do paciente no INICIO da jornada (validado
  -- contra pacientes.telefone_normalizado na criacao -- ver B3). Snapshot
  -- deliberado, mesma logica de outros snapshots do Core: uma troca de
  -- telefone DEPOIS de a jornada comecar nao deveria redirecionar uma
  -- entrega ja em andamento.
  telefone_normalizado text not null,
  -- 'nenhum' nunca e persistido: a elegibilidade ja barra antes de a linha
  -- ser criada (pos-consulta-elegibilidade.ts).
  modo text not null,
  -- QUATRO valores -- duas etapas de PENDENCIA (aguardando_inicio,
  -- finalizando) e duas CONFIRMADAS (aguardando_satisfacao, encerrada).
  etapa text not null default 'aguardando_inicio',
  classificacao text,
  -- `true` quando a entrega PENDENTE atual (se houver) e um convite Google.
  convite_pendente boolean not null default false,
  convite_google_em timestamptz,
  -- Snapshot do link configurado NO INICIO da jornada, so quando o modo usa
  -- Google -- ver bloco "ACRESCIMO desta versao" no cabecalho. NUNCA usado
  -- para autorizar efeito (isso e exclusivamente `convite_pendente`); serve
  -- so para o fluxo reativo poder montar o texto do convite mais tarde.
  link_avaliacao_google text,
  -- Identidade ESTAVEL da entrega pendente atual (B2) -- gerada uma vez,
  -- preservada em todo reclaim. NULL exatamente quando `etapa` e uma etapa
  -- CONFIRMADA.
  entrega_id uuid,
  -- Autoridade TRANSITORIA do worker atual (B2) -- ao contrario de
  -- `entrega_id`, ESTE token GIRA a cada reclaim. E o que
  -- `confirmar_entrega` exige para aceitar a confirmacao.
  entrega_claim_token uuid,
  entrega_lease_expira_em timestamptz,
  iniciada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),

  -- Uma jornada por agendamento -- impede duas jornadas concorrentes para a
  -- mesma consulta (spec secao 5, criterio de aceite 7).
  unique (clinica_id, agendamento_id),

  check (modo in ('satisfacao', 'google', 'ambos')),
  check (etapa in ('aguardando_inicio', 'aguardando_satisfacao', 'finalizando', 'encerrada')),
  check (classificacao is null or classificacao in ('positiva', 'nao_positiva', 'incerta')),
  check (telefone_normalizado ~ '^[1-9][0-9]{7,14}$'),
  -- entrega_id/token/lease existem SOMENTE durante uma pendencia de
  -- entrega -- nunca numa etapa confirmada, nunca ausentes numa pendente.
  check ((etapa in ('aguardando_inicio', 'finalizando')) = (entrega_id is not null)),
  check ((etapa in ('aguardando_inicio', 'finalizando')) = (entrega_claim_token is not null)),
  check ((etapa in ('aguardando_inicio', 'finalizando')) = (entrega_lease_expira_em is not null))
);

create index pos_consulta_jornadas_clinica_id_idx on public.pos_consulta_jornadas (clinica_id);

-- B4 -- no maximo UMA jornada NAO ENCERRADA por clinica+telefone.
create unique index pos_consulta_jornadas_telefone_ativo_idx
  on public.pos_consulta_jornadas (clinica_id, telefone_normalizado)
  where etapa <> 'encerrada';

-- Busca da jornada ABERTA (aceita resposta) por clinica+telefone.
create index pos_consulta_jornadas_aguardando_satisfacao_idx
  on public.pos_consulta_jornadas (clinica_id, telefone_normalizado)
  where etapa = 'aguardando_satisfacao';

-- RLS fechada por padrao, revoke explicito. So o Core (service_role) acessa.
alter table public.pos_consulta_jornadas enable row level security;
revoke all on table public.pos_consulta_jornadas from public, anon, authenticated;
-- B1 -- 'insert' e 'update' SAO NECESSARIOS: as tres funcoes abaixo sao
-- `security invoker` e fazem INSERT/UPDATE diretos na tabela. Nunca
-- `delete` (nenhuma linha e apagada).
grant select, insert, update on table public.pos_consulta_jornadas to service_role;

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

-- ── ROLLBACK ────────────────────────────────────────────────────────────
-- drop function if exists public.cappia_pos_consulta_candidatos(integer);
-- drop function if exists public.cappia_pos_consulta_confirmar_entrega(uuid, uuid, uuid);
-- drop function if exists public.cappia_pos_consulta_registrar_resposta_pendente(uuid, uuid, text, boolean);
-- drop function if exists public.cappia_pos_consulta_iniciar_jornada(uuid, uuid, uuid, text, text, boolean, text);
-- drop table if exists public.pos_consulta_jornadas;
