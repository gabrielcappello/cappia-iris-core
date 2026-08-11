// Runner ISOLADO, avulso: MEDICAO DE CANDIDATO DE INSTRUCAO. Nao implementa
// nada -- nenhum modulo de producao e alterado por este arquivo.
//
// PERGUNTA: a colisao de responsabilidade no turno de escolha entre varios
// agendamentos (diagnostico de 2026-08-11: 13/16 rodadas emitiram
// `procedimento_id` em vez de `agendamento_id`) pode ser resolvida SO no
// contrato/instrucao da interpretadora, sem evento novo, sem parser, sem
// camada nova?
//
// COMO: monta a instrucao candidata a partir de INSTRUCOES_EXTRATOR (a de
// producao) por substituicao de UMA linha, e chama o cliente de modelo
// DIRETAMENTE (cliente.executar) com o SCHEMA DE PRODUCAO. Nada e escrito em
// src/core.
//
// PAYLOAD FIEL: `agendamentos_ativos` + `procedimentos_disponiveis` +
// `dentistas_disponiveis`, exatamente como orquestrador.ts envia. As medicoes
// de 2026-08-11 que omitiram as duas ultimas mediram um estado que producao
// nunca produz.
//
// TRES CHECAGENS por rodada, nao uma:
//   1. `agendamento_id` resolveu para o alvo certo?
//   2. `procedimento_id` ficou AUSENTE? (poluicao direta)
//   3. `dentistas_candidatos` ficou nulo/vazio? (poluicao INDIRETA -- a IA
//      nunca emite `dentista_id`, mas o Core o escreve a partir de um
//      candidato unico, em aplicarCandidatoUnicoDeDentista)
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-precedencia-escolha-agendamento.ts

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

// --- CANDIDATO: mesma linha + regra explicita de PRECEDENCIA e EXCLUSIVIDADE ---
const LINHA_CANDIDATA =
  '- Quando "agendamentos_ativos" estiver presente, a unica pergunta em aberto e QUAL DESSES AGENDAMENTOS o paciente quer — nada mais. Ele lista os agendamentos que o paciente ja tem, cada um com seu "agendamento_id" e uma "descricao" (procedimento, profissional, data e horario). Uma mencao a procedimento, profissional, data, dia da semana, horario ou ordinal nesse turno E a resposta a essa pergunta: use-a para identificar o agendamento e preencha SOMENTE "agendamento_id", com o valor copiado LITERALMENTE da lista — nunca um nome, nunca o texto do paciente, nunca um id inventado. Enquanto "agendamentos_ativos" estiver presente, essa mencao NUNCA preenche "procedimento_id" e NUNCA entra em "dentistas_candidatos" (que deve ser null): ela nao e um pedido de procedimento novo nem uma escolha de profissional, e sim a identificacao de um agendamento existente. Em duvida real sobre qual dos agendamentos ele quer, omita "agendamento_id" e nao emita nenhum outro campo no lugar — nunca escolha por aproximacao. Quando "agendamentos_ativos" nao estiver presente, nunca emita "agendamento_id".';

function instrucoesCandidatas(): string {
  if (!INSTRUCOES_EXTRATOR.includes(LINHA_PRODUCAO)) {
    throw new Error('A linha de producao nao foi encontrada em INSTRUCOES_EXTRATOR -- o runner esta desatualizado.');
  }
  return INSTRUCOES_EXTRATOR.replace(LINHA_PRODUCAO, LINHA_CANDIDATA);
}

// --- Catalogo e agenda (fiel a producao) ---
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

// Datas VERIFICADAS: 2026-08-14 e sexta-feira; 2026-08-20 e quinta-feira.
// Assim "o de sexta" identifica UM item de forma inequivoca.
const DESC_A = 'Limpeza dental com Dra. Ana Souza em 14/08 às 14:00';
const DESC_B = 'Implante dentário com Dr. Bruno Lima em 20/08 às 09:00';

type Alvo = 'A' | 'B' | 'PRIMEIRO';

interface Frase {
  mensagem: string;
  alvo: Alvo;
  categoria: string;
}

