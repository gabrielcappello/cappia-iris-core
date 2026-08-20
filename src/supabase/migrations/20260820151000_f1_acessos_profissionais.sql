-- F1 — token de acesso de uso único, guardado como hash
-- specs/acesso-dentista-secretaria.md, fase F1
--
-- ── POR QUE ─────────────────────────────────────────────────────────────
-- Hoje o QR Code do dentista carrega a SENHA dele na URL
-- (`src/app/dashboard/page.tsx:1445` — `?t=${d.senha}`), e ela é
-- reutilizável: uma foto da tela vira acesso permanente ao prontuário.
--
-- Esta tabela substitui esse mecanismo por um token que:
--   - é gerado pelo sistema (32 bytes aleatórios), não digitado;
--   - é guardado SÓ como sha256 — quem lê o banco não consegue entrar;
--   - vale UMA vez, com consumo garantido pelo banco;
--   - pode ser revogado, derrubando inclusive sessões já emitidas.
--
-- ── UMA LINHA POR PROFISSIONAL (não por token) ──────────────────────────
-- Correção de uma versão anterior desta migration, que modelava uma linha
-- por token emitido. Aquele desenho acumulava linhas consumidas por
-- profissional e tornava AMBÍGUO qual `sessao_valida_desde` controla a
-- sessão — a mais recente? a última usada? Ambiguidade nesse campo quebra a
-- revogação de F2, que é justamente o que ele existe para garantir.
--
-- Com uma linha por profissional (`unique (clinica_id, perfil,
-- profissional_id)`), gerar um QR novo SUBSTITUI o token na mesma linha:
-- o anterior deixa de existir, e há exatamente um `sessao_valida_desde` por
-- profissional. Sem histórico, sem ambiguidade, sem índice parcial.
--
-- ── POR QUE TABELA PRÓPRIA, E NÃO DENTRO DO JSONB ───────────────────────
-- Decisão do Gabriel, 2026-08-20. `clinicas.dentistas` é um array jsonb, e
-- um `update ... where usado_em is null` dentro de um array exige reescrever
-- o array inteiro sob lock da linha da clínica: dois profissionais da mesma
-- clínica entrando ao mesmo tempo serializariam na mesma linha, com SQL
-- consideravelmente mais complexo. A garantia de uso único é a razão de ser
-- desta fase — ela não pode depender de SQL difícil de auditar.
--
-- ── O QUE NÃO FAZ ───────────────────────────────────────────────────────
-- Não toca em `clinicas`. Não remove `senha` nem `token_acesso` — isso é F6,
-- em duas etapas, e só depois dos critérios verificáveis de observação.
-- Enquanto F6a não rodar, o mecanismo antigo continua funcionando.
--
-- ── SEM `if not exists` ─────────────────────────────────────────────────
-- Deliberado. Se já existir um objeto com este nome, esta migration deve
-- FALHAR — aceitar silenciosamente uma estrutura desconhecida é pior que
-- parar: a aplicação passaria a escrever numa tabela que ninguém revisou.

create table public.acessos_profissionais (
  id                  uuid primary key default gen_random_uuid(),
  clinica_id          uuid not null references public.clinicas(id) on delete cascade,

  -- 'dentista' | 'assistente'. Mesmo mecanismo para os dois perfis, sem
  -- caminhos paralelos (spec, princípio de F2).
  perfil              text not null check (perfil in ('dentista', 'assistente')),

  -- `id` de dentro do array jsonb -- ESTÁVEL, nunca a posição. É o defeito
  -- que F2a fechou: posição muda quando alguém sai do meio da lista.
  profissional_id     uuid not null,

  -- sha256(token) em hex minúsculo, 64 caracteres. O token em claro existe
  -- UMA vez, na resposta que gera o QR, e nunca é persistido.
  -- O CHECK impede que um bug grave aqui o token em claro: um valor de 32
  -- bytes em base64url tem 43 caracteres e não casa com este formato.
  token_hash          text not null
                        check (token_hash ~ '^[0-9a-f]{64}$'),

  criado_em           timestamptz not null default now(),

  -- null = ainda não consumido. É o predicado do consumo atômico.
  usado_em            timestamptz,

  -- Revogação com efeito sobre sessões JÁ EMITIDAS: o cookie carrega seu
  -- `emitido_em`, e `resolverContexto` recusa cookie anterior a este marco.
  -- Sem isto, revogar o QR não derruba quem já entrou (bloqueador nº 5).
  -- Uma linha por profissional => um valor inequívoco por profissional.
  -- Escrito SOMENTE na revogação explícita -- nunca no consumo do token.
  sessao_valida_desde timestamptz,

  -- Revogação explícita do token, separada da revogação de sessão.
  revogado_em         timestamptz,

  -- UMA linha por profissional. Gerar QR novo faz `on conflict do update`
  -- nesta chave: o token anterior é substituído e deixa de valer.
  constraint acessos_profissionais_prof_uniq
    unique (clinica_id, perfil, profissional_id)
);

