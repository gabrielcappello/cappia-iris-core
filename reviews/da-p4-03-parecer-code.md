# Parecer técnico — DA-P4-03 (Code)

**Status:** parecer técnico de análise. **Não é decisão aprovada, não é
implementação, não é manifesto operacional.** Nenhuma migration criada, nenhum
SQL executado, nenhum banco alterado, nenhuma CLI instalada ou configurada,
nenhuma documentação canônica alterada por este arquivo.

## 1. Objetivo e limites da `DA-P4-03`

Objeto de `DA-P4-03`: reconciliação canônica do histórico de migrations do
ambiente dev com os arquivos versionados neste repositório, e definição da
regra de versionamento/ordenação para a primeira migration de `P4I`.

Limites explícitos desta rodada de análise: não implementar; não alterar
arquivos além deste próprio artefato; não alterar banco; não criar, renomear
ou executar migration; não instalar ou configurar Supabase CLI; não criar
commit; não fazer push; não iniciar a transição física de `DA-P4-01` ou
`DA-P4-02`.

## 2. Commits-fonte dos dois repositórios

- `cappia-iris-core`: branch `main`, `HEAD = origin/main =
  a8e0349e11077cf1484bb93371d8e95e138c56ce` (`docs: instituir nomenclatura
  canônica das decisões P4`).
- `cappia-estado`: `HEAD = origin/main =
  ab5c7ccb903d385ecd101e29bbd9671a38dbd749` (`docs: alinhar estado da Iris
  Nova à nomenclatura DA-P4`).

Ambos confirmados nesta rodada, antes da criação deste arquivo, por
`git branch --show-current`, `git log -1` e `git status --short --branch`
diretamente nos dois repositórios locais.

## 3. Ambiente dev e project ref consultados

- Ambiente: `cappia-iris-core-dev`.
- `project_ref`: `bcmuqautblvjdqzhjfbw`.
- MCP usado: exclusivamente `supabase` (local, `read_only=true`,
  `features=database`) — nunca `claude_ai_Supabase`.
- Projeto explicitamente não acessado nesta análise: `udizowyfjnhuhgxkeayk`.

## 4. Histórico remoto observado

Consultado via `mcp__supabase__list_migrations` e leitura direta de
`supabase_migrations.schema_migrations`:

| Versão | Nome |
|---|---|
| `20260729033207` | `iris_nova_identificacao_v1` |
| `20260729113821` | `iris_nova_identificacao_v1_correcao` |
| `20260731164424` | `iris_nova_interpretacao_v1` |

Colunas confirmadas por `information_schema.columns` sobre
`supabase_migrations.schema_migrations`: `version` (text), `statements`
(array), `name` (text), `created_by` (text), `idempotency_key` (text),
`rollback` (array).

## 5. Arquivos locais correspondentes

Em `src/supabase/migrations/`:

- `20260729_iris_nova_identificacao_v1.sql`
- `20260729_iris_nova_identificacao_v1_correcao.sql`
- `20260730_iris_nova_interpretacao_v1.sql`
- `20260729_iris_nova_identificacao_v1_rollback.sql`
- `20260729_iris_nova_identificacao_v1_correcao_rollback.sql`
- `20260730_iris_nova_interpretacao_v1_rollback.sql`

Confirmado que nenhum `supabase/config.toml` nem diretório `.supabase/`
existe neste repositório (`Glob` vazio para ambos). Confirmado que a Supabase
CLI não está instalada neste ambiente local (`supabase --version` retorna
"command not found").

## 6. Tamanhos e SHA-256 — locais e remotos

Medidos diretamente nesta análise (`wc -c` e `sha256sum` local;
`length(statements[1])`, `octet_length(statements[1])` e
`encode(sha256(statements[1]::bytea), 'hex')` remoto, via `execute_sql`):

