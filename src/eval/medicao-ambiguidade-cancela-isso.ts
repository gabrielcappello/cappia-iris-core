// ETAPA 1 -- experimento dirigido ao unico caso que falhou na medicao
// multi-turno: "cancela isso".
//
// ── POR QUE ESTE EXPERIMENTO EXISTE ─────────────────────────────────────
// A medicao multi-turno mostrou o contrato de capacidade escolhendo
// `cancelar_agendamento` em 4/4 quando o paciente disse "cancela isso" no
// meio de um fluxo de agendamento novo, tendo tambem um agendamento real
// futuro. Se isso fosse para producao, a Iris perguntaria "confirma que quer
// cancelar sua consulta de 13/08?" para quem so queria abandonar o
// agendamento em construcao.
//
// specs/cancelamento-conversacional-v1.md mediu a MESMA frase no contrato
// ANTIGO e registrou 0/8 falsos positivos -- mas em um contexto DIFERENTE
// ("sem agendamento marcado"). O caso que falhou aqui e mais dificil: fluxo
// aberto E agendamento existente ao mesmo tempo. Nenhum dos dois contratos
// foi medido nele.
//
// Sem comparar os dois contratos no MESMO contexto, e impossivel saber se
// isto e:
//   (a) uma regressao do contrato de capacidade; ou
//   (b) um caso inerentemente ambiguo, que nenhum contrato resolve.
// A resposta muda completamente o que a Etapa 1 conclui.
//
// ── OS TRES CONTEXTOS ───────────────────────────────────────────────────
//   A -- fluxo aberto, SEM agendamento existente   (o que a spec mediu: 0/8)
//   B -- fluxo aberto, COM agendamento existente   (o caso que falhou)
//   C -- SEM fluxo, COM agendamento existente      (cancelamento legitimo)
//
// Em A e B, "cancela isso" = desistir do fluxo. Em C = cancelar de verdade.
// Um contrato bom precisa acertar os TRES -- inclusive C, senao vira um
// sistema que nunca cancela.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-ambiguidade-cancela-isso.ts

import { criarClienteMedicao, ErroClienteMedicao, MODELO_MEDICAO, type ClienteMedicao } from './cliente-medicao-openai.ts';
import { CAMPOS_EMITIVEIS_PELA_IA, INTENCOES_PERMITIDAS } from '../core/aplicar-dados.ts';
import { NATUREZAS_MENSAGEM_PERMITIDAS, TIPOS_EVENTO_CANDIDATO_PERMITIDOS } from '../core/interpretacao-tipos.ts';
import { INSTRUCOES_EXTRATOR } from '../core/interpretacao-instrucoes.ts';

const MENSAGEM = 'cancela isso';
const REPETICOES = 8; // mesma profundidade do stress test da spec de cancelamento
const MAX_RETENTATIVAS = 2;

const PROCEDIMENTOS = [
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental' },
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
];
const DENTISTAS = [{ dentista_id: 'dent-carlos', nome_exibido: 'Dr. Carlos Turiak' }];

const HISTORICO_FLUXO_ABERTO = [
  {
    mensagem_paciente: 'estou com dor de dente. acho melhor uma avaliação',
    resposta_iris:
      'Poxa, dor de dente nunca é fácil, né? Para avaliação amanhã, temos horários disponíveis às 08:00, 09:00, 10:00 e 11:30. Qual horário seria melhor para você?',
  },
];
const HISTORICO_AGENDAMENTO_CITADO = [
  {
    mensagem_paciente: 'oi',
    resposta_iris: 'Oi! Vi aqui que você tem uma Consulta / Avaliação marcada para 13/08 às 10:00 com o Dr. Carlos Turiak.',
  },
];
const AGENDAMENTO_FUTURO = {
  data: '2026-08-13',
  horario: '10:00',
  procedimento: 'Consulta / Avaliação',
  dentista_nome: 'Dr. Carlos Turiak',
};
const DADOS_FLUXO = { procedimento: 'Consulta / Avaliação', data: 'amanhã' };
const HORARIOS = ['08:00', '09:00', '10:00', '11:30'];

interface Contexto {
  id: string;
  descricao: string;
  /** true = "cancela isso" significa cancelar o agendamento REAL. */
  cancelamentoLegitimo: boolean;
  historico: { mensagem_paciente: string; resposta_iris: string }[];
  fluxoAberto: boolean;
  temAgendamento: boolean;
}

