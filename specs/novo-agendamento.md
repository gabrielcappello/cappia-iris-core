# Novo agendamento — v0.1 consolidada

## 1. Objetivo

Permitir que o paciente realize um novo agendamento pelo WhatsApp, desde a primeira mensagem até a confirmação final, usando apenas informações e horários reais da clínica.

Esta especificação não inclui:

- remarcação;
- cancelamento;
- consulta de agendamentos;
- atualização cadastral isolada;
- anamnese;
- Google Calendar.

A primeira implementação utilizará o calendário interno da Cappia.

---

## 2. Entrada e isolamento

Cada mensagem recebida deve conter, no mínimo:

- instância autenticada do WhatsApp;
- telefone do paciente;
- `message_id`;
- conteúdo da mensagem;
- data e hora de recebimento.

A clínica é identificada exclusivamente pela instância autenticada do WhatsApp.

Nunca aceitar `clinica_id` informado pelo paciente ou pela IA.

Cada conversa é isolada por:

`clínica + telefone`

A Iris deve conseguir atender simultaneamente diferentes pacientes e clínicas, sem misturar estados ou dados.

---

## 3. Identificação do paciente

O paciente é procurado desde a primeira mensagem pela combinação:

`clínica + telefone`

### Paciente existente

Quando encontrado:

- carregar os dados permitidos do cadastro;
- aproveitar os dados já conhecidos;
- não solicitar novamente um dado já existente;
- solicitar apenas dados obrigatórios que estejam faltando, quando chegar o momento do cadastro.

### Paciente novo

Quando não existir paciente para a combinação clínica + telefone:

- tratá-lo como paciente novo;
- aproveitar qualquer dado cadastral já informado na conversa;
- não solicitar o cadastro completo imediatamente;
- solicitar os dados necessários somente depois que existir um horário disponível escolhido.

O telefone é obtido do WhatsApp e não precisa ser solicitado novamente.

---

## 4. Aproveitamento dos dados da conversa

A Iris deve interpretar e salvar todos os dados informados pelo paciente, independentemente da ordem.

Exemplo:

> Sou Diego Perez e quero uma limpeza amanhã à tarde.

Dados aproveitados:

- nome: Diego Perez;
- intenção: novo agendamento;
- procedimento: limpeza;
- data relativa: amanhã;
- período: tarde.

Uma mensagem nova acrescenta informações ao estado existente.

Um campo ausente na nova mensagem não apaga um valor já conhecido.

Um valor só deve ser substituído quando o paciente fizer uma correção clara.

Exemplo:

> Na verdade, queria sexta-feira.

Nesse caso, a data anterior é substituída.

Um dado já informado não deve ser solicitado novamente, salvo dúvida real ou correção solicitada pelo paciente.

---

## 5. Procedimento

Antes de consultar disponibilidade, o sistema deve identificar o procedimento solicitado.

A IA recebe somente os procedimentos ativos e autorizados daquela clínica e indica o procedimento correspondente à mensagem do paciente.

O Core valida se o procedimento retornado:

- existe;
- pertence à clínica;
- está ativo.

A IA não cria procedimentos e não possui autoridade para escolher um registro inexistente.

Quando houver ambiguidade real entre procedimentos, a Iris deve perguntar ao paciente antes de continuar.

Exemplo:

> Você precisa de uma consulta geral ou de uma consulta ortodôntica?

Nenhuma disponibilidade deve ser consultada antes de o procedimento estar resolvido.

---

## 6. Dentistas aptos

Depois de resolver o procedimento, o Core deve:

- localizar os dentistas ativos que realizam o procedimento;
- ignorar dentistas inativos;
- respeitar os vínculos reais configurados na clínica.

### Preferência informada na conversa

Se o paciente mencionar um dentista em qualquer mensagem da conversa atual, isso já é considerado preferência informada.

A Iris não pergunta novamente sobre preferência.

O Core valida:

- se o dentista existe e está ativo;
- se ele realiza o procedimento solicitado.

Se o dentista mencionado não estiver ativo ou não realizar o procedimento, a Iris informa isso naturalmente e continua como caso sem preferência definida.

