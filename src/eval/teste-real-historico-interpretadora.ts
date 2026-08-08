// Runner ISOLADO, avulso, chamado manualmente: prova contra a OpenAI REAL
// que a IA INTERPRETADORA, recebendo "historico_recente"
// (specs/historico-conversacional-v1.md secao 6), entende mensagens curtas
// dependentes de contexto -- reproducao OBRIGATORIA do caso real que falhou
// no WhatsApp em 2026-08-07: "Sim", isolado, foi classificado como
// nao_compreendida porque a interpretadora nao sabia a que pergunta o
// paciente estava respondendo.
//
// Mensagens: todas sinteticas e ficticias (nenhum paciente real, nenhum
// telefone, nenhuma clinica real).
//
// Chave: somente via variavel de ambiente OPENAI_API_KEY (a mesma ja
// validada no cofre canonico, .iris-secrets/openai.env), carregada
// exclusivamente por `node --env-file`. Este arquivo nunca abre, le,
// imprime ou edita nada dentro de .iris-secrets.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-historico-interpretadora.ts

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
import type { ParConversa } from '../core/tipos.ts';

interface Caso {
  titulo: string;
  mensagem: string;
  snapshot: SnapshotOficialConversa;
  propostaPendente?: { data: string; horario: string };
  historicoRecente?: ParConversa[];
  /** null = espera confirmacao AUSENTE do resultado. */
  confirmacaoEsperada: string | null;
  /** Quando definido, tambem verifica natureza_mensagem exatamente. */
  naturezaEsperada?: string;
}

function historico(respostaIris: string, mensagemPaciente = 'quero limpeza amanha de tarde'): ParConversa[] {
  return [{ mensagem_paciente: mensagemPaciente, resposta_iris: respostaIris, gerada_em: new Date(Date.now() - 60_000).toISOString() }];
}

const APOS_PROPOSTA: SnapshotOficialConversa = { procedimento_texto: 'limpeza', data_texto: 'amanha' };
const PROPOSTA = { data: '06/08', horario: '14:00' };
const PERGUNTA_CONFIRMACAO = 'Posso confirmar sua limpeza para amanhã às 14h?';

const CASOS: readonly Caso[] = Object.freeze([
  // --- O caso real que falhou no WhatsApp (2026-08-07): reproducao obrigatoria ---
  {
    titulo: 'CASO REAL: "Sim" isolado, COM historico terminando na pergunta de confirmacao e proposta_pendente',
    mensagem: 'Sim',
    snapshot: APOS_PROPOSTA,
    propostaPendente: PROPOSTA,
    historicoRecente: historico(PERGUNTA_CONFIRMACAO),
    confirmacaoEsperada: 'sim',
  },
  { titulo: '"Pode ser" COM historico + proposta_pendente', mensagem: 'Pode ser', snapshot: APOS_PROPOSTA, propostaPendente: PROPOSTA, historicoRecente: historico(PERGUNTA_CONFIRMACAO), confirmacaoEsperada: 'sim' },
  { titulo: '"Isso mesmo" COM historico + proposta_pendente', mensagem: 'Isso mesmo', snapshot: APOS_PROPOSTA, propostaPendente: PROPOSTA, historicoRecente: historico(PERGUNTA_CONFIRMACAO), confirmacaoEsperada: 'sim' },
  { titulo: '"Fechado" COM historico + proposta_pendente', mensagem: 'Fechado', snapshot: APOS_PROPOSTA, propostaPendente: PROPOSTA, historicoRecente: historico(PERGUNTA_CONFIRMACAO), confirmacaoEsperada: 'sim' },

  // --- NEGATIVO: sem nenhum contexto, "Sim" isolado continua ambiguo ---
  {
    titulo: 'NEGATIVO: "Sim" isolado SEM historico e SEM proposta_pendente continua nao_compreendida',
    mensagem: 'Sim',
    snapshot: {},
    confirmacaoEsperada: null,
    naturezaEsperada: 'nao_compreendida',
  },

  // --- NEGATIVO: historico presente mas sobre OUTRO assunto (procedimento, nao confirmacao) ---
  {
    titulo: 'NEGATIVO: historico sobre procedimento (nao confirmacao) + "Sim" nao emite confirmacao=sim',
    mensagem: 'Sim',
    snapshot: {},
    historicoRecente: historico('Qual procedimento você gostaria de agendar?', 'oi'),
    confirmacaoEsperada: null,
  },

  // --- Referencia a turno anterior nao-adjacente (prova que N=10 tem valor sobre N=1) ---
  {
    titulo: 'continuidade: confirmacao explicita que so faz sentido lendo o historico de 8 pares (nao so o ultimo)',
    mensagem: 'pode confirmar sim, obrigado por aguardar',
    snapshot: APOS_PROPOSTA,
    propostaPendente: PROPOSTA,
    historicoRecente: [
      { mensagem_paciente: 'oi', resposta_iris: 'Oi! Como posso ajudar?', gerada_em: new Date(Date.now() - 8 * 60_000).toISOString() },
      { mensagem_paciente: 'quero marcar uma limpeza', resposta_iris: 'Perfeito! Pra quando você quer?', gerada_em: new Date(Date.now() - 7 * 60_000).toISOString() },
      { mensagem_paciente: 'amanha de tarde', resposta_iris: 'Tenho 14:00 disponível amanhã à tarde.', gerada_em: new Date(Date.now() - 6 * 60_000).toISOString() },
      { mensagem_paciente: 'deixa eu ver minha agenda', resposta_iris: 'Sem pressa! Me avisa quando puder.', gerada_em: new Date(Date.now() - 5 * 60_000).toISOString() },
      { mensagem_paciente: 'voces fazem clareamento tambem?', resposta_iris: 'Fazemos sim! Quer que eu inclua no mesmo agendamento?', gerada_em: new Date(Date.now() - 4 * 60_000).toISOString() },
      { mensagem_paciente: 'nao, so a limpeza mesmo', resposta_iris: 'Combinado, só a limpeza então.', gerada_em: new Date(Date.now() - 3 * 60_000).toISOString() },
      { mensagem_paciente: 'ainda hoje da pra confirmar?', resposta_iris: 'Consigo confirmar agora, sem problema.', gerada_em: new Date(Date.now() - 2 * 60_000).toISOString() },
      { mensagem_paciente: 'ok entao', resposta_iris: PERGUNTA_CONFIRMACAO, gerada_em: new Date(Date.now() - 60_000).toISOString() },
    ],
    confirmacaoEsperada: 'sim',
  },
]);

