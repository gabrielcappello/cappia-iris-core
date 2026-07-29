-- Rollback de 20260729_iris_nova_identificacao_v1_correcao.sql
-- Restaura exatamente a estrutura deixada por 20260729_iris_nova_identificacao_v1.sql.

-- reverter privilegios (restaura os grants padrao que existiam antes da correcao)
grant all privileges on table clinicas to anon, authenticated;
grant all privileges on table pacientes to anon, authenticated;
grant all privileges on table estado_conversa to anon, authenticated;
grant all privileges on table mensagens_recebidas to anon, authenticated;

-- reverter checks de telefone para o formato original (somente digitos)
alter table mensagens_recebidas drop constraint mensagens_telefone_formato;
alter table mensagens_recebidas add constraint mensagens_telefone_formato
  check (telefone_normalizado ~ '^[0-9]+$');

alter table estado_conversa drop constraint estado_conversa_telefone_formato;
alter table estado_conversa add constraint estado_conversa_telefone_formato
  check (telefone_normalizado ~ '^[0-9]+$');

alter table pacientes drop constraint pacientes_telefone_formato;
alter table pacientes add constraint pacientes_telefone_formato
  check (telefone_normalizado ~ '^[0-9]+$');

-- reverter FK composta estado_conversa -> pacientes para a versao (id, clinica_id)
alter table estado_conversa drop constraint estado_conversa_paciente_clinica_telefone_fk;

alter table pacientes drop constraint pacientes_id_clinica_telefone_key;

alter table pacientes add constraint pacientes_id_clinica_key unique (id, clinica_id);

alter table estado_conversa
  add constraint estado_conversa_paciente_mesma_clinica_fk
    foreign key (paciente_id, clinica_id) references pacientes (id, clinica_id);

-- reverter FK composta mensagens_recebidas -> clinicas para a versao simples (clinica_id)
alter table mensagens_recebidas drop constraint mensagens_recebidas_clinica_provider_instancia_fk;

alter table clinicas drop constraint clinicas_id_provider_instancia_key;

alter table mensagens_recebidas
  add constraint mensagens_recebidas_clinica_id_fkey
    foreign key (clinica_id) references clinicas (id);