Não existe campo permanente de dentista preferido nesta versão.

Não deduzir preferência a partir do histórico de agendamentos.

### Um dentista apto

Quando existir somente um dentista apto, seguir diretamente para a coleta de data, período ou horário.

Não perguntar se o paciente deseja agendar com ele e não anunciar de forma redundante que ele realiza o procedimento.

### Mais de um dentista apto e nenhuma preferência

Perguntar:

> Você tem preferência por algum dentista ou posso procurar o horário disponível mais próximo com qualquer profissional?

Se o paciente informar um nome, validar esse profissional.

Se aceitar qualquer profissional, consultar internamente todos os dentistas aptos.

### Nenhum dentista apto

O fallback para Consulta/Avaliação só pode ser oferecido quando, simultaneamente:

- o procedimento solicitado não for, ele mesmo, Consulta/Avaliação;
- existir exatamente um procedimento ativo da clínica marcado como Consulta/Avaliação (`procedimentos-v1.md` §8, `eh_consulta_avaliacao = true`);
- existir ao menos um dentista oficialmente apto para esse procedimento (`dentistas-vinculos-v1.md`);
- a substituição depender de aceitação explícita validada pelo Core (evento `aceitar_opcao`, `eventos-conversacionais-v1.md`).

Quando essas condições forem satisfeitas, responder:

> Para esse procedimento, o melhor é começar por uma Consulta/Avaliação. Posso verificar um horário para você?

A substituição do procedimento solicitado por Consulta/Avaliação só ocorre depois da aceitação explícita do paciente.

Nunca trocar silenciosamente o procedimento.

**Se o procedimento solicitado já for Consulta/Avaliação e não houver dentista apto**: não oferecer Consulta/Avaliação novamente, não criar ciclo, não inventar procedimento ou profissional, não consultar disponibilidade. O comportamento conversacional final para esse caso permanece pendente para `atendimento-v1.md` (`dentistas-vinculos-v1.md` §12).

---

## 7. Duração do atendimento

A duração é a configuração oficial da clínica para o procedimento (`clinica_id` + `procedimento_id`), conforme `duracao-v1.md`.

A mesma duração é aplicada a todos os dentistas aptos daquela clínica para aquele procedimento.

Exemplo:

- Limpeza na Clínica A: 50 minutos, tanto com a Dra. Ana quanto com o Dr. Bruno.

A duração não pertence ao dentista nem ao vínculo dentista–procedimento. Dentista e vínculo comprovam aptidão e isolamento, mas não alteram o valor da duração.

Não existe modo manual com lista de slots. Não existem modos de duração por dentista nesta versão.

Valor válido: inteiro, em minutos, de 10 a 240, múltiplo de 10.

As consultas de agenda continuam sendo individuais por dentista, porque cada profissional possui agenda própria — não porque a duração varie entre eles.

Configuração de duração ausente ou inválida falha fechado: nenhuma disponibilidade é consultada antes de existir duração válida, e nenhum fallback é inventado (ver `duracao-v1.md` §6).

---

## 8. Data, período, horário e fuso

A Iris deve aproveitar qualquer informação temporal fornecida pelo paciente:

- data exata;
- dia da semana;
- hoje;
- amanhã;
- manhã;
- tarde;
- noite;
- horário exato;
- horário aproximado.

Expressões relativas devem ser resolvidas usando:

- data e hora atuais;
- fuso horário cadastrado para a clínica.

Exemplo:

Uma mensagem recebida simultaneamente em clínicas de São Paulo e Manaus pode representar datas ou horários locais diferentes.

A IA interpreta a expressão temporal usada pelo paciente e devolve o texto interpretado, nunca uma data já calculada.

Exemplo:

```json
{
  "data_texto": "sexta que vem",
  "periodo": "tarde",
  "horario_texto": null
}
```

O Core é o único responsável por transformar essa expressão em data e hora reais, usando:

- a data e hora atuais;
- o fuso horário cadastrado para a clínica.

O Core valida se o período resultante não está no passado.

A IA nunca calcula, arredonda ou normaliza datas. Essa responsabilidade é exclusiva do Core.

