# Contexto de horários oferecidos na interpretação — V1

**Status:** proposta para revisão do Codex e aprovação do Gabriel. Não implementada.
Não autoriza código, migration, alteração de banco, painel ou n8n.

**Recorte (2026-08-05):** as revisões 2–6 desta spec cresceram muito além do problema
original. Por decisão do Gabriel, esta V1 cobre **exclusivamente escolha contextual de
horário**. O que foi cortado está listado na seção 8 — nada disso volta sem uma spec
própria.

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
  `opcao_escolhida`, `EtapaPendente`);
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
