# Decisões canônicas — Agenda e Atendimento

> Fonte única destas decisões. Se este arquivo divergir de qualquer outro lugar (Obsidian,
> conversa antiga, memória), este arquivo prevalece. Mudanças aqui exigem aprovação nova
> do Gabriel — não editar por inferência.
>
> Arquitetura técnica: ver `02-arquitetura.md`. Escopo e ordem de implementação: ver
> `06-roadmap.md`. Processo de trabalho: ver `AGENTS.md`.

## Agenda

- A Cappia possui **calendário interno próprio**.
- O calendário interno **deve funcionar sem Google Calendar**.
- **Google Calendar será uma integração opcional**, configurável pela clínica.
- Toda disponibilidade **depende primeiro do procedimento**.
- A partir do procedimento, **identificar quais dentistas ativos realizam** esse
  procedimento.
- A **duração** é configurada pela clínica para o procedimento (`clinica_id` +
  `procedimento_id`), e é **a mesma para todos os dentistas aptos** daquela clínica.
  Valor válido: inteiro, de 10 a 240 minutos, múltiplo de 10. Duração individual por
  dentista ou por vínculo está **fora da v1** (ver `../specs/duracao-v1.md`).
- Consultar **horários de trabalho, bloqueios e compromissos reais**.
- **Apresentar somente horários realmente disponíveis.**

## Atendimento

- **Identificar clínica e paciente desde a primeira mensagem.**
- **A clínica é determinada pela instância autenticada do WhatsApp** (não por dado
  enviado pelo paciente).
- **O paciente é identificado pelo telefone dentro da clínica.**
- **Se não existir paciente para a combinação clínica + telefone, tratá-lo como paciente
  novo.** Os dados necessários ao cadastro serão solicitados **somente depois de existir
  horário disponível escolhido** — nunca antes disso.
- **O número cadastrado é suficiente** para consultar, remarcar, cancelar e alterar os
  próprios dados — sem exigir identificação adicional para essas ações.
- **Dados informados podem chegar em qualquer ordem** e devem ser **preservados**.
- **A Iris não deve pedir novamente um dado já informado.**
- **Quando houver um único dentista apto**, seguir diretamente para data ou horário,
  **sem anunciar informação redundante** (não perguntar/confirmar o que já está
  resolvido de forma inequívoca).
- **Quando nenhum dentista estiver configurado para o procedimento**, oferecer
  Consulta/Avaliação.
- **A Consulta/Avaliação somente substitui o procedimento com aceitação do paciente** —
  nunca uma substituição automática/silenciosa.
- **A revalidação do horário antes da criação é técnica** (proteção contra o horário ter
  sido ocupado entre a oferta e a confirmação) **e não exige repetir a pergunta ao
  paciente** — é uma checagem interna, não um novo turno de conversa.

## Composição do novo agendamento (01/08/2026)

Decisões que fecham a documentação necessária antes de implementar a composição
determinística dos quatro componentes já publicados (procedimento, dentistas e
vínculos, duração, disponibilidade). Detalhe completo:
`../specs/composicao-novo-agendamento-v1.md`.

- **Resolução temporal terá um resolvedor puro e separado**, futuro, que converte
  fatos temporais já interpretados (texto) em fatos temporais oficiais (data civil,
  minuto local, período, restrição `inicio_ate`/`termino_ate`, intenção
  `data_especifica`/`proxima_disponibilidade`). Essa lógica **não pertence ao
  controlador**.
- **Configuração da clínica tem um contrato mínimo fechado** nesta rodada: `clinica_id`,
  `fuso` e `exigir_email`. Nenhum schema físico, tabela ou migration é criado por esta
  decisão.
- **A busca de próxima disponibilidade é continuável e paginada.** O gerador de
  disponibilidade continua estritamente diário; o controlador solicita snapshots
  sucessivos por data; fim de uma página técnica nunca significa ausência definitiva;
  só o encerramento explícito do protocolo (ausência estrutural de agenda, falha
  técnica ou configuração inválida) pode significar fim da busca — nunca um horizonte
  silencioso de dias.
- **Consulta/Avaliação terá um seletor puro e específico**, futuro, que escolhe pelo
  marcador oficial `eh_consulta_avaliacao`, exigindo exatamente um procedimento ativo
  correspondente na clínica. Zero ou vários correspondentes são erro estrutural. Nunca
  usa nome ou alias; não altera o resolvedor textual de procedimento já publicado.
- **Ordem cadastral fixa**: nome, CPF, data de nascimento, e-mail (somente quando a
  clínica exigir). Campo já presente e válido nunca é solicitado de novo.
- **Repetição idempotente — replay completo somente com resultado da composição
  registrado.** Só então o comando original, a versão recebida e a versão proposta são
  recuperados — sem reaplicar alterações, sem reavaliar eventos e sem executar nenhum
  componente novamente. Interpretação persistida e resultado da composição registrado
  são marcadores distintos; o primeiro nunca autoriza, por si só, replay.
- **Queda intermediária (interpretação persistida, sem resultado da composição
  registrado) preserva integralmente o contrato vigente de `interpretacao-ia.md`.** A
  composição **não é retomada**: não reconstrói eventos candidatos nem conflitos de
  valor (ambos permanecem transitórios, nunca persistidos), não chama a IA novamente,
  produz somente a resposta fixa já aprovada e aguarda nova mensagem do paciente.
  Persistência recuperável da interpretação completa (eventos candidatos e conflitos)
  poderá ser avaliada em spec própria futura; **não faz parte desta v1**.

## Resolvedor temporal (01/08/2026)

Decisões que fecham a especificação canônica do resolvedor temporal puro anunciado em
`## Composição do novo agendamento` acima. Detalhe completo:
`../specs/resolvedor-temporal-v1.md`.

