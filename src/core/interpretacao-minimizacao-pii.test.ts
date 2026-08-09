// Cenarios INT-11 e INT-12 de tests/cenarios-obrigatorios.md.
//
// Contrato canonico: specs/interpretacao-ia.md, "Entrada e PII".
//
// INT-11 -- nenhum valor cadastral oficial chega ao payload do modelo.
// INT-12 -- o payload informa apenas QUAIS campos cadastrais estao
//           preenchidos, sem revelar os valores.
//
// Todos os dados abaixo sao SINTETICOS. Nenhum valor real de paciente,
// nenhum secret e nenhum conteudo de .env aparece neste arquivo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarClienteModeloOpenAI, MODELO_GPT_4_1_MINI } from './cliente-modelo-openai.ts';
import { EntradaInvalidaError } from './erros.ts';
import {
  construirEntradaMinimizada,
  derivarCamposCadastraisPreenchidos,
  extrairAlteracoes,
} from './interpretacao-extrator.ts';
import { interpretarEAplicar } from './interpretar-e-aplicar.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso, ClienteModeloNuncaDeveSerChamado } from './teste-cliente-modelo-falso.ts';

const CLINICA_ID = crypto.randomUUID();
const TELEFONE_SINTETICO = '5511999999999';

// Valores sinteticos deliberadamente distintos entre si, para que a busca
// por vazamento no payload serializado nao produza falso negativo.
const NOME_SINTETICO = 'Zulmira Quaresma Bettencourt';
const CPF_SINTETICO = '52998224725';
const NASCIMENTO_SINTETICO = '1974-03-19';
const EMAIL_SINTETICO = 'zulmira.bettencourt@exemplo-sintetico.test';

const SNAPSHOT_COM_CADASTRO_COMPLETO = {
  intencao: 'novo_agendamento',
  procedimento_id: 'cleaning',
  nome: NOME_SINTETICO,
  cpf: CPF_SINTETICO,
  data_nascimento: NASCIMENTO_SINTETICO,
  email: EMAIL_SINTETICO,
};

// Formas derivadas dos mesmos valores: se alguma camada tentasse
// "proteger" o dado por mascara, truncamento ou normalizacao em vez de
// simplesmente nao envia-lo, uma destas apareceria no payload.
const FORMAS_DERIVADAS_PROIBIDAS = [
  NOME_SINTETICO,
  NOME_SINTETICO.toLowerCase(),
  NOME_SINTETICO.split(' ')[0],
  'Zulmira',
  'Bettencourt',
  CPF_SINTETICO,
  '529.982.247-25',
  '529',
  '***.***.***-25',
  CPF_SINTETICO.slice(-4),
  NASCIMENTO_SINTETICO,
  '19/03/1974',
  '1974',
  EMAIL_SINTETICO,
  EMAIL_SINTETICO.split('@')[0],
  'exemplo-sintetico.test',
  TELEFONE_SINTETICO,
  TELEFONE_SINTETICO.slice(-4),
];

function semearEstado(tabelas: TabelasFalsas, dados: Record<string, unknown>) {
  const conversa = {
    id: crypto.randomUUID(),
    clinica_id: CLINICA_ID,
    telefone_normalizado: TELEFONE_SINTETICO,
    estado: 'atendimento',
    dados,
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  };
  tabelas.estado_conversa.push(conversa);
  return conversa;
}

// =====================================================================
// INT-11 -- ausencia de valores cadastrais no payload
// =====================================================================

test('INT-11: estado oficial com cadastro completo nao vaza nenhum valor para o payload do modelo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, SNAPSHOT_COM_CADASTRO_COMPLETO);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]);

  await interpretarEAplicar(clienteModelo, clienteBanco, {
    conversa_id: conversa.id,
    clinica_id: CLINICA_ID,
    telefone_normalizado: TELEFONE_SINTETICO,
    mensagens_atuais: ['quero remarcar para outro dia'],
  });

  assert.equal(clienteModelo.chamadas.length, 1);
  const payloadSerializado = JSON.stringify(clienteModelo.chamadas[0].payload);

  for (const forma of FORMAS_DERIVADAS_PROIBIDAS) {
    assert.ok(
      !payloadSerializado.includes(forma),
      'payload do modelo nao pode conter valor cadastral, nem forma derivada dele'
    );
  }
});

