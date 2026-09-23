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
  /**
   * O DENTISTA marcou este procedimento como "para agendar agora"
   * (botao no odontograma / aba Plano de tratamento).
   *
   * Quando algum procedimento do paciente esta marcado, a funcao do banco
   * devolve SOMENTE os marcados -- entao aqui isto e sempre `true`. Quando
   * nenhum esta, ela devolve todos os pendentes e isto vem `false`. E o que
   * permite a Iris dizer "o seu dentista indicou X como proximo" em vez de
   * apenas listar o que existe.
   */
  indicado_pelo_dentista?: true;
  /**
   * Quem vai REALIZAR o procedimento, escolhido pelo dentista da avaliacao
   * (2026-08-19).
   *
   * Quem avalia nem sempre e quem executa. Sem isto a assistente perguntava
   * ao PACIENTE com qual profissional ele queria -- pergunta que ele nao tem
   * como responder, porque o criterio e clinico.
   *
   * Ausente quando o dentista nao escolheu: nesse caso a Iris pergunta.
   */
  dentista_id?: string;
  dentista_nome?: string;
  /**
   * Este foi o ULTIMO procedimento anunciado ao paciente (2026-08-19).
   *
   * Com dois pendentes de nome parecido (Canal pre-molar e Canal molar), a
   * assistente anunciou um e a interpretadora escolheu o outro. Esta marca
   * diz qual e o ASSUNTO da conversa; os demais continuam disponiveis se o
   * paciente pedir outro.
   */
  assunto_atual?: true;
}

/** Linha crua vinda da consulta. */
export interface LinhaTratamentoAprovado {
  descricao?: unknown;
  dente?: unknown;
  procedimento_id?: unknown;
  para_agendar?: unknown;
  dentista_id?: unknown;
  dentista_nome?: unknown;
  avisado_em?: unknown;
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
    // A linha vem do banco: um jsonb malformado ou um `null` no meio do
    // array nao pode derrubar o turno inteiro (pego por teste, 2026-08-18).
    if (linha === null || typeof linha !== 'object') continue;
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
      ...(linha.para_agendar === true ? { indicado_pelo_dentista: true as const } : {}),
      ...(texto(linha.dentista_id) !== undefined ? { dentista_id: texto(linha.dentista_id) } : {}),
      ...(texto(linha.dentista_nome) !== undefined ? { dentista_nome: texto(linha.dentista_nome) } : {}),
    });
  }

  // O primeiro item com `avisado_em` e o ULTIMO anunciado -- a funcao do
  // banco devolve em ordem decrescente. Comparo pela chave do proprio item,
  // nunca por indice: linhas sao descartadas no laco acima (sem
  // `procedimento_id`, duplicadas), e um indice desalinhado marcaria o
  // procedimento errado -- exatamente o defeito que isto corrige.
  for (const linha of linhas) {
    if (linha === null || typeof linha !== 'object') continue;
    if (linha.avisado_em === undefined || linha.avisado_em === null) continue;
    const proc = texto(linha.descricao);
    const dente = texto(linha.dente);
    const alvo = resultado.find((t) => t.procedimento === proc && t.dente === dente);
    if (alvo !== undefined) alvo.assunto_atual = true;
    break;
  }

  return resultado.length > 0 ? resultado : undefined;
}

/** Descricao curta para a redatora: "Canal dente anterior (1 raiz) (dente 26)". */
export function descreverTratamento(t: TratamentoAprovado): string {
  return t.dente !== undefined ? `${t.procedimento} (dente ${t.dente})` : t.procedimento;
}

/** Cliente minimo de RPC -- mesma forma usada em cancelar-agendamento.ts. */
export interface ClienteRpcTratamentos {
  rpc(nome: string, parametros: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Le os tratamentos aprovados e por agendar deste paciente.
 *
 * FALHA NUNCA DERRUBA O TURNO: este e um fato ACESSORIO -- se a leitura
 * falhar, a Iris atende normalmente, so nao menciona os tratamentos. O
 * mesmo principio de `buscarEspecialidadesCatalogo`: um extra ausente nunca
 * pode custar o atendimento inteiro.
 */
export async function buscarTratamentosAprovados(
  cliente: ClienteRpcTratamentos,
  clinicaId: string,
  pacienteId: string
): Promise<TratamentoAprovado[] | undefined> {
  try {
    const { data, error } = await cliente.rpc('iris_nova_tratamentos_aprovados', {
      p_clinica_id: clinicaId,
      p_paciente_id: pacienteId,
    });
    if (error) return undefined;
    return derivarTratamentosAprovados(data as LinhaTratamentoAprovado[]);
  } catch {
    return undefined;
  }
}
