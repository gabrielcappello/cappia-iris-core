# Memória conversacional mínima — V1

**Status:** aprovada conceitualmente pelo Gabriel em 2026-08-06 (seis decisões
incorporadas abaixo). Enviada para revisão independente do Segundo Code — **somente
leitura**. Não implementada. Não autoriza código, migration, alteração de banco, painel
ou n8n. Não trata cancelamento.

## Problema

A IA redatora (`specs/resposta-conversacional-v1.md`, implementada e parada antes do
commit) recebe **apenas a mensagem atual**. Ela escreve bem uma frase isolada, mas não
tem continuidade: não sabe o que ela mesma acabou de perguntar, nem a que o paciente
está reagindo. Uma piada, um "esse aí mesmo", um "como você falou" chegam sem o turno
anterior — e a resposta sai simpática porém desconectada.

Esta V1 dá à redatora **um único turno anterior**, e corrige o tom do contrato dela.

## 1. O que é guardado

Nova coluna server-only em `estado_conversa`:

```ts
interface UltimaTroca {
  mensagem_paciente: string;
  resposta_iris: string;
  gerada_em: string;   // ISO
}
```

Exatamente estes três campos — nada além. `estado_conversa.ultima_troca jsonb`
(nullable, sem default), mesmo regime de `contexto_horarios`: server-only, RLS herdada,
nunca exposta ao paciente.

**Sempre substitui o par anterior. Nunca acumula.** Não existe array, não existe
histórico, não existe crescimento — a coluna tem no máximo um par, sempre o mais
recente.

`gerada_em` significa **quando a resposta foi gerada para envio**, nada além disso. O
Core não sabe se o WhatsApp entregou nem se o paciente leu — o nome do campo é
deliberado, e ele nunca deve ser lido como se soubesse.

## 2. Momento da gravação

Grava **depois que a resposta final estiver decidida** — ou seja, depois de
`gerarRespostaConversacional` retornar, com **exatamente o texto que irá ao paciente**:

- redação da IA **aprovada** pela guarda → grava esse texto;
- **fallback determinístico** efetivamente escolhido → grava o texto do fallback.

**Nunca grava texto reprovado pela guarda nem redação que falhou.** Não existe caminho
em que `resposta_iris` contenha algo diferente do que o paciente recebeu: o que a
redatora lê no turno seguinte é sempre o que foi realmente dito, nunca um rascunho
descartado. Um texto reprovado que virasse memória faria a Iris referenciar, no turno
seguinte, algo que nunca foi dito — pior que não ter memória alguma.

### Consequência estrutural (achado da auditoria; as três aceitas por Gabriel em 2026-08-06)

A gravação **não cabe dentro de `processarMensagem`**: quando o orquestrador termina, a
resposta ainda não existe (ela é gerada depois, pelo chamador). Isso obriga três
mudanças aditivas, todas pequenas, todas no padrão já estabelecido:

1. **`gravarContextoHorarios` passa a devolver o `atualizado_em` resultante** — hoje
   devolve `void` (`Promise<void>`) e descarta o retorno de
   `.select('id').maybeSingle()` de propósito, com um comentário explícito dizendo que
   sucesso e zero-linhas não são distinguidos. Isso muda: a função passa a devolver
   `Promise<string>`, e o valor de retorno é **exatamente um destes três**, nunca um
   quarto caso:

   | Situação | Retorno |
   |---|---|
   | ação `preservar` — nenhum `UPDATE` emitido | `atualizado_em_da_decisao` recebido, inalterado |
   | `UPDATE` com CAS bem-sucedido (o `.select().maybeSingle()` **devolveu uma linha**) | exatamente o `proximoTimestamp(...)` que a própria função gravou |
   | CAS falho (`.maybeSingle()` devolveu `null` — zero linhas afetadas) **ou** exceção do cliente | `atualizado_em_da_decisao` recebido, inalterado |

   O terceiro caso devolve deliberadamente um valor **já obsoleto** — não é um erro de
   propagação, é o mecanismo: o CAS seguinte de `ultima_troca` vai comparar contra esse
   valor velho, falhar, e abandonar em silêncio, exatamente como uma operação obsoleta
   deve se comportar. Continua **sem lançar** em qualquer um dos três casos.

   **Implicação de implementação (registrada aqui, não executada):**
   `gravarContextoHorarios` precisa **usar** o resultado de `.select('id').maybeSingle()`
   que hoje descarta — uma linha devolvida distingue CAS bem-sucedido de CAS falho. O
   comentário atual (linhas ~182-184 de `contexto-horarios.ts`), que afirma que os dois
   casos *não* são distinguidos "de proposito", fica **desatualizado por esta mudança** e
   deve ser reescrito para descrever o comportamento novo — um comentário que afirma o
   oposto do código é pior que nenhum comentário.

2. **`ResultadoOrquestrador` ganha `atualizado_em`** — o valor após todas as escritas do
   orquestrador, alimentado pelo retorno de (1). Mesmo padrão aditivo já usado em
   `ResultadoAplicarDados.atualizado_em`.
