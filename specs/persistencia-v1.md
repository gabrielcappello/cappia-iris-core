# Persistência v1

**Status:** especificação canônica aprovada para o primeiro fluxo de novo agendamento.
Este documento define contrato lógico e comportamento; não autoriza implementação,
alteração de banco, criação de tabelas, índices, constraints, RPCs, migration, schema
físico, alteração do painel ou de workflows.

Esta especificação complementa `novo-agendamento.md`, `interpretacao-ia.md`,
`eventos-conversacionais-v1.md`, `controlador-conversacional-v1.md`,
`procedimentos-v1.md`, `dentistas-vinculos-v1.md`, `duracao-v1.md`,
`disponibilidade.md`, `resolvedor-temporal-v1.md` e
`integracao-temporal-composicao-v1.md`. Permanecem fixas as decisões de
`../docs/02-arquitetura.md` e
`../docs/04-decisoes-canonicas.md`: a IA interpreta somente a mensagem atual e nunca
decide; o Core determinístico resolve; Supabase/Postgres é a fonte oficial.

## 1. Objetivo e escopo

Definir o contrato lógico mínimo de persistência necessário para manter o estado oficial
das conversas, armazenar pacientes e agendamentos, preservar histórico, impedir
duplicidade e sobreposição, garantir idempotência, isolar tudo por `clinica_id` e
sustentar disponibilidade, criação, remarcação e cancelamento.

A especificação é **lógica e independente do schema físico atual**. Ela não descreve as
tabelas existentes, não afirma que elas estão corretas e não autoriza reuso de nenhuma
estrutura, função ou RPC sem auditoria posterior e autorização explícita, conforme
`../docs/05-componentes-reutilizaveis.md`.

**Fora do escopo**: texto ao paciente (`atendimento-v1.md`); geração de opções
(`disponibilidade.md`); máquina de estados conversacional
(`controlador-conversacional-v1.md`); schema físico; migration; painel; workflows.

## 2. Princípio central

Supabase/Postgres é a **única fonte oficial** de: estado da conversa; pacientes;
agendamentos; mensagens recebidas; operações idempotentes; resultados operacionais.

A memória do modelo e a memória temporária da Edge Function **nunca são fonte oficial**.
Todo fato que precise sobreviver ao fim de um turno, à troca de worker ou ao reinício da
Edge Function está persistido.

A IA:

- não acessa banco;
- não produz identificadores oficiais;
- não grava, não cria, não cancela, não remarca;
- não altera status;
- não reconstrói opções de disponibilidade.

Toda escrita passa pelo Core determinístico.

## 3. Camadas e entidades lógicas mínimas

Quatro camadas, com contratos de proteção distintos:

| Camada | Entidade | Proteção |
|---|---|---|
| Transporte | `MensagemRecebida` | unicidade de transporte + claim/lease + marcador |
| Conversa | `EstadoConversa` | comparação e troca sobre a versão do estado |
| Operação | `OperacaoIdempotente` | identidade da ação única + claim/lease de retomada |
| Operacional | `Paciente`, `Agendamento` | invariantes estruturais + transação operacional |

**Não existe entidade própria** para: opção de disponibilidade; histórico; cancelamento;
remarcação; conclusão; falta; cadeia de remarcações.

A opção de disponibilidade permanece como **estrutura oficial dentro do estado da
conversa** (seção 17). O histórico funcional **deriva dos próprios agendamentos
persistidos** (seção 16).

A camada de conversa nunca é fonte de verdade operacional, e a camada operacional nunca
guarda estado conversacional. A fronteira entre elas é assim:

- a **promoção de uma opção oficial escolhida e confirmada para um efeito de
  agendamento** ocorre somente dentro da transação operacional, com confirmação validada
  e revalidação (seção 23);
- **patches cadastrais parciais de paciente existente** podem ocorrer separadamente,
  fora da transação operacional (seções 8 e 23);
- **atualizações conversacionais sem efeito operacional** permanecem no estado da
  conversa e não exigem transação operacional;
- a camada conversacional continua **sem autoridade** para criar, cancelar ou remarcar.

## 4. Isolamento multiclínica

Toda entidade possui `clinica_id`.

- `clinica_id` vem **exclusivamente** da instância autenticada do WhatsApp;
- nunca aceitar `clinica_id` vindo do paciente;
- nunca aceitar `clinica_id` vindo da IA;
- toda leitura e toda gravação incluem `clinica_id`;
- identificador de outra clínica é tratado como **inexistente**, nunca como acesso
  negado — negar acesso revelaria existência;
- referências entre entidades não atravessam clínicas.

O isolamento deve ser garantido **também estruturalmente** na futura implementação, não
apenas por convenção de consulta.

**RLS pode ser defesa adicional, mas não é suficiente**: o Core executa por um caminho de
servidor com privilégios elevados, que ignora RLS. O isolamento do Core depende da origem
de `clinica_id`, dos predicados de toda operação e das garantias estruturais abaixo.

Recomendações físicas registradas para a etapa futura, **não escolhidas nem
implementadas aqui**:

- chaves estrangeiras compostas contendo `clinica_id`, de modo que referência cruzada
  entre clínicas seja impossível por construção;
- toda unicidade escopada por clínica.

## 5. Paciente

Contrato lógico mínimo:

- `paciente_id`;
- `clinica_id`;
- `telefone_normalizado`;
- `cpf_normalizado`;
- `nome_completo`;
- `data_nascimento`;
- `email_normalizado`;
- instante da última alteração de telefone;
- origem da última alteração de telefone;
- natureza da última alteração de telefone (substituição ou transferência — seção 7);
- instante de criação;
- instante de atualização.

Regras:

- telefone oficial **único dentro da clínica**;
- CPF não nulo **único dentro da clínica**;
- o mesmo telefone ou o mesmo CPF pode existir em clínicas diferentes;
- campos cadastrais podem ser nulos;
- a obrigatoriedade para criar agendamento pertence ao controlador, nunca à estrutura —
  exigir preenchimento na persistência quebraria a regra aprovada de só pedir cadastro
  depois de existir horário escolhido (`novo-agendamento.md` §12);
