# Remarcação — contrato operacional v1

**Status:** especificação **fechada e aprovada pelo Gabriel em 2026-08-10**, ainda **não
implementada**. Nenhuma migration, RPC, coluna, índice, tipo ou linha de código é criada por
este documento.

Escopo: exclusivamente a **camada operacional** da remarcação — localizar o agendamento
ativo do paciente, trocá-lo por um novo de forma atômica e idempotente. A camada
conversacional (eventos, prompt, decisões do orquestrador, escolha entre múltiplos
agendamentos) **não é aberta aqui** e será spec própria, depois desta.

Antecede: `docs/06-roadmap.md`, item "Remarcação" — primeira frente aberta depois do
fechamento de novo agendamento (`handoffs/2026-08-10-fechamento-novo-agendamento.md`).

## Aderência a `docs/00-principios.md`

- **Responsabilidade correta.** A RPC não resolve dentista, procedimento, duração,
  disponibilidade nem linguagem — recebe tudo **já resolvido** pelo Core. Ela valida,
  garante integridade e executa uma operação determinística; nada além disso.
- **Remoção.** Nenhuma tabela nova. **Uma única coluna aditiva**, e somente no banco dev —
  no operacional ela **já existe** (seção 4). Duas tabelas legadas de estado conversacional
  (`comandos_remarcacao`, `remarcacoes_pendentes`) foram auditadas e **recusadas** (seção 6).
  Nenhum mecanismo novo de idempotência: o índice único que resolve o problema já existe e
  já foi exercitado em produção (seção 5). **Nenhum parâmetro novo em
  `carregar-disponibilidade.ts`** — a alternativa foi avaliada na revisão de 2026-08-10 e
  recusada em favor de uma limitação aceita (seção 10). **`duracao_min` não entra no
  contrato da busca** por não ter consumidor (seção 2).
- **Teste isolado.** O par A/B obrigatório do filtro temporal está na seção 7: mesma linha
  no banco, variando só `instante_atual`, exigindo que os dois lados difiram.
- **Testes realistas.** Esta spec é operacional e não contém frases de paciente; o princípio
  se aplicará à spec conversacional que a sucede.

## Decisão canônica (Gabriel, 2026-08-10)

1. Reutilizar exclusivamente `resolver-disponibilidade.ts` e `carregar-disponibilidade.ts`
   para achar o novo horário. **Nunca** `cappia_disponibilidade_canonica` nem qualquer
   resolver SQL legado. **Nenhum dos dois módulos é alterado** — nem por parâmetro novo, nem
   por filtro novo. O agendamento atual do paciente **continua contando como ocupado** na
   disponibilidade, com a limitação que isso implica formalmente aceita (seção 10).
2. RPC nova, mínima, recebendo identificadores já resolvidos pelo Core.
3. Vínculo pela menor coluna necessária.
4. Idempotência pelo mínimo possível, preferindo constraint/estado já existente.
5. **Agendamento ativo exige status confirmado *e* ainda não passado** — sem depender de a
   clínica atualizar `confirmado → concluido/faltou`.

## 1. Definição de agendamento ativo

Um agendamento é **ativo**, para efeito de remarcação, quando as duas condições valem:

- `status = 'confirmado'`; **e**
- ainda não passou, em relação a `instante_atual`.

| situação | desfecho |
|---|---|
| data futura | **válido** |
| hoje + horário futuro | **válido** |
| hoje + horário passado | **excluir** |
| data passada | **excluir** |

### Por que a segunda condição é obrigatória

Nada move um agendamento de `'confirmado'` para outro status com a passagem do tempo. Na
tabela do Core novo (dev) as colunas que sustentavam essa automação legada
(`concluido_em`, `pos_consulta_enviado`) **não existem** — foram deliberadamente excluídas
em `20260804150000_iris_nova_reaproveitamento_agendamento_v1.sql`. `'confirmado'` é,
portanto, permanente.

**Evidência de banco (operacional `udizowyfjnhuhgxkeayk`, leitura read-only 2026-08-10):**
existe exatamente **uma** linha com `status='confirmado'`, e ela **já está no passado**
(`data < current_date`). Sem esta condição, a primeira remarcação real ofereceria remarcar
uma consulta vencida. Não é caso extremo — é o caso normal de qualquer paciente que volta.

### Comparação: forma exata

