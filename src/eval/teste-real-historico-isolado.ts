// Runner ISOLADO, avulso, chamado manualmente: prova contra a OpenAI REAL
// que `historico_recente` -- e SOMENTE ele -- muda a compreensao da mensagem
// atual pela IA interpretadora.
//
// POR QUE ESTE ARQUIVO EXISTE (2026-08-08). O runner anterior
// (teste-real-historico-interpretadora.ts) passou 7/7 enquanto o historico
// NUNCA chegava ao corpo HTTP: todos os casos positivos tambem tinham
// `proposta_pendente`, e a regra de confirmacao por proposta pendente ja era
// suficiente sozinha para produzir o resultado esperado. O teste nunca provou
// o que dizia provar.
//
// REGRA DE TESTES DO PROJETO, nascida desse erro (docs/00-principios.md):
//
//   Um teste de uma funcionalidade nova deve ISOLAR o mecanismo novo. O
//   resultado nao pode ser explicavel por mecanismo antigo ou paralelo.
//
// COMO ESTE RUNNER FORCA ISSO ESTRUTURALMENTE:
//
// Cada caso e um PAR. A MESMA mensagem atual e enviada duas vezes -- uma com
// historico, outra sem -- e o caso so passa quando:
//
//   1. o lado COM historico bate com o esperado;
//   2. o lado SEM historico bate com o esperado;
//   3. os dois resultados sao DIFERENTES entre si.
//
// A condicao (3) e o que torna impossivel um falso positivo: se o historico
// nao chegar ao modelo, os dois lados produzem exatamente o mesmo resultado e
// o caso falha, por construcao. Nenhum caso usa `proposta_pendente` nem
// `horarios_oferecidos` -- nao ha contexto paralelo que possa explicar nada.
//
// Mensagens: todas sinteticas e ficticias.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-historico-isolado.ts

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
import type { SaidaInterpretacao } from '../core/interpretacao-tipos.ts';
import type { ParConversa } from '../core/tipos.ts';

/** O que observamos na saida: um campo de `alteracoes`, ou a `natureza_mensagem`. */
type Observado = { tipo: 'campo'; campo: string } | { tipo: 'natureza' };

// ATUALIZADO em 2026-08-09 (specs/dentista-semantico-v1.md): o campo
// observado era `dentista_texto`, que deixou de existir -- a interpretadora
// agora devolve `dentista_id` escolhido de `dentistas_disponiveis`. O
// MECANISMO provado e o mesmo de antes (uma palavra que sozinha o modelo le
// como nome do paciente, e com historico le como escolha de profissional);
// so o campo mudou.
//
// A lista de dentistas e enviada IGUAL nos dois lados do par, entao o
// isolamento continua intacto: a unica variavel entre A e B segue sendo o
// historico. Sem a lista, `dentista_id` seria impossivel de emitir nos dois
// lados e o par nao provaria nada.
interface Par {
  titulo: string;
  /** IDENTICA nos dois lados -- e o que torna a comparacao valida. */
  mensagem: string;
  perguntaAnteriorDaIris: string;
  mensagemAnteriorDoPaciente: string;
  observado: Observado;
  /** `null` = espera o campo AUSENTE. */
  comHistorico: string | null;
  semHistorico: string | null;
  /** Enviada IDENTICA nos dois lados -- nunca e a variavel do par. */
  procedimentosDisponiveis: { procedimento_id: string; nome_pt: string }[];
}

