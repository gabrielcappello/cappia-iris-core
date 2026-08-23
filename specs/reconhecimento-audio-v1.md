# Reconhecimento de mensagem de áudio — spec v1

**Status:** **implementada e testada em produção (2026-08-23)**. 8 nodes
novos aplicados no workflow real do n8n "Iris Nova - Transporte Mínimo
(gabriel teste)" (`8oNbqLc9QLaHz8lF`), via API. Teste real com áudio de
paciente para a Cleardent confirmou o fluxo completo funcionando
(execução `110689`, `success`). Backups do workflow antes/depois em
`backups/n8n/`. Não autoriza migration, alteração de banco ou painel (fora
de escopo — nenhuma foi necessária).

**Três bugs reais encontrados e corrigidos durante o teste em produção:**

1. Depois do primeiro `PUT` via API adicionando os nodes, o webhook
   continuou rodando o grafo antigo — nem o `PUT` nem os endpoints
   `/activate`/`/deactivate` da API recarregam o registro do webhook nesta
   instância n8n. Só publicar manualmente pelo editor (Ctrl+S / botão
   Publish) forçou o reload real. Alteração de conteúdo de node feita
   depois por API não precisou de novo publish manual.
2. O node "É áudio?" usava `operator: {type: "object", operation: "exists"}`
   em modo `typeValidation: "strict"` — quebrava com "Wrong type" quando a
   mensagem era texto (campo ausente vira string vazia, que o modo estrito
   rejeita comparar como objeto). Trocado por uma comparação de string
   simples (`audioMessage ? 'sim' : ''` igual a `'sim'`), sem validação de
   tipo de objeto.
3. **Bug de desenho mais sério:** "Mensagem válida?" apontava para dois
   nodes ao mesmo tempo na mesma saída (`Extrair campos` E `É áudio?`) — o
   n8n executa todos os destinos de uma branch em paralelo, então
   `Extrair campos` sempre rodava mesmo em mensagens de áudio, produzindo
   `mensagem: null` e um erro de `mensagem_invalida` competindo com o
   caminho correto. Corrigido removendo a conexão direta: agora
   `Mensagem válida?` aponta só para `É áudio?`, que por sua vez decide
   entre `Extrair campos` (texto) ou o fluxo de transcrição (áudio) —
   exclusivo, nunca os dois.

Também foi corrigida a referência de `instancia`/`telefone` no node
"Enviar resposta Evolution", que buscava esses campos só de
`$('Extrair campos')` — quebrava nos dois caminhos de áudio (transcrito
com sucesso ou fallback). Agora usa uma expressão em cascata que verifica
qual dos três nodes de origem (`Extrair campos`, `Montar mensagem
transcrita`, `Fallback: pedir reenvio`) realmente executou.

**Decisões fechadas com o Gabriel (2026-08-22):**

| Pergunta | Decisão |
|---|---|
| Onde transcrever | **No n8n**, antes de chamar a Edge Function — o Core nunca sabe que a mensagem era áudio. |
| Motor de transcrição | **Whisper da OpenAI** (`OPENAI_API_KEY` já no cofre, mesma provedora da interpretação). |
| Falha de transcrição | **Iris pede pro paciente escrever ou reenviar** — texto fixo determinístico, nunca inventa o que a pessoa disse. |
| Idioma | **Fixo em `pt`** — todas as clínicas hoje são brasileiras. |
| Limite de áudio | **Até 5 minutos e 15 MB.** Acima disso, mesmo fallback da seção 3 (sem tentar transcrever). |
| Timeout do node de transcrição | **60 segundos.** |

**Payload real confirmado (2026-08-22):** capturado de uma execução real do
workflow "Iris Nova - Transporte Minimo (gabriel teste)" (n8n, execução
`110455`, 21:46 — áudio de teste mandado pelo Gabriel para a Cleardent).
Confirma exatamente a hipótese da seção 1.1 abaixo — ver seção 1.2.

## 0. Por que isto é quase todo fora do Core

Levantamento feito antes de especificar (2026-08-22): a Edge Function
`iris-nova-mensagem` recebe hoje só
`{provider, instancia_whatsapp, telefone_normalizado, mensagem: string}` —
nenhum campo de mídia. O orquestrador (`orquestrador.ts`,
`interpretar-e-aplicar.ts`) não tem nenhum branch de mídia. Não existe
nenhuma implementação de transcrição em nenhum repositório local hoje —
`docs/02-arquitetura.md` linha 42 já listava "áudio" como responsabilidade
do n8n desde o início do projeto, mas nunca foi construído. A menção "Tales
recebe áudio" (agente comercial, projeto separado) é só texto de FAQ que o
Tales usa para responder ao usuário — não há transcrição real por trás,
confirmado por leitura do código-fonte de `cappia-tales`.

