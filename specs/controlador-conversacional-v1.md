# Controlador Conversacional v1

**Status:** especificação canônica aprovada para o primeiro fluxo de novo agendamento.
Este documento define arquitetura e comportamento; não autoriza implementação,
alteração de banco, criação de tabelas ou definição de schema físico.

Esta especificação complementa `interpretacao-ia.md`,
`eventos-conversacionais-v1.md` e `novo-agendamento.md`. Permanecem fixas as decisões de
`../docs/02-arquitetura.md`: Supabase/Postgres é a fonte oficial do estado; o Core é o
controlador determinístico; a IA interpreta somente a mensagem atual e nunca decide
transições nem executa ações.

## 1. Objetivo

O Controlador Conversacional v1 recebe o estado oficial da conversa, as alterações já
validadas e persistidas, os conflitos de valor e os `EventoCandidatoIA` da mensagem
atual. A partir deles, decide deterministicamente:

- quais candidatos são válidos, ignorados ou exigem esclarecimento;
- quais dependências lógicas são invalidadas;
- qual é o próximo passo do fluxo;
- qual transição pode ocorrer;
- quais fatos oficiais podem compor a resposta;
- se uma possível confirmação satisfaz os gates para entrar em `executando`.

Um `EventoCandidatoIA` nunca é uma decisão aceita. Somente o Core produz
`DecisaoControlador`.

## 2. Responsabilidades

O controlador deve:

1. usar somente o estado oficial retornado pela persistência transacional;
2. preservar o isolamento por clínica e telefone;
3. identificar os efeitos das alterações efetivamente persistidas;
4. invalidar dependências que deixaram de ser válidas;
5. avaliar conflitos de valor;
6. validar eventos candidatos contra estado e contexto oficial;
7. detectar candidatos ambíguos ou incompatíveis;
8. consultar serviços de domínio determinísticos quando necessário;
9. determinar o próximo dado ou passo necessário;
10. produzir decisões internas do controlador;
11. determinar a transição conversacional aplicável;
12. persistir somente o estado de conversa que for formalmente definido para
    persistência;
13. autorizar somente fatos oficiais para a resposta;
14. impedir execução baseada apenas na saída da IA;
15. preservar idempotência, claim, lease e proteção concorrente.

O controlador não deve:

- interpretar texto livre fora da saída estruturada validada;
- reconstruir intenção por fallback;
- chamar novamente a IA para o mesmo `message_id` depois da persistência da
  interpretação;
- confiar em IDs, datas calculadas ou decisões fornecidas pelo modelo;
- expor banco, agenda, credenciais ou ferramentas à IA;
- reaplicar interpretação sobre uma versão nova;
- reutilizar opção, escolha, resumo ou confirmação invalidada;
- executar efeito externo antes dos gates correspondentes.

## 3. Separação entre persistência e objetos temporários

### Estado persistido da conversa

O estado persistido é a fonte oficial entre mensagens e workers. Ele contém somente os
dados que uma futura especificação de persistência declarar necessários para continuar o
fluxo de maneira determinística.

Necessidades lógicas do estado incluem:

- estado da conversa;
- ação corrente;
- dados acumulados do paciente e do pedido;
- resoluções oficiais ainda vigentes;
- contexto pendente;
- opções apresentadas ainda vigentes;
- escolha ainda vigente;
- contexto do resumo ainda vigente;
- referência lógica de execução ou conclusão, quando aplicável;
- versão concorrente do estado.

Essas necessidades não definem colunas, tabelas, JSON, nomes físicos, índices, RPCs ou
qualquer outro schema de banco.

### Objetos internos temporários

Existem somente durante o processamento normal da mensagem atual:

- `EventoCandidatoIA[]`;
- conflitos de valor calculados por `preAplicar`;
- invalidações calculadas;
- `DecisaoControlador`;
- fatos autorizados para a resposta corrente;
- plano interno do próximo passo.

`DecisaoControlador` é um resultado interno de validação determinística. Esta
especificação **não** exige que ele seja persistido. Persisti-lo futuramente depende de
decisão específica sobre necessidade, forma, segurança e concorrência.

