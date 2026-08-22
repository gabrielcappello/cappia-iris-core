// Runner ISOLADO, avulso, chamado manualmente: prova contra a OpenAI REAL
// que a IA REDATORA usa "paciente_novo_na_clinica" com naturalidade
// (specs/recomendacao-avaliacao-paciente-novo-v1.md secao 6, cenarios 6-9) --
// explica a metodologia SO quando o paciente novo esta em duvida real, nunca
// quando ja sabe o que quer, e sem repetir a explicacao de forma mecanica no
// mesmo historico.
//
// Mensagens sinteticas e ficticias (nenhum paciente real, nenhuma clinica
// real). O FATO "paciente_novo_na_clinica" e simulado diretamente aqui --
// este runner nao chama o orquestrador nem o banco, so a redatora.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-paciente-novo.ts

import { criarClienteModeloRedatorOpenAI, ErroClienteModeloRedator, TIMEOUT_REDATOR_MS_APROVADO } from '../core/cliente-modelo-redator-openai.ts';
import { INSTRUCOES_REDATOR } from '../core/redator-instrucoes.ts';
import { verificarRespostaRedatora } from '../core/guarda-resposta-redatora.ts';
import { MODELO_GPT_4_1_MINI } from '../core/cliente-modelo-openai.ts';
import type { FatosAutorizados } from '../core/fatos-autorizados.ts';
import type { NaturezaMensagem } from '../core/interpretacao-tipos.ts';
import type { ParConversa } from '../core/tipos.ts';

interface Caso {
  titulo: string;
  mensagemPaciente: string;
  naturezaMensagem: NaturezaMensagem;
  fatos: FatosAutorizados;
  historicoRecente?: ParConversa[];
  /** Verificacao adicional sobre o TEXTO (nunca substitui a guarda -- soma a ela). */
  verificarTexto: (texto: string) => { ok: boolean; motivo?: string };
}

function historicoDeUmTurno(mensagemPaciente: string, respostaIris: string): ParConversa[] {
  return [{ mensagem_paciente: mensagemPaciente, resposta_iris: respostaIris, gerada_em: new Date().toISOString() }];
}

const MENCIONA_AVALIACAO = /avalia[cç][aã]o/i;
const MENCIONA_PRIMEIRA_VEZ = /primeira (vez|consulta)|nunca (veio|esteve)|novo (aqui|na cl[ií]nica)/i;

const CASOS: readonly Caso[] = Object.freeze([
  // Cenario 6 (spec secao 6): paciente novo, duvida real -- sugere avaliacao
  // e explica o motivo.
  {
    titulo: '6. paciente novo, duvida real: sugere avaliacao e explica a metodologia',
    mensagemPaciente: 'sinto uma dor no dente, não sei o que é',
    naturezaMensagem: 'duvida',
    fatos: { objetivo: 'pedir_procedimento', dados_faltantes: ['procedimento'], paciente_novo_na_clinica: true },
    verificarTexto: (texto) => {
      const mencionaAvaliacao = MENCIONA_AVALIACAO.test(texto);
      return {
        ok: mencionaAvaliacao,
        motivo: mencionaAvaliacao ? undefined : 'nao mencionou avaliacao para paciente novo em duvida',
      };
    },
  },
  // Cenario 7 (spec secao 6): paciente novo, mas ja sabe o procedimento --
  // NAO deve mencionar avaliacao nem explicar metodologia.
  {
    titulo: '7. paciente novo, ja sabe o procedimento: NAO menciona avaliacao nem metodologia',
    mensagemPaciente: 'quero marcar uma limpeza',
    naturezaMensagem: 'pedido',
    fatos: { objetivo: 'pedir_data_ou_horario', dados_faltantes: ['data'], paciente_novo_na_clinica: true },
    verificarTexto: (texto) => {
      const mencionaMetodologia = MENCIONA_PRIMEIRA_VEZ.test(texto);
      return {
        ok: !mencionaMetodologia,
        motivo: mencionaMetodologia ? 'mencionou "primeira vez"/metodologia sem necessidade -- paciente ja sabia o que queria' : undefined,
      };
    },
  },
  // Cenario 8 (spec secao 6, observacao -- nao e garantia testavel de
  // "exatamente uma vez"): com o historico ja mostrando a explicacao dada,
  // a redatora tende a nao repetir de forma mecanica.
  {
    titulo: '8. paciente novo, ja explicado no historico: nao repete a metodologia de forma mecanica',
    mensagemPaciente: 'e demora quanto tempo a avaliação?',
    naturezaMensagem: 'duvida',
    fatos: { objetivo: 'pedir_procedimento', dados_faltantes: ['procedimento'], paciente_novo_na_clinica: true },
    historicoRecente: historicoDeUmTurno(
      'sinto uma dor no dente, não sei o que é',
      'Como é a primeira vez que você vem aqui, o ideal é começar com uma avaliação: o dentista examina, define o tratamento e depois organizamos os próximos passos juntos. Posso agendar essa avaliação?'
    ),
    verificarTexto: (texto) => {
      const repetiuMetodologiaInteira = /o dentista examina.*define o tratamento/is.test(texto);
      return {
        ok: !repetiuMetodologiaInteira,
        motivo: repetiuMetodologiaInteira ? 'repetiu a explicacao completa da metodologia de novo' : undefined,
      };
    },
  },
  // Cenario 9 (spec secao 6): paciente NAO novo, mesma duvida -- pode cair em
  // avaliacao pela regra de duvida real, mas SEM a explicacao de "primeira
  // consulta" (o fato nao esta disponivel).
  {
    titulo: '9. paciente NAO novo, mesma duvida: sem explicacao de "primeira consulta" (fato ausente)',
    mensagemPaciente: 'sinto uma dor no dente, não sei o que é',
    naturezaMensagem: 'duvida',
    fatos: { objetivo: 'pedir_procedimento', dados_faltantes: ['procedimento'] },
    verificarTexto: (texto) => {
      const mencionouPrimeiraVez = MENCIONA_PRIMEIRA_VEZ.test(texto);
      return {
        ok: !mencionouPrimeiraVez,
        motivo: mencionouPrimeiraVez ? 'mencionou "primeira vez" sem o fato paciente_novo_na_clinica estar presente' : undefined,
      };
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
      ...(caso.historicoRecente !== undefined ? { historicoRecente: caso.historicoRecente } : {}),
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

  console.log('--- teste real: paciente_novo_na_clinica (specs/recomendacao-avaliacao-paciente-novo-v1.md) ---');
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
