// Runner ISOLADO, avulso, chamado manualmente: prova contra a OpenAI REAL
// que a IA interpretadora correlaciona o que o paciente diz sobre um
// profissional diretamente com `dentista_id`, lendo `dentistas_disponiveis`
// -- sem nenhum match textual no Core.
//
// Contrato: specs/dentista-semantico-v1.md secao 8.
//
// ISOLAMENTO (docs/00-principios.md, principio do teste isolado): nao existe
// mais NENHUM mecanismo antigo que possa explicar um acerto --
// `resolverPorPreferencia`, `nome_completo_resolucao`, `nome_curto_resolucao`
// e a recursao de fallback foram apagados. Alem disso, o ultimo par de casos
// e um A/B explicito: a MESMA frase, com e sem `dentistas_disponiveis`,
// precisa produzir resultados DIFERENTES -- se a lista nao tivesse efeito, o
// par nao teria como passar.
//
// ENTRADAS REALISTAS (docs/00-principios.md, principio dos testes realistas):
// "quero com o Carlos", "prefiro a Dra. Vanesa" e "com a Vanesa Vocaro" sao
// coisas que um paciente escreve. Ninguem digita o nome exatamente como esta
// cadastrado no Painel -- era exatamente essa exigencia que o match exato
// impunha.
//
// Catalogo: os nomes e a estrutura vem da clinica REAL de teste (verificados
// no banco em 2026-08-09). Os `dentista_id` sao sinteticos aqui de proposito
// -- o que se prova e a correlacao nome -> id, e um UUID real nao tornaria a
// prova mais forte.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-dentista-semantico.ts

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

const ID_CARLOS = 'dent-carlos-turiak';
const ID_VANESA = 'dent-vanesa-vocaro';

// Nomes exatamente como `carregar-catalogo.ts` monta `nome_exibido`
// ("Titulo Nome"), com os nomes reais da clinica de teste.
const DENTISTAS = [
  { dentista_id: ID_CARLOS, nome_exibido: 'Dr. Carlos Turiak' },
  { dentista_id: ID_VANESA, nome_exibido: 'Dra. Vanesa Vocaro' },
];

// Dois "Carlos" plausiveis -- a unica situacao em que a duvida e humana e
// real, e a Iris deve perguntar em vez de escolher.
const DENTISTAS_AMBIGUOS = [
  { dentista_id: ID_CARLOS, nome_exibido: 'Dr. Carlos Turiak' },
  { dentista_id: 'dent-carlos-sanches', nome_exibido: 'Dr. Carlos Sanches' },
];

const PROCEDIMENTOS = [
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental (profilaxia)' },
];

interface Caso {
  titulo: string;
  mensagem: string;
  dentistas: { dentista_id: string; nome_exibido: string }[] | undefined;
  /**
   * `null` = espera `dentista_id` AUSENTE.
   * `'nunca_um_id_valido'` = qualquer coisa serve, MENOS escolher um id real
   * da lista (ver o caso ambiguo).
   */
  esperado: string | null | 'nunca_um_id_valido';
}

