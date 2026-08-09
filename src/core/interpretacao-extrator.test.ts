import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INTENCOES_PERMITIDAS } from './aplicar-dados.ts';
import { EntradaInvalidaError, InterpretacaoInvalidaError } from './erros.ts';
import { extrairAlteracoes } from './interpretacao-extrator.ts';
import { INSTRUCOES_EXTRATOR } from './interpretacao-instrucoes.ts';
import { ClienteModeloFalso, ClienteModeloNuncaDeveSerChamado } from './teste-cliente-modelo-falso.ts';

test('teste1: entrada com varias mensagens preserva a ordem exata enviada ao modelo', async () => {
  const cliente = new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]);
  const mensagens = ['quero limpeza', 'na verdade prefiro clareamento', 'pode ser sexta'];

  await extrairAlteracoes(cliente, { mensagens_atuais: mensagens, dados_atuais: {}, campos_cadastrais_preenchidos: [] });

  assert.deepEqual(cliente.chamadas[0].payload.mensagens_atuais, mensagens);
});

test('teste2: varios campos em uma saida valida sao aceitos', async () => {
  const saida = {
    natureza_mensagem: 'resposta',
    alteracoes: {
      nome: { acao: 'informar', valor: 'Joao' },
      cpf: { acao: 'informar', valor: '11122233344' },
      periodo: { acao: 'informar', valor: 'manha' },
    },
    // Campo raiz obrigatorio desde 2026-08-09 -- declarado aqui porque este
    // teste compara o resultado com a fixture inteira, por identidade.
    eventos_candidatos: [],
  };
  const cliente = new ClienteModeloFalso([saida]);

  const resultado = await extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [] });

  assert.deepEqual(resultado, saida);
});

test('teste3: dois procedimentos coexistentes preservados em uma unica string', async () => {
  const saida = {
    natureza_mensagem: 'pedido',
    alteracoes: { procedimento_id: { acao: 'informar', valor: 'limpeza e clareamento' } },
  };
  const cliente = new ClienteModeloFalso([saida]);

  const resultado = await extrairAlteracoes(cliente, { mensagens_atuais: ['quero limpeza e clareamento'], dados_atuais: {}, campos_cadastrais_preenchidos: [] });

  assert.equal(resultado.alteracoes.procedimento_id?.valor, 'limpeza e clareamento');
});

// SUBSTITUIU, em 2026-08-09, o teste4 original ("dois dentistas
// alternativos preservados em uma unica string"), que afirmava o contrato
// antigo: a IA devolvia `dentista_texto` cru e o Core casava o nome depois.
// Com specs/dentista-semantico-v1.md a IA devolve `dentista_id` escolhido de
// `dentistas_disponiveis`, e duvida real entre dois candidatos OMITE o campo
// -- nunca escolhe por aproximacao, nunca inventa um valor composto.
test('teste4: duvida entre dois dentistas omite dentista_id, nunca produz um valor composto', async () => {
  const cliente = new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]);

  const resultado = await extrairAlteracoes(cliente, {
    mensagens_atuais: ['pode ser com Ana ou Carla'],
    dados_atuais: {},
    campos_cadastrais_preenchidos: [],
    dentistas_disponiveis: [
      { dentista_id: 'dent-ana', nome_exibido: 'Dra. Ana Souza' },
      { dentista_id: 'dent-carla', nome_exibido: 'Dra. Carla Lima' },
    ],
  });

  assert.equal(resultado.alteracoes.dentista_id, undefined);
});

test('teste4b: dentista_id escolhido da lista atravessa a validacao intacto', async () => {
  const cliente = new ClienteModeloFalso([
    { natureza_mensagem: 'pedido', alteracoes: { dentista_id: { acao: 'informar', valor: 'dent-ana' } } },
  ]);

  const resultado = await extrairAlteracoes(cliente, {
    mensagens_atuais: ['quero com a Ana'],
    dados_atuais: {},
    campos_cadastrais_preenchidos: [],
    dentistas_disponiveis: [{ dentista_id: 'dent-ana', nome_exibido: 'Dra. Ana Souza' }],
  });

  assert.equal(resultado.alteracoes.dentista_id?.valor, 'dent-ana');
});

test('teste15: duvida real gera alteracoes vazio, que e uma saida valida', async () => {
  const cliente = new ClienteModeloFalso([{ natureza_mensagem: 'duvida', alteracoes: {} }]);

  const resultado = await extrairAlteracoes(cliente, { mensagens_atuais: ['nao sei ainda'], dados_atuais: {}, campos_cadastrais_preenchidos: [] });

  assert.deepEqual(resultado.alteracoes, {});
});

test('teste16: as instrucoes registram explicitamente que periodo nao e inferido de horario', () => {
  assert.ok(INSTRUCOES_EXTRATOR.includes('nunca e inferido a partir de um horario'));

  const fraseEmissaoIntencao =
    'Emita intencao = novo_agendamento somente quando a janela atual expressar um pedido de marcar um novo atendimento; a mera mencao ou correcao de procedimento, dentista, data, periodo ou horario nao emite intencao.';
  const ocorrencias = INSTRUCOES_EXTRATOR.split(fraseEmissaoIntencao).length - 1;
  assert.equal(ocorrencias, 1, 'a regra de emissao de intencao deve aparecer exatamente uma vez em INSTRUCOES_EXTRATOR');

  assert.deepEqual(INTENCOES_PERMITIDAS, ['novo_agendamento'], 'novo_agendamento continua sendo o unico valor permitido para intencao');
});

