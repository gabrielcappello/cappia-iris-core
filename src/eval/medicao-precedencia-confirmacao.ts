// Runner ISOLADO, avulso: MEDICAO PRE-IMPLEMENTACAO da regra GERAL de
// precedencia da confirmacao. Nenhum modulo de producao e alterado por este
// arquivo -- as variantes candidatas sao montadas em memoria, por substituicao
// de texto sobre INSTRUCOES_EXTRATOR.
//
// ── O ACHADO QUE MOTIVA ESTA MEDICAO (2026-08-11) ────────────────────────
// Ao verificar a implementacao do cancelamento, o caminho completo falhou no
// turno 2: "Isso, pode cancelar" com `proposta_pendente` presente devolveu
//   natureza=correcao, alteracoes={intencao:{acao:'corrigir',valor:'cancelamento'}}
// -- a IA REEMITIU A INTENCAO em vez de preencher `confirmacao`.
//
// Inspecao subsequente mostrou que o defeito NAO e do cancelamento e NAO foi
// introduzido por ele -- e PRE-EXISTENTE e GERAL:
//   [remarcacao]       "pode remarcar"     -> intencao=remarcacao  (nao confirma)
//   [novo_agendamento] "Isso, pode marcar" -> {} (nada)
// Quando a frase de concordancia contem o VERBO DO PROPRIO FLUXO, o modelo
// tende a reler a mensagem como pedido novo. So nao aparecia antes porque
// "pode marcar" e exemplo LITERAL na regra de confirmacao -- vies lexical que
// favorece um unico fluxo.
//
// ── HIPOTESE A MEDIR (Gabriel, 2026-08-11) ──────────────────────────────
// Quando existir `proposta_pendente` oficial, uma concordancia com essa
// proposta deve preencher `confirmacao` e NAO reemitir `intencao`.
//
// Restricoes do contrato: regra SEMANTICA e GERAL para qualquer fluxo
// aguardando confirmacao; nunca regra para palavras especificas; nunca citar
// "pode marcar"/"pode remarcar"/"pode cancelar" como repertorio; negacao,
// duvida e ambiguidade continuam sem confirmar.
//
// ── TRES VARIANTES ──────────────────────────────────────────────────────
//   A -- PRODUCAO, exatamente como esta hoje (baseline).
//   B -- PRECEDENCIA: acrescenta UMA frase, semantica e sem verbo de fluxo.
//        A lista de exemplos da regra de confirmacao fica INTACTA (inclusive
//        o "pode marcar" que existe la hoje).
//   C -- PRECEDENCIA + EXEMPLOS NEUTRALIZADOS: B, e alem disso REMOVE o unico
//        verbo de fluxo da lista de exemplos ("pode marcar"). Isola se o vies
//        lexical dos proprios exemplos e parte da causa.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-precedencia-confirmacao.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { INSTRUCOES_EXTRATOR, SCHEMA_SAIDA_INTERPRETACAO } from '../core/interpretacao-instrucoes.ts';
import type { EntradaInterpretacao } from '../core/interpretacao-tipos.ts';

// --- Trechos de PRODUCAO, exatos (copiados de interpretacao-instrucoes.ts) ---

const LINHA_CONFIRMACAO_PRODUCAO =
  '- Emita confirmacao = sim quando "proposta_pendente" estiver presente no payload e a mensagem atual expressar concordancia semanticamente clara com essa proposta especifica — sem repertorio fechado de frases: "sim", "confirmo", "pode marcar", "isso mesmo", "ok", "certo", "fechado", "esse mesmo", "pode ser" e qualquer concordancia inequivoca equivalente valem igualmente.';

// Mesma frase, sem o UNICO verbo de fluxo da lista ("pode marcar"). Nenhum
// exemplo novo e acrescentado -- so a remocao do que enviesa para um fluxo.
const LINHA_CONFIRMACAO_NEUTRA =
  '- Emita confirmacao = sim quando "proposta_pendente" estiver presente no payload e a mensagem atual expressar concordancia semanticamente clara com essa proposta especifica — sem repertorio fechado de frases: "sim", "confirmo", "isso mesmo", "ok", "certo", "fechado", "esse mesmo", "pode ser" e qualquer concordancia inequivoca equivalente valem igualmente.';

