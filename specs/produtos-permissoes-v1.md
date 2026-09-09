# Base de produtos e permissões no portal Cappia — spec v1

**Status:** **aprovada, ainda não implementada.** Aprovada pelo Gabriel em
2026-09-08, após três rodadas de revisão, sem bloqueadores. **Nada
implementado:** sem código, sem migration criada, sem alteração no portal
ou na Edge Function `criar-clinica`, sem deploy. A implementação depende de
autorização própria (processo em `AGENTS.md`).

**Aderência a `docs/00-principios.md`:** sim.
- *Responsabilidade correta:* isto é puramente Core determinístico (validar
  capacidade a partir de um valor de coluna) — não há linguagem natural
  envolvida, nada disto pertence à IA.
- *Remoção:* a spec não cria tabela nova, não cria policy/RLS nova, não cria
  taxonomia de "features", não cria flag temporária nem modo de transição.
  Os artefatos novos são **uma coluna** e **um arquivo** com um mapa
  constante.
- *Teste isolado / testes realistas:* os testes exigidos (seção 8) isolam o
  mecanismo novo (produto → capacidade) e não podem passar por outro
  caminho.

**O que esta spec NÃO decide (fora de escopo, por pedido explícito):**
telas e cadeados específicos; o mapa de quais telas/configurações pertencem
a cada produto; proteção rota a rota; cadastro/onboarding; teste grátis,
`expira_em`, vencimento; cobrança/PIX; painel administrativo; plano
intermediário; qualquer implementação, migration criada, commit, push ou
deploy.

**O que esta frente entrega:** somente a fundação — **identificação do
produto da clínica** e a **fonte central de capacidades**. Nada mais é
ligado nesta frente.

---

## 0. Contexto e problema

Está sendo aberta uma frente para oferecer **níveis de produto** no mesmo
portal Cappia (`iris-portal-v2`, produção em `painel.cappia.app`).

Produtos desta etapa — **exatamente dois**:

| Produto | Significado |
|---|---|
| `odontograma` | Produto reduzido: pacientes, dentistas e odontograma. |
| `iris_completa` | Produto completo (tudo que o portal oferece hoje). |

**Fato central que orienta toda a spec:** os dois produtos rodam sobre
**a mesma conta, a mesma clínica, o mesmo banco, os mesmos usuários,
pacientes e dentistas**. Não existe segundo aplicativo, segundo deploy nem
cópia de dados. A diferença entre um produto e outro é **só o conjunto de
capacidades que a clínica enxerga e pode usar** — nada muda no dado.

O que a clínica de produto `odontograma` não contrata (agenda, Iris no
WhatsApp, financeiro/orçamento, etc.) continua existindo no schema e no
código; ela apenas não tem acesso.

---

## 1. Evidência do estado atual (auditoria — lida do código e do banco, 2026-09-08)

Levantado direto de `iris-portal-v2/src` e do banco de produção
`udizowyfjnhuhgxkeayk`. **Usado só como evidência do estado atual, não como
arquitetura obrigatória.**

### 1.1 `clinicas.plano` existe e é um eixo comercial, não de produto

- `clinicas.plano` — `text | null` (`src/lib/database.types.ts:329`).
- Lida no admin em `src/app/admin/page.tsx:16,178` e
  `src/app/api/admin/clinicas/route.ts:42,54,81` — apenas **exibida** numa
  coluna da tabela de clínicas. Nenhuma lógica de portal ramifica nela hoje.
- Exposta no tipo `Clinica` (`src/lib/supabase.ts:273`) como `plano?: string`.

### 1.2 Valores reais hoje em `clinicas.plano` (2 clínicas no banco)

| clínica | `plano` | `max_dentistas` |
|---|---|---|
| Cleardent (teste) | `"profissional"` | `10` |
| teste 1 | `"1_dentista"` | `1` |

Os dois valores descrevem **faixa comercial / porte da clínica**. Nenhum
deles é um produto. `max_dentistas` já carrega a quantidade de dentistas,
em coluna separada.

### 1.3 Como o portal resolve "qual clínica" e onde já existe proteção real