A Iris pergunta apenas o dado temporal que ainda estiver faltando.

---

## 9. Consulta de disponibilidade

A primeira versão utiliza somente o calendário interno da Cappia.

A disponibilidade deve considerar, para cada dentista:

- procedimento;
- duração oficial da clínica para o procedimento (a mesma para todos os dentistas aptos);
- horários de trabalho;
- intervalos;
- bloqueios;
- agendamentos existentes;
- data, período e horário solicitados.

A Iris apresenta apenas opções realmente disponíveis.

### Dentista único ou preferência resolvida

Consultar somente a agenda daquele dentista, usando a duração oficial da clínica para o procedimento.

### Qualquer profissional

Quando o paciente aceitar qualquer profissional, o Core deve:

1. consultar internamente cada dentista apto;
2. usar a mesma duração oficial da clínica para o procedimento em todos eles;
3. respeitar os critérios já informados pelo paciente: data, período e horário;
4. selecionar primeiro o dentista que possuir o horário mais próximo dentro desses critérios;
5. em empate do primeiro horário entre dois ou mais dentistas, desempate pelo identificador do dentista, em ordem estável.

Esse critério de desempate é técnico e invisível ao paciente. Não representa prioridade ou ranking entre profissionais e não exige nova configuração no painel.

A apresentação dos horários desse dentista segue as regras da seção 10.

Exemplo:

Se o paciente pediu sexta-feira à tarde, a busca deve ocorrer dentro de sexta-feira à tarde.

Não oferecer quinta-feira de manhã apenas por ser o primeiro horário geral disponível.

### Ausência de horário no período solicitado

A busca deve seguir esta ordem:

1. procurar na data e no período solicitados;
2. se não houver disponibilidade, procurar nos demais períodos da mesma data;
3. se encontrar, informar que o período original está indisponível e apresentar os horários do período alternativo, mantendo um dentista por vez;
4. se não houver disponibilidade em nenhum período daquela data, informar isso e pedir outra data.

Exemplo:

> Não encontrei horários na sexta-feira à tarde, mas tenho pela manhã às 8h, 9h40 e 11h com a Dra. Ana. Algum serve ou prefere verificar outro dia?

Nesta primeira versão, não procurar automaticamente outras datas sem que o paciente indique ou aceite uma nova data.

---

## 10. Apresentação das opções

Não misturar horários de vários dentistas na mesma lista.

Apresentar um dentista por vez.

Apresentar, em uma única mensagem, todos os horários realmente disponíveis daquele dentista dentro da data e do período solicitados.

Exemplo:

> Encontrei estes horários à tarde com a Dra. Ana: 14h, 15h20 e 16h40. Qual fica melhor para você?

Quando houver apenas um dentista apto ou uma preferência já resolvida, apresentar os horários disponíveis desse profissional.

Quando o paciente autorizar qualquer profissional:

- consultar internamente todos os dentistas aptos;
- usar a mesma duração oficial da clínica para o procedimento em todos eles;
- selecionar primeiro o dentista que possuir o horário mais próximo dentro dos critérios pedidos;
- em empate do primeiro horário, usar o identificador do dentista em ordem estável;
- apresentar o nome desse dentista e todos os horários disponíveis dele dentro do período;
- se o paciente não aceitar nenhum deles, seguir para o próximo dentista apto;
- nunca misturar profissionais na mesma lista.

O nome do profissional deve sempre ser informado antes de o paciente aceitar um horário.

Como o paciente autorizou qualquer profissional, essa recomendação não representa escolha silenciosa de dentista.

---

## 11. Escolha do horário

Uma opção só é considerada escolhida quando o paciente a aceita claramente.

Exemplos:

- "Pode ser";
- "Esse horário serve";
- "Sim, às 14h";
- "Prefiro esse com a Dra. Ana".

Se o paciente pedir outro horário, a opção anterior não é considerada aceita.

A escolha deve ficar registrada de forma estruturada com:

- dentista;
- procedimento;
- data;
- hora inicial;
- duração;
- hora final.

O horário escolhido ainda não representa um agendamento criado.

---

