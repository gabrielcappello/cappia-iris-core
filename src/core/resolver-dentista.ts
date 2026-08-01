import { EntradaInvalidaError } from './erros.ts';
import { normalizarTextoCanonico, textoAusenteParaResolucao } from './normalizacao-texto.ts';
import type {
  DentistaApto,
  DentistaOficial,
  EntradaResolucaoDentista,
  ResultadoResolucaoDentista,
  VinculoDentistaProcedimento,
} from './dentista-tipos.ts';

/**
 * Resolvedor deterministico de dentistas e vinculos
 * (specs/dentistas-vinculos-v1.md).
 *
 * Recebe um `procedimento_id` JA RESOLVIDO oficialmente (pelo resolvedor de
 * procedimento) -- nunca re-resolve procedimento, nunca aceita nome de
 * procedimento.
 *
 * Dois fluxos deterministicos, nunca misturados na mesma chamada:
 *
 *   preferencia informada -> normalizacao fechada
 *                          -> match EXATO contra nome completo/curto
 *                          -> dentista preferido apto | nao encontrado
 *                             | nao apto | erro de catalogo
 *
 *   sem preferencia       -> vinculos ativos do procedimento na clinica
 *                          -> dentistas aptos (0, 1 ou N)
 *                          -> nenhum apto | um apto | varios aptos
 *                             | erro de vinculo/identidade
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
 * (tipo errado). Catalogo/vinculo estruturalmente invalido NAO e excecao: e
 * o resultado tipado `erro_catalogo`.
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

  if (!textoAusenteParaResolucao(entrada.dentista_texto)) {
    return resolverPorPreferencia(
      entrada.dentista_texto as string,
      dentistasDaClinica,
      entrada.dentistas,
      vinculosDoProcedimento
    );
  }

  // Ausencia de preferencia: reaplica diretamente a regra de zero/um/varios
  // aptos (secao 5). Ausencia de preferencia NUNCA equivale a aceitar
  // qualquer profissional (secao 4) -- essa e uma autorizacao distinta,
  // fora do escopo deste resolvedor.
  return calcularAptidao(dentistasDaClinica, entrada.dentistas, vinculosDoProcedimento);
}

// --- Fluxo com preferencia textual ---

function resolverPorPreferencia(
  textoBruto: string,
  dentistasDaClinica: readonly DentistaOficial[],
  todosDentistas: readonly DentistaOficial[],
  vinculosDoProcedimento: readonly VinculoDentistaProcedimento[]
): ResultadoResolucaoDentista {
  const textoNormalizado = normalizarTextoCanonico(textoBruto);

  // Match exato contra nome completo OU nome curto (secao 6). Nenhuma
  // transformacao alem das quatro ja aprovadas -- sem titulo, sem
  // pontuacao, sem fuzzy matching, sem contains/startsWith.
  const candidatos = dentistasDaClinica.filter(
    (d) =>
      normalizarTextoCanonico(d.nome_completo_resolucao) === textoNormalizado ||
      (d.nome_curto_resolucao !== null &&
        normalizarTextoCanonico(d.nome_curto_resolucao) === textoNormalizado)
  );

  // IDs distintos correspondentes -- deduplicado: um dentista que case por
  // nome completo E nome curto simultaneamente (mesmo texto) nao conta
  // duas vezes.
  const idsCorrespondentes = ordenarEstavel([...new Set(candidatos.map((d) => d.dentista_id))]);

  if (idsCorrespondentes.length === 0) {
    return { tipo: 'preferencia_nao_encontrada' };
  }

  // Ambiguidade tem precedencia sobre qualquer validacao de identidade
  // (mesma correcao 0145 aplicada ao resolvedor de procedimento): duas ou
  // mais entradas de resolucao normalizadas identicas apontando para
  // dentistas distintos e SEMPRE `nome_resolucao_ambiguo`, com todos os
  // IDs -- verificado ANTES de examinar o conteudo de qualquer candidato,
  // o que garante determinismo independente da ordem de entrada.
  if (idsCorrespondentes.length > 1) {
    return { tipo: 'erro_catalogo', codigo: 'nome_resolucao_ambiguo', dentista_ids: idsCorrespondentes };
  }

  const idUnico = idsCorrespondentes[0];
  const resolucao = resolverIdentidadeDentista(idUnico, dentistasDaClinica, todosDentistas);
  if ('erro' in resolucao) return resolucao.erro;
  const dentista = resolucao.dentista;

  // Dentista inativo: mesmo tratamento operacional de "nao apto", com
  // motivo interno distinto para auditoria (secao 4). Nunca revela ao
  // paciente que o cadastro existe mas esta inativo.
  if (!dentista.ativo) {
    return { tipo: 'preferencia_nao_apta', dentista: projetarApto(dentista), motivo: 'dentista_inativo' };
  }

  // Vinculos desse dentista especifico com o procedimento, na clinica.
  // Consistencia verificada ANTES de filtrar por ativo -- senao uma
  // divergencia exatamente no campo `ativo` nunca seria detectavel.
  const vinculosDoDentista = vinculosDoProcedimento.filter((v) => v.dentista_id === idUnico);
  const erroDeVinculo = validarConsistenciaDeVinculos(vinculosDoDentista);
  if (erroDeVinculo) return erroDeVinculo;

  if (vinculosDoDentista.length === 0) {
    return { tipo: 'preferencia_nao_apta', dentista: projetarApto(dentista), motivo: 'sem_vinculo' };
  }
  if (!vinculosDoDentista.some((v) => v.ativo)) {
    return { tipo: 'preferencia_nao_apta', dentista: projetarApto(dentista), motivo: 'vinculo_inativo' };
  }

  return { tipo: 'preferencia_apta', dentista: projetarApto(dentista) };
}

// --- Fluxo sem preferencia: calculo de aptidao ---

function calcularAptidao(
  dentistasDaClinica: readonly DentistaOficial[],
  todosDentistas: readonly DentistaOficial[],
  vinculosDoProcedimento: readonly VinculoDentistaProcedimento[]
): ResultadoResolucaoDentista {
  // Consistencia de vinculos verificada sobre o conjunto INTEIRO em escopo
  // (clinica + procedimento), antes de filtrar por ativo -- mesma razao do
  // fluxo de preferencia.
  const erroDeVinculo = validarConsistenciaDeVinculos(vinculosDoProcedimento);
  if (erroDeVinculo) return erroDeVinculo;

  const idsComVinculoAtivo = ordenarEstavel([
    ...new Set(vinculosDoProcedimento.filter((v) => v.ativo).map((v) => v.dentista_id)),
  ]);

  const aptos: DentistaApto[] = [];
  for (const id of idsComVinculoAtivo) {
    const resolucao = resolverIdentidadeDentista(id, dentistasDaClinica, todosDentistas);
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
 * consistencia de identidade e integridade referencial -- escopado SOMENTE
 * a esse id (nunca ao catalogo inteiro), mesma licao da correcao 0143: uma
 * inconsistencia em dentista nao relacionado ao resultado atual nunca
 * bloqueia esta resolucao.
 */
