// Tipos do modulo de identificacao. Sem dependencia de nenhuma biblioteca externa.

// Unico import deste arquivo: o resultado da leitura de
// `estado_conversa.aguardando_resposta`. Fica em modulo proprio porque a
// classificacao (ausente/presente/invalido) e comportamento, nao so forma --
// ver aguardando-resposta.ts.
import type { LeituraAguardandoResposta } from './aguardando-resposta.ts';

export interface IdentificarConversaInput {
  provider: string;
  instancia_whatsapp: string;
  telefone_normalizado: string;
}

// Os seis estados aprovados em specs/novo-agendamento.md (secao 19) e
// verificados pelo check estado_conversa_estado_valido em
// 20260729_iris_nova_identificacao_v1.sql.
export type EstadoConversa =
  | 'atendimento'
  | 'aguardando_escolha'
  | 'coletando_cadastro'
  | 'aguardando_confirmacao'
  | 'executando'
  | 'concluido';

// Snapshot minimo do que o Core ofereceu/propos ao paciente na ultima
// pergunta gerada (specs/contexto-pendente-interpretacao-v1.md,
// specs/resposta-conversacional-v1.md secao 5). Serve EXCLUSIVAMENTE para a
// IA interpretar uma resposta curta ("15", "o segundo", "pode confirmar") no
// turno seguinte -- nunca e fonte de disponibilidade, nunca autoriza reserva.
export interface ContextoHorarios {
  /**
   * Horarios ja apresentados, na ordem exata em que apareceram -- da
   * sentido a um ordinal ("o segundo"). AUSENTE quando o snapshot representa
   * uma `proposta_pendente`: uma proposta concreta ja nao tem mais opcoes em
   * aberto, entao as duas nunca coexistem no mesmo snapshot (acao `propor`
   * substitui o snapshot por inteiro, nunca faz merge).
   */
  horarios?: string[];
  /**
   * Data/horario que o Core esta propondo, aguardando confirmacao explicita
   * do paciente (decisao `aguardando_confirmacao` -> acao `propor`). E o que
   * permite a IA reconhecer "pode confirmar"/"esse mesmo" como resposta a
   * ESSA proposta especifica, mesmo sem repetir data/horario no texto.
   *
   * Forma: `data` em `YYYY-MM-DD`, `horario` em `HH:MM` (24h).
   *
   * NUNCA E AUTORIZACAO DE EFEITO. Estes dois campos provam QUANDO, jamais O
   * QUE foi confirmado: confirmar a criacao de um horario e confirmar o
   * cancelamento de um agendamento no mesmo horario produzem o par
   * identico. Autorizar efeito por aqui confundiria criar, remarcar e
   * cancelar. Na rota V2 a autorizacao e `aguardando_resposta`
   * (`tipo`/`operacao`/`agendamento_id`, PerguntaPendente em
   * contexto-unificado-tipos.ts) -- ver
   * specs/contexto-conversacional-unificado-v2.md secao 14.3. Este snapshot
   * segue servindo ao que sempre serviu: ajudar a IA a interpretar uma
   * resposta curta.
   */
  proposta_pendente?: { data: string; horario: string };
  /**
   * Procedimento que a Iris ofereceu ao paciente no turno anterior e cuja
   * resposta ainda nao veio (specs/contexto-pendente-interpretacao-v1.md
   * secao 11). E o que permite a interpretadora entender "pode ser" como
   * aceitacao DAQUELA oferta -- sem nenhum repertorio de frases.
   *
   * Generico de proposito: carrega QUALQUER `procedimento_id`. Nao ha nada
   * sobre Consulta/Avaliacao aqui; quem decide o que oferecer e o
   * orquestrador, e hoje so a avaliacao e oferecida.
   *
   * AUSENTE quando as variantes nao se aplicam -- todas sao mutuamente
   * exclusivas, nunca coexistem no mesmo snapshot.
   */
  oferta_procedimento_pendente?: { procedimento_id: string };
  /**
   * A Iris perguntou se pode passar o telefone oficial do dono do CPF para o
   * numero desta conversa, e a resposta ainda nao veio
   * (specs/cpf-outro-telefone-v1.md secao 1). Quarta variante do contexto
   * pendente.
   *
   * Mesmo papel de `oferta_procedimento_pendente`, pelo mesmo motivo medido:
   * sem um marcador DECLARATIVO ("o que esta em aberto"), uma resposta curta
   * ("pode sim") chega a interpretadora sem pergunta pendente e nao tem como
   * ser lida como resposta A ESTA pergunta -- o historico e descritivo, este
   * e declarativo.
   *
   * SUBSTITUI o snapshot por inteiro: `proposta_pendente` NAO e preservada
   * junto (spec secao 1). O horario escolhido nao vive aqui -- ele vive em
   * dados.data_texto/horario_texto/confirmacao, que persistem entre turnos e
   * sao re-derivados a cada mensagem. Este snapshot e auxiliar de
   * interpretacao, nunca fonte de disponibilidade nem autoridade de reserva.
   *
   * DELIBERADAMENTE sem CPF, sem paciente_id e sem qualquer dado da outra
   * ficha: e um booleano, e a IA nao precisa de mais nada para entender que
   * ha uma pergunta de sim/nao em aberto. Mesmo criterio que manteve o
   * `procedimento_id` fora de `oferta_procedimento_pendente` no payload.
   */
  troca_telefone_pendente?: true;
  /**
   * O paciente tem mais de um agendamento ativo e a Iris perguntou qual
   * deles ele quer remarcar (specs/remarcacao-conversacional-v1.md secao 3).
   * Quinta variante do contexto pendente.
   *
   * `agendamento_ids` e a ordem EXATA em que os agendamentos foram
   * apresentados -- mesmo papel que `horarios` ja tem para slots, dá sentido
   * a "o segundo". Deliberadamente SEM descricao (procedimento/dentista/
   * data/horario): o texto que a IA le e montado a cada turno a partir de
   * uma busca fresca (`buscarAgendamentoAtivo`), nunca persistido aqui --
   * este snapshot e so a lista de IDs que autoriza a validacao de
   * integridade em interpretar-e-aplicar.ts.
   *
   * SUBSTITUI o snapshot por inteiro, mesmo criterio das demais variantes
   * declarativas.
   */
  escolha_agendamento_pendente?: { agendamento_ids: string[] };
  /** ISO, somente auditoria -- nunca usado como versao nem para ordenar escritas. */
  criado_em: string;
}

