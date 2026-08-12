// Runner ISOLADO, avulso: MEDICAO PRE-IMPLEMENTACAO do MARCADOR GENERICO de
// confirmacao pendente. Nenhum modulo de producao e alterado por este arquivo.
//
// ── DE ONDE VEM ESTA MEDICAO ────────────────────────────────────────────
// A medicao anterior (medicao-precedencia-confirmacao.ts, 3 execucoes)
// mostrou que uma REGRA DE PRECEDENCIA sobre `proposta_pendente` NAO resolve:
// A 19/27, B 19/27, C 20/27 de confirmacao correta -- indistinguiveis, com a
// variancia entre execucoes maior que a diferenca entre variantes.
//
// HIPOTESE NOVA (Gabriel, 2026-08-11): o problema nao e de precedencia entre
// regras, e do PROPRIO MARCADOR. `proposta_pendente` carrega {data, horario} e
// e descrito como "a data e o horario que o Core esta propondo" -- linguagem
// de OFERTA. Mandar esse dado estruturado e o que PUXA o modelo a reler a
// mensagem como pedido novo sobre data/horario/acao.
//
// Esse diagnostico tem PRECEDENTE MEDIDO neste proprio repositorio:
// `oferta_procedimento_pendente` e um BOOLEANO justamente por isso --
// interpretacao-tipos.ts registra: "DELIBERADAMENTE sem o `procedimento_id`
// oferecido. Mandar o id para a IA era o que a PUXAVA a emiti-lo -- causa
// medida do caso em que 'prefiro outra coisa' acabava aceitando a oferta. O
// que foi oferecido ja esta no historico, em portugues, que e o que ela
// precisa para julgar." `troca_telefone_pendente` segue o mesmo padrao.
//
// ── AS DUAS VARIANTES ───────────────────────────────────────────────────
//   A -- CONTRATO ATUAL: `proposta_pendente: {data, horario}` no payload,
//        regra de confirmacao de producao (que inclui repertorio de frases).
//   B -- MARCADOR GENERICO: `confirmacao_pendente: true` NO LUGAR de
//        `proposta_pendente`. Significado unico e neutro -- "ha uma pergunta
//        objetiva de confirmacao aguardando resposta" --, identico nos tres
//        fluxos. NENHUM repertorio de frases na regra, NENHUM verbo de fluxo,
//        NENHUM parser. O que esta sendo confirmado a IA le do
//        `historico_recente`, em portugues, exatamente como ja faz para
//        `oferta_procedimento_pendente`.
//
// IMPORTANTE: `confirmacao_pendente` substitui `proposta_pendente` SO NO
// PAYLOAD DA IA. O Core continuaria guardando {data, horario} em
// `contexto_horarios` -- e disso que depende a condicao 3 da spec de
// cancelamento (secao 4). Mesmo desenho ja usado por
// `oferta_procedimento_pendente` (o Core guarda o id, a IA recebe `true`).
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-marcador-confirmacao-pendente.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { INSTRUCOES_EXTRATOR, SCHEMA_SAIDA_INTERPRETACAO } from '../core/interpretacao-instrucoes.ts';
import type { EntradaInterpretacao } from '../core/interpretacao-tipos.ts';

// --- Trechos de PRODUCAO, exatos ---
const LINHA_CONFIRMACAO_PRODUCAO =
  '- Emita confirmacao = sim quando "proposta_pendente" estiver presente no payload e a mensagem atual expressar concordancia semanticamente clara com essa proposta especifica — sem repertorio fechado de frases: "sim", "confirmo", "pode marcar", "isso mesmo", "ok", "certo", "fechado", "esse mesmo", "pode ser" e qualquer concordancia inequivoca equivalente valem igualmente. Quando "proposta_pendente" NAO estiver presente no payload, uma concordancia solta como "ok" ou "certo" NUNCA emite confirmacao = sim — nao ha proposta concreta para confirmar, entao esse texto sozinho e insuficiente. Em qualquer um dos dois casos, diante de duvida, pergunta, hesitacao ou resposta negativa, omita o campo por completo — nunca emita um valor diferente de "sim".';

const LINHA_PROPOSTA_PRODUCAO =
  '- Quando "proposta_pendente" estiver presente, ele descreve a data e o horario que o Core esta propondo ao paciente, aguardando confirmacao — e a "proposta concreta" da regra de confirmacao acima. Nao decida nada a partir dele alem dessa regra: nunca copie proposta_pendente.data ou proposta_pendente.horario para data_texto/horario_texto por conta propria — uma mencao nova e explicita a outra data ou horario segue a regra normal desses campos, nao a de confirmacao.';

