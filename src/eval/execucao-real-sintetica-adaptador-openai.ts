// Runner ISOLADO para a execucao real controlada UNICA do adaptador OpenAI
// de producao (`src/core/cliente-modelo-openai.ts`), aprovado estaticamente
// no commit 437694b apos seis rodadas de revisao. Este arquivo NAO integra
// o adaptador a nenhum fluxo -- e um runner avulso, chamado manualmente,
// fora de qualquer pipeline.
//
// Reaproveita diretamente (nunca duplica) do Core:
//   - criarClienteModeloOpenAI, MODELO_GPT_4_1_MINI e os tres tempos
//     aprovados (TIMEOUT_POR_TENTATIVA_MS_APROVADO, PRAZO_TOTAL_MS_APROVADO,
//     ESPERA_ENTRE_TENTATIVAS_MS_APROVADO) de ./cliente-modelo-openai.ts;
//   - INSTRUCOES_EXTRATOR e SCHEMA_SAIDA_INTERPRETACAO de
//     ./interpretacao-instrucoes.ts (o adaptador ignora o `schema` recebido
//     em executar() e sempre usa seu proprio schema portatil interno --
//     este runner passa o schema oficial do Core so para satisfazer a
//     assinatura, sem duplicar nenhum schema).
//
// Payload sintetico FIXO, unico autorizado (ver especificacao aprovada) --
// nunca aceito por argv, arquivo externo, stdin ou variavel de ambiente,
// exatamente para impedir troca acidental por dado real:
//   { "mensagens_atuais": ["Quero agendar uma limpeza amanha a tarde."],
//     "dados_atuais": {} }
// Nenhum nome, CPF, nascimento, e-mail, telefone, clinica_id, paciente_id
// ou conversa_id em nenhum lugar deste arquivo.
//
// Limite externo absoluto: um wrapper de fetch (criarFetchComLimiteExterno)
// fica entre o adaptador e a rede. Ele permite exatamente UMA chamada real;
// qualquer segunda invocacao vinda do adaptador (por exemplo, uma tentativa
// de retry) e bloqueada ANTES de qualquer acesso a rede, com um erro tecnico
// fixo -- e faz o resultado final ser reprovado, mesmo que o adaptador tenha
// tratado esse bloqueio como um erro sanitizado comum. O adaptador de
// producao nao e alterado nem tem sua politica de retry modificada; o limite
// e imposto inteiramente por fora.
//
// Nunca imprime, loga ou persiste: valor da chave, tamanho/prefixo/sufixo da
// chave, header Authorization, instrucoes, mensagens_atuais, dados_atuais,
// schema completo, corpo da requisicao serializado, corpo bruto da resposta,
// envelope bruto da OpenAI, output_text bruto ou headers completos. A unica
// saida e o objeto de evidencia sanitizado definido abaixo (booleanos,
// contadores, nomes de campo, categoria/codigo tecnico, duracao).
//
// Chave: somente via variavel de ambiente IRIS_EVAL_OPENAI_API_KEY, nunca
// por argumento. Este arquivo nunca abre, le, imprime ou edita nada dentro
// de .iris-secrets -- a chave chega exclusivamente via `node --env-file`.
//
// Comando futuro (NAO executado nesta rodada, requer nova autorizacao):
//   node --env-file="C:\Users\Gabriel\.iris-secrets\iris-model-eval.env" src/eval/execucao-real-sintetica-adaptador-openai.ts
//
// Codigo de saida 0 somente quando aprovado=true. Qualquer outro caso sai
// com codigo diferente de zero. Nunca repete a execucao automaticamente.

