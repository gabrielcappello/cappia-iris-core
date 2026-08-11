# Remarcação — camada conversacional v1

**Status:** especificação **proposta, não aprovada e não implementada**. Nenhuma migration,
RPC, coluna, tipo ou linha de código é criada por este documento.

Escopo: o paciente dizer naturalmente que quer remarcar o próprio agendamento, e o fluxo ir
até a confirmação e a execução. A camada operacional já está **fechada, implementada e
aplicada nos dois bancos** (`remarcacao-operacional-v1.md`, commit `bd3ff4a`) — esta spec
não a altera.

Fora de escopo: cancelamento; consulta completa do próprio agendamento; remarcação que
troque de dentista ou de procedimento; atualização cadastral.

## Aderência a `docs/00-principios.md`

- **Responsabilidade correta.** O Core não interpreta "quero remarcar", "o segundo" ou
  "pode ser". Ele declara o que está pendente e recebe campos fechados. Nenhuma lista de
  sinônimos, nenhum regex sobre linguagem.
- **Remoção.** Nenhuma tabela nova, **nenhum evento novo**, e **uma única decisão a mais do
  que o mínimo** — `remarcacao_falhou` foi auditada e **removida** (seção 6). O roteamento
  usa `dados.intencao`, que **já existe e hoje não tem nenhum consumidor** (seção 1). Um
  campo novo em `dados` (`agendamento_id`) entra por **medição contra a IA real**, não por
  suposição, e no mesmo padrão já provado de `procedimento_id`/`dentista_id` (seção 3).
- **Teste isolado.** Os pares A/B obrigatórios estão na seção 8.
- **Testes realistas.** As frases da seção 8 seguem o registro real de WhatsApp.

## Auditoria — o que já existe e é reaproveitado

| mecanismo | estado hoje | uso na remarcação |
|---|---|---|
| `dados.intencao` | existe, validado contra `INTENCOES_PERMITIDAS = ['novo_agendamento']`, **lido por nenhum consumidor** | ganha o valor `'remarcacao'` e passa a rotear |
| `buscarAgendamentoAtivo` | **pronto**, testado, commitado | localiza o agendamento |
| `dados.data_texto` / `periodo` / `horario_texto` | prontos, alimentam `montarFatosTemporais` → `resolverTemporal` | nova data/horário, sem nenhuma mudança |
| `carregarEntradaDisponibilidade` + `resolverDisponibilidade` | prontos | disponibilidade, sem nenhuma mudança |
| `contexto_horarios` (4 variantes de marcador pendente) | pronto, em produção | ganha a 5ª variante |
| `natureza_mensagem` | pronto, obrigatório em todo turno | recusa/desistência |
| `dados.confirmacao` | pronto | confirmação da troca (seção 5) |
| `remarcarAgendamento` (adapter) + `cappia_remarcar_agendamento_v2` | **prontos**, aplicados nos dois bancos | execução |

**Nada de legado é tocado:** `cappia_remarcar_agendamento` (sem sufixo),
`cappia_disponibilidade_canonica`, `comandos_remarcacao` e `remarcacoes_pendentes`
permanecem sem uso pela Iris Nova.

## 1. Como a intenção de remarcação chega

`INTENCOES_PERMITIDAS` passa de `['novo_agendamento']` para
`['novo_agendamento', 'remarcacao']`. **Um valor a mais num enum que já existe** — nenhum
campo novo, nenhuma tabela, nenhum evento.

Achado da auditoria que sustenta a escolha: hoje **nenhum código lê `dados.intencao`**. Ele
é validado em `aplicar-dados.ts` e persistido, e nada decide com base nele. A remarcação é
o **primeiro consumidor real** desse campo — foi para isso que ele nasceu.

Instrução à IA (uma linha, no mesmo lugar onde `novo_agendamento` já é instruído): emitir
`intencao = remarcacao` quando a janela atual expressar o pedido de **mudar um atendimento
que já existe**; mencionar data ou horário, sozinho, nunca emite intenção — regra idêntica à
que já vale para `novo_agendamento`.

**O Core nunca infere a intenção a partir da existência de um agendamento ativo.** Um
paciente com consulta marcada que diga "quero marcar uma limpeza" está pedindo um segundo
agendamento, não remarcando o primeiro. Quem distingue é a IA, lendo a frase.

