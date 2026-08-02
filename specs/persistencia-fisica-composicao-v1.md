# Persistência física da composição v1 — `P4`

**Status:** especificação **documental**, aprovada como contrato lógico-físico. **Ainda
não implementada.** Este documento **não** cria tabela, coluna, índice, constraint, RPC,
migration, schema físico, código TypeScript ou teste executável, e **não** altera banco,
Supabase, painel, workflows, n8n, Evolution, Google Calendar ou Vercel.

Registros explícitos de escopo:

- **nenhuma tabela existente foi aprovada para reutilização** — nem do legado, nem da
  Iris atual, nem de qualquer schema já implantado;
- **nenhum nome físico legado é autoridade** sobre este documento; coincidência de nome
  com estrutura existente não implica reuso nem compatibilidade;
- **nomes definitivos de tabelas, colunas, RPCs e índices permanecem futuros** — este
  documento nomeia **responsabilidades**, nunca objetos físicos;
- **nenhuma migration foi criada**;
- **nenhuma estrutura de produção foi alterada**;
- qualquer reuso de estrutura existente exige auditoria e aprovação individual
  (`persistencia-v1.md` §28, `../docs/05-componentes-reutilizaveis.md`).

Esta especificação resolve a pendência registrada como **`P4` — persistência física**
em `integracao-temporal-composicao-v1.md` §5 e §22, e complementa — sem substituir —
`persistencia-v1.md`, `integracao-temporal-composicao-v1.md`,
`composicao-novo-agendamento-v1.md`, `controlador-conversacional-v1.md` e
`interpretacao-ia.md`. Onde este documento e um daqueles divergirem, o documento mais
específico do assunto prevalece; este arquivo é a camada **física** da composição, nunca
a fonte da regra de domínio.

Permanecem fixas as decisões de `../docs/02-arquitetura.md` e
`../docs/04-decisoes-canonicas.md`: a IA interpreta somente a mensagem atual e nunca
decide; o Core determinístico resolve; Supabase/Postgres é a fonte oficial.

## 1. Objetivo

Definir a representação física e as garantias concretas de idempotência que a
composição determinística exige para funcionar de forma durável, recuperável e isolada
por clínica:

- estado oficial da conversa;
- continuação (checkpoint técnico entre chamadas da máquina pura);
- mensagem recebida e deduplicação;
- requisições e efeitos;
- resultado lógico da composição;
- controle de versão e CAS;
- concorrência;
- replay;
- retomada após falha;
- retenção;
- isolamento multiclínica;
- rollback.

**Preservado sem alteração:**

- o Core permanece **puro** — sem I/O, sem relógio, sem banco (`P3`,
  `integracao-temporal-composicao-v1.md` §5);
- todo I/O é executado **exclusivamente pelo orquestrador**;
- Supabase/Postgres é a fonte oficial **futura** — nenhuma conexão é feita nesta rodada;
- a IA **não tem autoridade operacional**: não grava, não decide, não produz
  identificador oficial;
- **nenhuma memória implícita** — nada que precise sobreviver a um turno, a uma troca de
  worker ou a um reinício fica fora do banco.

## 2. Decisões de origem — `P4-R1` e `P4-R2`

Duas decisões aprovadas antes desta especificação, registradas aqui como fechadas.

### `P4-R1` — Retenção dos artefatos técnicos

Artefatos técnicos **encerrados** mantêm seu conteúdo completo por **30 dias**, contados
a partir do instante em que forem marcados como `resultado_persistido`, `superada` ou
`falha_fechada` (seção 10).

Após 30 dias, remover:

- payloads completos de continuações;
- respostas condicionais completas;
- parâmetros detalhados de requisições e efeitos.

Preservar **somente** os metadados mínimos necessários para auditoria e idempotência:

- `clinica_id`;
- identificadores técnicos;
- vínculos entre mensagem, continuação, requisição, efeito e resultado;
- tipo;
- status;
- versões;
- timestamps;
- códigos técnicos sem PII;
- fingerprint técnico, quando necessário para detectar reapresentação divergente.

**Nunca preservados indefinidamente:** texto da mensagem; nome; CPF; telefone;
nascimento; e-mail; payload bruto; estado de trabalho completo; dados condicionais
completos.

A limpeza física é especificada **conceitualmente** aqui (seção 17); seu mecanismo
operacional — job, cron, função, lote — permanece detalhe futuro de implementação
(seção 18).

**Relação com o prazo de 7 dias já aprovado.** `persistencia-v1.md` §19 fixa **7 dias**
para o **conteúdo bruto da mensagem recebida**. Os dois prazos coexistem sem conflito
porque governam objetos diferentes: 7 dias para o texto bruto do paciente (PII direta,
prazo mais curto por isso); 30 dias para os artefatos técnicos desta especificação
(continuação, requisição, efeito). **Nenhum dos dois prazos altera o outro**, e o prazo
mais curto nunca é estendido pelo mais longo: um artefato técnico de 30 dias **nunca**
pode conter o texto bruto que deveria ter expirado em 7.

### `P4-R2` — Limite de `P4`

`P4` **termina** quando existirem, persistidos e recuperáveis:

- estado final oficial;
- resultado lógico imutável;
- resultado terminal candidato;
- fatos autorizados;
- `resultado_id`;
- processamento lógico concluído e recuperável por replay.

**Ficam fora de `P4`:** tecnologia de redação; geração da mensagem natural; outbox de
resposta; entrega ao WhatsApp; retry de transporte; confirmação de envio; garantia de
envio exatamente uma vez. Todos pertencem a um **contrato posterior de redação e
transporte**, ainda não escrito (seção 15).

**`P5` (tecnologia de redação) continua adiada** e não é tocada por esta especificação.

## 3. Modelo físico conceitual mínimo

Cinco responsabilidades físicas **separadas**. Os títulos abaixo nomeiam
responsabilidades, **não** tabelas: quantas estruturas físicas cada uma ocupará, e com
que nome, é decisão futura (seção 18).

### A. Estado oficial da conversa

**Responsabilidade:** manter o estado lógico durável entre mensagens; exatamente uma
versão corrente por clínica e conversa.