| Migration | Bytes local | SHA-256 local | Remoto — caracteres (`length`) | Remoto — bytes UTF-8 (`octet_length`) | SHA-256 remoto |
|---|---|---|---|---|---|
| `identificacao_v1` | 3377 | `9d0f2292d244f51fc10af5178eb6ecb10222cc7c509bc1d6e85361fdb7c4be0f` | 2551 | 2551 | `12516d9c8995e4a09c32f9dc0e82993ce65c04aeda4312a133367de3205aad5b` |
| `identificacao_v1_correcao` | 3199 | `c12ca12796258b2b770c399ba7c2decb5bc657764c444e0f2dd3927725d36ee1` | 1801 | 1801 | `39f088a176498fb5daa6c9943ed26b9db96df4c611a2f4e1a63a31d55f707a77` |
| `interpretacao_v1` | 21039 | `f0a9c8572d78f4791bbbaada868fd03adc6d69dc961fdabe58bd445ab6a7710d` | **12081 caracteres** | **12091 bytes UTF-8** | `0637046c85ab15beeb249a8ed29dd284ad9a2eb49707d5c36af7c1553fd52155` |

**Nota de verificação e correção (rodada CODE 310), resolvendo a divergência
registrada na rodada anterior:** a rodada de correção anterior (CODE 308)
registrou `12081` como único valor e sinalizou que a instrução pedia `12091`
sem que eu conseguisse sustentar esse segundo valor. Reconsultei nesta
rodada, com query explícita: `length(statements[1]) = 12081`,
`octet_length(statements[1]) = 12091`, para a versão `20260731164424`. As
duas métricas **coexistem e são ambas corretas** — `length()` no PostgreSQL
conta **caracteres**, `octet_length()` conta **bytes**; a diferença de 10
unidades decorre de caracteres multibyte em UTF-8 presentes no texto (por
exemplo, o travessão `—` usado nos comentários de cabeçalho, que ocupa 3
bytes em UTF-8 mas conta como 1 caractere). Confirmado também nesta rodada:
`array_length(statements, 1) = 1` — existe um único elemento no array
`statements`; e os últimos caracteres do `statements[1]` (`right(...,5) =
'ole;\n'`) confirmam que a quebra de linha final já pertence ao próprio
`statements[1]`, não é um artefato de exibição.

## 7. Método usado para comparar o SQL executável

Duas etapas complementares, ambas executadas diretamente nesta análise:

**Etapa 1 — leitura e comparação visual linha a linha.** Leitura direta e
completa do campo `statements[1]` de cada uma das três versões remotas (via
`execute_sql`, sem truncamento) e comparação linha a linha contra o conteúdo
integral do arquivo local correspondente (via `Read`). Nenhum dado pessoal
exposto — o conteúdo é DDL de schema (tabelas, constraints, funções), sem
PII.

**Etapa 2 — normalização e hash reproduzível, aplicada aos dois lados.**
Correção desta rodada: a rodada anterior (CODE 308) afirmou que "o remoto já
não contém comentários" e por isso normalizou apenas o arquivo local. **Essa
afirmação estava incorreta para a migration `interpretacao_v1`** — o
`statements[1]` remoto desta migration **contém**, sim, comentários de seção
(`-- ============...`, `-- 1. Colunas novas...`, `-- 2. RPC
public.reivindicar_mensagem...`, `-- 3. RPC
public.aplicar_interpretacao_condicional...`); só os comentários de cabeçalho
mais longos (linhas 1–30 do arquivo local, incluindo o aviso "NAO APLICADA"
e o alerta sobre `CREATE OR REPLACE`) foram omitidos ou resumidos no
`statements[1]` registrado. Para as outras duas migrations
(`identificacao_v1`, `identificacao_v1_correcao`), o `statements[1]` remoto
de fato não contém nenhum comentário — confirmado por leitura linha a linha
nesta rodada.

Por isso, nesta rodada, a **mesma cadeia de normalização foi aplicada aos
dois lados** — o arquivo local e o texto de `statements[1]` reconstruído a
partir da leitura direta do banco (via `execute_sql`, sem truncamento,
escrito em arquivo temporário para permitir o mesmo pipeline de
normalização) — nesta ordem:

1. normalização de fim de linha (`CRLF` → `LF`);
2. remoção de comentários SQL de linha (`-- ...` até o fim da linha) —
   cada ocorrência de `--` nos três arquivos foi verificada, por leitura
   direta, como início de comentário SQL real (sempre no início de linha ou
   precedida de espaço em posição de comentário), nunca como sequência de
   caracteres dentro de um literal de string (`'...'`) ou dentro do corpo
   `$$...$$` das funções — nenhuma das duas funções PL/pgSQL contém a
   sequência `--` em nenhum literal;
