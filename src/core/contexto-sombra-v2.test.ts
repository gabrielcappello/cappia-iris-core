// Contexto estruturado da decisao-sombra V2 (docs/07-arquitetura-v2.md secao
// 10, Etapa 2 -- especificacao aprovada pelo Gabriel em 2026-08-13).
//
// O QUE ESTE ARQUIVO PROVA, e por que existe separado: que o contexto
// entregue a V2 NAO depende do ramo escolhido pelo roteador antigo. Ate
// 2026-08-13 dependia -- os agendamentos futuros so eram buscados dentro do
// ramo conversacional, entao um turno operacional entregava a V2 um contexto
// silenciosamente incompleto. Isso produziu uma divergencia real em producao
// (turno "certo, entao esta confirmado?" logo apos `reserva_criada`).
//
// A outra metade da garantia e igualmente testada aqui: o comportamento
// VISIVEL nao muda. `agendamentos_do_paciente` (o fato que chega a redatora)
// continua restrito exatamente as mesmas tres decisoes conversacionais.
//
// Todos os dados sao SINTETICOS.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso, type RespostaRpc } from './teste-cliente-rpc-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
// 2026-08-03 = segunda-feira (mesmo instante dos demais testes do Core).
const INSTANTE_ATUAL = { data: '2026-08-03', minuto_min: 480 };

function montarCenario(tabelas: TabelasFalsas) {
  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const clinicaId = crypto.randomUUID();
  const pacienteId = crypto.randomUUID();

  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [
      {
        id: dentistaId,
        nome: 'Ana',
        titulo: 'Dra.',
        ativo: true,
        modo: 'auto',
        dur: 30,
        inicio: '08:00',
        fim: '18:00',
        sabado: false,
        alm_ini: null,
        alm_fim: null,
        procedimentos: [{ id: procedimentoId, nome: 'Limpeza', ativo: true, tempo: 999 }],
      },
    ],
  });
  tabelas.pacientes.push({
    id: pacienteId,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    nome: 'Marilda Sinval Quadros',
    documento: '52998224725',
    data_nascimento: '1979-06-23',
  });
  tabelas.procedimentos_catalogo.push({
    id: procedimentoId,
    nome_pt: 'Limpeza',
    nome_es: null,
    nome_en: null,
    nome_fr: null,
    nome_de: null,
    nome_it: null,
    nome_ru: null,
    nome_ar: null,
    tempo_padrao: 30,
    ativo: true,
  });

  return { clinicaId, procedimentoId, dentistaId, pacienteId };
}

function semearConversa(
  tabelas: TabelasFalsas,
  clinicaId: string,
  pacienteId: string | null,
  opcoes: {
    dados?: Record<string, string>;
    contexto_horarios?: Record<string, unknown> | null;
    ultimo_desfecho?: Record<string, unknown> | null;
  } = {}
) {
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: opcoes.dados ?? {},
    paciente_id: pacienteId,
    contexto_horarios: opcoes.contexto_horarios ?? null,
    ultimo_desfecho: opcoes.ultimo_desfecho ?? null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
}

function semearAgendamentoAtivo(
  tabelas: TabelasFalsas,
  overrides: {
    clinica_id: string;
    paciente_id: string;
    dentista_id: string;
    procedimento_id: string;
    data: string;
    horario: string;
    procedimento?: string;
  }
) {
  const id = crypto.randomUUID();
  tabelas.agendamentos.push({
    id,
    status: 'confirmado',
    dentista_nome: 'Dra. Ana',
    procedimento: 'Limpeza',
    ...overrides,
  });
  return id;
}

function entrada(mensagem: string) {
  return {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: [mensagem],
    instante_atual: INSTANTE_ATUAL,
  };
}

/**
 * `pedido` sem alteracoes: `decidirPorNatureza` devolve null e o turno segue
 * pelo caminho OPERACIONAL (`decidir`) -- exatamente o ramo que, antes desta
 * Etapa, nunca carregava os agendamentos.
 */
function clienteModeloPedido(): ClienteModeloFalso {
  return new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]);
}

