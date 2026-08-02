# Implementação técnica da persistência da composição v1 — `P4I`

**Status:** especificação **técnica documental**. **Ainda não implementada.** Este
documento **não** cria migration, não executa SQL, não altera banco, e **não** altera
Supabase, painel, workflows, n8n, Evolution, Google Calendar ou Vercel. Nenhum código
TypeScript e nenhum teste executável são criados por ele.

Registros explícitos de escopo:

- **nenhuma migration foi criada** — nem arquivo, nem rascunho aplicável;
- **nenhum SQL foi executado** em nenhum banco, real ou descartável;
- **nenhum banco foi alterado**;
- **nenhuma estrutura legada da Iris antiga está autorizada** — RPCs `cappia_*`,
  tabelas do painel, workflows e funções de disponibilidade do legado continuam sem
  autorização de reuso (`persistencia-v1.md` §28,
  `../docs/05-componentes-reutilizaveis.md`);
- as **duas estruturas próprias da Iris Nova** já versionadas (`estado_conversa`,
  `mensagens_recebidas`) **não estão automaticamente aprovadas**: são auditadas na
  seção 3 e só podem evoluir **aditivamente**, com as divergências ali registradas
  fechadas antes de qualquer uso por esta camada;
- **este documento não é autorização de implementação** — implementar exige aprovação
  própria, posterior a esta especificação.

Este documento é a camada **técnica** da persistência da composição: traduz o modelo
conceitual fechado em `persistencia-fisica-composicao-v1.md` (`P4`) em estruturas,
chaves, operações, contratos de erro e provas de teste **suficientes para implementar
sem decisão arquitetural implícita**. Onde este documento e um documento de domínio
divergirem, o documento de domínio prevalece — este arquivo nunca é fonte de regra de
domínio.

Fontes que este documento implementa, sem substituir: `persistencia-fisica-composicao-v1.md`
(modelo conceitual de `P4`), `integracao-temporal-composicao-v1.md` (contratos lógicos
da máquina pura), `persistencia-v1.md` (persistência conversacional v1),
`controlador-conversacional-v1.md`, `composicao-novo-agendamento-v1.md` e
`interpretacao-ia.md`. Permanecem fixas as decisões de `../docs/02-arquitetura.md` e
`../docs/04-decisoes-canonicas.md`.

## 1. Objetivo e limite

**Objetivo:** dar forma física implementável às cinco responsabilidades de `P4` §3,
mantendo intactas todas as suas invariantes (`P4` §19), e fechar os itens que `P4`
registrou como adiados **apenas na medida em que a implementação exige** — sem
antecipar decisões que continuam fora do escopo.

**`P4I` termina onde `P4` termina** (`P4` §15):

- resultado lógico persistido;
- resultado terminal persistido;
- fatos autorizados persistidos;
- replay disponível **enquanto o payload do resultado existir** (seção 2).

**Fora de `P4I`, sem exceção:** `P5` (tecnologia de redação); redação da mensagem
natural; outbox de resposta; transporte; retry de entrega; ACK; garantia de
exactly-once de entrega; deploy operacional. Nenhuma tabela, coluna, estado ou
operação de qualquer um deles é criada aqui, e **nenhuma promessa de exactly-once de
entrega é feita** — a garantia desta camada é sobre o **resultado lógico**, nunca
sobre a entrega ao paciente.

**Nenhuma implementação começa antes da aprovação desta especificação.**

## 2. `P4I-R1` — Retenção do resultado lógico (decisão aprovada)

Decisão final de Gabriel, aprovada e fechada nesta rodada.

O conteúdo completo de `resultados_composicao` permanece por **30 dias após a criação
do resultado final**. Durante esse período podem permanecer `resultado_logico`,
`comando`, `fatos_autorizados` e os demais payloads necessários para **replay
completo**.

**Depois de 30 dias**, a limpeza remove:

- `resultado_logico`;
- `comando`;
- `fatos_autorizados`;
- qualquer payload completo que contenha dados estruturados ou PII.

**Metadados mínimos preservados** — nunca removidos:

`clinica_id`; `resultado_id`; `mensagem_id`; `conversa_id`; `continuacao_id`;
`efeito_id`, quando existente; versão resultante; versão do contrato; tipo terminal;
fingerprint do conteúdo; timestamps; marcador de payload removido; códigos técnicos sem
PII.

**Consequências fechadas:**

- **replay completo é garantido somente enquanto o payload do resultado existir**;
- depois de 30 dias, a mensagem **continua definitivamente reconhecida como processada
  e deduplicada** — a deduplicação é permanente e nunca expira;
- o sistema **não pode reinterpretar**;
- **não pode chamar novamente a máquina**;
- **não pode consultar disponibilidade**;
- **não pode reconstruir o resultado**;
- **não pode gerar nova resposta como se a mensagem fosse inédita**;
- deve retornar o estado técnico fechado `resultado_processado_payload_expirado`.

Esse retorno é **técnico**: não é falha de domínio, não é falha da escrita e **não
representa novo processamento**. Ele afirma exatamente uma coisa — a mensagem já foi
processada e o payload que permitiria devolvê-la integralmente expirou.

**A limpeza do resultado:**

- é **idempotente** — reexecutar sobre uma linha já limpa não altera nada;
- **nunca apaga a linha**;
- **nunca remove identidade, fingerprint ou vínculos**;
- registra `payload_removido_em`;
- **não altera o estado oficial da conversa** — limpeza é operação de retenção, nunca
  de domínio.

**Relação com os outros dois prazos.** Os três prazos governam objetos diferentes e
nenhum altera outro: **7 dias** para o conteúdo bruto da mensagem
(`persistencia-v1.md` §19); **30 dias** para os artefatos técnicos encerrados
(continuações, requisições, efeitos — `P4` §11, `P4-R1`); **30 dias** para o payload do
resultado (esta decisão). O prazo mais curto nunca é estendido pelo mais longo: nenhum
artefato de 30 dias preserva o texto bruto além dos 7.

## 3. Auditoria das duas estruturas existentes

`estado_conversa` e `mensagens_recebidas` já existem como migrations versionadas neste
repositório. **Nenhuma das duas é presumida correta**, e **nenhuma está automaticamente
aprovada** para servir a esta camada. Esta seção registra a auditoria feita sobre o
código versionado, item por item.

**Fontes auditadas:** `../src/supabase/migrations/20260729_iris_nova_identificacao_v1.sql`;
`..._correcao.sql`; `../src/supabase/migrations/20260730_iris_nova_interpretacao_v1.sql`;
`../src/core/mensagens-recebidas-tipos.ts`; `../src/core/reivindicar-mensagem.ts`;
`../src/core/aplicar-interpretacao-condicional.ts`; `../src/core/finalizar-mensagem.ts`.

**Fato de estado, registrado com precisão — três afirmações distintas, nunca
fundidas:**

1. **migration versionada:** o repositório comprova que
   `../src/supabase/migrations/20260730_iris_nova_interpretacao_v1.sql` foi
   **escrita e versionada**, com as três colunas de claim/lease/marcador e as duas
   RPCs (`reivindicar_mensagem`, `aplicar_interpretacao_condicional`) definidas nela;
2. **fato histórico da rodada de criação:** o **cabeçalho do arquivo** declara que,
   **naquela rodada**, a migration **não foi aplicada em nenhum banco, real ou dev**
   — isto é evidência histórica sobre o momento em que o arquivo foi escrito, não uma
   afirmação sobre agora;
3. **estado atual de aplicação em banco: desconhecido.** Este documento **não infere**
   se a migration foi aplicada desde então, em quais ambientes, quais objetos existem
   hoje, quais versões de função estão ativas, ou se houve alteração posterior fora
   deste repositório. **Nenhuma dessas perguntas é respondida pelo controle de
   versão.**

**Somente um preflight read-only futuro, executado imediatamente antes de qualquer
migration nova**, pode determinar: se `../src/supabase/migrations/20260730_iris_nova_interpretacao_v1.sql` foi
aplicada; em quais ambientes; quais objetos (`claim_token`, `lease_expira_em`,
`interpretacao_persistida_em`, as duas RPCs) existem de fato; quais versões de função
estão ativas; e se houve alteração posterior não registrada neste repositório. Essa é
a mesma exigência que a própria migration de interpretação já registra no seu
cabeçalho, e esta especificação a preserva sem enfraquecer: **nenhuma implementação
futura presume o resultado dessa verificação.**

### 3.1 `estado_conversa` — divergências encontradas

| # | Divergência | Exigência de `P4` | Tratamento |
|---|---|---|---|
| D1 | **Não possui coluna de versão inteira.** O CAS existente usa `atualizado_em` (`timestamptz`) como predicado — ver `aplicar_interpretacao_condicional`, parâmetro `p_snapshot_atualizado_em` | `P4` §7: versão inteira monotônica; **"timestamp não é versão"** (invariante, `P4` §19) | **Bloqueante.** Exige coluna de versão `bigint` nova, aditiva (seção 6). O CAS por timestamp não pode ser a base do avanço oficial da composição |
| D2 | Chave da conversa é `(clinica_id, telefone_normalizado)`; não existe `conversa_id` nomeado | `P4` §3.A: chave lógica `clinica_id` + `conversa_id` | **Resolvido por mapeamento explícito** (seção 6): `conversa_id` **é** a coluna `id` desta linha. Nenhuma coluna nova de identidade é criada, e a unicidade por telefone permanece |
| D3 | `estado` é `text` com CHECK de seis valores da Etapa 1 (`atendimento`, `aguardando_escolha`, `coletando_cadastro`, `aguardando_confirmacao`, `executando`, `concluido`) | `P4` §7 define o eixo de composição/checkpoint separadamente, nas continuações | **Sem conflito, por separação.** O vocabulário da Etapa 1 permanece nesta coluna; o ciclo de vida da composição vive em `continuacoes_composicao`. Os dois eixos são independentes (`P4` §7) e **não** são fundidos |
| D4 | `dados jsonb` **sem versão de contrato** embutida | Seção 17: JSONB sempre versionado | **Bloqueante brando.** Exige coluna de versão de contrato aditiva, ou campo reservado dentro do JSONB, decidido na seção 6 |
| D5 | Não possui `unique (clinica_id, id)` | Seção 6: unicidade estrutural `(clinica_id, id)` em toda tabela referenciada | **Bloqueante.** Exige constraint única aditiva para servir de alvo às FKs compostas das quatro tabelas novas |

### 3.2 `mensagens_recebidas` — divergências encontradas

| # | Divergência | Exigência de `P4` | Tratamento |
|---|---|---|---|
| D6 | **Chave de deduplicação sem `clinica_id`**: `unique (provider, instancia_whatsapp, message_id)` (ver 3.2.1) | `P4` §6: `clinica_id` + canal + provider + instância + `message_id` | **Bloqueante, parcialmente confirmada.** A constraint antiga **será substituída**, não apenas complementada — ver 3.2.1 |
| D7 | **Não possui coluna de canal** | `P4` §6: canal integra a identidade de deduplicação | **Bloqueante.** Exige coluna aditiva; a instância sozinha não distingue provedores num futuro multicanal (`P4` §3.B) |
| D8 | **Não possui `payload_fingerprint`** | `P4` §6: fingerprint técnico para detectar envelope divergente sob a mesma identidade | **Bloqueante.** Exige coluna aditiva; sem ela, `mensagem_payload_divergente` (seção 23) é indetectável |
| D9 | **Não possui payload bruto nem marcador de expiração do bruto** | `persistencia-v1.md` §19: bruto por 7 dias, linha preservada | **Bloqueante.** Exige colunas aditivas de conteúdo bruto e `bruto_removido_em` |
| D10 | Não possui vínculo com continuação atual nem com resultado | `P4` §3.B: referência de resultado; replay | **Bloqueante.** Exige colunas aditivas de vínculo (seção 6) |
| D11 | `status_processamento` com quatro valores (`recebida`, `processando`, `concluida`, `falhou`) | `P4` §7, eixo Mensagem: exatamente esses quatro | **Compatível.** Nenhuma alteração necessária |
| D12 | `claim_token`, `lease_expira_em`, `interpretacao_persistida_em` — artefato versionado confirmado (ver 3.2.2); lease de 60 s | Seção 15: lease de mensagem = 60 s | **Compatível em contrato.** Estado atual de materialização no banco: **desconhecido até preflight** — ver 3.2.2 |

### 3.2.1 D6 — reescrita precisa

**Estado existente confirmado** (verificado diretamente contra
`../src/supabase/migrations/20260729_iris_nova_identificacao_v1.sql` e
`..._correcao.sql`) — **duas constraints distintas, em duas tabelas diferentes,
nunca a mesma coisa:**

**Constraint de `mensagens_recebidas`** (`mensagens_provider_instancia_message_key`):
é a responsável pela **deduplicação atual** da mensagem, baseada em `provider` +
`instancia_whatsapp` + `message_id`. Ela:

- **não inclui `clinica_id`**;
- **não inclui `canal`**;
- **não é responsável por vincular globalmente uma instância a uma clínica** — essa
  responsabilidade pertence inteiramente à constraint seguinte, em outra tabela.

**Constraint de `clinicas`** (`clinicas_provider_instancia_key`): estabelece a
**unicidade global** de `provider` + `instancia_whatsapp` — uma instância pertence a
exatamente uma clínica em todo o banco. O vínculo entre a mensagem registrada e a
clínica proprietária real dessa instância é reforçado pela FK composta
`mensagens_recebidas_clinica_provider_instancia_fk`
(`(clinica_id, provider, instancia_whatsapp)` → `clinicas (id, provider,
instancia_whatsapp)`).

**Classificação correta:**

- a **mitigação atual** do risco multiclínica vem da unicidade global em `clinicas`
  **e** da FK composta — **não** vem da constraint de deduplicação da mensagem, que
  nunca teve essa responsabilidade;
- **remover ou substituir a constraint antiga de `mensagens_recebidas` não remove,
  por si só, a unicidade global da instância em `clinicas`** — são duas constraints
  independentes, em tabelas diferentes, e a troca de uma não afeta a outra;
- a ausência de `clinica_id` na constraint de deduplicação **não produz, isoladamente,
  colisão multiclínica demonstrada hoje**, precisamente porque a proteção multiclínica
  vive em `clinicas`, não na chave de deduplicação;
- **mesmo assim, a constraint atual diverge da identidade canônica de `P4I`** (seção
  6): ela não é a chave de deduplicação exigida por `P4` §6, apenas produz um efeito
  parcialmente sobreposto por composição de outras duas constraints;
- a **ausência de `canal`** impede representar a identidade completa proposta,
  independentemente da questão de `clinica_id` — nenhuma composição das constraints
  atuais supre isso;
- **a constraint antiga é mais restritiva que a nova identidade desejada**: ela
  amarra uma instância a uma única clínica para sempre, enquanto o modelo de `P4I`
  distingue clínica e instância como campos independentes da chave. Isso não é
  incompatibilidade de dados — é uma regra de negócio mais rígida que pode não valer
  para sempre, e a nova chave não deve herdá-la implicitamente;
- **`D6` permanece parcialmente confirmada e bloqueante** — parcialmente confirmada
  porque a colisão multiclínica isolada não está demonstrada; bloqueante porque a
  divergência de identidade e a ausência de `canal` permanecem, independentemente da
  proteção que `clinicas` já oferece por outro caminho.

**Correção futura obrigatória.** A migration técnica futura deverá, nesta ordem:

1. **auditar os dados existentes** — quantas linhas, quais combinações de
   provider/instância/clínica realmente ocorrem;
2. **criar e preencher `canal`** — coluna nova mais backfill (seções 5.2.1 e 5.2.2
   desta especificação);
3. **validar duplicidades segundo a nova chave** — nenhuma linha pode violar
   `(clinica_id, canal, provider, instancia_whatsapp, message_id)` antes de a
   constraint ser criada;
4. **criar a nova unicidade** — `(clinica_id, canal, provider, instancia_whatsapp,
   message_id)`, como constraint nova, coexistindo temporariamente com a antiga;
5. **substituir ou remover controladamente a constraint antiga** — depois que a nova
   estiver validada e ativa, não antes;
6. **provar que nenhuma janela sem proteção de deduplicação foi criada** — em nenhum
   instante da migration a tabela fica sem **alguma** constraint de unicidade
   cobrindo a identidade de transporte;
7. **incluir rollback próprio da troca de constraint** (seção 3.2.3) — reverter para
   a constraint antiga é uma operação distinta do rollback aditivo geral (seção 25),
   condicionada à compatibilidade real dos dados no momento da reversão, nunca uma
   promessa incondicional.

**Isto não é "apenas adicionar uma constraint nova".** É uma **substituição
controlada de constraint dentro de uma migration predominantemente aditiva** — as
quatro tabelas novas e as colunas novas em `estado_conversa` são aditivas puras; a
troca da chave de deduplicação de `mensagens_recebidas` é a única exceção, e por isso
exige o passo a passo acima e um rollback próprio.

### 3.2.2 D12 — estado da migration de interpretação, definitivamente

**Três afirmações distintas, nunca fundidas** — nenhuma passagem deste documento
substitui uma pela outra:

1. **Artefato versionado confirmado.**
   `../src/supabase/migrations/20260730_iris_nova_interpretacao_v1.sql` **existe e
   está versionada** neste repositório.
2. **Objetos declarados no artefato confirmados.** O arquivo define as três colunas
   (`claim_token`, `lease_expira_em`, `interpretacao_persistida_em`) e as duas RPCs
   (`reivindicar_mensagem`, `aplicar_interpretacao_condicional`), com lease de
   mensagem de 60 s. Isto é fato sobre o **arquivo**, confirmável por leitura direta
   do repositório.
