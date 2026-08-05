# Natureza da mensagem — extensão mínima do contrato de interpretação

**Status:** proposta para aprovação de Gabriel. Não implementada. Não autoriza código,
migration, alteração de banco, painel ou n8n. Nenhuma mudança em disponibilidade, reserva
ou persistência.

Esta especificação estende `interpretacao-ia.md` (contrato de interpretação hoje
ativo, via `alteracoes: AlteracoesDados` — `src/core/interpretacao-tipos.ts`) e
conecta-se a `atendimento-v1.md` (redação da resposta). Não substitui nem contradiz
nenhuma das duas. Não usa o vocabulário de `eventos-conversacionais-v1.md`
(`eventos_candidatos`, `pendente`, gates de `confirmar_resumo`) — aquele documento
descreve uma camada de controlador ainda não implementada; esta especificação é
aditiva **sobre o contrato realmente ativo hoje**.

Motivação (Gabriel, 2026-08-05): a Iris não pode depender de lista fechada de frases
para saudação (`src/core/detectar-saudacao.ts`, etapa anterior) nem ficar muda diante
de qualquer mensagem fora do vocabulário de agendamento. A IA já interpreta livremente
o conteúdo de agendamento (`procedimento_texto`, `data_texto`, etc.); falta ela também
reconhecer **que tipo** de mensagem o paciente enviou, para o Core decidir a ação certa
e a resposta nunca ficar em silêncio.

## 1. Tipos de mensagem que a IA pode classificar

Um único campo novo, obrigatório, de vocabulário fechado — nunca inferido pelo Core,
sempre devolvido pela IA a cada turno:

```ts
type NaturezaMensagem =
  | 'saudacao'
  | 'duvida'
  | 'pedido'
  | 'resposta'
  | 'correcao'
  | 'negacao'
  | 'nao_compreendida';
```