- **Sessão assinada** (HMAC-SHA256) em cookie httpOnly, `src/lib/session.ts`.
  O payload carrega `clinica_id` — **o navegador nunca envia a `clinica_id`
  que vale**. Dois tipos de login: dono (`iris_session`) e profissional
  dentista/assistente (`iris_prof_session`). `resolverContexto()` /
  `resolverContextoVivo()` devolvem `{ clinica_id, perfil, ... }`.
- **Proxy server-side `/api/secure/*`** (`src/lib/supabase.ts:11-16`,
  `src/app/api/secure/clinica/route.ts`): as tabelas sensíveis passam por
  rotas Next que usam a **service key** (só no servidor) e **forçam a
  `clinica_id` da sessão**, ignorando qualquer id vindo do cliente.
- **Por que o RLS não serve para autorizar produto.** Correção da 1ª
  rodada: uma tabela com RLS habilitada e nenhuma policy **nega** acesso
  por padrão — não é uma tabela desprotegida. O problema para *esta*
  autorização é outro: **as rotas do portal usam `service_role`, que
  ignora RLS por completo**. Qualquer regra de produto escrita como policy
  seria simplesmente não avaliada no caminho que o portal realmente usa.
  Por isso o controle de produto **tem de ocorrer no servidor**, dentro das
  rotas — não no banco. (Contexto do levantamento de RLS:
  `docs/mapa-supabase-2026-08-18.md` §5.)
- Já existe um mecanismo de **permissões por assistente** (objeto
  `Assistente.permissoes`, `src/lib/supabase.ts:244-262`) — booleans por
  ação, dentro do jsonb da clínica. É **permissão de papel dentro da
  clínica**, ortogonal a produto. Esta spec não mexe nele e não o imita.

### 1.4 Quem escreve em `clinicas` hoje: a Edge Function `criar-clinica`

O cadastro de clínica novo passa pela Edge Function `criar-clinica`
(`cappia-tales/supabase/edge-iris/criar-clinica/index.ts`). O `INSERT` em
`clinicas` (linhas 93-102) envia uma lista **fixa** de campos — `nome`,
`email`, `telefone`, `pais`, `pais_codigo`, `responsavel`, `slug`, `ativo`,
`estado`, `cep`, `idioma`, `fuso_horario`, `telefone_agente` e,
condicionalmente, `lead_origem`. **Não envia `produto`** (nem poderia: a
coluna não existe).

Consequência direta, achada na 3ª rodada de revisão: uma coluna
`NOT NULL` **sem default** quebraria **todo cadastro novo no instante da
migration**, sem nenhuma permissão ou cadeado ligado. E quebraria mal — o
erro do banco cai no `catch` genérico da linha 104, que devolve ao
navegador `"Não foi possível concluir o cadastro. Tente novamente."` e
esconde a causa real. É a origem da decisão de default na §2.1.

### 1.5 Não há decisão canônica anterior sobre produto/plano

`docs/04-decisoes-canonicas.md` não contém nenhuma decisão sobre níveis de
produto, planos ou capacidades. Não há spec anterior sobre o assunto. Esta
é a primeira.

---

## 2. Decisão: coluna nova `clinicas.produto`

**Decisão: criar `clinicas.produto`. Preservar `clinicas.plano` intocada.**

> **Correção registrada.** A 1ª versão desta spec propôs reutilizar
> `clinicas.plano` em nome da simplicidade. O Gabriel corrigiu:
> **produto e plano comercial são eixos diferentes**, e os valores atuais
> (`profissional`, `1_dentista`) são a prova — descrevem porte/faixa, não
> o que a clínica contratou como produto. Simplicidade não significa
> misturar significados diferentes; a migration pequena é o preço correto
> a pagar. `plano` continua existindo, com os mesmos valores, para o que
> ela sempre foi.

### 2.1 Forma da coluna

| | |
|---|---|
| Coluna | `clinicas.produto` |
| Tipo | `text` |
| Nulidade | `NOT NULL` |
| Restrição | `CHECK (produto IN ('odontograma', 'iris_completa'))` |
| Default | `DEFAULT 'iris_completa'` — transição segura, ver §2.3 |

