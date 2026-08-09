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
    const decisao: DecisaoCaminhoFeliz = { tipo: 'aguardando_procedimento' };
    const texto = gerarRespostaPaciente(decisao);
    assert.equal(texto, 'Qual procedimento ou atendimento você está buscando?');
    assert.notEqual(texto, null);
  });
}

// --- aguardando_data_horario ---
//
// 6 tipos de topo (ResultadoResolucaoTemporal exceto 'resolvido'), 31
// motivos ao todo. So 8 sao alcancaveis hoje pelo adaptador atual
// (montar-fatos-temporais.ts) -- os demais sao testados so por
// exaustividade de contrato, nunca null (aprovado por Gabriel em
// 2026-08-05).

function decisaoAguardando(
  resultado: Exclude<import('./temporal-tipos.ts').ResultadoResolucaoTemporal, { tipo: 'resolvido' }>
): DecisaoCaminhoFeliz {
  return { tipo: 'aguardando_data_horario', resultado };
}

// -- incompleto: alcancaveis --

test('aguardando_data_horario/incompleto (intencao_ausente, alcancavel): pede a data', () => {
  const decisao = decisaoAguardando({ tipo: 'incompleto', motivo: 'intencao_ausente' });
  assert.equal(
    gerarRespostaPaciente(decisao),
    'Para qual data você gostaria de agendar? Pode ser hoje, amanhã ou uma data específica.'
  );
});

test('aguardando_data_horario/incompleto (data_ausente, inalcancavel hoje): compartilha texto com intencao_ausente', () => {
  const decisao = decisaoAguardando({ tipo: 'incompleto', motivo: 'data_ausente' });
  assert.equal(
    gerarRespostaPaciente(decisao),
    'Para qual data você gostaria de agendar? Pode ser hoje, amanhã ou uma data específica.'
  );
});

test('aguardando_data_horario/incompleto (horario_recorrente_nao_suportado, inalcancavel hoje): texto separado, nao compartilha', () => {
  const decisao = decisaoAguardando({ tipo: 'incompleto', motivo: 'horario_recorrente_nao_suportado' });
  const texto = gerarRespostaPaciente(decisao);
  assert.equal(texto, 'No momento só consigo buscar horário pra uma data específica. Qual data você prefere?');
  assert.notEqual(texto, 'Para qual data você gostaria de agendar? Pode ser hoje, amanhã ou uma data específica.');
});

// -- ambiguo: nenhum motivo alcancavel hoje, texto generico unico --

for (const motivo of [
  'dia_semana_sem_qualificador',
  'horario_sem_parte_dia',
  'horario_nao_classificado',
  'hora_12_com_parte_dia_ambigua',
  'expressao_temporal_nao_classificada',
] as const) {
  test(`aguardando_data_horario/ambiguo (motivo ${motivo}, inalcancavel hoje): texto generico, nunca null`, () => {
    const decisao = decisaoAguardando({ tipo: 'ambiguo', motivo });
    const texto = gerarRespostaPaciente(decisao);
    assert.equal(
      texto,
      'Não consegui entender exatamente a data ou horário. Pode me dizer de um jeito mais direto, tipo "15/03" ou "14h"?'
    );
    assert.notEqual(texto, null);
  });
}

// -- invalido: 3 grupos --

for (const motivo of ['data_impossivel', 'ano_fora_do_dominio', 'ano_dois_digitos'] as const) {
  test(`aguardando_data_horario/invalido (motivo ${motivo}): grupo "data invalida"`, () => {
    const decisao = decisaoAguardando({ tipo: 'invalido', motivo });
    assert.equal(gerarRespostaPaciente(decisao), 'Essa data não existe no calendário. Pode conferir e me mandar de novo? Ex.: 15/03.');
  });
}

for (const motivo of ['hora_fora_do_dominio', 'minuto_fora_do_dominio', 'horario_24_00'] as const) {
  test(`aguardando_data_horario/invalido (motivo ${motivo}): grupo "horario invalido"`, () => {
    const decisao = decisaoAguardando({ tipo: 'invalido', motivo });
    assert.equal(gerarRespostaPaciente(decisao), 'Esse horário não é válido. Pode me mandar de novo? Ex.: 14h ou 14:30.');
  });
}

