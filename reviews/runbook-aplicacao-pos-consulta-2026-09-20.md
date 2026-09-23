# Roteiro operacional — aplicação do pós-consulta (portões, rollback e teste controlado)

**Status: NADA foi aplicado, deployado, publicado ou ativado.** Este roteiro só descreve a ordem. **Cada portão exige
autorização explícita do Gabriel, por ação**; ao fim de cada um, parar e reportar evidência sanitizada antes de
seguir. Qualquer falha, divergência ou comportamento inesperado = **PARAR** (sem improvisar correção no ambiente).
Base: sétima revisão aprovada pelo Codex. Decisões já aprovadas: janela de 48 h (também na recuperação), 3
tentativas, entrega "ao menos uma vez", expiração de 7 dias, modo Google pergunta antes do link, aplicação por
`supabase db push`. **Disparo A continua inativo até o último portão.**

## O que precisa estar pronto antes (entradas)

| Entrada | Quem | Observação |
|---|---|---|
| Credencial de banco (URL do pooler ou senha) para o `db push` | Gabriel | **Prompt oculto**; nunca no chat, nunca em arquivo versionado. Os tokens do E2E foram revogados. |
| Token da CLI com escopo de deploy/secrets das Edge Functions | Gabriel | Idem. Deploy com `--use-api`, **nunca** `--prune`. |
| Segredo interno (≥ 32 caracteres, aleatório) | Gabriel gera | Mesmo valor na credencial Custom Auth do n8n e no secret `POS_CONSULTA_SEGREDO_INTERNO`. |
| Ações no n8n pela interface | Gabriel | A chave da API não tem escopo de escrita/ativação (403). |

## Portões

### P0 — Linha de base e backups (somente leitura)
- `list_migrations` → JSON local; `pos_consulta_jornadas` com **0 linhas**; colunas/CHECKs/funções novas **ausentes**
  (preflight no cabeçalho de cada migration).
- Backup dos bundles **vivos**: `iris-nova-mensagem` (hoje v118) e `iris-nova-pos-consulta` (v1), com SHA-256 (padrão
  de `backups/rollback-iris-nova-mensagem-v117/`); export do `Iris Oficial` e do legado (GET, hashes).
- **Parar se:** tabela com linhas; versão remota maior que `20260920230000`; bundle vivo diferente do esperado.
- **Rollback:** n/a (só leitura).

### P1 — n8n primeiro (Gabriel, pela interface)
1. Criar a credencial **Custom Auth** `Iris Nova Pos-Consulta (chamada interna)` (`Authorization` + segredo).
2. Trocar o node `confirmar` **já aplicado** no `Iris Oficial` para a credencial nova (+ retry 3×).
- Por quê antes: `confirmar` roda **depois** do envio; com 401 a mensagem já saiu e a jornada fica pendente.
- **Verificação (GET):** só esse node mudou; demais nodes/conexões idênticos ao backup do P0.
- **Rollback:** restaurar o export do `Iris Oficial` (P0) pela interface.

### P2 — Secret da Edge Function
- Definir `POS_CONSULTA_SEGREDO_INTERNO`. **Verificação:** listar secrets (só o nome). Sem o secret a função responde
  500 a todos (falha fechado) — nunca aceita qualquer chamador.
- **Rollback:** remover o secret (a função volta a recusar tudo).

### P3 — Migrations (`db push` com dry-run)
1. `preparar-workspace-db-push.mjs` com as 2 pendentes → confere SHA-256 com o MANIFESTO
   (`20260920230000` e `20260921000000`).
2. **`supabase db push --dry-run`**: tem que listar **exatamente** as 2 pendentes. Qualquer outra coisa = PARAR.
3. **Autorização** → `supabase db push`.
- **Verificação:** `list_migrations` mostra **as versões dos arquivos** (sem renomear, sem `migration repair`);
  novo dry-run não lista nada; as 10 funções e as colunas/CHECKs existem; `anon`/`authenticated` sem `EXECUTE`.
- **Rollback (testado em `ensaio-rollback-local.mjs`):** `src/supabase/rollbacks/…921000000…_rollback.sql` e depois
  `…920230000…_rollback.sql` (execução manual, autorizada; a primeira tem **trava** contra apagar dados em uso).
  ⚠ O rollback da `20260920230000` **reintroduz** o convite direto do modo `google` e a falta de janela — só com
  decisão explícita e Disparo A inativo. **Decisão pendente para o momento do rollback:** o histórico remoto ainda
  listaria as versões revertidas; reconciliar com uma migration de avanço "reversa" **ou** com `migration repair`
  (que só se admite no rollback, por decisão sua) — não improvisar.

### P4 — Deploy das Edge Functions
- Deploy de **`iris-nova-pos-consulta`** (autenticação interna + `recuperar`) e de **`iris-nova-mensagem`** (espelhos
  do fluxo reativo; sem isso o modo `google` não convida após a positiva). Hash do bundle publicado = hash do local.
- **Verificação:** chamada **sem** o cabeçalho do segredo → 401; com o segredo e payload inválido → 400 (prova que
  passou da autenticação); `iris-nova-mensagem` responde normalmente ao tráfego atual (sem regressão).
- **Rollback:** redeploy dos bundles do P0 (procedimento de `backups/rollback-iris-nova-mensagem-v117/ROLLBACK.md`).

