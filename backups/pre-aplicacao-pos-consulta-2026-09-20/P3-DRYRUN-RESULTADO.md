# P3 — dry-run do `supabase db push` (2026-09-21)

Autorizado pelo Gabriel: **somente** `db push --linked --dry-run` com o token do cofre e a credencial temporária
`cli_login_postgres` criada pela plataforma. **Push real NÃO executado.** Nenhuma migration alterada.

## Auditoria de credenciais de banco (leitura, sem valores)
Nenhuma senha real de banco encontrada na máquina (cofre, repositórios, `.claude`, histórico do PowerShell, ambiente).
Únicas URLs remotas com "senha": fixtures de `identidade-conexao.test.mjs` (1 caractere, não coincide com o cofre). Por
isso a opção escolhida foi a credencial temporária, sem senha.

## Dry-run
- Comando (fixo com `--dry-run`): `supabase db push --dry-run --linked --project-ref udizowyfjnhuhgxkeayk --workdir <workspace>`
  com `SUPABASE_ACCESS_TOKEN` do cofre e **sem** `SUPABASE_DB_PASSWORD`. Código de saída 0. A CLI: "Initialising login
  role… DRY RUN: migrations will *not* be pushed… Would push these migrations".
- **Lista exatamente as 2 migrations pendentes e nenhuma outra**:
  - `20260920230000_iris_nova_pos_consulta_google_so_apos_satisfacao_e_janela.sql`
  - `20260921000000_iris_nova_pos_consulta_recuperacao_entrega_pendente.sql`
- Workspace: 143 arquivos (141 marcadores + 2 pendentes); SHA-256 das pendentes **iguais ao MANIFESTO**
  (`a82fbf94…`, `975ccec1…`). A CLI gravou só `supabase/.temp/` no workspace (arquivos locais).

## Prova de que o dry-run não alterou o banco (SELECT antes e depois)
| Item | Antes | Depois |
|---|---|---|
| Histórico de migrations | 141, maior `20260919204030`, MD5 `0c8e573b…` | idêntico |
| `pos_consulta_jornadas` | 0 linhas | 0 linhas |
| Funções `cappia_pos_consulta_*` | 4 (v1) | 4 (v1) |
| Colunas novas | — | 0 |
| Papel `cli_login_postgres` | **já existia** | existe (mesmo estado); 0 sessões ativas |

O papel temporário **já existia antes** desta execução (a plataforma o reutiliza); não foi criado nem alterado por nós.
