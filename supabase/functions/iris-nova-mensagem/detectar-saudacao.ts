// Deteccao deterministica de saudacao pura -- nunca pela IA (comportamento
// conversacional-v1, Gabriel 2026-08-05: "oi", "ola", "bom dia", "boa
// tarde", "boa noite", sem mais nenhum conteudo alem disso).
//
// So texto bruto da mensagem, antes de qualquer interpretacao -- escopo
// deliberadamente fechado, nunca conversa livre. Uma mensagem com qualquer
// conteudo alem da saudacao (ex.: "oi, quero limpeza") NAO casa aqui, e
// segue o caminho normal de interpretacao.

import { normalizarTextoCanonico } from './normalizacao-texto.ts';

const SAUDACOES_PURAS: ReadonlySet<string> = new Set(['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite']);

// normalizacao-texto.ts e fechado por contrato (specs/procedimentos-v1.md
// secao 4): explicitamente NUNCA remove pontuacao, porque a mesma funcao
// tambem normaliza texto de alias/catalogo. Saudacao real chega com "!"/"."
// ("Boa tarde!") -- remocao de pontuacao final fica local a este modulo,
// nunca alterando o contrato compartilhado.
function semPontuacaoFinal(texto: string): string {
  return texto.replace(/[!?.,;]+$/g, '').trim();
}

/**
 * `true` somente se TODAS as mensagens da janela, juntas, normalizarem
 * para nada alem de uma ou mais saudacoes do conjunto fechado (permite
 * "oi, boa tarde" -- duas saudacoes separadas por virgula -- mas nunca
 * texto adicional).
 */
export function ehSaudacaoPura(mensagens: readonly string[]): boolean {
  const partes = mensagens
    .flatMap((mensagem) => normalizarTextoCanonico(mensagem).split(','))
    .map((parte) => semPontuacaoFinal(parte.trim()))
    .filter((parte) => parte !== '');

  return partes.length > 0 && partes.every((parte) => SAUDACOES_PURAS.has(parte));
}
