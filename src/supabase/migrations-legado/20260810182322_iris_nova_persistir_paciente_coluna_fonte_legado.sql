-- Iris Nova - correcao de cappia_persistir_paciente para a coluna fonte real
-- do telefone (banco operacional legado, udizowyfjnhuhgxkeayk).
--
-- Projeto-alvo: udizowyfjnhuhgxkeayk (banco operacional real, com painel e
-- WhatsApp ativo). PROIBIDO aplicar em bcmuqautblvjdqzhjfbw (ambiente
-- isolado de desenvolvimento e testes da Iris Nova) ou em qualquer outro
-- projeto. Pasta separada (migrations-legado/) pelo mesmo motivo das
-- migrations irmas anteriores.
--
-- Base normativa: decisoes fechadas pelo Gabriel em 2026-08-10 (ETAPA 1 --
-- corrigir somente cappia_persistir_paciente no operacional). Contrato de
-- paciente: specs/persistencia-v1.md secao 5. Vocabulario tipado de erro:
-- specs/cadastro-conversacional-v1.md secao 9.
--
-- ── CAUSA ────────────────────────────────────────────────────────────────
-- 20260809120000_iris_nova_persistencia_paciente_v1_legado.sql criou esta
-- funcao com corpo IDENTICO ao da migration irma do dev. Mas os esquemas
-- fisicos divergem exatamente na coluna que a funcao escreve:
--
--   dev  (bcmuqautblvjdqzhjfbw): pacientes.telefone_normalizado e coluna
--                               normal, gravavel. Nao existe `telefone`.
--   aqui (udizowyfjnhuhgxkeayk): pacientes.telefone e a coluna FONTE, e
--                               telefone_normalizado e
--                               GENERATED ALWAYS AS ('55' || telefone) STORED.
--
-- Escrever direto numa coluna GENERATED ALWAYS e proibido pelo PostgreSQL
-- (SQLSTATE 428C9). O validador de plpgsql confere apenas SINTAXE -- nao
-- resolve colunas contra o catalogo --, entao a migration anterior aplicou
-- limpa nos dois bancos e o defeito so existia na primeira execucao real.
-- Nenhum paciente novo tinha sido persistido no operacional ainda, e os
-- testes deterministicos usam duble de RPC, logo nao podiam pegar isto.
--
-- ── O QUE ESTA MIGRATION FAZ ─────────────────────────────────────────────
-- Somente CREATE OR REPLACE do corpo da funcao. NAO altera coluna, tabela,
-- constraint, indice, RLS, grant, nem dado nenhum. Assinatura identica, logo
-- o OID e preservado e as ACLs existentes (postgres, service_role)
-- permanecem -- os GRANT/REVOKE ao final sao reafirmacao idempotente.
--
-- O CONTRATO DE RETORNO NAO MUDA EM NENHUM CARACTERE: o vocabulario fechado
-- continua sendo exatamente clinica_id_ausente / telefone_normalizado_ausente
-- / nome_ausente / cpf_ja_cadastrado. Por isso src/core/persistir-paciente.ts
-- nao e tocado, e o Core continua falando telefone_normalizado de ponta a
-- ponta. A traducao para a coluna fonte existe num unico ponto do sistema:
-- dentro desta funcao.
--
-- NAO edita retroativamente 20260809120000_..._legado.sql: aquele arquivo ja
-- foi aplicado e conteudo aplicado nunca muda retroativamente
-- (docs/04-decisoes-canonicas.md, DA-P4-03, regra 5).
--
-- O dev fica INTOCADO por decisao explicita do Gabriel em 2026-08-10: a
-- paridade exigida e de comportamento de produto para entradas validas, nao
-- identidade fisica de schema nem simetria de invariante inalcancavel.

