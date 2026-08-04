-- Iris Nova - P4I, etapa A1: ESTRUTURA APENAS
-- Projeto de teste autorizado: iris-nova-sql-tests-ephemeral (iopzuvrcvbjrjnvcmzyt)
-- PROIBIDO aplicar em bcmuqautblvjdqzhjfbw e em udizowyfjnhuhgxkeayk.
--
-- Base normativa (apenas referenciada, nunca reescrita aqui):
--   specs/implementacao-persistencia-composicao-v1.md secoes 5.1-5.6, 6, 20
--   specs/integracao-temporal-composicao-v1.md secao 11 (EtapaComposicaoV1)
--   docs/04-decisoes-canonicas.md (DA-P4-01 a DA-P4-04)
--
-- ESCOPO - estrutura, nada alem disso:
--   - 2 colunas novas em public.estado_conversa;
--   - 9 colunas novas em public.mensagens_recebidas;
--   - 4 tabelas novas;
--   - constraints, foreign keys compostas, indices;
--   - RLS ativa sem policies.
--
-- FORA DE ESCOPO - esta migration NAO contem:
--   - nenhuma funcao ou RPC (etapa A2, separada);
--   - nenhum GRANT;
--   - nenhum REVOKE;
--   - nenhuma alteracao de public.reivindicar_mensagem ou de
--     public.aplicar_interpretacao_condicional;
--   - nenhuma remocao da constraint mensagens_provider_instancia_message_key;
--   - nenhuma ativacao de Core, nenhum corte operacional;
--   - nada da migration B ou C.
--
-- NAO APLICADA em nenhum banco no momento desta escrita.
--
-- PREFLIGHT executado imediatamente antes desta escrita (read-only, sobre o
-- ambiente dev): mensagens_recebidas = 0 linhas; estado_conversa = 0 linhas;
-- clinicas = 0 linhas; nenhuma das 11 colunas novas existente; nenhuma das 4
-- tabelas novas existente; 3 migrations remotas, ultima 20260731164424.
-- Backfill (secao 5.2.1) e vacuamente satisfeito: nao existe linha historica
-- a classificar, canal a derivar ou fingerprint a calcular.
--
-- REEXECUTAR O PREFLIGHT no ambiente-alvo imediatamente antes de aplicar. Se
-- qualquer objeto de nome coincidente ja existir, a aplicacao PARA para
-- auditoria manual (secao 21, "Interrupcao obrigatoria"). Nenhum CREATE
-- desta migration usa OR REPLACE: colisao de nome falha explicitamente em
-- vez de sobrescrever objeto desconhecido.
--
-- IDENTIDADES: os campos id das quatro tabelas novas sao emitidos pelo Core
-- (secoes 5.3-5.6, P4I.7). NENHUM recebe DEFAULT - o banco nunca gera essas
-- identidades.

begin;

-- ============================================================================
-- 1. Colunas novas em public.estado_conversa (secao 5.1)
-- ============================================================================

alter table public.estado_conversa
  add column versao bigint not null default 0,
  add column versao_contrato_dados smallint not null default 1;

-- versao: sequencia monotonica do CAS (P4I.3, P4I.5, DA-P4-02). Nasce em
-- ZERO (secao 14; P4I.5). O avanco e sempre atribuido pelo banco
-- (esperada + 1), nunca calculado pelo cliente.
-- atualizado_em permanece auditoria e NAO e versao (secao 5.1). Esta
-- migration nao altera esse campo nem seu uso pela funcao legada.

alter table public.estado_conversa
  add constraint estado_conversa_versao_nao_negativa
    check (versao >= 0),
  add constraint estado_conversa_contrato_dados_conhecido
    check (versao_contrato_dados = 1);

-- Unicidade (clinica_id, id): alvo das FKs compostas (secao 6).
alter table public.estado_conversa
  add constraint estado_conversa_clinica_id_key unique (clinica_id, id);

-- ============================================================================
-- 2. Colunas novas em public.mensagens_recebidas (secao 5.2)
-- ============================================================================

alter table public.mensagens_recebidas
  add column versao_contrato_registro smallint,
  add column canal text,
  add column conversa_id uuid,
  add column payload_fingerprint bytea,
  add column conteudo_bruto jsonb,
  add column bruto_removido_em timestamptz,
  add column continuacao_atual_id uuid,
  add column resultado_id uuid,
  add column erro_codigo text;

-- Todas nullable por decisao explicita (secao 5.2.1): a coorte historica
-- permanece nula indefinidamente, sem valor fabricado. Nenhum NOT NULL
-- incondicional, nenhum default que mascare ausencia de evidencia.

