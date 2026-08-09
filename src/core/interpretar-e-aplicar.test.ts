import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EntradaInvalidaError, InterpretacaoInvalidaError } from './erros.ts';
import { interpretarEAplicar } from './interpretar-e-aplicar.ts';
import type { ClienteModeloEstruturado } from './interpretacao-tipos.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso, ClienteModeloNuncaDeveSerChamado } from './teste-cliente-modelo-falso.ts';

const CLINICA_ID = crypto.randomUUID();
const TELEFONE = '5511999999999';

// Narrow minimo para os dados de uma linha do fake (TabelasFalsas tipa cada
// linha como Record<string, unknown> -- nunca confia que um campo seja um
// objeto sem confirmar em runtime).
function comoRegistro(valor: unknown): Record<string, unknown> {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error('dados de teste em formato inesperado (esperado objeto)');
  }
  return valor as Record<string, unknown>;
}

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

function contexto(conversaId: string, mensagensAtuais: string[], overrides: Record<string, unknown> = {}) {
  return {
    conversa_id: conversaId,
    clinica_id: CLINICA_ID,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: mensagensAtuais,
    ...overrides,
  };
}

test('teste5: correcoes sucessivas resultam em uma unica alteracao final aplicada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const clienteBanco = new ClienteFalso(tabelas);
  // simula o modelo ja tendo colapsado "quero limpeza, na verdade clareamento" em uma unica decisao final
  const clienteModelo = new ClienteModeloFalso([
    { natureza_mensagem: 'pedido', alteracoes: { procedimento_id: { acao: 'informar', valor: 'clareamento' } } },
  ]);

  const resultado = await interpretarEAplicar(
    clienteModelo,
    clienteBanco,
    contexto(conversa.id, ['quero limpeza', 'na verdade prefiro clareamento'])
  );

  assert.deepEqual(resultado.conflitos, []);
  assert.equal(resultado.aplicacao?.dados.procedimento_id, 'clareamento');
  assert.equal(comoRegistro(tabelas.estado_conversa[0].dados).procedimento_id, 'clareamento');
});

test('teste6: ultima correcao cronologica prevalece (corrigir substitui o valor acumulado)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { procedimento_id: 'cleaning' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    { natureza_mensagem: 'correcao', alteracoes: { procedimento_id: { acao: 'corrigir', valor: 'clareamento' } } },
  ]);

  const resultado = await interpretarEAplicar(
    clienteModelo,
    clienteBanco,
    contexto(conversa.id, ['na verdade quero clareamento, nao limpeza'])
  );

  assert.deepEqual(resultado.conflitos, [], 'corrigir nunca conflita');
  assert.equal(resultado.aplicacao?.dados.procedimento_id, 'clareamento');
});

test('teste7: retorno ao valor original gera informar e e aplicavel (nao conflito)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    { natureza_mensagem: 'resposta', alteracoes: { nome: { acao: 'informar', valor: 'Joao' } } },
  ]);

  const resultado = await interpretarEAplicar(
    clienteModelo,
    clienteBanco,
    contexto(conversa.id, ['e Joao mesmo, deixa como estava'])
  );

  assert.deepEqual(resultado.conflitos, []);
  assert.ok(resultado.aplicacao?.campos_preservados.includes('nome'));
});

test('teste11: campo conflitante nao segue para aplicarDados', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { procedimento_id: 'cleaning' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    { natureza_mensagem: 'pedido', alteracoes: { procedimento_id: { acao: 'informar', valor: 'clareamento' } } },
  ]);

  const resultado = await interpretarEAplicar(clienteModelo, clienteBanco, contexto(conversa.id, ['tambem quero clareamento']));

  assert.equal(resultado.conflitos.length, 1);
  assert.equal(resultado.conflitos[0].valor_atual, 'cleaning');
  assert.equal(resultado.conflitos[0].valor_informado, 'clareamento');
  assert.equal(resultado.aplicacao, null, 'nenhuma alteracao aplicavel: aplicarDados nunca deve ser chamado');
  assert.equal(clienteBanco.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0);
  assert.equal(comoRegistro(tabelas.estado_conversa[0].dados).procedimento_id, 'cleaning', 'valor acumulado preservado');
});

