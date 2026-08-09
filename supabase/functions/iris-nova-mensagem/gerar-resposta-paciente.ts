// Geracao de resposta curta em portugues para o paciente, a partir da
// decisao ja estruturada do orquestrador (orquestrador-tipos.ts). Funcao
// pura: nao chama IA, nao acessa banco, nao decide fluxo -- so formata os
// dados que a decisao ja carrega (data, horario, motivo). Nunca inventa
// fato algum: nomes de procedimento/dentista NAO aparecem no texto porque
// a decisao nao os carrega (so IDs) e este modulo nao busca nada por conta
// propria (nenhuma nova consulta, nenhuma nova arquitetura).
//
// Escopo: os quatro estados originais do "caminho feliz" --
// horarios_disponiveis, aguardando_confirmacao, reserva_criada,
// reserva_conflito -- mais cinco estados de comportamento conversacional
// minimo (2026-08-05: saudacao, aguardando_procedimento; 2026-08-05,
// specs/interpretacao-natureza-mensagem-v1.md: duvida_livre,
// mensagem_nao_compreendida, desistencia) -- mais aguardando_data_horario
// (2026-08-05, auditoria dos 6 tipos/31 motivos de ResultadoResolucaoTemporal
// que chegam aqui) -- mais, desde 2026-08-06
// (specs/resposta-conversacional-v1.md secao 6), os NOVE estados restantes:
// aguardando_escolha_dentista, cadastro_necessario e sem_dentista_disponivel
// tem texto proprio (situacoes de conversa normal, nunca falha); os outros
// cinco (clinica_sem_catalogo, erro_catalogo_dentista,
// duracao_nao_configurada, erro_configuracao_duracao, reserva_falhou) sao
// falha tecnica real e compartilham uma unica frase
// honesta. Este modulo agora cobre os 18 tipos de DecisaoOrquestrador por
// completo -- nenhum deles retorna resposta:null. Desde a mesma data, este
// e o FALLBACK deterministico (specs/resposta-conversacional-v1.md secao 6):
// o caminho normal e a IA redatora (gerar-resposta-conversacional.ts); este
// modulo so e chamado quando ela falha, e reprovada pela guarda, ou nao
// esta configurada.

import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';
import type { OpcaoHorario, ResultadoDisponibilidade } from './disponibilidade-tipos.ts';
import type {
  MotivoErroConfiguracaoTemporal,
  MotivoIncompletudeTemporal,
  MotivoInvalidoTemporal,
  MotivoPassadoTemporal,
  ResultadoResolucaoTemporal,
} from './temporal-tipos.ts';

/**
 * Mantido como alias documental (era um subconjunto restrito antes de
 * 2026-08-06) -- gerarRespostaPaciente agora cobre os 18 tipos por
 * completo, entao a restricao deixou de existir. O nome permanece porque
 * chamadores existentes (index.ts) ja o referenciam.
 */
export type DecisaoCaminhoFeliz = DecisaoOrquestrador;

// Os cinco estados de falha tecnica REAL (nunca duvida do paciente) --
// compartilham uma unica frase honesta, nunca expondo o motivo tecnico
// bruto (specs/resposta-conversacional-v1.md secao 6).
const RESPOSTA_FALHA_TECNICA_GENERICA = 'Tive um problema técnico agora. Pode tentar de novo em instantes?';

