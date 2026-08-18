// Testes de `declarar-pergunta-pendente.ts` -- a anotacao "eu perguntei X"
// derivada da decisao do Core (spec contexto-conversacional-unificado-v2.md
// secoes 14.5 e 14.6).
//
// O QUE ESTES TESTES PROVAM:
//   1. cada decisao que DEIXA pergunta produz a anotacao certa, com a
//      `operacao` que distingue criar/remarcar/cancelar;
//   2. cada desfecho que NAO deixa pergunta produz `null` -- afirmacao
//      factual, nao ausencia de informacao;
//   3. a anotacao produzida e SEMPRE valida perante `validarPerguntaPendente`
//      -- e o que garante que o proprio Core nunca grava algo que a leitura
//      recusaria no turno seguinte.
//
// O item 3 e o que impede o par escrita/leitura de divergir em silencio.

import test from 'node:test';
import assert from 'node:assert/strict';

import { declararPerguntaPendente } from './declarar-pergunta-pendente.ts';
import { validarPerguntaPendente } from './resultado-iris-validador.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';
import type { AgendamentoAtivo } from './buscar-agendamento-ativo.ts';

function agendamento(id: string, data = '2026-08-20', horario = '10:00'): AgendamentoAtivo {
  return {
    agendamento_id: id,
    data,
    horario,
    dentista_id: 'dent-1',
    dentista_nome: 'Dr. Diego Ramoz',
    procedimento_id: 'proc-1',
    procedimento: 'Consulta / Avaliação',
  };
}

function opcao(inicioMin: number) {
  return {
    clinica_id: 'cli-1',
    procedimento_id: 'proc-1',
    dentista_id: 'dent-1',
    data: '2026-08-20',
    fuso: 'America/Sao_Paulo',
    duracao_min: 60,
    inicio_min: inicioMin,
    fim_min: inicioMin + 60,
  };
}

// ── Escolha de horario ─────────────────────────────────────────────────

test('horarios_disponiveis com opcoes vira escolha_horario com a lista apresentada', () => {
  const decisao = {
    tipo: 'horarios_disponiveis',
      dentista_nome_exibido: 'Dra. Ana',
    resultado: { tipo: 'opcoes', opcoes: [opcao(600), opcao(840)] },
  } as unknown as DecisaoOrquestrador;

  const r = declararPerguntaPendente(decisao);
  assert.equal(r?.tipo, 'escolha_horario');
  // Mesmo formato que o paciente viu -- e o que permite resolver "o primeiro".
  assert.deepEqual(r?.opcoes, ['10:00', '14:00']);
});

test('horario_exato_indisponivel guarda os vizinhos oferecidos', () => {
  const decisao = {
    tipo: 'horarios_disponiveis',
      dentista_nome_exibido: 'Dra. Ana',
    resultado: { tipo: 'horario_exato_indisponivel', anterior: opcao(540), posterior: opcao(660) },
  } as unknown as DecisaoOrquestrador;

  assert.deepEqual(declararPerguntaPendente(decisao)?.opcoes, ['09:00', '11:00']);
});

test('horario_exato_indisponivel com um vizinho so guarda esse', () => {
  const decisao = {
    tipo: 'horarios_disponiveis',
      dentista_nome_exibido: 'Dra. Ana',
    resultado: { tipo: 'horario_exato_indisponivel', posterior: opcao(660) },
  } as unknown as DecisaoOrquestrador;

  assert.deepEqual(declararPerguntaPendente(decisao)?.opcoes, ['11:00']);
});

test('sem opcao real NAO grava anotacao -- escolha vazia seria irresolvivel', () => {
  for (const resultado of [
    { tipo: 'opcoes', opcoes: [] },
    { tipo: 'sem_disponibilidade' },
    { tipo: 'sem_expediente_no_dia', motivo: 'sem_jornada' },
    { tipo: 'horario_exato_indisponivel' },
    // Proposta, nao escolha: vira aguardando_confirmacao no turno seguinte.
    { tipo: 'horario_exato_disponivel', opcao: opcao(600) },
  ]) {
    const decisao = { tipo: 'horarios_disponiveis',
      dentista_nome_exibido: 'Dra. Ana', resultado } as unknown as DecisaoOrquestrador;
    assert.equal(declararPerguntaPendente(decisao), null, `resultado ${resultado.tipo}`);
  }
});