test('INT-11: nenhum objeto cadastral completo e transmitido -- dados_atuais so tem campos operacionais', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, SNAPSHOT_COM_CADASTRO_COMPLETO);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]);

  await interpretarEAplicar(clienteModelo, clienteBanco, {
    conversa_id: conversa.id,
    clinica_id: CLINICA_ID,
    telefone_normalizado: TELEFONE_SINTETICO,
    mensagens_atuais: ['oi'],
  });

  const { payload } = clienteModelo.chamadas[0];
  assert.deepEqual(payload.dados_atuais, {
    intencao: 'novo_agendamento',
    procedimento_id: 'cleaning',
  });
  for (const proibido of ['nome', 'cpf', 'data_nascimento', 'email', 'telefone']) {
    assert.ok(!(proibido in payload.dados_atuais), `dados_atuais nao pode conter '${proibido}'`);
  }
});

test('INT-11: a mensagem atual permanece presente e intacta no payload', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, SNAPSHOT_COM_CADASTRO_COMPLETO);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]);

  // O paciente pode digitar dados cadastrais no turno atual: isso e a
  // mensagem dele, nao um valor oficial reenviado como contexto.
  const mensagens = ['meu nome e Zulmira Quaresma Bettencourt', 'quero uma limpeza'];

  await interpretarEAplicar(clienteModelo, clienteBanco, {
    conversa_id: conversa.id,
    clinica_id: CLINICA_ID,
    telefone_normalizado: TELEFONE_SINTETICO,
    mensagens_atuais: mensagens,
  });

  assert.deepEqual(clienteModelo.chamadas[0].payload.mensagens_atuais, mensagens);
});

test('INT-11: valor informado na mensagem atual nao e recopiado do estado oficial para outro campo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, SNAPSHOT_COM_CADASTRO_COMPLETO);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]);

  await interpretarEAplicar(clienteModelo, clienteBanco, {
    conversa_id: conversa.id,
    clinica_id: CLINICA_ID,
    telefone_normalizado: TELEFONE_SINTETICO,
    mensagens_atuais: [`meu cpf e ${CPF_SINTETICO}`],
  });

  const { payload } = clienteModelo.chamadas[0];
  // O CPF aparece UMA unica vez, dentro de mensagens_atuais (o paciente
  // acabou de digita-lo). Nunca duplicado em dados_atuais nem em
  // campos_cadastrais_preenchidos.
  assert.ok(!JSON.stringify(payload.dados_atuais).includes(CPF_SINTETICO));
  assert.ok(!JSON.stringify(payload.campos_cadastrais_preenchidos).includes(CPF_SINTETICO));
});

test('INT-11: um campo cadastral em dados_atuais e rejeitado antes de chamar o modelo', async () => {
  const cliente = new ClienteModeloNuncaDeveSerChamado();

  await assert.rejects(
    () =>
      extrairAlteracoes(cliente, {
        mensagens_atuais: ['oi'],
        dados_atuais: { cpf: CPF_SINTETICO },
        campos_cadastrais_preenchidos: [],
      }),
    EntradaInvalidaError
  );
});

test('INT-11: erro de campo cadastral proibido nao reproduz o valor', async () => {
  const cliente = new ClienteModeloNuncaDeveSerChamado();

  let erroCapturado: unknown;
  try {
    await extrairAlteracoes(cliente, {
      mensagens_atuais: ['oi'],
      dados_atuais: { nome: NOME_SINTETICO },
      campos_cadastrais_preenchidos: [],
    });
  } catch (erro) {
    erroCapturado = erro;
  }

  assert.ok(erroCapturado instanceof EntradaInvalidaError);
  const representacao = JSON.stringify(erroCapturado) + (erroCapturado as Error).message;
  assert.ok(!representacao.includes(NOME_SINTETICO));
});

// =====================================================================
// INT-12 -- somente indicadores estruturais
// =====================================================================

test('INT-12: todos os campos cadastrais preenchidos', () => {
  const entrada = construirEntradaMinimizada(['oi'], SNAPSHOT_COM_CADASTRO_COMPLETO);

  assert.deepEqual(entrada.campos_cadastrais_preenchidos, ['nome', 'cpf', 'data_nascimento', 'email']);
  assert.ok(!JSON.stringify(entrada).includes(NOME_SINTETICO));
  assert.ok(!JSON.stringify(entrada).includes(CPF_SINTETICO));
});

test('INT-12: nenhum campo cadastral preenchido', () => {
  const entrada = construirEntradaMinimizada(['oi'], { procedimento_id: 'cleaning' });

  assert.deepEqual(entrada.campos_cadastrais_preenchidos, []);
  assert.deepEqual(entrada.dados_atuais, { procedimento_id: 'cleaning' });
});

test('INT-12: preenchimento parcial informa exatamente os presentes e omite os ausentes', () => {
  const entrada = construirEntradaMinimizada(['oi'], {
    nome: NOME_SINTETICO,
    email: EMAIL_SINTETICO,
  });

  assert.deepEqual(entrada.campos_cadastrais_preenchidos, ['nome', 'email']);
  assert.ok(!entrada.campos_cadastrais_preenchidos.includes('cpf'));
  assert.ok(!entrada.campos_cadastrais_preenchidos.includes('data_nascimento'));
});

