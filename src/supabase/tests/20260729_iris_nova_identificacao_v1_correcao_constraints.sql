-- Testes da correcao 20260729_iris_nova_identificacao_v1_correcao.sql
-- Executado contra o projeto cappia-iris-core-dev (bcmuqautblvjdqzhjfbw) em 2026-07-29.
-- Usa somente dados sinteticos e remove tudo ao final.
--
-- Cobertura (numeracao conforme pedido da revisao do Codex):
--   1. rejeitar mensagem cujo clinica_id nao corresponda ao mesmo provider+instancia_whatsapp
--   2. aceitar mensagem com clinica, provider e instancia correspondentes
--   3. rejeitar estado associado a paciente da mesma clinica, mas com telefone diferente
--   4. aceitar estado com paciente, clinica e telefone correspondentes
--   5. aceitar telefone brasileiro valido com 12 digitos
--   6. aceitar telefone brasileiro valido com 13 digitos
--   7. rejeitar telefone sem prefixo 55
--   8. rejeitar telefone curto
--   9. rejeitar telefone longo
--  10. rejeitar telefone com simbolos ou espacos
--  11. confirmar ausencia de privilegios para anon
--  12. confirmar ausencia de privilegios para authenticated
--  13. confirmar acesso necessario para service_role
--
-- Resultado da execucao em 2026-07-29: todos os 13 casos passaram; limpeza
-- confirmada via contagem de linhas = 0 nas quatro tabelas apos a execucao.

do $$
declare
  clinica_a uuid;
  clinica_b uuid;
  paciente_a uuid;
  algum_privilegio boolean;
  todos_privilegios boolean;
