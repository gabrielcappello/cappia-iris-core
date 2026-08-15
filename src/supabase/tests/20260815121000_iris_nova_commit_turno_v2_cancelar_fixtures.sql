-- Fixtures e assertivas de 20260815121000_iris_nova_commit_turno_v2_cancelar.sql
--
-- Projeto-alvo: cappia-iris-core-dev (bcmuqautblvjdqzhjfbw) -- ambiente
-- isolado de desenvolvimento e testes da Iris Nova. PROIBIDO executar em
-- udizowyfjnhuhgxkeayk (projeto operacional, WhatsApp ativo).
--
-- STATUS: EXECUTADO E APROVADO em 2026-08-15, no projeto dev
-- bcmuqautblvjdqzhjfbw -- em DUAS rodadas. A segunda (a que vale) revalidou a
-- RPC ja com o vinculo `estado_conversa.paciente_id = p_paciente_id` no passo
-- 1, corrigido apos o Codex identificar o furo de isolamento; inclui o CASO
-- 8b, escrito justamente para provar esse predicado. A migration real
-- compilou, todas as assertivas terminaram sem excecao e o ROLLBACK foi
-- executado. Verificacao posterior confirmou coluna inexistente, funcao
-- inexistente e zero clinicas/pacientes sinteticos restantes. Producao
-- (udizowyfjnhuhgxkeayk) intocada.
--
-- Executado por composicao numa unica chamada SQL (BEGIN -> migration da
-- coluna com IF NOT EXISTS -> migration real da RPC -> estes fixtures ->
-- ROLLBACK), pelo acesso Supabase ja conectado. As duas tentativas iniciais
-- falharam por encoding ANTES de o SQL chegar ao banco -- sem efeito em
-- estado nenhum; a execucao valida ocorreu em seguida.
--
-- A concorrencia NAO e coberta aqui: foi provada separadamente pelo teste
-- A×B (executar-teste-axb-commit-v2-cancelar.mjs), tambem aprovado.
--
-- ── ESTE ARQUIVO NAO CONTEM COPIA DA FUNCAO ─────────────────────────────
-- Ele so cria os dados sinteticos e faz as assertivas. A FUNCAO SOB TESTE E
-- CARREGADA DO ARQUIVO REAL da migration pelo runner
-- (executar-teste-commit-v2-cancelar.mjs), na MESMA transacao, antes deste
-- arquivo. Assim nao existe corpo duplicado que possa divergir em silencio
-- da migration -- o teste exercita exatamente o que sera aplicado.
--
-- Nem BEGIN nem ROLLBACK aparecem aqui: a transacao e aberta e desfeita pelo
-- runner, que garante o ROLLBACK em `finally` inclusive se o DDL ou uma
-- assertiva falhar. Este arquivo nunca deve ser executado solto.
--
-- ── O QUE ESTE TESTE PROVA, E O QUE NAO PROVA ───────────────────────────
-- PROVA: que a migration real COMPILA, e que o discriminador de autorizacao
-- (`tipo` + `operacao` + `agendamento_id` em `aguardando_resposta`) tem
-- EFEITO REAL -- autorizando o que confere e recusando o que diverge, sem
-- tocar o agendamento.
--
-- NAO PROVA concorrencia. O CAS sob disputa real exige DUAS SESSOES
-- simultaneas e fica para um teste separado. O caso 3 cobre a VERSAO
-- DIVERGENTE, detectavel em sessao unica, e nao substitui aquele teste.
--
-- NAO EXISTE IDEMPOTENCIA DE RETRY nesta funcao, e este teste nao finge que
-- exista: a repeticao IDENTICA de uma chamada ja concluida carrega a versao
-- antiga e sai em `turno_obsoleto` (caso 11). O ramo `ja_cancelado` atende
-- outra coisa -- turno NOVO, autorizacao propria e valida, alvo ja cancelado
-- (caso 12).
--
-- ── AUTOSSUFICIENTE: NENHUMA LINHA PREEXISTENTE E TOCADA ────────────────
-- Toda clinica, paciente, conversa e agendamento e criado aqui, com ids
-- gerados na hora. Nenhuma linha preexistente e lida, travada ou alterada.

