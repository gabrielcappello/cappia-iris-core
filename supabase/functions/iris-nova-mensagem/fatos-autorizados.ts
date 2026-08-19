// Fatos autorizados que o Core entrega a IA redatora (specs/resposta-
// conversacional-v1.md secao 2). Funcao pura: nao chama IA, nao acessa
// banco, so traduz a decisao ja tomada pelo orquestrador em fatos e num
// objetivo de resposta -- exatamente o mesmo papel que gerar-resposta-
// paciente.ts ja tem para o texto fixo, so que aqui o "texto" fica por
// conta da IA.
//
// Regra estrutural (spec secao 2): FatosAutorizados carrega FATOS, nunca
// frases prontas. Nenhum campo aqui pode conter texto de resposta -- so
// dados que a redatora usa para escrever.

import { formatarData, formatarMinutos } from './gerar-resposta-paciente.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';
import type { MotivoSemExpediente } from './disponibilidade-tipos.ts';
import type { AgendamentoAtivo } from './buscar-agendamento-ativo.ts';
import type { CadastroPaciente } from './tipos.ts';

/**
 * ITEMIZADO desde 2026-08-10 (specs/cadastro-conversacional-v1.md secao 8): o
 * valor monolitico `'cadastro'` saiu. Ele dizia apenas "falta cadastro", sem
 * dizer o que falta -- e a redatora nao tinha como pedir so o que ainda nao se
 * sabe. Os quatro campos cadastrais entram no lugar dele.
 */
import type { ClinicaConhecida } from './clinica-conhecida.ts';
import type { DentistaDaClinica } from './dentistas-da-clinica.ts';
import type { TratamentoAprovado } from './tratamentos-aprovados.ts';
import type { PrecosClinica } from './precos-clinica.ts';

export type CampoFaltante =
  | 'procedimento'
  | 'data'
  | 'horario'
  | 'nome'
  | 'cpf'
  | 'data_nascimento'
  | 'email';

/**
 * ATENCAO (achado da implementacao, 2026-08-06): a spec aprovada previa
 * exatamente 14 valores. Duas decisoes (`cadastro_necessario` e
 * `sem_dentista_disponivel`) precisam de um objetivo proprio para receber o
 * fallback deterministico dedicado que a propria spec exige na secao 6 --
 * nenhum dos 14 valores originais descreve essas duas situacoes sem
 * distorcer o significado. Os dois valores abaixo marcados 2026-08-06 foram
 * adicionados para manter o mapeamento exaustivo e honesto; nenhum dado ou
 * comportamento novo foi introduzido alem disso. Ver relatorio de
 * implementacao para revisao independente.
 */
export type ObjetivoResposta =
  | 'cumprimentar_e_oferecer_ajuda'
  | 'pedir_procedimento'
  | 'escolher_entre_procedimentos'
  | 'escolher_entre_dentistas'
  | 'pedir_data_ou_horario'
  | 'apresentar_horarios'
  | 'informar_sem_disponibilidade'
  | 'informar_sem_expediente_e_pedir_outra_data' // 2026-08-14 -- dia sem expediente e fato de agenda, nunca falha tecnica.
  | 'pedir_confirmacao'
  | 'informar_reserva_criada'
  | 'informar_horario_indisponivel'
  | 'acolher_e_retomar'
  | 'pedir_reformulacao'
  | 'encerrar_cordialmente'
  | 'informar_falha_tecnica'
  | 'pedir_cadastro' // 2026-08-06 -- cadastro_necessario nao cabia em nenhum dos 14 originais.
  | 'informar_sem_profissional' // 2026-08-06 -- sem_dentista_disponivel, idem.
  | 'informar_combinacao_indisponivel' // 2026-08-09 -- combinacao_indisponivel (specs/dentista-semantico-v1.md).
  | 'informar_cpf_ja_cadastrado' // 2026-08-10 -- specs/cadastro-conversacional-v1.md secao 7.
  | 'perguntar_troca_telefone' // 2026-08-10 -- specs/cpf-outro-telefone-v1.md secao 3.
  | 'acatar_recusa_troca_telefone' // 2026-08-10 -- idem; recusa tem desfecho proprio.
  | 'informar_substituicao_por_avaliacao' // 2026-08-09 -- o procedimento cedeu para preservar o dentista escolhido.
  | 'informar_sem_agendamento_para_remarcar' // 2026-08-11 -- specs/remarcacao-conversacional-v1.md secao 2.
  | 'escolher_entre_agendamentos' // 2026-08-11 -- idem, secao 3.
  | 'pedir_confirmacao_remarcacao' // 2026-08-11 -- idem, secao 5.
  | 'informar_remarcacao_criada' // 2026-08-11 -- idem, secao 6.
  | 'informar_sem_agendamento_para_cancelar' // 2026-08-11 -- specs/cancelamento-conversacional-v1.md secao 2.
  | 'escolher_entre_agendamentos_cancelamento' // 2026-08-11 -- idem, secao 5.
  | 'pedir_confirmacao_cancelamento' // 2026-08-11 -- idem, secao 4.
  | 'informar_cancelamento_criado'; // 2026-08-11 -- idem, secao 7.