Eventos candidatos e conflitos permanecem em memória, conforme o contrato atual. Uma
queda posterior à persistência da interpretação não autoriza reconstruí-los nem chamar o
modelo novamente.

## 4. Entradas e saída lógica

Entrada conceitual:

```ts
interface EntradaControladorV1 {
  mensagem: {
    mensagem_recebida_id: string;
    message_id: string;
    claim_token: string;
  };

  contexto: {
    clinica_id: string;
    telefone_normalizado: string;
    conversa_id: string;
  };

  estado_oficial: EstadoConversaOficial;

  interpretacao: {
    alteracoes_aplicadas: AlteracoesDados;
    conflitos_de_valor: Conflito[];
    eventos_candidatos: EventoCandidatoIA[];
  };
}
```

Todos os identificadores vêm do Core. Nenhum deles vem da IA.

Saída conceitual e temporária:

```ts
interface ResultadoControladorV1 {
  decisoes_eventos: DecisaoControlador[];
  invalidacoes: InvalidacaoLogica[];
  proximo_passo: ProximoPassoControlador;
  estado_resultante: EstadoConversa;
  fatos_autorizados: Record<string, unknown>;
}
```

Esse contrato descreve responsabilidades internas. Não transforma
`ResultadoControladorV1`, `DecisaoControlador`, `InvalidacaoLogica` ou
`ProximoPassoControlador` em registros persistentes obrigatórios.

## 5. Fluxo completo de uma mensagem

### Processamento e interpretação

1. validar o envelope do transporte;
2. resolver a clínica pela instância autenticada;
3. reivindicar a mensagem por claim/reclaim;
4. encerrar se a mensagem não for elegível;
5. identificar paciente e conversa;
6. carregar o snapshot oficial;
7. derivar `pendente` como `nenhum`, `opcao` ou `confirmacao_resumo`;
8. montar o payload minimizado;
9. executar a interpretação estruturada;
10. validar integralmente `alteracoes` e `eventos_candidatos`;
11. executar `preAplicar`;
12. separar alterações aplicáveis e conflitos de valor;
13. executar `aplicar_interpretacao_condicional`;
14. encerrar com falha segura em autorização inválida ou conflito concorrente;
15. receber o estado oficial resultante.

### Decisão do controlador

16. identificar as alterações efetivamente persistidas;
17. calcular invalidações lógicas;
18. considerar as invalidações antes de validar os eventos candidatos;
19. avaliar conflitos de valor;
20. validar cada candidato contra estado, contexto pendente e vínculos vigentes;
21. detectar candidatos incompatíveis;
22. produzir `DecisaoControlador` temporária para os candidatos relevantes;
23. determinar o próximo passo normal do fluxo;
24. consultar serviços de domínio quando o passo exigir;
25. determinar a transição proposta;
26. persistir a mudança de estado somente pelo mecanismo concorrente que vier a ser
    aprovado;
27. revalidar o claim antes de produzir a resposta;
28. produzir resposta por template determinístico;
29. revalidar o claim antes do envio;
30. enviar;
31. finalizar a mensagem condicionalmente ao claim vigente.

## 6. Ordem de aplicação

A ordem é fixa:

```text
validar saída
    -> preaplicar alterações
    -> persistir alterações com claim + CAS
    -> obter estado oficial
    -> calcular invalidações
    -> avaliar eventos candidatos
    -> decidir próximo passo e transição
```

Eventos candidatos nunca são avaliados contra o snapshot antigo quando a mesma mensagem
também altera dados.

Uma mensagem que sinalize `confirmar_resumo` e altere procedimento, dentista, data,
período ou horário deve primeiro invalidar escolha, resumo e confirmação. O candidato de
confirmação é recusado e o estado nunca avança para `executando`.

Alterações independentes podem ser aplicadas mesmo quando outro campo tiver conflito de
valor. Um evento dependente do campo conflitante não pode ser aceito. Qualquer conflito
que possa alterar os fatos apresentados bloqueia `confirmar_resumo`.

