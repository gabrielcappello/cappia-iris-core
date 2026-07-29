-- Iris Nova — schema minimo para a etapa 1 (Identificacao)
-- Projeto: cappia-iris-core-dev (bcmuqautblvjdqzhjfbw) — ambiente isolado, somente dev.
-- Cobre: clinica por provider+instancia, paciente por clinica+telefone,
-- estado unico da conversa, deduplicacao de mensagens recebidas.
-- Fora de escopo nesta migracao: cadastro completo, procedimentos, dentistas,
-- agenda, horarios, confirmacoes, agendamentos, outbox, IA, WhatsApp real.

create table clinicas (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  instancia_whatsapp text not null,
  criado_em timestamptz not null default now(),
  constraint clinicas_provider_instancia_key unique (provider, instancia_whatsapp)
);

create table pacientes (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas(id),
  telefone_normalizado text not null,
  criado_em timestamptz not null default now(),
  constraint pacientes_telefone_formato check (telefone_normalizado ~ '^[0-9]+$'),
  constraint pacientes_clinica_telefone_key unique (clinica_id, telefone_normalizado),
  -- necessario como alvo de FK composta a partir de estado_conversa (isolamento por clinica)
  constraint pacientes_id_clinica_key unique (id, clinica_id)
);

create table estado_conversa (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas(id),
  paciente_id uuid,
  telefone_normalizado text not null,
  estado text not null,
  dados jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint estado_conversa_telefone_formato check (telefone_normalizado ~ '^[0-9]+$'),
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
  -- um unico estado oficial ativo por conversa (clinica + telefone)
  constraint estado_conversa_clinica_telefone_key unique (clinica_id, telefone_normalizado),
  -- paciente_id, quando presente, precisa pertencer a mesma clinica do estado
  constraint estado_conversa_paciente_mesma_clinica_fk
    foreign key (paciente_id, clinica_id) references pacientes(id, clinica_id)
);

create table mensagens_recebidas (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  instancia_whatsapp text not null,
  message_id text not null,
  clinica_id uuid not null references clinicas(id),
  telefone_normalizado text not null,
  status_processamento text not null default 'recebida',
  recebido_em timestamptz not null default now(),
  concluido_em timestamptz,
  constraint mensagens_telefone_formato check (telefone_normalizado ~ '^[0-9]+$'),
  constraint mensagens_status_valido check (
    status_processamento in ('recebida', 'processando', 'concluida', 'falhou')
  ),
  -- deduplicacao tecnica da mensagem
  constraint mensagens_provider_instancia_message_key unique (provider, instancia_whatsapp, message_id)
);

-- RLS ativa, sem policies: somente credencial de servidor (service_role, que ignora RLS) acessa.
alter table clinicas enable row level security;
alter table pacientes enable row level security;
alter table estado_conversa enable row level security;
alter table mensagens_recebidas enable row level security;
