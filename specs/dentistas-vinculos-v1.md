# Dentistas e Vínculo Dentista–Procedimento v1

**Status:** especificação canônica aprovada para o primeiro fluxo de novo agendamento.
Este documento define contrato lógico e comportamento; não autoriza implementação,
alteração de banco, criação de tabelas, migration ou schema físico.

Esta especificação complementa `novo-agendamento.md`, `procedimentos-v1.md`,
`eventos-conversacionais-v1.md` e `controlador-conversacional-v1.md`. Permanecem fixas
as decisões de `../docs/02-arquitetura.md` e `../docs/04-decisoes-canonicas.md`: a IA
interpreta somente a mensagem atual e nunca decide; o Core determinístico resolve;
Supabase/Postgres é a fonte oficial.

## 1. Identidade do dentista

- `dentista_id`: identificador estável, opaco, nunca derivado de texto ou nome.
- `dentista_id` pertence exclusivamente à clínica — não existe dentista global nesta
  v1. Identidade completa é sempre o par `(dentista_id, clinica_id)`.
- Nome exibido: texto legível ao paciente/painel, **sem valor de identidade**. Desde
  09/08/2026 é o único campo de texto do dentista (as duas "entradas de resolução" foram
  removidas, §6) e tem dois usos, ambos de apresentação: o texto que a interpretadora lê
  em `dentistas_disponiveis`, e o que o paciente vê numa pergunta de desambiguação.
- Status ativo/inativo: controla elegibilidade para aptidão e resolução.

**Regra fixa**: a Iris nunca identifica dentista pelo nome exibido — toda resolução
produz `dentista_id`.

## 2. Vínculo dentista–procedimento

Entidade lógica: vínculo explícito entre `dentista_id` e `procedimento_id`, com
`clinica_id` consistente entre os três (`vínculo.clinica_id = dentista.clinica_id =
procedimento.clinica_id`; qualquer divergência invalida o vínculo).

- Aptidão só existe quando o vínculo existe **e** está ativo — nunca inferida por
  nome, especialidade ou texto livre (seção 7).
- Nunca aceitar `dentista_id` ou `procedimento_id` vindos da IA ou do paciente.

## 3. Status — três eixos independentes

Dentista ativo/inativo; procedimento ativo/inativo (`procedimentos-v1.md`); vínculo
ativo/inativo. Aptidão só existe quando os três estão válidos simultaneamente, sem
atalho entre eixos.

## 4. Preferência do paciente

> **REVISADA em 09/08/2026** (`dentista-semantico-v1.md`). Até então esta seção tratava a
> preferência como **descartável**: quando não resolvia, o fluxo seguia "como caso sem
> preferência válida" e escolhia outro apto. Isso produzia troca silenciosa de
> profissional em produção. A prioridade foi **invertida**.

**A preferência válida prevalece.** Preferência válida = `dentista_id` que existe, pertence
à clínica e está ativo. Quando ela não é apta ao procedimento pedido, **quem cede é o
procedimento, nunca o profissional**:

- se o profissional realiza o procedimento → seguir com o par pedido;
- se não realiza, mas tem vínculo ativo com Consulta/Avaliação (§12) → seguir com
  **Consulta/Avaliação e o mesmo profissional**, informando a troca ao paciente, sem nova
  pergunta de aceitação;
- se nem isso for possível → **informar e parar**. Nunca substituir o profissional, nunca
  sugerir outro, nunca oferecer a avaliação de novo (§12 regra 1).

**Preferência inválida** (ID inexistente, de outra clínica, ou dentista inativo) colapsa em
"sem preferência" e reaplica zero/um/vários aptos (§5). Isso é integridade, não conversa:
o ID vem de uma lista real que o próprio Core enviou, então não há nuance a comunicar.

Permanecem válidos: não procurar em outra clínica; não revelar nenhuma informação de outra
clínica.

**Ausência de preferência não equivale a aceitar qualquer profissional.** São coisas
diferentes.

