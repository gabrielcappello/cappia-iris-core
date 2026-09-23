// Busca de jornada de pos-consulta ABERTA (etapa 'aguardando_satisfacao')
// para clinica + telefone -- usado pelo ponto de entrada reativo
// (iris-nova-mensagem) para decidir se a mensagem recebida deve ser tratada
// como resposta de satisfacao (specs/pos-consulta-conversacional-v1.md
// secao 8: "a implementacao deve usar o contexto conversacional e a
// jornada aberta").
//
// Mesmo espirito de buscar-agendamento-ativo.ts: SELECT direto, sem RPC
// (leitura nunca precisa de lock), so traduz o schema para o contrato
// aprovado. `clinica_id` SEMPRE no WHERE -- isolamento multiclinica
// (docs/03-seguranca.md).
//
// CORRECAO B4 (reviews/revisao-pos-consulta-conversacional-v1.md): mais de
// uma linha aberta para o mesmo clinica+telefone NUNCA e escolhida
// silenciosamente pela primeira (`[0]`) -- o indice unico parcial da
// migration (`pos_consulta_jornadas_telefone_ativo_idx`) torna essa
// situacao estruturalmente impossivel num banco consistente, mas esta
// funcao FALHA FECHADO se ainda assim acontecer (bug, corrida nao prevista,
// ou banco sem a migration aplicada) -- nunca adivinha qual das duas
// pertence a mensagem recebida.

import { EntradaInvalidaError } from './erros.ts';
import type { ClienteBancoDados } from './tipos.ts';
import type { EtapaJornadaPosConsulta, ModoPosConsulta } from './pos-consulta-tipos.ts';

export interface EntradaBuscarJornadaAbertaPosConsulta {
  clinica_id: string;
  telefone_normalizado: string;
}

export interface JornadaAbertaPosConsulta {
  jornada_id: string;
  agendamento_id: string;
  paciente_id: string;
  modo: Exclude<ModoPosConsulta, 'nenhum'>;
  etapa: EtapaJornadaPosConsulta;
  /**
   * Snapshot gravado na criacao da jornada (Proposta C) -- ausente quando o
   * modo nao usa Google, ou quando a clinica nao tinha link configurado.
   */
  link_avaliacao_google?: string;
}

export type ResultadoBuscarJornadaAbertaPosConsulta =
  | { tipo: 'nenhuma' }
  | { tipo: 'encontrada'; jornada: JornadaAbertaPosConsulta };

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MODOS_VALIDOS = ['satisfacao', 'google', 'ambos'] as const;
const ETAPAS_VALIDAS = ['aguardando_inicio', 'aguardando_satisfacao', 'finalizando', 'encerrada'] as const;

const COLUNAS = 'id, agendamento_id, paciente_id, modo, etapa, link_avaliacao_google';

export async function buscarJornadaAbertaPosConsulta(
  cliente: ClienteBancoDados,
  entrada: EntradaBuscarJornadaAbertaPosConsulta
): Promise<ResultadoBuscarJornadaAbertaPosConsulta> {
  validarEntrada(entrada);

  const { data: linhas, error } = await cliente
    .from('pos_consulta_jornadas')
    .select(COLUNAS)
    .eq('clinica_id', entrada.clinica_id)
    .eq('telefone_normalizado', entrada.telefone_normalizado)
    .eq('etapa', 'aguardando_satisfacao');

  if (error) throw new Error(`falha ao buscar jornada de pos-consulta: ${error.message}`);

  const encontradas = linhas ?? [];
  if (encontradas.length === 0) return { tipo: 'nenhuma' };
  if (encontradas.length > 1) {
    // NUNCA escolher a primeira silenciosamente (B4) -- isto so pode
    // acontecer se o indice unico parcial da migration nao estiver
    // aplicado/vigente. Falha fechado: uma resposta ambigua nunca deve ser
    // atribuida a uma jornada por adivinhacao.
    throw new Error(
      'mais de uma jornada de pos-consulta aberta para a mesma clinica+telefone -- invariante de banco violada (ver migration 20260919204030, indice pos_consulta_jornadas_telefone_ativo_idx)'
    );
  }

  return { tipo: 'encontrada', jornada: projetarLinha(encontradas[0] as Record<string, unknown>) };
}

function projetarLinha(linha: Record<string, unknown>): JornadaAbertaPosConsulta {
  const id = linha.id;
  const agendamentoId = linha.agendamento_id;
  const pacienteId = linha.paciente_id;
  const modo = linha.modo;
  const etapa = linha.etapa;

  if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
    throw new Error('linha de pos_consulta_jornadas com id invalido');
  }
  if (typeof agendamentoId !== 'string' || !UUID_REGEX.test(agendamentoId)) {
    throw new Error('linha de pos_consulta_jornadas com agendamento_id invalido');
  }
  if (typeof pacienteId !== 'string' || !UUID_REGEX.test(pacienteId)) {
    throw new Error('linha de pos_consulta_jornadas com paciente_id invalido');
  }
  if (typeof modo !== 'string' || !MODOS_VALIDOS.includes(modo as (typeof MODOS_VALIDOS)[number])) {
    throw new Error('linha de pos_consulta_jornadas com modo fora do vocabulario aprovado');
  }
  if (typeof etapa !== 'string' || !ETAPAS_VALIDAS.includes(etapa as (typeof ETAPAS_VALIDAS)[number])) {
    throw new Error('linha de pos_consulta_jornadas com etapa fora do vocabulario aprovado');
  }
  const linkAvaliacaoGoogle = linha.link_avaliacao_google;
  if (linkAvaliacaoGoogle !== null && linkAvaliacaoGoogle !== undefined && typeof linkAvaliacaoGoogle !== 'string') {
    throw new Error('linha de pos_consulta_jornadas com link_avaliacao_google de tipo invalido');
  }

  return {
    jornada_id: id,
    agendamento_id: agendamentoId,
    paciente_id: pacienteId,
    modo: modo as Exclude<ModoPosConsulta, 'nenhum'>,
    etapa: etapa as EtapaJornadaPosConsulta,
    ...(typeof linkAvaliacaoGoogle === 'string' ? { link_avaliacao_google: linkAvaliacaoGoogle } : {}),
  };
}

function validarEntrada(entrada: EntradaBuscarJornadaAbertaPosConsulta): void {
  if (typeof entrada.clinica_id !== 'string' || !UUID_REGEX.test(entrada.clinica_id)) {
    throw new EntradaInvalidaError('clinica_id', 'clinica_id deve estar no formato UUID valido');
  }
  if (typeof entrada.telefone_normalizado !== 'string' || entrada.telefone_normalizado.trim() === '') {
    throw new EntradaInvalidaError('telefone_normalizado', 'telefone_normalizado nao pode ser vazio');
  }
}
