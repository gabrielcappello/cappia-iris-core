-- Iris Nova - criacao minima de estado_conversa no banco operacional
-- legado (udizowyfjnhuhgxkeayk).
--
-- Projeto-alvo: udizowyfjnhuhgxkeayk (banco operacional real). PROIBIDO
-- aplicar em bcmuqautblvjdqzhjfbw (ambiente isolado de desenvolvimento/
-- testes da Iris Nova) ou em qualquer outro projeto. Mesma pasta separada
-- (migrations-legado/) das duas migrations irmas (clinicas e pacientes),
-- pelo mesmo motivo de sempre: evitar mistura com a convencao de
-- src/supabase/migrations/, que tem bcmuqautblvjdqzhjfbw como alvo.
--
-- Origem: com clinicas/pacientes ja compativeis (migrations anteriores),
-- o teste ao vivo do endpoint ainda dava 500. Rastreei: identificacao.ts
-- e aplicar-dados.ts do Core dependem de `estado_conversa`, que nao existe
-- neste projeto -- confirmado via information_schema.tables (zero linhas).
--
-- Decisao de Gabriel (2026-08-04): NAO investigar nem adaptar os
-- mecanismos conversacionais proprios do legado (mensagens_fila,
-- acoes_pendentes, comandos_remarcacao, conversas_manuais, outbox) -- sao
-- outro modelo (fila/staging/outbox), nao a maquina de estados de 6
-- valores que o Core exige. Criar a tabela propria da Iris Nova, com a
-- definicao EXATA ja usada e testada em bcmuqautblvjdqzhjfbw (802 testes
-- do Core passam contra este contrato), em vez de reinventar ou adaptar.
--
-- DEFINICAO AUDITADA (fonte: src/supabase/migrations/
-- 20260729_iris_nova_identificacao_v1.sql + 20260729_..._correcao.sql,
-- aplicadas e revisadas pelo Codex em bcmuqautblvjdqzhjfbw -- conferida
-- ao vivo via list_tables nesse projeto em 2026-08-04, identica ao que
-- as duas migrations descrevem). Reproduzida aqui palavra por palavra,
-- sem nenhuma coluna extra:
--   id, clinica_id, paciente_id (nullable), telefone_normalizado, estado,
--   dados jsonb, criado_em, atualizado_em; check de formato de telefone
--   (mesmo regex ja usado nas migrations anteriores desta pasta); check
--   dos 6 estados fechados; unique (clinica_id, telefone_normalizado) --
--   um unico estado oficial ativo por conversa; FK composta (paciente_id,
--   clinica_id, telefone_normalizado) -> pacientes (id, clinica_id,
--   telefone_normalizado) -- correcao do Codex original: garante que um
--   estado nunca associe o paciente certo da clinica certa com um
--   telefone errado.
--
-- FORA DE ESCOPO nesta migration (decisao explicita de Gabriel): P4
-- completo, outbox, replay, continuations ou qualquer estrutura futura;
-- mensagens_recebidas (deduplicacao de mensagem -- nenhum dos 3 modulos
-- do Core testados ate agora, toca nela); qualquer mudanca no Core;
-- qualquer adaptacao de mensagens_fila/acoes_pendentes/comandos_
-- remarcacao/conversas_manuais.
--
-- ESCOPO -- 1 tabela nova (estado_conversa) + 1 constraint aditiva em
-- pacientes (unique composta, exigida pela FK acima -- Postgres exige que
-- o alvo de uma FK composta tenha unique/PK exatamente sobre essas
-- colunas; pacientes.id ja e globalmente unico via PK, entao esta
-- constraint e trivialmente satisfeita, sem risco de colisao):
--
--   pacientes_id_clinica_telefone_key: unique (id, clinica_id,
--   telefone_normalizado) -- mesmo nome e mesma forma da constraint
--   equivalente em bcmuqautblvjdqzhjfbw.
--
-- PREFLIGHT (read-only, 2026-08-04, sobre udizowyfjnhuhgxkeayk):
-- `estado_conversa` nao existe (confirmado via information_schema.tables).
-- `pacientes` tem `id` (PK), `clinica_id`, `telefone_normalizado` (criada
-- na migration irma 20260804204134, ja aplicada) -- nenhuma constraint
-- (id, clinica_id, telefone_normalizado) existe ainda.
--
-- REEXECUTAR O PREFLIGHT imediatamente antes de aplicar. Nenhum CREATE de
-- tabela usa IF NOT EXISTS: colisao de nome falha explicitamente em vez
-- de ser ignorada em silencio.
--
-- APLICADA em udizowyfjnhuhgxkeayk em 2026-08-04, verificada e testada
-- (ponta a ponta, via WhatsApp) no mesmo dia. Nao aplicada em nenhum outro
-- projeto.

alter table pacientes
  add constraint pacientes_id_clinica_telefone_key unique (id, clinica_id, telefone_normalizado);

create table estado_conversa (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas(id),
  paciente_id uuid,
  telefone_normalizado text not null,
  estado text not null,
  dados jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint estado_conversa_telefone_formato check (telefone_normalizado ~ '^55[0-9]{10,11}$'),
  constraint estado_conversa_estado_valido check (
    estado in (
      'atendimento',
      'aguardando_escolha',
      'coletando_cadastro',
      'aguardando_confirmacao',
      'executando',
      'concluido'
    )
  ),
  constraint estado_conversa_clinica_telefone_key unique (clinica_id, telefone_normalizado),
  constraint estado_conversa_paciente_clinica_telefone_fk
    foreign key (paciente_id, clinica_id, telefone_normalizado)
    references pacientes (id, clinica_id, telefone_normalizado)
);

-- RLS ativa, sem policies: somente credencial de servidor (service_role,
-- que ignora RLS) acessa. Mesmo padrao exato da migration original.
alter table estado_conversa enable row level security;
revoke all privileges on table estado_conversa from anon, authenticated;