import { pathToFileURL } from 'node:url';
import {
  criarClienteModeloOpenAI,
  ErroClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { INSTRUCOES_EXTRATOR, SCHEMA_SAIDA_INTERPRETACAO } from '../core/interpretacao-instrucoes.ts';

// --- Payload sintetico autorizado (fixo -- ver cabecalho) ---
export const PAYLOAD_SINTETICO_AUTORIZADO = Object.freeze({
  mensagens_atuais: Object.freeze(['Quero agendar uma limpeza amanhã à tarde.']) as readonly string[],
  dados_atuais: Object.freeze({}) as Readonly<Record<string, string>>,
});

// --- Saida estrutural esperada para este payload especifico (secao 3/7 da especificacao) ---
export const CAMPOS_ESPERADOS = ['intencao', 'procedimento_texto', 'data_texto', 'periodo'] as const;
const VALORES_ESPERADOS: Record<(typeof CAMPOS_ESPERADOS)[number], string> = {
  intencao: 'novo_agendamento',
  procedimento_texto: 'limpeza',
  data_texto: 'amanhã',
  periodo: 'tarde',
};

// Tolerancia somente para comparacao (espacos externos, caixa, acentos) --
// nunca altera o valor recebido do adaptador.
function normalizarParaComparacao(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

export interface EvidenciaSucesso {
  aprovado: true;
  status_http: number;
  modelo_ok: boolean;
  store_false: boolean;
  strict_true: boolean;
  tools_ausentes: boolean;
  conversao_ok: true;
  campos: string[];
  invocacoes_fetch: number;
  chamadas_externas: number;
  segunda_chamada_bloqueada: boolean;
  duracao_ms: number;
}

export interface EvidenciaErro {
  aprovado: false;
  categoria: string | null;
  codigo: string | null;
  status_http: number | null;
  invocacoes_fetch: number;
  chamadas_externas: number;
  segunda_chamada_bloqueada: boolean;
  duracao_ms: number;
}

export type Evidencia = EvidenciaSucesso | EvidenciaErro;

interface InspecaoEstrutural {
  modeloOk: boolean;
  storeFalse: boolean;
  formatoJsonSchema: boolean;
  strictTrue: boolean;
  toolsAusentes: boolean;
  payloadAutorizado: boolean;
}

function inspecaoEstruturalValida(inspecao: InspecaoEstrutural): boolean {
  return (
    inspecao.modeloOk &&
    inspecao.storeFalse &&
    inspecao.formatoJsonSchema &&
    inspecao.strictTrue &&
    inspecao.toolsAusentes &&
    inspecao.payloadAutorizado
  );
}

// Analisa o corpo da requisicao SOMENTE EM MEMORIA (nunca impresso nem
// persistido) e devolve so booleanos estruturais.
export function inspecionarCorpoRequisicao(corpoBruto: string): InspecaoEstrutural {
  const invalida: InspecaoEstrutural = {
    modeloOk: false,
    storeFalse: false,
    formatoJsonSchema: false,
    strictTrue: false,
    toolsAusentes: false,
    payloadAutorizado: false,
  };

  let corpo: unknown;
  try {
    corpo = JSON.parse(corpoBruto);
  } catch {
    return invalida;
  }
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) return invalida;
  const envelope = corpo as Record<string, unknown>;

  const modeloOk = envelope.model === MODELO_GPT_4_1_MINI;
  const storeFalse = envelope.store === false;
  const text = envelope.text as { format?: { type?: unknown; strict?: unknown } } | undefined;
  const formatoJsonSchema = text?.format?.type === 'json_schema';
  const strictTrue = text?.format?.strict === true;
  const toolsAusentes = !('tools' in envelope);

  let payloadAutorizado = false;
  try {
    const input = envelope.input;
    const mensagemUsuario = Array.isArray(input)
      ? (input as Array<{ role?: string; content?: unknown }>).find((item) => item?.role === 'user')
      : undefined;
    const conteudo = typeof mensagemUsuario?.content === 'string' ? JSON.parse(mensagemUsuario.content) : null;
    payloadAutorizado =
      conteudo !== null &&
      typeof conteudo === 'object' &&
      !Array.isArray(conteudo) &&
      Object.keys(conteudo).sort().join(',') === 'dados_atuais,mensagens_atuais' &&
      JSON.stringify(conteudo.mensagens_atuais) === JSON.stringify(PAYLOAD_SINTETICO_AUTORIZADO.mensagens_atuais) &&
      JSON.stringify(conteudo.dados_atuais) === JSON.stringify(PAYLOAD_SINTETICO_AUTORIZADO.dados_atuais);
  } catch {
    payloadAutorizado = false;
  }

  return { modeloOk, storeFalse, formatoJsonSchema, strictTrue, toolsAusentes, payloadAutorizado };
}

interface ContadoresFetch {
  invocacoesRecebidas: number;
  chamadasExternas: number;
  segundaChamadaBloqueada: boolean;
}

// Codigos tecnicos fixos usados pelo wrapper ao bloquear -- nunca
// interpolam nada externo (nem URL, nem corpo, nem mensagem do provedor).
const CODIGO_SEGUNDA_CHAMADA_BLOQUEADA = 'segunda_chamada_externa_bloqueada_pelo_wrapper';
const CODIGO_ESTRUTURA_INVALIDA_BLOQUEADA = 'estrutura_da_requisicao_invalida_bloqueada_pelo_wrapper';

// Wrapper de fetch com limite externo ABSOLUTO: no maximo uma chamada real
// sai para a rede, non-negociavel. Recebe o fetch subjacente (real ou
// falso, injetavel para teste) e devolve o wrapper mais funcoes de
// observacao -- nunca imprime nem persiste o que observa.
export function criarFetchComLimiteExterno(fetchSubjacente: typeof fetch): {
  fetchWrapper: typeof fetch;
  obterContadores: () => ContadoresFetch;
  obterInspecao: () => InspecaoEstrutural | null;
  obterStatusHttp: () => number | null;
} {
  const contadores: ContadoresFetch = { invocacoesRecebidas: 0, chamadasExternas: 0, segundaChamadaBloqueada: false };
  let ultimaInspecao: InspecaoEstrutural | null = null;
  let ultimoStatusHttp: number | null = null;

  const fetchWrapper = (async (url: string | URL, opcoes?: RequestInit) => {
    contadores.invocacoesRecebidas++;

    // Regra 1: qualquer invocacao alem da primeira e bloqueada ANTES da
    // rede -- independente do motivo (retry por categoria repetivel,
    // reenvio, o que for).
    if (contadores.invocacoesRecebidas > 1) {
      contadores.segundaChamadaBloqueada = true;
      throw new Error(CODIGO_SEGUNDA_CHAMADA_BLOQUEADA);
    }

    const corpoBruto = typeof opcoes?.body === 'string' ? opcoes.body : '';
    ultimaInspecao = inspecionarCorpoRequisicao(corpoBruto);

    if (!inspecaoEstruturalValida(ultimaInspecao)) {
      throw new Error(CODIGO_ESTRUTURA_INVALIDA_BLOQUEADA);
    }

    contadores.chamadasExternas++;
    const resposta = await fetchSubjacente(url, opcoes);
    ultimoStatusHttp = resposta.status;
    return resposta;
  }) as typeof fetch;

  return {
    fetchWrapper,
    obterContadores: () => ({ ...contadores }),
    obterInspecao: () => ultimaInspecao,
    obterStatusHttp: () => ultimoStatusHttp,
  };
}

// Valida que o contrato interno devolvido pelo adaptador contem EXATAMENTE
// os quatro campos esperados, cada um uma unica vez, acao "informar", com
// o valor esperado (tolerando so espaco/caixa/acento na comparacao). Nunca
// altera o valor recebido.
export function validarConversao(resultado: unknown): boolean {
  if (resultado === null || typeof resultado !== 'object') return false;
  const alteracoes = (resultado as { alteracoes?: unknown }).alteracoes;
  if (alteracoes === null || typeof alteracoes !== 'object' || Array.isArray(alteracoes)) return false;

  const chaves = Object.keys(alteracoes as Record<string, unknown>).sort();
  const chavesEsperadas = [...CAMPOS_ESPERADOS].sort();
  if (JSON.stringify(chaves) !== JSON.stringify(chavesEsperadas)) return false;

  for (const campo of CAMPOS_ESPERADOS) {
    const item = (alteracoes as Record<string, { acao?: unknown; valor?: unknown }>)[campo];
    if (!item || item.acao !== 'informar') return false;
    if (typeof item.valor !== 'string') return false;
    if (normalizarParaComparacao(item.valor) !== normalizarParaComparacao(VALORES_ESPERADOS[campo])) return false;
  }

  return true;
}

function camposOrdenados(resultado: unknown): string[] {
  const alteracoes = (resultado as { alteracoes?: Record<string, unknown> } | null)?.alteracoes ?? {};
  return Object.keys(alteracoes).sort();
}

// Executa exatamente uma tentativa de ponta a ponta (adaptador real +
// wrapper de limite externo) e devolve somente a evidencia sanitizada.
// `fetchSubjacente` e injetavel para permitir testes com fetch inteiramente
// falso, sem nenhuma chamada real.
export async function executarUma(fetchSubjacente: typeof fetch, chaveApi: string): Promise<Evidencia> {
  const { fetchWrapper, obterContadores, obterInspecao, obterStatusHttp } = criarFetchComLimiteExterno(fetchSubjacente);

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    fetch: fetchWrapper,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const inicio = Date.now();
  try {
    const resultado = await cliente.executar({
      instrucoes: INSTRUCOES_EXTRATOR,
      schema: SCHEMA_SAIDA_INTERPRETACAO,
      payload: PAYLOAD_SINTETICO_AUTORIZADO as never,
    });
    const duracaoMs = Date.now() - inicio;
    const contadores = obterContadores();
    const inspecao = obterInspecao();
    const statusHttp = obterStatusHttp();
    const conversaoOk = validarConversao(resultado);

    // cliente.executar() so resolve (nunca rejeita) se a primeira e unica
    // invocacao teve estrutura valida e chegou a rede -- entao, se
    // chegamos aqui, invocacoesRecebidas/chamadasExternas ja sao 1/1 e
    // segundaChamadaBloqueada e false, por construcao do adaptador (nunca
    // ha terceira tentativa, e uma segunda bloqueada sempre rejeita).
    if (statusHttp === 200 && conversaoOk && inspecao && inspecaoEstruturalValida(inspecao)) {
      return {
        aprovado: true,
        status_http: statusHttp,
        modelo_ok: inspecao.modeloOk,
        store_false: inspecao.storeFalse,
        strict_true: inspecao.strictTrue,
        tools_ausentes: inspecao.toolsAusentes,
        conversao_ok: true,
        campos: camposOrdenados(resultado),
        invocacoes_fetch: contadores.invocacoesRecebidas,
        chamadas_externas: contadores.chamadasExternas,
        segunda_chamada_bloqueada: contadores.segundaChamadaBloqueada,
        duracao_ms: duracaoMs,
      };
    }

    return {
      aprovado: false,
      categoria: null,
      codigo: 'conversao_nao_corresponde_ao_esperado',
      status_http: statusHttp,
      invocacoes_fetch: contadores.invocacoesRecebidas,
      chamadas_externas: contadores.chamadasExternas,
      segunda_chamada_bloqueada: contadores.segundaChamadaBloqueada,
      duracao_ms: duracaoMs,
    };
  } catch (erro) {
    const duracaoMs = Date.now() - inicio;
    const contadores = obterContadores();
    const statusHttp = obterStatusHttp();
    const categoria = erro instanceof ErroClienteModeloOpenAI ? erro.categoria : null;
    const codigo = erro instanceof ErroClienteModeloOpenAI ? erro.codigo : 'erro_nao_classificado_pelo_adaptador';

    return {
      aprovado: false,
      categoria,
      codigo,
      status_http: statusHttp,
      invocacoes_fetch: contadores.invocacoesRecebidas,
      chamadas_externas: contadores.chamadasExternas,
      segunda_chamada_bloqueada: contadores.segundaChamadaBloqueada,
      duracao_ms: duracaoMs,
    };
  }
}

function imprimirEvidencia(evidencia: Evidencia): void {
  // Unica saida deste runner -- somente o objeto sanitizado, nunca
  // payload, chave, corpo bruto ou headers.
  console.log(JSON.stringify(evidencia, null, 2));
}

async function main(): Promise<void> {
  const chaveApi = process.env.IRIS_EVAL_OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    imprimirEvidencia({
      aprovado: false,
      categoria: null,
      codigo: 'chave_ausente',
      status_http: null,
      invocacoes_fetch: 0,
      chamadas_externas: 0,
      segunda_chamada_bloqueada: false,
      duracao_ms: 0,
    });
    process.exitCode = 1;
    return;
  }

  const evidencia = await executarUma(fetch, chaveApi);
  imprimirEvidencia(evidencia);
  process.exitCode = evidencia.aprovado ? 0 : 1;
}

// So dispara main() quando este arquivo e executado diretamente (node
// src/eval/execucao-real-sintetica-adaptador-openai.ts) -- nunca quando e
// importado (por exemplo, pelo proprio arquivo de teste deste runner).
const ehExecucaoDireta = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (ehExecucaoDireta) {
  main().catch((erro) => {
    imprimirEvidencia({
      aprovado: false,
      categoria: null,
      codigo: 'erro_nao_tratado_no_runner',
      status_http: null,
      invocacoes_fetch: 0,
      chamadas_externas: 0,
      segunda_chamada_bloqueada: false,
      duracao_ms: 0,
    });
    process.exitCode = 1;
    void erro; // nunca logado -- pode conter contexto sensivel do stack
  });
}
