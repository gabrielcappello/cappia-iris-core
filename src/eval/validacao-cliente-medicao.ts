// ETAPA 0 da Arquitetura V2: PROVA DE FIDELIDADE do instrumento de medicao.
//
// Um instrumento de medicao novo nao vale nada enquanto ninguem provar que
// ele nao muda a resposta. Este runner faz exatamente isso, com um par A/B
// (docs/00-principios.md, principio do teste isolado):
//
//   LADO A -- contrato de EXTRACAO, replicando fielmente o que cruzou a
//             fronteira HTTP nas medicoes historicas de 2026-08-11/12
//             (schema portatil real + instrucoes de producao com a mesma
//             substituicao estrutural + vocabulario estendido no rodape).
//             Resultado conhecido: 0/20.
//
//   LADO B -- contrato de DECISAO DE CAPACIDADE, o da Arquitetura V2.
//             Resultado conhecido (sonda de 2026-08-12): 20/20.
//
// Se o lado A reproduzir ~0/20 POR ESTE CLIENTE, o instrumento e fiel: ele
// nao inventa acerto onde nao havia. Se o lado B reproduzir ~20/20, a
// diferenca medida e do CONTRATO, nunca do instrumento -- que e a conclusao
// que a Etapa 1 precisa poder confiar.
//
// Mesmas 5 frases e 4 controles de todas as medicoes anteriores.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/validacao-cliente-medicao.ts

import { criarClienteMedicao, ErroClienteMedicao, MODELO_MEDICAO, type ClienteMedicao } from './cliente-medicao-openai.ts';
import { CAMPOS_EMITIVEIS_PELA_IA, INTENCOES_PERMITIDAS } from '../core/aplicar-dados.ts';
import { NATUREZAS_MENSAGEM_PERMITIDAS, TIPOS_EVENTO_CANDIDATO_PERMITIDOS } from '../core/interpretacao-tipos.ts';
import { INSTRUCOES_EXTRATOR } from '../core/interpretacao-instrucoes.ts';

// ── LADO A: replica do contrato de extracao REALMENTE enviado ───────────
// O schema abaixo e a replica do SCHEMA_PORTATIL_APROVADO (privado de
// cliente-modelo-openai.ts) -- derivado das MESMAS constantes de producao,
// nunca de listas copiadas a mao.
//
// NOTA IMPORTANTE PARA O REGISTRO HISTORICO: `valor` e uma string livre
// neste schema. As medicoes historicas construiram um schema candidato com
// o enum de `intencao` ESTENDIDO, mas o cliente de producao descartava esse
// schema -- ou seja, o enum nunca chegou a API. O que de fato informou o
// modelo sobre o valor novo foi somente o rodape das instrucoes (que passa
// intacto). A conclusao da auditoria nao muda: o modelo PODIA emitir a
// string e nao emitiu. Mas o que foi medido nao foi "enum estendido".
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

// As duas frases de cliente-modelo-openai.ts, replicadas: producao troca a
// primeira pela segunda antes de enviar. Sem essa troca, a instrucao
// descreveria um formato diferente do schema enviado.
const FRASE_FORMATO_INTERNO =
  'Responda estritamente no formato do schema fornecido — nenhuma propriedade alem de "natureza_mensagem" e "alteracoes" no nivel principal, nenhuma propriedade alem de "acao"/"valor" (ou somente "acao" para remover) dentro de cada alteracao.';
const FRASE_TRANSPORTE_PORTATIL =
  'Responda estritamente no formato do schema fornecido — a raiz contem somente "natureza_mensagem" e "alteracoes"; "alteracoes" e uma lista; cada item da lista contem exatamente "campo", "acao" e "valor"; informar e corrigir usam "valor" como string; remover usa "valor": null; nenhuma propriedade adicional e permitida.';

const INTENCAO_NOVA = 'consulta_agendamento';

function instrucoesExtracao(): string {
  const rodapeProducao = `Valores permitidos para intencao: ${INTENCOES_PERMITIDAS.join(', ')}.`;
  const rodapeEstendido = `Valores permitidos para intencao: ${[...INTENCOES_PERMITIDAS, INTENCAO_NOVA].join(', ')}.`;
  if (!INSTRUCOES_EXTRATOR.includes(FRASE_FORMATO_INTERNO)) {
    throw new Error('frase estrutural nao encontrada -- runner desatualizado');
  }
  if (!INSTRUCOES_EXTRATOR.includes(rodapeProducao)) {
    throw new Error('rodape de intencao nao encontrado -- runner desatualizado');
  }
  return INSTRUCOES_EXTRATOR.replace(FRASE_FORMATO_INTERNO, FRASE_TRANSPORTE_PORTATIL).replace(
    rodapeProducao,
    rodapeEstendido
  );
}