### P5 — Disparo A no n8n (inativo)
- Atualizar o Disparo A **inativo, gatilho desabilitado** com o JSON versionado: fonte única com `acao_edge`, chamada
  à Edge com `acao: $json.acao_edge`, `onError: continue`, retry do `confirmar`, node de expiração.
- **Verificação (GET):** `active=false`, gatilho desabilitado, 0 execuções; hashes registrados.
- **Rollback:** despublicar/excluir o workflow atualizado (nunca esteve ativo).

### P6 — TESTE CONTROLADO (Clear Dent, telefone autorizado, scripts guardados)
Mesmas regras do E2E anterior: **um único telefone autorizado** (mascarado em toda saída; a guarda recusa qualquer
outro destino), fixtures **sintéticas** só na Clear Dent, configuração temporária registrada e restaurada, **sem
executar a RPC ampla de candidatos** e **sem ativar o Disparo A** (os scripts chamam a Edge `iniciar`/`recuperar`/
`confirmar` por agendamento, como o Disparo A faria). Casos:

| # | Caso | Prova esperada |
|---|---|---|
| T1 | `iniciar` → envio guardado → `confirmar` | pergunta sem link; Evolution `key.id`; jornada `aguardando_satisfacao` |
| T2 | Resposta positiva → segundo envio | link só aqui; URL simples; jornada `encerrada` com convite |
| T3 | Resposta negativa | agradecimento sem link; `encerrada`; sem `convite_google_em` |
| T4 | **Recuperação**: entrega pendente + lease vencido → `recuperar` → envio → `confirmar` | mesma `entrega_id`; tentativa 2; confirma normalmente (as duas etapas: `aguardando_inicio` e `finalizando`) |
| T5 | Abandonos silenciosos: fora da janela; 3 tentativas; vínculo rompido; automação desligada | **nenhuma mensagem**; `encerrada` com o motivo; telefone liberado |
| T6 | `aguardando_satisfacao` com 7 dias (data forçada) → RPC de expiração | encerrada em silêncio; sem convite; resposta posterior segue o fluxo normal |
| T7 | Autenticação: sem cabeçalho / segredo errado / só a publishable key | 401 em todas |
| T8 | Modo `google` | pergunta primeiro; link só após positiva |

- **Contagem de envios:** total de envios da Evolution do teste = número de casos que enviam; **todos** para o
  telefone autorizado (correlação por execução/`remoteJid`), como no pacote sanitizado do E2E.
- **Limpeza/restauração:** apagar fixtures e jornadas de teste, restaurar a configuração da Clear Dent (verificação
  campo a campo), apagar o telefone do disco. **Parar se** qualquer envio sair para outro número.
- **Rollback:** limpeza acima; se algo divergir, P3/P4 conforme a matriz abaixo.

### P7 — Revisão final com evidências (Codex) e decisão do Gabriel
- Pacote sanitizado (sem telefone/texto de paciente) + este roteiro preenchido. **Sem essa aprovação, não há P8.**

### P8 — Ativação recorrente (decisão separada do Gabriel)
- **Antes**, com autorização: contagem **somente leitura** (sem detalhes) do que a RPC listaria naquele instante —
  a janela de 48 h limita, mas cada linha é um paciente real; Gabriel aceita o número.
- Ativar em horário comercial, acompanhando as **primeiras execuções**: destinos distintos, sucesso da Evolution,
  jornadas `encerradas`/abandonadas, nenhum erro repetido (o legado falhava sempre no mesmo número).
- **Kill switch:** despublicar o Disparo A (efeito imediato); o legado **permanece** desativado.

## Matriz de rollback

| Se falhar em… | Fazer | Efeito |
|---|---|---|
| P1 | restaurar export do `Iris Oficial` | volta o node `confirmar` anterior |
| P2 | remover o secret | função recusa tudo (fechado) |
| P3 | rollback 3, depois 2 (com as decisões de histórico acima) | esquema volta ao da v1 |
| P4 | redeploy dos bundles do P0 | funções voltam às versões anteriores |
| P5 | despublicar o Disparo A atualizado | nunca esteve ativo |
| P6 | limpeza + restauração de config | sem resíduo |
| P8 | despublicar o Disparo A | para as próximas execuções |

## Riscos que continuam abertos (declarados)
1. **Entrega "ao menos uma vez":** duplicidade possível se o envio teve sucesso e a confirmação falhou (retry no
   `confirmar` reduz; limite de 3 tentativas).
2. Resposta **depois de 7 dias** cai no fluxo normal da Iris, sem agradecimento/convite do pós-consulta.
3. Clínica que religa a automação **não** retoma pendências já encerradas.
4. Frentes futuras **fora** deste roteiro: inconformidade e várias mensagens.
   - **Inconformidade (decisão registrada em 2026-09-23, durante o P6; não implementada nesta entrega):** quando a
     resposta do paciente indicar insatisfação, a Iris deve entender o ocorrido (conversar o quanto for necessário
     para captar o motivo, em vez do encerramento simples atual — agradecer e fechar sem link), e o caso deve ficar
     registrado na aba **Exceções** do painel, sob uma categoria própria (**"Inconformidade do paciente"**), para
     acompanhamento da clínica. Precisa de desenho próprio (alerta privado, categoria no painel) e autorização
     separada antes de implementar — **não fazer via ajuste ad hoc**.
   - **Comportamento atual, válido até essa frente ser autorizada** (testado no P6, cenário T3): resposta negativa →
     agradecimento sem link, jornada encerrada, sem registro em Exceções.
