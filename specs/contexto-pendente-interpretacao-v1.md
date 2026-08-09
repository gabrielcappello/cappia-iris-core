# Contexto pendente na interpretação — V1

**Status:** implementada (horário, 2026-08-05/06). **Revisão 2026-08-09:** estendida com
uma segunda forma de pergunta pendente — oferta de procedimento (seção 11). A extensão
está **especificada e provada contra a IA real, não implementada**.

**Recorte (2026-08-05):** as revisões 2–6 desta spec cresceram muito além do problema
original. Por decisão do Gabriel, a V1 cobriu **exclusivamente escolha contextual de
horário**. O que foi cortado está listado na seção 8 — nada disso volta sem aprovação
explícita, e a seção 11 é a primeira exceção registrada.

> **Sobre o nome.** O conceito sempre foi "contexto pendente" (o nome deste arquivo); a
> implementação é que ficou com forma de horário (`estado_conversa.contexto_horarios`,
> tipo `ContextoHorarios`). Com a segunda variante o nome físico passa a ser
> conceitualmente impreciso. **A correção adotada é documental, não um rename** — ver
> seção 12 para o custo medido e o motivo.

Estende `interpretacao-ia.md`. Não altera `interpretacao-natureza-mensagem-v1.md`.

## Problema

A Iris oferece "Horários livres para 05/08: 14:00, 15:00, 16:00, 17:10. Qual você
prefere?" e o paciente responde "15 hrs". A IA recebe só a mensagem atual e os dados
acumulados (procedimento, data) — **nunca** os horários que acabaram de ser oferecidos.
Sem isso, "15 hrs" isolado é ambíguo, a IA omite o campo pela regra correta de "em
dúvida real, omita", e o Core repete a mesma lista indefinidamente.

Confirmado por captura real do payload enviado à OpenAI (não por suposição):
`{mensagens_atuais, dados_atuais, campos_cadastrais_preenchidos}` — sem pergunta
pendente, sem opções.

## Escopo: exatamente estas respostas

| Resposta | Como fica coberta |
|---|---|
| `"15"` · `"15 hrs"` · `"quinze horas"` · `"o segundo"` | Pelo snapshot `horarios_oferecidos` desta spec |
| `"esse mesmo"` | Por `dados_atuais.horario_texto`, que **já** existe no estado de confirmação — sem snapshot |

A distinção é deliberada e foi verificada no código: para o Core chegar em
`aguardando_confirmacao`, `derivarModoConsulta` exige `resultado.horario_min !==
undefined`, que só existe se `montarFatosTemporais` recebeu `dados.horario_texto`.
Nesse estado o horário já está em `dados` e já é enviado à IA por `dados_atuais`.
Gravar snapshot ali seria duplicar um dado que a IA já tem — por isso
`aguardando_confirmacao` **não** grava (seção 4).

## 1. O que é persistido

Uma coluna nova em `estado_conversa`, server-only:

```ts
// estado_conversa.contexto_horarios  (jsonb, nullable)
interface ContextoHorarios {
  horarios: string[];  // ["13:00","14:00","15:00"] na ordem exata apresentada
  criado_em: string;   // ISO, so para auditoria
}
```

Só isso. Sem `etapa`, sem `pergunta`, sem `valor`/`rotulo` separados — para horário,
o que é exibido ao paciente **é** a identidade canônica (`"14:00"` é exatamente o que
`horario_texto` já aceita hoje). A ordem do array carrega o ordinal ("o segundo"),
sem campo de posição.

`contexto_horarios` representa **a última lista de horários gerada** para envio ao
paciente — nunca "entregue" ou "visualizada" (a Edge Function não tem essa
visibilidade; é do transporte, fora desta camada).

## 2. Nenhuma mudança no que a IA devolve

O schema de saída (`natureza_mensagem` + `alteracoes`) fica **idêntico**. A IA continua
devolvendo `horario_texto: "15:00"` exatamente como já faz hoje — o snapshot só a ajuda
a entender *qual* horário o paciente quis dizer.

