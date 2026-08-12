// Runner ISOLADO, avulso: MEDICAO de um CAMPO RAIZ proprio de classificacao.
// Nenhum modulo de producao e alterado por este arquivo.
//
// ── DE ONDE VEM ─────────────────────────────────────────────────────────
// Duas medicoes anteriores fecharam a rota de `intencao` para consulta:
//   - vocabulario nu (`consulta_agendamento`, zero regra) ........ 0/20
//   - vocabulario + 1 linha semantica ........................... 1/20
//   - nome ancorado (`meus_agendamentos`, zero regra) ........... 3/20
// Todas com `natureza=duvida` e `alteracoes` vazio. O sinal consistente e
// que o modelo trata essas frases como DUVIDA, nao como intencao de acao --
// e ele nao esta errado: perguntar "que horas e minha consulta?" nao pede
// que nada seja criado, mudado ou destruido. As tres intencoes que funcionam
// hoje pedem uma ACAO SOBRE O MUNDO; consulta e leitura.
//
// ── A HIPOTESE AGORA (Gabriel, 2026-08-12) ──────────────────────────────
// O canal certo nao e `intencao`, e CLASSIFICACAO: um campo raiz proprio,
// com significado unico -- "a duvida atual e sobre um agendamento do proprio
// paciente". Nao e intencao de acao, nao persiste em `dados`, vale so para a
// mensagem atual.
//
// Precedente estrutural no proprio contrato: `dentistas_candidatos` ja e um
// campo RAIZ (nao uma alteracao) exatamente porque e resultado SEMANTICO da
// leitura, e nao um dado a persistir. Mesma natureza aqui.
//
// ── AS DUAS VARIANTES ───────────────────────────────────────────────────
//   A -- campo raiz + UMA linha de instrucao, na forma de `dentistas_candidatos`
//        ("e sempre obrigatorio e responde a uma unica pergunta: ...").
//   B -- MESMO campo raiz, SEM nenhuma instrucao -- so o nome no schema.
//        Vale medir porque na rodada anterior o nome ancorado (sem prosa)
//        superou a variante com prosa (3/20 vs 1/20).
//
// ── CRITERIOS ───────────────────────────────────────────────────────────
//   1. positivos reconhecidos;
//   2. ZERO falso positivo em preco, convenio, endereco, funcionamento;
//   3. ZERO poluicao de outros campos (a pergunta nao informa dado novo);
//   4. estabilidade em repeticoes (4/4 ou 0/4, nunca oscilando).
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-campo-raiz-duvida-agendamento.ts

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

const CAMPO = 'duvida_sobre_agendamento_proprio';

// Ancora de insercao: o inicio do rodape de vocabulario, que fecha o bloco de
// REGRAS. Ancorar aqui (e nao no texto de outra regra) evita depender de
// pontuacao exata -- as regras de producao usam travessao U+2014, e reproduzir
// o literal a mao ja quebrou este runner uma vez.
const ANCORA_RODAPE = '\nCampos permitidos:';

// VARIANTE A: uma linha, na MESMA forma do precedente acima.
const LINHA_A = `- "${CAMPO}" e sempre obrigatorio e responde a uma unica pergunta: a mensagem atual pergunta sobre um atendimento que ESTE paciente ja tem marcado — que dia e, que horas e, com qual profissional, ou simplesmente se existe algum? Use true somente nesse caso. Use false para todo o resto, inclusive duvidas sobre a clinica em si (preco, convenio, endereco, horario de funcionamento) e mensagens que nao sejam perguntas. Voce nunca busca o agendamento nem afirma que ele existe — apenas classifica sobre o que a pergunta e.`;

interface Variante {
  rotulo: string;
  instrucoes: string;
}

function montarVarianteA(): Variante {
  if (!INSTRUCOES_EXTRATOR.includes(ANCORA_RODAPE)) {
    throw new Error('Rodape de vocabulario nao encontrado -- runner desatualizado.');
  }
  // A regra nova entra como ULTIMA do bloco de regras, imediatamente antes do
  // rodape de vocabulario.
  return {
    rotulo: 'A -- campo raiz + 1 linha de instrucao',
    instrucoes: INSTRUCOES_EXTRATOR.replace(ANCORA_RODAPE, `\n${LINHA_A}\n${ANCORA_RODAPE}`),
  };
}