export function gerarRespostaPaciente(decisao: DecisaoOrquestrador): string {
  switch (decisao.tipo) {
    case 'horarios_disponiveis':
      return respostaHorariosDisponiveis(decisao.resultado);
    case 'aguardando_confirmacao':
      return `Encontrei esse horário: ${formatarOpcao(decisao.opcao)}. Posso confirmar?`;
    case 'reserva_criada':
      return `Prontinho! Agendamento confirmado para ${formatarData(decisao.data)} às ${decisao.horario}.`;
    case 'reserva_conflito':
      return 'Esse horário acabou de ficar indisponível. Pode escolher outro horário?';
    case 'saudacao':
      return 'Olá! Como posso te ajudar hoje?';
    case 'aguardando_procedimento':
      // Os quatro motivos de nao_resolvido (procedimento-tipos.ts) sao
      // equivalentes perante o paciente (specs/procedimentos-v1.md secao 7):
      // nunca revelar se um procedimento existe mas esta inativo/desativado
      // -- por isso uma unica pergunta, igual para os quatro.
      return 'Qual procedimento ou atendimento você está buscando?';
    case 'duvida_livre':
      // Situacao "Conversa basica" (atendimento-v1.md secao 5): acolhe sem
      // opinar clinicamente e redireciona pro agendamento -- nunca inventa
      // fato sobre o que foi perguntado (a decisao nao carrega esse dado).
      return 'Posso te ajudar a agendar uma consulta. Me conta qual procedimento você precisa.';
    case 'mensagem_nao_compreendida':
      return 'Desculpa, não entendi. Pode explicar de outro jeito?';
    case 'desistencia':
      // Situacao "Desistencia" (atendimento-v1.md secao 5): encerra com
      // cordialidade, nunca trata como cancelamento de agendamento existente.
      return 'Sem problemas! Se precisar, é só chamar.';
    case 'aguardando_data_horario':
      return respostaAguardandoDataHorario(decisao.resultado);
    // --- Os tres estados de conversa normal (2026-08-06) ---
    case 'aguardando_escolha_dentista':
      // dentistas ja vem com nome_exibido (dentista-tipos.ts) -- dado de
      // catalogo, nunca PII do paciente.
      return `Encontrei mais de um profissional para esse atendimento: ${decisao.dentistas
        .map((d) => d.nome_exibido)
        .join(', ')}. Qual você prefere?`;
    case 'cadastro_necessario':
      return 'Para confirmar esse agendamento, preciso completar seu cadastro antes. Pode me passar seu nome completo?';
    case 'sem_dentista_disponivel':
      // A pergunta so e feita quando a alternativa EXISTE de verdade
      // (`procedimento_oferecido` presente). Ate 2026-08-09 ela era feita
      // sempre -- inclusive quando nao havia avaliacao possivel, o que era
      // uma promessa que o Core nao tinha como cumprir.
      return decisao.procedimento_oferecido !== undefined
        ? 'Não encontrei nenhum profissional disponível para esse atendimento. Posso verificar uma Consulta/Avaliação em vez disso?'
        : 'Não encontrei nenhum profissional disponível para esse atendimento no momento.';
    case 'combinacao_indisponivel':
      // O paciente escolheu um profissional que nao realiza esse atendimento
      // e para quem a avaliacao tambem nao e possivel. Nunca sugere OUTRO
      // profissional (specs/dentista-semantico-v1.md secao 5): trocar quem
      // ele escolheu, mesmo perguntando, e o comportamento que esta spec
      // existe para eliminar.
      return `Não consigo agendar esse atendimento com ${decisao.dentista_nome_exibido}. Quer tentar outro procedimento com ${decisao.dentista_nome_exibido}?`;
    // --- Os cinco estados de falha tecnica real ---
    case 'clinica_sem_catalogo':
    case 'erro_catalogo_dentista':
    case 'duracao_nao_configurada':
    case 'erro_configuracao_duracao':
    case 'reserva_falhou':
      return RESPOSTA_FALHA_TECNICA_GENERICA;
  }
}

// resultado.tipo aqui cobre as SEIS variantes de ResultadoResolucaoTemporal
// que chegam nesta posicao (todas exceto 'resolvido', que o orquestrador ja
// intercepta antes de montar 'aguardando_data_horario'). Agrupamento por
// tipo/motivo aprovado por Gabriel em 2026-08-05, apos auditoria dos 31
// motivos: so 8 sao alcancaveis pelo adaptador atual
// (montar-fatos-temporais.ts), os demais sao tratados so por exaustividade
// de contrato -- nunca texto inventado, nunca `resposta:null`.
function respostaAguardandoDataHorario(
  resultado: Exclude<ResultadoResolucaoTemporal, { tipo: 'resolvido' }>
): string {
  switch (resultado.tipo) {
    case 'incompleto':
      return respostaIncompleto(resultado.motivo);
    case 'ambiguo':
      // Os 5 motivos (temporal-tipos.ts) sao hoje inalcancaveis pelo
      // adaptador atual (nunca produz dia_semana, horario_12h ou mais de um
      // periodo) -- um unico texto generico, tratado so por exaustividade.
      return 'Não consegui entender exatamente a data ou horário. Pode me dizer de um jeito mais direto, tipo "15/03" ou "14h"?';
    case 'invalido':
      return respostaInvalido(resultado.motivo);
    case 'passado':
      return respostaPassado(resultado.motivo);
    case 'conflito':
      // Os 7 motivos (temporal-tipos.ts) sao hoje inalcancaveis pelo
      // adaptador atual (nunca produz mais de uma data/horario/intencao por
      // leva, nunca restricao) -- um unico texto generico.
      return 'Percebi mais de uma data ou horário na sua mensagem e fiquei em dúvida. Pode confirmar só uma?';
    case 'erro_configuracao':
      return respostaErroConfiguracaoTemporal(resultado.motivo);
  }
}

