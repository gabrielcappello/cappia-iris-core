# Dias de atendimento por dentista — especificação

Levantado em 2026-08-25. Este documento existiu inicialmente para revisão
do Codex e aprovação do Gabriel antes de qualquer mudança em código ou
banco.

**Revisão 2 (2026-08-25):** aprovada pelo Gabriel com um ajuste de escopo e
resposta aos três pontos em aberto da v1. Nenhum código foi alterado até
esse ponto, só o documento.

**Status: IMPLEMENTADO e revisado pelo Codex (2026-08-25), sem
bloqueadores.** Mudanças aplicadas em `carregar-disponibilidade.ts` (e seu
espelho na Edge Function), testes novos em
`carregar-disponibilidade.test.ts`, tipo `Dentista` e UI do card do
dentista em `iris-portal-v2`, e traduções nos 8 idiomas do painel — todas
conforme as decisões fechadas na revisão 2 abaixo, sem desvio. Commits
preparados, ainda **não enviados** (push/deploy pendentes de autorização
explícita do Gabriel).

## Objetivo

Na aba de configurações do dentista (painel, bloco "Horários" de cada
dentista), hoje não existe forma de escolher **quais dias da semana** o
dentista atende — só existe um horário único aplicado implicitamente a
segunda-sexta, mais um toggle separado para sábado. O pedido do Gabriel:
uma linha de dias (segunda a sábado) dentro da janela de horários, cada dia
clicável para ligar/desligar, com **padrão segunda a sexta ativo**.

Escopo é a configuração do dentista. A configuração de horário de
funcionamento da clínica (outro bloco, já existente e não tocado aqui) está
fora de escopo — o Gabriel confirmou isso explicitamente durante o
levantamento.

**Escopo do efeito, precisado na revisão 2 (decisão do Gabriel):**
`dias_semana` controla **somente os horários que a Iris oferece
automaticamente ao paciente no WhatsApp** — ou seja, só
`construirJornadas()` em `carregar-disponibilidade.ts` (seção "Backend"
abaixo). O agendamento manual pela clínica (spec separada,
`agendamento-manual-v1.md`, ainda não implementada) **não é afetado**: a
clínica pode criar um agendamento manual num dia em que o dentista
normalmente não atende — é uma exceção deliberada, não um bug. Quando a
validação de disponibilidade do agendamento manual for implementada
(caminho ainda a definir — a spec de agendamento manual não especifica um
arquivo `disponibilidade-agendamento-manual.ts`; esse nome não existe hoje
no repositório, verificado por busca), ela **não deve** checar
`dias_semana`. Isso é uma restrição a lembrar quando aquela spec for
implementada, não algo a implementar aqui.

## Estado atual verificado

### Front (`iris-portal-v2`)

Bloco "Horários" de cada dentista, dentro do card de edição, em
`src/app/dashboard/page.tsx:1795-1864`:

- `d.inicio` / `d.fim` (`src/app/dashboard/page.tsx:1800,1804`) — horário
  único, aplicado implicitamente a segunda-sexta. Não existe campo para
  desligar um dia individual dentro desse intervalo.
- `d.alm_ini` / `d.alm_fim` (`:1834,1838`) — almoço, mesmo intervalo todo
  dia ativo.
- `d.sabado` (boolean, `:1848`) + `d.sab_ini`/`d.sab_fim` (`:1857,1861`) —
  toggle "Atende sábado" com horário próprio, condicional
  (`{d.sabado&&(...)}`, `:1853`).
- Domingo não existe em nenhum campo do dentista.

Tipo `Dentista` em `src/lib/supabase.ts:151-156`:

```ts
export type Dentista = {
  id?: string; nome: string; titulo: string; calendar_id?: string; token_acesso?: string; cor?: string; senha: string; ativo: boolean;
  inicio: string; fim: string; dur: number; alm_ini: string; alm_fim: string;
  sabado: boolean; sab_ini: string; sab_fim: string; horarios: string; modo: string;
  whatsapp: string; procedimentos: {id?:string;nome:string;ativo:boolean;tempo:number}[];
};
```

Não há campo de dias individuais. O objeto inteiro do dentista é persistido
como item do array jsonb `clinicas.dentistas` (tabela `clinicas`,
`src/lib/database.types.ts:309`, coluna `dentistas: Json | null`) — não
existe tabela `dentistas` própria no banco.

### Backend (`cappia-iris-core`) — quem decide se o dentista atende num dia

`construirJornadas()`, em
`src/core/carregar-disponibilidade.ts:214-248` (mesmo código duplicado em
`supabase/functions/iris-nova-mensagem/carregar-disponibilidade.ts`, a
Edge Function em produção que atende a Iris no WhatsApp):

