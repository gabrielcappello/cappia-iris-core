# Cadastro conversacional v1

**Status:** especificação canônica aprovada pelo Gabriel em 2026-08-10, fechada antes da
implementação. Define o contrato de **coleta conversacional dos dados cadastrais** e o
encadeamento até a reserva.

Complementa `novo-agendamento.md` (seções 12 e 23, regras de obrigatoriedade e formato),
`persistencia-v1.md` (contrato do paciente, seção 5, e o bloco de revisão da seção 8),
`interpretacao-ia.md` ("Entrada e PII"), `resposta-conversacional-v1.md` e
`controlador-conversacional-v1.md`.

Base já construída e em produção, que esta spec **consome sem alterar**:

- `cappia_persistir_paciente` (aplicada nos dois bancos em 2026-08-09/10) e seu adaptador
  `persistir-paciente.ts`;
- a leitura cadastral em `identificacao.ts` (`documento` → `cpf`);
- a visão efetiva em memória (`cadastro-paciente.ts`).

## Princípio

**A interpretadora entende o valor. O Core confere e executa.**

A IA extrai nome, CPF, data de nascimento e e-mail do jeito que o paciente escreveu. O
Core valida deterministicamente, decide o que falta e o que persistir. Não existe parser
linguístico paralelo no Core, e não existe validação de conteúdo dentro da IA.

## 1. Ordem no fluxo

Confirmada em 2026-08-10, igual ao comportamento de hoje até o ponto do cadastro:

1. procedimento, dentista, data e horário definidos;
2. a Iris propõe e o paciente **confirma** a proposta (`confirmacao === 'sim'`);
3. **se o cadastro estiver incompleto, coletar os campos faltantes** (pode levar mais de
   um turno);
4. persistir o paciente e obter `paciente_id`;
5. **continuar, no mesmo processamento, para a reserva já existente.**

O cadastro continua **depois** da confirmação do horário — nunca antes. Isso preserva a
regra de `novo-agendamento.md` seção 12: só se pede cadastro quando já existe horário
escolhido.

## 2. Dados faltantes

Calculados deterministicamente a partir da **visão efetiva** (`cadastro-paciente.ts`):
a ficha persistida em `pacientes` sobreposta pelo que o paciente informou nesta conversa.

Obrigatórios Brasil V1: `nome`, `cpf`, `data_nascimento`.
`email` é obrigatório **somente** quando `clinicas.automatizacoes.solicitar_email = true`.

```ts
function calcularCadastroFaltante(
  visaoEfetiva: CadastroPaciente,
  exigirEmail: boolean
): CampoCadastralInterpretacao[]
```

Ordem canônica de saída: `nome`, `cpf`, `data_nascimento`, `email`.

Consequências diretas, sem regra adicional:

- **paciente existente completo** → lista vazia → o cadastro **não interrompe** o
  agendamento;
- **paciente existente incompleto** → só os campos ausentes são pedidos;
- **paciente novo** → só os campos ausentes são pedidos.

Campo já conhecido **nunca** é pedido de novo, venha ele da ficha ou da conversa.

### `solicitar_email`

Lido de `clinicas.automatizacoes.solicitar_email`, a mesma chave que o pipeline legado já
usa. **Não** vira coluna nova. É somado ao `SELECT` que `carregar-catalogo.ts` já faz em
`clinicas` — nenhuma consulta nova. Ausente, malformada ou não-booleana ⇒ `false`
(e-mail não exigido): a configuração precisa ser afirmativa para criar obrigação.

## 3. Extração pela interpretadora

Os quatro campos **já são estruturalmente emitíveis** — tanto o schema interno
(`interpretacao-instrucoes.ts`) quanto o portátil (`cliente-modelo-openai.ts`) derivam de
`CAMPOS_EMITIVEIS_PELA_IA`, que os inclui desde sempre. **Nenhuma mudança de schema é
necessária.** O que falta é instrução: hoje não há uma linha sequer sobre eles.

A instrução autoriza a extração natural e nada além disso:

- extrair `nome`, `cpf`, `data_nascimento` e `email` quando o paciente os fornecer;
- `data_nascimento` deve sair já em `YYYY-MM-DD`. A IA faz essa conversão porque entende
  a data que a pessoa escreveu ("10/05/1985", "10 de maio de 1985") — é justamente o que
  evita um parser de data no Core;
- `cpf` sai preferencialmente só com dígitos; pontuação é tolerada e removida pelo Core;
- a IA **não** julga validade: não confere dígito verificador, não recusa data
  implausível, não valida e-mail. Extrair e validar são responsabilidades separadas.

## 4. Validação determinística (Core)

Roda **depois** da extração, como etapa pura do pipeline de `interpretarEAplicar`, no
mesmo padrão de `aplicarAceitacaoDeOferta` e `aplicarCandidatoUnicoDeDentista`: uma função
que transforma `alteracoes` antes de `preAplicar`. Nunca lança — um CPF malformado não
pode derrubar a mensagem inteira.

| campo | regra |
|---|---|
| `nome` | normalizar espaços; mínimo de 2 letras; rejeitar apenas números/símbolos. **Sobrenome não é exigido.** |
| `cpf` | normalizar para 11 dígitos; validar dígitos verificadores; rejeitar sequência de dígitos repetidos |
| `data_nascimento` | `YYYY-MM-DD`; data real de calendário; não futura |
| `email` | somente a validação estrutural já prevista em `novo-agendamento.md` seção 23; nunca verificação de existência |

**Valor inválido não entra em `dados`.** O campo simplesmente continua faltando e volta a
ser pedido no turno seguinte. Não existe estado persistido de "inválido", não existe
contador de tentativas, não existe mensagem de erro dedicada — a Iris apenas pede de novo.

Isso mantém uma regra só em todo o sistema: **faltante = ausente**.

O valor persistido é o **normalizado** (CPF só com dígitos, nome com espaços colapsados) —
o Core grava o que conferiu, não o texto cru.

## 5. Contexto do horário durante a coleta

`cadastro_necessario` passa de `limpar` para **`preservar`** em `contexto-horarios.ts`.

Motivo: a coleta leva mais de um turno. Limpando o contexto, a proposta que o paciente
**já confirmou** desaparece, e a cada turno o slot teria de ser re-derivado e a
disponibilidade re-consultada.

Explicitamente **não** decorre disso:

- nenhuma reserva antecipada;
- nenhum bloqueio artificial do horário;
- nenhuma garantia de que o horário continuará livre.

A reserva existente permanece a **autoridade final** e detecta o conflito normalmente se o
horário tiver sido tomado durante a coleta (`horario_ocupado` → `reserva_conflito`, sem
tratamento novo).

## 6. Persistência encadeada com a reserva

**Não existe decisão `cadastro_concluido`.** Quando o cadastro fica completo não há
nenhuma decisão humana pendente — parar ali para esperar outra mensagem seria inventar um
turno que a conversa não pede.

Depois que `persistirPaciente` devolve `paciente_id` com sucesso, o orquestrador
**continua no mesmo processamento** pelo caminho de reserva já existente. A lógica de
reserva não é reescrita nem duplicada: só passa a receber o `paciente_id` recém-obtido em
vez do que veio da identificação.

Quando chamar `persistirPaciente`:

- `paciente_id` é nulo (paciente novo); **ou**
- a visão efetiva difere da ficha persistida (a conversa completou ou corrigiu algo).

Caso contrário — paciente existente, completo e sem nada novo — o `paciente_id` da
identificação segue direto para a reserva, sem escrita nenhuma.

`p_nome` é sempre enviado, como o contrato da RPC exige: neste ponto a visão efetiva
sempre tem nome, porque o fluxo só chega aqui com os obrigatórios completos.

Dois efeitos registrados, ambos aceitos:

- `estado_conversa.paciente_id` continua nulo até a identificação do turno seguinte
  vinculá-lo. Nada no turno atual depende dele — a reserva usa o `paciente_id` devolvido
  pela RPC.
- Se a reserva falhar depois de o paciente ter sido persistido, o paciente permanece
  cadastrado sem agendamento. Isso **não é falha**: é o estado normal previsto no bloco de
  revisão de `persistencia-v1.md` seção 8, e a próxima tentativa reaproveita o mesmo
  paciente por `(clinica_id, telefone_normalizado)`.