- atualização cadastral é **parcial**;
- valor ausente significa "não alterar", nunca "apagar";
- dados existentes não podem ser apagados por payload incompleto;
- pacientes não são excluídos em operações normais.

`telefone_normalizado` pode ser nulo, exclusivamente no cadastro que teve o telefone
transferido (seção 7). `cpf_normalizado` pode ser nulo enquanto o CPF não tiver sido
informado. Ambas as unicidades valem apenas sobre valores não nulos.

**Forma normalizada.** O nome dos campos fixa que a forma persistida é a normalizada, e
não a digitada. A validação de formato de `novo-agendamento.md` §12 — CPF com 11 dígitos,
dígitos verificadores válidos, rejeição de sequências de dígito repetido; e-mail conforme
as regras ali definidas — ocorre **antes** de o valor normalizado ser persistido. Sem
normalização canônica, a unicidade seria contornável por formatação.

**Atualização parcial — contrato.** O Core carrega a linha, calcula o conjunto exato de
campos a escrever e emite uma atualização que toca **apenas** esse conjunto. Um campo
entra no conjunto quando está atualmente vazio ou quando o paciente o corrigiu
explicitamente na conversa. Nunca é emitida atualização integral da linha com valores
ausentes.

A atualização é protegida contra sobrescrita concorrente por comparação e troca ou versão
otimista. Em caso de perda da comparação, o Core relê, **recalcula** o conjunto de campos
e reemite — nunca reaplica o conjunto calculado sobre a leitura obsoleta. Sem essa
proteção, um dado preenchido pelo painel entre a leitura e a escrita seria sobrescrito.

Não incluir: anamnese; responsável por menor; financeiro.

## 6. CPF existente em outro telefone

Quando o CPF informado já existir na clínica associado a **outro** telefone:

1. localizar o paciente pelo CPF;
2. não criar outro paciente;
3. informar que o CPF está cadastrado com outro número;
4. perguntar se deseja atualizar o telefone;
5. explicar que o telefone oficial recebe lembretes, avisos e remarcações;
6. **nunca atualizar sem confirmação explícita**.

**Se o paciente aceitar:**

- substituir integralmente o telefone oficial;
- registrar instante, origem e referência autorizadora da alteração;
- não manter o telefone anterior como contato secundário ativo;
- preservar todos os agendamentos e todo o histórico — eles referenciam `paciente_id`,
  nunca telefone, e por isso nada se move.

**Se o paciente não aceitar:**

- manter o telefone anterior como contato oficial;
- permitir que o agendamento continue normalmente;
- avisos, lembretes e remarcações continuam destinados ao telefone cadastrado;
- não criar paciente duplicado.

A confirmação exigida aqui é uma confirmação explícita validada pelo Core, no mesmo rigor
de `eventos-conversacionais-v1.md` — nunca inferência livre sobre uma resposta ambígua.

## 7. Telefone atual pertencente a outro paciente

Caso excepcional aprovado: o CPF informado identifica um paciente, mas o telefone da
conversa corrente já é o telefone oficial de **outro** cadastro da mesma clínica.

- o CPF identifica o paciente correto;
- após confirmação explícita, o telefone atual passa a pertencer ao paciente identificado
  pelo CPF;
- remover o telefone oficial do cadastro anterior;
- **não mesclar pacientes**;
- **não transferir agendamentos**;
- não copiar CPF nem demais dados entre pacientes;
- preservar integralmente o histórico do cadastro anterior;
- o paciente anterior permanece **sem telefone oficial** até uma atualização posterior;
- registrar no cadastro anterior uma ressalva técnica de que o telefone foi transferido,
  com instante e origem.

A remoção e a atribuição do telefone ocorrem na mesma operação, de modo que a unicidade
de telefone na clínica nunca é violada e nenhum estado intermediário com telefone
duplicado é observável.

O paciente anterior deixa de ser localizável por telefone e permanece localizável por
CPF. Seus agendamentos, status, snapshots e autoria permanecem intactos.

Esse comportamento é **excepcional** e não deve acrescentar complexidade ao fluxo comum.
**Não criar sistema genérico de fusão de pacientes** — fusão permanece fora de escopo
(seção 26).

## 8. Criação do paciente

Para paciente novo:

- **não criar linha especulativamente** no início da conversa;
- criar somente depois de existir opção escolhida, dados obrigatórios completos e
  confirmação válida;
- a criação do paciente e a criação do primeiro agendamento ocorrem na **mesma transação
  operacional**;
- falha na criação do agendamento não pode deixar paciente órfão;
- conflito concorrente de CPF deve impedir duplicidade;
- o perdedor da disputa concorrente relê o paciente existente e segue o protocolo da
  seção 6, **nunca** assumindo silenciosamente que pode atualizar o telefone.

Criar o paciente na mesma transação não conflita com a regra de só pedir cadastro depois
de existir horário escolhido: aquela regra define **quando perguntar**, esta define
**quando gravar**. Nada se perde no rollback, porque os dados cadastrais coletados
permanecem no estado da conversa (seção 17).

A perda de uma disputa concorrente de CPF é um **evento de conversa**, não uma nova
tentativa técnica: a transação é desfeita integralmente e o fluxo entra no protocolo da
seção 6 ou da seção 7, conforme o caso.

Paciente **existente** pode receber atualização cadastral parcial antes da criação, fora
da transação operacional, desde que protegida contra sobrescrita concorrente (seção 5).

## 9. Agendamento

Campos lógicos mínimos:

- `agendamento_id`;
- `clinica_id`;
- `paciente_id`;
- `procedimento_id`;
- `dentista_id`;
- nome do procedimento como snapshot;
- nome do dentista como snapshot;
- duração usada;
- início;
- fim;
- data local;
- fuso IANA como snapshot;
- status;
- origem da criação;
- referência da operação de criação;
- autoria da mudança de status;
- origem da mudança de status;
- instante da mudança de status;
- referência da operação, quando a mudança for executada pela Iris;
- instante de criação;
- instante de atualização.

Regras:

- os IDs oficiais preservam **identidade**; os snapshots preservam **apresentação
  histórica**; um nunca substitui o outro;
- snapshots são lidos das fontes oficiais **no momento da criação**, dentro da transação
  operacional;
