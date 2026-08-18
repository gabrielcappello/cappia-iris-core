// Procedimentos que o paciente JA APROVOU e ainda nao realizou.
//
// ── POR QUE ESTE ARQUIVO EXISTE (2026-08-18) ────────────────────────────
// O dentista registra o plano no odontograma, gera o orcamento, o paciente
// aprova -- e ninguem marca nada. Hoje isso depende de alguem da clinica
// lembrar de ligar. Numa conversa real, o paciente escreveu "ok. vou aprovar
// o orcamento" e a Iris respondeu pedindo qual procedimento ele queria
// agendar: ela nao fazia ideia de que havia um orcamento aprovado.
//
// Com este fato, no primeiro "bom dia" ela ja diz o que esta pendente e
// pergunta qual ele quer marcar. Decisao do Gabriel: 95% das vezes o
// paciente procura a clinica exatamente para isso.
//
// ── O QUE ESTE MODULO NAO FAZ ───────────────────────────────────────────
// NAO carrega valor. Preco de tratamento ja foi conversado entre dentista e
// paciente na avaliacao; repetir na conversa nao acrescenta nada e exporia
// dinheiro sem ninguem ter perguntado (decisao do Gabriel).
//
// NAO aprova nem altera orcamento. A aprovacao continua sendo do painel,
// com a clinica -- aprovar gera parcelas a receber, e isso nunca deve sair
// de um "ok" no WhatsApp.
//
// NAO decide o que o paciente quer. Se ele pedir outra coisa (remarcar,
// duvida, outro procedimento), o fato e so contexto: quem conduz e ele.
//
// ── COMO UM ITEM SAI DA LISTA ───────────────────────────────────────────
// Quando o dentista clica "Marcar realizado" no odontograma,
// `detalhes.plano_status` vira `realizado` e o item deixa de aparecer --
// sem nenhum controle novo, usando o que o painel ja escreve.

/** Um tratamento aprovado e ainda por fazer. */
export interface TratamentoAprovado {
  /** Nome exibido do procedimento ("Canal dente anterior (1 raiz)"). */
  procedimento: string;
  /** Id canonico do catalogo -- e o que o Core usa para resolver duracao. */
  procedimento_id: string;
  /** Numero do dente (notacao ISO), quando o plano o especifica. */
  dente?: string;
}

/** Linha crua vinda da consulta. */
export interface LinhaTratamentoAprovado {
  descricao?: unknown;
  dente?: unknown;
  procedimento_id?: unknown;
}

function texto(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const limpo = valor.trim();
  return limpo === '' ? undefined : limpo;
}

/**
 * Converte as linhas em fatos, descartando o que nao serve.
 *
 * Um item SEM `procedimento_id` e descartado de proposito: sem o id
 * canonico o Core nao resolve duracao nem disponibilidade, e oferecer um
 * procedimento que a Iris nao consegue agendar levaria o paciente a um beco.
 * Isso pode acontecer se a descricao gravada no orcamento nao casar com
 * nenhum nome do catalogo.
 *
 * Duplicatas (mesmo procedimento no mesmo dente) sao colapsadas: o paciente
 * nao precisa ouvir duas vezes o que e uma coisa so. Mesmo procedimento em
 * dentes DIFERENTES permanece separado -- sao dois atendimentos.
 */
export function derivarTratamentosAprovados(
  linhas: readonly LinhaTratamentoAprovado[] | null | undefined
): TratamentoAprovado[] | undefined {
  if (!Array.isArray(linhas) || linhas.length === 0) return undefined;

  const resultado: TratamentoAprovado[] = [];
  const vistos = new Set<string>();

  for (const linha of linhas) {
    const procedimento = texto(linha.descricao);
    const procedimentoId = texto(linha.procedimento_id);
    if (procedimento === undefined || procedimentoId === undefined) continue;

    const dente = texto(linha.dente);
    const chave = `${procedimentoId}|${dente ?? ''}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    resultado.push({
      procedimento,
      procedimento_id: procedimentoId,
      ...(dente !== undefined ? { dente } : {}),
    });
  }

  return resultado.length > 0 ? resultado : undefined;
}

/** Descricao curta para a redatora: "Canal dente anterior (1 raiz) (dente 26)". */
export function descreverTratamento(t: TratamentoAprovado): string {
  return t.dente !== undefined ? `${t.procedimento} (dente ${t.dente})` : t.procedimento;
}
