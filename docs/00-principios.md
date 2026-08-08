# Princípios Fundamentais da Iris

**Status: canônico.** Este documento vem antes de qualquer regra específica. Toda
especificação nova em `specs/` deve declarar aderência a ele, e qualquer decisão de
arquitetura que o contrarie precisa de aprovação explícita do Gabriel, registrada por
escrito — nunca resolvida em silêncio dentro de uma implementação.

Aprovado pelo Gabriel em 2026-08-08.

**Os princípios, de relance:**

1. **Responsabilidade correta** — se a IA compreende naturalmente, o Core não recria essa
   inteligência.
2. **Remoção** — procurar o que remover antes de pensar no que acrescentar.
3. **Teste isolado** — o resultado do teste não pode ser explicável por mecanismo antigo
   ou paralelo.
4. **Testes realistas** — frase artificial não vira requisito nem mudança de arquitetura.

---

## Princípio da responsabilidade correta

Sempre que surgir uma nova regra, a primeira pergunta obrigatória é:

> **"Isso realmente pertence ao Core ou é algo que a IA consegue compreender
> naturalmente?"**

Se a IA puder compreender naturalmente, o Core não deve recriar essa inteligência através
de regras, aliases, listas, heurísticas ou estados intermediários.

**O Core existe para:**

- validar;
- garantir integridade;
- manter o estado estruturado;
- executar operações determinísticas.

**A IA existe para:**

- compreender linguagem humana;
- interpretar significado;
- transformar linguagem natural em dados estruturados;
- redigir respostas naturais.

**Nunca adicionar lógica determinística apenas para compensar uma limitação artificial
imposta à IA.**

A complexidade deve permanecer onde ela pertence: na compreensão da linguagem, não no
código.

## Princípio da remoção

Sempre que uma nova implementação for proposta, procurar primeiro o que pode ser removido
antes de pensar no que pode ser acrescentado.

A melhor implementação normalmente é aquela que **reduz** o número de componentes do
sistema mantendo o mesmo comportamento.

## Princípio do teste isolado

**Um teste de uma funcionalidade nova deve isolar o mecanismo novo. O resultado não pode
ser explicável por mecanismo antigo ou paralelo.**

Um teste que passa porque outro mecanismo já produzia o mesmo resultado não prova nada —
e é pior que não ter teste, porque cria confiança falsa e libera um deploy.

Na prática:

- remover do cenário todo contexto paralelo que possa explicar o resultado sozinho;
- quando possível, montar o teste como um **par A/B** — mesma entrada, variando só o
  mecanismo novo — e exigir que os dois lados **difiram**. Assim o teste não consegue
  passar se o mecanismo novo não tiver efeito;
- para uma funcionalidade que atravessa uma fronteira (HTTP, banco, fila), asserir sobre o
  que **realmente cruza a fronteira**, não sobre o objeto de entrada.

## Princípio dos testes realistas

**Casos de teste conversacionais devem representar mensagens plausíveis de pacientes
reais. Não criar requisitos nem alterações arquiteturais baseados em frases artificiais ou
cenários improváveis. Antes de tratar um comportamento como bug, perguntar: "Um paciente
real realmente falaria isso?" Se a resposta for não, o caso não deve orientar o produto.**

Comportamento estranho do sistema diante de uma frase que ninguém diria **não é achado** —
é ruído de um cenário fabricado. Tratá-lo como problema gera trabalho a partir de
imaginação, não de evidência.

Na prática:

- antes de escrever uma mensagem de teste, perguntar: **um paciente escreveria isso?**
  Referência de registro real (WhatsApp, 2026-08-07): *"Estou com dor de dente dos
  infernos"*, *"Uma consulta normal para o dentista desidir"*, *"Avaliação né"*, *"Tem
  para amanhã de manhã?"*, *"Un instante quanto?"*;
- um padrão válido num contexto não é automaticamente válido em outro. Responder "o
  segundo" faz sentido quando a Iris apresentou uma **lista** de horários; não faz sentido
  como resposta a uma pergunta binária ("manhã ou tarde?");
