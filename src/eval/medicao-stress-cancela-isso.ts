// Runner ISOLADO: STRESS TEST focado exclusivamente no par mais fragil da
// medicao anterior (medicao-colisao-desistencia-cancelamento.ts) -- "cancela
// isso" em contexto A (novo agendamento em andamento, SEM agendamento
// existente) vs contexto B (agendamento existente em discussao no
// historico). As duas rodadas completas anteriores divergiram exatamente
// aqui: variante NUA foi 0/2 perigoso nas duas vezes, mas com resultados
// diferentes por rodada ("cancela isso" A saiu ora natureza=negacao ora
// natureza=pedido/intencao ausente -- nunca perigoso, mas instavel o
// suficiente pra merecer mais amostras antes de qualquer conclusao).
//
// So testa a VARIANTE NUA (melhor desempenho medido: 13/14 acertos, 0/14
// perigosos nas duas rodadas completas) -- 8 repeticoes de cada um dos dois
// casos, sequenciais, mesmo payload.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-stress-cancela-isso.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { INSTRUCOES_EXTRATOR } from '../core/interpretacao-instrucoes.ts';
import type { EntradaInterpretacao } from '../core/interpretacao-tipos.ts';

const CAMPOS_EMITIVEIS_PELA_IA = [
  'intencao', 'procedimento_id', 'agendamento_id', 'data_texto', 'periodo',
  'horario_texto', 'confirmacao', 'nome', 'cpf', 'data_nascimento', 'email',
];
const PERIODOS_PERMITIDOS = ['manha', 'tarde', 'noite'];
const CONFIRMACOES_PERMITIDAS = ['sim'];
const NATUREZAS_MENSAGEM_PERMITIDAS = ['saudacao', 'duvida', 'pedido', 'resposta', 'correcao', 'negacao', 'nao_compreendida'];
const TIPOS_EVENTO_CANDIDATO_PERMITIDOS = ['aceitar_opcao', 'aceitar_troca_telefone'];
const INTENCOES_COM_CANCELAMENTO = ['novo_agendamento', 'remarcacao', 'cancelamento'];

function schemaValorCampo(campo: string): object {
  if (campo === 'periodo') return { type: 'string', enum: [...PERIODOS_PERMITIDOS] };
  if (campo === 'intencao') return { type: 'string', enum: [...INTENCOES_COM_CANCELAMENTO] };
  if (campo === 'confirmacao') return { type: 'string', enum: [...CONFIRMACOES_PERMITIDAS] };
  return { type: 'string', minLength: 1 };
}

const SCHEMA_CANDIDATO: object = {
  type: 'object',
  additionalProperties: false,
  required: ['natureza_mensagem', 'alteracoes', 'eventos_candidatos', 'dentistas_candidatos'],
  properties: {
    natureza_mensagem: { type: 'string', enum: [...NATUREZAS_MENSAGEM_PERMITIDAS] },
    dentistas_candidatos: { type: ['array', 'null'], items: { type: 'string', minLength: 1 } },
    eventos_candidatos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo', 'referencia_textual'],
        properties: {
          tipo: { type: 'string', enum: [...TIPOS_EVENTO_CANDIDATO_PERMITIDOS] },
          referencia_textual: { type: ['string', 'null'] },
        },
      },
    },
    alteracoes: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        CAMPOS_EMITIVEIS_PELA_IA.map((campo) => [
          campo,
          {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['acao', 'valor'],
                properties: { acao: { type: 'string', enum: ['informar', 'corrigir'] }, valor: schemaValorCampo(campo) },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['acao'],
                properties: { acao: { type: 'string', const: 'remover' } },
              },
            ],
          },
        ])
      ),
    },
  },
};

const RODAPE_PRODUCAO = 'Valores permitidos para intencao: novo_agendamento, remarcacao.';
const RODAPE_NU = 'Valores permitidos para intencao: novo_agendamento, remarcacao, cancelamento.';

function instrucoesVariante1(): string {
  if (!INSTRUCOES_EXTRATOR.includes(RODAPE_PRODUCAO)) {
    throw new Error('Rodape de producao nao encontrado -- runner desatualizado.');
  }
  return INSTRUCOES_EXTRATOR.replace(RODAPE_PRODUCAO, RODAPE_NU);
}

const PROCEDIMENTOS_DISPONIVEIS = [
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental' },
  { procedimento_id: 'implant', nome_pt: 'Implante dentário' },
  { procedimento_id: 'root_canal', nome_pt: 'Tratamento de canal' },
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
];
const DENTISTAS_DISPONIVEIS = [
  { dentista_id: 'dent-ana', nome_exibido: 'Dra. Ana Souza' },
  { dentista_id: 'dent-bruno', nome_exibido: 'Dr. Bruno Lima' },
];

