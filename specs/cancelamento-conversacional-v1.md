# Cancelamento — spec mínima v1

**Status:** especificação **proposta, aprovada em decisão de fluxo pelo Gabriel em
2026-08-11, ainda não implementada.** Nenhuma migration, RPC, coluna, tipo ou linha de
código é criada por este documento.

Escopo: o paciente dizer naturalmente que quer cancelar o próprio agendamento, e o fluxo ir
até a confirmação explícita e a execução. Sem destino — é a diferença estrutural que torna
esta spec **menor** que `remarcacao-conversacional-v1.md`: não há resolução temporal, não há
disponibilidade, não há duração, não há um segundo horário a calcular.

Fora de escopo: consulta completa do próprio agendamento; atualização cadastral; qualquer
notificação ativa à clínica (outbox continua fora do projeto).

Antecede: `docs/06-roadmap.md`, item "Cancelamento" — segunda frente pós-fechamento de
remarcação (`handoffs/2026-08-11...`, a registrar no fechamento desta etapa).

## Aderência a `docs/00-principios.md`

- **Responsabilidade correta.** A IA nunca decide se um cancelamento acontece — ela só
  classifica a intenção da frase e, depois, se a mensagem confirma a pergunta pendente.
  Quem localiza, pergunta, exige confirmação e executa é o Core, determinístico, do início
  ao fim. **O Core nunca faz match de palavra** — nem para intenção, nem para confirmação
  (seção 4): ele só lê os campos fechados (`intencao`, `confirmacao`) que a IA já
  classificou semanticamente. Nenhum parser lexical, nenhum enum de frases aceitas, em
  nenhuma camada.
- **Remoção.** Nenhuma tabela nova, nenhum evento novo, nenhuma coluna nova, **nenhuma regra
  de prompt nova para a classificação de intenção** — a medição de 2026-08-11
  (`src/eval/medicao-colisao-desistencia-cancelamento.ts`,
  `medicao-stress-cancela-isso.ts`) mostrou que o contexto que já existe hoje
  (`dados_atuais` vazio vs. em andamento + `historico_recente`) distingue desistência da
  conversa de cancelamento de agendamento existente **melhor** do que as duas variantes de
  regra explícita testadas — ambas pioraram o resultado (seção 3). **Nenhuma regra de prompt
  nova para a confirmação**, tampouco — o mecanismo de `proposta_pendente` e a regra de
  concordância semântica já existem, já cobrem respostas sem "sim" literal ("pode", "ok",
  "isso", "beleza"), e não são reescritos por esta spec (seção 4).
- **Teste isolado.** Os pares A/B obrigatórios estão na seção 9.
- **Testes realistas.** As frases da seção 3 e da seção 9 vêm da própria medição contra a IA
  real, não inventadas para forçar comportamento.

## Auditoria — o que já existe e é reaproveitado

| mecanismo | estado hoje | uso no cancelamento |
|---|---|---|
| `dados.intencao` | `INTENCOES_PERMITIDAS = ['novo_agendamento', 'remarcacao']` | ganha o valor `'cancelamento'` |
| `buscarAgendamentoAtivo` | pronto, em produção (remarcação) | localiza o agendamento — **reuso integral, zero mudança** |
| `dados.agendamento_id` | pronto, medido 11/11 (remarcação) | escolha entre múltiplos — **reuso integral** |
| `contexto_horarios.escolha_agendamento_pendente` + ação `perguntar_qual_agendamento` | pronto, em produção | **reuso integral, sem novo marcador** (seção 5) |
| `dados.confirmacao` | pronto | autoriza a execução — concordância semanticamente clara com `proposta_pendente`, classificada pela IA (sem repertório fechado de frases), nunca por palavra literal do paciente (seção 4) |
| `natureza_mensagem === 'negacao'` | pronto | desistência do fluxo de cancelamento |
| `descreverAgendamentoAtivo` (orquestrador.ts) | pronto, em produção | descreve o agendamento na pergunta de confirmação |

