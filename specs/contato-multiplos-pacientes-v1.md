# Um contato de WhatsApp pode representar vários pacientes — v1

**Status:** especificação **aprovada para implementação, ainda não implementada**
(revisão de arquitetura, segurança e aderência do Codex concluída; aprovação
explícita do Gabriel em 2026-09-07). Registra um defeito real, confirmado por
leitura de código, e a correção aprovada. **Nenhuma linha de código, migration ou
mudança em produção foi feita** — a implementação depende de autorização separada
do Gabriel, por ação.

## Para quem revisa isto sem contexto prévio

Este documento pede uma **revisão de arquitetura, segurança e aderência** — o papel
que `AGENTS.md` atribui ao Codex no processo do projeto.

**O que ler antes, nesta ordem:**

1. `docs/00-principios.md` — em particular o princípio de responsabilidade correta
   ("a IA entende linguagem, o Core nunca recria essa inteligência") e o de remoção.
2. `specs/cpf-outro-telefone-v1.md` — **spec vizinha, mas sobre outra coisa**: trata
   de troca de telefone de um MESMO paciente (o dono do CPF muda de número). Esta
   spec nunca modela múltiplos pacientes por telefone — é ortogonal ao problema
   aqui.
3. `specs/cadastro-conversacional-v1.md` e `specs/correcao-cadastro-conversacional-v1.md`
   — as specs que originaram o mecanismo hoje vigente de gravação de cadastro
   (`cadastroDivergeDaFicha`), cujo pressuposto implícito ("a conversa e o paciente
   são a mesma coisa") é exatamente o que este documento corrige.
4. `specs/remarcacao-conversacional-v1.md` seção 3 — o precedente direto de "lista
   de candidatos + IA escolhe + Core valida" que esta spec reaproveita quase
   integralmente, agora para pacientes em vez de agendamentos.
5. `src/core/identificacao.ts`, `src/core/persistir-paciente.ts`,
   `src/core/cadastro-paciente.ts`, `src/core/orquestrador.ts` — o código atual,
   alvo desta correção.

**Contexto mínimo do sistema:** a Iris Nova é um assistente de WhatsApp para
clínicas odontológicas. Duas IAs por turno: a **interpretadora** lê a mensagem e
produz dados estruturados; o **Core** (determinístico) decide o fluxo; a
**redatora** escreve a resposta a partir de `FatosAutorizados`.

## 1. O defeito, confirmado por leitura de código

**Caso real:** Carlos pediu, pelo WhatsApp dele, um agendamento de avaliação para a
mãe dele, Marta. A interpretadora entendeu corretamente que o atendimento era para
outra pessoa. O Core, porém, não tinha nenhum mecanismo para representar isso —
continuou usando o único `paciente_id` que existe hoje para aquele telefone (o do
próprio Carlos). Consequência: a avaliação foi criada com `paciente_id` do Carlos, e
o cadastro do Carlos teve `nome` e `data_nascimento` sobrescritos pelos dados da
Marta (o CPF sobreviveu porque o caminho percorrido nunca o enviou à RPC — não é
efeito de `COALESCE`; ver seção 1.2 para o mecanismo exato). Duas pessoas ficaram
misturadas num único registro.

**Causa conceitual confirmada:** hoje o sistema não distingue "quem está
conversando" (identidade do contato de WhatsApp) de "para quem é o atendimento"
(identidade do paciente). As duas colapsam na mesma linha da tabela `pacientes`,
chaveada por `(clinica_id, telefone_normalizado)`.

### 1.1 A chave estrutural do problema

`pacientes` — UNIQUE `(clinica_id, telefone_normalizado)`. No projeto operacional
(`udizowyfjnhuhgxkeayk`) essa constraint tem o nome auto-gerado pelo Postgres
**`pacientes_clinica_id_telefone_normalizado_key`** (verificado por leitura direta
de `pg_constraint` em 2026-09-07). A migration local
`20260729_iris_nova_identificacao_v1.sql:22` a declara com o nome
`pacientes_clinica_telefone_key`; produção diverge do nome do arquivo porque a
tabela foi criada antes, num estado anterior. **A migration de transição (seção 2.2,
seção 7) precisa dropar a constraint pelo nome real de produção
(`pacientes_clinica_id_telefone_normalizado_key`), não pelo nome do arquivo local.**

Um paciente por telefone por clínica — **por construção**. `identificacao.ts`,
função `buscarPaciente` (~linha 206-243), resolve com `.maybeSingle()`: a query nem
tem como devolver mais de um resultado. Não é um bug de lógica — é uma limitação
estrutural do schema, herdada desde a primeira migration do projeto.

### 1.2 O ponto exato onde o cadastro é corrompido

RPC `cappia_persistir_paciente`
(`src/supabase/migrations/20260809120000_iris_nova_persistencia_paciente_v1.sql:150-217`):

```sql
insert into pacientes (clinica_id, telefone_normalizado, nome, documento, data_nascimento, email)
values (...)
on conflict (clinica_id, telefone_normalizado) do update
  set nome            = excluded.nome,
      documento       = coalesce(excluded.documento, pacientes.documento),
      data_nascimento = coalesce(excluded.data_nascimento, pacientes.data_nascimento),
      email           = coalesce(excluded.email, pacientes.email)
returning id into v_paciente_id;
```

Não recebe `paciente_id`. A chave de identidade da operação é o telefone. Quando a
Marta é "cadastrada" com o telefone do Carlos, este `UPSERT` atualiza a MESMA linha
do Carlos — `nome` é sempre sobrescrito; `data_nascimento` também, porque
`COALESCE(novo, antigo)` prefere o novo quando ele vem preenchido.

**Relato factual sobre o CPF, corrigido nesta revisão — confirmado por leitura de
código, não é hipótese.** O caminho real percorrido não foi `decidirConfirmacaoOuReserva`
(que envia CPF quando presente, `orquestrador.ts:2039-2046`) — foi
`decidirCorrecaoCadastro`/`aplicarCorrecaoCadastro`
(`src/core/correcao-cadastro.ts`, `orquestrador.ts:1030-1060`), o caminho de
correção de cadastro **fora** do fluxo de agendamento. Esse caminho não exige
ausência de agendamento em andamento — a guarda que antes exigia isso foi removida
em 2026-09-01 por decisão explícita do Gabriel ("a troca deve funcionar sempre...
com ou sem agendamento em andamento", `correcao-cadastro.ts` linhas 95-105), então
ele dispara mesmo com o pedido de avaliação da Marta já em curso, sempre que o
turno traz `data_nascimento`/`email` diferente da ficha já existente. **`nome` e
`cpf` ficam fora do escopo de correção por decisão de produto anterior**
(`CAMPOS_CORRIGIVEIS_FORA_DO_AGENDAMENTO`, `correcao-cadastro.ts:44-48`: "CPF
colide com ficha alheia... e nome é identidade que já produziu defeito real"). Por
isso `aplicarCorrecaoCadastro` (`orquestrador.ts:1048-1060`) monta a chamada a
`persistirPaciente` incluindo **somente** `data_nascimento`/`email`
condicionalmente — nunca `cpf`. `nome`, porém, **sempre** atravessa
(`nome: visaoEfetiva.nome`, obrigatório na RPC), mesmo fora do escopo pretendido de
correção — é este o mecanismo exato que fez `nome` e `data_nascimento` da ficha do
Carlos serem sobrescritos pelos dados da Marta, e o `cpf` do Carlos sobreviver
intacto: o CPF nunca chegou perto da chamada. **Não é COALESCE preservando um
valor por ausência de conflito, e não é uma violação de UNIQUE salvando
parcialmente outras colunas** — a RPC nem chega a receber o campo.

Disparo, no Core: `orquestrador.ts:1688-1703` (`decidirCorrecaoCadastro` →
`aplicarCorrecaoCadastro`), e — no caminho de novo agendamento sem correção
concorrente — também `orquestrador.ts:2034-2078` (`decidirConfirmacaoOuReserva`),
gatilho `cadastroDivergeDaFicha` (`orquestrador.ts:1937-1939`). Em ambos, qualquer
diferença entre o que a conversa diz agora e a ficha do telefone dispara a
reescrita. Nenhuma noção de "para quem é este atendimento" existe em nenhum dos
dois caminhos.

### 1.3 O que já está pronto e não precisa mudar

`agendamentos` já usa `paciente_id` como FK própria — nunca telefone — para saber de
quem é o atendimento. No projeto operacional (`udizowyfjnhuhgxkeayk`, verificado em
2026-09-07) essa FK é **simples**: `agendamentos_paciente_id_fkey foreign key
(paciente_id) references pacientes(id)` — sem `clinica_id` na constraint. (A
migration local `20260804150000_iris_nova_reaproveitamento_agendamento_v1.sql:135`
declara uma FK composta `(paciente_id, clinica_id)`, mas essa forma **não está em
produção**.) Toda busca (`buscar-agendamento-ativo.ts`, remarcação, cancelamento) já
filtra por `paciente_id`. A RPC `cappia_reservar_agendamento` já recebe
`p_paciente_id` explícito como parâmetro, sem resolver nada internamente.

**A camada de agendamento já é compatível com "paciente ≠ contato do telefone" — o
gargalo inteiro está em como o Core resolve e decide qual `paciente_id` usar antes
de a informação chegar até ali.** Esta frente **não modifica a FK de
`agendamentos`**: ela já referencia `paciente_id`, e o isolamento multiclínica dela
não é necessário para resolver o caso Carlos/Marta. Alterar `agendamentos_paciente_id_fkey`
está explicitamente fora de escopo (seção 6).

## 2. Decisão de produto (mantida integralmente do pedido original)

> Contato WhatsApp: quem está conversando. Paciente atendido: para quem será o
> atendimento. Um contato pode representar vários pacientes.

Menor caminho seguro: **reaproveitar o padrão já maduro de "lista de candidatos + IA
escolhe + Core valida"**, hoje usado para procedimento, dentista e agendamento de
remarcação/cancelamento (seção 3), aplicado agora à escolha de paciente.

### 2.1 O que muda no schema

A raiz do problema é a UNIQUE `(clinica_id, telefone_normalizado)` em `pacientes`
tratando telefone como identidade do PACIENTE. A correção separa as duas entidades:

- **`pacientes` perde a UNIQUE em telefone isolado** e ganha uma FK própria para o
  contato (ver abaixo) — o telefone deixa de ser identidade de paciente.
- **Nova tabela `contatos_whatsapp`**: um contato por `(clinica_id,
  telefone_normalizado)` — a UNIQUE que hoje pertence indevidamente a `pacientes`
  migra para cá, onde semanticamente pertence.
- **`pacientes.contato_id`** (FK para `contatos_whatsapp`, not null): todo paciente
  pertence a exatamente um contato. Vários pacientes podem apontar para o mesmo
  `contato_id` — é exatamente a relação um-para-muitos pedida.
- **CPF continua único por clínica** (`pacientes_clinica_id_documento_key`,
  inalterado) — um CPF nunca pode pertencer a dois pacientes, com ou sem contato
  compartilhado.
- **`estado_conversa`** já é chaveado por `(clinica_id, telefone_normalizado)` —
  passa a representar a conversa com o CONTATO (correto conceitualmente, sem
  mudança de chave). **`estado_conversa.paciente_id`, coluna já existente, é
  reaproveitada como o paciente selecionado — nenhuma coluna nova aqui**
  (achado da revisão: a versão anterior desta spec criava `paciente_selecionado_id`
  como segundo campo, sem necessidade). Isso exige mudar a FK e a semântica de
  escrita da coluna, descritas em detalhe na seção 4.4 — resumo aqui: a FK deixa
  de ser composta com telefone (`estado_conversa_paciente_clinica_telefone_fk`,
  seção 2.2) e passa a apontar para `pacientes(id, clinica_id)` — **FK composta com
  clínica que esta frente introduz** (seção 2.3), exigindo `pacientes` reganhar
  `unique (id, clinica_id)` como parte da transição —, e a escrita deixa de ser
  write-once (hoje protegida por `.is('paciente_id', null)`, `identificacao.ts:325`)
  para poder mudar entre assuntos e ser limpa ao concluir um fluxo.

Isto não recria uma segunda fonte de verdade sobre identidade: o telefone continua
sendo a identidade do CONTATO (não muda de significado), só deixa de ser também,
por acidente estrutural, a identidade do paciente.

### 2.2 Migration de transição compatível — backfill e FKs existentes

**Estado real de produção, verificado por leitura direta de `pg_constraint` no
projeto operacional (`udizowyfjnhuhgxkeayk`) em 2026-09-07:**

- `pacientes_id_clinica_telefone_key unique (id, clinica_id, telefone_normalizado)`
  — **existe**.
- `estado_conversa_paciente_clinica_telefone_fk foreign key (paciente_id,
  clinica_id, telefone_normalizado) references pacientes(id, clinica_id,
  telefone_normalizado)` — **existe**.
- `pacientes_clinica_id_telefone_normalizado_key unique (clinica_id,
  telefone_normalizado)` — **existe** (a UNIQUE de telefone da seção 1.1, com o
  nome real de produção).
- `pacientes_id_clinica_key unique (id, clinica_id)` — **NÃO existe**: a própria
  `20260729_iris_nova_identificacao_v1_correcao.sql` a dropou como "redundante" ao
  criar `pacientes_id_clinica_telefone_key`.
- `agendamentos_paciente_id_fkey foreign key (paciente_id) references
  pacientes(id)` — FK **simples**, sem `clinica_id` (seção 1.3). Não há
  `agendamentos_paciente_clinica_fk` composta em produção.

A correção de `20260729_iris_nova_identificacao_v1_correcao.sql` foi de fato
replicada em produção, mesmo o cabeçalho do arquivo dizendo "aplicada
exclusivamente" no projeto de desenvolvimento (o texto do arquivo descreve onde a
migration foi *escrita/testada primeiro*, não o histórico completo de onde foi
depois aplicada).

Consequência direta para o desenho da migration: como
`estado_conversa_paciente_clinica_telefone_fk` referencia `pacientes(id,
clinica_id, telefone_normalizado)`, ela depende estruturalmente da UNIQUE composta
que inclui telefone. Remover a UNIQUE de telefone (para que telefone deixe de ser
identidade de paciente) exige primeiro **trocar** essa FK para a forma sem telefone
(`(paciente_id, clinica_id) references pacientes(id, clinica_id)`). Essa forma de
FK composta com `clinica_id` **é uma garantia nova que esta frente introduz** —
não um precedente já existente. O único precedente de FK composta com `clinica_id`
hoje em produção é a própria `estado_conversa_paciente_clinica_telefone_fk` (que
inclui telefone) e a `mensagens_recebidas_clinica_provider_instancia_fk`; a FK de
`agendamentos` é simples e permanece simples (seção 1.3, seção 6). Como
`pacientes(id, clinica_id)` não tem UNIQUE hoje, a nova FK exige que `pacientes`
**reganhe** `unique (id, clinica_id)` — passo explícito da transição (abaixo). Por
isso a migration desta spec é uma **migration de transição compatível**, nunca
"aditiva": ela cria, troca e remove constraints existentes, não é uma escrita que
só acrescenta.

**Pré-condição verificada (leitura de produção, 2026-09-07):** os 21 pacientes
hoje presentes no projeto operacional (`udizowyfjnhuhgxkeayk`) **têm todos
`telefone_normalizado` preenchido** — o backfill abaixo não encontra nenhum
registro com telefone nulo no estado atual. Nenhum tratamento adicional para
`telefone_normalizado` nulo é criado; se um registro assim aparecer no futuro, é
uma condição a tratar então, não agora.

**Backfill e ordem da transição** (antes de a migration poder tornar
`pacientes.contato_id` `NOT NULL`):
1. Criar `contatos_whatsapp` (schema da seção 2.3, incluindo `unique (id,
   clinica_id)`).
2. Criar uma linha em `contatos_whatsapp` para cada `(clinica_id,
   telefone_normalizado)` distinto hoje presente em `pacientes` (todos com
   telefone preenchido — pré-condição acima).
3. Preencher `pacientes.contato_id` de cada paciente existente com o `contato_id`
   correspondente ao seu próprio `telefone_normalizado` — isto é, **todo paciente
   hoje cadastrado nasce como `vinculo = 'titular'` do seu próprio contato**,
   preservando exatamente o comportamento atual (1 telefone = 1 paciente) para
   todos os dados já existentes. Nenhum paciente hoje existente muda de
   comportamento por conta desta migration.
4. Criar `pacientes unique (id, clinica_id)` (dropada pela migration de correção;
   necessária como alvo da nova FK de `estado_conversa`).
5. Trocar `estado_conversa_paciente_clinica_telefone_fk` pela forma sem telefone
   (`(paciente_id, clinica_id) references pacientes(id, clinica_id)`).
6. Só então remover `pacientes_id_clinica_telefone_key` e
   `pacientes_clinica_id_telefone_normalizado_key` (nome real de produção — seção
   1.1), e aplicar `NOT NULL` em `pacientes.contato_id`.
7. **O paciente do Carlos e o cadastro corrompido migram exatamente como estão —
   sem nenhuma tentativa de separar retroativamente os dados da Marta.** A
   reparação continua fora de escopo (seção 6), mas fica registrado que o
   backfill, por si só, NÃO resolve a mistura já existente — ela permanece na
   mesma linha até uma operação de reparação futura e separada.

### 2.3 Isolamento estrutural entre clínicas

Mesma disciplina já aplicada em toda tabela nova do projeto (ver
`contatos_excecao_iris`, `20260828120000_contatos_excecao_iris.sql`, o
precedente direto mais recente):

- **`contatos_whatsapp`** nasce com `clinica_id not null references
  clinicas(id)`, RLS habilitada, e `revoke all ... from public, anon,
  authenticated` explícito (não só ausência de política — fecha a porta mesmo
  que um `grant` futuro distraído tente reabrir, mesmo raciocínio já registrado
  em `20260821200000_fecha_chat_manual.sql`); só `service_role` acessa.
O padrão de FK composta com `clinica_id` para isolamento multiclínica **já é o
adotado** em `mensagens_recebidas_clinica_provider_instancia_fk` e
`estado_conversa_paciente_clinica_telefone_fk`
(`20260729_iris_nova_identificacao_v1_correcao.sql`, ambas verificadas em produção
em 2026-09-07). Esta frente **estende esse mesmo padrão** a duas FKs novas — não o
inventa, mas também não pode alegar que as duas já existem:

- **`pacientes.contato_id`** (FK **nova** desta frente) é composta com `clinica_id`
  (`(contato_id, clinica_id) references contatos_whatsapp(id, clinica_id)`,
  exigindo `contatos_whatsapp` nascer com `unique (id, clinica_id)`) — nunca uma FK
  simples só em `id`. Sem o `clinica_id` na própria FK, um paciente poderia (por
  erro de aplicação, nunca por design) apontar para um `contato_id` de OUTRA
  clínica, e nenhuma constraint de banco impediria isso — só uma checagem em
  código, que pode ter bug. Com a FK composta, o próprio Postgres rejeita a
  inconsistência.
- **`estado_conversa.paciente_id`** (reutilizado, seção 4.4) troca a FK atual
  (composta com telefone) por uma FK **composta com `clinica_id` sem telefone**
  (`(paciente_id, clinica_id) references pacientes(id, clinica_id)`). Essa é uma
  **garantia nova introduzida por esta frente**: `pacientes` não tem `unique (id,
  clinica_id)` hoje (foi dropada pela migration de correção — seção 2.2), então a
  transição precisa recriá-la como alvo desta FK. Mesma proteção: a seleção de
  paciente nunca pode apontar para um paciente de outra clínica, ainda que o
  `contato_id` dele seja diferente do contato da conversa (o cenário normal desta
  spec, seção 4.5, passo 5).
- **`validarEscolhaPaciente`** (seção 3.3) já revalida contra uma busca fresca
  escopada por `clinica_id` — a FK composta é a segunda camada (banco), nunca
  a única.

## 3. O padrão reaproveitado, aplicado a pacientes

Mesma forma exata de `agendamentos_ativos`/`agendamento_id`
(`specs/remarcacao-conversacional-v1.md` seção 3), sem inventar mecanismo novo:

### 3.1 Entrada para a interpretadora — dois campos, nunca mais

```ts
pacientes_do_contato?: { paciente_id: string; nome: string; vinculo: string }[];
```

- Sempre presente quando o contato tem mais de um paciente vinculado — **contexto**,
  não pergunta em aberto (mesmo espírito de `agendamentos_do_paciente`).
- **Exatamente três campos por item**: `paciente_id` (opaco), `nome` (para a IA
  correlacionar "minha mãe Marta" → o item certo), `vinculo` (texto curto, ex.
  "titular", "dependente" — nunca um grau de parentesco livre; ver seção 3.4 sobre
  o vocabulário fechado). **Nunca planos de tratamento, nunca agendamentos, nunca
  CPF ou data de nascimento de ninguém que não seja o paciente já selecionado** —
  a mesma disciplina de minimização já usada para `dentistas_disponiveis`/
  `procedimentos_disponiveis`.
- Quando o contato tem só um paciente vinculado, este campo fica **ausente** (nunca
  `[]` com um item) — o fluxo continua exatamente como hoje, sem nenhuma pergunta
  nova.

### 3.2 Saída da interpretadora — `paciente_id` direto, mesmo padrão de `agendamento_id`

A IA correlaciona semanticamente ("minha mãe Marta" → o item cujo nome bate) e
devolve `paciente_id` em `alteracoes` — nunca resolve por conta própria um ordinal
ou nome para índice; o Core nunca interpreta essas referências (seria recriar o
parser textual que a medição de 2026-08-11, já citada em
`remarcacao-conversacional-v1.md`, provou desnecessário).

Instrução da interpretadora (mesmo estilo de `agendamentos_do_paciente`/
`tratamentos_pendentes`, `interpretacao-instrucoes.ts`): quando a mensagem
identificar claramente qual paciente vinculado ao contato é o atendimento (nome,
vínculo, ou combinação), preencher `paciente_id`; em dúvida real, omitir.

### 3.3 Validação do Core — mesma função-molde de `validarEscolhaAgendamento`

Nova função-irmã, `validarEscolhaPaciente`, mesma forma de
`interpretar-e-aplicar.ts:396-429`:

1. `paciente_id` emitido é conferido contra a lista **fresca** de pacientes do
   contato (nova busca, escopada a `clinica_id` + `contato_id` — nunca contra o que
   foi oferecido num turno anterior sem revalidar).
2. Fora da lista (ou pertencente a outro contato/clínica): descartado, nunca usado
   — mesma garantia de segurança já provada para `agendamento_id`
   ("poderia pertencer a outro paciente, outra clínica, outro turno, ou ser uma
   alucinação do modelo").
3. Se restar ambiguidade **e houver ao menos um candidato na lista fresca** (mais
   de um candidato plausível, ou nenhuma menção): o orquestrador devolve uma
   decisão nova, `aguardando_escolha_paciente`, com a lista revalidada — mesmo
   padrão de `aguardando_escolha_dentista`/`aguardando_escolha_agendamento`. Com
   a lista vazia (contato só com o titular), não há escolha a oferecer — o fluxo
   segue direto para a pergunta de vínculo (seção 4.5, passo 1, segundo ramo).

### 3.4 Vocabulário fechado de `vinculo` — nada de heurística de parentesco

Por instrução explícita ("não criar heurística de parentesco"), `vinculo` é um
rótulo **estrutural**, decidido no cadastro (seção 4), nunca inferido de texto:

```ts
type VinculoPaciente = 'titular' | 'dependente';
```

- `titular`: paciente com telefone próprio, é o contato de si mesmo (o caso comum
  hoje, 1 contato = 1 paciente).
- `dependente`: paciente sem telefone próprio, administrado por outro contato
  (o caso da Marta).

O Core nunca decide "é mãe, é filho, é cônjuge" — isso é dado que a clínica pode
opcionalmente registrar como texto livre no `nome`/observação, nunca como campo
estruturado que o sistema interprete. A IA usa o `nome` (texto) e o `vinculo`
(fechado) para correlacionar semanticamente; nunca o inverso.

## 4. Comportamento conversacional

### 4.1 Um único paciente vinculado — sem mudança

`pacientes_do_contato` fica ausente do payload; `identificacao.ts` resolve
`paciente_id` exatamente como hoje (mesma query, só que agora contra
`contato_id` em vez de telefone diretamente — ver seção 5). Nenhuma pergunta nova,
nenhum turno extra.

### 4.2 Vários pacientes, mensagem não diz para quem

A interpretadora omite `paciente_id` (seção 3.2, dúvida real). O orquestrador
resolve `aguardando_escolha_paciente` (seção 3.3, item 3). A redatora recebe o
objetivo e a lista (nomes + vínculo, nunca IDs) e formula a pergunta com as
próprias palavras — **sem frase fixa**: instrução de objetivo e fato, como já é
o padrão para `escolher_entre_dentistas`/`escolher_entre_agendamentos`.

### 4.3 Mensagem já identifica a pessoa

"Quero marcar para minha mãe Marta" → a interpretadora correlaciona e emite
`paciente_id` da Marta diretamente (seção 3.2), sem pergunta extra — mesmo
comportamento já medido e aprovado para agendamento espontâneo
(`specs/remarcacao-conversacional-v1.md` seção 3, exceção de 2026-09-06).

### 4.4 Persistência da escolha durante o atendimento — reutiliza `estado_conversa.paciente_id`

**Achado da revisão, corrigido: em vez de criar `paciente_selecionado_id` como
segundo campo, esta spec reutiliza `estado_conversa.paciente_id` (coluna já
existente) como o paciente selecionado.** Um único campo basta — não há
necessidade de dois campos com autoridades diferentes, porque não existe mais
nenhuma informação que só o campo antigo carregava e o novo não carregasse: hoje
`paciente_id` representa "o paciente resolvido para esta conversa", e é
exatamente isso que "paciente selecionado" significa depois desta spec — a única
mudança é que, com vários pacientes por contato, esse valor passa a poder mudar
de um assunto para outro em vez de ser sempre o mesmo.

**O que muda na coluna existente** (não é aditivo — é a mesma classe de mudança
de contrato já registrada na seção 2.2):
- **FK**: `estado_conversa_paciente_clinica_telefone_fk` (que amarra
  `paciente_id` ao MESMO telefone da conversa — constraint verificada em produção,
  seção 2.2) deixa de existir — seria estruturalmente impossível de satisfazer
  assim que dois pacientes com telefones diferentes puderem ser selecionados na
  mesma conversa (o caso do número próprio da Marta, seção 4.5). A nova FK
  (introduzida por esta frente, seção 2.3) aponta só para `pacientes(id,
  clinica_id)` e exige `pacientes` reganhar `unique (id, clinica_id)` na
  transição — o paciente selecionado precisa pertencer à mesma clínica da
  conversa, mas não precisa mais compartilhar o telefone.
- **Semântica de escrita**: hoje write-once, protegida por `.is('paciente_id',
  null)` no `UPDATE` (`identificacao.ts:325`) — nunca sobrescreve um vínculo já
  set. Essa proteção deixa de existir: o campo passa a poder ser escrito de
  novo a cada troca de assunto (seção 4.2/4.3) e **limpo** (`null`) ao concluir
  um fluxo (abaixo) — a mesma disciplina de "campo mutável durante um assunto,
  limpo ao concluir" que `agendamento_id`/`intencao` já seguem hoje em
  `estado_conversa.dados` (`orquestrador.ts`, `camposParaLimparAoConcluir`),
  só que aplicada a uma coluna própria da tabela em vez de uma chave de
  `dados` (jsonb).
- Enquanto presente, plano, cadastro e agendamentos consultados
  (`identificacao.ts`, `fatos-autorizados.ts`) pertencem exclusivamente a esse
  paciente — nunca ao contato nem a outro paciente vinculado.

**Precedência de aplicação — fecha o risco de aplicar dado do turno ao
paciente errado.** `atendimento_para_terceiro: true` (seção 4.5) atua como
GATE antes de qualquer escrita, no mesmo ponto em que `cadastroDivergeDaFicha`
decide hoje se chama `persistirPaciente` (`orquestrador.ts:2039`): quando
presente neste turno, nenhum campo cadastral (`nome`, `cpf`, `data_nascimento`,
`email`) nem operacional (`CAMPOS_NOVO_AGENDAMENTO` —
`intencao`/`procedimento_id`/`dentista_id`/`data_texto`/`periodo`/
`horario_texto`/`confirmacao`) emitido neste turno pode ser aplicado ao
`paciente_id` **atualmente selecionado** em `estado_conversa.paciente_id` — é
exatamente o mecanismo que corrompeu a ficha do Carlos no caso real (seção 1.2),
e a razão de existir desta spec. O turno com `atendimento_para_terceiro` só
pode: (a) mudar a seleção (abaixo) ou (b) alimentar o fluxo de "outra pessoa"
(seção 4.5) — nunca escrever no paciente que estava selecionado antes deste
turno.

**Troca de seleção nunca transporta dado acumulado do paciente anterior — a
limpeza mínima necessária.** Ao `estado_conversa.paciente_id` mudar de valor
(de um assunto para outro, seção 4.2/4.3, ou para o paciente recém-criado,
seção 4.5), os campos cadastrais e operacionais citados acima que estavam
acumulados em `estado_conversa.dados` **para o paciente anterior** são
limpos no mesmo turno da troca — mesmo conjunto e mesmo mecanismo que
`camposParaLimparAoConcluir` já usa para fechar um fluxo hoje
(`orquestrador.ts`), aplicado também no momento da TROCA, não só na conclusão.
Sem essa limpeza, um `data_texto`/`horario_texto` que o Carlos informou para o
assunto dele poderia ser lido, no turno seguinte, como se fosse a data/horário
já combinado para a Marta — o mesmo tipo de vazamento entre pessoas que esta
spec existe para eliminar, só que via `dados` em vez de via `pacientes`.

Dois campos são recalculados a cada turno e por isso não entram nesta limpeza:
`pacientes_do_contato` (contexto do payload) e `atendimento_para_terceiro`
(sinal do turno atual). Já `outra_pessoa_alem_das_listadas`,
`vinculo_novo_paciente` e `telefone_novo_paciente` **permanecem acumulados em
`dados` entre turnos** enquanto o fluxo de "outra pessoa" (seção 4.5) está
aberto — eles pertencem a esse fluxo, não a um paciente selecionado, então a
troca de `estado_conversa.paciente_id` não os toca; sua limpeza é a do próprio
fluxo de cadastro (seção 4.5), ao concluir ou desistir.

**Quando a seleção é limpa (sem troca, ao concluir):** ao concluir o fluxo
operacional (reserva criada, remarcação criada, cancelamento criado — mesmo
conjunto de decisões que já limpa `agendamento_id`/`intencao` hoje). Um novo
pedido ambíguo depois disso exige nova escolha — comportamento pedido
explicitamente. Quando o contato tem só um paciente vinculado (seção 4.1),
essa limpeza é inofensiva: a próxima resolução de `identificacao.ts` encontra
de novo o único paciente do contato e resolve sozinha, sem pergunta nova.

### 4.5 Atendimento para outra pessoa além das listadas — vínculo é EXCLUSIVO, nunca duplo

**Correção da revisão (esclarecimento do Gabriel): o vínculo é exclusivo. Um
paciente nunca fica associado simultaneamente ao contato responsável e ao próprio
número.** A versão anterior desta seção não deixava essa exclusividade explícita, e
uma leitura da revisão levantou por engano uma relação muitos-para-muitos entre
contato e paciente. **Não existe tal relação.** O modelo continua exatamente o da
seção 2.1: `pacientes.contato_id` aponta para **um único contato** (cardinalidade
1:1 do lado do paciente — a FK em si é composta com `clinica_id` por isolamento,
seção 2.3, mas nunca aponta para mais de um contato), um paciente pertence a
exatamente um contato, para sempre (até uma futura correção de cadastro explícita,
fora de escopo). O que muda é só **qual** contato essa FK aponta, decidido uma única
vez no momento do cadastro.

Ao identificar um pedido para alguém que não está na lista de pacientes deste
contato, a Iris pergunta naturalmente (instrução de objetivo, não frase fixa —
algo como "vocês vão usar um número novo para ela, ou prefere deixar este seu
número como o contato dela também?", nunca "adicionar à sua ficha": as fichas
continuam **totalmente separadas** em qualquer dos dois casos). Regra completa,
nesta ordem:

1. **Dois sinais físicos distintos, nunca confundidos — o Core NUNCA infere
   nenhum dos dois comparando nomes** (nem contra `pacientes_do_contato`, nem
   contra o nome já cadastrado do contato) — isso seria recriar em regex
   exatamente o parser textual que `docs/00-principios.md` já proíbe. A
   interpretadora, que já entende a linguagem, emite os dois fatos
   diretamente, no mesmo padrão estrutural já usado para
   `intencao`/`confirmacao`/eventos:
   - `atendimento_para_terceiro: true` — presente quando a mensagem expressar
     claramente que o atendimento é para alguém que não é quem está
     conversando ("para minha mãe", "é pro meu filho", "não é pra mim").
     **Isso sozinho só significa "não é para quem está falando" — nunca
     "é outra pessoa além das listadas".** A pessoa mencionada pode ser
     qualquer um dos pacientes já vinculados ao contato.
   - `outra_pessoa_alem_das_listadas: true` — presente quando a mensagem
     expressar claramente que o atendimento **não é para nenhum dos pacientes
     hoje vinculados a este contato** ("não é a Marta nem o João", "é outra
     pessoa", ou resposta a `aguardando_escolha_paciente` dizendo "nenhum
     desses"). **Este sinal NÃO afirma nem nega que a pessoa já tenha cadastro
     na clínica** — só diz "não está na lista deste contato". Se ela já é
     paciente com telefone próprio, isso é descoberto depois, pela busca do
     Core no passo 4. Nunca inferido pela ausência de `paciente_id` nem pela
     mera presença de `atendimento_para_terceiro`; em dúvida real, ausente.
   **Consequência no Core, fechando a ambiguidade apontada na revisão:**
   `paciente_id` ausente (seção 3.2, dúvida real) nunca significa, por si só,
   "outra pessoa" — significa apenas que a interpretadora não conseguiu
   identificar qual paciente já vinculado é o atendimento. Regra de decisão:
   - `atendimento_para_terceiro` presente, `paciente_id` ausente, `outra_pessoa_alem_das_listadas`
     ausente, e `pacientes_do_contato` **não vazio** (há outro paciente
     vinculado ao contato além do titular) → `aguardando_escolha_paciente`
     (seção 3.3): pergunta natural "é um deles ou outra pessoa?", incluindo a
     opção explícita de ser outra pessoa — nunca cadastro automático.
   - `atendimento_para_terceiro` presente, `paciente_id` ausente, e
     `pacientes_do_contato` **vazio** (só existe o titular deste contato) →
     o Core segue **direto** para a pergunta do passo 2 (usar o contato atual
     ou informar outro número), sem um turno de "escolha" que não teria
     candidatos — nunca trava.
   - `outra_pessoa_alem_das_listadas: true` presente (com ou sem
     `atendimento_para_terceiro`) → o Core segue para o passo 2 sem tentar
     casar contra `pacientes_do_contato`. Isso **não** inicia uma inserção:
     apenas leva à pergunta de vínculo. Se a resposta for "número próprio", a
     existência (ou não) de cadastro para esse número é resolvida no passo 4,
     antes de qualquer escrita.
2. A Iris pergunta se essa pessoa terá número de WhatsApp próprio ou ficará
   vinculada ao contato atual.
3. Se a resposta for **"vincular ao contato atual"** (`vinculo_novo_paciente =
   'dependente'`): **sempre nasce uma ficha de paciente separada** —
   `contato_id` = o mesmo do contato atual, `vinculo = 'dependente'`, sem
   reaproveitar nem misturar com a ficha de quem está conversando. A partir daí,
   esse paciente aparece em `pacientes_do_contato` nas conversas futuras desse
   mesmo número — permanentemente, até uma correção de cadastro futura. Não há
   telefone a esperar; o Core segue para o cadastro dos campos faltantes.
4. Se a resposta for **"número próprio"** (`vinculo_novo_paciente =
   'numero_proprio'`): o Core aguarda `telefone_novo_paciente` (pode vir em
   turno posterior — passo abaixo). **Ao receber o telefone, antes de qualquer
   escrita, o Core resolve o contato desse número** (`(clinica_id,
   telefone_normalizado)` em `contatos_whatsapp`) e verifica se já há paciente
   vinculado a ele:
   - **Já existe paciente correspondente** → o Core **seleciona o cadastro
     existente** (grava `estado_conversa.paciente_id` com esse `paciente_id`) e
     continua o fluxo operacional. **Nenhum `INSERT`, nenhuma duplicata.** Se
     houver mais de um paciente nesse contato de destino, cai em
     `aguardando_escolha_paciente` (seção 3.3) sobre a lista daquele contato.
     **Enquanto essa escolha estiver pendente**, o Core não guarda o contato de
     destino em coluna nem estado novo: a cada turno ele **relê
     `telefone_novo_paciente` já persistido em `dados`**, **resolve de novo esse
     contato de destino** (`(clinica_id, telefone_normalizado)` em
     `contatos_whatsapp`) e **monta e valida `pacientes_do_contato` contra ele** —
     nunca contra o contato de quem está conversando. `validarEscolhaPaciente`
     (seção 3.3) só aceita `paciente_id` que esteja nessa lista fresca do contato
     de destino; qualquer `paciente_id` do contato do Carlos, de outro contato ou
     de outra clínica é descartado.
   - **Não existe** → o Core coleta os campos faltantes (nome e os já exigidos
     hoje) e só então cria o paciente com `contato_id` PRÓPRIO (o contato
     resolvido/criado a partir do número informado) — nunca o contato da
     conversa atual. Esse paciente **não aparecerá** em `pacientes_do_contato`
     de conversas futuras do número de quem pediu o cadastro.
   - **Nunca inserir automaticamente antes dessa busca.**
5. **Mesmo escolhendo número próprio, Carlos precisa conseguir concluir o
   atendimento iniciado NESTA conversa.** Isso é resolvido pelo mesmo mecanismo já
   descrito na seção 4.4: o Core grava `estado_conversa.paciente_id` (reutilizado
   como paciente selecionado) com o `paciente_id` da Marta — o reutilizado (passo
   4, primeiro caso) ou o recém-criado (passo 4, segundo caso) — independente de
   qual `contato_id` ele carrega, e mesmo que esse `paciente_id` pertença a um
   telefone diferente do telefone desta conversa (por isso a FK composta com
   telefone precisa ser removida, seção 4.4). Essa seleção é **estritamente
   temporária**: vale somente até o fluxo operacional atual concluir
   (reserva/remarcação/cancelamento criado), e é limpa (volta a `null`) no mesmo
   ponto que já limpa `agendamento_id`/`intencao` hoje. Ela **nunca** cria nem
   implica vínculo permanente entre a Marta e o contato do Carlos —
   `pacientes.contato_id` da Marta continua apontando para o contato dela própria
   o tempo todo; `estado_conversa.paciente_id` do Carlos é um ponteiro de conversa
   em andamento, não uma relação de dados, e é limpo antes de qualquer turno
   futuro poder reaproveitá-lo por engano.
6. **A ficha do Carlos nunca é alterada** em nenhum dos casos — nem `nome`, nem
   `cpf`, nem `data_nascimento`, nem `contato_id`.

**Ter telefone próprio muda só a forma de contato futuro — nunca autoriza que a
persistência de cadastro use o telefone da conversa atual como identidade do
paciente que está sendo criado, e nunca cria um segundo vínculo além do
`contato_id` definitivo decidido no passo 3 ou 4.** `persistirPaciente` passa a
exigir `contato_id` explícito (nunca resolvido implicitamente por "telefone desta
conversa"), e nunca `ON CONFLICT` por telefone sozinho — ver seção 5.2.

**Contrato de dados para "outra pessoa além das listadas" (achado da revisão,
corrigido)**: a versão anterior desta seção falava em "pessoa ainda inexistente" e
exigia que o usuário declarasse que a pessoa nunca teve cadastro
(`pessoa_nova_no_cadastro`). Isso falhava quando ela já era paciente com telefone
próprio. O sinal certo diz só **"não é nenhum dos pacientes listados neste
contato"** — a existência (ou não) de cadastro é descoberta pela busca do Core no
passo 4, não declarada pelo usuário. São dois momentos diferentes:

- **A pessoa não está na lista deste contato**: `paciente_id` fica ausente e a
  interpretadora emite `outra_pessoa_alem_das_listadas: true` (passo 1 acima —
  nunca inferido pela ausência de `paciente_id`, nunca afirmando nada sobre o
  banco). O Core então decide o novo objetivo `pedir_vinculo_paciente_novo` (nome
  provisório — ver seção 7): pergunta número próprio vs. vinculado, ANTES de
  qualquer `INSERT`. Os campos de `dados_faltantes` (`nome`/`cpf`/`data_nascimento`
  da pessoa em questão, nunca do contato) só são cobrados no ramo em que o passo 4
  não encontrou cadastro para o número informado.
- **Resposta à pergunta do passo 2**: vocabulário fechado, mesmo padrão de
  `confirmacao`/`intencao` (nunca texto livre interpretado por regex) — campo
  estruturado `vinculo_novo_paciente: 'dependente' | 'numero_proprio'` que a
  interpretadora emite quando a resposta do paciente for semanticamente clara;
  em dúvida real, omite e a Iris repete a pergunta.
- **Contrato físico do telefone da outra pessoa: campo próprio
  `telefone_novo_paciente`, nunca confundido com troca de telefone do paciente
  atual.** `specs/cpf-outro-telefone-v1.md`/`troca_telefone_pendente` tratam de
  um paciente JÁ EXISTENTE mudando o telefone que já é dele — mecanismo
  diferente, não reaproveitado aqui. `telefone_novo_paciente` é o telefone
  informado para a outra pessoa; **só depois de o Core resolvê-lo** (seção 4.5,
  passo 4) se sabe se há `paciente_id` correspondente ou não. Só tem sentido
  junto de `vinculo_novo_paciente = 'numero_proprio'`. Mesmo vocabulário fechado
  de validação de telefone já usado no cadastro hoje (formato E.164, mesma
  disciplina de `pacientes.telefone_normalizado`) — nunca aceito como texto
  livre.
- **Turnos separados são o caso normal, não uma exceção — mesmo padrão de
  campo persistido entre turnos já usado para `intencao`/`procedimento_id`
  (achado da revisão: a versão anterior presumia, sem dizer, que vínculo e
  telefone chegariam juntos na mesma resposta).** Quando o paciente responde
  "número próprio" sem informar o número no mesmo turno,
  `vinculo_novo_paciente = 'numero_proprio'` é gravado em `dados` e
  **permanece ali**, exatamente como `intencao` permanece entre turnos hoje.
  Enquanto `telefone_novo_paciente` não chegar, o Core não chama
  `persistirPaciente` — a decisão correspondente continua pedindo o telefone
  (mesmo padrão de `cadastro_necessario`/`dados_faltantes` já usado para
  cadastro incompleto). Só quando `vinculo_novo_paciente = 'numero_proprio'`
  E `telefone_novo_paciente` estiverem ambos presentes em `dados` (de turnos
  iguais ou diferentes) o Core chama `persistirPaciente` com o `contato_id`
  definitivo (resolvido/criado a partir de `telefone_novo_paciente`, nunca do
  telefone da conversa atual).
- **Limpeza de `telefone_novo_paciente`**: junto com `vinculo_novo_paciente` e
  `outra_pessoa_alem_das_listadas` — mesmo ponto de limpeza do fluxo de cadastro
  (abaixo), nunca sobrevive além dele. Um `telefone_novo_paciente` de um
  fluxo concluído nunca pode ser reaproveitado por engano num fluxo de "outra
  pessoa" seguinte, na mesma conversa.
- Se a resposta for "vincular ao contato atual" (`vinculo_novo_paciente =
  'dependente'`), não há telefone a esperar — o Core já pode chamar
  `persistirPaciente` assim que o resto do cadastro (nome, e os demais campos
  já exigidos hoje) estiver completo.
- Nenhum dos quatro campos (`atendimento_para_terceiro`,
  `outra_pessoa_alem_das_listadas`, `vinculo_novo_paciente`,
  `telefone_novo_paciente`) é limpo por um novo pedido ambíguo de agendamento
  (diferente de `estado_conversa.paciente_id` reutilizado como seleção, seção
  4.4). Enquanto o fluxo está aberto eles **ficam acumulados em `dados` entre
  turnos** — mesmo mecanismo de `intencao`/`procedimento_id` — e são limpos pela
  mesma disciplina que já limpa campos de cadastro incompleto hoje: quando o
  fluxo conclui (paciente selecionado ou persistido) ou quando o paciente
  desiste explicitamente dele.

## 5. Mudanças mínimas no Core

### 5.1 `identificacao.ts`

`buscarPaciente` (~linha 206-243) passa a resolver em duas etapas:
1. Resolver/criar `contato_whatsapp` por `(clinica_id, telefone_normalizado)` —
   mesma query de hoje, só que contra a tabela nova.
2. Buscar pacientes vinculados a esse `contato_id` — `.maybeSingle()` some;
   vira uma lista (0, 1, ou N).

`ResultadoIdentificacao` ganha o formato:

```ts
{
  clinica_id: string;
  contato_id: string;
  pacientes: readonly { paciente_id: string; nome: string; vinculo: VinculoPaciente }[];
  // paciente resolvido, quando ha exatamente 1 OU quando
  // estado_conversa.paciente_id (reutilizado como selecao) ja aponta para um
  // vinculo valido:
  paciente: { encontrado: boolean; id: string | null; cadastro: CadastroPaciente };
}
```

### 5.2 `persistir-paciente.ts` / RPC `cappia_persistir_paciente`

Ganha parâmetro obrigatório `p_contato_id uuid` e parâmetro opcional
`p_paciente_id uuid` (quando já se sabe qual paciente atualizar — ex. correção de
cadastro do próprio paciente já selecionado). Nova regra de conflito:

- Se `p_paciente_id` for informado: `UPDATE ... WHERE id = p_paciente_id AND
  contato_id = p_contato_id` — nunca por telefone.
- Se `p_paciente_id` for `null` (paciente novo): `INSERT` vinculado a
  `p_contato_id`, com `vinculo` explícito — nunca `ON CONFLICT` por telefone (essa
  constraint deixa de existir em `pacientes`, seção 2.2).

**Nenhuma reparação dos dados já corrompidos do Carlos** — fora de escopo desta
spec, por instrução explícita.

### 5.3 `fatos-autorizados.ts`, `orquestrador.ts`

Todo ponto listado na investigação que hoje usa `identificacao.paciente.id` passa a
usar o `paciente_id` **selecionado** (resolvido pela seção 5.1, ou pela escolha
persistida em `estado_conversa.paciente_id` reutilizado) — nunca mais o paciente
"do telefone" implicitamente. O ponto crítico é `decidirConfirmacaoOuReserva`
(`orquestrador.ts:2034-2078`): `persistirPaciente` passa a receber `contato_id` (da
seção 5.1) e `paciente_id` (quando já selecionado) explicitamente.

O ramo "número próprio" (seção 4.5, passo 4) **reusa a resolução de contato da
seção 5.1** — as mesmas duas etapas (resolver `contato_whatsapp` por `(clinica_id,
telefone_normalizado)`; listar pacientes vinculados) —, só que aplicadas a
`telefone_novo_paciente` em vez do telefone da conversa. Encontrou paciente:
seleciona (grava `estado_conversa.paciente_id`). Não encontrou: segue para o
cadastro. Nenhuma primitiva nova; nenhum `INSERT` antes dessa resolução.

## 6. O que NÃO é criado (por instrução explícita)

- **Nenhuma relação muitos-para-muitos entre contato e paciente.** Achado da
  revisão, corrigido: uma leitura anterior chegou a cogitar uma tabela
  intermediária para permitir um paciente pertencer a vários contatos ao mesmo
  tempo. **Isso nunca foi a decisão do Gabriel e não faz parte desta spec.** O
  vínculo `pacientes.contato_id` aponta para exatamente um contato, o tempo todo
  (a FK é composta com `clinica_id` por isolamento — seção 2.3 —, mas nunca
  aponta para mais de um contato, e nunca há tabela intermediária). A única
  exceção é a seleção temporária
  de atendimento (`estado_conversa.paciente_id`, reutilizado como seleção, seção
  4.4/4.5), que é um ponteiro de conversa em andamento — nunca um segundo vínculo
  de dados, nunca persistido além da duração do fluxo operacional atual.
- Nenhum fiscal novo, nenhuma segunda IA, nenhum fallback novo, nenhuma frase fixa.
- Nenhuma heurística de parentesco, nenhum regex sobre texto livre para decidir
  "quem é quem" — `vinculo` é campo estruturado fechado, decidido no cadastro.
- Nenhuma ampliação para procuração, autorização jurídica, ou consentimento de
  terceiros — fora de escopo, mesmo que mencionado como possível extensão futura.
- **Nenhuma alteração na FK de `agendamentos`** (`agendamentos_paciente_id_fkey`,
  simples, `(paciente_id) references pacientes(id)` em produção). Ela já
  referencia `paciente_id` e isso basta para o caso Carlos/Marta; torná-la
  composta com `clinica_id` seria uma mudança independente, não coberta aqui.
- Nenhuma reparação dos dados atuais do Carlos/Marta — operação separada.
- Nenhuma tabela ou estado adicional além do estritamente necessário (seção 2.1):
  1 tabela nova (`contatos_whatsapp`), 1 coluna nova em `pacientes` (`contato_id`),
  1 coluna nova em `pacientes` (`vinculo`) — **nenhuma coluna nova em
  `estado_conversa`**: `paciente_id`, já existente, é reutilizada como seleção
  (seção 4.4), só com FK e semântica de escrita atualizadas.

## 7. Arquivos e tabelas afetados (inventário)

| Arquivo/tabela | Mudança |
|---|---|
| `pacientes` (schema) | nova coluna `contato_id` (FK composta com `clinica_id` — seção 2.3, not null após backfill — seção 2.2), nova coluna `vinculo`; **recria `unique (id, clinica_id)`** (dropada pela migration de correção — alvo da nova FK de `estado_conversa`, seção 2.2/2.3); troca `estado_conversa_paciente_clinica_telefone_fk` para a forma sem telefone; remove a UNIQUE de telefone, cujo nome real em produção é **`pacientes_clinica_id_telefone_normalizado_key`** (não `pacientes_clinica_telefone_key` do arquivo local — seção 1.1), e a UNIQUE composta `pacientes_id_clinica_telefone_key`. Constraints existentes verificadas em produção em 2026-09-07 (seção 2.2) |
| `contatos_whatsapp` (nova tabela) | `id`, `clinica_id` (FK, not null), `telefone_normalizado`, UNIQUE `(clinica_id, telefone_normalizado)`, UNIQUE `(id, clinica_id)` (para a FK composta de `pacientes.contato_id`); RLS habilitada, `revoke all` de `anon`/`authenticated`, só `service_role` (seção 2.3) |
| `estado_conversa` (schema) | `paciente_id` (existente) reutilizada como seleção: troca a FK composta com telefone (`estado_conversa_paciente_clinica_telefone_fk`, verificada em produção) por `(paciente_id, clinica_id) references pacientes(id, clinica_id)` — **exige `pacientes` reganhar `unique (id, clinica_id)` primeiro** (linha acima); remove a proteção write-once (`.is('paciente_id', null)`, `identificacao.ts`) |
| `src/core/identificacao.ts` | `buscarPaciente` resolve contato → lista de pacientes; novo shape de `ResultadoIdentificacao` |
| `src/core/persistir-paciente.ts` | `PersistirPacienteEntrada` ganha `contato_id` (obrigatório) e `paciente_id` (opcional) |
| `src/core/interpretar-e-aplicar.ts` | nova função `validarEscolhaPaciente`, mesmo molde de `validarEscolhaAgendamento` |
| `src/core/interpretacao-tipos.ts` | novo campo `pacientes_do_contato?` em `EntradaInterpretacao`; `paciente_id`, `atendimento_para_terceiro`, `outra_pessoa_alem_das_listadas`, `vinculo_novo_paciente`, `telefone_novo_paciente` em `AlteracoesDados` (seção 4.5) |
| `src/core/interpretacao-instrucoes.ts` | nova instrução, mesmo padrão de `agendamentos_do_paciente`/`tratamentos_pendentes`; instrução do fluxo de "outra pessoa além das listadas" (seção 4.5) |
| `src/core/orquestrador.ts` | novo ramo `aguardando_escolha_paciente`; novo ramo `pedir_vinculo_paciente_novo` (seção 4.5); todos os pontos que usavam `identificacao.paciente.id` passam a usar o paciente selecionado; `decidirConfirmacaoOuReserva` passa `contato_id`/`paciente_id` explícitos a `persistirPaciente` |
| `src/core/fatos-autorizados.ts` | novo objetivo `escolher_entre_pacientes` (ou nome equivalente), com fato `pacientes_candidatos: string[]` (nomes, nunca IDs); novo objetivo para a pergunta de vínculo (seção 4.5) |
| `src/core/redator-instrucoes.ts` | nova instrução para os objetivos novos, mesmo padrão de `escolher_entre_dentistas` |
| `src/supabase/migrations/` | migration de transição compatível na ordem exata da seção 2.2 (criar `contatos_whatsapp` → backfill `contato_id` → recriar `pacientes unique (id, clinica_id)` → trocar a FK de `estado_conversa` → só então remover as UNIQUEs de telefone e aplicar `NOT NULL`) + script de backfill — **não aplicada nesta rodada** |
| Espelho Edge (`supabase/functions/iris-nova-mensagem/`) | todos os arquivos acima, paridade obrigatória |

## 8. Testes essenciais exigidos antes de aprovar

Seguindo a disciplina de `docs/00-principios.md` (teste isolado + testes
realistas):

1. **Contato com um único paciente**: comportamento idêntico ao atual — nenhuma
   pergunta nova, `pacientes_do_contato` ausente do payload.
2. **Contato com vários pacientes, mensagem ambígua** ("quero marcar uma consulta"):
   `paciente_id` omitido, decisão `aguardando_escolha_paciente`, redatora pergunta
   sem frase fixa.
3. **Contato com vários pacientes, mensagem inequívoca** ("para minha mãe Marta"):
   `paciente_id` da Marta emitido no mesmo turno, sem pergunta extra — caso real do
   defeito original.
4. **`paciente_id` inventado ou de outro contato/clínica**: `validarEscolhaPaciente`
   descarta, nunca usado para localizar paciente. **Par negativo de isolamento
   estrutural (seção 2.3)**: uma tentativa de escrever `estado_conversa.paciente_id`
   com um `paciente_id` de OUTRA clínica é rejeitada pela FK composta com
   `clinica_id` no próprio banco — teste que prova a segunda camada de defesa,
   não só a validação em código.
5. **Persistência da seleção**: paciente escolhido permanece por vários turnos até
   o fluxo concluir; cadastro/plano/agendamentos consultados pertencem só a ele.
6. **Fim do assunto libera nova escolha**: após reserva/remarcação/cancelamento
   concluído, um novo pedido ambíguo aciona `aguardando_escolha_paciente` de novo,
   nunca reaproveita a seleção anterior silenciosamente.
7. **Cadastro de dependente**: novo paciente nasce vinculado ao `contato_id` atual,
   `vinculo = 'dependente'`, nunca sobrescreve o paciente já existente do mesmo
   telefone.
8. **Cadastro de paciente com telefone próprio**: novo paciente nasce com seu
   próprio `contato_id`, nunca o do contato atual — mesmo que a conversa continue
   acontecendo no telefone de quem pediu o cadastro.
9. **Concluir o atendimento atual mesmo escolhendo número próprio (seção 4.5,
   passo 5)**: Carlos cadastra a Marta com número próprio (número **sem** cadastro
   prévio); `estado_conversa.paciente_id` (do Carlos, reutilizado como seleção)
   passa a apontar para a Marta durante o fluxo, mesmo com telefones diferentes;
   a reserva é criada com `paciente_id` da Marta; ao concluir,
   `estado_conversa.paciente_id` volta a `null`. Um turno seguinte, ainda no
   telefone do Carlos, NÃO deve mostrar a Marta em `pacientes_do_contato` —
   prova de que a seleção temporária nunca virou vínculo permanente
   (`pacientes.contato_id` da Marta nunca apontou para o contato do Carlos).
10. **Vínculo é exclusivo, nunca duplo**: depois de decidido (dependente OU número
    próprio), não existe caminho no Core que faça um paciente aparecer em
    `pacientes_do_contato` de mais de um contato — teste negativo explícito,
    já que a spec anterior não deixava essa exclusividade clara.
11. **Regressão do caso real**: reconstrução do caso Carlos/Marta (sem tocar nos
    dados já corrompidos) provando que, com o schema novo, a Marta recebe
    `paciente_id` e `contato_id` próprios, e o cadastro do Carlos nunca é
    sobrescrito.
12. **Backfill não altera comportamento de paciente já existente**: após a
    migration de transição (seção 2.2), um paciente cadastrado antes desta spec
    continua resolvendo sozinho, sem pergunta nova, exatamente como hoje —
    prova de que virar `vinculo = 'titular'` do próprio contato é transparente.
13. **Terceiro já vinculado ao contato, mas não identificado na mensagem, nunca
    vira duplicata (seção 4.5, passo 1)**: contato tem Carlos e Marta (já
    cadastrada, `vinculo = 'dependente'`); mensagem emite
    `atendimento_para_terceiro: true`, `paciente_id` ausente e
    `outra_pessoa_alem_das_listadas` ausente (referência insuficiente para
    identificar qual paciente vinculado); decisão precisa ser
    `aguardando_escolha_paciente` ("é um deles ou outra pessoa?") — nunca o
    início do fluxo de "outra pessoa".
14. **"Para minha mãe Marta" com dados cadastrais no mesmo turno nunca altera
    Carlos (seção 4.4, precedência de aplicação)**: turno emite
    `atendimento_para_terceiro: true`, `paciente_id` da Marta, e também
    `data_nascimento`/`nome` (a IA capturou dados que vieram na mesma
    mensagem); nenhum desses dois últimos pode ser aplicado ao `paciente_id`
    que estava selecionado ANTES deste turno (o próprio Carlos, se a conversa
    começou nele) — a ficha do Carlos precisa permanecer bit a bit idêntica
    ao estado anterior ao turno.
15. **Trocar de Carlos para Marta não transporta cadastro nem dados
    operacionais de Carlos (seção 4.4, limpeza na troca)**: com
    `data_texto`/`horario_texto`/`procedimento_id` já acumulados em `dados`
    para o assunto do Carlos, a troca de `estado_conversa.paciente_id` para a
    Marta precisa limpar esses campos no mesmo turno — o turno seguinte,
    perguntando por data/horário para a Marta, não pode reaproveitar os
    valores que eram do Carlos.
16. **"Número próprio" num turno e telefone no seguinte, pessoa SEM cadastro no
    número informado (seção 4.5, passos 4-5)**: turno 1 emite
    `vinculo_novo_paciente = 'numero_proprio'` sem `telefone_novo_paciente`
    — `persistirPaciente` NÃO é chamada, decisão pede o telefone; turno 2
    emite só `telefone_novo_paciente` (mensagem só com o número) —
    `vinculo_novo_paciente` precisa ter sobrevivido do turno 1 em `dados`;
    o Core resolve o contato do número, **não encontra paciente**, coleta os
    campos faltantes e só então chama `persistirPaciente`, com `contato_id`
    resolvido a partir de `telefone_novo_paciente`, nunca do telefone da
    conversa atual.
17. **Contato só com o titular, pedido para terceiro sem dizer se tem cadastro
    (seção 4.5, passo 1, segundo ramo)**: `pacientes_do_contato` vazio; mensagem
    emite `atendimento_para_terceiro: true` e nada mais; a Iris NÃO abre
    `aguardando_escolha_paciente` (não há candidatos) — vai direto à pergunta
    "usar este número ou informar outro?", sem travar nem repetir.
18. **Terceiro já cadastrado com telefone próprio: reutiliza, não duplica
    (seção 4.5, passo 4, primeiro ramo)**: Marta já é paciente `titular` do
    contato do número dela, num cadastro sem relação com o contato do Carlos.
    Carlos escolhe "número próprio" e informa esse número; o Core resolve o
    contato, **encontra a Marta**, grava `estado_conversa.paciente_id` com o
    `paciente_id` dela e segue o fluxo operacional — **nenhum `INSERT`, nenhuma
    duplicata, nenhum campo da ficha da Marta alterado**. Ao concluir,
    `estado_conversa.paciente_id` volta a `null`; nenhum vínculo novo entre a
    Marta e o contato do Carlos.
19. **"Número próprio" para um contato de destino com vários pacientes: escolha
    validada contra a lista fresca do contato de destino (seção 4.5, passo 4,
    primeiro ramo)**: Carlos informa o número próprio de um contato que possui
    Marta e outro paciente; o Core persiste `telefone_novo_paciente` em `dados` e,
    a cada turno enquanto a escolha está pendente, relê esse telefone, resolve de
    novo o contato de destino e monta `pacientes_do_contato` contra ele. A escolha
    seguinte só aceita `paciente_id` presente nessa lista fresca do contato de
    destino; um `paciente_id` do contato do Carlos, de outro contato ou de outra
    clínica é rejeitado por `validarEscolhaPaciente` — nenhuma coluna ou estado
    novo guardando o contato de destino.
20. **Paridade Core/Edge** nos arquivos com par (seção 7), byte a byte.

## 9. Classificação dos achados

| Achado | Classificação |
|---|---|
| `pacientes` chaveada por `(clinica_id, telefone_normalizado)`, sem `contato_id` | **Bloqueador real** — causa raiz confirmada do defeito |
| `cappia_persistir_paciente` sem `paciente_id`/`contato_id`, `ON CONFLICT` por telefone | **Bloqueador real** — ponto exato da corrupção de dados |
| Nenhum campo `pacientes_do_contato`/`paciente_id` na interpretadora hoje | **Bloqueador real** — impede a IA de expressar o que já entende semanticamente |
| Dados já corrompidos do Carlos/Marta | **Fora de escopo** — reparação é operação separada, não tratada aqui |
| `vinculo` como texto livre de parentesco (não fechado) | **Risco não bloqueante** rejeitado por design — por isso o vocabulário é fechado (`titular`/`dependente`), nunca aberto |
| Extensão futura para procuração/autorização jurídica | **Melhoria opcional, fora de escopo** — não avaliada nesta spec |
| `estado_conversa_paciente_clinica_telefone_fk` depende da UNIQUE por telefone que esta spec remove (seção 2.2) | **Bloqueador real, já endereçado** — a migration de transição precisa trocar essa FK antes de remover a UNIQUE, nesta ordem exata (seção 2.2) |
| Mecanismo exato da sobrevivência do CPF do Carlos (seção 1.2) | **Confirmado por leitura de código, não é mais hipótese** — `aplicarCorrecaoCadastro` nunca envia `cpf` à RPC, por escopo de correção fechado desde 2026-09-01 |
| Nome da UNIQUE de telefone em produção difere do arquivo local (`pacientes_clinica_id_telefone_normalizado_key` vs. `pacientes_clinica_telefone_key`); `pacientes` não tem `unique (id, clinica_id)` isolada (foi dropada pela migration de correção) | **Endereçado por verificação de produção (2026-09-07)** — a migration de transição usa o nome real e recria `unique (id, clinica_id)` como passo próprio (seção 2.2, seção 7) |
| Migration local `20260804150000` declara `agendamentos` com FK composta `(paciente_id, clinica_id)`, mas produção tem FK **simples** `agendamentos_paciente_id_fkey (paciente_id)` | **Fora de escopo, registrado** — a FK de `agendamentos` já referencia `paciente_id` e não precisa mudar para resolver Carlos/Marta; esta spec não a altera (seção 1.3, seção 6). A afirmação anterior de que `agendamentos` "já usa FK composta" foi removida |
| `pessoa_nova_no_cadastro` exigia o usuário declarar que a pessoa nunca teve cadastro — falha quando ela já é paciente com telefone próprio | **Bloqueador funcional, corrigido** — substituído por `outra_pessoa_alem_das_listadas` (só "não é nenhum dos listados neste contato", sem afirmar nada sobre o banco); a existência de cadastro é resolvida por busca do Core no telefone informado, antes de qualquer `INSERT` (seção 4.5, passos 1 e 4) |
| No ramo "número próprio", se o telefone de destino resolver para um contato com vários pacientes, qual lista valida a escolha enquanto ela está pendente | **Ambiguidade final, esclarecida** — o Core relê `telefone_novo_paciente` de `dados` a cada turno, resolve de novo o contato de destino e monta/valida `pacientes_do_contato` contra ele, nunca contra o contato de quem conversa; nenhuma coluna ou estado novo (seção 4.5, passo 4, teste 19) |
| `pacientes.contato_id` só pode virar `NOT NULL` se todo paciente tiver `telefone_normalizado` para o backfill | **Pré-condição verificada (leitura de produção, 2026-09-07)** — os 21 pacientes atuais têm `telefone_normalizado` preenchido; o backfill não encontra registros nulos. Nenhum tratamento adicional criado (seção 2.2) |

## Aprovação

**Aprovada para implementação em 2026-09-07** — revisão de arquitetura, segurança e
aderência do Codex concluída (última rodada: ambiguidade do ramo "número próprio"
com contato de destino multi-paciente, esclarecida sem mudança de arquitetura;
pré-condição do backfill verificada por leitura de produção). Aprovação explícita
do Gabriel.

Esta aprovação **não** autoriza, por si só, a execução: implementação de código,
migration, backfill e qualquer mudança em produção dependem de autorização
separada do Gabriel, por ação. Nada foi aplicado ainda.
