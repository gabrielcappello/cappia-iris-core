// Tipos compartilhados da jornada de pos-consulta (specs/pos-consulta-
// conversacional-v1.md). Modulo NOVO e AUTOCONTIDO -- deliberadamente
// separado de orquestrador-tipos.ts/DecisaoOrquestrador (ver decisao tecnica
// no handoff desta frente): pos-consulta nao e um desfecho do fluxo de
// agendamento, e acoplar os dois tipos exigiria editar o switch exaustivo de
// fatos-autorizados.ts e todo consumidor de DecisaoOrquestrador -- risco
// desnecessario para um dominio sem nenhuma relacao operacional com aquele.
//
// Nenhuma tabela, RPC ou migration deste modulo foi aplicada em banco algum
// (ver src/supabase/migrations/ -- arquivos versionados, nao executados).

/** Config do painel (spec secao 2). `nenhum` = pos-consulta desligado. */
export type ModoPosConsulta = 'nenhum' | 'satisfacao' | 'google' | 'ambos';

/**
 * Quatro etapas -- as tres minimas da spec (secao 5) mais 'finalizando',
 * acrescentada na correcao de B2 (reviews/revisao-pos-consulta-conversacional-v1.md):
 * autorizacao e entrega sao estados SEPARADOS, entao existem duas etapas de
 * PENDENCIA (aguardando_inicio, finalizando) alem das duas CONFIRMADAS
 * (aguardando_satisfacao, encerrada). Uma etapa so se torna confirmada
 * depois de uma chamada explicita de confirmacao de entrega -- nunca no
 * mesmo passo que autoriza o conteudo. Isto e ADITIVO ao minimo da spec,
 * nunca uma reducao dele.
 */
export type EtapaJornadaPosConsulta = 'aguardando_inicio' | 'aguardando_satisfacao' | 'finalizando' | 'encerrada';

/** As duas etapas em que existe uma entrega AUTORIZADA mas NAO CONFIRMADA. */
export type EtapaPendentePosConsulta = 'aguardando_inicio' | 'finalizando';

/** As duas etapas em que a entrega anterior ja foi CONFIRMADA. */
export type EtapaConfirmadaPosConsulta = 'aguardando_satisfacao' | 'encerrada';

/**
 * Saida MINIMA da classificacao estruturada da Iris (spec secao 4.1).
 * `incerta` cobre tanto ambiguidade real quanto resposta fora do assunto --
 * nos dois casos o desfecho operacional e o mesmo (spec secao 6.3: nunca
 * envia link). Vocabulario fechado; nenhum valor alem destes tres existe.
 */
export type ClassificacaoSatisfacao = 'positiva' | 'nao_positiva' | 'incerta';

/**
 * Config operacional da clinica para esta automacao (spec secao 2.4).
 * `orientacoes` e o campo livre da clinica para tom/estilo -- NUNCA um
 * template, nunca lido como regra operacional (spec secao 2.4: "nao pode
 * alterar as regras operacionais desta especificacao").
 */
export interface ConfiguracaoPosConsulta {
  modo: ModoPosConsulta;
  /** Minutos apos a conclusao da consulta em que a jornada passa a ser elegivel. */
  prazoMinutos: number;
  /** Obrigatorio nos modos 'google' e 'ambos' (spec secao 2.4); ausente em 'satisfacao'/'nenhum'. */
  linkAvaliacaoGoogle?: string;
  /** Texto livre da clinica, opcional -- nunca placeholder, nunca regra. */
  orientacoes?: string;
}

/**
 * Estado minimo persistido de UMA jornada (spec secao 5). Um registro por
 * `clinica_id` + `agendamento_id` -- nunca reaproveita `estado_conversa` do
 * agendamento, nunca o booleano legado `pos_consulta_enviado`.
 *
 * `modo` e capturado na criacao e NUNCA reescrito por uma mudanca posterior
 * da configuracao da clinica (spec secao 5, criterio de aceite 8) -- por
 * isso vive na propria linha da jornada, nao e relido da configuracao a cada
 * etapa.
 */
export interface JornadaPosConsulta {
  jornadaId: string;
  clinicaId: string;
  agendamentoId: string;
  pacienteId: string;
  telefoneNormalizado: string;
  modo: ModoPosConsulta;
  etapa: EtapaJornadaPosConsulta;
  iniciadaEm: string;
  /** Preenchido somente quando o convite Google foi de fato ENTREGUE e CONFIRMADO (spec secao 5). */
  conviteGoogleEm: string | null;
  /** Preenchido somente depois da resposta de satisfacao classificada. */
  classificacao: ClassificacaoSatisfacao | null;
  /**
   * `true` quando a entrega PENDENTE atual (se `etapa` for uma etapa
   * pendente) e um convite Google -- decide se a confirmacao grava
   * `conviteGoogleEm`. Sempre `false` fora de uma pendencia.
   */
  convitePendente: boolean;
  /** Identidade da entrega pendente (B2) -- `null` exatamente quando `etapa` e confirmada. */
  entregaClaimToken: string | null;
  entregaLeaseExpiraEm: string | null;
}

/**
 * O que a Iris precisa saber sobre o proprio atendimento concluido para
 * poder contextualizar a pergunta/o convite (ex.: "sobre sua limpeza com a
 * Dra. Ana") -- fato do turno, nunca estado. Nomes exibiveis, nunca IDs
 * (mesma disciplina de fatos-autorizados.ts).
 */
export interface AtendimentoConcluido {
  procedimentoNomeExibido?: string;
  dentistaNomeExibido?: string;
}
