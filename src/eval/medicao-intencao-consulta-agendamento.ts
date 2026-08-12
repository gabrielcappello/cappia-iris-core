// Runner ISOLADO, avulso: MEDICAO PRE-IMPLEMENTACAO da intencao
// `consulta_agendamento`. Nenhum modulo de producao e alterado por este
// arquivo -- `consulta_agendamento` NAO existe em INTENCOES_PERMITIDAS hoje.
//
// ── A PERGUNTA ──────────────────────────────────────────────────────────
// A IA distingue NATURALMENTE "pergunta sobre o MEU agendamento" de "duvida
// geral sobre a clinica", so com o valor novo no vocabulario fechado e SEM
// nenhuma regra de prompt propria?
//
// ── POR QUE ISSO IMPORTA ────────────────────────────────────────────────
// Medicao anterior (2026-08-11, contrato de producao intacto) mostrou que as
// cinco frases de consulta caem TODAS em `natureza=duvida` com `alteracoes`
// vazio -- e `decidirPorNatureza` intercepta esse caso antes de qualquer
// roteamento, devolvendo `duvida_livre`. Ou seja: hoje essas perguntas ja sao
// engolidas, e nao existe sinal alguma para o Core rotear.
//
// As duas saidas possiveis seriam: (a) transformar toda `duvida` em consulta
// -- inaceitavel, sequestraria "quanto custa?" de quem tem agendamento; ou
// (b) a IA emitir uma INTENCAO propria, que e o que este runner mede.
//
// O criterio de seguranca aqui e o INVERSO do cancelamento: um falso positivo
// nao executa nada (consulta e somente leitura), mas faz a Iris responder
// "sua consulta e dia X" a quem perguntou o preco -- erro de conversa, nao de
// dado. Ainda assim e o desfecho que mais importa evitar.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-intencao-consulta-agendamento.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import {
  CAMPOS_EMITIVEIS_PELA_IA,
  CONFIRMACOES_PERMITIDAS,
  INTENCOES_PERMITIDAS,
  PERIODOS_PERMITIDOS,
} from '../core/aplicar-dados.ts';
import { NATUREZAS_MENSAGEM_PERMITIDAS, TIPOS_EVENTO_CANDIDATO_PERMITIDOS } from '../core/interpretacao-tipos.ts';
import { INSTRUCOES_EXTRATOR } from '../core/interpretacao-instrucoes.ts';
import type { EntradaInterpretacao } from '../core/interpretacao-tipos.ts';

const INTENCAO_NOVA = 'consulta_agendamento';
// Importado de producao, nunca copiado a mao -- assim o runner nao diverge
// silenciosamente se o vocabulario real mudar.
const INTENCOES_CANDIDATAS = [...INTENCOES_PERMITIDAS, INTENCAO_NOVA];

// --- Schema candidato: MESMA FORMA do de producao, so com o enum estendido ---