**Chave lógica:** `clinica_id` + `conversa_id`.

**Campos conceituais:** versão monotônica; ação atual; fatos aceitos; resoluções;
opções; escolha; cadastro; resumo; confirmação pendente; timestamps técnicos.

Estes campos correspondem ao `EstadoNovoAgendamentoV1` já definido em
`integracao-temporal-composicao-v1.md` §8 e ao contrato de estado da conversa de
`persistencia-v1.md` §17 — incluindo a distinção obrigatória entre `fatos_temporais`
(fonte interpretada acumulada) e `criterio_temporal` (resultado derivado), que
`persistencia-v1.md` §17 registra como requisito lógico ainda sem representação física.
**Esta especificação fixa que os dois são campos distintos e nunca fundidos**; a forma
concreta (coluna, JSON, linhas normalizadas) permanece futura (seção 18).

**Atualização:** **somente por CAS** (seção 7). **Nunca reconstruído por continuações**
(seção 4).

### B. Mensagens recebidas

**Responsabilidade:** deduplicação; claim; lease; marcador de interpretação; referência
de resultado; replay.

**Chave única lógica:** `clinica_id` + canal + provider + instância autenticada do
transporte + `message_id` do transporte.

`conversa_id` é **vínculo obrigatório**, mas **não integra a chave de deduplicação** —
uma mesma entrega física pertence a uma conversa, mas a identidade que impede
reprocessamento é a do transporte, não a da conversa.

Este contrato estende, sem contradizer, `persistencia-v1.md` §18 (unicidade de
clínica + instância de transporte + identificador da mensagem). Canal e provider são
nomeados aqui explicitamente porque a identidade da instância, sozinha, não distingue
provedores diferentes num futuro multicanal.

### C. Continuações

**Responsabilidade:** checkpoint técnico entre chamadas da máquina pura — o veículo
físico de `C1` (`integracao-temporal-composicao-v1.md` §5).

**Conteúdo:** etapa; versão e origem; estado de trabalho; dados condicionais aceitos;
requisição pendente; candidato, quando existente; status do ciclo de vida.

Corresponde a `ContinuacaoComposicaoV1` (`integracao-temporal-composicao-v1.md` §11).

**Regras:**

- **envelope imutável depois de emitido** — o conteúdo de uma continuação nunca é
  editado;
- **somente status e referências de sucessão podem mudar** — marcar como `superada`,
  apontar para a continuação seguinte, ou registrar encerramento;
- **nunca é fonte oficial do estado conversacional** (seção 4).

### D. Requisições e efeitos

**Responsabilidade:** correlação e idempotência das leituras e escritas **solicitadas
pelo Core** (`C4`, `integracao-temporal-composicao-v1.md` §5).

**Registrar, para cada uma:** identidade; tipo; parâmetros fechados; continuação
emissora; versão de origem; resposta recebida; status; correlação.

Requisições de **leitura** e requisições de **efeito** são registradas separadamente:
uma leitura não altera estado oficial e uma escrita altera, e tratá-las com o mesmo
registro tornaria impossível distinguir "dado obtido" de "efeito confirmado" na
retomada.

### E. Resultados da composição

**Responsabilidade:** resultado lógico terminal **imutável**; replay sem recomposição
(`C3`, `C5`).

**Conteúdo:** `resultado_id`; mensagem; conversa; versão resultante; resultado lógico;
resultado terminal; fatos autorizados; timestamps.

**Unicidade:**

- **um resultado por mensagem e clínica**;
- **um conteúdo imutável por `resultado_id`** — nunca reescrito, nunca versionado em
  cima de si mesmo.

## 4. Estado oficial versus continuação

Decisão fechada — a fronteira mais importante desta especificação:

- **registros físicos separados** — nunca a mesma estrutura, nunca a mesma linha;
- **o estado oficial é a autoridade durável**;
- **a continuação é artefato técnico**, com prazo de vida próprio e descarte previsto;
- **o estado oficial nunca é reconstruído a partir de uma continuação**;
- **a continuação nunca substitui o estado oficial**;
- **dados presentes apenas na continuação nunca se tornam fatos oficiais** — o
  `estado_trabalho` de uma continuação é uma proposta em andamento, não estado;
- **a atualização oficial ocorre somente por efeito persistido e CAS confirmado**
  (seção 7).

Sem essa separação, um checkpoint técnico abandonado no meio de um turno passaria a
concorrer com o estado real da conversa — exatamente o problema que `C1` resolve no
plano lógico e que esta seção fecha no plano físico.

## 5. Agregado transacional

O **agregado mínimo por avanço** — o conjunto de registros que precisam concordar entre
si numa única transação lógica:

- registro da mensagem;
- estado oficial e versão;
- continuação anterior;
- requisição ou efeito pendente;
- continuação seguinte;
- resultado lógico, quando terminal.

### Persistência intermediária

Uma **única transação lógica** deve, na ordem:

1. validar clínica, conversa, mensagem, continuação e efeito;
2. verificar a versão esperada;
3. gravar fatos novos e invalidações;
4. atualizar o estado oficial;
5. incrementar a versão;
6. confirmar o efeito;
7. marcar a continuação anterior como `superada`;
8. persistir a nova continuação oficial.

**Nada disso pode ficar parcialmente atualizado.** Um estado atualizado sem efeito
confirmado, ou uma continuação nova sem a anterior superada, deixaria dois checkpoints
disputando a mesma versão.

Esta transação é a contraparte física dos passos 6 a 9 da ordem determinística
(`integracao-temporal-composicao-v1.md` §13), incluindo a exigência já fechada de que a
**invalidação de derivados aconteça antes** da primeira persistência do turno — nunca
existe estado oficial observável com fatos temporais novos e derivados dos fatos
antigos.

### Persistência final

Uma **única transação lógica** deve, na ordem:

1. validar identidades e versão;
2. atualizar o estado final;
3. incrementar a versão;
4. inserir o resultado imutável;
5. vincular o `resultado_id`;
6. confirmar o efeito final;
7. marcar a mensagem como `concluida`;
8. encerrar a continuação.

