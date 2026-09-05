-- Auditoria de conversas para o painel /admin (specs/auditoria-conversas-admin-v1.md)
--
-- Tabela SÓ DE AUDITORIA, gravada em paralelo ao turno real (EdgeRuntime.
-- waitUntil), depois que a resposta já foi decidida (sucesso) ou dentro do
-- try de processarMensagem quando ele lança (falha) -- NUNCA lida por
-- orquestrador.ts, por nenhuma IA, nem por historico-conversa.ts. Existe
-- exclusivamente para leitura humana via /admin, com is_admin = true.
--
-- Não substitui nem estende estado_conversa.historico_conversa (10 pares,
-- 12h de validade de leitura, usado pela Iris para decidir) nem
-- mensagens_recebidas -- as duas continuam exatamente como estão.
--
-- Escopo de gravação (spec seção 1.2): só depois que a Edge Function já
-- validou POST + payload parseado + variáveis de ambiente presentes +
-- instância autorizada. Tráfego anterior a isso (método errado, payload
-- malformado, config ausente, instância não autorizada) NUNCA gera linha
-- aqui -- não representa conversa real e não seria possível compor uma
-- linha útil a partir dele.
--
-- telefone_normalizado é NOT NULL: validarPayload (index.ts) já garante
-- essa string não vazia antes de qualquer chamada a processarMensagem, e
-- nenhum erro dentro do escopo de gravação pode ocorrer sem ele disponível.
-- clinica_id é nullable: fica nulo quando resultado_turno =
-- 'clinica_nao_encontrada' (a clínica nunca existiu para aquele
-- provider/instancia_whatsapp) ou no caso residual de a clínica ter sido
-- removida entre a checagem de instância e a falha -- nesses casos a linha
-- é gravada mas nunca aparece em nenhuma tela do /admin nesta v1 (spec
-- seção 2).

create table public.conversas_auditoria (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid references public.clinicas(id) on delete cascade,
  telefone_normalizado text not null,
  mensagem_paciente text not null,
  resposta_iris text,
  motivo_fallback text,
  resultado_turno text not null,
  criado_em timestamptz not null default now(),
  -- Vocabulário fechado, mapeado 1:1 ao código de
  -- supabase/functions/iris-nova-mensagem/index.ts (spec seção 1.1) --
  -- nunca "etc.", nunca inferido pela ausência de outro campo.
  check (
    resultado_turno in (
      'sucesso',
      'clinica_nao_encontrada',
      'entrada_invalida',
      'resposta_truncada_apos_retry',
      'erro_interno'
    )
  ),
  -- motivo_fallback só é preenchido em sucesso não-padrão (spec seção 1.1):
  -- redator_nao_configurado, falha_redatora, ou o motivo real devolvido
  -- pela guarda (resultadoGuarda.motivo, gerar-resposta-conversacional.ts)
  -- -- vocabulário aberto de propósito, porque a guarda já tem seu próprio
  -- vocabulário fechado em outro lugar (guarda-resposta-redatora.ts) e esta
  -- tabela só ecoa o que já existe, nunca redefine.
  check (motivo_fallback is null or resultado_turno = 'sucesso')
  -- SEM constraint de formato em telefone_normalizado (correção do Codex,
  -- 05/09, bloqueador real): diferente de contatos_excecao_iris, o handler
  -- (validarPayload, index.ts:55-56) garante SOMENTE string não vazia --
  -- nunca formato E.164. Uma constraint mais estrita aqui rejeitaria em
  -- silêncio (INSERT falha, best-effort absorve) exatamente a auditoria de
  -- um turno que o fluxo principal já aceitou processar, o oposto do
  -- objetivo desta tabela.
);

create index conversas_auditoria_clinica_id_criado_em_idx
  on public.conversas_auditoria (clinica_id, criado_em desc);
create index conversas_auditoria_clinica_telefone_criado_em_idx
  on public.conversas_auditoria (clinica_id, telefone_normalizado, criado_em desc);
create index conversas_auditoria_criado_em_idx
  on public.conversas_auditoria (criado_em);

-- RLS fechada por padrão -- só service_role (Edge Function gravando; rota
-- /api/admin/conversas do painel lendo, com is_admin = true checado no
-- servidor antes de qualquer consulta) acessa. Mesmo padrão e mesmo motivo
-- de contatos_excecao_iris/conversas_manuais: revoke explícito, não só
-- ausência de grant.
alter table public.conversas_auditoria enable row level security;
revoke all on table public.conversas_auditoria from public, anon, authenticated;
grant select, insert, delete on table public.conversas_auditoria to service_role;
-- Sem "update": nenhum código deve alterar uma linha já gravada -- só
-- criar (Edge Function) ou apagar por retenção (job de limpeza).

-- ── LIMPEZA AUTOMÁTICA: pg_cron (spec seção 3) ──────────────────────────
--
-- pg_cron está disponível no projeto operacional (confirmado via
-- list_extensions, versão 1.6.4) mas não habilitado antes desta migration
-- (installed_version: null). Habilitação e job nascem juntos aqui, para
-- que o rollback desta migration reverta os dois -- SE nenhuma outra
-- rotina do projeto já depender de pg_cron nesse meio-tempo (checar antes
-- de aplicar em qualquer ambiente real; nunca presumir).
create extension if not exists pg_cron;

-- Retenção fechada em 7 dias (spec seção 3, decisão do Gabriel 05/09).
-- DELETE puro, sem alternativa de "irrecuperável" via UPDATE: preservar a
-- linha anonimizada contradiria telefone_normalizado NOT NULL, e esta
-- tabela não tem FK apontando para ela nem histórico de status a
-- justificar preservação -- só existe para leitura humana temporária.
-- Idempotente por natureza (um DELETE repetido sobre linhas já ausentes
-- não tem efeito); "por lote" aqui significa a própria janela diária, sem
-- necessidade de paginação adicional para o volume esperado desta tabela.
select cron.schedule(
  'conversas_auditoria_limpeza_diaria',
  '0 3 * * *', -- diariamente às 03:00 UTC
  $$delete from public.conversas_auditoria where criado_em < now() - interval '7 days'$$
);

-- ── ROLLBACK ────────────────────────────────────────────────────────────
-- select cron.unschedule('conversas_auditoria_limpeza_diaria');
-- drop extension if exists pg_cron; -- SOMENTE se nenhuma outra rotina do
--   projeto passou a depender dela desde a aplicação desta migration --
--   verificação obrigatória antes de executar esta linha, nunca presumida.
-- drop table public.conversas_auditoria;
