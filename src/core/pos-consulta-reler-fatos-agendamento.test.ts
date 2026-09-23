import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relerFatosAgendamentoPosConsulta } from './pos-consulta-reler-fatos-agendamento.ts';
import { ClienteFalso, criarTabelasFalsasVazias } from './teste-cliente-falso.ts';
import { EntradaInvalidaError } from './erros.ts';

const CLINICA = '11111111-1111-1111-1111-111111111111';
const AGENDAMENTO = '22222222-2222-2222-2222-222222222222';
const PACIENTE = '33333333-3333-3333-3333-333333333333';

test('rele os fatos ATUAIS do banco, nunca confia em valores do chamador', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push({
    id: AGENDAMENTO,
    clinica_id: CLINICA,
    paciente_id: PACIENTE,
    status: 'concluido',
    concluido_em: '2026-09-01T12:00:00.000Z',
  });
  tabelas.pacientes.push({ id: PACIENTE, clinica_id: CLINICA, telefone_normalizado: '5511999999999' });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await relerFatosAgendamentoPosConsulta(cliente, { clinica_id: CLINICA, agendamento_id: AGENDAMENTO });
  assert.deepEqual(resultado, {
    status: 'concluido',
    concluidoEm: '2026-09-01T12:00:00.000Z',
    pacienteId: PACIENTE,
    telefoneNormalizado: '5511999999999',
  });
});

test('agendamento inexistente devolve null, nunca inventa fatos', async () => {
  const cliente = new ClienteFalso(criarTabelasFalsasVazias());
  const resultado = await relerFatosAgendamentoPosConsulta(cliente, { clinica_id: CLINICA, agendamento_id: AGENDAMENTO });
  assert.equal(resultado, null);
});

test('agendamento de OUTRA clinica nunca e encontrado (isolamento multiclinica)', async () => {
  const outraClinica = '44444444-4444-4444-4444-444444444444';
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push({
    id: AGENDAMENTO,
    clinica_id: outraClinica,
    paciente_id: PACIENTE,
    status: 'concluido',
    concluido_em: '2026-09-01T12:00:00.000Z',
  });
  const cliente = new ClienteFalso(tabelas);
  const resultado = await relerFatosAgendamentoPosConsulta(cliente, { clinica_id: CLINICA, agendamento_id: AGENDAMENTO });
  assert.equal(resultado, null);
});

test('paciente sem cadastro (removido/inexistente): telefoneNormalizado null, nunca inventado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push({
    id: AGENDAMENTO,
    clinica_id: CLINICA,
    paciente_id: PACIENTE,
    status: 'concluido',
    concluido_em: '2026-09-01T12:00:00.000Z',
  });
  const cliente = new ClienteFalso(tabelas);
  const resultado = await relerFatosAgendamentoPosConsulta(cliente, { clinica_id: CLINICA, agendamento_id: AGENDAMENTO });
  assert.equal(resultado?.telefoneNormalizado, null);
});

test('agendamento_id malformado nunca chega a consultar o banco', async () => {
  const cliente = new ClienteFalso(criarTabelasFalsasVazias());
  await assert.rejects(
    () => relerFatosAgendamentoPosConsulta(cliente, { clinica_id: CLINICA, agendamento_id: 'nao-e-uuid' }),
    EntradaInvalidaError
  );
});
