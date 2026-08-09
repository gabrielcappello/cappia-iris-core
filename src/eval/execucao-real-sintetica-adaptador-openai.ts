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
  campos_cadastrais_preenchidos: Object.freeze([]) as readonly string[],
});

// Nomes canonicos aceitos em campos_cadastrais_preenchidos. Somente o
// NOME do campo -- nunca o valor (specs/interpretacao-ia.md, "Entrada e
// PII"). Repetido aqui de proposito: o avaliador nao importa do core, para
// nao validar o adaptador contra a mesma constante que o adaptador usa.
const INDICADORES_CADASTRAIS_CANONICOS = ['nome', 'cpf', 'data_nascimento', 'email'];

// --- Saida estrutural esperada para este payload especifico (secao 3/7 da especificacao) ---
export const CAMPOS_ESPERADOS = ['intencao', 'procedimento_id', 'data_texto', 'periodo'] as const;
const VALORES_ESPERADOS: Record<(typeof CAMPOS_ESPERADOS)[number], string> = {
  intencao: 'novo_agendamento',
  procedimento_id: 'limpeza',
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

// Reproduz LOCALMENTE, so a transformacao estrutural aprovada que
// construirInstrucoesPortatil (privada em cliente-modelo-openai.ts) aplica
// sobre INSTRUCOES_EXTRATOR -- nunca duplica o texto integral das
// instrucoes, so as duas frases explicitamente aprovadas para esta
// substituicao. Isso permite calcular, de forma independente do
// adaptador, exatamente o que a mensagem system deveria conter -- e o
// teste "independencia do adaptador real" (no arquivo de teste) prova que
// essa expectativa calculada aqui bate com o que o adaptador realmente
// monta, sem nunca importar nem chamar a funcao privada.
//
// IMPORTANTE: calcularInstrucaoSystemEsperada e uma funcao PURA, exportada,
// mas NUNCA chamada no escopo superior deste modulo -- nenhuma excecao
// pode acontecer durante a importacao. Ela so e chamada dentro do bloco
// protegido de executarPrincipal (ou explicitamente por testes), e o
// resultado e passado explicitamente adiante (executarUma ->
// criarFetchComLimiteExterno -> inspecionarCorpoRequisicao) -- nunca
// guardado em variavel global, nunca recalculado silenciosamente em cada
// funcao da cadeia.
export const FRASE_ESTRUTURAL_FORMATO_INTERNO_ANTIGO =
  'Responda estritamente no formato do schema fornecido — nenhuma propriedade alem de "alteracoes" no nivel principal, nenhuma propriedade alem de "acao"/"valor" (ou somente "acao" para remover) dentro de cada alteracao.';

export const FRASE_ESTRUTURAL_TRANSPORTE_PORTATIL =
  'Responda estritamente no formato do schema fornecido — a raiz contem somente "alteracoes"; "alteracoes" e uma lista; cada item da lista contem exatamente "campo", "acao" e "valor"; informar e corrigir usam "valor" como string; remover usa "valor": null; nenhuma propriedade adicional e permitida.';

export function calcularInstrucaoSystemEsperada(instrucoesBase: string): string {
  const ocorrencias = instrucoesBase.split(FRASE_ESTRUTURAL_FORMATO_INTERNO_ANTIGO).length - 1;
  if (ocorrencias !== 1) {
    throw new Error('instrucoes_base_nao_contem_a_frase_estrutural_esperada_exatamente_uma_vez');
  }
  const substituida = instrucoesBase.replace(FRASE_ESTRUTURAL_FORMATO_INTERNO_ANTIGO, FRASE_ESTRUTURAL_TRANSPORTE_PORTATIL);

  // Confirma que a substituicao alterou SOMENTE a frase estrutural --
  // removendo a respectiva frase de cada versao, o restante precisa ser
  // byte-identico.
  const restanteOriginal = instrucoesBase.replace(FRASE_ESTRUTURAL_FORMATO_INTERNO_ANTIGO, '');
  const restanteSubstituido = substituida.replace(FRASE_ESTRUTURAL_TRANSPORTE_PORTATIL, '');
  if (restanteOriginal !== restanteSubstituido) {
    throw new Error('substituicao_alterou_algo_alem_da_frase_estrutural');
  }

  return substituida;
}

// O item system so e aceito com EXATAMENTE as propriedades role/content,
// role==="system", e content IGUAL, por comparacao direta de string, a
// instrucaoSystemEsperada recebida -- nenhum prefixo, sufixo, espaco
// adicional ou instrucao paralela.
function ehItemSystemValido(item: unknown, instrucaoSystemEsperada: string): item is { role: 'system'; content: string } {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
  const chaves = Object.keys(item as Record<string, unknown>).sort();
  if (JSON.stringify(chaves) !== JSON.stringify(['content', 'role'])) return false;
  const objeto = item as { role: unknown; content: unknown };
  if (objeto.role !== 'system') return false;
  if (typeof objeto.content !== 'string') return false;
  return objeto.content === instrucaoSystemEsperada;
}

// O item user so e aceito com EXATAMENTE as propriedades role e content
// (nenhuma propriedade paralela que pudesse carregar conteudo nao
// autorizado) -- confirmado contra o corpo real montado pelo adaptador em
// src/core/cliente-modelo-openai.ts (`{ role, content }`, nunca mais que
// isso). O conteudo textual em si (o payload sintetico serializado) e
// validado separadamente por ehPayloadDeUsuarioAutorizado.
function ehItemUserValido(item: unknown): item is { role: 'user'; content: string } {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
  const chaves = Object.keys(item as Record<string, unknown>).sort();
  if (JSON.stringify(chaves) !== JSON.stringify(['content', 'role'])) return false;
  const objeto = item as { role: unknown; content: unknown };
  if (objeto.role !== 'user') return false;
  return typeof objeto.content === 'string';
}

// O conteudo da mensagem user (JSON serializado dentro de `content`) so e
// aceito com EXATAMENTE as tres propriedades do contrato canonico --
// mensagens_atuais, dados_atuais e campos_cadastrais_preenchidos --, uma
// unica mensagem com o texto exatamente autorizado, dados_atuais
// exatamente vazio, e indicadores cadastrais restritos aos quatro nomes
// canonicos. Nenhuma propriedade adicional, nenhuma mensagem adicional,
// nenhum valor divergente, nenhum VALOR cadastral no lugar do nome.
function ehPayloadDeUsuarioAutorizado(conteudoTexto: string): boolean {
  let conteudo: unknown;
  try {
    conteudo = JSON.parse(conteudoTexto);
  } catch {
    return false;
  }
  if (conteudo === null || typeof conteudo !== 'object' || Array.isArray(conteudo)) return false;

  const chaves = Object.keys(conteudo as Record<string, unknown>).sort();
  if (
    JSON.stringify(chaves) !==
    JSON.stringify(['campos_cadastrais_preenchidos', 'dados_atuais', 'mensagens_atuais'])
  ) {
    return false;
  }

  const objeto = conteudo as {
    mensagens_atuais: unknown;
    dados_atuais: unknown;
    campos_cadastrais_preenchidos: unknown;
  };
  if (JSON.stringify(objeto.mensagens_atuais) !== JSON.stringify([...PAYLOAD_SINTETICO_AUTORIZADO.mensagens_atuais])) {
    return false;
  }
  if (objeto.dados_atuais === null || typeof objeto.dados_atuais !== 'object' || Array.isArray(objeto.dados_atuais)) {
    return false;
  }
  if (Object.keys(objeto.dados_atuais as Record<string, unknown>).length !== 0) return false;

  return ehIndicadorCadastralAutorizado(objeto.campos_cadastrais_preenchidos);
}

// Array de NOMES canonicos, sem repeticao e sem nenhum outro valor. Um CPF
// ou um nome de paciente colocado aqui reprova, porque nao pertence ao
// conjunto fechado. Array vazio e valido (nenhum campo preenchido).
function ehIndicadorCadastralAutorizado(indicadores: unknown): boolean {
  if (!Array.isArray(indicadores)) return false;

  const vistos = new Set<string>();
  for (const indicador of indicadores) {
    if (typeof indicador !== 'string') return false;
    if (!INDICADORES_CADASTRAIS_CANONICOS.includes(indicador)) return false;
    if (vistos.has(indicador)) return false;
    vistos.add(indicador);
  }
  return true;
}

// Valida o array `input` INTEGRALMENTE -- nao usa .find() nem aceita a
// primeira ocorrencia de um role: exige exatamente dois itens, na ordem
// exata (system, depois user), cada um com exatamente as propriedades
// role/content, nenhum item adicional (mais uma mensagem system, mais uma
// user, assistant, developer, tool ou qualquer role desconhecido reprova
// so pelo tamanho ou pela posicao), o conteudo system EXATAMENTE igual a
// instrucaoSystemEsperada (recebida explicitamente, nunca de uma
// constante global), e o conteudo da mensagem user exatamente igual ao
// payload sintetico autorizado.
function ehInputAutorizado(input: unknown, instrucaoSystemEsperada: string): boolean {
  if (!Array.isArray(input)) return false;
  if (input.length !== 2) return false;
  if (!ehItemSystemValido(input[0], instrucaoSystemEsperada)) return false;
  if (!ehItemUserValido(input[1])) return false;
  return ehPayloadDeUsuarioAutorizado(input[1].content);
}

// Analisa o corpo da requisicao SOMENTE EM MEMORIA (nunca impresso nem
// persistido) e devolve so booleanos estruturais. `instrucaoSystemEsperada`
// e sempre recebida explicitamente pelo chamador (nunca lida de uma
// constante global nem recalculada aqui).
export function inspecionarCorpoRequisicao(corpoBruto: string, instrucaoSystemEsperada: string): InspecaoEstrutural {
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
  const payloadAutorizado = ehInputAutorizado(envelope.input, instrucaoSystemEsperada);

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
// falso, injetavel para teste) e a instrucaoSystemEsperada (recebida
// explicitamente, nunca de uma constante global) e devolve o wrapper mais
// funcoes de observacao -- nunca imprime nem persiste o que observa.
export function criarFetchComLimiteExterno(
  fetchSubjacente: typeof fetch,
  instrucaoSystemEsperada: string
): {
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
    ultimaInspecao = inspecionarCorpoRequisicao(corpoBruto, instrucaoSystemEsperada);

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
// falso, sem nenhuma chamada real. `instrucaoSystemEsperada` e sempre
// recebida explicitamente pelo chamador (executarPrincipal a calcula
// dentro do bloco protegido e passa adiante -- nunca recalculada aqui).
export async function executarUma(fetchSubjacente: typeof fetch, chaveApi: string, instrucaoSystemEsperada: string): Promise<Evidencia> {
  const { fetchWrapper, obterContadores, obterInspecao, obterStatusHttp } = criarFetchComLimiteExterno(fetchSubjacente, instrucaoSystemEsperada);

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

export function imprimirEvidencia(evidencia: Evidencia): void {
  // Unica saida deste runner -- somente o objeto sanitizado, nunca
  // payload, chave, corpo bruto ou headers.
  console.log(JSON.stringify(evidencia, null, 2));
}

const EVIDENCIA_CHAVE_AUSENTE: EvidenciaErro = {
  aprovado: false,
  categoria: null,
  codigo: 'chave_ausente',
  status_http: null,
  invocacoes_fetch: 0,
  chamadas_externas: 0,
  segunda_chamada_bloqueada: false,
  duracao_ms: 0,
};

// Usada quando obterInstrucaoSystemEsperada() lanca -- por exemplo, se
// INSTRUCOES_EXTRATOR deixar de conter a frase estrutural esperada
// exatamente uma vez. Nunca contem o erro original, a mensagem, o stack
// nem qualquer conteudo de instrucao -- so o codigo tecnico fixo abaixo.
// Bloqueia ANTES de qualquer possibilidade de chamada a rede ou ao
// adaptador (invocacoes_fetch/chamadas_externas ficam em 0).
const CODIGO_INSTRUCAO_SYSTEM_ESPERADA_INVALIDA = 'instrucao_system_esperada_invalida';

const EVIDENCIA_INSTRUCAO_SYSTEM_INVALIDA: EvidenciaErro = {
  aprovado: false,
  categoria: null,
  codigo: CODIGO_INSTRUCAO_SYSTEM_ESPERADA_INVALIDA,
  status_http: null,
  invocacoes_fetch: 0,
  chamadas_externas: 0,
  segunda_chamada_bloqueada: false,
  duracao_ms: 0,
};

const EVIDENCIA_ERRO_NAO_TRATADO: EvidenciaErro = {
  aprovado: false,
  categoria: null,
  codigo: 'erro_nao_tratado_no_runner',
  status_http: null,
  invocacoes_fetch: 0,
  chamadas_externas: 0,
  segunda_chamada_bloqueada: false,
  duracao_ms: 0,
};

// Dependencias explicitas do caminho principal -- todas injetaveis, para
// que o teste exercite exatamente o mesmo caminho que main() usa em
// execucao real, sem nunca tocar rede, ambiente ou console de verdade.
// obterInstrucaoSystemEsperada() e o UNICO lugar onde
// calcularInstrucaoSystemEsperada(INSTRUCOES_EXTRATOR) e chamada no
// caminho real -- nunca no escopo superior do modulo.
export interface DependenciasExecucaoPrincipal {
  fetchSubjacente: typeof fetch;
  obterChaveApi: () => string | undefined;
  obterInstrucaoSystemEsperada: () => string;
  saida: (evidencia: Evidencia) => void;
}

// Calcula a evidencia (nunca lanca) -- extraida para que executarPrincipal
// possa chamar dependencias.saida(evidencia) exatamente uma vez, sempre
// fora de qualquer bloco de captura.
async function calcularEvidencia(dependencias: DependenciasExecucaoPrincipal): Promise<Evidencia> {
  const chaveApi = dependencias.obterChaveApi();
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    return EVIDENCIA_CHAVE_AUSENTE;
  }

  // Calculada aqui, dentro do bloco protegido, ANTES de qualquer
  // possibilidade de chamada a rede ou ao adaptador. Se lancar (por
  // exemplo, a frase estrutural esperada ausente ou duplicada em
  // INSTRUCOES_EXTRATOR), nem fetch nem o adaptador chegam a ser
  // chamados -- so a evidencia sanitizada de baixo, sem o erro original,
  // sem mensagem, sem stack, sem conteudo de instrucao.
  let instrucaoSystemEsperada: string;
  try {
    instrucaoSystemEsperada = dependencias.obterInstrucaoSystemEsperada();
  } catch {
    return EVIDENCIA_INSTRUCAO_SYSTEM_INVALIDA;
  }

  return executarUma(dependencias.fetchSubjacente, chaveApi, instrucaoSystemEsperada);
}

// Funcao principal testavel: le a chave e a instrucao system esperada (via
// dependencias injetaveis), executa uma tentativa e imprime (via saida
// injetavel) exatamente uma evidencia sanitizada. Nunca aceita payload
// externo nem chave por argumento -- essas garantias continuam fixas no
// proprio codigo (PAYLOAD_SINTETICO_AUTORIZADO, e obterChaveApi so pode
// vir da variavel de ambiente em producao real). Devolve o codigo de
// saida (0 == aprovado).
//
// Estrutura deliberada: a evidencia (e o codigo de saida associado) e
// calculada INTEIRAMENTE dentro do bloco protegido -- o try/catch cobre
// somente calcularEvidencia (leitura da chave, calculo da instrucao
// system esperada e a execucao), nunca a propria chamada de saida.
// dependencias.saida(evidencia) roda UMA UNICA VEZ, fora desse bloco: se
// ela propria lancar, o erro escapa direto para quem chamou
// executarPrincipal, sem ser reinterpretado como falha de execucao e sem
// nenhuma segunda tentativa de impressao.
export async function executarPrincipal(dependencias: DependenciasExecucaoPrincipal): Promise<number> {
  let evidencia: Evidencia;
  try {
    evidencia = await calcularEvidencia(dependencias);
  } catch {
    // Nunca loga o erro capturado aqui -- pode conter stack, mensagem do
    // provedor ou qualquer outro contexto sensivel. So o codigo fixo e
    // sanitizado e usado.
    evidencia = EVIDENCIA_ERRO_NAO_TRATADO;
  }

  dependencias.saida(evidencia);
  return evidencia.aprovado ? 0 : 1;
}

// Dependencias do caminho exato que main() delega: uma chamada ja
// vinculada a executarPrincipal (chamarExecutarPrincipal) e uma funcao
// para registrar o codigo de saida (definirCodigoSaida) -- nenhuma delas
// toca process.exitCode diretamente, entao o teste pode exercitar
// exatamente esse caminho sem depender do processo real.
export interface DependenciasCaminhoMain {
  chamarExecutarPrincipal: () => Promise<number>;
  definirCodigoSaida: (codigo: number) => void;
}

// Representa exatamente o que main() faz: chama executarPrincipal e
// define o codigo de saida com o valor resolvido; se a promessa rejeitar
// (unico jeito disso acontecer e a propria funcao de saida ter lancado,
// ja que executarPrincipal nunca rejeita por conta propria), define
// codigo de saida 1, sem tentar chamar a saida de novo, sem imprimir o
// erro nem o stack, e sem iniciar nenhuma nova chamada de rede.
export async function executarCaminhoMain(dependencias: DependenciasCaminhoMain): Promise<void> {
  try {
    const codigo = await dependencias.chamarExecutarPrincipal();
    dependencias.definirCodigoSaida(codigo);
  } catch {
    dependencias.definirCodigoSaida(1);
  }
}

// main() e so um adaptador minimo da execucao direta: liga
// executarCaminhoMain as dependencias reais (fetch global,
// IRIS_EVAL_OPENAI_API_KEY, o calculo oficial da instrucao system,
// console.log via imprimirEvidencia, e process.exitCode) -- toda a logica
// testavel vive em executarCaminhoMain/executarPrincipal/executarUma.
async function main(): Promise<void> {
  await executarCaminhoMain({
    chamarExecutarPrincipal: () =>
      executarPrincipal({
        fetchSubjacente: fetch,
        obterChaveApi: () => process.env.IRIS_EVAL_OPENAI_API_KEY,
        obterInstrucaoSystemEsperada: () => calcularInstrucaoSystemEsperada(INSTRUCOES_EXTRATOR),
        saida: imprimirEvidencia,
      }),
    definirCodigoSaida: (codigo) => {
      process.exitCode = codigo;
    },
  });
}

// So dispara main() quando este arquivo e executado diretamente (node
// src/eval/execucao-real-sintetica-adaptador-openai.ts) -- nunca quando e
// importado (por exemplo, pelo proprio arquivo de teste deste runner).
const ehExecucaoDireta = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (ehExecucaoDireta) {
  void main();
}
