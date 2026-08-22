// Runner ISOLADO, avulso, chamado manualmente: prova contra a OpenAI REAL
// que, ao pedir o procedimento, a redatora usa o catalogo REAL da clinica
// (nunca exemplos genericos) e oferece Avaliacao com naturalidade quando o
// paciente nao sabe o que quer -- sem despejar a lista inteira.
//
// Motivado por teste real de WhatsApp (2026-08-22, Gabriel/Cleardent): "quero
// agendar um turno para segunda-feira" -> Iris respondeu "limpeza dental,
// restauracao, extracao, entre outros", sem mencionar Avaliacao mesmo ativa
// no catalogo -- porque o catalogo real nunca chegava a redatora nessa
// decisao.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-catalogo-pedir-procedimento.ts

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

// Catalogo REAL da Cleardent (recorte, mesmos nomes de procedimentos-catalogo).
const CATALOGO_CLEARDENT = [
  'Consulta / Avaliação',
  'Limpeza dental (profilaxia)',
  'Restauração / Cárie (1 face)',
  'Extração simples',
];

const MENCIONA_AVALIACAO = /avalia[cç][aã]o/i;
const MENCIONA_LIMPEZA = /limpeza/i;
const MENCIONA_RESTAURACAO = /restaura[cç][aã]o/i;
const MENCIONA_EXTRACAO = /extra[cç][aã]o/i;

const CASOS: readonly Caso[] = Object.freeze([
  {
    titulo: 'REAL (WhatsApp 2026-08-22): pede agendamento sem dizer procedimento -> so o nome unico da avaliacao chega, nunca a lista',
    mensagemPaciente: 'quero agendar um turno para segunda feira',
    naturezaMensagem: 'pedido',
    fatos: { objetivo: 'pedir_procedimento', dados_faltantes: ['procedimento'], procedimento_avaliacao_disponivel: 'Consulta / Avaliação' },
    verificarTexto: (texto) => {
      const avaliacao = MENCIONA_AVALIACAO.test(texto);
      const mencionouOutro = [MENCIONA_LIMPEZA, MENCIONA_RESTAURACAO, MENCIONA_EXTRACAO].some((r) => r.test(texto));
      if (!avaliacao) return { ok: false, motivo: 'nao ofereceu avaliacao para paciente sem procedimento definido' };
      if (mencionouOutro) return { ok: false, motivo: 'mencionou outro procedimento que nao estava nos fatos (alucinacao)' };
      return { ok: true };
    },
  },
  {
    titulo: 'paciente pede para ver as opcoes: recebe a lista completa (duvida_livre), pode listar',
    mensagemPaciente: 'quais procedimentos vocês fazem?',
    naturezaMensagem: 'duvida',
    fatos: { objetivo: 'acolher_e_retomar', procedimentos_ativos_da_clinica: CATALOGO_CLEARDENT },
    verificarTexto: (texto) => {
      const mencionaAlgumDoCatalogo = CATALOGO_CLEARDENT.some((p) => texto.toLowerCase().includes(p.toLowerCase().split(' ')[0]!));
      return {
        ok: mencionaAlgumDoCatalogo,
        motivo: mencionaAlgumDoCatalogo ? undefined : 'nao mencionou nenhum procedimento do catalogo real ao ser perguntado diretamente',
      };
    },
  },
  {
    titulo: 'NEGATIVO: sem nenhum dos dois fatos -- nao pode inventar nomes especificos do catalogo real',
    mensagemPaciente: 'quero agendar um horário',
    naturezaMensagem: 'pedido',
    fatos: { objetivo: 'pedir_procedimento', dados_faltantes: ['procedimento'] },
    verificarTexto: (texto) => {
      const inventouNomeEspecifico = CATALOGO_CLEARDENT.some((p) => texto.includes(p));
      return {
        ok: !inventouNomeEspecifico,
        motivo: inventouNomeEspecifico ? 'mencionou nome exato do catalogo sem o fato estar presente' : undefined,
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

  console.log('--- teste real: catalogo real ao pedir procedimento ---');
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
