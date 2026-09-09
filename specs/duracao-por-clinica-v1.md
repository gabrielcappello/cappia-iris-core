# Sincronização de duração — Procedimentos & Preços → dentistas v1

**Status:** implementada, publicada e aprovada em teste real pelo Gabriel em
08/09/2026. Escopo restrito ao portal (`iris-portal-v2`), conforme revisão
de 2026-09-08 registrada abaixo — nenhuma mudança em Core, Edge Functions,
RPC, SQL, migrations, nem em `duracao-v1.md`.

Implementação: `iris-portal-v2`, branch `fix/sincronizacao-duracao-precos-
dentistas`, integrada em `main` por fast-forward. Dois commits:

- `0629ad8` — sincronização inicial: cura de `id` em `clinicas.precios[]`,
  propagação de `tempo` para `clinicas.dentistas[i].procedimentos[]` ao
  salvar "Procedimentos & Preços", preferência pelo tempo da clínica na
  ativação de um procedimento na ficha do dentista, e remoção do modo
  `auto` da UI (seção 2.5).
- `c38e2d2` — correções da revisão: cura de `id` também em memória (não só
  ao salvar, cobrindo os itens de produção sem `id`), reativação
  (inativo→ativo) priorizando o tempo vigente da clínica mesmo sobre um
  tempo antigo já salvo no item, remoção do fallback fixo `??30`, e
  preservação estrutural de dentista sem `procedimentos[]`.

Validação: Gabriel testou em produção em 08/09/2026 — duração alterada em
"Procedimentos & Preços" passou a refletir corretamente na duração real do
agendamento criado pela Iris, confirmando a correção da causa raiz descrita
na seção 0. Nenhum Core, Edge Function, banco, RPC ou migration foi alterado
nesta entrega.

## 0. Causa raiz confirmada (código lido diretamente, sem inferência)

Existem hoje dois campos de "tempo" para o mesmo procedimento, em colunas
diferentes de `clinicas`, sem sincronização entre eles:

- `clinicas.precios[].tempo` — editado pela clínica na tela "Procedimentos
  & Preços" (`iris-portal-v2/src/app/dashboard/page.tsx`, componente
  `ProcedimentosSection`, `handleSave()` em `page.tsx:2538-2540`, grava via
  `sb.update('clinicas', clinica.id, {precios})`).
- `clinicas.dentistas[i].procedimentos[].tempo` — é o campo que o Core
  (`cappia-iris-core`) efetivamente lê para calcular a duração real do
  agendamento (`carregar-catalogo.ts:334-353`,
  `carregar-disponibilidade.ts:214-243`, e a função SQL
  `cappia__resolver_duracao`). Confirmado por leitura direta: nenhum desses
  três consumidores olha para `clinicas.precios`.

Esse segundo campo só é escrito num momento: quando o toggle de um
procedimento é ativado pela primeira vez na ficha de um dentista
(`EspecialidadesGrid`, função `toggle()`, `page.tsx:2164-2175`, e
`toggleAll()`, `page.tsx:2177-2184`). Nesse clique, o tempo gravado vem do
catálogo estático hardcoded no código do painel (`ESPECIALIDADES`,
`page.tsx:188-199`), via o fallback `tempo:p.tempo||30`
(`page.tsx:2162,2182`) — nunca do que a clínica tem salvo em
`clinicas.precios`. Depois desse primeiro clique, o valor fica congelado:
nenhuma tela edita esse campo de novo, e editar "Procedimentos & Preços"
depois não o alcança.

