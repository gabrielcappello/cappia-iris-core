// ETAPA 1 da Arquitetura V2 (docs/07-arquitetura-v2.md secao 10):
// o contrato de capacidade sobrevive a CONVERSA MULTI-TURNO com fluxo em
// andamento?
//
// ── A LACUNA QUE ESTA MEDICAO FECHA ─────────────────────────────────────
// A sonda de 2026-08-12 provou 20/20 em turno UNICO, sem historico e sem
// fluxo aberto. Isso nao prova nada sobre o caso dificil -- que e
// justamente onde a arquitetura ANTIGA falhava:
//
//   `decidirPorNatureza` (orquestrador.ts) descartava a classificacao da IA
//   sempre que `dados.procedimento_id` existia. O motivo declarado no
//   proprio codigo: "com procedimento ja conhecido, a duvida nao pode
//   interromper o fluxo em andamento". Ou seja: o modelo antigo tinha uma
//   REGRA para o caso dificil. A V2 propoe nao ter regra nenhuma -- a Iris
//   decide. Esta medicao existe para descobrir se isso se sustenta.
//
// ── CASOS REAIS, NUNCA INVENTADOS ───────────────────────────────────────
// Todas as mensagens vem de conversas REAIS de WhatsApp registradas nesta
// sessao (2026-08-12) ou em 2026-08-07 -- inclusive os erros de digitacao.
// docs/00-principios.md, principio dos testes realistas.
//
// ── ESCOPO DELIBERADO ───────────────────────────────────────────────────
// Mede SOMENTE a escolha de capacidade. Extracao de parametros (qual
// procedimento, qual data) fica fora: e uma pergunta separada, e mistura-la
// aqui impediria saber qual das duas falhou. Contrato MINIMO, sem nenhuma
// regra por capacidade -- se precisar de regra, isso e o achado.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-capacidade-multiturno.ts

import { criarClienteMedicao, ErroClienteMedicao, MODELO_MEDICAO, type ClienteMedicao } from './cliente-medicao-openai.ts';

const CAPACIDADES = [
  'consultar_agendamento_do_paciente',
  'consultar_disponibilidade',
  'criar_agendamento',
  'remarcar_agendamento',
  'cancelar_agendamento',
  'nenhuma_apenas_conversar',
] as const;
type Capacidade = (typeof CAPACIDADES)[number];

const SCHEMA = {
  type: 'object',
  properties: {
    capacidade: { type: 'string', enum: [...CAPACIDADES] },
    justificativa: { type: 'string' },
  },
  required: ['capacidade', 'justificativa'],
  additionalProperties: false,
};

// MINIMO. Nenhuma regra por capacidade, nenhum exemplo de frase, nenhuma
// instrucao sobre "fluxo em andamento" -- exatamente o que a V2 propoe.
const INSTRUCOES = `
Voce e a Iris, assistente de uma clinica odontologica, conversando com um paciente pelo WhatsApp.

Leia a conversa e decida UMA coisa: qual capacidade do sistema voce precisa acionar agora para responder bem a ultima mensagem do paciente.

Valores possiveis para capacidade:
${CAPACIDADES.map((c) => `- ${c}`).join('\n')}

Use "nenhuma_apenas_conversar" quando conseguir responder sem consultar nem alterar nada no sistema.

Em "justificativa", explique em uma frase curta o que voce entendeu que o paciente quer.
`.trim();

// --- Contexto factual que o Core carrega e entrega a Iris ---
const PROCEDIMENTOS = [
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental' },
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
  { procedimento_id: 'canal', nome_pt: 'Tratamento de canal' },
];
const DENTISTAS = [{ dentista_id: 'dent-carlos', nome_exibido: 'Dr. Carlos Turiak' }];

const AGENDAMENTO_FUTURO = {
  data: '2026-08-13',
  horario: '10:00',
  procedimento: 'Consulta / Avaliação',
  dentista_nome: 'Dr. Carlos Turiak',
};

interface Par {
  mensagem_paciente: string;
  resposta_iris: string;
}

