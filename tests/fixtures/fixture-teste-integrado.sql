-- FIXTURE DE TESTE, DESCARTÁVEL — NUNCA vira migration do main.
--
-- Escopo: só o necessário pra rodar o ciclo completo do orquestrador contra
-- um Postgres real, numa branch descartável de bcmuqautblvjdqzhjfbw (o
-- ambiente isolado da Iris Nova). Nunca aplicado direto no projeto-base.
-- Nunca toca a ClearDent nem qualquer dado real.
--
-- Dados 100% fictícios: 1 clínica, 1 dentista, 1 paciente, 2 procedimentos
-- (múltiplos de 10 min, conforme regra já combinada).
--
-- Simplificação deliberada: procedimentos_catalogo.especialidade_id, na
-- producao, tem FK pra especialidades_catalogo -- tabela fora do escopo
-- pedido. Omitida aqui de proposito (documentado, nao e erro).
--
-- Funcoes: copia EXATA do corpo ja lido em producao (udizowyfjnhuhgxkeayk)
-- em 2026-08-04 -- cappia_reservar_agendamento + as 3 auxiliares que ela
-- realmente chama (cappia__resolver_dentista/procedimento/duracao).
-- Nenhuma outra funcao incluida.

-- ============================================================
-- 1. Colunas novas em clinicas (aditivo — a tabela ja existe neste projeto)
-- ============================================================

alter table public.clinicas
  add column if not exists dentistas jsonb,
  add column if not exists fuso_horario text;

-- ============================================================
-- 2. Tabelas que faltam (copia da estrutura real, sem dado real)
-- ============================================================

