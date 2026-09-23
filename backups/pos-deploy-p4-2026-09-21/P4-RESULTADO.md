# P4 — Deploy das Edge Functions (2026-09-21) — resultado

Autorizado pelo Gabriel: deploy das duas Edge Functions a partir dos arquivos revisados (árvore de trabalho), backups do
P0 como rollback; verificações de versão, bundle, secrets e smoke tests **sem envio de WhatsApp**. Não houve alteração
no n8n, migration, ativação do Disparo A nem chamada à Evolution.

## Antes do deploy (somente leitura)
- **Divergência de versão observada e explicada:** as listagens mostravam `iris-nova-mensagem` **v119** e
  `iris-nova-pos-consulta` **v2** (P0: v118 e v1). O `ezbr_sha256` era **idêntico** ao do P0 nas duas (`9bd73dde…` e
  `885ed1b0…`) e o `updated_at` da mensagem não mudou. Foi o contador de versão da plataforma após a definição do
  secret no P2 (ocorreu depois da captura do P0; nenhum deploy nosso entre os dois). Conteúdo idêntico ⇒ os backups
  do P0 continuam sendo a linha de base de rollback correta. É uma inferência (causa não confirmada pela plataforma).
- Espelhos Core/Edge: 26 (pos-consulta) e 84 (mensagem) arquivos com espelho em `src/core`, **todos idênticos**, exceto
  `iris-nova-mensagem/cliente-modelo-openai.ts`, que difere por **uma linha de comentário**; esse arquivo já estava
  commitado, é idêntico ao bundle vivo e não faz parte desta entrega (sem efeito funcional).
- `deno check` dos dois entrypoints: sem erros. Testes Deno da autenticação: 13/13.
- Diferenças da pasta local contra o bundle vivo do P0: pos-consulta 10 de 17 arquivos (+3 novos:
  `pos-consulta-autenticacao-interna.ts`, `-processar-recuperacao.ts`, `-recuperar-entrega.ts`); mensagem 6 de 76 —
  o mesmo conjunto já registrado no P0.

## Deploy (um comando por função, `--use-api`, sem `--prune`, token do cofre sem exibição)
| Função | Antes | Depois | `verify_jwt` | `ezbr_sha256` novo | Arquivos no bundle |
|---|---|---|---|---|---|
| `iris-nova-pos-consulta` | v2 (`885ed1b0…`) | **v3** | true | `073a7d5f54f50205fc0a0368c0eb00e1181b3e5e284d5ae5f90a6939cad75eac` | 20 — **20/20 idênticos** ao local (SHA-256) |
| `iris-nova-mensagem` | v119 (`9bd73dde…`) | **v120** | true | `061cbf1c2529e72d9b4900825b2653e60cd5443bd0597cc60292ab9a1c008704` | 76 — **76/76 idênticos** ao local (SHA-256) |

- `criar-clinica` (v16) e `suporte-chat` (v8): **inalteradas**.
- Arquivos que não entram no bundle (só tipos, testes, JSON/MD do n8n) são os mesmos já ausentes nos bundles do P0.
- Bundles vivos pós-deploy salvos em `iris-nova-pos-consulta-v3/` e `iris-nova-mensagem-v120/` (com `SHA256SUMS.txt`).
  Varredura de higiene: nenhum `sbp_`, `sb_secret_`, JWT nem o valor do segredo interno em `backups/`.

## Secrets
Listagem só de nomes: 11 secrets; `POS_CONSULTA_SEGREDO_INTERNO` existe e o **digest SHA-256 confere com o cofre**; os
outros 10 seguem os mesmos.