- **nunca usar texto interpretado do paciente como snapshot** — `procedimento_texto` e
  `dentista_texto` são entrada da IA e não podem alcançar o registro histórico;
- snapshots são **imutáveis**;
- mudança posterior de nome do procedimento ou do dentista não altera o histórico;
- a duração é **snapshot histórico**, nunca recalculada (`duracao-v1.md` §10);
- `fim = início + duração`;
- a duração respeita `duracao-v1.md`: inteira, em minutos, de 10 a 240, múltipla de 10;
- **nenhum registro é excluído para liberar agenda**.

O nome usado como snapshot do dentista é o **nome exibido**
(`dentistas-vinculos-v1.md` §1), nunca as entradas de resolução (nome completo ou nome
curto de resolução), que são infraestrutura de matching e não pertencem ao histórico.

Manter `fim` coerente com início e duração é condição da proteção contra sobreposição
(seção 11): um `fim` divergente corromperia silenciosamente o intervalo ocupado.

**Na remarcação**: o agendamento antigo mantém seus snapshots; o novo agendamento captura
**snapshots novos** das fontes oficiais no momento da nova criação. Copiar os snapshots
antigos exibiria no registro novo um nome já obsoleto, contrariando o propósito do
snapshot.

## 10. Status canônicos

Status exclusivos da v1:

- `confirmado`;
- `cancelado`;
- `remarcado`;
- `concluido`;
- `faltou`.

Transições normais:

```text
                    ┌──> cancelado
                    ├──> remarcado
   confirmado ──────┤
                    ├──> concluido
                    └──> faltou
```

- `confirmado → cancelado`;
- `confirmado → remarcado`;
- `confirmado → concluido`;
- `confirmado → faltou`.

Proibido:

- qualquer transição saindo de `cancelado`;
- qualquer transição saindo de `remarcado`;
- `concluido → faltou`;
- `faltou → concluido`;
- retorno de estado terminal para `confirmado`;
- qualquer outra transição entre estados terminais.

Na v1, `concluido` e `faltou` são **irreversíveis**. Correção administrativa excepcional
fica fora de escopo (seção 26).

**Consequência estrutural.** Existe exatamente um estado não terminal, e toda mudança de
status parte de `confirmado`. Portanto toda mudança de status é uma atualização
condicional com o mesmo predicado — clínica, agendamento e `status = 'confirmado'` — e a
irreversibilidade não depende de proibir cada par: nenhum caminho de saída dos estados
terminais existe.

Disso decorre também a distinção obrigatória entre repetição e rejeição:

- nenhuma linha afetada **e** status atual igual ao alvo → sucesso sem alteração;
- nenhuma linha afetada **e** status atual diferente do alvo → **operação rejeitada**,
  nunca tratada como repetição bem-sucedida.

## 11. Ocupação da agenda

**Somente `confirmado` ocupa a agenda.**

- `cancelado` libera o intervalo;
- `remarcado` libera o intervalo antigo;
- `concluido` e `faltou` são **históricos** e não ocupam a agenda;
- horários passados nunca são oferecidos (`disponibilidade.md` §15);
- **o paciente não é unidade de conflito**;
- o conflito é por clínica, dentista e intervalo.

Intervalos são semiabertos: `[início, fim)`. Adjacência é permitida — um atendimento pode
terminar exatamente quando outro começa, e começar exatamente quando outro termina
(`disponibilidade.md` §3).

Dois agendamentos `confirmado` da mesma clínica e do mesmo dentista **não podem se
sobrepor**.

A proteção futura contra sobreposição deve considerar **somente `confirmado`**. Registros
históricos não podem virar bloqueio de agenda futura: um agendamento marcado `concluido`
antes do horário do atendimento deixaria o intervalo permanentemente indisponível para a
clínica se estados históricos participassem da proteção.

O qualificador "futuro" da ocupação pertence à camada de disponibilidade, não à proteção
estrutural: uma restrição estrutural não pode depender do instante atual. Um `confirmado`
passado que permaneça bloqueando o próprio intervalo passado é inofensivo e inalcançável
pelo fluxo da Iris, que nunca oferece horários passados.

Recomendações físicas registradas para a etapa futura, **não escolhidas nem
implementadas aqui**:

- constraint de exclusão parcial sobre o intervalo, restrita a `confirmado`;
- proteção compartilhada com bloqueios e demais ocupações da agenda;
- revalidação antes da escrita, que fornece o caminho conversacional adequado;
- transação protegida contra concorrência real.

Revalidar antes de escrever não substitui a proteção estrutural: a revalidação existe
para produzir a resposta correta ao paciente, e a proteção estrutural existe para que a
sobreposição seja impossível. Uma sequência de "consultar se está livre" seguida de
"inserir separadamente" não satisfaz este contrato.

Quando a escrita for recusada por ocupação surgida entre a oferta e a confirmação, o
resultado é falha definitiva da operação (seção 22), invalidação de escolha, resumo e
confirmação, e retorno ao fluxo de disponibilidade — nunca nova tentativa cega e nunca
mensagem de sucesso.

## 12. Auditoria da mudança de status

Decisão canônica da v1:

- **não criar entidade separada de auditoria**;
- guardar a única transição normal diretamente no agendamento.

Justificativa registrada:

- cada agendamento sofre no máximo uma transição saindo de `confirmado`;
- a relação lógica é 1 para 0 ou 1;
- campos na própria linha são suficientes;
- evitam estrutura extra sem necessidade;
- status e autoria são gravados pela mesma escrita, tornando impossível um status
  terminal sem autoria correspondente;
- uma futura correção administrativa com múltiplas transições poderá justificar trilha
  append-only em versão posterior, e os campos atuais migram naturalmente para o primeiro
  registro dessa trilha.

Guardar, no mínimo:

- status anterior, implícito ou explícito;
- status novo;
- instante;
- tipo do responsável;
- identificador oficial do responsável;
- origem da ação;
- referência da operação, quando a origem for a Iris.

Na v1 o status anterior é sempre `confirmado` e pode permanecer implícito; registrá-lo
explicitamente é permitido e não altera o contrato.

Exemplos de responsável ou origem: dentista; equipe da clínica; painel principal; app do
dentista; app da equipe; Iris.