**Estado final e resultado lógico nunca podem ser confirmados separadamente.** Esta é a
contraparte física da regra "persistir antes de decidir"
(`integracao-temporal-composicao-v1.md` §11) e do mesmo espírito de `concluida` implica
que o efeito existe (`persistencia-v1.md` §23): se o resultado existisse sem o estado
final, um replay devolveria uma decisão que o estado não sustenta; se o estado final
existisse sem o resultado, a mensagem repetida recomporia o domínio do zero.

## 6. Deduplicação de mensagem

**Chave lógica:** `clinica_id` + canal + provider + instância autenticada +
`message_id` do transporte.

Regras fechadas:

- o **registro é criado antes da interpretação** — a deduplicação precede qualquer
  chamada à IA;
- **o texto não integra a identidade** — mensagens de texto idêntico são entregas
  distintas, e a mesma entrega não deixa de ser a mesma por ter texto diferente;
- um **`payload_fingerprint` técnico** pode ser registrado para detectar envelope
  divergente sob a mesma identidade;
- **mesma identidade com payload divergente falha fechado** — nunca sobrescreve, nunca
  reconcilia, nunca escolhe a versão mais recente;
- **entrega repetida com resultado já concluído produz replay** (seção 9);
- **lease ativo impede processamento paralelo**;
- **lease expirado sem interpretação registrada permite reclaim**;
- **interpretação registrada sem resultado recuperável segue a resposta fixa canônica**
  já aprovada (`interpretacao-ia.md`; `../docs/04-decisoes-canonicas.md`), aguardando
  nova mensagem;
- **nunca reconstruir interpretação, eventos candidatos ou conflitos de valor** — os
  dois últimos permanecem transitórios e nunca persistidos.

O contrato de claim, lease e marcador de interpretação permanece o de
`interpretacao-ia.md` e `persistencia-v1.md` §18/§22, **não alterado aqui**.

**Deduplicação de transporte continua distinta de idempotência operacional**
(`persistencia-v1.md` §18): a primeira impede processar a mesma entrega duas vezes; a
segunda impede que a mesma ação produza dois efeitos. Esta especificação acrescenta um
terceiro mecanismo, também distinto: a **idempotência da composição**, garantida por
`resultado_id` único por mensagem (seção 3.E). Os três são independentes e nenhum
substitui o outro.

## 7. Estados físicos e controle de versão

### Três eixos separados

**Mensagem:** `recebida`; `processando`; `concluida`; `falhou`.

**Composição / checkpoint:** `ativa`; `aguardando_dado`; `aguardando_efeito`;
`resultado_persistido`; `superada`; `falha_recuperavel`; `falha_fechada`.

**Transporte:** **não especificado fisicamente nesta `P4`.** O estado de transporte
pertence ao contrato posterior de redação e transporte (seção 15). Nenhuma estrutura,
coluna ou estado de transporte é criado aqui.

Registros adicionais:

- **`interpretacao_registrada` é marcador, não estado adicional** — convive com
  `processando` sem criar um quarto valor no eixo da mensagem;
- **`pronta_para_redacao` é derivável do resultado persistido** e **não exige estado
  próprio** nesta especificação — derivar evita um estado que poderia dessincronizar-se
  do resultado que ele deveria refletir.

Os três eixos são independentes por construção: uma mensagem `concluida` pode ter
continuações `superadas` e nenhuma informação de transporte; um checkpoint
`falha_recuperavel` não torna a mensagem `falhou`.

### Controle de versão e CAS

Decisão fechada:

- **versão inteira monotônica própria** do estado oficial;
- **timestamp não é versão** — relógio não é ordem: dois avanços no mesmo milissegundo,
  ou um relógio ajustado para trás, quebrariam a comparação;
- **o CAS inclui `clinica_id`, `conversa_id` e a versão esperada**.

Resultado do CAS:

| Linhas atualizadas | Significado |
|---|---|
| 1 | avanço confirmado |
| 0 | `conflito_versao` |

**Versão resultante:** versão esperada + 1, **atribuída fisicamente pelo banco** — nunca
calculada pelo cliente e enviada como valor, o que reintroduziria a corrida que o CAS
existe para eliminar.

**Após um conflito:**

- **não reler e reaplicar automaticamente** a decisão produzida sobre o estado antigo;
- carregar o avanço oficial;
- **usar replay** se o resultado já existir;
- caso contrário, **falhar fechado** conforme o contrato (seção 8).

Isto é a contraparte física de `conflito_versao`
(`integracao-temporal-composicao-v1.md` §20), classificado ali como **falha da própria
escrita** — não é falha de domínio, não é violação de correlação, e **nunca integra um
resultado candidato**.

**Relação com a forma lógica.** `integracao-temporal-composicao-v1.md` tipa
`versao_estado_origem` como opaca (`string`), deliberadamente sem escolher
representação. Esta especificação fixa que a **representação física é um inteiro
monotônico**; a máquina pura continua tratando o valor como opaco e comparável por
igualdade, sem aritmética própria. As duas afirmações são compatíveis: o Core não
incrementa versão, o banco incrementa.

## 8. Identidades

Quatro identidades, com responsabilidades distintas e **nunca intercambiáveis**:

| Identidade | Identifica |
|---|---|
| `continuacao_id` | um checkpoint específico emitido pela máquina |
| `requisicao_id` | uma requisição lógica (leitura ou escrita) |
| `efeito_id` | uma requisição de escrita específica |
| `resultado_id` | um resultado terminal imutável |

Propriedades fechadas — todas:

- **opacas** — nenhum significado é derivado do valor;
- **geradas uma única vez pelo Core**;
- **persistidas**;
- **vinculadas a `clinica_id`**;
- **estáveis** — a mesma coisa lógica mantém a mesma identidade;
- **únicas no escopo da clínica**;
- **nunca fornecidas pela IA**;
- **nunca inventadas pelo adaptador** — o adaptador ecoa a identidade que recebeu.

**Não decidido aqui** (seção 18): UUID; ULID; hash; biblioteca concreta; formato de
serialização.

## 9. Concorrência e replay

### Quatro casos de concorrência

**A — Mesma transição, duas execuções.** O primeiro CAS vence; o perdedor carrega o
avanço oficial; **nenhuma duplicação** é criada.

