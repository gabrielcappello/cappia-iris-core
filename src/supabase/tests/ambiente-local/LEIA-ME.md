# Ambiente local descartável — runner SQL de pós-consulta

Aprovado pelo Gabriel (Opção A de `../PROPOSTA_AMBIENTE_TESTE.md`). **Nada
aqui toca nenhum projeto Supabase hospedado.** Tudo roda em `127.0.0.1` e se
apaga com um comando.

## Caminho 1 — sem administrador (o que foi usado e validado)

Postgres 17 real (binários do pacote npm `embedded-postgres`), instalado
**fora do repositório**, em `~/.local/iris-pg-local/`. Não precisa de Docker,
WSL nem privilégios de administrador.

```powershell
# uma vez (fora do repo):
mkdir $HOME\.local\iris-pg-local; cd $HOME\.local\iris-pg-local
npm init -y; npm install embedded-postgres@17.10.0-beta.17

# a partir de cappia-iris-core\src:
node supabase/tests/ambiente-local/ambiente-local.mjs subir      # cria/inicia; grava a marca de ambiente local no banco
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54329/iris_teste_local"
node supabase/tests/executar-teste-pos-consulta-v1.mjs --aplicar --confirmo-projeto=local
node supabase/tests/ambiente-local/ambiente-local.mjs parar      # opcional
node supabase/tests/ambiente-local/ambiente-local.mjs destruir   # apaga o diretório de dados
```

O runner aplica a migration, roda os cenários e **reverte tudo** (rollback +
zero resíduo). O ambiente (papéis + 3 tabelas) permanece entre execuções.

### Como a autorização do ambiente local é garantida (bloqueio absoluto ao operacional)

O modo local só liga com **três** condições juntas, e o operacional é recusado
em qualquer caminho:

1. `--confirmo-projeto=local` passado explicitamente pelo operador;
2. `DATABASE_URL` com host de **loopback estrito** (`localhost`, `127.0.0.1`,
   `[::1]`) — `identidade-conexao.mjs` só reconhece isso com
   `{ permitirLocal: true }`, e recusa `localhost.evil.com`, `127.1`,
   `127.0.0.2`, `0.0.0.0` etc.; qualquer `?host=`/`hostaddr=`/`service=` na URL
   é recusado (poderia redirecionar a conexão);
3. o **próprio banco** carrega a marca `iris.ambiente_teste_descartavel =
   'local'`, gravada por `ambiente-local.mjs subir`. Um túnel/port-forward que
   levasse `localhost` até o banco operacional passaria nas condições 1–2, mas
   o operacional não tem essa marca — o runner aborta **antes de qualquer DDL**.

Além disso, `udizowyfjnhuhgxkeayk` (operacional) é recusado como
`--confirmo-projeto`, como host direto e como usuário do pooler.

## Caminho 2 — Docker Desktop + Supabase CLI (mais fiel ao hospedado)

**Exige passos de administrador que não puderam ser feitos nesta sessão**
(sessão não elevada; Windows 11 Home; WSL não instalado):

1. PowerShell **como administrador**: `wsl --install` → **reiniciar** o PC.
2. Instalar o Docker Desktop (backend WSL2) e abri-lo uma vez para aceitar os
   termos e concluir a inicialização.
3. Supabase CLI: já instalada nesta máquina em `~/.local/bin/supabase.exe`
   (v2.117.0).
4. `supabase init` (cria `supabase/config.toml`) e `supabase start`; a
   `DATABASE_URL` padrão é `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
5. Nesse caminho o banco se chama `postgres` e **não tem a marca**: rode
   `alter database postgres set iris.ambiente_teste_descartavel = 'local';`
   **uma vez**, conscientemente, num banco que você sabe ser local — é a
   autorização explícita que o runner exige.

`01-roles-supabase.sql` é idempotente e pode ser reaplicado sobre o Supabase
local (os papéis já existem). `02-schema-legado-minimo.sql` não deve ser
aplicado ali — o `supabase start` não traz as tabelas do painel; ver o aviso
no topo do arquivo sobre ser uma **reconstrução**.

## O que este ambiente NÃO é

- **Não é o stack Supabase**: sem PostgREST, GoTrue nem runtime de Edge
  Functions. Serve ao runner SQL, que fala direto com o Postgres.
- **Não é o schema operacional**: `02-schema-legado-minimo.sql` reconstrói
  `clinicas`, `pacientes` e `agendamentos` a partir de
  `portal-iris-principal/src/lib/database.types.ts` e de
  `migrations-legado/`. Defaults, FKs e constraints que os tipos gerados não
  expressam foram **assumidos** (marcados `ASSUMIDO` no arquivo).
- **Não substitui o PREFLIGHT** read-only descrito no cabeçalho da migration,
  contra o banco real, com autorização explícita do Gabriel.
