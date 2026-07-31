# Disponibilidade v1

**Status:** especificação canônica aprovada para o primeiro fluxo de novo agendamento.
Este documento define contrato lógico e comportamento; não autoriza implementação,
alteração de banco, criação de tabelas, migration, schema físico, alteração do painel
ou de workflows.

Esta especificação complementa `novo-agendamento.md`, `procedimentos-v1.md`,
`dentistas-vinculos-v1.md`, `duracao-v1.md`, `eventos-conversacionais-v1.md` e
`controlador-conversacional-v1.md`. Permanecem fixas as decisões de
`../docs/02-arquitetura.md` e `../docs/04-decisoes-canonicas.md`: a IA interpreta
somente a mensagem atual e nunca decide; o Core determinístico resolve;
Supabase/Postgres é a fonte oficial.

## 1. Objetivo e escopo

A etapa de disponibilidade recebe fatos oficiais já resolvidos e devolve **opções reais
de horário**, ou um resultado tipado de indisponibilidade.

**Entrada oficial mínima**: `clinica_id` da instância autenticada; `procedimento_id`
oficial; `dentista_id` ou o conjunto de dentistas aptos; vínculo oficial ativo;
`duracao_min` válida; data solicitada; período solicitado, quando existir; horário
solicitado, quando existir; fuso oficial da clínica; instante oficial atual.

**Fora do escopo**: texto ao paciente (`atendimento-v1.md`); criação do agendamento;
remarcação; schema físico.

A IA não consulta agenda, não escolhe horário, não ordena opções e não inventa
disponibilidade.

## 2. Fontes oficiais

Somente estes fatos participam do cálculo:

- `clinica_id` da instância autenticada;
- procedimento oficial, ativo, da clínica;
- duração oficial, conforme `duracao-v1.md`;
- dentistas ativos e aptos ao procedimento, conforme `dentistas-vinculos-v1.md`;
- jornada configurada do dentista;
- intervalos de atendimento;
- almoço;
- bloqueios internos;
- agendamentos ativos;
- eventos Google autorizados, quando a integração estiver configurada corretamente
  (seção 14);
- fuso horário oficial da clínica;
- instante oficial atual.

Nenhuma outra fonte pode participar. Em particular, nenhuma duração de dentista, de
vínculo, de catálogo global ou de agendamento histórico entra no cálculo.

## 3. Intervalos livres

Intervalos são **semiabertos**: `[início, fim)`.

Adjacência é permitida e não constitui sobreposição: um atendimento pode terminar
exatamente quando outro começa, e pode começar exatamente quando um bloqueio termina.

Construção: materializar a jornada do dia no fuso da clínica e subtrair almoço,
bloqueios, agendamentos ativos e eventos externos autorizados. Unir adjacentes.

**Descartar todo intervalo livre com extensão menor que a duração oficial.**

## 4. Duração

A duração oficial vem exclusivamente de `duracao-v1.md`: mínimo 10 minutos, máximo 240
minutos, múltipla de 10, **a mesma para todos os dentistas aptos** ao procedimento
naquela clínica.

O limite de 120 minutos usado nas seções 5 e 6 refere-se à **extensão do intervalo
livre**, nunca à duração do procedimento, ao horizonte de busca, a TTL ou a validade da
opção.

## 5. Intervalo curto — extensão ≤ 120 minutos

Oferecer somente:

1. o início real do intervalo;
2. o último início possível que faça o procedimento terminar exatamente no fim.

```
L = fim − duração
resultado = ordenar_e_deduplicar([início, L])
```

- Intervalo com extensão igual à duração → somente o início (`L == início`).
- Intervalo com extensão menor que a duração → nenhuma opção.

Exemplos:

| Intervalo | D | Resultado |
|---|---|---|
| 08:00–10:00 | 40 | 08:00, 09:20 |
| 09:20–11:20 | 40 | 09:20, 10:40 |
| 08:00–08:40 | 40 | 08:00 |
| 08:00–08:30 | 40 | nenhuma opção |

## 6. Intervalo amplo — extensão > 120 minutos

1. incluir sempre o **início real** do intervalo;
2. localizar a primeira **hora cheia** igual ou posterior a `início + 30 minutos`;
3. gerar horários regulares de **60 em 60 minutos** a partir dela, enquanto o
   procedimento couber integralmente;
