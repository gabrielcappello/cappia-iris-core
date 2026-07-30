# Spec — Interpretação pela IA

**Status:** especificação de integração aprovada e registrada nesta versão (ver seções
abaixo). Pendências explícitas, não resolvidas nesta rodada: base legal, retenção e
contrato/condições do provedor para uso com pacientes reais; números de debounce e de
limite máximo de janela (a definir na especificação da Edge Function); a porta de
redação natural futura (hoje, resposta por template determinístico). Nenhuma dessas
pendências deve ser tratada como decidida.

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
  alteracoes
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
3. confirmar simultaneamente, em `estado_conversa` (`conversa_id` é o campo recebido
   pelo Core; a coluna real é `id`):
   - `id = snapshot.conversa_id`;
   - `clinica_id = snapshot.clinica_id`;
   - `telefone_normalizado = snapshot.telefone_normalizado`;
   - `atualizado_em = snapshot.atualizado_em`;
4. somente se todas as condições acima forem verdadeiras: aplicar todas as alterações
   autorizadas, atualizar `atualizado_em`, e retornar o estado efetivamente persistido;
5. se qualquer condição falhar: não alterar `estado_conversa`; não aplicar
   parcialmente; não reler e reaplicar; não chamar o modelo novamente; retornar a falha
   determinística apropriada.

A operação é **tudo-ou-nada**: não existe estado intermediário observável entre a
validação do claim/versão e a persistência.

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

## Deduplicação e lease (`mensagens_recebidas`)

- Chave única de deduplicação: `provider + instancia_whatsapp + message_id` (já existe
  como `unique` no schema atual).
- Reivindicação (`claim`) atômica antes de chamar a IA.
- Colunas futuras a adicionar:
  - `claim_token uuid null`;
  - `lease_expira_em timestamptz null`.
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

`mensagens_recebidas`, combinada com o contrato atômico de
`aplicarInterpretacaoCondicional`, garante uma única interpretação persistida e uma
única transição para `concluida` por `message_id`. Não garante, por si só, uma única
produção lógica de resposta nem uma única tentativa de envio: os gates antes da
produção e antes do envio reduzem o risco de duplicação, mas não são atômicos com a
tabela. Impedir produção ou envio duplicados por um worker que perdeu o claim depois do
gate, e garantir entrega externa exatamente uma vez (ao transporte/paciente),
**dependerá futuramente** de idempotência do transporte ou de um padrão outbox
transacional — não está resolvida nesta especificação.

## Política de tentativas

- Retry técnico interno do adaptador (`criarClienteModeloOpenAI`, já aprovado) permanece
  permitido.
- Nova interpretação automática do mesmo `message_id` é **proibida**.
- Reaplicação da interpretação sobre uma versão nova é **proibida**.
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
}
```

Regras:

- `mensagens_atuais` contém somente a mensagem atual ou mensagens agrupadas na mesma
  janela de debounce do transporte;
- preservar ordem cronológica;
- nunca enviar histórico textual de turnos anteriores;
- não enviar ao modelo valores cadastrais antigos — enviar somente **quais** campos
  cadastrais já estão preenchidos (`campos_cadastrais_preenchidos`), nunca os valores em
  si;
- o paciente pode informar novo nome, CPF, nascimento ou e-mail na mensagem atual; o Core
  compara a nova interpretação contra o valor oficial mantido no servidor;
- ficam fora do payload do modelo, sempre: `clinica_id`, telefone, IDs, agenda,
  disponibilidade, credenciais e registros clínicos.

### Limites (pendentes)

- A duração numérica do debounce será definida na especificação da Edge Function — **não
  definida aqui**.
- Limites máximos (tamanho de janela, número de mensagens) serão obrigatórios, mas os
  números ainda **não estão definidos**.

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
- interpretação por texto livre;
- nova interpretação automática do mesmo `message_id`.

## Fluxo final aprovado

1. validar envelope do transporte;
2. resolver clínica pela instância autenticada;
3. inserir ou reivindicar em `mensagens_recebidas`;
4. encerrar silenciosamente se duplicada não elegível (já `concluida`, ou `processando`
   com lease válido);
5. identificar paciente e conversa;
6. carregar `dados` e `atualizado_em` (o snapshot);
7. construir a entrada minimizada (`EntradaInterpretacaoModelo`);
8. criar o cliente OpenAI (`criarClienteModeloOpenAI`);
9. executar `extrairAlteracoes`;
10. validar integralmente a saída;
11. executar `preAplicar`;
12. executar `aplicarInterpretacaoCondicional`, que revalida atomicamente
    `claim_token`, status `processando`, lease vigente e `atualizado_em` do snapshot,
    **na mesma transação** que persiste as alterações (contrato atômico completo
    registrado em "Concorrência"); se o claim estiver inválido, nada é persistido; se
    `atualizado_em` mudou, nada é persistido;
13. somente após sucesso da persistência, executar o controlador determinístico
    (recalcular o próximo estado);
14. revalidar `claim_token`, status `processando` e lease vigente, antes de produzir a
    resposta;
15. produzir a resposta por template determinístico (ou, futuramente, pela porta de
    redação natural);
16. revalidar `claim_token`, status `processando` e lease vigente, antes do envio;
17. entregar a resposta pelo transporte;
18. revalidar `claim_token` vigente e marcar `concluida` condicionalmente ao token — a
    transição final exige `status_processamento = 'processando'` **e** `claim_token`
    igual ao token vigente do worker;
19. nunca repetir automaticamente o mesmo `message_id`.

A revalidação do passo 12 é **atômica e transacional** — parte da mesma operação que
persiste em `estado_conversa` (ver "Concorrência"); não é uma consulta de revalidação
separada da escrita. Essa é uma garantia absoluta.

Os passos 14 e 16 (antes de produzir e antes de enviar) são **gates operacionais**, não
operações atômicas: o gate autoriza prosseguir com base no estado do claim observado
naquele instante, mas não bloqueia atomicamente uma mudança de claim ocorrida
imediatamente depois — se o claim não pertence mais ao processamento atual (expirado ou
reivindicado por outro worker) no momento do gate, a etapa correspondente (produção ou
envio) não é executada; mas não há garantia absoluta de que um worker que perde o claim
entre o gate e a ação seguinte deixe de produzir ou de enviar. Essa corrida externa
pertence à pendência de transporte já registrada (idempotência do transporte ou outbox
transacional — ver "Deduplicação e lease").

O passo 18 (revalidar `claim_token` vigente e marcar `concluida`) é uma garantia
**absoluta**: a transição exige `status_processamento = 'processando'` **e**
`claim_token` igual ao token vigente do worker, verificados na mesma operação
condicional que grava `concluida` — um worker com token antigo nunca marca `concluida`.
Depois que essa transição ocorre, nenhuma validação subsequente exige
`status_processamento = 'processando'`.

O envio pelo transporte (passo 17) não é, e não deve ser tratado como, transacional com
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
- Conflito de valor e conflito concorrente nunca se confundem: o primeiro é decidido pelo
  controlador por campo; o segundo invalida a interpretação inteira.
- `corrigir` e `remover` só são válidos quando a versão (`atualizado_em`) não mudou entre
  o snapshot e a tentativa de escrita.
- Nenhuma mensagem é interpretada mais de uma vez pelo mesmo `message_id`.
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
- Toda falha coberta pela resposta fixa produz exatamente essa resposta — nunca aplicação
  parcial, fallback silencioso, interpretação por texto livre, ou nova interpretação
  automática do mesmo `message_id`.

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
- nenhum cenário de falha dispara nova interpretação automática do mesmo `message_id`.

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
