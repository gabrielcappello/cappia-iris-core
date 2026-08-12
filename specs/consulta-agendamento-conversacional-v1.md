# Consulta do próprio agendamento — spec mínima v1

**Status:** **implementada e publicada em 2026-08-12** — commit `4843bc1`,
Edge `iris-nova-mensagem` v20 `ACTIVE` no operacional `udizowyfjnhuhgxkeayk`,
suíte 1171/1171, paridade Core/Edge confirmada. Nenhuma migration, RPC,
coluna ou tabela — exatamente como planejado (seção 8).

Escopo: o paciente identificado poder perguntar naturalmente sobre o próprio
agendamento futuro ("quando é minha consulta?", "tenho horário marcado?",
"com qual dentista estou?") e receber a resposta com os dados oficiais.

Fora de escopo: histórico, agendamentos passados ou cancelados; nome do
paciente na resposta (PII, seção 7); qualquer ação sobre o agendamento
(remarcar/cancelar têm specs próprias, já publicadas).

## Aderência a `docs/00-principios.md`

- **Responsabilidade correta.** A IA não ganha nenhuma classificação nova. O
  Core não interpreta linguagem. O agendamento vira **fato disponível para a
  conversa**, e a redatora — que já é quem decide o que é relevante dizer —
  usa ou não.
- **Remoção.** Nenhuma intenção, campo raiz, evento, parser, estado, tabela,
  RPC ou migration. **Nenhuma regra de prompt** (medida e descartada, seção 4).
  Reaproveita integralmente `buscarAgendamentoAtivo` e o canal de fato do
  turno que `substituicao_por_avaliacao` já usa.
- **Teste isolado.** Pares A/B na seção 8.
- **Testes realistas.** Todas as frases das seções 3 e 4 vêm das medições
  contra a IA real, nunca inventadas para forçar comportamento.

## 1. O canal: fato do turno, não intenção

O precedente é `substituicao_por_avaliacao`, em produção desde 2026-08-09.
`orquestrador-tipos.ts` já o descreve exatamente como o que precisamos:

> "Não é estado, não é decisão: é um fato deste turno, repassado a
> `derivarFatosAutorizados` junto com a decisão."

O caminho já existe inteiro:

```
ResultadoOrquestrador.<fato>?          (orquestrador)
  → index.ts repassa
  → gerarRespostaConversacional(entrada.<fato>)
  → derivarFatosAutorizados(decisao, <fato>)
  → anexado FORA do switch, sobre qualquer decisão
```

`agendamentos_do_paciente` entra por esse mesmo caminho. **O `objetivo` nunca
muda** — continua `cumprimentar_e_oferecer_ajuda` / `acolher_e_retomar`. O
Core não manda falar do agendamento; apenas o disponibiliza.

## 2. Quando buscar

**Somente** quando as duas condições valerem:

1. a decisão do turno é **conversacional** — `saudacao`, `duvida_livre` ou
   `mensagem_nao_compreendida`; **e**
2. `identificacao.paciente.id !== null`.

Ponto de inserção único, em `processarMensagem`, no early-return que já existe:

```ts
if (Object.keys(interpretacao.alteracoes_interpretadas).length === 0) {
  const decisaoConversacional = decidirPorNatureza(...);
  if (decisaoConversacional !== null) {
    // aqui, e só aqui: já se sabe que a decisão é conversacional
    return await finalizar(decisaoConversacional);
  }
}
```

Isso resolve dois problemas de uma vez:

- **zero consulta extra** nos turnos operacionais — novo agendamento,
  remarcação e cancelamento já fazem as próprias buscas, com exigência de
  frescor própria (spec de remarcação §3: "busca SEMPRE fresca");
- **zero risco de lista obsoleta** — em `reserva_criada` os fatos teriam o
  agendamento novo *e* uma lista lida antes dele; a redatora poderia misturar
  os dois.

**Os fluxos operacionais nunca recebem este fato.** Decisão explícita do
Gabriel, 2026-08-12.

## 3. Comportamento por quantidade

| resultado de `buscarAgendamentoAtivo` | fato |
|---|---|
| `nenhum` | **campo ausente**, nunca `[]` — disciplina "ausente, nunca vazio" já canônica no Core. A Iris se comporta exatamente como hoje. |
| `unico` | um item |
| `multiplos` | **todos**, na ordem que a busca já devolve (data, depois minuto). **Sem pergunta de escolha** — consultar é leitura, não há o que desambiguar. |

Paciente sem ficha (`paciente_id` nulo): campo ausente, sem consulta ao banco.

## 4. O que foi medido e descartado — quatro rotas

Esta spec só chegou ao desenho acima depois de **quatro rotas medidas contra a
IA real e reprovadas**. O registro existe para que nenhuma delas seja
retomada por suposição.

### 4.1 `intencao` própria — três variantes, todas reprovadas

| variante | resultado |
|---|---|
| `consulta_agendamento` no vocabulário, sem regra | **0/20** |
| `consulta_agendamento` + 1 linha semântica | **1/20** |
| `meus_agendamentos` (nome ancorado), sem regra | **3/20** |

