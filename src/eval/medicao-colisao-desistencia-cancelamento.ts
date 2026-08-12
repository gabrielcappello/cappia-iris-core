// Runner ISOLADO, avulso: MEDICAO PRE-IMPLEMENTACAO. Nenhum modulo de
// producao e alterado por este arquivo -- 'cancelamento' NAO existe em
// INTENCOES_PERMITIDAS nem em CAMPOS_EMITIVEIS_PELA_IA hoje. Este runner
// constroi um schema e uma instrucao CANDIDATOS, isolados, so para medir.
//
// OBJETIVO (pedido do Gabriel, 2026-08-11): descobrir se ha colisao
// semantica entre desistencia DA CONVERSA (novo agendamento em andamento) e
// cancelamento de um agendamento JA EXISTENTE -- specs/novo-agendamento.md
// secao 18 lista "Cancela isso" como exemplo de desistencia; atendimento-v1.md
// diz explicitamente "Nao interpretar como cancelamento de agendamento
// existente". Cancelamento hoje nao existe, entao essa regra nunca foi
// testada sob pressao real.
//
// DUAS VARIANTES, no mesmo espirito das medicoes de remarcacao:
//   1 (NUA): so adiciona 'cancelamento' ao enum de intencao, SEM nenhuma
//      instrucao textual sobre quando emiti-lo. Testa se o nome do proprio
//      valor + o contexto (dados_atuais/historico_recente) ja bastam.
//   2 (CANDIDATA): acrescenta UMA linha de instrucao, no mesmo padrao ja
//      aprovado para intencao=remarcacao (mesma forma: "somente quando... a
//      mera desistencia... nao emite essa intencao").
//
// Nao cria evento novo, nao cria parser, nao cria regra lexical -- so texto
// de instrucao para o extrator, exatamente como todas as regras de intencao
// ja existentes.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-colisao-desistencia-cancelamento.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { INSTRUCOES_EXTRATOR } from '../core/interpretacao-instrucoes.ts';
import type { EntradaInterpretacao } from '../core/interpretacao-tipos.ts';

// --- Vocabulario de producao, EXATO (copiado de aplicar-dados.ts, so leitura) ---
const CAMPOS_EMITIVEIS_PELA_IA = [
  'intencao', 'procedimento_id', 'agendamento_id', 'data_texto', 'periodo',
  'horario_texto', 'confirmacao', 'nome', 'cpf', 'data_nascimento', 'email',
];
const PERIODOS_PERMITIDOS = ['manha', 'tarde', 'noite'];
const CONFIRMACOES_PERMITIDAS = ['sim'];
const NATUREZAS_MENSAGEM_PERMITIDAS = ['saudacao', 'duvida', 'pedido', 'resposta', 'correcao', 'negacao', 'nao_compreendida'];
const TIPOS_EVENTO_CANDIDATO_PERMITIDOS = ['aceitar_opcao', 'aceitar_troca_telefone'];

// --- INTENCOES: producao + 'cancelamento', SO PARA ESTA MEDICAO ---
const INTENCOES_COM_CANCELAMENTO = ['novo_agendamento', 'remarcacao', 'cancelamento'];

function schemaValorCampo(campo: string): object {
  if (campo === 'periodo') return { type: 'string', enum: [...PERIODOS_PERMITIDOS] };
  if (campo === 'intencao') return { type: 'string', enum: [...INTENCOES_COM_CANCELAMENTO] };
  if (campo === 'confirmacao') return { type: 'string', enum: [...CONFIRMACOES_PERMITIDAS] };
  return { type: 'string', minLength: 1 };
}

// Mesma FORMA do schema de producao (interpretacao-instrucoes.ts), so com o
// enum de intencao estendido. additionalProperties:false em todos os niveis,
// identico ao contrato real.
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

// --- VARIANTE 1 (NUA): so estende o vocabulario declarado no rodape das
// instrucoes de producao -- SEM nenhuma linha nova de regra. ---
const RODAPE_PRODUCAO = 'Valores permitidos para intencao: novo_agendamento, remarcacao.';
const RODAPE_NU = 'Valores permitidos para intencao: novo_agendamento, remarcacao, cancelamento.';

