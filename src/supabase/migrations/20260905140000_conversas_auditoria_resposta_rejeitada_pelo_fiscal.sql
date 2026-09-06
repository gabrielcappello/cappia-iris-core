-- specs/guarda-redatora-fiscal-conversa-v1.md secao 5: coluna aditiva sobre
-- conversas_auditoria (ja em producao) para deixar de depender de hipotese
-- sobre o que a redatora escreveu quando a guarda a reprova por um motivo
-- com conteudo real. Nullable, sem NOT NULL em nenhum cenario -- nenhuma
-- mudanca de constraint, indice ou RLS existente.

alter table public.conversas_auditoria
  add column resposta_rejeitada_pelo_fiscal text;

comment on column public.conversas_auditoria.resposta_rejeitada_pelo_fiscal is
  'Texto original produzido pela redatora quando a guarda o reprovou por um motivo '
  'com conteudo real (horario_nao_autorizado, data_nao_autorizada, '
  'execucao_nao_autorizada). NULL para texto_vazio (sem conteudo util), quando a '
  'redatora nao estava configurada, ou quando falhou antes de responder.';

-- ROLLBACK:
-- alter table public.conversas_auditoria drop column resposta_rejeitada_pelo_fiscal;