for (const motivo of ['atomo_invalido', 'quantidade_atomica_excedida'] as const) {
  test(`aguardando_data_horario/invalido (motivo ${motivo}, inalcancavel hoje): grupo generico`, () => {
    const decisao = decisaoAguardando({ tipo: 'invalido', motivo });
    assert.equal(gerarRespostaPaciente(decisao), 'Não consegui entender a data ou horário. Pode reformular?');
  });
}

// -- passado: 2 grupos, nunca compartilham entre si --

for (const motivo of ['data_passada', 'dia_semana_esta_passado'] as const) {
  test(`aguardando_data_horario/passado (motivo ${motivo}): grupo "data no passado"`, () => {
    const decisao = decisaoAguardando({ tipo: 'passado', motivo });
    assert.equal(gerarRespostaPaciente(decisao), 'Essa data já passou. Você quer marcar pra uma data futura?');
  });
}

for (const motivo of ['horario_passado', 'inicio_ate_passado', 'termino_ate_passado'] as const) {
  test(`aguardando_data_horario/passado (motivo ${motivo}): grupo "horario de hoje no passado"`, () => {
    const decisao = decisaoAguardando({ tipo: 'passado', motivo });
    assert.equal(gerarRespostaPaciente(decisao), 'Esse horário de hoje já passou. Prefere outro horário hoje, ou outro dia?');
  });
}

test('aguardando_data_horario/passado: os dois grupos nunca compartilham texto entre si', () => {
  const textoData = gerarRespostaPaciente(decisaoAguardando({ tipo: 'passado', motivo: 'data_passada' }));
  const textoHorario = gerarRespostaPaciente(decisaoAguardando({ tipo: 'passado', motivo: 'horario_passado' }));
  assert.notEqual(textoData, textoHorario);
});

// -- conflito: nenhum motivo alcancavel hoje, texto generico unico --

for (const motivo of [
  'multiplas_datas',
  'data_especifica_com_proxima_disponibilidade',
  'multiplas_intencoes',
  'multiplos_horarios_exatos',
  'restricoes_conflitantes',
  'periodo_incompativel_com_horario',
  'horario_viola_inicio_ate',
] as const) {
  test(`aguardando_data_horario/conflito (motivo ${motivo}, inalcancavel hoje): texto generico, nunca null`, () => {
    const decisao = decisaoAguardando({ tipo: 'conflito', motivo });
    const texto = gerarRespostaPaciente(decisao);
    assert.equal(texto, 'Percebi mais de uma data ou horário na sua mensagem e fiquei em dúvida. Pode confirmar só uma?');
    assert.notEqual(texto, null);
  });
}

// -- erro_configuracao: erro tecnico, nunca soa como duvida do paciente --

for (const motivo of ['fuso_ausente', 'fuso_formato_invalido'] as const) {
  test(`aguardando_data_horario/erro_configuracao (motivo ${motivo}): nao afirma acao que nao aconteceu`, () => {
    const decisao = decisaoAguardando({ tipo: 'erro_configuracao', motivo });
    const texto = gerarRespostaPaciente(decisao);
    assert.equal(texto, 'Não consegui calcular os horários dessa clínica agora. Pode tentar novamente em instantes?');
    assert.ok(!texto.toLowerCase().includes('equipe'));
    assert.ok(!texto.toLowerCase().includes('avis'));
  });
}

test('aguardando_data_horario/erro_configuracao (instante_atual_invalido, inalcancavel hoje): texto separado, nao soa como duvida do paciente', () => {
  const decisao = decisaoAguardando({ tipo: 'erro_configuracao', motivo: 'instante_atual_invalido' });
  const texto = gerarRespostaPaciente(decisao);
  assert.equal(texto, 'Tive um problema técnico agora. Pode tentar de novo em instantes?');
  assert.notEqual(texto, 'Não consegui calcular os horários dessa clínica agora. Pode tentar novamente em instantes?');
});

test('aguardando_data_horario: nenhum motivo, em nenhum tipo, expoe o codigo bruto do motivo', () => {
  const casos = [
    { tipo: 'incompleto', motivo: 'intencao_ausente' },
    { tipo: 'ambiguo', motivo: 'dia_semana_sem_qualificador' },
    { tipo: 'invalido', motivo: 'data_impossivel' },
    { tipo: 'passado', motivo: 'data_passada' },
    { tipo: 'conflito', motivo: 'multiplas_datas' },
    { tipo: 'erro_configuracao', motivo: 'fuso_ausente' },
  ] as const;
  for (const resultado of casos) {
    const texto = gerarRespostaPaciente(decisaoAguardando(resultado));
    assert.ok(!texto.includes(resultado.motivo));
  }
});

