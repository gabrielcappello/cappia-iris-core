# Diagnóstico — conversa real com a Luna (2026-08-30)

Branch: `iris-2`. Base: `286fe49` (Passo 1, `gpt-5.6-luna`).

Conversa real que motivou a investigação, na ordem:

1. `"ola. bom dia"`
2. `"quero um turno para hoje. tem algum horario disponivel?"`
3. `"ok pode ser"`
4. `"pode sim, maishoje esta aberto?"`
5. `"como vc disse. consulta avaliação"`
6. `"diego perez"`
7. `"não enviei nehuma msg soconfirmei dentista que vc oferceru."`
8. `"já falei diego perez"`

---

## Causa raiz confirmada — a oferta que não existe no estado

**Onde:** `src/core/contexto-horarios.ts`, `derivarAcaoContextoHorarios`.

Duas pontas do mesmo turno discordam:

| Ponta | Arquivo | O que faz |
|---|---|---|
| O que a paciente **vê** | `orquestrador.ts:595-599` | em `aguardando_procedimento`, envia `procedimento_avaliacao_disponivel` à redatora, que oferece Consulta/Avaliação e pergunta "pode ser?" |
| O que o sistema **registra** | `contexto-horarios.ts:188` | `aguardando_procedimento` cai no bloco `limpar` — nenhuma oferta é gravada |

Resultado: a Iris faz uma pergunta real e **não a registra**. No turno seguinte,
`contexto_horarios` e `aguardando_resposta` estão `null`, e a resposta da
paciente ("ok pode ser") chega à interpretadora sem nenhuma pergunta pendente
declarada.

### Por que só apareceu agora

A ação `oferecer` existe desde 2026-08-09 e é gravada corretamente em
`sem_dentista_disponivel` (`contexto-horarios.ts:92-96`). O comentário daquele
case descreve exatamente este defeito e diz que foi corrigido — mas a correção
cobriu **um** caminho de oferta, não os dois.

`aguardando_procedimento` passou a oferecer a avaliação depois disso, pelo
orquestrador, sem que a gravação correspondente fosse acrescentada. Ficou uma
oferta visível ao paciente e invisível ao estado.

Não é defeito do modelo. O `gpt-4.1-mini` convivia com a mesma lacuna porque
tende a preencher campos por inferência, mesmo sem a pergunta declarada; a Luna
segue o contrato à risca — se não há oferta pendente no payload, ela não emite
`aceitar_opcao`. O modelo novo **revelou** o defeito, não o criou.

Isto é o mesmo padrão já observado no Passo 1: a Luna não emitia
`procedimento_id` sem `procedimentos_disponiveis` no payload, e estava certa.

---

## Cadeia de consequências, turno a turno

| Turno | O que deveria acontecer | O que aconteceu |
|---|---|---|
| 2 | oferta de Consulta/Avaliação registrada | oferta feita, não registrada |
| 3 `"ok pode ser"` | `aceitar_opcao` aceita a oferta e avança | sem oferta no payload, a aceitação não é emitida; o turno não avança |
| 4 `"pode sim, mais hoje esta aberto?"` | preserva a aceitação e responde à pergunta | a aceitação continua sem destino |
| 5 `"como vc disse. consulta avaliação"` | — | a paciente precisa dizer explicitamente o que já havia aceitado |
| 6 `"diego perez"` | resolve e persiste o profissional | depende do procedimento estar resolvido |
| 7 | — | a paciente corrige a Iris sobre o que já havia dito |
| 8 | — | repetição do turno 6 |

Os turnos 3 a 8 são **consequência** do turno 2. Uma causa, não seis.

---

## Correção

Registrar a oferta no estado oficial no momento em que ela é feita — a mesma
ação `oferecer` que `sem_dentista_disponivel` já usa, agora também para
`aguardando_procedimento`.

Isso corrige na **fronteira certa**: o contrato entre o que a redatora diz e o
que o Core persiste. Não é lista de palavras, alias, regex sobre linguagem
natural nem patch para as frases desta conversa.

Consequência esperada: com `oferta_procedimento_pendente` no payload, a
interpretadora passa a ter a pergunta pendente declarada, e `aceitar_opcao`
volta a ser emitido — que é o mecanismo que os itens 1, 2 e 3 do pedido exigem.

---

## Segunda causa confirmada — pergunta adicional anulava a aceitação

**Onde:** `src/core/interpretacao-instrucoes.ts`, regra de `aceitar_opcao`.

A instrução dizia: *"Diante de recusa, hesitacao, duvida, **pergunta**, ou
pedido de outra coisa, nao emita o evento"*. Uma mensagem que aceita E pergunta
outra coisa junto contém uma pergunta — e a regra mandava descartar o evento.

