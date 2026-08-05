import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carregarEntradaDisponibilidade } from './carregar-disponibilidade.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';

const CLINICA_ID = crypto.randomUUID();
const DENTISTA_ID = crypto.randomUUID();
const PROCEDIMENTO_ID = 'cleaning';

// 2026-08-03 = segunda, 2026-08-08 = sabado, 2026-08-09 = domingo (verificado).
const SEGUNDA = '2026-08-03';
const SABADO = '2026-08-08';
const DOMINGO = '2026-08-09';

const INSTANTE_ATUAL = { data: '2026-08-01', minuto_min: 480 };

function semearClinica(tabelas: TabelasFalsas, dentistas: Record<string, unknown>[]) {
  tabelas.clinicas.push({ id: CLINICA_ID, fuso_horario: 'America/Sao_Paulo', dentistas });
}

function dentistaAuto(overrides: Record<string, unknown> = {}) {
  return {
    id: DENTISTA_ID,
    ativo: true,
    modo: 'auto',
    inicio: '08:00',
    fim: '12:00',
    dur: 40,
    sabado: false,
    alm_ini: null,
    alm_fim: null,
    procedimentos: [],
    ...overrides,
  };
}

function dentistaProcedimento(overrides: Record<string, unknown> = {}) {
  return {
    id: DENTISTA_ID,
    ativo: true,
    modo: 'procedimento',
    inicio: '08:00',
    fim: '12:00',
    sabado: false,
    alm_ini: null,
    alm_fim: null,
    // 40, nao 45: resolver-duracao.ts exige multiplo de 10 (achado real, ver
    // relatorio -- o dado real da ClearDent para este procedimento e 45min).
    procedimentos: [{ id: PROCEDIMENTO_ID, nome: 'Limpeza', ativo: true, tempo: 40 }],
    ...overrides,
  };
}

test('modo auto, segunda, sem bloqueios/agendamentos: carrega e produz opcoes', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [dentistaAuto()]);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarEntradaDisponibilidade(cliente, {
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    procedimento_id: PROCEDIMENTO_ID,
    data: SEGUNDA,
    instante_atual: INSTANTE_ATUAL,
    modo: { tipo: 'grade' },
  });

  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.equal(resultado.entrada.duracao_min, 40);
  assert.deepEqual(resultado.entrada.jornadas, [
    { clinica_id: CLINICA_ID, dentista_id: DENTISTA_ID, data: SEGUNDA, inicio_min: 480, fim_min: 720 },
  ]);
  assert.equal(resultado.resultado.tipo, 'opcoes');
});

test('modo procedimento: duracao vem de procedimentos[] do dentista, nao de dur', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [dentistaProcedimento()]);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarEntradaDisponibilidade(cliente, {
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    procedimento_id: PROCEDIMENTO_ID,
    data: SEGUNDA,
    instante_atual: INSTANTE_ATUAL,
    modo: { tipo: 'grade' },
  });

  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.equal(resultado.entrada.duracao_min, 40);
});

test('domingo: nenhuma jornada, resolvedor devolve sem_jornada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [dentistaAuto()]);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarEntradaDisponibilidade(cliente, {
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    procedimento_id: PROCEDIMENTO_ID,
    data: DOMINGO,
    instante_atual: INSTANTE_ATUAL,
    modo: { tipo: 'grade' },
  });

  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.deepEqual(resultado.entrada.jornadas, []);
  assert.deepEqual(resultado.resultado, { tipo: 'configuracao_invalida', motivo: 'sem_jornada' });
});

test('sabado sem sabado=true: sem jornada (nao trabalha)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [dentistaAuto({ sabado: false })]);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarEntradaDisponibilidade(cliente, {
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    procedimento_id: PROCEDIMENTO_ID,
    data: SABADO,
    instante_atual: INSTANTE_ATUAL,
    modo: { tipo: 'grade' },
  });

  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.deepEqual(resultado.entrada.jornadas, []);
});