function instrucoesVariante1(): string {
  if (!INSTRUCOES_EXTRATOR.includes(RODAPE_PRODUCAO)) {
    throw new Error('Rodape de producao nao encontrado -- runner desatualizado.');
  }
  return INSTRUCOES_EXTRATOR.replace(RODAPE_PRODUCAO, RODAPE_NU);
}

// --- VARIANTE 2 (CANDIDATA): variante 1 + UMA linha nova, no MESMO PADRAO
// ja aprovado e publicado para intencao=remarcacao (mesma forma exata:
// "somente quando... ex.: ...; a mera mencao/desistencia... nao emite"). ---
const LINHA_REMARCACAO =
  '- Emita intencao = remarcacao somente quando a janela atual expressar um pedido de MUDAR um atendimento que o paciente ja tem marcado (ex.: "preciso remarcar minha consulta", "da pra mudar meu horario?", "quero trocar o dia da minha consulta"); a mera mencao a data, horario ou procedimento, sozinha, nao emite essa intencao.';

const LINHA_CANCELAMENTO =
  '- Emita intencao = cancelamento somente quando a janela atual expressar um pedido explicito de CANCELAR ou DESMARCAR um atendimento que o paciente ja tem marcado (ex.: "quero cancelar minha consulta", "cancela meu horario", "nao vou poder ir, cancela pra mim"); uma desistencia de continuar a conversa atual -- "deixa pra la", "nao quero mais marcar", "cancela isso" referindo-se ao que esta sendo tratado nesta janela, sem nenhum agendamento ja marcado em discussao -- nao emite essa intencao: classifique como natureza_mensagem = negacao.';

function instrucoesVariante2(): string {
  const base = instrucoesVariante1();
  if (!base.includes(LINHA_REMARCACAO)) {
    throw new Error('Linha de remarcacao nao encontrada -- runner desatualizado.');
  }
  return base.replace(LINHA_REMARCACAO, `${LINHA_REMARCACAO}\n${LINHA_CANCELAMENTO}`);
}

// --- VARIANTE 3 (CANDIDATA SEM EXEMPLO LITERAL AMBIGUO): mesma ideia da
// variante 2, mas SEM listar "cancela isso" como exemplo de negacao -- a
// variante 2 tratou esse exemplo textual como mais forte que o contexto
// (historico_recente com o agendamento existente), e "cancela isso" com
// agendamento em discussao passou a falhar. A regra aqui e puramente sobre
// EXISTIR ou NAO um atendimento ja marcado em discussao, nunca sobre a frase
// especifica usada.
const LINHA_CANCELAMENTO_V3 =
  '- Emita intencao = cancelamento somente quando a janela atual expressar um pedido explicito de CANCELAR ou DESMARCAR um atendimento que o paciente ja tem marcado (ex.: "quero cancelar minha consulta", "cancela meu horario", "nao vou poder ir, cancela pra mim"); a mesma palavra usada para desistir de um novo agendamento AINDA EM ANDAMENTO nesta conversa, quando nao ha nenhum atendimento ja marcado em discussao, e desistencia, nao cancelamento -- classifique como natureza_mensagem = negacao. Quando houver um atendimento ja marcado sendo discutido (por exemplo, mencionado no historico_recente) e o paciente pedir para cancela-lo, mesmo com poucas palavras, emita intencao = cancelamento.';

function instrucoesVariante3(): string {
  const base = instrucoesVariante1();
  if (!base.includes(LINHA_REMARCACAO)) {
    throw new Error('Linha de remarcacao nao encontrada -- runner desatualizado.');
  }
  return base.replace(LINHA_REMARCACAO, `${LINHA_REMARCACAO}\n${LINHA_CANCELAMENTO_V3}`);
}

// --- Catalogo fiel a producao ---
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

type Contexto = 'A_NOVO_AGENDAMENTO_EM_ANDAMENTO' | 'B_AGENDAMENTO_EXISTENTE';