## 12. Cadastro necessário

Somente depois de existir um horário disponível escolhido, verificar os dados cadastrais obrigatórios.

### Paciente novo

Solicitar apenas o que ainda estiver faltando:

- nome;
- CPF;
- data de nascimento;
- e-mail, somente quando a clínica estiver configurada para solicitar.

### Paciente existente

Solicitar somente dados obrigatórios que estejam incompletos.

Dados já existentes no cadastro ou informados durante a conversa não devem ser solicitados novamente.

O cadastro não deve ser exigido antes da escolha de um horário real.

### Validação de formato

Os dados cadastrais seguem validação de formato:

- nome: deve conter ao menos duas letras e não pode ser composto somente por números ou símbolos;
- CPF: ver regras específicas abaixo;
- data de nascimento: deve ser uma data real e não futura;
- e-mail: ver regras específicas abaixo.

Nome, CPF e data de nascimento são obrigatórios.

O e-mail permanece opcional e somente é solicitado quando configurado pela clínica. Quando informado, aceitar somente quando:

- não possuir espaços;
- possuir exatamente um `@`;
- existir conteúdo antes do `@`;
- existir domínio depois do `@`;
- o domínio possuir ao menos um ponto;
- existir conteúdo antes e depois desse ponto.

Não verificar se o endereço realmente existe.

CPF — nesta primeira versão, usar exclusivamente o campo `cpf`, sem referências genéricas a "documento". Validação:

- remover pontuação;
- exigir exatamente 11 dígitos;
- validar os dois dígitos verificadores;
- rejeitar sequências formadas pelo mesmo dígito, como `00000000000` e `11111111111`.

---

## 13. Resumo e confirmação

Quando o horário estiver escolhido e os dados necessários estiverem completos, apresentar um resumo.

Exemplo:

> Confere os dados?
>
> Procedimento: Limpeza dental
> Dentista: Dra. Ana
> Data: 12/08/2026
> Horário: 14h
>
> Posso confirmar?

Nenhum agendamento deve ser criado antes da confirmação explícita relacionada a esse resumo.

Respostas ambíguas não autorizam a criação.

### Correção cadastral

Quando o paciente corrigir:

- nome;
- CPF;
- data de nascimento;
- e-mail;

o Core deve:

- atualizar o dado;
- manter o horário já escolhido;
- apresentar um novo resumo;
- solicitar novamente a confirmação explícita.

### Alteração do agendamento

Quando o paciente alterar:

- procedimento;
- dentista;
- data;
- período;
- horário;

o Core deve:

- invalidar o horário escolhido;
- invalidar o resumo e a confirmação anteriores;
- retornar ao fluxo de disponibilidade;
- recalcular opções reais conforme os novos critérios;
- apresentar horários disponíveis;
- aguardar uma nova escolha;
- somente depois apresentar um novo resumo e solicitar nova confirmação.

Não reutilizar disponibilidade, escolha ou confirmação anteriores.

---

## 14. Revalidação técnica

Após a confirmação explícita, o Core deve verificar novamente se o horário continua disponível.

Essa verificação é interna e não exige uma segunda confirmação do paciente.

### Horário ainda disponível

Criar o agendamento.

### Horário indisponível

Se o horário ficar indisponível na revalidação:

- não criar o agendamento;
- retornar ao estado `aguardando_escolha`;
- apresentar uma nova opção real;
- aguardar nova aceitação explícita;
- apresentar um novo resumo;
- solicitar uma nova confirmação explícita.

Nenhuma aceitação, resumo ou confirmação da tentativa anterior pode ser reaproveitada.

Nunca informar sucesso antes de a operação técnica ser concluída.

---

## 15. Criação única e confirmação repetida

A confirmação deve resultar em:

- um único paciente, quando novo;
- um único agendamento;
- um único registro no calendário interno;
- um único resultado lógico de confirmação.

Operações críticas devem ser idempotentes.

A mesma confirmação não pode criar dois agendamentos.

### Mesma entrega técnica repetida

Quando o WhatsApp ou o provedor entregar novamente a mesma mensagem com o mesmo `message_id`:

