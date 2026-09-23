// Fatos autorizados que o Core entrega a IA redatora de pos-consulta
// (specs/pos-consulta-conversacional-v1.md). Mesmo papel e mesma regra
// estrutural de fatos-autorizados.ts ("FatosAutorizados carrega FATOS,
// nunca frases prontas") -- arquivo PROPRIO e deliberadamente separado (ver
// cabecalho de pos-consulta-tipos.ts para o motivo da nao-uniao com
// DecisaoOrquestrador).

import type { DecisaoPosConsulta } from './pos-consulta-jornada.ts';
import type { AtendimentoConcluido } from './pos-consulta-tipos.ts';

export type ObjetivoRespostaPosConsulta =
  | 'perguntar_satisfacao'
  | 'convidar_avaliacao_google'
  | 'agradecer_e_convidar_avaliacao_google'
  | 'agradecer_sem_convite';

export interface FatosAutorizadosPosConsulta {
  objetivo: ObjetivoRespostaPosConsulta;
  /** Presente somente nos dois objetivos que de fato convidam (spec secao 6.2/6.3). */
  link_avaliacao_google?: string;
  /** Nome do procedimento concluido, quando conhecido -- para contextualizar a pergunta/o convite. */
  procedimento_confirmado?: string;
  /** Nome do dentista responsavel, quando conhecido. */
  dentista_confirmado?: string;
  /** Nome da propria clinica, para a Iris se identificar ao abrir a jornada. */
  nome_clinica?: string;
  /**
   * Texto livre da clinica (spec secao 2.4) -- tom e estilo, NUNCA regra
   * operacional. A redatora pode considerar, mas o objetivo/link acima nunca
   * mudam por causa dele.
   */
  orientacoes_clinica?: string;
}

export interface ContextoFatosPosConsulta {
  linkAvaliacaoGoogle?: string;
  atendimento?: AtendimentoConcluido;
  nomeClinica?: string;
  orientacoesClinica?: string;
}

/**
 * Mapeamento puro e exaustivo: uma DecisaoPosConsulta nova sem `case`
 * correspondente nao compila -- mesma garantia de derivarFatosAutorizados.
 */
export function derivarFatosAutorizadosPosConsulta(
  decisao: DecisaoPosConsulta,
  contexto: ContextoFatosPosConsulta
): FatosAutorizadosPosConsulta {
  const fatosOrtogonais = montarFatosOrtogonais(contexto);

  switch (decisao.tipo) {
    case 'perguntar_satisfacao':
      return { objetivo: 'perguntar_satisfacao', ...fatosOrtogonais };

    case 'convidar_avaliacao_google':
      // O link SEMPRE precisa estar presente aqui -- a elegibilidade
      // (pos-consulta-elegibilidade.ts) ja garante isso antes da jornada
      // sequer comecar no modo 'google'. Ausencia e erro de programacao do
      // chamador, nunca um caso de dominio esperado; por isso nao ha
      // fallback silencioso -- o campo so entra quando existe de verdade.
      return {
        objetivo: 'convidar_avaliacao_google',
        ...(contexto.linkAvaliacaoGoogle !== undefined ? { link_avaliacao_google: contexto.linkAvaliacaoGoogle } : {}),
        ...fatosOrtogonais,
      };

    case 'agradecer_e_convidar_avaliacao_google':
      return {
        objetivo: 'agradecer_e_convidar_avaliacao_google',
        ...(contexto.linkAvaliacaoGoogle !== undefined ? { link_avaliacao_google: contexto.linkAvaliacaoGoogle } : {}),
        ...fatosOrtogonais,
      };

    case 'agradecer_sem_convite':
      return { objetivo: 'agradecer_sem_convite', ...fatosOrtogonais };
  }
}

function montarFatosOrtogonais(contexto: ContextoFatosPosConsulta): Partial<FatosAutorizadosPosConsulta> {
  const fatos: Partial<FatosAutorizadosPosConsulta> = {};
  if (contexto.atendimento?.procedimentoNomeExibido !== undefined) {
    fatos.procedimento_confirmado = contexto.atendimento.procedimentoNomeExibido;
  }
  if (contexto.atendimento?.dentistaNomeExibido !== undefined) {
    fatos.dentista_confirmado = contexto.atendimento.dentistaNomeExibido;
  }
  if (contexto.nomeClinica !== undefined) {
    fatos.nome_clinica = contexto.nomeClinica;
  }
  if (contexto.orientacoesClinica !== undefined && contexto.orientacoesClinica.trim() !== '') {
    fatos.orientacoes_clinica = contexto.orientacoesClinica;
  }
  return fatos;
}