export interface FatosAutorizados {
  objetivo: ObjetivoResposta;
  /**
   * NUNCA populado hoje (achado da implementacao, 2026-08-06): nenhuma
   * DecisaoOrquestrador carrega o nome resolvido do procedimento -- so o
   * `procedimento_id` opaco. gerar-resposta-paciente.ts ja documenta essa
   * mesma limitacao ("nomes de procedimento/dentista NAO aparecem no texto
   * porque a decisao nao os carrega, so IDs"); o campo permanece aqui
   * porque a spec aprovada o define, mas populá-lo exigiria o orquestrador
   * carregar nome_pt do catalogo para dentro de cada decisao -- mudanca de
   * escopo maior, nao feita aqui.
   */
  procedimento_resolvido?: string;
  /** Ver o mesmo achado acima -- nenhuma decisao de procedimento ambiguo existe hoje (resolver-procedimento.ts nao tem variante "varios candidatos"); campo nunca populado, objetivo correspondente (`escolher_entre_procedimentos`) hoje inalcancavel. */
  procedimentos_candidatos?: string[];
  /** Idem `procedimento_resolvido` -- nunca populado hoje. */
  dentista_resolvido?: string;
  /** Este SIM e populado: `aguardando_escolha_dentista` carrega `DentistaApto[]`, que ja tem `nome_exibido`. */
  dentistas_candidatos?: string[];
  /**
   * Nome do profissional que o paciente escolheu, quando a decisao gira em
   * torno dele (specs/dentista-semantico-v1.md). Populado em
   * `combinacao_indisponivel` e na substituicao por avaliacao. Dado de
   * catalogo, nunca PII do paciente.
   */
  dentista_preferido?: string;
  /**
   * Presente SOMENTE quando o procedimento pedido cedeu lugar a
   * Consulta/Avaliacao para preservar o dentista escolhido. A redatora
   * PRECISA comunicar isso -- a troca dispensa nova aceitacao, nunca o
   * dever de informar.
   */
  substituido_por_avaliacao?: true;
  /**
   * Presente somente quando `sem_dentista_disponivel` tem uma alternativa
   * REAL a oferecer (a Consulta/Avaliação existe, está ativa e tem dentista
   * apto). Sem este fato, a redatora não pode oferecer nada — não há
   * alternativa a propor (specs/contexto-pendente-interpretacao-v1.md secao 11).
   */
  avaliacao_oferecida?: true;
  /**
   * O paciente mencionou um profissional que nao existe nesta clinica
   * (specs/dentista-semantico-v1.md secao 12). A redatora deve dizer isso
   * antes de apresentar `dentistas_candidatos` -- que, neste caso, sao os
   * APTOS reais, nao os mencionados.
   *
   * O Core nao transporta o nome que o paciente usou: ele esta na mensagem
   * crua, que a redatora ja tem. Inventar um campo para isso seria duplicar
   * dado que ja atravessa.
   */
  preferencia_nao_localizada?: true;
  data_referencia?: string;

