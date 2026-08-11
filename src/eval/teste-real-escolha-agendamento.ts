// Runner ISOLADO, avulso, chamado manualmente: prova contra a OpenAI REAL
// que a IMPLEMENTACAO FINAL da escolha entre agendamentos ativos
// (specs/remarcacao-conversacional-v1.md secao 3) funciona -- usando o
// EXTRATOR DE PRODUCAO (construirEntradaMinimizada + extrairAlteracoes),
// nao uma reimplementacao paralela do contrato.
//
// Diferenca do runner de medicao anterior
// (src/eval/medicao-escolha-agendamento.ts, 2026-08-11, que decidiu o
// contrato comparando tres alternativas): aquele media QUAL contrato
// escolher; este prova que O CONTRATO JA IMPLEMENTADO continua funcionando
// -- schema, instrucoes e validacao exatamente como um paciente real
// exercitaria em producao.
//
// Mensagens: todas sinteticas e ficticias, seguindo o registro real de
// WhatsApp (docs/00-principios.md, principio dos testes realistas).
//
// Chave: somente via variavel de ambiente OPENAI_API_KEY (cofre canonico,
// .iris-secrets/openai.env), carregada exclusivamente por `node --env-file`.
// Este arquivo nunca abre, le, imprime ou edita nada dentro de .iris-secrets.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-escolha-agendamento.ts

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

const AG_1 = '11111111-1111-4111-8111-111111111111';
const AG_2 = '22222222-2222-4222-8222-222222222222';
const AG_3 = '33333333-3333-4333-8333-333333333333';

// Datas VERIFICADAS quanto ao dia da semana (2026-08-14 e 2026-08-21 sao
// sextas-feiras de fato) -- uma medicao anterior usou uma data que nao
// correspondia ao dia da semana citado na propria descricao, invalidando
// aquele caso especifico sem que ninguem tivesse percebido.
const LISTA_2 = [
  { agendamento_id: AG_1, descricao: 'Limpeza com Dra. Ana em 14/08 às 14:00' },
  { agendamento_id: AG_2, descricao: 'Canal com Dr. Bruno em 23/08 às 09:00' },
];
const LISTA_3 = [...LISTA_2, { agendamento_id: AG_3, descricao: 'Clareamento com Dra. Ana em 27/08 às 16:30' }];

// Snapshot ja com intencao=remarcacao -- a pergunta "qual deles" so existe
// depois de o Core ja ter identificado a intencao.
const APOS_INTENCAO: SnapshotOficialConversa = { intencao: 'remarcacao' };

interface Caso {
  titulo: string;
  mensagem: string;
  agendamentosAtivos: typeof LISTA_2;
  /** null = espera agendamento_id AUSENTE do resultado (duvida real). */
  esperado: string | null;
}

const CASOS: readonly Caso[] = Object.freeze([
  { titulo: 'ordinal "o segundo"', mensagem: 'o segundo', agendamentosAtivos: LISTA_2, esperado: AG_2 },
  { titulo: 'ordinal "o primeiro"', mensagem: 'o primeiro', agendamentosAtivos: LISTA_2, esperado: AG_1 },
  { titulo: 'por procedimento "a limpeza"', mensagem: 'a limpeza', agendamentosAtivos: LISTA_2, esperado: AG_1 },
  { titulo: 'por procedimento "o do canal"', mensagem: 'o do canal', agendamentosAtivos: LISTA_2, esperado: AG_2 },
  { titulo: 'por dia da semana "o da sexta"', mensagem: 'o da sexta', agendamentosAtivos: LISTA_2, esperado: AG_1 },
  { titulo: 'por data "o de 23/08"', mensagem: 'o de 23/08', agendamentosAtivos: LISTA_2, esperado: AG_2 },
  { titulo: 'por dentista "o do Dr Bruno"', mensagem: 'o do Dr Bruno', agendamentosAtivos: LISTA_2, esperado: AG_2 },
  { titulo: 'ordinal com 3 itens "o terceiro"', mensagem: 'o terceiro', agendamentosAtivos: LISTA_3, esperado: AG_3 },
  { titulo: 'por horario com 3 itens "o das 16:30"', mensagem: 'o das 16:30', agendamentosAtivos: LISTA_3, esperado: AG_3 },
  // --- Negativo: duvida real nunca escolhe por aproximacao ---
  { titulo: 'NEGATIVO: pergunta generica nao escolhe', mensagem: 'quais eu tenho marcado mesmo?', agendamentosAtivos: LISTA_2, esperado: null },
]);

