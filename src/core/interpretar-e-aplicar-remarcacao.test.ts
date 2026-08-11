// Gates de remarcacao dentro de interpretarEAplicar (specs/remarcacao-
// conversacional-v1.md): validacao de `agendamento_id` contra a lista
// oficialmente oferecida, e limpeza de `confirmacao` ao ENTRAR em
// remarcacao. Arquivo separado de interpretar-e-aplicar.test.ts pelo mesmo
// criterio ja usado no restante do projeto: cenario proprio, sem misturar
// com os testes gerais de aplicacao de dados.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpretarEAplicar } from './interpretar-e-aplicar.ts';
import type { ClienteModeloEstruturado } from './interpretacao-tipos.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';

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

function contexto(conversaId: string, mensagensAtuais: string[], overrides: Record<string, unknown> = {}) {
  return {
    conversa_id: conversaId,
    clinica_id: CLINICA_ID,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: mensagensAtuais,
    ...overrides,
  };
}

/** Devolve exatamente a resposta configurada, ignorando o payload recebido. */
function clienteModeloComResposta(resposta: unknown): ClienteModeloEstruturado {
  return { async executar() { return resposta; } };
}

const AG_1 = crypto.randomUUID();
const AG_2 = crypto.randomUUID();
const AGENDAMENTOS_ATIVOS = [
  { agendamento_id: AG_1, descricao: 'Limpeza com Dra. Ana em 15/08 às 14:00' },
  { agendamento_id: AG_2, descricao: 'Canal com Dr. Bruno em 23/08 às 09:00' },
];

function respostaComAgendamentoId(id: string) {
  return {
    natureza_mensagem: 'resposta',
    alteracoes: { agendamento_id: { acao: 'informar', valor: id } },
    eventos_candidatos: [],
    dentistas_candidatos: null,
  };
}

test('agendamento_id DENTRO da lista oferecida: persistido em dados', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { intencao: 'remarcacao' });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await interpretarEAplicar(
    clienteModeloComResposta(respostaComAgendamentoId(AG_2)),
    cliente,
    contexto(conversa.id, ['o segundo'], { agendamentos_ativos: AGENDAMENTOS_ATIVOS })
  );

  assert.equal(resultado.alteracoes_aplicaveis.agendamento_id?.valor, AG_2);
  assert.equal(resultado.aplicacao?.dados.agendamento_id, AG_2);
});

test('agendamento_id FORA da lista oferecida: descartado, nunca persistido', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { intencao: 'remarcacao' });
  const cliente = new ClienteFalso(tabelas);

  const idInventado = crypto.randomUUID();
  const resultado = await interpretarEAplicar(
    clienteModeloComResposta(respostaComAgendamentoId(idInventado)),
    cliente,
    contexto(conversa.id, ['o terceiro'], { agendamentos_ativos: AGENDAMENTOS_ATIVOS })
  );

  assert.equal(resultado.alteracoes_aplicaveis.agendamento_id, undefined);
  assert.equal(resultado.aplicacao, null);
});

test('agendamento_id emitido SEM agendamentos_ativos no payload: descartado (nunca havia pergunta pendente)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { intencao: 'remarcacao' });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await interpretarEAplicar(
    clienteModeloComResposta(respostaComAgendamentoId(AG_1)),
    cliente,
    contexto(conversa.id, ['quero o primeiro']) // sem agendamentos_ativos
  );

  assert.equal(resultado.alteracoes_aplicaveis.agendamento_id, undefined);
  assert.equal(resultado.aplicacao, null);
});

// PAR A/B OBRIGATORIO: mesma entrada (mesmo id emitido), variando SO a
// presenca/ausencia do id na lista oferecida -- os dois lados PRECISAM
// diferir, senao o gate nao tem efeito nenhum.
test('par A/B do gate de escolha: mesmo id, dentro vs fora da lista, resultados diferentes', async () => {
  const idAlvo = crypto.randomUUID();

  const tabelasDentro = criarTabelasFalsasVazias();
  const conversaDentro = semearEstado(tabelasDentro, { intencao: 'remarcacao' });
  const resultadoDentro = await interpretarEAplicar(
    clienteModeloComResposta(respostaComAgendamentoId(idAlvo)),
    new ClienteFalso(tabelasDentro),
    contexto(conversaDentro.id, ['esse mesmo'], {
      agendamentos_ativos: [{ agendamento_id: idAlvo, descricao: 'Limpeza em 20/08 às 10:00' }],
    })
  );

  const tabelasFora = criarTabelasFalsasVazias();
  const conversaFora = semearEstado(tabelasFora, { intencao: 'remarcacao' });
  const resultadoFora = await interpretarEAplicar(
    clienteModeloComResposta(respostaComAgendamentoId(idAlvo)),
    new ClienteFalso(tabelasFora),
    contexto(conversaFora.id, ['esse mesmo'], { agendamentos_ativos: AGENDAMENTOS_ATIVOS }) // idAlvo nao esta aqui
  );

  assert.equal(resultadoDentro.alteracoes_aplicaveis.agendamento_id?.valor, idAlvo);
  assert.equal(resultadoFora.alteracoes_aplicaveis.agendamento_id, undefined);
  assert.notDeepEqual(resultadoDentro.aplicacao?.dados, resultadoFora.aplicacao?.dados);
});

