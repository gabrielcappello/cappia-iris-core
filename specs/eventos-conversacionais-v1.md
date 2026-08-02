# Contrato de Eventos Conversacionais v1

**Status:** especificação canônica aprovada para o primeiro fluxo de novo agendamento.
Este documento define contrato e comportamento; não autoriza implementação, alteração de
banco ou criação de tabelas.

Esta especificação complementa `interpretacao-ia.md` e `novo-agendamento.md`. Em caso de
dúvida, permanecem fixas as decisões de `../docs/02-arquitetura.md`: a IA interpreta a
mensagem atual; o Core determinístico decide estado, validade e ação; Supabase/Postgres é
a fonte oficial do estado.

## 1. Separação obrigatória: candidato e decisão

O sinal retornado pela IA é sempre um **evento candidato**. Ele não é um evento aceito,
uma transição nem uma autorização.

```ts
type TipoEventoCandidatoIA =
  | 'aceitar_opcao'
  | 'solicitar_nova_opcao'
  | 'desistir'
  | 'aceitar_qualquer_profissional'
  | 'confirmar_resumo';

type EventoCandidatoIA =
  | {
      tipo: 'aceitar_opcao';
      referencia_textual: string | null;
    }
  | {
      tipo:
        | 'solicitar_nova_opcao'
        | 'desistir'
        | 'aceitar_qualquer_profissional'
        | 'confirmar_resumo';
    };
```

O resultado da validação determinística é outro tipo, interno ao Core:

```ts
type MotivoDecisaoControlador =
  | 'estado_incompativel'
  | 'contexto_pendente_ausente'
  | 'referencia_ambigua'
  | 'evento_ambiguo'
  | 'eventos_incompativeis'
  | 'contexto_invalidado'
  | 'resumo_nao_vigente'
  | 'escolha_nao_vigente'
  | 'confirmacao_insuficiente';

type DecisaoControlador =
  | {
      resultado: 'ignorar';
      candidato: EventoCandidatoIA;
      motivo: MotivoDecisaoControlador;
    }
  | {
      resultado: 'solicitar_esclarecimento';
      candidatos: EventoCandidatoIA[];
      motivo: MotivoDecisaoControlador;
    }
  | {
      resultado: 'aplicar_evento_baixo_risco';
      evento:
        | 'aceitar_opcao'
        | 'solicitar_nova_opcao'
        | 'desistir'
        | 'aceitar_qualquer_profissional';
      proximo_estado: EstadoConversa;
    }
  | {
      resultado: 'autorizar_confirmacao_resumo';
      evento: 'confirmar_resumo';
      resumo_versao: string;
      escolha_versao: string;
      proximo_estado: 'executando';
    };
```

`EventoCandidatoIA` pertence ao limite de saída do modelo. `DecisaoControlador` nunca é
produzida pela IA, nunca é aceita de entrada externa e só pode ser construída pelo Core
depois de consultar o estado oficial.

Em particular, `confirmar_resumo` retornado pela IA significa somente “a mensagem atual
parece conter uma confirmação”. Somente a variante
`autorizar_confirmacao_resumo` de `DecisaoControlador`, produzida depois de todos os
gates determinísticos, pode autorizar a transição para `executando`.

## 2. Catálogo canônico

### `aceitar_opcao`

Sinaliza possível aceitação de uma opção ou proposta explicitamente apresentada pelo
Core. Abrange:

- escolha de um horário oferecido;
- aceitação da proposta de substituir o procedimento por Consulta/Avaliação.

Consulta/Avaliação não possui evento próprio. O Core reutiliza `aceitar_opcao` e valida
que o contexto pendente oficial é a proposta de substituição. Isso evita um evento
redundante.

`referencia_textual` preserva somente a referência presente na mensagem atual, como
`"14h"` ou `"a segunda opção"`. Quando a aceitação for deítica, como `"pode ser"`, o
valor é `null`. A IA nunca resolve essa referência para ID, índice oficial ou registro.

### `solicitar_nova_opcao`

Sinaliza possível rejeição das opções apresentadas ou pedido por alternativa.
`rejeitar_opcao` não existe como evento separado, pois produziria o mesmo resultado
operacional e seria redundante.

