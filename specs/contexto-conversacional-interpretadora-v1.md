# Contexto conversacional para a IA interpretadora — V1

> **SUPERADA em 2026-08-07 por `specs/historico-conversacional-v1.md`** (implementada e
> em produção) — **absorvida inteira**, nunca implementada neste formato. Esta spec
> propunha o mesmo diagnóstico (o "Sim" isolado virando `nao_compreendida`) com memória de
> **1** turno; a spec nova generaliza para **10** turnos e mantém a mesma reversão
> declarada de `memoria-conversacional-minima-v1.md`. O problema com evidência real e o
> princípio ("a interpretadora nunca interpreta a mensagem atual isoladamente") foram
> reproduzidos lá, seção 6.

**Status:** proposta para revisão. Não implementada. Não autoriza código, migration,
alteração de banco, painel ou n8n.

## Problema, com evidência real

Teste real no WhatsApp, 2026-08-07: o paciente respondeu **"Sim"** a uma pergunta da
Iris. A IA que interpreta a mensagem (a que lê, não a que fala) classificou como
`nao_compreendida`, e a Iris respondeu "não consegui entender sua última mensagem".

Causa confirmada: a IA interpretadora recebe **somente a mensagem atual**, isolada —
nem mesmo a pergunta que a própria Iris acabou de fazer. Sem saber a que "Sim" está
respondendo, a mensagem é genuinamente ambígua para ela, e a instrução vigente ("em
dúvida real, nunca adivinhe") corretamente a leva a `nao_compreendida`.

Isso é diferente do problema que `ultima_troca` (specs/memoria-conversacional-minima-v1.md)
já resolveu: aquela spec deu memória de um turno **à IA que fala** (para soar natural,
lembrar o que ela mesma disse). A IA que **entende** continua sem nenhuma memória — as
duas metades da conversa não estão no mesmo nível.

## Princípio (correção do Gabriel, 2026-08-07 — vale como regra permanente)

**A correção não é ensinar o que uma palavra significa.** Não se trata de adicionar uma
regra "quando o texto for 'sim', trate como confirmação". Isso seria voltar ao padrão
de regra-por-exemplo que já foi corrigido nesta mesma IA (specs/resposta-conversacional-v1.md,
regra de confirmação por significado).

A correção é dar à interpretadora o **contexto que falta** — o que a Iris acabou de
dizer — e confiar na compreensão geral de linguagem dela pra interpretar a mensagem
atual em relação a esse contexto, exatamente como uma pessoa entenderia numa conversa
real. Ausência de contexto é o defeito; a inteligência pra usar esse contexto já existe
no modelo, só não estava recebendo a informação.

## Mudança de invariante anterior — declarada explicitamente

`specs/memoria-conversacional-minima-v1.md` estabeleceu: **"ultima_troca NUNCA vai para
a IA interpretadora"** — decisão correta no contexto daquela spec (o problema resolvido
ali era só o de fala natural, não o de compreensão). A evidência real de hoje muda esse
contexto: esta spec **reverte especificamente esse ponto**, com justificativa registrada
aqui, não em silêncio.

## Contrato

`EntradaInterpretacao` (interpretacao-tipos.ts) ganha um campo opcional:

```ts
export interface EntradaInterpretacao {
  // ... campos existentes, inalterados ...
  /**
   * O par (mensagem do paciente + resposta da Iris) do turno imediatamente
   * anterior, quando dentro da validade (mesmo filtro de 24h já usado pela
   * redatora — ultima-troca.ts). Serve exclusivamente para a interpretadora
   * entender mensagens curtas ou dependentes de contexto ("sim", "esse
   * mesmo", "pode ser") -- nunca autoriza um dado novo por si só; o campo
   * resultante (ex.: confirmacao) continua sujeito ao mesmo vocabulario
   * fechado de sempre.
   */
  ultima_troca?: { mensagem_paciente: string; resposta_iris: string };
}
```

Sem `gerada_em`: a interpretadora não precisa da marca de tempo (o filtro de validade
já foi aplicado antes, na leitura — mesma função `ultimaTrocaValidaParaEnvio` que a
redatora já usa, reaproveitada, não duplicada).

## Leitura e threading

`orquestrador.ts` já lê `identificacao.conversa.ultima_troca` hoje (só para expor em
`ResultadoOrquestrador`, nunca repassado adiante). Passa a também aplicar o filtro de
validade e, quando presente, repassar para `interpretarEAplicar` — exatamente o mesmo
padrão já usado para `horarios_oferecidos`/`proposta_pendente`:

```ts
const ultimaTrocaParaInterpretacao = ultimaTrocaValidaParaEnvio(identificacao.conversa.ultima_troca, Date.now());

const interpretacao = await interpretarEAplicar(clienteModelo, clienteBanco, {
  // ... campos existentes ...
  ...(ultimaTrocaParaInterpretacao !== undefined
    ? { ultima_troca: { mensagem_paciente: ultimaTrocaParaInterpretacao.mensagem_paciente, resposta_iris: ultimaTrocaParaInterpretacao.resposta_iris } }
    : {}),
});
```

Mesma disciplina já estabelecida: nunca `null`, campo ausente quando não há turno
anterior válido; nenhuma releitura extra; nenhuma chamada a banco adicional (o valor já
veio de `identificarConversa`).

## Instrução — UMA regra, por princípio, não por palavra

Adicionado a `interpretacao-instrucoes.ts`, uma única regra nova:

> Quando "ultima_troca" estiver presente, ela mostra a última pergunta ou frase que
> você (Iris) disse ao paciente. Use esse contexto para entender mensagens curtas ou
> que só fazem sentido em resposta a ela — exatamente como uma pessoa entenderia numa
> conversa real, nunca mecanicamente por palavra isolada. Ausência de "ultima_troca"
> significa que não há contexto imediato disponível — nesse caso, a regra de dúvida
> real continua valendo normalmente.

**Não** lista palavras-gatilho ("sim", "ok", "pode ser"). **Não** cria vocabulário
fechado novo. Os campos que a interpretadora pode preencher e os valores permitidos
(`confirmacao` continua só `'sim'`, por exemplo) **não mudam** — a única mudança é que
ela agora tem informação suficiente pra chegar à classificação correta com confiança,
em vez de cair em dúvida por falta de contexto.

## O que NÃO muda

- Nenhum novo campo em `alteracoes` nem em `CAMPOS_PERMITIDOS`.
- Nenhuma mudança em `CONFIRMACOES_PERMITIDAS`/`INTENCOES_PERMITIDAS`/vocabulário fechado.
- A interpretadora continua nunca resolvendo contra catálogo, nunca decidindo o próximo
  estado da conversa, nunca emitindo texto de resposta.
- Redatora, guarda, Core, disponibilidade, reserva: inalterados.

## Testes obrigatórios

**Determinísticos:**
- `ultima_troca` ausente na conversa → campo ausente no payload da interpretadora
  (nunca `null`).
- `ultima_troca` expirada (> 24h) → ausente no payload (mesmo filtro já testado em
  `gerar-resposta-conversacional`, reaplicado aqui).
- `ultima_troca` válida → presente no payload, exatamente `{mensagem_paciente,
  resposta_iris}`, sem `gerada_em`.
- **Reverte** o teste existente "ultima_troca nunca vai para a IA interpretadora"
  (`ultima-troca-integrado.test.ts`) — passa a afirmar o oposto, com o motivo da
  mudança documentado no próprio teste.

**Contra a IA real (script avulso, mesmo padrão dos anteriores):**
- `ultima_troca = {resposta_iris: "Posso confirmar sua limpeza para amanhã às 14h?"}`,
  mensagem atual = **"Sim"** → `confirmacao = sim`. Este é o caso exato que falhou no
  WhatsApp real — reprodução obrigatória antes de aprovar a spec como resolvida.
- Mesmo teste com "Pode ser", "Isso mesmo", "Fechado" — variações naturais, nunca uma
  lista fechada testada por igualdade de string.
- **Negativo:** `ultima_troca` ausente + mensagem atual "Sim" isolada → continua
  `nao_compreendida` (sem contexto, a ambiguidade real permanece — comportamento correto,
  não uma regressão).
- **Negativo:** `ultima_troca.resposta_iris` = uma pergunta sobre procedimento (não
  sobre confirmação) + mensagem atual "Sim" → não deve emitir `confirmacao = sim` fora
  de contexto de confirmação (prova de que é compreensão real, não reflexo de palavra).

## Fora desta V1

- Histórico com mais de um turno (mesmo limite já estabelecido para `ultima_troca` em
  geral — um único par, nunca acumula).
- Qualquer mudança na redatora, guarda ou Core.
- Revisão geral do restante de `interpretacao-instrucoes.ts` (ex.: a regra de
  `natureza_mensagem`, outras regras por exemplo) — fica para rodada própria, já
  sinalizada anteriormente, não misturada aqui.
