import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ehDecisaoConversacional, reivindicarRoteamentoMensagemMista } from './pos-consulta-processar-mensagem-mista.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import { ClienteClassificadorPosConsultaFalso } from './teste-cliente-classificador-pos-consulta-falso.ts';

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

test('ehDecisaoConversacional -- as quatro decisoes conversacionais, e nada mais', () => {
  assert.equal(ehDecisaoConversacional('saudacao'), true);
  assert.equal(ehDecisaoConversacional('duvida_livre'), true);
  assert.equal(ehDecisaoConversacional('mensagem_nao_compreendida'), true);
  assert.equal(ehDecisaoConversacional('desistencia'), true);
  assert.equal(ehDecisaoConversacional('aguardando_procedimento'), false);
  assert.equal(ehDecisaoConversacional('horarios_disponiveis'), false);
  assert.equal(ehDecisaoConversacional('reserva_criada'), false);
});

test('sem pedido operacional (saudacao): roteia para o redator PROPRIO de pos-consulta', async () => {
  const rpc = rpcPendente('positiva', true);
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  const resultado = await reivindicarRoteamentoMensagemMista(rpc, classificador, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
    mensagemPaciente: 'oi, tudo bem?',
    decisaoPrincipalTipo: 'saudacao',
    linkAvaliacaoGoogle: LINK,
  });
  assert.equal(resultado.tipo, 'roteada');
  if (resultado.tipo === 'roteada') {
    assert.deepEqual(resultado.roteamento, { tipo: 'usar_redator_pos_consulta', classificacao: 'positiva', linkAvaliacaoGoogle: LINK });
  }
});

test('COM pedido operacional (ex.: aguardando_procedimento): roteia para o redator PRINCIPAL, nunca engole o pedido', async () => {
  const rpc = rpcPendente('positiva', true);
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  const resultado = await reivindicarRoteamentoMensagemMista(rpc, classificador, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
    mensagemPaciente: 'foi otimo, quero marcar uma limpeza',
    decisaoPrincipalTipo: 'aguardando_procedimento',
    linkAvaliacaoGoogle: LINK,
  });
  assert.equal(resultado.tipo, 'roteada');
  if (resultado.tipo === 'roteada') {
    assert.deepEqual(resultado.roteamento, { tipo: 'usar_redator_principal', classificacao: 'positiva', linkAvaliacaoGoogle: LINK });
  }
});

test('redator principal com convite NAO autorizado (classificacao negativa): nunca inclui link', async () => {
  const rpc = rpcPendente('nao_positiva', false);
  const classificador = new ClienteClassificadorPosConsultaFalso('nao_positiva');
  const resultado = await reivindicarRoteamentoMensagemMista(rpc, classificador, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
    mensagemPaciente: 'nao gostei, mas quero marcar outra coisa',
    decisaoPrincipalTipo: 'aguardando_procedimento',
    linkAvaliacaoGoogle: LINK,
  });
  assert.equal(resultado.tipo, 'roteada');
  if (resultado.tipo === 'roteada') {
    assert.deepEqual(resultado.roteamento, { tipo: 'usar_redator_principal', classificacao: 'nao_positiva' });
  }
});

test('modo satisfacao (nunca convida) com pedido operacional: redator principal, sem link mesmo com classificacao positiva', async () => {
  const rpc = rpcPendente('positiva', false); // registrar-resposta-pendente ja decide convite_pendente=false para modo satisfacao
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  const resultado = await reivindicarRoteamentoMensagemMista(rpc, classificador, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'satisfacao' },
    mensagemPaciente: 'foi otimo, quero marcar outra consulta',
    decisaoPrincipalTipo: 'aguardando_procedimento',
    linkAvaliacaoGoogle: LINK,
  });
  assert.equal(resultado.tipo, 'roteada');
  if (resultado.tipo === 'roteada') {
    assert.deepEqual(resultado.roteamento, { tipo: 'usar_redator_principal', classificacao: 'positiva' });
  }
});

test('desfechos nao-pendentes (em_andamento, ja_processada, etc.) atravessam sem roteamento', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: { data: { resultado: 'ja_processada' }, error: null },
  });
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  const resultado = await reivindicarRoteamentoMensagemMista(rpc, classificador, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
    mensagemPaciente: 'foi otimo',
    decisaoPrincipalTipo: 'saudacao',
  });
  assert.deepEqual(resultado, { tipo: 'ja_processada' });
});

// C1 (terceira revisao) -- este modulo NUNCA confirma entrega. A prova
// positiva disso: 'roteada' sempre devolve entregaId/claimToken para o
// CHAMADOR usar depois do envio real, e nenhuma funcao de confirmacao
// existe mais neste arquivo (confirmarRoteamentoMensagemMista foi removida).
test('C1 -- "roteada" sempre devolve entregaId/claimToken, nunca confirma nada sozinha', async () => {
  const rpc = rpcPendente('positiva', true);
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  const resultado = await reivindicarRoteamentoMensagemMista(rpc, classificador, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
    mensagemPaciente: 'foi otimo, quero marcar outra coisa',
    decisaoPrincipalTipo: 'aguardando_procedimento',
    linkAvaliacaoGoogle: LINK,
  });
  assert.equal(resultado.tipo, 'roteada');
  if (resultado.tipo === 'roteada') {
    assert.equal(resultado.entregaId, ENTREGA_ID);
    assert.equal(resultado.claimToken, TOKEN);
  }
  // Nenhuma chamada de confirmar_entrega foi feita -- so a de registrar
  // resposta pendente.
  assert.equal(rpc.chamadas.length, 1);
  assert.equal(rpc.chamadas[0]!.nome, 'cappia_pos_consulta_registrar_resposta_pendente');
});
