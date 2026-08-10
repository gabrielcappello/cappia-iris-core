// Adaptador de cappia_trocar_telefone_paciente -- specs/cpf-outro-telefone-v1.md
// secao 5. Mesma disciplina de persistir-paciente.test.ts: prova o contrato do
// adaptador (traducao, validacao estrita, vocabulario fechado, PII), nunca o
// comportamento do Postgres -- esse tem prova propria, contra os dois bancos
// reais.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trocarTelefonePaciente } from './trocar-telefone-paciente.ts';
import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';

const CLINICA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PACIENTE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CPF = '52998224725';
const TELEFONE = '5511999999999';

const ENTRADA_VALIDA = { clinica_id: CLINICA, cpf: CPF, telefone_normalizado: TELEFONE };

function cliente(data: unknown, error: { message: string } | null = null): ClienteRpcFalso {
  return new ClienteRpcFalso({ cappia_trocar_telefone_paciente: { data, error } });
}

test('sucesso: devolve o paciente_id e traduz cpf -> p_cpf', async () => {
  const rpc = cliente({ sucesso: true, paciente_id: PACIENTE });

  const resultado = await trocarTelefonePaciente(rpc, ENTRADA_VALIDA);

  assert.deepEqual(resultado, { tipo: 'trocado', paciente_id: PACIENTE });
  // Exatamente tres parametros, nenhum a mais: nenhum paciente_id vindo do
  // Core, nenhuma pista da outra ficha.
  assert.deepEqual(rpc.chamadas[0].parametros, {
    p_clinica_id: CLINICA,
    p_cpf: CPF,
    p_telefone_normalizado: TELEFONE,
  });
  assert.equal(rpc.chamadas.length, 1, 'uma unica chamada, sem retry');
});

test('as duas recusas conversacionais viram tipo proprio', async () => {
  for (const motivo of ['telefone_de_outro_paciente', 'cpf_nao_encontrado'] as const) {
    const resultado = await trocarTelefonePaciente(cliente({ sucesso: false, motivo }), ENTRADA_VALIDA);
    assert.deepEqual(resultado, { tipo: motivo });
  }
});

test('motivo fora do vocabulario FALHA FECHADO, nunca vira uma das recusas conhecidas', async () => {
  // Um motivo novo na RPC sem o adaptador saber dele nao pode ser reinterpretado
  // como "telefone de outro paciente" -- isso mandaria o paciente a recepcao por
  // um motivo que nao aconteceu.
  await assert.rejects(
    () => trocarTelefonePaciente(cliente({ sucesso: false, motivo: 'motivo_inventado' }), ENTRADA_VALIDA),
    ErroRpcTecnico
  );
  await assert.rejects(
    () => trocarTelefonePaciente(cliente({ sucesso: false }), ENTRADA_VALIDA),
    ErroRpcTecnico
  );
});

test('saida malformada FALHA FECHADO', async () => {
  for (const data of [null, [], 'ok', { paciente_id: PACIENTE }, { sucesso: 'sim' }]) {
    await assert.rejects(() => trocarTelefonePaciente(cliente(data), ENTRADA_VALIDA), ErroRpcTecnico);
  }
  // sucesso=true sem UUID valido tambem e falha tecnica, nunca um id aceito.
  await assert.rejects(
    () => trocarTelefonePaciente(cliente({ sucesso: true, paciente_id: 'nao-e-uuid' }), ENTRADA_VALIDA),
    ErroRpcTecnico
  );
});

test('erro do cliente nunca vaza a mensagem original', async () => {
  const rpc = cliente(null, { message: 'duplicate key value violates unique constraint on 5511988887777' });

  await assert.rejects(
    () => trocarTelefonePaciente(rpc, ENTRADA_VALIDA),
    (erro: unknown) => {
      assert.ok(erro instanceof ErroRpcTecnico);
      // A mensagem do Postgres pode conter telefone, CPF ou o proprio SQL.
      assert.ok(!String((erro as Error).message).includes('5511988887777'));
      return true;
    }
  );
});

test('entrada invalida e rejeitada ANTES de qualquer chamada', async () => {
  const invalidas = [
    { ...ENTRADA_VALIDA, clinica_id: 'nao-e-uuid' },
    { ...ENTRADA_VALIDA, cpf: '   ' },
    { ...ENTRADA_VALIDA, telefone_normalizado: '' },
  ];

  for (const entrada of invalidas) {
    const rpc = cliente({ sucesso: true, paciente_id: PACIENTE });
    await assert.rejects(() => trocarTelefonePaciente(rpc, entrada), EntradaInvalidaError);
    assert.equal(rpc.chamadas.length, 0, 'nenhuma chamada pode sair com entrada invalida');
  }
});
