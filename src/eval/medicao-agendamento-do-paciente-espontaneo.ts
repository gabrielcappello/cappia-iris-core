// Sonda ISOLADA de CONTRATO: medir se a interpretadora consegue identificar
// o agendamento de ORIGEM de uma remarcacao a partir de uma mencao
// ESPONTANEA do paciente (primeiro turno, sem pergunta previa) -- usando
// "agendamentos_do_paciente" (contexto, ja enviado hoje) em vez de
// "agendamentos_ativos" (que so existe apos o Core ja ter perguntado "qual
// desses?").
//
// POR QUE ESTA SONDA EXISTE: a medicao de 2026-08-11
// (src/eval/medicao-escolha-agendamento.ts, specs/remarcacao-conversacional-
// v1.md secao 3) provou 11/11 que a IA correlaciona bem uma lista de
// agendamentos QUANDO ELA E A PROPRIA PERGUNTA DO TURNO ("qual desses voce
// quer remarcar?"). Ela NUNCA testou o cenario onde o paciente menciona o
// agendamento espontaneamente, na mesma frase que abre o pedido de
// remarcacao ("remarcar a cirurgia de implante do dia 9"), sem que o sistema
// tenha perguntado antes -- caso real medido em producao
// (specs/guarda-redatora-fiscal-conversa-v1.md, investigacao continuada,
// 2026-09-06). Contrato de resolucao semantica neste projeto se escolhe por
// medicao real, nunca por suposicao (mesmo principio da sonda de 2026-08-11).
//
// TRES CENARIOS, MESMA LISTA DE 3 AGENDAMENTOS REAIS (o caso real: canal,
// implante, restauracao pendente/agendada -- adaptado para exercitar
// procedimento+data, so-data, e ambiguidade real):
//
//   CLARO    -- referencia inequivoca por procedimento + data
//               ("cirurgia de implante do dia 9") ou so por data quando
//               suficiente ("o de amanha"). Esperado: agendamento_id correto.
//   AMBIGUO  -- referencia que poderia ser mais de um item da lista, ou
//               nenhuma referencia identificavel. Esperado: agendamento_id
//               AUSENTE (omitido) -- nunca um palpite.
//   FALSO POSITIVO -- mensagem que menciona procedimento/data mas NAO e um
//               pedido de remarcar aquele agendamento especifico (ex.:
//               pergunta sobre o procedimento, ou pede um NOVO agendamento
//               parecido com um que ja existe). Esperado: agendamento_id
//               AUSENTE -- emitir aqui seria remarcar algo que o paciente
//               nao pediu.
//
// NADA DE PRODUCAO E TOCADO: nao importa nem altera nenhum modulo de
// src/core/, nao escreve em banco, nao muda schema, migration, RPC nem Edge
// Function.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-agendamento-do-paciente-espontaneo.ts

const MODELO = 'gpt-5.6-luna' as const; // modelo de producao (cliente-modelo-openai.ts)
const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const TIMEOUT_MS = 20000;
const MAX_OUTPUT_TOKENS = 400;

const CHAVE = process.env.OPENAI_API_KEY;
if (!CHAVE) {
  console.error('OPENAI_API_KEY ausente. Rode com --env-file apontando para o cofre canonico.');
  process.exit(1);
}

// --- Cenario: os 3 agendamentos do caso real (nomes/ids sinteticos) ---

const AG_CANAL = '11111111-1111-4111-8111-111111111111'; // 07/09, retratamento de canal
const AG_IMPLANTE = '22222222-2222-4222-8222-222222222222'; // 09/09, cirurgia de implante
const AG_RESTAURACAO = '33333333-3333-4333-8333-333333333333'; // 28/09, restauracao

const AGENDAMENTOS_DO_PACIENTE = [
  {
    agendamento_id: AG_CANAL,
    descricao: 'Retratamento de canal com Dr. Pablo Arruda — segunda-feira, 07/09 às 08:00',
    procedimento_id: 'canal',
    data: '2026-09-07',
    horario: '08:00',
  },
  {
    agendamento_id: AG_IMPLANTE,
    descricao: 'Cirurgia de implante com Dr. Pablo Arruda — quarta-feira, 09/09 às 10:30',
    procedimento_id: 'implante',
    data: '2026-09-09',
    horario: '10:30',
  },
  {
    agendamento_id: AG_RESTAURACAO,
    descricao: 'Restauração / Cárie (1 face) com Dr. Pablo Arruda — 28/09 às 08:00',
    procedimento_id: 'restauracao',
    data: '2026-09-28',
    horario: '08:00',
  },
];

interface Caso {
  categoria: 'claro' | 'ambiguo' | 'falso_positivo';
  mensagem: string;
  esperado: string | null; // agendamento_id esperado, ou null se deve omitir
  como: string;
}

