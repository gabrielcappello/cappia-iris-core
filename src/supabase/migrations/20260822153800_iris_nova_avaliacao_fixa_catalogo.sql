-- "Consulta / Avaliação" vira procedimento FIXO no catálogo de toda clínica
-- (specs/catalogo-avaliacao-obrigatoria-gratuita-v1.md, seção 2.3).
--
-- ── O QUE MUDA, E SÓ ISSO ───────────────────────────────────────────────
-- Só ATIVAÇÃO/EXISTÊNCIA do item "Consulta / Avaliação" dentro do array
-- `clinicas.precios` (jsonb). NUNCA `valor`, `mostrar_valor` nem `gratuito`
-- -- decisão explícita do Gabriel (2026-08-22), corrigindo uma versão
-- anterior desta spec que teria sobrescrito preço real já cadastrado.
--
-- Dois casos, mutuamente exclusivos por clínica:
--
--   1. A linha já tem um item com nome = 'Consulta / Avaliação' e
--      `ativo` diferente de `true` (false, ausente, ou qualquer valor que
--      não seja o booleano `true`) -> só o campo `ativo` desse item vira
--      `true`. Todo o resto do item (valor, mostrar_valor, tempo, esp) e
--      todos os OUTROS itens do array permanecem byte-a-byte idênticos.
--
--   2. A linha não tem nenhum item com esse nome -> insere um item novo,
--      em estado NEUTRO (equivalente a "procedimento recém-adicionado,
--      clínica ainda não configurou nada"): mesmos valores-padrão que o
--      painel já usa para todo item novo (specs/catalogo-avaliacao-
--      obrigatoria-gratuita-v1.md seção 2.3):
--        {esp: '🦷 Clínico Geral', nome: 'Consulta / Avaliação',
--         ativo: true, valor: 0, mostrar_valor: false, gratuito: false,
--         tempo: 30}
--
-- Clínicas que já têm o item com `ativo: true` (confirmado em produção,
-- 2026-08-22: as duas clínicas de teste `gabriel teste` e `cleardent`,
-- ambas com valor > 0) são NO-OP -- a migration não as toca.
--
-- ── POR QUE jsonb E NÃO UMA COLUNA NOVA ─────────────────────────────────
-- `clinicas.precios` já é a fonte única de configuração de procedimento por
-- clínica (specs/catalogo-avaliacao-obrigatoria-gratuita-v1.md seção 1.2);
-- nenhuma FK com `procedimentos_catalogo`, correspondência sempre por NOME
-- de texto -- mesmo padrão que o Painel e o Core já usam em todo o resto.
-- Criar uma coluna/tabela separada para um único item quebraria essa
-- convenção sem necessidade.
--
-- ── IDEMPOTÊNCIA ─────────────────────────────────────────────────────────
-- Rodar esta migration mais de uma vez não altera nada que já esteja
-- `ativo: true` -- o predicado do UPDATE exclui exatamente esses casos, e o
-- INSERT do item novo só ocorre quando o item está totalmente ausente.
--
-- ── MULTICLÍNICA ─────────────────────────────────────────────────────────
-- Cada linha de `clinicas` é tratada independentemente, pela própria
-- natureza do `UPDATE` por linha -- sem predicado de `clinica_id` explícito
-- porque a migration se aplica a TODA clínica (decisão "retroativo, todas
-- as clínicas", seção 0 da spec).

-- ── CASO 1: item existe, ativa sem tocar no resto ───────────────────────
-- `jsonb_set` substitui só a posição do array onde o item mora, localizada
-- via subquery com `WITH ORDINALITY` (índice 1-based do jsonb_array_elements).
update public.clinicas c
set precios = jsonb_set(
  c.precios,
  array[(alvo.posicao - 1)::text, 'ativo'],
  'true'::jsonb
)
from (
  select
    linha.id,
    (elem.ordinalidade) as posicao
  from public.clinicas linha,
    jsonb_array_elements(linha.precios) with ordinality as elem(item, ordinalidade)
  where jsonb_typeof(linha.precios) = 'array'
    and elem.item ->> 'nome' = 'Consulta / Avaliação'
    and coalesce((elem.item ->> 'ativo')::boolean, false) is distinct from true
) as alvo
where c.id = alvo.id;

-- ── CASO 2: item ausente, insere em estado neutro ───────────────────────
update public.clinicas c
set precios = coalesce(c.precios, '[]'::jsonb) || jsonb_build_array(
  jsonb_build_object(
    'esp', '🦷 Clínico Geral',
    'nome', 'Consulta / Avaliação',
    'ativo', true,
    'valor', 0,
    'mostrar_valor', false,
    'gratuito', false,
    'tempo', 30
  )
)
where not exists (
  select 1
  from jsonb_array_elements(coalesce(c.precios, '[]'::jsonb)) as elem(item)
  where elem.item ->> 'nome' = 'Consulta / Avaliação'
);

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- Não há rollback automático seguro: o CASO 2 (inserção) não preserva o
-- estado "item ausente" de forma recuperável sem um backup prévio, e o
-- CASO 1 não registra o valor anterior de `ativo` (era sempre != true,
-- nunca um valor único conhecido a restaurar). Se for necessário reverter,
-- usar o backup do estado da tabela `clinicas` tirado imediatamente antes
-- de aplicar esta migration (procedimento operacional, fora desta migration).
--
-- Gatilho para rollback: descoberta de que alguma clínica dependia de ter
-- "Consulta / Avaliação" desativada ou ausente -- não identificado nenhum
-- caso real até a escrita desta migration.