interface Caso {
  id: string;
  grupo: string;
  mensagem: string;
  historico?: Par[];
  dados_conhecidos?: Record<string, string>;
  horarios_oferecidos?: string[];
  agendamento_futuro?: typeof AGENDAMENTO_FUTURO;
  /** Conjunto aceitavel. Quando tem 1 item, e criterio duro. */
  aceitaveis: readonly Capacidade[];
  /** Capacidades que representam FALHA REAL neste contexto. */
  jamais: readonly Capacidade[];
  nota?: string;
}

// ── GRUPO 1: o bug real de producao que motivou a V2 ────────────────────
const GRUPO_REGRESSAO: Caso[] = [
  {
    id: '1a',
    grupo: 'regressao real',
    nota: 'Conversa REAL de 12/08. Hoje reentra em disponibilidade e oferece 09:30/10:30.',
    historico: [
      {
        mensagem_paciente: 'sim pode confirmar',
        resposta_iris: 'Gabriel, seu agendamento está confirmado para o dia 13/08 às 10:00. Qualquer coisa que precisar, é só chamar!',
      },
    ],
    agendamento_futuro: AGENDAMENTO_FUTURO,
    mensagem: 'obrigado',
    aceitaveis: ['nenhuma_apenas_conversar'],
    jamais: ['consultar_disponibilidade', 'criar_agendamento', 'remarcar_agendamento', 'cancelar_agendamento'],
  },
  {
    id: '1b',
    grupo: 'regressao real',
    nota: 'Consultar ou responder do contexto ja entregue -- ambos corretos. Entrar em disponibilidade e o erro.',
    historico: [
      {
        mensagem_paciente: 'sim pode confirmar',
        resposta_iris: 'Gabriel, seu agendamento está confirmado para o dia 13/08 às 10:00.',
      },
    ],
    agendamento_futuro: AGENDAMENTO_FUTURO,
    mensagem: 'meu agendamento de amanhã está confirmado?',
    aceitaveis: ['consultar_agendamento_do_paciente', 'nenhuma_apenas_conversar'],
    jamais: ['consultar_disponibilidade', 'criar_agendamento', 'remarcar_agendamento', 'cancelar_agendamento'],
  },
];

// ── GRUPO 2: duvida DURANTE fluxo aberto (o que procedimentoAusente barrava) ──
const FLUXO_ABERTO = {
  historico: [
    {
      mensagem_paciente: 'estou com dor de dente. acho melhor uma avaliação',
      resposta_iris:
        'Poxa, dor de dente nunca é fácil, né? Para avaliação amanhã, temos horários disponíveis às 08:00, 09:00, 10:00 e 11:30. Qual horário seria melhor para você?',
    },
  ],
  dados_conhecidos: { procedimento: 'Consulta / Avaliação', data: 'amanhã' },
  horarios_oferecidos: ['08:00', '09:00', '10:00', '11:30'],
};

const GRUPO_DUVIDA_EM_FLUXO: Caso[] = [
  {
    id: '2a',
    grupo: 'duvida em fluxo aberto',
    nota: 'A resposta ja esta no contexto (amanha). Hoje o Core ignora a pergunta e continua o fluxo.',
    ...FLUXO_ABERTO,
    mensagem: 'esse horário é para qual dia?',
    aceitaveis: ['nenhuma_apenas_conversar'],
    jamais: ['criar_agendamento', 'remarcar_agendamento', 'cancelar_agendamento'],
  },
  {
    id: '2b',
    grupo: 'duvida em fluxo aberto',
    ...FLUXO_ABERTO,
    mensagem: 'quanto custa a avaliação?',
    aceitaveis: ['nenhuma_apenas_conversar'],
    jamais: ['criar_agendamento', 'remarcar_agendamento', 'cancelar_agendamento', 'consultar_agendamento_do_paciente'],
  },
  {
    id: '2c',
    grupo: 'duvida em fluxo aberto',
    nota: 'Frase REAL de 07/08, respondendo a "só um minutinho".',
    historico: [
      {
        mensagem_paciente: 'Tem para amanhã de manhã?',
        resposta_iris: 'Vou verificar as opções de avaliação para amanhã de manhã e já te retorno, tá bem? Só um minutinho!',
      },
    ],
    dados_conhecidos: { procedimento: 'Consulta / Avaliação', data: 'amanhã', periodo: 'manhã' },
    mensagem: 'Un instante quanto?',
    aceitaveis: ['nenhuma_apenas_conversar'],
    jamais: ['criar_agendamento', 'remarcar_agendamento', 'cancelar_agendamento'],
  },
];

