# Mais de um procedimento pedido no mesmo turno deve virar "um de cada vez" — v1

**Status:** **aprovada pelo Gabriel; implementação autorizada** (2026-09-05). Registra um
defeito real, achado em teste manual de produção, e a correção aprovada.

- **Parecer técnico (Codex):** revisada, parecer favorável, sem bloqueadores documentais.
  Duas rodadas de revisão incorporadas antes da aprovação (remoção de
  `procedimentos_mencionados` e resposta obrigatoriamente genérica; contrato físico do
  evento fechado; declaração de que é correção de roteamento da `main`, não capacidade V2
  nova; teste da última mensagem realinhado ao que a solução representa).
- **Revisão de código e evidências (Codex, encerrada em 2026-09-05):** parecer técnico
  favorável à correção. Confirmado independentemente: roteamento corrigido (o evento não é
  mais engolido por `decidirPorNatureza`), histórico com os três nomes de procedimento
  chegando de fato no payload HTTP enviado à redatora, resposta genérica mesmo com os nomes
  visíveis, e percurso completo até a reserva do procedimento efetivamente escolhido.
  **Ressalva registrada, não bloqueante:** numa execução independente do Codex, o terceiro
  turno falhou com `valor_fora_do_dominio` em `saida.alteracoes.periodo.valor`; a execução
  seguinte passou sem o mesmo erro. Causa **indeterminada** — não atribuir ao ambiente, não
  afirmar que é preexistente, não investigado nesta rodada. Registrar como risco a
  acompanhar, não como bloqueador desta entrega.
- **Aprovação (Gabriel):** spec aprovada e implementação autorizada na branch
  `feat/pedido-multiplo`, criada a partir da `main`.
- **Publicada em 2026-09-05.** Autorizada explicitamente pelo Gabriel: merge
  `feat/pedido-multiplo` → `main` (fast-forward, commit `0d333b2`), push para
  `origin/main`, e deploy da Edge Function `iris-nova-mensagem` no projeto
  `udizowyfjnhuhgxkeayk` (v108 → v109, `verify_jwt: true` preservado). Rollback da v108
  preservado em `backups/rollback-iris-nova-mensagem-v108/`. Validação pós-deploy contra a
  v109 real confirmou o comportamento esperado (resposta genérica ao pedido múltiplo, sem
  regressão no fluxo normal) — detalhe completo no `ROLLBACK.md` daquele diretório.

## Para quem revisa isto sem contexto prévio

Este documento pede uma **revisão de arquitetura, segurança e aderência** à especificação
proposta — o mesmo papel que `AGENTS.md` (raiz do repositório `cappia-iris-core`) atribui
ao Codex no processo do projeto (seção "Processo obrigatório", passo 3).

**O que ler antes, nesta ordem** (todos em `cappia-iris-core`):

1. `docs/00-principios.md` — os 4 princípios que toda spec deve seguir; esta declara
   aderência a eles logo abaixo.
2. `docs/07-arquitetura-v2.md`, seção 2 — por que o Core (código determinístico) nunca
   decide o significado da mensagem do paciente; isso é sempre da IA de interpretação.
3. `specs/eventos-conversacionais-v1.md` — o contrato de "evento candidato": um sinal que
   a IA emite para dizer "a mensagem parece conter isto", sem decidir nem autorizar nada.
   Esta spec propõe um evento novo desse mesmo tipo (seção 3.1).
4. `supabase/functions/iris-nova-mensagem/interpretar-e-aplicar.ts`, função
   `lerRespostaTrocaTelefone` (a partir da linha ~270) — o precedente exato que esta spec
   segue: um evento candidato lido dentro de `interpretarEAplicar`, combinado com
   `natureza_mensagem` e um marcador de contexto pendente, produzindo um valor
   **transitório** que sai da função sem nunca ser persistido em `dados`. `pedido_multiplo`
   (seção 3.2) usa exatamente este mecanismo, não um novo.