- **A IA produzirá átomos temporais estruturados**, nunca data civil oficial, minuto
  local oficial, classificação de passado, modo final de disponibilidade ou decisão do
  controlador. O resolvedor temporal transforma os átomos em fatos oficiais.
- **Data sem ano resolve como a primeira ocorrência civil válida e não passada**: a
  busca avança ano a ano, a partir do ano corrente (hoje é permitido), examinando **o
  ano atual mais os oito anos seguintes** (nove candidatos ao todo) — suficiente para
  cobrir o ciclo de 29 de fevereiro. A busca nunca ultrapassa `9999`; se nenhuma
  ocorrência válida e futura existir até lá, o resultado é inválido por ano fora do
  domínio. Nunca ano anterior ao corrente; nunca expansão silenciosa de ano de um ou
  dois dígitos (domínio civil `1..9999`; ano explícito aceito `100..9999`; `1..99`
  explícito é sempre inválido).
- **Precedência global fixa entre os resultados possíveis**, independente da ordem
  dos átomos: erro estrutural de entrada (exceção, nunca um resultado) > erro de
  configuração > quantidade excedida ou átomo inválido > conflito > passado > ambíguo
  > incompleto > resolvido. Um tipo incompatível em campo numérico (string, objeto)
  é sempre erro estrutural; um número reconhecido mas não finito (`NaN`/`Infinity`/
  `-Infinity`) é sempre resultado inválido, nunca erro estrutural — os dois nunca são
  alternativas para o mesmo caso.
- **Leva de fatos vazia é sempre resultado incompleto por ausência de intenção**,
  nunca por ausência de data — sem intenção, não há como saber o que é obrigatório.
  Intenção de data específica sem nenhuma data é incompleta por ausência de data;
  intenção de próxima disponibilidade nunca exige data explícita.
- **Segunda-feira é o primeiro dia da semana civil; a semana vai de segunda a
  domingo** — fixo, universal, independente de locale, sistema operacional ou
  timezone da máquina, não configurável por clínica. `proxima` é a primeira ocorrência
  estritamente posterior a hoje; `esta` é a ocorrência dentro dessa semana civil
  (`passado` se já ocorreu); sem qualificador é sempre `ambiguo` — nunca escolhido
  silenciosamente.
- **Fatos temporais estruturados chegam como lista** (`fatos_temporais:
  AtomoTemporal[]`, máximo 8 itens), nunca como objeto único achatado por mensagem —
  só a lista representa corretamente fatos simultâneos (duas datas, duas restrições,
  horário exato e restrição juntos). Horário exato e restrição são átomos distintos,
  com campos próprios, nunca compartilhados entre si.
- **`termino_ate` nunca é declarado incompatível com um horário exato simultâneo
  usando somente o horário de início** — o resolvedor não recebe duração, logo não
  pode calcular o fim; os dois critérios são preservados simultaneamente, e a
  compatibilidade final é verificada pela disponibilidade. `inicio_ate` continua
  podendo ser verificado diretamente contra o horário de início.
- **Horário sem AM/PM** resolve somente quando um período explícito o torna
  inequívoco; caso contrário é `ambiguo` — nunca assume manhã, nunca escolhe entre
  `08:00` e `20:00`.
- **Períodos preservam os limites já canônicos** (manhã `<= 12:00`; tarde `> 12:00` e
  `< 18:00`; noite `>= 18:00`), sem configuração por clínica nesta v1. Período é
  filtro, nunca jornada criada pelo resolvedor.
- **Minutos aceitam qualquer valor civil válido** (`0..1439`), sem exigir múltiplo de
  10, sem arredondar, sem truncar — a disponibilidade decide se o horário exato cabe.
- **Próxima disponibilidade sem nenhum átomo de data inicia hoje.** Com **qualquer**
  átomo de data (absoluta, relativa ou dia da semana) presente — não somente uma
  "data específica rígida" — o resultado é sempre `conflito`; a data nunca é usada
  como início de busca, nunca como filtro, nunca ignorada. Coexistência com a
  intenção `data_especifica` produz o mesmo conflito. Horário exato junto com
  próxima disponibilidade exige esclarecimento (`incompleto`). "A partir de
  determinada data" permanece fora desta v1.
- **Instante local usa a forma já publicada** `InstanteAtual { data, minuto_min }`,
  com `fuso` como campo irmão, nunca aninhado. O resolvedor não usa `Date.now`,
  timezone da máquina, conversão UTC ou validação de tzdb — isso pertence ao adaptador
  futuro.
- **Não existe limite inferior de horário nesta v1 — nem "depois das 15h" nem
  qualquer variante.** O contrato de restrição aceita exatamente duas variantes,
  `inicio_ate` e `termino_ate`, ambas de limite superior; não existe `inicio_apos`.
  "Depois das 15h" não é representável em nenhum nível: a saída estrita da IA não
  consegue produzi-la, e uma entrada runtime com `tipo_restricao` fora do par fechado
  viola o contrato de forma e produz `EntradaInvalidaError` — nunca um resultado de
  domínio, nunca convertida para `inicio_ate`, horário exato ou período.
- **`24:00` é horário inválido**, nunca convertido automaticamente para `00:00` do dia
  seguinte.

## Integração temporal — composição (02/08/2026)

Decisões que fecham a especificação canônica da integração entre o resolvedor
temporal v1 (já publicado e implementado) e a composição determinística do novo
agendamento (ainda apenas especificada). Detalhe completo:
`../specs/integracao-temporal-composicao-v1.md`.

- **Alterações temporais chegam categorizadas**, numa versão futura de contrato da
  interpretação (`alteracoes_temporais`, cinco categorias fechadas: `data`,
  `horario_exato`, `periodo`, `restricao`, `intencao_temporal`), cada uma podendo
  **substituir** ou **remover** integralmente uma categoria — nunca texto livre solto
  por mensagem, nunca duas alterações da mesma categoria na mesma mensagem.