function montarVarianteB(): Variante {
  // Instrucoes de PRODUCAO, intactas -- o campo existe SO no schema.
  return { rotulo: 'B -- campo raiz SEM instrucao (so o nome no schema)', instrucoes: INSTRUCOES_EXTRATOR };
}

// --- Schema: producao + o campo raiz novo. Structured Outputs estrito exige
// TODA propriedade raiz em `required`, entao o campo e sempre presente
// (true/false) -- mesma razao pela qual `dentistas_candidatos` e nullable em
// vez de opcional. ---
function montarSchema(): object {
  const schemaValorCampo = (campo: string): object => {
    if (campo === 'periodo') return { type: 'string', enum: [...PERIODOS_PERMITIDOS] };
    if (campo === 'intencao') return { type: 'string', enum: [...INTENCOES_PERMITIDAS] };
    if (campo === 'confirmacao') return { type: 'string', enum: [...CONFIRMACOES_PERMITIDAS] };
    return { type: 'string', minLength: 1 };
  };

  return {
    type: 'object',
    additionalProperties: false,
    required: ['natureza_mensagem', 'alteracoes', 'eventos_candidatos', 'dentistas_candidatos', CAMPO],
    properties: {
      natureza_mensagem: { type: 'string', enum: [...NATUREZAS_MENSAGEM_PERMITIDAS] },
      dentistas_candidatos: { type: ['array', 'null'], items: { type: 'string', minLength: 1 } },
      [CAMPO]: { type: 'boolean' },
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

// MESMAS frases e controles das medicoes anteriores -- comparabilidade direta.
const POSITIVOS: readonly string[] = [
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
  marcouTrue: boolean;
  campoAusente: boolean;
  natureza: string | undefined;
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
      const saidaBruta = await cliente.executar({ instrucoes: variante.instrucoes, schema, payload: montarPayload(mensagem) });
      const saida = saidaBruta as Record<string, unknown>;
      const alteracoes = (saida.alteracoes ?? {}) as Record<string, unknown>;
      const valor = saida[CAMPO];
      return {
        marcouTrue: valor === true,
        campoAusente: typeof valor !== 'boolean',
        natureza: typeof saida.natureza_mensagem === 'string' ? saida.natureza_mensagem : undefined,
        camposPoluidos: Object.keys(alteracoes),
        erro: false,
      };
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : '';
      if (msg.includes('resposta_truncada') && tentativa < MAX_RETENTATIVAS_TRUNCACAO) {
        truncacoes++;
        continue;
      }
      return { marcouTrue: false, campoAusente: false, natureza: undefined, camposPoluidos: [], erro: true };
    }
  }
  return { marcouTrue: false, campoAusente: false, natureza: undefined, camposPoluidos: [], erro: true };
}

interface Placar {
  reconhecidos: number;
  positivosTotal: number;
  falsosPositivos: number;
  controlesTotal: number;
  poluicao: number;
  instaveis: number;
  ausencias: number;
  erros: number;
}

async function executarVariante(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  variante: Variante,
  schema: object
): Promise<Placar> {
  console.log('');
  console.log(`##### VARIANTE ${variante.rotulo} #####`);
  const p: Placar = {
    reconhecidos: 0, positivosTotal: 0, falsosPositivos: 0, controlesTotal: 0,
    poluicao: 0, instaveis: 0, ausencias: 0, erros: 0,
  };

  console.log(`  POSITIVOS (esperado: ${CAMPO}=true)`);
  for (const mensagem of POSITIVOS) {
    let ok = 0; let pol = 0; let err = 0; let aus = 0;
    const naturezas = new Set<string>();
    const poluidos = new Set<string>();
    for (let r = 0; r < REPETICOES; r++) {
      const o = await observar(cliente, variante, schema, mensagem);
      p.positivosTotal++;
      if (o.erro) { err++; p.erros++; continue; }
      if (o.campoAusente) { aus++; p.ausencias++; }
      if (o.natureza !== undefined) naturezas.add(o.natureza);
      if (o.marcouTrue) { ok++; p.reconhecidos++; }
      if (o.camposPoluidos.length > 0) { pol++; p.poluicao++; o.camposPoluidos.forEach((c) => poluidos.add(c)); }
    }
    if (ok !== 0 && ok !== REPETICOES) p.instaveis++;
    const marca = ok === REPETICOES ? 'OK ' : ok === 0 ? '-- ' : '~~ ';
    console.log(`  ${marca} "${mensagem}"  true ${ok}/${REPETICOES} | naturezas={${[...naturezas].join(',')}}${pol > 0 ? ` | POLUIU ${pol} {${[...poluidos].join(',')}}` : ''}${aus > 0 ? ` | campo ausente ${aus}` : ''}${err > 0 ? ` | erro ${err}` : ''}`);
  }

  console.log(`  CONTROLES (esperado: ${CAMPO}=false)`);
  for (const mensagem of CONTROLES) {
    let fp = 0; let err = 0;
    const naturezas = new Set<string>();
    for (let r = 0; r < REPETICOES; r++) {
      const o = await observar(cliente, variante, schema, mensagem);
      p.controlesTotal++;
      if (o.erro) { err++; p.erros++; continue; }
      if (o.natureza !== undefined) naturezas.add(o.natureza);
      if (o.marcouTrue) { fp++; p.falsosPositivos++; }
    }
    if (fp !== 0 && fp !== REPETICOES) p.instaveis++;
    console.log(`  ${fp === 0 ? 'OK ' : '!!!'} "${mensagem}"  falso positivo ${fp}/${REPETICOES} | naturezas={${[...naturezas].join(',')}}${err > 0 ? ` | erro ${err}` : ''}${fp > 0 ? '  *** SEQUESTRO DE DUVIDA ***' : ''}`);
  }

  console.log('');
  console.log(`  positivos reconhecidos     : ${p.reconhecidos}/${p.positivosTotal}`);
  console.log(`  FALSOS POSITIVOS (controle): ${p.falsosPositivos}/${p.controlesTotal}`);
  console.log(`  poluicao de outros campos  : ${p.poluicao}/${p.positivosTotal}`);
  console.log(`  frases INSTAVEIS           : ${p.instaveis}/${POSITIVOS.length + CONTROLES.length}`);
  console.log(`  campo ausente na saida     : ${p.ausencias}`);
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

  console.log('--- medicao: CAMPO RAIZ de classificacao (duvida sobre agendamento proprio) ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log(`campo medido: ${CAMPO} (boolean, obrigatorio no schema)`);
  console.log('Nenhum modulo de producao alterado. `intencao` permanece INTACTA.');
  console.log(`casos por variante: ${POSITIVOS.length} positivos + ${CONTROLES.length} controles x ${REPETICOES} repeticoes`);

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const schema = montarSchema();
  const a = await executarVariante(cliente, montarVarianteA(), schema);
  const b = await executarVariante(cliente, montarVarianteB(), schema);

  console.log('');
  console.log('##### COMPARACAO #####');
  console.log(`  reconhecidos      : A ${a.reconhecidos}/${a.positivosTotal}  ->  B ${b.reconhecidos}/${b.positivosTotal}`);
  console.log(`  FALSOS POSITIVOS  : A ${a.falsosPositivos}/${a.controlesTotal}  ->  B ${b.falsosPositivos}/${b.controlesTotal}`);
  console.log(`  poluicao          : A ${a.poluicao}/${a.positivosTotal}  ->  B ${b.poluicao}/${b.positivosTotal}`);
  console.log(`  frases instaveis  : A ${a.instaveis}  ->  B ${b.instaveis}`);
  console.log(`  erros de infra    : A ${a.erros}  ->  B ${b.erros}`);
  console.log(`  retentativas trunc: ${truncacoes}`);
}

main().catch((erro) => {
  console.error(`erro fatal: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
