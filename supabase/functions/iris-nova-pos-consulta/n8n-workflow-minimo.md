# Workflow n8n — pós-consulta (Disparo A + confirmação reativa)

**Status: NÃO importado, NÃO ativado, NENHUMA credencial real anexada,
NENHUM PUT/POST/activate chamado no n8n de produção.** Entregue para nova
revisão do Codex e decisão do Gabriel. O workflow legado `Pos-Consulta -
Avaliação Google` (`h8HxxQK7T6et4tYP`) continua vivo e intocado.

Esta versão corrige os bloqueios **D3** e **D4** da quarta revisão
(`reviews/revisao-pos-consulta-conversacional-v1.md`). O contrato de nodes,
credenciais e critério de sucesso usado abaixo **não é hipotético**: foi
obtido por **leitura (GET), somente leitura**, do n8n de produção real
(`https://singingdugong-n8n.cloudfy.live`, credencial local em
`~/.iris-secrets/n8n.env`) — nenhuma chamada de escrita foi feita a esse
servidor nesta sessão.

## Arquivos

- `n8n-workflow-pos-consulta-iniciar.json` (ao lado deste documento) —
  Disparo A completo (D3).
- `../iris-nova-mensagem/n8n-workflow-reativo-confirmacao-pos-consulta.json`
  — **cópia local exata** do workflow reativo real de produção (`Iris
  Oficial`, id `8oNbqLc9QLaHz8lF`, snapshot lido com `updatedAt =
  2026-09-11T21:50:49.071Z`, `versionId = 7e2d08a5-ce80-429c-ac87-8f64d4b8a907`),
  com um patch aditivo de 3 nodes (D4). **Os 20 nodes e todas as conexões
  originais permanecem byte-a-byte idênticos** ao real — verificado
  programaticamente (comparação campo a campo antes de gravar o arquivo).
  Nada foi enviado de volta ao n8n.

## D3 — Disparo A agora é realmente importável

### 1. Origem das clínicas/candidatos

`n8n-workflow-pos-consulta-iniciar.json` chama a RPC nova
`cappia_pos_consulta_candidatos` (migration
`20260919204030_iris_nova_pos_consulta_v1.sql`, seção 2d) via PostgREST —
**o mesmo mecanismo real já usado em produção** pelo workflow legado
(`RPC pos_consulta_google_candidatos`, node do workflow `Pos-Consulta -
Avaliação Google`). A RPC já varre todas as clínicas elegíveis
(`automatizacoes.pos_consulta_tipo`/`pos_consulta_tempo`, contrato real —
ver D1 em `pos-consulta-carregar-configuracao.ts`) — não precisa de um node
separado de "iterar clínicas". Continua sendo **pré-filtro, não
autoritativo**: todo campo é relido em fonte autoritativa dentro da Edge
Function (C2).

### 2. Telefone oficial

A Edge Function `iris-nova-pos-consulta` agora **devolve**
`telefone_normalizado` (relido de `pacientes`, C2) na resposta de
`"iniciar"` quando `resultado === "entrega_pendente"`
(`supabase/functions/iris-nova-pos-consulta/index.ts`). O node `Enviar via
Evolution` usa exatamente esse valor — nunca um telefone vindo do
pré-filtro.

### 3. Contrato real da Evolution

O node `Enviar via Evolution` usa o tipo de node **real**
`n8n-nodes-evolution-api.evolutionApi` (`resource: messages-api`,
`instanceName`, `remoteJid`, `messageText`) — o mesmo tipo já usado em
produção tanto pelo workflow reativo (`Iris Oficial`, node `Enviar resposta
Evolution`) quanto pelo legado de pós-consulta (`Evolution Enviar Texto`).
Não é mais um `httpRequest` genérico com endpoint/payload hipotéticos.

O critério de sucesso (`Classificar resultado Evolution`) é o **mesmo já
usado em produção**: `resposta.success === true && resposta.data.key.id`
presente — não mais um `statusCode` hipotético.

### 4. Autenticação das Edge Functions

Confirmado por leitura do node real `Chamar Iris Nova` (workflow `Iris
Oficial`): chamadas a Edge Functions deste projeto usam
`Authorization: Bearer <publishable key>` (as Edge Functions exigem JWT por
padrão — `verify_jwt=true`, sem configuração versionada em contrário).

**REVISÃO FINAL DO CODEX (bloqueador 3) — a publishable key NÃO é
autorização suficiente para `iris-nova-pos-consulta`.** Ela é pública por
desenho e só satisfaz o `verify_jwt` da plataforma; esta função autoriza
mensagens de WhatsApp a pacientes. Por isso a função exige, **além** dela,
uma **autenticação interna dedicada**:

- cabeçalho `x-iris-pos-consulta-segredo` com um segredo próprio (>= 32
  caracteres), comparado em tempo constante com o secret
  `POS_CONSULTA_SEGREDO_INTERNO` da Edge Function;
- exigido **antes** de ler o corpo, de tocar o banco ou de chamar a OpenAI
  (`index.ts`, `pos-consulta-autenticacao-interna.ts`);
- secret ausente ou curto no servidor **falha fechado** (500
  `configuracao_ausente` para todos); cabeçalho ausente/errado → 401
  `nao_autorizado`.

No JSON entregue, **os dois valores** (`Authorization` e o segredo) vivem
**dentro de uma única credencial n8n do tipo Custom Auth** chamada
`"Iris Nova Pos-Consulta (chamada interna)"` — nunca como valor literal no
arquivo. Conteúdo da credencial (criada no n8n, jamais versionada):

```json
{ "headers": { "Authorization": "Bearer <publishable key>",
               "x-iris-pos-consulta-segredo": "<mesmo valor do secret POS_CONSULTA_SEGREDO_INTERNO>" } }
```

Os 4 nodes que chamam `iris-nova-pos-consulta` (2 no Disparo A, 1 no patch do
`Iris Oficial`, 1 no workflow reativo completo) usam `genericAuthType:
httpCustomAuth` com essa credencial. A chamada à RPC de candidatos segue com
a credencial separada (`"Supabase REST (service_role)"`, `httpHeaderAuth`).

**Ordem segura de publicação** (nada disto foi feito nesta entrega):
1. criar a credencial Custom Auth no n8n e ligar os 4 nodes a ela (o node
   `confirmar` já **aplicado** no `Iris Oficial` ainda usa a credencial
   antiga e precisa ser trocado pela interface);
2. definir o secret `POS_CONSULTA_SEGREDO_INTERNO` na Edge Function;
3. deploy da função; 4. só então qualquer ativação. Enquanto o secret não
existir, a função responde 500 a todos (falha fechado).

**Por que o n8n vem ANTES do secret/deploy:** `iniciar` levando 401 acontece
antes de qualquer envio (nada sai). Já `confirmar` acontece **depois** do
envio pelo WhatsApp: se ele levar 401, a mensagem **já foi entregue** e a
jornada fica pendente sem confirmação (um reclaim posterior poderia
duplicar a mensagem). Por isso o node `confirmar` do `Iris Oficial` precisa
estar com a credencial nova **antes** de a função passar a exigir o segredo.

**Nenhuma das credenciais existe nesta entrega** — precisam ser criadas no n8n
antes de importar (ver nota "Setup necessário" dentro do próprio JSON).

### O que ainda não está resolvido (declarado, não escondido)

1. **Credenciais reais não configuradas** — os 3 ids de credencial no JSON
   são literalmente a string `"PREENCHER"`. Importar o workflow é seguro
   (fica `active:false`), mas **executar falha** em todo node HTTP/Evolution
   até as credenciais serem criadas e associadas.
2. **Migration não aplicada** — `cappia_pos_consulta_candidatos` não existe
   em nenhum banco ainda.
3. **Edge Function não deployada** — `iris-nova-pos-consulta` não existe em
   nenhum projeto Supabase ainda.
4. **Retry/observabilidade** — nenhum node de log/alerta/retry incluído,
   por decisão explícita do Gabriel de manter o fluxo novo mínimo (spec,
   seção 11). Fica para quando o corte real for autorizado.
5. Nunca testado contra a Evolution real nesta sessão (nenhuma mensagem foi
   enviada) — a leitura feita foi só `GET` no n8n para inspecionar workflows
   já existentes, nunca uma execução.

## D4 — confirmação após o envio, agora no workflow reativo REAL

A revisão anterior descrevia essa mudança só em texto, alegando risco de
editar um workflow em produção a partir de um backup desatualizado. Essa
objeção foi resolvida: o workflow foi **lido diretamente do n8n de produção
via API (GET, somente leitura)**, não de um backup — garantindo que o patch
parte do estado real e atual, não de uma suposição.

`n8n-workflow-reativo-confirmacao-pos-consulta.json` é essa cópia com 3
nodes novos, pendurados depois de `Enviar resposta Evolution` (que **hoje,
em produção, não tem nenhuma conexão de saída** — confirmado pela leitura,
não suposto):

1. **`Classificar resultado Evolution (pos-consulta)`** (Code) — mesmo
   critério real de sucesso do Disparo A (`success===true && data.key.id`).
2. **`Pos-consulta: ha entrega pendente E Evolution confirmou?`** (IF) —
   verdadeiro só quando `Chamar Iris Nova` devolveu `pos_consulta_confirmacao`
   **e** o node anterior confirmou o envio de verdade. Em qualquer outro
   caso (o de praticamente 100% das mensagens, que não envolvem
   pós-consulta), o ramo falso não faz nada — workflow se comporta
   exatamente como hoje.
