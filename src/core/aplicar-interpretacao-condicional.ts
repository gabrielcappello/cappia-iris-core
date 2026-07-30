import { ErroRpcTecnico } from './erros.ts';
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

/**
 * Adaptador minimo para a RPC public.aplicar_interpretacao_condicional
 * (specs/interpretacao-ia.md, "Contrato tecnico de banco — Etapa 6"). Uma
 * unica chamada, sem retry, sem releitura, sob nenhuma circunstancia — nem
 * mesmo quando o resultado e conflito_concorrente ou autorizacao_invalida.
 * Nao chama modelo, nao executa controlador, nunca registra claim_token,
 * PII ou o payload bruto da RPC.
 */
export async function aplicarInterpretacaoCondicional(
  cliente: ClienteRpc,
  entrada: AplicarInterpretacaoCondicionalEntrada
): Promise<AplicarInterpretacaoCondicionalSaida> {
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
    throw new ErroRpcTecnico(NOME_RPC, error.message);
  }

  return validarSaida(data);
}

function validarSaida(data: unknown): AplicarInterpretacaoCondicionalSaida {
  const linha = extrairLinhaUnica(data);

  const resultadoBruto = linha.resultado;
  if (typeof resultadoBruto !== 'string' || !RESULTADOS_VALIDOS.includes(resultadoBruto as ResultadoPersistenciaCondicional)) {
    throw new ErroRpcTecnico(NOME_RPC, "campo 'resultado' ausente ou fora do vocabulario aprovado");
  }
  const resultado = resultadoBruto as ResultadoPersistenciaCondicional;

  const conversaId = campoOpcionalString(linha.conversa_id, 'conversa_id');
  const atualizadoEm = campoOpcionalString(linha.atualizado_em, 'atualizado_em');
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

function extrairLinhaUnica(data: unknown): Record<string, unknown> {
  let linha = data;
  if (Array.isArray(linha)) {
    if (linha.length !== 1) {
      throw new ErroRpcTecnico(NOME_RPC, 'retorno da RPC deve conter exatamente uma linha');
    }
    linha = linha[0];
  }
  if (linha === null || typeof linha !== 'object') {
    throw new ErroRpcTecnico(NOME_RPC, 'retorno da RPC deve ser um objeto');
  }
  return linha as Record<string, unknown>;
}

function campoOpcionalString(valor: unknown, campo: string): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'string') {
    throw new ErroRpcTecnico(NOME_RPC, `campo '${campo}' deve ser string ou null`);
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
