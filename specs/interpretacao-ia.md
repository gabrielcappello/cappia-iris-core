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
- Será criada futuramente a função interna:

```ts
aplicarInterpretacaoCondicional(
  cliente,
  snapshot,
  alteracoes
): Promise<ResultadoAplicacaoInterpretacao>
```

- Essa função fará **uma única tentativa** de persistência (sem o retry interno de
  `aplicarDados`).
- `conversa_id` é o campo recebido pelo Core; a coluna real em `estado_conversa` é
  `id`. A condição da escrita deve ser, explicitamente:

  ```sql
  id = snapshot.conversa_id
  AND clinica_id = snapshot.clinica_id
  AND telefone_normalizado = snapshot.telefone_normalizado
  AND atualizado_em = snapshot.atualizado_em
  ```
- Se a versão mudou entre a leitura do snapshot e a tentativa de escrita:
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
- Somente o proprietário do `claim_token` vigente pode: persistir a interpretação;
  autorizar a produção lógica da resposta; enviar a resposta; marcar o processamento
  como `concluida`. Se qualquer revalidação falhar, a etapa seguinte correspondente não
  é executada.
- `concluida` não processa nem responde novamente.
- `processando` com lease válido não processa nem responde novamente.
- `falhou` não é reinterpretada automaticamente.
- `processando` com lease expirado pode ser reivindicada por um novo worker.
- O worker antigo (dono do `claim_token` anterior) não pode finalizar após um novo claim
  ter sido emitido.

`mensagens_recebidas` garante uma única interpretação e uma única produção lógica de
resposta. Entrega externa exatamente uma vez (ao transporte/paciente) **dependerá
futuramente** de idempotência do transporte ou de um padrão outbox — não está resolvida
nesta especificação.

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
12. revalidar `claim_token`, status `processando` e lease vigente, antes da
    persistência;
13. persistir condicionalmente a interpretação, via `aplicarInterpretacaoCondicional`,
    contra o `atualizado_em` original (condição completa registrada em
    "Concorrência"); em conflito concorrente, não aplicar nada;
14. executar o controlador determinístico (recalcular o próximo estado);
15. revalidar `claim_token`, status `processando` e lease vigente, antes de produzir a
    resposta;
16. produzir a resposta por template determinístico (ou, futuramente, pela porta de
    redação natural);
17. revalidar `claim_token`, status `processando` e lease vigente, antes do envio;
18. entregar a resposta pelo transporte;
19. revalidar `claim_token` vigente e marcar `concluida` condicionalmente ao token — a
    transição final exige `status_processamento = 'processando'` **e** `claim_token`
    igual ao token vigente do worker;
20. nunca repetir automaticamente o mesmo `message_id`.

Há quatro pontos de revalidação (12, 15, 17, 19): em cada um, apenas o proprietário do
`claim_token` vigente pode prosseguir; se o claim não pertence mais ao processamento
atual (expirado ou reivindicado por outro worker), a etapa correspondente (persistência,
produção da resposta, envio, ou a transição final para `concluida`) não é executada.
Depois que a transição para `concluida` ocorre (passo 19), nenhuma validação
subsequente exige `status_processamento = 'processando'`.

## Invariantes

- A IA nunca decide o próximo passo, nunca acessa banco, calendário, credenciais ou
  ferramentas (herdado de `../docs/02-arquitetura.md`).
- `criarClienteModeloOpenAI` sempre usa `text.format.type = 'json_schema'` e
  `strict = true` (ver "Cláusula registrada").
- `aplicarDados` mantém seu comportamento atual (com retry) para todos os consumidores
  fora desta integração — não é alterado por esta especificação.
- `aplicarInterpretacaoCondicional` faz no máximo uma tentativa de persistência; nunca
  relê e reaplica; nunca chama o modelo de novo em caso de conflito concorrente.
- Conflito de valor e conflito concorrente nunca se confundem: o primeiro é decidido pelo
  controlador por campo; o segundo invalida a interpretação inteira.
- `corrigir` e `remover` só são válidos quando a versão (`atualizado_em`) não mudou entre
  o snapshot e a tentativa de escrita.
- Nenhuma mensagem é interpretada mais de uma vez pelo mesmo `message_id`.
- Nenhuma interpretação é reaplicada sobre uma versão diferente daquela para a qual foi
  calculada.
- Somente o proprietário do `claim_token` vigente pode persistir a interpretação,
  autorizar a produção da resposta, enviá-la e marcar `concluida` — um worker cujo
  claim expirou ou foi substituído não executa nenhuma dessas ações, mesmo que ainda
  esteja em execução.
- A transição para `concluida` exige `status_processamento = 'processando'` e
  `claim_token` igual ao token vigente do worker; depois dessa transição, nenhuma
  validação subsequente do fluxo exige `status_processamento = 'processando'`.
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
- worker com `claim_token` antigo (expirado ou substituído) não persiste, não produz a
  resposta, não envia e não marca `concluida`;
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
- revalidação de `claim_token`/status/lease antes da persistência condicional;
- revalidação de `claim_token`/status/lease antes de produzir a resposta;
- revalidação de `claim_token`/status/lease antes do envio pelo transporte;
- a conclusão (`concluida`) é condicional ao `claim_token` vigente e só ocorre depois do
  envio;
- worker com `claim_token` antigo (expirado ou substituído) não persiste, não produz a
  resposta, não envia e não marca `concluida`;
- nenhuma validação, em nenhum ponto do fluxo, exige `status_processamento =
  'processando'` depois que a mensagem foi marcada `concluida`.

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
