// ETAPA 2 da Arquitetura V2 (docs/07-arquitetura-v2.md secao 10) --
// EXPERIMENTAL. Comparador-sombra: decide a capacidade em paralelo ao
// roteamento real, SOMENTE PARA MEDICAO, sem nenhum efeito no fluxo.
//
// ── GARANTIA CENTRAL DESTE ARQUIVO ──────────────────────────────────────
// `compararComSombraCapacidadeV2` NUNCA lanca. Toda falha -- rede, timeout,
// HTTP, resposta malformada, recusa do modelo -- vira um `ResultadoSombraV2`
// normal, com `estado` descrevendo o que aconteceu. O chamador (index.ts)
// nunca precisa de try/catch ao redor desta funcao para o fluxo real ficar
// protegido; a protecao esta na propria assinatura de tipo (a funcao
// devolve `Promise<ResultadoSombraV2>`, nunca `Promise<never>`).
//
// ── POR QUE UM CLIENTE PROPRIO, DE NOVO ─────────────────────────────────
// Mesma razao da Etapa 0 (`src/eval/cliente-medicao-openai.ts`): o cliente
// de producao (`cliente-modelo-openai.ts`) ignora o schema do chamador,
// exige uma frase estrutural especifica nas instrucoes, e converte a saida
// para uma forma fixa. Nao pode ser reaproveitado para um contrato
// diferente sem tocar producao -- decisao explicita do Gabriel, adiada para
// quando a arquitetura estiver provada (Etapa 2, secao 10).
//
// O cliente de medicao (`src/eval/cliente-medicao-openai.ts`) tambem NAO e
// reaproveitado aqui: `src/eval/` nunca e enviado no deploy da Edge
// Function (so os arquivos de `src/core/` sao espelhados para
// `supabase/functions/iris-nova-mensagem/`). Importar de `src/eval/`
// quebraria o deploy. Este arquivo e uma copia minima, do MESMO desenho,
// posicionada onde o deploy realmente alcanca.
//
// ── O QUE ESTE ARQUIVO NAO FAZ ───────────────────────────────────────────
// Nao decide nada. Nao executa nenhuma capacidade. Nao altera
// `estado_conversa`. Nao influencia a resposta ao paciente. Nao e chamado
// por `processarMensagem` nem por nenhuma funcao de decisao do Core -- so
// por `index.ts`, depois que a resposta real ja foi decidida.

import type { DecisaoOrquestrador, ContextoSombraCapacidadeV2 } from './orquestrador-tipos.ts';
import type { HistoricoConversa } from './tipos.ts';

const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const MODELO = 'gpt-4.1-mini-2025-04-14'; // mesmo modelo da Etapa 1 e de producao.
const TIMEOUT_MS = 8000; // mesmo timeout por tentativa aprovado para producao.
const MAX_OUTPUT_TOKENS = 256;

export const CAPACIDADES_V2 = [
  'consultar_agendamento_do_paciente',
  'consultar_disponibilidade',
  'criar_agendamento',
  'remarcar_agendamento',
  'cancelar_agendamento',
  'nenhuma_apenas_conversar',
] as const;
export type CapacidadeV2 = (typeof CAPACIDADES_V2)[number];

const SCHEMA_DECISAO_V2 = {
  type: 'object',
  properties: {
    capacidade: { type: 'string', enum: [...CAPACIDADES_V2] },
    certeza: { type: 'string', enum: ['alta', 'baixa'] },
  },
  required: ['capacidade', 'certeza'],
  additionalProperties: false,
};

