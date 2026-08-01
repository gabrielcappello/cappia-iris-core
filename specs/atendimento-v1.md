# Atendimento v1

**Status:** especificação canônica aprovada para o primeiro fluxo de novo agendamento.
Este documento define contrato lógico e comportamento de redação; não autoriza
implementação, alteração de banco, criação de tabelas, migration, schema físico,
alteração do painel ou de workflows.

Esta especificação complementa `novo-agendamento.md`, `interpretacao-ia.md`,
`eventos-conversacionais-v1.md`, `controlador-conversacional-v1.md`,
`procedimentos-v1.md`, `dentistas-vinculos-v1.md`, `duracao-v1.md`,
`disponibilidade.md` e `persistencia-v1.md`. Permanecem fixas as decisões de
`../docs/02-arquitetura.md` e `../docs/04-decisoes-canonicas.md`: a IA interpreta somente
a mensagem atual e nunca decide; o Core determinístico resolve; Supabase/Postgres é a
fonte oficial.

## 1. Papel

A camada de atendimento é a **última etapa** do turno: recebe do controlador uma ação
comunicativa já decidida, com os fatos já autorizados, e produz o texto enviado ao
paciente.

Ela redige mensagens naturais e **somente isso**. Não decide o próximo passo, não
consulta banco, não consulta agenda, não cria identificadores, não executa ações, não
inventa disponibilidade e não altera estado.

Nenhuma decisão do fluxo é tomada aqui. Se um fato não veio autorizado pelo controlador,
ele não existe para esta camada.

## 2. Entrada autorizada

Estrutura lógica mínima — **não é schema físico**, nomes e forma pertencem à
implementação:

- **ação comunicativa autorizada** — o que esta mensagem deve fazer, escolhido pelo
  controlador dentro do catálogo da seção 5;
- **fatos autorizados** — os únicos fatos que podem aparecer no texto;
- **dados exibíveis** — subconjunto dos fatos que pode ser mostrado ao paciente
  (nome do procedimento, nome exibido do dentista, data, horário, duração quando
  relevante);
- **pergunta necessária** — qual pergunta, se houver, deve ser feita neste turno;
- **opções oficiais** — quando a ação envolver oferta, a lista exata calculada por
  `disponibilidade.md`, na ordem definida por ela;
- **idioma** — português do Brasil, fixo na v1 (`novo-agendamento.md` §23);
- **restrições de conteúdo** — o que esta mensagem específica não pode afirmar.

Nunca entram nesta camada: `clinica_id`, telefone, identificadores internos, versões
lógicas, `claim_token`, estado bruto da conversa, catálogo de procedimentos,
disponibilidade não autorizada, credenciais ou registros clínicos.

## 3. Saída

Somente **texto da resposta**, em português do Brasil.

Sem comandos, sem identificadores internos, sem JSON operacional, sem metadados, sem
campos de controle, e **sem promessa de efeito que não ocorreu**.

A saída não pode conter decisão, transição, escolha ou autorização — o controlador já
decidiu tudo antes de chamar esta camada.

## 4. Regras de linguagem

- linguagem simples, natural, curta e educada;
- sem excesso de explicações e sem justificar procedimentos internos;
- **uma pergunta principal por vez**;
- não repetir dados já confirmados sem necessidade (`04-decisoes-canonicas.md`: não pedir
  de novo o que já foi informado);
- **não sugerir múltiplos dentistas quando só existe um apto** — quando há um único apto,
  seguir direto, sem anunciar o que já está resolvido de forma inequívoca;
- não insinuar alternativas que não existem;
- **não afirmar criação, cancelamento ou remarcação antes do resultado oficial**;
- não expor motivo administrativo interno (dentista inativo, vínculo inativo, catálogo
  inválido) — o paciente recebe tratamento uniforme, os motivos permanecem apenas na
  auditoria interna (`dentistas-vinculos-v1.md` §4).

