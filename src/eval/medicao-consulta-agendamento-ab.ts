// Runner ISOLADO, avulso: MEDICAO A x B da intencao de CONSULTA do proprio
// agendamento. Nenhum modulo de producao e alterado por este arquivo.
//
// ── DE ONDE VEM ─────────────────────────────────────────────────────────
// medicao-intencao-consulta-agendamento.ts (2026-08-11) mediu o vocabulario
// ESTENDIDO SOZINHO (`consulta_agendamento`, zero regra): resultado 0/20 --
// nenhuma das cinco frases emitiu a intencao, em nenhuma repeticao. Os quatro
// controles tambem ficaram em 0/16, mas isso NAO e discriminacao: o modelo
// simplesmente nao emitiu para ninguem.
//
// Diagnostico: as duas intencoes que funcionam hoje (`novo_agendamento`,
// `remarcacao`) tem cada uma UMA LINHA de instrucao dedicada. `cancelamento`
// foi a excecao sem regra, mas por dois apoios especificos e medidos -- a
// frase carrega o proprio verbo do enum ("cancelar") e havia a regra vizinha
// de remarcacao, quase identica, para generalizar. A consulta nao tem nenhum
// dos dois: nenhuma frase natural contem "consulta_agendamento", e "consulta"
// no vocabulario da clinica significa PROCEDIMENTO (`Consulta / Avaliação`
// esta no catalogo), nunca "consultar".
//
// ── AS DUAS VARIANTES ───────────────────────────────────────────────────
//   A -- `consulta_agendamento` + UMA linha semantica, na forma EXATA das
//        regras de intencao ja aprovadas e em producao.
//   B -- `meus_agendamentos` no vocabulario, SEM nenhuma instrucao. Testa se
//        um nome de enum lexicalmente ancorado no que o paciente diz carrega
//        o significado sozinho -- sem prosa nova.
//
// ── CRITERIOS (Gabriel, 2026-08-12) ─────────────────────────────────────
//   1. reconhecer as perguntas sobre os proprios agendamentos;
//   2. ZERO falso positivo em preco, convenio, endereco e horario da clinica;
//   3. ZERO poluicao de outros campos.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-consulta-agendamento-ab.ts

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

// --- Ancoras de producao, importadas (nunca copiadas a mao) ---
const RODAPE_PRODUCAO = `Valores permitidos para intencao: ${INTENCOES_PERMITIDAS.join(', ')}.`;

// Linha de remarcacao, EXATA -- usada so como ancora de insercao na variante A.
const LINHA_REMARCACAO =
  '- Emita intencao = remarcacao somente quando a janela atual expressar um pedido de MUDAR um atendimento que o paciente ja tem marcado (ex.: "preciso remarcar minha consulta", "da pra mudar meu horario?", "quero trocar o dia da minha consulta"); a mera mencao a data, horario ou procedimento, sozinha, nao emite essa intencao.';

// --- VARIANTE A ---
const VALOR_A = 'consulta_agendamento';
// UMA linha, na forma EXATA das regras ja aprovadas: "Emita intencao = X
// somente quando ... ; <o que NAO emite>". Os exemplos sao ILUSTRATIVOS,
// mesmo estatuto dos que ja existem na regra de remarcacao.
const LINHA_A =
  '- Emita intencao = consulta_agendamento somente quando a janela atual PERGUNTAR sobre um atendimento que o paciente ja tem marcado — que dia e, que horas e, ou com qual profissional (ex.: "quando e minha consulta?", "tenho horario marcado?", "com quem eu estou marcado?"); uma duvida sobre a clinica em si — preco, convenio, endereco, horario de funcionamento — nunca emite essa intencao, porque nao fala de um atendimento do proprio paciente.';

// --- VARIANTE B ---
// Nome lexicalmente ancorado no que o paciente diz ("meus agendamentos"),
// SEM nenhuma instrucao acrescentada.
const VALOR_B = 'meus_agendamentos';

interface Variante {
  rotulo: string;
  valorIntencao: string;
  instrucoes: string;
  vocabulario: string[];
}