// TODA mensagem de teste aqui precisa ser algo que um paciente REAL diria.
// Referencia de registro real (WhatsApp, 2026-08-07): "Estou com dor de dente
// dos infernos", "Uma consulta normal para o dentista desidir", "Avaliação
// né", "Tem para amanhã de manhã?". Se a frase do teste nao soa como essas,
// ela nao pertence a este arquivo.
//
// Dois candidatos foram DESCARTADOS em 2026-08-08, registrados para ninguem
// reintroduzi-los:
//
// - `natureza_mensagem` como observavel ("Tarde." -> resposta vs pedido): o
//   modelo alternou entre execucoes com a MESMA entrada. Instavel demais para
//   virar assercao.
// - "A segunda" como resposta a "manha ou tarde?": FRASE INVENTADA. Nenhum
//   paciente responde uma pergunta binaria com um ordinal -- ele diz "tarde",
//   "de tarde", "pela manha". O caso produzia saida estranha do modelo, mas
//   isso NAO e um achado sobre o sistema: e consequencia de uma entrada que
//   nao existe na vida real. Ordinal ("o segundo") so e realista quando a
//   Iris apresentou uma LISTA de horarios -- e nesse caso ja e coberto por
//   `horarios_oferecidos`, nao pelo historico.
//
// O mecanismo que se mostrou robusto e a DESAMBIGUACAO DE CAMPO: uma palavra
// que, sozinha, o modelo lê como nome do paciente, e que com o historico ele
// lê como escolha de dentista. Sao dois campos diferentes do vocabulario
// fechado -- diferenca binaria, sem zona cinzenta. E realista: responder so
// o nome do profissional ("A Ana") e exatamente como as pessoas escrevem.
// ================== STATUS EM 2026-08-09: SEM DISCRIMINADOR ESTAVEL ========
//
// Este runner esta VERMELHO (0/2) e a causa NAO e regressao do historico.
// O par original perdeu o poder de discriminar por causa de
// specs/dentista-semantico-v1.md (explicado logo abaixo), e nenhuma
// substituicao estavel foi encontrada ainda. Duas evidencias de que o
// historico continua chegando e tendo efeito:
//
//   1. o teste deterministico de fronteira HTTP continua verde
//      ("fronteira: historico_recente presente no payload chega LITERALMENTE
//      ao corpo HTTP", cliente-modelo-openai.test.ts) -- a chave cruza a
//      fronteira;
//   2. nas execucoes abaixo, `natureza_mensagem` MUDA entre os dois lados
//      (COM historico: "resposta"; SEM: "nao_compreendida") -- ou seja, o
//      modelo esta lendo o historico.
//
// O que falta e um par cuja assercao seja ESTAVEL. Os candidatos de
// aceitacao de oferta ("sim, quero", "tá bom, vamos nessa") resolveram
// `consultation_evaluation` numa sondagem e nao resolveram na execucao
// seguinte, com entrada identica -- mesma instabilidade que ja levou ao
// descarte de `natureza_mensagem` como observavel em 2026-08-08. Assercao
// instavel e pior que teste ausente: gera confianca falsa.
//
// NAO tratar isso aumentando o prompt. Encontrar um observavel binario e
// estavel, como o par original era, e frente propria.
// ===========================================================================
//
// TERCEIRO candidato DESCARTADO, em 2026-08-09, e vale registrar por que:
// o par original ("A Ana" -> `dentista_texto`) parou de discriminar quando
// `dentistas_disponiveis` passou a existir (specs/dentista-semantico-v1.md).
// Com a lista no payload, o modelo resolve "A Ana" para o id da Dra. Ana
// mesmo SEM historico -- os dois lados passaram a coincidir. Isso NAO e
// regressao do historico: e o par que perdeu o poder de discriminar, porque
// a lista de dentistas tornou obvia a leitura que antes so o historico dava.
// Um par A/B so vale enquanto a unica explicacao possivel for a variavel
// testada.
//
// O mecanismo que substitui e a ACEITACAO DE UMA OFERTA: "pode ser" sozinho
// nao diz absolutamente nada; com o historico, diz exatamente qual
// procedimento aceitar. E realista (e assim que as pessoas aceitam) e cobre,
// de quebra, o ciclo do CASO 1 zero-aptos de dentista-semantico-v1.md: a
// Iris oferece a avaliacao, o paciente aceita, e o turno seguinte resolve
// `consultation_evaluation` pelo caminho normal -- sem nenhum mecanismo de
// aceitacao dedicado.
const CATALOGO = [
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental (profilaxia)' },
  { procedimento_id: 'whitening', nome_pt: 'Clareamento em consultório' },
];

const PARES: readonly Par[] = Object.freeze([
  {
    titulo: '"sim, quero" -- com historico aceita a avaliacao oferecida; sozinho nao resolve procedimento nenhum',
    mensagem: 'sim, quero',
    perguntaAnteriorDaIris:
      'Não encontrei nenhum profissional para clareamento. Posso agendar uma Consulta/Avaliação?',
    mensagemAnteriorDoPaciente: 'quero clareamento',
    observado: { tipo: 'campo', campo: 'procedimento_id' },
    comHistorico: 'consultation_evaluation',
    semHistorico: null,
    procedimentosDisponiveis: CATALOGO,
  },
  {
    titulo: '"tá bom, vamos nessa" -- outro registro, para provar que o primeiro par nao foi sorte de uma frase',
    mensagem: 'tá bom, vamos nessa',
    perguntaAnteriorDaIris:
      'Não encontrei nenhum profissional para clareamento. Posso agendar uma Consulta/Avaliação?',
    mensagemAnteriorDoPaciente: 'quero clareamento',
    observado: { tipo: 'campo', campo: 'procedimento_id' },
    comHistorico: 'consultation_evaluation',
    semHistorico: null,
    procedimentosDisponiveis: CATALOGO,
  },
]);

