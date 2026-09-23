# Proposta de ambiente de teste — pós-consulta conversacional

> **STATUS (2026-09-19): decidido e executado.** O Gabriel aprovou a **Opção
> A** (ambiente local descartável) e vetou explicitamente a Opção C
> (`cappia-tales` — não reativar, não alterar, não reutilizar). Como esta
> máquina não tem WSL2/Docker e a sessão não é elevada, a Opção A foi
> implementada pelo **caminho sem administrador** (Postgres 17 real em
> `127.0.0.1`, fora do repo) — ver `ambiente-local/LEIA-ME.md`, que também
> traz o passo-a-passo do caminho Docker + Supabase CLI (exige
> administrador). O texto abaixo é o registro original da comparação.

**Nada foi criado quando esta proposta foi escrita.** O documento só comparava
opções para o Gabriel decidir.

## Correção de contexto (duas rodadas)

1. O "projeto dev `bcmuqautblvjdqzhjfbw`" citado em rodadas anteriores desta
   frente **não está mais disponível**. Correção histórica: esse projeto
   **existiu, mas foi excluído** — não é mais alcançável, e o ref não deve
   ser fixado de novo como alvo (um ref excluído pode, em tese, ser
   reciclado pela Supabase para outro projeto; nunca assumir que esse ref
   específico ainda significa "o dev da Iris"). O único Supabase real e
   **ativo** hoje é o **operacional** (`udizowyfjnhuhgxkeayk`) — e ele
   continua fora de cogitação para qualquer teste que crie/apague linhas ou
   aplique DDL (é exatamente o que `executar-teste-pos-consulta-v1.mjs`
   faz). Essa correção está refletida no runner (`executar-teste-pos-consulta-v1.mjs`,
   seção "PROJETO-ALVO").
2. Auditoria (somente leitura) confirmou que a organização Supabase da Iris
   tem, além do operacional, um **segundo projeto**: `eipuzacdfmeqkjbexqqo`
   ("cappia-tales"), hoje **pausado** (`INACTIVE`). Ver seção "Opção C"
   abaixo.

## O que falta poder rodar, e o que cada opção cobre

| Gate | Precisa de quê |
|---|---|
| Runner SQL real (`executar-teste-pos-consulta-v1.mjs`) | Um Postgres com a migration aplicável, alcançável por `DATABASE_URL`, que **não** seja o operacional |
| `deno check` das Edge Functions | O binário `deno` (ou `supabase functions serve`, que o traz embutido) |
| Teste ponta a ponta dos workflows n8n inativos | Migration aplicada + Edge Function `iris-nova-pos-consulta` deployada em algum lugar alcançável pelo n8n + um ambiente n8n seguro pra importar os JSONs |
| B8 (IA real) | Só `OPENAI_API_KEY` — **independente de qual opção abaixo for escolhida** |

## Opção A — Supabase local (via Supabase CLI)

Roda inteiramente nesta máquina, nunca toca em nenhum servidor Supabase real.

