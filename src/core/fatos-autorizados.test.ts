// Testes de fatos-autorizados.ts (specs/resposta-conversacional-v1.md secao 2).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { derivarFatosAutorizados, type FatosAutorizados } from './fatos-autorizados.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';
import type { OpcaoHorario } from './disponibilidade-tipos.ts';

function opcao(overrides: Partial<OpcaoHorario> = {}): OpcaoHorario {
  return {
    clinica_id: 'clinica-1',
    procedimento_id: 'p1',
    dentista_id: 'd1',
    data: '2026-08-05',
    fuso: 'America/Sao_Paulo',
    duracao_min: 40,
    inicio_min: 540,
    fim_min: 580,
    ...overrides,
  };
}

const CAMPOS_SENSIVEIS_PROIBIDOS = ['telefone', 'cpf', 'nome', 'email', 'paciente_id', 'clinica_id', 'agendamento_id'];

function assertNuncaContemFraseProntaOuId(fatos: FatosAutorizados) {
  const serializado = JSON.stringify(fatos);
  for (const campo of CAMPOS_SENSIVEIS_PROIBIDOS) {
    assert.ok(!serializado.includes(`"${campo}"`), `fatos nunca deveriam conter a chave ${campo}`);
  }
}

// --- Mapeamento exaustivo: um caso por tipo, os 19 ---

test('mapeamento: os 19 tipos produzem um objetivo, nenhum lanca', () => {
  const decisoes: DecisaoOrquestrador[] = [
    { tipo: 'clinica_sem_catalogo' },
    { tipo: 'saudacao' },
    { tipo: 'duvida_livre' },
    { tipo: 'mensagem_nao_compreendida' },
    { tipo: 'desistencia' },
    { tipo: 'aguardando_procedimento', resultado: { tipo: 'nao_resolvido', motivo: 'texto_ausente' } },
    { tipo: 'erro_catalogo_procedimento', resultado: { tipo: 'erro_catalogo', codigo: 'alias_ambiguo', procedimento_ids: [] } },
    { tipo: 'aguardando_escolha_dentista', dentistas: [{ dentista_id: 'd1', clinica_id: 'c1', nome_exibido: 'Dra. Ana' }] },
    { tipo: 'sem_dentista_disponivel' },
    { tipo: 'erro_catalogo_dentista', resultado: { tipo: 'erro_catalogo', codigo: 'vinculo_orfao', dentista_ids: [] } },
    { tipo: 'duracao_nao_configurada' },
    {
      tipo: 'erro_configuracao_duracao',
      resultado: { tipo: 'erro_configuracao', codigo: 'duracao_conflitante', procedimento_ids: [], duracoes_conflitantes: [] },
    },
    { tipo: 'aguardando_data_horario', resultado: { tipo: 'incompleto', motivo: 'intencao_ausente' } },
    {
      tipo: 'horarios_disponiveis',
      procedimento_id: 'p1',
      dentista_id: 'd1',
      duracao_min: 40,
      resultado: { tipo: 'sem_disponibilidade' },
    },
    { tipo: 'aguardando_confirmacao', procedimento_id: 'p1', dentista_id: 'd1', opcao: opcao() },
    { tipo: 'cadastro_necessario' },
    {
      tipo: 'reserva_criada',
      agendamento_id: 'a1',
      dentista_id: 'd1',
      procedimento_id: 'p1',
      duracao_min: 40,
      data: '2026-08-05',
      horario: '09:00',
    },
    { tipo: 'reserva_conflito' },
    { tipo: 'reserva_falhou', motivo: 'erro_tecnico' },
  ];
  assert.equal(decisoes.length, 19);
  for (const decisao of decisoes) {
    const fatos = derivarFatosAutorizados(decisao);
    assert.equal(typeof fatos.objetivo, 'string');
    assertNuncaContemFraseProntaOuId(fatos);
  }
});

// --- Regra estrutural: nenhum campo carrega frase pronta ---

test('estrutural: nenhum valor de FatosAutorizados e uma frase completa (nunca contem espacos multiplos de frase)', () => {
  const fatos = derivarFatosAutorizados({ tipo: 'saudacao' });
  for (const valor of Object.values(fatos)) {
    if (typeof valor === 'string') {
      assert.ok(valor.split(' ').length <= 3, `campo parece uma frase pronta: "${valor}"`);
    }
  }
});

