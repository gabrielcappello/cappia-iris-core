import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EntradaInvalidaError, InterpretacaoInvalidaError } from './erros.ts';
import { interpretarEAplicar } from './interpretar-e-aplicar.ts';
import { criarClienteModeloOpenAI, ErroClienteModeloOpenAI, MODELO_IRIS_NOVA } from './cliente-modelo-openai.ts';
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
        // Dublê inline (nao passa por ClienteModeloFalso): declara os campos
        // raiz obrigatorios por conta propria.
        eventos_candidatos: [],
        dentistas_candidatos: null,
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

// --- Correcao (bug real de producao, 2026-08-12): campo fora do contrato
// ATUAL no snapshot oficial persistido (ex.: de uma versao anterior do
// contrato) e descartado em silencio, nunca bloqueia a conversa. Substitui o
// teste anterior (revisao sobre 7123493), que cobria o comportamento antigo
// -- rejeitar e nunca chamar o modelo -- hoje deliberadamente removido. ---

test('snapshot oficial com campo legado desconhecido: conversa continua normalmente, campo nunca vaza ao modelo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const chavePerigosa = 'nome_Maria_Silva_cpf_12345678900_email_maria.silva@example.com';
  // `periodo` e um campo que CONTINUA no contrato hoje -- prova que o filtro
  // e seletivo (descarta so o desconhecido), nunca destroi o snapshot inteiro.
  const conversa = semearEstado(tabelas, { [chavePerigosa]: 'x', periodo: 'tarde' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]);

  const resultado = await interpretarEAplicar(clienteModelo, clienteBanco, contexto(conversa.id, ['oi']));

  // chegou ate o modelo -- nao foi rejeitada.
  assert.equal(clienteModelo.chamadas.length, 1);
  assert.equal(resultado.natureza_mensagem, 'saudacao');

  const payloadEnviado = JSON.stringify(clienteModelo.chamadas[0]!.payload);
  assert.ok(!payloadEnviado.includes(chavePerigosa), 'a chave completa nao pode chegar ao payload do modelo');
  assert.ok(!payloadEnviado.includes('Maria_Silva'), 'nome embutido na chave nao pode chegar ao modelo');
  assert.ok(!payloadEnviado.includes('12345678900'), 'cpf embutido na chave nao pode chegar ao modelo');
  assert.ok(!payloadEnviado.includes('maria.silva@example.com'), 'e-mail embutido na chave nao pode chegar ao modelo');

  // o campo que continua valido no contrato de hoje sobrevive ao filtro.
  const dadosAtuaisEnviados = (clienteModelo.chamadas[0]!.payload as { dados_atuais?: Record<string, unknown> })
    .dados_atuais;
  assert.equal(dadosAtuaisEnviados?.periodo, 'tarde');
});

// --- INT-21 e INT-23: politica de tentativas para resposta truncada
// (specs/interpretacao-ia.md, "Politica de tentativas", decisao aprovada por
// Gabriel em 24/08/2026). A repeticao unica em si (INT-20) e o descarte do
// fragmento (INT-22) sao testados no adaptador isolado
// (cliente-modelo-openai.test.ts) -- aqui o que importa e o comportamento do
// ORQUESTRADOR quando o adaptador ja esgotou as duas tentativas e propagou
// ErroClienteModeloOpenAI(categoria='resposta_truncada'): interpretarEAplicar
// nao intercepta esse erro (index.ts, na Edge Function, e quem decide
// devolver HTTP 200 com a mensagem fixa -- ver o branch adicionado la), mas
// precisa propaga-lo sem tocar no banco.

// Dublê minimo: simula um adaptador que ja fez a unica segunda tentativa
// internamente (responsabilidade do adaptador, nao deste orquestrador) e
// esgotou -- exatamente o que criarClienteModeloOpenAI().executar() lança
// depois de duas tentativas truncadas.
function clienteModeloEsgotadoPorTruncamento(): ClienteModeloEstruturado {
  return {
    async executar() {
      throw new ErroClienteModeloOpenAI(
        'resposta_truncada',
        'resposta_incompleta',
        2,
        120,
        MODELO_IRIS_NOVA,
        200
      );
    },
  };
}

