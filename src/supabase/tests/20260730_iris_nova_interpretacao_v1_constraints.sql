-- Testes de 20260730_iris_nova_interpretacao_v1.sql
-- NAO EXECUTADO nesta rodada (Etapa 7): nenhuma migration foi aplicada em
-- banco real ou dev. Este arquivo fica versionado para revisao estatica e
-- para execucao futura, quando a migration for aplicada, seguindo o mesmo
-- padrao de 20260729_iris_nova_identificacao_v1_constraints.sql e
-- 20260729_iris_nova_identificacao_v1_correcao_constraints.sql: cria dados
-- sinteticos, remove tudo ao final, usa somente dados de teste (nunca dados
-- reais ou de outra clinica).
--
-- Revisao desta rodada (apos reprovacao estatica do Codex sobre bfe487f):
--   - teste12 (antigo teste8/9) documentado honestamente como sequencial,
--     nao como prova de concorrencia real -- ver "PROCEDIMENTO MANUAL DE
--     CONCORRENCIA REAL" no rodape deste arquivo;
--   - testes 23 e 28 adicionados para lease_expira_em NULL (reivindicacao e
--     persistencia), que nao existiam na rodada anterior;
--   - secao inteira de validacao JSONB canonica (testes 42-59) reescrita
--     para cobrir o conjunto EXATO de propriedades por acao, com testes
--     negativos e de regressao explicitos;
--   - testes que esperam excecao (42-54) reescritos com uma flag booleana
--     (v_excecao_ocorreu) e a asercao de "deveria ter lancado excecao" FORA
--     do bloco exception -- o padrao anterior (raise exception dentro do
--     proprio "exception when raise_exception then") se auto-capturava e
--     nunca podia falhar de fato, mesmo quando a RPC nao lancava nada;
--   - teste60 adicionado como prova real de rollback transacional (uma
--     chamada valida com efeito real seguida de uma chamada invalida no
--     MESMO savepoint desfaz tudo, incluindo a alteracao real da primeira
--     chamada) -- o teste anterior so provava que a validacao ocorre antes
--     de qualquer UPDATE NESTA chamada, o que e mais fraco.
--
-- Observacao sobre concorrencia real: este script roda em uma unica sessao
-- (um unico bloco `do $$ ... $$`, uma unica transacao). Ele nao pode
-- reproduzir duas sessoes verdadeiramente simultaneas disputando o mesmo
-- lock/insercao. Os testes sequenciais abaixo verificam o comportamento
-- correto de uma segunda tentativa encontrando a chave ja reivindicada — a
-- exclusao mutua real entre sessoes concorrentes decorre diretamente do
-- lock implicito do indice unico (na insercao inicial, via
-- INSERT ... ON CONFLICT DO NOTHING) e do `FOR UPDATE` (nas reivindicacoes
-- subsequentes), garantias do proprio PostgreSQL nao testadas aqui a nivel
-- de script de sessao unica. Ver "PROCEDIMENTO MANUAL DE CONCORRENCIA REAL"
-- no rodape para o roteiro de duas sessoes.
--
-- Cobertura (numeracao sequencial desta revisao):
--   1. tres colunas existem
--   2. colunas sao nullable
--   3. nenhuma coluna adicional criada
--   4. PUBLIC sem EXECUTE
--   5. anon sem EXECUTE
--   6. authenticated sem EXECUTE
--   7. service_role com EXECUTE
--   8. linha inexistente e reivindicada (vence o INSERT ... ON CONFLICT DO NOTHING) -> reivindicada_interpretar
--   9. status apos reivindicacao de linha inexistente e processando
--  10. token gerado no servidor
--  11. lease de aproximadamente 60 segundos
--  12. linha real com status_processamento = 'recebida' (inserida diretamente, nao via RPC) transiciona para processando -> reivindicada_interpretar
--  13. segunda tentativa SEQUENCIAL sobre a mesma chave encontra a linha ja reivindicada (nao e prova de concorrencia real)
--  14. processando vigente -> nao_elegivel
--  15. processando expirado com marcador null -> reivindicada_interpretar (token renovado)
--  16. processando expirado com marcador preenchido -> reivindicada_resposta_fixa (marcador preservado)
--  17. concluida -> nao_elegivel
--  18. falhou -> nao_elegivel
--  19. clinica incompativel -> nao_elegivel
--  20. telefone incompativel -> nao_elegivel
--  21. incompatibilidade nao altera a linha
--  22. lease igual a transaction_timestamp() e tratado como expirado
--  23. processando com lease_expira_em NULL -> nao_elegivel (nao reivindica, nao renova token, nao altera a linha)
--  24. persistencia valida altera estado e marcador
--  25. CAS invalido (snapshot obsoleto) -> conflito_concorrente
--  26. token invalido -> autorizacao_invalida
--  27. lease expirada -> autorizacao_invalida
--  28. lease_expira_em NULL na persistencia -> autorizacao_invalida
--  29. marcador ja preenchido -> autorizacao_invalida
--  30. clinica incompativel na persistencia -> autorizacao_invalida
--  31. telefone incompativel na persistencia -> autorizacao_invalida
--  32. claim_token nulo nao bypassa autorizacao (is distinct from, nao <>)
--  33. snapshot_atualizado_em nulo nao bypassa o CAS (is distinct from, nao <>)
--  34. saida vazia preenche marcador
--  35. idempotencia preserva atualizado_em
--  36. somente conflitos (alteracoes_aplicaveis vazio) equivale a saida vazia
--  37. resultado misto aplica somente alteracoes enviadas
--  38. isolamento entre clinicas
--  39. dois message_id disputando o mesmo snapshot -> um CAS vence, outro conflito_concorrente
--  40. mensagem posterior com snapshot atualizado persiste normalmente
--  41. campo desconhecido e rejeitado, sem alterar estado_conversa nem o marcador
--  42. estrutura de alteracao invalida (valor escalar, nao objeto) e rejeitada
--  43. acao desconhecida e rejeitada
--  44. acao ausente (sem a chave 'acao') e rejeitada
--  45. remover com propriedade valor presente e rejeitado
--  46. remover com propriedade valor null e rejeitado
--  47. informar com propriedade extra alem de acao/valor e rejeitado
--  48. informar sem a propriedade valor e rejeitado
--  49. valor nao-string e rejeitado
--  50. valor string vazia e rejeitado
--  51. valor string somente espacos e rejeitado
--  52. periodo invalido e rejeitado
--  53. intencao invalida e rejeitada
--  54. campo desconhecido junto de outro campo valido invalida a chamada inteira, sem aplicacao parcial do campo valido
--  55. informar valido e aplicado
--  56. corrigir valido e aplicado
--  57. remover valido e aplicado
--  58. periodo valido e aplicado
--  59. intencao valida e aplicada
--  60. PROVA REAL de rollback transacional: chamada valida com efeito real seguida de chamada invalida no mesmo savepoint desfaz tudo