const LINHA_PROPOSTA_PRODUCAO =
  '- Quando "proposta_pendente" estiver presente, ele descreve a data e o horario que o Core esta propondo ao paciente, aguardando confirmacao — e a "proposta concreta" da regra de confirmacao acima. Nao decida nada a partir dele alem dessa regra: nunca copie proposta_pendente.data ou proposta_pendente.horario para data_texto/horario_texto por conta propria — uma mencao nova e explicita a outra data ou horario segue a regra normal desses campos, nao a de confirmacao.';

// CANDIDATA: semantica, geral, sem nenhum verbo de fluxo e sem repertorio.
// Mesma FORMA da precedencia ja aprovada e medida para agendamentos_ativos
// ("a unica pergunta em aberto e ...").
const LINHA_PRECEDENCIA =
  '- Enquanto "proposta_pendente" estiver presente, a unica pergunta em aberto e se o paciente concorda com ela — nada mais. Uma concordancia semanticamente clara nesse turno E a resposta a essa pergunta: preencha "confirmacao" e NAO emita "intencao" por causa dela. Concordar com o que o Core acabou de propor nunca e um pedido novo, mesmo quando o paciente descreve com as proprias palavras a acao que ja esta em andamento — a intencao do fluxo ja consta em "dados_atuais" e nunca precisa ser reafirmada para confirmar. Recusa, duvida, pergunta ou hesitacao continuam NAO preenchendo "confirmacao", e tambem nao emitem intencao nova.';

function instrucoesVarianteB(): string {
  if (!INSTRUCOES_EXTRATOR.includes(LINHA_PROPOSTA_PRODUCAO)) {
    throw new Error('Linha de proposta_pendente nao encontrada -- runner desatualizado.');
  }
  return INSTRUCOES_EXTRATOR.replace(LINHA_PROPOSTA_PRODUCAO, `${LINHA_PROPOSTA_PRODUCAO}\n${LINHA_PRECEDENCIA}`);
}

function instrucoesVarianteC(): string {
  const comPrecedencia = instrucoesVarianteB();
  if (!comPrecedencia.includes(LINHA_CONFIRMACAO_PRODUCAO)) {
    throw new Error('Linha de confirmacao nao encontrada -- runner desatualizado.');
  }
  return comPrecedencia.replace(LINHA_CONFIRMACAO_PRODUCAO, LINHA_CONFIRMACAO_NEUTRA);
}

// --- Catalogo fiel a producao ---
const PROCEDIMENTOS_DISPONIVEIS = [
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental' },
  { procedimento_id: 'implant', nome_pt: 'Implante dentário' },
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
];
const DENTISTAS_DISPONIVEIS = [
  { dentista_id: 'dent-ana', nome_exibido: 'Dra. Ana Souza' },
  { dentista_id: 'dent-bruno', nome_exibido: 'Dr. Bruno Lima' },
];

const AGORA_ISO = new Date().toISOString();
const PROPOSTA = { data: '2026-08-20', horario: '15:00' };

type Fluxo = 'novo_agendamento' | 'remarcacao' | 'cancelamento';

// Estado EXATO do turno seguinte a decisao de confirmacao de cada fluxo.
function payloadDoFluxo(fluxo: Fluxo, mensagem: string): EntradaInterpretacao {
  const comum = {
    mensagens_atuais: [mensagem],
    campos_cadastrais_preenchidos: [] as never[],
    procedimentos_disponiveis: PROCEDIMENTOS_DISPONIVEIS,
    dentistas_disponiveis: DENTISTAS_DISPONIVEIS,
    proposta_pendente: PROPOSTA,
  };

  if (fluxo === 'novo_agendamento') {
    return {
      ...comum,
      dados_atuais: {
        intencao: 'novo_agendamento',
        procedimento_id: 'cleaning',
        dentista_id: 'dent-ana',
        data_texto: '20/08',
        horario_texto: '15:00',
      },
      historico_recente: [
        {
          mensagem_paciente: 'Quero marcar uma limpeza com a Dra. Ana dia 20/08 as 15h',
          resposta_iris: 'Perfeito! Limpeza dental com a Dra. Ana Souza em 20/08 às 15:00. Confirma?',
          gerada_em: AGORA_ISO,
        },
      ],
    };
  }

  if (fluxo === 'remarcacao') {
    return {
      ...comum,
      dados_atuais: {
        intencao: 'remarcacao',
        data_texto: '20/08',
        horario_texto: '15:00',
      },
      historico_recente: [
        {
          mensagem_paciente: 'Preciso remarcar minha consulta para dia 20 as 15h',
          resposta_iris: 'Você está com 14/08 às 09:00. Quer passar para 20/08 às 15:00?',
          gerada_em: AGORA_ISO,
        },
      ],
    };
  }

  return {
    ...comum,
    dados_atuais: { intencao: 'cancelamento' },
    historico_recente: [
      {
        mensagem_paciente: 'Preciso cancelar minha consulta',
        resposta_iris: 'Você quer cancelar Limpeza dental com Dra. Ana Souza — 20/08 às 15:00? Isso não pode ser desfeito.',
        gerada_em: AGORA_ISO,
      },
    ],
  };
}