3. **`ResultadoOrquestrador` ganha `natureza_mensagem`** — a redatora precisa recebê-la
   (seção 3) e hoje ela não sai do orquestrador.

Sem (1) e (2) o CAS da seção 5 seria impossível sem reler antes de escrever — proibido
por decisão anterior. Nenhuma das três altera comportamento observável do paciente: são
três campos de saída a mais e um valor de retorno onde antes havia `void`.

## 3. Momento da leitura

A IA redatora passa a receber:

| Já recebe hoje | Novo nesta V1 |
|---|---|
| mensagem atual do paciente | `ultima_troca` (quando houver) |
| objetivo do Core | `natureza_mensagem` |
| fatos autorizados | |

**A IA interpretadora não muda.** Ela continua recebendo o que já recebia — nenhuma
janela de conversa, nenhum turno anterior. A memória conversacional é exclusivamente da
camada de redação; a interpretação segue sendo um classificador de mão única.

### Omissão por idade — 24h, constante explícita

`ultima_troca` só é enviada à redatora quando `gerada_em` estiver dentro da janela de
validade. Um paciente que volta três dias depois não deve receber uma resposta que
referencia "como eu te disse" sobre uma conversa esquecida.

**Aprovado pelo Gabriel em 2026-08-06: 24 horas para a V1.**

```ts
/** Janela de validade da memoria conversacional. Aprovada por Gabriel em 2026-08-06. */
export const VALIDADE_ULTIMA_TROCA_MS = 24 * 60 * 60 * 1000;
```

Regras que acompanham a decisão:

- **constante nomeada e exportada** — o número nunca aparece solto no meio de uma
  comparação, nunca é literal inline, nunca fica "escondido no código";
- **a expiração é só de LEITURA.** Fora da janela, a chave é omitida do payload da
  redatora (nunca `null`, nunca objeto vazio). **A coluna não é apagada por expiração** —
  o dado continua lá e volta a ser irrelevante sozinho no próximo turno, quando for
  substituído. Nenhuma rotina de limpeza, nenhum job, nenhum `UPDATE` disparado por
  tempo;
- a comparação usa `gerada_em` contra o instante da requisição atual.

## 4. Tom da redatora

O contrato atual (`redator-instrucoes.ts`) descreve a Iris por **oito proibições**,
incluindo uma que a empurra a ser cautelosa em comentário social inofensivo. Isso é
substituído por um objetivo positivo:

> **A Iris conversa de forma natural, humana, calorosa e espontânea. Pode usar humor,
> leveza, empatia e responder comentários laterais. Depois, retoma suavemente o objetivo
> definido pelo Core.**
>
> Os fatos operacionais — procedimento, dentista, data, horário, preço, disponibilidade,
> confirmação, reserva e informações da clínica — vêm **exclusivamente** do Core, pelos
> fatos autorizados. Fora deles, ela conversa livre.

**Exemplo do alvo** (aprovado pelo Gabriel em 2026-08-06, como referência de tom — nunca
como frase a ser reproduzida nem como repertório):

> **Paciente:** "Se eu arrancar esse dente, vou conseguir assobiar?"
> **Iris:** "Assobiar eu não garanto, mas o sorriso vai ficar nota 10 😄 Quer que eu te
> ajude a marcar uma avaliação?"

Isso é conversa humana normal e **deve** ser permitido. O contrato atual empurraria a
Iris para uma resposta cautelosa e sem graça nesse caso — é exatamente esse
comportamento que esta seção corrige.

Some do contrato: a proibição de "diagnóstico/opinião clínica/orientação de saúde", a
instrução de "acolher sem opinar", e as demais proibições que descrevem coisas que a
Iris não teria como fazer de qualquer jeito.

**Não é afrouxamento de segurança.** O que impede horário inventado e reserva falsa é a
**guarda programática** (`resposta-conversacional-v1.md` seção 4), que roda sobre o
texto pronto e não depende de nenhuma frase do prompt. A instrução volta a ser sobre
como conversar; a garantia continua sendo código.

## 5. Ciclo de vida e concorrência

**CAS**, mesmo mecanismo já implementado para `contexto_horarios`:

- `UPDATE` único, com `.eq('atualizado_em', <valor devolvido por processarMensagem>)`;
- **nenhum `SELECT` antes**; nenhuma releitura, nenhum retry, nenhum rebase;
- CAS falho → **abandona imediatamente, em silêncio**;
- falha técnica do cliente → idem.

**A gravação nunca altera a resposta já decidida.** Ela acontece depois que o texto foi
definido; falhar significa apenas que o turno seguinte não terá contexto — degrada a
conversa, nunca produz erro ao paciente e nunca produz agendamento errado.

**Operação antiga não sobrescreve troca mais recente:** se duas mensagens forem
processadas em paralelo e a mais antiga terminar por último, seu `atualizado_em` já não
casa — o CAS falha e ela abandona, preservando a troca mais nova.