alter table public.mensagens_recebidas
  add constraint mensagens_recebidas_clinica_id_key unique (clinica_id, id);

-- Coorte contratual (secao 5.2.2, P4I.10): historico = NULL; fluxo P4I = 1.
alter table public.mensagens_recebidas
  add constraint mensagens_versao_contrato_registro_valida
    check (versao_contrato_registro is null or versao_contrato_registro = 1);

-- CHECK condicional: mensagem do fluxo P4I exige as tres colunas; a coorte
-- historica nunca e obrigada a te-las.
alter table public.mensagens_recebidas
  add constraint mensagens_contrato_registro_completo
    check (
      versao_contrato_registro is distinct from 1
      or (
        canal is not null
        and conversa_id is not null
        and payload_fingerprint is not null
      )
    );

-- erro_codigo aceita somente codigos do catalogo fechado (secoes 6.1 e 23).
-- Nunca mensagem livre, nunca PII, nunca detalhe interno.
alter table public.mensagens_recebidas
  add constraint mensagens_erro_codigo_catalogo
    check (erro_codigo is null or erro_codigo in (
      'mensagem_payload_divergente', 'claim_ocupado', 'lease_perdido',
      'conflito_versao', 'continuacao_incompativel', 'efeito_payload_divergente',
      'resultado_duplicado', 'referencia_cruzada_clinica', 'payload_removido',
      'resultado_processado_payload_expirado', 'registro_corrompido',
      'banco_indisponivel', 'replay_disponivel'
    ));

alter table public.mensagens_recebidas
  add constraint mensagens_conversa_fk
    foreign key (clinica_id, conversa_id)
    references public.estado_conversa (clinica_id, id);

-- NOVA chave de deduplicacao (P4I.6, D6), como indice unico parcial.
-- COEXISTE com mensagens_provider_instancia_message_key, que NAO e removida
-- aqui: a retirada da antiga pertence a migration B, sob os gates de
-- DA-P4-04. A coorte historica segue protegida pela constraint antiga -
-- nunca existe janela sem deduplicacao.
create unique index mensagens_dedup_p4i_key
  on public.mensagens_recebidas
     (clinica_id, canal, provider, instancia_whatsapp, message_id)
  where versao_contrato_registro = 1;

-- ============================================================================
-- 3. public.continuacoes_composicao (secao 5.3)
-- ============================================================================

create table public.continuacoes_composicao (
  id uuid not null,
  clinica_id uuid not null,
  conversa_id uuid not null,
  mensagem_id uuid not null,
  versao_estado_origem bigint not null,
  etapa text not null,
  status text not null,
  envelope jsonb,
  versao_contrato_envelope smallint not null,
  sucessora_id uuid,
  requisicao_pendente_id uuid,
  efeito_pendente_id uuid,
  resultado_candidato jsonb,
  criado_em timestamptz not null default now(),
  encerrado_em timestamptz,
  payload_removido_em timestamptz,
  constraint continuacoes_composicao_pkey primary key (id),
  constraint continuacoes_clinica_id_key unique (clinica_id, id),
  constraint continuacoes_versao_origem_nao_negativa
    check (versao_estado_origem >= 0),
  constraint continuacoes_contrato_envelope_conhecido
    check (versao_contrato_envelope = 1),
  constraint continuacoes_etapa_catalogo check (etapa in (
    'inicio',
    'aguardando_persistencia_intermediaria',
    'resolvendo_procedimento',
    'resolvendo_dentistas',
    'resolvendo_duracao',
    'resolvendo_temporal',
    'aguardando_snapshot',
    'avaliando_opcoes',
    'preparando_resultado',
    'aguardando_persistencia_final',
    'pronto_para_decisao_terminal'
  )),
  constraint continuacoes_sem_ciclo check (sucessora_id is distinct from id),
  constraint continuacoes_conversa_fk
    foreign key (clinica_id, conversa_id)
    references public.estado_conversa (clinica_id, id),
  constraint continuacoes_mensagem_fk
    foreign key (clinica_id, mensagem_id)
    references public.mensagens_recebidas (clinica_id, id),
  constraint continuacoes_sucessora_fk
    foreign key (clinica_id, sucessora_id)
    references public.continuacoes_composicao (clinica_id, id)
);

-- status: text NOT NULL sem CHECK de catalogo. Os valores serao fixados
-- quando o primeiro fluxo precisar grava-los.

-- ============================================================================
-- 4. public.requisicoes_composicao (secao 5.4)
-- ============================================================================

