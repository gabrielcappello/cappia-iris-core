// Geracao de resposta curta em portugues para o paciente, a partir da
// decisao ja estruturada do orquestrador (orquestrador-tipos.ts). Funcao
// pura: nao chama IA, nao acessa banco, nao decide fluxo -- so formata os
// dados que a decisao ja carrega (data, horario, motivo). Nunca inventa
// fato algum: nomes de procedimento/dentista NAO aparecem no texto porque
// a decisao nao os carrega (so IDs) e este modulo nao busca nada por conta
// propria (nenhuma nova consulta, nenhuma nova arquitetura).
//
// Escopo desta etapa (decisao do Gabriel): somente os quatro estados do
// "caminho feliz" -- horarios_disponiveis, aguardando_confirmacao,
// reserva_criada, reserva_conflito. Os outros onze estados de
// DecisaoOrquestrador NAO sao aceitos por este modulo -- o parametro so
// tipa os quatro cobertos, entao qualquer outro estado e erro de
// compilacao no chamador, nunca um fallback generico em tempo de execucao.
//
// Nao altera orquestrador.ts nem e chamado por ele nesta etapa -- modulo
// avulso, pronto para ser ligado por um transporte futuro.

import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';
import type { OpcaoHorario, ResultadoDisponibilidade } from './disponibilidade-tipos.ts';

/** Exatamente os quatro estados cobertos nesta etapa -- nenhum outro tipa aqui. */
export type DecisaoCaminhoFeliz = Extract<
  DecisaoOrquestrador,
  { tipo: 'horarios_disponiveis' | 'aguardando_confirmacao' | 'reserva_criada' | 'reserva_conflito' }
>;

export function gerarRespostaPaciente(decisao: DecisaoCaminhoFeliz): string {
  switch (decisao.tipo) {
    case 'horarios_disponiveis':
      return respostaHorariosDisponiveis(decisao.resultado);
    case 'aguardando_confirmacao':
      return `Encontrei esse horário: ${formatarOpcao(decisao.opcao)}. Posso confirmar?`;
    case 'reserva_criada':
      return `Prontinho! Agendamento confirmado para ${formatarData(decisao.data)} às ${decisao.horario}.`;
    case 'reserva_conflito':
      return 'Esse horário acabou de ficar indisponível. Pode escolher outro horário?';
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
function formatarData(dataIso: string): string {
  const [, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}`;
}

// minutosParaHHMM e privada em orquestrador.ts, e este modulo nao pode
// alterar o orquestrador para exporta-la (regra desta etapa) -- reimplementada
// aqui, mesmo principio ja usado em carregar-disponibilidade.ts para
// diaDaSemanaLocal (nao tocar num arquivo fora de escopo so para reusar uma
// funcao privada de 3 linhas).
function formatarMinutos(minutos: number): string {
  const hora = Math.floor(minutos / 60);
  const minuto = minutos % 60;
  return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
}
