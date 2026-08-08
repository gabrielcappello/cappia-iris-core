# Histórico conversacional recente — V1 (definitiva)

**Status:** aprovada conceitualmente pelo Gabriel em 2026-08-07. **Não implementada.** Não
autoriza código, migration, alteração de banco, painel ou n8n. Aguarda revisão independente
antes de qualquer implementação.

**Decisão de produto do Gabriel (2026-08-07):** a Iris guarda os **últimos 10 pares**
paciente ↔ Iris, e esse histórico é usado **pela interpretadora e pela redatora**. Não é
etapa intermediária nem valor provisório: é o estado final pretendido. A memória de um
único par (`ultima_troca`, hoje em produção) era um recorte de escopo da primeira entrega,
nunca um princípio — esta spec o substitui por inteiro.

**Princípio que passa a valer (formulação do Gabriel):**

> A interpretadora nunca interpreta a mensagem atual isoladamente. Ela recebe o contexto
> conversacional recente necessário para compreender o significado daquela resposta.

E o limite que **não** muda:

> O estado operacional — procedimento, dentista, data, horário, confirmação, cadastro —
> continua estruturado no Core e no banco. O histórico é contexto de linguagem, nunca
> fonte de fato operacional. Nenhuma decisão de agendamento passa a depender de "a IA
> lembrar".

**Prioridade de produto, declarada pelo Gabriel em 2026-08-07 e válida como critério de
desempate em toda esta spec:**

> A qualidade da conversa vem primeiro. Segurança e privacidade importam, mas não devem
> empurrar a arquitetura para um lado excessivamente defensivo nem complicar o sistema sem
> benefício claro para o paciente. Havendo conflito entre uma camada extra de proteção e
> uma conversa mais natural e inteligente, vence a solução mais simples — desde que a
> segurança não seja comprometida de forma relevante.
>
> **Não adicionar complexidade para um problema que o fluxo atual praticamente não produz.**

Esta V1 é o resultado direto desse critério: **nenhuma sanitização, nenhum detector,
nenhum marcador, nenhuma camada nova.** O histórico guarda os pares como eles aconteceram.

---

## 0. Decisões aprovadas em 2026-08-07

### 0.1 — PII: **nenhuma sanitização nesta V1** — APROVADA

A pergunta era se o histórico deveria mascarar campos cadastrais (cpf, e-mail, data de
nascimento) antes de persistir. Foram avaliadas quatro alternativas, incluindo uma
sanitização determinística na gravação, que chegou a ser especificada em detalhe. **Todas
foram descartadas** depois que dois fatos foram verificados no código e no banco:

1. **O único campo cadastral que a Iris realmente pede é `nome`.**
   [gerar-resposta-paciente.ts:92](src/core/gerar-resposta-paciente.ts:92) —
   `cadastro_necessario` responde *"Pode me passar seu nome completo?"*. O sistema **nunca
   pede** CPF, e-mail ou data de nascimento; cadastro de paciente novo está explicitamente
   fora de escopo e o fluxo para nesse ponto.
2. **Nenhum campo cadastral jamais foi preenchido em produção.** Consulta a
   `estado_conversa` em `udizowyfjnhuhgxkeayk` (2026-08-07): as conversas contêm somente
   `data_texto`, `periodo` e `procedimento_texto`. Zero `cpf`, zero `email`, zero
   `data_nascimento`.

Ou seja: qualquer sanitização hoje protegeria o caso em que o paciente **oferece um CPF sem
ninguém pedir**, num sistema que não pede CPF.

**O que se ganharia, medido com honestidade:**

| Eixo | Ganho real da sanitização, hoje |
|---|---|
| **Produto** | **Nenhum.** Não entrega nada ao paciente. Removê-la elimina o marcador que poderia confundir o modelo e o risco de falso-positivo corromper texto |
| **Segurança — dado em repouso** | **Zero.** Se `dados.cpf` existisse, o valor já estaria em texto puro na **mesma linha**, na coluna vizinha. Mascarar o histórico não esconderia nada de quem tem acesso ao banco |
| **Segurança — envio à OpenAI** | Marginal. O valor vai **uma vez de qualquer forma**, na mensagem crua do turno em que é digitado; a sanitização evitaria só a repetição nos turnos seguintes. `store: false` nas duas chamadas já significa que não há retenção |
| **Segurança — eco pela redatora** | Parcial. Ela pode ecoar da mensagem crua **no turno em que importa**; a sanitização só impediria o eco em turnos posteriores |
| **Conformidade** | Gesto alinhado à minimização, sem mover o ponteiro. Os fatos que dominam a postura — dado cadastral em texto puro em repouso, conversa inteira trafegando a processador terceiro, ausência de política de retenção — permanecem intocados |

