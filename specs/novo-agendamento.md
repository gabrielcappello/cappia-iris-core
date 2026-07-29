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

Responder:

> Para esse procedimento, o melhor é começar por uma Consulta/Avaliação. Posso verificar um horário para você?

A substituição do procedimento solicitado por Consulta/Avaliação só ocorre depois da aceitação explícita do paciente.

Nunca trocar silenciosamente o procedimento.

---

## 7. Duração do atendimento

A duração é configurada individualmente para cada dentista.

Existem somente dois modos:

### Duração fixa automática

Todos os procedimentos daquele dentista utilizam a mesma duração configurada.

Exemplo:

- todos os atendimentos: 60 minutos.

### Duração por procedimento

Cada vínculo entre dentista e procedimento possui sua própria duração.

Exemplo:

- limpeza com Dra. Ana: 50 minutos;
- consulta com Dra. Ana: 30 minutos.

Não existe modo manual com lista de slots.

A duração deve ser resolvida individualmente para cada dentista antes de consultar a agenda dele.

Não aplicar uma duração única a todos os dentistas envolvidos na busca.

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
- duração configurada para aquele dentista;
- horários de trabalho;
- intervalos;
- bloqueios;
- agendamentos existentes;
- data, período e horário solicitados.

A Iris apresenta apenas opções realmente disponíveis.

### Dentista único ou preferência resolvida

Consultar somente a agenda daquele dentista, usando a duração correspondente.

### Qualquer profissional

Quando o paciente aceitar qualquer profissional, o Core deve:

1. consultar internamente cada dentista apto;
2. usar a duração configurada individualmente para cada um;
3. respeitar os critérios já informados pelo paciente;
4. identificar a melhor opção disponível.

"Melhor opção disponível" significa a opção mais próxima que respeite:

- data;
- período;
- horário informado.

Quando o paciente aceitar qualquer profissional, a "melhor opção disponível" é definida por:

- menor data e horário dentro dos critérios já informados pelo paciente: data, período e horário;
- em caso de empate exato entre dois ou mais dentistas no mesmo horário, desempate pelo identificador do dentista, em ordem estável.

Esse critério de desempate é técnico e invisível ao paciente. Não representa prioridade ou ranking entre profissionais e não exige nova configuração no painel.

Mantém-se a decisão já aprovada de apresentar somente uma opção por vez (ver seção 10).

Exemplo:

Se o paciente pediu sexta-feira à tarde, a busca deve ocorrer dentro de sexta-feira à tarde.

Não oferecer quinta-feira de manhã apenas por ser o primeiro horário geral disponível.

Se não existir disponibilidade dentro dos critérios solicitados, a Iris deve informar isso antes de propor uma alternativa fora deles.

---

## 10. Apresentação das opções

A Iris não deve apresentar uma lista misturando vários dentistas e vários horários.

Quando o paciente aceitar qualquer profissional, apresentar somente uma opção por vez, informando claramente o horário e o dentista.

Exemplo:

> Encontrei amanhã às 14h com a Dra. Ana. Esse horário serve para você?

Se o paciente não aceitar, apresentar a próxima melhor opção disponível.

A próxima opção pode alterar:

- horário;
- dentista;
- ou ambos.

O nome do profissional deve sempre ser informado antes de o paciente aceitar o horário.

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
- CPF: deve possuir 11 dígitos e dígitos verificadores válidos;
- data de nascimento: deve ser uma data real e não futura;
- e-mail: solicitado somente quando configurado pela clínica e validado por formato básico de e-mail.

Nome, CPF e data de nascimento são obrigatórios.

O e-mail é condicionado à configuração da clínica.

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

Se o paciente corrigir algum dado, atualizar o estado e apresentar um novo resumo antes de pedir confirmação novamente.

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
- documento;
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

- horário perdido na revalidação: `executando → aguardando_escolha`;
- desistência explícita: qualquer estado ativo → `atendimento`;
- alteração de procedimento, dentista, data ou horário após existir uma escolha registrada: invalidar a escolha anterior e retornar para `aguardando_escolha`.

Essa última regra aplica-se durante `aguardando_escolha`, `coletando_cadastro` e `aguardando_confirmacao`.

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
- resolver a duração por dentista;
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
12. apenas uma opção de horário e dentista é mostrada por vez;
13. paciente rejeita a primeira opção e recebe a próxima;
14. nenhum dentista realiza o procedimento;
15. Consulta/Avaliação é oferecida;
16. Consulta/Avaliação só substitui o procedimento após aceitação;
17. duração fixa automática;
18. duração por procedimento;
19. dentistas diferentes usam durações diferentes;
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
- o documento obrigatório é CPF válido.

A Iris responde sempre em português brasileiro.

O idioma não é detectado a partir da mensagem do paciente e não é alterado automaticamente durante a conversa.

Mensagens recebidas em outro idioma não autorizam a Iris a mudar o idioma da resposta.

Espanhol e suporte a clínicas de outros países ficam fora desta especificação.

Quando forem implementados, deverão possuir especificação própria para idioma, documento e regras locais do país correspondente.

Os testes desta entrega são somente em português brasileiro.
