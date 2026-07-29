// Testes de unidade de identificacao.ts usando o dublê ClienteFalso
// (nenhum acesso a rede ou banco real — dados sinteticos apenas em memoria).
//
// O teste 7 (concorrencia) prova, no nivel do codigo, que duas chamadas
// verdadeiramente entrelaçadas (Promise.all, com yields explicitos no
// dublê) resultam em uma unica linha de estado_conversa, porque o upsert
// com ignoreDuplicates + reconsulta trata corretamente o conflito. A
// garantia de que o banco real rejeita a segunda insercao concorrente ja
// foi verificada via SQL direto em 20260729_iris_nova_identificacao_v1.sql
// (teste 8) e reconfirmada em 20260729_iris_nova_identificacao_v1_correcao.sql.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClinicaNaoEncontradaError, EntradaInvalidaError } from './erros.ts';
import { identificarConversa } from './identificacao.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA_A = 'unit-clinica-a';
const INSTANCIA_B = 'unit-clinica-b';
const TELEFONE_VALIDO = '5511999999999';

function semearClinica(tabelas: TabelasFalsas, instanciaWhatsapp: string) {
  const clinica = { id: crypto.randomUUID(), provider: PROVIDER, instancia_whatsapp: instanciaWhatsapp };
  tabelas.clinicas.push(clinica);
  return clinica;
}

function semearPaciente(tabelas: TabelasFalsas, clinicaId: string, telefoneNormalizado: string) {
  const paciente = { id: crypto.randomUUID(), clinica_id: clinicaId, telefone_normalizado: telefoneNormalizado };
  tabelas.pacientes.push(paciente);
  return paciente;
}

test('teste1: clinica existente e paciente existente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const paciente = semearPaciente(tabelas, clinica.id, TELEFONE_VALIDO);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(resultado.clinica_id, clinica.id);
  assert.equal(resultado.paciente.encontrado, true);
  assert.equal(resultado.paciente.id, paciente.id);
  assert.equal(resultado.conversa.estado, 'atendimento');
});

test('teste2: clinica existente e paciente novo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(resultado.paciente.encontrado, false);
  assert.equal(resultado.paciente.id, null);
  assert.equal(tabelas.pacientes.length, 0, 'nenhum paciente deve ser criado durante a identificacao');
});

test('teste3: clinica inexistente e rejeitada de forma controlada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () =>
      identificarConversa(cliente, {
        provider: PROVIDER,
        instancia_whatsapp: 'instancia-nunca-cadastrada',
        telefone_normalizado: TELEFONE_VALIDO,
      }),
    ClinicaNaoEncontradaError
  );
});

test('teste4: telefone fora do formato brasileiro canonico e rejeitado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, INSTANCIA_A);
  const cliente = new ClienteFalso(tabelas);

  const casosInvalidos = ['11999999999', '5511999', '551199999999999', '+55 11 99999-9999'];
  for (const telefone of casosInvalidos) {
    await assert.rejects(
      () =>
        identificarConversa(cliente, {
          provider: PROVIDER,
          instancia_whatsapp: INSTANCIA_A,
          telefone_normalizado: telefone,
        }),
      EntradaInvalidaError
    );
  }
});

test('teste5: cria o estado quando ainda nao existe', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, INSTANCIA_A);
  const cliente = new ClienteFalso(tabelas);

  assert.equal(tabelas.estado_conversa.length, 0);
  const resultado = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(tabelas.estado_conversa.length, 1);
  assert.equal(resultado.conversa.id, tabelas.estado_conversa[0].id);
  assert.deepEqual(resultado.conversa.dados, {});
});

test('teste6: reutiliza o mesmo estado em uma nova chamada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, INSTANCIA_A);
  const cliente = new ClienteFalso(tabelas);

  const entrada = { provider: PROVIDER, instancia_whatsapp: INSTANCIA_A, telefone_normalizado: TELEFONE_VALIDO };
  const primeira = await identificarConversa(cliente, entrada);
  const segunda = await identificarConversa(cliente, entrada);

  assert.equal(primeira.conversa.id, segunda.conversa.id);
  assert.equal(tabelas.estado_conversa.length, 1);
});

test('teste7: duas chamadas concorrentes nao criam dois estados', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, INSTANCIA_A);
  const cliente = new ClienteFalso(tabelas);

  const entrada = { provider: PROVIDER, instancia_whatsapp: INSTANCIA_A, telefone_normalizado: TELEFONE_VALIDO };
  const [resultadoA, resultadoB] = await Promise.all([
    identificarConversa(cliente, entrada),
    identificarConversa(cliente, entrada),
  ]);

  assert.equal(tabelas.estado_conversa.length, 1, 'deve existir somente uma linha de estado para a conversa');
  assert.equal(resultadoA.conversa.id, resultadoB.conversa.id);
});

test('teste8: mesmo telefone em clinicas diferentes permanece isolado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaA = semearClinica(tabelas, INSTANCIA_A);
  const clinicaB = semearClinica(tabelas, INSTANCIA_B);
  const cliente = new ClienteFalso(tabelas);

  const resultadoA = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });
  const resultadoB = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_B,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.notEqual(resultadoA.conversa.id, resultadoB.conversa.id);
  assert.equal(resultadoA.clinica_id, clinicaA.id);
  assert.equal(resultadoB.clinica_id, clinicaB.id);
  assert.equal(tabelas.estado_conversa.length, 2);
});

test('teste9: paciente encontrado fica vinculado ao estado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const paciente = semearPaciente(tabelas, clinica.id, TELEFONE_VALIDO);
  const cliente = new ClienteFalso(tabelas);

  await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(tabelas.estado_conversa[0].paciente_id, paciente.id);
});

test('teste10: paciente novo permanece com paciente_id nulo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, INSTANCIA_A);
  const cliente = new ClienteFalso(tabelas);

  await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(tabelas.estado_conversa[0].paciente_id, null);
});
