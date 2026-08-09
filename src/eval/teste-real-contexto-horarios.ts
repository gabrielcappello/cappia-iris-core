// Runner ISOLADO, avulso, chamado manualmente: prova contra a OpenAI REAL
// que `horarios_oferecidos` (specs/contexto-pendente-interpretacao-v1.md)
// permite a IA interpretar respostas curtas e contextuais.
//
// Motivacao (achado real via WhatsApp, 2026-08-05): com a Iris oferecendo
// "13:00, 14:00, 15:00, 16:00" e o paciente respondendo "15 hrs", a IA nao
// tinha como saber que aquela era a resposta a uma escolha de horario --
// omitia o campo pela regra correta de "em duvida real, omita", e o Core
// repetia a lista indefinidamente.
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
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-contexto-horarios.ts

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

interface CasoContexto {
  titulo: string;
  mensagem: string;
  snapshot: SnapshotOficialConversa;
  /** Ausente = simula estado SEM contexto_horarios gravado. */
  horariosOferecidos?: string[];
  /** null = espera horario_texto AUSENTE do resultado. */
  horarioEsperado: string | null;
  /** Quando presente, tambem exige este data_texto no resultado. */
  dataEsperada?: string;
  /** Quando presente, tambem exige este valor em confirmacao. */
  confirmacaoEsperada?: string;
  /**
   * Lacuna JA CONHECIDA e FORA do escopo desta spec: o caso e executado e
   * reportado, mas nao entra no criterio de sucesso do runner. Nunca usar
   * para mascarar regressao de algo que esta spec cobre.
   */
  gapConhecido?: string;
}

// Estado tipico depois de "quero uma limpeza hoje" -> Iris ofereceu a grade.
const APOS_GRADE: SnapshotOficialConversa = { procedimento_id: 'cleaning', data_texto: 'hoje' };
const GRADE = ['13:00', '14:00', '15:00', '16:00'];

// Fixo, nunca aceito por argv/stdin/env -- mesmo espirito dos demais
// runners de src/eval/ (payload congelado no codigo).
const CASOS: readonly CasoContexto[] = Object.freeze([
  { titulo: '"15"', mensagem: '15', snapshot: APOS_GRADE, horariosOferecidos: GRADE, horarioEsperado: '15:00' },
  { titulo: '"15 hrs"', mensagem: '15 hrs', snapshot: APOS_GRADE, horariosOferecidos: GRADE, horarioEsperado: '15:00' },
  {
    titulo: '"quinze horas"',
    mensagem: 'quinze horas',
    snapshot: APOS_GRADE,
    horariosOferecidos: GRADE,
    horarioEsperado: '15:00',
  },
  {
    titulo: '"o segundo" (ordinal -- so a ordem da lista da sentido)',
    mensagem: 'o segundo',
    snapshot: APOS_GRADE,
    horariosOferecidos: GRADE,
    horarioEsperado: '14:00',
  },
  {
    // O horario ja esta em dados_atuais neste estado, entao o que faz "esse
    // mesmo" avancar o fluxo NAO e horario_texto (que corretamente fica
    // ausente -- campo nao mencionado nunca e reemitido), e sim
    // `confirmacao`. Medido em 2026-08-05 contra o modelo real: "isso mesmo"
    // e "sim" produzem confirmacao=sim; "esse mesmo" e "pode confirmar" NAO.
    // A causa e a regra de confirmacao estar ancorada numa lista fechada de
    // frases-exemplo -- mesma classe de problema que "15 hrs" tinha, mas em
    // OUTRA regra, fora do escopo desta spec (que so trata horario).
    titulo: '"esse mesmo" no estado de confirmacao (LACUNA CONHECIDA -- fora do escopo desta spec)',
    mensagem: 'esse mesmo',
    snapshot: { procedimento_id: 'cleaning', data_texto: 'hoje', horario_texto: '15:00' },
    horarioEsperado: null,
    confirmacaoEsperada: 'sim',
    gapConhecido: 'regra de confirmacao ancorada em lista fechada de frases; nao e sobre contexto de horario',
  },
  {
    titulo: 'NEGATIVO: "dia 15" SEM snapshot nunca vira 15:00',
    mensagem: 'dia 15',
    snapshot: { procedimento_id: 'cleaning' },
    horarioEsperado: null,
    dataEsperada: '15',
  },
  {
    titulo: 'NEGATIVO: horario fora da lista e preservado como dito, nunca aproximado',
    mensagem: 'na verdade prefiro 17:30',
    snapshot: APOS_GRADE,
    horariosOferecidos: GRADE,
    horarioEsperado: '17:30',
  },
  {
    titulo: 'NEGATIVO: mensagem sobre outro assunto nao inventa horario mesmo com snapshot',
    mensagem: 'voces atendem convenio?',
    snapshot: APOS_GRADE,
    horariosOferecidos: GRADE,
    horarioEsperado: null,
  },
]);

