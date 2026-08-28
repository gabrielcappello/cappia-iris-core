-- Contatos que a Iris não responde (specs/contatos-excecao-iris-v1.md)
--
-- Lista permanente, mantida pela clínica, de números de WhatsApp que a Iris
-- nunca responde automaticamente -- mesmo mecanismo de "conversa manual
-- assumida" (`conversas_manuais.ativo`), só que a origem da entrada é essa
-- lista em vez do clique em "Assumir conversa" dentro de um chat.
--
-- Decisão do Gabriel (2026-08-28): NÃO persiste `paciente_id`. Se o
-- telefone corresponder a um paciente já cadastrado, a tela do painel só
-- usa o nome encontrado para pré-preencher o formulário -- não grava
-- vínculo. Motivo: nenhum código depende desse vínculo hoje, e persistir
-- FK pra paciente criaria risco de vazamento entre clínicas se um dia essa
-- tabela for exposta por engano (mesmo cuidado já registrado em
-- `20260821200000_fecha_chat_manual.sql` para `conversas_manuais`).
--
-- `telefone_normalizado`: mesmo formato E.164 que `pacientes.telefone_normalizado`
-- já usa (função `normalizarTelefone` em `iris-portal-v2/src/lib/importacao-pacientes.ts`,
-- com o `pais_codigo` da clínica) -- consistência entre as duas tabelas,
-- não reinventa normalização nova.

create table public.contatos_excecao_iris (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references public.clinicas(id) on delete cascade,
  nome text not null,
  telefone_normalizado text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (clinica_id, telefone_normalizado),
  -- Nome não pode ser vazio/só espaço; telefone precisa ser um E.164 real
  -- (dígitos, sem zero à esquerda, 8 a 15 dígitos -- faixa do padrão E.164).
  -- Barra na origem o que a UI já impede (qualidade "movel" obrigatória),
  -- caso a rota seja chamada diretamente.
  check (btrim(nome) <> ''),
  check (telefone_normalizado ~ '^[1-9][0-9]{7,14}$')
);

create index contatos_excecao_iris_clinica_id_idx on public.contatos_excecao_iris (clinica_id);

-- RLS fechada por padrão (ausência de política já nega, ver raciocínio em
-- `20260821200000_fecha_chat_manual.sql`) -- só `service_role` (painel via
-- /api/secure, e o n8n quando a segunda checagem for integrada) acessa.
-- `revoke` explícito (não só ausência de grant) pelo mesmo motivo de
-- `20260821200000_fecha_chat_manual.sql`: fecha a porta mesmo que um
-- `grant` futuro distraído tente reabrir.
alter table public.contatos_excecao_iris enable row level security;
revoke all on table public.contatos_excecao_iris from public, anon, authenticated;
grant select, insert, update, delete on table public.contatos_excecao_iris to service_role;

-- ── ROLLBACK ────────────────────────────────────────────────────────────
-- drop table public.contatos_excecao_iris;
