# Composição do Novo Agendamento v1

**Status:** especificação canônica de orquestração — define **como** o controlador
combina os componentes determinísticos já publicados para produzir o próximo passo do
fluxo de novo agendamento. Não autoriza implementação, criação de tipo TypeScript,
alteração de banco, criação de tabelas, migration ou schema físico.

Esta especificação complementa e **não substitui** `novo-agendamento.md`,
`interpretacao-ia.md`, `eventos-conversacionais-v1.md`,
`controlador-conversacional-v1.md`, `procedimentos-v1.md`, `dentistas-vinculos-v1.md`,
`duracao-v1.md`, `disponibilidade.md`, `resolvedor-temporal-v1.md`,
`integracao-temporal-composicao-v1.md`, `persistencia-v1.md` e `atendimento-v1.md`.
Onde este documento e um daqueles divergir, o documento mais específico do assunto
prevalece — este arquivo é a camada de **orquestração**, nunca a fonte da regra de
domínio. Permanecem fixas as decisões de `../docs/02-arquitetura.md` e
`../docs/04-decisoes-canonicas.md`.

**Nenhum algoritmo dos cinco componentes publicados é redefinido, resumido ou
reimplementado aqui.** Esta spec só descreve a ordem de chamada, o tratamento de cada
resultado e a transição de turno — nunca o cálculo interno de cada componente.

## 1. Objetivo

Definir, de forma fechada, como o controlador determinístico combina:

- o resolvedor de procedimento (`procedimentos-v1.md`, `resolverProcedimento`);
- o resolvedor de dentistas e vínculos (`dentistas-vinculos-v1.md`, `resolverDentista`);
- o resolvedor de duração (`duracao-v1.md`, `resolverDuracao`);
- o gerador de disponibilidade (`disponibilidade.md`, `resolverDisponibilidade`);

em uma única passagem determinística por turno, produzindo exatamente um de um catálogo
fechado de comandos (seção 8), até o ponto em que a conversa está pronta para pedir
confirmação explícita — e nunca além dele.

## 2. Escopo

Esta especificação cobre:

- a ordem obrigatória de chamada dos cinco componentes publicados;
- o tratamento determinístico de cada variante de resultado que cada um devolve;
- os pontos em que o turno deve parar e aguardar nova mensagem do paciente;
- a matriz de invalidação de dados derivados quando um fato muda;
- o consumo do resolvedor temporal já publicado e implementado
  (`resolvedor-temporal-v1.md`) — a integração dele com esta composição está
  especificada, ainda não implementada, em `integracao-temporal-composicao-v1.md`;
- o contrato conceitual (não implementado) do futuro seletor de Consulta/Avaliação;
- o contrato mínimo (não implementado) de configuração oficial da clínica necessário
  para esta composição funcionar;
- o protocolo conceitual (não implementado) de busca continuável de próxima
  disponibilidade;
- a noção conceitual de idempotência desta composição, distinta da idempotência
  operacional de criação/cancelamento/remarcação já definida em `persistencia-v1.md`
  §21–§23.

## 3. Fora do escopo

Esta especificação **não** cobre, e nenhuma seção abaixo deve ser lida como cobrindo:

- processamento do evento `confirmar_resumo` em si — pertence a
  `eventos-conversacionais-v1.md` §5 e a `controlador-conversacional-v1.md` §8, já
  canônicos, e acontece **depois** do último comando que esta composição pode emitir;
- revalidação técnica do horário, criação do agendamento, transição para `executando`
  ou para `concluido` — pertencem a `novo-agendamento.md` §14–§16 e
  `persistencia-v1.md` §22–§23;
- cancelamento, remarcação ou consulta de agendamento existente — fora do escopo de
  `novo-agendamento.md` §1 e desta composição;
- redação final do texto ao paciente — pertence a `atendimento-v1.md`; esta spec produz
  comandos e fatos autorizados, nunca frases;
- schema físico, RPC, migration, tabela, índice ou qualquer alteração de banco;
- implementação de código, tipo TypeScript ou teste executável;
- qualquer acesso a Supabase, Google Calendar, n8n, Evolution, Vercel ou ao painel.

**A composição termina em `solicitar_confirmacao`. Ela não executa a confirmação.**
Nenhuma seção desta spec autoriza avançar além desse comando.

## 4. Entrada da composição

Entrada conceitual — **pseudotipo, não implementação; não é assinatura de função nem
schema físico**, forma e nomes pertencem à implementação futura:

```text
interface EntradaComposicaoNovoAgendamento {
  mensagem: {
    mensagem_recebida_id: string;
    message_id: string;
    claim_token: string;
  };

  contexto: {
    clinica_id: string;
    telefone_normalizado: string;
    conversa_id: string;
  };

  instante_atual: { data: string; minuto_min: number }; // ver disponibilidade-tipos.ts

  configuracao_clinica: ConfiguracaoClinicaMinima; // seção 4.1

  estado_oficial: EstadoConversaOficial; // controlador-conversacional-v1.md §9

  interpretacao: {
    alteracoes_aplicadas: AlteracoesDados; // src/core/tipos.ts, já existente
    conflitos_de_valor: Conflito[];
    eventos_candidatos: EventoCandidatoIA[]; // eventos-conversacionais-v1.md §1
  };

  dados_condicionais: DadosCondicionaisComposicao; // seção 4.2
}
```

Todos os identificadores vêm do Core. Nenhum vem da IA ou do paciente — mesma regra já
fixada em `controlador-conversacional-v1.md` §4.

### Sempre obrigatórios

- `mensagem_recebida_id`, `message_id`, `claim_token` — identidade e autorização da
  mensagem (`interpretacao-ia.md`);
- `clinica_id`, `telefone_normalizado`, `conversa_id` — identidade e isolamento
  (`novo-agendamento.md` §2, `persistencia-v1.md` §4);
- estado oficial e sua versão (`atualizado_em` ou equivalente) —
  `controlador-conversacional-v1.md` §9;
- indicação dos dois marcadores distintos de idempotência (seção 19): interpretação
  persistida e resultado da composição registrado — nunca um único indicador genérico
  de "mensagem já processada";
- `instante_atual` — data civil e minuto local já traduzidos pelo transporte; sem ele a
  composição não tem como cumprir `disponibilidade.md` §15 nem decidir avanço temporal;
- `configuracao_clinica` — seção 4.1;
- a interpretação já validada (`alteracoes_aplicadas`, `conflitos_de_valor`,
  `eventos_candidatos`), já persistida conforme `interpretacao-ia.md`.

### Condicionais

Fornecidos pelos adaptadores **somente quando o passo correspondente da ordem canônica
(seção 9) for alcançado** — nunca todos de uma vez, nunca antecipadamente:

- catálogo de procedimentos e aliases da clínica (`procedimentos-v1.md` §2);
- dentistas e vínculos da clínica para o procedimento resolvido
  (`dentistas-vinculos-v1.md` §2);
- configuração de duração da clínica para o procedimento resolvido (`duracao-v1.md`
  §1);
- snapshot diário de agenda (jornadas + indisponibilidades) de um dentista em uma data
  (seção 13.6).

### Proibidos como origem da IA

Nunca aceitos vindos da interpretação da mensagem, sob nenhuma circunstância — mesma
lista já fixada em `interpretacao-ia.md` ("Entrada e PII") e
`eventos-conversacionais-v1.md` §4, reafirmada aqui porque esta composição é quem
consome esses dados:

- `procedimento_id`, `dentista_id` ou qualquer identidade oficial;
- `duracao_min`;
- qualquer fato de disponibilidade ou horário calculado;
- versões lógicas (de estado, opções, escolha, resumo);
- `escolha`, status ou resultado operacional;
- autorização de confirmação;
- dados de catálogo (procedimentos, aliases, dentistas, vínculos);
- `instante_atual`;
- fuso horário.

### 4.1 Configuração mínima da clínica (decisão aprovada)

Contrato lógico mínimo, **fechado nesta rodada**, sem schema físico, tabela ou
migration — pseudotipo conceitual, não implementação:

```text
interface ConfiguracaoClinicaMinima {
  clinica_id: string;
  fuso: string; // IANA, ex. "America/Sao_Paulo" — exigido por disponibilidade.md §2
  exigir_email: boolean; // governa a coleta cadastral, seção 16
}
```

Nada além destes três campos é definido por esta spec. Identidades de usuário do
painel/apps, autenticação, e qualquer outro dado de configuração da clínica continuam
como pendência registrada em `persistencia-v1.md` §25 — este contrato não a fecha, só
declara os dois campos que a composição precisa **hoje** para funcionar.

Ausência de `fuso` é `configuracao_invalida` com `motivo: 'fuso_invalido'`, já um
resultado fechado de `resolverDisponibilidade` (`disponibilidade-tipos.ts`). A
composição não inventa fuso padrão nem assume UTC.

### 4.2 Dados condicionais — forma mínima

Pseudotipo conceitual, não implementação:

