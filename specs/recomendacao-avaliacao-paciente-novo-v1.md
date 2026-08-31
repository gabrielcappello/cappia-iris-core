# Recomendação de avaliação para paciente novo — spec mínima v1

> ## ⚠️ REVOGAÇÃO PARCIAL — decisão do Gabriel, 2026-08-31
>
> **A definição de "paciente novo" desta spec está REVOGADA.** Ela equiparava
> ausência de cadastro local (`identificacao.paciente.id === null`) a paciente
> novo / primeira consulta. Essa equivalência é **falsa** e está proibida.
>
> **Motivo (realidade operacional):** o caso mais comum é o paciente que **já é
> cliente da clínica**, com ficha no sistema antigo/externo ainda não
> sincronizado com a Iris. A Iris não encontra nada pelo telefone e concluía
> "primeira visita" — errado, e observado em conversa real de WhatsApp.
>
> **O que passa a valer:** `paciente.id === null` significa **somente** que não
> existe cadastro local associado àquele telefone. Nunca primeira visita.
> Avaliação só pode ser sugerida quando o paciente **declarar** que é sua
> primeira consulta, ou **demonstrar que não sabe** qual atendimento precisa.
> "Ainda não informou o procedimento" **não equivale** a "não sabe o
> procedimento".
>
> **Escopo da revogação:** seção 1 (fonte de dado) e seção 3 regra 2, mais o
> texto da instrução da seção 4. O restante da spec — avaliação como
> procedimento de primeira classe, a decisão morar no Core e a redação ser
> natural — **permanece em vigor**. Ver `## 8. Regra vigente` ao final.

**Status:** implementada em 2026-08-22 (commit `af6df85`) e **parcialmente
revogada em 2026-08-31** pela decisão acima. O histórico abaixo é preservado
como registro do que foi implementado então, não como regra corrente.

Registro histórico de 2026-08-22: Edge `iris-nova-mensagem` v78 `ACTIVE` no
operacional `udizowyfjnhuhgxkeayk`, `verify_jwt: true` preservado. Suíte
determinística 1549/1554 (5 skipped, 0 falhas). Teste contra IA real
(redatora, OpenAI): 4/4 — `src/eval/teste-real-paciente-novo.ts`, cenários 6-9
da seção 6.

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

> **⚠️ SEÇÃO REVOGADA em 2026-08-31.** A definição abaixo está fora de vigor.
> Preservada como registro do que valia até 30/08. Regra vigente: seção 8.

**Definição final de Gabriel em 2026-08-28 — REVOGADA em 2026-08-31:** esta
recomendação é exclusiva para quem **ainda não tem cadastro de paciente nesta
clínica**. O Core já recebe esse fato da identificação:
`identificacao.paciente.id === null`.

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
2. **[⚠️ REGRA REVOGADA em 2026-08-31 — ver seção 8. Preservada como
   registro.]** ~~Paciente novo (seção 1) E descreve só um problema, ou está em
   dúvida, ou~~
   ~~ainda não mencionou procedimento algum~~ → o fato
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

> **⚠️ O TEXTO DA INSTRUÇÃO ABAIXO ESTÁ REVOGADO em 2026-08-31** (afirma
> "primeira vez dele aqui" a partir de cadastro ausente). Preservado como
> registro. O princípio da seção — nenhuma frase fixa, a IA escolhe as
> palavras — **permanece em vigor**. Instrução vigente: seção 8.

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
   outro assunto. Se a mensagem for apenas uma saudação, esse tratamento
   vira o objetivo principal da resposta, nunca contexto secundário de uma
   oferta genérica de ajuda.
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

## 8. Regra vigente (decisão do Gabriel, 2026-08-31)

Esta seção **substitui** a seção 1 e a regra 2 da seção 3. Onde houver
divergência com qualquer trecho acima, esta seção prevalece.

### 8.1 Dois fatos distintos, nunca convertidos um no outro

| Fato | O que significa | O que NÃO significa |
|---|---|---|
| **cadastro local ausente** | não existe cadastro na Iris associado àquele telefone | não significa paciente novo, nem primeira consulta |
| **declaração de vínculo** | o paciente disse que já é cliente da clínica | não significa que a ficha foi localizada |

A realidade operacional que sustenta a separação: o paciente pode ser cliente
antigo com ficha no sistema anterior da clínica, ainda não sincronizado com a
Iris. **Cadastro não encontrado na Iris nunca prova primeira visita.**

### 8.2 Quando a avaliação pode ser sugerida

Somente quando:

1. o paciente **declarar** que é sua primeira consulta; ou
2. o paciente **demonstrar que não sabe** qual atendimento precisa.

**"Ainda não informou o procedimento" NÃO equivale a "não sabe o
procedimento".** Campo vazio é ausência de dado, não dúvida declarada. A regra
de dúvida real de `procedimento-semantico-v1.md` § 3 continua sendo quem
resolve o caso 2, sem fato novo.

Ausência de cadastro local **nunca** é gatilho de avaliação.

### 8.3 Saudação simples

Saudação é apenas saudação: a Iris cumprimenta e pergunta como pode ajudar.

O fato de cadastro ausente **não é enviado à redatora quando cadastro não é
assunto do turno**. A garantia é estrutural (o fato não chega), nunca
comportamental (instruir a IA a não mencionar) — instrução não é garantia, e
depender dela já falhou antes nesta mesma spec.

### 8.4 Declaração "já sou cliente"

Quando o paciente declara vínculo, semanticamente e sem lista de frases:

- a Iris **reconhece** a declaração;
- **quando relevante**, explica que não encontrou cadastro associado àquele
  número e que a ficha pode estar em outro sistema ou com outro telefone;
- **não** o chama de paciente novo;
- **não** oferece avaliação automaticamente;
- **continua o fluxo normal** de agendamento, coletando apenas os dados
  necessários.

### 8.5 CPF: sem busca antecipada nesta etapa

**Não existe busca por CPF antes do fluxo de persistência.** Provado contra o
código em 2026-08-31: `cappia_persistir_paciente` é chamada uma única vez
(`orquestrador.ts`), **depois** da confirmação do horário e **somente** com o
cadastro já completo — a colisão de CPF é descoberta ao tentar escrever, nunca
por consulta prévia. Persistência não é capacidade de localização.

Quando o CPF chega ao fluxo existente:

- **encontrado em outra ficha/telefone** → fluxo já implementado de
  confirmação da troca de telefone (`cpf-outro-telefone-v1.md`), com
  confirmação explícita, preservando histórico e agendamentos;
- **não encontrado** → criar o registro operacional necessário na Iris, **sem
  concluir nem afirmar** que é a primeira visita à clínica.

### 8.6 Remoção global da inferência

A inferência "cadastro local ausente = paciente novo" é removida de todo o
sistema, não apenas suprimida na saudação. Isso vale mesmo quando a declaração
semântica do paciente não estiver disponível no turno — impede que a conclusão
errada reapareça em turnos futuros.