// Um par completo de turno (specs/historico-conversacional-v1.md). Serve
// para a IA interpretadora e a IA redatora entenderem a mensagem atual em
// relacao ao que veio antes -- nunca e fonte de fato operacional. Sem
// sanitizacao nesta V1 (spec secao 0.1, decisao de produto do Gabriel
// 2026-08-07): o texto do paciente e gravado exatamente como chegou.
export interface ParConversa {
  mensagem_paciente: string;
  /**
   * EXATAMENTE a resposta que foi enviada ao paciente -- redacao aprovada
   * pela guarda OU fallback deterministico efetivamente escolhido. Nunca um
   * texto reprovado ou descartado (historico-conversa.ts secao de gravacao).
   */
  resposta_iris: string;
  /** ISO -- quando a resposta foi gerada para envio. Nao significa entrega nem leitura pelo paciente. */
  gerada_em: string;
}

// Os ultimos MAX_PARES_HISTORICO pares (historico-conversa.ts), do mais
// ANTIGO para o mais RECENTE. Ao entrar um par novo alem do limite, o mais
// antigo sai (specs/historico-conversacional-v1.md secao 2). Nunca `[]` --
// "nenhum turno anterior" e sempre `null`.
export type HistoricoConversa = ParConversa[];

/**
 * Dados cadastrais JA PERSISTIDOS do paciente, lidos da tabela `pacientes`.
 *
 * `cpf` e o nome do conceito no dominio; a coluna fisica correspondente e
 * `pacientes.documento`. A traducao acontece em UM unico ponto de leitura
 * (buscarPaciente, em identificacao.ts), espelhando o unico ponto de escrita
 * (`cpf -> p_documento`, em persistir-paciente.ts). Nao existe coluna `cpf`
 * nem segunda fonte de verdade.
 *
 * Campo NULO no banco vira chave AUSENTE aqui, nunca `null` -- mesma
 * disciplina de `historico_recente` e `procedimentos_disponiveis`: a
 * ausencia se representa pela falta da chave, para que um espalhamento
 * (`{ ...cadastro, ...outros }`) nunca sobrescreva um valor real com `null`.
 */