**B — Respostas diferentes, ambas válidas.** Cada execução é pura e correta
isoladamente (o limite já fechado em `integracao-temporal-composicao-v1.md` §11,
"Concorrência divergente fora do conhecimento da função"). O primeiro CAS vence.
**Nenhuma fusão** entre as duas; **nenhuma escolha pelo orquestrador**; o perdedor
**não reaplica** sua decisão antiga.

**C — Persistência posterior.** A execução tardia perde o CAS; recupera o resultado
oficial ou a continuação oficial; **não cria uma segunda versão concorrente**.

**D — Queda depois do commit.** A retomada **reconhece** o efeito ou o resultado já
confirmado; **não repete a escrita**; prossegue do checkpoint oficial ou do replay.

**Regra de fechamento:** se outra mensagem avançou o estado e **não existe resultado**
para a execução perdedora, o desfecho é **falha fechada**. **Reprocessar o snapshot
antigo é proibido** — produziria uma decisão baseada num mundo que não existe mais.

Esta seção é a contraparte física da garantia que a função pura **não** oferece: a
máquina é determinística por entrada e não arbitra entre execuções concorrentes; a
unicidade do avanço oficial é responsabilidade desta camada.

### Replay físico

O replay recupera:

- identidade da mensagem;
- `resultado_id`;
- versão resultante;
- resultado terminal;
- comando;
- fatos autorizados.

O replay:

- **ocorre antes da máquina** (`C5`) — a função pura não é chamada;
- **não reinterpreta** — a IA não é chamada de novo;
- **não chama resolvedores**;
- **não consulta disponibilidade**;
- **não recompõe domínio**;
- **não depende de redação já concluída** — o resultado lógico é recuperável
  independentemente de a resposta ter sido redigida ou enviada.

**Status de redação e envio ficam fora de `P4`** (seção 15).

## 10. Retomada após falha

Matriz de retomada. "Resultado" significa resultado lógico da composição persistido.

| Ponto da falha | Estado observável | Retomada |
|---|---|---|
| Antes da interpretação | Mensagem `recebida` ou `processando`, sem marcador de interpretação; lease pode estar expirado | Reclaim permitido; interpretar normalmente; se o conteúdo bruto já expirou (7 dias), a mensagem **não** é elegível para interpretação (`persistencia-v1.md` §19) |
| Após interpretação, sem checkpoint | Marcador de interpretação presente; nenhuma continuação | **Não retomar a composição**; responder com o texto fixo canônico; aguardar nova mensagem; **não** reconstruir eventos nem conflitos |
| Após checkpoint intermediário | Continuação `ativa`/`aguardando_dado`/`aguardando_efeito`; estado oficial já avançado | Retomar da continuação oficial, na etapa que ela registra; nunca de uma etapa escolhida pelo orquestrador |
| Durante leitura externa | Requisição registrada, sem resposta | Reemitir a mesma requisição (mesma identidade) ou falhar fechado; nunca aceitar resposta de outra identidade |
| Após candidato, antes do commit | Continuação com `resultado_candidato` já persistida; efeito final pendente; resultado ainda não confirmado | O candidato **não é resultado**. Reapresentar exatamente o mesmo `efeito_id` e `resultado_id` sobre a mesma continuação — nenhum resolvedor reexecutado, nenhum candidato reconstruído, nenhuma identidade nova. Resultado já existe: replay. Continuação ainda compatível, sem resultado: reapresentação idempotente. CAS perdido ou continuação incompatível: falha fechada — o candidato nunca é promovido fora da transação final, e nunca é reaplicado sobre estado novo |
| Após persistência final | Resultado presente; mensagem `concluida` | **Replay** (seção 9); nunca recompor |
| Durante redação | Resultado presente e íntegro | **Fora de `P4`** — o resultado lógico permanece íntegro; retomada pertence ao contrato posterior |
| Durante envio | Resultado presente e íntegro | **Fora de `P4`** — idem |
| Após envio, antes do ACK | Resultado presente e íntegro | **Fora de `P4`** — idempotência de entrega pertence ao contrato posterior |

**Fronteira registrada explicitamente:** para redação e transporte, esta especificação
afirma **apenas** que o resultado lógico permanece íntegro e recuperável. Retomada,
retry e idempotência de entrega **não são definidos aqui**.

**Regra canônica preservada, sem alteração:** interpretação persistida sem resultado
recuperável produz a **resposta fixa**, aguarda nova mensagem e **nunca** reconstrói
eventos candidatos, conflitos de valor ou a composição
(`../docs/04-decisoes-canonicas.md`; `interpretacao-ia.md`).

## 11. Validade e retenção da continuação

### Validade semântica — sem TTL por relógio

**Não usar TTL por relógio para validade.** Uma continuação não deixa de ser válida
porque envelheceu; ela deixa de ser válida quando o mundo mudou.

Uma continuação perde validade por:

- nova continuação oficial emitida;
- resultado persistido;
- avanço concorrente;
- versão incompatível;
- falha fechada;
- nova mensagem que altere oficialmente a versão da qual ela depende.

Um TTL por relógio produziria os dois erros opostos: invalidar um checkpoint ainda
correto durante uma pausa longa e legítima, e manter válido um checkpoint já obsoleto
porque o relógio ainda não venceu.

### Continuação ativa ou semanticamente válida

- **não entra no prazo de limpeza de 30 dias**;
- **não perde payload por passagem do tempo**;
- permanece **retomável** enquanto, simultaneamente:
  - for a continuação oficial ativa;
  - sua versão continuar compatível;
  - não existir resultado terminal;
  - não tiver sido superada;
  - não estiver em falha fechada.

### Continuação encerrada — retenção física de 30 dias (`P4-R1`)

O prazo de 30 dias começa **somente** quando a continuação for marcada como
`resultado_persistido`, `superada` ou `falha_fechada` — nunca antes, e nunca por
passagem de tempo sobre uma continuação ainda ativa.

**Durante os 30 dias:** o payload técnico completo pode ser preservado, conforme as
regras de segurança e retenção (seção 12).

**Depois de 30 dias:**

