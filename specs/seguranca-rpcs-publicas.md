# RPCs públicas — estado de segurança

Levantado em 2026-08-20, com consulta ao banco operacional
(`udizowyfjnhuhgxkeayk`) e revisão do Codex.

**Nenhuma das duas vulnerabilidades abaixo está corrigida.** Este documento
existe para que isso não seja confundido com trabalho concluído.

---

## Estado das três funções `SECURITY DEFINER` públicas

| Função | Estado | Risco |
|---|---|---|
| `iris_nova_tratamentos_aprovados` | ✅ **CORRIGIDA** (20/08) | — |
| `atualizar_cor_dentista` | 🔴 **ABERTA** | escrita não autorizada |
| `buscar_agendamentos_confirmados_dentista_dia` | 🟡 **em auditoria** | leitura de dado de paciente |

---

## 1. `atualizar_cor_dentista` — ABERTA

### O que é

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

## 2. `buscar_agendamentos_confirmados_dentista_dia` — EM AUDITORIA

### O que devolve

Nome, telefone, procedimento e horário dos pacientes de um dentista num dia.
**Dado pessoal de paciente.**

Exige `token_acesso` do dentista — sem os atalhos por `id` ou nome. É mais
protegida que a função 1.

### ACL atual

```
buscar_agendamentos_confirmados_dentista_dia(uuid,date,text)
  =X/postgres | postgres=X | service_role=X
```

Só o `PUBLIC` herdado (o `=X` inicial), sem grants explícitos — mesmo caso da
função que foi corrigida hoje. Rollback = devolver `EXECUTE` a `PUBLIC`.

### Por que NÃO foi revogada

Cheguei a considerar seguro revogar, porque nenhum arquivo de código a chama
(só aparece em `database.types.ts`, que é gerado automaticamente).

**Uma busca ampla encontrou o consumidor** em
`cappia-estado/HANDOFF-agenda-cappia.md:24`:

> **Building block pronto:** RPC `buscar_agendamentos_confirmados_dentista_dia`
> (workflow `l6pNUaIccr2h4Gid`)

**Um workflow do n8n usa a função.** Nenhum `grep` no disco acharia — o n8n
vive num servidor. Revogar às cegas poderia derrubar um fluxo da agenda em
produção.

### Próximo passo

Inspeção **read-only** do n8n: confirmar se `l6pNUaIccr2h4Gid` está ativo e
qual chave/papel ele usa.

- usa `service_role` → o revoke é seguro
- usa a chave pública (`anon`) → o revoke quebra, e a correção passa a ser
  outra

Nenhuma execução, edição ou ativação de workflow.

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
