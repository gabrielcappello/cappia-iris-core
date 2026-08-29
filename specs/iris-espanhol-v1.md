# Iris 2 — modelo novo, sem palavras fixas, e espanhol

Levantado em 2026-08-28, reestruturado em 2026-08-29. **Nada foi
implementado.** Este documento existe para revisão do Codex e aprovação do
Gabriel antes de qualquer mudança em código, banco, Edge Function ou n8n.

## A frente tem CINCO PASSOS, nesta ordem (decisão do Gabriel, 2026-08-29)

A v1 desta spec tratava tudo como uma frente só de espanhol. Está errado:
são três mudanças independentes, e fazer duas ao mesmo tempo impede saber
qual causou o quê quando algo sair errado.

| # | Passo | Idioma do teste | Por que antes do seguinte |
|---|---|---|---|
| **1** | **Modelo Luna + validação em português** | português | Um modelo mais capaz pode dispensar sozinho parte das palavras fixas — o passo 2 encolhe |
| **2** | **Redação natural: sem palavras fixas, com nome e personalidade** | português | Camada de compensação removida ANTES de existir um segundo idioma para multiplicá-la |
| **3** | **Adicionar espanhol** | espanhol | Só sobre uma base já estável e já sem palavras fixas |
| **4** | **Teste completo pelo WhatsApp na Iris 2** | ambos | Fluxo real de ponta a ponta, clínica e número de teste |
| **5** | **Só então: eventual promoção para a Iris 1** | — | Depende de revisão do Codex + autorização explícita do Gabriel |

**Cada passo é validado antes do seguinte começar.** Um passo por vez, uma
variável por vez.

### Regras de isolamento entre Iris 1 e Iris 2 (decisões do Gabriel, 2026-08-29)

1. **A Iris 1 permanece intacta durante toda a implementação e validação.**
   Nenhum deploy, nenhuma alteração de tráfego, workflow, endpoint ou
   instância de WhatsApp da produção atual.
2. **A Iris 2 é uma produção paralela temporária, só para teste.** Usa:
   - a mesma base de código / mesmo repositório;
   - **branch própria** (`iris-2`, já criada);
   - Edge Function / endpoint separado;
   - workflow / rota separados quando necessário;
   - clínica e número de WhatsApp exclusivos de teste.
3. **Não criar outro repositório, nem duplicar o sistema ou o banco.** A
   separação obrigatória é entre **destinos de deploy** e **tráfego**. O
   banco é compartilhado, preservando o isolamento por `clinica_id` que já
   existe — nada da Iris 2 pode afetar dados ou atendimentos da Iris 1.
4. **A Iris 2 é testada como fluxo real completo pelo WhatsApp** antes de
   qualquer atualização da Iris 1.
5. **A promoção só acontece** depois dos testes da Iris 2, da revisão do
   Codex e da autorização explícita do Gabriel. A versão anterior da Iris 1
   permanece disponível para rollback.
6. **Solução mínima.** Não criar banco, repositório, camada, fallback, gate
   ou documentação adicional sem bloqueio técnico comprovado.

### TUDO acontece na Iris 2 — inclusive o passo 1

**Decisão explícita do Gabriel (2026-08-29), em resposta à sugestão de
fazer os passos 1 e 2 direto em produção:**

> *"não quero trocar o modelo com a que está em produção. quero fazer isso
> fora da Iris. só depois de passar todos os testes reais feitos no
> WhatsApp vou considerar atualizar a Iris 1."*

Ou seja: a Iris 1 **não é tocada em nenhum dos três passos**. A troca de
modelo é feita na Iris 2, testada no WhatsApp com clínica real de teste, e
só então o Gabriel decide se promove.

O risco registrado da cópia (divergência entre cópia e produção,
proporcional ao tempo — ver Riscos) continua valendo e **cresce** com três
passos em sequência. É um custo aceito conscientemente, não um descuido:
trocar o modelo da IA que atende pacientes reais sem validação prévia é um
risco maior do que manter a cópia sincronizada.

### Passo 1 em detalhe — qual modelo, e por quê

| | Modelo | Entrada /1M | Saída /1M | Score público |
|---|---|---|---|---|
| **Hoje** | `gpt-4.1-mini-2025-04-14` (`cliente-modelo-openai.ts:20`) | $0,40 | $1,60 | 44,08 |
| **Alvo** | **GPT-5.6 Luna** | **$0,20** | **$1,20** | **66,96** |
| Plano B | GPT-5.6 Terra | $2,00 | $12,00 | — |

**Nos testes comparativos realizados no contexto da Iris, a Luna
apresentou resultado superior ao modelo atual, além de menor custo** — não
é uma troca com compromisso. Terra é 5x mais caro na entrada que o atual:
só entra se a Luna não der conta.

**Por que isso importa para o passo 3 (espanhol):** a linha que domina o
risco de toda a frente é "validar que conversa bem em espanhol". Um modelo
mais capaz reduz esse custo — e um modelo melhor em espanhol o reduz
diretamente. **A capacidade específica em espanhol da Luna ainda NÃO foi
medida, e será validada no passo 3, não presumida.** O passo 1 valida o
modelo em **português**; espanhol não é critério de aceitação do passo 1.

