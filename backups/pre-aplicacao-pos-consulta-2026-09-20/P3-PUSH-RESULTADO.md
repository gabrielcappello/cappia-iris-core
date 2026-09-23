# P3 — `supabase db push` REAL (2026-09-21)

Autorizado pelo Gabriel: push real das duas migrations **exatamente como listadas no dry-run**, com reconfirmação
prévia do histórico e de `pos_consulta_jornadas` vazia, validação posterior de versões/objetos/ACLs e novo dry-run
sem pendências. **Não** houve deploy de Edge Function, alteração no n8n nem ativação do Disparo A.

## Execução
- Comando único, sem retry: `supabase db push --yes --linked --project-ref udizowyfjnhuhgxkeayk --workdir <workspace>`
  com `SUPABASE_ACCESS_TOKEN` do cofre e sem senha de banco (papel temporário `cli_login_postgres` da plataforma).
- Trava do script: só executa se o dry-run imediatamente anterior listar EXATAMENTE as duas migrations esperadas.
- Aplicadas, nesta ordem, em um único comando:
  - `20260920230000_iris_nova_pos_consulta_google_so_apos_satisfacao_e_janela.sql` (SHA-256 `a82fbf94…`, = MANIFESTO)
  - `20260921000000_iris_nova_pos_consulta_recuperacao_entrega_pendente.sql` (SHA-256 `975ccec1…`, = MANIFESTO)
- Sem `apply_migration`, sem renomear, sem `migration repair`.

## Verificações (todas conformes)
| Item | Resultado |
|---|---|
| Histórico antes do push | 141 entradas, MD5 `0c8e573b…` (igual ao P0) |
| `pos_consulta_jornadas` antes | 0 linhas |
| Histórico depois | 143 entradas; as 141 anteriores intactas (MD5 igual); novas versões `20260920230000` (27 statements) e `20260921000000` (34 statements), com os nomes dos arquivos |
| `list_migrations` | mostra as duas versões |
| `pos_consulta_jornadas` depois | 0 linhas |
| Novo dry-run | "Remote database is up to date" — nenhuma pendência |
| 10 funções `cappia_pos_consulta_*` | anon/authenticated/public sem EXECUTE; service_role com EXECUTE; nenhuma `security definer` |
| Função do trigger | ACL `{postgres=X/postgres}` (service_role sem EXECUTE — por desenho, ver abaixo) |
| Tabela | RLS ligada; anon/authenticated sem nenhum privilégio |
| Constantes | janela 2880 min; máx. tentativas 3; expiração sem resposta 10080 min |
| Constraints/colunas/trigger vs. referência local | 17 CHECK/constraints, 18 colunas, 1 trigger: hashes **idênticos** |
| Definição das 10 funções vs. referência local | MD5 de `pg_get_functiondef` **idêntico nas 10** |

## Divergências encontradas na comparação com a referência local — diagnosticadas (só leitura)
A comparação agregada com o Postgres local descartável (3 migrations aplicadas em ordem) deu DIFERENTE em `func` e
`grant`. Diagnóstico por objeto: **nenhuma diferença de definição**; ambas vêm dos *default privileges* do ambiente,
não das migrations.

1. **ACL da função do trigger** (`cappia_pos_consulta_jornadas_tentativas_tg`)
   - Local: `{postgres=X/postgres, service_role=X/postgres}`; remoto: `{postgres=X/postgres}`.
   - Causa: no remoto o default de funções do `postgres` no schema `public` é só `postgres=X` (endurecimento da
     plataforma); no local o default concede EXECUTE a `service_role`. A migration faz `revoke` de public/anon/
     authenticated e nunca concede EXECUTE a `service_role` nessa função — o remoto reflete a intenção.
   - Efeito: nenhum. O Postgres checa EXECUTE da função de trigger na criação do trigger (feita pelo dono), não ao
     disparar; a função de trigger não é chamável por `service_role` nem via RPC (é mais restrito, não menos).
     O disparo em UPDATE por `service_role` será exercitado no teste controlado (P6).
2. **Privilégios da tabela** (`pos_consulta_jornadas`, remoto: `service_role = arwDxtm`, sem `d`)
   - Local: `service_role` também tem DELETE (`arwdDxtm`); remoto: sem DELETE.
   - Causa: default privileges de tabelas do `postgres` no remoto = `anon/authenticated/service_role = Dxtm`
     (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN); o local usa `arwdDxtm`. A migration faz
     `revoke all … from public, anon, authenticated` e `grant select, insert, update … to service_role`.
   - O remoto é **mais fiel** ao desenho ("nunca deletar") que o local. As tabelas antigas (`clinicas`, `pacientes`)
     têm o mesmo `Dxtm` de base para `service_role` — é padrão da plataforma, não específico desta feature.
   - Risco residual conhecido (já registrado): `service_role` mantém TRUNCATE/REFERENCES/TRIGGER/MAINTAIN na tabela
     nova por default da plataforma. Endurecer exigiria um `revoke` (nova migration) — **não feito; decisão do
     Gabriel** (recomendação: opcional, não bloqueia o P4).

## Estado
- Banco: as 3 migrations do pós-consulta aplicadas; tabela vazia; nada enviado a nenhum telefone.
- Edge Functions: `iris-nova-mensagem` v118 e `iris-nova-pos-consulta` v1 **inalteradas** (não leem o novo segredo até o P4).
- n8n: sem alteração neste passo. Disparo A: inativo.
- Ambiente local descartável: parado; scripts temporários removidos do repositório.
- Pendente (próximo gate): **P4 — deploy** (exige nova autorização explícita do Gabriel).