## 7. CPF já cadastrado

Quando `persistirPaciente` devolve `cpf_ja_cadastrado`:

- **não** criar outro paciente;
- **não** atualizar o telefone automaticamente;
- **não** investigar de quem é o CPF;
- parar com um desfecho simples e próprio, para tratamento humano.

Toda a lógica de transferência de telefone entre pacientes (`persistencia-v1.md` seções 6
e 7) permanece **fora de escopo**. Esta spec só garante que o caso é reconhecido, tipado e
não produz duplicata nem escrita silenciosa.

## 8. Resposta ao paciente

`dados_faltantes` passa a ser **itemizado**. `CampoFaltante` perde o valor monolítico
`'cadastro'`:

```ts
type CampoFaltante =
  | 'procedimento' | 'data' | 'horario'
  | 'nome' | 'cpf' | 'data_nascimento' | 'email';
```

O Core autoriza **quais** campos faltam. A redatora formula a solicitação naturalmente, no
tom recíproco de sempre (`resposta-conversacional-v1.md`). **Não** existe sequência rígida
de textos, não existe uma pergunta fixa por campo, e o Core não decide a ordem em que a
Iris pergunta — só o conjunto do que ainda falta.

O fallback determinístico (`gerar-resposta-paciente.ts`) deixa de pedir sempre "seu nome
completo" e passa a refletir os campos realmente faltantes.

## 9. Decisões do orquestrador

| decisão | quando | objetivo da redatora |
|---|---|---|
| `cadastro_necessario` (ganha `campos_faltantes`) | confirmado, mas faltam obrigatórios — **inclusive para paciente existente incompleto** | `pedir_cadastro`, com `dados_faltantes` itemizado |
| `cpf_ja_cadastrado` | a RPC recusou por CPF já usado na clínica | objetivo próprio, desfecho simples |

`cpf_ja_cadastrado` é o **único** desfecho conversacional específico da persistência nesta
etapa.

### Motivos estruturais da RPC não são decisão conversacional

`clinica_id_ausente`, `telefone_normalizado_ausente` e `nome_ausente` são **invariantes do
Core**: se o fluxo estiver correto, são inalcançáveis — o Core só chega à persistência com
clínica identificada, telefone normalizado validado e cadastro completo.

Se mesmo assim ocorrerem, significa bug interno, não situação do paciente. Nesse caso:

- **nunca** seguir para a reserva;
- falhar fechado pelo mecanismo técnico **já existente**;
- **não** criar estado ou decisão conversacional só para representar bug interno.

Inventar uma decisão para isso daria a um defeito do Core a aparência de um desfecho
normal de conversa, e ainda acrescentaria um estado que nunca deveria ser alcançado.

## 10. Fora de escopo

Reescrita da reserva; atualização de telefone por CPF; transferência de paciente entre
telefones; temporal; resumo final; cancelamento; remarcação; anamnese; grants de `anon`;
CHECK de telefone; `MANIFESTO.md`.

## 11. Testes mínimos

**Determinísticos** — validação (CPF válido/inválido/sequência repetida; data real,
futura, malformada; nome só com números; e-mail estrutural), cálculo de faltantes nos três
cenários (novo, existente incompleto, existente completo), `exigirEmail` ligado e
desligado, valor inválido não entrando em `dados`, encadeamento persistência → reserva no
mesmo processamento, `cpf_ja_cadastrado` sem duplicata e sem escrita, e `preservar` do
contexto durante a coleta.

**Conversacionais (IA real)** — poucos e plausíveis, na disciplina de
`docs/00-principios.md`: frases que uma pessoa realmente escreveria. `"Gabriel Cappello"`,
`"10/05/1985"`, um CPF **sintético válido** no caminho feliz, paciente existente a quem só
falta o nascimento, e paciente existente completo (que não deve ser interrompido).

CPF inválido (`"123.456.789-00"`, dígitos verificadores incorretos) aparece **somente** no
teste de rejeição — nunca como caso de sucesso.
