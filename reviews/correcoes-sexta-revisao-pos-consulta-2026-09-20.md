# Correções da sexta revisão do Codex — pós-consulta (2026-09-20)

Escopo: os 2 bloqueadores restantes antes da ativação recorrente. Gabriel confirmou a janela de 48 h e que o
modo Google pergunta a satisfação antes do link. **Nada foi publicado, aplicado ou ativado**: nenhuma migration
aplicada em banco hospedado, nenhuma função deployada, nenhum workflow do n8n alterado, nenhuma mensagem
enviada. Tudo foi escrito e testado no repositório e no Postgres local descartável (127.0.0.1).

## Bloqueador 1 — recuperação de jornadas com entrega pendente e lease expirado

**Problema:** uma entrega é reservada (lease de 180 s) antes do envio e confirmada depois. Se o envio falha ou a
confirmação não chega, a jornada fica pendente (`aguardando_inicio` na primeira entrega, `finalizando` na
segunda). `cappia_pos_consulta_candidatos` excluía qualquer agendamento com jornada, então **ninguém a
recuperava** — e ela ocupava para sempre o índice de telefone ativo, bloqueando toda jornada futura daquele
telefone.

**Solução (migration `20260921000000_…recuperacao_entrega_pendente`, aditiva):**

| Peça | O que faz |
|---|---|
| `cappia_pos_consulta_candidatos` | Passa a listar também as jornadas pendentes com lease vencido (**as duas etapas**), com `acao_edge` = `iniciar` \| `recuperar`. Recuperações primeiro (mais antigas antes). Só clínicas com pós-consulta ligado. Mesmas colunas de antes + `acao_edge` (drop + create: o tipo de retorno mudou). |
| `cappia_pos_consulta_recuperar_entrega` (nova) | Sob lock: lease vigente → `em_andamento`; sem pendência → `nao_pendente`; **recuperável** → reclama a **mesma** entrega (`entrega_id`, classificação e `convite_pendente` preservados; token e lease novos; tentativa contada); **irrecuperável** → **encerra a jornada sem mensagem** e **libera o telefone**, com o motivo gravado. |
| Motivos de abandono | `abandonada_janela` (agendamento fora das 48 h ou sem `concluido_em`); `abandonada_tentativas` (3 tentativas autorizadas sem confirmação); `abandonada_vinculo_invalido` (agendamento/paciente/telefone oficial não batem mais com o snapshot da jornada — **nunca enviar a outro número**). |
| Esquema | Colunas `entrega_tentativas` e `encerramento_motivo`; 2 CHECKs (tentativas ≥ 1; motivo só em `encerrada` e de vocabulário fechado); trigger que reinicia a contagem quando começa uma NOVA entrega (o `entrega_id` muda) — as três funções existentes não mudaram. |

**Core / Edge / n8n:**

- Core: `pos-consulta-recuperar-entrega.ts` (adaptador estrito, com **defesa em profundidade**: primeira entrega
  nunca volta com convite/classificação; convite só com `positiva` + modo com Google + link do snapshot) e
  `pos-consulta-processar-recuperacao.ts` (a decisão sai **sempre do que a jornada gravou**; o link vem do
  **snapshot** da jornada, nunca da configuração atual; **não confirma** — o n8n envia e depois confirma).
- Edge: nova operação `recuperar` no `handler` (mesma autenticação interna, mesma releitura autoritativa de
  paciente e telefone oficial; clínica com automação desligada não recupera).
- n8n (Disparo A): uma fonte de candidatos; a chamada à Edge passa a usar `acao: $json.acao_edge`;
  **falha de UM item não derruba o lote** (`onError: continue` na Edge e no envio — o bloqueio de cabeça de fila
  que travava o workflow legado); `confirmar` com retry (3×).

**Provas (local):** runner SQL com cenários **R1–R10** (lease vigente × vencido; as duas etapas; mesma entrega
preservada; confirmação zera a contagem; 3 tentativas e depois abandono com telefone liberado; janela; vínculo —
telefone diferente, ausente, paciente diferente, telefone oficial trocado; `em_andamento`/`nao_pendente`;
clínica desligada; ordem recuperar-antes-de-novos; CHECKs; ACL negativa); 19 testes do adaptador e do caso de
uso; 13 testes Deno do handler (4 novos para `recuperar`); testes do JSON do n8n.

### Decisões a confirmar (novas)
- **3 tentativas por entrega** (`cappia_pos_consulta_max_tentativas_entrega()`). Fonte única no banco.
- A janela de 48 h **também limita a recuperação** (não há janela nova).