Todas com `natureza=duvida` e `alteracoes` vazio, em ~100 chamadas. Os
controles ("preço", "convênio", "endereço", "funcionamento") ficaram em 0
falsos positivos nas três — mas isso **não é discriminação**: o modelo
simplesmente não emitiu para ninguém.

**Causa.** As três intenções que funcionam hoje pedem uma **ação sobre o
mundo**. Consulta é leitura — categoria diferente. Além disso, "consulta" no
vocabulário da clínica significa *procedimento* (`Consulta / Avaliação` está
no catálogo), nunca "consultar".

### 4.2 Campo raiz de classificação — inconclusivo, instrumento inválido

Um booleano raiz (`duvida_sobre_agendamento_proprio`), com e sem instrução,
devolveu 0/20 nas duas variantes — **mas o resultado é inválido**. O campo
veio ausente em 100% das chamadas porque `cliente-modelo-openai.ts` **ignora o
schema do chamador** (linha 461, envia sempre `SCHEMA_PORTATIL_APROVADO`) e a
conversão **rejeita qualquer chave raiz extra** (linha 708).

Consequência de desenho: um campo raiz novo **não é mudança de schema** — é
mudança no cliente de produção (schema portátil + conversão + tipo +
validador), o componente mais crítico do Core, em uso pelos três fluxos.

### 4.3 Regra de relevância no prompt da redatora — reprovada, piorou

Medida a regra "use somente em cumprimento puro ou quando o assunto for o
próprio atendimento; nunca como acréscimo":

| grupo | sem a regra | com a regra |
|---|---|---|
| saudação pura | **11/15** | **0/15** |
| pergunta sobre agendamento | 12/12 | 12/12 |
| outro assunto | 0/15 | 3/15 |
| **total** | **23/42** | **15/42** |

A regra **destruiu** o caso que ela deveria preservar (saudação: 11/15 → 0/15)
e ganhou ruído no controle. Descartada.

### 4.4 O que sobrou, e funciona sem nenhuma regra

- **Pergunta sobre o agendamento: 12/12 nas duas variantes.** Imune à
  instrução — quando o assunto é o agendamento, a redatora usa o fato e
  responde direto.
- **Saudação pura: 11/15 com o prompt de produção intacto.** O comportamento
  desejado já emerge naturalmente.

## 5. Limitação aceita

**Em algumas dúvidas sobre a clínica, a redatora pode mencionar o agendamento
futuro sem necessidade.** Medido em ~100% das repetições para "qual o
endereço?" e "quanto custa limpeza?".

Decisão do Gabriel, 2026-08-12: **ruído conversacional aceitável nesta V1.**
Não justifica criar intenção, classificador, campo raiz, parser ou camada nova.

**Tamanho real da exposição.** O grupo "outro assunto" foi medido em pior
caso, com o fato presente em todas as frases. Cruzando com o gatilho da seção
2, três das cinco já estão protegidas estruturalmente:

| frase | decisão em produção | fato chega? |
|---|---|---|
| "bom dia, quero marcar para sexta" | operacional (tem `data_texto`) | **não** |
| "quero remarcar" | `intencao=remarcacao` | **não** |
| "quero cancelar" | `intencao=cancelamento` | **não** |
| "qual o endereço?" | `duvida_livre` | **sim** |
| "quanto custa limpeza?" | `duvida_livre` | **sim** |

**A exposição real são duas** — dúvidas genuínas sobre a clínica feitas por
paciente com agendamento futuro. Mesmo nelas, a resposta em geral **responde à
pergunta** e anexa o agendamento depois. Nunca grava dado, nunca decide errado:
no pior caso é uma frase a mais que ninguém pediu.

**Por que não há como separar.** "quando é minha consulta?" e "quanto custa
limpeza?" são ambas `natureza=duvida` → `duvida_livre`. São o mesmo caso
estruturalmente, para o Core e para a IA. Nenhuma das quatro rotas da seção 4
conseguiu separá-las.

## 6. Correção da guarda — defeito real já em produção

`coletarMinutosAutorizados` (`guarda-resposta-redatora.ts`) lê
`horarios_disponiveis`, `proposta_pendente`, `agendamento_confirmado` e
`agendamento_atual` — **mas não `agendamentos_candidatos`**.

Confirmado executando a guarda real:

```
fatos: agendamentos_candidatos: ['10/08 às 14:00', '15/08 às 09:00']
texto: "Você tem dois agendamentos: 10/08 às 14:00 e 15/08 às 09:00. Qual deles quer remarcar?"
guarda: { aprovado: false, motivo: 'horario_nao_autorizado' }
```

**Isso já afeta a remarcação em produção** (Edge 19): sempre que o paciente
tem múltiplos agendamentos e a Iris pergunta qual remarcar, a resposta natural
da redatora é reprovada e cai no texto fixo. Não corrompe dado nem quebra
fluxo — desliga a redatora silenciosamente naquele caso.

**Correção:** `coletarMinutosAutorizados` passa a incluir os horários de
`agendamentos_candidatos` e de `agendamentos_do_paciente`.

