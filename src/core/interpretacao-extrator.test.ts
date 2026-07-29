import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EntradaInvalidaError, InterpretacaoInvalidaError } from './erros.ts';
import { extrairAlteracoes } from './interpretacao-extrator.ts';
import { INSTRUCOES_EXTRATOR } from './interpretacao-instrucoes.ts';
import { ClienteModeloFalso, ClienteModeloNuncaDeveSerChamado } from './teste-cliente-modelo-falso.ts';

test('teste1: entrada com varias mensagens preserva a ordem exata enviada ao modelo', async () => {
  const cliente = new ClienteModeloFalso([{ alteracoes: {} }]);
  const mensagens = ['quero limpeza', 'na verdade prefiro clareamento', 'pode ser sexta'];

  await extrairAlteracoes(cliente, { mensagens_atuais: mensagens, dados_atuais: {} });

  assert.deepEqual(cliente.chamadas[0].payload.mensagens_atuais, mensagens);
});

test('teste2: varios campos em uma saida valida sao aceitos', async () => {
  const saida = {
    alteracoes: {
      nome: { acao: 'informar', valor: 'Joao' },
      cpf: { acao: 'informar', valor: '11122233344' },
      periodo: { acao: 'informar', valor: 'manha' },
    },
  };
  const cliente = new ClienteModeloFalso([saida]);

  const resultado = await extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {} });

  assert.deepEqual(resultado, saida);
});

test('teste3: dois procedimentos coexistentes preservados em uma unica string', async () => {
  const saida = { alteracoes: { procedimento_texto: { acao: 'informar', valor: 'limpeza e clareamento' } } };
  const cliente = new ClienteModeloFalso([saida]);

  const resultado = await extrairAlteracoes(cliente, { mensagens_atuais: ['quero limpeza e clareamento'], dados_atuais: {} });

  assert.equal(resultado.alteracoes.procedimento_texto?.valor, 'limpeza e clareamento');
});

test('teste4: dois dentistas alternativos preservados em uma unica string', async () => {
  const saida = { alteracoes: { dentista_texto: { acao: 'informar', valor: 'Ana ou Carla' } } };
  const cliente = new ClienteModeloFalso([saida]);

  const resultado = await extrairAlteracoes(cliente, { mensagens_atuais: ['pode ser com Ana ou Carla'], dados_atuais: {} });

  assert.equal(resultado.alteracoes.dentista_texto?.valor, 'Ana ou Carla');
});

test('teste15: duvida real gera alteracoes vazio, que e uma saida valida', async () => {
  const cliente = new ClienteModeloFalso([{ alteracoes: {} }]);

  const resultado = await extrairAlteracoes(cliente, { mensagens_atuais: ['nao sei ainda'], dados_atuais: {} });

  assert.deepEqual(resultado.alteracoes, {});
});

test('teste16: as instrucoes registram explicitamente que periodo nao e inferido de horario', () => {
  assert.ok(INSTRUCOES_EXTRATOR.includes('nunca e inferido a partir de um horario'));
});

test('teste17: campo nao mencionado fica ausente da saida interpretada', async () => {
  const cliente = new ClienteModeloFalso([{ alteracoes: { nome: { acao: 'informar', valor: 'Joao' } } }]);

  const resultado = await extrairAlteracoes(cliente, { mensagens_atuais: ['sou o Joao'], dados_atuais: {} });

  assert.deepEqual(Object.keys(resultado.alteracoes), ['nome']);
});

test('teste18: campo extra no nivel principal invalida tudo', async () => {
  const cliente = new ClienteModeloFalso([{ alteracoes: {}, confidence: 0.9 }]);

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {} }),
    InterpretacaoInvalidaError
  );
});

test('teste19: campo conversacional desconhecido invalida tudo', async () => {
  const cliente = new ClienteModeloFalso([{ alteracoes: { telefone: { acao: 'informar', valor: '5511999999999' } } }]);

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {} }),
    InterpretacaoInvalidaError
  );
});

test('teste20: acao desconhecida invalida tudo', async () => {
  const cliente = new ClienteModeloFalso([{ alteracoes: { nome: { acao: 'apagar_tudo', valor: 'x' } } }]);

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {} }),
    InterpretacaoInvalidaError
  );
});

test('teste21: propriedade interna extra invalida tudo', async () => {
  const cliente = new ClienteModeloFalso([
    { alteracoes: { nome: { acao: 'informar', valor: 'Joao', confidence: 0.9 } } },
  ]);

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {} }),
    InterpretacaoInvalidaError
  );
});

test('teste22: valor de tipo incorreto invalida tudo', async () => {
  const cliente = new ClienteModeloFalso([{ alteracoes: { nome: { acao: 'informar', valor: 42 } } }]);

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {} }),
    InterpretacaoInvalidaError
  );
});

