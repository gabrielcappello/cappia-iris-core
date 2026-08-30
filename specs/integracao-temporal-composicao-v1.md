# Integração Temporal — Composição v1

**Status:** especificação canônica de integração — define **como** o resolvedor
temporal v1 já publicado (`resolvedor-temporal-v1.md`, implementado em
`src/core/resolver-temporal.ts`) se conecta à composição determinística do novo
agendamento (`composicao-novo-agendamento-v1.md`) e à interpretação pela IA
(`interpretacao-ia.md`). Não autoriza implementação, criação de tipo TypeScript,
alteração de banco, criação de tabelas, migration, schema físico ou teste executável.

Esta especificação complementa e **não substitui** `composicao-novo-agendamento-v1.md`,
`controlador-conversacional-v1.md`, `eventos-conversacionais-v1.md`,
`interpretacao-ia.md`, `resolvedor-temporal-v1.md`, `persistencia-v1.md` e
`atendimento-v1.md`. Onde este documento e um daqueles divergir, o documento mais
específico do assunto prevalece — este arquivo é a camada de **ponte**, nunca a fonte
da regra de domínio de nenhum dos dois lados que conecta. Permanecem fixas as decisões
de `../docs/02-arquitetura.md` e `../docs/04-decisoes-canonicas.md`.

**Nenhum algoritmo do resolvedor temporal, da composição ou de qualquer um dos cinco
componentes de domínio já publicados é redefinido, resumido ou reimplementado aqui.**
Esta spec só descreve o contrato de dados que os conecta, a ordem em que se chamam, e a
forma pura da composição — nunca o cálculo interno de nenhum deles.

Todos os identificadores de decisão citados como `P1`–`P5` e `C1`–`C5` correspondem
exatamente às decisões arquiteturais aprovadas após as rodadas de revisão read-only que
precederam esta especificação — consultar pelo conteúdo, nunca por número de rodada.
`P1`–`P5` fixam o contrato temporal e a fronteira pura; `C1`–`C5` fixam o contrato de
**continuidade** entre chamadas dessa fronteira (seção 5).

## 1. Objetivo

Definir, de forma fechada:

- como a interpretação pela IA produzirá, numa versão futura de contrato, alterações
  temporais categorizadas (`P1`) em vez de texto livre solto por mensagem;
- como o estado oficial da conversa acumula átomos temporais entre mensagens, e como
  esse acúmulo nunca é reconstruído a partir do critério temporal oficial já resolvido;
- o corte único entre o contrato legado (`data_texto`/`horario_texto`) e o contrato
  estruturado desta integração (`P2`) — nunca um modo híbrido;
- a composição como máquina de estados pura, avançada por uma função determinística que
  nunca executa I/O (`P3`);
- a continuidade **explícita** entre chamadas dessa função — uma continuação imutável e
  serializável, que carrega tudo o que a chamada seguinte precisa, sem depender de
  memória global, processo vivo ou ordem presumida (`C1`–`C5`, seção 11);
- exatamente onde, na ordem canônica já publicada, o resolvedor temporal é chamado, com
  qual entrada, e como cada uma das suas sete variantes de resultado é tratada;
- a matriz de invalidação de derivados quando um fato temporal muda;
- o contrato lógico mínimo da porta de redação autorizada, sem escolher tecnologia;
- os cenários obrigatórios que fecham o aceite desta integração, quando implementada.

## 2. Escopo

Esta especificação cobre:

- o contrato conceitual (não implementado) de `alteracoes_temporais` na saída da
  interpretação, e sua aplicação sobre o estado oficial acumulado;
- a chamada do resolvedor temporal já publicado dentro da ordem canônica da composição,
  com origem exata de cada campo de entrada e tratamento fechado de cada variante de
  saída;
- o contrato conceitual (não implementado) da função pura de avanço da composição, do
  catálogo fechado de requisições de dados condicionais que ela pode emitir, e do
  protocolo de chamadas repetidas pelo orquestrador externo;
- a matriz de invalidação consolidada que resulta de um fato temporal mudar, em
  harmonia com — e sem contradizer — a matriz já publicada em
  `composicao-novo-agendamento-v1.md` §14;
- o contrato lógico mínimo (não implementado) da porta de redação autorizada;
- o índice de cenários obrigatórios específicos desta integração (prefixo `ITC-`).

## 3. Não escopo

Esta especificação **não** cobre, e nenhuma seção abaixo deve ser lida como cobrindo:

- o algoritmo interno do resolvedor temporal — pertence integralmente a
  `resolvedor-temporal-v1.md`, já publicado e implementado; esta spec só consome o
  contrato já fechado dele;
- o algoritmo interno de qualquer um dos outros quatro componentes de domínio
  (procedimento, dentistas, duração, disponibilidade) — permanecem exatamente como
  publicados;
- a ordem, os comandos, a matriz de invalidação de fatos não temporais, ou qualquer
  outra regra já fixada em `composicao-novo-agendamento-v1.md` que não dependa
  diretamente da integração temporal — este documento harmoniza, nunca reabre, essas
  regras;
- persistência física de qualquer entidade — tabelas, colunas, RPCs, migrations,
  transações concretas ou CAS físico permanecem pendência explícita (`P4`, seção 22);
- a tecnologia da porta de redação — templates, IA redatora controlada, ou combinação
  dos dois permanecem decisão não tomada nesta rodada (`P5`, seção 18);
- transporte, Edge Function, WhatsApp, Google Calendar, painel, workflows, n8n,
  Evolution ou Vercel;
- implementação de código, tipo TypeScript ou teste executável;
- remoção física de `data_texto`/`horario_texto` do contrato atual — o corte desta
  integração é lógico e documental (seção 8); a remoção física é etapa posterior, fora
  desta rodada.

**Esta integração não é implementada nesta rodada.** Nenhuma seção autoriza começar
código a partir desta especificação sem uma rodada própria de plano de implementação,
exatamente como já ocorreu para o resolvedor temporal antes de sua implementação.

## 4. Estado atual

Registro factual, verificado antes de escrever esta especificação — nenhuma afirmação
abaixo é presumida:

- os cinco componentes determinísticos de domínio estão **implementados e publicados**:
  resolvedor de procedimento, resolvedor de dentistas e vínculos, resolvedor de duração,
  gerador de disponibilidade, e o resolvedor temporal v1
  (`src/core/resolver-temporal.ts`, `src/core/temporal-tipos.ts`) — suíte oficial
  **730 testes, 725 aprovados, 5 pulados, 0 falhas**;
- a composição determinística do novo agendamento está **apenas especificada**
  (`composicao-novo-agendamento-v1.md`) — nenhuma linha de código da composição existe;
- o controlador conversacional e o contrato de eventos estão **apenas especificados**
  (`controlador-conversacional-v1.md`, `eventos-conversacionais-v1.md`);
- a interpretação pela IA está **parcialmente implementada** no contrato atual (V1):
  `SaidaInterpretacaoModeloV1` com `alteracoes: AlteracoesDados` e
  `eventos_candidatos: EventoCandidatoIA[]`, onde `data_texto` e `horario_texto` são
  texto livre (`CampoDadosConversa`, `src/core/tipos.ts`) — este é o contrato **vigente
  hoje**, não substituído por esta especificação;
- **o controlador ainda não chama o resolvedor temporal.** Nenhuma integração entre
  interpretação, estado persistido, resolvedor temporal e composição existe em código;
- **nenhuma persistência física do schema V2** (alterações temporais, átomos
  acumulados, ou resultado da composição) foi definida ou criada;
- **a porta de redação autorizada não foi implementada**, e a tecnologia de redação
  (template, IA redatora controlada, ou combinação) não foi escolhida;
- **confirmação e criação de agendamento não existem** — a composição, quando
  implementada, terminará em `solicitar_confirmacao` (`composicao-novo-agendamento-v1.md`
  §18) e nada além disso.

Nenhuma seção desta especificação afirma o contrário do que está registrado acima.

## 5. Decisões P1–P5 e C1–C5

### P1 — Alterações temporais entre mensagens (decisão fechada)

A interpretação da mensagem atual produzirá, numa versão futura de contrato (`P2`),
alterações temporais categorizadas — nunca texto livre solto por mensagem. O estado
oficial da conversa persiste os átomos temporais **acumulados**, resultado de aplicar,
mensagem a mensagem, cada alteração temporal autorizada sobre o que já estava
acumulado.

Cada alteração pode, para exatamente uma categoria (seção 7):

- **substituir** integralmente essa categoria pelos átomos informados na mensagem
  atual;
- **remover** integralmente essa categoria.

Nunca reconstruir átomos temporais a partir de:

- `ResolucaoTemporalOficial` (o critério temporal já resolvido — resultado
  **derivado**, nunca fonte);
- texto de mensagem anterior;
- resposta anterior redigida ao paciente;
- memória do modelo.

**A resolução temporal oficial é resultado derivado. Os átomos persistidos são a fonte
interpretada acumulada.** Um refere-se ao critério que o resolvedor produziu a partir
dos átomos; o outro refere-se aos próprios átomos, ainda antes de qualquer resolução.
Confundir os dois recriaria exatamente o problema que a lista de átomos (seção 5 de
`resolvedor-temporal-v1.md`) já resolveu para uma única mensagem — agora entre
mensagens.

### P2 — Corte único do contrato temporal (decisão fechada)

A integração temporal v1 usa **exclusivamente** `alteracoes_temporais` (seção 7) mais
os átomos temporais persistidos (seção 8).

`data_texto` e `horario_texto` (`CampoDadosConversa`, contrato V1 vigente):

- continuam existindo somente no contrato legado, enquanto ele permanecer o contrato
  documentado e vigente (seção 6);
- **não participam** da integração temporal v1 desta especificação;
- **não podem coexistir** como segunda autoridade temporal — nunca dois fatos
  temporais oficiais concorrentes para a mesma mensagem;
- **não podem ser convertidos silenciosamente** em átomos temporais — nenhuma tradução
  automática de texto livre para `AtomoTemporal` é criada por esta especificação, nem
  antecipada para uma rodada futura sem spec própria;
- **não podem sobrescrever** fatos temporais já resolvidos pelo caminho estruturado.

**A versão do contrato determina qual caminho está ativo.** A migração de V1 para uma
versão que produza `alteracoes_temporais` é uma decisão de implementação e
implantação — nunca uma escolha feita mensagem a mensagem dentro da mesma conversa.
Enquanto o contrato vigente for V1, esta integração **não se aplica**: não há
`alteracoes_temporais`, não há átomos acumulados, e o fluxo de novo agendamento
continua exatamente como documentado hoje (sem resolvedor temporal integrado).

**Não é criado modo híbrido.** Nenhuma versão de contrato consome simultaneamente
`data_texto`/`horario_texto` e `alteracoes_temporais` para produzir o mesmo fato
oficial.

### P3 — Fronteira pura da composição (decisão fechada)

A composição determinística do novo agendamento será uma **máquina de estados pura**,
avançada por uma função determinística (seção 11).

Ela:

- recebe o estado oficial e os dados já obtidos (pelo orquestrador, antes da chamada);
- retorna exatamente um de: uma decisão terminal, uma requisição de dados, uma
  requisição de efeito, ou uma falha fechada — **nunca um replay** (`C5`, abaixo);
- **não executa I/O** — nenhuma leitura ou escrita de rede, banco, arquivo ou relógio
  acontece dentro dela;
- **não recebe callbacks com acesso irrestrito** — nenhum cliente de banco, cliente
  HTTP ou função arbitrária é passado como parâmetro;
- **não acessa** banco, agenda, rede, WhatsApp ou IA, direta ou indiretamente.

O orquestrador externo (fora desta função, fora desta especificação — implementação
futura):

1. **antes de qualquer chamada**, verifica se já existe resultado de composição
   registrado para a mensagem — se existir, devolve o replay e **não chama** a função
   pura (`C5`, seção 5; seção 17, "Autoridade única do replay");
2. caso contrário, chama a função pura com a entrada corrente;
3. executa **somente** a requisição que a função autorizou — nunca uma ação por conta
   própria;
4. devolve o resultado dessa execução como parte da **nova entrada**;
5. chama a função pura novamente;
6. encerra o turno quando a função devolve um resultado terminal (decisão ou falha
   fechada) — nunca continua chamando além disso no mesmo turno.

**Replay é resolvido exclusivamente pelo orquestrador, antes da chamada** — nunca pela
função pura, e nunca pelos dois simultaneamente (`C5`). Esta seção e a seção 17 são a
única fonte sobre replay; nenhuma outra passagem desta especificação atribui essa
responsabilidade à função pura.

Este protocolo de chamadas repetidas não introduz estado global: cada chamada é
independente, determinística para a mesma entrada, e toda a continuidade entre
chamadas vive explicitamente na continuação que a função produz e o orquestrador
devolve (`C1`, seção 11) — nunca em variável estática, cache implícito ou closure com
estado mutável.

### P4 — Persistência física (decisão adiada)

Continuam pendentes, para especificação própria, futura, com sua própria aprovação:

- tabelas, colunas, índices e constraints para alterações temporais, átomos
  acumulados, e resultado da composição;
- RPCs ou mecanismo equivalente para aplicar alterações temporais com CAS;
- a transação concreta que torna atômicas as gravações exigidas pela seção 13;
- o CAS físico entre a versão do estado lida e a versão gravada;
- a atomicidade concreta entre o estado persistido e o resultado da composição
  registrado (mesmo espírito de `persistencia-v1.md` §23, "`concluida` implica que o
  efeito existe" — aplicado aqui ao par estado/resultado, não ao par
  operação/agendamento).

**Esta especificação define somente o contrato lógico** que essa persistência futura
deverá cumprir (seção 8, seção 13) — nunca schema, tabela, coluna, índice, RPC ou
migration. Nenhuma dessas pendências é resolvida, presumida ou antecipada aqui.

### P5 — Porta de redação (decisão parcialmente adiada)

Esta especificação define **somente**:

- a entrada autorizada da redação (seção 18) — o mesmo contrato conceitual já descrito
  em `atendimento-v1.md` §2, agora nomeado e com forma mínima explícita;
- os limites de autoridade da redação — o que ela nunca pode fazer, herdados sem
  alteração de `atendimento-v1.md` §6;
- a separação entre decisão lógica (produzida pela composição) e texto (produzido pela
  redação) — a mesma separação já fixada em `composicao-novo-agendamento-v1.md` §8 e
  `atendimento-v1.md` §1.

**Não é decidido nesta etapa** entre: templates determinísticos; uma IA redatora
controlada, restrita aos fatos autorizados; ou uma combinação dos dois. **Nenhum
fallback novo é criado** para cobrir essa indecisão — a ausência de decisão sobre
tecnologia de redação não autoriza um comportamento provisório não especificado.

### C1 — Continuação explícita (decisão fechada)

Toda chamada **não terminal** de `avancarComposicaoNovoAgendamentoV1` (seção 11)
retorna uma **continuação explícita, imutável e serializável**. A chamada seguinte deve
receber essa continuação **integralmente** — nunca uma versão reduzida, resumida ou
reconstruída.

Nenhuma continuidade entre chamadas pode depender de:

- memória global ou variável estática do processo;
- closure ou escopo capturado;
- processo vivo (a continuação sobrevive a reinício, troca de worker e serialização);
- cache implícito;
- ordem presumida das chamadas;
- recomputação de efeitos anteriores;
- dados mantidos informalmente pelo orquestrador, fora da continuação.

Esta decisão fecha a lacuna deixada por `P3`: `P3` já proibia estado global, mas
descrevia a continuidade como "os dados que o orquestrador acumula e devolve" — sem
nomear a forma desses dados. `C1` nomeia essa forma e a torna obrigatória.

### C2 — Dados condicionais acumulados (decisão fechada)

As respostas condicionais **já aceitas** permanecem registradas dentro da continuação
(seção 11, `dados_condicionais_aceitos`). Cada nova chamada recebe:

- a continuação anterior, íntegra;
- **no máximo uma** nova resposta, correlacionada à requisição pendente.

**A máquina nunca recebe apenas "a resposta mais recente" sem o contexto anterior.** Um
snapshot diário obtido na quinta chamada não apaga o catálogo obtido na segunda — os
dois continuam disponíveis, tipados e correlacionados, dentro da mesma continuação.

### C3 — Resultado candidato preservado (decisão fechada)

Ao solicitar a persistência final (seção 13, passo 24), a continuação carrega
integralmente o **resultado candidato** (seção 11): estado final proposto, resultado
lógico, **resultado terminal candidato**, fatos autorizados para a futura redação, e a
identidade e versão da persistência solicitada. O resultado terminal candidato preserva
exatamente um `ResultadoTerminalCandidatoV1` (seção 11) — a mesma união fechada já
aprovada, sem alteração:

```text
ResultadoTerminalCandidatoV1 =
  | DecisaoComposicaoV1
  | FalhaDominioPersistivelComposicaoV1
```

Após a resposta de efeito `confirmado` e compatível, a máquina devolve **exatamente** o
**resultado terminal candidato preservado** — seja ele uma `DecisaoComposicaoV1` (uma
decisão conversacional) ou uma `FalhaDominioPersistivelComposicaoV1` (uma falha de
domínio persistível); as duas são cobertas igualmente por esta decisão. **Nenhum
resolvedor é reexecutado; o resultado terminal nunca é recomputado, e nem a decisão
nem a falha são reconstruídas.** Sem `C3`, o requisito de "persistir antes de decidir"
(seção 11) seria cumprido de forma apenas aparente: o resultado terminal devolvido
poderia divergir do resultado terminal que foi persistido.

### C4 — Correlação obrigatória (decisão fechada)

Toda requisição de dado ou de efeito emitida pela máquina possui **identidade única e
origem fechada** (seção 12). Toda resposta deve ecoar essa identidade e essa origem.
**Resposta incompatível produz falha fechada** (seção 20) — nunca aplicação parcial,
nunca aceitação "por aproximação", nunca comparação textual informal.

