import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import { telefoneNormalizadoValido } from './telefone.ts';
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

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Adaptador minimo para a RPC public.reivindicar_mensagem (specs/
 * interpretacao-ia.md, "Contrato tecnico de banco — Etapa 6"). Uma unica
 * chamada, sem retry, sem releitura. Nao chama modelo, nao executa
 * controlador. As mensagens de erro citam somente nomes de campo ou codigos
 * tecnicos fixos — nunca `error.message` do cliente Supabase, nem
 * claim_token, PII ou qualquer payload bruto retornado pela RPC.
 */
export async function reivindicarMensagem(
  cliente: ClienteRpc,
  entrada: ReivindicarMensagemEntrada
): Promise<ReivindicarMensagemSaida> {
  validarEntrada(entrada);

  const { data, error } = await cliente.rpc(NOME_RPC, {
    p_provider: entrada.provider,
    p_instancia_whatsapp: entrada.instancia_whatsapp,
    p_message_id: entrada.message_id,
    p_clinica_id: entrada.clinica_id,
    p_telefone_normalizado: entrada.telefone_normalizado,
  });

  if (error) {
    // Nunca propaga error.message: pode conter SQL, detalhes de linha ou
    // outro conteudo bruto reportado pelo cliente Supabase. Motivo tecnico
    // fixo somente.
    throw new ErroRpcTecnico(NOME_RPC, 'cliente_supabase_falhou');
  }

  return validarSaida(data);
}

function validarEntrada(entrada: ReivindicarMensagemEntrada): void {
  validarStringNaoVazia('provider', entrada.provider);
  validarStringNaoVazia('instancia_whatsapp', entrada.instancia_whatsapp);
  validarStringNaoVazia('message_id', entrada.message_id);
  validarUuid('clinica_id', entrada.clinica_id);
  if (typeof entrada.telefone_normalizado !== 'string' || !telefoneNormalizadoValido(entrada.telefone_normalizado)) {
    throw new EntradaInvalidaError(
      'telefone_normalizado',
      'telefone_normalizado fora do formato brasileiro canonico (55 + 10 ou 11 digitos)'
    );
  }
}

function validarStringNaoVazia(campo: string, valor: unknown): void {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new EntradaInvalidaError(campo, `${campo} deve ser uma string nao vazia`);
  }
}

function validarUuid(campo: string, valor: unknown): void {
  if (typeof valor !== 'string' || !UUID_REGEX.test(valor)) {
    throw new EntradaInvalidaError(campo, `${campo} deve estar no formato UUID valido`);
  }
}

function validarSaida(data: unknown): ReivindicarMensagemSaida {
  const linha = extrairLinhaUnica(data);

  const resultadoBruto = linha.resultado;
  if (typeof resultadoBruto !== 'string' || !RESULTADOS_VALIDOS.includes(resultadoBruto as ResultadoReivindicacao)) {
    throw new ErroRpcTecnico(NOME_RPC, "campo 'resultado' ausente ou fora do vocabulario aprovado");
  }
  const resultado = resultadoBruto as ResultadoReivindicacao;

  const mensagemRecebidaId = campoOpcionalUuid(linha.mensagem_recebida_id, 'mensagem_recebida_id');
  const claimToken = campoOpcionalUuid(linha.claim_token, 'claim_token');
  const leaseExpiraEm = campoOpcionalTimestamp(linha.lease_expira_em, 'lease_expira_em');
  const interpretacaoPersistidaEm = campoOpcionalTimestamp(linha.interpretacao_persistida_em, 'interpretacao_persistida_em');

  validarCoerencia(resultado, mensagemRecebidaId, claimToken, leaseExpiraEm, interpretacaoPersistidaEm);

  return {
    resultado,
    mensagem_recebida_id: mensagemRecebidaId,
    claim_token: claimToken,
    lease_expira_em: leaseExpiraEm,
    interpretacao_persistida_em: interpretacaoPersistidaEm,
  };
}

// Coerencia completa do payload contra o contrato real da migration — nunca
// confia parcialmente no retorno da RPC, mesmo quando `resultado` em si e
// um valor valido do vocabulario aprovado.
function validarCoerencia(
  resultado: ResultadoReivindicacao,
  mensagemRecebidaId: string | null,
  claimToken: string | null,
  leaseExpiraEm: string | null,
  interpretacaoPersistidaEm: string | null
): void {
  if (resultado === 'nao_elegivel') {
    if (mensagemRecebidaId !== null || claimToken !== null || leaseExpiraEm !== null || interpretacaoPersistidaEm !== null) {
      throw new ErroRpcTecnico(NOME_RPC, "resultado 'nao_elegivel' deve retornar todos os campos de reivindicacao nulos");
    }
    return;
  }

  if (mensagemRecebidaId === null || claimToken === null || leaseExpiraEm === null) {
    throw new ErroRpcTecnico(NOME_RPC, `resultado '${resultado}' deve retornar mensagem_recebida_id, claim_token e lease_expira_em`);
  }

  if (resultado === 'reivindicada_interpretar' && interpretacaoPersistidaEm !== null) {
    throw new ErroRpcTecnico(NOME_RPC, "resultado 'reivindicada_interpretar' deve retornar interpretacao_persistida_em nulo");
  }
  if (resultado === 'reivindicada_resposta_fixa' && interpretacaoPersistidaEm === null) {
    throw new ErroRpcTecnico(NOME_RPC, "resultado 'reivindicada_resposta_fixa' deve retornar interpretacao_persistida_em preenchido");
  }
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
