-- Ambiente LOCAL DESCARTAVEL -- passo 2: as tres tabelas de que a migration de
-- pos-consulta depende (`clinicas`, `pacientes`, `agendamentos`).
--
-- ATENCAO -- ISTO E UMA RECONSTRUCAO, NAO O SCHEMA OPERACIONAL REAL:
--   * colunas, tipos e nulabilidade vem de
--     portal-iris-principal/src/lib/database.types.ts (tipos GERADOS do banco
--     operacional) -- Row/Insert de cada tabela;
--   * as duas colunas GERADAS vem de migrations-legado/
--     20260804202732_..._clinicas_legado.sql e
--     20260804204134_..._pacientes_legado.sql (aplicadas no operacional);
--   * defaults, FKs e constraints que os tipos gerados NAO expressam foram
--     ASSUMIDOS (marcados "ASSUMIDO" abaixo). Um "passou" contra este schema
--     prova a logica da migration e dos grants -- NAO prova compatibilidade
--     com o operacional; isso continua exigindo o PREFLIGHT read-only descrito
--     no cabecalho da migration, contra o banco real, com autorizacao.
--
-- FATOS DESCOBERTOS AO RECONSTRUIR (mudam premissas de rodadas anteriores):
--   1. `clinicas.instancia_whatsapp` e GERADA (= `whatsapp_instancia`): nao da
--      para gravar valores diferentes nas duas. No operacional elas sao SEMPRE
--      iguais.
--   2. `pacientes.telefone_normalizado` e GERADA ('55' || telefone): fixtures
--      devem gravar `telefone` (sem o 55), nunca `telefone_normalizado`.

create table public.clinicas (
  id                   uuid primary key default gen_random_uuid(),
  anamnese_override    jsonb,
  assistentes          jsonb not null default '[]'::jsonb,            -- ASSUMIDO: default
  ativo                boolean default true,                          -- ASSUMIDO: default
  automatizacoes       jsonb,
  bairro               text,
  cep                  text,
  cidade               text,
  config_financeiro    jsonb not null default '{}'::jsonb,            -- ASSUMIDO: default
  criado_em            timestamptz default now(),
  dentistas            jsonb,
  email                text not null,
  email_clinica        text,
  endereco             text,
  estado               text,
  estado_implantacao   text,
  expira_em            timestamptz,
  fuso_horario         text,
  horario_funcionamento jsonb,
  idioma               text,
  lead_origem          text,
  maps_link            text,
  max_dentistas        integer,
  nome                 text not null,
  nome_agente          text,
  observacoes          text,
  pais                 text,
  pais_codigo          text,
  personalidade        text,
  plano                text,
  precios              jsonb,
  primeiro_acesso      boolean,
  produto              text not null default 'iris',                  -- ASSUMIDO: default
  provider             text not null default 'evolution',             -- migrations-legado (confirmado)
  referencia           text,
  responsavel          text,
  sala                 text,
  senha_hash           text,
  slug                 text not null,
  telefone             text,
  telefone_agente      text,
  whatsapp_admin       text,
  whatsapp_instancia   text,
  whatsapp_status      text,
  -- migrations-legado (confirmado): coluna GERADA, sempre igual a whatsapp_instancia.
  instancia_whatsapp   text generated always as (whatsapp_instancia) stored
);

-- ASSUMIDO: `buscarClinica`/`resolverClinicaPorInstancia` usam .maybeSingle()
-- por (provider, instancia_whatsapp), o que so e seguro com unicidade.
create unique index clinicas_provider_instancia_key on public.clinicas (provider, instancia_whatsapp);

create table public.pacientes (
  id                     uuid primary key default gen_random_uuid(),
  anamnese               jsonb,
  atualizado_em          timestamptz,
  calendar_id            text,
  clinica_id             uuid not null references public.clinicas(id) on delete cascade,  -- ASSUMIDO: FK
  contato_id             text,
  criado_em              timestamptz default now(),
  data_nascimento        date,
  dentista_nome          text,
  documento              text,
  email                  text,
  nome                   text not null,
  observacoes            text,
  primeira_consulta      date,
  procedimento           text,
  responsavel            text,
  telefone               text,
  telefone_alterado_em   timestamptz,
  tipo_documento         text,
  total_consultas        integer,
  ultima_consulta        date,
  vinculo                text not null default 'proprio',             -- ASSUMIDO: default
  -- migrations-legado (confirmado): coluna GERADA.
  telefone_normalizado   text generated always as ('55' || telefone) stored,
  -- migrations-legado (confirmado).
  constraint pacientes_clinica_id_telefone_normalizado_key unique (clinica_id, telefone_normalizado)
);

create table public.agendamentos (
  id                     uuid primary key default gen_random_uuid(),
  atualizado_em          timestamptz,
  calendar_id            text,
  clinica_id             uuid references public.clinicas(id) on delete cascade,      -- ASSUMIDO: FK
  concluido_em           timestamptz,   -- existe nos tipos gerados do operacional (fecha a duvida B5 sobre o nome/existencia)
  criado_em              timestamptz default now(),
  data                   date,
  dentista_id            text,
  dentista_nome          text,
  documento              text,
  duracao_min            integer,
  event_id               text,
  gcal_cleanup_pendente  boolean not null default false,               -- ASSUMIDO: default
  horario                text,
  lembrete_24h_enviado   boolean,
  lembrete_2h_enviado    boolean,
  nome                   text,
  paciente_id            uuid references public.pacientes(id) on delete cascade,     -- ASSUMIDO: FK
  pos_consulta_enviado   boolean not null default false,               -- ASSUMIDO: default
  procedimento           text,
  procedimento_id        text,
  remarcado_de           text,
  status                 text,
  telefone               text,
  tipo_documento         text
);
