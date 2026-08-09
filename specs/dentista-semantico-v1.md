# Resolução semântica de dentista + preferência que prevalece — V1

**Status:** proposta para revisão. **Não implementada.** Não autoriza código, migration,
alteração de banco, painel ou n8n.

Adere a `docs/00-principios.md`. Aplica o mesmo princípio já aprovado em
`specs/procedimento-semantico-v1.md`:

> **A interpretadora entende. O Core confere e executa.**

E acrescenta uma decisão de produto nova (Gabriel, 2026-08-09):

> **A preferência explícita de dentista prevalece.** Quando o paciente escolhe um
> profissional, é o *procedimento* que cede — nunca o profissional escolhido, e nunca em
> silêncio.

## Problema

Dois problemas independentes, resolvidos juntos porque a correção de um dissolve o outro.

**1. Resolução textual rígida.** `resolverPorPreferencia` exige igualdade exata (após
normalização) contra `nome_completo_resolucao` ou `nome_curto_resolucao`. No dado real da
clínica ativa, as entradas são `"Dr. Carlos Turiak"` e `"Carlos Turiak"` — dizer
`"Carlos"` ou `"o Dr. Carlos"` **não resolve**. É a mesma rigidez que travou
`"Avaliação né"`.

**2. Descarte silencioso da preferência.** Quando a preferência não resolve,
`resolverDentistaComFallback` ([orquestrador.ts:449](src/core/orquestrador.ts:449))
reaplica a resolução **sem preferência** e segue com quem sobrar. O fato de ter havido
uma preferência é destruído ali: nenhuma decisão o carrega, `dentista_resolvido` nunca é
populado, e **nenhum texto ao paciente nomeia o dentista**. Ele pede um profissional e é
agendado com outro, sem saber.

A spec vigente (`dentistas-vinculos-v1.md` §4) manda *"informar que o profissional não foi
localizado"* antes de continuar — essa metade nunca foi implementada.

---

## 1. Entrada: dentistas ativos da clínica

`EntradaInterpretacao` ganha um campo opcional, simétrico a `procedimentos_disponiveis`:

```ts
dentistas_disponiveis?: { dentista_id: string; nome_exibido: string }[];
```

Somente `ativo === true`, somente da clínica da conversa. Nada além dos dois campos.
AUSENTE (nunca `[]`) quando não há nenhum ativo. Nome de dentista é dado de catálogo, não
PII do paciente — a disciplina de minimização não é afetada.

### Por que a lista NÃO é filtrada por aptidão

Aptidão é `vínculo(dentista, procedimento)`, e o `procedimento_id` só existe **depois** da
interpretação. Em `"quero implante com a Vanessa"` não sabemos, ao montar o payload, que é
implante. Filtrar exigiria uma segunda chamada de IA (proibida) ou dois comportamentos
conforme o procedimento já estivesse ou não em `dados` — duas arquiteturas no mesmo fluxo.

E filtrar seria **pior**: a Vanessa sumiria da lista, a IA omitiria o campo, e o Core
seguiria com outro dentista em silêncio — o bug de origem, de volta. Com a lista completa,
a IA devolve o id dela, o Core reprova por falta de vínculo, e existe um fato concreto
para informar. **A lista não-filtrada é a mais honesta.**

O `catalogoCarregado` já é lido antes da interpretação desde
`procedimento-semantico-v1.md` — **nenhuma mudança de ordem é necessária**.

## 2. Saída: `dentista_id` como campo comum

`dentista_id` entra em `CAMPOS_PERMITIDOS` no lugar de `dentista_texto`, e herda de graça
`informar`/`corrigir`/`remover`, `preAplicar`, `aplicarDados`, persistência e CAS.

**Mesmo detalhe que quase passou na rodada anterior:** o enum de campos em
`SCHEMA_PORTATIL_APROVADO` ([cliente-modelo-openai.ts:44](src/core/cliente-modelo-openai.ts:44))
é hardcoded, separado de `CAMPOS_PERMITIDOS`. Precisa ser alterado no mesmo commit.

## 3. Instrução

A regra atual — *"Dentista é sempre preservado como texto mencionado pelo paciente — nunca
resolva contra nenhum catálogo"* — é **substituída**:

> Quando "dentistas_disponiveis" estiver presente, ele lista os profissionais ativos desta
> clínica, cada um com seu "dentista_id" e o nome exibido. Entenda a quem o paciente está
> se referindo e preencha "dentista_id" com o id correspondente da lista — pelo
> significado, nunca por semelhança de escrita. Um primeiro nome, um sobrenome ou o nome
> com ou sem título identificam a mesma pessoa quando só há um candidato plausível. Em
> dúvida real entre dois ou mais profissionais da lista, omita "dentista_id" — nunca
> escolha por aproximação. Quando "dentistas_disponiveis" não estiver presente, nunca
> emita "dentista_id".

Nenhuma lista de nomes, nenhum exemplo de frase, nenhum tratamento de título.

## 4. Ambiguidade real — nada a construir

Dois "Carlos" plausíveis → a IA omite `dentista_id` (a regra de dúvida real que já governa
todos os campos) → o Core não vê preferência → aplica zero/um/vários aptos → com dois
aptos cai em **`aguardando_escolha_dentista`**, decisão que **já existe, já lista os
`nome_exibido` e hoje é inalcançável em produção**.

O caso raro não custa uma linha de arquitetura: ele ativa um caminho que já construímos e
nunca foi usado.

---

## 5. Validação do Core e as duas regras de produto

`CONSULTA_AVALIACAO_ID = 'consultation_evaluation'` — **constante canônica** no Core.
`procedimentos_catalogo` é uma tabela **global** (não tem `clinica_id`), então o id é
estável para todas as clínicas. Não é match textual: é um identificador opaco fixo.

> **Por que não uma coluna.** `eh_consulta_avaliacao` nunca existiu no banco; antes da
> remoção de 2026-08-08 era `false` hardcoded para todos os procedimentos, logo o fallback
> do §12 já era inalcançável. Identificar por nome é impossível: quatro procedimentos do
> catálogo casariam (`pedo_consult`, `consultation_evaluation`, `implant_consult`,
> `ortho_consult`). Decisão do Gabriel (2026-08-09): constante, sem coluna, sem migration.

### CASO 1 — sem `dentista_id`

Exatamente `calcularAptidao`, que já existe:

| Aptos | Desfecho |
|---|---|
| zero | `sem_dentista_disponivel` — a resposta oferece Consulta/Avaliação |
| um | segue direto, sem perguntar |
| vários | `aguardando_escolha_dentista` |

**Nenhum mecanismo novo, nem para o zero.** A oferta de avaliação é honrada pelo turno
seguinte: o paciente responde "pode ser", e a interpretadora — que recebe o histórico com
a oferta e `procedimentos_disponiveis` — devolve `consultation_evaluation` pelo caminho
normal. A aceitação exigida por `04-decisoes-canonicas.md` continua acontecendo: é uma
resposta do paciente, não uma substituição automática.

> A pergunta *"Posso verificar uma Consulta/Avaliação em vez disso?"*
> ([gerar-resposta-paciente.ts:94](src/core/gerar-resposta-paciente.ts:94)) existe desde
> 2026-08-06 e **não levava a lugar nenhum** — nada aceitava a resposta. Ela passou a
> funcionar sozinha quando o procedimento semântico entrou em produção. Precisa de teste
> contra a IA real (seção 8), não de código.

### CASO 2 — com `dentista_id` válido

Ordem exata da conferência, depois de validar identidade/clínica/ativo:

1. **Tem vínculo ativo com o procedimento** → segue com o par pedido. Nada novo.
2. **Não tem vínculo, e o procedimento já é `consultation_evaluation`** → `combinacao_indisponivel`.
   Não oferece avaliação de novo, não cria ciclo, não sugere outro profissional
   (`dentistas-vinculos-v1.md` §12 regra 1, preservada).
3. **Não tem vínculo, procedimento é outro** → o procedimento cede:
   - conferir que `consultation_evaluation` existe e está ativo;
   - conferir que **este mesmo dentista** tem vínculo ativo com ele;
   - se ambos → seguir com `consultation_evaluation` + o dentista escolhido, **informando
     a troca**, sem nova pergunta de aceitação;
   - se qualquer um falhar → `combinacao_indisponivel`, sem inventar outro profissional.

`dentista_id` inexistente, de outra clínica ou inativo colapsa em "sem preferência"
(CASO 1) — mesma disciplina de `procedimento_id` inválido. A IA escolhe de uma lista real,
então é um caso de integridade, não de conversa.

