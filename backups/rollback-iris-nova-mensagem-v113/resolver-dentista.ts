import { EntradaInvalidaError } from './erros.ts';
import type {
  DentistaApto,
  DentistaOficial,
  EntradaResolucaoDentista,
  ResultadoResolucaoDentista,
  VinculoDentistaProcedimento,
} from './dentista-tipos.ts';

/**
 * Calculadora deterministica de APTIDAO de dentistas
 * (specs/dentistas-vinculos-v1.md secao 5).
 *
 * Recebe um `procedimento_id` JA RESOLVIDO oficialmente -- nunca re-resolve
 * procedimento, nunca aceita nome de procedimento.
 *
 * Fluxo unico desde 2026-08-09 (specs/dentista-semantico-v1.md):
 *
 *   vinculos ativos do procedimento na clinica
 *     -> dentistas aptos (0, 1 ou N)
 *     -> nenhum apto | um apto | varios aptos | erro de identidade
 *
 * O FLUXO DE PREFERENCIA FOI REMOVIDO. `resolverPorPreferencia` (match exato
 * contra `nome_completo_resolucao`/`nome_curto_resolucao`) e a recursao de
 * fallback do orquestrador nao existem mais: a preferencia do paciente chega
 * como `dentista_id`, ja resolvido semanticamente pela interpretadora, e e
 * conferida no orquestrador -- identidade, clinica, ativo e vinculo. A secao
 * 6 da spec ("entradas de resolucao, exatamente duas", match exato,
 * colisoes) foi revogada. A proibicao de fuzzy matching CONTINUA valendo
 * para o Core: o que mudou e que o Core deixou de comparar texto, nao que
 * passou a compara-lo de forma aproximada.
 *
 * Funcao pura: nao chama IA, nao acessa banco, nao acessa calendario, nao
 * calcula duracao, nao calcula disponibilidade, nao cria agendamento, nao
 * altera estado.
 *
 * **Aptidao exige tres eixos simultaneos** (secao 3): dentista ativo,
 * vinculo ativo, e (implicitamente, pela entrada) procedimento ja oficial.
 * Nenhum atalho entre eixos, nenhuma inferencia por especialidade, nome ou
 * historico (secao 7).
 *
 * **Nunca escolhe entre varios aptos.** Zero, um ou N aptos sao devolvidos
 * tal qual calculados -- nenhum criterio silencioso de desempate (secao 5).
 *
 * **Nunca escolhe Consulta/Avaliacao.** `nenhum_apto` e devolvido puro; a
 * avaliacao do fallback (secao 12) pertence ao controlador.
 *
 * Lanca `EntradaInvalidaError` somente para violacao de contrato de entrada
 * (tipo errado). Catalogo estruturalmente invalido NAO e excecao: e o
 * resultado tipado `erro_catalogo`.
 */
export function resolverDentista(entrada: EntradaResolucaoDentista): ResultadoResolucaoDentista {
  validarFormaEntrada(entrada);

  // Isolamento multiclinica ANTES de qualquer comparacao: registros de
  // outra clinica sao simplesmente ignorados -- dado legitimo de outra
  // clinica, nao erro (docs/03-seguranca.md; secao 11).
  const dentistasDaClinica = entrada.dentistas.filter((d) => d.clinica_id === entrada.clinica_id);
  // Vinculos em escopo desta consulta: da clinica corrente E do
  // procedimento oficial recebido (secao 4, quinto ponto). Um vinculo de
  // outro procedimento ou de outra clinica nunca influencia este resultado.
  const vinculosDoProcedimento = entrada.vinculos.filter(
    (v) => v.clinica_id === entrada.clinica_id && v.procedimento_id === entrada.procedimento_id
  );

  return calcularAptidao(dentistasDaClinica, vinculosDoProcedimento);
}

// --- Calculo de aptidao ---

function calcularAptidao(
  dentistasDaClinica: readonly DentistaOficial[],
  vinculosDoProcedimento: readonly VinculoDentistaProcedimento[]
): ResultadoResolucaoDentista {
  // REMOVIDO em 2026-08-09: `validarConsistenciaDeVinculos`, que detectava a
  // mesma chave (clinica, dentista, procedimento) com `ativo` divergente. O
  // unico produtor de catalogo em producao (carregar-catalogo.ts) empurra
  // SEMPRE `ativo: true`, entao a divergencia era inalcancavel -- ver
  // dentista-tipos.ts, CodigoErroCatalogoDentista.
  const idsComVinculoAtivo = ordenarEstavel([
    ...new Set(vinculosDoProcedimento.filter((v) => v.ativo).map((v) => v.dentista_id)),
  ]);

  const aptos: DentistaApto[] = [];
  for (const id of idsComVinculoAtivo) {
    const resolucao = resolverIdentidadeDentista(id, dentistasDaClinica);
    if ('erro' in resolucao) return resolucao.erro;
    // Dentista inativo nao conta, mas nao e erro -- so exclusao (secao 3).
    if (resolucao.dentista.ativo) {
      aptos.push(projetarApto(resolucao.dentista));
    }
  }

  if (aptos.length === 0) return { tipo: 'nenhum_apto' };
  if (aptos.length === 1) return { tipo: 'um_apto', dentista: aptos[0] };
  return { tipo: 'varios_aptos', dentistas: aptos };
}