**Consequência da decisão "transcrever no n8n":** o contrato do payload da
Edge Function **não muda**. Esta spec é sobre um fluxo novo no n8n (fora
deste repositório), documentado aqui porque `specs/` já é onde as decisões
de produto da Iris ficam registradas — inclusive quando a build é feita
direto no n8n (mesmo padrão de `docs/02-arquitetura.md`).

## 1. Fluxo completo

```
Paciente manda áudio no WhatsApp
  → Evolution API dispara webhook messages.upsert
  → n8n: detecta messageType = audioMessage (ou audio/ptt)
  → n8n: chama Evolution API POST /chat/getBase64FromMediaMessage/{instance}
      com a "key" que já veio no webhook, recebe o áudio em base64
  → n8n: chama OpenAI POST /v1/audio/transcriptions (Whisper) com o áudio
  → n8n: usa o TEXTO transcrito como "mensagem" no payload já existente
      da Edge Function iris-nova-mensagem — sem nenhum campo novo
  → Edge Function processa exatamente como processa hoje um texto digitado
```

### 1.1 Por que precisa de uma chamada extra pra buscar o áudio

Confirmado em documentação/issues oficiais da Evolution API (não presumido):
o webhook `messages.upsert` **não entrega o conteúdo do áudio pronto para
uso** — a mídia chega criptografada (URL + `mediaKey` de criptografia), e o
`key.id` da mensagem é o que se usa para chamar
`POST /chat/getBase64FromMediaMessage/{instance}`, que devolve o áudio já
decodificado em base64. É um passo obrigatório, não uma escolha de desenho.

### 1.2 Payload real confirmado (2026-08-22)

