# Procedimentos v1

**Status:** especificação canônica aprovada para o primeiro fluxo de novo agendamento.
Este documento define contrato lógico e comportamento; não autoriza implementação,
alteração de banco, criação de tabelas, migration ou schema físico.

Esta especificação complementa `novo-agendamento.md`, `interpretacao-ia.md`,
`eventos-conversacionais-v1.md` e `controlador-conversacional-v1.md`. Permanecem fixas
as decisões de `../docs/02-arquitetura.md` e `../docs/04-decisoes-canonicas.md`: a IA
interpreta somente a mensagem atual e nunca decide; o Core determinístico resolve;
Supabase/Postgres é a fonte oficial.

## 1. Identidade do procedimento

- `procedimento_id`: identificador estável, opaco, nunca derivado de texto ou nome
  exibido.
- `procedimento_id` pertence exclusivamente à clínica — **não existe procedimento
  global ou compartilhado entre clínicas nesta v1**. Identidade completa é sempre o par
  `(procedimento_id, clinica_id)`; dois procedimentos de clínicas diferentes nunca
  compartilham linha, registro ou identidade, mesmo com nome exibido idêntico.
- Nome exibido: texto legível ao paciente/painel, sem valor de identidade.
- Status ativo/inativo: controla elegibilidade para resolução e oferta.
- Idioma: PT-BR fixo nesta fase, coerente com `novo-agendamento.md` §23. Restrição de
  escopo documentada — se isso vira campo físico ou fica implícito é decisão de schema,
  fora desta spec.

**Regra fixa**: a Iris nunca identifica procedimento pelo nome exibido — toda resolução
produz `procedimento_id`; nenhuma etapa posterior (Core, disponibilidade, agendamento)
compara ou decide por nome.

## 2. Catálogo oficial

**Estrutura lógica mínima** (não é schema físico):
- identidade (`procedimento_id` + `clinica_id`);
- nome exibido;
- status ativo/inativo;
- conjunto de aliases vinculados (seção 5);
- marcador `eh_consulta_avaliacao` (seção 8).

**Procedimento ativo**: controla se o procedimento pode ser resolvido ou oferecido. Um
procedimento inativo nunca resolve, mesmo com alias correspondente ao texto — mesma
exigência já em `novo-agendamento.md` §5.

**Procedimento disponível para resolução**: ativo **e** pertence à clínica da conversa
corrente **e** possui alias correspondente ao texto normalizado. Distinto de "agendável"
(seção 9).

**Reuso do catálogo existente — não decidido por esta spec**: `docs/05-componentes-
reutilizaveis.md` lista "Catálogo de procedimentos" como candidato a reuso, mas exige
auditoria específica e autorização explícita, item por item, nunca antecipadamente. Esta
especificação define o contrato lógico, independente de o catálogo físico ser construído
do zero ou reaproveitado depois de auditado.

## 3. Resolução texto → procedimento_id

Fluxo determinístico, sem inferência probabilística:

```
procedimento_texto (já produzido pela IA, campo existente em AlteracoesDados)
    ↓
normalização fechada (seção 4)
    ↓
match exato contra aliases da clínica corrente
    ↓
procedimento_id oficial | não resolvido | erro de catálogo (seção 6)
```

A IA entrega `procedimento_texto` como texto puro, sem resolver contra catálogo
(`interpretacao-instrucoes.ts`). Esta seção define exclusivamente o que o Core faz com
esse texto depois.

## 4. Normalização do texto

Nesta v1, exatamente estas transformações, nenhuma outra:
- lowercase;
- remoção de acentos;
- trim;
- redução de espaços múltiplos a um único espaço.

Explicitamente fora: correção ortográfica, stemming, interpretação semântica, expansão
automática, qualquer transformação linguística. Ampliação futura é decisão separada, com
aprovação própria.

## 5. Aliases dos procedimentos

- Alias é uma entrada explícita de resolução (texto normalizado → `procedimento_id`),
  nunca um cálculo.
- Auditável: cada alias é um registro identificável, não uma regra implícita de código.
- Um alias não pode apontar para mais de um procedimento dentro da mesma clínica.
- Unicidade de alias é por clínica — o mesmo texto pode resolver para procedimentos
  diferentes em clínicas diferentes, sem conflito.

**Decisão fechada**: aliases são definidos no seed do sistema. Fora do escopo inicial:
clínica editar aliases, painel de CRUD, configuração dinâmica. Qualquer uma dessas exige
spec própria.

## 6. Ambiguidade

Determinística, sem julgamento subjetivo da IA nem do Core:

- **0 matches** → procedimento não resolvido.
- **1 match** → procedimento resolvido.
- **Mais de 1 match** → nunca deveria ocorrer em runtime. É erro de catálogo/seed
  (viola a unicidade de alias da seção 5), não ambiguidade conversacional. **O runtime
  nunca escolhe nem pergunta ao paciente** nesse caso — é falha técnica interna, tratada
  como rede de segurança, nunca como resultado operacional.