- **O estado oficial acumula os átomos temporais interpretados** (`fatos_temporais`),
  mensagem a mensagem. O critério temporal oficial (saída do resolvedor temporal) é
  **sempre resultado derivado**; os átomos nunca são reconstruídos a partir dele, de
  texto anterior, de resposta anterior ou de memória do modelo.
- **Corte único entre o contrato legado e o contrato estruturado, nunca modo
  híbrido.** `data_texto`/`horario_texto` continuam sendo o contrato vigente até que a
  migração seja implementada e aprovada; quando o contrato estruturado estiver em
  vigor, os dois nunca coexistem como autoridades temporais simultâneas, e nenhuma
  conversão silenciosa de texto para átomo é criada.
- **A composição será uma máquina de estados pura**, avançada por uma função
  determinística sem I/O — nunca acessa banco, agenda, rede, WhatsApp ou IA
  diretamente. Toda consulta a dado condicional (catálogo, vínculos, configuração de
  duração, snapshot diário, revalidação de opção, estado de operação idempotente) é
  uma requisição explícita devolvida ao orquestrador, que a executa e devolve o
  resultado como nova entrada da mesma função.
- **Persistência física adiada naquela rodada**: tabelas, colunas, RPCs, transações e
  CAS concretos para o estado interpretado acumulado e para o resultado da composição
  permaneceram pendência explícita, sem schema físico criado ou presumido. **Essa
  pendência foi endereçada documentalmente em 02/08/2026** — ver
  `## Persistência física da composição — P4` abaixo; continua **sem** schema físico,
  migration ou RPC criados.
- **Tecnologia de redação adiada**: entre template determinístico, IA redatora
  controlada restrita aos fatos autorizados, ou combinação dos dois, nenhuma é
  escolhida nesta rodada; nenhum fallback novo cobre essa indecisão.

## Persistência física da composição — `P4` (02/08/2026)

Decisões que fecham a especificação **documental** da persistência física e da
idempotência concreta da composição determinística. **`P4` está especificada, não
implementada**: nenhuma tabela, coluna, índice, constraint, RPC, migration ou schema
físico foi criado, e **nenhuma estrutura existente foi aprovada para reutilização**.
Detalhe completo: `../specs/persistencia-fisica-composicao-v1.md`.

- **Estado oficial e continuação são registros fisicamente separados.** O estado oficial
  é a autoridade durável; a continuação é artefato técnico com ciclo de vida e retenção
  próprios. O estado nunca é reconstruído a partir de uma continuação, e dado presente
  apenas na continuação nunca vira fato oficial.
- **A versão do estado é um inteiro monotônico atribuído pelo banco; timestamp nunca é
  versão.** Todo avanço oficial ocorre por CAS incluindo `clinica_id`, `conversa_id` e a
  versão esperada; zero linhas atualizadas é sempre `conflito_versao`. A execução
  perdedora carrega o avanço oficial, faz replay se houver resultado e, caso contrário,
  falha fechado — **nunca reaplica decisão calculada sobre estado antigo**.
- **Persistência intermediária e persistência final são, cada uma, uma única transação
  lógica.** Estado final e resultado lógico nunca são confirmados separadamente, e não
  existe atualização parcial observável.
- **Existe no máximo um resultado por mensagem e clínica**, com conteúdo imutável por
  `resultado_id`. Deduplicação de transporte, idempotência operacional e idempotência da
  composição são três mecanismos distintos, e nenhum substitui outro.
- **Deduplicação por identidade autenticada do transporte** (`clinica_id` + canal +
  provider + instância + `message_id`), com o texto fora da identidade. Payload
  divergente sob a mesma identidade falha fechado.
- **A validade de uma continuação é semântica — por evento e versão —, nunca TTL por
  relógio.** Uma pausa longa e legítima não invalida um checkpoint; um avanço concorrente
  invalida imediatamente.
- **Retenção dos artefatos técnicos: 30 dias** após encerramento
  (`resultado_persistido`, `superada`, `falha_fechada`); depois disso restam somente
  metadados mínimos (identificadores, vínculos, tipo, status, versões, timestamps,
  códigos sem PII e fingerprint técnico), e a deduplicação continua funcionando. **Não
  altera o prazo de 7 dias do conteúdo bruto da mensagem** (`persistencia-v1.md` §19):
  são objetos e prazos diferentes, e nenhum artefato técnico de 30 dias preserva o texto
  bruto além dos 7.
- **`P4` termina no resultado lógico persistido e recuperável por replay.** Redação,
  outbox, envio, retries, ACK e garantia de entrega exatamente uma vez ficam **fora de
  `P4`**, em contrato posterior de redação e transporte; falhas nessas camadas **nunca
  alteram o resultado lógico já persistido**.
- **`P5` (tecnologia de redação) continua adiada** — nenhuma escolha entre template
  determinístico, IA redatora controlada ou combinação dos dois foi feita.

## Implementação técnica da persistência da composição — `P4I` (02/08/2026)

Decisões que fecham a especificação **técnica documental** da implementação de `P4`.
**`P4I` está especificada, não implementada**: nenhuma migration foi criada, nenhum SQL
foi executado, nenhum banco foi alterado, e **nenhuma estrutura legada da Iris antiga
está autorizada**. Detalhe completo: `../specs/implementacao-persistencia-composicao-v1.md`.

### Namespaces canônicos de identificador `D*` (instituído nesta rodada)

Três numerações `D1`/`D2`/`D3`-like coexistem no projeto e **nunca devem ser
confundidas entre si**. A partir desta rodada, toda referência nova usa
exclusivamente o identificador **qualificado**:

- **`ITC-D1`, `ITC-D2`, `ITC-D3`** — os três casos de idempotência/concorrência da
  máquina de composição pura, fechados em `../specs/integracao-temporal-composicao-v1.md`
  (reexecução íntegra idêntica; resposta sem requisição pendente correspondente;
  divergência verificável diretamente contra a requisição pendente). **Não
  renumerados, não alterados nesta rodada.**
