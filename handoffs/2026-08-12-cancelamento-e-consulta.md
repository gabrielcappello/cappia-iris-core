# Handoff — 2026-08-12 (fechamento: cancelamento · abertura: consulta)

## 1. Estado atual

- **Commit:** `a4d95799b970be72015ed8f00949992a14bddfc6` — "feat: cancelamento
  conversacional v1 -- paciente cancela o proprio agendamento".
- **`main` = `origin/main`:** confirmado (SHA idênticos, push refletido).
- **Edge Function** `iris-nova-mensagem` (operacional `udizowyfjnhuhgxkeayk`):
  **versão 19, ACTIVE**, `verify_jwt: true`.
- **Paridade Core/Edge:** 45/45, diff 0.
- **Suíte:** 1153/1153 (5 skips pré-existentes). Typecheck limpo.

**Trabalho não commitado** (medições da frente de consulta, que não foi
implementada):

```
?? src/eval/medicao-intencao-consulta-agendamento.ts
?? src/eval/medicao-consulta-agendamento-ab.ts
?? src/eval/medicao-campo-raiz-duvida-agendamento.ts
?? src/eval/medicao-excesso-mencao-agendamento.ts
?? src/eval/medicao-relevancia-agendamento.ts
?? specs/consulta-agendamento-conversacional-v1.md
?? handoffs/2026-08-12-cancelamento-e-consulta.md   (este arquivo)
```

Também não commitados, **pré-existentes a esta sessão** e sem relação com ela:
`handoffs/2026-08-10-cadastro-conversacional.md`,
`handoffs/2026-08-10-fechamento-novo-agendamento.md`,
`supabase/supabase/` e `supabase/functions/iris-nova-mensagem/supabase/`
(artefatos do CLI Supabase).

## 2. CANCELAMENTO — concluído e publicado

Spec: `specs/cancelamento-conversacional-v1.md`.

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

## 3. CONSULTA DO PRÓPRIO AGENDAMENTO — aprovada, NÃO implementada

Spec: `specs/consulta-agendamento-conversacional-v1.md` (desenho final na §8).

**Desenho aprovado:** o agendamento futuro vira **fato do turno** — mesmo canal
de `substituicao_por_avaliacao` —, buscado só em decisão conversacional
(`saudacao`, `duvida_livre`, `mensagem_nao_compreendida`) e com
`paciente_id`. 0 → ausente; 1 ou N → disponível para a redatora. Seis arquivos,
todos aditivos. Zero intenção, campo raiz, evento, parser, estado, RPC, tabela,
migration ou regra de prompt.

**Limitação aceita:** em dúvidas sobre a clínica ("qual o endereço?", "quanto
custa limpeza?"), a redatora pode mencionar o agendamento sem necessidade —
medido ~100%. Ruído conversacional, nunca dado errado. Aceito para a V1.

### O que foi medido e reprovado (não retomar por suposição)

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
**ignora o schema do chamador** (linha 461 — envia sempre
`SCHEMA_PORTATIL_APROVADO`) e a conversão **rejeita chave raiz extra** (linha
708). Um campo raiz novo não é mudança de schema: é mudança no cliente de
produção. Foi o que invalidou aquela medição.

**O que funciona sem nenhuma regra:** pergunta sobre o agendamento 12/12 (imune
à instrução); saudação pura 11/15 com o prompt intacto.

## 4. Defeito confirmado, ainda NÃO corrigido

`coletarMinutosAutorizados` (`guarda-resposta-redatora.ts`) **não lê
`agendamentos_candidatos`**. Confirmado executando a guarda real: uma resposta
honesta que liste os horários de dois agendamentos é reprovada
(`horario_nao_autorizado`).

**Já afeta a remarcação em produção (Edge 19):** com múltiplos agendamentos, a
resposta da redatora é sempre reprovada e cai no texto fixo. Não corrompe dado;
desliga a redatora silenciosamente naquele caso.

A correção está na spec de consulta §6 e entra junto com a implementação dela.
Medido que **não afrouxa**: libera os 20 casos em que o horário é real e mantém
bloqueados os 4 em que a redatora inventou horário de funcionamento.

## 5. Próximo passo

Implementar `specs/consulta-agendamento-conversacional-v1.md` §8 (seis arquivos
aditivos) + a correção da guarda da §6, com os testes da §9.

**Não abrir** nenhuma outra frente antes disso.

## 6. Pendências conhecidas ainda válidas

- **Cancelamento:** "cancela isso" com contexto só no histórico ≈75%; "por
  quê?" durante a confirmação sai pelo caminho genérico (`duvida_livre`,
  contexto preservado, gate armado) — deliberadamente fora de escopo.
- **`reserva_falhou` cobre três fluxos** sem mudar de nome — dívida de
  nomenclatura registrada, não corrigida.
- **Remarcação §10.1** — o agendamento atual conta como ocupado na própria
  disponibilidade; menos opções no mesmo dia. Inalterada.
- **Guarda valida horário, nunca data** — se a redatora errar a data, nada
  detecta. Pré-existente.
- **Instabilidade de infra observada:** ~3 `resposta_truncada` em ~40 chamadas
  em algumas medições, em frases curtas. Não investigada; sem impacto de
  segurança (nenhuma confirmação emitida).

## 7. Sincronização de estado

Conforme `CLAUDE.md` global, feita nesta mesma sessão, em chamada separada:

- `cappia-estado/ESTADO.md` §3 (linha "Iris Nova") e §5 (próximo passo) e o
  cabeçalho "Atualizado em" atualizados — conteúdo novo **prepended**, nada do
  histórico anterior (DA-P4-04 etc.) reescrito ou apagado, seguindo a
  convenção já em uso no próprio arquivo.
- `cappia-estado/HANDOFF-iris-nova.md` — nova seção "Fechamento — 2026-08-12"
  apensada ao final; nota de sincronização inserida no topo do arquivo
  explicando que a via `P4`/`P4I` não foi retomada e apontando para a seção
  nova. Conteúdo anterior preservado, nada reescrito.
- Painel do Obsidian regenerado via `scripts/gerar-painel.py` (`--dry-run`
  primeiro, depois real). **Nota:** "Iris Nova" não está entre as frentes
  configuradas em `FRENTES` (`scripts/gerar-painel.py`) — não existe página
  dedicada em `01 - Frentes/`; o conteúdo aparece em `00 - Painel/Estado
  Atual.md`/`Próximo Passo.md` (derivados de `ESTADO.md`) e em `05 -
  Handoffs/Índice.md` (coleção de todos os `HANDOFF-*.md`).
- Commit feito **somente em `cappia-estado`** (nunca junto com commits de
  `cappia-iris-core`), conforme a convenção do repositório.

**Os arquivos de `cappia-iris-core` listados na seção 1 (specs, medições,
este handoff) permanecem não commitados** — não foi pedido nesta etapa.
Push de qualquer repositório só com autorização explícita, por ação.
