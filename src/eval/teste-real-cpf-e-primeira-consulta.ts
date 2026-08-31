// Runner ISOLADO, avulso, chamado manualmente: prova de PONTA A PONTA, com as
// DUAS IAs reais (interpretadora + redatora) e o Core real, sem tocar em
// nenhum Supabase (o "banco" e o dublê em memoria de teste-cliente-falso.ts).
//
// Por que este arquivo existe (revisao do Codex, 2026-08-31): o teste
// deterministico de "insistencia" NAO provava o que dizia provar. Ele escrevia
// a resposta da Iris no historico a mao e usava um modelo falso que devolvia o
// CPF de novo no turno 2 -- mesmo quando a mensagem do paciente era so "sim, e
// esse mesmo". Isso mede o dublê, nao a Luna.
//
// Aqui NADA e injetado:
//   - a interpretadora real le a mensagem e decide o que extrair;
//   - o Core real valida, rejeita e monta os fatos;
//   - a redatora real escreve a resposta;
//   - o historico do turno 1 e EXATAMENTE o que a Iris respondeu, gravado pelo
//     mesmo `gravarHistoricoConversa` do fluxo de producao.
//
// FLUXO A -- CPF invalido e insistencia (2 turnos):
//   turno 1: paciente envia um CPF com digito verificador errado;
//   turno 2: paciente responde apenas "sim, e esse mesmo, pode cadastrar assim".
//   A pergunta em aberto e REAL: a Luna consegue recuperar do historico qual
//   numero esta em discussao, sem que ninguem o reinjete? Se nao conseguir, o
//   relatorio diz isso -- nenhum estado ou fallback e criado por conta propria.
//
// FLUXO B -- "e minha primeira consulta" (1 turno):
//   prova que a INTERPRETADORA resolve semanticamente para Consulta/Avaliacao
//   pelo catalogo, e que o fluxo NAO cai em `aguardando_procedimento`.
//   `procedimento_avaliacao_disponivel` nunca e injetado a mao aqui.
//
// Dados sinteticos e ficticios. O CPF invalido usado (12345678900) e um numero
// de teste classico, nao pertence a ninguem.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-cpf-e-primeira-consulta.ts

import { processarMensagem, CONSULTA_AVALIACAO_ID } from '../core/orquestrador.ts';
import { gerarRespostaConversacional } from '../core/gerar-resposta-conversacional.ts';
import { gravarHistoricoConversa } from '../core/historico-conversa.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from '../core/teste-cliente-falso.ts';
import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_IRIS_NOVA,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { criarClienteModeloRedatorOpenAI, TIMEOUT_REDATOR_MS_APROVADO } from '../core/cliente-modelo-redator-openai.ts';
import type { ClienteBancoDados } from '../core/tipos.ts';
import type { ClienteRpc } from '../core/mensagens-recebidas-tipos.ts';

const PROVIDER = 'local';
const INSTANCIA = 'eval-cpf';
const TELEFONE = '5511900000123';
const CPF_INVALIDO = '12345678900';
const INSTANTE_ATUAL = { data: '2026-09-01', minuto_min: 540 }; // terca-feira

const ID_LIMPEZA = 'limpeza';

/**
 * RPC ESPIA: registra toda chamada, para o teste poder afirmar que NENHUMA
 * escrita aconteceu enquanto o cadastro estava invalido.
 *
 * `cappia_reservar_agendamento` e a unica que responde com sucesso -- ela e
 * necessaria para a conversa CHEGAR ao ponto em que o cadastro e cobrado
 * (o Core so pede cadastro depois da confirmacao do horario). No fluxo A ela
 * nunca deve ser alcancada, porque o cadastro invalido barra antes; e
 * exatamente isso que a verificacao mede.
 */
class ClienteRpcEspiao implements ClienteRpc {
  readonly chamadas: { nome: string }[] = [];
  async rpc(nome: string, parametros: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
    this.chamadas.push({ nome });
    if (nome === 'cappia_reservar_agendamento') {
      return {
        data: {
          sucesso: true,
          agendamento_id: crypto.randomUUID(),
          dentista_id: parametros.p_dentista_id,
          duracao_min: 30,
          data: parametros.p_data,
          horario: parametros.p_horario,
        },
        error: null,
      };
    }
    throw new Error(`RPC inesperada neste cenario: ${nome}`);
  }
}