Pela prioridade de produto declarada acima, isso encerra a questão: **benefício concreto
insuficiente para justificar a complexidade.** Não há função de detecção, não há
substituição, não há marcador `[CPF]`/`[EMAIL]`, não há teste de sanitização, e nenhum
campo novo em `ResultadoOrquestrador`.

**O que fica registrado como decisão futura — e explicitamente NÃO como pré-condição da
Iris:**

> Quando o fluxo completo de cadastro for implementado e a Iris passar a solicitar
> rotineiramente CPF, data de nascimento e e-mail, **revisar a necessidade de minimização
> desses dados no histórico como parte da própria spec de cadastro** — onde o fluxo que
> produz o dado existe e pode ser testado contra um caso real, em vez de um caso imaginado.

Isso não bloqueia nada nesta V1 e não é requisito de funcionamento. É um item de agenda da
etapa de cadastro.

**Consequência declarada, para que ninguém a descubra depois:** o `historico_conversa`
guarda o texto da conversa **como ele aconteceu**. Se um paciente digitar um CPF sem que
lhe peçam, esse texto fica no histórico e é enviado aos dois modelos enquanto estiver na
janela. Isso é conhecido e aceito, não um descuido.

### 0.2 — Nome da coluna: coluna nova + remoção controlada — APROVADA

`ultima_troca` deixa de dizer a verdade no instante em que passa a guardar 10 pares, e o
projeto já tem precedente explícito de que nome ou comentário afirmando o oposto do código
é pior que nenhum (`contexto-horarios.ts`).

**Decisão: quatro passos, nesta ordem.**

1. Migration aditiva: cria `historico_conversa jsonb` nos dois projetos. Puramente aditiva
   — a Edge Function publicada nem sabe que a coluna existe.
2. Deploy do código novo, lendo e escrevendo **somente** `historico_conversa`.
3. **Validação em produção** (WhatsApp real) antes de qualquer remoção.
4. Migration separada, com rollback próprio: remove `ultima_troca`.

Alternativas descartadas: **rename direto** quebraria a função publicada entre a migration
e o redeploy (o `SELECT` cita a coluna pelo nome), produzindo 500 em toda mensagem que
chegasse na janela; **manter o nome** custaria zero hoje e deixaria um nome mentindo sobre
o conteúdo para sempre.

O que decidiu a escolha não foi o nome, foi o **rollback**: entre o passo 2 e o passo 4
existe uma janela real em que reverter o código volta a ler `ultima_troca` — que ainda está
lá, com o dado intacto. Rollback completo, sem perda.

---

## 1. Como `ultima_troca` evolui para histórico de 10 pares

A peça já existe inteira. O que muda é a **forma do valor** e o **número de leitores** —
não há sistema novo, tabela nova, job novo, camada nova nem chamada de banco nova.

| Hoje (`ultima_troca`, em produção) | Nesta V1 (`historico_conversa`) |
|---|---|
| 1 par, sempre substitui | até 10 pares, o mais antigo sai quando entra o 11º |
| valor jsonb é um **objeto** | valor jsonb é um **array** de objetos |
| lido na identificação, exposto em `ResultadoOrquestrador` | idêntico — **nenhuma leitura nova** |
| gravado 1× no fim do turno, com CAS | idêntico — **1 UPDATE, mesmo CAS** |
| filtro de validade 24h na leitura | idêntico, agora **par a par** |
| só a redatora recebe | **redatora e interpretadora** recebem |
| texto gravado como veio | idêntico — **sem sanitização** (seção 0.1) |

O ponto que faz isso caber sem nenhuma consulta extra: o valor anterior **já foi lido** no
início do turno (`identificarConversa` → `ResultadoOrquestrador` → `index.ts`). O par novo
é anexado **em memória** a esse valor, e o array inteiro é gravado num único `UPDATE`.
Continua valendo a regra absoluta do projeto: **nenhum `SELECT` antes da escrita.**

## 2. Formato exato do jsonb

