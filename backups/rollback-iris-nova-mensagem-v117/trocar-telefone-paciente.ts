// Adaptador fino para a RPC public.cappia_trocar_telefone_paciente
// (Postgres), aplicada em 2026-08-10 nos dois projetos -- ver
// src/supabase/migrations/20260810185921_iris_nova_trocar_telefone_paciente_v1.sql
// e a irma em migrations-legado/.
//
// Contrato: specs/cpf-outro-telefone-v1.md secao 5, que implementa
// specs/persistencia-v1.md secao 6.
//
// Mesmo padrao de persistir-paciente.ts: uma unica chamada, sem retry,
// validacao estrita de entrada e saida, nunca vaza error.message nem o
// payload bruto da RPC. NENHUMA logica de conversa aqui dentro.
//
// OS DOIS BANCOS TEM CORPOS SQL DIFERENTES DE PROPOSITO (o dev grava
// `telefone_normalizado`; o operacional grava `telefone` e deixa a coluna
// GENERATED derivar). Este adaptador nao sabe disso e nao deve saber: o
// contrato observavel -- assinatura, vocabulario de retorno, efeitos -- e
// identico nos dois, e e so isso que atravessa esta fronteira.
//
// PII: a RPC NUNCA devolve nome, telefone anterior, CPF ou qualquer outro
// dado da ficha localizada -- somente o identificador opaco
// (specs/cpf-outro-telefone-v1.md secao 4). Este arquivo tambem nao le nada
// alem disso.

import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';

const NOME_RPC = 'cappia_trocar_telefone_paciente';

// Vocabulario de recusa exatamente como a RPC o define. Os dois sao
// CONVERSACIONAIS (o chamador resolve falando com o paciente), nunca erro
// tecnico -- mesmo criterio de `cpf_ja_cadastrado` em persistir-paciente.ts.
//
// Motivos ESTRUTURAIS (clinica ausente, cpf ausente, telefone fora do
// formato canonico) nao aparecem aqui de proposito: a RPC os levanta como
// excecao, porque sao invariantes do Core ja garantidas antes da chamada.
// Eles chegam como `error` e viram ErroRpcTecnico abaixo.
const MOTIVOS_RECUSA = ['telefone_de_outro_paciente', 'cpf_nao_encontrado'] as const;

export type MotivoRecusaTrocaTelefone = (typeof MOTIVOS_RECUSA)[number];

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface TrocarTelefonePacienteEntrada {
  clinica_id: string;
  /**
   * CPF ja normalizado (somente digitos) do paciente que a conversa afirma
   * ser. Vira `p_cpf` na RPC, comparado contra a coluna fisica `documento`
   * -- mesma traducao dominio/coluna que persistir-paciente.ts documenta.
   */
  cpf: string;
  /** Telefone da conversa corrente, que passara a ser o oficial da ficha. */
  telefone_normalizado: string;
}

export type ResultadoTrocarTelefonePaciente =
  | { tipo: 'trocado'; paciente_id: string }
  /**
   * specs/persistencia-v1.md secao 7 DETECTADA, nunca resolvida: o telefone
   * da conversa ja e o oficial de outro cadastro desta clinica. Nenhuma
   * escrita ocorreu. A secao 7 continua fora de escopo.
   */
  | { tipo: 'telefone_de_outro_paciente' }
  /** Corrida real: o CPF deixou de existir entre a pergunta e a resposta. */
  | { tipo: 'cpf_nao_encontrado' };

export async function trocarTelefonePaciente(
  cliente: ClienteRpc,
  entrada: TrocarTelefonePacienteEntrada
): Promise<ResultadoTrocarTelefonePaciente> {
  validarEntrada(entrada);

  const { data, error } = await cliente.rpc(NOME_RPC, {
    p_clinica_id: entrada.clinica_id,
    p_cpf: entrada.cpf,
    p_telefone_normalizado: entrada.telefone_normalizado,
  });

  if (error) {
    // Nunca propaga error.message (pode conter SQL/detalhe de linha/PII).
    throw new ErroRpcTecnico(NOME_RPC, 'cliente_supabase_falhou');
  }

  return validarSaida(data);
}

function validarEntrada(entrada: TrocarTelefonePacienteEntrada): void {
  if (typeof entrada.clinica_id !== 'string' || !UUID_REGEX.test(entrada.clinica_id)) {
    throw new EntradaInvalidaError('clinica_id', 'clinica_id deve estar no formato UUID valido');
  }
  if (typeof entrada.cpf !== 'string' || entrada.cpf.trim() === '') {
    throw new EntradaInvalidaError('cpf', 'cpf deve ser uma string nao vazia');
  }
  if (typeof entrada.telefone_normalizado !== 'string' || entrada.telefone_normalizado.trim() === '') {
    throw new EntradaInvalidaError('telefone_normalizado', 'telefone_normalizado deve ser uma string nao vazia');
  }
}

// RETURNS jsonb (escalar) -- o retorno chega como objeto direto, nunca
// envolto em array.
function validarSaida(data: unknown): ResultadoTrocarTelefonePaciente {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ErroRpcTecnico(NOME_RPC, 'retorno da RPC deve ser um objeto');
  }
  const bruto = data as Record<string, unknown>;

  if (typeof bruto.sucesso !== 'boolean') {
    throw new ErroRpcTecnico(NOME_RPC, "campo 'sucesso' ausente ou invalido");
  }

  if (bruto.sucesso) {
    if (typeof bruto.paciente_id !== 'string' || !UUID_REGEX.test(bruto.paciente_id)) {
      throw new ErroRpcTecnico(NOME_RPC, 'sucesso=true deve retornar paciente_id em formato UUID');
    }
    return { tipo: 'trocado', paciente_id: bruto.paciente_id };
  }

  const motivo = bruto.motivo;
  // Motivo desconhecido FALHA FECHADO: nunca e reinterpretado como uma das
  // duas recusas conhecidas nem silenciado como falha generica.
  if (typeof motivo !== 'string' || !MOTIVOS_RECUSA.includes(motivo as MotivoRecusaTrocaTelefone)) {
    throw new ErroRpcTecnico(NOME_RPC, "campo 'motivo' ausente ou fora do vocabulario aprovado");
  }
  return { tipo: motivo as MotivoRecusaTrocaTelefone };
}