**RPC:** a legada `cappia_cancelar_agendamento(p_agendamento_id, p_clinica_id)` existe no
banco operacional (auditoria read-only 2026-08-11) e **não é reaproveitável com segurança**:
não recebe `p_paciente_id` (qualquer agendamento da clínica é cancelável, sem checar dono) e
não valida `status = 'confirmado'` antes de cancelar (só trata o caso `status = 'cancelado'`
como replay). A remarcação já provou o padrão certo — RPC nova, sufixo `_v2`, com
`p_paciente_id` no `WHERE` (seção 6).

## 1. Como a intenção de cancelamento chega

`INTENCOES_PERMITIDAS` passa de `['novo_agendamento', 'remarcacao']` para
`['novo_agendamento', 'remarcacao', 'cancelamento']`. Um valor a mais no mesmo enum.

**Nenhuma linha de instrução nova no prompt para esta classificação.** Decisão do Gabriel em
2026-08-11, sustentada pela medição (seção 3): a IA já infere `intencao = cancelamento`
corretamente a partir do contexto que o payload já carrega — `dados_atuais` vazio (nada em
andamento) versus em andamento (`procedimento_id`/`dentista_id`/`horarios_oferecidos`
presentes), combinado com `historico_recente` quando existe. Adicionar o valor ao enum do
schema e ao rodapé "Valores permitidos para intencao" já é suficiente.

### Ciclo de vida de `intencao`

Mesma tabela já aprovada para `remarcacao`, generalizada:

| evento | efeito sobre `intencao` |
|---|---|
| cancelamento concluído (`cancelamento_criado`) | **removida** |
| `natureza_mensagem === 'negacao'` / desistência, com `intencao` em `{remarcacao, cancelamento}` | **removida** |
| IA emite `corrigir` em `intencao` | substituída |
| qualquer outro turno | preservada |

`deveLimparRemarcacaoPendente` (orquestrador.ts) generaliza para `deveLimparEscolhaPendente`,
cobrindo os dois desfechos de sucesso (`remarcacao_criada`, `cancelamento_criado`) e
desistência com `intencao` em qualquer um dos dois valores — **nenhuma duplicação de
função**, um `includes` a mais.

## 2. Localizar o agendamento

Idêntico à seção 2 de `remarcacao-conversacional-v1.md`, **sem nenhuma alteração**:
`buscarAgendamentoAtivo(cliente, { clinica_id, paciente_id, instante_atual })`, chamado
quando `intencao === 'cancelamento'`.

| resultado | decisão do orquestrador |
|---|---|
| `nenhum` | `sem_agendamento_para_cancelar` |
| `unico` | segue direto para a confirmação (seção 4) |
| `multiplos` | `aguardando_escolha_agendamento_cancelamento` |

Paciente não identificado (`paciente_id` nulo): `sem_agendamento_para_cancelar`. Mesma
justificativa da remarcação — sem ficha não há agendamento por definição, e esta v1 não
oferece cadastro neste fluxo.

## 3. Medição — colisão desistência × cancelamento

Executada em 2026-08-11 contra a IA real (`gpt-4.1-mini-2025-04-14`), payload fiel a
produção (catálogo, dentistas, `historico_recente`, `dados_atuais` refletindo o estado real
de cada contexto).

**Contexto A** — novo agendamento em andamento (`dados_atuais` com `procedimento_id`,
`dentista_id`, `data_texto`; `horarios_oferecidos` presente). Frases de desistência da
conversa: *"deixa pra lá"*, *"não quero mais marcar"*, *"cancela isso"*. **Nenhuma delas
pode emitir `intencao = cancelamento`.**

**Contexto B** — `dados_atuais` vazio, paciente com agendamento existente citado no
`historico_recente`. Frases: *"quero cancelar minha consulta"*, *"cancela meu horário"*,
*"não vou poder ir, cancela pra mim"*, *"cancela isso"*. **Todas devem emitir
`intencao = cancelamento`.**

