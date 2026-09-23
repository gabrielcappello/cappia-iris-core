// Runner ISOLADO, avulso, chamado manualmente: mede a IA CLASSIFICADORA de
// pos-consulta (cliente-modelo-classificador-pos-consulta-openai.ts) contra
// o modelo real, exigido por reviews/revisao-pos-consulta-conversacional-v1.md
// (B8): "a spec exige medicao com mensagens plausiveis contra a IA real...
// especialmente para respostas mistas e mudanca de assunto".
//
// STATUS: ESCRITO, NAO EXECUTADO. Esta sessao nao tem OPENAI_API_KEY
// disponivel (nem no ambiente, nem em ~/.iris-secrets -- so existem
// evolution.env, n8n.env e portal-local.env, nenhum e credencial da
// OpenAI). Nenhum numero abaixo deve ser lido como resultado ate alguem com
// a chave rodar isto de fato.
//
// NENHUM DADO REAL: todas as mensagens sao sinteticas, mas PLAUSIVEIS
// (docs/00-principios.md, principio dos testes realistas) -- frases que um
// paciente real escreveria apos uma consulta, incluindo erros de digitacao
// e informalidade. Nenhum telefone, nome ou CPF real em nenhum caso.
//
// NAO altera o classificador nem as instrucoes -- so mede.
//
// Comando:
//   node --experimental-strip-types --env-file="<cofre>/openai.env" \
//     src/eval/medicao-classificacao-satisfacao-pos-consulta.ts

import { criarClienteClassificadorPosConsultaOpenAI } from '../core/cliente-modelo-classificador-pos-consulta-openai.ts';

const MODELO = 'gpt-5.6-luna';
const TIMEOUT_MS = 6000;
const REPETICOES = 5;

interface Caso {
  titulo: string;
  mensagem: string;
  esperado: 'positiva' | 'nao_positiva' | 'incerta';
}

const CASOS: readonly Caso[] = Object.freeze([
  // ── Satisfacao clara ────────────────────────────────────────────────
  { titulo: 'satisfacao clara, direta', mensagem: 'Foi ótimo, adorei o atendimento!', esperado: 'positiva' },
  { titulo: 'satisfacao clara, informal com erro de digitacao', mensagem: 'mto bom, gostei bastante obrigada', esperado: 'positiva' },
  { titulo: 'satisfacao clara, elogiando o profissional', mensagem: 'Adorei a Dra. Ana, super atenciosa', esperado: 'positiva' },
  { titulo: 'satisfacao clara, curta', mensagem: 'Tudo ótimo!', esperado: 'positiva' },

  // ── Insatisfacao clara ──────────────────────────────────────────────
  { titulo: 'insatisfacao clara, reclamacao de espera', mensagem: 'Não gostei, esperei muito tempo pra ser atendida', esperado: 'nao_positiva' },
  { titulo: 'insatisfacao clara, direta e curta', mensagem: 'Péssimo atendimento', esperado: 'nao_positiva' },
  { titulo: 'insatisfacao clara, reclamando de dor', mensagem: 'Fiquei com muita dor depois, não foi legal', esperado: 'nao_positiva' },

  // ── Ambigua / neutra ────────────────────────────────────────────────
  { titulo: 'resposta neutra, sem sentimento claro', mensagem: 'foi normal', esperado: 'incerta' },
  { titulo: 'resposta vaga', mensagem: 'ah, foi', esperado: 'incerta' },

  // ── Mudanca de assunto (o caso que a revisao pede explicitamente) ────
  { titulo: 'mudanca de assunto -- pergunta sobre outro procedimento', mensagem: 'Vocês fazem clareamento dental?', esperado: 'incerta' },
  { titulo: 'mudanca de assunto -- pedido de novo agendamento', mensagem: 'Quero marcar uma limpeza pra semana que vem', esperado: 'incerta' },
  { titulo: 'mudanca de assunto -- pergunta administrativa', mensagem: 'Vocês aceitam meu convênio?', esperado: 'incerta' },

  // ── Resposta mista (elogio + reclamacao no mesmo turno) ──────────────
  { titulo: 'mista -- elogia o profissional mas reclama da espera', mensagem: 'A doutora foi ótima, mas esperei quase uma hora', esperado: 'incerta' },
  { titulo: 'mista -- gostou do resultado mas reclama da dor', mensagem: 'Ficou bom o resultado, mas doeu bastante durante', esperado: 'incerta' },
]);

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para o cofre local.');
    process.exitCode = 1;
    return;
  }

  console.log('--- medicao B8: classificacao de satisfacao (pos-consulta) contra IA real ---');
  console.log(`modelo: ${MODELO}`);
  console.log(`repeticoes por caso: ${REPETICOES}`);
  console.log('');

  const cliente = criarClienteClassificadorPosConsultaOpenAI({ chaveApi, modelo: MODELO, timeoutMs: TIMEOUT_MS });

  const { INSTRUCOES_CLASSIFICADOR_POS_CONSULTA } = await import('../core/pos-consulta-classificacao-instrucoes.ts');

  let totalAcertos = 0;
  let totalTentativas = 0;
  const linhasResumo: string[] = [];

  for (const caso of CASOS) {
    const observados: string[] = [];
    let acertos = 0;

    for (let i = 0; i < REPETICOES; i++) {
      try {
        const saida = await cliente.classificar({
          instrucoes: INSTRUCOES_CLASSIFICADOR_POS_CONSULTA,
          mensagemPaciente: caso.mensagem,
        });
        observados.push(saida);
        if (saida === caso.esperado) acertos++;
      } catch (erro) {
        observados.push('ERRO: ' + (erro instanceof Error ? erro.message : 'desconhecido'));
      }
    }

    totalAcertos += acertos;
    totalTentativas += REPETICOES;

    const estavel = new Set(observados).size === 1;
    console.log(caso.titulo);
    console.log(`  mensagem : ${JSON.stringify(caso.mensagem)}`);
    console.log(`  esperado : ${caso.esperado}`);
    console.log(`  observado: ${observados.join(' | ')}`);
    console.log(`  acertos  : ${acertos}/${REPETICOES}  (${estavel ? 'ESTAVEL' : 'VARIAVEL'})`);
    console.log('');

    linhasResumo.push(`| ${caso.titulo} | ${caso.esperado} | ${acertos}/${REPETICOES} | ${estavel ? 'estavel' : 'variavel'} |`);
  }

  console.log('--- resumo (colar em reviews/ apos execucao real) ---');
  console.log('| caso | esperado | acertos | variancia |');
  console.log('|---|---|---|---|');
  for (const linha of linhasResumo) console.log(linha);
  console.log('');
  console.log(`total: ${totalAcertos}/${totalTentativas}`);
  console.log('');
  console.log(
    'ATENCAO: `incerta` cobrindo tanto ambiguidade real quanto mudanca de assunto e resposta mista e uma decisao ' +
      'DELIBERADA da spec (secao 4.1/6.3) -- um erro aqui so importa se o modelo disser "positiva" ou "nao_positiva" ' +
      'para um caso "incerta" (falso positivo de convite), nunca o contrario. Ao analisar o resultado, separe os dois ' +
      'tipos de erro: (a) modelo disse positiva/nao_positiva onde o esperado era incerta -- GRAVE, pode autorizar ' +
      'convite indevido; (b) modelo disse incerta onde o esperado era positiva/nao_positiva -- CONSERVADOR, apenas ' +
      'perde a automacao opcional daquele turno, nunca produz efeito indevido.'
  );
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