// --- Campos com dado real ---

test('aguardando_escolha_dentista: dentistas_candidatos carrega os nomes exibidos, na ordem', () => {
  const fatos = derivarFatosAutorizados({
    tipo: 'aguardando_escolha_dentista',
    dentistas: [
      { dentista_id: 'd1', clinica_id: 'c1', nome_exibido: 'Dra. Ana' },
      { dentista_id: 'd2', clinica_id: 'c1', nome_exibido: 'Dr. Beto' },
    ],
  });
  assert.equal(fatos.objetivo, 'escolher_entre_dentistas');
  assert.deepEqual(fatos.dentistas_candidatos, ['Dra. Ana', 'Dr. Beto']);
});

test('horarios_disponiveis/opcoes: horarios_disponiveis e data_referencia formatados como o paciente ve', () => {
  const fatos = derivarFatosAutorizados({
    tipo: 'horarios_disponiveis',
    procedimento_id: 'p1',
    dentista_id: 'd1',
    duracao_min: 40,
    resultado: { tipo: 'opcoes', opcoes: [opcao({ inicio_min: 480 }), opcao({ inicio_min: 540 })] },
  });
  assert.equal(fatos.objetivo, 'apresentar_horarios');
  assert.deepEqual(fatos.horarios_disponiveis, ['08:00', '09:00']);
  assert.equal(fatos.data_referencia, '05/08');
});

test('aguardando_confirmacao: proposta_pendente com data/horario formatados', () => {
  const fatos = derivarFatosAutorizados({
    tipo: 'aguardando_confirmacao',
    procedimento_id: 'p1',
    dentista_id: 'd1',
    opcao: opcao({ data: '2026-12-25', inicio_min: 540 }),
  });
  assert.equal(fatos.objetivo, 'pedir_confirmacao');
  assert.deepEqual(fatos.proposta_pendente, { data: '25/12', horario: '09:00' });
});

test('reserva_criada: agendamento_confirmado com data/horario, sem IDs', () => {
  const fatos = derivarFatosAutorizados({
    tipo: 'reserva_criada',
    agendamento_id: 'a1',
    dentista_id: 'd1',
    procedimento_id: 'p1',
    duracao_min: 40,
    data: '2026-08-05',
    horario: '09:00',
  });
  assert.equal(fatos.objetivo, 'informar_reserva_criada');
  assert.deepEqual(fatos.agendamento_confirmado, { data: '05/08', horario: '09:00' });
});

test('falha tecnica: os seis estados marcam falha_tecnica:true e objetivo informar_falha_tecnica', () => {
  const decisoes: DecisaoOrquestrador[] = [
    { tipo: 'clinica_sem_catalogo' },
    { tipo: 'erro_catalogo_procedimento', resultado: { tipo: 'erro_catalogo', codigo: 'alias_ambiguo', procedimento_ids: [] } },
    { tipo: 'erro_catalogo_dentista', resultado: { tipo: 'erro_catalogo', codigo: 'vinculo_orfao', dentista_ids: [] } },
    { tipo: 'duracao_nao_configurada' },
    {
      tipo: 'erro_configuracao_duracao',
      resultado: { tipo: 'erro_configuracao', codigo: 'duracao_conflitante', procedimento_ids: [], duracoes_conflitantes: [] },
    },
    { tipo: 'reserva_falhou', motivo: 'erro_tecnico' },
  ];
  for (const decisao of decisoes) {
    const fatos = derivarFatosAutorizados(decisao);
    assert.equal(fatos.objetivo, 'informar_falha_tecnica');
    assert.equal(fatos.falha_tecnica, true);
  }
});

test('determinismo: mesma decisao produz sempre os mesmos fatos', () => {
  const decisao: DecisaoOrquestrador = {
    tipo: 'horarios_disponiveis',
    procedimento_id: 'p1',
    dentista_id: 'd1',
    duracao_min: 40,
    resultado: { tipo: 'opcoes', opcoes: [opcao()] },
  };
  const resultados = Array.from({ length: 5 }, () => JSON.stringify(derivarFatosAutorizados(decisao)));
  assert.equal(new Set(resultados).size, 1);
});