**Esta spec é uma correção do roteamento hoje em produção (`main`), não uma capacidade
nova da Arquitetura V2** (`docs/07-arquitetura-v2.md`). O evento e a decisão propostos
vivem inteiramente no Core atual (`orquestrador.ts`, `interpretar-e-aplicar.ts`,
`interpretacao-instrucoes.ts`) — os mesmos arquivos que já decidem cancelamento,
remarcação e as demais decisões conversacionais. A única extensão fora do Core V1 é de
**mapeamento**, não de comportamento: `sombra-capacidade-v2.ts` precisa saber traduzir a
decisão nova para o vocabulário V2 (só medição em shadow mode, zero efeito em produção —
ver seção 3.4).

**Contexto mínimo do sistema, para quem nunca viu este projeto:** a Iris Nova é um
assistente de WhatsApp para clínicas odontológicas. Uma "IA de interpretação"
(`src/core/interpretacao-instrucoes.ts`) lê a mensagem do paciente e devolve campos
estruturados (procedimento, data, horário, `intencao`, eventos candidatos etc.) — nunca
decide o que fazer. Um "Core" determinístico (`src/core/orquestrador.ts`) lê esses campos
e decide o fluxo. Uma "redatora" separada (`src/core/redator-instrucoes.ts`) recebe os
fatos decididos pelo Core e escreve a resposta final ao paciente, em linguagem natural.

Os campos que carregam o pedido de agendamento em andamento — `procedimento_id`,
`data_texto`, `periodo`, `horario_texto` — são **singulares por construção**: cada um
guarda o valor de UM agendamento sendo negociado nesta conversa. Não existe, em nenhuma
camada (interpretação, resolução temporal, disponibilidade, reserva), uma representação de
"mais de um agendamento sendo pedido ao mesmo tempo".

## Aderência a `docs/00-principios.md`

- **Responsabilidade correta.** A IA de interpretação já é capaz de perceber que o
  paciente está pedindo mais de um procedimento — isso é leitura de linguagem natural, sua
  responsabilidade. O que falta é ela ter **onde colocar essa percepção** sem forçá-la
  dentro de um campo pensado para um valor só. A correção dá a ela esse lugar; não pede ao
  Core para adivinhar a partir de texto.
- **Remoção, não acréscimo por cima.** A regra atual (linha 84 de
  `interpretacao-instrucoes.ts`) manda "preservar todos os valores numa única string
  mínima" quando mais de um valor coexiste para o mesmo campo. Ela continua útil para o
  caso em que foi pensada (dois dentistas alternativos para o MESMO pedido). Esta spec não
  a duplica nem a contradiz: adiciona uma condição anterior e mais específica — pedidos
  **completos e distintos** (procedimento + dia/horário próprios cada um) — que precisa ser
  reconhecida ANTES de a regra genérica tentar empacotar os valores.
- **Teste isolado.** A seção 5 exige que o caso de "dois valores alternativos para o mesmo
  pedido" (já coberto, não deve mudar) seja testado ao lado do caso novo, provando que a
  distinção entre os dois se mantém.
- **Testes realistas.** O caso de origem é conversa real de teste manual do Gabriel,
  reproduzindo deliberadamente uma exigência maior sobre a Iris (seção 1).

## 1. O defeito, com evidência real

**Conversa real, WhatsApp, Cleardent, 2026-09-05** (paciente "Carlos", teste manual do
Gabriel, exigindo mais da Iris para observar o comportamento):

```
Iris:     [...] Também estão pendentes:
          • Cirurgia de implante — dente 31 — Dr. Pablo Arruda
          • Restauração / Cárie (1 face) — dente 23 — Dr. Pablo Arruda
          Você quer tratar do atendimento já marcado ou agendar um desses
          procedimentos pendentes?
Paciente: Quero marcar esses dois procedimentos.. vamos marcar um pra terça
          pode ser? o outro para quinta. tem horarios pra esos dois dias?
Iris:     Para verificar horários, preciso saber qual deles você quer na
          terça e qual na quinta. Pode me dizer essa divisão?
Paciente: Ciriguia de implante pode ser na terça.. e restauração para quinta
Iris:     Qual deles você prefere marcar na terça e qual na quinta? Assim
          verifico os horários disponíveis para cada atendimento.      ← LOOP
Paciente: cirugia de implante para terça feira.. e Restauração pra quinta
Iris:     Vou verificar os horários disponíveis [...]. Qual período você
          prefere: manhã ou tarde?
Paciente: na terça quero de manha. 10 hrs se tiver. e na quinta quero na
          parte da tarde 16hrs.
Iris:     [SEM RESPOSTA]
```

