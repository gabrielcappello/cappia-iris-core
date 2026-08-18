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
// (Existe uma tela mais antiga em dashboard/procedimentos que decide por
// especialidade. A leitura item a item aqui atende as duas, porque le o que
// FOI GRAVADO em cada item -- nunca reinterpreta a intencao da tela.)
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
}

interface ItemPreco {
  nome?: unknown;
  valor?: unknown;
  ativo?: unknown;
  mostrar_valor?: unknown;
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
 * Separa os precos em "pode informar" e "depende de avaliacao".
 *
 * Regras, todas conservadoras por decisao:
 *   - item inativo         -> ignorado por completo (nao e oferecido)
 *   - `mostrar_valor` != true -> so o nome, nunca o valor
 *   - valor ausente/<= 0   -> tratado como NAO liberado, mesmo com
 *                             `mostrar_valor: true`. Zero no cadastro
 *                             significa "ainda nao definido" (ha varios
 *                             assim no banco), e "R$ 0,00" seria uma
 *                             promessa de gratuidade que ninguem fez.
 */
export function derivarPrecosClinica(precios: unknown): PrecosClinica | undefined {
  if (!Array.isArray(precios)) return undefined;

  const liberados: PrecoLiberado[] = [];
  const sobAvaliacao: string[] = [];

  for (const bruto of precios) {
    if (bruto === null || typeof bruto !== 'object') continue;
    const item = bruto as ItemPreco;

    if (item.ativo !== true) continue;

    const nome = texto(item.nome);
    if (nome === undefined) continue;

    const valorNumerico = typeof item.valor === 'number' && Number.isFinite(item.valor) ? item.valor : null;
    const liberado = item.mostrar_valor === true && valorNumerico !== null && valorNumerico > 0;

    if (liberado) liberados.push({ procedimento: nome, valor: formatarValor(valorNumerico) });
    else sobAvaliacao.push(nome);
  }

  const resultado: PrecosClinica = {};
  if (liberados.length > 0) resultado.liberados = liberados;
  if (sobAvaliacao.length > 0) resultado.sob_avaliacao = sobAvaliacao;

  return Object.keys(resultado).length > 0 ? resultado : undefined;
}
