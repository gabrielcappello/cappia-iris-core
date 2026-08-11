// Runner ISOLADO, avulso: RE-MEDICAO com PAYLOAD FIEL A PRODUCAO.
//
// POR QUE ESTE RUNNER EXISTE -- falha de fidelidade nas medicoes anteriores:
//
// `medicao-escolha-por-procedimento.ts` e `teste-real-escolha-agendamento.ts`
// enviaram `agendamentos_ativos` SOZINHO. Producao (orquestrador.ts) NUNCA
// faz isso: quando ha escolha de agendamento pendente, o payload leva
// `procedimentos_disponiveis` e `dentistas_disponiveis` TAMBEM -- eles sao
// incluidos sempre que a clinica tem catalogo, independentemente do fluxo.
//
// Isso importa porque a instrucao diz "Quando 'procedimentos_disponiveis' nao
// estiver presente, nunca emita 'procedimento_id'". Nas medicoes anteriores
// essa chave estava AUSENTE, entao o modelo foi observado num estado que
// producao nunca produz -- e ele emitiu `procedimento_id` mesmo assim, com
// texto cru ("limpeza") ou com o UUID do agendamento no campo errado.
//
// Ou seja: os numeros anteriores (4/16, 9/10) mediram um payload irreal. Este
// runner refaz a mesma pergunta com o payload que o paciente real produz.
//
// Mesmo desenho da medicao anterior: 8 procedimentos x 2 posicoes = 16
// rodadas, mesmo distrator, mesmas frases. A UNICA variavel alterada e a
// presenca das duas chaves que producao sempre envia.
//
// NENHUMA CORRECAO E PROPOSTA AQUI. So dados.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-escolha-procedimento-payload-fiel.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { construirEntradaMinimizada, extrairAlteracoes } from '../core/interpretacao-extrator.ts';
import type { SnapshotOficialConversa } from '../core/interpretacao-tipos.ts';

const APOS_INTENCAO: SnapshotOficialConversa = { intencao: 'remarcacao' };

// Catalogo da clinica -- ids canonicos, como carregarCatalogo produz.
const PROCEDIMENTOS_DISPONIVEIS = [
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental' },
  { procedimento_id: 'implant', nome_pt: 'Implante dentário' },
  { procedimento_id: 'root_canal', nome_pt: 'Tratamento de canal' },
  { procedimento_id: 'filling', nome_pt: 'Restauração dentária' },
  { procedimento_id: 'whitening', nome_pt: 'Clareamento dental' },
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
  { procedimento_id: 'ortho_maintenance', nome_pt: 'Manutenção de aparelho ortodôntico' },
  { procedimento_id: 'extraction', nome_pt: 'Extração de dente' },
];

const DENTISTAS_DISPONIVEIS = [
  { dentista_id: 'dent-ana', nome_exibido: 'Dra. Ana Souza' },
  { dentista_id: 'dent-bruno', nome_exibido: 'Dr. Bruno Lima' },
];

interface CasoProcedimento {
  nomeProcedimento: string;
  mensagem: string;
  distratorDescricao: string;
}

const DISTRATOR_PADRAO = 'Consulta / Avaliação com Dr. Bruno Lima em 21/08 às 09:00';
const DISTRATOR_PARA_CONSULTA = 'Limpeza dental com Dra. Ana Souza em 21/08 às 09:00';

const CASOS: readonly CasoProcedimento[] = Object.freeze([
  { nomeProcedimento: 'Limpeza dental', mensagem: 'a limpeza', distratorDescricao: DISTRATOR_PADRAO },
  { nomeProcedimento: 'Implante dentário', mensagem: 'o implante', distratorDescricao: DISTRATOR_PADRAO },
  { nomeProcedimento: 'Tratamento de canal', mensagem: 'o canal', distratorDescricao: DISTRATOR_PADRAO },
  { nomeProcedimento: 'Restauração dentária', mensagem: 'a restauração', distratorDescricao: DISTRATOR_PADRAO },
  { nomeProcedimento: 'Clareamento dental', mensagem: 'o clareamento', distratorDescricao: DISTRATOR_PADRAO },
  { nomeProcedimento: 'Consulta / Avaliação', mensagem: 'a consulta', distratorDescricao: DISTRATOR_PARA_CONSULTA },
  { nomeProcedimento: 'Manutenção de aparelho ortodôntico', mensagem: 'o aparelho', distratorDescricao: DISTRATOR_PADRAO },
  { nomeProcedimento: 'Extração de dente', mensagem: 'a extração', distratorDescricao: DISTRATOR_PADRAO },
]);