  /**
   * Por que nao ha expediente na data pedida (2026-08-14). `domingo` e regra da
   * clinica; `profissional_nao_atende`, do dentista naquele dia da semana -- e
   * a diferenca muda o que faz sentido oferecer ao paciente.
   */
  motivo_sem_expediente?: MotivoSemExpediente;
  horarios_disponiveis?: string[];
  /**
   * De qual profissional sao os horarios apresentados (2026-08-17).
   *
   * Existe para a redatora NAO repetir uma pergunta ja respondida. Caso real:
   * com dois dentistas aptos, a Iris perguntou qual, o paciente respondeu
   * "Diego ramoz", o Core resolveu e mandou apresentar horarios -- mas os
   * fatos so traziam a lista. Sem saber de quem eram, ela perguntou o
   * dentista de novo junto com os horarios.
   *
   * A solucao e dar o fato, nunca proibir a pergunta: perguntar diante de
   * ambiguidade real e o valor da redatora.
   */
  dentista_dos_horarios?: string;
  agendamento_confirmado?: { data: string; horario: string };
  /**
   * Profissional e procedimento do agendamento que ACABOU de ser criado
   * (2026-08-16). Acompanham `agendamento_confirmado` para o fechamento poder
   * ser conferido pelo paciente -- antes ele via so data e horario.
   *
   * Nomes exibiveis, do catalogo da clinica; nunca ids.
   */
  dentista_confirmado?: string;
  procedimento_confirmado?: string;
  proposta_pendente?: { data: string; horario: string };
  dados_faltantes?: CampoFaltante[];
  /**
   * Cadastro JA CONHECIDO do paciente -- nome, CPF, data de nascimento,
   * e-mail (2026-08-17, decisao do Gabriel).
   *
   * Muda uma fronteira que existia desde o inicio: ate aqui NENHUM dado
   * pessoal chegava a redatora, so a lista de quais campos faltavam. O custo
   * disso era pratico: ela nao conseguia conferir um dado com o paciente
   * ("seu CPF e ...?"), nao reconhecia quem ja tinha ficha, e pedia de novo o
   * que a clinica ja sabia.
   *
   * Contem SO os campos efetivamente preenchidos. Ausente quando nao ha
   * cadastro nenhum.
   */
  cadastro_conhecido?: CadastroPaciente;
  /**
   * Campos que o paciente informou NESTE turno e o Core REJEITOU por invalidos
   * -- CPF com digito errado, data impossivel, e-mail malformado.
   *
   * Existe para a Iris poder dizer QUAL campo estava errado, em vez de
   * repetir o pedido inteiro. Ate 2026-08-16 a rejeicao era silenciosa: numa
   * conversa real o paciente enviou um CPF de 10 digitos, a Iris pediu
   * "nome, CPF e data" de novo como se ele nao tivesse respondido, e ele
   * reenviou o mesmo dado errado.
   *
   * SO O NOME DO CAMPO -- nunca o valor rejeitado, que e PII. A redatora
   * formula o texto; nao ha frase fixa por campo.
   */
  dados_invalidos?: CampoFaltante[];
  falha_tecnica?: true;
  /**
   * Data e horario do agendamento ATUAL do paciente, na remarcacao
   * (specs/remarcacao-conversacional-v1.md secao 5) -- o "de onde" da
   * pergunta "de onde para onde". `proposta_pendente` continua sendo o "para
   * onde" (o horario novo, aguardando confirmacao) -- mesmo campo que o
   * novo agendamento ja usa, sem alteracao de significado.
   */
  agendamento_atual?: { data: string; horario: string };
  /**
   * Descricoes dos agendamentos ativos do paciente, quando ha mais de um e
   * ele precisa escolher qual remarcar (spec secao 3). Mesmo papel que
   * `dentistas_candidatos` ja tem para escolha de profissional -- texto
   * pronto, nunca IDs.
   */
  agendamentos_candidatos?: string[];
  /**
   * A pergunta de confirmacao de cancelamento JA tinha sido feita para este
   * mesmo agendamento, e a resposta do paciente nao ficou clara o bastante
   * para autorizar (specs/cancelamento-conversacional-v1.md secao 4).
   *
   * A redatora deve RECONHECER isso e pedir esclarecimento de forma natural,
   * em vez de repetir a mesma pergunta mecanicamente. O objetivo dela e
   * eliminar SOMENTE a duvida daquele momento -- nao reiniciar o fluxo, nao
   * exigir uma palavra fixa, nao transformar a conversa em sequencia
   * burocratica.
   *
   * O Core NAO dita a frase: `pedir_confirmacao_cancelamento` continua sendo
   * o objetivo, e a redatora formula da maneira mais clara para o contexto.
   *
   * Mesma forma de `preferencia_nao_localizada` -- fato opcional que
   * acrescenta uma nuance a um objetivo que ja existe.
   */
  confirmacao_nao_compreendida?: true;
  /**
   * Agendamentos futuros que este paciente ja tem marcados
   * (specs/consulta-agendamento-conversacional-v1.md). Texto pronto, nunca
   * IDs -- mesmo formato de `agendamentos_candidatos`.
   *
   * E CONTEXTO DISPONIVEL, nunca assunto obrigatorio: o `objetivo` da
   * resposta nao muda por causa dele. A redatora usa quando o assunto for
   * esse e ignora quando nao for -- e o mesmo estatuto que o contrato dela ja
   * da aos demais campos ("os dados reais que voce PODE mencionar").
   *
   * PRESENTE SOMENTE em decisao conversacional (`saudacao`, `duvida_livre`,
   * `mensagem_nao_compreendida`), nunca em fluxo operacional nem em
   * `desistencia` -- ver `agendamentos_do_paciente` em orquestrador-tipos.ts.
   *
   * LIMITACAO MEDIDA E ACEITA (spec secao 5): em duvidas sobre a clinica
   * (preco, convenio, endereco) a redatora pode mencionar o agendamento sem
   * necessidade. Ruido conversacional, nunca dado errado -- decisao do
   * Gabriel, 2026-08-12. Quatro rotas para separar esses casos foram medidas
   * contra a IA real e reprovadas (spec secao 4); nenhuma deve ser retomada
   * por suposicao.
   */
  agendamentos_do_paciente?: string[];
  /**
   * Dados da PROPRIA CLINICA (2026-08-17). Sem isso a Iris nao sabia para
   * quem trabalhava: perguntada "qual e a clinica? fica onde", respondia
   * "somos a clinica odontologica". Ver clinica-conhecida.ts.
   */
  clinica_conhecida?: ClinicaConhecida;
  /**
   * Quem ATENDE na clinica, com as especialidades de cada um (2026-08-18).
   *
   * Disponivel em QUALQUER turno, nao so quando o Core precisa que o
   * paciente escolha profissional (`dentistas_candidatos`). Antes disso a
   * Iris, perguntada "quais sao os dentistas?", pedia o procedimento
   * primeiro -- unico caminho que a levava ate os nomes.
   */
  dentistas_da_clinica?: DentistaDaClinica[];
  /**
   * Tratamentos que o paciente JA APROVOU e ainda nao agendou (2026-08-18).
   *
   * Nasce do ciclo real da clinica: o dentista planeja no odontograma, gera
   * o orcamento, o paciente aprova -- e ninguem marca. Antes disso a Iris
   * respondia "qual procedimento voce deseja agendar?" a quem tinha dois
   * tratamentos aprovados esperando.
   *
   * Nunca traz valor: preco ja foi conversado entre dentista e paciente.
   */
  tratamentos_aprovados?: TratamentoAprovado[];
  /**
   * Precos, separados entre o que a clinica LIBEROU (`mostrar_valor: true`
   * item a item) e o que depende de avaliacao. Ver precos-clinica.ts -- o
   * valor de um procedimento nao liberado nunca chega aqui.
   */
  precos?: PrecosClinica;
}

