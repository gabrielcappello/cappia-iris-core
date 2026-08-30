import { EntradaInvalidaError } from './erros.ts';
import type {
  EntradaResolucaoDuracao,
  MotivoDuracaoInvalida,
  ResultadoResolucaoDuracao,
} from './duracao-tipos.ts';

/** Limites canonicos da secao 2. Nenhum limite adicional inventado. */
const DURACAO_MINIMA_MIN = 10;
const DURACAO_MAXIMA_MIN = 240;
const BLOCO_MIN = 10;

/**
 * Resolvedor deterministico de duracao (specs/duracao-v1.md).
 *
 * Fonte oficial (secao 1, revisada em 30/08/2026):
 *
 *     clinica_id + dentista_id + procedimento_id = duracao_min
 *
 * A DURACAO PERTENCE AO DENTISTA ESCOLHIDO: a chave SEMPRE inclui
 * `dentista_id`, e a configuracao de outro profissional nunca e consultada.
 *
 * [REGRA ANTERIOR, REVOGADA EM 30/08/2026 -- registro historico, nao vigente]
 * A chave nao tinha `dentista_id` e a duracao valia igual para todos os
 * dentistas aptos. Essa regra derrubou uma clinica real em producao (v91):
 * tres profissionais com duracoes legitimas para a mesma avaliacao (60, 30 e
 * 30) colidiam na mesma chave e tudo virava `duracao_conflitante`.
 * [FIM DO REGISTRO HISTORICO]
 *
 * Diferencas entre profissionais sao configuracao VALIDA. Conflito existe
 * somente entre valores contraditorios do MESMO dentista e MESMO procedimento.
 *
 * Recebe `procedimento_id` e `dentista_id` JA RESOLVIDOS oficialmente -- nunca
 * re-resolve nenhum dos dois, nunca aceita nome, alias, especialidade ou
 * posicao no array como chave (secao 5: "resolucao por nome" e proibida sem
 * excecao).
 *
 * Funcao pura: nao chama IA, nao acessa banco, nao acessa calendario, nao
 * calcula disponibilidade, nao gera horarios, nao altera estado e nao cria
 * efeitos. O `dentista_id` entra como CHAVE de busca, nunca como criterio a
 * interpretar.
 *
 * **Nenhum fallback, de nenhuma natureza** (secao 5 e invariantes): nem 60
 * minutos, nem 30, nem catalogo-base, nem duracao de outro procedimento,
 * nem de outra clinica, nem snapshot historico como configuracao. Ausencia
 * de configuracao devolve `nao_configurada` -- falha fechada, nunca um
 * valor inventado.
 *
 * **Nenhum arredondamento, truncamento ou correcao automatica** (secao 2):
 * um valor invalido devolve `invalida` com o valor recebido intacto, nunca
 * ajustado para o multiplo de 10 mais proximo.
 *
 * **Nao decide nada alem da duracao**: falha de duracao nao oferece
 * Consulta/Avaliacao, nao reclassifica aptidao e nao consulta
 * disponibilidade (secao 6) -- essas decisoes pertencem ao controlador.
 *
 * Lanca `EntradaInvalidaError` somente para violacao de contrato de entrada
 * (tipo errado). Configuracao invalida ou contraditoria NAO e excecao: e
 * resultado tipado.
 */