**Structured Outputs: CONFIRMADO (2026-08-29).** A `gpt-5.6-luna` suporta
structured outputs via JSON schema em `response_format`, além de tool
calling e prompt caching — o mesmo contrato que o core já usa
(`interpretacao-instrucoes.ts:76` e a chamada separada da redatora em
`cliente-modelo-redator-openai.ts`). Não há bloqueio técnico para a troca.
Contexto de 1.050.000 tokens, até 128.000 de saída.

### O que a ordem nova muda no resto desta spec

- **A Camada 2 (~26 frases fixas) provavelmente deixa de existir** antes do
  passo 3. Traduzi-las seria trabalho jogado fora — elas são justamente
  "palavras fixas", alvo do passo 2.
- **A guarda de execução (3a/3a-bis) é problema do PASSO 2, não do 3.** Ela
  é lógica de português no Core com a Iris ainda monolíngue: dá para
  torná-la estrutural testando contra o português, onde há conversas reais
  para validar. Deixá-la para o passo 3 seria mexer em segurança e em
  idioma ao mesmo tempo.
- **A Camada 4 (`fatos-autorizados.ts`) é o coração do passo 2** — ver
  seção própria.

## Aderência a `docs/00-principios.md`

Exigido por `docs/00-principios.md` ("Como aplicar na prática"): toda spec
declara aderência a ele e aponta **o que remove**.

**O que esta spec remove:** a dependência de idioma dentro da guarda de
execução (`guarda-resposta-redatora.ts`) — ver seção 3a. Não é uma camada
a estender para 19 países; é uma camada a eliminar, substituída por
verificação estrutural que não interpreta linguagem natural.

**O que esta spec acrescenta:** um conjunto de instruções por idioma
(prompts), e a leitura de um campo que já existe no banco. Instrução dada
à IA não é regra-por-palavra em código — é o lugar onde este projeto já
decidiu que a compreensão de linguagem deve morar.

**Exceção declarada:** nenhuma. Se a implementação concluir que a guarda
não pode ser tornada agnóstica sem perder proteção, isso vira uma exceção
explícita, escrita aqui com o motivo, e depende de aprovação do Gabriel
(`00-principios.md`, última regra da seção "Como aplicar na prática").

## Objetivo

Hoje a Iris conversa somente em português. O painel já funciona em 8
idiomas e cada clínica já tem o campo `clinicas.idioma` preenchido. O
objetivo é a Iris atender também em espanhol, escolhendo o idioma pelo
campo que já existe.

## Decisão do Gabriel (2026-08-28): caminho "C"

Três caminhos foram considerados:

- **A — cópia permanente em espanhol.** Duas bases separadas para sempre.
  Recusado: todo bug corrigido numa precisaria ser reaplicado na outra,
  manualmente, em outro idioma.
- **B — adicionar espanhol direto na Iris atual.** Recusado como primeiro
  passo: mexe no que está em produção atendendo clínicas reais.
- **C — cópia temporária (ESCOLHIDO).** Copiar a Iris atual para um
  ambiente separado, implementar o suporte a idioma nessa cópia, testar
  em paralelo com a Iris atual intacta em produção, e só então promover a
  cópia a produção e desativar a antiga.

C entrega o resultado de B (uma base só, bilíngue) sem o risco de B
durante o desenvolvimento. **A cópia é um andaime, não um produto** — ela
existe para ser promovida, nunca para conviver em paralelo com a atual a
longo prazo.

## O que já está pronto e a favor

Levantado por auditoria de código nesta data:

- **O core é cego a idioma.** `grep -r "idioma" src/core/` retorna zero
  ocorrências. Não há nada a desfazer — só a acrescentar. **Consequência
  que a v1 desta spec errou:** como nada lê o campo hoje, ele também
  **não é carregado** — ver "Carregar o campo" no desenho. Não basta
  escolher o prompt; o dado precisa primeiro chegar ao core.
- **A normalização de texto é agnóstica de idioma.**
  `normalizacao-texto.ts` faz exatamente quatro transformações (lowercase,
  remoção de acentos, trim, colapso de espaços) — funciona igual em
  espanhol, sem mudança.
- **O resolvedor temporal não depende de português.**
  `resolver-temporal.ts` opera sobre átomos já normalizados (`'hoje'`,
  `'amanha'`, `dia_semana`) — quem traduz a fala do paciente nesses
  átomos é a IA interpretadora, não um dicionário de palavras no código.