| variante testada | acerto (2 baterias de 7) | perigosos (cancelou sem pedido) |
|---|---|---|
| **nua** — só o valor no enum, zero instrução | 6/7 e 7/7 (o erro da 1ª foi timeout de rede, não resposta errada) | **0/7 e 0/7** |
| candidata — +1 linha citando "cancela isso" como exemplo de negação | 5/7 e 5/7 | 0/7 e 0/7 |
| candidata — +1 linha sem o exemplo literal, só a condição | 6/7 e 7/7 | **1/7 numa das duas rodadas — instável, não reproduzido de forma segura** |

**Stress test dedicado** no par mais frágil ("cancela isso" nos dois contextos, variante nua,
8 repetições cada):

- Contexto A ("cancela isso" sem agendamento marcado): `intencao = cancelamento` em **0/8**.
- Contexto B ("cancela isso" com agendamento citado no histórico): `intencao = cancelamento`
  em 6/8; os outros 2/8 caem em `negacao`/nada — **nunca** em cancelamento indevido.

**Conclusão adotada:** variante nua. As duas tentativas de reforçar com prosa pioraram o
resultado — uma em acerto, a outra introduziu o único falso positivo perigoso de toda a
medição, e de forma não reprodutível (apareceu numa rodada, sumiu na outra, com a mesma
instrução). O contexto que já existe é o que funciona.

**Limitação aceita, não corrigida:** "cancela isso" referindo-se a um agendamento existente
citado só no histórico é reconhecido em ~75% dos casos. O desenho do fluxo (seção 4) é o que
torna isso seguro: um falso negativo aqui não cancela nada por engano — na pior hipótese, a
Iris não entende o pedido nesse turno e o paciente repete de forma mais direta. Nunca o
inverso.

## 4. Confirmação explícita — a proteção central desta spec

**Decisão do Gabriel, 2026-08-11: `intencao = cancelamento` nunca, por si só, executa
cancelamento.** Um falso positivo inicial da classificação (raro, medido 0/8 no caso mais
adversarial testado, mas não zero por construção) só pode, na pior hipótese, levar o paciente
a uma pergunta de confirmação que ele vai negar — nunca a uma escrita.

O fluxo é sempre:

```
intencao=cancelamento
  → localizar (seção 2)
      nenhum      → sem_agendamento_para_cancelar         (nenhuma pergunta, nenhuma escrita)
      múltiplos   → aguardando_escolha_agendamento_cancelamento (pergunta; nenhuma escrita)
      único/escolhido
          confirmacao !== 'sim'
            OU proposta_pendente ausente/não corresponde a este agendamento (seção 4)
                                 → aguardando_confirmacao_cancelamento  (pergunta; nenhuma escrita)
          confirmacao === 'sim'
            E proposta_pendente == { data, horario } deste agendamento
                                 → RPC cappia_cancelar_agendamento_v2   (única escrita possível)
```

Decisão nova:

```ts
{ tipo: 'aguardando_confirmacao_cancelamento'; agendamento: AgendamentoAtivo }
```

A redatora recebe o agendamento **inteiro** (procedimento, dentista, data, horário) como
fato autorizado, exatamente como `descreverAgendamentoAtivo` já monta para a lista de
escolha — cumprindo a exigência explícita do Gabriel: **mostrar claramente qual agendamento
será cancelado**, nunca um "confirma?" genérico.

Fallback determinístico (mesmo padrão de `gerar-resposta-paciente.ts`):

> "Você quer cancelar {procedimento} com {dentista} — {data} às {horário}? Isso não pode ser
> desfeito."

### Como a IA reconhece confirmação — nunca por palavra literal, decidido pelo Gabriel, 2026-08-11

