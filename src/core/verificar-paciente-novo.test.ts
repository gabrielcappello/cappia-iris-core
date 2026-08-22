import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verificarPacienteNovo } from './verificar-paciente-novo.ts';
import { EntradaInvalidaError } from './erros.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';

const CLINICA_ID = crypto.randomUUID();
const OUTRA_CLINICA_ID = crypto.randomUUID();
const PACIENTE_ID = crypto.randomUUID();

function agendamento(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    clinica_id: CLINICA_ID,
    paciente_id: PACIENTE_ID,
    status: 'confirmado',
    data: '2026-08-15',
    horario: '09:00',
    ...overrides,
  };
}

function verificar(tabelas: TabelasFalsas, pacienteId = PACIENTE_ID, clinicaId = CLINICA_ID) {
  return verificarPacienteNovo(new ClienteFalso(tabelas), {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
  });
}

test('nenhum agendamento algum: paciente novo', async () => {
  const resultado = await verificar(criarTabelasFalsasVazias());
  assert.equal(resultado, true);
});

test('agendamento confirmado, nenhum concluido: ainda paciente novo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push(agendamento({ status: 'confirmado' }));
  const resultado = await verificar(tabelas);
  assert.equal(resultado, true);
});

test('agendamento concluido nesta clinica: nao e mais paciente novo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push(agendamento({ status: 'concluido' }));
  const resultado = await verificar(tabelas);
  assert.equal(resultado, false);
});

test('isolamento multiclinica: concluido em OUTRA clinica nao conta', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push(agendamento({ status: 'concluido', clinica_id: OUTRA_CLINICA_ID }));
  const resultado = await verificar(tabelas);
  assert.equal(resultado, true);
});

test('paciente com concluido cancelado depois (linha nova) continua concluido em outra linha: nao e novo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push(
    agendamento({ status: 'cancelado' }),
    agendamento({ status: 'concluido' })
  );
  const resultado = await verificar(tabelas);
  assert.equal(resultado, false);
});

test('clinica_id ausente: EntradaInvalidaError', async () => {
  await assert.rejects(
    () =>
      verificarPacienteNovo(new ClienteFalso(criarTabelasFalsasVazias()), {
        paciente_id: PACIENTE_ID,
      } as never),
    EntradaInvalidaError
  );
});

test('paciente_id malformado: EntradaInvalidaError', async () => {
  await assert.rejects(
    () =>
      verificarPacienteNovo(new ClienteFalso(criarTabelasFalsasVazias()), {
        clinica_id: CLINICA_ID,
        paciente_id: 'nao-e-uuid',
      }),
    EntradaInvalidaError
  );
});
