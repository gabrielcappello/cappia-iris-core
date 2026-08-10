// Testes do adaptador de public.cappia_persistir_paciente.
//
// Contrato da RPC: src/supabase/migrations/20260809120000_iris_nova_persistencia_paciente_v1.sql
// (aplicada nos dois projetos em 2026-08-09).
//
// Nenhum acesso a rede ou banco real -- o dublê ClienteRpcFalso registra os
// parametros enviados, o que e o unico jeito de PROVAR a traducao
// `cpf -> p_documento`. Todos os valores sao SINTETICOS.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EntradaInvalidaError, ErroRpcTecnico } from './erros.ts';
import { persistirPaciente } from './persistir-paciente.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';

const NOME_RPC = 'cappia_persistir_paciente';
const PACIENTE_ID = crypto.randomUUID();

const ENTRADA = {
  clinica_id: crypto.randomUUID(),
  telefone_normalizado: '5511999999999',
  nome: 'Teodolinda Sampaio Vilhena',
  cpf: '52998224725',
  data_nascimento: '1974-03-19',
  email: 'teodolinda.vilhena@exemplo-sintetico.test',
};

function clienteComSucesso(): ClienteRpcFalso {
  return new ClienteRpcFalso({ [NOME_RPC]: { data: { sucesso: true, paciente_id: PACIENTE_ID }, error: null } });
}

test('sucesso: retorno escalar traduzido para persistido + paciente_id', async () => {
  const resultado = await persistirPaciente(clienteComSucesso(), ENTRADA);

  assert.equal(resultado.tipo, 'persistido');
  if (resultado.tipo === 'persistido') assert.equal(resultado.paciente_id, PACIENTE_ID);
});

test('traducao: `cpf` do dominio vira `p_documento` na RPC, e `p_cpf` nunca e enviado', async () => {
  const cliente = clienteComSucesso();
  await persistirPaciente(cliente, ENTRADA);

  assert.equal(cliente.chamadas.length, 1, 'uma unica chamada, sem retry');
  const { nome, parametros } = cliente.chamadas[0];
  assert.equal(nome, NOME_RPC);

  // A UNICA traducao do contrato: conceito `cpf` -> coluna fisica `documento`.
  assert.equal(parametros.p_documento, ENTRADA.cpf);
  assert.ok(!Object.prototype.hasOwnProperty.call(parametros, 'p_cpf'), 'nao existe parametro p_cpf na RPC');

  // Os demais seguem sem traducao nenhuma.
  assert.equal(parametros.p_clinica_id, ENTRADA.clinica_id);
  assert.equal(parametros.p_telefone_normalizado, ENTRADA.telefone_normalizado);
  assert.equal(parametros.p_nome, ENTRADA.nome);
  assert.equal(parametros.p_data_nascimento, ENTRADA.data_nascimento);
  assert.equal(parametros.p_email, ENTRADA.email);
});

test('opcional ausente e OMITIDO do payload, nunca enviado como null', async () => {
  const cliente = clienteComSucesso();
  await persistirPaciente(cliente, {
    clinica_id: ENTRADA.clinica_id,
    telefone_normalizado: ENTRADA.telefone_normalizado,
    nome: ENTRADA.nome,
  });

  const { parametros } = cliente.chamadas[0];
  for (const chave of ['p_documento', 'p_data_nascimento', 'p_email']) {
    assert.ok(!Object.prototype.hasOwnProperty.call(parametros, chave), `${chave} deveria estar ausente`);
  }
  // Os obrigatorios continuam la.
  assert.equal(parametros.p_nome, ENTRADA.nome);
});

test('cpf_ja_cadastrado tem tipo proprio -- nunca cai em `falhou`', async () => {
  const cliente = new ClienteRpcFalso({
    [NOME_RPC]: { data: { sucesso: false, motivo: 'cpf_ja_cadastrado' }, error: null },
  });

  const resultado = await persistirPaciente(cliente, ENTRADA);
  // E o caso que o chamador resolve conversando, nao um erro tecnico --
  // mesma disciplina de `horario_ocupado` em reservar-agendamento.ts.
  assert.deepEqual(resultado, { tipo: 'cpf_ja_cadastrado' });
});