```ts
/** Um turno completo: o que o paciente disse e o que a Iris respondeu a isso. */
export interface ParConversa {
  /** A mensagem do paciente, exatamente como ela chegou. */
  mensagem_paciente: string;
  /**
   * EXATAMENTE a resposta enviada ao paciente -- redação aprovada pela guarda
   * OU fallback determinístico efetivamente escolhido. Nunca um texto reprovado
   * ou descartado.
   */
  resposta_iris: string;
  /** ISO -- quando a resposta foi gerada para envio. Não significa entrega nem leitura. */
  gerada_em: string;
}

/** O valor da coluna: lista ordenada, do mais ANTIGO para o mais RECENTE. */
export type HistoricoConversa = ParConversa[];

/** Tamanho máximo. Aprovado por Gabriel em 2026-08-07 como valor definitivo. */
export const MAX_PARES_HISTORICO = 10;
```

Regras de forma, todas verificáveis:

- **Ordem cronológica crescente** — índice 0 é o par mais antigo, o último é o turno
  imediatamente anterior. É a ordem em que uma pessoa lê uma conversa, e é a ordem em que
  o modelo a recebe. Nunca invertida, nunca reordenada em nenhum ponto.
- **Nunca `[]`** — "nenhum turno anterior" se representa por `NULL` na coluna e por
  **ausência da chave** no payload. Um array vazio sugeriria ao modelo que houve conversa
  sem conteúdo. Mesma disciplina já aplicada em `horarios_oferecidos`
  (`validarHorariosOferecidos` rejeita `[]` explicitamente).
- **Nunca mais de 10 elementos** — o corte acontece na gravação, não na leitura.
- **Cada par tem exatamente os três campos.** Nada de `id`, `indice`, `natureza` ou
  `decisao` — quem precisa de estado operacional lê o estado operacional.
- Nenhum envelope (`{turnos: [...]}`, `{versao: 1, ...}`). O array é o valor.

### Validação na leitura — falha ABERTA, e por que ela é total

`validarHistoricoConversa(valor: unknown): HistoricoConversa | null`, no lugar de
`validarUltimaTroca`, com o mesmo regime já estabelecido: valor malformado vira `null` e a
conversa segue **sem** histórico, em vez de derrubar a identificação. Justificativa
inalterada: nada operacional depende deste campo.

**Um único par malformado invalida o array inteiro** (vira `null`), em vez de ser
descartado individualmente. Não é rigor gratuito: descartar só o par ruim abre um **buraco
silencioso no meio da conversa**, e um histórico com um turno faltando no meio é pior para
a compreensão do que nenhum histórico — a IA leria uma sequência que nunca existiu. Mesmo
critério de `validarContextoHorarios`, que invalida o snapshot inteiro quando um campo
presente está malformado.

### Compatibilidade com o valor antigo (objeto de 1 par)

**Evidência real, verificada em 2026-08-07** (não deduzida): em `udizowyfjnhuhgxkeayk`
(operacional) existe **1 linha** em `estado_conversa`, com `ultima_troca` no formato
**objeto**. Em `bcmuqautblvjdqzhjfbw` (dev) não há nenhuma linha.

Decisão: **nenhum código de compatibilidade.** Com a opção aprovada em 0.2 a questão
praticamente desaparece — `historico_conversa` nasce `NULL` em todas as linhas, e
`ultima_troca` simplesmente deixa de ser lida. O valor antigo não é migrado: custaria um
ramo de conversão permanente para preservar um turno de uma conversa de teste.

## 3. Ciclo de leitura e gravação

### Leitura — uma vez, no início do turno, junto com tudo

`identificacao.ts` já lê a coluna em `COLUNAS_ESTADO_CONVERSA`. Troca-se o nome da coluna
e o validador. `ResultadoIdentificacao.conversa.historico_conversa` substitui
`ultima_troca`. **Nenhuma consulta nova em nenhum ponto do turno.**

### Threading — o valor atravessa até os dois consumidores

`orquestrador.ts` passa a fazer duas coisas com esse valor, onde hoje faz uma:

1. **repassar para a interpretadora** (novo — seção 6), com o filtro de validade aplicado;
2. **expor em `ResultadoOrquestrador`** (já faz hoje), sem filtro, para o chamador usar na
   redação (seção 7) e na gravação.

O valor exposto em `ResultadoOrquestrador` é deliberadamente **sem filtro de idade**: quem
grava precisa da lista real para anexar o par novo, e o filtro é só de leitura para os
modelos.

### Gravação — depois da resposta, um único UPDATE

Momento inalterado: **depois** que a resposta final está decidida, com **exatamente** o
texto que vai ao paciente (redação aprovada ou fallback efetivamente escolhido). Nunca um
texto reprovado pela guarda — um texto reprovado que virasse memória faria a Iris
referenciar, no turno seguinte, algo que nunca foi dito.