- **`P4I-D1` a `P4I-D12`** — as doze divergências estruturais da auditoria de
  `estado_conversa`/`mensagens_recebidas` contra o modelo de `P4`, catalogadas em
  `../specs/implementacao-persistencia-composicao-v1.md` §3.1/§3.2 (ex.: `P4I-D1` —
  ausência de coluna de versão inteira; `P4I-D6` — constraint de deduplicação sem
  `clinica_id`/canal). **Não renumeradas, não alteradas nesta rodada.**
- **`DA-P4-01`, `DA-P4-02`, `DA-P4-03`, ...** — decisões arquiteturais e
  técnico-operacionais sobre a persistência de `P4`, tomadas rodada a rodada nesta
  frente. **Os blocos anteriormente registrados como "Decisão arquitetural D1" e
  "Decisão arquitetural D2" abaixo são, respectivamente, `DA-P4-01` e `DA-P4-02`** —
  os nomes históricos "D1"/"D2" são preservados como alias, nunca apagados.

Nenhuma decisão técnica já aprovada em `DA-P4-01` ou `DA-P4-02` é alterada por esta
instituição de namespace — apenas o rótulo passa a ser qualificado, com o histórico
preservado.

- **Seis tabelas, sem autoridade duplicada** (`P4I.1`): `estado_conversa` e
  `mensagens_recebidas` (**existentes**, auditadas e evoluídas de forma
  **predominantemente aditiva**) mais `continuacoes_composicao`,
  `requisicoes_composicao`, `efeitos_composicao` e `resultados_composicao`
  (**novas**). Nenhuma outra tabela pode duplicar estado oficial ou deduplicação;
  requisições e efeitos permanecem separados.
- **As duas estruturas existentes não estão automaticamente aprovadas** (`P4I.2`): a
  auditoria registrou **doze divergências** — entre elas, CAS por `timestamptz` em vez
  de versão inteira, chave de deduplicação sem `clinica_id` nem canal, ausência de
  fingerprint de payload e de retenção do bruto. Todas as bloqueantes devem ser
  fechadas por evolução **predominantemente aditiva** — **com exceção explícita da
  substituição controlada da constraint antiga de deduplicação** (`P4I.6`) — e a
  auditoria do ambiente-alvo deve ser refeita **read-only**, sem presumir que o banco
  vivo corresponde ao schema versionado.
- **Estado da migration de interpretação — três afirmações distintas, nunca
  fundidas** (histórico original desta decisão; **estado atualizado por `DA-P4-03`,
  ver bullet correspondente abaixo**): `20260730_iris_nova_interpretacao_v1.sql`
  está **escrita e versionada** no repositório; o próprio cabeçalho declara que,
  **na rodada em que foi criada**, não havia sido aplicada em nenhum banco — esta
  afirmação segue correta como **evidência histórica daquela rodada**. **O
  preflight que confirmaria o estado atual já foi executado** (CODE 271,
  reconfirmação parcial em CODE 285): a migration **está aplicada** no ambiente
  dev, com materialização confirmada (colunas e RPCs) e equivalência integral do
  SQL executável comprovada por hash normalizado — nunca igualdade binária, apenas
  materialização física e equivalência executável, ambas distintas e ambas
  comprovadas (detalhe completo em `DA-P4-03`, mais abaixo, e em
  `../reviews/da-p4-03-parecer-code.md`).
- **Versão inteira substitui o CAS por timestamp** (`P4I.3`, `P4I.5`): coluna `versao`
  (`bigint`) nova, começando em zero, incrementada **somente pelo banco**; o cliente
  envia apenas a versão esperada; criação inicial da linha trata conflito de corrida
  reconhecendo a linha existente, sem erro operacional. `atualizado_em` permanece
  auditoria e nunca é predicado de CAS desta camada.
- **`DA-P4-01` — anteriormente denominada "decisão arquitetural D1" — destino de
  `reivindicar_mensagem` (aprovada, rodada operacional 277; não implementada):** `public.reivindicar_mensagem` (função SQL) e
  o adaptador `reivindicarMensagem` (`src/core/reivindicar-mensagem.ts`) **deixarão de
  ser autoridades ativas** e serão **substituídos** pelos contratos separados de
  registro/deduplicação (`registrar_ou_recuperar_mensagem`, seção 13.1 da spec
  técnica) e de aquisição de claim (`adquirir_claim_mensagem`, seção 13.2) definidos
  pela `P4I` — nunca por uma função adaptada que funda as duas responsabilidades, nem
  por uma segunda função coexistindo como autoridade ativa de claim com a atual. Esta
  decisão fecha **apenas a direção arquitetural**; não autoriza migration,
  implementação, alteração de banco ou de código. Invariantes aprovadas junto com a
  decisão:
  1. nenhuma função legada permanece com autoridade concorrente sobre registro,
     deduplicação ou claim;
  2. preservada a regra já vigente em `P4I.6`, nunca pode existir janela sem
     deduplicação (a constraint nova é validada e ativada antes de a antiga ser
     removida, nunca depois);
  3. nunca podem existir duas autoridades ativas de claim ao mesmo tempo;
  4. a existência de consumidores externos de `reivindicar_mensagem` (fora deste
     repositório) deve ser verificada antes do corte operacional — a ausência de
     consumidor no repositório, confirmada nesta rodada por busca no código-fonte, não
     substitui essa verificação para ambientes fora do repositório;
  5. a remoção física da função e do adaptador **não faz parte** desta decisão — é
     etapa posterior, sujeita a aprovação própria;
  6. a ordem, quantidade e agrupamento das migrations que executarão esta decisão
     **permanecem em aberto**, a definir posteriormente.
