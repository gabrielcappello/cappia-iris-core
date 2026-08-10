-- Iris Nova - contrato e persistencia do paciente (banco operacional legado,
-- udizowyfjnhuhgxkeayk).
--
-- Projeto-alvo: udizowyfjnhuhgxkeayk (banco operacional real, com painel e
-- WhatsApp ativo). PROIBIDO aplicar em bcmuqautblvjdqzhjfbw (ambiente
-- isolado de desenvolvimento e testes da Iris Nova, que tem migration irma
-- propria em src/supabase/migrations/) ou em qualquer outro projeto. Pasta
-- separada (migrations-legado/) pelo mesmo motivo das migrations irmas
-- anteriores.
--
-- Base normativa: decisoes fechadas pelo Gabriel em 2026-08-09 (CONTRATO E
-- PERSISTENCIA DO PACIENTE, primeira subetapa de CADASTRO DE PACIENTE).
-- Regras de cadastro obrigatorio: specs/novo-agendamento.md secoes 12 e 23.
-- Contrato de paciente: specs/persistencia-v1.md secao 5.
--
-- DIVERGENCIA DELIBERADA de specs/persistencia-v1.md secao 8: aquela secao
-- previa criacao do paciente e do primeiro agendamento na MESMA transacao
-- operacional. Decisao do Gabriel em 2026-08-09 sobrepoe: o paciente e
-- persistido ANTES e SEPARADAMENTE, devolve paciente_id, e a reserva
-- (cappia_reservar_agendamento) continua sendo outra operacao. Registrado
-- aqui e no bloco de revisao da propria spec -- nunca reconciliado em
-- silencio.
--
-- ── DIFERENCA ESTRUTURAL EM RELACAO A MIGRATION IRMA ──────────────────────
-- Os dois esquemas divergiram antes desta etapa. Aqui `pacientes` ja tem
-- nome (NOT NULL), documento, data_nascimento e email -- entao esta
-- migration NAO adiciona coluna nenhuma. Em compensacao, `clinica_id` ainda
-- e nullable aqui (no dev ja e NOT NULL), e e isso que esta migration
-- corrige. O objetivo nao e igualar o historico de migrations dos dois
-- bancos, e sim que ao final ambos tenham o MESMO contrato de `pacientes`.
--
-- ── POR QUE UMA FUNCAO NOVA, E NAO REAPROVEITAR O LEGADO ──────────────────
-- Auditoria read-only de 2026-08-09 sobre este mesmo banco mapeou toda a
-- superficie que toca `pacientes`:
--   - cappia_confirmar_acao_pendente: UNICA funcao no banco que hoje escreve
--     em `pacientes`. Descartada por dois motivos independentes -- faz upsert
--     por `telefone` puro (nao `telefone_normalizado`, a unica coluna que o
--     Core novo usa para identificar paciente em identificacao.ts, entao o
--     paciente criado por ela ficaria invisivel ao Core), e roda na mesma
--     transacao que cria o agendamento (exatamente o acoplamento que a
--     decisao acima proibe);
--   - cappia_avancar_agendamento: so faz SELECT em `pacientes`;
--   - cappia_confirmar_criacao_canonica e cappia_remarcar_agendamento:
--     gravam nome/documento/telefone apenas como snapshot desnormalizado na
--     propria linha de `agendamentos`, nunca em `pacientes`;
--   - atualizar_anamnese: escreve so a coluna `anamnese`;
--   - nenhuma view depende de `pacientes` ou de `documento`.
-- Nenhuma delas e referenciada por src/core/*.ts -- pertencem a um pipeline
-- paralelo/legado. Esta migration NAO as altera, NAO as remove e NAO muda o
-- comportamento delas. Reaproveitado apenas o PADRAO SQL de upsert ja
-- provado ali (INSERT ... ON CONFLICT ... COALESCE), nunca a funcao.
--
-- ── CPF x DOCUMENTO ───────────────────────────────────────────────────────
-- No dominio novo existe somente o conceito `cpf`. No banco fisico a coluna
-- e `documento`. Decisao fechada: NAO renomear, NAO criar coluna `cpf`
-- paralela, NAO criar duas fontes de verdade. A traducao acontece em UM
-- unico limite: o parametro `p_documento` desta funcao. Renomear a coluna
-- seria especialmente perigoso NESTE banco: cappia_avancar_agendamento e
-- cappia_confirmar_acao_pendente amarram o nome `documento` em SQL e podem
-- ser chamadas de fora deste repositorio (n8n/Painel).
--
-- ── ESCOPO ────────────────────────────────────────────────────────────────
-- 1 coluna passa a NOT NULL, 1 constraint nova, 1 funcao nova. Nenhum dado
-- alterado, nenhuma coluna criada, removida ou renomeada, nenhuma mudanca de
-- RLS, nenhuma alteracao em funcao legada.
--
--   pacientes.clinica_id -> NOT NULL
--   constraint UNIQUE (clinica_id, documento)
--   function  cappia_persistir_paciente(...)
--
-- As colunas cadastrais opcionais permanecem nullable de proposito: a
-- obrigatoriedade pertence ao CONTROLADOR (Core), nunca a estrutura
-- (specs/persistencia-v1.md secao 5). Isso NAO afrouxa a regra de produto --
-- nome, CPF e data de nascimento continuam obrigatorios antes de concluir o
-- cadastro (specs/novo-agendamento.md secao 12); a tabela apenas nao duplica
-- essa regra.
--
-- UNIQUE (clinica_id, documento) sem indice parcial de proposito: em
-- constraint UNIQUE comum o PostgreSQL ja trata multiplos NULL como nao
-- conflitantes, entao "unico quando presente" sai de graca.
--
-- A UNIQUE de (clinica_id, telefone_normalizado) ja existe aqui sob o nome
-- `pacientes_clinica_id_telefone_normalizado_key` (no dev o mesmo par existe
-- sob outro nome). O ON CONFLICT da funcao infere pelo PAR DE COLUNAS, nunca
-- pelo nome da constraint, entao o MESMO corpo de funcao vale nos dois
-- projetos.
--
-- NAO tocar `pacientes_clinica_telefone_unique`, o indice unico legado sobre
-- (clinica_id, telefone) -- coluna `telefone` pura, usada pelo pipeline
-- antigo. Continua existindo e continua sustentando o ON CONFLICT de
-- cappia_confirmar_acao_pendente.
--
-- ── CONCORRENCIA ──────────────────────────────────────────────────────────
-- Inteiramente delegada as constraints do banco. Nenhum lock explicito,
-- nenhum SELECT previo, nenhum retry, nenhum mecanismo paralelo de
-- aplicacao. O ON CONFLICT (clinica_id, telefone_normalizado) e a unica
-- serializacao.
--
-- ── ERROS ─────────────────────────────────────────────────────────────────
-- Erros PREVISTOS pelo contrato sao retornados de forma tipada em `motivo`
-- (clinica_id_ausente, telefone_normalizado_ausente, nome_ausente,
-- cpf_ja_cadastrado). Qualquer unique_violation INESPERADA continua com
-- RAISE -- falha fechado, nunca e mascarada como cpf_ja_cadastrado.
--
-- `cpf_ja_cadastrado` e identificado deterministicamente pelo NOME da
-- constraint via GET STACKED DIAGNOSTICS, nunca por parsing de texto de
-- erro. A funcao NAO resolve o conflito: nao atualiza telefone, nao faz
-- SELECT para descobrir de quem e o CPF, nao decide nada. A conversa que
-- trata esse resultado e a proxima subetapa do cadastro
-- (specs/persistencia-v1.md secoes 6 e 7), fora de escopo aqui.
--
-- ── FORA DE ESCOPO ────────────────────────────────────────────────────────
-- Extracao cadastral pela IA; perguntas da Iris; fluxo conversacional;
-- protocolo de CPF em outro telefone; reserva; adaptador TypeScript no
-- Core. Nada de agendamento, dentista, disponibilidade, horario ou acao
-- pendente e tocado por esta funcao.
--
-- `atualizado_em` nao e referenciado de proposito: o trigger
-- `trigger_pacientes_atualizado_em` ja existe neste banco e cuida disso no
-- UPDATE. Referencia-lo na funcao duplicaria um efeito que ja acontece.
--
-- exigir_email NAO vira coluna: a configuracao ja existe como
-- clinicas.automatizacoes.solicitar_email -- a mesma chave ja lida hoje por
-- cappia_confirmar_acao_pendente -- e continua sendo lida pelo controlador,
-- nunca por esta funcao (que jamais le `clinicas`).
--
-- ── RLS E GRANTS ──────────────────────────────────────────────────────────
-- Nenhuma alteracao. `pacientes` ja tem RLS ativa sem policy neste projeto
-- (verificado 2026-08-09: relrowsecurity=true, 0 policies). A funcao e
-- SECURITY INVOKER: quem nao ignora RLS nao enxerga linha nenhuma -- falha
-- fechado.
--
-- DIVERGENCIA PRE-EXISTENTE REGISTRADA, NAO CORRIGIDA AQUI: neste banco o
-- papel `anon` ainda tem grants completos de DML sobre `pacientes`
-- (SELECT/INSERT/UPDATE/DELETE), verificado em 2026-08-09. Hoje isso e
-- neutralizado pela RLS ativa sem policy, mas e uma postura fragil: bastaria
-- uma policy permissiva para `anon` passar a escrever direto na tabela. No
-- dev esses grants nao existem, porque
-- 20260729_iris_nova_identificacao_v1_correcao.sql fez
-- `revoke all privileges on table pacientes from anon, authenticated` e essa
-- migration nunca teve irma legada. NAO corrigido nesta migration por estar
-- fora do escopo aprovado -- registrado para decisao explicita do Gabriel.
--
-- ── PREFLIGHT (executar imediatamente antes de aplicar) ───────────────────
--   1. `select count(*) from pacientes where clinica_id is null;` deve ser 0
--      -- medido 0 em 2026-08-09, remedir na hora de aplicar. Se houver
--      linha, PARAR: nunca inventar clinica para linha orfa.
--   2. `select count(*) from (select clinica_id, documento from pacientes
--      where documento is not null group by 1,2 having count(*) > 1) d;`
--      deve ser 0 -- medido 0 em 2026-08-09, remedir na hora de aplicar. Se
--      houver duplicata, PARAR: a deduplicacao e decisao de produto, nunca
--      efeito colateral de migration.
--   3. confirmar que `pacientes_clinica_id_documento_key` ainda nao existe.
--   4. confirmar que `cappia_persistir_paciente` ainda nao existe.
--
-- NAO APLICADA em nenhum projeto no momento desta escrita.

alter table pacientes
  alter column clinica_id set not null;

alter table pacientes
  add constraint pacientes_clinica_id_documento_key
  unique (clinica_id, documento);

-- Corpo IDENTICO ao da migration irma em src/supabase/migrations/.
-- Qualquer divergencia entre os dois deve ser tratada como defeito: conferir
-- por diff desta secao antes de aplicar.
create or replace function public.cappia_persistir_paciente(
  p_clinica_id uuid,
  p_telefone_normalizado text,
  p_nome text,
  p_documento text default null,
  p_data_nascimento date default null,
  p_email text default null
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_telefone    text;
  v_nome        text;
  v_paciente_id uuid;
  v_constraint  text;
begin
  if p_clinica_id is null then
    return jsonb_build_object('sucesso', false, 'motivo', 'clinica_id_ausente');
  end if;

  v_telefone := btrim(coalesce(p_telefone_normalizado, ''));
  if v_telefone = '' then
    return jsonb_build_object('sucesso', false, 'motivo', 'telefone_normalizado_ausente');
  end if;

  -- nome e exigido em TODA chamada, criacao ou atualizacao. O Core chama com
  -- o estado cadastral atual conhecido, nao apenas com o campo digitado no
  -- turno -- decisao do Gabriel em 2026-08-09, que evita subconsulta interna,
  -- corrida especial e distincao criacao/atualizacao dentro da funcao.
  v_nome := btrim(coalesce(p_nome, ''));
  if v_nome = '' then
    return jsonb_build_object('sucesso', false, 'motivo', 'nome_ausente');
  end if;

  insert into pacientes
    (clinica_id, telefone_normalizado, nome, documento, data_nascimento, email)
  values (
    p_clinica_id,
    v_telefone,
    v_nome,
    nullif(btrim(p_documento), ''),
    p_data_nascimento,
    nullif(btrim(p_email), '')
  )
  on conflict (clinica_id, telefone_normalizado) do update
    -- nome sobrescreve porque e sempre enviado; os demais usam coalesce para
    -- que campo ausente NUNCA apague valor ja existente. A assimetria e
    -- deliberada e decorre da regra acima.
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
$function$;

revoke all on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) from public;
revoke all on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) from anon;
revoke all on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) from authenticated;
grant execute on function public.cappia_persistir_paciente(uuid, text, text, text, date, text) to service_role;
