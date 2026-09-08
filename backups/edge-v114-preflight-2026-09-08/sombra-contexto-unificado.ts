// SOMBRA do contrato de contexto unificado
// (specs/contexto-conversacional-unificado-v1.md, aprovada em 2026-08-14).
//
// ── O QUE ESTE ARQUIVO FAZ ───────────────────────────────────────────────────
// Em paralelo ao atendimento, e SOMENTE para medição: monta o contexto
// unificado, pede à IA a saída no contrato novo (ação SEPARADA dos dados
// informados), aplica a guarda estrutural da spec §5.1 e registra o resultado.
//
// ── O QUE ELE NÃO FAZ ────────────────────────────────────────────────────────
// Não decide nada, não executa capacidade, não altera `estado_conversa`, não
// influencia a resposta ao paciente, não persiste nada. A guarda aqui NUNCA
// interfere na persistência atual: ela avalia a saída do contrato novo, que
// não alimenta nenhuma escrita.
//
// ── LIMITE DECLARADO: SÓ O TURNO ATUAL ───────────────────────────────────────
// Esta sombra mede UM turno isolado. A segunda volta -- guarda bloqueia →
// pergunta persistida → paciente responde → nome final correto -- **não é
// provada aqui**, porque não há onde guardar `aguardando_resposta` entre turnos.
//
// Persistência shadow entre turnos foi ABANDONADA nesta etapa (decisão de
// 2026-08-14): exigiria uma ordem monotônica atribuída na recepção da mensagem,
// e hoje não existe entrada autoritativa de mensagens em produção
// (`mensagens_fila` está inativa desde 28/07; `reivindicarMensagem` não é
// chamada). A segunda volta real depende dessa entrada futura.
//
// `aguardando_resposta` é sempre `null` aqui, por fidelidade à spec §3.1 -- não
// é derivado dos marcadores antigos, o que amarraria o contrato novo ao
// roteamento que a V2 existe para remover. A pergunta em aberto chega à Iris
// pelo `historico_recente`, em texto.
//
// MEDIDO nesse formato exato (2026-08-14, 10 repetições): `"Pablo"` e
// `"vanesa por favor"` produziram `escolher_dentista` em 10/10 -- inclusive nas
// repetições que contaminaram com `nome`. Como a guarda dispara por
// CO-OCORRÊNCIA, ela enxerga o defeito com o contexto real de produção.
//
// ── GARANTIA CENTRAL ─────────────────────────────────────────────────────────
// `medirComContextoUnificado` NUNCA lança. Toda falha vira resultado normal com
// `estado` descrevendo o que houve -- mesma disciplina de `sombra-capacidade-v2.ts`.

import { aplicarGuardaEscolhaProfissional, validarFormaSaida } from './guarda-contexto-unificado.ts';
import {
  ACOES_CONTRATO,
  CAMPOS_CONTRATO,
  type ContextoUnificado,
  type PerguntaPendente,
  type SaidaContratoUnificado,
} from './contexto-unificado-tipos.ts';
import type { HistoricoConversa } from './tipos.ts';
import type { AgendamentoAtivo } from './buscar-agendamento-ativo.ts';
import type { CatalogoClinica } from './orquestrador-tipos.ts';

const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const MODELO = 'gpt-4.1-mini-2025-04-14';
const TIMEOUT_MS = 8000;
const MAX_OUTPUT_TOKENS = 512;

const SCHEMA = {
  type: 'object',
  properties: {
    acao_solicitada: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: [...ACOES_CONTRATO] },
        referencia: { type: ['string', 'null'] },
      },
      required: ['tipo', 'referencia'],
      additionalProperties: false,
    },
    informacoes_fornecidas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          campo: { type: 'string', enum: [...CAMPOS_CONTRATO] },
          operacao: { type: 'string', enum: ['informou', 'corrigiu'] },
          valor: { type: ['string', 'null'] },
        },
        required: ['campo', 'operacao', 'valor'],
        additionalProperties: false,
      },
    },
  },
  required: ['acao_solicitada', 'informacoes_fornecidas'],
  additionalProperties: false,
};