// intencao_ausente (leva vazia) e data_ausente (estruturalmente
// inalcancavel hoje -- intencao so e emitida junto com a data em
// montar-fatos-temporais.ts) pedem a mesma coisa: a data. horario_recorrente
// _nao_suportado e o unico motivo deste grupo que nao compartilha -- e sobre
// "qualquer horario mais proximo" combinado com horario exato, nunca sobre
// falta de data.
function respostaIncompleto(motivo: MotivoIncompletudeTemporal): string {
  switch (motivo) {
    case 'intencao_ausente':
    case 'data_ausente':
      return 'Para qual data você gostaria de agendar? Pode ser hoje, amanhã ou uma data específica.';
    case 'horario_recorrente_nao_suportado':
      return 'No momento só consigo buscar horário pra uma data específica. Qual data você prefere?';
  }
}

// Tres grupos: "data invalida" (so data_impossivel e alcancavel hoje;
// ano_fora_do_dominio/ano_dois_digitos sao inalcancaveis pelo adaptador
// atual), "horario invalido" (hora/minuto_fora_do_dominio e horario_24_00,
// todos alcancaveis) e um generico tecnico para os dois motivos estruturais
// (atomo_invalido, quantidade_atomica_excedida) que nunca ocorrem hoje.
function respostaInvalido(motivo: MotivoInvalidoTemporal): string {
  switch (motivo) {
    case 'data_impossivel':
    case 'ano_fora_do_dominio':
    case 'ano_dois_digitos':
      return 'Essa data não existe no calendário. Pode conferir e me mandar de novo? Ex.: 15/03.';
    case 'hora_fora_do_dominio':
    case 'minuto_fora_do_dominio':
    case 'horario_24_00':
      return 'Esse horário não é válido. Pode me mandar de novo? Ex.: 14h ou 14:30.';
    case 'atomo_invalido':
    case 'quantidade_atomica_excedida':
      return 'Não consegui entender a data ou horário. Pode reformular?';
  }
}

// "Data no passado" (data_passada; dia_semana_esta_passado e inalcancavel
// hoje, dia da semana nunca e emitido) pede uma data futura. "Horario de
// hoje no passado" (horario_passado; inicio/termino_ate_passado sao
// inalcancaveis hoje, restricao nunca e emitida) pede outro horario -- as
// duas perguntas de reconducao sao diferentes, nunca compartilham texto.
function respostaPassado(motivo: MotivoPassadoTemporal): string {
  switch (motivo) {
    case 'data_passada':
    case 'dia_semana_esta_passado':
      return 'Essa data já passou. Você quer marcar pra uma data futura?';
    case 'horario_passado':
    case 'inicio_ate_passado':
    case 'termino_ate_passado':
      return 'Esse horário de hoje já passou. Prefere outro horário hoje, ou outro dia?';
  }
}

// Erro tecnico, nunca dúvida do paciente (regra do Gabriel). fuso_ausente
// (alcancavel) e fuso_formato_invalido (inalcancavel hoje) compartilham --
// mesma causa raiz: configuracao de fuso da clinica. instante_atual_invalido
// e separado -- falha do proprio transporte, nao da clinica; nenhum dos
// dois afirma uma acao que nao aconteceu (nunca "equipe avisada").
function respostaErroConfiguracaoTemporal(motivo: MotivoErroConfiguracaoTemporal): string {
  switch (motivo) {
    case 'fuso_ausente':
    case 'fuso_formato_invalido':
      return 'Não consegui calcular os horários dessa clínica agora. Pode tentar novamente em instantes?';
    case 'instante_atual_invalido':
      return 'Tive um problema técnico agora. Pode tentar de novo em instantes?';
  }
}