// As cinco frases pedidas -- curtas e naturais, como um paciente responderia
// a "qual desses dois voce quer remarcar?".
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
  poluiuProcedimento: boolean;
  poluiuDentista: boolean;
  detalhe: string;
}

function avaliar(saida: unknown, rodada: Rodada): Veredito {
  validarSaidaInterpretacao(saida);
  const alteracoes = saida.alteracoes as Record<string, { acao: string; valor?: string } | undefined>;
  const agendamentoId = alteracoes.agendamento_id?.valor;
  const procedimentoId = alteracoes.procedimento_id?.valor;
  const dentistasCandidatos = saida.dentistas_candidatos;

  const resolveuCerto = agendamentoId === rodada.idEsperado;
  const poluiuProcedimento = procedimentoId !== undefined;
  const poluiuDentista = Array.isArray(dentistasCandidatos) && dentistasCandidatos.length > 0;

  const partes: string[] = [];
  partes.push(resolveuCerto ? 'agendamento_id OK' : `agendamento_id=${agendamentoId ?? '(ausente)'}`);
  if (poluiuProcedimento) partes.push(`POLUIU procedimento_id="${procedimentoId}"`);
  if (poluiuDentista) partes.push(`POLUIU dentistas_candidatos=${JSON.stringify(dentistasCandidatos)}`);

  return { resolveuCerto, poluiuProcedimento, poluiuDentista, detalhe: partes.join(' | ') };
}

interface Placar {
  resolvidos: number;
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

  const placar: Placar = { resolvidos: 0, poluicaoProcedimento: 0, poluicaoDentista: 0, limpos: 0, total: rodadas.length };

  for (const rodada of rodadas) {
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
      veredito = avaliar(saida, rodada);
    } catch (erro) {
      veredito = {
        resolveuCerto: false,
        poluiuProcedimento: false,
        poluiuDentista: false,
        detalhe: `ERRO: ${erro instanceof Error ? erro.message : 'desconhecido'}`,
      };
    }

    if (veredito.resolveuCerto) placar.resolvidos++;
    if (veredito.poluiuProcedimento) placar.poluicaoProcedimento++;
    if (veredito.poluiuDentista) placar.poluicaoDentista++;
    if (veredito.resolveuCerto && !veredito.poluiuProcedimento && !veredito.poluiuDentista) placar.limpos++;

    const marca = veredito.resolveuCerto && !veredito.poluiuProcedimento && !veredito.poluiuDentista ? 'OK ' : '-- ';
    console.log(`${marca}"${rodada.frase.mensagem}" (${rodada.frase.categoria}, A na pos ${rodada.posicaoDeA})`);
    console.log(`     ${veredito.detalhe}`);
  }

  console.log('');
  console.log(`  resolveu o agendamento certo : ${placar.resolvidos}/${placar.total}`);
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

  console.log('--- medicao: precedencia no turno de escolha de agendamento ---');
  console.log('CANDIDATO E APENAS INSTRUCAO -- nenhum evento novo, nenhum parser, nenhuma camada.');
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

  const baseline = await executarVariante(cliente, 'A -- instrucao de PRODUCAO (baseline)', INSTRUCOES_EXTRATOR, rodadas);
  const candidata = await executarVariante(cliente, 'B -- instrucao CANDIDATA (precedencia explicita)', instrucoesCandidatas(), rodadas);

  console.log('');
  console.log('##### COMPARACAO #####');
  console.log(`  resolveu certo   : producao ${baseline.resolvidos}/${baseline.total}  ->  candidata ${candidata.resolvidos}/${candidata.total}`);
  console.log(`  poluiu proc_id   : producao ${baseline.poluicaoProcedimento}/${baseline.total}  ->  candidata ${candidata.poluicaoProcedimento}/${candidata.total}`);
  console.log(`  poluiu dentistas : producao ${baseline.poluicaoDentista}/${baseline.total}  ->  candidata ${candidata.poluicaoDentista}/${candidata.total}`);
  console.log(`  LIMPO            : producao ${baseline.limpos}/${baseline.total}  ->  candidata ${candidata.limpos}/${candidata.total}`);
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal: ${mensagem}`);
  process.exitCode = 1;
});