// Contrato MINIMO -- idêntico ao medido em 2026-08-14. Nenhuma regra por caso,
// nenhum exemplo de frase: mudar o texto aqui invalida a comparação com aquela
// medição.
const INSTRUCOES = `
Voce e a Iris, assistente de uma clinica odontologica, conversando com um paciente pelo WhatsApp.

Leia o contexto e a mensagem atual e devolva DUAS coisas separadas:

1. "acao_solicitada" -- o que o paciente quer que aconteca agora. Escolher entre opcoes que voce apresentou E uma acao. Use "nenhuma" quando ele nao pede nada, so informa algo.

2. "informacoes_fornecidas" -- os fatos que ele declarou NESTA mensagem, cada um com a operacao:
   - "informou": esta dando o dado agora -- "valor" sempre preenchido;
   - "corrigiu": o valor registrado esta errado. Se ele disse qual e o certo, ponha em "valor"; se ele so negou o atual sem dar outro, "valor" fica null.

REGRA CENTRAL: uma mencao que serve para ESCOLHER uma das opcoes apresentadas e acao, nunca um dado sobre o paciente. Um nome de profissional que voce ofereceu nao e o nome do paciente.

Lista vazia quando ele nao informou nenhum fato -- nem cadastral (nome, CPF, nascimento, e-mail) nem conversacional (procedimento, data, periodo, horario). "referencia" em null quando a acao nao aponta para uma opcao concreta.
`.trim();

/**
 * Monta o contexto unificado a partir de fatos REAIS já disponíveis no turno.
 *
 * `aguardando_resposta` é sempre `null` nesta etapa -- e isso é fiel à spec, não
 * uma limitação escondida. A spec §3.1 exige que ele represente **a pergunta
 * que foi de fato feita ao paciente, registrada quando a resposta é produzida**;
 * derivá-lo dos marcadores antigos (`contexto_horarios`) o amarraria ao
 * roteamento determinístico que a V2 existe para remover, e ainda assim não
 * cobriria a escolha de dentista, que não tem marcador.
 *
 * A pergunta em aberto chega à Iris pelo `historico_recente`, em texto. Medido
 * em 2026-08-14, 10 repetições, no formato exato desta função: `"Pablo"` e
 * `"vanesa por favor"` produziram `escolher_dentista` em 10/10 -- inclusive nas
 * repetições que contaminaram com `nome`. A guarda, que dispara por
 * co-ocorrência, portanto ENXERGA o defeito com o contexto real de produção.
 *
 * PII: `cadastro_paciente` leva apenas QUAIS campos estão preenchidos, nunca o
 * conteúdo (spec §3.0).
 */
