# Avaliação obrigatória e gratuita no catálogo — spec mínima v1

**Status:** proposta inicial, recém-separada do pedido do Gabriel em
2026-08-22. **Não implementada. Não aprovada em detalhe** — só a existência
da ideia foi confirmada; o desenho abaixo ainda precisa de revisão antes de
qualquer código.

**Origem:** durante a aprovação de `specs/recomendacao-avaliacao-paciente-
novo-v1.md`, o Gabriel pediu três coisas que não pertencem àquela spec (ela
é só sobre recomendar avaliação a paciente novo — funciona igual com ou sem
isto aqui):

1. "Avaliação" vira procedimento **fixo** no catálogo de toda clínica — "não
   tem como retirar".
2. Avaliação é **gratuita por padrão**.
3. Uma **flag por clínica** para habilitar a Iris a informar que a avaliação
   é gratuita.

## 0. Por que isto colide com decisões já tomadas — precisa de desenho, não só código

### 1. "Fixo, não removível" não existe hoje em nenhum procedimento

O catálogo inteiro (`procedimentos_catalogo` + `clinicas.precios`) é
definido pela clínica, item a item, sem noção de procedimento obrigatório.
Tornar um item "não removível" é regra de negócio nova no Painel (tela de
configuração, `dashboard/page.tsx`), não ajuste de prompt nem de Core.
**Pergunta em aberto:** "fixo" significa que toda clínica nova já nasce com
Avaliação ativa (seed/default) e pode desativar se quiser, ou literalmente
sem botão de desligar? São implementações bem diferentes.

### 2. "Gratuita por padrão" colide com uma decisão deliberada já registrada

`src/core/precos-clinica.ts` linhas 90-94 (`derivarPrecosClinica`) tratam
`valor <= 0` como **"ainda não definido"**, nunca como "gratuito", por
decisão explícita já documentada no código: *"R$ 0,00 seria uma promessa de
gratuidade que ninguém fez"*. Reaproveitar `valor: 0` para significar
"gratuito" reverteria essa decisão silenciosamente e mudaria o sentido de
todo cadastro legado com valor zerado (hoje interpretado como pendência, não
como gratuidade). **Precisa de um campo novo e explícito** (ex.:
`gratuito: true` no item do catálogo), não reuso do valor numérico.

### 3. A flag por clínica (item 3) é a parte que já tem padrão pronto

Isso se encaixa exatamente no mecanismo que já existe: `mostrar_valor` é
hoje a "INFORMA VALOR?" por procedimento, escrita pelo Painel, lida por
`derivarPrecosClinica`, e só vira fato para a redatora quando `true`. Uma
vez que exista o campo `gratuito` (item 2), informar "é gratuita" à Iris é a
mesma mecânica — sem inventar canal novo. Esta parte é de baixo risco e
reaproveita o padrão inteiro.

## 1. O que precisa de decisão do Gabriel antes de especificar em detalhe

- **Escopo de "fixo":** seed automático em clínica nova vs. trava real
  impedindo desativação em qualquer clínica (inclusive as já cadastradas
  hoje sem Avaliação).
- **Campo de gratuidade:** nome do campo, se coexiste com `valor` (ex.:
  `valor` ignorado quando `gratuito: true`) ou se `valor` fica ausente
  nesse caso.
- **Migração do cadastro existente:** clínicas que já têm "Consulta /
  Avaliação" cadastrada com preço — o que acontece com o valor delas quando
  a regra de "gratuita por padrão" entra em vigor? Sobrescrever é uma
  decisão de dado real, não de código.
- **Alcance:** vale para toda clínica existente retroativamente, ou só para
  cadastros novos a partir de agora?

## 2. Fora desta v1 (por enquanto — nada implementado)

Esta spec não autoriza nenhuma migration, alteração de painel, ou mudança em
`precos-clinica.ts` até essas perguntas serem respondidas. Ela existe para
não perder o pedido do Gabriel, separada do ajuste de paciente novo
(`specs/recomendacao-avaliacao-paciente-novo-v1.md`), que pode ser aprovado
e implementado independente desta.