### Ciclo de vida de `intencao`

`dados` persiste entre turnos, então `intencao = remarcacao` sobrevive até ser trocada ou
removida. Isso é o desejável num fluxo multi-turno (mesmo comportamento de
`procedimento_id`), mas exige um ponto de saída explícito:

| evento | efeito sobre `intencao` |
|---|---|
| remarcação concluída (`remarcacao_criada`) | **removida** |
| `natureza_mensagem === 'negacao'` / desistência | **removida** |
| IA emite `corrigir` em `intencao` | substituída (o paciente mudou de ideia) |
| qualquer outro turno | preservada |

Sem a remoção no sucesso, o turno seguinte reentraria no fluxo de remarcação sobre um
agendamento que acabou de virar `'remarcado'`.

## 2. Localizar o agendamento

`buscarAgendamentoAtivo(cliente, { clinica_id, paciente_id, instante_atual })` — já pronto.
Chamado somente quando `intencao === 'remarcacao'`.

| resultado | decisão do orquestrador |
|---|---|
| `nenhum` | `sem_agendamento_para_remarcar` |
| `unico` | segue direto, **sem anunciar informação redundante** |
| `multiplos` | `aguardando_escolha_agendamento` |

O caso `unico` seguir direto sem perguntar "é o do dia 15 às 14h?" é a mesma regra canônica
já vigente para dentista único apto (`04-decisoes-canonicas.md`): não perguntar o que já
está resolvido de forma inequívoca. A data e o horário atuais aparecem naturalmente na
proposta da seção 5.

**Paciente não identificado** (`paciente_id` nulo, telefone sem cadastro): resulta em
`sem_agendamento_para_remarcar`. Um paciente sem ficha não tem agendamento por definição, e
esta v1 **não** oferece cadastro no fluxo de remarcação — não há o que remarcar.

## 3. Escolha entre vários agendamentos — **contrato fechado por medição**

Medição executada em 2026-08-11 contra a IA real
(`src/eval/medicao-escolha-agendamento.ts`, `gpt-4.1-mini-2025-04-14`), **11 frases reais de
paciente**, cenários de dois e três agendamentos ativos, três contratos concorrentes:

| contrato | o que a IA devolve | placar |
|---|---|---|
| **A — id direto** | `agendamento_id` em `alteracoes` (padrão de `procedimento_id`/`dentista_id`) | **11/11** |
| B — evento | `aceitar_opcao` + `referencia_textual` | 11/11 (**enganoso**, ver abaixo) |
| C — só a lista | nada dedicado; só os campos que já existem | **0/11** |

**Contrato adotado: A.** O payload leva `agendamentos_ativos: [{ agendamento_id, descricao }]`
e a IA devolve o `agendamento_id` escolhido. Novo `CampoDadosConversa`: `agendamento_id`.

### Por que B foi descartado apesar do 11/11

B emitiu o evento em 11/11, mas `referencia_textual` voltou sempre com a **frase crua**:
`"o segundo"`, `"a limpeza"`, `"o da sexta"`, `"o do Dr Bruno"`. Ou seja: o evento
transfere ao **Core** a tarefa de interpretar português — resolver ordinal, nome de
procedimento, dia da semana e nome de dentista contra a lista. É exatamente a inversão de
responsabilidade que `00-principios.md` proíbe, e que já custou ~1.300 linhas em
`procedimento-semantico-v1.md`. **O placar de B mede a emissão do evento, não a resolução da
escolha** — passaria verde sem resolver o problema.

### Por que C não é apenas insuficiente, é nocivo

C não identificou o agendamento em nenhum caso — o esperado, já que não tem onde responder.
O achado relevante é outro: **a lista no payload contamina os campos existentes.** Saída
literal medida:

- `"a limpeza"` → `procedimento_id=limpeza` (texto cru num campo que só aceita ID canônico)
- `"o do Dr Bruno"` → `dentista_id=Dr Bruno`
- `"o da sexta"` → `data_texto=15/08`
- `"o das 16:30"` → `horario_texto=16:30`
- `"o segundo"` → `procedimento_id=22222222-...` (o **UUID do agendamento** no campo de procedimento)

