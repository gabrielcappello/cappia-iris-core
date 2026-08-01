import { EntradaInvalidaError } from './erros.ts';
import { normalizarTextoCanonico, textoAusenteParaResolucao } from './normalizacao-texto.ts';
import type {
  AliasProcedimento,
  EntradaResolucaoProcedimento,
  ProcedimentoOficial,
  ResultadoResolucaoProcedimento,
} from './procedimento-tipos.ts';

/**
 * Resolvedor deterministico de procedimento (specs/procedimentos-v1.md).
 *
 * Fluxo canonico da secao 3:
 *
 *     procedimento_texto -> normalizacao fechada (secao 4)
 *                        -> match EXATO contra aliases da clinica corrente
 *                        -> procedimento_id | nao resolvido | erro de catalogo
 *
 * Funcao pura: nao chama IA, nao acessa banco, nao acessa calendario, nao
 * cria efeito, nao altera estado, nao escolhe dentista, nao calcula duracao
 * e nao calcula disponibilidade.
 *
 * **A correspondencia e por ALIAS, nunca pelo nome exibido.** A secao 1
 * fixa que "a Iris nunca identifica procedimento pelo nome exibido", e a
 * secao 2 define procedimento resolvivel como aquele que "possui alias
 * correspondente ao texto normalizado". Para o nome oficial resolver, ele
 * precisa estar cadastrado como alias no seed (secao 5) -- o que e o caso
 * normal. `nome_pt` viaja no resultado apenas para apresentacao e snapshot.
 *
 * **Nunca escolhe Consulta/Avaliacao.** O marcador `eh_consulta_avaliacao`
 * e devolvido como propriedade do procedimento resolvido, mas a oferta de
 * Consulta/Avaliacao como alternativa pertence ao controlador e as regras
 * de aptidao (secao 8), nunca a este resolvedor.
 *
 * Lanca `EntradaInvalidaError` somente para violacao de contrato de entrada
 * (tipo errado). Catalogo estruturalmente invalido NAO e excecao: e o
 * resultado tipado `erro_catalogo`.
 */