- **`clinicas.idioma` já existe, já é usado pelo painel, e já distingue o
  país.** A tela "Idioma e Localização" grava `idioma: \`${lang}-${pais}\``
  (`iris-portal-v2/src/app/dashboard/page.tsx:703`). **Não é preciso campo
  novo nem cruzar com `pais_codigo`**: a distinção por país que a Iris
  precisa já está gravada no mesmo campo.

  **ATENÇÃO AO FORMATO REAL — não é locale padrão.** Consultado no banco
  operacional nesta data:

  | nome | idioma | pais_codigo |
  |---|---|---|
  | Cleardent | `português-br` | `br` |
  | teste 1 | `português-br` | `br` |

  O valor é **o nome do idioma por extenso, em português, com acento**,
  mais o código do país **em minúscula** — `português-br`, e para espanhol
  será `español-cl`, `español-ar`, `español-mx` (`page.tsx:19-20` e
  `435-436` são a fonte desses literais). **Nunca é `pt-BR` nem `es-CL`.**
  Qualquer parsing na Iris tem de usar esse formato real; assumir o padrão
  ISO faria toda clínica cair no fallback e a Iris responderia sempre em
  português, silenciosamente.
- **Sem limite de infraestrutura.** O projeto `udizowyfjnhuhgxkeayk` tem 3
  Edge Functions ativas hoje (`criar-clinica`, `suporte-chat`,
  `iris-nova-mensagem` v85); criar uma quarta é livre. Instância de
  WhatsApp: **exclusiva de teste** (o Gabriel providencia) — nunca a de
  produção, que fica intocada.

## Onde o português está fixado (4 camadas)

### Camada 1 — Instruções das IAs (o trabalho real)

Três arquivos, ~390 linhas de instruções escritas em português:

| Arquivo | Linhas | Papel |
|---|---|---|
| `src/core/redator-instrucoes.ts` | 92 | como a Iris ESCREVE ao paciente |
| `src/core/interpretacao-instrucoes.ts` | 154 | como ela ENTENDE o paciente |
| `src/core/resultado-iris-instrucoes.ts` | 147 | contrato do resultado |

**Este é o ponto mais importante da spec, e o mais fácil de subestimar.**
Esses prompts não são "texto a traduzir": cada parágrafo é a correção de
um defeito real observado em produção, com data. Exemplos literais do
`redator-instrucoes.ts`:

- *"Em 2026-08-14 uma proposta para HOJE foi anunciada como 'amanha,
  14/08' porque a redatora deduziu por conta propria: o paciente
  apareceria no dia errado."*
- *"Ate 2026-08-17 esses dados nao chegavam ate voce e a resposta saia
  como 'somos a clinica odontologica', o que parecia que voce estava
  escondendo algo."*

Traduzir o texto **não transfere a correção**: o modelo em espanhol vai
errar de formas próprias, que ninguém ainda observou. Descobrir e corrigir
esses erros é o verdadeiro custo desta frente — não a engenharia.

### Camada 2 — Frases fixas de sistema