`NOT NULL` + `CHECK` juntos tornam **impossível** uma clínica existir com
produto ausente ou inválido. Não é uma validação de conveniência: é a
garantia que dispensa qualquer fallback no código (seção 5).

### 2.3 Por que a coluna nasce com `DEFAULT 'iris_completa'`

> **Correção registrada (3ª rodada).** A 2ª versão desta spec propôs
> `NOT NULL` **sem default**, argumentando que "o valor é sempre uma
> decisão explícita". Isso ignorava o escritor atual: a Edge Function
> `criar-clinica` não envia `produto` (§1.4), então a coluna sem default
> **quebraria todo cadastro novo no instante da migration** — sem nenhuma
> permissão ou cadeado ligado, e com a causa escondida atrás da mensagem
> genérica de erro da própria função.

O default existe por uma razão só: **preservar temporariamente o
comportamento atual**. Enquanto a escolha de produto não existe em lugar
nenhum do fluxo, toda clínica nova continua nascendo `iris_completa` —
exatamente o que ela já é hoje, já que hoje todo cadastro dá acesso
completo ao portal. O default não muda comportamento; ele **mantém** o
comportamento vigente enquanto a escolha não existe.

**Isto não é uma flag nem um modo de compatibilidade.** Não há condicional,
não há caminho alternativo, não há nada a "ligar" depois. É um valor de
coluna no banco, escrito pelo Postgres quando o escritor atual omite o
campo — a transição segura mínima para não quebrar quem já escreve.

**Ciclo de vida do default (registrado, não executado agora):**

1. **Agora (esta frente):** `DEFAULT 'iris_completa'`. Cadastro atual
   continua funcionando, toda clínica nova nasce com o produto que já
   receberia na prática.
2. **Frente de onboarding (futura, fora de escopo):** a escolha do produto
   passa a existir para o cliente, e `criar-clinica` passa a **enviar
   `produto` explicitamente** conforme essa escolha.
3. **Ainda nessa frente futura:** com o escritor mandando o valor sempre, o
   `DROP DEFAULT` pode ser aplicado — assim **nenhuma clínica nova nasce
   sem escolha explícita**. Remover o default antes disso apenas
   reintroduziria a quebra.

A frente de onboarding **não é aberta aqui**; os passos 2 e 3 estão
registrados só para que a remoção do default seja uma decisão já prevista,
e não uma descoberta futura.

Os valores são os dois nomes de produto em `snake_case` — legíveis em
qualquer query e no admin, não códigos secretos nem aleatórios.

Plano intermediário está fora de escopo. Quando existir, entra como mais
um valor no `CHECK` e mais uma linha no catálogo da seção 3 — sem mudança
estrutural.

### 2.2 Migration (descrita, não criada)

Nenhum arquivo de migration é criado nesta etapa. A forma aprovada, para
quando a implementação for autorizada, é **SQL versionada** (mesmo processo
já usado no projeto), numa transação:

1. `ALTER TABLE clinicas ADD COLUMN produto text DEFAULT 'iris_completa';`
   — o default já entra aqui (§2.3) e preenche as linhas existentes.
2. `UPDATE clinicas SET produto = 'iris_completa' WHERE produto IS NULL;` —
   rede de segurança explícita para as clínicas existentes (§5.1). Com o
   default do passo 1 nenhuma linha deve sobrar nula; o `UPDATE` garante
   que o passo 3 não falhe caso alguma sobre.
3. `ALTER TABLE clinicas ALTER COLUMN produto SET NOT NULL;` e
   `ALTER TABLE clinicas ADD CONSTRAINT clinicas_produto_check CHECK (produto IN ('odontograma','iris_completa'));`

Sem `GRANT` novo: a coluna nasce dentro de `clinicas`, tabela que já tem os
privilégios necessários. `database.types.ts` é regerado (é arquivo gerado,
`AGENTS.md` do portal).

**Verificação obrigatória depois da migration:** criar uma clínica pela
Edge Function `criar-clinica` e confirmar que o cadastro conclui e que a
linha nasce com `produto = 'iris_completa'`. É a prova de que o escritor
atual (§1.4) não quebrou — o motivo de existir o default.

**Nenhuma alteração em `criar-clinica` nesta frente.** A função continua
como está, sem enviar `produto`; quem preenche é o default.