### `desistir`

Sinaliza desistência explícita da ação corrente de novo agendamento. Não significa
cancelar um agendamento já existente. A limpeza exata dos dados da ação encerrada será
definida na especificação do controlador; não é definida por inferência aqui.

### `aceitar_qualquer_profissional`

Sinaliza que o paciente aceita busca com qualquer dentista apto. Não escolhe dentista,
não ordena profissionais e não autoriza consulta de agenda por si só. O Core mantém as
regras canônicas de vínculo, duração, disponibilidade e desempate.

### `confirmar_resumo`

Sinaliza possível confirmação explícita do resumo vigente. Não significa criar
agendamento, executar ação ou alterar estado.

## 3. Classificação de risco

Eventos candidatos de baixo risco conversacional:

- `aceitar_opcao`;
- `solicitar_nova_opcao`;
- `desistir`;
- `aceitar_qualquer_profissional`.

Mesmo em baixo risco, o Core exige compatibilidade com o estado, contexto pendente
oficial e resolução inequívoca. Nenhum desses eventos autoriza efeito externo.

Evento candidato de alto risco:

- `confirmar_resumo`.

Sua validação exige todos os gates da seção 5. A classificação de alto risco não é
delegada à IA e não pode ser reduzida por prompt, score ou redação da mensagem.

## 4. Contrato de interpretação

### Entrada

```ts
type ContextoPendenteIA = 'nenhum' | 'opcao' | 'confirmacao_resumo';

interface EntradaInterpretacaoModeloV1 {
  mensagens_atuais: string[];

  dados_atuais: Partial<Record<
    | 'intencao'
    | 'procedimento_texto'
    | 'dentista_texto'
    | 'data_texto'
    | 'periodo'
    | 'horario_texto',
    string
  >>;

  campos_cadastrais_preenchidos: Array<
    'nome' | 'cpf' | 'data_nascimento' | 'email'
  >;

  pendente: ContextoPendenteIA;
}
```

`pendente`:

- é calculado exclusivamente pelo Core a partir do estado oficial;
- não é fornecido pelo paciente;
- não representa nem expõe o estado interno completo;
- não autoriza evento ou transição;
- serve somente para orientar a interpretação de expressões deíticas, como `"sim"`,
  `"pode ser"` ou `"outro"`;
- não contém IDs, versões, opções, datas, disponibilidade ou fatos do resumo.

Significados:

- `nenhum`: não há opção ou confirmação aguardando interpretação;
- `opcao`: existe uma opção ou proposta conversacional pendente;
- `confirmacao_resumo`: existe um resumo vigente aguardando possível confirmação.

Não entram no payload: estado completo, `clinica_id`, telefone, IDs, versões, catálogo
de procedimentos, agenda, disponibilidade, credenciais, registros clínicos ou histórico
textual anterior.

### Saída

```ts
interface SaidaInterpretacaoModeloV1 {
  alteracoes: AlteracoesDados;
  eventos_candidatos: EventoCandidatoIA[];
}
```

Regras estruturais:

- a raiz contém exatamente `alteracoes` e `eventos_candidatos`;
- os dois campos são obrigatórios e podem estar vazios;
- `json_schema` com `strict = true` permanece obrigatório;
- `additionalProperties: false` vale em todos os níveis;
- tipos desconhecidos ou eventos repetidos são inválidos;
- `referencia_textual` existe somente em `aceitar_opcao`;
- não existe `confidence`, justificativa, explicação, resposta ao paciente, estado
  seguinte, decisão do Core ou comando de execução;
- eventos candidatos nunca contêm IDs ou versões.

## 5. Contrato de alto risco: `confirmar_resumo`

### Significado canônico de resumo apresentado

Nesta primeira versão, um resumo é considerado **apresentado** quando, no estado oficial,
o Core:

1. gerou o resumo determinístico a partir da escolha e dos dados vigentes; e
2. registrou o contexto desse resumo e a transição para `aguardando_confirmacao`.

Não é exigido recibo adicional de entrega, leitura ou visualização do transporte. A
definição é deliberadamente técnica e não afirma que o paciente recebeu ou leu a
mensagem.

