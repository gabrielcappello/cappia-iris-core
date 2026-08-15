# Contexto conversacional unificado — spec v2 (`ResultadoIris`)

**Status (2026-08-15):** **documento aprovado por Gabriel**, com aprovação
**condicionada** — autoriza somente implementação local; não autoriza commit, push,
migration ou deploy; a implementação volta ao Codex antes de qualquer integração ou
teste em produção (seção 16). A revisão desta spec **como documento** pelo Codex foi
concluída em 2026-08-15. Nenhuma rota de produção foi ligada a este contrato.

**O que já existe em código** (local, isolado, revisado e aprovado pelo Codex em
2026-08-15 — nada importado por produção): tipos e JSON Schema
(`resultado-iris-tipos.ts`), validação estrutural a partir de `unknown`
(`resultado-iris-validador.ts`), fatos de turno (`resultado-iris-fatos-de-turno.ts`),
adaptador de alterações (`resultado-iris-adaptador-alteracoes.ts`) e a extensão
estrutural de `PerguntaPendente` (`contexto-unificado-tipos.ts`). Ver seção 13.

**Propõe suceder** `specs/contexto-conversacional-unificado-v1.md` (aprovada 2026-08-14,
contrato `SaidaContratoUnificado`, em shadow de produção real — ver o banner no topo
daquele arquivo, preservado sem edição). Enquanto nenhuma rota V2 estiver ligada, **v1
continua sendo o contrato vigente em produção**; nada aqui a substitui de fato antes do
corte (seções 14 e 16). Esta proposta não reescreve nem apaga o histórico de v1: troca
somente a **forma** da saída da interpretação. Antecede, como v1,
`docs/07-arquitetura-v2.md` (a Iris é a autoridade semântica; o Core é a autoridade
factual e operacional) e aplica o mesmo princípio à camada de interpretação.

---

## 0. Por que uma v2, e não uma correção de v1

O contrato de v1 (`acao_solicitada: { tipo, referencia: string | null }`) resolveu bem o
único ramo para o qual foi medido — `escolher_dentista`, contaminação de nome. Um único
`referencia` genérico, porém, não tem onde carregar a cardinalidade de candidatos a
dentista (`null`/`[]`/`[id]`/`[id,id2]`, já medida e em produção em
`interpretacao-tipos.ts`), nem a distinção entre confirmar uma criação, uma remarcação ou
um cancelamento, nem o destino de um horário escolhido (criar ou remarcar). Mapeado contra
o código real do orquestrador em 2026-08-15 (achados registrados nesta sessão): esse
formato genérico não sustenta os seis ramos operacionais além da escolha de dentista sem
reintroduzir leitura de `dados.intencao` persistido — exatamente o que a V2 da arquitetura
existe para eliminar.

Esta spec formaliza o contrato `ResultadoIris`, com um tipo próprio por ação, mapeado
deterministicamente contra as seis capacidades já aprovadas e medidas em
`docs/07-arquitetura-v2.md` §10 (Etapa 1).

## 1. Escopo

Escopo idêntico ao de v1 (seção "Escopo" daquele documento): substituir o contrato de
interpretação por um contexto único de entrada e uma saída que separa a ação pedida dos
dados informados. **Não** cria capacidade nova, **não** remove `dados.intencao` do
roteamento legado, **não** corta nenhuma capacidade real, **não** altera comportamento
visível ao paciente. Continua fora de escopo a ambiguidade do caso 4e
(`docs/07-arquitetura-v2.md` §11).

`ResultadoIris` está hoje **exclusivamente** em prova isolada
(`src/eval/prova-resultado-iris.ts`) — nunca em shadow de produção, diferença explícita em
relação ao estágio de v1.

## 2. Contrato — `ResultadoIris`

```ts
type ResultadoIris =
  | { tipo: 'compreendida'; acao: Acao; informacoes_fornecidas: Informacao[] }
  | { tipo: 'nao_compreendida' }
```

`acao` **nunca é nulo** quando `tipo: 'compreendida'`. Quando nenhuma capacidade é
solicitada — inclusive um turno puramente cadastral —, a ação é `conversar`; não existe
"ação ausente" dentro de `compreendida` (medido: caso cadastral, 2/2, `conversar` +
`informacoes_fornecidas` preenchido, seção 12).

```ts
type Acao =
  | { tipo: 'conversar'; objetivo: 'cumprimentar' | 'responder_duvida' | 'conversa_geral' }
  | { tipo: 'desistir' }
  | { tipo: 'consultar_disponibilidade'; procedimento_id: string | null; dentista_ids: string[] | null; alternativas: Alternativa[] }
  | { tipo: 'consultar_agendamento'; agendamento_id: string | null }
  | { tipo: 'pedir_agendamento'; procedimento_id: string | null; dentista_ids: string[] | null; alternativas: Alternativa[] }
  | { tipo: 'escolher_dentista'; dentista_ids: string[] }
  | { tipo: 'escolher_horario'; referencia: string; operacao: 'criar' | 'remarcar' }
  | { tipo: 'confirmar'; operacao: 'criar' | 'remarcar' | 'cancelar'; agendamento_id: string | null }
  | { tipo: 'aceitar_oferta'; procedimento_id: string }
  | { tipo: 'cancelar'; agendamento_id: string | null }
  | { tipo: 'remarcar'; agendamento_id: string | null; alternativas: Alternativa[] }

type Alternativa = {
  data: string | null;
  horario: string | null;
  periodo: 'manha' | 'tarde' | 'noite' | null;
}

type Informacao = {
  campo: 'nome' | 'cpf' | 'data_nascimento' | 'email';
  operacao: 'informou' | 'corrigiu';
  valor: string | null;
}
```

**Onze ações.** `escolher_agendamento` foi proposta, medida e **removida** nesta mesma
sessão (seção 3 explica o porquê) — não faz parte deste contrato.

