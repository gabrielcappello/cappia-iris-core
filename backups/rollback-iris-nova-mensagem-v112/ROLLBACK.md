# Rollback — iris-nova-mensagem v112

Registrado em 2026-09-06, ANTES do deploy da correção da guarda fiscal
(`specs/guarda-redatora-fiscal-conversa-v1.md`, branch `fix/guarda-fiscal-conversa`,
commits `1b3c4dc`..`3513b2f`).

## Versão preservada

| Campo | Valor |
|---|---|
| Function | `iris-nova-mensagem` |
| Projeto | `udizowyfjnhuhgxkeayk` (operacional) |
| Versão | **112** |
| Status na captura | ACTIVE |
| `verify_jwt` | true |
| `ezbr_sha256` | `caf6ed4ff53b07aa8b3f07c5d0eb72b531bedb4bb5a5b5eb282678c1bc5cc93c` |
| `updated_at` (epoch ms) | 1788653922420 |
| Commit correspondente | `main` = `d72c59301455edc56f3f9cdc8c9c3741c14d60f8` ("docs: corrige causa
  real da sequencia de versoes v109-v111 no rollback") -- topo de `main` imediatamente
  antes do merge de `fix/guarda-fiscal-conversa` |

## Captura e verificação

Baixado via MCP `get_edge_function` (62 arquivos). Comparado contra
`supabase/functions/iris-nova-mensagem/` (estado do repositório imediatamente antes do
merge): **56 de 62 arquivos idênticos** (ignorando CRLF); os **6 restantes** diferem
porque são exatamente os arquivos que esta entrega modificou —
`auditoria-conversas.ts`, `fatos-autorizados.ts`, `gerar-resposta-conversacional.ts`,
`guarda-resposta-redatora.ts`, `index.ts`, `redator-instrucoes.ts`. Nenhuma surpresa
fora do escopo desta entrega. `auditoria-conversas.test.ts` (arquivo de teste, não
publicado na Edge Function real) não está entre os 62 arquivos deste backup.

## Como reverter

```
git checkout d72c59301455edc56f3f9cdc8c9c3741c14d60f8 -- supabase/functions/iris-nova-mensagem/
```

Depois, publicar via `supabase functions deploy iris-nova-mensagem --project-ref
udizowyfjnhuhgxkeayk` (CLI local). Confirmar `verify_jwt: true` após o deploy.

## O que a v112 NÃO tem (e a versão seguinte passa a ter)

1. **Guarda condicionada por objetivo** (`guarda-resposta-redatora.ts`): a checagem de
   horário/data deixa de rodar incondicionalmente em qualquer `objetivo` e passa a
   rodar só nos 11 objetivos operacionais protegidos (seção 3.2 da spec). Nenhuma
   fonte nova em `coletarMinutosAutorizados`/`coletarDatasAutorizadas`.

2. **Campo de auditoria** `conversas_auditoria.resposta_rejeitada_pelo_fiscal`
   (`gerar-resposta-conversacional.ts`, `auditoria-conversas.ts`, `index.ts`): grava o
   texto original da redatora quando a guarda o reprova por um motivo com conteúdo
   real (`horario_nao_autorizado`, `data_nao_autorizada`, `execucao_nao_autorizada`).

3. **`pedido_temporal_ja_passou`** (`fatos-autorizados.ts`, `redator-instrucoes.ts`):
   achado posterior — o Core já resolvia `resultado.tipo === 'passado'`, mas esse fato
   era descartado na montagem de `FatosAutorizados` para `aguardando_data_horario`. A
   redatora podia propor de volta o próprio horário que o Core já tinha rejeitado.
   Corrigido preservando o fato (sem o `motivo` interno) e ensinando a redatora a
   reconhecer que passou e pedir alternativa futura.

Revisado pelo Codex em múltiplas rodadas, aprovado sem bloqueadores. Validado com a
redatora real (gpt-5.6-luna) na conversa completa do caso real — 0/7 fallbacks fixos,
`pedido_temporal_ja_passou: true` confirmado no payload real da redatora em todo turno
"passado".
