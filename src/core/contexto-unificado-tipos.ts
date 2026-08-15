// Contrato do CONTEXTO CONVERSACIONAL UNIFICADO
// (specs/contexto-conversacional-unificado-v1.md, aprovada em 2026-08-14).
//
// SOMENTE SHADOW. Nada aqui participa de nenhuma decisão de atendimento, de
// nenhuma persistência e de nenhuma resposta ao paciente. O contrato atual
// (`interpretacao-tipos.ts`) segue sendo o único que controla o fluxo.

/**
 * ENTRADA -- um único objeto, com os MESMOS blocos em todo turno (spec §3).
 *
 * Todos os blocos existem sempre; vazio ou `null` significa que **o fato não
 * existe** -- nunca "este caminho não carregou". É essa distinção que impede a
 * lacuna silenciosa que produziu os cinco defeitos da spec §1.
 */
export interface ContextoUnificado {
  contexto_relevante: {
    dados_conhecidos: Record<string, string>;
    /** QUAIS campos estão preenchidos -- nunca o conteúdo (spec §3.0, PII). */
    cadastro_paciente: { preenchidos: readonly string[] };
    agendamentos_do_paciente: readonly AgendamentoResumido[];
    opcoes_apresentadas: readonly string[];
    /** `null` quando não há pergunta aberta -- nunca ausente (spec §3.1). */
    aguardando_resposta: PerguntaPendente | null;
    /** Ativos pertinentes à conversa -- nunca o catálogo inteiro (spec §3.0). */
    procedimentos_disponiveis: readonly ProcedimentoResumido[];
    /**
     * Dentistas ATIVOS, sem filtro de aptidão (spec §3.2). Serve para a Iris
     * **compreender** uma menção ("com a Vanessa"), não para oferecer. Filtrar
     * aqui faria um dentista mencionado sumir do payload, a Iris não conseguir
     * resolvê-lo, e o Core seguir com outro em silêncio.
     */
    dentistas_disponiveis: readonly DentistaResumido[];
  };
  mensagem_atual: string;
  /** Últimos turnos, como o contrato atual já envia. */
  historico_recente: readonly ParConversaResumido[];
}

export interface ProcedimentoResumido {
  procedimento_id: string;
  nome: string;
}

export interface DentistaResumido {
  dentista_id: string;
  nome_exibido: string;
}

export interface ParConversaResumido {
  mensagem_paciente: string;
  resposta_iris: string;
}

export interface AgendamentoResumido {
  data: string;
  horario: string;
  procedimento?: string;
  dentista_nome?: string;
}

/**
 * A pergunta que foi DE FATO feita ao paciente -- registrada quando a resposta
 * é produzida, nunca derivada da decisão do Core (spec §3.1).
 *
 * `confirmacao_nome` é o tipo criado pela guarda da spec §5.1: mais um valor no
 * vocabulário fechado, nunca um quinto marcador persistido.
 *
 * `'cadastro'`, `operacao` e `agendamento_id` são a extensão PREPARATÓRIA da
 * spec v2 §7 (contexto-conversacional-unificado-v2.md, aprovada por Gabriel
 * em 2026-08-15 -- aprovação CONDICIONADA, spec §15).
 *
 * ESTADO REAL (2026-08-15): existem ARQUIVOS LOCAIS de migration e RPC que
 * já contam com estes campos -- a coluna `estado_conversa.aguardando_resposta`
 * (20260815120000_iris_nova_aguardando_resposta.sql) e o commit transacional
 * do cancelamento (20260815121000_iris_nova_commit_turno_v2_cancelar.sql, que
 * lê `tipo`, `operacao` e `agendamento_id` como autorização, spec v2 §14.3).
 * NADA disso foi APLICADO em nenhum projeto Supabase, integrado a nenhuma
 * rota, nem é consumido por produção: são arquivos versionados, não estado
 * de banco. A rota V1 segue sendo a única operacional.
 *
 * Nenhum consumidor deste tipo (`guarda-contexto-unificado.ts`, shadow, Edge
 * Function, arquivos espelhados) foi alterado para ler ou escrever os campos
 * novos -- os três são opcionais, então todo valor já existente de
 * `PerguntaPendente` continua válido sem alteração.
 */
