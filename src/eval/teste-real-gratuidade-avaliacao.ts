// Runner ISOLADO, avulso, chamado manualmente: prova contra a OpenAI REAL
// que a IA REDATORA usa "precos.gratuitos" com naturalidade
// (specs/catalogo-avaliacao-obrigatoria-gratuita-v1.md secao 4) -- informa
// gratuidade quando presente, nunca inventa valor "R$ 0", e nao confunde
// gratuito com "sob_avaliacao" (que significa outra coisa: preco existe mas
// nao foi liberado).
//
// Mensagens sinteticas e ficticias (nenhum paciente real, nenhuma clinica
// real). Os FATOS sao simulados diretamente aqui -- este runner nao chama o
// orquestrador nem o banco, so a redatora.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-gratuidade-avaliacao.ts

import { criarClienteModeloRedatorOpenAI, ErroClienteModeloRedator, TIMEOUT_REDATOR_MS_APROVADO } from '../core/cliente-modelo-redator-openai.ts';
import { INSTRUCOES_REDATOR } from '../core/redator-instrucoes.ts';
import { verificarRespostaRedatora } from '../core/guarda-resposta-redatora.ts';
import { MODELO_GPT_4_1_MINI } from '../core/cliente-modelo-openai.ts';
import type { FatosAutorizados } from '../core/fatos-autorizados.ts';
import type { NaturezaMensagem } from '../core/interpretacao-tipos.ts';

interface Caso {
  titulo: string;
  mensagemPaciente: string;
  naturezaMensagem: NaturezaMensagem;
  fatos: FatosAutorizados;
  verificarTexto: (texto: string) => { ok: boolean; motivo?: string };
}

const MENCIONA_GRATUITO = /gratuit|sem custo|n[aã]o (tem|cobra)/i;
const MENCIONA_VALOR_NUMERICO = /r\$\s*0(?!\d)|r\$\s*\d/i;
const MENCIONA_SOB_AVALIACAO = /depende (de uma |d[aeo] )?avalia[cç][aã]o|precisa (de )?uma avalia[cç][aã]o para saber/i;

const CASOS: readonly Caso[] = Object.freeze([
  // Cenario 1 (spec secao 4): paciente pergunta preco da avaliacao, que
  // esta marcada gratuita -> redatora informa gratuidade, sem inventar
  // valor nem tratar como "sob_avaliacao".
  {
    titulo: '1. avaliacao gratuita: informa gratuidade, nunca "R$ 0" nem "depende de avaliacao"',
    mensagemPaciente: 'quanto custa a avaliação?',
    naturezaMensagem: 'duvida',
    fatos: { objetivo: 'acolher_e_retomar', precos: { gratuitos: ['Consulta / Avaliação'] } },
    verificarTexto: (texto) => {
      const gratuito = MENCIONA_GRATUITO.test(texto);
      const valorNumerico = MENCIONA_VALOR_NUMERICO.test(texto);
      const sobAvaliacao = MENCIONA_SOB_AVALIACAO.test(texto);
      if (!gratuito) return { ok: false, motivo: 'nao mencionou gratuidade' };
      if (valorNumerico) return { ok: false, motivo: 'mencionou valor numerico (ex.: R$ 0) para item gratuito' };
      if (sobAvaliacao) return { ok: false, motivo: 'tratou item gratuito como "depende de avaliacao"' };
      return { ok: true };
    },
  },
  // Cenario 2 (spec secao 4): outro procedimento nao liberado (sob_avaliacao,
  // sem gratuitos) -> comportamento de hoje preservado, sem confundir com
  // gratuidade.
  {
    titulo: '2. procedimento nao liberado (sem gratuitos): continua "depende de avaliacao", nunca "gratuito"',
    mensagemPaciente: 'quanto custa o canal?',
    naturezaMensagem: 'duvida',
    fatos: { objetivo: 'acolher_e_retomar', precos: { sob_avaliacao: ['Canal molar (3+ raízes)'] } },
    verificarTexto: (texto) => {
      const gratuito = MENCIONA_GRATUITO.test(texto);
      const sobAvaliacao = MENCIONA_SOB_AVALIACAO.test(texto);
      if (gratuito) return { ok: false, motivo: 'chamou de gratuito um procedimento so sob_avaliacao' };
      if (!sobAvaliacao) return { ok: false, motivo: 'nao explicou que depende de avaliacao' };
      return { ok: true };
    },
  },
  // Negativo adicional: os dois fatos juntos -- gratuito e sob_avaliacao
  // coexistindo, cada procedimento tratado corretamente pelo seu proprio fato.
  {
    titulo: '3. gratuitos e sob_avaliacao juntos: cada procedimento tratado pelo fato certo',
    mensagemPaciente: 'quanto custa a avaliação e o canal?',
    naturezaMensagem: 'duvida',
    fatos: {
      objetivo: 'acolher_e_retomar',
      precos: { gratuitos: ['Consulta / Avaliação'], sob_avaliacao: ['Canal molar (3+ raízes)'] },
    },
    verificarTexto: (texto) => {
      const gratuito = MENCIONA_GRATUITO.test(texto);
      const sobAvaliacao = MENCIONA_SOB_AVALIACAO.test(texto);
      if (!gratuito) return { ok: false, motivo: 'nao mencionou gratuidade da avaliacao' };
      if (!sobAvaliacao) return { ok: false, motivo: 'nao explicou que o canal depende de avaliacao' };
      return { ok: true };
    },
  },
]);