4. calcular `L = fim − duração`;
5. se `L` já estiver entre as opções, manter;
6. se `L` não estiver:
   - havendo **pelo menos um** horário regular, substituir o **último regular** por `L`;
   - **não havendo** horário regular, acrescentar `L` **sem remover o início real**;
7. ordenar e remover duplicidades;
8. validar que toda opção cabe integralmente no intervalo.

**O início real nunca pode ser removido.**

O passo é hora a hora **independentemente da duração** — nunca `max(60, duração)`.

As opções podem se sobrepor entre si porque são **alternativas mutuamente
excludentes**: apenas uma será escolhida. Um horário não é removido por sobrepor outro.

### Pseudocódigo

```
gerar_opcoes(intervalo [I, F), duracao D):
    T = F − I
    se T < D: retornar []

    L = F − D

    se T <= 120:                                  // intervalo curto
        retornar ordenar_e_deduplicar([I, L])

    G = [I]                                       // início real, sempre
    regulares = []
    H = primeira hora cheia >= I + 30min
    enquanto H + D <= F:
        regulares.anexar(H)
        H = H + 60min

    G = G + regulares

    se L não esta em G:
        se regulares nao vazio:
            G[ultimo] = L                         // substitui o ultimo regular
        senao:
            G.anexar(L)                           // preserva o inicio real

    retornar ordenar_e_deduplicar(G)
```

### Exemplos canônicos — intervalo 08:00–12:00

| D | Resultado |
|---|---|
| 20 | 08:00, 09:00, 10:00, 11:40 |
| 30 | 08:00, 09:00, 10:00, 11:30 |
| 40 | 08:00, 09:00, 10:00, 11:20 |
| 60 | 08:00, 09:00, 10:00, 11:00 |
| 90 | 08:00, 09:00, 10:30 |
| 120 | 08:00, 09:00, 10:00 |

### Exemplo degenerado

Intervalo 08:00–11:00, D = 150 → **08:00, 08:30**. Não existe horário regular que caiba
(09:00 + 150 ultrapassa 11:00), então `L = 08:30` é acrescentado sem remover o início
real. **Nunca substituir 08:00 por 08:30.**

## 7. Minutos quebrados

Os minutos quebrados do início real **não se propagam** pela grade: a grade retorna à
hora cheia e segue de hora em hora.

| Início real | Grade após o início |
|---|---|
| 08:10 | 09:00, 10:00, … |
| 08:20 | 09:00, 10:00, … |
| 08:30 | 09:00, 10:00, … |
| 08:40 | 10:00, 11:00, … |

Em 08:40, a hora cheia 09:00 está a apenas 20 minutos e não é apresentada; a grade
retorna em 10:00.

Exemplo completo — intervalo 15:10–18:00, D = 40 → **15:10, 16:00, 17:20**.

## 8. Períodos

Classificação **pelo horário de início**, no fuso da clínica:

- **manhã**: início ≤ 12:00;
- **tarde**: início > 12:00 e < 18:00;
- **noite**: início ≥ 18:00.

Na operação padrão a Iris pergunta somente **manhã** ou **tarde**. Noite é compreendida
e respeitada quando o paciente pedir explicitamente.

Quando o paciente escolher manhã ou tarde, apresentar **todos** os horários gerados e
disponíveis daquele período para o dentista selecionado: sem limite de quatro opções,
sem paginação, sem truncamento e sem ordenação pela IA.

## 9. Horário exato solicitado

A validação de horário exato é **independente da grade de apresentação**.

Pedido `H`: verificar diretamente se `[H, H + duração)` está livre dentro de um
intervalo livre. Não exigir que `H` pertença à grade. Estando livre, oferecer `H`.

Estando ocupado:

- procurar o início válido **anterior** mais próximo;
- procurar o início válido **posterior** mais próximo;
- oferecer ambos quando existirem; somente um quando existir apenas um.

A busca técnica interna usa granularidade de **10 minutos**, incluindo adicionalmente o
início real de cada intervalo e o último início possível de cada intervalo. As
alternativas não ficam restritas à grade hora a hora — podem diferir por 10, 20, 30, 40,
50 ou 60 minutos.

## 10. Ordem das ofertas

1. horário exato solicitado;
2. horário válido mais próximo anterior;
3. horário válido mais próximo posterior;
4. demais horários do período solicitado;
5. primeiro horário disponível no mesmo dia, mesmo em outro período;
6. primeira data futura com disponibilidade.