// --- Resolucao de identidade por dentista_id ---

type ResolucaoIdentidade = { dentista: DentistaOficial } | { erro: ResultadoResolucaoDentista };

/**
 * Resolve um `dentista_id` especifico dentro da clinica, validando
 * consistencia de identidade -- escopado SOMENTE a esse id (nunca ao
 * catalogo inteiro), mesma licao da correcao 0143: uma inconsistencia em
 * dentista nao relacionado ao resultado atual nunca bloqueia esta resolucao.
 *
 * O parametro `todosDentistas` foi REMOVIDO em 2026-08-09: existia so para
 * distinguir `vinculo_clinica_divergente` de `vinculo_orfao`, e os dois
 * codigos eram inalcancaveis (carregar-catalogo.ts monta dentista e vinculo
 * no mesmo laco, com os mesmos identificadores). `registros.length === 0`
 * continua tratado, nunca como excecao nao tratada, mas colapsado no unico
 * codigo que sobrou.
 */
function resolverIdentidadeDentista(
  dentista_id: string,
  dentistasDaClinica: readonly DentistaOficial[]
): ResolucaoIdentidade {
  const registros = dentistasDaClinica.filter((d) => d.dentista_id === dentista_id);

  if (registros.length === 0) {
    return { erro: { tipo: 'erro_catalogo', codigo: 'dentista_id_inconsistente', dentista_ids: [dentista_id] } };
  }

  const erroDeIdentidade = validarConsistenciaDeIdentidade(registros);
  if (erroDeIdentidade) return { erro: erroDeIdentidade };

  return { dentista: registros[0] };
}

// --- Consistencia estrutural ---

/**
 * Mesmo `dentista_id` com conteudo divergente: duplicatas byte a byte sao
 * aceitas (deduplicadas), divergentes nao. O CHAMADOR restringe `registros`
 * ao(s) id(s) que a resolucao atual efetivamente precisa.
 */
function validarConsistenciaDeIdentidade(
  registros: readonly DentistaOficial[]
): ResultadoResolucaoDentista | null {
  const primeiro = registros[0];
  for (const atual of registros) {
    if (!mesmoConteudoDentista(primeiro, atual)) {
      return {
        tipo: 'erro_catalogo',
        codigo: 'dentista_id_inconsistente',
        dentista_ids: [primeiro.dentista_id],
      };
    }
  }
  return null;
}

// --- Auxiliares ---

function mesmoConteudoDentista(a: DentistaOficial, b: DentistaOficial): boolean {
  return a.clinica_id === b.clinica_id && a.nome_exibido === b.nome_exibido && a.ativo === b.ativo;
}

function projetarApto(d: DentistaOficial): DentistaApto {
  return { dentista_id: d.dentista_id, clinica_id: d.clinica_id, nome_exibido: d.nome_exibido };
}

// Ordenacao estavel por codigo de unidade: o resultado nao pode depender da
// ordem em que dentistas ou vinculos chegaram.
function ordenarEstavel(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// --- Validacao de forma da entrada ---

const CHAVES_ENTRADA = ['clinica_id', 'procedimento_id', 'dentistas', 'vinculos'] as const;

function validarFormaEntrada(entrada: unknown): asserts entrada is EntradaResolucaoDentista {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new EntradaInvalidaError('entrada', 'entrada deve ser um objeto');
  }

  // Entrada fechada: nenhuma propriedade adicional. O nome da propriedade
  // desconhecida nunca e reproduzido no erro -- poderia carregar PII.
  const chaves = Object.keys(entrada as Record<string, unknown>);
  const esperadas: readonly string[] = CHAVES_ENTRADA;
  if (chaves.length !== esperadas.length || !esperadas.every((chave) => chaves.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada contem propriedade nao permitida');
  }

  const { clinica_id, procedimento_id, dentistas, vinculos } = entrada as Record<string, unknown>;

  // `clinica_id` vem da instancia autenticada, nunca da IA ou do paciente.
  if (typeof clinica_id !== 'string' || clinica_id.trim() === '') {
    throw new EntradaInvalidaError('clinica_id', 'clinica_id deve ser uma string nao vazia');
  }
  // `procedimento_id` ja foi resolvido oficialmente antes desta chamada --
  // aqui so garantimos que existe; nunca re-resolvido a partir de texto.
  if (typeof procedimento_id !== 'string' || procedimento_id.trim() === '') {
    throw new EntradaInvalidaError('procedimento_id', 'procedimento_id deve ser uma string nao vazia');
  }
  if (!Array.isArray(dentistas)) {
    throw new EntradaInvalidaError('dentistas', 'dentistas deve ser um array');
  }
  if (!Array.isArray(vinculos)) {
    throw new EntradaInvalidaError('vinculos', 'vinculos deve ser um array');
  }
}