test('teste23: remover contendo valor invalida tudo (mesmo string vazia ou null)', async () => {
  const clienteComValorVazio = new ClienteModeloFalso([{ alteracoes: { cpf: { acao: 'remover', valor: '' } } }]);
  await assert.rejects(
    () => extrairAlteracoes(clienteComValorVazio, { mensagens_atuais: ['oi'], dados_atuais: {} }),
    InterpretacaoInvalidaError
  );

  const clienteComValorNull = new ClienteModeloFalso([{ alteracoes: { cpf: { acao: 'remover', valor: null } } }]);
  await assert.rejects(
    () => extrairAlteracoes(clienteComValorNull, { mensagens_atuais: ['oi'], dados_atuais: {} }),
    InterpretacaoInvalidaError
  );
});

test('teste27: mensagens_atuais invalida e rejeitada antes de qualquer chamada ao modelo', async () => {
  const cliente = new ClienteModeloNuncaDeveSerChamado();

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: [], dados_atuais: {} }),
    EntradaInvalidaError
  );
});

test('teste28: dados_atuais invalido e rejeitado antes de qualquer chamada ao modelo', async () => {
  const cliente = new ClienteModeloNuncaDeveSerChamado();

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: { telefone: '5511999999999' } }),
    EntradaInvalidaError
  );
});

test('teste29a: erro de saida invalida nao contem PII nem resposta bruta do modelo', async () => {
  const nomeReal = 'Maria Silva Santos';
  const cpfReal = '12345678900';
  const emailReal = 'maria.silva@example.com';

  const cliente = new ClienteModeloFalso([
    {
      alteracoes: {
        nome: { acao: 'informar', valor: nomeReal },
        cpf: { acao: 'informar', valor: cpfReal },
        email: { acao: 'informar', valor: emailReal },
        campo_estranho: { acao: 'informar', valor: 'x' },
      },
    },
  ]);

  let erroCapturado: unknown;
  try {
    await extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {} });
  } catch (erro) {
    erroCapturado = erro;
  }

  assert.ok(erroCapturado instanceof InterpretacaoInvalidaError);
  const erroTipado = erroCapturado as InterpretacaoInvalidaError;
  const representacao = JSON.stringify(erroTipado) + erroTipado.message + erroTipado.codigo + erroTipado.caminho;
  assert.ok(!representacao.includes(nomeReal));
  assert.ok(!representacao.includes(cpfReal));
  assert.ok(!representacao.includes(emailReal));
});

test('teste29b: erro de entrada invalida nao contem PII', async () => {
  const nomeReal = 'Joao Pereira';
  const cliente = new ClienteModeloNuncaDeveSerChamado();

  let erroCapturado: unknown;
  try {
    await extrairAlteracoes(cliente, {
      mensagens_atuais: ['oi'],
      dados_atuais: { nome: nomeReal, telefone: '5511999999999' },
    });
  } catch (erro) {
    erroCapturado = erro;
  }

  assert.ok(erroCapturado instanceof EntradaInvalidaError);
  const representacao = JSON.stringify(erroCapturado) + (erroCapturado as Error).message;
  assert.ok(!representacao.includes(nomeReal));
});

// --- Correcao 1: fechar integralmente a entrada do extrator ---

test('correcao1: entrada com propriedade extra (telefone) e rejeitada; modelo nao e chamado; nada extra chega ao payload', async () => {
  const cliente = new ClienteModeloNuncaDeveSerChamado();

  await assert.rejects(
    () =>
      extrairAlteracoes(cliente, {
        mensagens_atuais: ['oi'],
        dados_atuais: {},
        telefone: '5511999999999',
      }),
    EntradaInvalidaError
  );
});

test('correcao1: payload enviado ao modelo contem exatamente mensagens_atuais e dados_atuais, mesmo que a validacao aceite', async () => {
  const cliente = new ClienteModeloFalso([{ alteracoes: {} }]);

  await extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: { nome: 'Joao' } });

  assert.deepEqual(Object.keys(cliente.chamadas[0].payload).sort(), ['dados_atuais', 'mensagens_atuais']);
});

// --- Correcao 3: nunca reproduzir chave bruta em erros ---

test('correcao3: chave desconhecida contendo nome, CPF e e-mail no proprio nome nunca aparece no erro', async () => {
  const chavePerigosa = 'nome_Maria_Silva_cpf_12345678900_email_maria.silva@example.com';
  const cliente = new ClienteModeloFalso([{ alteracoes: { [chavePerigosa]: { acao: 'informar', valor: 'x' } } }]);

  let erroCapturado: unknown;
  try {
    await extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {} });
  } catch (erro) {
    erroCapturado = erro;
  }

  assert.ok(erroCapturado instanceof InterpretacaoInvalidaError);
  const erroTipado = erroCapturado as InterpretacaoInvalidaError;
  const representacao = JSON.stringify(erroTipado) + erroTipado.message + erroTipado.codigo + erroTipado.caminho;
  assert.ok(!representacao.includes(chavePerigosa));
  assert.ok(!representacao.includes('Maria_Silva'));
  assert.ok(!representacao.includes('12345678900'));
  assert.ok(!representacao.includes('maria.silva@example.com'));
  assert.equal(erroTipado.caminho, 'saida.alteracoes.campo_desconhecido');
});