/**
 * Mapeamento puro e exaustivo: uma decisao nova sem `case` correspondente
 * nao compila (specs/resposta-conversacional-v1.md secao 2).
 *
 * `aguardando_data_horario` colapsa todos os motivos temporais (incompleto/
 * ambiguo/invalido/passado/conflito/erro_configuracao) num unico objetivo
 * generico -- ao contrario de gerar-resposta-paciente.ts, que tem texto
 * proprio por motivo. Achado da implementacao: a spec aprovada nao previu
 * um fato para carregar essa nuance; a IA redatora recebe a mensagem CRUA
 * do paciente e pode reagir ao contexto ("dia 15" no passado), mas perde
 * precisao estrutural que o texto fixo tinha. O fallback determinístico
 * (gerar-resposta-paciente.ts) preserva a nuance completa quando a redacao
 * falha ou e reprovada.
 */
/**
 * RELACAO FACTUAL da data com o dia de hoje.
 *
 * Existe porque a redatora nao tem como saber que dia e hoje: ela recebia
 * apenas `"14/08"` e precisava DEDUZIR se aquilo era hoje, amanha ou outro
 * dia. Em 2026-08-14 as 13:52 ela deduziu errado -- o Core tinha decidido
 * `2026-08-14 15:00` (hoje) e a resposta saiu como "amanha, 14/08", uma frase
 * internamente contraditoria.
 *
 * O calculo e do Core, deterministico, em dias de calendario, sobre a MESMA
 * data de referencia que o Core usou para resolver "hoje" no turno
 * (`instante_atual.data`) -- por construcao a relacao nunca diverge da decisao.
 *
 * Data malformada cai em `'outra'`: perder o "hoje" e aceitavel, afirmar um
 * "hoje" errado nao e.
 */
export type RelacaoComHoje = 'hoje' | 'amanha' | 'outra';

function emDiasUtc(dataIso: string): number | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataIso);
  if (partes === null) return null;
  const instante = Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
  return Number.isNaN(instante) ? null : instante / 86400000;
}

export function relacaoComHoje(dataIso: string, hojeIso: string): RelacaoComHoje {
  const data = emDiasUtc(dataIso);
  const hoje = emDiasUtc(hojeIso);
  if (data === null || hoje === null) return 'outra';
  const diferenca = data - hoje;
  if (diferenca === 0) return 'hoje';
  if (diferenca === 1) return 'amanha';
  return 'outra';
}

/**
 * UNICA forma de uma data chegar a redatora. Aplicada a TODOS os fatos que
 * carregam data -- proposta, confirmacao, cancelamento, remarcacao, candidatos
 * e data de referencia dos horarios -- em vez de uma regra por tipo de
 * mensagem. A data absoluta nunca some: ela acompanha o rotulo relativo.
 */
export function formatarDataParaRedatora(dataIso: string, hojeIso: string): string {
  const absoluta = formatarData(dataIso);
  switch (relacaoComHoje(dataIso, hojeIso)) {
    case 'hoje':
      return `hoje, ${absoluta}`;
    case 'amanha':
      return `amanhã, ${absoluta}`;
    default:
      return absoluta;
  }
}

