// Regressao real (2026-08-29): uma grafia imperfeita de "restauracao" foi
// confundida com "Retratamento de canal", apesar de a conversa estar tratando
// da restauracao do dente 17 definida pelo dentista.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-continuacao-tratamento-pendente.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { extrairAlteracoes } from '../core/interpretacao-extrator.ts';
import type { EntradaInterpretacao } from '../core/interpretacao-tipos.ts';

const DENTISTA = 'dentista-diego';

const BASE: Omit<EntradaInterpretacao, 'mensagens_atuais'> = {
  dados_atuais: {},
  campos_cadastrais_preenchidos: ['nome'],
  historico_recente: [
    {
      mensagem_paciente: 'quanto que fica esa ertauração?',
      resposta_iris: 'O valor da restauração ainda está sob avaliação pelo dentista. Se quiser, posso ajudar a agendar esse tratamento.',
      gerada_em: '2026-08-29T00:00:00.000Z',
    },
  ],
  procedimentos_disponiveis: [
    { procedimento_id: 'restoration_2', nome_pt: 'Restauração / Cárie (2+ faces)' },
    { procedimento_id: 'canal_retreatment', nome_pt: 'Retratamento de canal' },
    { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental (profilaxia)' },
  ],
  dentistas_disponiveis: [
    { dentista_id: DENTISTA, nome_exibido: 'Dr. Diego' },
    { dentista_id: 'dentista-pablo', nome_exibido: 'Dr. Pablo' },
  ],
  tratamentos_pendentes: [
    {
      procedimento_id: 'restoration_2',
      nome_pt: 'Restauração / Cárie (2+ faces)',
      dente: '17',
      dentista_id: DENTISTA,
      assunto_atual: true,
    },
  ],
};

const CASOS = [
  {
    mensagem: 'ok. qual dia pode me oferecer para fazer essa retaruação?',
    procedimento: 'restoration_2',
    dentista: undefined,
  },
  {
    mensagem: 'qual dia pode me oferecer para fazer essa restauração?',
    procedimento: 'restoration_2',
    dentista: undefined,
  },
  {
    mensagem: 'quero mudar de assunto: em vez dessa restauração, quero agendar uma limpeza',
    procedimento: 'cleaning',
    dentista: undefined,
  },
] as const;

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (!chaveApi) throw new Error('OPENAI_API_KEY ausente');

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  let acertos = 0;
  for (const caso of CASOS) {
    const saida = await extrairAlteracoes(cliente, { ...BASE, mensagens_atuais: [caso.mensagem] });
    const procedimento = saida.alteracoes.procedimento_id?.valor;
    const dentistas = saida.dentistas_candidatos;
    const dentistaCorreto =
      caso.dentista === undefined ? dentistas === null : dentistas?.length === 1 && dentistas[0] === caso.dentista;
    const passou = procedimento === caso.procedimento && dentistaCorreto;
    if (passou) acertos += 1;
    console.log(JSON.stringify({ mensagem: caso.mensagem, procedimento, dentistas, passou }));
  }

  console.log(`resultado=${acertos}/${CASOS.length}`);
  process.exitCode = acertos === CASOS.length ? 0 : 1;
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : 'erro desconhecido');
  process.exitCode = 1;
});