**Invariante de `confirmar.agendamento_id`.** É `null` **somente** quando `operacao:
'criar'`; para `'remarcar'`/`'cancelar'` é **sempre não-nulo**. Duas combinações são
inválidas e o Core **recusa** as duas, sem exceção:

1. `operacao` diferente de `'criar'` **e** `agendamento_id: null` — falta o alvo que
   `remarcar`/`cancelar` exigem;
2. `operacao: 'criar'` **e** `agendamento_id` não-nulo — uma criação não referencia
   agendamento existente nenhum; recebê-lo aqui é saída malformada, nunca uma pista a
   aproveitar.

O valor é sempre conferido contra o fato de turno correspondente antes de qualquer
execução (seção 8).

**`Informacao` é exclusivamente cadastral.** `procedimento`, `data`, `periodo` e `horario`
**não** entram aqui — vivem só em `Acao` (`procedimento_id`, `dentista_ids`,
`agendamento_id`, `referencia`) e em `Alternativa` (`data`, `horario`, `periodo`). Nenhum
dado tem duas autoridades simultâneas no contrato. `informou`/`corrigiu` seguem a mesma
regra de forma já fechada em v1 §4 (string vazia sempre inválida; só `null` representa
remoção; `informou` nunca aceita `null`).

## 3. Mapa determinístico ação → capacidade

As seis capacidades são as aprovadas e medidas em `docs/07-arquitetura-v2.md` §10:
`consultar_agendamento_do_paciente`, `consultar_disponibilidade`, `criar_agendamento`,
`remarcar_agendamento`, `cancelar_agendamento`, `nenhuma_apenas_conversar`. **Nenhuma
capacidade nova é criada por esta spec.**

| Ação | Capacidade solicitada | O que o Core faz |
|---|---|---|
| `conversar` | `nenhuma_apenas_conversar` | direto |
| `desistir` | nenhuma | limpa parâmetros do turno em curso |
| `consultar_disponibilidade` | `consultar_disponibilidade` | resolve `procedimento_id`/`dentista_ids` contra catálogo antes de chamar |
| `consultar_agendamento` | `consultar_agendamento_do_paciente` | resolve `agendamento_id` quando ausente e há só um agendamento ativo; recusa com motivo factual quando ambíguo |
| `pedir_agendamento` | `consultar_disponibilidade` | evolui para `criar_agendamento` só via `confirmar` |
| `escolher_dentista` | nenhuma | `dentista_ids: []` aciona o mesmo caminho de "preferência não localizada" já existente (seção 5) |
| `escolher_horario` | nenhuma | valida que `referencia` corresponde a uma opção **realmente oferecida** (estruturalmente, nunca por comparação livre de texto) e monta a proposta pendente; **consome** — nunca monta — o fato `agendamento_em_remarcacao` quando `operacao: 'remarcar'` (seção 8, já construído pelo Core a partir da âncora em `aguardando_resposta`) |
| `aceitar_oferta` | nenhuma | valida `procedimento_id` contra a oferta realmente feita |
| **`cancelar`** — sem alvo resolvido | `consultar_agendamento_do_paciente` | localiza/valida qual agendamento |
| **`cancelar`** — com alvo resolvido | **nenhuma** | monta a proposta pendente, pede confirmação — zero efeito |
| **`remarcar`** — sem alvo resolvido | `consultar_agendamento_do_paciente` | localiza/valida qual agendamento |
| **`remarcar`** — com alvo resolvido e alternativa não verificada | `consultar_disponibilidade` | verifica se o novo horário está livre |
| **`remarcar`** — com alvo e horário já validados | **nenhuma** | monta a proposta pendente, pede confirmação — zero efeito |
| **`confirmar`** | `criar_agendamento` / `remarcar_agendamento` / `cancelar_agendamento`, conforme `operacao` | valida a proposta pendente contra o que está sendo confirmado antes de executar — pode recusar |

