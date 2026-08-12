-- Iris Nova - cancelamento de agendamento pelo paciente (banco OPERACIONAL
-- REAL, udizowyfjnhuhgxkeayk).
--
-- Projeto-alvo: udizowyfjnhuhgxkeayk. PROIBIDO aplicar em bcmuqautblvjdqzhjfbw
-- (dev), que tem migration irma propria em src/supabase/migrations/.
--
-- Base normativa: specs/cancelamento-conversacional-v1.md secao 6, aprovada
-- pelo Gabriel em 2026-08-11.
--
-- ── PARIDADE ENTRE OS DOIS BANCOS ────────────────────────────────────────
-- O CORPO DA FUNCAO E IDENTICO ao da migration irma (dev), e desta
-- vez o PREAMBULO TAMBEM: nenhum dos dois bancos precisa de DDL nenhum.
-- Diferente da remarcacao (20260810213500), onde o dev precisava criar
-- `remarcado_de` + FK + indice unico e o operacional ja os tinha.
--
-- ── ZERO DDL -- DECISAO VERIFICADA, NAO ESQUECIMENTO ─────────────────────
-- `agendamentos_status_check` (nome real no OPERACIONAL -- no dev a mesma
-- constraint chama-se `agendamentos_status_valido`) JA ADMITE 'cancelado':
--   CHECK (status = ANY (ARRAY['confirmado','cancelado','remarcado',
--                              'concluido','faltou']))
-- Auditoria read-only de 2026-08-11 confirmou. Cancelar e uma TRANSICAO DE
-- STATUS na propria linha -- nao ha vinculo a registrar (ao contrario da
-- remarcacao, que precisa apontar a sucessora), nao ha linha nova, nao ha
-- coluna nova, nao ha indice novo.
--
-- ── O QUE ESTA MIGRATION FAZ ─────────────────────────────────────────────
-- 1. Funcao nova `cappia_cancelar_agendamento_v2`. Nada alem disso.
--
-- Nao altera nenhuma coluna, constraint, indice, RLS ou dado.
--
-- ── O QUE ESTA MIGRATION NAO FAZ ─────────────────────────────────────────
--   - NAO TOCA `cappia_cancelar_agendamento` (sem sufixo). No banco
--     operacional ela existe VIVA, com outra assinatura
--     (`p_agendamento_id, p_clinica_id` -- SEM p_paciente_id) e SEM checagem
--     de dono nem de status. Por isso o nome novo tem `_v2`. A legada nao e
--     removida, nao e redefinida e nao perde grants -- sua remocao seria
--     etapa propria, com aprovacao propria;
--   - nao toca `cappia_remarcar_agendamento_v2` nem `cappia_reservar_agendamento`;
--   - nao usa nem cria `cappia_disponibilidade_canonica` nem qualquer
--     resolver SQL -- cancelar nao consulta agenda;
--   - nao cria indice para a busca de agendamento ativo (mesma nao-decisao
--     consciente ja registrada em remarcacao-operacional-v1.md secao 4).
--
-- PREFLIGHT (obrigatorio, read-only, imediatamente antes de aplicar):
--   -- o CHECK deve admitir 'cancelado':
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.agendamentos'::regclass and contype='c'
--      and conname='agendamentos_status_check';        -- deve conter 'cancelado'
--   -- a funcao nova nao pode existir ainda:
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='cappia_cancelar_agendamento_v2';
--                                                       -- VAZIO
--
-- NAO APLICADA em nenhum projeto no momento desta escrita.

