// Testes de fatos-autorizados.ts (specs/resposta-conversacional-v1.md secao 2).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { derivarFatosAutorizados, relacaoComHoje, type FatosAutorizados } from './fatos-autorizados.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';
import type { OpcaoHorario } from './disponibilidade-tipos.ts';

// `HOJE` distante das datas dos casos existentes: a relacao fica 'outra' e a
// data sai absoluta, exatamente como saia antes desta correcao. Os casos
// hoje/amanha sao cobertos pelos testes proprios no fim deste arquivo.
const HOJE = '2026-01-01';

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

function agendamentoAtivo(overrides: Record<string, unknown> = {}) {
  return {
    agendamento_id: 'ag1',
    data: '2026-08-10',
    horario: '14:00',
    dentista_id: 'd1',
    dentista_nome: 'Dra. Ana',
    procedimento_id: 'p1',
    procedimento: 'Limpeza',
    ...overrides,
  };
}

const CAMPOS_SENSIVEIS_PROIBIDOS = ['telefone', 'cpf', 'nome', 'email', 'paciente_id', 'clinica_id', 'agendamento_id'];

// A checagem e pela CHAVE (`"campo":`), nunca pelo token solto.
//
// Refinado em 2026-08-10: antes procurava `"campo"` em qualquer posicao do
// JSON, o que passou a acusar falso positivo quando `dados_faltantes` virou
// itemizado (specs/cadastro-conversacional-v1.md secao 8) e passou a conter
// os NOMES dos campos que faltam -- `["nome","cpf"]`.
//
// A distincao e a mesma que o projeto ja tornou canonica em
// `campos_cadastrais_preenchidos` (interpretacao-ia.md, "Entrada e PII"):
// dizer QUAIS campos existem/faltam nao revela nada; carregar o VALOR revela.
// Uma chave `"nome":` sempre carrega um valor e continua proibida -- se
// alguem acrescentasse `nome: 'Fernanda'` aos fatos, esta guarda pegaria
// exatamente como antes.
//
// O teste logo abaixo cobre o outro lado: `dados_faltantes` so pode conter
// nomes do vocabulario fechado, nunca um valor.
function assertNuncaContemFraseProntaOuId(fatos: FatosAutorizados) {
  const serializado = JSON.stringify(fatos);
  for (const campo of CAMPOS_SENSIVEIS_PROIBIDOS) {
    assert.ok(!serializado.includes(`"${campo}":`), `fatos nunca deveriam conter a chave ${campo}`);
  }
}

const CAMPOS_FALTANTES_PERMITIDOS = [
  'procedimento',
  'data',
  'horario',
  'nome',
  'cpf',
  'data_nascimento',
  'email',
];

test('PII: dados_faltantes carrega somente NOMES de campo do vocabulario fechado, nunca um valor', () => {
  // Um cadastro completo de PII sintetica: se algum valor escorregasse para
  // dados_faltantes, apareceria aqui.
  const decisoes: DecisaoOrquestrador[] = [
    { tipo: 'cadastro_necessario', campos_faltantes: ['nome', 'cpf', 'data_nascimento', 'email'] },
    { tipo: 'cadastro_necessario', campos_faltantes: ['cpf'] },
    { tipo: 'aguardando_procedimento' },
  ];

  for (const decisao of decisoes) {
    const fatos = derivarFatosAutorizados(decisao, HOJE);
    for (const campo of fatos.dados_faltantes ?? []) {
      assert.ok(
        CAMPOS_FALTANTES_PERMITIDOS.includes(campo),
        `dados_faltantes so pode conter nome de campo do vocabulario fechado, veio '${campo}'`
      );
    }
  }
});

// --- Mapeamento exaustivo: um caso por tipo, os 19 ---

