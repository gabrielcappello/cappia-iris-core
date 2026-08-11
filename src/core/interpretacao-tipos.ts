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
  | 'intencao'
  | 'procedimento_id'
  | 'dentista_id'
  | 'agendamento_id'
  | 'data_texto'
  | 'periodo'
  | 'horario_texto'
  | 'confirmacao'
>;

export type CampoCadastralInterpretacao = Extract<
  CampoDadosConversa,
  'nome' | 'cpf' | 'data_nascimento' | 'email'
>;

export const CAMPOS_OPERACIONAIS_INTERPRETACAO: readonly CampoOperacionalInterpretacao[] = [
  'intencao',
  'procedimento_id',
  'dentista_id',
  'agendamento_id',
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
   * Procedimentos REAIS e ATIVOS desta clinica
   * (specs/procedimento-semantico-v1.md). E o que permite a interpretadora
   * resolver o pedido do paciente semanticamente ate a identidade canonica
   * (`procedimento_id`), em vez de o Core tentar casar texto contra uma
   * lista de aliases -- o paciente fala naturalmente, a IA compreende.
   *
   * Exatamente dois campos por item, nada alem: nunca preco, duracao,
   * dentista, ou procedimento de outra clinica. AUSENTE (nunca `[]`) quando
   * a clinica nao tem catalogo carregavel.
   */
  procedimentos_disponiveis?: { procedimento_id: string; nome_pt: string }[];
  /**
   * Dentistas ATIVOS desta clinica (specs/dentista-semantico-v1.md). Mesmo
   * papel que `procedimentos_disponiveis`: a interpretadora correlaciona
   * semanticamente o que o paciente disse ("o Carlos", "a Dra. Vanesa") com
   * um `dentista_id` real -- o Core nunca compara nome.
   *
   * NAO e filtrada por aptidao, deliberadamente: o vinculo depende do
   * `procedimento_id`, que so existe DEPOIS desta interpretacao. Filtrar
   * faria um dentista sem vinculo sumir da lista, a IA omitir o campo, e o
   * Core seguir com outro profissional em silencio -- exatamente o defeito
   * que esta spec corrige. Com a lista completa, o Core reprova por vinculo
   * e existe um fato concreto para informar ao paciente.
   *
   * Exatamente dois campos por item. `nome_exibido` e dado de catalogo,
   * nunca PII do paciente. AUSENTE (nunca `[]`) quando nao ha nenhum ativo.
   */
  dentistas_disponiveis?: { dentista_id: string; nome_exibido: string }[];
  /**
   * Existe uma oferta de procedimento aguardando resposta
   * (specs/contexto-pendente-interpretacao-v1.md secao 11). Terceira variante
   * do contexto pendente, ao lado de `horarios_oferecidos` e
   * `proposta_pendente`.
   *
   * E o que autoriza a interpretadora a entender uma concordancia nua ("pode
   * ser") como aceitacao. Medido: sem este marcador, a mesma frase vira
   * `nao_compreendida` 3/3, mesmo com `historico_recente` presente -- porque
   * o historico e DESCRITIVO (o que foi dito) e este e DECLARATIVO (o que
   * esta em aberto).
   *
   * DELIBERADAMENTE sem o `procedimento_id` oferecido. O id fica so no
   * snapshot oficial do Core, que e quem aplica. Mandar o id para a IA era o
   * que a PUXAVA a emiti-lo -- causa medida do caso em que "prefiro outra
   * coisa" acabava aceitando a oferta. O que foi oferecido ja esta no
   * historico, em portugues, que e o que ela precisa para julgar.
   */
  oferta_procedimento_pendente?: true;
  /**
   * Existe uma pergunta de troca de telefone aguardando sim/nao
   * (specs/cpf-outro-telefone-v1.md secao 1). Quarta variante do contexto
   * pendente.
   *
   * E o que autoriza a interpretadora a emitir `aceitar_troca_telefone`.
   * Sem este marcador o evento NUNCA e emitido -- mesma guarda ja escrita
   * para `aceitar_opcao`, pelo mesmo motivo: a resposta nao pode existir sem
   * a pergunta ter sido feita.
   *
   * DELIBERADAMENTE sem CPF, paciente_id ou qualquer dado da outra ficha --
   * um booleano basta para a IA entender que ha um sim/nao em aberto, e
   * nenhum dado do outro cadastro atravessa a fronteira do modelo
   * (specs/cpf-outro-telefone-v1.md secao 4).
   */
  troca_telefone_pendente?: true;
  /**
   * Agendamentos ativos do paciente, quando ha mais de um e a Iris precisa
   * que ele escolha qual remarcar (specs/remarcacao-conversacional-v1.md
   * secao 3). So chega no payload quando ha uma escolha pendente -- o
   * proprio ENVIO da lista e o sinal de que ha uma pergunta em aberto (nao
   * existe um booleano separado: contrato fechado por medicao 2026-08-11).
   *
   * Exatamente dois campos por item: `agendamento_id` (identificador opaco)
   * e `descricao` (texto pronto -- procedimento, dentista, data e horario --
   * montado pelo Core a partir de uma busca fresca, nunca do snapshot
   * persistido). A IA correlaciona semanticamente e devolve o
   * `agendamento_id` direto em `alteracoes`; ela NUNCA resolve ordinal, nome
   * de procedimento, dia da semana ou nome de dentista para indice ou ID por
   * conta propria no Core -- e a IA quem faz essa correlacao, uma unica vez,
   * no proprio turno.
   */
  agendamentos_ativos?: { agendamento_id: string; descricao: string }[];
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
/**
 * Evento CANDIDATO produzido pela IA (specs/eventos-conversacionais-v1.md
 * secao 1). Nunca e uma decisao, uma transicao nem uma autorizacao: significa
 * apenas "a mensagem atual parece conter isto". Quem valida contra o estado
 * oficial e aplica qualquer efeito e sempre o Core.
 *
 * Dois tipos implementados: `aceitar_opcao` (2026-08-09) e
 * `aceitar_troca_telefone` (2026-08-10). Os outros quatro do catalogo
 * canonico -- `solicitar_nova_opcao`, `desistir`,
 * `aceitar_qualquer_profissional`, `confirmar_resumo` -- permanecem fora:
 * nenhum deles e necessario para estes funcionarem.
 *
 * FORMA UNICA, nunca uniao discriminada. Os dois eventos afirmam a mesma
 * coisa -- "o paciente aceitou o que voce perguntou" --, entao nao existe
 * campo que um precise e o outro nao.
 *
 * NENHUM DOS DOIS TEM UM "NAO": recusa e sempre a AUSENCIA do evento. Medido
 * contra a IA real em 2026-08-10 (src/eval/diagnostico-contrato-eventos.ts):
 * um evento de recusa proprio (`recusar_troca_telefone`) foi emitido em 0 dos
 * casos, porque toda a instrucao ao redor ensina justamente a regra oposta.
 * A recusa da troca de telefone e lida de `natureza_mensagem === 'negacao'`,
 * campo que ja existe e ja vem em todo turno -- 14/15 nas mesmas medicoes,
 * com ZERO aceites por engano.
 *
 * `referencia_textual` preserva a referencia presente na mensagem quando ela
 * existe ("14h", "a segunda opcao"); e `null` para concordancia deitica
 * ("pode ser") -- exemplo da propria spec canonica. A IA NUNCA resolve essa
 * referencia para ID, indice ou registro.
 */
export interface EventoCandidatoIA {
  tipo: 'aceitar_opcao' | 'aceitar_troca_telefone';
  referencia_textual: string | null;
}

/**
 * Resposta do paciente a pergunta de troca de telefone, **derivada pelo
 * Core** (specs/cpf-outro-telefone-v1.md secao 2). A IA nunca emite este
 * valor: ela emite (ou nao) o evento de aceite, e classifica a mensagem em
 * `natureza_mensagem`. Quem combina os dois sinais e `interpretar-e-aplicar.ts`.
 */
export type RespostaTrocaTelefone = 'sim' | 'nao';

export const TIPOS_EVENTO_CANDIDATO_PERMITIDOS: readonly EventoCandidatoIA['tipo'][] = [
  'aceitar_opcao',
  'aceitar_troca_telefone',
];

export interface SaidaInterpretacao {
  natureza_mensagem: NaturezaMensagem;
  alteracoes: AlteracoesDados;
  /**
   * Terceiro campo raiz, obrigatorio e possivelmente vazio (canonica secao 4:
   * "os dois campos sao obrigatorios e podem estar vazios"). Vazio e a saida
   * normal da esmagadora maioria dos turnos.
   */
  eventos_candidatos: EventoCandidatoIA[];
  /**
   * Quem a interpretadora entendeu que o paciente quis dizer, ao mencionar um
   * profissional (specs/dentista-semantico-v1.md secao 12). Resultado
   * SEMANTICO da leitura da preferencia -- por isso campo raiz, e nao uma
   * alteracao de dado.
   *
   * - `null`  -- o paciente NAO mencionou profissional;
   * - `[]`    -- mencionou, e nenhum dentista real da clinica corresponde;
   * - `[id]`  -- um candidato claro;
   * - `[a,b]` -- varios plausiveis; a IA nao escolhe.
   *
   * `null` em vez de chave ausente porque o Structured Outputs estrito exige
   * TODA propriedade raiz em `required` -- entao "ausente" precisa de um valor
   * que o represente. E a unica excecao a convencao "ausente, nunca vazio" do
   * projeto, e existe porque aqui `[]` e `null` significam coisas diferentes.
   *
   * Quem conta e decide e o Core; a IA nunca escolhe entre candidatos nem
   * emite `dentista_id`.
   */
  dentistas_candidatos: string[] | null;
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
  /**
   * Candidatos a dentista lidos pela IA nesta mensagem
   * (specs/dentista-semantico-v1.md secao 12), repassados ao orquestrador
   * para a regra de contagem. `null` = o paciente nao mencionou profissional.
   *
   * Quando ha exatamente UM candidato, ele ja foi persistido em
   * `dados.dentista_id` por este modulo -- o orquestrador nao precisa fazer
   * nada. Os casos `[]` e `[varios]` e que viram decisao la.
   */
  dentistas_candidatos: string[] | null;
  /**
   * Resposta do paciente a pergunta de troca de telefone, DERIVADA pelo Core
   * (specs/cpf-outro-telefone-v1.md secao 2). `null` = nao respondeu, e a
   * pergunta segue pendente.
   *
   * SO E DIFERENTE DE `null` QUANDO O MARCADOR OFICIAL DO CORE ESTAVA
   * PRESENTE nesta chamada. Exige os DOIS lados -- o sinal da IA E a pergunta
   * pendente do proprio Core --, exatamente como `aplicarAceitacaoDeOferta`
   * exige a oferta oficial. Um evento sem pergunta pendente nunca autoriza
   * nada.
   */
  resposta_troca_telefone: RespostaTrocaTelefone | null;
}
