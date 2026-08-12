// Runner REAL: confirmacoes NATURAIS de cancelamento, sem a palavra literal
// "sim" (specs/cancelamento-conversacional-v1.md secao 4, teste 2b).
//
// Prova o contrato aprovado pelo Gabriel: a IA interpreta concordancia
// SEMANTICAMENTE; `confirmacao = 'sim'` e apenas o valor CANONICO INTERNO do
// campo. Nenhuma regra lexical, nenhum repertorio fechado -- a lista abaixo e
// ILUSTRATIVA, nunca uma enumeracao a esgotar.
//
// Usa o contrato de PRODUCAO (INSTRUCOES_EXTRATOR e SCHEMA_SAIDA_INTERPRETACAO
// reais), com `proposta_pendente` populado exatamente como o Core popula na
// decisao `aguardando_confirmacao_cancelamento` (data/horario CRUS do
// agendamento). Nenhuma linha de prompt foi acrescentada para cancelamento.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-confirmacoes-naturais-cancelamento.ts

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
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
];
const DENTISTAS_DISPONIVEIS = [{ dentista_id: 'dent-ana', nome_exibido: 'Dra. Ana Souza' }];

const AGORA_ISO = new Date().toISOString();

// Estado exato do turno seguinte a `aguardando_confirmacao_cancelamento`:
// `intencao` persistida, `proposta_pendente` gravada pela acao `propor`.
function payloadConfirmacao(mensagem: string): EntradaInterpretacao {
  return {
    mensagens_atuais: [mensagem],
    dados_atuais: { intencao: 'cancelamento' },
    campos_cadastrais_preenchidos: [],
    procedimentos_disponiveis: PROCEDIMENTOS_DISPONIVEIS,
    dentistas_disponiveis: DENTISTAS_DISPONIVEIS,
    proposta_pendente: { data: '2026-08-14', horario: '14:00' },
    historico_recente: [
      {
        mensagem_paciente: 'quero cancelar minha consulta',
        resposta_iris:
          'Você quer cancelar Limpeza dental com Dra. Ana Souza — 14/08 às 14:00? Isso não pode ser desfeito.',
        gerada_em: AGORA_ISO,
      },
    ],
  };
}

// ILUSTRATIVAS, nunca repertorio fechado (spec secao 4).
const CONFIRMACOES_NATURAIS = ['sim', 'pode', 'pode cancelar', 'ok', 'isso', 'beleza', 'pode sim'];

// Ambiguidade / duvida / negacao NUNCA autorizam (spec secao 4 e teste 2c).
const NAO_CONFIRMACOES = ['acho que sim, mas deixa eu ver', 'por quê?', 'não sei', 'não, deixa como está'];

async function classificar(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  mensagem: string
): Promise<{ natureza: string; confirmacao: string | undefined }> {
  const saida = await cliente.executar({
    instrucoes: INSTRUCOES_EXTRATOR,
    schema: SCHEMA_SAIDA_INTERPRETACAO,
    payload: payloadConfirmacao(mensagem),
  });
  validarSaidaInterpretacao(saida);
  const alteracoes = saida.alteracoes as Record<string, { acao: string; valor?: string } | undefined>;
  const alt = alteracoes.confirmacao;
  return {
    natureza: saida.natureza_mensagem,
    confirmacao: alt && alt.acao !== 'remover' ? alt.valor : undefined,
  };
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: confirmacoes NATURAIS de cancelamento (sem "sim" literal) ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('contrato de PRODUCAO, zero regra de prompt propria para cancelamento.');
  console.log('');

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  console.log('CONFIRMACOES (esperado: confirmacao=sim)');
  let confirmadas = 0;
  for (const mensagem of CONFIRMACOES_NATURAIS) {
    try {
      const { natureza, confirmacao } = await classificar(cliente, mensagem);
      const ok = confirmacao === 'sim';
      if (ok) confirmadas++;
      console.log(`${ok ? 'OK ' : '-- '} "${mensagem}"  ->  natureza=${natureza} | confirmacao=${confirmacao ?? '(ausente)'}`);
    } catch (erro) {
      console.log(`--  "${mensagem}"  ->  ERRO: ${erro instanceof Error ? erro.message : 'desconhecido'}`);
    }
  }

  console.log('');
  console.log('NAO-CONFIRMACOES (esperado: confirmacao AUSENTE -- duvida/negacao nunca autorizam)');
  let seguras = 0;
  for (const mensagem of NAO_CONFIRMACOES) {
    try {
      const { natureza, confirmacao } = await classificar(cliente, mensagem);
      const ok = confirmacao === undefined;
      if (ok) seguras++;
      console.log(
        `${ok ? 'OK ' : '!!!'} "${mensagem}"  ->  natureza=${natureza} | confirmacao=${confirmacao ?? '(ausente)'}${ok ? '' : '  *** PERIGOSO ***'}`
      );
    } catch (erro) {
      console.log(`--  "${mensagem}"  ->  ERRO: ${erro instanceof Error ? erro.message : 'desconhecido'}`);
    }
  }

  console.log('');
  console.log('--- resumo ---');
  console.log(`confirmacoes reconhecidas : ${confirmadas}/${CONFIRMACOES_NATURAIS.length}`);
  console.log(`nao-confirmacoes seguras  : ${seguras}/${NAO_CONFIRMACOES.length}  (PERIGOSO se < total)`);
}

main().catch((erro) => {
  console.error(`erro fatal: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
