import { validarContexto } from './aplicar-dados.ts';
import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import type {
  AplicarInterpretacaoCondicionalEntrada,
  AplicarInterpretacaoCondicionalSaida,
  ClienteRpc,
  ResultadoPersistenciaCondicional,
} from './mensagens-recebidas-tipos.ts';

const NOME_RPC = 'aplicar_interpretacao_condicional';

const RESULTADOS_VALIDOS: readonly ResultadoPersistenciaCondicional[] = [
  'persistida',
  'autorizacao_invalida',
  'conflito_concorrente',
];

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Adaptador minimo para a RPC public.aplicar_interpretacao_condicional
 * (specs/interpretacao-ia.md, "Contrato tecnico de banco — Etapa 6"). Uma
 * unica chamada, sem retry, sem releitura, sob nenhuma circunstancia — nem
 * mesmo quando o resultado e conflito_concorrente ou autorizacao_invalida.
 * Nao chama modelo, nao executa controlador. As mensagens de erro citam
 * somente nomes de campo ou codigos tecnicos fixos — nunca `error.message`
 * do cliente Supabase, nem claim_token, PII ou qualquer payload bruto
 * retornado pela RPC.
 */
export async function aplicarInterpretacaoCondicional(
  cliente: ClienteRpc,
  entrada: AplicarInterpretacaoCondicionalEntrada
): Promise<AplicarInterpretacaoCondicionalSaida> {
  validarEntrada(entrada);

  const { data, error } = await cliente.rpc(NOME_RPC, {
    p_mensagem_recebida_id: entrada.mensagem_recebida_id,
    p_clinica_id: entrada.clinica_id,
    p_telefone_normalizado: entrada.telefone_normalizado,
    p_claim_token: entrada.claim_token,
    p_conversa_id: entrada.conversa_id,
    p_snapshot_atualizado_em: entrada.snapshot_atualizado_em,
    p_alteracoes_aplicaveis: entrada.alteracoes_aplicaveis,
  });

  if (error) {
    // Nunca propaga error.message: pode conter SQL, detalhes de linha ou
    // outro conteudo bruto reportado pelo cliente Supabase. Motivo tecnico
    // fixo somente.
    throw new ErroRpcTecnico(NOME_RPC, 'cliente_supabase_falhou');
  }

  return validarSaida(data);
}

function validarEntrada(entrada: AplicarInterpretacaoCondicionalEntrada): void {
  // Reutiliza a validacao canonica de conversa_id/clinica_id/
  // telefone_normalizado (aplicar-dados.ts) — mesmo formato de UUID e de
  // telefone, sem duplicar regex.
  validarContexto(entrada);
  validarUuid('mensagem_recebida_id', entrada.mensagem_recebida_id);
  validarUuid('claim_token', entrada.claim_token);
  validarTimestamp('snapshot_atualizado_em', entrada.snapshot_atualizado_em);

  if (
    entrada.alteracoes_aplicaveis === null ||
    typeof entrada.alteracoes_aplicaveis !== 'object' ||
    Array.isArray(entrada.alteracoes_aplicaveis)
  ) {
    throw new EntradaInvalidaError('alteracoes_aplicaveis', 'alteracoes_aplicaveis deve ser um objeto (nao nulo, nao array)');
  }
  // Nao duplica a validacao campo-a-campo de alteracoes_aplicaveis: a RPC
  // continua responsavel pela validacao transacional completa (allowlist,
  // acoes, dominios de periodo/intencao).
}

function validarUuid(campo: string, valor: unknown): void {
  if (typeof valor !== 'string' || !UUID_REGEX.test(valor)) {
    throw new EntradaInvalidaError(campo, `${campo} deve estar no formato UUID valido`);
  }
}

function validarTimestamp(campo: string, valor: unknown): void {
  if (typeof valor !== 'string' || valor.trim() === '' || Number.isNaN(Date.parse(valor))) {
    throw new EntradaInvalidaError(campo, `${campo} deve ser um timestamp valido`);
  }
}

function validarSaida(data: unknown): AplicarInterpretacaoCondicionalSaida {
  const linha = extrairLinhaUnica(data);

  const resultadoBruto = linha.resultado;
  if (typeof resultadoBruto !== 'string' || !RESULTADOS_VALIDOS.includes(resultadoBruto as ResultadoPersistenciaCondicional)) {
    throw new ErroRpcTecnico(NOME_RPC, "campo 'resultado' ausente ou fora do vocabulario aprovado");
  }
  const resultado = resultadoBruto as ResultadoPersistenciaCondicional;

  const conversaId = campoOpcionalUuid(linha.conversa_id, 'conversa_id');
  const atualizadoEm = campoOpcionalTimestamp(linha.atualizado_em, 'atualizado_em');
  const dados = campoOpcionalObjeto(linha.dados, 'dados');

  // O estado oficial (conversa_id/dados/atualizado_em) so pode existir
  // quando resultado = 'persistida' — nunca confia cegamente no payload,
  // mesmo que 'resultado' em si seja um valor valido do vocabulario.
  if (resultado === 'persistida') {
    if (conversaId === null || atualizadoEm === null || dados === null) {
      throw new ErroRpcTecnico(NOME_RPC, "resultado 'persistida' deve retornar conversa_id, dados e atualizado_em");
    }
  } else if (conversaId !== null || atualizadoEm !== null || dados !== null) {
    throw new ErroRpcTecnico(NOME_RPC, `resultado '${resultado}' nao deve retornar o estado oficial`);
  }

  return { resultado, conversa_id: conversaId, dados, atualizado_em: atualizadoEm };
}

// Formato estrito: sempre array com exatamente uma linha. Nenhuma tolerancia
// a formatos alternativos (objeto unico, array vazio, multiplas linhas).
function extrairLinhaUnica(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data)) {
    throw new ErroRpcTecnico(NOME_RPC, 'retorno da RPC deve ser um array');
  }
  if (data.length !== 1) {
    throw new ErroRpcTecnico(NOME_RPC, 'retorno da RPC deve conter exatamente uma linha');
  }
  const linha = data[0];
  if (linha === null || typeof linha !== 'object' || Array.isArray(linha)) {
    throw new ErroRpcTecnico(NOME_RPC, 'retorno da RPC deve ser um objeto');
  }
  return linha as Record<string, unknown>;
}

function campoOpcionalUuid(valor: unknown, campo: string): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'string' || !UUID_REGEX.test(valor)) {
    throw new ErroRpcTecnico(NOME_RPC, `campo '${campo}' deve ser um UUID valido ou null`);
  }
  return valor;
}

function campoOpcionalTimestamp(valor: unknown, campo: string): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'string' || valor.trim() === '' || Number.isNaN(Date.parse(valor))) {
    throw new ErroRpcTecnico(NOME_RPC, `campo '${campo}' deve ser um timestamp valido ou null`);
  }
  return valor;
}

function campoOpcionalObjeto(valor: unknown, campo: string): Record<string, unknown> | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'object' || Array.isArray(valor)) {
    throw new ErroRpcTecnico(NOME_RPC, `campo '${campo}' deve ser objeto ou null`);
  }
  return valor as Record<string, unknown>;
}
