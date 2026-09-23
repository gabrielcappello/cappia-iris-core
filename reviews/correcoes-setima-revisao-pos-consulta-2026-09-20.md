# Correções da sétima revisão do Codex — pós-consulta (2026-09-20)

Escopo: três caminhos que ainda prendiam o telefone antes da ativação. Gabriel aprovou 3 tentativas, entrega "ao
menos uma vez", limite de 48 h para recuperação e aplicação por `supabase db push`. Tudo foi **incorporado à
migration `20260921000000`** (ainda não aplicada), como pedido. **Nada foi publicado, aplicado ou ativado**: nenhuma
migration em banco hospedado, nenhuma função deployada, nenhum workflow do n8n alterado, nenhuma mensagem enviada.
Testado no repositório e no Postgres local descartável.

## 1. Recuperações não podem desaparecer quando o vínculo mudou

**Defeito:** a seleção das recuperações fazia `JOIN` com o agendamento **da mesma clínica**. Se o agendamento mudou
de clínica, a jornada sumia da lista — e ficava presa.

**Correção:** a seleção parte **só da jornada** e da clínica dela (FK, sempre existe). O agendamento entra por
`LEFT JOIN`, apenas para os nomes cosméticos, e só vale se ainda for da mesma clínica (senão vêm nulos — nunca
nomes de outra clínica). A jornada continua listada; a RPC a encerra por **`abandonada_vinculo_invalido`**, sem
mensagem. Provado para: agendamento em outra clínica, paciente em outra clínica, agendamento de outro paciente.

## 2. Clínica que desligou a automação: sem mensagem, mas a pendência é encerrada

**Defeito:** as recuperações só eram listadas para clínicas com o pós-consulta ligado (e a Edge barrava a
chamada). A pendência de quem desligou nunca era encerrada — e prendia o telefone.

**Correção:** a lista **não filtra mais por automação ligada**. A RPC de recuperação verifica, sob lock, a chave
`pos_consulta_tipo` da clínica: fora de `satisfacao/google/ambos` (`nenhum`, ausente ou inválida) → encerra a
jornada em silêncio com **`abandonada_automacao_desligada`**, liberando o telefone. **Nenhuma mensagem é gerada**
(a Edge Function deixou de barrar a recuperação por conta própria — a RPC decide antes de qualquer texto). Decide
**só** essa chave: uma configuração ligada porém **incompleta** (link removido depois, tempo ausente) **não**
encerra — a jornada em andamento usa o modo e o link **capturados** quando começou (regra da spec, seção 5).

## 3. `aguardando_satisfacao` expira em silêncio aos 7 dias

**Defeito:** `aguardando_satisfacao` (primeira mensagem entregue, paciente nunca respondeu) ocupava o índice de
telefone ativo para sempre.

**Correção:** `cappia_pos_consulta_encerrar_sem_resposta(p_limit)` encerra, sem enviar nada, as jornadas
`aguardando_satisfacao` com **7 dias** (10080 min, contados da confirmação da primeira entrega) sem resposta, com o
motivo **`abandonada_sem_resposta`**, liberando o telefone. Em lote, mais antigas primeiro, `skip locked` (uma
resposta em curso que já segurou o lock nunca é atropelada), idempotente. O prazo tem fonte única
(`cappia_pos_consulta_expiracao_sem_resposta_minutos()`). **Não toca** nas etapas pendentes (a recuperação cuida
delas) e **não** grava convite: ausência de resposta nunca autoriza Google. Uma resposta **posterior** não encontra
jornada aberta (`buscarJornadaAbertaPosConsulta` só olha `aguardando_satisfacao`) e segue o fluxo normal; uma
resposta que chegue na janela exata do encerramento recebe `ja_processada` e também cai no fluxo normal.

**n8n (Disparo A):** novo node `Encerrar jornadas sem resposta (RPC …)` chama a RPC direto por REST (mesma
credencial do node de candidatos), **em paralelo** à busca de candidatos, **sem saída** — não chega à Edge, ao
OpenAI, ao Evolution nem ao `confirmar` (um teste percorre o grafo) — e com `onError: continue`.