**"Quem" e "de onde" permanecem conceitos distintos.** Um dentista pode agir pelo painel
principal, e a equipe pode agir pelo app do dentista. Tipo de responsável, identificador
do responsável e origem da ação são três dimensões independentes e nenhuma é derivada das
outras.

Para a Iris:

- responsável do tipo sistema;
- origem `iris`;
- **referência obrigatória à operação idempotente** que autorizou a mudança.

Não existe identificador humano nesse caso, e nenhum deve ser inventado: a referência à
operação já carrega, transitivamente, a conversa, o tipo da ação e a versão autorizadora.

**Um status terminal não pode existir sem autoria e instante completos.**

## 13. Cancelamento

O cancelamento deve:

- exigir agendamento da mesma clínica;
- exigir status atual `confirmado`;
- mudar o status para `cancelado`;
- liberar o intervalo no commit;
- preservar todos os dados;
- registrar autoria, origem e instante;
- concluir a operação idempotente;
- atualizar o estado da conversa quando aplicável;
- **não excluir o agendamento**.

**Mesma ação repetida** (mesma identidade de ação): retorna o resultado existente; não
altera novamente autoria nem instante.

**Nova ação sobre agendamento já cancelado** (identidade de ação diferente): informa que
já está cancelado; não produz novo efeito; não altera autoria nem instante já
registrados. A operação conclui, e a natureza do resultado distingue "cancelado agora" de
"já estava cancelado".

**Cancelar agendamento em outro estado terminal** — `concluido`, `faltou` ou `remarcado`
— é **rejeitado**, nunca tratado como repetição bem-sucedida. É falha definitiva: nenhuma
retomada com a mesma identidade poderia torná-la bem-sucedida.

O tratamento conversacional de cada um desses casos pertence a `atendimento-v1.md`.

## 14. Remarcação

A remarcação ocorre em **uma única transação operacional**:

1. validar a operação idempotente;
2. validar o agendamento antigo como `confirmado`;
3. validar a nova opção oficial;
4. revalidar o novo intervalo;
5. mudar o antigo para `remarcado`;
6. registrar autoria, origem e instante;
7. criar o novo agendamento como `confirmado`;
8. capturar novos snapshots das fontes oficiais;
9. concluir a operação;
10. atualizar o estado da conversa.

**Falha em qualquer ponto** — em todos os casos, sem exceção:

- o antigo permanece `confirmado`;
- o novo não existe;
- nenhum slot é liberado parcialmente;
- a operação **nunca aparenta conclusão**; nenhuma falha produz `concluida`.

O estado da operação depende da natureza da falha (seção 22):

- **timeout, queda ou erro transitório** mantêm a operação `iniciada`, elegível a
  retomada pela mesma identidade;
- **falha definitiva** muda a operação para `falhou`;
- a classificação como `falhou` só ocorre **depois de assegurado o rollback integral do
  efeito** — nunca antes de o antigo estar comprovadamente `confirmado` e o novo
  comprovadamente inexistente.

São exemplos de falha definitiva: novo horário ocupado entre a oferta e a confirmação;
opção obsoleta; agendamento antigo não mais `confirmado`; procedimento, dentista ou
vínculo inválido; outra violação de invariante que exija nova decisão.

A regra de retomada para falhas transitórias permanece a da seção 22 e não é alterada
por esta classificação.

**Repetição** (mesma identidade de ação):

- retorna o novo agendamento existente;
- não cria terceiro registro;
- não altera novamente o antigo.

**Não criar vínculo obrigatório entre o agendamento antigo e o novo.** Ambos permanecem
no histórico do paciente, e os status já permitem visualizar o ocorrido. A consequência
aceita é que reconstruir uma cadeia de remarcações depende do histórico do paciente e dos
status, não de um encadeamento explícito.

## 15. Conclusão e falta

Operações do painel:

- `confirmado → concluido`;
- `confirmado → faltou`.

Devem:

- filtrar por `clinica_id`;
- validar o status atual;
- ser atualizações condicionais;
- registrar autoria, origem e instante;
- preservar todos os dados;
- impedir qualquer alteração posterior no fluxo normal.

A irreversibilidade não exige mecanismo adicional: o predicado exige `confirmado`, e
nenhum caminho normal sai de um estado terminal (seção 10).

Essas transições não usam identidade de ação idempotente. Sua idempotência é natural e
decorre do predicado condicional: repetir a mesma transição não afeta linha alguma e o
status atual já é o alvo. Tentar a transição oposta a partir de um terminal também não
afeta linha alguma, mas o status atual **difere** do alvo e a operação é rejeitada.

O painel deve solicitar confirmação visual antes da transição, mas essa lógica visual
fica fora desta especificação.

## 16. Histórico

O histórico é **consulta sobre os próprios agendamentos**. Não criar tabela duplicada.

Preservar: paciente; status; IDs oficiais; snapshots dos nomes; duração; início e fim;
data local; fuso; origem da criação; autoria da mudança de status; origem da mudança;
timestamps.

Cancelamento e remarcação liberam a agenda **sem apagar histórico** — a liberação decorre
do status deixar de ocupar a agenda (seção 11), nunca de remoção de dados.

O histórico do paciente no painel deriva desses registros.

Com snapshots de nome e autoria de status na própria linha, o histórico é
**auto-suficiente**: não depende de procedimento, dentista ou identidade de operador
continuarem existindo, ativos ou com o mesmo nome.

Formas de acesso que precisam ser eficientes — requisito lógico, sem escolha de índice:
histórico por clínica e paciente ordenado por início; agenda por clínica e dentista
ordenada por início.

## 17. Estado da conversa

Persistir de forma estruturada, no mínimo:

- `clinica_id`;
- conversa ou telefone oficial;
- ação em andamento;
- estado conversacional;
- paciente resolvido;
- procedimento;
- dentista;
- preferência profissional;
- data;
- período;
- horário;
- opções apresentadas;
- opção escolhida;
- dados cadastrais parciais;
- versões da escolha e do resumo;
- confirmação vinculada;
- resultado operacional;
- última mensagem processada;
- instantes de criação e atualização.

Regras:

- cada fato oficial tem **um único campo**;
- dado já informado não deve ser solicitado novamente;
- correção explícita substitui o valor anterior;
- mudança de intenção invalida somente os fatos dependentes dela;
- o estado é recuperável após reinício da Edge Function;
- atualizações concorrentes usam comparação e troca ou versão otimista;
- a opção de disponibilidade vive dentro do estado;
- **a opção não é reserva nem agendamento**.

Texto do paciente e resolução oficial são fatos **distintos**, cada um com exatamente um
campo. A expressão temporal informada e a data resolvida pelo Core coexistem
legitimamente; a regra proíbe o mesmo fato em dois lugares, não a distinção entre entrada
e resolução.

**Requisito lógico adicional, ainda sem representação física** (contrato completo em
`integracao-temporal-composicao-v1.md`, não implementado): quando o contrato
estruturado de interpretação temporal estiver em vigor, o estado da conversa precisará
de dois campos logicamente distintos, nunca fundidos — o mesmo princípio de "texto do
paciente e resolução oficial são fatos distintos" aplicado à camada temporal:

- **átomos temporais acumulados** (`fatos_temporais`) — a fonte **interpretada**,
  resultado de aplicar, mensagem a mensagem, as alterações temporais autorizadas sobre
  o que já estava acumulado; nunca reconstruída a partir do critério oficial;
- **critério temporal oficial** (`criterio_temporal`) — o resultado **derivado**, da
  última resolução bem-sucedida sobre os átomos acumulados; nunca escrito diretamente,
  nunca fonte de outro fato.

Nenhuma tabela, coluna ou tipo de coluna é escolhida por esta menção — a
representação física de ambos os campos permanece pendência explícita (seção 28), e a
forma lógica completa (categorias, regras de fusão, invalidação) pertence
integralmente a `integracao-temporal-composicao-v1.md`, não duplicada aqui.

A opção preserva os fatos exigidos por `disponibilidade.md` §16 e permanece vinculada à
versão do estado, sendo invalidada quando os fatos dependentes mudam, conforme
`controlador-conversacional-v1.md` §10. Sua promoção a agendamento exige confirmação
explícita validada e revalidação.

**A confirmação não pode ser um booleano isolado.** Ela é persistida vinculada a:

- mensagem que confirmou;
- versão da escolha;
- versão do resumo;
- ação autorizada;
- instante da confirmação.

Esse vínculo não é formalidade: é exatamente o material de onde a identidade da ação
idempotente é derivada (seção 21). A confirmação persistida **é** o registro de
autorização, e não existe indicador booleano paralelo que possa dessincronizar-se dela.

O contrato de concorrência já aprovado em `interpretacao-ia.md` — comparação e troca
sobre a versão do estado, dentro da mesma transação da persistência da interpretação —
permanece em vigor e não é alterado por esta especificação.

## 18. Mensagem recebida

Contrato mínimo:

- identificador interno;
- `clinica_id`;
- conversa;
- identidade da instância de transporte;
- identificador da mensagem no transporte;
- instante de recebimento;
- status de processamento;
- claim;
- lease;
- tentativas;
- referências do resultado;
- conteúdo bruto temporário;
- instante máximo de expiração do conteúdo;
- instante de remoção do conteúdo.

**Unicidade lógica**: clínica; instância de transporte; identificador da mensagem no
transporte. A identidade da instância de transporte inclui o provedor.

Enquanto a associação entre instância de transporte e clínica for funcional — cada
instância pertence a exatamente uma clínica —, a inclusão de `clinica_id` na unicidade é
logicamente equivalente à chave já implantada e não altera o comportamento de
deduplicação. A reconciliação exata com a chave existente é pendência de auditoria
(seção 28).

**Deduplicação de transporte é diferente de idempotência operacional.** A primeira impede
que a mesma entrega física seja processada duas vezes; a segunda impede que a mesma ação
produza dois efeitos. São mecanismos independentes, em camadas diferentes, e nenhum
substitui o outro.

O contrato de claim, lease, marcador de interpretação persistida e transições de
`status_processamento` permanece o de `interpretacao-ia.md` e não é alterado aqui. Os
campos adicionais desta seção — tentativas, referências do resultado, conteúdo bruto e
instantes de expiração e remoção — pertencem a este contrato lógico e não representam
autorização de alteração física (seção 28).

## 19. Retenção da mensagem bruta

Prazo máximo aprovado: **7 dias a partir do recebimento**.

Após o prazo:

- tornar o conteúdo bruto nulo ou irrecuperável;
- **não apagar a linha da mensagem**;
- preservar a chave de deduplicação;
- preservar identificadores;
- preservar o estado de processamento;
- preservar resultados;
- preservar fatos estruturados;
- **não apagar pacientes, agendamentos ou operações**.

Apagar a linha destruiria a chave de deduplicação: uma reentrega tardia do provedor
voltaria a ser processável, e o custo disso é um efeito operacional duplicado. Por isso a
expiração anula o conteúdo **na própria linha**, e nunca remove o registro.

A limpeza deve ser:

- periódica;
- idempotente;
- baseada no instante de recebimento;
- executada em lotes futuros;
- **independente do status de processamento** — uma mensagem abandonada em processamento
  não retém conteúdo indefinidamente.

**Mensagem sem conteúdo bruto após a expiração não pode ser enviada novamente à IA para
interpretação.** Uma reivindicação que encontre conteúdo ausente não é elegível para
interpretação. Nenhuma rotina de limpeza altera status operacional: a limpeza remove
conteúdo, e a elegibilidade é decidida no caminho de reivindicação.

O texto bruto nunca deve ser copiado para logs (seção 20), não é memória oficial após o
processamento e só pode ser usado para processamento e investigação recente.

O processo de limpeza **não é implementado nesta rodada**.

## 20. Logs

Nunca registrar:

- mensagem bruta;
- CPF;
- telefone completo;
- nome;
- data de nascimento;
- e-mail;
- credenciais;
- payload integral;
- tokens completos de claim.

Para correlação técnica de telefone, usar:

- HMAC-SHA-256;
- chave dedicada do servidor;
- entrada incluindo `clinica_id` e telefone normalizado;
- resultado truncado a 128 bits;
- chave versionada.

**Não usar hash simples sem segredo**: o espaço de telefones é pequeno o suficiente para
ser enumerado, e um hash sem chave é reversível na prática.

