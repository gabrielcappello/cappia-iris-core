-- A clínica passa a dizer QUAL agendamento está em pauta ao escrever
--
-- ── O CASO (2026-08-21) ─────────────────────────────────────────────────
--   Clínica: "Precisamos remarcar sua consulta do dia 24/08 as 15:00..."
--   Paciente: "pode ser o dia 25, mesmo horario?"
--   Iris: "preciso que me informe qual procedimento você quer remarcar"
--
-- Ela pediu de volta uma informação que a própria clínica tinha acabado de
-- dar. Depois ofereceu os dois agendamentos do dia 24 para escolher, e no
-- fim disse "está confirmado para 25/08" -- sem ter remarcado nada. O banco
-- seguiu com 24/08.
--
-- ── POR QUE ─────────────────────────────────────────────────────────────
-- O texto dizia "dia 24", mas texto é texto: o sistema não guardava QUAL
-- agendamento. O estado da conversa ficava sem `agendamento_id`, e sem alvo
-- a remarcação não tem o que executar.
--
-- `agendamento-pela-data.ts` não resolve este caso: ele casa a data que o
-- paciente MENCIONA com um agendamento oferecido. Aqui ele disse "dia 25",
-- a data de DESTINO -- que não casa com nada.
--
-- ── O QUE MUDA ──────────────────────────────────────────────────────────
-- Parâmetro opcional `p_agendamento_id`. Quando vem preenchido, grava em
-- `dados` do estado da conversa:
--   agendamento_id -- o alvo, que faltava
--   intencao       -- 'remarcacao', porque foi a clínica que pediu
--
-- Assim a Iris já sabe o que está em pauta na primeira resposta do paciente.
--
-- ── COMPATÍVEL COM QUEM JÁ CHAMA ────────────────────────────────────────
-- O parâmetro tem default null e é o ÚLTIMO: `avisar-tratamentos`, que passa
-- três argumentos posicionais, continua funcionando sem alteração.

create or replace function public.iris_nova_registrar_mensagem_enviada(
  p_clinica_id uuid,
  p_telefone_normalizado text,
  p_conteudo text,
  p_agendamento_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_paciente_id uuid;
  v_conversa_id uuid;
  v_turno jsonb;
  v_dados jsonb;
begin
  if p_clinica_id is null or coalesce(trim(p_telefone_normalizado), '') = '' then
    return jsonb_build_object('sucesso', false, 'erro', 'parametros_invalidos');
  end if;
  if coalesce(trim(p_conteudo), '') = '' then
    return jsonb_build_object('sucesso', false, 'erro', 'conteudo_vazio');
  end if;

  select id into v_paciente_id
    from pacientes
   where clinica_id = p_clinica_id
     and telefone_normalizado = p_telefone_normalizado
   limit 1;

  -- `mensagem_paciente` NAO pode ser vazio (ver cabecalho). O marcador diz a
  -- verdade do turno: a clinica iniciou o contato.
  v_turno := jsonb_build_object(
    'mensagem_paciente', '(a clínica iniciou este contato)',
    'resposta_iris', p_conteudo,
    'gerada_em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  -- O agendamento em pauta, quando a clinica informou qual e.
  v_dados := case
    when p_agendamento_id is null then '{}'::jsonb
    else jsonb_build_object(
           'agendamento_id', p_agendamento_id::text,
           'intencao', 'remarcacao'
         )
  end;

  select id into v_conversa_id
    from estado_conversa
   where clinica_id = p_clinica_id
     and telefone_normalizado = p_telefone_normalizado
   limit 1;

  if v_conversa_id is null then
    insert into estado_conversa
      (clinica_id, paciente_id, telefone_normalizado, estado, dados, historico_conversa)
    values
      (p_clinica_id, v_paciente_id, p_telefone_normalizado, 'atendimento', v_dados,
       jsonb_build_array(v_turno))
    returning id into v_conversa_id;
  else
    update estado_conversa
       set historico_conversa = (
             select jsonb_agg(t order by i)
               from (
                 select t, i
                   from jsonb_array_elements(
                          coalesce(historico_conversa, '[]'::jsonb) || jsonb_build_array(v_turno)
                        ) with ordinality as x(t, i)
                  order by i desc
                  limit 10
               ) recentes
           ),
           -- `||` sobrescreve as chaves novas e preserva o resto do que a
           -- conversa ja tinha. Sem agendamento informado, `dados` nao muda.
           dados = coalesce(dados, '{}'::jsonb) || v_dados,
           paciente_id = coalesce(paciente_id, v_paciente_id),
           atualizado_em = now()
     where id = v_conversa_id;
  end if;

  return jsonb_build_object('sucesso', true, 'conversa_id', v_conversa_id);
end;
$function$;

-- `grant` NAO restringe -- so adiciona. Sem o revoke a funcao nasce aberta,
-- e `create or replace` restaura o padrao do Postgres a cada recriacao.
revoke all on function public.iris_nova_registrar_mensagem_enviada(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.iris_nova_registrar_mensagem_enviada(uuid, text, text, uuid) to service_role;