- **o payload completo é removido**;
- **permanecem somente os metadados mínimos** de auditoria e idempotência (seção 2);
- **a continuação não pode ser retomada**;
- ela permanece apenas como **registro encerrado** de auditoria e idempotência —
  nunca como um checkpoint reutilizável.

### Validade semântica e retenção física são conceitos diferentes

- os dois são eixos **independentes**, nunca o mesmo conceito, e nunca substituem um
  ao outro;
- **nenhuma continuação ativa perde payload por passagem de prazo** — o relógio nunca
  invalida nem esvazia uma continuação em uso;
- **nenhuma continuação encerrada volta a ser válida** — encerramento é permanente;
  nada reabre uma continuação `superada`, `resultado_persistido` ou `falha_fechada`,
  ainda que dentro dos 30 dias com payload íntegro;
- **metadado sem payload nunca autoriza retomada** — um registro que sobreviveu à
  limpeza de 30 dias existe exclusivamente para auditoria e para detectar
  reapresentação divergente (idempotência), nunca para retomar processamento.

Confundir validade com retenção faria a limpeza apagar contexto ainda em uso, ou faria
um registro puramente técnico ser tratado como se ainda pudesse ser retomado.

**Não definido aqui:** job, cron, função, lote ou qualquer mecanismo concreto de limpeza
(seção 18).

## 12. Segurança multiclínica

Registrado, em continuidade a `persistencia-v1.md` §4:

- **`clinica_id` vem exclusivamente da instância autenticada**;
- **nunca do paciente**;
- **nunca da IA**;
- **nunca de campo livre do payload**;
- **todas as estruturas desta especificação vinculam `clinica_id` estruturalmente** —
  não por convenção de consulta;
- **o CAS inclui `clinica_id`**;
- **todas as unicidades incluem a clínica** — deduplicação, `resultado_id`, identidades;
- **identificador de outra clínica é tratado como inexistente**, nunca como acesso
  negado — negar revelaria existência;
- **RLS é defesa adicional, não suficiente**: o Core executa por um caminho de servidor
  com privilégios elevados, que ignora RLS; **o acesso do servidor também exige predicado
  de clínica** em toda leitura e toda escrita.

### Logs

**Permitidos:** IDs técnicos; versões; estados; categorias; timestamps; códigos sem PII.

**Proibidos:** texto bruto; nome; CPF; telefone; nascimento; e-mail; payload integral;
credenciais; tokens completos.

Mesma disciplina já fixada em `persistencia-v1.md` §20, aplicada aos artefatos desta
especificação — incluindo o `payload_fingerprint` (seção 6), que é valor técnico e nunca
o payload em si.

## 13. Autoridade do orquestrador

**Pode:** carregar estado; fazer claim; verificar deduplicação; chamar o Core; executar
leitura fechada; executar efeito fechado; persistir checkpoint; persistir resultado;
encaminhar o resultado persistido para a etapa posterior.

**Não pode decidir:** procedimento; dentista; duração; próximo estado; próxima etapa;
invalidações; resultado terminal; fallback; substituição silenciosa.

O orquestrador é executor de I/O e guardião de transação — **nunca** autoridade de
domínio. A etapa seguinte é sempre a que a máquina registrou na continuação
(`integracao-temporal-composicao-v1.md` §11).

## 14. Rollback

Definido **conceitualmente**, sem criar migration (seção 18):

- **migration aditiva e reversível** — nada é destruído nem renomeado no schema
  existente;
- **ambiente novo e separado** — a `P4` nasce isolada, não sobre as tabelas da Iris
  atual;
- **ativação por flag operacional externa ao modelo** — o desligamento não depende de
  alterar dados;
- **Iris atual intocada** durante todo o processo;
- **possibilidade de desligar o novo fluxo** a qualquer momento, sem perda de dados;
- **preservar registros para diagnóstico** — o rollback desliga o caminho, não apaga o
  histórico;
- **não converter dados para o modelo antigo** — conversão de volta é migração nova, com
  aprovação própria;
- **testar o rollback antes de promover** — um rollback nunca exercitado não é rollback.

## 15. Limite de redação e transporte

**`P4` termina em:**

- resultado lógico persistido;
- resultado terminal persistido;
- fatos autorizados persistidos;
- replay disponível.

**Fora de `P4`:** redação; outbox; envio; retries; ACK; garantia de entrega exatamente
uma vez.

**Nenhum estado, tabela ou coluna de transporte é criado nesta especificação.** Falhas de
redação ou de transporte **nunca alteram o resultado lógico já persistido** (`P4.20`):
elas são retentadas sobre o mesmo resultado, nunca recompondo o domínio.

## 16. Decisões `P4.1`–`P4.20`

Cada decisão registra problema, decisão, motivo, consequência e risco.

### `P4.1` — Estado oficial e continuação separados

- **Problema:** um único registro para estado e checkpoint faria um checkpoint
  abandonado concorrer com o estado real.
- **Decisão:** registros físicos separados; estado oficial é autoridade, continuação é
  artefato técnico.
- **Motivo:** ciclos de vida, garantias e prazos de retenção são diferentes.
- **Consequência:** o estado nunca é reconstruído a partir de continuação; dados só da
  continuação nunca viram fato oficial.
- **Risco:** duas estruturas para manter em coerência; mitigado pelo agregado
  transacional (seção 5).

### `P4.2` — Versão inteira monotônica

- **Problema:** ordenar avanços de forma confiável.
- **Decisão:** versão inteira monotônica própria, atribuída pelo banco; timestamp não é
  versão.
- **Motivo:** relógio não é ordem — ajuste para trás ou colisão de milissegundo quebraria
  a comparação.
- **Consequência:** CAS simples e verificável; versão resultante sempre esperada + 1.
- **Risco:** exige que toda escrita passe pelo caminho que incrementa; mitigado por CAS
  obrigatório (seção 7).

### `P4.3` — Interpretação sem persistência de eventos candidatos

- **Problema:** decidir se eventos candidatos e conflitos de valor viram estado durável.
- **Decisão:** **não** persistir; permanecem transitórios, como já fixado em
  `interpretacao-ia.md`.
- **Motivo:** preserva o contrato vigente sem reabrir decisão aprovada; recompor a partir
  deles exigiria reinterpretar.