interface Caso {
  id: string;
  contexto: Contexto;
  mensagem: string;
  payload: EntradaInterpretacao;
  esperaCancelamento: boolean; // true = espera intencao=cancelamento; false = espera negacao sem cancelamento
}

const AGORA_ISO = new Date().toISOString();

// CONTEXTO A -- novo agendamento em andamento: paciente ja pediu limpeza,
// escolheu dentista, e o Core acabou de oferecer horarios. Nenhum
// agendamento existente em jogo nesta janela.
function casoA(mensagem: string, comHistorico: boolean): Caso {
  const payload: EntradaInterpretacao = {
    mensagens_atuais: [mensagem],
    dados_atuais: { intencao: 'novo_agendamento', procedimento_id: 'cleaning', dentista_id: 'dent-ana', data_texto: 'amanha' },
    campos_cadastrais_preenchidos: [],
    procedimentos_disponiveis: PROCEDIMENTOS_DISPONIVEIS,
    dentistas_disponiveis: DENTISTAS_DISPONIVEIS,
    horarios_oferecidos: ['09:00', '10:00', '11:00'],
    ...(comHistorico
      ? {
          historico_recente: [
            {
              mensagem_paciente: 'Quero marcar uma limpeza com a Dra. Ana amanha',
              resposta_iris: 'Certo! Para amanha com a Dra. Ana tenho os horarios 09:00, 10:00 e 11:00. Qual prefere?',
              gerada_em: AGORA_ISO,
            },
          ],
        }
      : {}),
  };
  return { id: `A: "${mensagem}"`, contexto: 'A_NOVO_AGENDAMENTO_EM_ANDAMENTO', mensagem, payload, esperaCancelamento: false };
}

// CONTEXTO B -- paciente com agendamento existente, FORA de novo
// agendamento: nada em andamento nesta conversa (dados_atuais vazio).
function casoB(mensagem: string, comHistoricoDoAgendamento: boolean): Caso {
  const payload: EntradaInterpretacao = {
    mensagens_atuais: [mensagem],
    dados_atuais: {},
    campos_cadastrais_preenchidos: [],
    procedimentos_disponiveis: PROCEDIMENTOS_DISPONIVEIS,
    dentistas_disponiveis: DENTISTAS_DISPONIVEIS,
    ...(comHistoricoDoAgendamento
      ? {
          historico_recente: [
            {
              mensagem_paciente: 'Eu ainda tenho uma consulta marcada?',
              resposta_iris: 'Sim! Voce tem uma Limpeza dental marcada com a Dra. Ana Souza para sexta-feira, 14/08 as 14:00.',
              gerada_em: AGORA_ISO,
            },
          ],
        }
      : {}),
  };
  return { id: `B: "${mensagem}"${comHistoricoDoAgendamento ? ' (com historico do agendamento)' : ''}`, contexto: 'B_AGENDAMENTO_EXISTENTE', mensagem, payload, esperaCancelamento: true };
}

const CASOS: readonly Caso[] = Object.freeze([
  casoA('deixa pra lá', false),
  casoA('não quero mais marcar', false),
  casoA('cancela isso', true), // com historico do PROPRIO novo agendamento em andamento
  casoB('quero cancelar minha consulta', false),
  casoB('cancela meu horário', false),
  casoB('não vou poder ir, cancela pra mim', false),
  casoB('cancela isso', true), // com historico do agendamento EXISTENTE
]);

interface Veredito {
  natureza: string | undefined;
  intencaoEmitida: string | undefined;
  acertou: boolean;
  perigoso: boolean; // emitiu cancelamento quando NAO deveria -- o unico risco realmente perigoso
  detalhe: string;
}