**Risco residual aceito nesta versão:** uma falha ou corrida no transporte pode fazer o
estado oficial registrar o resumo como apresentado sem prova de entrega efetiva ao
paciente. Uma mensagem posterior aparentemente afirmativa ainda passará pelos demais
gates, mas não existe garantia absoluta de que ela respondeu ao resumo. Eliminar esse
risco exigirá futuramente confirmação de entrega correlacionada, transporte idempotente
ou outbox transacional; nenhum desses mecanismos é criado por esta especificação.

### Vínculo obrigatório

O Core deve possuir contexto oficial equivalente a:

```ts
interface ContextoResumoVigente {
  resumo_versao: string;
  escolha_versao: string;
  apresentado: true;
}
```

Os nomes físicos e a forma de persistência serão definidos na especificação do
controlador. As versões são internas, não vêm da IA e não são enviadas ao modelo.

Para produzir `autorizar_confirmacao_resumo`, o Core deve validar simultaneamente:

1. estado oficial exatamente `aguardando_confirmacao`;
2. resumo vigente registrado como apresentado segundo a definição acima;
3. escolha vigente;
4. versão da escolha igual à usada para gerar o resumo;
5. cadastro obrigatório completo e válido;
6. ausência de alteração posterior invalidante;
7. candidato explícito, inequívoco e compatível com `pendente = confirmacao_resumo`;
8. mesma conversa isolada por clínica e telefone;
9. snapshot oficial ainda vigente;
10. ausência de conflito entre eventos candidatos ou alterações da mensagem atual.

Somente então o Core decide `aguardando_confirmacao -> executando`. Depois disso, ainda
é obrigatória a revalidação técnica do horário antes da criação idempotente.

### Invalidação

Correção posterior de nome, CPF, data de nascimento ou e-mail:

- preserva a escolha;
- invalida resumo e confirmação anteriores;
- exige novo resumo e nova confirmação.

Alteração posterior de procedimento, dentista, data, período ou horário:

- invalida escolha, resumo e confirmação anteriores;
- retorna ao fluxo de disponibilidade;
- exige nova opção, nova escolha, novo resumo e nova confirmação.

Uma mensagem que simultaneamente sinalize confirmação e altere dado invalidante nunca
autoriza execução. O Core processa a alteração, invalida o contexto anterior e recusa o
candidato `confirmar_resumo`.

## 6. Matriz evento candidato x estado

| Candidato | Estados em que pode ser válido | Estados em que é ignorado | Decisão/transição possível |
|---|---|---|---|
| `aceitar_opcao` | `atendimento`, somente para proposta vigente de Consulta/Avaliação; `aguardando_escolha`, para uma opção vigente inequívoca | `coletando_cadastro`, `aguardando_confirmacao`, `executando`, `concluido` | Em `atendimento`, aceita a substituição e permanece no fluxo; em `aguardando_escolha`, vai para `coletando_cadastro` ou `aguardando_confirmacao` |
| `solicitar_nova_opcao` | `aguardando_escolha`, com opções vigentes | `atendimento`, `coletando_cadastro`, `aguardando_confirmacao`, `executando`, `concluido` | Permanece em `aguardando_escolha` após o Core recalcular/apresentar opção válida |
| `desistir` | `atendimento` com ação corrente, `aguardando_escolha`, `coletando_cadastro`, `aguardando_confirmacao` | `executando`, `concluido` | Encerra a ação e retorna a `atendimento`; não interrompe operação crítica já iniciada |
| `aceitar_qualquer_profissional` | `atendimento`, somente com pergunta de preferência pendente | `aguardando_escolha`, `coletando_cadastro`, `aguardando_confirmacao`, `executando`, `concluido` | Registra a preferência conversacional e permanece em `atendimento` até o Core poder consultar disponibilidade |
| `confirmar_resumo` | Somente `aguardando_confirmacao`, após todos os gates | `atendimento`, `aguardando_escolha`, `coletando_cadastro`, `executando`, `concluido` | `autorizar_confirmacao_resumo` e transição para `executando` |

Em `concluido`, nova confirmação não cria outro agendamento. O Core localiza o resultado
já concluído e responde com o agendamento existente, conforme `novo-agendamento.md`.