- **Consequência:** interpretação registrada sem resultado leva à resposta fixa, nunca à
  retomada da composição.
- **Risco:** perde-se diagnóstico fino de um turno interrompido; aceito, e registrado
  como avaliação futura possível em spec própria.

### `P4.4` — Deduplicação por identidade autenticada do transporte

- **Problema:** impedir que a mesma entrega física seja processada duas vezes.
- **Decisão:** chave = `clinica_id` + canal + provider + instância autenticada +
  `message_id`; texto fora da identidade.
- **Motivo:** o texto não identifica entrega; duas mensagens iguais são eventos
  distintos, e a mesma entrega não muda de identidade por reenvio.
- **Consequência:** reentrega é detectada estruturalmente; payload divergente sob a mesma
  identidade falha fechado.
- **Risco:** depende da estabilidade do `message_id` do provedor; mitigado pelo
  fingerprint técnico como detector, nunca como chave.

### `P4.5` — Mensagem, composição e transporte são eixos diferentes

- **Problema:** um único campo de status misturaria três ciclos de vida independentes.
- **Decisão:** três eixos separados; transporte não é especificado nesta `P4`.
- **Motivo:** uma mensagem concluída, um checkpoint superado e um envio pendente são
  fatos ortogonais.
- **Consequência:** `interpretacao_registrada` é marcador; `pronta_para_redacao` é
  derivado.
- **Risco:** mais campos para consultar em conjunto; aceito em troca de não ter estados
  que se contradigam.

### `P4.6` — Continuação como envelope versionado e imutável

- **Problema:** editar um checkpoint em andamento tornaria a retomada não determinística.
- **Decisão:** envelope imutável; só status e referências de sucessão mudam.
- **Motivo:** determinismo da retomada exige que o checkpoint lido seja exatamente o
  emitido.
- **Consequência:** cada avanço emite nova continuação; a anterior é marcada `superada`.
- **Risco:** volume de registros; mitigado pela retenção de 30 dias (`P4.17`, `P4.18`).

### `P4.7` — Uma continuação ativa por mensagem e versão

- **Problema:** duas continuações ativas para a mesma mensagem criariam dois caminhos
  concorrentes.
- **Decisão:** no máximo uma continuação ativa por mensagem e versão do estado.
- **Motivo:** a retomada precisa de um único ponto de verdade técnico.
- **Consequência:** emitir a seguinte exige superar a anterior na mesma transação.
- **Risco:** exige unicidade estrutural, não apenas disciplina de código.

### `P4.8` — Requisições e efeitos persistentes

- **Problema:** correlacionar respostas sem memória implícita entre chamadas.
- **Decisão:** persistir requisições e efeitos com identidade, tipo, parâmetros, origem,
  resposta e status.
- **Motivo:** `C4` exige correlação verificável; sem persistência, a verificação
  dependeria de memória de processo.
- **Consequência:** resposta sem requisição pendente, ou divergente da pendente, falha
  fechado.
- **Risco:** volume e PII em parâmetros; mitigado pela retenção de 30 dias e pela
  proibição de payload em log.

### `P4.9` — Persistência intermediária atômica com CAS

- **Problema:** atualizar estado, confirmar efeito e emitir novo checkpoint sem estado
  parcial observável.
- **Decisão:** uma única transação lógica com CAS sobre a versão esperada.
- **Motivo:** qualquer atualização parcial deixaria checkpoints ou versões inconsistentes.
- **Consequência:** ou tudo avança, ou nada avança e o resultado é `conflito_versao`.
- **Risco:** transação mais longa; aceito, pois o alvo é uma linha de estado por conversa.

### `P4.10` — Persistência final atômica

- **Problema:** estado final e resultado lógico poderiam divergir se gravados
  separadamente.
- **Decisão:** uma única transação lógica; nunca confirmados em separado.
- **Motivo:** replay devolvendo decisão que o estado não sustenta seria corrupção
  silenciosa.
- **Consequência:** `resultado_id` só existe com estado final correspondente.
- **Risco:** nenhuma janela para "salvar só o resultado"; intencional.

### `P4.11` — Um resultado imutável por mensagem

- **Problema:** duas execuções poderiam registrar resultados diferentes para a mesma
  mensagem.
- **Decisão:** unicidade por mensagem e clínica; conteúdo imutável por `resultado_id`.
- **Motivo:** replay exige exatamente um resultado recuperável.
- **Consequência:** a segunda tentativa encontra o resultado existente e faz replay.
- **Risco:** exige unicidade estrutural, não verificação prévia por consulta.

### `P4.12` — IDs opacos gerados uma vez pelo Core

- **Problema:** identidades geradas pelo adaptador ou pela IA seriam forjáveis ou
  instáveis.
- **Decisão:** opacos, gerados uma única vez pelo Core, persistidos, vinculados à
  clínica.
- **Motivo:** correlação confiável exige origem única e estável.
- **Consequência:** adaptador ecoa identidade; nunca cria.
- **Risco:** algoritmo ainda não escolhido; adiado explicitamente (seção 18).

### `P4.13` — Primeiro CAS válido vence

- **Problema:** duas execuções concorrentes tentando avançar a mesma versão.
- **Decisão:** o primeiro CAS válido vence; os demais recebem `conflito_versao`.
- **Motivo:** regra simples, verificável no banco, sem coordenação externa.
- **Consequência:** nenhuma fusão, nenhuma escolha por heurística.
- **Risco:** execuções perdedoras precisam de tratamento explícito (`P4.14`).

### `P4.14` — Perdedor recupera avanço oficial

- **Problema:** o que a execução perdedora faz depois do conflito.
- **Decisão:** carregar o avanço oficial; replay se houver resultado; senão, falha
  fechada.
- **Motivo:** reaplicar decisão calculada sobre estado antigo produziria efeito baseado
  em mundo inexistente.
- **Consequência:** reprocessar snapshot antigo é proibido.
- **Risco:** um turno pode terminar em falha fechada; preferível a efeito incorreto.

### `P4.15` — Replay antes da máquina

