# Contexto conversacional unificado — spec v1

**Status (2026-08-14):** **aprovada** e **implementada exclusivamente em shadow local.**

Escrita em 2026-08-13 a partir de cinco defeitos reais medidos em produção no mesmo dia
(seção 1). Aprovada pelo Gabriel e na revisão independente do Codex (seção 9).

"Shadow local" quer dizer, literalmente:

- o código existe **só na árvore de trabalho** — sem commit, sem push, sem deploy;
- **nenhuma** migration, RPC, coluna ou tabela foi criada (a persistência entre turnos foi
  abandonada nesta etapa — seção 6.5);
- a medição roda **depois** da resposta já decidida e gravada, no mesmo mecanismo assíncrono
  da sombra existente, e **nunca** é aguardada antes da resposta ao paciente;
- nada aqui é lido por nenhuma decisão, escrita ou resposta. O contrato atual
  (`interpretacao-tipos.ts`) segue sendo o único que controla o atendimento.

Módulos: `core/contexto-unificado-tipos.ts`, `core/guarda-contexto-unificado.ts`,
`core/sombra-contexto-unificado.ts`, espelhados em `supabase/functions/iris-nova-mensagem/`.

Escopo: substituir o contrato de interpretação atual por um **contexto único de entrada** e
uma **saída que separa a ação pedida dos dados informados**, validado em shadow mode antes
de qualquer corte.

Fora de escopo, explicitamente: remover `dados.intencao`; remover os marcadores existentes;
cortar qualquer capacidade para o contrato novo; alterar o comportamento visível ao
paciente. Tudo isso vem **depois** da medição, em etapas próprias.

Antecede: `docs/07-arquitetura-v2.md` (a Iris é a autoridade semântica; o Core é a autoridade
factual e operacional). Esta spec é a primeira aplicação daquele princípio à camada de
interpretação.

---

## 1. O problema, medido

Cinco defeitos observados em produção em 2026-08-13, em testes reais de WhatsApp:

| sintoma observado | o que faltou |
|---|---|
| agendamento gravado sem nome/documento/procedimento | o Core não enviava o dado |
| dentista ativa nunca oferecida | vínculo invisível ao Core |
| `"vanesa por favor"` gravou **"vanesa" como nome do paciente** | a Iris não soube que a pergunta aberta era sobre dentista |
| a Iris inventou dois dentistas inexistentes | a Iris não recebeu a lista real |
| a Iris perguntou o procedimento que o paciente acabara de agendar | a Iris não recebeu o agendamento do paciente |

**Uma causa, cinco sintomas: a Iris não recebe o quadro completo da conversa.**

O contexto é montado peça por peça, cada peça com sua própria regra de quando entra. Hoje há
**quatro** marcadores declarativos de pergunta pendente, feitos um a um
(`proposta_pendente`, `oferta_procedimento_pendente`, `troca_telefone_pendente`,
`escolha_agendamento_pendente`) — e a escolha de dentista, que é a quinta pergunta que a
Iris faz, **nunca ganhou o seu**. Não foi decisão: foi omissão. A estrutura garante que
haverá outra.

### 1.1 Por que não basta acrescentar o quinto marcador

Resolveria o caso da Vanesa e manteria o mecanismo que o produziu. A cada pergunta nova,
uma regra nova; a cada regra esquecida, um defeito silencioso.

### 1.2 Por que não pode ser uma lista de campos permitidos por pergunta

A alternativa considerada — "com a pergunta de dentista aberta, o Core recusa gravar `nome`,
`cpf`, etc." — foi **rejeitada**. Ela contradiz uma decisão medida do contrato atual, que
manda preencher cada dado *"mesmo que forneça vários de uma vez ou junto de outro assunto"*.
Um paciente que responde `"Vanesa mesmo, e meu nome é Gabriel, CPF 061…"` teria nome e CPF
**descartados em silêncio** — troca um erro visível por um invisível. E põe julgamento
semântico de volta no Core, exatamente o que `docs/00-principios.md` proíbe.

---

## 2. Princípio

**A Iris declara o que entendeu. O Core valida e executa.**

A Iris passa a declarar **duas coisas separadas**, que hoje vêm misturadas num único balde de
campos preenchidos:

1. **o que o paciente quer fazer agora** (ação);
2. **o que o paciente informou sobre si** (dados), e em que operação — informou, corrigiu ou
   pediu para corrigir (com ou sem substituto).