---

## 3. Fonte central única: produto → capacidades

**Um único arquivo** converte produto em capacidades. É a fonte que os
cadeados de interface e as proteções de rota — **ambos da próxima frente** —
vão reutilizar. Fora dele, nenhum lugar do código decide o que um produto
pode fazer.

### 3.1 Arquivo

`iris-portal-v2/src/lib/produtos.ts` (novo — único artefato de código novo
desta spec).

### 3.2 Capacidades registradas agora — somente as confirmadas

> **Correção registrada.** A 1ª versão listou seis capacidades inventadas
> por mim (`agenda`, `iris_whatsapp`, `financeiro`, `config_clinica`, …) e
> deu ao produto `odontograma` apenas `["odontograma"]` — errado nos dois
> lados. O produto `odontograma` **inclui obrigatoriamente pacientes,
> dentistas e odontograma**. E `dentistas` **não pode** ser agrupado dentro
> de uma capacidade ampla como `config_clinica`, porque algumas
> configurações serão bloqueadas e outras não — o agrupamento decidiria por
> antecipação um mapa que ainda não existe.

Ficam registradas **somente as três capacidades já confirmadas pelo
Gabriel**:

| Capacidade | Significado |
|---|---|
| `pacientes` | Cadastro e gestão de pacientes. |
| `dentistas` | Cadastro e gestão de dentistas. |
| `odontograma` | Prontuário/odontograma clínico. |

**A classificação das demais telas e configurações é etapa posterior, com
o Gabriel.** Esta spec não inventa o mapa detalhado. `iris_completa` é
descrito como "todas as capacidades" de forma que não exija enumerar o que
ainda não foi classificado (seção 3.3).

### 3.3 Conteúdo do arquivo

```ts
// src/lib/produtos.ts
//
// FONTE CENTRAL ÚNICA: converte o produto da clínica (clinicas.produto) em
// capacidades. Cadeados de tela e proteções de rota (PRÓXIMA FRENTE)
// consomem SÓ daqui. Nenhum outro lugar do código decide o que um produto
// libera.

/** Produtos oferecidos. Espelha o CHECK de `clinicas.produto`. */
export const PRODUTOS = ["odontograma", "iris_completa"] as const;
export type Produto = (typeof PRODUTOS)[number];

/**
 * Capacidades CONFIRMADAS até aqui. Lista deliberadamente curta e
 * incompleta de propósito: a classificação das demais telas e
 * configurações é uma etapa posterior com o Gabriel (spec §3.2).
 * Não acrescentar capacidade por antecipação.
 */
export const CAPACIDADES = ["pacientes", "dentistas", "odontograma"] as const;
export type Capacidade = (typeof CAPACIDADES)[number];

/**
 * Catálogo central. Único ponto onde produto vira conjunto de capacidades.
 *
 * `iris_completa` recebe TODAS as capacidades conhecidas — inclusive as que
 * forem acrescentadas na etapa de classificação. Por isso é derivado de
 * CAPACIDADES em vez de ser uma lista literal: uma capacidade nova nunca
 * pode nascer faltando no produto completo.
 */
const CATALOGO: Record<Produto, readonly Capacidade[]> = {
  odontograma: ["pacientes", "dentistas", "odontograma"],
  iris_completa: CAPACIDADES,
};

/**
 * Capacidades de um produto.
 *
 * NÃO existe fallback: `clinicas.produto` é NOT NULL + CHECK, então um
 * valor fora do catálogo é impossível por construção. Se ainda assim
 * chegar aqui (tipo mentindo, dado montado à mão), o resultado é NENHUMA
 * capacidade — falha fechada, nunca concessão parcial. Ver spec §5.2.
 */
export function capacidadesDe(produto: Produto): readonly Capacidade[] {
  return CATALOGO[produto] ?? [];
}

/** Pergunta única que todo consumidor (tela ou rota) faz. */
export function temCapacidade(produto: Produto, capacidade: Capacidade): boolean {
  return capacidadesDe(produto).includes(capacidade);
}
```

### 3.4 Por que assim e não de outro jeito