O corte usa o **horário de início** (`horario`), nunca o fim (`horario + duracao_min`).
Consequência declarada: um agendamento **em andamento** não é ativo para remarcação. É a
leitura literal da regra aprovada ("hoje + horário passado → excluir") e a mais simples;
fica registrada aqui para não ser redescoberta como surpresa.

A comparação é **estritamente futura**: `minuto_inicio > instante_atual.minuto_min`. No
minuto exato, exclui.

`instante_atual` é o `InstanteAtual { data, minuto_min }` já canônico, derivado do
**fuso da clínica** (`clinicas.fuso_horario`), exatamente como `carregar-disponibilidade.ts`
já faz. Nunca `Date.now`, nunca relógio da máquina, nunca `current_date` do Postgres.

### Onde cada metade do filtro é aplicada

- **`data >= instante_atual.data`** — no `SELECT`, no banco.
- **desempate do mesmo dia por minuto** — no TypeScript, com a mesma conversão `HH:MM →
  minutos` que `carregar-disponibilidade.ts` já usa.

Isso **não** é preferência de estilo. `horario` é `text` nos dois bancos e o formato aceita
hora de um dígito (`agendamentos_horario_formato CHECK (horario ~ '^[0-9]{1,2}:[0-9]{2}$')`
no dev; no operacional **não existe CHECK nenhum** e a coluna é nula-permitida). Comparar
esses textos lexicograficamente em SQL erra: `'9:00' > '14:00'` é verdadeiro. A conversão
para minutos é a única comparação correta.

**Falha fechada, e só onde o dado é indispensável.** Linha com `data` ou `horario` ausente
ou malformado é **descartada** — sem esses dois campos o corte temporal desta seção é
incalculável. Nunca corrigida nem inventada, mesma disciplina já aplicada em
`carregar-disponibilidade.ts`. No operacional as duas colunas são nula-permitidas.

**`duracao_min` nunca descarta.** Ela não participa do corte temporal (que usa só o
início) nem do contrato da busca (seção 2). Um agendamento confirmado e futuro com
`duracao_min` nulo ou malformado **continua sendo um agendamento ativo** — descartá-lo faria
a Iris responder "você não tem agendamento" a um paciente que tem. Decisão do Gabriel,
2026-08-10.

## 2. Contrato da busca interna

Adapter novo `src/core/buscar-agendamento-ativo.ts`, no padrão de `carregar-catalogo.ts`:
`SELECT` direto, sem RPC, sem decisão de domínio.

```ts
export interface EntradaBuscarAgendamentoAtivo {
  clinica_id: string;
  paciente_id: string;
  instante_atual: InstanteAtual;
}

export interface AgendamentoAtivo {
  agendamento_id: string;
  data: string;            // YYYY-MM-DD
  horario: string;         // HH:MM
  dentista_id: string;
  dentista_nome: string | null;
  procedimento_id: string;
  procedimento: string | null;
}

export type ResultadoBuscarAgendamentoAtivo =
  | { tipo: 'nenhum' }
  | { tipo: 'unico'; agendamento: AgendamentoAtivo }
  | { tipo: 'multiplos'; agendamentos: AgendamentoAtivo[] };
```

Consulta: `clinica_id` + `paciente_id` + `status='confirmado'` + `data >= instante_atual.data`,
ordenada por `data, horario`. `SELECT` de sete colunas — `id, data, horario, dentista_id,
dentista_nome, procedimento_id, procedimento`. Depois, no TypeScript: descarte das linhas
sem `data`/`horario` válidos e das de hoje já passadas; ordenação final por
`(data, minuto_inicio)`.

**`duracao_min` não é lida nem devolvida.** Auditoria de consumidores (2026-08-10): a RPC
recebe `p_duracao_min` **novo**, resolvido por `resolverDuracao` a partir de
`procedimento_id + dentista_id` — a duração antiga não entra em nenhum cálculo; e a camada
conversacional precisa de data, horário, dentista e procedimento, não de duração. Um campo
sem consumidor não entra no contrato.

**`multiplos` devolve a lista e para.** Nenhuma escolha é feita aqui, nenhuma pergunta é
formulada — isso é da spec conversacional. `AgendamentoAtivo` carrega o mínimo necessário
para que aquela spec possa apresentar as opções sem uma segunda consulta.

**Isto não é "consulta do próprio agendamento".** Aquela frente do roadmap continua fechada:
sem histórico, sem cancelados, sem passados, sem apresentação ao paciente. Este adapter
existe só para alimentar a remarcação.