export function resolverProcedimento(
  entrada: EntradaResolucaoProcedimento
): ResultadoResolucaoProcedimento {
  validarFormaEntrada(entrada);

  // O texto ausente (IA omitiu em duvida real) resolve como nao resolvido,
  // nunca como erro (secao 6).
  if (textoAusenteParaResolucao(entrada.procedimento_texto)) {
    return { tipo: 'nao_resolvido', motivo: 'texto_ausente' };
  }
  const textoNormalizado = normalizarTextoCanonico(entrada.procedimento_texto as string);

  // Isolamento multiclinica ANTES de qualquer comparacao: registros de
  // outra clinica sao simplesmente ignorados -- sao dado legitimo de outra
  // clinica, nao erro (docs/03-seguranca.md; secao 1).
  const catalogoDaClinica = entrada.catalogo.filter((p) => p.clinica_id === entrada.clinica_id);
  const aliasesDaClinica = entrada.aliases.filter((a) => a.clinica_id === entrada.clinica_id);

  // --- Correspondencia exata, apos normalizacao (secao 3) ---
  const candidatos = aliasesDaClinica.filter(
    (a) => normalizarTextoCanonico(a.texto) === textoNormalizado
  );
  if (candidatos.length === 0) {
    return { tipo: 'nao_resolvido', motivo: 'sem_correspondencia' };
  }

  // Somente aliases ativos participam da resolucao (secao 2).
  const candidatosAtivos = candidatos.filter((a) => a.ativo);
  if (candidatosAtivos.length === 0) {
    return { tipo: 'nao_resolvido', motivo: 'alias_inativo' };
  }

  // IDs efetivamente apontados pelo(s) alias(es) correspondente(s) -- so a
  // partir daqui sabemos QUAIS identidades esta resolucao precisa. Dedu-
  // plicado: aliases distintos apontando pro mesmo procedimento nao contam
  // duas vezes.
  const idsDistintos = ordenarEstavel([...new Set(candidatosAtivos.map((a) => a.procedimento_id))]);

  // --- Ambiguidade tem precedencia sobre qualquer validacao de identidade ---
  // Correcao 0145: com dois ou mais IDs distintos correspondentes, o
  // resultado e SEMPRE `alias_ambiguo`, com todos os IDs -- mesmo que um ou
  // ambos os procedimentos tambem tenham identidade internamente
  // contraditoria. Verificar isso ANTES de qualquer validacao por-ID e o
  // que garante determinismo: examinar so um dos dois IDs contraditorios
  // primeiro (e reportar so aquele) dependia da ordem do catalogo, que e
  // exatamente o que a secao 6 proibe ("mais de 1 match... e erro de
  // catalogo/seed... o runtime nunca escolhe"). A ambiguidade por si so ja
  // impede a resolucao; o conteudo interno de cada candidato e irrelevante
  // para esse resultado.
  if (idsDistintos.length > 1) {
    return { tipo: 'erro_catalogo', codigo: 'alias_ambiguo', procedimento_ids: idsDistintos };
  }

  // --- Consistencia de identidade, restrita ao unico ID correspondente ---
  // Correcao 0143: a validacao NAO percorre mais o catalogo inteiro da
  // clinica. Uma identidade contraditoria em procedimento nao relacionado
  // ao texto pedido (ex.: "proc-implante" duplicado enquanto o paciente
  // pediu "limpeza") nunca bloqueia esta resolucao -- so falha fechado
  // quando a identidade CONTRADITORIA e a do unico ID que o proprio alias
  // correspondente aponta, porque so entao o `nome_pt`/`eh_consulta_
  // avaliacao` que sairiam no resultado desta chamada ficam nao confiaveis.
  const registrosCorrespondentes = catalogoDaClinica.filter((p) =>
    idsDistintos.includes(p.procedimento_id)
  );
  const erroDeIdentidade = validarConsistenciaDeIdentidade(registrosCorrespondentes);
  if (erroDeIdentidade) return erroDeIdentidade;

  // --- Integridade referencial dos aliases que casaram ---
  const erroDeVinculo = validarVinculoDosCandidatos(candidatosAtivos, catalogoDaClinica, entrada.catalogo);
  if (erroDeVinculo) return erroDeVinculo;

  const procedimento = catalogoDaClinica.find((p) => p.procedimento_id === idsDistintos[0]);
  // Garantido pela validacao de vinculo acima; guarda defensiva explicita.
  if (!procedimento) {
    return { tipo: 'erro_catalogo', codigo: 'alias_orfao', procedimento_ids: idsDistintos };
  }

  // Procedimento inativo nunca resolve, mesmo com alias ativo
  // correspondente (secao 2). Nunca revela ao paciente que existe.
  if (!procedimento.ativo) {
    return { tipo: 'nao_resolvido', motivo: 'procedimento_inativo' };
  }

  return {
    tipo: 'resolvido',
    procedimento_id: procedimento.procedimento_id,
    clinica_id: procedimento.clinica_id,
    nome_pt: procedimento.nome_pt,
    eh_consulta_avaliacao: procedimento.eh_consulta_avaliacao,
    alias_normalizado: textoNormalizado,
  };
}

// --- Consistencia de identidade ---

/**
 * Mesmo `procedimento_id` com conteudo divergente: duplicatas byte a byte
 * sao aceitas (deduplicadas), divergentes nao.
 *
 * O CHAMADOR e responsavel por restringir `registros` aos IDs que a
 * resolucao atual efetivamente precisa (correcao 0143) -- esta funcao so
 * compara o que recebe, nunca varre o catalogo inteiro por conta propria.
 * Isso e o que garante que uma inconsistencia em procedimento nao
 * relacionado ao texto pedido nunca bloqueia esta resolucao.
 *
 * Determinismo: para um mesmo conjunto de IDs, o resultado (codigo +
 * `procedimento_ids`) e igual independentemente da ordem dos registros de
 * entrada -- a primeira divergencia encontrada na iteracao sempre aponta
 * para o mesmo `procedimento_id` contraditorio.
 *
 * Este resolvedor NAO valida a unicidade de `eh_consulta_avaliacao` por
 * clinica. Essa regra de produto (secao 8) continua valendo, mas nao
 * pertence a resolucao `texto -> procedimento_id`: bloquear a busca por
 * "limpeza" porque existem duas Consultas/Avaliacoes no catalogo excederia
 * a responsabilidade canonica do resolvedor. A duplicidade falhara fechado
 * no componente que avaliar o fallback de Consulta/Avaliacao, quando essa
 * etapa for autorizada.
 */
