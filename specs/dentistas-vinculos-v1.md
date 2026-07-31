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
- Nome exibido: texto legível ao paciente/painel, sem valor de identidade — distinto
  das entradas de resolução (seção 6).
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

**Tratamento unificado**: dentista inexistente, dentista inativo, dentista sem vínculo
ativo com o procedimento, e vínculo inativo recebem o mesmo tratamento operacional:

- não selecionar profissional;
- não procurar em outra clínica;
- não revelar nenhuma informação de outra clínica;
- informar apenas, de forma natural, que o profissional não foi localizado na clínica
  corrente;
- continuar como caso sem preferência válida;
- reaplicar a regra de zero/um/vários aptos (seção 5).

Os motivos internos (inexistente vs. inativo vs. sem vínculo vs. vínculo inativo)
permanecem distintos para auditoria — nunca colapsados no registro interno — mas não
autorizam exposição administrativa desnecessária ao paciente.

**Ausência de preferência não equivale a aceitar qualquer profissional.** São coisas
diferentes. Quando há vários aptos e o paciente não indicou preferência, o Core
pergunta (seção 5). Só a resposta explícita do paciente — um nome (preferência) ou a
aceitação de "qualquer profissional" (evento `aceitar_qualquer_profissional`, já
canônico em `eventos-conversacionais-v1.md`) — resolve o caso. Silêncio ou resposta
anterior à pergunta nunca é interpretado como "qualquer profissional" por padrão.

## 5. Regra de zero, um ou vários aptos

- **Zero aptos** → avaliar Consulta/Avaliação (seção 12).
- **Exatamente um apto** → seguir diretamente, sem perguntar preferência.
- **Vários aptos** → perguntar preferência ou autorização para qualquer profissional.

## 6. Resolução do texto do dentista

**Entradas de resolução, exatamente duas, nada além**:
- **nome completo de resolução** — obrigatório;
- **nome curto de resolução** — opcional.

Ambas: explícitas, auditáveis, pertencentes à clínica, normalizadas pelas mesmas
quatro transformações já aprovadas (`procedimentos-v1.md` §4 — lowercase, remoção de
acentos, trim, redução de espaços múltiplos), associadas deterministicamente a um
único `dentista_id`. Distintas do "nome exibido" da seção 1 — podem coincidir na
prática, mas são conceitualmente campos separados, com propósito diferente (exibição
vs. resolução).

Explicitamente fora nesta v1: sistema aberto de aliases, CRUD de aliases, apelidos
aprendidos, variações automáticas, busca parcial, fuzzy matching.

**Títulos e pontuação**: nenhuma transformação automática. "Dra. Ana" e "Ana" são
entradas diferentes — se ambas precisarem resolver para o mesmo dentista, cada uma
deve estar explicitamente cadastrada (como nome completo e/ou nome curto). Pontuação
não é removida automaticamente — consistente com o conjunto fechado de 4
transformações já aprovado, que nunca incluiu remoção de pontuação.

**Fluxo de resolução**: texto → normalização fechada → match exato contra nome
completo OU nome curto autorizados da clínica corrente → `dentista_id` | não
encontrado | erro de configuração.

**Duplicidade — três formas de colisão, todas erro de configuração**, dentro da mesma
clínica:
- dois nomes completos colidindo;
- dois nomes curtos colidindo;
- nome completo de um profissional colidindo com nome curto de outro.

Dois dentistas podem ter o mesmo nome exibido — mas suas entradas de resolução devem
ser distintas e únicas na clínica.

**Regras de falha, sem exceção**: a configuração deve ser rejeitada; o runtime nunca
escolhe o primeiro; o runtime não desempata por ID, ordem ou status; o resolvedor não
transforma o erro em pergunta ao paciente; o fluxo falha fechado. A resposta
técnica/conversacional diante de catálogo inválido fica para `atendimento-v1.md`.

## 7. Relação com especialidade

Especialidade pode existir como informação administrativa/de apresentação — não é
requisito do contrato mínimo do Core nesta v1. Nunca: cria aptidão; cria vínculo;
substitui `procedimento_id`; autoriza duração; autoriza disponibilidade; prova que o
dentista realiza todos os procedimentos daquela área. Aptidão depende exclusivamente
do vínculo explícito e ativo entre `dentista_id` e `procedimento_id`, com todos os
elementos da mesma clínica.

## 8. Relação com duração — fora do escopo

Duração é resolvida depois de dentista apto e procedimento oficial confirmados; pode
depender do dentista/vínculo; vínculo sem duração resolvível não torna o procedimento
agendável (`procedimentos-v1.md` §9); nunca duração global do procedimento como
fallback.

## 9. Relação com disponibilidade

Recebe `clinica_id`, `procedimento_id` oficial, `dentista_id` (preferência resolvida)
ou o conjunto de aptos, e confirmação de vínculo ativo. Nenhum horário é consultado
antes de aptidão confirmada.

## 10. Qualquer profissional — escopo estrito desta spec

Esta spec define somente que:
- `aceitar_qualquer_profissional` representa autorização validada pelo Core (evento já
  canônico);
- todos os dentistas oficialmente aptos seguem para resolução individual de duração;
- ausência de preferência não equivale automaticamente a essa aceitação (seção 4).

Explicitamente fora desta spec — pertencem às futuras specs de duração e
disponibilidade: ordenação de horários; ordenação entre dentistas; apresentação de um
dentista por vez; critério de horário mais próximo; combinação dos resultados de
disponibilidade.

