import type { AlteracoesDados, CampoDadosConversa, ResultadoAplicarDados } from './tipos.ts';

// --- Classificacao canonica dos campos (specs/interpretacao-ia.md,
// "Entrada e PII") ---
//
// Os dez campos de CampoDadosConversa se dividem em dois grupos com
// tratamento DIFERENTE no payload enviado ao modelo:
//
// - operacionais: podem ser enviados por VALOR como contexto;
// - cadastrais: NUNCA sao enviados por valor -- somente a indicacao de
//   quais ja estao preenchidos (campos_cadastrais_preenchidos).
//
// `Extract` garante em tempo de compilacao que cada literal abaixo existe
// de fato em CampoDadosConversa: um rename em tipos.ts quebra aqui.

export type CampoOperacionalInterpretacao = Extract<
  CampoDadosConversa,
  'intencao' | 'procedimento_texto' | 'dentista_texto' | 'data_texto' | 'periodo' | 'horario_texto' | 'confirmacao'
>;

export type CampoCadastralInterpretacao = Extract<
  CampoDadosConversa,
  'nome' | 'cpf' | 'data_nascimento' | 'email'
>;

export const CAMPOS_OPERACIONAIS_INTERPRETACAO: readonly CampoOperacionalInterpretacao[] = [
  'intencao',
  'procedimento_texto',
  'dentista_texto',
  'data_texto',
  'periodo',
  'horario_texto',
  'confirmacao',
];

export const CAMPOS_CADASTRAIS_INTERPRETACAO: readonly CampoCadastralInterpretacao[] = [
  'nome',
  'cpf',
  'data_nascimento',
  'email',
];

// Guarda de exaustividade: se um campo novo entrar em CampoDadosConversa
// sem ser classificado como operacional ou cadastral, o tipo abaixo deixa
// de ser `never` e esta atribuicao passa a NAO compilar. Isso impede que
// um campo novo caia por omissao no payload do modelo.
type CampoNaoClassificado = Exclude<
  CampoDadosConversa,
  CampoOperacionalInterpretacao | CampoCadastralInterpretacao
>;
const _garantiaClassificacaoTotal: [CampoNaoClassificado] extends [never] ? true : false = true;
void _garantiaClassificacaoTotal;

// Snapshot oficial lido de estado_conversa. Contem os dez campos e PODE
// conter valores cadastrais -- e uso interno do servidor (preAplicar,
// reconciliacao). NUNCA e entregue ao modelo diretamente.
export type SnapshotOficialConversa = Partial<Record<CampoDadosConversa, string>>;

// Entrada do extrator: a janela de mensagens, os dados operacionais
// acumulados, e a indicacao ESTRUTURAL de quais campos cadastrais ja
// estao preenchidos. Nunca telefone, clinica_id, paciente_id,
// conversa_id, historico, agendamentos, registros clinicos -- e nunca
// valores cadastrais (nome, cpf, data_nascimento, email).
//
// `dados_atuais` e tipado sobre o conjunto fechado dos campos
// operacionais: um campo cadastral nao tem onde ser transportado aqui.
export interface EntradaInterpretacao {
  mensagens_atuais: string[];
  dados_atuais: Partial<Record<CampoOperacionalInterpretacao, string>>;
  campos_cadastrais_preenchidos: CampoCadastralInterpretacao[];
}

// Saida exata esperada do modelo: somente `alteracoes`, no mesmo formato
// que aplicarDados ja aceita. `alteracoes` continua aceitando os dez
// campos -- o paciente pode informar nome/cpf/nascimento/email na
// mensagem ATUAL, e o Core compara contra o valor oficial do servidor.
export interface SaidaInterpretacao {
  alteracoes: AlteracoesDados;
}

// Dependencia injetavel de modelo estruturado.
export interface ClienteModeloEstruturado {
  executar(entrada: { instrucoes: string; schema: object; payload: EntradaInterpretacao }): Promise<unknown>;
}

export interface Conflito {
  campo: string;
  valor_atual: string;
  valor_informado: string;
}

export interface ResultadoPreAplicacao {
  alteracoes_aplicaveis: AlteracoesDados;
  conflitos: Conflito[];
}

export interface ResultadoInterpretacao {
  alteracoes_interpretadas: AlteracoesDados;
  alteracoes_aplicaveis: AlteracoesDados;
  conflitos: Conflito[];
  aplicacao: ResultadoAplicarDados | null;
}