// Contrato MINIMO, identico em espirito ao medido na Etapa 1 (nenhuma regra
// por capacidade, nenhum exemplo de frase) -- o objetivo desta etapa e
// medir o comportamento do contrato minimo em trafego real, nao ja
// refina-lo.
const INSTRUCOES_DECISAO_V2 = `
Voce e a Iris, assistente de uma clinica odontologica, conversando com um paciente pelo WhatsApp.

Leia a conversa e decida UMA coisa: qual capacidade do sistema voce precisa acionar agora para responder bem a ultima mensagem do paciente.

Valores possiveis para capacidade:
${CAPACIDADES_V2.map((c) => `- ${c}`).join('\n')}

Use "nenhuma_apenas_conversar" quando conseguir responder sem consultar nem alterar nada no sistema.

Em "certeza", indique "alta" quando a capacidade certa for clara, ou "baixa" quando houver ambiguidade real.
`.trim();

/**
 * Traducao aproximada de uma decisao REAL do orquestrador para o vocabulario
 * de capacidades da V2 -- so para permitir comparar. NAO e um contrato
 * oficial, NAO e usada por nenhuma decisao de producao. Varias decisoes
 * tecnicas (erro de configuracao, catalogo ausente) nao correspondem a
 * nenhuma capacidade real -- `indeterminado`, nunca um palpite.
 */
export function mapearDecisaoParaCapacidadeV2(tipo: DecisaoOrquestrador['tipo']): CapacidadeV2 | 'indeterminado' {
  switch (tipo) {
    case 'saudacao':
    case 'duvida_livre':
    case 'mensagem_nao_compreendida':
    case 'desistencia':
    case 'aguardando_procedimento':
    case 'aguardando_escolha_dentista':
    case 'aguardando_data_horario':
    case 'troca_telefone_pendente':
    case 'troca_telefone_recusada':
      return 'nenhuma_apenas_conversar';
    case 'sem_dentista_disponivel':
    case 'combinacao_indisponivel':
    case 'horarios_disponiveis':
      return 'consultar_disponibilidade';
    case 'aguardando_confirmacao':
    case 'cadastro_necessario':
    case 'cpf_ja_cadastrado':
    case 'reserva_criada':
    case 'reserva_conflito':
    case 'reserva_falhou':
      return 'criar_agendamento';
    case 'sem_agendamento_para_remarcar':
    case 'aguardando_escolha_agendamento':
    case 'aguardando_confirmacao_remarcacao':
    case 'remarcacao_criada':
      return 'remarcar_agendamento';
    case 'sem_agendamento_para_cancelar':
    case 'aguardando_escolha_agendamento_cancelamento':
    case 'aguardando_confirmacao_cancelamento':
    case 'cancelamento_criado':
      return 'cancelar_agendamento';
    case 'clinica_sem_catalogo':
    case 'erro_catalogo_dentista':
    case 'duracao_nao_configurada':
    case 'erro_configuracao_duracao':
      return 'indeterminado';
  }
}

export type EstadoComparacaoSombra = 'ok' | 'timeout' | 'erro_rede' | 'erro_http' | 'erro_estrutural' | 'recusa_ou_filtro';

/**
 * Linha de auditoria, SEM PII: nenhum texto de mensagem, nenhum dado
 * cadastral, nenhum identificador de paciente/conversa. So os dois rotulos
 * de decisao, o resultado da comparacao, e metadados estruturais.
 */
export interface ResultadoComparacaoSombra {
  decisao_atual: DecisaoOrquestrador['tipo'];
  capacidade_mapeada_atual: CapacidadeV2 | 'indeterminado';
  capacidade_v2: CapacidadeV2 | null;
  certeza_v2: 'alta' | 'baixa' | null;
  concordou: boolean | null; // null quando indeterminado ou quando a chamada falhou
  estado: EstadoComparacaoSombra;
  duracao_ms: number;
}

export interface EntradaComparacaoSombra {
  chaveApi: string;
  mensagemAtual: string;
  historicoConversa: HistoricoConversa | null;
  contexto?: ContextoSombraCapacidadeV2;
  decisaoAtual: DecisaoOrquestrador['tipo'];
  /** Injecao para teste -- producao nunca fornece, usa o `fetch` global. */
  fetchInjetado?: typeof fetch;
  /** Injecao para teste -- producao nunca fornece, usa TIMEOUT_MS. */
  timeoutMsInjetado?: number;
}