// Positivas: 'sim' e 'pode' sao comuns aos tres; a terceira usa o VERBO DO
// PROPRIO FLUXO -- que e exatamente o caso que falha hoje.
const POSITIVAS: Record<Fluxo, readonly string[]> = {
  novo_agendamento: ['sim', 'pode', 'pode marcar'],
  remarcacao: ['sim', 'pode', 'pode remarcar'],
  cancelamento: ['sim', 'pode', 'pode cancelar'],
};

// Negativas: identicas nos tres fluxos -- recusa, pergunta e hesitacao.
const NEGATIVAS: readonly string[] = ['não', 'por quê?', 'não sei ainda'];

const FLUXOS: readonly Fluxo[] = ['novo_agendamento', 'remarcacao', 'cancelamento'];

interface Observacao {
  fluxo: Fluxo;
  mensagem: string;
  positiva: boolean;
  confirmou: boolean;
  reemitiuIntencao: boolean;
  erro: string | null;
  detalhe: string;
}

// A truncacao (`resposta_truncada`) e ruido de infraestrutura observado ~3x em
// ~40 chamadas nas medicoes anteriores, NAO um julgamento do modelo. Retenta
// ate 2 vezes so nesse caso, e conta quantas vezes ocorreu -- nunca esconde.
const MAX_RETENTATIVAS_TRUNCACAO = 2;
let truncacoes = 0;

async function observar(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  instrucoes: string,
  fluxo: Fluxo,
  mensagem: string,
  positiva: boolean
): Promise<Observacao> {
  for (let tentativa = 0; tentativa <= MAX_RETENTATIVAS_TRUNCACAO; tentativa++) {
    try {
      const saidaBruta = await cliente.executar({
        instrucoes,
        schema: SCHEMA_SAIDA_INTERPRETACAO,
        payload: payloadDoFluxo(fluxo, mensagem),
      });
      const saida = saidaBruta as Record<string, unknown>;
      const alteracoes = (saida.alteracoes ?? {}) as Record<string, { acao?: string; valor?: string } | undefined>;
      const confirmacao = alteracoes.confirmacao;
      const intencao = alteracoes.intencao;
      const confirmou = confirmacao !== undefined && confirmacao.acao !== 'remover' && confirmacao.valor === 'sim';
      const reemitiuIntencao = intencao !== undefined && intencao.acao !== 'remover';
      return {
        fluxo,
        mensagem,
        positiva,
        confirmou,
        reemitiuIntencao,
        erro: null,
        detalhe: `natureza=${String(saida.natureza_mensagem)} | confirmacao=${confirmou ? 'sim' : '(ausente)'}${reemitiuIntencao ? ` | REEMITIU intencao=${intencao?.valor}` : ''}`,
      };
    } catch (erro) {
      const mensagemErro = erro instanceof Error ? erro.message : 'desconhecido';
      if (mensagemErro.includes('resposta_truncada') && tentativa < MAX_RETENTATIVAS_TRUNCACAO) {
        truncacoes++;
        continue;
      }
      return {
        fluxo,
        mensagem,
        positiva,
        confirmou: false,
        reemitiuIntencao: false,
        erro: mensagemErro,
        detalhe: `ERRO: ${mensagemErro}`,
      };
    }
  }
  return { fluxo, mensagem, positiva, confirmou: false, reemitiuIntencao: false, erro: 'truncacao_persistente', detalhe: 'ERRO: truncacao persistente' };
}

