-- Correcao de 20260729_iris_nova_identificacao_v1.sql
-- Resolve 5 divergencias apontadas pela revisao do Codex:
--   1. mensagens_recebidas podia registrar uma instancia e apontar para clinica diferente;
--   2. estado_conversa garantia so a clinica do paciente, nao o telefone;
--   3. check de telefone aceitava qualquer sequencia de digitos, sem formato BR;
--   4. anon/authenticated tinham grants de tabela nao revogados (RLS sem policy ja bloqueava,
--      mas sem revogacao explicita);
--   5. faltavam testes cobrindo os quatro pontos acima.
-- Aplicada exclusivamente no projeto cappia-iris-core-dev (bcmuqautblvjdqzhjfbw).
-- Nao modifica retroativamente 20260729_iris_nova_identificacao_v1.sql.

-- 1. Vinculo entre mensagem e clinica: FK composta usando provider + instancia_whatsapp,
--    para que uma mensagem nao possa registrar uma instancia e apontar para outra clinica.

alter table clinicas
  add constraint clinicas_id_provider_instancia_key unique (id, provider, instancia_whatsapp);

alter table mensagens_recebidas
  drop constraint mensagens_recebidas_clinica_id_fkey;

alter table mensagens_recebidas
  add constraint mensagens_recebidas_clinica_provider_instancia_fk
    foreign key (clinica_id, provider, instancia_whatsapp)
    references clinicas (id, provider, instancia_whatsapp);

-- 2. Vinculo entre estado, paciente e telefone: FK composta incluindo telefone_normalizado,
--    para que um estado nao possa associar paciente da clinica certa com telefone errado.

alter table estado_conversa
  drop constraint estado_conversa_paciente_mesma_clinica_fk;

alter table pacientes
  drop constraint pacientes_id_clinica_key; -- redundante: existia so para a FK acima

alter table pacientes
  add constraint pacientes_id_clinica_telefone_key unique (id, clinica_id, telefone_normalizado);

alter table estado_conversa
  add constraint estado_conversa_paciente_clinica_telefone_fk
    foreign key (paciente_id, clinica_id, telefone_normalizado)
    references pacientes (id, clinica_id, telefone_normalizado);

-- 3. Formato brasileiro do telefone: prefixo 55 + 10 ou 11 digitos nacionais (12 ou 13 no total).

alter table pacientes drop constraint pacientes_telefone_formato;
alter table pacientes add constraint pacientes_telefone_formato
  check (telefone_normalizado ~ '^55[0-9]{10,11}$');

alter table estado_conversa drop constraint estado_conversa_telefone_formato;
alter table estado_conversa add constraint estado_conversa_telefone_formato
  check (telefone_normalizado ~ '^55[0-9]{10,11}$');

alter table mensagens_recebidas drop constraint mensagens_telefone_formato;
alter table mensagens_recebidas add constraint mensagens_telefone_formato
  check (telefone_normalizado ~ '^55[0-9]{10,11}$');

-- 4. Privilegios: revogar explicitamente acesso de anon e authenticated nas quatro tabelas.
--    RLS continua ativa e sem policies; somente service_role (server-side) acessa.

revoke all privileges on table clinicas from anon, authenticated;
revoke all privileges on table pacientes from anon, authenticated;
revoke all privileges on table estado_conversa from anon, authenticated;
revoke all privileges on table mensagens_recebidas from anon, authenticated;