Havia precedente no mesmo arquivo: `natureza_mensagem` já trata mensagem
composta explicitamente. A correção aplica o mesmo princípio: só a ausência de
aceitação impede o evento, nunca a presença de uma pergunta ao lado dela.

---

## Terceira causa confirmada — truncamento por tokens de raciocínio

**Medido** (mesmo payload, 5 execuções por modelo, `max_output_tokens = 512`):

| Modelo | Tokens de saída | Dos quais, raciocínio |
|---|---|---|
| `gpt-5.6-luna` | 87 – 160 | **47 – 121** |
| `gpt-4.1-mini` | 30 (constante) | 0 |

A Luna consome tokens de **raciocínio no mesmo orçamento** da resposta. Num
caso executado 8 vezes, **1 de 8 nesta amostra** estourou o limite e voltou
`status: incomplete, reason: max_output_tokens`.

Isso é a taxa observada **naquela amostra, naquele caso**, com o esforço padrão
(`medium`) — não uma frequência fixa por turno, e não uma previsão para a
conversa real. A medição maior abaixo (20 repetições por esforço) mostra que a
taxa depende fortemente do esforço configurado.

`MAX_OUTPUT_TOKENS = 512` foi dimensionado para um modelo que gastava 30 tokens
fixos. A produção trata o truncamento como `resposta_truncada` e repete uma vez
— o efeito visível é latência e custo da segunda chamada, e falha se as duas
truncarem.

**Sobre aumentar o limite:** `max_output_tokens` é um **teto**, não um consumo
garantido. Elevá-lo não passa a custar mais em todo turno — custa mais só nos
turnos em que o modelo de fato usa mais tokens. O que ele muda é o quanto o
modelo *pode* gastar antes de ser cortado.

**Não alterei o limite** — não foi autorizado, e a medição de esforço abaixo
mostra que existe um caminho mais barato.

---

## Um defeito que era do runner, não do produto

Ao construir o A/B, turnos da Luna voltavam `sem_saida`. Causa: **a Luna emite
um item `reasoning` antes do `message`**, e o runner varria `output` sem
filtrar por tipo.

O adaptador de produção **já estava correto** (`output.find(type === 'message')`).
Corrigido no runner apenas.

---

## Correções das causas estruturais

| # | Onde | O quê |
|---|---|---|
| 1 | `orquestrador-tipos.ts` | `aguardando_procedimento` ganha `procedimento_oferecido?` |
| 2 | `orquestrador.ts` | popula o campo com a MESMA `avaliacaoOferecivel` de `sem_dentista_disponivel` |
| 3 | `contexto-horarios.ts` | `aguardando_procedimento` grava a oferta em vez de `limpar` |
| 4 | `interpretacao-instrucoes.ts` | pergunta adicional não anula aceitação |

Espelhadas na Edge Function. Nenhuma lista de palavras, alias, regex sobre
linguagem natural ou patch para as frases desta conversa.

A configuração de `reasoning.effort` (itens 5 e 6) veio depois, com a decisão do
Gabriel — ver "Correções aplicadas — lista final" no fim do documento.

---

## Testes — e a prova de que pegam cada defeito

| Arquivo | Prova | Ao reverter |
|---|---|---|
| `contexto-horarios.test.ts` (3 casos) | a gravação da oferta | **2 de 3 falham** |
| `orquestrador-oferta-avaliacao-persistida.test.ts` | orquestrador → estado → turno seguinte → consumo | **2 de 2 falham** |
| `orquestrador-fluxo-oferta-domingo.test.ts` | conversa inteira até domingo | — |

**Confirmação da observação do Codex:** revertendo `orquestrador.ts`, os testes
de `contexto-horarios` continuam **42/42 verdes**, e só o teste de integração
novo falha. Ele estava certo — a ligação não estava provada.

---

## Fluxo completo (banco e RPC falsos, domingo 30/08/2026)

Provado em `orquestrador-fluxo-oferta-domingo.test.ts`:

- procedimento persistido (`consultation_evaluation`);
- dentista correto persistido (o escolhido, entre dois aptos);
- nenhum pedido repetido de procedimento nem de dentista;
- decisão final `sem_expediente_no_dia`, motivo `domingo` — pela regra que já
  existia em `carregar-disponibilidade.ts`, sem regra nova;
- nenhuma reserva criada;
- a decisão do último turno carrega `dentista_id` e `dentista_nome_exibido`,
  então a redatora tem o fato e não pode negar o registro.

---

