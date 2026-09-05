// Runner ISOLADO, avulso, chamado manualmente: prova contra a OpenAI REAL que
// a interpretadora RECONHECE um pedido de mais de um procedimento no mesmo
// turno (specs/multiplos-procedimentos-mesmo-turno-v1.md) -- emitindo o evento
// `pedido_multiplo` E deixando os campos combinados AUSENTES.
//
// POR QUE ESTE RUNNER EXISTE (achado da revisao do Codex, 2026-09-05): os
// testes de unidade (src/core/orquestrador-pedido-multiplo.test.ts) entregam o
// evento JA PRONTO pelo modelo falso. Eles provam o TRATAMENTO do sinal --
// roteamento, resposta generica, isolamento, continuidade ate a reserva --,
// mas nao provam o RECONHECIMENTO: que a IA real, lendo a mensagem do
// paciente, de fato emite o evento. Sem esta medicao, metade da correcao esta
// nao verificada.
//
// Usa o EXTRATOR DE PRODUCAO (construirEntradaMinimizada + extrairAlteracoes)
// e o MODELO DE PRODUCAO (MODELO_IRIS_NOVA), nao uma reimplementacao paralela
// do contrato.
//
// AS MENSAGENS DOS CASOS 1-4 SAO AS REAIS da conversa de origem (WhatsApp,
// Cleardent, 2026-09-05), com os erros de digitacao preservados exatamente
// como o paciente escreveu -- inclusive "Ciriguia" e "cirugia". Os
// procedimentos e ids sao sinteticos.
//
// Chave: somente via variavel de ambiente OPENAI_API_KEY (cofre canonico,
// .iris-secrets/openai.env), carregada exclusivamente por `node --env-file`.
// Este arquivo nunca abre, le, imprime ou edita nada dentro de .iris-secrets.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-pedido-multiplo.ts