create table public.requisicoes_composicao (
  id uuid not null,
  clinica_id uuid not null,
  continuacao_id uuid not null,
  conversa_id uuid not null,
  tipo text not null,
  parametros jsonb,
  parametros_fingerprint bytea not null,
  versao_contrato_parametros smallint not null,
  versao_estado_origem bigint not null,
  status text not null,
  resposta jsonb,
  resposta_fingerprint bytea,
  criado_em timestamptz not null default now(),
  encerrado_em timestamptz,
  payload_removido_em timestamptz,
  constraint requisicoes_composicao_pkey primary key (id),
  constraint requisicoes_clinica_id_key unique (clinica_id, id),
  constraint requisicoes_tipo_catalogo
    check (tipo in ('leitura', 'preparacao_efeito')),
  constraint requisicoes_status_catalogo
    check (status in ('pendente', 'respondida', 'encerrada')),
  constraint requisicoes_contrato_parametros_conhecido
    check (versao_contrato_parametros = 1),
  constraint requisicoes_versao_origem_nao_negativa
    check (versao_estado_origem >= 0),
  constraint requisicoes_continuacao_fk
    foreign key (clinica_id, continuacao_id)
    references public.continuacoes_composicao (clinica_id, id),
  constraint requisicoes_conversa_fk
    foreign key (clinica_id, conversa_id)
    references public.estado_conversa (clinica_id, id)
);

-- ============================================================================
-- 5. public.efeitos_composicao (secao 5.5)
-- ============================================================================

create table public.efeitos_composicao (
  id uuid not null,
  clinica_id uuid not null,
  continuacao_id uuid not null,
  conversa_id uuid not null,
  requisicao_id uuid,
  tipo text not null,
  parametros jsonb,
  parametros_fingerprint bytea not null,
  versao_contrato_parametros smallint not null,
  versao_estado_origem bigint not null,
  status text not null,
  claim_token uuid,
  lease_expira_em timestamptz,
  confirmacao jsonb,
  confirmado_em timestamptz,
  criado_em timestamptz not null default now(),
  encerrado_em timestamptz,
  payload_removido_em timestamptz,
  constraint efeitos_composicao_pkey primary key (id),
  constraint efeitos_clinica_id_key unique (clinica_id, id),
  constraint efeitos_status_catalogo
    check (status in ('pendente', 'confirmado', 'encerrado')),
  constraint efeitos_contrato_parametros_conhecido
    check (versao_contrato_parametros = 1),
  constraint efeitos_versao_origem_nao_negativa
    check (versao_estado_origem >= 0),
  constraint efeitos_continuacao_fk
    foreign key (clinica_id, continuacao_id)
    references public.continuacoes_composicao (clinica_id, id),
  constraint efeitos_conversa_fk
    foreign key (clinica_id, conversa_id)
    references public.estado_conversa (clinica_id, id),
  constraint efeitos_requisicao_fk
    foreign key (clinica_id, requisicao_id)
    references public.requisicoes_composicao (clinica_id, id)
);

-- requisicao_id: opcional e condicionado (P4I.16, secao 11). Obrigatorio
-- para efeito originado de requisicao preparatoria, nulo apenas para efeito
-- direto do Core. A imutabilidade do vinculo e responsabilidade das
-- operacoes da secao 13 (etapa A2), nunca de trigger.

-- ============================================================================
-- 6. public.resultados_composicao (secao 5.6)
-- ============================================================================

create table public.resultados_composicao (
  id uuid not null,
  clinica_id uuid not null,
  mensagem_id uuid not null,
  conversa_id uuid not null,
  continuacao_id uuid not null,
  efeito_id uuid,
  versao_resultante bigint not null,
  versao_contrato_resultado smallint not null,
  tipo_terminal text not null,
  resultado_logico jsonb,
  comando jsonb,
  fatos_autorizados jsonb,
  conteudo_fingerprint bytea not null,
  criado_em timestamptz not null default now(),
  payload_removido_em timestamptz,
  constraint resultados_composicao_pkey primary key (id),
  constraint resultados_clinica_id_key unique (clinica_id, id),
  constraint resultados_mensagem_key unique (clinica_id, mensagem_id),
  constraint resultados_contrato_conhecido
    check (versao_contrato_resultado = 1),
  constraint resultados_versao_nao_negativa
    check (versao_resultante >= 0),
  constraint resultados_mensagem_fk
    foreign key (clinica_id, mensagem_id)
    references public.mensagens_recebidas (clinica_id, id),
  constraint resultados_conversa_fk
    foreign key (clinica_id, conversa_id)
    references public.estado_conversa (clinica_id, id),
  constraint resultados_continuacao_fk
    foreign key (clinica_id, continuacao_id)
    references public.continuacoes_composicao (clinica_id, id),
  constraint resultados_efeito_fk
    foreign key (clinica_id, efeito_id)
    references public.efeitos_composicao (clinica_id, id)
);