## Avaliação da mensagem composta — 12 casos, 2 modelos

| Modelo | ok | erro semântico | falha técnica |
|---|---|---|---|
| `gpt-5.6-luna` | 5 | 2 | **5** |
| `gpt-4.1-mini` | 10 | 2 | 0 |

As 5 falhas técnicas da Luna são o truncamento descrito acima, não discordância.

Erros semânticos:

- **Luna:** `"pode sim, mais hoje esta aberto?"`, `"sim, so queria saber se hoje esta aberto"`
- **4.1-mini:** `"sim, so queria saber se hoje esta aberto"`, `"nao, quanto custa?"` (aceitou uma **recusa** — pior que os erros da Luna)

`"sim, só queria saber se hoje está aberto"` falha nos **dois**: é ambígua de
verdade — "só queria saber" pode ler-se como ressalva à aceitação.

---

## Matriz de `reasoning.effort` — INTERPRETADORA (512 tokens)

Runner: `src/eval/matriz-esforco-interpretadora.ts`. Varia **uma** coisa: o
esforço. Schema, instruções, payload, limite e modelo idênticos nas três
configurações. 12 casos uma vez cada, mais 20 repetições do caso que truncou.

| effort | 12 casos (ok/erro/falha) | 20× compl/incompl | out | raciocínio | visíveis | ms |
|---|---|---|---|---|---|---|
| **none** | 11/1/0 | **20 / 0** | 38 | 0 | 38 | **985** |
| low | 8/3/1 | 18 / 2 | 108 | 67 | 41 | 1903 |
| medium | 11/0/1 | 14 / **6** | 136 | 94 | 42 | 2130 |

Médias são **só dos completos** — misturar incompletos esconderia o truncamento
dentro de uma média. Motivo dos incompletos em `low` e `medium`:
`max_output_tokens` (nenhum outro).

Tokens **visíveis** são praticamente iguais nos três (38–42): o esforço não faz
a resposta útil crescer, só o raciocínio descartado antes dela.

**Configuração efetiva hoje em produção:** o adaptador **não declara**
`reasoning`, então a API aplica o padrão — `medium`, a linha com 6 truncamentos
em 20.

Erros semânticos, por esforço:

- `none` — 1: o caso negativo `oferta ausente: "ok pode ser"` (aceitou sem
  oferta no estado);
- `low` — 3 de mensagem composta + 1 truncamento;
- `medium` — nenhum erro semântico; só o truncamento.

Como `none` teve exatamente 1 erro, repeti **só aquele caso**, 10× por esforço:

| effort | violou a regra | truncou |
|---|---|---|
| none | **1 / 10** | 0 / 10 |
| medium | 0 / 10 | 1 / 10 |

O trade-off é esse, e é real: `none` elimina o truncamento e é ~2× mais rápido,
mas violou uma vez em dez a regra de não aceitar sem oferta pendente; `medium`
respeita a regra mas trunca.

---

## Matriz de `reasoning.effort` — REDATORA (300 tokens)

Runner: `src/eval/matriz-esforco-redatora.ts`. Seis cenários representativos
(dentista já escolhido, domingo, oferta de avaliação, escolha de dentista,
reserva criada, reformulação), mais 10 repetições dos dois cenários críticos.
**Duas amostras completas**, 156 chamadas no total.

Os fatos **não são escritos à mão**: cada cenário declara uma decisão real e os
fatos saem de `derivarFatosAutorizados` — a mesma função da produção. (Na
primeira versão eu havia escrito o JSON à mão e inventei um campo
`dentista_confirmado` em `sem_expediente_no_dia` que a produção nunca envia; o
runner só passou a medir o payload real depois de tirar os `as` e deixar o
compilador reprovar a forma errada.)

| effort | 6 cenários (ok/erro/falha) | out | raciocínio | visíveis | ms |
|---|---|---|---|---|---|
| none | **6/0/0** | 38 | 0 | 38 | ~1300 |
| low | **6/0/0** | 36 | 0 | 36 | ~1570 |
| medium | **6/0/0** | 77 | 41 | 36 | ~1620 |

Repetições (10× por esforço, nas duas amostras):

| cenário | none | low | medium |
|---|---|---|---|
| dentista já escolhido | 20/20 | 20/20 | 20/20 |
| domingo / sem expediente | 20/20 | 20/20 | 20/20 |

**A redatora não truncou uma única vez, em nenhum esforço** — 0 de 156. Os 300
tokens bastam com folga: a resposta visível fica em 24–44 tokens.

O raciocínio dela é quase sempre zero; sobe só no cenário (a), o único
conflituoso (paciente reclamando de repetição), e mesmo aí `medium` gasta ~105
tokens de raciocínio para produzir os mesmos ~37 visíveis.