// ── LADO B: contrato de decisao de capacidade ──────────────────────────
const CAPACIDADES = [
  'consultar_agendamento_do_paciente',
  'novo_agendamento',
  'remarcar',
  'cancelar',
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

// SEM regra por capacidade -- deliberadamente, para ser comparavel ao lado
// A, que tambem nao tem regra propria para o valor novo.
const INSTRUCOES_CAPACIDADE = `
Voce e a Iris, assistente de uma clinica odontologica, conversando com um paciente pelo WhatsApp.

Leia a mensagem do paciente e decida UMA coisa: qual capacidade do sistema voce precisa acionar para responder bem.

Valores possiveis para capacidade:
${CAPACIDADES.map((c) => `- ${c}`).join('\n')}

Use "nenhuma_apenas_conversar" quando conseguir responder sem consultar nem alterar nada no sistema.

Em "justificativa", explique em uma frase curta o que voce entendeu que o paciente quer.
`.trim();

// ── Casos: identicos a todas as medicoes anteriores ─────────────────────
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
const MAX_RETENTATIVAS = 2;

// Payload do lado A: fiel a producao (conversa limpa, catalogo presente).
const PAYLOAD_EXTRACAO_BASE = {
  dados_atuais: {},
  campos_cadastrais_preenchidos: [] as string[],
  procedimentos_disponiveis: [
    { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental' },
    { procedimento_id: 'implant', nome_pt: 'Implante dentário' },
    { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
  ],
  dentistas_disponiveis: [
    { dentista_id: 'dent-ana', nome_exibido: 'Dra. Ana Souza' },
    { dentista_id: 'dent-bruno', nome_exibido: 'Dr. Bruno Lima' },
  ],
};

interface Lado {
  rotulo: string;
  /** Devolve true quando a saida representa "consultar o proprio agendamento". */
  reconheceu(saida: unknown): boolean;
  executar(cliente: ClienteMedicao, mensagem: string): Promise<unknown>;
}

const LADO_A: Lado = {
  rotulo: 'A -- contrato de EXTRACAO (replica fiel do historico)',
  reconheceu(saida) {
    const alteracoes = (saida as { alteracoes?: unknown }).alteracoes;
    if (!Array.isArray(alteracoes)) return false;
    return alteracoes.some(
      (item) =>
        (item as { campo?: string }).campo === 'intencao' && (item as { valor?: string }).valor === INTENCAO_NOVA
    );
  },
  executar(cliente, mensagem) {
    return cliente.executar({
      instrucoes: instrucoesExtracao(),
      schema: SCHEMA_EXTRACAO,
      payload: { mensagens_atuais: [mensagem], ...PAYLOAD_EXTRACAO_BASE },
      nomeSchema: 'alteracoes_iris',
    });
  },
};

const LADO_B: Lado = {
  rotulo: 'B -- contrato de DECISAO DE CAPACIDADE (V2)',
  reconheceu(saida) {
    return (saida as { capacidade?: string }).capacidade === 'consultar_agendamento_do_paciente';
  },
  executar(cliente, mensagem) {
    return cliente.executar({
      instrucoes: INSTRUCOES_CAPACIDADE,
      schema: SCHEMA_CAPACIDADE,
      payload: { mensagens_atuais: [mensagem] },
      nomeSchema: 'decisao_capacidade',
    });
  },
};

async function observar(cliente: ClienteMedicao, lado: Lado, mensagem: string): Promise<boolean | null> {
  for (let tentativa = 0; tentativa <= MAX_RETENTATIVAS; tentativa++) {
    try {
      return lado.reconheceu(await lado.executar(cliente, mensagem));
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

async function medirLado(cliente: ClienteMedicao, lado: Lado): Promise<{ ok: number; total: number; fp: number; fpTotal: number }> {
  console.log('');
  console.log(`##### ${lado.rotulo} #####`);
  let ok = 0;
  let total = 0;
  let fp = 0;
  let fpTotal = 0;

  console.log('  CONSULTAS (esperado: reconhecer)');
  for (const mensagem of CONSULTAS) {
    let acertos = 0;
    for (let r = 0; r < REPETICOES; r++) {
      const resultado = await observar(cliente, lado, mensagem);
      total++;
      if (resultado === true) { acertos++; ok++; }
    }
    console.log(`  ${acertos === REPETICOES ? 'OK ' : acertos === 0 ? '-- ' : '~~ '} "${mensagem}"  ${acertos}/${REPETICOES}`);
  }

  console.log('  CONTROLES (esperado: NUNCA reconhecer)');
  for (const mensagem of CONTROLES) {
    let falsos = 0;
    for (let r = 0; r < REPETICOES; r++) {
      const resultado = await observar(cliente, lado, mensagem);
      fpTotal++;
      if (resultado === true) { falsos++; fp++; }
    }
    console.log(`  ${falsos === 0 ? 'OK ' : '!!!'} "${mensagem}"  falso positivo ${falsos}/${REPETICOES}`);
  }

  console.log(`  => reconhecidas ${ok}/${total} | falsos positivos ${fp}/${fpTotal}`);
  return { ok, total, fp, fpTotal };
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- ETAPA 0: prova de fidelidade do instrumento de medicao ---');
  console.log(`modelo: ${MODELO_MEDICAO}`);
  console.log('Os DOIS lados passam pelo MESMO cliente novo. So o contrato muda.');
  console.log('Referencia historica: lado A = 0/20 (cliente de producao, 2026-08-12).');

  const cliente = criarClienteMedicao({ chaveApi });
  const a = await medirLado(cliente, LADO_A);
  const b = await medirLado(cliente, LADO_B);

  console.log('');
  console.log('--- veredito ---');
  console.log(`  lado A (extracao)  : ${a.ok}/${a.total} reconhecidas | ${a.fp}/${a.fpTotal} falsos positivos`);
  console.log(`  lado B (capacidade): ${b.ok}/${b.total} reconhecidas | ${b.fp}/${b.fpTotal} falsos positivos`);
  console.log('');
  const fiel = a.ok <= 2;
  console.log(
    fiel
      ? '  INSTRUMENTO FIEL: reproduziu o resultado historico do contrato antigo.'
      : `  ATENCAO: lado A deu ${a.ok}/${a.total}, divergente do historico (0/20). Investigar antes de usar o instrumento.`
  );
  process.exitCode = fiel ? 0 : 1;
}

main().catch((erro) => {
  console.error(`erro fatal: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