test('INT-12: string vazia ou so espacos conta como ausente, nunca como preenchido', () => {
  const preenchidos = derivarCamposCadastraisPreenchidos({
    nome: '',
    cpf: '   ',
    data_nascimento: NASCIMENTO_SINTETICO,
  });

  assert.deepEqual(preenchidos, ['data_nascimento']);
});

test('INT-12: campo operacional vazio tambem e omitido de dados_atuais', () => {
  const entrada = construirEntradaMinimizada(['oi'], {
    procedimento_id: '  ',
    dentista_texto: 'Ana',
  });

  assert.deepEqual(entrada.dados_atuais, { dentista_texto: 'Ana' });
});

test('INT-12: a ordem dos indicadores e deterministica, independente da ordem do snapshot', () => {
  const primeira = derivarCamposCadastraisPreenchidos({
    email: EMAIL_SINTETICO,
    nome: NOME_SINTETICO,
    cpf: CPF_SINTETICO,
    data_nascimento: NASCIMENTO_SINTETICO,
  });
  const segunda = derivarCamposCadastraisPreenchidos(SNAPSHOT_COM_CADASTRO_COMPLETO);

  assert.deepEqual(primeira, segunda);
  assert.deepEqual(primeira, ['nome', 'cpf', 'data_nascimento', 'email']);
});

test('INT-12: propriedade extra na entrada e rejeitada antes de chamar o modelo', async () => {
  const cliente = new ClienteModeloNuncaDeveSerChamado();

  await assert.rejects(
    () =>
      extrairAlteracoes(cliente, {
        mensagens_atuais: ['oi'],
        dados_atuais: {},
        campos_cadastrais_preenchidos: [],
        paciente_id: crypto.randomUUID(),
      }),
    EntradaInvalidaError
  );
});

test('INT-12: campos_cadastrais_preenchidos ausente invalida a entrada', async () => {
  const cliente = new ClienteModeloNuncaDeveSerChamado();

  await assert.rejects(
    () => extrairAlteracoes(cliente, { mensagens_atuais: ['oi'], dados_atuais: {} }),
    EntradaInvalidaError
  );
});

test('INT-12: um VALOR cadastral dentro de campos_cadastrais_preenchidos e rejeitado', async () => {
  const cliente = new ClienteModeloNuncaDeveSerChamado();

  let erroCapturado: unknown;
  try {
    await extrairAlteracoes(cliente, {
      mensagens_atuais: ['oi'],
      dados_atuais: {},
      // tentativa de contrabandear o valor no lugar do nome do campo
      campos_cadastrais_preenchidos: [CPF_SINTETICO],
    });
  } catch (erro) {
    erroCapturado = erro;
  }

  assert.ok(erroCapturado instanceof EntradaInvalidaError);
  const representacao = JSON.stringify(erroCapturado) + (erroCapturado as Error).message;
  assert.ok(!representacao.includes(CPF_SINTETICO));
});

test('INT-12: campo repetido em campos_cadastrais_preenchidos e rejeitado', async () => {
  const cliente = new ClienteModeloNuncaDeveSerChamado();

  await assert.rejects(
    () =>
      extrairAlteracoes(cliente, {
        mensagens_atuais: ['oi'],
        dados_atuais: {},
        campos_cadastrais_preenchidos: ['nome', 'nome'],
      }),
    EntradaInvalidaError
  );
});

test('INT-12: indicadores derivados do estado oficial chegam corretos ao modelo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: NOME_SINTETICO, cpf: CPF_SINTETICO });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]);

  await interpretarEAplicar(clienteModelo, clienteBanco, {
    conversa_id: conversa.id,
    clinica_id: CLINICA_ID,
    telefone_normalizado: TELEFONE_SINTETICO,
    mensagens_atuais: ['oi'],
  });

  assert.deepEqual(clienteModelo.chamadas[0].payload.campos_cadastrais_preenchidos, ['nome', 'cpf']);
});

// =====================================================================
// INT-11 / INT-12 ponta a ponta: corpo HTTP realmente serializado
//
// Os testes acima param no objeto entregue ao ClienteModeloEstruturado.
// Os abaixo atravessam o adaptador OpenAI real, com fetch injetado, e
// inspecionam o body do request -- o que de fato sairia para o provedor.
// Nenhuma chamada de rede real ocorre.
// =====================================================================

