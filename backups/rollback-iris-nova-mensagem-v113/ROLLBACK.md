# Rollback — iris-nova-mensagem v113

Registrado em 2026-09-06, ANTES do deploy da correção de identificação
espontânea do agendamento de origem na remarcação (`main`, commits
`fdcac77`..`97c47e3`).

## Versão preservada

| Campo | Valor |
|---|---|
| Function | `iris-nova-mensagem` |
| Projeto | `udizowyfjnhuhgxkeayk` (operacional) |
| Versão | **113** |
| Status na captura | ACTIVE |
| `verify_jwt` | true |
| `ezbr_sha256` | `b1526b77d3e4a40e9533dec721a2132ab9234c33816c8c0a8a71cd8e67c15497` |
| `updated_at` (epoch ms) | 1788710363823 |
| Commit correspondente | `main` = `f101ed0` ("docs: atualiza status da spec da guarda fiscal
  para implementada/publicada") -- topo de `main` imediatamente antes do push dos
  3 commits desta entrega |

## Captura e verificação

Baixado via MCP `get_edge_function` (62 arquivos). Comparado contra
`supabase/functions/iris-nova-mensagem/` (estado do repositório imediatamente antes
do push): **58 de 62 arquivos idênticos** (ignorando CRLF); os **4 restantes** diferem
porque são exatamente os arquivos que esta entrega modificou —
`interpretacao-extrator.ts`, `interpretacao-instrucoes.ts`, `interpretar-e-aplicar.ts`,
`redator-instrucoes.ts`. Nenhuma surpresa fora do escopo desta entrega.

## Como reverter

```
git checkout f101ed0 -- supabase/functions/iris-nova-mensagem/
```

Depois, publicar via `supabase functions deploy iris-nova-mensagem --project-ref
udizowyfjnhuhgxkeayk` (CLI local). Confirmar `verify_jwt: true` após o deploy.

## O que a v113 NÃO tem (e a versão seguinte passa a ter)

1. **Identificação espontânea do agendamento de origem** (`interpretar-e-aplicar.ts`,
   `interpretacao-instrucoes.ts`, `interpretacao-extrator.ts`): no primeiro pedido
   de remarcação ("remarcar a cirurgia de implante do dia 9"), o Core agora
   identifica o agendamento de origem a partir de `agendamentos_do_paciente`
   (contexto sempre presente), sem exigir uma pergunta "qual desses?" anterior —
   desde que a intenção efetiva do turno seja `remarcacao` e a referência (por
   procedimento, data, dia da semana ou horário) identifique um único agendamento.

2. **Correção de um bug real do transporte** (`interpretacao-extrator.ts`):
   `agendamentos_do_paciente` estava presente na entrada mas nunca era copiado
   para o payload final enviado ao modelo em `extrairAlteracoes` — a chave
   desaparecia antes de chegar à IA. Corrigido seguindo o mesmo padrão já usado
   pelos demais campos opcionais.

3. **Redatora deixa de chamar agendamentos existentes de "horários disponíveis"**
   (`redator-instrucoes.ts`): nova instrução para `escolher_entre_agendamentos`/
   `escolher_entre_agendamentos_cancelamento`, apresentando a lista como
   atendimentos já marcados a escolher, nunca como horários de destino.

4. **Precedência de três vias para intenção efetiva** (`interpretar-e-aplicar.ts`):
   corrige um bloqueador em que remover explicitamente `intencao=remarcacao` no
   turno atual podia, por engano, recuperar a intenção antiga do snapshot e
   aceitar um `agendamento_id` fora do fluxo de remarcação.

Revisado pelo Codex em múltiplas rodadas, aprovado sem bloqueadores. Verificado com
o prompt COMPLETO de produção (gpt-5.6-luna), com guarda prévia confirmando o
payload real antes de cada chamada paga: caso real e falso positivo, ambos
corretos. Suíte completa determinística: 1756/1763 (7 skipped, baseline), 0
falhas. Não investigado nesta entrega: o caso separado de retenção do "dia 10"
(frente futura).
