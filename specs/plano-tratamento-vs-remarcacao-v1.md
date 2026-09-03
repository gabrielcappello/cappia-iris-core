# Plano de tratamento não pode se misturar com o agendamento já marcado — v1

**Status:** especificação **proposta, não aprovada e não implementada**. Registra um
defeito real, achado em conversa de produção, e propõe correção. Nenhuma linha de código
muda até aprovação do Gabriel.

## Para quem revisa isto sem contexto prévio

Este documento pede uma **revisão de arquitetura, segurança e aderência** à especificação
proposta — o mesmo papel que `AGENTS.md` (raiz do repositório `cappia-iris-core`) atribui
ao Codex no processo do projeto (seção "Processo obrigatório", passo 3). Você está fazendo
essa revisão porque o Codex está sem tokens no momento.

**O que ler antes, nesta ordem** (todos em `cappia-iris-core`, a fonte oficial deste
projeto — ver `00-INICIO.md` para a ordem de leitura completa do repositório):

1. `docs/00-principios.md` — os 4 princípios que toda spec deve seguir; esta declara
   aderência a eles logo abaixo.
2. `docs/07-arquitetura-v2.md`, seção 2 — por que o Core (código determinístico) nunca
   decide o significado da mensagem do paciente; isso é sempre da IA de interpretação.
   Esta spec depende inteiramente desse princípio (seção 4 abaixo).
3. `specs/remarcacao-conversacional-v1.md`, seção 1 — a spec **já aprovada** do fluxo de
   remarcação, que esta spec cita e cuja regra original está sendo restaurada.

**Contexto mínimo do sistema, para quem nunca viu este projeto:** a Iris Nova é um
assistente de WhatsApp para clínicas odontológicas. Uma "IA de interpretação" (arquivo
`src/core/interpretacao-instrucoes.ts`) lê a mensagem do paciente e devolve campos
estruturados (procedimento, data, horário, `intencao`, etc.) — nunca decide o que fazer.
Um "Core" determinístico (`src/core/orquestrador.ts`) lê esses campos e decide o fluxo:
`intencao='remarcacao'` faz o Core buscar o agendamento existente do paciente e propor
trocar a data/horário dele; ausência de `intencao` (ou `intencao='novo_agendamento'`) faz
o Core tratar como um agendamento novo, separado. **A troca entre os dois é inteiramente
controlada pela IA de interpretação — o Core nunca infere isso sozinho** (ver seção 4).
Uma "redatora" separada (`src/core/redator-instrucoes.ts`) recebe os fatos decididos pelo
Core e escreve a resposta final ao paciente, em linguagem natural.

O "plano de tratamento" (`tratamentos_pendentes` no payload da interpretação, montado em
`src/core/tratamentos-aprovados.ts`) é a lista de procedimentos que o dentista já aprovou
para o paciente e ainda não realizou — **conteúdo a agendar**, sem nenhuma relação com os
agendamentos que já existem na agenda (`agendamentos_do_paciente`, outro campo do mesmo
payload, montado em `src/core/orquestrador.ts` por volta da linha 316). São dois conceitos
do domínio da clínica que o defeito abaixo mistura.

## Aderência a `docs/00-principios.md`

- **Responsabilidade correta.** O defeito nasce de uma regra que tenta adivinhar a
  intenção do paciente a partir de "o que apareceu por último na conversa", em vez de dar
  à IA o contexto para ela mesma entender do que se trata. A correção remove a adivinhação
  e entrega o dado que faltava — não acrescenta uma regra nova mais específica por cima.
- **Remoção.** A regra problemática (seção 2) é ajustada para dizer exatamente o que a
  spec aprovada de remarcação (`remarcacao-conversacional-v1.md`, seção 1) já dizia antes
  dela ser contradita: "mencionar data ou horário, sozinho, nunca emite intenção". Nenhum
  campo, evento ou estado novo.
- **Teste isolado.** A seção 5 exige par A/B: mesmo histórico recente (agendamento futuro
  mencionado), variando só se o paciente nomeia esse agendamento — os dois lados têm que
  divergir.
- **Testes realistas.** O caso de origem é conversa real de produção (seção 1), não
  hipótese.

## 1. O defeito, com evidência real

**Conversa real, WhatsApp, Cleardent, 2026-09-03** (paciente Carlos Cappello, telefone
`5521988046011`, `estado_conversa.id = 4721855d-8f6d-479c-9e8e-348fc505899b`):

```
Paciente: Olá boa tarde
Iris:     Boa tarde, Carlos! Além do canal molar já agendado para amanhã, você
          ainda tem estes tratamentos aprovados com o Dr. Pablo Arruda:
          • Cirurgia de implante — dente 31
          • Restauração / Cárie (1 face) — dente 23
          • Retratamento de canal — dente 26
          Qual deles você gostaria de agendar?
Paciente: Quero para segunda ao retratamento de canal dente 26
Iris:     Horários livres para 07/09: 08:00, 09:00, 10:20, 13:00, 14:00, 15:00, 16:20.
          Qual você prefere?
Paciente: 8 hrs
Iris:     Você está com 04/09 às 08:40. Quer passar para 07/09 às 08:00?      ← ERRADO
Paciente: Nao. Esse e para um novo agendamento
Iris:     Encontrei esse horário: 07/09 às 08:00. Posso confirmar?
Paciente: Pode sim
Iris:     Seu novo agendamento está confirmado para 07/09 às 08h [...]. O
          atendimento de 04/09 às 08:40 permanece mantido.
```

