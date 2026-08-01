// Normalizacao canonica de texto para resolucao deterministica.
//
// Contrato: specs/procedimentos-v1.md secao 4 -- EXATAMENTE estas quatro
// transformacoes, nenhuma outra:
//
//   1. lowercase;
//   2. remocao de acentos;
//   3. trim;
//   4. reducao de espacos multiplos a um unico espaco.
//
// Explicitamente FORA (secao 4): correcao ortografica, stemming,
// interpretacao semantica, expansao automatica, qualquer transformacao
// linguistica. Tambem fora: remocao de pontuacao -- confirmado por
// specs/dentistas-vinculos-v1.md secao 6 ("Pontuacao nao e removida
// automaticamente -- consistente com o conjunto fechado de 4
// transformacoes ja aprovado, que nunca incluiu remocao de pontuacao").
//
// Este modulo e o unico lugar onde essas transformacoes vivem. A mesma
// normalizacao vale para o texto do paciente e para as entradas de
// resolucao do catalogo -- nunca duas implementacoes paralelas.

// Marcas diacriticas combinantes produzidas pela decomposicao NFD.
// Remove-las e o que realiza "remocao de acentos" sem tocar em mais nada:
// 'ç' -> NFD -> 'c' + U+0327 -> 'c'; 'ã' -> 'a' + U+0303 -> 'a'.
const MARCAS_DIACRITICAS = /[\u0300-\u036f]/g;

// Sequencias de espaco em branco (espaco, tab, quebra de linha) colapsam
// para um unico espaco. Leitura de "espacos multiplos" que cobre o texto
// real digitado em WhatsApp; nao introduz transformacao de conteudo.
const ESPACOS_MULTIPLOS = /\s+/g;

/**
 * Aplica as quatro transformacoes canonicas, nesta ordem fixa. A ordem e
 * deterministica e o resultado e idempotente: normalizar duas vezes produz
 * exatamente o mesmo texto.
 */
export function normalizarTextoCanonico(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(MARCAS_DIACRITICAS, '')
    .replace(ESPACOS_MULTIPLOS, ' ')
    .trim();
}

/**
 * Texto considerado ausente para fins de resolucao: nao e string, ou
 * normaliza para vazio (vazio, somente espacos, somente quebras de linha).
 * `procedimento_texto` omitido pela IA chega aqui como ausencia de entrada
 * (specs/procedimentos-v1.md secao 6).
 */
export function textoAusenteParaResolucao(texto: unknown): boolean {
  return typeof texto !== 'string' || normalizarTextoCanonico(texto) === '';
}