do $teste$
declare
  clinica_a   uuid;
  clinica_b   uuid;
  paciente_a  uuid;
  paciente_a2 uuid;  -- outro paciente da MESMA clinica A
  paciente_b  uuid;  -- paciente da clinica B
  conversa_a  uuid;
  conversa_b  uuid;
  ag_alvo     uuid;  -- o agendamento que a confirmacao autoriza cancelar
  ag_outro    uuid;  -- outro agendamento do mesmo paciente (alvo divergente)
  ag_de_b     uuid;  -- agendamento da clinica B
  ag_do_a2    uuid;  -- agendamento de OUTRO paciente da clinica A
  versao      timestamptz;
  versao_c9   timestamptz;  -- versao usada na execucao bem-sucedida (caso 9)
  r           jsonb;
  st          text;
  ctx         jsonb;
  pend        jsonb;
begin
  -- ── DADOS SINTETICOS, TODOS CRIADOS AQUI ──────────────────────────────
  insert into clinicas (provider, instancia_whatsapp)
    values ('evolution', 'teste-commit-v2-clinica-a') returning id into clinica_a;
  insert into clinicas (provider, instancia_whatsapp)
    values ('evolution', 'teste-commit-v2-clinica-b') returning id into clinica_b;

  insert into pacientes (clinica_id, telefone_normalizado, nome)
    values (clinica_a, '5511900000001', 'Teste Paciente A') returning id into paciente_a;
  insert into pacientes (clinica_id, telefone_normalizado, nome)
    values (clinica_a, '5511900000002', 'Teste Paciente A2') returning id into paciente_a2;
  insert into pacientes (clinica_id, telefone_normalizado, nome)
    values (clinica_b, '5511900000003', 'Teste Paciente B') returning id into paciente_b;

  insert into estado_conversa (clinica_id, paciente_id, telefone_normalizado, estado, dados)
    values (clinica_a, paciente_a, '5511900000001', 'aguardando_confirmacao', '{"origem":"teste"}'::jsonb)
    returning id into conversa_a;
  insert into estado_conversa (clinica_id, paciente_id, telefone_normalizado, estado, dados)
    values (clinica_b, paciente_b, '5511900000003', 'aguardando_confirmacao', '{"origem":"teste"}'::jsonb)
    returning id into conversa_b;

  insert into agendamentos (clinica_id, paciente_id, data, horario, procedimento_id, status)
    values (clinica_a, paciente_a, current_date + 7, '10:00', 'teste-proc', 'confirmado')
    returning id into ag_alvo;
  insert into agendamentos (clinica_id, paciente_id, data, horario, procedimento_id, status)
    values (clinica_a, paciente_a, current_date + 8, '11:00', 'teste-proc', 'confirmado')
    returning id into ag_outro;
  insert into agendamentos (clinica_id, paciente_id, data, horario, procedimento_id, status)
    values (clinica_b, paciente_b, current_date + 7, '10:00', 'teste-proc', 'confirmado')
    returning id into ag_de_b;
  insert into agendamentos (clinica_id, paciente_id, data, horario, procedimento_id, status)
    values (clinica_a, paciente_a2, current_date + 9, '12:00', 'teste-proc', 'confirmado')
    returning id into ag_do_a2;

  raise notice 'OK caso0: migration real carregada (compilou) e fixtures criadas';

  -- ══ CASO 1: RECUSA -- sem autorizacao nenhuma ════════════════════════
  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_cancelar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, ag_alvo,
         '{"turno":"c1"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'confirmacao_ausente' then
    raise exception 'FALHA caso1: esperado recusado/confirmacao_ausente, veio %', r;
  end if;
  select status into st from agendamentos where id = ag_alvo;
  if st <> 'confirmado' then
    raise exception 'FALHA caso1: o agendamento foi tocado sem autorizacao (status=%)', st;
  end if;
  raise notice 'OK caso1: sem aguardando_resposta -> recusado, agendamento intacto';

  -- ══ CASO 2: RECUSA -- pergunta existe, mas nao e confirmacao ═════════
  update estado_conversa
     set aguardando_resposta = jsonb_build_object(
           'tipo', 'escolha_agendamento', 'operacao', 'cancelar')
   where id = conversa_a;

  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_cancelar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, ag_alvo,
         '{"turno":"c2"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'pergunta_nao_e_confirmacao' then
    raise exception 'FALHA caso2: esperado recusado/pergunta_nao_e_confirmacao, veio %', r;
  end if;
  raise notice 'OK caso2: escolha_agendamento nao autoriza efeito -> recusado';

  -- ══ CASO 3: TURNO OBSOLETO -- versao divergente ══════════════════════
  -- Detectavel em sessao unica. NAO e o teste de concorrencia.
  update estado_conversa
     set aguardando_resposta = jsonb_build_object(
           'tipo', 'confirmacao', 'operacao', 'cancelar',
           'agendamento_id', ag_alvo::text)
   where id = conversa_a;

  r := cappia_commit_turno_v2_cancelar(
         clinica_a, paciente_a, conversa_a, '5511900000001',
         timestamptz '1999-01-01 00:00:00+00', ag_alvo,
         '{"turno":"c3"}'::jsonb);
  if r ->> 'resultado' is distinct from 'turno_obsoleto'
     or r ->> 'motivo' is distinct from 'versao_divergente' then
    raise exception 'FALHA caso3: esperado turno_obsoleto/versao_divergente, veio %', r;
  end if;
  select status into st from agendamentos where id = ag_alvo;
  if st <> 'confirmado' then
    raise exception 'FALHA caso3: versao divergente produziu efeito (status=%)', st;
  end if;
  raise notice 'OK caso3: versao divergente -> turno_obsoleto, nenhum efeito';

  -- ══ DISCRIMINADOR DE AUTORIZACAO ─ o par que isola o mecanismo ═══════
  -- MESMA entrada, MESMO agendamento, MESMA versao: varia SO a `operacao`
  -- persistida. O lado errado recusa, o lado certo executa -- se os dois
  -- coincidissem, o teste nao provaria que a autorizacao tem efeito.
  -- NAO e teste de concorrencia (exige duas sessoes).

  -- ── CASO 4 (lado errado): operacao divergente ────────────────────────
  update estado_conversa
     set aguardando_resposta = jsonb_build_object(
           'tipo', 'confirmacao', 'operacao', 'remarcar',
           'agendamento_id', ag_alvo::text)
   where id = conversa_a;

  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_cancelar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, ag_alvo,
         '{"turno":"c4"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'operacao_divergente' then
    raise exception 'FALHA caso4: esperado recusado/operacao_divergente, veio %', r;
  end if;
  select status into st from agendamentos where id = ag_alvo;
  if st <> 'confirmado' then
    raise exception 'FALHA caso4: confirmacao de REMARCAR cancelou o agendamento (status=%)', st;
  end if;
  raise notice 'OK caso4: confirmacao de remarcar NAO autoriza cancelar -> recusado';

  -- ── CASO 5 (lado errado): alvo divergente ────────────────────────────
  update estado_conversa
     set aguardando_resposta = jsonb_build_object(
           'tipo', 'confirmacao', 'operacao', 'cancelar',
           'agendamento_id', ag_outro::text)
   where id = conversa_a;

  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_cancelar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, ag_alvo,
         '{"turno":"c5"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'alvo_divergente' then
    raise exception 'FALHA caso5: esperado recusado/alvo_divergente, veio %', r;
  end if;
  select status into st from agendamentos where id = ag_alvo;
  if st <> 'confirmado' then
    raise exception 'FALHA caso5: alvo divergente cancelou o agendamento errado (status=%)', st;
  end if;
  select status into st from agendamentos where id = ag_outro;
  if st <> 'confirmado' then
    raise exception 'FALHA caso5: o agendamento citado na autorizacao foi cancelado (status=%)', st;
  end if;
  raise notice 'OK caso5: alvo divergente -> recusado, nenhum dos dois tocado';

  -- ══ ISOLAMENTO MULTICLINICA / OUTRO PACIENTE ═════════════════════════

  -- ── CASO 6: agendamento de OUTRA CLINICA e inalcancavel ──────────────
  update estado_conversa
     set aguardando_resposta = jsonb_build_object(
           'tipo', 'confirmacao', 'operacao', 'cancelar',
           'agendamento_id', ag_de_b::text)
   where id = conversa_a;

  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_cancelar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, ag_de_b,
         '{"turno":"c6"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'agendamento_nao_encontrado' then
    raise exception 'FALHA caso6: esperado recusado/agendamento_nao_encontrado, veio %', r;
  end if;
  select status into st from agendamentos where id = ag_de_b;
  if st <> 'confirmado' then
    raise exception 'FALHA caso6: agendamento de OUTRA CLINICA foi cancelado (status=%)', st;
  end if;
  raise notice 'OK caso6: agendamento de outra clinica -> inalcancavel';

  -- ── CASO 7: agendamento de OUTRO PACIENTE da mesma clinica ───────────
  update estado_conversa
     set aguardando_resposta = jsonb_build_object(
           'tipo', 'confirmacao', 'operacao', 'cancelar',
           'agendamento_id', ag_do_a2::text)
   where id = conversa_a;

  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_cancelar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, ag_do_a2,
         '{"turno":"c7"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'agendamento_nao_encontrado' then
    raise exception 'FALHA caso7: esperado recusado/agendamento_nao_encontrado, veio %', r;
  end if;
  select status into st from agendamentos where id = ag_do_a2;
  if st <> 'confirmado' then
    raise exception 'FALHA caso7: agendamento de OUTRO PACIENTE foi cancelado (status=%)', st;
  end if;
  raise notice 'OK caso7: agendamento de outro paciente -> inalcancavel';

  -- ── CASO 8: conversa de outra clinica e inalcancavel ─────────────────
  select atualizado_em into versao from estado_conversa where id = conversa_b;
  r := cappia_commit_turno_v2_cancelar(
         clinica_a, paciente_a, conversa_b, '5511900000001', versao, ag_alvo,
         '{"turno":"c8"}'::jsonb);
  if r ->> 'resultado' is distinct from 'turno_obsoleto'
     or r ->> 'motivo' is distinct from 'conversa_nao_encontrada' then
    raise exception 'FALHA caso8: esperado turno_obsoleto/conversa_nao_encontrada, veio %', r;
  end if;
  raise notice 'OK caso8: conversa de outra clinica -> inalcancavel';

  -- ── CASO 8b: conversa de A com paciente/agendamento de OUTRO paciente ─
  -- MESMA CLINICA -- o que torna este caso diferente do 7. Aqui a divergencia
  -- esta no PAR de parametros: a conversa e do paciente A, mas `p_paciente_id`
  -- e o agendamento sao do paciente A2.
  --
  -- Sem `and paciente_id = p_paciente_id` no predicado do passo 1, este par
  -- era ACEITO: a conversa de A seria travada, a autorizacao gravada NELA
  -- seria lida, e a busca do passo 3 (que filtra por p_paciente_id)
  -- localizaria o agendamento de A2 -- cancelando na ficha errada com
  -- autorizacao alheia. Com o predicado corrigido, a linha nem e encontrada.
  --
  -- A autorizacao e montada na conversa de A apontando para o agendamento de
  -- A2 DE PROPOSITO: sem isso o teste pararia em `alvo_divergente` e nao
  -- provaria o predicado novo.
  update estado_conversa
     set aguardando_resposta = jsonb_build_object(
           'tipo', 'confirmacao', 'operacao', 'cancelar',
           'agendamento_id', ag_do_a2::text)
   where id = conversa_a;

  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_cancelar(
         clinica_a, paciente_a2, conversa_a, '5511900000001', versao, ag_do_a2,
         '{"turno":"c8b"}'::jsonb);
  if r ->> 'resultado' is distinct from 'turno_obsoleto'
     or r ->> 'motivo' is distinct from 'conversa_nao_encontrada' then
    raise exception 'FALHA caso8b: esperado turno_obsoleto/conversa_nao_encontrada, veio %', r;
  end if;
  select status into st from agendamentos where id = ag_do_a2;
  if st <> 'confirmado' then
    raise exception 'FALHA caso8b: agendamento de OUTRO paciente foi cancelado (status=%)', st;
  end if;
  select status into st from agendamentos where id = ag_alvo;
  if st <> 'confirmado' then
    raise exception 'FALHA caso8b: o agendamento do paciente da conversa foi tocado (status=%)', st;
  end if;
  raise notice 'OK caso8b: paciente divergente da conversa -> turno_obsoleto, nenhum efeito';

  -- ══ CASO 9 (lado certo do discriminador): SUCESSO ════════════════════
  -- Autorizacao confere em tudo: tipo, operacao E alvo. O contraste com os
  -- casos 4 e 5, com a mesma entrada, e o que prova o efeito.
  update estado_conversa
     set aguardando_resposta = jsonb_build_object(
           'tipo', 'confirmacao', 'operacao', 'cancelar',
           'agendamento_id', ag_alvo::text),
         contexto_horarios   = '{"proposta_pendente":{"data":"2026-08-20","horario":"10:00"}}'::jsonb
   where id = conversa_a;

  -- GUARDADA para o caso 11: e esta versao que a repeticao identica usaria.
  select atualizado_em into versao_c9 from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_cancelar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao_c9, ag_alvo,
         '{"turno":"c9"}'::jsonb);
  if r ->> 'resultado' is distinct from 'executado'
     or r ->> 'status' is distinct from 'cancelado' then
    raise exception 'FALHA caso9: esperado executado/cancelado, veio %', r;
  end if;
  select status into st from agendamentos where id = ag_alvo;
  if st <> 'cancelado' then
    raise exception 'FALHA caso9: o agendamento NAO foi cancelado (status=%)', st;
  end if;
  raise notice 'OK caso9: autorizacao completa -> executado, agendamento cancelado';

  -- ── CASO 10: o estado final foi gravado como a spec exige ────────────
  select aguardando_resposta, contexto_horarios, dados
    into pend, ctx, r
    from estado_conversa where id = conversa_a;
  if pend is not null then
    raise exception 'FALHA caso10: aguardando_resposta nao foi zerado (%)', pend;
  end if;
  if ctx is not null then
    raise exception 'FALHA caso10: contexto_horarios nao foi zerado (%)', ctx;
  end if;
  if r ->> 'turno' is distinct from 'c9' then
    raise exception 'FALHA caso10: dados nao veio do parametro deste turno (%)', r;
  end if;
  raise notice 'OK caso10: aguardando_resposta e contexto_horarios NULL; dados do turno';

  -- ══ CASO 11: REPETICAO IDENTICA -> turno_obsoleto ════════════════════
  -- A MESMA chamada do caso 9, com a MESMA `versao_inicial` (versao_c9) --
  -- o que um cliente faria ao reenviar apos timeout. NAO ha idempotencia de
  -- retry nesta funcao: a versao ja foi avancada pela execucao anterior, e a
  -- repeticao sai em turno_obsoleto ANTES de qualquer efeito. Este e o
  -- comportamento CORRETO e esperado, nao uma limitacao a contornar.
  r := cappia_commit_turno_v2_cancelar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao_c9, ag_alvo,
         '{"turno":"c9"}'::jsonb);
  if r ->> 'resultado' is distinct from 'turno_obsoleto'
     or r ->> 'motivo' is distinct from 'versao_divergente' then
    raise exception 'FALHA caso11: repeticao identica devolveu %, esperado turno_obsoleto/versao_divergente', r;
  end if;
  raise notice 'OK caso11: repeticao identica -> turno_obsoleto (sem idempotencia de retry)';

  -- ══ CASO 12: NOVA AUTORIZACAO sobre agendamento ja cancelado ═════════
  -- O unico caminho que ALCANCA o ramo `ja_cancelado`: turno NOVO, versao
  -- vigente, autorizacao propria e valida, alvo ja cancelado. Devolve
  -- SUCESSO -- o estado pedido ja e o estado do mundo.
  update estado_conversa
     set aguardando_resposta = jsonb_build_object(
           'tipo', 'confirmacao', 'operacao', 'cancelar',
           'agendamento_id', ag_alvo::text)
   where id = conversa_a;

  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_cancelar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, ag_alvo,
         '{"turno":"c12"}'::jsonb);
  if r ->> 'resultado' is distinct from 'executado'
     or (r ->> 'ja_cancelado') is distinct from 'true' then
    raise exception 'FALHA caso12: esperado executado/ja_cancelado=true, veio %', r;
  end if;
  select aguardando_resposta, contexto_horarios into pend, ctx
    from estado_conversa where id = conversa_a;
  if pend is not null or ctx is not null then
    raise exception 'FALHA caso12: o ramo ja_cancelado nao zerou o estado (pend=%, ctx=%)', pend, ctx;
  end if;
  raise notice 'OK caso12: nova autorizacao sobre alvo ja cancelado -> executado/ja_cancelado';

  -- ══ CASO 13: alvo ja cancelado SEM autorizacao nao recebe sucesso ════
  -- Prova a ordem: a autorizacao vem ANTES do ramo `ja_cancelado`. Um turno
  -- sem autoridade nao pode colher "sucesso" de efeito que outro turno fez.
  update estado_conversa set aguardando_resposta = null where id = conversa_a;

  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_cancelar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, ag_alvo,
         '{"turno":"c13"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'confirmacao_ausente' then
    raise exception 'FALHA caso13: alvo ja cancelado SEM autorizacao devolveu %', r;
  end if;
  raise notice 'OK caso13: alvo ja cancelado SEM autorizacao -> recusado, nunca sucesso';

  -- ══ CASO 14: p_dados invalido falha fechado ══════════════════════════
  update estado_conversa
     set aguardando_resposta = jsonb_build_object(
           'tipo', 'confirmacao', 'operacao', 'cancelar',
           'agendamento_id', ag_alvo::text)
   where id = conversa_a;
  select atualizado_em into versao from estado_conversa where id = conversa_a;

  begin
    r := cappia_commit_turno_v2_cancelar(
           clinica_a, paciente_a, conversa_a, '5511900000001', versao, ag_alvo, null);
    raise exception 'FALHA caso14a: p_dados NULL nao falhou fechado (veio %)', r;
  exception when check_violation then
    raise notice 'OK caso14a: p_dados NULL -> check_violation';
  end;

  begin
    r := cappia_commit_turno_v2_cancelar(
           clinica_a, paciente_a, conversa_a, '5511900000001', versao, ag_alvo,
           '"texto"'::jsonb);
    raise exception 'FALHA caso14b: p_dados escalar nao falhou fechado (veio %)', r;
  exception when check_violation then
    raise notice 'OK caso14b: p_dados escalar -> check_violation';
  end;

  begin
    r := cappia_commit_turno_v2_cancelar(
           clinica_a, paciente_a, conversa_a, '5511900000001', versao, ag_alvo,
           '[]'::jsonb);
    raise exception 'FALHA caso14c: p_dados array nao falhou fechado (veio %)', r;
  exception when check_violation then
    raise notice 'OK caso14c: p_dados array -> check_violation';
  end;

  raise notice '=== TODOS OS CASOS PASSARAM ===';
end;
$teste$;