const AGORA_ISO = new Date().toISOString();

const PAYLOAD_A: EntradaInterpretacao = {
  mensagens_atuais: ['cancela isso'],
  dados_atuais: { intencao: 'novo_agendamento', procedimento_id: 'cleaning', dentista_id: 'dent-ana', data_texto: 'amanha' },
  campos_cadastrais_preenchidos: [],
  procedimentos_disponiveis: PROCEDIMENTOS_DISPONIVEIS,
  dentistas_disponiveis: DENTISTAS_DISPONIVEIS,
  horarios_oferecidos: ['09:00', '10:00', '11:00'],
  historico_recente: [
    {
      mensagem_paciente: 'Quero marcar uma limpeza com a Dra. Ana amanha',
      resposta_iris: 'Certo! Para amanha com a Dra. Ana tenho os horarios 09:00, 10:00 e 11:00. Qual prefere?',
      gerada_em: AGORA_ISO,
    },
  ],
};

const PAYLOAD_B: EntradaInterpretacao = {
  mensagens_atuais: ['cancela isso'],
  dados_atuais: {},
  campos_cadastrais_preenchidos: [],
  procedimentos_disponiveis: PROCEDIMENTOS_DISPONIVEIS,
  dentistas_disponiveis: DENTISTAS_DISPONIVEIS,
  historico_recente: [
    {
      mensagem_paciente: 'Eu ainda tenho uma consulta marcada?',
      resposta_iris: 'Sim! Voce tem uma Limpeza dental marcada com a Dra. Ana Souza para sexta-feira, 14/08 as 14:00.',
      gerada_em: AGORA_ISO,
    },
  ],
};

const REPETICOES = 8;

interface Resultado {
  rodada: number;
  natureza: string | undefined;
  intencao: string | undefined;
}

async function rodar(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  instrucoes: string,
  payload: EntradaInterpretacao,
  n: number
): Promise<Resultado[]> {
  const resultados: Resultado[] = [];
  for (let i = 1; i <= n; i++) {
    try {
      const saidaBruta = await cliente.executar({ instrucoes, schema: SCHEMA_CANDIDATO, payload });
      const saida = saidaBruta as Record<string, unknown>;
      const natureza = typeof saida.natureza_mensagem === 'string' ? saida.natureza_mensagem : undefined;
      const alteracoes = (saida.alteracoes ?? {}) as Record<string, { acao?: string; valor?: string } | undefined>;
      const intencaoAlt = alteracoes.intencao;
      const intencao = intencaoAlt && intencaoAlt.acao !== 'remover' ? intencaoAlt.valor : undefined;
      resultados.push({ rodada: i, natureza, intencao });
      console.log(`  [${i}/${n}] natureza=${natureza ?? '(ausente)'} | intencao=${intencao ?? '(ausente)'}`);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : 'desconhecido';
      resultados.push({ rodada: i, natureza: undefined, intencao: undefined });
      console.log(`  [${i}/${n}] ERRO: ${mensagem}`);
    }
  }
  return resultados;
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- stress test: "cancela isso" em contexto A vs B, variante NUA, 8x cada ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const instrucoes = instrucoesVariante1();

  console.log('');
  console.log('CONTEXTO A (novo agendamento em andamento, SEM agendamento existente) -- espera: intencao ausente (nunca cancelamento)');
  const resA = await rodar(cliente, instrucoes, PAYLOAD_A, REPETICOES);

  console.log('');
  console.log('CONTEXTO B (agendamento existente em discussao no historico) -- espera: intencao=cancelamento');
  const resB = await rodar(cliente, instrucoes, PAYLOAD_B, REPETICOES);

  const perigososA = resA.filter((r) => r.intencao === 'cancelamento').length;
  const acertosB = resB.filter((r) => r.intencao === 'cancelamento').length;

  console.log('');
  console.log('##### RESUMO #####');
  console.log(`  A "cancela isso" (sem agendamento existente): intencao=cancelamento em ${perigososA}/${REPETICOES}  ${perigososA > 0 ? '*** PERIGOSO ***' : '(nunca perigoso)'}`);
  console.log(`  B "cancela isso" (com agendamento existente): intencao=cancelamento em ${acertosB}/${REPETICOES}`);
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal: ${mensagem}`);
  process.exitCode = 1;
});
