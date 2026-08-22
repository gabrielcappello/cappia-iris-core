# Avaliação fixa no catálogo, gratuidade opcional por clínica — spec v1

**Status:** proposta pronta para implementação, decisões fechadas com o
Gabriel em 2026-08-22. **Ainda não implementada.**

**Origem:** durante a aprovação de `specs/recomendacao-avaliacao-paciente-
novo-v1.md`, o Gabriel pediu três coisas fora daquela spec (ela funciona
igual com ou sem isto aqui):

1. "Avaliação" vira procedimento **fixo** no catálogo de toda clínica —
   nunca desativável, nem nas clínicas já cadastradas hoje.
2. Avaliação pode ser marcada como **gratuita**.
3. Uma **flag por clínica** habilita a Iris a informar que a avaliação é
   gratuita — implica que a gratuidade é OPCIONAL, escolhida pela clínica,
   nunca um valor forçado (ver correção na seção 0).

## 0. Decisões fechadas (Gabriel, 2026-08-22, corrigidas em 2026-08-22)

**Correção registrada:** a primeira versão desta spec confundiu duas coisas
diferentes do pedido original — "gratuita por padrão" (item 2) virou
"gratuita obrigatória, sem escolha" no desenho, o que apagava o item 3
("flag por clínica para *informar* que é gratuita" pressupõe que a clínica
pode NÃO ser gratuita). O Gabriel corrigiu: a clínica sempre pôde e continua
podendo escolher. O que é fixo é só a EXISTÊNCIA e ATIVAÇÃO do item
"Consulta / Avaliação" no catálogo — nunca o preço dele.

| Pergunta | Decisão |
|---|---|
| Escopo de "fixo" | **Trava real, só sobre existência/ativação** — "Consulta / Avaliação" sempre presente e ativa no catálogo, sem botão de desligar, em nenhuma clínica, inclusive as já cadastradas hoje. |
| Gratuidade | **Escolha da clínica, não imposição.** Cada clínica liga ou desliga um toggle de "é gratuita?" para esse item, exatamente como já faz para os outros procedimentos com "Informa valor?". Se ligado, a Iris pode dizer que é gratuita. Se desligado, o item se comporta como qualquer procedimento normal — com `valor` e `mostrar_valor`/preço configurável pela clínica, do jeito que já funciona hoje. |
| Cadastro existente com preço | **Preservado, nunca sobrescrito.** Clínicas que já têm "Consulta / Avaliação" com valor definido continuam com esse valor e esse fluxo normais — a única mudança forçada é que o item não pode mais ser desativado (`ativo` vira sempre `true`). Nada no preço ou na gratuidade muda sem a clínica mexer. |
| Alcance | **Retroativo, todas as clínicas** — mas só para a parte de ativação/existência (linha acima). Preço e gratuidade continuam como cada clínica já tinha configurado. |
| Tela legada do painel (`dashboard/procedimentos/page.tsx`) | **Remover**, confirmado sem consumidor (ver seção 1). |
| Reconhecimento do item | **Nome de texto fixo "Consulta / Avaliação"**, sem migrar `clinicas.precios` para `procedimento_id`/FK — fora de escopo, mudança estrutural maior que esta spec. |
| Escopo de arquivos do painel | **Só `dashboard/page.tsx`** (`ProcedimentosSection`), a tela ativa. |
| Forma da migration | **SQL versionada**, seguindo o mesmo processo de migrations já usado no projeto — nunca script avulso. |

## 1. Levantamento técnico (2026-08-22, antes de especificar)

### 1.1 Duas telas de configuração de procedimentos hoje — uma órfã

- **Ativa:** `iris-portal-v2/src/app/dashboard/page.tsx`, componente
  `ProcedimentosSection` (~linha 2359). Grava `clinicas.precios` como array
  `{esp, nome, ativo, valor, mostrar_valor, tempo}`, com `ativo` explícito
  por item. `update()`/`toggleEspAtivo()` reescrevem o array inteiro no
  `UPDATE` (`onSave({precios: precos})`), nunca um patch incremental.