Esses valores seriam aplicados a `dados` e corromperiam o procedimento, o dentista e —
pior — a **data/horário novos** do próprio fluxo de remarcação. Conclusão operacional:
`agendamentos_ativos` **nunca pode ser enviado ao modelo sem `agendamento_id` disponível
como destino**. Os dois andam juntos ou nenhum dos dois vai.

### Marcador pendente

Quinta variante de `ContextoHorarios`, no mesmo padrão das quatro existentes:

```ts
escolha_agendamento_pendente?: { agendamento_ids: string[] };
```

A ordem do array **é** a ordem em que a Iris apresentou as opções. Nova ação em
`derivarAcaoContextoHorarios`: `{ tipo: 'perguntar_qual_agendamento'; agendamento_ids }`.

O snapshot carrega **somente os IDs**; as descrições que a IA lê são montadas no payload do
turno a partir de `AgendamentoAtivo[]`, nunca persistidas — mesmo critério que manteve CPF e
`paciente_id` fora de `troca_telefone_pendente`.

**O Core valida o retorno:** `agendamento_id` só é aceito se estiver na lista que foi
oferecida naquele turno. ID fora da lista é descartado — nunca é usado para localizar
agendamento, nem mesmo se existir no banco. É a mesma conferência de integridade que o Core
já faz com `procedimento_id` e `dentista_id`.

### Limite medido e aceito

`natureza_mensagem` variou entre `pedido`, `resposta` e `correcao` para a **mesma frase**
entre contratos. Portanto ela **não serve de gate** para a escolha de agendamento — só o
marcador pendente e o `agendamento_id` decidem. `natureza_mensagem` continua valendo apenas
onde já vale hoje: derivar recusa (`negacao`).

## 4. Nova data e horário

Nenhuma mudança. `data_texto`, `periodo` e `horario_texto` já são acumulados e já alimentam
`montarFatosTemporais` → `resolverTemporal`. A disponibilidade usa
`carregarEntradaDisponibilidade` com o **`procedimento_id` e o `dentista_id` do agendamento
localizado** — nunca re-resolvidos, nunca perguntados de novo: remarcação v1 mantém
procedimento e profissional.

As decisões existentes são reaproveitadas sem alteração: `aguardando_data_horario`,
`horarios_disponiveis`, `sem_dentista_disponivel`, `duracao_nao_configurada`.

**Limitação herdada (`remarcacao-operacional-v1.md` §10.1):** o agendamento atual continua
contando como ocupado na própria disponibilidade. No mesmo dia, horários que dependam de
liberar a faixa atual não são oferecidos. A redação **não** deve afirmar que o dia está
cheio — a decisão `sem_disponibilidade` já produz "não encontrei horários nessa data", que
permanece verdadeira e suficiente.

## 5. Confirmação explícita

Decisão nova `aguardando_confirmacao_remarcacao`, com o agendamento atual e a opção nova:

```ts
{ tipo: 'aguardando_confirmacao_remarcacao';
  agendamento_atual: AgendamentoAtivo;
  procedimento_id: string; dentista_id: string; opcao: OpcaoHorario }
```

**Por que não reusar `aguardando_confirmacao`.** O texto ao paciente é diferente: um novo
agendamento confirma "dia 20 às 9h, confirma?"; uma remarcação precisa dizer **de onde para
onde** ("hoje você está no dia 15 às 14h — quer passar para o dia 20 às 9h?"). Reaproveitar
a decisão obrigaria a redatora a adivinhar qual das duas frases usar a partir de um campo
opcional. Decisão separada porque o **significado operacional** é diferente, não por
conveniência estrutural.

A ação de contexto é a que já existe: `{ tipo: 'propor' }` — o mesmo `proposta_pendente` que
já permite à IA ler "pode ser" como resposta a **esta** proposta.

**`dados.confirmacao` é reusado**, e aqui a semântica é genuinamente a mesma: confirmar o
horário proposto. Mas com uma exigência: **entrar no fluxo de remarcação limpa
`confirmacao`.** Sem isso, um `'sim'` remanescente de um agendamento concluído antes na
mesma conversa autorizaria a remarcação sozinho, sem ninguém ter perguntado nada — o
mesmo defeito que `cpf-outro-telefone-v1.md` §2 impediu ao recusar reusar `confirmacao` lá.
O teste 6 da seção 8 existe para provar que isso não acontece.

