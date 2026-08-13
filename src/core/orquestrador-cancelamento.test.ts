// Fluxo de cancelamento (specs/cancelamento-conversacional-v1.md). Arquivo
// separado pelo mesmo criterio que ja separou orquestrador-remarcacao.test.ts:
// a montagem exige um agendamento ativo pre-existente e a RPC
// cappia_cancelar_agendamento_v2, nunca cappia_reservar_agendamento.
//
// Todos os dados sao SINTETICOS. As frases seguem o registro real de WhatsApp
// (docs/00-principios.md, principio dos testes realistas).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import type { ClienteBancoDados } from './tipos.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso, type RespostaRpc } from './teste-cliente-rpc-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
// 2026-08-03 = segunda-feira (verificado, mesmo instante dos demais testes).
const INSTANTE_ATUAL = { data: '2026-08-03', minuto_min: 480 };

function clienteRpcNuncaChamado(): ClienteRpcFalso {
  return new ClienteRpcFalso({});
}

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
        fim: '12:00',
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
  dados: Record<string, string> = {},
  contextoHorarios: Record<string, unknown> | null = null,
  pacienteId: string | null = null
) {
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados,
    paciente_id: pacienteId,
    contexto_horarios: contextoHorarios,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
}

function linhaConversa(tabelas: TabelasFalsas) {
  return tabelas.estado_conversa[0] as unknown as {
    dados: Record<string, string>;
    contexto_horarios: Record<string, unknown> | null;
  };
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

function clienteModeloSemAlteracoes(): ClienteModeloFalso {
  return new ClienteModeloFalso([{ natureza_mensagem: 'resposta', alteracoes: {} }]);
}

function clienteModeloIntencaoCancelamento(): ClienteModeloFalso {
  return new ClienteModeloFalso([
    { natureza_mensagem: 'pedido', alteracoes: { intencao: { acao: 'informar', valor: 'cancelamento' } } },
  ]);
}

function respostaCanceladoOk(overrides: Record<string, unknown> = {}): RespostaRpc {
  return {
    data: { sucesso: true, agendamento_id: crypto.randomUUID(), status: 'cancelado', ...overrides },
    error: null,
  };
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

// --- Localizacao (spec secao 2) ---

test('paciente sem agendamento ativo: sem_agendamento_para_cancelar, RPC nunca chamada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, {});
  const rpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(
    clienteModeloIntencaoCancelamento(),
    new ClienteFalso(tabelas),
    rpc,
    entrada('quero cancelar minha consulta')
  );

  assert.deepEqual(resultado.decisao, { tipo: 'sem_agendamento_para_cancelar' });
  assert.equal(rpc.chamadas.length, 0);
});

test('paciente nao identificado (paciente_id nulo): sem_agendamento_para_cancelar', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId } = montarCenario(tabelas);
  // Agendamento de OUTRO paciente existe no banco -- nunca deve ser alcancado.
  semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: crypto.randomUUID(),
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, {});
  const rpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(
    clienteModeloIntencaoCancelamento(),
    new ClienteFalso(tabelas),
    rpc,
    entrada('quero cancelar minha consulta')
  );

  assert.deepEqual(resultado.decisao, { tipo: 'sem_agendamento_para_cancelar' });
  assert.equal(rpc.chamadas.length, 0);
});

// --- Protecao central (spec secao 4) ---

test('unico agendamento: PERGUNTA a confirmacao mostrando qual sera cancelado -- nunca cancela direto', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  const agendamentoId = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, {}, null, pacienteId);
  const rpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(
    clienteModeloIntencaoCancelamento(),
    new ClienteFalso(tabelas),
    rpc,
    entrada('quero cancelar minha consulta')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao_cancelamento');
  if (resultado.decisao.tipo !== 'aguardando_confirmacao_cancelamento') return;
  // Mostra CLARAMENTE o que sera cancelado (spec secao 4).
  assert.equal(resultado.decisao.agendamento.agendamento_id, agendamentoId);
  assert.equal(resultado.decisao.agendamento.data, '2026-08-10');
  assert.equal(resultado.decisao.agendamento.horario, '14:00');
  assert.equal(resultado.decisao.agendamento.procedimento, 'Limpeza');
  assert.equal(resultado.decisao.agendamento.dentista_nome, 'Dra. Ana');
  assert.equal(rpc.chamadas.length, 0);

  // O contexto grava a proposta pendente CRUA, que e o que o turno seguinte confere.
  assert.deepEqual(linhaConversa(tabelas).contexto_horarios?.proposta_pendente, {
    data: '2026-08-10',
    horario: '14:00',
  });
});