// --- CANDIDATA: marcador generico, SEM repertorio e SEM verbo de fluxo ---
const LINHA_CONFIRMACAO_CANDIDATA =
  '- Emita confirmacao = sim quando "confirmacao_pendente" estiver presente no payload e a mensagem atual expressar concordancia semanticamente clara com a pergunta que voce (Iris) fez no turno anterior — essa pergunta esta no "historico_recente", em portugues. "confirmacao_pendente" significa exatamente uma coisa: ha uma pergunta objetiva de confirmacao aguardando um sim ou nao, e nada mais esta em aberto neste turno. Qualquer forma inequivoca de concordar vale igualmente, inclusive quando o paciente reafirma com as proprias palavras a acao que ele esta autorizando — reafirmar o que voce acabou de perguntar e concordar, nunca um pedido novo, entao nesse caso preencha "confirmacao" e nao emita "intencao". Quando "confirmacao_pendente" NAO estiver presente, uma concordancia solta NUNCA emite confirmacao = sim — nao ha pergunta concreta para confirmar. Diante de duvida, pergunta, hesitacao ou resposta negativa, omita o campo por completo — nunca emita um valor diferente de "sim".';

function instrucoesCandidatas(): string {
  if (!INSTRUCOES_EXTRATOR.includes(LINHA_CONFIRMACAO_PRODUCAO)) {
    throw new Error('Linha de confirmacao de producao nao encontrada -- runner desatualizado.');
  }
  if (!INSTRUCOES_EXTRATOR.includes(LINHA_PROPOSTA_PRODUCAO)) {
    throw new Error('Linha de proposta_pendente nao encontrada -- runner desatualizado.');
  }
  // A linha descritiva de `proposta_pendente` SAI: nesta variante a chave nem
  // vai no payload, entao mante-la seria texto morto falando de um campo
  // ausente.
  return INSTRUCOES_EXTRATOR.replace(LINHA_CONFIRMACAO_PRODUCAO, LINHA_CONFIRMACAO_CANDIDATA).replace(
    `\n${LINHA_PROPOSTA_PRODUCAO}`,
    ''
  );
}

// --- VARIANTE C: B + GUARDA ESTRUTURAL SOBRE A INTENCAO ---
//
// Diagnostico do residuo medido em B: "pode remarcar"/"pode cancelar"
// continuam 0/3 porque as REGRAS DE INTENCAO disparam sobre essas frases (a
// de remarcacao lista "da pra mudar meu horario?" como exemplo; a de
// cancelamento nao existe, mas o modelo generaliza). A frase de precedencia
// DENTRO da regra de confirmacao ("nao emita intencao") nao foi suficiente
// para sobrepor regras que vivem em outras linhas.
//
// A guarda abaixo e ESTRUTURAL e vive por conta propria: enquanto houver
// pergunta de confirmacao em aberto, `intencao` simplesmente nao e emitivel.
// Generica (nao cita fluxo), semantica (nao cita palavra), sem repertorio.
const LINHA_GUARDA_INTENCAO =
  '- Enquanto "confirmacao_pendente" estiver presente, NUNCA emita "intencao", qualquer que seja o valor. A intencao do fluxo em andamento ja consta em "dados_atuais" e reafirma-la nao acrescenta nada — neste turno a mensagem do paciente so pode ser concordancia, recusa, duvida ou um pedido de outra coisa, nunca uma reafirmacao da intencao que ja esta em curso.';

function instrucoesComGuarda(): string {
  const base = instrucoesCandidatas();
  if (!base.includes(LINHA_CONFIRMACAO_CANDIDATA)) {
    throw new Error('Linha candidata nao encontrada -- runner desatualizado.');
  }
  return base.replace(LINHA_CONFIRMACAO_CANDIDATA, `${LINHA_CONFIRMACAO_CANDIDATA}\n${LINHA_GUARDA_INTENCAO}`);
}

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

const DADOS_POR_FLUXO: Record<Fluxo, Record<string, string>> = {
  novo_agendamento: {
    intencao: 'novo_agendamento',
    procedimento_id: 'cleaning',
    dentista_id: 'dent-ana',
    data_texto: '20/08',
    horario_texto: '15:00',
  },
  remarcacao: { intencao: 'remarcacao', data_texto: '20/08', horario_texto: '15:00' },
  cancelamento: { intencao: 'cancelamento' },
};