- **`DA-P4-02` — anteriormente denominada "decisão arquitetural D2" — CAS de
  `aplicar_interpretacao_condicional` sob `estado_conversa.versao` (aprovada, rodada
  operacional 286; não implementada):**
  toda alteração efetiva de `estado_conversa.dados`, **inclusive a resultante da
  interpretação**, participa da única sequência monotônica `estado_conversa.versao` —
  nunca de uma segunda numeração paralela. O avanço usa CAS por `clinica_id` +
  `conversa_id` + `versao_esperada` (mesmo predicado da composição, seção 14).
  `atualizado_em` **não é versão** e não pode permanecer como autoridade de
  concorrência depois da ativação da `P4I` — permanece só como carimbo de auditoria
  (mesma regra já fechada para `P4I.3`/`P4I.5`, agora estendida explicitamente à
  interpretação). Interpretação e composição **permanecem operações separadas** —
  esta decisão não as funde. `public.aplicar_interpretacao_condicional` e o adaptador
  `aplicarInterpretacaoCondicional` **não poderão permanecer como via ativa de
  escrita** usando apenas CAS por `atualizado_em`; a direção recomendada é criar uma
  **operação específica** para aplicar a interpretação ao estado oficial sob CAS por
  `versao`, especificada em `specs/interpretacao-ia.md`, seção "Contrato técnico de
  banco — Etapa 6" → "Operação de aplicação da interpretação sob CAS por
  `estado_conversa.versao` (`P4I`)". Esta decisão fecha **apenas a direção
  arquitetural**; não autoriza migration, implementação, alteração de banco ou de
  código. O **nome SQL definitivo e a estratégia de transição permanecem em aberto**
  até a especificação documental ser aprovada. Invariantes aprovadas junto com a
  decisão:
  1. nenhuma alteração de `estado_conversa.dados` ocorre sem avanço correspondente
     de `versao` — nem pela interpretação, nem pela composição;
  2. `versao` é incrementada **somente pelo banco**; o cliente/adaptador envia
     apenas a versão esperada;
  3. nunca podem existir duas autoridades ativas de escrita sobre
     `estado_conversa.dados` — a função legada por `atualizado_em` deixa de ser via
     ativa antes da ativação da `P4I`, nunca depois;
  4. a existência de consumidores externos de `aplicar_interpretacao_condicional`
     (fora deste repositório) deve ser verificada antes do corte operacional — a
     ausência de consumidor no repositório, confirmada nesta rodada por busca no
     código-fonte, não substitui essa verificação para ambientes fora do
     repositório;
  5. a remoção física da função e do adaptador **não faz parte** desta decisão — é
     etapa posterior, sujeita a aprovação própria;
  6. a ordem, quantidade e agrupamento das migrations que executarão esta decisão
     **permanecem em aberto**, a definir posteriormente.
- **`DA-P4-03` — reconciliação do histórico de migrations e regra de
  versionamento para `P4I` (aprovada, rodada operacional 314; não
  implementada):** reconciliação canônica do histórico de migrations do
  ambiente dev (`bcmuqautblvjdqzhjfbw`, `cappia-iris-core-dev`) com os
  arquivos versionados neste repositório, e definição da regra de
  versionamento/ordenação para a primeira migration de `P4I`. Análise
  técnica completa registrada em `reviews/da-p4-03-parecer-code.md` (fonte
  de evidência, não documentação canônica duplicada — este bullet é o
  registro canônico da decisão). **Decisão canônica:** o legado permanece
  imutável e reconciliado por manifesto obrigatório que vincula versões
  remotas, nomes, arquivos e hashes; migrations futuras usam versão UTC
  única de 14 dígitos posterior a `20260731164424`, sem alteração após
  aplicação, e rollbacks são vinculados por versão, nome, filename e
  SHA-256, sempre fora do fluxo de migrations de avanço, independentemente
  da futura adoção da Supabase CLI.

  **Fechado nesta decisão:**
  1. o mecanismo histórico exato de aplicação das três migrations legadas
     (`20260729033207`/`iris_nova_identificacao_v1`,
     `20260729113821`/`iris_nova_identificacao_v1_correcao`,
     `20260731164424`/`iris_nova_interpretacao_v1`) **permanece
     indeterminado** — a presença de `created_by` e `statements` na tabela
     `supabase_migrations.schema_migrations` não permite distinguir entre
     Dashboard, Management API ou CLI de outro ambiente; nenhuma dessas
     hipóteses é afirmada como fato;
  2. as três migrations legadas têm: arquivos locais históricos imutáveis
     (em `src/supabase/migrations/`); versões remotas conhecidas;
     **equivalência integral do SQL executável comprovada** por hash
     normalizado idêntico entre local e remoto (nas três, calculado
     independentemente em ambos os lados). **Duas diferenças de medição
     distintas, nunca fundidas:** (a) a **diferença binária entre arquivo
     local e `statements` remoto** é explicada integralmente por comentários
     e formatação não executável — nunca por conteúdo de schema divergente;
     (b) **dentro do próprio `statements` remoto** da migration de
     interpretação, `length()` retorna `12081` (caracteres) e
     `octet_length()` retorna `12091` (bytes UTF-8) para o **mesmo texto** —
     essa diferença de 10 unidades é explicada por **caracteres multibyte em
     UTF-8** (o mesmo conteúdo, medido em duas unidades diferentes), **não**
     é uma segunda fonte de divergência entre local e remoto;
  3. o **manifesto local↔remoto é obrigatório** como parte desta decisão —
     não é uma pendência em aberto; **sua criação física ocorrerá em etapa
     posterior**, sujeita a aprovação própria;
  4. o manifesto deverá vincular, para cada migration legada, no mínimo:
     ambiente auditado; versão remota; nome remoto; filename histórico
     local; SHA-256 remoto; SHA-256 local; hash executável normalizado;
     resultado da comparação semântica; objetos materializados verificados;
     rollback associado; SHA-256 do rollback;
  5. migrations futuras de `P4I`: formato `AAAAMMDDHHMMSS_<nome_logico>.sql`;
     timestamp UTC atribuído uma única vez na criação do arquivo; versão
     única e estritamente crescente; primeira migration de `P4I`
     numericamente posterior a `20260731164424`; arquivo nunca renomeado
     após aplicação; conteúdo aplicado nunca alterado retroativamente;
     qualquer correção ocorre por nova migration, nunca edição do arquivo
     já aplicado;
  6. rollbacks: não são migrations normais de avanço; permanecem fora do
     diretório normal de migrations reconhecido por qualquer ferramenta;
     vinculados por versão remota, nome lógico, filename e SHA-256
     simultâneos (nunca um só desses campos isoladamente); execução exige
     autorização explícita e preflight de compatibilidade contra o
     ambiente-alvo; proibidos quando incompatíveis após tráfego novo — nesse
     caso, usar nova migration corretiva, nunca reaplicação forçada;
  7. a **adoção da Supabase CLI permanece decisão operacional futura e
     separada** de `DA-P4-03` — a regra de nomenclatura acima é compatível
     com essa adoção futura, sem pressupô-la;
  8. **se uma ferramenta operacional de migrations for adotada, as
     representações exigidas das três versões remotas deverão existir antes
     do primeiro uso dessa ferramenta** — nunca por simples renomeação dos
     arquivos legados presumindo equivalência. Permanecem explicitamente em
     aberto, não fechados por esta decisão: criação física dessas
     representações; conteúdo exato; localização; qual ferramenta (se
     alguma) será adotada; e o momento da execução;
  9. **nenhum `migration repair` está autorizado ou justificado neste
     momento** — não há evidência de que o histórico remoto esteja
     incorreto, e `migration repair` muta a tabela de histórico.

  **Permanece para etapa posterior, fora desta decisão:** a criação física
  do manifesto; a criação de representações operacionais; a decisão de
  adotar ou não a Supabase CLI. **A estratégia física de transição de
  `DA-P4-01`/`DA-P4-02`, não iniciada por esta decisão, foi registrada
  posteriormente em `DA-P4-04` (ver abaixo).**