- nunca escalar um caso sintético para linguagem de risco real ("na prática, num
  atendimento real..."). Se não veio de conversa real, dizer isso explicitamente;
- diante de saída estranha, primeiro perguntar se a **entrada** era plausível — antes de
  concluir que o sistema está errado.

---

## Origem — os casos reais que produziram estes princípios

Registrados para que não sejam relitigados como opinião abstrata.

**1. Resolução de procedimento por alias (2026-08-08).** Uma regra do próprio projeto
proibia a IA de resolver procedimento contra o catálogo. Para compensar essa proibição, o
Core recriou a inteligência que faltava: normalização de texto, correspondência exata
contra oito nomes oficiais, e um mapa manual de sinônimos que crescia a cada forma nova de
falar. Resultado prático: o paciente precisava adivinhar o nome cadastrado no Painel — um
paciente real disse "Avaliação né" e a conversa travou, porque o catálogo tinha
`"Consulta / Avaliação"`. A correção não foi mais um sinônimo: foi devolver a
responsabilidade à IA e apagar ~1.300 linhas de compensação
(`specs/procedimento-semantico-v1.md`).

**2. Guarda lexical da redatora (2026-08-06).** A guarda tentava detectar, por regex, se o
texto afirmava uma reserva ("marcado", "confirmado") — e precisava de uma exceção nova a
cada frase que ela não previa. Chegou a reprovar *"Ainda não está confirmado, tá?"* por
conter a palavra "confirmado". Era um segundo interpretador de português feito em código.
Removida por completo; a guarda passou a verificar apenas o que é objetivamente
verificável (um horário citado existe nos fatos autorizados?).

**3. Interpretadora cega por turno (2026-08-07).** Um "Sim" isolado era classificado como
`nao_compreendida`. A correção **não** foi ensinar ao sistema o que a palavra "sim"
significa — isso seria regra-por-palavra. Foi dar à IA o contexto que faltava (o que a
Iris acabou de perguntar) e confiar na compreensão que o modelo já tem
(`specs/historico-conversacional-v1.md`).

O padrão é o mesmo nos três: **o sintoma aparecia no Core, mas a causa era uma
responsabilidade colocada no lugar errado.**

Os dois seguintes são sobre **teste**, e ambos aconteceram no mesmo dia:

**4. O teste que provava o mecanismo errado (2026-08-08).** `historico_recente` foi
adicionado ao tipo, ao extrator e ao orquestrador — mas nunca foi copiado para o corpo
HTTP, que é montado campo a campo. O histórico morria na porta de saída e a interpretadora
nunca o recebeu em produção. O runner contra a IA real passou 7/7 mesmo assim, porque
**todos os casos positivos também tinham `proposta_pendente`**, suficiente sozinha para o
resultado esperado. Origem do princípio do teste isolado.

**5. A frase que ninguém diria (2026-08-08).** Um caso de teste fazia o paciente responder
*"A segunda"* à pergunta *"Você prefere de manhã ou à tarde?"*. O modelo devolveu um
horário que ninguém mencionou, e isso foi reportado ao Gabriel como possível problema de
produção — inclusive com a frase "na prática, num atendimento real...". Mas ninguém
responde uma pergunta binária com um ordinal: a entrada era inventada, e a saída estranha
era consequência disso, não um defeito do sistema. Origem do princípio dos testes realistas.

Nestes dois o padrão também se repete: **o teste dava uma resposta confiante sobre algo
que ele não tinha condição de provar.**

## Como aplicar na prática

- Ao propor uma spec: declarar no topo a aderência a este documento e apontar,
  explicitamente, o que a mudança **remove**.
- Ao encontrar uma lista de palavras, um mapa de sinônimos, um regex sobre linguagem
  natural ou um estado intermediário criado só para "ajudar" a IA: tratar como candidato a
  remoção, não como algo a estender.
- Diante da escolha entre **acrescentar mais uma regra** e **remover uma camada inteira**:
  remover a camada, desde que o comportamento final continue correto.
- Ao escrever um teste: a mensagem precisa soar como paciente real, e o resultado precisa
  ser impossível de explicar por outro mecanismo.
- Ao reportar um achado: dizer de onde ele veio. Conversa real e cenário sintético não têm
  o mesmo peso, e confundir os dois gera trabalho inventado.
- Uma exceção a estes princípios é possível, mas nunca implícita: precisa estar escrita na
  spec, com o motivo, e aprovada pelo Gabriel.

---

Este documento é cumulativo: cada princípio novo entra com o caso real que o produziu.
Serve para não repetir o mesmo erro em sessões futuras — a lista existe para ser
consultada antes de decidir, não depois de errar.