- **Órfã, a remover:** `iris-portal-v2/src/app/dashboard/procedimentos/
  page.tsx`. Confirmado sem consumidor: nenhum `Link`/`router.push`/`href`
  no repositório aponta pra ela; não consta no array de tabs de
  `dashboard/layout.tsx:17-24`; grava no mesmo campo `clinicas.precios` que
  a tela ativa (nenhum dado exclusivo); sem menção em specs/docs. Compila e
  é acessível por URL direta, mas nada no app a referencia.
  **Ressalva não verificável tecnicamente:** bookmark ou link externo salvo
  por algum dono de clínica fora do repositório — risco aceito pelo Gabriel.
  Essa tela também não grava `ativo` (schema antigo, `{esp, nome, valor,
  tempo, mostrar_valor}`), então `derivarPrecosClinica` já ignora qualquer
  item salvo só por ela (`item.ativo !== true` → descartado,
  `precos-clinica.ts:106`) — bug latente preexistente que a remoção também
  encerra, de passagem.

### 1.2 `consultation_evaluation` / "Consulta / Avaliação" hoje

- Já existe hardcoded em `ESPECIALIDADES` (`dashboard/page.tsx:179`):
  `{id:'consultation_evaluation', nome:'Consulta / Avaliação', tempo:30}`,
  primeiro item do grupo "🦷 Clínico Geral".
- `procedimentos_catalogo` (tabela global, sem `clinica_id`) tem o mesmo
  `id` semântico, usado só na malha `clinicas.dentistas[].procedimentos[].
  id` (vínculo dentista↔procedimento) — **desacoplado de `clinicas.
  precios`**, que correlaciona por `nome` em texto (`initPrecos`, linha
  2375: `arr.find(a => a.nome === p.nome)`). Não há FK entre as duas.
- Dado real confirmado no operacional (`udizowyfjnhuhgxkeayk`, 2026-08-22):
  as duas clínicas de teste (`gabriel teste`, `cleardent`) já têm "Consulta
  / Avaliação" com `ativo:true`, `mostrar_valor:false`, e **valor definido**
  (`R$100` e `R$120` respectivamente) — não `0`. **Preservado sem alteração**
  pela migration (seção 2.3): já estão `ativo:true`, então a migration não
  precisa tocar nelas; o preço e a ausência de gratuidade continuam como
  estão até a própria clínica decidir mudar.

### 1.3 `criar-clinica` não semeia nada hoje

Edge Function `criar-clinica` (projeto `udizowyfjnhuhgxkeayk`, v12) só faz
`insert` em `clinicas` e `usuarios` — **nunca escreve `precios`**. Clínica
nasce com `precios` ausente; o catálogo só existe depois que o dono abre o
painel e salva pela primeira vez (`initPrecos` monta os ~46 itens padrão
nesse momento, todos `ativo: true` por default do array `ESPECIALIDADES`).

**Consequência para esta spec:** a trava de "Avaliação sempre presente"
precisa valer também para clínica **recém-criada, antes de qualquer save**
— não só para quem já salvou o catálogo pelo menos uma vez. Ver seção 2.1.

## 2. Desenho

### 2.1 No painel (`ProcedimentosSection`, `dashboard/page.tsx`)

- **`initPrecos()`** (linha 2370): ao montar o item "Consulta / Avaliação"
  a partir de `ESPECIALIDADES`, força só `ativo: true` **incondicionalmente**
  (reconhecido por `p.nome === 'Consulta / Avaliação'`) — nunca lê
  `salvo.ativo` para esse item específico. `valor`, `mostrar_valor` e o novo
  `gratuito` continuam lidos normalmente de `salvo` (ou default `false`/`0`
  quando ausente), exatamente como qualquer outro procedimento. Cobre o
  caso de clínica nova sem `precios` salvo nenhum (seção 1.3): ela nasce com
  a Avaliação ativa e sem gratuidade marcada (estado normal, igual a
  qualquer outro item novo).
- **Toggle "Faz?" (`ativo`)** (linha 2488): desabilitado (`disabled` no
  `Toggle`, ou omitido) especificamente para "Consulta / Avaliação" — sem
  chance de desligar pela UI. Único controle afetado.
- **Toggle em massa por especialidade** (`toggleEspAtivo`, linha 2395):
  como "Consulta / Avaliação" está no grupo "🦷 Clínico Geral", o toggle
  "desligar tudo da especialidade" não pode incluí-la — `toggleEspAtivo`
  passa a preservar `ativo: true` pra esse item específico mesmo quando
  `value === false` para o resto do grupo.
