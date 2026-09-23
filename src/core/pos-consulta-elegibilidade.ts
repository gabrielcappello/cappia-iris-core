// Elegibilidade de jornada de pos-consulta (specs/pos-consulta-conversacional-v1.md
// secao 3). Funcao pura: recebe fatos ja lidos pelo chamador (agendamento,
// configuracao, se ja existe jornada) e devolve elegivel/motivo -- nunca
// acessa banco, nunca le relogio (mesmo principio de resolverTemporal/
// resolverDisponibilidade: `agora` e sempre fornecido pelo chamador).
//
// As sete condicoes da spec, na ordem em que aparecem no documento, MAIS a
// janela maxima de idade (revisao final do Codex, bloqueador 2). A ordem
// de avaliacao abaixo NAO segue a ordem do documento -- prioriza primeiro o
// que descarta mais barato/mais frequente (clinica, status, telefone) antes
// do que exige comparacao de instante (prazo) -- mas o resultado final
// (elegivel: true/false) independe da ordem, porque sao condicoes
// independentes em AND. `motivo` reporta so a PRIMEIRA que falhar.

/**
 * JANELA MAXIMA DE IDADE do agendamento (revisao final do Codex, bloqueador
 * 2): 48 horas a partir de `concluido_em`. Sem ela, o fluxo alcancaria
 * agendamentos historicos de semanas atras (hoje, 90 na Clear Dent).
 *
 * MESMO VALOR do banco -- `cappia_pos_consulta_janela_maxima_minutos()` na
 * migration 20260920230000 -- e a MESMA regra de fronteira (dentro = idade
 * ESTRITAMENTE menor que a janela). Um teste (pos-consulta-elegibilidade.test.ts)
 * le a migration e falha se os dois numeros divergirem.
 *
 * DECISAO DE PRODUTO A CONFIRMAR pelo Gabriel antes de aplicar a migration: a
 * spec nao define o numero. O prazo configuravel das clinicas (2h/4h/24h) e
 * sempre menor que a janela.
 */
export const JANELA_MAXIMA_POS_CONSULTA_MINUTOS = 2880;

export type MotivoInelegibilidadePosConsulta =
  | 'clinica_divergente'
  | 'status_nao_concluido'
  | 'telefone_ausente'
  | 'pos_consulta_desativado'
  | 'prazo_nao_atingido'
  | 'janela_maxima_excedida'
  | 'link_google_ausente'
  | 'jornada_ja_existe';

export type ResultadoElegibilidadePosConsulta =
  | { elegivel: true }
  | { elegivel: false; motivo: MotivoInelegibilidadePosConsulta };

export interface FatosAgendamentoParaElegibilidade {
  clinicaId: string;
  status: string;
  /**
   * O NUMERO OFICIAL ATUAL do paciente (`pacientes.telefone_normalizado`),
   * nunca o snapshot histórico gravado na própria linha do agendamento
   * (`agendamentos.telefone`) -- é para o numero oficial que a mensagem
   * será enviada, e é contra ele que `identificarConversa` casa turnos
   * futuros (mesma identidade usada em todo o resto do Core).
   */
  telefoneNormalizado: string | null;
  /**
   * Instante ISO em que o agendamento foi marcado `concluido` -- `null` se
   * nao concluido.
   *
   * CORRIGIDO (B5, reviews/revisao-pos-consulta-conversacional-v1.md): a
   * versao anterior deste comentario afirmava que `agendamentos.concluido_em`
   * nao existia no schema, com base num comentario de OUTRA migration
   * (20260804150000, sobre o que nao tinha sido construido naquela rodada).
   * O Codex leu o banco OPERACIONAL diretamente e confirmou que a coluna JA
   * EXISTE, `timestamptz nullable`, com linhas reais preenchidas -- a
   * migration desta frente (20260919204030_iris_nova_pos_consulta_v1.sql)
   * NAO cria mais essa coluna (removido). O que permanece em aberto -- e
   * NAO decidido nem presumido aqui -- e QUEM grava esse instante e sob que
   * contrato exato (mesmo dado no schema DEV, usado pelos testes, pode
   * divergir do operacional; ver o cabecalho da migration).
   */
  concluidoEm: string | null;
}

