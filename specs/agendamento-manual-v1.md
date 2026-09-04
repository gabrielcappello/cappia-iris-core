# Agendamento manual pela clínica — especificação

Levantado em 2026-08-25.

**Status: implementado e em produção (`iris-portal-v2`, verificado em
2026-09-03).** Este documento passa a ser registro histórico das decisões
de design — não descreve mais um trabalho pendente. Ver "Estado real de
implementação" abaixo para o que mudou depois da revisão 5.

**Revisão 2 (2026-08-25):** a v1 foi revisada pelo Codex antes de qualquer
código ser escrito. Cinco pontos reais corrigidos.

**Revisão 3 (2026-08-25):** segunda revisão do Codex sobre a revisão 2.
Quatro pontos adicionais corrigidos.

**Revisão 4 (2026-08-25):** terceira revisão do Codex. Um bloqueador real
sobre a revisão 3 (a RPC de paciente escolhida faz upsert por telefone, não
criação) e uma correção textual.

**Revisão 5 (2026-08-25):** quarta revisão do Codex — três resíduos
textuais da revisão 4 (menções remanescentes a `cappia_persistir_paciente`
como caminho de criação) e uma correção real sobre como o PostgREST expõe
`unique_violation` (sem nome de constraint estruturado, então a mensagem de
erro não pode distinguir CPF de telefone sem parsing de texto). Nenhum
código foi alterado até agora, só o documento.

---

## Objetivo

Hoje o único caminho para criar um agendamento é a conversa com a Iris no
WhatsApp. A clínica (dono, dentista, secretária) precisa poder criar um
agendamento manualmente pelo painel, sem envolver a Iris — por exemplo
quando o paciente liga ou chega presencialmente.

## Onde entra

**Aba Calendário**, não a aba Agendamentos. Decisão do Gabriel: o calendário
já mostra ocupação por dentista/dia, então quem agenda vê contexto de
disponibilidade antes de escolher o horário — mesmo sem clicar num slot
específico da grade.

Botão **"Criar novo agendamento"** no rail lateral, **acima** do botão
"Bloquear horários" (mesmo estilo visual, mesma coluna; "Bloquear horários"
desce uma posição). Não há clique em slot vazio da grade nesta primeira
versão — meramente abrir o formulário pelo botão.

### Os três calendários não são o mesmo componente (correção da v1)

A v1 presumiu, a partir de ver `sb.criarBloqueio` usado em dois arquivos,
que existia um componente único compartilhado entre painel, dentista e
secretária. **Verificado como falso.** Existem três componentes
independentes:

| Interface | Arquivo | Tem "Bloquear horários" hoje? |
|---|---|---|
| Painel (dono) | `src/app/dashboard/calendario/page.tsx` | ✅ sim |
| App do dentista | `src/components/CalendarioDentista.tsx` | ✅ sim |
| App da secretária | `src/components/CalendarioClinica.tsx` | ❌ **não** |

`CalendarioClinica.tsx` é usado em
`src/app/assistente/[clinicaId]/[idx]/page.tsx` e não tem o botão de
bloqueio hoje, ao contrário do que a v1 afirmou. **O botão de agendamento
manual precisa ser adicionado explicitamente nos três arquivos**, não
apenas num só com a expectativa de que os outros dois herdem. A forma
correta de evitar implementação divergente é extrair o modal de
agendamento manual (formulário + chamada à rota) como um componente próprio
e importado nos três, não reescrever a lógica três vezes — mas a integração
em cada tela é um passo explícito do trabalho, verificado individualmente.

**Posição em `CalendarioClinica.tsx` (correção da revisão 3):** como esse
calendário não tem "Bloquear horários" hoje, "acima do botão de bloqueio"
não se aplica. Ali o botão "Criar novo agendamento" entra na área superior
de ações do componente (mesma região onde os outros dois calendários têm
seus controles de topo — navegação, filtro de dentista), não numa posição
relativa a um botão que não existe.

## Fluxo do formulário

Ordem definida pelo Gabriel:

1. **Paciente** — busca por nome ou CPF na lista de pacientes já cadastrados
   da clínica. A busca existe para não duplicar paciente. Quando não
   encontra ninguém, um botão **"Criar paciente"** abre o cadastro básico
   ali mesmo — nome completo, CPF, data de nascimento, **telefone
   (obrigatório)**. Cadastra e segue no mesmo fluxo, sem sair do modal.