`gravarHistoricoConversa` (substitui `gravarUltimaTroca`) ganha **um** campo de entrada:

```ts
export interface GravarHistoricoEntrada {
  conversa_id: string;
  clinica_id: string;
  telefone_normalizado: string;
  atualizado_em_da_resposta: string;
  /**
   * O histórico lido no início deste turno (ResultadoOrquestrador), nunca
   * relido. `null` quando a conversa ainda não tem nenhum par. É sobre ele que
   * o par novo é anexado -- em memória, sem nenhum SELECT.
   */
  historico_anterior: HistoricoConversa | null;
  mensagem_paciente: string;
  resposta_iris: string;
}
```

E o corpo passa a ser, em essência:

```ts
const novo: ParConversa = {
  mensagem_paciente: entrada.mensagem_paciente,
  resposta_iris: entrada.resposta_iris,
  gerada_em: new Date().toISOString(),
};
const historico = [...(entrada.historico_anterior ?? []), novo].slice(-MAX_PARES_HISTORICO);
```

`.slice(-10)` mantém os 10 mais recentes preservando a ordem. O corte é **por contagem, na
gravação** — nunca por idade (seção 5) e nunca na leitura.

Continua devolvendo `void` e continua **nunca lançando**: é a última escrita do turno,
nenhum CAS posterior depende dela, e falhar significa apenas que o próximo turno terá um
turno a menos de contexto — degrada a conversa, nunca produz erro ao paciente e nunca
produz agendamento errado.

## 4. CAS e concorrência

**Inalterado em mecanismo.** Um único `UPDATE`, com
`.eq('atualizado_em', <valor devolvido por processarMensagem>)`, encadeado sobre o
`atualizado_em` que `gravarContextoHorarios` produziu no mesmo turno. Nenhum `SELECT`
antes, nenhuma releitura, nenhum retry, nenhum rebase. CAS falho → abandona imediatamente,
em silêncio. Falha técnica do cliente → idem.

O que **muda de natureza** e precisa ser dito com clareza: a escrita deixa de ser um
"substituir" cego e passa a ser um **read-modify-write**. Isso normalmente seria um risco
novo de perda de atualização — e aqui não é, por um motivo específico:

> A leitura do modify é a **mesma leitura** cujo `atualizado_em` o CAS está verificando.

Se qualquer outra operação gravou na linha entre a identificação e esta escrita, o
`atualizado_em` mudou, o CAS falha, e a escrita é abandonada **sem sobrescrever nada**.
Não existe caminho em que um histórico calculado sobre uma base velha vença um histórico
mais novo. O CAS que já existia por outro motivo cobre exatamente este.

**Consequência aceita e declarada:** duas mensagens processadas em paralelo produzem
**um** par gravado, não dois — a perdedora do CAS descarta o seu turno. É o comportamento
já vigente hoje, só que agora perceptível como "faltou um turno no meio" em vez de "a
memória ficou uma atrás". Não há retry: reler para rebasear é proibido por decisão
anterior, e insistir numa escrita auxiliar não vale o risco de ressuscitar estado obsoleto.

## 5. Validade temporal

`VALIDADE_HISTORICO_MS = 24h` — mesma janela já aprovada em 2026-08-06, mesma constante
nomeada e exportada, nunca literal inline.

O que muda: o filtro passa a ser **por par**, não pelo objeto inteiro.

```ts
export function historicoValidoParaEnvio(
  historico: HistoricoConversa | null,
  agoraMs: number
): HistoricoConversa | undefined
```

- filtra cada par por seu próprio `gerada_em`, preservando a ordem;
- devolve `undefined` (nunca `null`, nunca `[]`) quando **nenhum** par sobrevive — para que
  a chave seja **omitida** do payload;
- **a expiração continua sendo só de LEITURA.** A coluna nunca é apagada por tempo:
  nenhum job, nenhuma rotina de limpeza, nenhum `UPDATE` disparado por relógio. Pares
  expirados continuam na linha e saem sozinhos, por contagem, quando 10 turnos novos
  entrarem.

Por construção os pares expirados são sempre um prefixo do array (ordem cronológica), mas
o filtro **não assume isso** — avalia par a par e preserva a ordem do que sobra. Assumir
seria depender de um invariante que nenhuma validação garante.

