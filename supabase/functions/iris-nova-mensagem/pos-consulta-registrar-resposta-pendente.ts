// Adaptador fino para a RPC public.cappia_pos_consulta_registrar_resposta_pendente
// (Postgres). Substitui pos-consulta-avancar-etapa.ts (removido nesta
// correcao) -- ver reviews/revisao-pos-consulta-conversacional-v1.md, B2.
//
// AUTORIZA e RESERVA a SEGUNDA entrega (agradecimento / convite), a partir
// da resposta de satisfacao ja classificada. NAO a confirma -- o chamador
// deve gerar e ENVIAR a mensagem, e so entao chamar
// confirmarEntregaPosConsulta com o `claim_token` devolvido aqui.
//
// Reclaim (lease expirado) reusa a classificacao/`convite_pendente` JA
// GRAVADOS -- o adaptador NUNCA deve substituir esses valores pelos que
// calculou nesta chamada quando o resultado indicar reclaim; o chamador
// deve usar sempre o que a RPC devolveu, nunca o que enviou (ver
// pos-consulta-processar-resposta.ts).

import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';
import type { ClassificacaoSatisfacao } from './pos-consulta-tipos.ts';

const NOME_RPC = 'cappia_pos_consulta_registrar_resposta_pendente';
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CLASSIFICACOES_VALIDAS = ['positiva', 'nao_positiva', 'incerta'] as const;

export interface RegistrarRespostaPendentePosConsultaEntrada {
  clinica_id: string;
  agendamento_id: string;
  classificacao: ClassificacaoSatisfacao;
  convite_pendente: boolean;
}

export type ResultadoRegistrarRespostaPendentePosConsulta =
  // Reservada -- o chamador deve gerar, ENVIAR, e so entao confirmar.
  // `classificacao`/`convite_pendente` sao os EFETIVOS (podem vir de um
  // reclaim, nunca do que este chamador enviou). `entrega_id` e a
  // identidade ESTAVEL da entrega (nunca gira em reclaim).
  | {
      tipo: 'pendente';
      entrega_id: string;
      claim_token: string;
      classificacao: ClassificacaoSatisfacao;
      convite_pendente: boolean;
    }
  | { tipo: 'em_andamento' }
  | { tipo: 'ja_processada' }
  | { tipo: 'jornada_nao_encontrada' }
  | { tipo: 'jornada_nao_aguarda_resposta' };

export async function registrarRespostaPendentePosConsulta(
  cliente: ClienteRpc,
  entrada: RegistrarRespostaPendentePosConsultaEntrada
): Promise<ResultadoRegistrarRespostaPendentePosConsulta> {
  validarEntrada(entrada);

  const { data, error } = await cliente.rpc(NOME_RPC, {
    p_clinica_id: entrada.clinica_id,
    p_agendamento_id: entrada.agendamento_id,
    p_classificacao: entrada.classificacao,
    p_convite_pendente: entrada.convite_pendente,
  });

  if (error) {
    throw new ErroRpcTecnico(NOME_RPC, 'cliente_supabase_falhou');
  }

  return validarSaida(data);
}

function validarEntrada(entrada: RegistrarRespostaPendentePosConsultaEntrada): void {
  validarUuid('clinica_id', entrada.clinica_id);
  validarUuid('agendamento_id', entrada.agendamento_id);
  if (!CLASSIFICACOES_VALIDAS.includes(entrada.classificacao)) {
    throw new EntradaInvalidaError('classificacao', 'classificacao deve ser positiva, nao_positiva ou incerta');
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

function validarSaida(data: unknown): ResultadoRegistrarRespostaPendentePosConsulta {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErroRpcTecnico(NOME_RPC, 'retorno da RPC deve ser um objeto');
  }
  const bruto = data as Record<string, unknown>;
  const resultado = bruto.resultado;

  if (resultado === 'em_andamento') return { tipo: 'em_andamento' };
  if (resultado === 'ja_processada') return { tipo: 'ja_processada' };
  if (resultado === 'jornada_nao_encontrada') return { tipo: 'jornada_nao_encontrada' };
  if (resultado === 'jornada_nao_aguarda_resposta') return { tipo: 'jornada_nao_aguarda_resposta' };

  if (resultado === 'pendente') {
    const entregaId = bruto.entrega_id;
    const claimToken = bruto.claim_token;
    const classificacao = bruto.classificacao;
    const convitePendente = bruto.convite_pendente;
    if (typeof entregaId !== 'string' || !UUID_REGEX.test(entregaId)) {
      throw new ErroRpcTecnico(NOME_RPC, 'entrega_id deve estar em formato UUID valido');
    }
    if (typeof claimToken !== 'string' || !UUID_REGEX.test(claimToken)) {
      throw new ErroRpcTecnico(NOME_RPC, 'claim_token deve estar em formato UUID valido');
    }
    if (!CLASSIFICACOES_VALIDAS.includes(classificacao as ClassificacaoSatisfacao)) {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'classificacao' ausente ou fora do vocabulario aprovado");
    }
    if (typeof convitePendente !== 'boolean') {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'convite_pendente' ausente ou invalido");
    }
    return {
      tipo: 'pendente',
      entrega_id: entregaId,
      claim_token: claimToken,
      classificacao: classificacao as ClassificacaoSatisfacao,
      convite_pendente: convitePendente,
    };
  }

  throw new ErroRpcTecnico(NOME_RPC, "campo 'resultado' ausente ou fora do vocabulario aprovado");
}