**Limpeza.** `ultima_troca` **não tem tabela de limpar/preservar por tipo de decisão**,
ao contrário de `contexto_horarios`. A razão é uma diferença de natureza, não uma
simplificação: um snapshot de horários obsoleto é **perigoso** (uma lista velha faz
"dia 15" virar 15:00 — leitura operacional errada); uma troca anterior nunca é
operacional, e por construção é sempre exatamente o turno imediatamente anterior. Logo:

- **conversa nova:** a linha nasce com a coluna `NULL` — nada a fazer;
- **ciclo concluído (`reserva_criada`):** **não limpa** — decisão explícita do Gabriel
  (2026-08-06). Se o paciente responder "obrigado!" logo depois, a redatora precisa
  saber a que ele está agradecendo;
- **envelhecimento:** tratado na leitura (seção 3), nunca por apagamento — o dado fica
  na coluna, apenas deixa de ser enviado.

Ou seja: o único momento em que `ultima_troca` muda é quando um novo par a substitui.
Nenhuma decisão, nenhum estado e nenhum relógio a apaga.

## 6. Testes obrigatórios

**Determinísticos (sem IA):**
- redação **reprovada** pela guarda **não** é gravada;
- **fallback** efetivamente escolhido **é** gravado, com o texto do fallback;
- `resposta_iris` gravada é **byte a byte** a resposta devolvida ao chamador, nos dois
  caminhos (aprovada e fallback);
- gravação emite **exatamente um `UPDATE`** e **nenhum `SELECT`** antes;
- CAS falho abandona imediatamente, sem retry, sem lançar;
- operação obsoleta **não** sobrescreve uma troca mais recente;
- `ultima_troca` com `gerada_em` dentro de `VALIDADE_ULTIMA_TROCA_MS` é enviada; fora
  dela é **omitida** do payload (nunca `null`, nunca objeto vazio);
- expiração **não** apaga a coluna — depois de expirada, o valor continua na linha;
- `ultima_troca` **nunca** chega à IA interpretadora;
- `reserva_criada` **não** limpa `ultima_troca`;
- falha da gravação **não** altera a resposta devolvida ao paciente;
- **encadeamento dos dois CAS, no mesmo turno:** `contexto_horarios` é gravado com
  sucesso; `gravarContextoHorarios` devolve o novo `atualizado_em` (o `proximoTimestamp`
  que ela mesma gravou, não o valor recebido); a gravação de `ultima_troca` usa esse
  valor novo no `.eq('atualizado_em', ...)` e também é bem-sucedida — prova de que os
  dois `UPDATE` ficam corretamente encadeados, cada um pelo timestamp real que o
  anterior produziu, sem releitura entre eles;
- **CAS de `contexto_horarios` falho no mesmo turno:** a função devolve o valor
  recebido (obsoleto); o CAS seguinte de `ultima_troca` falha e abandona — prova de que
  o terceiro caso da tabela acima propaga corretamente a obsolescência.

**Contra a IA real (script avulso, mesmo padrão dos anteriores):**
- **piada** → responde com humor **e** retoma o objetivo do Core;
- **medo de dentista** → acolhe **e** retoma;
- **clima/assunto lateral** → responde naturalmente **e** retoma;
- **referência à última fala da Iris** ("aquele que você falou", "como você disse") →
  a resposta demonstra continuidade com o turno anterior;
- **negativo:** com `ultima_troca` presente, a redatora continua sem citar horário fora
  dos fatos autorizados (a guarda continua valendo — contexto novo não é autorização
  nova).

**Cuidado declarado nos testes de referência:** "aquele que você falou" pode significar
escolher um horário. **Escolher horário continua sendo da interpretadora**, via
`horarios_oferecidos`/`proposta_pendente` — nunca da redatora. O teste de referência
deve verificar **continuidade conversacional**, jamais seleção operacional.

## 7. Fora desta V1

- cancelamento e remarcação — etapa própria, por decisão do Gabriel;
- histórico com mais de um turno, buffer de N mensagens, resumo de conversa;
- `clima_da_conversa` ou qualquer nova classificação de tom — a redatora já lê o texto
  cru e percebe tom sozinha; mais uma categoria fechada só repetiria a rigidez que esta
  spec está corrigindo;
- qualquer mudança em interpretação, disponibilidade, reserva, RPC ou painel;
- registro de entrega/leitura da mensagem no WhatsApp.

## 8. Migrations

Duas, irmãs, mesma convenção de pastas por projeto-alvo já estabelecida:

- `src/supabase/migrations/` → `bcmuqautblvjdqzhjfbw` (dev/teste);
- `src/supabase/migrations-legado/` → `udizowyfjnhuhgxkeayk` (operacional real);

ambas com rollback próprio. Estritamente aditivas: `alter table estado_conversa add
column ultima_troca jsonb;` — nenhuma constraint, nenhuma alteração de RLS, nenhum dado
existente tocado.
