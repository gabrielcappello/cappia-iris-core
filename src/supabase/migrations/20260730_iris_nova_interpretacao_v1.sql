-- Iris Nova — contrato tecnico de banco para a interpretacao pela IA (Etapa 7)
-- Projeto: cappia-iris-core-dev (bcmuqautblvjdqzhjfbw) — ambiente isolado, somente dev.
-- Baseado no contrato aprovado em specs/interpretacao-ia.md, secao
-- "Contrato tecnico de banco — Etapa 6" (commit c8e55c82054203330919ce094f3e09ae94021aa3).
--
-- Cobre: tres colunas novas em mensagens_recebidas (claim_token,
-- lease_expira_em, interpretacao_persistida_em) e as duas RPCs aprovadas
-- (reivindicar_mensagem, aplicar_interpretacao_condicional). A conclusao e a
-- finalizacao de falha permanecem como UPDATE PostgREST condicional, sem RPC
-- dedicada (ver src/core/finalizar-mensagem.ts).
--
-- Fora de escopo nesta migracao: resultado_continuacao, indices, CHECKs
-- novos, backfill, controlador de agendamento, Edge Function completa.
--
-- NAO APLICADA em nenhum banco (real ou dev) nesta rodada. Esta migracao
-- depende de uma verificacao read-only do banco real imediatamente antes da
-- aplicacao, sem presumir o resultado dessa verificacao (nao presumir
-- tabela vazia, nem que o banco vivo corresponde integralmente ao schema
-- versionado).

-- ============================================================================
-- 1. Colunas novas em public.mensagens_recebidas
-- ============================================================================

alter table public.mensagens_recebidas
  add column claim_token uuid,
  add column lease_expira_em timestamptz,
  add column interpretacao_persistida_em timestamptz;

-- Nenhum default, nenhum NOT NULL: as tres colunas sao nullable, preservando
-- linhas antigas sem qualquer suposicao sobre seu conteudo atual. Nenhum
-- indice, nenhum CHECK, nenhum backfill nesta primeira migration.

-- ============================================================================
-- 2. RPC public.reivindicar_mensagem — reivindicacao (claim inicial e reclaim
--    na mesma operacao atomica).
-- ============================================================================