test('mapeamento: os 18 tipos produzem um objetivo, nenhum lanca', () => {
  const decisoes: DecisaoOrquestrador[] = [
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
      dentista_nome_exibido: 'Dra. Ana',
      procedimento_id: 'p1',
      dentista_id: 'd1',
      duracao_min: 40,
      resultado: { tipo: 'sem_disponibilidade' },
    },
    { tipo: 'aguardando_confirmacao', procedimento_id: 'p1', dentista_id: 'd1', opcao: opcao() },
    { tipo: 'cadastro_necessario', campos_faltantes: ['nome'] },
    {
      tipo: 'reserva_criada',
      agendamento_id: 'a1',
      dentista_id: 'd1',
      procedimento_id: 'p1',
      duracao_min: 40,
      data: '2026-08-05',
      horario: '09:00',
      // Nomes exibiveis do fechamento conferivel (2026-08-16).
      dentista_nome_exibido: 'Dr. Diego Ramoz',
      procedimento_nome: 'Consulta / Avaliação',
    },
    { tipo: 'reserva_conflito' },
    { tipo: 'reserva_falhou', motivo: 'erro_tecnico' },
    // --- remarcacao (2026-08-11, specs/remarcacao-conversacional-v1.md) ---
    { tipo: 'sem_agendamento_para_remarcar' },
    { tipo: 'aguardando_escolha_agendamento', agendamentos: [agendamentoAtivo()] },
    {
      tipo: 'aguardando_confirmacao_remarcacao',
      agendamento_atual: agendamentoAtivo(),
      procedimento_id: 'p1',
      dentista_id: 'd1',
      opcao: opcao(),
    },
    {
      tipo: 'remarcacao_criada',
      agendamento_id: 'ag2',
      agendamento_id_antigo: 'ag1',
      dentista_id: 'd1',
      procedimento_id: 'p1',
      duracao_min: 40,
      data: '2026-08-20',
      horario: '09:00',
    },
  ];
  assert.equal(decisoes.length, 22);
  for (const decisao of decisoes) {
    const fatos = derivarFatosAutorizados(decisao, HOJE);
    assert.equal(typeof fatos.objetivo, 'string');
    assertNuncaContemFraseProntaOuId(fatos);
  }
});

// --- Regra estrutural: nenhum campo carrega frase pronta ---

test('estrutural: nenhum valor de FatosAutorizados e uma frase completa (nunca contem espacos multiplos de frase)', () => {
  const fatos = derivarFatosAutorizados({ tipo: 'saudacao' }, HOJE);
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
  }, HOJE);
  assert.equal(fatos.objetivo, 'escolher_entre_dentistas');
  assert.deepEqual(fatos.dentistas_candidatos, ['Dra. Ana', 'Dr. Beto']);
});

test('horarios_disponiveis/opcoes: horarios_disponiveis e data_referencia formatados como o paciente ve', () => {
  const fatos = derivarFatosAutorizados({
    tipo: 'horarios_disponiveis',
      dentista_nome_exibido: 'Dra. Ana',
    procedimento_id: 'p1',
    dentista_id: 'd1',
    duracao_min: 40,
    resultado: { tipo: 'opcoes', opcoes: [opcao({ inicio_min: 480 }), opcao({ inicio_min: 540 })] },
  }, HOJE);
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
  }, HOJE);
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
    // Nomes exibiveis do fechamento conferivel (2026-08-16).
    dentista_nome_exibido: 'Dr. Diego Ramoz',
    procedimento_nome: 'Consulta / Avaliação',
  }, HOJE);
  assert.equal(fatos.objetivo, 'informar_reserva_criada');
  assert.deepEqual(fatos.agendamento_confirmado, { data: '05/08', horario: '09:00' });
});

test('falha tecnica: os cinco estados marcam falha_tecnica:true e objetivo informar_falha_tecnica', () => {
  const decisoes: DecisaoOrquestrador[] = [
    { tipo: 'clinica_sem_catalogo' },
    { tipo: 'erro_catalogo_dentista', resultado: { tipo: 'erro_catalogo', codigo: 'dentista_id_inconsistente', dentista_ids: [] } },
    { tipo: 'duracao_nao_configurada' },
    {
      tipo: 'erro_configuracao_duracao',
      resultado: { tipo: 'erro_configuracao', codigo: 'duracao_conflitante', procedimento_ids: [], duracoes_conflitantes: [] },
    },
    { tipo: 'reserva_falhou', motivo: 'erro_tecnico' },
  ];
  for (const decisao of decisoes) {
    const fatos = derivarFatosAutorizados(decisao, HOJE);
    assert.equal(fatos.objetivo, 'informar_falha_tecnica');
    assert.equal(fatos.falha_tecnica, true);
  }
});

// --- remarcacao (2026-08-11, specs/remarcacao-conversacional-v1.md) ---

test('aguardando_escolha_agendamento: agendamentos_candidatos carrega data+horario formatados, nunca IDs', () => {
  const fatos = derivarFatosAutorizados({
    tipo: 'aguardando_escolha_agendamento',
    agendamentos: [agendamentoAtivo({ data: '2026-08-10', horario: '14:00' }), agendamentoAtivo({ data: '2026-08-15', horario: '09:00' })],
  }, HOJE);
  assert.equal(fatos.objetivo, 'escolher_entre_agendamentos');
  assert.deepEqual(fatos.agendamentos_candidatos, ['10/08 às 14:00', '15/08 às 09:00']);
  assertNuncaContemFraseProntaOuId(fatos);
});