**Esclarecimento — "correlação obrigatória" tem um escopo preciso** (não reabre `C4`,
apenas nomeia o que ela sempre significou, detalhado em "Concorrência divergente fora
do conhecimento da função", seção 11):

- correlação significa **correspondência da resposta com a requisição pendente
  presente na entrada corrente** — identidade, origem, tipo, e os demais campos
  verificáveis diretamente contra essa requisição (seção 12);
- correlação **não significa** comparação com um histórico ausente da entrada — a
  máquina nunca afirma que uma resposta diverge de "outra resposta já aceita antes"
  quando essa outra resposta não está, ela mesma, disponível na chamada corrente;
- correlação **não é** garantia física de concorrência — decidir qual de duas
  respostas concorrentes é a fisicamente aceita, e impedir um segundo avanço oficial,
  pertence a `P4`, nunca a esta decisão.

### C5 — Replay pertence ao orquestrador (decisão fechada)

O replay é resolvido **exclusivamente antes** da chamada da máquina. Quando já existe
resultado de composição registrado para a mensagem (Caso A, seção 17):

- o orquestrador devolve o replay;
- `avancarComposicaoNovoAgendamentoV1` **não é chamada**;
- nenhuma continuação é criada.

`ReplayComposicaoV1` é **removido** da união retornada pela função pura (seção 11) — a
máquina não possui duas autoridades de replay. O replay **continua existindo no
sistema**, como resultado externo do orquestrador (seção 17, "Autoridade única do
replay") — o que muda é apenas quem tem autoridade para produzi-lo, nunca a existência
do comportamento. Esta decisão alinha o Caso A ao Caso B, que já era resolvido
inteiramente pelo orquestrador antes da primeira chamada.

## 6. Contrato da interpretação

Contrato conceitual — **pseudotipo, não implementação; não é assinatura de função nem
schema físico**, forma e nomes pertencem à implementação futura. Reutiliza,
sem alteração, `AlteracoesDados` (`Record<string, AlteracaoDeCampo>`, `src/core/tipos.ts`,
já publicado — chave é o nome do campo, valor é `{ acao: string; valor?: string }`) e
`EventoCandidatoIA` (`eventos-conversacionais-v1.md` §1, já publicado):

```text
interface SaidaInterpretacaoModeloV2 {
  alteracoes: AlteracoesDados;
  alteracoes_temporais: readonly AlteracaoTemporalIA[];
  eventos_candidatos: readonly EventoCandidatoIA[];
}
```

**Nota de correção:** uma versão anterior desta especificação nomeava este campo com
um tipo fictício (`AlteracaoInterpretadaIA`, inexistente em `src/core/tipos.ts`) e o
representava como lista (`readonly [...][]`). O tipo real e já publicado,
`AlteracoesDados`, é um **dicionário por nome de campo** (`Record<string,
AlteracaoDeCampo>`), nunca uma lista — a correção acima reutiliza a forma exata já
publicada, sem inventar shape novo.

`SaidaInterpretacaoModeloV2` é uma **versão de contrato distinta** de
`SaidaInterpretacaoModeloV1` (`eventos-conversacionais-v1.md` §4, contrato vigente
hoje) — nunca uma extensão retrocompatível consumida ao mesmo tempo que a V1 (`P2`).
`alteracoes` preserva, na V2, a mesma forma publicada de `AlteracoesDados` — apenas o
**conjunto de chaves aceitas** muda: exatamente os campos não temporais de
`CampoDadosConversa` (`intencao`, `procedimento_texto`, `dentista_texto`, `periodo`,
`nome`, `cpf`, `data_nascimento`, `email`) — `data_texto` e `horario_texto` são
**removidos** desse conjunto na V2, substituídos por `alteracoes_temporais`. Uma saída
V2 cuja `alteracoes` contenha a chave `data_texto` ou `horario_texto` é
estruturalmente inválida (seção 7) — mesma disciplina de corte único de `P2`.

Categorias temporais fechadas:

```text
type CategoriaTemporal =
  | 'data'
  | 'horario_exato'
  | 'periodo'
  | 'restricao'
  | 'intencao_temporal';

type AlteracaoTemporalIA =
  | {
      acao: 'substituir';
      categoria: CategoriaTemporal;
      atomos: readonly AtomoTemporal[];
    }
  | {
      acao: 'remover';
      categoria: CategoriaTemporal;
    };
```

`AtomoTemporal` é reutilizado **exatamente** como publicado em
`src/core/temporal-tipos.ts` (`resolvedor-temporal-v1.md` §5) — nenhuma variante nova,
nenhum campo novo.

### Correspondência fechada entre categoria e tipo de átomo

Cada categoria aceita **exatamente** os `tipo`s de `AtomoTemporal` desta tabela — um
`AlteracaoTemporalIA.acao: 'substituir'` cujos `atomos` contenham um `tipo` fora da
correspondência da sua própria `categoria` é estruturalmente inválido (seção 7):

| `CategoriaTemporal` | `AtomoTemporal.tipo` aceitos |
|---|---|
| `data` | `data_absoluta`, `data_relativa`, `dia_semana` |
| `horario_exato` | `horario_exato` |
| `periodo` | `periodo` |
| `restricao` | `restricao` |
| `intencao_temporal` | `intencao` |

`data` agrupa três formas de expressar o mesmo fato — uma data — porque o resolvedor
temporal já as trata como a mesma categoria de conflito (`multiplas_datas`,
`resolvedor-temporal-v1.md` §20): duas datas informadas em categorias diferentes, mas
ambas pertencendo ao conceito "data", ainda seriam duas datas conflitantes se
coexistissem — por isso vivem na mesma categoria de substituição/remoção, nunca em
categorias distintas que pudessem coexistir silenciosamente.

### Duas noções de "intenção" — nunca confundidas

`intencao_temporal` (categoria desta seção) e `intencao` (`CampoDadosConversa`,
`src/core/tipos.ts`, já publicado, contrato V1 vigente) são **conceitos
completamente distintos**, apesar do nome semelhante:

- `CampoDadosConversa.intencao` representa a **intenção conversacional/operacional** —
  hoje o único valor aceito é `'novo_agendamento'` (`INTENCOES_PERMITIDAS`,
  `src/core/aplicar-dados.ts`) — qual ação o paciente quer realizar nesta conversa;
- o átomo `{ tipo: 'intencao'; valor: 'data_especifica' | 'proxima_disponibilidade' }`
  (`resolvedor-temporal-v1.md` §5) representa a **intenção de busca temporal** — se o
  paciente quer uma data específica ou a próxima disponibilidade qualquer.

Os dois nunca se confundem, nunca compartilham campo, e a categoria `intencao_temporal`
desta especificação refere-se **exclusivamente** à segunda. `alteracoes` (não
temporais) continua carregando `intencao` no sentido de `CampoDadosConversa`, sem
alteração.

### Regras estruturais de `alteracoes_temporais`

- `substituir` remove todos os átomos oficiais anteriores da categoria e grava os
  novos, na mesma operação lógica (seção 8);
- `remover` elimina todos os átomos oficiais da categoria — nenhum átomo daquela
  categoria permanece após a aplicação;
- ausência de alteração para uma categoria **preserva** o estado oficial daquela
  categoria — o mesmo princípio de "dado já informado não é solicitado novamente" e
  "campo ausente na nova mensagem preserva o valor anterior" já fixado para
  `AlteracoesDados` (`novo-agendamento.md` §4, `tests/cenarios-obrigatorios.md`,
  INT-02);
- **a mesma mensagem não pode produzir duas alterações para a mesma categoria** — duas
  entradas de `alteracoes_temporais` com a mesma `categoria`, na mesma saída da
  interpretação, é violação estrutural;
- os átomos de `substituir` devem pertencer à categoria declarada, conforme a
  correspondência fechada acima;
- **alteração temporal estruturalmente inválida rejeita integralmente a
  interpretação** — mesma disciplina já aplicada a `alteracoes`/`eventos_candidatos`
  hoje (`eventos-conversacionais-v1.md` §7, "Saída estrutural inválida segue a
  resposta fixa de falha; não existe aplicação parcial"); nenhuma alteração temporal
  parcial é promovida junto de alterações não temporais válidas na mesma mensagem;
- **a ordem das alterações dentro de `alteracoes_temporais` não pode mudar o
  resultado** — mesmo princípio de independência de ordem já exigido de
  `fatos_temporais` dentro do resolvedor temporal (`resolvedor-temporal-v1.md` §5,
  "Regras da lista");
- **o limite final permanece em oito átomos**, conforme já fechado pelo resolvedor
  temporal (`resolvedor-temporal-v1.md` §5, seção 8 desta especificação) — esta seção
  não define um segundo limite independente; o limite é sobre o `fatos_temporais`
  resultante da acumulação (seção 8), nunca sobre `alteracoes_temporais` isoladamente.

A IA interpreta **somente a mensagem atual** — cada `AlteracaoTemporalIA` reflete o que
a mensagem atual expressa, nunca uma reafirmação do que já estava acumulado
(`../docs/02-arquitetura.md`).

## 7. Alterações temporais

Esta seção detalha a validação e a semântica de `alteracoes_temporais` já introduzida
na seção 6 — a forma de contrato pertence a ela; esta seção descreve o **momento** e a
**responsabilidade** de cada verificação, dentro da ordem determinística (seção 13).

### Momento da validação estrutural

A validação estrutural de `alteracoes_temporais` (categoria conhecida, ação conhecida,
átomos pertencentes à categoria declarada, ausência de categoria repetida na mesma
mensagem, forma de cada átomo conforme `resolvedor-temporal-v1.md` §5) ocorre **junto**
da validação já existente de `alteracoes`/`eventos_candidatos`
(`interpretacao-ia.md`, "Fluxo final aprovado", passo 11: "validar integralmente a
saída") — nunca depois, nunca como etapa isolada e opcional. Uma saída estruturalmente
inválida em qualquer um dos três campos (`alteracoes`, `alteracoes_temporais`,
`eventos_candidatos`) rejeita a interpretação inteira, com a mesma resposta fixa já
aprovada (`interpretacao-ia.md`, "Falhas e mensagens duplicadas").

Esta validação estrutural **não é responsabilidade da composição pura** (seção 11) —
ela ocorre antes, no mesmo ponto em que a interpretação já é validada hoje. A
composição recebe `alteracoes_temporais` **já validada estruturalmente**, exatamente
como o resolvedor temporal recebe `fatos_temporais` já validado pela camada 2 do Core
(`resolvedor-temporal-v1.md` §5, "Quatro camadas, não três").

### Autoridade sobre a fronteira estrutural vs. o resultado de domínio

Esta distinção reaparece aqui exatamente como já fixada no resolvedor temporal
(`resolvedor-temporal-v1.md` §21, "Precedência global de avaliação", nível 1 vs. nível
3): um `AlteracaoTemporalIA` com forma inválida (categoria desconhecida, ação
desconhecida, átomo de categoria errada, categoria repetida) é rejeição **estrutural**
da interpretação inteira — nunca um resultado de domínio do resolvedor temporal. O
resolvedor temporal só é chamado depois (seção 9), sobre uma lista de átomos já
estruturalmente válida; ele nunca vê uma `alteracoes_temporais` malformada.

### Aplicação sobre o estado acumulado

Contrato conceitual da função pura que funde `alteracoes_temporais`, já validada
estruturalmente acima, sobre o estado acumulado (seção 8) — **pseudotipo, não
implementação**:

```text
aplicarAlteracoesTemporais(
  fatosAtuais: readonly AtomoTemporal[],
  alteracoes: readonly AlteracaoTemporalIA[]
): readonly AtomoTemporal[]
```

Regras:

- recebe `alteracoes` **já validada integralmente** (subseção acima) — esta função
  nunca rejeita entrada malformada, porque nunca a recebe; sua responsabilidade é
  exclusivamente a fusão;
- agrupar os átomos de `fatosAtuais` por categoria (correspondência fechada da seção
  6) — agrupamento **interno e efêmero**, existente somente durante esta chamada,
  nunca uma representação persistida (seção 8);
- para cada categoria presente em `alteracoes`: se `substituir`, o grupo daquela
  categoria em `fatosAtuais` é descartado e substituído pelos `atomos` da alteração;
  se `remover`, o grupo é esvaziado;
- para cada categoria **ausente** em `alteracoes`: o grupo correspondente de
  `fatosAtuais` é preservado sem alteração;
- recompor os grupos de volta em uma única lista plana, na **ordem canônica** abaixo —
  a ordem serve exclusivamente à serialização estável (para que a mesma composição de
  fatos produza sempre a mesma lista, byte a byte), **nunca à semântica**: o resolvedor
  temporal já é, por contrato, independente da ordem dos átomos
  (`resolvedor-temporal-v1.md` §5, "Regras da lista");
- **não mutar** `fatosAtuais` nem `alteracoes` — mesma disciplina de pureza já exigida
  dos cinco componentes de domínio publicados;
- **não resolver datas ou horários** — nenhuma aritmética de calendário, nenhuma
  conversão de horário 12h/24h, nenhuma avaliação de passado acontece aqui; essa
  responsabilidade pertence exclusivamente a `resolverTemporal` (seção 9), chamado
  depois, sobre o resultado desta função;
- **não consultar relógio** — nenhum `Date`, `Date.now` ou equivalente;
- **não corrigir fatos** — um átomo estruturalmente válido, mas semanticamente
  estranho (ex.: uma data já passada), é preservado exatamente como recebido; a
  classificação de passado, ambiguidade ou conflito é responsabilidade exclusiva do
  resolvedor temporal, nunca desta função de fusão.

#### Ordem canônica de recomposição

```text
1. intencao_temporal
2. data
3. horario_exato
4. periodo
5. restricao
```

Uma categoria ausente do estado resultante simplesmente não contribui nenhum átomo à
lista final — a ordem entre as categorias presentes é preservada, nunca a posição fixa
de uma categoria ausente.

#### Limite de oito átomos — responsabilidade do resolvedor temporal, não desta função

Esta função **não rejeita** um `fatos_temporais` resultante com mais de oito átomos.
O limite de oito já é um resultado de domínio fechado do resolvedor temporal
(`invalido`/`quantidade_atomica_excedida`, `resolvedor-temporal-v1.md` §19) — duplicar
essa verificação aqui, com uma possível resposta diferente, criaria dois caminhos de
falha para o mesmo problema, um deles não documentado no catálogo já fechado de
motivos. `aplicarAlteracoesTemporais` sempre produz o resultado da fusão,
independentemente do tamanho; `resolverTemporal` (seção 9), chamado em seguida,
classifica corretamente um resultado excedente.

Na prática, exceder oito átomos exige acumular muitas categorias simultaneamente com
múltiplos átomos cada — um cenário raro, mas não impedido estruturalmente por esta
função, exatamente como o resolvedor temporal já prevê.

## 8. Estado temporal persistido

### Estado lógico mínimo da composição

Contrato conceitual — **pseudotipo, não implementação; nomes e forma pertencem à
implementação futura**, exatamente como todo pseudotipo já publicado nesta e nas
demais specs canônicas. Reunido aqui para que `fatos_temporais` e `criterio_temporal`
— os dois campos que esta integração acrescenta — tenham um container nomeado, em vez
de flutuarem soltos:

```text
interface EstadoNovoAgendamentoV1 {
  acao_corrente: 'novo_agendamento' | null;
  fase: EstadoConversa;

  pedido: {
    procedimento_texto?: string;
    dentista_texto?: string;
    fatos_temporais: readonly AtomoTemporal[];
    aceitar_qualquer_profissional: boolean;
  };

  resolucoes: {
    procedimento?: ProcedimentoResolvidoPersistivel;
    dentista?: DentistaResolvidoPersistivel;
    duracao?: DuracaoAplicada;
    criterio_temporal?: ResolucaoTemporalOficial;
  };

  opcoes?: ConjuntoOpcoesVigente;
  escolha?: EscolhaVigente;
  cadastro: CadastroAcumulado;
  resumo?: ContextoResumoVigente;
}
```

- `pedido.fatos_temporais` é o **estado interpretado acumulado** — o resultado de
  aplicar, mensagem a mensagem, cada `AlteracaoTemporalIA` autorizada sobre o que já
  estava persistido (seção 7);
- `resolucoes.criterio_temporal` é **estado derivado** — o resultado da última chamada
  bem-sucedida a `resolverTemporal` sobre `pedido.fatos_temporais`; nunca escrito
  diretamente, nunca fonte de outro fato;
- `opcoes`, `escolha` e `resumo` também são **estado derivado** — de
  `resolucoes.criterio_temporal` e das demais resoluções, nunca escritos
  independentemente delas;
- esta forma é **lógica e conceitual**, não física — `EstadoConversa`,
  `ProcedimentoResolvidoPersistivel`, `DentistaResolvidoPersistivel`,
  `DuracaoAplicada`, `ConjuntoOpcoesVigente`, `EscolhaVigente` e
  `CadastroAcumulado`/`ContextoResumoVigente` são os mesmos nomes conceituais já
  usados em `controlador-conversacional-v1.md` §9 e `composicao-novo-agendamento-v1.md`
  §5 — tipos auxiliares que continuam sendo **contratos futuros da composição**,
  nenhum deles implementado hoje; a representação física de todo este estado
  permanece pendência explícita (`P4`);
- **nenhum destes tipos está sendo declarado como código existente** — `interface`
  aqui é notação de pseudotipo (bloco `text`), nunca uma declaração TypeScript real.

### `fatos_temporais` — forma final, não cinco campos separados

A noção de "categoria" (seção 6, seção 7) é o **critério de fusão** usado por
`aplicarAlteracoesTemporais` (seção 7, "Aplicação sobre o estado acumulado") para
decidir quais átomos substituir ou remover — nunca uma segunda representação física
paralela. `pedido.fatos_temporais` guarda exatamente a lista plana que
`resolverTemporal` já consome (`resolvedor-temporal-v1.md` §4), pronta para ser
passada sem nenhuma transformação adicional.

Regras:

- **alteração de qualquer categoria temporal invalida o `criterio_temporal`
  anterior** — a próxima vez que a composição precisar de um critério temporal oficial,
  ela chama `resolverTemporal` de novo (seção 9), nunca reaproveita o anterior;
- opções, escolha e resumo derivados de um `criterio_temporal` invalidado também são
  invalidados, na mesma cascata já fixada em
  `composicao-novo-agendamento-v1.md` §14 (seção 10 desta especificação consolida a
  correspondência);
- **o estado nunca depende da memória do modelo** — cada `fatos_temporais` persistido é
  o único material de onde uma resolução temporal futura pode partir; a IA nunca é
  consultada sobre o que já está acumulado, e nunca precisa se lembrar de turnos
  anteriores (`../docs/02-arquitetura.md`).

**Esta especificação não define representação física ou SQL** para
`EstadoNovoAgendamentoV1` nem para nenhum de seus campos — nenhuma tabela, coluna,
tipo de coluna (JSON, array, linhas normalizadas) ou índice é escolhido aqui (`P4`).

## 9. Contrato do resolvedor temporal

`resolverTemporal` (`src/core/resolver-temporal.ts`, já publicado e implementado) é
chamado pela composição **somente depois** de, na mesma passagem do turno:

1. a saída da interpretação estar **integralmente validada** (seção 7);
2. as `alteracoes_temporais` autorizadas, mais as alterações não temporais, estarem
   **aplicadas** sobre o estado acumulado (seção 7);
3. as **invalidações** decorrentes da mensagem atual estarem **calculadas** (seção 10)
   — antes de qualquer persistência deste turno, nunca depois;
4. o estado interpretado **coerente** resultante — fatos novos e derivados invalidados
   já ausentes, num único objeto — estar **persistido** como novo estado oficial, numa
   única operação atômica (seção 8, seção 13);
5. o **novo estado oficial** estar carregado (o `fatos_temporais` já recomposto, já sem
   nenhum derivado invalidado pendente);
6. o **procedimento** estar resolvido;
7. os **dentistas** estarem resolvidos (incluindo, quando aplicável, o ramo de
   Consulta/Avaliação, seção 15);
8. a **duração** estar resolvida.

Esta ordem preserva, sem alteração, a posição já reservada ao resolvedor temporal em
`composicao-novo-agendamento-v1.md` §9 (passo 7, entre duração e obtenção do snapshot
diário) — esta especificação apenas nomeia com precisão os pré-requisitos que já
estavam implícitos naquela ordem.

### Entrada

```text
{
  clinica_id,
  fuso,
  instante_atual,
  fatos_temporais: estado.pedido.fatos_temporais
}
```

Origem de cada campo — nenhum deles é recalculado ou re-derivado pela composição:

| Campo | Origem |
|---|---|
| `clinica_id` | contexto autenticado (`novo-agendamento.md` §2) — nunca do paciente ou da IA |
| `fuso` | `ConfiguracaoClinicaMinima.fuso` (`composicao-novo-agendamento-v1.md` §4.1) |
| `instante_atual` | adaptador confiável (transporte), a mesma entrada já obrigatória para `resolverDisponibilidade` (`disponibilidade-tipos.ts`) |
| `fatos_temporais` | estado persistido acumulado (seção 8) — **nunca** saída solta da IA da mensagem atual isoladamente; a mensagem atual só chega até aqui depois de já ter sido fundida ao estado (seção 7) |

`fatos_temporais` não é a saída bruta de `alteracoes_temporais` da mensagem atual — é o
resultado, já fundido, de aplicar essa saída sobre o que já estava acumulado. Uma
mensagem que só corrige o horário ("na verdade às 15h") produz uma
`alteracoes_temporais` com uma única entrada (`substituir`, `horario_exato`), mas a
composição chama `resolverTemporal` com **todos** os átomos vigentes de todas as
categorias, incluindo a data já informada em turnos anteriores.

### Tratamento das sete variantes

Tratamento fechado — nenhuma variante ignorada, nenhuma tratada fora do catálogo já
existente de comandos (`composicao-novo-agendamento-v1.md` §8):

| `tipo` de `ResultadoResolucaoTemporal` | Tratamento |
|---|---|
| `resolvido` | Promover `criterio_temporal` (seção 8) a partir de `data`/`periodo`/`horario_min`/`restricao`; seguir para o passo seguinte da ordem canônica (obtenção do snapshot diário) — **exceto** quando `horario_min` e `restricao` estão ambos presentes simultaneamente, caso em que a composição devolve falha fechada antes de qualquer requisição de disponibilidade (seção 14). |
| `incompleto` | Pausa — comando `pedir_dado_temporal` (`composicao-novo-agendamento-v1.md` §8, pausa 9), pedindo o dado faltante conforme `motivo` (`intencao_ausente`, `horario_recorrente_nao_suportado`, `data_ausente`). |
| `ambiguo` | Pausa — solicitar esclarecimento sobre o fato ambíguo, conforme `motivo` (`resolvedor-temporal-v1.md` §17). |
| `invalido` | Pausa — falha técnica fechada (`falha_tecnica_fechada`) quando o `motivo` é estrutural do domínio de calendário/horário (`resolvedor-temporal-v1.md` §19); nunca comunicado como indisponibilidade. |
| `passado` | Pausa — informar que o fato já não é possível e pedir novo critério (nova data/horário), conforme `motivo` (`resolvedor-temporal-v1.md` §16). |
| `conflito` | Pausa — solicitar esclarecimento; **nunca** escolher um dos fatos conflitantes silenciosamente (`resolvedor-temporal-v1.md` §20). |
| `erro_configuracao` | Pausa — falha técnica fechada (`falha_tecnica_fechada`); mesma classificação já usada para `configuracao_invalida` de `resolverDisponibilidade` (`composicao-novo-agendamento-v1.md` §13.6). |

`EntradaInvalidaError` — lançada, nunca um valor de retorno (`resolvedor-temporal-v1.md`
§21, nível 1) — é tratada como **falha estrutural interna**: se a composição monta uma
entrada inválida para `resolverTemporal` (violação do próprio contrato de forma que
esta especificação define), isso é um defeito da composição, não um resultado a
comunicar ao paciente. A composição, corretamente implementada, nunca produz uma
entrada que viole o contrato de forma do resolvedor temporal, porque `fatos_temporais`
sempre chega já validado estruturalmente (seção 7) antes de qualquer acumulação.

**O controlador não reimplementa nenhuma regra temporal.** Toda a lógica de datas,
horários, períodos, restrições, precedência e passado pertence exclusivamente a
`resolvedor-temporal-v1.md` — esta seção só nomeia o tratamento do resultado, nunca
recalcula nada que o resolvedor já decidiu.

## 10. Matriz de invalidação

Seção normativa única, consolidando — sem contradizer — a matriz já publicada em
`composicao-novo-agendamento-v1.md` §14. As cinco linhas de fato temporal refinam, com
precisão de categoria (seção 6), a linha única "Data" e a linha única "Período,
restrição ou horário" daquela matriz; as demais linhas abaixo repetem, sem alteração,
o que já está publicado — reunidas aqui para que a integração temporal tenha uma única
tabela de referência, sem obrigar consulta cruzada constante entre os dois documentos:

| Alteração | Preserva | Invalida |
|---|---|---|
| Procedimento | cadastro | procedimento oficial, dentista, duração, critério temporal dependente, opções, escolha e resumo |
| Dentista | procedimento, cadastro e temporal | dentista oficial, **duração** (é do dentista — recalcular para o profissional escolhido, `duracao-v1.md` §0/§1, revisado 30/08/2026), opções, escolha e resumo |
| Data | procedimento, dentista, duração e cadastro | critério temporal, opções, escolha e resumo |
| Horário exato | procedimento, dentista, duração e cadastro | critério temporal, opções, escolha e resumo |
| Período | procedimento, dentista, duração e cadastro | critério temporal, opções, escolha e resumo |
| Restrição | procedimento, dentista, duração e cadastro | critério temporal, opções, escolha e resumo |
| Intenção temporal | procedimento, dentista, duração e cadastro | critério temporal, opções, escolha e resumo |
| Qualquer dentista (sinal composto, `composicao-novo-agendamento-v1.md` §13.2) | procedimento, temporal e cadastro | dentista específico, **duração** (recalculada por profissional — cada apto entra na disponibilidade com a duração dele), opções, escolha e resumo |
| Outro horário (nova apresentação de opções) | procedimento, duração, dentistas aptos e cadastro | opções, escolha e resumo |
| Correção cadastral | resoluções e escolha | resumo e confirmação pendente |
| Desistência | identidade e cadastro permitido | todo estado operacional da ação |

As cinco linhas temporais (Data, Horário exato, Período, Restrição, Intenção
temporal) correspondem exatamente às cinco `CategoriaTemporal` da seção 6 — uma
alteração em qualquer uma delas, por `substituir` ou por `remover` (seção 7), invalida
sempre o mesmo conjunto: o critério temporal oficial, as opções, a escolha e o resumo.
Nenhuma categoria temporal invalida procedimento, dentista, duração ou cadastro —
nenhum desses quatro depende de fato temporal.

### Mensagem composta

- aplicar a **união transitiva** das invalidações de todas as alterações da mesma
  mensagem — uma mensagem que altera procedimento e data invalida a união do que cada
  uma invalidaria isoladamente, nunca apenas uma das duas;
- **nunca depender da ordem** das alterações dentro da mesma mensagem — o resultado da
  invalidação é o mesmo independentemente de qual alteração foi processada primeiro;
- **nenhuma invalidação pode ser revertida** por outra alteração da mesma mensagem —
  não existe combinação de fatos, na mesma mensagem, que restaure algo já invalidado
  por outro fato dessa mensagem;
- **a aplicação desta invalidação nunca é persistida separadamente dos fatos que a
  causaram** — o estado interpretado coerente que resulta da união transitiva acima é
  sempre gravado como um único par com os fatos novos, nunca em duas escritas (seção
  13, passos 6 a 9); nenhum estado oficial observável combina fatos temporais novos
  com um `criterio_temporal`, `opcoes`, `escolha` ou `resumo` que ainda presumem os
  fatos anteriores.

## 11. Máquina pura de composição

Contrato conceitual recomendado — **pseudotipo, não implementação**:

```text
function avancarComposicaoNovoAgendamentoV1(
  entrada: EntradaAvancoComposicaoV1
): ResultadoAvancoComposicaoV1
```

### Contexto determinístico

Todo campo de `EntradaAvancoComposicaoV1` que não vem do estado oficial, da
interpretação já validada ou de uma resposta do orquestrador é reunido em
`ContextoDeterministicoComposicaoV1` — nenhum destes campos é, em nenhuma
circunstância, produzido, sugerido ou confirmado pela IA:

```text
interface ContextoDeterministicoComposicaoV1 {
  clinica_id: string;
  fuso: string;
  instante_atual: InstanteAtual;
  mensagem: {
    message_id: string;
    conversa_id: string;
  };
}
```

Origem fechada de cada campo — mesma disciplina de origem já exigida da entrada do
resolvedor temporal (seção 9):

| Campo | Origem |
|---|---|
| `clinica_id` | contexto autenticado da instância corrente (`novo-agendamento.md` §2) — nunca do paciente, nunca da IA |
| `fuso` | configuração oficial da clínica (`ConfiguracaoClinicaMinima.fuso`, `composicao-novo-agendamento-v1.md` §4.1) |
| `instante_atual` | adaptador confiável de tempo (transporte) — mesma fonte já obrigatória para `resolverDisponibilidade` e para `resolverTemporal` (seção 9) |
| `mensagem.message_id` | identidade da mensagem autenticada, atribuída pelo transporte antes de qualquer interpretação |
| `mensagem.conversa_id` | identidade da conversa autenticada, mesma origem de `clinica_id` |

**O contexto autenticado nunca é incorporado ao estado conversacional.**
`ContextoDeterministicoComposicaoV1` viaja em toda chamada, mas nenhum de seus campos é
persistido dentro de `EstadoNovoAgendamentoV1` (seção 8) — o contexto descreve a
chamada corrente, nunca o histórico acumulado da conversa. Confundir os dois
recriaria, para o contexto, o mesmo problema que a seção 5 (`P1`) já resolve para os
átomos temporais: uma fonte de verdade duplicada, uma oficial e outra reconstruída.

### Continuação explícita

Contrato conceitual da continuidade entre chamadas (`C1`, seção 5) — **pseudotipo, não
implementação; nomes e forma pertencem à implementação futura**:

```text
interface ContinuacaoComposicaoV1 {
  readonly continuacao_id: string;
  readonly etapa: EtapaComposicaoV1;

  readonly origem: {
    readonly clinica_id: string;
    readonly conversa_id: string;
    readonly message_id: string;
    readonly versao_estado_origem: string;
  };

  readonly identidade_entrada: {
    readonly estado_oficial: string;      // identidade estável do estado recebido
    readonly interpretacao: string;       // identidade estável da interpretação validada
  };

  readonly estado_trabalho: EstadoNovoAgendamentoV1;

  readonly dados_condicionais_aceitos: readonly DadoCondicionalAceitoV1[];

  readonly requisicao_pendente?:
    | RequisicaoDadoCondicionalV1      // seção 12
    | RequisicaoEfeitoComposicaoV1;    // seção 12

  readonly resultado_candidato?: ResultadoCandidatoComposicaoV1;
}
```

Campos obrigatórios, qualquer que seja a forma final: identidade própria da continuação;
etapa discriminada; origem completa; estado de trabalho; conjunto acumulado e tipado de
dados condicionais aceitos; **no máximo uma** requisição pendente; resultado candidato
apenas quando já preparado.

O que a continuação **é**:

- o **único** veículo de continuidade entre duas chamadas da máquina — tudo o que a
  chamada seguinte precisa saber sobre a anterior está aqui, explicitamente;
- **imutável** — uma continuação recebida nunca é modificada; a máquina produz uma
  **nova** continuação a cada chamada não terminal;
- **serializável** — sobrevive a serialização, reinício de processo e troca de worker,
  sem perda de significado.

O que a continuação **não é**:

- **não é o estado conversacional oficial** — `estado_trabalho` é o estado *proposto* em
  andamento nesta passagem do turno; o estado oficial só muda quando um efeito de
  persistência é confirmado (seção 13);
- **não é memória do modelo** — nenhum campo dela vem da IA, e a IA nunca a lê
  (`../docs/02-arquitetura.md`);
- **não é event sourcing** — não é um log de eventos, não é acumulada entre turnos, e
  não substitui o estado persistido;
- **não executa efeito** — é um valor, nunca uma ação; carregar uma requisição pendente
  não é executá-la.

**A representação física da continuação permanece pendência explícita (`P4`)** —
nenhuma tabela, coluna, formato de serialização ou mecanismo de transporte é escolhido
aqui. O que esta seção fixa é o **contrato lógico**: a continuação deve sobreviver entre
chamadas, e a mesma entrada, a mesma continuação e a mesma resposta produzem sempre o
mesmo resultado.

### Etapas discriminadas

União fechada — **pseudotipo, não implementação**:

```text
type EtapaComposicaoV1 =
  | 'inicio'
  | 'aguardando_persistencia_intermediaria'
  | 'resolvendo_procedimento'
  | 'resolvendo_dentistas'
  | 'resolvendo_duracao'
  | 'resolvendo_temporal'
  | 'aguardando_snapshot'
  | 'avaliando_opcoes'
  | 'preparando_resultado'
  | 'aguardando_persistencia_final'
  | 'pronto_para_decisao_terminal';
```

A etapa registra **o ponto exato da ordem determinística (seção 13) a partir do qual a
próxima chamada retoma** — nunca um resumo do que já aconteceu, nunca um contador de
chamadas. Ela existe para impedir retomada arbitrária: sem etapa discriminada, uma
continuação com catálogo e vínculos já obtidos não distinguiria "falta resolver
duração" de "falta gerar opções".

Regras:

- **as etapas representam somente pontos reais de retomada entre chamadas** — a ordem
  determinística tem 27 passos (seção 13), e a maioria deles não é uma etapa: passos
  executados em sequência dentro da mesma chamada nunca produzem continuação, portanto
  nunca precisam de etapa própria;
- nem toda etapa ocorre em toda conversa — uma conversa que já tem procedimento
  resolvido nunca registra `resolvendo_procedimento`;
- as etapas `aguardando_*` sempre têm requisição pendente; as etapas `resolvendo_*`
  nomeiam o resolvedor que roda assim que a máquina retoma;
- **o orquestrador nunca escolhe a próxima etapa** — ele devolve a continuação que
  recebeu, acrescida de no máximo uma resposta correlacionada. **A máquina é a única
  autoridade para produzir a próxima continuação**, e portanto a única autoridade sobre
  a etapa seguinte;
- uma continuação cuja etapa seja incompatível com seu próprio conteúdo (por exemplo,
  `aguardando_persistencia_final` sem `resultado_candidato`) produz falha fechada
  (seção 20).

### Dados condicionais aceitos

Forma mínima de cada resposta já validada e incorporada (`C2`, seção 5) — **pseudotipo,
não implementação**:

```text
interface DadoCondicionalAceitoV1 {
  readonly requisicao_id: string;
  readonly tipo: TipoDadoCondicionalV1;
  readonly versao_origem: string;
  readonly dado: DadoCondicionalV1;
}
```

As regras de acumulação e de invalidação interna destes dados estão na seção 12
("Acumulação e invalidação dos dados condicionais aceitos"), junto do catálogo que os
origina.

### Resultado candidato

Forma mínima do resultado já decidido, mas ainda não persistido nem devolvido (`C3`,
seção 5) — **pseudotipo, não implementação**:

```text
interface FalhaDominioPersistivelComposicaoV1 {
  readonly tipo: 'falha_fechada';
  readonly codigo:
    | 'contrato_horario_exato_com_restricao_nao_suportado';
  readonly natureza: 'dominio_persistivel';
  readonly fatos_autorizados: Readonly<Record<string, unknown>>;
}

type ResultadoTerminalCandidatoV1 =
  | DecisaoComposicaoV1
  | FalhaDominioPersistivelComposicaoV1;

interface ResultadoCandidatoComposicaoV1 {
  readonly resultado_id: string;
  readonly estado_final_proposto: EstadoNovoAgendamentoV1;
  readonly resultado_logico: RegistroResultadoComposicao;
  readonly resultado_terminal: ResultadoTerminalCandidatoV1;
  readonly fatos_autorizados: Readonly<Record<string, unknown>>;
  readonly versao_estado_origem: string;
}
```

**O candidato preserva um resultado terminal, não apenas uma decisão — mas nunca
qualquer `FalhaFechadaComposicaoV1`.** `ResultadoTerminalCandidatoV1` é uma união
**estreita**, deliberadamente menor que a união completa de falhas fechadas (seção 20):

- `DecisaoComposicaoV1` — qualquer pausa comum (comando + fatos), a mesma como sempre;
- `FalhaDominioPersistivelComposicaoV1` — **somente** as falhas de domínio já
  explicitamente marcadas como persistíveis (seção 20, "Falhas de domínio persistíveis
  vs. falhas estruturais internas"); hoje, um único código:
  `contrato_horario_exato_com_restricao_nao_suportado`. O campo `codigo` é uma união
  fechada de **um** elemento agora — **o catálogo só cresce por alteração documental
  aprovada em rodada própria**, nunca por inferência ou por extensão implícita a partir
  de `CodigoFalhaComposicao` (seção 20).

**Nunca integram `ResultadoTerminalCandidatoV1`** (seção 20, "Falhas de domínio
persistíveis vs. falhas estruturais internas"):

- as sete **falhas estruturais internas** de correlação e continuidade
  (`continuacao_incompativel`, `resposta_sem_requisicao`,
  `resposta_nao_corresponde_requisicao`, `tipo_resposta_incompativel`,
  `efeito_confirmado_incompativel`, `resultado_candidato_ausente`,
  `resultado_id_incompativel`) — elas encerram a chamada antes de haver qualquer
  resultado a preservar (seção 11, "Persistência antes da decisão terminal");
- `conflito_versao` — falha da própria escrita, não persistível (seção 20, "Nova
  classificação de `conflito_versao`").

As duas são `FalhaFechadaComposicaoV1` (seção 11, "Resultado" — a variante que a
função pode devolver diretamente), mas **nenhuma delas é**
`FalhaDominioPersistivelComposicaoV1` — `FalhaFechadaComposicaoV1` continua sendo a
união **ampla** que a função devolve como resultado da chamada;
`ResultadoTerminalCandidatoV1` é a união **estreita** que o candidato pode preservar.
As duas nunca são a mesma coisa, e esta especificação nunca usa uma no lugar da outra.

Os três campos de resultado têm funções **distintas e não redundantes** — nenhum deles
carrega uma segunda cópia divergente do mesmo fato:

| Campo | Função | Quem consome |
|---|---|---|
| `resultado_logico` | projeção **mínima persistível** do que foi decidido (comando ou falha de domínio persistível, versões, identidades) — é o que fica registrado para tornar possível o replay externo de uma repetição futura da mesma mensagem | persistência (seção 13, passo 24) e, depois, o replay do orquestrador (seção 17) |
| `resultado_terminal` | o **valor devolvido** ao orquestrador quando a persistência for confirmada — comando do catálogo fechado (`composicao-novo-agendamento-v1.md` §8) **ou** `FalhaDominioPersistivelComposicaoV1` | orquestrador, ao encerrar o turno (seção 13, passo 25) |
| `fatos_autorizados` | **fonte única**, no nível do candidato, dos fatos que a porta de redação pode ver (seção 18) — sempre igual aos fatos que o próprio `resultado_terminal` carrega (opacamente, dentro de `DecisaoComposicaoV1`, ou explicitamente, dentro de `FalhaDominioPersistivelComposicaoV1.fatos_autorizados`), nunca uma segunda cópia que possa divergir | porta de redação (seção 13, passo 26) |

Regras:

- **criado somente quando o resultado já está fechado** (seção 13, passo 23) — nunca
  especulativamente, nunca "por precaução" antes de a composição ter concluído;
- **armazenado na continuação antes** da requisição de persistência final;
- **não é ainda resultado oficial** — não autoriza redação, não autoriza envio, não
  altera o estado oficial;
- **não pode ser alterado depois** da solicitação de persistência — a continuação é
  imutável, e a máquina nunca produz uma continuação com `resultado_id` igual e conteúdo
  diferente;
- a confirmação do efeito final deve apontar para o mesmo `resultado_id` (seção 12);
- **após confirmação compatível, a máquina retorna exatamente `resultado_terminal`** —
  nenhum resolvedor é reexecutado, nenhum passo de domínio é refeito para reconstruir o
  resultado (`C3`), **seja ele uma decisão ou uma `FalhaDominioPersistivelComposicaoV1`**;
- `conflito_versao` na persistência final **invalida o candidato** — o resultado
  preservado não é devolvido, e uma nova falha fechada (`conflito_versao`, falha da
  própria escrita, não persistível — seção 20, "Nova classificação de
  `conflito_versao`") é o resultado do turno;
- **falhas estruturais internas e `conflito_versao`** (seção 20) **nunca** ocupam
  `resultado_terminal` — nenhuma das duas categorias chega a ter um candidato
  preservado: as falhas estruturais porque encerram a chamada antes de haver algo a
  preservar; `conflito_versao` porque é a própria escrita do candidato que falhou.

### Entrada

`EntradaAvancoComposicaoV1` reúne, a cada chamada: o contexto determinístico; o estado
oficial vigente e sua versão; a interpretação já validada; a continuação devolvida pela
chamada anterior (ausente somente na primeira chamada de um turno); e, quando houver
requisição pendente, exatamente uma resposta correlacionada. Forma exata — pseudotipo,
não implementação:

```text
interface EntradaAvancoComposicaoV1 {
  readonly contexto: ContextoDeterministicoComposicaoV1;
  readonly estado_oficial: EstadoNovoAgendamentoV1;
  readonly versao_estado: string;
  readonly interpretacao: InterpretacaoValidadaAtual;   // SaidaInterpretacaoModeloV2 já validada, seção 6

  readonly continuacao?: ContinuacaoComposicaoV1;

  readonly resposta_condicional?:
    | RespostaDadoCondicionalV1        // seção 12
    | RespostaEfeitoComposicaoV1;      // seção 12
}
```

Regras fechadas:

- a **primeira** chamada de um turno não possui `continuacao` nem `resposta_condicional`;
- toda chamada **subsequente** deve possuir `continuacao`;
- `resposta_condicional` só pode existir se a continuação tiver `requisicao_pendente`;
- a resposta deve corresponder **exatamente** à requisição pendente (identidade, origem
  e tipo — `C4`, seção 12);
- **nunca duas respostas na mesma chamada** — no máximo uma;
- **nunca resposta sem requisição pendente**;
- **nunca continuação de outra clínica, conversa, mensagem ou versão de estado** —
  **exceto** a transição legítima e fechada descrita em "Transição legítima após a
  persistência intermediária" ("Protocolo de continuidade entre chamadas", abaixo), a
  única mudança de versão que a máquina aceita;
- a **interpretação não é reprocessada nem substituída entre chamadas** — a IA é chamada
  uma única vez por mensagem, antes da primeira chamada da máquina (seção 13, passo 4);
- `contexto` continua vindo exclusivamente de fontes autenticadas, nunca da IA
  ("Contexto determinístico", acima).

#### Por que `estado_oficial` e `interpretacao` permanecem em todas as chamadas

Poderiam, em tese, viver apenas dentro da continuação. **Permanecem na entrada**, por
duas razões: mantêm a função verificável a cada chamada (ela pode conferir que o mundo
não mudou sob seus pés) e mantêm o determinismo auditável (a mesma entrada completa
produz o mesmo resultado, sem depender de um campo escondido).

Para que essa duplicação não vire uma segunda autoridade, a continuação registra
`identidade_entrada` — identidades estáveis do `estado_oficial` e da `interpretacao`
recebidos na chamada que a produziu:

- a cada chamada subsequente, a máquina compara a identidade do que recebeu com a
  registrada na continuação;
- **divergência produz falha fechada** (`continuacao_incompativel`, seção 20) — nunca
  uma reconciliação silenciosa, nunca "a versão mais nova vence" — **exceto** dentro da
  transição legítima e fechada ("Protocolo de continuidade entre chamadas", abaixo),
  que substitui a comparação de identidade por oito condições verificáveis, todas
  simultâneas;
- a comparação é sobre **identidade estável** (hash ou equivalente determinístico),
  **nunca comparação textual informal** de campo a campo;
- o algoritmo concreto que produz essas identidades **não é escolhido aqui** — nem
  função de hash, nem formato, nem codificação (`P4`, seção 22).

### Resultado

Resultado, união fechada de **quatro** famílias:

```text
type ResultadoAvancoComposicaoV1 =
  | DecisaoComposicaoV1
  | NecessitaDadosComposicaoV1
  | NecessitaEfeitoComposicaoV1
  | FalhaFechadaComposicaoV1;
```

**Todo resultado não terminal contém a continuação** que a próxima chamada deve receber
integralmente (`C1`):

```text
readonly continuacao: ContinuacaoComposicaoV1;
```

- `DecisaoComposicaoV1` — resultado **terminal** desta passagem do turno: um comando do
  catálogo fechado já publicado (`composicao-novo-agendamento-v1.md` §8), acompanhado
  dos fatos autorizados correspondentes — os mesmos `fatos_autorizados` preservados no
  resultado candidato ("Resultado candidato", acima), nunca uma segunda cópia com
  valores próprios. Corresponde a qualquer uma das 18 pausas já catalogadas naquela
  spec (§12), incluindo `solicitar_confirmacao` como a última possível. **Só é produzida
  na etapa `pronto_para_decisao_terminal`**, e é exatamente o `resultado_terminal` do
  resultado candidato já persistido, quando esse resultado terminal é uma decisão (`C3`)
  — ver "Persistência antes da decisão terminal" abaixo. Não carrega continuação: o
  turno acabou;
- `NecessitaDadosComposicaoV1` — requisição de **leitura** de um dado condicional
  (seção 12) — contém a continuação e a requisição pendente; a função para aqui, o
  orquestrador busca o dado, e chama de novo com a continuação e a resposta;
- `NecessitaEfeitoComposicaoV1` — requisição de **escrita** de um efeito autorizado
  (seção 12): persistência atômica do estado interpretado já coerente (seção 13, passo
  9) ou persistência atômica do estado final e do resultado lógico (seção 13, passo
  24) — contém a continuação e a requisição pendente; a função para aqui, o
  orquestrador executa a escrita, e chama de novo com a continuação e a resposta;
- `FalhaFechadaComposicaoV1` — falha técnica fechada e **terminal para a chamada**, com
  motivo do catálogo já existente ou estendido por esta especificação (seção 20). Não
  carrega continuação reutilizável: uma falha fechada encerra a passagem do turno, e a
  próxima mensagem recomeça pelo protocolo normal (seção 17). **Três origens
  distintas**, detalhadas em "Falhas de domínio persistíveis vs. falhas estruturais
  internas" e "Nova classificação de `conflito_versao`" (seção 20):
  - **falha estrutural interna** — qualquer violação de correlação/continuidade (`C4`,
    os sete códigos da seção 20) — é devolvida **diretamente**, sem candidato: a
    correlação que falhou já é o sinal terminal, não há resultado bem-sucedido
    pendente de persistir antes dela;
  - **falha da própria escrita, não persistível** — `conflito_versao` na própria
    requisição de persistência (seção 13, passos 9 ou 24) — também devolvida
    **diretamente**: é a escrita que falhou, não um resultado de domínio a preservar;
  - **falha de domínio persistível** — um motivo de domínio (seção 20) alcançado
    durante os passos 11 a 22 (hoje, exclusivamente
    `contrato_horario_exato_com_restricao_nao_suportado`) — é um resultado candidato
    como qualquer pausa: preservada como `FalhaDominioPersistivelComposicaoV1` em
    `resultado_candidato.resultado_terminal` (`ResultadoTerminalCandidatoV1`, união
    **estreita**, seção 11) e devolvida somente depois dos passos 23–25. Nenhuma outra
    `FalhaFechadaComposicaoV1` integra essa união — apenas as falhas explicitamente
    marcadas como persistíveis.

**Replay não integra esta união** (`C5`, seção 5). `ReplayComposicaoV1` continua
existindo como resultado **externo do orquestrador** — ver seção 17, "Autoridade única
do replay".

### Persistência antes da decisão terminal

**Nenhuma variante terminal — `DecisaoComposicaoV1`, ou `FalhaDominioPersistivelComposicaoV1`
(não `conflito_versao`, nem violação de correlação) — é devolvida ao orquestrador antes
de o par estado-final/resultado-lógico que a representa já estar confirmado como
persistido.** Especificamente:

- a função **nunca** monta e devolve um resultado terminal de motivo de domínio na
  mesma chamada em que ainda não recebeu a confirmação do efeito de persistência final
  (seção 13, passos 23–25);
- a sequência correta é: a função conclui internamente qual seria o resultado e o
  preserva como `resultado_candidato` na continuação (passo 23, `C3`), devolve
  `NecessitaEfeitoComposicaoV1` pedindo a persistência atômica desse par (passo 24), e
  **somente na chamada seguinte**, já com a `RespostaEfeitoComposicaoV1` presente,
  `confirmado` e validada contra a requisição pendente e contra o `resultado_id`,
  devolve o resultado terminal (passo 25);
- **o resultado devolvido é exatamente o `resultado_terminal` preservado** — nunca um
  resultado recomputado que poderia divergir do que foi persistido (`C3`); isso vale
  igualmente para uma decisão (`DecisaoComposicaoV1`) e para uma falha de domínio
  persistível (`FalhaDominioPersistivelComposicaoV1`);
- isso vale **para as 18 pausas, para `solicitar_confirmacao`, e para toda falha fechada
  de domínio, igualmente** — nenhuma é exceção; todas passam pela mesma persistência
  final antes de se tornarem um resultado devolvido ao orquestrador;
- a motivação é crash-safety: se o processo falhar depois que o paciente já recebeu uma
  resposta, mas antes de o resultado estar persistido, uma repetição da mesma mensagem
  não teria como saber que uma decisão já foi tomada — reprocessaria do zero e poderia
  produzir uma decisão diferente (por exemplo, se o estado mudou nesse intervalo).
  Persistir **antes** de devolver garante que, a partir do momento em que o paciente
  pode ter recebido uma resposta, o resultado que a originou já é recuperável por
  replay (Caso A, seção 17), nunca recomputado;
- este requisito não resolve a atomicidade física do par estado/resultado (`P4`) — ele
  fixa somente a ordem lógica: a requisição de persistência acontece antes da decisão
  terminal, sempre, sem exceção.

### Concorrência divergente fora do conhecimento da função

**A máquina pura não tenta detectar se outra execução concorrente já aceitou conteúdo
diferente para a mesma identidade.** Esta é uma decisão fechada, não uma lacuna:

- **D3** ("Resposta de dado condicional" e "Resposta de efeito", seção 12) fica
  limitado às divergências que podem ser verificadas **diretamente** entre a requisição
  pendente presente na continuação e a resposta recebida na chamada atual — nunca
  contra uma resposta anterior, um histórico de respostas já processadas, ou qualquer
  registro externo a esta chamada;
- a máquina pode validar: `requisicao_id` ou `efeito_id`; `continuacao_id`;
  `clinica_id`; `conversa_id`; `message_id`; `versao_origem`; o `tipo` solicitado; o
  formato discriminado da resposta; os campos obrigatórios de cada variante;
  `resultado_id`, quando aplicável; e a consistência da resposta com os parâmetros
  fechados da requisição (seção 12);
- **a máquina não pode afirmar que "outro conteúdo já foi aceito anteriormente" quando
  essa evidência não estiver na entrada** — essa afirmação exigiria memória que a
  máquina, por contrato, não possui;
- **esta especificação não adiciona**: fingerprint de resposta aceita; histórico de
  respostas processadas; identidade de resposta separada da identidade da requisição;
  registro idempotente externo; memória implícita; cache; ou estado global. Nenhum
  destes é necessário para D1, D2 ou D3, exatamente como definidos (seção 12) — e
  nenhum é introduzido apenas para tornar D3 "mais completo";
- a **detecção física** de duas respostas concorrentes divergentes para a mesma
  requisição — qual delas foi fisicamente aceita, e o que fazer com a outra —
  permanece em `P4` (seção 22), junto da persistência e da idempotência concretas.

**Duas chamadas concorrentes podem partir da mesma continuação pendente e receber
respostas distintas que sejam, cada uma isoladamente, compatíveis com a requisição.**
Nesse cenário, a função pura:

- processa cada entrada **isoladamente** — cada chamada é avaliada só contra sua
  própria entrada, nunca contra a outra;
- permanece **determinística para cada entrada** — a mesma entrada produz sempre o
  mesmo resultado, mesmo que duas entradas diferentes, ambas válidas, produzam
  resultados diferentes entre si;
- **não sabe** qual das duas respostas foi aceita fisicamente;
- **não escolhe vencedora** entre as duas;
- **não reconcilia** as duas respostas;
- **não declara divergência histórica sem evidência** — se as duas respostas, cada
  uma isoladamente, satisfazem as verificações de D1/D3 contra a requisição pendente,
  a máquina aceita cada uma na chamada em que chegou, sem comparar uma com a outra.

**A futura camada física (`P4`) deverá garantir**, fora do escopo desta especificação:
aceitação idempotente; CAS ou mecanismo equivalente; no máximo um avanço oficial para
cada requisição; e rejeição ou recuperação determinística da execução perdedora. Esta
seção **não define** tabela, RPC, transação ou algoritmo para essa garantia — apenas
registra que ela pertence a `P4`, nunca à função pura.

### Protocolo de continuidade entre chamadas

Sequência explícita de uma passagem de turno (`C1`–`C4`). Cada item descreve uma chamada
completa da função pura:

**Primeira chamada** — recebe contexto, estado oficial, versão e interpretação; nenhuma
continuação, nenhuma resposta. Avança pela ordem determinística (seção 13) até precisar
de um dado, de um efeito, ou até ter uma decisão terminal a produzir. Se precisar parar,
retorna a primeira continuação, com etapa e requisição pendente.

**Chamada após uma leitura** — recebe a continuação anterior íntegra e exatamente uma
`RespostaDadoCondicionalV1` (seção 12). A máquina valida a correlação (`C4`), incorpora
o dado aceito a `dados_condicionais_aceitos`, remove a requisição pendente, e avança
usando **todos** os dados acumulados (`C2`) — nunca apenas o mais recente.

**Chamada após a persistência intermediária** — recebe a continuação e a
`RespostaEfeitoComposicaoV1` (seção 12). A máquina valida a resposta contra a transição
legítima fechada abaixo; fora dela, **qualquer** `estado_oficial`, `versao_estado` ou
origem diferentes dos já registrados na continuação produzem `continuacao_incompativel`
— não existe uma segunda forma, implícita, de a máquina aceitar um estado que ela
própria não propôs.

### Transição legítima após a persistência intermediária

Esta é a **única** mudança legítima de identidade e de versão entre duas chamadas — a
formalização verificável do que a subseção acima resume como "atualiza a versão
oficial". Aplica-se somente quando a continuação está na etapa
`aguardando_persistencia_intermediaria` e possui uma `requisicao_pendente` do tipo
`persistir_estado_interpretado`. A chamada seguinte pode trazer `estado_oficial` e
`versao_estado` diferentes dos registrados em `identidade_entrada`/`origem` **somente
quando todas** as condições abaixo são verdadeiras:

```text
1. resposta_condicional.resultado === 'confirmado'
2. resposta_condicional.efeito_id === requisicao_pendente.efeito_id
3. resposta_condicional.continuacao_id === continuacao.continuacao_id
   E resposta_condicional.clinica_id === continuacao.origem.clinica_id
   E resposta_condicional.conversa_id === continuacao.origem.conversa_id
   E resposta_condicional.message_id === continuacao.origem.message_id
4. resposta_condicional.versao_origem === requisicao_pendente.versao_esperada
5. entrada.versao_estado === resposta_condicional.versao_estado_resultante
6. entrada.estado_oficial é semanticamente idêntico a
   requisicao_pendente.estado_proposto
7. requisicao_pendente.tipo === 'persistir_estado_interpretado'
8. resposta_condicional não carrega resultado_id
```

Quando as oito condições são verdadeiras, a máquina:

- aceita a transição;
- **atualiza** `origem.versao_estado_origem` e `identidade_entrada.estado_oficial` na
  nova continuação, para refletir o estado e a versão recém-confirmados;
- **remove** a `requisicao_pendente`;
- **atualiza** `estado_trabalho` para o novo estado oficial;
- **invalida**, dentro de `dados_condicionais_aceitos`, todo dado vinculado a uma
  `versao_origem` incompatível com a nova versão (seção 12, "Acumulação e invalidação
  dos dados condicionais aceitos");
- **continua** a partir da etapa que ela própria determinar — nunca de uma etapa
  escolhida pelo orquestrador.

**Fora desta exceção fechada — as oito condições acima, todas simultaneamente — qualquer
mudança de `estado_oficial`, de `versao_estado` ou de origem entre duas chamadas produz
`continuacao_incompativel`** (seção 20). Isso vale mesmo quando a mudança "parece"
compatível: a transição só é aceita quando as oito condições são verificadas, nunca por
semelhança ou por confiança implícita na entrada.

**Igualdade semântica (condição 6) não é comparação textual, e seu algoritmo não é
definido nesta rodada.** "Semanticamente idêntico" significa o mesmo estado lógico,
independentemente de formatação ou de ordem de campos irrelevante à semântica — nunca
comparação byte a byte do texto serializado. O mecanismo concreto — representação
canônica, identidade determinística, ou equivalente — é decisão de implementação futura,
com sua própria rodada de aprovação (`P4`, seção 22); esta especificação exige apenas
que a comparação seja determinística, a mesma disciplina já fixada para
`identidade_entrada` (seção 11, "Por que `estado_oficial` e `interpretacao` permanecem
em todas as chamadas").

**Chamada após a persistência final** — recebe a continuação (com `resultado_candidato`)
e a resposta do efeito. A máquina valida efeito, origem e `resultado_id`; **não
recalcula nada**; retorna exatamente o `resultado_terminal` preservado (`C3`) — decisão
ou falha fechada de domínio, conforme o que foi preservado.

**Replay** — ocorre **antes** de qualquer uma dessas chamadas, e é responsabilidade
exclusiva do orquestrador (`C5`, seção 17). Nenhuma continuação é criada durante um
replay, porque a função pura não é chamada.

### Propriedades obrigatórias da função

- recebe **somente dados** — nenhum cliente de banco, nenhum cliente HTTP, nenhuma
  função de callback com acesso irrestrito;
- **não é `async`** — não existe I/O para aguardar dentro dela;
- **não executa efeitos** — toda escrita é uma requisição devolvida, nunca uma ação
  executada;
- **pode ser chamada repetidamente**, dentro do mesmo turno, cada vez com a continuação
  anterior e no máximo uma resposta correlacionada, até alcançar um resultado terminal;
- **é determinística** — a mesma `EntradaAvancoComposicaoV1` (contexto, estado,
  interpretação, continuação e resposta) produz sempre o mesmo
  `ResultadoAvancoComposicaoV1`;
- **é a única autoridade sobre a continuação** — produz cada nova continuação, e nunca
  aceita uma continuação alterada pelo orquestrador;
- **nunca muta a continuação recebida** — mesma disciplina de pureza já exigida dos
  cinco componentes de domínio publicados;
- **não mantém estado global** — toda a continuidade entre chamadas vive explicitamente
  em `ContinuacaoComposicaoV1`, nunca em variável estática, cache implícito ou closure
  com estado mutável (`C1`).

### O que esta função nunca reimplementa

Esta função **não reimplementa** o algoritmo de nenhum dos cinco componentes de
domínio, nem a lógica de eventos do controlador conversacional. Ela **orquestra**:
decide a ordem de chamada (seção 13), monta a entrada de cada componente com dados já
obtidos, e trata o resultado — exatamente a mesma responsabilidade já descrita em
`composicao-novo-agendamento-v1.md` §9–§13, agora formalizada como função pura sem
I/O direto.

## 12. Dados condicionais

Catálogo fechado de requisições que a função pura (seção 11) pode emitir. Cada
requisição corresponde a exatamente um dos dados condicionais já reconhecidos em
`composicao-novo-agendamento-v1.md` §4.2, mais o estado de operação idempotente,
próprio desta especificação:

- catálogo de procedimentos (e aliases) da clínica;
- vínculos de dentistas aptos, para um procedimento já resolvido;
- configuração de duração, para um procedimento já resolvido;
- snapshot diário de agenda (jornadas + indisponibilidades), para um dentista e uma
  data;
- revalidação de uma opção antes de compor o resumo (mesma checagem técnica interna já
  descrita em `../docs/04-decisoes-canonicas.md`, "A revalidação do horário antes da
  criação é técnica");
- estado de operação idempotente (`persistencia-v1.md` §21) — para localizar um
  replay já registrado, ou abrir uma nova operação.

### Cabeçalho de identidade — comum a leituras e escritas

Toda requisição emitida pela máquina, de leitura ou de escrita, carrega o mesmo
cabeçalho de correlação (`C4`, seção 5) — **pseudotipo, não implementação**:

```text
interface CabecalhoRequisicaoComposicaoV1 {
  readonly requisicao_id: string;
  readonly continuacao_id: string;
  readonly clinica_id: string;
  readonly conversa_id: string;
  readonly message_id: string;
  readonly versao_origem: string;
}
```

A identidade (`requisicao_id`) deve ser:

- **produzida deterministicamente pelo Core** — a mesma requisição lógica, na mesma
  continuação, produz sempre a mesma identidade;
- **estável** para a mesma requisição lógica — reemitir a mesma requisição não gera uma
  identidade nova;
- **nunca fornecida pela IA**;
- **nunca inventada pelo adaptador** — o adaptador ecoa a identidade que recebeu, nunca
  cria uma.

**O algoritmo concreto não é definido nesta rodada** — nenhuma função criptográfica,
nenhum formato físico, nenhuma codificação (`P4`, seção 22).

### Requisições de leitura

Forma mínima de cada requisição de dado condicional — pseudotipo, não implementação:

```text
interface RequisicaoDadoCondicionalV1 extends CabecalhoRequisicaoComposicaoV1 {
  readonly tipo: TipoDadoCondicionalV1; // discriminador fechado, um por item da lista acima
  readonly parametros: Readonly<Record<string, unknown>>; // mínimo exigido por esse tipo
  readonly motivo: MotivoRequisicaoFechado; // por que este dado é necessário agora
}
```

A resposta do adaptador — obtida pelo orquestrador, nunca pela função pura — retorna
como `resposta_condicional` da **próxima** `EntradaAvancoComposicaoV1` (seção 11),
acompanhada da continuação. A função pura nunca aguarda a resposta; ela sempre retorna e
é chamada de novo.

### Resposta de dado condicional

União discriminada — **pseudotipo, não implementação**:

```text
type RespostaDadoCondicionalV1 =
  | {
      readonly resultado: 'obtido';
      readonly requisicao_id: string;
      readonly continuacao_id: string;
      readonly clinica_id: string;
      readonly conversa_id: string;
      readonly message_id: string;
      readonly versao_origem: string;
      readonly tipo: TipoDadoCondicionalV1;
      readonly dado: DadoCondicionalV1;
    }
  | {
      readonly resultado: 'falha';
      readonly requisicao_id: string;
      readonly continuacao_id: string;
      readonly clinica_id: string;
      readonly conversa_id: string;
      readonly message_id: string;
      readonly versao_origem: string;
      readonly tipo: TipoDadoCondicionalV1;
      readonly codigo: CodigoFalhaAdaptadorV1;
    };
```

Regras fechadas — todas as verificações abaixo comparam a resposta recebida
**exclusivamente contra a requisição pendente presente na entrada corrente**, nunca
contra uma resposta anterior, um histórico ou qualquer memória fora da continuação
(seção 11, "Concorrência divergente fora do conhecimento da função"):

- a resposta deve corresponder à **requisição pendente** registrada na continuação —
  `requisicao_id`, `continuacao_id` e a origem completa (`clinica_id`, `conversa_id`,
  `message_id`, `versao_origem`) devem coincidir;
- o `tipo` da resposta deve corresponder ao `tipo` solicitado — resposta de catálogo
  para uma requisição de snapshot é incompatível, ainda que a identidade coincida;
- a resposta deve ser **consistente com os parâmetros fechados da requisição**
  (`parametros`, `RequisicaoDadoCondicionalV1`) — quando o formato de `DadoCondicionalV1`
  permite a verificação estrutural (por exemplo, os identificadores de dentista e data
  que o próprio dado carrega), esses identificadores devem corresponder aos
  `parametros` que a requisição pendente já fixou;
- resposta aceita é **incorporada** a `dados_condicionais_aceitos` (seção 11), e a
  requisição **deixa de estar pendente**;
- uma resposta **nunca substitui** um dado anterior de outra identidade — dados aceitos
  saem da continuação apenas por invalidação (seção 12, "Acumulação e invalidação"),
  nunca por sobrescrita;
- **Caso D1 — reexecução integral idêntica**: mesma continuação anterior, mesma
  requisição **ainda pendente**, mesma resposta, mesmo contexto, mesmo estado, mesma
  versão. Produz exatamente o mesmo resultado — determinismo normal da função pura;
  nenhum avanço oficial duplo é inferido pela função (o avanço oficial pertence à
  persistência, `P4`, nunca a esta chamada isolada);
- **Caso D2 — resposta contra continuação posterior**: a resposta é reapresentada com
  uma continuação **posterior**, na qual a requisição correspondente **já não está
  pendente**. **Nunca é reaceita**, mesmo sendo, byte a byte, a mesma resposta de antes.
  Produz `resposta_sem_requisicao` (seção 20) — nunca tratada como duplicata válida,
  porque a continuação corrente não tem requisição alguma à qual correlacioná-la;
- **Caso D3 — divergência verificável contra a requisição pendente**: a continuação
  **ainda possui** a requisição pendente, mas a resposta diverge de um campo
  **verificável diretamente contra essa requisição ou sua origem** — identidade
  diferente, origem diferente, versão diferente, `tipo` diferente, ou conteúdo que
  viole os parâmetros fechados e verificáveis da requisição (regra acima). Produz
  `resposta_nao_corresponde_requisicao` (identidade ou origem) ou
  `tipo_resposta_incompativel` (tipo), conforme o campo divergente (seção 20). **D3
  nunca significa comparar a resposta atual com outra resposta aceita em execução
  anterior** — a máquina não possui, e não guarda, esse histórico (ver seção 11);
- **resposta incompatível produz falha fechada** (seção 20), nunca aceitação parcial —
  englobando D2 e D3 acima;
- nenhum dado aceito depende de memória externa implícita — se não está na continuação,
  não existe para a máquina (`C1`).

`CodigoFalhaAdaptadorV1` é um catálogo fechado de motivos técnicos do adaptador.
**Nenhum adaptador e nenhum catálogo físico de falhas é criado nesta rodada** — apenas o
lugar contratual onde esse código chega à máquina.

### Acumulação e invalidação dos dados condicionais aceitos

A continuação acumula **somente** respostas que foram: solicitadas pela própria máquina;
validadas; aceitas; e ainda relevantes para a etapa atual (`C2`).

Invalidação interna — um dado aceito é **removido** da continuação quando deixa de ser
relevante:

| Mudança | Dados condicionais invalidados |
|---|---|
| Procedimento | catálogo derivado, vínculos, configuração de duração e snapshots dependentes |
| Dentista | vínculos selecionados e snapshots dependentes |
| Fato temporal (qualquer categoria, seção 6) | snapshots |
| Nova versão do estado oficial | todo dado vinculado a uma `versao_origem` incompatível |

- **dados invalidados são removidos da continuação** — não ficam marcados como obsoletos
  nem "disponíveis por precaução";
- **nenhum dado obsoleto sobrevive apenas porque foi obtido antes** — a antiguidade de
  uma leitura nunca é argumento para reaproveitá-la;
- esta tabela governa **os dados condicionais dentro da continuação**, e é a contraparte,
  no plano da continuidade, da matriz de invalidação do **estado** (seção 10) — as duas
  nunca se contradizem: quando a seção 10 invalida um derivado do estado, os dados
  condicionais que só existiam para produzi-lo perdem a relevância aqui;
- **nenhuma regra interna dos cinco componentes de domínio é duplicada** — esta seção
  decide apenas o que continua na continuação, nunca como cada componente calcula.

### Requisições de efeito (escrita)

As duas únicas requisições de escrita que a função pura emite — persistência do estado
interpretado coerente (seção 13, passo 9) e persistência do estado final e do
resultado lógico (seção 13, passo 24) — usam uma forma própria, distinta de
`RequisicaoDadoCondicionalV1`, porque a resposta esperada é uma confirmação, um conflito
de versão ou uma falha, nunca um dado de leitura. Forma mínima — pseudotipo, não
implementação:

```text
interface RequisicaoEfeitoComposicaoV1 extends CabecalhoRequisicaoComposicaoV1 {
  readonly efeito_id: string;
  readonly tipo: 'persistir_estado_interpretado' | 'persistir_resultado_final';
  readonly estado_proposto: EstadoNovoAgendamentoV1;
  readonly resultado_logico?: RegistroResultadoComposicao; // somente na persistência final
  readonly resultado_id?: string;                          // somente na persistência final
  readonly versao_esperada: string;
}
```

- `efeito_id` identifica **esta** requisição de escrita; `requisicao_id` (do cabeçalho)
  mantém a mesma disciplina de correlação das leituras — as duas identidades coexistem
  para que uma escrita seja rastreável tanto como requisição quanto como efeito;
- `resultado_logico` e `resultado_id` existem **somente** na persistência final, e vêm
  do resultado candidato já preservado na continuação (`C3`, seção 11);
- `versao_esperada` é a versão contra a qual o CAS deve ser aplicado;
- uma `RespostaEfeitoComposicaoV1` `confirmado` para `tipo:
  'persistir_estado_interpretado'` é exatamente a resposta que habilita a transição
  legítima de versão (seção 11, "Transição legítima após a persistência intermediária")
  — as oito condições ali descritas comparam campos desta requisição e desta resposta
  contra a próxima entrada; nenhuma outra combinação de campos autoriza a transição;
- esta forma **não define** o mecanismo físico de CAS, transação, RPC ou tabela — apenas
  o contrato lógico da requisição (`P4`).

### Resposta de efeito

União discriminada — **pseudotipo, não implementação**:

```text
type RespostaEfeitoComposicaoV1 =
  | {
      readonly resultado: 'confirmado';
      readonly efeito_id: string;
      readonly continuacao_id: string;
      readonly clinica_id: string;
      readonly conversa_id: string;
      readonly message_id: string;
      readonly versao_origem: string;
      readonly versao_estado_resultante: string;
      readonly resultado_id?: string;
    }
  | {
      readonly resultado: 'conflito_versao';
      readonly efeito_id: string;
      readonly continuacao_id: string;
      readonly clinica_id: string;
      readonly conversa_id: string;
      readonly message_id: string;
      readonly versao_origem: string;
      readonly versao_estado_atual?: string;
      readonly resultado_id?: string;
    }
  | {
      readonly resultado: 'falha';
      readonly efeito_id: string;
      readonly continuacao_id: string;
      readonly clinica_id: string;
      readonly conversa_id: string;
      readonly message_id: string;
      readonly versao_origem: string;
      readonly codigo: CodigoFalhaEfeitoV1;
      readonly resultado_id?: string;
    };
```

Regras fechadas:

- `versao_estado_resultante` existe **somente** na variante `confirmado` — uma escrita
  que não aconteceu não produz versão resultante;
- `conflito_versao` **nunca inventa** estado resultante; `versao_estado_atual` é
  opcional e informativo, e nunca é promovido a versão oficial pela máquina;
- **todas as variantes ecoam `versao_origem`** e a origem completa;
- a persistência final confirmada deve ecoar o `resultado_id` do candidato preservado
  (`C3`) — confirmação final sem `resultado_id`, ou com `resultado_id` divergente,
  produz falha fechada (seção 20);
- **resposta incompatível falha fechado**, nunca aplicação parcial. Toda verificação
  abaixo compara a confirmação recebida **exclusivamente contra o efeito pendente
  presente na entrada corrente** — nunca contra uma confirmação anterior, um histórico,
  ou qualquer memória fora da continuação (seção 11, "Concorrência divergente fora do
  conhecimento da função");
- **Caso D1 — reexecução integral idêntica**: mesma continuação anterior, mesmo efeito
  **ainda pendente**, mesma confirmação, mesmo contexto, mesmo estado, mesma versão.
  Produz exatamente o mesmo resultado — determinismo normal da função pura; nenhum
  avanço oficial duplo é inferido pela função;
- **Caso D2 — confirmação contra continuação posterior**: a confirmação é reapresentada
  com uma continuação **posterior**, na qual o efeito correspondente **já não está
  pendente** (transição já aplicada ou resultado já liberado). **Nunca é reaplicada**,
  mesmo sendo a mesma confirmação de antes. Produz `efeito_confirmado_incompativel`
  (seção 20) — nunca tratada como duplicata válida;
- **Caso D3 — divergência verificável contra o efeito pendente**: a continuação **ainda
  possui** o efeito pendente, mas a confirmação diverge de algum campo **verificável
  diretamente contra essa requisição ou sua origem** — **incluindo o próprio
  `efeito_id`**: `efeito_id` diferente do efeito pendente já é, por si só, divergência
  D3, **nunca** uma condição prévia que precise coincidir para D3 se aplicar. A lista
  fechada de divergências verificáveis é: `efeito_id`; `continuacao_id`; `clinica_id`;
  `conversa_id`; `message_id`; `versao_origem` diferente de
  `requisicao_pendente.versao_esperada`; tipo ou forma da resposta incompatível com a
  união discriminada (por exemplo, `confirmado` sem `versao_estado_resultante`); versão
  resultante incompatível; e (na persistência final) `resultado_id` diferente do
  `resultado_id` que a própria requisição pendente carrega. **Resultado:** divergência
  de `resultado_id` produz especificamente `resultado_id_incompativel`; **qualquer
  outra** divergência desta lista — incluindo `efeito_id` — produz
  `efeito_confirmado_incompativel` (seção 20). **D3 nunca significa comparar a
  confirmação atual com outra confirmação aceita em execução anterior** — a máquina não
  possui, e não guarda, esse histórico (ver seção 11);
- **nenhuma confirmação é inferida** — ausência de resposta, resposta vazia ou timeout
  nunca equivalem a `confirmado`;
- esta forma **não define** o mecanismo físico de CAS, transação ou tabela (`P4`).

### Explicitamente fora deste catálogo

Não são, e nunca serão, requisições emitidas pela função pura desta composição:

- enviar mensagem por WhatsApp;
- chamar a IA (interpretação ou redação);
- gravar livremente no banco, fora da forma fechada de efeito (persistência do estado
  interpretado, persistência do resultado final);
- executar SQL arbitrário.

Essas ações pertencem inteiramente ao orquestrador, depois de um resultado terminal
(`DecisaoComposicaoV1`) ou a um protocolo específico não coberto por esta função — por
exemplo, o envio da resposta redigida (passo 27 da ordem determinística, seção 13;
contrato da redação, seção 18) acontece **depois** que a composição já devolveu seu
resultado terminal, nunca como uma requisição que a função em si emite.

### Tipos auxiliares nomeados, ainda não fechados

Estes nomes aparecem nos pseudotipos das seções 11 e 12 como **lugares contratuais**,
não como tipos já fechados por esta especificação. Nenhum é definido aqui, e nenhum é
usado sem que seu conteúdo esteja atribuído explicitamente a uma rodada futura:

| Nome | O que é | Onde será fechado |
|---|---|---|
| `TipoDadoCondicionalV1` | discriminador fechado, exatamente um valor por item da lista de dados condicionais desta seção | plano de implementação (seção 22, fase 1) |
| `DadoCondicionalV1` | união discriminada do conteúdo de cada leitura, um formato por `TipoDadoCondicionalV1` — cada formato já é o de um contrato publicado (catálogo, vínculos, configuração de duração, snapshot diário) | plano de implementação (seção 22, fase 1) |
| `CodigoFalhaAdaptadorV1` | catálogo fechado de motivos técnicos de falha de leitura | especificação dos adaptadores (seção 22, fase 9) |
| `CodigoFalhaEfeitoV1` | catálogo fechado de motivos técnicos de falha de escrita | especificação dos adaptadores (seção 22, fase 9) |
| `RegistroResultadoComposicao` | projeção mínima persistível do resultado da composição (seção 11) | persistência física (`P4`, seção 22, fase 2) |
| `InterpretacaoValidadaAtual` | a `SaidaInterpretacaoModeloV2` (seção 6) já integralmente validada (seção 7), na forma em que chega à máquina | plano de implementação (seção 22, fase 1) |

Nenhum destes nomes autoriza inventar comportamento: enquanto não estiverem fechados, a
implementação não começa (seção 3, seção 24).

## 13. Ordem determinística

Ordem canônica completa, do recebimento da mensagem até o envio da resposta — une, sem
contradizer, o prefixo já aprovado em `interpretacao-ia.md` ("Fluxo final aprovado") e
os 14 passos já aprovados em `composicao-novo-agendamento-v1.md` §9, agora explícitos
sobre qual trecho roda **dentro** da função pura (seção 11) e qual roda **fora**, no
orquestrador:

| # | Passo | Onde |
|---|---|---|
| 1 | Validar contexto autenticado | Orquestrador |
| 2 | Deduplicar ou localizar replay | Orquestrador (claim/reclaim, `interpretacao-ia.md`) — **replay resolvido aqui, antes de qualquer chamada à função pura** (`C5`, seção 17); resultado registrado encerra o turno sem criar continuação |
| 3 | Carregar estado e versão | Orquestrador |
| 4 | Interpretar mensagem atual (chamar a IA) | Orquestrador — a função pura nunca chama a IA |
| 5 | Validar integralmente a interpretação | Orquestrador, antes da primeira chamada à função pura (seção 7) |
| 6 | Aplicar alterações-fonte | Dentro da função pura (`aplicarAlteracoesTemporais`, seção 7, mais a aplicação já existente de `alteracoes` não temporais) |
| 7 | Calcular invalidações | Dentro da função pura (seção 10), sobre as alterações desta mesma mensagem — **antes** de qualquer persistência deste turno |
| 8 | Construir estado interpretado coerente | Dentro da função pura — um único objeto com os fatos novos (passo 6) e os derivados invalidados (passo 7) já ausentes; nunca fatos novos persistidos junto de derivados que ainda presumem os fatos antigos |
| 9 | Persistir estado interpretado com CAS | Requisição de efeito (`NecessitaEfeitoComposicaoV1`, seção 12) — execução pelo orquestrador; grava, numa única operação atômica, o resultado dos passos 6 a 8; a máquina emite continuação com etapa `aguardando_persistencia_intermediaria` |
| 10 | Carregar o novo estado oficial | Resposta de efeito `confirmado` (seção 12), devolvida com a continuação na chamada seguinte; a máquina valida a correlação e atualiza a versão oficial dentro da continuação (seção 11, seção 17) |
| 11 | Tratar desistência ou roteamento | Dentro da função pura (`controlador-conversacional-v1.md` §7–§8) |
| 12 | Resolver procedimento | Dentro da função pura, após requisição de catálogo (`NecessitaDadosComposicaoV1`, etapa `resolvendo_procedimento`) |
| 13 | Resolver dentistas | Dentro da função pura, após requisição de vínculos (etapa `resolvendo_dentistas`) |
| 14 | Avaliar Consulta/Avaliação | Dentro da função pura, quando aplicável (seção 15) |
| 15 | Resolver duração | Dentro da função pura, após requisição de configuração (etapa `resolvendo_duracao`) |
| 16 | Resolver temporal | Dentro da função pura, sem requisição adicional — `resolverTemporal` só usa dados já disponíveis (seção 9) |
| 17 | Tratar falha fechada de horário exato com restrição simultânea, quando aplicável | Dentro da função pura, imediatamente após o passo 16 (seção 14) — antes de qualquer requisição de disponibilidade |
| 18 | Solicitar dados condicionais de disponibilidade | Requisição de snapshot diário (etapa `aguardando_snapshot`) |
| 19 | Gerar opções | Dentro da função pura, chamando `resolverDisponibilidade` com o snapshot obtido — e com **todos** os dados condicionais já acumulados na continuação (`C2`), nunca apenas o mais recente |
| 20 | Validar escolha | Dentro da função pura |
| 21 | Coletar cadastro | Dentro da função pura |
| 22 | Preparar resumo, quando aplicável | Dentro da função pura |
| 23 | Construir estado final proposto e resultado lógico | Dentro da função pura — monta o resultado terminal candidato (uma das 18 pausas já catalogadas, `solicitar_confirmacao`, **ou uma falha fechada de domínio**, seção 20) e os fatos autorizados que o acompanham, e os **preserva** como `resultado_candidato` na continuação (`C3`, seção 11), **sem devolvê-los ainda** |
| 24 | Persistir estado final e resultado lógico | Requisição de efeito (`NecessitaEfeitoComposicaoV1`, seção 12), carregando `resultado_id` — par único, mesma operação atômica; etapa `aguardando_persistencia_final` |
| 25 | Retornar resultado terminal | Nova chamada, já com a resposta de efeito `confirmado` e o `resultado_id` correspondente validados (seção 12, seção 17), etapa `pronto_para_decisao_terminal` — **somente agora** a função devolve exatamente o `resultado_terminal` preservado no passo 23 (decisão ou falha fechada de domínio), **sem recomputar** nenhum resolvedor (`C3`) |
| 26 | Autorizar redação | Orquestrador, a partir do resultado terminal (seção 18) |
| 27 | Enviar resposta | Orquestrador, fora do Core — transporte |

Qualquer passo de 11 a 22 pode terminar antecipadamente numa pausa (uma das 18 já
catalogadas em `composicao-novo-agendamento-v1.md` §12), e o passo 17 pode terminar em
falha fechada (seção 14). **Quando isso ocorre, a composição não devolve a pausa ou a
falha diretamente** — ela segue para o passo 23 (construir o estado final e o
resultado lógico correspondentes ao ponto de parada alcançado) e depois para os passos
24–25 (persistir e só então retornar), exatamente como para `solicitar_confirmacao`.
Nenhuma pausa e nenhuma falha fechada originada nos passos 11 a 23 é exceção ao
requisito de persistência antes da decisão terminal (seção 11, "Persistência antes da
decisão terminal").

**Toda parada desta tabela que não seja terminal retorna uma continuação** (`C1`, seção
11). Cada retomada recebe essa continuação íntegra mais, quando havia requisição
pendente, exatamente uma resposta correlacionada (`C4`) — nunca uma resposta solta, nunca
duas, nunca uma continuação reconstruída pelo orquestrador. **Os dados condicionais já
aceitos permanecem dentro da continuação** ao longo de todos os passos seguintes (`C2`):
o catálogo obtido no passo 12 continua disponível no passo 19, sem nova requisição e sem
depender de memória implícita. **A persistência final (passo 24) preserva o resultado
candidato** (`C3`), e a decisão terminal do passo 25 é exatamente esse resultado, nunca
uma recomposição. **O replay (`C5`) ocorre no passo 2**, antes de a máquina ser chamada
— um turno resolvido por replay nunca alcança os passos 6 a 25.

**Os passos 6 a 9 nunca produzem uma gravação parcial.** O estado interpretado
coerente (passo 8) já contém, num único objeto, os fatos novos aplicados no passo 6 e
o resultado das invalidações calculadas no passo 7 — a requisição de persistência do
passo 9 grava esse par sempre junto, nunca os fatos novos numa gravação e as
invalidações numa gravação seguinte. Não existe estado oficial intermediário em que
`fatos_temporais` já reflita a mensagem atual enquanto `criterio_temporal`, `opcoes`,
`escolha` ou `resumo` ainda refletem os fatos anteriores — essa combinação nunca é
persistida, ainda que apenas por um instante.

**A mecânica física de quantos round-trips de escrita realmente ocorrem — se a
persistência intermediária (passo 9) e a persistência final (passo 24) podem, nalgum
caminho curto, ser fisicamente uma única escrita — é decisão de implementação futura
(`P4`)**, não desta especificação. Esta tabela fixa apenas a **ordem lógica**: a
invalidação sempre precede a primeira persistência do turno, e a persistência final
sempre precede a decisão terminal — nunca o inverso, independentemente de quantas
escritas físicas a implementação futura venha a usar para cumprir essa ordem.

**Persistência física e transporte serão especificados posteriormente** (`P4`, seção
22 desta especificação) — esta tabela fixa somente a ordem lógica e a fronteira entre
função pura e orquestrador, nunca schema, RPC ou protocolo de rede concreto.

## 14. Disponibilidade

Pré-condições, herdadas sem alteração de `composicao-novo-agendamento-v1.md` §13.6–§13.7:

- procedimento oficial resolvido;
- dentistas aptos resolvidos;
- duração oficial resolvida;
- **critério temporal oficial resolvido** (seção 9) — a disponibilidade nunca é
  consultada com um critério temporal `incompleto`, `ambiguo`, `invalido`, `passado`
  ou `conflito`;
- snapshot isolado por clínica, dentista e data (dado condicional, seção 12).

Mapeamento do critério temporal oficial (`ResolucaoTemporalOficial`, seção 9) para a
entrada de `resolverDisponibilidade` (`disponibilidade-tipos.ts`, `ModoConsulta`):

| Critério temporal oficial | `ModoConsulta` resultante |
|---|---|
| `data` + `periodo` | `{ tipo: 'grade'; periodo }` — grade filtrada pelo período |
| `data` + `horario_min` (sem `restricao`) | `{ tipo: 'horario_exato'; horario_min }` — comparação direta do horário solicitado |
| `data` + `restricao` com `tipo: 'inicio_ate'` | `{ tipo: 'grade'; restricao }` — grade com limite de início |
| `data` + `restricao` com `tipo: 'termino_ate'` | `{ tipo: 'grade'; restricao }` — grade respeitando término, calculado pela disponibilidade **depois** de considerar a duração oficial (o resolvedor temporal nunca calcula esse término, `resolvedor-temporal-v1.md` §15) |
| `intencao: 'proxima_disponibilidade'`, `data` = hoje ou data futura sem outro fato | `{ tipo: 'proximo_disponivel' }` — protocolo diário continuável (`composicao-novo-agendamento-v1.md` §13.7), a partir da `data` do critério temporal oficial |

### Horário exato com restrição simultânea — falha fechada

Esta tabela cobre `horario_min` isolado e `restricao` isolada. Quando ambos estão
presentes no mesmo `ResolucaoTemporalOficial`, a composição **fecha o caso com falha
técnica fechada**, em vez de consultar disponibilidade de forma incompleta:

- `horario_min` **pode coexistir** com `restricao` no mesmo `ResolucaoTemporalOficial`
  — combinação **válida** no contrato temporal, provada pelo próprio resolvedor
  (`resolvedor-temporal-v1.md` §15, "Compatibilidade com horário exato —
  responsabilidade distinta por tipo"; cenários TMP-63 e TMP-64, ambos `resolvido`
  com os dois critérios simultaneamente preservados);
- o `ModoConsulta` publicado atualmente (`disponibilidade-tipos.ts`) **não representa
  conjuntamente** horário exato e restrição: a variante `horario_exato` carrega
  somente `horario_min`, sem campo para `restricao`; a variante `grade` carrega
  `restricao`, mas não um horário pontual;
- esta integração **não descarta** a restrição para caber na variante `horario_exato`
  — perderia um critério que o paciente informou e que o resolvedor temporal
  preservou deliberadamente (`resolvedor-temporal-v1.md` §15: "os dois fatos,
  juntos... nunca declarados `conflito` com base somente no horário de início");
- esta integração **não aplica a restrição silenciosamente fora do gerador** —
  nenhuma verificação de `inicio_ate`/`termino_ate` é recalculada por esta
  composição ou pelo orquestrador; a verificação pertence exclusivamente a
  `resolverDisponibilidade`, através de `ModoConsulta`;
- **a máquina pura, ao encontrar `horario_min` e `restricao` simultâneos no critério
  temporal oficial, reconhece uma `FalhaDominioPersistivelComposicaoV1` com o código
  fechado `contrato_horario_exato_com_restricao_nao_suportado`** (seção 20,
  `CodigoFalhaComposicao`) — preservada como candidata (seção 13, passos 23–25) e só
  então devolvida como `FalhaFechadaComposicaoV1`, exatamente como qualquer outra falha
  de domínio persistível (seção 11, "Persistência antes da decisão terminal") —
  **nunca** `NecessitaDadosComposicaoV1` para snapshot diário, **nunca** geração de
  opções, **nunca** descarte silencioso de um dos dois critérios, **nunca** alteração
  de `ModoConsulta`, de `resolverDisponibilidade` ou de qualquer componente já
  publicado;
- esta incompatibilidade é **reconhecida** antes de qualquer requisição de dado
  condicional de disponibilidade (seção 13, passo 17, antes do passo 18) — a
  composição reconhece a incompatibilidade assim que o critério temporal oficial é
  promovido (seção 9), sem
  consultar snapshot algum;
- uma extensão futura do contrato de disponibilidade — de `ModoConsulta`, de
  `resolverDisponibilidade`, ou de ambos — poderá substituir esta falha fechada por
  um tratamento pleno; essa extensão terá sua própria especificação e aprovação, e
  esta spec **não antecipa nem inventa a forma dela**. Até que essa extensão exista,
  `contrato_horario_exato_com_restricao_nao_suportado` é o comportamento **fechado e
  definitivo** desta v1 — não um placeholder para uma decisão futura diferente, mas o
  resultado que a composição sempre produz para este caso enquanto a extensão não
  existir. Esta mesma limitação já estava registrada, sem solução, em
  `resolvedor-temporal-v1.md` §15 ("pode exigir extensão de `ModoConsulta` em rodada
  futura; nenhum tipo real é alterado por esta especificação") — esta seção fecha, na
  camada de composição, o comportamento observável desse mesmo limite já conhecido na
  camada de disponibilidade, sem alterar `ModoConsulta`, `resolverDisponibilidade` ou
  qualquer spec de componente.

Nenhum horizonte semântico artificial é introduzido — mesma proibição já fixada em
`composicao-novo-agendamento-v1.md` §13.7 e `disponibilidade.md` §11.

Opções apresentadas devem possuir versão lógica e o snapshot suficiente para
revalidação e confirmação posterior (`persistencia-v1.md` §17) — esta especificação
não altera esse requisito, apenas confirma que ele se aplica igualmente quando a
origem do critério temporal é o caminho estruturado desta integração.

## 15. Consulta/Avaliação

Registro resumido — contrato completo e não implementado em
`composicao-novo-agendamento-v1.md` §13.3, não duplicado aqui:

- avaliada **somente** quando não houver dentista apto ao procedimento originalmente
  pedido;
- seleção por função pura própria (`ResultadoSelecaoConsultaAvaliacao`), exigindo
  exatamente um procedimento ativo com `eh_consulta_avaliacao = true` na clínica;
- exige, além disso, ao menos um dentista apto para esse procedimento específico;
- a composição **apenas propõe** ao paciente — nunca substitui o procedimento
  silenciosamente;
- a substituição só ocorre **após** `aceitar_opcao` explícito e validado
  (`eventos-conversacionais-v1.md` §2);
- procedimento original e a proposta são preservados para rastreabilidade durante a
  pendência de aceitação;
- após aceitação, o procedimento oficial é substituído e todos os derivados
  dependentes são invalidados (seção 10, mesma cascata de "Alteração de procedimento",
  `composicao-novo-agendamento-v1.md` §14);
- **não é reofertada** quando o procedimento vigente já é, ele mesmo, Consulta/
  Avaliação — evita ciclo;
- zero ou múltiplas correspondências ativas (`nenhuma_ativa`, `multiplas_ativas`,
  `configuracao_invalida`) resultam em falha fechada (`falha_sem_profissional` ou
  `falha_tecnica_fechada`, conforme `composicao-novo-agendamento-v1.md` §13.2, §13.3).

Nenhuma regra desta seção altera o contrato já publicado — esta integração apenas
confirma que o resolvedor temporal (seção 9) é chamado com o procedimento **já
definitivo** no momento em que roda, seja o originalmente pedido ou a Consulta/
Avaliação já aceita, nunca antes disso.

## 16. Confirmação

Esta composição termina em `solicitar_confirmacao` (seção 13, passos 22 a 25 — resumo
preparado, estado final e resultado lógico construídos, persistidos, e só então
devolvidos como decisão terminal) — mesma fronteira fixa já estabelecida em
`composicao-novo-agendamento-v1.md` §3, §18.

Pré-condições, herdadas sem alteração:

- ação corrente correta (`novo_agendamento`);
- resumo vigente, preparado a partir da escolha e do cadastro vigentes;
- escolha vigente, com versão;
- cadastro obrigatório completo e válido;
- versões compatíveis entre o resumo e a escolha usada para produzi-lo;
- ausência de qualquer alteração invalidante pendente (seção 10) que pudesse mudar os
  fatos do resumo;
- candidato de confirmação inequívoco, quando presente na mesma mensagem
  (`eventos-conversacionais-v1.md` §5).

**Não é implementado nesta rodada, e não é definido por esta especificação**:

- revalidação técnica real do horário antes da criação;
- criação do agendamento;
- reserva ou qualquer efeito operacional de agendamento;
- persistência física da confirmação.

Esses passos pertencem à próxima especificação operacional, ainda não escrita — a
mesma fronteira já registrada em `composicao-novo-agendamento-v1.md` §3.

## 17. Idempotência e replay

Preserva, sem alteração, os três casos já fechados em
`composicao-novo-agendamento-v1.md` §19 — esta seção apenas os conecta explicitamente
ao contrato da função pura (seção 11):

### Caso A — resultado da composição já registrado

- resolvido **inteiramente pelo orquestrador**, antes de qualquer chamada à função pura
  (`C5`, seção 5) — ver "Autoridade única do replay", abaixo;
- replay **exato**: o orquestrador localiza o resultado registrado e o devolve, **sem
  chamar** `avancarComposicaoNovoAgendamentoV1` para recomputar nenhum passo;
- sem reinterpretar — a IA não é chamada de novo para essa mensagem;
- nenhuma continuação é criada — não há chamada à máquina, portanto não há continuidade
  a estabelecer.

### Caso B — interpretação registrada sem resultado da composição

- a função pura **nunca é chamada** para esta mensagem — o orquestrador detecta esse
  caso antes mesmo de montar a primeira `EntradaAvancoComposicaoV1`;
- não retomar; não reconstruir `eventos_candidatos`/`conflitos_de_valor` (transitórios,
  nunca persistidos, `interpretacao-ia.md`); não chamar a IA novamente;
- responder com o texto fixo já aprovado ("Não consegui processar sua mensagem agora.
  Pode tentar novamente?");
- aguardar nova mensagem do paciente.

### Caso C — nenhum marcador

- processamento normal: primeira chamada de `avancarComposicaoNovoAgendamentoV1` para
  esta mensagem, com `interpretacao` preenchida e `continuacao`/`resposta_condicional`
  ausentes (seção 11, "Entrada").

### Autoridade única do replay

Regra única, válida para todo o documento (`C5`, seção 5):

- **o orquestrador consulta o registro idempotente** antes de chamar a máquina (seção
  13, passo 2);
- **resultado de composição já registrado produz replay externo**, devolvido pelo
  próprio orquestrador;
- **a função pura não é chamada** nesse caso;
- `ReplayComposicaoV1` **pode permanecer como tipo externo do controlador**, mas **não
  integra `ResultadoAvancoComposicaoV1`** (seção 11);
- **nenhuma continuação é criada durante um replay**;
- falha de redação ou de envio usa o **mesmo registro lógico**, sem recomposição do
  domínio.

**A máquina não possui autoridade de replay.** Nenhuma seção desta especificação
atribui o replay simultaneamente à função pura e ao orquestrador — a autoridade é
exclusivamente do segundo. Isso alinha o Caso A ao Caso B, que já era resolvido antes da
primeira chamada; a diferença entre os dois permanece exatamente a já publicada (Caso A
devolve o resultado registrado, Caso B devolve a resposta fixa).

### Antes e depois da persistência final

Esta distinção não substitui os Casos A/B/C acima — ela detalha o que o Caso A
pressupõe sobre o instante em que um resultado se torna "registrado" (seção 13, passos
22 a 25; seção 11, "Persistência antes da decisão terminal"):

- **Antes da persistência final** (seção 13, passos 1 a 24): nenhum resultado
  recuperável por replay existe ainda. Uma falha do orquestrador nesta janela — antes
  de a resposta de efeito `confirmado` ser recebida para a persistência do estado final
  e do resultado lógico (passo 24) — **não autoriza recomposição silenciosa nem invenção
  de resultado**: a próxima tentativa para a mesma mensagem segue exatamente o mesmo
  Caso B ou Caso C já fechados acima, nunca um caminho especial só porque uma tentativa
  anterior chegou perto do fim. A continuação perdida nessa janela **não é reconstruída**
  — ela nunca foi estado oficial;
- **Depois da persistência final** (seção 13, passo 25 em diante): o resultado existe
  e é recuperável. Uma nova chamada para a mesma mensagem, com o mesmo `message_id`,
  encontra o Caso A e o orquestrador devolve o replay — nunca recomputa nenhum passo;
  falha de redação ou de envio (seção 18, transporte, passos 26–27) **nunca** autoriza
  recompor o resultado lógico — apenas retentar a redação e o envio sobre o mesmo
  resultado já persistido.

### Identidades e correlação

A idempotência desta integração se apoia em quatro identidades distintas, nenhuma delas
intercambiável (`C4`):

| Identidade | O que identifica | Onde vive |
|---|---|---|
| `continuacao_id` | uma continuação específica emitida pela máquina | `ContinuacaoComposicaoV1` (seção 11) |
| `requisicao_id` | uma requisição lógica (leitura ou escrita) | `CabecalhoRequisicaoComposicaoV1` (seção 12) |
| `efeito_id` | uma requisição de escrita específica | `RequisicaoEfeitoComposicaoV1` (seção 12) |
| `resultado_id` | um resultado candidato preservado | `ResultadoCandidatoComposicaoV1` (seção 11) |

Regras:

- toda resposta ecoa a identidade e a **origem completa** (`clinica_id`, `conversa_id`,
  `message_id`, `versao_origem`) da requisição que a originou;
- a idempotência de leitura e de escrita distingue **três situações**, nunca tratadas
  como a mesma coisa, e todas verificadas **exclusivamente contra a requisição ou o
  efeito pendente presentes na entrada corrente** — nunca contra uma resposta anterior,
  um histórico, ou qualquer memória fora da continuação (detalhadas em "Resposta de
  dado condicional" e "Resposta de efeito", seção 12; ver também seção 11,
  "Concorrência divergente fora do conhecimento da função"):
  - **D1 — reexecução integral idêntica**: mesma continuação anterior, mesma
    requisição ou mesmo efeito **ainda pendente**, mesma resposta, mesmo contexto,
    mesmo estado, mesma versão — produz exatamente o mesmo resultado; determinismo
    normal da função pura; não duplica dado acumulado, não avança a etapa duas vezes,
    não libera um resultado terminal duas vezes; **nenhum avanço oficial duplo é
    inferido pela função**;
  - **D2 — resposta contra continuação posterior**: a mesma resposta, já aceita antes,
    entregue de novo junto de uma continuação **posterior**, na qual a requisição ou o
    efeito **já não está pendente** — **nunca é reaceita**; produz
    `resposta_sem_requisicao` (leitura) ou `efeito_confirmado_incompativel` (escrita),
    nunca tratada como duplicata válida;
  - **D3 — divergência verificável contra a requisição pendente**: a requisição ou o
    efeito **ainda está pendente**, mas a resposta diverge de um campo verificável
    diretamente contra essa requisição ou sua origem (identidade, origem, versão,
    `tipo`, `resultado_id`, ou parâmetros fechados) — **nunca reconciliada**; produz
    `resposta_nao_corresponde_requisicao`/`tipo_resposta_incompativel` (leitura) ou
    `efeito_confirmado_incompativel`/`resultado_id_incompativel` (escrita), conforme o
    campo. **D3 nunca compara a resposta atual com outra resposta aceita numa execução
    anterior** — essa comparação exigiria um histórico que a máquina não guarda;
- **replay externo não cria nova continuação** — nenhuma identidade desta tabela é
  emitida durante um replay;
- **o algoritmo físico dessas identidades não é especificado aqui** (`P4`, seção 22) —
  apenas a exigência de que sejam determinísticas, estáveis, produzidas pelo Core e
  jamais originadas na IA ou no adaptador (seção 12).

### Garantias de idempotência — o que é da função pura, o que é de `P4`

Duas garantias distintas, **nunca atribuídas uma à outra**:

**Garantia da função pura (vale hoje, sem nenhuma persistência física):**

- **mesma entrada integral produz mesmo resultado** — contexto, estado, interpretação,
  continuação e resposta idênticos produzem exatamente o mesmo
  `ResultadoAvancoComposicaoV1` (D1, seção 12);
- **resposta incompatível com a requisição pendente falha fechado** — D3, verificada
  exclusivamente contra a requisição pendente presente na entrada (seção 12, seção 11
  "Concorrência divergente fora do conhecimento da função");
- **resposta sem requisição pendente falha fechado** — D2, mesmo quando a resposta é,
  ela própria, idêntica a uma resposta já aceita antes (seção 12).

Isto é tudo o que a função pura garante. Ela **não garante**, e não pode garantir
sozinha, nenhuma das propriedades abaixo.

**Garantia futura da persistência (`P4`, ainda não especificada):**

- **evitar dois avanços oficiais concorrentes** para a mesma requisição;
- **registrar qual resposta foi fisicamente aceita**, quando duas respostas
  concorrentes e individualmente válidas chegarem (seção 11, "Concorrência divergente
  fora do conhecimento da função");
- **rejeitar ou recuperar deterministicamente** a execução concorrente perdedora;
- **garantir unicidade física** do estado oficial resultante e do resultado da
  composição registrado.

**Nenhuma garantia da segunda lista é atribuída à função pura nesta especificação.** A
função pura é determinística e correlaciona corretamente contra o que recebe; ela não
arbitra entre execuções concorrentes, porque arbitrar exigiria exatamente o que ela não
tem: memória de outras execuções, um mecanismo de CAS físico, e autoridade sobre qual
avanço é o oficial. Essas três coisas pertencem a `P4`.

### Vinculação obrigatória da confirmação de efeito

Toda `RespostaEfeitoComposicaoV1` (seção 12) que a função pura aceita deve estar
vinculada, sem ambiguidade, a:

- `message_id` da mensagem corrente (`contexto.mensagem.message_id`, seção 11);
- `conversa_id` da conversa corrente (`contexto.mensagem.conversa_id`, seção 11);
- a versão do estado que originou a requisição (`versao_origem`, seção 12);
- a identidade do efeito solicitado (`efeito_id`, seção 12);
- a continuação que emitiu a requisição (`continuacao_id`, seção 11);
- e, **na persistência final**, o `resultado_id` do candidato preservado (`C3`).

**Uma confirmação que não corresponda exatamente a esses valores nunca é aplicada** — é
tratada como falha estruturada interna (seção 11, "Entrada"), mesma disciplina já usada
para `EntradaInvalidaError` (seção 9). Esta vinculação evita que uma confirmação tardia
de uma tentativa anterior (por exemplo, depois de um retry do orquestrador) seja
aplicada a um turno diferente do que a originou — a mesma preocupação de identidade já
resolvida, para dados de leitura, por `requisicao_id` e `versao_origem` em
`RequisicaoDadoCondicionalV1` (seção 12), agora explícita também para efeitos de
escrita.

Esta vinculação e a transição legítima de versão (seção 11, "Transição legítima após a
persistência intermediária") são **complementares, nunca conflitantes**: a vinculação
garante que a confirmação corresponde à requisição pendente; a transição legítima
governa, **somente** depois de uma confirmação vinculada e `confirmado`, o que muda na
continuação e na próxima entrada. Uma confirmação que falha a vinculação nunca chega a
ser avaliada pela transição.

### Separação obrigatória

Estas quatro coisas nunca se confundem, nem na persistência futura (`P4`) nem no
contrato lógico desta seção:

- **resultado lógico** — o `DecisaoComposicaoV1` terminal (comando + fatos
  autorizados), produzido pela função pura;
- **texto redigido** — produzido pela porta de redação (seção 18), a partir do
  resultado lógico, nunca antes dele;
- **estado** — `EstadoNovoAgendamentoV1` (seção 8), persistido independentemente do
  resultado lógico de um turno específico;
- **efeito externo** — envio da mensagem, execução de I/O pelo orquestrador; nunca
  produzido pela função pura em si (seção 11).

## 18. Redação autorizada

Contrato conceitual — **pseudotipo, não implementação**. Formaliza, com forma mínima
nomeada, o que `atendimento-v1.md` §2 já descreve como "entrada autorizada":

```text
interface EntradaRedacaoAutorizadaV1 {
  comando: ComandoConversacionalV1; // catálogo fechado, composicao-novo-agendamento-v1.md §8
  fatos_autorizados: Readonly<Record<string, unknown>>;
  opcoes?: readonly OpcaoApresentavel[];
  campos_solicitados?: readonly CampoSolicitavel[];
  motivo?: CodigoMotivoFechado;
  idioma: 'pt-BR';
}
```

A redatora **não pode**, em nenhuma circunstância (herdado sem alteração de
`atendimento-v1.md` §6):

- mudar o comando decidido pela composição;
- interpretar o estado por conta própria;
- inventar fato, opção, endereço, horário, profissional ou disponibilidade;
- escolher dentista ou procedimento;
- afirmar criação, cancelamento ou remarcação antes do resultado oficial (fora do
  escopo desta v1, seção 3);
- receber credenciais;
- receber agenda bruta ou catálogo completo;
- receber o estado interno completo da conversa — somente os `fatos_autorizados`
  explicitamente selecionados pela composição para este comando.

**Não é escolhida nesta etapa** a tecnologia de redação (`P5`, seção 5) — template
determinístico, IA redatora controlada restrita aos fatos autorizados, ou combinação
dos dois. Qualquer que seja a tecnologia escolhida no futuro, ela deve respeitar
integralmente esta entrada e estas restrições, sem exceção.

## 19. Eventos lógicos

Registrados como eventos candidatos **internos** desta integração — não exigem, nem
autorizam, event sourcing físico nem persistência individual de evento (`P4`). Cada
evento é um ponto observável da ordem determinística (seção 13), útil para auditoria
técnica e para especificações futuras de observabilidade — nenhuma tabela ou log é
criado por esta seção. Sequência normativa, refletindo a ordem determinística (seção 13)
e o contrato de continuidade (`C1`–`C5`, seção 11): alterações-fonte aplicadas,
invalidações calculadas, persistência intermediária solicitada, continuação emitida,
resposta condicional aceita, dado condicional acumulado, estado oficial atualizado,
resultado candidato preparado, persistência final solicitada, composição persistida,
resultado terminal liberado. A linha "Continuação emitida" é **transversal** — vale para
toda parada não terminal, não apenas para a persistência intermediária:

| Evento | Causa | Dados mínimos | Efeito | Próxima decisão permitida |
|---|---|---|---|---|
| Mensagem recebida | Entrega do transporte | `message_id`, `clinica_id`, `conversa_id` | Claim/reclaim | Interpretar ou responder fixo (Caso B) |
| Interpretação aceita | Saída validada estruturalmente | Alterações e eventos candidatos validados | `interpretacao_persistida_em` gravado | Iniciar `avancarComposicaoNovoAgendamentoV1` |
| Alterações-fonte aplicadas | `aplicarAlteracoesTemporais` e a aplicação de `alteracoes` não temporais concluídas (passo 6) | Nova `fatos_temporais` recomposta, ainda não persistida | — | Calcular invalidações |
| Invalidações calculadas | União transitiva calculada (seção 10) sobre as alterações desta mensagem (passo 7) | Conjunto de derivados a remover | — | Construir estado interpretado coerente |
| Persistência intermediária solicitada | Estado interpretado coerente montado (passo 8) — fatos novos e derivados invalidados já ausentes, num único objeto | Estado proposto, `efeito_id`, `continuacao_id` | Requisição de efeito; continuação emitida | Aguardar confirmação |
| Continuação emitida | Qualquer parada não terminal da máquina (`C1`) | `continuacao_id`, etapa, requisição pendente | — | Aguardar resposta correlacionada |
| Resposta condicional aceita | Resposta validada contra a requisição pendente (`C4`, seção 12) | `requisicao_id`, tipo, `versao_origem` | Requisição deixa de estar pendente | Incorporar o dado e avançar |
| Dado condicional acumulado | Resposta aceita incorporada (`C2`) | `requisicao_id`, tipo do dado | Dado passa a integrar `dados_condicionais_aceitos` | Continuar a ordem determinística |
| Estado oficial atualizado | Efeito de persistência intermediária confirmado (passo 9–10) | Nova versão do estado, já coerente | Versão oficial atualizada dentro da continuação | Tratar desistência/roteamento; então resolver procedimento |
| Temporal resolvido | `resolverTemporal` retornou `resolvido` (passo 16) | `criterio_temporal` | `criterio_temporal` promovido | Solicitar snapshot diário, ou falha fechada se `horario_min` e `restricao` simultâneos (seção 14) |
| Disponibilidade solicitada | Critério temporal oficial disponível, sem falha fechada pendente (passo 18) | Parâmetros da requisição de snapshot | Requisição de dado condicional | Gerar opções |
| Opção selecionada | `aceitar_opcao` validado contra opção vigente | Opção escolhida, versão | — | Coletar cadastro ou preparar resumo |
| Ação cancelada | `desistir` explícito e válido | Confirmação de desistência | — | Preparar resultado final (retorno a `atendimento`) |
| Resultado candidato preparado | Pausa (passo 11 a 22, uma das 18 já catalogadas, ou `solicitar_confirmacao`) ou falha fechada de domínio (passo 17) formalizada em estado final e resultado lógico (passo 23, `C3`) | `resultado_id`, comando candidato e fatos autorizados, ou motivo de falha | Candidato preservado na continuação | Persistir estado final e resultado lógico |
| Persistência final solicitada | Resultado candidato preparado (passo 23) | Estado proposto final e resultado lógico, como par único; `efeito_id`, `resultado_id` | Requisição de efeito; continuação emitida | Aguardar confirmação |
| Composição persistida | Efeito de persistência final confirmado e vinculado (passo 24, seção 17) | Nova versão do estado; resultado lógico registrado; `resultado_id` ecoado | — | Liberar resultado terminal candidato |
| Resultado terminal liberado | Persistência final confirmada (passo 25) | `resultado_terminal` preservado: `DecisaoComposicaoV1` ou `FalhaDominioPersistivelComposicaoV1` | — (resultado terminal do turno); nenhuma recomputação | Autorizar redação, ou aguardar nova mensagem |

## 20. Falhas fechadas

Cada falha desta lista carrega motivo fechado, nunca mensagem livre — mesma disciplina
já aplicada em toda a cadeia publicada. As falhas já catalogadas em
`composicao-novo-agendamento-v1.md` §20 não são repetidas aqui; esta lista cobre
**exclusivamente** o que esta integração acrescenta.

Catálogo fechado dos motivos que `FalhaFechadaComposicaoV1` pode carregar,
**exclusivos desta integração** — pseudotipo, não implementação. `falha_tecnica_fechada`
e os demais motivos já publicados em `composicao-novo-agendamento-v1.md` §20 continuam
válidos, com seu próprio catálogo fechado, e não são repetidos aqui:

```text
type CodigoFalhaComposicao =
  | 'conflito_versao'
  | 'contrato_horario_exato_com_restricao_nao_suportado'
  // correlação e continuidade (C1–C4, seção 11, seção 12)
  | 'continuacao_incompativel'
  | 'resposta_sem_requisicao'
  | 'resposta_nao_corresponde_requisicao'
  | 'tipo_resposta_incompativel'
  | 'efeito_confirmado_incompativel'
  | 'resultado_candidato_ausente'
  | 'resultado_id_incompativel';
```

Todos os códigos desta união são: específicos; discrimináveis entre si; **sem PII**
(nenhum carrega texto de mensagem, nome, CPF ou qualquer dado do paciente); **sem
fallback** (nenhum autoriza comportamento degradado); e **terminais para a chamada**.

### Falhas de domínio persistíveis vs. falhas estruturais internas

Toda falha fechada alcançada por esta integração pertence a exatamente uma destas
categorias — nunca as duas, nunca nenhuma:

**Falhas de domínio persistíveis** — resultados que a composição alcança avaliando a
situação do paciente durante os passos 11 a 22, e que **integram o resultado
candidato** (seção 11, "Resultado candidato") exatamente como qualquer pausa: são
construídas no passo 23, preservadas em `resultado_candidato.resultado_terminal`,
persistidas no passo 24, e só então liberadas (passo 25) — nunca devolvidas antes
disso. Exemplos:

- procedimento inexistente ou não resolvido → `pedir_procedimento` (comando,
  `DecisaoComposicaoV1`);
- duração ausente, inválida ou conflitante → `falha_duracao` (comando,
  `DecisaoComposicaoV1`);
- temporal inválido, passado ou conflitante → `pedir_dado_temporal` ou esclarecimento
  (comando, `DecisaoComposicaoV1`);
- ausência de profissional apto → `falha_sem_profissional` (comando,
  `DecisaoComposicaoV1`);
- horário exato com restrição simultânea → `contrato_horario_exato_com_restricao_nao_suportado`
  (seção 14) — **o único código desta lista que é, ele próprio, uma
  `FalhaDominioPersistivelComposicaoV1`, não um comando**.

A maioria destes exemplos já são comandos do catálogo fechado
(`composicao-novo-agendamento-v1.md` §8), devolvidos como `DecisaoComposicaoV1` — o que
os torna "falha de domínio" não é o tipo de retorno, mas o fato de virem de uma
avaliação da situação do paciente, sujeita ao mesmo requisito de persistência antes da
devolução que qualquer outra pausa (seção 11, "Persistência antes da decisão
terminal"). `contrato_horario_exato_com_restricao_nao_suportado` é o único caso, nesta
integração, em que uma falha de domínio é literalmente tipada como
`FalhaDominioPersistivelComposicaoV1` — e é exatamente por isso que
`ResultadoTerminalCandidatoV1` (seção 11) precisa aceitar as duas formas.

**Falhas estruturais internas não persistíveis** — nunca resultam de algo que o
paciente fez; sempre indicam defeito do orquestrador ou do adaptador. Uma composição
corretamente orquestrada nunca as produz. **Nunca integram um resultado candidato** —
encerram a chamada imediatamente, porque a chamada nunca chegou a um resultado
bem-sucedido a preservar. São os sete códigos de correlação e continuidade:

- continuação incompatível → `continuacao_incompativel`;
- resposta sem requisição pendente → `resposta_sem_requisicao`;
- correlação incompatível (identidade ou origem divergente) →
  `resposta_nao_corresponde_requisicao`;
- tipo de resposta incompatível → `tipo_resposta_incompativel`;
- efeito confirmado sem vinculação válida → `efeito_confirmado_incompativel`;
- candidato ausente na confirmação final → `resultado_candidato_ausente`;
- `resultado_id` incompatível na confirmação final → `resultado_id_incompativel`.

São tratadas com a mesma disciplina de `EntradaInvalidaError` (seção 9): observáveis
tecnicamente, respondidas ao paciente pela mesma resposta fixa já aprovada, **nunca**
por uma explicação técnica que exponha o código interno.

### Nova classificação de `conflito_versao`

`conflito_versao` (seção 13, passos 9 e 24) **não é falha estrutural de correlação**,
e não pertence à lista de sete códigos acima — é uma **terceira categoria própria**,
com classificação fechada:

- é uma **falha da escrita** — o resultado técnico do CAS conceitual (`P4`) recusando
  uma gravação cuja versão de origem não corresponde mais à versão oficial vigente,
  nunca um julgamento sobre a mensagem do paciente;
- é **não persistível** — não integra `ResultadoTerminalCandidatoV1` (seção 11, união
  **estreita**), e nunca teve, nem terá, um candidato à espera de ser preservado: a
  própria tentativa de escrita é o que falhou;
- **não é falha de domínio** — não resulta de avaliar a situação do paciente durante
  os passos 11 a 22, e não é, e nunca será, um `FalhaDominioPersistivelComposicaoV1`;
- **não é falha estrutural de correlação** — não decorre de uma resposta incompatível
  com uma requisição pendente (`C4`); a requisição e a resposta podem estar
  perfeitamente correlacionadas, e o CAS falhar assim mesmo, porque a versão mudou
  por outro motivo (por exemplo, outra mensagem da mesma conversa já foi processada);
- **não integra o resultado candidato** — um candidato prestes a ser persistido, cuja
  persistência falha por `conflito_versao`, **não é promovido**: a falha fechada
  `conflito_versao` é o resultado do turno, e o candidato original é descartado
  (seção 11, "Resultado candidato").

`conflito_versao` e `contrato_horario_exato_com_restricao_nao_suportado` são, ambos,
resultados técnicos legítimos e catalogados do fluxo (`FalhaFechadaComposicaoV1`,
seção 11, "Resultado") — mas só o segundo é domínio persistível e passa pelo mecanismo
de candidato; o primeiro nunca chega a ter um candidato para preservar, ou invalida o
que já existia. As três categorias desta seção — falha de domínio persistível, falha
estrutural interna, falha da escrita — são **mutuamente exclusivas e exaustivas** para
toda `FalhaFechadaComposicaoV1` que esta integração produz.

| Falha | Origem | Tratamento |
|---|---|---|
| Interpretação estruturalmente inválida (inclui `alteracoes_temporais`) | Seção 7 | Resposta fixa já aprovada; nada persistido; nenhuma chamada à composição |
| Alteração temporal inválida (categoria repetida, átomo fora da categoria) | Seção 6, seção 7 | Mesma resposta fixa acima — subcaso da linha anterior, não um caminho separado |
| Conflito de versão (CAS de `fatos_temporais`, intermediário ou final) — falha da escrita, não persistível ("Nova classificação de `conflito_versao`", abaixo) | Seção 13, passos 9 e 24 | `FalhaFechadaComposicaoV1` com `conflito_versao`; nenhuma alteração aplicada; nenhum candidato preservado; mesma disciplina de `interpretacao-ia.md` ("Conflito concorrente") |
| Horário exato com restrição simultânea no critério temporal oficial | Seção 9, seção 14 | `FalhaFechadaComposicaoV1` com `contrato_horario_exato_com_restricao_nao_suportado`; nenhuma requisição de disponibilidade |
| Procedimento inexistente ou não resolvido | `procedimentos-v1.md` §7, reafirmado por `composicao-novo-agendamento-v1.md` §13.1 | `pedir_procedimento` |
| Nenhum profissional apto | `dentistas-vinculos-v1.md`, reafirmado por `composicao-novo-agendamento-v1.md` §13.2 | `propor_consulta_avaliacao` ou `falha_sem_profissional` |
| Consulta/Avaliação mal configurada | `composicao-novo-agendamento-v1.md` §13.3 | `falha_tecnica_fechada` |
| Duração ausente, inválida ou conflitante | `duracao-v1.md` §6 | `falha_duracao` |
| Temporal inválido, passado ou conflitante | Resolvedor temporal (seção 9) | `pedir_dado_temporal` ou esclarecimento, conforme a variante |
| Configuração temporal inválida (`fuso`/`instante_atual`) | Resolvedor temporal, `erro_configuracao` (seção 9) | `falha_tecnica_fechada` |
| Snapshot diário ausente ou erro do adaptador | `composicao-novo-agendamento-v1.md` §13.7 | `falha_tecnica_fechada` ou continuação silenciosa, conforme o caso |
| Opção obsoleta | `persistencia-v1.md` §17, ESC-04 | Recusada; nunca promovida |
| Cadastro incompleto | Seção 13, passo 21 | Comando de coleta do próximo campo faltante |
| Efeito de escrita confirmado sem vinculação válida (`message_id`, `conversa_id`, versão, `efeito_id` ou `continuacao_id` incompatíveis) | Seção 11 ("Entrada"), seção 17 | `efeito_confirmado_incompativel`; falha estrutural interna; nunca aplicado ao estado; nunca produz decisão terminal |
| Continuação de outra clínica, conversa, mensagem ou versão; ou etapa incompatível com o próprio conteúdo; ou identidade de entrada divergente — **fora da transição legítima da seção 11** | Seção 11 ("Entrada", "Etapas discriminadas", "Transição legítima após a persistência intermediária") | `continuacao_incompativel`; nenhuma reconciliação silenciosa; nenhuma retomada |
| Resposta condicional presente sem requisição pendente na continuação | Seção 11 ("Entrada"), seção 12 | `resposta_sem_requisicao`; a resposta nunca é incorporada |
| Resposta cuja identidade ou origem não corresponde à requisição pendente | Seção 12 (`C4`) | `resposta_nao_corresponde_requisicao`; nenhum dado aceito; nenhuma etapa avançada |
| Resposta cujo `tipo` diverge do tipo solicitado, ainda que a identidade coincida | Seção 12 | `tipo_resposta_incompativel`; nunca aceita "por aproximação" |
| Confirmação de persistência final sem resultado candidato preservado na continuação | Seção 11 (`C3`), seção 13, passo 25 | `resultado_candidato_ausente`; nenhuma decisão é recomputada para preencher a lacuna |
| Confirmação de persistência final cujo `resultado_id` diverge do candidato preservado | Seção 11 (`C3`), seção 12 | `resultado_id_incompativel`; o resultado terminal preservado não é liberado |
| Erro antes da persistência final do resultado da composição | Seção 13, passo 24 (não alcançado) | Nenhum comando anterior inventado; caso B de idempotência (seção 17) na próxima tentativa |
| Erro depois da persistência final do resultado da composição | Seção 13, passo 24 (alcançado) | Caso A de idempotência (seção 17); replay exato |

**Nenhum fallback de domínio é criado por esta especificação.** Toda falha desta lista
resulta em um comando já catalogado (`composicao-novo-agendamento-v1.md` §8) ou em uma
falha técnica fechada — nunca em um valor inventado, nunca em comportamento
silenciosamente degradado.

## 21. Cenários obrigatórios

Índice documental — **nenhum teste executável é criado por esta rodada**. Prefixo
`ITC-` (Integração Temporal–Composição), novo nesta especificação — nenhum
identificador já usado em `tests/cenarios-obrigatorios.md`,
`composicao-novo-agendamento-v1.md` (`COMP-`) ou `resolvedor-temporal-v1.md` (`TMP-`)
é reciclado ou renumerado.

Classificação, conforme exigido:

- **unitário futuro** — testável isoladamente, sem depender de código ainda não
  existente além do já publicado;
- **composição futura** — exige a composição (função pura, seção 11) implementada,
  testável com estado sintético e dados condicionais sintéticos, sem persistência
  física real e sem adaptador real;
- **integração futura** — exige, além da composição, algo que a função pura sozinha
  não pode fornecer: persistência física real, CAS real, adaptador real,
  concorrência externa real, transporte real, ou efeito operacional real. Nenhum dos
  cenários ITC-01 a ITC-53 exige isso hoje — a categoria permanece reservada para
  cenários futuros que venham a exigir. Em particular, os cenários de continuidade
  (ITC-33 a ITC-53) são testáveis com continuação sintética e respostas sintéticas: a
  correlação e a preservação do resultado candidato são propriedades da função pura,
  não da persistência física — inclusive o limite de concorrência (ITC-53), cuja
  propriedade de pureza (cada entrada processada isoladamente e deterministicamente)
  não depende de concorrência física real.

| ID | Cenário | Classificação | Resultado esperado |
|---|---|---|---|
| ITC-01 | Substituição de categoria `data`: "amanhã" seguido de "na verdade sexta" | composição futura | `substituir` na categoria `data`; átomo anterior descartado; `criterio_temporal` invalidado |
| ITC-02 | Remoção de horário: paciente havia informado horário exato e depois pede "qualquer horário desse dia" | composição futura | `remover` na categoria `horario_exato`; demais categorias preservadas |
| ITC-03 | Substituição de período: "de manhã" depois "na verdade à tarde" | composição futura | `substituir` na categoria `periodo`; `criterio_temporal` invalidado |
| ITC-04 | Correção composta na mesma mensagem: nova data e novo horário juntos | composição futura | Duas entradas de `alteracoes_temporais`, categorias `data` e `horario_exato`; ambas aplicadas; nenhuma ordem-dependência |
| ITC-05 | Duas alterações da mesma categoria na mesma mensagem | unitário futuro | Rejeitada integralmente — violação estrutural (seção 6); resposta fixa; nenhuma alteração aplicada, nem a outra categoria da mesma mensagem |
| ITC-06 | Mensagem tenta expressar `data_texto` (contrato legado) simultaneamente a uma `alteracoes_temporais` | unitário futuro | Rejeitada — coexistência de autoridades temporais nunca é um caso válido (`P2`); esse caso só pode surgir se ambos os campos existirem na mesma versão de contrato, o que esta especificação proíbe (nunca modo híbrido) |
| ITC-07 | Átomos persistidos na mensagem N são reutilizados, sem retransmissão, na resolução da mensagem N+1 | composição futura | `resolverTemporal` chamado na mensagem N+1 com os átomos de N preservados mais os de N+1 fundidos |
| ITC-08 | Critério oficial (`criterio_temporal`) nunca é lido para reconstruir `fatos_temporais` | unitário futuro | `aplicarAlteracoesTemporais` opera exclusivamente sobre `fatos_temporais`; alterar somente `criterio_temporal` (hipoteticamente) nunca influencia a próxima fusão |
| ITC-09 | Nova data invalida opções vigentes | composição futura | Opções, escolha e resumo invalidados (seção 10); procedimento, dentista e duração preservados |
| ITC-10 | Novo horário exato invalida opções vigentes | composição futura | Mesma cascata da linha anterior, categoria `horario_exato` |
| ITC-11 | Após invalidação por fato temporal, uma nova consulta de disponibilidade preserva procedimento e dentistas aptos já resolvidos | composição futura | Somente disponibilidade, opções, escolha e resumo são recalculados; procedimento e dentista não são re-resolvidos |
| ITC-12 | Intenção `proxima_disponibilidade` sem data, resolvida pelo caminho estruturado | composição futura | `resolverTemporal` retorna `resolvido` com `data` = hoje; `resolverDisponibilidade` chamado em modo `proximo_disponivel` |
| ITC-13 | Procedimento e data informados juntos, primeira mensagem | composição futura | Procedimento resolvido; `resolverTemporal` chamado com um único átomo de categoria `data`; segue para dentistas/duração |
| ITC-14 | Procedimento, data e horário informados juntos | composição futura | Três categorias fundidas (`data`, `horario_exato`, mais a intenção correspondente); `resolverTemporal` retorna `resolvido` com `horario_min` |
| ITC-15 | Critério temporal resolvido com zero, um e vários dentistas aptos | composição futura | O resultado do resolvedor temporal é idêntico nos três casos; a ramificação por quantidade de dentistas (já coberta por DEN-01 a DEN-03) ocorre em etapa anterior, sem influência do critério temporal |
| ITC-16 | Consulta/Avaliação aceita após critério temporal já resolvido | composição futura | Procedimento substituído; `criterio_temporal` **preservado** (não depende de procedimento); disponibilidade recalculada com o novo procedimento |
| ITC-17 | Consulta/Avaliação recusada (paciente rejeita a proposta) | composição futura | Procedimento original preservado; `falha_sem_profissional`; nenhuma disponibilidade consultada |
| ITC-18 | Resultado da composição já registrado para a mensagem (replay) | unitário futuro | Replay devolvido pelo orquestrador (`C5`); `avancarComposicaoNovoAgendamentoV1` **não é chamada**; nenhum componente de domínio nem o resolvedor temporal chamados novamente; nenhuma continuação criada |
| ITC-19 | Interpretação persistida sem resultado da composição registrado | unitário futuro | A função pura **nunca é chamada**; resposta fixa; nenhuma reconstrução de `alteracoes_temporais` nem de `eventos_candidatos` |
| ITC-20 | Duas clínicas, fusos diferentes, mesma expressão temporal na mesma janela | segurança | Resultados independentes; nenhuma influência cruzada — mesma garantia já provada em `resolvedor-temporal-v1.md` TMP-55, agora através da composição |
| ITC-21 | Mesma entrada completa (estado + interpretação validada), duas execuções de `avancarComposicaoNovoAgendamentoV1` | unitário futuro | Resultado idêntico nas duas execuções — mesma garantia de determinismo já exigida dos cinco componentes de domínio |
| ITC-22 | Nenhum dado cadastral (nome, CPF, nascimento, e-mail) aparece em `alteracoes_temporais`, em `fatos_temporais` ou em qualquer resultado do resolvedor temporal | segurança | Ausência total — mesma garantia já provada em `resolvedor-temporal-v1.md` TMP-56 |
| ITC-23 | `avancarComposicaoNovoAgendamentoV1` retornando `NecessitaDadosComposicaoV1` para cada um dos seis tipos de dado condicional (seção 12) | unitário futuro | Cada requisição contém `tipo`, `clinica_id`, `parametros` mínimos e `motivo` fechado; nenhum campo fora desse contrato |
| ITC-24 | Resultado terminal (`DecisaoComposicaoV1` ou `FalhaFechadaComposicaoV1`) nunca executa I/O antes de retornar | unitário futuro | Nenhuma chamada de rede, banco ou relógio observável dentro da função pura, para nenhuma das duas variantes terminais |
| ITC-25 | Ordem das `alteracoes_temporais` dentro da mesma mensagem não altera o resultado da fusão | unitário futuro | `aplicarAlteracoesTemporais` produz a mesma lista recomposta (seção 10) independentemente da ordem de entrada das alterações |
| ITC-26 | Pausa antecipada (`pedir_procedimento`, procedimento não resolvido) chamada sem confirmação de efeito para a persistência final | composição futura | Nunca devolve `DecisaoComposicaoV1`; devolve `NecessitaEfeitoComposicaoV1` pedindo a persistência do passo 24 |
| ITC-27 | `solicitar_confirmacao` chamada sem confirmação de efeito para a mesma persistência final | composição futura | Mesma garantia da linha anterior, aplicada à última pausa possível — nenhuma pausa é exceção ao requisito de persistência antes da decisão terminal |
| ITC-28 | Falha de domínio persistível (`FalhaDominioPersistivelComposicaoV1`) originada no passo 23 também é precedida de persistência confirmada | composição futura | A falha candidata segue os mesmos passos 24–25 antes de ser devolvida como `FalhaFechadaComposicaoV1`; nunca devolvida na mesma chamada em que foi calculada |
| ITC-29 | Estado interpretado coerente (passo 8) nunca é observável com fatos temporais novos e `criterio_temporal`/`opcoes`/`escolha`/`resumo` da mensagem anterior simultaneamente | composição futura | O único estado que a função propõe para persistência entre os passos 6 e 9 já contém a invalidação aplicada; nenhum resultado intermediário expõe a combinação híbrida |
| ITC-30 | Critério temporal oficial com `horario_min` e `restricao` simultâneos | composição futura | `FalhaFechadaComposicaoV1` com `contrato_horario_exato_com_restricao_nao_suportado`; nenhuma requisição de snapshot diário; nenhuma opção gerada |
| ITC-31 | Campos de `ContextoDeterministicoComposicaoV1` (`clinica_id`, `fuso`, `instante_atual`, `message_id`, `conversa_id`) nunca são derivados de `alteracoes`, `alteracoes_temporais` ou de qualquer campo de saída da IA | segurança | Origem sempre autenticada/adaptador/transporte (seção 11); nenhum caminho de código deriva esses campos da interpretação |
| ITC-32 | Caso D3: resposta de efeito com `efeito_id`, `message_id`, `conversa_id` ou versão de estado incompatível com a requisição pendente — o efeito ainda está pendente, e o próprio `efeito_id` divergente já é, por si só, a divergência testada, nunca uma condição prévia que precise coincidir | composição futura | `efeito_confirmado_incompativel`; falha estrutural interna (seção 11, seção 17); nunca aplicado ao estado; nunca produz decisão terminal |
| ITC-33 | Continuidade acumulada ao longo de quatro leituras: catálogo, depois vínculos, depois configuração de duração, depois snapshot diário | composição futura | Cada chamada preserva integralmente os dados anteriores em `dados_condicionais_aceitos` (`C2`); a geração de opções usa catálogo, vínculos e duração obtidos em chamadas anteriores; nenhum dado depende de memória implícita |
| ITC-34 | Segunda chamada recebe a continuação e a resposta correta da requisição pendente | composição futura | Resposta aceita; dado incorporado; requisição deixa de estar pendente; etapa avança conforme a máquina determinar |
| ITC-35 | Resposta correlacionada a outra requisição (`requisicao_id` diferente do pendente) | composição futura | `resposta_nao_corresponde_requisicao`; nenhum dado aceito; nenhuma etapa avançada |
| ITC-36 | Resposta de outra clínica, outra conversa, outra mensagem ou outra versão de estado | segurança | Rejeitada — `resposta_nao_corresponde_requisicao` ou `continuacao_incompativel`, conforme o campo divergente; nenhum dado atravessa a fronteira de clínica ou de conversa |
| ITC-37 | Resposta de dado com `tipo` divergente do solicitado, com identidade coincidente | composição futura | `tipo_resposta_incompativel`; nunca aceita "por aproximação" |
| ITC-38 | Caso D1: a mesma chamada é repetida com a mesma continuação anterior (requisição ainda pendente), mesma resposta, mesmo contexto, mesmo estado e mesma versão | composição futura | Determinístico: resultado idêntico ao da primeira execução; o dado não é duplicado em `dados_condicionais_aceitos`; a etapa não avança duas vezes; nenhum avanço duplo |
| ITC-39 | Caso D2: chamada posterior recebe uma continuação presente, mas sem requisição pendente correspondente, e reapresenta a mesma resposta já aceita numa chamada anterior | composição futura | `resposta_sem_requisicao`; a resposta nunca é reincorporada; nunca tratada como duplicata válida (D1); a continuação não retrocede à etapa anterior; nenhum dado condicional duplicado |
| ITC-40 | Confirmação da persistência intermediária com as oito condições da transição legítima satisfeitas | composição futura | Transição aceita; `versao_estado`/`estado_oficial` da nova entrada substituem os registrados na continuação; dados condicionais vinculados a versão incompatível invalidados; requisição pendente descartada; a máquina retoma da etapa que ela própria determinou |
| ITC-41 | `conflito_versao` na persistência intermediária | composição futura | `FalhaFechadaComposicaoV1` com `conflito_versao`; **nenhuma `versao_estado_resultante` inventada**; nenhuma alteração aplicada |
| ITC-42 | Transição após persistência intermediária com exatamente uma das oito condições violada (por vez: `resultado` diferente de `confirmado`, `efeito_id` divergente, origem divergente, `versao_origem` divergente, `versao_estado` da entrada diferente de `versao_estado_resultante`, `estado_oficial` não idêntico ao `estado_proposto`, `tipo` diferente de `persistir_estado_interpretado`, ou `resultado_id` presente) | composição futura | `continuacao_incompativel` para cada violação isolada; nenhuma condição, sozinha, é suficiente para aceitar a transição; nenhum estado ou versão da continuação é alterado |
| ITC-43 | Resultado candidato preservado antes da persistência final, para uma pausa comum | composição futura | `resultado_candidato` presente na continuação com `resultado_id`, estado final proposto, resultado lógico, `resultado_terminal` (`DecisaoComposicaoV1`) e fatos autorizados, **antes** de a requisição de efeito ser emitida |
| ITC-44 | Resultado candidato preservado antes da persistência final, para uma falha fechada de domínio (`contrato_horario_exato_com_restricao_nao_suportado`) | composição futura | `resultado_candidato.resultado_terminal` contém a `FalhaDominioPersistivelComposicaoV1`, não uma `DecisaoComposicaoV1`; mesmo mecanismo de preservação da linha anterior |
| ITC-45 | Confirmação final compatível libera o resultado exato, para decisão e para falha de domínio | composição futura | O `resultado_terminal` devolvido é idêntico ao preservado, seja `DecisaoComposicaoV1` ou `FalhaDominioPersistivelComposicaoV1`; **nenhum resolvedor de domínio é reexecutado** entre a preservação e a devolução |
| ITC-46 | Confirmação final sem resultado candidato na continuação | composição futura | `resultado_candidato_ausente`; nenhum resultado recomputado para preencher a lacuna |
| ITC-47 | Confirmação final com `resultado_id` divergente do candidato preservado | composição futura | `resultado_id_incompativel`; o resultado preservado não é liberado |
| ITC-48 | União pública de `ResultadoAvancoComposicaoV1` | unitário futuro | Exatamente quatro famílias; **`ReplayComposicaoV1` ausente** (`C5`); todo resultado não terminal carrega `continuacao` |
| ITC-49 | Continuidade não depende de processo vivo | composição futura | Serializar a continuação, descartar todo estado em memória e chamar de novo com a continuação desserializada produz exatamente o mesmo resultado (`C1`) |
| ITC-50 | Caso D3: resposta de leitura com `requisicao_id` correto, mas `continuacao_id` diferente do da continuação corrente | composição futura | `resposta_nao_corresponde_requisicao`; nenhum dado aceito; nenhuma etapa avançada — divergência verificada apenas contra a requisição pendente, nunca contra histórico |
| ITC-51 | Caso D3: resposta de leitura cujo `dado` carrega identificadores (por exemplo, dentista e data de um snapshot) que divergem dos `parametros` fechados da própria requisição pendente | composição futura | `resposta_nao_corresponde_requisicao`; nenhum dado aceito; verificação estrutural contra os `parametros` da requisição, nunca contra uma resposta anterior |
| ITC-52 | Resposta condicional presente na primeira chamada de um turno, sem `continuacao` — violação da regra já fixada em `EntradaAvancoComposicaoV1` (seção 11, "Entrada") | unitário futuro | `resposta_sem_requisicao`; a resposta nunca é incorporada; cenário distinto de ITC-39 (que exige continuação presente, mas sem requisição pendente) |
| ITC-53 | Limite de concorrência: duas entradas distintas partem da mesma continuação pendente, cada uma com uma resposta diferente, individualmente compatível com a requisição pendente | composição futura | A função processa cada entrada isoladamente e produz, para cada uma, um resultado determinístico; nenhuma das duas chamadas sabe da outra; nenhuma reconciliação, nenhuma escolha de vencedora, nenhuma divergência histórica declarada; a seleção de qual avanço se torna oficial pertence exclusivamente a `P4` (seção 11, "Concorrência divergente fora do conhecimento da função") |

## 22. Fases futuras

Registro explícito do que esta especificação **não** resolve, para que uma
implementação futura saiba exatamente onde retomar — nenhuma destas fases é
antecipada, presumida ou parcialmente decidida por esta rodada:

1. **Plano de implementação fechado** — dividir esta especificação em etapas
   implementáveis (tipos internos, `aplicarAlteracoesTemporais`, a função pura de
   avanço, adaptadores de dados condicionais), cada uma com sua própria rodada de
   aprovação — mesmo processo já seguido para o resolvedor temporal antes de sua
   implementação.
2. **Persistência física** (`P4`) — schema, RPCs, transações e CAS concretos para
   estado interpretado acumulado e resultado da composição.
3. **Escolha da tecnologia de redação** (`P5`) — template, IA redatora controlada, ou
   combinação.
4. **Migração de `AlteracoesDados`/`CampoDadosConversa`** para o contrato V2 —
   remoção física de `data_texto`/`horario_texto` como campos de entrada, com análise
   explícita de compatibilidade com os cenários INT-01 a INT-19 já automatizados sobre
   o formato atual (`interpretacao-ia.md`, "Fatos temporais estruturados — contrato
   futuro").
5. **Adaptador temporal** (UTC/IANA/DST) — ainda não especificado nem implementado
   (`resolvedor-temporal-v1.md` §8, §28).
6. **Especificação operacional de confirmação e criação** — revalidação técnica real,
   criação idempotente do agendamento, persistência da confirmação (seção 16).
7. **Transporte/Edge Function** — entrada autenticada, limites de janela e payload,
   envio idempotente ou outbox (`interpretacao-ia.md`, "Limites").
8. **Representação física da continuação** (`P4`, `C1`) — formato de serialização,
   transporte entre chamadas, e o algoritmo concreto das identidades (`continuacao_id`,
   `requisicao_id`, `efeito_id`, `resultado_id`) e das identidades estáveis de entrada
   (`identidade_entrada`, seção 11). Esta especificação exige que sejam determinísticas
   e estáveis; **não escolhe** função de hash, formato ou codificação.
9. **Catálogo de falhas de adaptador e de efeito** (`CodigoFalhaAdaptadorV1`,
   `CodigoFalhaEfeitoV1`, seção 12) — os dois são nomeados como o lugar contratual por
   onde um erro técnico chega à máquina; seus valores concretos pertencem à
   especificação dos adaptadores, ainda não escrita.

## 23. Critérios de aceite

Esta especificação está pronta para orientar um plano de implementação quando:

- as decisões `P1`–`P5` e `C1`–`C5` estão registradas sem contradição em nenhum dos
  documentos harmonizados nesta mesma rodada (`composicao-novo-agendamento-v1.md`,
  `interpretacao-ia.md`, `controlador-conversacional-v1.md`, `persistencia-v1.md`,
  `docs/04-decisoes-canonicas.md`);
- o contrato de `alteracoes_temporais` (seção 6) é suficiente para expressar todo
  cenário de ITC-01 a ITC-06 sem ambiguidade;
- a correspondência entre categoria e tipo de átomo (seção 6) cobre exatamente os
  sete `tipo`s de `AtomoTemporal` já publicados, sem sobra e sem lacuna;
- a ordem determinística (seção 13) é consistente com a ordem já publicada em
  `composicao-novo-agendamento-v1.md` §9, sem reabrir nenhuma decisão daquela spec;
- o contrato do resolvedor temporal (seção 9) trata as sete variantes de
  `ResultadoResolucaoTemporal` sem omissão;
- a matriz de invalidação (seção 10, "alteração de qualquer categoria temporal
  invalida o critério anterior") é consistente com
  `composicao-novo-agendamento-v1.md` §14, sem contradição;
- nenhuma decisão terminal (seção 11) pode ser produzida, nesta especificação, sem
  persistência confirmada e vinculada antes dela (seção 13, seção 17); nenhum estado
  intermediário híbrido — fatos temporais novos com derivados de fatos antigos — é
  admitido pela ordem determinística (seção 13);
- o caso de `horario_min` e `restricao` simultâneos no critério temporal oficial
  produz sempre o mesmo código de falha fechada (seção 14, seção 20), nunca uma
  consulta de disponibilidade incompleta;
- toda continuidade entre chamadas da máquina está expressa em
  `ContinuacaoComposicaoV1` (seção 11), e nenhum passo da ordem determinística depende
  de memória global, processo vivo ou ordem presumida (`C1`);
- a união pública de `ResultadoAvancoComposicaoV1` tem exatamente quatro famílias, e o
  replay é atribuído a uma única autoridade — o orquestrador (`C5`, seção 17);
- nenhum tipo citado nesta especificação é usado sem estar definido ou explicitamente
  atribuído a uma spec já publicada;
- nenhum dos documentos harmonizados nesta mesma rodada (lista acima) afirma que esta
  integração, a persistência física, a porta de redação ou a confirmação já foram
  implementadas.

A implementação em si **não é autorizada por este critério de aceite** — ele avalia
somente a especificação, nunca substitui a rodada própria de plano de implementação
(fase 1 da seção 22).

## 24. Limites explícitos

Esta especificação **não**:

- implementa código, tipo TypeScript, teste executável, tabela, coluna, índice, RPC,
  migration ou schema físico;
- altera o algoritmo de nenhum dos cinco componentes de domínio já publicados;
- altera o catálogo de comandos, a ordem canônica ou a matriz de invalidação já
  publicada em `composicao-novo-agendamento-v1.md`, além do necessário para nomear
  onde a integração temporal se encaixa;
- decide a tecnologia de redação (`P5`);
- resolve persistência física de nenhuma entidade (`P4`), nem a representação física da
  continuação, nem o algoritmo concreto de nenhuma das identidades exigidas (seção 22);
- cria adaptadores, nem define os valores concretos de `CodigoFalhaAdaptadorV1` ou
  `CodigoFalhaEfeitoV1` (seção 12);
- remove fisicamente `data_texto`/`horario_texto` do contrato atual — o corte é lógico
  e documental (`P2`), a remoção física é fase futura (seção 22);
- autoriza tráfego real, acesso a Supabase, Google Calendar, painel, workflows, n8n,
  Evolution ou Vercel;
- cria confirmação, criação de agendamento, revalidação técnica real ou qualquer
  efeito operacional.

## 25. Invariantes

- A resolução temporal oficial é sempre resultado **derivado**; os átomos temporais
  persistidos são sempre a fonte interpretada **acumulada** — nunca reconstruídos a
  partir do critério oficial, de texto anterior, de resposta anterior ou de memória do
  modelo.
- `data_texto`/`horario_texto` (contrato legado) e `alteracoes_temporais`/
  `fatos_temporais` (contrato desta integração) nunca coexistem como autoridades
  temporais simultâneas — a versão do contrato determina qual caminho está ativo, sem
  modo híbrido.
- A categoria `intencao_temporal` (esta especificação) e o campo `intencao` de
  `CampoDadosConversa` (já publicado) são conceitos distintos, nunca confundidos.
- A composição é uma função pura: sem I/O, sem callback de acesso irrestrito,
  determinística, sem estado global, sempre retornando um resultado explícito ao
  orquestrador em vez de executar um efeito diretamente.
- `resolverTemporal` é chamado somente depois de interpretação validada, alterações
  temporais aplicadas e persistidas, invalidações calculadas, e procedimento,
  dentistas e duração já resolvidos — nunca antes.
- As sete variantes de `ResultadoResolucaoTemporal` recebem tratamento fechado; nenhuma
  é ignorada; `EntradaInvalidaError` é tratada como falha estrutural interna, nunca
  comunicada ao paciente como se fosse um fato de domínio.
- `aplicarAlteracoesTemporais` nunca resolve datas, nunca consulta relógio, nunca
  corrige fatos, e nunca rejeita por quantidade de átomos — esse limite é
  responsabilidade exclusiva do resolvedor temporal.
- A ordem de recomposição dos átomos (seção 7) e a ordem de `alteracoes_temporais`
  numa mesma mensagem nunca alteram o resultado semântico de nenhuma resolução
  temporal.
- Requisições de dados condicionais e de efeito emitidas pela função pura nunca
  incluem envio de WhatsApp, chamada à IA, ou gravação livre no banco — essas ações
  pertencem exclusivamente ao orquestrador, fora da função pura.
- Idempotência de composição (Caso A) só recupera resultado sem recomputar quando o
  resultado da composição está registrado; interpretação persistida sozinha (Caso B)
  nunca autoriza chamar a função pura desta composição.
- A porta de redação nunca decide, nunca interpreta o estado e nunca recebe mais fatos
  do que os explicitamente autorizados pela composição para o comando corrente.
- Nenhuma decisão terminal — `DecisaoComposicaoV1`, ou `FalhaDominioPersistivelComposicaoV1`
  (não `conflito_versao`, falha da própria escrita, nem violação de correlação) — é
  devolvida ao orquestrador antes de o par estado-final/resultado-lógico que a origina
  estar confirmado como persistido; esta garantia vale igualmente para as 18 pausas e
  para `solicitar_confirmacao`, sem exceção.
- Toda chamada não terminal devolve uma continuação explícita, imutável e serializável,
  e a chamada seguinte a recebe integralmente; nenhuma continuidade depende de memória
  global, closure, processo vivo, cache implícito, ordem presumida das chamadas ou
  dados mantidos informalmente pelo orquestrador (`C1`).
- Os dados condicionais já aceitos permanecem acumulados e tipados dentro da
  continuação; a máquina nunca recebe apenas "a resposta mais recente", e nenhum dado
  obsoleto sobrevive à invalidação apenas por ter sido obtido antes (`C2`).
- O resultado candidato é preservado íntegro na continuação antes da persistência
  final, e o resultado terminal devolvido é exatamente o resultado terminal candidato
  preservado — decisão conversacional ou falha de domínio persistível, igualmente —
  nenhum resolvedor é reexecutado para reconstruí-lo (`C3`).
- Toda requisição possui identidade única e origem fechada, e toda resposta ecoa as
  duas; correlação é verificada exclusivamente contra a requisição pendente presente
  na entrada, nunca contra um histórico ausente (D1/D2/D3); resposta incompatível
  produz falha fechada, e a reexecução integral idêntica (D1) é determinística (`C4`).
- O replay tem autoridade única: é resolvido pelo orquestrador antes de qualquer
  chamada à máquina, `ReplayComposicaoV1` não integra `ResultadoAvancoComposicaoV1`, e
  nenhuma continuação é criada durante um replay (`C5`).
- A máquina nunca detecta, nem declara, divergência entre execuções concorrentes que
  ela não recebeu na mesma entrada; duas respostas individualmente válidas para a
  mesma requisição pendente produzem, cada uma, um resultado determinístico isolado —
  a escolha de qual avanço se torna oficial pertence exclusivamente a `P4`.
- `ResultadoTerminalCandidatoV1` é uma união estreita — `DecisaoComposicaoV1` ou
  `FalhaDominioPersistivelComposicaoV1` — e nunca aceita falhas estruturais internas
  ou `conflito_versao`; o catálogo de falhas de domínio persistíveis só cresce por
  alteração documental aprovada.
- A máquina é a única autoridade sobre a continuação e sobre a etapa seguinte; o
  orquestrador nunca escolhe por onde a composição retoma.
- O estado interpretado nunca é persistido em duas gravações separadas para a mesma
  mensagem — fatos temporais novos e a remoção dos derivados que eles invalidam formam
  sempre um único par persistido atomicamente; nenhum estado oficial observável
  combina fatos novos com derivados de fatos antigos.
- `horario_min` e `restricao` simultâneos no critério temporal oficial produzem sempre
  `FalhaFechadaComposicaoV1` com `contrato_horario_exato_com_restricao_nao_suportado`,
  nunca uma consulta de disponibilidade incompleta.
- Nenhum campo de `ContextoDeterministicoComposicaoV1` é produzido, sugerido ou
  confirmado pela IA; nenhum desses campos é incorporado ao estado conversacional
  persistido; uma confirmação de efeito sem vinculação válida a `message_id`,
  `conversa_id`, versão do estado e identidade do efeito nunca é aplicada.
- Esta especificação não cria código, tipo TypeScript, tabela, coluna, RPC, migration,
  teste executável ou schema físico.