3. **Estado atual de materialização no banco: desconhecido até preflight.** O
   cabeçalho do arquivo registra que, **na rodada em que foi escrito**, a migration
   **não havia sido aplicada** em nenhum banco, real ou dev — isto é **evidência
   histórica sobre aquela rodada**, nunca uma afirmação sobre o presente. Se as três
   colunas e as duas RPCs existem hoje, em quais ambientes, com quais versões
   ativas, e se houve alteração posterior fora deste repositório — **nada disso é
   determinável pelo controle de versão**. Só um **preflight read-only futuro**,
   executado imediatamente antes de qualquer migration nova, pode responder.

**Proibido:** afirmar, em qualquer outra passagem deste documento, que a migration
"permanece atualmente não aplicada" ou que os objetos "permanecem atualmente não
materializados" — ambas são inferências sobre o presente que este documento não tem
base para fazer. A única afirmação factual válida sobre o presente é "desconhecido
até preflight".

### 3.2.3 Rollback da troca de constraint — condicionado à compatibilidade dos dados

O rollback da substituição de constraint (D6, `P4I.6`) **não é uma promessa
incondicional** de "recriar a constraint antiga". Ele só é possível sob uma condição
verificável, e é **proibido** sob a condição oposta. Os dois casos, fechados:

**Antes de tráfego novo incompatível.** A constraint antiga (`unique (provider,
instancia_whatsapp, message_id)`) pode ser **recriada** somente se, no momento da
reversão:

- um **preflight** confirmar **compatibilidade integral dos dados** — toda linha
  atual (histórica e as eventualmente já gravadas sob a chave nova) respeitaria a
  constraint antiga se ela fosse reaplicada;
- **nenhuma linha depender de `canal`** para se distinguir de outra — ou seja,
  nenhum par de linhas compartilha `provider` + `instancia_whatsapp` + `message_id`
  e difere apenas pelo `canal` (ou por `clinica_id`, sob a mesma lógica);
- a recriação **passar em ambiente descartável** antes de ser aplicada a qualquer
  ambiente real;
- **nenhuma perda ou consolidação de mensagens** ocorrer no processo — o rollback
  reverte a constraint, nunca funde ou apaga linhas para caber nela.

**Depois de tráfego válido apenas pela chave nova.** Se existirem duas ou mais linhas
que compartilham `provider` + `instancia_whatsapp` + `message_id` e **diferem
legitimamente** por `canal` (ou outra parte da chave nova) — ou seja, a constraint
nova é a única coisa que as distingue —, então:

- **a constraint antiga não pode ser recriada** — recriá-la produziria uma violação
  de unicidade imediata, ou exigiria apagar/mesclar linhas para evitar essa
  violação, e ambos são proibidos;
- **rollback estrutural para o modelo antigo fica proibido** — não existe caminho de
  volta ao schema anterior nesse cenário;
- em vez disso: **desativar o novo adaptador por flag** (seção 25) — o desligamento
  operacional continua disponível mesmo quando o rollback estrutural não é;
- **preservar a constraint nova** — ela continua sendo a única proteção de
  deduplicação válida para os dados existentes;
- **preservar os dados** — nenhuma linha é tocada só para viabilizar um rollback
  estrutural;
- **reverter somente funções, grants ou componentes compatíveis** com a manutenção
  da constraint nova — nunca o schema de dedup em si;
- **exigir plano específico aprovado** antes de qualquer transformação de dados que
  vise restaurar o modelo antigo — isso é migração nova, não rollback.

**Fechado, sem exceção:**

- **o rollback nunca apaga, mescla ou altera identidades para forçar
  compatibilidade** com a constraint antiga;
- **nenhuma promessa genérica de "recriar a constraint antiga" permanece** em
  qualquer outra passagem deste documento — a possibilidade é sempre condicional aos
  dois casos acima;
- **a elegibilidade do rollback é decidida por preflight de dados**, executado no
  momento da tentativa de reversão — nunca presumida a partir do estado no momento
  em que a migration original foi escrita.

### 3.3 Conclusão da auditoria

- **Nenhuma das duas estruturas está aprovada como está.** As doze divergências acima
  são o trabalho mínimo de evolução — **predominantemente aditiva, exceto a
  substituição controlada da constraint de deduplicação** (D6, `P4I.6`) — antes de
  qualquer uso por esta camada.
- **Nenhuma alteração destrutiva é autorizada**: nada de `drop table`, renomeação de
  coluna existente, ou mudança de tipo de coluna já povoada.
- **Nenhuma autoridade paralela foi encontrada** — não existe segunda estrutura
  disputando estado oficial ou deduplicação neste repositório. Esta especificação
  **não cria** nenhuma.
- A RPC `aplicar_interpretacao_condicional` **permanece válida no seu próprio escopo**
  (persistência da interpretação, Etapa 7) e **não é a operação de avanço da
  composição**. As duas coexistem sem fusão; o CAS por versão inteira desta camada não
  substitui nem reescreve aquele contrato.

## 4. Modelo físico fechado — seis tabelas

| # | Tabela | Origem | Responsabilidade (`P4` §3) |
|---|---|---|---|
| 1 | `estado_conversa` | **existente**, auditada (3.1), evolução aditiva | A — estado oficial da conversa |
| 2 | `mensagens_recebidas` | **existente**, auditada (3.2), evolução predominantemente aditiva — exceto a substituição controlada da constraint de deduplicação (D6, `P4I.6`) | B — deduplicação, claim, lease, replay |
| 3 | `continuacoes_composicao` | **nova** | C — checkpoint técnico entre chamadas |
| 4 | `requisicoes_composicao` | **nova** | D — requisições de leitura |
| 5 | `efeitos_composicao` | **nova** | D — requisições de escrita |
| 6 | `resultados_composicao` | **nova** | E — resultado terminal imutável |

Regras fechadas do modelo:

- **as duas primeiras são estruturas próprias da Iris Nova**, auditadas na seção 3 e
  evoluídas **somente de forma aditiva**;
- **as quatro últimas são novas**;
- **nenhuma outra tabela que duplique estado oficial ou deduplicação pode ser criada** —
  a autoridade de estado é `estado_conversa` e a de deduplicação é
  `mensagens_recebidas`, cada uma em exemplar único;
- **requisições e efeitos permanecem separados** (`P4` §3.D): uma leitura não altera
  estado oficial e uma escrita altera; fundi-las tornaria impossível distinguir "dado
  obtido" de "efeito confirmado" na retomada;
- **continuação nunca é fonte oficial de estado** (`P4` §4) — a separação física entre
  a tabela 1 e a tabela 3 é a fronteira mais importante deste modelo.

## 5. Campos e tipos

Tipos PostgreSQL recomendados: `uuid`, `bigint`, `smallint`, `text`, `bytea`, `jsonb`,
`integer`, `timestamptz`. **Nenhuma DDL é escrita aqui** — as tabelas abaixo descrevem
campos, responsabilidade e regime, nunca sintaxe de criação.

Convenções das colunas de regime, válidas para todas as tabelas desta seção:

- **Nulável** é conceitual (o que o domínio permite), não a declaração final;
- **Imutável** significa que nenhuma operação desta especificação reescreve o valor
  depois de gravado; **mutável restrito** significa que apenas as operações nomeadas na
  seção 13 podem alterá-lo, e apenas nas transições ali nomeadas;
- **Participação** indica chave, constraint, índice ou retenção;
- **Proibido** registra conteúdo que nunca pode ocupar o campo.

### 5.1 `estado_conversa` (existente — colunas novas marcadas)

| Campo | Tipo | Responsabilidade | Nulável | Regime | Participação | Proibido |
|---|---|---|---|---|---|---|
| `id` | `uuid` | Identidade da conversa; **é o `conversa_id`** de `P4` (D2) | não | imutável | PK; `(clinica_id, id)` único (**novo**, D5) | — |
| `clinica_id` | `uuid` | Isolamento multiclínica | não | imutável | FK `clinicas`; toda unicidade e todo CAS | valor vindo do paciente, da IA ou de campo livre |
| `paciente_id` | `uuid` | Vínculo com paciente | sim | mutável restrito | FK composta com clínica e telefone | paciente de outra clínica |
| `telefone_normalizado` | `text` | Chave natural da conversa | não | imutável | `(clinica_id, telefone_normalizado)` único; FK composta | formato fora do padrão nacional já validado |
| `estado` | `text` | Vocabulário conversacional da Etapa 1 | não | mutável restrito | CHECK de seis valores (D3) | vocabulário de composição (vive na tabela 3) |
| `dados` | `jsonb` | Estado oficial versionado (`EstadoNovoAgendamentoV1`) | não | mutável restrito | validado na escrita e na leitura (seção 17) | PII fora do contrato; predicado crítico interno |
| **`versao`** | `bigint` | **Versão monotônica do CAS** (D1) | não | mutável **somente pelo banco** | predicado do CAS; índice do CAS | valor calculado pelo cliente |
| **`versao_contrato_dados`** | `smallint` | Versão do contrato do JSONB `dados` (D4) | não | mutável restrito | validação de contrato (seção 17) | versão desconhecida aceita silenciosamente |
| `criado_em` | `timestamptz` | Auditoria | não | imutável | — | — |
| `atualizado_em` | `timestamptz` | Auditoria; **não é versão** | não | mutável restrito | — | uso como predicado de CAS da composição |

**Nota sobre `atualizado_em`:** permanece como carimbo de auditoria e continua servindo
ao contrato já existente da interpretação (Etapa 7). **Nunca** é o predicado de CAS
desta camada — o predicado é `versao` (seção 14).

### 5.2 `mensagens_recebidas` (existente — colunas novas marcadas)

| Campo | Tipo | Responsabilidade | Nulável | Regime | Participação | Proibido |
|---|---|---|---|---|---|---|
| `id` | `uuid` | Identidade interna da mensagem | não | imutável | PK; `(clinica_id, id)` único (**novo**) | — |
| `clinica_id` | `uuid` | Isolamento multiclínica | não | imutável | **chave de deduplicação nova** (D6, seção 3.2.1); FK composta | — |
| **`versao_contrato_registro`** | `smallint` | Coorte contratual da linha (seção 5.2.2) | **sim** (histórico) / **`= 1`** (fluxo `P4I`) | imutável quando presente | `CHECK` condicional das colunas abaixo | valor fora de `{null, legado explícito, 1}`; alteração depois de gravado |
| **`canal`** | `text` | Canal do transporte (D7) | **sim, transitoriamente** (seção 5.2.1) — **obrigatório quando `versao_contrato_registro = 1`** | imutável quando presente | chave de deduplicação nova; `CHECK` condicional (seção 5.2.2) | valor fora do catálogo fechado |
| `provider` | `text` | Provedor do transporte | não | imutável | chave de deduplicação; FK composta com `clinicas` | — |
| `instancia_whatsapp` | `text` | Instância autenticada | não | imutável | chave de deduplicação; FK composta | instância não autenticada |
| `message_id` | `text` | Identificador do transporte | não | imutável | chave de deduplicação | — |
| **`conversa_id`** | `uuid` | Vínculo obrigatório com a conversa | **sim, transitoriamente** (seção 5.2.1) — **obrigatório quando `versao_contrato_registro = 1`** | imutável quando presente | FK composta `(clinica_id, conversa_id)`; `CHECK` condicional (seção 5.2.2) | participação na chave de deduplicação (`P4` §3.B); vínculo fabricado sem evidência |
| `telefone_normalizado` | `text` | Origem | não | imutável | FK composta | formato fora do padrão já validado |
| `status_processamento` | `text` | Eixo Mensagem (`P4` §7) | não | mutável restrito | CHECK de quatro valores (D11) | quinto valor |
| **`payload_fingerprint`** | `bytea` | Detecção de envelope divergente (D8) | **sim, transitoriamente** (seção 5.2.1) — **obrigatório quando `versao_contrato_registro = 1`** | imutável quando presente | comparação na reapresentação; `CHECK` condicional (seção 5.2.2) | o payload em si; fingerprint calculado sem o envelope original |
| **`conteudo_bruto`** | `jsonb` | Texto/envelope bruto recebido (D9) | sim | mutável restrito (só limpeza) | retenção de 7 dias | permanência além de 7 dias |
| **`bruto_removido_em`** | `timestamptz` | Marcador de limpeza do bruto (D9) | sim | mutável restrito | retenção | — |
| `claim_token` | `uuid` | Autoridade do worker | sim | mutável restrito | claim/lease | token compartilhado entre workers |
| `lease_expira_em` | `timestamptz` | Expiração do lease (60 s) | sim | mutável restrito | índice de lease expirado | uso como validade semântica de continuação |
| `interpretacao_persistida_em` | `timestamptz` | Marcador de interpretação; **não bloqueia reclaim** (seção 8, 13.2) | sim | mutável restrito (uma vez) | — | reescrita |
| **`continuacao_atual_id`** | `uuid` | Continuação corrente (D10) | sim | mutável restrito | FK composta | — |
| **`resultado_id`** | `uuid` | Resultado terminal (D10) | sim | mutável restrito (uma vez) | FK composta; replay | reescrita depois de gravado |
| **`erro_codigo`** | `text` | Código técnico fechado da falha (seção 6.1) | sim | mutável restrito | — | mensagem livre; PII; payload bruto; detalhe interno |
| `recebido_em` | `timestamptz` | Início da retenção de 7 dias | não | imutável | retenção do bruto | — |
| `concluido_em` | `timestamptz` | Auditoria | sim | mutável restrito | — | — |

### 5.2.1 Compatibilidade das linhas existentes — `canal`, `conversa_id`, `payload_fingerprint`, vínculos

As colunas novas de `mensagens_recebidas` marcadas acima como **transitoriamente
nuláveis** exigem política explícita, porque linhas já existentes no ambiente-alvo
podem não ter evidência suficiente para preenchê-las corretamente.

**Preflight obrigatório**, antes de qualquer migration que adicione estas colunas:

- quantidade de linhas existentes;
- origem de cada linha (qual etapa/rodada as escreveu);
- se `canal` é **derivável** com evidência determinística para cada linha, ou apenas
  para um subconjunto;
- se `conversa_id` é **vinculável** com evidência determinística (por exemplo, por
  `telefone_normalizado` + `clinica_id`, se essa combinação for inequívoca no momento
  da auditoria);
- se existe payload suficiente (o `conteudo_bruto` original, ou equivalente) para
  calcular `payload_fingerprint` de cada linha;
- se existem resultados ou continuações já vinculáveis a alguma linha existente.

**Regras de backfill**, sem exceção:

- **nunca inventar payload bruto** que não exista mais;
- **nunca inventar fingerprint** quando o conteúdo original não estiver disponível —
  a linha permanece com `payload_fingerprint` nulo;
- **nunca fabricar vínculo** com conversa, continuação ou resultado sem evidência
  determinística direta;
- **campos deriváveis podem ser preenchidos somente por evidência determinística** —
  nunca por inferência probabilística, heurística ou "melhor palpite";
- **campos não deriváveis permanecem temporariamente nulos** — a nulabilidade
  transitória é **explícita** na tabela acima, nunca um `NOT NULL` mascarado por
  valor padrão fabricado;
- **constraints `NOT NULL` (ou equivalentes) só podem ser ativadas depois de
  backfill verificável** — nunca na mesma migration que cria a coluna, a menos que o
  preflight comprove 100% de cobertura determinística;
- **linhas incompatíveis devem ser classificadas e bloquear a promoção** até decisão
  técnica documentada — a migration não promove silenciosamente sobre dado que não
  se encaixa;
- **nenhuma linha antiga pode ser reinterpretada para fabricar dado** — reinterpretar
  seria exatamente o que `P4` proíbe para o domínio, e o mesmo princípio vale para
  metadados técnicos.

**Canal.** Catálogo fechado inicial coerente com o transporte já suportado por este
projeto. Se o preflight comprovar que **todas** as linhas existentes pertencem
comprovadamente ao mesmo canal autenticado (evidência operacional, não suposição), o
backfill pode usar esse valor único; **sem essa prova, o campo não é preenchido** e
permanece nulo.

**Fingerprint.** Calculado **somente** quando o envelope original estiver disponível
para a linha. Linhas sem conteúdo original permanecem com `payload_fingerprint`
ausente, sob política de compatibilidade explícita — e **a ausência histórica nunca
autoriza sobrescrever essa identidade no futuro**: uma linha que nasceu sem
fingerprint não ganha um fabricado depois, mesmo que uma reapresentação futura da
mesma mensagem física traga o payload.

**Vínculos.** `continuacao_atual_id` e `resultado_id` podem permanecer nulos
indefinidamente em linhas anteriores ao fluxo de `P4I` — elas nunca passaram por uma
composição que os preenchesse, e isso não é erro, é histórico legítimo. **Toda
mensagem nova criada sob o fluxo de `P4I` deve obedecer às constraints completas
desde a criação** — a nulabilidade transitória é exclusiva das linhas anteriores à
migration, nunca uma porta aberta para o fluxo novo.

### 5.2.2 Coorte contratual e enforcement físico — `versao_contrato_registro`

A seção 5.2.1 estabelece a **política** de compatibilidade; esta seção fecha o
**mecanismo físico** que a impõe no banco, para que linhas históricas com campos
legitimamente nulos e mensagens novas com contrato completo obrigatório coexistam
sem que o fluxo novo consiga contornar a obrigatoriedade usando a brecha do
histórico.

**Coluna nova:** `versao_contrato_registro smallint`, em `mensagens_recebidas`.

**Regras da coorte:**

- **linhas históricas** (anteriores à migration desta especificação) podem
  permanecer com `versao_contrato_registro` **nulo**, ou com um **valor legado
  explicitamente definido** somente depois do preflight da seção 5.2.1 — nunca um
  valor fabricado sem base no preflight;
- **mensagens novas do fluxo `P4I`** devem **nascer** com
  `versao_contrato_registro = 1`;
- **para `versao_contrato_registro = 1`, são obrigatórios**: `canal`, `conversa_id`,
  `payload_fingerprint` — as três colunas transitoriamente nuláveis da seção 5.2.1,
  agora **fisicamente exigidas** para essa coorte;