## 7. Compatibilidade entre candidatos

| Combinação | Resultado |
|---|---|
| `desistir` com qualquer outro candidato | Incompatível; solicitar esclarecimento |
| `confirmar_resumo` com qualquer outro candidato | Incompatível; nunca autorizar execução |
| `aceitar_opcao` com `solicitar_nova_opcao` | Incompatível |
| `aceitar_opcao` com `aceitar_qualquer_profissional` | Incompatível |
| `solicitar_nova_opcao` com `aceitar_qualquer_profissional` | Compatíveis; tratados como sinal composto (ver abaixo) |
| candidatos repetidos | Saída estrutural inválida |
| um candidato com alterações não conflitantes | Avaliar normalmente |
| nenhum candidato | Seguir pelo próximo dado faltante |

O controlador nunca escolhe silenciosamente entre candidatos incompatíveis.

### `solicitar_nova_opcao` com `aceitar_qualquer_profissional`

Deixou de ser pendência. A combinação é **compatível** e tratada como um único sinal
composto, não como dois eventos avaliados isoladamente: `aceitar_qualquer_profissional`
qualifica o recálculo pedido por `solicitar_nova_opcao`.

Consequência determinística:

- `solicitar_nova_opcao` invalida a lista de opções vigente e a escolha vinculada;
- `aceitar_qualquer_profissional` remove a preferência específica por dentista;
- procedimento, duração e demais dados independentes **permanecem válidos** — nada além
  do que depende de dentista e de opções é invalidado;
- o controlador busca nova disponibilidade entre **todos os dentistas ativos e aptos** ao
  procedimento (`dentistas-vinculos-v1.md` §5, §10);
- continua processando **um dentista por vez**, pela ordem canônica de
  `disponibilidade.md` §12 — horário mais próximo primeiro, desempate estável por
  `dentista_id`;
- **nunca mistura horários de dentistas diferentes na mesma lista**;
- **não seleciona silenciosamente um dentista definitivo** — a autorização é para buscar
  entre todos, não para escolher por conta própria;
- apresenta as opções reais conforme a regra canônica da disponibilidade;
- a nova escolha volta a vincular dentista, data, horário e versão da opção.

Nenhum evento novo e nenhum estado novo são criados por esta regra.

O caso **isolado** permanece inalterado: `aceitar_qualquer_profissional` sozinho, em
`aguardando_escolha`, continua sendo ignorado (seção 8), porque nesse estado não existe
pergunta de preferência vigente à qual ele responda. A exceção vale exclusivamente para o
sinal composto descrito aqui.

**Harmonização pendente**: `eventos-conversacionais-v1.md` §6 lista `aguardando_escolha`
entre os estados em que `aceitar_qualquer_profissional` é ignorado, o que descreve
corretamente o caso isolado, mas ainda não menciona o sinal composto. A nota
correspondente naquele documento não foi escrita nesta rodada.

## 8. Matriz estado x evento candidato x transição

