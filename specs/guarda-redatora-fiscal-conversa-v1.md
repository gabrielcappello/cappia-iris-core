# A guarda da redatora não pode fiscalizar conversa — v1

**Status:** especificação **proposta, não aprovada e não implementada**. Registra um
defeito real, achado em teste manual de produção, e propõe correção. Nenhuma linha de
código muda até aprovação do Gabriel. Esta rodada é **somente investigação e spec** —
autorização explícita do Gabriel/Codex de não implementar nada além disto.

## Para quem revisa isto sem contexto prévio

Este documento pede uma **revisão de arquitetura, segurança e aderência** — o papel que
`AGENTS.md` (raiz do repositório `cappia-iris-core`) atribui ao Codex no processo do
projeto ("Processo obrigatório", passo 3).

**O que ler antes, nesta ordem** (todos em `cappia-iris-core`, salvo indicação contrária):

1. `docs/00-principios.md` — em particular o **caso nº 2** ("Guarda lexical da
   redatora", 2026-08-06): a guarda tentava detectar por regex se o texto afirmava uma
   reserva, chegou a reprovar *"Ainda não está confirmado, tá?"* por conter a palavra
   "confirmado", e foi removida por completo — "era um segundo interpretador de
   português feito em código". **Esta spec é a mesma classe de defeito, na checagem de
   horário/data em vez da de execução.**
2. `docs/07-arquitetura-v2.md`, seção 7 — "a guarda **nunca** volta a interpretar
   linguagem, conforme o caso nº 2 de `docs/00-principios.md`".
3. `specs/resposta-conversacional-v1.md`, seção 4 — a spec **original e ainda vigente**
   da guarda: ela previa só duas checagens (horário citado existe nos fatos? há
   afirmação de reserva sem `agendamento_confirmado`?) mais texto vazio. A checagem de
   **data** (`data_nao_autorizada`) foi acrescentada depois — encontrada mencionada em
   `specs/correcao-cadastro-conversacional-v1.md` (contexto de data de nascimento, não
   de agendamento), mas o código de `coletarDatasAutorizadas` já a aplica de forma
   genérica a qualquer objetivo, sem essa distinção de contexto.
4. `src/core/guarda-resposta-redatora.ts` — o código atual da guarda, alvo desta
   correção.
5. `src/core/gerar-resposta-conversacional.ts` — onde a guarda é chamada e onde o
   texto reprovado é hoje descartado sem registro (linha ~172-175).
6. `specs/auditoria-conversas-admin-v1.md` — **já aprovada e já implementada em
   produção**: `src/core/auditoria-conversas.ts`,
   `src/supabase/migrations/20260905120000_conversas_auditoria.sql`, e a **tela
   administrativa já existente** em `iris-portal-v2`
   (`src/components/ModalConversasAdmin.tsx`, `src/app/api/admin/conversas/route.ts`,
   botão "Conversas" em `src/app/admin/page.tsx`). Esta spec propõe uma extensão
   **aditiva** sobre a tabela e uma alteração pontual na rota e no modal **já
   existentes** — nunca uma tabela ou uma tela novas.

**Contexto mínimo do sistema, para quem nunca viu este projeto:** a Iris Nova é um
assistente de WhatsApp para clínicas odontológicas. Duas IAs por turno: a
**interpretadora** lê a mensagem do paciente e produz dados estruturados; o **Core**
(código determinístico) decide o fluxo e monta `FatosAutorizados` — os únicos fatos que
a segunda IA, a **redatora**, pode usar para escrever a resposta. Depois da redação, a
**guarda** (`guarda-resposta-redatora.ts`) verifica o texto antes de deixá-lo seguir ao
paciente; se reprovar, o texto é descartado e um **fallback determinístico fixo**
(`gerar-resposta-paciente.ts`) é enviado no lugar.

## Aderência a `docs/00-principios.md`

- **Responsabilidade correta.** A guarda hoje decide, por regex sobre linguagem
  natural, se uma menção a horário/data é "legítima" ou "uma oferta inventada" — essa é
  precisamente a pergunta que só a compreensão de linguagem consegue responder (o
  paciente estava reconhecendo uma preferência, perguntando sobre funcionamento,
  reclamando, ou pedindo algo operacional?). A correção não ensina a guarda a
  interpretar melhor — restringe **quando** ela verifica, para os casos em que a
  verificação é objetivamente factual (a resposta afirma um fato operacional real).
- **Remoção.** A checagem de data/horário deixa de rodar em todo `objetivo`
  incondicionalmente; passa a rodar só nos objetivos onde ela é uma pergunta factual,
  não uma suposição sobre o que o paciente quis dizer (conjunto exato na seção 3.2).
- **Teste isolado.** Seção "Verificação exigida" exige par positivo/negativo por causa,
  e teste com a conversa real completa (não fragmento).
- **Testes realistas.** O caso de origem é conversa real de teste manual (WhatsApp,
  Cleardent, teste do Gabriel), incluída na íntegra na seção 1 — sem o número de
  telefone, que não é necessário para documentar o caso e não deve ficar versionado no
  repositório.

## 1. O defeito, com evidência real

**Conversa real, WhatsApp, Cleardent** (paciente "Carlos", teste manual do Gabriel;
extraída de `conversas_auditoria`, que grava a resposta final devolvida mas **não** a
resposta original da redatora quando a guarda reprova — daí a lacuna que esta spec
fecha):

```
Iris:     Boa noite, Carlos! [...] Você tem estes atendimentos agendados: [...]
          Também estão pendentes: [...] Restauração / Cárie (1 face) — dente 23 [...]
Paciente: bora marcar os pendentes. vamos fazer a restauração
Iris:     Perfeito, Carlos! Vamos marcar a restauração. Qual data fica melhor
          para você?
Paciente: quero marcar para fin de mes.. na parte da tarde
Iris:     Perfeito, Carlos! Para marcar a restauração [...], qual data no fim
          do mês fica melhor para você? Você prefere algum período da tarde
          em especial?
Paciente: qual é o ulitmo dia do mes que tem disonivel. fim do mes mesmo..
          16hrs ficaria bem para min
Iris:     Para qual data você gostaria de agendar? Pode ser hoje, amanhã ou
          uma data específica.                              ← BLOQUEADO (1)
Paciente: FAlei fim do mes.. agora não entendi porque vc me perguntou se
          hoje. ou amanha.. hoje e sabado são 21:35 da noite.. vcs estão
          abertos. ate agora?? amanha domingo tb esta aberto?
Iris:     Para qual data você gostaria de agendar? Pode ser hoje, amanhã ou
          uma data específica.                              ← BLOQUEADO (2)
Paciente: vou perguntar novamente.. vc eta aberto hoje??? vai entaõ quero
          para hoje.. quero ver se tem turno mesmo, já que esta ofercendo
Iris:     Esse horário de hoje já passou. Prefere outro horário hoje, ou
          outro dia?                                        ← BLOQUEADO (3)
Paciente: vc e doente??? se já passou pq me pergunta outro horaio hoje..
Iris:     Esse horário de hoje já passou. Prefere outro horário hoje, ou
          outro dia?                                        ← BLOQUEADO (4)
Paciente: qual hoario hoje// vc ta louca?
Iris:     Esse horário de hoje já passou. Prefere outro horário hoje, ou
          outro dia?                                        ← BLOQUEADO (5)
```

**Todas as cinco linhas têm `resultado_turno = 'sucesso'` e `motivo_fallback =
'horario_nao_autorizado'` em `conversas_auditoria`.** O paciente nunca recebeu a
resposta natural que a redatora escreveu — só o mesmo fallback fixo repetido, girando
em loop, enquanto ficava visivelmente mais irritado a cada turno.

**O que é fato comprovado, e o que é hipótese — distinção exigida pela revisão do
Codex.** `conversas_auditoria` grava a resposta **final** devolvida ao paciente
(sempre o fallback fixo, nestes cinco casos) e o `motivo_fallback` — nunca o texto que
a redatora de fato escreveu antes de ser reprovada. **O único fato comprovado é: em
cada um dos cinco turnos, a redação da IA continha pelo menos um trecho reconhecido
pela guarda como horário, e esse valor não constava em nenhuma das fontes
autorizadas (`horarios_disponiveis`, `proposta_pendente`, `agendamento_confirmado`)**
— as cinco linhas em `conversas_auditoria` têm `motivo_fallback =
'horario_nao_autorizado'`, nunca `data_nao_autorizada`.
Qualquer afirmação sobre **o que** a redatora escreveu, ou **por que** ela mencionou
aquele horário, é hipótese — plausível a partir do texto do paciente e do padrão
conhecido da guarda, mas não verificável com os dados hoje disponíveis. Como hipótese,
razoável: a mensagem (1) menciona "16hrs" como preferência do próprio paciente; a
mensagem (2) descreve a hora atual ("21:35 da noite"); as mensagens (3)-(5) pedem
"hoje", que o Core já identificou como passado (`aguardando_data_horario`, motivo
`passado`) — uma redatora seguindo `redator-instrucoes.ts` reconheceria/explicaria
esses horários no texto, o que bastaria para a guarda de hoje reprovar, sem que isso
prove nem afaste nenhuma outra explicação sobre a redação exata. **A seção 5 desta
spec propõe o mecanismo para deixar de depender de hipótese em casos futuros.**

**A capacidade "último dia disponível do mês" está fora desta correção** — é outro
problema (o Core não tem hoje um jeito de responder "quero o último dia do mês
disponível" como pedido estruturado). O objetivo desta spec é só impedir que a
**limitação existente** gere este loop artificial de fallback: mesmo sem saber
resolver "último dia do mês", a Iris deveria poder reconhecer a preferência de horário
do paciente (16h), explicar a limitação de "hoje" ter passado, e responder à pergunta
sobre funcionamento — em vez de repetir uma frase fixa cinco vezes.

## 2. Causa raiz

A guarda (`guarda-resposta-redatora.ts::verificarRespostaRedatora`) roda a checagem de
horário e de data em **toda** resposta, para **qualquer** `objetivo`, sem olhar o que a
resposta está de fato fazendo. Ela reconhece qualquer padrão `HH:MM`/`Nh`/`N horas` ou
`DD/MM` **no texto**, sem relação com o que esse número significa na frase — e sem
saber (pelos motivos da seção 1) o que o texto reprovado continha de fato.

**Por que isso é a mesma classe do caso nº 2 de `docs/00-principios.md`:** a guarda
tenta, por padrão de texto, decidir se uma menção a horário é "uma oferta operacional"
ou "conversa normal" — só que a compreensão dessa distinção é exatamente o trabalho da
IA. Ampliar a lista de exceções por regex (como já aconteceu uma vez com a checagem de
execução) repete o padrão que o princípio manda evitar.

### 2.1 Achado durante a investigação, revisado e corrigido nesta rodada: horário de
funcionamento é resolvido pela restrição de objetivo, sem precisar de fonte nova

**Esta seção documenta um raciocínio intermediário que se provou errado, e a correção
final — mantida por transparência sobre o processo de revisão, não porque ainda
proponha algo.**

O teste já existente `'horario fora das listas continua REPROVADO -- a correcao nao
afrouxa'` (`guarda-resposta-redatora.test.ts`, linha ~80) prova, com asserção
explícita, que a resposta *"Funcionamos das 8h às 18h. Sua consulta é 10/08 às 14:00."*
é **hoje reprovada** — em `objetivo: 'acolher_e_retomar'`, puramente conversacional.
Uma versão anterior desta spec concluiu, a partir disso, que a causa raiz "não se
resume" a restringir por objetivo, e propôs uma quarta fonte —
`clinica_conhecida.horario_funcionamento` — em `coletarMinutosAutorizados`.

**Essa proposta foi rejeitada na revisão do Codex, por um risco de segurança real: ela
misturava, no mesmo `Set<number>`, dois fatos semanticamente diferentes** — "existe
vaga real neste horário" (`horarios_disponiveis`) e "a clínica está aberta neste
horário" (`horario_funcionamento`). Uma clínica abrir das 8h às 18h não significa que
há vaga às 8h ou às 18h especificamente; qualquer minuto dentro do expediente passaria
a ser aceito como se fosse uma oferta real. Prova concreta do defeito que a proposta
teria introduzido: com `horarios_disponiveis: ['14:00']` e
`clinica_conhecida.horario_funcionamento: '08:00 as 18:00'`, a resposta *"Tenho 8h ou
18h disponíveis"* — uma disponibilidade **inventada**, exatamente o defeito original
que esta guarda existe para impedir — seria **aprovada**.

Precisão sobre o mecanismo: como `coletarMinutosAutorizados` extrai horários com
`adicionarMinutosDeTexto`/`REGEX_HHMM` — que lê só os `HH:MM` literalmente escritos no
texto, sem gerar intervalo —, essa quarta fonte hipotética autorizaria exatamente os
horários **extraídos do texto do expediente** (aqui, `08:00` e `18:00`, os dois limites
mencionados), não qualquer minuto interno ao intervalo. Ou seja, "Tenho 8h ou 18h
disponíveis" já é o pior caso que essa fonte permitiria — não "Tenho 10h ou 14h30
disponíveis" (esses minutos nunca apareceriam no texto do expediente, logo nunca
seriam extraídos). Isso não torna a fonte seguravel: mesmo restrita aos dois limites
literais, ela ainda aprovaria uma disponibilidade inventada nesses dois horários
específicos — o risco descrito acima já basta para rejeitá-la.

**A causa raiz, corretamente entendida: `acolher_e_retomar` já está fora do conjunto
protegido (seção 3.2).** O teste citado prova a resposta reprovada **antes** desta
correção — não prova que a correção da seção 3.2, sozinha, deixa o caso sem solução.
Restringir a checagem por objetivo **já resolve** o caso completo: em
`acolher_e_retomar` (e nos outros dois objetivos puramente conversacionais), a
checagem de horário/data simplesmente não executa, então a menção ao horário de
funcionamento passa por ausência de fiscalização — nunca por uma fonte que precisasse
"aceitar" aquele valor. **Nenhuma fonte nova é necessária.** Ver seção 3.2 para a
correção final e única.

## 3. Decisão de produto (mantida integralmente do pedido original)

> O Core protege ações e fatos operacionais. A Iris redatora conduz a conversa.

A solução segue o **menor caminho seguro**:

### 3.1 Sempre mantido, sem mudança

- Rejeição de texto vazio (`motivo: 'texto_vazio'`).
- Proteção contra afirmar que marcou/confirmou/remarcou/cancelou algo que o Core não
  executou (`motivo: 'execucao_nao_autorizada'`, função `afirmaExecucao`) — **este
  mecanismo já é objetivo por natureza** (compara `fatos.objetivo` contra
  `OBJETIVOS_EXECUTADOS`, nunca interpreta a frase em si além de detectar o particípio
  e a negação imediatamente anterior) e não é alvo desta correção.

### 3.2 Checagem de data/horário — condicionada ao objetivo, não mais global

A checagem de horário (`horario_nao_autorizado`) e de data (`data_nao_autorizada`)
passam a rodar **somente** quando `fatos.objetivo` for um dos que representam uma
**afirmação operacional concreta** — nunca em todo turno.

**Correção sobre a versão anterior desta spec (revisão do Codex):** o levantamento
anterior tratava um subconjunto de 9 objetivos como exaustivo. Não era — a própria
decisão de produto exige proteger "descrevendo um agendamento real", e essa descrição
também ocorre em cancelamento e em decisões conversacionais que citam agendamentos
existentes. Levantamento completo, agora conferido contra os **34 valores reais** de
`ObjetivoResposta` (`fatos-autorizados.ts`, linhas 50-83 — contados um a um, não
estimados):

| `objetivo` | Por que é operacional |
|---|---|
| `apresentar_horarios` | A resposta lista horários reais, calculados pelo Core (`horarios_disponiveis`) — inventar um aqui é o defeito original que a guarda existe para impedir. |
| `informar_sem_expediente_e_pedir_outra_data` | Mesma família de `apresentar_horarios`: o Core já concluiu, com dado real, que não há expediente naquela data (`motivo_sem_expediente`) — protegida pela mesma razão de risco, ainda que este objetivo específico não carregue `data_referencia` (esse campo só acompanha `pedir_procedimento`/`apresentar_horarios`, nunca este `case` — `fatos-autorizados.ts`). |
| `pedir_confirmacao` | Propõe uma data/horário concreto (`proposta_pendente`) e pede confirmação — mesma classe de risco. |
| `informar_reserva_criada` | Descreve um agendamento real recém-criado (`agendamento_confirmado`). |
| `informar_horario_indisponivel` | Cobre `reserva_conflito` e `horario_exato_indisponivel` — quando há vizinhos reais, a resposta pode dizer "tenho 10:30 ou 13:00 disponíveis" (`horarios_disponiveis` anexado). Este é o objetivo do único bloqueio observado na mesma sessão de teste em que a checagem funcionou como projetado ("Esse horário não está livre. Tenho 10:30 ou 13:00 disponíveis."). |
| `pedir_confirmacao_remarcacao` | Propõe a troca de um agendamento existente para outro horário concreto — mesma natureza de `pedir_confirmacao`, aplicada à remarcação. |
| `informar_remarcacao_criada` | Descreve a remarcação real recém-efetivada (`agendamento_confirmado`, mesmo campo reaproveitado da criação). |
| `escolher_entre_agendamentos` | Lista agendamentos reais do paciente (`agendamentos_candidatos`) para ele escolher qual remarcar — **defeito real já corrigido em 2026-08-11** (teste `'aprova horarios vindos de agendamentos_candidatos (defeito corrigido)'`): sem esta proteção, a resposta honesta listando os horários reais era reprovada. Remover este objetivo do conjunto reintroduziria esse defeito. |
| `escolher_entre_agendamentos_cancelamento` | Mesma lista, mesma razão, aplicada ao cancelamento em vez da remarcação. |
| `pedir_confirmacao_cancelamento` | **Adicionado nesta revisão (achado do Codex).** Carrega `agendamento_atual` (data/horário reais do agendamento a cancelar) — descreve um agendamento real, mesma categoria de risco que `pedir_confirmacao_remarcacao`. |
| `informar_cancelamento_criado` | **Adicionado nesta revisão.** Descreve o agendamento real recém-cancelado (`agendamento_confirmado`, campo reaproveitado) — mesma razão de `informar_reserva_criada`/`informar_remarcacao_criada`. |

**Correção da leitura anterior:** a versão anterior desta spec excluía os dois
objetivos de cancelamento por presumir que "cancelamento nunca introduz um horário
novo, logo o dado nunca pode estar errado". Isso confundia **por que** um horário
citado é sempre verdadeiro (o agendamento já existia) com **se a checagem deveria
rodar** — a guarda verifica o texto **produzido pela IA**, não o dado de origem; uma
alucinação da redatora sobre um agendamento de cancelamento é tão possível quanto em
qualquer outro fluxo, e a checagem existe justamente para essa hipótese, não para
confirmar que o Core "nunca erraria".

Conjunto de **onze** objetivos, fechado. Cobre as quatro categorias da decisão original
("apresentando disponibilidade real", "propondo uma data/horário concreto",
"confirmando uma operação", "descrevendo um agendamento real") em todos os fluxos
onde elas ocorrem: novo agendamento, remarcação e cancelamento.

**Três objetivos avaliados nesta revisão e mantidos FORA do conjunto — escolha
consciente, com a consequência declarada sem meio-termo** (achado do Codex: a versão
anterior os omitia sem avaliação, e uma correção seguinte desta mesma spec descrevia
mal a consequência de mantê-los fora — corrigido abaixo):

- `cumprimentar_e_oferecer_ajuda`;
- `cumprimentar_e_mencionar_tratamento_pendente`;
- `acolher_e_retomar`.

**A checagem de data/horário verifica `fatos.objetivo` primeiro e só chama
`coletarMinutosAutorizados`/`coletarDatasAutorizadas` quando o objetivo está no
conjunto da seção 3.2.** Um objetivo fora do conjunto significa que essa checagem
inteira **não executa** — nunca que ela executa e aprova por encontrar o valor em
alguma fonte. Por isso, para estes três objetivos, **datas e horários citados pela
redatora não são fiscalizados de forma alguma, estejam ou não presentes em
`agendamentos_do_paciente`, `tratamentos_aprovados` ou qualquer outro fato do turno.**
Não há uma segunda rede de proteção implícita aqui — é ausência de checagem,
completa e deliberada.

**Por que isto é a decisão certa, não uma lacuna:** os três são objetivos puramente
conversacionais — saudação, menção a tratamento pendente, acolhimento de dúvida ou
reclamação — exatamente onde a redatora precisa de liberdade para reconhecer,
responder e citar o que o paciente disse ou o que já está no contexto, sem que um
regex de horário decida se ela "tinha permissão" para isso. Restringir a checagem
para fora destes três *é* a correção desta spec, não um efeito colateral dela — dar à
Iris essa liberdade nestes objetivos é precisamente o que impede o fiscal de voltar a
interpretar linguagem e bloquear conversa normal (o defeito de origem, seção 2).

**O que isto NÃO abre mão:** a proteção contra afirmar execução sem o Core ter
executado (`execucao_nao_autorizada`, seção 3.1) continua ativa em qualquer objetivo,
inclusive estes três — ela não depende de `fatos.objetivo` estar num conjunto restrito
de horário/data, só verifica `OBJETIVOS_EXECUTADOS` (mecanismo já existente,
inalterado). Uma resposta que afirme "foi remarcado" ou "foi cancelado" sem o Core ter
executado essa operação continua bloqueada mesmo nestes três objetivos — inclusive
quando `agendamentos_do_paciente` está presente, porque `afirmaExecucao`
(`guarda-resposta-redatora.ts`) só ignora particípios de `confirmad`/`marcad`/`agendad`
quando há agendamento existente, nunca `remarcad`/`cancelad` (ver seção 7 para o
teste exato). O que deixa de ser verificado nestes três objetivos é exclusivamente a
menção a um horário/data específico sendo real ou inventado.

A tabela de onze objetivos da seção 3.2 protege os fluxos em que a resposta afirma um
horário/data como fato operacional concreto — novo agendamento, remarcação,
cancelamento. Fora desses onze, a checagem de horário/data está ausente por
construção, e a única proteção que permanece é a de execução (seção 3.1).

Todos os demais 20 `objetivo`s (`pedir_procedimento`, `escolher_entre_procedimentos`,
`escolher_entre_dentistas`, `pedir_data_ou_horario`, `informar_sem_disponibilidade`,
`pedir_reformulacao`, `encerrar_cordialmente`, `informar_falha_tecnica`,
`pedir_cadastro`, `informar_sem_profissional`, `informar_combinacao_indisponivel`,
`informar_cpf_ja_cadastrado`, `perguntar_troca_telefone`,
`acatar_recusa_troca_telefone`, `informar_substituicao_por_avaliacao`,
`informar_sem_agendamento_para_remarcar`, `informar_sem_agendamento_para_cancelar`,
`informar_cadastro_atualizado`, `informar_correcao_cadastro_invalida`,
`pedir_um_procedimento_por_vez`) — a checagem de data/horário **nunca** roda. Isso
cobre exatamente os cinco casos do pedido original: reconhecer preferência, pedir uma
data, explicar algo, responder dúvida/reclamação, conversar normalmente.

**Contagem de verificação:** 11 protegidos (seção 3.2) + 3 avaliados e mantidos fora
com justificativa própria + 20 sempre fora = **34**, batendo com o total real de
`ObjetivoResposta`.

### 3.3 Horário de funcionamento — NENHUMA fonte nova; resolvido inteiramente pela
restrição de objetivo da seção 3.2

**Removida nesta revisão (achado do Codex, bloqueador de segurança):** uma versão
anterior desta spec propunha `clinica_conhecida.horario_funcionamento` como quarta
fonte em `coletarMinutosAutorizados`. **Essa fonte não é criada.** Ver seção 2.1 para
o raciocínio completo do porquê ela foi proposta e por que foi rejeitada: misturar
"horário de expediente" com "horário de vaga real" no mesmo `Set<number>` aprovaria
disponibilidade inventada sempre que a resposta citasse qualquer minuto dentro do
expediente da clínica — prova concreta na seção 2.1 (`horarios_disponiveis: ['14:00']`
+ `horario_funcionamento: '08:00 as 18:00'` aprovaria *"Tenho 8h ou 18h
disponíveis"*, uma vaga que não existe).

**A restrição por objetivo (seção 3.2), sozinha, já resolve o caso real completo.**
Nos três objetivos conversacionais (`cumprimentar_e_oferecer_ajuda`,
`cumprimentar_e_mencionar_tratamento_pendente`, `acolher_e_retomar`), a checagem de
horário/data não executa — logo uma menção ao horário de funcionamento passa por
ausência de fiscalização, nunca por uma fonte que precisasse "aceitá-la". **Dentro**
dos onze objetivos operacionais da seção 3.2, nenhuma fonte nova é acrescentada:
continuam autorizando horário/data exclusivamente os fatos operacionais já existentes
— `horarios_disponiveis`, `proposta_pendente`, `agendamento_confirmado`,
`agendamento_atual`, `agendamentos_candidatos`, `agendamentos_do_paciente`. Um horário
de funcionamento citado dentro de um desses onze objetivos continua reprovado, a
menos que coincida por acaso com um horário real dessas fontes — nunca por si só.

**Dois testes fecham este ponto** (seção 7 tem o detalhe completo):

- o teste existente `'horario fora das listas continua REPROVADO -- a correcao nao
  afrouxa'` (`guarda-resposta-redatora.test.ts`, linha ~80) muda de expectativa
  **sem** nenhuma fonte nova: com `objetivo: 'acolher_e_retomar'` (já fora do conjunto
  protegido) e a mesma resposta *"Funcionamos das 8h às 18h. Sua consulta é 10/08 às
  14:00."*, o resultado passa a ser **aprovado** — exclusivamente porque o objetivo é
  conversacional e a checagem não roda, nunca porque `horario_funcionamento` foi
  aceito como fonte;
- um teste **negativo novo**, com `objetivo: 'apresentar_horarios'` (dentro do
  conjunto protegido), `horarios_disponiveis: ['14:00']` e
  `clinica_conhecida.horario_funcionamento: '08:00 as 18:00'` presentes: a resposta
  *"Tenho 8h disponível"* continua **reprovada** (`horario_nao_autorizado`) — prova
  que o horário de funcionamento nunca autoriza uma vaga, mesmo com o objetivo dentro
  do conjunto e a clínica conhecida presente no mesmo turno.

### 3.4 O que NÃO é criado

Por instrução explícita, mantido integralmente:

- nenhum segundo fiscal;
- nenhuma segunda chamada de IA;
- nenhum retry de redação;
- nenhuma nova camada;
- nenhuma nova frase fixa (a instrução da redatora não muda; só o portão que
  verifica o texto depois);
- nenhuma análise semântica por regex nova — pelo contrário, a mudança **remove**
  aplicação incondicional de um regex já existente, sem adicionar outro;
- **nenhuma fonte nova em `coletarMinutosAutorizados`/`coletarDatasAutorizadas`** —
  `horario_funcionamento` não é acrescentado (seção 3.3); os fatos que autorizam
  horário/data dentro dos onze objetivos protegidos são exatamente os já existentes
  hoje, sem adição nem remoção;
- nenhuma alteração no resolvedor temporal, disponibilidade ou reserva;
- nenhuma tentativa de resolver "último dia disponível do mês" (fora de escopo,
  seção 1).

## 4. Inventário obrigatório — todas as respostas fixas que podem chegar ao paciente,
com o texto literal

### 4.1 `gerar-resposta-paciente.ts` — fallback determinístico

Cada linha: condição exata que aciona + **texto literal ou template exato** +
classificação (**paraquedas necessário** = cai só quando a IA falha/é reprovada, nunca
é o caminho normal; **operação real** = reflete fato operacional do Core, nunca
conversa; **fallback conversacional potencialmente prejudicial** = pode soar mecânico/
repetitivo em conversa real, candidato a acompanhamento, fora do escopo de correção
desta spec).

| `case` | Condição exata | Texto literal / template | Classificação |
|---|---|---|---|
| `horarios_disponiveis` | ver 4.1.1 | ver 4.1.1 | ver 4.1.1 |
| `aguardando_confirmacao` | Core propôs horário exato livre, aguarda "sim" | `Encontrei esse horário: {data} às {horário}. Posso confirmar?` | operação real |
| `reserva_criada` | RPC de reserva confirmou sucesso | `Prontinho! Agendamento confirmado para {data} às {horário}.` | operação real |
| `reserva_conflito` | RPC recusou por sobreposição de corrida | `Esse horário acabou de ficar indisponível. Pode escolher outro horário?` | operação real |
| `saudacao` | `natureza_mensagem = saudacao`, sem procedimento conhecido | `Olá! Como posso te ajudar hoje?` | paraquedas necessário |
| `aguardando_procedimento` | procedimento não resolvido (4 motivos equivalentes) | `Qual procedimento ou atendimento você está buscando?` | paraquedas necessário |
| `duvida_livre` | pergunta/comentário fora do vocabulário de agendamento | `Posso te ajudar a agendar uma consulta. Me conta qual procedimento você precisa.` | paraquedas necessário |
| `mensagem_nao_compreendida` | interpretadora não classificou com segurança | `Desculpa, não entendi. Pode explicar de outro jeito?` | paraquedas necessário |
| `desistencia` | recusa/encerramento sem outro conteúdo | `Sem problemas! Se precisar, é só chamar.` | paraquedas necessário |
| `pedido_multiplo_detectado` | evento `pedido_multiplo` (specs/multiplos-procedimentos-mesmo-turno-v1.md) | `Vamos marcar um procedimento de cada vez. Qual você quer marcar primeiro?` | paraquedas necessário — genérico por contrato, não por falha |
| `aguardando_data_horario` | ver 4.1.2 | ver 4.1.2 | ver 4.1.2 |
| `aguardando_escolha_dentista` | mais de um dentista apto | `Para esse atendimento temos {nome}. Pode ser com ele?` (1 dentista) ou `Encontrei mais de um profissional para esse atendimento: {nomes}. Qual você prefere?` (vários); com `preferencia_nao_localizada`: `Não encontrei esse profissional aqui. Para esse atendimento temos {nome(s)}. {Pode ser com ele? / Qual você prefere?}` | paraquedas necessário |
| `cadastro_necessario` | faltam campos cadastrais obrigatórios | `Para confirmar esse agendamento, preciso completar seu cadastro antes. Pode me passar {campos em português}?` | paraquedas necessário |
| `cpf_ja_cadastrado` | troca de telefone aceita mas CPF já pertence a outro cadastro | `Esse CPF ja consta no cadastro de outro contato aqui na clinica. Vou pedir para a recepcao te ajudar a resolver isso.` | operação real |
| `troca_telefone_pendente` | CPF já cadastrado com outro telefone | `Esse CPF ja esta cadastrado aqui com outro telefone. Quer que eu passe o cadastro para este numero? Ele e o que recebe lembretes, avisos e remarcacoes.` | operação real |
| `troca_telefone_recusada` | paciente recusou a troca | `Sem problema, deixo o cadastro como esta. Para seguir com esse agendamento, vou pedir para a recepcao te ajudar.` | operação real |
| `sem_dentista_disponivel` | nenhum profissional apto para o procedimento | `Não encontrei nenhum profissional disponível para esse atendimento. Posso verificar uma Consulta/Avaliação em vez disso?` (com alternativa) ou `Não encontrei nenhum profissional disponível para esse atendimento no momento.` (sem alternativa) | paraquedas necessário |
| `sem_agendamento_para_remarcar` | paciente sem agendamento ativo, pediu remarcação | `Não encontrei nenhum agendamento seu para remarcar no momento.` | operação real |
| `aguardando_escolha_agendamento` | mais de um agendamento ativo, pediu remarcação | `Você tem mais de um agendamento: {1) data às horário; 2) ...}. Qual deles você quer remarcar?` | operação real |
| `aguardando_confirmacao_remarcacao` | Core propôs troca concreta de horário | `Você está com {data atual} às {horário atual}. Quer passar para {data nova} às {horário novo}?` | operação real |
| `remarcacao_criada` | RPC de remarcação confirmou sucesso | `Prontinho! Sua consulta foi remarcada para {data} às {horário}.` | operação real |
| `sem_agendamento_para_cancelar` | paciente sem agendamento ativo, pediu cancelamento | `Não encontrei nenhum agendamento seu para cancelar no momento.` | operação real |
| `aguardando_escolha_agendamento_cancelamento` | mais de um agendamento ativo, pediu cancelamento | `Você tem mais de um agendamento: {1) data às horário; 2) ...}. Qual deles você quer cancelar?` | operação real |
| `aguardando_confirmacao_cancelamento` | Core identificou o agendamento a cancelar | `Você quer cancelar {procedimento com dentista }de {data} às {horário}?`; com `confirmacao_nao_compreendida`: `Só quero ter certeza antes de cancelar: você confirma que quer cancelar {...} de {data} às {horário}?` | operação real |
| `cancelamento_criado` | RPC de cancelamento confirmou sucesso | `Pronto, cancelei seu agendamento de {data} às {horário}.` | operação real |
| `combinacao_indisponivel` | dentista escolhido não realiza o procedimento nem a avaliação | `Não consigo agendar esse atendimento com {dentista}. Quer tentar outro procedimento com {dentista}?` | operação real |
| `clinica_sem_catalogo`, `erro_catalogo_dentista`, `duracao_nao_configurada`, `erro_configuracao_duracao`, `reserva_falhou` | falha técnica real (5 casos, 1 frase genérica) | `Tive um problema técnico agora. Pode tentar de novo em instantes?` (`RESPOSTA_FALHA_TECNICA_GENERICA`) | paraquedas necessário |

#### 4.1.1 Sub-variantes de `horarios_disponiveis` (função `respostaHorariosDisponiveis`)

| Sub-variante | Condição | Texto literal / template | Classificação |
|---|---|---|---|
| `opcoes` | uma ou mais opções reais calculadas | `Horários livres para {data}: {lista separada por vírgula}. Qual você prefere?` | operação real |
| `sem_disponibilidade` | agenda cheia na data | `Não encontrei nenhum horário livre para essa data. Quer tentar outra data?` | operação real |
| `sem_expediente_no_dia` (domingo) | clínica não atende domingo | `Não temos atendimento aos domingos. Quer escolher outro dia?` | operação real |
| `sem_expediente_no_dia` (profissional) | profissional não atende nesse dia | `Esse profissional não atende nesse dia. Quer escolher outra data?` | operação real |
| `horario_exato_disponivel` | estruturalmente inalcançável nesta posição (orquestrador intercepta antes) | `Encontrei um horário disponível: {data} às {horário}.` | inalcançável hoje |
| `horario_exato_indisponivel` (2 vizinhos) | horário pedido ocupado, ambos vizinhos existem | `Esse horário não está livre. Tenho {anterior} ou {posterior} disponíveis. Qual você prefere?` | operação real |
| `horario_exato_indisponivel` (1 vizinho) | só um vizinho existe | `Esse horário não está livre. Tenho {único} disponível. Prefere esse?` | operação real |
| `horario_exato_indisponivel` (0 vizinhos) | nenhum vizinho | `Esse horário não está livre e não encontrei outro próximo nessa data. Quer tentar outra data?` | operação real |
| `configuracao_invalida`, `erro_intervalos` | falha técnica de configuração | `Não consegui calcular os horários agora. Pode tentar novamente em instantes?` | paraquedas necessário |

#### 4.1.2 Sub-variantes de `aguardando_data_horario` (função `respostaAguardandoDataHorario`)

| Sub-variante (motivo) | Condição | Texto literal | Classificação |
|---|---|---|---|
| `incompleto` → `intencao_ausente`/`data_ausente` | falta a data | `Para qual data você gostaria de agendar? Pode ser hoje, amanhã ou uma data específica.` | paraquedas necessário |
| `incompleto` → `horario_recorrente_nao_suportado` | "qualquer horário mais próximo" + horário exato | `No momento só consigo buscar horário pra uma data específica. Qual data você prefere?` | paraquedas necessário |
| `ambiguo` (5 motivos, 1 inalcançáveis hoje) | data/horário ambíguo | `Não consegui entender exatamente a data ou horário. Pode me dizer de um jeito mais direto, tipo "15/03" ou "14h"?` | paraquedas necessário |
| `invalido` → data (`data_impossivel`, `ano_fora_do_dominio`, `ano_dois_digitos`) | data não existe no calendário | `Essa data não existe no calendário. Pode conferir e me mandar de novo? Ex.: 15/03.` | paraquedas necessário |
| `invalido` → horário (`hora_fora_do_dominio`, `minuto_fora_do_dominio`, `horario_24_00`) | horário fora do domínio | `Esse horário não é válido. Pode me mandar de novo? Ex.: 14h ou 14:30.` | paraquedas necessário |
| `invalido` → estrutural (`atomo_invalido`, `quantidade_atomica_excedida`) | erro estrutural, hoje inalcançável | `Não consegui entender a data ou horário. Pode reformular?` | paraquedas necessário |
| `passado` → data (`data_passada`, `dia_semana_esta_passado`) | data já passou | `Essa data já passou. Você quer marcar pra uma data futura?` | paraquedas necessário |
| `passado` → horário (`horario_passado`, `inicio_ate_passado`, `termino_ate_passado`) | **este é o motivo dos bloqueios 3, 4 e 5 da seção 1** | `Esse horário de hoje já passou. Prefere outro horário hoje, ou outro dia?` | paraquedas necessário — **é aqui que o loop do caso real acontece** |
| `conflito` (7 motivos, inalcançáveis hoje) | mais de uma data/horário na mesma mensagem | `Percebi mais de uma data ou horário na sua mensagem e fiquei em dúvida. Pode confirmar só uma?` | paraquedas necessário |
| `erro_configuracao` → fuso (`fuso_ausente`, `fuso_formato_invalido`) | configuração de fuso da clínica | `Não consegui calcular os horários dessa clínica agora. Pode tentar novamente em instantes?` | paraquedas necessário |
| `erro_configuracao` → `instante_atual_invalido` | falha do transporte | `Tive um problema técnico agora. Pode tentar de novo em instantes?` | paraquedas necessário |

### 4.2 Resposta especial de truncamento (`index.ts`)

| Constante | Condição exata | Texto literal | Classificação |
|---|---|---|---|
| `TEXTO_RESPOSTA_TRUNCADA_APOS_RETRY` | `ErroClienteModeloOpenAI` com `categoria` ou `categoriaPrimeiraTentativa === 'resposta_truncada'`, depois da única retentativa permitida (`tratarErroDoTurno`) | `Tive uma dificuldade para entender sua mensagem agora. Você pode repeti-la, por favor?` | paraquedas necessário — nunca deixa o paciente em silêncio após falha técnica de truncamento da interpretadora |

### 4.3 Achado — `aguardando_data_horario` → `passado` é a origem do loop

`aguardando_data_horario` → `passado` (a origem exata dos bloqueios 3-5 do caso real) é
classificada pela spec original (`resposta-conversacional-v1.md` seção 6) como um dos
"estados de falha técnica real" — mas na prática ela cobre um caso genuinamente
conversacional ("essa data/horário já passou, quer tentar outro?"), não uma falha do
sistema. **Nenhuma mudança é proposta aqui** para essa classificação — está fora do
escopo desta correção (que é sobre a guarda, não sobre o fallback em si) — mas fica
registrado porque a mesma frase fixa, repetida sem variação, é o que tornou o loop do
caso real visível e irritante ao paciente. Se a correção da guarda (seção 3) permitir
a redatora responder naturalmente nesses turnos, o fallback deixa de ser acionado na
maioria dos casos e este ponto perde urgência — mas a classificação em si não é
alterada por esta spec.

### 4.4 Achado separado, sem solução proposta: três `DecisaoOrquestrador` sem fallback
válido em `gerarRespostaPaciente`

**Achado da revisão do Codex, confirmado por leitura direta do código.**
`DecisaoOrquestrador` tem **34 tipos** (`orquestrador-tipos.ts`, contados um a um:
todo `tipo: '...'` dentro da união, excluindo `'resolvido'` de
`ResultadoResolucaoTemporal`, que é outro tipo, citado dentro de um comentário).
`gerarRespostaPaciente` (`gerar-resposta-paciente.ts`) tem um `switch (decisao.tipo)`
**sem `default`**, e **não trata três desses tipos**:

- `cadastro_atualizado`;
- `correcao_cadastro_invalida`;
- `correcao_cadastro_falhou`.

**Confirmado, não presumido:** `npm run typecheck` reporta, hoje, em produção
(`main`), exatamente este erro —

```
core/gerar-resposta-paciente.ts(56,70): error TS2366: Function lacks ending return
statement and return type does not include 'undefined'.
```

— já tratado neste projeto como parte do baseline preexistente de erros de tipo
(rastreado em entregas anteriores, nunca investigado até agora). Em runtime, chamar
`gerarRespostaPaciente` com um desses três tipos **não lança exceção** — o `switch`
sem `case` correspondente e sem `default` simplesmente não executa nenhum `return`, e
a função devolve `undefined`, violando silenciosamente seu próprio contrato de tipo
(`(decisao: DecisaoOrquestrador) => string`).

**Consequência real:** se a redatora falhar, não estiver configurada, ou for
reprovada pela guarda **exatamente** num desses três desfechos, o fallback determinístico
que deveria proteger o paciente devolve `undefined` em vez de uma frase — e o
comportamento resultante (o que `index.ts` faz com uma `string` que na verdade é
`undefined` em runtime JavaScript) não foi mapeado por esta investigação.

**Nenhuma solução é proposta aqui.** Por instrução explícita: este achado é
registrado separadamente, para decisão e aprovação específicas do Gabriel — inclusive
sobre se a correção pertence a esta spec ou a uma spec própria, dado que os três
tipos vêm de `specs/correcao-cadastro-conversacional-v1.md`, não desta frente.

**Nenhuma resposta fixa é removida nesta etapa** — instrução explícita do pedido
original, respeitada integralmente.

## 5. Auditoria — novo campo aditivo sobre `conversas_auditoria`

### 5.1 Contrato do campo novo

Um único campo nullable, nome claro, na tabela já aprovada e implementada
(`conversas_auditoria`, `specs/auditoria-conversas-admin-v1.md`):

```sql
alter table public.conversas_auditoria
  add column resposta_rejeitada_pelo_fiscal text;
```

**Semântica exata — corrigida nesta revisão (achado do Codex: contradição na versão
anterior entre "preenchido sempre que a guarda reprova" e "nunca gravar string
vazia").**

- **Preenchido com o texto original** exatamente quando: a redatora produziu texto
  (`textoRedigido` existe em `gerar-resposta-conversacional.ts`) **e** a guarda o
  reprovou por um motivo que envolve conteúdo real a exibir —
  `horario_nao_autorizado`, `data_nao_autorizada` ou `execucao_nao_autorizada`. Nesses
  três casos, o texto gravado é o texto **original**, exatamente como a redatora
  escreveu — nunca editado, nunca truncado.
- **`null` quando o motivo é `texto_vazio`.** Não existe conteúdo útil para mostrar —
  o "texto original" seria a própria string vazia (ou só espaços), que não é
  informação para um administrador revisar. Gravar `''` violaria a mesma regra que
  proíbe usar string vazia como substituto de ausência de fato em qualquer outro
  campo deste projeto; `null` é o valor correto e único aceitável aqui.
- **`null` em todos os demais casos:** redatora não configurada
  (`clienteRedator === null`, `motivo_fallback = 'redator_nao_configurado'`), redatora
  falhou antes de responder (exceção na chamada, `motivo_fallback = 'falha_redatora'`
  — não há texto, a chamada nunca completou), ou a resposta foi aprovada
  (`motivo_fallback = null`).
- Preenchido (não-`null`) **somente** quando `resultado_turno = 'sucesso'` **e**
  `motivo_fallback` for um dos três valores acima — mesmo padrão de constraint
  condicional que a migration já usa para `motivo_fallback` em si (`check
  (motivo_fallback is null or resultado_turno = 'sucesso')`).

### 5.2 Mudança mínima no Core (`gerar-resposta-conversacional.ts`)

`ResultadoRespostaConversacional` ganha um terceiro campo:

```ts
export interface ResultadoRespostaConversacional {
  resposta: string;
  motivo_fallback: MotivoFallbackResposta | null;
  /** Texto original da redatora, SOMENTE quando a guarda o reprovou por um
   * motivo com conteudo real (horario_nao_autorizado, data_nao_autorizada,
   * execucao_nao_autorizada). `null` para texto_vazio (nao ha conteudo util)
   * e para qualquer outro desfecho. Nunca exposto ao paciente -- so para
   * auditoria (specs/guarda-redatora-fiscal-conversa-v1.md). */
  resposta_rejeitada_pelo_fiscal: string | null;
}
```

No ponto exato onde a guarda reprova (linha ~172-175 hoje):

```ts
const resultadoGuarda = verificarRespostaRedatora(textoRedigido, fatos);
if (!resultadoGuarda.aprovado) {
  return {
    resposta: gerarRespostaPaciente(entrada.decisao),
    motivo_fallback: resultadoGuarda.motivo,
    resposta_rejeitada_pelo_fiscal:
      resultadoGuarda.motivo === 'texto_vazio' ? null : textoRedigido,
  };
}
```

Os outros dois retornos da função (`redator_nao_configurado`, `falha_redatora`) e o
retorno de sucesso ganham `resposta_rejeitada_pelo_fiscal: null` explicitamente — nunca
por omissão, seguindo a disciplina já usada no resto do Core ("ausente, nunca
inferido").

### 5.3 Mudança mínima em `index.ts` e `auditoria-conversas.ts`

`index.ts`, no desestruturar de `gerarRespostaConversacional` (linha ~270) e na
chamada a `gravarAuditoriaSucesso` (linha ~423): repassar o campo novo.

`GravarAuditoriaSucessoEntrada` (`auditoria-conversas.ts`) ganha
`respostaRejeitadaPeloFiscal: string | null`, repassado para `inserirLinha` como
`resposta_rejeitada_pelo_fiscal`.

**Nada muda no ponto de gravação de falha** (`gravarAuditoriaFalha`) — a guarda nunca
roda nesse caminho (o erro interrompe o fluxo antes da redação), então o campo é
sempre `null` ali, e a spec de auditoria original já cobre esse ponto sem alteração.

### 5.4 Migration nova (aditiva)

```sql
-- specs/guarda-redatora-fiscal-conversa-v1.md
alter table public.conversas_auditoria
  add column resposta_rejeitada_pelo_fiscal text;

comment on column public.conversas_auditoria.resposta_rejeitada_pelo_fiscal is
  'Texto original produzido pela redatora quando a guarda o reprovou por um motivo '
  'com conteudo real (horario_nao_autorizado, data_nao_autorizada, '
  'execucao_nao_autorizada). NULL para texto_vazio (sem conteudo util), quando a '
  'redatora nao estava configurada, ou quando falhou antes de responder.';

-- ROLLBACK:
-- alter table public.conversas_auditoria drop column resposta_rejeitada_pelo_fiscal;
```

Nenhuma mudança de constraint, índice ou RLS existente — só a coluna nova, nullable,
sem `NOT NULL` em nenhum cenário.

### 5.5 Portal (`iris-portal-v2`) — alteração da rota e do modal JÁ EXISTENTES

**Correção sobre a versão anterior desta spec (achado do Codex): a tela administrativa
de conversas já existe e está em produção.** Não há tela a construir — há uma rota e
um modal existentes a estender, aditivamente:

- **`src/app/api/admin/conversas/route.ts`** — o tipo `LinhaAuditoria` (linhas ~79-88)
  ganha o campo `resposta_rejeitada_pelo_fiscal: string | null`; o `select` da função
  `listarMensagensDoTelefone` (linha ~159) ganha `,resposta_rejeitada_pelo_fiscal` na
  lista de colunas pedidas ao Supabase. A função `listarConversasPorTelefone` (que só
  lista telefones distintos, sem o conteúdo das mensagens) não precisa do campo.
- **`src/components/ModalConversasAdmin.tsx`** — o tipo `Mensagem` (linhas ~27-36)
  ganha o mesmo campo; o bloco de renderização de cada mensagem (linhas ~171-193)
  ganha uma linha condicional, exibida **somente quando** `m.resposta_rejeitada_pelo_fiscal`
  não for `null`, identificada claramente como **"Resposta bloqueada pelo fiscal"** —
  rótulo literal, visualmente distinto de "Resposta produzida" (o rótulo já existente
  para `resposta_iris`, herdado da spec original seção 1.2.1). Quando o campo for
  `null`, nenhum bloco adicional aparece — não um traço, não "N/A", ausência total.

Nenhuma outra alteração de UI, rota, autenticação ou paginação — o mecanismo de
`is_admin`, cursor composto, e ausência de cache já existentes permanecem intocados.

## 6. Paridade Core/Edge

**Correção factual sobre a versão anterior (achado do Codex): `index.ts` não tem par
em `src/core/`** — é o entrypoint HTTP da Edge Function (`Deno.serve`), existe
somente em `supabase/functions/iris-nova-mensagem/`, e não faz parte da disciplina de
paridade Core/Edge (que se aplica a módulos com correspondente nos dois lados,
`00-INICIO.md`).

Arquivos tocados **com par em `src/core/` e `supabase/functions/iris-nova-mensagem/`**,
sujeitos à paridade:

- `guarda-resposta-redatora.ts` (seção 3.2 — condicionar a checagem de horário/data
  ao objetivo; nenhuma fonte nova, seção 3.3);
- `gerar-resposta-conversacional.ts` (seção 5.2 — novo campo no retorno);
- `auditoria-conversas.ts` (seção 5.3 — novo campo na entrada).

Arquivo tocado **sem par**, portanto fora da checagem de paridade:

- `index.ts`, só em `supabase/functions/iris-nova-mensagem/` (seção 5.3 — repassar o
  campo do retorno de `gerarRespostaConversacional` para `gravarAuditoriaSucesso`).

Nenhum arquivo novo. A disciplina de paridade já documentada em `00-INICIO.md`
("cada arquivo da Edge que possui correspondente no Core deve permanecer em
paridade com ele") se aplica, sem exceção nova, aos três primeiros.

## 7. Verificação exigida antes de aprovar

- **Conversa real completa** (seção 1, os 8 turnos) executada contra o Core corrigido:
  os 5 bloqueios não devem se repetir da mesma forma — a redatora deve poder responder
  naturalmente reconhecendo a preferência de 16h, explicando a limitação de "hoje já
  passou" e respondendo sobre o funcionamento, sem cair no mesmo fallback fixo cinco
  vezes seguidas. (Não é exigido que o sistema resolva "último dia do mês disponível"
  — isso é capacidade fora de escopo, seção 1.)
- **Teste negativo — disponibilidade inventada continua bloqueada:** com `objetivo =
  'apresentar_horarios'` e `horarios_disponiveis: ['14:00']`, uma resposta da redatora
  citando `'15:00'` continua reprovada (`horario_nao_autorizado`) — prova que a
  correção não afrouxa a proteção original, só restringe onde ela se aplica.
- **Teste positivo — 16h como preferência não é bloqueado:** com `objetivo =
  'pedir_data_ou_horario'` (ou outro objetivo fora do conjunto fechado da seção 3.2) e
  fatos **sem** `horarios_disponiveis`/`proposta_pendente`/`agendamento_confirmado`
  contendo `16:00`, uma resposta que reconhece "16h" mencionado pelo paciente é
  **aprovada** — hoje seria reprovada.
- **Teste — funcionamento 07h às 19h passa apenas fora do conjunto protegido, NUNCA
  por ser aceito como fonte (seção 3.3), em DOIS cenários que precisam divergir:**
  (a) com `objetivo` fora do conjunto fechado (ex.: `acolher_e_retomar`) e
  `clinica_conhecida.horario_funcionamento` presente contendo `07:00`/`19:00` —
  **aprovado**, exclusivamente porque o objetivo é conversacional e a checagem não
  roda; (b) com `objetivo` **dentro** do conjunto fechado (ex.: `apresentar_horarios`,
  sem `07:00`/`19:00` em `horarios_disponiveis`) e a mesma fonte presente — a resposta
  citando `07:00` ou `19:00` continua **reprovada** (`horario_nao_autorizado`). Os dois
  cenários juntos provam que não existe fonte nova: o resultado depende inteiramente
  do objetivo, nunca do conteúdo de `horario_funcionamento`.
- **Teste — falsa confirmação continua bloqueada:** com `objetivo` **dentro** do
  conjunto fechado (ex.: `informar_reserva_criada`) e uma resposta afirmando reserva em
  horário que não está em `agendamento_confirmado`, a reprovação
  `data_nao_autorizada`/`horario_nao_autorizado` continua ocorrendo — prova que os
  onze objetivos protegidos continuam com a checagem ativa, com exatamente as fontes
  já existentes hoje (nenhuma nova, seção 3.3). **Repetir especificamente para
  `pedir_confirmacao_cancelamento` e `informar_cancelamento_criado`** (adicionados
  nesta revisão) — nenhum teste anterior os cobria.
- **Par negativo por causa, para cada um dos onze objetivos protegidos** (seção 3.2):
  cada um precisa de um caso onde a checagem de fato reprova um horário/data inventado
  **especificamente naquele objetivo** — não basta provar em um só e presumir os
  demais. Atenção especial a `escolher_entre_agendamentos` e
  `escolher_entre_agendamentos_cancelamento`: precisam continuar aprovando horários
  vindos de `agendamentos_candidatos` (não regredir o defeito de 2026-08-11) e
  continuar reprovando horário fora de qualquer fonte.
- **Teste — os três objetivos mantidos fora do conjunto (seção 3.2) NÃO fiscalizam
  data/horário, em nenhum caso** (correção do Codex sobre a versão anterior desta
  spec, que descrevia esse comportamento de forma logicamente impossível): para
  `cumprimentar_e_mencionar_tratamento_pendente` (e os outros dois objetivos da lista),
  com `agendamentos_do_paciente` presente contendo um horário real — a resposta que
  cita **esse mesmo horário** é aprovada; a resposta que cita um horário **diferente,
  não presente em nenhum fato** também é aprovada, pelo mesmo motivo (a checagem de
  horário/data não executa para este objetivo, então não há valor que ela possa
  reprovar).
- **Teste de execução nos três objetivos conversacionais — cenário corrigido (achado
  do Codex sobre a versão anterior desta spec).** Um teste com
  `agendamentos_do_paciente` presente e a resposta dizendo "está confirmado" **não**
  prova nada sobre a guarda de execução: `afirmaExecucao`
  (`guarda-resposta-redatora.ts`) já **ignora deliberadamente** particípios
  `confirmad`/`marcad`/`agendad` quando existe agendamento existente
  (`temAgendamentoExistente`, que inclui `agendamentos_do_paciente` não vazio) —
  "está confirmado" ali descreve legitimamente o agendamento real, e a implementação
  atual permite isso por design, não por lacuna. Dois cenários corretos, para provar a
  guarda de execução de fato:
  - **sem nenhum agendamento existente nos fatos** (`agendamento_confirmado`,
    `agendamento_atual` e `agendamentos_do_paciente` todos ausentes/vazios): a
    resposta "está confirmado" é reprovada por `execucao_nao_autorizada`;
  - **com `agendamentos_do_paciente` presente**, mas usando um particípio **fora** da
    lista de exceção de `afirmaExecucao` — `"foi remarcado"` (o regex de execução
    inclui `remarcad[oa]s?`, e a exceção de `temAgendamentoExistente` só cobre
    `confirmad|marcad|agendad`, nunca `remarcad`) — continua reprovada por
    `execucao_nao_autorizada`, mesmo com o agendamento real presente no turno. Prova
    que a guarda de execução distingue "descrever um fato existente" de "afirmar uma
    operação nova que o Core não executou", mesmo dentro dos três objetivos onde a
    checagem de horário/data está ausente.
- **Auditoria — campo novo, três casos distintos, nunca um teste genérico:**
  - guarda reprova por `horario_nao_autorizado`/`data_nao_autorizada`/
    `execucao_nao_autorizada` → grava o texto original;
  - guarda reprova por `texto_vazio` → grava `null`;
  - turno aprovado, `redator_nao_configurado`, ou `falha_redatora` → grava `null`.
- **Rota e modal do portal (seção 5.5):** a linha "Resposta bloqueada pelo fiscal"
  aparece quando o campo existe e desaparece por completo quando é `null` — testado
  nos dois estados, não presumido de um só.
- **Paridade Core/Edge** conferida nos três arquivos com par (seção 6), byte a byte.
  `index.ts` (sem par) verificado só por `deno check`/teste funcional, nunca por
  paridade.
- **Suíte completa** sem regressão silenciosa — em particular:
  - o teste `'aprova horarios vindos de agendamentos_candidatos (defeito corrigido)'`
    (`escolher_entre_agendamentos`) precisa continuar passando **sem alteração**;
  - o teste `'aprova horarios vindos de agendamentos_do_paciente (contexto
    conversacional)'` (`acolher_e_retomar`) precisa continuar passando, agora porque o
    objetivo está fora do conjunto fechado (antes passava porque a fonte cobria o
    horário; a nova razão é estrutural, o resultado é o mesmo);
  - o teste `'horario fora das listas continua REPROVADO -- a correcao nao afrouxa'`
    muda de expectativa **conscientemente** (seção 3.3) — de reprovado para aprovado,
    com o motivo da mudança documentado no próprio teste, nunca uma edição silenciosa;
  - todos os demais testes de `guarda-resposta-redatora.test.ts` continuam passando
    sem alteração — a suíte completa deve ser rodada e cada divergência explicada,
    nunca presumida.

## 8.1 Achado posterior à primeira aprovação: `passado` descartado na passagem
Core → fatos (não é defeito da guarda nem da redatora)

**Contexto.** Depois da primeira implementação desta spec, a avaliação com IA real
(`src/eval/teste-real-conversa-guarda-fiscal.ts`) confirmou que a guarda parou de
bloquear (0 dos 7 turnos caiu no fallback fixo original) — mas nos turnos 5 e 6 a
redatora propôs "hoje, 16h" como se fosse uma oferta válida, exatamente o horário que
o próprio Core já tinha classificado como passado. Diagnóstico dirigido (turnos 4-7,
com `decisao`, `fatos`/`historicoRecente` enviados à redatora, resposta original,
resultado do fiscal e resposta final, todos capturados do payload real) isolou a
causa:

- no turno 5, `decisao.resultado` era `{ tipo: 'passado', motivo: 'horario_passado' }`
  — o Core **já sabia** que o horário pedido tinha passado;
- `derivarFatosAutorizados`, `case 'aguardando_data_horario'`
  (`fatos-autorizados.ts`, ~linha 715), **descarta `decisao.resultado` por completo** e
  sempre produz `{ objetivo: 'pedir_data_ou_horario', dados_faltantes: ['data'], ... }`
  — indistinguível entre "faltou a data" e "a data pedida já passou";
- a redatora, sem receber esse fato, propôs de novo o horário que o Core já havia
  rejeitado — não por má redação, e sim porque o fato correspondente nunca chegou até
  ela. `motivo_fallback` era `null` nos quatro turnos diagnosticados: a guarda nunca
  interveio, a perda é anterior a ela, na montagem dos fatos.

**Confirmação adicional:** `gerar-resposta-paciente.ts` (`respostaAguardandoDataHorario`,
~linha 214) já discrimina os 6 `tipo`s de `ResultadoResolucaoTemporal` (com `motivo`
granular dentro de cada um) para montar o fallback determinístico — a informação
sempre existiu no `resultado`, só nunca foi repassada à redatora.

**Os turnos 4 e 7 da mesma avaliação NÃO servem de evidência de comportamento de
produção** — o fixture sintético deste runner não define `horario_funcionamento` na
clínica, e o turno 7 caiu em `configuracao_invalida`/`sem_jornada` (falha de fixture,
não achado de comportamento real).

**Correção aprovada pelo Gabriel — a menor possível, sem tocar em nenhum outro
ponto:** `FatosAutorizados` ganha um campo novo, `pedido_temporal_ja_passou?: true`,
preenchido **exclusivamente** quando `decisao.resultado.tipo === 'passado'` neste
`case`. Os outros cinco tipos (`incompleto`, `ambiguo`, `invalido`, `conflito`,
`erro_configuracao`) continuam **sem** o campo — nunca `false` (mesma disciplina do
resto do projeto: ausência de fato, não valor negativo). O `motivo` interno
(`horario_passado` vs `data_passada` etc.) permanece de fora — é vocabulário do Core,
nunca da conversa; a redatora só precisa saber **que** passou, não **qual** dos cinco
motivos de "passado" se aplica.

**O que esta correção NÃO faz** (por instrução explícita): não cria objetivo novo
(continua `pedir_data_ou_horario`); não cria frase fixa nem regex; não amplia o
fiscal (`guarda-resposta-redatora.ts` não muda); não adiciona fonte de disponibilidade;
não corrige o fixture de `horario_funcionamento` do runner (fica para rodada
separada, com autorização própria).

**Instrução da redatora (`redator-instrucoes.ts`), adicionada nesta mesma correção,
por necessidade — não opcional:** sem uma linha explicando o que
`pedido_temporal_ja_passou` significa, o campo chegaria aos fatos sem nenhum efeito
prático — a IA não tem como inferir sozinha que um campo booleano novo pede uma
reação específica. A instrução é curta e direta, no mesmo padrão do resto do
arquivo: quando presente, dizer que passou e pedir uma data/horário futuro, nunca
propor de volta o que o próprio Core já rejeitou.

**Os 4 testes obrigatórios desta correção:**
1. `resultado.tipo === 'passado'` (qualquer um dos 5 `motivo`s) produz
   `pedido_temporal_ja_passou: true` — `fatos-autorizados.test.ts`.
2. Os outros 5 tipos NÃO produzem o campo (ausente, nunca `false`) —
   `fatos-autorizados.test.ts`.
3. O payload real capturado da redatora (via `EntradaRedator`, sem chamada de rede)
   recebe o campo quando presente, e não o recebe quando ausente —
   `gerar-resposta-conversacional.test.ts`.
4. **A redatora, com IA real, ao receber o fato, não volta a propor o horário
   passado — explica que passou e pede uma alternativa futura.** Este teste exige
   uma nova avaliação paga (`src/eval/teste-real-conversa-guarda-fiscal.ts` ou um
   cenário equivalente, focado nos turnos 5-6 do caso real) e **não foi executado
   nesta rodada** — instrução explícita do Gabriel de não rodar avaliação paga sem
   nova autorização. Os testes 1-3 provam que o fato é produzido e transportado
   corretamente; o teste 4 prova que a IA reage a ele como esperado, e permanece
   pendente até a próxima autorização.

## 9. O que este documento NÃO decide

- Se `aguardando_data_horario` → `passado` deveria ganhar um fallback mais variado ou
  contextual — fora de escopo (seção 4.3).
- A capacidade "último dia disponível do mês" — explicitamente fora, por instrução do
  pedido original.
- **A correção dos três tipos de `DecisaoOrquestrador` sem fallback em
  `gerarRespostaPaciente`** (seção 4.4) — achado registrado, sem solução proposta;
  decisão e aprovação específicas do Gabriel, possivelmente em spec própria (os três
  tipos pertencem a `specs/correcao-cadastro-conversacional-v1.md`, não a esta
  frente).
- Qualquer mudança na autenticação, paginação ou demais partes da rota/modal do
  portal além do requisito pontual da seção 5.5.
- **A correção do fixture `horario_funcionamento` no runner de avaliação real**
  (seção 8.1) — registrado como pendência separada, sem implementação nesta rodada.

## Aprovação

Este documento não autoriza nenhuma implementação. Aguardando: revisão de arquitetura,
segurança e aderência (Codex) e aprovação explícita do Gabriel — só então a
implementação (código, migration local/dev) pode começar, e mesmo essa implementação
não incluiria migration em produção, deploy ou publicação sem autorização própria e
posterior, mesma disciplina de toda mudança já registrada neste projeto.