function montarPayload(entrada: EntradaComparacaoSombra): unknown {
  return {
    mensagens_atuais: [entrada.mensagemAtual],
    ...(entrada.historicoConversa !== null
      ? {
          historico_recente: entrada.historicoConversa.map((par) => ({
            mensagem_paciente: par.mensagem_paciente,
            resposta_iris: par.resposta_iris,
          })),
        }
      : {}),
    ...(entrada.contexto?.dados_conhecidos !== undefined ? { dados_conhecidos: entrada.contexto.dados_conhecidos } : {}),
    ...(entrada.contexto?.horarios_oferecidos !== undefined
      ? { horarios_oferecidos: entrada.contexto.horarios_oferecidos }
      : {}),
    ...(entrada.contexto?.confirmacao_pendente !== undefined
      ? { confirmacao_pendente: entrada.contexto.confirmacao_pendente }
      : {}),
    ...(entrada.contexto?.agendamentos_futuros !== undefined
      ? { agendamentos_futuros: entrada.contexto.agendamentos_futuros }
      : {}),
    ...(entrada.contexto?.ultimo_desfecho !== undefined
      ? { ultimo_desfecho: entrada.contexto.ultimo_desfecho }
      : {}),
  };
}

function detectarRecusaOuFiltro(envelope: Record<string, unknown>): boolean {
  const output = envelope.output;
  if (Array.isArray(output)) {
    for (const itemOutput of output) {
      const item = itemOutput as { type?: string; content?: unknown } | null;
      if (item?.type === 'refusal') return true;
      if (Array.isArray(item?.content)) {
        for (const conteudo of item.content as unknown[]) {
          if ((conteudo as { type?: string } | null)?.type === 'refusal') return true;
        }
      }
    }
  }
  return false;
}

function resultadoFalha(
  entrada: EntradaComparacaoSombra,
  estado: EstadoComparacaoSombra,
  duracaoMs: number
): ResultadoComparacaoSombra {
  return {
    decisao_atual: entrada.decisaoAtual,
    capacidade_mapeada_atual: mapearDecisaoParaCapacidadeV2(entrada.decisaoAtual),
    capacidade_v2: null,
    certeza_v2: null,
    concordou: null,
    estado,
    duracao_ms: duracaoMs,
  };
}

/**
 * NUNCA LANCA. Qualquer falha (rede, timeout, HTTP, corpo malformado,
 * recusa do modelo) e capturada aqui e devolvida como resultado normal com
 * `estado` != 'ok' -- o chamador nunca precisa de try/catch para o fluxo
 * real ficar protegido.
 */
