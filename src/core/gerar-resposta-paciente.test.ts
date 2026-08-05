import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gerarRespostaPaciente, type DecisaoCaminhoFeliz } from './gerar-resposta-paciente.ts';
import type { OpcaoHorario } from './disponibilidade-tipos.ts';

function opcao(overrides: Partial<OpcaoHorario> = {}): OpcaoHorario {
  return {
    clinica_id: 'clinica-1',
    procedimento_id: 'teste_limpeza',
    dentista_id: 'dentista-1',
    data: '2026-08-05',
    fuso: 'America/Sao_Paulo',
    duracao_min: 40,
    inicio_min: 540, // 09:00
    fim_min: 580,
    ...overrides,
  };
}

// --- horarios_disponiveis / opcoes ---

test('horarios_disponiveis/opcoes: uma unica opcao vira frase com data e horario', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'horarios_disponiveis',
    procedimento_id: 'teste_limpeza',
    dentista_id: 'dentista-1',
    duracao_min: 40,
    resultado: { tipo: 'opcoes', opcoes: [opcao()] },
  };
  assert.equal(gerarRespostaPaciente(decisao), 'Horários livres para 05/08: 09:00. Qual você prefere?');
});

test('horarios_disponiveis/opcoes: varias opcoes da MESMA data mencionam a data uma unica vez', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'horarios_disponiveis',
    procedimento_id: 'teste_limpeza',
    dentista_id: 'dentista-1',
    duracao_min: 40,
    resultado: {
      tipo: 'opcoes',
      opcoes: [opcao({ inicio_min: 480 }), opcao({ inicio_min: 540 }), opcao({ inicio_min: 680 })],
    },
  };
  assert.equal(
    gerarRespostaPaciente(decisao),
    'Horários livres para 05/08: 08:00, 09:00, 11:20. Qual você prefere?'
  );
});

test('horarios_disponiveis/opcoes: nao menciona procedimento_id nem dentista_id (dados nao disponiveis pro texto)', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'horarios_disponiveis',
    procedimento_id: 'teste_limpeza',
    dentista_id: 'dentista-1',
    duracao_min: 40,
    resultado: { tipo: 'opcoes', opcoes: [opcao()] },
  };
  const texto = gerarRespostaPaciente(decisao);
  assert.ok(!texto.includes('teste_limpeza'));
  assert.ok(!texto.includes('dentista-1'));
});

// --- horarios_disponiveis / sem_disponibilidade ---

test('horarios_disponiveis/sem_disponibilidade: convida a tentar outra data', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'horarios_disponiveis',
    procedimento_id: 'teste_limpeza',
    dentista_id: 'dentista-1',
    duracao_min: 40,
    resultado: { tipo: 'sem_disponibilidade' },
  };
  assert.equal(
    gerarRespostaPaciente(decisao),
    'Não encontrei nenhum horário livre para essa data. Quer tentar outra data?'
  );
});

// --- horarios_disponiveis / horario_exato_disponivel (estruturalmente nunca ocorre nesta posicao, mas o tipo exige tratamento) ---

test('horarios_disponiveis/horario_exato_disponivel: formata a unica opcao presente', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'horarios_disponiveis',
    procedimento_id: 'teste_limpeza',
    dentista_id: 'dentista-1',
    duracao_min: 40,
    resultado: { tipo: 'horario_exato_disponivel', opcao: opcao({ inicio_min: 600 }) },
  };
  assert.equal(gerarRespostaPaciente(decisao), 'Encontrei um horário disponível: 05/08 às 10:00.');
});

// --- horarios_disponiveis / horario_exato_indisponivel ---

test('horario_exato_indisponivel: com anterior e posterior, oferece os dois', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'horarios_disponiveis',
    procedimento_id: 'teste_limpeza',
    dentista_id: 'dentista-1',
    duracao_min: 40,
    resultado: {
      tipo: 'horario_exato_indisponivel',
      anterior: opcao({ inicio_min: 480 }),
      posterior: opcao({ inicio_min: 600 }),
    },
  };
  assert.equal(
    gerarRespostaPaciente(decisao),
    'Esse horário não está livre. Tenho 08:00 ou 10:00 disponíveis. Qual você prefere?'
  );
});

test('horario_exato_indisponivel: so anterior', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'horarios_disponiveis',
    procedimento_id: 'teste_limpeza',
    dentista_id: 'dentista-1',
    duracao_min: 40,
    resultado: { tipo: 'horario_exato_indisponivel', anterior: opcao({ inicio_min: 480 }) },
  };
  assert.equal(gerarRespostaPaciente(decisao), 'Esse horário não está livre. Tenho 08:00 disponível. Prefere esse?');
});

test('horario_exato_indisponivel: so posterior', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'horarios_disponiveis',
    procedimento_id: 'teste_limpeza',
    dentista_id: 'dentista-1',
    duracao_min: 40,
    resultado: { tipo: 'horario_exato_indisponivel', posterior: opcao({ inicio_min: 600 }) },
  };
  assert.equal(gerarRespostaPaciente(decisao), 'Esse horário não está livre. Tenho 10:00 disponível. Prefere esse?');
});