test('aguardando_confirmacao_remarcacao: agendamento_atual (de onde) e proposta_pendente (para onde), os dois formatados', () => {
  const fatos = derivarFatosAutorizados({
    tipo: 'aguardando_confirmacao_remarcacao',
    agendamento_atual: agendamentoAtivo({ data: '2026-08-10', horario: '14:00' }),
    procedimento_id: 'p1',
    dentista_id: 'd1',
    opcao: opcao({ data: '2026-08-20', inicio_min: 540 }),
  }, HOJE);
  assert.equal(fatos.objetivo, 'pedir_confirmacao_remarcacao');
  assert.deepEqual(fatos.agendamento_atual, { data: '10/08', horario: '14:00' });
  assert.deepEqual(fatos.proposta_pendente, { data: '20/08', horario: '09:00' });
  assertNuncaContemFraseProntaOuId(fatos);
});

test('remarcacao_criada: agendamento_confirmado (mesmo campo de reserva_criada), sem IDs', () => {
  const fatos = derivarFatosAutorizados({
    tipo: 'remarcacao_criada',
    agendamento_id: 'ag2',
    agendamento_id_antigo: 'ag1',
    dentista_id: 'd1',
    procedimento_id: 'p1',
    duracao_min: 40,
    data: '2026-08-20',
    horario: '09:00',
  }, HOJE);
  assert.equal(fatos.objetivo, 'informar_remarcacao_criada');
  assert.deepEqual(fatos.agendamento_confirmado, { data: '20/08', horario: '09:00' });
  assertNuncaContemFraseProntaOuId(fatos);
});

test('determinismo: mesma decisao produz sempre os mesmos fatos', () => {
  const decisao: DecisaoOrquestrador = {
    tipo: 'horarios_disponiveis',
      dentista_nome_exibido: 'Dra. Ana',
    procedimento_id: 'p1',
    dentista_id: 'd1',
    duracao_min: 40,
    resultado: { tipo: 'opcoes', opcoes: [opcao()] },
  };
  const resultados = Array.from({ length: 5 }, () => JSON.stringify(derivarFatosAutorizados(decisao, HOJE)));
  assert.equal(new Set(resultados).size, 1);
});

// ── RELACAO DA DATA COM HOJE ─────────────────────────────────────────────────
//
// Defeito real, 2026-08-14 as 13:52 (producao). O Core decidiu `2026-08-14
// 15:00` -- HOJE -- e gravou `proposta_pendente: { data: '2026-08-14',
// horario: '15:00' }`. A redatora recebia so `"14/08"`, sem saber que dia era
// hoje, e escreveu: "o proximo horario disponivel com o Dr. Pablo e amanha,
// 14/08, as 15h" -- uma frase que se contradiz sozinha.
//
// A causa nao era a decisao: era a redatora DEDUZINDO uma relacao que ninguem
// lhe deu. Agora quem calcula e o Core, deterministicamente.

test('relacaoComHoje: hoje, amanha, posterior, anterior', () => {
  assert.equal(relacaoComHoje('2026-08-14', '2026-08-14'), 'hoje');
  assert.equal(relacaoComHoje('2026-08-15', '2026-08-14'), 'amanha');
  assert.equal(relacaoComHoje('2026-08-16', '2026-08-14'), 'outra');
  assert.equal(relacaoComHoje('2026-08-13', '2026-08-14'), 'outra');
});

test('relacaoComHoje: atravessa mes e ano sem depender do fuso do processo', () => {
  assert.equal(relacaoComHoje('2026-09-01', '2026-08-31'), 'amanha');
  assert.equal(relacaoComHoje('2027-01-01', '2026-12-31'), 'amanha');
  assert.equal(relacaoComHoje('2026-03-01', '2026-02-28'), 'amanha'); // 2026 nao e bissexto
});

test('relacaoComHoje: data malformada cai em outra -- perder o "hoje" e aceitavel, errar nao', () => {
  assert.equal(relacaoComHoje('', '2026-08-14'), 'outra');
  assert.equal(relacaoComHoje('14/08/2026', '2026-08-14'), 'outra');
  assert.equal(relacaoComHoje('2026-08-14', 'ontem'), 'outra');
});

test('proposta pendente HOJE: a redatora recebe a relacao pronta -- o caso 13:52', () => {
  const fatos = derivarFatosAutorizados(
    { tipo: 'aguardando_confirmacao', procedimento_id: 'p1', dentista_id: 'd1', opcao: opcao({ data: '2026-08-14' }) },
    '2026-08-14'
  );

  assert.equal(fatos.proposta_pendente?.data, 'hoje, 14/08');
});