Incluir `clinica_id` na entrada faz com que o mesmo telefone produza correlatores
distintos em clínicas distintas, preservando o isolamento também na camada de observação.
A versão da chave acompanha o valor, de modo que a rotação não invalide correlações
históricas.

Máscara parcial só pode existir em interface autorizada, quando houver necessidade humana
específica — **nunca em logs técnicos**. Máscara em log é parcialmente reversível dentro
do escopo de uma clínica e não substitui o correlator com segredo.

Logs podem conter: identificadores técnicos; tipo de operação; estado; categoria de erro;
timestamps; versões lógicas; referência do resultado.

Sempre que um identificador técnico já existir para o vínculo desejado — conversa,
mensagem, operação, agendamento —, ele é preferível ao correlator de telefone, por ser
opaco por construção e não exigir segredo algum.

## 21. Operação idempotente

Campos lógicos mínimos:

- `operacao_id`;
- `clinica_id`;
- tipo;
- identidade da ação;
- versão autorizadora;
- mensagem autorizadora;
- alvo, quando aplicável;
- estado;
- claim;
- lease;
- tentativas;
- referência do resultado;
- natureza do resultado;
- erro definitivo, quando aplicável;
- instantes de criação, atualização, conclusão e falha.

**Tipos**: criação; cancelamento; remarcação.

**Estados**: `iniciada`; `concluida`; `falhou`.

### Identidade da ação

A identidade da ação é a combinação de clínica, tipo da operação, alvo ou escopo, e
versão autorizadora. Ela é **única**: duas execuções que produzam a mesma identidade são a
mesma ação.

| Tipo | Alvo ou escopo | Versão autorizadora |
|---|---|---|
| criação | conversa | versão do resumo confirmado |
| cancelamento | agendamento alvo | versão da decisão que autorizou |
| remarcação | agendamento de origem | versão da nova escolha e do novo resumo |

A chave idempotente é **produzida pelo Core**, exclusivamente a partir de fatos oficiais.
Nenhum componente vem da IA, do texto do paciente ou de dados do agendamento.

Isso funciona porque as regras de invalidação de `controlador-conversacional-v1.md` §10
garantem que toda mudança relevante cunha uma versão nova: repetição preserva a versão;
mudança legítima cria outra.

**Não usar** paciente, dentista, data e horário como chave universal: essa combinação
confunde repetição com segundo agendamento legítimo, que é explicitamente permitido — o
mesmo paciente pode ter vários agendamentos, inclusive no mesmo dia, e o paciente não é
unidade de conflito.

**Mesma ação com outro identificador de mensagem** produz a mesma identidade operacional
e, portanto, no máximo um efeito. **Nova ação legítima semelhante** produz identidade
nova e cria normalmente.

A versão autorizadora de cancelamento e de remarcação depende das especificações
conversacionais desses fluxos, ainda não escritas. A estrutura da identidade já as
acomoda; o valor concreto é pendência (seção 28).

### Natureza do resultado

A natureza do resultado distingue "efeito produzido agora" de "estado desejado já
vigente". Sem ela, concluir um cancelamento agora e reconhecer um agendamento já
cancelado produziriam registros indistinguíveis, embora exijam comportamentos diferentes
(seção 13).

## 22. Lease e retomada

Prazo aprovado: **5 minutos**.

### Abertura

- criar ou localizar a operação pela identidade da ação;
- estado `iniciada`;
- claim oficial;
- lease com expiração em 5 minutos.

A unicidade da identidade da ação garante que duas execuções concorrentes produzam
exatamente uma abertura; a segunda reconhece a operação existente em vez de criar outra.

### Antes da expiração

Outra execução **não assume** a operação.

### Depois da expiração

- outra execução pode tentar assumir a **mesma** operação;
- a aquisição ocorre por **comparação e troca atômica**;
- apenas uma execução vence;
- o claim é substituído;
- o lease é renovado;
- **a chave da operação permanece igual**.

A aquisição só é possível sobre operações `iniciada`: `concluida` e `falhou` são
terminais e nunca são reivindicadas. A referência de tempo é o instante da transação no
servidor, nunca um horário fornecido pela Edge Function ou pelo cliente.

### Após assumir

1. verificar se o efeito já existe;
2. se existir, reconhecer como concluído e retornar o resultado;
3. se não existir, continuar a mesma operação;
4. **nunca criar operação paralela**.

A verificação do passo 1 permanece obrigatória mesmo sendo redundante com a regra
`concluida` implica efeito (seção 23): ela é a única verificação correta caso uma operação
futura envolva efeito externo não transacional, e é a rede que preserva a correção se a
atomicidade da transação de efeito for quebrada por engano em alguma implementação.

### Classificação do insucesso

Timeout, queda e erro transitório **mantêm `iniciada`**.

`falhou` é reservado para **erro definitivo**, que exige nova decisão ou nova ação. O
critério é: nenhuma retomada com a mesma identidade poderia torná-lo bem-sucedido —
tipicamente porque um fato oficial mudou e uma nova decisão do paciente, com nova versão
autorizadora e portanto nova identidade, passa a ser necessária.

### Relação com o claim da mensagem

O claim da mensagem e o claim da operação governam autoridades distintas: o primeiro
autoriza interpretar e responder; o segundo autoriza produzir o efeito operacional. Os
prazos são diferentes por construção, e a execução do efeito **não** exige lease de
mensagem vigente — exigi-lo tornaria a retomada de 5 minutos impossível.

Isso não abre caminho para efeito não autorizado: uma reivindicação de mensagem posterior
à persistência da interpretação não executa o controlador, conforme
`interpretacao-ia.md`, e portanto nunca alcança a autorização de confirmação; e qualquer
execução que a alcançasse produziria a mesma identidade de ação, sendo absorvida pela
abertura única.

## 23. Transações

A operação idempotente possui **duas fases**.

### Abertura — transação curta

- criar ou reivindicar a operação como `iniciada`;
- registrar claim e lease;
- commit.

### Efeito — transação operacional

- revalidar os fatos;
- executar o efeito;
- registrar ou atualizar o agendamento;
- concluir a operação;
- atualizar o estado da conversa;
- commit.