```text
interface DadosCondicionaisComposicao {
  catalogo?: { procedimentos: readonly ProcedimentoOficial[]; aliases: readonly AliasProcedimento[] };
  dentistas_e_vinculos?: { dentistas: readonly DentistaOficial[]; vinculos: readonly VinculoDentistaProcedimento[] };
  configuracoes_duracao?: readonly ConfiguracaoDuracao[];
  snapshot_diario?: { jornadas: readonly JornadaDentista[]; indisponiveis: readonly IntervaloIndisponivel[] };
}
```

Todos os tipos referenciados (`ProcedimentoOficial`, `AliasProcedimento`,
`DentistaOficial`, `VinculoDentistaProcedimento`, `ConfiguracaoDuracao`,
`JornadaDentista`, `IntervaloIndisponivel`) já existem, publicados, em
`src/core/procedimento-tipos.ts`, `src/core/dentista-tipos.ts`,
`src/core/duracao-tipos.ts` e `src/core/disponibilidade-tipos.ts`. Esta composição não
os redefine — apenas os consome como entrada de cada resolvedor correspondente.

## 5. Estado lógico mínimo

Seis estágios distintos, cada fato do estado pertencendo a exatamente um:

| Estágio | Significado | Exemplo |
|---|---|---|
| **informado** | Texto bruto do paciente na conversa, ainda não estruturado por campo | a mensagem original "quero limpeza amanhã de tarde" |
| **interpretado** | Estruturado por campo pela IA, ainda como texto — `AlteracoesDados` | `procedimento_texto: "limpeza"`, `data_texto: "amanhã"`, `periodo: "tarde"` |
| **resolvido** | Identidade oficial ou fato temporal estrutural, produzido por um resolvedor determinístico | `procedimento_id`, `dentista_id` (ou conjunto de aptos), data civil resolvida |
| **calculado** | Derivado de um `resolvido`, mas não é ele mesmo uma resolução de identidade | duração oficial aplicada, opções de disponibilidade geradas |
| **escolhido** | Selecionado pelo paciente dentre os `calculado` | a opção de horário aceita, com sua versão |
| **confirmado** | Autorização final vinculada ao resumo, seguida de criação | — |

**Nesta composição, nenhum dado recebe classificação `confirmado`.** O último comando
possível é `solicitar_confirmacao` (seção 8); o processamento de `confirmar_resumo` e
tudo que dele decorre pertence a `eventos-conversacionais-v1.md` §5 e acontece em um
turno posterior, fora desta composição (seção 3).

Necessidades lógicas mínimas — mesma lista de `controlador-conversacional-v1.md` §9 e
`persistencia-v1.md` §17, organizadas aqui pelo estágio a que pertencem:

| Campo | Estágio |
|---|---|
| versão do estado (`atualizado_em` ou equivalente) | — (metadado de concorrência, não um fato de domínio) |
| última mensagem processada (`message_id`) | — (metadado de idempotência, seção 19) |
| ação corrente (`novo_agendamento`) | — (metadado operacional do Core: estado de domínio da conversa, nunca fato informado pelo paciente nem dado extraído pela IA — o Core define e altera este campo ao decidir entrar ou sair de um fluxo, mesmo padrão de "fase da conversa" acima) |
| fase da conversa (`atendimento`, `aguardando_escolha`, `coletando_cadastro`, `aguardando_confirmacao`, `executando`, `concluido`) | — (metadado de máquina de estados, `novo-agendamento.md` §19) |
| dados informados (procedimento/dentista/data/período/horário — texto) | interpretado |
| dados resolvidos (procedimento oficial, dentista oficial ou critério de qualquer profissional, data civil, critérios temporais) | resolvido |
| duração oficial aplicada | calculado |
| opções apresentadas e sua versão lógica | calculado |
| escolha e sua versão lógica | escolhido |
| situação cadastral (dados acumulados + indicação dos obrigatórios faltantes) | informado/interpretado, por campo |
| contexto do resumo (versão do resumo, versão da escolha usada, indicação de apresentado) | — (nunca alcança `confirmado` nesta composição) |

Nenhuma dessas necessidades define coluna, tabela, JSON ou nome físico — mesma ressalva
já registrada em `controlador-conversacional-v1.md` §9 e `persistencia-v1.md` §17.

## 6. Alterações estruturadas

Fatos extraídos da mensagem atual pela IA, presentes em `AlteracoesDados`
(`src/core/tipos.ts`, `CampoDadosConversa`, já publicado):

- `intencao`;
- `procedimento_texto`;
- `dentista_texto`;
- `data_texto`;
- `periodo`;
- `horario_texto`;
- `nome`;
- `cpf`;
- `data_nascimento`;
- `email`.

**Restrição temporal** (`inicio_ate` / `termino_ate`, `disponibilidade.md` §13) é um
fato estruturado adicional, mas **ainda fora do contrato atual de `AlteracoesDados`**:
não existe hoje como campo de `CampoDadosConversa`. Ela nasce como saída do resolvedor
temporal já publicado e implementado (`resolvedor-temporal-v1.md`, seção 13.5), a
partir de uma expressão do tipo "antes das 11h" ou "preciso terminar até 11h" — a
extensão formal do contrato de interpretação para produzi-la como alteração
estruturada própria (`alteracoes_temporais`) está especificada em
`integracao-temporal-composicao-v1.md`, mas **não implementada**: decisão de uma
rodada de implementação futura, fora desta spec.

**Nenhum desses fatos é, por si só, um evento de transição.** Uma alteração estruturada
muda o que o paciente informou; ela nunca decide, sozinha, para onde a conversa vai —
essa decisão depende da avaliação de invalidação (seção 14) e da ordem canônica (seção
9).

## 7. Eventos candidatos

Catálogo fechado, exatamente os cinco já canônicos em `eventos-conversacionais-v1.md`
§1 — **nenhum evento novo é criado por esta composição**:

- `aceitar_opcao`;
- `solicitar_nova_opcao`;
- `desistir`;
- `aceitar_qualquer_profissional`;
- `confirmar_resumo`.

Explicitamente **não existem, e não devem ser inventados**. Cada um já é coberto —
alguns por serem fato, não evento; outros por já existirem sob outro nome:

| Nome que não existe | Natureza | Já coberto por |
|---|---|---|
| `informar_procedimento` | fato | alteração estruturada em `AlteracoesDados` (`procedimento_texto`, seção 6) |
| `informar_data` | fato | alteração estruturada em `AlteracoesDados` (`data_texto`/`periodo`/`horario_texto`, seção 6) |
| `informar_dado_cadastral` | fato | alteração estruturada em `AlteracoesDados` (`nome`/`cpf`/`data_nascimento`/`email`, seção 6), avaliada durante a coleta cadastral (seção 16) |
| `negar` | evento | conforme o contexto, já representado por `solicitar_nova_opcao` — recusar uma opção ou proposta apresentada é pedir alternativa, não um evento próprio de negação |
| `cancelar_acao_em_andamento` | evento | já representado por `desistir` — encerrar a ação corrente é exatamente o que `desistir` já significa (`eventos-conversacionais-v1.md` §2) |

Os três primeiros nunca são, por si só, transição — informar um dado é um fato,
avaliado pela invalidação (seção 14) e pela ordem canônica (seção 9), nunca uma decisão
de fluxo. Os dois últimos não introduzem comportamento novo: são apenas nomes
alternativos, nunca usados, para eventos que já existem sob o nome canônico.

A validação de cada candidato contra o estado, o contexto pendente e a compatibilidade
entre candidatos simultâneos permanece inteiramente a de
`controlador-conversacional-v1.md` §7–§8 e `eventos-conversacionais-v1.md` §3–§7 — esta
composição não redefine nenhuma regra de validade de evento, apenas consome
`DecisaoControlador` já produzida por elas.

## 8. Comandos determinísticos

O comando é o que esta composição decide que a etapa de atendimento deve fazer — nunca
o texto em si (`atendimento-v1.md` §1–§3 continua responsável pela redação). Cada
comando abaixo corresponde a uma ou mais das "Situações obrigatórias" já catalogadas em
`atendimento-v1.md` §5; esta seção não cria vocabulário paralelo, apenas nomeia, do
ponto de vista da composição, qual situação cada etapa do fluxo produz.

