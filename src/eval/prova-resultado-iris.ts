// PROVA ISOLADA -- contrato `ResultadoIris` (proposta em revisao, 2026-08-14).
//
// O QUE ESTE ARQUIVO E, E O QUE NAO E
// ------------------------------------
// E um instrumento de MEDICAO isolado, usado so por este runner. NAO importa
// nem altera `src/core/contexto-unificado-tipos.ts`, `sombra-contexto-unificado.ts`,
// `guarda-contexto-unificado.ts` nem o instrumento compartilhado
// `cliente-medicao-openai.ts` -- nenhum arquivo ja aprovado foi tocado. O
// contrato aqui medido e uma proposta AINDA EM REVISAO, distinta do contrato
// `SaidaContratoUnificado` ja aprovado e em shadow (esse continua sendo o
// unico com status "aprovado, shadow local").
//
// Nao decide nada, nao executa capacidade, nao altera estado_conversa, nao
// toca producao, nao e importado por nenhum modulo de src/core/ ou
// supabase/functions/. So mede.
//
// O QUE A RODADA 1 AJUSTOU em relacao a proposta original (preservado):
// 1. nova acao `consultar_agendamento { agendamento_id }`.
// 2. `escolher_horario` ganhou `operacao: criar | remarcar`.
// 3. `escolher_dentista.dentista_ids` aceita `[]` explicitamente.
// 4. `cancelar` nunca autoriza efeito -- so `confirmar.operacao==='cancelar'`
//    aciona a capacidade real.
// 5. NENHUMA capacidade nova foi criada -- as acoes mapeiam para as mesmas 6
//    capacidades aprovadas (docs/07-arquitetura-v2.md §10), ou para nenhuma
//    (acoes de parametro/estado).
// 6. NENHUM caso usa `dados.intencao`. Onde o Core precisa saber "que fluxo
//    esta em curso", o contexto carrega um FATO do turno
//    (`agendamento_em_remarcacao`, `agendamento_a_cancelar`) -- nunca um
//    marcador de intencao persistido.
//
// O QUE A RODADA 2 MUDA (2026-08-15, apos leitura dos casos 9/13/14 da
// rodada 1 confirmada por Gabriel/Codex):
//
// 7. `escolher_agendamento` foi REMOVIDA. A medicao da rodada 1 mostrou o
//    modelo contornando essa camada sozinho: com dois agendamentos e a
//    operacao identificavel na mesma mensagem, ele foi direto para
//    `consultar_agendamento`/`remarcar`/`cancelar` com o `agendamento_id`
//    certo em 2/2, 1/2 e 2/2 dos casos -- nunca emitiu a acao intermediaria
//    por merito proprio. Principio da remocao (docs/00-principios.md):
//    entre uma camada que o modelo ja contorna e nenhuma camada, fica
//    nenhuma. As tres acoes diretas passam a ser usadas mesmo quando o
//    agendamento precisa ser identificado dentre varios -- a mensagem (ou,
//    numa resposta curta, `aguardando_resposta.operacao`) e o que resolve
//    qual e a operacao.
// 8. Para uma RESPOSTA CURTA a uma pergunta pendente de escolha de
//    agendamento (ex.: "o primeiro"), a pergunta pendente carrega
//    `operacao` -- extensao de contexto (fato do turno), nao um vocabulario
//    novo de acao/capacidade. A Iris entao emite a acao terminal
//    diretamente, com o `agendamento_id` resolvido contra `opcoes`.
// 9. Criterio do caso M2 CORRIGIDO: a rodada 1 aceitava `data: null` na
//    alternativa como se preservasse a data vigente "implicitamente". Isso
//    era um criterio fraco demais -- o certo e exigir a data vigente
//    EXPLICITA na saida. `data: null` agora reprova.
// 10. Criterio do caso cadastral CORRIGIDO: a rodada 1 usava
//     `aguardando_resposta: {tipo:'confirmacao', ...}` para um turno que na
//     verdade era so entrega de cadastro -- contexto ele mesmo induzia o
//     modelo a `confirmar`. Trocado por um contexto realista (confirmacao
//     JA aconteceu no turno anterior, cadastro e o unico pendente agora,
//     sinalizado por `historico_recente`) e o criterio agora PROIBE
//     `acao.tipo === 'confirmar'` explicitamente. LACUNA REPORTADA: o
//     vocabulario aprovado de `aguardando_resposta.tipo`
//     (contexto-unificado-tipos.ts) nao tem nenhum valor para "cadastro
//     pendente" -- nem a spec aprovada nem esta prova representam isso por
//     marcador estrutural; o sinal vem so de texto no historico, mesmo
//     mecanismo que a propria spec usa quando nao ha marcador (escolha de
//     dentista sem `aguardando_resposta`, contexto-conversacional-unificado-v1.md).
//
// ══ RODADA 3 (2026-08-16) -- OS QUATRO MARCADORES ANTIGOS ═══════════════
//
// PERGUNTA MEDIDA: o campo unico `aguardando_resposta` cobre o que os quatro
// marcadores de `contexto_horarios` fazem hoje em producao?
//   `horarios_oferecidos`, `proposta_pendente`,
//   `oferta_procedimento_pendente`, `troca_telefone_pendente`
//
// RESULTADO -- 15 casos x 2 repeticoes (28 chamadas efetivas), modelo
// gpt-5.6-luna, reasoning.effort=none:
//
//   m2 2/2 | cadastro_multiplo 2/2 | acao_direta 6/6 |
//   resposta_pendente 6/6 | marcador_antigo 11/12
//
// OS QUATRO CASOS POSITIVOS PASSARAM 2/2 CADA:
//   - "o segundo" -> escolher_horario/10:00 (ordinal sobre a lista);
//   - "as 14"     -> escolher_horario/14:00 (valor dentro da lista);
//   - "pode ser"  -> confirmar/criar, com confirmacao em aberto;
//   - "pode ser"  -> aceitar_oferta, com oferta em aberto.
//   O caso de troca de telefone nao desviou para outro fluxo (criterio
//   fraco, ver abaixo).
//
// A UNICA FALHA -- e o que ela NAO significa:
// `marcador-proposta-ausente` (1/2): sem nenhuma pergunta pendente, "ok"
// solto produziu `confirmar/criar` numa das duas repeticoes.
//
// ISSO NAO E RISCO DE PRODUCAO. A protecao contra confirmacao sem proposta
// NAO vive no prompt: vive no Core. `decidirComHorarioEscolhido`
// (orquestrador.ts) so e alcancada quando ja existem `opcao`,
// `procedimento_id` e `dentista_id` -- isto e, quando ha proposta REAL. Um
// "sim" da IA sem proposta nao encontra o que reservar e nunca vira efeito.
// A verificacao e deterministica e independente do modelo, exatamente onde
// deve estar (docs/00-principios.md: o Core valida fato, a IA compreende
// linguagem).
//
// LIMITE DECLARADO desta rodada:
// - o caso de troca de telefone passou por criterio FRACO -- so verifica que
//   o modelo nao desviou para outro fluxo. O contrato `ResultadoIris` nao
//   tem acao de autorizacao de troca, e nao precisa ter: o gate ja e do Core
//   (`respostaTrocaTelefone` so e nao-nulo com o marcador presente,
//   orquestrador.ts). Na troca, esse gate passa a ler
//   `aguardando_resposta.tipo === 'troca_telefone'`;
// - N=2 por caso e TRIAGEM, nao estabilidade estatistica -- mesmo limite ja
//   declarado nas rodadas 1 e 2.
//
// CONCLUSAO: a troca dos quatro marcadores pelo campo unico se sustenta na
// evidencia desta rodada. Nenhum bloqueador encontrado.
//
// USO:  OPENAI_API_KEY=... node --experimental-strip-types eval/prova-resultado-iris.ts [repeticoes]