function semearClinica(tabelas: TabelasFalsas): string {
  const clinicaId = crypto.randomUUID();
  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [
      {
        id: crypto.randomUUID(),
        nome: 'Ana',
        titulo: 'Dra.',
        ativo: true,
        modo: 'procedimento',
        inicio: '08:00',
        fim: '18:00',
        sabado: false,
        alm_ini: '12:00',
        alm_fim: '13:00',
        procedimentos: [
          { id: ID_LIMPEZA, nome: 'Limpeza', tempo: 30, ativo: true },
          // Catalogo REALISTA: a avaliacao usa o id canonico, como em producao.
          { id: CONSULTA_AVALIACAO_ID, nome: 'Consulta / Avaliação', tempo: 20, ativo: true },
        ],
      },
    ],
  });
  for (const [id, nome, tempo] of [
    [ID_LIMPEZA, 'Limpeza', 30],
    [CONSULTA_AVALIACAO_ID, 'Consulta / Avaliação', 20],
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
  return clinicaId;
}

function semearConversa(tabelas: TabelasFalsas, clinicaId: string, pacienteId: string | null) {
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: pacienteId,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
}

interface Turno {
  mensagem: string;
  decisao: string;
  resposta: string;
  cpfRejeitado: string | undefined;
  camposInvalidos: readonly string[] | undefined;
  procedimentoIdNosDados: unknown;
  cpfNosDados: unknown;
}

async function rodarTurno(
  clienteModelo: ReturnType<typeof criarClienteModeloOpenAI>,
  clienteRedator: ReturnType<typeof criarClienteModeloRedatorOpenAI>,
  clienteBanco: ClienteBancoDados,
  clienteRpc: ClienteRpc,
  tabelas: TabelasFalsas,
  mensagem: string
): Promise<Turno> {
  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: [mensagem],
    instante_atual: INSTANTE_ATUAL,
  });

  const { resposta } = await gerarRespostaConversacional(clienteRedator, {
    decisao: resultado.decisao,
    mensagemPaciente: mensagem,
    naturezaMensagem: resultado.natureza_mensagem,
    historicoConversa: resultado.historico_conversa,
    dataHoje: INSTANTE_ATUAL.data,
  });

  // Historico REAL, gravado pelo mesmo caminho da producao -- nunca escrito
  // a mao neste arquivo.
  await gravarHistoricoConversa(clienteBanco, {
    conversa_id: resultado.conversa_id,
    clinica_id: resultado.clinica_id,
    telefone_normalizado: TELEFONE,
    atualizado_em_da_resposta: resultado.atualizado_em,
    historico_anterior: resultado.historico_conversa,
    mensagem_paciente: mensagem,
    resposta_iris: resposta,
  });

  const linha = tabelas.estado_conversa.find((c) => c.telefone_normalizado === TELEFONE) as unknown as {
    dados: Record<string, unknown>;
  };
  const decisao = resultado.decisao as {
    tipo: string;
    cpf_rejeitado?: string;
    campos_invalidos?: readonly string[];
  };

  return {
    mensagem,
    decisao: decisao.tipo,
    resposta,
    cpfRejeitado: decisao.cpf_rejeitado,
    camposInvalidos: decisao.campos_invalidos,
    procedimentoIdNosDados: linha.dados.procedimento_id,
    cpfNosDados: linha.dados.cpf,
  };
}

function imprimirTurno(rotulo: string, t: Turno): void {
  console.log(`${rotulo}`);
  console.log(`  paciente: ${JSON.stringify(t.mensagem)}`);
  console.log(`  decisao do Core: ${t.decisao}`);
  console.log(`  cpf_rejeitado: ${t.cpfRejeitado ?? '(ausente)'}`);
  console.log(`  campos_invalidos: ${t.camposInvalidos ? JSON.stringify(t.camposInvalidos) : '(ausente)'}`);
  console.log(`  iris: ${t.resposta}`);
  console.log('');
}

