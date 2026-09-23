// Busca INTERNA do agendamento ativo do paciente, para alimentar a
// remarcacao. Contrato: specs/remarcacao-operacional-v1.md secoes 1 e 2.
//
// Mesmo espirito de carregar-catalogo.ts: SELECT direto, sem RPC, sem decidir
// nada de dominio -- so traduz o schema real para o contrato aprovado.
//
// NAO E "consulta do proprio agendamento" (docs/06-roadmap.md). Aquela frente
// continua fechada: aqui nao existe historico, nem cancelado, nem passado,
// nem apresentacao ao paciente. Este modulo existe SO para a remarcacao.
//
// `multiplos` devolve a lista e PARA. A escolha entre varios agendamentos e
// da spec conversacional, que ainda nao existe -- nenhuma decisao de conversa
// acontece aqui.

import { EntradaInvalidaError } from './erros.ts';
import type { InstanteAtual } from './disponibilidade-tipos.ts';
import type { ClienteBancoDados } from './tipos.ts';

export interface EntradaBuscarAgendamentoAtivo {
  clinica_id: string;
  paciente_id: string;
  /** Instante local da clinica (mesmo contrato ja usado por carregar-disponibilidade.ts). */
  instante_atual: InstanteAtual;
}

/**
 * O minimo que a remarcacao precisa de um agendamento existente.
 *
 * `duracao_min` NAO entra, por decisao do Gabriel (2026-08-10, spec secao
 * 10.2): a RPC recebe `p_duracao_min` NOVO, resolvido por resolverDuracao a
 * partir de procedimento + dentista; a duracao antiga nao tem consumidor.
 *
 * `dentista_id` e `procedimento_id` sao nulaveis aqui porque as colunas sao
 * nulaveis no banco operacional. Uma linha sem eles nao e DESCARTADA -- pelo
 * mesmo motivo que `duracao_min` ausente nao descarta: responder "voce nao
 * tem agendamento" a um paciente que tem e o unico desfecho inaceitavel desta
 * busca. Quem decide o que fazer com um agendamento incompleto e a camada
 * conversacional, nao este modulo.
 */
export interface AgendamentoAtivo {
  agendamento_id: string;
  data: string; // YYYY-MM-DD
  horario: string; // HH:MM
  dentista_id: string | null;
  dentista_nome: string | null;
  procedimento_id: string | null;
  procedimento: string | null;
}

export type ResultadoBuscarAgendamentoAtivo =
  | { tipo: 'nenhum' }
  | { tipo: 'unico'; agendamento: AgendamentoAtivo }
  | { tipo: 'multiplos'; agendamentos: AgendamentoAtivo[] };

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATA_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const COLUNAS = 'id, data, horario, dentista_id, dentista_nome, procedimento_id, procedimento';

export async function buscarAgendamentoAtivo(
  cliente: ClienteBancoDados,
  entrada: EntradaBuscarAgendamentoAtivo
): Promise<ResultadoBuscarAgendamentoAtivo> {
  validarEntrada(entrada);

  // METADE do corte temporal no banco: `data >= hoje`. A outra metade
  // (mesmo dia, horario ja passado) e feita abaixo, em minutos -- nunca em
  // SQL, porque `horario` e text e aceita hora de um digito, entao
  // comparacao lexicografica erra ('9:00' > '14:00' e verdadeiro).
  //
  // Sem ORDER BY no banco, de proposito: ordenar por `horario` (text) teria
  // exatamente o mesmo defeito. A ordenacao final e feita aqui, por minuto.
  const { data: linhas, error } = await cliente
    .from('agendamentos')
    .select(COLUNAS)
    .eq('clinica_id', entrada.clinica_id)
    .eq('paciente_id', entrada.paciente_id)
    .eq('status', 'confirmado')
    .gte('data', entrada.instante_atual.data);

  if (error) throw new Error(`falha ao buscar agendamentos: ${error.message}`);

  const ativos: { agendamento: AgendamentoAtivo; minuto_inicio: number }[] = [];
  for (const linha of linhas ?? []) {
    const projetado = projetarLinha(linha as Record<string, unknown>, entrada.instante_atual);
    if (projetado) ativos.push(projetado);
  }

  ativos.sort((a, b) =>
    a.agendamento.data === b.agendamento.data
      ? a.minuto_inicio - b.minuto_inicio
      : a.agendamento.data < b.agendamento.data
        ? -1
        : 1
  );

  if (ativos.length === 0) return { tipo: 'nenhum' };
  if (ativos.length === 1) return { tipo: 'unico', agendamento: ativos[0]!.agendamento };
  return { tipo: 'multiplos', agendamentos: ativos.map((item) => item.agendamento) };
}

