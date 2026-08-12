// Runner REAL da implementacao final de cancelamento -- intencao.
//
// Diferente de medicao-colisao-desistencia-cancelamento.ts (que construia um
// schema/instrucao CANDIDATOS, antes da implementacao), este runner usa o
// contrato de PRODUCAO tal como implementado: INSTRUCOES_EXTRATOR e
// SCHEMA_SAIDA_INTERPRETACAO reais, com `cancelamento` ja em
// INTENCOES_PERMITIDAS e ZERO regra de prompt propria.
//
// Prova o contrato aprovado: o contexto que ja existe distingue desistencia
// DA CONVERSA de cancelamento de agendamento EXISTENTE, sem nenhuma regra
// lexical e sem repertorio fechado.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-cancelamento-intencao.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { INSTRUCOES_EXTRATOR, SCHEMA_SAIDA_INTERPRETACAO } from '../core/interpretacao-instrucoes.ts';
import { validarSaidaInterpretacao } from '../core/interpretacao-extrator.ts';
import type { EntradaInterpretacao } from '../core/interpretacao-tipos.ts';

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

interface Caso {
  rotulo: string;
  payload: EntradaInterpretacao;
  esperaCancelamento: boolean;
}

// CONTEXTO A -- novo agendamento EM ANDAMENTO, nada marcado ainda.
function casoA(mensagem: string): Caso {
  return {
    rotulo: `A (novo agendamento em andamento) "${mensagem}"`,
    esperaCancelamento: false,
    payload: {
      mensagens_atuais: [mensagem],
      dados_atuais: {
        intencao: 'novo_agendamento',
        procedimento_id: 'cleaning',
        dentista_id: 'dent-ana',
        data_texto: 'amanha',
      },
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
    },
  };
}

// CONTEXTO B -- paciente com agendamento EXISTENTE, fora de novo agendamento.
function casoB(mensagem: string, comHistoricoDoAgendamento = false): Caso {
  return {
    rotulo: `B (agendamento existente) "${mensagem}"`,
    esperaCancelamento: true,
    payload: {
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
                resposta_iris:
                  'Sim! Voce tem uma Limpeza dental marcada com a Dra. Ana Souza para sexta-feira, 14/08 as 14:00.',
                gerada_em: AGORA_ISO,
              },
            ],
          }
        : {}),
    },
  };
}

const CASOS: readonly Caso[] = Object.freeze([
  casoA('deixa pra lá'),
  casoA('não quero mais marcar'),
  casoA('cancela isso'),
  casoB('quero cancelar minha consulta'),
  casoB('cancela meu horário'),
  casoB('não vou poder ir, cancela pra mim'),
  casoB('cancela isso', true),
]);

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: intencao cancelamento vs desistencia (contrato de PRODUCAO) ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('instrucoes e schema REAIS -- zero regra de prompt propria para cancelamento.');
  console.log('');

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  let acertos = 0;
  let perigosos = 0;

  for (const caso of CASOS) {
    try {
      const saida = await cliente.executar({
        instrucoes: INSTRUCOES_EXTRATOR,
        schema: SCHEMA_SAIDA_INTERPRETACAO,
        payload: caso.payload,
      });
      // Valida contra o validador REAL: prova que 'cancelamento' passa pelo
      // contrato de saida de producao, nao so pelo schema.
      validarSaidaInterpretacao(saida);
      const alteracoes = saida.alteracoes as Record<string, { acao: string; valor?: string } | undefined>;
      const intencaoAlt = alteracoes.intencao;
      const intencao = intencaoAlt && intencaoAlt.acao !== 'remover' ? intencaoAlt.valor : undefined;
      const emitiuCancelamento = intencao === 'cancelamento';
      const acertou = caso.esperaCancelamento ? emitiuCancelamento : !emitiuCancelamento;
      const perigoso = !caso.esperaCancelamento && emitiuCancelamento;

      if (acertou) acertos++;
      if (perigoso) perigosos++;

      const marca = perigoso ? '!!!' : acertou ? 'OK ' : '-- ';
      console.log(`${marca} ${caso.rotulo}`);
      console.log(
        `      natureza=${saida.natureza_mensagem} | intencao=${intencao ?? '(ausente)'}${perigoso ? '  *** PERIGOSO ***' : ''}`
      );
    } catch (erro) {
      console.log(`--  ${caso.rotulo}`);
      console.log(`      ERRO: ${erro instanceof Error ? erro.message : 'desconhecido'}`);
    }
  }

  console.log('');
  console.log('--- resumo ---');
  console.log(`acertos   : ${acertos}/${CASOS.length}`);
  console.log(`PERIGOSOS : ${perigosos}/${CASOS.length}  (cancelou sem pedido de cancelamento)`);
}

main().catch((erro) => {
  console.error(`erro fatal: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