Isso dispensa, para horário, todo o mecanismo de `opcao_escolhida`/`valor` canônico que
as revisões anteriores desenhavam: ali o problema era a IA produzir um identificador
(`dentista_id`); aqui não há identidade a proteger — é uma string de horário que o
Core valida contra a disponibilidade real de qualquer forma, igual a quando o paciente
digita "14h" direto.

## 3. Contrato enviado à IA

```ts
interface EntradaInterpretacao {
  mensagens_atuais: string[];
  dados_atuais: Partial<Record<CampoOperacionalInterpretacao, string>>;
  campos_cadastrais_preenchidos: CampoCadastralInterpretacao[];
  horarios_oferecidos?: string[]; // NOVO -- ausente quando nao ha snapshot
}
```

Um único campo novo. Nenhum histórico de mensagens. Nenhum outro contexto.

Uma regra nova em `INSTRUCOES_EXTRATOR`: quando `horarios_oferecidos` estiver presente,
interpretar a mensagem atual como possível escolha dentre esses horários — por valor
("15", "15 hrs", "quinze horas") ou por ordinal ("o segundo") — e preencher
`horario_texto` com o horário correspondente no formato `HH:MM` já vigente. Em dúvida
real sobre qual horário, omitir o campo (regra de sempre). Nunca inventar horário fora
da lista quando a mensagem for claramente uma escolha; uma menção nova e explícita a
outro horário ("na verdade prefiro 17:30") segue o caminho normal, sem restrição à
lista.

## 4. Quando é gravado

Dentro de `processarMensagem`, **depois** que `decidir()` já rodou pelo motivo que já
roda hoje — nunca uma chamada extra a `decidir()`.

| Ação | Decisões |
|---|---|
| **Substituir** | `horarios_disponiveis` com `resultado.tipo === 'opcoes'` (horários na ordem gerada) · `horarios_disponiveis` com `resultado.tipo === 'horario_exato_indisponivel'` (os vizinhos oferecidos, `anterior` e `posterior`, na ordem em que aparecem no texto) |
| **Preservar** | `saudacao` · `duvida_livre` · `mensagem_nao_compreendida` — desvios de passagem, não devem apagar a pergunta em andamento |
| **Limpar** (`null`) | Todos os demais estados |

**Por que "limpar" é o padrão, e não "preservar":** uma lista de horários pendurada
compete com uma pergunta que passou a ser sobre outra coisa. Caso concreto: a Iris
oferece 13:00/14:00/15:00 → o paciente pede outra data → o Core cai em
`sem_disponibilidade` ("não achei horário, quer tentar outra data?") ou
`aguardando_data_horario` → o paciente responde **"dia 15"**. Com a lista antiga ainda
presente, a IA tem incentivo forte a ler "15" como 15:00 em vez do dia 15. Limpar
sempre que a pergunta deixa de ser sobre escolher entre horários elimina essa
ambiguidade na origem.

As três exceções preservadas são justamente as que **não** fazem pergunta nova: são
desvios de passagem (cumprimento, dúvida solta, mensagem não compreendida) — depois
delas a pergunta pendente continua sendo a mesma de antes, e apagar o snapshot faria a
Iris repetir a lista sem motivo.

Em conversa nova, `contexto_horarios` começa `null` — nunca fabricado antes de uma
lista ter sido de fato gerada.

Os horários são formatados pela mesma função que `gerarRespostaPaciente` já usa, a
partir da mesma decisão — nunca reconstruídos do texto da resposta, nunca recalculados.

## 5. Como é gravado

Escrita própria, **depois** da que `aplicarDados` já faz. Reaproveita o mesmo padrão de
concorrência otimista que `aplicarDados` usa hoje, sem generalizá-lo:

1. **Sem leitura fresca.** O `atualizado_em` usado na condição é o **exato valor do
   estado sobre o qual esta decisão foi calculada** — nunca um relido logo antes do
   `UPDATE`.
