# Resolução semântica de procedimento — V1

**Status:** proposta para revisão. **Não implementada.** Não autoriza código, migration,
alteração de banco, painel ou n8n.

**Princípio definitivo (Gabriel, 2026-08-08):**

> **A interpretadora entende. O Core confere e executa.**
>
> A interpretadora recebe o catálogo ativo mínimo da clínica, interpreta semanticamente a
> linguagem do paciente e devolve `procedimento_id`. O Core apenas confere que o ID
> existe, pertence à clínica e está ativo. **O Core não volta a interpretar texto.**

## Problema

Hoje o paciente precisa, na prática, adivinhar o nome cadastrado no Painel. `resolver-
procedimento.ts` exige **igualdade exata** (após normalização) contra os nomes oficiais
mais um mapa manual de sinônimos. Evidência real (WhatsApp, 2026-08-07): o catálogo tem
`"Consulta / Avaliação"` como único nome de `consultation_evaluation`; o paciente disse
`"Avaliação né"`; nunca resolveu, e a conversa travou em `aguardando_procedimento`.

Corrigir isso com mais sinônimos é uma lista que cresce para sempre e nunca cobre
`"quero que o dentista dê uma olhada"`. A correção é estrutural: quem entende linguagem
é a IA, não uma tabela de strings.

## Fluxo

**Antes:** `texto → procedimento_texto cru → match exato contra aliases → falhou → pergunta de novo`

**Depois:** `mensagem + contexto + catálogo ativo → IA interpreta → procedimento_id → Core valida integridade → segue`

**Nenhuma chamada de IA nova.** É a mesma chamada de interpretação que já existe, com
mais entrada e um campo de saída diferente.

---

## 1. Entrada: catálogo ativo mínimo

`EntradaInterpretacao` ganha um campo opcional:

```ts
procedimentos_disponiveis?: { procedimento_id: string; nome_pt: string }[];
```

Somente `ativo === true`, somente da clínica da conversa. **Nada além dos dois campos** —
sem preço, duração, dentista, ou qualquer dado de outra clínica. Mesma disciplina de
minimização já vigente. AUSENTE (nunca `[]`) quando não há catálogo.

### Mudança de ordem no orquestrador — única alteração estrutural

`carregarCatalogo` roda hoje **depois** de `interpretarEAplicar` ([orquestrador.ts:126](src/core/orquestrador.ts:126)).
Precisa subir para antes.

> **Carregar cedo, checar tarde.** A verificação de `clinica_sem_catalogo` **permanece
> exatamente onde está**, depois do early-return conversacional. Se ela subisse junto,
> uma saudação numa clínica sem catálogo passaria a devolver erro técnico em vez de
> cumprimentar — regressão silenciosa.

Custo aceito: uma consulta a mais nos turnos puramente conversacionais (saudação, dúvida,
desistência), que hoje pulam o catálogo.

## 2. Saída: `procedimento_id` como campo comum

**Sem tipo novo, sem schema novo, sem mecanismo novo.** `procedimento_id` entra em
`CAMPOS_PERMITIDOS` no lugar de `procedimento_texto`, e herda de graça tudo que já
existe: `informar`/`corrigir`/`remover`, `preAplicar` (conflito quando o paciente muda de
ideia), `aplicarDados`, persistência, CAS.

**Detalhe que não pode passar:** o schema enviado à OpenAI
(`SCHEMA_PORTATIL_APROVADO`, [cliente-modelo-openai.ts:44](src/core/cliente-modelo-openai.ts:44))
tem a lista dos 11 campos **hardcoded**, separada de `CAMPOS_PERMITIDOS` — precisa ser
alterada no mesmo commit, ou o modelo continua obrigado a emitir `procedimento_texto`.

`valor` continua string livre no schema (não há enum por campo lá; `periodo`/`intencao`/
`confirmacao` sempre foram validados em **código**). Portanto a garantia de que o ID é
real vem da validação do Core — exatamente como o princípio exige.

## 3. Instrução — a regra atual se divide

Hoje: *"Procedimento e dentista são sempre preservados como texto mencionado pelo
paciente — nunca resolva contra nenhum catálogo."*

Passa a valer **só para dentista**. Para procedimento, regra nova:

> Quando "procedimentos_disponiveis" estiver presente, ele lista os procedimentos reais e
> ativos desta clínica. Entenda o que o paciente quer e preencha "procedimento_id" com o
> id correspondente da lista — pelo significado do que ele disse, nunca por semelhança de
> escrita. Se o paciente demonstrar que não sabe qual procedimento precisa e a lista
> contiver uma consulta ou avaliação, esse é o procedimento adequado. Em dúvida real
> sobre qual dos procedimentos ele quer, omita "procedimento_id" — nunca escolha por
> aproximação.

**Nenhuma lista de palavras. Nenhum exemplo de frase.** A última cláusula é a regra de
dúvida real que já existe para todos os campos, aplicada aqui.

## 4. Validação do Core — integridade, não interpretação

Substitui a chamada a `resolverProcedimento` por, em essência:

```ts
const procedimento = catalogo.procedimentos.find(
  (p) => p.procedimento_id === dados.procedimento_id && p.clinica_id === clinicaId
);
if (!procedimento || !procedimento.ativo) return { tipo: 'aguardando_procedimento' };
```

Três conferências: **existe / mesma clínica / ativo**. Não normaliza, não compara texto,
não relê a mensagem. ID ausente, inexistente ou inativo → `aguardando_procedimento`, o
mesmo desfecho de hoje. **Nunca pior que o comportamento atual.**

Os quatro motivos internos de `aguardando_procedimento` já eram *equivalentes perante o
paciente* por decisão de spec (a mesma pergunta sai para todos), então colapsá-los não
muda nada do que o paciente vê.

## 5. Consulta/Avaliação e ambiguidade — nada a construir

**Consulta/Avaliação:** nenhum fallback, nenhuma flag, nenhum estado. A IA lê
`"Consulta / Avaliação"` na lista e entende que é isso que serve para quem não sabe o que
precisa. É só a frase da instrução (seção 3).

**Ambiguidade:** nenhum estado novo. A regra "em dúvida real, omita" já produz o
comportamento desejado — sem `procedimento_id`, o fluxo cai em `aguardando_procedimento`,
que já existe, e a Iris pergunta. `aguardando_escolha_procedimento`,
`escolher_entre_procedimentos` e `procedimentos_candidatos` **permanecem dormentes** — não
são ativados por esta spec.

---

## 6. O que é REMOVIDO

Nada fica "por segurança". Se ficou sem consumidor, sai.

### Arquivos apagados por completo

| Arquivo | Linhas |
|---|---|
| `src/core/resolver-procedimento.ts` | 258 |
| `src/core/resolver-procedimento.test.ts` | 720 |
| `supabase/functions/iris-nova-mensagem/resolver-procedimento.ts` | 258 |

### Peças removidas de arquivos que permanecem

- **`SINONIMOS_INFORMAIS`** (`carregar-catalogo.ts`) — some inteiro, incluindo o
  `'avaliação'` adicionado em 2026-08-08, que esta spec torna desnecessário.
- **Loop que transforma os 8 nomes multilíngues em aliases** (`montarProcedimentos`).
  `nome_pt` continua existindo — agora como texto que a IA **lê**, não como chave de match.
- **`aliasesProcedimento`** — do retorno de `carregarCatalogo` e de `CatalogoClinica`
  (`orquestrador-tipos.ts`).
- **`AliasProcedimento`** (tipo) e **`EntradaResolucaoProcedimento`**.
- **`ResultadoResolucaoProcedimento`**, **`MotivoNaoResolvido`**,
  **`CodigoErroCatalogoProcedimento`** — toda a taxonomia de erro textual
  (`alias_ambiguo`, `alias_orfao`, `alias_clinica_divergente`,
  `procedimento_id_inconsistente`, `sem_correspondencia`, `alias_inativo`,
  `texto_ausente`) fica inalcançável.
- **`alias_normalizado`** — campo de resultado sem sentido sem aliases.
- **`eh_consulta_avaliacao`** — confirmado sem nenhum consumidor de decisão: hoje é
  `false` hardcoded em `carregar-catalogo.ts:146` e só trafega. Sai de
  `ProcedimentoOficial`.
- **`procedimento_texto`** — de `CampoDadosConversa`, `CAMPOS_PERMITIDOS`,
  `CAMPOS_OPERACIONAIS_INTERPRETACAO` e do enum hardcoded do schema.