O paciente respondeu a mesma divisão (implante→terça, restauração→quinta) **três vezes**,
de formas diferentes, e a Iris repetiu a mesma pergunta como se ele não tivesse dito nada.
Na última mensagem, ao empilhar um terceiro par de campos (período+horário) sobre os dois
procedimentos e dois dias já pendentes, a Iris não respondeu nada.

## 2. Causa raiz

**O sistema nunca foi construído para representar dois agendamentos sendo negociados no
mesmo turno.** Não é falta de inteligência do modelo — é ausência de estrutura:

- `data_texto`, `periodo`, `horario_texto`, `procedimento_id` guardam um valor cada
  (`src/core/tipos.ts`, `CampoDadosConversa`). Não existe lista, par ou associação entre
  "procedimento X" e "dia Y" — cada campo é uma gaveta única, cega ao que está nas outras.
- A única instrução que trata "mais de um valor para o mesmo campo" é a regra genérica de
  `interpretacao-instrucoes.ts` linha 84: *"preserve todos em uma única string mínima, na
  ordem em que foram mencionados"*. Ela foi escrita pensando em alternativas do MESMO
  pedido (ex.: "pode ser com o Dr. Pablo ou a Dra. Ana"), nunca em dois pedidos completos e
  distintos.
- Quando o paciente deu dois procedimentos + dois dias, essa regra provavelmente produziu
  algo como `data_texto = "terça, quinta"` — uma string que nenhum resolvedor posterior
  (`resolverTemporal`, `resolverDisponibilidade`) sabe interpretar como duas datas válidas,
  porque nenhum deles foi construído para receber isso. O resultado observável foi o Core
  não conseguir avançar (loop) e, na mensagem final, aparentemente nem conseguir formar uma
  decisão válida (silêncio).

**Isto não tem solução dentro da regra genérica.** Calibrar a redação da regra não resolve
uma colisão estrutural: mesmo uma interpretadora perfeita não tem onde colocar dois pares
`(procedimento, dia, horário)` válidos sem misturá-los, porque o schema de saída só tem uma
gaveta.

## 3. Correção proposta

**Não é suportar múltiplos agendamentos simultâneos.** É reconhecer a condição e devolver a
conversa ao formato que o sistema já resolve bem: um pedido por vez, sequencialmente — do
jeito que uma pessoa atendendo o paciente também faria.

### 3.1 Sinal novo: evento candidato `pedido_multiplo`

Seguindo o padrão já estabelecido em `specs/eventos-conversacionais-v1.md` e implementado
em `EventoCandidatoIA` (`interpretacao-tipos.ts`): um evento é só um sinal — "a mensagem
atual parece conter isto" — nunca uma decisão. O Core valida e decide o que fazer.

**Forma física, igual à dos dois eventos já existentes** (`EventoCandidatoIA` é uma FORMA
ÚNICA, nunca uma união discriminada — seção "Dois tipos implementados" de
`interpretacao-tipos.ts`):

```ts
{ tipo: 'pedido_multiplo', referencia_textual: null }
```