interface ResultadoCaso {
  titulo: string;
  sucesso: boolean;
  confirmacaoObtida: string | undefined;
  naturezaObtida: string | undefined;
  bateComEsperado: boolean;
  alteracoes: unknown;
  erro: { tipo: string; codigo: string | null } | null;
  duracao_ms: number;
}

async function executarCaso(cliente: ReturnType<typeof criarClienteModeloOpenAI>, caso: Caso): Promise<ResultadoCaso> {
  const entrada = construirEntradaMinimizada([caso.mensagem], caso.snapshot, undefined, caso.propostaPendente, caso.historicoRecente);

  const inicio = Date.now();
  try {
    const saida = await extrairAlteracoes(cliente, entrada);
    const confirmacaoObtida = saida.alteracoes.confirmacao?.valor;
    const confirmacaoBate =
      caso.confirmacaoEsperada === null ? confirmacaoObtida === undefined : confirmacaoObtida === caso.confirmacaoEsperada;
    const naturezaBate = caso.naturezaEsperada === undefined || saida.natureza_mensagem === caso.naturezaEsperada;

    return {
      titulo: caso.titulo,
      sucesso: true,
      confirmacaoObtida,
      naturezaObtida: saida.natureza_mensagem,
      bateComEsperado: confirmacaoBate && naturezaBate,
      alteracoes: saida.alteracoes,
      erro: null,
      duracao_ms: Date.now() - inicio,
    };
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

    return { titulo: caso.titulo, sucesso: false, confirmacaoObtida: undefined, naturezaObtida: undefined, bateComEsperado: false, alteracoes: null, erro: classificado, duracao_ms };
  }
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: historico_recente na IA interpretadora (reproducao do bug "Sim" isolado, WhatsApp 2026-08-07) ---');
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

    console.log(`[esperado: confirmacao=${caso.confirmacaoEsperada ?? 'ausente'}${caso.naturezaEsperada ? `, natureza=${caso.naturezaEsperada}` : ''}] ${caso.titulo}`);
    console.log(`  mensagem: ${JSON.stringify(caso.mensagem)}`);
    console.log(`  historico_recente: ${caso.historicoRecente ? `${caso.historicoRecente.length} par(es)` : '(ausente)'}`);
    console.log(`  proposta_pendente: ${caso.propostaPendente ? JSON.stringify(caso.propostaPendente) : '(ausente)'}`);
    console.log(`  sucesso: ${resultado.sucesso}`);
    if (resultado.sucesso) {
      console.log(`  natureza_mensagem obtida: ${resultado.naturezaObtida}`);
      console.log(`  confirmacao obtida: ${resultado.confirmacaoObtida ?? '(ausente)'}`);
      console.log(`  bate com esperado: ${resultado.bateComEsperado}`);
      console.log(`  alteracoes completas: ${JSON.stringify(resultado.alteracoes)}`);
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
