# Correção de cadastro fora do agendamento — v1

Levantado em 2026-09-01, a partir de conversa real de WhatsApp. **Nada foi
implementado.** Este documento existe para revisão e aprovação do Gabriel
antes de qualquer código.

## Aderência a `docs/00-principios.md`

**O que esta spec remove:** nada de código. Remove um *desfecho errado* — a
Iris afirmando ao paciente que alterou um dado que não alterou.

**O que acrescenta:** uma decisão no orquestrador que liga peças que **já
existem** (`persistirPaciente`, o vocabulário `data_nascimento`/`email`, a
classificação `correcao` da IA). Nenhuma tabela, coluna, migration, RPC,
campo de vocabulário ou estado novo.

**Exceção declarada:** nenhuma.

## O caso real (WhatsApp, Cleardent, 2026-09-01)

O paciente agendou uma avaliação e informou a data de nascimento no cadastro.
Logo depois percebeu o erro:

> **Paciente:** "consigo modificar minha data de nascimento? eu nasci em 1974"
> **Iris:** "Claro. Posso corrigir para 1974. Qual é o dia e o mês?"
> **Paciente:** "sim, só alterar o ano, dia e mês está correto"
> **Iris:** "Qual procedimento ou atendimento você está buscando?"
> *(...)*
> **Iris:** "A alteração do ano para 1974 **ficou registrada**."
> **Paciente:** "você alterou minha data para 1974?? ou ficou com a antiga?"
> **Iris:** "Posso te ajudar a agendar uma consulta..."

**A data no banco continua `1973-08-02`.** Nada foi alterado.

## Causa, com evidência

Verificado no código e nos logs do turno (18:08–18:12 UTC):

1. **A IA entendeu.** `sombra_unificada campos=data_nascimento:corrigiu` em
   quatro turnos seguidos. A compreensão nunca foi o problema.

2. **O Core não tinha o que fazer.** `decidirPorNatureza`
   (`orquestrador.ts:1500`) devolve `null` para `natureza='correcao'` — segue
   pelo "caminho normal", que sem procedimento produz `aguardando_procedimento`.
   Daí a pergunta "qual procedimento?" a quem só queria corrigir o ano.

3. **`persistirPaciente` só é chamada dentro da reserva.** Um único ponto de
   chamada (`orquestrador.ts:1856`), sob o comentário *"garantir paciente_id
   antes da reserva"*. Sem agendamento em andamento, o dado corrigido não tem
   destino.

4. **A guarda barrou a resposta, e o fallback piorou.**
   `resposta_conversacional_fallback motivo=data_nao_autorizada`, duas vezes: a
   redatora citava 1974, que não estava nos fatos autorizados. A guarda agiu
   como projetada; o texto determinístico que entrou no lugar é o
   "posso te ajudar a agendar" final.