### A substituição não é persistida

`dados.procedimento_id` continua com o que o paciente pediu; a troca vale só para este
turno. É idempotente (o turno seguinte re-deriva o mesmo resultado), preserva a intenção
original, e evita uma escrita. A reserva é criada com o id efetivamente resolvido.

### O fato de informar

A troca precisa chegar à redatora. Uma única adição, e é honesta reconhecê-la como
**adição**, não remoção:

```ts
// ResultadoOrquestrador
substituicao_por_avaliacao?: { dentista_nome_exibido: string };
```

Repassada a `derivarFatosAutorizados` para virar fato autorizado. **Não** é estado novo,
não é decisão nova, não é pergunta nova.

### Uma única decisão terminal (decisão do Gabriel, 2026-08-09)

Os casos 2.2 e 2.3-falho **não têm nenhuma diferença operacional**: nos dois o Core não
consulta disponibilidade, não reserva, não troca de profissional, não faz pergunta, e
`derivarAcaoContextoHorarios` grava `limpar`. A única diferença seria a frase.

Portanto: **uma decisão só**, `combinacao_indisponivel`, carregando o
`dentista_nome_exibido`. A redatora adapta o texto pelos fatos — ela já recebe a mensagem
crua do paciente, então sabe o que ele pediu sem que o Core precise transportar essa
nuance. Duas decisões aqui seriam duas frases fingindo ser dois estados.

---

## 6. O que é REMOVIDO e o que é ALTERADO

### Removido — código

| Peça | Onde |
|---|---|
| `resolverPorPreferencia` inteira (~65 linhas) | `resolver-dentista.ts:82-146` |
| Ramo de preferência em `resolverDentista` | `resolver-dentista.ts:64-71` |
| `resolverDentistaComFallback` — a recursão inteira | `orquestrador.ts:435-468` |
| `preferencia_apta`, `preferencia_nao_encontrada`, `preferencia_nao_apta` | `dentista-tipos.ts` |
| `MotivoPreferenciaNaoApta` (3 motivos) | `dentista-tipos.ts:94` |
| `nome_resolucao_ambiguo` | `dentista-tipos.ts:103` |
| `nome_completo_resolucao`, `nome_curto_resolucao` | `dentista-tipos.ts` + `carregar-catalogo.ts:180-181` |
| `dentista_texto` | `tipos.ts`, `aplicar-dados.ts`, `interpretacao-tipos.ts`, enum do schema |
| Testes de match textual e colisão | `resolver-dentista.test.ts` (43 ocorrências) |

**`resolverDentista` NÃO é apagado.** Ao contrário de `resolver-procedimento.ts`, aqui o
match textual é a minoria. Permanece e continua sendo do Core: `calcularAptidao`
(zero/um/vários), `validarConsistenciaDeIdentidade`, isolamento multiclínica. Isso é
integridade, não interpretação.

`normalizarTextoCanonico` **permanece** — ainda serve o temporal.

### Removido — três códigos de erro inalcançáveis (auditados 2026-08-09)

Os três critérios exigidos foram verificados um a um.

**Produtor único.** `carregarCatalogo` é o **único** produtor de `CatalogoClinica` em
produção. `resolverDentista` tem **um único chamador**, `orquestrador.ts`, que passa
`catalogo.dentistas`/`catalogo.vinculos`. Nenhum outro produtor, nem em `src/eval/`.

**Consumidor necessário.** Nenhum. Os três só alimentam `erro_catalogo_dentista`, que em
`gerar-resposta-paciente.ts:97` compartilha a frase genérica de falha técnica com outros
quatro estados — nenhum texto, fato ou ramo depende de distingui-los.

| Código | Veredito | Prova |
|---|---|---|
| `vinculo_orfao` | **inalcançável — remover** | Todo vínculo é empurrado dentro do mesmo laço que empurra o dentista, com o mesmo `dentistaId`. `registros.length === 0` nunca ocorre. |
| `vinculo_clinica_divergente` | **inalcançável — remover** | Mesma razão: `clinica_id` é carimbado igual em dentista e vínculo, na mesma iteração. |
| `vinculo_inconsistente` | **inalcançável — remover** | [carregar-catalogo.ts:201](src/core/carregar-catalogo.ts:201) empurra **sempre** `ativo: true`. A chave pode repetir; o valor divergente, não. |
| `dentista_id_inconsistente` | **alcançável — mantém** | Dois registros com o mesmo `id` e conteúdo diferente são graváveis pelo Painel. Não há nenhum hoje (verificado no banco), mas nada impede. |

