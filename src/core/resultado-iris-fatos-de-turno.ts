// Montagem dos FATOS DE TURNO do contrato `ResultadoIris`
// (specs/contexto-conversacional-unificado-v2.md §8, aprovada por Gabriel em
// 2026-08-15 -- aprovação CONDICIONADA, spec §15; etapa de tipos/schema já
// aprovada pelo Codex).
//
// SEM LIGAÇÃO COM PRODUÇÃO. Nenhuma função deste arquivo é chamada por
// qualquer decisão de atendimento -- não é importado por nenhum módulo de
// `src/core/` além dos seus próprios testes.
//
// NÃO É PURO, E PODE LANÇAR. Este módulo consulta o banco via
// `buscarAgendamentoAtivo` (I/O real, mesmo sobre dados falsos nos testes) --
// diferente de `resultado-iris-validador.ts`, que é síncrono e nunca lança.
// Uma falha de rede/banco propagada por `buscarAgendamentoAtivo` (ela mesma
// lança em erro de query, ver `buscar-agendamento-ativo.ts`) atravessa esta
// função sem tratamento -- não há try/catch aqui.
//
// O QUE ESTE MÓDULO NÃO FAZ, DE PROPÓSITO:
// - não decide DE ONDE vem o `agendamento_id` ancorado. A spec §8 diz que a
//   âncora é `aguardando_resposta.agendamento_id` ou a proposta de
//   remarcação/cancelamento em curso no turno -- nenhuma das duas tem
//   persistência real ainda (spec §13.3, pendência explícita). A âncora
//   entra como PARÂMETRO já resolvido; de onde ela vem é responsabilidade de
//   uma camada futura, não deste módulo;
// - não escolhe o único agendamento do paciente por eliminação, e não busca
//   genericamente "um fluxo em andamento" -- sem âncora, o fato é sempre
//   ausente (spec §8, "a ausência de âncora não é substituída por
//   suposição");
// - não persiste nada -- fato de turno é recalculado a cada chamada, nunca
//   gravado (mesmo status de `aguardando_resposta`, spec §8);
// - não aceita as duas âncoras de `resolverFatosDeTurno` não nulas ao mesmo
//   tempo -- um turno está em remarcação OU em cancelamento, nunca os dois
//   (spec §8); a combinação contraditória é recusada ANTES de qualquer
//   consulta ao banco, nunca resolvida por escolher uma das duas.

import { buscarAgendamentoAtivo, type EntradaBuscarAgendamentoAtivo } from './buscar-agendamento-ativo.ts';
import type { ClienteBancoDados } from './tipos.ts';

/** Presente quando a âncora aponta para um agendamento confirmado por busca fresca; ausente em qualquer outro caso. */
export type FatoDeTurno = { agendamento_id: string } | null;

/**
 * Resolve um fato de turno (spec §8: `agendamento_em_remarcacao` ou
 * `agendamento_a_cancelar`) a partir de uma âncora já identificada.
 *
 * Produção em duas etapas, sempre nesta ordem (spec §8):
 * 1. **Identidade ancorada** -- `ancoraAgendamentoId` já veio de uma âncora
 *    estruturada (não é responsabilidade desta função validar a origem;
 *    `null` aqui significa "nenhuma âncora neste turno", e o fato é sempre
 *    ausente nesse caso, sem exceção).
 * 2. **Busca fresca** desse ID, via `buscarAgendamentoAtivo` (mesmo módulo
 *    já em produção para a remarcação) -- filtrada por `clinica_id` +
 *    `paciente_id` + status `confirmado`. O ID ancorado é procurado dentro
 *    do resultado (`nenhum`/`unico`/`multiplos`, tratados de forma
 *    idêntica): a presença do ID na lista de agendamentos ativos do
 *    paciente É a confirmação de pertencimento e estado compatível --
 *    `buscarAgendamentoAtivo` já filtra por `clinica_id`/`paciente_id`/
 *    `status`, então um ID de outro paciente, outra clínica, ou cancelado
 *    nunca aparece na lista.
 *
 * Recusa (devolve `null`) quando não há âncora, ou quando o ID ancorado não
 * é encontrado entre os agendamentos ativos do paciente -- nunca completa
 * por conta própria. Propaga (não captura) qualquer erro lançado pela busca
 * fresca em si.
 */
export async function resolverFatoDeTurno(
  cliente: ClienteBancoDados,
  ancoraAgendamentoId: string | null,
  entradaBusca: EntradaBuscarAgendamentoAtivo
): Promise<FatoDeTurno> {
  if (ancoraAgendamentoId === null) return null;

  const busca = await buscarAgendamentoAtivo(cliente, entradaBusca);
  const agendamentosAtivos =
    busca.tipo === 'nenhum' ? [] : busca.tipo === 'unico' ? [busca.agendamento] : busca.agendamentos;

  const encontrado = agendamentosAtivos.some((a) => a.agendamento_id === ancoraAgendamentoId);
  return encontrado ? { agendamento_id: ancoraAgendamentoId } : null;
}

export type FatosDeTurno = { agendamento_em_remarcacao: FatoDeTurno; agendamento_a_cancelar: FatoDeTurno };

export type ResultadoFatosDeTurno = { ok: true; fatos: FatosDeTurno } | { ok: false; erro: string };

/**
 * Resolve os DOIS fatos de turno do contrato `ResultadoIris` (spec §8) numa
 * única passada -- cada um com sua própria âncora, mas a mesma busca fresca
 * de `buscarAgendamentoAtivo` seria redundante chamar duas vezes na mesma
 * requisição; esta função reaproveita o resultado.
 *
 * RECUSA ANTES DE QUALQUER CONSULTA (`{ ok: false }`) quando as duas âncoras
 * são não nulas ao mesmo tempo: um turno está em remarcação OU em
 * cancelamento, nunca os dois (spec §8). Essa combinação é contraditória por
 * construção -- a função nunca escolhe uma das duas para seguir, e nunca
 * chega a consultar o banco nesse caso (nenhum round-trip é gasto numa
 * entrada já inválida).
 */
export async function resolverFatosDeTurno(
  cliente: ClienteBancoDados,
  ancoras: { agendamentoEmRemarcacaoId: string | null; agendamentoACancelarId: string | null },
  entradaBusca: EntradaBuscarAgendamentoAtivo
): Promise<ResultadoFatosDeTurno> {
  if (ancoras.agendamentoEmRemarcacaoId !== null && ancoras.agendamentoACancelarId !== null) {
    return { ok: false, erro: 'agendamento_em_remarcacao e agendamento_a_cancelar não podem ter âncora ao mesmo tempo' };
  }

  if (ancoras.agendamentoEmRemarcacaoId === null && ancoras.agendamentoACancelarId === null) {
    return { ok: true, fatos: { agendamento_em_remarcacao: null, agendamento_a_cancelar: null } };
  }

  const busca = await buscarAgendamentoAtivo(cliente, entradaBusca);
  const agendamentosAtivos =
    busca.tipo === 'nenhum' ? [] : busca.tipo === 'unico' ? [busca.agendamento] : busca.agendamentos;

  const resolverContraLista = (ancoraId: string | null): FatoDeTurno => {
    if (ancoraId === null) return null;
    const encontrado = agendamentosAtivos.some((a) => a.agendamento_id === ancoraId);
    return encontrado ? { agendamento_id: ancoraId } : null;
  };

  return {
    ok: true,
    fatos: {
      agendamento_em_remarcacao: resolverContraLista(ancoras.agendamentoEmRemarcacaoId),
      agendamento_a_cancelar: resolverContraLista(ancoras.agendamentoACancelarId),
    },
  };
}