const CONTEXTOS: readonly Contexto[] = [
  {
    id: 'A',
    descricao: 'fluxo aberto, SEM agendamento existente (a spec mediu: 0/8 falsos positivos)',
    cancelamentoLegitimo: false,
    historico: HISTORICO_FLUXO_ABERTO,
    fluxoAberto: true,
    temAgendamento: false,
  },
  {
    id: 'B',
    descricao: 'fluxo aberto, COM agendamento existente (o caso que falhou 4/4)',
    cancelamentoLegitimo: false,
    historico: HISTORICO_FLUXO_ABERTO,
    fluxoAberto: true,
    temAgendamento: true,
  },
  {
    id: 'C',
    descricao: 'SEM fluxo, COM agendamento existente (cancelamento LEGITIMO)',
    cancelamentoLegitimo: true,
    historico: HISTORICO_AGENDAMENTO_CITADO,
    fluxoAberto: false,
    temAgendamento: true,
  },
];

// ── CONTRATO 1: extracao (replica fiel do que producao envia) ───────────
const SCHEMA_EXTRACAO = {
  type: 'object',
  properties: {
    natureza_mensagem: { type: 'string', enum: [...NATUREZAS_MENSAGEM_PERMITIDAS] },
    alteracoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          campo: { type: 'string', enum: [...CAMPOS_EMITIVEIS_PELA_IA] },
          acao: { type: 'string', enum: ['informar', 'corrigir', 'remover'] },
          valor: { type: ['string', 'null'] },
        },
        required: ['campo', 'acao', 'valor'],
        additionalProperties: false,
      },
    },
    eventos_candidatos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: [...TIPOS_EVENTO_CANDIDATO_PERMITIDOS] },
          referencia_textual: { type: ['string', 'null'] },
        },
        required: ['tipo', 'referencia_textual'],
        additionalProperties: false,
      },
    },
    dentistas_candidatos: { type: ['array', 'null'], items: { type: 'string' } },
  },
  required: ['natureza_mensagem', 'alteracoes', 'eventos_candidatos', 'dentistas_candidatos'],
  additionalProperties: false,
};

const FRASE_FORMATO_INTERNO =
  'Responda estritamente no formato do schema fornecido — nenhuma propriedade alem de "natureza_mensagem" e "alteracoes" no nivel principal, nenhuma propriedade alem de "acao"/"valor" (ou somente "acao" para remover) dentro de cada alteracao.';
const FRASE_TRANSPORTE_PORTATIL =
  'Responda estritamente no formato do schema fornecido — a raiz contem somente "natureza_mensagem" e "alteracoes"; "alteracoes" e uma lista; cada item da lista contem exatamente "campo", "acao" e "valor"; informar e corrigir usam "valor" como string; remover usa "valor": null; nenhuma propriedade adicional e permitida.';

function instrucoesExtracao(): string {
  if (!INSTRUCOES_EXTRATOR.includes(FRASE_FORMATO_INTERNO)) {
    throw new Error('frase estrutural nao encontrada -- runner desatualizado');
  }
  return INSTRUCOES_EXTRATOR.replace(FRASE_FORMATO_INTERNO, FRASE_TRANSPORTE_PORTATIL);
}

function payloadExtracao(contexto: Contexto): unknown {
  return {
    mensagens_atuais: [MENSAGEM],
    // No contrato antigo, o fluxo em andamento vive em `dados_atuais`.
    dados_atuais: contexto.fluxoAberto ? { procedimento_id: 'consultation_evaluation', data_texto: 'amanhã' } : {},
    campos_cadastrais_preenchidos: [],
    historico_recente: contexto.historico,
    ...(contexto.fluxoAberto ? { horarios_oferecidos: HORARIOS } : {}),
    procedimentos_disponiveis: PROCEDIMENTOS,
    dentistas_disponiveis: DENTISTAS,
  };
}

// ── CONTRATO 2: decisao de capacidade (V2, minimo) ──────────────────────
const CAPACIDADES = [
  'consultar_agendamento_do_paciente',
  'consultar_disponibilidade',
  'criar_agendamento',
  'remarcar_agendamento',
  'cancelar_agendamento',
  'nenhuma_apenas_conversar',
] as const;

const SCHEMA_CAPACIDADE = {
  type: 'object',
  properties: {
    capacidade: { type: 'string', enum: [...CAPACIDADES] },
    justificativa: { type: 'string' },
  },
  required: ['capacidade', 'justificativa'],
  additionalProperties: false,
};

const INSTRUCOES_CAPACIDADE = `
Voce e a Iris, assistente de uma clinica odontologica, conversando com um paciente pelo WhatsApp.

Leia a conversa e decida UMA coisa: qual capacidade do sistema voce precisa acionar agora para responder bem a ultima mensagem do paciente.

Valores possiveis para capacidade:
${CAPACIDADES.map((c) => `- ${c}`).join('\n')}

Use "nenhuma_apenas_conversar" quando conseguir responder sem consultar nem alterar nada no sistema.

Em "justificativa", explique em uma frase curta o que voce entendeu que o paciente quer.
`.trim();