export function derivarFatosAutorizados(
  decisao: DecisaoOrquestrador,
  /** `instante_atual.data` do turno -- a MESMA referencia que o Core usou. */
  dataHoje: string,
  substituicaoPorAvaliacao?: { dentista_nome_exibido: string },
  agendamentosDoPaciente?: readonly AgendamentoAtivo[],
  /**
   * Cadastro JA CONHECIDO do paciente (2026-08-17, decisao do Gabriel).
   *
   * Ate aqui a redatora recebia so QUAIS campos faltavam (`dados_faltantes`),
   * nunca os valores -- entao nao conseguia conferir nada com o paciente nem
   * reconhecer quem ja tem ficha, e pedia dado que a clinica ja tinha.
   *
   * MUDANCA DELIBERADA DE FRONTEIRA: dado cadastral passa a atravessar ate a
   * IA que redige. Avaliado com o Gabriel: em odontologia o ganho de
   * atendimento (conferir e nao repetir pedido) supera o risco, e a mensagem
   * crua do paciente -- onde o CPF costuma estar escrito -- ja atravessava
   * essa mesma fronteira na interpretacao.
   */
  cadastroConhecido?: CadastroPaciente,
  /**
   * Dados da PROPRIA clinica (2026-08-17). Ortogonal a decisao, como o
   * cadastro do paciente: a Iris pode dizer onde fica e como chegar em
   * QUALQUER turno, nao so num objetivo especifico.
   */
  clinicaConhecida?: ClinicaConhecida,
  /**
   * Precos ja filtrados pelo consentimento da clinica (precos-clinica.ts).
   * O valor de um procedimento nao liberado nunca chega ate aqui -- o
   * padrao e NAO informar preco, e so a clinica muda isso, pelo painel.
   */
  precos?: PrecosClinica,
  /** Quem atende na clinica -- ortogonal a decisao, como os dados da clinica. */
  dentistasDaClinica?: readonly DentistaDaClinica[],
  /** Tratamentos aprovados e por agendar -- ortogonal a decisao. */
  tratamentosAprovados?: readonly TratamentoAprovado[]
): FatosAutorizados {
  let fatos = derivarPorDecisao(decisao, dataHoje);

  // Cadastro conhecido -- ortogonal a decisao, como a substituicao: serve
  // tanto para conferir na coleta quanto para nao repetir pedido a quem ja
  // tem ficha. So os campos REALMENTE preenchidos entram.
  if (cadastroConhecido !== undefined) {
    const preenchidos = Object.fromEntries(
      Object.entries(cadastroConhecido).filter(([, v]) => typeof v === 'string' && v.trim() !== '')
    );
    if (Object.keys(preenchidos).length > 0) {
      fatos = { ...fatos, cadastro_conhecido: preenchidos as CadastroPaciente };
    }
  }

  // A substituicao e um fato deste turno, ortogonal a decisao (ela pode
  // acompanhar horarios_disponiveis, aguardando_confirmacao, reserva_criada
  // ou qualquer outro desfecho depois da troca) -- por isso e anexada aqui,
  // e nao dentro de um `case` (specs/dentista-semantico-v1.md secao 5).
  if (substituicaoPorAvaliacao !== undefined) {
    fatos = {
      ...fatos,
      dentista_preferido: substituicaoPorAvaliacao.dentista_nome_exibido,
      substituido_por_avaliacao: true,
    };
  }

  // Os agendamentos do paciente seguem EXATAMENTE o mesmo padrao acima
  // (specs/consulta-agendamento-conversacional-v1.md secao 1): fato do turno,
  // anexado FORA do switch, sem tocar no `objetivo`. Quem restringe a quais
  // decisoes ele chega e o orquestrador, nunca esta funcao -- aqui, se veio,
  // e porque ja foi autorizado.
  //
  // Lista vazia nunca vira campo (`ausente, nunca vazio`), mesma disciplina
  // do restante do Core.
  if (agendamentosDoPaciente !== undefined && agendamentosDoPaciente.length > 0) {
    fatos = {
      ...fatos,
      agendamentos_do_paciente: agendamentosDoPaciente.map((a) => descreverAgendamentoDoPaciente(a, dataHoje)),
    };
  }

  // Dados da clinica e precos seguem o MESMO padrao dos anteriores: fato do
  // turno, anexado fora do switch, sem tocar no `objetivo`. Ambos ja chegam
  // filtrados (campo vazio nao vira fato; preco nao liberado nao vira valor),
  // entao aqui nao ha decisao nenhuma a tomar -- se veio, e porque o painel
  // autorizou.
  if (clinicaConhecida !== undefined) {
    fatos = { ...fatos, clinica_conhecida: clinicaConhecida };
  }

  if (dentistasDaClinica !== undefined && dentistasDaClinica.length > 0) {
    fatos = { ...fatos, dentistas_da_clinica: [...dentistasDaClinica] };
  }

  if (tratamentosAprovados !== undefined && tratamentosAprovados.length > 0) {
    fatos = { ...fatos, tratamentos_aprovados: [...tratamentosAprovados] };
  }

  if (precos !== undefined) {
    fatos = { ...fatos, precos };
  }

  return fatos;
}

// Nomes do dia da semana civil, na convencao (0=segunda..6=domingo) ja usada
// por resolver-temporal.ts, carregar-disponibilidade.ts e orquestrador.ts.
const NOMES_DIA_SEMANA = [
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
  'domingo',
] as const;

