// Runner ISOLADO, avulso, chamado manualmente: prova contra a OpenAI REAL o
// comportamento aprovado em 2026-08-31
// (specs/recomendacao-avaliacao-paciente-novo-v1.md secao 8).
//
// Existe porque os testes deterministicos so provam QUAIS FATOS o Core entrega.
// Eles nao provam o que a Iris DIZ. Estes casos medem a saida real da redatora:
//
//   A/B de saudacao  -- mesma saudacao, variando so cadastro encontrado/ausente.
//                       Nenhum dos dois lados pode mencionar avaliacao, primeira
//                       consulta, cadastro, sistema antigo ou telefone.
//   "ja sou cliente" -- a declaracao vem no HISTORICO. A resposta reconhece o
//                       vinculo, nao afirma ter localizado ficha, nao chama de
//                       paciente novo e nao oferece avaliacao.
//   primeira consulta -- quando o PROPRIO paciente declara, reconhecer e poder
//                       sugerir avaliacao e o comportamento correto (a proibicao
//                       e inferir, nunca acolher o que ele declarou).
//   so falta procedimento -- pedir horario sem dizer o procedimento produz
//                       PERGUNTA, nunca oferta de avaliacao.
//
// Mensagens sinteticas e ficticias (nenhum paciente real, nenhuma clinica real).
// Os fatos sao simulados aqui -- este runner nao chama o orquestrador nem o
// banco, so a redatora.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-cadastro-e-vinculo.ts

import { criarClienteModeloRedatorOpenAI, ErroClienteModeloRedator, TIMEOUT_REDATOR_MS_APROVADO } from '../core/cliente-modelo-redator-openai.ts';
import { INSTRUCOES_REDATOR } from '../core/redator-instrucoes.ts';
import { verificarRespostaRedatora } from '../core/guarda-resposta-redatora.ts';
import { MODELO_IRIS_NOVA } from '../core/cliente-modelo-openai.ts';
import type { FatosAutorizados } from '../core/fatos-autorizados.ts';
import type { NaturezaMensagem } from '../core/interpretacao-tipos.ts';
import type { ParConversa } from '../core/tipos.ts';

interface Caso {
  titulo: string;
  mensagemPaciente: string;
  naturezaMensagem: NaturezaMensagem;
  fatos: FatosAutorizados;
  historicoRecente?: ParConversa[];
  verificarTexto: (texto: string) => { ok: boolean; motivo?: string };
}

function historicoDeUmTurno(mensagemPaciente: string, respostaIris: string): ParConversa[] {
  return [{ mensagem_paciente: mensagemPaciente, resposta_iris: respostaIris, gerada_em: new Date().toISOString() }];
}

// Detectores usados SOMENTE na verificacao dos testes -- nunca no prompt, nunca
// no Core. Aqui eles sao instrumento de medicao, nao regra de produto.
const MENCIONA_AVALIACAO = /avalia[cç][aã]o|consulta de avalia/i;
const MENCIONA_PRIMEIRA_VEZ = /primeira (vez|consulta)|nunca (veio|esteve)|paciente novo|novo (aqui|na cl[ií]nica)/i;
const MENCIONA_CADASTRO = /cadastr|ficha|sistema|registro|telefone|n[uú]mero/i;
const MENCIONA_LOCALIZOU = /encontrei (seu|sua|o seu)|localizei|achei (seu|sua)|seu cadastro (est[aá]|foi)/i;
// Detector AMPLO e deliberadamente generoso: aceita qualquer forma de acusar
// o recebimento do vinculo declarado ("entendi", "que bom te ver de volta",
// "obrigada por avisar", "voce ja e cliente"...). Vive SO neste runner de
// avaliacao -- nunca no Core, nunca no prompt. Existe porque sem ele o caso
// passaria mesmo se a Iris ignorasse por completo o "ja sou cliente".
const RECONHECE_VINCULO =
  /entendi|entendo|certo|perfeito|[oó]timo|que bom|obrigad|anotei|combinado|isso mesmo|sei|claro|ja (e|é) (cliente|paciente)|de volta|novamente|retorno|voltar/i;

