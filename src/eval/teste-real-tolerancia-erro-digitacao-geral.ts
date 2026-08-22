// Runner ISOLADO, avulso, chamado manualmente: prova que a IA interpretadora
// tolera erro de digitacao de forma GERAL -- em qualquer campo de texto, nao
// so em data (dia da semana) -- pela REGRA UNICA em interpretacao-
// instrucoes.ts (2026-08-22, pedido do Gabriel: "uma so regra... para que
// funcione para todos", nunca remendo campo por campo).
//
// Cada caso testa um campo DIFERENTE, com erro de digitacao real e plausivel,
// provando que a tolerancia nao esta amarrada a nenhum campo especifico.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-tolerancia-erro-digitacao-geral.ts

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

const CATALOGO = [
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental (profilaxia)' },
  { procedimento_id: 'simple_extraction', nome_pt: 'Extração simples' },
  { procedimento_id: 'whitening', nome_pt: 'Clareamento em consultório' },
];

interface Caso {
  titulo: string;
  campo: 'procedimento_id' | 'data_texto' | 'nome' | 'email';
  mensagem: string;
  esperado: string;
  usaCatalogo?: boolean;
}

const CASOS: readonly Caso[] = Object.freeze([
  {
    titulo: 'procedimento: "quero fazer uma lipeza" (letra faltando)',
    campo: 'procedimento_id',
    mensagem: 'quero fazer uma lipeza nos dentes',
    esperado: 'cleaning',
    usaCatalogo: true,
  },
  {
    titulo: 'procedimento: "quero um clareamente" (erro comum, quis dizer clareamento)',
    campo: 'procedimento_id',
    mensagem: 'quero fazer um clareamente dos dentes',
    esperado: 'whitening',
    usaCatalogo: true,
  },
  {
    titulo: 'dia da semana: "qintafeaa" (deformado, tudo junto)',
    campo: 'data_texto',
    mensagem: 'quero um turno para qintafeaa pra avaliação',
    esperado: 'quinta-feira',
  },
  {
    // NEGATIVO deliberado: nome e dado de IDENTIDADE, nunca vocabulario
    // fechado -- "Gabirel" pode ser o nome real do paciente. A tolerancia a
    // erro de digitacao NAO pode "corrigir" identidade, sob risco de gravar
    // um nome que a pessoa nunca disse.
    titulo: 'NEGATIVO: nome "Gabirel" NAO deve virar "Gabriel" -- identidade nunca e corrigida',
    campo: 'nome',
    mensagem: 'meu nome e Gabirel Capelo',
    esperado: 'Gabirel Capelo',
  },
]);

interface ResultadoCaso {
  titulo: string;
  campo: string;
  obtido: string | undefined;
  bate: boolean;
  erro: string | null;
  duracao_ms: number;
}

async function executarCaso(cliente: ReturnType<typeof criarClienteModeloOpenAI>, caso: Caso): Promise<ResultadoCaso> {
  const inicio = Date.now();
  try {
    const catalogo = caso.usaCatalogo ? CATALOGO : undefined;
    const entrada = construirEntradaMinimizada([caso.mensagem], {}, undefined, undefined, undefined, catalogo);
    const saida = await extrairAlteracoes(cliente, entrada);
    const obtido = saida.alteracoes[caso.campo]?.valor;
    const bate = obtido === caso.esperado;
    return { titulo: caso.titulo, campo: caso.campo, obtido, bate, erro: null, duracao_ms: Date.now() - inicio };
  } catch (erro) {
    const codigo =
      erro instanceof ErroClienteModeloOpenAI
        ? `${erro.categoria}/${erro.codigo}`
        : erro instanceof InterpretacaoInvalidaError
          ? erro.codigo
          : erro instanceof EntradaInvalidaError
            ? erro.campo
            : 'erro_nao_classificado';
    return { titulo: caso.titulo, campo: caso.campo, obtido: undefined, bate: false, erro: codigo, duracao_ms: Date.now() - inicio };
  }
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: tolerancia a erro de digitacao, REGRA GERAL (varios campos) ---');
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

    console.log(`[campo: ${caso.campo}] ${caso.titulo}`);
    console.log(`  mensagem: ${JSON.stringify(caso.mensagem)}`);
    console.log(`  esperado: ${JSON.stringify(caso.esperado)}  obtido: ${JSON.stringify(resultado.obtido)}  ${resultado.bate ? 'ok' : 'FALHOU'}`);
    if (resultado.erro) console.log(`  erro: ${resultado.erro}`);
    console.log(`  duracao: ${resultado.duracao_ms}ms`);
    console.log('');
  }

  const corretos = resultados.filter((r) => r.bate).length;
  console.log('--- resumo ---');
  console.log(`${corretos}/${CASOS.length}`);
  if (corretos !== CASOS.length) {
    console.log('');
    console.log('falharam:');
    for (const r of resultados.filter((x) => !x.bate)) console.log(`  - [${r.campo}] ${r.titulo} -> ${r.obtido ?? '(ausente)'}`);
  }

  process.exitCode = corretos === CASOS.length ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
