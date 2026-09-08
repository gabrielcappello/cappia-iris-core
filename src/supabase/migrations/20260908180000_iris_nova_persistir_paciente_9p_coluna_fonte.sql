-- Iris Nova - correcao de cappia_persistir_paciente (9 params) para a coluna
-- FONTE real do telefone, no banco operacional udizowyfjnhuhgxkeayk.
--
-- Projeto-alvo: udizowyfjnhuhgxkeayk (banco operacional real, com painel e
-- WhatsApp ativo). MESMA classe de correcao da irma legada
-- 20260810182322_iris_nova_persistir_paciente_coluna_fonte_legado.sql, agora
-- para a assinatura de 9 params criada pela FASE A
-- (20260907120000_iris_nova_contato_multiplos_pacientes_v1_fase_a.sql).
--
-- ── CAUSA ────────────────────────────────────────────────────────────────
-- A RPC de 9 params foi escrita a partir da migration de DEV
-- (20260809120000_iris_nova_persistencia_paciente_v1.sql), cujo schema tem
-- `pacientes.telefone_normalizado` como coluna NORMAL gravavel. No
-- operacional udizowyfjnhuhgxkeayk o schema diverge exatamente ai:
--
--   dev  (bcmuqautblvjdqzhjfbw): pacientes.telefone_normalizado e coluna
--                               normal, gravavel. Nao existe `telefone`.
--   aqui (udizowyfjnhuhgxkeayk): pacientes.telefone e a coluna FONTE, e
--                               telefone_normalizado e
--                               GENERATED ALWAYS AS ('55' || telefone) STORED.
--
-- Escrever direto numa coluna GENERATED ALWAYS e proibido pelo PostgreSQL
-- (SQLSTATE 428C9). O validador de plpgsql confere apenas SINTAXE -- nao
-- resolve colunas contra o catalogo. A FASE A aplicou limpa; o defeito so
-- apareceu na primeira execucao real (INSERT sintetico durante a validacao
-- A->B->C em 2026-09-08). Nenhum paciente novo tinha sido persistido pela
-- RPC de 9 params ainda.
--
-- ── O QUE ESTA MIGRATION FAZ ─────────────────────────────────────────────
-- Somente CREATE OR REPLACE do corpo da funcao de 9 params. NAO altera
-- coluna, tabela, constraint, indice, RLS, grant, nem dado nenhum.
-- Assinatura IDENTICA a da FASE A -> o OID e preservado e as ACLs existentes
-- (postgres, service_role) permanecem. Os REVOKE/GRANT ao final sao
-- reafirmacao idempotente.
--
-- NAO edita retroativamente a FASE A nem a FASE C: as duas ja foram
-- aplicadas e conteudo aplicado nunca muda retroativamente
-- (docs/04-decisoes-canonicas.md, DA-P4-03, regra 5).
--
-- ── TRADUCAO NO LIMITE DA PERSISTENCIA (reutiliza 20260810182322) ─────────
-- Identica a irma legada:
--   1. valida o formato canonico do telefone_normalizado
--      ('^55[0-9]{10,11}$'); fora dele e INVARIANTE DO CORE violada, nao
--      situacao do paciente -> RAISE com errcode check_violation (falha
--      fechado, vira ErroRpcTecnico no adaptador), nunca motivo
--      conversacional novo;
--   2. v_telefone_bruto := substr(v_telefone, 3) -- inversao EXATA de
--      GENERATED ALWAYS AS ('55' || telefone). Os dois primeiros caracteres
--      do valor gerado sao sempre literalmente '55', inclusive para DDD 55
--      (telefone='5599123456' -> '555599123456' -> substr(.,3)='5599123456');
--   3. grava a coluna FONTE `telefone`; o PostgreSQL deriva
--      telefone_normalizado sozinho.
--
-- ── O QUE ESTA MIGRATION *NAO* FAZ (e por que -- ver bloco final) ─────────
-- NAO remove o indice UNIQUE `pacientes_clinica_telefone_unique` sobre
-- (clinica_id, telefone). A leitura de producao (2026-09-08) confirmou que:
--   - ele EXISTE (indice bare, sem constraint associada -- por isso a FASE C,
--     que so dropava constraints por nome, nao o alcancou);
--   - ele CONFLITA com o modelo aprovado: titular e dependente do mesmo
--     contato compartilham o mesmo `telefone`, entao o 2o INSERT viola este
--     indice;
--   - MAS `cappia_confirmar_acao_pendente` (pipeline legado, ainda presente
--     no banco) faz `INSERT ... ON CONFLICT (clinica_id, telefone) DO UPDATE`,
--     que INFERE pelo par de colunas e depende deste indice. Apos a FASE C
--     ele e o UNICO indice que satisfaz esse par.
-- Remover o indice aqui quebraria aquela RPC legada (ON CONFLICT sem indice
-- inferivel -> SQLSTATE 42P10). Essa decisao (remover o indice + tratar
-- `cappia_confirmar_acao_pendente`, ou confirmar que ela esta morta) esta
-- FORA do escopo desta correcao pontual e precisa de decisao explicita +
-- revisao do Codex. Ver o bloco "DECISAO PENDENTE" no rodape.