test('motivos estruturais previstos viram falhou tipado', async () => {
  for (const motivo of ['clinica_id_ausente', 'telefone_normalizado_ausente', 'nome_ausente']) {
    const cliente = new ClienteRpcFalso({ [NOME_RPC]: { data: { sucesso: false, motivo }, error: null } });
    const resultado = await persistirPaciente(cliente, ENTRADA);
    assert.deepEqual(resultado, { tipo: 'falhou', motivo });
  }
});

test('falha fechado: motivo fora do vocabulario nunca vira cpf_ja_cadastrado nem falha generica', async () => {
  const cliente = new ClienteRpcFalso({
    [NOME_RPC]: { data: { sucesso: false, motivo: 'motivo_inventado_pela_rpc' }, error: null },
  });

  await assert.rejects(() => persistirPaciente(cliente, ENTRADA), ErroRpcTecnico);
});

test('falha fechado: erro do cliente nunca propaga error.message', async () => {
  const detalheSensivel = 'duplicate key value violates unique constraint -- documento=52998224725';
  const cliente = new ClienteRpcFalso({ [NOME_RPC]: { data: null, error: { message: detalheSensivel } } });

  await assert.rejects(
    () => persistirPaciente(cliente, ENTRADA),
    (erro: unknown) => {
      assert.ok(erro instanceof ErroRpcTecnico);
      assert.ok(!erro.message.includes('52998224725'), 'a mensagem tecnica nunca pode carregar PII vinda do banco');
      assert.ok(!erro.message.includes(detalheSensivel));
      return true;
    }
  );
});

test('falha fechado: retorno malformado e rejeitado', async () => {
  for (const data of [null, [], 'texto', { paciente_id: PACIENTE_ID }, { sucesso: 'sim' }]) {
    const cliente = new ClienteRpcFalso({ [NOME_RPC]: { data, error: null } });
    await assert.rejects(() => persistirPaciente(cliente, ENTRADA), ErroRpcTecnico);
  }
});

test('falha fechado: sucesso=true sem paciente_id valido e rejeitado', async () => {
  for (const paciente_id of [undefined, '', 'nao-e-uuid', 42]) {
    const cliente = new ClienteRpcFalso({ [NOME_RPC]: { data: { sucesso: true, paciente_id }, error: null } });
    await assert.rejects(() => persistirPaciente(cliente, ENTRADA), ErroRpcTecnico);
  }
});

test('entrada invalida e rejeitada ANTES de qualquer chamada a RPC', async () => {
  const invalidas: Record<string, unknown>[] = [
    { ...ENTRADA, clinica_id: 'nao-e-uuid' },
    { ...ENTRADA, telefone_normalizado: '   ' },
    { ...ENTRADA, nome: '' },
    { ...ENTRADA, nome: '   ' },
    { ...ENTRADA, cpf: '' },
    { ...ENTRADA, data_nascimento: '19/03/1974' },
    { ...ENTRADA, email: '   ' },
  ];

  for (const entrada of invalidas) {
    const cliente = clienteComSucesso();
    await assert.rejects(
      () => persistirPaciente(cliente, entrada as unknown as Parameters<typeof persistirPaciente>[1]),
      EntradaInvalidaError
    );
    assert.equal(cliente.chamadas.length, 0, 'nada pode ser enviado quando a entrada e invalida');
  }
});

test('o adaptador NAO valida conteudo cadastral -- isso e regra de produto, fora daqui', async () => {
  // CPF com digito verificador invalido e data implausivel passam pelo
  // adaptador de proposito: validacao de CPF/data/nome/email e outra
  // subetapa. O adaptador so garante tipo e formato estrutural.
  const cliente = clienteComSucesso();
  const resultado = await persistirPaciente(cliente, { ...ENTRADA, cpf: '00000000000', data_nascimento: '1800-01-01' });

  assert.equal(resultado.tipo, 'persistido');
  assert.equal(cliente.chamadas[0].parametros.p_documento, '00000000000');
});