**A afirmação falsa é o item mais grave.** Mesma família do defeito que
originou a guarda de execução (`guarda-resposta-redatora.ts`: *"quatro horas
depois, aqueles valores viraram um agendamento REAL que ninguém pediu"*), agora
em dado cadastral. O paciente encerrou a conversa confiando; só descobriu
porque desconfiou e perguntou de novo.

## Escopo (decisão do Gabriel, 2026-09-01)

**Somente `data_nascimento` e `email`.**

`nome` e `cpf` ficam **fora desta v1**, deliberadamente:

- **`cpf`** pode colidir com a ficha de outro paciente. O tratamento já existe
  (`cpf_ja_cadastrado`, `specs/cpf-outro-telefone-v1.md`) e envolve decisão
  sobre ficha alheia — não é o caminho mais simples, e misturá-lo aqui
  contaminaria uma mudança pequena.
- **`nome`** é identidade e já foi fonte de defeito real (2026-08-16: o
  sobrenome do dentista virou nome do paciente).

Se o paciente pedir correção de nome ou CPF, o comportamento **não muda** em
relação a hoje. Tratar isso é decisão futura e separada.

## Desenho

### Quando a decisão se aplica

Todas as condições, simultaneamente:

1. o paciente está **identificado** (`paciente_id` existe) — sem ficha não há
   o que corrigir;
2. o turno trouxe `data_nascimento` e/ou `email` — **como alteração válida ou
   como campo inválido descartado** (ver "Valor inválido"); os dois casos
   disparam a decisão, com desfechos diferentes;
3. **não há fluxo de agendamento em andamento** — sem `procedimento_id` na
   conversa. Com procedimento, o caminho atual já persiste o cadastro na
   reserva, e nada muda;
4. o valor é **diferente** do que está na ficha. Igual não é correção: nenhuma
   escrita, nenhum anúncio.

Faltando qualquer uma, o comportamento é o de hoje.

### O que o Core faz

Chama `persistirPaciente` com os campos corrigidos e devolve a decisão nova
`cadastro_atualizado`, com **quais campos** foram atualizados.

Reusa integralmente o que existe: a RPC `cappia_persistir_paciente`, a
validação de formato (`DATA_REGEX`, `EntradaInvalidaError`) e a visão efetiva
do cadastro. **Nenhuma validação nova é escrita.**

### O que a redatora recebe

Um fato, **nunca uma frase pronta**:

```
objetivo: informar_cadastro_atualizado
campos_atualizados: ['data_nascimento']
```

Ela redige com as próprias palavras, como já faz com todo o resto. O Core não
manda texto (`docs/07-arquitetura-v2.md`: o Core devolve fato, quem escreve é
a redatora).

### Valor inválido — ATENÇÃO: não chega como alteração

Corrigido em 2026-09-01, após revisão: a v1 desta spec dizia que o valor
inválido chegaria à decisão nova e seria rejeitado ali. **Está errado.**

`descartarCadastroInvalido` (`interpretar-e-aplicar.ts:740`) roda **antes** de
qualquer decisão do orquestrador: data malformada ou e-mail sem forma de e-mail
é **removido de `alteracoes`** e vai para `invalidos`. Logo, a condição 2 do
gatilho ("o turno trouxe alteração de `data_nascimento`/`email`") é **falsa**
nesse caso, e a decisão nova nunca dispararia.

Consequência para o desenho: a decisão precisa olhar **também os campos
inválidos**, não só as alterações aplicadas. São dois gatilhos:

- **campo alterado e válido** → grava e informa;
- **campo inválido descartado** → **não grava** e informa que o dado não foi
  aceito, para a redatora pedir de novo.

Reusa `dados_invalidos`, que já existe em `cadastro_necessario`. Nunca gravar
valor inválido, nunca afirmar que gravou.

### Pré-condição de `persistirPaciente`: `nome` é obrigatório

`validarEntrada` (`persistir-paciente.ts:99`) lança `EntradaInvalidaError`
quando `nome` é vazio, **em toda chamada** — inclusive numa correção que só
toca o e-mail. Na prática a ficha sempre tem nome (a reserva o exige), mas
"reusa integralmente o que existe" não pode esconder essa pré-condição: sem
nome na ficha, a correção estoura em vez de responder.

## O que NÃO muda

- **A regra de identidade permanece intacta.** `interpretacao-instrucoes.ts:20`
  proíbe a IA de corrigir a **grafia** de nome, CPF, data de nascimento e
  e-mail ("Gabirel" pode ser o nome real do paciente). Isso é diferente da
  **ação** `corrigir`, que a linha 59 já autoriza: *"se existia e foi
  claramente substituído, use `corrigir`"*. Esta spec depende da segunda e não
  afrouxa a primeira — o valor novo vem do paciente, nunca de a IA achar que o
  anterior estava mal escrito.

  *(Corrigido em 2026-09-01: a v1 desta spec citava a linha 20 como se ela
  proibisse a ação de corrigir. Não proíbe — proíbe corrigir grafia.)*
- **Nenhum fluxo existente é alterado.** Com agendamento em andamento, o
  caminho atual segue idêntico.
- **`decidirPorNatureza` não é tocada.** A decisão nova não depende de
  `natureza='correcao'` — depende dos **campos alterados**, que é sinal
  estrutural. `natureza` é classificação de tom e não deve virar gatilho de
  escrita em banco.

## Cenários obrigatórios

| # | Cenário | Esperado |
|---|---|---|
| CC-01 | Paciente identificado corrige o ano de nascimento, sem fluxo aberto | grava e informa |
| CC-02 | Corrige e-mail, sem fluxo aberto | grava e informa |
| CC-03 | Corrige os dois no mesmo turno | grava ambos, informa ambos |
| CC-04 | Valor igual ao da ficha | **nenhuma escrita**, nenhum anúncio |
| CC-05 | Data malformada | **não grava**, informa que não foi aceito — pelo gatilho de **campo inválido**, já que a alteração não chega (ver "Valor inválido") |
| CC-05b | Ficha sem `nome` e correção de e-mail | não estoura; responde em vez de lançar erro |
| CC-06 | **Com** agendamento em andamento | comportamento de hoje, inalterado |
| CC-07 | Paciente **não** identificado | comportamento de hoje, inalterado |
| CC-08 | Pedido de corrigir **nome** ou **CPF** | fora do escopo: comportamento de hoje |
| CC-09 | Falha da RPC | **nunca** afirma que atualizou |

**CC-09 é o teste que fecha o defeito original.** Ele precisa falhar se alguém
fizer a Iris anunciar sucesso sem confirmação do banco.

## Risco

`orquestrador.ts` governa toda conversa, e três mecanismos já disputam decisões
ali. A mudança é pequena, mas o lugar é sensível: os cenários CC-06 e CC-07
existem para provar que os fluxos atuais não mudaram.

## Aprovação

Este documento não autoriza implementação. Depende de aprovação explícita do
Gabriel e, quando houver tokens, de revisão do Codex (`AGENTS.md`).