**`proposta_pendente` é reusado tal como está — zero campo novo, zero variante nova de
`ContextoHorarios`, zero linha de prompt nova.** `aguardando_confirmacao_cancelamento` grava
`{ data, horario }` do agendamento a cancelar no mesmo lugar onde a reserva e a remarcação já
gravam — ação `propor`, já existente.

O rótulo da instrução ("a data e o horário que o Core está propondo") não é reescrito por
causa disto. **Não é o texto da instrução que autoriza o cancelamento — é o Core.** A IA
continua fazendo exatamente o que já faz hoje: ler `proposta_pendente`, tratá-lo como "há um
fato concreto aguardando confirmação" (sinal **declarativo**, nunca prescritivo sobre o que
esse fato significa), e emitir `confirmacao = sim` quando a mensagem concordar com ele. Ela
nunca soube, e não precisa saber, se a confirmação é de uma reserva nova, de uma remarcação
ou de um cancelamento — isso nunca foi problema dela; sempre foi do Core.

**`confirmacao = 'sim'` é o valor canônico do CAMPO, não uma exigência de palavra do
paciente.** Em nenhum lugar desta spec, do schema ou do prompt existe comparação com a
palavra literal "sim" digitada pelo paciente. `CONFIRMACOES_PERMITIDAS = ['sim']` é o
vocabulário fechado do **campo persistido** — sempre foi, desde a reserva original — e é
preenchido pela IA depois de uma leitura semântica da mensagem inteira, nunca por casar
texto. A instrução que já rege isso (`interpretacao-instrucoes.ts`, regra de `confirmacao`,
**inalterada por esta spec**) já é explícita: concordância "semanticamente clara", **"sem
repertório fechado de frases"**, valendo igualmente "sim", "confirmo", "pode marcar", "isso
mesmo", "ok", "certo", "fechado", "esse mesmo", "pode ser" **e qualquer concordância
inequívoca equivalente** — o que cobre, sem qualquer alteração, respostas como "pode", "pode
cancelar", "isso", "beleza" ou "pode sim". Essa lista, aqui e no prompt, é **sempre
ilustrativa**: citar exemplos não os transforma em enumeração fechada, e nenhuma
implementação desta spec pode reduzi-la a um `switch` ou a uma lista de frases aceitas.

**Responsabilidade, sem ambiguidade:**

- **A IA interpreta semanticamente** se a mensagem atual confirma a pergunta pendente
  (`proposta_pendente`) — julgamento de linguagem, feito uma vez, no mesmo lugar onde a
  reserva e a remarcação já fazem esse julgamento hoje.
- **O Core nunca compara palavra.** Ele só lê o campo fechado que a IA já produziu
  (`dados.confirmacao === 'sim'`) — nunca a mensagem crua do paciente, nunca um regex, nunca
  uma lista de sinônimos própria do cancelamento.
- **O Core só executa a RPC quando existir confirmação explícita válida *e* o contexto
  oficial de `aguardando_confirmacao_cancelamento` correspondente** — as três condições da
  seção seguinte, nenhuma sozinha.
- **Negação, dúvida ou resposta ambígua nunca autorizam.** Já garantido pela regra existente:
  diante de dúvida, pergunta, hesitação ou negativa, a IA **omite** o campo — omissão que,
  pela condição 2 abaixo, nunca vira execução.

**O ponto novo, que fecha a lacuna, é inteiramente do lado do Core: `dados.confirmacao` sozinho
nunca autoriza a RPC.** `confirmacao` é um campo persistido em `dados` — sobrevive a turnos em
que ele deixou de fazer sentido (ex.: o turno em que a proposta que o gerou já não está mais
em pé, porque o desfecho técnico daquele turno mudou o que está pendente sem passar pela
transição explícita de "entrar em cancelamento"). Confiar só nele seria confiar num valor que
pode estar **desatualizado em relação à pergunta que está de fato em aberto agora**.

A execução exige as **três** condições, verificadas pelo Core no mesmo turno, nunca separadas:

1. `dados.intencao === 'cancelamento'` (o fluxo é este);
2. `dados.confirmacao === 'sim'` (a IA leu concordância);
3. **o `proposta_pendente` que chegou no INÍCIO deste turno** (o que `contexto_horarios`
   trazia antes de qualquer processamento, o mesmo objeto já repassado a
   `interpretarEAplicar`) **existe e seu `{ data, horario }` é exatamente igual ao do
   agendamento que o Core está considerando cancelar agora.**

Falhando a condição 3 — `proposta_pendente` ausente, ou presente mas apontando para outra
data/horário — o "sim" **não é consumido**: o Core trata como se não houvesse confirmação
ainda, e **re-deriva `aguardando_confirmacao_cancelamento` do zero**, perguntando de novo com
o agendamento certo. Nunca lança erro, nunca cancela por engano, nunca herda uma confirmação
de outro contexto.

**Por que isso fecha exatamente o buraco que a reutilização abre.** Sem a condição 3, um
`'sim'` que ficou em `dados.confirmacao` de um turno anterior — por exemplo, a RPC falhou por
corrida e o Core não teve motivo para "entrar" de novo em cancelamento (`intencao` já era
`cancelamento`, então `limparConfirmacaoAoEntrarEmRemarcacao` não dispara) — poderia ser
consumido num turno seguinte sem que o paciente tivesse confirmado **esta** pergunta. A
condição 3 amarra a autorização à pergunta pendente **real**, verificada de novo a cada
execução, não ao valor persistido isoladamente. `contexto_horarios` é substituído por inteiro
a cada turno (nunca faz merge), então essa checagem é sempre contra o que estava
genuinamente pendente no início do turno corrente — nunca um resíduo antigo.

**`dados.confirmacao` continua sendo limpo ao ENTRAR em `cancelamento`**, mesma exigência já
aprovada para remarcação — generalização de `limparConfirmacaoAoEntrarEmRemarcacao` para dois
valores de intenção (`remarcacao`, `cancelamento`) em vez de um. A condição 3 acima é uma
proteção **adicional**, para o caso que a limpeza na entrada não cobre: um "sim" que sobra
**dentro do mesmo fluxo**, entre uma pergunta de confirmação e a seguinte.

## 5. Escolha entre vários agendamentos — reuso total, zero marcador novo

