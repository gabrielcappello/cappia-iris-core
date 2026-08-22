# Recomendação de avaliação para paciente novo — spec mínima v1

**Status:** proposta para revisão. **Não implementada.** Não autoriza código,
migration, alteração de banco, painel ou n8n.

**Origem:** pedido do Gabriel (2026-08-22) discutido primeiro com o Codex, que
propôs a regra e a definição de "paciente novo" abaixo. Esta spec formaliza
essa proposta usando o mecanismo que `specs/consulta-agendamento-
conversacional-v1.md` e `specs/procedimento-semantico-v1.md` já estabeleceram
neste repositório, para não abrir um caminho novo de decisão no Core.

## 0. Por que isto não é uma frente nova

Este repositório já trata "Avaliação/Consulta" como procedimento de primeira
classe ([[iris-nova-visao-avaliacao-odontograma-orcamento]],
`specs/procedimento-semantico-v1.md` seção 5): quando o paciente demonstra
dúvida real sobre o que precisa, a interpretadora já pode escolher
`consultation_evaluation` sozinha, pela leitura do catálogo.

O que falta é um **segundo gatilho**, independente de o paciente parecer em
dúvida: **é a primeira vez desse paciente nesta clínica**. Hoje nenhum lugar
do Core lê isso — não existe conceito de "paciente novo" no código. A fonte
de dado já existe sem precisar de nada novo (seção 1).

## 1. Fonte de dado: sem migration, mas depende de escrita real no Painel

Confirmado por leitura do schema (`agendamentos`, ambiente dev
`bcmuqautblvjdqzhjfbw`, 2026-08-22): a coluna `status` aceita o valor
`'concluido'`, e a tabela já tem `paciente_id` + `clinica_id`. Mas a coluna
existir não prova que ela é preenchida — verificação feita:

- **Existe caminho de escrita real e intencional**, não coluna morta: a rota
  `iris-portal-v2/src/app/api/secure/agendamento-status/route.ts` chama a RPC
  transacional `cappia_atualizar_status_agendamento`, que só permite a
  transição `confirmado → concluido/faltou` (recusa `cancelado`/`remarcado`
  como origem, é idempotente em same-status). Essa rota é usada pelo app do
  dentista/secretaria no Painel — é a ação humana de "marcar atendimento como
  realizado".
- **Uso real confirmado pelo Gabriel (2026-08-22):** ele já usou a transição
  para `concluido` várias vezes no Painel e ela sempre funcionou. O caminho
  de escrita é real e testado — não é suposição.
- **Estado atual do operacional (`udizowyfjnhuhgxkeayk`, 2026-08-22):**
  `select status, count(*) from agendamentos group by status` devolveu
  **só `confirmado: 1`** agora. Isso reflete o estado presente do banco
  (ambiente de teste, [[iris-nova-ambiente-todo-teste]]), não o histórico de
  uso — o Gabriel já testou a transição antes; ausência de linha `concluido`
  hoje não significa ausência de uso passado, só que o dado atual não a
  contém.
- **Consequência esperada e aceita (não é risco a mitigar):** com o
  operacional sem nenhum atendimento `concluido` registrado no momento em
  que a spec entrar em produção, todo paciente identificado aparece como
  novo até o primeiro atendimento real ser marcado como concluído. Decisão
  do Gabriel: **esse é o comportamento certo** — reflete a realidade de que
  ainda não há histórico de atendimento real acumulado, não um defeito da
  regra.

Com a escrita confirmada, "paciente novo nesta clínica" é derivável do que já
existe, sem migration nem coluna nova:

```sql
existe linha em agendamentos
  where paciente_id = :paciente_id
    and clinica_id  = :clinica_id
    and status      = 'concluido'
```

**Definição (proposta do Codex, adotada):** paciente novo = **nenhum
atendimento concluído** naquela clínica — nunca "ausência de cadastro" ou
"nenhum agendamento futuro". Um paciente com cadastro e até com agendamento
`confirmado` pendente, mas sem nenhum `concluido`, ainda é novo para esta
regra. Preserva multiclínica: o mesmo paciente pode ser novo numa clínica e
não em outra (`clinica_id` sempre no predicado, mesmo padrão de
`buscar-agendamento-ativo.ts`).

Não reaproveita `buscarAgendamentoAtivo` (filtra `status='confirmado'` e
`data >= hoje` — é sobre agendamento futuro, não histórico). Precisa de uma
busca própria, nova, no mesmo espírito (`SELECT` direto, sem RPC, sem decidir
domínio — só traduz schema em contrato).