- **saudacao** — cumprimento puro ("oi", "boa tarde"), sem mais nenhum conteúdo.
- **duvida** — pergunta ou comentário fora do vocabulário de agendamento (ex.: "vocês
  atendem convênio X?", "estou com dor de cabeça"). Nunca é pedido médico a ser
  respondido clinicamente (ver `atendimento-v1.md` §6, "não diagnosticar ou opinar
  clinicamente").
- **pedido** — a mensagem avança o agendamento (procedimento, dentista, data, período,
  horário).
- **resposta** — reação a algo que o Core perguntou (ex.: escolha de horário,
  confirmação, dado cadastral).
- **correcao** — o paciente corrige um dado já informado.
- **negacao** — recusa ou desistência explícita, sem pedir outra coisa no lugar.
- **nao_compreendida** — a IA não conseguiu classificar a mensagem em nenhuma das
  categorias acima com segurança.

Vocabulário fechado, `json_schema` com `strict = true`, `additionalProperties: false`
— mesma disciplina já vigente para `alteracoes` (`interpretacao-ia.md`, "Cláusula
registrada"). Em dúvida real entre duas categorias, a IA classifica como
`nao_compreendida`; nunca adivinha (mesmo princípio de "em dúvida real a IA omite o
campo", já vigente para `alteracoes`).

`natureza_mensagem` classifica a mensagem; não decide nada e não é enviada como
comando ao Core interpretar como decisão pronta — mesma separação já estabelecida
para `eventos_candidatos` em `eventos-conversacionais-v1.md` §1 ("candidato, nunca
decisão aceita"), aplicada aqui ao contrato ativo.

## 2. Dados estruturados que ela pode extrair

**Sem alteração.** Continuam sendo exatamente os dez campos já aprovados de
`AlteracoesDados` (`src/core/tipos.ts`): `intencao`, `procedimento_texto`,
`dentista_texto`, `data_texto`, `periodo`, `horario_texto`, `confirmacao`, `nome`,
`cpf`, `data_nascimento`, `email`. Esta especificação não adiciona, remove nem redefine
nenhum desses campos.

`natureza_mensagem` e `alteracoes` são preenchidos **na mesma chamada, sempre
juntos** — uma mensagem como "quero uma limpeza" produz `natureza_mensagem: 'pedido'`
e `alteracoes.procedimento_texto = 'limpeza'` no mesmo retorno. Um não substitui o
outro.

```ts
export interface SaidaInterpretacao {
  natureza_mensagem: NaturezaMensagem;
  alteracoes: AlteracoesDados;
}
```

## 3. Como o Core usa essa classificação

O Core (`orquestrador.ts`) passa a receber `natureza_mensagem` junto do resultado da
interpretação e usa-a **somente para escolher a ação comunicativa**, nunca para
resolver procedimento, dentista, duração, disponibilidade ou reserva — essa cadeia
continua lendo exclusivamente os campos de `alteracoes`/`dados`, sem alteração.

- `saudacao`, sem `procedimento_texto` conhecido na conversa → cumprimenta e pergunta
  como pode ajudar (substitui `detectar-saudacao.ts`; mesma regra de não reabrir o
  fluxo já em andamento, já implementada).
- `duvida`, **e somente quando `alteracoes` desta mensagem estiver vazio** → situação
  "Conversa básica" já aprovada em `atendimento-v1.md` §5: responde com empatia e
  retoma o ponto do fluxo onde parou. Nunca avança etapa, nunca coleta dado, nunca
  opina clinicamente. Quando `alteracoes` desta mensagem não estiver vazio, a
  classificação `duvida` não altera o comportamento — a mensagem segue o mesmo
  caminho de `pedido`/`resposta`/`correcao` abaixo, e a alteração é processada
  normalmente.
- `pedido`, `resposta`, `correcao` → não mudam o comportamento determinístico já
  existente; a cadeia de resolução (procedimento → dentista → duração → temporal →
  disponibilidade → confirmação) continua decidindo exatamente como hoje, a partir de
  `alteracoes`. `correcao` informa à redação que o texto deve reconhecer a correção
  (situação "Pedido de correção", já aprovada).
- `negacao`, **e somente quando `alteracoes` desta mensagem estiver vazio** →
  situação "Desistência" já aprovada em `atendimento-v1.md` §5: encerra a ação com
  cordialidade, sem interpretar como cancelamento de agendamento existente. Quando
  `alteracoes` desta mensagem não estiver vazio (ex.: "não, prefiro terça" produz
  `alteracoes.data_texto = 'terça'`), a classificação `negacao` não aciona
  desistência — a alteração continua sendo processada normalmente, pelo mesmo
  caminho de `pedido`/`resposta`/`correcao`.
- `nao_compreendida` → nova situação (seção 4): nunca avança etapa, sempre pede
  reformulação.

Sempre que `alteracoes` não estiver vazio, `alteracoes` tem precedência sobre
`natureza_mensagem` para a evolução do fluxo. `natureza_mensagem` influencia apenas a
forma da resposta ao paciente.

Uma mensagem pode combinar classificação e conteúdo de agendamento simultaneamente
(ex.: `pedido` com `procedimento_texto` preenchido) — o Core trata isso normalmente,
sem ramificação especial.

## 4. Quando a Iris responde naturalmente

Aplica-se a regra já aprovada em `atendimento-v1.md` §7: **não existe biblioteca de
frases fixas.** A resposta é redigida a partir dos fatos que o Core autorizou para
aquele turno; a forma pode variar, o significado operacional nunca.

Duas linhas novas na tabela de "Situações obrigatórias" (`atendimento-v1.md` §5),
mesmo formato da tabela existente:

| Situação | Comportamento autorizado |
|---|---|
| **Dúvida livre** | Reconhecer o que foi dito com empatia, sem opinar clinicamente nem inventar informação não autorizada, e retomar o ponto do fluxo onde a conversa parou. Mesmo comportamento de "Conversa básica", já aprovado. |
| **Mensagem não compreendida** | Informar, de forma breve e gentil, que não foi possível entender, e pedir que o paciente reformule. Nunca listar opções nem repertório de exemplos fixos. Nunca é silêncio. |

Nenhuma outra situação da tabela existente muda.

## 5. Quando faz uma pergunta objetiva

Sem alteração à regra já aprovada (`atendimento-v1.md` §4): **uma pergunta principal
por vez.** `saudacao` pergunta "como posso ajudar"; `nao_compreendida` pergunta a
reformulação; `duvida` normalmente não pergunta nada (só acolhe e retoma) a menos que
o ponto do fluxo onde a conversa estava exija uma pergunta — nesse caso, repete
exatamente a mesma pergunta pendente, nunca uma nova.

## 6. Como evitar silêncio

**Toda combinação de `natureza_mensagem` e decisão resultante do Core produz texto —
nunca `resposta: null`.** Isso fecha, para as sete categorias desta especificação, a
mesma garantia que `gerar-resposta-paciente.ts`/`index.ts` já implementam hoje para
`aguardando_procedimento`. Uma decisão nova sem redação correspondente é erro de
implementação, nunca comportamento aceito (mesma disciplina de tipos que já existe:
`DecisaoCaminhoFeliz` é um `Extract` fechado — decisão sem `case` correspondente não
compila).

## 7. Como manter confirmação e operações críticas determinísticas

**Nenhuma mudança de regra — reafirmação explícita, porque é o ponto mais sensível
desta extensão.**

- `natureza_mensagem` **nunca** autoriza reserva, confirmação ou qualquer efeito
  externo, mesmo quando seu valor for `resposta` e o texto parecer afirmativo.
- A única autoridade para avançar `aguardando_confirmacao → reserva` continua sendo o
  campo `confirmacao === 'sim'`, já validado em `orquestrador.ts`
  (`decidirConfirmacaoOuReserva`) — inalterado por esta especificação.
- `natureza_mensagem: 'resposta'` é, no máximo, um sinal de **que tipo de mensagem
  esta é** — equivalente em espírito ao princípio já fechado em
  `eventos-conversacionais-v1.md` §1 ("evento candidato nunca é decisão aceita"),
  aplicado aqui à classificação, não a um evento.
- A cadeia de resolução determinística (procedimento, dentista, duração, temporal,
  disponibilidade, reserva) permanece inteiramente fora do alcance de
  `natureza_mensagem` — nenhum `case` de `natureza_mensagem` pula, acelera ou
  substitui qualquer uma dessas etapas.
- `negacao` nunca cancela um agendamento já existente — apenas encerra a ação
  corrente (mesma ressalva já registrada para `desistir` em
  `eventos-conversacionais-v1.md` §2, reaplicada aqui em espírito, sem importar
  aquele mecanismo).

## 8. Fora de escopo

- Disponibilidade, reserva, banco, painel, n8n — nenhum destes é tocado.
- `eventos_candidatos`, `pendente`, claim/lease, versionamento (`P4`/`P4I`) — pertencem
  a `interpretacao-ia.md`/`eventos-conversacionais-v1.md` e não são alterados,
  antecipados nem substituídos por esta especificação.
- Geração de resposta por modelo de linguagem (redação natural via IA, em vez de texto
  fixo) — `atendimento-v1.md` já aprova o **comportamento**; o **mecanismo** de
  redação (fixo, gerado, ou híbrido) é decisão de implementação separada, fora desta
  spec.
- Expansão do vocabulário fechado de `natureza_mensagem` além das sete categorias
  acima, ou de qualquer subcategoria nova — outra rodada, se necessário.
- Remoção de `src/core/detectar-saudacao.ts` — consequência natural da implementação
  desta spec, mas a remoção em si é passo de implementação, não desta especificação.

## 9. Testes obrigatórios (mínimo)

- as sete categorias de `natureza_mensagem` são reconhecidas isoladamente;
- mensagem com conteúdo de agendamento e saudação simultâneos (ex.: "oi, quero
  limpeza") nunca classifica como `saudacao` pura — mesma regra já testada em
  `detectar-saudacao.test.ts`, agora como responsabilidade da IA;
- `saudacao` com `procedimento_texto` já conhecido na conversa não reabre o fluxo;
- nenhuma decisão nova (`duvida_livre`, `mensagem_nao_compreendida`, `negacao`) produz
  `resposta: null`;
- `natureza_mensagem: 'resposta'` sozinha, sem `confirmacao === 'sim'`, nunca aciona
  reserva nem confirmação;
- `nao_compreendida` nunca lista opções nem repete texto fixo idêntico em todas as
  ocorrências (a forma pode variar; não é obrigatório testar variação de texto, só a
  ausência de decisão silenciosa).
