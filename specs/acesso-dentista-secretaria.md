# Acesso do dentista e da secretária — registro e especificação

Levantado em 2026-08-20. **Nada foi implementado.** Painel, n8n e banco
permanecem intocados. Este documento existe para aprovação antes de qualquer
mudança.

---

## PARTE 1 — REGISTRO: o que está aberto hoje

### 1.1 🔴 O QR Code carrega a senha do dentista na URL

`src/app/dashboard/page.tsx:1445`:

```typescript
const qrUrl = `${origin}/dentista/${clinicaId}/${i}?t=${encodeURIComponent(d.senha || '')}`;
```

O mesmo vale para a secretária (linha 1316, com `token_acesso`).

**QR Code e senha são a mesma credencial.** Quem fotografar a tela, ler o
histórico do navegador, receber o link encaminhado ou olhar um log de servidor
tem a credencial permanente de acesso ao prontuário.

Agravante: a credencial é **reutilizável**. Uma foto do QR cria sessão nova
quantas vezes quiser, indefinidamente.

### 1.2 🔴 `/api/calendario` não valida sessão

`src/app/api/calendario/route.ts` — 47 linhas, lidas por inteiro:

```typescript
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const upstream = await fetch(N8N_URL, { method: "POST", body: rawBody });
  return new NextResponse(responseBody, { status: upstream.status });
}
```

Sem `resolverContexto`, sem cookie, sem verificação de perfil. Recebe o corpo
cru e repassa. **Qualquer pessoa que conheça a URL pode pedir a agenda de
qualquer clínica.**

### 1.3 🟡 Senhas fracas

Dr. Diego: 9 caracteres. Dr. Pablo: 6. Digitadas à mão, em campo chamado
"Senha de acesso". Insuficiente para proteger prontuário.

### 1.4 🟡 Bug que trava o app (o sintoma que revelou tudo)

O app do dentista mostra "token não configurado" porque:

| Onde | Campo |
|---|---|
| Painel grava | `senha` |
| `CalendarioDentista.tsx:104` lê | `token_acesso` |

**Não corrigir trocando um pelo outro.** `senha` é segredo (o servidor a
remove antes de mandar ao navegador — `api/access/professional/route.ts:29`);
`token_acesso` não é (a secretária precisa dele no cliente). Trocar exporia a
senha numa chamada pública. O bug se resolve junto com a mudança de mecanismo.

### 1.5 🔴 O app do dentista lê `agendamentos` direto do navegador

**Correção de um inventário anterior meu, que estava errado.** Eu havia
varrido por `rest/v1` e concluído que o app só usava `/api/calendario`. O
Codex apontou `CalendarioDentista.tsx:222`, verifiquei, e ele está certo:

```typescript
const [res, agsRaw] = await Promise.all([
  fetch("/api/calendario", { ... }),
  sb.query<Agendamento>("agendamentos",
    `?clinica_id=eq.${clinicaId}&data=gte.${inicio}&data=lte.${fim}`),  // ← direto
]);
```

O helper `sb` (`src/lib/supabase.ts:4`) usa `apikey: SUPABASE_KEY` — a chave
**pública** — e monta `${SUPABASE_URL}/rest/v1/${table}`. Minha busca não o
pegou porque a string `rest/v1` está no helper, não na chamada.

**Agravante:** `sb` não é só leitura. Expõe `query`, `update` (PATCH) e
`insert` (POST), todos com a chave pública, e é usado em todo o painel.

**Consequência real:** o filtro é `clinica_id=eq.{...}&data=...` — sem recorte
por dentista. O app baixa **os agendamentos de toda a clínica** e filtra no
navegador. Um dentista vê, no tráfego, os pacientes dos colegas.

### 1.6 Inventário (corrigido)

- **13 arquivos são rotas de servidor** (`/api/*`) — onde devem estar
- **Chamam do navegador:**
  - `components/CalendarioDentista.tsx:222` — `agendamentos` via `sb.query`
  - `dashboard/calendario/page.tsx` — RPC de cor
  - `components/ChatManualModal.tsx` — 4 chamadas
  - `onboarding/page.tsx`
  - `src/lib/supabase.ts` — o helper que serve todos os acima

`/api/odontograma` **valida sessão** (`resolverContexto`, linha 76). Falso
alarme.

**Lição:** inventário por string de URL não encontra acesso via helper. A
varredura correta parte do helper e busca seus usos.

### 1.7 O que já existe e será reaproveitado

- `criarProfSessionCookie(clinica_id, perfil, idx)` — cookie **assinado**, com
  expiração (`src/lib/session.ts:72`)
- `resolverContexto(cookie)` — devolve `clinica_id`, `perfil`, `idx`
- `/api/access/professional` — login já unificado para dentista e assistente
- O padrão `/api/secure/*` já em uso por `plano-tratamento`,
  `avisar-tratamentos`, `anamnese`, `horarios-bloqueados`