test('confirmacao valida + proposta correspondente: executa a RPC e devolve cancelamento_criado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  const agendamentoId = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(
    tabelas,
    clinicaId,
    { intencao: 'cancelamento', confirmacao: 'sim' },
    { proposta_pendente: { data: '2026-08-10', horario: '14:00' }, criado_em: new Date().toISOString() },
    pacienteId
  );
  const rpc = new ClienteRpcFalso({
    cappia_cancelar_agendamento_v2: respostaCanceladoOk({ agendamento_id: agendamentoId }),
  });

  const resultado = await processarMensagem(
    clienteModeloSemAlteracoes(),
    new ClienteFalso(tabelas),
    rpc,
    entrada('isso, pode cancelar')
  );

  assert.equal(resultado.decisao.tipo, 'cancelamento_criado');
  if (resultado.decisao.tipo !== 'cancelamento_criado') return;
  assert.equal(resultado.decisao.agendamento_id, agendamentoId);
  assert.equal(resultado.decisao.data, '2026-08-10');
  assert.equal(resultado.decisao.horario, '14:00');

  assert.equal(rpc.chamadas.length, 1);
  assert.deepEqual(rpc.chamadas[0]!.parametros, {
    p_clinica_id: clinicaId,
    p_paciente_id: pacienteId,
    p_agendamento_id: agendamentoId,
  });
});

