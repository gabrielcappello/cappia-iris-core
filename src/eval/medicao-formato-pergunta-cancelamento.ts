// Runner ISOLADO, avulso: MEDICAO do FORMATO DA PERGUNTA como unica variavel.
// Nenhum modulo de producao e alterado, NENHUM marcador novo, NENHUMA regra de
// prompt nova. O contrato de interpretacao usado e o de PRODUCAO, intacto
// (INSTRUCOES_EXTRATOR + SCHEMA_SAIDA_INTERPRETACAO + `proposta_pendente`).
//
// ── PRINCIPIO DE UX (Gabriel, 2026-08-11) ───────────────────────────────
// A comunicacao com o paciente deve ser MINIMA e NATURAL. Nao existe
// confirmacao dupla: se a Iris faz uma pergunta clara sobre uma acao
// especifica, uma resposta positiva inequivoca JA confirma essa acao.
//
//   Iris:     "Você quer cancelar sua consulta de amanhã às 14h?"
//   Paciente: "Pode cancelar."
//   -> confirmado.
//
// O fluxo nunca vira sequencia burocratica de perguntas. A protecao do Core
// permanece integral: duvida, negacao ou ambiguidade nunca executam acao.
//
// ── O QUE ESTA MEDICAO ISOLA ────────────────────────────────────────────
// Nas medicoes anteriores os tres fluxos tinham FORMATOS DE PERGUNTA
// diferentes no historico, e o unico que terminava pedindo confirmacao de
// forma limpa (novo agendamento, "... Confirma?") foi tambem o unico que
// acertou 3/3 em TODAS as frases, inclusive "pode marcar". Os outros dois
// terminavam de forma mais pesada e falhavam justamente no "pode <verbo>".
//
// Isso era um CONFUNDIDOR, declarado no relatorio anterior. Aqui ele vira a
// VARIAVEL: mesmo contrato, mesmas frases, mesmo agendamento -- so a redacao
// da pergunta muda. Se o formato explicar a diferenca, a correcao e de
// REDACAO (lado da redatora), nunca de parser, marcador ou repertorio.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-formato-pergunta-cancelamento.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { INSTRUCOES_EXTRATOR, SCHEMA_SAIDA_INTERPRETACAO } from '../core/interpretacao-instrucoes.ts';
import type { EntradaInterpretacao } from '../core/interpretacao-tipos.ts';

const PROCEDIMENTOS_DISPONIVEIS = [
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental' },
  { procedimento_id: 'implant', nome_pt: 'Implante dentário' },
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
];
const DENTISTAS_DISPONIVEIS = [
  { dentista_id: 'dent-ana', nome_exibido: 'Dra. Ana Souza' },
  { dentista_id: 'dent-bruno', nome_exibido: 'Dr. Bruno Lima' },
];

// Cenario coerente: HOJE e 19/08; o agendamento e 20/08 as 14:00 -- ou seja,
// literalmente "amanha as 14h". Assim a pergunta natural do exemplo do Gabriel
// e VERDADEIRA, e `proposta_pendente` aponta para o mesmo instante.
const AGORA_ISO = new Date().toISOString();
const PROPOSTA = { data: '2026-08-20', horario: '14:00' };

interface FormatoPergunta {
  rotulo: string;
  texto: string;
}

const FORMATOS: readonly FormatoPergunta[] = Object.freeze([
  {
    // EXATAMENTE o fallback ja implementado hoje em gerar-resposta-paciente.ts.
    // Burocratico: despeja procedimento + profissional + data ISO-BR, e ainda
    // acrescenta um aviso depois da pergunta.
    rotulo: '1 -- ATUAL implementado (burocratico, com aviso apos a pergunta)',
    texto: 'Você quer cancelar Limpeza dental com Dra. Ana Souza — 20/08 às 14:00? Isso não pode ser desfeito.',
  },
  {
    // O EXEMPLO LITERAL do Gabriel: minimo e natural, identifica o agendamento
    // pelo que basta ("sua consulta de amanha as 14h") e TERMINA na pergunta.
    rotulo: '2 -- MINIMO E NATURAL (exemplo literal do Gabriel)',
    texto: 'Você quer cancelar sua consulta de amanhã às 14h?',
  },
  {
    // Natural, mas nomeando o procedimento e a profissional -- para separar
    // "ser natural" de "ser vago". Continua terminando na pergunta, sem aviso.
    rotulo: '3 -- NATURAL nomeando procedimento e profissional',
    texto: 'Você quer cancelar sua limpeza de amanhã às 14h com a Dra. Ana?',
  },
]);

// Contrato de PRODUCAO, intacto: `proposta_pendente` presente, `intencao` ja
// persistida. Nenhum campo novo, nenhuma instrucao alterada.
function montarPayload(perguntaIris: string, mensagem: string): EntradaInterpretacao {
  return {
    mensagens_atuais: [mensagem],
    dados_atuais: { intencao: 'cancelamento' },
    campos_cadastrais_preenchidos: [],
    procedimentos_disponiveis: PROCEDIMENTOS_DISPONIVEIS,
    dentistas_disponiveis: DENTISTAS_DISPONIVEIS,
    proposta_pendente: PROPOSTA,
    historico_recente: [
      {
        mensagem_paciente: 'Preciso cancelar minha consulta',
        resposta_iris: perguntaIris,
        gerada_em: AGORA_ISO,
      },
    ],
  };
}