- reconhecer a duplicidade;
- não processar novamente;
- não criar nova operação;
- não gerar uma nova resposta.

### Nova confirmação após o sucesso

Quando o paciente enviar uma nova mensagem de confirmação depois que o agendamento já tiver sido criado:

- não criar outro agendamento;
- localizar o resultado da ação já concluída;
- responder com o agendamento existente.

Exemplo:

> Seu agendamento já está confirmado para 12/08 às 14h com a Dra. Ana.

Isso também cobre o caso em que a primeira mensagem de sucesso não tenha chegado ao paciente.

---

## 16. Mensagem final

A mensagem de sucesso só pode ser enviada depois que o agendamento tiver sido criado corretamente.

Exemplo:

> Seu agendamento foi confirmado para 12/08 às 14h com a Dra. Ana.

A IA pode redigir a mensagem de forma natural, mas não pode alterar:

- procedimento;
- dentista;
- data;
- horário;
- status da operação.

---

## 17. Mensagens consecutivas

O paciente pode enviar várias mensagens legítimas em sequência.

Exemplo:

> Quero limpeza
> amanhã
> à tarde

O sistema aguarda exatamente 3 segundos após a mensagem mais recente daquela conversa antes de interpretar o conjunto.

A espera ocorre por conversa, identificada por clínica + telefone.

Outras conversas continuam sendo processadas normalmente.

Nenhuma mensagem legítima deve ser descartada.

Mensagens da mesma conversa devem ser processadas de forma ordenada para evitar que duas execuções sobrescrevam o mesmo estado.

---

## 18. Desistência

Se o paciente disser claramente que não deseja continuar, a ação atual de novo agendamento deve ser encerrada.

Exemplos:

- "Deixa para lá";
- "Não quero mais marcar";
- "Cancela isso".

A conversa retorna ao atendimento normal.

Não é necessário criar um estado específico de desistência.

Se o paciente apenas parar de responder, a Iris não envia novas mensagens por conta própria dentro deste fluxo.

---

## 19. Estado estruturado

O estado oficial da conversa deve ser salvo no Supabase/Postgres.

A Iris não depende da memória do modelo para lembrar:

- intenção;
- procedimento;
- dentista;
- data;
- período;
- horário;
- nome;
- cpf;
- data de nascimento;
- e-mail;
- horário oferecido;
- horário escolhido;
- confirmação;
- ação em andamento.

Estados obrigatórios:

- `atendimento`;
- `aguardando_escolha`;
- `coletando_cadastro`;
- `aguardando_confirmacao`;
- `executando`;
- `concluido`.

Transições obrigatórias:

- `atendimento → aguardando_escolha`: quando horários reais são apresentados;
- `aguardando_escolha → coletando_cadastro`: quando o paciente escolhe um horário e faltam dados obrigatórios;
- `aguardando_escolha → aguardando_confirmacao`: quando o horário é escolhido e o cadastro já está completo;
- `coletando_cadastro → aguardando_confirmacao`: quando os dados obrigatórios ficam completos e o resumo é apresentado;
- `aguardando_confirmacao → executando`: após confirmação explícita;
- `executando → concluido`: após criação técnica bem-sucedida;
- `executando → aguardando_escolha`: se o horário ficar indisponível na revalidação;
- qualquer estado ativo → `atendimento`: em desistência explícita;
- correção cadastral durante `aguardando_confirmacao`: permanecer em `aguardando_confirmacao`, atualizar os dados e apresentar novo resumo;
- alteração de procedimento, dentista, data, período ou horário após existir escolha registrada: invalidar a escolha e retornar para `aguardando_escolha`, após nova consulta de disponibilidade e apresentação de opções reais.

Essa última regra (alteração de procedimento, dentista, data, período ou horário) aplica-se durante `aguardando_escolha`, `coletando_cadastro` e `aguardando_confirmacao`. A correção cadastral durante `aguardando_confirmacao` não invalida a escolha nem retorna para `aguardando_escolha` — permanece nesse mesmo estado, conforme regra acima.

Quando o horário ficar indisponível na revalidação:

- apresentar novos horários reais;
- aguardar nova escolha;
- apresentar novo resumo;
- exigir nova confirmação.

Não reaproveitar escolha, resumo ou confirmação anteriores.

Os dados estruturados determinam o que ainda está faltando.

---

## 20. Responsabilidades da IA

A IA pode:

- interpretar a mensagem atual;
- extrair dados estruturados;
- identificar correções;
- interpretar datas e expressões naturais;
- reconhecer aceitação, rejeição ou confirmação;
- redigir respostas naturais usando fatos autorizados pelo Core.

A IA não pode:

- acessar banco;
- acessar calendário;
- acessar credenciais;
- executar ferramentas;
- criar agendamentos;
- decidir disponibilidade;
- inventar procedimento, dentista, data ou horário;
- alterar fatos fornecidos pelo Core.

---

## 21. Responsabilidades do Core

O Core deve:

- identificar a clínica;
- identificar o paciente;
- carregar e salvar o estado;
- validar os dados interpretados pela IA;
- resolver registros oficiais;
- localizar dentistas aptos;
- resolver a duração oficial da clínica para o procedimento;
- consultar disponibilidade;
- decidir o próximo passo;
- registrar a escolha;
- solicitar os dados faltantes;
- gerar o resumo;
- validar a confirmação;
- revalidar o horário;
- criar o paciente e o agendamento;
- garantir idempotência;
- autorizar os fatos usados na resposta.

---

## 22. Cenários obrigatórios de teste

A implementação deve cobrir, no mínimo:

1. paciente existente solicita novo agendamento;
2. paciente novo informa nome e pedido na mesma mensagem;
3. procedimento, data e período informados juntos;
4. dados enviados em mensagens separadas;
5. dado já informado não é solicitado novamente;
6. correção explícita substitui valor anterior;
7. um único dentista apto;
8. vários dentistas aptos e paciente escolhe um;
9. paciente já menciona o dentista na mensagem inicial;
10. dentista mencionado não realiza o procedimento;
11. paciente aceita qualquer profissional;
12. apenas um dentista é apresentado por vez, com todos os horários disponíveis dele na mesma mensagem;
13. paciente rejeita todos os horários do primeiro dentista e recebe o próximo dentista apto;
14. nenhum dentista realiza o procedimento;
15. Consulta/Avaliação é oferecida;
16. Consulta/Avaliação só substitui o procedimento após aceitação;
17. duração oficial da clínica para o procedimento é resolvida corretamente;
18. configuração de duração ausente ou inválida falha fechado, sem consultar disponibilidade;
19. dentistas aptos diferentes usam a mesma duração para o mesmo procedimento;
20. busca respeita data e período solicitados;
21. ausência de opção dentro dos critérios é informada antes de oferecer alternativa;
22. paciente novo só fornece cadastro depois de escolher um horário;
23. paciente existente fornece somente dados obrigatórios faltantes;
24. resumo é apresentado antes da criação;
25. correção após o resumo gera novo resumo;
26. confirmação explícita;
27. resposta ambígua não cria agendamento;
28. horário fica ocupado antes da criação;
29. confirmação cria um único agendamento;
30. mesmo `message_id` é entregue novamente;
31. nova confirmação depois do sucesso retorna o resultado existente;
32. mensagens consecutivas são aproveitadas;
33. desistência explícita encerra a ação;
34. duas clínicas são atendidas simultaneamente sem mistura de dados;
35. datas relativas são resolvidas em fusos horários diferentes.

---

## 23. Idioma, país e documento

Nesta primeira versão:

- o único país suportado é Brasil;
- o único idioma de atendimento é português brasileiro;
- o campo `cpf` é o único documento obrigatório.

A Iris responde sempre em português brasileiro.

O idioma não é detectado a partir da mensagem do paciente e não é alterado automaticamente durante a conversa.

Mensagens recebidas em outro idioma não autorizam a Iris a mudar o idioma da resposta.

Espanhol e suporte a clínicas de outros países ficam fora desta especificação.

Quando forem implementados, deverão possuir especificação própria para idioma, documento e regras locais do país correspondente.

Os testes desta entrega são somente em português brasileiro.