**Custo aceito (descoberto na implementação, 2026-08-22):** o Core já
garante "uma consulta a `agendamentos` por turno" para o contexto de
agendamento ativo (`orquestrador-consulta-agendamento.test.ts`, teste 8).
Como esta é uma consulta com filtro diferente (`concluido` vs.
`confirmado`), ela soma **uma segunda consulta** à tabela `agendamentos`,
mas só nas 4 decisões elegíveis (seção 3) — nunca nos fluxos operacionais de
reserva/remarcação/cancelamento. Considerado aceitável: unificar as duas
buscas exigiria alterar `buscar-agendamento-ativo.ts`, usado por três specs
já fechadas (remarcação, cancelamento, consulta de agendamento) — risco maior
que o custo de uma consulta extra, delimitada a 4 dos ~30 tipos de decisão.

## 2. Onde a decisão mora: Core objetivo, redatora natural

Mesmo princípio de `procedimento-semantico-v1.md` linha 8: **o Core decide
o fato, a IA escolhe a forma de falar.**

- **Core (objetivo, testável determinístico):** o turno carrega um fato novo,
  `paciente_novo_na_clinica: boolean`, na mesma família de
  `substituicao_por_avaliacao` e `agendamentos_do_paciente`
  (`orquestrador-tipos.ts` linha ~497-513) — **fato do turno, não estado, não
  decisão**. Não persiste, não é campo de `dados`, não muda `objetivo`.
- **Redatora (natural, escolhe a forma):** só usa o fato quando fizer sentido
  — nunca obrigatório, nunca repetido a cada mensagem (seção 4).

## 3. Regra de decisão (objetiva, no Core)

**Precisão de implementação (verificado contra `orquestrador.ts`,
2026-08-22):** o fato só é relevante enquanto o procedimento ainda não está
resolvido — nos passos seguintes de agendamento (`aguardando_escolha_
dentista`, `horarios_disponiveis` etc.) o procedimento já foi decidido e a
regra 1 abaixo já os exclui. Os tipos de decisão elegíveis são as três
conversacionais que `agendamentos_do_paciente` já usa
(`DECISOES_COM_CONTEXTO_DE_AGENDAMENTO` em `orquestrador.ts`: `saudacao`,
`duvida_livre`, `mensagem_nao_compreendida`) **mais** `aguardando_
procedimento` — que é exatamente o desfecho de "IA não conseguiu resolver
procedimento", o momento em que a dúvida real do paciente se manifesta no
Core (`procedimento-semantico-v1.md` § 4). `desistencia` fica fora nas duas
listas, mesmo motivo (seção 3.5).

Dado paciente identificado, turno numa dessas quatro decisões:

1. **Paciente já sabe o procedimento e o nomeia** (ex.: "quero marcar uma
   limpeza") → segue o fluxo normal. Não é interrompido por ser novo. A
   regra de dúvida real de `procedimento-semantico-v1.md` já cobre isso —
   `procedimento_id` presente e resolvido não é tocado por esta spec.
2. **Paciente novo (seção 1) E descreve só um problema, ou está em dúvida, ou
   ainda não mencionou procedimento algum** → o fato
   `paciente_novo_na_clinica: true` fica disponível para a redatora. Isso
   **não força** `consultation_evaluation` sozinho — continua sendo a regra
   de `procedimento-semantico-v1.md` § 3 que decide (dúvida real → catálogo
   tem avaliação → interpretadora escolhe). O fato novo apenas dá à redatora
   contexto para **explicar por que** está sugerindo avaliação, quando for o
   caso.
3. **Paciente não é novo** (já tem `concluido` nesta clínica) → fato ausente
   (nunca `false` explícito de propósito — mesmo padrão de
   `agendamentos_do_paciente`, "ausente, nunca `[]`"). Nenhuma menção a
   avaliação por causa desta spec.

## 4. Explicação natural — regra para a redatora, não lista de frases

Segue o padrão de `procedimento-semantico-v1.md` § 3: **nenhuma frase
fixa, nenhum texto hardcoded.** Instrução na direção certa, a IA escolhe as
palavras:

> Quando o paciente for novo nesta clínica e ainda não estiver claro qual
> procedimento ele precisa, explique que — por ser a primeira vez dele aqui —
> o caminho é começar com uma avaliação: o dentista examina, define o
> tratamento e, a partir daí, vocês organizam os próximos procedimentos
> juntos. Diga isso apenas quando for relevante para a dúvida do paciente
> naquele momento — nunca como texto padrão toda vez que um paciente novo
> escrever, e nunca quando ele já souber o que quer marcar. Se você já
> explicou isso nesta mesma conversa, não repita a explicação de novo —
> retome direto o que falta decidir.

**Explicitamente fora do texto da instrução:** exemplo de frase pronta (como
"Como é sua primeira consulta..." do Codex) não entra na instrução — é
ilustrativo para esta spec, não script para a IA reproduzir literalmente.
Mesma disciplina de `procedimento-semantico-v1.md` linha 93: "nenhuma lista
de palavras, nenhum exemplo de frase" no prompt real.

## 5. Pré-requisito: catálogo precisa ter Avaliação

Sem `consultation_evaluation` ativo no catálogo da clínica, esta spec não
tem o que oferecer — cai no comportamento de hoje (aguardando_procedimento,
pergunta genérica). **Decidido (Gabriel, 2026-08-22):** aqui é tratado só
como condição natural, nunca validação obrigatória — sem avaliação
cadastrada, o fato desta spec simplesmente não muda nada, sem bloqueio nem
aviso.

Tornar Avaliação obrigatória/fixa no catálogo (não removível pela clínica) e
gratuita por padrão é decisão de produto separada, com impacto em Painel e
no modelo de preços — ver `specs/catalogo-avaliacao-obrigatoria-gratuita-
v1.md`. Não bloqueia esta spec: as duas evoluem independentes, e o fato
`paciente_novo_na_clinica` funciona igual antes e depois de ela existir.

## 6. Cenários de teste

**Determinísticos (Core, sem IA):**

1. Paciente sem nenhum `agendamentos.status='concluido'` nesta clínica →
   `paciente_novo_na_clinica: true` no resultado do turno.
2. Mesmo paciente, mas com `concluido` em **outra** clínica apenas → ainda
   `true` nesta clínica (isolamento multiclínica).
3. Paciente com `concluido` nesta clínica → fato **ausente** (não `false`).
4. Paciente novo, mas `procedimento_id` já resolvido no turno (paciente
   nomeou o procedimento) → fato pode estar presente, mas não altera
   `objetivo` nem decisão — segue fluxo normal de agendamento.
5. Paciente novo, decisão do turno é `desistencia` → fato ausente, mesmo
   critério de exclusão que `agendamentos_do_paciente` já usa (seção 3 de
   `consulta-agendamento-conversacional-v1.md`): não reabrir assunto quando o
   paciente está encerrando.

**Contra a IA real (script avulso, mesmo padrão de
`procedimento-semantico-v1.md` § 8):**

6. Paciente novo, mensagem "sinto uma dor no dente, não sei o que é" →
   resposta natural sugere avaliação, explica o motivo (primeira vez),
   escolhe `consultation_evaluation`.
7. Paciente novo, mensagem "quero marcar uma limpeza" → agenda limpeza
   direto, **sem** menção a avaliação nem explicação de metodologia.
8. Paciente novo, duas mensagens seguidas de dúvida → a redatora não repete a
   explicação da metodologia de forma mecânica no segundo turno; ela segue a
   orientação de não repetir desnecessariamente (seção 4). **Não é uma
   garantia testável de "exatamente uma vez"** — não há memória estruturada
   dedicada a isso nesta v1; depende de a IA reconhecer, pelo histórico
   conversacional já disponível, que já explicou. Cenário de observação, não
   de asserção rígida.
9. Paciente **não novo**, mensagem "sinto uma dor, não sei o que é" →
   ainda pode cair em avaliação (regra de dúvida real de
   `procedimento-semantico-v1.md`), mas **sem** a explicação de "primeira
   consulta" — o fato dela não está disponível.

## 7. O que fica fora desta v1

- Verificação obrigatória/bloqueio de onboarding se a clínica não tiver
  Avaliação cadastrada (seção 5 — decisão pendente, não assumida).
- Qualquer coisa do ciclo dentista → odontograma → orçamento → Iris
  ([[iris-nova-visao-avaliacao-odontograma-orcamento]]) — essa spec cobre só
  o convite inicial à avaliação, não o plano de tratamento que vem depois.
- Escolha de modelo (Terra/Luna/Sol) — assunto independente, sem relação
  técnica com esta spec (o comportamento de paciente novo/avaliação é o
  mesmo qualquer que seja o modelo por trás). Tratar como decisão à parte,
  fora deste documento, quando o Gabriel quiser.