Hoje não existe essa distinção: o contrato devolve `alteracoes` e nada diz se um campo veio
porque o paciente o forneceu **neste turno, nesse papel**, ou porque a IA o deduziu do
contexto. Foi essa ausência que gravou o nome de uma dentista na ficha de um paciente.

---

## 3. Entrada — contexto único

Um único objeto, montado **sempre**, com os mesmos blocos em todo turno. Todos os blocos
existem sempre; vazio ou `null` significa que **o fato não existe** — nunca "este caminho
não carregou".

```
contexto_relevante:
  dados_conhecidos          # o que a conversa já acumulou (procedimento, data, horário…)
  cadastro_paciente         # QUAIS campos estão preenchidos -- nunca o conteúdo (§3.0)
  agendamentos_do_paciente  # somente os futuros e relevantes, do mais próximo ao mais distante
  opcoes_apresentadas       # o que a Iris ofereceu concretamente no turno anterior
  aguardando_resposta       # a pergunta em aberto, ou `null` (§3.1)
  procedimentos_disponiveis # os ativos pertinentes à conversa, nunca o catálogo por precaução
  dentistas_disponiveis     # dentistas ativos (ver §3.2)

mensagem_atual              # texto do paciente
historico_recente           # últimos turnos, como hoje
```

### 3.0 Sempre presentes, nunca excessivos

Os blocos **sempre existem** — é isso que impede a lacuna silenciosa que produziu os cinco
defeitos da seção 1. Mas cada um carrega **somente os fatos necessários à conversa atual**,
nunca a ficha inteira nem o catálogo inteiro por precaução.

Isso **não** é trava semântica: nada é omitido por julgamento sobre o que o paciente "pode"
querer dizer. É minimização factual, por duas razões concretas:

- **PII** — mandar ao modelo dado cadastral que a conversa não exige amplia a exposição sem
  ganho. O que já vale hoje continua valendo: o cadastro entra como *quais campos estão
  preenchidos*, para a Iris saber o que ainda falta pedir — nunca o conteúdo de campos que a
  conversa não pediu.
- **Contexto excessivo degrada decisão** — já medido neste projeto: prosa e dado a mais no
  payload pioraram resultado mais de uma vez.

Regra prática: **nenhum bloco é ausente.** Um bloco vazio (ou `null`) afirma *"esse fato não
existe"*; a ausência afirmaria apenas *"ninguém carregou"*. A diferença entre "não há
agendamento" e "ninguém buscou os agendamentos" precisa ser sempre visível para a Iris — foi
exatamente essa confusão que produziu três dos cinco defeitos da seção 1.

### 3.1 `aguardando_resposta` — genérico, nunca um campo por pergunta

**Um** campo, com vocabulário fechado de tipos, que representa **a pergunta que foi de fato
feita ao paciente** — registrada no momento em que a resposta é produzida, junto com ela.

**Não é derivado da decisão do Core, nem lido dos marcadores atuais.** Essa distinção é o
ponto central desta seção: derivar da decisão manteria a Iris dependente exatamente do
roteamento determinístico que a Arquitetura V2 existe para remover, e faria o contrato novo
nascer amarrado ao antigo. O que importa não é o que o Core concluiu — é o que o paciente
foi perguntado.

Consequência prática: quando a Iris passar a decidir sozinha (Etapa 3), este campo continua
válido sem nenhuma alteração, porque ele descreve a **conversa**, não o roteamento. É também
o que elimina o "criar marcador para a pergunta nova": toda resposta enviada ao paciente
registra o que perguntou, então não existe pergunta sem registro.

```
aguardando_resposta:                 # `null` quando não há pergunta aberta
  tipo: escolha_dentista | escolha_horario | confirmacao |
        oferta_procedimento | troca_telefone | escolha_agendamento
  opcoes:  [...]     # ausente quando a pergunta não apresenta opções
  detalhe: {...}     # ausente quando a pergunta não carrega dado concreto
```

Três formas, todas cobertas pela mesma estrutura:

- **com opções** — `escolha_dentista` (Carlos, Vanesa), `escolha_horario`,
  `escolha_agendamento`;
- **com dado concreto e sem opções** — `confirmacao` (data e horário propostos);
- **sem opções e sem dado** — `troca_telefone` (sim/não puro).

Exemplo real do defeito de 2026-08-13:

```
aguardando_resposta:
  tipo: escolha_dentista
  opcoes: [Dr. Carlos Turiak, Dra. Vanesa Vocaro]
```