**Limpeza por decisão: continua não existindo.** Nenhuma decisão do orquestrador limpa o
histórico, inclusive `reserva_criada` — decisão explícita do Gabriel em 2026-08-06,
mantida: se o paciente responder "obrigado!" logo depois, a Iris precisa saber a que ele
está agradecendo. O único momento em que a coluna muda é quando um turno novo é anexado.

## 6. Como chega à IA interpretadora

**Esta é a reversão declarada.** `specs/memoria-conversacional-minima-v1.md` estabeleceu
que `ultima_troca` **nunca** chegaria à interpretadora. Aquela decisão foi correta no
contexto dela (o problema tratado era só o de fala natural). A evidência real de
2026-08-07 — "Sim", isolado, classificado como `nao_compreendida` — mudou o contexto. Esta
spec reverte esse ponto **com justificativa registrada**, não em silêncio.

### Contrato

`EntradaInterpretacao` (`interpretacao-tipos.ts`) ganha um campo opcional:

```ts
export interface EntradaInterpretacao {
  // ... campos existentes, inalterados ...
  /**
   * Últimos pares (mensagem do paciente + resposta da Iris), do mais antigo
   * para o mais recente, já filtrados por validade. Serve exclusivamente para
   * interpretar mensagens que só fazem sentido em relação ao que veio antes
   * ("sim", "esse mesmo", "aquele que você falou") -- nunca autoriza um dado
   * novo por si só; todo campo emitido continua sujeito ao mesmo vocabulário
   * fechado. AUSENTE (nunca null, nunca []) quando não há par válido.
   */
  historico_recente?: ParConversa[];
}
```

O `gerada_em` **fica** no que vai ao modelo, ao contrário do que a spec anterior da
interpretadora propunha. Com 10 turnos, saber que houve um intervalo de horas entre dois
deles é informação linguística real ("desculpa a demora", "ainda dá tempo?"). Com 1 turno
só, não era.

### Threading

`orquestrador.ts`, no mesmo ponto e mesmo padrão de `horarios_oferecidos` /
`proposta_pendente`:

```ts
const historicoParaInterpretacao = historicoValidoParaEnvio(
  identificacao.conversa.historico_conversa,
  Date.now()
);

const interpretacao = await interpretarEAplicar(clienteModelo, clienteBanco, {
  // ... campos existentes ...
  ...(historicoParaInterpretacao !== undefined
    ? { historico_recente: historicoParaInterpretacao }
    : {}),
});
```

`InterpretarEAplicarInput`, `CHAVES_OPCIONAIS_INTEGRADA`, `CHAVES_OPCIONAIS_INTERPRETACAO`
e `construirEntradaMinimizada` acompanham — a **entrada continua fechada**: chave nova
declarada explicitamente nas listas de permitidas, com validador próprio
(`validarHistoricoRecente`), no mesmo molde de `validarHorariosOferecidos` /
`validarPropostaPendente`. Nada entra por spread.

> **Observação de implementação, explicitamente opcional:** `construirEntradaMinimizada`
> já recebe dois opcionais posicionais e passaria a receber três. Trocar por um objeto de
> opções deixaria a chamada mais legível — mas é arrumação, sem nenhum benefício para o
> paciente, e pela prioridade de produto declarada no topo desta spec **pode simplesmente
> ser deixado de fora**. Um terceiro parâmetro posicional é aceitável.

### Instrução — UMA regra, por princípio, nunca por palavra

Adicionada a `interpretacao-instrucoes.ts`:

> Quando "historico_recente" estiver presente, ele mostra os últimos turnos desta conversa,
> do mais antigo para o mais recente — o que o paciente disse e o que você (Iris)
> respondeu. Use esse contexto para entender a mensagem atual como uma pessoa entenderia
> numa conversa real: mensagens curtas, respostas a algo que você perguntou, referências a
> algo já dito. Nunca mecanicamente por palavra isolada. Ausência de "historico_recente"
> significa que não há contexto disponível — nesse caso a regra de dúvida real continua
> valendo normalmente.

**Não** lista palavras-gatilho ("sim", "ok", "pode ser"). **Não** cria vocabulário fechado
novo. Os campos que a interpretadora pode preencher e os valores permitidos não mudam em
nada — `confirmacao` continua só `'sim'`, `CAMPOS_PERMITIDOS` intacto. A única mudança é
que ela passa a ter informação suficiente para chegar à classificação certa, em vez de cair
em dúvida por falta de contexto.

