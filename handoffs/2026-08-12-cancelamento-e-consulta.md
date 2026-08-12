# Handoff — 2026-08-12 (fechamento: cancelamento + consulta do próprio agendamento)

## 1. Estado atual — sessão fechada

- **Commit:** `4843bc1f28d3e2b69fc720143954c252ac3d4d81` — "feat: consulta do
  proprio agendamento v1 -- paciente pergunta pelo agendamento".
- **`main` = `origin/main`:** confirmado (SHA idênticos, push refletido).
- **Edge Function** `iris-nova-mensagem` (operacional `udizowyfjnhuhgxkeayk`):
  **versão 20, ACTIVE**, `verify_jwt: true`.
- **Paridade Core/Edge:** 45/45, diff 0.
- **Suíte:** 1171/1171 (5 skips pré-existentes). Typecheck limpo.

Nesta sessão, **quatro frentes fecharam em sequência**: novo agendamento (já
fechada em sessão anterior), remarcação (idem), **cancelamento** e **consulta
do próprio agendamento** — as duas últimas implementadas, testadas, provadas
contra a IA real e deployadas nesta sessão.

Não commitados, **pré-existentes a esta sessão** e sem relação com ela:
`handoffs/2026-08-10-cadastro-conversacional.md`,
`handoffs/2026-08-10-fechamento-novo-agendamento.md`,
`supabase/supabase/` e `supabase/functions/iris-nova-mensagem/supabase/`
(artefatos do CLI Supabase — nunca investigados nem removidos nesta sessão).

## 2. CANCELAMENTO — concluído e publicado

Spec: `specs/cancelamento-conversacional-v1.md`. Commit `a4d9579`, Edge v19
(depois superada pela v20 da consulta, sem alteração funcional no cancelamento
entre as duas).

**Fluxo.** `intencao=cancelamento` → localizar via `buscarAgendamentoAtivo` →
0 = `sem_agendamento_para_cancelar`; 1 = segue; N = escolha reusando
`escolha_agendamento_pendente`/`agendamento_id` → mostrar qual será cancelado →
`aguardando_confirmacao_cancelamento` → confirmação válida →
`cappia_cancelar_agendamento_v2` → `cancelamento_criado`.

**Decisões canônicas adotadas:**

- **`intencao='cancelamento'` entrou SEM nenhuma regra de prompt** — medido:
  as duas variantes com instrução explícita pioraram o resultado (uma em
  acerto, a outra introduziu o único falso positivo perigoso de toda a
  medição, de forma não reprodutível). O contexto existente distingue
  desistência de cancelamento melhor que prosa acrescentada.
- **A pergunta É a confirmação — não existe confirmação dupla.** Reusa
  `proposta_pendente`; o Core exige **três condições juntas**: `intencao`,
  `confirmacao='sim'` (semântica, sem repertório) e a proposta do início do
  turno correspondendo ao agendamento. A terceira fecha o buraco de um "sim"
  remanescente autorizar sozinho.
- **`confirmacao_nao_compreendida`** — quando a concordância não fica clara
  ("pode cancelar" → a IA reemite `intencao`, medido 0/4 em todos os formatos
  de pergunta testados), a redatora pede esclarecimento natural em vez de
  repetir. Derivado no turno, nunca persistido. Sem contador, sem parser.
- **Roteamento do cancelamento vem ANTES da checagem de catálogo** (ajuste do
  Codex): cancelar não depende de catálogo, procedimento, dentista,
  disponibilidade nem temporal.
- **RPC `cappia_cancelar_agendamento_v2`** corrige os dois defeitos da legada:
  falta de `p_paciente_id` (cancelava agendamento alheio) e ausência de
  checagem de status. **Zero DDL** — o CHECK já admitia `'cancelado'`.

**Bancos:** migration aplicada e provada nos dois (dev `bcmuqautblvjdqzhjfbw`,
operacional `udizowyfjnhuhgxkeayk`). No operacional as provas rodaram em
transação abortada com dados sintéticos; zero resíduo e dados reais idênticos
ao snapshot, verificados campo a campo. A RPC legada segue intacta.

**Provas contra a IA real:** intenção 7/7 (0 perigosos); esclarecimento — todos
os critérios, 3/3 execuções; caminho completo E2E — todos os passos.