A "ambiguidade real" descrita em `novo-agendamento.md` §5 (ex.: "consulta geral ou
ortodôntica") não é responsabilidade deste fluxo de resolução. Ela é evitada a montante
— a IA já omite `procedimento_texto` em caso de dúvida real (`interpretacao-
instrucoes.ts`: "em caso de dúvida real... omita o campo — nunca adivinhe"). Texto
omitido chega aqui como ausência de entrada e resolve como "não resolvido", nunca como
múltiplos matches. Este resolvedor é puramente determinístico: nunca decide entre
opções, nunca pergunta — só resolve ou não resolve.

## 7. Procedimento não encontrado

Comportamento para cada caso:
- texto sem correspondência (0 matches) → não resolvido;
- procedimento existe mas está inativo → tratado como não resolvido (nunca revela ao
  paciente que existe, mas está inativo);
- clínica não possui aquele procedimento → não resolvido (sem alias correspondente
  naquela clínica).

Nunca: escolher procedimento parecido silenciosamente; criar procedimento inexistente;
inventar disponibilidade. A resposta ao paciente nesses casos é responsabilidade do
controlador conversacional, não desta spec.

## 8. Consulta/Avaliação

Consulta/Avaliação é um único `procedimento_id` no catálogo — não existem "avaliação
normal" e "avaliação fallback" como registros distintos.

**Identificação**: propriedade `eh_consulta_avaliacao = true` no próprio procedimento,
identificando o único procedimento Consulta/Avaliação daquela clínica. **Regra de
unicidade**, análoga à de alias (seção 5): no máximo um procedimento por clínica pode
ter `eh_consulta_avaliacao = true`.

**Uso 1 — pedido direto** ("quero marcar uma avaliação"): resolve normalmente pelo
fluxo da seção 3, como qualquer outro procedimento.

**Uso 2 — fallback**: quando nenhum dentista apto realiza o procedimento solicitado
(`novo-agendamento.md` §6). Nunca substituição automática/silenciosa — o Core apresenta
a proposta e exige aceitação explícita via `aceitar_opcao` (`eventos-conversacionais-
v1.md` §2: "Consulta/Avaliação não possui evento próprio. O Core reutiliza
`aceitar_opcao`").

Consulta/Avaliação ativa (`eh_consulta_avaliacao = true`) é um requisito esperado da
configuração de cada clínica, para que o fallback exista. Sua ausência ou inatividade
torna o fallback indisponível — o Core falha fechado nesse caso (não inventa
procedimento nem profissional, não consulta disponibilidade), conforme
`dentistas-vinculos-v1.md` §12. A resposta conversacional final para esse cenário
permanece pendente para `atendimento-v1.md`.

## 9. Relação com duração e agendamento

Não existe duração global do procedimento compartilhada entre clínicas, e o procedimento
não armazena agendabilidade (`procedimento.agendavel` não existe).

Na v1, a duração pertence à **configuração da clínica para o seu procedimento**
(`clinica_id` + `procedimento_id`, ver `duracao-v1.md`) — nunca ao dentista, nunca ao
vínculo dentista–procedimento, nunca a um catálogo global entre clínicas.

Agendabilidade é propriedade derivada, nunca armazenada no procedimento:

```
procedimento resolvido + dentista apto + duração resolvível = procedimento agendável
```

A validação completa acontece nas etapas de dentistas, duração e disponibilidade,
conforme suas specs próprias. As especificações de dentistas e duração já são
canônicas; a especificação de disponibilidade ainda será definida.

## 10. Testes obrigatórios da especificação

- **Resolução normal**: "limpeza", "limpeza dental", "profilaxia" → mesmo
  `procedimento_id`.
- **Não resolução**: texto sem correspondência; procedimento inexistente na clínica.
- **Erro de catálogo**: alias apontando para dois procedimentos na mesma clínica é
  inválido na configuração — nunca chega a produzir escolha ou pergunta em runtime.
- **Isolamento multiclínica**: mesmo alias em clínicas diferentes resolve para
  `procedimento_id` diferentes, sem conflito; nenhum `procedimento_id` é
  compartilhado entre clínicas.
- **Status**: procedimento inativo nunca resolve, mesmo com alias correspondente.
- **Consulta/Avaliação**: pedido direto resolve normalmente; fallback exige
  `aceitar_opcao` explícito; no máximo um `eh_consulta_avaliacao = true` por clínica.

## 11. Pendências

Não resolvidas por esta especificação, não decididas por inferência:

1. Comportamento arquitetural quando nenhum dentista é apto **e** a clínica não tem
   `eh_consulta_avaliacao` ativo agora está definido em `dentistas-vinculos-v1.md`
   §12 (Core falha fechado, sem ciclo, sem alternativa inventada). Só a resposta
   conversacional final para esse cenário permanece pendente para `atendimento-v1.md`.
2. A auditoria read-only do catálogo legado foi concluída: os dados de referência foram
   classificados para adaptação e as resoluções/RPCs legadas para descarte como
   implementação direta. Essa classificação não autoriza reuso automático; qualquer
   aproveitamento futuro ainda exige autorização explícita, conforme
   `docs/05-componentes-reutilizaveis.md`.

## 12. Invariantes

- `procedimento_id` é sempre local à clínica; não existe procedimento global.
- A Iris nunca identifica procedimento pelo nome exibido.
- Resolução é puramente determinística: normalização fechada + match exato de alias.
- Nenhum fuzzy matching, similaridade probabilística ou decisão da IA na resolução.
- Alias duplicado na mesma clínica é erro de catálogo/seed, nunca ambiguidade
  conversacional apresentada ao paciente.
- Unicidade de alias e de `eh_consulta_avaliacao` são por clínica.
- Consulta/Avaliação nunca substitui procedimento solicitado sem aceitação explícita.
- Não existe duração global do procedimento compartilhada entre clínicas; na v1 a
  duração é configuração da clínica para o procedimento, nunca do dentista ou do
  vínculo. Agendabilidade é propriedade derivada, nunca armazenada.
- Esta especificação não cria código, tabela, coluna, RPC ou migration.