/** Saudacao -- unico grupo que TAMBEM alimenta a redatora. */
function clienteModeloSaudacao(): ClienteModeloFalso {
  return new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]);
}

function rpcNuncaChamado(): ClienteRpcFalso {
  return new ClienteRpcFalso({});
}

// --- A garantia central: independencia do ramo do roteador antigo ---

test('turno OPERACIONAL recebe agendamentos_futuros no contexto-sombra (antes: nunca recebia)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, pacienteId);

  const resultado = await processarMensagem(
    clienteModeloPedido(),
    new ClienteFalso(tabelas),
    rpcNuncaChamado(),
    entrada('certo, entao esta confirmado?')
  );

  // Decisao operacional -- veio de `decidir`, nunca do ramo conversacional.
  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
  // O contexto da V2 conhece o agendamento MESMO neste ramo.
  assert.equal(resultado.contexto_sombra_v2?.agendamentos_futuros?.length, 1);
  assert.equal(resultado.contexto_sombra_v2?.agendamentos_futuros?.[0]?.data, '2026-08-10');
});

test('COMPORTAMENTO VISIVEL INALTERADO: a redatora continua sem o fato no ramo operacional', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, pacienteId);

  const resultado = await processarMensagem(
    clienteModeloPedido(),
    new ClienteFalso(tabelas),
    rpcNuncaChamado(),
    entrada('certo, entao esta confirmado?')
  );

  // A lista que chega a redatora segue restrita as tres decisoes
  // conversacionais da spec -- ampliar o contexto da V2 nao ampliou este fato.
  assert.equal(resultado.agendamentos_do_paciente, undefined);
});

test('decisao conversacional: redatora E sombra recebem o fato, sem duplicar consulta', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, pacienteId);

  const resultado = await processarMensagem(
    clienteModeloSaudacao(),
    new ClienteFalso(tabelas),
    rpcNuncaChamado(),
    entrada('oi')
  );

  assert.equal(resultado.decisao.tipo, 'saudacao');
  assert.equal(resultado.agendamentos_do_paciente?.length, 1);
  assert.equal(resultado.contexto_sombra_v2?.agendamentos_futuros?.length, 1);
});

// --- Formato de `agendamentos_futuros` ---

test('PLURAL e ordenado do mais proximo para o mais distante', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  // Semeado FORA de ordem cronologica de proposito: se a ordem viesse da
  // ordem de insercao, este teste falharia.
  semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-20',
    horario: '09:00',
  });
  semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, pacienteId);

  const resultado = await processarMensagem(
    clienteModeloPedido(),
    new ClienteFalso(tabelas),
    rpcNuncaChamado(),
    entrada('e ai')
  );

  const lista = resultado.contexto_sombra_v2?.agendamentos_futuros;
  assert.equal(lista?.length, 2);
  assert.equal(lista?.[0]?.data, '2026-08-10');
  assert.equal(lista?.[1]?.data, '2026-08-20');
});

test('item carrega o MINIMO e nenhum identificador opaco', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, pacienteId);

  const resultado = await processarMensagem(
    clienteModeloPedido(),
    new ClienteFalso(tabelas),
    rpcNuncaChamado(),
    entrada('e ai')
  );

  const item = resultado.contexto_sombra_v2?.agendamentos_futuros?.[0];
  assert.deepEqual(Object.keys(item ?? {}).sort(), ['data', 'dentista_nome', 'horario', 'procedimento']);
});

test('paciente sem agendamento: chave AUSENTE, nunca lista vazia', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId);

  const resultado = await processarMensagem(
    clienteModeloPedido(),
    new ClienteFalso(tabelas),
    rpcNuncaChamado(),
    entrada('e ai')
  );

  assert.ok(!('agendamentos_futuros' in (resultado.contexto_sombra_v2 ?? {})));
});

// --- `confirmacao_pendente` ---

