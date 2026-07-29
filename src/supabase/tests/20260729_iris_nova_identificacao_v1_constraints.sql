-- Testes de constraint e isolamento multiclinica para
-- 20260729_iris_nova_identificacao_v1.sql
-- Executado manualmente contra o projeto cappia-iris-core-dev (bcmuqautblvjdqzhjfbw)
-- em 2026-07-29. Cria dados sinteticos de teste e remove tudo ao final
-- (tabelas voltam a 0 linhas). Nao usa dados reais nem de teste da Iris antiga.
--
-- Cobertura:
--   1. unicidade provider+instancia_whatsapp em clinicas
--   2. unicidade clinica_id+telefone_normalizado em pacientes
--   3. mesmo telefone permitido em clinicas diferentes
--   4. check de telefone_normalizado (somente digitos)
--   5. isolamento: FK composta bloqueia paciente de outra clinica em estado_conversa
--   6. estado_conversa valido com paciente da mesma clinica
--   7. paciente_id nulo permitido (caso "paciente novo")
--   8. um unico estado ativo por clinica_id+telefone_normalizado
--   9. check do enum de estado (valores fora da lista aprovada rejeitados)
--  10. deduplicacao por provider+instancia_whatsapp+message_id em mensagens_recebidas
--  11. mesmo message_id permitido em instancias diferentes
--  12. check do enum de status_processamento
--
-- Resultado da execucao em 2026-07-29: todos os 12 casos passaram
-- (bloqueios esperados dispararam a excecao correta; casos permitidos foram
-- inseridos sem erro); limpeza confirmada via contagem de linhas = 0 em
-- todas as quatro tabelas apos a execucao.

do $$
declare
  clinica_a uuid;
  clinica_b uuid;
  paciente_a uuid;
begin
  insert into clinicas (provider, instancia_whatsapp) values ('evolution', 'teste-clinica-a') returning id into clinica_a;
  insert into clinicas (provider, instancia_whatsapp) values ('evolution', 'teste-clinica-b') returning id into clinica_b;

  begin
    insert into clinicas (provider, instancia_whatsapp) values ('evolution', 'teste-clinica-a');
    raise exception 'FALHA teste1: duplicata de clinica nao foi bloqueada';
  exception when unique_violation then
    raise notice 'OK teste1: unicidade provider+instancia em clinicas bloqueada';
  end;

  insert into pacientes (clinica_id, telefone_normalizado) values (clinica_a, '5511999999999') returning id into paciente_a;
  begin
    insert into pacientes (clinica_id, telefone_normalizado) values (clinica_a, '5511999999999');
    raise exception 'FALHA teste2: duplicata de paciente na mesma clinica nao foi bloqueada';
  exception when unique_violation then
    raise notice 'OK teste2: unicidade clinica_id+telefone em pacientes bloqueada';
  end;

  insert into pacientes (clinica_id, telefone_normalizado) values (clinica_b, '5511999999999');
  raise notice 'OK teste3: mesmo telefone em clinica diferente permitido';

  begin
    insert into pacientes (clinica_id, telefone_normalizado) values (clinica_a, '+55 11 99999-0000');
    raise exception 'FALHA teste4: telefone nao normalizado nao foi bloqueado';
  exception when check_violation then
    raise notice 'OK teste4: check de telefone_normalizado (somente digitos) bloqueada';
  end;

  begin
    insert into estado_conversa (clinica_id, paciente_id, telefone_normalizado, estado)
    values (clinica_b, paciente_a, '5511999999999', 'atendimento');
    raise exception 'FALHA teste5: estado_conversa aceitou paciente de outra clinica';
  exception when foreign_key_violation then
    raise notice 'OK teste5: FK composta clinica_id+paciente_id bloqueou paciente de outra clinica';
  end;

  insert into estado_conversa (clinica_id, paciente_id, telefone_normalizado, estado)
  values (clinica_a, paciente_a, '5511999999999', 'atendimento');
  raise notice 'OK teste6: estado_conversa criado com paciente da mesma clinica';

  insert into estado_conversa (clinica_id, paciente_id, telefone_normalizado, estado)
  values (clinica_b, null, '5511988888888', 'atendimento');
  raise notice 'OK teste7: estado_conversa com paciente_id nulo (paciente novo) permitido';

  begin
    insert into estado_conversa (clinica_id, paciente_id, telefone_normalizado, estado)
    values (clinica_a, paciente_a, '5511999999999', 'aguardando_escolha');
    raise exception 'FALHA teste8: segundo estado para mesma clinica+telefone nao foi bloqueado';
  exception when unique_violation then
    raise notice 'OK teste8: unicidade clinica_id+telefone em estado_conversa bloqueada';
  end;

  begin
    insert into estado_conversa (clinica_id, paciente_id, telefone_normalizado, estado)
    values (clinica_a, paciente_a, '5511977777777', 'estado_inventado');
    raise exception 'FALHA teste9: estado invalido nao foi bloqueado';
  exception when check_violation then
    raise notice 'OK teste9: check de estado (enum aprovado) bloqueada';
  end;

  insert into mensagens_recebidas (provider, instancia_whatsapp, message_id, clinica_id, telefone_normalizado)
  values ('evolution', 'teste-clinica-a', 'msg-001', clinica_a, '5511999999999');
  begin
    insert into mensagens_recebidas (provider, instancia_whatsapp, message_id, clinica_id, telefone_normalizado)
    values ('evolution', 'teste-clinica-a', 'msg-001', clinica_a, '5511999999999');
    raise exception 'FALHA teste10: mensagem duplicada nao foi bloqueada';
  exception when unique_violation then
    raise notice 'OK teste10: unicidade provider+instancia+message_id em mensagens_recebidas bloqueada';
  end;

  insert into mensagens_recebidas (provider, instancia_whatsapp, message_id, clinica_id, telefone_normalizado)
  values ('evolution', 'teste-clinica-b', 'msg-001', clinica_b, '5511988888888');
  raise notice 'OK teste11: mesmo message_id em instancia diferente permitido';

  begin
    insert into mensagens_recebidas (provider, instancia_whatsapp, message_id, clinica_id, telefone_normalizado, status_processamento)
    values ('evolution', 'teste-clinica-a', 'msg-002', clinica_a, '5511999999999', 'status_invalido');
    raise exception 'FALHA teste12: status_processamento invalido nao foi bloqueado';
  exception when check_violation then
    raise notice 'OK teste12: check de status_processamento (enum aprovado) bloqueada';
  end;

  delete from mensagens_recebidas where clinica_id in (clinica_a, clinica_b);
  delete from estado_conversa where clinica_id in (clinica_a, clinica_b);
  delete from pacientes where clinica_id in (clinica_a, clinica_b);
  delete from clinicas where id in (clinica_a, clinica_b);
end $$;
