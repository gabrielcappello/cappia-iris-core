// Teste real do handler HTTP da Edge Function -- exercita tratarErroDoTurno,
// a MESMA funcao chamada dentro do Deno.serve() de producao (nao um dublê
// reescrito no teste), com um erro real de ErroClienteModeloOpenAI, e
// verifica a Response HTTP que sai dela: status e corpo, exatamente como o
// transporte (n8n) receberia. Nenhuma rede real, nenhum banco real -- so o
// handler de erro em si, que e onde o desfecho seguro (INT-21) e decidido.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ErroClienteModeloOpenAI, MODELO_GPT_4_1_MINI } from './cliente-modelo-openai.ts';
import { ClinicaNaoEncontradaError, EntradaInvalidaError } from './erros.ts';
import { tratarErroDoTurno } from './index.ts';

const MENSAGEM_FIXA_DETERMINISTICA =
  'Tive uma dificuldade para entender sua mensagem agora. Você pode repeti-la, por favor?';

test('INT-21 (HTTP): duas tentativas truncadas -- handler real devolve HTTP 200 com a mensagem fixa', async () => {
  const erro = new ErroClienteModeloOpenAI('resposta_truncada', 'resposta_incompleta', 2, 250, MODELO_GPT_4_1_MINI, 200);

  const resposta = tratarErroDoTurno(erro);

  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get('Content-Type'), 'application/json');
  const corpo = await resposta.json();
  assert.deepEqual(corpo, { resposta: MENSAGEM_FIXA_DETERMINISTICA });
});

test('INT-21 (HTTP): 1a tentativa truncada, 2a falha por timeout -- handler real ainda assim devolve HTTP 200 com a mensagem fixa', async () => {
  // categoriaPrimeiraTentativa preenchido pelo adaptador real quando a 2a
  // tentativa falha com categoria diferente da 1a (ver
  // cliente-modelo-openai.ts, executarComRetry) -- aqui construido
  // diretamente porque o handler so precisa do ERRO ja lancado, nunca chama
  // o adaptador.
  const erro = new ErroClienteModeloOpenAI(
    'timeout',
    'tempo_esgotado_na_tentativa',
    2,
    8000,
    MODELO_GPT_4_1_MINI,
    null,
    null,
    'resposta_truncada'
  );

  const resposta = tratarErroDoTurno(erro);

  assert.equal(resposta.status, 200);
  const corpo = await resposta.json();
  assert.deepEqual(corpo, { resposta: MENSAGEM_FIXA_DETERMINISTICA });
});

test('INT-21 (HTTP): erro de resposta_truncada isolado (1a tentativa, sem retry por orcamento insuficiente) tambem devolve HTTP 200', async () => {
  const erro = new ErroClienteModeloOpenAI('resposta_truncada', 'resposta_incompleta', 1, 90, MODELO_GPT_4_1_MINI, 200);

  const resposta = tratarErroDoTurno(erro);

  assert.equal(resposta.status, 200);
  const corpo = await resposta.json();
  assert.deepEqual(corpo, { resposta: MENSAGEM_FIXA_DETERMINISTICA });
});

test('HTTP: categoria diferente de resposta_truncada, sem sinalizacao de 1a tentativa truncada, continua caindo no erro_interno 500 (comportamento anterior preservado)', async () => {
  const erro = new ErroClienteModeloOpenAI('timeout', 'tempo_esgotado_na_tentativa', 2, 8000, MODELO_GPT_4_1_MINI);

  const resposta = tratarErroDoTurno(erro);

  assert.equal(resposta.status, 500);
  const corpo = await resposta.json();
  assert.deepEqual(corpo, { erro: 'erro_interno' });
});

test('HTTP: ClinicaNaoEncontradaError continua devolvendo 404 (nao afetado pela nova regra)', () => {
  const resposta = tratarErroDoTurno(new ClinicaNaoEncontradaError('evolution', 'instancia-teste'));
  assert.equal(resposta.status, 404);
});

test('HTTP: EntradaInvalidaError continua devolvendo 400 (nao afetado pela nova regra)', () => {
  const resposta = tratarErroDoTurno(new EntradaInvalidaError('campo_invalido', 'campo invalido'));
  assert.equal(resposta.status, 400);
});

test('INT-21 (HTTP): resposta de desfecho seguro nunca contem a categoria, o codigo ou qualquer campo interno do erro -- so a mensagem fixa', async () => {
  const erro = new ErroClienteModeloOpenAI('resposta_truncada', 'resposta_incompleta', 2, 250, MODELO_GPT_4_1_MINI, 200);

  const resposta = tratarErroDoTurno(erro);
  const textoCru = await resposta.text();

  assert.deepEqual(JSON.parse(textoCru), { resposta: MENSAGEM_FIXA_DETERMINISTICA });
  assert.ok(!textoCru.includes('resposta_truncada'));
  assert.ok(!textoCru.includes('resposta_incompleta'));
  assert.ok(!textoCru.includes('categoria'));
});