- **Problema:** onde o replay é decidido.
- **Decisão:** antes de qualquer chamada à função pura, pelo orquestrador (`C5`).
- **Motivo:** autoridade única — a máquina não possui replay em sua união de resultados.
- **Consequência:** nenhuma continuação é criada durante replay.
- **Risco:** exige que a verificação preceda o claim de processamento; ordem já fixada na
  ordem determinística.

### `P4.16` — Validade da continuação por evento e versão, sem TTL

- **Problema:** decidir quando um checkpoint deixa de valer.
- **Decisão:** validade semântica por evento e versão; nunca TTL por relógio.
- **Motivo:** tempo não é o que invalida um checkpoint — mudança de mundo é.
- **Consequência:** pausa longa e legítima não invalida; avanço concorrente invalida
  imediatamente.
- **Risco:** continuações inválidas podem persistir fisicamente até a limpeza; aceito,
  pois status registra a invalidade.

### `P4.17` — Payload técnico integral por 30 dias

- **Problema:** por quanto tempo manter conteúdo técnico completo.
- **Decisão:** 30 dias após encerramento (`P4-R1`).
- **Motivo:** janela suficiente para diagnóstico real sem retenção indefinida de dados
  derivados de PII.
- **Consequência:** investigação recente é possível; retenção não cresce sem limite.
- **Risco:** incidente descoberto tarde perde payload; aceito, metadados permanecem.

### `P4.18` — Após 30 dias, somente metadados mínimos

- **Problema:** o que sobra depois da limpeza.
- **Decisão:** apenas identificadores, vínculos, tipo, status, versões, timestamps,
  códigos sem PII e fingerprint técnico.
- **Motivo:** idempotência e auditoria não exigem conteúdo; exigem identidade e vínculo.
- **Consequência:** deduplicação e replay continuam funcionando após a limpeza.
- **Risco:** diagnóstico profundo fica indisponível; aceito por decisão de privacidade.

### `P4.19` — Redação, outbox e envio fora de `P4`

- **Problema:** delimitar onde esta especificação termina.
- **Decisão:** `P4` termina no resultado lógico persistido e recuperável (`P4-R2`).
- **Motivo:** entrega tem garantias e falhas de natureza diferente; misturá-las
  inflaria o escopo e adiaria a persistência.
- **Consequência:** nenhuma tabela ou estado de transporte é criado aqui.
- **Risco:** contrato posterior necessário antes de operar ponta a ponta; registrado
  como dependência explícita.

### `P4.20` — Falhas de redação/transporte não alteram resultado lógico

- **Problema:** uma falha ao redigir ou enviar poderia disparar recomposição.
- **Decisão:** o resultado lógico persistido é imutável; falhas posteriores são
  retentadas sobre ele.
- **Motivo:** recompor produziria decisão possivelmente diferente para a mesma mensagem.
- **Consequência:** retry de entrega nunca chama a máquina nem os resolvedores.
- **Risco:** uma mensagem pode ficar decidida e não entregue; tratado pelo contrato
  posterior, não por recomposição.

## 17. Cenários obrigatórios — `P4T`

Índice documental. **Nenhum teste executável é criado por esta rodada**, e **nenhum
cenário abaixo integra a suíte oficial atual** (730 testes, 725 aprovados, 5 pulados, 0
falhas) — são contagens em domínios diferentes.

Prefixo `P4T-`, novo nesta especificação; nenhum identificador já usado em
`tests/cenarios-obrigatorios.md`, `COMP-*`, `TMP-*` ou `ITC-*` é reciclado.

Classificação:

- **unitário futuro** — verificável sem banco, sobre a lógica de decisão;
- **integração local futura** — exige orquestrador e Core reais, com adaptadores
  sintéticos;
- **banco local futuro** — exige Postgres local real (transação, CAS, unicidade);
- **segurança futura** — isolamento, PII, autoridade;
- **recuperação futura** — queda, retomada, replay.