Quando o período solicitado estiver ocupado, informar isso e apresentar a opção real
mais próxima.

**A Iris não responde apenas que não existe disponibilidade quando houver opção futura
real.**

Nunca trocar silenciosamente procedimento, dentista específico ou clínica.

## 11. Busca futura

Não existe horizonte semântico fixo de 30 ou 60 dias.

A busca começa pela data solicitada, avança em ordem cronológica, continua até encontrar
a primeira data com disponibilidade e oferece os horários dessa data. Após rejeição,
continua a partir do dia seguinte.

Semanas sem disponibilidade não constituem resultado final de indisponibilidade.

A implementação futura pode consultar em blocos técnicos finitos, desde que: o tamanho
do bloco nunca vire regra de produto; o fim de um bloco nunca signifique
indisponibilidade; a busca preserve continuação.

Somente falha técnica, configuração inválida ou ausência estrutural de agenda interrompe
a continuidade. O tratamento conversacional fica para `atendimento-v1.md`.

## 12. Dentistas

**Dentista específico**: não trocar silenciosamente; continuar a busca temporal para o
mesmo profissional; considerar outro somente após autorização explícita do paciente
(evento `aceitar_qualquer_profissional`).

**Qualquer profissional**: calcular cada agenda separadamente; usar a mesma duração
oficial; escolher primeiro o dentista com o horário mais próximo; desempatar por
`dentista_id` em ordem estável; apresentar somente os horários desse dentista; após
rejeição, avançar para o próximo dentista apto.

**Nunca misturar horários de dentistas diferentes na mesma lista.**

## 13. "Antes das 11h"

Interpretação **inclusiva pelo horário de início**: incluir 11:00 e os horários
anteriores. Não exigir término até 11:00.

A exigência de término só se aplica quando o paciente declarar explicitamente que
precisa terminar ou sair até aquele horário — intenção distinta, interpretada
separadamente.

## 14. Google Calendar

- A agenda Cappia **funciona sempre**.
- Funciona **sem** Google.
- Funciona **com** Google corretamente configurado.
- Continua funcionando quando **não existe** integração Google.
- Disponibilidade, agendamento, remarcação e cancelamento **não podem ser bloqueados**
  por ausência ou problema no Google.

No painel: o usuário informa o `calendar_id`; o painel testa a configuração antes de
salvar; configuração inválida **não é salva**. Quando válida, o Google pode fornecer
eventos externos autorizados como bloqueios adicionais.

Google Calendar é **integração adicional**, nunca a fonte obrigatória da agenda.

Não existe falha fechada da Iris por ausência ou erro do Google, e não existe fallback
conversacional relacionado ao Google.

A adaptação e a auditoria do mecanismo atual do painel ficam para etapa futura.

## 15. Passado e status

**Nunca oferecer horários passados.** A disponibilidade considera somente instantes
posteriores ao instante oficial atual.

Agendamentos concluídos ou com falta são **históricos** e não exigem regra especial de
liberação. Para o futuro, considerar somente estados que representem **ocupação ativa**.

A taxonomia exata desses estados **não é definida aqui** — é contrato pendente da
persistência (seção 18).

## 16. Estado e identidade da opção

Cada opção oficial preserva, no mínimo:

- `clinica_id`;
- `procedimento_id`;
- `dentista_id`;
- vínculo oficial do dentista com o procedimento;
- duração;
- início;
- fim;
- data local;
- fuso da clínica;
- contexto ou revisão suficiente para detectar obsolescência.

**A IA não cria nem altera opções.**

## 17. Revalidação e criação

Antes da criação futura, revalidar: procedimento ativo; dentista ativo; vínculo ativo;
duração vigente; jornada; bloqueios; ocupações; intervalo escolhido.

A criação futura deve ser **atômica**, **idempotente**, **protegida contra
sobreposição** e **isolada por `clinica_id`**.

Nada disso é implementado nesta rodada.

## 18. Pendências técnicas

Registradas como pendências futuras — **não reabrem decisões de produto aprovadas**:

- representação das jornadas recorrentes e exceções;
- status ativos que ocupam agenda;
- internalização dos eventos Google;
- mecanismo físico anti-sobreposição;
- fronteira transacional entre revalidação e criação;
- referência técnica de revisão ou obsolescência;
- tratamento de horários ambíguos em fusos com mudança de horário;
- resposta conversacional para falhas estruturais (`atendimento-v1.md`).