Quando há vários aptos e o paciente não indicou preferência, o Core
pergunta (seção 5). Só a resposta explícita do paciente — um nome (preferência) ou a
aceitação de "qualquer profissional" (evento `aceitar_qualquer_profissional`, já
canônico em `eventos-conversacionais-v1.md`) — resolve o caso. Silêncio ou resposta
anterior à pergunta nunca é interpretado como "qualquer profissional" por padrão.

## 5. Regra de zero, um ou vários aptos

- **Zero aptos** → avaliar Consulta/Avaliação (seção 12).
- **Exatamente um apto** → seguir diretamente, sem perguntar preferência.
- **Vários aptos** → perguntar preferência ou autorização para qualquer profissional.

## 6. Resolução do dentista — semântica

> **REVOGADA E SUBSTITUÍDA em 09/08/2026** (`dentista-semantico-v1.md`). A versão anterior
> definia "entradas de resolução, exatamente duas" (`nome_completo_resolucao` e
> `nome_curto_resolucao`), match exato após normalização, regra de títulos/pontuação
> ("Dra. Ana" ≠ "Ana") e três formas de colisão. **Nada disso existe mais**: os dois campos
> foram removidos do catálogo e `resolverPorPreferencia` foi apagada. Motivo: no dado real
> as entradas eram "Dr. Carlos Turiak"/"Carlos Turiak", e dizer "Carlos" não resolvia —
> a mesma rigidez que travou o procedimento em `"Avaliação né"`.

**Fluxo de resolução**: o Core envia à interpretadora `dentistas_disponiveis` — os
profissionais **ativos** da clínica, cada um com `dentista_id` e `nome_exibido`, **sem
filtro de aptidão** (o vínculo depende do procedimento, que só existe depois da
interpretação). A IA correlaciona semanticamente o que o paciente disse e devolve
`dentista_id`. O Core confere quatro coisas — existe, é da clínica, está ativo, tem vínculo
ativo com o procedimento — e nada além.

**Ambiguidade real** (dois profissionais plausíveis): a IA omite `dentista_id`, o Core não
vê preferência, e a regra de vários aptos (§5) faz a pergunta. Nenhum estado novo.

**O Core continua sem fazer correspondência de texto** — e é isso que a proibição de
aliases, busca parcial e fuzzy matching passa a significar aqui. Ela não foi relaxada: o
Core deixou de comparar nome, não passou a compará-lo de forma aproximada. `nome_exibido`
permanece como texto de apresentação (o que a IA lê e o que o paciente vê), nunca como
identidade.

Duplicidade de nome exibido deixou de ser erro de configuração: dois profissionais podem
ter nomes parecidos, e a desambiguação é conversacional, como uma recepcionista faria.

## 7. Relação com especialidade

Especialidade pode existir como informação administrativa/de apresentação — não é
requisito do contrato mínimo do Core nesta v1. Nunca: cria aptidão; cria vínculo;
substitui `procedimento_id`; autoriza duração; autoriza disponibilidade; prova que o
dentista realiza todos os procedimentos daquela área. Aptidão depende exclusivamente
do vínculo explícito e ativo entre `dentista_id` e `procedimento_id`, com todos os
elementos da mesma clínica.

## 8. Relação com duração

O **dentista** comprova aptidão e isolamento **e determina o valor da duração**
(revisado em 30/08/2026). O **vínculo** comprova aptidão e isolamento e não determina
o valor.

A duração é resolvida na configuração **daquele dentista** para o procedimento
(`clinica_id` + `dentista_id` + `procedimento_id`, ver `duracao-v1.md` §0/§1, revisado
em 30/08/2026), depois de dentista apto e procedimento oficial confirmados. Cada
dentista apto encaminhado à disponibilidade leva **a sua própria** duração — elas podem
diferir entre si legitimamente.

Trocar de dentista altera a agenda consultada **e exige recalcular a duração**, que é
do profissional (revisado em 30/08/2026). Procedimento sem duração oficial válida para
aquele dentista não é agendável;
nunca duração global do procedimento entre clínicas, nunca fallback.

## 9. Relação com disponibilidade

Recebe `clinica_id`, `procedimento_id` oficial, `dentista_id` (preferência resolvida)
ou o conjunto de aptos, e confirmação de vínculo ativo. Nenhum horário é consultado
antes de aptidão confirmada.

