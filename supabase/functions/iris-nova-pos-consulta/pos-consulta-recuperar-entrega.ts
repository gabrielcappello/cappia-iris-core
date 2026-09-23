// Adaptador fino para a RPC public.cappia_pos_consulta_recuperar_entrega
// (Postgres) -- RECUPERACAO de uma entrega PENDENTE com o lease vencido
// (sexta revisao do Codex, bloqueador 1). Vale para as DUAS etapas de pendencia:
// 'aguardando_inicio' (primeira entrega) e 'finalizando' (segunda).
//
// Antes disto, uma jornada pendente cujo envio falhou (ou cuja confirmacao nao
// chegou) ficava ORFA: `cappia_pos_consulta_candidatos` excluia qualquer
// agendamento com jornada, entao ninguem a reprocessava -- e ela ocupava o
// indice de telefone ativo para sempre.
//
// Mesmo padrao de pos-consulta-iniciar-jornada.ts: uma unica chamada, sem retry,
// validacao estrita de entrada e saida, nunca vaza error.message.
//
// A RPC decide, sob lock: RECLAMAR a mesma entrega (`entrega_id` preservado, token
// novo, tentativa contada) ou ENCERRAR a jornada SEM mensagem (`abandonada`) quando
// ela nao pode mais ser entregue -- automacao da clinica desligada, vinculo
// agendamento/paciente/telefone oficial rompido (inclusive mudanca de clinica), fora
// da janela de 48 h ou 3 tentativas gastas. Nunca deixa orfa e nunca envia a outro
// numero; clinica que desligou a automacao NAO recebe mensagem, mas a pendencia e
// encerrada em silencio e o telefone liberado. Semantica de entrega AO MENOS UMA VEZ: se o envio teve
// sucesso e so a confirmacao falhou, a recuperacao reenvia (limitada a 3 tentativas).

import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';
import type { ClassificacaoSatisfacao, ModoPosConsulta } from './pos-consulta-tipos.ts';

const NOME_RPC = 'cappia_pos_consulta_recuperar_entrega';
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MODOS_VALIDOS = ['satisfacao', 'google', 'ambos'] as const;
const CLASSIFICACOES_VALIDAS = ['positiva', 'nao_positiva', 'incerta'] as const;
const ETAPAS_PENDENTES = ['aguardando_inicio', 'finalizando'] as const;
// A RPC de recuperacao pode encerrar por QUATRO motivos (setima revisao: `abandonada_automacao_desligada`).
// `abandonada_sem_resposta` NAO vem daqui: e da expiracao de `aguardando_satisfacao`, feita direto pelo Disparo A.
const MOTIVOS_ABANDONO = [
  'abandonada_automacao_desligada',
  'abandonada_vinculo_invalido',
  'abandonada_janela',
  'abandonada_tentativas',
] as const;

export type EtapaPendentePosConsultaRecuperavel = (typeof ETAPAS_PENDENTES)[number];
export type MotivoAbandonoPosConsulta = (typeof MOTIVOS_ABANDONO)[number];

export interface RecuperarEntregaPosConsultaEntrada {
  clinica_id: string;
  agendamento_id: string;
  paciente_id: string;
  /**
   * O telefone OFICIAL ATUAL do paciente, RELIDO em fonte autoritativa pela Edge
   * Function (nunca o do candidato do n8n). `null` quando o agendamento/paciente
   * sumiu ou ficou sem telefone -- a RPC entao ENCERRA a jornada
   * (`abandonada_vinculo_invalido`) em vez de enviar a qualquer lugar.
   */
  telefone_normalizado: string | null;
}

export type ResultadoRecuperarEntregaPosConsulta =
  // Reclamada -- o chamador deve gerar, ENVIAR, e so entao confirmar com `claim_token`.
  | {
      tipo: 'pendente';
      etapa: EtapaPendentePosConsultaRecuperavel;
      modo: Exclude<ModoPosConsulta, 'nenhum'>;
      /** Identidade ESTAVEL da entrega (preservada em toda recuperacao). */
      entrega_id: string;
      claim_token: string;
      /** `null` na primeira entrega; a decisao ja gravada na segunda. */
      classificacao: ClassificacaoSatisfacao | null;
      convite_pendente: boolean;
      link_avaliacao_google?: string;
      /** Numero desta tentativa de entrega (2 ou 3 numa recuperacao). */
      tentativa: number;
    }
  // Outro worker esta com a entrega (lease vigente) -- NUNCA enviar.
  | { tipo: 'em_andamento' }
  // A jornada nao esta numa etapa de pendencia -- nada a recuperar.
  | { tipo: 'nao_pendente'; etapa: string }
  | { tipo: 'jornada_nao_encontrada' }
  // A jornada foi ENCERRADA sem mensagem (e o telefone liberado) -- NUNCA enviar.
  | { tipo: 'abandonada'; motivo: MotivoAbandonoPosConsulta; etapa_anterior: EtapaPendentePosConsultaRecuperavel };

export async function recuperarEntregaPosConsulta(
  cliente: ClienteRpc,
  entrada: RecuperarEntregaPosConsultaEntrada
): Promise<ResultadoRecuperarEntregaPosConsulta> {
  validarEntrada(entrada);

  const { data, error } = await cliente.rpc(NOME_RPC, {
    p_clinica_id: entrada.clinica_id,
    p_agendamento_id: entrada.agendamento_id,
    p_paciente_id: entrada.paciente_id,
    p_telefone_normalizado: entrada.telefone_normalizado,
  });

  if (error) {
    throw new ErroRpcTecnico(NOME_RPC, 'cliente_supabase_falhou');
  }

  return validarSaida(data);
}