export function resolverDuracao(entrada: EntradaResolucaoDuracao): ResultadoResolucaoDuracao {
  validarFormaEntrada(entrada);

  // Isolamento multiclinica, POR DENTISTA e por procedimento ANTES de
  // qualquer avaliacao: configuracao de outra clinica, de outro profissional
  // ou de outro procedimento e simplesmente ignorada -- nunca consultada,
  // nunca usada como fallback (secao 11). Isso garante que uma configuracao
  // contraditoria de OUTRO procedimento -- ou a duracao legitimamente
  // diferente de OUTRO PROFISSIONAL -- jamais bloqueie a duracao pedida aqui.
  //
  // `dentista_id` entrou na chave em 2026-08-30 (decisao do Gabriel), depois
  // de um caso real de producao: tres dentistas com duracoes diferentes para a
  // mesma avaliacao faziam a clinica inteira cair em `duracao_conflitante`.
  // Ver o comentario em `ConfiguracaoDuracao` (duracao-tipos.ts).
  //
  // O conflito NAO desaparece: ele passa a ser avaliado dentro do escopo certo
  // -- duas configuracoes contraditorias PARA O MESMO dentista e o mesmo
  // procedimento continuam produzindo `duracao_conflitante`, exatamente como
  // antes.
  const correspondentes = entrada.configuracoes.filter(
    (c) =>
      c.clinica_id === entrada.clinica_id &&
      c.dentista_id === entrada.dentista_id &&
      c.procedimento_id === entrada.procedimento_id
  );

  if (correspondentes.length === 0) {
    return { tipo: 'nao_configurada' };
  }

  // Correcao 0155: SANITIZACAO ANTES DE QUALQUER AGREGACAO.
  //
  // Qualquer valor que nao seja numero finito invalida a resolucao aqui,
  // antes de deduplicar ou avaliar conflito. Sem esta barreira, um valor
  // nao numerico entrava em `duracoes_conflitantes` e o resultado passava
  // a depender da ordem de entrada -- `[NaN, 20]` produzia `[null, 20]` e
  // `[20, NaN]` produzia `[20, null]` na serializacao. Pior: string e
  // objeto vindos da configuracao atravessavam ate o resultado publico.
  //
  // O valor bruto NAO viaja no resultado: `nao_numerica` nunca carrega
  // `valor_recebido`. Duas permutacoes quaisquer da mesma entrada produzem
  // resultado estruturalmente identico.
  if (correspondentes.some((c) => !ehNumeroFinito(c.duracao_min))) {
    return { tipo: 'invalida', motivo: 'nao_numerica' };
  }

  // A partir daqui todos os valores correspondentes sao numeros finitos --
  // deduplicacao, comparacao e ordenacao numerica sao seguras.
  //
  // Deduplica por VALOR: registros repetidos representando exatamente a
  // mesma configuracao oficial nao produzem ambiguidade. Nao ha outro campo
  // que possa divergir, ja que `(clinica_id, dentista_id, procedimento_id)` e
  // a chave e os TRES foram filtrados acima -- duracoes de dentistas distintos
  // ja ficaram de fora do filtro, entao nunca chegam aqui como divergencia.
  const valoresDistintos = [...new Set(correspondentes.map((c) => c.duracao_min))];

  // Conflito tem precedencia sobre as demais regras de validade (mesma
  // licao das correcoes 0145/0150): com dois ou mais valores finitos
  // distintos para a mesma chave, o resultado e SEMPRE
  // `duracao_conflitante` -- mesmo que um ou ambos sejam individualmente
  // invalidos por limite ou bloco. Validar primeiro e reportar so um deles
  // dependeria da ordem de entrada, o que quebraria determinismo. O runtime
  // NUNCA escolhe: nem o primeiro, nem o ultimo, nem o menor, nem o maior.
  if (valoresDistintos.length > 1) {
    return {
      tipo: 'erro_configuracao',
      codigo: 'duracao_conflitante',
      procedimento_ids: [entrada.procedimento_id],
      duracoes_conflitantes: ordenarNumeros(valoresDistintos),
    };
  }

  const valor = valoresDistintos[0];
  const motivo = motivoDeInvalidezNumerica(valor);
  if (motivo) {
    // Numero finito: o valor pode viajar com seguranca para auditoria,
    // exatamente como recebido -- nunca ajustado.
    return { tipo: 'invalida', motivo, valor_recebido: valor };
  }

  return {
    tipo: 'resolvida',
    clinica_id: entrada.clinica_id,
    procedimento_id: entrada.procedimento_id,
    duracao_min: valor,
  };
}

// --- Validacao do valor (secao 2) ---

/**
 * Fronteira de confianca runtime: `duracao_min` e tipado como `number`, mas
 * o dado vem da configuracao da clinica e pode ser qualquer coisa em tempo
 * de execucao. `unknown` aqui e deliberado -- e a unica fronteira interna
 * onde ele aparece, nunca no resultado publico.
 *
 * String NUNCA e convertida para numero; `NaN`, `Infinity` e `-Infinity`
 * nunca sao tratados como numeros validos.
 */