// ── GRUPO 3: o fluxo precisa AVANCAR quando o paciente avanca ───────────
const GRUPO_CONTINUIDADE: Caso[] = [
  {
    id: '3a',
    grupo: 'continuidade do fluxo',
    nota: 'Frase REAL de 07/08. Nao pode virar conversa fiada -- precisa buscar horarios.',
    historico: [
      {
        mensagem_paciente: 'quero um turno para amanha',
        resposta_iris: 'Oi! Para agendar o seu turno, você pode me dizer qual procedimento você precisa fazer? Assim consigo ajudar melhor.',
      },
    ],
    dados_conhecidos: { data: 'amanhã' },
    mensagem: 'Avaliação né',
    aceitaveis: ['consultar_disponibilidade'],
    jamais: ['nenhuma_apenas_conversar', 'cancelar_agendamento', 'remarcar_agendamento'],
  },
  {
    id: '3b',
    grupo: 'continuidade do fluxo',
    nota: 'Frase REAL de 12/08. Escolheu horario: algo TEM de acontecer.',
    ...FLUXO_ABERTO,
    mensagem: '10hrs fica bem',
    aceitaveis: ['criar_agendamento', 'consultar_disponibilidade'],
    jamais: ['nenhuma_apenas_conversar', 'cancelar_agendamento', 'remarcar_agendamento'],
  },
  {
    id: '3c',
    grupo: 'continuidade do fluxo',
    nota: 'Frase REAL de 12/08, confirmando a proposta.',
    historico: [
      {
        mensagem_paciente: '10hrs fica bem',
        resposta_iris: 'Perfeito, então estou confirmando para o dia 13/08 às 10h, pode me confirmar se está tudo certo para você?',
      },
    ],
    dados_conhecidos: { procedimento: 'Consulta / Avaliação', data: '2026-08-13', horario: '10:00' },
    mensagem: 'sim pode confirmar',
    aceitaveis: ['criar_agendamento'],
    jamais: ['nenhuma_apenas_conversar', 'cancelar_agendamento', 'remarcar_agendamento', 'consultar_disponibilidade'],
  },
];

// ── GRUPO 4: operacoes sobre agendamento existente ──────────────────────
const GRUPO_OPERACOES: Caso[] = [
  {
    id: '4a',
    grupo: 'operacoes',
    agendamento_futuro: AGENDAMENTO_FUTURO,
    mensagem: 'quero cancelar minha consulta',
    aceitaveis: ['cancelar_agendamento'],
    jamais: ['criar_agendamento', 'consultar_disponibilidade', 'nenhuma_apenas_conversar'],
  },
  {
    id: '4b',
    grupo: 'operacoes',
    agendamento_futuro: AGENDAMENTO_FUTURO,
    mensagem: 'preciso mudar meu horário',
    aceitaveis: ['remarcar_agendamento'],
    jamais: ['criar_agendamento', 'cancelar_agendamento', 'nenhuma_apenas_conversar'],
  },
  {
    id: '4c',
    grupo: 'operacoes',
    nota: 'Exemplo do proprio Gabriel. Remarcar/cancelar/conversar sao todos defensaveis; criar do zero nao.',
    agendamento_futuro: AGENDAMENTO_FUTURO,
    mensagem: 'não consigo ir amanhã',
    aceitaveis: ['remarcar_agendamento', 'cancelar_agendamento', 'nenhuma_apenas_conversar'],
    jamais: ['criar_agendamento', 'consultar_disponibilidade'],
  },
  {
    id: '4d',
    grupo: 'operacoes',
    nota:
      'Distincao documentada em specs/remarcacao-conversacional-v1.md: paciente COM agendamento que pede OUTRO procedimento quer um SEGUNDO agendamento, nunca remarcar o primeiro. O modelo antigo acertava isso por `dados.intencao`.',
    agendamento_futuro: AGENDAMENTO_FUTURO,
    mensagem: 'queria marcar uma limpeza também',
    aceitaveis: ['consultar_disponibilidade', 'criar_agendamento'],
    jamais: ['remarcar_agendamento', 'cancelar_agendamento'],
  },
  {
    id: '4e',
    grupo: 'operacoes',
    nota:
      'O CASO MAIS PERIGOSO DO SISTEMA. "cancela isso" no meio de um fluxo de agendamento significa DESISTIR do fluxo -- mas o paciente TEM um agendamento real que poderia ser cancelado por engano. Medido em ~75% no contrato antigo (specs/cancelamento-conversacional-v1.md).',
    ...FLUXO_ABERTO,
    agendamento_futuro: AGENDAMENTO_FUTURO,
    mensagem: 'cancela isso',
    aceitaveis: ['nenhuma_apenas_conversar'],
    jamais: ['cancelar_agendamento', 'criar_agendamento', 'remarcar_agendamento'],
  },
];

