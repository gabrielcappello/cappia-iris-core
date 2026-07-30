-- Rollback de 20260730_iris_nova_interpretacao_v1.sql
--
-- PRE-REQUISITO OBRIGATORIO: todos os consumidores da versao nova (qualquer
-- Edge Function ou processo que chame reivindicar_mensagem,
-- aplicar_interpretacao_condicional, concluirMensagemCondicional ou
-- falharMensagemCondicional) devem estar interrompidos ANTES de aplicar este
-- rollback. Este arquivo nao verifica isso e nao e seguro aplicar enquanto
-- consumidores novos estiverem ativos.
--
-- Nao remove as tabelas. Nao altera nenhuma coluna anterior a esta migration.

-- 1. revogar grants e remover as duas funcoes (ordem inversa da criacao).

revoke all on function public.aplicar_interpretacao_condicional(uuid, uuid, text, uuid, uuid, timestamptz, jsonb) from service_role;
drop function if exists public.aplicar_interpretacao_condicional(uuid, uuid, text, uuid, uuid, timestamptz, jsonb);

revoke all on function public.reivindicar_mensagem(text, text, text, uuid, text) from service_role;
drop function if exists public.reivindicar_mensagem(text, text, text, uuid, text);

-- 2. remover as tres colunas adicionadas em mensagens_recebidas.

alter table public.mensagens_recebidas
  drop column if exists interpretacao_persistida_em,
  drop column if exists lease_expira_em,
  drop column if exists claim_token;