2. `UPDATE estado_conversa SET contexto_horarios = <candidato>, atualizado_em =
   proximoTimestamp(<atualizado_em_da_decisao>) WHERE id = <conversa_id> AND
   clinica_id = <clinica_id> AND telefone_normalizado = <telefone> AND atualizado_em =
   <atualizado_em_da_decisao>` — sempre isolado por clínica e conversa, nunca `UPDATE`
   cego.
3. `0` linhas afetadas: **abandonar imediatamente**. Sem reler, sem recalcular, sem
   reaplicar o candidato, sem retry. Silenciosamente, sem lançar erro e sem afetar a
   resposta já decidida ao paciente.

**Por que abandonar em vez de tentar de novo** (ajuste do Codex): reler e repetir
rebaseia uma operação obsoleta sobre um estado novo. Caso concreto: a operação A
calcula "substituir por [13:00, 14:00]"; antes de ela gravar, a operação B mais nova
grava "limpar" (o paciente desistiu, ou a reserva foi criada). Se A relesse e tentasse
de novo, o CAS passaria e A **ressuscitaria** horários já apagados — a Iris voltaria a
oferecer uma lista que não vale mais. Amarrar a condição ao `atualizado_em` da decisão
faz o CAS falhar exatamente nesse caso, e abandonar é a resposta correta: a decisão de
A foi calculada sobre um estado que já não existe.

**Por que perder a gravação é aceitável:** `contexto_horarios` só ajuda a *interpretar*
a próxima mensagem. Perdê-lo degrada a conversa (a Iris pode repetir a lista), nunca
produz agendamento errado — a disponibilidade é sempre recalculada do zero antes de
qualquer ação. Segurança e simplicidade têm prioridade sobre rebase.

**Implicação de implementação declarada:** para usar o `atualizado_em` da decisão sem
reler, o Core precisa carregá-lo até o ponto da escrita. Hoje nenhum dos dois pontos
que estabelecem esse estado o expõe: `ResultadoIdentificacao` devolve
`conversa: {id, estado, dados}` e `ResultadoAplicarDados` devolve
`{conversa_id, dados, campos_*}` — nenhum inclui `atualizado_em`. São necessários dois
campos **aditivos**, sem mudança de comportamento em nenhuma das duas funções, e o
valor a usar é:

```ts
const atualizadoEmDaDecisao =
  interpretacao.aplicacao?.atualizado_em ?? identificacao.conversa.atualizado_em;
```

(`aplicacao` é `null` quando a mensagem não produziu nenhuma alteração aplicável — aí
o estado da decisão é o mesmo que `identificarConversa` leu.)

*(Consequência do recorte: sem persistência crítica de dentista nesta V1, não é preciso
contador de revisão nem escrita atômica com propagação de erro — as duas peças mais
pesadas das revisões anteriores desaparecem.)*

## 6. Leitura

No mesmo `SELECT` que `identificarConversa` já faz. Vai direto para
`EntradaInterpretacao` como `horarios_oferecidos`, sem nenhum cálculo — nunca via
`decidir()`, `carregarCatalogo` ou `carregarEntradaDisponibilidade`.

## 7. Garantias que não mudam

- **O snapshot nunca autoriza reserva.** `confirmacao === 'sim'` continua a única
  autoridade, verificada por `decidirConfirmacaoOuReserva` exatamente como hoje.
- **O snapshot nunca é fonte de disponibilidade.** Serve só para interpretar a
  linguagem da resposta; o Core recalcula tudo antes de agir.
- **Opção já indisponível segue o fluxo normal.** Se o horário escolhido não estiver
  mais livre, o caminho existente de `horario_exato_indisponivel`/`reserva_conflito`
  responde — nenhuma lógica nova.
- **Ordinal continua válido mesmo com a grade mudada.** Como o snapshot é congelado no
  momento em que a lista foi gerada, "o segundo" se refere à posição 2 da lista que o
  paciente realmente viu, mesmo que o primeiro horário já tenha expirado. Depois, o
  Core recalcula.