interface ResultadoCaso {
  titulo: string;
  sucesso: boolean;
  horarioObtido: string | undefined;
  dataObtida: string | undefined;
  bateComEsperado: boolean;
  alteracoes: unknown;
  natureza: string | undefined;
  erro: { tipo: string; codigo: string | null } | null;
  duracao_ms: number;
}

async function executarCaso(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  caso: CasoContexto
): Promise<ResultadoCaso> {
  const entrada = construirEntradaMinimizada([caso.mensagem], caso.snapshot, caso.horariosOferecidos);

  const inicio = Date.now();
  try {
    const saida = await extrairAlteracoes(cliente, entrada);
    const horarioObtido = saida.alteracoes.horario_texto?.valor;
    const dataObtida = saida.alteracoes.data_texto?.valor;

    const horarioBate =
      caso.horarioEsperado === null
        ? saida.alteracoes.horario_texto === undefined
        : horarioObtido === caso.horarioEsperado;
    // Para "dia 15" so exigimos que a data mencione 15 -- a forma exata
    // ("15", "dia 15") e livre; o que importa e nao ter virado horario.
    const dataBate = caso.dataEsperada === undefined ? true : (dataObtida ?? '').includes(caso.dataEsperada);
    const confirmacaoBate =
      caso.confirmacaoEsperada === undefined ? true : saida.alteracoes.confirmacao?.valor === caso.confirmacaoEsperada;

    return {
      titulo: caso.titulo,
      sucesso: true,
      horarioObtido,
      dataObtida,
      bateComEsperado: horarioBate && dataBate && confirmacaoBate,
      alteracoes: saida.alteracoes,
      natureza: saida.natureza_mensagem,
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

    return {
      titulo: caso.titulo,
      sucesso: false,
      horarioObtido: undefined,
      dataObtida: undefined,
      bateComEsperado: false,
      alteracoes: null,
      natureza: undefined,
      erro: classificado,
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

  console.log('--- teste real: contexto de horarios oferecidos ---');
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

    console.log(`[esperado: ${caso.horarioEsperado ?? 'horario ausente'}] ${resultado.titulo}`);
    console.log(`  mensagem: ${JSON.stringify(caso.mensagem)}`);
    console.log(`  horarios_oferecidos: ${caso.horariosOferecidos ? JSON.stringify(caso.horariosOferecidos) : '(ausente)'}`);
    console.log(`  sucesso: ${resultado.sucesso}`);
    if (resultado.sucesso) {
      console.log(`  horario_texto obtido: ${resultado.horarioObtido ?? '(ausente)'}`);
      if (caso.dataEsperada !== undefined) {
        console.log(`  data_texto obtida: ${resultado.dataObtida ?? '(ausente)'}`);
      }
      console.log(`  natureza_mensagem: ${resultado.natureza}`);
      console.log(`  bate com esperado: ${resultado.bateComEsperado}`);
      console.log(`  alteracoes completas: ${JSON.stringify(resultado.alteracoes)}`);
    } else if (resultado.erro) {
      console.log(`  erro: ${resultado.erro.tipo} codigo=${resultado.erro.codigo}`);
    }
    console.log(`  duracao: ${resultado.duracao_ms}ms`);
    console.log('');
  }

  // Lacunas conhecidas sao reportadas, mas nao entram no criterio de
  // sucesso -- elas pertencem a outra regra, fora desta spec.
  const noEscopo = CASOS.filter((c) => c.gapConhecido === undefined);
  const resultadosNoEscopo = resultados.filter((_, i) => CASOS[i].gapConhecido === undefined);
  const totalCorreto = resultadosNoEscopo.filter((r) => r.sucesso && r.bateComEsperado).length;

  console.log('--- resumo ---');
  console.log(`no escopo desta spec: ${totalCorreto}/${noEscopo.length}`);
  for (const [i, caso] of CASOS.entries()) {
    if (caso.gapConhecido === undefined) continue;
    console.log(`lacuna conhecida (${resultados[i].bateComEsperado ? 'RESOLVIDA' : 'ainda aberta'}): ${caso.titulo}`);
    console.log(`  motivo: ${caso.gapConhecido}`);
  }

  process.exitCode = totalCorreto === noEscopo.length ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