function ehNumeroFinito(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor);
}

/**
 * Retorna o motivo pelo qual um numero FINITO viola a secao 2, ou `null` se
 * valido. O chamador ja garantiu finitude (`ehNumeroFinito`) -- por isso
 * `nao_numerica` nao e produzido aqui.
 *
 * Ordem de verificacao fixa e deterministica, do mais estrutural ao mais
 * especifico. Cada teste corresponde a exatamente uma regra publicada:
 * inteira, minimo 10, maximo 240, multipla de 10.
 *
 * Zero e valores negativos caem em `abaixo_do_minimo` -- e literalmente o
 * que a regra "ter minimo de 10 minutos" determina.
 */
function motivoDeInvalidezNumerica(valor: number): MotivoDuracaoInvalida | null {
  if (!Number.isInteger(valor)) return 'nao_inteira';
  if (valor < DURACAO_MINIMA_MIN) return 'abaixo_do_minimo';
  if (valor > DURACAO_MAXIMA_MIN) return 'acima_do_maximo';
  if (valor % BLOCO_MIN !== 0) return 'nao_multipla_de_10';
  return null;
}

// --- Auxiliares ---

/**
 * Ordenacao numerica crescente: o resultado nao pode depender da ordem em
 * que as configuracoes chegaram. Usa comparacao explicita em vez do sort
 * padrao (que ordena como string e colocaria 100 antes de 30).
 */
function ordenarNumeros(valores: readonly number[]): number[] {
  return [...valores].sort((a, b) => a - b);
}

// --- Validacao de forma da entrada ---

const CHAVES_ENTRADA = ['clinica_id', 'dentista_id', 'procedimento_id', 'configuracoes'] as const;

function validarFormaEntrada(entrada: unknown): asserts entrada is EntradaResolucaoDuracao {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new EntradaInvalidaError('entrada', 'entrada deve ser um objeto');
  }

  // Entrada fechada: nenhuma propriedade adicional. O nome da propriedade
  // desconhecida nunca e reproduzido no erro -- poderia carregar PII.
  //
  // `dentista_id` passou a ser OBRIGATORIO em 2026-08-30 (antes era rejeitado
  // aqui, porque duracao por dentista estava fora da v1). Exigi-lo -- em vez
  // de aceita-lo opcionalmente -- e deliberado: um chamador que esqueca de
  // passa-lo falha alto, na hora, em vez de silenciosamente voltar a comparar
  // profissionais diferentes entre si.
  const chaves = Object.keys(entrada as Record<string, unknown>);
  const esperadas: readonly string[] = CHAVES_ENTRADA;
  if (chaves.length !== esperadas.length || !esperadas.every((chave) => chaves.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada contem propriedade nao permitida');
  }

  const { clinica_id, dentista_id, procedimento_id, configuracoes } = entrada as Record<string, unknown>;

  // `clinica_id` vem da instancia autenticada, nunca da IA ou do paciente.
  if (typeof clinica_id !== 'string' || clinica_id.trim() === '') {
    throw new EntradaInvalidaError('clinica_id', 'clinica_id deve ser uma string nao vazia');
  }
  // `dentista_id` ja foi resolvido oficialmente pelo Core antes desta chamada
  // (resolver-dentista.ts) -- nunca vem de nome, posicao no array ou fallback.
  if (typeof dentista_id !== 'string' || dentista_id.trim() === '') {
    throw new EntradaInvalidaError('dentista_id', 'dentista_id deve ser uma string nao vazia');
  }
  // `procedimento_id` ja foi resolvido oficialmente antes desta chamada --
  // aqui so garantimos que existe; nunca re-resolvido a partir de texto.
  if (typeof procedimento_id !== 'string' || procedimento_id.trim() === '') {
    throw new EntradaInvalidaError('procedimento_id', 'procedimento_id deve ser uma string nao vazia');
  }
  if (!Array.isArray(configuracoes)) {
    throw new EntradaInvalidaError('configuracoes', 'configuracoes deve ser um array');
  }
}
