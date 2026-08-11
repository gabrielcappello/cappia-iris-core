import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buscarAgendamentoAtivo } from './buscar-agendamento-ativo.ts';
import { EntradaInvalidaError } from './erros.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';

const CLINICA_ID = crypto.randomUUID();
const PACIENTE_ID = crypto.randomUUID();
const DENTISTA_ID = crypto.randomUUID();

const HOJE = '2026-08-10';
// 14:00 = minuto 840.
const INSTANTE_MEIO_DIA = { data: HOJE, minuto_min: 720 }; // 12:00
const INSTANTE_TARDE = { data: HOJE, minuto_min: 900 }; // 15:00

function agendamento(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    clinica_id: CLINICA_ID,
    paciente_id: PACIENTE_ID,
    status: 'confirmado',
    data: '2026-08-15',
    horario: '09:00',
    dentista_id: DENTISTA_ID,
    dentista_nome: 'Dra. Ana',
    procedimento_id: 'cleaning',
    procedimento: 'Limpeza',
    duracao_min: 60,
    ...overrides,
  };
}

function buscar(tabelas: TabelasFalsas, instante = INSTANTE_MEIO_DIA) {
  return buscarAgendamentoAtivo(new ClienteFalso(tabelas), {
    clinica_id: CLINICA_ID,
    paciente_id: PACIENTE_ID,
    instante_atual: instante,
  });
}

test('nenhum agendamento: devolve nenhum', async () => {
  const resultado = await buscar(criarTabelasFalsasVazias());
  assert.deepEqual(resultado, { tipo: 'nenhum' });
});

test('um agendamento futuro: devolve unico, sem duracao_min no contrato', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const linha = agendamento();
  tabelas.agendamentos.push(linha);

  const resultado = await buscar(tabelas);
  assert.equal(resultado.tipo, 'unico');
  if (resultado.tipo !== 'unico') return;
  assert.deepEqual(resultado.agendamento, {
    agendamento_id: linha.id,
    data: '2026-08-15',
    horario: '09:00',
    dentista_id: DENTISTA_ID,
    dentista_nome: 'Dra. Ana',
    procedimento_id: 'cleaning',
    procedimento: 'Limpeza',
  });
  assert.ok(!('duracao_min' in resultado.agendamento));
});

test('dois agendamentos futuros: devolve multiplos, ordenados por data e minuto', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const tarde = agendamento({ data: '2026-08-20', horario: '09:00' });
  const cedo = agendamento({ data: '2026-08-15', horario: '09:00' });
  tabelas.agendamentos.push(tarde, cedo);

  const resultado = await buscar(tabelas);
  assert.equal(resultado.tipo, 'multiplos');
  if (resultado.tipo !== 'multiplos') return;
  assert.equal(resultado.agendamentos.length, 2);
  assert.equal(resultado.agendamentos[0]!.agendamento_id, cedo.id);
  assert.equal(resultado.agendamentos[1]!.agendamento_id, tarde.id);
});

// PAR A/B OBRIGATORIO (spec secao 7, teste 4). Mesma linha no banco, variando
// SO o instante_atual -- os dois lados PRECISAM diferir, senao o filtro
// temporal nao tem efeito nenhum.
test('par A/B do filtro temporal: mesma linha, 13h vs 15h, resultados diferentes', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push(agendamento({ data: HOJE, horario: '14:00' }));

  const antes = await buscar(tabelas, { data: HOJE, minuto_min: 780 }); // 13:00
  const depois = await buscar(tabelas, INSTANTE_TARDE); // 15:00

  assert.equal(antes.tipo, 'unico');
  assert.equal(depois.tipo, 'nenhum');
  assert.notDeepEqual(antes, depois);
});

test('data passada nao aparece', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push(agendamento({ data: '2026-08-01', horario: '09:00' }));

  assert.deepEqual(await buscar(tabelas), { tipo: 'nenhum' });
});