/**
 * Traduz uma linha bruta em `AgendamentoAtivo`, ou devolve `null` quando ela
 * nao pode ser considerada ativa.
 *
 * Descarta SOMENTE por: identidade ausente, `data`/`horario` ausentes ou
 * malformados (sem eles o corte temporal e incalculavel), e horario ja
 * comecado no dia corrente. Nunca por ausencia de duracao, dentista ou
 * procedimento (spec secao 1).
 */
function projetarLinha(
  linha: Record<string, unknown>,
  instante: InstanteAtual
): { agendamento: AgendamentoAtivo; minuto_inicio: number } | null {
  const id = linha.id;
  const data = linha.data;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof data !== 'string' || !DATA_REGEX.test(data)) return null;

  const minutoInicio = minutosDeHHMM(linha.horario);
  if (minutoInicio === null) return null;

  // `data < instante.data` ja foi cortado no banco; a checagem permanece
  // aqui para que este projetor seja correto sozinho, sem depender do WHERE.
  if (data < instante.data) return null;
  // Corte pelo INICIO, estritamente futuro: no minuto exato, exclui.
  // Consequencia declarada (spec secao 1): agendamento EM ANDAMENTO nao e
  // ativo para remarcacao.
  if (data === instante.data && minutoInicio <= instante.minuto_min) return null;

  return {
    agendamento: {
      agendamento_id: id,
      data,
      horario: linha.horario as string,
      dentista_id: typeof linha.dentista_id === 'string' ? linha.dentista_id : null,
      dentista_nome: typeof linha.dentista_nome === 'string' ? linha.dentista_nome : null,
      procedimento_id: typeof linha.procedimento_id === 'string' ? linha.procedimento_id : null,
      procedimento: typeof linha.procedimento === 'string' ? linha.procedimento : null,
    },
    minuto_inicio: minutoInicio,
  };
}

// Mesma conversao de carregar-disponibilidade.ts, reimplementada aqui pelo
// mesmo motivo ja registrado la: a funcao de origem nao e exportada, e este
// arquivo nao pode alterar nenhum dos modulos de disponibilidade
// (spec secao 10.1 -- eles permanecem intocados).
function minutosDeHHMM(valor: unknown): number | null {
  if (typeof valor !== 'string') return null;
  const partes = /^([0-9]{1,2}):([0-9]{2})$/.exec(valor);
  if (!partes) return null;
  const hora = Number(partes[1]);
  const minuto = Number(partes[2]);
  if (hora < 0 || hora > 23 || minuto < 0 || minuto > 59) return null;
  return hora * 60 + minuto;
}

const CHAVES_ENTRADA = ['clinica_id', 'paciente_id', 'instante_atual'] as const;

function validarEntrada(entrada: unknown): asserts entrada is EntradaBuscarAgendamentoAtivo {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new EntradaInvalidaError('entrada', 'entrada deve ser um objeto');
  }
  const chaves = Object.keys(entrada as Record<string, unknown>);
  const esperadas: readonly string[] = CHAVES_ENTRADA;
  if (chaves.length !== esperadas.length || !esperadas.every((chave) => chaves.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada contem propriedade nao permitida');
  }

  const { clinica_id, paciente_id, instante_atual } = entrada as Record<string, unknown>;
  if (typeof clinica_id !== 'string' || !UUID_REGEX.test(clinica_id)) {
    throw new EntradaInvalidaError('clinica_id', 'clinica_id deve estar no formato UUID valido');
  }
  if (typeof paciente_id !== 'string' || !UUID_REGEX.test(paciente_id)) {
    throw new EntradaInvalidaError('paciente_id', 'paciente_id deve estar no formato UUID valido');
  }
  if (instante_atual === null || typeof instante_atual !== 'object' || Array.isArray(instante_atual)) {
    throw new EntradaInvalidaError('instante_atual', 'instante_atual deve ser um objeto');
  }
  const { data, minuto_min } = instante_atual as Record<string, unknown>;
  if (typeof data !== 'string' || !DATA_REGEX.test(data)) {
    throw new EntradaInvalidaError('instante_atual.data', 'instante_atual.data deve estar no formato YYYY-MM-DD');
  }
  if (typeof minuto_min !== 'number' || !Number.isInteger(minuto_min) || minuto_min < 0 || minuto_min > 1439) {
    throw new EntradaInvalidaError('instante_atual.minuto_min', 'instante_atual.minuto_min deve ser inteiro em 0..1439');
  }
}
