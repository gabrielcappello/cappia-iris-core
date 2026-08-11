// Runner ISOLADO, avulso: DIAGNOSTICO, nao correcao.
//
// A inspecao de fronteira (inspecao-payload-agendamentos-ativos.ts) provou que
// `agendamentos_ativos` chega ao corpo HTTP byte a byte identico ao payload
// interno -- nao ha bug de transporte. Mas revelou outra coisa: para
// "a limpeza", a IA devolveu o UUID CORRETO do agendamento dentro do campo
// ERRADO (`procedimento_id`), e nao em `agendamento_id`.
//
// Este runner caracteriza esse modo de falha: para cada rodada, mostra
// `alteracoes` INTEIRO -- nao so `agendamento_id` --, para separar tres
// hipoteses que os runners anteriores nao distinguiam:
//
//   (a) a IA nao entendeu a qual agendamento o paciente se referia;
//   (b) a IA entendeu e escreveu no campo certo;
//   (c) a IA ENTENDEU e escreveu no campo ERRADO.
//
// Os runners anteriores so olhavam `alteracoes.agendamento_id`, entao (a) e
// (c) apareciam identicos -- ambos como "AUSENTE". Essa e a mesma classe de
// erro que o principio do teste isolado (docs/00-principios.md) existe para
// impedir: uma medicao confiante sobre algo que ela nao tinha como distinguir.
//
// NENHUMA CORRECAO E PROPOSTA AQUI. So dados.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/diagnostico-campo-de-destino.ts

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

interface Rodada {
  rotulo: string;
  mensagem: string;
  idAlvo: string;
  idDistrator: string;
  agendamentosAtivos: { agendamento_id: string; descricao: string }[];
}

function montar(rotulo: string, mensagem: string, descricaoAlvo: string, descricaoDistrator: string, alvoPrimeiro: boolean): Rodada {
  const idAlvo = crypto.randomUUID();
  const idDistrator = crypto.randomUUID();
  const alvo = { agendamento_id: idAlvo, descricao: descricaoAlvo };
  const distrator = { agendamento_id: idDistrator, descricao: descricaoDistrator };
  return {
    rotulo,
    mensagem,
    idAlvo,
    idDistrator,
    agendamentosAtivos: alvoPrimeiro ? [alvo, distrator] : [distrator, alvo],
  };
}

const LIMPEZA = 'Limpeza dental com Dra. Ana Souza em 14/08 às 14:00';
const CONSULTA = 'Consulta / Avaliação com Dr. Bruno Lima em 21/08 às 09:00';

const RODADAS: readonly Rodada[] = Object.freeze([
  // Por PROCEDIMENTO -- a categoria que falhou na medicao anterior.
  montar('procedimento / alvo na posicao 1', 'a limpeza', LIMPEZA, CONSULTA, true),
  montar('procedimento / alvo na posicao 2', 'a limpeza', LIMPEZA, CONSULTA, false),
  montar('procedimento (canal) / posicao 1', 'o canal', 'Tratamento de canal com Dra. Ana Souza em 14/08 às 14:00', CONSULTA, true),
  montar('procedimento (canal) / posicao 2', 'o canal', 'Tratamento de canal com Dra. Ana Souza em 14/08 às 14:00', CONSULTA, false),
  // Categorias que JA funcionavam -- controle, para ver se elas tambem
  // escrevem no campo errado ou se o problema e exclusivo de procedimento.
  montar('ordinal / alvo na posicao 1', 'o primeiro', LIMPEZA, CONSULTA, true),
  montar('ordinal / alvo na posicao 2', 'o segundo', CONSULTA, LIMPEZA, false),
  montar('dentista / alvo na posicao 1', 'o da Dra Ana', LIMPEZA, CONSULTA, true),
  montar('data / alvo na posicao 1', 'o de 14/08', LIMPEZA, CONSULTA, true),
]);

function classificar(alteracoes: Record<string, { acao: string; valor?: string } | undefined>, rodada: Rodada): string {
  const agendamentoId = alteracoes.agendamento_id?.valor;
  const procedimentoId = alteracoes.procedimento_id?.valor;

  if (agendamentoId === rodada.idAlvo) return 'CORRETO (agendamento_id = alvo)';
  if (agendamentoId === rodada.idDistrator) return 'ERRADO (agendamento_id = distrator)';
  if (agendamentoId !== undefined) return 'ALUCINADO (agendamento_id desconhecido)';

  // agendamento_id ausente -- mas para ONDE foi a resposta?
  if (procedimentoId === rodada.idAlvo) return 'CAMPO ERRADO (UUID do alvo em procedimento_id)';
  if (procedimentoId === rodada.idDistrator) return 'CAMPO ERRADO + ALVO ERRADO (UUID do distrator em procedimento_id)';
  if (procedimentoId !== undefined) return `CAMPO ERRADO (texto cru em procedimento_id: "${procedimentoId}")`;

  return 'OMITIU (nada emitido)';
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- diagnostico: para QUAL CAMPO a IA escreve a escolha do agendamento ---');
  console.log('NENHUMA CORRECAO proposta -- so dados.');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log(`rodadas: ${RODADAS.length}`);
  console.log('');

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const contagem = new Map<string, number>();

  for (const rodada of RODADAS) {
    const entrada = construirEntradaMinimizada(
      [rodada.mensagem],
      APOS_INTENCAO,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      rodada.agendamentosAtivos
    );

    const saida = await extrairAlteracoes(cliente, entrada);
    const alteracoes = saida.alteracoes as Record<string, { acao: string; valor?: string } | undefined>;
    const veredito = classificar(alteracoes, rodada);
    const chave = veredito.split(' (')[0]!;
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);

    console.log(`${rodada.rotulo} -- "${rodada.mensagem}"`);
    console.log(`  veredito: ${veredito}`);
    console.log(`  alteracoes COMPLETO: ${JSON.stringify(alteracoes)}`);
    console.log('');
  }

  console.log('--- resumo por modo de falha ---');
  for (const [modo, quantidade] of [...contagem].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${modo}: ${quantidade}/${RODADAS.length}`);
  }
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal: ${mensagem}`);
  process.exitCode = 1;
});