3. remoção do comentário inline específico da migration de correção (o
   comentário `-- redundante: existia so para a FK acima`, na linha do
   `drop constraint pacientes_id_clinica_key`, que aparece à direita de uma
   instrução executável, não em linha própria);
4. remoção de espaços residuais ao final de cada linha;
5. remoção de linhas em branco resultantes.

O SHA-256 do resultado normalizado foi calculado, para cada uma das três
migrations, **em ambos os lados** (`sed` em cadeia idêntica + `sha256sum`
para o arquivo local; a mesma cadeia aplicada ao texto remoto reconstruído).
**Resultado: os hashes executáveis normalizados são idênticos entre local e
remoto, nas três migrations:**

| Migration | SHA-256 executável normalizado (local) | SHA-256 executável normalizado (remoto reconstruído) | Igual? |
|---|---|---|---|
| `identificacao_v1` | `207a5d47a3bc24a22cecda16948553ddff38575e89410ef2ecfeef6d2e8d4476` | `207a5d47a3bc24a22cecda16948553ddff38575e89410ef2ecfeef6d2e8d4476` | sim |
| `identificacao_v1_correcao` | `bbd73fba9a430544f1a2730ba3a597e3d2292eb28ff4047ef75b3f9cfd8665ad` | `bbd73fba9a430544f1a2730ba3a597e3d2292eb28ff4047ef75b3f9cfd8665ad` | sim |
| `interpretacao_v1` | `2b3d632e8090bf7c4167d37dce7f5aaa9bd7e0eb86f6a9318ae1da01de85c29b` | `2b3d632e8090bf7c4167d37dce7f5aaa9bd7e0eb86f6a9318ae1da01de85c29b` | sim |

**Isto não é, e não deve ser lido como, igualdade binária.** Igualdade
binária (byte a byte, sem normalização) **não existe** entre nenhum par
local/remoto, conforme a seção 6. O que esta etapa comprova é **igualdade do
SQL executável após remover exclusivamente comentários e formatação** —
uma prova mais forte que "compatibilidade presumida", mas categoricamente
distinta de "os arquivos são idênticos byte a byte".

## 8. Resultado individual da comparação das três migrations

- **`identificacao_v1`:** o SQL executável remoto é idêntico, caractere a
  caractere, ao SQL executável do arquivo local. A diferença de tamanho (826
  bytes) é integralmente explicada por 6 linhas de comentário (`--`) e linhas
  em branco presentes só no arquivo local (linhas 1–6, 23, 47, 49, 68, 72 do
  arquivo).
- **`identificacao_v1_correcao`:** mesmo resultado — SQL executável idêntico
  ao caractere; diferença de 1398 bytes explicada por 10 linhas de comentário
  e linhas em branco só no arquivo local.
- **`interpretacao_v1`:** SQL executável idêntico ao caractere (corpo
  completo das duas funções `reivindicar_mensagem` e
  `aplicar_interpretacao_condicional`, já lido e comparado integralmente
  nesta e em rodadas anteriores desta mesma análise); diferença de tamanho
  explicada por comentários de cabeçalho e comentários explicativos
  presentes só no arquivo local.

## 9. Separação explícita — três conceitos, nunca fundidos

- **Igualdade byte a byte:** **não existe** entre nenhum dos três pares
  local/remoto — confirmado pelos hashes SHA-256 distintos na seção 6.
- **Equivalência semântica do SQL executável:** **existe, integralmente,
  nas três migrations** — confirmado por comparação direta de conteúdo
  (seção 8): toda instrução DDL executável é idêntica; a única diferença é
  comentário/formatação, que não afeta o schema resultante.