// Algoritmo de Howard Hinnant (days_from_civil), REIMPLEMENTADO aqui pela
// mesma razao ja documentada em carregar-disponibilidade.ts e orquestrador.ts:
// e a convencao do projeto reimplementar 12 linhas de aritmetica de calendario
// pura em vez de acoplar modulos so para exportar um helper privado
// (specs/consulta-agendamento-conversacional-v1.md secao 10).
function diaDaSemanaCivil(data: string): string | null {
  const partes = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(data);
  if (!partes) return null;
  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);

  const y = mes <= 2 ? ano - 1 : ano;
  const era = Math.floor(y / 400);
  const anoDaEra = y - era * 400;
  const diaDoAno = Math.floor((153 * (mes + (mes > 2 ? -3 : 9)) + 2) / 5) + dia - 1;
  const diaDaEra = anoDaEra * 365 + Math.floor(anoDaEra / 4) - Math.floor(anoDaEra / 100) + diaDoAno;
  const dias = era * 146097 + diaDaEra - 719468;
  const indice = (((dias + 3) % 7) + 7) % 7;
  return NOMES_DIA_SEMANA[indice] ?? null;
}

/**
 * Texto pronto que a redatora le. Mesma forma de `descreverAgendamentoAtivo`
 * (orquestrador.ts), incluindo o dia da semana calculado DETERMINISTICAMENTE
 * pelo Core -- a IA nunca calcula dia da semana (contrato fechado por medicao,
 * specs/remarcacao-conversacional-v1.md secao 3).
 *
 * Campos nulaveis no banco operacional degradam a frase em vez de exibir
 * "null": sem procedimento vira "atendimento", sem dentista some a parte do
 * profissional.
 *
 * `procedimento_id` NUNCA e usado como fallback de texto (revisao
 * independente, 2026-08-12): e um identificador INTERNO e opaco, e este
 * caminho termina na redatora -- ou seja, no texto enviado ao paciente.
 * Nenhum ID interno pode atravessar essa fronteira por aqui.
 */
function descreverAgendamentoDoPaciente(agendamento: AgendamentoAtivo, dataHoje: string): string {
  const procedimento = agendamento.procedimento ?? 'atendimento';
  const dataFormatada = formatarDataParaRedatora(agendamento.data, dataHoje);
  const diaSemana = diaDaSemanaCivil(agendamento.data);
  const dataComDia = diaSemana !== null ? `${diaSemana}, ${dataFormatada}` : dataFormatada;
  const comDentista = agendamento.dentista_nome !== null ? ` com ${agendamento.dentista_nome}` : '';
  return `${procedimento}${comDentista} — ${dataComDia} às ${agendamento.horario}`;
}