Cliente: `ClienteBancoDados` (`tipos.ts`), como `carregar-catalogo.ts`.

## 3. Contrato da RPC

**Nome: `cappia_remarcar_agendamento_v2`.** O nome sem sufixo **já existe no banco
operacional**, com outra assinatura e outra responsabilidade (resolve dentista, procedimento
e duração dentro do SQL). Sobrescrevê-lo trocaria o corpo de uma função legada viva em
produção — proibido aqui.

```
cappia_remarcar_agendamento_v2(
  p_clinica_id      uuid,
  p_paciente_id     uuid,
  p_agendamento_id  uuid,
  p_dentista_id     uuid,
  p_procedimento_id text,
  p_duracao_min     integer,
  p_nova_data       date,
  p_novo_horario    text
) returns jsonb
```

Vocabulário fechado de retorno:

| retorno | significado |
|---|---|
| `{ sucesso: true, agendamento_id, agendamento_id_antigo, data, horario, dentista_id, duracao_min }` | remarcado |
| `{ sucesso: true, ja_remarcado: true, ... }` | replay — já havia sido remarcado (seção 5) |
| `{ sucesso: false, motivo: 'agendamento_nao_encontrado' }` | não existe, ou não é desta clínica/deste paciente |
| `{ sucesso: false, motivo: 'nao_confirmado' }` | existe, mas não está `'confirmado'` |
| `{ sucesso: false, motivo: 'data_invalida' }` | `p_nova_data` nula |
| `{ sucesso: false, motivo: 'horario_invalido' }` | formato ou faixa civil inválidos |
| `{ sucesso: false, motivo: 'duracao_invalida' }` | `p_duracao_min` nula ou `<= 0` |
| `{ sucesso: false, motivo: 'horario_ocupado' }` | novo horário conflita (revalidação técnica) |
| `{ sucesso: false, motivo: 'erro_insercao' }` | falha inesperada de escrita |

### Ordem de operações — única transação

1. Validar forma: `p_nova_data`, `p_novo_horario` (regex + hora `<= 23`, minuto `<= 59`),
   `p_duracao_min > 0`.
2. `SELECT ... FOR UPDATE` por `id = p_agendamento_id AND clinica_id = p_clinica_id AND
   paciente_id = p_paciente_id`. Não encontrado → `agendamento_nao_encontrado`.
3. Se `status = 'remarcado'` → caminho de replay (seção 5).
4. Se `status <> 'confirmado'` → `nao_confirmado`.
5. `pg_advisory_xact_lock` por `clinica_id:dentista_id:dia`, dia a dia sobre o intervalo
   novo — **idêntico** a `cappia_reservar_agendamento`.
6. Conflito por `tsrange`, entre agendamentos `'confirmado'` do mesmo dentista, **excluindo
   `p_agendamento_id`** → `horario_ocupado`.
7. `UPDATE` do antigo para `status = 'remarcado'`.
8. `INSERT` do novo com `status = 'confirmado'`, `remarcado_de = p_agendamento_id`, e os
   dados cadastrais copiados da linha antiga (`nome`, `documento`, `telefone`,
   `tipo_documento`, `paciente_id`).

O passo 6 é a **revalidação técnica** já canônica (`04-decisoes-canonicas.md`): proteção
contra o horário ter sido ocupado entre a oferta e a confirmação, nunca um novo turno de
pergunta ao paciente.

Os passos 7 e 8 nunca são observáveis separadamente: `FOR UPDATE` e advisory lock são
transacionais, e a função inteira roda numa única transação implícita.

### O que a RPC não faz

Não chama `cappia__resolver_dentista`, `cappia__resolver_procedimento`,
`cappia__resolver_duracao` nem `cappia_disponibilidade_canonica`. Não interpreta texto, não
escolhe dentista, não calcula duração, não gera opções de horário. Tudo isso já foi
resolvido pelo Core, em TypeScript, pelos módulos que o novo agendamento já usa.

**`agendamento_nao_encontrado` cobre deliberadamente três casos** (inexistente, de outra
clínica, de outro paciente). O retorno não distingue: distinguir revelaria a existência de
uma ficha alheia. Mesma disciplina de `cpf-outro-telefone-v1.md` §4.

### Adapter