| Comando desta composição | Situação correspondente em `atendimento-v1.md` §5 |
|---|---|
| `pedir_procedimento` | "Procedimento não reconhecido" / "Pedido de procedimento" |
| `falha_tecnica_fechada` | "Catálogo inválido" |
| `propor_consulta_avaliacao` | "Oferta de Consulta/Avaliação" |
| `falha_sem_profissional` | "Nenhum dentista apto" |
| `pedir_preferencia_dentista` | "Vários dentistas aptos" |
| `informar_dentista_nao_localizado` | (parte de "Vários dentistas aptos" / "Dentista único", conforme o caso reaplicado) |
| `falha_duracao` | "Falha definitiva" (`duracao-v1.md` §6) |
| `pedir_dado_temporal` | "Pedido por período" / dado temporal faltante, ver seção 13.5 |
| `informar_periodo_indisponivel_e_alternativa` | "Data sem disponibilidade" (ramo de mesma data, outro período — `novo-agendamento.md` §9) |
| `informar_data_sem_opcao_e_perguntar` | "Data sem disponibilidade" (data específica) |
| `apresentar_opcoes` | "Pedido por período" / "Pedido por horário exato" |
| `informar_horario_exato_ocupado_com_vizinhos` | "Pedido por horário exato" (ocupado) |
| `reconhecer_escolha` | "Opção escolhida" |
| `pedir_nome` / `pedir_cpf` / `pedir_nascimento` / `pedir_email` | "Coleta de nome/CPF/nascimento/e-mail" |
| `informar_dado_invalido` | "Dado inválido" |
| `perguntar_atualizacao_telefone` | "CPF já existente em outro telefone" (`persistencia-v1.md` §6) |
| `solicitar_confirmacao` | "Resumo antes da confirmação" — **comando terminal desta composição** |
| `reconhecer_desistencia` | "Desistência" |

Nenhum comando desta lista executa efeito, decide texto ou acessa fato não autorizado —
a autorização dos fatos que acompanham cada comando segue inteiramente
`atendimento-v1.md` §2.

## 9. Ordem obrigatória dos cinco componentes

A ordem é fixa e determinística, executada uma vez por turno, a partir do ponto em que
a conversa já está (um fato `resolvido` ou `calculado` que continua válido não é
recalculado — só o que mudou ou o que ainda falta é processado):

1. aplicar alterações;
2. invalidar derivados (seção 14);
3. validar conflitos e eventos;
4. resolver procedimento;
5. resolver dentistas e vínculos;
6. resolver duração;
7. resolver critérios temporais pelo resolvedor temporal já publicado (seção 13.5);
8. obter snapshot diário autorizado;
9. resolver disponibilidade;
10. apresentar opções;
11. aguardar escolha;
12. verificar cadastro;
13. preparar resumo;
14. solicitar confirmação.

Nenhum passo desta lista reimplementa o algoritmo de um componente — cada passo é uma
chamada opaca ao resolvedor correspondente, tratando o resultado conforme a seção 13.

A dependência de dados entre os passos 4–6 é real: `resolverDentista` exige
`procedimento_id` já resolvido (passo 4); `resolverDuracao` exige o mesmo
`procedimento_id` (passo 4) e não depende do resultado do passo 5. A ordem entre os
passos 6 e 7 (duração antes de critérios temporais) não decorre de uma dependência de
dado — nenhum dos dois usa a saída do outro — e é fixada aqui apenas para determinismo
de execução, no mesmo espírito de `controlador-conversacional-v1.md` §6 ("A ordem é
fixa"). Os passos 8–9 dependem de ambos (duração define `duracao_min` da entrada de
`resolverDisponibilidade`; critérios temporais definem `data`, `modo` e, quando
aplicável, `periodo`/`restricao`).

## 10. Pseudocódigo

Transcrição de alto nível da seção 9, sem detalhar o algoritmo interno de nenhum
componente:

```text
composicao_novo_agendamento(entrada):
    // Tres casos distintos (secao 19) -- nunca uma condicao generica de
    // "mensagem ja processada".

    se resultado_da_composicao_ja_registrado(entrada.mensagem):        // Caso A
        devolver comando_e_versao_originais                            // replay verdadeiro
        parar

    se interpretacao_persistida(entrada.mensagem)
       e nao resultado_da_composicao_ja_registrado(entrada.mensagem):  // Caso B
        // identico ao Caminho B ja aprovado em interpretacao-ia.md:
        // nao chama a IA, nao executa preAplicar, nao reconstroi
        // eventos_candidatos nem conflitos_de_valor, nao retoma nem
        // executa esta composicao.
        produzir_resposta_fixa()
        parar  // aguardando nova mensagem do paciente

    // Caso C: nenhum dos dois marcadores -- fluxo normal, primeira execucao
    // desta composicao para a mensagem.

    estado = aplicar_alteracoes(entrada.estado_oficial, entrada.interpretacao.alteracoes_aplicadas)
    invalidados = invalidar_derivados(estado, alteracoes_efetivamente_persistidas)  // secao 14
    decisoes_evento = validar_eventos(estado, invalidados, entrada.interpretacao.eventos_candidatos)
        // controlador-conversacional-v1.md secoes 7-8; eventos-conversacionais-v1.md

    se procedimento nao resolvido:
        procedimento = resolverProcedimento(...)
        tratar_resultado_procedimento(procedimento)  // secao 13.1; pode parar aqui

    se dentista nao resolvido:
        dentista = resolverDentista(...)
        tratar_resultado_dentista(dentista)          // secao 13.2; pode parar aqui
                                                       // (inclui ramo Consulta/Avaliacao, secao 13.3)

    se duracao nao resolvida:
        duracao = resolverDuracao(...)
        tratar_resultado_duracao(duracao)            // secao 13.4; pode parar aqui

    se criterios temporais nao resolvidos:
        temporal = resolverTemporal(...)             // ja publicado, secao 13.5
        tratar_resultado_temporal(temporal)          // pode parar aqui

    se opcoes ainda nao apresentadas para os criterios vigentes:
        snapshot = obter_snapshot_diario(...)         // adaptador, condicional
        disponibilidade = resolverDisponibilidade(...)
        tratar_resultado_disponibilidade(disponibilidade)  // secao 13.6/13.7; pode parar aqui

        apresentar_opcoes(disponibilidade.opcoes)
        parar  // aguardando escolha (secao 12)

    se escolha ainda nao registrada:
        parar  // aguardando escolha (secao 12)

    se cadastro obrigatorio incompleto:
        pedir_proximo_dado_cadastral(ordem_fixa)     // secao 16
        parar

    resumo = preparar_resumo(escolha_vigente, cadastro_vigente)  // secao 17
    devolver solicitar_confirmacao(resumo)                        // secao 18 -- COMANDO TERMINAL
```

`tratar_resultado_*` nunca inventa um resultado que o resolvedor não devolveu, e nunca
ignora uma variante da união discriminada — a seção 13 lista o tratamento fechado de
cada uma.

### Fronteira pura — formalização futura

Este pseudocódigo descreve a **lógica** desta composição, mas não sua fronteira de
execução. `integracao-temporal-composicao-v1.md` (decisão `P3`, seção 5 daquele
documento) formaliza esta mesma ordem como uma **função pura**, sem I/O — cada `se ...
nao resolvido` que dependa de um dado condicional (catálogo, vínculos, configuração de
duração, snapshot diário) se torna, naquela formalização, uma requisição explícita
devolvida ao orquestrador, nunca uma leitura direta feita por esta função. Esta seção
não é reescrita: a fronteira pura é uma formalização adicional da mesma ordem, não uma
mudança de ordem ou de resultado.

## 11. Transições

Esta composição **não redefine** a máquina de estados. As seis fases
(`atendimento`, `aguardando_escolha`, `coletando_cadastro`, `aguardando_confirmacao`,
`executando`, `concluido`) e suas transições permanecem exatamente as de
`novo-agendamento.md` §19 e `controlador-conversacional-v1.md` §8.

O que esta seção fixa é a **correspondência** entre os comandos da seção 8 e a fase
resultante:

| Comando produzido | Fase resultante |
|---|---|
| `pedir_procedimento`, `falha_tecnica_fechada`, `falha_sem_profissional`, `pedir_preferencia_dentista`, `informar_dentista_nao_localizado`, `falha_duracao`, `pedir_dado_temporal`, `informar_periodo_indisponivel_e_alternativa`, `informar_data_sem_opcao_e_perguntar`, `propor_consulta_avaliacao` | permanece em `atendimento` |
| `apresentar_opcoes`, `informar_horario_exato_ocupado_com_vizinhos` | `atendimento → aguardando_escolha` (primeira apresentação) ou permanece em `aguardando_escolha` (nova apresentação) |
| `reconhecer_escolha` seguido de cadastro incompleto | `aguardando_escolha → coletando_cadastro` |
| `pedir_nome`/`pedir_cpf`/`pedir_nascimento`/`pedir_email` | permanece em `coletando_cadastro` |
| `solicitar_confirmacao` | `aguardando_escolha → aguardando_confirmacao` (cadastro já completo) ou `coletando_cadastro → aguardando_confirmacao` |
| `reconhecer_desistencia` | qualquer fase ativa `→ atendimento` |

Nenhuma linha desta tabela autoriza `→ executando`: essa transição exige
`autorizar_confirmacao_resumo`, fora do escopo desta composição (seção 3).

## 12. Pausas obrigatórias

Cada linha é um ponto em que a composição **para** e devolve um comando, sem processar
os passos seguintes da seção 9 no mesmo turno:

| # | Gatilho | Resultado do componente | Comando |
|---|---|---|---|
| 1 | Procedimento não resolvido | `nao_resolvido` (qualquer motivo) | `pedir_procedimento` |
| 2 | Erro de catálogo de procedimento | `erro_catalogo` | `falha_tecnica_fechada` |
| 3 | Zero dentistas aptos, Consulta/Avaliação ofertável | `nenhum_apto` + seletor D "encontrada" | `propor_consulta_avaliacao` |
| 4 | Zero dentistas aptos, sem Consulta/Avaliação ofertável | `nenhum_apto` + seletor D "nenhuma"/"múltiplas"/"inválida" | `falha_sem_profissional` |
| 5 | Vários dentistas aptos, sem preferência | `varios_aptos` | `pedir_preferencia_dentista` |
| 6 | Preferência não encontrada ou não apta | `preferencia_nao_encontrada`/`preferencia_nao_apta` | `informar_dentista_nao_localizado`, seguido da reaplicação de zero/um/vários (pode encadear com a linha 3, 4 ou 5, nunca com escolha silenciosa) |
| 7 | Erro de catálogo de dentista/vínculo | `erro_catalogo` | `falha_tecnica_fechada` |
| 8 | Duração ausente, inválida ou conflitante | `nao_configurada`/`invalida`/`erro_configuracao` | `falha_duracao` |
| 9 | Critérios temporais ausentes ou ambíguos | (resolvedor temporal já publicado, seção 13.5) | `pedir_dado_temporal` ou esclarecimento |
| 10 | Configuração da clínica inválida | `configuracao_invalida` com `motivo: 'fuso_invalido'` (ou outro) | `falha_tecnica_fechada` |
| 11 | Snapshot diário indisponível ou erro do adaptador | (seção 13.7) | `falha_tecnica_fechada` ou continuação silenciosa para a próxima data, conforme o caso |
| 12 | Sem disponibilidade, data específica | `sem_disponibilidade` (intenção `data_especifica`) | `informar_data_sem_opcao_e_perguntar` |
| 13 | Sem disponibilidade, mesma data, outro período tem opção | `sem_disponibilidade` no período pedido, `opcoes` em outro período do mesmo dia | `informar_periodo_indisponivel_e_alternativa` |
| 14 | Erro estrutural de disponibilidade | `erro_intervalos`/`configuracao_invalida` | `falha_tecnica_fechada` — **nunca** `informar_data_sem_opcao_e_perguntar` |
| 15 | Opções calculadas | `opcoes`/`horario_exato_disponivel`/`horario_exato_indisponivel` | `apresentar_opcoes` ou `informar_horario_exato_ocupado_com_vizinhos` |
| 16 | Escolha registrada, cadastro incompleto | — | `pedir_nome`/`pedir_cpf`/`pedir_nascimento`/`pedir_email`, um por vez, ordem fixa (seção 16) |
| 17 | Escolha vigente, cadastro completo | — | `solicitar_confirmacao` — **pausa terminal desta composição** |
| 18 | Resultado da composição já registrado para esta mensagem (seção 19) | — | devolve o comando e a versão do processamento original, sem recomputar nenhum passo — **nunca** disparada só por interpretação persistida (seção 19 distingue os dois) |

A linha 13 é a **única** pausa em que "sem disponibilidade" não é a resposta final do
turno — porque existe opção real em outro período do mesmo dia
(`novo-agendamento.md` §9). A linha 12 é a única pausa de disponibilidade em que a
composição **pergunta antes de avançar**; sob intenção `proxima_disponibilidade`, a
ausência de opção numa data não é pausa — a busca continua automaticamente (seção
13.7) até a linha 15 ou até um erro genuíno das linhas 10/11/14.

## 13. Tratamento de cada resultado de domínio

### 13.1 Procedimento (`ResultadoResolucaoProcedimento`, `src/core/procedimento-tipos.ts`)

| `tipo` | Tratamento |
|---|---|
| `resolvido` | Segue para dentistas (passo 5) com `procedimento_id`. |
| `nao_resolvido` | Pausa 1. Os quatro motivos internos (`texto_ausente`, `sem_correspondencia`, `alias_inativo`, `procedimento_inativo`) recebem **tratamento idêntico** — a composição nunca revela qual, mesma exigência de `procedimentos-v1.md` §7 e `atendimento-v1.md` §5 ("Procedimento não reconhecido"). |
| `erro_catalogo` | Pausa 2. Falha técnica interna — a composição nunca escolhe entre os `procedimento_ids` retornados, nunca pergunta ao paciente. |

### 13.2 Dentistas e vínculos (`ResultadoResolucaoDentista`, `src/core/dentista-tipos.ts`)

| `tipo` | Tratamento |
|---|---|
| `nenhum_apto` | Avalia o seletor de Consulta/Avaliação (seção 13.3) → pausa 3 ou 4. |
| `um_apto` | Define diretamente; segue para duração. **Nunca pergunta preferência, nunca anuncia redundantemente** (`novo-agendamento.md` §6, `atendimento-v1.md` §5 "Dentista único"). |
| `varios_aptos` | Pausa 5. |
| `preferencia_apta` | Define diretamente; segue para duração. |
| `preferencia_nao_encontrada` / `preferencia_nao_apta` | Pausa 6. **Tratamento idêntico ao paciente** entre os dois, e entre os motivos internos de `preferencia_nao_apta` (`dentista_inativo`/`sem_vinculo`/`vinculo_inativo`) — `dentistas-vinculos-v1.md` §4. A composição chama `resolverDentista` **novamente**, sem `dentista_texto`, para obter o conjunto de aptos e reaplicar zero/um/vários — nunca escolhe silenciosamente entre os aptos remanescentes. |
| `erro_catalogo` | Pausa 7. |

#### Sinal composto: `solicitar_nova_opcao` + `aceitar_qualquer_profissional`

Ramo explícito, distinto de todas as linhas da tabela acima: quando os dois candidatos
chegam **válidos e simultâneos** na mesma mensagem, avaliados em
`aguardando_escolha` (`controlador-conversacional-v1.md` §7, CTR-11, já canônico), a
composição:

1. invalida as opções vigentes;
2. invalida a escolha vigente;
3. invalida o resumo vigente;
4. remove a preferência específica de dentista;
5. preserva o procedimento, quando ainda válido, e **recalcula a duração por
   profissional** — ela depende do dentista (`duracao-v1.md` §0/§7, revisado em
   30/08/2026), então remover a preferência invalida a duração daquele dentista;
6. considera todos os dentistas ativos e aptos ao procedimento
   (`dentistas-vinculos-v1.md` §5, §10) — chamando `resolverDentista` sem
   `dentista_texto`, mesma chamada já usada na linha `preferencia_nao_encontrada` /
   `preferencia_nao_apta` acima;
7. processa um dentista por vez, na ordem determinística de `disponibilidade.md` §12 —
   horário mais próximo primeiro, desempate estável por `dentista_id`;
8. **nunca mistura horários de dentistas diferentes na mesma lista** apresentada;
9. **não escolhe nenhum dentista definitivamente por conta própria** — a autorização é
   para buscar entre todos os aptos, nunca para decidir por um deles;
10. continua o turno pela ordem canônica normal (seção 9) a partir do passo 8 (obter
    snapshot diário), com o novo conjunto de dentistas aptos e sem preferência.

Este ramo não cria evento, estado ou passo novo — é a aplicação, dentro da ordem desta
composição, da mesma regra já fixada em `controlador-conversacional-v1.md` §7 e
harmonizada em `eventos-conversacionais-v1.md` §6. Cenário de aceite: CTR-11 (já
canônico, `tests/cenarios-obrigatorios.md`) e COMP-19 (seção 22).

### 13.3 Consulta/Avaliação — seletor puro futuro (decisão aprovada, não implementada)

Entrada conceitual, pseudotipo — não implementação:

```text
interface EntradaSelecaoConsultaAvaliacao {
  clinica_id: string;
  procedimentos: readonly ProcedimentoOficial[]; // mesmo catálogo já usado por resolverProcedimento
}
```

Resultado conceitual, união fechada de quatro variantes, pseudotipo — não
implementação:

```text
type ResultadoSelecaoConsultaAvaliacao =
  | { tipo: 'encontrada'; procedimento_id: string }
  | { tipo: 'nenhuma_ativa' }
  | { tipo: 'multiplas_ativas'; procedimento_ids: readonly string[] }
  | { tipo: 'configuracao_invalida' };
```

`nome_pt` (`ProcedimentoOficial.nome_pt`) e o texto do paciente **nunca** participam
desta seleção — ela é feita exclusivamente pelo marcador `eh_consulta_avaliacao`
(`procedimentos-v1.md` §8), o mesmo campo já presente no catálogo consumido por
`resolverProcedimento`. `nenhuma_ativa` cobre tanto ausência quanto inatividade —
mesmo tratamento uniforme já usado pelos demais resolvedores (seção 13.1, 13.2).
`multiplas_ativas` é a violação da regra de unicidade de `procedimentos-v1.md` §8 (no
máximo um `eh_consulta_avaliacao = true` por clínica); `configuracao_invalida` cobre
outras violações estruturais (ex.: isolamento multiclínica no conjunto recebido) —
distinção análoga à já praticada entre `alias_ambiguo`/`alias_clinica_divergente`/
`procedimento_id_inconsistente` em `procedimento-tipos.ts`. Sub-classificação mais fina
de `configuracao_invalida`, se necessária, é decisão de rodada futura.