## 10. Qualquer profissional — escopo estrito desta spec

Esta spec define somente que:
- `aceitar_qualquer_profissional` representa autorização validada pelo Core (evento já
  canônico);
- todos os dentistas oficialmente aptos seguem para a disponibilidade, cada um com
  **a duração oficial dele** para aquele procedimento (podem diferir entre si);
- ausência de preferência não equivale automaticamente a essa aceitação (seção 4).

Explicitamente fora desta spec — pertencem a `duracao-v1.md` e a `disponibilidade.md`
(§12), ambas canônicas vigentes: ordenação de horários; ordenação entre dentistas;
apresentação de um dentista por vez; critério de horário mais próximo; combinação dos
resultados de disponibilidade.

## 11. Isolamento multiclínica

`dentista_id`/`procedimento_id` pertencem à clínica; vínculo nunca cruza clínicas;
mesmo nome pode existir em clínicas diferentes; dentista de outra clínica equivale a
não encontrado; nenhuma informação de outra clínica pode ser revelada — nem por erro,
nem por mensagem de "não encontrado" que insinue existência alhures.

## 12. Consulta/Avaliação

Identificada pelo **ID canônico `consultation_evaluation`** (09/08/2026). `eh_consulta_
avaliacao` foi abandonado: nunca existiu no banco e era `false` hardcoded para todos os
procedimentos, o que tornava este fallback inalcançável desde sempre. Identificação por
nome permanece proibida. Ver `../docs/04-decisoes-canonicas.md`.

**Gatilho A — zero dentistas aptos** para o procedimento solicitado:

1. Só avaliar o fallback se o procedimento atual não for, ele mesmo, Consulta/Avaliação.
2. Validar que `consultation_evaluation` existe e está ativo.
3. Calcular os dentistas aptos para ele pelas mesmas regras (seções 2–3).
4. Oferecer somente se houver ao menos um apto.
5. Exigir aceitação do paciente antes de substituir o procedimento. **Não é um mecanismo
   próprio**: a Iris oferece na resposta, e a aceitação é a mensagem seguinte do paciente,
   interpretada pelo caminho normal.

**Gatilho B — preferência explícita sem vínculo** (09/08/2026, §4). Há aptos para o
procedimento, mas não é o profissional escolhido:

1. Não vale se o procedimento pedido já for `consultation_evaluation` — informar e parar,
   nunca criar ciclo (regra 1 acima).
2. Validar que `consultation_evaluation` existe, está ativo, e que **o próprio profissional
   escolhido** tem vínculo ativo com ele.
3. Seguir com Consulta/Avaliação e esse profissional, **informando a troca**.
4. **Sem nova aceitação** — exceção única registrada em `../docs/04-decisoes-canonicas.md`.
5. Se qualquer validação falhar → informar e parar. Nunca substituir o profissional.

**Se o procedimento atual já for Consulta/Avaliação e não houver dentista apto**: não
oferecer Consulta/Avaliação novamente, não criar ciclo, não inventar procedimento ou
profissional e não consultar disponibilidade. O comportamento conversacional final fica
para `atendimento-v1.md`.

## 13. Testes obrigatórios

> **Atualizado em 09/08/2026.** Saíram os seis itens de correspondência textual (as três
> colisões, `"Dra. Ana"` ≠ `"Ana"`, nome curto e completo resolvendo o mesmo ID, e
> múltiplos matches como erro de configuração) — não há mais match de texto a testar.

Um apto; vários aptos; zero aptos; dentista inativo; procedimento inativo; vínculo
inativo; dentista mencionado sem vínculo; dentista inexistente recebe o mesmo
tratamento que inativo/sem vínculo; mesmo nome em clínicas diferentes; vínculo cruzando
clínicas é inválido; Consulta/Avaliação com dentista apto; Consulta/Avaliação sem dentista
apto; pedido direto de Consulta/Avaliação sem dentista apto não tenta oferecer
Consulta/Avaliação de novo; ausência de preferência; ausência de preferência não é tratada
como aceitar qualquer profissional; aceitação de qualquer profissional.