- **Novo toggle "É gratuita?"** — controle adicional específico para
  "Consulta / Avaliação" (não existe para nenhum outro procedimento),
  mesma mecânica de `mostrar_valor`: liga/desliga `gratuito` via
  `update('Consulta / Avaliação', 'gratuito', v)`.
  - **Gratuita ligada:** oculta por completo o toggle "Informa valor?" e o
    campo `valor` desse item — nada além do toggle "É gratuita?" aparece
    na coluna.
  - **Gratuita desligada:** os dois voltam a aparecer, empilhados
    (`Toggle` de `mostrar_valor` + `input` de `valor`), exatamente como em
    qualquer outro procedimento.
  - **Bug encontrado e corrigido na revisão do Codex (2026-08-22):** a
    primeira implementação, com gratuita desligada, mostrava só o campo de
    valor, **sem** o toggle "Informa valor?" — a clínica podia cadastrar um
    preço real sem nenhuma forma de ligar "Informa valor?" para autorizar a
    Iris a informá-lo. Corrigido: os dois controles voltam juntos.
  - **Segundo bug do mesmo achado:** o toggle em massa por especialidade
    (`toggleEspMostrarValor`) ainda alterava `mostrar_valor` do item fixo
    mesmo enquanto `gratuito: true` — mexendo num campo que a UI individual
    não mostra mais nesse estado. Corrigido: o item fixo gratuito fica fora
    do toggle em massa (tanto na ação quanto no cálculo do estado
    ligado/parcial/desligado do toggle da especialidade).
- **`update()` (linha 2390)**: sem mudança de assinatura — `gratuito` é só
  mais uma chave de `Preco` que `update()` já aceita genericamente.

### 2.2 No tipo `Preco` e no Core (`precos-clinica.ts`)

- **`type Preco`** ganha `gratuito?: boolean` (novo campo opcional,
  compatível com todo item existente que não o tiver — default `false`
  quando ausente, nunca lido como `true` por omissão).
