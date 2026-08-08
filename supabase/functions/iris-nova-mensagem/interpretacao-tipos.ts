import type { AlteracoesDados, CampoDadosConversa, ParConversa, ResultadoAplicarDados } from './tipos.ts';

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
//
// `horarios_oferecidos` (specs/contexto-pendente-interpretacao-v1.md) e a
// lista de horarios que o Core apresentou ao paciente na ultima pergunta
// gerada, na ordem exata em que apareceram -- e o que permite a IA
// interpretar "15", "15 hrs", "quinze horas" ou "o segundo". AUSENTE quando
// nao ha snapshot. Nunca autoriza reserva e nunca e fonte de
// disponibilidade: o Core recalcula tudo antes de agir.
//
// `proposta_pendente` (specs/resposta-conversacional-v1.md secao 5) e a
// data/horario que o Core propos ao paciente na ultima pergunta gerada,
// aguardando confirmacao explicita -- e o que permite a IA reconhecer uma
// concordancia semanticamente clara ("ok", "pode confirmar", "esse mesmo")
// como confirmacao = sim para ESSA proposta especifica, mesmo quando a
// mensagem nao repete data nem horario. AUSENTE quando nao ha proposta em
// aberto -- nesse caso uma concordancia solta nunca confirma agendamento
// (regra de confirmacao em interpretacao-instrucoes.ts).
export interface EntradaInterpretacao {
  mensagens_atuais: string[];
  dados_atuais: Partial<Record<CampoOperacionalInterpretacao, string>>;
  campos_cadastrais_preenchidos: CampoCadastralInterpretacao[];
  horarios_oferecidos?: string[];
  proposta_pendente?: { data: string; horario: string };
  /**
   * Ultimos turnos da conversa (specs/historico-conversacional-v1.md secao
   * 6), do mais antigo para o mais recente, ja filtrados por validade (24h)
   * -- permite entender mensagens curtas ou dependentes de contexto ("sim",
   * "esse mesmo", "aquele que voce falou") exatamente como uma pessoa
   * entenderia numa conversa real. AUSENTE quando nao ha nenhum par valido.
   * Reversao declarada de memoria-conversacional-minima-v1.md ("a
   * interpretadora nunca muda"): a evidencia real do WhatsApp (2026-08-07,
   * "Sim" isolado virando nao_compreendida) mudou esse contexto. Nunca
   * autoriza um dado novo por si so -- todo campo emitido continua sujeito
   * ao mesmo vocabulario fechado.
   */
  historico_recente?: ParConversa[];
}

// Classificacao fechada do TIPO da mensagem atual (specs/interpretacao-
// natureza-mensagem-v1.md). Nunca decide nada por si so -- serve somente
// para o Core escolher a acao comunicativa quando `alteracoes` desta
// mensagem estiver vazio (mesma spec, secao 3: `alteracoes` sempre tem
// precedencia sobre `natureza_mensagem` para a evolucao do fluxo).
export type NaturezaMensagem =
  | 'saudacao'
  | 'duvida'
  | 'pedido'
  | 'resposta'
  | 'correcao'
  | 'negacao'
  | 'nao_compreendida';

export const NATUREZAS_MENSAGEM_PERMITIDAS: readonly NaturezaMensagem[] = [
  'saudacao',
  'duvida',
  'pedido',
  'resposta',
  'correcao',
  'negacao',
  'nao_compreendida',
];

// Saida exata esperada do modelo: `natureza_mensagem` (obrigatorio, sempre
// presente) e `alteracoes` (mesmo formato que aplicarDados ja aceita, pode
// vir vazio). `alteracoes` continua aceitando os dez campos -- o paciente
// pode informar nome/cpf/nascimento/email na mensagem ATUAL, e o Core
// compara contra o valor oficial do servidor.
export interface SaidaInterpretacao {
  natureza_mensagem: NaturezaMensagem;
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
  natureza_mensagem: NaturezaMensagem;
  alteracoes_interpretadas: AlteracoesDados;
  alteracoes_aplicaveis: AlteracoesDados;
  conflitos: Conflito[];
  aplicacao: ResultadoAplicarDados | null;
}