test('teste24-25: payload integralmente invalido nao chama aplicarDados e nao modifica o estado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ alteracoes: {}, confidence: 0.9 }]);

  await assert.rejects(
    () => interpretarEAplicar(clienteModelo, clienteBanco, contexto(conversa.id, ['oi'])),
    InterpretacaoInvalidaError
  );

  assert.equal(clienteBanco.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0);
  assert.deepEqual(tabelas.estado_conversa[0].dados, { nome: 'Joao' });
});

test('teste26: alteracoes vazio nao chama aplicarDados', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'duvida', alteracoes: {} }]);

  const resultado = await interpretarEAplicar(clienteModelo, clienteBanco, contexto(conversa.id, ['nao sei ainda']));

  assert.equal(resultado.aplicacao, null);
  assert.deepEqual(resultado.alteracoes_aplicaveis, {});
  assert.deepEqual(resultado.conflitos, []);
  assert.equal(clienteBanco.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0);
});

// --- Correcao 2: validar contexto antes do banco e do modelo ---

test('correcao2: conversa_id invalido e rejeitado sem consultar o banco nem chamar o modelo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearEstado(tabelas, {});
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloNuncaDeveSerChamado();

  await assert.rejects(
    () => interpretarEAplicar(clienteModelo, clienteBanco, contexto('nao-e-um-uuid', ['oi'])),
    EntradaInvalidaError
  );

  assert.equal(clienteBanco.estatisticas.chamadasSelect['estado_conversa'] ?? 0, 0);
  assert.equal(clienteBanco.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0);
});

test('correcao2: clinica_id invalido e rejeitado sem consultar o banco nem chamar o modelo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloNuncaDeveSerChamado();

  await assert.rejects(
    () =>
      interpretarEAplicar(
        clienteModelo,
        clienteBanco,
        contexto(conversa.id, ['oi'], { clinica_id: 'nao-e-um-uuid' })
      ),
    EntradaInvalidaError
  );

  assert.equal(clienteBanco.estatisticas.chamadasSelect['estado_conversa'] ?? 0, 0);
  assert.equal(clienteBanco.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0);
});

test('correcao2: telefone_normalizado invalido e rejeitado sem consultar o banco nem chamar o modelo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloNuncaDeveSerChamado();

  await assert.rejects(
    () =>
      interpretarEAplicar(
        clienteModelo,
        clienteBanco,
        contexto(conversa.id, ['oi'], { telefone_normalizado: '11999999999' })
      ),
    EntradaInvalidaError
  );

  assert.equal(clienteBanco.estatisticas.chamadasSelect['estado_conversa'] ?? 0, 0);
  assert.equal(clienteBanco.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0);
});

// --- Correcao 4: snapshot oficial, nunca o do chamador ---

test('correcao4a: o modelo recebe o snapshot oficial lido do banco, nao um dados_atuais fornecido pelo chamador', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { procedimento_id: 'cleaning' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]);

  await interpretarEAplicar(clienteModelo, clienteBanco, contexto(conversa.id, ['oi']));

  assert.equal(clienteModelo.chamadas[0].payload.dados_atuais.procedimento_id, 'cleaning');
});

test('correcao4b: entrada integrada contendo dados_atuais e rejeitada; banco e modelo nao sao chamados', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { procedimento_id: 'cleaning' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloNuncaDeveSerChamado();

  await assert.rejects(
    () =>
      interpretarEAplicar(
        clienteModelo,
        clienteBanco,
        contexto(conversa.id, ['oi'], { dados_atuais: { procedimento_id: 'cleaning' } })
      ),
    EntradaInvalidaError
  );

  assert.equal(clienteBanco.estatisticas.chamadasSelect['estado_conversa'] ?? 0, 0);
  assert.equal(clienteBanco.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0);
});