function criarFetchCapturador() {
  const corpos: string[] = [];
  const fetchFalso = (async (_url: string, opcoes: RequestInit) => {
    corpos.push(opcoes.body as string);
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify({ natureza_mensagem: 'pedido', alteracoes: [] }) }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as unknown as typeof fetch;
  return { fetchFalso, corpos };
}

async function corpoHttpAposFluxoCompleto(dadosDoEstado: Record<string, unknown>, mensagens: string[]) {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, dadosDoEstado);
  const clienteBanco = new ClienteFalso(tabelas);
  const { fetchFalso, corpos } = criarFetchCapturador();

  // Timeouts folgados de proposito: o fetch falso resolve imediatamente,
  // entao nada aqui espera de verdade. Prazos curtos tornariam o teste
  // sensivel a carga da maquina, disparando retry do adaptador e medindo
  // tempo em vez de conteudo.
  const clienteModelo = criarClienteModeloOpenAI({
    chaveApi: 'chave-sintetica-de-teste',
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: 30000,
    prazoTotalMs: 60000,
    esperaEntreTentativasMs: 5,
    fetch: fetchFalso,
  } as never);

  await interpretarEAplicar(clienteModelo, clienteBanco, {
    conversa_id: conversa.id,
    clinica_id: CLINICA_ID,
    telefone_normalizado: TELEFONE_SINTETICO,
    mensagens_atuais: mensagens,
  });

  // Pelo menos uma requisicao; e, se o adaptador tiver repetido a
  // tentativa, TODAS precisam ser byte a byte identicas -- um retry nunca
  // pode reintroduzir conteudo diferente no corpo.
  assert.ok(corpos.length >= 1);
  for (const corpo of corpos) {
    assert.equal(corpo, corpos[0], 'retry nao pode alterar o corpo enviado');
  }
  const corpoBruto = corpos[0];
  const corpo = JSON.parse(corpoBruto);
  const mensagemUsuario = corpo.input.find((m: { role: string }) => m.role === 'user');
  return { corpoBruto, payloadHttp: JSON.parse(mensagemUsuario.content) };
}

test('INT-11 (HTTP): nenhum valor cadastral oficial aparece no corpo enviado ao provedor', async () => {
  const { corpoBruto } = await corpoHttpAposFluxoCompleto(SNAPSHOT_COM_CADASTRO_COMPLETO, ['quero remarcar']);

  for (const forma of FORMAS_DERIVADAS_PROIBIDAS) {
    assert.ok(!corpoBruto.includes(forma), 'corpo HTTP nao pode conter valor cadastral nem forma derivada');
  }
});

test('INT-11 (HTTP): dados_atuais serializado contem apenas campos operacionais', async () => {
  const { payloadHttp } = await corpoHttpAposFluxoCompleto(SNAPSHOT_COM_CADASTRO_COMPLETO, ['oi']);

  assert.deepEqual(payloadHttp.dados_atuais, {
    intencao: 'novo_agendamento',
    procedimento_id: 'cleaning',
  });
});

test('INT-11 (HTTP): mensagem atual permanece presente no corpo serializado', async () => {
  const mensagens = ['quero uma limpeza', 'de manha'];
  const { payloadHttp } = await corpoHttpAposFluxoCompleto(SNAPSHOT_COM_CADASTRO_COMPLETO, mensagens);

  assert.deepEqual(payloadHttp.mensagens_atuais, mensagens);
});

test('INT-12 (HTTP): corpo contem exatamente as tres chaves do contrato', async () => {
  const { payloadHttp } = await corpoHttpAposFluxoCompleto(SNAPSHOT_COM_CADASTRO_COMPLETO, ['oi']);

  assert.deepEqual(Object.keys(payloadHttp).sort(), [
    'campos_cadastrais_preenchidos',
    'dados_atuais',
    'mensagens_atuais',
  ]);
});

test('INT-12 (HTTP): todos os indicadores chegam ao corpo, na ordem canonica', async () => {
  const { payloadHttp } = await corpoHttpAposFluxoCompleto(SNAPSHOT_COM_CADASTRO_COMPLETO, ['oi']);

  assert.deepEqual(payloadHttp.campos_cadastrais_preenchidos, ['nome', 'cpf', 'data_nascimento', 'email']);
});

test('INT-12 (HTTP): nenhum campo preenchido produz array vazio no corpo', async () => {
  const { payloadHttp } = await corpoHttpAposFluxoCompleto({ procedimento_id: 'cleaning' }, ['oi']);

  assert.deepEqual(payloadHttp.campos_cadastrais_preenchidos, []);
});

test('INT-12 (HTTP): preenchimento parcial chega corretamente ao corpo', async () => {
  const { payloadHttp } = await corpoHttpAposFluxoCompleto(
    { nome: NOME_SINTETICO, email: EMAIL_SINTETICO },
    ['oi']
  );

  assert.deepEqual(payloadHttp.campos_cadastrais_preenchidos, ['nome', 'email']);
});
