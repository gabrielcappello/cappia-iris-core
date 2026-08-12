import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INTENCOES_PERMITIDAS } from './aplicar-dados.ts';
import { EntradaInvalidaError, InterpretacaoInvalidaError } from './erros.ts';
import { extrairAlteracoes, validarDadosAtuais, validarSnapshotOficial } from './interpretacao-extrator.ts';
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
    // Campos raiz obrigatorios desde 2026-08-09 -- declarados aqui porque este
    // teste compara o resultado com a fixture inteira, por identidade.
    eventos_candidatos: [],
    dentistas_candidatos: null,
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

test('teste4b: um candidato claro atravessa a validacao em dentistas_candidatos', async () => {
  const cliente = new ClienteModeloFalso([
    { natureza_mensagem: 'pedido', alteracoes: {}, dentistas_candidatos: ['dent-ana'] },
  ]);

  const resultado = await extrairAlteracoes(cliente, {
    mensagens_atuais: ['quero com a Ana'],
    dados_atuais: {},
    campos_cadastrais_preenchidos: [],
    dentistas_disponiveis: [{ dentista_id: 'dent-ana', nome_exibido: 'Dra. Ana Souza' }],
  });

  assert.deepEqual(resultado.dentistas_candidatos, ['dent-ana']);
  // A IA nunca escreve o campo -- quem persiste e o Core
  // (specs/dentista-semantico-v1.md secao 12).
  assert.equal(resultado.alteracoes.dentista_id, undefined);
});

test('teste4c: a IA nao pode EMITIR dentista_id -- a saida inteira e invalida', async () => {
  // Guarda de regressao da propria assimetria: `dentista_id` continua
  // persistivel pelo Core, mas saiu de CAMPOS_EMITIVEIS_PELA_IA.
  const cliente = new ClienteModeloFalso([
    { natureza_mensagem: 'pedido', alteracoes: { dentista_id: { acao: 'informar', valor: 'dent-ana' } } },
  ]);

  await assert.rejects(
    () =>
      extrairAlteracoes(cliente, {
        mensagens_atuais: ['quero com a Ana'],
        dados_atuais: {},
        campos_cadastrais_preenchidos: [],
        dentistas_disponiveis: [{ dentista_id: 'dent-ana', nome_exibido: 'Dra. Ana Souza' }],
      }),
    InterpretacaoInvalidaError
  );
});

test('teste4d: varios candidatos plausiveis atravessam intactos -- a IA nao escolhe', async () => {
  const cliente = new ClienteModeloFalso([
    { natureza_mensagem: 'pedido', alteracoes: {}, dentistas_candidatos: ['dent-lapa', 'dent-gomes'] },
  ]);

  const resultado = await extrairAlteracoes(cliente, {
    mensagens_atuais: ['quero com a Vanessa'],
    dados_atuais: {},
    campos_cadastrais_preenchidos: [],
    dentistas_disponiveis: [
      { dentista_id: 'dent-lapa', nome_exibido: 'Dra. Vanessa Lapa' },
      { dentista_id: 'dent-gomes', nome_exibido: 'Dra. Vanessa Gomes' },
    ],
  });

  assert.deepEqual(resultado.dentistas_candidatos, ['dent-lapa', 'dent-gomes']);
});

test('teste4e: lista vazia e valida e DIFERENTE de null -- mencionou, nenhum corresponde', async () => {
  const cliente = new ClienteModeloFalso([
    { natureza_mensagem: 'pedido', alteracoes: {}, dentistas_candidatos: [] },
  ]);

  const resultado = await extrairAlteracoes(cliente, {
    mensagens_atuais: ['quero com a Dra. Beatriz'],
    dados_atuais: {},
    campos_cadastrais_preenchidos: [],
    dentistas_disponiveis: [{ dentista_id: 'dent-ana', nome_exibido: 'Dra. Ana Souza' }],
  });

  assert.deepEqual(resultado.dentistas_candidatos, []);
  assert.notEqual(resultado.dentistas_candidatos, null);
});

test('teste4f: candidato repetido invalida a saida inteira', async () => {
  const cliente = new ClienteModeloFalso([
    { natureza_mensagem: 'pedido', alteracoes: {}, dentistas_candidatos: ['dent-ana', 'dent-ana'] },
  ]);

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [] }),
    InterpretacaoInvalidaError
  );
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

  assert.deepEqual(
    INTENCOES_PERMITIDAS,
    ['novo_agendamento', 'remarcacao', 'cancelamento'],
    'os tres valores permitidos para intencao (specs/cancelamento-conversacional-v1.md secao 1) -- cancelamento entrou SEM nenhuma regra de prompt propria, por medicao'
  );
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

// --- Evento aceitar_troca_telefone (specs/cpf-outro-telefone-v1.md secao 2) ---

async function extrairComEventos(eventos: unknown) {
  const cliente = new ClienteModeloFalso([
    { natureza_mensagem: 'resposta', alteracoes: {}, eventos_candidatos: eventos, dentistas_candidatos: null },
  ]);
  return await extrairAlteracoes(cliente, {
    mensagens_atuais: ['pode sim, atualiza pro meu numero'],
    dados_atuais: {},
    campos_cadastrais_preenchidos: [],
    troca_telefone_pendente: true,
  });
}

