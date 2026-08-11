-- Iris Nova - remarcacao de agendamento, camada operacional (ambiente de
-- desenvolvimento e testes, bcmuqautblvjdqzhjfbw).
--
-- Projeto-alvo: bcmuqautblvjdqzhjfbw. PROIBIDO aplicar em
-- udizowyfjnhuhgxkeayk (banco operacional real), que tem migration irma
-- propria em src/supabase/migrations-legado/ -- ver o bloco "PARIDADE".
--
-- Base normativa: specs/remarcacao-operacional-v1.md (fechada e aprovada
-- pelo Gabriel em 2026-08-10, com os dois ajustes da revisao adversarial
-- incorporados nas secoes 10.1 e 10.2).
--
-- ── PARIDADE ENTRE OS DOIS BANCOS ────────────────────────────────────────
-- Diferente da migration de troca de telefone (20260810185921), aqui o CORPO
-- DA FUNCAO E IDENTICO nos dois bancos -- todas as colunas que a funcao le e
-- escreve existem igualmente nos dois. O que difere e SO o preambulo de DDL:
--
--   aqui (dev): `agendamentos.remarcado_de` NAO EXISTE e e criada abaixo,
--               junto da FK e do indice unico parcial.
--   operacional: `remarcado_de`, a FK `agendamentos_remarcado_de_fkey` e o
--               indice `agendamentos_remarcado_de_uniq` JA EXISTEM (herdados
--               do schema legado completo, auditados read-only em
--               2026-08-10). A migration irma cria SOMENTE a funcao.
--
-- ── O QUE ESTA MIGRATION FAZ ─────────────────────────────────────────────
-- 1. Coluna aditiva `agendamentos.remarcado_de uuid` (nullable, sem default,
--    sem backfill).
-- 2. FK SIMPLES para agendamentos(id), on delete set null -- identica a que
--    ja existe no operacional.
-- 3. Indice UNICO PARCIAL sobre remarcado_de (where not null) -- backstop de
--    idempotencia, identico ao que ja existe no operacional.
-- 4. Funcao nova `cappia_remarcar_agendamento_v2`.
--
-- Nao altera nenhuma outra coluna, constraint, indice, RLS ou dado. Nao
-- remove nem redefine nenhuma funcao existente.
--
-- ── FK SIMPLES, NAO COMPOSTA (decisao registrada) ────────────────────────
-- `P4I.22` manda FK composta com clinica_id. Nao e seguida aqui, de
-- proposito (spec secao 4): `P4I` nao esta implementada, `agendamentos` nao
-- e tabela de `P4I`, e a FK composta exigiria uma constraint
-- `unique (id, clinica_id)` NOVA para fechar um risco que a propria funcao
-- ja fecha deterministicamente (ela filtra por clinica_id no SELECT FOR
-- UPDATE e insere a linha nova com o mesmo p_clinica_id). Divergencia
-- REGISTRADA, nunca reconciliada em silencio.
--
-- ── O QUE ESTA MIGRATION NAO FAZ ─────────────────────────────────────────
--   - nao cria comandos_remarcacao nem remarcacoes_pendentes (tabelas de
--     estado conversacional da Iris antiga, auditadas e RECUSADAS -- spec
--     secao 6);
--   - nao toca `cappia_remarcar_agendamento` (sem sufixo), que existe VIVA
--     no operacional com outra assinatura. Por isso o nome novo tem `_v2`:
--     nenhuma funcao legada perde ou muda de corpo aqui;
--   - nao usa nem cria `cappia_disponibilidade_canonica` nem qualquer
--     resolver SQL de dentista/procedimento/duracao;
--   - nao cria indice para a busca de agendamento ativo (spec secao 4:
--     nao-decisao consciente, reavaliar com volume real).
--
-- PREFLIGHT (obrigatorio, read-only, imediatamente antes de aplicar):
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='agendamentos'
--      and column_name='remarcado_de';           -- deve voltar VAZIO
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='cappia_remarcar_agendamento_v2';
--                                               -- deve voltar VAZIO
--
-- NAO APLICADA em nenhum projeto no momento desta escrita.

