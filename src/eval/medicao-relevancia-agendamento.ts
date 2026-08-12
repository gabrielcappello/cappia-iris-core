// Runner ISOLADO, avulso: MEDICAO da REGRA DE RELEVANCIA da redatora.
// Nenhum modulo de producao e alterado por este arquivo.
//
// ── DE ONDE VEM ─────────────────────────────────────────────────────────
// medicao-excesso-mencao-agendamento.ts (2026-08-12) provou o desenho pela
// metade: com o agendamento disponivel como fato do turno, a redatora ACERTA
// 8/8 quando a pergunta e sobre ele -- e MENCIONA SEM NECESSIDADE 16/16
// quando a pergunta e sobre outra coisa. Nao e tendencia, e constante: ela le
// "voce PODE mencionar" como "voce DEVE mencionar".
//
// ── A REGRA MEDIDA AQUI (Gabriel, 2026-08-12) ───────────────────────────
// `agendamentos_do_paciente` e CONTEXTO DISPONIVEL, nunca assunto
// obrigatorio. A redatora so o usa quando:
//   1. a mensagem for uma SAUDACAO PURA; ou
//   2. o proprio assunto da mensagem for esse atendimento.
// Nunca como acrescimo proativo a um assunto que o paciente ja iniciou.
//
// FORMA DA REGRA: entra como DESCRICAO DO CAMPO na lista "Voce recebe" que ja
// existe no prompt da redatora -- mesmo lugar onde `historico_recente` e
// `nome_clinica` ja sao descritos. Nao e um principio novo empilhado: e a
// documentacao de uma entrada nova, que e o que ela de fato e.
//
// ── AS DUAS VARIANTES ───────────────────────────────────────────────────
//   SEM -- prompt de producao intacto, campo presente e sem descricao.
//          Reproduz o cenario ja medido (16/16 de mencao indevida).
//   COM -- prompt + a descricao do campo. E o candidato.
//
// Rodar as duas na MESMA execucao, com as MESMAS frases, e o que torna a
// comparacao interpretavel -- medicoes anteriores desta sessao mostraram que
// rodada unica e variancia entre execucoes enganam.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-relevancia-agendamento.ts

import { criarClienteModeloRedatorOpenAI, TIMEOUT_REDATOR_MS_APROVADO } from '../core/cliente-modelo-redator-openai.ts';
import { MODELO_GPT_4_1_MINI } from '../core/cliente-modelo-openai.ts';
import { INSTRUCOES_REDATOR } from '../core/redator-instrucoes.ts';
import type { FatosAutorizados } from '../core/fatos-autorizados.ts';

const AGENDAMENTO = { data: '20/08', horario: '14:00', descricao: 'Limpeza dental com Dra. Ana Souza' };
const DESCRICAO_FATO = `${AGENDAMENTO.descricao} — sexta-feira, ${AGENDAMENTO.data} às ${AGENDAMENTO.horario}`;

type FatosComAgendamentos = FatosAutorizados & { agendamentos_do_paciente?: string[] };

// Ancora: a linha de `nome_clinica`, ultima da lista "Voce recebe".
const ANCORA = '- "nome_clinica": o nome da clinica, quando disponivel.';

// A REGRA CANDIDATA. Semantica, sem repertorio de frases, sem verbo de fluxo.
const LINHA_RELEVANCIA =
  '- "agendamentos_do_paciente" (quando presente): os atendimentos que este paciente ja tem marcados. E CONTEXTO DISPONIVEL, nunca assunto obrigatorio. Use somente em dois casos: quando a mensagem for um cumprimento puro, sem nenhum outro pedido ou pergunta junto; ou quando o proprio assunto da mensagem for esse atendimento. Se o paciente ja trouxe outro assunto — uma pergunta, um pedido, qualquer coisa concreta —, responda ao que ele trouxe e NAO mencione o agendamento.';

function instrucoesCom(): string {
  if (!INSTRUCOES_REDATOR.includes(ANCORA)) {
    throw new Error('Ancora nao encontrada no prompt da redatora -- runner desatualizado.');
  }
  return INSTRUCOES_REDATOR.replace(ANCORA, `${ANCORA}\n${LINHA_RELEVANCIA}`);
}

type Grupo = 'saudacao_pura' | 'sobre_agendamento' | 'outro_assunto';