- Nenhuma alteração em `resolver-temporal.ts`, `resolver-disponibilidade.ts`,
  `resolver-procedimento.ts`, `resolver-dentista.ts`, `aplicar-dados.ts`,
  `reservar-agendamento.ts` ou na RPC.

## 8. Explicitamente fora desta V1

Cortado do desenho anterior, não volta sem spec própria:

- escolha contextual de dentista;
- `dentista_id_resolvido` e sua persistência entre turnos;
- limpeza de `dentista_texto` na troca de procedimento;
- generalização para qualquer tipo de opção (`OpcaoOferecida` com `valor`/`rotulo`,
  `opcao_escolhida`, `EtapaPendente`) — **continua fora**; a seção 11 acrescenta UMA
  segunda variante concreta, não um mecanismo genérico de opções;
- `contexto_revisao` / contador de revisão;
- alteração de `aplicar-dados.ts`;
- envio de `pergunta_pendente` à IA;
- histórico de mensagens no payload.

## 9. Testes obrigatórios

**Unidade:**
- Extração dos horários nos dois casos que substituem (tabela da seção 4), com a ordem
  exata da lista gerada preservada — incluindo o caso de `horario_exato_indisponivel`
  com apenas um vizinho (`anterior` ou `posterior` sozinho).
- Ciclo de vida completo: substituir (2 casos), preservar (3 casos), limpar (amostra
  representativa dos demais, obrigatoriamente incluindo `aguardando_confirmacao`,
  `sem_disponibilidade`, `aguardando_data_horario`, `reserva_criada` e `desistencia`).
- **`aguardando_confirmacao` limpa o snapshot e "esse mesmo" continua funcionando**,
  porque `dados_atuais.horario_texto` já carrega o horário nesse estado (regressão da
  decisão da seção "Escopo").
- Montagem do payload inclui `horarios_oferecidos` quando há snapshot, omite quando
  `null`, e nunca chama `decidir`/`carregarCatalogo`/`carregarEntradaDisponibilidade`.
- Gravação isolada por clínica e conversa: o `UPDATE` emitido contém as condições de
  `id`, `clinica_id`, `telefone_normalizado` e `atualizado_em` (verificado na instrução
  emitida pelo dublê, não só no estado final).
- **A condição usa o `atualizado_em` da decisão, não um relido:** dublê que altera o
  estado entre a decisão e a escrita confirma que o valor na condição é o anterior — e
  que nenhum `SELECT` extra é emitido antes do `UPDATE`.
- **CAS falho abandona na hora:** `0` linhas afetadas produz exatamente uma instrução
  `UPDATE` no total — nenhuma releitura, nenhuma segunda tentativa — sem lançar erro e
  sem alterar a resposta ao paciente.
- **Operação obsoleta não ressuscita horários:** candidato "substituir" calculado sobre
  um estado que, nesse meio-tempo, foi limpo por uma operação mais nova → o `UPDATE`
  falha e `contexto_horarios` permanece `null`.

**Integração (sem IA real):**
- Snapshot congelado `["13:00","14:00","15:00"]` com disponibilidade real já diferente
  (13:00 expirou): `horario_texto: "14:00"` vindo da IA resolve normalmente.
- Mesmo cenário com 14:00 já ocupado: cai em conflito/indisponível pela via existente,
  sem lógica nova.
- `horario_texto` presente, sem `confirmacao === 'sim'`: nunca reserva.

**Real contra a OpenAI** (script avulso, mesmo padrão de
`teste-real-normalizacao-horario.ts`):
- `"15"`, `"15 hrs"`, `"quinze horas"`, `"o segundo"`, com `horarios_oferecidos`
  simulado — cada um resolve para o horário esperado.
- `"esse mesmo"` com `dados_atuais.horario_texto` preenchido e **sem**
  `horarios_oferecidos` (estado de confirmação) — confirma que o caso funciona pelo
  caminho já existente, sem snapshot.