create or replace function public.cappia_persistir_paciente(
  p_clinica_id         uuid,
  p_telefone_normalizado text,
  p_nome               text,
  p_documento          text default null,
  p_data_nascimento    date default null,
  p_email              text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_telefone       text;
  v_telefone_bruto text;
  v_nome           text;
  v_paciente_id    uuid;
  v_constraint     text;
begin
  if p_clinica_id is null then
    return jsonb_build_object('sucesso', false, 'motivo', 'clinica_id_ausente');
  end if;

  v_telefone := btrim(coalesce(p_telefone_normalizado, ''));
  if v_telefone = '' then
    return jsonb_build_object('sucesso', false, 'motivo', 'telefone_normalizado_ausente');
  end if;

  -- ── TRADUCAO NO LIMITE DA PERSISTENCIA ────────────────────────────────
  -- Formato canonico aprovado (src/core/telefone.ts, regex identica):
  -- prefixo 55 + 10 ou 11 digitos nacionais. Chegar aqui fora desse formato
  -- e INVARIANTE DO CORE violada, nao situacao do paciente:
  -- telefoneNormalizadoValido ja reprovou qualquer outra forma em
  -- identificacao.ts, e e o mesmo valor que atravessa ate esta chamada sem
  -- reatribuicao. Por isso RAISE (falha fechado, vira ErroRpcTecnico no
  -- adaptador) e NUNCA um motivo conversacional novo -- mesma disciplina ja
  -- fechada em specs/cadastro-conversacional-v1.md secao 9.
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

  -- nome e exigido em TODA chamada, criacao ou atualizacao. O Core chama com
  -- o estado cadastral atual conhecido, nao apenas com o campo digitado no
  -- turno -- decisao do Gabriel em 2026-08-09, que evita subconsulta interna,
  -- corrida especial e distincao criacao/atualizacao dentro da funcao.
  v_nome := btrim(coalesce(p_nome, ''));
  if v_nome = '' then
    return jsonb_build_object('sucesso', false, 'motivo', 'nome_ausente');
  end if;

  -- Grava a coluna FONTE; o PostgreSQL deriva telefone_normalizado sozinho.
  insert into pacientes
    (clinica_id, telefone, nome, documento, data_nascimento, email)
  values (
    p_clinica_id,
    v_telefone_bruto,
    v_nome,
    nullif(btrim(p_documento), ''),
    p_data_nascimento,
    nullif(btrim(p_email), '')
  )
  -- Arbitra por (clinica_id, telefone_normalizado) -- a constraint que NOS
  -- criamos (20260804204134) e da qual o .maybeSingle() do Core depende --,
  -- e nao pela legada pacientes_clinica_telefone_unique, documentada como
  -- "nao tocar". Como telefone_normalizado e funcao bijetiva de telefone, as
  -- duas conflitam sempre juntas: arbitrar por uma nunca deixa a outra
  -- disparar unique_violation, porque o caminho DO UPDATE atualiza a propria
  -- linha dona daqueles valores. Inferencia sobre coluna gerada confirmada
  -- por EXPLAIN antes desta migration (arbiter resolvido para
  -- pacientes_clinica_id_telefone_normalizado_key).
  on conflict (clinica_id, telefone_normalizado) do update
    -- nome sobrescreve porque e sempre enviado; os demais usam coalesce para
    -- que campo ausente NUNCA apague valor ja existente. A assimetria e
    -- deliberada e decorre da regra acima. Nenhum telefone e tocado aqui: a
    -- linha em conflito ja tem o telefone certo, que e a propria chave.
    set nome            = excluded.nome,
        documento       = coalesce(excluded.documento, pacientes.documento),
        data_nascimento = coalesce(excluded.data_nascimento, pacientes.data_nascimento),
        email           = coalesce(excluded.email, pacientes.email)
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
$$;

-- Reafirmacao idempotente das ACLs ja vigentes antes desta migration
-- (postgres=X, service_role=X). CREATE OR REPLACE preserva o OID e portanto
-- as ACLs; estes comandos existem para deixar o estado desejado explicito no
-- arquivo, nunca para conceder acesso novo.
revoke all on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) from public;
revoke all on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) from anon;
revoke all on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) from authenticated;
grant execute on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) to service_role;