interface Caso {
  grupo: Grupo;
  mensagem: string;
  objetivo: FatosAutorizados['objetivo'];
  /** true = DEVE mencionar o agendamento; false = NAO deve. */
  deveMencionar: boolean;
  /**
   * Em producao, o fato SO e anexado em decisoes conversacionais
   * (`saudacao`, `duvida_livre`, `mensagem_nao_compreendida`). Frases que
   * viram decisao OPERACIONAL nunca receberiam o fato -- sao medidas aqui
   * como PIOR CASO (defesa em profundidade), nao como cenario real.
   */
  fatoChegaEmProducao: boolean;
}

const CASOS: readonly Caso[] = Object.freeze([
  // 1. SAUDACAO PURA -- deve mencionar.
  { grupo: 'saudacao_pura', mensagem: 'oi', objetivo: 'cumprimentar_e_oferecer_ajuda', deveMencionar: true, fatoChegaEmProducao: true },
  { grupo: 'saudacao_pura', mensagem: 'olá', objetivo: 'cumprimentar_e_oferecer_ajuda', deveMencionar: true, fatoChegaEmProducao: true },
  { grupo: 'saudacao_pura', mensagem: 'bom dia', objetivo: 'cumprimentar_e_oferecer_ajuda', deveMencionar: true, fatoChegaEmProducao: true },
  { grupo: 'saudacao_pura', mensagem: 'boa tarde', objetivo: 'cumprimentar_e_oferecer_ajuda', deveMencionar: true, fatoChegaEmProducao: true },
  { grupo: 'saudacao_pura', mensagem: 'tudo bem?', objetivo: 'cumprimentar_e_oferecer_ajuda', deveMencionar: true, fatoChegaEmProducao: true },

  // 2. PERGUNTA SOBRE O PROPRIO AGENDAMENTO -- deve responder usando o fato.
  { grupo: 'sobre_agendamento', mensagem: 'quando é minha consulta?', objetivo: 'acolher_e_retomar', deveMencionar: true, fatoChegaEmProducao: true },
  { grupo: 'sobre_agendamento', mensagem: 'que horas estou marcado?', objetivo: 'acolher_e_retomar', deveMencionar: true, fatoChegaEmProducao: true },
  { grupo: 'sobre_agendamento', mensagem: 'tenho horário?', objetivo: 'acolher_e_retomar', deveMencionar: true, fatoChegaEmProducao: true },
  { grupo: 'sobre_agendamento', mensagem: 'com qual dentista estou?', objetivo: 'acolher_e_retomar', deveMencionar: true, fatoChegaEmProducao: true },

  // 3. OUTRO ASSUNTO -- nao deve mencionar.
  // "bom dia, quero marcar para sexta" e o caso critico: tem saudacao E outro
  // objetivo na mesma mensagem. Em producao viraria decisao operacional.
  { grupo: 'outro_assunto', mensagem: 'bom dia, quero marcar para sexta', objetivo: 'acolher_e_retomar', deveMencionar: false, fatoChegaEmProducao: false },
  { grupo: 'outro_assunto', mensagem: 'qual o endereço?', objetivo: 'acolher_e_retomar', deveMencionar: false, fatoChegaEmProducao: true },
  { grupo: 'outro_assunto', mensagem: 'quanto custa limpeza?', objetivo: 'acolher_e_retomar', deveMencionar: false, fatoChegaEmProducao: true },
  { grupo: 'outro_assunto', mensagem: 'quero remarcar', objetivo: 'acolher_e_retomar', deveMencionar: false, fatoChegaEmProducao: false },
  { grupo: 'outro_assunto', mensagem: 'quero cancelar', objetivo: 'acolher_e_retomar', deveMencionar: false, fatoChegaEmProducao: false },
]);

const REPETICOES = 3;

/**
 * Mencionou o agendamento? Detecta por DADO CONCRETO -- horario (14:00/14h),
 * data (20/08) ou o dia da semana do fato. Nunca por palavra generica como
 * "consulta" ou "agendamento", que aparecem legitimamente em qualquer
 * resposta de clinica e produziriam falso positivo de deteccao.
 */
function mencionouAgendamento(texto: string): boolean {
  if (/\b14:00\b/.test(texto) || /\b14\s*h\b/i.test(texto) || /\b14\s*horas\b/i.test(texto)) return true;
  if (/\b20\/0?8\b/.test(texto)) return true;
  if (/sexta[- ]feira/i.test(texto)) return true;
  return false;
}

interface Placar {
  acertos: number;
  total: number;
  porGrupo: Record<Grupo, { acertos: number; total: number }>;
  erros: number;
}

