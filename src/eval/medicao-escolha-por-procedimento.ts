// Runner ISOLADO, avulso, chamado manualmente: MEDICAO, nao implementacao.
// Investiga um achado do runner de producao (teste-real-escolha-agendamento.ts,
// 2026-08-11): a frase "a limpeza" falhou 3/3 em resolver `agendamento_id`
// contra o CONTRATO ATUAL (extrator de producao completo, nao uma versao
// isolada) -- mesmo sendo o UNICO item da lista com aquele procedimento.
//
// Pergunta que este runner responde: e um problema especifico de "a limpeza",
// de um subconjunto de procedimentos, ou de QUALQUER escolha feita so pelo
// nome do procedimento?
//
// Desenho: 8 procedimentos (os pedidos), cada um medido em DUAS posicoes na
// lista (primeiro e segundo item) contra um distrator fixo -- separa efeito
// de NOME do efeito de POSICAO. 16 chamadas ao todo. Usa
// construirEntradaMinimizada + extrairAlteracoes -- o EXTRATOR DE PRODUCAO,
// as mesmas instrucoes e schema que o paciente real usa hoje, nunca uma
// reimplementacao isolada do contrato (essa e a causa provavel do achado:
// o runner de medicao original, com um prompt isolado, deu 11/11 na mesma
// frase).
//
// NENHUMA CORRECAO E PROPOSTA AQUI. So dados.
//
// Mensagens: curtas e naturais, como um paciente realmente responderia a
// "qual desses dois voce quer remarcar?".
//
// Chave: somente via variavel de ambiente OPENAI_API_KEY (cofre canonico,
// .iris-secrets/openai.env), carregada exclusivamente por `node --env-file`.
// Este arquivo nunca abre, le, imprime ou edita nada dentro de .iris-secrets.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-escolha-por-procedimento.ts

