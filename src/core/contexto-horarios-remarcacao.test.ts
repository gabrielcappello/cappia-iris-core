// Testes da quinta variante de contexto pendente -- escolha entre varios
// agendamentos ativos (specs/remarcacao-conversacional-v1.md secao 3).
// Arquivo separado de contexto-horarios.test.ts pelo mesmo criterio ja usado
// no restante do projeto: cenario proprio, sem misturar com os testes gerais
// das quatro variantes existentes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { derivarAcaoContextoHorarios, gravarContextoHorarios, validarContextoHorarios } from './contexto-horarios.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';
import type { AgendamentoAtivo } from './buscar-agendamento-ativo.ts';
import type { ClienteBancoDados, ConsultaEncadeavel } from './tipos.ts';

function agendamento(id: string, overrides: Partial<AgendamentoAtivo> = {}): AgendamentoAtivo {
  return {
    agendamento_id: id,
    data: '2026-08-10',
    horario: '14:00',
    dentista_id: 'dentista-1',
    dentista_nome: 'Dra. Ana',
    procedimento_id: 'cleaning',
    procedimento: 'Limpeza',
    ...overrides,
  };
}

// --- Derivacao ---

test('derivacao: aguardando_escolha_agendamento vira perguntar_qual_agendamento com os IDs, na ordem recebida', () => {
  const decisao: DecisaoOrquestrador = {
    tipo: 'aguardando_escolha_agendamento',
    agendamentos: [agendamento('ag-2'), agendamento('ag-1')],
  };
  assert.deepEqual(derivarAcaoContextoHorarios(decisao), {
    tipo: 'perguntar_qual_agendamento',
    agendamento_ids: ['ag-2', 'ag-1'],
  });
});

test('derivacao: aguardando_confirmacao_remarcacao vira propor, com a OPCAO NOVA (nunca o agendamento atual)', () => {
  const decisao: DecisaoOrquestrador = {
    tipo: 'aguardando_confirmacao_remarcacao',
    agendamento_atual: agendamento('ag-1', { data: '2026-08-10', horario: '14:00' }),
    procedimento_id: 'cleaning',
    dentista_id: 'dentista-1',
    opcao: {
      clinica_id: 'clinica-1',
      procedimento_id: 'cleaning',
      dentista_id: 'dentista-1',
      data: '2026-08-20',
      fuso: 'America/Sao_Paulo',
      duracao_min: 40,
      inicio_min: 540,
      fim_min: 580,
    },
  };
  assert.deepEqual(derivarAcaoContextoHorarios(decisao), { tipo: 'propor', operacao: 'remarcar', data: '2026-08-20', horario: '09:00' });
});

test('derivacao: sem_agendamento_para_remarcar e remarcacao_criada limpam o contexto', () => {
  assert.deepEqual(derivarAcaoContextoHorarios({ tipo: 'sem_agendamento_para_remarcar' }), { tipo: 'limpar' });
  assert.deepEqual(
    derivarAcaoContextoHorarios({
      tipo: 'remarcacao_criada',
      agendamento_id: 'novo',
      agendamento_id_antigo: 'antigo',
      dentista_id: 'dentista-1',
      procedimento_id: 'cleaning',
      duracao_min: 40,
      data: '2026-08-20',
      horario: '09:00',
    }),
    { tipo: 'limpar' }
  );
});

// --- Leitura (round-trip do snapshot) ---

test('leitura: snapshot valido (so escolha_agendamento_pendente) atravessa intacto', () => {
  const valido = { escolha_agendamento_pendente: { agendamento_ids: ['ag-1', 'ag-2'] }, criado_em: '2026-08-11T12:00:00.000Z' };
  assert.deepEqual(validarContextoHorarios(valido), valido);
});

test('leitura: escolha_agendamento_pendente malformado invalida o snapshot inteiro', () => {
  const casos: unknown[] = [
    { escolha_agendamento_pendente: { agendamento_ids: [] }, criado_em: 'x' },
    { escolha_agendamento_pendente: { agendamento_ids: [1, 2] }, criado_em: 'x' },
    { escolha_agendamento_pendente: { agendamento_ids: ['  '] }, criado_em: 'x' },
    { escolha_agendamento_pendente: 'ag-1', criado_em: 'x' },
    { escolha_agendamento_pendente: null, criado_em: 'x' },
    { escolha_agendamento_pendente: { agendamento_ids: ['ag-1'], extra: true }, criado_em: 'x' },
  ];
  for (const caso of casos) {
    assert.equal(validarContextoHorarios(caso), null, `esperava null para ${JSON.stringify(caso)}`);
  }
});

// --- Gravacao ---

function clienteQueRegistraUpdate(): { cliente: ClienteBancoDados; capturado: { valores?: Record<string, unknown> } } {
  const capturado: { valores?: Record<string, unknown> } = {};
  const consulta: ConsultaEncadeavel = {
    eq: () => consulta,
    is: () => consulta,
    gte: () => consulta,
    not: () => consulta,
    select: () => consulta,
    maybeSingle: async () => ({ data: { id: 'linha-1' }, error: null }),
    then: (onfulfilled, onrejected) => Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected),
  };
  return {
    cliente: {
      from: (_nome: string) => ({
        select: () => consulta,
        upsert: () => consulta,
        update: (valores: Record<string, unknown>) => {
          capturado.valores = valores;
          return consulta;
        },
      }),
    },
    capturado,
  };
}

test('gravacao: perguntar_qual_agendamento grava SOMENTE escolha_agendamento_pendente, sem merge com marcadores anteriores', async () => {
  const { cliente, capturado } = clienteQueRegistraUpdate();

  await gravarContextoHorarios(cliente, {
    conversa_id: 'conversa-1',
    clinica_id: 'clinica-1',
    telefone_normalizado: '5511999999999',
    atualizado_em_da_decisao: '2026-08-11T12:00:00.000Z',
    acao: { tipo: 'perguntar_qual_agendamento', agendamento_ids: ['ag-1', 'ag-2'] },
  });

  const contextoGravado = capturado.valores?.contexto_horarios as Record<string, unknown>;
  assert.deepEqual(contextoGravado.escolha_agendamento_pendente, { agendamento_ids: ['ag-1', 'ag-2'] });
  assert.equal('horarios' in contextoGravado, false);
  assert.equal('proposta_pendente' in contextoGravado, false);
});