// "pode cancelar" e o caso do proprio exemplo do Gabriel ("Pode cancelar.").
const POSITIVAS: readonly string[] = ['sim', 'pode', 'pode cancelar', 'ok', 'isso'];
const NEGATIVAS: readonly string[] = ['não', 'por quê?', 'não sei ainda'];

const REPETICOES = 4;
const MAX_RETENTATIVAS_TRUNCACAO = 2;
let truncacoes = 0;

interface Resultado {
  confirmou: boolean;
  reemitiuIntencao: boolean;
  omitiuTudo: boolean;
  erro: boolean;
}

async function observar(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  perguntaIris: string,
  mensagem: string
): Promise<Resultado> {
  for (let tentativa = 0; tentativa <= MAX_RETENTATIVAS_TRUNCACAO; tentativa++) {
    try {
      const saidaBruta = await cliente.executar({
        instrucoes: INSTRUCOES_EXTRATOR,
        schema: SCHEMA_SAIDA_INTERPRETACAO,
        payload: montarPayload(perguntaIris, mensagem),
      });
      const saida = saidaBruta as Record<string, unknown>;
      const alteracoes = (saida.alteracoes ?? {}) as Record<string, { acao?: string; valor?: string } | undefined>;
      const c = alteracoes.confirmacao;
      const i = alteracoes.intencao;
      return {
        confirmou: c !== undefined && c.acao !== 'remover' && c.valor === 'sim',
        reemitiuIntencao: i !== undefined && i.acao !== 'remover',
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
  omissoes: number;
  falsosPositivos: number;
  negativas: number;
  erros: number;
}

async function executarFormato(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  formato: FormatoPergunta
): Promise<Placar> {
  console.log('');
  console.log(`##### FORMATO ${formato.rotulo} #####`);
  console.log(`  Iris: "${formato.texto}"`);
  const p: Placar = {
    confirmacoes: 0,
    positivas: 0,
    reemissoes: 0,
    omissoes: 0,
    falsosPositivos: 0,
    negativas: 0,
    erros: 0,
  };

  for (const mensagem of POSITIVAS) {
    let ok = 0;
    let reemit = 0;
    let omit = 0;
    let err = 0;
    for (let r = 0; r < REPETICOES; r++) {
      const o = await observar(cliente, formato.texto, mensagem);
      p.positivas++;
      if (o.erro) { err++; p.erros++; continue; }
      if (o.confirmou) { ok++; p.confirmacoes++; }
      if (o.reemitiuIntencao) { reemit++; p.reemissoes++; }
      if (o.omitiuTudo) { omit++; p.omissoes++; }
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
      const o = await observar(cliente, formato.texto, mensagem);
      p.negativas++;
      if (o.erro) { err++; p.erros++; continue; }
      if (o.confirmou) { fp++; p.falsosPositivos++; }
    }
    console.log(
      `  ${fp === 0 ? 'OK ' : '!!!'} (neg) "${mensagem}"  falso positivo ${fp}/${REPETICOES}${err > 0 ? ` | erro ${err}` : ''}${fp > 0 ? '  *** PERIGOSO ***' : ''}`
    );
  }

  console.log('');
  console.log(`  confirmacao correta   : ${p.confirmacoes}/${p.positivas}`);
  console.log(`  reemissao de intencao : ${p.reemissoes}/${p.positivas}`);
  console.log(`  omissao               : ${p.omissoes}/${p.positivas}`);
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

  console.log('--- medicao: FORMATO DA PERGUNTA como unica variavel (cancelamento) ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('Contrato de interpretacao: PRODUCAO INTACTO. Zero marcador novo, zero regra nova.');
  console.log('A pergunta da Iris E a confirmacao -- nao existe segunda pergunta.');
  console.log(`casos: ${POSITIVAS.length} positivas + ${NEGATIVAS.length} negativas x ${REPETICOES} repeticoes = ${(POSITIVAS.length + NEGATIVAS.length) * REPETICOES} por formato`);

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const placares: Placar[] = [];
  for (const formato of FORMATOS) {
    placares.push(await executarFormato(cliente, formato));
  }

  console.log('');
  console.log('##### COMPARACAO #####');
  FORMATOS.forEach((formato, i) => {
    const p = placares[i]!;
    console.log(
      `  ${formato.rotulo}\n     confirmacao ${p.confirmacoes}/${p.positivas} | reemissao ${p.reemissoes} | omissao ${p.omissoes} | FALSOS POSITIVOS ${p.falsosPositivos}/${p.negativas} | erros ${p.erros}`
    );
  });
  console.log(`  retentativas por truncacao: ${truncacoes}`);
}

main().catch((erro) => {
  console.error(`erro fatal: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