function placarVazio(): Placar {
  return {
    acertos: 0,
    total: 0,
    porGrupo: {
      saudacao_pura: { acertos: 0, total: 0 },
      sobre_agendamento: { acertos: 0, total: 0 },
      outro_assunto: { acertos: 0, total: 0 },
    },
    erros: 0,
  };
}

async function executarVariante(
  cliente: ReturnType<typeof criarClienteModeloRedatorOpenAI>,
  rotulo: string,
  instrucoes: string,
  verboso: boolean
): Promise<Placar> {
  console.log('');
  console.log(`##### VARIANTE ${rotulo} #####`);
  const p = placarVazio();
  let grupoAtual: Grupo | null = null;

  for (const caso of CASOS) {
    if (caso.grupo !== grupoAtual) {
      grupoAtual = caso.grupo;
      console.log(`  --- ${caso.grupo} (${caso.deveMencionar ? 'DEVE mencionar' : 'NAO deve mencionar'}) ---`);
    }
    let ok = 0;
    let err = 0;
    const exemplos: string[] = [];
    for (let r = 0; r < REPETICOES; r++) {
      const fatos: FatosComAgendamentos = { objetivo: caso.objetivo, agendamentos_do_paciente: [DESCRICAO_FATO] };
      try {
        const texto = await cliente.redigir({
          instrucoes,
          mensagemPaciente: caso.mensagem,
          naturezaMensagem: caso.grupo === 'saudacao_pura' ? 'saudacao' : 'duvida',
          fatos,
        });
        const mencionou = mencionouAgendamento(texto);
        const acertou = mencionou === caso.deveMencionar;
        p.total++;
        p.porGrupo[caso.grupo].total++;
        if (acertou) { ok++; p.acertos++; p.porGrupo[caso.grupo].acertos++; }
        if (!acertou || verboso) exemplos.push(texto);
      } catch (erro) {
        err++;
        p.erros++;
        p.total++;
        p.porGrupo[caso.grupo].total++;
      }
    }
    const marca = ok === REPETICOES ? 'OK ' : ok === 0 ? '!!!' : '~~ ';
    const nota = caso.fatoChegaEmProducao ? '' : '  [pior caso -- em producao o fato nao chegaria]';
    console.log(`  ${marca} "${caso.mensagem}"  ${ok}/${REPETICOES}${err > 0 ? ` | erro ${err}` : ''}${nota}`);
    for (const ex of exemplos.slice(0, 2)) console.log(`         ${JSON.stringify(ex)}`);
  }

  console.log('');
  for (const g of ['saudacao_pura', 'sobre_agendamento', 'outro_assunto'] as Grupo[]) {
    console.log(`  ${g.padEnd(18)}: ${p.porGrupo[g].acertos}/${p.porGrupo[g].total}`);
  }
  console.log(`  TOTAL             : ${p.acertos}/${p.total} | erros ${p.erros}`);
  return p;
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- medicao: REGRA DE RELEVANCIA do agendamento como contexto ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log(`fato disponivel: "${DESCRICAO_FATO}"`);
  console.log('Nenhum modulo de producao alterado. Zero intencao, parser, evento ou estado.');
  console.log(`casos: ${CASOS.length} x ${REPETICOES} repeticoes x 2 variantes`);

  const cliente = criarClienteModeloRedatorOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutMs: TIMEOUT_REDATOR_MS_APROVADO,
  });

  const sem = await executarVariante(cliente, 'SEM a regra (prompt de producao intacto)', INSTRUCOES_REDATOR, false);
  const com = await executarVariante(cliente, 'COM a regra de relevancia', instrucoesCom(), false);

  console.log('');
  console.log('##### COMPARACAO #####');
  for (const g of ['saudacao_pura', 'sobre_agendamento', 'outro_assunto'] as Grupo[]) {
    console.log(`  ${g.padEnd(18)}: SEM ${sem.porGrupo[g].acertos}/${sem.porGrupo[g].total}  ->  COM ${com.porGrupo[g].acertos}/${com.porGrupo[g].total}`);
  }
  console.log(`  TOTAL             : SEM ${sem.acertos}/${sem.total}  ->  COM ${com.acertos}/${com.total}`);
  console.log(`  erros de infra    : SEM ${sem.erros}  ->  COM ${com.erros}`);
}

main().catch((erro) => {
  console.error(`erro fatal: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