// --- Verificacoes de texto. Instrumento de MEDICAO, nunca regra de produto:
// nenhuma destas expressoes existe no prompt nem no Core.
const AFIRMA_ACEITOU = /cadastro (realizado|conclu[ií]do|feito)|pronto[,.]? (est[aá]|seu)|dados salvos|cadastrei|salvei|registrado com sucesso/i;
const PEDE_CONFIRMACAO_SIM_NAO = /confirma\?|est[aá] correto\?|pode confirmar|responda sim ou n[aã]o|digite sim/i;
const EXPLICA_LIMITE = /n[aã]o (consigo|posso|foi poss[ií]vel)|n[aã]o (vai|da|d[aá]) para (salvar|cadastrar)|inv[aá]lid|n[aã]o (passou|confere|bate)|d[ií]gito/i;

interface Verificacao {
  nome: string;
  ok: boolean;
  detalhe: string;
}

async function fluxoA(chaveApi: string): Promise<Verificacao[]> {
  console.log('=== FLUXO A: CPF invalido + insistencia (2 turnos, tudo real) ===');
  console.log('');

  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  semearConversa(tabelas, clinicaId, null); // paciente NOVO -- cadastro sera pedido
  const clienteBanco = new ClienteFalso(tabelas) as unknown as ClienteBancoDados;
  const clienteRpc = new ClienteRpcEspiao();

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

  // PRE-TURNOS: o cadastro so e cobrado DEPOIS da confirmacao do horario
  // (orquestrador.ts, "CADASTRO -- depois da confirmacao do horario, nunca
  // antes"). Entao a conversa precisa mesmo chegar ate la antes de o CPF ser
  // validado. Estes turnos sao o caminho real, nao um atalho: escolher
  // procedimento, ver horarios e confirmar.
  const p1 = await rodarTurno(clienteModelo, clienteRedator, clienteBanco, clienteRpc, tabelas,
    'quero marcar uma limpeza');
  imprimirTurno('--- pre-turno 1 (escolhe procedimento) ---', p1);

  const p2 = await rodarTurno(clienteModelo, clienteRedator, clienteBanco, clienteRpc, tabelas,
    'pode ser amanha de manha');
  imprimirTurno('--- pre-turno 2 (pede horario) ---', p2);

  const p3 = await rodarTurno(clienteModelo, clienteRedator, clienteBanco, clienteRpc, tabelas,
    'o primeiro horario esta otimo, confirmo');
  imprimirTurno('--- pre-turno 3 (confirma) ---', p3);

  // Turno 1 do fluxo em teste -- agora o Core PEDE cadastro, e o paciente
  // responde com os tres dados, um deles invalido.
  const t1 = await rodarTurno(
    clienteModelo,
    clienteRedator,
    clienteBanco,
    clienteRpc,
    tabelas,
    'sou Gabriel Cappello, cpf 123.456.789-00, nasci em 10/05/1985'
  );
  imprimirTurno('--- turno 1 (CPF invalido) ---', t1);

  // Turno 2 -- o paciente SO insiste. Nenhum CPF e reinjetado aqui.
  const t2 = await rodarTurno(
    clienteModelo,
    clienteRedator,
    clienteBanco,
    clienteRpc,
    tabelas,
    'sim, e esse mesmo, pode cadastrar assim'
  );
  imprimirTurno('--- turno 2 (insistencia) ---', t2);

  return [
    {
      nome: 'turno 1: CPF rejeitado pelo Core',
      ok: t1.camposInvalidos?.includes('cpf') === true,
      detalhe: `campos_invalidos=${JSON.stringify(t1.camposInvalidos)}`,
    },
    {
      nome: 'turno 1: o numero lido volta para a Iris repetir',
      ok: t1.cpfRejeitado === CPF_INVALIDO,
      detalhe: `cpf_rejeitado=${t1.cpfRejeitado ?? '(ausente)'}`,
    },
    {
      nome: 'turno 1: a resposta repete o numero recebido',
      ok: /123[.\s]?456[.\s]?789[-\s]?00|12345678900/.test(t1.resposta),
      detalhe: 'a Iris precisa dizer QUAL numero leu',
    },
    {
      nome: 'turno 2: CPF continua rejeitado (confirmacao verbal nao valida)',
      ok: t2.cpfNosDados === undefined,
      detalhe: `dados.cpf=${String(t2.cpfNosDados)}`,
    },
    {
      nome: 'turno 2: CPF nunca persistido',
      ok: t1.cpfNosDados === undefined && t2.cpfNosDados === undefined,
      detalhe: 'dados.cpf tem que continuar ausente nos dois turnos',
    },
    {
      nome: 'nenhuma RPC de escrita enquanto o CPF esta invalido',
      ok: clienteRpc.chamadas.filter((c) => c.nome === 'cappia_persistir_paciente' || c.nome === 'cappia_reservar_agendamento').length === 0,
      detalhe: `chamadas=${JSON.stringify(clienteRpc.chamadas.map((c) => c.nome))}`,
    },
    {
      nome: 'turno 2: explica que nao pode salvar enquanto a validacao falhar',
      ok: EXPLICA_LIMITE.test(t2.resposta),
      detalhe: 'a resposta precisa deixar o limite claro',
    },
    {
      nome: 'turno 2: NAO afirma que aceitou/cadastrou',
      ok: !AFIRMA_ACEITOU.test(t2.resposta),
      detalhe: 'confirmacao verbal nao pode virar cadastro concluido',
    },
    {
      nome: 'turno 2: NAO pede nova confirmacao sim/nao (sem ciclo)',
      ok: !PEDE_CONFIRMACAO_SIM_NAO.test(t2.resposta),
      detalhe: 'pedir "confirma?" de novo reabriria o ciclo',
    },
  ];
}