test('horario_exato_indisponivel: nenhum vizinho', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'horarios_disponiveis',
    procedimento_id: 'teste_limpeza',
    dentista_id: 'dentista-1',
    duracao_min: 40,
    resultado: { tipo: 'horario_exato_indisponivel' },
  };
  assert.equal(
    gerarRespostaPaciente(decisao),
    'Esse horário não está livre e não encontrei outro próximo nessa data. Quer tentar outra data?'
  );
});

// --- horarios_disponiveis / erros de configuracao/estrutura ---

test('configuracao_invalida: texto generico tecnico, nunca expoe o motivo bruto', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'horarios_disponiveis',
    procedimento_id: 'teste_limpeza',
    dentista_id: 'dentista-1',
    duracao_min: 40,
    resultado: { tipo: 'configuracao_invalida', motivo: 'fuso_invalido' },
  };
  const texto = gerarRespostaPaciente(decisao);
  assert.equal(texto, 'Não consegui calcular os horários agora. Pode tentar novamente em instantes?');
  assert.ok(!texto.includes('fuso_invalido'));
});

test('erro_intervalos: mesmo texto tecnico generico, nunca expoe o codigo bruto', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'horarios_disponiveis',
    procedimento_id: 'teste_limpeza',
    dentista_id: 'dentista-1',
    duracao_min: 40,
    resultado: { tipo: 'erro_intervalos', codigo: 'intervalo_invertido', intervalos: [] },
  };
  const texto = gerarRespostaPaciente(decisao);
  assert.equal(texto, 'Não consegui calcular os horários agora. Pode tentar novamente em instantes?');
  assert.ok(!texto.includes('intervalo_invertido'));
});

// --- aguardando_confirmacao ---

test('aguardando_confirmacao: mostra o horario e pede confirmacao', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'aguardando_confirmacao',
    procedimento_id: 'teste_limpeza',
    dentista_id: 'dentista-1',
    opcao: opcao({ data: '2026-12-25', inicio_min: 540 }),
  };
  assert.equal(gerarRespostaPaciente(decisao), 'Encontrei esse horário: 25/12 às 09:00. Posso confirmar?');
});

// --- reserva_criada ---

test('reserva_criada: confirma data e horario ja resolvidos pela RPC', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'reserva_criada',
    agendamento_id: 'agendamento-1',
    dentista_id: 'dentista-1',
    procedimento_id: 'teste_limpeza',
    duracao_min: 40,
    data: '2026-08-05',
    horario: '09:00',
  };
  assert.equal(gerarRespostaPaciente(decisao), 'Prontinho! Agendamento confirmado para 05/08 às 09:00.');
});

test('reserva_criada: nao menciona agendamento_id, procedimento_id nem dentista_id no texto', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'reserva_criada',
    agendamento_id: 'agendamento-1',
    dentista_id: 'dentista-1',
    procedimento_id: 'teste_limpeza',
    duracao_min: 40,
    data: '2026-08-05',
    horario: '09:00',
  };
  const texto = gerarRespostaPaciente(decisao);
  assert.ok(!texto.includes('agendamento-1'));
  assert.ok(!texto.includes('teste_limpeza'));
  assert.ok(!texto.includes('dentista-1'));
});

// --- reserva_conflito ---

test('reserva_conflito: pede nova escolha, sem inventar horario alternativo (o tipo nao carrega nenhum dado)', () => {
  const decisao: DecisaoCaminhoFeliz = { tipo: 'reserva_conflito' };
  assert.equal(gerarRespostaPaciente(decisao), 'Esse horário acabou de ficar indisponível. Pode escolher outro horário?');
});

// --- saudacao ---

test('saudacao: cumprimenta e pergunta como pode ajudar, nunca null', () => {
  const decisao: DecisaoCaminhoFeliz = { tipo: 'saudacao' };
  const texto = gerarRespostaPaciente(decisao);
  assert.equal(texto, 'Olá! Como posso te ajudar hoje?');
  assert.notEqual(texto, null);
});

// --- aguardando_procedimento ---
//
// Os quatro motivos (procedimento-tipos.ts) sao equivalentes perante o
// paciente por contrato (specs/procedimentos-v1.md secao 7) -- mesma
// pergunta pros quatro, nunca revela qual dos quatro ocorreu.

for (const motivo of ['texto_ausente', 'sem_correspondencia', 'alias_inativo', 'procedimento_inativo'] as const) {
  test(`aguardando_procedimento (motivo ${motivo}): pergunta qual procedimento, nunca null`, () => {
    const decisao: DecisaoCaminhoFeliz = { tipo: 'aguardando_procedimento', resultado: { tipo: 'nao_resolvido', motivo } };
    const texto = gerarRespostaPaciente(decisao);
    assert.equal(texto, 'Qual procedimento ou atendimento você está buscando?');
    assert.notEqual(texto, null);
  });
}

// --- determinismo ---

test('determinismo: mesma decisao produz sempre o mesmo texto', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'reserva_criada',
    agendamento_id: 'agendamento-1',
    dentista_id: 'dentista-1',
    procedimento_id: 'teste_limpeza',
    duracao_min: 40,
    data: '2026-08-05',
    horario: '09:00',
  };
  const resultados = new Set(Array.from({ length: 5 }, () => gerarRespostaPaciente(decisao)));
  assert.equal(resultados.size, 1);
});