**Controle de validade da medição** (porque três colunas idênticas levantam a
suspeita de o parâmetro não estar sendo aplicado): numa tarefa que exige
raciocínio de verdade, os três esforços se separam — `none` = 0 em 5/5, `low` =
48–60, `medium` = 0–63. O parâmetro está sendo aplicado; os zeros da redatora
são reais, não um `low` silenciosamente ignorado.

**Conclusão da redatora:** o esforço é indiferente para a qualidade dela. Só
muda custo e latência — e `medium` é o mais caro dos três sem nada em troca.

---

## Itens 4 e 5 — o que a medição respondeu

**Item 4 — resposta falsa sobre o dentista: NÃO REPRODUZIDA.** 20 execuções do
cenário exato (`"já falei diego perez"`, dentista escolhido no histórico,
paciente reclamando de repetição), em três esforços: nenhuma resposta negou o
registro, pediu o dentista de novo, nem disse que ele havia escolhido um
procedimento. Permanece **falha histórica não reproduzida** — não invento causa.

Mas a medição revelou um **fato estrutural relevante**, e este é comprovado por
leitura de código, não por suposição:

> No turno de domingo, os fatos entregues à redatora **não contêm o dentista**.
> `fatos-autorizados.ts:820-825` (`sem_expediente_no_dia`) devolve apenas
> `objetivo`, `motivo_sem_expediente` e `dados_faltantes`. O
> `dentista_nome_exibido` existe na decisão e é descartado ali.

Verificado imprimindo os fatos derivados:

```
DOMINGO -> {"objetivo":"informar_sem_expediente_e_pedir_outra_data",
            "motivo_sem_expediente":"domingo","dados_faltantes":["data"],
            "cadastro_conhecido":{...}}
```

Ou seja: naquele turno a redatora só sabe do dentista pelo `historico_recente`.
Com o histórico presente ela acertou 20/20 — mas se o histórico estivesse fora
da janela de validade, ela não teria **nenhum** fato dizendo que o profissional
já foi escolhido. Isso é uma explicação **plausível e não confirmada** para a
resposta real; não a promovo a causa, e **não alterei nada** por causa dela.

**Item 5 — domingo ponta a ponta: FUNCIONA.** 20 execuções: a resposta informa
que não há atendimento no domingo e pede outra data, sem repetir a pergunta de
procedimento nem a de dentista. O caminho até essa decisão já estava provado em
`orquestrador-fluxo-oferta-domingo.test.ts` (procedimento e dentista resolvidos,
`sem_expediente_no_dia`/`domingo`, nenhuma reserva criada).

---

## Separação exigida: comprovado × hipótese × não explicado

### Comprovado

1. A oferta não era gravada em `aguardando_procedimento` (código lido, teste que
   falha ao reverter).
2. A instrução mandava descartar aceitação com pergunta junto (texto lido).
3. A Luna trunca em 512 tokens por gastar raciocínio no mesmo orçamento — e a
   taxa depende do esforço: `medium` (o padrão em produção hoje) truncou 6 de
   20; `none`, 0 de 20.
4. Com a oferta no estado, **os dois modelos** aceitam "ok pode ser"; sem ela,
   **os dois falham** — o defeito era do estado.
5. A REDATORA não trunca com 300 tokens em nenhum esforço (0 de 156 chamadas),
   e acerta os 6 cenários representativos nos três.
6. Em `sem_expediente_no_dia` os fatos entregues à redatora **não incluem o
   dentista** — só o histórico o carrega (leitura de `fatos-autorizados.ts` +
   impressão dos fatos derivados).

### Hipótese não confirmada

- Que os turnos 6 e 8 (`"diego perez"` repetido) tenham sido **consequência**
  do turno 2. É plausível — sem procedimento resolvido, a escolha de dentista
  não avança —, mas **não reproduzi** a falha do primeiro `"diego perez"` em
  produção. Nos testes com banco falso, um único `"diego perez"` resolve e
  persiste na primeira tentativa.

### Não explicado

- **Por que o primeiro `"diego perez"` não entrou no histórico** (item 3 do
  pedido). Não tenho os logs daquele turno; sem eles, qualquer causa que eu
  apontasse seria especulação. O que posso afirmar é que o caminho, testado com
  banco falso, funciona.