- **Materialização observada no banco:** distinta tanto da equivalência
  executável (seção 7) quanto da igualdade binária — a materialização é
  sobre o **estado atual do schema físico** no ambiente dev, não sobre o
  texto de nenhuma migration. **Rodada e coleta que sustentam esta
  afirmação, identificadas nominalmente:** **CODE 271** é a rodada-fonte —
  o preflight técnico read-only completo de `estado_conversa`/
  `mensagens_recebidas`, executado antes de qualquer decisão `DA-P4-*`,
  onde as consultas abaixo foram originalmente executadas e seus resultados
  registrados. **CODE 285** é a rodada de reconfirmação parcial — parte
  desta mesma evidência (especificamente a ausência da coluna `versao` em
  `estado_conversa` e a estrutura de `mensagens_recebidas`) foi reconsultada
  durante a análise da decisão `DA-P4-02` (CAS de
  `aplicar_interpretacao_condicional` sob `estado_conversa.versao`), sem
  alterar a conclusão já estabelecida em CODE 271. **Nenhuma das duas
  rodadas é esta rodada de correção do artefato (CODE 312), nem a rodada
  anterior (CODE 310), que se limitou a recalcular tamanhos e hashes
  (seções 6 e 7).** Consultas read-only originalmente executadas em
  CODE 271:
  - `information_schema.columns` sobre `estado_conversa` e
    `mensagens_recebidas` — confirmou as colunas declaradas nos três
    arquivos (incluindo `claim_token`, `lease_expira_em`,
    `interpretacao_persistida_em`, adicionadas pela migration de
    interpretação);
  - `pg_constraint`/`pg_get_constraintdef` sobre as quatro tabelas
    (`clinicas`, `pacientes`, `estado_conversa`, `mensagens_recebidas`) —
    confirmou PKs, unicidades, FKs compostas e `CHECK`s declarados nas
    migrations de identificação e correção;
  - `pg_proc`/`pg_get_functiondef` sobre `public.reivindicar_mensagem` e
    `public.aplicar_interpretacao_condicional` — confirmou que o corpo das
    duas funções materializadas no banco é idêntico, campo a campo, ao
    declarado na migration de interpretação;
  - `pg_class.relrowsecurity` sobre as quatro tabelas — confirmou RLS
    habilitada, coerente com o `alter table ... enable row level security`
    da migration de identificação.
  **Nenhuma dessas quatro consultas foi executada nesta rodada de correção
  (CODE 312) nem na rodada anterior (CODE 310).** Estas rodadas de correção
  não atribuem a si mesmas nenhuma evidência que não tenham gerado — a
  materialização é citada aqui como fato já estabelecido em CODE 271
  (rodada-fonte) e CODE 285 (reconfirmação parcial), não reexecutada agora.

**Os três conceitos, lado a lado, para as três migrations:**

| Migration | Igualdade binária | Equivalência executável (normalizada) | Materialização física |
|---|---|---|---|
| `identificacao_v1` | não (seção 6) | sim (seção 7) | sim (CODE 271) |
| `identificacao_v1_correcao` | não (seção 6) | sim (seção 7) | sim (CODE 271) |
| `interpretacao_v1` | não (seção 6) | sim (seção 7) | sim (CODE 271; reconfirmado em CODE 285) |

Estes três fatos são observações distintas, cada uma com sua própria
evidência — nenhuma substitui ou implica automaticamente as outras duas.

## 10. Mecanismo histórico de aplicação

**Classificado como indeterminado.** A presença de `created_by` (e-mail de
usuário) e `statements` (SQL completo) na tabela `schema_migrations` não
permite, por si só, distinguir entre: aplicação via uma eventual "Migrations
view" do Supabase Dashboard; aplicação via Management API direta; aplicação
via Supabase CLI a partir de outro ambiente/diretório não observável por este
repositório. Nenhuma dessas três possibilidades foi confirmada nem
descartada com evidência primária suficiente a partir do MCP `database`
(que não expõe logs de auditoria de acesso). Esta análise não afirma
qualquer uma delas como fato.

## 11. Política que o Code considera pronta para fechamento

- Reconhecimento formal de que o legado (três migrations e respectivos
  rollbacks) tem **equivalência semântica integral comprovada** entre
  arquivo local e histórico remoto — não apenas "materialização compatível"
  ou "parcial".
- Regra de nomenclatura e ordenação para toda migration futura de `P4I`:
  formato `AAAAMMDDHHMMSS_<nome_logico>.sql`, timestamp em UTC atribuído uma
  única vez na criação do arquivo, ordenação estritamente crescente, primeira
  versão de `P4I` numericamente posterior a `20260731164424`.
