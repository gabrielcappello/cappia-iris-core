# Correções da revisão final do Codex — pós-consulta (2026-09-20)

Escopo: os 4 bloqueadores antes da ativação recorrente. **Não** mexe no fluxo de
inconformidade nem na divisão em várias mensagens (frentes futuras). **Nenhuma ação
foi feita em ambiente hospedado**: nada aplicado no Supabase, nada publicado ou
deployado, nenhum workflow do n8n alterado, nenhuma mensagem enviada. Tudo foi
escrito e testado no repositório e no Postgres local descartável (127.0.0.1).

## Bloqueador 1 — nenhum modo envia Google sem satisfação positiva confirmada

**Regra implementada (decisão do Gabriel):** a primeira mensagem nunca contém link,
em nenhum modo; o modo `google` passa a **perguntar primeiro**, igual a `ambos`; o
link só existe na segunda entrega, após resposta `positiva`; `satisfacao` nunca envia
link. Matriz: o convite só ocorre em `(google|ambos) × positiva`.

Três camadas (defesa em profundidade):

| Camada | O que garante |
|---|---|
| **Core** | O objetivo `convidar_avaliacao_google` (convite direto) foi **removido** do tipo, dos fatos, do fallback, da guarda e das instruções do redator: o compilador impede representar um convite sem satisfação. `iniciarJornada` devolve sempre `perguntar_satisfacao`; `registrarRespostaSatisfacao` convida só com `google/ambos + positiva`. O adaptador recusa `convite_pendente` ≠ `false` antes de chamar a RPC e falha fechado se a RPC devolver primeira entrega com convite. A guarda barra **qualquer URL** na pergunta. |
| **RPCs** (nova migration) | `iniciar_jornada` recusa `p_convite_pendente` ≠ false; `confirmar_entrega` leva `aguardando_inicio` → `aguardando_satisfacao` em qualquer modo (antes `google` ia direto a `encerrada`); `registrar_resposta_pendente` recusa convite fora de `positiva` + modo com Google. |
| **Esquema** | 3 CHECKs em `pos_consulta_jornadas`: sem convite na primeira entrega; `convite_pendente` só com `positiva` + modo com Google; `convite_google_em` idem. Valem até contra `UPDATE` direto. Achado ao escrever: um CHECK cuja expressão vale **NULL passa** — com `classificacao` nula o CHECK ingênuo deixaria gravar convite; corrigido com `coalesce(classificacao = 'positiva', false)` e coberto por teste (G4). |

## Bloqueador 2 — janela máxima de idade (48 h)

- Nova função `cappia_pos_consulta_janela_maxima_minutos()` = **2880** (fonte única no banco) e
  `JANELA_MAXIMA_POS_CONSULTA_MINUTOS = 2880` (fonte única no Core). Um teste lê a migration e
  **falha se os dois números ou a fronteira divergirem**.
- `cappia_pos_consulta_candidatos` (pré-filtro): exclui fora da janela.
- `iniciar_jornada` (autoritativa, sob lock): devolve `fora_da_janela` para jornada nova **e para
  reclaim**; sem `concluido_em` = fora (falha fechado). Replay de jornada confirmada e lease vigente
  não mudam.
- Elegibilidade autoritativa da Edge Function: novo motivo `janela_maxima_excedida`; a recusa da RPC
  (`fora_da_janela`) vira o mesmo motivo em `avaliarEIniciarPosConsulta`.
- Fronteira idêntica nos dois lados: idade **igual** à janela já está fora.
- **DECISÃO DE PRODUTO A CONFIRMAR (Gabriel) antes de aplicar:** o valor de 48 h. A spec não define o
  número; o prazo configurável (2h/4h/24h) é sempre menor. Trocar o valor exige mudar a função SQL e a
  constante do Core (o teste de paridade acusa se um esquecer o outro).

## Bloqueador 3 — autenticação interna dedicada n8n ↔ Edge Function

- Cabeçalho `x-iris-pos-consulta-segredo`, comparado em **tempo constante** (SHA-256 + XOR acumulado)
  com o secret `POS_CONSULTA_SEGREDO_INTERNO` (≥ 32 caracteres) — `pos-consulta-autenticacao-interna.ts`.
- Exigido no `handler` **antes** de ler o corpo, de tocar o banco ou de chamar a OpenAI. Segredo ausente
  ou curto no servidor **falha fechado** (500 `configuracao_ausente` para todos); cabeçalho ausente ou
  errado → 401 `nao_autorizado`. A publishable key sozinha não passa.
