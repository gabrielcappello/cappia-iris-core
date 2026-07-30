-- Testes de 20260730_iris_nova_interpretacao_v1.sql
-- NAO EXECUTADO nesta rodada (Etapa 7): nenhuma migration foi aplicada em
-- banco real ou dev. Este arquivo fica versionado para revisao estatica e
-- para execucao futura, quando a migration for aplicada, seguindo o mesmo
-- padrao de 20260729_iris_nova_identificacao_v1_constraints.sql e
-- 20260729_iris_nova_identificacao_v1_correcao_constraints.sql: cria dados
-- sinteticos, remove tudo ao final, usa somente dados de teste (nunca dados
-- reais ou de outra clinica).
--
-- Observacao sobre concorrencia real: este script roda em uma unica sessao
-- (um unico bloco `do $$ ... $$`, uma unica transacao). Ele nao pode
-- reproduzir duas sessoes verdadeiramente simultaneas disputando o mesmo
-- `FOR UPDATE`. Os testes de "vencedor unico" abaixo verificam o
-- comportamento sequencial correto (a segunda tentativa encontra a linha ja
-- reivindicada/alterada) — a exclusao mutua real entre sessoes concorrentes
-- decorre diretamente do lock de linha do `FOR UPDATE` dentro de cada RPC,
-- que e uma garantia do proprio PostgreSQL, nao testada aqui a nivel de
-- script.
--
-- Cobertura (numeracao conforme especificacao da Etapa 7):
--   1. tres colunas existem
--   2. colunas sao nullable
--   3. nenhuma coluna adicional criada
--   4. PUBLIC sem EXECUTE
--   5. anon sem EXECUTE
--   6. authenticated sem EXECUTE
--   7. service_role com EXECUTE
--   8. linha inexistente e reivindicada
--   9. recebida -> processando
--  10. token gerado no servidor
--  11. lease de aproximadamente 60 segundos
--  12. dois workers concorrentes: um unico vencedor (ver observacao acima)
--  13. processando vigente -> nao_elegivel
--  14. processando expirado com marcador null -> reivindicada_interpretar
--  15. processando expirado com marcador preenchido -> reivindicada_resposta_fixa
--  16. concluida -> nao_elegivel
--  17. falhou -> nao_elegivel
--  18. clinica incompativel -> nao_elegivel
--  19. telefone incompativel -> nao_elegivel
--  20. incompatibilidade nao altera linha
--  21. lease igual a transaction_timestamp() e expirado
--  22. persistencia valida altera estado e marcador
--  23. CAS invalido -> conflito_concorrente
--  24. token invalido -> autorizacao_invalida
--  25. lease expirado -> autorizacao_invalida
--  26. marcador preenchido -> autorizacao_invalida
--  27. clinica incompativel -> autorizacao_invalida
--  28. telefone incompativel -> autorizacao_invalida
--  29. saida vazia preenche marcador
--  30. idempotencia preserva atualizado_em
--  31. somente conflitos equivale a alteracoes vazias
--  32. resultado misto aplica somente alteracoes enviadas
--  33. rollback em falha (excecao antes de qualquer UPDATE nao deixa rastro)
--  34. dois message_id com mesmo snapshot: um CAS vence
--  35. mensagem posterior com snapshot atualizado persiste
--  36. isolamento entre clinicas
--  37. campos nao permitidos sao rejeitados
--  38. estrutura invalida e rejeitada
--  39. claim_token nulo nao bypassa autorizacao (is distinct from, nao <>)
--  40. snapshot_atualizado_em nulo nao bypassa o CAS (is distinct from, nao <>)

do $$
declare
  clinica_a uuid;
  clinica_b uuid;
  conversa_a uuid;
  conversa_b uuid;
  v_count integer;
  v_bool boolean;
  v_ts timestamptz;

  v_resultado text;
  v_msg_id uuid;
  v_claim uuid;
  v_claim2 uuid;
  v_lease timestamptz;
  v_marcador timestamptz;

  v_conv_resultado text;
  v_conv_id uuid;
  v_dados jsonb;
  v_atualizado_em timestamptz;
  v_atualizado_em2 timestamptz;

  v_check_clinica uuid;
  v_check_telefone text;