- Regra de que o arquivo de migration nunca é renomeado após aplicação, e
  que qualquer alteração de conteúdo pós-aplicação é sempre uma nova
  migration corretiva, nunca edição retroativa do arquivo já aplicado.
- Regra de que rollback nunca compartilha o mesmo fluxo de reconhecimento de
  "migration de avanço" — associado ao par de avanço pela combinação de
  **quatro campos simultâneos** (versão remota, nome lógico, filename e
  SHA-256 — nunca apenas convenção de nome-base isolada), sempre de forma
  documental, nunca operacional para uma eventual ferramenta de migration
  (coerente com a seção 14).

## 12. Itens que devem permanecer fora de `DA-P4-03`

- O mecanismo exato de aplicação histórica (seção 10) — indeterminado, sem
  evidência primária suficiente para fechar.
- A decisão de instalar ou adotar a Supabase CLI como autoridade operacional
  deste repositório.
- A criação **física** do manifesto de correspondência local↔remoto (o
  arquivo em si) — fica para etapa posterior; **a obrigatoriedade de que ele
  exista e o que ele deve conter fazem parte de `DA-P4-03`** (ver seção
  12.1).
- A criação de "representações operacionais" das três versões remotas em
  um diretório `supabase/migrations/` padrão — depende diretamente da
  decisão de adotar a CLI, ainda não tomada; é, porém, **precondição
  obrigatória antes do primeiro `db push`**, se e quando essa decisão vier a
  ser tomada (ver seção 12.2).
- A estratégia física de transição de `DA-P4-01`/`DA-P4-02` — explicitamente
  fora do escopo desta e das rodadas anteriores desta análise.

### 12.1 Manifesto local↔remoto — obrigatório como parte da decisão

`DA-P4-03` fecha que o manifesto **deve** existir antes de qualquer promoção
ou reconciliação operacional do histórico de migrations — a criação física
do arquivo é que fica para etapa posterior, não a exigência de que ele
exista. Para cada uma das três migrations legadas, o manifesto deverá
registrar, no mínimo, estes onze campos:

1. versão remota (`supabase_migrations.schema_migrations.version`);
2. nome remoto (`.name`);
3. filename histórico local (caminho em `src/supabase/migrations/`);
4. SHA-256 remoto (do `statements[1]` bruto, seção 6 deste documento);
5. SHA-256 local (do arquivo bruto, seção 6);
6. hash executável normalizado (seção 7, Etapa 2);
7. resultado da comparação semântica (seção 8 — igual/divergente, com
   referência ao método da seção 7);
8. objetos materializados verificados (referência às consultas da seção 9,
   "Materialização observada");
9. rollback associado (filename do `_rollback.sql` correspondente);
10. SHA-256 do rollback;
11. ambiente auditado (`cappia-iris-core-dev` / `bcmuqautblvjdqzhjfbw`, com
    data da auditoria).

### 12.2 Precondição para adoção futura de ferramenta operacional

Caso a decisão de adotar a Supabase CLI (ou outra ferramenta operacional de
migrations) venha a ser tomada no futuro, fica fechado, como parte de
`DA-P4-03`, que:

- **antes do primeiro `db push`** (ou comando equivalente de sincronização),
  devem existir representações operacionais das três versões remotas
  (`20260729033207`, `20260729113821`, `20260731164424`) no diretório que a
  ferramenta escolhida reconhece como padrão;
- essas representações **não podem ser criadas por simples renomeação** dos
  arquivos legados atuais presumindo equivalência — devem derivar
  explicitamente do SQL remoto já verificado (`statements[1]`, seção 6/7)
  ou de um artefato reconciliado e aprovado, nunca de uma cópia não
  verificada;
- esta precondição **não significa, por si só, que a Supabase CLI já foi
  adotada** — é uma regra condicional, que só se aplica no momento em que
  essa adoção for decidida separadamente (seção 15).

## 13. Regra proposta para migrations futuras