do $$
declare
  clinica_a uuid;
  clinica_b uuid;
  conversa_a uuid;
  conversa_b uuid;
  v_count integer;
  v_bool boolean;
  v_ts timestamptz;
  v_excecao_ocorreu boolean;

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

  v_msg_recebida_id uuid;
  v_claim_pre uuid;
  v_lease_pre timestamptz;
  v_check_claim_token uuid;

  v_msg_e1_id uuid;
  v_claim_e1 uuid;
  v_msg_e2_id uuid;
  v_claim_e2 uuid;
  v_dados_antes_savepoint jsonb;
  v_atualizado_em_antes_savepoint timestamptz;
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

  -- 8-9. linha inexistente vence o INSERT ... ON CONFLICT DO NOTHING --------
  select * into v_resultado, v_msg_id, v_claim, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000001');
  if v_resultado <> 'reivindicada_interpretar' or v_msg_id is null or v_claim is null then
    raise exception 'FALHA teste8: linha inexistente nao foi reivindicada corretamente (resultado=%)', v_resultado;
  end if;
  raise notice 'OK teste8: linha inexistente e reivindicada via INSERT ... ON CONFLICT DO NOTHING (reivindicada_interpretar)';

  select status_processamento into v_resultado from mensagens_recebidas where id = v_msg_id;
  if v_resultado <> 'processando' then
    raise exception 'FALHA teste9: status apos reivindicacao deveria ser processando, e %', v_resultado;
  end if;
  raise notice 'OK teste9: status apos reivindicacao de linha inexistente e processando';

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

  -- 12. linha real 'recebida' (inserida diretamente, nao via RPC) transiciona
  --     para processando -- nao contar a insercao de linha inexistente
  --     (testes 8-11) como teste de 'recebida': aqui a linha nasce
  --     explicitamente com status_processamento = 'recebida' e sem
  --     claim_token/lease, como um processo externo de ingestao faria antes
  --     de qualquer worker reivindicar a mensagem.
  insert into mensagens_recebidas (provider, instancia_whatsapp, message_id, clinica_id, telefone_normalizado, status_processamento)
  values ('evolution', 'interp-clinica-a', 'msg-recebida-real', clinica_a, '5511900000001', 'recebida')
  returning id into v_msg_recebida_id;

  select claim_token, lease_expira_em into v_claim_pre, v_lease_pre from mensagens_recebidas where id = v_msg_recebida_id;
  if v_claim_pre is not null or v_lease_pre is not null then
    raise exception 'FALHA teste12: linha recebida real deveria nascer sem claim_token nem lease_expira_em';
  end if;

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-recebida-real', clinica_a, '5511900000001');
  if v_resultado <> 'reivindicada_interpretar' or v_msg_id <> v_msg_recebida_id or v_claim2 is null or v_lease is null then
    raise exception 'FALHA teste12: linha recebida real nao transicionou corretamente (resultado=%)', v_resultado;
  end if;
  select status_processamento into v_resultado from mensagens_recebidas where id = v_msg_recebida_id;
  if v_resultado <> 'processando' then
    raise exception 'FALHA teste12: linha recebida real deveria estar processando apos a reivindicacao, esta %', v_resultado;
  end if;
  raise notice 'OK teste12: linha real com status_processamento = recebida transiciona para processando (token e lease gerados, reivindicada_interpretar)';

  -- 13. segunda tentativa SEQUENCIAL sobre a mesma chave (nao prova concorrencia real) --
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a2', clinica_a, '5511900000001');
  if v_resultado <> 'reivindicada_interpretar' then
    raise exception 'FALHA teste13 (parte 1): primeira reivindicacao deveria vencer';
  end if;
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a2', clinica_a, '5511900000001');
  if v_resultado <> 'nao_elegivel' then
    raise exception 'FALHA teste13 (parte 2): segunda tentativa sobre a mesma chave deveria ser nao_elegivel (lease vigente), foi %', v_resultado;
  end if;
  raise notice 'OK teste13: segunda tentativa sequencial sobre a mesma chave encontra a linha ja reivindicada (nao e prova de concorrencia real -- ver PROCEDIMENTO MANUAL no rodape)';

  -- 14. processando vigente -> nao_elegivel --------------------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000001');
  if v_resultado <> 'nao_elegivel' or v_claim2 is not null then
    raise exception 'FALHA teste14: processando com lease vigente deveria ser nao_elegivel sem token, foi % (token=%)', v_resultado, v_claim2;
  end if;
  raise notice 'OK teste14: processando com lease vigente -> nao_elegivel, sem token';

  -- 15. processando expirado com marcador null -> reivindicada_interpretar --
  update mensagens_recebidas set lease_expira_em = transaction_timestamp() - interval '1 second'
  where provider = 'evolution' and instancia_whatsapp = 'interp-clinica-a' and message_id = 'msg-a1';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000001');
  if v_resultado <> 'reivindicada_interpretar' or v_claim2 is null or v_claim2 = v_claim then
    raise exception 'FALHA teste15: reclaim com marcador null deveria retornar reivindicada_interpretar com novo token, foi %', v_resultado;
  end if;
  raise notice 'OK teste15: processando expirado com marcador null -> reivindicada_interpretar (token renovado)';

  -- 16. processando expirado com marcador preenchido -> reivindicada_resposta_fixa --
  update mensagens_recebidas
     set interpretacao_persistida_em = transaction_timestamp(),
         lease_expira_em = transaction_timestamp() - interval '1 second'
   where provider = 'evolution' and instancia_whatsapp = 'interp-clinica-a' and message_id = 'msg-a1';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000001');
  if v_resultado <> 'reivindicada_resposta_fixa' or v_marcador is null then
    raise exception 'FALHA teste16: reclaim com marcador preenchido deveria retornar reivindicada_resposta_fixa preservando o marcador, foi %', v_resultado;
  end if;
  raise notice 'OK teste16: processando expirado com marcador preenchido -> reivindicada_resposta_fixa (marcador preservado)';

  -- 17. concluida -> nao_elegivel -------------------------------------------
  update mensagens_recebidas set status_processamento = 'concluida', concluido_em = transaction_timestamp()
  where provider = 'evolution' and instancia_whatsapp = 'interp-clinica-a' and message_id = 'msg-a1';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000001');
  if v_resultado <> 'nao_elegivel' then
    raise exception 'FALHA teste17: concluida deveria ser nao_elegivel, foi %', v_resultado;
  end if;
  raise notice 'OK teste17: concluida -> nao_elegivel';

  -- 18. falhou -> nao_elegivel -----------------------------------------------
  insert into mensagens_recebidas (provider, instancia_whatsapp, message_id, clinica_id, telefone_normalizado, status_processamento, concluido_em)
  values ('evolution', 'interp-clinica-a', 'msg-a3', clinica_a, '5511900000001', 'falhou', transaction_timestamp());

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a3', clinica_a, '5511900000001');
  if v_resultado <> 'nao_elegivel' then
    raise exception 'FALHA teste18: falhou deveria ser nao_elegivel, foi %', v_resultado;
  end if;
  raise notice 'OK teste18: falhou -> nao_elegivel';

  -- 19-21. incompatibilidade de clinica/telefone --------------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_b, '5511900000001');
  if v_resultado <> 'nao_elegivel' or v_claim2 is not null then
    raise exception 'FALHA teste19: clinica incompativel deveria ser nao_elegivel sem token, foi %', v_resultado;
  end if;
  raise notice 'OK teste19: clinica incompativel -> nao_elegivel';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000099');
  if v_resultado <> 'nao_elegivel' or v_claim2 is not null then
    raise exception 'FALHA teste20: telefone incompativel deveria ser nao_elegivel sem token, foi %', v_resultado;
  end if;
  raise notice 'OK teste20: telefone incompativel -> nao_elegivel';

  select m.clinica_id, m.telefone_normalizado into v_check_clinica, v_check_telefone
  from mensagens_recebidas m
  where m.provider = 'evolution' and m.instancia_whatsapp = 'interp-clinica-a' and m.message_id = 'msg-a1';
  if v_check_clinica <> clinica_a or v_check_telefone <> '5511900000001' then
    raise exception 'FALHA teste21: incompatibilidade alterou clinica_id ou telefone_normalizado armazenados (clinica=%, telefone=%)', v_check_clinica, v_check_telefone;
  end if;
  raise notice 'OK teste21: incompatibilidade nao altera a linha (clinica_id/telefone_normalizado armazenados permanecem os originais)';

  -- 22. lease igual a transaction_timestamp() e expirado --------------------
  v_ts := transaction_timestamp();
  update mensagens_recebidas set lease_expira_em = v_ts, interpretacao_persistida_em = null, status_processamento = 'processando'
  where provider = 'evolution' and instancia_whatsapp = 'interp-clinica-a' and message_id = 'msg-a1';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000001');
  if v_resultado <> 'reivindicada_interpretar' then
    raise exception 'FALHA teste22: lease_expira_em igual a transaction_timestamp() deveria contar como expirado, resultado foi %', v_resultado;
  end if;
  raise notice 'OK teste22: lease_expira_em = transaction_timestamp() e tratado como expirado';

  -- 23. processando com lease_expira_em NULL -> nao_elegivel ----------------
  -- Simula uma linha processando sem lease preenchida (nao ocorre pelo fluxo
  -- normal desta RPC, que sempre grava claim_token+lease juntos, mas
  -- tratada explicitamente: nunca reivindicar, nunca renovar token, nunca
  -- alterar a linha quando nao ha lease para avaliar expiracao).
  update mensagens_recebidas set lease_expira_em = null, interpretacao_persistida_em = null, status_processamento = 'processando', claim_token = v_claim
  where provider = 'evolution' and instancia_whatsapp = 'interp-clinica-a' and message_id = 'msg-a1';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-a1', clinica_a, '5511900000001');
  if v_resultado <> 'nao_elegivel' or v_claim2 is not null then
    raise exception 'FALHA teste23: processando com lease_expira_em NULL deveria ser nao_elegivel sem token, foi % (token=%)', v_resultado, v_claim2;
  end if;
  select claim_token into v_check_claim_token from mensagens_recebidas where provider = 'evolution' and instancia_whatsapp = 'interp-clinica-a' and message_id = 'msg-a1';
  if v_check_claim_token <> v_claim then
    raise exception 'FALHA teste23: processando com lease_expira_em NULL nao deveria ter o claim_token substituido';
  end if;
  raise notice 'OK teste23: processando com lease_expira_em NULL -> nao_elegivel, sem reivindicar, sem renovar token, sem alterar a linha';

  -- 24. persistencia valida altera estado e marcador -----------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-b1', clinica_a, '5511900000001');

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    jsonb_build_object('nome', jsonb_build_object('acao', 'informar', 'valor', 'Maria'))
  );
  if v_conv_resultado <> 'persistida' or (v_dados->>'nome') <> 'Maria' then
    raise exception 'FALHA teste24: persistencia valida deveria retornar persistida com dados atualizados, foi % (dados=%)', v_conv_resultado, v_dados;
  end if;
  select interpretacao_persistida_em into v_ts from mensagens_recebidas where id = v_msg_id;
  if v_ts is null then
    raise exception 'FALHA teste24: marcador nao foi preenchido apos persistencia valida';
  end if;
  raise notice 'OK teste24: persistencia valida altera estado_conversa.dados e preenche o marcador';

  -- 25. CAS invalido -> conflito_concorrente -------------------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-b2', clinica_a, '5511900000001');

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    '2000-01-01T00:00:00Z'::timestamptz, -- snapshot deliberadamente obsoleto
    jsonb_build_object('nome', jsonb_build_object('acao', 'corrigir', 'valor', 'Outro'))
  );
  if v_conv_resultado <> 'conflito_concorrente' or v_conv_id is not null or v_dados is not null then
    raise exception 'FALHA teste25: snapshot obsoleto deveria retornar conflito_concorrente sem estado, foi %', v_conv_resultado;
  end if;
  select (dados->>'nome') into v_resultado from estado_conversa where id = conversa_a;
  if v_resultado <> 'Maria' then
    raise exception 'FALHA teste25: CAS invalido nao deveria ter alterado estado_conversa.dados, mas alterou para %', v_resultado;
  end if;
  raise notice 'OK teste25: CAS invalido -> conflito_concorrente, sem alteracao em estado_conversa';

  -- 26. token invalido -> autorizacao_invalida -----------------------------
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', gen_random_uuid(), conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'autorizacao_invalida' then
    raise exception 'FALHA teste26: claim_token invalido deveria retornar autorizacao_invalida, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste26: claim_token invalido -> autorizacao_invalida';

  -- 27. lease expirado -> autorizacao_invalida -----------------------------
  update mensagens_recebidas set lease_expira_em = transaction_timestamp() - interval '1 second' where id = v_msg_id;
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'autorizacao_invalida' then
    raise exception 'FALHA teste27: lease expirado deveria retornar autorizacao_invalida, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste27: lease expirado -> autorizacao_invalida';

  -- 28. lease_expira_em NULL na persistencia -> autorizacao_invalida --------
  update mensagens_recebidas set lease_expira_em = null where id = v_msg_id;
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'autorizacao_invalida' then
    raise exception 'FALHA teste28: lease_expira_em NULL deveria retornar autorizacao_invalida, foi %', v_conv_resultado;
  end if;
  if (select dados from estado_conversa where id = conversa_a) is distinct from jsonb_build_object('nome', 'Maria') then
    raise exception 'FALHA teste28: lease_expira_em NULL nao deveria ter permitido alteracao em estado_conversa';
  end if;
  raise notice 'OK teste28: lease_expira_em NULL na persistencia -> autorizacao_invalida, sem alterar estado_conversa';
  update mensagens_recebidas set lease_expira_em = transaction_timestamp() + interval '60 seconds' where id = v_msg_id;

  -- 29. marcador preenchido -> autorizacao_invalida ------------------------
  update mensagens_recebidas set interpretacao_persistida_em = transaction_timestamp() where id = v_msg_id;
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'autorizacao_invalida' then
    raise exception 'FALHA teste29: marcador ja preenchido deveria retornar autorizacao_invalida, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste29: marcador ja preenchido -> autorizacao_invalida';

  -- 30-31. clinica/telefone incompativel na persistencia -------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-b3', clinica_a, '5511900000001');

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_b, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'autorizacao_invalida' then
    raise exception 'FALHA teste30: clinica incompativel na persistencia deveria retornar autorizacao_invalida, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste30: clinica incompativel -> autorizacao_invalida';

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000099', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'autorizacao_invalida' then
    raise exception 'FALHA teste31: telefone incompativel na persistencia deveria retornar autorizacao_invalida, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste31: telefone incompativel -> autorizacao_invalida';

  -- 32. claim_token nulo nao bypassa autorizacao -----------------------------
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', null, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'autorizacao_invalida' or v_conv_id is not null then
    raise exception 'FALHA teste32: claim_token nulo deveria retornar autorizacao_invalida sem estado, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste32: claim_token nulo -> autorizacao_invalida (nao bypassa a verificacao de token)';

  -- 33. snapshot_atualizado_em nulo nao bypassa o CAS -------------------------
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    null, -- snapshot nulo
    '{}'::jsonb
  );
  if v_conv_resultado <> 'conflito_concorrente' or v_conv_id is not null then
    raise exception 'FALHA teste33: snapshot_atualizado_em nulo deveria retornar conflito_concorrente sem estado, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste33: snapshot_atualizado_em nulo -> conflito_concorrente (nao bypassa o CAS)';

  -- 34. saida vazia preenche marcador ---------------------------------------
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'persistida' then
    raise exception 'FALHA teste34: saida vazia deveria retornar persistida, foi %', v_conv_resultado;
  end if;
  select interpretacao_persistida_em into v_ts from mensagens_recebidas where id = v_msg_id;
  if v_ts is null then
    raise exception 'FALHA teste34: marcador nao foi preenchido para saida vazia';
  end if;
  raise notice 'OK teste34: saida vazia -> persistida, marcador preenchido';

  -- 35. idempotencia preserva atualizado_em ---------------------------------
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
    raise exception 'FALHA teste35: informar valor identico deveria ser idempotente e preservar atualizado_em (esperado=%, obtido=%)', v_atualizado_em, v_atualizado_em2;
  end if;
  raise notice 'OK teste35: idempotencia preserva atualizado_em';

  -- 36. somente conflitos equivale a alteracoes vazias ----------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-b5', clinica_a, '5511900000001');

  select atualizado_em into v_atualizado_em from estado_conversa where id = conversa_a;
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em2
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a, v_atualizado_em, '{}'::jsonb
  );
  if v_conv_resultado <> 'persistida' or v_atualizado_em2 <> v_atualizado_em then
    raise exception 'FALHA teste36: alteracoes_aplicaveis vazias (somente conflitos do lado do Core) deveria se comportar como saida vazia';
  end if;
  raise notice 'OK teste36: somente conflitos (alteracoes_aplicaveis vazias) equivale a saida vazia';

  -- 37. resultado misto aplica somente alteracoes enviadas -------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-b6', clinica_a, '5511900000001');

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    jsonb_build_object('procedimento_texto', jsonb_build_object('acao', 'informar', 'valor', 'limpeza'))
  );
  if v_conv_resultado <> 'persistida' or (v_dados->>'nome') <> 'Maria' or (v_dados->>'procedimento_texto') <> 'limpeza' then
    raise exception 'FALHA teste37: resultado misto deveria preservar nome e adicionar procedimento_texto, dados=%', v_dados;
  end if;
  raise notice 'OK teste37: resultado misto aplica somente as alteracoes enviadas, preservando os demais campos';

  -- 38. isolamento entre clinicas -------------------------------------------
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-c3', clinica_a, '5511900000001');

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_b, -- conversa de outra clinica
    (select atualizado_em from estado_conversa where id = conversa_b),
    '{}'::jsonb
  );
  if v_conv_resultado <> 'conflito_concorrente' then
    raise exception 'FALHA teste38: conversa de outra clinica deveria ser bloqueada pelo CAS (clinica_id divergente), foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste38: isolamento entre clinicas (conversa de clinica diferente da mensagem nunca e alterada)';

  -- 39-40. dois message_id disputando o mesmo snapshot / mensagem posterior --
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-c1', clinica_a, '5511900000001');
  select atualizado_em into v_atualizado_em from estado_conversa where id = conversa_a;

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em2
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a, v_atualizado_em,
    jsonb_build_object('periodo', jsonb_build_object('acao', 'informar', 'valor', 'tarde'))
  );
  if v_conv_resultado <> 'persistida' then
    raise exception 'FALHA teste39 (parte 1): primeira mensagem sobre o snapshot deveria persistir';
  end if;

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-c2', clinica_a, '5511900000001');

  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em2
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a, v_atualizado_em, -- mesmo snapshot ja obsoleto
    jsonb_build_object('periodo', jsonb_build_object('acao', 'informar', 'valor', 'manha'))
  );
  if v_conv_resultado <> 'conflito_concorrente' then
    raise exception 'FALHA teste39 (parte 2): segundo message_id sobre o mesmo snapshot obsoleto deveria retornar conflito_concorrente, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste39: dois message_id disputando o mesmo snapshot_atualizado_em -> somente um CAS vence';

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
    raise exception 'FALHA teste40: mensagem posterior com snapshot atualizado deveria persistir, foi %', v_conv_resultado;
  end if;
  raise notice 'OK teste40: mensagem posterior com snapshot_atualizado_em correto persiste normalmente';

  -- ==========================================================================
  -- 41-59. validacao JSONB canonica de alteracoes_aplicaveis (conjunto EXATO
  --        de propriedades por acao, identico ao contrato TypeScript em
  --        interpretacao-extrator.ts / validarSaidaInterpretacao). Cada
  --        teste que espera excecao usa uma flag booleana (v_excecao_ocorreu)
  --        com a asercao de falha FORA do bloco exception -- nunca dentro,
  --        para nao se auto-capturar.
  -- ==========================================================================

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-val-neg', clinica_a, '5511900000001');

  -- 41. campo desconhecido e rejeitado, sem alterar estado_conversa nem o marcador --
  select dados into v_dados from estado_conversa where id = conversa_a;
  v_excecao_ocorreu := false;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('campo_inexistente', jsonb_build_object('acao', 'informar', 'valor', 'x'))
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;
  if not v_excecao_ocorreu then
    raise exception 'FALHA teste41: campo fora do allowlist deveria ter lancado excecao';
  end if;
  if (select interpretacao_persistida_em from mensagens_recebidas where id = v_msg_id) is not null then
    raise exception 'FALHA teste41: marcador nao deveria ter sido preenchido apos excecao';
  end if;
  if (select dados from estado_conversa where id = conversa_a) is distinct from v_dados then
    raise exception 'FALHA teste41: estado_conversa nao deveria ter sido alterado apos excecao (validacao ocorre antes de qualquer UPDATE nesta chamada)';
  end if;
  raise notice 'OK teste41: campo desconhecido e rejeitado, sem alterar estado_conversa nem o marcador';

  -- 42. estrutura de alteracao invalida (valor escalar, nao objeto) e rejeitada --
  v_excecao_ocorreu := false;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('nome', 'Joao') -- valor da alteracao e uma string, nao um objeto
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;
  if not v_excecao_ocorreu then
    raise exception 'FALHA teste42: alteracao com valor escalar (nao objeto) deveria ter lancado excecao';
  end if;
  raise notice 'OK teste42: estrutura de alteracao invalida (nao objeto) e rejeitada';

  -- 43. acao desconhecida e rejeitada --
  v_excecao_ocorreu := false;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('nome', jsonb_build_object('acao', 'apagar_tudo', 'valor', 'x'))
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;
  if not v_excecao_ocorreu then
    raise exception 'FALHA teste43: acao desconhecida deveria ter lancado excecao';
  end if;
  raise notice 'OK teste43: acao desconhecida e rejeitada';

  -- 44. acao ausente (sem a chave 'acao') e rejeitada -- prova da correcao de
  --     NULL-safety: antes desta rodada, "v_acao not in (...)" com v_acao
  --     NULL avaliava para NULL (nao TRUE) e a alteracao escapava como se
  --     fosse 'informar'.
  v_excecao_ocorreu := false;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('nome', jsonb_build_object('valor', 'Joao')) -- sem 'acao'
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;
  if not v_excecao_ocorreu then
    raise exception 'FALHA teste44: alteracao sem a chave acao deveria ter lancado excecao (bypass de NULL-safety)';
  end if;
  raise notice 'OK teste44: acao ausente (sem a chave acao) e rejeitada';

  -- 45. remover com propriedade valor presente e rejeitado --
  v_excecao_ocorreu := false;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('cpf', jsonb_build_object('acao', 'remover', 'valor', 'x'))
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;
  if not v_excecao_ocorreu then
    raise exception 'FALHA teste45: remover com valor presente deveria ter lancado excecao';
  end if;
  raise notice 'OK teste45: remover com propriedade valor presente e rejeitado';

  -- 46. remover com propriedade valor null e rejeitado --
  v_excecao_ocorreu := false;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('cpf', jsonb_build_object('acao', 'remover', 'valor', null))
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;
  if not v_excecao_ocorreu then
    raise exception 'FALHA teste46: remover com valor null deveria ter lancado excecao';
  end if;
  raise notice 'OK teste46: remover com propriedade valor null e rejeitado';

  -- 47. informar com propriedade extra alem de acao/valor e rejeitado --
  v_excecao_ocorreu := false;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('nome', jsonb_build_object('acao', 'informar', 'valor', 'Joao', 'extra', 'y'))
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;
  if not v_excecao_ocorreu then
    raise exception 'FALHA teste47: propriedade extra alem de acao/valor deveria ter lancado excecao';
  end if;
  raise notice 'OK teste47: informar com propriedade extra alem de acao/valor e rejeitado';

  -- 48. informar sem a propriedade valor e rejeitado --
  v_excecao_ocorreu := false;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('nome', jsonb_build_object('acao', 'informar'))
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;
  if not v_excecao_ocorreu then
    raise exception 'FALHA teste48: informar sem a propriedade valor deveria ter lancado excecao';
  end if;
  raise notice 'OK teste48: informar sem a propriedade valor e rejeitado';

  -- 49. valor nao-string e rejeitado --
  v_excecao_ocorreu := false;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('nome', jsonb_build_object('acao', 'informar', 'valor', 42))
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;
  if not v_excecao_ocorreu then
    raise exception 'FALHA teste49: valor numerico (nao string) deveria ter lancado excecao';
  end if;
  raise notice 'OK teste49: valor nao-string e rejeitado';

  -- 50. valor string vazia e rejeitado --
  v_excecao_ocorreu := false;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('nome', jsonb_build_object('acao', 'informar', 'valor', ''))
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;
  if not v_excecao_ocorreu then
    raise exception 'FALHA teste50: valor string vazia deveria ter lancado excecao';
  end if;
  raise notice 'OK teste50: valor string vazia e rejeitado';

  -- 51. valor string somente espacos e rejeitado (btrim) --
  v_excecao_ocorreu := false;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('nome', jsonb_build_object('acao', 'informar', 'valor', '   '))
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;
  if not v_excecao_ocorreu then
    raise exception 'FALHA teste51: valor string somente espacos deveria ter lancado excecao (btrim)';
  end if;
  raise notice 'OK teste51: valor string somente espacos e rejeitado';

  -- 52. periodo invalido e rejeitado --
  v_excecao_ocorreu := false;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('periodo', jsonb_build_object('acao', 'informar', 'valor', 'madrugada'))
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;
  if not v_excecao_ocorreu then
    raise exception 'FALHA teste52: periodo fora do dominio deveria ter lancado excecao';
  end if;
  raise notice 'OK teste52: periodo invalido e rejeitado';

  -- 53. intencao invalida e rejeitada --
  v_excecao_ocorreu := false;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('intencao', jsonb_build_object('acao', 'informar', 'valor', 'cancelamento'))
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;
  if not v_excecao_ocorreu then
    raise exception 'FALHA teste53: intencao fora do dominio (unico valor aprovado e novo_agendamento) deveria ter lancado excecao';
  end if;
  raise notice 'OK teste53: intencao invalida e rejeitada';

  -- 54. campo desconhecido dentro de um objeto com varios campos, um deles
  --     valido, ainda assim rejeita a chamada inteira (nenhuma aceitacao
  --     parcial) -- usa 'corrigir' (que sempre sobrescreve, mesmo campo
  --     ausente) sobre um campo nunca antes tocado em conversa_a, para que a
  --     asercao abaixo realmente prove ausencia de aplicacao parcial (um
  --     'informar' sobre um campo ja existente nao mudaria de qualquer
  --     forma, o que tornaria a checagem inconclusiva).
  v_excecao_ocorreu := false;
  begin
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object(
        'dentista_texto', jsonb_build_object('acao', 'corrigir', 'valor', 'Dr. Teste54'),
        'paciente_id', jsonb_build_object('acao', 'informar', 'valor', 'x')
      )
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;
  if not v_excecao_ocorreu then
    raise exception 'FALHA teste54: campo fora do allowlist deveria invalidar a chamada inteira, mesmo com outro campo valido presente';
  end if;
  if (select dados->>'dentista_texto' from estado_conversa where id = conversa_a) is not distinct from 'Dr. Teste54' then
    raise exception 'FALHA teste54: campo valido nao deveria ter sido aplicado parcialmente';
  end if;
  raise notice 'OK teste54: campo desconhecido invalida a chamada inteira, sem aceitacao parcial do campo valido';

  -- 55-59. regressoes validas (informar, corrigir, remover, periodo, intencao) --
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-val-pos-1', clinica_a, '5511900000001');
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    jsonb_build_object('dentista_texto', jsonb_build_object('acao', 'informar', 'valor', 'Dr. Fulano'))
  );
  if v_conv_resultado <> 'persistida' or (v_dados->>'dentista_texto') <> 'Dr. Fulano' then
    raise exception 'FALHA teste55: informar valido deveria persistir o valor, resultado=% dados=%', v_conv_resultado, v_dados;
  end if;
  raise notice 'OK teste55: informar valido e aplicado';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-val-pos-2', clinica_a, '5511900000001');
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    jsonb_build_object('dentista_texto', jsonb_build_object('acao', 'corrigir', 'valor', 'Dr. Beltrano'))
  );
  if v_conv_resultado <> 'persistida' or (v_dados->>'dentista_texto') <> 'Dr. Beltrano' then
    raise exception 'FALHA teste56: corrigir valido deveria substituir o valor, resultado=% dados=%', v_conv_resultado, v_dados;
  end if;
  raise notice 'OK teste56: corrigir valido e aplicado';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-val-pos-3', clinica_a, '5511900000001');
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    jsonb_build_object('dentista_texto', jsonb_build_object('acao', 'remover'))
  );
  if v_conv_resultado <> 'persistida' or (v_dados ? 'dentista_texto') then
    raise exception 'FALHA teste57: remover valido deveria eliminar o campo, resultado=% dados=%', v_conv_resultado, v_dados;
  end if;
  raise notice 'OK teste57: remover valido e aplicado';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-val-pos-4', clinica_a, '5511900000001');
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    jsonb_build_object('horario_texto', jsonb_build_object('acao', 'informar', 'valor', 'as 15h'))
  );
  if v_conv_resultado <> 'persistida' then
    raise exception 'FALHA teste58 (setup): falha ao preparar teste de periodo valido, resultado=%', v_conv_resultado;
  end if;
  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-val-pos-5', clinica_a, '5511900000001');
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    jsonb_build_object('periodo', jsonb_build_object('acao', 'corrigir', 'valor', 'noite'))
  );
  if v_conv_resultado <> 'persistida' or (v_dados->>'periodo') <> 'noite' then
    raise exception 'FALHA teste58: periodo valido (noite) deveria persistir, resultado=% dados=%', v_conv_resultado, v_dados;
  end if;
  raise notice 'OK teste58: periodo valido e aplicado';

  select * into v_resultado, v_msg_id, v_claim2, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-val-pos-6', clinica_a, '5511900000001');
  select * into v_conv_resultado, v_conv_id, v_dados, v_atualizado_em
  from public.aplicar_interpretacao_condicional(
    v_msg_id, clinica_a, '5511900000001', v_claim2, conversa_a,
    (select atualizado_em from estado_conversa where id = conversa_a),
    jsonb_build_object('intencao', jsonb_build_object('acao', 'informar', 'valor', 'novo_agendamento'))
  );
  if v_conv_resultado <> 'persistida' or (v_dados->>'intencao') <> 'novo_agendamento' then
    raise exception 'FALHA teste59: intencao valida (novo_agendamento) deveria persistir, resultado=% dados=%', v_conv_resultado, v_dados;
  end if;
  raise notice 'OK teste59: intencao valida e aplicada';

  -- ==========================================================================
  -- 60. PROVA REAL de rollback transacional: uma chamada valida com efeito
  --     real (UPDATE em estado_conversa + preenchimento do marcador) seguida,
  --     no MESMO bloco/savepoint, de uma chamada invalida que lanca
  --     excecao -- prova que a alteracao REAL da primeira chamada tambem e
  --     desfeita quando uma falha ocorre depois dela na mesma transacao.
  --     Diferente do teste41 (que so mostra que a validacao ocorre ANTES de
  --     qualquer UPDATE em uma unica chamada), este teste usa duas chamadas
  --     separadas dentro do mesmo savepoint, garantindo que uma escrita
  --     genuinamente ja aconteceu antes da falha.
  -- ==========================================================================
  select * into v_resultado, v_msg_e1_id, v_claim_e1, v_lease, v_marcador
  from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-e1', clinica_a, '5511900000001');

  select dados, atualizado_em into v_dados_antes_savepoint, v_atualizado_em_antes_savepoint
  from estado_conversa where id = conversa_a;

  v_excecao_ocorreu := false;
  begin
    -- chamada 1: valida, com efeito real -- altera estado_conversa.dados e
    -- preenche o marcador de msg-e1 de verdade, dentro deste savepoint.
    perform * from public.aplicar_interpretacao_condicional(
      v_msg_e1_id, clinica_a, '5511900000001', v_claim_e1, conversa_a,
      v_atualizado_em_antes_savepoint,
      jsonb_build_object('email', jsonb_build_object('acao', 'informar', 'valor', 'teste@example.com'))
    );

    -- chamada 2, na MESMA transacao/savepoint: reivindica outra mensagem e
    -- tenta aplicar um campo invalido -- deve lancar excecao DEPOIS que a
    -- chamada 1 ja tinha alterado estado_conversa.dados de verdade.
    select * into v_resultado, v_msg_e2_id, v_claim_e2, v_lease, v_marcador
    from public.reivindicar_mensagem('evolution', 'interp-clinica-a', 'msg-e2', clinica_a, '5511900000001');

    perform * from public.aplicar_interpretacao_condicional(
      v_msg_e2_id, clinica_a, '5511900000001', v_claim_e2, conversa_a,
      (select atualizado_em from estado_conversa where id = conversa_a),
      jsonb_build_object('campo_inexistente', jsonb_build_object('acao', 'informar', 'valor', 'x'))
    );
  exception when raise_exception then
    v_excecao_ocorreu := true;
  end;

  if not v_excecao_ocorreu then
    raise exception 'FALHA teste60: a segunda chamada (campo invalido) deveria ter lancado excecao';
  end if;

  -- o savepoint inteiro (chamada 1 + chamada 2) foi desfeito: nenhuma
  -- alteracao parcial em estado_conversa, marcador de msg-e1 nao
  -- preenchido, dados e atualizado_em exatamente como antes.
  if (select dados from estado_conversa where id = conversa_a) is distinct from v_dados_antes_savepoint then
    raise exception 'FALHA teste60: estado_conversa.dados deveria ter sido revertido para o valor anterior ao savepoint';
  end if;
  if (select atualizado_em from estado_conversa where id = conversa_a) <> v_atualizado_em_antes_savepoint then
    raise exception 'FALHA teste60: estado_conversa.atualizado_em deveria ter sido revertido para o valor anterior ao savepoint';
  end if;
  if (select interpretacao_persistida_em from mensagens_recebidas where id = v_msg_e1_id) is not null then
    raise exception 'FALHA teste60: marcador de msg-e1 nao deveria ter sido preenchido apos o rollback do savepoint';
  end if;
  raise notice 'OK teste60: prova real de rollback transacional -- uma chamada valida com efeito real, seguida de uma chamada invalida no mesmo savepoint, desfaz TUDO (nenhuma alteracao parcial)';

  raise notice 'TODOS OS TESTES DA ETAPA 7 (revisao pos-Codex sobre bfe487f) PASSARAM (nao executados nesta rodada -- revisao estatica apenas)';

  -- limpeza -----------------------------------------------------------------
  delete from mensagens_recebidas where clinica_id in (clinica_a, clinica_b);
  delete from estado_conversa where clinica_id in (clinica_a, clinica_b);
  delete from pacientes where clinica_id in (clinica_a, clinica_b);
  delete from clinicas where id in (clinica_a, clinica_b);