**O que cobre:** runner SQL real (com `DATABASE_URL` fixa e conhecida,
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` por padrão) e
`deno check`/execução real das Edge Functions via `supabase functions serve`
— os dois gates mais imediatos, no mesmo ambiente.

**O que NÃO cobre sozinho:** o teste ponta a ponta dos workflows n8n, porque
o n8n (seja o de produção lido nesta sessão, seja um futuro n8n de teste)
precisa de uma URL **alcançável pela internet** para chamar a Edge Function
— um Supabase local por trás de `127.0.0.1` não é alcançável de fora sem
mais alguma coisa (túnel, deploy real, etc.).

**Custo de setup, verificado nesta máquina agora:**
- Precisa da **Supabase CLI** — não instalada aqui (`which supabase` não
  encontra nada).
- A CLI sobe os serviços via **Docker** — também não instalado aqui
  (`which docker` não encontra nada).
- **Ajuste de código fora do escopo desta rodada:** `identidade-conexao.mjs`
  (módulo compartilhado, usado por vários runners além do de pós-consulta)
  hoje só reconhece hosts `*.supabase.co`/`*.pooler.supabase.com` — uma
  `DATABASE_URL` local (`127.0.0.1`) seria recusada com "não foi possível
  identificar o projeto". Alterar esse módulo compartilhado não está
  incluído nesta correção (ele afeta outros runners, não só este) — ficaria
  para uma frente separada, só se a Opção A for a escolhida.
- Estado é descartável (`supabase db reset`) — bom para rodar o runner
  repetidamente sem acumular lixo entre execuções.

## Opção B — projeto Supabase "dev" novo, criado de verdade

Um projeto Supabase real, na nuvem, distinto do operacional.

**O que cobre:** todos os gates, incluindo o teste ponta a ponta com n8n (a
Edge Function deployada lá tem uma URL pública de verdade, alcançável pelo
n8n).

**Custo de setup:**
- Alguém com acesso à organização Supabase da Iris precisa criar o projeto
  (ação real — fora do meu mandato fazer sozinho).
- Aplicar a migration nesse projeto novo.
- Deploy da Edge Function `iris-nova-pos-consulta` nesse projeto.
- Gerar e guardar uma `DATABASE_URL`/chave de service_role **desse projeto
  novo**, nunca reaproveitar a do operacional.
- Mais uma coisa para o time lembrar de nunca confundir com o operacional
  (mesma disciplina de nomes/ids que `PROJETO_PROIBIDO` já aplica hoje).

## Opção C — reaproveitar `eipuzacdfmeqkjbexqqo` ("cappia-tales") — NÃO RECOMENDADO

Auditoria somente leitura feita via MCP Supabase (`list_projects`, `get_project`,
`list_edge_functions`, `get_edge_function`). **Nenhum projeto foi excluído,
nenhuma migration aplicada, nenhum deploy feito.**

**O que foi possível confirmar sem reativar o projeto:**
- Nome: `cappia-tales`. Region: `sa-east-1`. Status: `INACTIVE` (pausado
  pelo auto-pause da Supabase por inatividade — não foi desligado de
  propósito).
- **1 Edge Function deployada e ATIVA**: `tales-mensagem` (v8, atualizada
  em 2026-08-27). Não é um projeto vazio nem um rascunho: é o backend real
  do **"Tales"**, um agente comercial de WhatsApp que atende clínicas
  interessadas na Iris (pré-venda) — canal público, "qualquer número que
  escreva... pode receber atendimento" (comentário no próprio código).
- Lendo o código-fonte dessa função (não precisa do banco rodando): ela
  grava conversas reais numa tabela `tales_conversas` (memória por
  conversa, chave = hash do telefone, nunca o número cru), usa
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`OPENAI_API_KEY` próprias, e
  integra com uma instância Evolution própria (`EVOLUTION_URL`/
  `EVOLUTION_INSTANCIA`/`EVOLUTION_APIKEY`) — possivelmente diferente da
  instância Evolution da Iris.
- **Não foi possível listar tabelas nem migrations** — toda consulta ao
  Postgres retornou timeout de conexão porque o projeto está pausado.
  Resumir o projeto (`restore_project`) resolveria isso, mas é uma ação
  real de infraestrutura (reativa um sistema pago, ainda que hoje pausado)
  — **não fiz isso sem autorização explícita**, por ser mais que "leitura"
  no sentido estrito.

**Por que não recomendo reaproveitar:** isto não é um projeto vazio ou
descartável — é o backend de um produto comercial real e ativo (do ponto de
vista do código), só pausado por inatividade de uso. Rodar a migration de
pós-consulta ali, ou usá-lo como sandbox de testes, arrisca:
- Reativar (e recomeçar a cobrar por) um sistema em produção do Tales sem
  necessidade.
- Misturar o schema/RLS da Iris com o do Tales no mesmo banco.
- Mexer, ainda que indiretamente, num projeto com dados reais de conversas
  de clínicas prospectivas (`tales_conversas`).

Se o Gabriel quiser mesmo assim uma auditoria completa (tabelas, linhas,
migrations reais), isso exige reativar o projeto — não fiz sem perguntar
antes.

## Recomendação (menor escopo possível, não vinculante)

Para os dois gates mais baratos de fechar agora (**runner SQL real** e
**`deno check`**), a Opção A é estritamente menor — não depende de criar
nada em nenhum serviço externo, só instalar ferramentas locais (Docker +
Supabase CLI) e ajustar `identidade-conexao.mjs` para reconhecer localhost.

Para o **teste ponta a ponta dos workflows n8n**, só a Opção B resolve —
não há como contornar a exigência de uma URL pública alcançável pelo n8n.

As duas não são mutuamente exclusivas: dá para usar a Opção A primeiro (mais
rápida, cobre 2 dos 4 gates) e, se/quando fizer sentido testar o fluxo n8n
de ponta a ponta, criar o projeto dev novo (Opção B) separadamente.

A Opção C (reaproveitar `cappia-tales`) não entra nessa recomendação — é um
sistema real de outro produto, não um ambiente vazio.

**Nenhuma ação foi tomada com base nesta proposta** — aguardando decisão do
Gabriel antes de qualquer alteração de código (inclusive em
`identidade-conexao.mjs`, caso a Opção A seja escolhida).