- Formato de nome: `AAAAMMDDHHMMSS_<nome_logico>.sql`.
- Timestamp: UTC, atribuído uma única vez, no momento da criação do arquivo
  — nunca recalculado ou alterado para refletir o momento real de aplicação.
- Ordenação: estritamente crescente por timestamp.
- Unicidade: nenhuma versão pode se repetir.
- A primeira migration de `P4I` deve ter versão numericamente posterior a
  `20260731164424`.
- Alteração de conteúdo após aplicação constitui drift; a correção correta é
  sempre uma nova migration, nunca a edição do arquivo já aplicado.

## 14. Regra proposta para rollbacks

- **Rollback não é, e nunca deve ser tratado como, uma migration normal de
  avanço.**
- **Associação inequívoca:** cada rollback é associado à sua migration de
  avanço por quatro campos simultâneos, nunca um só: versão remota da
  migration de avanço correspondente; nome lógico compartilhado; filename
  (mesmo prefixo/base do arquivo de avanço); e SHA-256 próprio do arquivo de
  rollback (a calcular e registrar no manifesto, seção 12.1, item 10).
- **Proibição estrutural:** arquivos de rollback **nunca** devem ser
  colocados em `supabase/migrations/` (ou qualquer diretório que uma
  ferramenta de migration reconheça como fluxo normal de aplicação) — porque
  o padrão de nome de um rollback, se seguir `<timestamp>_<nome>.sql`,
  **poderia ser interpretado pela CLI como uma migration de avanço comum**
  (a CLI não distingue "rollback" por convenção de sufixo; só reconhece o
  padrão de nome — ver seção 14.1 sobre as fontes oficiais consultadas).
  Este é o motivo estrutural da proibição, não apenas uma preferência de
  organização.
- **Execução:** sempre manual, mediante **autorização explícita**, e
  precedida de **preflight de compatibilidade** contra o estado real do
  ambiente-alvo no momento da tentativa (nunca presumido a partir do estado
  registrado na criação do rollback).
- **Proibição de rollback incompatível:** um rollback que se torne
  incompatível após a chegada de tráfego novo dependente da mudança
  original **é proibido de ser executado** — não deve ser forçado sob
  nenhuma circunstância.
- **Alternativa quando a reversão não é segura:** desativação operacional
  (por flag) ou nova migration corretiva — nunca a reaplicação cega do
  arquivo de rollback antigo sobre um estado que já divergiu do momento em
  que o rollback foi escrito.

### 14.1 Fontes oficiais consultadas sobre o comportamento da Supabase CLI

As afirmações desta seção e da seção 15 sobre comparação de migrations,
formato de nome, pré-requisito de projeto vinculado, e reconciliação de
histórico se baseiam em páginas da documentação oficial da Supabase
(`supabase.com/docs`), consultadas nesta linha de análise via busca web —
nenhuma fonte secundária (blog, fórum, tutorial de terceiros) foi usada como
base de afirmação técnica nesta lista:

- `supabase.com/docs/reference/cli/supabase-migration-list` — referência de
  CLI para `migration list`: descreve como a CLI compara migrations locais
  (diretório `supabase/migrations`) e remotas (tabela
  `supabase_migrations.schema_migrations`), comparando **somente o
  timestamp/versão**;
- `supabase.com/docs/reference/cli/supabase-db-push` — referência de CLI
  para `db push`: descreve o pré-requisito de projeto vinculado
  (`supabase link`) ou uso de `--db-url`, e o comportamento de recusa diante
  de divergência de histórico;
- `supabase.com/docs/reference/cli/supabase-migration-repair` — referência
  de CLI **específica** do comando `migration repair` (preferida aqui à
  página genérica `supabase-migration`, que apenas indexa os subcomandos):
  descreve que `migration repair` **muta apenas a tabela de histórico**
  (`schema_migrations`), sem executar nem reverter SQL, marcando uma versão
  como `applied` ou `reverted`;
- `supabase.com/docs/guides/deployment/database-migrations` — guia oficial
  de migrações de banco de dados: sustenta especificamente o **formato de
  nome exigido** (`<timestamp>_<nome>.sql`, `AAAAMMDDHHMMSS`) e a
  organização de `supabase/migrations` como diretório padrão.