**Regra fundamental: `concluida` implica que o efeito existe.** Efeito e conclusão são
persistidos na **mesma transação**. Não existe estado intermediário observável em que o
efeito exista sem conclusão, nem conclusão sem efeito.

A separação em duas fases é o que torna `iniciada` um estado observável e, portanto, o que
torna a retomada possível: um registro criado na mesma transação do efeito estaria ausente
ou já concluído, nunca em andamento.

Operações obrigatoriamente atômicas:

- paciente novo mais primeiro agendamento;
- criação do agendamento;
- cancelamento conversacional;
- remarcação;
- operação mais efeito;
- efeito mais estado conversacional resultante;
- status mais autoria correspondente.

Atualizações simples condicionais podem ser uma **única escrita atômica**, sem transação
explícita:

- conclusão;
- falta;
- atualização cadastral parcial;
- estado sem efeito operacional.

O critério é: transação é obrigatória quando duas ou mais linhas precisam concordar entre
si; não é obrigatória quando a operação é uma escrita condicional sobre uma única linha,
caso em que a própria condição é a proteção.

## 24. Busca e recuperação da operação

A retomada **não deve depender exclusivamente de nova mensagem do paciente**. Um paciente
que confirmou e não voltou a escrever não pode deixar a conversa presa indefinidamente em
execução, com ou sem efeito produzido.

Requisito arquitetural registrado:

- deve existir mecanismo futuro capaz de localizar operações `iniciada` com lease
  expirado;
- a operação pode ser retomada **sem gerar nova identidade**;
- o mecanismo exato de disparo pertence à implementação;
- varredura periódica ou outro mecanismo técnico pode ser adotado;
- a conversa não pode permanecer indefinidamente presa em execução.

Não implementado nesta rodada.

## 25. Configuração e identidades do painel

Registrado como dependência futura, **sem modelar agora**:

- origem oficial dos usuários do painel;
- identidade de dentista, equipe e operador principal;
- fuso oficial da clínica;
- exigência de e-mail;
- autenticação dos apps;
- invariantes compartilhadas entre Core, painel e apps.

O identificador oficial do responsável exigido pela auditoria de status (seção 12) não
possui, hoje, origem definida em nenhuma especificação canônica para as origens painel,
app do dentista e app da equipe. O fuso oficial da clínica, exigido por
`disponibilidade.md` §2, e a exigência de e-mail, exigida por `novo-agendamento.md` §12,
também não possuem entidade definida.

**Todos os caminhos que alterem agendamentos devem respeitar as mesmas garantias de
persistência.** Uma garantia que valha apenas no caminho da Iris não é garantia.

O painel não é auditado nesta rodada.

## 26. Fora de escopo

Não incluir: anamnese; financeiro; mensagens em massa; remarcação em massa; fusão
genérica de pacientes; correção administrativa de status; internacionalização de
documentos; implementação física; migrations; auditoria do legado; sincronização
detalhada do Google; lógica visual do painel.

## 27. Testes obrigatórios

### Paciente

- criação do primeiro paciente e do primeiro agendamento na mesma transação;
- falha na criação do agendamento não deixa paciente órfão;
- CPF não nulo é único dentro da clínica;
- o mesmo CPF existe em clínicas diferentes sem conflito;
- corrida concorrente pelo mesmo CPF na mesma clínica produz um único paciente;
- CPF existente com outro telefone não cria paciente novo e não atualiza silenciosamente;
- paciente aceita atualizar o telefone;
- paciente recusa atualizar o telefone e o agendamento continua normalmente;
- telefone substituído integralmente, sem contato secundário ativo;
- novo telefone já pertence a outro paciente da mesma clínica;
- transferência excepcional do telefone entre cadastros;
- paciente anterior preservado e sem telefone oficial, com ressalva técnica registrada;
- nenhuma fusão de históricos e nenhuma transferência de agendamentos;
- atualização parcial não apaga dados existentes;
- conflito concorrente de atualização cadastral não sobrescreve dado alheio.

### Agendamento e status

- primeira criação;
- snapshots preservados após renomear o procedimento;
- snapshots preservados após renomear o dentista;
- snapshots novos capturados na remarcação;
- cancelamento;
- cancelamento repetido (mesma identidade de ação);
- nova identidade de cancelamento sobre agendamento já `cancelado`: não é tratada como
  repetição da ação anterior; retorna "já cancelado"; não altera status, autoria nem
  instantes; não produz novo efeito;
- cancelamento sobre `remarcado`: rejeitado; não tratado como cancelamento idempotente
  bem-sucedido; não altera registro nem autoria; não libera slot adicional;
- cancelamento sobre `concluido`: rejeitado, com as mesmas garantias do caso anterior;
- cancelamento sobre `faltou`: rejeitado, com as mesmas garantias do caso anterior;
- remarcação;
- remarcação repetida;
- rollback integral da remarcação;
- falha transitória na remarcação mantém a operação `iniciada`;
- falha definitiva na remarcação produz `falhou`, e somente após o rollback integral do
  efeito estar assegurado;
- `confirmado → concluido`;
- `confirmado → faltou`;
- rejeição de `concluido → faltou`;
- rejeição de `faltou → concluido`;
- rejeição de retorno a `confirmado`;
- status terminal sem autoria é rejeitado;
- autoria registrada por dentista;
- autoria registrada por equipe da clínica;
- autoria registrada por painel principal;
- autoria registrada pela Iris, com referência à operação.

### Concorrência

- dois pacientes disputando o mesmo dentista e o mesmo intervalo;
- dois dentistas no mesmo horário;
- mesmo paciente em horários diferentes;
- mesmo paciente com procedimentos diferentes;
- sobreposição parcial;
- intervalo inteiramente contido em outro;
- adjacência nas duas bordas;
- horário ocupado entre a oferta e a confirmação;
- somente `confirmado` bloqueia;
- registros históricos não bloqueiam agenda futura.

### Mensagens e retenção

- mensagem repetida não produz efeito;
- conteúdo disponível antes de 7 dias;
- conteúdo removido depois de 7 dias;
- identificadores técnicos preservados após a remoção;
- reentrega tardia continua deduplicada;
- mensagem expirada não volta à IA;
- nenhum conteúdo bruto aparece em logs;
- mensagem ainda em `processando` ao completar 7 dias desde o recebimento: o conteúdo é
  removido mesmo assim; identificadores e estado de processamento permanecem; a mensagem
  passa a ser inelegível para nova interpretação; nenhum efeito operacional é duplicado;
