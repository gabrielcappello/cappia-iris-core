// Precos de procedimento como fato autorizado -- SOMENTE os que a clinica
// liberou.
//
// ── A DECISAO E DA CLINICA, NUNCA DA IRIS (2026-08-17) ──────────────────
// Cada item de `clinicas.precios` carrega o consentimento da clinica:
//
//     { "esp": "Clinico Geral", "nome": "Limpeza dental",
//       "valor": 45, "ativo": true, "mostrar_valor": false }
//
// `mostrar_valor` e escrito pelo PAINEL, na coluna rotulada "INFORMA VALOR?"
// da tela de configuracao (dashboard/page.tsx): cada PROCEDIMENTO tem seu
// proprio interruptor --
//
//     <Toggle on={p.mostrar_valor}
//             onChange={v => update(p.nome, 'mostrar_valor', v)} />
//
// O toggle que aparece no cabecalho da especialidade e apenas um atalho em
// massa (`toggleEspMostrarValor`), que escreve o mesmo valor nos
// procedimentos ATIVOS daquele grupo -- conveniencia, nao a unidade de
// decisao. Desligar o procedimento (`ativo: false`) tambem zera o
// `mostrar_valor` dele, entao um item desligado nunca fica com preco
// liberado por esquecimento.
//
// So o que estiver com `true` vira fato para a redatora; todo o resto NUNCA
// sai do Core -- nem o valor, nem a existencia dele.
//
// Isso importa mais do que parece: um preco odontologico costuma depender de
// exame (numero de raizes, faces, complexidade). Anunciar valor de um
// procedimento que a clinica nao liberou cria expectativa que o dentista
// tera de desmentir na cadeira. Por isso a regra e "liberado item a item",
// e o padrao e nao mostrar.
//
// Quando o procedimento NAO esta liberado, a redatora recebe apenas o nome
// em `precos_sob_avaliacao` -- ela sabe que o procedimento existe e que o
// valor depende de avaliacao, sem nunca ver o numero.
//
// ── GRATUIDADE, campo `gratuito` (2026-08-22) ─────────────────────────────
// specs/catalogo-avaliacao-obrigatoria-gratuita-v1.md secao 2.2. Escolha
// EXPLICITA da clinica, campo proprio -- NUNCA inferida de `valor <= 0`
// (que continua significando "ainda nao definido", nao "gratuito"; ver a
// regra logo abaixo). Hoje so "Consulta / Avaliação" tem esse controle no
// painel (ela e o unico procedimento fixo/inamovivel do catalogo), mas o
// campo e generico o bastante para qualquer item futuro.
//
// ── MULTICLINICA ────────────────────────────────────────────────────────
// Tudo vem da linha da clinica do turno. Uma clinica que nunca liberou nada
// simplesmente nao produz fato de preco, e a Iris segue como antes.

/** Preco que a clinica AUTORIZOU a Iris informar. */
export interface PrecoLiberado {
  procedimento: string;
  /** Valor ja formatado para leitura ("R$ 120,00"). */
  valor: string;
}

/** O que a redatora recebe sobre precos neste turno. */
export interface PrecosClinica {
  /** Procedimentos com valor liberado pela clinica. Ausente quando nenhum. */
  liberados?: PrecoLiberado[];
  /**
   * Procedimentos ATIVOS cujo valor a clinica NAO liberou. So o nome -- e o
   * que permite a Iris dizer "esse depende de avaliacao" sem inventar preco.
   */
  sob_avaliacao?: string[];
  /**
   * Procedimentos que a clinica marcou como GRATUITOS (specs/catalogo-
   * avaliacao-obrigatoria-gratuita-v1.md secao 2.2) -- so o nome, nunca
   * valor. Escolha EXPLICITA da clinica via o campo `gratuito`, nunca
   * inferida de `valor <= 0` (que continua significando "ainda nao
   * definido", nao "gratuito" -- decisao preservada, ver derivarPrecosClinica
   * abaixo). Hoje so "Consulta / Avaliação" tem esse controle no painel,
   * mas o campo e generico: qualquer item marcado `gratuito: true` cai aqui.
   */
  gratuitos?: string[];
}

interface ItemPreco {
  nome?: unknown;
  valor?: unknown;
  ativo?: unknown;
  mostrar_valor?: unknown;
  gratuito?: unknown;
}

function texto(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const limpo = valor.trim();
  return limpo === '' ? undefined : limpo;
}

/**
 * Formata em Real. `pais_codigo`/moeda por clinica ainda nao existe no
 * cadastro -- quando existir, e AQUI que entra, num unico ponto.
 */
function formatarValor(valor: number): string {
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

/**
 * Separa os precos em "pode informar", "depende de avaliacao" e "gratuito".
 *
 * Regras, todas conservadoras por decisao:
 *   - item inativo         -> ignorado por completo (nao e oferecido)
 *   - `gratuito` === true  -> vai para `gratuitos`, ANTES de qualquer
 *                             checagem de valor -- ESCOLHA EXPLICITA da
 *                             clinica (specs/catalogo-avaliacao-obrigatoria-
 *                             gratuita-v1.md secao 2.2), nunca inferida.
 *                             `valor`/`mostrar_valor` do item sao ignorados
 *                             quando `gratuito` e true.
 *   - `mostrar_valor` != true -> so o nome, nunca o valor
 *   - valor ausente/<= 0   -> tratado como NAO liberado, mesmo com
 *                             `mostrar_valor: true`. Zero no cadastro
 *                             significa "ainda nao definido" (ha varios
 *                             assim no banco), e "R$ 0,00" seria uma
 *                             promessa de gratuidade que ninguem fez.
 *                             ESSA REGRA CONTINUA VALENDO -- gratuidade so
 *                             existe pelo campo `gratuito` explicito, nunca
 *                             por valor zerado.
 */
export function derivarPrecosClinica(precios: unknown): PrecosClinica | undefined {
  if (!Array.isArray(precios)) return undefined;

  const liberados: PrecoLiberado[] = [];
  const sobAvaliacao: string[] = [];
  const gratuitos: string[] = [];

  for (const bruto of precios) {
    if (bruto === null || typeof bruto !== 'object') continue;
    const item = bruto as ItemPreco;

    if (item.ativo !== true) continue;

    const nome = texto(item.nome);
    if (nome === undefined) continue;

    if (item.gratuito === true) {
      gratuitos.push(nome);
      continue;
    }

    const valorNumerico = typeof item.valor === 'number' && Number.isFinite(item.valor) ? item.valor : null;
    const liberado = item.mostrar_valor === true && valorNumerico !== null && valorNumerico > 0;

    if (liberado) liberados.push({ procedimento: nome, valor: formatarValor(valorNumerico) });
    else sobAvaliacao.push(nome);
  }

  const resultado: PrecosClinica = {};
  if (liberados.length > 0) resultado.liberados = liberados;
  if (sobAvaliacao.length > 0) resultado.sob_avaliacao = sobAvaliacao;
  if (gratuitos.length > 0) resultado.gratuitos = gratuitos;

  return Object.keys(resultado).length > 0 ? resultado : undefined;
}
