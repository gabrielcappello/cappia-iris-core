-- Iris Nova - pos-consulta: RECUPERACAO de entregas pendentes com lease expirado
-- e NENHUM CAMINHO QUE PRENDA O TELEFONE.
--
-- Base: sexta revisao do Codex (2026-09-20), bloqueador 1 antes da ativacao
-- recorrente, ampliada pela SETIMA revisao (tres caminhos que ainda prendiam o
-- telefone: vinculo rompido, automacao desligada e jornada sem resposta -- todos
-- incorporados AQUI, antes de qualquer aplicacao). ADITIVA sobre 20260920230000_iris_nova_pos_consulta_google_so_apos_satisfacao_e_janela.sql
-- (que por sua vez e aditiva sobre 20260919204030_iris_nova_pos_consulta_v1.sql,
-- ja registrada no operacional). NAO APLICADA em nenhum banco no momento desta
-- escrita; aplicacao depende de autorizacao explicita, por acao (AGENTS.md).
--
-- ── O PROBLEMA ───────────────────────────────────────────────────────────
-- Uma entrega e AUTORIZADA e reservada (lease de 180 s) antes de o transporte
-- enviar; a confirmacao vem depois do envio real. Se o worker cai, ou o envio
-- falha, ou a confirmacao nao chega, a jornada fica PENDENTE ('aguardando_inicio'
-- na primeira entrega, 'finalizando' na segunda) com o lease vencido. Ate aqui
-- ninguem a recuperava: `cappia_pos_consulta_candidatos` excluia QUALQUER
-- agendamento que ja tivesse jornada, entao o Disparo A nunca a reprocessava, e
-- a jornada continuava ocupando o indice de telefone ativo (B4) para sempre --
-- bloqueando toda jornada futura daquele telefone.
--
-- ── O QUE ESTA MIGRATION FAZ ─────────────────────────────────────────────
-- 1. `cappia_pos_consulta_candidatos` passa a listar, alem dos agendamentos
--    NOVOS, as jornadas pendentes com lease vencido (as duas etapas), cada linha
--    com `acao_edge` = 'iniciar' | 'recuperar'. As recuperacoes vem PRIMEIRO
--    (mais antigas primeiro). Mesmas colunas de antes (E1) mais `acao_edge`.
--    A selecao das RECUPERACOES parte SO da jornada (`pos_consulta_jornadas` +
--    a clinica dela): nao depende de o agendamento ainda existir na mesma
--    clinica (LEFT JOIN so para os nomes cosmeticos) nem de a automacao estar
--    ligada -- SETIMA REVISAO, itens 1 e 2. Uma jornada que so podia ser
--    encerrada nao pode sumir da lista por um JOIN.
-- 2. `cappia_pos_consulta_recuperar_entrega` (nova): sob lock da jornada,
--    - jornada sem pendencia / lease vigente: nao faz nada (`nao_pendente`,
--      `em_andamento`);
--    - recuperavel: RECLAMA a MESMA entrega (token novo, lease novo,
--      `entrega_id` PRESERVADO, `classificacao`/`convite_pendente` preservados)
--      e conta a tentativa;
--    - IRRECUPERAVEL: ENCERRA a jornada SEM mensagem (`abandonada`), com o motivo
--      gravado, LIBERANDO o telefone. Na ordem em que sao avaliados:
--      (a) `abandonada_automacao_desligada` -- a clinica desligou o pos-consulta
--          (`pos_consulta_tipo` fora de satisfacao/google/ambos): NAO recebe
--          mensagem, mas a pendencia e encerrada em silencio (item 2 da setima
--          revisao). So a chave `pos_consulta_tipo` decide -- uma configuracao
--          ligada porem incompleta (ex.: link removido depois) NAO encerra: a
--          jornada em andamento usa o modo e o link CAPTURADOS quando comecou;
--      (b) `abandonada_vinculo_invalido` -- agendamento/paciente/telefone oficial
--          nao batem mais com o snapshot da jornada, INCLUSIVE quando o
--          agendamento ou o paciente mudou de clinica (nunca enviar a outro
--          numero; item 1 da setima revisao);
--      (c) `abandonada_janela` -- agendamento fora da janela de 48 h (ou sem
--          `concluido_em`);
--      (d) `abandonada_tentativas` -- 3 tentativas de entrega ja autorizadas sem
--          confirmacao.
-- 3. `cappia_pos_consulta_encerrar_sem_resposta` (nova, SETIMA REVISAO, item 3):
--    jornada `aguardando_satisfacao` sem resposta ha 7 dias (10080 min, contados da
--    confirmacao da primeira entrega) e ENCERRADA em silencio, motivo
--    `abandonada_sem_resposta`, liberando o telefone. Nao envia nada. Uma resposta
--    POSTERIOR nao encontra jornada aberta e segue pelo fluxo normal da Iris.
--    Chamada pelo Disparo A a cada ciclo (uma so RPC, sem Edge Function).
-- 4. Duas colunas (`entrega_tentativas`, `encerramento_motivo`), tres CHECKs e um
--    trigger que reinicia a contagem quando uma NOVA entrega comeca (o
--    `entrega_id` muda); as funcoes existentes nao mudam.
--
-- ── DECISOES APROVADAS (Gabriel, sexta e setima revisoes) ────────────────
--   - 3 tentativas por entrega (`cappia_pos_consulta_max_tentativas_entrega()`);
--   - a janela de 48 h tambem limita a recuperacao (nao ha janela nova);
--   - entrega "ao menos uma vez";
--   - 7 dias para a jornada sem resposta (`cappia_pos_consulta_expiracao_sem_resposta_minutos()`).
--
-- ── SEMANTICA DE ENTREGA: AO MENOS UMA VEZ ───────────────────────────────
-- Se o envio TEVE sucesso e so a confirmacao falhou, a recuperacao reenvia:
-- a mensagem pode chegar duas vezes (a Evolution nao deduplica por
-- `entrega_id`). Mitigacao no n8n: `confirmar` com retry. Limite: 3 tentativas.
--
-- ── FORA DESTA MIGRATION ─────────────────────────────────────────────────
--   - nada aqui trata inconformidade nem varias mensagens (frentes futuras).
--
-- ── COMO APLICAR (plano corrigido -- sexta revisao, bloqueador 2) ────────
-- NAO use `apply_migration` do MCP: ele so aceita `name` e `query` e o SERVIDOR
-- gera a versao (timestamp do momento), descasando a versao registrada do nome
-- do arquivo -- foi o defeito que forcou renomear 20260915120000 ->
-- 20260919204030. Use `supabase db push` a partir do workspace preparado por
-- src/supabase/aplicacao/preparar-workspace-db-push.mjs: a CLI registra a versao
-- DO NOME DO ARQUIVO. Sem renomear depois, sem `migration repair`. Roteiro
-- completo, com dry-run obrigatorio e verificacao, em MANIFESTO.md; ensaiado
-- contra o Postgres local em src/supabase/aplicacao/ensaio-local-db-push.mjs.
-- Esta migration e a 20260920230000 sao aplicadas JUNTAS, nesta ordem, no mesmo push.
--
-- PREFLIGHT (obrigatorio, read-only, imediatamente antes de aplicar):
--   select count(*) from public.pos_consulta_jornadas;               -- esperado 0
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='pos_consulta_jornadas'
--      and column_name in ('entrega_tentativas','encerramento_motivo'); -- VAZIO
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public'
--      and p.proname in ('cappia_pos_consulta_recuperar_entrega',
--                        'cappia_pos_consulta_max_tentativas_entrega',
--                        'cappia_pos_consulta_jornadas_tentativas_tg',
--                        'cappia_pos_consulta_expiracao_sem_resposta_minutos',
--                        'cappia_pos_consulta_encerrar_sem_resposta'); -- VAZIO