create or replace function public.reivindicar_mensagem(
  p_provider text,
  p_instancia_whatsapp text,
  p_message_id text,
  p_clinica_id uuid,
  p_telefone_normalizado text
)
returns table (
  resultado text,
  mensagem_recebida_id uuid,
  claim_token uuid,
  lease_expira_em timestamptz,
  interpretacao_persistida_em timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_clinica_id uuid;
  v_telefone_normalizado text;
  v_status text;
  v_lease_expira_em timestamptz;
  v_interpretacao_persistida_em timestamptz;
  v_novo_claim uuid;
  v_nova_lease timestamptz;
begin
  -- 1. localizar e bloquear a linha pela chave unica de deduplicacao, se existir.
  select m.id, m.clinica_id, m.telefone_normalizado, m.status_processamento,
         m.lease_expira_em, m.interpretacao_persistida_em
    into v_id, v_clinica_id, v_telefone_normalizado, v_status,
         v_lease_expira_em, v_interpretacao_persistida_em
  from public.mensagens_recebidas m
  where m.provider = p_provider
    and m.instancia_whatsapp = p_instancia_whatsapp
    and m.message_id = p_message_id
  for update;

  -- Linha inexistente: inserir diretamente como processando.
  if not found then
    v_novo_claim := gen_random_uuid();
    v_nova_lease := transaction_timestamp() + interval '60 seconds';

    insert into public.mensagens_recebidas (
      provider, instancia_whatsapp, message_id, clinica_id, telefone_normalizado,
      status_processamento, claim_token, lease_expira_em
    ) values (
      p_provider, p_instancia_whatsapp, p_message_id, p_clinica_id, p_telefone_normalizado,
      'processando', v_novo_claim, v_nova_lease
    )
    returning id into v_id;

    return query select 'reivindicada_interpretar'::text, v_id, v_novo_claim, v_nova_lease, null::timestamptz;
    return;
  end if;

  -- Chave existe, mas a clinica ou o telefone apresentados nao correspondem
  -- aos valores armazenados: nao altera, nao substitui, nao retorna token,
  -- nao revela dados da linha existente. "is distinct from" (nao "<>") para
  -- nunca deixar um parametro nulo escapar da comparacao por logica
  -- trivalorada (NULL <> x = NULL, que o IF trata como falso).
  if v_clinica_id is distinct from p_clinica_id or v_telefone_normalizado is distinct from p_telefone_normalizado then
    return query select 'nao_elegivel'::text, null::uuid, null::uuid, null::timestamptz, null::timestamptz;
    return;
  end if;

  -- recebida -> processando.
  if v_status = 'recebida' then
    v_novo_claim := gen_random_uuid();
    v_nova_lease := transaction_timestamp() + interval '60 seconds';

    update public.mensagens_recebidas
       set status_processamento = 'processando',
           claim_token = v_novo_claim,
           lease_expira_em = v_nova_lease
     where id = v_id;

    return query select 'reivindicada_interpretar'::text, v_id, v_novo_claim, v_nova_lease, v_interpretacao_persistida_em;
    return;
  end if;

  if v_status = 'processando' then
    -- Lease vigente: nao elegivel, nao altera, nao retorna token utilizavel.
    if v_lease_expira_em > transaction_timestamp() then
      return query select 'nao_elegivel'::text, null::uuid, null::uuid, null::timestamptz, null::timestamptz;
      return;
    end if;

    -- Lease expirado (lease_expira_em <= transaction_timestamp()): reclaim.
    -- Mesma operacao de reivindicacao, sem funcao separada. Preserva
    -- interpretacao_persistida_em (nunca reescrito aqui).
    v_novo_claim := gen_random_uuid();
    v_nova_lease := transaction_timestamp() + interval '60 seconds';

    update public.mensagens_recebidas
       set claim_token = v_novo_claim,
           lease_expira_em = v_nova_lease
     where id = v_id;

    if v_interpretacao_persistida_em is null then
      return query select 'reivindicada_interpretar'::text, v_id, v_novo_claim, v_nova_lease, null::timestamptz;
    else
      return query select 'reivindicada_resposta_fixa'::text, v_id, v_novo_claim, v_nova_lease, v_interpretacao_persistida_em;
    end if;
    return;
  end if;

  -- concluida ou falhou: nao altera, nao retorna token, nao reprocessa.
  return query select 'nao_elegivel'::text, null::uuid, null::uuid, null::timestamptz, null::timestamptz;
end;
$$;

revoke all on function public.reivindicar_mensagem(text, text, text, uuid, text) from public;
revoke all on function public.reivindicar_mensagem(text, text, text, uuid, text) from anon;
revoke all on function public.reivindicar_mensagem(text, text, text, uuid, text) from authenticated;
grant execute on function public.reivindicar_mensagem(text, text, text, uuid, text) to service_role;

-- ============================================================================
-- 3. RPC public.aplicar_interpretacao_condicional — persistencia atomica da
--    interpretacao (claim + CAS + aplicacao de alteracoes_aplicaveis +
--    marcador, em uma unica transacao).
-- ============================================================================

create or replace function public.aplicar_interpretacao_condicional(
  p_mensagem_recebida_id uuid,
  p_clinica_id uuid,
  p_telefone_normalizado text,
  p_claim_token uuid,
  p_conversa_id uuid,
  p_snapshot_atualizado_em timestamptz,
  p_alteracoes_aplicaveis jsonb
)
returns table (
  resultado text,
  conversa_id uuid,
  dados jsonb,
  atualizado_em timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_msg_id uuid;
  v_msg_clinica_id uuid;
  v_msg_telefone text;
  v_msg_status text;
  v_msg_claim_token uuid;
  v_msg_lease timestamptz;
  v_msg_marcador timestamptz;
  v_conv_id uuid;
  v_conv_clinica_id uuid;
  v_conv_telefone text;
  v_conv_atualizado_em timestamptz;
  v_dados_atual jsonb;
  v_dados_novos jsonb;
  v_registro record;
  v_campo text;
  v_alteracao jsonb;
  v_acao text;
  v_houve_alteracao boolean;
  v_novo_atualizado_em timestamptz;
begin
  if p_alteracoes_aplicaveis is null or jsonb_typeof(p_alteracoes_aplicaveis) <> 'object' then
    raise exception 'alteracoes_aplicaveis deve ser um objeto jsonb';
  end if;

  -- 1. localizar e bloquear a linha de mensagens_recebidas (sempre antes de
  --    estado_conversa — ordem fixa de locks).
  select m.id, m.clinica_id, m.telefone_normalizado, m.status_processamento,
         m.claim_token, m.lease_expira_em, m.interpretacao_persistida_em
    into v_msg_id, v_msg_clinica_id, v_msg_telefone, v_msg_status,
         v_msg_claim_token, v_msg_lease, v_msg_marcador
  from public.mensagens_recebidas m
  where m.id = p_mensagem_recebida_id
  for update;

  -- 2. validar autorizacao da mensagem. Todas as causas de rejeicao
  --    (mensagem inexistente, clinica/telefone incompativel, status
  --    incompativel, token incompativel, lease expirado, marcador ja
  --    preenchido) colapsam no mesmo resultado — nunca expor qual condicao
  --    falhou ao chamador. "is distinct from" (nao "<>") nas comparacoes
  --    contra parametros do chamador: um parametro nulo nunca pode escapar
  --    da rejeicao por logica trivalorada (NULL <> x = NULL, que o IF trata
  --    como falso, deixando a condicao inteira "vazar" para o fluxo
  --    autorizado).
  if not found
     or v_msg_clinica_id is distinct from p_clinica_id
     or v_msg_telefone is distinct from p_telefone_normalizado
     or v_msg_status <> 'processando'
     or v_msg_claim_token is distinct from p_claim_token
     or v_msg_lease <= transaction_timestamp()
     or v_msg_marcador is not null
  then
    return query select 'autorizacao_invalida'::text, null::uuid, null::jsonb, null::timestamptz;
    return;
  end if;

  -- 3. localizar e bloquear a linha de estado_conversa (CAS condicional).
  select e.id, e.clinica_id, e.telefone_normalizado, e.dados, e.atualizado_em
    into v_conv_id, v_conv_clinica_id, v_conv_telefone, v_dados_atual, v_conv_atualizado_em
  from public.estado_conversa e
  where e.id = p_conversa_id
  for update;

  -- 4. validar o CAS: id, clinica_id e telefone_normalizado devem
  --    corresponder, e atualizado_em deve ser exatamente o snapshot lido
  --    pelo Core antes de chamar o modelo. "is distinct from" pela mesma
  --    razao do passo 2: nenhum parametro nulo pode escapar da rejeicao.
  if not found
     or v_conv_clinica_id is distinct from p_clinica_id
     or v_conv_telefone is distinct from p_telefone_normalizado
     or v_conv_atualizado_em is distinct from p_snapshot_atualizado_em
  then
    return query select 'conflito_concorrente'::text, null::uuid, null::jsonb, null::timestamptz;
    return;
  end if;

  -- 5. aplicar alteracoes_aplicaveis, quando existirem. Mesma semantica de
  --    calcularNovosDados em src/core/aplicar-dados.ts: informar so
  --    preenche campo ausente (idempotente/preservado caso contrario);
  --    corrigir sempre substitui; remover sempre remove (idempotente se
  --    ausente). Nunca SQL dinamico, nunca concatenacao de identificadores
  --    — jsonb_set/operador "-" com nomes de campo validados contra o
  --    allowlist fixo abaixo.
  v_dados_novos := coalesce(v_dados_atual, '{}'::jsonb);

  for v_registro in select key, value from jsonb_each(p_alteracoes_aplicaveis)
  loop
    v_campo := v_registro.key;
    v_alteracao := v_registro.value;

    if v_campo not in (
      'intencao', 'procedimento_texto', 'dentista_texto', 'data_texto',
      'periodo', 'horario_texto', 'nome', 'cpf', 'data_nascimento', 'email'
    ) then
      raise exception 'campo % nao permitido em alteracoes_aplicaveis', v_campo;
    end if;

    if jsonb_typeof(v_alteracao) <> 'object' then
      raise exception 'estrutura invalida para o campo %', v_campo;
    end if;

    v_acao := v_alteracao->>'acao';
    if v_acao not in ('informar', 'corrigir', 'remover') then
      raise exception 'acao % nao permitida para o campo %', coalesce(v_acao, '<nula>'), v_campo;
    end if;

    if v_acao = 'remover' then
      v_dados_novos := v_dados_novos - v_campo;
    else
      if jsonb_typeof(v_alteracao->'valor') <> 'string' or (v_alteracao->>'valor') = '' then
        raise exception 'valor ausente ou invalido para o campo % (acao %)', v_campo, v_acao;
      end if;

      if v_acao = 'corrigir' then
        v_dados_novos := jsonb_set(v_dados_novos, array[v_campo], v_alteracao->'valor');
      else
        -- informar: so aplica quando o campo ainda nao existe; caso
        -- contrario preserva o valor acumulado (idempotente quando igual,
        -- nunca substitui silenciosamente quando diferente — conflitos
        -- desse tipo ja foram resolvidos pelo Core antes de chamar esta
        -- funcao e nunca chegam aqui dentro de alteracoes_aplicaveis).
        if not (v_dados_novos ? v_campo) then
          v_dados_novos := jsonb_set(v_dados_novos, array[v_campo], v_alteracao->'valor');
        end if;
      end if;
    end if;
  end loop;

  v_houve_alteracao := v_dados_novos is distinct from v_dados_atual;

  if v_houve_alteracao then
    v_novo_atualizado_em := transaction_timestamp();
    if v_novo_atualizado_em <= v_conv_atualizado_em then
      v_novo_atualizado_em := v_conv_atualizado_em + interval '1 millisecond';
    end if;

    update public.estado_conversa
       set dados = v_dados_novos,
           atualizado_em = v_novo_atualizado_em
     where id = v_conv_id;
  else
    -- Sem alteracao efetiva (saida vazia, idempotencia, ou somente
    -- conflitos): dados e atualizado_em permanecem exatamente como estao.
    v_novo_atualizado_em := v_conv_atualizado_em;
  end if;

  -- 6. preencher interpretacao_persistida_em — na mesma transacao do passo 5,
  --    mesmo quando nao houve alteracao efetiva.
  update public.mensagens_recebidas
     set interpretacao_persistida_em = transaction_timestamp()
   where id = v_msg_id;

  -- 7. retornar o estado oficial resultante.
  return query select 'persistida'::text, v_conv_id, v_dados_novos, v_novo_atualizado_em;
end;
$$;

revoke all on function public.aplicar_interpretacao_condicional(uuid, uuid, text, uuid, uuid, timestamptz, jsonb) from public;
revoke all on function public.aplicar_interpretacao_condicional(uuid, uuid, text, uuid, uuid, timestamptz, jsonb) from anon;
revoke all on function public.aplicar_interpretacao_condicional(uuid, uuid, text, uuid, uuid, timestamptz, jsonb) from authenticated;
grant execute on function public.aplicar_interpretacao_condicional(uuid, uuid, text, uuid, uuid, timestamptz, jsonb) to service_role;