test('CONDICAO 3: confirmacao sim mas SEM proposta_pendente -- nunca cancela, re-pergunta', async () => {
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
  // `intencao` JA era cancelamento -- entao a limpeza-na-entrada nao dispara.
  // Este e exatamente o caso que so a condicao 3 cobre.
  semearConversa(tabelas, clinicaId, { intencao: 'cancelamento', confirmacao: 'sim' }, null, pacienteId);
  const rpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(
    clienteModeloSemAlteracoes(),
    new ClienteFalso(tabelas),
    rpc,
    entrada('oi')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao_cancelamento');
  assert.equal(rpc.chamadas.length, 0);
});

test('CONDICAO 3: proposta_pendente aponta para OUTRO horario -- nunca cancela, re-pergunta', async () => {
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
  semearConversa(
    tabelas,
    clinicaId,
    { intencao: 'cancelamento', confirmacao: 'sim' },
    // Proposta de OUTRO agendamento/turno -- nao corresponde ao que seria cancelado.
    { proposta_pendente: { data: '2026-08-20', horario: '09:00' }, criado_em: new Date().toISOString() },
    pacienteId
  );
  const rpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(
    clienteModeloSemAlteracoes(),
    new ClienteFalso(tabelas),
    rpc,
    entrada('sim')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao_cancelamento');
  assert.equal(rpc.chamadas.length, 0);
});

test('confirmacao herdada de outro fluxo e LIMPA ao entrar em cancelamento -- nenhuma escrita', async () => {
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
  // `confirmacao: 'sim'` remanescente de um agendamento anterior, e uma
  // proposta pendente que por acaso CASA com o agendamento -- mesmo assim, a
  // entrada em cancelamento limpa a confirmacao.
  semearConversa(
    tabelas,
    clinicaId,
    { confirmacao: 'sim' },
    { proposta_pendente: { data: '2026-08-10', horario: '14:00' }, criado_em: new Date().toISOString() },
    pacienteId
  );
  const rpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(
    clienteModeloIntencaoCancelamento(),
    new ClienteFalso(tabelas),
    rpc,
    entrada('quero cancelar minha consulta')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao_cancelamento');
  assert.equal(rpc.chamadas.length, 0);
  assert.ok(!('confirmacao' in linhaConversa(tabelas).dados));
});

test('falso positivo de intencao: pior desfecho e a pergunta, nunca uma escrita', async () => {
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
  semearConversa(tabelas, clinicaId, {}, null, pacienteId);
  const rpc = clienteRpcNuncaChamado();

  // A IA emitiu cancelamento sem o paciente ter pedido (falso positivo forcado).
  const resultado = await processarMensagem(
    clienteModeloIntencaoCancelamento(),
    new ClienteFalso(tabelas),
    rpc,
    entrada('deixa pra lá')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao_cancelamento');
  assert.equal(rpc.chamadas.length, 0);
  // O agendamento continua confirmado no banco.
  assert.equal((tabelas.agendamentos[0] as unknown as { status: string }).status, 'confirmado');
});

// --- Confirmacao que nao ficou clara (spec secao 4) ---

test('PRIMEIRA pergunta NAO carrega confirmacao_nao_compreendida', async () => {
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
  semearConversa(tabelas, clinicaId, {}, null, pacienteId);

  const resultado = await processarMensagem(
    clienteModeloIntencaoCancelamento(),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('quero cancelar minha consulta')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao_cancelamento');
  if (resultado.decisao.tipo !== 'aguardando_confirmacao_cancelamento') return;
  // AUSENTE, nunca `false` -- mesma disciplina das demais chaves opcionais.
  assert.ok(!('confirmacao_nao_compreendida' in resultado.decisao));
});

test('resposta que nao confirma, com pergunta JA feita para ESTE agendamento: confirmacao_nao_compreendida', async () => {
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
  // Turno anterior JA perguntou sobre este agendamento (proposta bate).
  semearConversa(
    tabelas,
    clinicaId,
    { intencao: 'cancelamento' },
    { proposta_pendente: { data: '2026-08-10', horario: '14:00' }, criado_em: new Date().toISOString() },
    pacienteId
  );
  const rpc = clienteRpcNuncaChamado();

  // "pode cancelar" -> a IA reemite intencao em vez de confirmacao (medido
  // 0/4 contra a IA real, em todos os formatos de pergunta testados).
  const resultado = await processarMensagem(
    clienteModeloIntencaoCancelamento(),
    new ClienteFalso(tabelas),
    rpc,
    entrada('pode cancelar')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao_cancelamento');
  if (resultado.decisao.tipo !== 'aguardando_confirmacao_cancelamento') return;
  assert.equal(resultado.decisao.confirmacao_nao_compreendida, true);
  assert.equal(rpc.chamadas.length, 0);
  // O gate continua armado para o turno seguinte.
  assert.deepEqual(linhaConversa(tabelas).contexto_horarios?.proposta_pendente, {
    data: '2026-08-10',
    horario: '14:00',
  });
});

test('proposta pendente de OUTRO agendamento nao marca confirmacao_nao_compreendida', async () => {
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
  semearConversa(
    tabelas,
    clinicaId,
    { intencao: 'cancelamento' },
    // Proposta de outro horario -- a pergunta NAO foi feita sobre este agendamento.
    { proposta_pendente: { data: '2026-08-25', horario: '09:00' }, criado_em: new Date().toISOString() },
    pacienteId
  );

  const resultado = await processarMensagem(
    clienteModeloIntencaoCancelamento(),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('pode cancelar')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao_cancelamento');
  if (resultado.decisao.tipo !== 'aguardando_confirmacao_cancelamento') return;
  assert.ok(!('confirmacao_nao_compreendida' in resultado.decisao));
});

test('depois do esclarecimento, uma resposta clara volta ao MESMO gate e conclui', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  const agendamentoId = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(
    tabelas,
    clinicaId,
    { intencao: 'cancelamento' },
    { proposta_pendente: { data: '2026-08-10', horario: '14:00' }, criado_em: new Date().toISOString() },
    pacienteId
  );
  const rpc = new ClienteRpcFalso({
    cappia_cancelar_agendamento_v2: respostaCanceladoOk({ agendamento_id: agendamentoId }),
  });

  // Turno A: resposta ambigua -> pede esclarecimento, nao executa.
  const turnoA = await processarMensagem(
    clienteModeloIntencaoCancelamento(),
    new ClienteFalso(tabelas),
    rpc,
    entrada('pode cancelar')
  );
  assert.equal(turnoA.decisao.tipo, 'aguardando_confirmacao_cancelamento');
  assert.equal(rpc.chamadas.length, 0);

  // Turno B: resposta clara -> a IA emite confirmacao, o gate autoriza.
  const turnoB = await processarMensagem(
    new ClienteModeloFalso([
      { natureza_mensagem: 'resposta', alteracoes: { confirmacao: { acao: 'informar', valor: 'sim' } } },
    ]),
    new ClienteFalso(tabelas),
    rpc,
    entrada('isso mesmo')
  );

  assert.equal(turnoB.decisao.tipo, 'cancelamento_criado');
  assert.equal(rpc.chamadas.length, 1);
});

// --- Independencia do catalogo (revisao independente, 2026-08-11) ---
//
// Cancelar nao depende de catalogo, procedimento, dentista, disponibilidade
// nem resolucao temporal: o agendamento ja existe e todos os identificadores
// saem dele. Por isso o ramo de cancelamento roda ANTES da checagem de
// `clinica_sem_catalogo`.

/**
 * Cliente que reproduz a CORRIDA REAL que produz catalogo nao-carregado: a
 * clinica e encontrada na IDENTIFICACAO e some antes do CARREGAMENTO DO
 * CATALOGO. Esse e o unico caminho pelo qual `carregarCatalogo` devolve
 * `clinica_nao_encontrada` depois de uma identificacao bem-sucedida -- uma
 * clinica sem dentistas ainda carrega catalogo normalmente (so vazio), entao
 * ela NAO serve para exercitar este ramo.
 *
 * Determinista: a ordem das consultas a `clinicas` em processarMensagem e
 * fixa -- 1a identificarConversa, 2a carregarCatalogo. O cancelamento nunca
 * consulta `clinicas` de novo (nao le fuso: nao ha resolucao temporal).
 */
class ClienteComClinicaQueSome implements ClienteBancoDados {
  private consultasEmClinicas = 0;
  private readonly interno: ClienteFalso;
  private readonly tabelas: TabelasFalsas;

  constructor(interno: ClienteFalso, tabelas: TabelasFalsas) {
    this.interno = interno;
    this.tabelas = tabelas;
  }

  from(nome: string) {
    if (nome === 'clinicas') {
      this.consultasEmClinicas++;
      if (this.consultasEmClinicas > 1) {
        // A partir da 2a consulta (carregarCatalogo), a clinica ja nao existe.
        this.tabelas.clinicas.length = 0;
      }
    }
    return this.interno.from(nome);
  }
}

function clienteSemCatalogo(tabelas: TabelasFalsas): ClienteBancoDados {
  return new ClienteComClinicaQueSome(new ClienteFalso(tabelas), tabelas);
}

test('catalogo AUSENTE: cancelamento alcanca aguardando_confirmacao_cancelamento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  const agendamentoId = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, {}, null, pacienteId);
  const rpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(
    clienteModeloIntencaoCancelamento(),
    clienteSemCatalogo(tabelas),
    rpc,
    entrada('quero cancelar minha consulta')
  );

  // Sem a correcao de ordem isto seria `clinica_sem_catalogo`.
  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao_cancelamento');
  if (resultado.decisao.tipo !== 'aguardando_confirmacao_cancelamento') return;
  assert.equal(resultado.decisao.agendamento.agendamento_id, agendamentoId);
  assert.equal(rpc.chamadas.length, 0);
});

test('catalogo AUSENTE: confirmacao correspondente chama a RPC de cancelamento normalmente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  const agendamentoId = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(
    tabelas,
    clinicaId,
    { intencao: 'cancelamento', confirmacao: 'sim' },
    { proposta_pendente: { data: '2026-08-10', horario: '14:00' }, criado_em: new Date().toISOString() },
    pacienteId
  );
  const rpc = new ClienteRpcFalso({
    cappia_cancelar_agendamento_v2: respostaCanceladoOk({ agendamento_id: agendamentoId }),
  });

  const resultado = await processarMensagem(
    clienteModeloSemAlteracoes(),
    clienteSemCatalogo(tabelas),
    rpc,
    entrada('isso mesmo')
  );

  assert.equal(resultado.decisao.tipo, 'cancelamento_criado');
  assert.equal(rpc.chamadas.length, 1);
  assert.deepEqual(rpc.chamadas[0]!.parametros, {
    p_clinica_id: clinicaId,
    p_paciente_id: pacienteId,
    p_agendamento_id: agendamentoId,
  });
});

test('catalogo AUSENTE sem intencao de cancelamento: continua clinica_sem_catalogo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, {}, null, pacienteId);

  const resultado = await processarMensagem(
    new ClienteModeloFalso([
      { natureza_mensagem: 'pedido', alteracoes: { data_texto: { acao: 'informar', valor: 'amanha' } } },
    ]),
    clienteSemCatalogo(tabelas),
    clienteRpcNuncaChamado(),
    entrada('pode ser amanhã?')
  );

  // A correcao move SOMENTE o cancelamento -- todo o resto continua barrado
  // pela checagem de catalogo, exatamente como antes.
  assert.deepEqual(resultado.decisao, { tipo: 'clinica_sem_catalogo' });
});

// --- Escolha entre varios (spec secao 5) ---

test('multiplos agendamentos sem escolha: pergunta qual CANCELAR e grava o marcador reusado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  const ag1 = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  const ag2 = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-15',
    horario: '09:00',
  });
  semearConversa(tabelas, clinicaId, {}, null, pacienteId);
  const rpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(
    clienteModeloIntencaoCancelamento(),
    new ClienteFalso(tabelas),
    rpc,
    entrada('quero cancelar minha consulta')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_escolha_agendamento_cancelamento');
  if (resultado.decisao.tipo !== 'aguardando_escolha_agendamento_cancelamento') return;
  assert.deepEqual(
    resultado.decisao.agendamentos.map((a) => a.agendamento_id),
    [ag1, ag2]
  );
  assert.equal(rpc.chamadas.length, 0);
  // MESMO marcador da remarcacao -- nenhuma variante nova de contexto.
  assert.deepEqual(linhaConversa(tabelas).contexto_horarios?.escolha_agendamento_pendente, {
    agendamento_ids: [ag1, ag2],
  });
});

