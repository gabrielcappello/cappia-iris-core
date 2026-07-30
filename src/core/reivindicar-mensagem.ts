import { ErroRpcTecnico } from './erros.ts';
import type {
  ClienteRpc,
  ReivindicarMensagemEntrada,
  ReivindicarMensagemSaida,
  ResultadoReivindicacao,
} from './mensagens-recebidas-tipos.ts';

const NOME_RPC = 'reivindicar_mensagem';

const RESULTADOS_VALIDOS: readonly ResultadoReivindicacao[] = [
  'reivindicada_interpretar',
  'reivindicada_resposta_fixa',
  'nao_elegivel',
];

/**
 * Adaptador minimo para a RPC public.reivindicar_mensagem (specs/
 * interpretacao-ia.md, "Contrato tecnico de banco — Etapa 6"). Uma unica
 * chamada, sem retry, sem releitura. Nao chama modelo, nao executa
 * controlador, nunca registra claim_token, PII ou o payload bruto da RPC —
 * as mensagens de erro so citam nomes de campo fixos.
 */
export async function reivindicarMensagem(
  cliente: ClienteRpc,
  entrada: ReivindicarMensagemEntrada
): Promise<ReivindicarMensagemSaida> {
  const { data, error } = await cliente.rpc(NOME_RPC, {
    p_provider: entrada.provider,
    p_instancia_whatsapp: entrada.instancia_whatsapp,
    p_message_id: entrada.message_id,
    p_clinica_id: entrada.clinica_id,
    p_telefone_normalizado: entrada.telefone_normalizado,
  });

  if (error) {
    throw new ErroRpcTecnico(NOME_RPC, error.message);
  }

  return validarSaida(data);
}

function validarSaida(data: unknown): ReivindicarMensagemSaida {
  const linha = extrairLinhaUnica(data);

  const resultadoBruto = linha.resultado;
  if (typeof resultadoBruto !== 'string' || !RESULTADOS_VALIDOS.includes(resultadoBruto as ResultadoReivindicacao)) {
    throw new ErroRpcTecnico(NOME_RPC, "campo 'resultado' ausente ou fora do vocabulario aprovado");
  }
  const resultado = resultadoBruto as ResultadoReivindicacao;

  const mensagemRecebidaId = campoOpcionalString(linha.mensagem_recebida_id, 'mensagem_recebida_id');
  const claimToken = campoOpcionalString(linha.claim_token, 'claim_token');
  const leaseExpiraEm = campoOpcionalString(linha.lease_expira_em, 'lease_expira_em');
  const interpretacaoPersistidaEm = campoOpcionalString(linha.interpretacao_persistida_em, 'interpretacao_persistida_em');

  // claim_token so pode existir nos resultados reivindicada_* — nao confia
  // cegamente no payload da RPC, mesmo que o resultado em si seja valido.
  if (resultado === 'nao_elegivel') {
    if (claimToken !== null) {
      throw new ErroRpcTecnico(NOME_RPC, "resultado 'nao_elegivel' nunca deve retornar claim_token");
    }
  } else if (claimToken === null || mensagemRecebidaId === null || leaseExpiraEm === null) {
    throw new ErroRpcTecnico(NOME_RPC, `resultado '${resultado}' deve retornar mensagem_recebida_id, claim_token e lease_expira_em`);
  }

  return {
    resultado,
    mensagem_recebida_id: mensagemRecebidaId,
    claim_token: claimToken,
    lease_expira_em: leaseExpiraEm,
    interpretacao_persistida_em: interpretacaoPersistidaEm,
  };
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