function montarVarianteA(): Variante {
  if (!INSTRUCOES_EXTRATOR.includes(LINHA_REMARCACAO)) {
    throw new Error('Linha de remarcacao nao encontrada -- runner desatualizado.');
  }
  if (!INSTRUCOES_EXTRATOR.includes(RODAPE_PRODUCAO)) {
    throw new Error('Rodape de intencao nao encontrado -- runner desatualizado.');
  }
  const vocabulario = [...INTENCOES_PERMITIDAS, VALOR_A];
  const instrucoes = INSTRUCOES_EXTRATOR.replace(LINHA_REMARCACAO, `${LINHA_REMARCACAO}\n${LINHA_A}`).replace(
    RODAPE_PRODUCAO,
    `Valores permitidos para intencao: ${vocabulario.join(', ')}.`
  );
  return { rotulo: `A -- ${VALOR_A} + 1 linha semantica`, valorIntencao: VALOR_A, instrucoes, vocabulario };
}

function montarVarianteB(): Variante {
  if (!INSTRUCOES_EXTRATOR.includes(RODAPE_PRODUCAO)) {
    throw new Error('Rodape de intencao nao encontrado -- runner desatualizado.');
  }
  const vocabulario = [...INTENCOES_PERMITIDAS, VALOR_B];
  const instrucoes = INSTRUCOES_EXTRATOR.replace(
    RODAPE_PRODUCAO,
    `Valores permitidos para intencao: ${vocabulario.join(', ')}.`
  );
  return { rotulo: `B -- ${VALOR_B} SEM instrucao`, valorIntencao: VALOR_B, instrucoes, vocabulario };
}