export async function compararComSombraCapacidadeV2(entrada: EntradaComparacaoSombra): Promise<ResultadoComparacaoSombra> {
  const inicio = Date.now();
  const fetchUsado = entrada.fetchInjetado ?? fetch;
  const timeoutUsado = entrada.timeoutMsInjetado ?? TIMEOUT_MS;
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), timeoutUsado);

  try {
    const corpo = {
      model: MODELO,
      input: [
        { role: 'system', content: INSTRUCOES_DECISAO_V2 },
        { role: 'user', content: JSON.stringify(montarPayload(entrada)) },
      ],
      text: {
        format: { type: 'json_schema', name: 'decisao_sombra_v2', schema: SCHEMA_DECISAO_V2, strict: true },
      },
      max_output_tokens: MAX_OUTPUT_TOKENS,
      store: false,
      stream: false,
      background: false,
    };

    let resposta: Response;
    try {
      resposta = await fetchUsado(URL_RESPONSES, {
        method: 'POST',
        headers: { Authorization: `Bearer ${entrada.chaveApi}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: controlador.signal,
      });
    } catch {
      const estado = controlador.signal.aborted ? 'timeout' : 'erro_rede';
      return resultadoFalha(entrada, estado, Date.now() - inicio);
    }

    if (!resposta.ok) {
      return resultadoFalha(entrada, 'erro_http', Date.now() - inicio);
    }

    let envelope: Record<string, unknown>;
    try {
      envelope = (await resposta.json()) as Record<string, unknown>;
    } catch {
      return resultadoFalha(entrada, 'erro_estrutural', Date.now() - inicio);
    }

    if (detectarRecusaOuFiltro(envelope)) {
      return resultadoFalha(entrada, 'recusa_ou_filtro', Date.now() - inicio);
    }
    if (envelope.status !== 'completed') {
      return resultadoFalha(entrada, 'erro_estrutural', Date.now() - inicio);
    }

    const output = envelope.output;
    const mensagem = Array.isArray(output)
      ? (output.find((i) => (i as { type?: string })?.type === 'message') as { content?: unknown } | undefined)
      : undefined;
    const conteudo = mensagem?.content;
    const itemTexto = Array.isArray(conteudo)
      ? (conteudo.find((c) => (c as { type?: string })?.type === 'output_text') as { text?: unknown } | undefined)
      : undefined;
    if (typeof itemTexto?.text !== 'string' || itemTexto.text === '') {
      return resultadoFalha(entrada, 'erro_estrutural', Date.now() - inicio);
    }

    let saida: { capacidade?: unknown; certeza?: unknown };
    try {
      saida = JSON.parse(itemTexto.text) as { capacidade?: unknown; certeza?: unknown };
    } catch {
      return resultadoFalha(entrada, 'erro_estrutural', Date.now() - inicio);
    }

    if (
      typeof saida.capacidade !== 'string' ||
      !CAPACIDADES_V2.includes(saida.capacidade as CapacidadeV2) ||
      (saida.certeza !== 'alta' && saida.certeza !== 'baixa')
    ) {
      return resultadoFalha(entrada, 'erro_estrutural', Date.now() - inicio);
    }

    const capacidadeV2 = saida.capacidade as CapacidadeV2;
    const capacidadeMapeadaAtual = mapearDecisaoParaCapacidadeV2(entrada.decisaoAtual);

    return {
      decisao_atual: entrada.decisaoAtual,
      capacidade_mapeada_atual: capacidadeMapeadaAtual,
      capacidade_v2: capacidadeV2,
      certeza_v2: saida.certeza,
      concordou: capacidadeMapeadaAtual === 'indeterminado' ? null : capacidadeV2 === capacidadeMapeadaAtual,
      estado: 'ok',
      duracao_ms: Date.now() - inicio,
    };
  } catch {
    // Rede de seguranca final: qualquer excecao nao prevista pelos ramos
    // acima (nunca deveria ocorrer) ainda assim nao escapa desta funcao.
    return resultadoFalha(entrada, 'erro_estrutural', Date.now() - inicio);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Unico ponto de escrita do log-sombra. SEM PII: nunca recebe nem imprime
 * texto de mensagem, nome, telefone, CPF ou qualquer identificador de
 * paciente/conversa/clinica -- so os campos estruturais de
 * `ResultadoComparacaoSombra`, que por construcao de tipo nao carregam
 * nenhum deles.
 */
export function registrarResultadoSombra(resultado: ResultadoComparacaoSombra): void {
  console.log(
    `sombra_v2 estado=${resultado.estado} decisao_atual=${resultado.decisao_atual} ` +
      `capacidade_atual=${resultado.capacidade_mapeada_atual} capacidade_v2=${resultado.capacidade_v2 ?? 'null'} ` +
      `certeza_v2=${resultado.certeza_v2 ?? 'null'} concordou=${resultado.concordou ?? 'null'} ` +
      `duracao_ms=${resultado.duracao_ms}`
  );
}