end $$;

-- ============================================================================
-- PROCEDIMENTO MANUAL DE CONCORRENCIA REAL (duas sessoes)
-- ============================================================================
-- Nao automatizado neste arquivo: um unico bloco `do $$ ... $$` roda em uma
-- unica sessao/transacao e nao pode abrir uma segunda conexao concorrente.
-- Os testes 13 (reivindicar_mensagem) e a logica de ON CONFLICT DO NOTHING
-- sao desenhados para tolerar dois workers genuinamente concorrentes, mas
-- essa propriedade so pode ser verificada de fato com duas sessoes reais.
-- Roteiro para quando a migration estiver aplicada em um ambiente descartavel:
--
--   1. Abrir duas sessoes psql (ou dois clientes) contra o mesmo banco.
--   2. Garantir que a chave (provider, instancia_whatsapp, message_id) NAO
--      exista em mensagens_recebidas (ex.: 'evolution', 'concorrencia-teste',
--      'msg-concorrente-1').
--   3. Em ambas as sessoes, preparar (sem executar ainda) a mesma chamada:
--        select * from public.reivindicar_mensagem(
--          'evolution', 'concorrencia-teste', 'msg-concorrente-1',
--          '<clinica_id valida>', '<telefone valido>'
--        );
--   4. Disparar a chamada nas duas sessoes o mais proximo possivel uma da
--      outra (ex.: colar em ambos os terminais e executar em sequencia
--      rapida, ou usar um script que dispare ambas via pipe/xargs -P).
--   5. Verificar que:
--        a. Exatamente UMA sessao recebe resultado = 'reivindicada_interpretar'
--           com um claim_token nao nulo;
--        b. A outra sessao recebe 'nao_elegivel' com claim_token nulo (a
--           lease da vencedora ainda esta vigente), OU bloqueia brevemente
--           no INSERT ate a primeira transacao commitar e entao cai no
--           caminho de fallback, tambem retornando 'nao_elegivel';
--        c. Nenhuma das duas sessoes recebe um erro de unique_violation.
--   6. Repetir o mesmo roteiro para aplicar_interpretacao_condicional: duas
--      sessoes reivindicando mensagens diferentes mas aplicando alteracoes
--      no MESMO estado_conversa com o MESMO snapshot_atualizado_em -- uma
--      deve retornar 'persistida', a outra 'conflito_concorrente', nunca as
--      duas 'persistida' para o mesmo snapshot.
--
-- Este procedimento NAO foi executado nesta rodada (nenhuma migration foi
-- aplicada em nenhum banco). Fica registrado para quando um ambiente
-- descartavel estiver disponivel para validacao manual antes de qualquer
-- aplicacao em produção.
