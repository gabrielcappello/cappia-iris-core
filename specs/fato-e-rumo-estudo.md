# Fato e rumo: quem decide o quê na conversa da Iris

Estudo pedido por Gabriel em 2026-08-19. **Nenhuma linha de código alterada
por este documento.** Serve para decidir antes de mexer.

Origem: a Iris respondeu "obrigado" com "Qual procedimento você gostaria de
agendar a seguir?" — logo depois de ter confirmado a remarcação dele.

---

## 1. Os três problemas são distintos

O caso parece um só, mas são três defeitos independentes. Corrigir um não
corrige os outros.

| # | Defeito | Onde | Gravidade |
|---|---------|------|-----------|
| 1 | Fluxo concluído não deixa memória de que concluiu | Core | **Grave** — é a origem |
| 2 | Objetivo do Core é ordem absoluta sobre a redatora | Instrução | Estrutural |
| 3 | Não existe categoria "encerramento" | Interpretadora | Menor do que parecia |

---

## 2. Problema 1 — o procedimento confirmado que virou "aguardando"

### O que Gabriel observou

> "como assim se o procedimento já estava falado. alinhadores. e já foi
> confirmado, o que fica aguardando? isso é um problema de atualização,
> deveria ficar que aquele procedimento, operação já foi finalizada."

Está exatamente certo, e o diagnóstico dele é o correto.

### O que o código realmente faz

Quando um fluxo conclui (`reserva_criada`, `remarcacao_criada`,
`cancelamento_criado`), o Core **apaga** os campos operacionais —
`orquestrador.ts:793` (`camposParaLimparAoConcluir`).

Isso é certo e foi feito de propósito. O comentário em `orquestrador.ts:801-807`
descreve um bug real medido em produção: sem apagar, o turno seguinte
reencontrava "amanhã"+"10:00" pendurados e tentava montar um agendamento novo
com eles. A limpeza resolve isso.

### A lacuna, com prova

Duas buscas no código-fonte, ambas **vazias**:

```
grep "ultimo_desfecho|desfecho_anterior|fluxo_concluido" src/core/*.ts  ->  nada
```

**Não existe nenhum registro de que um fluxo terminou.** Só a ausência dos
campos.

E aí está o defeito: para o turno seguinte,

```
"acabei de remarcar com sucesso"        ->  procedimento_id ausente
"nunca conversamos sobre procedimento"  ->  procedimento_id ausente
```

são **o mesmo estado**. Indistinguíveis.

`orquestrador.ts:1409` então faz a única coisa que sabe fazer com um
procedimento ausente:

```typescript
if (!procedimento) {
  return { decisao: { tipo: 'aguardando_procedimento' } };
}
```

A limpeza está certa. O que falta é o Core lembrar **por que** limpou.

### Por que isto é a origem

Sem o problema 1, o "obrigado" teria chegado num turno cujo objetivo natural
seria conversar — e nada teria dado errado, mesmo com os problemas 2 e 3
intactos. Os outros dois só ficaram visíveis porque este abriu a porta.

### Solução proposta

Gravar, junto com a limpeza, **o que aconteceu**: um campo em `dados` do tipo
`ultimo_desfecho` (ex.: `remarcacao_criada`) com a hora.

Isso é dado, não interpretação — o Core sabe o que ele mesmo acabou de
executar. Com ele, o turno seguinte distingue "fluxo recém-concluído" de
"conversa em branco", e um turno sem conteúdo novo depois de um sucesso deixa
de virar cobrança.

Custo: um campo. Não é camada nova, não é abstração — é o Core anotando um
fato que ele já tem na mão e joga fora.

---

## 3. Problema 2 — o objetivo como ordem absoluta

### A pergunta de Gabriel

> "mas Iris está obrigada a falar o que o Core quer? então de que vale a
> inteligência dela? Iris tem que ter liberdade de conversar com o paciente.
> o Core não tem inteligência."

### O que a instrução diz hoje

`redator-instrucoes.ts:46`:

> "O objetivo do turno atual **manda sobre qualquer coisa** que você tenha
> dito antes no histórico."

E na linha 60, escrita hoje por mim, o oposto:

> "Isto vale **MESMO** que o objetivo do turno peça outra coisa."

**Duas regras contraditórias na mesma instrução.** A segunda é um remendo, e
Gabriel identificou que remendo assim não escala: cada situação social nova
(obrigado, tchau, "depois eu vejo", "vou pensar") exigiria outra exceção.

### Correção de uma afirmação minha

Eu disse antes: *"ela nunca soube que era um obrigado"*. **Errado.**

`cliente-modelo-redator-openai.ts:103` envia `mensagem_paciente` — o texto
literal. Ela **leu** a palavra "obrigado". Entendeu, e respondeu outra coisa
porque a instrução manda o objetivo vencer.

Não foi burrice. Foi obediência. Isso é mais grave em estrutura e melhor em
prognóstico: a inteligência está lá, só sem permissão de agir.

### O que Gabriel pediu — e por que ele tem razão no cuidado

> "essa instrução tem que ser corrigida. mas não podemos esquecer o que pode
> acontecer com a falta dela. talvez só ajustar a palavra pra ter um objetivo
> mais maleável."

O cuidado é justificado. A linha 46 existe para resolver um problema real:
sem ela, a Iris repetia perguntas já respondidas e pedia confirmação de coisa
já feita — ela seguia o histórico em vez do estado atual.

