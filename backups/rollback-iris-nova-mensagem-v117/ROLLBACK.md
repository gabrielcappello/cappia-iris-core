# Rollback — iris-nova-mensagem v117 (pré pós-consulta conversacional)

Registrado em 2026-09-19, ANTES da publicação da versão revisada com a integração
de pós-consulta (Proposta C) e das correções de paridade Core/Edge.

## Versão preservada

| Campo | Valor |
|---|---|
| Function | `iris-nova-mensagem` |
| Projeto | `udizowyfjnhuhgxkeayk` (operacional) |
| Versão | **117** |
| Status na captura | ACTIVE |
| `verify_jwt` | **true** (manter no redeploy) |
| `ezbr_sha256` (bundle) | `fba9bfcb9786f17a47050e39ff13d867b8540f0c04f2c19bc66a93eeb5b7bfbb` |
| `updated_at` (epoch ms) | 1788903845902 |
| Commit correspondente | `6d388da` (HEAD da branch `feat/pos-consulta-conversacional` no momento da captura; **62/62 arquivos idênticos** ao HEAD) |

## Verificação do backup

- Capturado via MCP `get_edge_function`: 62 arquivos + `SHA256SUMS.txt` (SHA-256 por
  arquivo) + `metadados-captura.json`.
- **Segunda captura independente** do bundle implantado: versão 117, mesmo
  `ezbr_sha256`, 62/62 arquivos byte a byte iguais ao backup.
- Comparado ao `HEAD` do git (ignorando CRLF): 62/62 idênticos. Comparado à working
  tree do repositório: 53/62 idênticos; os 9 diferentes são exatamente as mudanças
  desta entrega — `index.ts`, `auditoria-conversas.ts`, `fatos-autorizados.ts`,
  `gerar-resposta-conversacional.ts`, `guarda-resposta-redatora.ts`,
  `redator-instrucoes.ts` (integração de pós-consulta) e `correcao-cadastro.ts`,
  `gerar-resposta-paciente.ts`, `sombra-capacidade-v2.ts` (restauração de paridade
  com o Core).

## Como reverter a Edge Function

Qualquer um dos dois, ambos partindo de arquivos idênticos à v117:

```
git checkout 6d388da -- supabase/functions/iris-nova-mensagem/
supabase functions deploy iris-nova-mensagem --project-ref udizowyfjnhuhgxkeayk --use-api
```

ou republicar os arquivos desta pasta (todos, sem `SHA256SUMS.txt`, `metadados-captura.json`
e este `ROLLBACK.md`) com `verify_jwt: true`. Confirmar `verify_jwt: true` e a versão após o deploy.

## Como reverter o banco (migration `20260919204030_iris_nova_pos_consulta_v1`)

Aplicada em 2026-09-19 no projeto operacional (aditiva: 1 tabela + 4 funções, nada
existente foi alterado). Rollback — a ordem importa (funções antes da tabela):

```sql
drop function if exists public.cappia_pos_consulta_candidatos(integer);
drop function if exists public.cappia_pos_consulta_confirmar_entrega(uuid, uuid, uuid);
drop function if exists public.cappia_pos_consulta_registrar_resposta_pendente(uuid, uuid, text, boolean);
drop function if exists public.cappia_pos_consulta_iniciar_jornada(uuid, uuid, uuid, text, text, boolean, text);
drop table if exists public.pos_consulta_jornadas;
```

Só executar depois de a Edge Function `iris-nova-mensagem` ter voltado à v117 (a versão
revisada consulta `pos_consulta_jornadas`) e de a função `iris-nova-pos-consulta`, se
publicada, ter sido removida ou desativada.

## Workflows n8n (backup em `backups/n8n/`, capturas duplas idênticas)

| Workflow | id | versionId | Arquivo |
|---|---|---|---|
| Iris Oficial | `8oNbqLc9QLaHz8lF` | `7e2d08a5-ce80-429c-ac87-8f64d4b8a907` | `8oNbqLc9QLaHz8lF-antes-pos-consulta-2026-09-19.json` |
| Pos-Consulta - Avaliacao Google (legado) | `h8HxxQK7T6et4tYP` | `ed56f054-c924-4af6-bc1d-c8ac0d58a509` | `h8HxxQK7T6et4tYP-antes-pos-consulta-2026-09-19.json` |

`INVENTARIO-workflows-2026-09-19.json` guarda o estado (ativo/inativo, `updatedAt`) dos
38 workflows na captura (13 ativos). Reverter um workflow = `PUT` do JSON do backup
(somente `name`, `nodes`, `connections`, `settings`) — nunca alterar o estado `active`
sem autorização.

## Registro do deploy da versão revisada (2026-09-19)

| Campo | Valor |
|---|---|
| Versão publicada | **118** (ACTIVE, `verify_jwt: true`) |
| `ezbr_sha256` | `9bd73dde7ff35fe58db0856282a6613dc759d87472edfa148edda2412dce7dac` |
| Canal | Supabase CLI 2.117.0, `functions deploy iris-nova-mensagem --use-api` (sem `--prune`) |
| Bundle | 76 arquivos, **76/76 idênticos** ao espelho `supabase/functions/iris-nova-mensagem/`; nenhum arquivo da v117 removido; 14 arquivos novos (integração de pós-consulta). Os `.ts` só de tipos não entram no bundle (igual à v117). |
| Funções vizinhas | `iris-nova-pos-consulta` v1, `criar-clinica` v15 e `suporte-chat` v7 inalteradas |

Verificação pós-deploy (sem WhatsApp, sem tocar banco/IA): sem `Authorization` → 401; `GET` → 405; corpo vazio → 400
`payload_contem_propriedade_nao_permitida`; instância não autorizada → 403 `instancia_nao_autorizada`. Antes do deploy, a
consulta exata do novo lookup reativo (`pos_consulta_jornadas` por clínica+telefone+etapa) foi executada sob `service_role`
em transação somente-leitura, sem erro. Nenhum turno real havia chegado após a publicação.

### Restaurar a v117 (procedimento preparado e testado por hash)

```
mkdir -p <stage>/supabase/functions/iris-nova-mensagem
# copiar para lá TODOS os arquivos desta pasta, exceto SHA256SUMS.txt, metadados-captura.json e ROLLBACK.md
# conferir cada arquivo contra SHA256SUMS.txt
cd <stage> && supabase functions deploy iris-nova-mensagem --project-ref udizowyfjnhuhgxkeayk --use-api
```

Depois: confirmar versão nova, `verify_jwt: true`, comparar o bundle com o backup e repetir o smoke test. O `ezbr_sha256`
original (`fba9bfcb…`) pode não se repetir byte a byte (bundle refeito); a prova de restauração é arquivo a arquivo.
Se a v118 for revertida, o banco pode permanecer como está (a v117 não lê `pos_consulta_jornadas`).