| Estado atual | Candidato | Condição determinística | Resultado |
|---|---|---|---|
| `atendimento` | `aceitar_opcao` | Proposta vigente de Consulta/Avaliação | Aceitar substituição; permanecer em `atendimento` |
| `atendimento` | `aceitar_opcao` | Nenhuma proposta vigente | Ignorar |
| `atendimento` | `aceitar_qualquer_profissional` | Pergunta de preferência vigente | Registrar critério; permanecer em `atendimento` |
| `atendimento` | `solicitar_nova_opcao` | Qualquer contexto atual | Ignorar |
| `atendimento` | `confirmar_resumo` | Qualquer contexto atual | Ignorar |
| `atendimento` | `desistir` | Ação de novo agendamento ativa | Encerrar ação; permanecer em `atendimento` |
| `aguardando_escolha` | `aceitar_opcao` | Resolve exatamente uma opção vigente | Ir para `coletando_cadastro` ou `aguardando_confirmacao` |
| `aguardando_escolha` | `aceitar_opcao` | Mais de uma opção possível | Esclarecer; permanecer no estado |
| `aguardando_escolha` | `solicitar_nova_opcao` | Opções vigentes | Recalcular/apresentar alternativa; permanecer no estado |
| `aguardando_escolha` | `aceitar_qualquer_profissional` | Isolado, sem pergunta de preferência vigente | Ignorar |
| `aguardando_escolha` | `aceitar_qualquer_profissional` + `solicitar_nova_opcao` | Sinal composto (seção 7) | Remover preferência de dentista; recalcular entre todos os aptos; permanecer no estado |
| `aguardando_escolha` | `confirmar_resumo` | Qualquer contexto | Ignorar |
| `aguardando_escolha` | `desistir` | Explícito e inequívoco | Ir para `atendimento` |
| `coletando_cadastro` | `desistir` | Explícito e inequívoco | Ir para `atendimento` |
| `coletando_cadastro` | Demais candidatos | Não aplicáveis | Ignorar |
| `aguardando_confirmacao` | `confirmar_resumo` | Todos os gates aprovados | Ir para `executando` |
| `aguardando_confirmacao` | `confirmar_resumo` | Resumo/escolha inválidos ou conflito | Ignorar ou esclarecer; nunca executar |
| `aguardando_confirmacao` | `desistir` | Explícito e inequívoco | Ir para `atendimento` |
| `aguardando_confirmacao` | Demais candidatos | Não aplicáveis | Ignorar |
| `executando` | Qualquer candidato | Operação crítica iniciada | Não iniciar nova transição |
| `concluido` | `confirmar_resumo` | Resultado anterior localizável | Permanecer e comunicar o resultado existente |
| `concluido` | Demais candidatos | Fora do fluxo concluído | Ignorar |

Alteração de procedimento, dentista, data, período ou horário pode determinar retorno ao
fluxo de disponibilidade independentemente da matriz de eventos.

## 9. Necessidades lógicas do estado

As estruturas desta seção expressam informação necessária para decisões determinísticas.
Não definem representação física nem persistência individual obrigatória.

### Identidade e versão

- conversa;
- clínica;
- telefone normalizado;
- estado conversacional;
- versão concorrente do estado.

### Ação e critérios

- ação corrente `novo_agendamento`;
- intenção;
- procedimento, dentista, data, período e horário informados;
- autorização para qualquer profissional;
- dados cadastrais acumulados e indicação dos obrigatórios faltantes.

### Resoluções oficiais

- procedimento oficial resolvido;
- dentista oficial resolvido ou critério de qualquer profissional;
- data resolvida no fuso da clínica;
- duração oficial da clínica para o procedimento — inteira, de 10 a 240 minutos,
  múltipla de 10, a mesma para todos os dentistas aptos (`duracao-v1.md`);
  configuração ausente ou inconsistente falha fechado, sem fallback;
- snapshot da duração aplicada, distinto da configuração vigente;
- demais critérios temporais calculados pelo Core.

Esses valores nunca vêm prontos da IA.

### Contexto pendente

O Core precisa distinguir internamente:

- nenhuma pendência;
- proposta de Consulta/Avaliação;
- preferência por profissional;
- escolha entre horários;
- confirmação de resumo.

Para a IA, esses contextos continuam reduzidos ao contrato `pendente` já aprovado.

### Opções apresentadas

Necessidade lógica equivalente a um conjunto vigente contendo:

- versão lógica;
- tipo da proposta;
- indicação de apresentação;
- opções oficiais e fatos necessários para resolvê-las de forma inequívoca.

`opcoes_apresentadas` é uma necessidade lógica. Esta especificação não define tabela,
coluna, chave, JSON ou nome físico para ela.

### Escolha

Necessidade lógica contendo:

- versão lógica da escolha;
- vínculo com o conjunto de opções vigente;
- procedimento e dentista oficiais;
- início, fim e duração.

`escolha` não é schema físico definido por esta especificação.

### Contexto do resumo

Necessidade lógica contendo:

- versão lógica do resumo;
- versão da escolha usada;
- indicação de que o resumo foi apresentado segundo
  `eventos-conversacionais-v1.md`.