- **`continuacao_atual_id` e `resultado_id` permanecem condicionais ao estágio do
  processamento** — não são exigidos no nascimento da linha, mesmo sob
  `versao_contrato_registro = 1`, porque uma mensagem recém-registrada ainda não
  tem continuação nem resultado.

**O banco impõe a regra, não o adaptador:**

- **`CHECK` condicional** baseado em `versao_contrato_registro`: quando o valor é
  `1`, a constraint exige `canal`, `conversa_id` e `payload_fingerprint` não nulos;
  quando o valor é nulo ou legado, a constraint não se aplica;
- **operação fechada de inserção** (seção 13.1,
  `registrar_ou_recuperar_mensagem`) **sempre atribui `versao_contrato_registro = 1`**
  para toda mensagem nova do fluxo `P4I` — nunca deixa o valor a critério do
  chamador;
- **nenhuma dependência exclusiva de validação do adaptador** — mesmo que o
  adaptador falhe em validar antes de inserir, o `CHECK` do banco rejeita a
  inserção incompleta.

**Regras adicionais, fechadas:**

- **linhas históricas sem dados deriváveis não bloqueiam permanentemente a
  existência da constraint condicional** — a constraint só se aplica a
  `versao_contrato_registro = 1`; linhas com `null` ou valor legado nunca a
  disparam, por mais que nunca sejam completadas;
- **`NOT NULL` global nunca é ativado** em `canal`, `conversa_id` ou
  `payload_fingerprint` — essas colunas podem permanecer legitimamente nulas na
  coorte histórica para sempre; a obrigatoriedade é sempre **condicional** via
  `CHECK`, nunca uma constraint incondicional de coluna;
- **migrar uma linha histórica para a coorte `P4I`** (elevar
  `versao_contrato_registro` de nulo/legado para `1`) exige **backfill integral e
  verificável** das três colunas — nunca uma promoção parcial;
- **nenhuma linha é promovida para a versão contratual nova sem satisfazer todas as
  invariantes** — promoção parcial (por exemplo, `canal` preenchido mas
  `payload_fingerprint` ausente) é rejeitada pelo mesmo `CHECK`;
- **mensagens novas não podem usar a coorte histórica para contornar
  obrigatoriedade** — a operação de inserção da seção 13.1 nunca grava
  `versao_contrato_registro` nulo ou legado para uma mensagem que está entrando
  agora pelo fluxo `P4I`; a coorte histórica é exclusiva de linhas que já existiam
  antes da migration.

### 5.3 `continuacoes_composicao` (nova)

| Campo | Tipo | Responsabilidade | Nulável | Regime | Participação | Proibido |
|---|---|---|---|---|---|---|
| `id` | `uuid` | `continuacao_id`, emitido pelo Core | não | imutável | PK; `(clinica_id, id)` único | identidade gerada pelo adaptador ou pela IA |
| `clinica_id` | `uuid` | Isolamento | não | imutável | toda FK e unicidade | — |
| `conversa_id` | `uuid` | Origem | não | imutável | FK composta | — |
| `mensagem_id` | `uuid` | Mensagem de origem | não | imutável | FK composta; unicidade da retomável | — |
| `versao_estado_origem` | `bigint` | Versão sobre a qual foi emitida | não | imutável | unicidade da retomável; compatibilidade | — |
| `etapa` | `text` | `EtapaComposicaoV1` | não | imutável | — | etapa fora da união fechada |
| `status` | `text` | Eixo composição (`P4` §7) | não | **mutável restrito** | índice de retomável e de encerramento | valor fora dos sete |
| `envelope` | `jsonb` | `ContinuacaoComposicaoV1` completa | sim (após limpeza) | **imutável** enquanto existir | validação de contrato; retenção 30 d | edição de conteúdo |
| `versao_contrato_envelope` | `smallint` | Versão do contrato do envelope | não | imutável | validação | versão desconhecida aceita |
| `sucessora_id` | `uuid` | Continuação seguinte | sim | mutável restrito (uma vez) | FK composta | ciclo; reescrita |
| `requisicao_pendente_id` | `uuid` | Requisição em aberto | sim | mutável restrito | FK composta | mais de uma simultânea |
| `efeito_pendente_id` | `uuid` | Efeito em aberto | sim | mutável restrito | FK composta | mais de um simultâneo |
| `resultado_candidato` | `jsonb` | Candidato preservado (`C3`) | sim | imutável enquanto existir | retenção 30 d | promoção fora da transação final |
| `criado_em` | `timestamptz` | Auditoria | não | imutável | — | — |
| `encerrado_em` | `timestamptz` | **Início do prazo de 30 dias** | sim | mutável restrito (uma vez) | retenção | preenchimento com continuação ainda ativa |
| `payload_removido_em` | `timestamptz` | Marcador de limpeza | sim | mutável restrito | retenção | — |

**Campos imutáveis** (nunca reescritos): `id`, `clinica_id`, `conversa_id`,
`mensagem_id`, `versao_estado_origem`, `etapa`, `envelope`,
`versao_contrato_envelope`, `resultado_candidato`, `criado_em`.

**Mutáveis restritos**, e somente pelas operações da seção 13: `status`,
`sucessora_id`, `requisicao_pendente_id`, `efeito_pendente_id`, `encerrado_em`,
`payload_removido_em`. Isto realiza literalmente `P4` §3.C: *somente status e
referências de sucessão podem mudar*.

### 5.4 `requisicoes_composicao` (nova)

| Campo | Tipo | Responsabilidade | Nulável | Regime | Participação | Proibido |
|---|---|---|---|---|---|---|
| `id` | `uuid` | `requisicao_id`, emitido pelo Core | não | imutável | PK; `(clinica_id, id)` único | identidade do adaptador |
| `clinica_id` | `uuid` | Isolamento | não | imutável | FK e unicidade | — |
| `continuacao_id` | `uuid` | Continuação emissora | não | imutável | FK composta | — |
| `conversa_id` | `uuid` | Origem | não | imutável | FK composta | — |
| `tipo` | `text` | `leitura` ou `preparacao_efeito` | não | imutável | — | tipo fora do par |
| `parametros` | `jsonb` | Parâmetros fechados | sim (após limpeza) | imutável | validação; retenção 30 d | alteração após emissão |
| `parametros_fingerprint` | `bytea` | Detecção de divergência | não | imutável | comparação na reapresentação | os parâmetros em si |
| `versao_contrato_parametros` | `smallint` | Versão do contrato | não | imutável | validação | — |
| `versao_estado_origem` | `bigint` | Versão de origem | não | imutável | compatibilidade | — |
| `status` | `text` | `pendente`, `respondida`, `encerrada` | não | mutável restrito | índice de encerramento | — |
| `resposta` | `jsonb` | Resposta fechada recebida | sim | imutável (uma vez) | retenção 30 d | segunda resposta divergente |
| `resposta_fingerprint` | `bytea` | Idempotência da reapresentação | sim | imutável (uma vez) | comparação | — |
| `criado_em` | `timestamptz` | Auditoria | não | imutável | — | — |
| `encerrado_em` | `timestamptz` | Início dos 30 dias | sim | mutável restrito (uma vez) | retenção | — |
| `payload_removido_em` | `timestamptz` | Marcador de limpeza | sim | mutável restrito | retenção | — |

### 5.5 `efeitos_composicao` (nova)

| Campo | Tipo | Responsabilidade | Nulável | Regime | Participação | Proibido |
|---|---|---|---|---|---|---|
| `id` | `uuid` | `efeito_id`, emitido pelo Core | não | imutável | PK; `(clinica_id, id)` único | identidade inventada pelo adaptador |
| `clinica_id` | `uuid` | Isolamento | não | imutável | FK e unicidade | — |
| `continuacao_id` | `uuid` | Continuação emissora | não | imutável | FK composta | — |
| `conversa_id` | `uuid` | Origem | não | imutável | FK composta | — |
| **`requisicao_id`** | `uuid` | Requisição preparatória de origem, quando existir (seção 11) | **sim, condicional** | imutável quando presente | FK composta `(clinica_id, requisicao_id)`; correlação | trocar ou remover na reapresentação; presente sem classe `preparacao_efeito` |
| `tipo` | `text` | Tipo da escrita autorizada | não | imutável | — | tipo fora do catálogo |
| `parametros` | `jsonb` | Parâmetros **imutáveis** da escrita | sim (após limpeza) | **imutável** | validação; retenção 30 d | qualquer alteração após emissão |
| `parametros_fingerprint` | `bytea` | Detecção de divergência | não | imutável | comparação (revalidação) | os parâmetros em si |
| `versao_contrato_parametros` | `smallint` | Versão do contrato | não | imutável | validação | — |
| `versao_estado_origem` | `bigint` | Versão de origem | não | imutável | revalidação de fatos | — |
| `status` | `text` | `pendente`, `confirmado`, `encerrado` | não | mutável restrito | índice de encerramento | — |
| `claim_token` | `uuid` | Autoridade do worker executor | sim | mutável restrito | claim/lease próprio | token compartilhado |
| `lease_expira_em` | `timestamptz` | Expiração do lease (5 min) | sim | mutável restrito | índice de lease expirado | uso como validade de continuação |
| `confirmacao` | `jsonb` | Confirmação da escrita | sim | imutável (uma vez) | retenção 30 d | segunda confirmação divergente |
| `confirmado_em` | `timestamptz` | Marcador de confirmação | sim | mutável restrito (uma vez) | — | reescrita |
| `criado_em` | `timestamptz` | Auditoria | não | imutável | — | — |
| `encerrado_em` | `timestamptz` | Início dos 30 dias | sim | mutável restrito (uma vez) | retenção | — |
| `payload_removido_em` | `timestamptz` | Marcador de limpeza | sim | mutável restrito | retenção | — |

### 5.6 `resultados_composicao` (nova)

| Campo | Tipo | Responsabilidade | Nulável | Regime | Participação | Proibido |
|---|---|---|---|---|---|---|
| `id` | `uuid` | `resultado_id`, emitido pelo Core | não | **imutável** | PK; `(clinica_id, id)` único | reescrita de qualquer natureza |
| `clinica_id` | `uuid` | Isolamento | não | imutável | FK e unicidade | — |
| `mensagem_id` | `uuid` | Mensagem de origem | não | imutável | **`(clinica_id, mensagem_id)` único** | segundo resultado para a mesma mensagem |
| `conversa_id` | `uuid` | Conversa | não | imutável | FK composta | — |
| `continuacao_id` | `uuid` | Continuação que o produziu | não | imutável | FK composta; metadado preservado | — |
| `efeito_id` | `uuid` | Efeito final, quando existente | sim | imutável | FK composta; metadado preservado | — |
| `versao_resultante` | `bigint` | Versão do estado após a transação final | não | imutável | metadado preservado | — |
| `versao_contrato_resultado` | `smallint` | Versão do contrato do payload | não | imutável | validação; metadado preservado | — |
| `tipo_terminal` | `text` | Decisão ou falha de domínio persistível | não | imutável | metadado preservado | falha estrutural interna; `conflito_versao` |
| `resultado_logico` | `jsonb` | `RegistroResultadoComposicao` | sim (após limpeza) | **imutável enquanto existir** | **`P4I-R1`: removido após 30 d** | mutação |
| `comando` | `jsonb` | Comando da decisão | sim (após limpeza) | imutável enquanto existir | **removido após 30 d** | mutação |
| `fatos_autorizados` | `jsonb` | Fatos autorizados para redação | sim (após limpeza) | imutável enquanto existir | **removido após 30 d** | mutação |
| `conteudo_fingerprint` | `bytea` | Identidade do conteúdo | não | **imutável** | **metadado preservado para sempre** | remoção pela limpeza |
| `criado_em` | `timestamptz` | **Início do prazo de 30 dias** (`P4I-R1`) | não | imutável | retenção | — |
| `payload_removido_em` | `timestamptz` | Marcador de limpeza | sim | mutável restrito (uma vez) | retenção; sinaliza replay indisponível | — |

**O prazo de `resultados_composicao` conta de `criado_em`** — não de encerramento —
porque o resultado já nasce terminal (`P4I-R1`).

## 6. Chaves e isolamento multiclínica

Regras fechadas, válidas para as seis tabelas:

- **UUID opaco como chave primária** em todas — nenhum significado é derivado do valor;
- **unicidade estrutural `(clinica_id, id)`** em toda tabela que seja alvo de
  referência, para servir de destino às FKs compostas;
- **foreign keys compostas incluindo `clinica_id`** em toda referência entre estas
  tabelas;
- **nenhuma referência é autorizada somente por UUID global** — uma FK que ignore
  `clinica_id` permitiria vincular registros de clínicas diferentes, e isso é
  estruturalmente proibido, não apenas desencorajado;
- `clinica_id` **vem exclusivamente da instância autenticada** (`P4` §12), nunca do
  paciente, da IA ou de campo livre do payload.

**Chave de deduplicação de mensagem** (`P4` §6), fechada:

`clinica_id` + `canal` + `provider` + `instancia_whatsapp` + `message_id`.

O texto **não** integra a identidade; `conversa_id` é vínculo obrigatório mas **não**
integra a chave (`P4` §3.B).

**Unicidades adicionais fechadas:**

| Regra | Constraint conceitual | Origem |
|---|---|---|
| Resultado único por mensagem | `(clinica_id, mensagem_id)` único em `resultados_composicao` | `P4` §3.E |
| Efeito único por identidade | `(clinica_id, id)` único em `efeitos_composicao` | `P4` §8 |
| Continuação retomável única | única por `(clinica_id, mensagem_id, versao_estado_origem)` **entre as não encerradas** | `P4` §3.C, §7 |

A terceira é **condicional por status**: apenas uma continuação **retomável** (não
`superada`, não `resultado_persistido`, não `falha_fechada`) pode existir para uma
mesma clínica, mensagem e versão de origem. Continuações encerradas do mesmo trio
coexistem sem conflito — são histórico, não checkpoints disputando retomada.

**Identificador de outra clínica é tratado como inexistente**, nunca como acesso
negado (`P4` §12) — negar revelaria existência. O erro correspondente é
`referencia_cruzada_clinica` (seção 23), e ele nunca informa se a linha existe em outra
clínica.

**Correlação requisição → efeito**, fechada:

| Regra | Constraint conceitual | Origem |
|---|---|---|
| Efeito correlacionado à requisição que o preparou | `efeitos_composicao.requisicao_id` opcional, FK composta `(clinica_id, requisicao_id)` quando presente | seção 11, `P4I.16` |

### 6.1 Nomenclatura de campos de erro técnico

**`erro_codigo`** é o nome padronizado, em toda tabela desta especificação, para o
campo que armazena o código técnico fechado de uma falha (catálogo da seção 23).
**`erro_tecnico` não é usado** neste documento — o sufixo "técnico" sozinho poderia
sugerir texto livre de diagnóstico, e este campo nunca é isso.

Confirmado para todo campo com este papel:

- **valor sempre um código fechado**, membro do catálogo da seção 23 — nunca um valor
  fora dele;
- **sem mensagem livre** — nenhuma interpolação de identificador, valor recebido ou
  fragmento de payload;
- **sem PII**, em qualquer circunstância;
- **detalhes internos não são persistidos neste campo** — se um detalhe de
  diagnóstico for necessário, ele vive em log técnico (seção 19), nunca na linha.

## 7. Estado oficial

`estado_conversa` é a **autoridade durável** do estado da conversa (`P4` §4). Regras
fechadas:

- **uma linha corrente por clínica e conversa** — garantida por
  `(clinica_id, telefone_normalizado)` único, já existente;
- **sem histórico próprio de versões** — esta tabela não é event log; não existe tabela
  de versões anteriores do estado, e nenhuma é criada aqui. O histórico técnico vive
  nas continuações, que **não** são fonte de estado;
- **versão `bigint`**, começando em **zero** na criação da linha;
- **incremento somente pelo banco** (seção 14) — o cliente envia a versão **esperada**,
  nunca a resultante;
- **estado oficial em JSONB versionado** (`dados` + `versao_contrato_dados`);
- **identidade, versão e timestamps normalizados** em colunas próprias — nunca dentro
  do JSONB, porque participam de chave, CAS e índice (seção 17);
- **nenhuma reconstrução a partir de continuações** (`P4` §4) — nem parcial, nem em
  recuperação de falha;
- **nenhuma escrita direta por cliente** — `anon` e `authenticated` não têm acesso
  operacional (seção 19);
- **alteração somente por operações transacionais fechadas** (seção 13) — nunca por
  `UPDATE` avulso montado no adaptador.

**Distinção obrigatória preservada:** `fatos_temporais` (fonte interpretada acumulada) e
`criterio_temporal` (resultado derivado) são campos **distintos** dentro do JSONB
`dados`, nunca fundidos (`P4` §3.A, `persistencia-v1.md` §17). A invalidação de
derivados acontece **antes** da primeira persistência do turno (seção 13,
`persistir_checkpoint`).

## 8. Mensagens recebidas

Regras fechadas:

- **registro criado antes da interpretação** — a deduplicação precede qualquer chamada
  à IA (`P4` §6);
- **deduplicação** pela chave da seção 6, com `clinica_id` incluído (correção de D6);
- **fingerprint** (`payload_fingerprint`) registrado na criação; **mesma identidade com
  payload divergente falha fechado** (`mensagem_payload_divergente`) — nunca
  sobrescreve, nunca reconcilia, nunca escolhe a versão mais recente;
- **claim** e **lease** de 60 segundos (seção 15);
- **marcador da interpretação** (`interpretacao_persistida_em`), gravado uma única vez;
- **continuação atual** (`continuacao_atual_id`) e **resultado** (`resultado_id`) como
  vínculos, corrigindo D10;
- **`erro_codigo`** em código fechado, sem PII, sem mensagem livre (seção 6.1);
- **retenção do bruto**: 7 dias a partir de `recebido_em` (seção 18);
- **reclaim permitido pelo lease expirado, em ambos os casos** (seção 13.2): o
  marcador `interpretacao_persistida_em` **não impede** o reclaim — ele **determina o
  comportamento seguinte** depois que o claim é readquirido: sem marcador, interpretar;
  com marcador, resposta fixa canônica, nunca reinterpretação;
