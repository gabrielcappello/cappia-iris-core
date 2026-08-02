# Resolvedor Temporal v1

**Status:** especificação canônica — formaliza o contrato conceitual já anunciado na
seção "Resolução temporal" de `composicao-novo-agendamento-v1.md` (`§13.5` no momento
desta publicação; consultar o documento pelo título, nunca presumir a numeração).
Define contrato lógico e comportamento; não autoriza implementação, criação de tipo
TypeScript, alteração de banco, criação de tabelas, migration ou schema físico.

Esta especificação complementa `composicao-novo-agendamento-v1.md`,
`controlador-conversacional-v1.md`, `eventos-conversacionais-v1.md`,
`interpretacao-ia.md`, `novo-agendamento.md` e `disponibilidade.md`. Permanecem fixas
as decisões de `../docs/02-arquitetura.md` e `../docs/04-decisoes-canonicas.md`: a IA
interpreta somente a mensagem atual e nunca decide; o Core determinístico resolve;
Supabase/Postgres é a fonte oficial.

**Nenhum tipo real publicado é redefinido aqui.** `InstanteAtual`, `Periodo` e
`RestricaoHoraria` são reutilizados exatamente como existem em
`src/core/disponibilidade-tipos.ts` — os nomes e formas abaixo citam essas fontes
diretamente, nunca inventam alternativas.

## 1. Objetivo

Definir, de forma fechada, como fatos temporais **já interpretados pela IA** (texto
estruturado por campo, nunca data ou horário calculados) são convertidos em fatos
temporais **oficiais** — data civil, minuto local, período, restrição e intenção — por
uma função pura e determinística, análoga em espírito aos quatro componentes de domínio
já publicados (procedimento, dentistas/vínculos, duração, disponibilidade).

## 2. Responsabilidade

O resolvedor temporal:

- recebe átomos temporais estruturados, o instante oficial atual e o fuso da clínica;
- produz exatamente um resultado de uma união fechada (seção 21);
- decide se uma expressão já interpretada resolve, é ambígua, está incompleta, é
  inválida, está no passado, conflita com outro fato, ou não pode ser avaliada por
  configuração inválida da clínica;
- **não pertence ao controlador** (`composicao-novo-agendamento-v1.md` §13.5) — é
  chamado por ele, como os quatro componentes já publicados, nunca o contém.

Função pura: não chama IA, não acessa banco, não acessa calendário, não lê relógio da
máquina, não considera procedimento, dentista ou duração, não gera opções de horário,
não altera estado e não cria efeitos.

## 3. Fora do escopo

Ver seção 30 (lista completa). Resumo: parser livre de português, acesso à agenda,
geração de opções de disponibilidade, busca entre datas, conversão UTC/IANA/DST,
persistência, schema físico e qualquer decisão que pertença ao controlador ou à
disponibilidade.

## 4. Contrato de entrada

Entrada conceitual — **pseudotipo, não implementação**:

```text
interface EntradaResolucaoTemporal {
  clinica_id: string;
  fuso: string;                    // campo IRMÃO, nunca aninhado em instante_atual
  instante_atual: InstanteAtual;   // { data: string; minuto_min: number } — já publicado
  fatos_temporais: readonly AtomoTemporal[];  // seção 5
}
```

`InstanteAtual` é reutilizado **exatamente** como publicado em
`src/core/disponibilidade-tipos.ts`: `{ data: string; minuto_min: number }`. `fuso` é
campo irmão da entrada, no mesmo nível de `clinica_id` — nunca aninhado dentro de
`InstanteAtual`, porque `InstanteAtual` já é a forma fechada usada por
`EntradaDisponibilidade` e por `resolver-disponibilidade.ts`, e este resolvedor precisa
produzir fatos compatíveis com aquele contrato sem alterá-lo.

Não são criados: `data_local`, `minuto_local`, `instante_atual.fuso`, ou qualquer nome
alternativo para os dois campos já existentes.

`clinica_id` serve exclusivamente para isolamento e rastreabilidade (seção 26). As
regras civis (calendário, horário, período) são universais — `clinica_id` nunca altera
uma regra de calendário ou de conversão de horário 12h/24h.

## 5. Contrato dos fatos temporais estruturados

`fatos_temporais` (seção 4) é **sempre uma lista**, `readonly AtomoTemporal[]` — nunca
um objeto único achatado por mensagem. Esta é a única forma que representa
corretamente fatos simultâneos: duas datas, duas intenções, duas restrições, ou um
horário exato coexistindo com uma restrição — todos precisam de mais de um átomo na
mesma leva para serem representáveis e para que este resolvedor possa detectar
conflito entre eles (seção 20). Um contrato de objeto único não consegue expressar
"dois fatos da mesma categoria"; por isso a lista é o contrato principal, não uma
alternativa.

Cada item da lista é um `AtomoTemporal` com **discriminador `tipo` fechado**. Quatro
camadas distintas, que **não precisam ser idênticas** (seção 6):

1. **schema portátil da IA** — array achatado, compatível com Structured Outputs
   `strict: true` (seção 6);
2. **validação estrutural do Core** — a primeira barreira depois de receber a saída
   da IA: contrato de forma (tamanho da lista, discriminador conhecido, campos
   presentes) antes de qualquer interpretação de domínio;
3. **tipos internos normalizados** — a forma desta seção, já validada e agrupada por
   categoria (seção 20), podendo usar união aninhada convencional, já que nunca
   atravessa uma API de modelo;
4. **tipos oficiais resolvidos** — a saída de `ResultadoResolucaoTemporal` (seção 21),
   que reaproveita `Periodo` e `RestricaoHoraria` publicados.

Esta seção descreve a camada 3. A camada 1 (seção 6) é a forma portátil de cada átomo
individual dentro da lista.

### Regras da lista

- pode conter **zero ou mais** átomos;
- **preserva múltiplos átomos da mesma categoria** — duas datas, duas intenções, duas
  restrições, dois horários exatos — cada um mantido como item distinto, nunca
  mesclado nem descartado silenciosamente;
- o **resultado não depende da ordem** dos átomos na lista — duas listas com os
  mesmos átomos em ordem diferente produzem o mesmo resultado (mesmo princípio de
  determinismo já exigido dos quatro resolvedores publicados);
- antes de aplicar qualquer regra de domínio, o resolvedor **normaliza internamente
  por categoria** (todos os átomos de data juntos, todos os de horário exato juntos,
  todos os de restrição juntos, etc.) — isso é o que permite detectar "duas datas"
  como categoria, não como comparação ad-hoc entre itens específicos;
- **limite máximo de 8 átomos por mensagem** (seção 6) — acima disso, `invalido`
  (`quantidade_atomica_excedida`, seção 19), nunca truncamento silencioso da lista.

### Data absoluta

```text
{ tipo: 'data_absoluta'; dia: number; mes: number; ano: number | null }
```

`ano` ausente aciona a regra de ano omitido (seção 11).

### Data relativa

Fechado, somente três valores — nenhum outro (ex.: "ontem", "semana que vem" como data
relativa) é aceito nesta v1:

```text
{ tipo: 'data_relativa'; valor: 'hoje' | 'amanha' | 'depois_de_amanha' }
```

### Dia da semana

```text
{
  tipo: 'dia_semana';
  dia: 'domingo' | 'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta' | 'sabado';
  qualificador: 'esta' | 'proxima' | null;
}
```

A IA decide o qualificador **antes** de produzir o átomo — "segunda que vem" só chega
como `qualificador: 'proxima'` quando a interpretação for inequívoca (seção 12); o
resolvedor nunca vê o texto original e nunca infere qualificador a partir de palavras
como "que vem".

### Horário exato

Átomo próprio, com campos próprios — **nunca compartilhados com o átomo de
restrição** (seção "Restrição" abaixo). Internamente distingue a mesma forma fechada
de cinco variantes de horário:

```text
{
  tipo: 'horario_exato';
  forma: 'horario_24h' | 'horario_12h' | 'meio_dia' | 'meia_noite'
         | 'horario_nao_classificado';
  hora: number | null;         // presente em horario_24h/horario_12h
  minuto: number | null;       // presente em horario_24h/horario_12h
  parte_dia: 'am' | 'pm' | null;  // presente somente em horario_12h
}
```

`forma: 'horario_nao_classificado'` existe para a IA sinalizar "havia um horário na
mensagem, mas não coube em nenhuma das outras quatro formas" — nunca é silenciosamente
descartado nem tratado como ausência de horário; produz sempre `ambiguo`
(`horario_nao_classificado`, seção 17), nunca `invalido`, nunca ignorado.

### Restrição

Átomo próprio, com **campos próprios do horário-limite** — mesma forma fechada de
cinco variantes que o horário exato, mas em campos com nome distinto, nunca reutilizados
do átomo `horario_exato`:

```text
{
  tipo: 'restricao';
  tipo_restricao: 'inicio_ate' | 'termino_ate';
  forma_limite: 'horario_24h' | 'horario_12h' | 'meio_dia' | 'meia_noite'
                | 'horario_nao_classificado';
  hora_limite: number | null;
  minuto_limite: number | null;
  parte_dia_limite: 'am' | 'pm' | null;
}
```

Separar os dois átomos é o que permite representar, na mesma mensagem, "10h e preciso
terminar até 11h" como dois fatos simultâneos e compatíveis: um átomo `horario_exato`
(`hora: 10, minuto: 0`) e um átomo `restricao` (`tipo_restricao: 'termino_ate',
hora_limite: 11, minuto_limite: 0`) — nunca um único átomo tentando carregar os dois
valores.

### Período

Reutiliza o tipo já publicado, sem alteração:

```text
{ tipo: 'periodo'; valor: Periodo }   // 'manha' | 'tarde' | 'noite', de disponibilidade-tipos.ts
```

### Intenção

```text
{ tipo: 'intencao'; valor: 'data_especifica' | 'proxima_disponibilidade' }
```

Mesma distinção já canônica em `novo-agendamento.md` §9 — este resolvedor produz o fato
estruturado, nunca redecide o significado da distinção.

**Nenhum resultado oficial (seção 21) contém texto livre.** O átomo pode carregar
texto internamente durante a interpretação (fora do escopo deste resolvedor), mas o
resultado produzido por este componente nunca inclui `data_texto`, `horario_texto` ou
qualquer valor de string livre — somente inteiros, enums fechados e os tipos oficiais
já publicados.

## 6. Compatibilidade com JSON Schema strict

Requisitos que o schema real (implementação futura, não desta rodada) deverá cumprir,
herdados sem exceção do padrão já aprovado em `interpretacao-ia.md` ("Cláusula
registrada") e `eventos-conversacionais-v1.md` §4 (`strict = true`,
`additionalProperties: false` em todos os níveis):