test('agendamento_id escolhido: segue para confirmacao daquele agendamento, nunca cancela direto', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  const ag1 = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  const ag2 = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-15',
    horario: '09:00',
  });
  semearConversa(
    tabelas,
    clinicaId,
    { intencao: 'cancelamento', agendamento_id: ag2 },
    { escolha_agendamento_pendente: { agendamento_ids: [ag1, ag2] }, criado_em: new Date().toISOString() },
    pacienteId
  );
  const rpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(
    clienteModeloSemAlteracoes(),
    new ClienteFalso(tabelas),
    rpc,
    entrada('o segundo')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao_cancelamento');
  if (resultado.decisao.tipo !== 'aguardando_confirmacao_cancelamento') return;
  assert.equal(resultado.decisao.agendamento.agendamento_id, ag2);
  assert.equal(rpc.chamadas.length, 0);
});

// --- Desfechos (spec secao 7) ---

test('replay ja_cancelado=true e sucesso normal, sem texto de excecao', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  const agendamentoId = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(
    tabelas,
    clinicaId,
    { intencao: 'cancelamento', confirmacao: 'sim' },
    { proposta_pendente: { data: '2026-08-10', horario: '14:00' }, criado_em: new Date().toISOString() },
    pacienteId
  );
  const rpc = new ClienteRpcFalso({
    cappia_cancelar_agendamento_v2: respostaCanceladoOk({ agendamento_id: agendamentoId, ja_cancelado: true }),
  });

  const resultado = await processarMensagem(
    clienteModeloSemAlteracoes(),
    new ClienteFalso(tabelas),
    rpc,
    entrada('sim')
  );

  assert.equal(resultado.decisao.tipo, 'cancelamento_criado');
});