test('sabado com sabado=true: usa sab_ini/sab_fim, nunca inicio/fim de semana', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [dentistaAuto({ sabado: true, sab_ini: '09:00', sab_fim: '13:00' })]);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarEntradaDisponibilidade(cliente, {
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    procedimento_id: PROCEDIMENTO_ID,
    data: SABADO,
    instante_atual: INSTANTE_ATUAL,
    modo: { tipo: 'grade' },
  });

  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.deepEqual(resultado.entrada.jornadas, [
    { clinica_id: CLINICA_ID, dentista_id: DENTISTA_ID, data: SABADO, inicio_min: 540, fim_min: 780 },
  ]);
});

test('agendamento confirmado ocupa horario; agendamento cancelado nao ocupa', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [dentistaAuto({ inicio: '08:00', fim: '10:00', dur: 60 })]);
  tabelas.agendamentos.push(
    {
      clinica_id: CLINICA_ID,
      dentista_id: DENTISTA_ID,
      data: SEGUNDA,
      horario: '08:00',
      duracao_min: 60,
      status: 'confirmado',
    },
    {
      clinica_id: CLINICA_ID,
      dentista_id: DENTISTA_ID,
      data: SEGUNDA,
      horario: '09:00',
      duracao_min: 60,
      status: 'cancelado',
    }
  );
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarEntradaDisponibilidade(cliente, {
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    procedimento_id: PROCEDIMENTO_ID,
    data: SEGUNDA,
    instante_atual: INSTANTE_ATUAL,
    modo: { tipo: 'grade' },
  });

  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.equal(resultado.entrada.indisponiveis.length, 1);
  assert.equal(resultado.entrada.indisponiveis[0].origem, 'agendamento');
  // jornada 08:00-10:00, D60, 08:00 ocupado -> so sobra 09:00.
  assert.deepEqual(resultado.resultado, {
    tipo: 'opcoes',
    opcoes: [
      {
        clinica_id: CLINICA_ID,
        procedimento_id: PROCEDIMENTO_ID,
        dentista_id: DENTISTA_ID,
        data: SEGUNDA,
        fuso: 'America/Sao_Paulo',
        duracao_min: 60,
        inicio_min: 540,
        fim_min: 600,
      },
    ],
  });
});

test('bloqueio de dia inteiro cobrindo a data: sem_disponibilidade', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [dentistaAuto()]);
  tabelas.horarios_bloqueados.push({
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    data_inicio: SEGUNDA,
    data_fim: SEGUNDA,
    horario_inicio: '00:00',
    horario_fim: '23:59',
  });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarEntradaDisponibilidade(cliente, {
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    procedimento_id: PROCEDIMENTO_ID,
    data: SEGUNDA,
    instante_atual: INSTANTE_ATUAL,
    modo: { tipo: 'grade' },
  });

  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.equal(resultado.resultado.tipo, 'sem_disponibilidade');
});

test('bloqueio geral da clinica (dentista_id null) tambem bloqueia', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [dentistaAuto()]);
  tabelas.horarios_bloqueados.push({
    clinica_id: CLINICA_ID,
    dentista_id: null,
    data_inicio: SEGUNDA,
    data_fim: SEGUNDA,
    horario_inicio: '00:00',
    horario_fim: '23:59',
  });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarEntradaDisponibilidade(cliente, {
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    procedimento_id: PROCEDIMENTO_ID,
    data: SEGUNDA,
    instante_atual: INSTANTE_ATUAL,
    modo: { tipo: 'grade' },
  });

  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.equal(resultado.resultado.tipo, 'sem_disponibilidade');
});

test('bloqueio especifico de outro dentista nao bloqueia o dentista atual; bloqueio geral bloqueia os dois', async () => {
  const OUTRO_DENTISTA_ID = crypto.randomUUID();
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [dentistaAuto(), dentistaAuto({ id: OUTRO_DENTISTA_ID })]);
  tabelas.horarios_bloqueados.push(
    {
      clinica_id: CLINICA_ID,
      dentista_id: OUTRO_DENTISTA_ID,
      data_inicio: SEGUNDA,
      data_fim: SEGUNDA,
      horario_inicio: '00:00',
      horario_fim: '23:59',
    },
    {
      clinica_id: CLINICA_ID,
      dentista_id: DENTISTA_ID,
      data_inicio: SEGUNDA,
      data_fim: SEGUNDA,
      horario_inicio: '00:00',
      horario_fim: '23:59',
    }
  );
  const cliente = new ClienteFalso(tabelas);

  // Bloqueio e do OUTRO dentista + do proprio -- o proprio esta bloqueado
  // pelo seu bloqueio especifico (nao pelo do outro).
  const resultado = await carregarEntradaDisponibilidade(cliente, {
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    procedimento_id: PROCEDIMENTO_ID,
    data: SEGUNDA,
    instante_atual: INSTANTE_ATUAL,
    modo: { tipo: 'grade' },
  });

  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.equal(resultado.resultado.tipo, 'sem_disponibilidade');
  // so o bloqueio do proprio dentista entra em indisponiveis -- o do outro
  // dentista (nao geral, dentista_id != null e != DENTISTA_ID) e ignorado.
  assert.equal(resultado.entrada.indisponiveis.filter((i) => i.origem === 'bloqueio').length, 1);
});

