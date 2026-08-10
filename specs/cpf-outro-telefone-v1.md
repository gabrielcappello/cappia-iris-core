# CPF já cadastrado em outro telefone — v1

**Status:** especificação **fechada e aprovada pelo Gabriel em 2026-08-10**, ainda **não
implementada**. Nenhuma migration, RPC, coluna, tipo ou linha de código é criada por este
documento.

Escopo: exclusivamente `persistencia-v1.md` §6 — o CPF informado já pertence a **outro**
paciente da **mesma** clínica. `persistencia-v1.md` §7 (telefone atual já pertence a outro
paciente) permanece **fechada**; esta spec só precisa **detectá-la e parar** (seção 5).

Continua desta etapa: `cadastro-conversacional-v1.md` §7, que hoje reconhece
`cpf_ja_cadastrado` e para sem resolver.

## Aderência a `docs/00-principios.md`

- **Responsabilidade correta.** O Core não interpreta "sim"/"não". Ele declara que existe
  uma pergunta pendente e recebe da IA um campo fechado. Nenhuma lista de sinônimos de
  concordância, nenhum regex sobre a resposta.
- **Remoção.** Nenhum mecanismo novo de pergunta pendente: reusa o snapshot
  `contexto_horarios` e o padrão de evento condicionado a marcador, ambos já em produção.
  Nenhuma tabela nova. **Uma única coluna aditiva** — as três outras previstas por
  `persistencia-v1.md` §5/§6 foram avaliadas e **deliberadamente não criadas**, com a
  evidência de banco que sustenta cada corte (seção 5).
- **Teste isolado.** O par A/B obrigatório está na seção 8: mesma frase, variando só a
  presença do marcador, exigindo que os dois lados difiram.
- **Testes realistas.** As frases da seção 8 seguem o registro real de WhatsApp.

## Decisão canônica (Gabriel, 2026-08-10)

1. Não criar paciente duplicado.
2. Informar que o CPF já está associado a outro telefone.
3. Perguntar se deseja atualizar o telefone oficial para o número atual.
4. Só atualizar com confirmação explícita.
5. **Sim** → atualizar atomicamente o telefone do dono do CPF, devolver esse
   `paciente_id`, continuar o agendamento.
6. **Não** → não alterar nada, não duplicar, **não continuar o agendamento**, encaminhar à
   recepção.

> **REVOGAÇÃO EXPLÍCITA.** `persistencia-v1.md` §6 dizia, na recusa: *"permitir que o
> agendamento continue normalmente"*. Isso fica **revogado**. Motivo registrado: depois da
> recusa não existe associação segura entre o telefone da conversa e aquela ficha —
> agendar assim gravaria um agendamento para um paciente cuja identidade não foi
> estabelecida por nenhum meio confirmado. Os demais bullets da §6 permanecem em vigor.

## 1. Como o Core representa a pergunta pendente

Reusa `estado_conversa.contexto_horarios`, o mesmo snapshot que já sustenta
`proposta_pendente` e `oferta_procedimento_pendente`. Um quarto campo:

```ts
troca_telefone_pendente?: true;
```

Precedente direto: `oferta_procedimento_pendente` nasceu exatamente deste problema — sem
marcador declarado, uma resposta curta chega à interpretadora sem pergunta pendente e vira
`nao_compreendida` (medido 3/3 contra a IA real,
`contexto-pendente-interpretacao-v1.md` §11). O problema aqui é idêntico, então a solução
é a mesma peça, não uma nova.

Ação nova em `derivarAcaoContextoHorarios`: `{ tipo: 'perguntar_troca_telefone' }`.

**O marcador substitui o snapshot por inteiro** — `proposta_pendente` não é preservada
junto. Deliberado: o horário escolhido não vive no snapshot, vive em
`dados.data_texto`/`dados.horario_texto`/`dados.confirmacao`, que persistem entre turnos e
são re-derivados a cada mensagem. O snapshot é **auxiliar de interpretação**, nunca fonte
de disponibilidade nem autoridade de reserva (`contexto-horarios.ts`), e durante esta
pergunta o paciente está respondendo sobre o telefone, não sobre o horário.