2. **Dentista** — um `<select>` editável, com pré-seleção que depende de
   quem está logado:
   - **App do dentista**: nasce pré-selecionado com o próprio dentista
     logado — pode trocar para outro colega se quiser (ver Decisão de
     permissão abaixo — confirmado que essa troca é permitida).
   - **Painel/app da secretária**: **sem padrão** — o select começa vazio,
     escolha obrigatória antes de avançar.
3. **Procedimento** — filtrado pelos procedimentos habilitados para o
   dentista escolhido (`dentista.procedimentos`, mesma lista que a RPC usa
   para resolver duração).
4. **Dia e horário** — campos de data e hora livres (não pré-preenchidos por
   clique na grade). Ver validação de disponibilidade abaixo — o formulário
   não permite submeter fora da jornada, sobre um bloqueio, ou no passado;
   o backend é quem decide, o front só reflete o erro.
5. Confirmar.

## Banco: um único banco operacional (achado da v1, mantido)

`udizowyfjnhuhgxkeayk` é o único banco operacional real, compartilhado pela
Edge Function `iris-nova-mensagem` (WhatsApp) e pelo painel — não dois
bancos separados. Já tem `cappia_reservar_agendamento` nativa, auditada e
reaproveitada palavra por palavra em
`src/supabase/migrations/20260804150000_iris_nova_reaproveitamento_agendamento_v1.sql`.
A rota nova deve **chamar essa RPC**, não reimplementar resolução de
dentista/procedimento/duração em TypeScript.

## A RPC não cobre toda a disponibilidade (correção da v1 — bloqueador)

`cappia_reservar_agendamento`
(`src/supabase/migrations/20260804150000_..._v1.sql:389-408`) só verifica
conflito contra outro registro em `agendamentos` com `status = 'confirmado'`
usando `tsrange` overlap. Ela **não consulta**:

- `horarios_bloqueados` — um agendamento manual pode ser criado em cima de
  um bloqueio ativo;
- jornada do dentista (`dentista.inicio`/`fim`/`sabado`/`sab_ini`/`sab_fim`
  no jsonb `clinicas.dentistas`) — nada impede 3h da manhã ou domingo;
- se a data/hora já passou.

**Decisão do Gabriel (2026-08-25): respeitar tudo.** O agendamento manual
recusa data/hora fora da jornada do dentista, sobre um bloqueio ativo, ou no
passado — mesmo padrão de disponibilidade que a Iris já respeita na
conversa.

### Origem da lógica de disponibilidade (decisão pós-preflight, 2026-08-25)

`cappia-iris-core/src/core/carregar-disponibilidade.ts` +
`resolver-disponibilidade.ts` já implementam esta mesma regra por completo
— jornada semanal, intervalo de almoço (`alm_ini`/`alm_fim`), bloqueio
**geral da clínica** (`horarios_bloqueados.dentista_id is null`, que conta
mesmo quando a consulta filtra por dentista específico — achado do Codex
registrado no comentário de `buscarBloqueios`, linhas 280-297) e bloqueio
específico do dentista, tudo já com testes. Mas esse código roda como Edge
Function Deno no repositório `cappia-iris-core`; a rota nova roda em
Next.js/Vercel no `iris-portal-v2` — repositórios e runtimes diferentes,
sem import direto possível.

**Decisão do Gabriel:** reimplementar em TypeScript na rota do
`iris-portal-v2`, reproduzindo só as regras necessárias (duração, jornada,
almoço, bloqueio geral/específico, passado no fuso da clínica) — não
chamar nem alterar a Edge Function, não ampliar escopo. **Testes de
paridade obrigatórios** (ver seção Testes) comparando a nova implementação
contra os mesmos casos que os testes de `carregar-disponibilidade.test.ts`
e `resolver-disponibilidade.ts` já cobrem, para que as duas implementações
não divirjam silenciosamente com o tempo.