### Nota harmonizadora: `solicitar_nova_opcao` + `aceitar_qualquer_profissional`

Cada candidato isolado mantém o significado desta tabela — em particular,
`aceitar_qualquer_profissional` isolado em `aguardando_escolha` continua ignorado, por
não haver ali pergunta de preferência vigente.

A combinação **simultânea** dos dois na mesma mensagem é interpretada pelo controlador
como um **sinal composto**, não como dois eventos avaliados isoladamente. Essa
compatibilidade — e a regra completa que ela produz — pertence ao contrato do
controlador, definida em `controlador-conversacional-v1.md` §7: opções e escolha vigentes
são invalidadas; a preferência específica por dentista é removida; procedimento e
duração permanecem quando ainda válidos; a nova disponibilidade considera todos os
dentistas ativos aptos, processados um por vez, sem misturar horários de profissionais
diferentes e sem escolher nenhum definitivamente. Nenhum evento ou estado novo é criado
por essa combinação.

A execução determinística dessa regra dentro da ordem completa do fluxo — incluindo
onde ela se encaixa entre os quatro componentes de domínio e a matriz de invalidação —
está descrita em `composicao-novo-agendamento-v1.md` §13.2 ("Sinal composto"), com
cenário de aceite próprio COMP-19 (§22 daquele documento), além do cenário canônico
já existente CTR-11 (`tests/cenarios-obrigatorios.md`). Nenhum contrato novo é criado
ali; a composição apenas orquestra o que esta seção já define.

## 7. Ambiguidade e incompatibilidade

- Em dúvida real, a IA omite o candidato; nunca adivinha.
- `eventos_candidatos: []` é saída válida e não autoriza inferência livre pelo Core.
- Referência que possa corresponder a mais de uma opção produz
  `solicitar_esclarecimento`; nenhuma escolha é registrada.
- Candidato incompatível com o estado é ignorado e não é convertido em outro evento.
- Candidato ignorado não é reaproveitado em mensagem futura.
- Candidatos logicamente incompatíveis na mesma mensagem nunca autorizam ação de alto
  risco; o Core solicita esclarecimento.
- `confirmar_resumo` combinado com alteração invalidante é recusado, mesmo que o texto
  de confirmação seja explícito.
- Conflito de valor segue a regra por campo de `interpretacao-ia.md`; conflito
  concorrente invalida toda a aplicação.
- Saída estrutural inválida segue a resposta fixa de falha; não existe aplicação
  parcial, fallback silencioso ou interpretação por texto livre.

## 8. Separação das máquinas de estado

Os eventos candidatos pertencem à interpretação da mensagem. Eles não alteram
diretamente o estado técnico de processamento (`recebida`, `processando`, `concluida`,
`falhou`).

As decisões do Core operam sobre o estado oficial da conversa (`atendimento`,
`aguardando_escolha`, `coletando_cadastro`, `aguardando_confirmacao`, `executando`,
`concluido`) somente depois da persistência da interpretação sujeita a claim, lease,
marcador e CAS.

O Core usa apenas o estado oficial retornado pela operação transacional. A IA não
recebe nem controla claim, lease, `interpretacao_persistida_em` ou `atualizado_em`.

## 9. Invariantes

- Evento candidato da IA nunca é decisão aceita.
- `DecisaoControlador` nunca é produzido ou preenchido pela IA.
- `confirmar_resumo` da IA nunca representa autorização de criação.
- Somente o Core decide transição e ação.
- Não existe confidence score.
- A IA não recebe catálogo de procedimentos, IDs, versões ou estado interno completo.
- A IA não acessa banco, agenda, credenciais ou ferramentas.
- Supabase/Postgres permanece fonte oficial.
- Toda escolha é resolvida contra opção oficial vigente.
- Toda confirmação válida é vinculada ao resumo e à escolha vigentes.
- Alteração posterior invalida o vínculo aplicável.
- Nenhum evento ignorado é reaproveitado.
- Nenhum evento autoriza efeito externo sem validação determinística.
- Esta especificação não define nem autoriza novas tabelas, colunas ou código.