- **array fechado de objetos** no campo `fatos_temporais` — nunca objeto único; cada
  elemento do array é um átomo (seção 5);
- **limite máximo de itens no array** (seção 5: 8 átomos) — o schema deve expressar
  esse limite explicitamente (`maxItems`, ou equivalente do provedor), nunca confiar
  somente na validação posterior;
- cada objeto do array tem **discriminador `tipo` obrigatório**, nunca inferido por
  presença/ausência de outro campo;
- propriedades conhecidas e listadas em cada objeto — nenhum campo livre;
- variantes simples — cada átomo é achatado **dentro de si mesmo** (discriminador +
  campos irmãos nulos quando não aplicáveis ao subtipo), evitando união profundamente
  aninhada dentro de um único átomo; a multiplicidade de fatos é resolvida pelo
  **array**, nunca por aninhamento dentro de um objeto;
- campo opcional representado de forma compatível com o provedor: em modo `strict`,
  toda chave listada em `properties` deve constar em `required`; ausência é
  representada por permitir `null` como membro do tipo do campo, nunca por omitir a
  chave — mesmo dentro de cada átomo do array;
- `additionalProperties: false` em todo objeto, em todo nível — raiz, cada átomo, e
  qualquer subestrutura;
- sem sobreposição ambígua entre variantes — dois discriminadores nunca podem
  descrever o mesmo conjunto de campos preenchidos de forma indistinguível;
- sem depender de coerção de tipo (string numérica, string booleana);
- valores fechados representados por enum explícito, nunca string livre;
- inteiros com domínio explícito documentado (ex.: `dia` em `1..31`, `mes` em `1..12`,
  `hora` em `0..23` ou `1..12` conforme a variante, `ano` em `1..9999`, seção 9);
- ausência de valor sempre representada da mesma forma em todo o schema (`null`),
  nunca ora por omissão ora por sentinela numérico;