interface ResultadoCaso {
  titulo: string;
  sucesso: boolean;
  agendamentoIdObtido: string | undefined;
  bateComEsperado: boolean;
  erro: { tipo: string; codigo: string | null } | null;
  duracao_ms: number;
}

async function executarCaso(cliente: ReturnType<typeof criarClienteModeloOpenAI>, caso: Caso): Promise<ResultadoCaso> {
  // Mesma chamada de producao: interpretar-e-aplicar.ts monta exatamente
  // assim quando ha escolha_agendamento_pendente (orquestrador.ts).
  const entrada = construirEntradaMinimizada(
    [caso.mensagem],
    APOS_INTENCAO,
    undefined, // horarios_oferecidos
    undefined, // proposta_pendente
    undefined, // historico_recente
    undefined, // procedimentos_disponiveis
    undefined, // dentistas_disponiveis
    undefined, // oferta_procedimento_pendente
    undefined, // cadastro_paciente
    undefined, // troca_telefone_pendente
    caso.agendamentosAtivos
  );

  const inicio = Date.now();
  try {
    const saida = await extrairAlteracoes(cliente, entrada);
    const agendamentoIdObtido = saida.alteracoes.agendamento_id?.valor;
    const bateComEsperado = caso.esperado === null ? agendamentoIdObtido === undefined : agendamentoIdObtido === caso.esperado;

    return { titulo: caso.titulo, sucesso: true, agendamentoIdObtido, bateComEsperado, erro: null, duracao_ms: Date.now() - inicio };
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
    return { titulo: caso.titulo, sucesso: false, agendamentoIdObtido: undefined, bateComEsperado: false, erro: classificado, duracao_ms };
  }
}

function rotulo(id: string | undefined | null): string {
  if (id === undefined || id === null) return '(ausente)';
  if (id === AG_1) return 'AG_1';
  if (id === AG_2) return 'AG_2';
  if (id === AG_3) return 'AG_3';
  return id.slice(0, 8);
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: escolha entre agendamentos ativos (implementacao final) ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log(`total de casos: ${CASOS.length}`);
  console.log('');

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const resultados: ResultadoCaso[] = [];
  for (const caso of CASOS) {
    const resultado = await executarCaso(cliente, caso);
    resultados.push(resultado);

    console.log(`[esperado: ${rotulo(caso.esperado)}] ${caso.titulo}`);
    console.log(`  mensagem: ${JSON.stringify(caso.mensagem)}`);
    console.log(`  sucesso: ${resultado.sucesso}`);
    if (resultado.sucesso) {
      console.log(`  agendamento_id obtido: ${rotulo(resultado.agendamentoIdObtido)}`);
      console.log(`  bate com esperado: ${resultado.bateComEsperado}`);
    } else if (resultado.erro) {
      console.log(`  erro: ${resultado.erro.tipo} codigo=${resultado.erro.codigo}`);
    }
    console.log(`  duracao: ${resultado.duracao_ms}ms`);
    console.log('');
  }

  const totalCorreto = resultados.filter((r) => r.sucesso && r.bateComEsperado).length;
  console.log('--- resumo ---');
  console.log(`${totalCorreto}/${CASOS.length}`);

  process.exitCode = totalCorreto === CASOS.length ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