test('confirmacao_pendente carrega a OPERACAO, derivada da decisao que criou a proposta', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId, {
    contexto_horarios: {
      proposta_pendente: { operacao: 'cancelar', data: '2026-08-10', horario: '14:00' },
      criado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
    },
  });

  const resultado = await processarMensagem(
    clienteModeloPedido(),
    new ClienteFalso(tabelas),
    rpcNuncaChamado(),
    entrada('pode confirmar')
  );

  assert.deepEqual(resultado.contexto_sombra_v2?.confirmacao_pendente, {
    operacao: 'cancelar',
    data: '2026-08-10',
    horario: '14:00',
  });
});

test('snapshot ANTIGO sem operacao: confirmacao_pendente e OMITIDA, nunca inferida', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId, {
    // Formato anterior a 2026-08-13, ainda presente em conversas em
    // andamento. Continua valido para producao (a Iris nao esquece a
    // pergunta pendente) -- so nao alimenta a medicao.
    contexto_horarios: {
      proposta_pendente: { data: '2026-08-10', horario: '14:00' },
      criado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
    },
  });

  const resultado = await processarMensagem(
    clienteModeloPedido(),
    new ClienteFalso(tabelas),
    rpcNuncaChamado(),
    entrada('pode confirmar')
  );

  assert.ok(!('confirmacao_pendente' in (resultado.contexto_sombra_v2 ?? {})));
});

// --- `ultimo_desfecho` ---

test('ultimo_desfecho do turno anterior chega ao contexto da V2', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId, {
    ultimo_desfecho: { tipo: 'reserva_criada' },
  });

  const resultado = await processarMensagem(
    clienteModeloPedido(),
    new ClienteFalso(tabelas),
    rpcNuncaChamado(),
    entrada('certo, entao esta confirmado?')
  );

  // Este e, em uma linha, o cenario que produziu a divergencia em producao:
  // a V2 agora sabe ESTRUTURALMENTE que uma reserva acabou de ser criada, sem
  // depender de encontrar a confirmacao no texto do historico.
  assert.deepEqual(resultado.contexto_sombra_v2?.ultimo_desfecho, { tipo: 'reserva_criada' });
});

test('ultimo_desfecho malformado no banco vira ausencia, nunca derruba o turno', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId, {
    ultimo_desfecho: { tipo: 'valor_que_nao_existe_no_vocabulario' },
  });

  const resultado = await processarMensagem(
    clienteModeloPedido(),
    new ClienteFalso(tabelas),
    rpcNuncaChamado(),
    entrada('e ai')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
  assert.ok(!('ultimo_desfecho' in (resultado.contexto_sombra_v2 ?? {})));
});

// --- Falha de banco: a sombra nunca pode derrubar o atendimento ---

test('falha ao buscar agendamentos NAO derruba turno operacional (so a sombra perde o bloco)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId);

  const cliente = new ClienteFalso(tabelas);
  const selectOriginal = cliente.from.bind(cliente);
  // Falha cirurgica: SO a leitura de `agendamentos` quebra.
  (cliente as unknown as { from: (t: string) => unknown }).from = (tabela: string) => {
    if (tabela === 'agendamentos') throw new Error('falha sintetica de banco');
    return selectOriginal(tabela);
  };

  const resultado = await processarMensagem(
    clienteModeloPedido(),
    cliente,
    rpcNuncaChamado(),
    entrada('e ai')
  );

  // O atendimento seguiu normalmente.
  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
  assert.ok(!('agendamentos_futuros' in (resultado.contexto_sombra_v2 ?? {})));
});

// ============================================================================
// FRONTEIRA REAL DO MARCADOR -- publicar / reivindicar / expirar.
//
// Estes testes atravessam `processarMensagem` de verdade, turno a turno,
// contra o mesmo banco falso -- e a unica forma de provar o ciclo completo.
// Testar `derivarUltimoDesfecho` e `gravarContextoHorarios` isolados prova
// as pecas, nunca a fronteira.
// ============================================================================

function linhaConversa(tabelas: TabelasFalsas): Record<string, unknown> {
  return tabelas.estado_conversa[0] as unknown as Record<string, unknown>;
}

/**
 * Cenario de reserva concluivel -- mesma receita ja usada pelos testes de
 * reserva do orquestrador: o turno informa procedimento + data + horario +
 * confirmacao e o Core reserva de verdade (RPC falsa).
 */