- **replay** quando existe resultado (seção 12);
- **retorno fechado após expiração do payload de resultado**:
  `resultado_processado_payload_expirado` (`P4I-R1`).

Preservado explicitamente:

- **mensagem bruta por 7 dias**, depois payload removido e **linha preservada**;
- **identidade e metadados sem prazo de expiração definido nesta spec** — a chave de
  deduplicação vive indefinidamente, porque a deduplicação é permanente;
- **nenhuma sobrescrita de payload divergente**, em nenhuma circunstância;
- **claim vigente impede processamento paralelo**, em qualquer dos dois caminhos de
  reclaim;
- **worker antigo perde autoridade** assim que o token é rotacionado pela nova
  aquisição, em qualquer dos dois caminhos;
- **resultado existente produz replay antes de qualquer retomada** — se
  `resultado_id` já está vinculado, a retomada nunca chega a avaliar reclaim ou
  interpretação; devolve o resultado (seção 12);
- **payload divergente continua falhando fechado**, independentemente do estado de
  `interpretacao_persistida_em`.

**Interpretação registrada sem resultado recuperável** segue a resposta fixa canônica
já aprovada (`interpretacao-ia.md`, `../docs/04-decisoes-canonicas.md`), aguardando
nova mensagem — e **nunca** reconstrói interpretação, eventos candidatos ou conflitos
de valor, que permanecem transitórios e nunca persistidos (`P4` §6). **Isto vale tanto
na primeira aquisição do claim quanto no reclaim depois de um lease expirado** — o
caminho é o mesmo, decidido inteiramente pela presença do marcador.

## 9. Continuações

Regras fechadas:

- **envelope JSONB versionado** (`envelope` + `versao_contrato_envelope`), contendo
  `ContinuacaoComposicaoV1` (`integracao-temporal-composicao-v1.md` §11);
- **campos imutáveis** e **campos mutáveis restritos** conforme a seção 5.3 — o
  envelope **nunca** é editado depois de emitido;
- **uma continuação retomável por mensagem e versão de origem** (seção 6), garantida
  por unicidade condicional ao status;
- **superação atômica**: marcar a anterior como `superada` e inserir a nova acontecem
  **na mesma transação** (seção 13, `persistir_checkpoint`) — nunca em duas operações
  separadas, que deixariam duas continuações disputando a mesma versão;
- **sucessora** registrada em `sucessora_id`, gravada uma única vez, sem ciclo;
- **candidato** (`resultado_candidato`) preservado antes da persistência final e
  devolvido depois **sem recomputação** (`C3`); **nunca promovido fora da transação
  final**;
- **requisição pendente** e **efeito pendente**: no máximo um de cada, simultaneamente;
- **encerramento** por `resultado_persistido`, `superada` ou `falha_fechada`, gravando
  `encerrado_em`;
- **limpeza após 30 dias** contados **do encerramento** (`P4` §11, `P4-R1`);
- **proibição de retomada sem payload**: uma continuação cujo `payload_removido_em`
  está preenchido **nunca** autoriza retomada — o erro é `payload_removido` (seção 23),
  e o registro existe apenas para auditoria e detecção de reapresentação divergente.

**Continuação ativa nunca entra no prazo de 30 dias** e **nunca perde payload por
passagem de tempo** (`P4` §11): o relógio só começa a correr no encerramento.

## 10. Requisições

`requisicoes_composicao` registra as **leituras** solicitadas pelo Core e as
**preparações de efeito** — nunca a escrita em si, que vive na tabela 5.

Regras fechadas:

- **tipo** `leitura` ou `preparacao_efeito`, união fechada;
- **identidade persistente** (`requisicao_id`), emitida pelo Core uma única vez;
- **parâmetros fechados**, imutáveis depois de emitidos;
- **fingerprint** dos parâmetros, para detectar reapresentação divergente;
- **resposta fechada**: gravada uma única vez; a segunda apresentação da **mesma**
  resposta é **idempotente** (compara `resposta_fingerprint` e não altera nada);
- **reapresentação idempotente**: mesma requisição, mesma resposta, mesmo fingerprint →
  sucesso sem nova escrita;
- **divergência fechada**: mesma requisição com resposta de fingerprint diferente →
  falha fechada, sem sobrescrever, sem reconciliar;
- **resposta sem requisição pendente correspondente** → falha fechada
  (`resposta_sem_requisicao`, `integracao-temporal-composicao-v1.md` §20 — `D2`);
- **retenção de 30 dias após encerramento**, depois payload removido e metadados
  preservados.

## 11. Efeitos

`efeitos_composicao` registra as **escritas autorizadas pelo Core**.

Regras fechadas:

- **escrita autorizada pelo Core** — o adaptador executa, nunca decide;
- **identidade estável** (`efeito_id`): a mesma escrita lógica mantém o mesmo
  identificador em toda tentativa, inclusive na retomada;
- **claim e lease próprios**, de 5 minutos (seção 15), independentes do lease da
  mensagem;
- **parâmetros imutáveis** — nunca alterados depois da emissão, em nenhuma tentativa;
- **confirmação** gravada uma única vez, com `confirmado_em`;
- **idempotência**: reapresentar o mesmo `efeito_id` com o mesmo
  `parametros_fingerprint` sobre um efeito já confirmado **não repete a escrita** —
  reconhece a confirmação existente (`P4` §9, caso D);
- **revalidação de fatos** antes de confirmar: a versão de origem e a compatibilidade
  da continuação são reverificadas na própria transação, nunca presumidas de uma
  leitura anterior;
- **mesma identidade na retomada** — a retomada reapresenta exatamente o mesmo
  `efeito_id`, jamais um novo (`P4` §10, `P4T-09`);
- **divergência fechada**: mesmo `efeito_id` com parâmetros de fingerprint diferente →
  `efeito_payload_divergente`, falha fechada;
- **retenção de 30 dias após encerramento**.

**O adaptador nunca inventa efeito substituto.** Se o efeito registrado não puder ser
executado como está, o desfecho é falha fechada — nunca uma escrita equivalente,
aproximada ou corrigida pelo adaptador. Isso é a contraparte física de `P4` §8
(*"nunca inventadas pelo adaptador — o adaptador ecoa a identidade que recebeu"*) e de
`P4` §13 (o orquestrador **não pode decidir** substituição silenciosa).

**Correlação `requisicao_id` → efeito**, fechada:

- **obrigatório** quando o efeito tiver origem numa requisição de classe
  `preparacao_efeito` já registrada em `requisicoes_composicao` (seção 10) —
  `requisicao_id` referencia essa linha;
- **nulo somente** quando o Core emitir diretamente um efeito **sem** requisição
  preparatória prevista pelo contrato — nunca por omissão do adaptador quando uma
  requisição existia;
- **FK composta** obrigatória: `(clinica_id, requisicao_id)` → `requisicoes_composicao
  (clinica_id, id)`, quando presente;
- a requisição vinculada deve pertencer **exatamente** à mesma clínica, à mesma
  conversa, à mesma mensagem e à mesma continuação do efeito — qualquer divergência
  entre esses quatro campos é `continuacao_incompativel`;
- a requisição vinculada deve possuir **classe compatível** (`preparacao_efeito`) —
  vincular um efeito a uma requisição de classe `leitura` é `efeito_payload_divergente`;
- **uma reapresentação nunca pode trocar ou remover** a `requisicao_id` de origem —
  o campo é imutável quando presente; tentar associá-lo a uma requisição diferente é
  divergência de correlação, falha fechada;
- **`requisicoes_composicao` e `efeitos_composicao` continuam tabelas separadas**
  (`P4I.13`) — o campo `requisicao_id` é um vínculo direto, não uma fusão das duas
  responsabilidades;
- **o vínculo direto preserva rastreabilidade e correlação verificável** entre a
  leitura que preparou o efeito e a escrita que o executou, sem depender de inferência
  por proximidade temporal ou por continuação;
- **o adaptador não pode criar efeito substituto** mesmo quando a correlação com a
  requisição estiver ausente ou incompatível — o desfecho continua sendo falha
  fechada, nunca uma escrita aproximada.

## 12. Resultados

Regras fechadas:

- **um resultado por clínica e mensagem** — `(clinica_id, mensagem_id)` único;
- **conteúdo imutável** — nunca reescrito, nunca versionado sobre si mesmo; a única
  alteração permitida em toda a vida da linha é a **remoção de payload** pela limpeza,
  que não altera conteúdo, apenas o retira;
- **replay antes da máquina** (`C5`) — a função pura não é chamada, a IA não é chamada,
  resolvedores não são chamados, disponibilidade não é consultada, domínio não é
  recomposto;
- **versão resultante** (`versao_resultante`), preservada como metadado;
- **resultado lógico**, **tipo terminal**, **comando** e **fatos autorizados**
  registrados no momento da transação final;
- **fingerprint** do conteúdo, preservado **para sempre**;
- **`payload_removido_em`**, marcador da limpeza.

**Aplicação de `P4I-R1`** (seção 2):

| Momento | Payload | Deduplicação | Replay |
|---|---|---|---|
| Até 30 dias de `criado_em` | presente e íntegro | ativa | **completo** |
| Após 30 dias | removido; metadados preservados | **ativa, permanente** | **indisponível** → `resultado_processado_payload_expirado` |

Depois da limpeza, a mensagem **continua deduplicada** e o sistema **não** reinterpreta,
**não** chama a máquina, **não** consulta disponibilidade, **não** reconstrói o
resultado e **não** gera resposta nova como se a mensagem fosse inédita.

## 13. Operações técnicas

Contratos **conceituais**. Nenhum SQL, nenhuma assinatura definitiva de RPC, nenhum
nome final de função é fixado aqui (seção 27).

Comportamento multiclínica **comum a todas**: toda entrada carrega `clinica_id` vindo
da instância autenticada; todo predicado de leitura e de escrita inclui `clinica_id`;
identificador de outra clínica é tratado como **inexistente**, nunca como acesso
negado, e produz `referencia_cruzada_clinica` sem revelar existência.

### 13.1 `registrar_ou_recuperar_mensagem`

- **Entrada:** chave de deduplicação completa (seção 6); `conversa_id`;
  `payload_fingerprint`; conteúdo bruto.
- **Pré-condições:** clínica autenticada; conversa pertencente à clínica.
- **Alterações atômicas:** insere a linha se a chave não existir, **sempre com
  `versao_contrato_registro = 1`** e `canal`, `conversa_id` e `payload_fingerprint`
  preenchidos (seção 5.2.2) — a operação nunca deixa esse valor a critério do
  chamador, e nunca grava uma mensagem nova na coorte histórica; se existir, não
  altera nada.
- **Saída:** identidade interna; status; se há resultado; se o payload do resultado
  expirou.
- **Erros:** `mensagem_payload_divergente`; `referencia_cruzada_clinica`;
  `banco_indisponivel`.
- **Idempotência:** total — chamar N vezes com a mesma identidade e o mesmo fingerprint
  produz o mesmo resultado e no máximo uma linha.
- **Invariantes:** o texto nunca integra a identidade; payload divergente sob a mesma
  identidade nunca sobrescreve.

### 13.2 `adquirir_claim_mensagem`

- **Entrada:** identidade da mensagem; clínica.
- **Pré-condições:** status `recebida`, **ou** `processando` com lease **expirado** —
  **em ambos os casos, com ou sem `interpretacao_persistida_em` já preenchido**. O
  marcador de interpretação **nunca** é pré-condição de bloqueio do claim; ele é
  **saída** que determina o comportamento seguinte, não impedimento de entrada.
- **Alterações atômicas:** grava `claim_token` novo (rotacionado) e
  `lease_expira_em` = relógio do banco + 60 s; status passa a (ou permanece)
  `processando`.
- **Saída:** token; expiração; **se `interpretacao_persistida_em` já estava
  preenchido** — o chamador usa esse único sinal para decidir entre os dois caminhos
  abaixo, nunca reavaliando por conta própria.
- **Erros:** `claim_ocupado`; `referencia_cruzada_clinica`; `banco_indisponivel`.
- **Idempotência:** não é idempotente por natureza — cada aquisição **rotaciona** o
  token; o worker antigo perde autoridade imediatamente.
- **Invariantes:** lease nula nunca é tratada como expirada nem como autorização
  válida; status `concluida` ou `falhou` nunca é reivindicável; claim vigente (lease
  não expirado) sempre impede uma segunda aquisição concorrente.

**Os dois caminhos do reclaim**, decididos exclusivamente pela saída acima:

- **Sem interpretação persistida** (`interpretacao_persistida_em` nulo): adquirir o
  novo claim; rotacionar `claim_token`; **interpretar a mensagem** — chamar a IA,
  como se fosse a primeira tentativa;
- **Com interpretação persistida** (`interpretacao_persistida_em` preenchido):
  adquirir o novo claim; rotacionar `claim_token`; **não reinterpretar**; **não
  reconstruir eventos candidatos nem conflitos de valor**; retornar o **caminho
  canônico de resposta fixa** já aprovado (`interpretacao-ia.md`,
  `../docs/04-decisoes-canonicas.md`).

Em ambos os caminhos: **resultado existente produz replay antes de qualquer
retomada** — se `resultado_id` já está vinculado à mensagem, a operação de replay
(seção 13.7) responde primeiro, e o reclaim nem chega a ser avaliado; e **payload
divergente continua falhando fechado**, em qualquer um dos dois caminhos.

### 13.3 `renovar_lease_mensagem`

- **Entrada:** identidade; clínica; token vigente.
- **Pré-condições:** token corresponde exatamente ao gravado; lease ainda não expirou.
- **Alterações atômicas:** estende `lease_expira_em` para relógio do banco + 60 s. **O
  token não é rotacionado.**
- **Saída:** nova expiração.
- **Erros:** `lease_perdido`; `referencia_cruzada_clinica`; `banco_indisponivel`.
- **Idempotência:** repetível enquanto o token for válido.
- **Invariantes:** renovar **não** ressuscita um lease já expirado e tomado por outro
  worker — nesse caso o resultado é `lease_perdido`.

### 13.4 `registrar_interpretacao`

- **Entrada:** identidade; clínica; token; marcador.
- **Pré-condições:** token válido; lease vigente; marcador ainda vazio.
- **Alterações atômicas:** grava `interpretacao_persistida_em` uma única vez.
- **Saída:** confirmação.
- **Erros:** `lease_perdido`; `banco_indisponivel`.
- **Idempotência:** marcador já preenchido → sucesso sem nova escrita.
- **Invariantes:** eventos candidatos e conflitos de valor **nunca** são persistidos.

### 13.5 `persistir_checkpoint` — persistência intermediária

Contraparte física de `P4` §5. **Uma única transação lógica**, na ordem:

1. validar clínica, conversa, mensagem, continuação e efeito — inclusive a
   correlação `requisicao_id` do efeito com a continuação, quando presente (seção 11);
2. verificar a versão esperada (CAS, seção 14);
3. gravar fatos novos e **invalidações de derivados**;
4. atualizar o estado oficial;
5. incrementar a versão (pelo banco);
6. confirmar o efeito;
7. marcar a continuação anterior como `superada`;
8. persistir a nova continuação oficial.

- **Entrada:** clínica; conversa; mensagem; continuação anterior; versão esperada;
  efeito a confirmar; envelope da continuação nova.
- **Pré-condições:** continuação anterior retomável e compatível; efeito pendente
  pertencente a ela; versão esperada igual à corrente.
- **Saída:** nova versão; identidade da continuação nova.
- **Erros:** `conflito_versao`; `continuacao_incompativel`;
  `efeito_payload_divergente`; `referencia_cruzada_clinica`; `banco_indisponivel`.
- **Idempotência:** se o efeito já estiver confirmado e a continuação já superada com
  a sucessora registrada, a reapresentação **reconhece** o avanço e não repete nada
  (`P4` §9, caso D).
- **Invariantes:** **nada fica parcialmente atualizado**; a invalidação ocorre **antes**
  da primeira persistência do turno; nunca existem duas continuações retomáveis para a
  mesma versão.

### 13.6 `persistir_resultado_final` — persistência final

Contraparte física de `P4` §5. **Uma única transação lógica**, na ordem:

1. validar identidades e versão;
2. atualizar o estado final;
3. incrementar a versão;
4. inserir o resultado imutável;
5. vincular o `resultado_id` à mensagem;
6. confirmar o efeito final;
7. marcar a mensagem como `concluida`;
8. encerrar a continuação.

- **Entrada:** clínica; conversa; mensagem; continuação; versão esperada;
  `resultado_id`; `efeito_id`; resultado lógico; tipo terminal; comando; fatos
  autorizados; fingerprint.
- **Pré-condições:** candidato presente na continuação; identidades compatíveis; versão
  esperada válida.
- **Saída:** versão resultante; `resultado_id` confirmado.
- **Erros:** `conflito_versao`; `continuacao_incompativel`; `resultado_duplicado`;
  `efeito_payload_divergente`; `referencia_cruzada_clinica`; `banco_indisponivel`.
- **Idempotência:** resultado já existente com o **mesmo** `resultado_id` e o mesmo
  fingerprint → sucesso sem segunda inserção; `resultado_id` diferente para a mesma
  mensagem → `resultado_duplicado`, falha fechada.
- **Invariantes:** **estado final e resultado lógico nunca são confirmados
  separadamente**; a ausência isolada de resultado **nunca** produz falha fechada por
  si só (`P4` §10, `P4T-09`) — a retomada reapresenta o mesmo efeito.

### 13.7 `recuperar_replay`

- **Entrada:** identidade da mensagem; clínica.
- **Pré-condições:** nenhuma além do isolamento.
- **Alterações atômicas:** **nenhuma** — operação estritamente de leitura.
- **Saída:** identidade da mensagem; `resultado_id`; versão resultante; resultado
  terminal; comando; fatos autorizados — **ou** o marcador de payload expirado.