const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const MODELO = 'gpt-5.6-luna';
const REASONING_EFFORT = 'none';
const MAX_OUTPUT_TOKENS = 700;
const TIMEOUT_MS = 20000;
const REPETICOES_PADRAO = 2;

// ── SCHEMA ───────────────────────────────────────────────────────────────────

// SCHEMA e INSTRUCAO vem do modulo compartilhado -- a MESMA fonte que o
// shadow de producao usa (`sombra-resultado-iris.ts`). Antes viviam aqui;
// foram extraidos em 2026-08-16 sem alteracao, para que a evidencia desta
// prova valha para o que roda em producao.
import { INSTRUCOES_RESULTADO_IRIS, SCHEMA_RESULTADO_IRIS } from '../core/resultado-iris-instrucoes.ts';

const SCHEMA = SCHEMA_RESULTADO_IRIS;
const INSTRUCOES = INSTRUCOES_RESULTADO_IRIS;

// ── TIPOS DE SAIDA (so para o runner ler o JSON) ────────────────────────────

interface Alternativa {
  data: string | null;
  horario: string | null;
  periodo: string | null;
}
interface Informacao {
  campo: string;
  operacao: string;
  valor: string | null;
}
interface Acao {
  tipo: string;
  objetivo?: string;
  procedimento_id?: string | null;
  dentista_ids?: string[] | null;
  alternativas?: Alternativa[];
  agendamento_id?: string | null;
  referencia?: string;
  operacao?: string;
}
interface Saida {
  tipo: 'compreendida' | 'nao_compreendida';
  acao: Acao | null;
  informacoes_fornecidas: Informacao[];
}