- Negativo: mensagem sobre outro assunto, com snapshot presente, não inventa
  `horario_texto`.
- Negativo: horário explícito fora da lista ("na verdade prefiro 17:30") é preservado
  como dito, nunca forçado para o mais próximo da lista.
- Negativo (ambiguidade que motivou a regra de limpar): **sem** `horarios_oferecidos`
  (snapshot já limpo por `sem_disponibilidade`), a mensagem `"dia 15"` produz
  `data_texto`, nunca `horario_texto: "15:00"`.

## 10. Migration implicada (declarada, não escrita aqui)

Uma coluna nova em `estado_conversa`: `contexto_horarios jsonb` (nullable). RLS herdada
do padrão vigente da tabela (ativa, sem policy, só `service_role`). Alvo:
`udizowyfjnhuhgxkeayk` (operacional) e `bcmuqautblvjdqzhjfbw` (isolado de
desenvolvimento e testes), migrations em pastas separadas conforme a convenção já
estabelecida. Migration e rollback escritos só depois desta spec ser aprovada.

---

## 11. Segunda variante: oferta de procedimento pendente (2026-08-09)

**Aprovada pelo Gabriel em 2026-08-09.** Especificada e provada contra a IA real; ainda
não implementada.

### Problema

A Iris oferece *"Não encontrei nenhum profissional para clareamento. Posso agendar uma
Consulta/Avaliação?"* e o paciente responde `"pode ser"`. Hoje isso produz
`alteracoes: {}` e `natureza_mensagem: nao_compreendida` — a conversa morre numa
aceitação perfeitamente normal.

**Diagnóstico (medido, não suposto).** Não é falha de compreensão, é falta de
autorização. Mesma mensagem crua `"pode ser"`, mesmo modelo, mesmo catálogo, mesmo
histórico, variando só o canal de pergunta pendente:

| Canal presente no payload | Resultado |
|---|---|
| Nenhum (só `historico_recente`) | `{}` · `nao_compreendida` — **3/3** |
| `proposta_pendente` (horário) | `confirmacao: sim` · `resposta` — **3/3** |

O modelo entende concordância nua perfeitamente **quando existe um marcador declarativo
do que está aberto**. `historico_recente` é descritivo (*o que foi dito*); os marcadores
são declarativos (*o que está pendente*). Contexto descritivo não autoriza escrita de
campo — e a instrução de `confirmacao` ensina exatamente isso ao dizer que uma
concordância solta sem `proposta_pendente` nunca vale.

Além disso, o Core **sabe** que fez a oferta (decisão `sem_dentista_disponivel`) e
descarta esse fato: `derivarAcaoContextoHorarios` mapeia essa decisão para `limpar`.

### A variante

```ts
interface ContextoHorarios {           // nome físico preservado, ver seção 12
  horarios?: string[];
  proposta_pendente?: { data: string; horario: string };
  oferta_procedimento_pendente?: { procedimento_id: string };   // NOVO
  criado_em: string;
}
```

Genérica por construção: carrega **qualquer** `procedimento_id` oferecido. Não há nada
sobre Consulta/Avaliação no tipo, no Core ou na instrução — é o orquestrador que decide
o que oferecer, e hoje só a avaliação é oferecida.

As três variantes continuam **mutuamente exclusivas**: gravar uma substitui o snapshot
inteiro, nunca faz merge (regra já vigente para `propor`).

### Contrato enviado à IA — apenas a EXISTÊNCIA da oferta

```ts
oferta_procedimento_pendente?: true;   // ausente quando não há oferta
```

**Sem o `procedimento_id`.** O Core guarda o id no snapshot (é ele quem vai aplicar); a
IA não precisa dele para julgar se a frase é uma aceitação — o que foi oferecido já está
no histórico, em português, que é o que ela lê.