const HISTORICO_POR_FLUXO: Record<Fluxo, { mensagem_paciente: string; resposta_iris: string }> = {
  novo_agendamento: {
    mensagem_paciente: 'Quero marcar uma limpeza com a Dra. Ana dia 20/08 as 15h',
    resposta_iris: 'Perfeito! Limpeza dental com a Dra. Ana Souza em 20/08 às 15:00. Confirma?',
  },
  remarcacao: {
    mensagem_paciente: 'Preciso remarcar minha consulta para dia 20 as 15h',
    resposta_iris: 'Você está com 14/08 às 09:00. Quer passar para 20/08 às 15:00?',
  },
  cancelamento: {
    mensagem_paciente: 'Preciso cancelar minha consulta',
    resposta_iris: 'Você quer cancelar Limpeza dental com Dra. Ana Souza — 20/08 às 15:00? Isso não pode ser desfeito.',
  },
};

// `confirmacao_pendente` nao existe em EntradaInterpretacao (a variante B e
// exatamente a proposta de cria-lo). O cast e local ao runner -- nenhum tipo
// de producao e alterado.
type PayloadMedicao = Omit<EntradaInterpretacao, 'proposta_pendente'> & {
  proposta_pendente?: { data: string; horario: string };
  confirmacao_pendente?: true;
};

function montarPayload(fluxo: Fluxo, mensagem: string, variante: 'A' | 'B'): PayloadMedicao {
  const h = HISTORICO_POR_FLUXO[fluxo];
  return {
    mensagens_atuais: [mensagem],
    dados_atuais: DADOS_POR_FLUXO[fluxo],
    campos_cadastrais_preenchidos: [],
    procedimentos_disponiveis: PROCEDIMENTOS_DISPONIVEIS,
    dentistas_disponiveis: DENTISTAS_DISPONIVEIS,
    // A UNICA diferenca entre as variantes.
    ...(variante === 'A' ? { proposta_pendente: PROPOSTA } : { confirmacao_pendente: true as const }),
    historico_recente: [{ ...h, gerada_em: AGORA_ISO }],
  };
}

const POSITIVAS: Record<Fluxo, readonly string[]> = {
  novo_agendamento: ['sim', 'pode', 'pode marcar'],
  remarcacao: ['sim', 'pode', 'pode remarcar'],
  cancelamento: ['sim', 'pode', 'pode cancelar'],
};
const NEGATIVAS: readonly string[] = ['não', 'por quê?', 'não sei ainda'];
const FLUXOS: readonly Fluxo[] = ['novo_agendamento', 'remarcacao', 'cancelamento'];

const REPETICOES = 3;
const MAX_RETENTATIVAS_TRUNCACAO = 2;
let truncacoes = 0;

interface Resultado {
  confirmou: boolean;
  reemitiuIntencao: boolean;
  /** Nem confirmacao, nem intencao, nem qualquer outro campo -- o fluxo trava. */
  omitiuTudo: boolean;
  erro: boolean;
}

async function observar(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  instrucoes: string,
  payload: PayloadMedicao
): Promise<Resultado> {
  for (let tentativa = 0; tentativa <= MAX_RETENTATIVAS_TRUNCACAO; tentativa++) {
    try {
      const saidaBruta = await cliente.executar({
        instrucoes,
        schema: SCHEMA_SAIDA_INTERPRETACAO,
        payload: payload as unknown as EntradaInterpretacao,
      });
      const saida = saidaBruta as Record<string, unknown>;
      const alteracoes = (saida.alteracoes ?? {}) as Record<string, { acao?: string; valor?: string } | undefined>;
      const c = alteracoes.confirmacao;
      const i = alteracoes.intencao;
      const confirmou = c !== undefined && c.acao !== 'remover' && c.valor === 'sim';
      const reemitiuIntencao = i !== undefined && i.acao !== 'remover';
      return {
        confirmou,
        reemitiuIntencao,
        omitiuTudo: Object.keys(alteracoes).length === 0,
        erro: false,
      };
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : '';
      if (msg.includes('resposta_truncada') && tentativa < MAX_RETENTATIVAS_TRUNCACAO) {
        truncacoes++;
        continue;
      }
      return { confirmou: false, reemitiuIntencao: false, omitiuTudo: false, erro: true };
    }
  }
  return { confirmou: false, reemitiuIntencao: false, omitiuTudo: false, erro: true };
}

interface Placar {
  confirmacoes: number;
  positivas: number;
  reemissoes: number;
  omissoesPositivas: number;
  falsosPositivos: number;
  negativas: number;
  erros: number;
}

