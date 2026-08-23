# RPCs públicas — estado de segurança

Levantado em 2026-08-20, com consulta ao banco operacional
(`udizowyfjnhuhgxkeayk`) e revisão do Codex. **Reconferido em 2026-08-22**
(consulta direta às ACLs do banco + teste real de leitura como `anon`) — este
documento estava desatualizado e foi corrigido.

> **Atualização final de 22/08:** a RPC
> `buscar_agendamentos_confirmados_dentista_dia` foi fechada depois de nova
> auditoria confirmar zero dentistas com `token_acesso`, o único workflow
> consumidor desativado e nenhum outro workflow referenciando a função.
> `PUBLIC`, `anon` e `authenticated` perderam `EXECUTE`; `service_role` foi
> preservada. Migration:
> `20260822230000_revoga_buscar_agendamentos_dentista_dia.sql`.
> A seção 2 abaixo permanece como histórico do diagnóstico anterior.

---

## Estado das três funções `SECURITY DEFINER` públicas (reconferido 22/08)

| Função | Estado | Risco |
|---|---|---|
| `iris_nova_tratamentos_aprovados` | ✅ **CORRIGIDA** (20/08) | — |
| `atualizar_cor_dentista` | ✅ **CORRIGIDA** (21/08, commit `47ae6c1`) | — |
| `buscar_agendamentos_confirmados_dentista_dia` | ✅ **CORRIGIDA** (22/08) | — |

**Verificado em 22/08 (`pg_proc` + ACL real, não presumido do código):**
`atualizar_cor_dentista` hoje só concede `EXECUTE` a `service_role` — a
correção proposta nas seções abaixo foi de fato aplicada, não só escrita no
commit. `buscar_agendamentos_confirmados_dentista_dia` também ficou restrita
a `service_role` depois da auditoria final e do teste HTTP real.

---

## 1. `atualizar_cor_dentista` — CORRIGIDA (21/08, commit `47ae6c1`)

**Histórico preservado abaixo** (a análise que levou à correção). ACL real,
confirmada em 22/08: `EXECUTE` só para `service_role` — `anon` e
`authenticated` não têm mais acesso.

### O que era

`SECURITY DEFINER`, faz `UPDATE clinicas`. Chamada **direto do navegador**
(`src/app/dashboard/calendario/page.tsx:415`) com a chave pública
(`SUPABASE_KEY`), enviando `{p_clinica_id, p_token_acesso, p_cor}`.

### ACL atual — registrar antes de qualquer mudança

```
atualizar_cor_dentista(uuid,text,text)
  =X/postgres | postgres=X | service_role=X | anon=X | authenticated=X
```

`anon` e `authenticated` são **grants explícitos** (não herdados). Qualquer
rollback precisa restaurá-los.

### A vulnerabilidade

A função aceita três credenciais alternativas:

```sql
v_elem->>'id' = v_chave
OR v_elem->>'token_acesso' = v_chave
OR ('nome:' || lower(v_elem->>'nome')) = lower(v_chave)
```

**Nenhuma das três é segredo.** O `id` do dentista chega ao navegador dentro
de `clinica.dentistas` e é legível em qualquer DevTools; o nome é público por
definição.

Resultado: quem tiver a chave pública do Supabase (embutida no bundle),
`clinica_id` e `dentista_id` consegue **escrever** em `clinicas`.

### Correção parcial que foi PROPOSTA E REJEITADA

Cheguei a propor remover só o ramo `nome:`, apoiado em duas verificações
corretas — os 12 dentistas cadastrados têm `id` e nenhum tem `token_acesso`,
então o painel sempre envia `id`, e remover `nome:` não quebraria nada.

**O Codex apontou o erro, e ele está certo:** o `id` também funciona como
senha e também está exposto ao navegador. Remover `nome:` troca uma credencial
pública por outra — reduz superfície, não fecha a escrita não autorizada.

Classificação correta:

- remover `nome:` → **endurecimento parcial**, nunca "correção"
- manter autorização por UUID → **o bloqueador permanece**

### Correção efetiva

Duas partes, nesta ordem:

1. mover a chamada para uma rota `/api/secure/` (servidor, `service_role`),
   como já fazem `plano-tratamento` e `avisar-tratamentos`;
2. **só então** `revoke execute ... from public, anon, authenticated`.

Inverter a ordem derruba o seletor de cor do calendário.

### Alcance hoje

2 clínicas, 12 dentistas — todas de teste. O dano possível é cor de
calendário, não dado clínico. **Mas é escrita pública em `clinicas`**, e o
padrão não pode existir num produto multiclínica.

---

## 2. `buscar_agendamentos_confirmados_dentista_dia` — CORRIGIDA (22/08)

### O que devolve

Nome, telefone, procedimento e horário dos pacientes de um dentista num dia.
**Dado pessoal de paciente.**

Exige `token_acesso` do dentista — sem os atalhos por `id` ou nome. É mais
protegida que a função 1.

### ACL anterior