- **Erros:** `replay_disponivel` (sinalização positiva);
  `resultado_processado_payload_expirado`; `referencia_cruzada_clinica`;
  `banco_indisponivel`.
- **Idempotência:** total (leitura pura).
- **Invariantes:** ocorre **antes da máquina**; não reinterpreta; não chama
  resolvedores; não consulta disponibilidade; não recompõe domínio; **não depende de a
  resposta ter sido redigida ou enviada**.

### 13.8 `marcar_continuacao_superada`

- **Entrada:** clínica; continuação; sucessora.
- **Pré-condições:** continuação ainda retomável.
- **Alterações atômicas:** status → `superada`; grava `sucessora_id` e `encerrado_em`.
- **Saída:** confirmação.
- **Erros:** `continuacao_incompativel`; `banco_indisponivel`.
- **Idempotência:** já superada com a **mesma** sucessora → sucesso sem nova escrita;
  sucessora diferente → `continuacao_incompativel`.
- **Invariantes:** o envelope **nunca** é alterado; encerramento é permanente e nada o
  reabre.

### 13.9 `adquirir_claim_efeito`

- **Entrada:** clínica; `efeito_id`.
- **Pré-condições:** efeito `pendente`; sem lease vigente de outro worker.
- **Alterações atômicas:** grava token novo e `lease_expira_em` = relógio do banco +
  5 min.
- **Saída:** token; expiração.
- **Erros:** `claim_ocupado`; `referencia_cruzada_clinica`; `banco_indisponivel`.
- **Idempotência:** cada aquisição rotaciona o token; o worker antigo perde autoridade.
- **Invariantes:** efeito já `confirmado` nunca é reivindicável; o lease **não** altera
  a validade semântica da continuação.

### 13.10 `renovar_lease_efeito`

- **Entrada:** clínica; `efeito_id`; token vigente.
- **Pré-condições:** token corresponde; lease ainda não expirou.
- **Alterações atômicas:** estende a expiração por mais 5 minutos, **sem** rotacionar
  o token.
- **Saída:** nova expiração.
- **Erros:** `lease_perdido`; `banco_indisponivel`.
- **Idempotência:** repetível enquanto o token for válido.
- **Invariantes:** não ressuscita lease já tomado por outro worker.

### 13.11 `limpar_payloads_expirados`

- **Entrada:** tamanho do lote; política alvo (bruto 7 d; artefatos técnicos 30 d;
  resultados 30 d).
- **Pré-condições:** nenhuma além do isolamento.
- **Alterações atômicas:** por linha elegível, remove os payloads da política e grava
  o marcador correspondente (`bruto_removido_em` ou `payload_removido_em`).
- **Saída:** quantidade tratada por política.
- **Erros:** `banco_indisponivel`.
- **Idempotência:** total — linha já limpa não é alterada novamente.
- **Invariantes:** **nunca apaga linhas**; **nunca limpa continuação ativa**; **nunca**
  remove identidade, fingerprint ou vínculos; verifica status e prazo **na própria
  escrita** (nunca confia numa seleção anterior); **não expõe payload em log**; **não
  altera o estado oficial da conversa**.

## 14. CAS

Formalizado sobre `estado_conversa`:

- **predicado** por `clinica_id` + `conversa_id` + **versão esperada**;
- **nova versão = versão esperada + 1**, **atribuída fisicamente pelo banco** — nunca
  calculada pelo cliente e enviada como valor, o que reintroduziria a corrida que o CAS
  existe para eliminar;
- **sucesso somente com exatamente uma linha atualizada**;
- **zero linhas atualizadas é sempre `conflito_versao`**;
- **sem reaplicação automática**: após um conflito, não reler e reaplicar a decisão
  produzida sobre o estado antigo; carregar o avanço oficial; usar replay se o
  resultado já existir; caso contrário, **falhar fechado**.

| Linhas atualizadas | Significado |
|---|---|
| 1 | avanço confirmado |
| 0 | `conflito_versao` |

**Criação inicial** da linha de estado: ocorre com **unicidade** por
`(clinica_id, telefone_normalizado)` e **conflito controlado** — duas criações
concorrentes não produzem erro operacional: a perdedora reconhece a linha existente e
prossegue com a versão corrente, nunca com uma segunda linha. `versao` nasce em zero.

**Locks adicionais** somente **dentro** de uma operação multiagregado, e apenas quando
necessários para garantir **ordem estável** de aquisição (por exemplo: sempre travar a
mensagem antes do estado, nunca o inverso). Nenhum lock isolado substitui o CAS: a
confirmação do avanço vem sempre das **linhas afetadas**, nunca de uma leitura
anterior.

**`timestamp` nunca é versão** (`P4` §19). `atualizado_em` permanece auditoria.

## 15. Claim e lease

Dois leases independentes, com durações fechadas:

| Alvo | Duração | Justificativa |
|---|---|---|
| **Mensagem** | **60 segundos** | Cobre interpretação e uma passagem da máquina; curto o bastante para que uma queda não bloqueie a conversa por muito tempo |
| **Efeito** | **5 minutos** | Cobre uma escrita externa lenta sem que um worker vivo perca autoridade no meio da operação |

Regras comuns aos dois:

- **relógio do Postgres** é a única fonte de tempo — nunca o relógio do worker, do
  Core ou do adaptador;
- **token UUID** identifica a autoridade do worker;
- **expiração** explícita em coluna própria (`lease_expira_em`);
- **renovação** estende a expiração **sem** rotacionar o token;
- **reclaim** só é permitido quando o lease está **comprovadamente expirado** pelo
  relógio do banco;
- **rotação de token** acontece em toda nova aquisição (claim ou reclaim);
- **o worker antigo perde autoridade imediatamente** quando o token é rotacionado —
  qualquer operação sua com o token velho resulta em `lease_perdido`, e nunca em
  escrita aceita;
- **lease nulo nunca é tratado como expirado nem como autorização válida** — é sempre
  não elegível;
- **o lease não altera a validade semântica da continuação** (`P4` §11): validade é por
  evento e versão, nunca por relógio. Um lease expirado não invalida um checkpoint; um
  lease vigente não valida um checkpoint incompatível.

## 16. Identidades

**UUID v4** para todas as identidades desta camada:

| Identidade | Emitida por |
|---|---|
| `continuacao_id` | **Core** |
| `requisicao_id` | **Core** |
| `efeito_id` | **Core** |
| `resultado_id` | **Core** |
| identidade interna da mensagem | **operação atômica de persistência** |
| `claim_token` (mensagem e efeito) | **operação atômica de persistência** |

A separação é deliberada:

- **IDs emitidos pelo Core** identificam **coisas lógicas** que a máquina pura decidiu
  criar — a identidade precisa existir **antes** de qualquer escrita, para que a
  retomada possa reapresentá-la sem inventar nada (`P4` §8);
- **IDs emitidos pela operação atômica** identificam **fatos físicos** que só existem
  quando a linha existe — gerá-los no Core não traria garantia alguma e criaria
  identidade para uma linha que talvez nunca seja inserida.

Propriedades fechadas de todas: **opacas** (nenhum significado derivado do valor);
**geradas uma única vez**; **persistidas**; **vinculadas a `clinica_id`**; **estáveis**;
**únicas no escopo da clínica**; **nunca fornecidas pela IA**; **nunca inventadas pelo
adaptador**.

**Ordenação somente por versões e timestamps.** UUID v4 não é ordenável e **nunca** é
usado para ordenar, paginar ou inferir precedência. Onde ordem importa, a fonte é
`versao` (`bigint`) ou um `timestamptz` explícito — nunca a identidade.

## 17. JSONB e normalização

### Colunas normalizadas (fora do JSONB, obrigatoriamente)

Tudo que participa de **identidade**, **unicidade**, **FK**, **CAS**, **claim**,
**lease**, **status**, **retenção**, **limpeza**, **replay** ou **auditoria**.

O motivo é único e não negociável: o banco só pode garantir uma regra que ele consegue
enxergar. Uma chave, um predicado de CAS ou um prazo de retenção escondido dentro de um
documento JSON não é constraint — é convenção, e convenção não impede corrida.

### JSONB versionado (conteúdo estruturado)

`estado oficial`; `interpretação permitida`; `envelope` da continuação; `candidato`;
`parâmetros` de requisição e de efeito; `respostas`; `confirmação`; `resultado lógico`;
`comando`; `fatos autorizados`.

Regras fechadas:

- **validação runtime antes da escrita** — nenhum JSONB é gravado sem validação
  estrutural do contrato correspondente;
- **validação depois da leitura** — nenhum JSONB lido é consumido sem revalidação; o
  banco não garante forma, e uma linha gravada por uma versão anterior do código pode
  não corresponder mais ao contrato atual;
- **versão de contrato obrigatória** em coluna normalizada própria
  (`versao_contrato_*`), nunca apenas dentro do documento;
- **versão desconhecida nunca é aceita silenciosamente** — produz
  `registro_corrompido` (seção 23), jamais interpretação por aproximação ou uso
  parcial;
- **nenhum predicado crítico em caminho interno de JSONB** — nenhuma constraint, FK,
  índice único, CAS ou verificação de retenção depende de expressão que navegue dentro
  do documento.

## 18. Retenção e limpeza

Três políticas, **independentes**, sobre objetos diferentes:

| Política | Prazo | Conta a partir de | Remove | Preserva |
|---|---|---|---|---|
| **Bruto da mensagem** | **7 dias** | `recebido_em` | `conteudo_bruto` | linha, chave de deduplicação, metadados |
| **Artefatos técnicos encerrados** | **30 dias** | `encerrado_em` | payloads de continuações, requisições e efeitos | linha, identidades, fingerprints, vínculos, status, versões, timestamps |
| **Resultados** (`P4I-R1`) | **30 dias** | `criado_em` | `resultado_logico`, `comando`, `fatos_autorizados` | linha, identidades, fingerprint, vínculos, versões, tipo terminal, timestamps |

Consequências já fechadas: o replay completo é limitado à janela de 30 dias do
resultado; a **deduplicação é permanente** e não expira em nenhuma das três políticas;
nenhum prazo altera outro, e o prazo mais curto nunca é estendido pelo mais longo.

**A operação de limpeza deve:**

- ser **idempotente**;
- operar **por lote**;
- usar o **relógio do banco**;
- **verificar status e prazo na própria escrita** — nunca confiar numa seleção
  anterior, que pode ter ficado obsoleta entre a leitura e a escrita;
- **nunca limpar continuação ativa** (`P4` §11);
- **nunca apagar linhas**;
- **registrar `payload_removido_em`** (ou `bruto_removido_em`);
- **não expor payload em logs** — nem no de sucesso, nem no de erro.

**Não definido aqui** (seção 27): cron, frequência, plataforma, janela de execução,
tamanho ótimo de lote.

## 19. RLS e acesso

Regras fechadas:

- **nenhuma das seis tabelas é acessível diretamente ao cliente**;
- **`anon` e `authenticated` sem acesso operacional** — privilégios revogados
  explicitamente, não apenas ausentes; RLS ativa **sem policies** permissivas;
- **o servidor sempre exige `clinica_id`** em toda leitura e toda escrita;
- **service role não substitui filtro** — o caminho de servidor ignora RLS por
  construção, então o predicado de clínica é obrigatório **no código**, e a RLS é
  defesa **adicional**, nunca suficiente (`P4` §12);
- **identificador de outra clínica retorna inexistência**, nunca acesso negado;
- **FKs compostas** incluindo `clinica_id` em toda referência (seção 6);
- **testes com ao menos duas clínicas** em todo cenário de isolamento (seção 24);
- **nenhuma chave privilegiada no Core ou na IA** — o Core não recebe credencial de
  banco, e a IA não acessa banco, calendário ou ferramentas
  (`../docs/02-arquitetura.md`).

**Logs** (`P4` §12): permitidos IDs técnicos, versões, estados, categorias, timestamps
e códigos sem PII. Proibidos texto bruto, nome, CPF, telefone, nascimento, e-mail,
payload integral, credenciais e tokens completos. O `payload_fingerprint` é valor
técnico e pode aparecer; o payload, nunca.

## 20. Índices essenciais

Somente os que sustentam uma regra desta especificação:

| # | Alvo | Serve a |
|---|---|---|
| 1 | Deduplicação da mensagem (chave da seção 6) | unicidade e recuperação por identidade de transporte |
| 2 | CAS em `estado_conversa` (`clinica_id`, `id`, `versao`) | avanço oficial |
| 3 | Lease expirado da mensagem (`status`, `lease_expira_em`) | reclaim |
| 4 | Lease expirado do efeito (`status`, `lease_expira_em`) | reclaim de efeito |
| 5 | Continuação retomável (`clinica_id`, `mensagem_id`, `versao_estado_origem`, condicional ao status) | unicidade da retomável e carregamento do checkpoint |
| 6 | Resultado por mensagem (`clinica_id`, `mensagem_id`) | replay e unicidade |
| 7 | Efeito por identidade (`clinica_id`, `id`) | idempotência da confirmação |
| 8 | Encerramento para limpeza (`status`, `encerrado_em`) | varredura dos 30 dias |
| 9 | Expiração de payload bruto (`recebido_em`, `bruto_removido_em`) | varredura dos 7 dias |
| 10 | Suporte às FKs compostas | integridade referencial multiclínica |

**Índices JSONB permanecem adiados** (seção 27) — nenhum índice de expressão sobre
caminho interno de documento é criado, coerente com a proibição de predicado crítico em
JSONB (seção 17).

## 21. Migration

Registrado como **plano**, não como artefato: **nenhuma migration foi criada nesta
rodada**.

O plano é **predominantemente aditivo**, com **uma exceção controlada**: a troca da
chave de deduplicação de `mensagens_recebidas` (D6, seção 3.2.1) exige substituir uma
constraint existente, não apenas adicionar. Quando for autorizada, a migration deve:

- ser **SQL versionado no repositório como artefato único**, no padrão Supabase já
  usado por este projeto;
- conter **alterações aditivas na quase totalidade** — nenhuma coluna existente
  renomeada, nenhuma tabela removida, nenhum tipo de coluna povoada alterado; **a
  única exceção prevista é a substituição controlada da constraint de deduplicação**
  (`P4I.6`), que segue seus próprios sete passos e seu próprio rollback (seção
  3.2.3), nunca tratada como aditiva simples;
- ser precedida de **preflight read-only completo do ambiente-alvo** (seção 3.2.2,
  `P4I.2`) — nunca presumindo se
  `../src/supabase/migrations/20260730_iris_nova_interpretacao_v1.sql` foi aplicada
  desde sua rodada de criação, nem que o banco vivo corresponde ao schema versionado;
- incluir o **preflight de compatibilidade das colunas novas** de `mensagens_recebidas`
  (seção 5.2.1, `P4I.10`): quantidade de linhas, origem, cobertura real de `canal`,
  `conversa_id`, `payload_fingerprint` e vínculos — antes de qualquer backfill;
- executar o **backfill determinístico** dessas colunas, sob as regras da seção 5.2.1
  — nunca inventando payload, fingerprint ou vínculo ausente;
- criar a coluna `versao_contrato_registro` e o **`CHECK` condicional** que ela
  disciplina (seção 5.2.2) — nunca um `NOT NULL` incondicional em `canal`,
  `conversa_id` ou `payload_fingerprint`; a coorte histórica permanece nula ou legada
  indefinidamente, sem bloquear a existência da constraint condicional;
- **parar diante de linha classificada como incompatível** pelo preflight, bloqueando
  a promoção até decisão técnica documentada — nunca promover silenciosamente sobre
  dado que não se encaixa;
- criar as **quatro tabelas novas**;
- criar **constraints**, **FKs compostas** (incluindo `efeitos_composicao.requisicao_id`,
  `P4I.16`) e os **índices essenciais** da seção 20;
- definir as **operações** da seção 13, garantindo que
  `registrar_ou_recuperar_mensagem` sempre atribua `versao_contrato_registro = 1` a
  mensagens novas do fluxo `P4I`;
- aplicar **revogações** antes de **grants** — `anon` e `authenticated` revogados
  explicitamente; execução concedida somente ao papel de servidor;
- ativar **RLS** nas tabelas novas;
- ser **testada em ambiente descartável** antes de qualquer promoção;
- ser **promovida de forma controlada**, com **dois rollbacks distintos provados**:
  o rollback aditivo geral (seção 25) e o **rollback específico da troca de
  constraint** (seção 3.2.3), **condicionado à compatibilidade dos dados no momento
  da reversão** — nunca uma promessa incondicional de recriar a constraint antiga;
  nenhuma perda de proteção de deduplicação em nenhum dos dois.

**Interrupção obrigatória:** se qualquer função ou estrutura de nome coincidente já
existir no ambiente-alvo, a aplicação **para** para auditoria manual. Substituição
silenciosa de objeto desconhecido é proibida.

## 22. Interfaces Core/adaptador

Contratos **conceituais**. **O Core não importa Supabase, Postgres, driver ou SDK** —
ele declara a interface, e o adaptador a implementa. Nenhuma assinatura definitiva é
fixada aqui (seção 27).

