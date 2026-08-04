-- Iris Nova - ROLLBACK da etapa A1 (P4I, estrutura apenas)
-- Par de: src/supabase/migrations/20260804001104_iris_nova_p4i_estrutural_v1.sql
--
-- Fora do diretorio de migrations de proposito: rollback nunca e migration
-- de avanco e nunca entra no fluxo de migrations (DA-P4-03).
--
-- SEGURO somente antes de trafego novo. Preflight - todas devem dar zero:
--   select count(*) from public.resultados_composicao;
--   select count(*) from public.efeitos_composicao;
--   select count(*) from public.requisicoes_composicao;
--   select count(*) from public.continuacoes_composicao;
--   select count(*) from public.mensagens_recebidas where versao_contrato_registro = 1;
--   select count(*) from public.estado_conversa where versao > 0;
--
-- Qualquer contagem maior que zero: PARE. Existe trafego dependente do
-- contrato novo e a correcao passa a ser forward-only (DA-P4-04 ponto 11).
--
-- Nada a restaurar do legado: a migration A1 nao removeu a constraint
-- antiga, nao alterou funcoes legadas e nao mexeu em nenhum grant.
--
-- Sem IF EXISTS: se um objeto esperado nao existir, a execucao falha e
-- expoe a divergencia em vez de esconde-la.

begin;

-- 1. FKs que apontam para as tabelas novas
alter table public.continuacoes_composicao
  drop constraint continuacoes_efeito_pendente_fk,
  drop constraint continuacoes_requisicao_pendente_fk;

alter table public.mensagens_recebidas
  drop constraint mensagens_resultado_fk,
  drop constraint mensagens_continuacao_atual_fk;

-- 2. Tabelas novas (ordem inversa das dependencias).
-- Indices e constraints proprios caem junto.
drop table public.resultados_composicao;
drop table public.efeitos_composicao;
drop table public.requisicoes_composicao;
drop table public.continuacoes_composicao;

-- 3. Indices sobre tabelas existentes
drop index public.mensagens_dedup_p4i_key;
drop index public.mensagens_lease_expirado_idx;
drop index public.mensagens_bruto_retencao_idx;
drop index public.mensagens_conversa_idx;
drop index public.estado_conversa_cas_idx;

-- 4. Constraints sobre tabelas existentes
alter table public.mensagens_recebidas
  drop constraint mensagens_conversa_fk,
  drop constraint mensagens_erro_codigo_catalogo,
  drop constraint mensagens_contrato_registro_completo,
  drop constraint mensagens_versao_contrato_registro_valida,
  drop constraint mensagens_recebidas_clinica_id_key;

alter table public.estado_conversa
  drop constraint estado_conversa_clinica_id_key,
  drop constraint estado_conversa_contrato_dados_conhecido,
  drop constraint estado_conversa_versao_nao_negativa;

-- 5. Colunas novas
alter table public.mensagens_recebidas
  drop column erro_codigo,
  drop column resultado_id,
  drop column continuacao_atual_id,
  drop column bruto_removido_em,
  drop column conteudo_bruto,
  drop column payload_fingerprint,
  drop column conversa_id,
  drop column canal,
  drop column versao_contrato_registro;

alter table public.estado_conversa
  drop column versao_contrato_dados,
  drop column versao;

commit;
