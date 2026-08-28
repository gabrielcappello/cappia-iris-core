# Recomendação de avaliação para paciente novo — spec mínima v1

**Status:** **implementada, testada e publicada em 2026-08-22.** Commit
`af6df85`. Edge `iris-nova-mensagem` v78 `ACTIVE` no operacional
`udizowyfjnhuhgxkeayk`, `verify_jwt: true` preservado. Suíte determinística
1549/1554 (5 skipped, 0 falhas). Teste contra IA real (redatora, OpenAI):
4/4 — `src/eval/teste-real-paciente-novo.ts`, cenários 6-9 da seção 6.
Validação de tráfego real em produção (WhatsApp) ainda pendente — nenhuma
mensagem processada pela v78 até a publicação desta nota.

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

## 1. Fonte de dado: cadastro do paciente

**Definição final de Gabriel em 2026-08-28:** esta recomendação é exclusiva
para quem **ainda não tem cadastro de paciente nesta clínica**. O Core já
recebe esse fato da identificação: `identificacao.paciente.id === null`.

Se existe cadastro, a Iris não oferece avaliação automaticamente, mesmo que
não exista atendimento concluído ou agendamento futuro. Quando existe
tratamento aprovado pendente, ela trata somente desse procedimento e, no
máximo, pergunta se o paciente deseja falar de outro assunto.

Não existe consulta adicional, migration ou estado novo. A verificação de
histórico em `agendamentos`, introduzida na primeira versão, foi removida por
ser desnecessária para a definição final.

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

Dado um turno numa dessas quatro decisões:

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
3. **Paciente não é novo** (já tem cadastro nesta clínica) → fato ausente
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

1. Telefone sem cadastro de paciente nesta clínica →
   `paciente_novo_na_clinica: true` no resultado elegível do turno.
2. Mesmo telefone com cadastro em outra clínica apenas → ainda é novo nesta
   clínica (isolamento multiclínica).
3. Paciente cadastrado nesta clínica → fato **ausente** (não `false`),
   independentemente do histórico de agendamentos.
4. Paciente cadastrado com tratamento aprovado pendente → `tratamentos_aprovados`
   presente e `paciente_novo_na_clinica` ausente; a resposta trata somente
   do procedimento pendente e, no máximo, pergunta se o contato é sobre
   outro assunto.
5. Paciente sem cadastro, mas `procedimento_id` já resolvido no turno (paciente
   nomeou o procedimento) → fato pode estar presente, mas não altera
   `objetivo` nem decisão — segue fluxo normal de agendamento.
6. Paciente novo, decisão do turno é `desistencia` → fato ausente, mesmo
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