`src/core/remarcar-agendamento.ts`, molde exato de `reservar-agendamento.ts`: uma chamada,
sem retry, validação estrita de entrada (UUID/data/horário) e de saída (vocabulário fechado
de motivo), **nunca** propaga `error.message` nem o payload bruto. Cliente `ClienteRpc`.

## 4. Vínculo — auditoria e DDL mínimo

Auditoria dos dois bancos (read-only, 2026-08-10):

| | operacional `udizowyfjnhuhgxkeayk` | dev `bcmuqautblvjdqzhjfbw` |
|---|---|---|
| `remarcado_de uuid` | **já existe** | ausente |
| FK → `agendamentos(id)` | **já existe** (`ON DELETE SET NULL`) | — |
| índice único parcial | **já existe** (`agendamentos_remarcado_de_uniq`, `WHERE remarcado_de IS NOT NULL`) | — |

**Operacional: zero DDL.** A coluna, a FK e o índice já estão lá, herdados do schema legado
completo e nunca removidos.

**Dev: uma migration aditiva, três comandos.**

```sql
alter table agendamentos add column remarcado_de uuid;

alter table agendamentos add constraint agendamentos_remarcado_de_fkey
  foreign key (remarcado_de) references agendamentos(id) on delete set null;

create unique index agendamentos_remarcado_de_uniq
  on agendamentos (remarcado_de) where remarcado_de is not null;
```

**O vínculo fica na linha nova, apontando para a antiga.** Nunca na antiga. Assim a linha
antiga fica imutável depois do `UPDATE` de status, e o `INSERT` não exige um segundo
`UPDATE`.

**Uma coluna basta.** Nenhuma tabela nova.

**FK simples, não composta.** A regra de FK composta com `clinica_id` (`P4I.22`) é canônica,
mas `P4I` não está implementada e `agendamentos` não é tabela de `P4I`. A FK composta
exigiria uma constraint `unique (id, clinica_id)` nova, para fechar um risco que a RPC já
fecha deterministicamente: ela filtra por `clinica_id` no `SELECT ... FOR UPDATE` e insere a
linha nova com o mesmo `p_clinica_id`. Estrutura a mais para risco já eliminado.
**Divergência registrada explicitamente, nunca reconciliada em silêncio.**

A FK simples é também a que **já existe** no operacional — replicá-la no dev mantém contrato
observável idêntico entre os bancos, que é a disciplina já estabelecida na Etapa 1 e na
troca de telefone.

**Nenhum índice novo para a busca da seção 2.** Nenhum dos dois bancos tem índice sobre
`(clinica_id, paciente_id, status)`. No volume atual é irrelevante. Registrado como
não-decisão consciente, para reavaliar se houver volume real.

Formato da migration conforme `DA-P4-03`: `AAAAMMDDHHMMSS_<nome_logico>.sql`, versão UTC
única e crescente, arquivo nunca alterado depois de aplicado. Preflight read-only
imediatamente antes de aplicar, nos dois bancos.

## 5. Idempotência

Sem nenhum mecanismo novo. O índice único parcial da seção 4 já existe no operacional, e a
RPC legada já mapeia `unique_violation → 'ja_remarcado'` — prova de que o mecanismo foi
exercitado em produção.

### Caso A — mesma confirmação criar duas remarcações

Duas execuções concorrentes com o mesmo `p_agendamento_id` colidem no
`SELECT ... FOR UPDATE` do passo 2: a segunda **bloqueia** até a primeira comitar. Sob
`READ COMMITTED`, ao ser liberada ela reavalia a linha e a lê **com o status já atualizado**
(`'remarcado'`) — porque `status` não faz parte do predicado do `WHERE`. Ou seja, ela cai
naturalmente no passo 3, caminho de replay. Nenhuma segunda linha é criada.

O índice único é o **backstop**, não o mecanismo principal: se por qualquer via um `INSERT`
com `remarcado_de` repetido for tentado, ele falha. O handler de `unique_violation` converge
para o mesmo caminho de replay.

### Caso B — chamada repetida remarcar de novo o mesmo agendamento

Ao encontrar o antigo com `status = 'remarcado'`, a RPC **não devolve erro**: busca a linha
com `remarcado_de = p_agendamento_id AND clinica_id = p_clinica_id` e devolve
`{ sucesso: true, ja_remarcado: true, ... }` com os dados da linha nova.

Padrão idêntico ao `ja_cancelado: true` que `cappia_cancelar_agendamento` já usa hoje no
operacional — reaproveitamento de forma, não invenção.

