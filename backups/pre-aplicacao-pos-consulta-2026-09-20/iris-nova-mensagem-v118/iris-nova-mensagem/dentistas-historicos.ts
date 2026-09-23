// Leitura SEPARADA do historico de atendimento, so para deduzir o dentista
// habitual do paciente (decisao do Gabriel, 2026-08-31).
//
// ── O DEFEITO REAL QUE ORIGINOU ESTE ARQUIVO (v93, 31/08/2026) ──────────
//   Paciente: "quero o mesmo dentista que sempre me atende."
//   Iris:     "Voce prefere o Dr. Diego Ramoz, o Dr. Diego Perez ou o
//              Dr. Pablo Arruda?"
//
// O paciente tinha UM agendamento com o Dr. Diego Perez, em 31/08 as 08:00,
// e escreveu as 10:32. `aplicarDentistaPreferido` recebia apenas
// `agendamentos_do_paciente`, que vem de `buscarAgendamentoAtivo` -- e essa
// busca filtra `status='confirmado'` E `data >= hoje`, mais um corte por
// minuto no mesmo dia. O atendimento das 08:00 ja estava fora as 10:32.
//
// Nao existia (e continua nao existindo) nenhuma outra consulta a
// `agendamentos` capaz de ver o passado. Este modulo e essa consulta.
//
// ── POR QUE UMA FONTE SEPARADA, E NAO AMPLIAR A EXISTENTE ───────────────
// `agendamentos_do_paciente` tem semantica vigente de agendamentos
// FUTUROS/ATIVOS e atravessa ate a interpretadora e a redatora. Misturar
// passado ali faria a Iris poder apresentar um atendimento antigo como se
// fosse consulta marcada. Condicao explicita do Gabriel: fonte separada.
//
// ── O QUE SAI DAQUI: SO IDs, NUNCA DETALHE ─────────────────────────────
// A saida e um conjunto de `dentista_id`. Nem data, nem horario, nem
// procedimento, nem nome. O consumidor unico e o mecanismo deterministico
// `aplicarDentistaPreferido`; nada disto chega ao modelo. O modelo nao
// precisa conhecer o historico para essa deducao -- quem deduz e o Core.
import type { ClienteBancoDados } from './tipos.ts';
import type { InstanteAtual } from './disponibilidade-tipos.ts';

/**
 * Status que representam ATENDIMENTO VALIDO para efeito de "quem ja me
 * atende" (decisao do Gabriel, 2026-08-31, sobre os valores reais do banco).
 *
 * - `confirmado`: entra SOMENTE quando ja passou (ver corte temporal abaixo).
 *   O caso real observado e exatamente este -- o agendamento nunca foi
 *   virado para `concluido` pela recepcao.
 * - `concluido`: atendimento encerrado, entra sempre.
 *
 * FICAM DE FORA, e por que:
 * - `cancelado`  -- nao houve atendimento;
 * - `remarcado`  -- foi substituido por outro registro; contaria em dobro;
 * - `faltou`     -- o paciente nao compareceu, nao ha vinculo com o
 *                   profissional.
 */
const STATUS_ELEGIVEIS: readonly string[] = ['confirmado', 'concluido'];

const HHMM_REGEX = /^([0-9]{1,2}):([0-9]{2})$/;

/**
 * Devolve os `dentista_id` DISTINTOS que ja atenderam este paciente nesta
 * clinica, considerando somente atendimentos passados e elegiveis.
 *
 * Devolve conjunto VAZIO (nunca `undefined`) quando nao ha historico util --
 * a decisao de aplicar ou nao e de `aplicarDentistaPreferido`, nunca daqui.
 */
export async function buscarDentistasHistoricos(
  cliente: ClienteBancoDados,
  entrada: {
    clinica_id: string;
    paciente_id: string | null;
    instante_atual: InstanteAtual;
  }
): Promise<readonly string[]> {
  // Paciente sem ficha nao tem historico por definicao -- sem consulta.
  if (entrada.paciente_id === null) return [];

  // `clinica_id` E `paciente_id` sempre no predicado do BANCO: o mesmo
  // paciente pode ter historico em outra clinica, e aquele dentista nao e "o
  // dele" aqui. Esse e o isolamento que nao pode depender de codigo.
  //
  // Status e corte temporal sao filtrados em TypeScript, logo abaixo, e nao
  // no banco: `ConsultaEncadeavel` (tipos.ts) expoe apenas `eq`/`is`/`gte`/
  // `not`, e ampliar essa interface obrigaria a mexer no cliente real e em
  // todos os dubles -- desproporcional para uma leitura que ja vem limitada
  // a um unico paciente de uma unica clinica. O mesmo motivo de
  // buscar-agendamento-ativo.ts vale para o horario: `horario` e text e a
  // comparacao lexicografica erra ('9:00' > '14:00'), entao o desempate do
  // mesmo dia e sempre feito em minutos, nunca em SQL.
  const { data: linhas, error } = await cliente
    .from('agendamentos')
    .select('data, horario, status, dentista_id')
    .eq('clinica_id', entrada.clinica_id)
    .eq('paciente_id', entrada.paciente_id);

  // Erro de banco NUNCA vira "sem historico": propaga, mesmo criterio de
  // buscarAgendamentosParaContexto. Silenciar aqui produziria uma pergunta
  // desnecessaria ao paciente sem ninguem saber por que.
  if (error) throw new Error(`falha ao buscar historico de dentistas: ${error.message}`);

  const dentistas = new Set<string>();
  for (const linha of linhas ?? []) {
    const bruto = linha as Record<string, unknown>;
    const dentistaId = bruto.dentista_id;
    if (typeof dentistaId !== 'string' || dentistaId.trim() === '') continue;

    const data = bruto.data;
    if (typeof data !== 'string') continue;

    const status = bruto.status;
    if (typeof status !== 'string' || !STATUS_ELEGIVEIS.includes(status)) continue;

    // `concluido` ja e passado por definicao, independente do relogio.
    if (status === 'concluido') {
      dentistas.add(dentistaId);
      continue;
    }

    // `confirmado` so conta se JA PASSOU. Um agendamento futuro confirmado
    // e compromisso, nao historico de atendimento -- e ele ja chega ao Core
    // por `agendamentos_do_paciente`, que continua sendo a fonte do futuro.
    if (data < entrada.instante_atual.data) {
      dentistas.add(dentistaId);
      continue;
    }
    if (data === entrada.instante_atual.data) {
      const minuto = minutosDeHHMM(bruto.horario);
      // Mesmo criterio de corte de buscar-agendamento-ativo.ts, invertido:
      // la, "ativo" e estritamente futuro; aqui, "passado" e o complemento.
      if (minuto !== null && minuto <= entrada.instante_atual.minuto_min) {
        dentistas.add(dentistaId);
      }
    }
  }

  return [...dentistas];
}

/** `HH:MM` (ou `H:MM`) em minutos desde a meia-noite. `null` se invalido. */
function minutosDeHHMM(valor: unknown): number | null {
  if (typeof valor !== 'string') return null;
  const m = HHMM_REGEX.exec(valor.trim());
  if (m === null) return null;
  const hora = Number(m[1]);
  const minuto = Number(m[2]);
  if (!Number.isInteger(hora) || !Number.isInteger(minuto)) return null;
  if (hora < 0 || hora > 23 || minuto < 0 || minuto > 59) return null;
  return hora * 60 + minuto;
}