**`null` quando nenhuma pergunta está aberta** — nunca ausente. O campo existe sempre, como
todos os demais blocos (§3.0): `null` afirma *"não há pergunta em aberto"*, que é informação;
um campo ausente afirmaria apenas *"ninguém preencheu"*, que é lacuna. `opcoes` e `detalhe`
continuam ausentes quando não se aplicam — eles são partes internas da pergunta, não blocos
do contexto.

### 3.2 `dentistas_disponiveis` continua sendo a lista de ativos

Decisão explícita, mantida: a lista serve para a Iris **compreender** uma menção
(`"com a Vanessa"`), não para oferecer. Filtrá-la por aptidão faria um dentista mencionado
sumir do payload, a Iris não conseguir resolvê-lo, e o Core seguir com outro **em silêncio**
— pior que o erro atual, que ao menos é explícito.

Quem pode ser **oferecido** continua sendo decisão do Core, a partir do vínculo com o
`procedimento_id` já conhecido. Compreender e oferecer são papéis distintos, com entradas
distintas. Isto **não** é duas fontes de verdade para a mesma coisa.

---

## 4. Saída — ação separada dos dados

```
acao_solicitada:
  tipo: <vocabulário fechado>
  referencia: <id copiado literalmente do contexto, quando a ação exige>

informacoes_fornecidas:
  - campo:    <qualquer fato declarável — cadastral ou conversacional>
    operacao: informou | corrigiu
    valor:    <texto> | null
```

**Duas operações, nunca três** (decisão de 2026-08-14, após medição):

| operação | valor | significa |
|---|---|---|
| `informou` | **não vazio** | está dando o dado agora |
| `corrigiu` | **não vazio** | está substituindo pelo novo valor |
| `corrigiu` | `null` | declarou que o valor atual está errado, **sem** fornecer substituto |

A distinção `informou` × `corrigiu` **permanece obrigatória**: é ela que decide se um dado
oficial já persistido pode ser sobrescrito — sem ela, um paciente corrigindo o próprio CPF
viraria conflito em vez de correção, e a regressão seria silenciosa.

**Regras de forma, para não reintroduzir ambiguidade:**

- `informou` **nunca** aceita `null` nem string vazia;
- `corrigiu` aceita valor não vazio **ou** `null`;
- **string vazia é sempre inválida**, em qualquer operação — só `null` representa remoção;
- `corrigiu: null` **remove** o valor — nunca grava `""`.

Uma regra só, sem normalização: string vazia é recusada, nunca convertida em `null`.
Normalizar seria adivinhar a intenção de uma saída malformada — e é exatamente esse tipo de
conserto silencioso que produziu os defeitos da seção 1.

O schema estrito da OpenAI **não expressa** restrição condicional por valor de campo (o que
`valor` aceita depende de `operacao`). Portanto estas quatro regras são **dever de validação
do Core**, na leitura da saída, e não podem ser delegadas ao schema. Saída que as viole é
recusada como malformada — nunca normalizada por adivinhação.

**Por que `removeu` foi eliminado.** A medição de 2026-08-14 (8 repetições) mostrou a IA
emitindo `corrigiu` com valor vazio em **8 de 8** tentativas de expressar remoção, mesmo com a
instrução distinguindo as três operações explicitamente. E, olhando o efeito: `removeu` e
`corrigiu: null` produzem **exatamente o mesmo resultado** — o valor sai do cadastro. Uma
operação sem consequência própria, que a IA real consistentemente não usa, é complexidade sem
retorno. Reduzir a duas não é afrouxar o contrato para ele passar: é remover uma distinção que
não distinguia nada.

### 4.1 O que entra em `informacoes_fornecidas`

**Todo fato que o paciente declarou neste turno** — não apenas dados sobre si mesmo. São
dois grupos, no mesmo formato e com as mesmas três operações:

- **cadastrais**: `nome`, `cpf`, `data_nascimento`, `email`;
- **conversacionais**: `procedimento`, `data`, `periodo`, `horario`.

Restringir a lista a dados "sobre si mesmo" deixaria procedimento, data, período e horário
sem lugar definido — e tornaria impossível representar `"na verdade 15h"`, que é uma
**correção de fato conversacional** e um dos controles obrigatórios da seção 6.

### 4.2 A fronteira entre ação e informação

**Ação** é o que o paciente quer que aconteça, incluindo **escolher entre opções que a Iris
apresentou**. **Informação** é um fato que ele declarou.

A mesma palavra pode ser uma ou outra, conforme o papel:

