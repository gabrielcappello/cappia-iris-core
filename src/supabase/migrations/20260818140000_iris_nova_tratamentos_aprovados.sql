-- Tratamentos APROVADOS e ainda nao realizados de um paciente.
--
-- POR QUE UMA FUNCAO, E NAO UMA CONSULTA NO CORE
-- O dado nasce do cruzamento de quatro tabelas (orcamento -> item ->
-- observacao do odontograma -> catalogo), e o cliente de banco do Core nao
-- faz JOIN. Fazer quatro consultas e cruzar em TypeScript custaria quatro
-- viagens por turno para produzir exatamente esta linha.
--
-- O QUE ELA DEVOLVE
-- Um procedimento por linha: nome exibido, id canonico do catalogo e o
-- dente. NUNCA o valor -- preco de tratamento ja foi conversado entre
-- dentista e paciente na avaliacao (decisao do Gabriel, 2026-08-18).
--
-- OS QUATRO FILTROS, E POR QUE CADA UM
--   o.status = 'aprovado'           -> so o que o paciente aceitou
--   obs.status = 'ativo'            -> a observacao nao foi cancelada
--   plano_status = 'pendente'       -> ainda nao foi realizado; quando o
--                                      dentista clica "Marcar realizado" no
--                                      painel isto vira 'realizado' e o item
--                                      sai da lista sozinho
--   intencao = 'planejado'          -> e algo A FAZER, nao registro de algo
--                                      que ja existia na boca do paciente
--
-- ISOLAMENTO
-- `p_clinica_id` e `p_paciente_id` sao exigidos juntos, e as duas igualdades
-- precisam casar na MESMA linha -- mesma disciplina de `buscarPacientePorTelefone`.
--
-- O vinculo com o catalogo e por NOME (`nome_pt`), porque o item do orcamento
-- guarda a descricao, nao o id. Verificado em 2026-08-18: os nomes sao fixos
-- no painel (a clinica so edita valor e tempo), entao o casamento e 1:1. Um
-- item cuja descricao nao case com nenhum procedimento sai com
-- `procedimento_id` nulo e e DESCARTADO pelo Core -- oferecer o que nao se
-- consegue agendar levaria o paciente a um beco.

create or replace function public.iris_nova_tratamentos_aprovados(
  p_clinica_id uuid,
  p_paciente_id uuid
)
returns table (
  descricao text,
  dente text,
  procedimento_id text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct
    i.descricao,
    i.dente,
    pc.id as procedimento_id
  from financeiro_orcamentos o
  join financeiro_orcamento_itens i on i.orcamento_id = o.id
  join odontograma_observacoes obs on obs.id = i.origem_id
  left join procedimentos_catalogo pc
    on lower(trim(pc.nome_pt)) = lower(trim(i.descricao))
   and pc.ativo
  where o.clinica_id = p_clinica_id
    and o.paciente_id = p_paciente_id
    and o.status = 'aprovado'
    and obs.clinica_id = p_clinica_id
    and obs.paciente_id = p_paciente_id
    and obs.status = 'ativo'
    and obs.detalhes ->> 'plano_status' = 'pendente'
    and obs.detalhes ->> 'intencao' = 'planejado'
  order by i.descricao;
$function$;

-- Só o servidor chama (service key). Nunca exposta ao navegador.
--
-- ARMADILHA REAL, medida em producao (2026-08-20): este revoke JA ESTAVA
-- aqui e mesmo assim a funcao amanheceu com `EXECUTE` para PUBLIC. Motivo:
-- `create or replace function` RESTAURA as permissoes padrao do Postgres, e
-- toda funcao nasce com PUBLIC liberado. Em 19/08 esta funcao foi evoluida
-- varias vezes por `create or replace` fora desta migration; cada recriacao
-- desfez o revoke silenciosamente. Resultado: dois UUIDs bastavam para ler
-- plano de tratamento pela API publica, sem login.
--
-- REGRA: toda vez que esta funcao for recriada, o revoke abaixo tem de rodar
-- de novo, na MESMA transacao. `grant ... to service_role` nao restringe --
-- so adiciona; sem o revoke a funcao fica aberta.
revoke all on function public.iris_nova_tratamentos_aprovados(uuid, uuid) from public, anon, authenticated;
