// MEDICAO do contrato proposto em specs/contexto-conversacional-unificado-v1.md
// (aprovado pelo Codex e pelo Gabriel em 2026-08-14).
//
// O QUE ESTA MEDICAO RESPONDE, e so isso: o contrato novo separa corretamente
// A ACAO PEDIDA dos DADOS INFORMADOS? Nada aqui toca producao, nada e
// deployado, nenhuma decisao de atendimento muda. E o passo 3 da spec, que
// antecede qualquer corte.
//
// CASOS -- os 8 da spec, secoes 6.1 e 6.2:
//   1-3  os defeitos REAIS medidos em producao em 13-14/08;
//   4-8  CONTROLES: comportamento que hoje funciona e nao pode regredir.
//
// Sem os controles, a medicao provaria apenas que o novo conserta o velho --
// nunca que nao estraga o resto.
//
// USO:  OPENAI_API_KEY=... node --experimental-strip-types eval/medicao-contexto-unificado.ts [repeticoes]

import { criarClienteMedicao, ErroClienteMedicao } from './cliente-medicao-openai.ts';

const REPETICOES_PADRAO = 5;

// ── CONTRATO NOVO ────────────────────────────────────────────────────────────
// Entrada: contexto unificado (spec secao 3). Saida: acao SEPARADA dos dados
// informados (spec secao 4).

const ACOES = [
  'escolher_dentista',
  'escolher_horario',
  'escolher_agendamento',
  'confirmar',
  'aceitar_oferta',
  'pedir_agendamento',
  'cancelar',
  'remarcar',
  'nenhuma',
] as const;

const CAMPOS = [
  'nome',
  'cpf',
  'data_nascimento',
  'email',
  'procedimento',
  'data',
  'periodo',
  'horario',
] as const;

