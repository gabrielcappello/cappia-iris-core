// Runner ISOLADO, avulso: MEDICAO DE VARIANTE MINIMA. Nao implementa nada --
// nenhum modulo de producao e alterado por este arquivo.
//
// CONTINUACAO de medicao-precedencia-escolha-agendamento.ts (2026-08-11), que
// mediu 8/10 "limpo" para a instrucao candidata de precedencia -- com duas
// falhas remanescentes, ambas na posicao 2: "a limpeza" poluiu procedimento_id
// uma vez, e "o de sexta" ESCOLHEU O AGENDAMENTO ERRADO (pior que omitir: o
// erro passa pelo gate de integridade porque o id esta na lista oferecida).
//
// A HIPOTESE deste runner, aprovada pelo Gabriel: o erro de "o de sexta" vem
// de a IA ter que INFERIR o dia da semana a partir da data (14/08, 20/08) --
// tarefa que ela erra. Se o Core calcular o dia da semana DETERMINISTICAMENTE
// e incluir na propria descricao, a IA so precisa CASAR texto, nunca calcular
// nada. NAO pedimos a IA para calcular dia da semana em nenhum momento.
//
// DUAS VARIAVEIS, MEDIDAS JUNTAS (nenhuma regra de prompt nova alem da
// precedencia ja testada):
//   1. instrucao CANDIDATA de precedencia -- EXATAMENTE a mesma da medicao
//      anterior, char por char (nenhuma regra nova acrescentada);
//   2. descricao de agendamentos_ativos agora leva o dia da semana calculado
//      pelo Core (mesmo algoritmo -- Howard Hinnant days_from_civil -- ja
//      usado em carregar-disponibilidade.ts, reimplementado aqui pelo mesmo
//      motivo de sempre: este arquivo nao pode alterar nem importar de
//      modulos de producao para uma medicao).
//
// MESMO A/B da medicao anterior (producao vs candidata), agora com a
// descricao nova nos dois lados -- isola o efeito do dia da semana sobre CADA
// instrucao, nao so sobre a candidata.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-precedencia-com-dia-semana.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { INSTRUCOES_EXTRATOR, SCHEMA_SAIDA_INTERPRETACAO } from '../core/interpretacao-instrucoes.ts';
import { validarSaidaInterpretacao } from '../core/interpretacao-extrator.ts';
import type { EntradaInterpretacao } from '../core/interpretacao-tipos.ts';

// --- A linha de producao, exata (copiada de interpretacao-instrucoes.ts) ---
const LINHA_PRODUCAO =
  '- Quando "agendamentos_ativos" estiver presente, ele lista os agendamentos que o paciente ja tem, cada um com seu "agendamento_id" e uma "descricao" (procedimento, profissional, data e horario). Entenda a qual deles o paciente esta se referindo — por ordinal ("o segundo"), por procedimento, por profissional, por data ou por horario — e preencha "agendamento_id" com o "agendamento_id" correspondente da lista, copiado LITERALMENTE — nunca um nome, nunca o texto do paciente, nunca um id inventado. Em duvida real sobre qual dos agendamentos ele quer, omita "agendamento_id" — nunca escolha por aproximacao. Quando "agendamentos_ativos" nao estiver presente, nunca emita "agendamento_id".';

// --- CANDIDATA: EXATAMENTE a mesma da medicao anterior, char por char.
// Nenhuma regra nova alem da precedencia ja testada e ja aprovada. ---
const LINHA_CANDIDATA =
  '- Quando "agendamentos_ativos" estiver presente, a unica pergunta em aberto e QUAL DESSES AGENDAMENTOS o paciente quer — nada mais. Ele lista os agendamentos que o paciente ja tem, cada um com seu "agendamento_id" e uma "descricao" (procedimento, profissional, data e horario). Uma mencao a procedimento, profissional, data, dia da semana, horario ou ordinal nesse turno E a resposta a essa pergunta: use-a para identificar o agendamento e preencha SOMENTE "agendamento_id", com o valor copiado LITERALMENTE da lista — nunca um nome, nunca o texto do paciente, nunca um id inventado. Enquanto "agendamentos_ativos" estiver presente, essa mencao NUNCA preenche "procedimento_id" e NUNCA entra em "dentistas_candidatos" (que deve ser null): ela nao e um pedido de procedimento novo nem uma escolha de profissional, e sim a identificacao de um agendamento existente. Em duvida real sobre qual dos agendamentos ele quer, omita "agendamento_id" e nao emita nenhum outro campo no lugar — nunca escolha por aproximacao. Quando "agendamentos_ativos" nao estiver presente, nunca emita "agendamento_id".';