```
buscar_agendamentos_confirmados_dentista_dia(uuid,date,text)
  =X/postgres | postgres=X | service_role=X
```

Só o `PUBLIC` herdado (o `=X` inicial), sem grants explícitos — mesmo caso da
função que foi corrigida hoje. Rollback = devolver `EXECUTE` a `PUBLIC`.

### Por que não foi revogada inicialmente

Cheguei a considerar seguro revogar, porque nenhum arquivo de código a chama
(só aparece em `database.types.ts`, que é gerado automaticamente).

**Uma busca ampla encontrou o consumidor** em
`cappia-estado/HANDOFF-agenda-cappia.md:24`:

> **Building block pronto:** RPC `buscar_agendamentos_confirmados_dentista_dia`
> (workflow `l6pNUaIccr2h4Gid`)

**Um workflow do n8n usa a função.** Nenhum `grep` no disco acharia — o n8n
vive num servidor. Revogar às cegas poderia derrubar um fluxo da agenda em
produção.

### Encerramento

Uma nova inspeção read-only confirmou:

- `l6pNUaIccr2h4Gid` está desativado;
- ele é o único workflow que referencia a RPC;
- zero dos 12 dentistas possui `token_acesso`.

O `EXECUTE` de `PUBLIC`, `anon` e `authenticated` foi revogado, preservando
`service_role`. Teste HTTP: chave pública recebe `401`; `service_role` recebe
`200`. Nenhum workflow foi executado, editado ou ativado.

---

## Lição que vale para as três

`grant execute ... to service_role` **não restringe — só adiciona**. Toda
função nasce com `PUBLIC` liberado, e `create or replace` **restaura** esse
padrão, desfazendo qualquer `revoke` anterior em silêncio.

Foi assim que `iris_nova_tratamentos_aprovados` amanheceu aberta mesmo tendo o
`revoke` escrito na migration desde 18/08: as recriações de 19/08 o desfizeram
sem aviso.

**Regra:** o `revoke` tem de rodar na mesma transação de cada `create or
replace`, e a ACL precisa ser conferida no banco depois — nunca presumida a
partir do arquivo.

---

## 3. RLS ligado sem política nas 24 tabelas — NÃO é exposição (confirmado 22/08)

Registro anterior (20/08) descrevia "22 tabelas com RLS ligado e nenhuma
política" como parte do que bloqueava venda, ao lado das RPCs abertas. Isso
estava certo tecnicamente sobre a *contagem*, mas **errado sobre a
gravidade** — RLS ligado sem nenhuma política é o padrão **mais restritivo**
do Postgres, não o mais aberto: sem política nenhuma, a ausência de política
já nega qualquer linha por padrão, mesmo quando a tabela tem `GRANT` para
`anon`/`authenticated`.

**Testado de verdade em 22/08**, não presumido: `set role anon; select
count(*) from pacientes;` devolveu `0`, mesmo havendo linha real na tabela.
`GRANT SELECT` para `anon` existe em `pacientes`, `agendamentos`, `usuarios`,
`clinicas`, `planos_tratamento` — mas o RLS sem política bloqueia a leitura
de qualquer forma.

**Contagem atual: 24 tabelas** (recontado em 22/08, não 22) com RLS ligado e
zero políticas: `acoes_outbox`, `acoes_pendentes`, `agendamentos`,
`clinicas`, `comandos_remarcacao`, `conversas_manuais`, `estado_conversa`,
`financeiro_lancamentos`, `financeiro_orcamento_itens`,
`financeiro_orcamentos`, `horarios_bloqueados`, `lembretes_envios`,
`mensagens_fila`, `mensagens_manuais`, `odontograma_consultas`,
`odontograma_dentes`, `odontograma_observacoes`, `odontograma_periodontal`,
`pacientes`, `password_resets`, `planos_tratamento`, `remarcacoes_pendentes`,
`usuarios`, `whatsapp_presenca`.

**Isto NÃO é um convite a ignorar o assunto.** Continua sendo um estado
frágil por dois motivos reais:

- `service_role` **ignora RLS por completo** — qualquer código que rode com
  a chave de serviço (Edge Functions, rotas `/api/secure/`) já tem acesso
  total, independente de política. O RLS só protege contra acesso via
  `anon`/`authenticated` (navegador com chave pública).
- Ausência de política é frágil a mudança futura: se alguém um dia criar uma
  política permissiva por engano numa dessas tabelas, ou desligar RLS
  "temporariamente" para debug, a exposição vira real sem nenhum aviso — o
  mesmo padrão de risco silencioso que já aconteceu com `revoke` desfeito em
  `create or replace` (seção acima). O ideal de produto ainda é ter políticas
  explícitas (nunca depender só da ausência delas), mas isso é dívida
  técnica a resolver com calma, não bloqueador de venda.

**Reclassificação:** isto não bloqueia venda. A RPC antes citada como
bloqueador foi fechada em 22/08; não resta bloqueador confirmado neste
levantamento específico.