Regras de uso, herdadas sem alteração de `novo-agendamento.md` §6 e
`dentistas-vinculos-v1.md` §12:

1. só é avaliado quando o `procedimento_id` **já resolvido** não for, ele mesmo, o
   procedimento Consulta/Avaliação;
2. exige `tipo: 'encontrada'` **e** ao menos um dentista apto para esse
   `procedimento_id` (nova chamada a `resolverDentista` com o `procedimento_id` da
   Consulta/Avaliação);
3. a substituição do procedimento pedido pela Consulta/Avaliação só ocorre depois de
   `aceitar_opcao` explícito e validado — nunca automática;
4. **se o procedimento já pedido é, ele mesmo, Consulta/Avaliação e não há dentista
   apto**: não avaliar este seletor de novo, não criar ciclo — pausa 4 diretamente.

**Não implementado nesta rodada.** Nenhuma verificação de duplicidade de agendamento
já existente participa deste seletor — isso excederia sua responsabilidade (mesmo
limite já aplicado e confirmado em rodada anterior do resolvedor de duração, que não
verifica duplicidade de Consulta/Avaliação).

### 13.4 Duração (`ResultadoResolucaoDuracao`, `src/core/duracao-tipos.ts`)

| `tipo` | Tratamento |
|---|---|
| `resolvida` | Segue para critérios temporais (passo 7), carregando `duracao_min`. |
| `nao_configurada` / `invalida` / `erro_configuracao` | Pausa 8. Falha fechada idêntica ao paciente entre os três — `duracao-v1.md` §6: nunca 60 minutos, nunca Consulta/Avaliação por este motivo, nunca reclassifica dentista apto como inapto, nunca consulta disponibilidade. |

### 13.5 Resolução temporal (`resolvedor-temporal-v1.md`, publicado e implementado)

Responsabilidade explicitamente **fora do controlador**: um resolvedor puro e
separado, quinto componente de domínio já publicado (junto de procedimento,
dentistas/vínculos, duração e disponibilidade), converte fatos temporais já
interpretados (produzidos pela IA) em fatos temporais oficiais (estruturados,
produzidos deterministicamente pelo Core) — nunca o inverso.

Posição na ordem canônica: passo 7 da seção 9, entre duração (passo 6) e obtenção do
snapshot diário (passo 8) — sem alteração desta rodada.

**Contrato completo, entrada, saída, taxonomia de motivos e matriz de cenários:
`resolvedor-temporal-v1.md`.** Esta composição não duplica esse contrato — apenas
consome seus resultados, conforme o tratamento já descrito na seção 13.

**O resolvedor temporal está implementado (`src/core/resolver-temporal.ts`). A
integração dele com esta composição — como a interpretação produzirá os fatos
temporais que o alimentam, como o estado oficial os acumula entre mensagens, e como a
composição se torna uma máquina de estados pura que o chama — está especificada em
`integracao-temporal-composicao-v1.md`, também **não implementada nesta rodada**. Esta
composição em si permanece apenas especificada.**

### 13.6 Disponibilidade — modo `grade` e `horario_exato` (`ResultadoDisponibilidade`, `src/core/disponibilidade-tipos.ts`)

| `tipo` | Tratamento |
|---|---|
| `opcoes` | Pausa 15, comando `apresentar_opcoes`. Todas as opções da lista, sem cap, sem paginação, sem truncamento (`disponibilidade.md` §8). |
| `sem_disponibilidade` | Ramifica pela intenção temporal (ver seção 13.7 para `proxima_disponibilidade`; pausa 12 ou 13 para `data_especifica`). |
| `horario_exato_disponivel` | Pausa 15, apresentado como opção única. |
| `horario_exato_indisponivel` | Pausa 15, comando `informar_horario_exato_ocupado_com_vizinhos`, com `anterior`/`posterior` exatamente como devolvidos — nunca inventando um vizinho ausente. |
| `configuracao_invalida` | Pausa 10 ou 14, `falha_tecnica_fechada`, conforme o `motivo` (`duracao_invalida`, `data_invalida`, `fuso_invalido`, `horario_solicitado_invalido`, `restricao_invalida`, `instante_atual_invalido`, `sem_jornada`). |
| `erro_intervalos` | Pausa 14, `falha_tecnica_fechada`. **Nunca** tratado como `sem_disponibilidade` — distinção estrutural obrigatória (seção 20). |

A composição chama `resolverDisponibilidade` **uma vez por dentista, por data** —
nunca combinando dentistas na mesma chamada (`disponibilidade.md` §12) — e, quando o
paciente aceitou qualquer profissional, processa um dentista de cada vez, na ordem
determinística já fixada (horário mais próximo primeiro, desempate por `dentista_id`
em ordem estável), avançando para o próximo apto somente após rejeição de todas as
opções do atual (`controlador-conversacional-v1.md` §7).

### 13.7 Próxima disponibilidade — protocolo continuável (decisão aprovada, não implementada)

`resolverDisponibilidade` é estritamente **diário** — nunca atravessa datas
(`disponibilidade-tipos.ts`, docstring de `ModoConsulta`). A busca **entre** dias
pertence inteiramente ao controlador, nunca ao gerador. Esta seção define o protocolo
conceitual pelo qual a composição orquestra várias chamadas diárias sem introduzir
horizonte artificial (`disponibilidade.md` §11).

Protocolo, do ponto de vista da composição:

1. solicitar ao adaptador o snapshot diário de uma data (a solicitada, ou a próxima
   candidata em ordem cronológica);