## Smoke tests (nenhum chega a banco, OpenAI ou Evolution)
`iris-nova-pos-consulta` v3 — **9/9 conformes**: sem JWT → 401 (gateway); só a publishable key → 401 `nao_autorizado`;
segredo errado → 401; segredo vazio → 401; segredo correto + ação inválida → 400 `acao_invalida`; + `confirmar` sem
provider → 400; + `iniciar` sem `agendamento_id` → 400 (prova que passou da autenticação); payload válido com instância
**não autorizada** → 403 (gate antes do banco); GET → 405.
`iris-nova-mensagem` — 4/4 conformes **antes** (v119) e **depois** (v120), respostas idênticas: 401 sem JWT, 405 GET,
400 payload vazio, 403 instância não autorizada.
Logs da plataforma na janela: 17 requisições (todas as minhas), status na contagem esperada, **nenhum 5xx**, nenhum
erro de boot (`booted` 26–48 ms). Não houve tráfego real de paciente na janela ⇒ "sem regressão com tráfego real" ainda
**não observado**; só o smoke acima.

## Ainda NÃO provado (depende do Gabriel na interface do n8n — não feito, pois o n8n não devia ser alterado)
Que a credencial do n8n `Iris Nova Pos-Consulta (chamada interna)` tem o mesmo valor do secret. O segredo do cofre foi
validado contra o secret (digest e smoke S5–S8), mas o valor **dentro da credencial do n8n** só se prova executando o
node `confirmar` do Iris Oficial uma vez, com dados falsos, e vendo resposta diferente de 401 (esperado: 403
`instancia_nao_autorizada` ou 400).

### Atualização — teste da credencial do n8n (2026-09-22, autorizado pelo Gabriel; feito por ele na interface)
- Método: o node `Chamar iris-nova-pos-consulta (confirmar)` foi **copiado** (com a credencial já ligada) para um workflow
  **descartável** (`j7FQNJIoh24Ajtbh`, nunca publicado, sem gatilho, sem entrada conectada). O Iris Oficial não foi
  aberto para edição nem executado. Só o corpo foi trocado por dados falsos (instância inexistente, `agendamento_id`
  e `claim_token` zerados) e o node executado uma vez ("Executar etapa").
- **Resultado: 403 `{"erro":"instancia_nao_autorizada"}`** ⇒ o n8n enviou o JWT **e** o segredo certo (senão seria 401);
  passou da autenticação e da validação, e parou no gate de instância, antes de qualquer acesso ao banco.
- Servidor (logs, só leitura): 1 requisição `POST` de `axios` (n8n) à `iris-nova-pos-consulta`, status 403.
  `pos_consulta_jornadas`: **0 linhas** (0 abertas) depois do teste. Nenhuma chamada à Evolution/OpenAI/WhatsApp.
- Workflow descartável **arquivado e excluído pelo Gabriel**; conferido por GET: some da listagem (39 workflows) e
  `GET workflows/j7FQNJIoh24Ajtbh` → 404. Iris Oficial (ativo, estrutura idêntica ao export pós-P1, mesmo `versionId`),
  legado Google (inativo, idêntico ao P0) e Disparo A (inativo, idêntico ao P0, **0 execuções**) inalterados.
  Última execução do Iris Oficial: 2026-09-20T16:49Z (nenhuma desde então).
- **P4 concluído.**

## Rollback (não ensaiado)
- `iris-nova-mensagem`: redeploy dos arquivos de `backups/pre-aplicacao-pos-consulta-2026-09-20/iris-nova-mensagem-v118/`
  (76 arquivos; bundle de referência `9bd73dde…`), `verify_jwt: true`, sem `--prune`, conferindo depois arquivo a
  arquivo (o hash do bundle pode não reproduzir exatamente). Procedimento base: `backups/rollback-iris-nova-mensagem-v117/ROLLBACK.md`.
- `iris-nova-pos-consulta`: redeploy de `…/iris-nova-pos-consulta-v1/` (17 arquivos). ⚠ A v1 **não tem** autenticação
  interna (só JWT/publishable key): preferir, se possível, deixar a função nova e desligar o consumo no n8n.
- O rollback do banco (P3) só depois de as funções voltarem às versões anteriores.

## Estado
Banco: 3 migrations aplicadas; tabela vazia. Edge Functions: novas versões vivas. n8n: **sem alteração no P4**; Disparo A
inativo, gatilho desabilitado, legado Google inativo. Nenhuma mensagem enviada. O token do Supabase do cofre não é mais
necessário para o P5; pode ser revogado (o P6 pode usar as ferramentas MCP).