- n8n: os **4** nodes que chamam `iris-nova-pos-consulta` (2 no Disparo A, 1 no patch do Iris Oficial,
  1 no workflow reativo completo) passam a usar uma credencial **Custom Auth**
  `"Iris Nova Pos-Consulta (chamada interna)"` com os dois cabeçalhos (`Authorization` +
  segredo). Nenhum valor secreto entra em JSON; testes garantem isso.
- `handler` foi exportado para teste. Nada mais mudou nele.

## Bloqueador 4 — nome do arquivo × versão registrada

`20260915120000_iris_nova_pos_consulta_v1.sql` → `20260919204030_iris_nova_pos_consulta_v1.sql`
(versão realmente registrada no banco). **Só o nome mudou:** SHA-256 idêntico antes e depois
(`2b089287…5427c`). **Nenhum SQL reaplicado, nenhum `migration repair`.** Referências atualizadas em
código, testes, runner, preflight, documentos e JSON de n8n; MANIFESTO ganhou a seção do ambiente
operacional com a reconciliação. (A "lição" registrada aqui na época — renomear o arquivo logo após aplicar
por `apply_migration` — foi **recusada pelo Codex na sexta revisão e substituída**: ver
`correcoes-sexta-revisao-pos-consulta-2026-09-20.md`.) O registro histórico do Codex em
`reviews/revisao-pos-consulta-conversacional-v1.md` mantém o nome da época.

## Evidências (locais)

| Verificação | Antes | Depois |
|---|---|---|
| `npm test` (Node) | 1954 testes, 0 falhas | **1998 testes, 1991 passam, 0 falhas**, 7 ignorados (os mesmos) |
| `tsc --noEmit` | limpo | limpo |
| `deno check` (as 2 Edge Functions) | — | limpo |
| Handler sob Deno (`index.autenticacao.test.ts`) | — | **9 passam** (401 sem segredo / segredo errado; auth antes do corpo; 500 fechado com segredo ausente/vazio/curto; 405) |
| Runner SQL local (Postgres 17) | verde | **verde, com cenários novos G1–G4 e J1–J3**; zero resíduo |
| Controle negativo | — | mesmo runner só com a migration original **falha em G1** |
| Paridade Core × Edge | idêntica | idêntica (todos os `pos-consulta-*` espelhados, byte a byte) |

## Fora do escopo / riscos residuais (declarados)

1. **Jornada pendente órfã.** `candidatos` exclui qualquer agendamento que já tenha jornada, então uma
   pendência cujo envio falhou nunca é retentada pelo Disparo A; com a janela, um reclaim tardio passa a
   ser recusado, e a pendência continua ocupando o índice de telefone ativo. Já existia como lacuna;
   não corrigido (precisa de decisão: expiração/encerramento de pendência).
2. **Filtros da RPC legada não replicados** (`pos_consulta_enviado`, `whatsapp_status`, telefone do
   agendamento). O legado está desativado; a janela limita o alcance.
3. **Copy do painel** (repositório do portal): o texto do modo "Avaliação no Google" pode ainda descrever
   envio direto. Não tocado.
4. **Spec:** duas emendas registradas em `specs/pos-consulta-conversacional-v1.md` (2.2, 6.2, 9.2 e 3
   marcadas como superadas/acrescidas); a spec permanece de responsabilidade do Codex.

## Ordem de aplicação (NADA disto foi feito; cada item exige autorização)

1. Gabriel confirma a janela (48 h).
2. **n8n primeiro:** criar a credencial Custom Auth e ligar os nodes (inclusive trocar, pela interface,
   o node `confirmar` **já aplicado** no Iris Oficial). `confirmar` acontece **depois** do envio; se
   levar 401, a mensagem já saiu e a jornada fica pendente.
3. Definir o secret `POS_CONSULTA_SEGREDO_INTERNO` (≥ 32 caracteres, aleatório) nas Edge Functions.
4. ~~Aplicar por `apply_migration` e renomear depois~~ — **plano SUBSTITUÍDO (sexta revisão, bloqueador 2):**
   aplicar as migrations pendentes com `supabase db push` a partir do workspace preparado, que registra a
   **versão do arquivo** no histórico remoto (sem renomear depois, sem `migration repair`). Roteiro em
   `src/supabase/migrations/MANIFESTO.md` e em `correcoes-sexta-revisao-pos-consulta-2026-09-20.md`.
5. Deploy de **`iris-nova-pos-consulta` e de `iris-nova-mensagem`** (os espelhos do fluxo reativo mudaram
   — sem isso o modo `google` não convida após a positiva), com rollback preparado.
6. Só então revisar a ativação recorrente (Disparo A segue inativo, gatilho desabilitado).
7. Nova credencial de acesso ao banco será necessária: os tokens usados no E2E foram revogados.
