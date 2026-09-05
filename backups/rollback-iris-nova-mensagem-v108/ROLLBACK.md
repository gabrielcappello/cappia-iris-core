# Rollback — iris-nova-mensagem v108

Registrado em 2026-09-05, ANTES do deploy da correção de pedido múltiplo
(`c3e8370`..`0d333b2`, spec `specs/multiplos-procedimentos-mesmo-turno-v1.md`).

**DEPLOY REALIZADO em 2026-09-05, via `supabase functions deploy iris-nova-mensagem
--project-ref udizowyfjnhuhgxkeayk`** (CLI local, autenticada com `SUPABASE_MCP_TOKEN`
exportado como `SUPABASE_ACCESS_TOKEN`, upload direto dos arquivos em disco — sem
transcrição manual). Resultado: **v109, ACTIVE, `verify_jwt: true`**,
`ezbr_sha256 = 3602d0ae26075a4c0b50a480b383744bcb2d7472d84188ac9797b5c31f01f463`,
`updated_at = 1788625831503`. Este documento preserva a v108 (anterior) para rollback.

**Validação pós-deploy (2026-09-05), contra a v109 real, clínica Cleardent
(`7ff57033-122d-44a7-99e5-41fc5e3af326`), dois telefones sintéticos (nunca usados por
paciente real, removidos de `estado_conversa` logo após o teste):**

- Pedido múltiplo (`"quero marcar uma limpeza e uma avaliacao, uma na terca e outra na
  quinta"`) → HTTP 200, resposta `"Vamos marcar um procedimento de cada vez. Qual você
  quer agendar primeiro?"` — comportamento exatamente o da spec, sem citar nome de
  procedimento.
- Saudação simples (`"boa tarde"`) → HTTP 200, resposta normal de abertura — confirma que
  o fluxo padrão não regrediu.

Nenhuma outra clínica ou paciente real foi tocado.

## Versão preservada

| Campo | Valor |
|---|---|
| Function | `iris-nova-mensagem` |
| Projeto | `udizowyfjnhuhgxkeayk` (operacional) |
| Versão | **108** |
| Status na captura | ACTIVE |
| `verify_jwt` | true |
| `updated_at` (epoch ms) | 1788467523175 |
| `ezbr_sha256` (metadado do servidor) | `7d423438480205a4db0224c8866fa0c9c30395e9ce5cfc503a1e409e9b2f9868` |
| Commit correspondente | `main` em 2026-09-05, antes do merge de `feat/pedido-multiplo` (topo: `7339c7e` "docs: mapa de branches -- producao, congeladas, e a nova frente de espanhol") |

## Captura

Baixado via MCP `mcp__claude_ai_Supabase__get_edge_function` (61 arquivos, conteúdo
completo). Escrito neste diretório preservando os terminadores de linha originais do
servidor (`newline=''` na escrita, para não introduzir CR duplicado).

**Paridade confirmada byte-a-byte** contra `supabase/functions/iris-nova-mensagem/` na
`main` (antes do merge): 52 de 61 arquivos idênticos; os 9 divergentes são exatamente os
arquivos tocados pela entrega de pedido múltiplo (`contexto-horarios.ts`,
`fatos-autorizados.ts`, `gerar-resposta-paciente.ts`, `interpretacao-instrucoes.ts`,
`interpretacao-tipos.ts`, `interpretar-e-aplicar.ts`, `orquestrador.ts`,
`redator-instrucoes.ts`, `sombra-capacidade-v2.ts`) — nenhuma surpresa fora do escopo
autorizado. `orquestrador-tipos.ts` existe no repositório mas não aparece como arquivo
próprio nos 61 publicados (é só tipos, consumido via `import type`).

## Como reverter

```
git checkout 7339c7e -- supabase/functions/iris-nova-mensagem/
```

Depois, publicar esse conteúdo como a Edge Function `iris-nova-mensagem` no projeto
`udizowyfjnhuhgxkeayk` (via `deploy_edge_function`, lendo cada arquivo deste diretório e
enviando como `files`, com `verify_jwt: true`).

Isso produz uma versão NOVA com o conteúdo da v108 — não reativa a v108 em si. Conferir
`verify_jwt: true` após o deploy.

## O que a v108 NÃO tem (e a versão seguinte passa a ter)

A correção de pedido múltiplo (`specs/multiplos-procedimentos-mesmo-turno-v1.md`): quando o
paciente pede mais de um procedimento no mesmo turno, cada um com seu próprio dia/horário,
a Iris reconhece a condição (evento `pedido_multiplo`), responde de forma genérica ("vamos
marcar um procedimento de cada vez, qual primeiro?") e conduz um agendamento por vez — em
vez de tentar (e falhar) combinar os dois pedidos num único campo de data/horário, o que
causava loop de pergunta repetida e, em seguida, silêncio total. Revisado pelo Codex em
quatro rodadas, aprovado, sem bloqueadores. Ressalva registrada (não bloqueante, causa
indeterminada): uma execução de teste independente observou `valor_fora_do_dominio` em
`periodo.valor` num turno; não reproduzido na execução seguinte.