function montarCenarioReservaConcluida(tabelas: TabelasFalsas) {
  const base = montarCenario(tabelas);
  semearConversa(tabelas, base.clinicaId, base.pacienteId);
  return base;
}

function clienteModeloConfirma(procedimentoId: string): ClienteModeloFalso {
  return new ClienteModeloFalso([
    {
      natureza_mensagem: 'resposta',
      alteracoes: {
        procedimento_id: { acao: 'informar', valor: procedimentoId },
        data_texto: { acao: 'informar', valor: 'hoje' },
        horario_texto: { acao: 'informar', valor: '10:00' },
        confirmacao: { acao: 'informar', valor: 'sim' },
      },
    },
  ]);
}

function rpcReservaOk(dentistaId: string): ClienteRpcFalso {
  return new ClienteRpcFalso({
    cappia_reservar_agendamento: {
      data: {
        sucesso: true,
        agendamento_id: crypto.randomUUID(),
        dentista_id: dentistaId,
        duracao_min: 30,
        data: '2026-08-03',
        horario: '10:00',
      },
      error: null,
    } satisfies RespostaRpc,
  });
}

/** Turno A completo -- devolve o cenario para os turnos seguintes. */
async function concluirReserva(tabelas: TabelasFalsas) {
  const base = montarCenarioReservaConcluida(tabelas);
  const resultado = await processarMensagem(
    clienteModeloConfirma(base.procedimentoId),
    new ClienteFalso(tabelas),
    rpcReservaOk(base.dentistaId),
    entrada('sim, confirmo')
  );
  return { base, resultado };
}

test('TURNO A: concluir a reserva PUBLICA o marcador no banco', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { resultado } = await concluirReserva(tabelas);

  assert.equal(resultado.decisao.tipo, 'reserva_criada');
  assert.deepEqual(linhaConversa(tabelas).ultimo_desfecho, { tipo: 'reserva_criada' });
  // O turno que PUBLICA nunca mede com o proprio marcador -- ele e para o
  // turno seguinte.
  assert.ok(!('ultimo_desfecho' in (resultado.contexto_sombra_v2 ?? {})));
});

test('TURNO B: le o marcador, usa na sombra, e o CAS autoritativo CONSOME', async () => {
  const tabelas = criarTabelasFalsasVazias();
  await concluirReserva(tabelas);
  assert.deepEqual(linhaConversa(tabelas).ultimo_desfecho, { tipo: 'reserva_criada' }, 'pre-condicao');

  // Turno seguinte SEM nenhuma alteracao de dados -- exatamente o caso real
  // ("certo, entao esta confirmado?") que antes nunca passava pelo CAS.
  const turnoB = await processarMensagem(
    clienteModeloPedido(),
    new ClienteFalso(tabelas),
    rpcNuncaChamado(),
    entrada('certo, entao esta confirmado?')
  );

  assert.deepEqual(turnoB.contexto_sombra_v2?.ultimo_desfecho, { tipo: 'reserva_criada' }, 'B mede com o marcador');
  assert.equal(linhaConversa(tabelas).ultimo_desfecho, null, 'o CAS consumiu o marcador');
});

test('TURNO C: nao recebe mais o marcador -- vida util de exatamente um turno', async () => {
  const tabelas = criarTabelasFalsasVazias();
  await concluirReserva(tabelas);
  await processarMensagem(clienteModeloPedido(), new ClienteFalso(tabelas), rpcNuncaChamado(), entrada('esta confirmado?'));

  const turnoC = await processarMensagem(
    clienteModeloPedido(),
    new ClienteFalso(tabelas),
    rpcNuncaChamado(),
    entrada('obrigado')
  );

  assert.ok(!('ultimo_desfecho' in (turnoC.contexto_sombra_v2 ?? {})));
  assert.equal(linhaConversa(tabelas).ultimo_desfecho, null);
});