test('proposta pendente AMANHA', () => {
  const fatos = derivarFatosAutorizados(
    { tipo: 'aguardando_confirmacao', procedimento_id: 'p1', dentista_id: 'd1', opcao: opcao({ data: '2026-08-15' }) },
    '2026-08-14'
  );

  assert.equal(fatos.proposta_pendente?.data, 'amanhã, 15/08');
});

test('proposta pendente em data POSTERIOR: so a data absoluta, sem rotulo relativo', () => {
  const fatos = derivarFatosAutorizados(
    { tipo: 'aguardando_confirmacao', procedimento_id: 'p1', dentista_id: 'd1', opcao: opcao({ data: '2026-08-20' }) },
    '2026-08-14'
  );

  assert.equal(fatos.proposta_pendente?.data, '20/08');
});

test('a CONFIRMACAO leva a mesma relacao -- nao e regra so da proposta', () => {
  const confirmar = (data: string, hoje: string) =>
    derivarFatosAutorizados(
      {
        tipo: 'reserva_criada',
        agendamento_id: 'a1',
        dentista_id: 'd1',
        procedimento_id: 'p1',
        duracao_min: 40,
        data,
        horario: '15:00',
        // Nomes exibiveis do fechamento conferivel (2026-08-16).
        dentista_nome_exibido: 'Dr. Diego Ramoz',
        procedimento_nome: 'Consulta / Avaliação',
      },
      hoje
    ).agendamento_confirmado?.data;

  assert.equal(confirmar('2026-08-14', '2026-08-14'), 'hoje, 14/08');
  assert.equal(confirmar('2026-08-15', '2026-08-14'), 'amanhã, 15/08');
  assert.equal(confirmar('2026-08-20', '2026-08-14'), '20/08');
});

test('a data de referencia dos horarios oferecidos leva a mesma relacao', () => {
  const fatos = derivarFatosAutorizados(
    {
      tipo: 'horarios_disponiveis',
      dentista_nome_exibido: 'Dra. Ana',
      procedimento_id: 'p1',
      dentista_id: 'd1',
      duracao_min: 40,
      resultado: { tipo: 'opcoes', opcoes: [opcao({ data: '2026-08-14' }), opcao({ data: '2026-08-14', inicio_min: 600 })] },
    },
    '2026-08-14'
  );

  assert.equal(fatos.data_referencia, 'hoje, 14/08');
});

test('nenhuma data perde o valor absoluto: o rotulo relativo ACOMPANHA, nunca substitui', () => {
  for (const [data, hoje] of [
    ['2026-08-14', '2026-08-14'],
    ['2026-08-15', '2026-08-14'],
    ['2026-08-20', '2026-08-14'],
  ]) {
    const fatos = derivarFatosAutorizados(
      { tipo: 'aguardando_confirmacao', procedimento_id: 'p1', dentista_id: 'd1', opcao: opcao({ data }) },
      hoje
    );
    const [, mes, dia] = data.split('-');
    assert.ok(fatos.proposta_pendente?.data.includes(`${dia}/${mes}`), `${data} deve manter a data absoluta`);
  }
});

// ── DIA SEM EXPEDIENTE NAO E FALHA TECNICA ───────────────────────────────────

test('dia sem expediente: objetivo proprio e pedido de outra data -- nunca falha tecnica', () => {
  for (const motivo of ['domingo', 'profissional_nao_atende'] as const) {
    const fatos = derivarFatosAutorizados(
      {
        tipo: 'horarios_disponiveis',
      dentista_nome_exibido: 'Dra. Ana',
        procedimento_id: 'p1',
        dentista_id: 'd1',
        duracao_min: 40,
        resultado: { tipo: 'sem_expediente_no_dia', motivo },
      },
      HOJE
    );

    assert.equal(fatos.objetivo, 'informar_sem_expediente_e_pedir_outra_data');
    assert.equal(fatos.motivo_sem_expediente, motivo);
    assert.deepEqual(fatos.dados_faltantes, ['data']);
    // O que o paciente ouviu em 15/08/2026 e que nao pode voltar a acontecer.
    assert.notEqual(fatos.objetivo, 'informar_falha_tecnica');
    assert.equal(fatos.falha_tecnica, undefined);
  }
});

test('configuracao realmente invalida CONTINUA sendo falha tecnica', () => {
  const fatos = derivarFatosAutorizados(
    {
      tipo: 'horarios_disponiveis',
      dentista_nome_exibido: 'Dra. Ana',
      procedimento_id: 'p1',
      dentista_id: 'd1',
      duracao_min: 40,
      resultado: { tipo: 'configuracao_invalida', motivo: 'sem_jornada' },
    },
    HOJE
  );

  assert.equal(fatos.objetivo, 'informar_falha_tecnica');
  assert.equal(fatos.falha_tecnica, true);
});