// ── Confirmacoes: a `operacao` e o que impede um "sim" autorizar outra ──

test('aguardando_confirmacao vira confirmacao/criar, SEM agendamento_id', () => {
  const r = declararPerguntaPendente({ tipo: 'aguardando_confirmacao' } as DecisaoOrquestrador);
  assert.equal(r?.tipo, 'confirmacao');
  assert.equal(r?.operacao, 'criar');
  // Criacao nunca referencia agendamento existente.
  assert.equal(r?.agendamento_id, undefined);
});

test('confirmacao de cancelamento carrega operacao E o alvo', () => {
  const r = declararPerguntaPendente({
    tipo: 'aguardando_confirmacao_cancelamento',
    agendamento: agendamento('ag-77'),
  } as unknown as DecisaoOrquestrador);
  assert.equal(r?.operacao, 'cancelar');
  assert.equal(r?.agendamento_id, 'ag-77');
});

test('confirmacao de remarcacao carrega o agendamento ATUAL como alvo', () => {
  const r = declararPerguntaPendente({
    tipo: 'aguardando_confirmacao_remarcacao',
    agendamento_atual: agendamento('ag-88'),
  } as unknown as DecisaoOrquestrador);
  assert.equal(r?.operacao, 'remarcar');
  assert.equal(r?.agendamento_id, 'ag-88');
});

test('as tres confirmacoes se distinguem -- e o que a RPC exige para autorizar', () => {
  const criar = declararPerguntaPendente({ tipo: 'aguardando_confirmacao' } as DecisaoOrquestrador);
  const cancelar = declararPerguntaPendente({
    tipo: 'aguardando_confirmacao_cancelamento',
    agendamento: agendamento('ag-1'),
  } as unknown as DecisaoOrquestrador);
  const remarcar = declararPerguntaPendente({
    tipo: 'aguardando_confirmacao_remarcacao',
    agendamento_atual: agendamento('ag-1'),
  } as unknown as DecisaoOrquestrador);

  const operacoes = new Set([criar?.operacao, cancelar?.operacao, remarcar?.operacao]);
  assert.equal(operacoes.size, 3, 'as tres precisam ser distinguiveis');
});

// ── Escolha entre agendamentos ─────────────────────────────────────────

test('escolha de agendamento para remarcar leva operacao e rotulos legiveis', () => {
  const r = declararPerguntaPendente({
    tipo: 'aguardando_escolha_agendamento',
    agendamentos: [agendamento('a', '2026-08-20', '10:00'), agendamento('b', '2026-08-22', '11:30')],
  } as unknown as DecisaoOrquestrador);

  assert.equal(r?.tipo, 'escolha_agendamento');
  assert.equal(r?.operacao, 'remarcar');
  assert.deepEqual(r?.opcoes, ['20/08 10:00', '22/08 11:30']);
});

test('escolha de agendamento para cancelar leva operacao cancelar', () => {
  const r = declararPerguntaPendente({
    tipo: 'aguardando_escolha_agendamento_cancelamento',
    agendamentos: [agendamento('a')],
  } as unknown as DecisaoOrquestrador);
  assert.equal(r?.operacao, 'cancelar');
});

// ── Demais perguntas ───────────────────────────────────────────────────

test('escolha de dentista leva os nomes apresentados', () => {
  const r = declararPerguntaPendente({
    tipo: 'aguardando_escolha_dentista',
    dentistas: [
      { dentista_id: 'd1', nome_exibido: 'Dr. Diego Ramoz' },
      { dentista_id: 'd2', nome_exibido: 'Dra. Vanesa Vocaro' },
    ],
  } as unknown as DecisaoOrquestrador);

  assert.equal(r?.tipo, 'escolha_dentista');
  assert.deepEqual(r?.opcoes, ['Dr. Diego Ramoz', 'Dra. Vanesa Vocaro']);
});