- **`DA-P4-04` — estratégia físico-operacional conjunta de transição de
  `DA-P4-01`/`DA-P4-02` (aprovada, rodada operacional 325; não
  implementada):** define **como** o corte de autoridade das duas decisões
  anteriores ocorrerá fisicamente — sem fixar SQL concreto, sem iniciar a
  especificação física, sem alterar `DA-P4-01`, `DA-P4-02` ou `DA-P4-03` em
  substância. **Decisão canônica:** a transição será **aditiva e por
  autoridade exclusiva de runtime** — novas operações nascerão sem acesso
  para papéis de aplicação, serão validadas antes do corte, entradas serão
  suspensas e toda execução legada drenada, grants e constraint serão
  trocados atomicamente no PostgreSQL, o Core novo saudável será ativado
  antes da retomada, e qualquer rollback posterior dependerá da
  compatibilidade efetiva dos dados, com remoção física do legado somente em
  etapa aprovada separadamente.

  **1. Definição de autoridade de runtime.** Autoridade de runtime é **toda
  capacidade de execução disponível** aos papéis ou consumidores usados pelo
  fluxo da aplicação, **mesmo quando não houver uso observado naquele
  momento** — não se limita ao que o tráfego efetivamente usa em cada
  instante. **Não** contam como autoridade concorrente de runtime: owner
  administrativo; superusuário; contexto administrativo controlado que não
  participe do fluxo normal.

  **2. Novas operações inicialmente sem autoridade.** As novas funções
  mutáveis nascem com **revogações explícitas** para `PUBLIC`, `anon`,
  `authenticated`, `service_role`, e qualquer papel herdado capaz de
  alcançar `EXECUTE` — ausência de grant direto **não basta**; é preciso
  verificar ACL efetiva, heranças de papéis, default privileges, e ausência
  de acesso antecipado por runtime. Validação técnica ocorre **somente** em
  ambiente descartável ou por contexto administrativo controlado, **nunca**
  concedendo antecipadamente autoridade ao papel de runtime.

  **3. Preparação estrutural.** Antes do corte devem existir e estar
  validados: tabelas/colunas/constraints de `P4I`; `estado_conversa.versao`
  inicializada e coerente; nova constraint de deduplicação criada e
  validada; constraint antiga ainda ativa; novas operações materializadas;
  grants de runtime revogados; testes obrigatórios aprovados; rollback
  pré-tráfego comprovado.

  **4. Core novo preparado.** Significa: artefato implantado; saudável;
  compatível com as novas operações; pronto para receber tráfego; **ainda
  inativo para entradas reais**. Um build local ou artefato apenas
  disponível **não satisfaz** o gate.

  **5. Cache PostgREST.** Antes do corte: presença, assinatura e metadados
  validados no cache do PostgREST; nenhuma entrada pode ser liberada
  enquanto a função necessária estiver ausente ou desatualizada no cache.
  Essa validação confirma **apenas**: presença da função; assinatura;
  metadados esperados no cache. Ela **não concede `EXECUTE`; não ativa
  autoridade; não substitui a verificação de ACLs (ponto 2); e não libera
  tráfego antecipadamente** — é uma condição necessária, nunca suficiente,
  para o corte. O mecanismo físico de atualização do cache **não é
  especificado nesta decisão**.

  **6. Auditoria de consumidores externos.** Gate obrigatório: **nenhum
  consumidor externo autorizado permanece dependente das vias legadas** — a
  auditoria considera chamadas fora do repositório e fora do Core oficial.
  Responsável, ferramenta e formato do relatório permanecem para a
  especificação operacional.

  **7. Suspensão e drenagem.** Critérios de drenagem confirmada, **já
  fechados por esta decisão** (não abertos para a especificação física):
  nenhuma entrada nova é aceita; zero claims legados ativos; zero leases
  legados válidos; zero chamadas legadas em execução; zero transações
  legadas em execução; zero escritas legadas em voo. Permanecem em aberto
  somente: mecanismo de medição; timeout; ferramenta; procedimento físico
  de execução e confirmação.

  **8. Transação PostgreSQL de transferência.** Estruturas, constraints e
  `versao` podem ser preparadas com antecedência, fora desta transação.
  Durante o corte, o que é transferido **atomicamente no PostgreSQL** é a
  **autoridade de runtime das operações legadas para as novas** — nunca a
  identidade ou a coluna de deduplicação/CAS em si, que já existem desde a
  preparação estrutural (ponto 3). Somente após todos os gates: retirar a
  autoridade de runtime das funções legadas; conceder autoridade de runtime
  exclusivamente às novas operações. A retirada da constraint antiga ocorre
  **nessa mesma transação somente quando todos os gates próprios estiverem
  satisfeitos**: a nova constraint estiver válida, a função antiga já
  estiver sem capacidade de registrar, não houver chamadas em voo, e os
  dados estiverem compatíveis. `REVOKE`, `GRANT` e `DROP CONSTRAINT` podem
  integrar uma única transação PostgreSQL; falha da transação reverte
  integralmente essas alterações; `DROP CONSTRAINT` pode exigir
  `ACCESS EXCLUSIVE` e aguardar locks — timeout e tratamento concreto da
  espera ficam para a especificação física.

  **9. Banco e Core — ordem obrigatória, nunca uma transação conjunta:**
  (1) Core novo implantado, saudável e inativo; (2) entradas suspensas; (3)
  execução legada drenada; (4) transferência exclusiva de autoridade no
  banco; (5) ativação do Core novo; (6) validação de saúde; (7) retomada
  das entradas. Durante a suspensão pode existir um intervalo sem via
  disponível para tráfego, mas **nenhuma entrada pode ser aceita** nesse
  período. Esta sequência completa de coordenação entre banco, Core,
  suspensão, drenagem e retomada é **decisão própria de `DA-P4-04`** — não
  é atribuída a `P4I.6` nem à seção 3.2.1.

  **10. Deduplicação e CAS.** `P4I.6`/3.2.1 sustenta **especificamente** a
  troca da deduplicação sem janela desprotegida — não a sequência completa
  do ponto 9. Nunca existe janela sem deduplicação; nova e antiga
  constraints podem coexistir temporariamente; a antiga só é removida após
  a nova estar validada; a função antiga perde autoridade **antes** da
  remoção da constraint antiga; `atualizado_em` nunca permanece como CAS
  ativo junto com `versao`; somente a nova operação por `versao` recebe
  autoridade no corte.

  **11. Rollback.** Antes de tráfego novo: grants e deploy podem ser
  revertidos somente após confirmar ausência de escrita nova; estrutura e
  dados preservados até o preflight de compatibilidade. Depois de tráfego
  novo: a **possibilidade de rollback depende do preflight de
  compatibilidade dos dados**, nunca de o tráfego real ter ou não ocorrido
  — **se os dados continuarem compatíveis, a reversão coordenada ainda
  poderá ser possível**; se houver dependência exclusiva do contrato novo,
  não reativar automaticamente as funções legadas nem restaurar
  automaticamente a constraint antiga; nesse caso, seguir com desativação
  operacional segura da nova via e correção sempre por migration
  **forward-only**. Após remoção física, retorno ao legado exige nova
  decisão e nova migration.

  **12. Observação e remoção física.** O período de observação é governado
  por **gates verificáveis, não por prazo arbitrário**: nenhum uso residual
  legado; nenhuma falha atribuída à nova via; nenhuma linha incompatível;
  testes e métricas aprovados. Remoção física permanece etapa posterior,
  separada, com aprovação própria.

  **Fecha apenas a direção e as invariantes físico-operacionais** — não
  autoriza migration, implementação, alteração de banco, instalação/
  configuração de Supabase CLI, ou início da especificação física. Não
  fixa SQL concreto, mecanismo físico do cache PostgREST, duração de
  observação, nem responsável pela auditoria de consumidores. Os critérios
  de drenagem (ponto 7) já estão fechados por esta decisão, não em aberto.

  **Permanece para a especificação física, fora desta decisão:** mecanismo
  de medição, timeout, ferramenta e procedimento físico de suspensão e
  drenagem (critérios já fechados nesta decisão, não em aberto); ordem
  exata dos comandos dentro da transação de corte; mecanismo de
  atualização do cache PostgREST; duração do período de observação; nome
  SQL definitivo da operação substituta de `DA-P4-02`; responsável e
  ferramenta da auditoria de consumidores externos.