**Onde a validação entra:** na rota do servidor
(`/api/secure/agendamento-manual`, ver abaixo), **antes** de chamar a RPC —
não na RPC em si (não está no escopo desta spec alterar
`cappia_reservar_agendamento`, que é reaproveitada palavra por palavra e
também é chamada pela Iris; mudar seu contrato afetaria os dois
consumidores). A rota:

1. Resolve o dentista (`clinica.dentistas`, mesmo objeto que a UI já lê).
2. **Resolve a duração do procedimento pelas mesmas regras que a RPC usa**
   (mesma lógica de `cappia__resolver_duracao`: modo automático do
   dentista ou tempo do procedimento — reimplementada em TS na rota, espelho
   de `configuracoesDuracao` em `carregar-disponibilidade.ts:173-199`, já
   que a validação de disponibilidade precisa saber o **intervalo
   inteiro**, não só o instante inicial). **Correção da revisão 3 —
   bloqueador:** não basta checar se o horário inicial está livre; a rota
   valida `[início, início + duração)` contra jornada e bloqueio. Exemplo
   do Codex: um procedimento de 60 min às 17h30 não pode entrar se a
   jornada termina às 18h, mesmo que 17h30 esteja livre.
3. Confere se o intervalo inteiro cai dentro da jornada do dentista **e
   fora do intervalo de almoço** (`inicio`/`fim` no dia de semana,
   `sab_ini`/`sab_fim` se sábado e `sabado === true`, nunca domingo,
   `alm_ini`/`alm_fim` sempre indisponível quando presente — espelho de
   `construirJornadas` + `construirAlmoco`,
   `carregar-disponibilidade.ts:214-270`; mesma regra de jornada que
   `dashboard/calendario/page.tsx` já usa para `minTime`/`maxTime`, mas
   esta acrescenta o almoço, que a UI hoje não impõe como bloqueio).
4. Consulta `horarios_bloqueados` — **bloqueio específico do dentista E
   bloqueio geral da clínica** (`dentista_id is null`), as duas consultas,
   nunca só uma (mesmo filtro por `clinica_id` +
   `dentista_id` nulo-ou-igual + intervalo, molde de
   `src/app/api/secure/horarios-bloqueados/route.ts:119-136`) e recusa se o
   intervalo inteiro tem **qualquer sobreposição**, parcial ou total, com
   algum bloqueio ativo — não só o instante inicial.
5. Recusa se `data + horario` já é passado, **comparando no fuso da
   clínica** (`clinicas.fuso_horario`, o mesmo campo que
   `carregar-disponibilidade.ts:92` já usa para resolver disponibilidade do
   lado da Iris), não o relógio UTC do servidor (Vercel roda em UTC;
   comparar sem converter erraria a cada fuso que não é UTC). **Correção da
   revisão 3.**
6. Só então chama a RPC, que continua sendo a única responsável pela reserva
   e pelo conflito concorrente entre agendamentos (a trava
   `pg_advisory_xact_lock` dela é o que evita corrida de dois agendamentos
   simultâneos — isso a rota não reimplementa).

**Risco não-bloqueante aceito (Codex, revisão 3):** a checagem de
`horarios_bloqueados` no passo 4 não é atômica com a reserva — entre a
validação e a chamada da RPC, alguém poderia criar um bloqueio bem nesse
intervalo, e o agendamento passaria mesmo assim. Corrigir isso exigiria
mover a checagem para dentro de uma transação no banco (alterando ou
envolvendo `cappia_reservar_agendamento`), fora do escopo deste MVP.
Aceito como limitação conhecida — a janela de corrida é pequena (dois
usuários agindo no mesmo segundo sobre o mesmo dentista/horário) e o efeito
é um agendamento que a clínica só precisa remarcar, não uma falha de dados.

## Reaproveitamento: `cappia_reservar_agendamento`

Assinatura (schema nativo de `udizowyfjnhuhgxkeayk`):

```sql
cappia_reservar_agendamento(
  p_clinica_id uuid,
  p_data date,
  p_horario text,
  p_procedimento_id text,
  p_paciente_id uuid,
  p_dentista_id uuid default null,
  p_dentista_nome text default null,
  p_procedimento text default null,
  p_nome text default null,
  p_telefone text default null,
  p_documento text default null,
  p_tipo_documento text default null,
  p_event_id text default null,
  p_calendar_id text default null
) returns jsonb
```