- `"Vanesa"`, respondendo a uma escolha de dentista → **ação** (escolher), nunca `nome`;
- `"15h"`, corrigindo um horário já combinado → **informação** (`horario`, `corrigiu`);
- `"15h"`, respondendo a uma lista de horários oferecidos → **ação** (escolher a opção).

Quem distingue é a Iris, pelo significado — nunca o Core, por comparação de texto.

### 4.3 Os casos que definem o contrato

```
"Vanesa por favor"
  acao_solicitada:          escolher_dentista → Vanesa Vocaro
  informacoes_fornecidas:   []
```

```
"Vanesa, e meu nome é Gabriel"
  acao_solicitada:          escolher_dentista → Vanesa Vocaro
  informacoes_fornecidas:   [ {campo: nome, operacao: informou, valor: "Gabriel"} ]
```

```
"na verdade 15h"
  acao_solicitada:          <nenhuma>
  informacoes_fornecidas:   [ {campo: horario, operacao: corrigiu, valor: "15h"} ]
```

A mesma palavra em papéis diferentes, distinguida por **significado** — que é da Iris — e
nunca por comparação de texto no Core.

---

## 5. O que o Core continua fazendo — sem mudança

A autonomia semântica da Iris **não** transfere responsabilidade factual:

- **valida identidade**: todo id declarado é conferido contra o catálogo ativo da clínica —
  inexistente, inativo ou de outra clínica é recusado;
- **valida estrutura**: dígito de CPF, data real, e-mail estruturalmente válido, vocabulários
  fechados — a Iris nunca julga validade;
- **decide se e como executar**: disponibilidade recalculada do zero, trava de concorrência
  na reserva, confirmação explícita obrigatória antes de qualquer efeito destrutivo;
- **nunca faz match de palavra**, em nenhuma camada;
- **persiste somente** o que veio em `informacoes_fornecidas`, depois de validado.

O Core deixa de **deduzir** o que o paciente quis dizer. Continua sendo a única autoridade
sobre o que pode acontecer.

### 5.1 Invariante: escolher profissional não identifica paciente

**Regra.** Quando a saída de um turno trouxer, ao mesmo tempo, `acao_solicitada` de escolha de
dentista **e** um `nome` em `informacoes_fornecidas`, o Core **não persiste esse nome** e a Iris
**pergunta** ao paciente qual dos dois papéis a palavra tinha.

**Por que a guarda existe mesmo com o contrato novo.** A medição de 2026-08-14 (5 repetições
por caso, IA real) mostrou o contrato corrigindo o defeito em 11 de 15 — melhora grande, mas
**instável**: `"Pablo"` e `"vanesa por favor"` ainda produziram `nome` em 2 de 5 cada. E o
modo de falha é o pior possível: a IA declara o nome **com plena confiança**, sem sinal de
dúvida.

**Detecção estrutural, nunca textual.** O gatilho é a **co-ocorrência dos dois campos na mesma
saída** — o Core nunca compara `"Pablo"` com `"Dr. Pablo Arruda"`. Comparar exigiria
normalizar título, primeiro nome e acento, o que (a) é match de palavra, proibido acima e em
`docs/00-principios.md`, (b) foi deliberadamente **removido** deste código em 2026-08-09
(`nome_completo_resolucao`/`nome_curto_resolucao`, `specs/dentista-semantico-v1.md`), e (c) é
frágil: um apelido ou grafia diferente faria o match falhar e a contaminação passar em
silêncio de novo.

**Perguntar, nunca descartar.** Descartar o nome caladamente trocaria um erro visível por um
invisível. A dúvida é do paciente e é ele quem a resolve — é também o que um atendente humano
faria.

**Custo aceito, declarado:** `"Vanesa, e meu nome é Gabriel"` dispara uma confirmação
desnecessária. É pequeno, seguro e recuperável. **Nenhum refinamento é adicionado agora** (por
exemplo, aceitar o nome quando vier CPF junto): seria regra inventada antes da evidência. A
frequência real da pergunta extra é o que a medição da seção 6.4 apura.

**Sem marcador novo.** A confirmação usa o `aguardando_resposta` genérico da seção 3.1, com o
nome proposto em `detalhe` — mais um valor no vocabulário fechado, nunca um quinto marcador
persistido. É exatamente o que aquela seção prevê: não se cria marcador para a pergunta nova,
registra-se a pergunta que foi feita.

```
aguardando_resposta:
  tipo: confirmacao_nome
  detalhe: { nome_proposto: 'Pablo' }
```

