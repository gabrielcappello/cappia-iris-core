-- Rollback de 20260809120000_iris_nova_persistencia_paciente_v1.sql
-- Projeto-alvo: bcmuqautblvjdqzhjfbw.
--
-- Ordem obrigatoria: a funcao sai primeiro, depois a constraint, depois as
-- colunas. Derrubar as colunas antes deixaria a funcao referenciando coluna
-- inexistente ate o proprio DROP FUNCTION.
--
-- PERDA DE DADO: `drop column` apaga nome, documento (CPF), data de
-- nascimento e e-mail de todos os pacientes deste projeto. Diferente de
-- rollbacks anteriores (historico_conversa era memoria auxiliar,
-- descartavel por construcao), AQUI HA PERDA REAL DE DADO CADASTRAL. Este
-- rollback so e seguro enquanto o projeto for o ambiente isolado de
-- desenvolvimento -- que e o caso, e por isso as colunas nascem aqui numa
-- tabela vazia. Antes de executar, confirmar que nao ha cadastro que importe
-- preservar; se houver, exportar antes.
--
-- Nao reverte nada do pipeline legado: nenhuma funcao antiga foi alterada
-- pela migration, entao nao ha o que restaurar.

drop function if exists public.cappia_persistir_paciente(uuid, text, text, text, date, text);

alter table pacientes
  drop constraint if exists pacientes_clinica_id_documento_key;

alter table pacientes
  drop column if exists nome,
  drop column if exists documento,
  drop column if exists data_nascimento,
  drop column if exists email;