const CASOS: Caso[] = [
  // --- CLARO: procedimento + data ---
  { categoria: 'claro', mensagem: 'poderia por favor remarcar a cirugia de implantes do dia 9?', esperado: AG_IMPLANTE, como: 'procedimento + data (caso real medido)' },
  { categoria: 'claro', mensagem: 'quero remarcar o retratamento de canal de segunda', esperado: AG_CANAL, como: 'procedimento + dia da semana' },
  // --- CLARO: so a data, quando suficiente (unico agendamento naquela data) ---
  { categoria: 'claro', mensagem: 'preciso remarcar o que eu tenho pro dia 28', esperado: AG_RESTAURACAO, como: 'so data, unica correspondencia' },
  { categoria: 'claro', mensagem: 'da pra mudar meu horario do dia 9?', esperado: AG_IMPLANTE, como: 'so data (dia 9), unica correspondencia' },
  // --- AMBIGUO: referencia generica sem elemento discriminador ---
  { categoria: 'ambiguo', mensagem: 'quero remarcar minha consulta', esperado: null, como: 'nenhum procedimento/data mencionado, 3 candidatos' },
  { categoria: 'ambiguo', mensagem: 'preciso trocar o horario do meu agendamento com o Dr. Pablo', esperado: null, como: 'dentista igual nos 3, nao discrimina' },
  // --- FALSO POSITIVO: menciona procedimento/data mas NAO pede remarcar ESSE agendamento ---
  { categoria: 'falso_positivo', mensagem: 'quanto custa a cirurgia de implante?', esperado: null, como: 'pergunta sobre o procedimento, nao pedido de remarcar' },
  { categoria: 'falso_positivo', mensagem: 'quero marcar uma nova restauração pro dia 30', esperado: null, como: 'pedido de agendamento NOVO, procedimento parecido com o existente' },
  { categoria: 'falso_positivo', mensagem: 'no dia 9 voces abrem que horas?', esperado: null, como: 'pergunta sobre funcionamento, data coincide com agendamento existente' },
];

// --- Instrucao: recorte fiel do par existente hoje (agendamentos_do_paciente
// como CONTEXTO + a extensao proposta para permitir agendamento_id a partir
// dele quando a referencia for inequivoca) ---

const INSTRUCAO_BASE = `Voce e a camada de interpretacao de uma assistente de clinica odontologica.
Leia a mensagem atual do paciente e devolva SOMENTE dados estruturados, no formato do schema.
Nunca converse, nunca responda ao paciente, nunca invente dado que nao esta na mensagem.

Classifique "natureza_mensagem" com exatamente um destes valores: saudacao, duvida, pedido, resposta, correcao, negacao, nao_compreendida.

Em "alteracoes", cada chave e um campo e o valor tem "acao" ("informar", "corrigir" ou "remover") e "valor".`;

// Contrato PROPOSTO (extensao sobre a instrucao real de agendamentos_do_paciente):
const INSTRUCAO_PROPOSTA = `${INSTRUCAO_BASE}

- "agendamentos_do_paciente" (quando presente): as consultas que ele JA TEM marcadas, cada uma com "agendamento_id", "descricao", "data" e "horario". E CONTEXTO, nao pergunta em aberto. Quando o paciente pedir para remarcar, adiantar, atrasar ou mudar um atendimento que ele JA TEM marcado, e a referencia dele (procedimento, data, dia da semana, ou combinacao) identificar CLARAMENTE UM UNICO item dessa lista, preencha "agendamento_id" com o identificador correspondente, copiado LITERALMENTE da lista. Em duvida real sobre qual dos agendamentos ele quer -- inclusive quando a mensagem nao permite diferenciar entre dois ou mais itens, ou nao menciona procedimento/data/horario suficiente -- omita "agendamento_id" e deixe o sistema perguntar; nunca escolha por aproximacao. NUNCA preencha "agendamento_id" quando a mensagem NAO for um pedido de remarcar aquele agendamento especifico -- uma pergunta sobre o procedimento (preco, duracao), um pedido de agendamento NOVO (mesmo que pareca com um existente), ou uma pergunta sobre funcionamento da clinica NAO emitem "agendamento_id", mesmo que mencionem a mesma data ou procedimento de um agendamento existente.`;

// --- Schema ---

function schema() {
  const campos: Record<string, unknown> = {
    intencao: campoAlteracao(),
    procedimento_id: campoAlteracao(),
    dentista_id: campoAlteracao(),
    data_texto: campoAlteracao(),
    horario_texto: campoAlteracao(),
    confirmacao: campoAlteracao(),
    agendamento_id: campoAlteracao(),
  };
  return {
    type: 'object',
    properties: {
      natureza_mensagem: {
        type: 'string',
        enum: ['saudacao', 'duvida', 'pedido', 'resposta', 'correcao', 'negacao', 'nao_compreendida'],
      },
      alteracoes: { type: 'object', properties: campos, required: Object.keys(campos), additionalProperties: false },
    },
    required: ['natureza_mensagem', 'alteracoes'],
    additionalProperties: false,
  };
}

function campoAlteracao() {
  return {
    type: ['object', 'null'],
    properties: {
      acao: { type: 'string', enum: ['informar', 'corrigir', 'remover'] },
      valor: { type: ['string', 'null'] },
    },
    required: ['acao', 'valor'],
    additionalProperties: false,
  };
}

