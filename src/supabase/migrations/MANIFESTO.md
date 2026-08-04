# Manifesto de migrations - Iris Nova

Artefato obrigatorio de `DA-P4-03`. Vincula cada versao aplicada no ambiente
remoto ao arquivo local correspondente e ao seu rollback.

Regras ja canonicas, apenas referenciadas: `docs/04-decisoes-canonicas.md`,
bloco `DA-P4-03`. Evidencia primaria das medicoes:
`reviews/da-p4-03-parecer-code.md`.

## Ambiente dev

- **Projeto:** `cappia-iris-core-dev`
- **project_ref:** `bcmuqautblvjdqzhjfbw`

### Migrations legadas

| # | Versao remota | Nome remoto | Arquivo local | SHA-256 local | SHA-256 remoto (`statements[1]`) | Hash executavel normalizado | Comparacao |
|---|---|---|---|---|---|---|---|
| 1 | `20260729033207` | `iris_nova_identificacao_v1` | `20260729_iris_nova_identificacao_v1.sql` | `9d0f2292d244f51fc10af5178eb6ecb10222cc7c509bc1d6e85361fdb7c4be0f` | `12516d9c8995e4a09c32f9dc0e82993ce65c04aeda4312a133367de3205aad5b` | `207a5d47a3bc24a22cecda16948553ddff38575e89410ef2ecfeef6d2e8d4476` | **equivalente** |
| 2 | `20260729113821` | `iris_nova_identificacao_v1_correcao` | `20260729_iris_nova_identificacao_v1_correcao.sql` | `c12ca12796258b2b770c399ba7c2decb5bc657764c444e0f2dd3927725d36ee1` | `39f088a176498fb5daa6c9943ed26b9db96df4c611a2f4e1a63a31d55f707a77` | `bbd73fba9a430544f1a2730ba3a597e3d2292eb28ff4047ef75b3f9cfd8665ad` | **equivalente** |
| 3 | `20260731164424` | `iris_nova_interpretacao_v1` | `20260730_iris_nova_interpretacao_v1.sql` | `f0a9c8572d78f4791bbbaada868fd03adc6d69dc961fdabe58bd445ab6a7710d` | `0637046c85ab15beeb249a8ed29dd284ad9a2eb49707d5c36af7c1553fd52155` | `2b3d632e8090bf7c4167d37dce7f5aaa9bd7e0eb86f6a9318ae1da01de85c29b` | **equivalente** |

**Resultado da comparacao:** nas tres, o hash executavel normalizado e
identico entre local e remoto, calculado de forma independente nos dois
lados. O SHA-256 bruto difere legitimamente porque o arquivo local contem
comentarios e formatacao nao executavel que nao chegam a
`supabase_migrations.schema_migrations.statements`.

**Nota de medicao (`20260731164424`):** `length(statements[1]) = 12081`
caracteres e `octet_length(statements[1]) = 12091` bytes UTF-8 - o mesmo
texto, duas medidas distintas, diferenca explicada por caracteres multibyte.
Nunca fundir as duas.

### Rollbacks associados

| # | Versao remota | Arquivo de rollback | SHA-256 do rollback |
|---|---|---|---|
| 1 | `20260729033207` | `20260729_iris_nova_identificacao_v1_rollback.sql` | `d22b0d247b02a542a5a60d752fa591d62e361c1d300b9a6701aa6f7cd995b19a` |
| 2 | `20260729113821` | `20260729_iris_nova_identificacao_v1_correcao_rollback.sql` | `7fdfe388ce596ecebf0303bb88af4fadd872cdabfab360f34b452b366acd51b7` |
| 3 | `20260731164424` | `20260730_iris_nova_interpretacao_v1_rollback.sql` | `f1219ff412b2a03d8bc2abeb016b3ff92415590973231b885383085cbc464b99` |

Rollbacks nunca sao migrations de avanco e nunca entram no fluxo de
migrations (`DA-P4-03`).

### Objetos materializados verificados

Preflight read-only (CODE 271, reconfirmado em CODE 285 e CODE 338), via MCP
local `supabase` sobre `bcmuqautblvjdqzhjfbw`:

- **`20260731164424`** - aplicada e materializada: as tres colunas de
  `public.mensagens_recebidas` (`claim_token`, `lease_expira_em`,
  `interpretacao_persistida_em`) e as duas funcoes
  (`public.reivindicar_mensagem`, `public.aplicar_interpretacao_condicional`),
  ambas `SECURITY INVOKER`, `search_path = public, pg_temp`, owner
  `postgres`, `EXECUTE` para `service_role`. Corpo conferido contra o arquivo
  versionado; grants batendo com o versionado.
- **`20260729033207` e `20260729113821`** - materializadas nas estruturas de
  identificacao (`clinicas`, `pacientes`, `estado_conversa`,
  `mensagens_recebidas`), incluindo
  `clinicas_provider_instancia_key`,
  `clinicas_id_provider_instancia_key`,
  `pacientes_id_clinica_telefone_key` e
  `mensagens_provider_instancia_message_key`.
- Nenhum objeto desconhecido, nenhuma autoridade paralela, nenhuma tabela de
  `P4I` presente.

**Mecanismo historico exato de aplicacao das tres:** indeterminado, nunca
afirmado como Dashboard, Management API ou CLI (`DA-P4-03`).

## Pendente de aplicacao

`20260804001104_iris_nova_p4i_estrutural_v1.sql` - etapa A1 de `P4I`,
estrutura apenas. Escrita e **nao aplicada**. Rollback correspondente em
`src/supabase/rollbacks/`. Esta secao so recebe version, hashes e objetos
materializados **depois** da aplicacao real, nunca antes.