**Nada precisa ser inventado.** O mecanismo existe e é usado em outras rotas.

### ⛔ Enquanto isto não for corrigido

**Não distribuir QR Code de dentista ou secretária para clínica real.**

---

## PARTE 2 — DECISÃO: o n8n é indispensável neste fluxo?

**Sim. Deve permanecer.** Decisão fundamentada em inspeção read-only do
workflow `Painel — Buscar Calendário` (`OkR9CNW95wEPZ9cc`, ativo, 12 nós).

### O que ele realmente faz

Não é repasse. Os nós:

1. `Buscar Config Clínica` → Supabase (dentistas, fuso)
2. `Preparar Contexto` → resolve janela de tempo e fuso
3. `Buscar Eventos Google` → **Google Calendar API**
4. `Montar Eventos` → normaliza e devolve

### A razão que decide

O nó do Google usa a credencial **`Google Service Account account 2`**, que
existe **apenas dentro do n8n**.

Remover o n8n deste fluxo exigiria:

- mover a Service Account do Google para variável de ambiente da Vercel;
- reimplementar OAuth, refresh de token e chamada da Calendar API em
  TypeScript;
- replicar a normalização de eventos e o tratamento de fuso;
- e o painel **perderia** os eventos do Google — que é metade do que o
  calendário do dentista mostra.

Isso é uma migração de integração, não uma correção de segurança. Misturar as
duas coisas aumenta o risco sem reduzir a exposição.

### Consequência para a spec

O n8n fica. O que muda é **quem pode chamá-lo**: hoje qualquer um; depois,
apenas o servidor, com sessão validada.

---

## PARTE 3 — ESPECIFICAÇÃO (o menor caminho seguro)

### Princípio

Nenhuma credencial — senha, `token_acesso` ou UUID — em URL, QR ou chamada
originada do navegador. A sessão vive só no cookie `HttpOnly` assinado.

### F1. Token de uso único, guardado como hash

- O painel gera 32 bytes aleatórios. **O banco guarda apenas
  `sha256(token)`** — nunca o valor. Quem lê o banco não consegue entrar.
- Campos: `access_token_hash`, `access_token_criado_em`,
  `access_token_usado_em`, `sessao_valida_desde`.
- QR/link carrega o token **no fragmento**:
  `/dentista/{clinicaId}/{dentistaId}#t={token}`

  *Fragmento e não query:* o que vem depois de `#` **não é enviado ao
  servidor** — não entra em log de acesso, nem em header `Referer`, nem em
  proxy. Com `?t=`, a credencial aparece no log de toda máquina do caminho.

- **Consumo atômico**, numa única instrução SQL:

  ```sql
  update ... set access_token_usado_em = now()
   where access_token_hash = $1 and access_token_usado_em is null
  returning ...
  ```

  Só a primeira requisição recebe linha; a segunda recebe zero e é recusada.
  Validar e depois marcar, em passos separados, permite que dois pedidos
  simultâneos passem — foi o bloqueador nº 3.

- **Novo aparelho exige novo QR.**
- `senha` e `token_acesso` **são removidos** do fluxo — não substituídos por
  valor mais forte (ver F6).

### F2. Troca por cookie, com identidade estável e revogação real

- `/api/access/professional` recebe o token, consome atomicamente (F1), cria o
  cookie e responde.
- O cliente remove o fragmento com `history.replaceState` **imediatamente**.
- Mesmo mecanismo para dentista e secretária — sem caminhos paralelos.

**O cookie deixa de guardar `idx`.** Hoje `criarProfSessionCookie` grava a
**posição no array** (`clinicas.dentistas[idx]`). Se um dentista for removido
do meio da lista, o cookie de quem vinha depois passa a apontar para outra
pessoa — acesso ao prontuário errado, sem nenhum erro visível.

**Estado real, verificado no banco em 20/08:**

| | Tem `id` estável? |
|---|---|
| 12 dentistas | ✅ sim, todos |
| 2 assistentes (ClearDent) | ❌ **não** — campos: `ativo`, `nome`, `permissoes`, `telefone`, `token_acesso` |

O Codex pediu esta confirmação e ela mudou o desenho: **as assistentes não têm
identificador estável**. Migrar só os dentistas deixaria a secretária com o
mesmo defeito posicional.

**F2a — pré-requisito:** gerar `id` (uuid) para cada assistente existente,
numa migração idempotente, **antes** de o cookie deixar de usar `idx`. Sem
isso, `profissional_id` não tem o que gravar para esse perfil.

Depois disso, o cookie grava `profissional_id` e a resolução procura por `id`,
nunca por posição.

