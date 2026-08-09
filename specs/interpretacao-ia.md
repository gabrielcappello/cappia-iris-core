# Spec — Interpretação pela IA

**Status:** especificação de integração aprovada e registrada nesta versão (ver seções
abaixo). Pendências explícitas, ainda não resolvidas: base legal, retenção e
contrato/condições do provedor para uso com pacientes reais; limite máximo de janela e
quantidade máxima de mensagens por turno (a definir na especificação de transporte);
classificação de saudação/conversa básica na saída do modelo. Nenhuma dessas pendências
deve ser tratada como decidida.

**Já não são pendências**: o debounce, decidido em 3 segundos (ver "Limites"); a
invalidação de dependências entre procedimento/dentista/data/período/horário, definida
em `controlador-conversacional-v1.md` §10; e a porta de redação, definida em
`atendimento-v1.md`.

Esta especificação detalha o contrato entre a mensagem do paciente e a saída estruturada
da IA, e a integração do adaptador OpenAI (`src/core/cliente-modelo-openai.ts`) com o
Iris Core — respeitando `../docs/02-arquitetura.md`: a IA só interpreta e redige, nunca
decide o próximo passo nem acessa banco, calendário, credenciais ou ferramentas.

Qualquer alteração futura a este documento segue o mesmo rigor: não preencher por
suposição, escrever somente depois que Gabriel definir e aprovar o comportamento
detalhado (ver processo em `../AGENTS.md`).

## Cláusula registrada

No adaptador OpenAI, o modo estruturado obrigatório deve usar
`text.format.type = 'json_schema'` e `strict = true`; remover ou enfraquecer
`strict` viola o contrato.

## Componentes reutilizados

Classificação aprovada para esta integração:

- `criarClienteModeloOpenAI` (`src/core/cliente-modelo-openai.ts`): **reutilizar**.
- `extrairAlteracoes` (`src/core/interpretacao-extrator.ts`): **reutilizar após ajuste**.
- `preAplicar` (`src/core/pre-aplicacao.ts`): **reutilizar**.
- `aplicarDados` (`src/core/aplicar-dados.ts`): **reutilizar no contrato atual**, sem usar
  seu retry interno para a persistência da interpretação (ver "Concorrência" abaixo).
- `interpretarEAplicar` (`src/core/interpretar-e-aplicar.ts`): **reutilizar após ajuste**,
  permanecendo como orquestrador fino.
- `estado_conversa`: **reutilizar**.
- `mensagens_recebidas`: **reutilizar após ajuste**.

## Concorrência

- `atualizado_em` é a versão de `estado_conversa.dados` nesta primeira integração.
- A interpretação usa o snapshot original, lido antes de chamar o modelo.
- Será criada futuramente a função interna, com a identidade do claim como parte do
  contrato (assinatura documental — **não implementada nesta rodada**):

```ts
interface ClaimInterpretacao {
  mensagem_recebida_id: string;
  claim_token: string;
}

aplicarInterpretacaoCondicional(
  cliente,
  snapshot,
  claim,
  alteracoes_aplicaveis
): Promise<ResultadoAplicacaoInterpretacao>
```

- Essa função fará **uma única tentativa** de persistência (sem o retry interno de
  `aplicarDados`).

### Contrato atômico obrigatório

`aplicarInterpretacaoCondicional` deve executar **uma única operação transacional** no
PostgreSQL (futura função/RPC ou mecanismo equivalente). Chamadas PostgREST separadas —
uma consulta de revalidação seguida de uma escrita distinta — **não atendem a esse
contrato**: entre duas operações separadas, o lease pode expirar ou outro worker pode
reivindicar (`reclaim`) a mensagem, e o worker antigo ainda poderia persistir.

Na mesma transação, a operação deve:

1. localizar e bloquear a linha correspondente em `mensagens_recebidas`;
2. confirmar simultaneamente, em `mensagens_recebidas`:
   - `status_processamento = 'processando'`;
   - `claim_token` igual ao token apresentado pelo worker;
   - `lease_expira_em` ainda vigente;
   - `interpretacao_persistida_em IS NULL`;
3. confirmar simultaneamente, em `estado_conversa` (`conversa_id` é o campo recebido
   pelo Core; a coluna real é `id`):
   - `id = snapshot.conversa_id`;
   - `clinica_id = snapshot.clinica_id`;
   - `telefone_normalizado = snapshot.telefone_normalizado`;
   - `atualizado_em = snapshot.atualizado_em`;
4. somente se todas as condições acima forem verdadeiras: aplicar em `estado_conversa`
   as `alteracoes_aplicaveis`, quando existirem (atualizando `atualizado_em`), gravar
   `interpretacao_persistida_em = now()` na linha correspondente de
   `mensagens_recebidas`, e retornar o estado oficial resultante;
5. se qualquer condição falhar: não alterar `estado_conversa`; não gravar
   `interpretacao_persistida_em`; não aplicar parcialmente; não reler e reaplicar; não
   chamar o modelo novamente dentro da mesma tentativa; retornar a falha determinística
   apropriada.

A operação é **tudo-ou-nada**: não existe estado intermediário observável entre a
validação do claim/versão e a persistência. Quando não existem `alteracoes_aplicaveis`
— saída válida vazia, alteração idempotente, interpretação composta somente por
conflitos, ou qualquer combinação válida que não resulte em nenhum dado diferente no
estado — `estado_conversa.dados` pode permanecer inalterado; isso **não é persistência
parcial**, desde que `interpretacao_persistida_em` seja gravado na mesma transação.
Nunca pode existir:

- alteração efetiva em `estado_conversa` sem `interpretacao_persistida_em` preenchido
  na mesma transação;
- persistência parcial quando a transação falhar.

### Casos sem alteração de estado

**Saída vazia válida**: nenhuma alteração em `estado_conversa`; `interpretacao_persistida_em`
é preenchido; o processamento normal continua (ver "Fluxo final aprovado").

**Alteração idempotente**: `estado_conversa.dados` pode permanecer igual (nenhum
`UPDATE` é necessário); `interpretacao_persistida_em` é preenchido; o processamento
normal continua.

**Somente conflitos**: `estado_conversa.dados` pode permanecer igual;
`interpretacao_persistida_em` é preenchido; o conflito é tratado em memória, no
processamento atual (ver "Conflitos").

**Resultado misto**: as `alteracoes_aplicaveis` são persistidas em `estado_conversa`;
os conflitos remanescentes permanecem em memória; o controlador recebe ambos durante o
processamento normal.

Se houver uma queda depois de `interpretacao_persistida_em` ser gravado, em qualquer um
desses quatro casos, aplica-se somente a regra de falha segura registrada em
"Deduplicação e lease" → "Reclaim e `interpretacao_persistida_em`" — nenhuma tentativa
de reconstruir o conflito ou o resultado transitório (ver "Limitação aceita").

- Se a versão mudou (verificada dentro da mesma transação da operação atômica acima):
  - não aplicar nenhuma alteração;
  - não reler e reaplicar;
  - não chamar o modelo novamente;
  - devolver `conflito_concorrente`.
- `aplicarDados` mantém seu comportamento atual (com retry) para os demais
  consumidores — esta integração não altera `aplicarDados`.

## Conflitos

Duas categorias formalmente distintas:

- **Conflito de valor**:
  - detectado por `preAplicar`;
  - alterações independentes (outros campos, sem conflito) continuam sendo aplicadas;
  - o controlador decide como esclarecer o conflito com o paciente.
- **Conflito concorrente**:
  - a versão (`atualizado_em`) mudou entre a leitura do snapshot e a tentativa de
    escrita;
  - invalida **toda** a aplicação daquela interpretação — não é uma decisão por campo.

`corrigir` e `remover` continuam válidos somente quando a versão não mudou: a proteção
de `aplicarInterpretacaoCondicional` por `atualizado_em` é o que impede que uma decisão
`corrigir`/`remover` calculada contra um snapshot obsoleto seja aplicada sobre um estado
mais recente.

### Conflitos durante o processamento normal

- `preAplicar` continua retornando `alteracoes_aplicaveis` e `conflitos` separadamente;
- `aplicarInterpretacaoCondicional` recebe somente `alteracoes_aplicaveis` — nunca os
  conflitos;
- os conflitos permanecem **em memória**, no worker que está processando a mensagem
  agora;
- depois da persistência bem-sucedida, o controlador recebe o estado oficial resultante
  e os conflitos mantidos em memória, e decide a pergunta de esclarecimento;
- os conflitos **não são persistidos** para recuperação posterior — nenhum `campo`,
  `valor_atual` ou `valor_informado` é guardado em `mensagens_recebidas` (ver
  "Limitação aceita").

## Deduplicação e lease (`mensagens_recebidas`)

- Chave única de deduplicação: `provider + instancia_whatsapp + message_id` (já existe
  como `unique` no schema atual).