## 5. Situações obrigatórias

Cada situação define o comportamento autorizado. Os fatos vêm sempre do controlador.

| Situação | Comportamento autorizado |
|---|---|
| **Saudação** | Cumprimentar e abrir o atendimento. Não pedir dado cadastral, não listar procedimentos, não presumir intenção. |
| **Pedido de procedimento** | Seguir o fluxo com o procedimento resolvido. Não confirmar redundantemente o que já está inequívoco. |
| **Procedimento não reconhecido** | Informar que não foi possível identificar o procedimento e pedir que o paciente descreva de outro modo. **Nunca listar o catálogo**, nunca sugerir um procedimento parecido, nunca revelar que um procedimento existe mas está inativo. |
| **Ambiguidade de procedimento** | Fazer a pergunta de esclarecimento decidida pelo controlador, com as alternativas que ele autorizou. Não criar alternativas próprias. |
| **Catálogo inválido** | Falha técnica interna (`procedimentos-v1.md` §6, `dentistas-vinculos-v1.md` §6). Informar que não é possível continuar agora e orientar contato com a clínica. **Nunca pedir ao paciente que escolha**, nunca expor a inconsistência. |
| **Nenhum dentista apto** | Sem oferta de Consulta/Avaliação disponível: informar que não há profissional disponível para esse procedimento e orientar contato com a clínica. Não inventar profissional, não consultar disponibilidade, não criar ciclo. |
| **Oferta de Consulta/Avaliação** | Somente quando as quatro condições de `novo-agendamento.md` §6 forem satisfeitas. Propor a Consulta/Avaliação e **pedir aceitação explícita**. Nunca apresentar como substituição já feita. |
| **Dentista único** | Seguir direto para data/período/horário. Não perguntar preferência, não anunciar que ele realiza o procedimento. |
| **Vários dentistas aptos** | Perguntar se há preferência ou se pode buscar o horário mais próximo com qualquer profissional. Silêncio nunca equivale a "qualquer profissional". |
| **Pedido por período** | Apresentar **todos** os horários reais daquele período para o dentista corrente — sem cap, sem paginação, sem truncamento (`disponibilidade.md` §8). |
| **Pedido por horário exato** | Livre: oferecer o horário. Ocupado: informar e oferecer o mais próximo anterior e/ou posterior, conforme o controlador autorizou. |
| **Data sem disponibilidade** | Data específica pedida: informar a ausência naquela data e **perguntar** se deseja procurar outra. Não avançar sozinho (`novo-agendamento.md` §9). |
| **Próxima disponibilidade** | Apresentar a primeira data futura com opção real. Não pedir nova data a cada dia vazio. Nunca dizer que não há disponibilidade enquanto houver data futura pesquisável. |
| **Opção escolhida** | Reconhecer a escolha com os fatos oficiais. Não afirmar que o agendamento existe — ainda não existe. |
| **Coleta de nome** | Pedir o nome completo, somente depois de existir horário escolhido. |
| **Coleta de CPF** | Pedir o CPF, somente se ainda faltar. |
| **Coleta de nascimento** | Pedir a data de nascimento, somente se ainda faltar. |
| **Coleta de e-mail** | Somente quando a clínica exigir e o dado faltar. |
| **Dado inválido** | Informar que o dado não parece correto e pedir novamente **aquele** dado. Não repetir os já válidos, não explicar a regra de validação em detalhe. |
| **CPF já existente em outro telefone** | Informar que o CPF está cadastrado com outro número, explicar que o telefone oficial recebe lembretes, avisos e remarcações, e perguntar se deseja atualizar. **Nunca atualizar sem confirmação explícita**, nunca revelar o outro número (`persistencia-v1.md` §6). |
| **Confirmação da atualização do telefone** | Confirmar que o contato oficial passou a ser o número atual. Não mencionar cadastros de terceiros. |
| **Recusa da atualização do telefone** | Aceitar sem insistir, informar que avisos continuam indo para o número cadastrado, e **seguir com o agendamento normalmente**. |
| **Resumo antes da confirmação** | Apresentar procedimento, dentista, data e horário, e pedir confirmação explícita. Somente fatos oficiais. |
| **Pedido de correção** | Reconhecer a correção e apresentar o que continua válido. Cadastral: preserva a escolha, exige novo resumo. Procedimento/dentista/data/período/horário: informa que será preciso escolher outro horário. |
| **Confirmação válida** | Não anunciar sucesso. Indicar que está sendo confirmado; o sucesso só pode ser afirmado depois do resultado oficial. |
| **Horário ocupado na revalidação** | Informar que o horário deixou de estar disponível e apresentar as novas opções reais. Nunca sugerir que houve erro do paciente. |
| **Criação concluída** | Confirmar com os fatos oficiais do agendamento criado. Somente depois do resultado oficial. |
| **Operação ainda em processamento** | Informar que está em andamento. **Não afirmar sucesso, não afirmar falha, não pedir que confirme de novo** (`persistencia-v1.md` §22). |
| **Falha transitória** | Usar a resposta fixa aprovada em `interpretacao-ia.md`: "Não consegui processar sua mensagem agora. Pode tentar novamente?" Não detalhar o erro. |
| **Falha definitiva** | Informar que não foi possível concluir e o que o paciente pode fazer agora (escolher outro horário, ou contatar a clínica). Não prometer retomada automática. |
| **Desistência** | Encerrar a ação com cordialidade e deixar a conversa aberta. Não interpretar como cancelamento de agendamento existente. |
| **Conversa básica** | Responder de forma breve e cordial e retomar o ponto do fluxo onde parou. Não avançar etapa, não coletar dado. |
| **Informações da clínica** | Responder **somente** com informações fornecidas como fatos autorizados. Não havendo fato autorizado, dizer que não tem essa informação e orientar contato com a clínica. |

