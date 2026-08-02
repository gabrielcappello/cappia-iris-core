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

## Escopo completo do atendimento

Ver `06-roadmap.md` para a lista completa de escopo e a ordem em que cada parte será
implementada. **Anamnese não pertence ao atendimento da Iris.**