Retorno: `{sucesso: true, agendamento_id, dentista_id, duracao_min, data,
horario}` ou `{sucesso: false, motivo}`.

**Erro técnico não vai para o cliente (correção — risco não-bloqueante da
v1, promovido a regra):** o caso `motivo: 'erro_insercao'` da RPC inclui
`detalhe: sqlerrm` — o texto cru do erro do Postgres. A rota nunca repassa
esse campo `detalhe` na resposta HTTP; loga no servidor (sem PII) e devolve
mensagem genérica ("Não foi possível criar o agendamento.") ao cliente.
Mesma disciplina que as outras rotas seguras já aplicam em log vs.
resposta.

**Só `service_role` tem `EXECUTE`** nessa função — a chamada tem que vir do
servidor, nunca do navegador.

## Rota nova: `/api/secure/agendamento-manual` (POST) — nome corrigido

**A v1 propôs `/api/secure/agendamentos`. Isso colide com a rota dinâmica
já existente e é um bloqueador real, não um detalhe.**

`src/app/api/secure/[table]/route.ts` já responde em
`/api/secure/agendamentos` para GET/PATCH/POST/DELETE — é o proxy genérico
escopado por clínica que `sb.query("agendamentos", ...)`,
`sb.update("agendamentos", ...)` etc. já usam
(`src/lib/supabase.ts:39-44`, tabela `agendamentos` está em
`SECURE_TABLES`). Next.js resolve uma rota estática
(`api/secure/agendamentos/route.ts`) antes da dinâmica
(`api/secure/[table]/route.ts`) para o mesmo caminho — criar a rota estática
faria ela prevalecer e, como só implementaria POST, os `GET`
`/api/secure/agendamentos` que o calendário e outras telas já fazem
passariam a receber 405. Isso quebraria leitura de agendamento em produção.

**Nome escolhido: `/api/secure/agendamento-manual`.** Sem colisão com
`[table]`, sem ambiguidade com o proxy genérico.

### Corpo da rota

Molde: `src/app/api/secure/agendamento-status/route.ts` (chama RPC,
`clinica_id` sempre do cookie) + `src/app/api/secure/horarios-bloqueados/route.ts`
(checagem de conflito antes de escrever, mensagens de erro de negócio).

1. **`resolverContextoVivo(cookie)`** (`src/lib/sessao-profissional.ts`) —
   sem sessão válida ou revogada, 401. Cobre a checagem de revogação para
   dentista **e** assistente num só lugar; correção textual da revisão 4 —
   as revisões anteriores citavam `resolverContexto` cru mais uma checagem
   específica de `sessaoAindaValida` só para dentista, mas
   `resolverContextoVivo` já faz as duas coisas para os dois perfis.
2. **Permissão por perfil (correção da v1, precisada na revisão 3 —
   bloqueador):**
   - `dono` e `dentista`: sempre podem criar.
   - `assistente`: a permissão vive **em cada item de
     `clinicas.assistentes[].permissoes`**, não em `clinicas.permissoes`
     solto como a revisão 2 chegou a supor — verificado em
     `src/lib/supabase.ts:166-175` (`Assistente.permissoes.criar_agendamentos`).
     A rota não pode usar `idx` para achar a assistente certa (defeito
     posicional já documentado em `acesso-dentista-secretaria.md`). O
     caminho correto, reaproveitando o que já existe:
     1. `resolverContextoVivo(cookie)` (`src/lib/sessao-profissional.ts`) —
        já dá a checagem de revogação junto.
     2. Localizar a assistente por `profissional_id` (preferencial) dentro
        de `clinicas.assistentes[]`, com `idx` **só como fallback** para
        cookies emitidos antes de F2 — mesmo padrão que
        `resolverProfissionalDaSessao` (`src/lib/acesso-profissional.ts:277-308`)
        já implementa para dentista, só que essa função hoje devolve apenas
        `{id, nome}` e precisa devolver `permissoes` também (ou a rota lê o
        item completo do array pelo mesmo `id`/`idx` resolvido).
     3. Recusar com 403 se `permissoes.criar_agendamentos !== true` (a
        assistente identificada não tem a permissão, ou não foi encontrada).
