-- F2a — `id` estável para assistentes
-- specs/acesso-dentista-secretaria.md, fase F2a
--
-- ── POR QUE ─────────────────────────────────────────────────────────────
-- O cookie de sessão hoje identifica o profissional por POSIÇÃO no array
-- (`clinicas.dentistas[idx]`, `clinicas.assistentes[idx]`). Remover alguém do
-- meio da lista faz o cookie de quem vinha depois apontar para OUTRA PESSOA
-- — acesso ao prontuário errado, sem nenhum erro visível.
--
-- Verificado no banco em 2026-08-20:
--   12 dentistas   -> todos JÁ TÊM `id`
--   2 assistentes  -> NENHUMA tem (campos: ativo, nome, permissoes,
--                     telefone, token_acesso)
--
-- Sem `id` nas assistentes, `profissional_id` não teria o que gravar para
-- esse perfil, e a secretária ficaria com o mesmo defeito posicional que a
-- mudança existe para corrigir.
--
-- ── O QUE FAZ ───────────────────────────────────────────────────────────
-- Acrescenta `id` (uuid v4) a cada assistente que ainda não tem. Nada mais.
-- Não toca em dentistas, não remove campo nenhum, não altera `token_acesso`.
--
-- ── IDEMPOTENTE ─────────────────────────────────────────────────────────
-- Rodar de novo não faz nada: o `where` exclui quem já tem `id`, e o `case`
-- preserva o valor existente elemento a elemento.

-- ── PREFLIGHT ───────────────────────────────────────────────────────────
-- `assistentes` é jsonb, e jsonb aceita objeto, string ou número na mesma
-- coluna. `jsonb_array_elements` sobre um não-array lança erro em tempo de
-- execução, no meio do update. Falhar ANTES, com mensagem clara, é melhor
-- que falhar no meio com "cannot extract elements from an object".
do $$
declare
  v_invalidas int;
begin
  select count(*) into v_invalidas
    from clinicas
   where assistentes is not null
     and jsonb_typeof(assistentes) <> 'array';

  if v_invalidas > 0 then
    raise exception
      'F2a abortada: % clinica(s) com `assistentes` que nao e array jsonb. Corrigir antes de migrar.',
      v_invalidas;
  end if;
end $$;

update clinicas c
   set assistentes = (
     select jsonb_agg(
              case
                when coalesce(a->>'id', '') = ''
                  then a || jsonb_build_object('id', gen_random_uuid()::text)
                else a
              end
              order by ord
            )
       from jsonb_array_elements(c.assistentes) with ordinality as t(a, ord)
   )
 where c.assistentes is not null
   and jsonb_typeof(c.assistentes) = 'array'
   and jsonb_array_length(c.assistentes) > 0
   -- só as clínicas que têm ao menos um assistente sem `id`
   and exists (
     select 1
       from jsonb_array_elements(c.assistentes) a
      where coalesce(a->>'id', '') = ''
   );

-- Verificação (rodar depois; deve devolver zero linhas):
--   select c.nome, a->>'nome'
--     from clinicas c, jsonb_array_elements(c.assistentes) a
--    where coalesce(a->>'id','') = '';

-- ── ROLLBACK: MANTER OS IDs ─────────────────────────────────────────────
-- Correção de uma versão anterior desta migration, que sugeria desfazer com
-- `update clinicas set assistentes = (select jsonb_agg(a - 'id') ...)`.
--
-- Aquilo estava ERRADO por dois motivos:
--
--   1. Apagaria o `id` de TODA assistente, inclusive as criadas depois desta
--      migration — que podem já ter `id` legítimo do fluxo normal do painel,
--      e podem já estar referenciadas em `acessos_profissionais` (F1).
--      Seria destruir dado que esta migration nunca criou.
--
--   2. É desnecessário. O campo é ADITIVO e o código antigo simplesmente o
--      ignora: um `id` a mais no objeto do assistente não muda nenhum
--      comportamento anterior.
--
-- **O rollback correto é não fazer nada.** Se F2a precisar ser revertida, o
-- que se reverte é o CÓDIGO que passou a depender de `id` — os dados podem
-- e devem permanecer.