function payloadCapacidade(contexto: Contexto): unknown {
  return {
    mensagens_atuais: [MENSAGEM],
    historico_recente: contexto.historico,
    ...(contexto.fluxoAberto ? { dados_conhecidos: DADOS_FLUXO, horarios_oferecidos: HORARIOS } : {}),
    ...(contexto.temAgendamento ? { agendamento_futuro: AGENDAMENTO_FUTURO } : {}),
    procedimentos_disponiveis: PROCEDIMENTOS,
    dentistas_disponiveis: DENTISTAS,
  };
}

interface Contrato {
  rotulo: string;
  /** true = a saida pede CANCELAMENTO do agendamento existente. */
  pediuCancelamento(saida: unknown): boolean;
  executar(cliente: ClienteMedicao, contexto: Contexto): Promise<unknown>;
}

const CONTRATO_EXTRACAO: Contrato = {
  rotulo: 'EXTRACAO (producao hoje)',
  pediuCancelamento(saida) {
    const alteracoes = (saida as { alteracoes?: unknown }).alteracoes;
    if (!Array.isArray(alteracoes)) return false;
    return alteracoes.some(
      (i) => (i as { campo?: string }).campo === 'intencao' && (i as { valor?: string }).valor === 'cancelamento'
    );
  },
  executar(cliente, contexto) {
    return cliente.executar({
      instrucoes: instrucoesExtracao(),
      schema: SCHEMA_EXTRACAO,
      payload: payloadExtracao(contexto),
      nomeSchema: 'alteracoes_iris',
    });
  },
};

const CONTRATO_CAPACIDADE: Contrato = {
  rotulo: 'CAPACIDADE (V2 minimo)',
  pediuCancelamento(saida) {
    return (saida as { capacidade?: string }).capacidade === 'cancelar_agendamento';
  },
  executar(cliente, contexto) {
    return cliente.executar({
      instrucoes: INSTRUCOES_CAPACIDADE,
      schema: SCHEMA_CAPACIDADE,
      payload: payloadCapacidade(contexto),
      nomeSchema: 'decisao_capacidade',
    });
  },
};

async function medir(cliente: ClienteMedicao, contrato: Contrato, contexto: Contexto): Promise<number> {
  let pediu = 0;
  for (let r = 0; r < REPETICOES; r++) {
    for (let tentativa = 0; tentativa <= MAX_RETENTATIVAS; tentativa++) {
      try {
        if (contrato.pediuCancelamento(await contrato.executar(cliente, contexto))) pediu++;
        break;
      } catch (erro) {
        const repetivel =
          erro instanceof ErroClienteMedicao && (erro.categoria === 'resposta_truncada' || erro.categoria === 'rede');
        if (repetivel && tentativa < MAX_RETENTATIVAS) continue;
        console.error(`      erro: ${erro instanceof Error ? erro.message : 'desconhecido'}`);
        break;
      }
    }
  }
  return pediu;
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- ETAPA 1: "cancela isso" -- contrato de EXTRACAO x contrato de CAPACIDADE ---');
  console.log(`modelo: ${MODELO_MEDICAO} | ${REPETICOES} repeticoes por celula`);
  console.log('Mesma frase, mesmos contextos, mesmo cliente. So o contrato muda.');

  const cliente = criarClienteMedicao({ chaveApi });

  for (const contexto of CONTEXTOS) {
    console.log('');
    console.log(`##### CONTEXTO ${contexto.id}: ${contexto.descricao} #####`);
    console.log(`  esperado: ${contexto.cancelamentoLegitimo ? 'PEDIR cancelamento' : 'NUNCA pedir cancelamento'}`);
    for (const contrato of [CONTRATO_EXTRACAO, CONTRATO_CAPACIDADE]) {
      const pediu = await medir(cliente, contrato, contexto);
      const correto = contexto.cancelamentoLegitimo ? pediu : REPETICOES - pediu;
      const marca = correto === REPETICOES ? 'OK ' : correto === 0 ? '!!!' : '~~ ';
      console.log(`  ${marca} ${contrato.rotulo.padEnd(24)} pediu cancelamento ${pediu}/${REPETICOES}  (correto ${correto}/${REPETICOES})`);
    }
  }

  console.log('');
  console.log('Leitura: em A e B, "pediu cancelamento" alto = FALSO POSITIVO PERIGOSO.');
  console.log('         em C, "pediu cancelamento" baixo = o sistema nunca cancelaria.');
}

main().catch((erro) => {
  console.error(`erro fatal: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