-- (clinica_id, mensagem_id) unico: no maximo um resultado por mensagem
-- (P4I.18, secao 6). conteudo_fingerprint e metadado preservado para
-- sempre - a limpeza dos 30 dias nunca o remove (P4I-R1).

-- ============================================================================
-- 7. FKs de public.mensagens_recebidas para as tabelas novas
-- ============================================================================
-- Criadas depois das tabelas existirem. Nulas em toda a coorte historica.

alter table public.mensagens_recebidas
  add constraint mensagens_continuacao_atual_fk
    foreign key (clinica_id, continuacao_atual_id)
    references public.continuacoes_composicao (clinica_id, id),
  add constraint mensagens_resultado_fk
    foreign key (clinica_id, resultado_id)
    references public.resultados_composicao (clinica_id, id);

-- Continuacao pendente e efeito pendente: FKs compostas (secao 5.3).
alter table public.continuacoes_composicao
  add constraint continuacoes_requisicao_pendente_fk
    foreign key (clinica_id, requisicao_pendente_id)
    references public.requisicoes_composicao (clinica_id, id),
  add constraint continuacoes_efeito_pendente_fk
    foreign key (clinica_id, efeito_pendente_id)
    references public.efeitos_composicao (clinica_id, id);

-- ============================================================================
-- 8. Indices essenciais (secao 20)
-- ============================================================================
-- Somente os que sustentam uma regra da especificacao. Nenhum indice de
-- expressao sobre caminho interno de JSONB.

-- 2. CAS em estado_conversa
create index estado_conversa_cas_idx
  on public.estado_conversa (clinica_id, id, versao);

-- 3. Lease expirado da mensagem (reclaim)
create index mensagens_lease_expirado_idx
  on public.mensagens_recebidas (status_processamento, lease_expira_em);

-- 4. Lease expirado do efeito (reclaim de efeito)
create index efeitos_lease_expirado_idx
  on public.efeitos_composicao (status, lease_expira_em);

-- 8. Encerramento para limpeza (varredura dos 30 dias)
create index continuacoes_encerramento_idx
  on public.continuacoes_composicao (status, encerrado_em);
create index requisicoes_encerramento_idx
  on public.requisicoes_composicao (status, encerrado_em);
create index efeitos_encerramento_idx
  on public.efeitos_composicao (status, encerrado_em);

-- 9. Expiracao de payload bruto (varredura dos 7 dias)
create index mensagens_bruto_retencao_idx
  on public.mensagens_recebidas (recebido_em, bruto_removido_em);

-- Retencao dos resultados: prazo conta de criado_em (P4I-R1, secao 5.6)
create index resultados_retencao_idx
  on public.resultados_composicao (criado_em, payload_removido_em);

-- 10. Suporte as FKs compostas
create index mensagens_conversa_idx
  on public.mensagens_recebidas (clinica_id, conversa_id);
create index continuacoes_conversa_idx
  on public.continuacoes_composicao (clinica_id, conversa_id);
create index continuacoes_mensagem_idx
  on public.continuacoes_composicao (clinica_id, mensagem_id);
create index requisicoes_continuacao_idx
  on public.requisicoes_composicao (clinica_id, continuacao_id);
create index efeitos_continuacao_idx
  on public.efeitos_composicao (clinica_id, continuacao_id);
create index efeitos_requisicao_idx
  on public.efeitos_composicao (clinica_id, requisicao_id);
create index resultados_continuacao_idx
  on public.resultados_composicao (clinica_id, continuacao_id);
create index resultados_efeito_idx
  on public.resultados_composicao (clinica_id, efeito_id);

-- 5. Recuperacao da continuacao por trio (secao 6). A unicidade da
-- retomavel depende do catalogo de status e sera imposta em A2.
create index continuacoes_retomavel_idx
  on public.continuacoes_composicao
     (clinica_id, mensagem_id, versao_estado_origem, status);

-- ============================================================================
-- 9. RLS nas tabelas novas (secao 19, P4I.22)
-- ============================================================================
-- RLS ativa SEM policies: nenhuma das tabelas e acessivel diretamente ao
-- cliente. Mesmo regime das tabelas ja existentes deste projeto (todas com
-- RLS ativa e zero policies). RLS e defesa adicional, nunca suficiente - o
-- predicado clinica_id e obrigatorio no codigo das operacoes (etapa A2).
-- Nenhum GRANT e concedido nesta migration.

alter table public.continuacoes_composicao enable row level security;
alter table public.requisicoes_composicao enable row level security;
alter table public.efeitos_composicao enable row level security;
alter table public.resultados_composicao enable row level security;

commit;