---

## 6. Validação em shadow mode

O contrato novo roda **em paralelo** ao atual, sem tocar no atendimento: não executa
capacidade, não altera estado, não muda a resposta. Só decide e registra a comparação.

**Sobre PII, com precisão:** o que é garantidamente livre de PII é o **log da comparação** —
ele contém apenas rótulos estruturais (ação declarada, campos declarados, concordância,
tempo, estado da chamada), nunca texto do paciente nem valor de dado cadastral. O **payload
enviado ao modelo** inevitavelmente contém a mensagem do paciente e o histórico recente,
exatamente como a interpretadora atual já envia hoje. A sombra não amplia os **tipos** nem o
**conteúdo** de PII enviados, mas cria **uma chamada adicional ao modelo** — mais uma
travessia dos mesmos dados, não dados novos. Confundir as duas coisas seria afirmar uma
garantia que não existe.

O mecanismo já existe e já foi validado em produção em 2026-08-13 (`docs/07-arquitetura-v2.md`
seção 10): a chamada paralela roda, não atrasa a resposta, não afeta o atendimento e loga só
rótulos estruturais. O defeito que derrubou aquela etapa foi outro (publicação de marcador),
não o mecanismo de sombra.

### 6.1 Casos que precisam PASSAR — os defeitos de hoje

| # | mensagem | contexto | esperado |
|---|---|---|---|
| 1 | `"Vanesa por favor"` | `aguardando_resposta: escolha_dentista` | ação = escolher dentista; **`informacoes_fornecidas` vazio** |
| 2 | `"Vanesa, e meu nome é Gabriel"` | idem | ação = escolher dentista **e** nome = Gabriel |
| 3 | `"Pode ser Vanessa"` | idem | ação = escolher dentista; sem dado cadastral |

O caso 1 é o defeito que gravou nome errado em produção. O caso 2 é o controle que impede a
correção de virar descarte silencioso.

### 6.2 Casos que HOJE FUNCIONAM e não podem regredir

Controles obrigatórios. Sem eles, a medição prova que o novo conserta o velho, nunca que não
estraga o resto.

| # | mensagem | contexto | comportamento medido a preservar |
|---|---|---|---|
| 4 | `"gabriel cappello cpf 061… data 02-08-1973"` | cadastro pendente | os três campos capturados no mesmo turno |
| 5 | `"pode ser"` | `aguardando_resposta: oferta_procedimento` | aceita a oferta (hoje 3/3; sem o marcador vira `não compreendida`) |
| 6 | `"o segundo"` | `aguardando_resposta: escolha_agendamento` | identifica o agendamento certo (hoje 11/11) |
| 7 | `"na verdade 15h"` | horário já escolhido | **correção**, nunca conflito nem dado novo |
| 8 | `"cancela isso"` | fluxo aberto **e** agendamento existente | ambiguidade conhecida (caso 4e, `docs/07-arquitetura-v2.md` §11) — medir, **não** corrigir agora |

O caso 8 não tem resposta "certa" definida: serve para verificar se o contrato novo piora,
mantém ou melhora uma ambiguidade já documentada.

### 6.4 A guarda da seção 5.1 — as duas medições, e o que cada uma prova

São **duas coisas diferentes**, e confundi-las levaria a afirmar garantia que não existe:

**(a) A guarda dispara — determinístico, não estatístico.** Se a saída trouxer escolha de
dentista e `nome` juntos, o Core não persiste. Isso é 100% **por construção**, não por
medição: não depende da IA. O que a medição contra a IA apura aqui é só a **frequência** —
quantas vezes o paciente leva a pergunta extra. Dado atual: `nome` apareceu em 2 de 5 nos
casos 1 e 2; em `"Vanesa, e meu nome é Gabriel"` a co-ocorrência é sempre.

**(b) A dúvida é resolvida — este sim precisa da IA.** Provar que a guarda impede a gravação
não basta: é preciso provar que a conversa **conclui certo na volta seguinte**. Sem isto, a
guarda poderia estar apenas trocando dado errado por dado nenhum.

| # | volta 1 | volta 2 (`aguardando_resposta: confirmacao_nome`) | esperado ao fim |
|---|---|---|---|
| 9  | `"Pablo"` | `"sim, meu nome é Pablo"` | `nome = Pablo` aceito |
| 10 | `"Pablo"` | `"não, meu nome é Gabriel"` | `nome = Gabriel` aceito, nunca Pablo |
| 11 | `"Vanesa, e meu nome é Gabriel"` | `"Gabriel mesmo"` | `nome = Gabriel` **preservado** |

