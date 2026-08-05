// Runner ISOLADO, avulso, chamado manualmente: prova que a IA real
// (mesmo cliente, mesmas instrucoes, mesmo schema aprovado que
// interpretarEAplicar ja usa em producao) normaliza expressoes de horario
// inequivocas para HH:MM em 24h, sem inventar nem inferir horario ausente,
// e omite horario_texto em duvida real -- mesma disciplina de
// teste-real-mensagens-simples-extrator.ts.
//
// Motivacao (achado real via WhatsApp, 2026-08-05): "15 hrs" preservado
// verbatim pela IA nunca batia no regex HH:MM/HHh[MM] de
// montar-fatos-temporais.ts (nao alterado por este runner nem pela
// correcao que ele prova) -- o horario pedido pelo paciente era
// silenciosamente perdido, e a Iris repetia a mesma grade de horarios.
// A correcao muda so a instrucao (interpretacao-instrucoes.ts): a IA
// passa a normalizar o formato antes de o Core validar, nunca o Core
// tentando reconhecer mais formatos de texto livre.
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
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-normalizacao-horario.ts

import {
  criarClienteModeloOpenAI,
  ErroClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { extrairAlteracoes } from '../core/interpretacao-extrator.ts';
import { InterpretacaoInvalidaError, EntradaInvalidaError } from '../core/erros.ts';

interface CasoHorario {
  titulo: string;
  mensagens_atuais: string[];
  // null = espera que horario_texto fique AUSENTE do resultado (duvida real).
  horarioEsperado: string | null;
}

// Fixo, nunca aceito por argv/stdin/env -- mesmo espirito de
// execucao-real-sintetica-adaptador-openai.ts (payload congelado no
// codigo, para impedir troca acidental por dado real). Os 6 exemplos
// obrigatorios de Gabriel + 1 prova negativa (horario genuinamente
// ambiguo entre 3:00 e 15:00, sem parte do dia clara).
const CASOS: readonly CasoHorario[] = Object.freeze([
  { titulo: '15h', mensagens_atuais: ['Quero marcar uma limpeza às 15h.'], horarioEsperado: '15:00' },
  { titulo: '15 hrs', mensagens_atuais: ['Quero marcar uma limpeza às 15 hrs.'], horarioEsperado: '15:00' },
  { titulo: '15 horas', mensagens_atuais: ['Quero marcar uma limpeza às 15 horas.'], horarioEsperado: '15:00' },
  { titulo: 'às 15', mensagens_atuais: ['Quero marcar uma limpeza às 15.'], horarioEsperado: '15:00' },
  { titulo: 'quinze horas', mensagens_atuais: ['Quero marcar uma limpeza às quinze horas.'], horarioEsperado: '15:00' },
  { titulo: '15:30 (ja normalizado)', mensagens_atuais: ['Quero marcar uma limpeza às 15:30.'], horarioEsperado: '15:30' },
  {
    titulo: 'horario ambiguo (prova negativa: nunca inventa, omite em duvida real)',
    mensagens_atuais: ['Quero marcar uma limpeza. Acho que umas 3, mas não sei se é de manhã ou de tarde.'],
    horarioEsperado: null,
  },
]);

interface ResultadoCaso {
  titulo: string;
  sucesso: boolean;
  horarioObtido: string | undefined;
  bateComEsperado: boolean;
  alteracoes: unknown;
  erro: { tipo: string; codigo: string | null; caminho_ou_campo: string | null } | null;
  duracao_ms: number;
}

async function executarCaso(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  caso: CasoHorario
): Promise<ResultadoCaso> {
  const entrada = {
    mensagens_atuais: caso.mensagens_atuais,
    dados_atuais: {},
    campos_cadastrais_preenchidos: [],
  };

  const inicio = Date.now();
  try {
    const saida = await extrairAlteracoes(cliente, entrada);
    const alteracaoHorario = saida.alteracoes.horario_texto;
    const horarioObtido = alteracaoHorario?.valor;
    const bateComEsperado =
      caso.horarioEsperado === null ? alteracaoHorario === undefined : horarioObtido === caso.horarioEsperado;
    return {
      titulo: caso.titulo,
      sucesso: true,
      horarioObtido,
      bateComEsperado,
      alteracoes: saida.alteracoes,
      erro: null,
      duracao_ms: Date.now() - inicio,
    };
  } catch (erro) {
    const duracao_ms = Date.now() - inicio;
    if (erro instanceof ErroClienteModeloOpenAI) {
      return {
        titulo: caso.titulo,
        sucesso: false,
        horarioObtido: undefined,
        bateComEsperado: false,
        alteracoes: null,
        erro: { tipo: 'ErroClienteModeloOpenAI', codigo: `${erro.categoria}/${erro.codigo}`, caminho_ou_campo: null },
        duracao_ms,
      };
    }
    if (erro instanceof InterpretacaoInvalidaError) {
      return {
        titulo: caso.titulo,
        sucesso: false,
        horarioObtido: undefined,
        bateComEsperado: false,
        alteracoes: null,
        erro: { tipo: 'InterpretacaoInvalidaError', codigo: erro.codigo, caminho_ou_campo: erro.caminho },
        duracao_ms,
      };
    }
    if (erro instanceof EntradaInvalidaError) {
      return {
        titulo: caso.titulo,
        sucesso: false,
        horarioObtido: undefined,
        bateComEsperado: false,
        alteracoes: null,
        erro: { tipo: 'EntradaInvalidaError', codigo: null, caminho_ou_campo: erro.campo },
        duracao_ms,
      };
    }
    return {
      titulo: caso.titulo,
      sucesso: false,
      horarioObtido: undefined,
      bateComEsperado: false,
      alteracoes: null,
      erro: { tipo: 'erro_nao_classificado', codigo: null, caminho_ou_campo: null },
      duracao_ms,
    };
  }
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: normalizacao de horario (extrator + adaptador OpenAI) ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log(`OPENAI_API_KEY: presente (valor nunca exibido)`);
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

    console.log(`[esperado: ${caso.horarioEsperado ?? 'ausente'}] ${resultado.titulo}`);
    console.log(`  mensagem: ${JSON.stringify(caso.mensagens_atuais)}`);
    console.log(`  sucesso: ${resultado.sucesso}`);
    if (resultado.sucesso) {
      console.log(`  horario_texto obtido: ${resultado.horarioObtido ?? '(ausente)'}`);
      console.log(`  bate com esperado: ${resultado.bateComEsperado}`);
      console.log(`  alteracoes completas: ${JSON.stringify(resultado.alteracoes)}`);
    } else if (resultado.erro) {
      console.log(`  erro: ${resultado.erro.tipo} codigo=${resultado.erro.codigo} caminho_ou_campo=${resultado.erro.caminho_ou_campo}`);
    }
    console.log(`  duracao: ${resultado.duracao_ms}ms`);
    console.log('');
  }

  const totalCorreto = resultados.filter((r) => r.sucesso && r.bateComEsperado).length;
  console.log('--- resumo ---');
  console.log(`correto: ${totalCorreto}/${resultados.length}`);
  process.exitCode = totalCorreto === resultados.length ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