// ── GRUPO 5: conversa pura ──────────────────────────────────────────────
const GRUPO_CONVERSA: Caso[] = [
  {
    id: '5a',
    grupo: 'conversa pura',
    nota: 'Frase REAL de 12/08, conversa limpa.',
    mensagem: 'ola. boa tarde',
    aceitaveis: ['nenhuma_apenas_conversar'],
    jamais: ['criar_agendamento', 'cancelar_agendamento', 'remarcar_agendamento'],
  },
  {
    id: '5b',
    grupo: 'conversa pura',
    nota: 'Frase REAL de 07/08. Ainda nao ha procedimento decidido.',
    mensagem: 'Estou com dor de dente dos infernos, queria concertar',
    aceitaveis: ['nenhuma_apenas_conversar', 'consultar_disponibilidade'],
    jamais: ['criar_agendamento', 'cancelar_agendamento', 'remarcar_agendamento'],
  },
  {
    id: '5c',
    grupo: 'conversa pura',
    nota: 'Desistencia no meio do fluxo -- nada pode ser executado.',
    ...FLUXO_ABERTO,
    mensagem: 'deixa pra lá',
    aceitaveis: ['nenhuma_apenas_conversar'],
    jamais: ['criar_agendamento', 'cancelar_agendamento', 'remarcar_agendamento', 'consultar_disponibilidade'],
  },
];

const CASOS: readonly Caso[] = [
  ...GRUPO_REGRESSAO,
  ...GRUPO_DUVIDA_EM_FLUXO,
  ...GRUPO_CONTINUIDADE,
  ...GRUPO_OPERACOES,
  ...GRUPO_CONVERSA,
];

const REPETICOES = 4;
const MAX_RETENTATIVAS = 2;

function montarPayload(caso: Caso): unknown {
  return {
    mensagens_atuais: [caso.mensagem],
    ...(caso.historico !== undefined ? { historico_recente: caso.historico } : {}),
    ...(caso.dados_conhecidos !== undefined ? { dados_conhecidos: caso.dados_conhecidos } : {}),
    ...(caso.horarios_oferecidos !== undefined ? { horarios_oferecidos: caso.horarios_oferecidos } : {}),
    ...(caso.agendamento_futuro !== undefined ? { agendamento_futuro: caso.agendamento_futuro } : {}),
    procedimentos_disponiveis: PROCEDIMENTOS,
    dentistas_disponiveis: DENTISTAS,
  };
}