Acrescentados por `dentista-semantico-v1.md`: `dentistas_disponiveis` chega à interpretadora
com todos os ativos e sem filtro de aptidão; chave ausente quando não há nenhum ativo;
preferência válida e apta segue com o par pedido; preferência válida sem vínculo preserva o
profissional e troca o procedimento; preferência válida sem vínculo nem com a avaliação
informa e para; pedido que já é a avaliação não cria ciclo; **a existência de outro
profissional apto nunca autoriza troca silenciosa**; ID inexistente/de outra clínica/inativo
colapsa em sem preferência; a substituição não é persistida no estado.

## 14. Auditoria do legado

Material legado auditado em modo read-only no Supabase atual da Cappia/Iris — não
autoriza reuso automático:

| Componente | Classificação |
|---|---|
| `clinicas.dentistas` (jsonb) | Adaptar — conceito válido, estrutura física não deve ser copiada |
| `dentistas[].procedimentos` | Adaptar — mistura nome e ID opcional, mesma classificação da auditoria de procedimentos |
| `cappia__resolver_dentista` | **Referência histórica** (reclassificado 09/08/2026) — o padrão nome completo + nome curto deixou de ser o alvo com `dentista-semantico-v1.md`. O que se preserva dele é o princípio, não o mecanismo: era o único resolvedor legado que tratava ambiguidade explicitamente em vez de escolher em silêncio, e essa exigência continua canônica |
| `cappia__resolver_procedimento` (validação de aptidão) | Adaptar — `LIMIT 1` silencioso incompatível com a regra de nunca escolher |
| `cappia__resolver_duracao` (v1) | Descartar como padrão a seguir — cai para duração global do procedimento e depois para 60 min hardcoded |
| `cappia__resolver_duracao_v2` | Apenas referência legada auditada — exige dentista ativo e vínculo ativo e não usa fallback, mas resolve duração **por vínculo**, modelo que a Duração v1 não adota. Não representa o contrato vigente (ver `duracao-v1.md`) |

## 15. Pendências

Não resolvidas por esta especificação, não decididas por inferência:

1. ~~Se "nome exibido" e "nome completo de resolução" são o mesmo campo~~ — **deixou de ser
   pendência** (09/08/2026): as entradas de resolução foram removidas, e sobrou apenas
   `nome_exibido`. A pergunta não tem mais objeto.
2. Existência física de "especialidade", se/quando for criada.
3. ~~Validação de duplicidade de entradas de resolução~~ — **deixou de ser pendência**
   (09/08/2026): não há mais entradas de resolução nem colisão a validar.
4. Resposta conversacional para catálogo inválido, dentista não encontrado, e
   Consulta/Avaliação sem saída — **deixou de ser pendência**: definida em
   `atendimento-v1.md` §5, canônica vigente.

## 16. Invariantes

- `dentista_id` é sempre local à clínica; não existe dentista global.
- A Iris nunca identifica dentista pelo nome exibido.
- Aptidão exige dentista, procedimento e vínculo simultaneamente ativos.
- Especialidade nunca cria aptidão nem substitui o vínculo explícito.
- **O Core nunca faz correspondência de texto para identificar dentista** (09/08/2026,
  substitui as duas invariantes anteriores sobre match exato e colisão de entradas de
  resolução). A correlação nome → `dentista_id` é semântica, feita pela interpretadora
  sobre a lista real que o Core enviou; o Core valida identidade, clínica, `ativo` e
  vínculo, e nada além.
- **Preferência válida de dentista prevalece sobre o procedimento pedido; o profissional
  escolhido nunca é substituído em silêncio** (09/08/2026). Quando a combinação não é
  possível nem via Consulta/Avaliação, o fluxo informa e para.
- Dentista inexistente, de outra clínica ou inativo colapsa em ausência de preferência —
  integridade, não conversa.
- Ausência de preferência nunca equivale a autorização para qualquer profissional.
- Consulta/Avaliação como fallback nunca cria ciclo nem substitui procedimento sem
  aceitação explícita.
- Duração e disponibilidade permanecem fora desta especificação.
- Esta especificação não cria código, tabela, coluna, RPC ou migration.
