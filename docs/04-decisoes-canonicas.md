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
  fundidas**: `20260730_iris_nova_interpretacao_v1.sql` está **escrita e versionada**
  no repositório; o próprio cabeçalho declara que, **na rodada em que foi criada**,
  não havia sido aplicada em nenhum banco; o **estado atual de aplicação é
  desconhecido** — só um preflight read-only futuro, imediatamente antes de qualquer
  migration nova, pode determinar se foi aplicada, em quais ambientes, quais objetos
  existem e se houve alteração posterior.
- **Versão inteira substitui o CAS por timestamp** (`P4I.3`, `P4I.5`): coluna `versao`
  (`bigint`) nova, começando em zero, incrementada **somente pelo banco**; o cliente
  envia apenas a versão esperada; criação inicial da linha trata conflito de corrida
  reconhecendo a linha existente, sem erro operacional. `atualizado_em` permanece
  auditoria e nunca é predicado de CAS desta camada.
- **Decisão arquitetural D1 — destino de `reivindicar_mensagem` (aprovada, rodada
  operacional 277; não implementada):** `public.reivindicar_mensagem` (função SQL) e
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
- **Decisão arquitetural D2 — CAS de `aplicar_interpretacao_condicional` sob
  `estado_conversa.versao` (aprovada, rodada operacional 286; não implementada):**
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