## 2. O campo fechado que representa SIM/NÃO

**Não reusar `dados.confirmacao`.** Ele já vale `'sim'` neste ponto do fluxo — foi o que
autorizou o horário. Lê-lo como consentimento para trocar telefone faria uma confirmação
de agenda autorizar uma alteração cadastral que o paciente nunca concedeu. É o caso mais
grave que esta spec precisa impedir, e o teste da seção 8 existe para provar que não
acontece.

> **REVISÃO 2026-08-10 — o contrato desta seção foi substituído por evidência
> medida contra a IA real.** A versão anterior previa um evento
> `responder_troca_telefone` com campo fechado `resposta: 'sim' | 'nao'`. Ele
> **nunca funcionou** e foi removido. O que está abaixo é o contrato vigente,
> escolhido por medição (`src/eval/diagnostico-contrato-eventos.ts`).

**O "sim" é um evento; o "não" não é.** A IA nunca emite `sim`/`nao` — quem deriva os dois
é o Core, combinando dois sinais que ela já produz.

```ts
{ tipo: 'aceitar_troca_telefone', referencia_textual: string | null }
```

Forma **idêntica** à de `aceitar_opcao` — nenhuma união discriminada, nenhum `anyOf`,
nenhum campo novo. Emitido **somente** quando `troca_telefone_pendente` estiver no payload,
mesma guarda já escrita para `aceitar_opcao`.

**A recusa vem de `natureza_mensagem === 'negacao'`**, campo que já existe, é obrigatório e
chega em todo turno.

**Por que não existe um evento de recusa.** Toda a instrução ao redor ensina que recusa é a
**ausência** do evento — é assim que `aceitar_opcao` funciona. Medição de 2026-08-10:

| contrato | desfechos corretos |
|---|---|
| enum do fio só com `aceitar_opcao` | 3/6 |
| dois nomes (`aceitar_` + `recusar_troca_telefone`) | 4/6 |
| **um nome + `natureza_mensagem`** | **6/6** |

`recusar_troca_telefone` foi emitido em **zero** casos. Insistir nele custaria regra nova de
prompt para remar contra uma regra que o resto da instrução ensina.