## Esquema e vocabulário

O CHECK de `encerramento_motivo` passa a aceitar **cinco** motivos (todos só com `etapa = 'encerrada'`):
`abandonada_janela`, `abandonada_tentativas`, `abandonada_vinculo_invalido`, `abandonada_automacao_desligada`,
`abandonada_sem_resposta`. O adaptador Core da recuperação aceita os **quatro** que essa RPC pode devolver e recusa
`abandonada_sem_resposta` (vem da expiração, não da recuperação).

## Provas (local)

| Verificação | Resultado |
|---|---|
| Runner SQL (3 migrations) | **verde**, incluindo R8 (reescrito), **R11 (novo)** e **S1–S4 (novos)**; zero resíduo |
| **Controles negativos** (mutação da seleção antiga) | mutação completa (JOIN interno + filtro de automação) **falha em R8**; só o JOIN interno **falha em R11a** — os testes detectam o defeito |
| `npm test` | **2031 testes, 0 falhas** (2024 passam, 7 ignorados — os mesmos) |
| `tsc --noEmit` | limpo |
| `deno check` (2 Edge Functions) / handler Deno | limpo / **13 passam** |
| Ensaio `db push` local | **passa**: dry-run lista exatamente as 2 pendentes; histórico com as versões dos arquivos; 10 funções `cappia_pos_consulta_*`; segundo dry-run vazio |
| Paridade Core × Edge; segredos | idêntica; nenhum |

**Cenários cobertos no runner:** R8 — automação desligada (tipo `nenhum`, ausente, inválido) continua listada e é
encerrada em silêncio, telefone liberado; ligada-porém-incompleta **não** encerra. R11 — agendamento/paciente em
outra clínica e agendamento de outro paciente. S — 8 dias e exatamente 7 dias expiram; 6 d 23 h não; telefone
liberado; `registrar_resposta_pendente` tardia devolve `ja_processada` sem reabrir nem convidar; etapas pendentes
antigas não são tocadas; limite por chamada (a mais antiga primeiro) e idempotência; CHECK do motivo; ACL negativa.

## Impacto no que já estava aprovado

- Migration `20260921000000`: **conteúdo alterado** (hash novo no MANIFESTO, guardado por teste); as outras duas
  migrations **não mudaram**. O plano de aplicação (`db push` com dry-run, workspace com marcadores) segue igual.
- A Edge Function `iris-nova-pos-consulta` passa a **não** barrar `recuperar` por configuração desligada — quem
  decide é a RPC. O Core (adaptador) ganhou o motivo `abandonada_automacao_desligada`.
- Decisões aprovadas mantidas: 3 tentativas, "ao menos uma vez", 48 h para recuperação.

## Riscos residuais (declarados)

1. Um paciente que **responde depois dos 7 dias** cai no fluxo normal da Iris (não no pós-consulta) — é o
   comportamento pedido; a resposta dele não recebe o agradecimento/convite do pós-consulta.
2. A expiração depende do Disparo A rodar (ele chama a RPC a cada ciclo). Com o workflow inativo nada expira —
   coerente com "não ativar".
3. `abandonada_automacao_desligada` decide pela chave `pos_consulta_tipo`. Uma clínica que **religa** a automação
   depois de ter suas pendências encerradas não as retoma (foram encerradas de propósito); só agendamentos novos.

## Ordem de aplicação (NADA feito; cada item exige autorização)

Inalterada em relação à sexta revisão: n8n primeiro (credencial Custom Auth, nodes, **inclusive o novo node de
expiração e a nova fonte/ação do Disparo A**), depois o secret da função, credencial de banco nova por prompt oculto,
`db push` das duas migrations pendentes com dry-run (hash da `20260921000000` no MANIFESTO), deploy de
`iris-nova-pos-consulta` e `iris-nova-mensagem`, e só então revisar a ativação.