| ID | Cenário | Classificação | Resultado esperado |
|---|---|---|---|
| P4T-01 | Duas entregas simultâneas da mesma mensagem (mesma identidade de transporte) | banco local futuro | Exatamente um claim vence; a segunda não processa; nenhum registro duplicado; nenhum segundo resultado |
| P4T-02 | Entrega repetida depois da conclusão | recuperação futura | Replay do resultado existente; máquina não chamada; nenhuma continuação criada |
| P4T-03 | Mesma identidade de transporte com `payload_fingerprint` divergente | segurança futura | Falha fechada; nenhuma sobrescrita; nenhuma reconciliação; nenhum reprocessamento |
| P4T-04 | Conflito de versão na persistência intermediária | banco local futuro | Zero linhas atualizadas; `conflito_versao`; estado oficial inalterado; nenhuma continuação nova |
| P4T-05 | Atomicidade da persistência intermediária | banco local futuro | Estado, versão, efeito confirmado, continuação anterior superada e continuação nova commitados juntos; nenhuma atualização parcial observável |
| P4T-06 | Atomicidade da persistência final | banco local futuro | Estado final, versão, resultado imutável, `resultado_id`, efeito final, mensagem concluída e encerramento da continuação commitados juntos |
| P4T-07 | Queda imediatamente após a persistência intermediária | recuperação futura | Retomada reconhece o efeito confirmado; não repete a escrita; prossegue da continuação oficial |
| P4T-08 | Queda imediatamente após a persistência final | recuperação futura | Retomada encontra resultado; devolve replay; nenhum resolvedor executado |
| P4T-09 | Queda com candidato já preparado e continuação persistida, efeito final ainda pendente, resultado final ainda não confirmado | recuperação futura | Retomada carrega a continuação oficial e verifica: candidato presente; efeito final pendente; identidades compatíveis; versão esperada ainda válida. Reapresenta exatamente o mesmo `efeito_id`, o mesmo `resultado_id`, o mesmo candidato, o mesmo estado final proposto e a mesma versão esperada — nenhum resolvedor é reexecutado, nenhum candidato é reconstruído, nenhuma identidade nova é gerada. **Resultado já existe:** usa replay; não reapresenta a escrita. **Resultado não existe e a continuação permanece compatível:** reapresenta o mesmo efeito final; a operação segue idempotente. **CAS perdido ou continuação incompatível:** falha fechada; não recalcula sobre o estado novo; não reaplica o candidato antigo. A ausência isolada de resultado, por si só, nunca produz falha fechada |
| P4T-10 | Replay sem chamar a máquina | unitário futuro | Resultado recuperado por identidade da mensagem; função pura não é invocada; IA não é chamada |
| P4T-11 | Duas execuções concorrentes com respostas diferentes, ambas válidas | banco local futuro | Primeiro CAS vence; nenhuma fusão; nenhuma escolha pelo orquestrador; perdedor não reaplica |
| P4T-12 | Execução perdedora recuperando o avanço oficial | recuperação futura | Carrega estado oficial; replay se houver resultado; senão falha fechada; reprocessamento do snapshot antigo nunca ocorre |
| P4T-13 | Isolamento entre clínicas com o mesmo `message_id` de transporte | segurança futura | Duas mensagens distintas; nenhum cruzamento; nenhuma deduplicação entre clínicas |
| P4T-14 | Identificador de outra clínica apresentado ao Core | segurança futura | Tratado como inexistente; nunca como acesso negado; nenhuma informação de existência revelada |
| P4T-15 | Continuação superada reapresentada | integração local futura | Rejeitada por versão/status incompatível; nenhuma retomada; nenhum avanço |
| P4T-16 | Nova mensagem chega com continuação pendente de outra mensagem | integração local futura | A continuação pendente não é retomada pela mensagem nova; validade perdida por versão dependente alterada (seção 11) |
| P4T-17 | Interpretação registrada sem checkpoint | recuperação futura | Resposta fixa canônica; composição não retomada; eventos e conflitos não reconstruídos |
| P4T-18 | Falha de redação após resultado persistido | integração local futura | Resultado lógico inalterado; nenhuma recomposição; nenhum resolvedor chamado |
| P4T-19 | Falha de transporte após resultado persistido | integração local futura | Idem P4T-18; retry pertence ao contrato posterior |
| P4T-20 | Logs de um avanço completo | segurança futura | Somente IDs técnicos, versões, estados, categorias, timestamps e códigos; nenhum texto bruto, nome, CPF, telefone, nascimento, e-mail, payload integral ou token |
| P4T-21 | Retenção integral dentro de 30 dias | banco local futuro | Payload de continuação, resposta condicional e parâmetros ainda presentes e íntegros |
| P4T-22 | Remoção de payload após 30 dias | banco local futuro | Payloads completos ausentes; linha preservada |
| P4T-23 | Preservação de metadados após a limpeza | banco local futuro | `clinica_id`, identificadores, vínculos, tipo, status, versões, timestamps, códigos e fingerprint preservados; deduplicação e replay continuam funcionando |

## 18. Itens adiados

Registrados como **adiados**, sem decisão nesta rodada:

- nomes definitivos de tabelas, colunas, índices e constraints;
- SQL;
- migrations;
- RPCs;
- UUID versus ULID versus hash;
- JSONB versus normalização;
- índices não essenciais;
- job de limpeza (cron, função, lote, agendamento);
- driver e biblioteca de acesso;
- RLS concreta (políticas, papéis, predicados);
- tecnologia de redação (`P5`);
- outbox;
- transporte;
- deploy.

Nenhum destes é decidido, presumido ou antecipado por esta especificação.

## 19. Invariantes

- Estado oficial e continuação são registros fisicamente separados; o estado nunca é
  reconstruído a partir de continuação, e dados só da continuação nunca viram fato
  oficial.
- A versão do estado é um inteiro monotônico atribuído pelo banco; timestamp nunca é
  versão.
- Todo avanço oficial ocorre por CAS incluindo `clinica_id`, `conversa_id` e a versão
  esperada; zero linhas atualizadas é sempre `conflito_versao`.
- Persistência intermediária e persistência final são cada uma uma única transação
  lógica; nenhuma atualização parcial é observável.
- Estado final e resultado lógico nunca são confirmados separadamente.
- Existe no máximo um resultado por mensagem e clínica, e o conteúdo de um
  `resultado_id` é imutável.
- Deduplicação de transporte, idempotência operacional e idempotência da composição são
  três mecanismos distintos; nenhum substitui outro.
- O texto da mensagem nunca integra a identidade de deduplicação; payload divergente sob
  a mesma identidade falha fechado.
- Eventos candidatos e conflitos de valor nunca são persistidos; interpretação sem
  resultado recuperável produz resposta fixa e nunca retoma a composição.
- Replay ocorre antes da máquina, não reinterpreta, não chama resolvedores e não recompõe
  domínio.
- A execução perdedora de um CAS nunca reaplica decisão calculada sobre estado antigo.
- A validade de uma continuação é semântica, por evento e versão — nunca TTL por relógio.
- Payload técnico integral vive 30 dias após o encerramento; depois disso restam somente
  metadados mínimos, e a deduplicação continua funcionando.
- O prazo de 30 dias começa somente no encerramento; nenhuma continuação ativa entra
  nesse prazo nem perde payload por passagem de tempo. Continuação encerrada nunca
  volta a ser válida, e metadado sem payload nunca autoriza retomada.
- O conteúdo bruto da mensagem continua expirando em 7 dias (`persistencia-v1.md` §19);
  nenhum artefato técnico de 30 dias o preserva além desse prazo.
- `clinica_id` vem exclusivamente da instância autenticada; toda estrutura o vincula
  estruturalmente; identificador de outra clínica é inexistente.
- RLS é defesa adicional; o acesso do servidor também exige predicado de clínica.
- Logs nunca contêm texto bruto, nome, CPF, telefone, nascimento, e-mail, payload
  integral, credenciais ou tokens completos.
- O orquestrador executa I/O e transação, e nunca decide domínio, próxima etapa,
  invalidação, resultado terminal ou fallback.
- `P4` termina no resultado lógico persistido e recuperável; redação, outbox, envio,
  retries e ACK ficam fora, e falhas nessas camadas nunca alteram o resultado lógico.
- Esta especificação não cria código, tipo TypeScript, teste executável, tabela, coluna,
  índice, constraint, RPC, migration ou schema físico.