**O que continua proibido para a interpretadora, sem exceção:** resolver contra catálogo,
decidir o próximo estado da conversa, emitir texto de resposta, ou tratar algo dito no
histórico como fato operacional. Um procedimento mencionado 5 turnos atrás **não** é
`procedimento_texto` — quem sabe isso é `dados`, que é estruturado e persistido.

## 7. Como chega à IA redatora

Mudança mínima: `EntradaRedator.ultimaTroca?: UltimaTroca` vira
`historicoRecente?: ParConversa[]`, e a chave no JSON enviado passa de `ultima_troca` para
`historico_recente`. Mesmo filtro, mesma função, aplicado no mesmo lugar
(`gerar-resposta-conversacional.ts`, no ponto de leitura) — **a função de filtro é
reaproveitada, nunca duplicada.**

`redator-instrucoes.ts`, substituindo a linha atual sobre `ultima_troca`:

> - "historico_recente" (quando presente): os últimos turnos desta conversa, do mais antigo
>   para o mais recente — o que o paciente disse e o que você respondeu. Use para dar
>   continuidade natural. Ausente quando não há conversa recente.

Nada mais no contrato da redatora muda. **A guarda programática continua idêntica e
continua sendo a garantia real**: contexto novo não é autorização nova. A redatora com 10
turnos de histórico continua sem poder citar um horário que não esteja nos fatos
autorizados — inclusive um horário que ela mesma citou 3 turnos atrás. Isso precisa estar
num teste (seção 10), não só numa frase.

**Canal de PII da redatora, verificado:** `FatosAutorizados`
([fatos-autorizados.ts](src/core/fatos-autorizados.ts)) **não tem nenhum campo cadastral**
— `cadastro_necessario` devolve apenas `{objetivo: 'pedir_cadastro', dados_faltantes:
['cadastro']}`, a palavra "cadastro", nunca um valor. O único caminho por onde PII chega a
ela é texto de conversa: mensagem atual e histórico.

### Custo, declarado antes de alguém descobrir na conta

10 pares de mensagens de WhatsApp acrescentam algo na ordem de centenas a ~1–2 mil tokens
de **entrada**, em **duas** chamadas por mensagem (interpretadora + redatora). Não afeta
`MAX_OUTPUT_TOKENS` (300, que é saída) nem os timeouts aprovados, mas afeta custo e um
pouco a latência. Não é motivo para reduzir N — é informação que o Gabriel deve ter antes,
não depois.

## 8. Impacto nas migrations já aplicadas

**Verificado no banco em 2026-08-07, não inferido dos arquivos:**

| Projeto | `estado_conversa.ultima_troca` | Linhas com valor |
|---|---|---|
| `udizowyfjnhuhgxkeayk` (operacional, WhatsApp ativo) | `jsonb`, nullable — **existe** | 1, formato objeto |
| `bcmuqautblvjdqzhjfbw` (dev/teste isolado) | `jsonb`, nullable — **existe** | 0 |

Registrada em `bcmuqautblvjdqzhjfbw` como `20260806235238 iris_nova_ultima_troca`.

Consequências:

- **Nenhuma migration altera tipo de coluna.** `jsonb` guarda array tão bem quanto objeto
  — a mudança de formato, por si só, não exigiria DDL nenhum. Essa é a razão técnica de
  isso caber como "mesmo prédio, mais um andar".
- As migrations já aplicadas **não são revertidas nem reescritas**. Arquivo aplicado é
  histórico; corrigir o passado é que seria o erro.
- Nenhuma alteração de RLS, constraint, índice ou dado existente, em nenhum passo.

### Os dois pares de migrations (seção 0.2)

**Par 1 — junto com a implementação.** Estritamente aditivo, na convenção de pastas por
projeto-alvo já estabelecida:

| Arquivo | Alvo |
|---|---|
| `src/supabase/migrations/<ts>_iris_nova_historico_conversa.sql` | `bcmuqautblvjdqzhjfbw` |
| `src/supabase/migrations-legado/<ts>_iris_nova_historico_conversa_legado.sql` | `udizowyfjnhuhgxkeayk` |
| + os dois rollbacks correspondentes | |

Conteúdo: `alter table estado_conversa add column historico_conversa jsonb;` — nullable,
sem default, pelo mesmo motivo de `ultima_troca`: "nenhum turno anterior" se representa por
`NULL`, nunca por objeto ou array vazio. Sem `IF NOT EXISTS`: colisão de nome falha
explicitamente em vez de passar em silêncio.

**Par 2 — só depois da validação em produção.** `alter table estado_conversa drop column
ultima_troca;` nos dois projetos, com rollback próprio. **Não é aplicado na mesma rodada**
— é o passo 4 da seção 0.2, e o que garante a janela de rollback sem perda.