## 6. Execução e desfechos

Confirmado, o Core chama `remarcarAgendamento` (adapter pronto) com os identificadores já
resolvidos. **Uma única decisão nova:**

| decisão | quando | o que a redatora diz |
|---|---|---|
| `remarcacao_criada` | `tipo: 'remarcado'` | confirma a nova data/horário; **nunca** menciona o agendamento antigo como "cancelado" |
| `reserva_conflito` (**reusada**) | `motivo: 'horario_ocupado'` | o horário foi ocupado; escolha outro |
| `reserva_falhou` (**reusada**) | `tipo: 'falhou'`, demais motivos | frase técnica genérica já existente |

### `remarcacao_falhou` — auditada e removida

A spec previa uma decisão própria para a falha. A auditoria de 2026-08-11 a **eliminou**.

**Os motivos não são desfechos distintos para o paciente.** `data_invalida`,
`horario_invalido` e `duracao_invalida` são **inalcançáveis**: `validarEntrada` do adapter
lança `EntradaInvalidaError` antes de a RPC ser chamada. Restam `agendamento_nao_encontrado`
e `nao_confirmado` (corrida real: a linha mudou entre a busca e a confirmação) e
`erro_insercao` (técnico).

**O `motivo` nunca é lido.** Verificado no código: os três consumidores de `reserva_falhou`
(`gerar-resposta-paciente.ts:148`, `contexto-horarios.ts:145`, `fatos-autorizados.ts:160`)
tratam a decisão como rótulo de caso; o campo `motivo` é carregado e descartado. Cinco
decisões técnicas diferentes já colapsam na **mesma** frase
(`RESPOSTA_FALHA_TECNICA_GENERICA`).

**E o caso de corrida se autocorrige.** Se o agendamento sumiu no meio do fluxo, a frase
técnica genérica pede para tentar de novo; no turno seguinte `buscarAgendamentoAtivo`
devolve `nenhum` e o paciente recebe `sem_agendamento_para_remarcar` — a mensagem
**verdadeira**, por uma decisão que já existe nesta spec. Criar `remarcacao_falhou` só
anteciparia um palpite.

**Por que reusar `reserva_falhou` e não lançar exceção.** Auditei o caminho de erro: lançar
do orquestrador cai no `catch` de `index.ts:183` e devolve **HTTP 500 sem nenhuma mensagem
ao paciente** — silêncio, pior que a frase genérica. O mecanismo técnico existente que
**falha fechado e ainda responde** é a decisão mapeada para a frase genérica. É ele que
está sendo reusado.

> **Dívida registrada, não corrigida aqui:** o nome `reserva_falhou` passa a cobrir também a
> remarcação. Renomeá-lo para algo neutro (`falha_tecnica_execucao`) tocaria produção por
> motivo cosmético, no meio de uma feature. Fica registrado para uma rodada própria.

**`horario_ocupado` reusa `reserva_conflito`** porque o desfecho para o paciente é
literalmente o mesmo: o horário foi ocupado entre a oferta e a confirmação, e é preciso
escolher outro. Criar uma segunda decisão para dizer a mesma frase seria duplicação. O fluxo
volta para a escolha de horário — `intencao` e o agendamento localizado **permanecem**, e só
`proposta_pendente` é descartada.

**`ja_remarcado: true` é tratado como sucesso normal**, sem texto próprio. O paciente que
reenviou a confirmação depois de um timeout recebe a mesma confirmação — que é verdadeira.

## 7. Ciclo de vida do contexto

`derivarAcaoContextoHorarios` é exaustiva sobre as decisões: nenhuma das novas compila sem
`case`, então nenhuma fica sem ciclo de vida por esquecimento.

| decisão | ação sobre `contexto_horarios` |
|---|---|
| `aguardando_escolha_agendamento` | `perguntar_qual_agendamento` |
| `aguardando_confirmacao_remarcacao` | `propor` |
| `sem_agendamento_para_remarcar` | `limpar` |
| `remarcacao_criada` | `limpar` |
| `reserva_conflito` / `reserva_falhou` (reusadas) | `limpar` (já é o comportamento atual) |