// LIMITE CONHECIDO, medido em 2026-08-09 e registrado aqui para nao virar
// surpresa num teste manual: uma aceitacao MINIMA ("pode ser", "isso mesmo")
// nao fecha o ciclo -- mesmo com o historico presente, o modelo devolve
// `alteracoes: {}` e classifica como `nao_compreendida`. Aceitacoes um pouco
// mais comprometidas ("sim, quero", "tá bom, vamos nessa", "sim, por favor")
// resolvem `consultation_evaluation` normalmente. Nao ha correcao aqui: seria
// mais uma regra no prompt, e o CASO 1 zero-aptos foi explicitamente fechado
// sem mecanismo proprio (specs/dentista-semantico-v1.md secao 5).

function extrair(saida: SaidaInterpretacao, observado: Observado): string | undefined {
  return observado.tipo === 'natureza' ? saida.natureza_mensagem : saida.alteracoes[observado.campo]?.valor;
}

function bate(obtido: string | undefined, esperado: string | null): boolean {
  return esperado === null ? obtido === undefined : obtido === esperado;
}

type Lado = { obtido: string | undefined; alteracoes: unknown; natureza: string | undefined; erro: string | null };

async function rodarLado(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  par: Par,
  historicoRecente: ParConversa[] | undefined
): Promise<Lado> {
  // Assinatura: (mensagens, snapshot, horariosOferecidos, propostaPendente,
  // historicoRecente, procedimentosDisponiveis, dentistasDisponiveis). Os
  // tres `undefined` sao DELIBERADOS -- nenhum contexto paralelo. A lista de
  // dentistas e a UNICA excecao, e vai identica nos dois lados: sem ela o
  // campo observado seria inemitivel em ambos, e o par nao teria diferencial.
  const entrada = construirEntradaMinimizada(
    [par.mensagem],
    {},
    undefined,
    undefined,
    historicoRecente,
    par.procedimentosDisponiveis
  );
  try {
    const saida = await extrairAlteracoes(cliente, entrada);
    return {
      obtido: extrair(saida, par.observado),
      alteracoes: saida.alteracoes,
      natureza: saida.natureza_mensagem,
      erro: null,
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
    return { obtido: undefined, alteracoes: null, natureza: undefined, erro: codigo };
  }
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: historico_recente ISOLADO (pares A/B, sem proposta_pendente, sem horarios_oferecidos) ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log(`total de pares: ${PARES.length} (${PARES.length * 2} chamadas)`);
  console.log('');

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  let paresCorretos = 0;

  for (const par of PARES) {
    const historico: ParConversa[] = [
      {
        mensagem_paciente: par.mensagemAnteriorDoPaciente,
        resposta_iris: par.perguntaAnteriorDaIris,
        gerada_em: new Date(Date.now() - 60_000).toISOString(),
      },
    ];

    const ladoCom = await rodarLado(cliente, par, historico);
    const ladoSem = await rodarLado(cliente, par, undefined);

    const alvo = par.observado.tipo === 'natureza' ? 'natureza_mensagem' : par.observado.campo;
    const comOk = bate(ladoCom.obtido, par.comHistorico);
    const semOk = bate(ladoSem.obtido, par.semHistorico);
    const diferem = ladoCom.obtido !== ladoSem.obtido;
    const ok = comOk && semOk && diferem && ladoCom.erro === null && ladoSem.erro === null;
    if (ok) paresCorretos++;

    console.log(par.titulo);
    console.log(`  mensagem atual (identica nos dois lados): ${JSON.stringify(par.mensagem)}`);
    console.log(`  observando: ${alvo}`);
    console.log(`  COM historico  -> ${ladoCom.obtido ?? '(ausente)'}   [esperado: ${par.comHistorico ?? 'AUSENTE'}] ${comOk ? 'ok' : 'FALHOU'}`);
    console.log(`     alteracoes: ${JSON.stringify(ladoCom.alteracoes)} | natureza: ${ladoCom.natureza}${ladoCom.erro ? ` | erro: ${ladoCom.erro}` : ''}`);
    console.log(`  SEM historico  -> ${ladoSem.obtido ?? '(ausente)'}   [esperado: ${par.semHistorico ?? 'AUSENTE'}] ${semOk ? 'ok' : 'FALHOU'}`);
    console.log(`     alteracoes: ${JSON.stringify(ladoSem.alteracoes)} | natureza: ${ladoSem.natureza}${ladoSem.erro ? ` | erro: ${ladoSem.erro}` : ''}`);
    console.log(`  RESULTADOS DIFEREM: ${diferem} ${diferem ? '(historico teve efeito comprovado)' : '(SEM EFEITO -- historico nao chegou ao modelo)'}`);
    console.log(`  PAR: ${ok ? 'PASSOU' : 'FALHOU'}`);
    console.log('');
  }

  console.log('--- resumo ---');
  console.log(`${paresCorretos}/${PARES.length} pares`);

  process.exitCode = paresCorretos === PARES.length ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