const CASOS: readonly Caso[] = Object.freeze([
  // --- A/B DE SAUDACAO ----------------------------------------------------
  // Lado A: cadastro AUSENTE. O Core nao entrega fato nenhum sobre isso (a
  // inferencia foi removida), entao a saudacao tem que ser so uma saudacao.
  {
    titulo: 'A/B saudacao [A]: sem cadastro -- so cumprimenta, nada de avaliacao/cadastro',
    mensagemPaciente: 'ola, bom dia',
    naturezaMensagem: 'saudacao',
    fatos: { objetivo: 'cumprimentar_e_oferecer_ajuda' },
    verificarTexto: (texto) => {
      if (MENCIONA_AVALIACAO.test(texto)) return { ok: false, motivo: 'ofereceu avaliacao numa saudacao simples' };
      if (MENCIONA_PRIMEIRA_VEZ.test(texto)) return { ok: false, motivo: 'afirmou/sugeriu primeira consulta' };
      if (MENCIONA_CADASTRO.test(texto)) return { ok: false, motivo: 'falou de cadastro/ficha/sistema/telefone sem necessidade' };
      return { ok: true };
    },
  },
  // Lado B: cadastro ENCONTRADO. UNICA variavel alterada. A resposta tem que
  // ser do mesmo tipo -- prova que o lado A nao vazou nada.
  {
    titulo: 'A/B saudacao [B]: com cadastro -- so cumprimenta, nada de avaliacao/cadastro',
    mensagemPaciente: 'ola, bom dia',
    naturezaMensagem: 'saudacao',
    fatos: {
      objetivo: 'cumprimentar_e_oferecer_ajuda',
      cadastro_conhecido: { nome: 'Marilda Sinval Quadros' },
    },
    verificarTexto: (texto) => {
      if (MENCIONA_AVALIACAO.test(texto)) return { ok: false, motivo: 'ofereceu avaliacao numa saudacao simples' };
      if (MENCIONA_PRIMEIRA_VEZ.test(texto)) return { ok: false, motivo: 'afirmou/sugeriu primeira consulta' };
      // Mesma exigencia do lado A: os DOIS lados do A/B reprovam qualquer
      // mencao espontanea a cadastro/ficha/sistema/telefone. Sem isso, o
      // controle nao seria simetrico e o par nao provaria nada.
      if (MENCIONA_CADASTRO.test(texto)) return { ok: false, motivo: 'falou de cadastro/ficha/sistema/telefone sem necessidade' };
      return { ok: true };
    },
  },

  // --- "JA SOU CLIENTE" ---------------------------------------------------
  // A declaracao vive no HISTORICO -- e assim que ela atravessa turnos hoje,
  // sem coluna nem estado novo.
  {
    titulo: '"ja sou cliente": reconhece o vinculo, nao afirma ter achado ficha, nao oferece avaliacao',
    mensagemPaciente: 'ja sou cliente de voces, ja me consultei ai antes',
    naturezaMensagem: 'resposta',
    fatos: { objetivo: 'pedir_procedimento', dados_faltantes: ['procedimento'] },
    historicoRecente: historicoDeUmTurno(
      'oi, queria marcar um horario',
      'Claro! Qual atendimento você gostaria de agendar?'
    ),
    verificarTexto: (texto) => {
      if (MENCIONA_LOCALIZOU.test(texto)) return { ok: false, motivo: 'afirmou ter localizado a ficha, que o sistema nao encontrou' };
      if (MENCIONA_PRIMEIRA_VEZ.test(texto)) return { ok: false, motivo: 'tratou como paciente novo apesar da declaracao de vinculo' };
      if (MENCIONA_AVALIACAO.test(texto)) return { ok: false, motivo: 'ofereceu avaliacao por falta de cadastro' };
      // Exigencia POSITIVA: nao basta nao errar -- a resposta precisa acusar
      // que ouviu o vinculo declarado. Sem isto, ignorar o "ja sou cliente"
      // passaria no teste.
      if (!RECONHECE_VINCULO.test(texto)) {
        return { ok: false, motivo: 'ignorou a declaracao de vinculo -- nao reconheceu que o paciente ja e cliente' };
      }
      return { ok: true };
    },
  },

  // --- PRIMEIRA CONSULTA DECLARADA PELO PACIENTE --------------------------
  // Item 4 da decisao: a proibicao e INFERIR. Se o paciente declara, acolher e
  // sugerir avaliacao e o comportamento certo.
  {
    titulo: 'primeira consulta DECLARADA pelo paciente: pode reconhecer e sugerir avaliacao',
    mensagemPaciente: 'nunca fui ai, seria minha primeira consulta na clinica',
    naturezaMensagem: 'resposta',
    fatos: {
      objetivo: 'pedir_procedimento',
      dados_faltantes: ['procedimento'],
      procedimento_avaliacao_disponivel: 'Consulta / Avaliação',
    },
    verificarTexto: (texto) => {
      const mencionaAvaliacao = MENCIONA_AVALIACAO.test(texto);
      return {
        ok: mencionaAvaliacao,
        motivo: mencionaAvaliacao ? undefined : 'paciente declarou primeira consulta e a avaliacao estava disponivel, mas nao foi sugerida',
      };
    },
  },

  // --- SO FALTA O PROCEDIMENTO --------------------------------------------
  // O cenario revogado: sem o fato da avaliacao, a redatora tem que PERGUNTAR.
  {
    titulo: 'pediu horario sem dizer o procedimento: PERGUNTA qual atendimento, nao oferece avaliacao',
    mensagemPaciente: 'quero um turno para hoje. tem algum horario disponivel?',
    naturezaMensagem: 'pedido',
    fatos: { objetivo: 'pedir_procedimento', dados_faltantes: ['procedimento'] },
    verificarTexto: (texto) => {
      if (MENCIONA_AVALIACAO.test(texto)) {
        return { ok: false, motivo: 'ofereceu avaliacao so porque o procedimento estava ausente' };
      }
      const pergunta = texto.includes('?');
      return { ok: pergunta, motivo: pergunta ? undefined : 'nao perguntou qual atendimento o paciente deseja' };
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

  console.log('--- teste real: cadastro ausente e vinculo declarado (spec secao 8) ---');
  console.log(`modelo: ${MODELO_IRIS_NOVA}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log(`total de casos: ${CASOS.length}`);
  console.log('');

  const cliente = criarClienteModeloRedatorOpenAI({ chaveApi, modelo: MODELO_IRIS_NOVA, timeoutMs: TIMEOUT_REDATOR_MS_APROVADO });

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