- **A resposta que negou o dentista registrado** (item 4). **Não reproduzida em
  20 tentativas**, nos três esforços. O truncamento da redatora está descartado
  como causa (0 de 156). A decisão carrega `dentista_id` e
  `dentista_nome_exibido`, mas os FATOS daquele turno específico não carregam —
  só o histórico. Isso é uma explicação plausível, não confirmada: sem os logs
  do turno real, não sei se o histórico estava lá. Fica em aberto, **sem causa
  inventada e sem correção especulativa**.

---

## A decisão de configuração — matriz, recomendação e escolha

As três causas comprovadas estão corrigidas e cobertas por teste. Faltava **uma
escolha de configuração** — tomada pelo Gabriel em 2026-08-30 e registrada em
"DECISÃO APLICADA", mais abaixo. A matriz que a fundamentou fica aqui.

### A redatora não entra na decisão

Nos três esforços ela acertou tudo e nunca truncou. `none` é o mais rápido e
barato, sem nenhuma perda medida. Se a decisão da interpretadora for outra, a
redatora pode seguir o mesmo valor sem prejuízo.

### A interpretadora é onde há trade-off real

| | `none` | `low` | `medium` (hoje) |
|---|---|---|---|
| Qualidade (12 casos) | 11/12 | 8/12 | **11/12** |
| Truncamento (20×) | **0 %** | 10 % | 30 % |
| Latência | **985 ms** | 1903 ms | 2130 ms |
| Tokens de saída | **38** | 108 | 136 |
| Caso negativo (10×) | 1 erro, 0 trunc. | — | 0 erro, 1 trunc. |

`low` é dominado: erra mais que os dois e ainda trunca. Sai da disputa.

Restam duas configurações honestas, e elas erram de formas **diferentes**:

- **`none`** — nunca trunca, é 2× mais rápido, custa ⅓ dos tokens. Em troca,
  aceitou uma oferta inexistente 1 vez em 10. É um erro de *conteúdo*: a Iris
  segue adiante como se a paciente tivesse aceitado algo que não foi oferecido.
- **`medium`** — não comete esse erro, mas trunca 30 % das vezes no caso
  difícil. É um erro de *transporte*: a produção detecta (`resposta_truncada`),
  repete uma vez, e só falha se as duas truncarem.

### DECISÃO APLICADA (Gabriel, 2026-08-30)

`reasoning: { effort: "none" }` **declarado explicitamente** nas duas chamadas,
Core e Edge, com os limites **inalterados** — interpretadora 512, redatora 300.

| Onde | Antes | Agora |
|---|---|---|
| `cliente-modelo-openai.ts` | chave ausente → `medium` por padrão | `effort: none`, 512 |
| `cliente-modelo-redator-openai.ts` | chave ausente → `medium` por padrão | `effort: none`, 300 |

Declarar é o ponto: a ausência da chave **não era neutra** — a API aplicava
`medium`, o pior dos três na medição. A configuração passa a ser uma escolha
registrada, não um default herdado.

O limite ficou onde estava de propósito: a decisão foi **baixar o consumo**
(38 tokens contra 136), não elevar o teto.

#### O falso `aceitar_opcao` não autorizou alteração — e por quê

`none` emitiu `aceitar_opcao` 1 vez em 10 num caso **sem** oferta pendente. Isso
não virou correção porque o erro **morre na fronteira do Core**:

`interpretar-e-aplicar.ts:175` — `if (!aceitou || ofertaPendente === undefined)
return alteracoes;` — exige **os dois lados**: o evento da IA E a oferta oficial.
O evento sozinho é ignorado, e o `procedimento_id` aplicado vem sempre do
snapshot do Core, nunca do evento (que nem carrega id).

Confirmado por teste, como pedido:

| Teste | Prova |
|---|---|
| `aceitar_opcao SEM oferta pendente NAO aplica procedimento` | evento sozinho não vira dado, nem no retorno nem no estado |
| `aceitar_opcao COM oferta pendente aplica o id do CORE` | contraprova: muda só a existência da oferta |

O par é deliberado — sem a metade positiva, o primeiro teste passaria mesmo com
a aceitação completamente quebrada.

**Verificação de que os testes pegam o defeito:** revertendo as três proteções
(as duas chaves `reasoning` e a guarda da oferta), **exatamente os 3 testes
novos falham**, um por defeito. Restaurado em seguida.

#### Risco registrado, não bloqueante

Em `sem_expediente_no_dia` os fatos entregues à redatora **não incluem o
dentista** (`fatos-autorizados.ts:820-825`): naquele turno ela só o conhece pelo
`historico_recente`. **Não alterei** — por decisão do Gabriel, e porque a falha
não foi reproduzida e o cenário passou 20/20. Fica registrado como risco
conhecido, a revisitar só se voltar a aparecer em conversa real.

---