**Não afrouxa nada.** Medido: dos 24 casos da medição de menção, a correção
libera exatamente os 20 em que o horário citado **é** o do agendamento real, e
mantém bloqueados os 4 em que a redatora inventou horário de funcionamento
("das 8h às 18h") — que a guarda deve barrar e continua barrando.

## 7. PII — fora do escopo

A redatora **nunca recebe o nome do paciente** hoje: só `mensagemPaciente`,
`naturezaMensagem`, `fatos`, `historicoRecente` e `nomeClinica`.

Responder "Olá, Gabriel" exigiria mandar dado cadastral através da fronteira
do modelo — decisão de PII própria, **não incluída nesta v1** (decisão do
Gabriel, 2026-08-12).

## 8. Desenho final — arquivos afetados

**Status: implementado, publicado (commit `4843bc1`, Edge v20).**

Seis arquivos, todos aditivos:

| arquivo | mudança |
|---|---|
| `orquestrador-tipos.ts` | `ResultadoOrquestrador.agendamentos_do_paciente?: readonly AgendamentoAtivo[]` |
| `orquestrador.ts` | busca condicional (seção 2) + anexo no retorno |
| `gerar-resposta-conversacional.ts` | um parâmetro de passagem |
| `fatos-autorizados.ts` | 3º parâmetro + campo opcional, anexado fora do switch |
| `guarda-resposta-redatora.ts` | autorizar minutos (seção 6) |
| `index.ts` | uma linha de fiação |

Zero: intenção, campo raiz, evento, parser, estado, RPC, tabela, migration,
regra de prompt.

### 8.1 Dois ajustes da revisão independente (Codex), incorporados ao desenho final

- **`procedimento_id` nunca é fallback de texto.** A descrição do agendamento
  usa `agendamento.procedimento ?? 'atendimento'` — nunca
  `agendamento.procedimento_id`. Este caminho termina na redatora, ou seja, no
  texto enviado ao paciente; nenhum identificador interno e opaco pode
  atravessar essa fronteira.
- **Falha de banco nunca vira "sem agendamento".** `buscarAgendamentosParaContexto`
  não tem `try/catch` próprio — um erro de `buscarAgendamentoAtivo` propaga
  pelo mesmo caminho técnico já usado por `decidirRemarcacao` e
  `decidirCancelamento`. "Sem agendamento" é um fato (o paciente não tem
  nenhum); um erro de leitura não é esse fato e nunca deveria virar
  silenciosamente a mesma coisa.

## 9. Testes mínimos

**Caminho principal**

1. Paciente identificado, 1 agendamento futuro, mensagem "oi" → fato presente.
2. Mesma situação, "quando é minha consulta?" → fato presente.
3. Paciente **sem** agendamento futuro → campo **ausente**, comportamento
   idêntico ao de hoje.
4. Paciente **sem ficha** (`paciente_id` nulo) → campo ausente, **nenhuma
   consulta ao banco**.
5. Múltiplos agendamentos → todos, na ordem da busca, sem pergunta de escolha.

**Isolamento (pares A/B obrigatórios)**

6. Mesma mensagem, variando **só** a existência de agendamento futuro: com,
   fato presente; sem, campo ausente.
7. **Decisão operacional nunca recebe o fato** — `reserva_criada`,
   `aguardando_confirmacao`, `remarcacao_criada`, `cancelamento_criado`,
   `aguardando_confirmacao_cancelamento`: campo ausente em todas. É o teste
   que protege a decisão da seção 2.
8. Turno operacional **não faz consulta extra** ao banco (contagem de
   chamadas), provando que o gatilho restrito funciona.

**Guarda (seção 6)**

9. Texto citando os horários de `agendamentos_candidatos` → **aprovado** (é a
   correção; hoje reprova).
10. Texto citando os horários de `agendamentos_do_paciente` → aprovado.
11. Texto citando horário que **não** está em nenhum fato → **continua
    reprovado**. Prova que a correção não afrouxou a validação.

## 10. Pendências abertas por esta spec

- **A limitação da seção 5 fica visível ao paciente.** Aceita e registrada,
  não corrigida.
- **Nome do paciente (seção 7)** continua fora — se entrar, é decisão de PII
  própria.
- **Dia da semana na descrição — reimplementado, não reaproveitado; risco de
  divergência coberto por teste.** `diaDaSemanaCivil` foi reimplementado em
  `fatos-autorizados.ts` (a convenção documentada do projeto), em vez de
  exportar o helper privado de `orquestrador.ts`. Duas implementações
  independentes do mesmo algoritmo abrem risco real de divergência silenciosa
  — fechado por `src/core/paridade-dia-semana.test.ts`, que observa as duas
  pelas saídas públicas já existentes (nunca exportando nada) e compara,
  lado a lado, 8 datas: comuns, virada de ano, bissexto comum (2024, 2028) e
  o caso secular 2000 (bissexto por múltiplo de 400). Continuam sendo duas
  implementações — a proteção é o teste, não a unificação.
- **A guarda valida horário, nunca data.** Se a redatora errar a data, nada
  detecta. Limitação pré-existente, não introduzida aqui.