**Por que replay e não erro.** Se a repetição retornasse `nao_confirmado`, um timeout de
rede **depois** do commit faria a retentativa parecer falha, e a Iris diria ao paciente que
a remarcação não deu certo quando ela deu. O desfecho errado seria visível ao paciente e
levaria a uma segunda tentativa de remarcação sobre um agendamento que já não existe.

**Caso degenerado declarado:** `status = 'remarcado'` **sem** linha sucessora só é
alcançável por intervenção manual no banco. Nesse caso o retorno é `nao_confirmado` — nunca
uma remarcação nova sobre estado inconsistente.

## 6. Legado auditado e recusado

Auditoria read-only do banco operacional (2026-08-10). Nada abaixo é reaproveitado.

| artefato legado | decisão |
|---|---|
| `comandos_remarcacao` (tabela) | **recusada** — estado conversacional multi-turno em tabela; o Core novo já tem `estado_conversa` + `contexto_horarios` |
| `remarcacoes_pendentes` (tabela) | **recusada** — mesmo motivo |
| `cappia_remarcar_agendamento` (RPC) | **recusada** — resolve dentista/procedimento/duração dentro do SQL, recriando a inteligência semântica que `procedimento-semantico-v1.md` e `dentista-semantico-v1.md` removeram |
| `cappia_confirmar_remarcacao_canonica` (RPC) | **recusada** — assinatura mais próxima da nossa, mas chama `cappia_disponibilidade_canonica` no caminho de conflito, criando segunda fonte de verdade de disponibilidade |
| padrão de lock + `tsrange` | **reaproveitado** — mesma forma já usada em `cappia_reservar_agendamento`, provada em produção |
| `remarcado_de` + índice único | **reaproveitado** — já existe no operacional (seção 4) |

## 7. Testes obrigatórios

**Busca interna (seção 2)**

1. Zero agendamentos ativos → `nenhum`.
2. Um agendamento ativo → `unico`.
3. Dois ou mais ativos → `multiplos`, ordenados por `(data, minuto_inicio)`.
4. **Par A/B obrigatório do filtro temporal** — mesma linha no banco (hoje, `14:00`),
   variando **só** `instante_atual`: às `13:00` → `unico`; às `15:00` → `nenhum`. **Os dois
   lados precisam diferir** — sem isso o teste não prova que o filtro tem efeito.
5. Data passada → `nenhum`.
6. Minuto exato (`instante_atual.minuto_min` = início do agendamento) → `nenhum`.
7. Status `cancelado` / `remarcado` / `concluido` / `faltou` → `nenhum`.
8. Linha com `horario` de hora de um dígito (`'9:00'`) e `instante_atual` às `14:00` do mesmo
   dia → `nenhum`. **Regressão direta da comparação lexicográfica** descrita na seção 1.
9. Linha com `data` ou `horario` nulo/malformado → descartada, nunca retornada.
9-bis. **Linha confirmada e futura com `duracao_min` nulo → retornada normalmente.**
   Regressão direta da decisão de 2026-08-10: a ausência de duração nunca pode produzir
   `nenhum`.
10. Isolamento: agendamento de outra clínica e de outro paciente nunca aparecem.

**RPC (SQL, nos dois bancos)**

11. Agendamento de outra clínica → `agendamento_nao_encontrado`.
12. Agendamento de outro paciente → `agendamento_nao_encontrado`.
13. Status `cancelado` → `nao_confirmado`.
14. Novo horário ocupado por terceiro → `horario_ocupado`; **zero escrita**.
15. Novo horário **igual ao horário atual do próprio agendamento** → sucesso. Prova que a
    exclusão `a.id <> p_agendamento_id` existe — sem ela, o agendamento conflitaria consigo
    mesmo.
    **Este teste prova o contrato da RPC, não o fluxo.** Com a limitação aceita na seção 10,
    a disponibilidade nunca oferece um horário que sobreponha o agendamento atual, então
    este caso **não é alcançável por um paciente na v1**. A cláusula permanece como guarda
    defensiva da RPC — ela recebe o horário de quem chamar, não só do fluxo conversacional.
    Declarado aqui explicitamente para que o resultado verde **nunca seja lido como prova de
    comportamento de produção** (`00-principios.md`, princípio do teste isolado).
16. Sucesso normal → antigo `'remarcado'`, novo `'confirmado'`, `remarcado_de` preenchido,
    dados cadastrais copiados.
