// Adaptador fino para a RPC public.cappia_pos_consulta_confirmar_entrega
// (Postgres). Correcao de B2 (reviews/revisao-pos-consulta-conversacional-v1.md,
// segunda revisao): a RPC agora DERIVA a etapa de destino sozinha (a partir
// de `etapa`+`modo` ja gravados) -- este adaptador nunca envia
// `etapa_confirmada`, e nunca decide isso no lado do cliente. A confirmacao
// tambem exige lease AINDA VIGENTE, alem do claim_token bater -- um token
// que bate mas cujo lease ja expirou e recusado (`lease_expirado`), porque
// outro worker pode estar reclamando a mesma pendencia neste instante.
//
// Chamado pelo transporte/adaptador SO DEPOIS do envio real ter sido aceito
// (ex.: a API do WhatsApp devolveu sucesso). NUNCA antes.

import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';

const NOME_RPC = 'cappia_pos_consulta_confirmar_entrega';
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface ConfirmarEntregaPosConsultaEntrada {
  clinica_id: string;
  agendamento_id: string;
  claim_token: string;
}

export type ResultadoConfirmarEntregaPosConsulta =
  | { tipo: 'confirmada' }
  // Token nao bate mais -- NUNCA reaplica efeito.
  | { tipo: 'token_invalido' }
  // Token bate, mas o lease ja expirou -- outro worker pode estar
  // reclamando a mesma pendencia agora. NUNCA reaplica efeito.
  | { tipo: 'lease_expirado' }
  | { tipo: 'jornada_nao_encontrada' }
  // A linha nao esta em nenhuma etapa pendente (nao deveria ocorrer --
  // CHECK da tabela ja impede token/lease preenchidos fora de pendencia).
  | { tipo: 'jornada_nao_pendente' }
  // B4 -- outra jornada do mesmo telefone ja esta ativa; o avanco para
  // 'aguardando_satisfacao' foi recusado. A claim permanece pendente.
  | { tipo: 'conflito_telefone_ativo' };

export async function confirmarEntregaPosConsulta(
  cliente: ClienteRpc,
  entrada: ConfirmarEntregaPosConsultaEntrada
): Promise<ResultadoConfirmarEntregaPosConsulta> {
  validarEntrada(entrada);

  const { data, error } = await cliente.rpc(NOME_RPC, {
    p_clinica_id: entrada.clinica_id,
    p_agendamento_id: entrada.agendamento_id,
    p_claim_token: entrada.claim_token,
  });

  if (error) {
    throw new ErroRpcTecnico(NOME_RPC, 'cliente_supabase_falhou');
  }

  return validarSaida(data);
}

function validarEntrada(entrada: ConfirmarEntregaPosConsultaEntrada): void {
  validarUuid('clinica_id', entrada.clinica_id);
  validarUuid('agendamento_id', entrada.agendamento_id);
  validarUuid('claim_token', entrada.claim_token);
}

function validarUuid(campo: string, valor: string): void {
  if (typeof valor !== 'string' || !UUID_REGEX.test(valor)) {
    throw new EntradaInvalidaError(campo, `${campo} deve estar no formato UUID valido`);
  }
}

function validarSaida(data: unknown): ResultadoConfirmarEntregaPosConsulta {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErroRpcTecnico(NOME_RPC, 'retorno da RPC deve ser um objeto');
  }
  const resultado = (data as Record<string, unknown>).resultado;

  if (resultado === 'confirmada') return { tipo: 'confirmada' };
  if (resultado === 'token_invalido') return { tipo: 'token_invalido' };
  if (resultado === 'lease_expirado') return { tipo: 'lease_expirado' };
  if (resultado === 'jornada_nao_encontrada') return { tipo: 'jornada_nao_encontrada' };
  if (resultado === 'jornada_nao_pendente') return { tipo: 'jornada_nao_pendente' };
  if (resultado === 'conflito_telefone_ativo') return { tipo: 'conflito_telefone_ativo' };

  throw new ErroRpcTecnico(NOME_RPC, "campo 'resultado' ausente ou fora do vocabulario aprovado");
}