function derivarPorDecisao(decisao: DecisaoOrquestrador, dataHoje: string): FatosAutorizados {
  switch (decisao.tipo) {
    case 'clinica_sem_catalogo':
    case 'erro_catalogo_dentista':
    case 'duracao_nao_configurada':
    case 'erro_configuracao_duracao':
    case 'reserva_falhou':
      return { objetivo: 'informar_falha_tecnica', falha_tecnica: true };

    case 'saudacao':
      return { objetivo: 'cumprimentar_e_oferecer_ajuda' };

    case 'duvida_livre':
      return { objetivo: 'acolher_e_retomar' };

    case 'mensagem_nao_compreendida':
      return { objetivo: 'pedir_reformulacao' };

    case 'desistencia':
      return { objetivo: 'encerrar_cordialmente' };

    case 'aguardando_procedimento':
      return { objetivo: 'pedir_procedimento', dados_faltantes: ['procedimento'] };

    case 'aguardando_escolha_dentista':
      return {
        objetivo: 'escolher_entre_dentistas',
        dentistas_candidatos: decisao.dentistas.map((d) => d.nome_exibido),
        // Derivado pelo Core a partir de `dentistas_candidatos: []`
        // (specs/dentista-semantico-v1.md secao 12) -- nunca um sinal proprio
        // da IA. So diz "o profissional mencionado nao existe aqui"; QUEM ele
        // mencionou esta na mensagem crua, que a redatora ja recebe.
        ...(decisao.preferencia_nao_localizada === true ? { preferencia_nao_localizada: true as const } : {}),
      };

    case 'sem_dentista_disponivel':
      // `avaliacao_oferecida` so aparece quando a alternativa e real -- sem
      // ela a redatora nao tem fato que autorize oferecer nada, e por isso
      // nao pode inventar a pergunta.
      return {
        objetivo: 'informar_sem_profissional',
        ...(decisao.procedimento_oferecido !== undefined ? { avaliacao_oferecida: true as const } : {}),
      };

    case 'combinacao_indisponivel':
      // O nome do profissional escolhido e o unico fato aqui -- nunca o nome
      // de outro dentista: sugerir substituto e exatamente o que esta
      // decisao existe para impedir.
      return { objetivo: 'informar_combinacao_indisponivel', dentista_preferido: decisao.dentista_nome_exibido };

    case 'aguardando_data_horario':
      return {
        objetivo: 'pedir_data_ou_horario',
        dados_faltantes: ['data'],
        // Quem ja foi escolhido para este agendamento. Sem isso a redatora
        // nao sabia que a escolha do profissional ja tinha acontecido -- e
        // agradecia ao paciente pelo nome do dentista (2026-08-18).
        ...(decisao.dentista_nome_exibido !== undefined
          ? { dentista_confirmado: decisao.dentista_nome_exibido }
          : {}),
      };

    case 'horarios_disponiveis':
      return fatosParaHorariosDisponiveis(decisao.resultado, dataHoje, decisao.dentista_nome_exibido);

    case 'aguardando_confirmacao':
      return {
        objetivo: 'pedir_confirmacao',
        proposta_pendente: { data: formatarDataParaRedatora(decisao.opcao.data, dataHoje), horario: formatarMinutos(decisao.opcao.inicio_min) },
      };

    case 'cadastro_necessario':
      // O Core autoriza QUAIS campos faltam; a redatora e quem formula a
      // pergunta, no tom reciproco de sempre. Nao existe sequencia rigida de
      // textos nem uma pergunta fixa por campo.
      //
      // `dados_invalidos` (2026-08-16) distingue "nunca informou" de
      // "informou e o Core rejeitou". Sem ele a Iris repetia o pedido
      // inteiro apos um CPF malformado, e o paciente reenviava o mesmo dado
      // errado sem saber qual campo tinha problema -- medido em conversa
      // real.
      //
      // So o NOME do campo, nunca o valor rejeitado (PII).
      return {
        objetivo: 'pedir_cadastro',
        dados_faltantes: [...decisao.campos_faltantes],
        ...(decisao.campos_invalidos !== undefined && decisao.campos_invalidos.length > 0
          ? { dados_invalidos: [...decisao.campos_invalidos] }
          : {}),
      };

    case 'cpf_ja_cadastrado':
      return { objetivo: 'informar_cpf_ja_cadastrado' };

    // NENHUM fato sobre a outra ficha acompanha estes dois: o Core nunca a
    // leu, e a redatora nao precisa de nada dela para perguntar ou para
    // acatar a recusa (specs/cpf-outro-telefone-v1.md secao 4). Nem CPF, nem
    // nome, nem telefone anterior, nem paciente_id.
    case 'troca_telefone_pendente':
      return { objetivo: 'perguntar_troca_telefone' };

    case 'troca_telefone_recusada':
      return { objetivo: 'acatar_recusa_troca_telefone' };

    case 'reserva_criada':
      // FECHAMENTO CONFERIVEL (2026-08-16, pedido do Gabriel apos leitura de
      // conversa real): ate aqui a Iris fechava so com data e horario, e o
      // paciente nao via com quem nem para que ficou marcado -- nao tinha como
      // conferir se saiu certo.
      //
      // Os dois nomes vem da propria decisao, que os recebeu do catalogo ja
      // carregado. Sao os MESMOS valores gravados na linha do agendamento --
      // nenhuma consulta nova, nenhum dado inventado. Campo vazio nao e
      // enviado: a redatora nunca cita o que nao recebeu.
      return {
        objetivo: 'informar_reserva_criada',
        agendamento_confirmado: { data: formatarDataParaRedatora(decisao.data, dataHoje), horario: decisao.horario },
        ...(decisao.dentista_nome_exibido !== '' ? { dentista_confirmado: decisao.dentista_nome_exibido } : {}),
        ...(decisao.procedimento_nome !== '' ? { procedimento_confirmado: decisao.procedimento_nome } : {}),
      };

    case 'reserva_conflito':
      // Mesma familia de "isso que voce escolheu nao esta mais livre" que
      // horario_exato_indisponivel -- sem alternativas conhecidas aqui (a
      // RPC so informou conflito, nao vizinhos), entao sem horarios_disponiveis.
      // REUTILIZADA pela remarcacao (spec secao 6): mesmo desfecho para o
      // paciente, escolher outro horario.
      return { objetivo: 'informar_horario_indisponivel' };

    // --- Remarcacao (2026-08-11, specs/remarcacao-conversacional-v1.md) ---
    case 'sem_agendamento_para_remarcar':
      return { objetivo: 'informar_sem_agendamento_para_remarcar' };

    case 'aguardando_escolha_agendamento':
      return {
        objetivo: 'escolher_entre_agendamentos',
        agendamentos_candidatos: decisao.agendamentos.map((a) => `${formatarDataParaRedatora(a.data, dataHoje)} às ${a.horario}`),
      };

    case 'aguardando_confirmacao_remarcacao':
      return {
        objetivo: 'pedir_confirmacao_remarcacao',
        agendamento_atual: {
          data: formatarDataParaRedatora(decisao.agendamento_atual.data, dataHoje),
          horario: decisao.agendamento_atual.horario,
        },
        proposta_pendente: { data: formatarDataParaRedatora(decisao.opcao.data, dataHoje), horario: formatarMinutos(decisao.opcao.inicio_min) },
      };

    case 'remarcacao_criada':
      // Fechamento conferivel, igual ao da criacao (2026-08-17): profissional
      // e procedimento vem do agendamento que foi remarcado -- a remarcacao
      // preserva os dois, so muda data e horario.
      return {
        objetivo: 'informar_remarcacao_criada',
        agendamento_confirmado: { data: formatarDataParaRedatora(decisao.data, dataHoje), horario: decisao.horario },
        ...(decisao.dentista_nome_exibido !== undefined
          ? { dentista_confirmado: decisao.dentista_nome_exibido }
          : {}),
        ...(decisao.procedimento_nome !== undefined
          ? { procedimento_confirmado: decisao.procedimento_nome }
          : {}),
      };

    // --- Cancelamento (2026-08-11, specs/cancelamento-conversacional-v1.md) ---
    case 'sem_agendamento_para_cancelar':
      return { objetivo: 'informar_sem_agendamento_para_cancelar' };

    case 'aguardando_escolha_agendamento_cancelamento':
      return {
        objetivo: 'escolher_entre_agendamentos_cancelamento',
        agendamentos_candidatos: decisao.agendamentos.map((a) => `${formatarDataParaRedatora(a.data, dataHoje)} às ${a.horario}`),
      };

    // `agendamento_atual` (nao `proposta_pendente`): no cancelamento nao ha
    // "para onde" -- o unico fato e QUAL agendamento sera cancelado. A spec
    // secao 4 exige mostra-lo claramente, nunca um "confirma?" generico.
    // O campo tambem ja e reconhecido por `coletarMinutosAutorizados`
    // (guarda-resposta-redatora.ts), entao a redatora pode citar o horario
    // real sem ser reprovada.
    case 'aguardando_confirmacao_cancelamento':
      // OBJETIVO INALTERADO mesmo quando a confirmacao nao ficou clara: o que
      // a resposta precisa alcancar continua sendo exatamente o mesmo -- obter
      // a confirmacao. So o CONTEXTO muda, e ele viaja como fato opcional.
      return {
        objetivo: 'pedir_confirmacao_cancelamento',
        agendamento_atual: {
          data: formatarDataParaRedatora(decisao.agendamento.data, dataHoje),
          horario: decisao.agendamento.horario,
        },
        ...(decisao.confirmacao_nao_compreendida === true ? { confirmacao_nao_compreendida: true as const } : {}),
      };

    case 'cancelamento_criado':
      // `agendamento_confirmado` carrega aqui o que foi CANCELADO -- o
      // objetivo (`informar_cancelamento_criado`) e que diz a redatora o que
      // fazer com esse fato. Reuso do campo, nao do significado do objetivo.
      return {
        objetivo: 'informar_cancelamento_criado',
        agendamento_confirmado: { data: formatarDataParaRedatora(decisao.data, dataHoje), horario: decisao.horario },
      };
  }
}