- **Nova chave de deduplicação substitui a constraint antiga** (`P4I.6`): a
  constraint vigente de `mensagens_recebidas` (`provider` + `instancia_whatsapp` +
  `message_id`) **não inclui `clinica_id` nem canal, e não é responsável por
  vincular globalmente uma instância a uma clínica**. Essa responsabilidade pertence
  a `clinicas_provider_instancia_key` (unicidade global de `provider` +
  `instancia_whatsapp` em `clinicas`), reforçada pela FK composta entre a mensagem e
  a clínica proprietária. **A mitigação atual do risco multiclínica vem dessas duas
  — não da constraint de deduplicação da mensagem** — e **substituir ou remover a
  constraint antiga de `mensagens_recebidas` não remove, por si só, a unicidade
  global em `clinicas`**: são constraints independentes, em tabelas diferentes.
  Mesmo assim, `D6` permanece **parcialmente confirmada e bloqueante**: a constraint
  antiga diverge da identidade exigida por `P4` §6 e será **substituída**, não
  apenas complementada. A troca é uma **substituição controlada de constraint**
  dentro de uma migration predominantemente aditiva: auditar dados, criar e
  preencher `canal`, validar duplicidade sob a chave nova, ativá-la, só então
  remover a antiga, provar ausência de janela sem deduplicação, com **rollback
  condicionado à compatibilidade dos dados** — recriar a constraint antiga só é
  possível se nenhuma linha depender de `canal` para se distinguir; havendo tráfego
  que já dependa da chave nova, o rollback estrutural fica **proibido** e a reversão
  é operacional, por flag, preservando a constraint nova e os dados.