**Risco declarado:** se o passo 4 for esquecido, sobra uma coluna morta em produção —
exatamente o tipo de resíduo provisório que o Gabriel não quer. Nenhum mecanismo força a
conclusão; só disciplina. Fica registrado aqui para que o esquecimento seja detectável na
revisão.

## 9. Specs que ficam superadas

| Spec | O que morre | O que sobrevive |
|---|---|---|
| `memoria-conversacional-minima-v1.md` | **Seção 1** ("no máximo um par, sempre substitui"); **seção 3** ("a IA interpretadora não muda... nunca chega a ela"); a linha correspondente na seção 6; **seção 7** ("histórico com mais de um turno... fora desta V1") | **Seção 2** (momento da gravação, nunca gravar texto reprovado) e a **consequência estrutural** (retorno de `gravarContextoHorarios`, `ResultadoOrquestrador.atualizado_em`/`natureza_mensagem`) — continuam valendo integralmente e são pré-requisito desta. **Seção 4** (tom da redatora) intacta |
| `contexto-conversacional-interpretadora-v1.md` | **Inteira — absorvida por esta spec.** Propunha o mesmo diagnóstico com N=1; N=10 e a simetria entre os dois modelos tornam aquele contrato um subconjunto deste. Nunca foi implementada, então não há código a reverter | O **problema com evidência** (o "Sim" real do WhatsApp) e o **princípio** — ambos reproduzidos aqui |
| `resposta-conversacional-v1.md` | A linha de "fora desta V1": "histórico completo de mensagens no payload" | Todo o resto — guarda, fatos autorizados, fallback determinístico: **inalterados** |
| `interpretacao-ia.md` | A afirmação de que nenhum dado cadastral atravessa para a interpretadora passa a ser **parcialmente falsa**: texto de conversa atravessa, sem sanitização (seção 0.1) | O contrato de minimização dos **campos estruturados** — `dados_atuais` continua exatamente como está, sem nenhum cadastral |

**Atualizações obrigatórias na mesma rodada da implementação:**

1. `specs/interpretacao-ia.md`, seção "Entrada e PII": registrar que o texto de conversa
   passa a atravessar para a interpretadora sem sanitização, com o raciocínio da seção 0.1
   e o item de agenda da etapa de cadastro.
2. O comentário em [cliente-modelo-openai.ts:387](src/core/cliente-modelo-openai.ts:387) —
   "nenhum dado alem de mensagens_atuais/dados_atuais chega no corpo" — torna-se falso com
   `historico_recente` no payload, e precisa ser reescrito.
3. Cabeçalho de **SUPERADA** nas duas primeiras specs da tabela, apontando para cá. Nunca
   apagadas — mesmo critério da nota de 2026-08-07.

## 10. Testes obrigatórios

### Determinísticos — forma e ciclo de vida

- valor `null` → `historicoValidoParaEnvio` devolve `undefined`; chave **ausente** nos dois
  payloads (nunca `null`, nunca `[]`);
- 1 par válido → array de 1 elemento em ambos os payloads;
- 10 pares, chega o 11º → grava **exatamente 10**, o mais antigo sai, **a ordem cronológica
  é preservada** (asserção sobre a lista inteira, não só sobre o tamanho);
- 3 pares dentro da validade + 2 fora → só os 3 vão ao payload, **na ordem original**; a
  coluna continua com **os 5** (expiração não apaga);
- **todos** os pares expirados → chave **omitida** (nunca `[]`);
- array com um par malformado no meio → validador devolve `null` (invalidação total, não
  descarte parcial);
- valor no **formato objeto antigo** → `null`, sem código de compatibilidade;
- `[]` lido do banco → `null`.

### Determinísticos — escrita, CAS e encadeamento

- gravação emite **exatamente um `UPDATE`** e **nenhum `SELECT`** antes;
- `mensagem_paciente` e `resposta_iris` gravadas são **byte a byte** o texto recebido e a
  resposta devolvida ao chamador, nos dois caminhos (redação aprovada e fallback) —
  nenhuma transformação de texto em nenhum ponto;
- redação **reprovada** pela guarda **não** é gravada; o **fallback efetivamente escolhido**
  **é** gravado, com o texto do fallback;