test('CONCORRENCIA B1/B2: somente o VENCEDOR do CAS mede com o marcador', async () => {
  const tabelas = criarTabelasFalsasVazias();
  await concluirReserva(tabelas);
  assert.deepEqual(linhaConversa(tabelas).ultimo_desfecho, { tipo: 'reserva_criada' }, 'pre-condicao');

  // Dois processamentos concorrentes do mesmo estado, sobre o MESMO banco.
  const [b1, b2] = await Promise.all([
    processarMensagem(clienteModeloPedido(), new ClienteFalso(tabelas), rpcNuncaChamado(), entrada('esta confirmado?')),
    processarMensagem(clienteModeloPedido(), new ClienteFalso(tabelas), rpcNuncaChamado(), entrada('confirmou mesmo?')),
  ]);

  const mediramComMarcador = [b1, b2].filter(
    (r) => r.contexto_sombra_v2?.ultimo_desfecho !== undefined
  );
  assert.equal(mediramComMarcador.length, 1, 'exatamente UM dos dois pode medir com o marcador');
  assert.equal(linhaConversa(tabelas).ultimo_desfecho, null, 'consumido uma unica vez');
});

// --- `confirmacao_pendente`: as tres operacoes, sem depender de dados.intencao ---

test('as TRES operacoes atravessam confirmacao_pendente com a operacao correta', async () => {
  const casos = [
    { operacao: 'criar' as const },
    { operacao: 'remarcar' as const },
    { operacao: 'cancelar' as const },
  ];

  for (const caso of casos) {
    const tabelas = criarTabelasFalsasVazias();
    const { clinicaId, pacienteId } = montarCenario(tabelas);
    semearConversa(tabelas, clinicaId, pacienteId, {
      // SEM `intencao` em `dados` de proposito: a operacao precisa vir da
      // decisao que criou a proposta, nunca do campo interpretado pela IA.
      contexto_horarios: {
        proposta_pendente: { operacao: caso.operacao, data: '2026-08-10', horario: '14:00' },
        criado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
      },
    });

    const resultado = await processarMensagem(
      clienteModeloPedido(),
      new ClienteFalso(tabelas),
      rpcNuncaChamado(),
      entrada('sim')
    );

    assert.equal(
      resultado.contexto_sombra_v2?.confirmacao_pendente?.operacao,
      caso.operacao,
      `operacao ${caso.operacao} deve atravessar intacta`
    );
  }
});

// --- A CORRIDA A x B (achado da revisao independente, 2026-08-13) ---
//
// A decidiu concluir com base no estado X. B entra ANTES da limpeza de A e
// grava um fluxo novo, preenchendo campos que A normalmente removeria. A
// perde a autoridade sobre `estado_conversa`: nao apaga nada de B e nao
// publica marcador. A operacao externa que A concluiu continua valida.

/**
 * Turno B: muda de ideia e inicia um fluxo novo -- grava `periodo` (campo que
 * a limpeza de `reserva_criada` removeria) e retira a confirmacao anterior,
 * exatamente como um "na verdade queria de manha" faria.
 */
function clienteModeloNovoFluxo(): ClienteModeloFalso {
  return new ClienteModeloFalso([
    {
      natureza_mensagem: 'correcao',
      alteracoes: {
        periodo: { acao: 'informar', valor: 'manha' },
        confirmacao: { acao: 'remover' },
      },
    },
  ]);
}

/** Turno inofensivo: `negacao` vira `desistencia` sem tocar em `dados`. */
function clienteModeloDesistencia(): ClienteModeloFalso {
  return new ClienteModeloFalso([{ natureza_mensagem: 'negacao', alteracoes: {} }]);
}