- **`derivarPrecosClinica`** (`src/core/precos-clinica.ts`): antes da
  checagem de `valor`, se `item.gratuito === true` e `item.ativo === true`,
  o item vai para uma lista nova **`gratuitos`** em `PrecosClinica` (nome
  do procedimento, sem valor) — não entra em `liberados` (que carrega
  valor) nem em `sob_avaliacao` (que significa "depende de avaliação
  futura para saber o preço" — sentido diferente de gratuito). Quando
  `gratuito` é `false`/ausente, o item segue o fluxo **exatamente igual ao
  de hoje** (`liberados`/`sob_avaliacao` pela regra de `valor`/
  `mostrar_valor` já existente) — nenhuma mudança de comportamento para
  quem não marcou gratuidade, seja "Consulta / Avaliação" ou qualquer outro
  procedimento.
- **`redator-instrucoes.ts`**: nova linha explicando `"precos.gratuitos"` —
  quando presente, a redatora pode dizer com naturalidade que aquele
  procedimento não tem custo, sem inventar valor nem tratar como
  "sob_avaliacao".
- Espelho da Edge Function sincronizado, mesmo padrão da spec anterior.

### 2.3 Migration SQL versionada (retroativa, só ativação/existência)

**Forma:** migration SQL versionada, seguindo o mesmo processo de
nomenclatura e revisão já usado no projeto (`AAAAMMDDHHMMSS_<nome>.sql`,
UTC, ver `docs/04-decisoes-canonicas.md` `DA-P4-03`) — nunca script
avulso, confirmado pelo Gabriel.

**Escopo estrito — só ativação, nunca preço/gratuidade:**
- Para toda linha de `clinicas` cujo `precios` já tem um item com
  `nome = 'Consulta / Avaliação'` e `ativo` diferente de `true`: atualiza
  esse item para `ativo: true`. **`valor`, `mostrar_valor` e `gratuito`
  do item permanecem exatamente como estavam** — a migration nunca os
  toca.
- Para clínicas cujo `precios` **não** tem esse item (nunca salvou o
  catálogo, ou salvou removendo-o antes desta trava existir): insere o
  item novo com `{nome: 'Consulta / Avaliação', esp: '🦷 Clínico Geral',
  ativo: true, valor: 0, mostrar_valor: false, gratuito: false, tempo: 30}`
  — estado neutro, equivalente a "recém-adicionado, clínica ainda não
  configurou preço nem gratuidade", igual a qualquer procedimento novo.
- Clínicas que já têm o item com `ativo: true` (as 2 de teste confirmadas
  em 1.2): **linha não tocada**, migration é no-op para elas.

Idempotente: rodar de novo não altera nada que já esteja `ativo: true`.

## 3. Remoção da tela legada

`iris-portal-v2/src/app/dashboard/procedimentos/page.tsx` — arquivo inteiro
removido, sem substituto (a rota deixa de existir). Nenhum outro arquivo
referencia, então não há import quebrado a corrigir.

## 4. Testes obrigatórios

**Painel (não coberto pela suíte do Core — `iris-portal-v2` tem stack de
teste própria, a confirmar antes de implementar):**
- Clínica nova, sem `precios` salvo: `initPrecos()` já mostra "Consulta /
  Avaliação" ativa, sem gratuidade marcada, `valor: 0` — sem precisar de
  nenhum save prévio.
- Clínica com "Consulta / Avaliação" `ativo:false` no dado salvo (não deve
  existir depois da migration, mas defensivo): UI força `true` mesmo assim,
  **preservando** o `valor`/`gratuito` que já estava salvo.
- Clínica com "Consulta / Avaliação" já com preço definido (ex.: `R$100`,
  `gratuito` ausente): UI mostra exatamente esse preço, sem alteração —
  prova de que a spec não força gratuidade.
- Toggle "Faz?" da Avaliação: ausente/desabilitado na UI.
- Novo toggle "É gratuita?": ligar desativa/oculta campo de valor e
  "Informa valor?" desse item; desligar devolve o comportamento normal de
  preço editável.
- Toggle em massa da especialidade "Clínico Geral" para `false`: todos os
  outros itens do grupo desligam, "Consulta / Avaliação" permanece ativa.
- Rota `/dashboard/procedimentos` removida: build não referencia mais o
  arquivo.

**Core (`src/core`, suíte `npm test`):**
- `derivarPrecosClinica` com item `{nome: 'Consulta / Avaliação', ativo:
  true, gratuito: true}` → aparece em `precos.gratuitos`, nunca em
  `liberados` nem `sob_avaliacao`.
- Mesmo item com `gratuito: false` (ou ausente) e `valor: 100,
  mostrar_valor: true` → aparece em `liberados` com o valor, comportamento
  idêntico ao de qualquer outro procedimento — prova de que gratuidade
  nunca é assumida por padrão.
- Item com `gratuito: true` mas `ativo: false` → ignorado por completo
  (mesma regra de qualquer item inativo).
- Item sem campo `gratuito` (compatibilidade com dado antigo de outros
  procedimentos) → comportamento inalterado, mesma regra de hoje.
- Migration SQL aplicada num fixture com `ativo: false` e `valor: 100` →
  depois da migration, item vira `ativo: true`, **`valor` continua `100`,
  `gratuito` continua ausente/`false`** — nunca sobrescrito.
- Migration SQL aplicada num fixture SEM o item "Consulta / Avaliação" →
  item inserido com `ativo: true, valor: 0, gratuito: false` (estado
  neutro, seção 2.3).
- Migration SQL aplicada num fixture já com `ativo: true` (as 2 clínicas de
  teste reais) → linha idêntica antes e depois (no-op).

**Contra IA real (redatora, mesmo padrão de `teste-real-paciente-novo.ts`):**
- Paciente pergunta o preço da avaliação → redatora responde que é
  gratuita, nunca inventa valor nem trata como "sob_avaliacao".
- Paciente pergunta preço de outro procedimento não liberado → continua
  comportamento de hoje (`sob_avaliacao`), sem confundir com gratuidade.

## 5. Fora desta v1

- Migrar `clinicas.precios` de nome-como-chave para `procedimento_id`/FK —
  decisão explícita do Gabriel de manter fora (seção 0).
- Qualquer coisa do ciclo dentista → odontograma → orçamento → Iris
  ([[iris-nova-visao-avaliacao-odontograma-orcamento]]).
- Escolha de modelo de IA (Terra/Luna/Sol) — assunto independente, já
  desacoplado da spec de paciente novo, também sem relação aqui.