Removidos junto: `resolverIdentidadeDentista` deixa de precisar do parâmetro
`todosDentistas` (só existia para distinguir órfão de clínica divergente), e
`validarConsistenciaDeVinculos` sai inteira. `erro_catalogo` permanece, com **um** código.

### Alterado — decisões

- `aguardando_escolha_dentista` — inalterada, e passa a ser alcançável.
- `sem_dentista_disponivel` — inalterada.
- `erro_catalogo_dentista` — permanece, com a taxonomia reduzida a um código.
- **Uma decisão nova:** `combinacao_indisponivel`, com `dentista_nome_exibido`. Terminal,
  sem pergunta. Entra nos três switches exaustivos (`contexto-horarios.ts` → `limpar`,
  `fatos-autorizados.ts` → objetivo próprio, `gerar-resposta-paciente.ts` → texto de
  fallback). O compilador garante que nenhum fica órfão.

## 7. O que muda nas specs canônicas

### `docs/04-decisoes-canonicas.md` — duas substituições exatas

**(a) Bullet da aceitação, seção "Atendimento" (linha 43).**

Texto atual, a ser **substituído**:

> - **A Consulta/Avaliação somente substitui o procedimento com aceitação do paciente** —
>   nunca uma substituição automática/silenciosa.

Texto proposto:

> - **A Consulta/Avaliação somente substitui o procedimento com aceitação do paciente** —
>   nunca uma substituição automática/silenciosa. **Exceção única (09/08/2026):** quando o
>   paciente escolheu explicitamente um profissional que não realiza o procedimento
>   pedido, a substituição por Consulta/Avaliação **com esse mesmo profissional** dispensa
>   nova pergunta de aceitação — a Iris informa a troca na própria resposta. A troca nunca
>   é silenciosa; ela deixa de ser uma pergunta, não de ser comunicada. Trocar de
>   *profissional* continua proibido sem escolha do paciente.

**(b) Bullet do seletor, seção "Composição do novo agendamento" (linhas 70-73).**

Texto atual, a ser **substituído**:

> - **Consulta/Avaliação terá um seletor puro e específico**, futuro, que escolhe pelo
>   marcador oficial `eh_consulta_avaliacao`, exigindo exatamente um procedimento ativo
>   correspondente na clínica. Zero ou vários correspondentes são erro estrutural. Nunca
>   usa nome ou alias; não altera o resolvedor textual de procedimento já publicado.

Texto proposto:

> - **Consulta/Avaliação é identificada pelo ID canônico `consultation_evaluation`**
>   (09/08/2026). `procedimentos_catalogo` é global (sem `clinica_id`), então o ID é
>   estável em todas as clínicas. O Core confere apenas existência e `ativo`. **Nenhum
>   seletor, marcador ou coluna novo é criado**: `eh_consulta_avaliacao` nunca existiu no
>   banco — antes de 08/08/2026 era `false` hardcoded para todos os procedimentos, logo o
>   fallback que dependia dele sempre foi inalcançável. Identificação por nome permanece
>   proibida (quatro procedimentos do catálogo casariam). Uma coluna por clínica continua
>   possível como evolução futura, se o Painel precisar desse controle.

### `specs/dentistas-vinculos-v1.md` — alterações por seção

**§1 — Identidade.** Preservada integralmente. *"A Iris nunca identifica dentista pelo nome
exibido — toda resolução produz `dentista_id`"* continua verdadeiro, e mais do que antes: o
que chega ao Core é sempre o ID.

**§4 — Preferência do paciente. Inversão de prioridade.** As cinco obrigações atuais
(não selecionar profissional / não buscar em outra clínica / não revelar outra clínica /
informar que não foi localizado / continuar como sem preferência e reaplicar zero-um-vários)
tratam a preferência como **descartável**. Passa a valer:

- preferência **válida** (ID existe, mesma clínica, dentista ativo) **prevalece**; quem cede
  é o procedimento, nunca o profissional;
- sem vínculo com o procedimento pedido → Consulta/Avaliação **com o mesmo profissional**,
  informando; se nem isso for possível → informar e parar, **nunca** substituir o
  profissional;