3. **`Chamar iris-nova-pos-consulta (confirmar)`** (HTTP Request) — só
   alcançado depois dos dois nodes acima aprovarem; usa
   `pos_consulta_confirmacao.agendamento_id`/`.claim_token` (chaves
   snake_case, exatamente como `iris-nova-mensagem/index.ts` devolve) e a
   mesma credencial Custom Auth interna do Disparo A (publishable key +
   segredo interno; ver seção 4).

**O que foi verificado programaticamente antes deste arquivo ser gravado**
(script descartável, não commitado): os 20 nodes originais e todas as
conexões originais permanecem **byte-a-byte idênticos** ao lido do n8n;
apenas os 3 nodes acima e uma única conexão nova
(`Enviar resposta Evolution → Classificar resultado Evolution
(pos-consulta)`) foram adicionados. Nada existente foi removido, renomeado
ou reconectado.

**O que ainda falta para aplicar de verdade:** a mesma credencial Custom Auth
interna do Disparo A (ainda não criada); e,
depois de tudo revisado, a importação manual desse JSON por quem tem acesso
ao n8n real — **esta sessão não tem, e não usou, permissão de escrita nesse
servidor**. Importar substituindo o workflow ativo, ativar, ou fazer
qualquer publish continuam fora do escopo autorizado para esta sessão.

## Recuperação de entregas pendentes (sexta revisão do Codex, bloqueador 1)

Uma entrega reservada e não confirmada (envio falhou ou a confirmação não chegou) deixava a jornada **órfã**: a
RPC de candidatos excluía todo agendamento com jornada. Agora o **mesmo** node de candidatos
(`Buscar candidatos (RPC cappia_pos_consulta_candidatos)`) devolve, em cada linha, `acao_edge`:

- `iniciar` — agendamento novo (como antes: prazo vencido, dentro da janela de 48 h, sem jornada);
- `recuperar` — jornada com entrega **pendente e lease vencido**, nas **duas** etapas (`aguardando_inicio` e
  `finalizando`); vêm **primeiro**, as mais antigas antes.

O node `Chamar iris-nova-pos-consulta (iniciar ou recuperar)` envia `acao: $json.acao_edge`. Na recuperação a Edge
Function relê paciente e telefone oficial, e a RPC **reclama a mesma entrega** (mesmo `entrega_id`, token novo) ou
**encerra a jornada sem mensagem** (`abandonada`) e libera o telefone: fora da janela de 48 h, 3 tentativas
gastas, ou vínculo agendamento/paciente/telefone rompido. O restante do fluxo (enviar → classificar → confirmar) é
idêntico ao de uma primeira entrega. Falha de **um** item (`onError: continue` na chamada à Edge e no envio) não
derruba o lote — o bloqueio de cabeça de fila que travava o workflow legado; um item de erro nunca chega a
`confirmar`. `confirmar` tem retry (3×), porque roda **depois** do envio.

Entrega **ao menos uma vez**: se o envio teve sucesso e só a confirmação falhou, a recuperação reenvia (até 3
tentativas). Detalhes e riscos residuais em `reviews/correcoes-sexta-revisao-pos-consulta-2026-09-20.md`.

## Nenhum caminho prende o telefone (sétima revisão do Codex)

Três caminhos ainda podiam deixar uma jornada ocupando o telefone para sempre; agora todos terminam, em silêncio
quando não há o que entregar (tudo na migration `20260921000000`, ainda não aplicada):

1. **Vínculo rompido.** A seleção das recuperações parte **só da jornada** (o agendamento entra por `LEFT JOIN`,
   apenas para os nomes cosméticos). Se o agendamento ou o paciente mudou de clínica ou de vínculo, a jornada
   **continua listada** e a RPC a encerra por `abandonada_vinculo_invalido` — nunca é enviada.
2. **Automação desligada.** A clínica que desligou o pós-consulta **não recebe mensagem**, mas as pendências dela
   **são listadas e encerradas em silêncio** (`abandonada_automacao_desligada`), liberando o telefone. Decide só a
   chave `pos_consulta_tipo`; configuração ligada porém incompleta não encerra (a jornada usa o modo e o link
   capturados quando começou). A Edge Function não barra mais a recuperação por conta própria.
3. **Jornada sem resposta.** `aguardando_satisfacao` sem resposta há **7 dias** é encerrada em silêncio
   (`abandonada_sem_resposta`) pelo node `Encerrar jornadas sem resposta (RPC …)`, que chama a RPC direto
   (REST, credencial `Supabase REST (service_role)`), em paralelo à busca de candidatos, sem Edge Function,
   sem OpenAI e sem WhatsApp. Uma resposta **posterior** segue pelo fluxo normal da Iris.