function schemaValorCampo(campo: string): object {
  if (campo === 'periodo') return { type: 'string', enum: [...PERIODOS_PERMITIDOS] };
  if (campo === 'intencao') return { type: 'string', enum: INTENCOES_CANDIDATAS };
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

// --- Instrucoes: SO o rodape do vocabulario muda. ZERO regra nova. ---

const RODAPE_PRODUCAO = `Valores permitidos para intencao: ${INTENCOES_PERMITIDAS.join(', ')}.`;
const RODAPE_CANDIDATO = `Valores permitidos para intencao: ${INTENCOES_CANDIDATAS.join(', ')}.`;

function instrucoesCandidatas(): string {
  if (!INSTRUCOES_EXTRATOR.includes(RODAPE_PRODUCAO)) {
    throw new Error('Rodape de intencao nao encontrado -- runner desatualizado.');
  }
  return INSTRUCOES_EXTRATOR.replace(RODAPE_PRODUCAO, RODAPE_CANDIDATO);
}

// --- Payload fiel a producao: conversa LIMPA, nada em andamento ---
const PROCEDIMENTOS_DISPONIVEIS = [
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental' },
  { procedimento_id: 'implant', nome_pt: 'Implante dentário' },
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
];
const DENTISTAS_DISPONIVEIS = [
  { dentista_id: 'dent-ana', nome_exibido: 'Dra. Ana Souza' },
  { dentista_id: 'dent-bruno', nome_exibido: 'Dr. Bruno Lima' },
];

function montarPayload(mensagem: string): EntradaInterpretacao {
  return {
    mensagens_atuais: [mensagem],
    dados_atuais: {},
    campos_cadastrais_preenchidos: [],
    procedimentos_disponiveis: PROCEDIMENTOS_DISPONIVEIS,
    dentistas_disponiveis: DENTISTAS_DISPONIVEIS,
  };
}

// Frases do Gabriel, literais.
const CONSULTAS: readonly string[] = [
  'quando é minha consulta?',
  'tenho horário marcado?',
  'que horas é minha consulta?',
  'quando é meu próximo atendimento?',
  'com qual dentista estou marcado?',
];

// CONTROLES: duvida geral sobre a clinica -- NUNCA podem virar consulta.
const CONTROLES: readonly string[] = [
  'vocês aceitam convênio?',
  'quanto custa limpeza?',
  'onde fica a clínica?',
  'qual o horário de funcionamento?',
];

const REPETICOES = 4;
const MAX_RETENTATIVAS_TRUNCACAO = 2;
let truncacoes = 0;

interface Observacao {
  emitiuConsulta: boolean;
  intencaoEmitida: string | undefined;
  natureza: string | undefined;
  poluiuOutroCampo: boolean;
  erro: boolean;
}

async function observar(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  instrucoes: string,
  mensagem: string
): Promise<Observacao> {
  for (let tentativa = 0; tentativa <= MAX_RETENTATIVAS_TRUNCACAO; tentativa++) {
    try {
      const saidaBruta = await cliente.executar({
        instrucoes,
        schema: SCHEMA_CANDIDATO,
        payload: montarPayload(mensagem),
      });
      const saida = saidaBruta as Record<string, unknown>;
      const alteracoes = (saida.alteracoes ?? {}) as Record<string, { acao?: string; valor?: string } | undefined>;
      const alt = alteracoes.intencao;
      const intencaoEmitida = alt !== undefined && alt.acao !== 'remover' ? alt.valor : undefined;
      // Qualquer campo alem de `intencao` preenchido numa PERGUNTA e ruido:
      // uma pergunta sobre o proprio agendamento nao informa procedimento,
      // data nem horario novos.
      const outrosCampos = Object.keys(alteracoes).filter((c) => c !== 'intencao');
      return {
        emitiuConsulta: intencaoEmitida === INTENCAO_NOVA,
        intencaoEmitida,
        natureza: typeof saida.natureza_mensagem === 'string' ? saida.natureza_mensagem : undefined,
        poluiuOutroCampo: outrosCampos.length > 0,
        erro: false,
      };
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : '';
      if (msg.includes('resposta_truncada') && tentativa < MAX_RETENTATIVAS_TRUNCACAO) {
        truncacoes++;
        continue;
      }
      return { emitiuConsulta: false, intencaoEmitida: undefined, natureza: undefined, poluiuOutroCampo: false, erro: true };
    }
  }
  return { emitiuConsulta: false, intencaoEmitida: undefined, natureza: undefined, poluiuOutroCampo: false, erro: true };
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- medicao: intencao consulta_agendamento vs duvida geral ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('Vocabulario estendido isoladamente. ZERO regra de prompt nova.');
  console.log(`vocabulario medido: ${INTENCOES_CANDIDATAS.join(', ')}`);
  console.log(`casos: ${CONSULTAS.length} consultas + ${CONTROLES.length} controles x ${REPETICOES} repeticoes`);

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });
  const instrucoes = instrucoesCandidatas();

  let consultasOk = 0;
  let consultasTotal = 0;
  let poluicao = 0;
  let falsosPositivos = 0;
  let controlesTotal = 0;
  let erros = 0;

  console.log('');
  console.log('CONSULTAS (esperado: intencao=consulta_agendamento)');
  for (const mensagem of CONSULTAS) {
    let ok = 0;
    let pol = 0;
    let err = 0;
    const naturezas = new Set<string>();
    for (let r = 0; r < REPETICOES; r++) {
      const o = await observar(cliente, instrucoes, mensagem);
      consultasTotal++;
      if (o.erro) { err++; erros++; continue; }
      if (o.natureza !== undefined) naturezas.add(o.natureza);
      if (o.emitiuConsulta) { ok++; consultasOk++; }
      if (o.poluiuOutroCampo) { pol++; poluicao++; }
    }
    const marca = ok === REPETICOES ? 'OK ' : ok === 0 ? '-- ' : '~~ ';
    console.log(`${marca} "${mensagem}"  emitiu ${ok}/${REPETICOES} | naturezas={${[...naturezas].join(',')}}${pol > 0 ? ` | POLUIU outro campo ${pol}` : ''}${err > 0 ? ` | erro ${err}` : ''}`);
  }

  console.log('');
  console.log('CONTROLES -- duvida geral (esperado: NUNCA consulta_agendamento)');
  for (const mensagem of CONTROLES) {
    let fp = 0;
    let err = 0;
    const naturezas = new Set<string>();
    for (let r = 0; r < REPETICOES; r++) {
      const o = await observar(cliente, instrucoes, mensagem);
      controlesTotal++;
      if (o.erro) { err++; erros++; continue; }
      if (o.natureza !== undefined) naturezas.add(o.natureza);
      if (o.emitiuConsulta) { fp++; falsosPositivos++; }
    }
    console.log(`${fp === 0 ? 'OK ' : '!!!'} "${mensagem}"  falso positivo ${fp}/${REPETICOES} | naturezas={${[...naturezas].join(',')}}${err > 0 ? ` | erro ${err}` : ''}${fp > 0 ? '  *** SEQUESTRO DE DUVIDA ***' : ''}`);
  }

  console.log('');
  console.log('--- resumo ---');
  console.log(`  consulta reconhecida       : ${consultasOk}/${consultasTotal}`);
  console.log(`  poluicao de outros campos  : ${poluicao}/${consultasTotal}`);
  console.log(`  FALSOS POSITIVOS (controle): ${falsosPositivos}/${controlesTotal}`);
  console.log(`  erros de infra             : ${erros}`);
  console.log(`  retentativas por truncacao : ${truncacoes}`);
}

main().catch((erro) => {
  console.error(`erro fatal: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
