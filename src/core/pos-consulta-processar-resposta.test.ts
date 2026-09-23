import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarRespostaPosConsulta } from './pos-consulta-processar-resposta.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import { ClienteClassificadorPosConsultaFalso } from './teste-cliente-classificador-pos-consulta-falso.ts';
import { ClienteRedatorPosConsultaFalso } from './teste-cliente-redator-pos-consulta-falso.ts';
import { EntradaInvalidaError } from './erros.ts';

const CLINICA = '11111111-1111-1111-1111-111111111111';
const AGENDAMENTO = '22222222-2222-2222-2222-222222222222';
const TOKEN = '33333333-3333-3333-3333-333333333333';
const ENTREGA_ID = '44444444-4444-4444-4444-444444444444';
const LINK = 'https://g.page/r/exemplo/review';

function rpcPendente(classificacao: 'positiva' | 'nao_positiva' | 'incerta', convitePendente: boolean) {
  return new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: {
      data: { resultado: 'pendente', entrega_id: ENTREGA_ID, claim_token: TOKEN, classificacao, convite_pendente: convitePendente },
      error: null,
    },
  });
}

test('criterio 4 -- modo ambos com resposta positiva reserva convite com o link', async () => {
  const rpc = rpcPendente('positiva', true);
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  const redator = new ClienteRedatorPosConsultaFalso(`Que otimo! Avalie aqui: ${LINK}`);

  const resultado = await processarRespostaPosConsulta(rpc, classificador, redator, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
    mensagemPaciente: 'foi otimo, adorei',
    contexto: { linkAvaliacaoGoogle: LINK },
  });

  assert.equal(resultado.tipo, 'entrega_pendente');
  if (resultado.tipo === 'entrega_pendente') {
    assert.ok(resultado.resposta.includes(LINK));
    assert.deepEqual(resultado.confirmacao, { agendamentoId: AGENDAMENTO, entregaId: ENTREGA_ID, claimToken: TOKEN });
  }
  assert.equal(rpc.chamadas[0]!.parametros.p_convite_pendente, true);
  assert.equal(rpc.chamadas[0]!.parametros.p_classificacao, 'positiva');
});

test('criterio 5 -- modo ambos com resposta negativa nunca envia link', async () => {
  const rpc = rpcPendente('nao_positiva', false);
  const classificador = new ClienteClassificadorPosConsultaFalso('nao_positiva');
  const redator = new ClienteRedatorPosConsultaFalso('Obrigado pelo retorno!');

  const resultado = await processarRespostaPosConsulta(rpc, classificador, redator, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
    mensagemPaciente: 'nao gostei, demorou muito',
    contexto: { linkAvaliacaoGoogle: LINK },
  });

  assert.equal(resultado.tipo, 'entrega_pendente');
  if (resultado.tipo === 'entrega_pendente') assert.ok(!resultado.resposta.includes(LINK));
});

test('B2 -- reclaim: RPC devolve classificacao/convite EFETIVOS diferentes do proposto, e a redacao usa o efetivo', async () => {
  // O classificador (fresco) diz 'positiva', mas a RPC (reclaim de uma
  // tentativa anterior) devolve o que ja estava GRAVADO: 'nao_positiva',
  // sem convite. A decisao final tem que seguir o EFETIVO, nunca o fresco.
  const rpc = rpcPendente('nao_positiva', false);
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  const redator = new ClienteRedatorPosConsultaFalso('Obrigado pelo retorno!');

  const resultado = await processarRespostaPosConsulta(rpc, classificador, redator, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
    mensagemPaciente: 'foi otimo',
    contexto: { linkAvaliacaoGoogle: LINK },
  });

  assert.equal(resultado.tipo, 'entrega_pendente');
  if (resultado.tipo === 'entrega_pendente') assert.ok(!resultado.resposta.includes(LINK));
});

test('modo satisfacao com resposta positiva nunca envia link (mesmo assunto elogiado)', async () => {
  const rpc = rpcPendente('positiva', false);
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  const redator = new ClienteRedatorPosConsultaFalso('Que bom saber!');

  const resultado = await processarRespostaPosConsulta(rpc, classificador, redator, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'satisfacao' },
    mensagemPaciente: 'foi otimo',
    contexto: { linkAvaliacaoGoogle: LINK },
  });

  assert.equal(resultado.tipo, 'entrega_pendente');
  assert.equal(rpc.chamadas[0]!.parametros.p_convite_pendente, false);
});

test('em_andamento -- nao gera resposta', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: { data: { resultado: 'em_andamento' }, error: null },
  });
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  const redator = new ClienteRedatorPosConsultaFalso('nao deveria ser chamado');

  const resultado = await processarRespostaPosConsulta(rpc, classificador, redator, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
    mensagemPaciente: 'foi otimo',
    contexto: {},
  });

  assert.deepEqual(resultado, { tipo: 'em_andamento' });
  assert.equal(redator.chamadas.length, 0);
});

test('criterio 6 -- ja_processada (corrida perdida/replay) nunca produz segundo convite', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: { data: { resultado: 'ja_processada' }, error: null },
  });
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  const redator = new ClienteRedatorPosConsultaFalso('nao deveria ser chamado');

  const resultado = await processarRespostaPosConsulta(rpc, classificador, redator, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
    mensagemPaciente: 'foi otimo',
    contexto: { linkAvaliacaoGoogle: LINK },
  });

  assert.deepEqual(resultado, { tipo: 'ja_processada' });
  assert.equal(redator.chamadas.length, 0);
});

test('jornada_nao_encontrada e tratado como nada a fazer, nunca como erro do turno', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: { data: { resultado: 'jornada_nao_encontrada' }, error: null },
  });
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  const redator = new ClienteRedatorPosConsultaFalso('nao deveria ser chamado');

  const resultado = await processarRespostaPosConsulta(rpc, classificador, redator, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
    mensagemPaciente: 'foi otimo',
    contexto: {},
  });

  assert.deepEqual(resultado, { tipo: 'jornada_nao_encontrada' });
  assert.equal(redator.chamadas.length, 0);
});

test('jornada_nao_aguarda_resposta e tratado explicitamente, nunca gera mensagem', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: { data: { resultado: 'jornada_nao_aguarda_resposta' }, error: null },
  });
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  const redator = new ClienteRedatorPosConsultaFalso('nao deveria ser chamado');

  const resultado = await processarRespostaPosConsulta(rpc, classificador, redator, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
    mensagemPaciente: 'foi otimo',
    contexto: {},
  });

  assert.deepEqual(resultado, { tipo: 'jornada_nao_aguarda_resposta' });
  assert.equal(redator.chamadas.length, 0);
});

test('mensagem vazia nunca chega a classificar nem a chamar a RPC', async () => {
  const rpc = rpcPendente('positiva', true);
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  await assert.rejects(
    () =>
      processarRespostaPosConsulta(rpc, classificador, null, {
        clinicaId: CLINICA,
        jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
        mensagemPaciente: '   ',
        contexto: {},
      }),
    EntradaInvalidaError
  );
  assert.equal(rpc.chamadas.length, 0);
});
