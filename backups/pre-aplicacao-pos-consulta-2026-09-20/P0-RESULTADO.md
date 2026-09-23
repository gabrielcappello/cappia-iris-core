# P0 — Linha de base e backups (somente leitura) — resultado

Executado em 2026-09-20, com autorização do Gabriel **somente para o P0**. Nenhuma migration, deploy, alteração de
secret, escrita no n8n ou envio. Chamadas feitas ao ambiente hospedado (todas de **leitura**): MCP
`list_migrations`, `list_edge_functions`, `get_edge_function` (×2) e `execute_sql` com 3 `SELECT`s; n8n: `GET` de 3
workflows e 2 listagens de execuções. Projeto: `udizowyfjnhuhgxkeayk`.

## Preflight do banco

| Verificação | Resultado | Esperado |
|---|---|---|
| `pos_consulta_jornadas` | **0 linhas**; tabela existe, RLS ligada | 0 linhas |
| Colunas novas (`entrega_tentativas`, `encerramento_motivo`) | **0** presentes | ausentes |
| CHECKs novos (5) | **0** presentes | ausentes |
| Funções novas (6) | **0** presentes | ausentes |
| Triggers na tabela | **0** | 0 |
| Histórico de migrations | **141** entradas; maior versão **`20260919204030`** | maior < `20260920230000` |
| MD5 do histórico (`version:name`, ordenado) | `0c8e573b…d3b3` — **igual** ao do JSON local | igual |
| Funções `cappia_pos_consulta_*` vivas | as **4** da v1; `security invoker`; ACL só `postgres` + `service_role` | 4 da v1 |
| MD5 do corpo das 4 funções | **idêntico** ao de uma aplicação local da `20260919204030` | idêntico |

Contexto (contagens, sem detalhes): 6 clínicas; **1** com pós-consulta ligado (a Clear Dent, `pos_consulta_tipo =
"google"`, como restaurado no E2E).

## Bundles vivos (backup para rollback)

| Função | Versão viva | `ezbr_sha256` | Arquivos | Conferência |
|---|---|---|---|---|
| `iris-nova-mensagem` | **118** (`verify_jwt: true`) | `9bd73dde7ff35fe58db0856282a6613dc759d87472edfa148edda2412dce7dac` | 76 | **igual** ao registrado no deploy da v118 (`backups/rollback-iris-nova-mensagem-v117/ROLLBACK.md`) |
| `iris-nova-pos-consulta` | **1** (`verify_jwt: true`; criada = atualizada) | `885ed1b0b569afb238dd3604f7d5adc44d1b5d5fa69822cba9aa369401cd8151` | 17 | único deploy; **não havia hash registrado** para comparar — este passa a ser a linha de base |

Arquivos em `iris-nova-mensagem-v118/` e `iris-nova-pos-consulta-v1/` (cada um com `SHA256SUMS.txt` e
`metadados-captura.json`). Comparação com o repositório atual: **só diferem** os arquivos que foram alterados nas
rodadas de correção (pos-consulta: 10 de 17; mensagem: 6 de 76); **nenhuma diferença fora desse conjunto** e
nenhum arquivo só no vivo. A v117 continua em `backups/rollback-iris-nova-mensagem-v117/`.

## n8n (GET)

| Workflow | Ativo | Hash | Registrado |
|---|---|---|---|
| Iris Oficial (`8oNbqLc9QLaHz8lF`) | sim | `c77dda6ce9ff` | igual |
| Legado Google (`h8HxxQK7T6et4tYP`) | **não** | estrutura `700d8465f4b1` | igual |
| Disparo A (`Y6oMf0xBYWVi14Rh`) | **não** | `2d9dd110944d` | igual; **0 execuções** |

Exports em `n8n/` e hashes em `SHA256SUMS-n8n-e-historico.txt`. Última execução do legado: `169360`
(2026-09-20 19:45Z), anterior à despublicação.

## Higiene

101 arquivos varridos: **nenhum** token `sbp_`, `sb_secret_` ou JWT. `migracoes-remotas.json` (entrada do preparador
do `db push`) verificado por MD5 contra o banco.

## Condições de parada do P0

Tabela com linhas — **não**; versão remota maior que `20260920230000` — **não**; bundle vivo diferente do esperado —
**não** (mensagem v118 confere; pos-consulta v1 sem hash prévio, ver acima). **Nenhuma condição de parada.**