export interface CadastroPaciente {
  nome?: string;
  cpf?: string;
  data_nascimento?: string;
  email?: string;
}

export interface ResultadoIdentificacao {
  clinica_id: string;
  paciente: {
    encontrado: boolean;
    id: string | null;
    /**
     * Cadastro oficial ja persistido. `{}` quando o paciente nao existe ou
     * quando existe sem nenhum dado cadastral preenchido -- os dois casos sao
     * indistinguiveis aqui de proposito, porque `encontrado`/`id` ja
     * respondem "existe?" e este campo responde apenas "o que se sabe dele".
     */
    cadastro: CadastroPaciente;
  };
  conversa: {
    id: string;
    estado: EstadoConversa;
    dados: Record<string, unknown>;
    // Exposto (aditivo) para que a gravacao de contexto_horarios use o
    // `atualizado_em` EXATO do estado sobre o qual a decisao foi calculada,
    // sem reler antes do UPDATE -- ver contexto-horarios.ts.
    atualizado_em: string;
    contexto_horarios: ContextoHorarios | null;
    historico_conversa: HistoricoConversa | null;
    /**
     * A pergunta que a Iris de fato fez no turno anterior
     * (specs/contexto-conversacional-unificado-v2.md secao 14.6).
     *
     * Nao e `PerguntaPendente | null` de proposito: sao TRES situacoes, e
     * colapsar `invalido` em `null` afirmaria "nao ha pergunta em aberto"
     * a partir de dado corrompido. O tipo obriga o chamador a distinguir --
     * ver aguardando-resposta.ts.
     */
    aguardando_resposta: LeituraAguardandoResposta;
  };
}

// Formato que um PostgrestFilterBuilder do supabase-js resolve quando
// aguardado diretamente (sem .single()/.maybeSingle()): sempre uma lista,
// nunca uma linha unica.
type ResultadoListagem<T> = { data: T[] | null; error: { message: string } | null };

// Interface estrutural minima do cliente de banco usada por este modulo.
// Qualquer implementacao que exponha esses metodos e compativel — tanto o
// SupabaseClient real (@supabase/supabase-js) quanto um dublê de teste.
//
// Estende PromiseLike (nunca um metodo nomeado tipo `.listar()`): o
// PostgrestFilterBuilder real ja e aguardavel diretamente e resolve para
// { data: T[], error } por padrao -- ele nao tem nenhum metodo com esse
// nome. Consultas que esperam zero ou mais linhas (ex.: bloqueios/
// agendamentos de um dia) terminam a cadeia com `await` puro, nunca com
// `.maybeSingle()` nem com um metodo inventado que so o dublê de teste
// implementaria.
export interface ConsultaEncadeavel<T = Record<string, unknown>> extends PromiseLike<ResultadoListagem<T>> {
  eq(coluna: string, valor: unknown): ConsultaEncadeavel<T>;
  is(coluna: string, valor: null): ConsultaEncadeavel<T>;
  /**
   * Espelha PostgrestFilterBuilder.gte() do supabase-js. Usado hoje somente
   * pelo corte temporal da busca de agendamento ativo
   * (`data >= instante_atual.data`, specs/remarcacao-operacional-v1.md
   * secao 1) -- a METADE do corte que pode ser feita no banco.
   *
   * A outra metade (desempate do mesmo dia por minuto) NAO usa este operador
   * e nunca deve usar: `horario` e `text` e o formato aceita hora de um
   * digito, entao comparacao lexicografica erra ('9:00' > '14:00' e
   * verdadeiro). Essa metade e feita em TypeScript, sobre minutos.
   */
  gte(coluna: string, valor: unknown): ConsultaEncadeavel<T>;
  // Espelha PostgrestFilterBuilder.not() do supabase-js. Usado hoje somente
  // para expressar "IS NOT NULL" (ex.: not('interpretacao_persistida_em',
  // 'is', null)), necessario para a conclusao condicional -- nunca faz um
  // SELECT de autorizacao seguido de UPDATE separado.
  not(coluna: string, operador: string, valor: unknown): ConsultaEncadeavel<T>;
  select(colunas: string): ConsultaEncadeavel<T>;
  maybeSingle(): Promise<{ data: T | null; error: { message: string } | null }>;
}