Isso não é economia de bytes: mandar o id era o que **puxava** o modelo a emiti-lo. Com o
id fora do payload, o atrator desaparece — é a correção estrutural do caso
`"prefiro outra coisa"`, não mais uma regra de prompt.

Custo zero de infraestrutura: nenhuma migration, nenhum rename, nenhum mecanismo novo. O
snapshot continua em `estado_conversa.contexto_horarios` (jsonb) guardando
`{ procedimento_id }`; só o que atravessa para a IA encolhe para `true`.

### O sinal de saída: `aceitar_opcao` (contrato canônico já aprovado)

`eventos-conversacionais-v1.md` §2 já define este evento, **pelo nome e para este caso**:

> *"Sinaliza possível aceitação de uma opção ou proposta explicitamente apresentada pelo
> Core. Abrange: escolha de um horário oferecido; aceitação da proposta de substituir o
> procedimento por Consulta/Avaliação."*
>
> *"Consulta/Avaliação não possui evento próprio. O Core reutiliza `aceitar_opcao` e valida
> que o contexto pendente oficial é a proposta de substituição."*

A saída da interpretação ganha um terceiro campo raiz, na forma canônica:

```ts
eventos_candidatos: Array<{ tipo: 'aceitar_opcao'; referencia_textual: string | null }>;
```

`referencia_textual` é mantido conforme o contrato (decisão do Gabriel, 2026-08-09): `null`
para concordância deítica (`"pode ser"`), preenchido quando houver referência explícita na
mensagem. A própria spec canônica usa `"pode ser"` como o exemplo de `null`.

Obrigatório e possivelmente vazio (`[]`), como a canônica exige — `strict: true` do
Structured Outputs obriga todos os campos raiz a estarem presentes.

**Somente `aceitar_opcao` entra nesta rodada.** Verifiquei que nenhum dos outros quatro
eventos é necessário para ele funcionar: recusa é a **ausência** do evento, e pedido de
outro procedimento já é coberto pela regra normal de `procedimento_id`.
`solicitar_nova_opcao`, `desistir`, `aceitar_qualquer_profissional` e `confirmar_resumo`
permanecem fora.

### Quem aplica o procedimento: o Core

A IA **nunca** emite `procedimento_id` por causa de uma aceitação. Ela produz o candidato
semântico; o Core faz o resto:

1. lê `oferta_procedimento_pendente.procedimento_id` do snapshot oficial (nunca da IA);
2. exige `aceitar_opcao` entre os candidatos **e** uma oferta pendente — os dois, sempre;
3. aplica o procedimento oferecido, pela mesma validação de integridade de sempre.

Isso desfaz a sobrecarga que motivou toda esta rodada: `procedimento_id` volta a
significar uma coisa só — *qual procedimento o paciente pediu*.

**Ganho não previsto:** o Core também decide a AÇÃO. `informar` quando não havia
procedimento, `corrigir` quando havia outro — determinístico, a partir do snapshot que ele
já leu. Isso elimina uma fragilidade real medida em 2026-08-09: quando a IA escolhia a
ação sozinha, um `informar` sobre um campo já preenchido virava conflito em `preAplicar` e
a aceitação era **descartada em silêncio**.

### `confirmacao` não é usada para isso

Decisão explícita do Gabriel: `confirmacao = sim` continua reservada à confirmação de
**criação do agendamento** (`proposta_pendente` → `decidirConfirmacaoOuReserva`). Aceitar
uma oferta de procedimento preenche `procedimento_id` e nada mais — o fluxo segue pelo
caminho normal, e a reserva continua exigindo a confirmação própria depois.

### Quatro desfechos, sem enum novo

A oferta pendente admite quatro leituras da mensagem seguinte. Nenhuma exige tipo novo:
`natureza_mensagem` e `procedimento_id` já bastam.

| Situação | `procedimento_id` | `natureza_mensagem` |
|---|---|---|
| Aceitação | o id oferecido | `resposta` / `pedido` |
| Recusa real | ausente | `negacao` |
| Escolhe outro procedimento | o **novo** id (regra normal, não a da oferta) | `correcao` / `pedido` |
| **Dúvida ou comentário sobre a oferta** | **ausente** | `duvida` |