- **Sem tabela de features no banco:** o mapa produto→capacidade é regra de
  produto, não dado de clínica. Uma tabela nova exigiria migration, GRANT e
  outra fonte de verdade para manter em sincronia. Um `Record` constante é
  revisável em diff e não pode divergir de si mesmo.
- **`iris_completa` derivado de `CAPACIDADES`, não literal:** garante que
  toda capacidade acrescentada na etapa de classificação já nasça no
  produto completo. O erro oposto (capacidade nova esquecida no produto que
  deveria tê-la) fica impossível.
- **`odontograma` é literal:** é justamente a lista que precisa de decisão
  explícita do Gabriel, item por item. Derivá-la seria adivinhar.
- **`Produto` e `Capacidade` são unions, não string livre:** o
  `next build` type-checka e é o portão real de CI (`AGENTS.md` do portal).
  Um cadeado que peça uma capacidade inexistente não compila até ela ser
  adicionada de propósito aqui.

---

## 4. Como consultar — portal e rotas

O `clinicas.produto` **nunca vai para o cliente como autoridade**. Segue a
mesma regra do `clinica_id`: quem manda é o servidor.

### 4.1 Nesta frente

Esta frente entrega **a coluna e a fonte central**, e nada além disso.
Nenhuma rota passa a bloquear, nenhuma tela passa a esconder.

> **Correção registrada.** A 1ª versão falava em checagem "implementada mas
> inerte" nas rotas. Isso está retirado: **não se cria flag temporária nem
> modo inerte**. Código que existe mas não age é dívida disfarçada de
> progresso — e obriga uma segunda decisão ("ligar quando?") que ninguém
> registrou.

### 4.2 Na próxima frente (registrado aqui só para fixar o contrato)

A proteção de rota e os cadeados de interface pertencem à **próxima
frente**, e **só serão ligados juntos, depois do mapa de telas**. O
contrato que esta spec fixa para lá:

- **A proteção real é no servidor.** Cada rota `/api/secure/*` resolve a
  clínica da sessão (como já faz), lê `clinicas.produto` e consulta
  `temCapacidade` **antes do efeito**, respondendo 403 sem tocar no banco
  quando negado. Não pode ser policy de RLS: as rotas usam `service_role`,
  que ignora RLS (§1.3).
- **O cadeado visual é conveniência, não segurança.** Esconder um botão
  sem a checagem de servidor deixaria qualquer `fetch` manual passar.
- **Uma única pergunta, um único lugar:** tela e rota perguntam
  `temCapacidade(produto, capacidade)` e nada mais. Ninguém compara string
  de produto solta; ninguém recria o mapa.

---

## 5. Compatibilidade e falha — duas coisas separadas

> **Correção registrada.** A 1ª versão juntou as duas num único fallback
> ("desconhecido → `odontograma`"), o que teria **removido acesso das
> clínicas existentes** e, pior, concedido um produto parcial por
> inferência, sem decisão registrada. São problemas distintos e têm
> tratamentos distintos.

### 5.1 Compatibilidade: clínicas existentes são `iris_completa`, explicitamente

As clínicas que existem hoje **já têm acesso completo ao portal**. Preservar
esse acesso não é uma escolha de risco — é manter o que a clínica já tem.

A migration (§2.2) deixa **todas as clínicas existentes** com
`produto = 'iris_completa'` gravado na linha — dado real, visível em
qualquer query, não inferência em tempo de execução.

**Clínicas novas, criadas depois da migration**, nascem com o mesmo valor,
vindo do `DEFAULT` (§2.3), pela mesma razão: enquanto a escolha de produto
não existe, todo cadastro continua sendo Iris completa, como já é hoje.

Efeito prático: no dia em que a próxima frente ligar os cadeados, **nenhuma
clínica — existente ou criada nesse intervalo — perde nada**. Quem for
`odontograma` será quem o Gabriel marcar como tal, um `UPDATE` de cada vez.

### 5.2 Falha: valor nulo ou inválido não vira produto nenhum

Um `produto` nulo ou fora do catálogo **não deve virar silenciosamente
`odontograma`** — conceder parcialmente um produto sem decisão registrada é
exatamente o erro a evitar.

Duas barreiras, nesta ordem:

1. **É impossível por construção.** `NOT NULL` + `CHECK` no banco (§2.1).
   Não existe linha de clínica com produto ausente ou inválido.
2. **Se ainda assim chegar ao código, falha fechada.** `capacidadesDe`
   devolve **nenhuma capacidade** (`[]`) para um valor fora do catálogo —
   não `odontograma`, não `iris_completa`. Sem acesso é um estado
   diagnosticável; produto parcial silencioso não é.

Não há "modo de compatibilidade", flag de transição nem fallback no código.

**O `DEFAULT` do banco (§2.3) não é um fallback e não contradiz isto.** São
coisas diferentes: o default decide o que gravar **quando o escritor omite
a coluna**, no momento do `INSERT`, produzindo um valor real e auditável na
linha. Um fallback decidiria o que fazer **quando o valor lido é inválido**,
em tempo de leitura, mascarando um dado errado. O primeiro preserva o
cadastro atual; o segundo é o que esta seção proíbe.

---

## 6. Upgrade / downgrade sem migrar nem apagar dados

Trocar de produto é **`UPDATE clinicas SET produto = '<produto>' WHERE id = ...`**
e nada mais.

- **Upgrade** (`odontograma` → `iris_completa`): as capacidades novas
  passam a valer na hora seguinte. Agenda, Iris, financeiro já existem no
  schema e no código para aquela clínica — só estavam sem acesso. Nenhum
  backfill, nenhuma criação de registro.
- **Downgrade** (`iris_completa` → `odontograma`): as capacidades saem.
  **Os dados permanecem intactos** — agendamentos, orçamentos, config da
  Iris continuam nas tabelas, apenas inacessíveis pelo produto atual. Um
  upgrade posterior os devolve como estavam.
- **Sem efeito colateral:** a troca não dispara migration, não mexe em
  `plano`, não mexe em `max_dentistas`, não toca em nenhuma outra tabela.
- **Quem troca:** o Gabriel, direto no banco ou por onde ele já edita
  clínica. Tela de admin para isso está **fora de escopo**.

---

## 7. Arquivos

| Arquivo | Mudança |
|---|---|
| migration SQL versionada | **Descrita em §2.2, não criada nesta etapa.** Adiciona `clinicas.produto` com `NOT NULL` + `CHECK` + `DEFAULT 'iris_completa'` e deixa `iris_completa` nas clínicas existentes. |
| `iris-portal-v2/src/lib/produtos.ts` | **Novo.** Conteúdo de §3.3. Único artefato de código novo. |
| `iris-portal-v2/src/lib/produtos.test.ts` | **Novo.** Testes de §8. |
| `iris-portal-v2/src/lib/database.types.ts` | Regerado após a migration (arquivo gerado, nunca editado à mão). |

**Não há nesta frente:** alteração em rota `/api/secure/*`, cadeado de
tela, **alteração na Edge Function `criar-clinica`**, tabela nova,
policy/RLS nova, `GRANT` novo, mudança em `clinicas.plano`, mudança no
fluxo de sessão, mudança em `Assistente.permissoes`, flag temporária.

---

## 8. Testes essenciais

Arquivo: `iris-portal-v2/src/lib/produtos.test.ts` (mesmo runner dos
`*.test.ts` já existentes em `src/lib/`). Testes **puros** — nenhum depende
de sessão, banco, rota ou tela.

1. **`odontograma` tem exatamente as três capacidades confirmadas.**
   `capacidadesDe("odontograma")` contém `pacientes`, `dentistas` e
   `odontograma` — e nada além disso. (Trava direta da correção 2: o
   produto reduzido **não** é só odontograma.)

2. **`iris_completa` contém todas as capacidades conhecidas.**
   Para toda `c` de `CAPACIDADES`, `temCapacidade("iris_completa", c) === true`.
   Falha na hora se uma capacidade nova for acrescentada sem entrar no
   produto completo.

3. **`iris_completa` é superconjunto de `odontograma`.**
   Toda capacidade de `odontograma` também está em `iris_completa`.
   (Garante que um downgrade nunca conceda algo que o produto completo não
   tem — e que o reduzido não é um conjunto solto.)