function fatosParaHorariosDisponiveis(
  resultado: Extract<DecisaoOrquestrador, { tipo: 'horarios_disponiveis' }>['resultado'],
  dataHoje: string,
  dentistaNomeExibido: string
): FatosAutorizados {
  // De quem sao os horarios. Vazio quando o id nao esta no catalogo -- nesse
  // caso o campo simplesmente nao e enviado, e a redatora nao cita o que nao
  // recebeu.
  const deQuem = dentistaNomeExibido !== '' ? { dentista_dos_horarios: dentistaNomeExibido } : {};

  switch (resultado.tipo) {
    case 'opcoes':
      return {
        objetivo: 'apresentar_horarios',
        data_referencia: formatarDataParaRedatora(resultado.opcoes[0].data, dataHoje),
        horarios_disponiveis: resultado.opcoes.map((opcao) => formatarMinutos(opcao.inicio_min)),
        ...deQuem,
      };

    case 'sem_disponibilidade':
      return { objetivo: 'informar_sem_disponibilidade' };

    // O profissional nao atende nessa data. Fato de agenda, com objetivo
    // proprio: informar e pedir outra data. Antes caia em
    // `informar_falha_tecnica` e o paciente ouvia que o sistema estava
    // quebrado (caso real do sabado 15/08/2026).
    case 'sem_expediente_no_dia':
      return {
        objetivo: 'informar_sem_expediente_e_pedir_outra_data',
        motivo_sem_expediente: resultado.motivo,
        dados_faltantes: ['data'],
      };

    case 'horario_exato_disponivel':
      // Estruturalmente nunca ocorre aqui (orquestrador.ts intercepta esse
      // caso antes de montar 'horarios_disponiveis') -- tratado por
      // exaustividade, com o mesmo fato honesto que gerar-resposta-paciente.ts
      // ja usa nessa posicao.
      return {
        objetivo: 'apresentar_horarios',
        data_referencia: formatarDataParaRedatora(resultado.opcao.data, dataHoje),
        horarios_disponiveis: [formatarMinutos(resultado.opcao.inicio_min)],
        ...deQuem,
      };

    case 'horario_exato_indisponivel': {
      const horarios = [resultado.anterior, resultado.posterior]
        .filter((opcao) => opcao !== undefined)
        .map((opcao) => formatarMinutos(opcao.inicio_min));
      return {
        objetivo: 'informar_horario_indisponivel',
        ...(horarios.length > 0 ? { horarios_disponiveis: horarios, ...deQuem } : {}),
      };
    }

    case 'configuracao_invalida':
    case 'erro_intervalos':
      return { objetivo: 'informar_falha_tecnica', falha_tecnica: true };
  }
}