interface Placar {
  confirmacoesCorretas: number;
  totalPositivas: number;
  reemissoesIndevidas: number;
  falsosPositivos: number;
  totalNegativas: number;
  erros: number;
}

async function executarVariante(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  nome: string,
  instrucoes: string
): Promise<Placar> {
  console.log('');
  console.log(`##### VARIANTE: ${nome} #####`);

  const placar: Placar = {
    confirmacoesCorretas: 0,
    totalPositivas: 0,
    reemissoesIndevidas: 0,
    falsosPositivos: 0,
    totalNegativas: 0,
    erros: 0,
  };

  for (const fluxo of FLUXOS) {
    console.log(`  [${fluxo}]`);
    for (const mensagem of POSITIVAS[fluxo]) {
      const o = await observar(cliente, instrucoes, fluxo, mensagem, true);
      placar.totalPositivas++;
      if (o.erro !== null) placar.erros++;
      if (o.confirmou) placar.confirmacoesCorretas++;
      if (o.reemitiuIntencao) placar.reemissoesIndevidas++;
      const marca = o.erro !== null ? 'ERR' : o.confirmou && !o.reemitiuIntencao ? 'OK ' : '-- ';
      console.log(`  ${marca} "${mensagem}"  ->  ${o.detalhe}`);
    }
    for (const mensagem of NEGATIVAS) {
      const o = await observar(cliente, instrucoes, fluxo, mensagem, false);
      placar.totalNegativas++;
      if (o.erro !== null) placar.erros++;
      if (o.confirmou) placar.falsosPositivos++;
      const marca = o.erro !== null ? 'ERR' : o.confirmou ? '!!!' : 'OK ';
      console.log(`  ${marca} (neg) "${mensagem}"  ->  ${o.detalhe}${o.confirmou ? '  *** PERIGOSO ***' : ''}`);
    }
  }

  console.log('');
  console.log(`  confirmacao correta        : ${placar.confirmacoesCorretas}/${placar.totalPositivas}`);
  console.log(`  REEMISSAO indevida de intencao : ${placar.reemissoesIndevidas}/${placar.totalPositivas}`);
  console.log(`  FALSOS POSITIVOS perigosos : ${placar.falsosPositivos}/${placar.totalNegativas}`);
  console.log(`  erros (infra)              : ${placar.erros}`);
  return placar;
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- medicao: precedencia GERAL da confirmacao sobre a intencao ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('Nenhum modulo de producao foi alterado por este runner.');
  console.log(`casos por variante: ${FLUXOS.length * (3 + NEGATIVAS.length)} (3 fluxos x 3 positivas + 3 negativas)`);

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const a = await executarVariante(cliente, 'A -- PRODUCAO (baseline)', INSTRUCOES_EXTRATOR);
  const b = await executarVariante(cliente, 'B -- PRECEDENCIA (1 frase, exemplos intactos)', instrucoesVarianteB());
  const c = await executarVariante(cliente, 'C -- PRECEDENCIA + exemplos sem verbo de fluxo', instrucoesVarianteC());

  console.log('');
  console.log('##### COMPARACAO #####');
  console.log(`  confirmacao correta        : A ${a.confirmacoesCorretas}/${a.totalPositivas}  ->  B ${b.confirmacoesCorretas}/${b.totalPositivas}  ->  C ${c.confirmacoesCorretas}/${c.totalPositivas}`);
  console.log(`  REEMISSAO de intencao      : A ${a.reemissoesIndevidas}/${a.totalPositivas}  ->  B ${b.reemissoesIndevidas}/${b.totalPositivas}  ->  C ${c.reemissoesIndevidas}/${c.totalPositivas}`);
  console.log(`  FALSOS POSITIVOS perigosos : A ${a.falsosPositivos}/${a.totalNegativas}  ->  B ${b.falsosPositivos}/${b.totalNegativas}  ->  C ${c.falsosPositivos}/${c.totalNegativas}`);
  console.log(`  erros de infra             : A ${a.erros}  ->  B ${b.erros}  ->  C ${c.erros}`);
  console.log(`  retentativas por truncacao : ${truncacoes}`);
}

main().catch((erro) => {
  console.error(`erro fatal: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