```ts
function construirJornadas(
  clinicaId: string,
  dentistaId: string,
  data: string,
  dentista: DentistaCarregado
): ResultadoJornadas {
  const diaSemana = diaDaSemanaLocal(data);
  if (diaSemana === null) return { tipo: 'configuracao_ilegivel' };

  // 0=segunda .. 6=domingo
  if (diaSemana === 6) return { tipo: 'sem_expediente_no_dia', motivo: 'domingo' };

  let inicio: unknown;
  let fim: unknown;
  if (diaSemana === 5) {
    if (dentista.sabado !== true) return { tipo: 'sem_expediente_no_dia', motivo: 'profissional_nao_atende' };
    inicio = dentista.sab_ini;
    fim = dentista.sab_fim;
  } else {
    inicio = dentista.inicio;
    fim = dentista.fim;
  }
  // ...
}
```

**Ponto central desta spec:** o branch `else` (dias 0-4, segunda-sexta)
**sempre** usa `dentista.inicio`/`dentista.fim`, sem checar o dia
individual. Isso significa que mudar só a UI do painel, sem tocar aqui, não
teria efeito nenhum — o dentista poderia desmarcar "quarta" no painel e a
Iris continuaria oferecendo horário de quarta-feira no WhatsApp, porque o
backend nunca olha o dia específico dentro de segunda-sexta.

`carregar-disponibilidade.test.ts` cobre o comportamento atual e precisa de
casos novos (ver seção Testes).

## Decisão de modelagem (confirmada com o Gabriel)

- **Um único horário para todos os dias ativos de segunda-sexta** — não há
  horário individual por dia (ex.: sexta não pode ter um fechamento
  diferente de terça). `inicio`/`fim`/`alm_ini`/`alm_fim` continuam sendo
  um valor só, como hoje.
- **Sábado mantém horário próprio** (`sab_ini`/`sab_fim`), como hoje — não
  é absorvido pela linha de dias com o mesmo horário dos demais.
- **Domingo continua fora** — não faz parte da linha de dias, mesmo
  comportamento atual (`sem_expediente_no_dia`, motivo `domingo`, sempre).

Ou seja, a mudança real é: os dias segunda-sexta deixam de ser um bloco
fixo "sempre todos ativos" e passam a ser 5 toggles independentes, cada um
usando o mesmo `inicio`/`fim`/`alm_ini`/`alm_fim` já existente. Sábado só
ganha uma posição na mesma linha visual, mas sua lógica (`sabado` boolean +
`sab_ini`/`sab_fim`) não muda de forma.

## Modelo de dados proposto

Novo campo no objeto `Dentista`, dentro do jsonb `clinicas.dentistas`:

```ts
dias_semana?: {
  seg: boolean; ter: boolean; qua: boolean; qui: boolean; sex: boolean;
};
```

**Default quando ausente: todos `true`** (segunda-sexta ativo) — obrigatório
para não quebrar dentistas já cadastrados, cujo jsonb não terá essa chave
até serem salvos de novo pelo painel. O default precisa ser aplicado nos
dois lugares que leem o campo (front ao renderizar o card, backend ao
resolver jornada), não só um — se só o backend tiver o default e o front
não, um dentista existente apareceria com a linha de dias toda apagada até
o Gabriel abrir e salvar cada um manualmente.

`sabado` continua como está (boolean solto, não entra em `dias_semana`).

## Mudanças propostas

### 1. Tipo `Dentista` (`src/lib/supabase.ts:151-156`, repo `iris-portal-v2`)

Adicionar `dias_semana?: {seg:boolean;ter:boolean;qua:boolean;qui:boolean;sex:boolean}`.

### 2. UI do card do dentista (`src/app/dashboard/page.tsx`, repo `iris-portal-v2`)

Dentro do `SubBloco` de horários (`:1795`), antes da linha de
abertura/encerramento (`:1797`): uma linha com 6 botões (Seg Ter Qua Qui Sex
Sáb). Clicar em Seg-Sex alterna a chave correspondente em `dias_semana`;
clicar em Sáb alterna o `sabado` boolean já existente (reaproveita o
mesmo estado, só muda de onde é acionado).

O toggle "Atende sábado" (`:1844-1851`, texto Sim/Não) é removido como
controle separado — sábado passa a ser ligado/desligado só pelo clique no
"Sáb" da linha. O bloco condicional de horário de sábado (`:1853-1864`)
continua igual, condicionado ao mesmo `d.sabado`.

**Zero dias ativos é permitido (decisão do Gabriel, revisão 2)** — não há
mínimo de um dia. Um dentista com todos os dias de `dias_semana`
desligados (e `sabado === false`) simplesmente não tem nenhum horário
oferecido pela Iris; isso é um estado válido (ex.: dentista temporariamente
fora da agenda automática, mas ainda recebendo agendamento manual). Nenhuma
validação de "pelo menos um dia" entra no form.

### 3. `construirJornadas()` (`src/core/carregar-disponibilidade.ts` e a
cópia em `supabase/functions/iris-nova-mensagem/carregar-disponibilidade.ts`,
repo `cappia-iris-core`)

No branch `else` (dias 0-4), antes de usar `dentista.inicio`/`dentista.fim`,
checar o dia individual:

```ts
const CHAVE_POR_DIA: Record<number, keyof DiasSemana> = { 0: 'seg', 1: 'ter', 2: 'qua', 3: 'qui', 4: 'sex' };
// ...
} else {
  const chave = CHAVE_POR_DIA[diaSemana];
  const ativo = dentista.dias_semana?.[chave] ?? true; // ausente = todos ativos (compat)
  if (!ativo) return { tipo: 'sem_expediente_no_dia', motivo: 'profissional_nao_atende' };
  inicio = dentista.inicio;
  fim = dentista.fim;
}
```

O tipo `DentistaCarregado` (`:139-165`) precisa ganhar o campo
`dias_semana: unknown` na leitura do registro bruto, no mesmo padrão que os
outros campos (`sabado: unknown`, `:161`), e ser validado/normalizado no
mesmo ponto que os outros.

**Duplicação de arquivo (resolvido, revisão 2):** `src/core/carregar-disponibilidade.ts`
e `supabase/functions/iris-nova-mensagem/carregar-disponibilidade.ts` são
hoje idênticos, mas **não há sincronização automática confirmada** entre os
dois (nenhum build/copy step identificado). A mudança entra nos **dois
arquivos manualmente**, como duas edições explícitas e verificadas
separadamente — não uma edição com expectativa de que a outra copie
sozinha.

### 4. Migração de dados existentes

Sem migração de banco necessária — `dias_semana` ausente já significa
"todos ativos" tanto no front quanto no backend (default aplicado em
leitura, não em escrita). Um dentista cadastrado antes desta mudança
continua se comportando exatamente como hoje até alguém desmarcar um dia
pelo painel, momento em que o jsonb passa a incluir a chave.

## Testes obrigatórios antes de considerar pronto

1. Dentista com `dias_semana` ausente (registro antigo) — comportamento
   idêntico ao atual em todo dia da semana (regressão).
2. Dentista com `dias_semana.qua = false` — `construirJornadas()` devolve
   `sem_expediente_no_dia` numa quarta-feira, mas continua atendendo
   normalmente terça e quinta com o mesmo `inicio`/`fim`.
3. Sábado continua funcionando exatamente como hoje (`sabado === true` +
   `sab_ini`/`sab_fim`), sem interferência do campo novo.
4. Domingo continua sempre `sem_expediente_no_dia`, motivo `domingo`,
   independente de `dias_semana`.
5. UI: desligar um dia da linha reflete em tempo real (mesmo padrão de
   estado local que os outros campos do form já usam) e persiste depois de
   salvar e recarregar a página.
6. UI: é possível desligar todos os dias (segunda-sábado) — nenhuma
   validação de submit bloqueia esse estado.
7. Edge Function (`iris-nova-mensagem`) — teste de integração ou manual
   confirmando que a Iris no WhatsApp para de oferecer horário no dia
   desligado, não só o teste unitário de `carregar-disponibilidade.test.ts`.
8. Agendamento manual (quando existir) continua aceitando um horário num
   dia desligado em `dias_semana` — teste de não-regressão de escopo, para
   garantir que a checagem nova não vaze para o fluxo de agendamento
   manual por engano em implementação futura.

## Fora de escopo nesta v1

- Horário de funcionamento da clínica (bloco separado, já existente,
  não tocado).
- Horário individual por dia da semana (cada dia com `inicio`/`fim`
  próprios) — decisão explícita do Gabriel de manter um horário único.
- Domingo como dia configurável.
- Qualquer mudança em `cappia_reservar_agendamento` ou nas rotas de
  agendamento manual (spec separada, `agendamento-manual-v1.md`) — esta
  spec toca só a leitura de disponibilidade, não a escrita.

## Decisões fechadas (revisão 2, 2026-08-25)

- **Escopo do efeito**: `dias_semana` só controla o que a Iris oferece
  automaticamente no WhatsApp. Agendamento manual pela clínica não é
  afetado — pode ser criado em qualquer dia, mesmo um desligado em
  `dias_semana`. Nenhuma mudança em `agendamento-manual-v1.md` ou em
  qualquer rota/arquivo de agendamento manual.
- **Sincronização dos dois arquivos**: `src/core/carregar-disponibilidade.ts`
  e `supabase/functions/iris-nova-mensagem/carregar-disponibilidade.ts` são
  idênticos hoje mas sem sincronização automática confirmada — a mudança é
  aplicada manualmente nos dois, cada edição verificada em separado.
- **Mínimo de dias ativos**: nenhum. Zero dias é um estado válido e
  significa "Iris não oferece horário automático para este dentista".
- **Formato do campo**: objeto `{seg, ter, qua, qui, sex}`, chave ou campo
  ausente = `true` (compatibilidade com dentistas já cadastrados). Sábado
  continua fora desse objeto, controlado pelo `sabado` boolean já
  existente.

## Aprovação

Spec aprovada pelo Gabriel em 2026-08-25 com os ajustes acima incorporados.
Implementação autorizada e concluída no mesmo dia. Revisão final do Codex
aprovada, sem bloqueadores. Commits separados por repositório preparados;
push e deploy aguardam autorização explícita do Gabriel.