`aguardando_escolha_agendamento` (remarcação) e a nova `aguardando_escolha_agendamento_cancelamento`
usam o **mesmo mecanismo inteiro**: `agendamentos_ativos` no payload da IA, mesma instrução
já aprovada em `interpretacao-instrucoes.ts` (que já é genérica — "QUAL DESSES AGENDAMENTOS o
paciente quer", sem verbo), mesmo `agendamento_id` validado contra a lista oferecida
(`validarEscolhaAgendamento`), mesmo marcador `contexto_horarios.escolha_agendamento_pendente`
e mesma ação `perguntar_qual_agendamento`.

**Por que uma decisão nova em vez de reusar `aguardando_escolha_agendamento` diretamente.**
O texto ao paciente difere: hoje `gerar-resposta-paciente.ts` responde literalmente "Qual
deles você quer **remarcar**?" — fixo, não parametrizado. Reusar a mesma decisão faria um
paciente cancelando ouvir a pergunta errada. Mesmo critério já registrado em
`remarcacao-conversacional-v1.md` seção 5 para `aguardando_confirmacao_remarcacao`:
**significado operacional diferente, não conveniência estrutural.**

```ts
{ tipo: 'aguardando_escolha_agendamento_cancelamento'; agendamentos: readonly AgendamentoAtivo[] }
```

Fallback: "Você tem mais de um agendamento: {opções}. Qual deles você quer **cancelar**?" —
mesma forma de `gerar-resposta-paciente.ts:145`, um verbo trocado.

**Por que o marcador de contexto NÃO precisa saber se é remarcação ou cancelamento.** O
roteamento nunca depende de `escolha_agendamento_pendente` sozinho — `dados.intencao`
(persistido, sobrevive ao turno) já diz qual dos dois fluxos está em andamento quando o
paciente responde "o segundo". O marcador só guarda a lista de IDs oferecidos, papel
idêntico nos dois fluxos. Criar uma sexta variante só para duplicar essa lista seria
exatamente o tipo de estrutura desnecessária que `AGENTS.md` pede para não criar.

## 6. Contrato da RPC

**Nome: `cappia_cancelar_agendamento_v2`.** O nome sem sufixo já existe no banco operacional,
com outra assinatura (sem `p_paciente_id`) e outra responsabilidade. Sobrescrevê-lo trocaria
o corpo de uma função legada viva em produção — mesma proibição já registrada para a
remarcação.

```
cappia_cancelar_agendamento_v2(
  p_clinica_id     uuid,
  p_paciente_id    uuid,
  p_agendamento_id uuid
) returns jsonb
```

Vocabulário fechado de retorno:

| retorno | significado |
|---|---|
| `{ sucesso: true, agendamento_id, status: 'cancelado' }` | cancelado |
| `{ sucesso: true, ja_cancelado: true, agendamento_id }` | replay — já estava cancelado |
| `{ sucesso: false, motivo: 'agendamento_nao_encontrado' }` | não existe, ou não é desta clínica/deste paciente |
| `{ sucesso: false, motivo: 'nao_confirmado' }` | existe, mas não está `'confirmado'` (já remarcado, concluído, ou faltou) |
| `{ sucesso: false, motivo: 'erro_insercao' }` | falha inesperada de escrita |

### Ordem de operações — única transação

1. `SELECT ... FOR UPDATE` por `id = p_agendamento_id AND clinica_id = p_clinica_id AND
   paciente_id = p_paciente_id`. Não encontrado → `agendamento_nao_encontrado`. Mesma
   disciplina da remarcação: **três casos colapsados deliberadamente** (inexistente, de
   outra clínica, de outro paciente) — distinguir revelaria ficha alheia.
2. Se `status = 'cancelado'` → replay: devolve `ja_cancelado: true` sem nenhum `UPDATE`.
3. Se `status <> 'confirmado'` → `nao_confirmado`. Um agendamento já `'remarcado'` não é
   cancelável por esta RPC — a linha ativa é a sucessora, que tem seu próprio ciclo de vida;
   `'concluido'`/`'faltou'` também não fazem sentido operacional para cancelar.
4. `UPDATE agendamentos SET status = 'cancelado' WHERE id = p_agendamento_id`.
5. Devolve `{ sucesso: true, agendamento_id, status: 'cancelado' }`.

**Sem `pg_advisory_xact_lock` e sem checagem de conflito por `tsrange`.** Cancelar **libera**
um horário, nunca reivindica um — não há concorrência de destino a proteger. Mais simples
que a remarcação por construção, não por omissão.

**Sem `event_id`/`calendar_id` no retorno**, diferente da RPC legada. Resíduo de integração
com Google Calendar da Iris antiga — fora do escopo do Core novo, mesmo critério já aplicado
em `cappia_remarcar_agendamento_v2`.

### Idempotência

Mais simples que a remarcação: não há linha sucessora a localizar no replay, só o `status`
da própria linha. `SELECT ... FOR UPDATE` no passo 1 já serializa concorrência — duas
confirmações simultâneas colidem ali, a segunda é liberada com `status` já `'cancelado'` e
cai no passo 2. **Nenhum índice novo, nenhuma constraint nova.**

### Adapter

`src/core/cancelar-agendamento.ts`, molde exato de `remarcar-agendamento.ts`: uma chamada,
sem retry, validação estrita de entrada (UUID) e de saída (vocabulário fechado de motivo),
nunca propaga `error.message` nem o payload bruto.

### DDL

**Zero.** `agendamentos_status_check` já admite `'cancelado'`
(`CHECK (status = ANY (ARRAY['confirmado','cancelado','remarcado','concluido','faltou']))`,
confirmado por leitura direta do operacional em 2026-08-11). Nenhuma coluna nova, nenhuma FK
nova, nenhum índice novo — só a função, aplicada nos dois bancos, corpo idêntico (ao
contrário da remarcação, aqui não há divergência de schema a acomodar).

## 7. Execução e desfechos

Confirmado, o Core chama `cancelarAgendamento` com o agendamento já localizado.

| decisão | quando | o que a redatora diz |
|---|---|---|
| `cancelamento_criado` | `tipo: 'cancelado'` | confirma o cancelamento, citando o que foi cancelado |
| `reserva_falhou` (**reusada**) | `tipo: 'falhou'`, qualquer motivo | frase técnica genérica já existente |

```ts
{ tipo: 'cancelamento_criado'; agendamento_id: string;
  procedimento_id: string | null; dentista_id: string | null;
  data: string; horario: string }
```

**Nenhuma decisão própria para falha — mesma auditoria já aplicada em
`remarcacao-conversacional-v1.md` seção 6, reaplicada aqui sem mudança de raciocínio:**
`agendamento_nao_encontrado` e `nao_confirmado` colapsam na mesma corrida real (o agendamento
mudou entre a busca e a confirmação — o turno seguinte se autocorrige: `buscarAgendamentoAtivo`
não o encontra mais e devolve `sem_agendamento_para_cancelar`, a mensagem verdadeira).
`erro_insercao` é técnico. Nenhum dos três tem consumidor que leia `motivo` hoje —
`reserva_falhou.motivo` já é descartado pelos três consumidores existentes
(`gerar-resposta-paciente.ts`, `contexto-horarios.ts`, `fatos-autorizados.ts`). Ampliar o
tipo para incluir o vocabulário do cancelamento:

```ts
motivo: MotivoErroReserva
  | Exclude<MotivoErroRemarcacao, 'horario_ocupado'>
  | Exclude<MotivoErroCancelamento, never>
```

**`ja_cancelado: true` é sucesso normal**, sem texto de exceção — mesmo critério do
`ja_remarcado` já em produção.

## 8. Ciclo de vida do contexto

`derivarAcaoContextoHorarios` exaustiva sobre as decisões — nenhuma das novas compila sem
`case`:

| decisão | ação sobre `contexto_horarios` |
|---|---|
| `aguardando_escolha_agendamento_cancelamento` | `perguntar_qual_agendamento` (reusada) |
| `aguardando_confirmacao_cancelamento` | `propor` (reusada, seção 4 — grava `{ data, horario }` do agendamento a cancelar) |
| `sem_agendamento_para_cancelar` | `limpar` |
| `cancelamento_criado` | `limpar` |

**As quatro decisões novas, ao todo:** `sem_agendamento_para_cancelar`,
`aguardando_escolha_agendamento_cancelamento`, `aguardando_confirmacao_cancelamento`,
`cancelamento_criado`. Nenhum campo novo em `CampoDadosConversa` — `agendamento_id` já existe,
criado pela remarcação, e é reusado tal como está.

## 9. Testes mínimos

**Caminho principal**

1. *"Quero cancelar minha consulta"*, um agendamento ativo → `aguardando_confirmacao_cancelamento`
   citando claramente qual agendamento.
2. *"Sim, pode cancelar"* → `cappia_cancelar_agendamento_v2` chamada; `cancelamento_criado`.
2b. **Confirmação por variação natural, sem "sim" literal** — com `aguardando_confirmacao_cancelamento`
    pendente, cada uma das mensagens *"pode"*, *"pode cancelar"*, *"ok"*, *"isso"*, *"beleza"*,
    *"pode sim"* resolve, isoladamente, em `dados.confirmacao === 'sim'` e executa a RPC —
    prova de que o reconhecimento é semântico (seção 4), nunca por casar a palavra "sim". Lista
    **ilustrativa**, não um repertório a esgotar: qualquer concordância inequívoca equivalente
    deve valer igualmente, e nenhum teste desta spec pode virar enumeração fechada de frases
    aceitas.
2c. **Ambiguidade nunca autoriza** — com a mesma pergunta pendente, *"acho que sim, mas deixa eu
    ver"*, *"por quê?"* e *"não sei"* **não** emitem `confirmacao`; o Core permanece em
    `aguardando_confirmacao_cancelamento`, nenhuma chamada à RPC.
3. Sem agendamento futuro → `sem_agendamento_para_cancelar`; **nenhuma** chamada à RPC.
4. Múltiplos agendamentos, *"o da sexta"* → identifica e segue para confirmação — nunca
   cancela direto sem a etapa de confirmação, mesmo com o agendamento já identificado.

**A proteção central (seção 4) — testes obrigatórios**

5. `intencao = cancelamento` emitida **sem** `confirmacao = 'sim'` no mesmo turno ou em
   qualquer turno anterior válido → **nenhuma chamada à RPC**, sempre
   `aguardando_confirmacao_cancelamento`.
6. `dados.confirmacao === 'sim'` remanescente de um fluxo anterior (reserva, remarcação, ou
   cancelamento de outro agendamento já concluído) + entrada em `cancelamento` → confirmação
   **não** é reaproveitada; a pergunta de confirmação é refeita do zero.
7. Falso positivo simulado de intenção (`intencao = cancelamento` sem o paciente ter pedido,
   forçado no teste) → o pior desfecho possível é uma pergunta de confirmação que o paciente
   nega (`negacao` → desistência, `intencao` removida) — **nunca uma escrita**.
7b. `dados.confirmacao === 'sim'` presente, `intencao === 'cancelamento'`, **mas
    `proposta_pendente` ausente ou com `{ data, horario }` diferente** do agendamento sendo
    considerado (simula a corrida descrita na seção 4: RPC falhou por corrida no turno
    anterior, `intencao` não foi limpa, `confirmacao` sobrou) → **nenhuma chamada à RPC**;
    `aguardando_confirmacao_cancelamento` é re-derivada do zero, com o agendamento correto.
    Este é o teste que prova a condição 3 da seção 4 — sem ele, a reutilização de
    `proposta_pendente` não está provada, só descrita.

**Isolamento (pares A/B obrigatórios)**

8. Mesma frase, variando **só** `intencao` (`cancelamento` × ausente): com ela, cancelamento;
   sem ela, nunca.
9. `agendamento_id` fora da lista oferecida → descartado, mesma regra já provada na
   remarcação.

**Desfechos**

10. Corrida: agendamento muda de status entre a busca e a confirmação → `reserva_falhou`,
    frase genérica; turno seguinte autocorrige para `sem_agendamento_para_cancelar` quando
    aplicável.
11. `ja_cancelado: true` → mesma resposta de sucesso, sem texto de exceção.
12. Segunda mensagem depois de `cancelamento_criado` → `intencao` já removida; não reentra em
    cancelamento.

## 10. Pendências abertas por esta spec

- **`reserva_falhou` passa a cobrir um terceiro fluxo** sem mudar de nome — mesma dívida de
  nomenclatura já registrada em `remarcacao-conversacional-v1.md`, agora dobrada. Continua
  fora do escopo desta rodada.
- **Paciente sem cadastro não pode cancelar** e não recebe oferta de cadastro. Mesma
  decisão já vigente para remarcação, por consistência.
- **A limitação de reconhecimento de "cancela isso" com contexto só no histórico (~75%,
  seção 3) fica visível ao paciente** como "não entendi, pode explicar melhor?" — aceita,
  nunca corrigida por regra lexical.
- **`INTENCOES_PERMITIDAS` passa a ter três valores.** Se uma quarta intenção entrar depois
  (consulta completa), o precedente de medir antes de assumir contexto suficiente,
  estabelecido nesta spec, deve se repetir.