test('falha tecnica reusa reserva_falhou, sem decisao nova', async () => {
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
  semearConversa(
    tabelas,
    clinicaId,
    { intencao: 'cancelamento', confirmacao: 'sim' },
    { proposta_pendente: { data: '2026-08-10', horario: '14:00' }, criado_em: new Date().toISOString() },
    pacienteId
  );
  const rpc = new ClienteRpcFalso({
    cappia_cancelar_agendamento_v2: { data: { sucesso: false, motivo: 'nao_confirmado' }, error: null },
  });

  const resultado = await processarMensagem(
    clienteModeloSemAlteracoes(),
    new ClienteFalso(tabelas),
    rpc,
    entrada('sim')
  );

  assert.deepEqual(resultado.decisao, { tipo: 'reserva_falhou', motivo: 'nao_confirmado' });
});

test('sucesso limpa intencao e agendamento_id -- turno seguinte nao reentra em cancelamento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  const agendamentoId = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(
    tabelas,
    clinicaId,
    { intencao: 'cancelamento', agendamento_id: agendamentoId, confirmacao: 'sim' },
    { proposta_pendente: { data: '2026-08-10', horario: '14:00' }, criado_em: new Date().toISOString() },
    pacienteId
  );
  const rpc = new ClienteRpcFalso({
    cappia_cancelar_agendamento_v2: respostaCanceladoOk({ agendamento_id: agendamentoId }),
  });

  await processarMensagem(clienteModeloSemAlteracoes(), new ClienteFalso(tabelas), rpc, entrada('sim'));

  const dados = linhaConversa(tabelas).dados;
  assert.ok(!('intencao' in dados));
  assert.ok(!('agendamento_id' in dados));
});

