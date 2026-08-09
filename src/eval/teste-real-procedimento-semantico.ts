// Runner ISOLADO, avulso, chamado manualmente: prova contra a OpenAI REAL
// que a IA interpretadora resolve o pedido do paciente diretamente para
// `procedimento_id` canonico, lendo o catalogo ativo da clinica -- sem
// nenhum alias, sinonimo ou correspondencia textual no Core.
//
// Contrato: specs/procedimento-semantico-v1.md secao 11.
//
// ISOLAMENTO (docs/00-principios.md, principio do teste isolado): nao existe
// mais NENHUM mecanismo antigo que possa explicar um acerto -- `resolver-
// procedimento.ts`, `SINONIMOS_INFORMAIS` e a maquinaria de aliases foram
// apagados. Se `procedimento_id` sair correto aqui, so pode ter vindo da
// compreensao semantica do modelo sobre `procedimentos_disponiveis`.
// Nenhum caso usa `proposta_pendente`, `horarios_oferecidos` ou historico.
//
// ENTRADAS REALISTAS (docs/00-principios.md, principio dos testes realistas):
// todas as mensagens abaixo sao coisas que um paciente escreveria. Duas vem
// LITERALMENTE de conversa real no WhatsApp (2026-08-07): "Avaliação né" e
// "Uma consulta normal para o dentista desidir" -- inclusive com o erro de
// digitacao original, porque foi assim que a pessoa escreveu.
//
// Catalogo: os ids e nomes sao os REAIS de `procedimentos_catalogo`
// (verificados no banco em 2026-08-08), nao inventados.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-procedimento-semantico.ts

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

// Recorte do catalogo real da clinica de teste (ids exatos de
// procedimentos_catalogo). "Consulta / Avaliação" e o unico nome cadastrado
// para consultation_evaluation -- e exatamente por isso que o match textual
// antigo nunca funcionava para quem diz so "avaliação".
const CATALOGO = [
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental (profilaxia)' },
  { procedimento_id: 'simple_extraction', nome_pt: 'Extração simples' },
  { procedimento_id: 'whitening', nome_pt: 'Clareamento em consultório' },
  { procedimento_id: 'canal_molar', nome_pt: 'Canal molar (3+ raízes)' },
  { procedimento_id: 'dental_xray', nome_pt: 'Radiografia' },
];

interface Caso {
  titulo: string;
  mensagem: string;
  /** `null` = espera `procedimento_id` AUSENTE (a IA nao deve escolher por aproximacao). */
  esperado: string | null;
}

const CASOS: readonly Caso[] = Object.freeze([
  // --- O caso que motivou a spec: conversa REAL do WhatsApp ---
  {
    titulo: 'REAL (WhatsApp 2026-08-07): "Avaliação né" -- travava a conversa antes',
    mensagem: 'Avaliação né',
    esperado: 'consultation_evaluation',
  },
  {
    titulo: 'REAL (WhatsApp 2026-08-07): "Uma consulta normal para o dentista desidir"',
    mensagem: 'Uma consulta normal para o dentista desidir',
    esperado: 'consultation_evaluation',
  },

  // --- Paciente que nao sabe o que precisa: sem fallback, sem flag, sem lista ---
  { titulo: '"não sei o que preciso"', mensagem: 'não sei o que preciso', esperado: 'consultation_evaluation' },
  {
    titulo: '"quero que o dentista dê uma olhada"',
    mensagem: 'quero que o dentista dê uma olhada',
    esperado: 'consultation_evaluation',
  },
  { titulo: '"o dentista que decida"', mensagem: 'prefiro que o dentista decida o que fazer', esperado: 'consultation_evaluation' },

  // --- Nao regride o que ja funcionava por sinonimo manual ---
  { titulo: 'nao regride: "quero limpeza" (antes dependia de SINONIMOS_INFORMAIS)', mensagem: 'quero fazer uma limpeza', esperado: 'cleaning' },
  { titulo: 'linguagem natural: "preciso arrancar um dente"', mensagem: 'preciso arrancar um dente', esperado: 'simple_extraction' },
  { titulo: 'linguagem natural: "queria deixar os dentes mais brancos"', mensagem: 'queria deixar os dentes mais brancos', esperado: 'whitening' },
  { titulo: 'linguagem natural: "acho que preciso de um canal"', mensagem: 'acho que preciso de um canal no dente do fundo', esperado: 'canal_molar' },

  // --- NEGATIVOS: nunca escolher por aproximacao ---
  {
    titulo: 'NEGATIVO: procedimento que NAO existe no catalogo desta clinica',
    mensagem: 'vocês fazem aparelho ortodôntico?',
    esperado: null,
  },
  {
    titulo: 'NEGATIVO: mensagem sem nenhum pedido de procedimento',
    mensagem: 'bom dia, tudo bem?',
    esperado: null,
  },
]);

interface ResultadoCaso {
  titulo: string;
  obtido: string | undefined;
  bate: boolean;
  natureza: string | undefined;
  alteracoes: unknown;
  erro: string | null;
  duracao_ms: number;
}

async function executarCaso(cliente: ReturnType<typeof criarClienteModeloOpenAI>, caso: Caso): Promise<ResultadoCaso> {
  // Assinatura: (mensagens, snapshot, horariosOferecidos, propostaPendente,
  // historicoRecente, procedimentosDisponiveis). Os tres `undefined` sao
  // DELIBERADOS -- nenhum contexto paralelo pode explicar o resultado.
  const entrada = construirEntradaMinimizada([caso.mensagem], {}, undefined, undefined, undefined, CATALOGO);

  const inicio = Date.now();
  try {
    const saida = await extrairAlteracoes(cliente, entrada);
    const obtido = saida.alteracoes.procedimento_id?.valor;
    const bate = caso.esperado === null ? obtido === undefined : obtido === caso.esperado;
    return {
      titulo: caso.titulo,
      obtido,
      bate,
      natureza: saida.natureza_mensagem,
      alteracoes: saida.alteracoes,
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
    return { titulo: caso.titulo, obtido: undefined, bate: false, natureza: undefined, alteracoes: null, erro: codigo, duracao_ms: Date.now() - inicio };
  }
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: resolucao SEMANTICA de procedimento (sem aliases, sem contexto paralelo) ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log(`catalogo ativo enviado: ${CATALOGO.map((p) => p.procedimento_id).join(', ')}`);
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
    console.log(`  procedimento_id obtido: ${resultado.obtido ?? '(ausente)'}  ${resultado.bate ? 'ok' : 'FALHOU'}`);
    if (resultado.erro) console.log(`  erro: ${resultado.erro}`);
    else console.log(`  alteracoes completas: ${JSON.stringify(resultado.alteracoes)} | natureza: ${resultado.natureza}`);
    console.log(`  duracao: ${resultado.duracao_ms}ms`);
    console.log('');
  }

  const corretos = resultados.filter((r) => r.bate).length;
  console.log('--- resumo ---');
  console.log(`${corretos}/${CASOS.length}`);
  if (corretos !== CASOS.length) {
    console.log('');
    console.log('falharam:');
    for (const r of resultados.filter((x) => !x.bate)) console.log(`  - ${r.titulo} -> ${r.obtido ?? '(ausente)'}`);
  }

  process.exitCode = corretos === CASOS.length ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