export function montarContextoUnificado(entrada: {
  dados: Readonly<Record<string, string | undefined>>;
  /** `CadastroPaciente` serve -- só os nomes dos campos são lidos, nunca o valor. */
  cadastro: Readonly<Record<string, string | undefined>>;
  agendamentos: readonly AgendamentoAtivo[] | undefined;
  catalogo: CatalogoClinica | null;
  historico: HistoricoConversa | null;
  /**
   * A pergunta do turno anterior, quando houver registro (spec v2 §14.6).
   * Opcional: enquanto ninguém grava a coluna, os chamadores existentes
   * seguem sem passá-la e o campo continua `null` -- mesmo comportamento de
   * antes, sem alteração para quem já usa esta função.
   */
  aguardando_resposta?: PerguntaPendente | null;
}): ContextoUnificadoSemMensagem {
  const dadosConhecidos: Record<string, string> = {};
  for (const [campo, valor] of Object.entries(entrada.dados)) {
    if (typeof valor === 'string' && valor.trim() !== '') dadosConhecidos[campo] = valor;
  }

  return {
    contexto_relevante: {
      dados_conhecidos: dadosConhecidos,
      cadastro_paciente: {
        preenchidos: Object.entries(entrada.cadastro)
          .filter(([, v]) => typeof v === 'string' && v.trim() !== '')
          .map(([campo]) => campo),
      },
      agendamentos_do_paciente: (entrada.agendamentos ?? []).map((a) => ({
        data: a.data,
        horario: a.horario,
        ...(a.procedimento !== null ? { procedimento: a.procedimento } : {}),
        ...(a.dentista_nome !== null ? { dentista_nome: a.dentista_nome } : {}),
      })),
      // Sem registro do que foi oferecido no turno anterior, esta lista é
      // sempre vazia. O que foi apresentado aparece no histórico, em texto.
      opcoes_apresentadas: [],
      // A pergunta que a Iris de fato fez no turno anterior, quando já houver
      // registro dela (spec v2 §14.6). Continua `null` enquanto ninguém
      // GRAVA a coluna -- a leitura já existe (`aguardando-resposta.ts`,
      // `identificacao.ts`), a escrita depende de a redatora declarar a
      // pergunta (spec §14.5), ainda não implementado.
      //
      // `null` aqui segue significando "não há pergunta em aberto", nunca
      // "não sei": um valor malformado é recusado antes, na leitura, e desvia
      // o turno em vez de chegar como `null`.
      aguardando_resposta: entrada.aguardando_resposta ?? null,
      procedimentos_disponiveis: (entrada.catalogo?.procedimentos ?? [])
        .filter((p) => p.ativo)
        .map((p) => ({ procedimento_id: p.procedimento_id, nome: p.nome_pt })),
      dentistas_disponiveis: (entrada.catalogo?.dentistas ?? [])
        .filter((d) => d.ativo)
        .map((d) => ({ dentista_id: d.dentista_id, nome_exibido: d.nome_exibido })),
    },
    historico_recente: (entrada.historico ?? []).map((par) => ({
      mensagem_paciente: par.mensagem_paciente,
      resposta_iris: par.resposta_iris,
    })),
  };
}

/**
 * O contexto SEM a mensagem crua do turno.
 *
 * O montador roda dentro do orquestrador, que não é a origem da mensagem: quem
 * a recebe é o despachante (`index.ts`), e é lá que ela entra no contexto, via
 * `completarContextoUnificado`. Copiá-la para o resultado do orquestrador seria
 * duplicar texto cru do paciente num campo puramente diagnóstico.
 *
 * O contrato da spec segue íntegro -- `ContextoUnificado` está completo, com
 * `mensagem_atual`, no ponto em que é de fato usado.
 */
export type ContextoUnificadoSemMensagem = Omit<ContextoUnificado, 'mensagem_atual'>;

export function completarContextoUnificado(
  parcial: ContextoUnificadoSemMensagem,
  mensagemAtual: string
): ContextoUnificado {
  return { ...parcial, mensagem_atual: mensagemAtual };
}

export type EstadoMedicao =
  | 'ok'
  | 'timeout'
  | 'erro_rede'
  | 'erro_http'
  | 'erro_estrutural'
  | 'forma_invalida'
  | 'recusa_ou_filtro';

/**
 * Linha de auditoria, SEM PII: nenhum texto de mensagem, nenhum valor de campo,
 * nenhum nome. Só rótulos e contagens.
 */
export interface ResultadoMedicaoUnificada {
  estado: EstadoMedicao;
  acao: string | null;
  /** Nomes dos campos declarados -- nunca os valores. */
  campos: readonly string[];
  guarda_bloqueou: boolean;
  duracao_ms: number;
}

export interface EntradaMedicaoUnificada {
  chaveApi: string;
  contexto: ContextoUnificado;
  /** Injeção para teste -- produção sempre usa o `fetch` global. */
  fetchInjetado?: typeof fetch;
  timeoutMsInjetado?: number;
}

function falha(estado: EstadoMedicao, duracaoMs: number): ResultadoMedicaoUnificada {
  return { estado, acao: null, campos: [], guarda_bloqueou: false, duracao_ms: duracaoMs };
}

/**
 * NUNCA LANÇA. Qualquer falha -- rede, timeout, HTTP, corpo malformado, recusa
 * do modelo, saída fora do contrato -- vira resultado normal com `estado`
 * != 'ok'. O chamador nunca precisa de try/catch para o atendimento ficar
 * protegido.
 */