**Revogação precisa derrubar sessões já emitidas.** Hoje o cookie é assinado e
vale até expirar — revogar o QR não fecha quem já entrou. Solução: campo
`sessao_valida_desde` no profissional; o cookie carrega seu `emitido_em`, e
`resolverContexto` recusa cookie anterior a esse marco. Revogar = gravar
`now()`. Uma escrita derruba todas as sessões daquele profissional.

### F3. `/api/calendario` com sessão e autorização por perfil

- Passa a chamar `resolverContexto(cookie)`; sem sessão → **401**.
- O `clinica_id` vem **do cookie**, nunca do corpo da requisição.
- Autorização por perfil, no servidor:
  - **dentista** → só a própria agenda (`profissional_id` do cookie, nunca
    `idx` — ver F2);
  - **secretária** → os dentistas da própria clínica;
  - **dono** → toda a clínica.
- Renomear para `/api/secure/calendario`, alinhando ao padrão existente.

**O webhook do n8n precisa de segredo próprio.** Autenticar a rota não impede
que alguém chame o webhook diretamente — ele continua público na internet, e
"quem normalmente chama" não é controle de acesso. O nó `Webhook` do workflow
passa a exigir um header secreto (Header Auth), guardado em
`.iris-secrets` e enviado só pelo servidor. Sem ele, o n8n recusa.

Isso é alteração no n8n e entra na mesma janela de F5.

### F3b. Tirar `agendamentos` do navegador

A leitura de `CalendarioDentista.tsx:222` passa para o servidor — via
`/api/secure/calendario`, que já terá a sessão. O `clinica_id` vem do cookie,
e **o recorte por dentista é aplicado no servidor**: hoje o app baixa a
clínica inteira e filtra no cliente, o que expõe pacientes de colegas no
tráfego.

Sem isto, F1–F3 protegem a porta da frente e deixam a janela aberta: a chave
pública continuaria lendo `agendamentos` de qualquer clínica.

### F4. Corrigir o bug do app

`CalendarioDentista.tsx:104` deixa de ler credencial do objeto do dentista. A
identidade passa a vir do cookie, e a chamada não leva token nenhum.

### F5. Fechar as RPCs públicas — **por último**

Só depois de F1–F4 validados em produção:

- `atualizar_cor_dentista` → mover a chamada para `/api/secure/`, depois
  `revoke` de `public`, `anon`, `authenticated`.
- `buscar_agendamentos_confirmados_dentista_dia` → o workflow
  `l6pNUaIccr2h4Gid` está ativo e usa chave pública (testado em 20/08).

  ⚠️ **Não alterar `Header Auth account 2`.** Ela é compartilhada por ~56 nós
  (migração de 05–06/07, registrada no `ESTADO.md`). Trocar seu valor
  afetaria todos de uma vez.

  Ordem correta: **criar uma credencial nova e dedicada** com service_role →
  apontar só o nó desse workflow para ela → testar → só então revogar o
  acesso público da RPC. A `Header Auth account 2` fica intocada.

### F5b. Segredo do webhook, sem interrupção

O webhook do n8n é público. Protegê-lo exige ordem, porque servidor e n8n não
mudam no mesmo instante:

1. **criar** um endpoint novo no workflow, já exigindo o header secreto — o
   antigo continua no ar, sem interrupção;
2. **guardar** o segredo em `.iris-secrets` e na Vercel;
3. **apontar** `/api/secure/calendario` para o endpoint novo;
4. **testar** em produção (dentista e secretária, celular real);
5. **só então desativar** o endpoint antigo;
6. confirmar que nada quebrou por 24h antes de considerar fechado.

Inverter 3 e 5 derruba o calendário no intervalo entre os dois passos.

**Ordem inegociável.** Revogar antes de migrar derruba o seletor de cor e a
agenda em produção.

### F6. Remover o mecanismo antigo — em duas etapas, forward-only

Depois de F1, `senha` e `token_acesso` deixam de ser credencial. O certo é
**remover**, não gerar valores mais fortes: trocar por valores aleatórios
manteria dois caminhos de autenticação vivos, e o antigo continuaria
aceitando credencial em URL. Um mecanismo, não dois.

A remoção acontece em **duas etapas separadas no tempo**, e a distinção é o
que torna o rollback seguro.

#### F6a — desativar no código (reversível)

- retirar o ramo de autenticação por `senha` de `/api/access/professional`;
- retirar `token_acesso` como credencial da secretária;
- **os campos permanecem no banco, intocados.**

Nesta etapa nada é apagado. Se algo falhar, **rollback = voltar o código**
(`git revert` + redeploy) — os dados nunca saíram do lugar. É por isso que a
desativação vem antes da exclusão, e não junto.

#### Observação — encerra por critérios verificáveis, não por prazo

Não "uma semana". A etapa fecha quando **todos** forem verdadeiros:

1. **cobertura:** todo profissional ativo (12 dentistas + 2 assistentes)
   entrou ao menos uma vez pelo mecanismo novo — medido por
   `access_token_usado_em` preenchido;
2. **ausência de uso antigo:** zero autenticações pelo caminho antigo desde
   F6a — medido por contador nos logs da rota, não por suposição;
3. **zero incidentes:** nenhum relato de acesso perdido no período;
4. **cobertura dos dois perfis:** dentista **e** secretária, em celular real.

Se qualquer critério não for atingido, a etapa **não fecha** — investiga-se o
motivo. Prazo fixo esconderia justamente o caso raro (o profissional que
demora a trocar de aparelho) que a exclusão quebraria.

#### F6b — apagar, forward-only

Só depois dos quatro critérios:

```sql
-- forward-only: sem tabela de backup
update clinicas set dentistas = (...jsonb - 'senha'...);
update clinicas set assistentes = (...jsonb - 'token_acesso'...);
```

**Sem backup dessas credenciais.** Copiá-las para uma tabela nova
preservaria senhas fracas (6 e 9 caracteres) num lugar a mais — criaria uma
segunda cópia da vulnerabilidade em vez de eliminá-la, e alguém teria de
lembrar de destruí-la depois.

Não há rollback de F6b, **por desenho**: a essa altura os critérios provaram
que ninguém usa o mecanismo antigo, e o caminho de volta seria restaurar
exatamente aquilo que a etapa existe para remover. Se um profissional perder
acesso depois disso, a saída é gerar um QR novo — que é a operação normal do
mecanismo novo, não uma recuperação.

### Fora de escopo (registrado, não incluído)

- `ChatManualModal.tsx` e `onboarding/page.tsx` — outras chamadas diretas do
  navegador, fora do fluxo dentista/secretária.
- As 22 tabelas com RLS sem política — etapa própria.
- Migrar a integração do Google para fora do n8n — ver Parte 2.

### Rollback

**Correção de uma versão anterior desta spec, que dizia "F1–F4 são código:
`git revert`". Estava errado** — e o erro importava: `git revert` não
restaura dado apagado.

Três naturezas distintas:

**a) Código puro** — F3, F3b, F4. `git revert` + redeploy resolve.

**b) Banco, aditivo** — F1 (campos novos), F2a (`id` das assistentes).
Reversível sem perda: as colunas novas ficam ignoradas se o código voltar
atrás. Os campos antigos **continuam intactos** nesta fase.

**c) Desativação reversível** — F6a. O código para de aceitar o mecanismo
antigo, mas **os campos continuam no banco**. Rollback = `git revert` +
redeploy; nenhum dado saiu do lugar. É toda a razão de F6a existir separada.

**d) Banco, destrutivo** — F6b (apagar `senha` e `token_acesso`).
**`git revert` não recupera isto.** Regras:

- F6b **não roda junto** com F1–F4 nem com F6a.
- Só depois dos quatro critérios verificáveis de observação (ver F6) —
  **nunca por prazo decorrido**.
- **Forward-only, sem backup de credenciais.** Guardar senhas fracas numa
  tabela nova seria duplicar a vulnerabilidade, e alguém teria de lembrar de
  destruí-la.
- Não há caminho de volta, por desenho. Profissional sem acesso depois disso
  = gerar QR novo, que é a operação normal do mecanismo.

**e) ACLs de RPC** — F5. Registradas em `specs/seguranca-rpcs-publicas.md`;
restaurar é `grant execute ... to public` (e, para `atualizar_cor_dentista`,
também `anon` e `authenticated`, que são grants explícitos).

### Testes obrigatórios antes de considerar pronto

1. **A×B do mesmo QR:** duas requisições simultâneas com o mesmo token —
   exatamente uma cria sessão, a outra é recusada. É o teste que prova o
   consumo atômico de F1; sem ele, o "uso único" é intenção, não garantia.
2. **Revogação:** com sessão ativa, revogar no painel e confirmar que a
   próxima requisição recebe 401.
3. **Reordenação:** remover um dentista do meio da lista e confirmar que a
   sessão dos demais continua apontando para a pessoa certa. **Repetir com
   assistente** — é o perfil que hoje não tem `id` (ver F2a).
4. **Recorte por perfil:** dentista não recebe agendamento de colega — nem na
   tela, nem no tráfego de rede.

### Esforço

**Revisto para cima após a revisão do Codex:** cerca de **um dia**.

O que cresceu: hash e consumo atômico (F1), identidade estável e revogação de
sessão (F2), o segredo do webhook e a migração de `agendamentos` (F3/F3b), e
os quatro testes acima. F5 exige janela combinada, porque toca produção.

---

## Aprovação

Este documento não autoriza nada. Cada fase precisa de "pode aplicar"
explícito, e F5 exige janela combinada com o Gabriel.