begin
  insert into clinicas (provider, instancia_whatsapp) values ('evolution', 'correcao-clinica-a') returning id into clinica_a;
  insert into clinicas (provider, instancia_whatsapp) values ('evolution', 'correcao-clinica-b') returning id into clinica_b;
  insert into pacientes (clinica_id, telefone_normalizado) values (clinica_a, '5511999999999') returning id into paciente_a;

  -- teste 1
  begin
    insert into mensagens_recebidas (provider, instancia_whatsapp, message_id, clinica_id, telefone_normalizado)
    values ('evolution', 'correcao-clinica-b', 'msg-corr-001', clinica_a, '5511999999999');
    raise exception 'FALHA teste1: mensagem com clinica_id incompativel com provider+instancia nao foi bloqueada';
  exception when foreign_key_violation then
    raise notice 'OK teste1: FK composta bloqueou clinica_id incompativel com provider+instancia';
  end;

  -- teste 2
  insert into mensagens_recebidas (provider, instancia_whatsapp, message_id, clinica_id, telefone_normalizado)
  values ('evolution', 'correcao-clinica-a', 'msg-corr-002', clinica_a, '5511999999999');
  raise notice 'OK teste2: mensagem com clinica/provider/instancia correspondentes aceita';

  -- teste 3
  begin
    insert into estado_conversa (clinica_id, paciente_id, telefone_normalizado, estado)
    values (clinica_a, paciente_a, '5511988888888', 'atendimento');
    raise exception 'FALHA teste3: estado com telefone diferente do paciente nao foi bloqueado';
  exception when foreign_key_violation then
    raise notice 'OK teste3: FK composta bloqueou telefone divergente do paciente';
  end;

  -- teste 4
  insert into estado_conversa (clinica_id, paciente_id, telefone_normalizado, estado)
  values (clinica_a, paciente_a, '5511999999999', 'atendimento');
  raise notice 'OK teste4: estado com paciente/clinica/telefone correspondentes aceito';

  -- teste 5
  insert into pacientes (clinica_id, telefone_normalizado) values (clinica_b, '551133334444');
  raise notice 'OK teste5: telefone valido de 12 digitos aceito';

  -- teste 6
  insert into pacientes (clinica_id, telefone_normalizado) values (clinica_b, '5521988887777');
  raise notice 'OK teste6: telefone valido de 13 digitos aceito';

  -- teste 7
  begin
    insert into pacientes (clinica_id, telefone_normalizado) values (clinica_b, '11999999999');
    raise exception 'FALHA teste7: telefone sem prefixo 55 nao foi bloqueado';
  exception when check_violation then
    raise notice 'OK teste7: check bloqueou telefone sem prefixo 55';
  end;

  -- teste 8
  begin
    insert into pacientes (clinica_id, telefone_normalizado) values (clinica_b, '5511999');
    raise exception 'FALHA teste8: telefone curto nao foi bloqueado';
  exception when check_violation then
    raise notice 'OK teste8: check bloqueou telefone curto';
  end;

  -- teste 9
  begin
    insert into pacientes (clinica_id, telefone_normalizado) values (clinica_b, '55119999999999');
    raise exception 'FALHA teste9: telefone longo nao foi bloqueado';
  exception when check_violation then
    raise notice 'OK teste9: check bloqueou telefone longo';
  end;

  -- teste 10
  begin
    insert into pacientes (clinica_id, telefone_normalizado) values (clinica_b, '+55 11 99999-9999');
    raise exception 'FALHA teste10: telefone com simbolos nao foi bloqueado';
  exception when check_violation then
    raise notice 'OK teste10: check bloqueou telefone com simbolos/espacos';
  end;

  -- teste 11: anon sem nenhum privilegio nas 4 tabelas
  select bool_or(p) into algum_privilegio from (
    select has_table_privilege('anon', 'public.clinicas', 'SELECT') as p
    union all select has_table_privilege('anon', 'public.clinicas', 'INSERT')
    union all select has_table_privilege('anon', 'public.clinicas', 'UPDATE')
    union all select has_table_privilege('anon', 'public.clinicas', 'DELETE')
    union all select has_table_privilege('anon', 'public.pacientes', 'SELECT')
    union all select has_table_privilege('anon', 'public.pacientes', 'INSERT')
    union all select has_table_privilege('anon', 'public.pacientes', 'UPDATE')
    union all select has_table_privilege('anon', 'public.pacientes', 'DELETE')
    union all select has_table_privilege('anon', 'public.estado_conversa', 'SELECT')
    union all select has_table_privilege('anon', 'public.estado_conversa', 'INSERT')
    union all select has_table_privilege('anon', 'public.estado_conversa', 'UPDATE')
    union all select has_table_privilege('anon', 'public.estado_conversa', 'DELETE')
    union all select has_table_privilege('anon', 'public.mensagens_recebidas', 'SELECT')
    union all select has_table_privilege('anon', 'public.mensagens_recebidas', 'INSERT')
    union all select has_table_privilege('anon', 'public.mensagens_recebidas', 'UPDATE')
    union all select has_table_privilege('anon', 'public.mensagens_recebidas', 'DELETE')
  ) t;
  if algum_privilegio then
    raise exception 'FALHA teste11: anon ainda possui algum privilegio nas 4 tabelas';
  end if;
  raise notice 'OK teste11: anon sem SELECT/INSERT/UPDATE/DELETE nas 4 tabelas';

  -- teste 12: authenticated sem nenhum privilegio nas 4 tabelas
  select bool_or(p) into algum_privilegio from (
    select has_table_privilege('authenticated', 'public.clinicas', 'SELECT') as p
    union all select has_table_privilege('authenticated', 'public.clinicas', 'INSERT')
    union all select has_table_privilege('authenticated', 'public.clinicas', 'UPDATE')
    union all select has_table_privilege('authenticated', 'public.clinicas', 'DELETE')
    union all select has_table_privilege('authenticated', 'public.pacientes', 'SELECT')
    union all select has_table_privilege('authenticated', 'public.pacientes', 'INSERT')
    union all select has_table_privilege('authenticated', 'public.pacientes', 'UPDATE')
    union all select has_table_privilege('authenticated', 'public.pacientes', 'DELETE')
    union all select has_table_privilege('authenticated', 'public.estado_conversa', 'SELECT')
    union all select has_table_privilege('authenticated', 'public.estado_conversa', 'INSERT')
    union all select has_table_privilege('authenticated', 'public.estado_conversa', 'UPDATE')
    union all select has_table_privilege('authenticated', 'public.estado_conversa', 'DELETE')
    union all select has_table_privilege('authenticated', 'public.mensagens_recebidas', 'SELECT')
    union all select has_table_privilege('authenticated', 'public.mensagens_recebidas', 'INSERT')
    union all select has_table_privilege('authenticated', 'public.mensagens_recebidas', 'UPDATE')
    union all select has_table_privilege('authenticated', 'public.mensagens_recebidas', 'DELETE')
  ) t;
  if algum_privilegio then
    raise exception 'FALHA teste12: authenticated ainda possui algum privilegio nas 4 tabelas';
  end if;
  raise notice 'OK teste12: authenticated sem SELECT/INSERT/UPDATE/DELETE nas 4 tabelas';

  -- teste 13: service_role mantem todos os privilegios necessarios
  select bool_and(p) into todos_privilegios from (
    select has_table_privilege('service_role', 'public.clinicas', 'SELECT') as p
    union all select has_table_privilege('service_role', 'public.clinicas', 'INSERT')
    union all select has_table_privilege('service_role', 'public.clinicas', 'UPDATE')
    union all select has_table_privilege('service_role', 'public.clinicas', 'DELETE')
    union all select has_table_privilege('service_role', 'public.pacientes', 'SELECT')
    union all select has_table_privilege('service_role', 'public.pacientes', 'INSERT')
    union all select has_table_privilege('service_role', 'public.pacientes', 'UPDATE')
    union all select has_table_privilege('service_role', 'public.pacientes', 'DELETE')
    union all select has_table_privilege('service_role', 'public.estado_conversa', 'SELECT')
    union all select has_table_privilege('service_role', 'public.estado_conversa', 'INSERT')
    union all select has_table_privilege('service_role', 'public.estado_conversa', 'UPDATE')
    union all select has_table_privilege('service_role', 'public.estado_conversa', 'DELETE')
    union all select has_table_privilege('service_role', 'public.mensagens_recebidas', 'SELECT')
    union all select has_table_privilege('service_role', 'public.mensagens_recebidas', 'INSERT')
    union all select has_table_privilege('service_role', 'public.mensagens_recebidas', 'UPDATE')
    union all select has_table_privilege('service_role', 'public.mensagens_recebidas', 'DELETE')
  ) t;
  if not todos_privilegios then
    raise exception 'FALHA teste13: service_role perdeu algum privilegio necessario nas 4 tabelas';
  end if;
  raise notice 'OK teste13: service_role mantem SELECT/INSERT/UPDATE/DELETE nas 4 tabelas';

  raise notice 'TODOS OS TESTES DA CORRECAO PASSARAM';

  -- limpeza
  delete from mensagens_recebidas where clinica_id in (clinica_a, clinica_b);
  delete from estado_conversa where clinica_id in (clinica_a, clinica_b);
  delete from pacientes where clinica_id in (clinica_a, clinica_b);
  delete from clinicas where id in (clinica_a, clinica_b);
end $$;
