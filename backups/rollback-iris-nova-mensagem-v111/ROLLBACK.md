# Rollback — iris-nova-mensagem v111

Registrado em 2026-09-05, ANTES do deploy da correção de `data_nao_autorizada` +
continuidade do pedido múltiplo (`6abee4c`..`79d2453`).

**DEPLOY REALIZADO em 2026-09-05, via `supabase functions deploy iris-nova-mensagem
--project-ref udizowyfjnhuhgxkeayk`** (CLI local, autenticada com `SUPABASE_MCP_TOKEN`
exportado como `SUPABASE_ACCESS_TOKEN`). Resultado: **v112, ACTIVE, `verify_jwt: true`**,
`ezbr_sha256 = caf6ed4ff53b07aa8b3f07c5d0eb72b531bedb4bb5a5b5eb282678c1bc5cc93c`,
`updated_at = 1788653922420`. Este documento preserva a v111 (anterior) para rollback.

## Versão preservada

| Campo | Valor |
|---|---|
| Function | `iris-nova-mensagem` |
| Projeto | `udizowyfjnhuhgxkeayk` (operacional) |
| Versão | **111** |
| Status na captura | ACTIVE |
| `verify_jwt` | true |
| `updated_at` (epoch ms) | 1788646638406 |
| Commit correspondente | `main` em 2026-09-05, antes do merge de
  `fix/data-autorizada-e-continuidade-pedido-multiplo` (topo: `9fd1fe5` "fix: revoga
  privilegios extras de service_role em conversas_auditoria") |

## Captura e verificação

Baixado via MCP `get_edge_function` (62 arquivos). Comparado contra `src/core/` (fonte de
verdade): 60 de 62 arquivos idênticos (ignorando CRLF); os 2 restantes
(`cliente-modelo-openai.ts`, `cliente-modelo-redator-openai.ts`) diferem só por um
comentário cosmético ("Espelha src/core/..."), sem nenhuma mudança funcional — já
presente, idêntico, na cópia local de `supabase/functions/iris-nova-mensagem/`.

**Nenhuma surpresa fora do escopo desta entrega:** os únicos 3 arquivos com conteúdo
funcional divergente entre v111 e a `main` pré-merge são exatamente
`guarda-resposta-redatora.ts`, `orquestrador.ts` e `redator-instrucoes.ts` — os três
tocados por esta entrega.

## Como reverter

```
git checkout 9fd1fe5 -- supabase/functions/iris-nova-mensagem/
```

Depois, publicar via `supabase functions deploy iris-nova-mensagem --project-ref
udizowyfjnhuhgxkeayk` (CLI local). Confirmar `verify_jwt: true` após o deploy.

## O que a v111 NÃO tem (e a versão seguinte passa a ter)

1. **Correção de `data_nao_autorizada`** (`guarda-resposta-redatora.ts`):
   `coletarDatasAutorizadas` só reconhecia ISO (`YYYY-MM-DD`), mas `fatos-autorizados.ts`
   sempre produz `DD/MM` (via `formatarDataParaRedatora`). A data da proposta nunca
   entrava no set autorizado — uma proposta correta (ex. 09/09) podia ser reprovada e cair
   no fallback fixo quando outro agendamento do paciente também aparecia nos fatos.

2. **Continuidade do pedido múltiplo** (`orquestrador.ts`, `redator-instrucoes.ts`): quando
   o histórico mostra explicitamente que o paciente pediu mais de um procedimento nesta
   conversa e o primeiro acabou de ser reservado, a redatora agora convida naturalmente ao
   próximo, de forma genérica (nunca nomeando), perguntando qual dia fica melhor.
   Deliberadamente **não** usa `tratamentos_aprovados` como gatilho (isso seria falso
   positivo — plano clínico pendente não prova que o paciente pediu vários nesta
   conversa); depende só de `historico_recente`.

Revisado pelo Codex em múltiplas rodadas, aprovado, sem bloqueadores. Validado com a
redatora real (gpt-5.6-luna) nos dois cenários exigidos.