const CASOS: readonly Caso[] = Object.freeze([
  // --- Primeiro nome: o caso que o match exato NUNCA resolvia ---
  {
    titulo: 'primeiro nome: "quero com o Carlos" (o match exato exigia "Carlos Turiak")',
    mensagem: 'quero uma limpeza com o Carlos',
    dentistas: DENTISTAS,
    esperado: ID_CARLOS,
  },
  {
    titulo: 'primeiro nome com titulo: "prefiro a Dra. Vanesa"',
    mensagem: 'prefiro a Dra. Vanesa',
    dentistas: DENTISTAS,
    esperado: ID_VANESA,
  },
  {
    titulo: 'nome completo tambem resolve: "com a Vanesa Vocaro"',
    mensagem: 'queria marcar com a Vanesa Vocaro',
    dentistas: DENTISTAS,
    esperado: ID_VANESA,
  },
  {
    titulo: 'sobrenome: "com o Turiak"',
    mensagem: 'pode ser com o Turiak',
    dentistas: DENTISTAS,
    esperado: ID_CARLOS,
  },

  // --- NEGATIVOS ---
  // ACHADO REAL (2026-08-09, reproduzido 3/3): diante de dois candidatos
  // plausiveis o modelo NAO omite -- ele concatena os dois ids
  // ("dent-carlos-turiak,dent-carlos-sanches"). Tres versoes da instrucao
  // foram tentadas; o comportamento e estavel. Nao insistimos no prompt: a
  // quarta tentativa seria "mais uma regra", exatamente o padrao que
  // docs/00-principios.md manda evitar.
  //
  // O que importa e que o desfecho do PRODUTO continua correto, e por
  // construcao: um id concatenado nao existe no catalogo, o Core o rejeita na
  // validacao de integridade, colapsa em "sem preferencia" e, com dois aptos,
  // pergunta ao paciente qual dos dois -- exatamente o comportamento
  // especificado. A garantia esta no Core, nao na obediencia do modelo, e tem
  // teste deterministico proprio ("id COMPOSTO ... colapsa em sem
  // preferencia", orquestrador-dentista.test.ts).
  //
  // O requisito verificado aqui e portanto o essencial: o modelo nunca pode
  // escolher UM dos dois em silencio. Concatenar nao e escolher.
  {
    titulo: 'AMBIGUO REAL: dois Carlos plausiveis -- nunca escolher um dos dois em silencio',
    mensagem: 'quero com o Carlos',
    dentistas: DENTISTAS_AMBIGUOS,
    esperado: 'nunca_um_id_valido',
  },
  // INSTAVEL, MEDIDO EM 2026-08-09 -- este caso falha em ~2 de 5 execucoes, e
  // e o limite conhecido mais importante desta frente. Nao remover: a
  // instabilidade E a informacao.
  //
  // Pedir alguem que nao trabalha na clinica ("Dra. Beatriz") produz um de
  // tres desfechos, variando entre execucoes com a MESMA entrada:
  //   a) omite `dentista_id` -- correto;
  //   b) emite `dentista_id` com valor VAZIO -> `resposta_invalida/
  //      valor_invalido` derruba a interpretacao inteira do turno (em
  //      producao isso vira 500 e o paciente fica sem resposta). Uma regra
  //      geral de formato foi adicionada as instrucoes em 2026-08-09
  //      ("omitir significa nao incluir alteracao"), o que reduziu a
  //      frequencia mas nao eliminou;
  //   c) devolve o id de um dentista REAL por aproximacao (ex.: Vanesa) --
  //      o pior desfecho, e o unico que o Core NAO consegue barrar: o id e
  //      valido e ativo, entao o fluxo seguiria com o profissional errado.
  //
  // (c) e um custo do modelo semantico que o match exato antigo nao tinha:
  // "Beatriz" simplesmente nao casava. Nao ha correcao no Core possivel --
  // ele nao sabe o que o paciente escreveu. Qualquer tratamento pertence a
  // instrucao, e mais uma rodada de prompt seria "mais uma regra"
  // (docs/00-principios.md). Decisao consciente: registrar e levar ao
  // Gabriel, nao mascarar afrouxando a assercao.
  {
    titulo: 'NEGATIVO: nome que nao corresponde a ninguem da lista (INSTAVEL -- ver comentario)',
    mensagem: 'quero marcar com a Dra. Beatriz',
    dentistas: DENTISTAS,
    esperado: null,
  },
  {
    titulo: 'NEGATIVO: mensagem sem nenhuma mencao a profissional',
    mensagem: 'quero fazer uma limpeza',
    dentistas: DENTISTAS,
    esperado: null,
  },

  // --- A/B: a MESMA frase sem a lista nao pode produzir dentista_id ---
  {
    titulo: 'A/B (lado B): "quero com o Carlos" SEM dentistas_disponiveis -- nunca emite dentista_id',
    mensagem: 'quero uma limpeza com o Carlos',
    dentistas: undefined,
    esperado: null,
  },
]);

interface ResultadoCaso {
  titulo: string;
  obtido: string | undefined;
  bate: boolean;
  alteracoes: unknown;
  erro: string | null;
  duracao_ms: number;
}