test('minuto exato do inicio: exclui (corte estritamente futuro)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push(agendamento({ data: HOJE, horario: '12:00' }));

  assert.deepEqual(await buscar(tabelas, INSTANTE_MEIO_DIA), { tipo: 'nenhum' });
});

test('agendamento em andamento nao e ativo (corte pelo inicio, nao pelo fim)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  // 11:00 + 60min terminaria 12:00; o corte usa o INICIO, entao ja saiu.
  tabelas.agendamentos.push(agendamento({ data: HOJE, horario: '11:00', duracao_min: 60 }));

  assert.deepEqual(await buscar(tabelas, INSTANTE_MEIO_DIA), { tipo: 'nenhum' });
});

test('status diferente de confirmado nunca aparece', async () => {
  for (const status of ['cancelado', 'remarcado', 'concluido', 'faltou']) {
    const tabelas = criarTabelasFalsasVazias();
    tabelas.agendamentos.push(agendamento({ status }));
    assert.deepEqual(await buscar(tabelas), { tipo: 'nenhum' }, `status ${status}`);
  }
});

test('linha sem data ou com horario malformado e descartada', async () => {
  for (const invalida of [{ data: null }, { data: '15/08/2026' }, { horario: null }, { horario: '9h' }, { horario: '25:00' }]) {
    const tabelas = criarTabelasFalsasVazias();
    tabelas.agendamentos.push(agendamento(invalida));
    assert.deepEqual(await buscar(tabelas), { tipo: 'nenhum' }, JSON.stringify(invalida));
  }
});

// REGRESSAO da decisao do Gabriel (2026-08-10, spec secao 10.2): a ausencia
// de duracao NUNCA pode produzir `nenhum` -- seria dizer a um paciente que
// tem agendamento que ele nao tem.
test('duracao_min nula nao descarta: agendamento confirmado e futuro continua ativo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push(agendamento({ duracao_min: null }));

  const resultado = await buscar(tabelas);
  assert.equal(resultado.tipo, 'unico');
});

test('dentista_id/procedimento_id nulos nao descartam: viram null no contrato', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push(agendamento({ dentista_id: null, dentista_nome: null, procedimento_id: null, procedimento: null }));

  const resultado = await buscar(tabelas);
  assert.equal(resultado.tipo, 'unico');
  if (resultado.tipo !== 'unico') return;
  assert.equal(resultado.agendamento.dentista_id, null);
  assert.equal(resultado.agendamento.procedimento_id, null);
});

// Regressao direta da comparacao lexicografica (spec secao 1): '9:00' e
// lexicograficamente MAIOR que '14:00'. Se o corte do mesmo dia fosse feito
// por texto, esta linha apareceria como futura.
test('hora de um digito ja passada e descartada (nunca comparada como texto)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push(agendamento({ data: HOJE, horario: '9:00' }));

  assert.deepEqual(await buscar(tabelas, { data: HOJE, minuto_min: 840 }), { tipo: 'nenhum' });
});

test('isolamento: agendamento de outra clinica nunca aparece', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push(agendamento({ clinica_id: crypto.randomUUID() }));

  assert.deepEqual(await buscar(tabelas), { tipo: 'nenhum' });
});

test('isolamento: agendamento de outro paciente nunca aparece', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push(agendamento({ paciente_id: crypto.randomUUID() }));

  assert.deepEqual(await buscar(tabelas), { tipo: 'nenhum' });
});

test('entrada invalida rejeita antes de qualquer leitura', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () =>
      buscarAgendamentoAtivo(cliente, {
        clinica_id: 'nao-e-uuid',
        paciente_id: PACIENTE_ID,
        instante_atual: INSTANTE_MEIO_DIA,
      }),
    EntradaInvalidaError
  );
  await assert.rejects(
    () =>
      buscarAgendamentoAtivo(cliente, {
        clinica_id: CLINICA_ID,
        paciente_id: PACIENTE_ID,
        instante_atual: { data: '10/08/2026', minuto_min: 720 },
      }),
    EntradaInvalidaError
  );
  assert.equal(cliente.estatisticas.chamadasSelect.agendamentos ?? 0, 0);
});
