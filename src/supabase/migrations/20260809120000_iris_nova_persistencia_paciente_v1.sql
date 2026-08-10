-- Iris Nova - contrato e persistencia do paciente (base do cadastro).
--
-- Projeto-alvo: cappia-iris-core-dev (bcmuqautblvjdqzhjfbw) -- ambiente
-- isolado de desenvolvimento e testes da Iris Nova, mantido por decisao
-- explicita. PROIBIDO aplicar em udizowyfjnhuhgxkeayk, que tem migration
-- irma propria em src/supabase/migrations-legado/ (mesmo contrato final,
-- DDL diferente porque os dois esquemas divergiram; arquivo separado pela
-- convencao ja estabelecida de pastas por projeto-alvo).
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
-- ── POR QUE UMA FUNCAO NOVA, E NAO REAPROVEITAR O LEGADO ──────────────────
-- Auditoria read-only de 2026-08-09 sobre udizowyfjnhuhgxkeayk mapeou toda
-- a superficie que toca `pacientes`:
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
-- paralelo/legado. Reaproveitado apenas o PADRAO SQL de upsert ja provado
-- ali (INSERT ... ON CONFLICT ... COALESCE), nunca a funcao.
--
-- ── CPF x DOCUMENTO ───────────────────────────────────────────────────────
-- No dominio novo existe somente o conceito `cpf`. No banco fisico a coluna
-- e `documento`. Decisao fechada: NAO renomear, NAO criar coluna `cpf`
-- paralela, NAO criar duas fontes de verdade. A traducao acontece em UM
-- unico limite: o parametro `p_documento` desta funcao. Renomear a coluna
-- foi descartado porque duas RPCs legadas amarram o nome `documento` em SQL
-- e podem ser chamadas de fora deste repositorio (n8n/Painel).
--
-- ── ESCOPO ────────────────────────────────────────────────────────────────
-- Estritamente aditivo. 1 tabela, 4 colunas, 1 constraint, 1 funcao.
-- Nenhum dado alterado, nenhuma coluna removida ou renomeada, nenhuma
-- mudanca de RLS.
--
--   pacientes.nome            (text NOT NULL) -- ja NOT NULL no operacional
--   pacientes.documento       (text, nullable) -- o CPF do dominio
--   pacientes.data_nascimento (date, nullable)
--   pacientes.email           (text, nullable)
--   constraint UNIQUE (clinica_id, documento)
--   function  cappia_persistir_paciente(...)
--
-- `nome` entra NOT NULL porque a tabela esta VAZIA neste projeto (verificado
-- 2026-08-09: 0 linhas) e porque o operacional ja tem essa coluna NOT NULL --
-- e o ponto em que os dois esquemas convergem. As demais colunas cadastrais
-- ficam nullable de proposito: a obrigatoriedade pertence ao CONTROLADOR
-- (Core), nunca a estrutura (specs/persistencia-v1.md secao 5). Isso NAO
-- afrouxa a regra de produto -- nome, CPF e data de nascimento continuam
-- obrigatorios antes de concluir o cadastro (specs/novo-agendamento.md
-- secao 12); a tabela apenas nao duplica essa regra.
--
-- UNIQUE (clinica_id, documento) sem indice parcial de proposito: em
-- constraint UNIQUE comum o PostgreSQL ja trata multiplos NULL como nao
-- conflitantes, entao "unico quando presente" sai de graca. Um
-- `WHERE documento IS NOT NULL` seria mecanismo a mais para o mesmo efeito.
--
-- clinica_id ja e NOT NULL neste projeto -- nada a fazer aqui. A UNIQUE de
-- (clinica_id, telefone_normalizado) tambem ja existe, sob o nome
-- `pacientes_clinica_telefone_key` (no operacional o mesmo par existe sob
-- outro nome). O ON CONFLICT da funcao infere pelo PAR DE COLUNAS, nunca
-- pelo nome da constraint, entao o MESMO corpo de funcao vale nos dois
-- projetos.
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
-- `atualizado_em` nao e referenciado de proposito: no operacional o trigger
-- `trigger_pacientes_atualizado_em` ja cuida disso no UPDATE, e neste
-- projeto a coluna nem existe. O mesmo corpo de funcao roda nos dois.
--
-- exigir_email NAO vira coluna: a configuracao ja existe como
-- clinicas.automatizacoes.solicitar_email e continua sendo lida pelo
-- controlador, nunca por esta funcao (que jamais le `clinicas`).
--
-- ── RLS ───────────────────────────────────────────────────────────────────
-- Nenhuma alteracao. `pacientes` ja tem RLS ativa sem policy neste projeto
-- (verificado 2026-08-09: relrowsecurity=true, 0 policies) e os grants de
-- anon/authenticated ja foram revogados em
-- 20260729_iris_nova_identificacao_v1_correcao.sql. Colunas novas herdam
-- exatamente esse regime. A funcao e SECURITY INVOKER: quem nao ignora RLS
-- nao enxerga linha nenhuma -- falha fechado.
--
-- ── PREFLIGHT (executar imediatamente antes de aplicar) ───────────────────
--   1. `select count(*) from pacientes;` deve ser 0 -- `add column nome text
--      not null` sem default falha explicitamente se houver linhas, e essa
--      falha e desejada (nunca inventar valor para linha existente).
--   2. confirmar que nome/documento/data_nascimento/email ainda NAO existem
--      em `pacientes`. Nenhum ADD COLUMN usa IF NOT EXISTS: colisao de nome
--      falha explicitamente em vez de ser ignorada em silencio.
--   3. confirmar que `pacientes_clinica_id_documento_key` ainda nao existe.
--   4. confirmar que `cappia_persistir_paciente` ainda nao existe.
--
-- NAO APLICADA em nenhum projeto no momento desta escrita.

alter table pacientes
  add column nome text not null,
  add column documento text,
  add column data_nascimento date,
  add column email text;

alter table pacientes
  add constraint pacientes_clinica_id_documento_key
  unique (clinica_id, documento);

-- Corpo IDENTICO ao da migration irma em src/supabase/migrations-legado/.
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