`contexto_resumo` não é schema físico definido por esta especificação.

### Execução e conclusão

- identidade lógica de idempotência;
- execução em andamento, quando aplicável;
- referência ao resultado concluído;
- fatos finais autorizados para resposta.

A forma física de todo esse estado depende de especificação e aprovação próprias.

## 10. Regras de invalidação

### Correção cadastral

Mudança de nome, CPF, data de nascimento ou e-mail:

- preserva opções e escolha ainda válidas;
- invalida resumo e confirmação;
- exige novo resumo e nova confirmação.

### Alteração de procedimento

Invalida procedimento oficial resolvido, dentistas, duração, opções, escolha, resumo e
confirmação. Retorna à resolução de procedimento e disponibilidade.

### Alteração de dentista

Invalida dentista resolvido, opções, escolha, resumo e confirmação — porque a agenda
consultada passa a ser a de outro profissional. Preserva o procedimento que continuar
válido.

O **valor da duração permanece o mesmo** enquanto o procedimento não mudar: na v1 a
duração é a configuração da clínica para o procedimento, igual para todos os dentistas
aptos (`duracao-v1.md`). Mudança apenas superficial do texto de preferência, com a
identidade oficial do dentista permanecendo igual, não invalida nada.

### Alteração de data, período ou horário

Invalida resoluções temporais dependentes, opções, escolha, resumo e confirmação.
Preserva procedimento e preferência profissional que continuarem válidos.

### Nova apresentação de opções

Cria uma nova versão lógica e invalida lista anterior, escolha vinculada, resumo e
confirmação.

### Nova escolha

Cria uma nova versão lógica da escolha e invalida resumo e confirmação anteriores.

### Horário indisponível na revalidação

Invalida escolha, resumo e confirmação. Apresenta novas opções reais e retorna a
`aguardando_escolha`.

### Desistência

Desistência explícita encerra a ação corrente e retorna a `atendimento`.

O controlador deve:

- invalidar opções apresentadas, escolha, resumo e confirmação da ação encerrada;
- remover critérios operacionais exclusivos do novo agendamento encerrado;
- preservar dados cadastrais válidos já informados ou existentes no cadastro;
- preservar identidade da conversa, clínica e paciente;
- não interpretar desistência como cancelamento de agendamento existente.

A desistência faz parte do contrato do fluxo principal. Sua implementação não deve ser
antecipada como etapa isolada antes do restante do controlador conversacional v1; deve
ser implementada e testada na ordem normal do fluxo aprovado.

## 11. Conflitos e concorrência

### Conflito de valor

- alterações independentes podem ser persistidas;
- o campo conflitante permanece inalterado;
- evento dependente desse campo não é aceito;
- conflito que possa alterar fatos do resumo bloqueia `confirmar_resumo`;
- o Core solicita esclarecimento específico;
- conflitos permanecem temporários em memória.

### Conflito concorrente

Quando `atualizado_em` muda entre snapshot e persistência:

- toda a interpretação é invalidada;
- eventos candidatos não são avaliados;
- nenhuma transição é aplicada;
- não há releitura e reaplicação;
- o modelo não é chamado novamente;
- aplica-se falha segura.

### Persistência de transição

Uma futura persistência de mudança de estado não pode depender de leitura seguida de
escrita sem proteção concorrente. O mecanismo físico e a fronteira transacional ainda
dependem de decisão específica.

Esta especificação não torna `DecisaoControlador` persistência obrigatória, não cria RPC
e não escolhe entre ampliar operação existente ou introduzir outra operação.

### Queda depois da interpretação

Se o worker cair depois de `interpretacao_persistida_em` ser preenchido e antes da
decisão do controlador:

- não chamar novamente a IA;
- não reconstruir candidatos ou conflitos;
- não executar confirmação;
- seguir o caminho seguro de resposta fixa já aprovado;
- aguardar nova mensagem do paciente para continuar.

### Transporte