**Divergência registrada:** a constraint de status chama-se
`agendamentos_status_valido` no dev e `agendamentos_status_check` no
operacional. Só afeta comentário de migration, corrigido nos dois arquivos.

## 3. CONSULTA DO PRÓPRIO AGENDAMENTO — concluída e publicada

Spec: `specs/consulta-agendamento-conversacional-v1.md` (desenho final §8,
status atualizado para implementado). Commit `4843bc1`, Edge v20.

**Desenho implementado:** o agendamento futuro vira **fato do turno** — mesmo
canal de `substituicao_por_avaliacao` —, buscado só em decisão conversacional
(`saudacao`, `duvida_livre`, `mensagem_nao_compreendida`) e com `paciente_id`.
`desistencia` fica de fora deliberadamente, embora saia da mesma
`decidirPorNatureza` — o paciente está encerrando, e mencionar reabriria
assunto. 0 → ausente; 1 ou N → disponível para a redatora, sem pergunta de
escolha. Seis arquivos, todos aditivos. Zero intenção, campo raiz, evento,
parser, estado, RPC, tabela, migration ou regra de prompt.

**Limitação aceita:** em dúvidas sobre a clínica ("qual o endereço?", "quanto
custa limpeza?"), a redatora pode mencionar o agendamento sem necessidade —
medido ~100%. Ruído conversacional, nunca dado errado. Aceita para a V1.

### O que foi medido e reprovado antes deste desenho (não retomar por suposição)

| rota | resultado |
|---|---|
| `intencao=consulta_agendamento`, sem regra | 0/20 |
| idem + 1 linha semântica | 1/20 |
| `intencao=meus_agendamentos`, sem regra | 3/20 |
| campo raiz booleano (com e sem instrução) | **inconclusivo — instrumento inválido** |
| regra de relevância no prompt da redatora | **piorou**: 23/42 → 15/42 |

**Causa raiz da 1ª família:** as três intenções que funcionam pedem uma **ação
sobre o mundo**; consulta é leitura. E "consulta" no vocabulário da clínica
significa *procedimento*, não *consultar*.

**Achado estrutural (importante para o futuro):** `cliente-modelo-openai.ts`
**ignora o schema do chamador** (envia sempre `SCHEMA_PORTATIL_APROVADO`) e a
conversão **rejeita chave raiz extra**. Um campo raiz novo não é mudança de
schema: é mudança no cliente de produção. Foi o que invalidou aquela medição.

**O que funciona sem nenhuma regra:** pergunta sobre o agendamento 12/12 (imune
à instrução); saudação pura 11/15 com o prompt intacto.

### Revisão independente (Codex) — dois ajustes incorporados antes do fechamento

- **`procedimento_id` nunca é fallback de texto** em `fatos-autorizados.ts` —
  o caminho termina na redatora (texto ao paciente); nenhum identificador
  interno pode atravessar essa fronteira.
- **Falha de banco propaga normalmente** — removido o `try/catch` que
  transformava qualquer erro de `buscarAgendamentoAtivo` em "sem agendamento".
  "Sem agendamento" é um fato; um erro de leitura não é esse fato.
- **Paridade `diaDaSemanaCivil`** — coberta por `src/core/paridade-dia-semana.test.ts`,
  sem exportar nenhum helper privado: observa as duas implementações
  (`orquestrador.ts` e `fatos-autorizados.ts`) pelas saídas públicas já
  existentes, em 8 datas (comuns, virada de ano, bissexto comum e secular).
  As duas concordam nas 8.

### Provas contra a IA real (interpretadora + redatora reais)

3/3 critérios duros: saudação com agendamento → fato presente e mencionado;
pergunta sobre o agendamento → respondida com os dados oficiais; saudação sem
agendamento → nenhuma menção inventada. A guarda aprovou os três textos —
antes da correção da seção 4 abaixo, os dois primeiros cairiam no fallback.

## 4. Defeito da guarda — corrigido nesta sessão

`coletarMinutosAutorizados` (`guarda-resposta-redatora.ts`) não lia
`agendamentos_candidatos`. Confirmado executando a guarda real antes da
correção: uma resposta honesta que listasse os horários de dois agendamentos
era reprovada (`horario_nao_autorizado`) — **já afetava a remarcação em
produção** (Edge 19): com múltiplos agendamentos, a resposta natural da
redatora caía sempre no texto fixo, desligando-a em silêncio.

**Corrigido:** `coletarMinutosAutorizados` agora inclui os horários de
`agendamentos_candidatos` e `agendamentos_do_paciente`. Medido que **não
afrouxa**: libera os 20 casos em que o horário é real e mantém bloqueados os 4
em que a redatora inventou horário de funcionamento.

## 5. Resumo executivo — Iris Nova

- ✅ **Novo agendamento** — concluído (sessão anterior).
- ✅ **Remarcação** — concluída (sessão anterior).
- ✅ **Cancelamento** — concluído e publicado (esta sessão).
- ✅ **Consulta do próprio agendamento** — concluída e publicada (esta sessão).
- **Edge operacional:** `iris-nova-mensagem` v20, `ACTIVE`.
- **Commit atual:** `4843bc1` (`main` = `origin/main`).
- **Core/Edge:** em paridade (45/45, diff 0).
- **Suíte:** 1171/1171 (5 skips pré-existentes, não relacionados).
- **Próxima frente recomendada:** nenhuma aberta ou pré-selecionada. As quatro
  frentes do fluxo conversacional básico (marcar, remarcar, cancelar,
  consultar) estão fechadas. Decisão de qual vem a seguir é do Gabriel —
  candidatos naturais, nunca abertos nem iniciados: atualização cadastral
  isolada, consulta completa/histórico de agendamentos (fora do escopo desta
  spec, que cobre só agendamento **futuro**), e a dívida de nomenclatura de
  `reserva_falhou` (item 6, abaixo).

## 6. Pendências conhecidas ainda válidas

- **Cancelamento:** "cancela isso" com contexto só no histórico ≈75%; "por
  quê?" durante a confirmação sai pelo caminho genérico (`duvida_livre`,
  contexto preservado, gate armado) — deliberadamente fora de escopo.