Os dois últimos dependem da distinção que a IA já faz. Dúvida **não é recusa**: o campo
fica ausente nos dois casos, mas o que acontece com a oferta é diferente — ver abaixo.

### Ciclo de vida: a regra mínima

**Uma única linha muda:** `sem_dentista_disponivel` sai de `limpar` e ganha ação própria
`oferecer`. Todo o resto da tabela da seção 4 fica intacto.

Isso basta — e a razão é que a oferta **não precisa ser preservada, porque é
re-derivada**. Rastreando o caso concreto que o Gabriel levantou:

1. Paciente: *"queria um clareamento"* → zero aptos → `sem_dentista_disponivel` →
   **oferecer** (grava a oferta).
2. Paciente: *"quanto custa a avaliação?"* → a IA não aceita (dúvida), `alteracoes` vazio,
   `natureza = duvida`. Em `decidirPorNatureza`, `duvida` só vira `duvida_livre` quando
   **não há** procedimento conhecido — aqui há (`whitening`), então retorna `null` e o
   fluxo segue o caminho normal: mesmo procedimento, mesmos zero aptos,
   `sem_dentista_disponivel` de novo → **oferecer** grava a oferta idêntica.
3. Paciente: *"pode ser"* → a oferta está lá → aceita.

A oferta sobrevive porque a **situação** que a produziu não mudou, não porque alguém a
protegeu. É auto-corretiva: qualquer turno que mude a situação (aceitar, pedir outro
procedimento, desistir) deixa de produzir `sem_dentista_disponivel` e cai numa decisão
que já limpa. `mensagem_nao_compreendida` continua em **preservar**, como já estava.

### Guarda obrigatória: só oferecer o que é possível

Sem isto a mudança criaria um ciclo infinito. Se a Consulta/Avaliação também não tiver
dentista apto, o paciente aceitaria a oferta, o turno seguinte cairia em zero aptos **para
a avaliação**, ofereceria a avaliação outra vez, e assim por diante — exatamente o ciclo
que `dentistas-vinculos-v1.md` §12 regra 1 proíbe.

Portanto `sem_dentista_disponivel` passa a carregar `procedimento_oferecido?: string`,
preenchido **somente** quando as três condições valem:

- o procedimento pedido **não é** ele mesmo a Consulta/Avaliação;
- a Consulta/Avaliação existe e está ativa na clínica;
- existe **ao menos um dentista apto** para ela.

Sem as três, o campo fica ausente, a ação volta a ser `limpar` (comportamento de hoje) e a
resposta **não faz a pergunta** — hoje ela faz sempre, e essa pergunta é uma promessa que
o Core não tem como cumprir.

### Histórico das medições (por que a proposta mudou duas vezes)

Registrado porque cada medição matou uma hipótese, e a spec seria pior sem elas.

| Tentativa | Resultado |
|---|---|
| Só `historico_recente`, sem marcador | `"pode ser"` → `{}` · `nao_compreendida` **3/3**. Contexto descritivo não autoriza. |
| Marcador **com** o `procedimento_id`, sonda com `dados_atuais: {}` | 9/9 — **resultado inválido**: `dados_atuais` vazio não é o estado de produção. |
| Mesmo marcador, `dados_atuais` **realista** (`procedimento_id` já preenchido) | Desabou: `"pode ser"` → `nat=negacao`, que produz `desistencia`. **Pior que hoje.** |
| Instrução reformulada como *substituição* | Aceitações corretas com `corrigir`, mas `"prefiro outra coisa"` passou a **aceitar** a oferta, 3/3. |

A terceira linha é a lição mais cara: uma sonda que não reproduz o estado real produz um
número bonito e falso. A quarta mostrou que o problema não se resolve no prompt — duas
formulações, cada uma consertando um lado e quebrando o outro.