| Interface | Responsabilidade | Operações | Entradas | Saídas | Erros tipados |
|---|---|---|---|---|---|
| `RepositorioMensagens` | Deduplicação, claim, lease, marcador, vínculos | `registrar_ou_recuperar_mensagem`; `adquirir_claim_mensagem`; `renovar_lease_mensagem`; `registrar_interpretacao` | Chave de deduplicação; clínica; token; fingerprint | Identidade; status; token; expiração; presença de resultado | `mensagem_payload_divergente`; `claim_ocupado`; `lease_perdido`; `referencia_cruzada_clinica`; `banco_indisponivel` |
| `RepositorioEstadoConversa` | Carregar estado oficial e versão corrente | leitura por clínica e conversa | Clínica; conversa | Estado; versão; versão de contrato | `referencia_cruzada_clinica`; `registro_corrompido`; `banco_indisponivel` |
| `RepositorioContinuacoes` | Carregar e encerrar checkpoints | carregar retomável; `marcar_continuacao_superada` | Clínica; mensagem; versão de origem | Envelope; status; vínculos | `continuacao_incompativel`; `payload_removido`; `registro_corrompido`; `banco_indisponivel` |
| `ExecutorRequisicoes` | Executar leitura fechada e registrar resposta | registrar requisição; registrar resposta | Clínica; requisição; parâmetros; fingerprint | Resposta fechada | `continuacao_incompativel`; `referencia_cruzada_clinica`; `banco_indisponivel` |
| `ExecutorEfeitos` | Executar escrita autorizada | `adquirir_claim_efeito`; `renovar_lease_efeito`; confirmar efeito | Clínica; `efeito_id`; `requisicao_id` opcional (seção 11); parâmetros; token | Confirmação; expiração | `claim_ocupado`; `lease_perdido`; `efeito_payload_divergente`; `continuacao_incompativel`; `banco_indisponivel` |
| `RepositorioResultados` | Replay e leitura do resultado terminal | `recuperar_replay` | Clínica; mensagem | Resultado completo **ou** marcador de expiração | `resultado_processado_payload_expirado`; `replay_disponivel`; `referencia_cruzada_clinica`; `banco_indisponivel` |
| `UnidadePersistenciaComposicao` | As duas transações atômicas | `persistir_checkpoint`; `persistir_resultado_final` | Agregado completo do avanço | Nova versão; identidades confirmadas | `conflito_versao`; `continuacao_incompativel`; `resultado_duplicado`; `efeito_payload_divergente`; `banco_indisponivel` |
| `LimpadorArtefatos` | Retenção das três políticas | `limpar_payloads_expirados` | Lote; política | Quantidade tratada | `banco_indisponivel` |

`UnidadePersistenciaComposicao` existe como interface própria porque as duas transações
da seção 13 **atravessam vários agregados** e não podem ser compostas por chamadas
independentes aos outros repositórios — a atomicidade é a garantia, e ela não sobrevive
à decomposição.

## 23. Erros técnicos

Catálogo **fechado**. Nenhum código fora desta tabela é produzido por esta camada.

| Código | Classe | Significado | Ação do orquestrador |
|---|---|---|---|
| `mensagem_payload_divergente` | **fechado** | Mesma identidade de transporte, `payload_fingerprint` diferente | Não processa; não sobrescreve; não reconcilia |
| `claim_ocupado` | **recuperável** | Outro worker detém lease vigente | Desiste desta tentativa; não força |
| `lease_perdido` | **fechado** | Token não corresponde ou lease expirou e foi tomado | Abandona a operação; **nunca** escreve com token velho |
| `conflito_versao` | **fechado** | CAS atualizou zero linhas | Carrega avanço oficial; replay se houver; senão falha fechada |
| `continuacao_incompativel` | **fechado** | Continuação superada, encerrada ou de versão incompatível | Não retoma; não avança |
| `efeito_payload_divergente` | **fechado** | Mesmo `efeito_id`, parâmetros de fingerprint diferente | Não executa; não substitui |
| `resultado_duplicado` | **fechado** | Segundo `resultado_id` para a mesma mensagem | Não insere; não sobrescreve |
| `referencia_cruzada_clinica` | **fechado** | Identificador de outra clínica | Trata como **inexistente**; nunca revela existência |
| `payload_removido` | **fechado** | Artefato técnico sem payload (limpo aos 30 d) | Não retoma; registro serve só a auditoria/idempotência |
| `resultado_processado_payload_expirado` | **replay** (técnico) | Mensagem processada; payload do resultado expirado (`P4I-R1`) | Reconhece como processada; **não** reinterpreta, **não** recompõe, **não** responde como inédita |
| `registro_corrompido` | **fechado** | JSONB inválido ou versão de contrato desconhecida | Falha fechada; nunca interpreta por aproximação |
| `banco_indisponivel` | **transitório** | Indisponibilidade de infraestrutura | Pode retentar a operação inteira; nunca escreve parcialmente |
| `replay_disponivel` | **replay** | Resultado existe e o payload está íntegro | Devolve o resultado sem chamar a máquina |

**Classificação, com o critério de cada classe:**

- **recuperável** — a mesma operação pode ser tentada de novo mais tarde, sem mudar
  nada: `claim_ocupado`;
- **transitório** — falha de infraestrutura, retentável integralmente:
  `banco_indisponivel`;
- **replay** — não é erro; é o caminho de recuperação: `replay_disponivel`,
  `resultado_processado_payload_expirado`;
- **fechado** — encerra a tentativa sem reprocessar e sem escrever: todos os demais;
- **falha de domínio** — **nenhum código desta tabela é falha de domínio.** Falhas de
  domínio pertencem à composição (`integracao-temporal-composicao-v1.md` §20) e nunca
  são produzidas por esta camada física. Em particular, `conflito_versao` é **falha da
  própria escrita** e nunca integra um resultado candidato (`P4` §7).

## 24. Testes executáveis futuros

**Nenhum teste é criado nesta rodada.** Esta seção converte os cenários de `P4` §17 em
matriz de implementação e acrescenta os cenários que só existem no plano físico.
**Nenhum destes soma à suíte oficial atual (730 testes, 725 aprovados, 5 pulados, 0
falhas)** — são contagens em domínios diferentes.

Camadas usadas na matriz: **unitário** (lógica de decisão, sem banco); **integração**
(orquestrador e Core reais, adaptadores sintéticos); **banco** (Postgres local real:
transação, CAS, unicidade); **segurança** (isolamento, PII, autoridade); **recuperação**
(queda, retomada, replay); **migração** (aplicação e rollback em ambiente descartável).

### 24.1 Matriz de `P4T-01` a `P4T-23`

Identificadores preservados de `P4` §17 — **nenhum é renumerado**.

| ID | Camada | Fixture | Ação | Concorrência / falha simulada | Resultado esperado | Invariante provada |
|---|---|---|---|---|---|---|
| P4T-01 | banco | Clínica, conversa, mesma identidade de transporte | Duas entregas simultâneas | Duas transações concorrentes | Exatamente um claim vence; nenhum registro duplicado; nenhum segundo resultado | Deduplicação por chave da seção 6 |
| P4T-02 | recuperação | Mensagem já concluída com resultado íntegro | Entrega repetida | — | Replay do resultado; máquina não chamada; nenhuma continuação criada | Replay antes da máquina |
| P4T-03 | segurança | Mensagem existente | Mesma identidade, `payload_fingerprint` diferente | — | `mensagem_payload_divergente`; nenhuma sobrescrita; nenhum reprocessamento | Payload divergente falha fechado |
| P4T-04 | banco | Estado na versão N | `persistir_checkpoint` com versão esperada N−1 | Avanço concorrente já aplicado | Zero linhas; `conflito_versao`; estado inalterado; nenhuma continuação nova | CAS por versão inteira |
| P4T-05 | banco | Continuação ativa e efeito pendente | `persistir_checkpoint` | Falha injetada em cada passo | Tudo commitado junto ou nada; nenhuma atualização parcial observável | Atomicidade da intermediária |
| P4T-06 | banco | Candidato preparado | `persistir_resultado_final` | Falha injetada em cada passo | Estado final, versão, resultado, efeito, mensagem e continuação juntos | Atomicidade da final |
| P4T-07 | recuperação | Checkpoint commitado | Queda logo após o commit | Processo morto após commit | Retomada reconhece o efeito confirmado; não repete a escrita | Reconhecimento pós-commit |
| P4T-08 | recuperação | Resultado commitado | Queda logo após a final | Processo morto após commit | Retomada encontra resultado; devolve replay; nenhum resolvedor executado | Replay sem recomposição |
| P4T-09 | recuperação | Candidato preparado; efeito pendente; resultado ausente | Retomada | Queda antes do commit final | Reapresenta o **mesmo** `efeito_id`/`resultado_id`; resultado existente → replay; ausente e compatível → reapresentação idempotente; CAS perdido ou incompatível → falha fechada | **Ausência isolada de resultado nunca produz falha fechada** |
| P4T-10 | unitário | Resultado existente | `recuperar_replay` | — | Recuperado por identidade; função pura não invocada; IA não chamada | Replay é leitura pura |
| P4T-11 | banco | Duas execuções válidas divergentes | Ambas tentam avançar | Concorrência real | Primeiro CAS vence; nenhuma fusão; perdedor não reaplica | Unicidade do avanço oficial |
| P4T-12 | recuperação | Execução perdedora | Recuperar avanço oficial | CAS já perdido | Carrega oficial; replay se houver; senão falha fechada; nunca reprocessa snapshot antigo | Proibição de reprocessar estado antigo |
| P4T-13 | segurança | Duas clínicas, mesmo `message_id` | Registrar as duas | — | Duas mensagens distintas; nenhum cruzamento; nenhuma deduplicação entre clínicas | `clinica_id` na chave (D6) |
| P4T-14 | segurança | Identificador de outra clínica | Apresentar ao Core | — | Tratado como inexistente; nunca "acesso negado"; nenhuma existência revelada | `referencia_cruzada_clinica` |
| P4T-15 | integração | Continuação superada | Reapresentar | — | Rejeitada por status/versão; nenhuma retomada; nenhum avanço | `continuacao_incompativel` |
| P4T-16 | integração | Continuação pendente de outra mensagem | Nova mensagem chega | — | A pendente não é retomada; validade perdida por versão dependente alterada | Validade semântica, não temporal |
| P4T-17 | recuperação | Interpretação registrada, sem checkpoint | Retomada | Queda entre as duas | Resposta fixa canônica; composição não retomada; eventos e conflitos não reconstruídos | Nada transitório é persistido |
| P4T-18 | integração | Resultado persistido | Falha de redação | Erro na camada posterior | Resultado lógico inalterado; nenhuma recomposição; nenhum resolvedor chamado | Limite de `P4` |
| P4T-19 | integração | Resultado persistido | Falha de transporte | Erro na camada posterior | Idem P4T-18; retry pertence ao contrato posterior | Limite de `P4` |
| P4T-20 | segurança | Avanço completo | Inspecionar logs | — | Só IDs, versões, estados, categorias, timestamps, códigos; nenhum texto bruto, nome, CPF, telefone, nascimento, e-mail, payload ou token | Disciplina de log |
| P4T-21 | banco | Artefatos encerrados há menos de 30 d | Rodar limpeza | — | Payloads presentes e íntegros | Prazo conta do encerramento |
| P4T-22 | banco | Artefatos encerrados há mais de 30 d | Rodar limpeza | — | Payloads ausentes; **linha preservada** | Limpeza nunca apaga linha |
| P4T-23 | banco | Artefatos já limpos | Inspecionar | — | Identificadores, vínculos, tipo, status, versões, timestamps, códigos e fingerprint preservados; deduplicação e replay de identidade continuam funcionando | Metadados sobrevivem |

### 24.2 Cenários adicionais — `P4IT-01` a `P4IT-30`

Prefixo `P4IT-`, **novo nesta especificação**. Nenhum identificador já usado
(`COMP-*`, `TMP-*`, `ITC-*`, `P4T-*`, `DED-*`) é reciclado. `P4IT-01` a `P4IT-26`
publicados nas rodadas anteriores **não são renumerados**; `P4IT-27` a `P4IT-30` são
novos, acrescentados nesta rodada para cobrir o enforcement físico da coorte
contratual (`versao_contrato_registro`) e a distinção entre rollback compatível e
rollback incompatível da constraint de deduplicação.

| ID | Camada | Fixture | Ação | Concorrência / falha simulada | Resultado esperado | Invariante provada |
|---|---|---|---|---|---|---|
| P4IT-01 | banco | Conversa inexistente | Duas criações simultâneas do estado inicial | Duas transações concorrentes | Exatamente uma linha; a perdedora reconhece a existente e prossegue na versão corrente; `versao` = 0; nenhum erro operacional | Criação inicial com conflito controlado (seção 14) |
| P4IT-02 | banco | Lease prestes a expirar | Renovar exatamente no limite | Relógio do banco no instante da expiração | Decisão determinística pelo relógio do Postgres; nunca duas autoridades simultâneas | Lease pelo relógio do banco |
| P4IT-03 | banco | Lease expirado e tomado por novo worker | Worker antigo tenta escrever com token velho | Reclaim entre as duas operações | `lease_perdido`; nenhuma escrita aceita | Worker antigo perde autoridade |
| P4IT-04 | segurança | Duas clínicas | Inserir filho referenciando pai de outra clínica | — | Violação de FK composta; escrita rejeitada pelo banco | FK composta obrigatória (seção 6) |
| P4IT-05 | banco | Resultado persistido | Tentar alterar `resultado_logico`, `comando`, `tipo_terminal` ou `conteudo_fingerprint` | — | Escrita rejeitada; conteúdo inalterado | Imutabilidade do resultado |
| P4IT-06 | banco | Muitas linhas elegíveis | Duas execuções concorrentes da limpeza | Concorrência real | Idempotente; nenhuma linha apagada; nenhum payload restaurado; marcadores consistentes | Limpeza idempotente e concorrente |
| P4IT-07 | integração | JSONB com `versao_contrato_*` desconhecida | Ler e consumir | — | `registro_corrompido`; nunca interpretação por aproximação nem uso parcial | Versão de contrato obrigatória (seção 17) |
| P4IT-08 | banco | Candidato preparado | Falha injetada em **cada** um dos 8 passos da transação final | Falha por passo, uma por execução | Nenhum estado intermediário observável em nenhum dos 8 pontos; estado final e resultado nunca separados | Atomicidade ponto a ponto |
| P4IT-09 | migração | Ambiente descartável com as duas tabelas existentes | Aplicar **a parcela aditiva** da migration (tabelas novas, colunas novas, índices, FKs, operações, funções, grants, políticas — nunca a troca da constraint de deduplicação) e depois o rollback aditivo | — | Parcela aditiva aplicada com sucesso; rollback remove ou desativa **somente os objetos criados por essa parcela**; dados e estruturas preexistentes preservados; nada renomeado nem destruído; **nenhuma promessa de reversibilidade integral da migration inteira** — a troca da constraint de deduplicação está **fora** deste cenário (seção 3.2.3, cenários P4IT-14, P4IT-15, P4IT-29, P4IT-30) | Rollback aditivo, delimitado à parcela aditiva (seções 21, 25) |
| P4IT-10 | banco | Resultado criado há menos de 30 d | `recuperar_replay` | — | Replay **completo**: resultado lógico, comando, fatos autorizados e versão resultante | `P4I-R1`, janela íntegra |
| P4IT-11 | banco | Resultado criado há mais de 30 d, já limpo | `recuperar_replay` | — | `resultado_processado_payload_expirado`; metadados presentes; **nenhuma** tentativa de reconstrução | `P4I-R1`, após a limpeza |
| P4IT-12 | recuperação | Mensagem com resultado limpo | Reentrega da mesma mensagem | — | Continua **deduplicada**; não reinterpreta; não chama a máquina; não consulta disponibilidade; não responde como inédita | Deduplicação permanente sem replay completo |
| P4IT-13 | segurança | Mensagem com payload de resultado expirado | Forçar caminho de recomposição | Tentativa explícita de recompor | Recusa fechada; IA não chamada; resolvedores não chamados; nenhuma resposta nova gerada | Proibição de recomposição após expiração |
| P4IT-14 | migração | Ambiente descartável com dados sob a constraint antiga | Executar os sete passos da substituição (seção 3.2.1) | Dados reais concorrendo com a migration | Constraint nova validada e ativa antes da antiga ser removida; nenhum instante sem alguma unicidade cobrindo a identidade de transporte | Substituição controlada, nunca janela sem deduplicação (`P4I.6`) |
| P4IT-15 | migração | Constraint nova já ativa, antiga já removida, **nenhuma linha depende de `canal` para se distinguir** | Executar o rollback específico da troca (seção 3.2.3, caso compatível) | — | Preflight confirma compatibilidade integral; constraint antiga recriada; constraint nova removida; nenhuma linha perdida; nenhuma duplicata introduzida | Rollback condicionado à compatibilidade dos dados (`P4I.6`) |
| P4IT-16 | banco | Linhas antigas comprovadamente do mesmo canal autenticado | Backfill de `canal` | — | Preenchido com o valor único comprovado por evidência operacional | Backfill só por evidência determinística (`P4I.10`) |
| P4IT-17 | banco | Linha antiga sem `conteudo_bruto` disponível | Backfill de `payload_fingerprint` | — | Campo permanece nulo; nenhum fingerprint fabricado | Nunca inventar fingerprint sem conteúdo original (`P4I.10`) |
| P4IT-18 | banco | Linha antiga sem evidência determinística de conversa | Backfill de `conversa_id` | — | Campo permanece nulo; nenhum vínculo fabricado | Nunca fabricar vínculo sem evidência (`P4I.10`) |
| P4IT-19 | migração | Preflight classifica a coorte elegível (deriváveis com evidência determinística) e a coorte não elegível (sem evidência suficiente) | Promover a coorte elegível a `versao_contrato_registro = 1`; deixar a coorte não elegível como histórico | Mistura de linhas elegíveis e não elegíveis no mesmo lote | 100% da coorte elegível promovida corretamente com `canal`/`conversa_id`/`payload_fingerprint` preenchidos; coorte não elegível permanece com `versao_contrato_registro` nulo/legado, nunca promovida, nunca contada como falha do backfill; nenhum dado fabricado; qualquer linha classificada incorretamente bloqueia a promoção do lote | Cobertura integral da coorte elegível sem promoção incompleta (`P4I.10`) |
| P4IT-20 | migração | Linha classificada como incompatível pelo preflight | Tentar promover a migration | Dado não derivável presente | Promoção bloqueada; decisão técnica documentada exigida antes de prosseguir | Bloqueio de promoção por linha incompatível (`P4I.10`) |
| P4IT-21 | recuperação | Mensagem com lease expirado, sem `interpretacao_persistida_em` | Reclaim | — | Novo claim adquirido; token rotacionado; interpretação chamada como se fosse a primeira tentativa | Reclaim sem interpretação (`P4I.14`, seção 13.2) |
| P4IT-22 | recuperação | Mensagem com lease expirado, com `interpretacao_persistida_em` preenchido | Reclaim | — | Novo claim adquirido; token rotacionado; **nenhuma reinterpretação**; nenhuma reconstrução de eventos; resposta fixa canônica devolvida | Reclaim com interpretação persistida (`P4I.14`, seção 8) |
| P4IT-23 | recuperação | Worker antigo com token não rotacionado | Tentar escrever depois de outro worker ter feito reclaim | Reclaim concorrente já ocorrido | `lease_perdido`; nenhuma escrita aceita com o token velho | Worker antigo perde autoridade após rotação (`P4I.14`) |
| P4IT-24 | integração | Requisição `preparacao_efeito` respondida | Core emite efeito correlacionado | — | `requisicao_id` do efeito aponta para a requisição; mesma clínica, conversa, mensagem e continuação | Correlação requisição preparatória → efeito (`P4I.16`) |
| P4IT-25 | integração | Efeito com `requisicao_id` apontando para requisição de classe `leitura` | Tentar confirmar o efeito | Classe incompatível | `efeito_payload_divergente`; efeito não confirmado | Requisição de classe incompatível falha fechado (`P4I.16`) |
| P4IT-26 | integração | Efeito já correlacionado a uma requisição | Reapresentação tentando associar `requisicao_id` diferente | — | Rejeitado; correlação original preservada; nenhuma troca aceita | `requisicao_id` imutável na reapresentação (`P4I.16`) |
| P4IT-27 | banco | Linha histórica com `canal`, `conversa_id` e `payload_fingerprint` nulos; mensagem nova pronta para registrar | (a) inspecionar a linha histórica; (b) registrar a mensagem nova via `registrar_ou_recuperar_mensagem` sem `canal`/`conversa_id`/`payload_fingerprint`; (c) registrar a mensagem nova completa | Tentativa de inserir mensagem `P4I` incompleta | (a) linha histórica permanece válida, sem violar o `CHECK`; (b) inserção rejeitada pelo `CHECK` condicional; (c) inserção aceita, `versao_contrato_registro = 1` | Enforcement por coorte contratual, nunca contornável (`P4I.10`) |
| P4IT-28 | migração | Linha histórica classificada como elegível pelo preflight | (a) promover com backfill completo das três colunas; (b) tentar promover com uma das três ausente | Promoção parcial tentada em (b) | (a) `versao_contrato_registro` passa a `1`, aceito pelo `CHECK`; (b) rejeitado pelo mesmo `CHECK`; nenhum dado inventado em nenhum dos dois casos | Promoção de coorte exige backfill integral, nunca parcial (`P4I.10`) |
| P4IT-29 | migração | Constraint nova ativa; nenhuma linha depende de `canal` para se distinguir sob a chave antiga | Executar o rollback da constraint (seção 3.2.3, caso compatível) | — | Preflight confirma compatibilidade integral dos dados; constraint antiga recriada em ambiente descartável; constraint nova removida; nenhuma linha perdida ou mesclada | Rollback compatível, decidido por preflight de dados (`P4I.6`) |
| P4IT-30 | migração | Constraint nova ativa; **existem** linhas que só se distinguem pela chave nova (`canal` diferente) | Tentar executar o rollback estrutural da constraint | Tráfego real já depende da chave nova | Rollback estrutural **bloqueado**; adaptador novo desativado por flag; constraint nova preservada; dados preservados; nenhuma linha apagada, mesclada ou com identidade alterada | Rollback incompatível é proibido, nunca forçado (`P4I.6`) |