### Recomendação anterior (mantida como registro da análise)

**`none` na redatora** (sem trade-off: ganho puro de custo e latência).

**Na interpretadora, recomendo `none` também**, por uma razão: um erro que a
produção **detecta e trata** é preferível a um que ela **não tem como perceber**
— mas aqui é `medium` que produz o erro detectável, e `none` o silencioso. Por
isso a recomendação vem com uma condição:

> `none` só é a escolha certa **se** o caso do erro for aceitável na prática. A
> falha de `none` (aceitar sem oferta) só acontece quando não há oferta pendente
> no estado — e a correção da causa raiz 1 fez justamente com que a oferta passe
> a existir no estado sempre que a Iris a faz. O cenário do erro ficou raro por
> construção.

Se o Gabriel julgar que 1 em 10 nesse caso é inaceitável, **`medium` com
`MAX_OUTPUT_TOKENS` maior** é a alternativa defensável — e aí vale a medição de
512/768/1024 que ficou condicionada.

*(Registro histórico: esta recomendação foi feita antes da decisão. O Gabriel
escolheu `none` nas duas chamadas — ver "DECISÃO APLICADA" acima. A alternativa
`medium` com limite maior, e a medição 512/768/1024 que ficaria condicionada a
ela, **não** foram adotadas.)*

---

## Quarta causa — oferta de avaliação "para hoje" num domingo (v90)

Caso real observado **depois** do deploy da v90. Domingo, 30/08/2026:

> **Paciente:** "Quero um turno para hoje, tem algum horário disponível?"
> **Iris:** "…posso começar agendando uma Consulta / Avaliação… Você gostaria
> dessa consulta **hoje**?"

A clínica não atende aos domingos.

### Causa

`dados.data_texto` já existia antes da resolução do procedimento, mas `decidir()`
retorna `aguardando_procedimento` **antes** de chamar `resolverTemporal`. A regra
canônica de domingo mora em `carregar-disponibilidade.ts`
(`construirJornadas`: `diaSemana === 6 → sem_expediente_no_dia/domingo`), que só
é alcançada quando procedimento, dentista e duração já estão resolvidos.

Nesse desfecho **nenhum dos três existe** — então o fato nunca chegava à
redatora, e ela oferecia a avaliação para um dia fechado.

Não é defeito da Luna nem da redação: era ausência de fato.

### Solução

Uma função nova em `orquestrador.ts`, `fechamentoDaDataPedida`, chamada **apenas**
no retorno de `aguardando_procedimento`:

| Decisão | Escolha |
|---|---|
| Como resolver a data | `resolverTemporal` — a autoridade temporal já existente, que **não** precisa de procedimento nem de dentista |
| Como obter o dia da semana | `diaDaSemanaCivil`, o helper que `orquestrador.ts` **já usa**; nenhuma aritmética nova |
| Onde o fato entra | campo adicional `sem_expediente_na_data_pedida` na decisão |
| Qual decisão o turno tem | **continua** `aguardando_procedimento` |

**Só domingo, e de propósito.** Domingo é regra da *clínica* (nenhuma atende).
Sábado e dia útil dependem do *dentista* (`sabado`, `dias_semana`), que ainda não
foi escolhido neste ponto — afirmar fechamento sem saber o profissional seria
inventar fato. Esses continuam decididos onde sempre foram.

**Não faz:** leitura de agenda, jornada, bloqueio ou ocupação; RPC de horários;
reserva; regex sobre a mensagem; segunda regra independente de domingo.

**Custo real, medido** (correção pedida pelo Codex): acrescenta **uma leitura do
fuso** (`buscarFusoHorario`), e somente quando há informação temporal. O retorno
antigo de `aguardando_procedimento` acontecia **antes** dessa consulta, então ela
é de fato nova neste caminho.

| Cenário | `clinicas` no HEAD | com a correção |
|---|---|---|
| pedido **com** data (domingo) | 2 | **3** |
| pedido **com** data (dia útil) | 2 | **3** |
| pedido **sem** data | 2 | 2 |

Aceito como o menor caminho seguro: é a mesma consulta pequena que o fluxo normal
já faz adiante, e sem o fuso não há como resolver "hoje" em data civil.

**Data ausente, ambígua ou inválida devolve `null`** e nenhum fato é enviado: não
afirmar fechamento é a única saída honesta quando não se sabe qual dia o paciente
quis.

Em `fatos-autorizados.ts`, o objetivo **não muda** (`pedir_procedimento`); o
fechamento entra como `motivo_sem_expediente` + `data_referencia` — mesmo
estatuto de `preferencia_nao_localizada`, que já acrescenta nuance a um objetivo
existente. A redatora recebe os três ingredientes e combina livremente:
*não atendemos domingo* + *outro dia* + *qual procedimento / a avaliação*.
Nenhuma frase fixa.

