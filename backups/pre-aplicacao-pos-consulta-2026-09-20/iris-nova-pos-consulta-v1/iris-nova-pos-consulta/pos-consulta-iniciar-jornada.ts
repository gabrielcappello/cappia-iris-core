// Adaptador fino para a RPC public.cappia_pos_consulta_iniciar_jornada
// (Postgres). Contrato: specs/pos-consulta-conversacional-v1.md secao 5,
// corrigido por reviews/revisao-pos-consulta-conversacional-v1.md (B2, B3,
// B4).
//
// Mesmo padrao de cancelar-agendamento.ts: uma unica chamada, sem retry,
// validacao estrita de entrada e saida, nunca vaza error.message nem o
// payload bruto da RPC.
//
// B2 -- esta chamada AUTORIZA e RESERVA a primeira entrega; NAO a confirma.
// O chamador deve gerar e ENVIAR a mensagem, e so depois chamar
// confirmarEntregaPosConsulta (pos-consulta-confirmar-entrega.ts) com o
// `claimToken` devolvido aqui. Uma queda entre esta chamada e a confirmacao
// nunca perde a mensagem: o lease expira e uma nova chamada a esta mesma
// funcao reclama a MESMA pendencia (resultado 'pendente' de novo, com token
// novo) -- nunca cria uma segunda.
//
// B4 -- 'conflito_telefone_ativo' significa que OUTRA jornada (agendamento
// diferente) do MESMO telefone ja esta ativa. O chamador NUNCA deve enviar
// mensagem neste caso.

import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';
import type { ModoPosConsulta } from './pos-consulta-tipos.ts';

const NOME_RPC = 'cappia_pos_consulta_iniciar_jornada';
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MODOS_VALIDOS = ['satisfacao', 'google', 'ambos'] as const;

export interface IniciarJornadaPosConsultaEntrada {
  clinica_id: string;
  agendamento_id: string;
  paciente_id: string;
  telefone_normalizado: string;
  /** 'nenhum' nunca chega aqui -- a elegibilidade ja barra antes (pos-consulta-elegibilidade.ts). */
  modo: Exclude<ModoPosConsulta, 'nenhum'>;
  /** `true` somente no modo 'google' -- a primeira (e unica) entrega e o proprio convite. */
  convite_pendente: boolean;
  /**
   * Snapshot do link configurado, gravado na propria jornada (acrescimo ao
   * implementar a Proposta C -- ver cabecalho da migration). Ausente/`undefined`
   * no modo 'satisfacao'. Necessario porque o fluxo REATIVO, ao processar a
   * resposta do paciente, nao tem outra fonte para esse valor.
   */
  link_avaliacao_google?: string;
}

export type ResultadoIniciarJornadaPosConsulta =
  // Esta chamada reservou a entrega -- o chamador deve gerar, ENVIAR, e so
  // entao confirmar com `claim_token`. `entrega_id` e a identidade ESTAVEL
  // da entrega (nunca gira em reclaim) -- chave idempotente para o
  // transporte, quando o provedor suportar deduplicacao por chave externa.
  | {
      tipo: 'pendente';
      jornada_id: string;
      entrega_id: string;
      claim_token: string;
      modo: Exclude<ModoPosConsulta, 'nenhum'>;
      convite_pendente: boolean;
      link_avaliacao_google?: string;
    }
  // Outra chamada (ou o mesmo worker, antes) ja reservou e o lease ainda
  // vale -- NUNCA enviar mensagem.
  | { tipo: 'em_andamento' }
  // Ja existia jornada, ja confirmada em alguma etapa -- replay/reentrega.
  // NUNCA enviar mensagem de novo.
  | { tipo: 'ja_existia'; jornada_id: string; etapa: string }
  // B4 -- outra jornada do mesmo telefone ja esta ativa. NUNCA enviar
  // mensagem.
  | { tipo: 'conflito_telefone_ativo' };

export async function iniciarJornadaPosConsulta(
  cliente: ClienteRpc,
  entrada: IniciarJornadaPosConsultaEntrada
): Promise<ResultadoIniciarJornadaPosConsulta> {
  validarEntrada(entrada);

  const { data, error } = await cliente.rpc(NOME_RPC, {
    p_clinica_id: entrada.clinica_id,
    p_agendamento_id: entrada.agendamento_id,
    p_paciente_id: entrada.paciente_id,
    p_telefone_normalizado: entrada.telefone_normalizado,
    p_modo: entrada.modo,
    p_convite_pendente: entrada.convite_pendente,
    p_link_avaliacao_google: entrada.link_avaliacao_google ?? null,
  });

  if (error) {
    throw new ErroRpcTecnico(NOME_RPC, 'cliente_supabase_falhou');
  }

  return validarSaida(data);
}