- preferência **inválida** (ID inexistente, de outra clínica, ou inativo) → aí sim colapsa
  em "sem preferência" e reaplica zero/um/vários. Isso é integridade, não conversa.

Some a obrigação de "informar que o profissional não foi localizado" no sentido de *nome não
reconhecido* — não há mais match textual falhando. O dever de informar permanece, com outro
conteúdo: a troca de procedimento.

Preservado sem alteração: *"ausência de preferência não equivale a aceitar qualquer
profissional"* e o evento `aceitar_qualquer_profissional`, que continua dormente.

**§6 — Resolução do texto do dentista. Revogada por inteiro.** Saem: "entradas de resolução,
exatamente duas"; match exato após normalização; a regra de títulos e pontuação
(*"'Dra. Ana' e 'Ana' são entradas diferentes"*); e as três formas de colisão com suas
regras de falha. Substituída por: a interpretadora recebe `dentistas_disponiveis` e devolve
`dentista_id`; em dúvida real entre dois ou mais, omite e o Core pergunta pelo caminho já
existente.

> Nota a registrar na própria §6: a proibição de *fuzzy matching* e *aliases* **continua
> válida para o Core** — o que muda é que o Core deixou de fazer correspondência de texto,
> não que passou a fazê-la de forma aproximada.

**§12 — Consulta/Avaliação.** Três mudanças:
- **passo 2** — troca *"exatamente um procedimento ativo com `eh_consulta_avaliacao = true`"*
  pelo ID canônico `consultation_evaluation`, conferindo existência e `ativo`;
- **passo 5** — `aceitar_opcao` **revogado** no caso que preserva o dentista escolhido.
  Continua valendo no CASO 1 (zero aptos), onde a aceitação é a própria resposta do paciente
  no turno seguinte;
- **gatilho novo** — hoje a seção só cobre "zero dentistas aptos para o procedimento". O
  CASO 2 não é isso: há aptos, apenas não o escolhido. Precisa de um segundo gatilho,
  explicitamente distinto.

**§12 regra 1 — preservada e reforçada.** *"Só avaliar o fallback se o procedimento atual não
for, ele mesmo, Consulta/Avaliação"* é exatamente o que impede o ciclo no caso 2.2.

**§13 — Testes obrigatórios.** Saem seis itens, todos sobre match textual: as três colisões
(completo×completo, curto×curto, completo×curto), *"'Dra. Ana' e 'Ana' tratados como entradas
diferentes"*, *"nome curto e nome completo resolvendo o mesmo `dentista_id`"* e *"múltiplos
matches — erro de configuração"*. Entram os casos da seção 8 desta spec.