// --- Chamada ---

async function chamar(caso: Caso): Promise<Record<string, unknown> | null> {
  const payload = {
    mensagens_atuais: [caso.mensagem],
    dados_atuais: {},
    campos_cadastrais_preenchidos: ['nome', 'cpf', 'data_nascimento'],
    // CONTEXTO, nunca pergunta em aberto -- sem "agendamentos_ativos" (nao ha
    // escolha pendente: e o PRIMEIRO turno espontaneo, exatamente o cenario
    // que a medicao de 2026-08-11 nao cobriu).
    agendamentos_do_paciente: AGENDAMENTOS_DO_PACIENTE,
  };

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch(URL_RESPONSES, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${CHAVE}` },
      body: JSON.stringify({
        model: MODELO,
        instructions: INSTRUCAO_PROPOSTA,
        input: JSON.stringify(payload),
        max_output_tokens: MAX_OUTPUT_TOKENS,
        text: {
          format: { type: 'json_schema', name: 'interpretacao', strict: true, schema: schema() },
        },
      }),
      signal: controlador.signal,
    });
    if (!resposta.ok) {
      console.error(`  HTTP ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`);
      return null;
    }
    const corpo = (await resposta.json()) as { output?: { content?: { text?: string }[] }[] };
    const texto = corpo.output?.flatMap((o) => o.content ?? []).find((c) => typeof c.text === 'string')?.text;
    return texto ? (JSON.parse(texto) as Record<string, unknown>) : null;
  } catch (erro) {
    console.error(`  falhou: ${erro instanceof Error ? erro.name : 'desconhecido'}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function rotulo(id: string | null): string {
  if (id === null) return '(ausente)';
  if (id === AG_CANAL) return 'AG_CANAL';
  if (id === AG_IMPLANTE) return 'AG_IMPLANTE';
  if (id === AG_RESTAURACAO) return 'AG_RESTAURACAO';
  return id.slice(0, 8);
}

// --- Runner ---

async function main() {
  console.log('Medicao: identificacao ESPONTANEA de agendamento de origem via agendamentos_do_paciente');
  console.log(`Modelo: ${MODELO} | casos: ${CASOS.length}\n`);

  let acertosClaro = 0;
  let totalClaro = 0;
  let corretosAmbiguo = 0; // omitiu, como esperado
  let totalAmbiguo = 0;
  let corretosFalsoPositivo = 0; // omitiu, como esperado
  let totalFalsoPositivo = 0;

  for (const caso of CASOS) {
    const saida = await chamar(caso);
    if (!saida) {
      console.log(`[${caso.categoria}] "${caso.mensagem}"  -> SEM RESPOSTA`);
      continue;
    }
    const alt = saida.alteracoes as Record<string, { acao: string; valor: string | null } | null> | undefined;
    const emitido = alt?.agendamento_id?.valor ?? null;

    if (caso.categoria === 'claro') {
      totalClaro++;
      const ok = emitido === caso.esperado;
      if (ok) acertosClaro++;
      console.log(`[CLARO] "${caso.mensagem}"`);
      console.log(`   esperado=${rotulo(caso.esperado)} (${caso.como})  emitido=${rotulo(emitido)}  ${ok ? 'OK' : 'FALHA'}`);
    } else if (caso.categoria === 'ambiguo') {
      totalAmbiguo++;
      const ok = emitido === null;
      if (ok) corretosAmbiguo++;
      console.log(`[AMBIGUO] "${caso.mensagem}"`);
      console.log(`   esperado=(ausente) (${caso.como})  emitido=${rotulo(emitido)}  ${ok ? 'OK' : 'FALHA (nao deveria ter escolhido)'}`);
    } else {
      totalFalsoPositivo++;
      const ok = emitido === null;
      if (ok) corretosFalsoPositivo++;
      console.log(`[FALSO POSITIVO] "${caso.mensagem}"`);
      console.log(`   esperado=(ausente) (${caso.como})  emitido=${rotulo(emitido)}  ${ok ? 'OK' : 'FALHA (emitiu quando NAO deveria)'}`);
    }
    console.log(`   natureza_mensagem=${saida.natureza_mensagem}`);
    console.log('');
  }

  console.log('--- PLACAR ---');
  console.log(`  CLARO (deveria identificar):        ${acertosClaro}/${totalClaro}`);
  console.log(`  AMBIGUO (deveria omitir):            ${corretosAmbiguo}/${totalAmbiguo}`);
  console.log(`  FALSO POSITIVO (deveria omitir):     ${corretosFalsoPositivo}/${totalFalsoPositivo}`);
  console.log('');
  console.log('Criterio de aprovacao (proposto): CLARO 100%, AMBIGUO 100%, FALSO POSITIVO 100%.');
  console.log('Qualquer falha em AMBIGUO ou FALSO POSITIVO e mais grave que falha em CLARO --');
  console.log('significa remarcar o agendamento errado, nunca so "perguntar de novo".');
}

void main();