begin
  -- setup basico ----------------------------------------------------------
  insert into clinicas (provider, instancia_whatsapp) values ('evolution', 'interp-clinica-a') returning id into clinica_a;
  insert into clinicas (provider, instancia_whatsapp) values ('evolution', 'interp-clinica-b') returning id into clinica_b;

  insert into estado_conversa (clinica_id, telefone_normalizado, estado, dados)
  values (clinica_a, '5511900000001', 'atendimento', '{}'::jsonb)
  returning id into conversa_a;

  insert into estado_conversa (clinica_id, telefone_normalizado, estado, dados)
  values (clinica_b, '5511900000002', 'atendimento', '{}'::jsonb)
  returning id into conversa_b;

  -- 1-3. schema --------------------------------------------------------------
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'mensagens_recebidas'
    and column_name in ('claim_token', 'lease_expira_em', 'interpretacao_persistida_em');
  if v_count <> 3 then
    raise exception 'FALHA teste1: esperado 3 colunas novas, encontrado %', v_count;
  end if;
  raise notice 'OK teste1: as tres colunas existem';

  select bool_and(is_nullable = 'YES') into v_bool
  from information_schema.columns
  where table_schema = 'public' and table_name = 'mensagens_recebidas'
    and column_name in ('claim_token', 'lease_expira_em', 'interpretacao_persistida_em');
  if not v_bool then
    raise exception 'FALHA teste2: alguma das tres colunas nao e nullable';
  end if;
  raise notice 'OK teste2: as tres colunas sao nullable';

  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'mensagens_recebidas';
  if v_count <> 12 then
    raise exception 'FALHA teste3: esperado 12 colunas totais em mensagens_recebidas (9 originais + 3 novas), encontrado %', v_count;
  end if;
  raise notice 'OK teste3: nenhuma coluna adicional foi criada';

  -- 4-7. grants ----------------------------------------------------------
  select bool_or(p) into v_bool from (
    select has_function_privilege('public', 'public.reivindicar_mensagem(text,text,text,uuid,text)', 'EXECUTE') as p
    union all select has_function_privilege('public', 'public.aplicar_interpretacao_condicional(uuid,uuid,text,uuid,uuid,timestamptz,jsonb)', 'EXECUTE')
  ) t;
  if v_bool then
    raise exception 'FALHA teste4: PUBLIC ainda possui EXECUTE em alguma das RPCs';
  end if;
  raise notice 'OK teste4: PUBLIC sem EXECUTE nas duas RPCs';

  select bool_or(p) into v_bool from (
    select has_function_privilege('anon', 'public.reivindicar_mensagem(text,text,text,uuid,text)', 'EXECUTE') as p
    union all select has_function_privilege('anon', 'public.aplicar_interpretacao_condicional(uuid,uuid,text,uuid,uuid,timestamptz,jsonb)', 'EXECUTE')
  ) t;
  if v_bool then
    raise exception 'FALHA teste5: anon ainda possui EXECUTE em alguma das RPCs';
  end if;
  raise notice 'OK teste5: anon sem EXECUTE nas duas RPCs';

  select bool_or(p) into v_bool from (
    select has_function_privilege('authenticated', 'public.reivindicar_mensagem(text,text,text,uuid,text)', 'EXECUTE') as p
    union all select has_function_privilege('authenticated', 'public.aplicar_interpretacao_condicional(uuid,uuid,text,uuid,uuid,timestamptz,jsonb)', 'EXECUTE')
  ) t;
  if v_bool then
    raise exception 'FALHA teste6: authenticated ainda possui EXECUTE em alguma das RPCs';
  end if;
  raise notice 'OK teste6: authenticated sem EXECUTE nas duas RPCs';

  select bool_and(p) into v_bool from (
    select has_function_privilege('service_role', 'public.reivindicar_mensagem(text,text,text,uuid,text)', 'EXECUTE') as p
    union all select has_function_privilege('service_role', 'public.aplicar_interpretacao_condicional(uuid,uuid,text,uuid,uuid,timestamptz,jsonb)', 'EXECUTE')
  ) t;
  if not v_bool then
    raise exception 'FALHA teste7: service_role perdeu EXECUTE em alguma das RPCs';
  end if;
  raise notice 'OK teste7: service_role com EXECUTE nas duas RPCs';

  -- 8-9. linha inexistente e recebida -> processando -----------------------
  select * into v_resultado, v_msg_id, v_claim, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000001');
  if v_resultado <> 'reivindicada_interpretar' or v_msg_id is null or v_claim is null then
    raise exception 'FALHA teste8: linha inexistente nao foi reivindicada corretamente (resultado=%)', v_resultado;
  end if;
  raise notice 'OK teste8: linha inexistente e reivindicada (reivindicada_interpretar)';

  select status_processamento into v_resultado from mensagens_recebidas where id = v_msg_id;
  if v_resultado <> 'processando' then
    raise exception 'FALHA teste9: status apos reivindicacao deveria ser processando, e %', v_resultado;
  end if;
  raise notice 'OK teste9: recebida -> processando (linha ja nasce processando quando inexistente)';

  -- 10. token gerado no servidor -------------------------------------------
  if v_claim is null then
    raise exception 'FALHA teste10: claim_token nao foi gerado';
  end if;
  raise notice 'OK teste10: claim_token gerado no servidor (nao nulo, tipo uuid)';

  -- 11. lease de aproximadamente 60 segundos -------------------------------
  if v_lease < transaction_timestamp() + interval '55 seconds'
     or v_lease > transaction_timestamp() + interval '65 seconds' then
    raise exception 'FALHA teste11: lease fora da janela esperada de ~60s (lease=%)', v_lease;
  end if;
  raise notice 'OK teste11: lease de aproximadamente 60 segundos';

  -- 12. dois workers concorrentes (sequencial - ver observacao no cabecalho) --
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a2', clinica_a, '5511900000001');
  if v_resultado <> 'reivindicada_interpretar' then
    raise exception 'FALHA teste12 (parte 1): primeira reivindicacao deveria vencer';
  end if;
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a2', clinica_a, '5511900000001');
  if v_resultado <> 'nao_elegivel' then
    raise exception 'FALHA teste12 (parte 2): segunda tentativa sobre a mesma chave deveria ser nao_elegivel (lease vigente), foi %', v_resultado;
  end if;
  raise notice 'OK teste12: somente um vencedor sequencial para a mesma chave (exclusao mutua real depende do FOR UPDATE do PostgreSQL, nao testada aqui)';

  -- 13. processando vigente -> nao_elegivel --------------------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000001');
  if v_resultado <> 'nao_elegivel' or v_claim2 is not null then
    raise exception 'FALHA teste13: processando com lease vigente deveria ser nao_elegivel sem token, foi % (token=%)', v_resultado, v_claim2;
  end if;
  raise notice 'OK teste13: processando com lease vigente -> nao_elegivel, sem token';

  -- 14. processando expirado com marcador null -> reivindicada_interpretar --
  update mensagens_recebidas set lease_expira_em = transaction_timestamp() - interval '1 second'
  where provider = 'evolution' and instancia_whatsapp = 'interp-clinica-a' and message_id = 'msg-a1';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000001');
  if v_resultado <> 'reivindicada_interpretar' or v_claim2 is null or v_claim2 = v_claim then
    raise exception 'FALHA teste14: reclaim com marcador null deveria retornar reivindicada_interpretar com novo token, foi %', v_resultado;
  end if;
  raise notice 'OK teste14: processando expirado com marcador null -> reivindicada_interpretar (token renovado)';

  -- 15. processando expirado com marcador preenchido -> reivindicada_resposta_fixa --
  update mensagens_recebidas
     set interpretacao_persistida_em = transaction_timestamp(),
         lease_expira_em = transaction_timestamp() - interval '1 second'
   where provider = 'evolution' and instancia_whatsapp = 'interp-clinica-a' and message_id = 'msg-a1';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000001');
  if v_resultado <> 'reivindicada_resposta_fixa' or v_marcador is null then
    raise exception 'FALHA teste15: reclaim com marcador preenchido deveria retornar reivindicada_resposta_fixa preservando o marcador, foi %', v_resultado;
  end if;
  raise notice 'OK teste15: processando expirado com marcador preenchido -> reivindicada_resposta_fixa (marcador preservado)';

  -- 16. concluida -> nao_elegivel -------------------------------------------
  update mensagens_recebidas set status_processamento = 'concluida', concluido_em = transaction_timestamp()
  where provider = 'evolution' and instancia_whatsapp = 'interp-clinica-a' and message_id = 'msg-a1';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000001');
  if v_resultado <> 'nao_elegivel' then
    raise exception 'FALHA teste16: concluida deveria ser nao_elegivel, foi %', v_resultado;
  end if;
  raise notice 'OK teste16: concluida -> nao_elegivel';

  -- 17. falhou -> nao_elegivel -----------------------------------------------
  insert into mensagens_recebidas (provider, instancia_whatsapp, message_id, clinica_id, telefone_normalizado, status_processamento, concluido_em)
  values ('evolution', 'interp-clinica-a', 'msg-a3', clinica_a, '5511900000001', 'falhou', transaction_timestamp());

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a3', clinica_a, '5511900000001');
  if v_resultado <> 'nao_elegivel' then
    raise exception 'FALHA teste17: falhou deveria ser nao_elegivel, foi %', v_resultado;
  end if;
  raise notice 'OK teste17: falhou -> nao_elegivel';

  -- 18-20. incompatibilidade de clinica/telefone --------------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_b, '5511900000001');
  if v_resultado <> 'nao_elegivel' or v_claim2 is not null then
    raise exception 'FALHA teste18: clinica incompativel deveria ser nao_elegivel sem token, foi %', v_resultado;
  end if;
  raise notice 'OK teste18: clinica incompativel -> nao_elegivel';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000099');
  if v_resultado <> 'nao_elegivel' or v_claim2 is not null then
    raise exception 'FALHA teste19: telefone incompativel deveria ser nao_elegivel sem token, foi %', v_resultado;
  end if;
  raise notice 'OK teste19: telefone incompativel -> nao_elegivel';

  select m.clinica_id, m.telefone_normalizado into v_check_clinica, v_check_telefone
  from mensagens_recebidas m
  where m.provider = 'evolution' and m.instancia_whatsapp = 'interp-clinica-a' and m.message_id = 'msg-a1';
  if v_check_clinica <> clinica_a or v_check_telefone <> '5511900000001' then
    raise exception 'FALHA teste20: incompatibilidade alterou clinica_id ou telefone_normalizado armazenados (clinica=%, telefone=%)', v_check_clinica, v_check_telefone;
  end if;
  raise notice 'OK teste20: incompatibilidade nao altera a linha (clinica_id/telefone_normalizado armazenados permanecem os originais)';

  -- 21. lease igual a transaction_timestamp() e expirado --------------------
  v_ts := transaction_timestamp();
  update mensagens_recebidas set lease_expira_em = v_ts, interpretacao_persistida_em = null, status_processamento = 'processando'
  where provider = 'evolution' and instancia_whatsapp = 'interp-clinica-a' and message_id = 'msg-a1';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000001');
  if v_resultado <> 'reivindicada_interpretar' then
    raise exception 'FALHA teste21: lease_expira_em igual a transaction_timestamp() deveria contar como expirado, resultado foi %', v_resultado;
  end if;
  raise notice 'OK teste21: lease_expira_em = transaction_timestamp() e tratado como expirado';

  -- 22. persistencia valida altera estado e marcador -----------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-b1', clinica_a, '5511900000001');

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    jsonb_build_object('nome', jsonb_build_object('acao', 'informar', 'valor', 'Maria'))
  );
  if v_conv_resultado <> 'persistida' or (v_dados->>'nome') <> 'Maria' then
    raise exception 'FALHA teste22: persistencia valida deveria retornar persistida com dados atualizados, foi % (dados=%)', v_conv_resultado, v_dados;
  end if;
  select interpretacao_persistida_em into v_ts from mensagens_recebidas where id = v_msg_id;
  if v_ts is null then
    raise exception 'FALHA teste22: marcador nao foi preenchido apos persistencia valida';
  end if;
  raise notice 'OK teste22: persistencia valida altera estado_conversa.dados e preenche o marcador';

  -- 23. CAS invalido -> conflito_concorrente -------------------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-b2', clinica_a, '5511900000001');

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    '2000-01-01T00:00:00Z'::timestamptz, -- snapshot deliberadamente obsoleto
    jsonb_build_object('nome', jsonb_build_object('acao', 'corrigir', 'valor', 'Outro'))
  );
  if v_conv_resultado <> 'conflito_concorrente' or v_conv_id is not null or v_dados is not null then
    raise exception 'FALHA teste23: snapshot obsoleto deveria retornar conflito_concorrente sem estado, foi %', v_conv_resultado;
  end if;
  select (dados->>'nome') into v_resultado from estado_conversa where id = conversa_a;
  if v_resultado <> 'Maria' then
    raise exception 'FALHA teste23: CAS invalido nao deveria ter alterado estado_conversa.dados, mas alterou para %', v_resultado;
  end if;
  raise notice 'OK teste23: CAS invalido -> conflito_concorrente, sem alteracao em estado_conversa';

  -- 24. token invalido -> autorizacao_invalida -----------------------------
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', gen_random_uuid(), conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'autorizacao_invalida' then
    raise exception 'FALHA teste24: claim_token invalido deveria retornar autorizacao_invalida, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste24: claim_token invalido -> autorizacao_invalida';

  -- 25. lease expirado -> autorizacao_invalida -----------------------------
  update mensagens_recebidas set lease_expira_em = transaction_timestamp() - interval '1 second' where id = v_msg_id;
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'autorizacao_invalida' then
    raise exception 'FALHA teste25: lease expirado deveria retornar autorizacao_invalida, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste25: lease expirado -> autorizacao_invalida';
  update mensagens_recebidas set lease_expira_em = transaction_timestamp() + interval '60 seconds' where id = v_msg_id;

  -- 26. marcador preenchido -> autorizacao_invalida ------------------------
  update mensagens_recebidas set interpretacao_persistida_em = transaction_timestamp() where id = v_msg_id;
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'autorizacao_invalida' then
    raise exception 'FALHA teste26: marcador ja preenchido deveria retornar autorizacao_invalida, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste26: marcador ja preenchido -> autorizacao_invalida';

  -- 27-28. clinica/telefone incompativel na persistencia -------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-b3', clinica_a, '5511900000001');

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_b, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'autorizacao_invalida' then
    raise exception 'FALHA teste27: clinica incompativel na persistencia deveria retornar autorizacao_invalida, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste27: clinica incompativel -> autorizacao_invalida';

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000099', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'autorizacao_invalida' then
    raise exception 'FALHA teste28: telefone incompativel na persistencia deveria retornar autorizacao_invalida, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste28: telefone incompativel -> autorizacao_invalida';

  -- 29. saida vazia preenche marcador ---------------------------------------
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'persistida' then
    raise exception 'FALHA teste29: saida vazia deveria retornar persistida, foi %', v_conv_resultado;
  end if;
  select interpretacao_persistida_em into v_ts from mensagens_recebidas where id = v_msg_id;
  if v_ts is null then
    raise exception 'FALHA teste29: marcador nao foi preenchido para saida vazia';
  end if;
  raise notice 'OK teste29: saida vazia -> persistida, marcador preenchido';

  -- 30. idempotencia preserva atualizado_em ---------------------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-b4', clinica_a, '5511900000001');

  select atualizado_em into v_atualizado_em from estado_conversa where id = conversa_a;
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em2
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    v_atualizado_em,
    jsonb_build_object('nome', jsonb_build_object('acao', 'informar', 'valor', 'Maria')) -- mesmo valor ja acumulado
  );
  if v_conv_resultado <> 'persistida' or v_atualizado_em2 <> v_atualizado_em then
    raise exception 'FALHA teste30: informar valor identico deveria ser idempotente e preservar atualizado_em (esperado=%, obtido=%)', v_atualizado_em, v_atualizado_em2;
  end if;
  raise notice 'OK teste30: idempotencia preserva atualizado_em';

  -- 31. somente conflitos equivale a alteracoes vazias ----------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-b5', clinica_a, '5511900000001');

  select atualizado_em into v_atualizado_em from estado_conversa where id = conversa_a;
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em2
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a, v_atualizado_em, '{}'::jsonb
  );
  if v_conv_resultado <> 'persistida' or v_atualizado_em2 <> v_atualizado_em then
    raise exception 'FALHA teste31: alteracoes_aplicaveis vazias (somente conflitos do lado do Core) deveria se comportar como saida vazia';
  end if;
  raise notice 'OK teste31: somente conflitos (alteracoes_aplicaveis vazias) equivale a saida vazia';

  -- 32. resultado misto aplica somente alteracoes enviadas -------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-b6', clinica_a, '5511900000001');

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    jsonb_build_object('procedimento_texto', jsonb_build_object('acao', 'informar', 'valor', 'limpeza'))
  );
  if v_conv_resultado <> 'persistida' or (v_dados->>'nome') <> 'Maria' or (v_dados->>'procedimento_texto') <> 'limpeza' then
    raise exception 'FALHA teste32: resultado misto deveria preservar nome e adicionar procedimento_texto, dados=%', v_dados;
  end if;
  raise notice 'OK teste32: resultado misto aplica somente as alteracoes enviadas, preservando os demais campos';

  -- 33. rollback em falha (excecao antes de qualquer UPDATE) -----------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-b7', clinica_a, '5511900000001');

  select dados, atualizado_em into v_dados, v_atualizado_em from estado_conversa where id = conversa_a;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('campo_inexistente', jsonb_build_object('acao', 'informar', 'valor', 'x'))
    );
    raise exception 'FALHA teste33: campo nao permitido deveria ter lancado excecao';
  exception when raise_exception then
    raise notice 'OK teste33 (parte 1): campo nao permitido lanca excecao';
  end;
  select interpretacao_persistida_em into v_ts from mensagens_recebidas where id = v_msg_id;
  if v_ts is not null then
    raise exception 'FALHA teste33 (parte 2): marcador nao deveria ter sido preenchido apos excecao';
  end if;
  if (select dados from estado_conversa where id = conversa_a) <> v_dados then
    raise exception 'FALHA teste33 (parte 3): estado_conversa nao deveria ter sido alterado apos excecao';
  end if;
  raise notice 'OK teste33: excecao antes de qualquer UPDATE nao deixa rastro em estado_conversa nem no marcador (rollback integral e garantia do PostgreSQL para toda a funcao)';

  -- 34-35. dois message_id disputando o mesmo snapshot / mensagem posterior --
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-c1', clinica_a, '5511900000001');
  select atualizado_em into v_atualizado_em from estado_conversa where id = conversa_a;

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em2
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a, v_atualizado_em,
    jsonb_build_object('periodo', jsonb_build_object('acao', 'informar', 'valor', 'tarde'))
  );
  if v_conv_resultado <> 'persistida' then
    raise exception 'FALHA teste34 (parte 1): primeira mensagem sobre o snapshot deveria persistir';
  end if;

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-c2', clinica_a, '5511900000001');

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em2
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a, v_atualizado_em, -- mesmo snapshot ja obsoleto
    jsonb_build_object('periodo', jsonb_build_object('acao', 'informar', 'valor', 'manha'))
  );
  if v_conv_resultado <> 'conflito_concorrente' then
    raise exception 'FALHA teste34 (parte 2): segundo message_id sobre o mesmo snapshot obsoleto deveria retornar conflito_concorrente, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste34: dois message_id disputando o mesmo snapshot_atualizado_em -> somente um CAS vence';

  select atualizado_em into v_atualizado_em2 from estado_conversa where id = conversa_a;
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a, v_atualizado_em2, -- snapshot atualizado
    jsonb_build_object('periodo', jsonb_build_object('acao', 'informar', 'valor', 'manha'))
  );
  if v_conv_resultado <> 'persistida' then
    -- 'periodo' ja esta preenchido como 'tarde'; 'informar' com valor diferente
    -- preserva o acumulado (nao substitui silenciosamente) -- ainda assim
    -- 'persistida', pois o snapshot agora corresponde a versao real.
    raise exception 'FALHA teste35: mensagem posterior com snapshot atualizado deveria persistir, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste35: mensagem posterior com snapshot_atualizado_em correto persiste normalmente';

  -- 36. isolamento entre clinicas -------------------------------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-c3', clinica_a, '5511900000001');

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_b, -- conversa de outra clinica
    (select atualizado_em from estado_conversa where id = conversa_b),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'conflito_concorrente' then
    raise exception 'FALHA teste36: conversa de outra clinica deveria ser bloqueada pelo CAS (clinica_id divergente), foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste36: isolamento entre clinicas (conversa de clinica diferente da mensagem nunca e alterada)';

  -- 37. campos nao permitidos sao rejeitados ---------------------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-c4', clinica_a, '5511900000001');
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('paciente_id', jsonb_build_object('acao', 'informar', 'valor', 'x'))
    );
    raise exception 'FALHA teste37: campo fora do allowlist deveria ter sido rejeitado';
  exception when raise_exception then
    raise notice 'OK teste37: campo nao permitido e rejeitado (excecao controlada)';
  end;

  -- 38. estrutura invalida e rejeitada ---------------------------------------
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('nome', jsonb_build_object('acao', 'informar')) -- sem "valor"
    );
    raise exception 'FALHA teste38: estrutura invalida (valor ausente) deveria ter sido rejeitada';
  exception when raise_exception then
    raise notice 'OK teste38: estrutura invalida e rejeitada (excecao controlada)';
  end;

  -- 39. claim_token nulo nao bypassa autorizacao -----------------------------
  -- Comparacoes contra parametros do chamador usam "is distinct from", nao
  -- "<>": com "<>", um parametro nulo faz a condicao inteira do IF avaliar
  -- para NULL (nao TRUE), que o PL/pgSQL trata como falso -- ou seja, a
  -- rejeicao seria pulada e a funcao seguiria para o CAS/persistencia sem
  -- validar o token de fato. Este teste prova que isso NAO acontece.
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-d1', clinica_a, '5511900000001');

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', null, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'autorizacao_invalida' or v_conv_id is not null then
    raise exception 'FALHA teste39: claim_token nulo deveria retornar autorizacao_invalida sem estado, foi %', v_conv_resultado;
  end if;
  select interpretacao_persistida_em into v_ts from mensagens_recebidas where id = v_msg_id;
  if v_ts is not null then
    raise exception 'FALHA teste39: claim_token nulo nao deveria ter preenchido o marcador';
  end if;
  raise notice 'OK teste39: claim_token nulo -> autorizacao_invalida (nao bypassa a verificacao de token)';

  -- 40. snapshot_atualizado_em nulo nao bypassa o CAS -------------------------
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    null, -- snapshot nulo
    '{}'::jsonb
  );
  if v_conv_resultado <> 'conflito_concorrente' or v_conv_id is not null then
    raise exception 'FALHA teste40: snapshot_atualizado_em nulo deveria retornar conflito_concorrente sem estado, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste40: snapshot_atualizado_em nulo -> conflito_concorrente (nao bypassa o CAS)';

  raise notice 'TODOS OS TESTES DA ETAPA 7 PASSARAM (nao executados nesta rodada -- revisao estatica apenas)';

  -- limpeza -----------------------------------------------------------------
  delete from mensagens_recebidas where clinica_id in (clinica_a, clinica_b);
  delete from estado_conversa where clinica_id in (clinica_a, clinica_b);
  delete from pacientes where clinica_id in (clinica_a, clinica_b);
  delete from clinicas where id in (clinica_a, clinica_b);
end $$;
