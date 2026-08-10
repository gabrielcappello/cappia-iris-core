-- Iris Nova - troca de telefone do paciente dono do CPF (ambiente de
-- desenvolvimento e testes, bcmuqautblvjdqzhjfbw).
--
-- Projeto-alvo: bcmuqautblvjdqzhjfbw. PROIBIDO aplicar em
-- udizowyfjnhuhgxkeayk (banco operacional real), que tem migration irma
-- propria em src/supabase/migrations-legado/, com CORPO DIFERENTE de
-- proposito -- ver o bloco "PARIDADE" abaixo.
--
-- Base normativa: specs/cpf-outro-telefone-v1.md (fechada e aprovada pelo
-- Gabriel em 2026-08-10), que implementa specs/persistencia-v1.md secao 6.
-- A secao 7 (telefone atual pertencente a outro paciente) permanece FORA
-- desta rodada: aqui ela e apenas DETECTADA e devolvida tipada, nunca
-- resolvida.
--
-- ── PARIDADE ENTRE OS DOIS BANCOS ────────────────────────────────────────
-- O contrato observavel (assinatura, vocabulario de retorno, efeitos) e
-- IDENTICO nos dois. O corpo fisico DIFERE, deliberadamente, porque os
-- esquemas divergem:
--
--   aqui (dev): pacientes.telefone_normalizado e coluna normal, gravavel.
--               Nao existe coluna `telefone`.
--   operacional: pacientes.telefone e a coluna FONTE, e telefone_normalizado
--               e GENERATED ALWAYS AS ('55' || telefone) STORED.
--
-- Exigir SQL identico entre esquemas diferentes foi exatamente o defeito
-- corrigido em 2026-08-10 na migration de cappia_persistir_paciente
-- (20260810182322 no legado). Nao repetir.
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
--   - `telefone_alterado_origem`: seria constante 'iris' dentro desta RPC,
--     sem nenhum consumidor, e ficaria obsoleta (afirmando origem falsa) se
--     o painel alterasse o telefone por outra via. Coluna constante que
--     mente e pior que a ausencia dela.
--   - `referencia autorizadora`: depende da identidade da operacao
--     idempotente de P4/P4I, especificadas e NAO implementadas. Nenhuma
--     coluna substituta e inventada.
--   - `natureza da alteracao` (secao 5 da mesma spec): seria constante
--     'substituicao' enquanto a secao 7 nao abrir.
--
-- Registrado como atendimento PARCIAL e explicito da secao 6 -- nunca
-- reconciliado em silencio.

alter table public.pacientes
  add column if not exists telefone_alterado_em timestamptz;

comment on column public.pacientes.telefone_alterado_em is
  'Instante da ultima troca EFETIVA do telefone oficial por cappia_trocar_telefone_paciente (specs/cpf-outro-telefone-v1.md secao 5). Nulo = nunca trocado por essa via. Nao e o mesmo que uma coluna generica de atualizacao da linha.';

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
  v_cpf         text;
  v_telefone    text;
  v_paciente_id uuid;
  v_constraint  text;
begin
  -- INVARIANTES DO CORE, nunca situacao do paciente: o fluxo so chama esta
  -- funcao depois de ter clinica autenticada, CPF validado e telefone
  -- normalizado. Chegar aqui sem um deles e bug interno -- falha fechado,
  -- vira ErroRpcTecnico no adaptador, e NUNCA entra no vocabulario
  -- conversacional (specs/cpf-outro-telefone-v1.md secao 5).
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

  -- LOCALIZACAO E ESCRITA NA MESMA INSTRUCAO -- nunca SELECT seguido de
  -- UPDATE, que abriria janela entre a verificacao e a escrita. O predicado
  -- inclui sempre clinica_id: um CPF de outra clinica e inalcancavel por
  -- construcao (specs/persistencia-v1.md secao 4).
  --
  -- `telefone_alterado_em` so avanca quando o telefone REALMENTE muda: no
  -- SET, o lado direito enxerga os valores ANTIGOS da linha. Repetir a troca
  -- com o mesmo numero nao falsifica o instante.
  update pacientes
     set telefone_normalizado = v_telefone,
         telefone_alterado_em = case
           when telefone_normalizado is distinct from v_telefone then now()
           else telefone_alterado_em
         end
   where clinica_id = p_clinica_id
     and documento = v_cpf
  returning id into v_paciente_id;

  if v_paciente_id is null then
    -- O CPF deixou de existir nesta clinica entre a pergunta e a resposta
    -- (corrida real: ficha removida ou documento alterado pelo painel).
    -- Nao cria paciente, nao tenta outra via.
    return jsonb_build_object('sucesso', false, 'motivo', 'cpf_nao_encontrado');
  end if;

  -- NUNCA devolve nome, telefone anterior, CPF ou qualquer outro dado da
  -- ficha: so o identificador opaco (specs/cpf-outro-telefone-v1.md secao 4).
  return jsonb_build_object('sucesso', true, 'paciente_id', v_paciente_id);

exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    -- SECAO 7 detectada, nunca resolvida: o telefone da conversa ja e o
    -- oficial de OUTRO cadastro desta clinica. Nenhuma escrita ocorreu (a
    -- transacao da funcao desfaz o UPDATE que violou a unicidade).
    if v_constraint in ('pacientes_clinica_telefone_key', 'pacientes_id_clinica_telefone_key') then
      return jsonb_build_object('sucesso', false, 'motivo', 'telefone_de_outro_paciente');
    end if;
    -- Qualquer outra unicidade FALHA FECHADO: nunca reinterpretada como um
    -- motivo conversacional que ela nao e.
    raise;
end;
$$;

revoke all on function public.cappia_trocar_telefone_paciente(uuid, text, text) from public;
revoke all on function public.cappia_trocar_telefone_paciente(uuid, text, text) from anon;
revoke all on function public.cappia_trocar_telefone_paciente(uuid, text, text) from authenticated;
grant execute on function public.cappia_trocar_telefone_paciente(uuid, text, text) to service_role;
