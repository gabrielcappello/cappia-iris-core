// Adaptador fino para a RPC public.cappia_persistir_paciente (Postgres),
// aplicada em 2026-08-09 nos dois projetos -- ver
// src/supabase/migrations/20260809120000_iris_nova_persistencia_paciente_v1.sql
// e a irma em migrations-legado/.
//
// Mesmo padrao de reservar-agendamento.ts: uma unica chamada, sem retry,
// validacao estrita de entrada e saida, nunca vaza error.message nem o
// payload bruto da RPC. NENHUMA logica de conversa aqui dentro -- o
// adaptador traduz e valida, quem decide o que fazer com o resultado e o
// chamador.
//
// UNICA TRADUCAO: `cpf` (dominio) -> `p_documento` (coluna fisica). Nao
// existe coluna `cpf` no banco e nao existe conceito `documento` no dominio;
// este arquivo e o unico ponto de ESCRITA onde os dois se encontram (o unico
// ponto de LEITURA correspondente e buscarPaciente, em identificacao.ts).
//
// NAO e chamada automaticamente em nenhum turno nesta subetapa -- a peca fica
// pronta e testada, o ponto de invocacao vem com o fluxo de cadastro.

import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';

const NOME_RPC = 'cappia_persistir_paciente';

// Vocabulario de erro exatamente como a RPC o define. `cpf_ja_cadastrado` NAO
// entra nesta lista: ele tem tipo proprio no resultado, pelo mesmo motivo de
// `horario_ocupado` em reservar-agendamento.ts -- e o caso que o chamador
// resolve conversando com o paciente, nunca um erro tecnico a reportar.
const MOTIVOS_ERRO: readonly string[] = [
  'clinica_id_ausente',
  'telefone_normalizado_ausente',
  'nome_ausente',
];

export type MotivoErroPersistirPaciente = (typeof MOTIVOS_ERRO)[number];

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATA_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export interface PersistirPacienteEntrada {
  clinica_id: string;
  telefone_normalizado: string;
  /**
   * Obrigatorio em TODA chamada, criacao ou atualizacao. O chamador envia o
   * estado cadastral atual conhecido (a visao efetiva), nao apenas o campo
   * digitado no turno -- decisao do Gabriel em 2026-08-09, que evita
   * subconsulta interna, corrida especial e distincao criacao/atualizacao
   * dentro da RPC.
   */
  nome: string;
  /** Vira `p_documento` na RPC. Ausente = nao altera o valor ja gravado. */
  cpf?: string;
  /** YYYY-MM-DD. Ausente = nao altera o valor ja gravado. */
  data_nascimento?: string;
  /** Ausente = nao altera o valor ja gravado. */
  email?: string;
}

export type ResultadoPersistirPaciente =
  | { tipo: 'persistido'; paciente_id: string }
  | { tipo: 'cpf_ja_cadastrado' }
  | { tipo: 'falhou'; motivo: MotivoErroPersistirPaciente };

export async function persistirPaciente(
  cliente: ClienteRpc,
  entrada: PersistirPacienteEntrada
): Promise<ResultadoPersistirPaciente> {
  validarEntrada(entrada);

  // Campo opcional AUSENTE nunca vira `null` explicito no payload: a RPC
  // trata `null` como "nao alterar", e mandar a chave com null seria
  // equivalente -- mas omitir deixa o contrato obvio no wire e impede que um
  // `undefined` serializado vire string "undefined" em algum cliente.
  const { data, error } = await cliente.rpc(NOME_RPC, {
    p_clinica_id: entrada.clinica_id,
    p_telefone_normalizado: entrada.telefone_normalizado,
    p_nome: entrada.nome,
    ...(entrada.cpf !== undefined ? { p_documento: entrada.cpf } : {}),
    ...(entrada.data_nascimento !== undefined ? { p_data_nascimento: entrada.data_nascimento } : {}),
    ...(entrada.email !== undefined ? { p_email: entrada.email } : {}),
  });

  if (error) {
    // Nunca propaga error.message (pode conter SQL/detalhe de linha/PII).
    throw new ErroRpcTecnico(NOME_RPC, 'cliente_supabase_falhou');
  }

  return validarSaida(data);
}

function validarEntrada(entrada: PersistirPacienteEntrada): void {
  if (typeof entrada.clinica_id !== 'string' || !UUID_REGEX.test(entrada.clinica_id)) {
    throw new EntradaInvalidaError('clinica_id', 'clinica_id deve estar no formato UUID valido');
  }
  if (typeof entrada.telefone_normalizado !== 'string' || entrada.telefone_normalizado.trim() === '') {
    throw new EntradaInvalidaError('telefone_normalizado', 'telefone_normalizado deve ser uma string nao vazia');
  }
  if (typeof entrada.nome !== 'string' || entrada.nome.trim() === '') {
    throw new EntradaInvalidaError('nome', 'nome deve ser uma string nao vazia');
  }
  // Os tres opcionais so sao checados quando presentes. NENHUMA validacao de
  // CONTEUDO aqui (digito verificador de CPF, data plausivel, formato de
  // e-mail) -- isso e regra de produto, fora do escopo desta subetapa. O
  // adaptador so garante que o que sai daqui e do tipo certo.
  if (entrada.cpf !== undefined && (typeof entrada.cpf !== 'string' || entrada.cpf.trim() === '')) {
    throw new EntradaInvalidaError('cpf', 'cpf, quando presente, deve ser uma string nao vazia');
  }
  if (
    entrada.data_nascimento !== undefined &&
    (typeof entrada.data_nascimento !== 'string' || !DATA_REGEX.test(entrada.data_nascimento))
  ) {
    throw new EntradaInvalidaError('data_nascimento', 'data_nascimento, quando presente, deve estar no formato YYYY-MM-DD');
  }
  if (entrada.email !== undefined && (typeof entrada.email !== 'string' || entrada.email.trim() === '')) {
    throw new EntradaInvalidaError('email', 'email, quando presente, deve ser uma string nao vazia');
  }
}

// RETURNS jsonb (escalar) -- o retorno chega como objeto direto, nunca
// envolto em array.
function validarSaida(data: unknown): ResultadoPersistirPaciente {
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
    return { tipo: 'persistido', paciente_id: bruto.paciente_id };
  }

  const motivo = bruto.motivo;
  if (motivo === 'cpf_ja_cadastrado') return { tipo: 'cpf_ja_cadastrado' };

  // Motivo desconhecido FALHA FECHADO: nunca e reinterpretado como
  // cpf_ja_cadastrado nem silenciado como falha generica.
  if (typeof motivo !== 'string' || !MOTIVOS_ERRO.includes(motivo)) {
    throw new ErroRpcTecnico(NOME_RPC, "campo 'motivo' ausente ou fora do vocabulario aprovado");
  }
  return { tipo: 'falhou', motivo: motivo as MotivoErroPersistirPaciente };
}
