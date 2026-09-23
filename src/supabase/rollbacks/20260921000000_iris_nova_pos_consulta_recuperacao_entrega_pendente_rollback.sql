-- ROLLBACK da migration 20260921000000_iris_nova_pos_consulta_recuperacao_entrega_pendente.sql
-- (volta ao estado da 20260920230000). Arquivo de rollback: NUNCA entra no fluxo de migrations (DA-P4-03).
-- Gerado a partir dos corpos das funcoes da propria 20260920230000 (sem transcricao manual) e ENSAIADO no
-- Postgres local (src/supabase/aplicacao/ensaio-rollback-local.mjs: o estado volta identico).
--
-- USO: so com autorizacao explicita, por acao, e SO DEPOIS de decidir o que fazer com o HISTORICO de migrations
-- (a linha desta versao continuaria em supabase_migrations.schema_migrations: ver "Reconciliar historico" em
-- reviews/runbook-aplicacao-pos-consulta-2026-09-20.md). Nunca usar antes de exportar o que a tabela tem.
--
-- TRAVA: este rollback APAGA as colunas entrega_tentativas/encerramento_motivo. Se ja houver jornada que usa
-- esses dados, ele para -- exporte/decida antes.

do $rollback$
begin
  if exists (
    select 1 from public.pos_consulta_jornadas
     where encerramento_motivo is not null or entrega_tentativas > 1
  ) then
    raise exception 'ROLLBACK RECUSADO: ha jornadas com encerramento_motivo/entrega_tentativas > 1; exporte esses dados e decida antes de apagar as colunas.';
  end if;
end
$rollback$;

drop function if exists public.cappia_pos_consulta_encerrar_sem_resposta(integer);
drop function if exists public.cappia_pos_consulta_expiracao_sem_resposta_minutos();

-- candidatos: o tipo de retorno mudou (acao_edge), entao drop + create da versao da 20260920230000.
drop function if exists public.cappia_pos_consulta_candidatos(integer);
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

drop function if exists public.cappia_pos_consulta_recuperar_entrega(uuid, uuid, uuid, text);

drop trigger if exists pos_consulta_jornadas_tentativas_tg on public.pos_consulta_jornadas;
drop function if exists public.cappia_pos_consulta_jornadas_tentativas_tg();
drop function if exists public.cappia_pos_consulta_max_tentativas_entrega();

alter table public.pos_consulta_jornadas
  drop constraint if exists pos_consulta_jornadas_encerramento_motivo_ck,
  drop constraint if exists pos_consulta_jornadas_entrega_tentativas_ck,
  drop column if exists encerramento_motivo,
  drop column if exists entrega_tentativas;