## 11. Isolamento multiclínica

`dentista_id`/`procedimento_id` pertencem à clínica; vínculo nunca cruza clínicas;
mesmo nome pode existir em clínicas diferentes; dentista de outra clínica equivale a
não encontrado; nenhuma informação de outra clínica pode ser revelada — nem por erro,
nem por mensagem de "não encontrado" que insinue existência alhures.

## 12. Consulta/Avaliação

Quando houver zero dentistas aptos para o procedimento solicitado:

1. Só avaliar o fallback se o procedimento atual não for, ele mesmo, Consulta/Avaliação.
2. Validar que existe exatamente um procedimento ativo com
   `eh_consulta_avaliacao = true` na mesma clínica.
3. Calcular os dentistas aptos para ele pelas mesmas regras (seções 2–3).
4. Oferecer somente se houver ao menos um apto.
5. Exigir `aceitar_opcao` válido antes de substituir o procedimento (já canônico em
   `eventos-conversacionais-v1.md`).

**Se o procedimento atual já for Consulta/Avaliação e não houver dentista apto**: não
oferecer Consulta/Avaliação novamente, não criar ciclo, não inventar procedimento ou
profissional e não consultar disponibilidade. O comportamento conversacional final fica
para `atendimento-v1.md`.

## 13. Testes obrigatórios

Um apto; vários aptos; zero aptos; dentista inativo; procedimento inativo; vínculo
inativo; dentista mencionado sem vínculo; dentista inexistente recebe o mesmo
tratamento que inativo/sem vínculo; mesmo nome exibido em dentistas diferentes da
mesma clínica com entradas de resolução distintas; colisão nome completo × nome
completo; colisão nome curto × nome curto; colisão nome completo de um × nome curto
de outro; "Dra. Ana" e "Ana" tratados como entradas diferentes, nenhuma resolve a
outra automaticamente; mesmo nome em clínicas diferentes; vínculo cruzando clínicas é
inválido; Consulta/Avaliação com dentista apto; Consulta/Avaliação sem dentista apto;
pedido direto de Consulta/Avaliação sem dentista apto não tenta oferecer
Consulta/Avaliação de novo; nome curto e nome completo resolvendo o mesmo
`dentista_id`; múltiplos matches — erro de configuração, sem escolha por ID/ordem/
status; ausência de preferência; ausência de preferência não é tratada como aceitar
qualquer profissional; aceitação de qualquer profissional.

## 14. Auditoria do legado

Material legado auditado em modo read-only no Supabase atual da Cappia/Iris — não
autoriza reuso automático:

| Componente | Classificação |
|---|---|
| `clinicas.dentistas` (jsonb) | Adaptar — conceito válido, estrutura física não deve ser copiada |
| `dentistas[].procedimentos` | Adaptar — mistura nome e ID opcional, mesma classificação da auditoria de procedimentos |
| `cappia__resolver_dentista` | Reutilizar conceitualmente — padrão nome completo + nome curto, único resolvedor legado que trata ambiguidade explicitamente em vez de escolher silenciosamente |
| `cappia__resolver_procedimento` (validação de aptidão) | Adaptar — `LIMIT 1` silencioso incompatível com a regra de nunca escolher |
| `cappia__resolver_duracao` (v1) | Descartar como padrão a seguir — cai para duração global do procedimento e depois para 60 min hardcoded |
| `cappia__resolver_duracao_v2` | Reutilizar conceitualmente, com destaque — exige dentista ativo e vínculo ativo, resolve só por id, sem fallback para duração global |

## 15. Pendências

Não resolvidas por esta especificação, não decididas por inferência:

1. Se "nome exibido" (seção 1) e "nome completo de resolução" (seção 6) são o mesmo
   campo reaproveitado ou dois campos fisicamente distintos — tratados aqui como
   conceitos separados, sem decidir se coincidem na prática.
2. Existência física de "especialidade", se/quando for criada.
3. Onde e quando a validação de duplicidade de entradas de resolução (seção 6) é
   aplicada — spec de schema/seed ainda não escrita.
4. Resposta conversacional para catálogo inválido, dentista não encontrado, e
   Consulta/Avaliação sem saída — deferida a `atendimento-v1.md`, ainda placeholder.

## 16. Invariantes

- `dentista_id` é sempre local à clínica; não existe dentista global.
- A Iris nunca identifica dentista pelo nome exibido.
- Aptidão exige dentista, procedimento e vínculo simultaneamente ativos.
- Especialidade nunca cria aptidão nem substitui o vínculo explícito.
- Resolução de texto de dentista é determinística: normalização fechada + match exato
  contra nome completo/curto autorizados — nenhum fuzzy matching, nenhuma
  transformação automática de título ou pontuação.
- Colisão normalizada entre entradas de resolução é erro de configuração; o runtime
  nunca escolhe, nunca pergunta, nunca desempata por ID/ordem/status.
- Dentista não encontrado, inativo ou sem vínculo recebem o mesmo tratamento
  operacional ao paciente, preservando o motivo distinto para auditoria interna.
- Ausência de preferência nunca equivale a autorização para qualquer profissional.
- Consulta/Avaliação como fallback nunca cria ciclo nem substitui procedimento sem
  aceitação explícita.
- Duração e disponibilidade permanecem fora desta especificação.
- Esta especificação não cria código, tabela, coluna, RPC ou migration.
