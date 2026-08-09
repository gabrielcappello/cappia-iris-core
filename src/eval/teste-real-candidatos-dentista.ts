// Runner ISOLADO, avulso: prova contra a OpenAI REAL que a interpretadora
// devolve o CONJUNTO de candidatos plausiveis -- e nunca escolhe entre eles.
//
// Contrato: specs/dentista-semantico-v1.md secao 12.
//
// SUBSTITUI `teste-real-dentista-semantico.ts`, apagado em 2026-08-09: aquele
// runner afirmava o contrato escalar (`alteracoes.dentista_id`), que a IA nao
// emite mais. Ele cobria correlacao por primeiro nome, sobrenome e nome
// completo -- tudo preservado aqui, agora sobre o conjunto. O caso instavel
// que ele carregava como limite conhecido ("Dra. Beatriz", ~2 em 5 execucoes
// aproximando para um dentista real) deixou de existir: com `[]` disponivel,
// o modelo tem como dizer "procurei e nao achei" -- 4 execucoes seguidas, 5/5.
//
// POR QUE UM CONJUNTO, E NAO UM ID: com um campo escalar (`dentista_id`), o
// modelo nao TINHA como expressar ambiguidade. Medido 3/3 em 2026-08-09:
// diante de dois candidatos ele devolvia "id-a,id-b" concatenado -- um valor
// malformado que o Core rejeitava, perdendo quem eram os candidatos. Este
// runner verifica que o canal novo resolve isso na origem.
//
// A IA NUNCA emite `dentista_id`: quem escreve esse campo e o Core, pela
// regra de contagem. Todos os casos abaixo verificam isso tambem.
//
// Cenario: os nomes vem da clinica real de teste (Dr. Carlos Turiak, Dra.
// Vanesa Vocaro) mais uma segunda "Vanessa" sintetica, para exercitar a
// ambiguidade humana real que o Gabriel descreveu. Os ids sao sinteticos de
// proposito -- o que se prova e a correlacao nome -> conjunto de ids.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-candidatos-dentista.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { construirEntradaMinimizada, extrairAlteracoes } from '../core/interpretacao-extrator.ts';

const CARLOS = 'dent-carlos-turiak';
const VANESSA_LAPA = 'dent-vanessa-lapa';
const VANESSA_GOMES = 'dent-vanessa-gomes';

const DENTISTAS = [
  { dentista_id: CARLOS, nome_exibido: 'Dr. Carlos Turiak' },
  { dentista_id: VANESSA_LAPA, nome_exibido: 'Dra. Vanessa Lapa' },
  { dentista_id: VANESSA_GOMES, nome_exibido: 'Dra. Vanessa Gomes' },
];

const PROCEDIMENTOS = [
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental (profilaxia)' },
];

interface Caso {
  titulo: string;
  mensagem: string;
  /** `null` = nao mencionou profissional. Senao, o CONJUNTO esperado (ordem ignorada). */
  esperado: string[] | null;
}

// Poucos e realistas -- os tres casos que o Gabriel descreveu, mais o
// controle de "nao mencionou".
const CASOS: readonly Caso[] = Object.freeze([
  {
    titulo: 'UM candidato claro: "quero com o Carlos"',
    mensagem: 'quero uma limpeza com o Carlos',
    esperado: [CARLOS],
  },
  {
    titulo: 'VARIOS plausiveis: "quero com a Vanessa" (duas Vanessas) -- nao escolher',
    mensagem: 'quero uma limpeza com a Vanessa',
    esperado: [VANESSA_LAPA, VANESSA_GOMES],
  },
  {
    titulo: 'DESAMBIGUADO pelo sobrenome: "com a Vanessa Lapa"',
    mensagem: 'quero uma limpeza com a Vanessa Lapa',
    esperado: [VANESSA_LAPA],
  },
  {
    titulo: 'NENHUM correspondente: "com a Dra. Beatriz" -- lista vazia, nunca aproximar',
    mensagem: 'quero uma limpeza com a Dra. Beatriz',
    esperado: [],
  },
  {
    titulo: 'NAO mencionou profissional: null, nunca lista vazia',
    mensagem: 'quero fazer uma limpeza',
    esperado: null,
  },
]);

function mesmosIds(obtido: string[] | null, esperado: string[] | null): boolean {
  if (esperado === null || obtido === null) return obtido === esperado;
  return obtido.length === esperado.length && [...obtido].sort().join('|') === [...esperado].sort().join('|');
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: dentistas_candidatos (conjunto, nao escalar) ---');
  console.log(`clinica: ${DENTISTAS.map((d) => d.nome_exibido).join(' | ')}`);
  console.log('');

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  let ok = 0;
  const falhas: string[] = [];
  for (const caso of CASOS) {
    const entrada = construirEntradaMinimizada([caso.mensagem], {}, undefined, undefined, undefined, PROCEDIMENTOS, DENTISTAS);
    const saida = await extrairAlteracoes(cliente, entrada);

    const obtido = saida.dentistas_candidatos;
    const conjuntoOk = mesmosIds(obtido, caso.esperado);
    // A IA nunca escreve `dentista_id` -- em NENHUM caso.
    const naoEmitiuId = saida.alteracoes.dentista_id === undefined;
    const bate = conjuntoOk && naoEmitiuId;
    if (bate) ok++;
    else falhas.push(`${caso.titulo} -> ${JSON.stringify(obtido)}${naoEmitiuId ? '' : '  [EMITIU dentista_id!]'}`);

    console.log(`${bate ? 'ok    ' : 'FALHOU'} ${caso.titulo}`);
    console.log(`  mensagem: ${JSON.stringify(caso.mensagem)}`);
    console.log(`  esperado: ${caso.esperado === null ? 'null' : JSON.stringify(caso.esperado)}`);
    console.log(`  obtido:   ${obtido === null ? 'null' : JSON.stringify(obtido)}`);
    console.log('');
  }

  console.log(`--- resumo --- ${ok}/${CASOS.length}`);
  if (falhas.length > 0) {
    console.log('');
    console.log('falharam:');
    for (const f of falhas) console.log(`  - ${f}`);
  }
  process.exitCode = ok === CASOS.length ? 0 : 1;
}

main().catch((erro) => {
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${erro instanceof Error ? erro.message : 'desconhecido'}`);
  process.exitCode = 1;
});
