import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buscarJornadaAbertaPosConsulta } from './pos-consulta-buscar-jornada-aberta.ts';
import { ClientePosConsultaFalso } from './teste-cliente-pos-consulta-falso.ts';

const CLINICA_1 = '11111111-1111-1111-1111-111111111111';
const CLINICA_2 = '22222222-2222-2222-2222-222222222222';
const JORNADA_1 = '33333333-3333-3333-3333-333333333333';
const AGENDAMENTO_1 = '44444444-4444-4444-4444-444444444444';
const PACIENTE_1 = '55555555-5555-5555-5555-555555555555';

function linhaJornada(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: JORNADA_1,
    clinica_id: CLINICA_1,
    agendamento_id: AGENDAMENTO_1,
    paciente_id: PACIENTE_1,
    telefone_normalizado: '5511999999999',
    modo: 'ambos',
    etapa: 'aguardando_satisfacao',
    ...overrides,
  };
}

test('nenhuma jornada aberta devolve tipo nenhuma', async () => {
  const cliente = new ClientePosConsultaFalso([]);
  const resultado = await buscarJornadaAbertaPosConsulta(cliente, {
    clinica_id: CLINICA_1,
    telefone_normalizado: '5511999999999',
  });
  assert.deepEqual(resultado, { tipo: 'nenhuma' });
});

test('jornada aberta na mesma clinica/telefone e encontrada', async () => {
  const cliente = new ClientePosConsultaFalso([linhaJornada()]);
  const resultado = await buscarJornadaAbertaPosConsulta(cliente, {
    clinica_id: CLINICA_1,
    telefone_normalizado: '5511999999999',
  });
  assert.deepEqual(resultado, {
    tipo: 'encontrada',
    jornada: { jornada_id: JORNADA_1, agendamento_id: AGENDAMENTO_1, paciente_id: PACIENTE_1, modo: 'ambos', etapa: 'aguardando_satisfacao' },
  });
});

test('jornada encerrada nunca e encontrada como aberta (filtro por etapa no proprio SELECT)', async () => {
  const cliente = new ClientePosConsultaFalso([linhaJornada({ etapa: 'encerrada' })]);
  const resultado = await buscarJornadaAbertaPosConsulta(cliente, {
    clinica_id: CLINICA_1,
    telefone_normalizado: '5511999999999',
  });
  assert.deepEqual(resultado, { tipo: 'nenhuma' });
});

test('criterio 9 -- jornada de outra clinica com o mesmo telefone nunca e encontrada', async () => {
  const cliente = new ClientePosConsultaFalso([linhaJornada({ clinica_id: CLINICA_2 })]);
  const resultado = await buscarJornadaAbertaPosConsulta(cliente, {
    clinica_id: CLINICA_1,
    telefone_normalizado: '5511999999999',
  });
  assert.deepEqual(resultado, { tipo: 'nenhuma' });
});

test('telefone diferente na mesma clinica nunca e encontrado', async () => {
  const cliente = new ClientePosConsultaFalso([linhaJornada()]);
  const resultado = await buscarJornadaAbertaPosConsulta(cliente, {
    clinica_id: CLINICA_1,
    telefone_normalizado: '5511888888888',
  });
  assert.deepEqual(resultado, { tipo: 'nenhuma' });
});

// B4 -- defesa em profundidade: mesmo que o indice unico parcial da
// migration nao esteja vigente (banco desatualizado, bug), esta funcao
// NUNCA escolhe silenciosamente a primeira linha entre duas jornadas
// abertas para o mesmo telefone -- falha fechado.
test('B4 -- mais de uma jornada aberta para o mesmo telefone falha fechado, nunca escolhe a primeira', async () => {
  const outroAgendamento = '66666666-6666-6666-6666-666666666666';
  const cliente = new ClientePosConsultaFalso([
    linhaJornada(),
    linhaJornada({ id: '77777777-7777-7777-7777-777777777777', agendamento_id: outroAgendamento }),
  ]);
  await assert.rejects(() =>
    buscarJornadaAbertaPosConsulta(cliente, { clinica_id: CLINICA_1, telefone_normalizado: '5511999999999' })
  );
});

// Par A/B -- so a clinica muda; os desfechos tem que DIFERIR mesmo com o
// MESMO telefone (docs/00-principios.md, teste isolado + criterio 9).
test('par A/B -- mesmo telefone, so a clinica muda entre encontrada e nenhuma', async () => {
  const cliente = new ClientePosConsultaFalso([linhaJornada()]);
  const a = await buscarJornadaAbertaPosConsulta(cliente, { clinica_id: CLINICA_1, telefone_normalizado: '5511999999999' });
  const b = await buscarJornadaAbertaPosConsulta(cliente, { clinica_id: CLINICA_2, telefone_normalizado: '5511999999999' });
  assert.notDeepEqual(a, b);
  assert.equal(a.tipo, 'encontrada');
  assert.equal(b.tipo, 'nenhuma');
});

// ── Proposta C (2026-09-16) -- link_avaliacao_google exposto quando presente ──
test('link_avaliacao_google: exposto quando presente na linha, ausente quando null', async () => {
  const clienteComLink = new ClientePosConsultaFalso([linhaJornada({ link_avaliacao_google: 'https://g.page/r/exemplo/review' })]);
  const comLink = await buscarJornadaAbertaPosConsulta(clienteComLink, { clinica_id: CLINICA_1, telefone_normalizado: '5511999999999' });
  assert.equal(comLink.tipo, 'encontrada');
  if (comLink.tipo === 'encontrada') assert.equal(comLink.jornada.link_avaliacao_google, 'https://g.page/r/exemplo/review');

  const clienteSemLink = new ClientePosConsultaFalso([linhaJornada({ link_avaliacao_google: null })]);
  const semLink = await buscarJornadaAbertaPosConsulta(clienteSemLink, { clinica_id: CLINICA_1, telefone_normalizado: '5511999999999' });
  assert.equal(semLink.tipo, 'encontrada');
  if (semLink.tipo === 'encontrada') assert.equal(semLink.jornada.link_avaliacao_google, undefined);
});