test('desistencia DENTRO do cancelamento limpa intencao e agendamento_id', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(
    tabelas,
    clinicaId,
    { intencao: 'cancelamento', agendamento_id: crypto.randomUUID() },
    null,
    pacienteId
  );
  const rpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'negacao', alteracoes: {} }]),
    new ClienteFalso(tabelas),
    rpc,
    entrada('deixa pra lá')
  );

  assert.deepEqual(resultado.decisao, { tipo: 'desistencia' });
  const dados = linhaConversa(tabelas).dados;
  assert.ok(!('intencao' in dados));
  assert.ok(!('agendamento_id' in dados));
  assert.equal(rpc.chamadas.length, 0);
});

// --- Isolamento (par A/B obrigatorio) ---

test('PAR A/B: a MESMA frase so cancela quando intencao=cancelamento esta presente', async () => {
  async function rodar(dados: Record<string, string>) {
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
    semearConversa(
      tabelas,
      clinicaId,
      dados,
      { proposta_pendente: { data: '2026-08-10', horario: '14:00' }, criado_em: new Date().toISOString() },
      pacienteId
    );
    const rpc = new ClienteRpcFalso({ cappia_cancelar_agendamento_v2: respostaCanceladoOk() });
    const resultado = await processarMensagem(
      clienteModeloSemAlteracoes(),
      new ClienteFalso(tabelas),
      rpc,
      entrada('sim')
    );
    return { decisao: resultado.decisao, chamadas: rpc.chamadas.length };
  }

  const comIntencao = await rodar({ intencao: 'cancelamento', confirmacao: 'sim' });
  const semIntencao = await rodar({ confirmacao: 'sim' });

  assert.equal(comIntencao.decisao.tipo, 'cancelamento_criado');
  assert.equal(comIntencao.chamadas, 1);
  // Sem a intencao, a MESMA frase e o MESMO estado nunca cancelam nada.
  assert.notEqual(semIntencao.decisao.tipo, 'cancelamento_criado');
  assert.equal(semIntencao.chamadas, 0);
});
