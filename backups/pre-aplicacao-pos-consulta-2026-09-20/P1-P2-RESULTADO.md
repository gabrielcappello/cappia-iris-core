# P1 e P2 — resultado

Autorizados pelo Gabriel, um a um. Nenhum valor secreto aparece neste registro nem em qualquer log da sessão.

## P1 — n8n primeiro (2026-09-21)

- **Segredo interno:** gerado localmente (48 caracteres base64url, 36 bytes aleatórios = 288 bits), gravado só em
  `~/.iris-secrets/pos-consulta-interno.env` (permissão restrita ao usuário). Impressão digital (6 hex do SHA-256):
  `0ee9b9`. O arquivo temporário de colagem do JSON da credencial foi **removido do cofre** após o uso.
- **Credencial n8n** `Iris Nova Pos-Consulta (chamada interna)` (Custom Auth, projeto Personal, domínio permitido
  `udizowyfjnhuhgxkeayk.supabase.co`), criada pelo Gabriel pela interface. Uma duplicata sem uso foi apagada por ele;
  a que está em uso (1 uso) foi preservada.
- **Iris Oficial** publicado (versão `3bb7b9f7-54fa-4533-b333-72ddf6587ddc`, ativa). Conferido por GET contra o
  export do P0: **só o node `Chamar iris-nova-pos-consulta (confirmar)` mudou** (23 nodes; conexões e settings
  idênticos): `genericAuthType = httpCustomAuth`, credencial com o nome exato, `retryOnFail = true`,
  `waitBetweenTries = 2000`. `maxTries` não aparece porque o n8n só grava o valor quando difere do padrão, que é 3.
- Ressalva inerte: o node ainda guarda a referência à credencial antiga `httpHeaderAuth`; a chamada só usa a do tipo
  `httpCustomAuth`.
- Legado e Disparo A: inalterados e inativos. Export pós-P1 com hash em `n8n/…DEPOIS-P1.json`.
- **Ainda não exercitado:** nenhuma execução do Iris Oficial desde a publicação. A prova de que o segredo está certo
  é no P4 (executar o node uma vez com dados falsos: resposta diferente de 401).

## P2 — secret da Edge Function (2026-09-21)

- Baseline (leitura): 10 secrets; `POS_CONSULTA_SEGREDO_INTERNO` **ausente**.
- Definido **só esse secret** (`POST /secrets` com um item, HTTP 201). Depois: **11 secrets**; o secret existe; o
  **digest SHA-256 confere com o valor do cofre**; os outros 10 nomes seguem os mesmos.
- Efeito imediato: **nenhum** — a `iris-nova-pos-consulta` viva (v1) e a `iris-nova-mensagem` (v118) não leem esse
  secret; ele só passa a valer no deploy do P4. Sem o secret a função nova falha fechado (500).
- **Rollback do P2:** remover o secret (a função nova volta a recusar tudo).

## Pendências para os próximos portões
- O token do Supabase salvo no cofre serve ao deploy do P4; **revogar depois do P4** (recomendado pelo Gabriel).
- O P3 (`db push`) precisa de uma **credencial de banco** (URL do pooler ou senha), por prompt oculto: o token de
  acesso não basta.