test('INT-21: erro de resposta_truncada esgotada e propagado intacto, sem persistir nada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { procedimento_id: 'limpeza' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = clienteModeloEsgotadoPorTruncamento();

  let erro: unknown;
  try {
    await interpretarEAplicar(clienteModelo, clienteBanco, contexto(conversa.id, ['oi, queria remarcar']));
  } catch (e) {
    erro = e;
  }

  assert.ok(erro instanceof ErroClienteModeloOpenAI, `esperava ErroClienteModeloOpenAI, recebeu ${String(erro)}`);
  assert.equal((erro as ErroClienteModeloOpenAI).categoria, 'resposta_truncada');
  assert.equal((erro as ErroClienteModeloOpenAI).tentativas, 2);

  // nenhuma acao operacional, nenhuma persistencia -- nem parcial.
  assert.equal(clienteBanco.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0);
  assert.deepEqual(tabelas.estado_conversa[0].dados, { procedimento_id: 'limpeza' }, 'snapshot original intacto');
});

test('INT-21: erro sanitizado de resposta_truncada esgotada nunca contem a mensagem do paciente nem dados_atuais', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const mensagemSensivel = 'meu cpf e 12345678900, quero cancelar tudo';
  const conversa = semearEstado(tabelas, { nome: 'Maria Sensivel' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = clienteModeloEsgotadoPorTruncamento();

  let erro: unknown;
  try {
    await interpretarEAplicar(clienteModelo, clienteBanco, contexto(conversa.id, [mensagemSensivel]));
  } catch (e) {
    erro = e;
  }

  assert.ok(erro instanceof ErroClienteModeloOpenAI);
  const representacao = JSON.stringify(erro) + (erro as Error).message + (erro as ErroClienteModeloOpenAI).codigo;
  assert.ok(!representacao.includes(mensagemSensivel));
  assert.ok(!representacao.includes('Maria Sensivel'));
  assert.ok(!representacao.includes('12345678900'));
});

// Fabrica um corpo HTTP identico ao que a OpenAI Responses API devolveria --
// mesmo formato usado em cliente-modelo-openai.test.ts (respostaSucesso).
function corpoRespostaCompleta(alteracoesPortatil: unknown[], naturezaMensagem = 'pedido') {
  return {
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              natureza_mensagem: naturezaMensagem,
              alteracoes: alteracoesPortatil,
              eventos_candidatos: [],
              dentistas_candidatos: null,
            }),
          },
        ],
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function corpoRespostaTruncada() {
  return { status: 'incomplete', output: [] };
}

test('INT-23: 1a tentativa truncada e 2a completa, DENTRO DE UM UNICO TURNO, usando o adaptador real -- mesmo snapshot, exatamente uma acao operacional aplicada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { procedimento_id: 'limpeza' });
  const clienteBanco = new ClienteFalso(tabelas);

  // fetch fake de duas respostas: a 1a truncada (o adaptador real repete
  // sozinho, internamente -- CATEGORIAS_REPETIVEIS inclui resposta_truncada
  // desde a mudanca de 24/08/2026), a 2a completa com a alteracao real.
  let chamadasFetch = 0;
  const fetchFalso = (async () => {
    chamadasFetch++;
    const corpo = chamadasFetch === 1 ? corpoRespostaTruncada() : corpoRespostaCompleta([
      { campo: 'data_texto', acao: 'informar', valor: 'sexta' },
    ]);
    return new Response(JSON.stringify(corpo), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  // ADAPTADOR REAL (nao ClienteModeloFalso): a mesma funcao que roda em
  // producao, com fetch injetado. interpretarEAplicar recebe exatamente o
  // que o Core recebe hoje -- a repeticao acontece TODA dentro desta unica
  // chamada a interpretarEAplicar, nunca em um segundo turno/reenvio.
  const clienteModeloReal = criarClienteModeloOpenAI({
    chaveApi: 'chave-de-teste',
    modelo: MODELO_IRIS_NOVA,
    fetch: fetchFalso,
    timeoutPorTentativaMs: 2000,
    prazoTotalMs: 5000,
    esperaEntreTentativasMs: 5,
  } as never);

  const resultado = await interpretarEAplicar(
    clienteModeloReal,
    clienteBanco,
    contexto(conversa.id, ['pode remarcar pra sexta'])
  );

  assert.equal(chamadasFetch, 2, 'uma unica repeticao interna do adaptador, nunca uma terceira chamada');

  // o snapshot que chegou ao modelo (em QUALQUER das duas tentativas) e o
  // oficial lido do banco no INICIO do turno -- nunca um estado parcial.
  assert.equal(resultado.aplicacao?.dados.procedimento_id, 'limpeza', 'partiu do snapshot oficial');
  assert.equal(resultado.aplicacao?.dados.data_texto, 'sexta', 'so a saida da 2a tentativa (completa) foi aceita');

  // exatamente uma acao operacional aplicada nesta unica chamada ao turno --
  // sem duplicidade, sem um segundo update por causa da tentativa truncada.
  assert.equal(clienteBanco.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 1);
  assert.equal(comoRegistro(tabelas.estado_conversa[0].dados).data_texto, 'sexta');
});