function validarConsistenciaDeIdentidade(
  registros: readonly ProcedimentoOficial[]
): ResultadoResolucaoProcedimento | null {
  const porId = new Map<string, ProcedimentoOficial>();
  for (const procedimento of registros) {
    const anterior = porId.get(procedimento.procedimento_id);
    if (anterior && !mesmoConteudo(anterior, procedimento)) {
      return {
        tipo: 'erro_catalogo',
        codigo: 'procedimento_id_inconsistente',
        procedimento_ids: [procedimento.procedimento_id],
      };
    }
    porId.set(procedimento.procedimento_id, procedimento);
  }

  return null;
}

// --- Integridade referencial dos aliases que casaram ---

function validarVinculoDosCandidatos(
  candidatosAtivos: readonly AliasProcedimento[],
  catalogoDaClinica: readonly ProcedimentoOficial[],
  catalogoCompleto: readonly ProcedimentoOficial[]
): ResultadoResolucaoProcedimento | null {
  const idsDaClinica = new Set(catalogoDaClinica.map((p) => p.procedimento_id));

  for (const alias of ordenarCandidatos(candidatosAtivos)) {
    if (idsDaClinica.has(alias.procedimento_id)) continue;

    // O alias pertence a esta clinica mas aponta para um procedimento que
    // nao esta no catalogo dela. Se o alvo existe em OUTRA clinica, e
    // referencia cruzada (proibida pela secao 1); se nao existe em lugar
    // nenhum, e alias orfao. Em ambos os casos: erro, nunca resolucao.
    const existeEmOutraClinica = catalogoCompleto.some(
      (p) => p.procedimento_id === alias.procedimento_id
    );
    return {
      tipo: 'erro_catalogo',
      codigo: existeEmOutraClinica ? 'alias_clinica_divergente' : 'alias_orfao',
      procedimento_ids: [alias.procedimento_id],
    };
  }

  return null;
}

// --- Auxiliares ---

function mesmoConteudo(a: ProcedimentoOficial, b: ProcedimentoOficial): boolean {
  return (
    a.clinica_id === b.clinica_id &&
    a.nome_pt === b.nome_pt &&
    a.ativo === b.ativo &&
    a.eh_consulta_avaliacao === b.eh_consulta_avaliacao
  );
}

// Ordenacao estavel por codigo de unidade: o resultado nao pode depender da
// ordem em que catalogo e aliases chegaram.
function ordenarEstavel(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function ordenarCandidatos(candidatos: readonly AliasProcedimento[]): AliasProcedimento[] {
  return [...candidatos].sort((a, b) =>
    a.procedimento_id < b.procedimento_id ? -1 : a.procedimento_id > b.procedimento_id ? 1 : 0
  );
}

// --- Validacao de forma da entrada ---

const CHAVES_ENTRADA = ['clinica_id', 'procedimento_texto', 'catalogo', 'aliases'] as const;

function validarFormaEntrada(entrada: unknown): asserts entrada is EntradaResolucaoProcedimento {
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

  const { clinica_id, catalogo, aliases } = entrada as Record<string, unknown>;

  // `clinica_id` vem da instancia autenticada e nunca da IA. Aqui so
  // garantimos que existe: o formato e opaco por decisao da spec (secao 1).
  if (typeof clinica_id !== 'string' || clinica_id.trim() === '') {
    throw new EntradaInvalidaError('clinica_id', 'clinica_id deve ser uma string nao vazia');
  }
  if (!Array.isArray(catalogo)) {
    throw new EntradaInvalidaError('catalogo', 'catalogo deve ser um array');
  }
  if (!Array.isArray(aliases)) {
    throw new EntradaInvalidaError('aliases', 'aliases deve ser um array');
  }
}