function validarEntrada(entrada: IniciarJornadaPosConsultaEntrada): void {
  validarUuid('clinica_id', entrada.clinica_id);
  validarUuid('agendamento_id', entrada.agendamento_id);
  validarUuid('paciente_id', entrada.paciente_id);
  if (typeof entrada.telefone_normalizado !== 'string' || entrada.telefone_normalizado.trim() === '') {
    throw new EntradaInvalidaError('telefone_normalizado', 'telefone_normalizado nao pode ser vazio');
  }
  if (!MODOS_VALIDOS.includes(entrada.modo as (typeof MODOS_VALIDOS)[number])) {
    throw new EntradaInvalidaError('modo', 'modo deve ser satisfacao, google ou ambos');
  }
  if (typeof entrada.convite_pendente !== 'boolean') {
    throw new EntradaInvalidaError('convite_pendente', 'convite_pendente deve ser booleano');
  }
}

function validarUuid(campo: string, valor: string): void {
  if (typeof valor !== 'string' || !UUID_REGEX.test(valor)) {
    throw new EntradaInvalidaError(campo, `${campo} deve estar no formato UUID valido`);
  }
}

const ETAPAS_SAIDA = ['aguardando_inicio', 'aguardando_satisfacao', 'finalizando', 'encerrada'] as const;

function validarSaida(data: unknown): ResultadoIniciarJornadaPosConsulta {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErroRpcTecnico(NOME_RPC, 'retorno da RPC deve ser um objeto');
  }
  const bruto = data as Record<string, unknown>;
  const resultado = bruto.resultado;

  if (resultado === 'conflito_telefone_ativo') {
    return { tipo: 'conflito_telefone_ativo' };
  }
  if (resultado === 'em_andamento') {
    return { tipo: 'em_andamento' };
  }
  if (resultado === 'pendente') {
    const jornadaId = bruto.jornada_id;
    const entregaId = bruto.entrega_id;
    const claimToken = bruto.claim_token;
    const modo = bruto.modo;
    const convitePendente = bruto.convite_pendente;
    const linkAvaliacaoGoogle = bruto.link_avaliacao_google;
    if (typeof jornadaId !== 'string' || !UUID_REGEX.test(jornadaId)) {
      throw new ErroRpcTecnico(NOME_RPC, 'jornada_id deve estar em formato UUID valido');
    }
    if (typeof entregaId !== 'string' || !UUID_REGEX.test(entregaId)) {
      throw new ErroRpcTecnico(NOME_RPC, 'entrega_id deve estar em formato UUID valido');
    }
    if (typeof claimToken !== 'string' || !UUID_REGEX.test(claimToken)) {
      throw new ErroRpcTecnico(NOME_RPC, 'claim_token deve estar em formato UUID valido');
    }
    if (!MODOS_VALIDOS.includes(modo as (typeof MODOS_VALIDOS)[number])) {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'modo' ausente ou fora do vocabulario aprovado");
    }
    if (typeof convitePendente !== 'boolean') {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'convite_pendente' ausente ou invalido");
    }
    if (linkAvaliacaoGoogle !== null && linkAvaliacaoGoogle !== undefined && typeof linkAvaliacaoGoogle !== 'string') {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'link_avaliacao_google' com tipo invalido");
    }
    return {
      tipo: 'pendente',
      jornada_id: jornadaId,
      entrega_id: entregaId,
      claim_token: claimToken,
      modo: modo as Exclude<ModoPosConsulta, 'nenhum'>,
      convite_pendente: convitePendente,
      ...(typeof linkAvaliacaoGoogle === 'string' ? { link_avaliacao_google: linkAvaliacaoGoogle } : {}),
    };
  }
  if (resultado === 'ja_existia') {
    const jornadaId = bruto.jornada_id;
    const etapa = bruto.etapa;
    if (typeof jornadaId !== 'string' || !UUID_REGEX.test(jornadaId)) {
      throw new ErroRpcTecnico(NOME_RPC, 'jornada_id deve estar em formato UUID valido');
    }
    if (typeof etapa !== 'string' || !ETAPAS_SAIDA.includes(etapa as (typeof ETAPAS_SAIDA)[number])) {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'etapa' ausente ou fora do vocabulario aprovado");
    }
    return { tipo: 'ja_existia', jornada_id: jornadaId, etapa };
  }

  throw new ErroRpcTecnico(NOME_RPC, "campo 'resultado' ausente ou fora do vocabulario aprovado");
}
