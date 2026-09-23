import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolverClinicaPorInstancia } from './pos-consulta-resolver-clinica.ts';
import { ClienteFalso, criarTabelasFalsasVazias } from './teste-cliente-falso.ts';
import { ClinicaNaoEncontradaError, EntradaInvalidaError } from './erros.ts';

test('resolve clinica_id a partir de provider+instancia_whatsapp', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.clinicas.push({ id: 'clinica-1', provider: 'evolution', instancia_whatsapp: 'CAPPIA-TESTE' });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await resolverClinicaPorInstancia(cliente, { provider: 'evolution', instancia_whatsapp: 'CAPPIA-TESTE' });
  assert.deepEqual(resultado, { clinica_id: 'clinica-1' });
});

test('instancia desconhecida lanca ClinicaNaoEncontradaError, nunca inventa clinica_id', async () => {
  const cliente = new ClienteFalso(criarTabelasFalsasVazias());
  await assert.rejects(
    () => resolverClinicaPorInstancia(cliente, { provider: 'evolution', instancia_whatsapp: 'desconhecida' }),
    ClinicaNaoEncontradaError
  );
});

test('provider vazio nunca chega a consultar o banco', async () => {
  const cliente = new ClienteFalso(criarTabelasFalsasVazias());
  await assert.rejects(
    () => resolverClinicaPorInstancia(cliente, { provider: '', instancia_whatsapp: 'x' }),
    EntradaInvalidaError
  );
  assert.equal(cliente.estatisticas.chamadasSelect.clinicas ?? 0, 0);
});