- **Decisão `erro_catalogo_procedimento`** — inalcançável sem aliases. Sai de
  `DecisaoOrquestrador` e dos três switches exaustivos que a tratam
  (`contexto-horarios.ts`, `fatos-autorizados.ts`, `gerar-resposta-paciente.ts`). Os
  switches são exaustivos: o compilador garante que nada fica órfão.
- **`aguardando_procedimento`** deixa de carregar `resultado: ResultadoResolucaoProcedimento`
  — passa a ser `{ tipo: 'aguardando_procedimento' }`, sem payload.
- **Testes de alias** em `carregar-catalogo.test.ts` (os 3, incluindo os 2 de
  `"avaliação"` escritos hoje).

`procedimento-tipos.ts` encolhe de **127 para ~10 linhas** (só `ProcedimentoOficial`,
sem `eh_consulta_avaliacao`).

**Saldo: ~1.300 linhas removidas contra ~40 adicionadas.**

### O que NÃO é tocado

- **`resolverDentista`** e toda a resolução de dentista — decisão explícita do Gabriel:
  não abrir essa frente agora; se houver rigidez, tratar depois **com evidência**.
- **`normalizarTextoCanonico`** — continua servindo o dentista.
- **Disponibilidade, reserva, duração, temporal** — operam sobre `procedimento_id` já
  resolvido, indiferentes a como ele chegou.
- **Nenhuma migration.** A RPC `aplicar_interpretacao_condicional` tem uma lista de
  campos hardcoded no Postgres, **mas não está no caminho ativo** (o fluxo usa
  `aplicarDados` em TypeScript). Fica registrada como divergência conhecida, não como
  bloqueio — ver "Fora desta V1".

## 7. Sem compatibilidade temporária

Decisão explícita do Gabriel: **nenhum código de transição.** `procedimento_texto` deixa
de existir; conversas de teste em andamento perdem o procedimento e são recomeçadas. Todo
o ambiente é de teste ([[iris-nova-ambiente-todo-teste]]), então o custo é zero e evita
carregar um ramo duplo para sempre.

## 8. Testes obrigatórios

**Determinísticos:**
- catálogo ativo chega à interpretadora como `procedimentos_disponiveis`, só com
  `{procedimento_id, nome_pt}`, só ativos, só da clínica;
- clínica sem catálogo → chave **ausente** no payload (nunca `[]`);
- saudação numa clínica sem catálogo continua devolvendo `saudacao`, **não**
  `clinica_sem_catalogo` (prova do "carregar cedo, checar tarde");
- `procedimento_id` válido → segue o fluxo normalmente;
- `procedimento_id` inexistente → `aguardando_procedimento`;
- `procedimento_id` de **outra clínica** → `aguardando_procedimento` (isolamento);
- `procedimento_id` **inativo** → `aguardando_procedimento`;
- `procedimento_id` ausente → `aguardando_procedimento`;
- correção (`corrigir`) de `procedimento_id` substitui o anterior, mesma mecânica de antes.

**Contra a IA real (script avulso):**
- **o caso que falhou no WhatsApp:** `"Avaliação né"` → `consultation_evaluation`;
- `"não sei o que preciso"`, `"quero que o dentista dê uma olhada"`, `"uma consulta
  normal"`, `"o dentista que decida"` → todos `consultation_evaluation`, sem nenhuma
  lista de frases no prompt;
- `"quero limpeza"` → `cleaning` (não regride o que já funcionava);
- **negativo:** pedido genuinamente ambíguo entre dois procedimentos reais do catálogo →
  `procedimento_id` **omitido**, nunca escolhido por aproximação;
- **negativo:** procedimento que não existe no catálogo da clínica → omitido, nunca
  aproximado para o "mais parecido".

## 9. Fora desta V1

- **Resolução semântica de dentista** — não abrir sem evidência própria.
- **Sincronizar a lista de campos da RPC `aplicar_interpretacao_condicional`** com
  `CAMPOS_PERMITIDOS`. Divergência conhecida e registrada; a RPC não está no caminho
  ativo. Tratar quando (e se) ela voltar a ser usada.
- Cancelamento, remarcação, avaliação como etapa de plano de tratamento
  ([[iris-nova-visao-avaliacao-odontograma-orcamento]]).
- Qualquer mudança em disponibilidade, reserva ou painel.