-- ── 1..3. Vinculo (aditivo) ──────────────────────────────────────────────

alter table public.agendamentos
  add column if not exists remarcado_de uuid;

comment on column public.agendamentos.remarcado_de is
  'Agendamento que esta linha SUBSTITUIU numa remarcacao (specs/remarcacao-operacional-v1.md secao 4). O vinculo fica sempre na linha NOVA, apontando para a antiga -- nunca o contrario. Nulo = linha nunca originada de remarcacao.';

alter table public.agendamentos
  add constraint agendamentos_remarcado_de_fkey
  foreign key (remarcado_de) references public.agendamentos(id) on delete set null;

-- Backstop de idempotencia (spec secao 5): um agendamento so pode ser a
-- ORIGEM de uma remarcacao, uma unica vez, para sempre. O mecanismo
-- principal e o SELECT ... FOR UPDATE da funcao; este indice existe para o
-- caso de um INSERT chegar por qualquer outra via.
create unique index agendamentos_remarcado_de_uniq
  on public.agendamentos (remarcado_de)
  where remarcado_de is not null;

-- ── 4. Funcao ────────────────────────────────────────────────────────────

create or replace function public.cappia_remarcar_agendamento_v2(
  p_clinica_id      uuid,
  p_paciente_id     uuid,
  p_agendamento_id  uuid,
  p_dentista_id     uuid,
  p_procedimento_id text,
  p_duracao_min     integer,
  p_nova_data       date,
  p_novo_horario    text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ant     agendamentos%rowtype;
  v_suc     agendamentos%rowtype;
  v_ini     timestamp;
  v_fim     timestamp;
  v_dia     timestamp;
  v_novo_id uuid;
begin
  -- ── INVARIANTES DO CORE ────────────────────────────────────────────────
  -- Chegar aqui sem um destes e bug interno, nunca situacao do paciente:
  -- falha fechado, vira ErroRpcTecnico no adaptador e NUNCA entra no
  -- vocabulario conversacional. Mesma disciplina de
  -- cappia_trocar_telefone_paciente.
  if p_clinica_id is null or p_paciente_id is null
     or p_agendamento_id is null or p_dentista_id is null then
    raise exception 'identificador obrigatorio ausente' using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_procedimento_id, '')) = '' then
    raise exception 'procedimento_id ausente' using errcode = 'check_violation';
  end if;

  -- ── 1. VALIDACAO DE FORMA (vocabulario conversacional) ─────────────────
  if p_nova_data is null then
    return jsonb_build_object('sucesso', false, 'motivo', 'data_invalida');
  end if;
  if p_novo_horario is null
     or p_novo_horario !~ '^[0-9]{1,2}:[0-9]{2}$'
     or split_part(p_novo_horario, ':', 1)::int > 23
     or split_part(p_novo_horario, ':', 2)::int > 59 then
    return jsonb_build_object('sucesso', false, 'motivo', 'horario_invalido');
  end if;
  -- Multiplo de 10 NAO e validado aqui, de proposito: essa regra vive
  -- exclusivamente em resolver-duracao.ts (TypeScript), mesma decisao ja
  -- registrada em 20260804150000 para cappia__resolver_duracao.
  if p_duracao_min is null or p_duracao_min <= 0 then
    return jsonb_build_object('sucesso', false, 'motivo', 'duracao_invalida');
  end if;

  -- ── 2. LOCALIZAR E TRAVAR A LINHA ANTIGA ───────────────────────────────
  -- O predicado inclui clinica_id E paciente_id: agendamento de outra
  -- clinica ou de outro paciente e INALCANCAVEL por construcao. Os tres
  -- casos (inexistente / outra clinica / outro paciente) devolvem o MESMO
  -- motivo de proposito -- distinguir revelaria a existencia de ficha alheia
  -- (spec secao 3).
  select * into v_ant
    from agendamentos
   where id = p_agendamento_id
     and clinica_id = p_clinica_id
     and paciente_id = p_paciente_id
   for update;

  if not found then
    return jsonb_build_object('sucesso', false, 'motivo', 'agendamento_nao_encontrado');
  end if;

  -- ── 3. REPLAY ──────────────────────────────────────────────────────────
  -- MECANISMO PRINCIPAL de idempotencia (spec secao 5). Sob READ COMMITTED,
  -- uma execucao concorrente que ficou bloqueada no FOR UPDATE acima releia
  -- a linha JA ATUALIZADA (o WHERE nao contem `status`, entao a linha
  -- continua casando) e cai exatamente aqui.
  --
  -- Devolve SUCESSO, nunca erro: se isto retornasse 'nao_confirmado', um
  -- timeout de rede DEPOIS do commit faria a retentativa parecer falha, e a
  -- Iris diria ao paciente que a remarcacao nao deu certo quando ela deu.
  -- Mesma forma de `ja_cancelado` em cappia_cancelar_agendamento.
  if v_ant.status = 'remarcado' then
    select * into v_suc
      from agendamentos
     where remarcado_de = p_agendamento_id
       and clinica_id = p_clinica_id
     limit 1;

    if found then
      return jsonb_build_object(
        'sucesso', true, 'ja_remarcado', true,
        'agendamento_id', v_suc.id, 'agendamento_id_antigo', p_agendamento_id,
        'dentista_id', v_suc.dentista_id, 'duracao_min', v_suc.duracao_min,
        'data', v_suc.data, 'horario', v_suc.horario);
    end if;

    -- CASO DEGENERADO declarado (spec secao 5): status 'remarcado' SEM
    -- sucessora so e alcancavel por intervencao manual no banco. Nunca
    -- remarca de novo sobre estado inconsistente.
    return jsonb_build_object('sucesso', false, 'motivo', 'nao_confirmado');
  end if;

  -- ── 4. SO AGENDAMENTO CONFIRMADO E REMARCAVEL ──────────────────────────
  if v_ant.status <> 'confirmado' then
    return jsonb_build_object('sucesso', false, 'motivo', 'nao_confirmado');
  end if;

  -- ── 5. LOCK ────────────────────────────────────────────────────────────
  -- Identico a cappia_reservar_agendamento (20260804150000): advisory lock
  -- por clinica:dentista:dia, dia a dia sobre o intervalo novo.
  v_ini := p_nova_data + p_novo_horario::time;
  v_fim := v_ini + make_interval(mins => p_duracao_min);

  for v_dia in select generate_series(date_trunc('day', v_ini),
                                      date_trunc('day', v_fim - interval '1 microsecond'),
                                      interval '1 day') loop
    perform pg_advisory_xact_lock(
      hashtextextended(p_clinica_id::text || ':' || p_dentista_id::text || ':' || v_dia::text, 0));
  end loop;

  -- ── 6. CONFLITO (revalidacao tecnica) ──────────────────────────────────
  -- Mesmo criterio de ocupacao ja canonico: so status='confirmado' ocupa.
  -- `a.id <> p_agendamento_id` e GUARDA DEFENSIVA -- sem ela o agendamento
  -- conflitaria consigo mesmo. Ver spec secao 7, teste 15: na v1 este caso
  -- NAO e alcancavel pelo fluxo (a disponibilidade nunca oferece horario que
  -- sobreponha o proprio agendamento -- limitacao aceita, secao 10.1).
  if exists (
    select 1 from agendamentos a
    where a.clinica_id = p_clinica_id
      and a.dentista_id = p_dentista_id
      and a.status = 'confirmado'
      and a.id <> p_agendamento_id
      and a.horario ~ '^[0-9]{1,2}:[0-9]{2}$'
      and a.data between v_ini::date - 1 and v_fim::date
      and tsrange(a.data + a.horario::time,
                  a.data + a.horario::time + make_interval(mins => coalesce(a.duracao_min, 60)), '[)')
          && tsrange(v_ini, v_fim, '[)')
  ) then
    return jsonb_build_object('sucesso', false, 'motivo', 'horario_ocupado');
  end if;

  -- ── 7 + 8. TROCA (uma unica transacao logica) ──────────────────────────
  begin
    update agendamentos set status = 'remarcado' where id = p_agendamento_id;

    -- `dentista_nome` e `procedimento` sao DENORMALIZACAO de exibicao. Sao
    -- copiados da linha antiga SOMENTE quando o identificador correspondente
    -- nao mudou; caso contrario ficam nulos. Nunca sao resolvidos aqui (a
    -- funcao nao consulta clinicas.dentistas nem procedimentos_catalogo --
    -- resolver e responsabilidade do Core), e nunca sao copiados a esmo, o
    -- que gravaria um nome que nao corresponde ao id da propria linha.
    insert into agendamentos (
      clinica_id, paciente_id, data, horario, nome, documento, telefone,
      procedimento, procedimento_id, status, dentista_nome, dentista_id,
      duracao_min, tipo_documento, gcal_cleanup_pendente, remarcado_de)
    values (
      p_clinica_id, v_ant.paciente_id, p_nova_data, p_novo_horario,
      v_ant.nome, v_ant.documento, v_ant.telefone,
      case when p_procedimento_id is not distinct from v_ant.procedimento_id
           then v_ant.procedimento else null end,
      p_procedimento_id, 'confirmado',
      case when p_dentista_id is not distinct from v_ant.dentista_id
           then v_ant.dentista_nome else null end,
      p_dentista_id, p_duracao_min, v_ant.tipo_documento, false, p_agendamento_id)
    returning id into v_novo_id;

  exception
    when unique_violation then
      -- BACKSTOP do indice unico parcial: outra execucao ja criou a
      -- sucessora. O UPDATE acima e desfeito com o savepoint deste bloco;
      -- devolvemos o mesmo replay do passo 3, nunca um erro.
      select * into v_suc
        from agendamentos
       where remarcado_de = p_agendamento_id
         and clinica_id = p_clinica_id
       limit 1;

      if found then
        return jsonb_build_object(
          'sucesso', true, 'ja_remarcado', true,
          'agendamento_id', v_suc.id, 'agendamento_id_antigo', p_agendamento_id,
          'dentista_id', v_suc.dentista_id, 'duracao_min', v_suc.duracao_min,
          'data', v_suc.data, 'horario', v_suc.horario);
      end if;
      -- Qualquer outra unicidade FALHA FECHADO: nunca reinterpretada como um
      -- motivo conversacional que ela nao e.
      raise;

    when others then
      -- NUNCA devolve sqlerrm (pode conter SQL, detalhe de linha ou PII) --
      -- ao contrario da RPC legada, que devolvia 'detalhe'.
      return jsonb_build_object('sucesso', false, 'motivo', 'erro_insercao');
  end;

  return jsonb_build_object(
    'sucesso', true,
    'agendamento_id', v_novo_id, 'agendamento_id_antigo', p_agendamento_id,
    'dentista_id', p_dentista_id, 'duracao_min', p_duracao_min,
    'data', p_nova_data, 'horario', p_novo_horario);
end;
$$;

-- Privilegios minimos: revoga o EXECUTE publico padrao do Postgres e concede
-- so a service_role -- mesmo padrao das funcoes anteriores da Iris Nova.
revoke all on function public.cappia_remarcar_agendamento_v2(uuid, uuid, uuid, uuid, text, integer, date, text) from public;
revoke all on function public.cappia_remarcar_agendamento_v2(uuid, uuid, uuid, uuid, text, integer, date, text) from anon;
revoke all on function public.cappia_remarcar_agendamento_v2(uuid, uuid, uuid, uuid, text, integer, date, text) from authenticated;
grant execute on function public.cappia_remarcar_agendamento_v2(uuid, uuid, uuid, uuid, text, integer, date, text) to service_role;
