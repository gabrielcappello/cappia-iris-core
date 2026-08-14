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
 */
export interface PerguntaPendente {
  tipo:
    | 'escolha_dentista'
    | 'escolha_horario'
    | 'confirmacao'
    | 'oferta_procedimento'
    | 'troca_telefone'
    | 'escolha_agendamento'
    | 'confirmacao_nome';
  opcoes?: readonly string[];
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