// --- Limpeza de confirmacao ao ENTRAR em remarcacao ---

function respostaEntrandoEmRemarcacaoComConfirmacao() {
  return {
    natureza_mensagem: 'pedido',
    alteracoes: {
      intencao: { acao: 'informar', valor: 'remarcacao' },
      confirmacao: { acao: 'informar', valor: 'sim' },
    },
    eventos_candidatos: [],
    dentistas_candidatos: null,
  };
}

test('confirmacao emitida NO MESMO turno em que intencao=remarcacao nasce: removida (forcado)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  // snapshot SEM intencao ainda -- esta mensagem e a transicao.
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  const resultado = await interpretarEAplicar(
    clienteModeloComResposta(respostaEntrandoEmRemarcacaoComConfirmacao()),
    cliente,
    contexto(conversa.id, ['preciso remarcar, pode confirmar'])
  );

  assert.equal(resultado.alteracoes_aplicaveis.intencao?.valor, 'remarcacao');
  // A alteracao aplicavel para confirmacao vira 'remover' (forcado pelo
  // gate) -- nunca 'undefined': e uma remocao explicita, nao uma ausencia.
  assert.equal(resultado.alteracoes_aplicaveis.confirmacao?.acao, 'remover');
  assert.equal('confirmacao' in (resultado.aplicacao?.dados ?? {}), false);
});

test('confirmacao remanescente do snapshot (nao emitida agora) some ao ENTRAR em remarcacao', async () => {
  const tabelas = criarTabelasFalsasVazias();
  // snapshot com confirmacao='sim' de um fluxo anterior, intencao ainda ausente.
  const conversa = semearEstado(tabelas, { confirmacao: 'sim' });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await interpretarEAplicar(
    clienteModeloComResposta({
      natureza_mensagem: 'pedido',
      alteracoes: { intencao: { acao: 'informar', valor: 'remarcacao' } },
      eventos_candidatos: [],
      dentistas_candidatos: null,
    }),
    cliente,
    contexto(conversa.id, ['preciso remarcar minha consulta'])
  );

  assert.equal('confirmacao' in (resultado.aplicacao?.dados ?? {}), false);
});

test('intencao JA ERA remarcacao (nao e transicao): confirmacao normal do turno sobrevive intacta', async () => {
  const tabelas = criarTabelasFalsasVazias();
  // snapshot JA com intencao=remarcacao -- este turno so confirma o horario proposto.
  const conversa = semearEstado(tabelas, { intencao: 'remarcacao', data_texto: 'hoje', horario_texto: '10:00' });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await interpretarEAplicar(
    clienteModeloComResposta({
      natureza_mensagem: 'resposta',
      alteracoes: { confirmacao: { acao: 'informar', valor: 'sim' } },
      eventos_candidatos: [],
      dentistas_candidatos: null,
    }),
    cliente,
    contexto(conversa.id, ['isso, pode confirmar'], { proposta_pendente: { data: '10/08', horario: '10:00' } })
  );

  assert.equal(resultado.alteracoes_aplicaveis.confirmacao?.valor, 'sim');
  assert.equal(resultado.aplicacao?.dados.confirmacao, 'sim');
});

// PAR A/B OBRIGATORIO: mesma mensagem entrando em remarcacao com confirmacao
// no mesmo turno, variando SO se o snapshot ja tinha intencao=remarcacao
// antes -- os dois lados PRECISAM diferir.
test('par A/B da limpeza de confirmacao: snapshot sem vs com intencao=remarcacao previa', async () => {
  const tabelasEntrando = criarTabelasFalsasVazias();
  const conversaEntrando = semearEstado(tabelasEntrando, {}); // AINDA nao era remarcacao
  const resultadoEntrando = await interpretarEAplicar(
    clienteModeloComResposta(respostaEntrandoEmRemarcacaoComConfirmacao()),
    new ClienteFalso(tabelasEntrando),
    contexto(conversaEntrando.id, ['preciso remarcar, confirma'])
  );

  const tabelasJaDentro = criarTabelasFalsasVazias();
  const conversaJaDentro = semearEstado(tabelasJaDentro, { intencao: 'remarcacao' }); // JA era remarcacao
  const resultadoJaDentro = await interpretarEAplicar(
    clienteModeloComResposta(respostaEntrandoEmRemarcacaoComConfirmacao()),
    new ClienteFalso(tabelasJaDentro),
    contexto(conversaJaDentro.id, ['preciso remarcar, confirma'])
  );

  // Lado A (entrando agora): confirmacao vira remocao FORCADA -- nunca
  // sobrevive como 'sim'. Lado B (ja dentro): confirmacao segue como o
  // paciente emitiu, 'sim'. Os dois PRECISAM diferir.
  assert.equal(resultadoEntrando.alteracoes_aplicaveis.confirmacao?.acao, 'remover');
  assert.equal(resultadoJaDentro.alteracoes_aplicaveis.confirmacao?.valor, 'sim');
  assert.equal('confirmacao' in (resultadoEntrando.aplicacao?.dados ?? {}), false);
  assert.equal(resultadoJaDentro.aplicacao?.dados.confirmacao, 'sim');
  assert.notDeepEqual(resultadoEntrando.aplicacao?.dados, resultadoJaDentro.aplicacao?.dados);
});