-- ── 1. COLUNAS, CHECKs E TRIGGER ─────────────────────────────────────────
-- `entrega_tentativas`: quantas vezes a ENTREGA ATUAL foi autorizada (1 na
-- reserva inicial; +1 a cada recuperacao). `encerramento_motivo`: preenchido so
-- quando a jornada e encerrada SEM entrega (abandono).
alter table public.pos_consulta_jornadas
  add column entrega_tentativas integer not null default 1,
  add column encerramento_motivo text;

alter table public.pos_consulta_jornadas
  add constraint pos_consulta_jornadas_entrega_tentativas_ck
    check (entrega_tentativas >= 1),
  add constraint pos_consulta_jornadas_encerramento_motivo_ck
    check (
      encerramento_motivo is null
      or (etapa = 'encerrada'
          and encerramento_motivo in (
            'abandonada_janela', 'abandonada_tentativas', 'abandonada_vinculo_invalido',
            'abandonada_automacao_desligada', 'abandonada_sem_resposta'))
    );

-- Uma NOVA entrega comeca sempre que `entrega_id` muda (reserva da segunda
-- entrega; confirmacao/abandono zeram o id). Reclaim e recuperacao PRESERVAM o
-- `entrega_id`, entao a contagem so cresce quando a recuperacao a incrementa.
-- Trigger em vez de reescrever as tres funcoes existentes.
create or replace function public.cappia_pos_consulta_jornadas_tentativas_tg()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.entrega_id is distinct from old.entrega_id then
    new.entrega_tentativas := 1;
  end if;
  return new;