Capturado de uma execução real do n8n (workflow "Iris Nova - Transporte
Minimo (gabriel teste)", execução `110455`) — não presumido, o Gabriel
mandou um áudio de teste real para a Cleardent e a execução foi inspecionada
via API do n8n. A mensagem falhou nesta execução exatamente como esperado
(o node atual só extrai texto, `mensagem` chegou `null` na Edge Function,
que corretamente devolveu `400 mensagem_invalida`) — é o comportamento sem
esta spec implementada, prova de que a lacuna é real.

Estrutura confirmada (campos sensíveis do paciente omitidos aqui):

```json
{
  "event": "messages.upsert",
  "instance": "<nome-da-instancia>",
  "data": {
    "key": {
      "remoteJid": "<telefone>@s.whatsapp.net",
      "fromMe": false,
      "id": "<id-da-mensagem>"
    },
    "pushName": "<nome-do-contato>",
    "status": "DELIVERY_ACK",
    "message": {
      "audioMessage": {
        "url": "https://mmg.whatsapp.net/.../arquivo.enc?...",
        "mimetype": "audio/ogg; codecs=opus",
        "fileSha256": { "0": ..., "1": ... },
        "fileLength": { "low": 26526, "high": 0, "unsigned": true },
        "seconds": 12,
        "ptt": true,
        "mediaKey": { "0": ..., "1": ... },
        "fileEncSha256": { "0": ..., "1": ... }
      }
    }
  }
}
```

**Confirmações que fecham a seção 1.1:**
- O campo é `data.message.audioMessage` (não `messageType` como string solta
  — é a PRESENÇA da chave `audioMessage` dentro de `message` que indica o
  tipo, mesmo padrão que provavelmente vale para `conversation`/
  `extendedTextMessage` no caminho de texto já em produção).
- `ptt: true` confirma nota de voz (áudio gravado no próprio WhatsApp, o
  caso comum de paciente respondendo por áudio).
- `mimetype: "audio/ogg; codecs=opus"` — Whisper aceita `ogg` nativamente,
  sem conversão necessária.
- `url` é um link `.enc` (criptografado) — confirma que **não dá para
  baixar direto**; é preciso `POST /chat/getBase64FromMediaMessage/{instance}`
  com o `data.key` desta mesma estrutura, exatamente como a seção 1.1 previa
  a partir da documentação pública.
- `seconds: 12` — dentro do limite de 5 minutos definido nas decisões acima.

**Continua não verificado (sem evidência ainda, não presumir):** o formato
de um áudio **maior** que o limite de 15 MB/5 min (se a Evolution recusa
antes de entregar o webhook, ou se entrega normalmente e cabe ao n8n
verificar `fileLength`/`seconds` e descartar). Verificar com um áudio de
teste mais longo antes de implementar o node de limite.

## 2. Node novo no n8n

Um `IF`/`Switch` logo após o recebimento do webhook, ramificando por
`messageType`:

- **Texto** (`conversation`, `extendedTextMessage`): fluxo atual, sem
  mudança nenhuma.
- **Áudio** (`audioMessage`): os três passos novos da seção 1 (buscar
  base64 → transcrever → usar o texto como `mensagem`), depois **entra no
  mesmo fluxo do texto** a partir daí — nenhuma bifurcação depois desse
  ponto.
- **Qualquer outro tipo de mídia** (imagem, vídeo, documento, figurinha):
  **fora de escopo desta spec**. Comportamento a decidir separadamente —
  não implementar como efeito colateral desta frente.

## 3. Falha de transcrição — sem inventar, sem travar

Dois casos, mesma resposta ao paciente:

- **Whisper devolve erro** (timeout, arquivo corrompido, API fora do ar).
- **Whisper devolve texto vazio ou só ruído** (áudio inaudível, silêncio).

Nos dois casos, o n8n **não chama a Edge Function** com um texto inventado
ou vazio — em vez disso, responde diretamente com um **texto fixo
determinístico** (decisão fechada — nunca passa pela redatora, sem chamar
IA pra dizer "não entendi"):

> "Não consegui entender esse áudio. Pode escrever a mensagem ou mandar de
> novo, por favor?"

Mesmo texto/caminho para o caso de áudio acima do limite (seção 0 —
5 minutos / 15 MB): o n8n verifica `seconds`/`fileLength` do
`audioMessage` (ver seção 1.2) **antes** de gastar uma chamada ao Whisper,
e cai direto neste fallback se estourar o limite.

**Nunca** chamar a Edge Function com `mensagem: ""` nem com um texto
placeholder — isso entraria no Core como se o paciente tivesse mandado uma
mensagem vazia, campo fora do vocabulário esperado hoje.

## 4. O que o Core NUNCA precisa saber

Por decisão desta spec, os seguintes pontos são explicitamente **fora do
escopo do Core**, para não abrir uma frente de mudança de contrato sem
necessidade real:

- **Que a mensagem original era áudio.** A Iris redige a resposta como se
  fosse texto digitado — não há fato "veio de áudio" nos `fatos_autorizados`
  hoje, e nenhuma spec pede isso.
- **Duração, qualidade ou confiança da transcrição.** O Whisper pode
  devolver metadados (confiança por trecho, idioma detectado) — nada disso
  atravessa para o Core nesta v1.
- **Histórico de que aquele turno era áudio.** `historico_conversa`
  continua guardando só o texto (transcrito), do mesmo jeito que guarda
  texto digitado.

Se o Gabriel quiser que a Iris reconheça e comente que recebeu um áudio
("recebi seu áudio, entendi que...") — isso É uma mudança de escopo (exigiria
um fato novo chegando ao Core) e fica fora desta v1 por decisão implícita da
escolha "transcrever no n8n, Core não sabe". Registrar como possível v2 se o
Gabriel pedir.

## 5. Decisões — todas fechadas (2026-08-22)

Todas as decisões antes em aberto foram fechadas pelo Gabriel:

| Decisão | Fechada como |
|---|---|
| Texto de erro fixo ou dinâmico | **Fixo, determinístico** — nunca passa pela redatora, sem tocar o Core. |
| Idioma da transcrição | **Fixo em `pt`** — todas as clínicas hoje são brasileiras. |
| Limite de tamanho/duração | **5 minutos e 15 MB.** Verificado antes de chamar o Whisper (economiza chamada). |
| Timeout do node de transcrição | **60 segundos**, depois cai no fallback da seção 3. |

**Não decidido, fora do escopo desta v1 por decisão implícita (não
levantar sem pedido):** custo por minuto de áudio do Whisper. Se o Gabriel
quiser medir, é uma nota separada, mesmo espírito da comparação de modelo
(Terra/Luna/Sol) já registrada em outra conversa.

## 6. Testes obrigatórios

**No n8n (manual, não há suíte automatizada de workflow hoje):**
- Áudio curto e claro, em português → texto transcrito correto → segue
  fluxo normal de agendamento como se fosse digitado.
- Áudio inaudível/ruído → cai no fallback da seção 3, sem chamar a Edge
  Function com texto vazio ou inventado.
- Mensagem de texto normal → comportamento **idêntico ao de hoje**, sem
  passar pelo ramo de áudio (prova de que a mudança não introduz regressão
  no caminho já existente).
- Áudio + texto na mesma janela de mensagens (ex.: paciente manda áudio e
  depois texto rápido) — comportamento a definir: hoje a interpretadora já
  trata `mensagens_atuais` como janela (specs/interpretacao-ia.md); não
  verificado nesta spec se n8n hoje agrupa múltiplas mensagens antes de
  chamar a Edge Function. Levantar antes de implementar.

**No Core (`src/core`):** nenhum teste novo necessário — por desenho, o
Core não recebe nenhum campo novo, então nenhum comportamento dele muda.

## 7. Fora desta v1

- Reconhecimento de qualquer mídia além de áudio (imagem, documento,
  figurinha, vídeo).
- Resposta em áudio da Iris (só texto, como hoje).
- Fato "mensagem veio de áudio" chegando ao Core/redatora (ver seção 4).
- Comportamento exato para áudio acima do limite de tamanho/duração sem
  passar pelo `messages.upsert` normal (ex.: Evolution recusa antes de
  entregar o webhook) — não verificado com áudio de teste real acima do
  limite (seção 1.2).