function instrucoesCandidatas(): string {
  if (!INSTRUCOES_EXTRATOR.includes(LINHA_PRODUCAO)) {
    throw new Error('A linha de producao nao foi encontrada em INSTRUCOES_EXTRATOR -- o runner esta desatualizado.');
  }
  return INSTRUCOES_EXTRATOR.replace(LINHA_PRODUCAO, LINHA_CANDIDATA);
}

// --- Dia da semana, calculado pelo CORE, nunca pela IA ---
//
// Howard Hinnant days_from_civil, MESMO algoritmo de
// carregar-disponibilidade.ts:diaDaSemanaLocal -- reimplementado aqui (nunca
// importado de src/core, para nao acoplar este runner de medicao a producao;
// mesmo criterio ja documentado naquele arquivo para nao alterar modulos
// fora de escopo so para reusar 12 linhas).
const NOMES_DIA_SEMANA = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'];

function diaDaSemana(dataIso: string): string {
  const partes = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(dataIso);
  if (!partes) throw new Error(`data invalida: ${dataIso}`);
  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);

  const y = mes <= 2 ? ano - 1 : ano;
  const era = Math.floor(y / 400);
  const anoDaEra = y - era * 400;
  const diaDoAno = Math.floor((153 * (mes + (mes > 2 ? -3 : 9)) + 2) / 5) + dia - 1;
  const diaDaEra = anoDaEra * 365 + Math.floor(anoDaEra / 4) - Math.floor(anoDaEra / 100) + diaDoAno;
  const dias = era * 146097 + diaDaEra - 719468;
  const indice = (((dias + 3) % 7) + 7) % 7; // 0=segunda..6=domingo
  return NOMES_DIA_SEMANA[indice]!;
}