3. Recebe `paciente_id` (paciente já buscado e escolhido) OU os dados de um
   paciente novo (via botão "Criar paciente" do formulário) — ver seção
   Paciente abaixo para os dois casos.
4. Valida disponibilidade (duração completa do procedimento, jornada,
   bloqueio, passado no fuso da clínica — ver seção acima).
5. Chama `rpc/cappia_reservar_agendamento` com `p_clinica_id` do cookie
   (nunca do corpo).
6. `sucesso: false` da RPC → erro de negócio (400/409, mensagem traduzida do
   `motivo`, nunca o `detalhe` cru).
7. `sucesso: true` → devolve o agendamento criado.

## Paciente: existente ou novo (correção da revisão 3 — bloqueador)

### Paciente existente

A v1 e a revisão 2 não especificavam como a rota trata um `paciente_id`
vindo do corpo da requisição. **A rota nunca confia em nome/CPF/telefone
enviados pelo navegador para um paciente que já existe.** Ela:

1. Busca o paciente por `id` **e** `clinica_id` do cookie juntos
   (`select ... where id = :id and clinica_id = :clinica_id`) — nunca só por
   `id`. Sem o filtro duplo, um `paciente_id` de outra clínica (adivinhado
   ou reaproveitado de outra sessão) seria aceito, porque `id` sozinho não
   garante posse.
2. Se não encontrar (paciente inexistente ou de outra clínica), recusa com
   400 — a mesma resposta nos dois casos, para não revelar qual dos dois
   ocorreu.
3. Usa o **nome, CPF e telefone lidos do banco** (não os do corpo, mesmo que
   o corpo os reenvie) como `p_nome`/`p_documento`/`p_telefone` da RPC — são
   esses valores que ficam gravados como snapshot no agendamento
   (`agendamentos.nome`/`documento`/`telefone`, colunas próprias, não FK).

### Paciente novo

**Correção da revisão 4 — bloqueador.** A revisão 3 propôs reaproveitar
`cappia_persistir_paciente` para criar o paciente. **Essa função não cria —
ela faz upsert por telefone:**

```sql
insert into pacientes (...)
values (...)
on conflict (clinica_id, telefone_normalizado) do update
  set nome            = excluded.nome,
      documento       = coalesce(excluded.documento, pacientes.documento),
      ...
returning id into v_paciente_id;
```

(`20260809120000_..._v1.sql:187-205`). Ela existe para o caso de uso da
Iris, onde "mesmo telefone = mesma pessoa que voltou a escrever" é a
premissa certa — mas é o comportamento errado aqui: se a secretária digitar
um telefone que já pertence a outro paciente da clínica (erro de digitação,
número reaproveitado, etc.), a função **sobrescreve nome e, via `coalesce`,
CPF do paciente existente** e devolve o `id` dele — sem sinalizar que não
criou ninguém. Num formulário de cadastro manual, isso é corrupção
silenciosa de dado de outro paciente, não uma proteção.

**Correção: a rota faz `INSERT` direto em `pacientes`, sem upsert**, e
delega a serialização de concorrência às duas constraints únicas que já
existem no banco operacional:

- `(clinica_id, documento)` — `pacientes_clinica_id_documento_key`
  (`20260809120000_..._v1.sql:143-145`).
- `(clinica_id, telefone_normalizado)` —
  `pacientes_clinica_id_telefone_normalizado_key`
  (`migrations-legado/20260804204134_..._v1.sql:79`; a mesma constraint
  aparece como `pacientes_clinica_telefone_key` no schema
  `bcmuqautblvjdqzhjfbw` — o nome real a confirmar contra
  `udizowyfjnhuhgxkeayk` antes de implementar, já que os dois projetos têm
  nomes de constraint diferentes para o mesmo par de colunas).

A rota captura `unique_violation` de cada constraint (via código de erro do
Postgres, `23505`, e o nome da constraint retornado pelo REST/`pg` — nunca
por parsing de texto) e traduz para mensagem amigável: CPF já cadastrado
nesta clínica, ou telefone já pertence a outro paciente nesta clínica. Nunca
propaga o erro bruto do Postgres. O `INSERT` **não** reimplementa
concorrência em TypeScript (sem `SELECT` prévio como travamento) — as duas
constraints resolvem atomicamente, mesmo padrão de delegação total ao banco
que `cappia_persistir_paciente` já demonstra para o par
`(clinica_id, telefone_normalizado)`.

