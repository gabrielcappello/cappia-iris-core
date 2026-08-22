// Runner ISOLADO, avulso, chamado manualmente: prova que a cadeia completa
// (IA extrai o texto exatamente como o paciente escreveu -> Core reconhece o
// dia da semana mesmo com erro de digitacao) funciona ponta a ponta.
//
// Motivacao (achado real via WhatsApp, 2026-08-22, Cleardent): o paciente
// escreveu "segunda feria" (letras trocadas). A IA preservou o texto
// literalmente (correto, por instrucao deliberada -- nunca corrige o
// paciente), mas `montarFatosTemporais` so reconhecia o sufixo "feira"
// exato -- "feria" nao casava, o Core concluiu "nenhuma data foi dita", e a
// Iris perguntou "para qual data? pode ser hoje, amanha..." para um
// paciente que tinha acabado de dizer a data claramente. Corrigido em
// montar-fatos-temporais.ts (semSufixoFeira aceita variacoes comuns dessa
// troca de letras).
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-dia-semana-com-erro-digitacao.ts

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
import { montarFatosTemporais } from '../core/montar-fatos-temporais.ts';

interface Caso {
  titulo: string;
  mensagem: string;
  diaEsperado: string;
}

const CASOS: readonly Caso[] = Object.freeze([
  {
    titulo: 'REAL (WhatsApp 2026-08-22): "quero um agendamento para segunda feria"',
    mensagem: 'quero um agendamento para segunda feria',
    diaEsperado: 'segunda',
  },
  { titulo: 'erro similar, outro dia: "sexta feria"', mensagem: 'pode ser sexta feria de manha', diaEsperado: 'sexta' },
  {
    titulo: 'REAL (exemplo do Gabriel, deformado, tudo junto): "qintafeaa"',
    mensagem: 'quero um turno para qintafeaa pra avaliação',
    diaEsperado: 'quinta',
  },
  { titulo: 'erro no "s" trocado por "c": "sabao" (quis dizer sabado)', mensagem: 'pode ser sabao de manha?', diaEsperado: 'sabado' },
  { titulo: 'sem espaco, junto: "tercafeira"', mensagem: 'quero marcar para tercafeira', diaEsperado: 'terca' },
]);

interface ResultadoCaso {
  titulo: string;
  dataTextoExtraido: string | undefined;
  atomoReconhecido: boolean;
  diaBate: boolean;
  erro: string | null;
  duracao_ms: number;
}

async function executarCaso(cliente: ReturnType<typeof criarClienteModeloOpenAI>, caso: Caso): Promise<ResultadoCaso> {
  const inicio = Date.now();
  try {
    const entrada = construirEntradaMinimizada([caso.mensagem], {}, undefined, undefined, undefined, undefined);
    const saida = await extrairAlteracoes(cliente, entrada);
    const dataTexto = saida.alteracoes.data_texto?.valor;
    const atomos = montarFatosTemporais({ data_texto: dataTexto });
    const atomoDiaSemana = atomos.find((a) => a.tipo === 'dia_semana');
    const diaBate = atomoDiaSemana !== undefined && atomoDiaSemana.tipo === 'dia_semana' && atomoDiaSemana.dia === caso.diaEsperado;

    return {
      titulo: caso.titulo,
      dataTextoExtraido: dataTexto,
      atomoReconhecido: atomoDiaSemana !== undefined,
      diaBate,
      erro: null,
      duracao_ms: Date.now() - inicio,
    };
  } catch (erro) {
    const codigo =
      erro instanceof ErroClienteModeloOpenAI
        ? `${erro.categoria}/${erro.codigo}`
        : erro instanceof InterpretacaoInvalidaError
          ? erro.codigo
          : erro instanceof EntradaInvalidaError
            ? erro.campo
            : 'erro_nao_classificado';
    return { titulo: caso.titulo, dataTextoExtraido: undefined, atomoReconhecido: false, diaBate: false, erro: codigo, duracao_ms: Date.now() - inicio };
  }
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: dia da semana com erro de digitacao (ponta a ponta: IA + Core) ---');
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

    console.log(caso.titulo);
    console.log(`  mensagem: ${JSON.stringify(caso.mensagem)}`);
    console.log(`  data_texto extraido pela IA: ${JSON.stringify(resultado.dataTextoExtraido)}`);
    console.log(`  atomo de dia_semana reconhecido pelo Core: ${resultado.atomoReconhecido}`);
    console.log(`  dia bate com o esperado (${caso.diaEsperado}): ${resultado.diaBate}`);
    if (resultado.erro) console.log(`  erro: ${resultado.erro}`);
    console.log(`  duracao: ${resultado.duracao_ms}ms`);
    console.log('');
  }

  const passou = resultados.filter((r) => r.diaBate).length;
  console.log('--- resumo ---');
  console.log(`${passou}/${CASOS.length}`);
  if (passou !== CASOS.length) {
    console.log('');
    console.log('falharam:');
    for (const r of resultados.filter((x) => !x.diaBate)) {
      console.log(`  - ${r.titulo} -> data_texto=${JSON.stringify(r.dataTextoExtraido)}`);
    }
  }

  process.exitCode = passou === CASOS.length ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