17. Segunda chamada idêntica → `ja_remarcado: true` com o **mesmo** `agendamento_id` da
    primeira.
18. Duas execuções concorrentes → uma vence, a outra devolve replay; **exatamente uma** linha
    nova existe ao final; nenhuma linha órfã.
19. `status = 'remarcado'` sem sucessora → `nao_confirmado`.
20. `p_duracao_min <= 0` → `duracao_invalida`; `p_novo_horario = '24:00'` → `horario_invalido`.

**Adapter**

21. Validação de entrada (UUID, data, horário) e de saída (vocabulário fechado).
22. `error.message` nunca propagado; payload bruto da RPC nunca vaza.

## 8. Fora de escopo

Eventos conversacionais de remarcação; prompt e instruções da interpretadora; decisões do
orquestrador; redação ao paciente; escolha conversacional entre múltiplos agendamentos;
**cancelamento**; consulta completa do próprio agendamento; atualização cadastral isolada;
remarcação que troque de dentista ou de procedimento; notificação/lembrete da mudança;
Google Calendar (`event_id`/`calendar_id` da linha nova nascem nulos, como já acontece na
reserva).

## 9. Pendências abertas por esta spec

- **A spec conversacional da remarcação não existe.** Sem ela, nada deste contrato é
  alcançável por um paciente — é infraestrutura, não funcionalidade entregue.
- **`multiplos` não tem desfecho definido.** A busca devolve a lista; quem escolhe é a spec
  conversacional. Registrado como lacuna deliberada, não como esquecimento.
- **FK simples em vez de composta** diverge de `P4I.22` (seção 4). Reavaliar quando `P4I`
  entrar em vigor.
- **`ON DELETE SET NULL`** na FK do operacional apaga o vínculo em silêncio se um
  agendamento for deletado. Herdado do legado, não introduzido aqui; nada neste fluxo deleta
  linhas. Registrado para não ser redescoberto.
- **Sem índice para a busca** (seção 4). Reavaliar com volume real.

## 10. Limitações conhecidas e aceitas

Decisões do Gabriel em 2026-08-10, tomadas sobre os dois achados da revisão adversarial da
spec. Registradas como **limitação aceita**, nunca como pendência a resolver — a diferença
importa: uma pendência pede trabalho futuro, uma limitação aceita foi decidida.

### 10.1 O agendamento atual conta como ocupado na própria disponibilidade

`carregar-disponibilidade.ts` marca **todos** os agendamentos `'confirmado'` do dentista no
dia como indisponíveis, sem exceção por `id`. Na remarcação, isso inclui o agendamento que o
paciente está tentando mover.

**Consequência real.** Paciente com 14:00–15:00 no dia 15 que peça outro horário no **mesmo
dia**: a faixa 14:00–15:00 permanece marcada como ocupada, então horários que dependam de
liberá-la (ex.: 13:30 ou 14:30, com duração de 60 min) **não são oferecidos**. Outros
horários do mesmo dia e qualquer horário de outro dia são oferecidos normalmente.

**Alternativa avaliada e recusada.** Um parâmetro opcional `agendamento_id_ignorado` em
`EntradaCarregarDisponibilidade`, repassado como `.neq('id', ...)`, mais a atualização do
validador de forma estrita. **Recusada por decisão do Gabriel:** não aumentar a arquitetura
por este caso na v1. `carregar-disponibilidade.ts` e `resolver-disponibilidade.ts`
permanecem **intocados**.

**O que isso custa, declarado sem eufemismo.** O paciente vê menos opções do que existem, no
mesmo dia, num intervalo do tamanho da duração do procedimento. Não é erro de dado, não gera
conflito, não cria escrita incorreta e não trava a conversa — a remarcação para qualquer
outro horário funciona. O desfecho ruim possível é "menos opções oferecidas", nunca
"agendamento errado gravado".

**Quando reabrir.** Se aparecer evidência de conversa real em que um paciente insista num
horário adjacente ao próprio e a Iris não consiga oferecê-lo. Antes disso, não.

### 10.2 `duracao_min` fora do contrato da busca

Removida de `AgendamentoAtivo` e do critério de descarte por não ter consumidor (seção 2). A
duração da nova reserva continua sendo resolvida pelo mecanismo canônico — `resolverDuracao`
a partir de procedimento + dentista. Não é limitação, é remoção: fica registrada aqui só
para a decisão ter um lugar único.