const SCHEMA = {
  type: 'object',
  properties: {
    acao_solicitada: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: [...ACOES] },
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
          campo: { type: 'string', enum: [...CAMPOS] },
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

// Contrato MINIMO -- nenhuma regra por caso, nenhum exemplo de frase. Mesma
// disciplina da Etapa 1: o objetivo e medir o contrato, nao ja refina-lo com
// prosa ate ele passar.
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

// ── CASOS ────────────────────────────────────────────────────────────────────

interface Caso {
  id: string;
  titulo: string;
  origem: 'defeito' | 'controle';
  contexto: unknown;
  mensagem: string;
  historico?: readonly { mensagem_paciente: string; resposta_iris: string }[];
  /** Devolve null quando passou, ou o motivo da falha. */
  verificar: (saida: Saida) => string | null;
}

interface ItemInformado {
  campo: string;
  operacao: string;
  valor: string | null;
}
interface Saida {
  acao_solicitada: { tipo: string; referencia: string | null };
  informacoes_fornecidas: ItemInformado[];
}

const PERGUNTA_DENTISTA = {
  aguardando_resposta: {
    tipo: 'escolha_dentista',
    opcoes: ['Dr. Diego Ramoz', 'Dr. Pablo Arruda'],
  },
  dados_conhecidos: { procedimento: 'Consulta / Avaliação', data: 'hoje' },
  cadastro_paciente: { preenchidos: [] },
  agendamentos_do_paciente: [],
};

/**
 * FORMA do contrato (spec secao 4), verificada em TODA saida antes do criterio
 * especifico do caso. O schema estrito da OpenAI nao expressa restricao
 * condicional por valor de campo (o limite de `valor` depende de `operacao`),
 * entao a garantia vive aqui -- e, na implementacao, vira dever do Core.
 */
function violacaoDeForma(saida: Saida): string | null {
  for (const item of saida.informacoes_fornecidas) {
    const vazio = item.valor === null || item.valor.trim() === '';
    if (item.operacao === 'informou' && vazio) {
      return `${item.campo}: informou com valor vazio/null -- proibido pelo contrato`;
    }
    // String vazia e INVALIDA em qualquer operacao -- nunca normalizada para
    // null. So `null` representa remocao.
    if (item.operacao === 'corrigiu' && item.valor !== null && item.valor.trim() === '') {
      return `${item.campo}: corrigiu com string vazia -- invalido, use null para remover`;
    }
  }
  return null;
}

function achar(saida: Saida, campo: string): ItemInformado | undefined {
  return saida.informacoes_fornecidas.find((i) => i.campo === campo);
}

/**
 * SEGUNDA VOLTA (spec secao 6.4b): a guarda impediu a gravacao e a Iris
 * perguntou.
 *
 * ESCOPO HONESTO desta medicao: o contexto da volta 2 e FABRICADO aqui, nao
 * produzido pela volta 1. Portanto ela prova que a IA entende
 * `confirmacao_nome` e conclui certo -- NAO prova que a saida da volta 1
 * atravessa a guarda e gera esse contexto. Essa prova exige teste integrado
 * (volta 1 -> guarda -> aguardando_resposta persistido -> volta 2), que so e
 * possivel depois da implementacao e e obrigatoria antes da adocao.
 */
function perguntaDeNome(nomeProposto: string, agendamentos: unknown[] = []) {
  return {
    aguardando_resposta: { tipo: 'confirmacao_nome', detalhe: { nome_proposto: nomeProposto } },
    dados_conhecidos: { procedimento: 'Consulta / Avaliação', data: 'hoje' },
    cadastro_paciente: { preenchidos: [] },
    agendamentos_do_paciente: agendamentos,
  };
}

/** Nome aceito ao fim da volta 2 -- `informou` ou `corrigiu`, nunca ausente. */
function nomeAceito(s: Saida, esperado: string): string | null {
  const n = achar(s, 'nome');
  if (n === undefined) return `nao capturou nome nenhum -- a duvida ficou sem resolucao`;
  if ((n.valor ?? '').toLowerCase().includes(esperado.toLowerCase())) return null;
  return `nome="${n.valor}", esperado "${esperado}"`;
}

const CASOS: Caso[] = [
  // ── 6.1 -- os defeitos reais ──────────────────────────────────────────────
  {
    id: '1',
    titulo: '"Pablo" escolhe dentista e NAO vira nome do paciente',
    origem: 'defeito',
    contexto: PERGUNTA_DENTISTA,
    mensagem: 'Pablo',
    verificar: (s) =>
      s.acao_solicitada.tipo !== 'escolher_dentista'
        ? `acao=${s.acao_solicitada.tipo}, esperado escolher_dentista`
        : achar(s, 'nome') !== undefined
          ? `gravou nome="${achar(s, 'nome')?.valor}" -- e a contaminacao medida em producao`
          : null,
  },
  {
    id: '2',
    titulo: '"Vanesa por favor" -- mesma coisa, com cortesia',
    origem: 'defeito',
    contexto: {
      ...PERGUNTA_DENTISTA,
      aguardando_resposta: { tipo: 'escolha_dentista', opcoes: ['Dr. Carlos Turiak', 'Dra. Vanesa Vocaro'] },
    },
    mensagem: 'vanesa por favor',
    verificar: (s) =>
      s.acao_solicitada.tipo !== 'escolher_dentista'
        ? `acao=${s.acao_solicitada.tipo}, esperado escolher_dentista`
        : achar(s, 'nome') !== undefined
          ? `gravou nome="${achar(s, 'nome')?.valor}"`
          : null,
  },
  {
    id: '3',
    titulo: '"meu nome nao e Pablo" -- REMOCAO, nunca gravar a frase como nome',
    origem: 'defeito',
    contexto: {
      aguardando_resposta: { tipo: 'confirmacao', detalhe: { data: '2026-08-14', horario: '10:00' } },
      dados_conhecidos: { procedimento: 'Extração simples', data: 'hoje', horario: '10:00' },
      // O estado JA carrega o nome contaminado -- e disso que ele reclama.
      cadastro_paciente: { preenchidos: ['nome'], nome_registrado: 'Pablo' },
      agendamentos_do_paciente: [],
    },
    mensagem: '10 hrs. mais meu nome não é pablo.',
    verificar: (s) => {
      const nome = achar(s, 'nome');
      if (nome === undefined) return 'nao reconheceu nenhuma operacao sobre o nome';
      // Contrato de DUAS operacoes (spec secao 4, decisao de 2026-08-14): o
      // paciente negou o nome registrado sem dar outro -> `corrigiu` com valor
      // NULO. String vazia e invalida, nunca normalizada.
      if (nome.operacao !== 'corrigiu') {
        return `operacao=${nome.operacao} valor="${nome.valor}" -- esperado corrigiu (ele negou o nome registrado)`;
      }
      // Sem normalizacao: string vazia ja foi recusada por `violacaoDeForma`.
      // So `null` representa remocao (spec secao 4).
      if (nome.valor !== null) {
        return `corrigiu com valor="${nome.valor}" -- ele nao forneceu nome novo, esperado null`;
      }
      return null;
    },
  },

  // ── 6.2 -- controles: nao pode regredir ───────────────────────────────────
  {
    id: '4',
    titulo: 'CONTROLE: tres dados cadastrais na mesma mensagem',
    origem: 'controle',
    contexto: {
      aguardando_resposta: { tipo: 'confirmacao', detalhe: { data: '2026-08-14', horario: '10:00' } },
      dados_conhecidos: { procedimento: 'Limpeza dental (profilaxia)', horario: '10:00' },
      cadastro_paciente: { preenchidos: [] },
      agendamentos_do_paciente: [],
    },
    mensagem: 'gabriel cappello cpf 06113236722 data 02-08-1973',
    verificar: (s) => {
      const faltando = ['nome', 'cpf', 'data_nascimento'].filter((c) => achar(s, c) === undefined);
      return faltando.length > 0 ? `perdeu ${faltando.join(', ')}` : null;
    },
  },
  {
    id: '5',
    titulo: 'CONTROLE: "pode ser" aceita a oferta de avaliacao',
    origem: 'controle',
    contexto: {
      aguardando_resposta: { tipo: 'oferta_procedimento', opcoes: ['Consulta / Avaliação'] },
      dados_conhecidos: {},
      cadastro_paciente: { preenchidos: [] },
      agendamentos_do_paciente: [],
    },
    mensagem: 'pode ser',
    verificar: (s) =>
      s.acao_solicitada.tipo === 'aceitar_oferta' || s.acao_solicitada.tipo === 'pedir_agendamento'
        ? null
        : `acao=${s.acao_solicitada.tipo}, esperado aceitar a oferta`,
  },
  {
    id: '6',
    titulo: 'CONTROLE: "o segundo" identifica o agendamento',
    origem: 'controle',
    contexto: {
      aguardando_resposta: {
        tipo: 'escolha_agendamento',
        opcoes: ['Limpeza com Dr. Diego — 20/08 às 09:00', 'Avaliação com Dr. Pablo — 25/08 às 14:00'],
      },
      dados_conhecidos: {},
      cadastro_paciente: { preenchidos: ['nome', 'cpf'] },
      agendamentos_do_paciente: [
        { procedimento: 'Limpeza dental (profilaxia)', dentista: 'Dr. Diego Ramoz', data: '2026-08-20', horario: '09:00' },
        { procedimento: 'Consulta / Avaliação', dentista: 'Dr. Pablo Arruda', data: '2026-08-25', horario: '14:00' },
      ],
    },
    mensagem: 'o segundo',
    verificar: (s) =>
      s.acao_solicitada.tipo !== 'escolher_agendamento'
        ? `acao=${s.acao_solicitada.tipo}, esperado escolher_agendamento`
        : (s.acao_solicitada.referencia ?? '').toLowerCase().includes('pablo') ||
            (s.acao_solicitada.referencia ?? '').includes('25')
          ? null
          : `referencia="${s.acao_solicitada.referencia}" nao aponta o segundo`,
  },
  {
    id: '7',
    titulo: 'CONTROLE: "na verdade 15h" e CORRECAO de horario',
    origem: 'controle',
    contexto: {
      aguardando_resposta: { tipo: 'confirmacao', detalhe: { data: '2026-08-14', horario: '10:00' } },
      dados_conhecidos: { procedimento: 'Limpeza dental (profilaxia)', data: 'hoje', horario: '10:00' },
      cadastro_paciente: { preenchidos: ['nome', 'cpf', 'data_nascimento'] },
      agendamentos_do_paciente: [],
    },
    mensagem: 'na verdade 15h',
    verificar: (s) => {
      const h = achar(s, 'horario');
      if (h === undefined) return 'nao reconheceu o horario';
      // A spec exige CORRECAO (secao 6.2). Aceitar `informou` esconderia a
      // regressao que este controle existe para detectar.
      return h.operacao === 'corrigiu' ? null : `operacao=${h.operacao}, esperado corrigiu`;
    },
  },
  {
    id: '8',
    titulo: 'AMBIGUIDADE CONHECIDA: "cancela isso" com fluxo aberto E agendamento',
    origem: 'controle',
    contexto: {
      aguardando_resposta: { tipo: 'confirmacao', detalhe: { data: '2026-08-20', horario: '09:00' } },
      dados_conhecidos: { procedimento: 'Limpeza dental (profilaxia)', data: '2026-08-20', horario: '09:00' },
      cadastro_paciente: { preenchidos: ['nome', 'cpf', 'data_nascimento'] },
      agendamentos_do_paciente: [
        { procedimento: 'Consulta / Avaliação', dentista: 'Dr. Pablo Arruda', data: '2026-08-25', horario: '14:00' },
      ],
    },
    mensagem: 'cancela isso',
    // Sem resposta "certa" definida (spec secao 6.2, caso 8): so registra.
    verificar: () => null,
  },

  // ── 6.4b -- SEGUNDA VOLTA: a duvida e resolvida? ──────────────────────────
  {
    id: '9',
    titulo: 'VOLTA 2: "sim, meu nome e Pablo" -- nome aceito',
    origem: 'defeito',
    contexto: perguntaDeNome('Pablo'),
    mensagem: 'sim, meu nome é Pablo',
    verificar: (s) => nomeAceito(s, 'Pablo'),
  },
  {
    id: '10',
    titulo: 'VOLTA 2: "nao, meu nome e Gabriel" -- Gabriel aceito, nunca Pablo',
    origem: 'defeito',
    contexto: perguntaDeNome('Pablo'),
    mensagem: 'não, meu nome é Gabriel',
    verificar: (s) => {
      const erro = nomeAceito(s, 'Gabriel');
      if (erro !== null) return erro;
      const n = achar(s, 'nome');
      return (n?.valor ?? '').toLowerCase().includes('pablo') ? `manteve Pablo (valor="${n?.valor}")` : null;
    },
  },
  // ── FORMATO REAL DE PRODUCAO (2026-08-14) ─────────────────────────────────
  //
  // Em producao NAO existe marcador para escolha de dentista: a decisao
  // `aguardando_escolha_dentista` grava `limpar`. Entao a Iris recebe
  // `aguardando_resposta: null` e `opcoes_apresentadas: []` -- a pergunta so
  // existe como TEXTO no historico.
  //
  // A pergunta decisiva: sem o marcador, a saida ainda traz
  // `escolher_dentista`? Se vier SO `nome`, nao ha co-ocorrencia e A GUARDA NAO
  // COBRE O DEFEITO -- ela dispara por co-ocorrencia, nunca por comparacao.
  {
    id: '12',
    titulo: 'PRODUCAO: "Pablo" com aguardando_resposta=null -- a guarda cobre?',
    origem: 'defeito',
    contexto: {
      dados_conhecidos: { procedimento: 'Consulta / Avaliação', data: 'hoje' },
      cadastro_paciente: { preenchidos: [] },
      agendamentos_do_paciente: [],
      opcoes_apresentadas: [],
      aguardando_resposta: null,
      procedimentos_disponiveis: [{ procedimento_id: 'consultation_evaluation', nome: 'Consulta / Avaliação' }],
      dentistas_disponiveis: [
        { dentista_id: 'd-1', nome_exibido: 'Dr. Diego Ramoz' },
        { dentista_id: 'd-2', nome_exibido: 'Dr. Pablo Arruda' },
      ],
    },
    historico: [
      { mensagem_paciente: 'quero um turno para hoje', resposta_iris: 'Claro! Qual procedimento você gostaria de agendar?' },
      {
        mensagem_paciente: 'avaliação seria',
        resposta_iris: 'Para a avaliação, você prefere o Dr. Diego Ramoz ou o Dr. Pablo Arruda? Qual deles seria melhor para você?',
      },
    ],
    mensagem: 'Pablo',
    verificar: (s) => {
      const temNome = achar(s, 'nome') !== undefined;
      const escolheu = s.acao_solicitada.tipo === 'escolher_dentista';
      if (!temNome) return null; // sem contaminacao: nada a cobrir
      return escolheu
        ? null // contaminou, mas a guarda VE (co-ocorrencia) -> coberto
        : `CONTAMINOU FORA DO ALCANCE DA GUARDA: acao=${s.acao_solicitada.tipo}, nome="${achar(s, 'nome')?.valor}"`;
    },
  },
  {
    id: '13',
    titulo: 'PRODUCAO: "vanesa por favor" com aguardando_resposta=null -- a guarda cobre?',
    origem: 'defeito',
    contexto: {
      dados_conhecidos: { procedimento: 'Consulta / Avaliação', data: 'amanha' },
      cadastro_paciente: { preenchidos: [] },
      agendamentos_do_paciente: [],
      opcoes_apresentadas: [],
      aguardando_resposta: null,
      procedimentos_disponiveis: [{ procedimento_id: 'consultation_evaluation', nome: 'Consulta / Avaliação' }],
      dentistas_disponiveis: [
        { dentista_id: 'd-3', nome_exibido: 'Dr. Carlos Turiak' },
        { dentista_id: 'd-4', nome_exibido: 'Dra. Vanesa Vocaro' },
      ],
    },
    historico: [
      {
        mensagem_paciente: 'uma avaliação',
        resposta_iris: 'Você pode escolher entre o Dr. Carlos Turiak e a Dra. Vanesa Vocaro para sua avaliação. Qual dentista você prefere?',
      },
    ],
    mensagem: 'vanesa por favor',
    verificar: (s) => {
      const temNome = achar(s, 'nome') !== undefined;
      const escolheu = s.acao_solicitada.tipo === 'escolher_dentista';
      if (!temNome) return null;
      return escolheu
        ? null
        : `CONTAMINOU FORA DO ALCANCE DA GUARDA: acao=${s.acao_solicitada.tipo}, nome="${achar(s, 'nome')?.valor}"`;
    },
  },
  {
    id: '11',
    titulo: 'VOLTA 2: custo declarado -- pergunta extra NAO destroi o nome ja dado',
    origem: 'defeito',
    // A guarda intercepta o `nome` DECLARADO -- que aqui e Gabriel, nunca a
    // dentista escolhida. Corrigido apos revisao do Codex (2026-08-14).
    contexto: perguntaDeNome('Gabriel'),
    mensagem: 'Gabriel mesmo',
    verificar: (s) => nomeAceito(s, 'Gabriel'),
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
  const cliente = criarClienteMedicao({ chaveApi });

  console.log(`\nMEDICAO -- contrato de contexto unificado (${repeticoes}x por caso)\n`);

  let defeitosOk = 0, defeitosTotal = 0, controlesOk = 0, controlesTotal = 0;

  for (const caso of CASOS) {
    const falhas: string[] = [];
    const observado: string[] = [];

    for (let i = 0; i < repeticoes; i++) {
      let saida: Saida;
      try {
        saida = (await cliente.executar({
          instrucoes: INSTRUCOES,
          schema: SCHEMA,
          nomeSchema: 'contexto_unificado_v1',
          payload: {
            contexto_relevante: caso.contexto,
            mensagem_atual: caso.mensagem,
            historico_recente: caso.historico ?? [],
          },
        })) as Saida;
      } catch (erro) {
        const detalhe = erro instanceof ErroClienteMedicao ? `${erro.categoria}/${erro.codigo}` : 'desconhecido';
        falhas.push(`chamada falhou (${detalhe})`);
        continue;
      }

      const dados =
        saida.informacoes_fornecidas
          .map((x) => `${x.campo}:${x.operacao}=${x.valor === null ? 'null' : `"${x.valor}"`}`)
          .join(', ') || '—';
      observado.push(`${saida.acao_solicitada.tipo} | ${dados}`);
      const forma = violacaoDeForma(saida);
      const motivo = forma !== null ? forma : caso.verificar(saida);
      if (motivo !== null) falhas.push(motivo);
    }

    const ok = repeticoes - falhas.length;
    const rotulo = caso.origem === 'defeito' ? 'DEFEITO ' : 'CONTROLE';
    const marca = falhas.length === 0 ? 'PASSOU' : `FALHOU ${falhas.length}/${repeticoes}`;
    console.log(`[${rotulo}] caso ${caso.id}: ${marca}  -- ${caso.titulo}`);
    for (const linha of [...new Set(observado)]) console.log(`            saida: ${linha}`);
    for (const motivo of [...new Set(falhas)]) console.log(`            FALHA: ${motivo}`);
    console.log('');

    if (caso.origem === 'defeito') { defeitosOk += ok; defeitosTotal += repeticoes; }
    else { controlesOk += ok; controlesTotal += repeticoes; }
  }

  console.log('─'.repeat(70));
  console.log(`defeitos corrigidos : ${defeitosOk}/${defeitosTotal}`);
  console.log(`controles preservados: ${controlesOk}/${controlesTotal}`);
  console.log(
    '\nCriterio de adocao (spec secao 6.3):\n' +
    '  - casos 1-2 estaveis OU cobertos pela guarda estrutural (spec secao 5.1);\n' +
    '  - caso 3 correto de forma estavel: `corrigiu` com valor null, por merito do\n' +
    '    contrato -- nenhuma guarda o cobre;\n' +
    '  - casos 9-11 concluindo certo na volta 2. O contexto da volta 2 e FABRICADO\n' +
    '    aqui: o teste integrado real (volta 1 -> guarda -> aguardando_resposta\n' +
    '    persistido -> volta 2) so e possivel apos a implementacao e continua\n' +
    '    OBRIGATORIO antes da adocao;\n' +
    '  - zero regressao nos controles 4-7.\n' +
    '\nO caso 8 e ambiguidade conhecida -- registrado, sem exigencia de melhora.\n' +
    '\nATENCAO ao ler o total: o caso 2 oscilou entre 5/8 e 8/8 em rodadas\n' +
    'sucessivas, sem mudanca de contrato. Um total redondo numa rodada NAO\n' +
    'significa defeito resolvido -- e exatamente essa instabilidade que torna a\n' +
    'guarda estrutural necessaria.\n'
  );
}

void principal();