4. **`dentistas` é capacidade própria, não derivada.**
   `temCapacidade("odontograma", "dentistas") === true`, e `"dentistas"`
   consta de `CAPACIDADES` como entrada independente. (Trava da correção 2:
   dentistas não pode ter sido agrupado dentro de outra capacidade ampla.)

5. **Valor fora do catálogo não concede nada.**
   `capacidadesDe("plano_qualquer" as Produto)` devolve `[]`, e
   `temCapacidade("plano_qualquer" as Produto, "odontograma") === false`.
   Verifica explicitamente que **não** virou `odontograma` nem
   `iris_completa`. (Trava da correção 3: falha fechada, nunca produto
   parcial.)

6. **O catálogo cobre todo `Produto` declarado.**
   Para todo `p` de `PRODUTOS`, `CATALOGO[p]` existe e é não-vazio. Falha
   se alguém acrescentar um produto sem mapear capacidades.

7. **Produto e plano comercial não se confundem.**
   Os valores comerciais reais `"profissional"` e `"1_dentista"` não
   pertencem a `PRODUTOS`. (Trava da correção 1: eixos separados.)

**O que estes testes deliberadamente NÃO cobrem:** o `DEFAULT` da coluna
(§2.3) é comportamento do Postgres, não do módulo — nenhum teste puro pode
prová-lo. A prova dele é a **verificação pós-migration** descrita em §2.2:
criar uma clínica pela `criar-clinica` e conferir que conclui com
`produto = 'iris_completa'`. Registrado aqui para que a lacuna seja
explícita, e não confundida com cobertura (`docs/00-principios.md`,
princípio do teste isolado).

Fora de escopo de teste agora: rota devolvendo 403 e cadeado de tela — a
próxima frente traz o comportamento e o teste dele junto.

---

## 9. O que fica decidido se esta spec for aprovada

1. Produto da clínica mora em **coluna nova `clinicas.produto`**, `text`,
   `NOT NULL`, `CHECK (produto IN ('odontograma','iris_completa'))`,
   `DEFAULT 'iris_completa'`. **`clinicas.plano` é preservada intocada** —
   produto e plano comercial são eixos diferentes.
2. `max_dentistas` e `plano` continuam sendo porte e faixa comercial;
   produto não se mistura com preço nem com quantidade.
3. **`iris-portal-v2/src/lib/produtos.ts`** é a **única** fonte que
   converte produto em capacidades, pela função `temCapacidade`.
4. Capacidades registradas agora: **`pacientes`, `dentistas`,
   `odontograma`** — as três confirmadas, e as três que compõem o produto
   `odontograma`. A classificação das demais telas e configurações é etapa
   posterior com o Gabriel.
5. **Clínicas existentes recebem `iris_completa`** na migration — preservam
   o acesso completo que já têm. **Clínicas novas nascem `iris_completa`
   pelo `DEFAULT`**, porque a Edge Function `criar-clinica` não envia
   `produto` e não é alterada nesta frente. O default preserva
   temporariamente o comportamento atual; **não é flag nem modo de
   compatibilidade**, e sai na frente de onboarding, quando o produto
   passar a ser enviado explicitamente conforme a escolha do cliente —
   para que nenhuma clínica nova nasça sem escolha explícita. Essa frente
   **não é aberta aqui**.
6. **Produto nulo ou inválido é impossível** (`NOT NULL` + `CHECK`); se
   chegasse ao código, resultaria em **nenhuma capacidade**. Nunca em
   produto parcial por inferência. O `DEFAULT` age no `INSERT` que omite a
   coluna, nunca na leitura de um valor inválido — não é fallback.
7. Upgrade/downgrade = um `UPDATE` em `clinicas.produto`. Nunca migra nem
   apaga dado; downgrade só retira acesso.
8. **Esta frente entrega apenas a fundação** (coluna + fonte central).
   Proteção de rota e cadeados de tela pertencem à **próxima frente** e
   **só serão ligados juntos, depois do mapa de telas**. Não se cria flag
   temporária nem modo inerte.
9. Quando a proteção for feita, ela é **no servidor, dentro das rotas** —
   não em RLS, porque as rotas usam `service_role`, que ignora RLS.