// --- os tres estados de conversa normal (2026-08-06) ---

test('aguardando_escolha_dentista: pergunta especificamente pelos nomes exibidos, nunca escolhe', () => {
  const decisao: DecisaoCaminhoFeliz = {
    tipo: 'aguardando_escolha_dentista',
    dentistas: [
      { dentista_id: 'd1', clinica_id: 'clinica-1', nome_exibido: 'Dra. Ana' },
      { dentista_id: 'd2', clinica_id: 'clinica-1', nome_exibido: 'Dr. Beto' },
    ],
  };
  const texto = gerarRespostaPaciente(decisao);
  assert.ok(texto.includes('Dra. Ana'));
  assert.ok(texto.includes('Dr. Beto'));
  assert.ok(!texto.includes('d1') && !texto.includes('d2'), 'nunca expoe dentista_id bruto');
});

test('cadastro_necessario: pede dado de cadastro, nunca soa como falha tecnica', () => {
  const texto = gerarRespostaPaciente({ tipo: 'cadastro_necessario' });
  assert.ok(!/problema t[eé]cnico/i.test(texto));
});

test('sem_dentista_disponivel: informa e oferece alternativa, nunca soa como falha tecnica', () => {
  const texto = gerarRespostaPaciente({ tipo: 'sem_dentista_disponivel' });
  assert.ok(!/problema t[eé]cnico/i.test(texto));
});

// --- os cinco estados de falha tecnica real ---

test('falha tecnica real: os cinco estados compartilham a mesma frase honesta, nunca expondo motivo bruto', () => {
  const decisoes: DecisaoCaminhoFeliz[] = [
    { tipo: 'clinica_sem_catalogo' },
    { tipo: 'erro_catalogo_dentista', resultado: { tipo: 'erro_catalogo', codigo: 'dentista_id_inconsistente', dentista_ids: ['d1'] } },
    { tipo: 'duracao_nao_configurada' },
    {
      tipo: 'erro_configuracao_duracao',
      resultado: { tipo: 'erro_configuracao', codigo: 'duracao_conflitante', procedimento_ids: [], duracoes_conflitantes: [] },
    },
    { tipo: 'reserva_falhou', motivo: 'erro_tecnico' },
  ];
  const textos = new Set(decisoes.map((d) => gerarRespostaPaciente(d)));
  assert.equal(textos.size, 1, 'os seis compartilham exatamente a mesma frase');
  const [texto] = textos;
  assert.ok(/problema t[eé]cnico/i.test(texto));
  assert.ok(!texto.includes('alias_ambiguo') && !texto.includes('erro_tecnico'));
});

// --- exaustividade: nenhum dos 18 tipos retorna null (nunca lanca, sempre string) ---

test('exaustividade: todos os 18 tipos de DecisaoOrquestrador produzem texto nao vazio', () => {
  const decisoes: DecisaoCaminhoFeliz[] = [
    { tipo: 'clinica_sem_catalogo' },
    { tipo: 'saudacao' },
    { tipo: 'duvida_livre' },
    { tipo: 'mensagem_nao_compreendida' },
    { tipo: 'desistencia' },
    { tipo: 'aguardando_procedimento' },
    { tipo: 'aguardando_escolha_dentista', dentistas: [{ dentista_id: 'd1', clinica_id: 'c1', nome_exibido: 'Dra. Ana' }] },
    { tipo: 'sem_dentista_disponivel' },
    { tipo: 'erro_catalogo_dentista', resultado: { tipo: 'erro_catalogo', codigo: 'dentista_id_inconsistente', dentista_ids: [] } },
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
    { tipo: 'reserva_criada', agendamento_id: 'a1', dentista_id: 'd1', procedimento_id: 'p1', duracao_min: 40, data: '2026-08-05', horario: '09:00' },
    { tipo: 'reserva_conflito' },
    { tipo: 'reserva_falhou', motivo: 'erro_tecnico' },
  ];
  assert.equal(decisoes.length, 18, 'confirma que os 18 tipos estao cobertos neste teste');
  for (const decisao of decisoes) {
    const texto = gerarRespostaPaciente(decisao);
    assert.equal(typeof texto, 'string');
    assert.ok(texto.trim().length > 0, `decisao ${decisao.tipo} produziu texto vazio`);
  }
});

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