**Correção desta rodada (CODE 312) — afirmação removida por falta de fonte
oficial explícita:** a versão anterior deste documento atribuía a esta
mesma página de guia ("Database Migrations") a afirmação de que "arquivos
fora do padrão de nome são ignorados/pulados pela CLI, não reaplicados".
Reverificando nesta rodada, **essa página de guia não sustenta
especificamente esse comportamento** — ela documenta o formato exigido, não
a reação da CLI a um arquivo que o descumpre. A mensagem exata de skip
("file name must match pattern...") só foi localizada, nesta nova busca, em
relatos de comportamento observado registrados em *issues* públicas do
repositório `supabase/cli` (ex.: comportamento relatado e confirmado por
mantenedores em tickets de bug), **não em nenhuma página de documentação
formal** (`supabase.com/docs`) que eu tenha conseguido localizar
explicitamente. Como a regra deste artefato é citar apenas fonte oficial
para afirmação técnica, **esta afirmação específica ("arquivos fora do
padrão são pulados, não reaplicados") é removida do parecer** — não porque
seja necessariamente falsa (há evidência de comportamento observado em
issues do próprio projeto oficial), mas porque não há, até esta rodada,
confirmação por página de documentação formal que a sustente
especificamente. Se essa fonte vier a ser localizada em rodada futura, a
afirmação pode ser reintroduzida com a citação correta.

## 15. Papel ainda não decidido da Supabase CLI

Distinção explícita, não fechada por esta análise:

- **Compatibilidade de nomenclatura** com a CLI — pode ser adotada desde já
  (seção 13), sem custo, sem decidir instalar ou usar a CLI.
- **Decisão de instalar a CLI** — não tomada, não é parte de `DA-P4-03`.
- **Decisão de adotar a CLI como autoridade operacional** de migrations
  deste repositório (o que implicaria mover arquivos para
  `supabase/migrations/`, criar `config.toml`, rodar `link`) — decisão maior,
  distinta, não tomada e não analisada em detalhe de execução aqui.
- **`migration repair`** — comando existente para reconciliar histórico
  remoto e local, mas que **muta** a tabela de histórico; não há evidência
  de que seja necessário hoje, e não deve ser executado sem decisão própria
  e futura.

## 16. Parecer final e decisão canônica proposta

**Parecer:** `DA-P4-03_pode_fechar`.

Justificativa: a equivalência semântica do legado está comprovada por
evidência primária direta (seções 7 e 8), não por inferência — inclusive
com hashes normalizados idênticos calculados independentemente em ambos os
lados nesta rodada; a regra de nomenclatura/ordenação para migrations
futuras de `P4I` é autocontida e não depende de nenhuma decisão de
infraestrutura pendente sobre a CLI; **a exigência do manifesto
local↔remoto está fechada como parte de `DA-P4-03`** (seção 12.1) — não é
mais uma pendência em aberto. Permanecem em aberto apenas: o mecanismo
exato de aplicação histórica (seção 10, indeterminado por natureza); a
decisão de adotar ou não a Supabase CLI como autoridade operacional (seção
15); e, dentro do manifesto já obrigatório, apenas sua **localização
física, formato documental exato, e a rodada em que será fisicamente
criado** — nunca a exigência de que ele exista, que já está fechada.

**Decisão canônica proposta em uma frase:** O legado permanece imutável e
reconciliado por manifesto obrigatório que vincula versões remotas, nomes,
arquivos e hashes; migrations futuras usam versão UTC única de 14 dígitos
posterior a `20260731164424`, sem alteração após aplicação, e rollbacks são
vinculados por versão, nome, filename e SHA-256, sempre fora do fluxo de
migrations de avanço, independentemente da futura adoção da Supabase CLI.

## 17. Declaração de escopo

Este parecer é uma análise técnica registrada para revisão. **Não autoriza**
qualquer alteração de histórico remoto, criação de manifesto, criação de
representações operacionais, instalação ou configuração de Supabase CLI, ou
criação de qualquer migration. Nenhuma decisão aqui descrita está aprovada
até que o Gabriel a aprove explicitamente, seguindo o processo já em uso
neste projeto (especificação aprovada → implementação → revisão → aprovação
final).