Telefone continua **obrigatório** no formulário de paciente novo (decisão
do Gabriel, 2026-08-25) — não porque uma RPC exige, mas porque
`identificacao.ts`/o Core usam `telefone_normalizado` como a chave que
identifica paciente vindo do WhatsApp; um paciente manual sem telefone
nunca seria reconhecido pela Iris numa conversa futura.

## Validação de paciente novo (correção da v1, precisada na revisão 3)

Regras mínimas, aplicadas em `/api/secure/agendamento-manual` antes do
`INSERT` (nunca só no navegador):

- **Nome**: não vazio, aparado (`trim`).
- **CPF**: normalizado (só dígitos) e validado — 11 dígitos, dígitos
  verificadores corretos (mesmo algoritmo que qualquer validação de CPF
  brasileiro padrão; não é suficiente checar só o formato).
- **Data de nascimento**: data civil válida, não futura.
- **Telefone**: obrigatório (ver decisão acima), normalizado para o mesmo
  formato de `Paciente.telefone_normalizado`
  (`src/lib/supabase.ts:226-231`, com código do país).

**Duplicidade de CPF e de telefone (correção da revisão 3, precisada nas
revisões 4 e 5 — bloqueador):** a v1/revisão 2 propunham só uma consulta
prévia (`select ... where clinica_id = ... and documento = ...`) antes de
inserir — insuficiente sozinha, porque duas requisições simultâneas para o
mesmo CPF passariam as duas pela consulta antes de qualquer uma inserir
(corrida clássica de "check-then-act"). A revisão 3 apontou a constraint
única do banco como a proteção definitiva e propôs reaproveitar
`cappia_persistir_paciente` para obtê-la de graça — mas essa função faz
**upsert por telefone**, não criação (ver seção Paciente novo): usá-la
arrisca sobrescrever nome/CPF de outro paciente quando o telefone digitado
já existe.

**Correção final:** a rota faz `INSERT` direto (sem upsert, ver seção
Paciente novo) e trata a violação das duas constraints que já existem —
`(clinica_id, documento)` e `(clinica_id, telefone_normalizado)` — como
duplicidade.

**Mensagem de erro (correção da revisão 5):** o PostgREST devolve
`unique_violation` como `{code: "23505", message, details, hint}` — o
`code` é confiável e suficiente para identificar "é uma duplicidade", mas
**o nome da constraint violada normalmente só aparece embutido no texto
livre de `message`/`details`**, não como campo estruturado separado.
Distinguir "CPF duplicado" de "telefone duplicado" exigiria fazer parsing
desse texto — que a própria disciplina desta spec já proíbe (nunca propagar
nem depender do texto bruto do erro do Postgres). Por isso: **a rota
devolve uma mensagem única de erro de negócio para qualquer
`unique_violation` neste INSERT — "CPF ou telefone já cadastrado nesta
clínica."** — sem tentar dizer qual dos dois campos colidiu. Se a
diferenciação se tornar necessária depois, o caminho é uma consulta extra
**depois** do `23505` (uma `select` por documento, outra por telefone, para
descobrir qual bateu) — não parsing da mensagem; fora de escopo nesta v1. A
consulta prévia por CPF/telefone no passo de busca (item 1 do Fluxo)
continua existindo — reduz a chance de chegar ao `INSERT` com duplicata —
mas quem garante a corrida é a constraint, não a consulta.

## Decisões fechadas (2026-08-25)

- **Paciente existente**: busca por nome ou CPF; a rota resolve nome/CPF/
  telefone do banco (por `id` + `clinica_id`), nunca confia no que o corpo
  reenvia.