test('troca de telefone e cadastro viram os tipos simples', () => {
  assert.equal(
    declararPerguntaPendente({ tipo: 'troca_telefone_pendente' } as unknown as DecisaoOrquestrador)?.tipo,
    'troca_telefone'
  );
  assert.equal(
    declararPerguntaPendente({
      tipo: 'cadastro_necessario',
      campos_faltantes: ['nome'],
    } as unknown as DecisaoOrquestrador)?.tipo,
    'cadastro'
  );
});

// ── Desfechos que NAO deixam pergunta ──────────────────────────────────

test('desfechos concluidos e erros NAO deixam pergunta em aberto', () => {
  const encerram = [
    'reserva_criada',
    'cancelamento_criado',
    'remarcacao_criada',
    'resolvido',
    'desistencia',
    'saudacao',
    'duvida_livre',
    'mensagem_nao_compreendida',
    'sem_agendamento_para_cancelar',
    'sem_agendamento_para_remarcar',
    'reserva_conflito',
    'reserva_falhou',
    'clinica_sem_catalogo',
    'combinacao_indisponivel',
    'sem_dentista_disponivel',
    'troca_telefone_recusada',
    // Pendencias sem escolha estruturada: nada a resolver no turno seguinte.
    'aguardando_procedimento',
    'aguardando_data_horario',
  ];
  for (const tipo of encerram) {
    assert.equal(
      declararPerguntaPendente({ tipo } as unknown as DecisaoOrquestrador),
      null,
      `decisao ${tipo} nao deveria deixar pergunta`
    );
  }
});

// ── A invariante que liga escrita e leitura ────────────────────────────

test('TODA anotacao produzida passa na validacao da leitura', () => {
  // Se este teste falhar, o Core estaria gravando algo que ele proprio
  // recusaria no turno seguinte -- a conversa travaria por dado invalido
  // criado por nos mesmos.
  const decisoes: unknown[] = [
    { tipo: 'horarios_disponiveis',
      dentista_nome_exibido: 'Dra. Ana', resultado: { tipo: 'opcoes', opcoes: [opcao(600)] } },
    { tipo: 'aguardando_confirmacao' },
    { tipo: 'aguardando_confirmacao_cancelamento', agendamento: agendamento('ag-1') },
    { tipo: 'aguardando_confirmacao_remarcacao', agendamento_atual: agendamento('ag-2') },
    { tipo: 'aguardando_escolha_agendamento', agendamentos: [agendamento('a')] },
    { tipo: 'aguardando_escolha_agendamento_cancelamento', agendamentos: [agendamento('a')] },
    { tipo: 'aguardando_escolha_dentista', dentistas: [{ dentista_id: 'd', nome_exibido: 'Dr. X' }] },
    { tipo: 'troca_telefone_pendente' },
    { tipo: 'cadastro_necessario', campos_faltantes: ['nome'] },
  ];

  for (const d of decisoes) {
    const anotacao = declararPerguntaPendente(d as DecisaoOrquestrador);
    if (anotacao === null) continue;
    const validacao = validarPerguntaPendente(anotacao);
    assert.equal(
      validacao.ok,
      true,
      `anotacao de ${(d as { tipo: string }).tipo} foi recusada pela leitura: ` +
        `${validacao.ok ? '' : validacao.erro}`
    );
  }
});

test('funcao e pura: mesma decisao, mesmo resultado, sem efeito colateral', () => {
  const decisao = {
    tipo: 'aguardando_confirmacao_cancelamento',
    agendamento: agendamento('ag-1'),
  } as unknown as DecisaoOrquestrador;
  assert.deepEqual(declararPerguntaPendente(decisao), declararPerguntaPendente(decisao));
});