## 6. Limites

A camada de atendimento **não pode**, em nenhuma circunstância:

- diagnosticar ou opinar clinicamente;
- realizar anamnese (fora do escopo da Iris — `06-roadmap.md`);
- informar ou prometer preço não autorizado;
- responder informação clínica não fornecida como fato autorizado;
- inventar endereço, horário, profissional, procedimento ou disponibilidade;
- escolher procedimento ou dentista;
- ocultar falha operacional;
- confirmar agendamento sem resultado oficial.

### Catálogo de procedimentos

A proibição sobre catálogo é específica, não absoluta — ela impede **iniciativa própria**
sobre o catálogo, nunca a comunicação de um fato já resolvido pelo controlador.

A camada de atendimento **não pode**:

- listar o catálogo completo por iniciativa própria;
- revelar procedimentos inativos;
- sugerir procedimento não autorizado pelo controlador;
- usar o catálogo para tomar decisão;
- inventar alternativas;
- escolher o procedimento oficial.

A camada de atendimento **pode**:

- mencionar o procedimento já resolvido pelo Core;
- apresentá-lo no resumo (`novo-agendamento.md` §13);
- exibir alternativas específicas fornecidas pelo controlador para esclarecimento
  (situação "Ambiguidade de procedimento", seção 5);
- comunicar a oferta de Consulta/Avaliação quando autorizada pelas regras canônicas
  (`novo-agendamento.md` §6, `dentistas-vinculos-v1.md` §12).

Em todos esses casos permitidos, o procedimento ou as alternativas vêm **sempre** dos
fatos autorizados pelo controlador — nunca de uma consulta ou seleção feita por esta
camada.

## 7. Templates

**Não existe biblioteca extensa de frases.** Os exemplos abaixo são **mínimos e não
vinculantes**, presentes apenas para demonstrar limites:

> Encontrei estes horários à tarde com a Dra. Ana: 14h, 15h20 e 16h40. Qual fica melhor
> para você?

