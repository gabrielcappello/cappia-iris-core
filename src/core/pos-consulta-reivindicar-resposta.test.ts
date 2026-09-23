import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reivindicarRespostaPosConsulta } from './pos-consulta-reivindicar-resposta.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import { ClienteClassificadorPosConsultaFalso } from './teste-cliente-classificador-pos-consulta-falso.ts';
import { EntradaInvalidaError } from './erros.ts';

const CLINICA = '11111111-1111-1111-1111-111111111111';
const AGENDAMENTO = '22222222-2222-2222-2222-222222222222';
const TOKEN = '33333333-3333-3333-3333-333333333333';
const ENTREGA_ID = '44444444-4444-4444-4444-444444444444';

test('reivindica com sucesso e devolve os valores EFETIVOS da RPC (nunca a proposta local)', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: {
      data: { resultado: 'pendente', entrega_id: ENTREGA_ID, claim_token: TOKEN, classificacao: 'nao_positiva', convite_pendente: false },
      error: null,
    },
  });
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva'); // proposta local diverge do efetivo
  const resultado = await reivindicarRespostaPosConsulta(rpc, classificador, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
    mensagemPaciente: 'foi otimo',
  });
  assert.deepEqual(resultado, {
    tipo: 'pendente',
    classificacao: 'nao_positiva',
    convitePendente: false,
    entregaId: ENTREGA_ID,
    claimToken: TOKEN,
  });
});

test('desfechos nao-pendentes atravessam sem alteracao', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_registrar_resposta_pendente: { data: { resultado: 'ja_processada' }, error: null },
  });
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  const resultado = await reivindicarRespostaPosConsulta(rpc, classificador, {
    clinicaId: CLINICA,
    jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
    mensagemPaciente: 'foi otimo',
  });
  assert.deepEqual(resultado, { tipo: 'ja_processada' });
});

test('mensagem vazia nunca chega a classificar nem a chamar a RPC', async () => {
  const rpc = new ClienteRpcFalso({});
  const classificador = new ClienteClassificadorPosConsultaFalso('positiva');
  await assert.rejects(
    () =>
      reivindicarRespostaPosConsulta(rpc, classificador, {
        clinicaId: CLINICA,
        jornada: { agendamentoId: AGENDAMENTO, modo: 'ambos' },
        mensagemPaciente: '   ',
      }),
    EntradaInvalidaError
  );
  assert.equal(rpc.chamadas.length, 0);
});