function formatarDataBR(dataIso: string): string {
  const [, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}`;
}

// Formato da descricao NOVA: dia da semana calculado, antes da data --
// exemplo do Gabriel: "Limpeza dental com Dra. Ana Souza — sexta-feira, 14/08 às 14:00".
function descrever(procedimento: string, profissional: string, dataIso: string, horario: string): string {
  return `${procedimento} com ${profissional} — ${diaDaSemana(dataIso)}, ${formatarDataBR(dataIso)} às ${horario}`;
}

// --- Catalogo e agenda (fiel a producao, mesmas datas ja verificadas) ---
const PROCEDIMENTOS_DISPONIVEIS = [
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental' },
  { procedimento_id: 'implant', nome_pt: 'Implante dentário' },
  { procedimento_id: 'root_canal', nome_pt: 'Tratamento de canal' },
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
];
const DENTISTAS_DISPONIVEIS = [
  { dentista_id: 'dent-ana', nome_exibido: 'Dra. Ana Souza' },
  { dentista_id: 'dent-bruno', nome_exibido: 'Dr. Bruno Lima' },
];

const DATA_A = '2026-08-14'; // sexta-feira (verificado)
const DATA_B = '2026-08-20'; // quinta-feira (verificado)
const DESC_A = descrever('Limpeza dental', 'Dra. Ana Souza', DATA_A, '14:00');
const DESC_B = descrever('Implante dentário', 'Dr. Bruno Lima', DATA_B, '09:00');

console.log(`[descricao A] ${DESC_A}`);
console.log(`[descricao B] ${DESC_B}`);
console.log('');

type Alvo = 'A' | 'B' | 'PRIMEIRO';

interface Frase {
  mensagem: string;
  alvo: Alvo;
  categoria: string;
}

// As mesmas cinco frases pedidas, na mesma forma da medicao anterior.
const FRASES: readonly Frase[] = Object.freeze([
  { mensagem: 'a limpeza', alvo: 'A', categoria: 'procedimento' },
  { mensagem: 'o implante', alvo: 'B', categoria: 'procedimento' },
  { mensagem: 'o do Dr. Bruno', alvo: 'B', categoria: 'profissional' },
  { mensagem: 'o primeiro', alvo: 'PRIMEIRO', categoria: 'ordinal' },
  { mensagem: 'o de sexta', alvo: 'A', categoria: 'dia da semana' },
]);

interface Rodada {
  frase: Frase;
  posicaoDeA: 1 | 2;
  agendamentosAtivos: { agendamento_id: string; descricao: string }[];
  idEsperado: string;
}

function montarRodadas(): Rodada[] {
  const rodadas: Rodada[] = [];
  for (const frase of FRASES) {
    for (const posicaoDeA of [1, 2] as const) {
      const idA = crypto.randomUUID();
      const idB = crypto.randomUUID();
      const itemA = { agendamento_id: idA, descricao: DESC_A };
      const itemB = { agendamento_id: idB, descricao: DESC_B };
      const lista = posicaoDeA === 1 ? [itemA, itemB] : [itemB, itemA];
      const idEsperado = frase.alvo === 'A' ? idA : frase.alvo === 'B' ? idB : lista[0]!.agendamento_id;
      rodadas.push({ frase, posicaoDeA, agendamentosAtivos: lista, idEsperado });
    }
  }
  return rodadas;
}

interface Veredito {
  resolveuCerto: boolean;
  escolheuErrado: boolean;
  poluiuProcedimento: boolean;
  poluiuDentista: boolean;
  detalhe: string;
}

function avaliar(saida: unknown, rodada: Rodada, idOutro: string): Veredito {
  validarSaidaInterpretacao(saida);
  const alteracoes = saida.alteracoes as Record<string, { acao: string; valor?: string } | undefined>;
  const agendamentoId = alteracoes.agendamento_id?.valor;
  const procedimentoId = alteracoes.procedimento_id?.valor;
  const dentistasCandidatos = saida.dentistas_candidatos;

  const resolveuCerto = agendamentoId === rodada.idEsperado;
  const escolheuErrado = agendamentoId !== undefined && agendamentoId === idOutro;
  const poluiuProcedimento = procedimentoId !== undefined;
  const poluiuDentista = Array.isArray(dentistasCandidatos) && dentistasCandidatos.length > 0;

  const partes: string[] = [];
  partes.push(resolveuCerto ? 'agendamento_id OK' : `agendamento_id=${agendamentoId ?? '(ausente)'}`);
  if (escolheuErrado) partes.push('*** ESCOLHEU O ERRADO ***');
  if (poluiuProcedimento) partes.push(`POLUIU procedimento_id="${procedimentoId}"`);
  if (poluiuDentista) partes.push(`POLUIU dentistas_candidatos=${JSON.stringify(dentistasCandidatos)}`);

  return { resolveuCerto, escolheuErrado, poluiuProcedimento, poluiuDentista, detalhe: partes.join(' | ') };
}

interface Placar {
  resolvidos: number;
  escolhasErradas: number;
  poluicaoProcedimento: number;
  poluicaoDentista: number;
  limpos: number;
  total: number;
}

async function executarVariante(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  nome: string,
  instrucoes: string,
  rodadas: readonly Rodada[]
): Promise<Placar> {
  console.log('');
  console.log(`##### VARIANTE: ${nome} #####`);
  console.log('');

  const placar: Placar = { resolvidos: 0, escolhasErradas: 0, poluicaoProcedimento: 0, poluicaoDentista: 0, limpos: 0, total: rodadas.length };

  for (const rodada of rodadas) {
    const idOutro = rodada.agendamentosAtivos.find((a) => a.agendamento_id !== rodada.idEsperado)?.agendamento_id ?? '';
    const payload: EntradaInterpretacao = {
      mensagens_atuais: [rodada.frase.mensagem],
      dados_atuais: { intencao: 'remarcacao' },
      campos_cadastrais_preenchidos: [],
      procedimentos_disponiveis: PROCEDIMENTOS_DISPONIVEIS,
      dentistas_disponiveis: DENTISTAS_DISPONIVEIS,
      agendamentos_ativos: rodada.agendamentosAtivos,
    };

    let veredito: Veredito;
    try {
      const saida = await cliente.executar({ instrucoes, schema: SCHEMA_SAIDA_INTERPRETACAO, payload });
      veredito = avaliar(saida, rodada, idOutro);
    } catch (erro) {
      veredito = {
        resolveuCerto: false,
        escolheuErrado: false,
        poluiuProcedimento: false,
        poluiuDentista: false,
        detalhe: `ERRO: ${erro instanceof Error ? erro.message : 'desconhecido'}`,
      };
    }

    if (veredito.resolveuCerto) placar.resolvidos++;
    if (veredito.escolheuErrado) placar.escolhasErradas++;
    if (veredito.poluiuProcedimento) placar.poluicaoProcedimento++;
    if (veredito.poluiuDentista) placar.poluicaoDentista++;
    if (veredito.resolveuCerto && !veredito.poluiuProcedimento && !veredito.poluiuDentista) placar.limpos++;

    const marca = veredito.resolveuCerto && !veredito.poluiuProcedimento && !veredito.poluiuDentista ? 'OK ' : '-- ';
    console.log(`${marca}"${rodada.frase.mensagem}" (${rodada.frase.categoria}, A na pos ${rodada.posicaoDeA})`);
    console.log(`     ${veredito.detalhe}`);
  }

  console.log('');
  console.log(`  resolveu o agendamento certo : ${placar.resolvidos}/${placar.total}`);
  console.log(`  ESCOLHEU O ERRADO           : ${placar.escolhasErradas}/${placar.total}`);
  console.log(`  poluiu procedimento_id       : ${placar.poluicaoProcedimento}/${placar.total}`);
  console.log(`  poluiu dentistas_candidatos  : ${placar.poluicaoDentista}/${placar.total}`);
  console.log(`  LIMPO (certo e sem poluicao) : ${placar.limpos}/${placar.total}`);

  return placar;
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  const rodadas = montarRodadas();

  console.log('--- medicao: precedencia + dia da semana calculado pelo Core ---');
  console.log('NENHUMA REGRA DE PROMPT NOVA alem da precedencia ja testada.');
  console.log('A IA NUNCA calcula dia da semana -- so casa texto ja pronto na descricao.');
  console.log('Nenhum modulo de producao foi alterado por este runner.');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log(`rodadas por variante: ${rodadas.length} (5 frases x 2 posicoes)`);

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const baseline = await executarVariante(cliente, 'A -- instrucao de PRODUCAO + descricao com dia da semana', INSTRUCOES_EXTRATOR, rodadas);
  const candidata = await executarVariante(cliente, 'B -- instrucao CANDIDATA + descricao com dia da semana', instrucoesCandidatas(), rodadas);

  console.log('');
  console.log('##### COMPARACAO #####');
  console.log(`  resolveu certo   : producao ${baseline.resolvidos}/${baseline.total}  ->  candidata ${candidata.resolvidos}/${candidata.total}`);
  console.log(`  ESCOLHEU ERRADO  : producao ${baseline.escolhasErradas}/${baseline.total}  ->  candidata ${candidata.escolhasErradas}/${candidata.total}`);
  console.log(`  poluiu proc_id   : producao ${baseline.poluicaoProcedimento}/${baseline.total}  ->  candidata ${candidata.poluicaoProcedimento}/${candidata.total}`);
  console.log(`  poluiu dentistas : producao ${baseline.poluicaoDentista}/${baseline.total}  ->  candidata ${candidata.poluicaoDentista}/${candidata.total}`);
  console.log(`  LIMPO            : producao ${baseline.limpos}/${baseline.total}  ->  candidata ${candidata.limpos}/${candidata.total}`);

  console.log('');
  console.log('##### CRITERIO DO GABRIEL (vira contrato final se atendido) #####');
  const atendeu = candidata.resolvidos === candidata.total && candidata.escolhasErradas === 0 && candidata.poluicaoProcedimento === 0 && candidata.poluicaoDentista === 0;
  console.log(atendeu ? 'ATENDIDO: 10/10 certo, zero escolha errada, zero poluicao.' : 'NAO ATENDIDO -- ver detalhamento acima.');
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal: ${mensagem}`);
  process.exitCode = 1;
});