test('CORRIDA A x B: A superada nao apaga campos de B nem publica marcador', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const base = montarCenarioReservaConcluida(tabelas);

  // A JANELA EXATA do defeito: A ja reservou (decisao final existe) mas ainda
  // nao gravou sua transicao. B entra AGORA, inteiro, e avanca oficialmente o
  // estado gravando `periodo`.
  let bJaRodou = false;
  const rpcQueDeixaBPassar = new ClienteRpcFalso({
    cappia_reservar_agendamento: {
      data: {
        sucesso: true,
        agendamento_id: crypto.randomUUID(),
        dentista_id: base.dentistaId,
        duracao_min: 30,
        data: '2026-08-03',
        horario: '10:00',
      },
      error: null,
    } satisfies RespostaRpc,
  });
  const rpcOriginal = rpcQueDeixaBPassar.rpc.bind(rpcQueDeixaBPassar);
  (rpcQueDeixaBPassar as unknown as { rpc: typeof rpcOriginal }).rpc = async (nome, parametros) => {
    const resposta = await rpcOriginal(nome, parametros);
    if (nome === 'cappia_reservar_agendamento' && !bJaRodou) {
      bJaRodou = true;
      await processarMensagem(
        clienteModeloNovoFluxo(),
        new ClienteFalso(tabelas),
        rpcNuncaChamado(),
        entrada('na verdade queria de manha')
      );
    }
    return resposta;
  };

  const resultadoA = await processarMensagem(
    clienteModeloConfirma(base.procedimentoId),
    new ClienteFalso(tabelas),
    rpcQueDeixaBPassar,
    entrada('sim, confirmo')
  );

  // A OPERACAO EXTERNA DE A CONTINUA VALIDA -- o que ela perde e so a
  // autoridade sobre o estado conversacional.
  assert.equal(resultadoA.decisao.tipo, 'reserva_criada');
  assert.equal(
    rpcQueDeixaBPassar.chamadas.filter((c) => c.nome === 'cappia_reservar_agendamento').length,
    1,
    'a reserva de A foi de fato executada no sistema externo'
  );
  assert.ok(bJaRodou, 'B foi processado dentro da janela');

  // 1. A nao apagou o campo escrito por B (era exatamente isso que o retry
  //    fazia: relia o estado de B e reaplicava as remocoes sobre ele).
  const dadosDepois = linhaConversa(tabelas).dados as Record<string, unknown>;
  assert.equal(dadosDepois.periodo, 'manha', 'o campo gravado por B sobreviveu');

  // 2. A nao publicou marcador atrasado.
  assert.equal(linhaConversa(tabelas).ultimo_desfecho ?? null, null);

  // 3. C enxerga o estado deixado por B, intacto, e nao recebe desfecho de A.
  const resultadoC = await processarMensagem(
    clienteModeloDesistencia(),
    new ClienteFalso(tabelas),
    rpcNuncaChamado(),
    entrada('deixa pra la')
  );
  assert.ok(!('ultimo_desfecho' in (resultadoC.contexto_sombra_v2 ?? {})), 'C nao recebe desfecho de A');
  assert.equal(
    (linhaConversa(tabelas).dados as Record<string, unknown>).periodo,
    'manha',
    'o estado de B segue intacto para C'
  );
});

test('PUBLICACAO e INDIVISIVEL da transicao: marcador e limpeza dos campos na MESMA escrita', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const base = montarCenarioReservaConcluida(tabelas);
  const cliente = new ClienteFalso(tabelas);
  const fromOriginal = cliente.from.bind(cliente);
  const updatesEstado: Record<string, unknown>[] = [];

  (cliente as unknown as { from: (t: string) => unknown }).from = (tabela: string) => {
    const alvo = fromOriginal(tabela) as { update: (v: Record<string, unknown>) => unknown };
    if (tabela !== 'estado_conversa') return alvo;
    const updateOriginal = alvo.update.bind(alvo);
    return {
      ...alvo,
      update: (valores: Record<string, unknown>) => {
        updatesEstado.push(valores);
        return updateOriginal(valores);
      },
    };
  };

  await processarMensagem(
    clienteModeloConfirma(base.procedimentoId),
    cliente,
    rpcReservaOk(base.dentistaId),
    entrada('sim, confirmo')
  );

  const updatesComMarcador = updatesEstado.filter((v) => 'ultimo_desfecho' in v);
  assert.equal(updatesComMarcador.length, 1, 'o marcador e gravado numa unica escrita');
  assert.deepEqual(updatesComMarcador[0]?.ultimo_desfecho, { tipo: 'reserva_criada' });
  // A MESMA escrita carrega a limpeza dos campos operacionais -- nunca uma
  // escrita separada e atrasavel.
  assert.ok('dados' in (updatesComMarcador[0] ?? {}), 'marcador viaja junto com a transicao de estado');
});
