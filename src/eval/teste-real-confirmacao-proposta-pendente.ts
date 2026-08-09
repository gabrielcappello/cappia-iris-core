// Runner ISOLADO, avulso, chamado manualmente: prova contra a OpenAI REAL
// que a regra de confirmacao por significado (specs/resposta-conversacional-v1.md
// secao 5) funciona com "proposta_pendente" -- inclusive os casos que o
// runner anterior (teste-real-contexto-horarios.ts) documentou como LACUNA
// CONHECIDA: "esse mesmo" e "pode confirmar" nao confirmavam porque a IA nao
// sabia que havia uma proposta concreta na mesa.
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
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-confirmacao-proposta-pendente.ts

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

interface Caso {
  titulo: string;
  mensagem: string;
  snapshot: SnapshotOficialConversa;
  propostaPendente?: { data: string; horario: string };
  /** null = espera confirmacao AUSENTE do resultado. */
  confirmacaoEsperada: string | null;
}

const APOS_PROPOSTA: SnapshotOficialConversa = { procedimento_id: 'cleaning', data_texto: 'hoje' };
const PROPOSTA = { data: '05/08', horario: '15:00' };

const CASOS: readonly Caso[] = Object.freeze([
  // --- As duas lacunas documentadas no runner anterior como "fora do escopo daquela spec" ---
  { titulo: '"esse mesmo" COM proposta_pendente', mensagem: 'esse mesmo', snapshot: APOS_PROPOSTA, propostaPendente: PROPOSTA, confirmacaoEsperada: 'sim' },
  { titulo: '"pode confirmar" COM proposta_pendente', mensagem: 'pode confirmar', snapshot: APOS_PROPOSTA, propostaPendente: PROPOSTA, confirmacaoEsperada: 'sim' },
  // --- Repertorio nao fechado: variacoes que nunca apareceram como exemplo ---
  { titulo: '"ok" COM proposta_pendente', mensagem: 'ok', snapshot: APOS_PROPOSTA, propostaPendente: PROPOSTA, confirmacaoEsperada: 'sim' },
  { titulo: '"certo" COM proposta_pendente', mensagem: 'certo', snapshot: APOS_PROPOSTA, propostaPendente: PROPOSTA, confirmacaoEsperada: 'sim' },
  { titulo: '"fechado" COM proposta_pendente', mensagem: 'fechado', snapshot: APOS_PROPOSTA, propostaPendente: PROPOSTA, confirmacaoEsperada: 'sim' },
  { titulo: '"pode ser" COM proposta_pendente', mensagem: 'pode ser', snapshot: APOS_PROPOSTA, propostaPendente: PROPOSTA, confirmacaoEsperada: 'sim' },
  // --- Negativo: mesma palavra, SEM proposta_pendente, nunca confirma ---
  { titulo: 'NEGATIVO: "ok" SEM proposta_pendente nunca confirma', mensagem: 'ok', snapshot: APOS_PROPOSTA, confirmacaoEsperada: null },
  { titulo: 'NEGATIVO: "certo" SEM proposta_pendente nunca confirma', mensagem: 'certo', snapshot: APOS_PROPOSTA, confirmacaoEsperada: null },
  // --- Negativo: duvida/pergunta nunca confirma, mesmo com proposta_pendente ---
  { titulo: 'NEGATIVO: pergunta COM proposta_pendente nao confirma', mensagem: 'quanto custa?', snapshot: APOS_PROPOSTA, propostaPendente: PROPOSTA, confirmacaoEsperada: null },
  { titulo: 'NEGATIVO: recusa COM proposta_pendente nao confirma', mensagem: 'nao, prefiro outro dia', snapshot: APOS_PROPOSTA, propostaPendente: PROPOSTA, confirmacaoEsperada: null },
]);

interface ResultadoCaso {
  titulo: string;
  sucesso: boolean;
  confirmacaoObtida: string | undefined;
  bateComEsperado: boolean;
  alteracoes: unknown;
  erro: { tipo: string; codigo: string | null } | null;
  duracao_ms: number;
}

async function executarCaso(cliente: ReturnType<typeof criarClienteModeloOpenAI>, caso: Caso): Promise<ResultadoCaso> {
  const entrada = construirEntradaMinimizada([caso.mensagem], caso.snapshot, undefined, caso.propostaPendente);

  const inicio = Date.now();
  try {
    const saida = await extrairAlteracoes(cliente, entrada);
    const confirmacaoObtida = saida.alteracoes.confirmacao?.valor;
    const bateComEsperado =
      caso.confirmacaoEsperada === null ? confirmacaoObtida === undefined : confirmacaoObtida === caso.confirmacaoEsperada;

    return {
      titulo: caso.titulo,
      sucesso: true,
      confirmacaoObtida,
      bateComEsperado,
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

    return { titulo: caso.titulo, sucesso: false, confirmacaoObtida: undefined, bateComEsperado: false, alteracoes: null, erro: classificado, duracao_ms };
  }
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: confirmacao por significado com proposta_pendente ---');
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

    console.log(`[esperado: ${caso.confirmacaoEsperada ?? 'confirmacao ausente'}] ${caso.titulo}`);
    console.log(`  mensagem: ${JSON.stringify(caso.mensagem)}`);
    console.log(`  proposta_pendente: ${caso.propostaPendente ? JSON.stringify(caso.propostaPendente) : '(ausente)'}`);
    console.log(`  sucesso: ${resultado.sucesso}`);
    if (resultado.sucesso) {
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
