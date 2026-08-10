-- Rollback de 20260809120000_iris_nova_persistencia_paciente_v1_legado.sql
-- Projeto-alvo: udizowyfjnhuhgxkeayk (banco operacional real).
--
-- Ordem obrigatoria: a funcao sai primeiro, depois a constraint, depois o
-- NOT NULL.
--
-- SEM PERDA DE DADO: diferente do rollback irmao (dev), aqui NENHUMA coluna
-- e removida -- nome, documento, data_nascimento e email ja existiam antes
-- desta migration e permanecem intactos, com todo o conteudo. Este rollback
-- apenas devolve `clinica_id` a condicao nullable e remove a constraint de
-- unicidade de CPF por clinica.
--
-- Reverter o NOT NULL de `clinica_id` volta a permitir paciente orfao de
-- clinica -- exatamente o estado anterior a migration, nao pior. Nenhuma
-- linha existente e alterada: soltar um NOT NULL nunca reescreve dado.
--
-- Nao reverte nada do pipeline legado: nenhuma funcao antiga
-- (cappia_confirmar_acao_pendente, cappia_avancar_agendamento,
-- cappia_confirmar_criacao_canonica, cappia_remarcar_agendamento,
-- atualizar_anamnese) foi alterada pela migration, entao nao ha o que
-- restaurar. O indice legado `pacientes_clinica_telefone_unique` sobre
-- (clinica_id, telefone) tambem nunca foi tocado e continua intacto.
--
-- Nao mexe nos grants de `anon` sobre `pacientes`: a migration nao os
-- alterou (divergencia pre-existente registrada no cabecalho dela), entao
-- este rollback tambem nao deve.

drop function if exists public.cappia_persistir_paciente(uuid, text, text, text, date, text);

alter table pacientes
  drop constraint if exists pacientes_clinica_id_documento_key;

alter table pacientes
  alter column clinica_id drop not null;
