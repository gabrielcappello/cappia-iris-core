-- Iris Nova - troca de telefone do paciente dono do CPF (banco operacional
-- legado, udizowyfjnhuhgxkeayk).
--
-- Projeto-alvo: udizowyfjnhuhgxkeayk (banco operacional real, com painel e
-- WhatsApp ativo). PROIBIDO aplicar em bcmuqautblvjdqzhjfbw, que tem
-- migration irma propria em src/supabase/migrations/, com CORPO DIFERENTE
-- de proposito -- ver o bloco "PARIDADE" abaixo.
--
-- Base normativa: specs/cpf-outro-telefone-v1.md (fechada e aprovada pelo
-- Gabriel em 2026-08-10), que implementa specs/persistencia-v1.md secao 6.
-- A secao 7 (telefone atual pertencente a outro paciente) permanece FORA
-- desta rodada: aqui ela e apenas DETECTADA e devolvida tipada, nunca
-- resolvida.
--
-- ── PARIDADE ENTRE OS DOIS BANCOS ────────────────────────────────────────
-- O contrato observavel (assinatura, vocabulario de retorno, efeitos) e
-- IDENTICO nos dois. O corpo fisico DIFERE, deliberadamente:
--
--   dev (bcmuqautblvjdqzhjfbw): telefone_normalizado e coluna normal,
--                               gravavel; nao existe coluna `telefone`.
--   aqui (operacional):         pacientes.telefone e a coluna FONTE, e
--                               telefone_normalizado e
--                               GENERATED ALWAYS AS ('55' || telefone) STORED.
--
-- Exigir SQL identico entre esquemas diferentes foi exatamente o defeito
-- corrigido em 2026-08-10 (20260810182322_iris_nova_persistir_paciente_
-- coluna_fonte_legado.sql). Nao repetir.
--
-- ── O QUE ESTA MIGRATION FAZ ─────────────────────────────────────────────
-- 1. Coluna aditiva `telefone_alterado_em timestamptz` (nullable, sem
--    default, sem backfill).
-- 2. Funcao nova `cappia_trocar_telefone_paciente`.
--
-- Nao altera nenhuma outra coluna, constraint, indice, RLS ou dado.
--
-- ── COLUNAS DELIBERADAMENTE NAO CRIADAS ──────────────────────────────────
-- specs/persistencia-v1.md secao 6 pede instante, origem e referencia
-- autorizadora. Somente o INSTANTE e criado aqui
-- (specs/cpf-outro-telefone-v1.md secao 5):
--
--   - `telefone_alterado_origem`: auditoria de 2026-08-10 neste banco --
--     UMA unica funcao escreve em `pacientes` (a nossa), nenhuma RPC legada
--     escreve, `pacientes` esta com RLS ativa e ZERO policies, e a tabela
--     nao tem nenhum padrao de auditoria de origem. O valor seria constante
--     'iris', sem consumidor; e `service_role` (BYPASSRLS) pode alterar o
--     telefone direto via PostgREST sem passar por esta RPC, deixando a
--     coluna afirmando uma origem falsa.
--   - `referencia autorizadora`: depende da identidade da operacao
--     idempotente de P4/P4I, especificadas e NAO implementadas.
--   - `natureza da alteracao`: seria constante 'substituicao' enquanto a
--     secao 7 nao abrir.
--
-- Registrado como atendimento PARCIAL e explicito da secao 6 -- nunca
-- reconciliado em silencio.

alter table public.pacientes
  add column if not exists telefone_alterado_em timestamptz;

comment on column public.pacientes.telefone_alterado_em is
  'Instante da ultima troca EFETIVA do telefone oficial por cappia_trocar_telefone_paciente (specs/cpf-outro-telefone-v1.md secao 5). Nulo = nunca trocado por essa via. Distinto de atualizado_em, que o trigger bumpa em qualquer alteracao da linha.';