- Reivindicação (`claim`) atômica antes de chamar a IA.
- Colunas futuras a adicionar:
  - `claim_token uuid null`;
  - `lease_expira_em timestamptz null`;
  - `interpretacao_persistida_em timestamptz null` — marcador persistente do estado de
    processamento desse `message_id`:
    - `null`: nenhuma interpretação válida desse `message_id` foi confirmada como
      persistida;
    - não `null`: a interpretação desse `message_id` foi validamente
      persistida/processada, mesmo quando nenhuma alteração efetiva em
      `estado_conversa.dados` foi necessária (ver "Concorrência" → "Casos sem
      alteração de estado"). Não significa necessariamente que a interpretação "foi
      aplicada em `estado_conversa`" — significa que a etapa de interpretação desse
      `message_id` foi validamente persistida e não deve ser repetida.
  Nenhuma dessas colunas é implementada nesta rodada; `interpretacao_persistida_em` é
  usado de forma uniforme em todo este documento com essa semântica.
- Transições de estado aprovadas:
  - `recebida → processando`;
  - `processando` (expirado) `→ processando` com novo `claim_token`.
- Lease: **60 segundos**.
- Somente o proprietário do `claim_token` vigente pode persistir a interpretação (gate
  atômico, parte da mesma transação da persistência — ver "Concorrência" → "Contrato
  atômico obrigatório") e marcar o processamento como `concluida` (transição
  condicional ao token vigente, também atômica). Essas duas ações são **garantias
  absolutas**.
- Antes de autorizar a produção lógica da resposta e antes de enviá-la, o Core consulta
  novamente o claim vigente (**gates operacionais**, não atômicos): se a perda do claim
  já for detectada nesse gate, a etapa correspondente (produção ou envio) não é
  executada. Esses gates reduzem o risco, mas não tornam a produção ou o envio atômicos
  com `mensagens_recebidas` — o claim pode mudar depois do gate e antes da ação
  seguinte. Impedir absolutamente uma produção ou um envio por um worker que perdeu o
  claim depois do gate depende futuramente de transporte idempotente ou de um padrão
  outbox transacional.
- `concluida` não processa nem responde novamente.
- `processando` com lease válido não processa nem responde novamente.
- `falhou` não é reinterpretada automaticamente.
- `processando` com lease expirado pode ser reivindicada por um novo worker.
- O worker antigo (dono do `claim_token` anterior) não persiste nem marca `concluida`
  depois de um novo claim ter sido emitido — garantias absolutas. Produção e envio pelo
  worker antigo são bloqueados apenas quando a perda do claim é detectada no gate
  correspondente (ver acima) — não há garantia absoluta contra uma corrida ocorrida
  depois desse gate.

### Reclaim e `interpretacao_persistida_em`

Um `processando` com lease expirado pode ser reivindicado por um novo worker (novo
`claim_token`). Sem um marcador persistente, o novo worker não consegue distinguir se o
worker anterior caiu antes de persistir a interpretação ou já a persistiu e caiu antes
de marcar `concluida` — no segundo caso, chamar o modelo e persistir de novo duplicaria
a interpretação do mesmo `message_id`. `interpretacao_persistida_em` resolve essa
ambiguidade:

**Reclaim com `interpretacao_persistida_em IS NULL`** (interpretação ainda não
persistida): o novo worker pode carregar o snapshot, chamar o modelo, validar a saída,
executar `preAplicar` e tentar a persistência transacional única. A persistência ainda
depende de claim, status, lease, versão **e marcador `null`** válidos, todos na mesma
transação (ver "Concorrência" → "Contrato atômico obrigatório").

**Reclaim com `interpretacao_persistida_em IS NOT NULL`** (interpretação já
persistida — recuperação segura após falha): o novo worker **não tenta reconstruir**
a interpretação anterior. Ele:

- não chama o modelo;
- não executa `extrairAlteracoes`;
- não valida nova saída;
- não executa `preAplicar`;
- não reaplica alterações;
- não tenta reconstruir conflitos transitórios (eles existiram só em memória no
  worker anterior — ver "Conflitos" → "Conflitos durante o processamento normal" — e
  não foram persistidos, por decisão de escopo, ver "Limitação aceita");
- não executa o controlador determinístico normal;
- não combina resultado antigo com o estado mais recente.

Produz somente a resposta fixa de falha ("Não consegui processar sua mensagem agora.
Pode tentar novamente?" — ver "Falhas e mensagens duplicadas"). Em seguida: passa pelo
gate normal antes do envio, entrega essa resposta fixa, e marca `concluida` somente se
`status_processamento = 'processando'` **e** `claim_token` ainda pertence a esse
worker (mesma transição condicional já aprovada — nenhum status novo). Não chama
novamente a IA. Não modifica o estado da conversa.

`mensagens_recebidas`, combinada com o contrato atômico de
`aplicarInterpretacaoCondicional`, garante uma única interpretação persistida e uma
única transição para `concluida` por `message_id`. Não garante, por si só, uma única
produção lógica de resposta nem uma única tentativa de envio: os gates antes da
produção e antes do envio reduzem o risco de duplicação, mas não são atômicos com a
tabela. Impedir produção ou envio duplicados por um worker que perdeu o claim depois do
gate, e garantir entrega externa exatamente uma vez (ao transporte/paciente),
**dependerá futuramente** de idempotência do transporte ou de um padrão outbox
transacional — não está resolvida nesta especificação.

## Limitação aceita

A primeira versão da Iris não garante reconstrução perfeita da resposta depois de uma
queda ocorrida entre a persistência da interpretação e a resposta ao paciente.
Conflitos transitórios (mantidos em memória durante o processamento normal, nunca
persistidos) podem ser perdidos nessa situação rara — o worker recuperado produz
somente a resposta fixa de falha (ver "Reclaim e `interpretacao_persistida_em`" acima).
A mensagem seguinte do paciente será processada normalmente a partir do estado oficial.

Essa limitação é aceita para evitar complexidade desproporcional a uma sequência rara
de queda e concorrência. Nesta etapa: não haverá vínculo de conflitos com versão; não
haverá serialização adicional por conversa; não haverá persistência de resultados
transitórios. Isto é uma decisão consciente de escopo da primeira versão, não um erro
arquitetural pendente.

## Contrato técnico de banco — Etapa 6

### Estado real confirmado

Auditoria de leitura confirmou:

- `mensagens_recebidas` não possui, no schema versionado hoje: `claim_token`;
  `lease_expira_em`; `interpretacao_persistida_em`;
- não existem RPCs, funções PostgreSQL ou triggers para claim, reclaim, ou
  persistência atômica da interpretação;
- não existe call site de produção para `mensagens_recebidas`;
- `aplicarDados` usa chamadas PostgREST separadas e retry client-side, e permanece
  inalterado para seus consumidores atuais (ver "Componentes reutilizados");
- `atualizado_em` é tratado nesta integração como versão de `estado_conversa.dados`,
  não de todas as colunas da linha.

Isso descreve o schema versionado inspecionado — não afirma que a tabela implantada
está vazia, nem que o banco vivo corresponde integralmente às migrations versionadas.

### Migration mínima aprovada

Uma futura migration aditiva, adicionando exatamente estas colunas `nullable` a
`mensagens_recebidas`:

- `claim_token uuid null`;
- `lease_expira_em timestamptz null`;
- `interpretacao_persistida_em timestamptz null`.

Nesta primeira migration: nenhum `resultado_continuacao`; nenhuma coluna adicional;
nenhum índice novo; nenhum `CHECK` novo; nenhum backfill obrigatório; nenhuma suposição
sobre ausência de linhas antigas. `CHECK`s e índices só poderão ser avaliados
futuramente, com necessidade comprovada.

A migration continua dependente de uma verificação read-only do banco real,
imediatamente antes da aplicação — sem presumir o resultado dessa verificação (não
presumir tabela vazia, nem que o banco vivo corresponde integralmente ao schema
versionado).

### Operações aprovadas

Pacote mínimo:

1. uma RPC PostgreSQL para reivindicação (`reivindicar_mensagem`);
2. uma RPC PostgreSQL para persistência atômica da interpretação
   (`aplicar_interpretacao_condicional`);
3. um `UPDATE` PostgREST condicional para conclusão.

Não há RPC adicional de reclaim: claim inicial e reclaim pertencem à mesma operação de
reivindicação.

### RPC de reivindicação — `reivindicar_mensagem`

Uma única operação atômica.

Entrada mínima:

```ts
interface ReivindicarMensagemInput {
  provider: string;
  instancia_whatsapp: string;
  message_id: string;
  clinica_id: string;
  telefone_normalizado: string;
}
```

Todos os dados vêm do servidor e da instância autenticada — nunca `clinica_id`
fornecido pelo paciente ou pela IA.

- **Linha inexistente**: inserir a mensagem diretamente com
  `status_processamento = 'processando'`; gerar `claim_token` no servidor; definir
  `lease_expira_em` para 60 segundos; `interpretacao_persistida_em` permanece `null`;
  retornar `reivindicada_interpretar`.
- **Linha existente em `recebida`**: alterar para `processando`; gerar novo
  `claim_token` no servidor; definir lease de 60 segundos; retornar
  `reivindicada_interpretar`.
- **Linha existente em `processando` com lease expirado e marcador `null`**: manter
  status `processando`; substituir `claim_token`; renovar lease por 60 segundos;
  retornar `reivindicada_interpretar`.
- **Linha existente em `processando` com lease expirado e marcador preenchido**:
  manter status `processando`; substituir `claim_token`; renovar lease por 60
  segundos; preservar `interpretacao_persistida_em`; retornar
  `reivindicada_resposta_fixa`.
- **Linha existente em `processando` com lease vigente**: não alterar; não retornar
  token utilizável; retornar `nao_elegivel`.
- **Linha `concluida`**: não alterar; não processar novamente; retornar
  `nao_elegivel`.
- **Linha `falhou`**: não alterar; não reinterpretar automaticamente; retornar
  `nao_elegivel`.
- **Linha existente com a mesma chave (`provider + instancia_whatsapp + message_id`),
  mas `clinica_id` ou `telefone_normalizado` diferentes do apresentado**: não alterar
  a linha; não substituir clínica nem telefone; não retornar token; retornar
  `nao_elegivel`. Isso evita criar um novo resultado e não revela dados da mensagem
  já existente.

Lease expirado significa, precisamente, `lease_expira_em <= transaction_timestamp()`;
lease vigente significa `lease_expira_em > transaction_timestamp()`.
`transaction_timestamp()` é a referência única de tempo da transação — nunca um
horário fornecido pelo cliente ou pela Edge Function.

A restrição única `provider + instancia_whatsapp + message_id`, combinada com a
operação atômica, garante um único vencedor.

### Resultados mínimos da reivindicação

Somente:

- `reivindicada_interpretar`;
- `reivindicada_resposta_fixa`;
- `nao_elegivel`.

Erros técnicos não são novos valores de `status_processamento` nem resultados
operacionais persistidos. A resposta da RPC só pode fornecer `claim_token` quando a
mensagem tiver sido realmente reivindicada — isto é, nos dois resultados
`reivindicada_*`, nunca em `nao_elegivel`.

### RPC de persistência atômica — `aplicar_interpretacao_condicional`

Executa uma única transação PostgreSQL.

Entrada mínima:

```ts
interface AplicarInterpretacaoCondicionalInput {
  mensagem_recebida_id: string;
  clinica_id: string;
  telefone_normalizado: string;
  claim_token: string;
  conversa_id: string;
  snapshot_atualizado_em: string;
  alteracoes_aplicaveis: AlteracoesDados; // mesmo formato de aplicarDados (src/core/tipos.ts)
}
```

Ordem fixa:

1. localizar e bloquear `mensagens_recebidas`;
2. validar autorização da mensagem;
3. executar o CAS em `estado_conversa`;
4. persistir alterações quando existirem;
5. preencher `interpretacao_persistida_em`;
6. retornar o estado oficial;
7. rollback integral em qualquer falha.

**Validação em `mensagens_recebidas`** — exigir simultaneamente: `id =
mensagem_recebida_id`; `clinica_id` correspondente ao autenticado;
`telefone_normalizado` correspondente; `status_processamento = 'processando'`;
`claim_token` correspondente; `lease_expira_em` ainda vigente;
`interpretacao_persistida_em IS NULL`.

**CAS em `estado_conversa`** — exigir simultaneamente: `id = conversa_id`;
`clinica_id` correspondente; `telefone_normalizado` correspondente; `atualizado_em =
snapshot_atualizado_em`.

A mensagem e a conversa devem pertencer à mesma clínica e ao mesmo telefone.

- **Com alterações efetivas**: na mesma transação, atualizar `dados`; atualizar
  `atualizado_em`; preencher `interpretacao_persistida_em`; retornar o estado oficial
  resultante.
- **Sem alterações efetivas** (saída vazia, idempotência, ou somente conflito):
  `dados` permanece igual; `atualizado_em` pode permanecer igual;
  `interpretacao_persistida_em` é preenchido; retornar o estado oficial existente; a
  interpretação é considerada persistida com sucesso.
- **Resultado misto**: persistir somente `alteracoes_aplicaveis`; conflitos
  permanecem em memória no Core; preencher o marcador na mesma transação. Conflitos
  nunca são persistidos.

### Resultados mínimos da persistência

Somente:

- `persistida`;
- `autorizacao_invalida`;
- `conflito_concorrente`.

`autorizacao_invalida` reúne: mensagem inexistente ou incompatível; clínica ou
telefone incompatível; status incompatível; token incompatível; lease expirado;
marcador já preenchido.

`conflito_concorrente` significa exclusivamente falha do CAS de
`estado_conversa.atualizado_em`.

Erro técnico permanece exceção controlada — não é resultado de negócio nem novo
status persistido.

### Locks

- Ordem fixa: (1) `mensagens_recebidas`; (2) `estado_conversa`.
- O `UPDATE` condicional de `estado_conversa` é suficiente para o CAS — não é
  necessário `SELECT FOR UPDATE` separado.
- Nenhuma serialização adicional permanente por conversa será criada.
- Dois `message_id` que tentem persistir sobre o mesmo `snapshot_atualizado_em`:
  somente um CAS persiste; o outro recebe `conflito_concorrente`. Uma mensagem
  posterior, com `snapshot_atualizado_em` já atualizado (lido depois da primeira
  persistência), pode persistir normalmente — a restrição é sobre workers usando a
  mesma versão, não sobre `message_id` diferentes da mesma conversa em geral.

### Segurança das RPCs

Para `reivindicar_mensagem` e `aplicar_interpretacao_condicional`:

- `SECURITY INVOKER` — nunca `SECURITY DEFINER`;
- chamadas somente pela Edge Function usando `service_role`;
- nomes de schemas e objetos totalmente qualificados;
- `search_path` explícito e seguro;
- revogar `EXECUTE` de `PUBLIC`, `anon`, `authenticated`;
- conceder `EXECUTE` somente a `service_role`;
- nenhuma IA acessa as RPCs diretamente;
- nenhuma credencial entra em prompt, payload ou log.

### Operação de aplicação da interpretação sob CAS por `estado_conversa.versao` (`P4I`)

**Status:** especificação documental da direção arquitetural aprovada em `D2`
(`../docs/04-decisoes-canonicas.md`). **Não implementada.** Nenhuma migration criada,
nenhum SQL executado, nenhum código TypeScript alterado. Esta seção substitui, **como
destino de direção**, a operação descrita acima ("RPC de persistência atômica —
`aplicar_interpretacao_condicional`") — o contrato acima permanece a descrição fiel
do que está **atualmente ativo** no banco; esta seção descreve o que **deve
substituí-lo**, sem fixar ainda nome SQL definitivo nem estratégia de transição
(`D2`, ponto 7).

**Por que esta operação é necessária:** a partir da ativação de `P4I`,
`estado_conversa` passa a ter uma coluna `versao bigint` monotônica, atribuída pelo
banco (`persistencia-fisica-composicao-v1.md` §7; `implementacao-persistencia-
composicao-v1.md` §5.1, §14). A composição avança essa versão através de
`persistir_checkpoint`/`persistir_resultado_final` (`implementacao-persistencia-
composicao-v1.md` §13.5–§13.6). A interpretação (Etapa 6/7) também altera
`estado_conversa.dados` — hoje via `aplicar_interpretacao_condicional`, usando CAS por
`atualizado_em`. Duas vias de escrita sobre a mesma linha, usando dois predicados de
concorrência diferentes, violaria a invariante central de `P4` (§19): "timestamp nunca
é versão"; "todo avanço oficial por CAS incluindo `clinica_id` + `conversa_id` +
versão esperada". Esta operação fecha essa lacuna: a interpretação passa a avançar a
**mesma** `versao` que a composição usa e espera.

#### 1. Responsabilidade

A operação:

- valida a mensagem (`clinica_id`, `conversa_id`, claim, lease), na mesma ordem de
  locks já fixada acima ("Locks": mensagem antes de conversa);
- valida que a interpretação ainda não foi persistida
  (`interpretacao_persistida_em IS NULL`), preservando exatamente a mesma regra já
  fechada para a operação atual;
- aplica somente as alterações estruturadas autorizadas. **Autoridade única da
  allowlist:** o contrato versionado de `AlteracoesDados`/allowlist já aprovado
  (`src/core/tipos.ts`; mesmo conjunto de campos e ações validado hoje em
  `aplicar_interpretacao_condicional` — "intencao, procedimento_texto,
  dentista_texto, data_texto, periodo, horario_texto, nome, cpf, data_nascimento,
  email"; ações "informar/corrigir/remover") é a **única autoridade semântica**
  sobre o que é uma alteração autorizada. Pode existir validação no Core, no banco,
  ou em ambos, como **enforcement** (camadas redundantes de verificação) — mas:
  **não podem existir catálogos independentes** (uma allowlist no Core diferente da
  allowlist no banco); **nenhuma camada pode ampliar ou divergir** da allowlist
  canônica (nem aceitar campo a mais, nem ação a mais, nem domínio de valor
  diferente do já aprovado para `periodo`/`intencao`); **qualquer validação
  duplicada aplica exatamente o mesmo contrato versionado**, nunca uma cópia
  divergente ou uma versão "equivalente" mantida separadamente. Esta especificação
  não amplia nem restringe o contrato de domínio já aprovado;
- usa CAS por `versao_esperada`, no lugar de `snapshot_atualizado_em`;
- incrementa `estado_conversa.versao` **no banco** quando há alteração efetiva do
  estado oficial — nunca calculado pelo cliente ou pelo adaptador;
- grava `interpretacao_persistida_em` na **mesma transação lógica** que o CAS —
  preservando a atomicidade já garantida hoje;
- retorna `estado_oficial` (`dados`) e `versao_estado` (`versao`) resultantes;
- **não executa composição** — não resolve procedimento, dentista, duração,
  disponibilidade ou temporal;
- **não cria continuação** — `continuacoes_composicao` não é tocada por esta
  operação;
- **não executa efeito externo** — nenhuma escrita fora de `estado_conversa` e
  `mensagens_recebidas` (`interpretacao_persistida_em`);
- **não decide fluxo** — permanece, como hoje, uma operação de persistência
  condicional, nunca uma decisão de controlador.

#### 2. Entradas

Conceituais, sem nome físico nem assinatura SQL definitiva (`D2`, ponto 7):

- `clinica_id`;
- `conversa_id`;
- `mensagem_id` (equivalente a `mensagem_recebida_id` na operação atual);
- `claim_token`;
- `versao_esperada` (substitui `snapshot_atualizado_em`);
- alterações estruturadas autorizadas (mesmo formato de `alteracoes_aplicaveis`/
  `AlteracoesDados`, `src/core/tipos.ts` — nenhuma mudança de contrato de domínio
  nesta especificação);
- `telefone_normalizado` permanece necessário pelo mesmo motivo já registrado na
  operação atual (compor a chave natural da conversa) — preservado aqui, não
  removido.

`versao_contrato_dados` **não integra** esta lista de entradas conceituais — ver
seção própria abaixo ("Precondição: coerência com o contrato versionado de
`dados`"), porque sua forma física de transporte permanece em aberto e não deve ser
presumida como um parâmetro de entrada até essa forma ser decidida.

#### 2.1 Precondição: coerência com o contrato versionado de `dados`

Independente da forma física, a operação está sujeita a esta precondição, **não
opcional**:

- o estado oficial (`dados`) e as alterações aplicadas por esta operação **devem
  respeitar o contrato versionado** de `estado_conversa.dados`
  (`implementacao-persistencia-composicao-v1.md` §5.1: "JSONB sempre versionado";
  §17: "versão de contrato obrigatória em coluna normalizada própria... versão
  desconhecida nunca é aceita silenciosamente — produz `registro_corrompido`");
- essa coerência **deve ser validada atomicamente** pela operação, na mesma
  transação que aplica as demais verificações (claim, lease, CAS por `versao`) —
  nunca uma checagem solta, anterior ou posterior à transação de escrita;
- **permanece em aberto** se a versão contratual:
  - transita como entrada (fornecida pelo chamador, análoga a `versao_esperada`);
  - é determinada pelo banco (atribuída ou verificada internamente à operação);
  - é derivada do próprio estado oficial (lida do que já está gravado em
    `estado_conversa`, nunca inferida por aproximação);
  - ou é validada por outro mecanismo único aprovado (por exemplo, `CHECK` de
    banco, sem trânsito explícito por uma entrada nomeada).
  Nenhuma dessas alternativas está descartada nem escolhida nesta rodada — só o
  mecanismo físico permanece adiado, coerente com "o nome SQL definitivo...
  permanece em aberto" (`D2`, ponto 7); a **existência da validação em si não é
  opcional**;
- **não pode existir catálogo independente ou interpretação divergente** dessa
  versão contratual — qualquer forma física escolhida no futuro usa exatamente o
  mesmo contrato de versão já vigente em `P4I` (§17), nunca uma numeração ou
  interpretação própria desta operação.

#### 3. Saídas

União fechada, análoga à já existente (seção "Resultados mínimos da persistência"),
estendida para distinguir versão de conflito:

- **aplicação com alteração efetiva** — `dados` e `versao` avançam juntos;
  `interpretacao_persistida_em` preenchido; retorna `estado_oficial` e `versao_estado`
  resultantes;
- **interpretação válida sem alteração efetiva** — saída vazia, idempotente, ou
  somente conflito (mesma casuística já fechada na seção "Casos sem alteração de
  estado"); mesmo sem alteração de `dados`, a operação **participa da mesma
  serialização por `versao`** (valida `versao_esperada` atomicamente contra a
  corrente, na mesma transação); se `versao_esperada` já não corresponder à
  corrente (outro escritor venceu no meio-tempo), a operação **não grava** o
  marcador e devolve conflito de versão (ver seção 4) — nunca grava
  `interpretacao_persistida_em` sobre uma leitura obsoleta; se `versao_esperada`
  ainda corresponder à corrente, `dados` e `versao` permanecem inalterados,
  `interpretacao_persistida_em` é preenchido dentro dessa mesma verificação
  atômica, e a interpretação é considerada persistida com sucesso;
- **interpretação já persistida** — `interpretacao_persistida_em IS NOT NULL` no
  momento da validação. **Semântica única, sem variação por outro campo:** este
  resultado é sempre **reconhecimento idempotente de um fato já ocorrido**, nunca
  uma variante de `autorizacao_invalida` motivada por outra causa — a mensagem foi
  legitimamente reivindicada (claim/lease válidos) e sua interpretação já foi
  gravada antes; a operação não reinterpreta, não reaplica `alteracoes_aplicaveis`,
  não recalcula `dados` nem `versao`, e não os retorna como se fossem o resultado
  desta chamada. **Precedência fechada quando o marcador está preenchido e a
  `versao` apresentada diverge da corrente:** o marcador **sempre precede** — a
  operação nunca chega a avaliar `versao_esperada` quando
  `interpretacao_persistida_em IS NOT NULL` (a checagem do marcador ocorre antes,
  na mesma validação de autorização que hoje verifica claim/lease/status); portanto
  esse caso **nunca** produz conflito de versão, mesmo que `versao_esperada` esteja
  desatualizada — produz sempre o mesmo reconhecimento idempotente, independente do
  valor de `versao_esperada` apresentado. Esta é a **única** regra em toda a
  especificação para `interpretacao_persistida_em IS NOT NULL` — as seções 5 e 9
  usam exatamente esta mesma regra, sem variação;
- **conflito de versão** — `versao_esperada` não corresponde à `versao` corrente;
  equivalente a `conflito_concorrente`, mas com predicado de `versao`, não de
  `atualizado_em`; nenhuma alteração aplicada;
- **claim inválido** — `claim_token` não corresponde ao vigente; parte de
  `autorizacao_invalida`, preservado;
- **lease expirado** — `lease_expira_em` não vigente; parte de `autorizacao_invalida`,
  preservado;
- **mensagem, clínica ou conversa incompatível** — qualquer descasamento entre os
  identificadores apresentados e os registrados; parte de `autorizacao_invalida`,
  preservado (mesma regra de "tratar como inexistente, nunca revelar", já fechada
  para `referencia_cruzada_clinica` na P4I);
- **alteração não autorizada** — campo fora da allowlist, ação fora do vocabulário,
  ou estrutura inválida; mesma regra de rejeição integral já fechada (`INT-05`,
  `INT-06`, `INT-08`); nenhuma alteração parcial;
- **erro técnico fechado** — falha de infraestrutura; nunca um novo valor de negócio;
  rollback integral, preservando "erro técnico permanece exceção controlada — não é
  resultado de negócio nem novo status persistido" (regra já fechada acima).

Catálogo de nomes definitivo (equivalente a `persistida`/`autorizacao_invalida`/
`conflito_concorrente` hoje) permanece em aberto — só a distinção semântica acima é
fechada nesta rodada.

#### 4. Regras de versão

- `versao` **incrementa** exatamente quando há alteração efetiva de `dados` — mesma
  condição que hoje decide se `atualizado_em` avança;
- `versao` **não incrementa** quando a interpretação é válida mas não produz
  alteração efetiva (saída vazia, idempotente, ou somente conflito) — mesma regra já
  fechada para `atualizado_em` hoje, transposta para `versao`;
- quando as alterações resultam **no mesmo estado** (idempotência: `dados_novos`
  igual a `dados_atual`), `versao` permanece igual — nunca incrementada só porque a
  operação rodou, preservando "uma alteração efetiva... é atômica com
  `interpretacao_persistida_em`... nunca uma persistência parcial" já fechado;
- **proibição fechada:** nenhuma operação pode alterar `estado_conversa.dados` sem
  avanço correspondente de `versao` — nem esta operação, nem qualquer futura via de
  escrita (`P4` §19, "timestamp nunca é versão", estendido aqui como "toda escrita de
  `dados` sempre acompanhada do avanço correspondente de `versao`, nunca de
  `atualizado_em` isolado");
- **o caminho sem alteração efetiva nunca ignora o CAS:** mesmo quando `dados`
  permanecerá idêntico, a operação valida `versao_esperada` contra a `versao`
  corrente **atomicamente, dentro da mesma transação** que decidiria gravar o
  marcador — nunca por uma leitura solta, antes ou fora da transação de escrita;
  se outro escritor já tiver avançado a `versao` no meio-tempo, a operação **não
  grava** `interpretacao_persistida_em` e devolve conflito de versão, exatamente
  como no caminho com alteração efetiva; `interpretacao_persistida_em` só é gravado
  se, dentro dessa mesma verificação atômica, a `versao` ainda for a esperada;
- a nova `versao` (avançada ou não) é **sempre** parte do retorno — nunca omitida,
  mesmo quando igual à esperada;
- `atualizado_em` **permanece** como carimbo de auditoria (grava o instante da
  operação), mas **deixa de ser** o predicado de CAS — mesma distinção já fechada em
  `P4I.3`/`P4I.5` e na decisão `D2`, ponto 3.

#### 5. Idempotência e replay

- **repetição da mesma chamada:** regra única, a mesma fixada na seção 3
  ("interpretação já persistida") — `interpretacao_persistida_em IS NOT NULL`
  produz sempre reconhecimento idempotente; a operação não reinterpreta, não
  reaplica `alteracoes_aplicaveis`, não recalcula `dados` nem `versao`;
- **uso de `interpretacao_persistida_em`:** preservado sem alteração — gravado uma
  única vez, nunca reescrito, decide entre "aplicar" e "reconhecer já persistida";
  a checagem do marcador **precede** a checagem de `versao_esperada` (mesma ordem
  já fixada na seção 3) — nunca o contrário;
- **distinção entre repetição legítima e conflito:** repetição legítima é
  `interpretacao_persistida_em IS NOT NULL` (reconhecimento idempotente, qualquer
  que seja `versao_esperada` apresentado — seção 3); conflito de versão só existe
  quando o marcador **ainda está nulo** e `versao_esperada` diverge da corrente —
  as duas causas nunca se confundem e nunca são avaliadas na mesma ordem invertida,
  mesma distinção já fechada entre "conflito de valor" e "conflito concorrente";
- **relação com replay da composição:** esta operação **não é** o replay da
  composição (`recuperar_replay`, `implementacao-persistencia-composicao-v1.md`
  §13.7) — replay da composição opera sobre `resultado_id`, não sobre
  `interpretacao_persistida_em`; as duas replays são de camadas diferentes e não se
  substituem; a composição, ao revalidar fatos antes de confirmar (`implementacao-
  persistencia-composicao-v1.md` §11), lê a `versao` já avançada por esta operação,
  nunca a reexecuta;
- **comportamento após queda entre atualização de estado e marcação da
  interpretação:** proibido por construção — a atualização de `dados`/`versao` e a
  gravação de `interpretacao_persistida_em` ocorrem na **mesma transação lógica**
  (item seguinte); uma queda no meio da transação PostgreSQL é revertida
  integralmente pelo próprio banco (rollback automático) — não existe estado
  observável em que `versao` avançou sem `interpretacao_persistida_em` gravado, ou
  vice-versa;
- **exigência de uma única transação:** preservada sem alteração — "rollback integral
  em qualquer falha" (ordem fixa já descrita para a operação atual, passo 7) aplica-se
  integralmente à nova operação.

#### 6. Invalidação de derivados

Usando apenas decisões já aprovadas (nenhum campo novo inventado, nenhuma regra
nova):

- `persistir_checkpoint` já fecha que a invalidação de derivados **é parte da mesma
  transação de persistência**, na ordem: "gravar fatos novos e invalidações de
  derivados" (passo 3) **antes de** "atualizar o estado oficial" (passo 4) e
  "incrementar a versão" (passo 5) — `implementacao-persistencia-composicao-v1.md`
  §13.5; a invalidação **nunca** é um passo posterior, separado ou de
  responsabilidade de outra camada;
- `ITC-29` já fecha, para a composição, que "o único estado que a função propõe para
  persistência... já contém a invalidação aplicada; nenhum resultado intermediário
  expõe a combinação híbrida" — ou seja, **nunca existe um estado observável com
  fatos novos e derivados antigos simultaneamente**, nem por um instante, nem em
  nenhuma camada;
- **aplicado a esta operação, pelo mesmo princípio, sem exceção:** quando a
  interpretação altera fatos em `dados` que já sustentam derivados existentes
  (distinção `fatos_temporais`/`criterio_temporal`, seção "Estado oficial" da spec
  técnica de `P4I`, §7), a operação **persiste atomicamente, na mesma transação**,
  um estado oficial já coerente — alterações autorizadas, invalidações de derivados
  exigidas pelas regras já aprovadas, incremento de `versao` (quando houver
  alteração efetiva) e gravação de `interpretacao_persistida_em` juntos; **nunca**
  fica pendente para uma camada posterior aplicar depois;
- as invalidações a aplicar são exatamente as já fechadas em
  `persistencia-v1.md` §17 e em `P4` §3.A/`P4I` §7 (separação `fatos_temporais`/
  `criterio_temporal`) — esta operação **não inventa** nenhuma regra adicional de
  quais derivados invalidar; ela apenas garante que a invalidação já definida
  acontece dentro da mesma transação que grava os fatos novos, nunca fora dela;
- **consequência para a composição:** ao ler `estado_conversa` depois desta
  operação, a composição encontra sempre um estado já coerente — nunca precisa (nem
  pode) completar uma invalidação que esta operação tenha deixado pendente; a
  detecção de `versao_estado_origem` incompatível (`ITC-40`/`ITC-41`) continua
  sendo o mecanismo pelo qual a composição percebe que o estado mudou, mas a
  invalidação em si já ocorreu antes, dentro desta operação — não depois, na
  composição.

#### 7. Concorrência

- **duas interpretações concorrentes:** mesma proteção já fechada, com predicado
  trocado — a segunda a tentar o CAS com `versao_esperada` desatualizada recebe
  conflito de versão; nenhuma fusão, nenhuma reaplicação automática (mesma regra de
  `INT-16`, predicado novo);
- **interpretação sem alteração efetiva (no-op) concorrente com checkpoint
  (persistência intermediária da composição):** ambas competem pelo mesmo CAS de
  `versao` na mesma linha de `estado_conversa`, mas o resultado **não é
  simetricamente "um vencedor, um perdedor com conflito"** — depende de qual
  operação valida `versao_esperada` primeiro, dentro de sua própria transação:
  - **se o checkpoint vencer primeiro** (avança `versao` antes de a interpretação
    validar a sua): a interpretação no-op, ao validar `versao_esperada` contra a
    `versao` já avançada pelo checkpoint, encontra divergência e recebe conflito de
    versão — não grava `interpretacao_persistida_em`, exatamente como qualquer
    outro conflito de versão (seção 4);
  - **se a interpretação no-op vencer primeiro** (valida `versao_esperada` ainda
    igual à corrente, antes de o checkpoint avançar): ela grava **apenas**
    `interpretacao_persistida_em`, preservando `dados` e `versao` inalterados —
    isso **não bloqueia** o checkpoint; o checkpoint ainda pode prosseguir depois,
    usando a **mesma** `versao_esperada` (que não mudou, porque a interpretação
    no-op não a incrementou), **desde que suas demais precondições continuem
    válidas** (continuação ainda retomável, efeito pendente correspondente, etc.);
  - **portanto:** a serialização por `versao` garante que nenhuma das duas grava
    seu marcador/efeito sobre uma `versao_esperada` já obsoleta, e impede qualquer
    estado parcial observável — mas **não implica conflito obrigatório** quando a
    operação no-op vence primeiro, precisamente porque ela não consome a versão;
  - **nenhuma das duas "recupera" implicitamente o avanço da outra por
    aproximação** — quando há de fato conflito de versão (checkpoint vencendo
    primeiro), a perdedora carrega o avanço oficial e usa replay se houver
    resultado, senão falha fechada, exatamente como já fechado para a composição
    (`P4` §9/§10); esta operação, especificamente, **não define** um caminho de
    recuperação próprio além de devolver o conflito de versão quando ele
    genuinamente ocorre: a decisão de retomar cabe ao chamador, exatamente como
    hoje "carrega o avanço oficial" cabe ao orquestrador, não à função de
    persistência;
- **interpretação concorrente com resultado final (persistência final da
  composição):** mesmo princípio — `persistir_resultado_final` já revalida a versão
  de origem antes de confirmar (`implementacao-persistencia-composicao-v1.md` §11);
  se a interpretação avançar a versão entre a leitura e a confirmação da composição,
  a composição detecta e falha fechado (`conflito_versao`), nunca sobrescrevendo
  silenciosamente;
- **continuação baseada em versão anterior, tornada obsoleta por esta operação:**
  quando esta operação avança `versao` (alteração efetiva de interpretação), uma
  continuação da composição cuja `versao_estado_origem` apontava para a versão
  anterior **não pode continuar sobre o estado antigo** — a única forma de a
  máquina de composição aceitar uma `versao_estado`/`estado_oficial` diferente dos
  já registrados na continuação é a "transição legítima" (`integracao-temporal-
  composicao-v1.md`, oito condições simultâneas), e essa transição é
  **estritamente sobre o reconhecimento da persistência intermediária que a
  própria composição solicitou** (`requisicao_pendente.tipo ===
  'persistir_estado_interpretado'`, condição 7; `resposta_condicional.efeito_id
  === requisicao_pendente.efeito_id`, condição 2) — **nunca** uma via genérica
  para qualquer avanço de versão, e **nunca** aplicável a um avanço de versão
  produzido por uma interpretação concorrente que a composição não pediu. Fora
  dessa transição nomeada — inclusive quando esta operação é a causa do avanço de
  versão — **qualquer** divergência entre a `versao_estado_origem` registrada na
  continuação e a `versao` corrente produz `continuacao_incompativel`, sem
  exceção (`integracao-temporal-composicao-v1.md`, "fora desta exceção fechada...
  qualquer mudança de `estado_oficial`, de `versao_estado` ou de origem entre duas
  chamadas produz `continuacao_incompativel`"); **`ITC-40` não autoriza,
  genericamente, uma continuação a prosseguir sobre uma versão superada** — ela
  cobre apenas o caso nomeado de confirmação de efeito solicitado pela própria
  máquina;
- **qualquer retomada posterior a uma continuação tornada obsoleta** deve usar o
  estado e a `versao` oficiais **atuais**, lidos de novo — nunca os registrados na
  continuação superada — ou, quando a continuação for reapresentada como se ainda
  fosse válida, resultar em `continuacao_incompativel` (fora da transição legítima)
  ou em superação formal da continuação (`P4` §7: continuação `superada`, nunca
  reaberta), conforme as regras já aprovadas — esta operação não introduz um
  terceiro desfecho;
- **trabalhador antigo com claim obsoleto:** preservado sem alteração — "um worker
  com `claim_token` antigo... nunca persiste em `estado_conversa`... garantias
  absolutas" (invariante já fechada, citada acima) continua valendo integralmente
  para esta operação, com o mesmo mecanismo de rotação de token já descrito em
  `adquirir_claim_mensagem` (`P4I` §13.2).

#### 8. Transição

Apenas invariantes — nenhuma migration fechada nesta especificação:

- a escrita atual por `atualizado_em` (`aplicar_interpretacao_condicional`) deve
  **deixar de ser via ativa** antes da ativação da `P4I` — nunca depois, e nunca
  simultaneamente por um período indefinido;
- **nunca podem existir duas autoridades ativas de escrita** sobre
  `estado_conversa.dados` ao mesmo tempo — nem duas funções, nem uma função e uma
  operação P4I coexistindo como caminhos igualmente ativos;
- a existência de consumidores externos de `aplicar_interpretacao_condicional` (fora
  deste repositório) deve ser verificada antes do corte operacional — a ausência de
  consumidor **no repositório**, confirmada por busca no código-fonte deste
  repositório, não substitui essa verificação; consumidor externo **permanece
  indeterminado** — nenhuma busca de código local prova nem descarta sua
  existência;
- a remoção física da função e do adaptador atuais, a ordem, a quantidade e o
  agrupamento das migrations que executarão esta transição **permanecem adiados**, a
  decidir em especificação técnica posterior — mesma disciplina já aplicada à
  transição de `reivindicar_mensagem` (`D1`).

#### 9. Testes obrigatórios

Cenários mínimos, catalogados como `INT-P4I-01` a `INT-P4I-14` — prefixo novo, não
reutiliza `INT-*` (Etapa 6/7 por `atualizado_em`), `P4T-*`/`P4IT-*` (persistência
física da composição), `ITC-*` (integração temporal/composição), `COMP-*`, `DED-*` ou
`TMP-*`. Todos **documentais e futuros — nenhum executável nesta rodada, nenhum
somado à suíte oficial** (permanece 730/725/5/0):

| ID | Cenário | Resultado esperado |
|---|---|---|
| `INT-P4I-01` | CAS com duas transações concorrentes disputando a mesma `versao_esperada` | Exatamente uma persiste; a outra recebe conflito de versão; nenhuma fusão |
| `INT-P4I-02` | Alteração efetiva sobre estado válido, com derivados dependentes de fatos alterados (`fatos_temporais` que sustentam um `criterio_temporal` já calculado) | `dados`, invalidação dos derivados e `versao` avançam juntos, na mesma transação; `interpretacao_persistida_em` preenchido junto; nenhum estado observável com fatos novos e derivado antigo simultâneos (`ITC-29`) |
| `INT-P4I-03` | Interpretação sem alteração efetiva (saída vazia, idempotente ou só conflito), concorrente com um checkpoint de composição (`persistir_checkpoint`) disputando a mesma `versao_esperada` — **dois sub-casos, cada um com desfecho próprio, nunca fundidos**: (a) o checkpoint valida `versao_esperada` primeiro e avança `versao`; (b) a interpretação no-op valida `versao_esperada` primeiro, antes do checkpoint | (a) a interpretação no-op, ao validar depois, encontra `versao` já avançada e recebe conflito de versão — não grava `interpretacao_persistida_em`; (b) a interpretação no-op grava **apenas** `interpretacao_persistida_em`, sem alterar `dados` nem `versao` — o checkpoint **não é bloqueado** e ainda prossegue depois sobre a mesma `versao_esperada` (inalterada), desde que suas demais precondições continuem válidas; em nenhum dos dois sub-casos há gravação de marcador ou efeito sobre `versao_esperada` já obsoleta, nem estado parcial observável; o sub-caso (b) **não é conflito** |
| `INT-P4I-04` | `interpretacao_persistida_em` já preenchido, chamada repetida com `versao_esperada` divergente da corrente | Reconhecimento idempotente (marcador precede a checagem de versão); nenhum conflito de versão relatado; nenhuma reaplicação; nenhuma nova chamada ao modelo — precedência do marcador sobre a versão, sem exceção |
| `INT-P4I-05` | `versao_esperada` divergente da `versao` corrente, com marcador ainda nulo | Conflito de versão; nenhuma alteração aplicada; nenhuma reaplicação automática |
| `INT-P4I-06` | `claim_token` não corresponde ao vigente | `autorizacao_invalida`; nenhuma alteração; rollback integral |
| `INT-P4I-07` | `lease_expira_em` não vigente no momento da operação | `autorizacao_invalida`; nenhuma alteração; rollback integral |
| `INT-P4I-08` | Falha injetada entre o avanço de `versao` e a gravação de `interpretacao_persistida_em` | Rollback integral pelo próprio banco; nenhum estado observável com um gravado e o outro não |
| `INT-P4I-09` | Continuação de composição com `versao_estado_origem` tornada obsoleta por uma interpretação concorrente (fora da transição legítima, sem `requisicao_pendente.tipo = 'persistir_estado_interpretado'` correspondente) | `continuacao_incompativel`; a continuação não prossegue sobre o estado antigo; retomada exige ler `estado_oficial`/`versao` atuais ou resulta em superação, nunca em reconciliação por `ITC-40` fora do caso nomeado |
| `INT-P4I-10` | Interpretação concorrente com persistência final da composição (`persistir_resultado_final`) sobre a mesma linha | Revalidação da composição detecta a divergência; `conflito_versao`; nenhuma confirmação sobre versão antiga |
| `INT-P4I-11` | Duas clínicas, mesma estrutura de conversa | Isolamento multiclínica preservado; nenhum cruzamento; `referencia_cruzada_clinica` quando aplicável |
| `INT-P4I-12` | Tentativa de alteração fora da allowlist canônica de campos/ações (mesmo contrato de `AlteracoesDados`, nenhum catálogo alternativo) | Rejeitada integralmente por qualquer camada de enforcement (Core e/ou banco); nenhuma aplicação parcial; nenhuma camada aceita campo/ação fora do contrato único (mesma regra de `INT-05`/`INT-06`/`INT-08`) |
| `INT-P4I-13` | Chamada de escrita por CAS de `atualizado_em` (`aplicar_interpretacao_condicional`) tentada após a ativação da `P4I` | Escrita por `atualizado_em` impedida — a função legada não é mais via ativa (`D2`, "Transição") |
| `INT-P4I-14` | Chamada com `versao_contrato_dados` desconhecida, ausente quando exigida, ou divergente da vigente | `registro_corrompido`; nunca interpretação por aproximação nem uso parcial (`P4I` §17); nenhuma alteração aplicada |

#### 10. Limites

- **nenhuma IA executa esta operação** — a IA produz `alteracoes_aplicaveis`; quem
  chama a operação de persistência é sempre o Core/orquestrador, nunca o modelo
  (`../docs/02-arquitetura.md`, herdado sem alteração);
- **o Core/orquestrador chama a operação** — nunca a Edge Function ou o adaptador
  decidem por conta própria quando persistir; a chamada segue o mesmo fluxo já
  aprovado (claim → interpretar → persistir → concluir);
- **nenhuma leitura externa ocorre dentro dela** — nenhuma chamada a Google Calendar,
  n8n, Evolution, painel ou qualquer serviço fora da própria transação PostgreSQL;
- **nenhuma composição é executada dentro dela** — nenhum resolvedor (procedimento,
  dentista, duração, disponibilidade, temporal) é chamado por esta operação;
- **nenhuma migration ou implementação é autorizada por esta especificação** — o nome
  SQL definitivo, a assinatura completa e a estratégia de transição permanecem em
  aberto até aprovação própria, posterior a este documento.

### Conclusão condicional

Um único `UPDATE` PostgREST condicional em `mensagens_recebidas` — sem RPC dedicada.

Exigir: `id = mensagem_recebida_id`; `clinica_id` correspondente à clínica
autenticada; `status_processamento = 'processando'`; `claim_token` correspondente;
`interpretacao_persistida_em IS NOT NULL`.

Atualizar: `status_processamento = 'concluida'`; `concluido_em` = timestamp UTC
gerado pelo runtime servidor da Edge Function imediatamente antes deste `UPDATE`
(ver definição completa após "Finalização de falha anterior à persistência").

Não exigir lease vigente na conclusão. Justificativa: o envio pode terminar depois da
expiração do lease; exigir lease poderia impedir a conclusão de uma mensagem já
enviada; o token vigente continua impedindo o worker antigo depois de um reclaim.

Resultados mínimos: `concluida`; `autorizacao_invalida`. Erro técnico permanece
separado.

### Finalização de falha anterior à persistência

Aplicável quando ocorrer, antes de `interpretacao_persistida_em` ser preenchido:

- timeout;
- erro HTTP;
- saída inválida;
- entrada acima do limite;
- indisponibilidade do adaptador;
- falha de persistência;
- outro erro técnico tratado pelo Core.

Fluxo:

1. produzir a resposta fixa já aprovada;
2. revalidar `claim_token`, status `processando` e lease vigente antes do envio;
3. enviar a resposta fixa;
4. somente após envio bem-sucedido, executar o `UPDATE` condicional para `falhou`;
5. não alterar `estado_conversa`;
6. não preencher `interpretacao_persistida_em`;
7. não reinterpretar automaticamente essa mensagem.

Resposta fixa, exatamente:

> "Não consegui processar sua mensagem agora. Pode tentar novamente?"

Uma falha conhecida e respondida não permanece `processando`. A mensagem **não** usa
o `UPDATE` de `concluida`, pois o marcador permanece `null`. Como `falhou` é
`nao_elegivel` na reivindicação, nenhuma nova interpretação automática ocorre depois
disso. Quem grava `falhou`: o Core/Edge Function, por `UPDATE` PostgREST condicional —
**não é necessária uma nova RPC**.

**Contrato mínimo para `falhou`** — segundo `UPDATE` PostgREST condicional em
`mensagens_recebidas`, sem RPC dedicada:

Condições: `id = mensagem_recebida_id`; `clinica_id` correspondente à clínica
autenticada; `status_processamento = 'processando'`; `claim_token` do worker;
`interpretacao_persistida_em IS NULL`.

Atualizações: `status_processamento = 'falhou'`; `concluido_em` = timestamp UTC
gerado pelo runtime servidor da Edge Function imediatamente antes deste `UPDATE`.

Não exigir lease vigente. Justificativa: o envio da resposta fixa pode terminar depois
da expiração do lease; o `claim_token` impede um worker antigo de finalizar depois de
reclaim; `interpretacao_persistida_em IS NULL` separa falha anterior à persistência do
Caminho B posterior à persistência (ver "Conclusão condicional").

Resultados mínimos: `falhou`; `autorizacao_invalida`. Erro técnico permanece exceção
controlada.

**Erro no envio da resposta fixa** — se o envio falhar: não marcar `falhou`; não
marcar `concluida`; manter status `processando`; a mensagem poderá ser recuperada
depois da expiração do lease; não afirmar que a falha foi tratada com sucesso. Essa
limitação pertence à pendência de transporte ainda não idempotente/outbox já
registrada (ver "Deduplicação e lease"). Nenhum status novo é criado.

`concluido_em` é o timestamp terminal em UTC, usado tanto para sucesso
(`concluida`) quanto para falha (`falhou`) — não é necessária uma coluna
`falhou_em` separada. Decisão aprovada: é produzido pelo runtime servidor da
Edge Function, calculado imediatamente antes do `UPDATE` PostgREST
correspondente — nunca vem do paciente, da IA ou de qualquer payload externo.
Não é criada RPC, trigger ou função PostgreSQL apenas para obter esse
timestamp.

### Distinção dos caminhos terminais

**Sucesso normal**: marcador preenchido; resposta enviada; `UPDATE` condicional para
`concluida`.

**Recuperação posterior ao marcador**: marcador preenchido; resposta fixa enviada;
`UPDATE` condicional para `concluida`.

**Falha tratada antes do marcador**: marcador `null`; resposta fixa enviada; `UPDATE`
condicional para `falhou`.

**Worker abandonado ou erro de envio**: permanece `processando`; não finaliza; poderá
ser recuperado após o lease.

### Multiclínica

- `clinica_id` deriva exclusivamente da instância WhatsApp autenticada;
- a RPC de reivindicação valida `provider + instancia_whatsapp + message_id +
  clinica_id + telefone_normalizado`;
- a persistência valida mensagem e conversa com o mesmo `clinica_id` e telefone;
- a conclusão valida `mensagem_recebida_id + clinica_id`;
- nenhuma operação confia em `clinica_id` vindo da IA ou do paciente;
- uma mensagem nunca pode alterar estado de outra clínica.

### Compatibilidade e rollback

- Colunas novas são `nullable`; a migration deve funcionar mesmo com linhas antigas;
  ausência de backfill obrigatório; nenhuma constraint nova nesta primeira
  implantação.
- Rollback exige primeiro interromper consumidores da versão nova; depois remover
  funções e grants; e somente então as três colunas.
- Não presumir que o rollback é seguro enquanto consumidores novos estiverem ativos.

## Política de tentativas

- Retry técnico interno do adaptador (`criarClienteModeloOpenAI`, já aprovado) permanece
  permitido; continua pertencendo à mesma tentativa do worker e não representa uma nova
  aplicação da interpretação.
- Depois que `interpretacao_persistida_em` estiver preenchido para um `message_id`,
  qualquer nova chamada ao modelo para esse `message_id` é **proibida** (ver
  "Deduplicação e lease" → "Reclaim e `interpretacao_persistida_em`").
- Um reclaim anterior à persistência (`interpretacao_persistida_em IS NULL`) pode
  executar a interpretação — inclusive chamando o modelo novamente, se um worker
  anterior também não chegou a persistir.
- **Não há garantia** de exatamente uma chamada ao modelo antes da persistência: um
  worker pode cair depois de receber a saída do modelo e antes da transação de
  persistência; enquanto `interpretacao_persistida_em` permanecer `null`, um reclaim
  subsequente chamará o modelo novamente.
- A garantia obrigatória é: zero segunda chamada ao modelo depois que a interpretação
  foi persistida; zero segunda persistência da interpretação por `message_id`.
- Reaplicação da interpretação sobre uma versão nova é **proibida** (conflito
  concorrente).
- Somente uma interpretação pode ser persistida por `message_id`.
- Recuperação de processamento abandonado só é permitida após o lease expirar.
- Uma nova mensagem do paciente sempre gera um novo `message_id` — não há "reenvio" do
  mesmo `message_id` do lado do paciente.

## Entrada e PII

Contrato de entrada enviado ao modelo:

```ts
interface EntradaInterpretacaoModelo {
  mensagens_atuais: string[];

  dados_atuais: Partial<Record<
    | 'intencao'
    | 'procedimento_texto'
    | 'dentista_texto'
    | 'data_texto'
    | 'periodo'
    | 'horario_texto',
    string
  >>;

  campos_cadastrais_preenchidos: Array<
    'nome' | 'cpf' | 'data_nascimento' | 'email'
  >;

  pendente: 'nenhum' | 'opcao' | 'confirmacao_resumo';
}
```

Regras:

- `mensagens_atuais` contém somente a mensagem atual ou mensagens agrupadas na mesma
  janela de debounce do transporte;
- preservar ordem cronológica;
- ~~nunca enviar histórico textual de turnos anteriores~~ — **SUPERADO em 2026-08-07**
  por `specs/historico-conversacional-v1.md`: o campo opcional `historico_recente`
  (até 10 pares `{mensagem_paciente, resposta_iris, gerada_em}`, texto de conversa **sem
  sanitização** — ver spec seção 0.1) passa a atravessar para a interpretadora, separado
  de `mensagens_atuais`. Motivo: evidência real do WhatsApp mostrou um "Sim" isolado
  classificado como `nao_compreendida` por falta de contexto. Item de agenda: revisar
  minimização desses dados quando o fluxo de cadastro completo existir (mesma spec,
  seção 11) — não é pré-condição de funcionamento hoje;
- não enviar ao modelo valores cadastrais antigos — enviar somente **quais** campos
  cadastrais já estão preenchidos (`campos_cadastrais_preenchidos`), nunca os valores em
  si;
- o paciente pode informar novo nome, CPF, nascimento ou e-mail na mensagem atual; o Core
  compara a nova interpretação contra o valor oficial mantido no servidor;
- `pendente` é derivado exclusivamente pelo Core a partir do estado oficial e serve
  somente para orientar a interpretação de sinais de aceitação ou confirmação; não
  representa o estado completo, não autoriza transição e não vem do paciente;
- ficam fora do payload do modelo, sempre: `clinica_id`, telefone, IDs, agenda,
  disponibilidade, credenciais e registros clínicos; também ficam fora o estado
  completo, versões internas, IDs de opção/resumo e catálogo de procedimentos.

O contrato canônico dos sinais conversacionais, incluindo a separação estrutural entre
`EventoCandidatoIA` e `DecisaoControlador`, está em `eventos-conversacionais-v1.md`.

**Atualizado em 2026-08-09:** a integração começou, em fatia mínima. A saída estruturada
passa a conter **três** campos raiz — `natureza_mensagem`, `alteracoes` e
`eventos_candidatos` — e não os dois previstos aqui (`natureza_mensagem` veio depois desta
nota, em `interpretacao-natureza-mensagem-v1.md`). De `eventos_candidatos`, apenas
`aceitar_opcao` é emitido; os outros quatro eventos e todo o `DecisaoControlador`
permanecem não implementados. Ver `contexto-pendente-interpretacao-v1.md` §11 e o bloco de
revisão no topo de `eventos-conversacionais-v1.md`.

### Fatos temporais estruturados — contrato V2 futuro

Registro documental, **sem alteração de código nesta rodada**: o resolvedor temporal
está **publicado e implementado** (`resolvedor-temporal-v1.md`,
`src/core/resolver-temporal.ts`), mas a interpretação ainda produz somente o contrato
atual — `SaidaInterpretacaoModeloV1`, com `data_texto`/`horario_texto` como texto livre
(`CampoDadosConversa`, `src/core/tipos.ts`, já publicado). Este é o **contrato
vigente hoje**; nada neste registro o altera.

Uma implementação futura poderá fazer a interpretação produzir uma versão de saída
distinta — `SaidaInterpretacaoModeloV2` —, com `alteracoes_temporais` categorizadas
(`data`, `horario_exato`, `periodo`, `restricao`, `intencao_temporal`) em vez de texto
livre. O contrato completo de `alteracoes_temporais`, sua aplicação sobre o estado
acumulado entre mensagens, e a chamada ao resolvedor temporal já publicado, estão
especificados — **não implementados** — em `integracao-temporal-composicao-v1.md`;
este registro não duplica aquele contrato, apenas aponta para ele.

**Corte único, decisão fechada** (`integracao-temporal-composicao-v1.md`, decisão
`P2`): a versão do contrato determina qual caminho está ativo. Enquanto V1 for o
contrato vigente, `data_texto`/`horario_texto` permanecem a única fonte temporal, e o
resolvedor temporal **não é chamado** pela interpretação nem pelo controlador. Quando
V2 estiver implementada, `data_texto`/`horario_texto` deixam de participar da
resolução temporal — nunca coexistindo com `alteracoes_temporais` como segunda
autoridade, nunca convertidos silenciosamente em átomos, nunca em modo híbrido. A
migração de V1 para V2 é decisão de implementação e implantação, nunca uma escolha
feita mensagem a mensagem.

`data_texto` e `horario_texto` **não são removidos nem descontinuados por este
registro** — permanecem o contrato vigente até que a migração para V2 seja
implementada e aprovada, com análise explícita de compatibilidade com
`interpretacao-tipos.ts`, `interpretacao-extrator.ts` e os cenários INT-01 a INT-19
(`tests/cenarios-obrigatorios.md`) já automatizados sobre o formato atual.

Preservado, sem exceção, para qualquer formato de saída temporal, atual ou futuro
(`../docs/02-arquitetura.md`):

- a IA relata fatos da mensagem atual, nunca de turnos anteriores;
- a IA não calcula nem produz data civil oficial nem minuto local oficial;
- a IA não lê relógio nem tem acesso a `instante_atual`;
- a IA não conhece o fuso oficial da clínica;
- a IA não classifica passado — essa decisão é exclusiva do resolvedor temporal
  (`resolvedor-temporal-v1.md` §16) sobre o fato já estruturado;
- a IA não escolhe o modo final de disponibilidade (`grade`/`proximo_disponivel`/
  `horario_exato`) nem produz `ResultadoDisponibilidade`;
- a IA não decide transição de estado nem produz `DecisaoControlador`.

### Divergência conhecida no código — bloqueadora antes de tráfego real

Registrada em revisão documental, **não corrigida**: o código atual monta `dados_atuais`
a partir do snapshot oficial inteiro, o que inclui os valores de `nome`, `cpf`,
`data_nascimento` e `email` quando já preenchidos. O contrato acima permite somente a
indicação de **quais** campos cadastrais estão preenchidos
(`campos_cadastrais_preenchidos`), nunca os valores.

A correção deverá abranger `src/core/interpretacao-tipos.ts`,
`src/core/interpretacao-extrator.ts` e `src/core/interpretar-e-aplicar.ts`.

**Nenhuma mensagem real pode usar esse caminho antes da correção e da revisão
correspondente.** Esta é uma pendência bloqueadora, não um detalhe de implementação.

### Limites

**Debounce — decidido.** O valor canônico da v1 é **exatamente 3 segundos**, conforme
`novo-agendamento.md` §17. Não é estimativa, não está pendente, e não depende da futura
especificação de transporte: essa especificação deverá **implementar** o debounce
canônico de 3 segundos, não redefini-lo.

A espera é reiniciada a cada nova mensagem da mesma conversa; o turno é processado
quando nenhuma mensagem nova chegar durante 3 segundos; mensagens dentro da janela
pertencem ao mesmo turno; mensagens posteriores iniciam um novo turno. Deduplicação e
claim permanecem mecanismos separados do debounce.

**Ainda pendentes** — e nenhum deles pode alterar o debounce de 3 segundos sem uma nova
decisão canônica:

- tamanho máximo da janela;
- quantidade máxima de mensagens por turno;
- limites de payload;
- contrato da entrada autenticada e da integração com o transporte;
- envio idempotente ou padrão outbox;
- política de resposta.

Esses itens pertencem à futura especificação de transporte/Edge Function, ainda não
escrita.

### Pendências para uso com pacientes reais

Não resolvidas nesta especificação — não tratar como decididas:

- base legal;
- retenção;
- contrato e condições do provedor.

## Falhas e mensagens duplicadas

Resposta fixa, aplicada uniformemente a todos os cenários de falha abaixo:

> "Não consegui processar sua mensagem agora. Pode tentar novamente?"

Cenários cobertos por essa resposta fixa:

- timeout;
- erro HTTP;
- saída inválida;
- conflito concorrente;
- entrada acima do limite;
- falha de persistência;
- indisponibilidade do adaptador.

Mensagem duplicada (mesmo `message_id`, já `concluida` ou ainda `processando` com lease
válido):

- não chama o modelo;
- não gera nova resposta;
- não altera estado.

Nenhuma falha pode produzir:

- aplicação parcial;
- fallback silencioso;
- interpretação por texto livre.

Quanto a uma nova chamada ao modelo para o mesmo `message_id` depois de uma falha, a
regra precisa (ver "Política de tentativas") é:

- falha ocorrida antes da persistência do marcador (`interpretacao_persistida_em IS
  NULL`): após expiração do lease, um reclaim pode chamar o modelo novamente;
- falha ocorrida depois da persistência do marcador (`interpretacao_persistida_em IS
  NOT NULL`) — inclusive quando o resultado persistido é vazio, idempotente ou
  somente conflitante: nenhuma nova chamada ao modelo é permitida, e nenhuma segunda
  persistência da interpretação é permitida.

## Fluxo final aprovado

### Prefixo comum

1. validar envelope do transporte;
2. resolver clínica pela instância autenticada;
3. inserir ou reivindicar (`claim`/`reclaim`) em `mensagens_recebidas`;
4. encerrar silenciosamente se duplicada não elegível (já `concluida`, ou `processando`
   com lease válido);
5. verificar `interpretacao_persistida_em` da linha reivindicada — bifurca para o
   Caminho A (`null`) ou o Caminho B (não `null`).

### Caminho A — `interpretacao_persistida_em IS NULL` (processamento normal)

6. identificar paciente e conversa;
7. carregar `dados` e `atualizado_em` (o snapshot);
8. construir a entrada minimizada (`EntradaInterpretacaoModelo`);
9. criar o cliente OpenAI (`criarClienteModeloOpenAI`);
10. executar `extrairAlteracoes`;
11. validar integralmente a saída;
12. executar `preAplicar` (`alteracoes_aplicaveis` e `conflitos` — os conflitos ficam
    em memória, ver "Conflitos" → "Conflitos durante o processamento normal");
13. executar `aplicarInterpretacaoCondicional`, que revalida atomicamente
    `claim_token`, status `processando`, lease vigente, `atualizado_em` do snapshot
    **e** `interpretacao_persistida_em IS NULL`, **na mesma transação** que aplica em
    `estado_conversa` as `alteracoes_aplicaveis` — quando existirem — e grava
    `interpretacao_persistida_em = now()` (contrato atômico completo registrado em
    "Concorrência"); se o claim estiver inválido, nada é persistido; se
    `atualizado_em` mudou, nada é persistido; se `interpretacao_persistida_em` já não
    for mais `null`, nada é persistido;
14. executar o controlador determinístico, usando o estado oficial persistido no
    passo 13 e os conflitos mantidos em memória desde o passo 12; o controlador decide
    a pergunta de esclarecimento quando houver conflito;
15. revalidar `claim_token`, status `processando` e lease vigente, antes de produzir a
    resposta;
16. produzir a resposta por template determinístico (ou, futuramente, pela porta de
    redação natural).

Somente após sucesso do passo 13 o fluxo segue para o passo 14. Uma interpretação sem
alteração efetiva em `estado_conversa.dados` (saída vazia, idempotente, ou somente
conflitos) ainda conta como sucesso do passo 13, desde que `interpretacao_persistida_em`
tenha sido gravado (ver "Concorrência" → "Casos sem alteração de estado") — isso não é
persistência parcial nem impede seguir para o controlador.

Depois do passo 16, o Caminho A segue para o sufixo comum a partir do passo 17.

### Caminho B — `interpretacao_persistida_em IS NOT NULL` (recuperação segura após falha)

Uma queda ocorrida depois da persistência (marcador já preenchido) não tenta
reconstruir a interpretação anterior (ver "Deduplicação e lease" → "Reclaim e
`interpretacao_persistida_em`"): o worker recuperado não chama o modelo, não executa
`extrairAlteracoes`, não valida nova saída, não executa `preAplicar`, não reaplica
alterações, não tenta reconstruir conflitos transitórios, não executa o controlador
determinístico normal (passo 14), e não combina resultado antigo com o estado mais
recente.

O Caminho B pula diretamente para o sufixo comum a partir do passo 17, levando como
resposta somente o texto fixo de falha (ver "Falhas e mensagens duplicadas") — nunca
o resultado do passo 16.

### Sufixo comum

17. revalidar `claim_token`, status `processando` e lease vigente, antes do envio;
18. entregar a resposta pelo transporte (a resposta do Caminho A, ou a resposta fixa de
    falha do Caminho B);
19. revalidar `claim_token` vigente e marcar `concluida` condicionalmente ao token — a
    transição final exige `status_processamento = 'processando'` **e** `claim_token`
    igual ao token vigente do worker;
20. nunca repetir automaticamente o mesmo `message_id`.

A revalidação do passo 13 é **atômica e transacional** — parte da mesma operação que
persiste em `estado_conversa` e `interpretacao_persistida_em` (ver "Concorrência"); não
é uma consulta de revalidação separada da escrita. Essa é uma garantia absoluta.

Os passos 15 (só Caminho A) e 17 (Caminho A e Caminho B) são **gates operacionais**, não
operações atômicas: o gate autoriza prosseguir com base no estado do claim observado
naquele instante, mas não bloqueia atomicamente uma mudança de claim ocorrida
imediatamente depois — se o claim não pertence mais ao processamento atual (expirado ou
reivindicado por outro worker) no momento do gate, a etapa correspondente (produção ou
envio) não é executada; mas não há garantia absoluta de que um worker que perde o claim
entre o gate e a ação seguinte deixe de produzir ou de enviar. Essa corrida externa
pertence à pendência de transporte já registrada (idempotência do transporte ou outbox
transacional — ver "Deduplicação e lease").

O passo 19 (revalidar `claim_token` vigente e marcar `concluida`) é uma garantia
**absoluta**, para ambos os caminhos: a transição exige `status_processamento =
'processando'` **e** `claim_token` igual ao token vigente do worker, verificados na
mesma operação condicional que grava `concluida` — um worker com token antigo nunca
marca `concluida`. Depois que essa transição ocorre, nenhuma validação subsequente
exige `status_processamento = 'processando'`.

O envio pelo transporte (passo 18) não é, e não deve ser tratado como, transacional com
o banco.

## Invariantes

- A IA nunca decide o próximo passo, nunca acessa banco, calendário, credenciais ou
  ferramentas (herdado de `../docs/02-arquitetura.md`).
- `criarClienteModeloOpenAI` sempre usa `text.format.type = 'json_schema'` e
  `strict = true` (ver "Cláusula registrada").
- `aplicarDados` mantém seu comportamento atual (com retry) para todos os consumidores
  fora desta integração — não é alterado por esta especificação.
- `aplicarInterpretacaoCondicional` faz no máximo uma tentativa de persistência; nunca
  relê e reaplica; nunca chama o modelo de novo em caso de conflito concorrente.
- `aplicarInterpretacaoCondicional` executa a validação do claim e a persistência em
  `estado_conversa` como uma única operação transacional; nenhuma alteração em
  `estado_conversa` ocorre sem claim e versão validados na mesma transação.
- Uma consulta de revalidação separada (fora da transação de persistência) nunca
  autoriza, por si só, a persistência.
- Um reclaim ocorrido antes da operação atômica impede o worker antigo de gravar em
  `estado_conversa`.
- Falha em qualquer condição da operação atômica (claim, status, lease ou versão)
  desfaz integralmente a operação — nunca parcialmente.
- Somente o estado efetivamente retornado pela operação transacional é considerado
  persistido.
- Uma alteração efetiva em `estado_conversa`, quando existe, é atômica com
  `interpretacao_persistida_em` — as duas ocorrem juntas na mesma transação, ou
  nenhuma ocorre.
- Uma interpretação válida pode ser persistida **sem** alteração em
  `estado_conversa.dados` (saída vazia, alteração idempotente, ou interpretação
  composta somente por conflitos); nesse caso, o estado permanecer inalterado é uma
  decisão válida, não uma persistência parcial, desde que `interpretacao_persistida_em`
  seja gravado.
- Conflitos calculados por `preAplicar` existem somente em memória, no worker do
  processamento normal; não são persistidos para recuperação posterior — uma queda
  ocorrida depois da persistência não tenta reconstruí-los (ver "Limitação aceita").
- Somente uma persistência de interpretação existe por `message_id`: a condição
  `interpretacao_persistida_em IS NULL` garante isso na mesma transação da
  persistência.
- `interpretacao_persistida_em` preenchido proíbe qualquer nova chamada ao modelo para
  esse `message_id` — mesmo quando o estado não mudou (resultado vazio, idempotente ou
  somente conflitante) — proíbe nova execução de `preAplicar`, e proíbe nova
  persistência.
- Um reclaim anterior à persistência (`interpretacao_persistida_em IS NULL`) pode
  interpretar — inclusive chamando o modelo novamente, se uma tentativa anterior também
  não persistiu; não há garantia de exatamente uma chamada ao modelo antes da
  persistência (ver "Política de tentativas").
- Um reclaim posterior à persistência (`interpretacao_persistida_em IS NOT NULL`) não
  tenta reconstruir a interpretação nem combinar resultado antigo com o estado mais
  recente — produz somente a resposta fixa de falha e segue para a conclusão
  condicional ao claim vigente, sem executar o controlador normal (ver "Fluxo final
  aprovado" → Caminho B).
- Conflito de valor e conflito concorrente nunca se confundem: o primeiro é decidido pelo
  controlador por campo; o segundo invalida a interpretação inteira.
- `corrigir` e `remover` só são válidos quando a versão (`atualizado_em`) não mudou entre
  o snapshot e a tentativa de escrita.
- Depois que `interpretacao_persistida_em` é gravado para um `message_id`, nenhuma
  interpretação adicional é persistida para esse `message_id`; antes disso, um reclaim
  pode chamar o modelo mais de uma vez (ver acima) sem violar essa garantia.
- Nenhuma interpretação é reaplicada sobre uma versão diferente daquela para a qual foi
  calculada.
- Um worker com `claim_token` antigo (expirado ou substituído) nunca persiste em
  `estado_conversa` nem marca `concluida` — ambas são **garantias absolutas**. A
  transição para `concluida` exige `status_processamento = 'processando'` **e**
  `claim_token` igual ao token vigente do worker, verificados na mesma operação
  condicional que grava `concluida`; depois dessa transição, nenhuma validação
  subsequente do fluxo exige `status_processamento = 'processando'`.
- Um claim inválido detectado no gate antes da produção da resposta bloqueia a
  produção; um claim inválido detectado no gate antes do envio bloqueia o início do
  envio. Essas são **garantias condicionais** dos gates, não atômicas: reduzem o risco,
  mas o claim pode mudar depois do gate e antes da ação seguinte, e essa corrida não
  pode ser impedida apenas pelo gate — impedi-la de forma absoluta depende futuramente
  de transporte idempotente ou de um padrão outbox transacional.
- `concluida` e `processando` (com lease válido) nunca disparam novo processamento nem
  nova resposta.
- `falhou` nunca é reinterpretada automaticamente.
- Nenhum dado cadastral antigo (valor) é enviado ao modelo — só quais campos já estão
  preenchidos.
- `clinica_id`, telefone, IDs, agenda, disponibilidade, credenciais e registros clínicos
  nunca entram no payload do modelo.
- Toda falha coberta pela resposta fixa produz exatamente essa resposta — nunca
  aplicação parcial, fallback silencioso, ou interpretação por texto livre. Quanto a
  uma nova chamada ao modelo para o mesmo `message_id` depois de uma falha: permitida
  por reclaim enquanto `interpretacao_persistida_em` for `null`; proibida, junto com
  qualquer nova persistência, a partir do momento em que o marcador é gravado (ver
  "Política de tentativas").

## Testes obrigatórios

Cenários que a implementação desta especificação deve comprovar (nenhum implementado
nesta rodada):

### `aplicarInterpretacaoCondicional`

- persistência bem-sucedida quando `atualizado_em` não mudou;
- `conflito_concorrente` devolvido, sem nenhuma alteração aplicada, quando `atualizado_em`
  mudou;
- nenhuma releitura nem reaplicação automática após `conflito_concorrente`;
- nenhuma nova chamada ao modelo após `conflito_concorrente`;
- exatamente uma tentativa de persistência (sem o retry de `aplicarDados`);
- condição de escrita usa `id = snapshot.conversa_id` + `clinica_id` +
  `telefone_normalizado` + `atualizado_em` simultaneamente (ver mapeamento
  `conversa_id` → `id` em "Concorrência");
- `aplicarDados` (fora desta função) continua com seu comportamento e retry atuais,
  inalterado.

### Casos sem alteração de estado

- alteração efetiva: `estado_conversa` e `interpretacao_persistida_em` são persistidos
  atomicamente na mesma transação;
- saída vazia: `estado_conversa.dados` fica inalterado e `interpretacao_persistida_em`
  é preenchido;
- alteração idempotente: `estado_conversa.dados` pode permanecer igual e
  `interpretacao_persistida_em` é preenchido;
- somente conflito: `estado_conversa.dados` pode permanecer igual,
  `interpretacao_persistida_em` é preenchido, e o conflito é tratado em memória no
  processamento atual (não persistido);
- resultado misto: as `alteracoes_aplicaveis` são persistidas e os conflitos
  remanescentes permanecem em memória.

### Contrato atômico (claim + persistência)

Cenários obrigatórios sobre a atomicidade de `aplicarInterpretacaoCondicional` — cada
um preserva sua asserção específica, sem fusão com outro cenário:

1. reclaim ocorre entre uma eventual pré-verificação e a persistência: o worker antigo
   não grava;
2. `claim_token` muda antes da operação transacional: nenhuma alteração é aplicada;
3. lease expira antes da operação transacional: nenhuma alteração é aplicada;
4. `atualizado_em` muda antes da operação: nenhuma alteração é aplicada;
5. claim válido e versão válida: exatamente uma persistência ocorre;
6. claim válido com versão inválida: rollback integral;
7. versão válida com claim inválido: rollback integral;
8. nenhuma chamada separada de revalidação é tratada como garantia suficiente.

### Reclaim e `interpretacao_persistida_em`

Cenários obrigatórios sobre a distinção, durante um reclaim, entre interpretação ainda
não persistida e já persistida — cada um preserva sua asserção específica, sem fusão
com outro cenário:

1. crash antes da chamada ao modelo: após expiração do lease, o reclaim pode
   interpretar;
2. crash depois da chamada ao modelo, mas antes da persistência: como o marcador ainda
   está `null`, o reclaim pode interpretar novamente; nenhuma interpretação anterior foi
   persistida;
3. crash depois da persistência e antes da produção: reclaim não chama o modelo, não
   executa `preAplicar`, não reaplica alterações;
4. crash depois da persistência e antes do envio: mesma garantia do item 3;
5. crash depois do envio e antes de `concluida`: reclaim não chama o modelo e não
   reaplica alterações; o risco de novo envio continua pertencendo à pendência de
   transporte idempotente/outbox;
6. `interpretacao_persistida_em` preenchido: zero segunda chamada ao modelo;
7. `interpretacao_persistida_em` preenchido: zero segunda execução de `preAplicar`;
8. `interpretacao_persistida_em` preenchido: zero segunda persistência em
   `estado_conversa`;
9. dois workers tentam a primeira persistência: somente um consegue gravar
   `estado_conversa` e o marcador;
10. falha na alteração de `estado_conversa`: marcador não é gravado;
11. falha ao gravar o marcador: alteração em `estado_conversa` sofre rollback;
12. worker com `claim_token` antigo em reclaim posterior à persistência: não persiste e
    não marca `concluida` (garantia absoluta);
13. reclaim posterior à persistência: produz somente a resposta fixa de falha, sem
    executar o controlador, sem reaplicar alterações e sem tentar reconstruir os
    conflitos daquele processamento;
14. gate inválido antes do envio durante o Caminho B: a resposta fixa não é enviada;
15. conclusão do Caminho B: `concluida` somente com `status_processamento =
    'processando'` e `claim_token` ainda pertencente ao worker;
16. nenhum teste exige reconstrução perfeita de conflitos após um crash posterior à
    persistência, coluna ou estrutura de resultado transitório persistido, ou vínculo
    entre conflitos e a versão de `estado_conversa`.

### Contrato técnico de banco

Cenários obrigatórios sobre `reivindicar_mensagem`, `aplicar_interpretacao_condicional`
e a conclusão condicional — cada um preserva sua asserção específica, sem fusão com
outro cenário:

1. dois workers inserindo a mesma mensagem inexistente: um vencedor;
2. `recebida → processando`;
3. reclaim com marcador `null` retorna `reivindicada_interpretar`;
4. reclaim com marcador preenchido retorna `reivindicada_resposta_fixa`;
5. `processando` com lease vigente retorna `nao_elegivel`;
6. `concluida` retorna `nao_elegivel`;
7. `falhou` retorna `nao_elegivel`;
8. `claim_token` gerado somente no servidor;
9. persistência com autorização e CAS válidos;
10. status incompatível rejeitado;
11. `claim_token` incompatível rejeitado;
12. lease expirado rejeitado na persistência;
13. marcador já preenchido rejeitado na persistência;
14. clínica incompatível rejeitada;
15. telefone incompatível rejeitado;
16. CAS inválido retorna `conflito_concorrente`;
17. rollback conjunto em qualquer falha;
18. alteração efetiva atualiza `dados`, `atualizado_em` e o marcador;
19. saída vazia preenche somente o marcador;
20. idempotência preenche o marcador sem mudar `atualizado_em`;
21. somente conflitos preenche o marcador e não persiste conflitos;
22. resultado misto persiste `alteracoes_aplicaveis` e o marcador;
23. dois `message_id` disputando a mesma conversa: um CAS vence;
24. isolamento entre clínicas;
25. `PUBLIC`, `anon` e `authenticated` sem `EXECUTE`;
26. `service_role` com `EXECUTE`;
27. conclusão com token vigente;
28. conclusão com token antigo rejeitada;
29. conclusão exige marcador preenchido;
30. lease expirado sem reclaim não impede a conclusão;
31. linhas antigas continuam válidas após a migration;
32. rollback restaura o schema anterior;
33. mesma chave com `clinica_id` incompatível retorna `nao_elegivel`;
34. mesma chave com `telefone_normalizado` incompatível retorna `nao_elegivel`;
35. incompatibilidade nunca substitui clínica ou telefone armazenados;
36. `lease_expira_em` igual a `transaction_timestamp()` é considerado expirado;
37. falha tratada antes do marcador envia resposta fixa;
38. após envio bem-sucedido, status muda para `falhou`;
39. `falhou` preenche `concluido_em`;
40. token antigo não consegue marcar `falhou`;
41. marcador preenchido impede marcar `falhou`;
42. status `falhou` não é reivindicado novamente;
43. falha conhecida e respondida não permanece `processando`;
44. erro no envio da resposta fixa mantém status `processando`;
45. processamento mantido após erro de envio pode ser recuperado após lease;
46. mensagem posterior com snapshot atualizado persiste normalmente.

### Conflitos

- conflito de valor não impede a aplicação de outros campos independentes na mesma
  interpretação;
- conflito concorrente invalida a interpretação inteira, mesmo que alguns campos não
  tivessem conflito de valor;
- `corrigir`/`remover` calculados contra snapshot obsoleto são rejeitados como conflito
  concorrente, não aplicados silenciosamente.

### Deduplicação e lease

- claim atômico: duas tentativas concorrentes de reivindicar a mesma mensagem resultam em
  exatamente um vencedor;
- mensagem `concluida` não gera novo processamento nem nova resposta;
- mensagem `processando` com lease válido não gera novo processamento nem nova resposta;
- mensagem `processando` com lease expirado pode ser reivindicada por um novo
  `claim_token`;
- worker com `claim_token` antigo (expirado ou substituído) não persiste e não marca
  `concluida` (garantias absolutas); a produção e o envio por esse worker são
  bloqueados quando a perda do claim é detectada no gate correspondente, mas isso não é
  uma garantia absoluta contra uma corrida ocorrida depois do gate (ver "Gates
  externos");
- `falhou` não é reinterpretada automaticamente;
- lease de 60 segundos é respeitado na decisão de permitir ou não uma nova reivindicação.

### Falhas

- cada cenário de falha listado (timeout, erro HTTP, saída inválida, conflito
  concorrente, entrada acima do limite, falha de persistência, indisponibilidade do
  adaptador) produz exatamente a resposta fixa;
- nenhum cenário de falha produz aplicação parcial;
- nenhum cenário de falha produz fallback silencioso ou interpretação por texto livre;
- falha ocorrida antes da persistência do marcador: reclaim pode chamar o modelo
  novamente após o lease expirar (substitui o teste antigo de proibição absoluta — ver
  "Reclaim e `interpretacao_persistida_em`");
- falha ocorrida depois da persistência do marcador: zero segunda chamada ao modelo e
  zero segunda persistência.

### Entrada e PII

- payload enviado ao modelo nunca contém `clinica_id`, telefone, IDs, agenda,
  disponibilidade, credenciais ou registros clínicos;
- `dados_atuais` nunca contém valores cadastrais (nome/CPF/nascimento/e-mail) — só os
  campos operacionais listados no contrato;
- `campos_cadastrais_preenchidos` reflete somente quais campos existem, nunca seus
  valores;
- `mensagens_atuais` nunca inclui histórico de turnos anteriores à janela atual;
- nova informação cadastral do paciente na mensagem atual é comparada, pelo Core, contra
  o valor oficial do servidor — nunca aceita como verdade absoluta vinda do modelo.

### Fluxo completo

- as etapas do fluxo aprovado executam na ordem descrita, sem pular ou reordenar etapas
  obrigatórias (em especial: claim antes da IA; persistência condicional antes de
  executar o controlador);
- revalidação atômica de `claim_token`/status/lease/`atualizado_em`, integrada à mesma
  transação que persiste em `estado_conversa` — nunca uma consulta separada seguida de
  uma escrita distinta;
- revalidação de `claim_token`/status/lease antes de produzir a resposta;
- revalidação de `claim_token`/status/lease antes do envio pelo transporte;
- a conclusão (`concluida`) é condicional ao `claim_token` vigente e só ocorre depois do
  envio;
- worker com `claim_token` antigo (expirado ou substituído) não persiste e não marca
  `concluida` (garantias absolutas); produção e envio por esse worker são apenas
  bloqueados quando a perda do claim é detectada no gate correspondente (ver "Gates
  externos" para os cenários de corrida);
- nenhuma validação, em nenhum ponto do fluxo, exige `status_processamento =
  'processando'` depois que a mensagem foi marcada `concluida`.

### Gates externos (produção e envio)

Cenários obrigatórios sobre os gates não atômicos de produção e envio — cada um
preserva sua asserção específica, sem fusão com outro cenário:

1. claim inválido no gate de produção: a produção não ocorre;
2. claim inválido no gate de envio: o envio não é iniciado;
3. worker com token antigo: não persiste e não marca `concluida` (garantias
   absolutas, verificadas independentemente dos gates de produção e envio);
4. corrida depois do gate de produção (claim muda entre o gate e a produção):
   documentada como risco externo, sem exigir garantia impossível;
5. corrida depois do gate de envio (claim muda entre o gate e o envio): documentada
   como pendência de transporte idempotente ou outbox;
6. nenhum teste afirma que os gates de produção ou de envio, isoladamente, garantem
   exatamente uma produção ou exatamente um envio.

### Integração, robustez e isolamento

Cenários obrigatórios adicionais — cada um preserva sua asserção específica, sem fusão
com outro cenário:

1. adaptador real com fetch falso ligado a `interpretarEAplicar` — o caminho completo do
   orquestrador até o adaptador é exercitado com um fetch falso simulando a API OpenAI,
   sem chamada externa real;
2. campo portátil repetido — uma lista `alteracoes` do contrato portátil com o mesmo
   `campo` mais de uma vez é rejeitada por `converterParaContratoInterno`, não aplicada
   silenciosamente;
3. string vazia em `informar` — valor vazio para a ação `informar` é tratado como
   entrada inválida, não como remoção nem como valor válido;
4. string vazia em `corrigir` — valor vazio para a ação `corrigir` é tratado como
   entrada inválida, não como remoção nem como valor válido;
5. `periodo` inválido — valor fora do conjunto permitido para `periodo` é rejeitado
   antes de qualquer persistência;
6. `intencao` inválida — valor fora do conjunto permitido para `intencao` é rejeitado
   antes de qualquer persistência;
7. `corrigir` com versão intacta — quando `atualizado_em` não mudou entre o snapshot e
   a escrita, uma decisão `corrigir` válida é aplicada normalmente;
8. `remover` com versão intacta — quando `atualizado_em` não mudou entre o snapshot e
   a escrita, uma decisão `remover` válida é aplicada normalmente;
9. isolamento entre instâncias — mensagens com o mesmo `message_id` em
   `instancia_whatsapp` diferentes não se confundem nem se deduplicam entre si;
10. isolamento entre clínicas — dados, conversas e claims de uma `clinica_id` nunca
    vazam nem interferem em outra `clinica_id`;
11. ausência de PII em logs e erros — nenhuma mensagem de log ou de erro do fluxo de
    interpretação expõe nome, CPF, data de nascimento, e-mail, telefone ou texto literal
    do paciente;
12. falha de persistência sem resposta de sucesso — se `aplicarInterpretacaoCondicional`
    falhar, a resposta fixa de falha é produzida; nunca uma resposta de sucesso;
13. entrada acima do limite sem chamada ao modelo — quando a entrada excede o limite
    máximo, o modelo nunca é chamado; a rejeição ocorre antes das etapas de execução do
    adaptador no fluxo.
