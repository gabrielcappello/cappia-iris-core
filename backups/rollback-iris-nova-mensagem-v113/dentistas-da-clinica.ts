// Quais dentistas atendem na clinica -- como fato disponivel em QUALQUER
// turno.
//
// ── POR QUE ESTE ARQUIVO EXISTE (2026-08-18) ────────────────────────────
// Numa conversa real, logo depois de a Iris passar a saber o endereco:
//
//   Paciente: "e quais sao os dentistas que trabalham ai?"
//   Iris:     "posso saber qual procedimento voce gostaria de fazer para te
//              informar melhor?"
//   Paciente: "entao quais sao os dentistas disponiveis?"
//   Iris:     "me informe um dia que voce prefira para a consulta"
//
// Ela nao estava desviando. Os nomes dos dentistas so chegavam ate ela em
// UM caso -- `aguardando_escolha_dentista`, que o Core so produz DEPOIS de
// o paciente ter escolhido um procedimento. Perguntada antes disso, ela nao
// tinha o dado e tentou levar o paciente pelo unico caminho que conhecia.
//
// Gabriel apontou o efeito mais importante disso: faltando o dado pedido,
// a Iris preenche o vazio com o que tem -- naquele turno ela reenviou o
// link do mapa que ja havia mandado. Falta de dado nao a deixa apenas
// limitada; deixa EVASIVA, e evasiva soa como quem esconde algo.
//
// ── ESPECIALIDADE: SABER SEM RECITAR ────────────────────────────────────
// Decisao do Gabriel: a Iris nao anuncia especialidade espontaneamente
// (seria despejo de informacao), mas PRECISA saber quando o paciente
// pergunta -- nao saber seria falha de atendimento. Por isso a
// especialidade viaja junto do nome, e a instrucao da redatora e que
// governa quando mencionar.
//
// ── SO QUEM ATENDE ──────────────────────────────────────────────────────
// Dentista inativo NUNCA entra. No cadastro real de 2026-08-18, Pablo
// Arruda esta `ativo: false` -- oferecer o nome dele levaria o paciente a
// pedir uma agenda que nao existe.

import type { DentistaOficial, VinculoDentistaProcedimento } from './dentista-tipos.ts';
import type { ProcedimentoOficial } from './procedimento-tipos.ts';

/** Um dentista que a Iris pode mencionar ao paciente. */
export interface DentistaDaClinica {
  nome: string;
  /**
   * Especialidades derivadas dos procedimentos que ele realmente faz.
   * Ausente quando nao ha vinculo util -- nunca lista vazia.
   */
  especialidades?: string[];
}

/**
 * Procedimento com a especialidade a que pertence. `especialidade` vem de
 * `procedimentos_catalogo.especialidade_id` -> `especialidades_catalogo`.
 */
export interface ProcedimentoComEspecialidade extends ProcedimentoOficial {
  especialidade?: string;
}

/**
 * Monta a lista de dentistas que ATENDEM, com as especialidades de cada um.
 *
 * Tudo sai do catalogo ja carregado no turno -- nenhuma consulta a mais.
 *
 * Regras:
 *   - dentista inativo nao entra;
 *   - vinculo inativo nao conta (o dono desligou aquele procedimento para
 *     aquele dentista);
 *   - procedimento inativo na clinica nao conta;
 *   - a ordem das especialidades segue a ordem dos procedimentos recebida,
 *     sem duplicar.
 */
export function derivarDentistasDaClinica(
  dentistas: readonly DentistaOficial[],
  vinculos: readonly VinculoDentistaProcedimento[],
  procedimentos: readonly ProcedimentoComEspecialidade[]
): DentistaDaClinica[] | undefined {
  const ativos = dentistas.filter((d) => d.ativo && d.nome_exibido.trim() !== '');
  if (ativos.length === 0) return undefined;

  // procedimento_id -> especialidade, so dos procedimentos ativos.
  const especialidadePorProcedimento = new Map<string, string>();
  for (const p of procedimentos) {
    if (!p.ativo) continue;
    const esp = p.especialidade?.trim();
    if (esp !== undefined && esp !== '') especialidadePorProcedimento.set(p.procedimento_id, esp);
  }

  const resultado: DentistaDaClinica[] = [];
  for (const dentista of ativos) {
    const especialidades: string[] = [];
    const vistas = new Set<string>();

    for (const v of vinculos) {
      if (!v.ativo || v.dentista_id !== dentista.dentista_id) continue;
      const esp = especialidadePorProcedimento.get(v.procedimento_id);
      if (esp === undefined || vistas.has(esp)) continue;
      vistas.add(esp);
      especialidades.push(esp);
    }

    resultado.push({
      nome: dentista.nome_exibido,
      ...(especialidades.length > 0 ? { especialidades } : {}),
    });
  }

  return resultado.length > 0 ? resultado : undefined;
}
