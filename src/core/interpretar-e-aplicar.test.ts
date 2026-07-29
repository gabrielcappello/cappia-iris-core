import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InterpretacaoInvalidaError } from './erros.ts';
import { interpretarEAplicar } from './interpretar-e-aplicar.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';

const CLINICA_ID = crypto.randomUUID();
const TELEFONE = '5511999999999';

function semearEstado(tabelas: TabelasFalsas, dados: Record<string, unknown>) {
  const conversa = {
    id: crypto.randomUUID(),
    clinica_id: CLINICA_ID,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados,
    paciente_id: null,
    atualizado_em: new Date('2026-07-01T00:00:00.000Z').toISOString(),
  };
  tabelas.estado_conversa.push(conversa);
  return conversa;
}

function contexto(conversaId: string, mensagensAtuais: string[], dadosAtuais: Record<string, string>) {
  return {
    conversa_id: conversaId,
    clinica_id: CLINICA_ID,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: mensagensAtuais,
    dados_atuais: dadosAtuais,
  };
}

test('teste5: correcoes sucessivas resultam em uma unica alteracao final aplicada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const clienteBanco = new ClienteFalso(tabelas);
  // simula o modelo ja tendo colapsado "quero limpeza, na verdade clareamento" em uma unica decisao final
  const clienteModelo = new ClienteModeloFalso([
    { alteracoes: { procedimento_texto: { acao: 'informar', valor: 'clareamento' } } },
  ]);

  const resultado = await interpretarEAplicar(
    clienteModelo,
    clienteBanco,
    contexto(conversa.id, ['quero limpeza', 'na verdade prefiro clareamento'], {})
  );

  assert.deepEqual(resultado.conflitos, []);
  assert.equal(resultado.aplicacao?.dados.procedimento_texto, 'clareamento');
  assert.equal(tabelas.estado_conversa[0].dados.procedimento_texto, 'clareamento');
});

test('teste6: ultima correcao cronologica prevalece (corrigir substitui o valor acumulado)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { procedimento_texto: 'limpeza' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    { alteracoes: { procedimento_texto: { acao: 'corrigir', valor: 'clareamento' } } },
  ]);

  const resultado = await interpretarEAplicar(
    clienteModelo,
    clienteBanco,
    contexto(conversa.id, ['na verdade quero clareamento, nao limpeza'], { procedimento_texto: 'limpeza' })
  );

  assert.deepEqual(resultado.conflitos, [], 'corrigir nunca conflita');
  assert.equal(resultado.aplicacao?.dados.procedimento_texto, 'clareamento');
});

test('teste7: retorno ao valor original gera informar e e aplicavel (nao conflito)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ alteracoes: { nome: { acao: 'informar', valor: 'Joao' } } }]);

  const resultado = await interpretarEAplicar(
    clienteModelo,
    clienteBanco,
    contexto(conversa.id, ['e Joao mesmo, deixa como estava'], { nome: 'Joao' })
  );

  assert.deepEqual(resultado.conflitos, []);
  assert.ok(resultado.aplicacao?.campos_preservados.includes('nome'));
});

test('teste11: campo conflitante nao segue para aplicarDados', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { procedimento_texto: 'limpeza' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    { alteracoes: { procedimento_texto: { acao: 'informar', valor: 'clareamento' } } },
  ]);

  const resultado = await interpretarEAplicar(
    clienteModelo,
    clienteBanco,
    contexto(conversa.id, ['tambem quero clareamento'], { procedimento_texto: 'limpeza' })
  );

  assert.equal(resultado.conflitos.length, 1);
  assert.equal(resultado.conflitos[0].valor_atual, 'limpeza');
  assert.equal(resultado.conflitos[0].valor_informado, 'clareamento');
  assert.equal(resultado.aplicacao, null, 'nenhuma alteracao aplicavel: aplicarDados nunca deve ser chamado');
  assert.equal(clienteBanco.estatisticas.chamadasSelect['estado_conversa'] ?? 0, 0);
  assert.equal(clienteBanco.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0);
  assert.equal(tabelas.estado_conversa[0].dados.procedimento_texto, 'limpeza', 'valor acumulado preservado');
});

test('teste24-25: payload integralmente invalido nao chama aplicarDados e nao modifica o estado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ alteracoes: {}, confidence: 0.9 }]);

  await assert.rejects(
    () => interpretarEAplicar(clienteModelo, clienteBanco, contexto(conversa.id, ['oi'], { nome: 'Joao' })),
    InterpretacaoInvalidaError
  );

  assert.equal(clienteBanco.estatisticas.chamadasSelect['estado_conversa'] ?? 0, 0);
  assert.equal(clienteBanco.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0);
  assert.deepEqual(tabelas.estado_conversa[0].dados, { nome: 'Joao' });
});

test('teste26: alteracoes vazio nao chama aplicarDados', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ alteracoes: {} }]);

  const resultado = await interpretarEAplicar(
    clienteModelo,
    clienteBanco,
    contexto(conversa.id, ['nao sei ainda'], { nome: 'Joao' })
  );

  assert.equal(resultado.aplicacao, null);
  assert.deepEqual(resultado.alteracoes_aplicaveis, {});
  assert.deepEqual(resultado.conflitos, []);
  assert.equal(clienteBanco.estatisticas.chamadasSelect['estado_conversa'] ?? 0, 0);
  assert.equal(clienteBanco.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0);
});