- **Consulta:** menção ao agendamento sem necessidade em dúvidas sobre a
  clínica — aceita para a V1 (seção 3). Nome do paciente fora do escopo
  (decisão de PII própria, se entrar).
- **`reserva_falhou` cobre três fluxos** (reserva, remarcação, cancelamento)
  sem mudar de nome — dívida de nomenclatura registrada, não corrigida.
- **Remarcação §10.1** — o agendamento atual conta como ocupado na própria
  disponibilidade; menos opções no mesmo dia. Inalterada.
- **Guarda valida horário, nunca data** — se a redatora errar a data, nada
  detecta. Pré-existente, não introduzida nesta sessão.
- **`diaDaSemanaCivil` duplicado** (`orquestrador.ts` e `fatos-autorizados.ts`)
  — reimplementação deliberada, risco de divergência coberto por teste de
  paridade dedicado (seção 3). Nunca unificado.
- **Instabilidade de infra observada:** ~3 `resposta_truncada` em ~40 chamadas
  em algumas medições, em frases curtas. Não investigada; sem impacto de
  segurança (nenhuma confirmação emitida nesses casos).

## 7. Sincronização de estado

Conforme `CLAUDE.md` global, feita ao final desta sessão:

- `specs/consulta-agendamento-conversacional-v1.md` — status atualizado de
  "aprovada, não implementada" para "implementada e publicada" (commit, SHA
  Edge); seção 8.1 nova documentando os dois ajustes do Codex; seção 10
  atualizada sobre a paridade de `diaDaSemanaCivil`. Commitado em
  `cappia-iris-core` junto com este handoff, separadamente da sincronização
  de `cappia-estado` abaixo.
- `cappia-estado/ESTADO.md` §3 (linha "Iris Nova") e §5 (próximo passo) e o
  cabeçalho "Atualizado em" atualizados — conteúdo novo **prepended**, nada do
  histórico anterior reescrito ou apagado, seguindo a convenção já em uso no
  próprio arquivo.
- `cappia-estado/HANDOFF-iris-nova.md` — seção de fechamento atualizada para
  refletir as quatro frentes fechadas, commit `4843bc1`, Edge v20. Conteúdo
  histórico anterior preservado, nada reescrito.
- Painel do Obsidian regenerado via `scripts/gerar-painel.py` (`--dry-run`
  primeiro, depois real).
- Commit feito **somente em `cappia-estado`** para a sincronização de estado
  (nunca junto com commits de `cappia-iris-core`), conforme a convenção do
  repositório.

Push de qualquer repositório só com autorização explícita, por ação.