### Riscos residuais (declarados)
1. **Entrega "ao menos uma vez".** Se o envio TEVE sucesso e só a confirmação falhou, a recuperação **reenvia**
   (a Evolution não deduplica por `entrega_id`) — até 3 tentativas. Mitigação no n8n: `confirmar` com retry.
2. **Segunda entrega recuperada** é redigida sem citar o texto original do paciente (a jornada não o guarda; não
   se persiste texto de paciente só para isto).
3. ~~**`aguardando_satisfacao` sem resposta nunca é encerrada**~~ — **RESOLVIDO na sétima revisão** (expira em
   silêncio aos 7 dias): ver `correcoes-setima-revisao-pos-consulta-2026-09-20.md`.

## Bloqueador 2 — plano de aplicação preservando a versão do arquivo

**Por quê:** `apply_migration` do MCP só aceita `name` e `query` (verificado no schema da ferramenta) — o servidor
gera a versão. Aplicar por ali e "renomear depois" (o plano anterior) não preserva a versão do arquivo no
histórico remoto; foi o que descasou `20260915120000` de `20260919204030`.

**Plano corrigido — `supabase db push` a partir de um workspace descartável:**

1. `preparar-workspace-db-push.mjs` (novo; **nunca conecta a nada**) monta um workspace com **marcadores vazios**
   para cada versão já registrada no remoto (a CLI recusa se o histórico remoto tiver versões sem arquivo local) e
   **cópias byte-idênticas** das migrations pendentes (SHA-256 verificado). Recusa versão pendente já registrada,
   anterior à última remota, duplicada ou com nome inválido.
2. `supabase db push --dry-run` — **obrigatório**: tem que listar exatamente as pendentes e nenhuma outra.
3. `supabase db push` real, só com autorização.
4. Verificação: `list_migrations` mostra as **versões dos arquivos**; novo dry-run não lista nada; SHA-256 batem.
   Sem renomear, sem `migration repair`. Se o `db push` não puder ser usado, **parar e pedir decisão** — nunca
   improvisar com `apply_migration` + renomear + `repair`.

**Ensaio local com a CLI real** (`src/supabase/aplicacao/ensaio-local-db-push.mjs`, Postgres 17 descartável):
simula o histórico remoto com a v1 já aplicada; o dry-run lista **exatamente** as pendentes; o push registra
**exatamente as versões dos arquivos** (nomes idênticos); um segundo dry-run não lista nada; e o **controle
negativo** prova que, sem os marcadores, a CLI recusa e sugere `migration repair` — por isso o workspace os leva
(são arquivos locais vazios; o histórico remoto não é tocado).

**Correções de documentos:** o cabeçalho da migration `20260920230000` (só comentário — o **SQL executável é
idêntico**, hash das instruções sem comentários `3475de50…13af` antes e depois), o MANIFESTO (plano + hashes dos
três arquivos, guardado por teste que compara com os arquivos reais) e o registro anterior.

## Evidências (locais)

| Verificação | Resultado |
|---|---|
| `npm test` (Node) | **2027 testes, 2020 passam, 0 falhas** nas execuções limpas (antes desta rodada: 1998), 7 ignorados (os mesmos). **Ressalva:** em 2 de 5 execuções apareceu 1 falha **intermitente e sem relação** — testes de temporização (`setTimeout`/`Date.now`) em `cliente-modelo-openai.test.ts` (INT-20b; "historicoConversa … limite da janela"), arquivo **não tocado** por esta entrega; nas repetições passam. |
| `tsc --noEmit` | limpo |
| `deno check` (as 2 Edge Functions) | limpo |
| Handler sob Deno | **13 passam** (9 anteriores + 4 de `recuperar`) |
| Runner SQL (3 migrations) | **verde**, G1–G4, J1–J3, **R1–R10**; zero resíduo |
| Preparador de workspace | 6 testes passam |
| Ensaio `db push` local | **passa** (dry-run exato, versões preservadas, segundo dry-run vazio, controle negativo) |
| Paridade Core × Edge | idêntica, byte a byte |

## Ordem de aplicação (NADA disto foi feito; cada item exige autorização)

1. n8n primeiro (credencial Custom Auth + nodes; incluindo o `confirmar` já aplicado no Iris Oficial e o retry).
2. Secret `POS_CONSULTA_SEGREDO_INTERNO` nas Edge Functions.
3. Credencial de banco NOVA (os tokens do E2E foram revogados) por prompt oculto.
4. Preflight read-only + **`db push` das duas migrations pendentes juntas** (roteiro do MANIFESTO), com dry-run.
5. Deploy de `iris-nova-pos-consulta` **e** `iris-nova-mensagem`, com rollback preparado.
6. Atualizar o Disparo A no n8n (nova fonte/ação/`onError`) — inativo até revisão.