comment on table public.acessos_profissionais is
  'F1 — acesso de dentista/assistente por token de uso unico. Uma linha por profissional: gerar QR novo substitui o token na mesma linha. O token em claro nunca e persistido, so sha256. Ver specs/acesso-dentista-secretaria.md.';

-- Consulta quente: achar o profissional pelo hash no momento do consumo.
-- Único também, porque dois profissionais nunca compartilham token.
create unique index acessos_profissionais_token_hash_uniq
  on public.acessos_profissionais (token_hash);

-- ── SEGURANÇA ───────────────────────────────────────────────────────────
-- RLS ligado E com política: `service_role` bypassa RLS por definição, então
-- o servidor continua funcionando; qualquer outro papel não enxerga nada.
--
-- Diferente das 22 tabelas com RLS ligado e NENHUMA política (registradas
-- como bloqueador em ESTADO.md §5): ali a proteção é acidental — vem de o
-- painel usar service_role, não de uma regra. Aqui é explícita.
alter table public.acessos_profissionais enable row level security;

create policy acessos_profissionais_sem_acesso_publico
  on public.acessos_profissionais
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- `revoke` explícito. Lição registrada em specs/seguranca-rpcs-publicas.md:
-- `grant to service_role` NÃO restringe -- só adiciona. Sem o revoke, o
-- padrão do Postgres deixa aberto.
revoke all on table public.acessos_profissionais from public, anon, authenticated;
grant select, insert, update on table public.acessos_profissionais to service_role;

-- ── EMITIR UM QR (referência; executado pela aplicação) ─────────────────
--
--   insert into public.acessos_profissionais
--     (clinica_id, perfil, profissional_id, token_hash)
--   values ($1, $2, $3, $4)
--   on conflict (clinica_id, perfil, profissional_id) do update
--     set token_hash  = excluded.token_hash,
--         criado_em   = now(),
--         usado_em    = null,
--         revogado_em = null;
--
-- O token anterior é substituído: um QR novo invalida o antigo.
-- `sessao_valida_desde` NÃO é tocado aqui — emitir um QR não derruba a
-- sessão de quem já está usando o aparelho atual. Derrubar é revogar,
-- operação separada e explícita.
--
-- ── CONSUMIR (referência) ───────────────────────────────────────────────
--
--   update public.acessos_profissionais
--      set usado_em = now()
--    where token_hash = $1
--      and usado_em is null
--      and revogado_em is null
--   returning clinica_id, perfil, profissional_id;
--
-- Uma instrução. A primeira requisição recebe a linha; a segunda recebe zero
-- e é recusada. Validar e depois marcar, em passos separados, deixaria dois
-- pedidos simultâneos passarem -- era o bloqueador nº 3.
--
-- `sessao_valida_desde` NAO e tocado aqui. Grava-lo no consumo faria cada
-- login novo derrubar a sessao anterior do proprio profissional -- trocar de
-- aparelho, ou reler o QR, invalidaria o acesso em uso sem ninguem ter
-- revogado nada. Este campo muda SO na revogacao explicita.
--
-- ── REVOGAR (referência) ────────────────────────────────────────────────
--
--   update public.acessos_profissionais
--      set revogado_em = now(),
--          sessao_valida_desde = now()   -- derruba sessões já emitidas
--    where clinica_id = $1 and perfil = $2 and profissional_id = $3;
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────
-- Aditivo: nada existente foi alterado. Para desfazer:
--   drop table public.acessos_profissionais;
-- Nenhum dado de outro lugar depende dela nesta fase.