function avaliar(saidaBruta: unknown, caso: Caso): Veredito {
  if (saidaBruta === null || typeof saidaBruta !== 'object') {
    return { natureza: undefined, intencaoEmitida: undefined, acertou: false, perigoso: false, detalhe: 'SAIDA MALFORMADA (nao e objeto)' };
  }
  const saida = saidaBruta as Record<string, unknown>;
  const natureza = typeof saida.natureza_mensagem === 'string' ? saida.natureza_mensagem : undefined;
  const alteracoes = (saida.alteracoes ?? {}) as Record<string, { acao?: string; valor?: string } | undefined>;
  const intencaoAlt = alteracoes.intencao;
  const intencaoEmitida = intencaoAlt && intencaoAlt.acao !== 'remover' ? intencaoAlt.valor : undefined;

  const emitiuCancelamento = intencaoEmitida === 'cancelamento';
  const acertou = caso.esperaCancelamento ? emitiuCancelamento : !emitiuCancelamento;
  // PERIGOSO = exatamente o desfecho inaceitavel: cancelar algo que o
  // paciente nao pediu para cancelar (falso positivo em contexto A).
  const perigoso = !caso.esperaCancelamento && emitiuCancelamento;

  const partes: string[] = [`natureza=${natureza ?? '(ausente)'}`, `intencao=${intencaoEmitida ?? '(ausente)'}`];
  if (perigoso) partes.push('*** PERIGOSO: cancelou sem pedido de cancelamento ***');
  if (!acertou && !perigoso) partes.push('(esperava cancelamento e nao veio -- falso negativo, nao perigoso)');

  return { natureza, intencaoEmitida, acertou, perigoso, detalhe: partes.join(' | ') };
}

interface Placar {
  acertos: number;
  perigosos: number;
  total: number;
}

async function executarVariante(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  nome: string,
  instrucoes: string,
  schema: object
): Promise<Placar> {
  console.log('');
  console.log(`##### VARIANTE: ${nome} #####`);
  const placar: Placar = { acertos: 0, perigosos: 0, total: CASOS.length };

  for (const caso of CASOS) {
    let veredito: Veredito;
    try {
      const saida = await cliente.executar({ instrucoes, schema, payload: caso.payload });
      veredito = avaliar(saida, caso);
    } catch (erro) {
      veredito = { natureza: undefined, intencaoEmitida: undefined, acertou: false, perigoso: false, detalhe: `ERRO: ${erro instanceof Error ? erro.message : 'desconhecido'}` };
    }
    if (veredito.acertou) placar.acertos++;
    if (veredito.perigoso) placar.perigosos++;
    const marca = veredito.perigoso ? '!!!' : veredito.acertou ? 'OK ' : '-- ';
    console.log(`${marca} ${caso.id}  [espera ${caso.esperaCancelamento ? 'CANCELAMENTO' : 'sem cancelamento (negacao)'}]`);
    console.log(`      ${veredito.detalhe}`);
  }

  console.log('');
  console.log(`  acertos   : ${placar.acertos}/${placar.total}`);
  console.log(`  PERIGOSOS : ${placar.perigosos}/${placar.total}  (falso positivo: cancelou sem pedido)`);
  return placar;
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- medicao: colisao desistencia (novo agendamento) x cancelamento (agendamento existente) ---');
  console.log('Nenhum modulo de producao alterado. cancelamento NAO existe no vocabulario real.');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log(`casos: ${CASOS.length} (3 contexto A, 4 contexto B)`);

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const v1 = await executarVariante(cliente, '1 -- NUA: so o valor no enum, zero instrucao', instrucoesVariante1(), SCHEMA_CANDIDATO);
  const v2 = await executarVariante(cliente, '2 -- CANDIDATA: + 1 linha no padrao ja aprovado de remarcacao', instrucoesVariante2(), SCHEMA_CANDIDATO);
  const v3 = await executarVariante(cliente, '3 -- CANDIDATA sem exemplo literal ambiguo ("cancela isso")', instrucoesVariante3(), SCHEMA_CANDIDATO);

  console.log('');
  console.log('##### COMPARACAO #####');
  console.log(`  acertos   : nua ${v1.acertos}/${v1.total}  ->  candidata2 ${v2.acertos}/${v2.total}  ->  candidata3 ${v3.acertos}/${v3.total}`);
  console.log(`  PERIGOSOS : nua ${v1.perigosos}/${v1.total}  ->  candidata2 ${v2.perigosos}/${v2.total}  ->  candidata3 ${v3.perigosos}/${v3.total}`);
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal: ${mensagem}`);
  process.exitCode = 1;
});