Resultado observado em produção: a clínica muda "Consulta / Avaliação" de
30 para 20 minutos em "Procedimentos & Preços", a mudança aparece
corretamente em outras telas que leem `clinicas.precios` (ex.: card "Plano
de Tratamento", que lê ao vivo — `PlanoTratamentoCard.tsx:156-161,598-599`),
mas o agendamento real continua saindo com a duração antiga, porque o Core
nunca olhou para `clinicas.precios` — sempre leu o campo congelado do
dentista.

Isso vale para **todos os procedimentos**, não é específico de avaliação —
confirmado nos três consumidores do Core, sem tratamento especial por nome
de procedimento em nenhum deles.

## 1. Decisão de escopo (revisão de 2026-09-08)

Uma primeira versão desta spec propunha mudar a fonte oficial de duração
para `clinicas.precios`, exigindo alterar os três consumidores do Core e a
função SQL. O Codex revisou e apontou um caminho de risco menor: **manter
a fonte oficial exatamente onde está hoje**
(`clinicas.dentistas[i].procedimentos[].tempo`, conforme `duracao-v1.md`
segue vigente e não é revisada por esta spec) e corrigir o defeito na
origem — o portal, que hoje escreve nesse campo sem nunca sincronizá-lo com
o que a clínica edita.

Com isso:

- **Nenhuma mudança em `cappia-iris-core`** (Core, Edge Functions, `src/
  core/*.ts`, migrations, RPC `cappia__resolver_duracao`). Os três
  consumidores de duração continuam lendo exatamente o mesmo campo, do
  mesmo jeito, sem saber que esta correção existe.
- **`duracao-v1.md` não é revisada nem contradita.** A chave
  `clinica_id + dentista_id + procedimento_id` e a possibilidade de
  divergência entre dentistas (`duracao-v1.md` §1, §4, §14) continuam
  valendo como estão — esta spec não se pronuncia sobre se essa divergência
  é desejável, apenas garante que ela deixe de ser um acidente de
  propagação ausente e passe a ser, no mínimo, o valor que a clínica
  configurou por último.
- **Modo `auto`, fallback de 60 minutos na RPC SQL, e a questão de se
  duração deveria pertencer à clínica em vez do dentista** ficam
  registrados como temas separados (seção 6), não bloqueiam esta entrega.

Todo o trabalho desta spec é em `iris-portal-v2`.

## 2. O que muda

### 2.1 `clinicas.precios[].tempo` continua sendo a única superfície de
edição

Sem mudança de UI na tela "Procedimentos & Preços". A clínica edita tempo
só ali, como já faz desde a correção de 2026-09-06 (commit `2bbcb67`, que
devolveu "Consulta / Avaliação" ao loop de "Clínico Geral" nessa tela).

### 2.2 Ao salvar "Procedimentos & Preços", propagar `tempo` para
`clinicas.dentistas[i].procedimentos[]`

Hoje, `handleSave()` de `ProcedimentosSection` (`page.tsx:2538-2540`) só
grava `{precios}`. Passa a, no mesmo salvamento:

1. Ler `clinica.dentistas` (já disponível — a prop `clinica` recebida por
   `ProcedimentosSection` já é a clínica inteira).
2. Para cada dentista, para cada item de `dentista.procedimentos[]` cujo
   `id` corresponda (seção 2.4) a um item de `precos` com `tempo` definido,
   atualizar **somente o campo `tempo`** desse item — preservando `id`,
   `nome` e `ativo` exatamente como estavam.
3. Não adicionar, remover, nem reordenar itens do array `procedimentos[]`
   de nenhum dentista. Não tocar em nenhum outro campo do dentista (`modo`,
   `dur`, `dias_semana`, horários, etc.).
4. Gravar `{precios, dentistas: dentistasAtualizados}` numa única chamada
   (mesmo padrão de `save()` já usado em `page.tsx:334-349`, que faz
   `sb.update('clinicas', clinica.id, data)` com o objeto combinado).

Procedimentos inativos no dentista (`ativo !== true`) e dentistas inativos
continuam recebendo a propagação de `tempo` normalmente — propagar o valor
não os torna ativos; ativo/inativo permanece controlado só pelo toggle de
`EspecialidadesGrid`, sem relação com esta mudança.

### 2.3 Ativação futura de um procedimento usa o tempo já salvo em
`clinicas.precios` como primeira opção

Em `EspecialidadesGrid`, as funções `toggle()` (`page.tsx:2164-2175`) e
`toggleAll()` (`page.tsx:2177-2184`) hoje só conhecem `procsMap` (derivado
de `procs`, isto é, do próprio `dentista.procedimentos[]`) e o catálogo
estático `ESPECIALIDADES`. Passam a receber também o `tempo` vigente de
`clinicas.precios` para cada procedimento (via nova prop, ex.:
`temposClinica: Record<string, number>`, indexado por `id` — não por
nome, seção 2.4), e a ordem de preferência ao definir o `tempo` de um item
recém-ativado (ou de um item que nunca teve `tempo` gravado) passa a ser:

1. `clinicas.precios[]` (item com `id` correspondente, se existir e tiver
   `tempo` numérico definido);
2. o catálogo estático `ESPECIALIDADES` (`page.tsx:188-199`), como hoje —
   usado somente quando a clínica ainda não tem valor salvo para aquele
   procedimento em `clinicas.precios`.

Isto substitui o fallback atual `tempo:p.tempo||30` /
`procsMap[p.nome]?.tempo||p.tempo||30` (`page.tsx:2162,2165,2182`) — o
`||30` fixo deixa de ser a segunda opção; a segunda opção passa a ser o
catálogo estático (que já tem um valor por procedimento, sem precisar
inventar `30`), e a primeira opção passa a ser sempre o dado real da
clínica quando existir.

### 2.4 Correspondência por `id`, nunca só por nome

`dentista.procedimentos[].id` já existe hoje (`page.tsx:2173`, curado via
`PROCEDIMENTO_ID_POR_NOME` desde o commit `8eb3d1d`). `clinicas.precios[]`
**não tem `id` hoje** — só `nome` (`precos-clinica.ts:77-83`, tipo
`ItemPreco`, sem campo `id`).

Esta spec exige adicionar `id` a cada item de `clinicas.precios[]` no
portal, preenchido a partir do mesmo catálogo estático `ESPECIALIDADES`
que já fornece `id` para `PROCEDIMENTO_ID_POR_NOME`
(`page.tsx:201-205` aprox.) — a informação já existe no painel, só não é
copiada para dentro do array `precios` hoje. A correspondência entre um
item de `precios` e um item de `dentista.procedimentos[]`, tanto na
propagação (seção 2.2) quanto na ativação futura (seção 2.3), é feita por
esse `id` — nunca por comparação de `nome` como único critério.

Itens de `clinicas.precios` que, por serem de clínicas já existentes,
ainda não tiverem `id` gravado (dado anterior a esta mudança) são
tratados assim: no momento do próximo `handleSave()` de "Procedimentos &
Preços", o `id` é preenchido a partir do catálogo estático por
correspondência de nome (mesmo padrão de cura já usado em `toggle()` para
`dentista.procedimentos[].id`, `page.tsx:2166-2173`) — uma correção
pontual de dado incompleto, não uma segunda via de resolução permanente
por nome. Depois dessa cura, toda correspondência seguinte usa `id`.

### 2.5 Bloqueador funcional: ocultar o modo `auto` da interface

Confirmado na seção 3 do documento original desta spec (não repetido aqui):
o Core lê `dentista.modo` para decidir a origem da duração
(`carregar-catalogo.ts:334,353`, `carregar-disponibilidade.ts:220-222`, e a
RPC SQL `cappia__resolver_duracao`, linha 327-338 da migration). Enquanto a
UI permitir colocar um dentista em `modo:'auto'`, a propagação desta spec
(seção 2.2) e a preferência por valor salvo (seção 2.3) ficam sem efeito
para esse dentista — o Core ignora `procedimentos[].tempo` inteiramente e
usa `dentista.dur` (duração única fixa para tudo que ele faz). Isso deixa a
correção incompleta na prática: a clínica editaria "Procedimentos & Preços"
e veria o valor propagar corretamente para `dentista.procedimentos[]`, mas
o agendamento continuaria saindo com a duração de `dur`, sem explicação
visível. Por isso esta mudança é bloqueadora desta entrega, não um item
separado.

Correção, restrita à UI do portal (`iris-portal-v2/src/app/dashboard/
page.tsx:1888-1922`, bloco "Modo horários"):

1. O par de botões "⚡ automático" / "📋 procedimento"
   (`page.tsx:1893-1905`) deixa de oferecer as duas opções como escolha.
   A opção `auto` é removida da interface — não fica um terceiro estado
   nem um botão desabilitado; simplesmente deixa de existir como algo
   clicável. O modo `procedimento` passa a ser o único caminho possível
   pela UI (pode continuar exibido como um rótulo fixo/informativo, sem
   necessidade de manter um seletor de uma opção só).
2. O bloco condicional de `d.modo==='auto'` que expõe o campo "Duração
   (min)" e os slots gerados (`page.tsx:1906-1922`) deixa de ser
   alcançável — sem caminho de UI para chegar a `modo:'auto'`, esse bloco
   nunca mais renderiza para uma edição feita a partir de agora.
3. **Nenhuma migration, conversão ou reescrita de dado.** O Codex já
   confirmou, por leitura direta e somente leitura (`read-only`) do banco
   de produção, que os três dentistas ativos existentes já estão em
   `modo:'procedimento'` — não há nenhum dentista real hoje em `modo:'auto'`
   para migrar. Esta spec não determina nenhuma ação sobre dado existente
   por não haver dado existente que precise dela.
4. `addNew()` (`page.tsx:1206-1220`) já cria todo dentista novo com
   `modo:'procedimento'` como padrão (`page.tsx:1215`) — isso não muda.
   Esta correção apenas remove a possibilidade de trocar para `auto`
   depois, pela UI; o padrão de nascimento permanece o mesmo que já é hoje.
5. O campo `modo:'auto'` e a leitura de `dur` continuam existindo no
   schema e no Core — não são removidos de lá. Esta spec restringe apenas
   o que a UI do portal permite escolher, sem tocar em
   `cappia-iris-core` (mantendo o princípio da seção 3: nenhuma mudança de
   Core nesta entrega).

### 2.6 Isolamento entre clínicas e dentistas

Sem mudança de comportamento aqui: a propagação (2.2) e a ativação futura
(2.3) operam sempre dentro de uma única clínica (`clinica.dentistas`,
`clinica.precios` — ambos já escopados por `clinica.id` na estrutura atual
do banco). Nada nesta spec introduz leitura ou escrita cruzando `clinica_id`.

## 3. O que NÃO muda (explícito, para não virar bloqueador de revisão)

- Nenhum arquivo em `cappia-iris-core/src/core/*.ts` é alterado.
- Nenhuma Edge Function é alterada.
- Nenhuma migration SQL é criada ou alterada; `cappia__resolver_duracao`
  continua exatamente como está, incluindo seu fallback de 60 minutos
  (registrado como pendência separada, seção 6, não desta entrega).
- `duracao-v1.md` permanece vigente, sem revisão. A chave
  `clinica_id + dentista_id + procedimento_id` e a possibilidade de
  divergência de duração entre dentistas continuam existindo como contrato
  do Core — esta spec apenas garante que o valor propagado para cada
  dentista reflita o que a clínica configurou por último, e não mais um
  valor congelado de fábrica.
- Modo `auto` não é removido do schema nem do Core — só deixa de ser
  alcançável pela UI do portal (seção 2.5), por ser bloqueador funcional
  desta correção. Nenhuma migration ou conversão de dado, conforme seção
  2.5 item 3.
- Nenhuma tela nova. Nenhum campo novo visível ao usuário. A única mudança
  observável pela clínica é que o tempo editado em "Procedimentos & Preços"
  passa a valer de fato no agendamento.

## 4. Falha e casos de borda

- **Procedimento em `clinicas.precios` sem `tempo` numérico definido**
  (campo ausente, `null`, ou não numérico): a propagação (2.2) não altera
  o item correspondente no dentista — preserva o que já estava lá (não
  apaga, não zera, não força um valor). Mesma regra vale para a ativação
  futura (2.3): sem `tempo` numérico em `clinicas.precios`, cai para o
  catálogo estático, como já acontece hoje.
- **Procedimento ativo num dentista sem item correspondente em
  `clinicas.precios`** (nenhum `id` bate): a propagação simplesmente não
  encontra alvo para esse item — o campo `tempo` existente nele permanece
  como está, sem alteração. Isto não é um caso de erro; é a ausência de
  dado para propagar.
- **Dois itens de `clinicas.precios` com o mesmo `id`** (array jsonb sem
  unicidade garantida por schema): a propagação usa o primeiro item
  encontrado com aquele `id` e ignora os demais silenciosamente nesta
  versão — não é tratado como erro bloqueante, pois é um estado de dado
  hoje já possível (mesma ausência de unicidade já existe por `nome`) e
  fora do escopo desta correção pontual. Registrado como pendência (seção
  7) caso vire problema real.
- Nada disto aciona nenhuma validação do Core — a resolução de duração no
  momento do agendamento continua exatamente igual, incluindo suas regras
  de falha fechada já vigentes em `duracao-v1.md` §5–§6.

## 5. Testes obrigatórios (portal, `iris-portal-v2`)

Todos em `iris-portal-v2`, sem necessidade de nenhum teste em
`cappia-iris-core` para esta entrega (o Core não muda).

1. **Propagação atualiza dentistas existentes**: dado um dentista com
   `procedimentos: [{id:'consultation_evaluation', nome:'Consulta /
   Avaliação', ativo:true, tempo:30}]` e `clinicas.precios` contendo
   `{id:'consultation_evaluation', nome:'Consulta / Avaliação', tempo:20,
   ...}`, ao salvar "Procedimentos & Preços" o item do dentista passa a
   `tempo:20`, com `id`, `nome` e `ativo` inalterados.
2. **Múltiplos dentistas, múltiplos procedimentos**: propagação atualiza
   corretamente todos os dentistas da clínica que tenham o procedimento
   correspondente por `id` — inclusive itens com `ativo:false` (seção 2.2:
   propagar `tempo` não depende de `ativo`, e não altera esse campo). Um
   dentista que não possui nenhum item com aquele `id` em
   `procedimentos[]` não sofre nenhuma alteração; um procedimento diferente
   (outro `id`) no mesmo dentista também não é alterado.
3. **Preservação de outros campos do dentista**: `dur`, `modo`,
   `dias_semana`, horários e qualquer outro campo do dentista permanecem
   estruturalmente iguais antes e depois do `handleSave()` de
   "Procedimentos & Preços" — mesmas chaves, mesmos valores, mesma
   composição de cada item de `procedimentos[]` (`id`, `nome`, `ativo`
   inalterados); só o campo `tempo` dos itens correspondentes muda.
4. **Ativação futura usa o valor da clínica**: dado um dentista sem aquele
   procedimento ainda ativado, e `clinicas.precios` com `tempo:20` para
   ele, ao clicar o toggle em `EspecialidadesGrid`, o item criado em
   `dentista.procedimentos[]` nasce com `tempo:20` — não com o valor do
   catálogo estático.
5. **Ativação futura sem valor salvo cai para o catálogo estático**: dado
   um procedimento sem `tempo` numérico em `clinicas.precios` (campo
   ausente ou não numérico), ao ativar o toggle, o item nasce com o `tempo`
   do catálogo estático `ESPECIALIDADES` — comportamento equivalente ao
   atual, não um valor fixo arbitrário como `30`.
6. **Correspondência por `id`, não por nome**: dois procedimentos com nomes
   parecidos mas `id` diferentes não se confundem na propagação nem na
   ativação; um item de `clinicas.precios` com `nome` alterado mas `id`
   preservado continua correspondendo corretamente ao item do dentista.
7. **Cura de `id` ausente em `clinicas.precios` legado**: um item de
   `clinicas.precios` sem `id` (dado anterior a esta mudança) recebe `id`
   curado por nome no próximo `handleSave()`, e passa a propagar
   corretamente a partir daí.
8. **Item duplicado por `id` em `clinicas.precios`**: propagação não
   quebra (não lança exceção, não corrompe o array de nenhum dentista) —
   usa o primeiro item encontrado, conforme seção 4.
9. **Modo `auto` inalcançável pela UI**: o componente de "Modo horários"
   não expõe mais controle para definir `modo:'auto'` — nenhuma interação
   do usuário (clique, atalho) produz `onUpdate({modo:'auto'})`. Um
   dentista fixture já existente com `modo:'auto'` (caso hipotético de
   teste, já que não há nenhum em produção) não tem seu `modo` alterado
   automaticamente por esta mudança — a spec não migra dado, só impede
   novo direcionamento a esse modo pela interface.

## 6. Registrado como tema separado — não bloqueia esta entrega

- Se a fonte oficial de duração deveria migrar de
  `clinica_id + dentista_id + procedimento_id` para
  `clinica_id + procedimento_id` (ou seja, se divergência de duração entre
  dentistas deveria deixar de ser possível no Core) — isso exigiria revisar
  `duracao-v1.md` e alterar os três consumidores do Core (`carregar-
  catalogo.ts`, `carregar-disponibilidade.ts`, RPC SQL), fora do escopo
  desta spec.
- Fallback de 60 minutos em `cappia__resolver_duracao` (linhas 341-342 da
  migration `20260804150000_iris_nova_reaproveitamento_agendamento_v1.sql`)
  viola a regra de falha fechada de `duracao-v1.md` §6 — correção
  necessária, mas em SQL/RPC, fora do escopo desta spec.
- Correspondência por nome já em uso hoje dentro de
  `cappia__resolver_duracao` (linha 334 da mesma migration) — mesma
  observação, fora do escopo.
- Aviso no painel quando um procedimento ativo no dentista não tem
  correspondência em `clinicas.precios` — fora de escopo, ver seção 4.

## 7. Pendências

1. Auditoria de testes existentes do portal (`iris-portal-v2`) que hoje
   fixam `tempo:30` como valor esperado ao simular ativação de
   procedimento — precisam ser atualizados para refletir a nova ordem de
   preferência (seção 2.3), trabalho de implementação, não decidido por
   inferência aqui.
2. Item duplicado por `id` em `clinicas.precios` (seção 4) — reavaliar se
   vira necessário tratamento explícito caso se mostre um problema real em
   uso.
3. Dado histórico: dentistas com `procedimentos[].tempo` já congelado em
   valores antigos (ex. `30`) só são corrigidos no próximo `handleSave()`
   de "Procedimentos & Preços" daquela clínica — não há migração automática
   retroativa nesta spec. Se isso for necessário para os ambientes de teste
   atuais, é uma ação operacional (salvar a tela uma vez por clínica), não
   uma migration.