- limpeza repetida sobre mensagem já sem conteúdo: nenhuma alteração indevida; instantes
  e identificadores permanecem coerentes; o processo é idempotente.

### Idempotência e retomada

- mesma confirmação;
- mesma ação com outro identificador de mensagem;
- nova ação legítima semelhante;
- duas confirmações concorrentes;
- abertura única da operação;
- retomada antes de 5 minutos é rejeitada;
- retomada depois de 5 minutos;
- duas retomadas concorrentes, com um único vencedor;
- efeito já existente durante a retomada;
- efeito ainda inexistente durante a retomada;
- queda entre a abertura e o efeito;
- queda durante a transação de efeito;
- erro transitório mantém `iniciada`;
- erro definitivo produz `falhou`;
- `concluida` sem efeito é impossível;
- retomada sem nova mensagem do paciente: a operação permanece `iniciada`, o lease expira
  após 5 minutos, o paciente não envia nova mensagem, o mecanismo futuro de recuperação
  localiza a operação expirada, retoma a **mesma identidade**, conclui ou reconhece o
  efeito, e a conversa não permanece presa indefinidamente — nenhum novo identificador de
  mensagem é necessário e nenhuma nova operação é criada.

### Multiclínica e segurança

- identificador de outra clínica é tratado como inexistente;
- mesmo telefone em clínicas diferentes;
- mesmo CPF em clínicas diferentes;
- referência cruzada entre clínicas é rejeitada;
- logs sem dados pessoais;
- correlator de telefone estável dentro da clínica;
- correlator de telefone distinto entre clínicas;
- correlator de telefone conforme o contrato da seção 20: uso de HMAC-SHA-256; chave
  dedicada e versionada; entrada incluindo `clinica_id` e telefone normalizado; resultado
  truncado a 128 bits; o mesmo telefone na mesma clínica produz correlator estável para a
  mesma versão da chave; o mesmo telefone em clínicas diferentes produz correlatores
  distintos; a rotação de versão da chave produz novo correlator; nenhum dígito do
  telefone é exposto.

## 28. Pendências técnicas e auditorias futuras

Registradas como pendentes, sem presumir correção de nenhuma estrutura existente:

- schema atual;
- tabelas atuais;
- índices e constraints;
- RPCs;
- RLS;
- conteúdo atual de mensagens recebidas;
- identidade real do transporte, incluindo a reconciliação com a chave de deduplicação já
  implantada;
- usuários e autenticação do painel;
- agenda e bloqueios;
- extensão necessária para exclusão por intervalo;
- dados atuais duplicados ou sobrepostos;
- fuso e configuração da clínica;
- mecanismo da varredura de sete dias;
- mecanismo de retomada;
- origem formal das versões autorizadoras de cancelamento e de remarcação;
- funções legadas;
- integração com Google;
- compatibilidade do painel e dos apps com as mesmas invariantes.

**Nenhum componente é autorizado para reuso sem auditoria.**

Referências futuras a harmonizar em outros documentos canônicos não foram alteradas nesta
rodada e permanecem registradas aqui como pendência documental.

## 29. Invariantes

- Supabase/Postgres é a única fonte oficial; a memória do modelo e a da Edge Function
  nunca são.
- A IA não grava, não cria, não cancela, não remarca, não altera status e não produz
  identificadores oficiais.
- Toda entidade possui `clinica_id`, derivado exclusivamente da instância autenticada.
- Identificador de outra clínica é inexistente; referências nunca atravessam clínicas.
- Telefone oficial e CPF não nulo são únicos dentro da clínica e livres entre clínicas.
- Campos cadastrais podem ser nulos; a obrigatoriedade pertence ao controlador.
- Atualização cadastral é parcial; valor ausente significa "não alterar".
- Paciente não é criado especulativamente; paciente novo e primeiro agendamento nascem na
  mesma transação.
- Nenhum paciente, agendamento ou operação é excluído em operação normal.
- Transferência de telefone é excepcional, exige confirmação explícita e nunca funde
  pacientes nem transfere agendamentos.
- IDs oficiais preservam identidade; snapshots preservam apresentação histórica; snapshots
  são imutáveis e lidos das fontes oficiais na criação.
- Texto interpretado do paciente nunca vira snapshot.
- `fim = início + duração`, e a duração é snapshot histórico que respeita `duracao-v1.md`.
- Toda transição de status parte de `confirmado`; `concluido` e `faltou` são
  irreversíveis; nenhuma transição sai de um estado terminal.
- Status terminal sem autoria e instante completos não existe.
- Somente `confirmado` ocupa a agenda; histórico nunca bloqueia agenda futura.
- Intervalos são semiabertos; adjacência é permitida; o paciente não é unidade de
  conflito.
- Consultar e depois inserir separadamente não satisfaz a proteção contra sobreposição.
- A opção de disponibilidade vive no estado da conversa, não é reserva nem agendamento.
- A confirmação persistida nunca é um booleano isolado.
- Deduplicação de transporte e idempotência operacional são mecanismos distintos.
- A identidade da ação é produzida pelo Core e nunca usa paciente, dentista, data e
  horário como chave universal.
- Uma identidade de ação produz no máximo um efeito operacional.
- `concluida` implica que o efeito existe; efeito e conclusão são persistidos na mesma
  transação.
- Timeout, queda e erro transitório mantêm `iniciada`; `falhou` é apenas erro definitivo.
- A retomada usa a mesma identidade; nunca existe operação paralela para a mesma ação.
- O conteúdo bruto da mensagem expira em 7 dias; a linha, a chave de deduplicação e os
  fatos operacionais nunca são apagados.
- Mensagem sem conteúdo bruto não retorna à IA para interpretação.
- Logs nunca contêm mensagem bruta, CPF, telefone completo, nome, nascimento, e-mail,
  credenciais, payload integral ou token completo de claim.
- Esta especificação não cria código, tabela, coluna, índice, constraint, RPC, migration,
  alteração de painel ou de workflow.