create or replace function public.cappia_trocar_telefone_paciente(
  p_clinica_id           uuid,
  p_cpf                  text,
  p_telefone_normalizado text
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cpf            text;
  v_telefone       text;
  v_telefone_bruto text;
  v_paciente_id    uuid;
  v_constraint     text;
begin
  -- INVARIANTES DO CORE, nunca situacao do paciente: falha fechado, vira
  -- ErroRpcTecnico no adaptador, e NUNCA entra no vocabulario conversacional
  -- (specs/cpf-outro-telefone-v1.md secao 5).
  if p_clinica_id is null then
    raise exception 'clinica_id ausente' using errcode = 'check_violation';
  end if;

  v_cpf := btrim(coalesce(p_cpf, ''));
  if v_cpf = '' then
    raise exception 'cpf ausente' using errcode = 'check_violation';
  end if;

  v_telefone := btrim(coalesce(p_telefone_normalizado, ''));
  if v_telefone !~ '^55[0-9]{10,11}$' then
    raise exception 'telefone_normalizado fora do formato canonico'
      using errcode = 'check_violation';
  end if;

  -- TRADUCAO NO LIMITE DA PERSISTENCIA (mesma disciplina de
  -- cappia_persistir_paciente neste banco): telefone_normalizado e
  -- GENERATED ALWAYS AS ('55' || telefone), entao a coluna gravavel e
  -- `telefone`. A inversao e EXATA por construcao -- os dois primeiros
  -- caracteres do valor gerado sao sempre literalmente '55'.
  v_telefone_bruto := substr(v_telefone, 3);

  -- LOCALIZACAO E ESCRITA NA MESMA INSTRUCAO -- nunca SELECT seguido de
  -- UPDATE, que abriria janela entre a verificacao e a escrita. O predicado
  -- inclui sempre clinica_id: um CPF de outra clinica e inalcancavel por
  -- construcao (specs/persistencia-v1.md secao 4).
  --
  -- `telefone_alterado_em` so avanca quando o telefone REALMENTE muda: no
  -- SET, o lado direito enxerga os valores ANTIGOS da linha.
  update pacientes
     set telefone = v_telefone_bruto,
         telefone_alterado_em = case
           when telefone is distinct from v_telefone_bruto then now()
           else telefone_alterado_em
         end
   where clinica_id = p_clinica_id
     and documento = v_cpf
  returning id into v_paciente_id;

  if v_paciente_id is null then
    return jsonb_build_object('sucesso', false, 'motivo', 'cpf_nao_encontrado');
  end if;

  -- NUNCA devolve nome, telefone anterior, CPF ou qualquer outro dado da
  -- ficha: so o identificador opaco (specs/cpf-outro-telefone-v1.md secao 4).
  return jsonb_build_object('sucesso', true, 'paciente_id', v_paciente_id);

exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    -- SECAO 7 detectada, nunca resolvida. TRES nomes possiveis neste banco,
    -- e nao um: alem da constraint sobre telefone_normalizado, existe o
    -- indice unico BARE `pacientes_clinica_telefone_unique` sobre
    -- (clinica_id, telefone) -- indice sem constraint associada, que tambem
    -- reporta seu nome em constraint_name. Como as duas colunas sao
    -- bijetivas aqui, qualquer uma pode disparar primeiro; enumerar so uma
    -- deixaria o outro caminho virar erro tecnico.
    if v_constraint in (
      'pacientes_clinica_telefone_unique',
      'pacientes_clinica_id_telefone_normalizado_key',
      'pacientes_id_clinica_telefone_key'
    ) then
      return jsonb_build_object('sucesso', false, 'motivo', 'telefone_de_outro_paciente');
    end if;
    -- Qualquer outra unicidade FALHA FECHADO.
    raise;
end;
$$;

revoke all on function public.cappia_trocar_telefone_paciente(uuid, text, text) from public;
revoke all on function public.cappia_trocar_telefone_paciente(uuid, text, text) from anon;
revoke all on function public.cappia_trocar_telefone_paciente(uuid, text, text) from authenticated;
grant execute on function public.cappia_trocar_telefone_paciente(uuid, text, text) to service_role;