2. o adaptador devolve um de quatro resultados conceituais:
   - **dados disponíveis** para a data — a composição chama `resolverDisponibilidade`
     normalmente para essa data;
   - **sem dados, mas buscável** — nenhuma jornada configurada nessa data específica,
     mas a busca pode continuar para a próxima data sem que isso signifique fim de
     disponibilidade;
   - **fim estrutural do conjunto consultável** — o adaptador não tem mais nenhum dado
     configurado além deste ponto (ausência estrutural de agenda,
     `disponibilidade.md` §11: "Somente falha técnica, configuração inválida ou
     ausência estrutural de agenda interrompe a continuidade") — **nunca** um corte
     semântico de 30/60 dias;
   - **erro do adaptador** — falha técnica, tratada como pausa 11/14;
3. quando `resolverDisponibilidade` (modo `grade` ou `proximo_disponivel`) devolve
   `opcoes` para a data corrente, a busca para ali — pausa 15;
4. quando devolve `sem_disponibilidade`, a busca avança automaticamente para a próxima
   data cronológica, sem exigir nova data do paciente — **somente sob intenção
   `proxima_disponibilidade`**; sob `data_especifica`, a ausência de opção na data
   pedida é pausa 12, e o avanço para outra data exige autorização explícita do
   paciente (`novo-agendamento.md` §9);
5. após rejeição de todas as opções apresentadas, a busca continua a partir do dia
   seguinte, preservando procedimento, dentista(s) e demais critérios vigentes —
   nunca reiniciando do zero;
6. um bloco técnico de consulta (ex.: 7 dias por vez) pode existir na implementação
   futura, desde que: o tamanho do bloco nunca vire regra de produto; o fim de um
   bloco nunca seja comunicado como fim de disponibilidade; a continuação entre blocos
   seja transparente ao paciente (`disponibilidade.md` §11).

**Sem_disponibilidade por si só nunca é o resultado final do turno sob
`proxima_disponibilidade`** — só um erro genuíno (pausa 10/11/14) ou a chegada ao fim
estrutural do item 2 encerram a busca sem opção.

**Não implementado nesta rodada.** Nenhum adaptador, mecanismo de paginação física ou
limite de bloco é definido com valor concreto por esta spec.

## 14. Invalidação de derivados

Matriz de invalidação, consolidando sem alterar as regras já aprovadas em
`controlador-conversacional-v1.md` §10, `duracao-v1.md` §8 e
`eventos-conversacionais-v1.md` §5:

| Fato alterado | Invalida |
|---|---|
| Procedimento | procedimento resolvido, dentista, duração, disponibilidade, opções, escolha e resumo |
| Dentista ou preferência | dentista resolvido, **duração**, disponibilidade, opções, escolha e resumo — a duração é do dentista, então trocar de profissional a invalida e exige recalcular (`duracao-v1.md` §0/§1, revisado 30/08/2026) |
| Data | data resolvida, disponibilidade, opções, escolha e resumo |
| Período, restrição ou horário | disponibilidade, opções, escolha e resumo |
| Nova apresentação de opções | opções anteriores, escolha e resumo |
| Nova escolha | resumo |
| Cadastro (nome/CPF/nascimento/e-mail) | resumo — **escolha é preservada** |
| Duração oficial (mudança na configuração da clínica) | disponibilidade, opções, escolha e resumo |
| Sinal composto `solicitar_nova_opcao` + `aceitar_qualquer_profissional` | opções, escolha e resumo; preferência específica de dentista removida — **procedimento preservado, duração recalculada por profissional** (ela é do dentista, revisado 30/08/2026); busca segue com todos os dentistas aptos, um por vez, cada um com a duração dele, em ordem determinística (descrição completa em §13.2, "Sinal composto") |
| Desistência | todos os dados operacionais da ação encerrada — **cadastro válido é preservado** |

**Opção antiga nunca pode ser promovida** por texto, posição, horário coincidente ou
versão anterior — mesma proibição explícita já registrada em `persistencia-v1.md` §17
e refletida em ESC-04 (`tests/cenarios-obrigatorios.md`). Uma opção só é válida quando
pertence à versão vigente da lista apresentada.

Mudança **superficial** de texto que preserve a mesma identidade oficial (ex.: mesmo
`dentista_id` mencionado com grafia diferente) não invalida nada — mesma ressalva já
registrada em `controlador-conversacional-v1.md` §10 e `duracao-v1.md` §8.

## 15. Escolha de opção

Uma opção só é considerada escolhida mediante `aceitar_opcao` explícito, resolvido
contra exatamente uma opção vigente da lista apresentada (`novo-agendamento.md` §11).
Referência ambígua produz esclarecimento, nunca escolha registrada
(`eventos-conversacionais-v1.md` §7).

A escolha registra: dentista, procedimento, data, início, fim e duração — os mesmos
campos que `OpcaoHorario` (`disponibilidade-tipos.ts`) já carrega, mais a versão lógica
da lista de opções da qual a escolha foi extraída (seção 5). O horário escolhido
**não** representa agendamento criado (`novo-agendamento.md` §11).

## 16. Coleta cadastral

Somente após existir escolha registrada (pausa 16). Ordem fixa, aprovada nesta rodada:

1. nome;
2. CPF;
3. data de nascimento;
4. e-mail — **somente quando `configuracao_clinica.exigir_email = true`**.

Regras:

- paciente novo → solicitar todos os obrigatórios que faltarem, nesta ordem;
- paciente existente → solicitar somente os obrigatórios que estiverem incompletos,
  respeitando a mesma ordem entre os que faltam;
- um dado já presente e válido — informado na conversa atual ou já existente no
  cadastro — **não é pedido novamente**;
- correção explícita de um dado cadastral **invalida o resumo** (seção 14), mas nunca
  a escolha de horário vigente;
- a escolha de horário é preservada durante toda a coleta cadastral — nenhum dos
  quatro passos desta seção reabre disponibilidade.

Validação de formato de cada campo (nome, CPF, data de nascimento, e-mail) permanece
inteiramente a de `novo-agendamento.md` §12 — esta seção define **ordem**, nunca regra
de validação. **Validação de CPF e persistência de paciente não são implementadas
nesta rodada** — pertencem a `persistencia-v1.md` §5 e a uma rodada de implementação
futura.

## 17. Preparação do resumo

Disparada exclusivamente quando existe escolha vigente **e** cadastro obrigatório
completo (pausa 17, seja vindo de `aguardando_escolha` diretamente ou de
`coletando_cadastro`).

O resumo contém exatamente os fatos oficiais já fixados em `novo-agendamento.md` §13 e
`eventos-conversacionais-v1.md` §5:

- procedimento;
- dentista;
- data;
- início;
- fim;
- duração;
- cadastro obrigatório.

Nenhum fato fora desta lista compõe o resumo. Nenhum dado interpretado (texto do
paciente) participa — só fatos resolvidos/calculados/escolhidos, conforme os estágios
da seção 5.

## 18. Ponto de solicitar confirmação

`solicitar_confirmacao` é o **último comando** que esta composição pode produzir.
Antes de emiti-lo, a composição garante:

- escolha vigente, com versão;
- cadastro obrigatório completo e válido;
- resumo preparado (seção 17), vinculado à versão da escolha usada;
- ausência de conflito de valor pendente que possa alterar os fatos do resumo
  (`controlador-conversacional-v1.md` §11).

Depois de emitido `solicitar_confirmacao`, a fase é `aguardando_confirmacao`
(`novo-agendamento.md` §19). O processamento de uma eventual mensagem seguinte contendo
`confirmar_resumo` — os dez gates de `autorizar_confirmacao_resumo`
(`eventos-conversacionais-v1.md` §5), a transição para `executando`, a revalidação
técnica e a criação — **não pertencem a esta composição** (seção 3). Uma nova execução
desta composição, num turno posterior, só volta a ser relevante se um fato invalidante
(seção 14) mudar o resumo antes da confirmação, ou se a confirmação falhar e o fluxo
retornar a `aguardando_escolha` (`novo-agendamento.md` §14).

## 19. Idempotência conceitual

Distinta da idempotência **operacional** já definida em `persistencia-v1.md` §21–§23
(identidade de ação para criação/cancelamento/remarcação, com `OperacaoIdempotente`
própria) — esta seção trata da idempotência da **composição em si**, no nível da
mensagem.

**Dois marcadores distintos, nunca confundidos.** A correção desta rodada existe
porque a versão anterior tratava os dois como se fossem o mesmo fato.

### Interpretação persistida

Significa exatamente o que `interpretacao-ia.md` já define para
`interpretacao_persistida_em`: a saída **validada da interpretação** (alterações e
eventos candidatos) foi registrada — nada além disso.

**Interpretação persistida não prova**:

- que esta composição foi executada;
- que o estado da conversa avançou além da interpretação;
- que um comando (seção 8) foi produzido;
- que existe resultado original disponível para devolver em caso de repetição.

Uma queda pode ocorrer depois de `interpretacao_persistida_em` preenchido e antes de
esta composição concluir seu próprio processamento (seção 19, "Queda intermediária"
abaixo) — nesse intervalo, a interpretação já é oficial, mas nenhum comando desta
composição existe ainda.

### Resultado da composição registrado

Marcador lógico **distinto e adicional**, preenchido somente quando esta composição
concluiu as 14 etapas da seção 9 (ou parou numa pausa da seção 12) e produziu um
comando. É a **única** condição que autoriza recuperar, sem recomputar:

- o comando original (seção 8);
- a versão do estado recebida como entrada;
- a versão do estado proposta como resultado;
- o resultado lógico original, por completo.

### Por que "continuar a composição" não é possível sem resultado registrado

`eventos_candidatos` e `conflitos_de_valor` são, pelo contrato já aprovado em
`interpretacao-ia.md` ("Conflitos" → "Conflitos durante o processamento normal"),
**transitórios**: existem somente em memória, no worker que processa a mensagem agora,
e **nunca são persistidos**. `interpretacao_persistida_em` preenchido garante apenas
que `alteracoes_aplicaveis` chegou a `estado_conversa.dados` — não devolve
`eventos_candidatos` nem `conflitos_de_valor` de uma execução anterior, porque eles
nunca existiram fora da memória daquele worker.

Por isso uma nova execução, encontrando `interpretacao_persistida_em` preenchido e
nenhum resultado da composição registrado, **não tem material para retomar a
composição**: não há eventos candidatos para reavaliar, não há conflitos para
reconsiderar, e reconstruí-los exigiria chamar a IA de novo — proibido depois da
persistência (`interpretacao-ia.md`, "Política de tentativas"). A única saída correta é
a mesma já aprovada para esse exato ponto do fluxo: `interpretacao-ia.md`, Caminho B.

### Regra correta de repetição

Quando esta composição é chamada novamente para a mesma mensagem, exatamente três
casos, nunca um único código genérico de "mensagem já processada":

1. **resultado da composição já registrado** → recuperar o resultado original e
   devolvê-lo, **sem recomputar** nenhuma das 14 etapas, sem chamar nenhum dos cinco
   componentes. Único caso de replay verdadeiro.
2. **interpretação persistida, sem resultado da composição registrado** → **não retomar
   esta composição**. Comportamento idêntico ao Caminho B já aprovado em
   `interpretacao-ia.md`: não chamar a IA novamente; não executar `preAplicar`; não
   reconstruir `eventos_candidatos` nem `conflitos_de_valor`; não executar o
   controlador/esta composição; produzir somente a resposta fixa
   ("Não consegui processar sua mensagem agora. Pode tentar novamente?"); aguardar nova
   mensagem do paciente. **Não há comando anterior para devolver, e nenhum é
   inventado.**
3. **nenhum dos dois marcadores** → fluxo normal: esta composição executa a ordem
   canônica (seção 9) pela primeira vez para essa mensagem.

Alterações oficiais persistidas (`alteracoes_aplicaveis`, já em `estado_conversa.dados`)
**não equivalem** à saída completa e recuperável da interpretação — elas são só a
fração que `aplicarInterpretacaoCondicional` já grava; `eventos_candidatos` e
`conflitos_de_valor` continuam fora desse conjunto, permanecendo transitórios no
contrato atual. A resposta fixa do caso 2 é **limitação deliberada da v1**, herdada sem
alteração de `interpretacao-ia.md` ("Limitação aceita") — não uma lacuna desta
composição.

### Persistência física futura

**A persistência física do resultado da composição será especificada
posteriormente** — esta seção fixa somente a exigência lógica do caso 1, nunca schema,
tabela ou coluna. Quando essa especificação existir, ela deverá registrar, na mesma
transação, tanto a transição de estado quanto o resultado da composição (comando +
versão) — atomicamente, no mesmo espírito de `persistencia-v1.md` §23 ("`concluida`
implica que o efeito existe... na mesma transação"), nunca um sem o outro.

Uma futura arquitetura poderá avaliar persistência recuperável de
`eventos_candidatos`/`conflitos_de_valor` — o que tornaria o caso 2 substituível por um
verdadeiro retomar de composição — mas isso **não faz parte desta v1** e não é criado
por esta especificação. Não criar, nesta rodada: persistência recuperável de eventos
candidatos; persistência recuperável de conflitos; vínculo recuperável com versão
antiga do estado; CAS específico de retomada; reexecução da composição após queda
intermediária.

Até essa especificação futura existir, o comportamento efetivamente implementado em
caso de recuperação após queda **antes** de `interpretacao_persistida_em` continua
sendo exatamente o já aprovado em `interpretacao-ia.md` (reclaim pode interpretar); em
caso de recuperação **depois** de `interpretacao_persistida_em` sem resultado da
composição registrado, aplica-se o caso 2 acima, também sem alteração ao contrato já
aprovado — esta seção não substitui nem contradiz `interpretacao-ia.md`, apenas
registra, adicionalmente, a exigência lógica de um segundo marcador (resultado da
composição) para quando ele existir.

### Queda intermediária

Cenário obrigatório, coberto pelo caso 2 acima e alinhado — sem alteração — ao Caminho
B já aprovado em `interpretacao-ia.md`: queda ocorrida **depois** de
`interpretacao_persistida_em` preenchido e **antes** de esta composição concluir e
registrar seu resultado.

Tratamento — idêntico ao Caminho B, sem exceção:

- a interpretação já persistida **não é refeita** — nenhuma nova chamada à IA;
- `preAplicar` **não é executado novamente**;
- `eventos_candidatos` e `conflitos_de_valor` **não são reconstruídos** — nunca
  existiram fora da memória do worker que caiu;
- esta composição **não é retomada** e não é executada a partir da interpretação
  persistida;
- **nenhum comando anterior é inventado ou presumido**;
- produz-se a resposta fixa já aprovada;
- aguarda-se nova mensagem do paciente para continuar o fluxo, que então seguirá a
  ordem canônica (seção 9) normalmente, como mensagem nova.

Ver COMP-20 (seção 22).

## 20. Erros fechados

Toda pausa por falha (seção 12) carrega um código fechado, nunca mensagem livre como
classificação — mesma disciplina já aplicada pelos cinco componentes publicados.

| Categoria | Fonte canônica | Resultado do componente |
|---|---|---|
| Entrada inválida (violação de contrato de forma) | `EntradaInvalidaError` (`src/core/erros.ts`), já usado pelos cinco resolvedores | lançamento controlado, nunca resultado tipado |
| Evento incompatível | `eventos-conversacionais-v1.md` §1, §3 | `DecisaoControlador` com `resultado: 'ignorar'` ou `'solicitar_esclarecimento'` |
| Conflito de valor | `interpretacao-ia.md` ("Conflitos") | conflito calculado por `preAplicar`, em memória |
| Conflito concorrente | `interpretacao-ia.md` ("Concorrência") | `conflito_concorrente`; invalida toda a interpretação |
| Procedimento não resolvido | `procedimentos-v1.md` §7 | `ResultadoResolucaoProcedimento.tipo: 'nao_resolvido'` |
| Erro de catálogo (procedimento ou dentista) | `procedimentos-v1.md` §6, `dentistas-vinculos-v1.md` §6 | `tipo: 'erro_catalogo'` |
| Preferência não apta | `dentistas-vinculos-v1.md` §4 | `tipo: 'preferencia_nao_encontrada'`/`'preferencia_nao_apta'` |
| Duração ausente, inválida ou conflitante | `duracao-v1.md` §6 | `tipo: 'nao_configurada'`/`'invalida'`/`'erro_configuracao'` |
| Data ou horário não resolvido | `resolvedor-temporal-v1.md` §17–§21 (publicado; integração — `integracao-temporal-composicao-v1.md`) | `tipo: 'incompleto'`/`'ambiguo'`/`'invalido'`/`'passado'`/`'conflito'`/`'erro_configuracao'` |
| Configuração da clínica inválida | seção 4.1 | `ResultadoDisponibilidade.tipo: 'configuracao_invalida'` |
| Snapshot inválido | seção 13.7 (futuro) | erro do adaptador |
| Erro de intervalos | `disponibilidade.md` §3 | `tipo: 'erro_intervalos'` |
| Sem disponibilidade na data | `disponibilidade.md` §10–§11 | `tipo: 'sem_disponibilidade'` — **nunca confundido com erro estrutural** |
| Opção obsoleta | `persistencia-v1.md` §17, ESC-04 | escolha recusada; nunca promovida |
| Interpretação já persistida, sem resultado da composição registrado | seção 19 (Caso B) | `interpretacao_persistida_em` preenchido (`interpretacao-ia.md`), sem marcador de resultado da composição; esta composição **não é retomada** — resposta fixa, idêntica ao Caminho B de `interpretacao-ia.md`; aguarda nova mensagem |
| Resultado da composição já registrado | seção 19 (Caso A) | marcador lógico distinto e adicional; único que autoriza recuperar comando, versão recebida e versão proposta sem recomputar — **único caso de replay verdadeiro** |
| Mensagem repetida com replay disponível | seção 19, pausa 18 | consequência observável do Caso A ser verdadeiro para o `message_id` recebido — comando e versão originais devolvidos |
| Resposta fixa após queda intermediária | seção 19 ("Queda intermediária") | consequência observável do Caso B — mesma resposta fixa já aprovada em `interpretacao-ia.md`, nunca um comando inventado |

**Nunca transformar erro estrutural em indisponibilidade.** `erro_intervalos` e
`configuracao_invalida` são falhas técnicas fechadas (`falha_tecnica_fechada`);
`sem_disponibilidade` é um resultado de domínio legítimo, que pode ou não encerrar o
turno dependendo da intenção temporal (seção 13.6, 13.7). Confundir os dois faria a
composição comunicar ao paciente uma indisponibilidade que não existe, ou ocultar uma
falha técnica real como se fosse agenda cheia.

## 21. Isolamento multiclínica

Toda chamada a qualquer um dos cinco componentes e ao futuro seletor de
Consulta/Avaliação carrega `clinica_id` — sempre o mesmo, sempre derivado da instância
autenticada do WhatsApp (`novo-agendamento.md` §2), nunca do paciente ou da IA.

- catálogo, aliases, dentistas, vínculos, configuração de duração e snapshot diário
  recebidos de outra clínica nunca influenciam o resultado desta composição — mesma
  garantia já provada nos cinco resolvedores publicados (filtro por escopo antes de
  qualquer avaliação);
- identificador de outra clínica é tratado como inexistente, nunca como acesso negado
  (`persistencia-v1.md` §4);
- nenhuma informação administrativa de outra clínica é revelada, nem por mensagem de
  erro, nem por "não encontrado" que insinue existência alhures
  (`dentistas-vinculos-v1.md` §11).

## 22. Cenários obrigatórios de teste

Esta seção é um **índice**, não uma suíte executável — nenhum teste é criado por esta
rodada. Segue a mesma disciplina de `tests/cenarios-obrigatorios.md`: cenários já
cobertos por specs de domínio são **referenciados**, nunca duplicados.

### Já cobertos, referenciados sem duplicação

| Domínio | IDs em `tests/cenarios-obrigatorios.md` |
|---|---|
| Procedimento | PRO-01 a PRO-09 |
| Dentistas e vínculos | DEN-01 a DEN-10 |
| Duração | DUR-01 a DUR-09 |
| Disponibilidade | DIS-01 a DIS-22 |
| Escolha e versões | ESC-01 a ESC-05 |
| Cadastro | CAD-01 a CAD-07 |
| Confirmação | CNF-01 a CNF-06 |
| Eventos candidatos | EVT-01 a EVT-09 |
| Controlador e transições | CTR-01 a CTR-15 |
| Ausência de PII em erros | LOG-01 a LOG-08, INT-11 a INT-14 |
| Multiclínica | MUL-01 a MUL-06 |

### Novos — específicos desta composição (prefixo `COMP-`)

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| COMP-01 | Ordem dos 14 passos respeitada mesmo com múltiplos fatos já resolvidos | U | Passo já resolvido não é recalculado; passo pendente é processado na ordem fixa |
| COMP-02 | Múltiplas alterações no mesmo turno (ex.: procedimento e data juntos) | U | Cascata de invalidação da seção 14 aplicada para ambos, sem ordem-dependência |
| COMP-03 | Alteração de procedimento após opções apresentadas | U | Opções, escolha e resumo invalidados; dentista e duração recalculados |
| COMP-04 | Alteração de dentista, mesmo procedimento | U | **Duração recalculada** para o novo profissional (é dele, revisado 30/08/2026); disponibilidade recalculada |
| COMP-05 | Correção cadastral durante `aguardando_confirmacao` | U | Escolha preservada; resumo invalidado; nova confirmação exigida |
| COMP-06 | `sem_disponibilidade` sob `data_especifica` | U | Pausa 12; nunca avança sozinho |
| COMP-07 | `sem_disponibilidade` sob `proxima_disponibilidade` | U | Avança automaticamente; nunca é resposta final do turno isoladamente |
| COMP-08 | `erro_intervalos` nunca vira "sem disponibilidade" | U | `falha_tecnica_fechada`, distinto de `informar_data_sem_opcao_e_perguntar` |
| COMP-09 | Zero dentistas aptos com Consulta/Avaliação ofertável | U | `propor_consulta_avaliacao`; substituição só após `aceitar_opcao` |
| COMP-10 | Zero dentistas aptos sem Consulta/Avaliação ofertável | U | `falha_sem_profissional`; nenhuma disponibilidade consultada |
| COMP-11 | Preferência não apta reaplica zero/um/vários | U | Segunda chamada a `resolverDentista` sem `dentista_texto`; nunca escolha silenciosa |
| COMP-12 | Desistência explícita | U | Dados operacionais limpos; cadastro válido preservado; volta a `atendimento` |
| COMP-13 | Candidatos incompatíveis na mesma mensagem | U | Esclarecimento solicitado; nenhuma transição de alto risco |
| COMP-14 | Resultado da composição já registrado para a mensagem | I | Comando e versão originais devolvidos; nenhum componente chamado novamente; nenhuma alteração reaplicada |
| COMP-15 | Opção obsoleta reapresentada por texto ou posição | U | Recusada; nunca promovida |
| COMP-16 | Isolamento multiclínica em toda a composição | S | Nenhum dado de outra clínica influencia qualquer passo |
| COMP-17 | PII restrita ao necessário | S | Nenhum dado cadastral em erro, falha estrutural, log ou telemetria; dado cadastral só aparece no `solicitar_confirmacao`, e só o conjunto estritamente exigido pelo resumo (seção 17) |
| COMP-18 | Composição nunca produz comando além de `solicitar_confirmacao` | U | Nenhuma execução, nenhuma transição para `executando` |
| COMP-19 | Sinal composto `solicitar_nova_opcao` + `aceitar_qualquer_profissional` | U | Ramo da seção 13.2: opções/escolha/resumo invalidados, preferência removida, procedimento preservado e duração recalculada por profissional, todos os aptos considerados um por vez, nenhuma escolha silenciosa (ver também CTR-11) |
| COMP-20 | Queda entre interpretação persistida e composição ainda não concluída (nenhum resultado da composição registrado) | I | IA não é chamada novamente; `preAplicar` não é executado novamente; `eventos_candidatos`/`conflitos_de_valor` não são reconstruídos; esta composição **não é retomada**; nenhum comando anterior é inventado; resposta fixa emitida; aguarda nova mensagem — **não é replay** |

### Futuros — dependem de implementação ainda não feita (prefixo `TMP-`, resolvedor temporal)

Cobertura futura, não aplicável ao aceite desta rodada — mesma convenção do marcador
**†** já usada em `tests/cenarios-obrigatorios.md` para cancelamento/remarcação.
`resolvedor-temporal-v1.md` já especifica o resolvedor temporal por completo,
inclusive a correspondência exata destes seis IDs com sua própria matriz (TMP-01↔TMP-13,
TMP-02↔TMP-32, TMP-03↔TMP-33, TMP-06↔TMP-55; TMP-04/TMP-05 correspondem,
respectivamente, às famílias `ambiguo`/`invalido` daquela matriz).

**O resolvedor temporal em si já está implementado, e os quatro IDs correspondentes
(TMP-13, TMP-32, TMP-33, TMP-55) e as famílias `ambiguo`/`invalido` já têm cobertura
executável direta em `src/core/resolver-temporal.test.ts`.** Os seis seguem marcados
† nesta matriz por um motivo diferente do original: não é o resolvedor que falta, é
**esta composição** — o cenário TMP-01 a TMP-06, tal como listado aqui, exercita o
resolvedor **através da orquestração desta composição** (ordem canônica, seção 9), e
essa orquestração ainda não existe. A integração entre os dois, incluindo como a
composição chamará o resolvedor, está especificada (não implementada) em
`integracao-temporal-composicao-v1.md`.

| ID | Cenário | Nível |
|---|---|---|
| TMP-01 † | Data relativa resolvida no fuso da clínica | U |
| TMP-02 † | "Antes das 11h" produz `restricao: inicio_ate` | U |
| TMP-03 † | "Preciso terminar até 11h" produz `restricao: termino_ate` | U |
| TMP-04 † | Expressão temporal ambígua | U |
| TMP-05 † | Expressão temporal inválida | U |
| TMP-06 † | Duas clínicas em fusos diferentes, mesma mensagem simultânea | S |

## 23. Invariantes

- Esta composição nunca reimplementa o algoritmo de nenhum dos cinco componentes
  publicados — apenas orquestra a ordem de chamada e o tratamento do resultado.
- A ordem dos 14 passos da seção 9 é fixa; um fato já `resolvido`/`calculado` que
  continua válido nunca é recalculado.
- Alterações estruturadas e eventos candidatos permanecem conceitos distintos; nenhum
  evento novo é criado; nenhuma alteração estruturada é tratada como transição por si
  só.
- O catálogo de eventos candidatos permanece fechado em cinco: `aceitar_opcao`,
  `solicitar_nova_opcao`, `desistir`, `aceitar_qualquer_profissional`,
  `confirmar_resumo`.
- `erro_intervalos` e `configuracao_invalida` nunca são comunicados como
  `sem_disponibilidade`; os dois permanecem distintos em toda a cadeia.
- Nenhum dado recebe o estágio `confirmado` dentro desta composição.
- O último comando possível é `solicitar_confirmacao`; nenhuma execução, revalidação
  técnica ou criação pertence a esta especificação.
- Consulta/Avaliação nunca substitui o procedimento pedido sem `aceitar_opcao`
  explícito, e nunca é reofertada quando o procedimento pedido já é ela mesma.
- A busca de próxima disponibilidade nunca usa horizonte semântico artificial; o fim
  de um bloco técnico nunca significa indisponibilidade.
- Preferência de dentista não localizada ou não apta nunca resolve por escolha
  silenciosa — a composição sempre reaplica a regra de zero/um/vários aptos.
- O sinal composto `solicitar_nova_opcao` + `aceitar_qualquer_profissional` (seção
  13.2) nunca mistura horários de dentistas diferentes na mesma lista e nunca escolhe
  um dentista definitivamente por conta própria.
- Toda invalidação de derivados segue a matriz da seção 14; nenhuma opção antiga é
  promovida por texto, posição, horário coincidente ou versão anterior.
- Coleta cadastral respeita a ordem fixa nome → CPF → nascimento → e-mail (condicional);
  dado válido já presente nunca é pedido de novo.
- Interpretação persistida e resultado da composição registrado são marcadores
  distintos; o primeiro nunca é tratado como prova de que esta composição concluiu ou
  produziu um comando.
- Idempotência de composição recupera o resultado lógico original sem recomputar
  **somente** quando o resultado da composição está registrado (replay verdadeiro,
  Caso A). Quando só a interpretação está persistida, sem resultado da composição
  registrado (Caso B), **esta composição não é retomada**: `eventos_candidatos` e
  `conflitos_de_valor` permanecem transitórios e nunca são reconstruídos, a IA nunca é
  chamada novamente, nenhum comando anterior é inventado, e o comportamento é
  idêntico ao Caminho B já aprovado em `interpretacao-ia.md` — resposta fixa, aguardar
  nova mensagem. Isso não substitui nem contradiz `interpretacao-ia.md`; apenas
  acrescenta a exigência lógica do marcador de resultado da composição, para quando
  sua persistência física for especificada.
- Toda chamada a qualquer componente desta composição é isolada por `clinica_id`,
  derivado exclusivamente da instância autenticada.
- Esta especificação não cria código, tipo TypeScript, tabela, coluna, RPC, migration,
  teste executável ou schema físico.