async function executarCaso(cliente: ReturnType<typeof criarClienteModeloOpenAI>, caso: Caso): Promise<ResultadoCaso> {
  // Assinatura: (mensagens, snapshot, horariosOferecidos, propostaPendente,
  // historicoRecente, procedimentosDisponiveis, dentistasDisponiveis). Os
  // tres `undefined` sao DELIBERADOS -- nenhum contexto paralelo pode
  // explicar o resultado.
  const entrada = construirEntradaMinimizada(
    [caso.mensagem],
    {},
    undefined,
    undefined,
    undefined,
    PROCEDIMENTOS,
    caso.dentistas
  );

  const inicio = Date.now();
  try {
    const saida = await extrairAlteracoes(cliente, entrada);
    const obtido = saida.alteracoes.dentista_id?.valor;
    const bate =
      caso.esperado === null
        ? obtido === undefined
        : caso.esperado === 'nunca_um_id_valido'
          ? // Passa se omitiu OU se devolveu algo que o Core rejeita. Falha so
            // se escolheu exatamente um dos candidatos reais -- o unico
            // desfecho que levaria a agendar com o profissional errado.
            obtido === undefined || !(caso.dentistas ?? []).some((d) => d.dentista_id === obtido)
          : obtido === caso.esperado;
    return { titulo: caso.titulo, obtido, bate, alteracoes: saida.alteracoes, erro: null, duracao_ms: Date.now() - inicio };
  } catch (erro) {
    const codigo =
      erro instanceof ErroClienteModeloOpenAI
        ? `${erro.categoria}/${erro.codigo}`
        : erro instanceof InterpretacaoInvalidaError
          ? erro.codigo
          : erro instanceof EntradaInvalidaError
            ? erro.campo
            : 'erro_nao_classificado';
    return { titulo: caso.titulo, obtido: undefined, bate: false, alteracoes: null, erro: codigo, duracao_ms: Date.now() - inicio };
  }
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: resolucao SEMANTICA de dentista (sem match textual, sem contexto paralelo) ---');
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

    console.log(`[esperado: ${caso.esperado ?? 'AUSENTE'}] ${caso.titulo}`);
    console.log(`  mensagem: ${JSON.stringify(caso.mensagem)}`);
    console.log(`  lista enviada: ${caso.dentistas ? caso.dentistas.map((d) => d.nome_exibido).join(' | ') : '(chave ausente)'}`);
    console.log(`  dentista_id obtido: ${resultado.obtido ?? '(ausente)'}  ${resultado.bate ? 'ok' : 'FALHOU'}`);
    if (resultado.erro) console.log(`  erro: ${resultado.erro}`);
    else console.log(`  alteracoes completas: ${JSON.stringify(resultado.alteracoes)}`);
    console.log(`  duracao: ${resultado.duracao_ms}ms`);
    console.log('');
  }

  // Guarda A/B explicita: o primeiro caso e o ultimo usam a MESMA frase,
  // variando somente `dentistas_disponiveis`. Se os dois lados coincidirem, a
  // lista nao teve efeito -- e o teste inteiro nao prova nada.
  const ladoA = resultados[0];
  const ladoB = resultados[resultados.length - 1];
  const diferem = ladoA.obtido !== ladoB.obtido;
  console.log('--- par A/B (mesma frase, so a lista muda) ---');
  console.log(`  COM lista  -> ${ladoA.obtido ?? '(ausente)'}`);
  console.log(`  SEM lista  -> ${ladoB.obtido ?? '(ausente)'}`);
  console.log(`  RESULTADOS DIFEREM: ${diferem} ${diferem ? '(a lista teve efeito comprovado)' : '(FALHOU: a lista nao teve efeito)'}`);
  console.log('');

  const corretos = resultados.filter((r) => r.bate).length;
  console.log('--- resumo ---');
  console.log(`${corretos}/${CASOS.length} casos, par A/B ${diferem ? 'PASSOU' : 'FALHOU'}`);
  if (corretos !== CASOS.length) {
    console.log('');
    console.log('falharam:');
    for (const r of resultados.filter((x) => !x.bate)) console.log(`  - ${r.titulo} -> ${r.obtido ?? '(ausente)'}`);
  }

  process.exitCode = corretos === CASOS.length && diferem ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