interface Rodada {
  nomeProcedimento: string;
  mensagem: string;
  posicaoAlvo: 1 | 2;
  agendamentosAtivos: { agendamento_id: string; descricao: string }[];
  idAlvo: string;
  idDistrator: string;
}

function montarRodadas(): Rodada[] {
  const rodadas: Rodada[] = [];
  for (const caso of CASOS) {
    const idAlvo = crypto.randomUUID();
    const idDistrator = crypto.randomUUID();
    const alvo = { agendamento_id: idAlvo, descricao: `${caso.nomeProcedimento} com Dra. Ana Souza em 14/08 às 14:00` };
    const distrator = { agendamento_id: idDistrator, descricao: caso.distratorDescricao };
    for (const posicaoAlvo of [1, 2] as const) {
      rodadas.push({
        nomeProcedimento: caso.nomeProcedimento,
        mensagem: caso.mensagem,
        posicaoAlvo,
        agendamentosAtivos: posicaoAlvo === 1 ? [alvo, distrator] : [distrator, alvo],
        idAlvo,
        idDistrator,
      });
    }
  }
  return rodadas;
}

function classificar(alteracoes: Record<string, { acao: string; valor?: string } | undefined>, rodada: Rodada): string {
  const agendamentoId = alteracoes.agendamento_id?.valor;
  const procedimentoId = alteracoes.procedimento_id?.valor;

  if (agendamentoId === rodada.idAlvo) return 'CORRETO';
  if (agendamentoId === rodada.idDistrator) return 'ALVO_ERRADO';
  if (agendamentoId !== undefined) return 'ALUCINADO';
  if (procedimentoId === rodada.idAlvo || procedimentoId === rodada.idDistrator) return 'CAMPO_ERRADO_UUID';
  if (procedimentoId !== undefined) return 'OMITIU_agendamento_MAS_emitiu_procedimento_id';
  return 'OMITIU';
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  const rodadas = montarRodadas();

  console.log('--- RE-MEDICAO com payload FIEL A PRODUCAO ---');
  console.log('agendamentos_ativos + procedimentos_disponiveis + dentistas_disponiveis, como orquestrador.ts envia.');
  console.log('NENHUMA CORRECAO proposta -- so dados.');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log(`rodadas: ${rodadas.length}`);
  console.log('');

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const contagem = new Map<string, number>();
  const porPosicao = new Map<number, number>([
    [1, 0],
    [2, 0],
  ]);
  let acertos = 0;

  for (const rodada of rodadas) {
    const entrada = construirEntradaMinimizada(
      [rodada.mensagem],
      APOS_INTENCAO,
      undefined, // horarios_oferecidos
      undefined, // proposta_pendente
      undefined, // historico_recente
      PROCEDIMENTOS_DISPONIVEIS, // <-- presente, como em producao
      DENTISTAS_DISPONIVEIS, // <-- presente, como em producao
      undefined, // oferta_procedimento_pendente
      undefined, // cadastro_paciente
      undefined, // troca_telefone_pendente
      rodada.agendamentosAtivos
    );

    let veredito: string;
    let alteracoesTexto: string;
    try {
      const saida = await extrairAlteracoes(cliente, entrada);
      const alteracoes = saida.alteracoes as Record<string, { acao: string; valor?: string } | undefined>;
      veredito = classificar(alteracoes, rodada);
      alteracoesTexto = JSON.stringify(alteracoes);
    } catch (erro) {
      veredito = 'ERRO_TECNICO';
      alteracoesTexto = erro instanceof Error ? erro.message : 'desconhecido';
    }

    contagem.set(veredito, (contagem.get(veredito) ?? 0) + 1);
    if (veredito === 'CORRETO') {
      acertos++;
      porPosicao.set(rodada.posicaoAlvo, (porPosicao.get(rodada.posicaoAlvo) ?? 0) + 1);
    }

    console.log(`${rodada.nomeProcedimento} (pos ${rodada.posicaoAlvo}) -- "${rodada.mensagem}"`);
    console.log(`  ${veredito}`);
    console.log(`  alteracoes: ${alteracoesTexto}`);
    console.log('');
  }

  console.log('--- resumo por modo ---');
  for (const [modo, quantidade] of [...contagem].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${modo}: ${quantidade}/${rodadas.length}`);
  }
  console.log('');
  console.log('--- acertos por posicao do alvo ---');
  console.log(`  posicao 1: ${porPosicao.get(1)}/8`);
  console.log(`  posicao 2: ${porPosicao.get(2)}/8`);
  console.log('');
  console.log(`--- resultado geral: ${acertos}/${rodadas.length} ---`);
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal: ${mensagem}`);
  process.exitCode = 1;
});