// --- Schema: MESMA FORMA da producao, so o enum de intencao muda ---
function montarSchema(vocabulario: string[]): object {
  const schemaValorCampo = (campo: string): object => {
    if (campo === 'periodo') return { type: 'string', enum: [...PERIODOS_PERMITIDOS] };
    if (campo === 'intencao') return { type: 'string', enum: vocabulario };
    if (campo === 'confirmacao') return { type: 'string', enum: [...CONFIRMACOES_PERMITIDAS] };
    return { type: 'string', minLength: 1 };
  };

  return {
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

// MESMAS frases e MESMOS controles da medicao anterior -- comparabilidade.
const CONSULTAS: readonly string[] = [
  'quando é minha consulta?',
  'tenho horário marcado?',
  'que horas é minha consulta?',
  'quando é meu próximo atendimento?',
  'com qual dentista estou marcado?',
];
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
  emitiuAlvo: boolean;
  intencaoEmitida: string | undefined;
  natureza: string | undefined;
  poluiuOutroCampo: boolean;
  camposPoluidos: string[];
  erro: boolean;
}

async function observar(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  variante: Variante,
  schema: object,
  mensagem: string
): Promise<Observacao> {
  for (let tentativa = 0; tentativa <= MAX_RETENTATIVAS_TRUNCACAO; tentativa++) {
    try {
      const saidaBruta = await cliente.executar({
        instrucoes: variante.instrucoes,
        schema,
        payload: montarPayload(mensagem),
      });
      const saida = saidaBruta as Record<string, unknown>;
      const alteracoes = (saida.alteracoes ?? {}) as Record<string, { acao?: string; valor?: string } | undefined>;
      const alt = alteracoes.intencao;
      const intencaoEmitida = alt !== undefined && alt.acao !== 'remover' ? alt.valor : undefined;
      const camposPoluidos = Object.keys(alteracoes).filter((c) => c !== 'intencao');
      return {
        emitiuAlvo: intencaoEmitida === variante.valorIntencao,
        intencaoEmitida,
        natureza: typeof saida.natureza_mensagem === 'string' ? saida.natureza_mensagem : undefined,
        poluiuOutroCampo: camposPoluidos.length > 0,
        camposPoluidos,
        erro: false,
      };
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : '';
      if (msg.includes('resposta_truncada') && tentativa < MAX_RETENTATIVAS_TRUNCACAO) {
        truncacoes++;
        continue;
      }
      return { emitiuAlvo: false, intencaoEmitida: undefined, natureza: undefined, poluiuOutroCampo: false, camposPoluidos: [], erro: true };
    }
  }
  return { emitiuAlvo: false, intencaoEmitida: undefined, natureza: undefined, poluiuOutroCampo: false, camposPoluidos: [], erro: true };
}

interface Placar {
  reconhecidas: number;
  consultasTotal: number;
  poluicao: number;
  falsosPositivos: number;
  controlesTotal: number;
  erros: number;
}

async function executarVariante(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  variante: Variante
): Promise<Placar> {
  const schema = montarSchema(variante.vocabulario);
  console.log('');
  console.log(`##### VARIANTE ${variante.rotulo} #####`);

  const p: Placar = { reconhecidas: 0, consultasTotal: 0, poluicao: 0, falsosPositivos: 0, controlesTotal: 0, erros: 0 };

  console.log(`  CONSULTAS (esperado: intencao=${variante.valorIntencao})`);
  for (const mensagem of CONSULTAS) {
    let ok = 0;
    let pol = 0;
    let err = 0;
    const naturezas = new Set<string>();
    const poluidos = new Set<string>();
    for (let r = 0; r < REPETICOES; r++) {
      const o = await observar(cliente, variante, schema, mensagem);
      p.consultasTotal++;
      if (o.erro) { err++; p.erros++; continue; }
      if (o.natureza !== undefined) naturezas.add(o.natureza);
      if (o.emitiuAlvo) { ok++; p.reconhecidas++; }
      if (o.poluiuOutroCampo) { pol++; p.poluicao++; o.camposPoluidos.forEach((c) => poluidos.add(c)); }
    }
    const marca = ok === REPETICOES ? 'OK ' : ok === 0 ? '-- ' : '~~ ';
    console.log(
      `  ${marca} "${mensagem}"  emitiu ${ok}/${REPETICOES} | naturezas={${[...naturezas].join(',')}}${pol > 0 ? ` | POLUIU ${pol} {${[...poluidos].join(',')}}` : ''}${err > 0 ? ` | erro ${err}` : ''}`
    );
  }

  console.log(`  CONTROLES (esperado: NUNCA ${variante.valorIntencao})`);
  for (const mensagem of CONTROLES) {
    let fp = 0;
    let err = 0;
    const naturezas = new Set<string>();
    for (let r = 0; r < REPETICOES; r++) {
      const o = await observar(cliente, variante, schema, mensagem);
      p.controlesTotal++;
      if (o.erro) { err++; p.erros++; continue; }
      if (o.natureza !== undefined) naturezas.add(o.natureza);
      if (o.emitiuAlvo) { fp++; p.falsosPositivos++; }
    }
    console.log(
      `  ${fp === 0 ? 'OK ' : '!!!'} "${mensagem}"  falso positivo ${fp}/${REPETICOES} | naturezas={${[...naturezas].join(',')}}${err > 0 ? ` | erro ${err}` : ''}${fp > 0 ? '  *** SEQUESTRO DE DUVIDA ***' : ''}`
    );
  }

  console.log('');
  console.log(`  reconhecidas               : ${p.reconhecidas}/${p.consultasTotal}`);
  console.log(`  poluicao de outros campos  : ${p.poluicao}/${p.consultasTotal}`);
  console.log(`  FALSOS POSITIVOS (controle): ${p.falsosPositivos}/${p.controlesTotal}`);
  console.log(`  erros de infra             : ${p.erros}`);
  return p;
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- medicao A x B: intencao de consulta do proprio agendamento ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('Nenhum modulo de producao alterado.');
  console.log(`casos por variante: ${CONSULTAS.length} consultas + ${CONTROLES.length} controles x ${REPETICOES} repeticoes`);

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const a = await executarVariante(cliente, montarVarianteA());
  const b = await executarVariante(cliente, montarVarianteB());

  console.log('');
  console.log('##### COMPARACAO #####');
  console.log(`  reconhecidas      : A ${a.reconhecidas}/${a.consultasTotal}  ->  B ${b.reconhecidas}/${b.consultasTotal}`);
  console.log(`  poluicao          : A ${a.poluicao}/${a.consultasTotal}  ->  B ${b.poluicao}/${b.consultasTotal}`);
  console.log(`  FALSOS POSITIVOS  : A ${a.falsosPositivos}/${a.controlesTotal}  ->  B ${b.falsosPositivos}/${b.controlesTotal}`);
  console.log(`  erros de infra    : A ${a.erros}  ->  B ${b.erros}`);
  console.log(`  retentativas trunc: ${truncacoes}`);
}

main().catch((erro) => {
  console.error(`erro fatal: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