function resolverIdentidadeDentista(
  dentista_id: string,
  dentistasDaClinica: readonly DentistaOficial[],
  todosDentistas: readonly DentistaOficial[]
): ResolucaoIdentidade {
  const registros = dentistasDaClinica.filter((d) => d.dentista_id === dentista_id);

  if (registros.length === 0) {
    // Vinculo (ou preferencia ja resolvida) aponta para um dentista_id que
    // nao existe nesta clinica. Existe em OUTRA clinica -> referencia
    // cruzada (secao 2, secao 11); nao existe em lugar nenhum -> orfao.
    const existeEmOutraClinica = todosDentistas.some((d) => d.dentista_id === dentista_id);
    return {
      erro: {
        tipo: 'erro_catalogo',
        codigo: existeEmOutraClinica ? 'vinculo_clinica_divergente' : 'vinculo_orfao',
        dentista_ids: [dentista_id],
      },
    };
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

/**
 * Mesma chave (clinica_id, dentista_id, procedimento_id) com `ativo`
 * divergente entre registros de vinculo -- "vinculo duplicado
 * estruturalmente inconsistente". Verificada sobre o conjunto de vinculos
 * ja escopado pelo chamador (clinica + procedimento, e quando aplicavel,
 * dentista especifico) -- nunca sobre a tabela inteira de vinculos.
 *
 * Correcao 0150: percorre o conjunto INTEIRO antes de decidir, agregando em
 * um `Set` todos os `dentista_id` cuja chave tiver divergencia -- nunca
 * retorna na primeira encontrada. Retornar cedo faria o resultado depender
 * da ordem de entrada quando mais de uma chave estivesse inconsistente
 * (duas ordens diferentes reportariam IDs diferentes para o mesmo
 * catalogo, o que quebra determinismo). Com a analise completa, o mesmo
 * conjunto de vinculos sempre produz o mesmo conjunto de IDs, em qualquer
 * ordem de entrada -- inclusive na ordem interna dos registros de cada
 * chave.
 */
function validarConsistenciaDeVinculos(
  vinculos: readonly VinculoDentistaProcedimento[]
): ResultadoResolucaoDentista | null {
  const porChave = new Map<string, VinculoDentistaProcedimento>();
  const idsInconsistentes = new Set<string>();

  for (const vinculo of vinculos) {
    const chave = `${vinculo.clinica_id}::${vinculo.dentista_id}::${vinculo.procedimento_id}`;
    const anterior = porChave.get(chave);
    if (anterior && anterior.ativo !== vinculo.ativo) {
      idsInconsistentes.add(vinculo.dentista_id);
    }
    porChave.set(chave, vinculo);
  }

  if (idsInconsistentes.size === 0) return null;

  return {
    tipo: 'erro_catalogo',
    codigo: 'vinculo_inconsistente',
    dentista_ids: ordenarEstavel([...idsInconsistentes]),
  };
}

// --- Auxiliares ---

function mesmoConteudoDentista(a: DentistaOficial, b: DentistaOficial): boolean {
  return (
    a.clinica_id === b.clinica_id &&
    a.nome_exibido === b.nome_exibido &&
    a.nome_completo_resolucao === b.nome_completo_resolucao &&
    a.nome_curto_resolucao === b.nome_curto_resolucao &&
    a.ativo === b.ativo
  );
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

const CHAVES_ENTRADA = ['clinica_id', 'procedimento_id', 'dentista_texto', 'dentistas', 'vinculos'] as const;

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