function validarEntrada(entrada: RecuperarEntregaPosConsultaEntrada): void {
  validarUuid('clinica_id', entrada.clinica_id);
  validarUuid('agendamento_id', entrada.agendamento_id);
  validarUuid('paciente_id', entrada.paciente_id);
  const tel = entrada.telefone_normalizado;
  if (tel !== null && (typeof tel !== 'string' || tel.trim() === '')) {
    throw new EntradaInvalidaError('telefone_normalizado', 'telefone_normalizado deve ser texto nao vazio ou null');
  }
}

function validarUuid(campo: string, valor: string): void {
  if (typeof valor !== 'string' || !UUID_REGEX.test(valor)) {
    throw new EntradaInvalidaError(campo, `${campo} deve estar no formato UUID valido`);
  }
}

function validarSaida(data: unknown): ResultadoRecuperarEntregaPosConsulta {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErroRpcTecnico(NOME_RPC, 'retorno da RPC deve ser um objeto');
  }
  const bruto = data as Record<string, unknown>;
  const resultado = bruto.resultado;

  if (resultado === 'em_andamento') return { tipo: 'em_andamento' };
  if (resultado === 'jornada_nao_encontrada') return { tipo: 'jornada_nao_encontrada' };

  if (resultado === 'nao_pendente') {
    if (typeof bruto.etapa !== 'string') throw new ErroRpcTecnico(NOME_RPC, "campo 'etapa' ausente em nao_pendente");
    return { tipo: 'nao_pendente', etapa: bruto.etapa };
  }

  if (resultado === 'abandonada') {
    const { motivo, etapa_anterior: etapaAnterior } = bruto;
    if (!MOTIVOS_ABANDONO.includes(motivo as MotivoAbandonoPosConsulta)) {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'motivo' ausente ou fora do vocabulario aprovado");
    }
    if (!ETAPAS_PENDENTES.includes(etapaAnterior as EtapaPendentePosConsultaRecuperavel)) {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'etapa_anterior' ausente ou fora do vocabulario aprovado");
    }
    return {
      tipo: 'abandonada',
      motivo: motivo as MotivoAbandonoPosConsulta,
      etapa_anterior: etapaAnterior as EtapaPendentePosConsultaRecuperavel,
    };
  }

  if (resultado === 'pendente') {
    const { etapa, modo, entrega_id: entregaId, claim_token: claimToken, classificacao, convite_pendente: convitePendente, tentativa } = bruto;
    const link = bruto.link_avaliacao_google;
    if (!ETAPAS_PENDENTES.includes(etapa as EtapaPendentePosConsultaRecuperavel)) {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'etapa' ausente ou fora do vocabulario aprovado");
    }
    if (!MODOS_VALIDOS.includes(modo as (typeof MODOS_VALIDOS)[number])) {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'modo' ausente ou fora do vocabulario aprovado");
    }
    if (typeof entregaId !== 'string' || !UUID_REGEX.test(entregaId)) {
      throw new ErroRpcTecnico(NOME_RPC, 'entrega_id deve estar em formato UUID valido');
    }
    if (typeof claimToken !== 'string' || !UUID_REGEX.test(claimToken)) {
      throw new ErroRpcTecnico(NOME_RPC, 'claim_token deve estar em formato UUID valido');
    }
    if (classificacao !== null && !CLASSIFICACOES_VALIDAS.includes(classificacao as ClassificacaoSatisfacao)) {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'classificacao' fora do vocabulario aprovado");
    }
    if (typeof convitePendente !== 'boolean') {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'convite_pendente' ausente ou invalido");
    }
    if (typeof tentativa !== 'number' || !Number.isInteger(tentativa) || tentativa < 2) {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'tentativa' deve ser inteiro >= 2 numa recuperacao");
    }
    if (link !== null && link !== undefined && typeof link !== 'string') {
      throw new ErroRpcTecnico(NOME_RPC, "campo 'link_avaliacao_google' com tipo invalido");
    }

    // DEFESA EM PROFUNDIDADE -- Google so apos satisfacao positiva confirmada (bloqueador 1 da
    // revisao final), mesmo que a RPC (ou uma versao antiga dela) devolva algo diferente:
    if (etapa === 'aguardando_inicio' && (convitePendente || classificacao !== null)) {
      throw new ErroRpcTecnico(NOME_RPC, 'a primeira entrega nunca pode voltar com convite nem classificacao');
    }
    if (etapa === 'finalizando' && classificacao === null) {
      throw new ErroRpcTecnico(NOME_RPC, "a segunda entrega exige 'classificacao'");
    }
    if (convitePendente) {
      if (classificacao !== 'positiva' || modo === 'satisfacao') {
        throw new ErroRpcTecnico(NOME_RPC, 'convite Google exige satisfacao positiva confirmada e modo com Google');
      }
      if (typeof link !== 'string' || link.trim() === '') {
        throw new ErroRpcTecnico(NOME_RPC, 'convite Google exige o link snapshot da jornada');
      }
    }

    return {
      tipo: 'pendente',
      etapa: etapa as EtapaPendentePosConsultaRecuperavel,
      modo: modo as Exclude<ModoPosConsulta, 'nenhum'>,
      entrega_id: entregaId,
      claim_token: claimToken,
      classificacao: (classificacao ?? null) as ClassificacaoSatisfacao | null,
      convite_pendente: convitePendente,
      ...(typeof link === 'string' ? { link_avaliacao_google: link } : {}),
      tentativa,
    };
  }

  throw new ErroRpcTecnico(NOME_RPC, "campo 'resultado' ausente ou fora do vocabulario aprovado");
}