**As quatro decisões novas, ao todo:** `sem_agendamento_para_remarcar`,
`aguardando_escolha_agendamento`, `aguardando_confirmacao_remarcacao`, `remarcacao_criada`.

Mensagem que não responde à pergunta pendente: o fluxo **re-deriva** e regrava o mesmo
marcador — mesmo desenho já adotado para a oferta de procedimento e para a troca de
telefone, em vez de um caso "preservar".

## 8. Testes mínimos

Frases conforme registro real de WhatsApp — nenhuma inventada para forçar comportamento.

**Caminho principal**

1. *"Preciso remarcar minha consulta"*, um agendamento ativo → segue direto para data/horário,
   **sem** perguntar qual agendamento.
2. *"Pode ser quinta de manhã?"* → opções do dia, com procedimento e dentista do agendamento
   existente.
3. *"O primeiro tá bom"* → `aguardando_confirmacao_remarcacao` citando **de onde para onde**.
4. *"Isso, pode mudar"* → `cappia_remarcar_agendamento_v2` chamada; `remarcacao_criada`.
5. Sem agendamento futuro → `sem_agendamento_para_remarcar`; **nenhuma** chamada à RPC.
6. Agendamento **passado** apenas (confirmado, já ocorrido) → `sem_agendamento_para_remarcar`.

**Isolamento (pares A/B obrigatórios)**

7. Mesma frase *"pode mudar sim"*, variando **só** `intencao` (`remarcacao` × ausente): com
   ela, remarcação; sem ela, nunca. **Os dois lados precisam diferir.**
8. `dados.confirmacao === 'sim'` remanescente de um agendamento anterior + entrada em
   remarcação → **nenhuma remarcação executada** sem confirmação nova. Prova que a
   autorização não vem do campo herdado (seção 5).
9. Mesma frase *"o segundo"*, variando **só** o marcador `escolha_agendamento_pendente`: sem
   ele, nenhum agendamento é escolhido.
10. `agendamento_id` devolvido pela IA **fora** da lista oferecida → descartado; nenhum
    agendamento localizado por ele (seção 3).
11. `agendamentos_ativos` **nunca** vai ao modelo sem `agendamento_id` disponível como
    destino — regressão direta do achado do contrato C (seção 3), que corrompia
    `procedimento_id`, `dentista_id`, `data_texto` e `horario_texto`.

**Desfechos**

12. `horario_ocupado` → `reserva_conflito`; agendamento antigo **intacto**; fluxo volta para
    horário, `intencao` preservada.
13. `ja_remarcado: true` → mesma resposta de sucesso, sem texto de exceção.
14. Segunda mensagem depois de `remarcacao_criada` → `intencao` já removida; não reentra em
    remarcação.
15. `tipo: 'falhou'` com motivo técnico → `reserva_falhou`, frase genérica; **nenhuma**
    escrita; turno seguinte devolve `sem_agendamento_para_remarcar` quando a corrida foi a
    causa (seção 6).

## 9. Pendências abertas por esta spec

- **`agendamento_id` é um `CampoDadosConversa` novo** — o único campo novo desta spec.
  Entrou por medição (11/11), no padrão já provado de `procedimento_id`/`dentista_id`, e
  com a evidência de que a alternativa sem campo **corrompe** quatro campos existentes.
  Precisa do mesmo ciclo de vida das demais chaves de `dados`: removido junto com
  `intencao` no sucesso e na desistência.
- **`reserva_falhou` passa a cobrir remarcação** sem mudar de nome (seção 6). Dívida de
  nomenclatura registrada, para rodada própria.
- **Paciente sem cadastro não pode remarcar** e não recebe oferta de cadastro (seção 2).
  Deliberado nesta v1.
- **A limitação §10.1 fica visível ao paciente** como "menos opções no mesmo dia". Aceita,
  registrada, não corrigida aqui.
- **`INTENCOES_PERMITIDAS` passa a ter dois valores**, e `intencao` ganha seu primeiro
  consumidor. Se cancelamento entrar depois, será um terceiro valor — não um mecanismo novo.