**§14 — Auditoria do legado.** A linha de `cappia__resolver_dentista` (*"reutilizar
conceitualmente — padrão nome completo + nome curto"*) deixa de descrever o alvo. Reclassificar
como referência histórica.

**§16 — Invariantes.** Saem duas: *"resolução de texto de dentista é determinística:
normalização fechada + match exato… nenhum fuzzy matching"* e *"colisão normalizada entre
entradas de resolução é erro de configuração"*. Entra uma: **preferência válida de dentista
prevalece sobre o procedimento pedido; o profissional escolhido nunca é substituído em
silêncio.** As demais permanecem.

## 8. Testes obrigatórios

**Determinísticos:**
- `dentistas_disponiveis` chega à interpretadora só com `{dentista_id, nome_exibido}`, só
  ativos, só da clínica; ausente (nunca `[]`) quando não há nenhum;
- `dentista_id` válido **com** vínculo → segue com o par pedido;
- `dentista_id` válido **sem** vínculo, procedimento comum → resolve
  `consultation_evaluation` **com o mesmo dentista**, e o fato da troca chega aos fatos
  autorizados;
- mesmo caso, mas o dentista **também** não tem vínculo com a avaliação →
  `combinacao_indisponivel`, **nunca** outro profissional;
- procedimento já é `consultation_evaluation` e o dentista não tem vínculo →
  `combinacao_indisponivel`, sem ciclo;
- **prova de que o profissional nunca é trocado:** numa clínica onde existe outro dentista
  apto para o procedimento pedido, o pedido por um dentista sem vínculo **nunca** produz
  uma decisão que aponte para o outro dentista;
- `dentista_id` inexistente / de outra clínica / inativo → tratado como sem preferência;
- sem `dentista_id`: zero aptos → `sem_dentista_disponivel`; um → segue; vários →
  `aguardando_escolha_dentista`;
- a substituição **não** grava `dados.procedimento_id`.

**Contra a IA real (script avulso, entradas realistas):**
- `"quero com o Carlos"` → o `dentista_id` de Dr. Carlos Turiak (hoje falha no match exato);
- `"prefiro a Vanessa"` → o `dentista_id` de Dra. Vanesa Vocaro;
- `"com a Dra. Vanesa Vocaro"` (nome exato) → mesmo id;
- **ambiguidade real:** dois candidatos plausíveis com o mesmo primeiro nome →
  `dentista_id` **omitido**, nunca escolhido por aproximação;
- **negativo:** nome que não corresponde a ninguém da lista → omitido;
- **negativo:** mensagem sem menção a profissional → omitido;
- **A/B isolado:** a mesma frase com e sem `dentistas_disponiveis` precisa **diferir** —
  sem a lista, nenhum `dentista_id` pode sair (princípio do teste isolado).
- **CASO 1 zero aptos, ciclo completo:** a Iris oferece a avaliação, o paciente responde
  `"pode ser"`, e o turno seguinte resolve `consultation_evaluation` — provando que a
  oferta deixou de ser uma promessa vazia.

## 9. Registro: vínculos inválidos da Dra. Vanesa Vocaro

**Não tratado nesta spec. Frente separada. Registrado aqui apenas porque afeta qualquer
teste que a envolva.**

Ela está ativa, mas seus 47 itens de procedimento **não têm o campo `id`** no jsonb
(`{nome, ativo, tempo}`) — os outros sete registros de dentista das duas clínicas têm
`{id, nome, ativo, tempo}`. `carregar-catalogo.ts:198` descarta itens sem id, e está
correto: casar por `nome` seria reintroduzir a resolução textual que apagamos.

**Consequência enquanto o dado não for corrigido:** ela tem zero vínculos, inclusive com
`consultation_evaluation`. Pedir por ela cai **sempre** em `combinacao_indisponivel`. O
comportamento estará certo pelo contrato desta spec, mas nenhum teste manual com ela
exercita o caminho feliz do CASO 2.

Enquanto isso, `aguardando_escolha_dentista` e o caso 2.3 bem-sucedido permanecem
**inalcançáveis com dado real** — só cobertos por teste determinístico. Corrigir o registro
no Painel é o que os destrava. Não misturar com esta rodada.

## 10. Sem compatibilidade temporária

Mesma decisão de `procedimento-semantico-v1.md`: **nenhum código de transição.**
`dentista_texto` deixa de existir; conversas de teste em andamento perdem a preferência de
dentista e são recomeçadas. Todo o ambiente é de teste, então o custo é zero.

## 11. Fora desta V1

- **Cadastro de paciente**, camada temporal, resumo antes da confirmação, limpeza de
  `dados` após a reserva, `confirmacao` obsoleta — achados registrados na auditoria de
  2026-08-09, cada um com frente própria.
- **Correção dos vínculos da Dra. Vanesa no Painel** (seção 9) — frente separada, não
  tratada aqui.
- Coluna `eh_consulta_avaliacao` — possível evolução, não necessária agora.
- `aceitar_qualquer_profissional` — permanece dormente; ausência de preferência continua
  não equivalendo a essa autorização (`dentistas-vinculos-v1.md` §4, preservado).
- Cancelamento, remarcação, avaliação como etapa de plano de tratamento.

---

## 12. Correlação com vários candidatos plausíveis — CONTRATO FECHADO (2026-08-09)

**Aprovado pelo Gabriel em 2026-08-09. Especificado, não implementado.**

### Por que o canal atual não serve

A IA expressa a preferência por um campo escalar, `dentista_id?: string`. Ele sabe dizer
"é este" ou nada — e o *nada* carrega três situações distintas.

| Caso | Frequência | Representável hoje? |
|---|---|---|
| Um candidato claro ("o Carlos") | comum | ✅ sim — provado 8/8 contra a IA real |
| Vários plausíveis ("a Vanessa", com duas Vanessas) | **comum** | ❌ não |
| Nenhum correspondente ("Dra. Beatriz") | raro | ❌ não |

**O limite é o canal, não o prompt** (medido 3/3 em 2026-08-09): diante de dois candidatos
o modelo devolve `"dent-carlos-turiak,dent-carlos-sanches"` — os dois ids concatenados. Não
*consegue* expressar ambiguidade num campo de valor único, então inventa um valor
malformado. O Core rejeita e o desfecho é seguro, mas a informação se perde.

### Saída: `dentistas_candidatos` como campo raiz

Não é alteração de dado — é o **resultado semântico da leitura da preferência**. Por isso
campo raiz, ao lado de `eventos_candidatos`, e não dentro de `alteracoes` (cujo contrato é
fechado a valores string com `informar`/`corrigir`/`remover`).

```ts
dentistas_candidatos?: string[];   // ids copiados LITERALMENTE de `dentistas_disponiveis`
```

| Valor | Significado |
|---|---|
| **ausente** | o paciente não mencionou profissional |
| `[]` | mencionou, mas nenhum dentista real da clínica corresponde |
| `[id]` | um candidato claro |
| `[id1, id2, …]` | vários plausíveis — a IA **não escolhe** |

`[]` não é um quarto mecanismo: é o resultado natural da mesma lista quando nada
corresponde.

### Decisão do Core: uma única regra de contagem

| Entrada | Decisão | Novo? |
|---|---|---|
| **ausente** | regra de zero/um/vários **aptos** de sempre (`dentistas-vinculos-v1.md` §5) | não |
| **`[id]`** | **CASO 2 da seção 5, intacto**: vínculo → segue; sem vínculo → avaliação com ele; nem isso → `combinacao_indisponivel` | não |
| **`[id1, id2, …]`** | não escolhe — `aguardando_escolha_dentista` com **somente esses** | sim |
| **`[]`** | não escolhe — `aguardando_escolha_dentista` com os **aptos reais**, mais o fato de não ter localizado. Sem apto nenhum → `sem_dentista_disponivel`, como hoje | sim |

**Os candidatos de `[N]` não são filtrados por aptidão.** Filtrar removeria justamente o
profissional que o paciente pediu — o defeito que esta spec existe para eliminar. O turno
seguinte resolve para um único candidato e o CASO 2 aplica a regra de vínculo normalmente,
inclusive a substituição por avaliação.

`aguardando_escolha_dentista` passa a poder carregar **um** elemento (hoje só ocorre com
≥2). É honesto: *"não encontrei a Dra. Beatriz; temos o Dr. Carlos Turiak — pode ser com
ele?"*

### Fato mínimo para a redatora

Um booleano, **derivado pelo Core**, nunca um sinal novo da IA:

```ts
preferencia_nao_localizada?: true;   // só quando dentistas_candidatos === []
```

`preferencia_nao_encontrada` **não volta como sinal da IA** (decisão explícita do Gabriel):
`dentistas_candidatos: []` já carrega essa informação, e o Core deriva o fato a partir dela.

### O que é REMOVIDO

- **`dentista_id` sai do enum do schema enviado à OpenAI.** A IA deixa de ter como emiti-lo:
  quem escreve esse campo passa a ser sempre o Core.
- **A regra de instrução sobre `dentista_id`** (duas cláusulas hoje) é substituída por uma
  sobre `dentistas_candidatos`.
- **O parâmetro `dentistaIdPedido`** de `resolverDentistaEProcedimento` dá lugar à lista.

**Não é removido:** `dentista_id` continua em `CAMPOS_PERMITIDOS` e em
`CAMPOS_OPERACIONAIS_INTERPRETACAO` — o Core precisa persistí-lo, e a IA precisa vê-lo em
`dados_atuais` como contexto do que já foi escolhido.

> **Assimetria deliberada, com guarda.** O enum do schema (o que a IA **pode emitir**) deixa
> de ser igual a `CAMPOS_PERMITIDOS` (o que **pode ser persistido**). O teste de drift criado
> em 2026-08-09 passa a asserir a relação pretendida — enum = `CAMPOS_PERMITIDOS` menos os
> campos que só o Core escreve — em vez de igualdade simples. Sem isso a divergência viraria
> silenciosa.

### Fora deste contrato

Nada de fuzzy no Core, score, confidence, alias, regex, match textual ou evento novo. O
Core apenas conta, confere integridade e escreve.