create table public.procedimentos_catalogo (
  id               text primary key,
  especialidade_id text not null, -- FK omitida de proposito, ver nota acima
  nome_pt          text not null,
  nome_es          text not null,
  nome_en          text not null,
  nome_fr          text not null,
  nome_de          text not null,
  nome_it          text not null,
  nome_ru          text not null,
  nome_ar          text not null,
  tempo_padrao     integer not null,
  ativo            boolean default true,
  ordem            integer,
  perfil_anamnese  text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create table public.agendamentos (
  id                     uuid primary key default gen_random_uuid(),
  clinica_id             uuid references public.clinicas(id),
  paciente_id            uuid references public.pacientes(id),
  data                   date,
  horario                text,
  nome                   text,
  documento              text,
  tipo_documento         text,
  telefone               text,
  procedimento           text,
  procedimento_id        text,
  status                 text default 'confirmado'
    check (status = any (array['confirmado','cancelado','remarcado','concluido','faltou'])),
  dentista_nome          text,
  dentista_id            uuid,
  duracao_min            integer,
  event_id               text,
  calendar_id            text,
  gcal_cleanup_pendente  boolean not null default false,
  remarcado_de           uuid references public.agendamentos(id) on delete set null,
  lembrete_24h_enviado   boolean default false,
  lembrete_2h_enviado    boolean default false,
  pos_consulta_enviado   boolean not null default false,
  criado_em              timestamptz default now(),
  atualizado_em          timestamptz default now(),
  concluido_em           timestamptz
);

create table public.horarios_bloqueados (
  id           uuid primary key default gen_random_uuid(),
  clinica_id   uuid not null references public.clinicas(id),
  dentista_id  uuid,
  dentista_nome text,
  data_inicio  date not null,
  data_fim     date not null,
  horario_inicio text not null,
  horario_fim  text not null,
  motivo       text,
  comando_id   text,
  criado_por   text not null check (criado_por in ('dono','dentista')),
  criado_em    timestamptz not null default now(),
  check ((data_fim > data_inicio) or (data_fim = data_inicio and horario_fim > horario_inicio))
);

-- ============================================================
-- 3. Funcoes — copia exata do corpo em producao (2026-08-04)
-- ============================================================

CREATE OR REPLACE FUNCTION public.cappia__resolver_dentista(p_clinica_id uuid, p_dentista_id uuid, p_dentista_nome text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with slots as (
    select (d.value->>'id')::uuid as did,
           btrim(coalesce(d.value->>'titulo','')||' '||coalesce(d.value->>'nome','')) as nome_completo,
           btrim(coalesce(d.value->>'nome','')) as nome_curto,
           coalesce((d.value->>'ativo')::boolean,false) as ativo
    from clinicas c, jsonb_array_elements(coalesce(c.dentistas,'[]'::jsonb)) d
    where c.id = p_clinica_id
  ),
  match as (
    select * from slots
    where ativo and (
      (p_dentista_id is not null and did = p_dentista_id)
      or (p_dentista_id is null and p_dentista_nome is not null
          and lower(btrim(p_dentista_nome)) in (lower(nome_completo), lower(nome_curto)))
      or (p_dentista_id is null and p_dentista_nome is not null
          and lower(regexp_replace(btrim(p_dentista_nome), '^dra?\.?\s+', '', 'i')) = lower(nome_curto))
    )
  )
  select case
    when p_dentista_id is null and p_dentista_nome is null
      then jsonb_build_object('ok',false,'motivo','dentista_nao_informado')
    when (select count(*) from match) = 1
      then jsonb_build_object('ok',true,
             'dentista_id',(select did from match),
             'dentista_nome',(select nome_completo from match))
    when (select count(*) from match) = 0
      then jsonb_build_object('ok',false,'motivo','dentista_nao_encontrado')
    else jsonb_build_object('ok',false,'motivo','dentista_ambiguo')
  end;
$function$;

CREATE OR REPLACE FUNCTION public.cappia__resolver_duracao(p_clinica_id uuid, p_dentista_id uuid, p_procedimento_id text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_slot jsonb; v_modo text; v_tp int; v_nomes text[]; v_tempo_proc int; v_dur int;
begin
  select d.value into v_slot
  from clinicas c, jsonb_array_elements(coalesce(c.dentistas,'[]'::jsonb)) d
  where c.id = p_clinica_id and (d.value->>'id')::uuid = p_dentista_id
  limit 1;

  select tempo_padrao,
         array_remove(array[lower(btrim(nome_pt)),lower(btrim(nome_es)),lower(btrim(nome_en)),
                            lower(btrim(nome_fr)),lower(btrim(nome_de)),lower(btrim(nome_it)),
                            lower(btrim(nome_ru)),lower(btrim(nome_ar))], null)
    into v_tp, v_nomes
  from procedimentos_catalogo where id = p_procedimento_id;

  v_modo := coalesce(v_slot->>'modo','auto');

  if v_modo = 'procedimento' then
    select (p->>'tempo')::int into v_tempo_proc
    from jsonb_array_elements(coalesce(v_slot->'procedimentos','[]'::jsonb)) p
    where coalesce((p->>'ativo')::boolean,true)
      and v_nomes is not null
      and lower(btrim(p->>'nome')) = any(v_nomes)
    limit 1;
    v_dur := coalesce(v_tempo_proc, v_tp);
  else
    v_dur := coalesce((v_slot->>'dur')::int, v_tp);
  end if;

  if v_dur is null or v_dur <= 0 then v_dur := coalesce(v_tp, 60); end if;
  if v_dur is null or v_dur <= 0 then v_dur := 60; end if;
  return v_dur;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cappia__resolver_procedimento(p_clinica_id uuid, p_dentista_id uuid, p_procedimento_id text, p_procedimento_texto text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_proc_id text;
  v_nome_pt text;
  v_nomes text[];
  v_slot jsonb;
  v_achou boolean;
begin
  if (p_procedimento_id is null or btrim(p_procedimento_id) = '')
     and (p_procedimento_texto is null or btrim(p_procedimento_texto) = '') then
    return jsonb_build_object('ok', false, 'motivo', 'procedimento_obrigatorio');
  end if;

  v_proc_id := null;
  if p_procedimento_id is not null and btrim(p_procedimento_id) <> '' then
    select id into v_proc_id from procedimentos_catalogo where id = btrim(p_procedimento_id);
  end if;

  if v_proc_id is null and p_procedimento_texto is not null and btrim(p_procedimento_texto) <> '' then
    select id into v_proc_id from procedimentos_catalogo
     where lower(btrim(p_procedimento_texto)) in (
       lower(btrim(nome_pt)), lower(btrim(nome_es)), lower(btrim(nome_en)), lower(btrim(nome_fr)),
       lower(btrim(nome_de)), lower(btrim(nome_it)), lower(btrim(nome_ru)), lower(btrim(nome_ar)))
     limit 1;
  end if;

  if v_proc_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'procedimento_nao_encontrado');
  end if;

  select nome_pt,
         array_remove(array[lower(btrim(nome_pt)),lower(btrim(nome_es)),lower(btrim(nome_en)),
                             lower(btrim(nome_fr)),lower(btrim(nome_de)),lower(btrim(nome_it)),
                             lower(btrim(nome_ru)),lower(btrim(nome_ar))], null)
    into v_nome_pt, v_nomes
  from procedimentos_catalogo where id = v_proc_id;

  select d.value into v_slot
  from clinicas c, jsonb_array_elements(coalesce(c.dentistas,'[]'::jsonb)) d
  where c.id = p_clinica_id and (d.value->>'id')::uuid = p_dentista_id
  limit 1;

  select exists (
    select 1 from jsonb_array_elements(coalesce(v_slot->'procedimentos','[]'::jsonb)) p
    where coalesce((p->>'ativo')::boolean, true)
      and (
        (p ? 'id' and (p->>'id') = v_proc_id)
        or (lower(btrim(p->>'nome')) = any(v_nomes))
      )
  ) into v_achou;

  if not v_achou then
    return jsonb_build_object('ok', false, 'motivo', 'procedimento_nao_disponivel_para_dentista');
  end if;

  return jsonb_build_object('ok', true, 'procedimento_id', v_proc_id, 'nome_pt', v_nome_pt);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cappia_reservar_agendamento(p_clinica_id uuid, p_data date, p_horario text, p_procedimento_id text, p_paciente_id uuid, p_dentista_id uuid DEFAULT NULL::uuid, p_dentista_nome text DEFAULT NULL::text, p_procedimento text DEFAULT NULL::text, p_nome text DEFAULT NULL::text, p_telefone text DEFAULT NULL::text, p_documento text DEFAULT NULL::text, p_tipo_documento text DEFAULT NULL::text, p_event_id text DEFAULT NULL::text, p_calendar_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_dent jsonb; v_did uuid; v_dnome text; v_dur int;
  v_proc jsonb; v_proc_id text;
  v_ini timestamp; v_fim timestamp; v_dia timestamp; v_novo_id uuid;
begin
  if p_data is null then return jsonb_build_object('sucesso',false,'motivo','data_invalida'); end if;
  if p_horario is null or p_horario !~ '^[0-9]{1,2}:[0-9]{2}$'
     or split_part(p_horario,':',1)::int > 23 or split_part(p_horario,':',2)::int > 59
    then return jsonb_build_object('sucesso',false,'motivo','horario_invalido'); end if;

  v_dent := public.cappia__resolver_dentista(p_clinica_id, p_dentista_id, p_dentista_nome);
  if not (v_dent->>'ok')::boolean then
    return jsonb_build_object('sucesso',false,'motivo',v_dent->>'motivo'); end if;
  v_did := (v_dent->>'dentista_id')::uuid; v_dnome := v_dent->>'dentista_nome';

  v_proc := public.cappia__resolver_procedimento(p_clinica_id, v_did, p_procedimento_id, p_procedimento);
  if not (v_proc->>'ok')::boolean then
    return jsonb_build_object('sucesso',false,'motivo',v_proc->>'motivo'); end if;
  v_proc_id := v_proc->>'procedimento_id';

  v_dur := public.cappia__resolver_duracao(p_clinica_id, v_did, v_proc_id);
  v_ini := p_data + p_horario::time;
  v_fim := v_ini + make_interval(mins => v_dur);

  for v_dia in select generate_series(date_trunc('day',v_ini),
                                      date_trunc('day', v_fim - interval '1 microsecond'),
                                      interval '1 day') loop
    perform pg_advisory_xact_lock(hashtextextended(p_clinica_id::text||':'||v_did::text||':'||v_dia::text, 0));
  end loop;

  if exists (
    select 1 from agendamentos a
    where a.clinica_id = p_clinica_id and a.dentista_id = v_did and a.status = 'confirmado'
      and a.horario ~ '^[0-9]{1,2}:[0-9]{2}$'
      and a.data between v_ini::date - 1 and v_fim::date
      and tsrange(a.data + a.horario::time,
                  a.data + a.horario::time + make_interval(mins => coalesce(a.duracao_min,60)), '[)')
          && tsrange(v_ini, v_fim, '[)')
  ) then
    return jsonb_build_object('sucesso',false,'motivo','horario_ocupado');
  end if;

  begin
    insert into agendamentos (clinica_id, paciente_id, data, horario, nome, documento, telefone,
      procedimento, procedimento_id, status, dentista_nome, dentista_id, duracao_min,
      tipo_documento, event_id, calendar_id, gcal_cleanup_pendente)
    values (p_clinica_id, p_paciente_id, p_data, p_horario, p_nome, p_documento, p_telefone,
      p_procedimento, v_proc_id, 'confirmado', v_dnome, v_did, v_dur,
      p_tipo_documento, p_event_id, p_calendar_id, false)
    returning id into v_novo_id;
  exception when others then
    return jsonb_build_object('sucesso',false,'motivo','erro_insercao','detalhe',sqlerrm);
  end;

  return jsonb_build_object('sucesso',true,'agendamento_id',v_novo_id,'dentista_id',v_did,
    'duracao_min',v_dur,'data',p_data,'horario',p_horario);
end;
$function$;

-- Mesmo padrao de acesso da producao: so postgres/service_role executam.
grant execute on function public.cappia__resolver_dentista(uuid, uuid, text) to service_role;
grant execute on function public.cappia__resolver_duracao(uuid, uuid, text) to service_role;
grant execute on function public.cappia__resolver_procedimento(uuid, uuid, text, text) to service_role;
grant execute on function public.cappia_reservar_agendamento(uuid, date, text, text, uuid, uuid, text, text, text, text, text, text, text, text) to service_role;
grant select, insert, update on public.agendamentos to service_role;
grant select on public.procedimentos_catalogo to service_role;
grant select on public.horarios_bloqueados to service_role;
grant select, update on public.clinicas to service_role;
grant select on public.pacientes to service_role;

-- ============================================================
-- 4. Dados ficticios — 1 clinica, 1 dentista, 1 paciente, 2 procedimentos
-- ============================================================

insert into public.procedimentos_catalogo
  (id, especialidade_id, nome_pt, nome_es, nome_en, nome_fr, nome_de, nome_it, nome_ru, nome_ar, tempo_padrao, ativo)
values
  ('teste_limpeza', 'teste', 'Limpeza Teste', 'Limpeza Teste', 'Limpeza Teste', 'Limpeza Teste', 'Limpeza Teste', 'Limpeza Teste', 'Limpeza Teste', 'Limpeza Teste', 40, true),
  ('teste_consulta', 'teste', 'Consulta Teste', 'Consulta Teste', 'Consulta Teste', 'Consulta Teste', 'Consulta Teste', 'Consulta Teste', 'Consulta Teste', 'Consulta Teste', 30, true);

insert into public.clinicas (id, provider, instancia_whatsapp, fuso_horario, dentistas)
values (
  '3575e372-4914-466b-927b-19dd15d9a110',
  'evolution',
  'TESTE-INTEGRADO-FIXTURE',
  'America/Sao_Paulo',
  jsonb_build_array(jsonb_build_object(
    'id', '5a702bca-bcc9-41f8-b9fc-8387736a09ed',
    'nome', 'Dentista Teste',
    'titulo', 'Dr.',
    'ativo', true,
    'modo', 'procedimento',
    'inicio', '08:00',
    'fim', '12:00',
    'sabado', false,
    'alm_ini', null,
    'alm_fim', null,
    'procedimentos', jsonb_build_array(
      jsonb_build_object('id', 'teste_limpeza', 'nome', 'Limpeza Teste', 'ativo', true, 'tempo', 40),
      jsonb_build_object('id', 'teste_consulta', 'nome', 'Consulta Teste', 'ativo', true, 'tempo', 30)
    )
  ))
);

insert into public.pacientes (id, clinica_id, telefone_normalizado, criado_em)
values ('7947bec3-9b33-424e-b724-2247a8c7535c', '3575e372-4914-466b-927b-19dd15d9a110', '5511999998888', now());
-- Colunas de pacientes neste projeto isolado ja conferidas (id, clinica_id,
-- telefone_normalizado, criado_em) -- schema minimo, so o que a Iris Nova
-- ja usa pra identificacao.