- CAS falho → abandona imediatamente, sem retry, sem lançar, **e sem gravar array parcial**;
- **operação obsoleta não sobrescreve histórico mais novo:** duas execuções concorrentes
  sobre o mesmo `atualizado_em` — a perdedora abandona e o histórico da vencedora permanece
  íntegro (é o teste que prova a seção 4);
- **encadeamento dos dois CAS no mesmo turno:** `contexto_horarios` grava com sucesso e
  devolve o `proximoTimestamp` novo; a gravação do histórico usa esse valor e também vence
  — sem releitura entre os dois;
- **CAS de `contexto_horarios` falho:** devolve o valor obsoleto, o CAS do histórico falha
  em seguida e abandona;
- `reserva_criada` **não** limpa o histórico;
- falha da gravação **não** altera a resposta devolvida ao paciente.

### Determinísticos — fronteira dos dois modelos

- histórico válido chega à **interpretadora** — este teste **reverte explicitamente**
  `ultima-troca-integrado.test.ts` ("nunca vai para a IA interpretadora"), e o motivo da
  reversão fica escrito no próprio teste, com data e spec;
- histórico válido chega à **redatora**;
- os dois recebem **exatamente a mesma janela filtrada** (nenhuma divergência silenciosa);
- a entrada da interpretadora **continua fechada**: chave desconhecida rejeita a entrada
  inteira;
- `CAMPOS_PERMITIDOS`, `CONFIRMACOES_PERMITIDAS`, `INTENCOES_PERMITIDAS` e
  `PERIODOS_PERMITIDOS` **não mudam** (não-regressão do vocabulário fechado).

### Contra a IA real (script avulso, mesmo padrão dos anteriores)

- **o caso que falhou no WhatsApp real:** histórico terminando em "Posso confirmar sua
  limpeza para amanhã às 14h?" + mensagem atual **"Sim"** → `confirmacao = sim`. Reprodução
  **obrigatória** antes de considerar esta spec resolvida;
- mesmo caso com "Pode ser", "Isso mesmo", "Fechado" — variações naturais, nunca testadas
  por igualdade de string;
- **referência a vários turnos atrás:** o paciente menciona algo dito no 2º par de um
  histórico de 8 → a resposta demonstra continuidade real (é o teste que justifica N=10 em
  vez de N=1);
- **negativo — sem contexto:** histórico ausente + "Sim" isolado → continua
  `nao_compreendida`. Sem contexto a ambiguidade é real; comportamento correto, não
  regressão;
- **negativo — contexto errado:** último par é uma pergunta sobre **procedimento** (não
  sobre confirmação) + "Sim" → **não** emite `confirmacao = sim`. Prova de que é
  compreensão real, não reflexo de palavra;
- **negativo — a guarda não afrouxa:** com 10 turnos de histórico contendo horários já
  citados, a redatora continua sem citar horário fora dos fatos autorizados do turno atual.

## 11. Fora desta V1

- **Qualquer sanitização, mascaramento ou minimização de PII no histórico** — decidido em
  0.1. Volta como **item de agenda da spec de cadastro**, quando a Iris passar a solicitar
  CPF, data de nascimento e e-mail rotineiramente. **Não é pré-condição de funcionamento da
  Iris** e não bloqueia nada aqui.
- **Cancelamento e remarcação** — etapa própria, por decisão do Gabriel.
- **"Não sei qual extração" → avaliação/consulta** — pendência real e já identificada, mas é
  mudança de **decisão do Core**, não de memória. Rodada própria, depois desta.
- **Investigação da regressão "Extração de dente"** (o fluxo que avançou para data/horário e
  depois voltou a perguntar procedimento) — **explicitamente parada** por ordem do Gabriel
  até esta base estar fechada. Motivo declarado: com a interpretadora cega por turno, não dá
  para distinguir bug real de limitação conhecida. Assim que o histórico estiver ligado, a
  conversa é **repetida do zero** e só então a investigação faz sentido.
- Histórico maior que 10, resumo de conversa, janela adaptativa, busca semântica. N=10 é
  definitivo até o Gabriel dizer o contrário.
- `clima_da_conversa` ou qualquer classificação nova de tom — os modelos leem o texto cru e
  percebem tom sozinhos.
- Qualquer mudança em interpretação de catálogo, disponibilidade, reserva, RPC ou painel.
- Registro de entrega/leitura da mensagem no WhatsApp.
- Persistir mensagens numa tabela própria de histórico. A coluna em `estado_conversa` é
  suficiente para N=10 e não cria nada novo — uma tabela seria a camada extra que a
  filosofia do projeto manda evitar sem necessidade comprovada.