O paciente nunca mencionou o agendamento de amanhã. Ele escolheu um item do plano de
tratamento e um horário para ele. A Iris misturou os dois assuntos e só se corrigiu porque
o paciente reclamou explicitamente.

## 2. Causa raiz

Duas causas, independentes, precisam ser corrigidas juntas.

### 2.1 A pergunta de abertura não deixa as duas portas abertas

Quando a Iris anuncia, no mesmo turno, um agendamento já marcado **e** uma lista de
tratamentos pendentes, ela pergunta só **"qual desses [pendentes] você gostaria de
agendar?"** — presumindo que o paciente vai falar dos pendentes. Isso empurra o turno
inteiro para um único assunto sem dar ao paciente a chance clara de dizer "não, é sobre o
que já está marcado".

A pergunta precisa deixar claro, sem ambiguidade, que existem duas coisas diferentes das
quais o paciente pode estar falando: o que já está marcado, e o que ainda falta agendar. A
formulação exata é decisão de redação (linguagem natural, não frase fixa) — o que a spec
exige é que a intenção do paciente sobre qual dos dois assuntos ele quer seja resolvida
antes de a conversa avançar, não presumida.

### 2.2 A instrução da interpretadora manda adivinhar por proximidade, não por menção

Commit `578003d` (18/08/2026) acrescentou esta frase à instrução, **de passagem**, dentro
de um commit sobre um assunto totalmente diferente (distinguir "perguntar sobre dentista"
de "escolher um dentista"). Sem conversa real documentada, sem teste próprio, e
**contradizendo** a spec já aprovada do próprio fluxo de remarcação:

> "Um pedido de TROCAR ou MUDAR um horário logo depois de o próprio agendamento ter sido
> tratado no `historico_recente` é remarcação, nunca um pedido novo — mesmo que a mensagem
> não repita a palavra 'consulta' nem diga qual atendimento."

`remarcacao-conversacional-v1.md`, seção 1 (spec aprovada, anterior a essa frase), já
dizia o oposto: *"mencionar data ou horário, sozinho, nunca emite intenção"*.

**O problema não é a existência da regra — é ela disparar por proximidade no histórico em
vez de por menção explícita ao agendamento.** No caso real, "o próprio agendamento" que
"foi tratado no histórico" era o lembrete automático da véspera e a frase de abertura da
própria Iris — nunca algo que o paciente disse. A regra não distingue "o agendamento
apareceu porque o paciente falou dele" de "o agendamento apareceu porque a Iris o citou
por outro motivo (lembrete, plano de tratamento)".

Pode ter existido um caso real que motivou essa frase (registrar aqui se for lembrado, para
não perder a proteção). Mas ela não tem teste, não tem spec própria, e como está redigida
hoje já se mostrou capaz de causar o defeito oposto ao que provavelmente tentava evitar.

## 3. Correção proposta

### 3.1 Redação da resposta de abertura (redator-instrucoes.ts)

Quando a Iris tiver **ao mesmo tempo** um agendamento futuro e tratamentos pendentes para
anunciar, a pergunta final deve apresentar as duas possibilidades como escolhas
igualmente válidas — nunca perguntar só sobre uma delas como se a outra não pudesse ser o
assunto. Sem frase fixa: dar à redatora o **entendimento** de que são dois assuntos
diferentes (o que já está marcado vs. o que falta agendar) e confiar que ela formula a
pergunta naturalmente, do mesmo jeito que já faz em outras aberturas.

### 3.2 Ajuste da regra de remarcação (interpretacao-instrucoes.ts)

Trocar a condição de "apareceu por perto no histórico" por "o paciente mencionou
explicitamente o atendimento que já tem marcado". Rascunho da ideia (redação final
aberta, a calibrar junto com o Gabriel):

> Emita `intencao = remarcacao` somente quando o paciente se referir, de forma
> identificável, ao atendimento que ele **já tem marcado** — nomeando-o diretamente
> ("minha consulta", "meu horário de amanhã") ou continuando um assunto que ele mesmo
> abriu sobre esse atendimento. A citação de um agendamento existente feita pela própria
> Iris (lembrete, anúncio de plano de tratamento) não conta como o paciente tê-lo trazido
> à conversa — só o paciente pode abrir esse assunto.

Isto devolve a regra ao que a spec original de remarcação já previa, sem apagar a
intenção original de cobrir "pode trocar para 10hrs?" quando esse pedido realmente
continua um assunto que o próprio paciente trouxe.

### 3.3 Ambiguidade real: perguntar, nunca presumir