- **Paciente novo**: "Criar paciente" no próprio modal se a busca não achar
  — nome, CPF, nascimento, **telefone obrigatório**. Criado por `INSERT`
  direto em `pacientes` (não via `cappia_persistir_paciente`, que faz
  upsert por telefone — ver seção Paciente novo), protegido pelas
  constraints únicas `(clinica_id, documento)` e `(clinica_id,
  telefone_normalizado)` já existentes no banco. Duplicidade de CPF ou
  telefone devolve uma única mensagem de erro ("CPF ou telefone já
  cadastrado nesta clínica"), sem distinguir qual dos dois colidiu.
- **Dentista**: select editável; pré-selecionado com o próprio no app do
  dentista, vazio no painel/app da secretária.
- **Botão**: acima de "Bloquear horários" no painel e no app do dentista;
  na área superior de ações em `CalendarioClinica.tsx` (que não tem esse
  botão hoje).
- **Permissão de dentista trocar o select**: confirmado que o dentista
  logado pode escolher outro colega no select e criar agendamento na agenda
  dele. `/api/secure/agendamento-manual` não restringe `p_dentista_id` por
  `perfil === "dentista"` — qualquer perfil autorizado (ver seção
  Permissão por perfil) pode criar para qualquer dentista ativo da própria
  clínica. Mais permissivo que a regra de leitura de
  `acesso-dentista-secretaria.md` ("dentista só vê a própria agenda") —
  deliberado: criar um agendamento não expõe dados do colega, só ocupa um
  horário na agenda dele.
- **Permissão da assistente**: conferida no servidor via
  `permissoes.criar_agendamentos` do item resolvido em
  `clinicas.assistentes[]` por `profissional_id` (não `idx`) — não só
  escondida na UI.
- **Disponibilidade**: agendamento manual respeita jornada do dentista,
  `horarios_bloqueados` e não permite data/hora passada (no fuso da
  clínica) para o **intervalo inteiro** do procedimento — validado na rota,
  antes de chamar a RPC.

## Riscos não-bloqueantes registrados

- Se o paciente for criado (passo "Criar paciente") e depois a reserva
  falhar (`horario_ocupado`, disponibilidade recusada etc.), o paciente
  permanece cadastrado sem agendamento. Aceitável — mesmo efeito colateral
  já existe em qualquer fluxo de cadastro seguido de ação que pode falhar;
  não é motivo para transação distribuída aqui.
- Mensagens de erro da RPC (`erro_insercao` com `detalhe`) nunca chegam ao
  cliente — ver seção "Erro técnico não vai para o cliente".
- A checagem de `horarios_bloqueados` não é atômica com a reserva (corrida
  pequena, aceita para este MVP) — ver nota na seção de disponibilidade.

## Fora de escopo nesta v1

- Clique em slot vazio da grade do calendário para pré-preencher
  dia/horário.
- Sincronização com Google Calendar (`event_id`/`calendar_id`): a RPC aceita
  esses parâmetros mas o formulário não os preenche.
- Edição ou cancelamento pelo mesmo modal — só criação.
- Alterar `cappia_reservar_agendamento` em si (a validação de
  disponibilidade entra na rota, não na função).

## Estado real de implementação (verificado em 2026-09-03)

Auditoria contra o código de `iris-portal-v2` (branch `main`, HEAD
`6d626b2`, working tree limpo): todos os bloqueadores das revisões 2-5
estão implementados como decidido — RPC via `cappia_reservar_agendamento`,
`INSERT` direto de paciente (nunca upsert), erro técnico nunca chega ao
cliente, permissão de assistente por `profissional_id`, duplicidade de
CPF/telefone só por `code === '23505'`. `npx tsc --noEmit` e `next build`
sem erros; suíte completa 140/140, suíte específica de agendamento manual
87/87 (`node --experimental-strip-types --test`, runner real do projeto —
não Vitest).

**Duas mudanças de arquitetura entraram depois da revisão 5, não
documentadas até agora:**

1. **Criação de paciente virou rota própria**, `/api/secure/paciente-manual`
   (2026-08-29), separada de `/api/secure/agendamento-manual`. Motivo:
   antes, um `horario_ocupado` descartava o cadastro recém-digitado; agora
   o paciente é salvo primeiro (devolve `paciente_id`), e a rota de
   agendamento sempre recebe um paciente já existente — nunca cria.
2. **Painel lateral de horários sugeridos** (2026-08-29), não previsto na
   v1 original. `disponibilidade-agendamento-manual.ts` passou a expor
   `horariosDisponiveisDoDia` (réplica de `gerar-opcoes.ts` +
   `resolver-disponibilidade.ts` do Core), servido por
   `/api/secure/horarios-disponiveis`. A digitação manual de
   data/horário fora da lista continua permitida — a lista é sugestão, não
   trava.

**Não verificado nesta auditoria:** execução real dos 12 testes manuais
da seção seguinte contra `udizowyfjnhuhgxkeayk` (multiclínica, sessão
revogada, corrida de CPF simultâneo) — são testes de integração/preflight,
fora do que a suíte automatizada cobre.

## Preflight antes de escrever código

Confirmar, por leitura read-only em `udizowyfjnhuhgxkeayk` (não presumir a
partir dos schemas de dev/legado citados nesta spec):

- As duas constraints únicas existem de fato nesse projeto:
  `(clinica_id, documento)` e `(clinica_id, telefone_normalizado)` em
  `pacientes`. Os nomes exatos **não são necessários** para o código (a
  rota trata qualquer `23505` do `INSERT` de forma genérica — ver seção
  Validação de paciente novo), mas a existência das duas precisa ser
  confirmada, já que o comentário da migration de origem observa que o
  nome difere entre projetos e não garante que a constraint de telefone
  exista em todo schema.
- `clinicas.assistentes[].permissoes.criar_agendamentos` está de fato
  presente nos registros reais (não só no tipo TypeScript).
- `clinicas.fuso_horario` está preenchido para as clínicas de teste que
  vão validar a checagem de horário passado.

## Testes obrigatórios antes de considerar pronto

Lista consolidada (quatro revisões do Codex + Gabriel):

1. Multiclínica: agendamento criado numa clínica não aparece nem é
   acessível por outra; `paciente_id` de outra clínica é recusado (400).
2. Sessão revogada (dentista/assistente) recebe 401 na rota nova.
3. Assistente sem `criar_agendamentos` recebe 403 — controle de servidor,
   resolvido por `profissional_id` (não `idx`), não só de UI.
4. CPF duplicado na mesma clínica, incluindo duas requisições simultâneas
   para o mesmo CPF — só uma cria o paciente, a outra é recusada (prova a
   constraint única, não só a consulta prévia).
4b. Telefone já cadastrado para outro paciente na mesma clínica → recusado
    (mesma mensagem única do item 4); o paciente **existente** não tem
    nome/CPF alterados — prova que a rota faz `INSERT` puro, não upsert (o
    bug real que a revisão 4 encontrou em `cappia_persistir_paciente`).
5. Horário já ocupado por outro `confirmado` → `horario_ocupado` (via RPC).
6. Procedimento longo que cabe no início mas estoura a jornada ou colide
   com bloqueio antes do fim do intervalo → recusado (prova a checagem do
   intervalo inteiro, não só do instante inicial).
7. Horário dentro de um bloqueio ativo (sobreposição parcial), tanto
   bloqueio **específico do dentista** quanto bloqueio **geral da clínica**
   (`dentista_id is null`) → recusado antes da RPC nos dois casos.
7b. Horário dentro do intervalo de almoço do dentista → recusado antes da
    RPC (caso que a UI do calendário hoje não impõe, só a rota nova).
8. Horário fora da jornada do dentista → recusado antes da RPC.
9. Data/hora no passado no fuso da clínica, mesmo quando ainda é futuro em
   UTC (ou vice-versa) → recusada antes da RPC.
10. `GET /api/secure/agendamentos` (proxy `[table]`) continua funcionando
    sem 405 depois da rota nova existir — prevenção direta da regressão de
    rota do achado #1 (revisão 2).
11. Botão e fluxo completo testados nos três calendários (painel, app do
    dentista, app da secretária), não só num deles — incluindo
    `CalendarioClinica.tsx`, que ganha o botão pela primeira vez.
12. **Paridade com `cappia-iris-core`** (decisão pós-preflight): os mesmos
    casos de jornada/almoço/bloqueio geral que
    `carregar-disponibilidade.test.ts` e os testes de
    `resolver-disponibilidade.ts` já cobrem naquele repositório são
    reproduzidos contra a implementação TS desta rota, para flagrar
    divergência entre as duas lógicas paralelas assim que aparecer, não
    anos depois.

## Aprovação

Este documento não autoriza implementação. Aprovação explícita do Gabriel
necessária antes do código ser escrito.