O que as quatro têm em comum: enquanto o `procedimento_id` oferecido estiver no payload, o
modelo é puxado a emiti-lo. **Tirar o id e mover o sinal para `aceitar_opcao` remove a
causa, não o sintoma.**

### Prova exigida antes de fechar

Contra a IA real, com `dados_atuais.procedimento_id` **preenchido** (estado de produção):

| Cenário | Esperado |
|---|---|
| oferta pendente + `"pode ser"` | `aceitar_opcao`, `referencia_textual: null` |
| oferta pendente + `"sim, quero"` | `aceitar_opcao` |
| oferta pendente + `"prefiro outra coisa"` | **sem** `aceitar_opcao` |
| oferta pendente + `"na verdade quero limpeza"` | `procedimento_id: cleaning` pela regra normal, **sem** `aceitar_opcao` |
| **sem** oferta pendente + `"pode ser"` | **sem** `aceitar_opcao` (controle A/B) |

Em nenhum caso a IA emite `procedimento_id` por causa da aceitação. Nenhuma dessas frases
entra no prompt.

### Impacto da mudança

| Onde | O quê |
|---|---|
| `SaidaInterpretacao` + validação | terceiro campo raiz `eventos_candidatos`, obrigatório, pode ser `[]` |
| `SCHEMA_PORTATIL_APROVADO` | **lista duplicada e hardcoded** — alterar no mesmo commit, ou o modelo nunca emite o evento |
| `EntradaInterpretacao` | `oferta_procedimento_pendente` passa de `{procedimento_id}` para `true` |
| `INSTRUCOES_EXTRATOR` | a regra da oferta deixa de mandar preencher `procedimento_id` e passa a descrever o evento |
| `interpretarEAplicar` | aplica o procedimento ofertado quando há `aceitar_opcao` **e** oferta pendente; decide `informar`/`corrigir` pelo snapshot |
| `ContextoHorarios` | **inalterado** — continua guardando `{procedimento_id}` |
| Banco | **nada**: sem migration, sem coluna, sem rename |

É a primeira vez que a saída da interpretação ganha um campo raiz — daí o aval explícito
antes de implementar.

### Garantias que não mudam

- O snapshot **nunca autoriza reserva**: `confirmacao === 'sim'` continua a única
  autoridade.
- O snapshot **nunca é fonte de disponibilidade**.
- O `procedimento_id` aceito passa pela **mesma validação de integridade** de sempre
  (existe, é da clínica, está ativo) — a oferta não cria atalho.
- **`aceitar_opcao` é candidato, nunca decisão** (`eventos-conversacionais-v1.md` §1): sem
  oferta pendente no estado oficial, o evento é simplesmente ignorado. A IA nunca aplica
  procedimento por conta própria.
- Perder a gravação continua degradando a conversa, nunca produzindo agendamento errado.

## 12. Nome físico: custo medido e decisão

Com a segunda variante, `contexto_horarios` / `ContextoHorarios` passa a nomear algo mais
amplo do que descreve. Três opções, medidas:

| Opção | Custo | Veredito |
|---|---|---|
| Rename completo (tipo + funções + coluna) | **159 ocorrências em 24 arquivos**, migration nos 2 bancos, coordenação código↔deploy | Desproporcional ao ganho |
| Rename só no TypeScript | ~120 ocorrências, e cria divergência entre nome no código e nome da coluna | **Menos honesto** que hoje |
| Documentar a divergência na origem | 3 pontos: doc do tipo, título desta spec, seção 8 | **Adotado** |

Motivo adicional para não fazer migration agora: a coluna `ultima_troca` **continua no
banco sem nenhum uso em código** desde `historico-conversacional-v1.md`. Já existe dívida
de limpeza de coluna. Se um rename de `contexto_horarios` for feito algum dia, deve
**andar junto com o drop de `ultima_troca`, numa migration só** — nunca duas janelas
separadas de risco por motivo estético.