test('teste17: campo nao mencionado fica ausente da saida interpretada', async () => {
  const cliente = new ClienteModeloFalso([
    { natureza_mensagem: 'resposta', alteracoes: { nome: { acao: 'informar', valor: 'Joao' } } },
  ]);

  const resultado = await extrairAlteracoes(cliente, { mensagens_atuais: ['sou o Joao'], dados_atuais: {}, campos_cadastrais_preenchidos: [] });

  assert.deepEqual(Object.keys(resultado.alteracoes), ['nome']);
});

test('teste18: campo extra no nivel principal invalida tudo', async () => {
  const cliente = new ClienteModeloFalso([{ alteracoes: {}, confidence: 0.9 }]);

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [] }),
    InterpretacaoInvalidaError
  );
});

test('teste19: campo conversacional desconhecido invalida tudo', async () => {
  const cliente = new ClienteModeloFalso([
    { natureza_mensagem: 'resposta', alteracoes: { telefone: { acao: 'informar', valor: '5511999999999' } } },
  ]);

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [] }),
    InterpretacaoInvalidaError
  );
});

test('teste20: acao desconhecida invalida tudo', async () => {
  const cliente = new ClienteModeloFalso([
    { natureza_mensagem: 'resposta', alteracoes: { nome: { acao: 'apagar_tudo', valor: 'x' } } },
  ]);

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [] }),
    InterpretacaoInvalidaError
  );
});

test('teste21: propriedade interna extra invalida tudo', async () => {
  const cliente = new ClienteModeloFalso([
    { natureza_mensagem: 'resposta', alteracoes: { nome: { acao: 'informar', valor: 'Joao', confidence: 0.9 } } },
  ]);

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [] }),
    InterpretacaoInvalidaError
  );
});

test('teste22: valor de tipo incorreto invalida tudo', async () => {
  const cliente = new ClienteModeloFalso([
    { natureza_mensagem: 'resposta', alteracoes: { nome: { acao: 'informar', valor: 42 } } },
  ]);

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [] }),
    InterpretacaoInvalidaError
  );
});

test('teste23: remover contendo valor invalida tudo (mesmo string vazia ou null)', async () => {
  const clienteComValorVazio = new ClienteModeloFalso([
    { natureza_mensagem: 'resposta', alteracoes: { cpf: { acao: 'remover', valor: '' } } },
  ]);
  await assert.rejects(
    () => extrairAlteracoes(clienteComValorVazio, { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [] }),
    InterpretacaoInvalidaError
  );

  const clienteComValorNull = new ClienteModeloFalso([
    { natureza_mensagem: 'resposta', alteracoes: { cpf: { acao: 'remover', valor: null } } },
  ]);
  await assert.rejects(
    () => extrairAlteracoes(clienteComValorNull, { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [] }),
    InterpretacaoInvalidaError
  );
});

test('teste27: mensagens_atuais invalida e rejeitada antes de qualquer chamada ao modelo', async () => {
  const cliente = new ClienteModeloNuncaDeveSerChamado();

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: [], dados_atuais: {}, campos_cadastrais_preenchidos: [] }),
    EntradaInvalidaError
  );
});

test('teste28: dados_atuais invalido e rejeitado antes de qualquer chamada ao modelo', async () => {
  const cliente = new ClienteModeloNuncaDeveSerChamado();

  await assert.rejects(
    () =>
      extrairAlteracoes(cliente, {
        mensagens_atuais: ['oi'],
        dados_atuais: { telefone: '5511999999999' },
        campos_cadastrais_preenchidos: [],
      }),
    EntradaInvalidaError
  );
});

test('teste29a: erro de saida invalida nao contem PII nem resposta bruta do modelo', async () => {
  const nomeReal = 'Maria Silva Santos';
  const cpfReal = '12345678900';
  const emailReal = 'maria.silva@example.com';

  const cliente = new ClienteModeloFalso([
    {
      natureza_mensagem: 'resposta',
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
    await extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [] });
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
      campos_cadastrais_preenchidos: [],
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
        campos_cadastrais_preenchidos: [],
        telefone: '5511999999999',
      }),
    EntradaInvalidaError
  );
});

test('correcao1: payload enviado ao modelo contem exatamente as tres chaves do contrato', async () => {
  const cliente = new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]);

  await extrairAlteracoes(cliente, {
    mensagens_atuais: ['oi'],
    dados_atuais: { procedimento_id: 'limpeza' },
    campos_cadastrais_preenchidos: ['nome'],
  });

  assert.deepEqual(Object.keys(cliente.chamadas[0].payload).sort(), [
    'campos_cadastrais_preenchidos',
    'dados_atuais',
    'mensagens_atuais',
  ]);
});

// --- Correcao 3: nunca reproduzir chave bruta em erros ---

test('correcao3: chave desconhecida contendo nome, CPF e e-mail no proprio nome nunca aparece no erro', async () => {
  const chavePerigosa = 'nome_Maria_Silva_cpf_12345678900_email_maria.silva@example.com';
  const cliente = new ClienteModeloFalso([
    { natureza_mensagem: 'resposta', alteracoes: { [chavePerigosa]: { acao: 'informar', valor: 'x' } } },
  ]);

  let erroCapturado: unknown;
  try {
    await extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [] });
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