async function executarVariante(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  nome: string,
  instrucoes: string,
  variante: 'A' | 'B'
): Promise<Placar> {
  console.log('');
  console.log(`##### VARIANTE ${variante}: ${nome} #####`);
  const p: Placar = {
    confirmacoes: 0,
    positivas: 0,
    reemissoes: 0,
    omissoesPositivas: 0,
    falsosPositivos: 0,
    negativas: 0,
    erros: 0,
  };

  for (const fluxo of FLUXOS) {
    console.log(`  [${fluxo}]`);
    for (const mensagem of POSITIVAS[fluxo]) {
      let ok = 0;
      let reemit = 0;
      let omit = 0;
      let err = 0;
      for (let r = 0; r < REPETICOES; r++) {
        const o = await observar(cliente, instrucoes, montarPayload(fluxo, mensagem, variante));
        p.positivas++;
        if (o.erro) { err++; p.erros++; continue; }
        if (o.confirmou) { ok++; p.confirmacoes++; }
        if (o.reemitiuIntencao) { reemit++; p.reemissoes++; }
        if (o.omitiuTudo) { omit++; p.omissoesPositivas++; }
      }
      const marca = ok === REPETICOES ? 'OK ' : ok === 0 ? '-- ' : '~~ ';
      console.log(
        `  ${marca} "${mensagem}"  confirmou ${ok}/${REPETICOES}${reemit > 0 ? ` | reemitiu intencao ${reemit}` : ''}${omit > 0 ? ` | omitiu tudo ${omit}` : ''}${err > 0 ? ` | erro ${err}` : ''}`
      );
    }
    for (const mensagem of NEGATIVAS) {
      let fp = 0;
      let err = 0;
      for (let r = 0; r < REPETICOES; r++) {
        const o = await observar(cliente, instrucoes, montarPayload(fluxo, mensagem, variante));
        p.negativas++;
        if (o.erro) { err++; p.erros++; continue; }
        if (o.confirmou) { fp++; p.falsosPositivos++; }
      }
      console.log(
        `  ${fp === 0 ? 'OK ' : '!!!'} (neg) "${mensagem}"  falso positivo ${fp}/${REPETICOES}${err > 0 ? ` | erro ${err}` : ''}${fp > 0 ? '  *** PERIGOSO ***' : ''}`
      );
    }
  }

  console.log('');
  console.log(`  confirmacao correta   : ${p.confirmacoes}/${p.positivas}`);
  console.log(`  reemissao de intencao : ${p.reemissoes}/${p.positivas}`);
  console.log(`  OMISSAO (nada emitido): ${p.omissoesPositivas}/${p.positivas}`);
  console.log(`  FALSOS POSITIVOS      : ${p.falsosPositivos}/${p.negativas}`);
  console.log(`  erros de infra        : ${p.erros}`);
  return p;
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- medicao: marcador GENERICO de confirmacao pendente ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('Nenhum modulo de producao alterado. confirmacao_pendente NAO existe hoje.');
  console.log(`casos: 3 fluxos x (3 positivas + 3 negativas) x ${REPETICOES} repeticoes = ${FLUXOS.length * 6 * REPETICOES} por variante`);

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const a = await executarVariante(cliente, 'CONTRATO ATUAL (proposta_pendente)', INSTRUCOES_EXTRATOR, 'A');
  const b = await executarVariante(cliente, 'MARCADOR GENERICO (confirmacao_pendente)', instrucoesCandidatas(), 'B');
  const c = await executarVariante(cliente, 'MARCADOR GENERICO + GUARDA DE INTENCAO', instrucoesComGuarda(), 'B');

  console.log('');
  console.log('##### COMPARACAO #####');
  console.log(`  confirmacao correta   : A ${a.confirmacoes}/${a.positivas}  ->  B ${b.confirmacoes}/${b.positivas}  ->  C ${c.confirmacoes}/${c.positivas}`);
  console.log(`  reemissao de intencao : A ${a.reemissoes}/${a.positivas}  ->  B ${b.reemissoes}/${b.positivas}  ->  C ${c.reemissoes}/${c.positivas}`);
  console.log(`  OMISSAO               : A ${a.omissoesPositivas}/${a.positivas}  ->  B ${b.omissoesPositivas}/${b.positivas}  ->  C ${c.omissoesPositivas}/${c.positivas}`);
  console.log(`  FALSOS POSITIVOS      : A ${a.falsosPositivos}/${a.negativas}  ->  B ${b.falsosPositivos}/${b.negativas}  ->  C ${c.falsosPositivos}/${c.negativas}`);
  console.log(`  erros de infra        : A ${a.erros}  ->  B ${b.erros}  ->  C ${c.erros}`);
  console.log(`  retentativas truncacao: ${truncacoes}`);
}

main().catch((erro) => {
  console.error(`erro fatal: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