import {
  criarClienteModeloOpenAI,
  ErroClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { construirEntradaMinimizada, extrairAlteracoes } from '../core/interpretacao-extrator.ts';
import { InterpretacaoInvalidaError, EntradaInvalidaError } from '../core/erros.ts';
import type { SnapshotOficialConversa } from '../core/interpretacao-tipos.ts';

const APOS_INTENCAO: SnapshotOficialConversa = { intencao: 'remarcacao' };

interface ItemAgendamento {
  agendamento_id: string;
  descricao: string;
}

interface CasoProcedimento {
  procedimento: string;
  mensagem: string;
  /** Distrator fixo -- so o procedimento muda de caso para caso, nunca o distrator. */
  distratorDescricao: string;
}

// Um distrator neutro por linha, so trocando quando o proprio alvo E a
// consulta (senao o distrator seria identico ao alvo).
const DISTRATOR_PADRAO = 'Consulta / Avaliação com Dr. Bruno Lima em 21/08 às 09:00';
const DISTRATOR_PARA_CONSULTA = 'Limpeza dental com Dra. Ana Souza em 21/08 às 09:00';

const CASOS: readonly CasoProcedimento[] = Object.freeze([
  { procedimento: 'Limpeza dental', mensagem: 'a limpeza', distratorDescricao: DISTRATOR_PADRAO },
  { procedimento: 'Implante dentário', mensagem: 'o implante', distratorDescricao: DISTRATOR_PADRAO },
  { procedimento: 'Tratamento de canal', mensagem: 'o canal', distratorDescricao: DISTRATOR_PADRAO },
  { procedimento: 'Restauração dentária', mensagem: 'a restauração', distratorDescricao: DISTRATOR_PADRAO },
  { procedimento: 'Clareamento dental', mensagem: 'o clareamento', distratorDescricao: DISTRATOR_PADRAO },
  { procedimento: 'Consulta / Avaliação', mensagem: 'a consulta', distratorDescricao: DISTRATOR_PARA_CONSULTA },
  { procedimento: 'Manutenção de aparelho ortodôntico', mensagem: 'o aparelho', distratorDescricao: DISTRATOR_PADRAO },
  { procedimento: 'Extração de dente', mensagem: 'a extração', distratorDescricao: DISTRATOR_PADRAO },
]);

interface Rodada {
  procedimento: string;
  mensagem: string;
  posicaoAlvo: 1 | 2;
  agendamentosAtivos: ItemAgendamento[];
  idAlvo: string;
  idDistrator: string;
}

function montarRodadas(): Rodada[] {
  const rodadas: Rodada[] = [];
  for (const caso of CASOS) {
    const idAlvo = crypto.randomUUID();
    const idDistrator = crypto.randomUUID();
    const descricaoAlvo = `${caso.procedimento} com Dra. Ana Souza em 14/08 às 14:00`;

    for (const posicaoAlvo of [1, 2] as const) {
      const alvo: ItemAgendamento = { agendamento_id: idAlvo, descricao: descricaoAlvo };
      const distrator: ItemAgendamento = { agendamento_id: idDistrator, descricao: caso.distratorDescricao };
      rodadas.push({
        procedimento: caso.procedimento,
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

interface ResultadoRodada {
  rodada: Rodada;
  sucesso: boolean;
  agendamentoIdObtido: string | undefined;
  acertou: boolean;
  erro: { tipo: string; codigo: string | null } | null;
  duracao_ms: number;
}

async function executarRodada(cliente: ReturnType<typeof criarClienteModeloOpenAI>, rodada: Rodada): Promise<ResultadoRodada> {
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

  const inicio = Date.now();
  try {
    const saida = await extrairAlteracoes(cliente, entrada);
    const agendamentoIdObtido = saida.alteracoes.agendamento_id?.valor;
    return {
      rodada,
      sucesso: true,
      agendamentoIdObtido,
      acertou: agendamentoIdObtido === rodada.idAlvo,
      erro: null,
      duracao_ms: Date.now() - inicio,
    };
  } catch (erro) {
    const duracao_ms = Date.now() - inicio;
    const classificado =
      erro instanceof ErroClienteModeloOpenAI
        ? { tipo: 'ErroClienteModeloOpenAI', codigo: `${erro.categoria}/${erro.codigo}` }
        : erro instanceof InterpretacaoInvalidaError
          ? { tipo: 'InterpretacaoInvalidaError', codigo: erro.codigo }
          : erro instanceof EntradaInvalidaError
            ? { tipo: 'EntradaInvalidaError', codigo: erro.campo }
            : { tipo: 'erro_nao_classificado', codigo: null };
    return { rodada, sucesso: false, agendamentoIdObtido: undefined, acertou: false, erro: classificado, duracao_ms };
  }
}

function classificarResultado(id: string | undefined, rodada: Rodada): string {
  if (id === undefined) return 'AUSENTE (omitiu)';
  if (id === rodada.idAlvo) return 'ALVO (correto)';
  if (id === rodada.idDistrator) return 'DISTRATOR (errado)';
  return 'ID DESCONHECIDO (alucinado)';
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  const rodadas = montarRodadas();

  console.log('--- medicao: escolha de agendamento SO pelo nome do procedimento ---');
  console.log('NENHUMA CORRECAO proposta -- so medicao contra o contrato de producao atual.');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log(`total de rodadas: ${rodadas.length} (8 procedimentos x 2 posicoes)`);
  console.log('');

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const resultados: ResultadoRodada[] = [];
  for (const rodada of rodadas) {
    const resultado = await executarRodada(cliente, rodada);
    resultados.push(resultado);

    console.log(`${rodada.procedimento} (posição ${rodada.posicaoAlvo}/2) -- "${rodada.mensagem}"`);
    console.log(`  sucesso: ${resultado.sucesso}`);
    if (resultado.sucesso) {
      console.log(`  resultado: ${classificarResultado(resultado.agendamentoIdObtido, rodada)}`);
    } else if (resultado.erro) {
      console.log(`  erro: ${resultado.erro.tipo} codigo=${resultado.erro.codigo}`);
    }
    console.log(`  duracao: ${resultado.duracao_ms}ms`);
    console.log('');
  }

  // --- Agregacao por procedimento ---
  console.log('--- resumo por procedimento (das 2 posicoes) ---');
  const porProcedimento = new Map<string, ResultadoRodada[]>();
  for (const r of resultados) {
    const lista = porProcedimento.get(r.rodada.procedimento) ?? [];
    lista.push(r);
    porProcedimento.set(r.rodada.procedimento, lista);
  }
  let totalAcertos = 0;
  for (const [procedimento, lista] of porProcedimento) {
    const acertos = lista.filter((r) => r.acertou).length;
    totalAcertos += acertos;
    console.log(`  ${procedimento}: ${acertos}/${lista.length}`);
  }

  console.log('');
  console.log('--- resumo por posicao (dos 8 procedimentos) ---');
  for (const posicao of [1, 2] as const) {
    const doGrupo = resultados.filter((r) => r.rodada.posicaoAlvo === posicao);
    const acertos = doGrupo.filter((r) => r.acertou).length;
    console.log(`  posição ${posicao}: ${acertos}/${doGrupo.length}`);
  }

  console.log('');
  console.log('--- resultado geral ---');
  console.log(`${totalAcertos}/${resultados.length}`);

  process.exitCode = totalAcertos === resultados.length ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