async function fluxoB(chaveApi: string): Promise<Verificacao[]> {
  console.log('=== FLUXO B: "e minha primeira consulta" (interpretadora real, catalogo real) ===');
  console.log('');

  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const pacienteId = crypto.randomUUID();
  tabelas.pacientes.push({
    id: pacienteId,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    nome: 'Marilda Sinval Quadros',
    documento: '52998224725',
    data_nascimento: '1979-06-23',
  });
  semearConversa(tabelas, clinicaId, pacienteId);

  const clienteBanco = new ClienteFalso(tabelas) as unknown as ClienteBancoDados;
  const clienteRpc = new ClienteRpcEspiao();
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

  const t = await rodarTurno(
    clienteModelo,
    clienteRedator,
    clienteBanco,
    clienteRpc,
    tabelas,
    'oi, e minha primeira consulta ai. queria marcar um horario'
  );
  imprimirTurno('--- turno unico ---', t);
  console.log(`  procedimento_id resolvido nos dados: ${String(t.procedimentoIdNosDados)}`);
  console.log('');

  return [
    {
      nome: 'interpretadora resolveu semanticamente para Consulta/Avaliacao',
      ok: t.procedimentoIdNosDados === CONSULTA_AVALIACAO_ID,
      detalhe: `procedimento_id=${String(t.procedimentoIdNosDados)} (esperado ${CONSULTA_AVALIACAO_ID})`,
    },
    {
      nome: 'o fluxo NAO caiu em aguardando_procedimento',
      ok: t.decisao !== 'aguardando_procedimento',
      detalhe: `decisao=${t.decisao}`,
    },
  ];
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- prova ponta a ponta: interpretadora real + Core + redatora real ---');
  console.log(`modelo: ${MODELO_IRIS_NOVA}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log('nenhum Supabase e tocado; banco em memoria');
  console.log('');

  const verificacoes: Verificacao[] = [];
  verificacoes.push(...(await fluxoA(chaveApi)));
  verificacoes.push(...(await fluxoB(chaveApi)));

  console.log('--- verificacoes (UMA execucao dos dois fluxos) ---');
  for (const v of verificacoes) {
    console.log(`  [${v.ok ? 'OK  ' : 'FALHA'}] ${v.nome}`);
    if (!v.ok) console.log(`          ${v.detalhe}`);
  }

  const ok = verificacoes.filter((v) => v.ok).length;
  console.log('');
  // LEITURA CORRETA DO PLACAR: este numero e "quantas VERIFICACOES passaram
  // nesta UNICA execucao", nunca "quantas amostras da Luna". Os dois fluxos
  // rodam uma vez cada; variabilidade do modelo so aparece repetindo o runner
  // inteiro, nunca somando as verificacoes de uma rodada.
  console.log(`--- resumo: ${ok}/${verificacoes.length} verificacoes aprovadas em 1 execucao (nao sao ${verificacoes.length} amostras do modelo) ---`);
  process.exitCode = ok === verificacoes.length ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