create or replace function public.cappia_cancelar_agendamento_v2(
  p_clinica_id     uuid,
  p_paciente_id    uuid,
  p_agendamento_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ag agendamentos%rowtype;
begin
  -- ── INVARIANTES DO CORE ────────────────────────────────────────────────
  -- Chegar aqui sem um destes e bug interno, nunca situacao do paciente:
  -- falha fechado, vira ErroRpcTecnico no adaptador e NUNCA entra no
  -- vocabulario conversacional. Mesma disciplina de
  -- cappia_remarcar_agendamento_v2.
  if p_clinica_id is null or p_paciente_id is null or p_agendamento_id is null then
    raise exception 'identificador obrigatorio ausente' using errcode = 'check_violation';
  end if;

  -- ── 1. LOCALIZAR E TRAVAR A LINHA ──────────────────────────────────────
  -- O predicado inclui clinica_id E paciente_id: agendamento de outra clinica
  -- ou de OUTRO PACIENTE e INALCANCAVEL por construcao. E exatamente isso que
  -- a RPC legada nao faz -- ela recebe so (agendamento_id, clinica_id) e
  -- cancelaria agendamento alheio.
  --
  -- Os tres casos (inexistente / outra clinica / outro paciente) devolvem o
  -- MESMO motivo de proposito: distinguir revelaria a existencia de ficha
  -- alheia (spec secao 6, mesma disciplina de cpf-outro-telefone-v1.md).
  --
  -- FOR UPDATE e o MECANISMO PRINCIPAL de idempotencia (spec secao 6): sob
  -- READ COMMITTED, uma execucao concorrente que ficou bloqueada aqui relera
  -- a linha JA ATUALIZADA (o WHERE nao contem `status`, entao a linha
  -- continua casando) e cai no replay do passo 2.
  select * into v_ag
    from agendamentos
   where id = p_agendamento_id
     and clinica_id = p_clinica_id
     and paciente_id = p_paciente_id
   for update;

  if not found then
    return jsonb_build_object('sucesso', false, 'motivo', 'agendamento_nao_encontrado');
  end if;

  -- ── 2. REPLAY ──────────────────────────────────────────────────────────
  -- Devolve SUCESSO, nunca erro: se isto retornasse 'nao_confirmado', um
  -- timeout de rede DEPOIS do commit faria a retentativa parecer falha, e a
  -- Iris diria ao paciente que o cancelamento nao deu certo quando ele deu.
  -- Mesma forma de `ja_remarcado` em cappia_remarcar_agendamento_v2.
  --
  -- Nenhuma linha sucessora a localizar (ao contrario da remarcacao): o
  -- estado do cancelamento vive na PROPRIA linha. Por isso nao existe aqui o
  -- caso degenerado "status sem sucessora" -- ele nao e representavel.
  if v_ag.status = 'cancelado' then
    return jsonb_build_object(
      'sucesso', true, 'ja_cancelado', true, 'agendamento_id', p_agendamento_id);
  end if;

  -- ── 3. SO AGENDAMENTO CONFIRMADO E CANCELAVEL ──────────────────────────
  -- 'remarcado' nao e cancelavel: a linha ativa e a sucessora, com ciclo de
  -- vida proprio. 'concluido'/'faltou' tambem nao -- o atendimento ja
  -- aconteceu (ou ja foi registrado como perdido), e reescrever isso seria
  -- falsear historico clinico. A legada NAO faz esta checagem.
  if v_ag.status <> 'confirmado' then
    return jsonb_build_object('sucesso', false, 'motivo', 'nao_confirmado');
  end if;

  -- ── 4. CANCELAR ────────────────────────────────────────────────────────
  -- SEM advisory lock e SEM checagem de conflito por tsrange, ao contrario da
  -- reserva e da remarcacao: cancelar LIBERA um horario, nunca reivindica um.
  -- Nao ha concorrencia de destino a proteger. Mais simples por construcao,
  -- nao por omissao (spec secao 6).
  --
  -- O horario liberado volta a ficar disponivel sozinho, sem nenhuma escrita
  -- adicional: carregar-disponibilidade.ts so considera ocupado o que esta
  -- 'confirmado'.
  begin
    update agendamentos
       set status = 'cancelado'
     where id = p_agendamento_id;
  exception
    when others then
      -- NUNCA devolve sqlerrm (pode conter SQL, detalhe de linha ou PII) --
      -- ao contrario da RPC legada, que devolvia 'detalhe'.
      return jsonb_build_object('sucesso', false, 'motivo', 'erro_insercao');
  end;

  -- Deliberadamente SEM event_id/calendar_id no retorno, ao contrario da RPC
  -- legada: residuo da integracao com Google Calendar da Iris antiga, fora do
  -- escopo do Core novo (mesmo criterio ja aplicado na remarcacao v2).
  return jsonb_build_object(
    'sucesso', true, 'agendamento_id', p_agendamento_id, 'status', 'cancelado');
end;
$$;

-- Privilegios minimos: revoga o EXECUTE publico padrao do Postgres e concede
-- so a service_role -- mesmo padrao das funcoes anteriores da Iris Nova.
-- NENHUM grant da funcao legada e alterado aqui.
revoke all on function public.cappia_cancelar_agendamento_v2(uuid, uuid, uuid) from public;
revoke all on function public.cappia_cancelar_agendamento_v2(uuid, uuid, uuid) from anon;
revoke all on function public.cappia_cancelar_agendamento_v2(uuid, uuid, uuid) from authenticated;
grant execute on function public.cappia_cancelar_agendamento_v2(uuid, uuid, uuid) to service_role;