**A negação vence o evento — ordem obrigatória.** Medido: *"não, deixa como está"* chegou
com `natureza=negacao` **e** `aceitar_troca_telefone` no mesmo turno. Se o evento fosse lido
primeiro, uma recusa explícita viraria troca de telefone. É a mesma disciplina de sinais
incompatíveis já canônica em `aplicarAceitacaoDeOferta` ("o Core não escolhe qual
acreditar"), não uma regra nova.

**Falha segura nos dois lados.** Recusa sem `negacao` e sem evento (medido 1/15) devolve
`null`: a Iris repete a pergunta. Nunca troca telefone por engano — o único desfecho
inaceitável aqui.

### Limite conhecido e aceito

Com a pergunta pendente, **qualquer** `natureza_mensagem === 'negacao'` é lida como recusa
da troca — inclusive uma negação sobre outro assunto, se a IA a classificar assim. O preço
é derivar a recusa de um sinal genérico; a alternativa (exigir um evento de recusa próprio)
foi medida e **não funciona** (zero emissões).

O limite é **seguro por construção**, e é isso que o torna aceitável:

- **nunca autoriza a troca de telefone** — `negacao` só produz `'nao'`, e `'nao'` não
  escreve nada;
- o pior caso é encaminhar à recepção uma conversa que poderia ter seguido sozinha.

Registrado como limite, não como pendência: a decisão é aceitá-lo enquanto o desfecho errado
possível for "atendimento humano a mais", nunca "cadastro alterado sem autorização".

**Por que evento e não campo em `dados`:** `dados` persiste entre turnos. Um `sim` esquecido
ali autorizaria, sozinho, uma troca num turno futuro sem ninguém ter perguntado nada. O
evento é transitório por construção, consumido no mesmo processamento.

## 3. Decisões do orquestrador

Duas novas, nenhuma a mais:

| decisão | quando | objetivo da redatora |
|---|---|---|
| `troca_telefone_pendente` | RPC devolveu `cpf_ja_cadastrado` | informar o conflito e perguntar se atualiza o telefone |
| `troca_telefone_recusada` | evento com `resposta: 'nao'` | acatar a recusa e encaminhar à recepção |

`cpf_ja_cadastrado` **permanece** e passa a cobrir só os desfechos terminais técnicos da
seção 5 (`telefone_de_outro_paciente`, `cpf_nao_encontrado`) — mesmo texto de
encaminhamento à recepção que já tem hoje. Não se cria decisão nova para eles: o desfecho
para o paciente é o mesmo.

O sucesso da troca **não tem decisão própria**, pelo mesmo motivo que não existe
`cadastro_concluido` (`cadastro-conversacional-v1.md` §6): não há decisão humana pendente
entre trocar o telefone e reservar, então o mesmo processamento continua até
`reserva_criada` / `reserva_conflito` / `reserva_falhou`.

## 4. Localizar e atualizar por CPF sem expor PII

**O Core nunca lê a outra ficha.** Não faz `SELECT` por CPF, não recebe nome, telefone,
e-mail ou data de nascimento do outro cadastro. A localização acontece **dentro** da RPC, e
o único dado que atravessa a fronteira de volta é `paciente_id` — um UUID opaco.

A frase ao paciente diz apenas que aquele CPF já consta com outro número. Não revela nada
que o paciente já não tenha afirmado ao digitar o próprio CPF, e não expõe nenhum dígito do
telefone anterior, nenhum nome, nenhuma outra ficha. Nada disso entra em log
(`persistencia-v1.md` §20).

**Não escrever os demais campos cadastrais na ficha do dono do CPF.** A troca de telefone é
a única escrita autorizada aqui. Sobrepor nome, data de nascimento ou e-mail do outro
cadastro com o que foi digitado nesta conversa é decisão diferente e maior (qual valor
vence?), fora desta spec.

## 5. RPC mínima para trocar o telefone atomicamente

```
cappia_trocar_telefone_paciente(
  p_clinica_id           uuid,
  p_cpf                  text,
  p_telefone_normalizado text
) returns jsonb
```

Vocabulário fechado de retorno:

| retorno | significado |
|---|---|
| `{ sucesso: true, paciente_id }` | telefone trocado; segue para a reserva |
| `{ sucesso: false, motivo: 'telefone_de_outro_paciente' }` | **§7** — detectado, não tratado |
| `{ sucesso: false, motivo: 'cpf_nao_encontrado' }` | corrida: a ficha mudou entre turnos |

Motivos estruturais (`clinica_id_ausente`, `cpf_ausente`, `telefone_normalizado_ausente`) e
formato canônico violado são **invariantes do Core**: `raise`, nunca motivo conversacional
— mesma disciplina de `cadastro-conversacional-v1.md` §9 e da correção de
`cappia_persistir_paciente` de 2026-08-10.

**Atomicidade sem TOCTOU.** Um único `UPDATE ... WHERE clinica_id = ... AND documento = ...
RETURNING id`, com a colisão de telefone capturada pelo handler de `unique_violation` da
própria constraint — nunca `SELECT` seguido de `UPDATE`, que abriria janela entre a
verificação e a escrita. Zero linhas retornadas ⇒ `cpf_nao_encontrado`. Violação de
unicidade de telefone ⇒ `telefone_de_outro_paciente`, **sem nenhuma escrita**. É o mesmo
padrão que `cappia_persistir_paciente` já usa para derivar `cpf_ja_cadastrado`.

**Consequência direta da Etapa 1 (2026-08-10):** os dois bancos divergem na coluna fonte do
telefone. No operacional grava-se `telefone` (e o Postgres deriva
`telefone_normalizado`, que é `GENERATED ALWAYS`); no dev grava-se `telefone_normalizado`
diretamente. **Os corpos serão diferentes de propósito**, com o mesmo contrato observável —
não repetir o erro de exigir corpo idêntico entre esquemas diferentes.

### Colunas aditivas — uma, e só uma

`persistencia-v1.md` §6 manda "registrar instante, origem e referência autorizadora da
alteração". Os três foram avaliados um a um contra o princípio da remoção. **Só o primeiro
sobrevive.**

**`telefone_alterado_em timestamptz` — criada.** É informação real e variável, e nenhuma
coluna existente a carrega: o trigger `trigger_pacientes_atualizado_em` já bumpa
`atualizado_em` em toda alteração da linha (nome, e-mail, qualquer campo), então
`atualizado_em` responde "quando a ficha mudou", nunca "quando o telefone mudou".

**`telefone_alterado_origem` — NÃO criada.** Auditoria do banco operacional em 2026-08-10:

- varredura de todas as funções de `public` — **exatamente uma** escreve em `pacientes`,
  `cappia_persistir_paciente`, a nossa; **nenhuma RPC legada** escreve na tabela;
- `pacientes` está com **RLS ativa e zero policies**, o que neutraliza na prática os grants
  amplos de `anon` (pendência já registrada) e de `authenticated`;
- `pacientes` **não possui nenhum padrão de auditoria de origem** — nenhuma coluna
  `*_origem`, `*_por` ou `atualizado_por` existe na tabela;
- **nenhum consumidor lê essa informação** hoje.

Dentro desta RPC o valor seria sempre `'iris'` — constante, sem leitor. E há um agravante:
`service_role` tem BYPASSRLS e pode alterar o telefone direto via PostgREST (caminho
provável do painel), sem passar pela RPC; nesse caso a coluna permaneceria com um `'iris'`
obsoleto, **afirmando uma origem falsa**. Uma coluna constante que mente é pior que a
ausência dela.

Ela deve nascer quando existir **mais de uma origem real gravando pela mesma via** e um
consumidor que leia o valor — não antes, e nunca só porque uma spec anterior a previu.

**`referência autorizadora` — NÃO criada, pendência explícita.** §6 a exige, e ela **não é
satisfazível hoje**: a referência prevista é a identidade da operação idempotente, que só
existe em `P4`/`P4I` — especificadas, não implementadas. Nenhuma coluna substituta é
inventada aqui. Fica registrado que **§6 é atendida apenas parcialmente nesta v1**
(instante sim; origem e referência não), com os motivos acima.

**A terceira coluna prevista em §5** — *natureza da última alteração* (substituição **ou**
transferência) — **não é criada aqui** pelo mesmo critério: nesta spec teria valor constante
`'substituicao'` em toda linha. Passa a fazer sentido quando §7 abrir, e é lá que deve
nascer.

## 6. Continuar a reserva com o `paciente_id` correto

O `paciente_id` devolvido pela RPC vai **direto** para `reservarAgendamento`, no mesmo
processamento — exatamente o encadeamento que `persistirPaciente` já faz hoje em
`decidirConfirmacaoOuReserva`. `persistirPaciente` **não** é chamada neste caminho: o
paciente já existe e a única escrita autorizada já aconteceu.

`estado_conversa.paciente_id` continua nulo até o turno seguinte, como já acontece quando
um paciente é persistido no meio do processamento (dívida técnica #3 do handoff de
2026-08-10). Nada no turno atual depende dele — a reserva usa o id devolvido pela RPC. Não
é problema novo e esta spec não o resolve.

## 7. Limpeza do contexto

| situação | ação sobre `contexto_horarios` |
|---|---|
| `troca_telefone_pendente` | `perguntar_troca_telefone` (grava o marcador) |
| `troca_telefone_recusada` | `limpar` |
| `cpf_ja_cadastrado` | `limpar` (já é o comportamento atual) |
| `reserva_criada` / `reserva_conflito` / `reserva_falhou` | `limpar` (já é o comportamento atual) |
| mensagem que não responde a pergunta | o fluxo re-deriva e regrava o marcador idêntico |

A última linha segue o mesmo desenho já adotado para a oferta de procedimento: o marcador é
**re-derivado** a cada turno em que a situação não muda, em vez de existir um caso de
"preservar". Uma dúvida no meio ("por que precisa disso?") não altera CPF nem ficha, então o
fluxo recalcula o mesmo estado e regrava o mesmo marcador.

`derivarAcaoContextoHorarios` é exaustiva sobre as decisões: as duas decisões novas não
compilam sem `case`, então nenhuma delas pode ficar sem ciclo de vida definido por
esquecimento.

## 8. Testes mínimos

Frases conforme o registro real de WhatsApp (`00-principios.md`, princípio dos testes
realistas) — nenhuma inventada para forçar comportamento.

**Caminho principal**

1. Telefone novo, sem paciente nesse número, CPF pertence a outra ficha da clínica → não
   cria duplicata; decisão `troca_telefone_pendente`; marcador gravado.
2. *"Pode atualizar sim"* → telefone trocado; `paciente_id` devolvido é o **dono do CPF**;
   reserva criada com esse id.
3. *"Não, deixa o outro número"* → **nenhuma escrita** no banco; sem duplicata; **sem
   reserva**; decisão `troca_telefone_recusada`.
4. *"Por que vocês precisam disso?"* → pergunta segue pendente; marcador regravado; nada
   alterado.

**Isolamento (par A/B obrigatório)**

5. Mesma frase *"pode atualizar sim"*, variando **só** a presença de
   `troca_telefone_pendente` no payload: sem o marcador, nenhum evento é emitido; com o
   marcador, evento com `resposta: 'sim'`. **Os dois lados precisam diferir** — sem isso o
   teste não prova que o mecanismo novo tem efeito.
6. `dados.confirmacao === 'sim'` (do horário) presente, pergunta de telefone pendente,
   mensagem que **não** responde à pergunta → **nenhuma troca de telefone**. Prova que a
   autorização vem do campo novo e nunca da confirmação do agendamento.

**RPC**

7. Telefone da conversa já pertence a outro paciente da clínica → `telefone_de_outro_paciente`;
   **zero escrita**; §7 permanece fechada.
8. CPF deixou de existir entre a pergunta e a resposta → `cpf_nao_encontrado`; zero escrita.
9. Unicidade de telefone na clínica nunca é violada em nenhum caminho.
10. Mesmo CPF em **outra** clínica não é alcançado nem alterado.
11. Round-trip do telefone nos **dois** bancos: o `telefone_normalizado` resultante é
    exatamente o que o Core enviou (regressão herdada da Etapa 1).

**PII**

12. Nenhum dado do outro cadastro (nome, telefone, e-mail, nascimento) atravessa a fronteira
    do modelo, aparece na resposta ao paciente ou entra em log.

## 9. Fora de escopo

`persistencia-v1.md` §7 (transferência de telefone entre cadastros) — só detectada e
parada; fusão de pacientes; atualização dos demais campos cadastrais da ficha do dono do
CPF; colunas de origem, referência autorizadora e natureza da alteração (seção 5);
cancelamento; remarcação; resolvedor temporal; resumo.

## 10. Pendências abertas por esta spec

- **`persistencia-v1.md` §6 fica parcialmente atendida** nesta v1: instante sim; origem e
  referência autorizadora não (seção 5). Registrado, nunca reconciliado em silêncio.
- **A referência autorizadora depende de `P4`/`P4I`** (identidade da operação idempotente),
  especificadas e não implementadas. Quando `P4I` entrar, reavaliar.
- **Grants amplos de `anon` sobre `pacientes`** continuam existindo no operacional,
  neutralizados só por RLS ativa sem policy. Pendência pré-existente, não criada nem
  agravada por esta spec, e não corrigida aqui.
