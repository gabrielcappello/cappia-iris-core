// Runner ISOLADO, avulso, chamado manualmente: percorre a CONVERSA INTEIRA do
// caso de origem contra a OpenAI REAL, com interpretadora E redatora reais,
// agenda e persistencia simuladas -- specs/multiplos-procedimentos-mesmo-turno-v1.md,
// secao 5.
//
// POR QUE ESTE RUNNER EXISTE (achado da revisao do Codex, 2026-09-05): as
// evidencias anteriores cobriam as pontas, nunca o percurso:
//
//   - os testes de unidade injetavam o evento pronto pelo modelo falso, e
//     entregavam `confirmacao: 'sim'` no MESMO turno em que os horarios eram
//     oferecidos -- pulando exatamente o passo (proposta concreta -> resposta
//     do paciente -> confirmacao) que o defeito original atravessou;
//   - o runner de reconhecimento (teste-real-pedido-multiplo.ts) media UM
//     turno isolado, com um historico resumido, nunca a conversa encadeada;
//   - a REDATORA real nunca havia sido medida neste fluxo: a garantia de
//     resposta generica era estrutural (a decisao nao carrega nomes), mas
//     nunca observada em texto produzido pelo modelo.
//
// O QUE ESTE RUNNER FAZ, turno a turno, exatamente como producao (index.ts):
//   interpretadora real -> orquestrador -> redatora real -> grava historico
// e o historico gravado alimenta o turno seguinte. Nada e injetado: cada
// mensagem do paciente e lida pela IA como seria no WhatsApp.
//
// SIMULADO (nunca rede real): banco (ClienteFalso), RPCs de cadastro/reserva
// (ClienteRpcFalso) e a agenda derivada do catalogo sintetico. REAL: os dois
// modelos, o extrator, o orquestrador, a redatora e as guardas.
//
// As mensagens do paciente sao as REAIS da conversa de origem (WhatsApp,
// Cleardent, 2026-09-05), com os erros de digitacao preservados. Procedimentos,
// ids, nomes e telefone sao sinteticos.
//
// Chave: somente via variavel de ambiente OPENAI_API_KEY (cofre canonico,
// .iris-secrets/openai.env), carregada exclusivamente por `node --env-file`.
// Este arquivo nunca abre, le, imprime ou edita nada dentro de .iris-secrets.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-conversa-pedido-multiplo.ts

import {
  criarClienteModeloOpenAI,
  MODELO_IRIS_NOVA,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import {
  criarClienteModeloRedatorOpenAI,
  TIMEOUT_REDATOR_MS_APROVADO,
} from '../core/cliente-modelo-redator-openai.ts';
import { processarMensagem } from '../core/orquestrador.ts';
import { gerarRespostaConversacional } from '../core/gerar-resposta-conversacional.ts';
import { gravarHistoricoConversa } from '../core/historico-conversa.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from '../core/teste-cliente-falso.ts';
import { ClienteRpcFalso } from '../core/teste-cliente-rpc-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
// Sexta-feira: a terca (08/09) e a quinta (10/09) pedidas caem na semana
// seguinte, como no caso real.
const INSTANTE_ATUAL = { data: '2026-09-04', minuto_min: 480 };

const CIRURGIA = 'aaaaaaaa-1111-4111-8111-111111111111';
const RESTAURACAO = 'bbbbbbbb-2222-4222-8222-222222222222';
const DENTISTA = 'dddddddd-4444-4444-8444-444444444444';
const CLINICA = 'cccccccc-5555-4555-8555-555555555555';

function montarCenario(tabelas: TabelasFalsas): void {
  tabelas.clinicas.push({
    id: CLINICA,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    nome: 'Cleardent',
    dentistas: [
      {
        id: DENTISTA,
        nome: 'Pablo Arruda',
        titulo: 'Dr.',
        ativo: true,
        modo: 'auto',
        dur: 30,
        inicio: '08:00',
        fim: '18:00',
        sabado: false,
        alm_ini: null,
        alm_fim: null,
        procedimentos: [
          { id: CIRURGIA, nome: 'Cirurgia de implante', ativo: true, tempo: 60 },
          { id: RESTAURACAO, nome: 'Restauração / Cárie (1 face)', ativo: true, tempo: 30 },
        ],
      },
    ],
  });
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: CLINICA,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: null,
    atualizado_em: new Date('2026-09-04T00:00:00.000Z').toISOString(),
  });
  for (const [id, nome, tempo] of [
    [CIRURGIA, 'Cirurgia de implante', 60],
    [RESTAURACAO, 'Restauração / Cárie (1 face)', 30],
  ] as const) {
    tabelas.procedimentos_catalogo.push({
      id,
      nome_pt: nome,
      nome_es: null,
      nome_en: null,
      nome_fr: null,
      nome_de: null,
      nome_it: null,
      nome_ru: null,
      nome_ar: null,
      tempo_padrao: tempo,
      ativo: true,
    });
  }
}