`src/core/gerar-resposta-paciente.ts` tem ~26 respostas literais em
português, enviadas ao paciente sem passar por IA (ex.: *"Esse horário
acabou de ficar indisponível. Pode escolher outro horário?"*, *"Não
encontrei nenhum agendamento seu para remarcar no momento."*). Tradução
mecânica, baixo risco.

### Camada 3 — Lógica acoplada ao português

**A v1 desta spec dizia "praticamente limpa". Auditoria completa
(2026-08-28, 73 arquivos / 20.129 linhas do core) mostrou que não é.**
Três achados, um deles de segurança:

#### 3a. `guarda-resposta-redatora.ts` — guarda de segurança que só funciona em português

É a guarda que impede a Iris de **anunciar um agendamento que não
aconteceu**. O cabeçalho do arquivo registra por que existe: uma resposta
inventada entrou no histórico e *"quatro horas depois, aqueles valores
viraram um agendamento REAL que ninguém pediu"*.

Ela é inteiramente dependente do idioma:

| Linha | O que faz | Em espanhol |
|---|---|---|
| `:66` `REGEX_EXECUCAO` | procura particípios `confirmad[oa]s?\|remarcad[oa]s?\|marcad[oa]s?\|cancelad[oa]s?\|agendad[oa]s?` | coincide por acaso em alguns, **falha em outros** |
| `:117` | detecta negação: `\bn[aã]o\s+(est[aá]\|foi\|ficou)...` | **não bate** com `"no está confirmado"` |
| `:122` | `toLocaleLowerCase('pt-BR')` | locale fixo |
| `:47` `REGEX_NH` | `14h` | espanhol usa mais `14:00` |

**Consequência se não for tratado: a Iris em espanhol fica sem essa
proteção, e o defeito que a originou pode voltar — em silêncio.**

#### 3a-bis. Esta guarda JÁ FOI REMOVIDA UMA VEZ, por violar `00-principios.md`

Achado trazido por revisão independente (outro Code) e **verificado por
medição** nesta data. Muda a natureza do problema: não é só "falta
traduzir", é **um conflito com documento canônico**.

`docs/00-principios.md` (aprovado pelo Gabriel em 2026-08-08) lista, no
caso **2** da seção "Origem", exatamente esta guarda:

> *"A guarda tentava detectar, por regex, se o texto afirmava uma reserva
> ('marcado', 'confirmado') — e precisava de uma exceção nova a cada frase
> que ela não previa. Chegou a reprovar 'Ainda não está confirmado, tá?'
> por conter a palavra 'confirmado'. Era um segundo interpretador de
> português feito em código. **Removida por completo.**"*

E a regra de aplicação do mesmo documento:

> *"Ao encontrar uma lista de palavras, um mapa de sinônimos, **um regex
> sobre linguagem natural** (...): tratar como candidato a remoção, não
> como algo a estender."*

**O que aconteceu depois:** o cabeçalho do próprio
`guarda-resposta-redatora.ts` registra a remoção em 06/08 — e a regex
está lá hoje, reintroduzida em **20-21/08**, porque o defeito real
voltou três vezes e um deles virou *"um agendamento REAL que ninguém
pediu"*. Os dois lados têm razão: o princípio proíbe a camada, e a
ausência dela causou dano concreto.

**Medição em espanhol (executada nesta data), com a regex atual:**

| Frase | Resultado |
|---|---|
| `"Ainda não está confirmado, tá?"` (pt) | passa ✓ |
| `"Tu cita no está confirmada todavía"` | **REPROVA** ✗ |
| `"Todavía no está confirmada"` | **REPROVA** ✗ |
| `"Tu cita está confirmada para el 25/08"` | REPROVA ✓ (correto) |

Ou seja: em espanhol a guarda **bloqueia justamente as frases em que a
Iris está dizendo que NÃO está confirmado** — a mesma regressão de
06/08, ressuscitada pelo idioma. Estender essa regex para 19 países é
literalmente o movimento que `00-principios.md` proíbe.

**Direção correta (a decidir na implementação, com o Codex):** eliminar a
dependência de linguagem em vez de traduzi-la — verificar
estruturalmente se houve execução (o Core sabe se executou; isso é um
fato booleano, não uma frase a interpretar), em vez de procurar
particípios no texto. Se isso se mostrar impossível sem perder proteção,
vira exceção declarada (ver "Aderência" no topo).

#### 3b. `nome_pt` hardcoded na cadeia inteira de procedimentos

O banco **já tem as traduções**: `procedimentos_catalogo` tem
`nome_pt, nome_es, nome_en, nome_fr, nome_de, nome_it, nome_ru, nome_ar`,
e `carregar-catalogo.ts:184` já as CARREGA todas. Mas só `nome_pt` é
usado adiante — e o nome do campo virou contrato:

- `interpretacao-extrator.ts:110,373` — tipo do payload da IA é
  `{procedimento_id, nome_pt}`.
- `interpretacao-extrator.ts:385` — **valida que as chaves são
  literalmente `nome_pt`/`procedimento_id`** e rejeita qualquer outra.
- `dentista-do-tratamento.ts:38`, `fatos-autorizados.ts:90`,
  `duracao-tipos.ts:46` — mesmo campo, mesma suposição.

Ou seja: a Iris em espanhol ofereceria *"Limpeza dental (profilaxia)"* em
português a um paciente chileno, embora `nome_es` exista no banco ao lado.
Corrigir exige trocar o campo por um nome resolvido por idioma ao longo
dessa cadeia — mudança pequena por arquivo, mas em vários pontos, e um
deles é uma validação estrita de chaves.

**Cobertura das traduções — MEDIÇÃO DATADA (2026-08-28):** dos 46
procedimentos do catálogo, **46 têm `nome_es` preenchido — zero buracos.**

*Via de consulta, para quem quiser reproduzir:* API de management do
Supabase (`POST /v1/projects/udizowyfjnhuhgxkeayk/database/query`),
autenticada com o PAT do cofre canônico. **Não** pelo MCP `mcp__supabase`
desta sessão, que aponta para outro projeto. **Tratar como medição
datada, não como fato permanente:** entre esta data e o passo 3 o catálogo
pode ganhar procedimento novo sem tradução — o que torna o fallback abaixo
obrigatório, não opcional.
Ainda assim, o fallback deve existir (`nome_es` vazio → `nome_pt`): o
catálogo pode ganhar procedimento novo sem tradução a qualquer momento, e
oferecer o nome em português é melhor do que oferecer vazio.

**Atenção ao efeito colateral na interpretação:** o mesmo campo alimenta o
payload que a IA usa para ENTENDER o paciente
(`procedimentos_disponiveis`, `interpretacao-instrucoes.ts:39`). Se a
Iris passar a oferecer em espanhol mas continuar recebendo a lista em
português para interpretar, ela pode não reconhecer o procedimento que o
paciente repetir de volta. Os dois lados — o que ela diz e o que ela lê —
precisam usar o mesmo idioma.

#### 3c. O que realmente está limpo

Confirmado por leitura, não por suposição:

- `normalizacao-texto.ts` — as quatro transformações (lowercase, acentos,
  trim, espaços) valem igual em espanhol.
- `resolver-temporal.ts` — opera sobre átomos já normalizados
  (`'hoje'`, `'amanha'`, `dia_semana`); quem traduz a fala do paciente é
  a IA, não um dicionário no código.
- `guarda-lista-vazia-dentistas.ts`, `guarda-nome-escolha-dentista.ts` —
  trabalham com estrutura, não com palavras.
- **Vocabulários fechados** (`PERIODOS_PERMITIDOS = ['manha','tarde','noite']`,
  `CONFIRMACOES_PERMITIDAS = ['sim']`, `INTENCOES_PERMITIDAS`) —
  são identificadores internos, injetados no prompt e no schema JSON como
  enum (`interpretacao-instrucoes.ts:68-76`). A IA em espanhol devolve
  esses tokens mesmo conversando em espanhol. **Não precisam mudar** — e
  traduzi-los seria um erro.

### Passo 2 também entrega: `nome_agente` e `personalidade` (decisão do Gabriel, 2026-08-29)

O passo 2 não é só remover — é substituir compensação por compreensão. Na
mesma etapa entra a implementação real de dois campos que **já existem no
banco e no painel, e que a Iris nunca recebeu**.

**Verificado nesta data:**

| Clínica | `nome_agente` | `personalidade` |
|---|---|---|
| Cleardent | `iris` | **`moderna`** |
| teste 1 | `Iris` | `null` |

E no código: `grep -rn "nome_agente\|personalidade" src/core/ supabase/functions/`
retorna **apenas um comentário** em `redator-instrucoes.ts:13`. Nenhuma
leitura, nenhum uso. A clínica preencheu "moderna" no painel e isso não
chega a lugar nenhum.

**É o mesmo defeito já registrado duas vezes neste projeto:** campo que a
clínica preenche e que morre antes da Iris (o caso de `clinica-conhecida.ts`
em 17/08, e o de `historico_recente` em 08/08, este último citado em
`docs/00-principios.md` como origem do princípio do teste isolado).

**Requisitos (do Gabriel):**

- Os dois campos devem **chegar ao redator**.
- A `personalidade` orienta **tom, calor, objetividade e estilo**.
- **Não pode funcionar por frases prontas** — é orientação ao modelo, não
  um mapa de personalidade → texto pronto. Um mapa assim seria exatamente
  a camada que o passo 2 existe para remover (`00-principios.md`).
- **Não pode alterar decisão operacional**: nem ferramentas, nem horários,
  nem dentistas, nem ações. Personalidade governa COMO se fala, nunca O QUE
  é fato — a mesma fronteira que `fatos_autorizados` já estabelece.
- **Sem spec separada**: entra nesta.

**Por que cabe no passo 2 e não no 3:** é sobre a redatora falar de forma
natural sem texto pronto — o mesmo movimento de tirar as palavras fixas.
Fazer antes do espanhol também evita ter de traduzir uma camada de
personalidade que ainda não existe.

### Camada 4 — português MONTADO em `fatos-autorizados.ts` (o coração do passo 2)

Achado trazido por revisão independente (outro Code) e **verificado nesta
data**. A v1 desta spec dizia "3 camadas" e não mapeou esta — que é a mais
difícil das quatro.

`fatos-autorizados.ts` **monta frases em português** e as entrega à
redatora como fato autorizado:

| Linha | Conteúdo |
|---|---|
| `:533-541` | `NOMES_DIA_SEMANA = ['segunda-feira', 'terça-feira', ... 'domingo']` |
| `:379-381` | `` `hoje, ${absoluta}` `` / `` `amanhã, ...` `` |
| `:571-577` | frase degradada: sem procedimento vira `"atendimento"` |

**Por que é mais difícil que as outras camadas:**

1. **É contrato com a redatora**, não texto solto. O prompt instrui
   explicitamente a obedecer essa relação: *"a relação que vem nos fatos do
   Core PREVALECE sobre qualquer conta sua (...) quando o Core diz 'hoje,
   14/08' ou 'amanhã, 18/08', use exatamente essa relação"*
   (`redator-instrucoes.ts`). Mudar o formato mexe numa correção de bug
   real de 2026-08-14.
2. **É entrada da guarda.** `guarda-resposta-redatora.ts` extrai o horário
   de dentro desses textos montados — as duas coisas estão acopladas.

**Consequência para a ordem dos passos:** o passo 2 ("remover palavras
fixas") é provavelmente **esta camada**, mais do que as ~26 frases da
Camada 2. E como ela está acoplada à guarda (3a), as duas se resolvem
juntas, no mesmo passo — o que reforça mantê-las no passo 2 e não no 3.

## Achado que muda o esforço: testes acoplados ao texto dos prompts

**71 referências às constantes de instruções em 7 arquivos de teste**,
verificando o CONTEÚDO dos prompts em português com
`assert.match(INSTRUCOES_REDATOR, /clinica_conhecida/)` e equivalentes.

**Contagem corrigida em 2026-08-29** — a v1 desta spec dizia "38 em 7
arquivos", número que não conferia. Recontado por
`grep -c "INSTRUCOES_REDATOR\|INSTRUCOES_EXTRATOR\|INSTRUCOES_RESULTADO_IRIS"`:

| Arquivo de teste | Referências |
|---|---|
| `interpretacao-instrucoes.test.ts` | 32 |
| `interpretacao-pergunta-vs-escolha.test.ts` | 14 |
| `dentista-confirmado-ao-pedir-data.test.ts` | 7 |
| `contexto-horarios-payload.test.ts` | 7 |
| `clinica-e-precos-fronteira.test.ts` | 5 |
| `interpretacao-extrator.test.ts` | 4 |
| `cliente-modelo-openai.test.ts` | 2 |
| **total** | **71** |

(São referências às constantes, não asserções contadas uma a uma — o
número exato de asserções a ajustar sai na implementação. O ponto é a
ordem de grandeza: é quase o dobro do que a v1 orçava.)

Consequência: assim que os prompts virarem "um por idioma", esses testes
precisam decidir **contra qual idioma** asseguram. Se ficarem apontando só
para o português, o espanhol nasce sem nenhuma cobertura equivalente. Isso
precisa ser resolvido na implementação, não descoberto depois.

## Desenho proposto

### Carregar o campo (passo zero, sem o qual nada funciona)

Hoje `clinicas.idioma` **não chega ao core**. Os quatro pontos que leem a
tabela `clinicas` na Edge Function pedem colunas específicas, e nenhum
pede `idioma`:

| Arquivo | O que seleciona hoje |
|---|---|
| `carregar-catalogo.ts:121-128` | `dentistas, automatizacoes, nome, endereco, ...` |
| `carregar-disponibilidade.ts:117` | `dentistas, fuso_horario` |
| `identificacao.ts:168` | `id` |
| `orquestrador.ts:1927` | `fuso_horario` |

**O ponto de mudança é `carregar-catalogo.ts`** — acrescentar `idioma` à
lista de colunas do `select` que já existe. Zero consulta nova, zero
coluna nova no banco. É exatamente o mesmo movimento já feito em
2026-08-17 por `clinica-conhecida.ts`, quando nome/endereço/telefone da
clínica também não chegavam à Iris (ver o cabeçalho daquele arquivo: *"a
Edge Function só lia `fuso_horario`, `dentistas` e `automatizacoes` —
nome, endereço e telefone NUNCA saíam do banco"*). Mesmo defeito, mesma
correção.

### Seleção de idioma

O valor real é `português-br` / `español-cl` — **nome do idioma por
extenso, com acento, mais país em minúscula** (ver "ATENÇÃO AO FORMATO
REAL" acima). A resolução é em dois níveis:

1. **A parte do idioma (`português` / `español`) escolhe o conjunto de
   instruções.** É o que decide em que língua a Iris pensa e escreve.
2. **A parte do país (`cl`, `pe`, `ar`, `mx`) ajusta o sotaque** — ver
   "Variação por país" abaixo.

O painel corta no **último** hífen (`useTranslation.ts:55-60`) — o mesmo
critério deve ser usado aqui, para que os dois lados leiam o campo do
mesmo jeito. Nunca reimplementar o parsing de forma divergente.

Idioma ausente, malformado, ou de língua não suportada → português, com
comportamento **byte-a-byte idêntico ao de hoje**. Mesma disciplina de
compatibilidade já usada em `dias-atendimento-dentista-v1.md` (valor
ausente = comportamento anterior preservado).

**Ponto de atenção do fallback:** como toda clínica hoje tem
`português-br`, um erro de parsing não quebra nada visivelmente — só faz
a Iris responder em português para uma clínica espanhola, em silêncio.
Isso precisa de teste explícito, não de inspeção visual.

**Comparar o idioma com acento é frágil.** O valor gravado é `português`
/ `español` — com acento e cedilha. Comparar por igualdade literal
(`=== 'español'`) quebra se algum valor entrar sem acento (`espanol`,
`portugues`) por digitação, migração ou outra origem que não a tela do
painel. Recomendação: comparar **depois de normalizar** com o
`normalizarTextoCanonico` que o core já tem (`normalizacao-texto.ts`,
que remove acento) — e reconhecer por prefixo estável (`espanol...`,
`portugues...`), nunca por string exata. Casos-limite já testados e que
funcionam com o corte no último hífen: `español-es` (idioma e país
iguais), `español-do`, valor sem país (`español`), valor vazio.

### Método já provado: reaproveitar o do i18n do painel

Achado trazido por revisão independente. **Metade desta frente já foi
resolvida uma vez neste projeto**, em 23/07/2026, quando o painel foi para
8 idiomas (`cappia-estado/HANDOFF-i18n-painel.md`). O método de lá vale
aqui, principalmente para a Camada 2 (frases fixas):

1. Catalogar todo texto fixo.
2. Escrever nos idiomas alvo.
3. **Script de completude** — garante que nenhuma chave ficou faltando em
   nenhum idioma.
4. **Diff byte-a-byte** contra o literal português original — garante que
   o português não regrediu ao ser movido.

**Duas armadilhas registradas naquele handoff, que esta spec herdaria se
ignorasse:**

- *"O TypeScript só valida a chave existir em algum idioma, não em todos —
  **gap silencioso conhecido do sistema**."* Foi por isso que o script de
  completude precisou existir. Esta spec propõe "um só lugar por idioma"
  sem nenhum mecanismo equivalente: **nasceria com o mesmo buraco**. A
  implementação precisa de uma verificação de completude própria.
- O bug real de lá: faltar o provedor de idioma fazia **aparecer a chave
  crua na tela** — *"regressão pior do que não ter feito nada"*. O análogo
  aqui é o fallback silencioso já temido na seção "Seleção de idioma":
  falha que não quebra nada visível, só entrega o idioma errado.

### Organização dos prompts

Os três arquivos de instruções passam a expor as instruções por idioma em
vez de uma constante única. A forma exata (objeto por idioma, arquivo por
idioma, ou função `instrucoes(idioma)`) fica para a implementação decidir
com o Codex — o requisito é: **um só lugar por idioma, nunca instrução
duplicada em dois arquivos**, mantendo o princípio já declarado no topo de
`redator-instrucoes.ts` ("único lugar onde o contrato dado à IA redatora é
registrado").

### Variação por país (decisão do Gabriel, 2026-08-28)

O espanhol do Chile, do Peru e da Argentina não são a mesma coisa — o
sotaque, o tratamento (tú / vos / usted) e o vocabulário mudam, e uma
recepcionista que fala "errado" para a região soa estrangeira. A Iris deve
distinguir.

**Como, sem multiplicar o prompt inteiro:** o conjunto de instruções em
espanhol é **um só** (a mesma jurisprudência de comportamento, traduzida
uma vez), com um **complemento curto por país** — tratamento padrão,
algumas escolhas de vocabulário, formato de data se divergir. Nunca um
prompt inteiro por país: isso recriaria, dentro do espanhol, o mesmo
problema de manutenção duplicada que fez a opção "A" ser recusada.

País desconhecido ou sem complemento definido → espanhol sem complemento
(neutro), nunca erro.

**Escopo da v1 (decisão do Gabriel, 2026-08-28): TODOS os países de língua
espanhola que o painel já oferece, de uma vez.** Nada de acrescentar país
sob demanda: a clínica que assinar amanhã precisa funcionar amanhã, não
depois de mais uma rodada de desenvolvimento.

Os 19 países hispanofalantes já presentes em `PAIS_NOME_PT`
(`iris-portal-v2/src/app/dashboard/page.tsx:31-43`), com o código que o
painel grava em `clinicas.idioma`:

| | | | |
|---|---|---|---|
| `español-ar` Argentina | `español-bo` Bolívia | `español-cl` Chile | `español-co` Colômbia |
| `español-cr` Costa Rica | `español-cu` Cuba | `español-do` Rep. Dominicana | `español-ec` Equador |
| `español-es` Espanha | `español-gt` Guatemala | `español-hn` Honduras | `español-mx` México |
| `español-ni` Nicarágua | `español-pa` Panamá | `español-pe` Peru | `español-py` Paraguai |
| `español-sv` El Salvador | `español-uy` Uruguai | `español-ve` Venezuela | |

O complemento de cada país é curto (tratamento padrão, poucas escolhas de
vocabulário) — escrever os 19 é barato. **O custo real continua sendo a
validação**, e ela não precisa ser feita país a país antes de lançar: a
base é o espanhol comum, que é o que se valida a fundo; os complementos
ajustam o sotaque sobre uma base já provada.

Agrupamento útil ao escrever os complementos: **voseo** (`AR`, `UY`, `PY`,
parte da América Central) usa "vos"; **usted como padrão cortês** é mais
forte em `CO`, `MX`, `PE`, `CR`; **`ES`** difere dos demais em vocabulário
e no uso de "vosotros". Isso orienta a redação, não cria 19 prompts.

### Infraestrutura mínima da Iris 2

O necessário, e nada além (regra 6 do isolamento):

| Item | Iris 1 (intocada) | Iris 2 (nova) |
|---|---|---|
| Repositório | `cappia-iris-core` | **o mesmo** |
| Branch | `main` | **`iris-2`** (já criada) |
| Edge Function | `iris-nova-mensagem` (v85) | **`iris-nova-mensagem-v2`** |
| Workflow n8n | "Iris Oficial" (`8oNbqLc9QLaHz8lF`) | **novo, apontando para a v2** |
| Instância WhatsApp | a de produção | **exclusiva de teste** |
| Projeto Supabase | `udizowyfjnhuhgxkeayk` | **o mesmo** |
| Banco / schema | — | **o mesmo, sem tabela nova** |
| Clínica | as atuais | **uma nova, só para teste** |

**Não entra:** repositório novo, projeto Supabase novo, banco novo, schema
novo, painel novo. O isolamento vem do par (Edge Function + workflow +
número de WhatsApp), somado ao isolamento por `clinica_id` que o banco já
tem.

### Promoção (fim da etapa)

Só depois de: testes reais completos pelo WhatsApp na Iris 2 + revisão do
Codex + **autorização explícita do Gabriel**. A versão anterior da Iris 1
(`iris-nova-mensagem` v85) permanece disponível para rollback.

**A Iris 2 nunca vira uma segunda Iris permanente** — se a promoção não
acontecer, a frente não terminou.

## Riscos e pontos de atenção

1. **O custo real é linguístico, não técnico.** A engenharia (ler um
   campo, escolher um conjunto de instruções) é pequena. Validar que a
   Iris conversa BEM em espanhol exige conversas reais e várias rodadas de
   correção — mesmo esforço que o português levou meses para acumular.
2. **Divergência durante a etapa.** Enquanto a cópia existe, toda correção
   feita na Iris de produção precisa ser levada para a cópia. Quanto mais
   longa a etapa, maior o risco. Mitigação: manter a etapa curta e
   registrar cada correção aplicada em produção durante o período.
3. **Testes dos prompts** (ver achado acima) — decidir a estratégia antes
   de traduzir, não depois.
4. **`date-fns` com locale `ptBR` fixo** — pendência do painel, **já com
   fronteira decidida** em `HANDOFF-i18n-painel.md` ("fora do escopo
   daquela frente, mesma fronteira já aplicada à moeda"). Não é achado
   novo desta spec nem decisão a retomar aqui: fica fora, pelo mesmo
   critério de lá. Registrado só para não ser redescoberto como se fosse
   novidade.
5. **Variação por país multiplica a validação.** Ver a seção "Variação por
   país" — a decisão do Gabriel foi ter sotaque próprio por país, e o
   risco a monitorar é que cada país adicionado é mais uma variante a
   validar com conversas reais (item 1).

## Complexidade — onde o trabalho realmente está

Não é uma frente difícil de engenharia; é uma frente cara de validação.

### Passo 1 — trocar o modelo

| Parte | Esforço | Risco |
|---|---|---|
| Montar ambiente da Iris 2 (function + n8n + WhatsApp) | baixo | baixo |
| Trocar a constante do modelo | trivial | baixo |
| Confirmar structured output / schema JSON no modelo novo | baixo | **médio** — se não suportar, muda o desenho |
| **Validar comportamento em português vs Iris 1** | **alto** | **médio** |

### Passo 2 — redação natural: sem palavras fixas, com nome e personalidade

| Parte | Esforço | Risco |
|---|---|---|
| **Guarda de execução → verificação estrutural (3a)** | médio | **ALTO — segurança** |
| **Camada 4: `fatos-autorizados.ts` (dias, "hoje,"/"amanhã,")** | **alto** | **ALTO** — contrato com a redatora + entrada da guarda |
| ~26 frases fixas da Camada 2 | baixo | baixo |
| **`nome_agente` + `personalidade` até o redator** | baixo | **médio** — não pode virar frase pronta nem tocar decisão operacional |
| Validar que nada regrediu em português | alto | médio |

### Passo 3 — adicionar espanhol

| Parte | Esforço | Risco |
|---|---|---|
| Carregar `idioma` no `select` | trivial (1 coluna) | baixo |
| Resolver idioma+país do valor | trivial | **médio** — formato não-ISO, fallback silencioso |
| Traduzir os 3 prompts (~390 linhas) | médio | **alto** — ver Camada 1 |
| **`nome_pt` → nome por idioma (3b)** | médio | médio |
| 19 complementos de país | baixo (curtos) | baixo por complemento |
| Ajustar ~71 referências de teste | médio | médio |
| **Validar que conversa bem em espanhol** | **alto** | **alto** |

O que sobra no passo 3 **depende do que o passo 2 removeu**: se as
palavras fixas saírem de verdade, as ~26 frases da Camada 2 e boa parte da
Camada 4 não precisam de tradução nenhuma — deixam de existir.

Duas linhas dominam o risco:

**A guarda de execução (3a)** é a única parte onde "não fazer" não
significa "fica em português" — significa **ficar sem proteção**. Um
defeito conhecido, que já produziu um agendamento fantasma em produção,
volta a ser possível em espanhol. **Será resolvida no passo 2, antes do
espanhol existir** — testando contra o português, onde há conversas reais
para validar, e sem misturar mudança de segurança com mudança de idioma.

**A validação linguística** é a frente inteira em esforço. Todo o resto
somado é menor. O português levou meses de conversas reais para chegar ao
prompt atual; nada garante que o espanhol erre nos mesmos lugares — e os
erros dele ainda não foram observados por ninguém.

## Fora de escopo nesta v1

- Qualquer idioma além de português e espanhol.
- Alterar a Iris de produção antes da promoção.
- Traduzir o `date-fns` do painel (pendência separada).
- Mudar o schema do banco (nenhuma coluna nova é necessária).

## Decisões já tomadas pelo Gabriel (2026-08-28)

- **Caminho C** (cópia temporária, promovida no fim) — ver seção própria.
- **Sotaque por país**, não espanhol neutro único — ver "Variação por
  país". Viável sem campo novo, porque `clinicas.idioma` já grava
  `español-cl` / `español-pe` / `español-ar`.
- **Todos os 19 países de língua espanhola de uma vez**, não sob demanda —
  ver "Variação por país". Uma clínica que assinar deve funcionar
  imediatamente, sem esperar desenvolvimento.
- **Clínica de teste:** o Gabriel vai criar uma nova e configurá-la pelo
  painel já com o idioma espanhol (tela "Idioma e Localização"), o que
  grava `idioma` e `pais_codigo` corretos sem intervenção manual no banco.

## Perguntas em aberto

Nenhuma. Pronto para revisão do Codex.

## Aprovação

Este documento não autoriza implementação. Revisão do Codex primeiro,
depois aprovação explícita do Gabriel antes de qualquer código.