// ── CLIENTE ISOLADO ──────────────────────────────────────────────────────────
// Copia minima e autonoma, deliberadamente NAO reaproveitando
// `cliente-medicao-openai.ts` (que nao aceita `reasoning` e e usado pela
// medicao ja aprovada de 8 casos -- este arquivo nao a altera). Mesma forma
// de transporte (system+user, Structured Outputs strict, sem store/stream),
// com o campo `reasoning.effort` que esta prova precisa.

class ErroProva extends Error {
  categoria: string;
  constructor(categoria: string, mensagem: string) {
    super(mensagem);
    this.categoria = categoria;
  }
}

async function executar(chaveApi: string, payload: unknown): Promise<Saida> {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    let resposta: Response;
    try {
      resposta = await fetch(URL_RESPONSES, {
        method: 'POST',
        headers: { Authorization: `Bearer ${chaveApi}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODELO,
          reasoning: { effort: REASONING_EFFORT },
          input: [
            { role: 'system', content: INSTRUCOES },
            { role: 'user', content: JSON.stringify(payload) },
          ],
          text: { format: { type: 'json_schema', name: 'resultado_iris_prova_v1', schema: SCHEMA, strict: true } },
          max_output_tokens: MAX_OUTPUT_TOKENS,
          store: false,
          stream: false,
          background: false,
        }),
        signal: controlador.signal,
      });
    } catch {
      throw new ErroProva(controlador.signal.aborted ? 'timeout' : 'rede', 'falha de rede/timeout');
    }
    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      throw new ErroProva('http', `http_${resposta.status}: ${corpo.slice(0, 300)}`);
    }
    const envelope = (await resposta.json()) as Record<string, unknown>;
    if (envelope.status !== 'completed') {
      throw new ErroProva('incompleta', `status=${String(envelope.status)}`);
    }
    const output = envelope.output;
    if (!Array.isArray(output)) throw new ErroProva('estrutural', 'output ausente');
    for (const item of output) {
      if ((item as { type?: string })?.type === 'refusal') throw new ErroProva('recusa', 'modelo recusou');
    }
    const mensagem = output.find((i) => (i as { type?: string })?.type === 'message') as
      | { content?: unknown }
      | undefined;
    const conteudo = Array.isArray(mensagem?.content)
      ? (mensagem.content.find((c) => (c as { type?: string })?.type === 'output_text') as { text?: unknown } | undefined)
      : undefined;
    if (typeof conteudo?.text !== 'string' || conteudo.text === '') {
      throw new ErroProva('estrutural', 'texto estruturado ausente');
    }
    return JSON.parse(conteudo.text) as Saida;
  } finally {
    clearTimeout(timer);
  }
}

// ── CASOS ────────────────────────────────────────────────────────────────────

interface Caso {
  id: string;
  titulo: string;
  // `marcador_antigo` (rodada 3): os casos que cobrem o que os quatro
  // marcadores de `contexto_horarios` fazem hoje em producao, usando so
  // `aguardando_resposta`.
  categoria: 'm2' | 'cadastro_multiplo' | 'acao_direta' | 'resposta_pendente' | 'marcador_antigo';
  contexto: Record<string, unknown>;
  mensagem: string;
  historico?: readonly { mensagem_paciente: string; resposta_iris: string }[];
  verificar: (s: Saida) => string | null;
}

function achar(saida: Saida, campo: string): Informacao | undefined {
  return saida.informacoes_fornecidas.find((i) => i.campo === campo);
}

const DOIS_AGENDAMENTOS = [
  { agendamento_id: 'ag-1', procedimento: 'Limpeza dental (profilaxia)', dentista_nome: 'Dr. Diego Ramoz', data: '2026-08-15', horario: '09:00' },
  { agendamento_id: 'ag-2', procedimento: 'Consulta / Avaliação', dentista_nome: 'Dra. Vanesa Vocaro', data: '2026-08-22', horario: '11:00' },
];

const CASOS: Caso[] = [
  // ── M2: escolher vs. propor horário -- criterio corrigido (rodada 2, item 9) ──
  {
    id: 'm2',
    titulo: 'M2: "na verdade 16h" -- NÃO estava entre os oferecidos -> consultar_disponibilidade, com data vigente EXPLICITA',
    categoria: 'm2',
    contexto: {
      aguardando_resposta: { tipo: 'confirmacao', detalhe: { data: '2026-08-20', horario: '15:00' } },
      dados_conhecidos: { procedimento: 'Limpeza dental (profilaxia)', data: '2026-08-20', horario: '15:00' },
      cadastro_paciente: { preenchidos: ['nome', 'cpf', 'data_nascimento'] },
      agendamentos_do_paciente: [],
    },
    mensagem: 'na verdade 16h',
    verificar: (s) => {
      if (s.acao?.tipo !== 'consultar_disponibilidade') return `acao=${s.acao?.tipo}, esperado consultar_disponibilidade`;
      const alt = s.acao.alternativas?.[0];
      if (alt === undefined || !(alt.horario ?? '').includes('16')) {
        return `alternativas=${JSON.stringify(s.acao.alternativas)}, esperado horario contendo 16`;
      }
      // CORRIGIDO (rodada 2): data null NAO passa mais -- a data vigente
      // precisa vir EXPLICITA na alternativa.
      if (alt.data !== '2026-08-20') {
        return `data="${alt.data}", esperado "2026-08-20" explicito -- data null nao passa mais`;
      }
      return null;
    },
  },

  // ── cadastro múltiplo -- contexto e criterio corrigidos (rodada 2, item 10) ──
  {
    id: 'cadastro',
    titulo: 'cadastro múltiplo -- confirmação JÁ aconteceu, turno é só entrega de dado; confirmar é PROIBIDO',
    categoria: 'cadastro_multiplo',
    contexto: {
      // Sem `aguardando_resposta` estrutural: o vocabulario aprovado
      // (contexto-unificado-tipos.ts, PerguntaPendente.tipo) nao tem valor
      // para "cadastro pendente" -- LACUNA, reportada no comentario de topo,
      // item 10. O sinal vem do historico, mesmo mecanismo que a spec usa
      // quando nao ha marcador.
      aguardando_resposta: null,
      dados_conhecidos: { procedimento: 'Limpeza dental (profilaxia)', data: '2026-08-14', horario: '10:00' },
      cadastro_paciente: { preenchidos: [] },
      agendamentos_do_paciente: [],
    },
    historico: [
      {
        mensagem_paciente: 'sim, pode confirmar',
        resposta_iris: 'Perfeito! Para finalizar, preciso do seu nome completo, CPF e data de nascimento.',
      },
    ],
    mensagem: 'gabriel cappello cpf 06113236722 data 02-08-1973',
    verificar: (s) => {
      const faltando = ['nome', 'cpf', 'data_nascimento'].filter((c) => achar(s, c) === undefined);
      if (faltando.length > 0) return `perdeu ${faltando.join(', ')}`;
      // NOVO (rodada 2): fornecer cadastro nao e confirmar operacao.
      if (s.acao?.tipo === 'confirmar') return `acao=confirmar -- proibido: entregar cadastro nao e confirmar operacao`;
      return null;
    },
  },

  // ── ação direta com agendamento identificado na própria mensagem (rodada 2, item 7) ──
  {
    id: 'direta-consultar',
    titulo: 'AÇÃO DIRETA: consultar_agendamento com 2 agendamentos, sem escolher_agendamento intermediária',
    categoria: 'acao_direta',
    contexto: { aguardando_resposta: null, dados_conhecidos: {}, cadastro_paciente: { preenchidos: ['nome', 'cpf'] }, agendamentos_do_paciente: DOIS_AGENDAMENTOS },
    mensagem: 'queria saber os detalhes da minha consulta de sexta, dia 15',
    verificar: (s) =>
      s.acao?.tipo === 'consultar_agendamento' && s.acao.agendamento_id === 'ag-1'
        ? null
        : `acao=${JSON.stringify(s.acao)}, esperado consultar_agendamento/ag-1`,
  },
  {
    id: 'direta-remarcar',
    titulo: 'AÇÃO DIRETA: remarcar com 2 agendamentos, sem escolher_agendamento intermediária',
    categoria: 'acao_direta',
    contexto: { aguardando_resposta: null, dados_conhecidos: {}, cadastro_paciente: { preenchidos: ['nome', 'cpf'] }, agendamentos_do_paciente: DOIS_AGENDAMENTOS },
    mensagem: 'quero remarcar o de sexta, dia 15',
    verificar: (s) =>
      s.acao?.tipo === 'remarcar' && s.acao.agendamento_id === 'ag-1'
        ? null
        : `acao=${JSON.stringify(s.acao)}, esperado remarcar/ag-1`,
  },
  {
    id: 'direta-cancelar',
    titulo: 'AÇÃO DIRETA: cancelar com 2 agendamentos, sem escolher_agendamento intermediária',
    categoria: 'acao_direta',
    contexto: { aguardando_resposta: null, dados_conhecidos: {}, cadastro_paciente: { preenchidos: ['nome', 'cpf'] }, agendamentos_do_paciente: DOIS_AGENDAMENTOS },
    mensagem: 'cancela o de sexta, dia 15, por favor',
    verificar: (s) =>
      s.acao?.tipo === 'cancelar' && s.acao.agendamento_id === 'ag-1'
        ? null
        : `acao=${JSON.stringify(s.acao)}, esperado cancelar/ag-1`,
  },

  // ── resposta curta a pergunta pendente de escolha de agendamento (rodada 2, item 8) ──
  // `aguardando_resposta` carrega `operacao` -- extensao de CONTEXTO, nunca
  // um vocabulario novo de acao/capacidade.
  {
    id: 'pendente-consultar',
    titulo: 'RESPOSTA CURTA a pergunta pendente (operacao=consultar) -- "o primeiro"',
    categoria: 'resposta_pendente',
    contexto: {
      aguardando_resposta: {
        tipo: 'escolha_agendamento',
        operacao: 'consultar',
        opcoes: ['Limpeza com Dr. Diego — 15/08 às 09:00', 'Avaliação com Dra. Vanesa — 22/08 às 11:00'],
      },
      dados_conhecidos: {},
      cadastro_paciente: { preenchidos: ['nome', 'cpf'] },
      agendamentos_do_paciente: DOIS_AGENDAMENTOS,
    },
    mensagem: 'o primeiro',
    verificar: (s) =>
      s.acao?.tipo === 'consultar_agendamento' && s.acao.agendamento_id === 'ag-1'
        ? null
        : `acao=${JSON.stringify(s.acao)}, esperado consultar_agendamento/ag-1`,
  },
  {
    id: 'pendente-remarcar',
    titulo: 'RESPOSTA CURTA a pergunta pendente (operacao=remarcar) -- "o primeiro"',
    categoria: 'resposta_pendente',
    contexto: {
      aguardando_resposta: {
        tipo: 'escolha_agendamento',
        operacao: 'remarcar',
        opcoes: ['Limpeza com Dr. Diego — 15/08 às 09:00', 'Avaliação com Dra. Vanesa — 22/08 às 11:00'],
      },
      dados_conhecidos: {},
      cadastro_paciente: { preenchidos: ['nome', 'cpf'] },
      agendamentos_do_paciente: DOIS_AGENDAMENTOS,
    },
    mensagem: 'o primeiro',
    verificar: (s) =>
      s.acao?.tipo === 'remarcar' && s.acao.agendamento_id === 'ag-1'
        ? null
        : `acao=${JSON.stringify(s.acao)}, esperado remarcar/ag-1`,
  },
  {
    id: 'pendente-cancelar',
    titulo: 'RESPOSTA CURTA a pergunta pendente (operacao=cancelar) -- "o primeiro"',
    categoria: 'resposta_pendente',
    contexto: {
      aguardando_resposta: {
        tipo: 'escolha_agendamento',
        operacao: 'cancelar',
        opcoes: ['Limpeza com Dr. Diego — 15/08 às 09:00', 'Avaliação com Dra. Vanesa — 22/08 às 11:00'],
      },
      dados_conhecidos: {},
      cadastro_paciente: { preenchidos: ['nome', 'cpf'] },
      agendamentos_do_paciente: DOIS_AGENDAMENTOS,
    },
    mensagem: 'o primeiro',
    verificar: (s) =>
      s.acao?.tipo === 'cancelar' && s.acao.agendamento_id === 'ag-1'
        ? null
        : `acao=${JSON.stringify(s.acao)}, esperado cancelar/ag-1`,
  },

  // ══ RODADA 3 (2026-08-16) -- OS QUATRO MARCADORES ANTIGOS ═════════════
  //
  // Cada caso abaixo cobre EXATAMENTE o que um dos quatro marcadores de
  // `contexto_horarios` faz hoje em producao, mas usando SO o campo unico
  // `aguardando_resposta`. Sao os casos que decidem se a troca (quatro
  // marcadores -> um campo) se sustenta.
  //
  // Marcadores substituidos:
  //   `horarios_oferecidos`           -> aguardando_resposta.escolha_horario
  //   `proposta_pendente`             -> aguardando_resposta.confirmacao/criar
  //   `oferta_procedimento_pendente`  -> aguardando_resposta.oferta_procedimento
  //   `troca_telefone_pendente`       -> aguardando_resposta.troca_telefone
  //
  // As mensagens sao as MESMAS que os marcadores atuais tratam hoje --
  // frases curtas reais de paciente, nao construidas para passar.

  {
    id: 'marcador-horarios-ordinal',
    titulo: 'MARCADOR horarios_oferecidos: "o segundo" escolhe o 2o horario da lista',
    categoria: 'marcador_antigo',
    contexto: {
      aguardando_resposta: { tipo: 'escolha_horario', opcoes: ['09:00', '10:00', '14:00'] },
      dados_conhecidos: { data_texto: '2026-08-20', procedimento_id: 'proc-limpeza' },
      cadastro_paciente: { preenchidos: ['nome', 'cpf'] },
      agendamentos_do_paciente: [],
    },
    mensagem: 'o segundo',
    verificar: (s) =>
      s.acao?.tipo === 'escolher_horario' && s.acao.referencia === '10:00'
        ? null
        : `acao=${JSON.stringify(s.acao)}, esperado escolher_horario/10:00`,
  },
  {
    id: 'marcador-horarios-valor',
    titulo: 'MARCADOR horarios_oferecidos: "as 14" escolhe por VALOR dentro da lista',
    categoria: 'marcador_antigo',
    contexto: {
      aguardando_resposta: { tipo: 'escolha_horario', opcoes: ['09:00', '10:00', '14:00'] },
      dados_conhecidos: { data_texto: '2026-08-20', procedimento_id: 'proc-limpeza' },
      cadastro_paciente: { preenchidos: ['nome', 'cpf'] },
      agendamentos_do_paciente: [],
    },
    mensagem: 'as 14',
    verificar: (s) =>
      s.acao?.tipo === 'escolher_horario' && s.acao.referencia === '14:00'
        ? null
        : `acao=${JSON.stringify(s.acao)}, esperado escolher_horario/14:00`,
  },
  {
    id: 'marcador-proposta-confirma',
    titulo: 'MARCADOR proposta_pendente: "pode ser" confirma a proposta em aberto',
    categoria: 'marcador_antigo',
    contexto: {
      aguardando_resposta: { tipo: 'confirmacao', operacao: 'criar' },
      dados_conhecidos: {
        data_texto: '2026-08-20',
        horario_texto: '10:00',
        procedimento_id: 'proc-limpeza',
      },
      cadastro_paciente: { preenchidos: ['nome', 'cpf'] },
      agendamentos_do_paciente: [],
    },
    mensagem: 'pode ser',
    verificar: (s) =>
      s.acao?.tipo === 'confirmar' && s.acao.operacao === 'criar'
        ? null
        : `acao=${JSON.stringify(s.acao)}, esperado confirmar/criar`,
  },
  {
    id: 'marcador-proposta-ausente',
    titulo: 'MARCADOR proposta_pendente (LADO NEGATIVO): "ok" solto SEM proposta NAO confirma',
    categoria: 'marcador_antigo',
    contexto: {
      // Sem `aguardando_resposta`: nao ha proposta concreta a confirmar.
      // Este e o par negativo do caso acima -- sem ele, o teste nao provaria
      // que a confirmacao depende da pergunta pendente.
      dados_conhecidos: { procedimento_id: 'proc-limpeza' },
      cadastro_paciente: { preenchidos: ['nome', 'cpf'] },
      agendamentos_do_paciente: [],
    },
    mensagem: 'ok',
    verificar: (s) =>
      s.acao?.tipo === 'confirmar'
        ? `acao=${JSON.stringify(s.acao)}, NAO deveria confirmar sem proposta pendente`
        : null,
  },
  {
    id: 'marcador-oferta-aceita',
    titulo: 'MARCADOR oferta_procedimento_pendente: "pode ser" aceita a avaliação oferecida',
    categoria: 'marcador_antigo',
    contexto: {
      aguardando_resposta: { tipo: 'oferta_procedimento', opcoes: ['Consulta / Avaliação'] },
      dados_conhecidos: {},
      cadastro_paciente: { preenchidos: ['nome', 'cpf'] },
      agendamentos_do_paciente: [],
    },
    mensagem: 'pode ser',
    // `aceitar_oferta` e a acao propria do contrato para isto. Aceito
    // tambem o caso em que o modelo informa `procedimento_id` diretamente --
    // e o mesmo efeito pratico (o procedimento fica escolhido), e a spec v2
    // trata `informacoes_fornecidas` como caminho legitimo.
    verificar: (s) => {
      const informouProcedimento = s.informacoes_fornecidas?.some((i) => i.campo === 'procedimento_id');
      return s.acao?.tipo === 'aceitar_oferta' || informouProcedimento
        ? null
        : `acao=${JSON.stringify(s.acao)}, info=${JSON.stringify(s.informacoes_fornecidas)}, esperado aceitar_oferta`;
    },
  },
  {
    id: 'marcador-troca-telefone',
    titulo: 'MARCADOR troca_telefone_pendente: "pode sim" autoriza a troca',
    categoria: 'marcador_antigo',
    contexto: {
      aguardando_resposta: { tipo: 'troca_telefone' },
      dados_conhecidos: {},
      cadastro_paciente: { preenchidos: ['nome', 'cpf'] },
      agendamentos_do_paciente: [],
    },
    mensagem: 'pode sim, pode atualizar pro meu número',
    // O contrato ResultadoIris NAO tem acao `aceitar_troca_telefone` -- a
    // troca e conduzida pelo Core, nao por acao da IA. O que se mede aqui e
    // apenas que o modelo RECONHECE a autorizacao e NAO desvia para outro
    // fluxo (agendar, cancelar, consultar) por nao entender a pergunta.
    //
    // ESTE CASO NAO PROVA que a troca funciona pelo contrato novo -- prova
    // que a pergunta pendente e compreendida. A conducao da troca depende de
    // desenho proprio, ainda nao feito (ver relatorio).
    verificar: (s) => {
      const desviou =
        s.acao?.tipo === 'pedir_agendamento' ||
        s.acao?.tipo === 'cancelar' ||
        s.acao?.tipo === 'remarcar' ||
        s.acao?.tipo === 'consultar_agendamento' ||
        s.acao?.tipo === 'consultar_disponibilidade';
      return desviou
        ? `acao=${JSON.stringify(s.acao)}, desviou para outro fluxo em vez de tratar a autorizacao`
        : null;
    },
  },
];

// ── EXECUCAO ─────────────────────────────────────────────────────────────────

async function principal(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY ?? '';
  if (chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente.');
    process.exitCode = 1;
    return;
  }
  const repeticoes = Number(process.argv[2] ?? REPETICOES_PADRAO);

  console.log(`\nPROVA ISOLADA -- ResultadoIris (proposta em revisão), RODADA 2 (sem escolher_agendamento), modelo=${MODELO}, reasoning.effort=${REASONING_EFFORT}, ${repeticoes}x por caso\n`);
  console.log(`total de casos: ${CASOS.length} -- total de chamadas previstas: ${CASOS.length * repeticoes}\n`);

  const porCategoria = new Map<string, { ok: number; total: number }>();

  for (const caso of CASOS) {
    const falhas: string[] = [];
    const observado: string[] = [];

    for (let i = 0; i < repeticoes; i++) {
      let saida: Saida;
      try {
        saida = await executar(chaveApi, {
          contexto_relevante: caso.contexto,
          mensagem_atual: caso.mensagem,
          historico_recente: caso.historico ?? [],
        });
      } catch (erro) {
        const detalhe = erro instanceof ErroProva ? `${erro.categoria}: ${erro.message}` : String(erro);
        falhas.push(`chamada falhou (${detalhe})`);
        continue;
      }

      const dados = saida.informacoes_fornecidas.map((x) => `${x.campo}:${x.operacao}=${x.valor === null ? 'null' : `"${x.valor}"`}`).join(', ') || '—';
      observado.push(`${saida.tipo} | ${JSON.stringify(saida.acao)} | ${dados}`);
      const motivo = caso.verificar(saida);
      if (motivo !== null) falhas.push(motivo);
    }

    const ok = repeticoes - falhas.length;
    const marca = falhas.length === 0 ? 'PASSOU' : `FALHOU ${falhas.length}/${repeticoes}`;
    console.log(`[${caso.categoria}] caso ${caso.id}: ${marca}  -- ${caso.titulo}`);
    for (const linha of [...new Set(observado)]) console.log(`            saida: ${linha}`);
    for (const motivo of [...new Set(falhas)]) console.log(`            FALHA: ${motivo}`);
    console.log('');

    const acumulado = porCategoria.get(caso.categoria) ?? { ok: 0, total: 0 };
    acumulado.ok += ok;
    acumulado.total += repeticoes;
    porCategoria.set(caso.categoria, acumulado);
  }

  console.log('─'.repeat(70));
  console.log('resultado por categoria:');
  for (const [categoria, { ok, total }] of porCategoria) {
    console.log(`  ${categoria}: ${ok}/${total}`);
  }
  console.log('\nCaso 4e (ambiguidade conhecida, "cancela isso") nao faz parte desta rodada -- ver rodada 1.\n');
}

void principal();