O caso 11 é o custo declarado na seção 5.1: a pergunta é desnecessária, e o que se mede é se
ela ao menos **não destrói** o nome que o paciente já tinha dado.

### 6.3 Critério de adoção

Cada caso rodado **múltiplas vezes** contra a IA real — nunca uma execução só. Adoção exige:

- os casos **1–2** estáveis **ou** cobertos pela guarda da seção 5.1 — ela cobre a
  contaminação do nome, nunca o caso 3;
- o **caso 3** correto de forma estável (`corrigiu` com valor `null`), por mérito do
  contrato: nenhuma guarda o cobre;
- os casos 9–11 concluindo corretamente na segunda volta;
- **nenhuma** regressão nos casos 4–7;
- caso 8 registrado, sem exigência de melhora.

Falha em qualquer controle **bloqueia** a adoção. O contrato atual permanece intacto até lá.

### 6.5 O que a sombra atual NÃO prova (limite declarado, 2026-08-14)

A sombra implementada mede **um turno de cada vez**. Ela não guarda nada entre turnos: cada
medição monta o contexto do zero, a partir dos fatos que o Core já tem em mãos naquele turno.

Consequência direta, registrada por decisão do Gabriel:

> **A "segunda volta" dos casos 9–11 não está provada pela sombra atual.**

Esses casos dependem de a resposta produzida no turno anterior estar disponível como
`aguardando_resposta` no turno seguinte. Hoje ela não está: `aguardando_resposta` chega
sempre `null` e `opcoes_apresentadas` sempre `[]`, porque **não existe registro autoritativo
de qual pergunta foi de fato feita**. A pergunta anterior só chega em texto, dentro de
`historico_recente`.

A persistência shadow entre turnos foi **abandonada nesta etapa** — sem tabela, sem
sequência, sem migration. Provar a segunda volta depende de uma **futura entrada autoritativa
das mensagens**, que é frente própria e ainda não existe. Até lá, o critério "casos 9–11
concluindo corretamente na segunda volta" da seção 6.3 **não pode ser avaliado** — e nenhuma
medição da sombra atual deve ser lida como se o tivesse avaliado.

O que a sombra atual **prova**, e foi medido com o formato real de produção
(`aguardando_resposta: null`, `opcoes_apresentadas: []`, pergunta apenas no histórico): o
defeito "Pablo" continua observável — a IA emitiu `escolher_dentista` em **10/10** repetições,
e a guarda da seção 5.1 disparou nas 10. A guarda **não** depende da segunda volta.

---

## 7. Ordem de migração

1. especificar (este documento);
2. implementar o contrato novo **somente em shadow**;
3. medir os oito casos contra a IA real;
4. comparar com a interpretadora atual;
5. cortar **uma capacidade por vez**, com verificação real própria;
6. só então remover `dados.intencao`, os quatro marcadores atuais e o contrato antigo.

Até o passo 6, o contrato atual continua sendo o único que controla o atendimento. Reverter
é sempre deixar de usar o novo — nunca uma migração de volta.

---

## 8. O que esta spec NÃO decide

- **não** cria marcador específico para escolha de dentista;
- **não** cria lista de campos permitidos por pergunta;
- **não** remove `dados.intencao` — continua roteando remarcação e cancelamento;
- **não** remove nenhum marcador atual;
- **não** corta nenhuma capacidade para o contrato novo;
- **não** altera comportamento visível ao paciente;
- **não** resolve a ambiguidade do caso 4e;
- **não** trata os dois defeitos ainda abertos de 2026-08-13: os nomes de dentista inventados
  e a invisibilidade silenciosa de um cadastro mal configurado. Ambos permanecem registrados
  como frentes próprias.

---

## 9. Aprovação

- [x] Gabriel — **aprovada em 2026-08-14**, com implementação autorizada **somente em shadow
      local**: sem commit, sem deploy, sem migration.
- [x] revisão independente (Codex) — **aprovada em 2026-08-13**, após três rodadas de
      correção: (1) `informacoes_fornecidas` ampliada para fatos conversacionais, (2)
      `aguardando_resposta` desacoplado da decisão do Core, (3) minimização factual. Mais
      duas correções textuais finais: bloco nunca ausente, e a precisão sobre PII na sombra.
      A aprovação vale **somente para a spec** — o parecer não validou o estado operacional
      de produção.
