-- Iris Nova - reaproveitamento do catalogo/agenda legados para o primeiro
-- fluxo real (identificacao -> interpretacao -> resolvedores -> decisao ->
-- reserva).
-- Projeto-alvo: cappia-iris-core-dev (bcmuqautblvjdqzhjfbw) -- ambiente
-- isolado/dev da Iris Nova.
-- PROIBIDO aplicar em udizowyfjnhuhgxkeayk (legado/producao real) e em
-- iopzuvrcvbjrjnvcmzyt (reservado para P4I, fora de escopo aqui).
--
-- Autorizacao: Gabriel autorizou explicitamente o reaproveitamento de
-- procedimentos_catalogo, agendamentos, horarios_bloqueados,
-- cappia_reservar_agendamento e das funcoes auxiliares realmente
-- necessarias, com adaptacao permitida desde que: nao quebre dados
-- existentes; preserve isolamento por clinica_id; mantenha duracoes em
-- multiplos de 10; nao duplique logica ja reaproveitavel; nao copie
-- complexidade conversacional antiga.
--
-- Origem: as 3 tabelas e as 4 funcoes abaixo foram auditadas por leitura
-- READ-ONLY em udizowyfjnhuhgxkeayk (2026-08-04) -- nenhuma escrita feita
-- la. As 4 funcoes sao reaproveitadas PALAVRA POR PALAVRA (mesma logica de
-- resolucao de dentista/procedimento/duracao e mesma trava de conflito por
-- pg_advisory_xact_lock); nenhuma logica de reserva foi reescrita.
--
-- ESCOPO -- 3 tabelas, 4 funcoes, RLS ativa sem policies (mesmo padrao ja
-- usado em clinicas/pacientes/estado_conversa/mensagens_recebidas: so
-- service_role, que ignora RLS, acessa).
--
-- DESVIOS DELIBERADOS em relacao ao schema legado (documentados aqui para
-- que a comparacao futura nao estranhe a diferenca):
--   - procedimentos_catalogo: sem `especialidade_id` (e sua FK para
--     especialidades_catalogo, tabela nao reaproveitada -- nenhum resolvedor
--     do Core le especialidade), sem `ordem`, sem `perfil_anamnese`
--     (feature clinica legada, fora do escopo da Iris Nova aqui).
--   - procedimentos_catalogo: sem a policy legada de leitura publica
--     ("Leitura publica catalogo procedimentos") -- a Iris Nova so le essa
--     tabela via service_role (Edge Function), nunca via anon key.
--   - agendamentos: sem `atualizado_em`, `lembrete_24h_enviado`,
--     `lembrete_2h_enviado`, `remarcado_de`, `pos_consulta_enviado`,
--     `concluido_em` -- complexidade de lembretes/remarcacao/conclusao da
--     Iris antiga, nao construida na Iris Nova.
--   - agendamentos: MANTIDOS `nome`, `documento`, `telefone`,
--     `tipo_documento`, `event_id`, `calendar_id`, `gcal_cleanup_pendente`,
--     `dentista_nome` -- obrigatorios porque cappia_reservar_agendamento
--     (reaproveitada sem alteracao) insere nessas colunas por nome; a Iris
--     Nova sempre passa null nos parametros correspondentes que nao usa.
--   - horarios_bloqueados: sem `comando_id` (referencia a
--     comandos_remarcacao, fluxo conversacional da Iris antiga nao
--     construido aqui).
--   - Nenhum GRANT de tabela: mesmo padrao ja estabelecido nas migrations
--     anteriores da Iris Nova (RLS ativa sem policy = so service_role
--     acessa, sem necessidade de GRANT explicito).
--   - Duracao em multiplos de 10: cappia__resolver_duracao (SQL, legada) NAO
--     valida isso -- so devolve o valor bruto configurado, exatamente como
--     no legado. Essa validacao continua exclusivamente no lado TypeScript
--     (resolver-duracao.ts, ja aprovado) e nunca e duplicada aqui.
--
-- Isolamento por clinica_id: preservado em agendamentos e
-- horarios_bloqueados (FK para clinicas(id), mesma coluna do legado).
-- procedimentos_catalogo continua sem clinica_id -- catalogo global, mesma
-- forma do legado e mesma premissa ja usada por carregar-catalogo.ts.
--
-- FORA DE ESCOPO nesta migration: especialidades_catalogo, qualquer coluna
-- ou funcao nao listada acima, ativacao da Edge Function no projeto
-- permanente (isso so acontece depois desta migration ser aplicada e
-- testada).
--
-- PREFLIGHT (read-only, 2026-08-04, sobre bcmuqautblvjdqzhjfbw): nenhuma das
-- 3 tabelas existe; nenhuma funcao com prefixo `cappia` existe; 3 migrations
-- remotas ja aplicadas, ultima 20260731164424 (iris_nova_interpretacao_v1).
--
-- REEXECUTAR O PREFLIGHT imediatamente antes de aplicar. Nenhum CREATE de
-- tabela usa IF NOT EXISTS: colisao de nome falha explicitamente em vez de
-- ser ignorada em silencio.
--
-- NAO APLICADA em nenhum projeto no momento desta escrita.
--
-- CORRECOES APLICADAS em 2026-08-04 apos revisao do Codex (3 achados, sem
-- mudanca de arquitetura/escopo): (1) clinicas nao tinha `dentistas`/
-- `fuso_horario` neste projeto -- confirmado por leitura ao vivo -- e as
-- funcoes abaixo leem `c.dentistas`; sem a coluna, `create function
-- cappia__resolver_dentista` (language sql) falharia na propria aplicacao
-- da migration. (2) isolamento multiclinica de paciente reforcado com FK
-- composta (paciente_id, clinica_id) em vez de FK simples por id, mesmo
-- padrao ja usado em estado_conversa. (3) ACL explicita nas 3 tabelas
-- novas, espelhando o que ja era feito nas 4 funcoes.