end;
$$;

revoke all on function public.cappia_pos_consulta_jornadas_tentativas_tg() from public;
revoke all on function public.cappia_pos_consulta_jornadas_tentativas_tg() from anon;
revoke all on function public.cappia_pos_consulta_jornadas_tentativas_tg() from authenticated;

create trigger pos_consulta_jornadas_tentativas_tg
  before update on public.pos_consulta_jornadas
  for each row execute function public.cappia_pos_consulta_jornadas_tentativas_tg();

-- ── 2. LIMITE DE TENTATIVAS -- fonte unica ────────────────────────────────
create or replace function public.cappia_pos_consulta_max_tentativas_entrega()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select 3
$$;

revoke all on function public.cappia_pos_consulta_max_tentativas_entrega() from public;
revoke all on function public.cappia_pos_consulta_max_tentativas_entrega() from anon;
revoke all on function public.cappia_pos_consulta_max_tentativas_entrega() from authenticated;
grant execute on function public.cappia_pos_consulta_max_tentativas_entrega() to service_role;

-- ── 3. RECUPERAR ENTREGA PENDENTE ─────────────────────────────────────────
-- Chamada pela Edge Function (acao 'recuperar') com os fatos RELIDOS em fonte
-- autoritativa (paciente e telefone oficial atuais). Nunca confia no n8n.
create or replace function public.cappia_pos_consulta_recuperar_entrega(
  p_clinica_id           uuid,
  p_agendamento_id       uuid,
  p_paciente_id          uuid,
  p_telefone_normalizado text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_jornada pos_consulta_jornadas%rowtype;
  v_concluido_em timestamptz;
  v_automacao_ligada boolean;
  v_vinculo boolean;
  v_motivo text;
  v_token uuid;
begin
  if p_clinica_id is null or p_agendamento_id is null then
    raise exception 'identificador obrigatorio ausente' using errcode = 'check_violation';
  end if;

  select * into v_jornada
    from pos_consulta_jornadas
   where clinica_id = p_clinica_id and agendamento_id = p_agendamento_id
   for update;

  if not found then
    return jsonb_build_object('resultado', 'jornada_nao_encontrada');
  end if;

  -- So as DUAS etapas de pendencia sao recuperaveis.
  if v_jornada.etapa not in ('aguardando_inicio', 'finalizando') then
    return jsonb_build_object('resultado', 'nao_pendente', 'etapa', v_jornada.etapa);
  end if;

  -- Lease vigente: outro worker esta com a entrega.
  if v_jornada.entrega_lease_expira_em > now() then
    return jsonb_build_object('resultado', 'em_andamento');
  end if;

  -- AUTOMACAO DESLIGADA (setima revisao, item 2): a clinica que desligou o
  -- pos-consulta NAO recebe mensagem -- mas a pendencia nao pode prender o
  -- telefone: e encerrada em silencio. Decide SO a chave `pos_consulta_tipo`
  -- (fora de satisfacao/google/ambos = desligada); configuracao ligada porem
  -- incompleta NAO encerra (a jornada usa o modo e o link capturados ao comecar).
  select (c.automatizacoes ->> 'pos_consulta_tipo') in ('satisfacao', 'google', 'ambos')
    into v_automacao_ligada
    from clinicas c
   where c.id = p_clinica_id;

  if not coalesce(v_automacao_ligada, false) then
    v_motivo := 'abandonada_automacao_desligada';
  else
    -- VINCULO sob lock: agendamento, paciente e TELEFONE OFICIAL atuais precisam
    -- bater com o snapshot da jornada (mesmo rigor de B3) -- nunca enviar a outro
    -- numero. Sem vinculo (inclusive se o agendamento ou o paciente mudou de
    -- CLINICA: os `a.clinica_id`/`p.clinica_id` abaixo exigem a clinica da
    -- jornada), a entrega nao pode mais ser feita.
    select a.concluido_em into v_concluido_em
      from agendamentos a
      join pacientes p on p.id = a.paciente_id
     where a.id = p_agendamento_id
       and a.clinica_id = p_clinica_id
       and a.paciente_id = v_jornada.paciente_id
       and p.clinica_id = p_clinica_id
       and p.telefone_normalizado = v_jornada.telefone_normalizado
       and p_paciente_id is not distinct from v_jornada.paciente_id
       and p_telefone_normalizado is not distinct from v_jornada.telefone_normalizado
     for share of a, p;
    v_vinculo := found;

    if not v_vinculo then
      v_motivo := 'abandonada_vinculo_invalido';
    elsif v_concluido_em is null
       or v_concluido_em <= now() - make_interval(mins => public.cappia_pos_consulta_janela_maxima_minutos()) then
      v_motivo := 'abandonada_janela';
    elsif v_jornada.entrega_tentativas >= public.cappia_pos_consulta_max_tentativas_entrega() then
      v_motivo := 'abandonada_tentativas';
    end if;
  end if;

  -- IRRECUPERAVEL: encerra SEM mensagem e libera o telefone.
  if v_motivo is not null then
    update pos_consulta_jornadas
       set etapa = 'encerrada',
           entrega_id = null,
           entrega_claim_token = null,
           entrega_lease_expira_em = null,
           convite_pendente = false,
           encerramento_motivo = v_motivo,
           atualizada_em = now()
     where id = v_jornada.id;
    return jsonb_build_object('resultado', 'abandonada', 'motivo', v_motivo, 'etapa_anterior', v_jornada.etapa);
  end if;

  -- RECUPERAVEL: RECLAMA a MESMA entrega (`entrega_id`, classificacao e
  -- convite_pendente PRESERVADOS; token e lease novos; tentativa contada).
  v_token := gen_random_uuid();
  update pos_consulta_jornadas
     set entrega_claim_token = v_token,
         entrega_lease_expira_em = now() + make_interval(secs => 180),
         entrega_tentativas = entrega_tentativas + 1,
         atualizada_em = now()
   where id = v_jornada.id;

  return jsonb_build_object(
    'resultado', 'pendente',
    'etapa', v_jornada.etapa,
    'modo', v_jornada.modo,
    'entrega_id', v_jornada.entrega_id,
    'claim_token', v_token,
    'classificacao', v_jornada.classificacao,
    'convite_pendente', v_jornada.convite_pendente,
    'link_avaliacao_google', v_jornada.link_avaliacao_google,
    'tentativa', v_jornada.entrega_tentativas + 1);
end;
$$;

revoke all on function public.cappia_pos_consulta_recuperar_entrega(uuid, uuid, uuid, text) from public;
revoke all on function public.cappia_pos_consulta_recuperar_entrega(uuid, uuid, uuid, text) from anon;
revoke all on function public.cappia_pos_consulta_recuperar_entrega(uuid, uuid, uuid, text) from authenticated;
grant execute on function public.cappia_pos_consulta_recuperar_entrega(uuid, uuid, uuid, text) to service_role;

-- ── 4. CANDIDATOS -- agora tambem as RECUPERACOES ─────────────────────────
-- O tipo de retorno ganha `acao_edge`, e `create or replace` nao pode mudar o
-- tipo de retorno: por isso drop + create (a funcao nao e referenciada por
-- nenhum objeto do banco; so pelo n8n, por nome). Mesmas colunas e mesmos nomes
-- de instancia (E1) da versao anterior; mesma janela de 48 h nos NOVOS.
drop function if exists public.cappia_pos_consulta_candidatos(integer);

create function public.cappia_pos_consulta_candidatos(p_limit integer default 50)
returns table (
  clinica_id                 uuid,
  agendamento_id              uuid,
  paciente_id                 uuid,
  instancia_whatsapp           text,
  whatsapp_instancia           text,
  nome_clinica                text,
  procedimento_nome_exibido   text,
  dentista_nome_exibido       text,
  acao_edge                   text
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select
    x.clinica_id,
    x.agendamento_id,
    x.paciente_id,
    x.instancia_whatsapp,
    x.whatsapp_instancia,
    x.nome_clinica,
    x.procedimento_nome_exibido,
    x.dentista_nome_exibido,
    x.acao_edge
  from (
    -- (a) RECUPERACAO: entrega pendente (as duas etapas) com lease vencido.
    -- Recuperavel ou nao, quem decide e `cappia_pos_consulta_recuperar_entrega`
    -- (que reclama ou encerra); aqui so se LISTA, para nada ficar orfao.
    -- A selecao parte SO da jornada e da clinica dela (FK, sempre existe): o
    -- agendamento entra por LEFT JOIN, apenas para os nomes cosmeticos, e so
    -- vale quando ainda e da MESMA clinica -- se mudou de clinica/vinculo, a
    -- jornada CONTINUA listada (cosmeticos nulos) para a RPC encerra-la por
    -- vinculo invalido. E NAO filtra por automacao ligada: quem desligou tambem
    -- precisa ter a pendencia encerrada (em silencio) e o telefone liberado.
    select
      j.clinica_id,
      j.agendamento_id,
      j.paciente_id,
      c.instancia_whatsapp as instancia_whatsapp,
      c.whatsapp_instancia as whatsapp_instancia,
      c.nome as nome_clinica,
      a.procedimento as procedimento_nome_exibido,
      a.dentista_nome as dentista_nome_exibido,
      'recuperar'::text as acao_edge,
      0 as prioridade,
      j.entrega_lease_expira_em as ordem
    from pos_consulta_jornadas j
    join clinicas c on c.id = j.clinica_id
    left join agendamentos a on a.id = j.agendamento_id and a.clinica_id = j.clinica_id
    where j.etapa in ('aguardando_inicio', 'finalizando')
      and j.entrega_lease_expira_em <= now()

    union all

    -- (b) NOVOS: identico a versao anterior (prazo vencido, dentro da janela, sem jornada).
    select
      a.clinica_id,
      a.id as agendamento_id,
      a.paciente_id,
      c.instancia_whatsapp as instancia_whatsapp,
      c.whatsapp_instancia as whatsapp_instancia,
      c.nome as nome_clinica,
      a.procedimento as procedimento_nome_exibido,
      a.dentista_nome as dentista_nome_exibido,
      'iniciar'::text as acao_edge,
      1 as prioridade,
      a.concluido_em as ordem
    from agendamentos a
    join clinicas c on c.id = a.clinica_id
    where a.status = 'concluido'
      and a.concluido_em is not null
      and (c.automatizacoes ->> 'pos_consulta_tipo') in ('satisfacao', 'google', 'ambos')
      and (c.automatizacoes ->> 'pos_consulta_tempo') in ('2h', '4h', '24h')
      and a.concluido_em + make_interval(mins => (case c.automatizacoes ->> 'pos_consulta_tempo'
             when '2h' then 120 when '4h' then 240 when '24h' then 1440 end)) <= now()
      and a.concluido_em > now() - make_interval(mins => public.cappia_pos_consulta_janela_maxima_minutos())
      and not exists (
        select 1 from pos_consulta_jornadas j
         where j.clinica_id = a.clinica_id and j.agendamento_id = a.id
      )
  ) x
  order by x.prioridade asc, x.ordem asc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

revoke all on function public.cappia_pos_consulta_candidatos(integer) from public;
revoke all on function public.cappia_pos_consulta_candidatos(integer) from anon;
revoke all on function public.cappia_pos_consulta_candidatos(integer) from authenticated;
grant execute on function public.cappia_pos_consulta_candidatos(integer) to service_role;

-- ── 5. JORNADA SEM RESPOSTA -- expira em silencio apos 7 dias ─────────────
-- Setima revisao, item 3. `aguardando_satisfacao` nao e "entrega pendente" (a
-- primeira mensagem JA foi entregue e confirmada), mas ela tambem ocupa o
-- indice de telefone ativo (B4) enquanto o paciente nao responde -- para
-- sempre, se ele nunca responder. Passados 7 dias da confirmacao da primeira
-- entrega (`atualizada_em`, gravado por `confirmar_entrega`; nada mais atualiza
-- a linha nessa etapa), a jornada e ENCERRADA sem enviar NADA, com o motivo
-- `abandonada_sem_resposta`, liberando o telefone. Uma resposta POSTERIOR nao
-- encontra jornada aberta (`buscarJornadaAbertaPosConsulta` so olha
-- `aguardando_satisfacao`) e segue pelo fluxo normal da Iris. Ausencia de
-- resposta nunca autoriza convite ao Google (`convite_google_em` nao e tocado).
create or replace function public.cappia_pos_consulta_expiracao_sem_resposta_minutos()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select 10080
$$;

revoke all on function public.cappia_pos_consulta_expiracao_sem_resposta_minutos() from public;
revoke all on function public.cappia_pos_consulta_expiracao_sem_resposta_minutos() from anon;
revoke all on function public.cappia_pos_consulta_expiracao_sem_resposta_minutos() from authenticated;
grant execute on function public.cappia_pos_consulta_expiracao_sem_resposta_minutos() to service_role;

-- Chamada pelo Disparo A a cada ciclo, via PostgREST (mesmo mecanismo da RPC de
-- candidatos). Em lote e sem esperar por linha travada (`skip locked`): uma
-- resposta em curso, que ja segurou o lock da linha, nunca e atropelada -- e
-- quem chegar depois do encerramento cai no fluxo normal. Devolve quantas
-- jornadas encerrou. Idempotente.
create or replace function public.cappia_pos_consulta_encerrar_sem_resposta(p_limit integer default 200)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_encerradas integer;
begin
  with alvo as (
    select j.id
      from pos_consulta_jornadas j
     where j.etapa = 'aguardando_satisfacao'
       and j.atualizada_em <= now() - make_interval(mins => public.cappia_pos_consulta_expiracao_sem_resposta_minutos())
     order by j.atualizada_em asc
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
       for update skip locked
  )
  update pos_consulta_jornadas j
     set etapa = 'encerrada',
         encerramento_motivo = 'abandonada_sem_resposta',
         atualizada_em = now()
    from alvo
   where j.id = alvo.id;

  get diagnostics v_encerradas = row_count;
  return v_encerradas;
end;
$$;

revoke all on function public.cappia_pos_consulta_encerrar_sem_resposta(integer) from public;
revoke all on function public.cappia_pos_consulta_encerrar_sem_resposta(integer) from anon;
revoke all on function public.cappia_pos_consulta_encerrar_sem_resposta(integer) from authenticated;
grant execute on function public.cappia_pos_consulta_encerrar_sem_resposta(integer) to service_role;

-- ── ROLLBACK ────────────────────────────────────────────────────────────
-- 0) drop function if exists public.cappia_pos_consulta_encerrar_sem_resposta(integer);
--    drop function if exists public.cappia_pos_consulta_expiracao_sem_resposta_minutos();
-- 1) drop function if exists public.cappia_pos_consulta_candidatos(integer);
--    e recriar a versao de 20260920230000_iris_nova_pos_consulta_google_so_apos_satisfacao_e_janela.sql
--    (secao 3d), com os grants;
-- 2) drop function if exists public.cappia_pos_consulta_recuperar_entrega(uuid, uuid, uuid, text);
-- 3) drop trigger if exists pos_consulta_jornadas_tentativas_tg on public.pos_consulta_jornadas;
--    drop function if exists public.cappia_pos_consulta_jornadas_tentativas_tg();
-- 4) drop function if exists public.cappia_pos_consulta_max_tentativas_entrega();
-- 5) alter table public.pos_consulta_jornadas
--      drop constraint if exists pos_consulta_jornadas_encerramento_motivo_ck,
--      drop constraint if exists pos_consulta_jornadas_entrega_tentativas_ck,
--      drop column if exists encerramento_motivo,
--      drop column if exists entrega_tentativas;