export interface PerguntaPendente {
  tipo:
    | 'escolha_dentista'
    | 'escolha_horario'
    | 'confirmacao'
    | 'oferta_procedimento'
    | 'troca_telefone'
    | 'escolha_agendamento'
    | 'confirmacao_nome'
    // Novo (spec v2 §7, item 1) -- "Core está pedindo dado cadastral
    // pendente". Sem nenhum outro campo associado.
    | 'cadastro';
  opcoes?: readonly string[];
  /**
   * UM ÚNICO CAMPO, conforme a spec v2 (§7 item 2 e §14.3) -- que nomeia
   * `operacao` nos dois contextos e nunca cria um segundo campo. A RPC de
   * commit lê exatamente esta chave (`v_pergunta ->> 'operacao'`,
   * 20260815121000_iris_nova_commit_turno_v2_cancelar.sql).
   *
   * Admitido em exatamente dois `tipo`, com o conjunto de valores aceitos
   * definido pelo CONTEXTO -- não por um campo separado:
   *
   * - `escolha_agendamento` (spec v2 §7 item 2) -- "qual agendamento você
   *   quer, e para quê". Aceita `consultar | remarcar | cancelar`. Permite à
   *   Iris, numa resposta curta ("o primeiro"), emitir a ação terminal certa
   *   diretamente, sem uma ação intermediária só para registrar a escolha.
   *   `criar` não cabe: não se escolhe entre agendamentos existentes para
   *   criar um novo;
   * - `confirmacao` (spec v2 §14.3) -- "você autoriza este efeito". Aceita
   *   `criar | remarcar | cancelar`, e é OBRIGATÓRIA aqui: é o que torna a
   *   autorização inequívoca. `consultar` não cabe: consulta não é efeito e
   *   nunca é confirmada.
   *
   * Por que este campo, e não `contexto_horarios.proposta_pendente`: aquele
   * carrega apenas `{data, horario}` e por isso não distingue confirmar a
   * CRIAÇÃO de um horário de confirmar o CANCELAMENTO de um agendamento no
   * mesmo horário -- um "sim" destinado a uma operação autorizaria outra. A
   * rota V2 nunca usa `proposta_pendente` como autorização de efeito.
   *
   * Recusado em qualquer outro `tipo` (`validarPerguntaPendente`), assim como
   * o valor que não pertence ao contexto em que aparece.
   */
  operacao?: 'consultar' | 'criar' | 'remarcar' | 'cancelar';
  /**
   * Âncora estruturada do ALVO -- nunca inferida, nunca construída a partir
   * do conteúdo da ação. Admitido em exatamente dois `tipo` (spec v2 §7 item
   * 3 e §14.3), e recusado em todos os demais:
   *
   * - `escolha_horario`: quando a oferta pertence a uma remarcação em curso.
   *   É o que permite montar `agendamento_em_remarcacao` (spec v2 §8) antes
   *   de `escolher_horario` chegar;
   * - `confirmacao`: identifica o alvo exato. OBRIGATÓRIO quando `operacao` é
   *   `'remarcar'` ou `'cancelar'`; PROIBIDO quando é `'criar'` -- uma criação
   *   não referencia agendamento existente nenhum, mesma invariante já fechada
   *   em `Acao.confirmar` (`resultado-iris-tipos.ts`, spec v2 §2).
   */
  agendamento_id?: string;
  detalhe?: Record<string, string>;
}

export const ACOES_CONTRATO = [
  'escolher_dentista',
  'escolher_horario',
  'escolher_agendamento',
  'confirmar',
  'aceitar_oferta',
  'pedir_agendamento',
  'cancelar',
  'remarcar',
  'nenhuma',
] as const;
export type AcaoContrato = (typeof ACOES_CONTRATO)[number];

export const CAMPOS_CONTRATO = [
  'nome',
  'cpf',
  'data_nascimento',
  'email',
  'procedimento',
  'data',
  'periodo',
  'horario',
] as const;
export type CampoContrato = (typeof CAMPOS_CONTRATO)[number];

/**
 * DUAS operações, nunca três (spec §4, decisão de 2026-08-14 após medição).
 *
 * - `informou` + valor não vazio: está dando o dado agora;
 * - `corrigiu` + valor não vazio: está substituindo pelo novo valor;
 * - `corrigiu` + `null`: declarou que o valor atual está errado, sem substituto.
 *
 * `removeu` foi eliminado: a IA real emitiu `corrigiu` vazio em 8/8 tentativas
 * de expressá-lo, e o efeito era idêntico ao de `corrigiu: null`.
 */
export interface InformacaoFornecida {
  campo: CampoContrato;
  operacao: 'informou' | 'corrigiu';
  valor: string | null;
}

/** SAÍDA -- ação SEPARADA dos dados informados (spec §4). */
export interface SaidaContratoUnificado {
  acao_solicitada: { tipo: AcaoContrato; referencia: string | null };
  informacoes_fornecidas: readonly InformacaoFornecida[];
}