Quando não for possível saber com segurança se o paciente está falando do agendamento
marcado ou de um item do plano — por exemplo, uma mensagem curta que poderia valer para
os dois, sem nenhum dos dois assuntos ter sido mencionado por ele antes nesta janela — a
interpretadora deve omitir a intenção (regra de dúvida real, já existente e geral no
contrato) e a redatora deve perguntar qual dos dois assuntos é, em vez de escolher por
conta própria. Isto não é regra nova: é a aplicação, a este caso específico, da regra de
dúvida real que já vale para todo o resto do contrato.

**Isto NÃO é o caso do exemplo real da seção 1, e a distinção precisa ficar explícita.**
No turno de "8 hrs", o paciente já havia dito, na mesma janela recente, "Quero para
segunda ao retratamento de canal dente 26" — ele **abriu** o assunto do item do plano.
"8 hrs" que vem depois disso não é ambiguidade real: é a continuação óbvia do pedido que
o próprio paciente acabou de fazer, e cai em 3.2 (segue como o mesmo pedido, sem
remarcação, sem pergunta extra). A regra de precedência, para deixar isto sem
interpretação dupla:

> Quando o paciente mencionou um item do plano de tratamento por último nesta janela, um
> horário solto em seguida continua sobre **esse item** — não é ambiguidade, mesmo que o
> agendamento existente também apareça no histórico (citado pela Iris). A ambiguidade real
> de 3.3 só se aplica quando o paciente **não** deu nenhum sinal de qual dos dois assuntos
> é o dele nesta janela — nunca como padrão geral para qualquer horário solto.

Sem esta precedência explícita, uma leitura ampla demais de 3.3 faria a Iris perguntar
"qual dos dois?" mesmo quando o paciente já deixou claro, criando um atrito novo na
direção oposta ao defeito original.

## 4. O que NÃO muda

- O plano de tratamento continua sendo só contexto informativo (`tratamentos_pendentes`) —
  o Core nunca decide fluxo a partir dele, e isso não muda.
- `orquestrador.ts` continua roteando remarcação exclusivamente por
  `dados.intencao === 'remarcacao'` (ver o bloco a partir de `if (dados.intencao ===
  'remarcacao')`, comentado explicitamente: *"roteada exclusivamente por
  `dados.intencao`... NUNCA inferida pela existência de um agendamento ativo: um paciente
  com consulta marcada que peça outro procedimento está pedindo um SEGUNDO agendamento,
  não remarcando o primeiro — quem distingue é a IA, lendo a frase"*). Esta spec só muda
  **quando a IA deve emitir esse valor**, nunca o que o Core faz com ele.
- Consequência prática para quem revisa: a correção é **inteiramente textual**, dentro da
  instrução dada ao modelo de interpretação (`INSTRUCOES_EXTRATOR` em
  `interpretacao-instrucoes.ts`) e da instrução dada à redatora
  (`redator-instrucoes.ts`). Nenhuma função, tipo, branch ou condicional do Core muda.
- Nenhuma tabela, coluna, RPC, migration ou evento novo. Nenhum campo novo no schema de
  saída da interpretação (`SCHEMA_SAIDA_INTERPRETACAO`, mesmo arquivo) — `intencao` já
  existe e já aceita `'remarcacao'` como valor.

## 5. Verificação exigida antes de aprovar

- Par A/B obrigatório: mesmo histórico (agendamento futuro mencionado só pela Iris, plano
  de tratamento anunciado, paciente escolhe um item e depois diz só um horário) — variando
  **apenas** se o paciente, em algum momento da janela, nomeia o agendamento existente.
  Os dois lados têm que divergir (`novo_agendamento` vs. `remarcacao`).
- Reprodução exata do caso real da seção 1, deve terminar como criação, nunca remarcação,
  sem o paciente precisar corrigir a Iris.
- Caso de ambiguidade real proposital (mensagem que poderia valer para os dois, **sem** o
  paciente ter mencionado nenhum dos dois assuntos antes na janela) deve terminar em
  pergunta da redatora, nunca em decisão silenciosa — e este caso precisa ser distinto do
  caso da seção 1 (onde o paciente já mencionou o item do plano), para provar que a
  correção não empurrou o defeito para perguntas desnecessárias.
- **Teste isolado por causa** (seção 2 desta spec já reconhece duas causas
  independentes — 2.1 na redação de abertura, 2.2 na regra da interpretadora): cada
  correção precisa de um cenário que a isole da outra, para que a medição prove qual das
  duas efetivamente resolveu o quê, em vez de só medir o resultado combinado:
  - com **somente** 3.1 aplicada (pergunta de abertura corrigida) e 3.2 **não** aplicada:
    confirmar que a regra antiga da interpretadora ainda pode causar o defeito quando o
    paciente responde de forma curta — prova que 3.1 sozinha não basta;
  - com **somente** 3.2 aplicada (regra da interpretadora corrigida) e 3.1 **não**
    aplicada: confirmar que a pergunta de abertura ainda ambígua pode levar o paciente a
    uma resposta que a interpretadora, mesmo corrigida, não consegue resolver sozinha —
    prova que 3.2 sozinha não basta.
- Medição contra a IA real (não só teste sintético), no padrão já usado nas frentes
  fechadas do projeto — antes de qualquer deploy.