export async function medirComContextoUnificado(
  entrada: EntradaMedicaoUnificada
): Promise<ResultadoMedicaoUnificada> {
  const inicio = Date.now();
  const fetchUsado = entrada.fetchInjetado ?? fetch;
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), entrada.timeoutMsInjetado ?? TIMEOUT_MS);

  try {
    let resposta: Response;
    try {
      resposta = await fetchUsado(URL_RESPONSES, {
        method: 'POST',
        headers: { Authorization: `Bearer ${entrada.chaveApi}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODELO,
          input: [
            { role: 'system', content: INSTRUCOES },
            { role: 'user', content: JSON.stringify(entrada.contexto) },
          ],
          text: { format: { type: 'json_schema', name: 'contexto_unificado_v1', schema: SCHEMA, strict: true } },
          max_output_tokens: MAX_OUTPUT_TOKENS,
          store: false,
          stream: false,
          background: false,
        }),
        signal: controlador.signal,
      });
    } catch {
      return falha(controlador.signal.aborted ? 'timeout' : 'erro_rede', Date.now() - inicio);
    }

    if (!resposta.ok) return falha('erro_http', Date.now() - inicio);

    let envelope: Record<string, unknown>;
    try {
      envelope = (await resposta.json()) as Record<string, unknown>;
    } catch {
      return falha('erro_estrutural', Date.now() - inicio);
    }

    const output = envelope.output;
    if (!Array.isArray(output)) return falha('erro_estrutural', Date.now() - inicio);
    for (const item of output) {
      if ((item as { type?: string } | null)?.type === 'refusal') {
        return falha('recusa_ou_filtro', Date.now() - inicio);
      }
    }
    if (envelope.status !== 'completed') return falha('erro_estrutural', Date.now() - inicio);

    const mensagem = output.find((i) => (i as { type?: string })?.type === 'message') as
      | { content?: unknown }
      | undefined;
    const conteudo = Array.isArray(mensagem?.content)
      ? (mensagem.content.find((c) => (c as { type?: string })?.type === 'output_text') as
          | { text?: unknown }
          | undefined)
      : undefined;
    if (typeof conteudo?.text !== 'string' || conteudo.text === '') {
      return falha('erro_estrutural', Date.now() - inicio);
    }

    let saida: SaidaContratoUnificado;
    try {
      saida = JSON.parse(conteudo.text) as SaidaContratoUnificado;
    } catch {
      return falha('erro_estrutural', Date.now() - inicio);
    }
    if (saida?.acao_solicitada === undefined || !Array.isArray(saida.informacoes_fornecidas)) {
      return falha('erro_estrutural', Date.now() - inicio);
    }

    // FORMA antes de tudo (spec §4): saída que viola o contrato é recusada,
    // nunca normalizada por adivinhação.
    if (validarFormaSaida(saida) !== null) return falha('forma_invalida', Date.now() - inicio);

    const guarda = aplicarGuardaEscolhaProfissional(saida);
    return {
      estado: 'ok',
      acao: saida.acao_solicitada.tipo,
      campos: saida.informacoes_fornecidas.map((i) => `${i.campo}:${i.operacao}`),
      guarda_bloqueou: guarda.bloqueou,
      duracao_ms: Date.now() - inicio,
    };
  } catch {
    // Rede de segurança final -- nenhuma exceção escapa desta função.
    return falha('erro_estrutural', Date.now() - inicio);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Único ponto de escrita do log. SEM PII por construção de tipo: o resultado
 * carrega apenas rótulos (ação, `campo:operacao`) e contagens -- nunca o valor
 * de um campo, nunca texto do paciente, nunca nome de pessoa.
 */
export function registrarMedicaoUnificada(resultado: ResultadoMedicaoUnificada): void {
  console.log(
    `sombra_unificada estado=${resultado.estado} acao=${resultado.acao ?? 'null'} ` +
      `campos=${resultado.campos.length > 0 ? resultado.campos.join('|') : 'nenhum'} ` +
      `guarda_bloqueou=${resultado.guarda_bloqueou} duracao_ms=${resultado.duracao_ms}`
  );
}