Ou seja: **a linha 46 protege contra a Iris ignorar o que o Core executou.**
Remover é regressão garantida.

### A distinção que resolve

O objetivo hoje mistura duas coisas que deveriam ser separadas:

| | O que é | Quem manda |
|---|---|---|
| **Fato executado** | "a remarcação foi feita", "o horário está livre" | Core. Sem apelo. |
| **Rumo sugerido** | "o próximo passo seria pedir a data" | Iris lê a sala |

A linha 46 deve continuar **inteira** para a primeira coluna: nenhum fato
executado pode ser contrariado, ignorado ou reaberto. É onde mora a
segurança, e nada disso muda.

Para a segunda, o objetivo passa a ser **o que falta**, não **o que dizer**.
Se o paciente se despediu, ela se despede; o que falta continua faltando e ele
volta quando quiser.

### Redação proposta (para decisão de Gabriel)

Substituir "manda sobre qualquer coisa" por algo como:

> "Os FATOS que o Core informa são definitivos: um desfecho executado
> aconteceu, e você nunca reabre, repete ou pede confirmação do que já foi
> feito. O OBJETIVO é o próximo passo do agendamento — siga-o sempre que o
> paciente não trouxer outra coisa. Quando ele se despede, agradece, hesita
> ou muda de assunto, atenda o que ELE trouxe: o objetivo continua válido e
> espera o momento certo, sem ser perdido."

Isto mantém a proteção e devolve a leitura de sala. E remove a contradição
com a linha 60 — a exceção deixa de ser exceção e vira o princípio.

---

## 4. Problema 3 — a categoria "encerramento"

### A pergunta de Gabriel

> "então aquilo que fez de obrigado vlw etc. vai ter que ser defeito né?"

**Resposta: não vira defeito, mas deixa de ser a solução principal.**

O que fiz hoje: ensinei a interpretadora a classificar "obrigado"/"valeu"/"só
isso" como `negacao`, que leva ao objetivo `encerrar_cordialmente` — um
objetivo que **já existia no Core** (`fatos-autorizados.ts:529`) e nunca era
alcançado.

Isso continua útil: é o Core sabendo, por dedução, que a conversa fechou. Mas
com os problemas 1 e 2 resolvidos, ele deixa de ser **necessário** para o caso
não acontecer — vira reforço, não muleta.

### O limite honesto

Gabriel observou:

> "o problema do Core não entender, ou Iris, ou quem seja, que obrigado é só
> isso — os problemas nunca vão acabar."

Certo. Enquanto a solução for **prever a palavra**, cada expressão nova é um
buraco: "tá bom então", "beleza", "depois eu vejo", "vou pensar". Por isso o
peso deve ficar nos problemas 1 e 2, que **não dependem de prever**.

---

## 5. Ordem recomendada

| Ordem | O quê | Por quê |
|---|---|---|
| 1º | `ultimo_desfecho` no Core (problema 1) | É a origem; sozinho já evita o caso |
| 2º | Redação da linha 46 + remover a contradição da 60 | Devolve a leitura de sala sem soltar os fatos |
| 3º | Manter a categoria de encerramento | Reforço barato, já feito |

Os três são independentes. Cada um pode ser aplicado e testado sozinho.

---

## 6. O que NÃO muda

Registrado porque a liberdade da Iris não pode virar liberdade sobre fatos:

- Os guards continuam intactos. Ela nunca inventa horário, preço, dentista ou
  disponibilidade. **A liberdade é sobre o rumo da conversa, nunca sobre o
  conteúdo factual.**
- A IA continua sem acesso a banco e sem `tools`.
- Nenhuma camada nova, nenhuma abstração nova — o problema 1 é um campo, o
  problema 2 é redação.
- Nenhum desfecho do Core deixa de existir.

---

## 7. Os 31 desfechos, classificados

Levantados de `orquestrador-tipos.ts`. Serve para ver que a distinção
fato/rumo cobre todos.

**FATO EXECUTADO — a Iris nunca contraria (15)**
`reserva_criada`, `remarcacao_criada`, `cancelamento_criado`,
`reserva_conflito`, `reserva_falhou`, `combinacao_indisponivel`,
`horarios_disponiveis`, `sem_dentista_disponivel`, `sem_agendamento_para_remarcar`,
`sem_agendamento_para_cancelar`, `cpf_ja_cadastrado`, `clinica_sem_catalogo`,
`duracao_nao_configurada`, `erro_configuracao_duracao`, `erro_catalogo_dentista`

**RUMO — o que falta; a Iris escolhe o momento (10)**
`aguardando_procedimento`, `aguardando_data_horario`, `aguardando_escolha_dentista`,
`aguardando_confirmacao`, `aguardando_confirmacao_remarcacao`,
`aguardando_confirmacao_cancelamento`, `aguardando_escolha_agendamento`,
`aguardando_escolha_agendamento_cancelamento`, `cadastro_necessario`,
`troca_telefone_pendente`

**CONVERSA — já é rumo puro (6)**
`saudacao`, `duvida_livre`, `desistencia`, `resolvido`,
`mensagem_nao_compreendida`, `troca_telefone_recusada`

Todos os 10 do meio são "falta X" — nenhum precisa ser ordem de fala. É
exatamente aí que a mudança do problema 2 age, e em lugar nenhum além.