export interface ClienteBancoDados {
  from(tabela: string): {
    select(colunas: string): ConsultaEncadeavel;
    upsert(
      valores: Record<string, unknown>,
      opcoes: { onConflict: string; ignoreDuplicates: boolean }
    ): ConsultaEncadeavel;
    update(valores: Record<string, unknown>): ConsultaEncadeavel;
  };
}

// Campos de dados interpretados aceitos nesta etapa (aproveitamento
// estruturado). Qualquer chave fora desta lista e rejeitada.
export type CampoDadosConversa =
  | 'intencao'
  // Identidade canonica ja resolvida semanticamente pela IA interpretadora
  // contra o catalogo ativo da clinica (specs/procedimento-semantico-v1.md).
  // Substituiu `procedimento_texto` em 2026-08-08: o Core nunca mais
  // interpreta texto de procedimento, so confere integridade do ID.
  | 'procedimento_id'
  // Idem, para dentista (specs/dentista-semantico-v1.md). Substituiu
  // `dentista_texto` em 2026-08-09: a interpretadora recebe os dentistas
  // ativos da clinica e devolve o ID; o Core so confere integridade e
  // vinculo -- nunca compara nome.
  | 'dentista_id'
  // Agendamento que o paciente esta remarcando, quando ha mais de um ativo
  // (specs/remarcacao-conversacional-v1.md secao 3). AO CONTRARIO de
  // `dentista_id`, a IA emite este campo DIRETAMENTE -- contrato fechado por
  // medicao 2026-08-11 (11/11 contra a IA real; a alternativa via evento
  // media 11/11 mas so devolve a frase crua do paciente, transferindo ao
  // Core a tarefa de interpretar portugues). O Core NUNCA aceita um valor
  // fora da lista oficialmente oferecida neste turno (interpretar-e-
  // aplicar.ts) -- nunca adivinha, nunca interpreta referencia textual.
  | 'agendamento_id'
  | 'data_texto'
  | 'periodo'
  | 'horario_texto'
  | 'confirmacao'
  | 'nome'
  | 'cpf'
  | 'data_nascimento'
  | 'email';

export type AcaoAlteracaoDados = 'informar' | 'corrigir' | 'remover';

// `acao` e `valor` sao tipados como string livre (nao a uniao estrita) de
// proposito: a entrada e produzida externamente (futuramente pela IA) e
// precisa ser validada em tempo de execucao, nao apenas confiada ao tipo.
export interface AlteracaoDeCampo {
  acao: string;
  valor?: string;
}

export type AlteracoesDados = Record<string, AlteracaoDeCampo>;

// Os tres identificadores que localizam uma linha de estado_conversa.
// Extraido para ser reutilizado pela validacao canonica (validarContexto)
// tanto por aplicarDados quanto por interpretarEAplicar, sem duplicar
// regex de UUID nem regra de telefone.
export interface ContextoConversa {
  conversa_id: string;
  clinica_id: string;
  telefone_normalizado: string;
}

export interface AplicarDadosInput extends ContextoConversa {
  alteracoes: AlteracoesDados;
}

export interface ResultadoAplicarDados {
  conversa_id: string;
  dados: Record<string, unknown>;
  campos_adicionados: string[];
  campos_corrigidos: string[];
  campos_removidos: string[];
  campos_preservados: string[];
  /**
   * `atualizado_em` da linha APOS esta aplicacao -- o valor novo quando
   * houve UPDATE, ou o valor inalterado quando nada mudou (curto-circuito
   * de `dadosIguais`). Exposto (aditivo) para que a gravacao de
   * contexto_horarios use o `atualizado_em` exato do estado sobre o qual a
   * decisao foi calculada, sem reler antes do UPDATE
   * (specs/contexto-pendente-interpretacao-v1.md secao 5).
   */
  atualizado_em: string;
}