create or replace function public.cappia_persistir_paciente(
  p_clinica_id           uuid,
  p_contato_id           uuid,
  p_telefone_normalizado text,
  p_nome                 text,
  p_vinculo              text default 'titular',
  p_paciente_id          uuid default null,
  p_documento            text default null,
  p_data_nascimento      date default null,
  p_email                text default null
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_telefone       text;
  v_telefone_bruto text;
  v_nome           text;
  v_vinculo        text;
  v_paciente_id    uuid;
  v_constraint     text;
begin
  if p_clinica_id is null then
    return jsonb_build_object('sucesso', false, 'motivo', 'clinica_id_ausente');
  end if;

  if p_contato_id is null then
    return jsonb_build_object('sucesso', false, 'motivo', 'contato_id_ausente');
  end if;

  v_telefone := btrim(coalesce(p_telefone_normalizado, ''));
  if v_telefone = '' then
    return jsonb_build_object('sucesso', false, 'motivo', 'telefone_normalizado_ausente');
  end if;

  -- ── TRADUCAO NO LIMITE DA PERSISTENCIA (identica a 20260810182322) ────
  -- Formato canonico aprovado (src/core/telefone.ts, regex identica):
  -- prefixo 55 + 10 ou 11 digitos nacionais. Chegar aqui fora desse formato
  -- e INVARIANTE DO CORE violada (identificacao.ts ja reprovou qualquer
  -- outra forma). RAISE -> falha fechado -> ErroRpcTecnico no adaptador;
  -- NUNCA um motivo conversacional novo.
  if v_telefone !~ '^55[0-9]{10,11}$' then
    raise exception 'telefone_normalizado fora do formato canonico'
      using errcode = 'check_violation';
  end if;

  -- telefone_normalizado e GENERATED ALWAYS AS ('55' || telefone) NESTE
  -- banco. A inversao e EXATA por construcao: os dois primeiros caracteres
  -- do valor gerado sao sempre literalmente '55'. Vale inclusive para DDD 55
  -- (Santa Maria/RS): telefone='5599123456' gera '555599123456', e substr a
  -- partir do 3 devolve o original.
  v_telefone_bruto := substr(v_telefone, 3);

  -- nome exigido em TODA chamada, criacao ou atualizacao (decisao do Gabriel
  -- 2026-08-09 -- inalterada).
  v_nome := btrim(coalesce(p_nome, ''));
  if v_nome = '' then
    return jsonb_build_object('sucesso', false, 'motivo', 'nome_ausente');
  end if;

  v_vinculo := btrim(coalesce(p_vinculo, ''));
  if v_vinculo not in ('titular', 'dependente') then
    return jsonb_build_object('sucesso', false, 'motivo', 'vinculo_invalido');
  end if;

  if p_paciente_id is not null then
    -- ATUALIZACAO de paciente ja selecionado. Nunca por telefone: a chave e
    -- (id, contato_id). Um paciente_id que nao pertenca a este contato nao e
    -- atualizado (0 linhas -> paciente_nao_encontrado). O telefone NAO e
    -- tocado aqui (troca de telefone e cappia_trocar_telefone_paciente).
    update public.pacientes
      set nome            = v_nome,
          documento       = coalesce(nullif(btrim(p_documento), ''), documento),
          data_nascimento = coalesce(p_data_nascimento, data_nascimento),
          email           = coalesce(nullif(btrim(p_email), ''), email)
    where id = p_paciente_id
      and contato_id = p_contato_id
      and clinica_id = p_clinica_id
    returning id into v_paciente_id;

    if v_paciente_id is null then
      return jsonb_build_object('sucesso', false, 'motivo', 'paciente_nao_encontrado');
    end if;

    return jsonb_build_object('sucesso', true, 'paciente_id', v_paciente_id);
  end if;

  -- CRIACAO de paciente novo, vinculado a p_contato_id. Sem ON CONFLICT por
  -- telefone -- a identidade e (contato_id, ...), nunca o telefone.
  -- Grava a coluna FONTE `telefone`; o PostgreSQL deriva telefone_normalizado.
  --
  -- NOTA (janela ate a decisao pendente do rodape): enquanto o indice
  -- `pacientes_clinica_telefone_unique` sobre (clinica_id, telefone) existir,
  -- um INSERT aqui com um telefone JA usado por outro paciente da mesma
  -- clinica lanca unique_violation. O bloco exception abaixo traduz
  -- `pacientes_clinica_id_documento_key` (CPF) e re-lanca o resto -- inclusive
  -- essa colisao de telefone, que sobe como erro tecnico ate a decisao sobre
  -- o indice legado ser tomada.
  insert into public.pacientes
    (clinica_id, contato_id, telefone, nome, vinculo, documento, data_nascimento, email)
  values (
    p_clinica_id,
    p_contato_id,
    v_telefone_bruto,
    v_nome,
    v_vinculo,
    nullif(btrim(p_documento), ''),
    p_data_nascimento,
    nullif(btrim(p_email), '')
  )
  returning id into v_paciente_id;

  return jsonb_build_object('sucesso', true, 'paciente_id', v_paciente_id);

exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'pacientes_clinica_id_documento_key' then
      return jsonb_build_object('sucesso', false, 'motivo', 'cpf_ja_cadastrado');
    end if;
    raise;
end;
$function$;

-- Reafirmacao idempotente das ACLs ja vigentes (postgres=X, service_role=X).
-- CREATE OR REPLACE preserva o OID e portanto as ACLs; estes comandos existem
-- para deixar o estado desejado explicito, nunca para conceder acesso novo.
revoke all on function public.cappia_persistir_paciente(uuid, uuid, text, text, text, uuid, text, date, text) from public;
revoke all on function public.cappia_persistir_paciente(uuid, uuid, text, text, text, uuid, text, date, text) from anon;
revoke all on function public.cappia_persistir_paciente(uuid, uuid, text, text, text, uuid, text, date, text) from authenticated;
grant execute on function public.cappia_persistir_paciente(uuid, uuid, text, text, text, uuid, text, date, text) to service_role;

-- ── DECISAO PENDENTE (revisao do Codex): indice pacientes_clinica_telefone_unique
--
-- Estado de producao lido em 2026-09-08, apos as FASES A e C:
--   CREATE UNIQUE INDEX pacientes_clinica_telefone_unique
--     ON public.pacientes USING btree (clinica_id, telefone);
--   -- indice BARE (sem constraint associada); a FASE C nao o removeu.
--
-- Conflito: titular e dependente do MESMO contato compartilham o mesmo
-- `telefone`. Com este indice, o 2o INSERT (o dependente) viola a unicidade
-- (clinica_id, telefone) -- a feature aprovada nao funciona.
--
-- Bloqueio para remove-lo agora: `cappia_confirmar_acao_pendente` (pipeline
-- legado, ainda presente) faz `INSERT INTO pacientes (...) ON CONFLICT
-- (clinica_id, telefone) DO UPDATE`, que INFERE pelo par de colunas. Apos a
-- FASE C este e o unico indice que satisfaz esse par. Dropar o indice sem
-- tratar aquela RPC a quebra (SQLSTATE 42P10). As tabelas do pipeline
-- (acoes_pendentes, acoes_outbox) estao VAZIAS -- nenhuma atividade
-- registrada --, mas isso nao prova que o fluxo esta desligado.
--
-- Opcoes para a proxima decisao (fora do escopo desta correcao pontual):
--   (a) DROP INDEX pacientes_clinica_telefone_unique + reescrever o ON
--       CONFLICT de cappia_confirmar_acao_pendente para
--       (clinica_id, telefone_normalizado) OU para nao usar ON CONFLICT;
--   (b) confirmar com o Gabriel que o pipeline legado (n8n/acoes_pendentes)
--       esta desativado e entao so DROP INDEX;
--   (c) manter o indice e aceitar que "dependente no mesmo numero" continua
--       bloqueado ate a decisao (a) ou (b) -- estado atual apos esta migration.
--
-- Esta migration NAO toca o indice. A correcao aqui e SO a coluna-fonte.