/** As mensagens REAIS do paciente, na ordem exata da conversa de origem. */
const CONVERSA: readonly { mensagem: string; espera: string }[] = Object.freeze([
  {
    mensagem:
      'Quero marcar esses dois procedimentos.. vamos marcar um pra terça pode ser? o outro para quinta. tem horarios pra esos dois dias?',
    espera: 'pedido_multiplo_detectado',
  },
  { mensagem: 'cirugia de implante primeiro entao', espera: 'qualquer' },
  { mensagem: 'pode ser terça de manhã', espera: 'qualquer' },
  { mensagem: '10 hrs', espera: 'qualquer' },
  { mensagem: 'isso mesmo, pode confirmar', espera: 'qualquer' },
  {
    mensagem: 'Carlos Cappello, 529.982.247-25, nasci em 02/08/1973',
    espera: 'qualquer',
  },
]);

/** Palavras que a resposta do turno 1 NAO pode conter (spec secao 3.3). */
const NOMES_PROIBIDOS_NO_TURNO_1 = ['implante', 'restaura', 'cárie', 'carie', 'canal'];

function linhaConversa(tabelas: TabelasFalsas) {
  return tabelas.estado_conversa[0] as unknown as {
    id: string;
    dados: Record<string, string>;
    historico_conversa: unknown;
    atualizado_em: string;
  };
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

  console.log('--- teste real: CONVERSA ENCADEADA do pedido multiplo ---');
  console.log(`modelo (interpretadora e redatora): ${MODELO_IRIS_NOVA}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log('banco, RPCs e agenda: SIMULADOS. IA: real nas duas pontas.');
  console.log('');

  const clienteModelo = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_IRIS_NOVA,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });
  const clienteRedator = criarClienteModeloRedatorOpenAI({
    chaveApi,
    modelo: MODELO_IRIS_NOVA,
    timeoutMs: TIMEOUT_REDATOR_MS_APROVADO,
  });

  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteRpc = new ClienteRpcFalso({
    cappia_persistir_paciente: { data: { sucesso: true, paciente_id: crypto.randomUUID() }, error: null },
    cappia_reservar_agendamento: {
      data: {
        sucesso: true,
        agendamento_id: crypto.randomUUID(),
        dentista_id: DENTISTA,
        duracao_min: 60,
        data: '2026-09-08',
        horario: '10:00',
      },
      error: null,
    },
  });

  const decisoes: string[] = [];
  const respostas: string[] = [];
  let falhas = 0;

  for (const [indice, turno] of CONVERSA.entries()) {
    const numero = indice + 1;

    // MESMO percurso de producao (index.ts): orquestrador -> redatora ->
    // grava historico, e o historico gravado alimenta o turno seguinte.
    const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpc, {
      provider: PROVIDER,
      instancia_whatsapp: INSTANCIA,
      telefone_normalizado: TELEFONE,
      mensagens_atuais: [turno.mensagem],
      instante_atual: INSTANTE_ATUAL,
    });

    const { resposta, motivo_fallback } = await gerarRespostaConversacional(clienteRedator, {
      decisao: resultado.decisao,
      mensagemPaciente: turno.mensagem,
      naturezaMensagem: resultado.natureza_mensagem,
      historicoConversa: resultado.historico_conversa,
      dataHoje: INSTANTE_ATUAL.data,
      cadastroConhecido: resultado.cadastro_conhecido,
      ...(resultado.clinica_conhecida !== undefined ? { clinicaConhecida: resultado.clinica_conhecida } : {}),
      ...(resultado.tratamentos_aprovados !== undefined
        ? { tratamentosAprovados: resultado.tratamentos_aprovados }
        : {}),
      ...(resultado.agendamentos_do_paciente !== undefined
        ? { agendamentosDoPaciente: resultado.agendamentos_do_paciente }
        : {}),
      ...(resultado.dentistas_da_clinica !== undefined
        ? { dentistasDaClinica: resultado.dentistas_da_clinica }
        : {}),
    });

    await gravarHistoricoConversa(clienteBanco, {
      conversa_id: resultado.conversa_id,
      clinica_id: resultado.clinica_id,
      telefone_normalizado: TELEFONE,
      atualizado_em_da_resposta: resultado.atualizado_em,
      historico_anterior: resultado.historico_conversa,
      mensagem_paciente: turno.mensagem,
      resposta_iris: resposta,
    });

    decisoes.push(resultado.decisao.tipo);
    respostas.push(resposta);

    console.log(`── TURNO ${numero} ──`);
    console.log(`  paciente: ${JSON.stringify(turno.mensagem)}`);
    console.log(`  decisao:  ${resultado.decisao.tipo}`);
    console.log(`  Iris:     ${JSON.stringify(resposta)}`);
    if (motivo_fallback !== null) console.log(`  (fallback: ${motivo_fallback})`);

    // --- Verificacoes por turno ---
    if (numero === 1) {
      if (resultado.decisao.tipo !== 'pedido_multiplo_detectado') {
        console.log('  ✖ FALHA: o pedido multiplo tinha de ser reconhecido JA no primeiro turno');
        falhas++;
      }
      if (motivo_fallback !== null) {
        console.log('  ✖ FALHA: a REDATORA REAL precisa ter produzido o texto (sem fallback) para a medicao valer');
        falhas++;
      }
      const minuscula = resposta.toLowerCase();
      const vazou = NOMES_PROIBIDOS_NO_TURNO_1.filter((n) => minuscula.includes(n));
      if (vazou.length > 0) {
        console.log(`  ✖ FALHA: a resposta citou procedimento (${vazou.join(', ')}) -- tinha de ser generica`);
        falhas++;
      } else {
        console.log('  ✔ resposta generica: nenhum procedimento citado pelo nome');
      }
      // Reconhece o pedido e pergunta qual primeiro.
      const perguntou = resposta.includes('?');
      if (!perguntou) {
        console.log('  ✖ FALHA: a resposta precisa PERGUNTAR qual procedimento vem primeiro');
        falhas++;
      }
    }
  }

  // --- Verificacoes do percurso inteiro ---
  console.log('');
  console.log('--- percurso ---');
  console.log(decisoes.map((d, i) => `  turno ${i + 1}: ${d}`).join('\n'));

  // 1. O percurso passou pela PROPOSTA CONCRETA antes da confirmacao -- e o
  //    passo que os testes de unidade puderam pular ao injetar confirmacao.
  const passouPorProposta = decisoes.includes('aguardando_confirmacao');
  // 2. Ofereceu horarios reais em algum ponto.
  const ofereceuHorarios = decisoes.includes('horarios_disponiveis');
  // 3. Terminou em reserva.
  const reservou = decisoes.includes('reserva_criada');

  console.log('');
  console.log('--- verificacoes do percurso ---');
  console.log(`  ofereceu horarios reais:            ${ofereceuHorarios ? '✔' : '✖'}`);
  console.log(`  passou por proposta concreta:       ${passouPorProposta ? '✔' : '✖'}`);
  console.log(`  chegou a reserva:                   ${reservou ? '✔' : '✖'}`);

  if (!ofereceuHorarios) falhas++;
  if (!passouPorProposta) falhas++;
  if (!reservou) falhas++;

  // 4. A reserva foi do procedimento ESCOLHIDO -- nunca do outro.
  const chamadaReserva = clienteRpc.chamadas.find((c) => c.nome === 'cappia_reservar_agendamento');
  if (chamadaReserva === undefined) {
    console.log('  reserva chamada:                    ✖ (nunca aconteceu)');
    falhas++;
  } else {
    const parametros = JSON.stringify(chamadaReserva.parametros);
    const temEscolhido = parametros.includes(CIRURGIA);
    const temOutro = parametros.includes(RESTAURACAO);
    console.log(`  reserva do procedimento escolhido:  ${temEscolhido ? '✔' : '✖'}`);
    console.log(`  procedimento NAO escolhido ausente: ${!temOutro ? '✔' : '✖'}`);
    if (!temEscolhido) falhas++;
    if (temOutro) falhas++;
  }

  // 5. Nenhuma data/horario COMBINADO sobreviveu no estado.
  const dados = linhaConversa(tabelas).dados;
  const dataCombinada = String(dados.data_texto ?? '').includes(',');
  console.log(`  estado sem data combinada:          ${!dataCombinada ? '✔' : '✖'}`);
  if (dataCombinada) falhas++;

  console.log('');
  console.log('--- resumo ---');
  console.log(falhas === 0 ? 'APROVADO: conversa completa sem loop, sem silencio, sem mistura.' : `REPROVADO: ${falhas} falha(s).`);

  process.exitCode = falhas === 0 ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