interface ResultadoCaso {
  titulo: string;
  sucesso: boolean;
  texto: string | null;
  guardaAprovou: boolean | null;
  guardaMotivo: string | null;
  verificacaoTextoOk: boolean | null;
  verificacaoTextoMotivo: string | undefined;
  erro: string | null;
  duracao_ms: number;
}

async function executarCaso(cliente: ReturnType<typeof criarClienteModeloRedatorOpenAI>, caso: Caso): Promise<ResultadoCaso> {
  const inicio = Date.now();
  try {
    const texto = await cliente.redigir({
      instrucoes: INSTRUCOES_REDATOR,
      mensagemPaciente: caso.mensagemPaciente,
      naturezaMensagem: caso.naturezaMensagem,
      fatos: caso.fatos,
    });
    const resultadoGuarda = verificarRespostaRedatora(texto, caso.fatos);
    const verificacao = caso.verificarTexto(texto);

    return {
      titulo: caso.titulo,
      sucesso: true,
      texto,
      guardaAprovou: resultadoGuarda.aprovado,
      guardaMotivo: resultadoGuarda.aprovado ? null : resultadoGuarda.motivo,
      verificacaoTextoOk: verificacao.ok,
      verificacaoTextoMotivo: verificacao.motivo,
      erro: null,
      duracao_ms: Date.now() - inicio,
    };
  } catch (erro) {
    const codigo = erro instanceof ErroClienteModeloRedator ? erro.codigo : erro instanceof Error ? erro.message : 'erro_desconhecido';
    return {
      titulo: caso.titulo,
      sucesso: false,
      texto: null,
      guardaAprovou: null,
      guardaMotivo: null,
      verificacaoTextoOk: null,
      verificacaoTextoMotivo: undefined,
      erro: codigo,
      duracao_ms: Date.now() - inicio,
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

  console.log('--- teste real: gratuidade de procedimento (specs/catalogo-avaliacao-obrigatoria-gratuita-v1.md) ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log(`total de casos: ${CASOS.length}`);
  console.log('');

  const cliente = criarClienteModeloRedatorOpenAI({ chaveApi, modelo: MODELO_GPT_4_1_MINI, timeoutMs: TIMEOUT_REDATOR_MS_APROVADO });

  const resultados: ResultadoCaso[] = [];
  for (const caso of CASOS) {
    const resultado = await executarCaso(cliente, caso);
    resultados.push(resultado);

    console.log(caso.titulo);
    console.log(`  mensagem paciente: ${JSON.stringify(caso.mensagemPaciente)}`);
    console.log(`  fatos: ${JSON.stringify(caso.fatos)}`);
    console.log(`  sucesso da chamada: ${resultado.sucesso}`);
    if (resultado.sucesso) {
      console.log(`  texto: ${resultado.texto}`);
      console.log(`  guarda aprovou: ${resultado.guardaAprovou}${resultado.guardaMotivo ? ` (motivo: ${resultado.guardaMotivo})` : ''}`);
      console.log(`  verificacao adicional: ${resultado.verificacaoTextoOk}${resultado.verificacaoTextoMotivo ? ` (${resultado.verificacaoTextoMotivo})` : ''}`);
    } else {
      console.log(`  erro: ${resultado.erro}`);
    }
    console.log(`  duracao: ${resultado.duracao_ms}ms`);
    console.log('');
  }

  const passou = resultados.filter((r) => r.sucesso && r.guardaAprovou === true && r.verificacaoTextoOk === true).length;

  console.log('--- resumo ---');
  console.log(`${passou}/${CASOS.length}`);
  if (passou !== CASOS.length) {
    console.log('');
    console.log('falharam:');
    for (const r of resultados.filter((x) => !(x.sucesso && x.guardaAprovou === true && x.verificacaoTextoOk === true))) {
      console.log(`  - ${r.titulo}`);
    }
  }

  process.exitCode = passou === CASOS.length ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