test('correcao4c: divergencia durante a execucao gera conflito, remove o campo de alteracoes_aplicaveis, e nao afeta os demais campos', async () => {
  const tabelas = criarTabelasFalsasVazias();
  // 1) snapshot inicial nao possui data_texto
  const conversa = semearEstado(tabelas, {});
  const clienteBanco = new ClienteFalso(tabelas);

  // Cliente de modelo com efeito colateral: simula outra operacao gravando
  // data_texto = sabado DEPOIS que o snapshot foi lido, mas ANTES de
  // aplicarDados ser chamado (a janela exata que a reconciliacao cobre).
  const clienteModelo: ClienteModeloEstruturado = {
    async executar() {
      const linha = tabelas.estado_conversa[0];
      linha.dados = { ...(linha.dados as Record<string, unknown>), data_texto: 'sabado' };
      // 2) modelo retorna data_texto informar sexta + nome informar Joao
      return {
        natureza_mensagem: 'pedido',
        alteracoes: {
          data_texto: { acao: 'informar', valor: 'sexta' },
          nome: { acao: 'informar', valor: 'Joao' },
        },
      };
    },
  };

  const resultado = await interpretarEAplicar(clienteModelo, clienteBanco, contexto(conversa.id, ['pode ser sexta, sou o Joao']));

  // 4) aplicarDados preserva sabado (informar em campo com valor diferente do real)
  // 5) conflito: campo=data_texto, valor_atual=sabado, valor_informado=sexta
  assert.equal(resultado.conflitos.length, 1);
  assert.equal(resultado.conflitos[0].campo, 'data_texto');
  assert.equal(resultado.conflitos[0].valor_atual, 'sabado');
  assert.equal(resultado.conflitos[0].valor_informado, 'sexta');

  // 6) data_texto nao permanece em alteracoes_aplicaveis
  assert.ok(!('data_texto' in resultado.alteracoes_aplicaveis));

  // 7) nome continua aplicado normalmente
  assert.ok('nome' in resultado.alteracoes_aplicaveis);
  assert.equal(resultado.aplicacao?.dados.nome, 'Joao');
  assert.ok(resultado.aplicacao?.campos_adicionados.includes('nome'));

  // 8) nenhum valor escolhido/perdido silenciosamente: o banco continua com sabado
  assert.equal(comoRegistro(tabelas.estado_conversa[0].dados).data_texto, 'sabado');
});

// --- Correcao (revisao sobre 7123493): validarDadosAtuais nao pode vazar
// a chave bruta do snapshot oficial (nome/campo.desconhecido) ---

test('correcao_dados_atuais: chave desconhecida no snapshot oficial com PII no proprio nome e rejeitada antes do modelo, sem vazar no erro', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const chavePerigosa = 'nome_Maria_Silva_cpf_12345678900_email_maria.silva@example.com';
  const conversa = semearEstado(tabelas, { [chavePerigosa]: 'x' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloNuncaDeveSerChamado();

  let erroCapturado: unknown;
  try {
    await interpretarEAplicar(clienteModelo, clienteBanco, contexto(conversa.id, ['oi']));
  } catch (erro) {
    erroCapturado = erro;
  }

  assert.ok(erroCapturado instanceof EntradaInvalidaError);
  const erroTipado = erroCapturado as EntradaInvalidaError;
  assert.equal(erroTipado.campo, 'campo_desconhecido', 'erro.campo deve usar identificador generico fixo');

  const representacao = JSON.stringify(erroTipado) + erroTipado.message + erroTipado.campo;
  assert.ok(!representacao.includes(chavePerigosa), 'a chave completa nao pode aparecer no erro');
  assert.ok(!representacao.includes('Maria_Silva'), 'nome embutido na chave nao pode aparecer');
  assert.ok(!representacao.includes('12345678900'), 'cpf embutido na chave nao pode aparecer');
  assert.ok(!representacao.includes('maria.silva@example.com'), 'e-mail embutido na chave nao pode aparecer');

  // nenhuma atualizacao ocorre (a rejeicao acontece antes de qualquer chamada ao modelo/UPDATE)
  assert.equal(clienteBanco.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0);
});