Produção e envio de resposta não são transacionais com o banco. Os gates de claim
reduzem, mas não eliminam, a corrida após a consulta. O risco residual de resumo
registrado como apresentado sem prova de entrega permanece o definido em
`eventos-conversacionais-v1.md`.

## 12. Dependências — estado atual

### Já fechadas por especificações canônicas

| Dependência | Fechada em |
|---|---|
| Catálogo oficial, resolução de `procedimento_texto` sem expor catálogo à IA, ambiguidade, procedimentos inativos, identificação de Consulta/Avaliação | `procedimentos-v1.md` |
| Vínculos dentista-procedimento, validade de profissional e preferência, representação de qualquer profissional | `dentistas-vinculos-v1.md` |
| Duração oficial da clínica para o procedimento, snapshot aplicado, invalidação, revalidação, falha fechada | `duracao-v1.md` |
| Geração e granularidade dos slots, ausência de horizonte artificial, jornada/bloqueios/agendamentos, passagem ao próximo dentista, períodos alternativos | `disponibilidade.md` |
| Validade e versão lógica das opções, revalidação e coordenação com a criação, forma persistente mínima do estado, proteção concorrente das transições | `persistencia-v1.md` |
| Redação das respostas ao paciente | `atendimento-v1.md` |

`disponibilidade.md` **não é mais placeholder** — é especificação canônica vigente. A
condição que antes bloqueava o controlador está satisfeita.

### Ainda abertas

- especificação de transporte/Edge Function: entrada autenticada, janela máxima,
  quantidade máxima de mensagens por turno, limites de payload, envio idempotente ou
  outbox, política de resposta (o debounce de 3 segundos **já está decidido** —
  `novo-agendamento.md` §17);
- configuração oficial da clínica: fuso IANA e exigência de e-mail
  (`persistencia-v1.md` §25);
- identidades de usuário do painel e dos apps para autoria de status
  (`persistencia-v1.md` §25);
- schema físico de todas as entidades;
- auditoria do legado, incluindo a fórmula antiga de horários
  (`disponibilidade.md` §19) — nenhum componente presumido reutilizável.

Nenhuma dessas pendências bloqueia a implementação dos serviços de domínio
determinísticos; elas condicionam a integração final e a operação com tráfego real.

## 13. Ordem recomendada de implementação futura

Depois da aprovação das dependências documentais:

1. consolidar as especificações de procedimentos, dentistas, duração e disponibilidade;
2. definir a forma persistente mínima do estado e a proteção concorrente das transições;
3. consolidar `atendimento-v1.md`;
4. escrever os cenários obrigatórios derivados das specs aprovadas;
5. implementar tipos puros de entrada e saída;
6. implementar validação e invalidação como funções puras;
7. implementar a matriz determinística de eventos;
8. implementar o cálculo de próximo passo com adaptadores falsos;
9. integrar persistência oficial;
10. integrar procedimentos, dentistas e duração;
11. integrar disponibilidade;
12. integrar escolha, cadastro, resumo e confirmação de alto risco;
13. implementar desistência dentro do fluxo principal, não como frente isolada
    antecipada;
14. integrar revalidação e criação idempotente;
15. integrar transporte;
16. executar testes unitários, de integração, concorrência e ponta a ponta.

## 14. Invariantes

- Supabase/Postgres é a fonte oficial entre mensagens e workers.
- Objetos temporários do controlador não se tornam persistentes por implicação.
- `DecisaoControlador` não é persistência obrigatória.
- Estruturas lógicas não definem schema físico.
- A IA produz candidatos, nunca decisões.
- Somente o Core decide transições e ações.
- Confirmação candidata nunca autoriza criação diretamente.
- Alterações são consideradas antes dos eventos candidatos.
- Dependências inválidas nunca são reutilizadas.
- Dados cadastrais válidos são preservados após desistência.
- Desistência não é priorizada como implementação isolada.
- A IA não acessa banco, agenda, credenciais ou ferramentas.
- Não existe fallback por texto livre nem confidence score.
- Esta especificação não cria código, tabela, coluna, RPC ou migration.
