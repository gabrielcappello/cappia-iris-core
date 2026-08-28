# Contatos que a Iris não responde — especificação

Levantado em 2026-08-28, aprovado pelo Gabriel na mesma data. Implementação
em curso: banco (local, sem aplicar), painel, proxy. Fora de escopo desta
etapa: n8n (Codex integra a segunda checagem no workflow "Iris Oficial"
depois da aprovação) e deploy/push/migration aplicada.

## Objetivo

Dar à clínica uma lista permanente de números de WhatsApp que a Iris nunca
responde automaticamente — para amigos, familiares, ou pacientes que a
clínica prefere atender pessoalmente. Diferente do botão "Assumir
conversa" (`ChatManualModal.tsx`), que é uma pausa pontual por sessão, essa
lista fica ativa até alguém desmarcar.

## Mecanismo (decisão do Gabriel)

Mesmo mecanismo que já existe hoje para "conversa manual assumida" —
quando um número está ativo na lista, o efeito é o mesmo de ter clicado
"Assumir conversa": a Iris não responde nada, nem uma mensagem de aviso.
Não é uma tabela nova de propósito diferente; é uma segunda forma de
alcançar o mesmo estado.

**Ordem de checagem no workflow "Iris Oficial" (a ser integrada pelo
Codex, fora desta etapa):**
1. Conversa manual assumida (`conversas_manuais.ativo = true`) → salvar a
   mensagem em `mensagens_manuais`, encerrar sem chamar a Iris.
2. Telefone ativo em `contatos_excecao_iris` → encerrar sem chamar a Iris,
   silenciosamente (sem gravar em `mensagens_manuais` — essa tabela é só
   para o chat manual do painel).
3. Nenhum dos dois → chamar a Iris normalmente.

A clínica continua podendo assumir manualmente a conversa de um contato
que está na lista de exceções — os dois mecanismos coexistem, não se
excluem.

## Modelo de dados

Tabela nova `contatos_excecao_iris` (migration
`20260828120000_contatos_excecao_iris.sql`, **não aplicada** nesta etapa):

```sql
create table public.contatos_excecao_iris (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references public.clinicas(id) on delete cascade,
  nome text not null,
  telefone_normalizado text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (clinica_id, telefone_normalizado)
);
```

**Sem `paciente_id` (decisão do Gabriel, corrigindo a v1 desta spec):** se
o telefone digitado corresponder a um paciente já cadastrado, a tela só
usa o **nome** encontrado para pré-preencher o formulário — não persiste
vínculo com `pacientes.id`. Motivo: nenhum consumidor precisa desse
vínculo hoje, e guardar FK pra paciente é risco multiclínica desnecessário
se a tabela algum dia for exposta por engano (mesmo raciocínio já aplicado
a `conversas_manuais` em `20260821200000_fecha_chat_manual.sql`).

**Normalização de telefone:** reaproveita `normalizarTelefone(raw,
paisCodigo)` de `iris-portal-v2/src/lib/importacao-pacientes.ts:127` —
mesma função que a importação de pacientes já usa, retorna `.e164` no
mesmo formato que `pacientes.telefone_normalizado` grava. Não inventa
normalização nova nem prefixo fixo "55".

**RLS:** fechada por padrão (ausência de política nega), só `service_role`
tem acesso — mesmo padrão de `conversas_manuais`.

## Painel (`iris-portal-v2`)

### Aba nova

`dashboard/layout.tsx` ganha uma aba **"Exceções"**, mesmo padrão visual
das outras (`nav.tab_*`).

### Tela `dashboard/excecoes/page.tsx`

- Título: **"Contatos que a Iris não vai responder"**, com ícone de
  interrogação/informação (tooltip): *"A Iris não responderá nenhuma
  pessoa que esteja nesta lista. Ideal para pessoas amigas, familiares, ou
  pessoas que vocês mesmos desejam atender pessoalmente."*
- Botão **"+ Adicionar"** abre formulário com busca — mesmo padrão da
  busca em `dashboard/pacientes/page.tsx` (filtro client-side sobre
  `pacientes` já carregados, por nome/telefone/documento):
  - Se a busca casar com um paciente existente, ao selecioná-lo o
    formulário pré-preenche nome e telefone a partir dele (sem gravar
    `paciente_id`, ver seção acima).
  - Se não casar com nada, os campos ficam livres para digitação manual —
    nome e telefone (com DDD, formato `21 xxxxxxxxx`).
- Cada linha salva mostra um botão verde de ativo/inativo — mesmo padrão
  visual de "Assumir conversa" / "Devolver para Iris" do
  `ChatManualModal.tsx` — e uma opção de remover (DELETE definitivo).
- Registro novo sempre nasce **ativo**.
- Unicidade por `(clinica_id, telefone_normalizado)` — tentar adicionar um
  telefone já presente na lista da mesma clínica é recusado com mensagem
  clara, não duplica linha.

### Proxy seguro

`contatos_excecao_iris` entra em `TABELAS_CLINICA` (GET/PATCH/POST
escopados por `clinica_id` do login) e em `TABELAS_DELETE` (DELETE
definitivo, mesmo padrão de `financeiro_orcamentos`) em
`src/app/api/secure/[table]/route.ts`.

## Fora de escopo nesta etapa

- Alterar o workflow "Iris Oficial" no n8n — o Gabriel já editou esse
  workflow e vai integrar a segunda checagem pessoalmente, para evitar
  duas edições paralelas no mesmo workflow de produção.
- Aplicar a migration no banco real.
- Deploy, push, ou qualquer publicação.
- Alterar `pacientes` ou o atendimento de qualquer telefone que não esteja
  na lista.

## Aprovação

Aprovado pelo Gabriel em 2026-08-28. Implementação local (migration não
aplicada, painel, proxy) para revisão do Codex antes de qualquer
deploy/migration/n8n.