// resultado.tipo aqui cobre as SEIS variantes de ResultadoDisponibilidade
// (disponibilidade-tipos.ts), nao so 'opcoes' -- e o mesmo tipo que
// orquestrador-tipos.ts usa em 'horarios_disponiveis' (nunca estreitado
// para excluir 'horario_exato_disponivel', que so nao ocorre nesta posicao
// por construcao do proprio orquestrador, nao por tipo). Cada variante tem
// texto proprio, honesto sobre o que os dados realmente dizem -- nunca um
// texto generico compartilhado entre variantes nao relacionadas.
function respostaHorariosDisponiveis(resultado: ResultadoDisponibilidade): string {
  switch (resultado.tipo) {
    case 'opcoes': {
      // Contrato do proprio tipo (disponibilidade-tipos.ts): "uma ou mais
      // opcoes" -- nunca vazio. Todas as opcoes de uma mesma chamada
      // compartilham a mesma data (o gerador e estritamente diario), entao
      // a data e mencionada uma unica vez.
      const horarios = resultado.opcoes.map((opcao) => formatarMinutos(opcao.inicio_min)).join(', ');
      return `Horários livres para ${formatarData(resultado.opcoes[0].data)}: ${horarios}. Qual você prefere?`;
    }
    case 'sem_disponibilidade':
      return 'Não encontrei nenhum horário livre para essa data. Quer tentar outra data?';
    case 'horario_exato_disponivel':
      // Estruturalmente nunca ocorre aqui (orquestrador.ts intercepta esse
      // caso antes de montar 'horarios_disponiveis'), mas o tipo
      // compartilhado exige tratamento -- texto honesto, sem inventar nada
      // alem do que a propria opcao ja carrega.
      return `Encontrei um horário disponível: ${formatarOpcao(resultado.opcao)}.`;
    case 'horario_exato_indisponivel':
      return respostaHorarioExatoIndisponivel(resultado.anterior, resultado.posterior);
    case 'configuracao_invalida':
    case 'erro_intervalos':
      // Falha de configuracao/estrutura interna -- nunca expor o motivo
      // tecnico bruto ao paciente.
      return 'Não consegui calcular os horários agora. Pode tentar novamente em instantes?';
  }
}

function respostaHorarioExatoIndisponivel(anterior: OpcaoHorario | undefined, posterior: OpcaoHorario | undefined): string {
  if (anterior && posterior) {
    return `Esse horário não está livre. Tenho ${formatarMinutos(anterior.inicio_min)} ou ${formatarMinutos(posterior.inicio_min)} disponíveis. Qual você prefere?`;
  }
  if (anterior) {
    return `Esse horário não está livre. Tenho ${formatarMinutos(anterior.inicio_min)} disponível. Prefere esse?`;
  }
  if (posterior) {
    return `Esse horário não está livre. Tenho ${formatarMinutos(posterior.inicio_min)} disponível. Prefere esse?`;
  }
  return 'Esse horário não está livre e não encontrei outro próximo nessa data. Quer tentar outra data?';
}

function formatarOpcao(opcao: OpcaoHorario): string {
  return `${formatarData(opcao.data)} às ${formatarMinutos(opcao.inicio_min)}`;
}

// data sempre chega em 'YYYY-MM-DD' (contrato de InstanteAtual/OpcaoHorario/
// resultado da RPC) -- manipulacao de string pura, sem Date, sem fuso: o
// mesmo principio ja aplicado em todo o nucleo (nunca le relogio, nunca
// depende do ambiente).
//
// Exportada (aditivo, 2026-08-06) para que fatos-autorizados.ts formate
// datas EXATAMENTE como o paciente ve no texto -- mesmo principio ja usado
// para formatarMinutos.
export function formatarData(dataIso: string): string {
  const [, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}`;
}

// minutosParaHHMM e privada em orquestrador.ts, e este modulo nao pode
// alterar o orquestrador para exporta-la (regra desta etapa) -- reimplementada
// aqui, mesmo principio ja usado em carregar-disponibilidade.ts para
// diaDaSemanaLocal (nao tocar num arquivo fora de escopo so para reusar uma
// funcao privada de 3 linhas).
//
// Exportada (aditivo, 2026-08-05) para que contexto-horarios.ts grave o
// snapshot com EXATAMENTE a mesma formatacao que o paciente viu no texto --
// a spec exige "mesma funcao", nunca reconstruir a partir do texto nem uma
// terceira copia destas 4 linhas.
export function formatarMinutos(minutos: number): string {
  const hora = Math.floor(minutos / 60);
  const minuto = minutos % 60;
  return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
}