- **Compatibilidade, backfill e coorte contratual das linhas existentes**
  (`P4I.10`): `canal`, `conversa_id`, `payload_fingerprint` e os vínculos de
  continuação/resultado ganham nulabilidade **transitória e explícita** em
  `mensagens_recebidas`; preflight mede cobertura real antes de qualquer backfill;
  **nenhum dado é fabricado** — payload, fingerprint ou vínculo ausente permanecem
  nulos. O enforcement é **físico, não apenas de política**: uma coluna nova,
  `versao_contrato_registro smallint`, marca a coorte de cada linha — histórica
  (nula ou legada) ou `P4I` (sempre `1`, atribuído pela própria operação de
  inserção, nunca pelo chamador) — e um **`CHECK` condicional** a esse valor exige
  `canal`, `conversa_id` e `payload_fingerprint` preenchidos **somente** para a
  coorte `P4I`. **Nunca existe `NOT NULL` incondicional** nessas colunas; a coorte
  histórica pode permanecer nula indefinidamente sem bloquear a constraint
  condicional. Promover uma linha histórica à coorte `P4I` exige backfill
  **integral**, nunca parcial; linha incompatível bloqueia a promoção até decisão
  técnica documentada.
- **Isolamento multiclínica estrutural** (`P4I.6`, `P4I.22`): toda referência é **FK
  composta** incluindo `clinica_id`; RLS é defesa **adicional**, nunca suficiente — o
  predicado de clínica é obrigatório também no código.
- **Identidades UUID v4 opacas, com distribuição própria** (`P4I.7`, `P4I.23`):
  `continuacao_id`, `requisicao_id`, `efeito_id` e `resultado_id` nascem no **Core**;
  identidade interna da mensagem e `claim_token` nascem na **operação atômica de
  persistência**. Ordenação nunca usa identidade — só versões e timestamps. O Core
  **não importa** Supabase, Postgres, driver ou SDK.
- **Claim e lease pelo relógio do Postgres** (`P4I.14`): **60 segundos** para a
  mensagem, **5 minutos** para o efeito, ambos exclusivamente pelo relógio do banco —
  nunca o do worker, do Core ou do adaptador; a rotação de token retira a autoridade
  do worker antigo imediatamente; o lease **nunca** altera a validade semântica da
  continuação.
- **Reclaim da mensagem permitido com ou sem interpretação persistida** (`P4I.14`,
  correção desta rodada): o marcador `interpretacao_persistida_em` **nunca bloqueia**
  o reclaim de um lease expirado — ele só decide o comportamento **depois** do claim
  readquirido: sem marcador, interpretar como se fosse a primeira tentativa; com
  marcador, **nunca reinterpretar**, retornar a resposta fixa canônica já aprovada.
  Preservado em ambos os casos: claim vigente impede paralelismo; resultado existente
  produz replay antes de qualquer retomada; payload divergente falha fechado.
- **Correlação opcional e condicionada `requisicao_id` → efeito** (`P4I.16`):
  `efeitos_composicao.requisicao_id` é **obrigatório** quando o efeito tiver origem
  numa requisição `preparacao_efeito`, e **nulo** apenas quando o Core emitir o
  efeito diretamente. FK composta com `clinica_id`; a requisição vinculada precisa
  pertencer à mesma clínica, conversa, mensagem e continuação, com classe compatível.
  **Uma reapresentação nunca troca essa correlação.** `requisicoes_composicao` e
  `efeitos_composicao` continuam tabelas separadas (`P4I.13`); o adaptador não pode
  criar efeito substituto mesmo com correlação ausente ou incompatível.
- **Três políticas de retenção independentes** (`P4I.20`, `P4I.21`): **7 dias** para o
  conteúdo bruto (de `recebido_em`); **30 dias** para os artefatos técnicos encerrados
  (de `encerrado_em`); **30 dias** para o payload do resultado (de `criado_em`). A
  limpeza é idempotente, opera por lote, **nunca apaga linhas**, nunca limpa continuação
  ativa e nunca expõe payload em log.
- **`P4I-R1` — retenção do resultado lógico** (`P4I.24`, decisão final de Gabriel):
  **payload completo do resultado por 30 dias; depois, somente metadados.** A
  **deduplicação permanece permanente**; o **replay completo expira**; o domínio **não é
  recomposto**. Após a limpeza, o sistema não reinterpreta, não chama a máquina, não
  consulta disponibilidade, não reconstrói o resultado e não responde como se a mensagem
  fosse inédita — retorna o estado técnico fechado
  `resultado_processado_payload_expirado`, que **não** é falha de domínio e **não**
  representa novo processamento.
- **Limite preservado** (seção 1 da spec): `P4I` termina no resultado lógico
  persistido e recuperável por replay. `P5`, redação, outbox, transporte, retry, ACK,
  exactly-once de entrega e deploy operacional permanecem **fora**, e **nenhuma promessa
  de exactly-once de entrega é feita**.
- **Nenhuma implementação começa antes da aprovação desta especificação técnica.**

## Escopo completo do atendimento

Ver `06-roadmap.md` para a lista completa de escopo e a ordem em que cada parte será
implementada. **Anamnese não pertence ao atendimento da Iris.**