export interface EntradaElegibilidadePosConsulta {
  /**
   * `clinica_id` derivado da instancia autenticada que disparou a avaliacao
   * (docs/03-seguranca.md) -- NUNCA um identificador vindo do proprio
   * agendamento sem essa origem. Comparado contra `agendamento.clinicaId`
   * para nunca cruzar clinicas (spec secao 8, criterio de aceite 9).
   */
  clinicaIdOrigem: string;
  agendamento: FatosAgendamentoParaElegibilidade;
  configuracao: { modo: 'nenhum' | 'satisfacao' | 'google' | 'ambos'; prazoMinutos: number; linkAvaliacaoGoogle?: string };
  /** `true` quando ja existe QUALQUER jornada (em qualquer etapa) para este agendamento. */
  jornadaJaExiste: boolean;
  /** Instante atual, ISO 8601, fornecido pelo chamador. */
  agora: string;
}

export function avaliarElegibilidadePosConsulta(
  entrada: EntradaElegibilidadePosConsulta
): ResultadoElegibilidadePosConsulta {
  const { clinicaIdOrigem, agendamento, configuracao, jornadaJaExiste, agora } = entrada;

  if (agendamento.clinicaId !== clinicaIdOrigem) {
    return { elegivel: false, motivo: 'clinica_divergente' };
  }
  if (agendamento.status !== 'concluido' || agendamento.concluidoEm === null) {
    return { elegivel: false, motivo: 'status_nao_concluido' };
  }
  if (agendamento.telefoneNormalizado === null || agendamento.telefoneNormalizado.trim() === '') {
    return { elegivel: false, motivo: 'telefone_ausente' };
  }
  if (configuracao.modo === 'nenhum') {
    return { elegivel: false, motivo: 'pos_consulta_desativado' };
  }
  if (jornadaJaExiste) {
    return { elegivel: false, motivo: 'jornada_ja_existe' };
  }
  if ((configuracao.modo === 'google' || configuracao.modo === 'ambos') && !linkValido(configuracao.linkAvaliacaoGoogle)) {
    return { elegivel: false, motivo: 'link_google_ausente' };
  }

  const concluidoEmMs = Date.parse(agendamento.concluidoEm);
  const agoraMs = Date.parse(agora);
  if (!Number.isFinite(concluidoEmMs) || !Number.isFinite(agoraMs)) {
    // Instante malformado nunca vira elegivel por omissao -- falha fechado,
    // mesma disciplina de resolverTemporal para entrada malformada.
    return { elegivel: false, motivo: 'prazo_nao_atingido' };
  }
  const prazoMs = configuracao.prazoMinutos * 60_000;
  if (agoraMs - concluidoEmMs < prazoMs) {
    return { elegivel: false, motivo: 'prazo_nao_atingido' };
  }

  // JANELA MAXIMA (bloqueador 2): idade >= janela = fora. Mesma fronteira do
  // banco (`concluido_em <= now() - janela` = fora).
  if (agoraMs - concluidoEmMs >= JANELA_MAXIMA_POS_CONSULTA_MINUTOS * 60_000) {
    return { elegivel: false, motivo: 'janela_maxima_excedida' };
  }

  return { elegivel: true };
}

// CORRECAO B7 (reviews/revisao-pos-consulta-conversacional-v1.md): a spec
// exige link VALIDO, nunca qualquer texto nao vazio -- a versao anterior
// aceitava esquemas inseguros (`javascript:`, `data:`) e texto arbitrario.
// Validacao deterministica: precisa fazer parse como URL e ter esquema
// http/https. Nao verifica alcancabilidade (isso seria I/O, fora do escopo
// de uma funcao pura de elegibilidade).
function linkValido(link: string | undefined): boolean {
  if (typeof link !== 'string') return false;
  const valor = link.trim();
  if (valor === '') return false;
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}