`referencia_textual` existe no contrato para os eventos que precisam desambiguar uma
referência ("14h", "a segunda opção") — este evento não precisa: a existência do evento já
é o fato inteiro, não há nada para o Core resolver a partir de texto. Fica sempre `null`,
pela mesma razão que `aplicarAceitacaoDeOferta` já ignora esse campo deliberadamente
(comentário em `interpretar-e-aplicar.ts` linha ~180: "existe uma única oferta por vez,
então não há o que desambiguar").

Novo valor em `TIPOS_EVENTO_CANDIDATO_PERMITIDOS`: `'pedido_multiplo'`.

Rascunho da instrução (redação final a calibrar com o Gabriel):

> Emita o evento `pedido_multiplo` quando o paciente pedir, no mesmo turno, mais de um
> procedimento **distinto** para agendar — cada um com seu próprio dia, horário ou período
> pretendido (ex.: "quero marcar os dois, um na terça e outro na quinta"). Quando emitir
> este evento, **não** preencha `data_texto`, `periodo` nem `horario_texto` com os valores
> combinados dos dois pedidos — deixe esses campos totalmente ausentes; o sistema vai pedir
> ao paciente para escolher qual dos dois resolver primeiro. `procedimento_id` também fica
> ausente quando os dois procedimentos mencionados forem candidatos concorrentes (o
> paciente ainda não disse qual vem primeiro).
>
> Isto é diferente de valores ALTERNATIVOS para o MESMO pedido (ex.: "pode ser com o Dr.
> Pablo ou a Dra. Ana às 10h") — aí continua valendo a regra existente de preservar os dois
> valores numa string mínima, porque é um único agendamento com uma escolha em aberto, não
> dois agendamentos distintos.

### 3.2 Nova decisão do Core: `pedido_multiplo_detectado`

`orquestrador-tipos.ts` (`DecisaoOrquestrador`) ganha um tipo terminal **mínimo**, sem
nenhum dado carregado — o evento não fornece IDs de procedimento, e o Core não pode
inferi-los a partir de `tratamentos_pendentes` (essa lista pode ter três itens pendentes
sem relação com quais dois o paciente acabou de mencionar; inventar essa associação seria
o Core decidindo o significado da mensagem, o que é sempre da IA):

```ts
| { tipo: 'pedido_multiplo_detectado' }
```

A redatora recebe só o fato "há um pedido múltiplo" e formula uma pergunta
**obrigatoriamente genérica** sobre qual procedimento vem primeiro (seção 3.3) — nunca
nomeando nenhum procedimento específico, nem os que apareceram nesta mensagem nem os de
`tratamentos_aprovados`. Esta decisão não carrega, e não deve consumir, a lista de
tratamentos aprovados: se o paciente pediu dois entre três pendentes, nomear os três (ou
mesmo só os dois mencionados, que o Core não sabe identificar — seção 3.2) seria inventar
uma precisão que o sistema não tem. `DECISOES_COM_PLANO_DE_TRATAMENTO` (seção 4) **não**
inclui `pedido_multiplo_detectado`, por este motivo.

**Sinal transitório, nunca persistido — mesmo mecanismo de `resposta_troca_telefone`.**
`saida.eventos_candidatos` chega a `interpretarEAplicar` (`interpretacao-tipos.ts`,
`SaidaInterpretacao.eventos_candidatos`); dentro dessa mesma função, uma leitura dedicada
(nova, ao lado de `aplicarAceitacaoDeOferta` e `lerRespostaTrocaTelefone`) verifica
`eventos.some((e) => e.tipo === 'pedido_multiplo')` e expõe o resultado como um novo campo
booleano no retorno de `interpretarEAplicar` (ex.: `pedido_multiplo_detectado: boolean`) —
ao lado de `resposta_troca_telefone`, no mesmo objeto de retorno (linha ~805-813). Como
`resposta_troca_telefone`, este campo:

- não é lido de `dados`, nem gravado nele — existe só para esta passagem de
  `processarMensagem`;
- é consumido uma única vez em `orquestrador.ts`, antes do roteamento normal (seção abaixo);
- não sobrevive ao turno: se o paciente insistir na mesma ambiguidade no turno seguinte, o
  evento é emitido de novo pela IA, a partir da mensagem nova — não há um "modo pedido
  múltiplo" gravado em `contexto_horarios` nem em nenhuma outra tabela.

**Roteamento em `orquestrador.ts`:** quando `interpretacao.pedido_multiplo_detectado` for
`true`, o Core monta a decisão `{ tipo: 'pedido_multiplo_detectado' }` e **não** chama
`decidir()` — checagem posicionada **antes** do bloco de `dados.intencao === 'cancelamento'`
(linha ~728), pelo mesmo motivo que a spec de cancelamento já documenta para sua própria
posição: o pedido múltiplo não depende de catálogo, procedimento, dentista ou disponibilidade
resolvidos, e checar isto primeiro evita qualquer um dos fluxos seguintes tentar interpretar
campos que a regra de 3.1 deixou deliberadamente ausentes. Nenhum campo do agendamento em
andamento é limpo — o paciente pode estar no meio de outro pedido e só está adicionando um
segundo; o estado do primeiro continua intacto para quando ele voltar a ele.

### 3.3 Redação da resposta (redator-instrucoes.ts)

Ao receber `pedido_multiplo_detectado`, a redatora reconhece que o paciente pediu mais de
um procedimento e propõe resolver um de cada vez, perguntando qual vem primeiro — **sem
nomear nenhum procedimento**, porque a decisão (seção 3.2) não fornece essa informação e a
redatora não deve buscá-la em `tratamentos_aprovados` nem em nenhum outro lugar. Resposta
obrigatoriamente genérica, no espírito de:

> "Vamos marcar um procedimento de cada vez. Qual você quer marcar primeiro?"

Não é frase fixa (a redatora continua livre para formular naturalmente), mas o **conteúdo**
é obrigatório: nunca citar nomes de procedimento nesta resposta especificamente.

Depois que o paciente escolher, a mensagem seguinte contém só UM procedimento e o fluxo
normal de novo agendamento resolve normalmente. Nesse turno seguinte, o fluxo já existente
de `decidir()` se aplica sem nenhuma mudança: se o paciente, ao escolher o procedimento,
também repetir um dia/horário que já tinha dito antes na janela recente (o caso real da
seção 1 — o paciente redisse "terça"/"quinta" três vezes), a interpretadora aproveita esses
valores normalmente pela regra geral já existente ("produza somente o efeito final por
campo" — `interpretacao-instrucoes.ts` linha 49, e a leitura de `historico_recente` da
linha 83); ela só pergunta o que realmente ainda falta (ex.: só o horário, se dia e período
já ficaram claros). Este comportamento não é novo — é o contrato normal de preenchimento
incremental já vigente para qualquer campo; o único ponto novo desta spec é impedir que
esse preenchimento aconteça sobre uma mistura de dois pedidos ao mesmo tempo. O segundo
procedimento continua pendente em `tratamentos_pendentes`, que já existe e já chega à IA —
nada muda aqui.

### 3.4 Mapeamento na sombra V2 (medição, zero efeito em produção)

`sombra-capacidade-v2.ts` traduz cada `DecisaoOrquestrador` real para o vocabulário
experimental de `CapacidadeV2`, só para comparação em shadow mode
(`docs/07-arquitetura-v2.md` seção 10) — nunca influencia a decisão real nem a resposta ao
paciente. A função de tradução (a partir da linha ~90, `switch` sobre `decisao.tipo`) precisa
de um novo `case`:

```ts
case 'pedido_multiplo_detectado':
  return 'nenhuma_apenas_conversar';
```

Mesmo bucket de `aguardando_procedimento`, `aguardando_escolha_dentista` e
`aguardando_data_horario`: a Iris está conversando para resolver ambiguidade, sem consultar
nem alterar nada no sistema ainda. Sem este `case`, o `switch` (se exaustivo sobre o tipo)
deixaria de compilar assim que `pedido_multiplo_detectado` for adicionado a
`DecisaoOrquestrador` — não é uma escolha de design nova, é a consequência mecânica de
estender a união de tipos que a sombra já espelha.

## 4. O que NÃO muda

- Nenhuma lista, par ou associação `(procedimento, dia, horário)` é criada em nenhuma
  camada. `data_texto`/`periodo`/`horario_texto`/`procedimento_id` continuam singulares.
- `resolverTemporal`, `resolverDisponibilidade`, `reservarAgendamento` — nenhum muda. Eles
  continuam vendo sempre, no máximo, um pedido singular e válido por turno.
- A regra genérica de "mais de um valor para o mesmo campo, preserve numa string mínima"
  (linha 84) **continua existindo e válida** para o caso de alternativas do mesmo pedido —
  esta spec só acrescenta uma condição mais específica que precisa ser reconhecida antes
  dela, não a substitui.
- `tratamentos_pendentes` continua sendo só contexto informativo — o Core nunca decide
  fluxo a partir dele diretamente; quem decide `pedido_multiplo_detectado` é o evento da
  IA sobre a mensagem ATUAL, não a lista de pendentes em si (um paciente pode ter três
  tratamentos pendentes e pedir só um por vez, sem nunca disparar este caminho).
- `DECISOES_COM_PLANO_DE_TRATAMENTO` (`orquestrador.ts`) **não** ganha
  `pedido_multiplo_detectado`. A lista permanece exatamente como está hoje: esta decisão não
  recebe `tratamentos_aprovados`, justamente para que a resposta genérica da seção 3.3 não
  tenha como nomear procedimentos que o Core não sabe quais são.
- Nenhuma tabela, coluna, RPC ou migration nova.
- Nenhuma capacidade nova da Arquitetura V2. O mapeamento da seção 3.4 é só a extensão
  mecânica de um `switch` de medição já existente — não introduz comportamento, endpoint
  nem decisão nova naquela camada.

## 5. Verificação exigida antes da entrega/deploy

**Pré-condição para PUBLICAR (não para implementar):** a spec está aprovada e a
implementação autorizada (ver status no topo). O que continua dependendo de autorização
explícita e posterior do Gabriel é a publicação — merge na `main`, push para produção e
deploy da Edge Function —, após a revisão do código e destas evidências pelo Codex.

Toda a verificação usa a **conversa real completa** da seção 1 (não fragmentos), turno a
turno:

1. **Primeiro turno ambíguo** ("Quero marcar esses dois procedimentos.. vamos marcar um pra
   terça pode ser? o outro para quinta. tem horarios pra esos dois dias?") precisa já
   disparar `pedido_multiplo` **neste turno** — não no segundo ou terceiro. A Iris não pode
   pedir ao paciente para associar procedimento a dia quando o próprio estado não tem onde
   guardar essa associação; é este o defeito de origem (seção 1), e o evento existe
   exatamente para não deixar a conversa chegar a pedir isso.
2. Depois que o paciente escolhe qual procedimento vem primeiro (ex.: "cirurgia de implante
   para terça"), **somente esse pedido avança** — o outro procedimento não é tocado nem
   mencionado como se estivesse sendo agendado junto. Se o dia e/ou horário desse
   procedimento já estavam claros em mensagens anteriores da mesma janela (o paciente
   repetiu "terça"/"cirurgia de implante" três vezes na conversa real), o sistema aproveita
   o que já é recuperável do contexto sem re-perguntar, e pergunta **somente** o que
   realmente falta (seção 3.3) — nunca redemanda um dado que o paciente já deu.
3. **Teste direto da última mensagem** ("na terça quero de manha. 10 hrs se tiver. e na
   quinta quero na parte da tarde 16hrs."), isolado, como caso adicional além do fluxo
   normal — no fluxo já corrigido, este turno nem deveria ser alcançado, porque o primeiro
   pedido ambíguo (item 1) já teria sido interceptado antes de o paciente chegar a dar dois
   horários. Este teste isolado existe para cobrir o paciente que, de algum jeito, ainda
   chega a este ponto (ex.: retomando uma conversa antiga). Ele **não** exige preservar nem
   aplicar os dois pares período+horário — isso exigiria representar `(procedimento, dia,
   horário)` duplo, que é exatamente o que esta spec deixa fora de escopo (seção 4). Exige
   somente:
   - resposta obrigatória — nunca silêncio;
   - nenhuma mistura — nenhum par aplicado ao procedimento errado;
   - nenhuma consulta de disponibilidade nem reserva feita a partir de valores combinados
     dos dois pedidos;
   - a resposta reconduz à mesma solução desta spec: tratar um procedimento de cada vez,
     perguntando qual primeiro (o segundo par informado pode ser simplesmente descartado
     deste turno, sem necessidade de retê-lo — o paciente o repetirá ao chegar a vez dele).
4. **Teste isolado por causa:** um caso separado, com valores ALTERNATIVOS para o MESMO
   pedido (ex.: "pode ser com o Dr. Pablo ou a Dra. Ana"), precisa continuar caindo na regra
   antiga (string mínima preservada, pergunta de desambiguação de dentista) — provando que a
   distinção entre os dois casos não se perdeu.
5. Caso de dúvida real (paciente menciona dois procedimentos de passagem, sem pedir para
   agendar nenhum agora — ex. respondendo "quais vocês têm disponível?") não deve disparar
   `pedido_multiplo`: o evento é só para pedido de agendamento explícito e simultâneo dos
   dois.
6. Medição contra a IA real (não só teste sintético), no padrão já usado nas frentes
   fechadas do projeto — antes de qualquer deploy.