**Cobertura de `P4I-R1` pelos cenários:** P4IT-10 (antes de 30 dias), P4IT-11 (depois),
P4IT-12 (deduplicação sem replay completo) e P4IT-13 (proibição de recomposição) —
mais P4T-21, P4T-22 e P4T-23 para o ciclo de retenção dos artefatos técnicos.

## 25. Rollback

Formalizado, sem criar artefato:

- **flag externa desativa o novo adaptador** — o desligamento não depende de alterar
  dados nem de rodar migration;
- **nenhuma volta automática à Iris antiga** — desligar o novo caminho não religa o
  legado; a Iris atual permanece intocada durante todo o processo;
- **migrations predominantemente aditivas** — nada é renomeado nem destruído no
  schema existente, **exceto** a troca da constraint de deduplicação (`P4I.6`), que
  tem **rollback próprio e distinto, condicionado à compatibilidade dos dados**
  (seção 3.2.3, cenários P4IT-15, P4IT-29, P4IT-30) — nunca tratado pelo rollback
  aditivo geral abaixo, e **não uma promessa incondicional** de recriar a constraint
  antiga;
- **preservação dos dados** — o rollback desliga o caminho, **não apaga histórico**;
- **rollback destrutivo proibido após tráfego real sem plano próprio** — depois que
  dados reais existirem, remover estrutura exige aprovação e plano específicos, nunca a
  reversão genérica da migration;
- **funções e grants reversíveis antes das estruturas** — a ordem de reversão é
  execução → privilégios → objetos, para que nenhum consumidor fique apontando para
  função removida;
- **prova em ambiente descartável** antes de promover — um rollback nunca exercitado
  não é rollback (cenário P4IT-09);
- **reativação com preflight** — religar o caminho exige reverificar estado do schema,
  versões de contrato e ausência de objeto desconhecido, sem presumir o ambiente.

**Não converter dados para o modelo antigo**: conversão de volta é migração nova, com
aprovação própria.

## 26. Decisões `P4I.1`–`P4I.24`

Cada decisão registra **problema**, **decisão**, **motivo**, **consequência**, **risco**
e **teste de prova**. Nenhuma está implementada. **Reorganizadas nesta rodada** para
tratar explicitamente sete tópicos que a versão anterior deixava implícitos ou
incorretos — nenhuma decisão arquitetural já aprovada foi alterada em substância;
algumas foram consolidadas para preservar o total de 24, e três são novas.

### `P4I.1` — Seis tabelas, sem autoridade duplicada

- **Problema:** quantas estruturas físicas realizam as cinco responsabilidades de `P4`
  §3, sem criar uma segunda autoridade de estado ou de deduplicação.
- **Decisão:** exatamente **seis** tabelas (seção 4) — duas existentes evoluídas
  aditivamente e quatro novas. Nenhuma outra tabela pode duplicar estado oficial ou
  deduplicação.
- **Motivo:** as cinco responsabilidades são separáveis, mas requisições e efeitos
  exigem tabelas distintas (`P4` §3.D); estado e continuação exigem separação física
  (`P4` §4).
- **Consequência:** o modelo fecha sem tabela de histórico de versões e sem tabela de
  transporte.
- **Risco:** pressão futura para criar uma tabela "de conveniência" que replique estado.
  Mitigado por proibição explícita.
- **Teste de prova:** P4T-13, P4IT-04.

### `P4I.2` — As duas estruturas existentes não estão aprovadas

- **Problema:** `estado_conversa` e `mensagens_recebidas` já existem versionadas; podem
  ser usadas como estão?
- **Decisão:** **não.** Ambas passam pela auditoria da seção 3, que registra doze
  divergências; todas as bloqueantes devem ser fechadas por evolução
  **predominantemente aditiva** — **com uma exceção explícita**: a substituição
  controlada da constraint antiga de deduplicação (D6, `P4I.6`), que não é adição
  pura. Novas colunas, tabelas, FKs e índices são preferencialmente aditivos; nenhuma
  alteração destrutiva pode ocorrer sem preflight, compatibilidade comprovada e
  rollback seguro.
- **Motivo:** presumir correção de estrutura preexistente é exatamente o erro que a
  disciplina de auditoria do projeto proíbe; e a constraint antiga precisa ser
  substituída porque sua permanência impediria representar identidades distintas por
  canal — nenhuma adição pura resolve essa divergência.
- **Consequência:** a migration futura começa por **preflight read-only do
  ambiente-alvo** — nunca por criação, e nunca presumindo se
  `../src/supabase/migrations/20260730_iris_nova_interpretacao_v1.sql` foi aplicada
  desde a sua rodada de criação: o repositório só comprova que ela foi escrita e
  versionada; o estado atual de aplicação em banco é desconhecido até esse preflight
  (seção 3.2.2).
- **Risco:** o banco vivo divergir do schema versionado. Mitigado pela exigência de
  verificação read-only sem presunção (seção 21).
- **Teste de prova:** P4IT-09.

### `P4I.3` — Versão inteira substitui o CAS por timestamp

- **Problema:** o CAS existente usa `atualizado_em` (`timestamptz`); `P4` §19 proíbe
  timestamp como versão (divergência D1).
- **Decisão:** coluna `versao` (`bigint`) nova, aditiva, como **único** predicado de
  versão do avanço da composição. `atualizado_em` permanece auditoria.
- **Motivo:** relógio não é ordem — dois avanços no mesmo milissegundo, ou um relógio
  ajustado para trás, quebrariam a comparação.
- **Consequência:** o contrato da interpretação (Etapa 7) continua válido no seu escopo
  e **não** é reescrito; os dois coexistem sem fusão.
- **Risco:** confundir os dois predicados na implementação. Mitigado por nomeação
  explícita e pela nota da seção 5.1.
- **Teste de prova:** P4T-04, P4T-11.

### `P4I.4` — `conversa_id` é o `id` de `estado_conversa`

- **Problema:** `P4` fala em `conversa_id`; a tabela existente tem `id` e chave natural
  por telefone (divergência D2).
- **Decisão:** `conversa_id` **é** a coluna `id`. Nenhuma identidade nova é criada; a
  unicidade por `(clinica_id, telefone_normalizado)` permanece.
- **Motivo:** criar um segundo identificador de conversa produziria duas identidades
  para a mesma coisa — a raiz de toda ambiguidade de referência.
- **Consequência:** todas as FKs compostas apontam para `(clinica_id, id)`.
- **Risco:** nenhum identificado.
- **Teste de prova:** P4IT-04.

### `P4I.5` — Versionamento de `estado_conversa`: CAS e criação inicial

- **Problema:** quem calcula a versão resultante do CAS, e o que acontece quando duas
  criações da mesma conversa competem antes de qualquer versão existir.
- **Decisão:** a versão resultante é **sempre atribuída pelo banco** (esperada + 1); o
  cliente nunca a calcula e envia. Na **criação inicial**, unicidade natural mais
  tratamento de conflito: a criação perdedora reconhece a linha já existente e
  prossegue na versão corrente, em vez de falhar como erro operacional; `versao` nasce
  em zero.
- **Motivo:** versão calculada pelo cliente reintroduziria a corrida que o CAS existe
  para eliminar; tratar uma corrida legítima de criação como erro seria falso
  negativo.
- **Consequência:** sucesso do CAS é exatamente uma linha atualizada, zero é
  `conflito_versao`; nunca existem duas linhas para a mesma conversa.
- **Risco:** mascarar erro real de FK sob o tratamento de conflito de criação.
  Mitigado por tratar **apenas** o conflito de unicidade esperado, nada além.
- **Teste de prova:** P4T-04, P4IT-01.

### `P4I.6` — Nova chave de deduplicação substitui a constraint antiga

- **Problema:** a constraint vigente de `mensagens_recebidas` é
  `unique (provider, instancia_whatsapp, message_id)` — sem `clinica_id` e sem
  `canal` — e diverge da identidade de deduplicação exigida por `P4` §6 (divergência
  D6, auditoria completa em 3.2.1).
- **Decisão:** a constraint nova, `(clinica_id, canal, provider, instancia_whatsapp,
  message_id)`, **substitui** a antiga — não apenas a complementa. A antiga é
  **parcialmente confirmada como suficiente hoje** para a mitigação multiclínica —
  mas essa mitigação vem de `clinicas_provider_instancia_key` (unicidade global da
  instância) e da FK composta `mensagens_recebidas_clinica_provider_instancia_fk`,
  **nunca da constraint de deduplicação da mensagem em si**, que não tem essa
  responsabilidade (auditoria completa em 3.2.1). A antiga é, além disso, **mais
  restritiva** que a identidade nova e não representa `canal`. A troca segue os sete
  passos da seção 3.2.1: auditar dados, criar e preencher `canal`, validar
  duplicidade sob a chave nova, criar a constraint nova, substituir a antiga
  controladamente, provar ausência de janela sem deduplicação, e ter rollback
  próprio da troca (seção 3.2.3) — **condicionado à compatibilidade dos dados no
  momento da reversão**, nunca uma promessa incondicional de recriar a constraint
  antiga.
- **Motivo:** `P4` §6 exige `clinica_id` e canal na identidade; nenhuma composição das
  constraints atuais supre `canal`, e a chave de deduplicação precisa ser a
  identidade real, não um efeito colateral de outras duas constraints em outra
  tabela.
- **Consequência:** duas clínicas podem compartilhar `message_id` do transporte sem
  colisão; o modelo suporta canal multicanal sem alterar a chave depois. Substituir
  ou remover a constraint antiga **não afeta** a unicidade global de `clinicas` —
  são constraints independentes, em tabelas diferentes.
- **Risco:** janela sem proteção de deduplicação durante a troca. Mitigado pela ordem
  fixa dos sete passos — a constraint nova só é ativada, e a antiga só é removida,
  depois de validação completa; nunca as duas etapas em uma única operação sem prova
  intermediária. Risco simétrico no rollback: recriar a constraint antiga quando
  dados já dependem de `canal` produziria violação ou exigiria mesclar linhas —
  mitigado pela condição de compatibilidade da seção 3.2.3, nunca contornada.
- **Teste de prova:** P4T-01, P4T-13, P4IT-14, P4IT-15, P4IT-29, P4IT-30.

### `P4I.7` — UUID v4 e distribuição da geração de identidades

- **Problema:** quem gera cada identidade desta camada, e por que a geração não é
  uniforme entre todas elas.
- **Decisão:** **UUID v4** para todas (seção 16). `continuacao_id`, `requisicao_id`,
  `efeito_id` e `resultado_id` são **emitidos pelo Core** — existem antes de qualquer
  escrita, para que a retomada possa reapresentá-los sem inventar nada. A identidade
  interna da mensagem e `claim_token` (de mensagem e de efeito) são **emitidos pela
  operação atômica de persistência** — só existem quando a linha física existe.
- **Motivo:** gerar no Core uma identidade que só faz sentido quando a linha existe
  não traria garantia alguma, e criaria identidade para uma linha que talvez nunca
  seja inserida; gerar fora do Core uma identidade lógica quebraria a estabilidade
  exigida pela retomada (`P4` §8).
- **Consequência:** ordenação nunca usa identidade — UUID v4 não é ordenável; onde
  ordem importa, a fonte é `versao` (`bigint`) ou um `timestamptz` explícito.