### Testes — `orquestrador-domingo-sem-procedimento.test.ts` (10)

| Caso | O que fixa |
|---|---|
| domingo sem procedimento | fato presente **e** decisão segue `aguardando_procedimento` |
| domingo | a oferta de avaliação continua **persistida** no estado |
| domingo | nenhuma RPC, nenhuma reserva, `bloqueios` nunca lido |
| com data × sem data | o custo exato: **+1 leitura do fuso** com informação temporal, **zero** sem ela; nenhuma outra tabela a mais |
| segunda-feira | nenhum fato de fechamento; comportamento atual intacto |
| data explícita `06/09` (domingo) | mesmo comportamento de "hoje" |
| sem data | nunca afirma fechamento |
| `sexta` / `31/02/2026` / `qualquer dia desses` | nunca afirma fechamento |
| fatos (domingo) | motivo + data + avaliação + `dados_faltantes: ['procedimento', 'data']`, objetivo inalterado, **sem frase pronta** |
| fatos (dia útil) | `dados_faltantes: ['procedimento']` — a data informada continua valendo |

**Verificação — cada correção tem quem a pegue:**

| Revertendo | Testes que falham |
|---|---|
| o cálculo do fechamento (`fechamentoDaDataPedida`) | 2 (os dois de domingo) |
| `dados_faltantes: ['procedimento', 'data']` | 2 (o de ponta a ponta e o de fatos) |

Nos dois casos os demais seguem verdes — como esperado, já que fixam
comportamentos que a correção não altera.

### Duas asserções minhas estavam erradas

**1.** Eu afirmava que `agendamentos` nunca seria lido. Medi: ele **é** lido — uma
vez, tanto no domingo quanto no dia útil. É `buscarAgendamentoAtivo`, que já
existia como contexto da redatora, sem relação com este caminho.

**2.** Substituí aquilo por um teste "domingo × dia útil" e concluí que o caminho
novo *"não custa uma leitura sequer"*. **Errado, e o Codex apontou.** Aquele teste
comparava dois cenários que **já tinham a mudança** — media o custo do *domingo*,
nunca o custo da *correção*. O eixo certo é **com data × sem data**, e aí o custo
aparece: `fechamentoDaDataPedida` chama `buscarFusoHorario`, que o retorno antigo
não alcançava.

Medido contra o HEAD, o número está na tabela da seção "Solução". O teste foi
reescrito para **declarar** esse custo (`CUSTO: com informação temporal há UMA
leitura de fuso a mais; sem ela, nenhuma`) em vez de negá-lo.

O padrão dos dois erros é o mesmo: afirmei ausência a partir de uma comparação que
não tinha como revelá-la.

---

## A resposta final da Luna — avaliação real (12 × 2 execuções)

O teste determinístico prova que os **ingredientes** chegam. Não prova que a Luna
os **combina**. Medido contra a IA real, com os fatos derivados por
`derivarFatosAutorizados` (nunca escritos à mão), `effort: none`, limite 300 —
`src/eval/redatora-domingo-sem-procedimento.ts`.

### A medição que eu havia reportado inflada

Na rodada anterior reportei "conduziu para outra data: 12/12". **Aquele número não
valia.** Eu havia afrouxado o critério — passando a aceitar condução *implícita*
(oferecer a avaliação logo após informar o fechamento) — **depois** de ver o
resultado ruim (6/12) da régua original. Isso torna a régua função do resultado,
que é exatamente o vício que a medição deveria evitar.

O Codex rejeitou, com razão: oferecer o procedimento **não** deixa explícito qual
é o próximo passo temporal, e o paciente fica sem saber o que responder sobre a
data.

**O número honesto, com o critério estrito, era 16/24.**

### A causa era estrutural, e estava no fato

`dados_faltantes` continuava `['procedimento']`. Mas a data que o paciente
informou **foi recusada operacionalmente** — a clínica não atende naquele dia.
A partir desse turno faltam legitimamente **dois** dados.

O contrato da redatora já manda pedir **todos** os campos faltantes na mesma
mensagem. Declarando só o procedimento, o Core escondia dela o passo temporal —
e algumas respostas simplesmente não o mencionavam. A lacuna era do fato, não da
redação.