alter table clinicas
  add column dentistas jsonb,
  add column fuso_horario text;

alter table pacientes
  add constraint pacientes_id_clinica_id_key unique (id, clinica_id);

create table procedimentos_catalogo (
  id text primary key,
  tempo_padrao integer not null,
  ativo boolean not null default true,
  nome_pt text not null,
  nome_es text not null,
  nome_en text not null,
  nome_fr text not null,
  nome_de text not null,
  nome_it text not null,
  nome_ru text not null,
  nome_ar text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table agendamentos (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas(id),
  paciente_id uuid,
  data date not null,
  horario text not null,
  nome text,
  documento text,
  telefone text,
  procedimento text,
  procedimento_id text not null,
  status text not null default 'confirmado',
  dentista_nome text,
  dentista_id uuid,
  duracao_min integer,
  tipo_documento text,
  event_id text,
  calendar_id text,
  gcal_cleanup_pendente boolean not null default false,
  criado_em timestamptz not null default now(),
  constraint agendamentos_status_valido check (
    status in ('confirmado', 'cancelado', 'remarcado', 'concluido', 'faltou')
  ),
  constraint agendamentos_horario_formato check (horario ~ '^[0-9]{1,2}:[0-9]{2}$'),
  -- isolamento multiclinica: paciente_id so pode apontar para um paciente da
  -- mesma clinica do agendamento (mesmo padrao ja usado em estado_conversa).
  constraint agendamentos_paciente_clinica_fk foreign key (paciente_id, clinica_id) references pacientes(id, clinica_id)
);

create table horarios_bloqueados (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas(id),
  dentista_id uuid,
  dentista_nome text,
  data_inicio date not null,
  horario_inicio text not null,
  data_fim date not null,
  horario_fim text not null,
  motivo text,
  criado_por text not null,
  criado_em timestamptz not null default now(),
  constraint horarios_bloqueados_criado_por_valido check (criado_por in ('dono', 'dentista')),
  constraint horarios_bloqueados_intervalo_valido check (
    (data_fim > data_inicio) or (data_fim = data_inicio and horario_fim > horario_inicio)
  )
);

-- RLS ativa, sem policies: somente credencial de servidor (service_role, que
-- ignora RLS) acessa. Mesmo padrao ja usado nas 4 tabelas anteriores da
-- Iris Nova.
alter table procedimentos_catalogo enable row level security;
alter table agendamentos enable row level security;
alter table horarios_bloqueados enable row level security;

-- Privilegios minimos nas 3 tabelas novas: revoga o acesso implicito que o
-- Supabase concede por padrao a public/anon/authenticated no schema public,
-- e concede a service_role so o que as 4 funcoes abaixo (SECURITY INVOKER,
-- executadas como service_role) realmente usam.
revoke all on table procedimentos_catalogo from public;
revoke all on table procedimentos_catalogo from anon;
revoke all on table procedimentos_catalogo from authenticated;
grant select on table procedimentos_catalogo to service_role;

revoke all on table agendamentos from public;
revoke all on table agendamentos from anon;
revoke all on table agendamentos from authenticated;
grant select, insert, update on table agendamentos to service_role;

revoke all on table horarios_bloqueados from public;
revoke all on table horarios_bloqueados from anon;
revoke all on table horarios_bloqueados from authenticated;
grant select on table horarios_bloqueados to service_role;

-- Funcoes reaproveitadas PALAVRA POR PALAVRA do legado (udizowyfjnhuhgxkeayk,
-- auditado por leitura read-only em 2026-08-04). Nenhuma logica de resolucao
-- ou de reserva foi reescrita.

create or replace function public.cappia__resolver_dentista(
  p_clinica_id uuid,
  p_dentista_id uuid,
  p_dentista_nome text
)
returns jsonb
language sql
security invoker
stable
set search_path to 'public', 'pg_temp'
as $function$
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
      -- tolera divergencia de titulo (Dr./Dra.) entre o cadastro da clinica e o
      -- nome enviado pelo agente. Exige espaco apos o prefixo, entao nomes que
      -- comecam com "dra" (ex.: Drauzio) nao sao afetados.
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

create or replace function public.cappia__resolver_procedimento(
  p_clinica_id uuid,
  p_dentista_id uuid,
  p_procedimento_id text,
  p_procedimento_texto text
)
returns jsonb
language plpgsql
security invoker
stable
set search_path to 'public', 'pg_temp'
as $function$
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

create or replace function public.cappia__resolver_duracao(
  p_clinica_id uuid,
  p_dentista_id uuid,
  p_procedimento_id text
)
returns integer
language plpgsql
security invoker
stable
set search_path to 'public', 'pg_temp'
as $function$
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

create or replace function public.cappia_reservar_agendamento(
  p_clinica_id uuid,
  p_data date,
  p_horario text,
  p_procedimento_id text,
  p_paciente_id uuid,
  p_dentista_id uuid default null::uuid,
  p_dentista_nome text default null::text,
  p_procedimento text default null::text,
  p_nome text default null::text,
  p_telefone text default null::text,
  p_documento text default null::text,
  p_tipo_documento text default null::text,
  p_event_id text default null::text,
  p_calendar_id text default null::text
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
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

-- Privilegios minimos: revoga o EXECUTE publico padrao do Postgres e
-- concede so a service_role -- mesmo padrao ja usado em
-- reivindicar_mensagem/aplicar_interpretacao_condicional.

revoke all on function public.cappia__resolver_dentista(uuid, uuid, text) from public;
revoke all on function public.cappia__resolver_dentista(uuid, uuid, text) from anon;
revoke all on function public.cappia__resolver_dentista(uuid, uuid, text) from authenticated;
grant execute on function public.cappia__resolver_dentista(uuid, uuid, text) to service_role;

revoke all on function public.cappia__resolver_procedimento(uuid, uuid, text, text) from public;
revoke all on function public.cappia__resolver_procedimento(uuid, uuid, text, text) from anon;
revoke all on function public.cappia__resolver_procedimento(uuid, uuid, text, text) from authenticated;
grant execute on function public.cappia__resolver_procedimento(uuid, uuid, text, text) to service_role;

revoke all on function public.cappia__resolver_duracao(uuid, uuid, text) from public;
revoke all on function public.cappia__resolver_duracao(uuid, uuid, text) from anon;
revoke all on function public.cappia__resolver_duracao(uuid, uuid, text) from authenticated;
grant execute on function public.cappia__resolver_duracao(uuid, uuid, text) to service_role;

revoke all on function public.cappia_reservar_agendamento(uuid, date, text, text, uuid, uuid, text, text, text, text, text, text, text, text) from public;
revoke all on function public.cappia_reservar_agendamento(uuid, date, text, text, uuid, uuid, text, text, text, text, text, text, text, text) from anon;
revoke all on function public.cappia_reservar_agendamento(uuid, date, text, text, uuid, uuid, text, text, text, text, text, text, text, text) from authenticated;
grant execute on function public.cappia_reservar_agendamento(uuid, date, text, text, uuid, uuid, text, text, text, text, text, text, text, text) to service_role;