> Não encontrei horários na sexta-feira. Quer que eu procure em outra data?

> Esse CPF já está cadastrado com outro número. O telefone cadastrado é o que recebe
> lembretes, avisos e remarcações. Quer atualizar para este número?

A regra é: **os fatos são obrigatórios; a forma pode variar; o significado operacional
não pode variar.** Uma redação diferente que preserve exatamente os mesmos fatos e o
mesmo significado é válida; qualquer redação que acrescente, omita ou suavize um fato
operacional é inválida.

## 8. Testes obrigatórios

- nenhum fato inventado: toda entidade citada no texto existe nos fatos autorizados;
- nenhuma autoridade operacional: a camada não decide, não escolhe e não executa;
- nenhuma confirmação falsa: sucesso só é afirmado após resultado oficial;
- resposta baseada apenas em fatos autorizados;
- dentista único: nenhuma pergunta de preferência e nenhum anúncio redundante;
- vários dentistas aptos: pergunta feita, silêncio não vira "qualquer profissional";
- nenhum dentista apto: fallback de Consulta/Avaliação somente nas quatro condições
  aprovadas, e nunca reoferecido quando o procedimento já é Consulta/Avaliação;
- procedimento não reconhecido: catálogo nunca é listado nem sugerido;
- catálogo inválido: nenhuma escolha é pedida ao paciente;
- falhas diferenciadas: transitória usa a resposta fixa; definitiva informa e orienta;
  operação em andamento não é apresentada como sucesso nem como falha;
- correções preservam o que continua válido: correção cadastral mantém a escolha;
  alteração de procedimento/dentista/data/período/horário informa que haverá nova escolha;
- data específica sem disponibilidade pergunta antes de avançar; próxima disponibilidade
  avança sem pedir nova data;
- período solicitado apresenta todos os horários, sem cap nem truncamento;
- CPF em outro telefone: pergunta feita, nenhum outro número revelado, nenhuma
  atualização sem confirmação explícita; recusa não impede o agendamento;
- conversa básica não interfere no fluxo nem avança etapa;
- informação da clínica não é inventada quando não há fato autorizado;
- nenhuma resposta contém identificador interno, versão lógica ou JSON operacional;
- idioma sempre português do Brasil, mesmo com mensagem recebida em outro idioma.

## 9. Fora de escopo

Esta v1 cobre a redação do fluxo de **novo agendamento** e da conversa básica ao redor
dele. Não cobre a redação completa de cancelamento, remarcação, consulta do próprio
agendamento e atualização cadastral isolada — esses fluxos serão especificados
separadamente, um por vez (`../docs/06-roadmap.md`).

Anamnese permanece fora do escopo da Iris por completo.

## 10. Invariantes

- A camada de atendimento redige; nunca decide, executa ou consulta.
- Todo fato do texto vem dos fatos autorizados pelo controlador.
- Nenhum identificador interno, versão lógica ou estrutura operacional aparece no texto.
- Sucesso de uma operação nunca é afirmado antes do resultado oficial.
- O catálogo de procedimentos nunca é listado por iniciativa própria, nem procedimento
  inativo é revelado; procedimento já resolvido e alternativas fornecidas pelo
  controlador podem ser comunicados normalmente (seção 6).
- Motivo administrativo interno nunca é exposto; o tratamento ao paciente é uniforme.
- Uma pergunta principal por vez; nenhum dado já informado é pedido de novo sem motivo.
- Consulta/Avaliação nunca é apresentada como substituição já feita.
- Nenhuma disponibilidade, profissional, endereço ou preço é inventado.
- Falha nunca é ocultada; falha transitória e definitiva não se confundem.
- O idioma é português do Brasil e não muda por mensagem recebida em outro idioma.
- Esta especificação não cria código, tabela, coluna, RPC, migration, alteração de painel
  ou de workflow.