test('aceitar_troca_telefone usa a MESMA forma unica de aceitar_opcao', async () => {
  for (const referencia of [null, 'pode sim']) {
    const resultado = await extrairComEventos([{ tipo: 'aceitar_troca_telefone', referencia_textual: referencia }]);
    assert.deepEqual(resultado.eventos_candidatos, [
      { tipo: 'aceitar_troca_telefone', referencia_textual: referencia },
    ]);
  }
});

test('nao existe evento de recusa nem campo `resposta`: qualquer um dos dois invalida a saida', async () => {
  // Recusa e a AUSENCIA do evento, em TODOS os tipos. Um nome de recusa ou um
  // campo `resposta` que aparecesse (modelo antigo, prompt divergente, replay)
  // precisa falhar fechado -- nunca ser aceito por semelhanca.
  const invalidos = [
    [{ tipo: 'recusar_troca_telefone', referencia_textual: null }],
    [{ tipo: 'responder_troca_telefone', resposta: 'sim' }],
    [{ tipo: 'aceitar_troca_telefone', resposta: 'nao' }],
    [{ tipo: 'aceitar_troca_telefone', referencia_textual: null, resposta: 'sim' }],
    [{ tipo: 'aceitar_troca_telefone' }],
  ];

  for (const eventos of invalidos) {
    await assert.rejects(
      () => extrairComEventos(eventos),
      InterpretacaoInvalidaError,
      `esperava rejeitar ${JSON.stringify(eventos)}`
    );
  }
});

test('os dois eventos coexistem no mesmo turno; repetir o mesmo tipo invalida', async () => {
  const resultado = await extrairComEventos([
    { tipo: 'aceitar_opcao', referencia_textual: null },
    { tipo: 'aceitar_troca_telefone', referencia_textual: null },
  ]);
  assert.equal(resultado.eventos_candidatos.length, 2);

  await assert.rejects(
    () =>
      extrairComEventos([
        { tipo: 'aceitar_troca_telefone', referencia_textual: null },
        { tipo: 'aceitar_troca_telefone', referencia_textual: 'de novo' },
      ]),
    InterpretacaoInvalidaError
  );
});

test('troca_telefone_pendente: fechado a `true`, rejeitado em qualquer outro valor', async () => {
  const cliente = new ClienteModeloFalso([{ natureza_mensagem: 'resposta', alteracoes: {} }]);
  for (const valor of [false, 'sim', 1, null]) {
    await assert.rejects(
      () =>
        extrairAlteracoes(cliente, {
          mensagens_atuais: ['pode sim'],
          dados_atuais: {},
          campos_cadastrais_preenchidos: [],
          troca_telefone_pendente: valor,
        }),
      EntradaInvalidaError,
      `esperava rejeitar troca_telefone_pendente=${JSON.stringify(valor)}`
    );
  }
});

// --- Correcao (bug real de producao, 2026-08-12): estado_conversa.dados pode
// conter campos persistidos por uma versao anterior do contrato (ex.:
// `procedimento_texto`, substituido por `procedimento_id` em
// procedimento-semantico-v1.md). Antes desta correcao, `validarSnapshotOficial`
// rejeitava a conversa inteira ao encontrar qualquer campo fora de
// CAMPOS_PERMITIDOS -- bloqueando permanentemente qualquer conversa com
// resíduo de contrato antigo, mesmo antes de qualquer mensagem nova ser
// processada. Estes testes cobrem exatamente os dois lados da correcao:
// snapshot PERSISTIDO filtra em silencio; dado NOVO continua rejeitando. ---

test('validarSnapshotOficial: campo legado fora do contrato atual (procedimento_texto) e descartado em silencio', () => {
  const snapshot = {
    periodo: 'manha',
    data_texto: 'amanhã',
    procedimento_texto: 'Avaliação né',
  };

  const filtrado = validarSnapshotOficial(snapshot);

  assert.deepEqual(filtrado, { periodo: 'manha', data_texto: 'amanhã' });
  assert.equal('procedimento_texto' in filtrado, false);
});

test('validarSnapshotOficial: snapshot sem nenhum campo legado passa identico', () => {
  const snapshot = { procedimento_id: 'clareamento', dentista_id: crypto.randomUUID() };

  const filtrado = validarSnapshotOficial(snapshot);

  assert.deepEqual(filtrado, snapshot);
});

test('validarSnapshotOficial: valor invalido em campo que AINDA pertence ao contrato continua rejeitado', () => {
  // `periodo` esta em CAMPOS_PERMITIDOS -- o filtro e so para campo
  // DESCONHECIDO, nunca para valor invalido de campo conhecido.
  assert.throws(() => validarSnapshotOficial({ periodo: 'meio-dia' }), EntradaInvalidaError);
});

test('validarDadosAtuais: campo desconhecido em dado NOVO continua sendo rejeitado', () => {
  let erroCapturado: unknown;
  try {
    validarDadosAtuais({ procedimento_texto: 'Avaliação' });
  } catch (erro) {
    erroCapturado = erro;
  }

  assert.ok(erroCapturado instanceof EntradaInvalidaError);
  assert.equal((erroCapturado as EntradaInvalidaError).campo, 'campo_desconhecido');
});

test('validarDadosAtuais: campo operacional valido continua aceito normalmente', () => {
  assert.doesNotThrow(() => validarDadosAtuais({ periodo: 'tarde' }));
});
