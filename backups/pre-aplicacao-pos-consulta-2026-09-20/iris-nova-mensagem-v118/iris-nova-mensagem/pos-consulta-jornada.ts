// Maquina de estados PURA da jornada de pos-consulta (specs/pos-consulta-
// conversacional-v1.md secoes 5 e 6). Nao acessa banco, nao chama IA, nao
// le relogio -- recebe a jornada/classificacao ja prontas e devolve a
// proxima etapa mais a decisao de resposta. A persistencia real (leitura e
// escrita da linha) e responsabilidade do adaptador RPC
// (pos-consulta-rpc.ts), nunca desta funcao.
//
// Duas entradas possiveis, exatamente como a spec descreve o ciclo de vida:
// iniciarJornada (turno 0, sem resposta do paciente ainda) e
// registrarRespostaSatisfacao (turno 1, resposta ja classificada).

import type {
  ClassificacaoSatisfacao,
  EtapaConfirmadaPosConsulta,
  EtapaJornadaPosConsulta,
  ModoPosConsulta,
} from './pos-consulta-tipos.ts';

/**
 * Decisao de resposta desta jornada NUM turno -- uniao discriminada propria,
 * deliberadamente SEPARADA de DecisaoOrquestrador (ver cabecalho de
 * pos-consulta-tipos.ts).
 */
export type DecisaoPosConsulta =
  // Turno 0, modos 'satisfacao' e 'ambos': a Iris pergunta como foi a
  // experiencia. Nunca ocorre no modo 'google' (secao 6.2: sem pergunta).
  | { tipo: 'perguntar_satisfacao' }
  // Turno 0, modo 'google': o Core ja autoriza o convite direto, sem
  // pergunta (secao 6.2).
  | { tipo: 'convidar_avaliacao_google' }
  // Turno 1, modo 'ambos', classificacao positiva: agradece e convida.
  | { tipo: 'agradecer_e_convidar_avaliacao_google' }
  // Turno 1: resposta nao positiva/incerta (modo 'ambos'), ou qualquer
  // resposta no modo 'satisfacao' (nunca envia Google, secao 6.1) -- o
  // texto de agradecimento pode variar por modo/classificacao, mas o EFEITO
  // (nenhum link) e sempre este mesmo tipo.
  | { tipo: 'agradecer_sem_convite' };

export class ErroTransicaoJornadaPosConsulta extends Error {
  motivo: string;
  constructor(motivo: string) {
    super(`transicao invalida na jornada de pos-consulta: ${motivo}`);
    this.name = 'ErroTransicaoJornadaPosConsulta';
    this.motivo = motivo;
  }
}

export interface EntradaIniciarJornada {
  modo: Exclude<ModoPosConsulta, 'nenhum'>;
}

export interface ResultadoIniciarJornada {
  /**
   * Etapa CONFIRMADA que a primeira entrega, quando confirmada, deve
   * alcancar -- 'aguardando_satisfacao' (ha pergunta, espera resposta) ou
   * 'encerrada' (modo 'google', turno unico). Nunca uma etapa pendente:
   * essa e uma decisao pura sobre o DESTINO, nao sobre o estado
   * intermediario de reserva/confirmacao (que e responsabilidade do
   * adaptador RPC, ver pos-consulta-iniciar-jornada.ts).
   */
  etapaInicial: EtapaConfirmadaPosConsulta;
  decisao: DecisaoPosConsulta;
}

/**
 * Turno 0 -- nunca chamada para modo 'nenhum' (a elegibilidade ja barra isso
 * antes, ver pos-consulta-elegibilidade.ts).
 */
export function iniciarJornada(entrada: EntradaIniciarJornada): ResultadoIniciarJornada {
  switch (entrada.modo) {
    case 'satisfacao':
    case 'ambos':
      // Ambos os modos comecam perguntando -- so divergem depois da resposta
      // (registrarRespostaSatisfacao).
      return { etapaInicial: 'aguardando_satisfacao', decisao: { tipo: 'perguntar_satisfacao' } };

    case 'google':
      // Sem pergunta: convite direto e a jornada ja fecha neste mesmo turno
      // (secao 6.2, passos 2-5).
      return { etapaInicial: 'encerrada', decisao: { tipo: 'convidar_avaliacao_google' } };
  }
}

export interface EntradaRegistrarResposta {
  /** Etapa ATUAL da jornada, lida pelo chamador ANTES desta chamada. */
  etapaAtual: EtapaJornadaPosConsulta;
  modo: Exclude<ModoPosConsulta, 'nenhum'>;
  classificacao: ClassificacaoSatisfacao;
}

export interface ResultadoRegistrarResposta {
  /** Sempre 'encerrada' hoje (nunca ha um terceiro turno) -- tipada como a etapa CONFIRMADA de destino. */
  etapaNova: EtapaConfirmadaPosConsulta;
  decisao: DecisaoPosConsulta;
}

/**
 * Turno 1 -- so pode ser chamada com a jornada em `aguardando_satisfacao`.
 * Chamar fora dessa etapa e erro de programacao do chamador (idempotencia de
 * efeito real e responsabilidade do adaptador RPC via CAS na propria linha,
 * nunca desta funcao pura); aqui a guarda existe para nunca produzir um
 * segundo convite silenciosamente a partir de um estado incoerente.
 */
export function registrarRespostaSatisfacao(entrada: EntradaRegistrarResposta): ResultadoRegistrarResposta {
  if (entrada.etapaAtual !== 'aguardando_satisfacao') {
    throw new ErroTransicaoJornadaPosConsulta('jornada_nao_aguarda_satisfacao');
  }

  // Ausencia de resposta NUNCA autoriza convite no modo 'ambos' (spec secao
  // 6.3) -- mas esta funcao so e chamada quando existe uma mensagem real do
  // paciente (o caso "sem resposta" nunca gera classificacao, e portanto
  // nunca chega aqui; permanece em aguardando_satisfacao ate uma mensagem
  // real chegar ou a jornada expirar, fora do escopo desta funcao).
  if (entrada.modo === 'ambos' && entrada.classificacao === 'positiva') {
    return { etapaNova: 'encerrada', decisao: { tipo: 'agradecer_e_convidar_avaliacao_google' } };
  }

  // 'satisfacao' nunca envia Google, qualquer que seja a classificacao
  // (secao 6.1). 'ambos' com nao_positiva/incerta tambem nunca envia
  // (secao 6.3).
  return { etapaNova: 'encerrada', decisao: { tipo: 'agradecer_sem_convite' } };
}