import {
  criarClienteModeloOpenAI,
  ErroClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_IRIS_NOVA,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { construirEntradaMinimizada, extrairAlteracoes } from '../core/interpretacao-extrator.ts';
import { InterpretacaoInvalidaError, EntradaInvalidaError } from '../core/erros.ts';
import type { SnapshotOficialConversa } from '../core/interpretacao-tipos.ts';
import type { ParConversa } from '../core/tipos.ts';

const CIRURGIA = 'aaaaaaaa-1111-4111-8111-111111111111';
const RESTAURACAO = 'bbbbbbbb-2222-4222-8222-222222222222';
const CANAL = 'cccccccc-3333-4333-8333-333333333333';

const PROCEDIMENTOS = [
  { procedimento_id: CIRURGIA, nome_pt: 'Cirurgia de implante' },
  { procedimento_id: RESTAURACAO, nome_pt: 'Restauração / Cárie (1 face)' },
  { procedimento_id: CANAL, nome_pt: 'Retratamento de canal' },
];

// Os dois pendentes que a Iris anunciou -- e o contexto exato do caso real.
const TRATAMENTOS_PENDENTES = [
  { procedimento_id: CIRURGIA, nome_pt: 'Cirurgia de implante', dente: '31' },
  { procedimento_id: RESTAURACAO, nome_pt: 'Restauração / Cárie (1 face)', dente: '23' },
];

// O turno anterior da conversa real: a Iris listou os dois pendentes e
// perguntou. E este historico que da sentido a "esses dois procedimentos".
const HISTORICO_ANUNCIOU_OS_DOIS: ParConversa[] = [
  {
    mensagem_paciente: 'ola. boa noite',
    resposta_iris:
      'Boa noite, Carlos! Você já tem o retratamento de canal marcado para segunda-feira, 07/09 às 08:00. Também estão pendentes: Cirurgia de implante — dente 31; Restauração / Cárie (1 face) — dente 23. Você quer tratar do atendimento já marcado ou agendar um desses procedimentos pendentes?',
    gerada_em: '2026-09-05T03:51:00.000Z',
  },
];

const SEM_DADOS: SnapshotOficialConversa = {};

interface Caso {
  titulo: string;
  mensagem: string;
  historico?: ParConversa[];
  /** true = o evento `pedido_multiplo` DEVE ser emitido. */
  esperaEvento: boolean;
  /**
   * Quando o evento e esperado, os campos combinados precisam ficar AUSENTES
   * -- e essa ausencia que impede "terca, quinta" de entrar num campo que
   * guarda uma data so.
   */
  exigeCamposAusentes: boolean;
}

const CASOS: readonly Caso[] = Object.freeze([
  // --- POSITIVOS: as mensagens REAIS que quebraram a producao ---
  {
    titulo: 'CASO REAL turno 1 -- dois procedimentos, dois dias',
    mensagem:
      'Quero marcar esses dois procedimentos.. vamos marcar um pra terça pode ser? o outro para quinta. tem horarios pra esos dois dias?',
    historico: HISTORICO_ANUNCIOU_OS_DOIS,
    esperaEvento: true,
    exigeCamposAusentes: true,
  },
  {
    titulo: 'CASO REAL turno 2 -- a divisao explicita (com erro de digitacao)',
    mensagem: 'Ciriguia de implante pode ser na terça.. e restauração para quinta',
    historico: HISTORICO_ANUNCIOU_OS_DOIS,
    esperaEvento: true,
    exigeCamposAusentes: true,
  },
  {
    titulo: 'CASO REAL turno 4 -- dois periodos e dois horarios (a mensagem do silencio)',
    mensagem: 'na terça quero de manha. 10 hrs se tiver. e na quinta quero na parte da tarde 16hrs.',
    historico: HISTORICO_ANUNCIOU_OS_DOIS,
    esperaEvento: true,
    exigeCamposAusentes: true,
  },
  {
    titulo: 'dois procedimentos sem o historico do anuncio',
    mensagem: 'quero marcar a cirurgia de implante na terça e a restauração na quinta',
    esperaEvento: true,
    exigeCamposAusentes: true,
  },
  // --- NEGATIVOS: o que NAO pode virar pedido multiplo ---
  {
    titulo: 'NEGATIVO: um procedimento so, com dia e horario',
    mensagem: 'quero marcar a cirurgia de implante na terça de manhã',
    historico: HISTORICO_ANUNCIOU_OS_DOIS,
    esperaEvento: false,
    exigeCamposAusentes: false,
  },
  {
    titulo: 'NEGATIVO: alternativas do MESMO pedido (dois horarios possiveis)',
    mensagem: 'a cirurgia na terça, pode ser as 10 ou as 11',
    historico: HISTORICO_ANUNCIOU_OS_DOIS,
    esperaEvento: false,
    exigeCamposAusentes: false,
  },
  {
    titulo: 'NEGATIVO: pergunta sobre dois, sem pedir para agendar',
    mensagem: 'quanto custa a restauração e o implante?',
    historico: HISTORICO_ANUNCIOU_OS_DOIS,
    esperaEvento: false,
    exigeCamposAusentes: false,
  },
  {
    titulo: 'NEGATIVO: pediu dois MAS ja disse por qual comecar',
    mensagem: 'quero os dois, mas primeiro a cirurgia de implante, na terça',
    historico: HISTORICO_ANUNCIOU_OS_DOIS,
    esperaEvento: false,
    exigeCamposAusentes: false,
  },
]);

interface ResultadoCaso {
  titulo: string;
  sucesso: boolean;
  emitiuEvento: boolean;
  camposPresentes: string[];
  aprovado: boolean;
  motivoReprovacao: string | null;
  erro: { tipo: string; codigo: string | null } | null;
  duracao_ms: number;
}

const CAMPOS_COMBINAVEIS = ['procedimento_id', 'data_texto', 'periodo', 'horario_texto'];

async function executarCaso(cliente: ReturnType<typeof criarClienteModeloOpenAI>, caso: Caso): Promise<ResultadoCaso> {
  // Mesma montagem de producao (interpretar-e-aplicar.ts).
  const entrada = construirEntradaMinimizada(
    [caso.mensagem],
    SEM_DADOS,
    undefined, // horarios_oferecidos
    undefined, // proposta_pendente
    caso.historico,
    PROCEDIMENTOS,
    undefined, // dentistas_disponiveis
    undefined, // oferta_procedimento_pendente
    undefined, // cadastro_paciente
    undefined, // troca_telefone_pendente
    undefined, // agendamentos_ativos
    undefined, // agendamentos_do_paciente
    TRATAMENTOS_PENDENTES
  );

  const inicio = Date.now();
  try {
    const saida = await extrairAlteracoes(cliente, entrada);
    const emitiuEvento = saida.eventos_candidatos.some((e) => e.tipo === 'pedido_multiplo');
    const camposPresentes = CAMPOS_COMBINAVEIS.filter(
      (campo) => (saida.alteracoes as Record<string, unknown>)[campo] !== undefined
    );

    let motivoReprovacao: string | null = null;
    if (emitiuEvento !== caso.esperaEvento) {
      motivoReprovacao = caso.esperaEvento
        ? 'evento NAO emitido (o pedido multiplo passaria batido)'
        : 'evento emitido indevidamente (falso positivo)';
    } else if (caso.exigeCamposAusentes && camposPresentes.length > 0) {
      // Este e o ponto que causava o defeito: com os campos preenchidos, os
      // valores dos dois pedidos se misturam num campo que guarda um so.
      motivoReprovacao = `campos combinados presentes: ${camposPresentes.join(', ')}`;
    }

    return {
      titulo: caso.titulo,
      sucesso: true,
      emitiuEvento,
      camposPresentes,
      aprovado: motivoReprovacao === null,
      motivoReprovacao,
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
      emitiuEvento: false,
      camposPresentes: [],
      aprovado: false,
      motivoReprovacao: 'erro na chamada',
      erro: classificado,
      duracao_ms,
    };
  }
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error(
      'OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.'
    );
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: pedido de mais de um procedimento no mesmo turno ---');
  console.log(`modelo: ${MODELO_IRIS_NOVA} (o de producao)`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log(`total de casos: ${CASOS.length}`);
  console.log('');

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_IRIS_NOVA,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const resultados: ResultadoCaso[] = [];
  for (const caso of CASOS) {
    const resultado = await executarCaso(cliente, caso);
    resultados.push(resultado);

    console.log(`[espera evento: ${caso.esperaEvento}] ${caso.titulo}`);
    console.log(`  mensagem: ${JSON.stringify(caso.mensagem)}`);
    if (resultado.sucesso) {
      console.log(`  evento pedido_multiplo emitido: ${resultado.emitiuEvento}`);
      console.log(
        `  campos combinaveis preenchidos: ${resultado.camposPresentes.length > 0 ? resultado.camposPresentes.join(', ') : '(nenhum)'}`
      );
      console.log(`  APROVADO: ${resultado.aprovado}${resultado.motivoReprovacao ? ` -- ${resultado.motivoReprovacao}` : ''}`);
    } else if (resultado.erro) {
      console.log(`  erro: ${resultado.erro.tipo} codigo=${resultado.erro.codigo}`);
    }
    console.log(`  duracao: ${resultado.duracao_ms}ms`);
    console.log('');
  }

  const aprovados = resultados.filter((r) => r.aprovado).length;
  const positivos = CASOS.filter((c) => c.esperaEvento).length;
  const positivosOk = resultados.filter((r, i) => CASOS[i].esperaEvento && r.aprovado).length;
  const negativosOk = resultados.filter((r, i) => !CASOS[i].esperaEvento && r.aprovado).length;

  console.log('--- resumo ---');
  console.log(`total: ${aprovados}/${CASOS.length}`);
  console.log(`  reconhecimento (deve emitir): ${positivosOk}/${positivos}`);
  console.log(`  ausencia de falso positivo:   ${negativosOk}/${CASOS.length - positivos}`);

  process.exitCode = aprovados === CASOS.length ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