Correção (uma linha em `fatos-autorizados.ts`): com `sem_expediente_na_data_pedida`
presente, `dados_faltantes` passa a `['procedimento', 'data']`. Sem fechamento,
segue `['procedimento']` — a data que o paciente deu continua valendo, e pedi-la
de novo faria ele repetir o que já disse. Objetivo inalterado
(`pedir_procedimento`), nenhuma frase fixa, nenhuma instrução de domingo.

### Isolamento — uma variável de cada vez

Critério estrito e fato mudaram juntos, então medi cada um separadamente. Mesmo
modelo, mesmo critério estrito, mesmo payload; muda **só** `dados_faltantes`:

| `dados_faltantes` | conduziu para outra data (critério estrito) |
|---|---|
| `['procedimento']` | **7/12** |
| `['procedimento', 'data']` | **24/24** |

O ganho vem do fato, não da régua.

### Resultado final — critério estrito, 12 × 2 execuções

| Critério | Amostra 1 | Amostra 2 |
|---|---|---|
| informou o fechamento no domingo | **12/12** | **12/12** |
| **não** ofereceu avaliação "para hoje" | **12/12** | **12/12** |
| conduziu para outra data (**só explícito**) | **12/12** | **12/12** |
| seguiu com procedimento/avaliação | **12/12** | **12/12** |
| não inventou horário, dentista ou vaga | **12/12** | **12/12** |
| **todos os critérios na mesma resposta** | **12/12** | **12/12** |
| respostas textualmente distintas | 12/12 | 12/12 |

24 execuções, 24 respostas distintas — **nenhuma frase fixa**. ~65 tokens, ~1,7 s.

**Nenhuma instrução foi alterada** em nenhum momento. A única mudança foi no fato,
e o critério de aceitação ficou fixo antes da medição final.

---

## Correções aplicadas — lista final

| # | Onde | O quê |
|---|---|---|
| 1 | `orquestrador-tipos.ts` | `aguardando_procedimento` ganha `procedimento_oferecido?` |
| 2 | `orquestrador.ts` | popula o campo com a MESMA `avaliacaoOferecivel` de `sem_dentista_disponivel` |
| 3 | `contexto-horarios.ts` | `aguardando_procedimento` grava a oferta em vez de `limpar` |
| 4 | `interpretacao-instrucoes.ts` | pergunta adicional não anula aceitação |
| 5 | `cliente-modelo-openai.ts` | `reasoning: { effort: 'none' }` declarado; limite segue 512 |
| 6 | `cliente-modelo-redator-openai.ts` | `reasoning: { effort: 'none' }` declarado; limite segue 300 |
| 7 | `orquestrador.ts` | `fechamentoDaDataPedida` — resolve a data pedida antes de `aguardando_procedimento` |
| 8 | `orquestrador-tipos.ts` | `aguardando_procedimento` ganha `sem_expediente_na_data_pedida?` |
| 9 | `fatos-autorizados.ts` | o fechamento chega à redatora como fato adicional, objetivo inalterado |
| 10 | `fatos-autorizados.ts` | com fechamento, `dados_faltantes` passa a `['procedimento', 'data']` — a data recusada voltou a faltar |

Os itens 1–6 estão no commit `a83d723` (publicado, deploy v90). Os itens **7–9
são desta rodada** e não estão commitados.

Todas espelhadas na Edge Function. Nenhuma lista de palavras, alias, regex sobre
linguagem natural ou patch para as frases desta conversa.

## Verificação

| Gate | Resultado |
|---|---|
| Testes específicos (effort/oferta) | **138/138** |
| Testes do domingo | **10/10** |
| Suíte completa | **1595/1598** — as 3 falhas são os testes de integração que exigem `@supabase/supabase-js`, pré-existentes e não relacionados |
| `deno check` (Core + eval) | 4 erros, **todos** `@supabase/supabase-js` ausente — idênticos aos de antes da mudança |
| `deno check` (Edge) | 4 erros `EdgeRuntime`, **idênticos antes e depois** (global existe no runtime Supabase, não no Deno CLI) |
| Paridade Core/Edge | **restaurada** — única diferença é um comentário que já era exclusivo da cópia Edge |
| Testes falham com defeito revertido | **3 de 3**, um por proteção |

## Estado

**Itens 1–6:** commit `a83d723`, publicado em `origin/iris-2`, deploy **v90**
(ACTIVE, `verify_jwt: true`). Rollback registrado: v89.

**Itens 7–9 (correção do domingo):** apenas na árvore de trabalho da branch
`iris-2` — **sem commit, push ou deploy**, aguardando revisão do Codex. A
produção v90 ainda apresenta o comportamento descrito na quarta causa.

Nenhuma alteração de banco, migrations, secrets, workflow ou instância de
WhatsApp em nenhum momento.