- formato compatível com validação posterior no Core — o schema aceito pelo provedor
  não substitui a validação determinística deste resolvedor (mesmo princípio já
  aplicado a `duracao-v1.md` §2: "a validação do painel não dispensa a validação do
  Core"). **Um objeto achatado único não é suficiente** — foi a forma originalmente
  cogitada e descartada nesta rodada, precisamente porque não consegue representar
  dois fatos da mesma categoria simultaneamente.

### Forma recomendada: array de átomos achatados, cada um com discriminador próprio

Cada item de `fatos_temporais` é achatado **dentro de si mesmo**, seguindo exatamente
as formas fechadas da seção 5 (`data_absoluta`, `data_relativa`, `dia_semana`,
`horario_exato`, `restricao`, `periodo`, `intencao`) — mesmo padrão já usado por
`EntradaInterpretacaoModelo` em `interpretacao-ia.md` para achatamento de campo
opcional, aplicado agora por átomo em vez de por mensagem inteira:

```text
AtomoTemporalPortatil[]   // fatos_temporais — array, maxItems: 8

// cada elemento, achatado dentro de si mesmo:
{
  tipo: 'data_absoluta' | 'data_relativa' | 'dia_semana' | 'horario_exato'
        | 'restricao' | 'periodo' | 'intencao';

  // campos de data_absoluta:
  dia: number | null;
  mes: number | null;
  ano: number | null;

  // campo de data_relativa:
  data_relativa: 'hoje' | 'amanha' | 'depois_de_amanha' | null;

  // campos de dia_semana:
  dia_semana: 'domingo' | 'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta'
              | 'sabado' | null;
  qualificador_dia_semana: 'esta' | 'proxima' | null;

  // campos de horario_exato (nunca reutilizados por restricao):
  forma_horario: 'horario_24h' | 'horario_12h' | 'meio_dia' | 'meia_noite'
                 | 'horario_nao_classificado' | null;
  hora: number | null;
  minuto: number | null;
  parte_dia: 'am' | 'pm' | null;

  // campos de restricao (próprios, distintos dos de horario_exato):
  tipo_restricao: 'inicio_ate' | 'termino_ate' | null;
  forma_limite: 'horario_24h' | 'horario_12h' | 'meio_dia' | 'meia_noite'
                | 'horario_nao_classificado' | null;
  hora_limite: number | null;
  minuto_limite: number | null;
  parte_dia_limite: 'am' | 'pm' | null;

  // campo de periodo:
  periodo: 'manha' | 'tarde' | 'noite' | null;

  // campo de intencao:
  intencao: 'data_especifica' | 'proxima_disponibilidade' | null;
}
```

Múltiplos fatos da mesma categoria (duas datas, duas restrições, duas intenções) são
representados por **múltiplos elementos do array** com o mesmo `tipo`, cada um com seus
próprios valores — nunca por um segundo conjunto de campos dentro do mesmo objeto.

Esta forma é **recomendação documental**, não implementação. O nome exato dos campos
pertence à implementação futura; a exigência fixada aqui é estrutural: array com limite
máximo de itens, discriminador `tipo` obrigatório por elemento, achatamento dentro de
cada elemento, campos irmãos nulos quando não aplicáveis, e campos de `horario_exato`
nunca compartilhados com os de `restricao`.

### Quatro camadas, não três

Distinção completa (seção 5): **1.** schema portátil da IA (esta seção); **2.**
validação estrutural do Core (tamanho do array, discriminadores conhecidos, forma de
cada átomo — antes de qualquer regra de domínio); **3.** tipos internos normalizados,
agrupados por categoria (seção 5); **4.** resultado oficial do resolvedor (seção 21).
Nenhuma das quatro precisa ser idêntica a outra.

## 7. Configuração de fuso

`fuso` é obrigatório na entrada (seção 4), string IANA (`America/Sao_Paulo`), mesma
exigência já aprovada em `disponibilidade.md` §2 e em
`composicao-novo-agendamento-v1.md` §4.1 (`ConfiguracaoClinicaMinima.fuso`).

Este resolvedor:

- **não** valida a existência real do fuso na tzdb — isso pertence ao adaptador
  futuro (seção 28), que já terá resolvido `instante_atual` a partir de um fuso válido
  antes de chamar este componente;
- valida apenas o **contrato estrutural** recebido, com dois motivos fechados
  distintos (seção 21):
  - `fuso` ausente (`undefined`/`null`) → `erro_configuracao` (`fuso_ausente`);
  - `fuso` presente mas não é string não vazia (tipo errado, ou string vazia/só
    espaços) → `erro_configuracao` (`fuso_formato_invalido`);
- nunca fuso padrão inventado, nunca assunção de UTC, em nenhum dos dois casos.

Se preservado em algum log técnico de auditoria (fora do resultado oficial, que nunca
o inclui — seção 21), `fuso` é sempre tratado como string estrutural limitada, nunca
ecoado como valor bruto dentro de uma mensagem de erro.

## 8. Instante atual

Reutiliza `InstanteAtual` publicado, sem alteração de forma. Obrigatório — sem ele este
resolvedor não teria como aplicar as regras de passado (seção 16), mesma justificativa
já registrada para `EntradaDisponibilidade.instante_atual`
(`disponibilidade-tipos.ts`: "torná-lo opcional seria falha ABERTA").

Responsabilidades do **adaptador futuro** (nunca deste resolvedor):

- obter o timestamp oficial (ex.: relógio do servidor);
- validar o fuso IANA da clínica;
- converter o timestamp para data civil e minuto local nesse fuso;
- tratar mudança de horário de verão (DST) na conversão;
- fornecer `instante_atual` já estável, em forma local, a este resolvedor.

Este resolvedor:

- **não** usa `Date.now()` nem qualquer relógio de execução;
- **não** usa o fuso horário da máquina onde roda;
- **não** converte UTC para local nem local para UTC;
- **não** decide se um instante é ambíguo por causa de DST — essa responsabilidade é
  do adaptador, antes de `instante_atual` chegar aqui.

Mesma disciplina já aplicada em `resolver-disponibilidade.ts`.

## 9. Datas absolutas

Calendário gregoriano, mesma regra já implementada em `resolver-disponibilidade.ts`
(`dataCivilValida`/`anoBissexto`) e reaproveitada aqui sem alteração:

- ano bissexto: `(ano % 4 === 0 e ano % 100 !== 0) ou ano % 400 === 0`;
- dias por mês: 31, 28(29), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31;
- `mes` fora de `1..12` é `invalido`;
- `dia` fora do limite do mês (considerando bissexto) é `invalido`;
- **nenhuma troca silenciosa de dia e mês** — `dia` e `mes` são campos distintos do
  átomo (seção 5); um valor de `dia` maior que 12 nunca é reinterpretado como mês;
- **nenhuma correção automática** — data inexistente nunca “desliza” para o mês
  seguinte (mesma proteção já documentada em `resolver-disponibilidade.ts`: sem
  `Date`, porque o construtor do JavaScript aceita `2026-02-30` e desliza
  silenciosamente para março).

Quando `ano` está presente e explícito, a data resultante é validada por essas regras
e, se válida, passa para a checagem de passado (seção 16) — sem qualquer ajuste de ano.

### Domínio fechado do ano

Duas noções distintas, nunca confundidas:

**Domínio civil** — o intervalo de anos que este resolvedor pode representar ou
alcançar, em qualquer cálculo (inclusive a busca de ano omitido, seção 11): `1..9999`.
Nenhum ano fora desse intervalo é examinado, produzido ou inferido, em nenhuma
circunstância.

**Ano explícito aceito na entrada** — o subconjunto do domínio civil que um átomo
`data_absoluta` com `ano` **explícito** pode legitimamente informar: `100..9999`.
Um valor fora desse subconjunto, mas dentro do domínio civil (`1..99`), não é
promovido a século nenhum — é rejeitado.

Quatro faixas fechadas, mutuamente exclusivas, cobrindo todo `ano` numérico explícito
recebido:

| Faixa | Classificação |
|---|---|
| `ano <= 0` | `invalido`, campo `data`, motivo `ano_fora_do_dominio` |
| `1 <= ano <= 99` | `invalido`, campo `data`, motivo `ano_dois_digitos` — **sempre**, nunca expandido para nenhum século |
| `100 <= ano <= 9999` | domínio válido; segue para validação civil (dia/mês/bissexto) |
| `ano > 9999` | `invalido`, campo `data`, motivo `ano_fora_do_dominio` |

Um `ano` explícito de um ou dois dígitos (ex.: `26`) é **sempre** `ano_dois_digitos` —
nunca uma questão de "parecer" truncado; é uma regra de domínio fechada sobre o valor
numérico recebido, sem depender de inferência. Nenhum século é inferido, em nenhuma
circunstância. A data civil oficial resolvida (`data`, seção 21) é sempre representada
como `YYYY-MM-DD` com quatro dígitos de ano.

## 10. Datas relativas

Fechado, três valores (seção 5): `hoje`, `amanha`, `depois_de_amanha`. Resolvidos por
aritmética de calendário sobre `instante_atual.data` — nunca por `Date`:

- `hoje` → `instante_atual.data`;
- `amanha` → o dia civil seguinte a `instante_atual.data`, respeitando fim de mês e
  virada de ano;
- `depois_de_amanha` → dois dias civis após `instante_atual.data`.

Nenhum outro valor relativo (`ontem`, `semana que vem`, `mês que vem`) é aceito nesta
v1 (seção 30).

## 11. Ano omitido

Quando `data_absoluta.ano` é `null`: resolver como a **primeira ocorrência civil
válida de `(dia, mes)` que não esteja no passado**.

Algoritmo — janela de **nove candidatos**: **o ano atual mais os oito anos
seguintes** (nunca "oito anos incluindo o atual" — formulação ambígua, descartada):

1. `ano_candidato` começa no ano de `instante_atual.data`;
2. montar a data candidata com `dia`/`mes`/`ano_candidato`;
3. se `(dia, mes, ano_candidato)` forma uma data civil válida (seção 9) **e** essa data
   é **maior ou igual** a `instante_atual.data` (comparação lexicográfica sobre
   `YYYY-MM-DD`, que coincide com a ordem cronológica para datas de largura fixa já
   validadas) → **resolvida** com essa candidata — **hoje é permitido**: uma candidata
   igual a `instante_atual.data` resolve para hoje, nunca avança para outro ano;
4. caso contrário (candidata civilmente inválida naquele ano — ex.: 29 de fevereiro em
   ano não bissexto — **ou** válida mas já passada) → incrementar `ano_candidato` em 1
   e repetir o passo 2, **respeitando o teto de `9999`** (seção 9): se
   `ano_candidato` excederia `9999`, a busca para sem examinar esse candidato — nenhum
   ano acima de `9999` é examinado, sem exceção;
5. o passo 4 se repete até **avançar no máximo oito anos a partir do ano atual** —
   nove candidatos ao todo (o ano de `instante_atual.data` e os oito seguintes),
   suficiente para cobrir integralmente o ciclo de recorrência de 29 de fevereiro
   (no máximo um salto de oito anos entre ocorrências bissextas consecutivas,
   considerando também o caso não-secular de 100/200/300);
6. se nenhuma das nove candidatas examinadas (ou menos, quando a janela for truncada
   pelo teto de `9999`) for civilmente válida e não passada → `invalido`, campo
   `data`, motivo `ano_fora_do_dominio` (seção 19) — este resolvedor não busca além
   dessa janela;
7. **nunca escolher ano anterior** ao ano de `instante_atual.data`, em nenhuma
   circunstância.

Exemplo obrigatório: `instante_atual.data` = `2096-03-01`, `(dia, mes)` = `(29, 2)`
(29 de fevereiro sem ano). Candidatos, na ordem: `2096` (bissexto, mas
`2096-02-29 < 2096-03-01` — já passado), `2097`, `2098`, `2099` (não bissextos —
civilmente inválidos), `2100` (não bissexto — múltiplo de 100 mas não de 400),
`2101`, `2102`, `2103` (não bissextos) e `2104` (bissexto e futuro) → resultado
`2104-02-29`. Nove candidatos examinados (`2096` a `2104`), o último deles dentro da
janela — confirma que a janela cobre até oito anos **além** do atual, nunca menos.

Exemplo do teto: `instante_atual.data` com ano `9998` e `(dia, mes)` = `(29, 2)`.
Candidatos: `9998`, `9999` — a janela pararia naturalmente em `10006`, mas o teto de
`9999` corta a busca ali; se nenhum dos dois for civilmente válido e futuro →
`invalido` (`ano_fora_do_dominio`), nunca um overflow, wrap ou inferência de ano
acima de `9999`.

A validade temporal de um horário ou de uma restrição associados a essa data, quando a
data resolvida é hoje, é avaliada separadamente pela regra de passado (seção 16) — o
ano omitido resolve somente a **data civil**, nunca decide sozinho se o momento
completo (data + horário) já passou.

## 12. Dias da semana

### Semana civil — decisão fechada

**Segunda-feira é o primeiro dia da semana civil.** A semana civil vai de
segunda-feira a domingo, nesta ordem — domingo é o **último** dia da semana, nunca o
primeiro. Esta regra:

- é fixa e universal nesta v1 — não depende de locale, sistema operacional, biblioteca
  de data ou timezone da máquina onde o resolvedor roda;
- não é configurável por clínica;
- é a única convenção usada por `qualificador: 'esta'` abaixo.

### Regras de resolução

- `qualificador: 'proxima'` → a primeira ocorrência do dia da semana pedido
  **estritamente posterior** a `instante_atual.data` — hoje nunca conta, mesmo quando
  hoje já é esse dia da semana;
- `qualificador: 'esta'` → a ocorrência do dia da semana pedido dentro da semana civil
  de segunda a domingo que contém `instante_atual.data`;
  - se essa ocorrência é anterior a `instante_atual.data` → resultado `passado`
    (`dia_semana_esta_passado`, seção 16);
  - se é igual ou posterior → `resolvido`;
  - exemplo: hoje é quinta-feira; "esta segunda" refere-se à segunda-feira da mesma
    semana civil (já passada em relação a hoje) → `passado`; "este domingo" refere-se
    ao domingo que encerra a mesma semana civil (ainda não chegou) → `resolvido`;
- `qualificador: null` (ausente) → **sempre `ambiguo`**
  (`dia_semana_sem_qualificador`, seção 17), nunca escolhido silenciosamente entre
  "esta" e "próxima";
- a decisão de mapear uma expressão como "segunda que vem" para `qualificador:
  'proxima'` pertence à interpretação (IA), nunca a este resolvedor — ele só recebe o
  qualificador já estruturado e nunca infere a partir de texto (seção 5).

## 13. Horários

Domínio oficial: minuto civil `0..1439` (mesmo domínio `[0, 1440)` de
`disponibilidade-tipos.ts`, com `1440` reservado a `fim_min` de intervalo, nunca a um
horário pontual). Vale igualmente para `horario_exato` (`hora`/`minuto`) e para o
horário-limite de `restricao` (`hora_limite`/`minuto_limite`, seção 5) — mesmo domínio,
campos distintos.

- `00:00` = minuto `0`;
- `23:59` = minuto `1439`;
- meio-dia = minuto `720`;
- meia-noite = minuto `0` (mesmo valor de `00:00` — `meio_dia`/`meia_noite` são só
  formas alternativas de expressar os mesmos dois instantes, nunca horários
  distintos);
- `hora`/`hora_limite` fora de `0..23` (forma `horario_24h`) ou fora de `1..12` (forma
  `horario_12h`) é `invalido` (`hora_fora_do_dominio`, seção 19);
- `minuto`/`minuto_limite` fora de `0..59` é `invalido` (`minuto_fora_do_dominio`,
  seção 19);
- `24:00` é **inválido** (`horario_24_00`, seção 19) — nunca convertido
  automaticamente para `00:00` do dia seguinte (isso mudaria a data, uma decisão que
  este resolvedor nunca toma implicitamente a partir de um horário);
- minuto que não é múltiplo de 10 é **preservado exatamente como recebido** — nenhum
  arredondamento, nenhum truncamento; a granularidade de 10 minutos pertence somente à
  busca de vizinhos em `disponibilidade.md` §9, nunca à validação de entrada deste
  resolvedor nem à validação de horário exato em `disponibilidade-tipos.ts`.

### Conversão 12 horas → 24 horas

Fórmula fechada, sem exceção — aplicada igualmente a `horario_exato` e ao
horário-limite de `restricao`:

| `hora` (1–12) | `parte_dia` | Minuto resultante |
|---|---|---|
| 12 | `am` | `0` (meia-noite) |
| 1–11 | `am` | `hora * 60 + minuto` |
| 12 | `pm` | `720` (meio-dia) |
| 1–11 | `pm` | `(hora + 12) * 60 + minuto` |

A hora `12` é o único caso em que a conversão ingênua (`hora + 12`) produziria valor
errado — por isso a tabela é explícita e fechada, não uma fórmula única aplicada a
todos os casos.

### Hora 12 sem classificação explícita

"12 da manhã", "12 da tarde" e "12 da noite" são expressões do português
**semanticamente ambíguas** por si mesmas — nenhuma delas é mapeada automaticamente
para AM/PM, `meio_dia` ou `meia_noite` sem que a interpretação (IA) já tenha
classificado explicitamente o átomo como `forma: 'meio_dia'`, `forma: 'meia_noite'`,
ou como `horario_12h` com `parte_dia: 'am'`/`'pm'` explícito.

Um átomo `horario_exato` (ou o horário-limite de `restricao`) com hora `12`
acompanhado **somente** de um átomo `periodo` separado (`manha`/`tarde`/`noite`,
seção 5) — sem `parte_dia` e sem `forma` já resolvida para `meio_dia`/`meia_noite` —
é sempre `ambiguo` (`hora_12_com_parte_dia_ambigua`, seção 17). Este resolvedor nunca
infere de qual dos dois instantes (`00:00` ou `12:00`) o paciente falou a partir de
"manhã"/"tarde"/"noite" sozinhos.

### Horário sem AM/PM — regra de período (hora 1 a 11)

Para hora em `1..11` sem `parte_dia`: os dois candidatos possíveis são sempre
`hora * 60 + minuto` (leitura "AM") e `(hora + 12) * 60 + minuto` (leitura "PM"). Como
os dois candidatos distam exatamente 720 minutos, **nunca pertencem ao mesmo período**
(seção 14) — o candidato "AM" cabe apenas em manhã; o candidato "PM" cabe em tarde ou
em noite, conforme o valor.

- se um `Periodo` (seção 5) acompanha o mesmo conjunto de fatos **e** exatamente um dos
  dois candidatos pertence a esse período → resolvido com esse candidato;
- se **nenhum** dos dois candidatos pertence ao período informado → `conflito`
  (`periodo_incompativel_com_horario`, seção 20) — os dois fatos são individualmente
  compreensíveis, mas incompatíveis com os limites canônicos de período
  (`disponibilidade.md` §8);
- se nenhum período acompanha o horário → `ambiguo` (`horario_sem_parte_dia`, seção
  17). **Nunca assumir manhã por padrão, nunca escolher silenciosamente entre
  `08:00` e `20:00`.**

Exemplos fechados, para eliminar qualquer ambiguidade residual:

| Horário | Período informado | Resultado |
|---|---|---|
| hora `8` | `manha` | `resolvido`, `08:00` (único candidato manhã) |
| hora `8` | `noite` | `resolvido`, `20:00` (único candidato noite) |
| hora `8` | `tarde` | `conflito` (`periodo_incompativel_com_horario`) — nem `08:00` (manhã) nem `20:00` (noite) é tarde |
| hora `3` | `tarde` | `resolvido`, `15:00` (único candidato tarde) |
| hora `8` | *(ausente)* | `ambiguo` (`horario_sem_parte_dia`) |

**`8` combinado com `tarde` nunca resolve para `20:00`** — 20:00 pertence a `noite`
(`>= 18:00`), nunca a `tarde` (`> 12:00` e `< 18:00`), pelos limites canônicos já
fixados (seção 14).

### Horário sem data

Quando um átomo `horario_exato` está presente, mas nenhuma data (absoluta, relativa ou
dia da semana) acompanha o mesmo conjunto de fatos, e nenhum átomo de intenção
`proxima_disponibilidade` está presente (que tem regra própria, seção 16): resultado
`incompleto` (`horario_sem_data`, seção 18).

## 14. Períodos

Reutiliza `Periodo` publicado, sem alteração de limite:

- manhã: início `<= 12:00`;
- tarde: início `> 12:00` e `< 18:00`;
- noite: início `>= 18:00`.

O período resolvido por este componente é **filtro**, nunca jornada — este resolvedor
não cria intervalo de trabalho algum; ele só produz o valor de `Periodo` que a
disponibilidade usará como filtro (`ModoConsulta`, variante `grade`).

**Nenhuma configuração por clínica destes limites nesta v1.** Os três limites são
universais, mesma decisão já vigente em `disponibilidade.md` §8.

## 15. Restrições

Reutiliza `RestricaoHoraria` publicado — somente as duas variantes já canônicas:

- **`inicio_ate`**: a opção deve começar em minuto **menor ou igual** ao limite;
- **`termino_ate`**: a opção deve terminar em minuto **menor ou igual** ao limite.

Este resolvedor produz o **critério** (`RestricaoHoraria { tipo, minuto_min }`); ele
**não recebe duração e não consulta agenda** — cabe à disponibilidade aplicar o
critério contra as opções reais (`disponibilidade.md` §13, já canônico).

### Compatibilidade com horário exato — responsabilidade distinta por tipo

**`inicio_ate`**: o resolvedor **pode** verificar compatibilidade com um horário
exato simultâneo, porque `inicio_ate` restringe diretamente o mesmo valor que o
horário exato já fornece (o minuto de início) — nenhuma duração é necessária para essa
comparação:

- `horario_exato <= limite` → ambos os fatos resolvidos simultaneamente, sem conflito;
- `horario_exato > limite` → `conflito` (`horario_viola_inicio_ate`, seção 20) — os
  dois fatos, juntos, não podem produzir nenhuma opção válida.

**`termino_ate`**: o resolvedor **não pode** verificar compatibilidade final apenas com
o horário de início, porque `termino_ate` restringe o **fim** (`fim = início +
duração`), e este resolvedor nunca recebe duração (seção 2). Portanto:

- horário exato e `termino_ate` simultâneos são **sempre preservados como critérios
  oficiais simultâneos** no resultado `resolvido` (seção 21) — **nunca** declarados
  `conflito` com base somente no horário de início, mesmo quando os valores parecerem
  incompatíveis à primeira vista (ex.: horário exato `10:00` com `termino_ate`
  `10:30` pode ou não ser viável, dependendo da duração do procedimento — algo que
  este resolvedor não sabe);
- a compatibilidade final entre horário exato e `termino_ate` é verificada
  **posteriormente pela disponibilidade**, que conhece a duração oficial e o fim real
  da opção (`disponibilidade.md` §13);
- `ModoConsulta` (`disponibilidade-tipos.ts`) hoje só aceita `restricao` na variante
  `grade`, não na variante `horario_exato` — uma composição posterior dos dois
  critérios (horário exato **e** `termino_ate` simultâneos) pode exigir extensão de
  `ModoConsulta` em rodada futura; **nenhum tipo real é alterado por esta
  especificação**.

### Demais casos

- duas restrições distintas na mesma leva de fatos (ex.: `inicio_ate` e `termino_ate`
  simultâneos, ou duas ocorrências de `inicio_ate` com limites diferentes) →
  `conflito` (`restricoes_conflitantes`, seção 20); este resolvedor nunca combina duas
  restrições em uma só;
- restrição sem data → mesma regra de "horário sem data" (seção 13): `incompleto`
  (`restricao_sem_data`, seção 18), salvo intenção `proxima_disponibilidade` sem data
  (seção 16, "hoje" como início);
- restrição cujo limite já está no passado (hoje, com o minuto-limite igual ou
  anterior a `instante_atual.minuto_min`) → `passado`
  (`inicio_ate_passado`/`termino_ate_passado`, seção 16);
- **"depois das 15h" não é suportado** — ver detalhe abaixo (decisão registrada em
  `docs/04-decisoes-canonicas.md`, seção "Resolvedor temporal", bullet "Depois das
  15h"; referenciado pelo conteúdo, não por número de item).

### "Depois das 15h" — limite inferior não suportado

Esta v1 não define restrição de limite inferior (um hipotético `inicio_apos`). A
expressão é **clara** para o paciente, mas o domínio atual não a modela — por isso o
resultado não é `ambiguo` (não há múltiplas leituras possíveis) nem `incompleto` (não
falta dado): é **`invalido`**, com motivo fechado `restricao_nao_suportada` (seção
19). Este resolvedor nunca converte silenciosamente "depois das 15h" em `inicio_ate`,
em horário exato, ou em período — as três conversões são explicitamente proibidas. A
resposta ao paciente diante desse motivo pertence a `atendimento-v1.md`, fora desta
especificação.

**Não existe limite inferior nesta v1.** Criar um exigiria nova decisão de produto e
nova especificação — não é antecipado aqui.

## 16. Passado

Regras fechadas, todas herdadas de `disponibilidade.md` §15 e da comparação estrita já
implementada em `resolver-disponibilidade.ts` (`inicioNoFuturo`). Cada caso produz
`{ tipo: 'passado'; motivo: MotivoPassadoTemporal }` (seção 21), com motivo fechado:

- data anterior a `instante_atual.data` → `passado` (`data_passada`);
- `instante_atual.data` (hoje) sem horário nem restrição associados → **resolvido
  temporalmente** — "hoje" sozinho não é passado; a filtragem pelo instante exato é
  responsabilidade exclusiva da disponibilidade (ver nota abaixo);
- hoje com horário cujo minuto é **menor ou igual** a `instante_atual.minuto_min` →
  `passado` (`horario_passado`) — mesma comparação estrita já usada por
  `disponibilidade.md` (um início igual ao instante atual nunca é oferecido);
- hoje com horário **estritamente posterior** ao instante atual → `resolvido`;
- `inicio_ate` hoje com limite menor ou igual a `instante_atual.minuto_min` →
  `passado` (`inicio_ate_passado`) — nenhum início válido poderia satisfazer o limite
  e ainda ser futuro;
- `termino_ate` hoje com limite menor ou igual a `instante_atual.minuto_min` →
  `passado` (`termino_ate_passado`) — pela mesma razão, considerando que duração é
  sempre positiva;
- `qualificador: 'esta'` cuja ocorrência já passou nesta semana civil → `passado`
  (`dia_semana_esta_passado`, seção 12);
- data estritamente futura (posterior a `instante_atual.data`) nunca é `passado`,
  independentemente do horário associado.

### Próxima disponibilidade sem data

Intenção `proxima_disponibilidade` sem nenhum átomo de data (absoluta, relativa ou dia
da semana) presente → **começa hoje**: `instante_atual.data` é usada como a data
resolvida.

### O que este resolvedor preserva do algoritmo real da disponibilidade

**Não duplica, apenas se mantém coerente com** `resolver-disponibilidade.ts`: o
gerador de disponibilidade **preserva os intervalos livres intactos** e gera a grade
canônica sobre eles sem alteração; somente **depois** disso, os inícios cuja posição
não é estritamente futura (`início <= instante_atual.minuto_min`) são **filtrados** da
lista de opções — o instante atual **nunca vira um início artificial** de um intervalo
truncado. Este resolvedor temporal classifica um FATO recebido (uma data, um horário,
uma restrição) como `passado` quando ele já não pode produzir nenhuma oferta válida sob
essa mesma regra de filtro — mas a geração da grade e a filtragem em si continuam
responsabilidade exclusiva da disponibilidade, nunca reimplementadas aqui.

## 17. Ambiguidade

Resultado `ambiguo` — nunca resolvido por suposição, nunca "melhor palpite".
`MotivoAmbiguidadeTemporal`, união fechada — cada caso produz **exatamente um** destes
motivos, nunca mais de um simultaneamente:

- `dia_semana_sem_qualificador` — dia da semana sem qualificador (seção 12);
- `horario_sem_parte_dia` — horário 12h, hora `1..11`, sem `parte_dia` e sem período
  que resolva de forma inequívoca (seção 13);
- `horario_nao_classificado` — átomo `horario_exato`/`restricao` com `forma`/
  `forma_limite: 'horario_nao_classificado'` (seção 5, seção 13);
- `hora_12_com_parte_dia_ambigua` — hora `12` acompanhada somente de período
  (`manha`/`tarde`/`noite`), sem `parte_dia` nem classificação explícita de
  `meio_dia`/`meia_noite` (seção 13);
- `expressao_temporal_nao_classificada` — reservado para um átomo cujo `tipo` é
  reconhecido, mas cuja forma interna não se classifica em nenhuma variante fechada
  desta v1 (análogo a `horario_nao_classificado`, para dimensões diferentes de
  horário) — nenhuma variante nova de átomo é criada por esta rodada; este motivo
  existe para o caso genérico, sem inventar comportamento além do já fechado nesta
  spec.

`ambiguo` nunca contém uma "melhor tentativa" nem um valor parcial — é um resultado
vazio de conteúdo temporal, sinalizando que o controlador deve pedir esclarecimento
(`composicao-novo-agendamento-v1.md`, pausa 9). **`proxima_disponibilidade` combinada
com horário exato nunca produz `ambiguo`** — produz sempre `incompleto` (seção 18);
não há alternativa entre os dois para esse caso.

## 18. Incompletude

Resultado `incompleto` — distinto de `ambiguo`: aqui falta um fato necessário, não
sobra uma interpretação múltipla. `MotivoIncompletudeTemporal`, união fechada, avaliada
nesta **ordem de precedência interna fixa** (nenhuma entrada pode produzir mais de um
destes simultaneamente):

1. `intencao_ausente` — **nenhum** átomo de intenção presente na leva de fatos —
   inclui, mas não se limita a, a leva vazia (seção "Ausências simultâneas" abaixo).
   Sem intenção conhecida, este resolvedor não tem como determinar qual conjunto de
   dados é obrigatório; por isso este motivo tem precedência sobre todos os demais
   desta variante;
2. `horario_recorrente_nao_suportado` — intenção `proxima_disponibilidade` presente
   **e** um átomo `horario_exato` presente (seção 16), independentemente de existir
   data. **Classificação única, sem alternativa**: os fatos são individualmente
   compreensíveis, mas buscar o mesmo horário em vários dias não existe nesta v1 — o
   controlador deve perguntar se o paciente quer uma data específica ou qualquer
   horário mais próximo, nunca inferir uma das duas;
3. `data_ausente` — intenção `data_especifica` presente **e nenhum átomo de data**
   (absoluta, relativa ou dia da semana) presente na leva. Esta intenção **exige**
   data explícita; `proxima_disponibilidade` nunca produz este motivo, porque a data
   pode ser omitida e passa a valer "hoje" (seção 16, "Próxima disponibilidade sem
   data") — **nunca** `data_ausente` nesse caso;
4. `horario_sem_data` — um átomo `horario_exato` presente sem nenhuma data associada,
   em qualquer combinação não já coberta pelos três motivos acima (seção 13);
5. `restricao_sem_data` — uma restrição presente sem nenhuma data associada, pela
   mesma regra (seção 15).

### Ausências simultâneas — regra fechada

- **leva vazia** (`fatos_temporais.length === 0`) → sempre `intencao_ausente`, nunca
  `data_ausente` — sem nenhum átomo, não há sequer intenção para determinar o que é
  obrigatório;
- **intenção `data_especifica` presente, mas sem data** → sempre `data_ausente`;
- **intenção `proxima_disponibilidade`** → data pode ser omitida (começa hoje, seção
  16); esta combinação **nunca** produz `data_ausente`.

Esta regra elimina qualquer ambiguidade entre `data_ausente` e `intencao_ausente` para
a mesma entrada — cada caso produz exatamente um motivo, determinado pela ordem acima.

## 19. Invalidade

Resultado `invalido` — o fato recebido viola uma regra estrutural fechada, nunca uma
questão de interpretação. `MotivoInvalidoTemporal`, união fechada:

- `data_impossivel` — `ano` **explícito** presente e `(dia, mes, ano)` fora do
  calendário gregoriano para esse ano específico, mesmo considerando bissexto (seção
  9) — checagem de um único ano, nunca uma busca;
- `ano_fora_do_dominio` — `ano` explícito fora de `1..9999` (seção 9); **ou** `ano`
  omitido cuja busca (seção 11) examinou toda a janela de nove candidatos (ou menos,
  quando truncada pelo teto de `9999`) sem encontrar ocorrência civil válida e não
  passada — em ambos os casos, o problema é o **ano**, nunca o par `(dia, mes)` em si;
- `ano_dois_digitos` — `ano` explícito em `1..99` (seção 9) — nunca expandido para
  nenhum século;
- `hora_fora_do_dominio` — `hora`/`hora_limite` fora de `0..23` (`horario_24h`) ou
  `1..12` (`horario_12h`) (seção 13), com valor **finito** (seção 21: número não
  finito nesse campo é classificado à parte, ver abaixo);
- `minuto_fora_do_dominio` — `minuto`/`minuto_limite` fora de `0..59` (seção 13), com
  valor finito;
- `horario_24_00` — `24:00` ou equivalente (seção 13);
- `restricao_nao_suportada` — limite inferior tipo "depois das 15h" (seção 15);
- `atomo_invalido` — cobre exatamente dois casos, sempre depois de descartados todos
  os motivos mais específicos acima: (a) um campo numérico reconhecido cujo valor é
  um número **não finito** (`NaN`, `Infinity`, `-Infinity` — seção 21); (b) um átomo
  estruturalmente reconhecido (discriminador `tipo` válido) violando uma regra de
  forma não coberta por nenhum motivo mais específico (ex.: átomo `restricao` sem
  `tipo_restricao`) — catch-all fechado, nunca mensagem livre, nunca o valor bruto
  reproduzido;
- `quantidade_atomica_excedida` — mais de 8 átomos em `fatos_temporais` (seção 5).

Motivo mais específico **sempre** prevalece sobre `atomo_invalido`: um valor finito
fora de domínio recebe o motivo nomeado (`hora_fora_do_dominio`,
`minuto_fora_do_dominio`, `ano_dois_digitos`, `ano_fora_do_dominio`); `atomo_invalido`
é reservado para o que sobra depois de descartados todos os motivos nomeados.

`fuso_ausente`, `fuso_formato_invalido` e `instante_atual_invalido` **não pertencem a
esta lista** — são exclusivos de `erro_configuracao` (seção 21), nunca duplicados
aqui, porque nascem da configuração da clínica ou do contrato estrutural da entrada,
nunca dos fatos temporais em si (ver distinção completa na seção 20).

Cada motivo corresponde a exatamente uma regra publicada nesta spec — nenhum motivo
livre, nenhuma mensagem de texto como classificação primária (mesmo padrão já usado
pelos quatro componentes publicados).

## 20. Conflitos

Resultado `conflito` — dois ou mais fatos, cada um estruturalmente válido isoladamente,
que juntos não podem produzir nenhum resultado coerente. `MotivoConflitoTemporal`,
união fechada:

- `multiplas_datas` — duas datas diferentes na mesma leva de fatos (ex.: data absoluta
  e dia da semana apontando para dias distintos, ou dois átomos `data_absoluta`);
- `data_especifica_com_proxima_disponibilidade` — **caso canônico**: a leva de fatos
  contém **exatamente duas** intenções, sendo **uma de cada tipo** — um átomo
  `intencao: 'data_especifica'` e um átomo `intencao: 'proxima_disponibilidade'` — são
  mutuamente exclusivas (`novo-agendamento.md` §9);
- `multiplas_intencoes` — **todo demais caso** de multiplicidade de intenção: duas
  ocorrências idênticas repetidas do mesmo tipo (ex.: dois átomos
  `data_especifica`), três ou mais átomos de intenção em qualquer combinação, ou
  qualquer multiplicidade que não se reduza exatamente ao par canônico acima. Motivo
  **efetivamente produzido**, não reservado — a distinção entre os dois motivos é
  puramente sobre **quais e quantos** átomos de intenção estão presentes, nunca sobre
  o restante da leva de fatos;
- `multiplos_horarios_exatos` — dois ou mais átomos `horario_exato` com valores
  diferentes na mesma leva de fatos;
- `restricoes_conflitantes` — duas restrições simultâneas, do mesmo tipo com limites
  diferentes ou de tipos diferentes (`inicio_ate` e `termino_ate` juntos) (seção 15);
- `periodo_incompativel_com_horario` — horário 12h, hora `1..11`, cujos dois
  candidatos (leitura AM e leitura PM) não pertencem ao período informado (seção 13;
  ex.: hora `8` com período `tarde`);
- `horario_viola_inicio_ate` — horário exato posterior ao limite de um `inicio_ate`
  simultâneo (seção 15). **Nunca produzido para `termino_ate`** — ver seção 15,
  "Compatibilidade com horário exato".

`conflito` é distinto de `erro_configuracao`: o primeiro nasce dos fatos temporais
recebidos (múltiplos, incompatíveis entre si); o segundo nasce da configuração da
clínica (`fuso`) ou do contrato estrutural da entrada (`instante_atual`) — nunca dos
fatos temporais em si.

Um conflito **impede nova consulta de disponibilidade** e invalida os derivados
temporais incompatíveis entre si (seção 24) — o controlador deve pedir esclarecimento,
nunca escolher um dos fatos conflitantes silenciosamente.

## 21. União fechada de resultados

```text
type ResultadoResolucaoTemporal =
  | {
      tipo: 'resolvido';
      clinica_id: string;
      intencao: 'data_especifica' | 'proxima_disponibilidade';
      data: string;                 // civil YYYY-MM-DD
      periodo?: Periodo;            // reutilizado, sem alteração
      horario_min?: number;         // presente quando horário exato foi resolvido
      restricao?: RestricaoHoraria; // reutilizado, sem alteração
    }
  | { tipo: 'incompleto'; motivo: MotivoIncompletudeTemporal }
  | { tipo: 'ambiguo'; motivo: MotivoAmbiguidadeTemporal }
  | { tipo: 'invalido'; motivo: MotivoInvalidoTemporal }
  | { tipo: 'passado'; motivo: MotivoPassadoTemporal }
  | { tipo: 'conflito'; motivo: MotivoConflitoTemporal }
  | {
      tipo: 'erro_configuracao';
      motivo: 'fuso_ausente' | 'fuso_formato_invalido' | 'instante_atual_invalido';
    };
```

Sete variantes, todas exigidas pela instrução desta rodada. `motivo` de cada variante
é um código fechado (seções 16–20), nunca mensagem livre — inclusive `passado`, que
antes não carregava motivo e agora carrega (seção 16).

### Precedência global de avaliação

Seção normativa: quando mais de uma condição desta especificação se aplicaria à mesma
entrada, **esta ordem decide** — sempre, e **independentemente da ordem dos átomos**
na lista `fatos_temporais` (seção 5). Da mais alta para a mais baixa precedência:

| # | Camada | Saída |
|---|---|---|
| 1 | Erro estrutural de entrada | `EntradaInvalidaError` (lançado; nenhum `ResultadoResolucaoTemporal` é produzido) |
| 2 | Erro de configuração | `erro_configuracao` |
| 3 | Quantidade excedida ou átomo inválido | `invalido` |
| 4 | Conflito | `conflito` |
| 5 | Passado | `passado` |
| 6 | Mais de uma interpretação | `ambiguo` |
| 7 | Informação insuficiente | `incompleto` |
| 8 | Critério oficial completo | `resolvido` |

**`EntradaInvalidaError` nunca é adicionado à união de resultados.** Permanece
exceção de fronteira, exatamente como nos quatro componentes já publicados — o nível 1
desta tabela é sempre uma exceção lançada, nunca um valor de retorno.

#### 1. Erro estrutural de entrada

A entrada viola o contrato de **forma**, antes de qualquer interpretação de domínio.
Exemplos fechados: a raiz não é o objeto esperado; `fatos_temporais` não é array; um
item da lista não é objeto; um átomo tem propriedade desconhecida; o discriminador
`tipo` está ausente; um campo tem tipo incompatível com o discriminador (ex.: `dia`
como string); a estrutura do item não se classifica em nenhum átomo conhecido da
seção 5. Resultado: lançar `EntradaInvalidaError`, mesmo padrão de nome de campo fixo
já usado pelos quatro resolvedores publicados — nunca reproduzir o valor recebido.

#### 2. Erro de configuração

Avaliado somente depois de a entrada passar pela barreira estrutural. Exemplos:
`fuso` ausente ou estruturalmente inválido (seção 7); `instante_atual` mal formado
(seção 8). Resultado: `erro_configuracao`, motivo fechado (seção 7, seção 8) — nunca
`invalido`, mesmo quando a causa "parece" um valor de átomo malformado: a diferença é
que aqui a causa é a configuração da clínica ou o contrato estrutural da entrada,
nunca os fatos temporais em si.

#### 3. Quantidade excedida ou átomo inválido

Avaliado somente depois de configuração válida confirmada. Exemplos: mais de 8 átomos
em `fatos_temporais` (`quantidade_atomica_excedida`); um número não finito
(`NaN`/`Infinity`/`-Infinity`) num campo numérico reconhecido de um átomo
(`atomo_invalido` — ver "Números não finitos" abaixo); um valor numérico finito fora
do domínio específico (`hora_fora_do_dominio`, `minuto_fora_do_dominio`,
`ano_dois_digitos`, `ano_fora_do_dominio`, `horario_24_00`); uma combinação de campos
inválida dentro de um átomo estruturalmente reconhecido (`atomo_invalido`). Resultado:
`invalido`, sempre com o motivo mais específico aplicável (seção 19).

#### Números não finitos — fronteira exata com o erro estrutural

Dois casos, nunca confundidos, nunca com alternativa entre eles:

- **tipo incompatível** (string onde um número era esperado, objeto onde um inteiro
  era esperado, propriedade desconhecida, discriminador inválido) → nível 1,
  `EntradaInvalidaError`;
- **campo numérico reconhecido, mas valor não finito** (`NaN`, `Infinity`,
  `-Infinity`) → nível 3, `invalido` (`atomo_invalido`), campo correspondente.

JSON convencional (o formato real de saída de um modelo via Structured Outputs) não
consegue representar `NaN` nem infinitos — esses valores só alcançariam este
resolvedor por uma chamada interna direta (fora do caminho HTTP/JSON) ou por um teste
unitário. Ainda assim, o comportamento é fechado e determinístico para esses casos,
pela mesma disciplina defensiva já aplicada em `resolver-duracao.ts`
(`ehNumeroFinito`) e em `resolver-disponibilidade.ts` (sanitização de minutos runtime
hostis) — nunca uma exceção não controlada, nunca propagação do valor bruto.

#### 4. Conflito

Avaliado somente depois de todos os átomos confirmados estruturalmente válidos
(níveis 1–3 já descartados). Ver seção 20 para a lista fechada de motivos.

#### 5. Passado

Avaliado somente quando não houver conflito. Ver seção 16.

#### 6. Ambíguo

Avaliado somente quando não houver conflito nem passado. Ver seção 17.

#### 7. Incompleto

Avaliado somente quando nenhum dos casos anteriores se aplicar. Ver seção 18.

#### 8. Resolvido

Somente quando nenhum caso anterior se aplicar — todos os critérios temporais
necessários estão presentes, estruturalmente válidos, sem conflito, não vencidos, sem
ambiguidade e completos.

### `fuso` não é repetido no resultado

**`fuso` não consta em `resolvido`.** Ele já pertence ao contexto oficial da entrada
(seção 4) e nunca é validado contra a tzdb por este resolvedor (seção 7) — repeti-lo no
resultado não acrescenta fato oficial novo, apenas duplicaria um valor que o chamador
já possui. O resultado contém somente critérios temporais oficiais.

`clinica_id` **é mantido** em `resolvido`, seguindo o mesmo padrão já adotado pelos
quatro resolvedores publicados (`resolverProcedimento`, `resolverDentista`,
`resolverDuracao` e `resolverDisponibilidade` incluem `clinica_id` em seus resultados
`resolvido`/`resolvida`/`opcoes`) — exclusivamente para isolamento e rastreabilidade
(seção 26), nunca para alterar uma regra civil.

Para `resolvido`, somente os fatos estritamente necessários: `clinica_id`, `intencao`,
`data`, `periodo` opcional, `horario_min` opcional, `restricao` opcional.

**Nunca incluído em nenhuma variante**: texto livre do paciente; resposta redigida ao
paciente; stack trace ou detalhe de execução; valor runtime hostil (string, objeto,
`NaN`, `Infinity` — mesma sanitização já aplicada em `resolver-disponibilidade.ts`);
horário inventado; agenda; duração; `dentista_id`; `procedimento_id`. Este resolvedor
nunca produz nem consome nenhum desses quatro últimos — eles pertencem a outros
componentes já publicados.

## 22. Pureza

Função pura, mesmo contrato de pureza já aplicado aos quatro componentes publicados:

- determinística — mesma entrada produz sempre o mesmo resultado;
- sem I/O, sem rede, sem banco, sem relógio;
- não muta a entrada recebida;
- não lança exceção para configuração ou fato temporal inválido — devolve resultado
  tipado (seções 19, 20);
- lança erro controlado somente para violação de **contrato de forma** da entrada
  (tipo errado, propriedade desconhecida) — mesmo padrão de `EntradaInvalidaError`
  já usado pelos quatro resolvedores publicados.

## 23. Serialização

O resultado público (seção 21) deve ser serializável com `JSON.stringify` e fazer
round-trip exato com `JSON.parse` — mesma garantia já provada em
`resolver-disponibilidade.ts` (`IntervaloOfensor`, sanitização de minutos runtime
hostis). Nenhuma variante contém `NaN`, `Infinity`, `bigint`, `symbol`, função ou
objeto runtime bruto. Um valor runtime hostil recebido dentro de um átomo temporal
resulta em `invalido` (ou em rejeição de contrato de forma, quando a violação for
estrutural), nunca em propagação do valor bruto para o resultado.

## 24. Invalidação de derivados

Harmonizado com `composicao-novo-agendamento-v1.md` §14, sem alterar a matriz já
publicada — apenas detalhando o que "fato temporal alterado" significa neste
resolvedor:

- data alterada → invalidar data resolvida, disponibilidade, opções, escolha e
  resumo;
- horário alterado → invalidar horário resolvido, disponibilidade, opções, escolha e
  resumo;
- período alterado → invalidar período resolvido, disponibilidade, opções, escolha e
  resumo;
- restrição alterada → invalidar restrição resolvida, disponibilidade, opções,
  escolha e resumo;
- intenção alterada (`data_especifica` ↔ `proxima_disponibilidade`) → invalidar todos
  os critérios temporais, disponibilidade, opções, escolha e resumo;
- alteração textual que, depois de resolvida por este componente, produz **exatamente
  o mesmo critério oficial** já vigente (mesma data, mesmo horário, mesmo período,
  mesma restrição) → **não invalida nada** — mesma ressalva de mudança superficial já
  aprovada em `controlador-conversacional-v1.md` §10 e `duracao-v1.md` §8.

### Nova alteração produz conflito ou ambiguidade

Regra fechada, sem margem para interpretação do controlador:

1. invalidar disponibilidade, opções, escolha e resumo vigentes;
2. **preservar** procedimento, dentista e duração válidos — nenhum dos três depende
   de fato temporal;
3. **não promover** o novo fato (o que gerou o conflito ou a ambiguidade) a critério
   temporal oficial resolvido — ele permanece não resolvido até o esclarecimento;
4. **manter** os fatos informados da mensagem atual disponíveis para a pergunta de
   esclarecimento (`composicao-novo-agendamento-v1.md`, pausa 9) — nunca descartados
   antes de o paciente responder;
5. **não reutilizar** o critério temporal oficial anterior (o que estava vigente antes
   desta mensagem) para autorizar uma nova consulta de disponibilidade — mesmo que
   ele continue tecnicamente presente no estado, ele não conduz mais nenhuma busca
   enquanto o conflito ou a ambiguidade não forem resolvidos pelo paciente.

Procedimento, dentista e duração **permanecem válidos** quando a alteração é
exclusivamente temporal — nenhum dos três depende de data, horário, período ou
restrição.

## 25. Segurança

- este resolvedor nunca acessa banco, credenciais ou ferramentas;
- nenhuma mensagem de erro reproduz o texto do paciente — a violação de contrato de
  forma (seção 22) usa somente nomes de campo fixos, mesmo padrão de
  `EntradaInvalidaError` já publicado;
- nenhum log técnico deste componente contém data de nascimento, CPF, nome, telefone
  ou e-mail — ele nunca recebe nenhum desses campos (`docs/03-seguranca.md`);
- valor runtime hostil recebido em qualquer campo numérico nunca atravessa para o
  resultado público (seção 23).

## 26. Multiclínica

`clinica_id` viaja na entrada e no resultado `resolvido`, exclusivamente para
isolamento e rastreabilidade — nunca para alterar uma regra civil. Duas clínicas em
fusos diferentes, processando a mesma expressão temporal na mesma mensagem de teste,
produzem resultados independentes, cada um correto para o `fuso`/`instante_atual`
daquela clínica — nenhuma informação de uma clínica influencia o resultado da outra
(mesmo padrão de isolamento já provado nos quatro componentes publicados).

## 27. Matriz de testes

Índice documental — nenhum teste executável é criado nesta rodada. Prefixo `TMP-`.
`composicao-novo-agendamento-v1.md` §22 já reservou `TMP-01` a `TMP-06` como cobertura
futura (marcador †) apontando para esta especificação; esta matriz **continua a
numeração a partir de `TMP-07`**, sem reaproveitar nenhum identificador já usado —
`TMP-07` a `TMP-83` somam-se aos seis já existentes, nenhum ID de rodada anterior é
reciclado, renumerado ou removido. Correspondência com os seis já reservados é anotada
na coluna "Equivalente".

| ID | Cenário | Nível | Resultado esperado | Equivalente |
|---|---|---|---|---|
| TMP-07 | Data absoluta com ano explícito, válida | U | `resolvido` | — |
| TMP-08 | Data absoluta com ano de um ou dois dígitos | U | `invalido` (`ano_dois_digitos`) | — |
| TMP-09 | Data absoluta impossível (dia > limite do mês) | U | `invalido` (`data_impossivel`) | — |
| TMP-10 | 29 de fevereiro em ano bissexto | U | `resolvido` | — |
| TMP-11 | 29 de fevereiro em ano não bissexto | U | `invalido` (`data_impossivel`) | — |
| TMP-12 | `amanha`/`depois_de_amanha` cruzando fim de mês e virada de ano | U | `resolvido`, data civil correta | — |
| TMP-13 | Data relativa `hoje`, resolvida no fuso da clínica | U | `resolvido` | TMP-01 |
| TMP-14 | Ano omitido, data ainda não passada este ano | U | `resolvido` no ano corrente | — |
| TMP-15 | Ano omitido, data já passada este ano | U | `resolvido` no ano seguinte | — |
| TMP-16 | Ano omitido, data coincide com hoje | U | `resolvido` em hoje, nunca em outro ano | — |
| TMP-17 | Ano omitido, 29 de fevereiro, instante atual em `2096-03-01` (2096 é bissexto mas já passou; 2097–2103 não são bissextos; 2100 não é bissexto por ser múltiplo de 100 e não de 400) | U | `resolvido`, `2104-02-29` — nono candidato examinado (`2096` a `2104`), prova de que a janela cobre o ano atual mais os oito seguintes, nunca menos | — |
| TMP-18 | Dia da semana `proxima`, hoje é esse mesmo dia | U | Ocorrência da semana seguinte, nunca hoje | — |
| TMP-19 | Dia da semana `esta`, ocorrência ainda não passada | U | `resolvido` | — |
| TMP-20 | Dia da semana `esta`, ocorrência já passada nesta semana | U | `passado` (`dia_semana_esta_passado`) | — |
| TMP-21 | Dia da semana sem qualificador | U | `ambiguo` (`dia_semana_sem_qualificador`) | — |
| TMP-22 | Horário 24h explícito válido | U | `resolvido` | — |
| TMP-23 | Horário 12h com `am`/`pm`, incluindo hora 12 em ambos | U | `resolvido`, conforme tabela de conversão | — |
| TMP-24 | Meio-dia | U | `resolvido`, minuto `720` | — |
| TMP-25 | Meia-noite | U | `resolvido`, minuto `0` | — |
| TMP-26 | `24:00` | U | `invalido` (`horario_24_00`), nunca convertido para `00:00` | — |
| TMP-27 | Minuto não múltiplo de 10 preservado sem arredondamento | U | `resolvido`, minuto exato preservado | — |
| TMP-28 | Horário 1–11 sem `parte_dia`, sem período que resolva | U | `ambiguo` (`horario_sem_parte_dia`) | — |
| TMP-29 | Horário `8` com período `manha`; horário `8` com período `noite`; horário `3` com período `tarde` | U | `resolvido`: `08:00`; `20:00`; `15:00`, respectivamente | — |
| TMP-30 | Horário `horario_nao_classificado` | U | `ambiguo` (`horario_nao_classificado`) | — |
| TMP-31 | Fronteiras de período: início `12:00`, `12:10`, `18:00` | U | manhã / tarde / noite | — |
| TMP-32 | `inicio_ate` produzido a partir de "antes das 11h" já interpretado | U | `resolvido`, `restricao.tipo = 'inicio_ate'` | TMP-02 |
| TMP-33 | `termino_ate` produzido a partir de "preciso terminar até 11h" já interpretado | U | `resolvido`, `restricao.tipo = 'termino_ate'` | TMP-03 |
| TMP-34 | "Depois das 15h" | U | `invalido` (`restricao_nao_suportada`), nunca convertido | — |
| TMP-35 | Duas restrições simultâneas (`inicio_ate` e `termino_ate` juntos) | U | `conflito` (`restricoes_conflitantes`) | — |
| TMP-36 | Horário exato posterior ao limite de `inicio_ate` simultâneo (ex.: horário exato `12:00`, `inicio_ate` `11:00`) | U | `conflito` (`horario_viola_inicio_ate`) | — |
| TMP-37 | Restrição sem data associada | U | `incompleto` (`restricao_sem_data`) | — |
| TMP-38 | Restrição com limite já no passado, hoje | U | `passado` (`inicio_ate_passado`/`termino_ate_passado`) | — |
| TMP-39 | Data anterior a hoje | U | `passado` (`data_passada`) | — |
| TMP-40 | Hoje sem horário | U | `resolvido` | — |
| TMP-41 | Hoje com horário igual ao instante atual | U | `passado` (`horario_passado`) | — |
| TMP-42 | Hoje com horário estritamente posterior ao instante atual | U | `resolvido` | — |
| TMP-43 | `proxima_disponibilidade` sem data | U | `resolvido`, data = hoje | — |
| TMP-44 | `proxima_disponibilidade` com data específica rígida | U | `conflito` (`data_especifica_com_proxima_disponibilidade`) | — |
| TMP-45 | `proxima_disponibilidade` com horário exato | U | `incompleto` (`horario_recorrente_nao_suportado`) — classificação única, nunca `ambiguo` | — |
| TMP-46 | `data_especifica` e `proxima_disponibilidade` simultâneas | U | `conflito` (`data_especifica_com_proxima_disponibilidade`) | — |
| TMP-47 | Duas datas diferentes na mesma leva de fatos | U | `conflito` (`multiplas_datas`) | — |
| TMP-48 | `fuso` ausente (`undefined`/`null`) | U | `erro_configuracao` (`fuso_ausente`) | — |
| TMP-49 | `instante_atual` mal formado | U | `erro_configuracao` (`instante_atual_invalido`) | — |
| TMP-50 | Serialização de todas as sete variantes por JSON, round-trip exato | U | Sem `NaN`, sem `Infinity`, sem valor bruto | — |
| TMP-51 | Valor runtime hostil em campo numérico do átomo | U | `invalido`, valor bruto nunca propagado | — |
| TMP-52 | Pureza: mesma entrada, duas execuções, resultado idêntico | U | Determinístico | — |
| TMP-53 | Entrada não muta durante a resolução | U | Objeto de entrada intacto após a chamada | — |
| TMP-54 | Compatibilidade estrutural do schema (array de átomos achatados) com `strict: true` (revisão documental, sem execução real) | U | `additionalProperties: false`, todo campo em `required`, ausência representada por `null`, `maxItems: 8` | — |
| TMP-55 | Duas clínicas, fusos diferentes, mesma expressão temporal | S | Resultados independentes, sem influência cruzada | TMP-06 |
| TMP-56 | Nenhum campo cadastral (nome/CPF/nascimento/e-mail) chega a este resolvedor nem aparece no resultado | S | Ausência total de PII, em qualquer variante | — |
| TMP-57 | Mensagem de erro de contrato de forma nunca reproduz valor recebido | S | Somente nome de campo fixo | — |
| TMP-58 | Isolamento: fato temporal de uma clínica nunca influencia o resultado de outra na mesma execução em lote hipotética | S | Sem vazamento | — |
| TMP-59 | `fuso` presente, mas não é string não vazia (tipo errado, ou string vazia/só espaços) | U | `erro_configuracao` (`fuso_formato_invalido`) | — |
| TMP-60 | "12 da manhã" — hora `12` com período `manha`, sem `parte_dia` nem `forma` explícita de `meio_dia`/`meia_noite` | U | `ambiguo` (`hora_12_com_parte_dia_ambigua`) | — |
| TMP-61 | "12 da tarde" — hora `12` com período `tarde`, mesma ausência de classificação | U | `ambiguo` (`hora_12_com_parte_dia_ambigua`) | — |
| TMP-62 | "12 da noite" — hora `12` com período `noite`, mesma ausência de classificação | U | `ambiguo` (`hora_12_com_parte_dia_ambigua`) | — |
| TMP-63 | Horário exato `10:00` simultâneo a `inicio_ate` `11:00` | U | `resolvido`, ambos os critérios presentes (`horario_min` e `restricao`) | — |
| TMP-64 | Horário exato `10:00` simultâneo a `termino_ate` `10:30` (limite diferente do horário, compatibilidade dependente de duração) | U | `resolvido`, ambos os critérios preservados — **nunca** `conflito` só pelo horário de início | — |
| TMP-65 | Mais de 8 átomos temporais na mesma leva de fatos | U | `invalido` (`quantidade_atomica_excedida`) | — |
| TMP-66 | Segunda-feira como primeiro dia da semana civil — "esta segunda" quando hoje é quinta-feira da mesma semana | U | `passado` (`dia_semana_esta_passado`) — segunda já ocorreu nesta semana civil | — |
| TMP-67 | Domingo como último dia da semana civil — "este domingo" quando hoje é segunda-feira da mesma semana | U | `resolvido` — domingo ainda não chegou dentro da semana civil corrente | — |
| TMP-68 | Duas intenções simultâneas (`data_especifica` e `proxima_disponibilidade`) representadas como dois átomos na lista | U | `conflito` (`data_especifica_com_proxima_disponibilidade`) — confirma a representação por múltiplos átomos do mesmo `tipo` (seção 5) | TMP-46 |
| TMP-69 | Ano omitido cuja busca chega a `9999` sem encontrar ocorrência civil válida e não passada (instante atual com ano próximo do teto) | U | `invalido`, campo `data`, motivo `ano_fora_do_dominio` — nenhum overflow, wrap ou inferência além de `9999` | — |
| TMP-70 | Precedência: entrada estrutural inválida (`fatos_temporais` não é array) junto de configuração inválida (`fuso` ausente) | U | `EntradaInvalidaError` — nível 1 sobre nível 2 | — |
| TMP-71 | Precedência: configuração inválida (`fuso` ausente) junto de fatos que produziriam conflito | U | `erro_configuracao` — nível 2 sobre nível 4 | — |
| TMP-72 | Precedência: mais de 8 átomos, incluindo fatos que produziriam conflito | U | `invalido` (`quantidade_atomica_excedida`) — nível 3 sobre nível 4 | — |
| TMP-73 | Precedência: átomo inválido (ex.: `NaN` em campo numérico) junto de fatos que produziriam conflito | U | `invalido` — nível 3 sobre nível 4 | — |
| TMP-74 | Precedência: fatos que produzem conflito junto de um fato isoladamente passado | U | `conflito` — nível 4 sobre nível 5 | — |
| TMP-75 | Precedência: um fato passado (`esta` + dia já ocorrido) junto de outro fato ambíguo (horário sem `parte_dia`) | U | `passado` — nível 5 sobre nível 6 | — |
| TMP-76 | Precedência: um fato ambíguo junto de informação incompleta (falta de data) | U | `ambiguo` — nível 6 sobre nível 7 | — |
| TMP-77 | Precedência: leva de fatos vazia (`fatos_temporais: []`) | U | `incompleto` (`intencao_ausente`) — único motivo possível, nunca `data_ausente` | — |
| TMP-78 | `NaN` em campo numérico reconhecido de um átomo (ex.: `hora`) | U | `invalido` (`atomo_invalido`), valor bruto nunca propagado | — |
| TMP-79 | `Infinity`/`-Infinity` em campo numérico reconhecido de um átomo | U | `invalido` (`atomo_invalido`), valor bruto nunca propagado | — |
| TMP-80 | String em campo numérico reconhecido de um átomo (ex.: `hora: "8"`) | U | `EntradaInvalidaError` — tipo incompatível é erro estrutural, nunca `invalido` | — |
| TMP-81 | Intenções repetidas (dois átomos `data_especifica` idênticos) ou três ou mais átomos de intenção em qualquer combinação | U | `conflito` (`multiplas_intencoes`) — motivo efetivamente produzido, não reservado | — |
| TMP-82 | Horário `8` com período `tarde`, simultâneos | U | `conflito` (`periodo_incompativel_com_horario`) — cenário de aceite dedicado, distinto dos casos `resolvido` de TMP-29 | — |
| TMP-83 | Hoje é domingo (último dia da semana civil corrente); "esta segunda" pedida | U | `passado` (`dia_semana_esta_passado`) — a segunda-feira da mesma semana civil é o primeiro dia dela, já ocorrido em relação a hoje | — |

Os pedidos de cobertura para "duas datas", "duas intenções" e "duas restrições" desta
rodada já correspondem, respectivamente, a TMP-47, TMP-46/TMP-68/TMP-81 e TMP-35 —
nenhum cenário duplicado foi criado; a coluna "Equivalente" registra a
correspondência.

## 28. Integração futura com o controlador

`composicao-novo-agendamento-v1.md` §9 (passo 7) já reserva o lugar deste resolvedor
na ordem canônica — entre duração (passo 6) e obtenção do snapshot diário (passo 8).
Esta especificação não altera essa ordem.

O controlador:

- chama este resolvedor com os átomos temporais fornecidos pelo contrato futuro
  aprovado da interpretação (seção 29), já validados estruturalmente (seção 5,
  "validação estrutural do Core") antes de chegar a este resolvedor;
- trata `resolvido` seguindo para o passo 8;
- trata `incompleto`/`ambiguo` como pausa 9 (`composicao-novo-agendamento-v1.md` §12) —
  pede o dado faltante ou pede esclarecimento;
- trata `invalido`/`erro_configuracao` como falha técnica fechada;
- trata `passado` pedindo nova data/horário ao paciente — nunca oferece o fato
  vencido;
- trata `conflito` pedindo esclarecimento, nunca escolhendo um dos fatos
  conflitantes.

Nenhuma dessas integrações é implementada nesta rodada.

## 29. Integração futura com a interpretação

Ver `interpretacao-ia.md` ("Fatos temporais estruturados — contrato futuro") para o
contrato completo. Resumo:

- a IA continuará a produzir somente fatos da mensagem atual, nunca fatos oficiais;
- os átomos temporais (seção 5) chegam a este resolvedor **fornecidos pelo contrato
  futuro aprovado da interpretação** — não por `AlteracoesDados` no formato atual, que
  hoje carrega somente `data_texto`/`horario_texto` como texto livre
  (`CampoDadosConversa`, `src/core/tipos.ts`);
- antes de chegar a este resolvedor, os átomos são **validados estruturalmente pelo
  Core** (seção 5, camada 2) — tamanho da lista, discriminador conhecido, forma de
  cada átomo;
- a forma de persistência dos átomos temporais, e a migração de
  `AlteracoesDados`/`CampoDadosConversa` para acomodá-los, **permanecem pendentes** —
  decisão de implementação futura, com sua própria aprovação e revisão;
- **nenhuma persistência nova é presumida por esta especificação.** Este resolvedor
  não define, nem antecipa, onde ou como os átomos temporais são fisicamente
  armazenados antes de chegarem até ele — essa é uma pendência explícita, não uma
  lacuna preenchida por inferência.

## 30. Itens explicitamente fora da v1

- parser livre de português no Core — o resolvedor nunca interpreta texto, só átomos
  já estruturados;
- acesso à agenda, geração de opções de disponibilidade, busca entre datas — pertence
  a `disponibilidade.md` e ao controlador;
- adaptação UTC/IANA/DST, conversão de horário local para UTC — pertence ao adaptador
  futuro (seção 8);
- persistência e schema físico — nenhuma tabela, coluna, índice, RPC ou migration;
- arredondamento ou truncamento de qualquer fato temporal;
- limite inferior de horário ("depois de", "a partir de") — não suportado nesta v1
  (seção 15);
- intervalo horário completo (início E fim explícitos simultaneamente, como "das 10h
  às 12h") — fora desta v1, sem contrato definido;
- "a partir de determinada data" como intenção de busca — distinto de
  `proxima_disponibilidade` sem data; permanece fora desta v1 e deverá ter contrato
  próprio futuro;
- recorrência do mesmo horário em vários dias ("toda segunda às 10h") — fora do
  escopo de novo agendamento (`novo-agendamento.md` §1);
- respostas naturais ao paciente — pertence a `atendimento-v1.md`;
- decisão de transição do controlador — pertence a
  `controlador-conversacional-v1.md`;
- criação de agendamento — pertence a `persistencia-v1.md` e a
  `novo-agendamento.md` §14–§16;
- persistência física dos átomos temporais e migração de `AlteracoesDados` para
  acomodá-los — pendência explícita (seção 29), não decidida por inferência.

## 31. Invariantes

- Este resolvedor nunca calcula, arredonda ou normaliza data a partir de texto — só
  consome átomos já estruturados pela interpretação.
- `InstanteAtual` é reutilizado sem alteração; `fuso` é sempre campo irmão da entrada,
  nunca aninhado, e nunca repetido no resultado `resolvido`.
- Nenhum `Date`, relógio de máquina, timezone local ou conversão UTC acontece neste
  componente.
- `fatos_temporais` é sempre uma lista, nunca um objeto único achatado por mensagem —
  a lista é o único contrato principal, com limite fechado de 8 átomos.
- `horario_exato` e `restricao` são átomos distintos, com campos próprios — nenhum
  campo é compartilhado entre os dois.
- **Segunda-feira é sempre o primeiro dia da semana civil**; domingo é o último. Fixo,
  universal, independente de locale, sistema operacional ou timezone da máquina.
- Ano omitido nunca escolhe ano anterior ao ano de `instante_atual.data`; busca o ano
  atual mais os oito anos seguintes (nove candidatos), nunca mais que isso, e nunca
  além de `9999`; nunca expande ano de dois dígitos para nenhum século.
- Nenhum ano fora de `1..9999` é examinado, produzido ou inferido; ano explícito fora
  de `100..9999` é sempre `invalido` (`ano_dois_digitos` ou `ano_fora_do_dominio`,
  nunca ambos ao mesmo tempo).
- Dia da semana sem qualificador é sempre `ambiguo`; horário 12h sem `parte_dia` e sem
  período que resolva de forma inequívoca é sempre `ambiguo`; hora `12` acompanhada
  somente de período, sem classificação explícita, é sempre `ambiguo`.
- Um horário 12h cujos dois candidatos não pertencem ao período informado é sempre
  `conflito`, nunca resolvido por suposição — `8 + tarde` nunca produz `20:00`.
- `inicio_ate` pode ser verificado contra horário exato sem duração;
  **`termino_ate` nunca é declarado `conflito` com base apenas no horário de
  início** — ambos são preservados como critérios oficiais simultâneos, e a
  compatibilidade final é responsabilidade exclusiva da disponibilidade.
- `proxima_disponibilidade` combinada com horário exato produz sempre `incompleto`
  (`horario_recorrente_nao_suportado`), nunca `ambiguo`.
- Períodos e restrições reutilizam `Periodo`/`RestricaoHoraria` publicados, sem
  alteração de limite ou de semântica.
- Não existe restrição de limite inferior nesta v1; "depois das 15h" é `invalido`,
  nunca convertido para `inicio_ate`, horário exato ou período.
- `24:00` é sempre inválido, nunca convertido para `00:00` do dia seguinte.
- `passado` sempre carrega um motivo fechado (seção 16); nenhuma variante do
  resultado carrega motivo livre.
- `fuso_ausente`/`fuso_formato_invalido`/`instante_atual_invalido` pertencem
  exclusivamente a `erro_configuracao`, nunca a `invalido`.
- Nenhum resultado oficial contém texto livre, PII, agenda, duração, dentista ou
  procedimento.
- Erro estrutural (`invalido`/`erro_configuracao`) e resultado de domínio legítimo
  (`passado`/`conflito`/`ambiguo`/`incompleto`) nunca se confundem.
- A precedência global de oito níveis (seção 21) é sempre aplicada, independentemente
  da ordem dos átomos: erro estrutural > erro de configuração > quantidade excedida/
  átomo inválido > conflito > passado > ambíguo > incompleto > resolvido.
  `EntradaInvalidaError` nunca é adicionado à união de resultados.
- Tipo incompatível em campo numérico (string, objeto) é sempre erro estrutural
  (`EntradaInvalidaError`); número reconhecido mas não finito (`NaN`/`Infinity`/
  `-Infinity`) é sempre `invalido` (`atomo_invalido`) — nunca alternativa entre os
  dois. Motivo mais específico sempre prevalece sobre `atomo_invalido` quando o valor
  é finito.
- Leva de fatos vazia é sempre `incompleto` (`intencao_ausente`), nunca
  `data_ausente`; intenção `data_especifica` sem nenhum átomo de data é sempre
  `data_ausente`; intenção `proxima_disponibilidade` nunca produz `data_ausente`.
- Exatamente duas intenções, uma de cada tipo, é sempre
  `data_especifica_com_proxima_disponibilidade`; qualquer outra multiplicidade de
  intenção é sempre `multiplas_intencoes` — motivo efetivamente produzido, não
  reservado.
- Quando uma nova alteração produz conflito ou ambiguidade, o critério temporal oficial
  anterior nunca é reutilizado para nova consulta, e o novo fato nunca é promovido a
  critério oficial sem esclarecimento.
- Este resolvedor é puro: determinístico, sem I/O, sem mutação da entrada, resultado
  sempre serializável com round-trip exato por JSON.
- `clinica_id` isola e rastreia; nunca altera regra civil.
- Esta especificação não cria código, tipo TypeScript, tabela, coluna, RPC, migration,
  teste executável ou schema físico.