## 19. Auditoria do legado — pendente

Permanece pendente a auditoria read-only de:

- `cappia_disponibilidade_canonica`;
- `cappia__gerar_horarios_canonico`;
- `cappia__comparar_horario_solicitado`.

Não executada nesta rodada. **Nenhuma dessas funções é presumida correta ou
reutilizável**, e nenhuma fórmula legada substitui as regras deste documento.

## 20. Testes obrigatórios

- intervalo menor que a duração → nenhuma opção;
- intervalo igual à duração → somente o início;
- intervalo curto (≤ 120) → início e último início possível;
- intervalo amplo (> 120) → grade hora a hora com ajuste do fim;
- minutos quebrados: início 08:10, 08:20, 08:30 e 08:40;
- durações de 10, 20, 40, 60, 90, 120, 150 e 240 minutos;
- duração mínima canônica D10 em intervalo curto → início e último início possível,
  pela regra da seção 5;
- duração mínima canônica D10 em intervalo amplo → grade hora a hora com ajuste do fim,
  pela regra da seção 6;
- os seis exemplos canônicos de 08:00–12:00 (seção 6);
- 15:10–18:00 com D40 → 15:10, 16:00, 17:20;
- caso degenerado 08:00–11:00 com D150 → 08:00, 08:30, preservando o início real;
- adjacência no fim: atendimento que termina exatamente quando começa uma ocupação é
  válido — `[início, fim)` semiaberto, adjacência não é sobreposição;
- adjacência no começo: atendimento que começa exatamente quando termina uma ocupação
  ou bloqueio é válido — mesma regra de intervalo semiaberto;
- horário exato livre é oferecido mesmo fora da grade;
- horário exato ocupado;
- anterior e posterior mais próximos;
- somente anterior;
- somente posterior;
- fronteira de período: início às 12:00 pertence à manhã;
- fronteira de período: início às 12:10 pertence à tarde;
- fronteira de período: início às 18:00 pertence à noite;
- "antes das 11h": opção iniciando às 11:00 é incluída, e as anteriores também; não é
  exigido que o atendimento termine até 11:00;
- "preciso terminar até 11h" (intenção distinta): somente opções cujo atendimento
  termine até 11:00 são válidas;
- período sem opções, mas mesmo dia com disponibilidade;
- dia sem opções, mas data futura disponível;
- várias semanas sem disponibilidade antes da primeira data livre;
- dentista específico sem troca silenciosa;
- qualquer profissional, um dentista por vez;
- Google ausente — agenda funciona normalmente;
- Google válido — eventos externos entram como bloqueios;
- configuração Google inválida é rejeitada pelo painel antes de salvar;
- Google previamente válido que se torna indisponível ou passa a retornar erro — a
  agenda interna Cappia continua funcionando; disponibilidade, agendamento, remarcação
  e cancelamento não são bloqueados; nenhuma disponibilidade é inventada a partir do
  Google; nenhum fallback conversacional é criado;
- duas confirmações concorrentes;
- repetição da mesma confirmação;
- nenhuma opção passada é oferecida;
- isolamento entre clínicas.

## 21. Invariantes

- Nenhuma disponibilidade é consultada sem procedimento oficial, dentista apto, vínculo
  ativo e duração válida.
- Intervalos são semiabertos; adjacência é permitida e não é sobreposição.
- O início real do intervalo livre nunca é removido de uma oferta.
- O passo da grade ampla é hora a hora, independentemente da duração.
- Opções apresentadas são alternativas mutuamente excludentes e podem se sobrepor.
- Minutos quebrados nunca se propagam pela grade.
- O limite de 120 minutos refere-se à extensão do intervalo livre, nunca à duração.
- Horário exato é validado fora da grade de apresentação.
- Não existe horizonte fixo de busca futura, nem limite de opções por período, nem
  paginação, nem truncamento.
- Nenhum horário passado é oferecido.
- A agenda Cappia nunca é bloqueada por ausência ou erro do Google.
- Nenhuma troca silenciosa de procedimento, dentista ou clínica.
- A IA não decide, não ordena e não cria opções.
- Toda opção é isolada por `clinica_id`.
- Esta especificação não cria código, tabela, coluna, RPC, migration, alteração de
  painel ou de workflow.