**`escolher_horario` não revalida disponibilidade.** A verificação de que o horário
escolhido continua livre acontece depois, dentro da execução de `criar_agendamento`/
`remarcar_agendamento` disparada por `confirmar` — decisão canônica já existente e não
alterada por esta spec (`docs/04-decisoes-canonicas.md`: "a revalidação do horário antes da
criação é técnica... e não exige repetir a pergunta ao paciente"). `escolher_horario` em si
não solicita nenhuma capacidade, nem mesmo de leitura.

**`escolher_agendamento` foi removida (2026-08-15).** A medição da rodada 1 (seção 12)
mostrou o modelo contornando essa camada sozinho: com dois agendamentos e a operação
identificável na própria mensagem, ele foi direto para
`consultar_agendamento`/`remarcar`/`cancelar` com o `agendamento_id` certo (2/2, 1/2 e 2/2
das repetições, respectivamente) — nunca emitiu a ação intermediária por mérito próprio.
Princípio da remoção (`docs/00-principios.md`): entre uma camada que o modelo já contorna e
nenhuma camada, fica nenhuma. Para uma **resposta curta a uma pergunta pendente** de
escolha de agendamento (seção 7), a Iris emite a ação terminal diretamente, resolvendo
`agendamento_id` contra as opções apresentadas — medido 6/6 na rodada 2 (seção 12).

## 4. Efeitos reais — somente por `confirmar`, e sem garantia

`criar_agendamento`, `remarcar_agendamento` e `cancelar_agendamento` só são alcançáveis por
uma linha da tabela acima: `confirmar`. Duas invariantes, sem exceção:

1. **`cancelar` e `remarcar` nunca solicitam a capacidade de efeito**, nem mesmo para serem
   recusadas por falta de confirmação. Antes de `confirmar` chegar, as duas só localizam,
   validam e — no caso de `remarcar` — verificam disponibilidade; o desfecho sem
   `confirmar` é sempre a proposta pendente, nunca uma tentativa de execução.
2. **`confirmar` não garante efeito.** É a única ação que **pode** solicitar uma capacidade
   de efeito real, mas essa solicitação continua sujeita à validação do Core e pode ser
   recusada — proposta pendente ausente, divergente do que está sendo confirmado, ou
   agendamento que mudou de estado entre a pergunta e a resposta. A declaração da Iris
   nunca autoriza o efeito por si só (mesmo princípio já fixo em
   `docs/07-arquitetura-v2.md` §5, invariante 3).

## 5. Validação factual e multiclínica dos IDs

Todo identificador que chega em `Acao` (`dentista_ids`, `procedimento_id`,
`agendamento_id`) é **proposta, nunca autorização**. O Core confere, antes de qualquer
efeito: existência, `clinica_id` correspondente e `ativo` quando aplicável — nunca confia
que o modelo mandou algo coerente. Isolamento multiclínica é estrutural, não opcional
(`docs/03-seguranca.md`).

**Estados realmente permitidos de `escolher_dentista.dentista_ids` (tipo `string[]`, nunca
nulo).** A ação só existe quando o paciente mencionou um profissional — "não mencionou"
nunca é um estado desta ação, é a ausência dela. Só dois estados são possíveis aqui:
`[]` (mencionou, e nenhum candidato real da clínica corresponde) e um array não-vazio
(`[id]` = um candidato; `[id1, id2, ...]` = ambíguo, Core pede escolha). O estado "paciente
não mencionou profissional" é representado em **outras** ações, pelos seus próprios campos
nuláveis (`consultar_disponibilidade.dentista_ids: string[] | null`,
`pedir_agendamento.dentista_ids: string[] | null`) — nunca por `escolher_dentista`, cujo
campo não é opcional. A cardinalidade `[]`/`[id]`/`[id1,id2]` é a mesma já medida e em
produção para `dentistas_candidatos` (`interpretacao-tipos.ts`); a resolução usa o mesmo
padrão já testado em `analisarCandidatos`/`resolverDentista` (`src/core/orquestrador.ts`):
filtrar por `clinica_id` e `ativo` antes de contar candidatos. Nenhum ID é aceito por
comparação de nome, em nenhuma camada.

## 6. Alternativas são efêmeras

`Alternativa[]` — em `consultar_disponibilidade`, `pedir_agendamento` e `remarcar` — é fato
do turno, nunca estado durável. **Não criar** tabela, coluna, marcador, TTL ou persistência
adicional para alternativas. Quando uma alternativa é escolhida e vira proposta real
(ex.: via `escolher_horario` seguido de `confirmar`), **então** o Core persiste a proposta
pendente correspondente — a alternativa em si nunca é gravada em `dados`.

**Regra M2, medida.** Quando o paciente aceita um horário já oferecido, é
`escolher_horario`. Quando indica um horário que **não** estava entre os oferecidos, ainda
não foi verificado: é `consultar_disponibilidade`, com a alternativa carregando a **data
vigente explícita** — `data: null` é inválido nesse caso (o Core não infere data implícita
de uma correção; a IA precisa declará-la). Medido 2/2 com este critério corrigido (seção
12).

## 7. `aguardando_resposta` — extensão do campo genérico existente

Sem alteração de mecanismo em relação a v1 §3.1: **um** campo, vocabulário fechado,
representando a pergunta que foi de fato feita ao paciente — nunca derivado da decisão do
Core, nunca um marcador novo por pergunta. Três ajustes, todos **registrados nesta spec,
não implementados**:

1. **Novo valor de `tipo`: `'cadastro'`.** O vocabulário aprovado em
   `contexto-unificado-tipos.ts` (`escolha_dentista | escolha_horario | confirmacao |
   oferta_procedimento | troca_telefone | escolha_agendamento | confirmacao_nome`) não tem
   nenhum valor para "Core está pedindo dado cadastral pendente". Sem ele, esse turno só é
   representável por texto no histórico — foi assim que o caso cadastral foi medido nesta
   sessão (seção 12), e funcionou, mas deixa a pergunta sem registro estrutural, ao
   contrário de todas as outras.
2. **`tipo: 'escolha_agendamento'` ganha o campo `operacao: 'consultar' | 'remarcar' |
   'cancelar'`.** É o que permite a Iris, numa resposta curta ("o primeiro"), emitir a ação
   terminal certa diretamente — sem `escolher_agendamento` como ação intermediária (seção
   3). Extensão de contexto, não vocabulário novo de ação ou capacidade.
3. **`tipo: 'escolha_horario'` ganha o campo `agendamento_id` quando a oferta pertence a
   uma remarcação em curso.** É essa âncora — não uma busca genérica — que permite ao Core
   montar `agendamento_em_remarcacao` (seção 8) **antes** de `escolher_horario` chegar.
   `escolher_horario` **consome** o fato já construído para montar a proposta; nunca o
   constrói por conta própria, nunca infere qual agendamento está em jogo a partir do
   próprio conteúdo da ação.

Nenhum dos três ajustes tem implementação, migration ou persistência associada nesta spec.

## 8. Fatos de turno — nunca estado persistido

Onde o Core precisa saber "que fluxo está em curso" para uma tradução determinística
(`escolher_horario.operacao`, `confirmar.operacao` quando o contexto não é criação), o
contexto carrega um **fato do turno**, recalculado a cada chamada — nunca `dados.intencao`
persistido:

- `agendamento_em_remarcacao` — presente quando há uma remarcação em andamento;
- `agendamento_a_cancelar` — presente quando há um cancelamento em andamento.

**Produção em duas etapas, sempre nesta ordem — uma busca fresca sozinha não descobre QUAL
agendamento está em jogo, só confirma se um ID já conhecido continua válido:**

1. **Identidade ancorada.** O `agendamento_id` vem de uma **âncora estruturada** do turno
   — nunca inferido, adivinhado ou copiado de texto livre. As âncoras válidas: o
   `agendamento_id` de `aguardando_resposta` (seção 7, quando `tipo` é `escolha_horario` com
   remarcação em curso ou `escolha_agendamento` com `operacao` já fixada), ou o
   `agendamento_id` já presente numa proposta de remarcação/cancelamento em curso no
   próprio turno.
2. **Busca fresca desse ID**, filtrada por `clinica_id` + `paciente_id` + status (`ativo`),
   mesmo padrão já em produção em `buscarAgendamentoAtivo` — confirma que o agendamento
   ancorado continua existindo, pertence a este paciente e a esta clínica, e está num
   estado compatível. Isso é o que já garante, no código real, que
   `confirmacaoAutorizaCancelamento`/`propostaCorrespondeAoAgendamento`
   (`src/core/orquestrador.ts`) nunca autorizam sobre dado obsoleto — o mesmo princípio se
   aplica aqui, sem mecanismo novo.

**Recusa quando não há âncora estruturada, ou quando a busca diverge dela.** Sem âncora, ou
com a busca não encontrando o ID ancorado, encontrando-o de outro paciente, de outra
clínica, ou em estado incompatível, o Core **recusa** — nunca executa, nunca completa por
conta própria. **Nunca escolhe o único agendamento do paciente por eliminação, e nunca
busca genericamente "um fluxo em andamento"** — a ausência de âncora não é substituída por
suposição, mesmo quando só existe um agendamento possível. Recusar aqui é o mesmo "fato,
nunca decisão de conversa" de `docs/07-arquitetura-v2.md` §4: a Iris decide o que dizer
sobre a recusa, o Core nunca adivinha para evitar a recusa.

Ambos têm o mesmo status de `aguardando_resposta`: fatos efêmeros, existem enquanto o fluxo
está em curso, nunca uma segunda fonte de verdade sobre o que o paciente quer agora.

## 9. Proibições explícitas na nova rota

Herdadas de `docs/07-arquitetura-v2.md` e reafirmadas para `ResultadoIris`, sem exceção
medida ou proposta nesta sessão:

- `dados.intencao` **nunca** é lido para completar, desambiguar ou confirmar nenhuma ação
  deste contrato;
- `data_texto`, `horario_texto`, `periodo` persistidos **nunca** são autoridade temporal
  quando a rota nova está ativa — toda informação temporal chega via `Alternativa` ou
  `escolher_horario.referencia`, sempre do turno atual;
- `natureza_mensagem` é, no máximo, metadado de tom para a redatora — nunca decide qual
  ação vale (mesma regra de v1, preservada).

## 10. Guarda estrutural de nome

Preservada de v1 §5.1, **sem alteração de substância**: quando a saída trouxer, no mesmo
turno, `acao.tipo === 'escolher_dentista'` **e** um `nome` em `informacoes_fornecidas`, o
Core não persiste esse nome — pergunta, via `aguardando_resposta: { tipo:
'confirmacao_nome', detalhe: { nome_proposto } }`. Detecção estrutural (co-ocorrência dos
dois campos), nunca comparação textual entre o nome e o profissional escolhido. Motivo e
custo aceito: idênticos aos já registrados em v1 §5.1.

## 11. Feature flag, ativação restrita e rollback

Mesmo padrão já validado em produção pela Etapa 2 da Arquitetura V2
(`docs/07-arquitetura-v2.md` §10, despachante-sombra): a rota `ResultadoIris` nasce **atrás
de uma flag**, desligada por padrão. Com a flag desligada, zero efeito no atendimento —
nenhuma chamada extra, nenhuma decisão, nenhuma mudança de resposta.

Quando ativada, a primeira fase é **shadow real de produção** (como v1 já alcançou, e esta
v2 ainda não): decide em paralelo, nunca executa capacidade, nunca altera `estado_conversa`,
nunca muda a resposta ao paciente — só compara e loga, sem PII (mesmo mecanismo de
`sombra-contexto-unificado.ts`, a estender para este contrato).

**Rollback é desligar a flag.** Nenhuma migration, nenhuma coluna, nenhum dado é criado por
esta rota antes da Etapa 3 (corte real, fora de escopo desta spec) — reverter nunca é
migração de volta, é parar de consultar a rota nova (mesma regra de reversibilidade já
aprovada em `docs/07-arquitetura-v2.md` §10).

## 12. Evidência das medições

**Duas rodadas, instrumento isolado** (`src/eval/prova-resultado-iris.ts`, nunca importado
por produção nem por `src/core/`), modelo `gpt-5.6-luna`, `reasoning.effort: "none"`.

**Rodada 1 — 18 casos × 2 repetições (36 chamadas), contrato com `escolher_agendamento`
ainda presente:**

| categoria | resultado |
|---|---|
| regressão (contaminação de nome, cadastro múltiplo, oferta, M2) | 12/12 |
| ambiguidade conhecida (caso 4e) | 2/2 — registrado, sem exigência |
| consulta do próprio agendamento | 2/4 |
| escolha de horário (criação/remarcação) | 4/4 |
| escolha de agendamento (consultar/remarcar/cancelar) | 3/6 |
| cancelamento inicial sem efeito | 2/2 |
| confirmação → operação correta | 6/6 |

Falhas concentradas e específicas, não espalhadas: caso de consulta com múltiplos
agendamentos falhou 2/2 (o modelo emitiu `escolher_agendamento` em vez de
`consultar_agendamento` direto); caso de escolha para remarcar falhou 1/2 (oscilou entre
`escolher_agendamento` e `remarcar` direto); caso de escolha para cancelar falhou 2/2 (o
modelo foi direto para `cancelar`). Essas três falhas, lidas juntas, foram a evidência que
motivou a remoção de `escolher_agendamento` (seção 3).

**Rodada 2 — 8 casos × 2 repetições (16 chamadas), após a remoção e a correção de dois
critérios de medição:** **16/16** — M2 (2/2, com o critério agora exigindo data explícita),
cadastro múltiplo (2/2, com `confirmar` agora proibido no critério), três ações diretas com
agendamento identificado na mensagem (6/6) e três respostas curtas a pergunta pendente, uma
por operação (6/6).

**O que esta evidência prova, e o que não prova:**

- prova que o contrato corrigido (sem `escolher_agendamento`) produziu a ação certa nos
  oito cenários medidos, com este modelo e esta configuração de `reasoning.effort` — **não**
  prova que a tradução é determinística em relação ao modelo (essa propriedade vale para o
  mapa ação→capacidade, seção 3, que é uma tabela fixa; não vale, sem medição maior, para a
  escolha da ação em si);
- **N=2 por caso não é estabilidade estatística** — é triagem, no mesmo sentido já
  registrado em `docs/07-arquitetura-v2.md` §11.1 e na proposta original desta frente
  ("a medição é pequena e serve como triagem, não prova estatística definitiva"). Um
  resultado redondo (16/16) numa amostra desse tamanho não substitui uma rodada maior antes
  de qualquer corte real — a própria rodada 1 mostrou variação intra-caso (1/2) que só
  apareceu porque havia mais de uma repetição;
- nenhuma medição cobriu conversa multi-turno real (a "volta 2" depende de persistência que
  não existe — seção 13), nem variação de modelo, nem histórico longo, nem entradas
  adversariais — mesmos limites já declarados em v1 §6.5 e em `docs/07-arquitetura-v2.md`
  §11.1.

## 13. Pendências reais de implementação e teste integrado

Registradas na aprovação do documento. **Atualização 2026-08-15:** os itens 1 e 2
foram implementados localmente (módulos isolados, sem ligação com produção, revisados
e aprovados pelo Codex); o item 3 teve sua parte estrutural feita e o desenho da
persistência real fechado na **seção 14**; os itens 4 e 5 seguem abertos.

1. ~~**Adaptador `informacoes_fornecidas → AlteracoesDados`**~~ — **IMPLEMENTADO**
   (`src/core/resultado-iris-adaptador-alteracoes.ts`, isolado, aprovado pelo Codex em
   2026-08-15). Função pura: `informou` → `informar`; `corrigiu` com valor →
   `corrigir`; `corrigiu` com `null` → `remover` (sem `valor`). Campo duplicado recusa
   a lista inteira. **Registrado para a integração:** a guarda estrutural de
   contaminação de nome (v1 §5.1) precisa rodar **antes** deste adaptador.
2. ~~**Montagem real dos fatos de turno**~~ — **IMPLEMENTADO**
   (`src/core/resultado-iris-fatos-de-turno.ts`, isolado, aprovado pelo Codex em
   2026-08-15). Âncora entra como parâmetro já resolvido; busca fresca via
   `buscarAgendamentoAtivo`; recusa em qualquer divergência; nunca escolhe por
   eliminação; as duas âncoras não nulas ao mesmo tempo são recusadas **antes** de
   qualquer consulta.
3. **Persistência de `aguardando_resposta`** — **parcial.** A extensão *estrutural* do
   tipo foi feita (`tipo: 'cadastro'`, `operacao`, `agendamento_id` em
   `contexto-unificado-tipos.ts`, aditiva, nenhum consumidor alterado, aprovada pelo
   Codex em 2026-08-15). A **persistência real continua não existindo** — o campo
   chega sempre `null` ao shadow (`sombra-contexto-unificado.ts`). O desenho completo
   está na **seção 14**, aprovado e ainda não implementado.
4. **Teste integrado real, turno a turno**, ainda não existe: turno 1 → guarda/decisão →
   `aguardando_resposta` persistido → turno 2 → ação terminal correta. É pré-requisito
   explícito antes de qualquer adoção, não apenas recomendação. Depende da seção 14;
   **não é simulável** com persistência fabricada (decisão de 2026-08-15).
5. Nenhum shadow de produção rodou para `ResultadoIris` — diferente de v1, que já validou o
   mecanismo de shadow em produção real (`docs/07-arquitetura-v2.md` §10). Isso precisa
   acontecer antes da Etapa 3 de qualquer corte. **Nota de nomenclatura:** a etapa da
   seção 14 **não é shadow** — ela escreve estado autoritativo e pode impedir o envio de
   uma resposta; não deve herdar as garantias verbais das duas sombras atuais.

## 14. Commit autoritativo do turno V2 — desenho aprovado, não implementado

**Status:** **aprovado por Gabriel e revisado pelo Codex** (2026-08-15, após rodadas
sucessivas de correção sobre o desenho). **Nada aqui está implementado**; nenhuma
migration, RPC, coluna ou alteração de fluxo existe. Esta seção registra o desenho
para a etapa seguinte.

### 14.1 Por que o commit precisa ser único e condicionado à versão inicial

Dois bloqueios, **verificados no código real** (2026-08-15), invalidam a alternativa
mais simples ("gravar a pergunta num UPDATE próprio no fim do turno"):

1. **`aplicarDados` rebaseia.** Ao perder o CAS, ele relê o estado e reaplica as
   alterações sobre o valor mais recente, até `MAX_TENTATIVAS`
   (`src/core/aplicar-dados.ts`). Dois turnos A e B iniciados sobre o mesmo snapshot
   **ambos completam**: A grava, B perde, relê o estado de A e grava por cima. Um CAS
   no fim do turno não distingue "sou o único turno" de "sou o segundo turno que
   rebaseou" — a garantia precisa estar na **versão de entrada**, não na de saída.
2. **Claim/lease não participa do fluxo operacional.** `reivindicarMensagem`,
   `concluirMensagemCondicional` e `falharMensagemCondicional` existem e são testados
   em `src/core/`, mas **nenhum é chamado** por
   `supabase/functions/iris-nova-mensagem/index.ts`. Nada garante hoje que uma
   mensagem não respondida volte para reprocessamento.

**`versao_inicial`** é o `atualizado_em` lido no SELECT da identificação, antes de
qualquer decisão. Viaja fechado pelo turno inteiro e é o único valor comparado pelo
CAS. Na rota V2 **não há escritas intermediárias**, e `aplicarDados` **não é usado** —
o cálculo de `dados` acontece em memória (`calcularNovosDados` é puro) e a gravação é
a do commit único. Reusar `aplicarDados` reintroduziria o rebase.

### 14.2 Turno SEM efeito — UPDATE único estrito

Aplica-se a tudo que não é `confirmar` com operação real: `conversar`, `desistir`,
consultas, `escolher_*`, `aceitar_oferta`, e também `cancelar`/`remarcar` **antes** da
confirmação (que pela seção 4 não acionam capacidade de efeito).

Uma instrução, condicionada a `versao_inicial` e aos três identificadores já usados
(`id`, `clinica_id`, `telefone_normalizado`), gravando atomicamente `dados`,
`aguardando_resposta`, `contexto_horarios`, campos limpos e `atualizado_em`. Sem
releitura, sem rebase, sem retry. **Zero linhas afetadas = turno obsoleto**
(seção 14.4).

Ordem: a redatora redige **e declara a pergunta** (seção 14.5); o UPDATE vem depois,
antes do envio.

### 14.3 Turno COM efeito (`confirmar`) — RPC transacional autoritativa

Os três efeitos são RPCs chamadas **dentro** do orquestrador
(`remarcarAgendamento`, `cancelarAgendamento`, `reservarAgendamento` em
`src/core/orquestrador.ts`), **antes** de qualquer gravação de `estado_conversa`. Em
A×B, os dois turnos **chegam a chamar a RPC**, e só depois um perde o CAS
conversacional. Se o segundo efeito se concretiza depende das validações próprias de
cada RPC (proposta pendente, disponibilidade, estado do agendamento), não do CAS: a
dupla execução — dois agendamentos criados, ou cancelar seguido de remarcar — é
**possível, não garantida**. Um commit no fim **não desfaz** o efeito que porventura
já foi executado, e depender de validações que não foram desenhadas para esse fim é
deixar a integridade ao acaso — por isso a versão precisa ser validada **dentro da
mesma transação que executa o efeito**.

Uma RPC nova por operação (ou uma com discriminador — decisão de implementação) faz,
numa única transação, **nesta ordem lógica**:

1. **valida `versao_inicial`** contra `estado_conversa.atualizado_em`, com lock da
   linha (`SELECT ... FOR UPDATE`) — divergiu, aborta antes de tudo;
2. **valida a AUTORIZAÇÃO persistida em `aguardando_resposta`** — `tipo:
   'confirmacao'`, `operacao` igual à operação sendo executada, e `agendamento_id`
   igual ao alvo;
3. **executa** criar/remarcar/cancelar, incluindo a revalidação de disponibilidade que
   as RPCs atuais já fazem;
4. **grava** o estado final completo.

**Versão divergente ⇒ nenhum efeito.** A validação precede a execução na mesma
transação: não existe janela entre "verifiquei" e "executei".

**A autorização é `aguardando_resposta`, nunca
`contexto_horarios.proposta_pendente`.** `proposta_pendente` carrega apenas `{data,
horario}` — prova **quando**, jamais **o quê**. Confirmar a *criação* de um horário no
dia 20 às 10:00 e confirmar o *cancelamento* de um agendamento no dia 20 às 10:00
produzem o mesmo par: usá-lo como autorização permitiria que um "sim" destinado a uma
operação autorizasse outra, confundindo criar, remarcar e cancelar.

A autoridade é `estado_conversa.aguardando_resposta` **da linha travada no passo 1**,
que carrega `tipo`, `operacao` e `agendamento_id` (`PerguntaPendente`,
`src/core/contexto-unificado-tipos.ts`). A RPC exige os três: `tipo: 'confirmacao'`,
`operacao` igual à sua própria operação, e `agendamento_id` igual ao alvo. Só então
faz a busca fresca e executa. Nunca vem por parâmetro — aceitar a autorização do
chamador tornaria a validação circular, com ele afirmando justamente o que precisa
provar.

**Invariante correspondente no tipo** (`validarPerguntaPendente`,
`resultado-iris-validador.ts`): quando `tipo: 'confirmacao'`, `operacao` é obrigatória;
e quando a operação incide sobre agendamento existente (`remarcar`/`cancelar`),
`agendamento_id` é obrigatório.

`contexto_horarios` continua sendo **gravado** pelo commit (o Core decide seu próximo
valor), mas nunca **lido** como autorização de efeito.

**Replay (`ja_cancelado`/`ja_remarcado`) fica DEPOIS da versão e da autorização.** Um
turno sem autoridade — ou confirmando outra operação — nunca pode receber "sucesso" por
um efeito que outro turno executou; seria a Iris afirmando ao paciente que concluiu
algo que ele não confirmou naquele turno.

**`atualizado_em` é calculado dentro da RPC**, como
`greatest(now(), versao_vigente + 1µs)` — nunca recebido do chamador. É a versão que
todo o CAS do sistema usa; um valor menor ou igual ao vigente quebraria a detecção de
obsolescência do turno seguinte. A garantia é a mesma de `proximoTimestamp`
(`aplicar-dados.ts`), agora imposta no único lugar que a assegura sob concorrência:
dentro da transação, com a linha travada.

**O ramo que conclui grava `aguardando_resposta = NULL` literal**, não um parâmetro:
nenhuma entrada pode fazer uma confirmação bem-sucedida terminar com pergunta
pendente.

As RPCs de efeito atuais **não são reutilizadas** pela rota V2 — elas executam sem
conhecer `versao_inicial` nem gravar estado conversacional. Continuam servindo a rota
V1 sem alteração; as duas rotas nunca rodam no mesmo turno.

### 14.4 Os três desfechos

| Desfecho | Efeito | Escrita | `aguardando_resposta` | Resposta |
|---|---|---|---|---|
| **Sucesso operacional** | executado | atômica, na própria RPC | `null` | redigida depois, com o fato consumado |
| **Recusa sem efeito** | nenhum | nenhuma na RPC | próxima pergunta, via caminho sem efeito | redigida com o motivo factual |
| **Turno obsoleto** | nenhum | nenhuma | inalterado | **nenhuma** |

**Sucesso operacional.** A RPC grava atomicamente efeito + estado final +
`aguardando_resposta = null`. A **regra** é predefinida — uma confirmação bem-sucedida
encerra o fluxo e não deixa pergunta em aberto —, mas quem a aplica é o ramo da
transação que **efetivamente concluiu o efeito**: dentro da transação, só esse ramo
grava `null`. Os demais ramos (recusa, versão divergente) não gravam nada. Nada é
decidido fora da transação nem enxertado nela depois de encerrada. A redação acontece
depois e **não grava nada**.

**Recusa sem efeito.** A RPC não altera nada e devolve o motivo (proposta divergente,
horário ocupado, autorização inválida). O turno segue pelo **caminho comum sem
efeito** (14.2): a redatora redige com o motivo em mãos e declara a próxima pergunta;
o UPDATE estrito grava. Um só mecanismo, sem caminho especial.

**Turno obsoleto.** Nenhum efeito, nenhuma escrita, nenhuma resposta.

### 14.5 Quem declara `aguardando_resposta` — duas origens, nunca ambíguas

| Caminho | Quem declara | Quando entra no commit |
|---|---|---|
| Sem efeito (inclui as recusas) | **Redatora**, junto do texto | UPDATE único estrito, depois da redação |
| Com efeito, sucesso | **RPC**, valor `null` fixo | dentro da própria transação |

Invariante: **quem declara é sempre quem sabe o fato.** A redatora sabe o que
perguntou quando a pergunta é o desfecho; o `null` do sucesso é propriedade do
desfecho, não observação posterior. Nenhum dos dois declara sobre o que não observou.

Para o caminho sem efeito, a redatora passa a devolver **texto + pergunta
estruturada** (Structured Outputs, raiz plana). Isso **contradiz
`resposta-conversacional-v1.md` §3** ("um único texto, sem JSON, sem campos") e exige
emenda declarada naquela spec — restrita aos turnos sem efeito; nos turnos com efeito
o contrato original permanece intacto.

**Divergência entre texto e declaração continua possível** e não é eliminada por este
desenho: a redatora pode declarar `escolha_horario` e escrever frase que pergunta
outra coisa, ou declarar `null` e terminar com uma pergunta. Não é verificável por
comparação textual (seria match de palavra, proibido em `docs/00-principios.md`).
Tratamento:

- **guarda estrutural, verificável por programa:** quando a declaração não é `null`,
  os IDs e opções citados precisam existir entre os fatos autorizados do turno; um
  `agendamento_id` citado precisa ser um dos agendamentos reais do paciente.
  Declaração que aponta para algo inexistente reprova;
- **medição, não asserção:** a concordância entre texto e declaração se avalia lendo
  conversas reais, mesmo regime de `resposta-conversacional-v1.md` §10;
- **custo declarado:** em divergência, vale a pergunta declarada, não a do texto. No
  turno seguinte a âncora errada leva à recusa de montar o fato de turno (seção 8) —
  desfecho seguro, porém degradado.

### 14.6 Coluna própria e leitura

**`estado_conversa.aguardando_resposta jsonb`**, nullable, default `null`. **Não
reutiliza `contexto_horarios`** — coluna, semântica e ciclo de vida separados.
`derivarAcaoContextoHorarios` faz `switch (decisao.tipo)`, isto é, deriva a pergunta
da decisão: exatamente o acoplamento que a V2 existe para remover.

A coluna entra em `COLUNAS_ESTADO_CONVERSA` (`src/core/identificacao.ts`) — nenhuma
consulta nova, vem na linha já lida.

**Malformado nunca vira `null`.** `null` significa "não há pergunta em aberto", uma
afirmação factual; dado corrompido não pode virar essa afirmação. Regime distinto do
de `contexto_horarios` (que degrada para `null`), porque este campo é a âncora que
autoriza montar `agendamento_em_remarcacao`/`agendamento_a_cancelar`:

- **piloto:** desvia para a rota V1 naquele turno, com log de rótulo próprio, sem PII;
- **após o corte:** falha fechado — nenhuma resposta, mesmo desfecho de turno obsoleto;
- ausente/`null` legítimo é caso normal, não recusa.

### 14.7 HTTP do turno obsoleto

**`409 Conflict`** com `{ erro: "turno_obsoleto" }`. Não é erro do cliente (400), não
é falha do servidor (500, que dispara alerta/retry), não é sucesso (200 devolveria
corpo sem `resposta`, quebrando o contrato atual).

**Verificado no n8n por Gabriel (2026-08-15), workflow ativo:** 409 não tem retry, não
continua o fluxo, não chega ao envio pela Evolution — apenas registra execução com
falha. Fixado como desfecho **provisório do piloto**.

### 14.8 Concorrência — pré-requisito explícito do corte definitivo

O commit condicionado a `versao_inicial` decide por **ordem de chegada ao banco, não
por ordem de envio do paciente**. Se o paciente manda "quero cancelar" e em seguida
"deixa pra lá", nada garante que a segunda vença: o turno perdedor pode ser o que
carregava a intenção mais recente.

**Claim/lease não resolve isto.** Ele é por *mensagem* — impede dois workers de
processarem a mesma mensagem duas vezes. Não impede duas mensagens **diferentes** da
mesma conversa de serem processadas em paralelo, que é exatamente o caso A×B.
Integrá-lo ao `index.ts` continua necessário por outros motivos, mas **não conta como
solução de concorrência de conversa**.

**Pré-requisito do corte definitivo — uma das duas:**

- **serialização por conversa** — processamento ordenado por `conversa_id`, uma
  mensagem por vez;
- **reprocessamento ordenado** — o turno obsoleto volta à fila e é reprocessado sobre
  o estado já atualizado, preservando a ordem de chegada.

**Silêncio no turno obsoleto é política provisória de piloto, não solução.** Medir a
frequência informa a urgência e ajuda a escolher entre os dois mecanismos, mas **não
converte silêncio em desfecho aceitável** — um paciente sem resposta é falha de
atendimento em qualquer frequência. O piloto roda com a dívida declarada e um dos dois
mecanismos como pré-requisito do corte, não como decisão adiada.

### 14.9 Testes exigidos

**A→B (sequencial)** — o teste que a seção 13 exige e hoje é impossível:

- turno A: exatamente **um** UPDATE em `estado_conversa` no turno inteiro (contável),
  coluna com o valor declarado, `atualizado_em` avançado uma única vez;
- turno B: lê a coluna no mesmo SELECT da identificação (sem consulta nova), a âncora
  alimenta `resolverFatoDeTurno`, o fato monta e a ação terminal sai correta;
- **caso negativo obrigatório no mesmo par:** com a coluna `null`, o fato **não**
  monta e o turno recusa — nunca escolhe por eliminação.

**A×B por efeito** — os dois lados partindo da **mesma** `versao_inicial`, provando
**uma única execução operacional**:

- **criar:** exatamente **uma** linha nova em `agendamentos` (não duas, não zero); B
  devolve turno obsoleto; a RPC de reserva foi chamada uma vez só (contável);
- **remarcar:** exatamente **uma** mudança de horário;
- **cancelar:** exatamente **um** cancelamento; o segundo não reexecuta nem reporta
  sucesso;
- **cruzado (pior caso):** A confirma cancelamento e B confirma remarcação do mesmo
  agendamento — **um só** dos dois efeitos ocorre; o agendamento nunca fica cancelado
  *e* remarcado.

Em todos: nenhuma releitura, nenhum retry (contagem de chamadas), e o estado nunca
fica com efeito de um turno e `aguardando_resposta` de outro.

**Regressão da rota V1:** o mesmo cenário pela rota atual deve mostrar que **os dois
turnos podem avançar o estado** por rebase de `aplicarDados` — para a diferença entre
as rotas ficar medida, não afirmada. O que esse teste comprova é o **avanço de estado
por rebase**, não que os dois efeitos operacionais necessariamente ocorram: as RPCs de
efeito têm suas próprias validações (proposta pendente, disponibilidade, estado do
agendamento) que podem barrar o segundo turno por outro motivo, independente do CAS
conversacional. A dupla execução é **possível**, não garantida — e é justamente por
não ser determinística que ela não pode ser deixada ao acaso.

**Malformado:** jsonb inválido na coluna ⇒ rota V2 recusada (piloto: desvia para V1
com log), nenhuma conversão para `null`; coluna `null` ⇒ rota V2 segue normalmente.

### 14.10 Pendências desta etapa, ainda em aberto

1. Emenda a `resposta-conversacional-v1.md` §3 — redatora estruturada, restrita aos
   turnos sem efeito.
2. Fallback determinístico declarando a própria pergunta — mesmos turnos (no caminho
   com efeito o estado `aguardando_resposta = null` já está gravado, e o fallback só
   escreve texto).
3. Escopo das RPCs novas: uma por operação ou uma com discriminador.
4. Escolha entre serialização por conversa e reprocessamento ordenado (14.8).

## 15. Comportamento conversacional — fora de escopo, por referência

Esta spec formaliza **compreensão** (`ResultadoIris`): o que a Iris entende que o
paciente pediu. Ela não trata de **redação** — como a Iris fala — e não substitui o
contrato humano da redatora. Permanecem válidos:

- `specs/resposta-conversacional-v1.md` — contrato `FatosAutorizados` e o papel da IA
  redatora;
- `src/core/redator-instrucoes.ts` — as instruções reais que hoje regem o tom.

**A v2 não redefine tom nem personalidade.** A única alteração que ela propõe sobre a
redatora é de **envelope**, e só nos **turnos sem efeito**: a saída deixa de ser texto
puro e passa a ser texto + `pergunta_produzida` estruturada (seção 14.5, que exige
emenda declarada a `resposta-conversacional-v1.md` §3). Nos turnos com efeito o
contrato original permanece intacto. O que a redatora **diz**, como ela conversa e o
que ela pode ou não afirmar continuam regidos integralmente por
`resposta-conversacional-v1.md` e por `redator-instrucoes.ts`, sem alteração de
substância — trocar o formato de retorno não é trocar a voz.

A redatora conversa de forma natural, humana e recíproca: adapta-se ao tom do
paciente, responde comentários laterais e retoma o objetivo da conversa sem soar como
formulário. Liberdade de redação **nunca** autoriza inventar fato operacional — a
guarda de `resposta-conversacional-v1.md` §4 e a fronteira da Arquitetura V2 permanece
válida: `ResultadoIris` declara a decisão semântica; o Core fornece e valida os fatos
operacionais; a redatora usa somente os fatos autorizados — seguem valendo os dois,
sem exceção.

O aceite desse comportamento é do Gabriel, em conversas naturais no WhatsApp —
humanidade e adequação de tom não se demonstram por frases fixas em teste automático
(mesmo limite já registrado em `resposta-conversacional-v1.md` §10).

Esta seção não cria prompt novo, personalidade rígida ou camada adicional — é
referência documental.

## 16. Aprovação

- [x] Codex — aprovação **arquitetural** do contrato (`Acao`, mapa determinístico, as duas
      correções de segurança da seção 4), 2026-08-15, ao longo da sessão de mapeamento.
- [x] Codex — revisão desta spec **como documento**, 2026-08-15. Inclui a seção 14
      (commit autoritativo do turno V2), revisada em rodadas sucessivas até o desenho
      final.
- [x] Gabriel — aprovação final do documento, 2026-08-15. Aprovação **condicionada**:
      autoriza somente implementação local; **não** autoriza commit, push, migration ou
      deploy; a implementação resultante volta para revisão do Codex antes de qualquer
      integração ou teste em produção.

Com as três linhas acima marcadas, o **documento** está aprovado e revisado. Isso não
altera o que continua **não autorizado** por ele: commit, push, migration e deploy. A
implementação permanece restrita ao escopo **local e isolado**, e cada peça retorna ao
Codex antes de qualquer integração ou teste em produção — regime que vigorou em todas
as etapas já concluídas (seção 13) e que continua valendo para a seção 14, ainda não
implementada.