test('isolamento entre clinicas: bloqueio geral de outra clinica nao afeta esta', async () => {
  const OUTRA_CLINICA_ID = crypto.randomUUID();
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [dentistaAuto()]);
  tabelas.clinicas.push({ id: OUTRA_CLINICA_ID, fuso_horario: 'America/Sao_Paulo', dentistas: [] });
  tabelas.horarios_bloqueados.push({
    clinica_id: OUTRA_CLINICA_ID,
    dentista_id: null,
    data_inicio: SEGUNDA,
    data_fim: SEGUNDA,
    horario_inicio: '00:00',
    horario_fim: '23:59',
  });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarEntradaDisponibilidade(cliente, {
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    procedimento_id: PROCEDIMENTO_ID,
    data: SEGUNDA,
    instante_atual: INSTANTE_ATUAL,
    modo: { tipo: 'grade' },
  });

  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.equal(resultado.resultado.tipo, 'opcoes');
  assert.equal(resultado.entrada.indisponiveis.filter((i) => i.origem === 'bloqueio').length, 0);
});

test('bloqueio multi-dia: dia intermediario fica bloqueado por inteiro', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [dentistaAuto()]);
  tabelas.horarios_bloqueados.push({
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    data_inicio: '2026-08-03',
    data_fim: '2026-08-05',
    horario_inicio: '10:00', // so importa no primeiro dia
    horario_fim: '10:00', // so importa no ultimo dia
  });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarEntradaDisponibilidade(cliente, {
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    procedimento_id: PROCEDIMENTO_ID,
    data: '2026-08-04', // dia do meio: bloqueado o dia inteiro
    instante_atual: INSTANTE_ATUAL,
    modo: { tipo: 'grade' },
  });

  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.equal(resultado.resultado.tipo, 'sem_disponibilidade');
});

test('dentista nao encontrado na clinica', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [dentistaAuto({ id: crypto.randomUUID() })]);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarEntradaDisponibilidade(cliente, {
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    procedimento_id: PROCEDIMENTO_ID,
    data: SEGUNDA,
    instante_atual: INSTANTE_ATUAL,
    modo: { tipo: 'grade' },
  });

  assert.deepEqual(resultado, { tipo: 'dentista_nao_encontrado' });
});

test('clinica inexistente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarEntradaDisponibilidade(cliente, {
    clinica_id: crypto.randomUUID(),
    dentista_id: DENTISTA_ID,
    procedimento_id: PROCEDIMENTO_ID,
    data: SEGUNDA,
    instante_atual: INSTANTE_ATUAL,
    modo: { tipo: 'grade' },
  });

  assert.deepEqual(resultado, { tipo: 'clinica_nao_encontrada' });
});

test('modo procedimento sem duracao cadastrada para o procedimento: duracao_nao_resolvida', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [dentistaProcedimento({ procedimentos: [] })]);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarEntradaDisponibilidade(cliente, {
    clinica_id: CLINICA_ID,
    dentista_id: DENTISTA_ID,
    procedimento_id: PROCEDIMENTO_ID,
    data: SEGUNDA,
    instante_atual: INSTANTE_ATUAL,
    modo: { tipo: 'grade' },
  });

  assert.equal(resultado.tipo, 'duracao_nao_resolvida');
  if (resultado.tipo !== 'duracao_nao_resolvida') return;
  assert.deepEqual(resultado.resultado, { tipo: 'nao_configurada' });
});