async function observar(cliente: ClienteMedicao, caso: Caso): Promise<{ capacidade: Capacidade; justificativa: string } | null> {
  for (let tentativa = 0; tentativa <= MAX_RETENTATIVAS; tentativa++) {
    try {
      const saida = (await cliente.executar({
        instrucoes: INSTRUCOES,
        schema: SCHEMA,
        payload: montarPayload(caso),
        nomeSchema: 'decisao_capacidade',
      })) as { capacidade: Capacidade; justificativa: string };
      return saida;
    } catch (erro) {
      const repetivel =
        erro instanceof ErroClienteMedicao && (erro.categoria === 'resposta_truncada' || erro.categoria === 'rede');
      if (repetivel && tentativa < MAX_RETENTATIVAS) continue;
      console.error(`     erro: ${erro instanceof Error ? erro.message : 'desconhecido'}`);
      return null;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- ETAPA 1: contrato de capacidade em conversa MULTI-TURNO ---');
  console.log(`modelo: ${MODELO_MEDICAO} | instrumento: cliente de medicao (Etapa 0)`);
  console.log('Contrato MINIMO: nenhuma regra por capacidade, nenhum exemplo de frase.');
  console.log(`casos: ${CASOS.length} x ${REPETICOES} repeticoes = ${CASOS.length * REPETICOES} chamadas`);

  const cliente = criarClienteMedicao({ chaveApi });

  let aceitaveisTotal = 0;
  let chamadasTotal = 0;
  let violacoesGraves = 0;
  let erros = 0;
  const casosComViolacao: string[] = [];
  const casosImperfeitos: string[] = [];
  let grupoAtual = '';

  for (const caso of CASOS) {
    if (caso.grupo !== grupoAtual) {
      grupoAtual = caso.grupo;
      console.log('');
      console.log(`##### ${grupoAtual.toUpperCase()} #####`);
    }

    const observadas = new Map<string, number>();
    let ok = 0;
    let graves = 0;
    let exemplo = '';

    for (let r = 0; r < REPETICOES; r++) {
      const saida = await observar(cliente, caso);
      chamadasTotal++;
      if (saida === null) { erros++; continue; }
      observadas.set(saida.capacidade, (observadas.get(saida.capacidade) ?? 0) + 1);
      if (exemplo === '') exemplo = saida.justificativa;
      if (caso.aceitaveis.includes(saida.capacidade)) { ok++; aceitaveisTotal++; }
      if (caso.jamais.includes(saida.capacidade)) { graves++; violacoesGraves++; }
    }

    const marca = graves > 0 ? '!!!' : ok === REPETICOES ? 'OK ' : '~~ ';
    if (graves > 0) casosComViolacao.push(caso.id);
    else if (ok !== REPETICOES) casosImperfeitos.push(caso.id);

    const distribuicao = [...observadas.entries()].map(([c, n]) => `${c}:${n}`).join(' ');
    console.log(`${marca} [${caso.id}] "${caso.mensagem}"`);
    console.log(`      aceitavel ${ok}/${REPETICOES}${graves > 0 ? ` | VIOLACAO GRAVE ${graves}/${REPETICOES}` : ''}`);
    console.log(`      observado: ${distribuicao}`);
    console.log(`      justificativa: "${exemplo}"`);
    if (caso.nota !== undefined) console.log(`      nota: ${caso.nota}`);
  }

  console.log('');
  console.log('--- resumo ---');
  console.log(`  decisoes aceitaveis      : ${aceitaveisTotal}/${chamadasTotal}`);
  console.log(`  VIOLACOES GRAVES         : ${violacoesGraves}/${chamadasTotal}`);
  console.log(`  erros de infra           : ${erros}`);
  console.log(`  casos com violacao grave : ${casosComViolacao.length > 0 ? casosComViolacao.join(', ') : 'nenhum'}`);
  console.log(`  casos imperfeitos        : ${casosImperfeitos.length > 0 ? casosImperfeitos.join(', ') : 'nenhum'}`);
  console.log('');
  console.log(
    violacoesGraves === 0
      ? '  NENHUMA VIOLACAO GRAVE -- o contrato minimo se sustentou nos cenarios medidos.'
      : `  ${violacoesGraves} VIOLACAO(OES) GRAVE(S) -- o contrato minimo NAO basta nestes cenarios.`
  );
  process.exitCode = violacoesGraves === 0 ? 0 : 1;
}

main().catch((erro) => {
  console.error(`erro fatal: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