- **Risco:** confundir as duas origens de emissão na implementação, fazendo o
  adaptador gerar uma identidade lógica. Proibido explicitamente (`P4` §8: "nunca
  fornecidas pela IA... nunca inventadas pelo adaptador").
- **Teste de prova:** P4T-10 (replay não depende de ordenação por identidade).

### `P4I.8` — Fingerprint do payload da mensagem

- **Problema:** sem fingerprint, payload divergente sob a mesma identidade é
  indetectável (divergência D8).
- **Decisão:** `payload_fingerprint` (`bytea`) obrigatório para mensagens novas,
  imutável quando presente.
- **Motivo:** `P4` §6 exige detectar envelope divergente sem sobrescrever nem
  reconciliar.
- **Consequência:** `mensagem_payload_divergente` torna-se verificável.
- **Risco:** guardar o payload em vez do resumo. Proibido explicitamente na seção 5.2.
- **Teste de prova:** P4T-03.

### `P4I.9` — Texto bruto separado, com prazo de 7 dias

- **Problema:** o bruto precisa existir para interpretar e desaparecer em 7 dias
  (divergência D9).
- **Decisão:** `conteudo_bruto` em coluna própria, com `bruto_removido_em`; linha
  sempre preservada.
- **Motivo:** `persistencia-v1.md` §19; PII direta exige o prazo mais curto.
- **Consequência:** a deduplicação sobrevive à expiração do conteúdo.
- **Risco:** artefato de 30 dias reter o bruto por tabela. Proibido: nenhum artefato
  técnico copia o texto bruto.
- **Teste de prova:** P4T-23.

### `P4I.10` — Compatibilidade, backfill e coorte contratual das linhas existentes

- **Problema:** `canal`, `conversa_id`, `payload_fingerprint` e os vínculos de
  continuação/resultado são colunas novas em `mensagens_recebidas`; linhas já
  existentes podem não ter evidência para preenchê-las — e é preciso um mecanismo
  **físico**, não só uma política, para que isso nunca vire uma porta aberta para
  mensagens novas escaparem da obrigatoriedade.
- **Decisão:** nulabilidade **transitória e explícita** para essas colunas (seção
  5.2.1), somada a uma **coluna de coorte contratual**, `versao_contrato_registro
  smallint` (seção 5.2.2): linhas históricas ficam com valor nulo ou legado
  explícito (só depois de preflight); mensagens novas do fluxo `P4I` nascem sempre
  com `versao_contrato_registro = 1`, atribuído pela própria operação de inserção
  (seção 13.1), nunca pelo chamador. Um **`CHECK` condicional** ao valor da coorte —
  não um `NOT NULL` incondicional de coluna — exige `canal`, `conversa_id` e
  `payload_fingerprint` preenchidos **somente** quando `versao_contrato_registro = 1`.
  Preflight obrigatório mede cobertura real antes do backfill. Backfill só ocorre por
  **evidência determinística** — nunca por inferência, nunca fabricando payload,
  fingerprint ou vínculo ausente. Promover uma linha histórica para a coorte `P4I`
  exige backfill **integral** das três colunas, nunca parcial. Linha incompatível
  bloqueia promoção até decisão técnica documentada.
- **Motivo:** fabricar dado técnico sobre uma linha antiga seria o mesmo erro que `P4`
  proíbe para o domínio — reinterpretar sem evidência real; e uma política sem
  mecanismo físico dependeria inteiramente do adaptador nunca errar, o que `P4I.23`
  já rejeita como garantia suficiente para qualquer regra crítica.
- **Consequência:** o schema aceita um período de coexistência indefinido entre a
  coorte histórica (nula ou legada, nunca bloqueada pelo `CHECK` condicional) e a
  coorte `P4I` (sempre completa desde o nascimento), sem tratar a primeira como
  corrupção nem permitir que a segunda a use como atalho.
- **Risco:** `CHECK` mal formulado rejeitando linha histórica legítima, ou
  permitindo que uma mensagem nova nasça fora da coorte `P4I`. Mitigado por a
  operação de inserção (seção 13.1) ser o único caminho de escrita de mensagem nova,
  e por nunca existir `NOT NULL` incondicional que force decisão prematura sobre o
  histórico.
- **Teste de prova:** P4IT-16, P4IT-17, P4IT-18, P4IT-19, P4IT-20, P4IT-27, P4IT-28.

### `P4I.11` — Continuação com envelope imutável

- **Problema:** o que pode mudar numa continuação já emitida.
- **Decisão:** **somente** `status`, referências de sucessão/pendência e marcadores de
  encerramento e limpeza. O `envelope` nunca é editado.
- **Motivo:** `P4` §3.C; um envelope editável deixaria de ser checkpoint.
- **Consequência:** cada avanço cria uma continuação nova, nunca altera a anterior.
- **Risco:** tentação de "corrigir" um envelope na retomada. Proibido.
- **Teste de prova:** P4T-15, P4T-16.

### `P4I.12` — Uma continuação retomável por mensagem e versão

- **Problema:** evitar dois checkpoints disputando a mesma versão.
- **Decisão:** unicidade **condicional ao status** por
  `(clinica_id, mensagem_id, versao_estado_origem)` entre as não encerradas.
- **Motivo:** encerradas são histórico e podem coexistir; retomáveis, não.
- **Consequência:** a superação e a inserção da sucessora acontecem na mesma transação.
- **Risco:** unicidade incondicional bloquearia o histórico legítimo. Evitado pela
  condição de status.
- **Teste de prova:** P4T-05, P4T-15.

### `P4I.13` — Requisições e efeitos em tabelas separadas

- **Problema:** leitura e escrita têm ciclos de vida e garantias diferentes.
- **Decisão:** duas tabelas (`requisicoes_composicao`, `efeitos_composicao`).
- **Motivo:** `P4` §3.D — fundi-las tornaria impossível distinguir "dado obtido" de
  "efeito confirmado" na retomada.
- **Consequência:** só efeitos têm claim, lease e confirmação.
- **Risco:** duplicação de código de acesso. Aceito: a clareza da retomada vale mais.
- **Teste de prova:** P4T-07, P4T-09.

### `P4I.14` — Leases independentes pelo relógio do Postgres: mensagem 60 s, efeito 5 min

- **Problema:** interpretação e uma escrita externa lenta têm durações muito
  diferentes; amarrar as duas ao mesmo lease faria um worker vivo perder autoridade
  no meio de uma operação legítima, ou deixaria uma mensagem travada tempo demais
  depois de uma queda.
- **Decisão:** dois leases **independentes**, ambos pelo **relógio do Postgres** —
  nunca o relógio do worker, do Core ou do adaptador: **60 segundos** para a
  mensagem (cobre interpretação e uma passagem da máquina); **5 minutos** para o
  efeito (cobre uma escrita externa lenta). Token UUID em cada um; renovação estende
  sem rotacionar; reclaim só após expiração comprovada pelo relógio do banco;
  rotação de token na nova aquisição retira a autoridade do worker antigo
  imediatamente; o lease **nunca** altera a validade semântica da continuação.
- **Motivo:** os dois eventos que os leases protegem não têm a mesma duração típica,
  e um relógio de aplicação (worker, Core, adaptador) introduziria divergência entre
  processos — só o relógio do banco é uma fonte de tempo única para todos.
- **Consequência:** um efeito pode sobreviver a várias renovações do lease da
  mensagem que o originou, sem conflito.
- **Risco:** efeito órfão com lease longo, ou mensagem travada por lease curto demais
  para a interpretação real. Mitigado pelos índices de lease expirado e pelo reclaim
  em ambos.
- **Teste de prova:** P4IT-02, P4IT-03, P4IT-21, P4IT-22, P4IT-23.

### `P4I.15` — Identidade do efeito é estável na retomada

- **Problema:** a retomada pode gerar um `efeito_id` novo e duplicar a escrita.
- **Decisão:** a retomada reapresenta **exatamente** o mesmo `efeito_id`, o mesmo
  `resultado_id`, o mesmo candidato e a mesma versão esperada.
- **Motivo:** `P4` §10 e `P4T-09`.
- **Consequência:** a ausência isolada de resultado **nunca** produz falha fechada por
  si só.
- **Risco:** interpretar "sem resultado" como falha. Explicitamente proibido.
- **Teste de prova:** P4T-09.

### `P4I.16` — Correlação opcional e condicionada `requisicao_id` → efeito

- **Problema:** um efeito originado de uma requisição de leitura preparatória
  (`preparacao_efeito`) precisa preservar rastreabilidade verificável até essa
  origem, sem fundir as duas tabelas nem tornar o vínculo obrigatório para todo
  efeito.
- **Decisão:** `efeitos_composicao.requisicao_id` (`uuid`, nulável **condicional**):
  **obrigatório** quando o efeito tiver origem numa requisição de classe
  `preparacao_efeito`; **nulo** somente quando o Core emitir o efeito diretamente,
  sem requisição preparatória prevista pelo contrato. FK composta
  `(clinica_id, requisicao_id)`. A requisição vinculada deve pertencer à mesma
  clínica, conversa, mensagem e continuação do efeito, e possuir classe compatível.
  **Uma reapresentação nunca pode trocar ou remover** essa correlação.
- **Motivo:** sem o vínculo direto, a correlação entre "dado obtido" e "efeito que o
  usou" dependeria de inferência por proximidade temporal ou por continuação — frágil
  e não verificável estruturalmente.
- **Consequência:** `requisicoes_composicao` e `efeitos_composicao` continuam tabelas
  separadas (`P4I.13`); o vínculo é rastreável sem fundir as duas responsabilidades.
- **Risco:** o adaptador tentar "consertar" uma correlação ausente ou incompatível
  criando um efeito substituto. Proibido — o desfecho é sempre falha fechada.
- **Teste de prova:** P4IT-24, P4IT-25, P4IT-26.

### `P4I.17` — O adaptador nunca inventa efeito substituto

- **Problema:** o que fazer quando o efeito registrado não pode ser executado como está.
- **Decisão:** falha fechada. Nenhuma escrita equivalente, aproximada ou corrigida.
- **Motivo:** `P4` §8 e §13 — o adaptador ecoa, nunca decide.
- **Consequência:** divergência de parâmetros é `efeito_payload_divergente`.
- **Risco:** "conserto" silencioso no adaptador. Proibido.
- **Teste de prova:** P4T-11.

### `P4I.18` — Um resultado imutável por mensagem

- **Problema:** garantir idempotência da composição.
- **Decisão:** `(clinica_id, mensagem_id)` único; conteúdo imutável por `resultado_id`.
- **Motivo:** `P4` §3.E.
- **Consequência:** segundo `resultado_id` para a mesma mensagem é
  `resultado_duplicado`.
- **Risco:** tentativa de "atualizar" o resultado. Rejeitada pelo banco.
- **Teste de prova:** P4IT-05.

### `P4I.19` — Colunas normalizadas versus JSONB versionado

- **Problema:** o que vai em coluna e o que vai em JSONB, e como garantir que um
  documento gravado por versão antiga do código nunca é lido por aproximação.
- **Decisão:** identidade, unicidade, FK, CAS, claim, lease, status, retenção,
  limpeza, replay e auditoria vivem em **colunas normalizadas**; conteúdo
  estruturado vive em **JSONB versionado**, com `versao_contrato_*` em coluna
  própria, validado **antes da escrita** e **depois da leitura**; versão
  desconhecida → `registro_corrompido`.
- **Motivo:** o banco só garante a regra que consegue enxergar — regra escondida em
  documento JSON é convenção, não constraint, e convenção não impede corrida; e o
  banco não garante forma de JSONB entre versões do código.
- **Consequência:** nenhum predicado crítico navega dentro de JSONB; nenhuma leitura
  por aproximação, nenhum uso parcial de documento com contrato desconhecido.
- **Risco:** crescimento de colunas e custo de validação em toda leitura. Ambos
  aceitos em troca da garantia.
- **Teste de prova:** P4T-04, P4IT-06, P4IT-07.

### `P4I.20` — Três políticas de retenção independentes

- **Problema:** prazos diferentes para objetos diferentes.
- **Decisão:** 7 dias (bruto, de `recebido_em`); 30 dias (artefatos técnicos, de
  `encerrado_em`); 30 dias (resultados, de `criado_em`).
- **Motivo:** PII direta exige o prazo mais curto; artefatos técnicos, o de auditoria.
- **Consequência:** nenhum prazo altera outro; o mais curto nunca é estendido.
- **Risco:** confundir a origem da contagem. Mitigado pela tabela da seção 18.
- **Teste de prova:** P4T-21, P4T-22.

### `P4I.21` — Limpeza idempotente que nunca apaga linha

- **Problema:** como remover payload sem destruir auditoria e idempotência.
- **Decisão:** limpeza por lote, com relógio do banco, verificando status e prazo **na
  própria escrita**; nunca apaga linha; nunca limpa continuação ativa; grava marcador.
- **Motivo:** apagar a linha destruiria a deduplicação, que é permanente.
- **Consequência:** metadados sobrevivem indefinidamente.
- **Risco:** limpar checkpoint em uso. Impedido pela verificação de status na escrita.
- **Teste de prova:** P4IT-06, P4T-23.

### `P4I.22` — RLS é defesa adicional, nunca suficiente

- **Problema:** o caminho de servidor ignora RLS.
- **Decisão:** RLS ativa e `anon`/`authenticated` revogados; **e** predicado de
  `clinica_id` obrigatório no código, em toda leitura e escrita.
- **Motivo:** `P4` §12.
- **Consequência:** isolamento não depende de uma única camada.
- **Risco:** confiar só na RLS. Explicitamente proibido.
- **Teste de prova:** P4T-14, P4IT-04.

### `P4I.23` — Core não conhece o banco

- **Problema:** onde vive o acoplamento com Supabase/Postgres.
- **Decisão:** o Core declara as oito interfaces da seção 22; o adaptador implementa.
  **O Core não importa Supabase, Postgres, driver ou SDK.**
- **Motivo:** manter o Core puro e testável sem banco.
- **Consequência:** `UnidadePersistenciaComposicao` existe porque as duas transações
  atravessam agregados e não sobrevivem à decomposição.
- **Risco:** vazamento de tipo do driver na interface. Proibido.
- **Teste de prova:** P4T-10.

### `P4I.24` — Retenção do resultado lógico (`P4I-R1`)

- **Problema:** por quanto tempo o payload do resultado permanece, e o que acontece
  depois.
- **Decisão:** **payload completo do resultado por 30 dias; depois, somente metadados.
  A deduplicação permanece; o replay completo expira; o domínio não é recomposto.** O
  retorno após a expiração é `resultado_processado_payload_expirado`.
- **Motivo:** replay perpétuo exigiria reter dados estruturados e PII indefinidamente;
  apagar a linha destruiria a deduplicação. A decisão separa as duas garantias:
  **identidade é permanente, conteúdo é temporário**.
- **Consequência:** depois de 30 dias o sistema reconhece a mensagem como processada e
  **não** reinterpreta, **não** chama a máquina, **não** consulta disponibilidade,
  **não** reconstrói o resultado e **não** responde como se a mensagem fosse inédita.
- **Risco:** tratar a expiração como mensagem nova — o pior desfecho possível, porque
  produziria resposta duplicada meses depois. Fechado pelo retorno técnico dedicado e
  por dois cenários de prova.
- **Teste de prova:** P4IT-10, P4IT-11, P4IT-12, P4IT-13.

## 27. Itens ainda adiados

### Adiados **dentro** da implementação de `P4`

Poderão ser decididos quando forem necessários para implementar, sem nova rodada de
arquitetura:

- SQL concreto;
- DDL;
- assinaturas definitivas de RPC;
- biblioteca de validação;
- biblioteca de acesso ao banco;
- detalhes internos das funções;
- estratégia operacional do limpador;
- frequência de execução da limpeza;
- plataforma de execução do limpador;
- mecanismo concreto da flag de rollback;
- tuning de índices (incluindo índices JSONB).

### Adiados **fora** de `P4`

Etapas posteriores e externas, que **não** pertencem à implementação de `P4` e
permanecem no mapa geral do projeto:

- `P5` — tecnologia de redação;
- redação da mensagem natural;
- outbox de resposta;
- transporte;
- retry de entrega;
- ACK;
- exactly-once de entrega;
- deploy operacional.

## 28. Invariantes

- As seis tabelas são exatamente seis; nenhuma outra duplica estado oficial ou
  deduplicação.
- As duas estruturas existentes não estão aprovadas até que as divergências bloqueantes
  da seção 3 sejam fechadas — aditivamente, **exceto** a troca da chave de
  deduplicação (D6, `P4I.6`), que é substituição controlada, não adição pura.
- O estado atual de aplicação em banco de `../src/supabase/migrations/20260730_iris_nova_interpretacao_v1.sql` é
  **desconhecido** até um preflight read-only futuro; o repositório só comprova que
  ela foi escrita e versionada, nunca o que existe hoje em qualquer ambiente.
- A versão do estado é `bigint`, começa em zero e é incrementada **somente pelo banco**;
  timestamp nunca é versão.
- Todo CAS inclui `clinica_id`, `conversa_id` e a versão esperada; zero linhas é sempre
  `conflito_versao`.
- Persistência intermediária e final são, cada uma, uma única transação lógica; estado
  final e resultado lógico nunca são confirmados separadamente.
- Existe no máximo um resultado por clínica e mensagem, e seu conteúdo é imutável.
- A **nova** chave de deduplicação inclui `clinica_id` e canal; o texto nunca integra a
  identidade; payload divergente falha fechado. A constraint antiga é parcialmente
  confirmada como suficiente hoje **para a mitigação multiclínica** — mitigação que
  vem da unicidade global em `clinicas` e da FK composta, nunca da constraint de
  deduplicação da mensagem — mas diverge da identidade nova e será substituída,
  nunca apenas complementada. Substituir a constraint de `mensagens_recebidas` não
  afeta a unicidade global em `clinicas`: são constraints independentes.
- Toda referência entre estas tabelas é FK composta incluindo `clinica_id`; nenhuma é
  autorizada só por UUID global.
- Identificador de outra clínica é tratado como inexistente, nunca como acesso negado.
- Identidades são UUID v4 opacas; as do Core nascem no Core, as físicas nascem na
  operação atômica; ordenação nunca usa identidade.
- Nenhum predicado crítico navega dentro de JSONB; toda leitura revalida contrato e
  versão.
- O envelope da continuação é imutável; só status e referências mudam.
- A retomada reapresenta a mesma identidade de efeito e resultado; a ausência isolada de
  resultado nunca produz falha fechada por si só.
- O adaptador nunca inventa efeito substituto.
- Claim e lease usam o relógio do Postgres; o worker antigo perde autoridade na rotação
  do token; o lease nunca altera a validade semântica da continuação.
- **O marcador de interpretação nunca bloqueia o reclaim** — o lease expirado permite
  reclaim com ou sem interpretação persistida; o marcador só decide entre reinterpretar
  e a resposta fixa canônica, depois do claim já adquirido.
- **Nenhum dado técnico é fabricado para linha antiga**: campos novos não deriváveis
  por evidência determinística permanecem nulos indefinidamente; **nunca existe
  `NOT NULL` incondicional** em `canal`, `conversa_id` ou `payload_fingerprint` — a
  obrigatoriedade é sempre um `CHECK` **condicional** a `versao_contrato_registro = 1`
  (seção 5.2.2); linha incompatível bloqueia promoção; promoção parcial é rejeitada
  pelo mesmo `CHECK`.
- **Mensagem nova do fluxo `P4I` sempre nasce com `versao_contrato_registro = 1`**,
  atribuído pela operação de inserção (seção 13.1), nunca pelo chamador — nenhuma
  mensagem nova pode usar a coorte histórica para contornar a obrigatoriedade das
  três colunas.
- **A correlação `requisicao_id` → efeito é imutável quando presente**; obrigatória
  para efeito originado de requisição `preparacao_efeito`, nula apenas quando o Core
  não previu requisição preparatória; nenhuma reapresentação troca essa correlação.
- **O rollback da troca de constraint de deduplicação nunca é uma promessa
  incondicional**: só é possível quando um preflight confirma que nenhuma linha
  depende de `canal` para se distinguir sob a chave antiga; quando existe tráfego
  válido apenas pela chave nova, o rollback estrutural é **proibido**, e a reversão
  é operacional (flag), nunca uma reconstrução da constraint antiga — o rollback
  nunca apaga, mescla ou altera identidade para forçar compatibilidade.
- A limpeza é idempotente, nunca apaga linhas, nunca limpa continuação ativa e nunca
  expõe payload em log.
- Os três prazos (7 d, 30 d, 30 d) são independentes; o mais curto nunca é estendido
  pelo mais longo.
- **A deduplicação é permanente; o replay completo dura 30 dias.** Depois disso, o
  retorno é `resultado_processado_payload_expirado`, e o domínio nunca é recomposto.
- `P4I` termina no resultado lógico persistido e recuperável; redação, outbox,
  transporte, retry, ACK, exactly-once de entrega e deploy permanecem fora.
- Nenhuma implementação começa antes da aprovação desta especificação.
