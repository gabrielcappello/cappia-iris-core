import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarRecuperacaoPosConsulta } from './pos-consulta-processar-recuperacao.ts';
import { confirmarEntregaPosConsulta } from './pos-consulta-confirmar-entrega.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import { ClienteRedatorPosConsultaFalso } from './teste-cliente-redator-pos-consulta-falso.ts';

const CLINICA = '11111111-1111-1111-1111-111111111111';
const AGENDAMENTO = '22222222-2222-2222-2222-222222222222';
const PACIENTE = '33333333-3333-3333-3333-333333333333';
const TOKEN = '55555555-5555-5555-5555-555555555555';
const ENTREGA_ID = '66666666-6666-6666-6666-666666666666';
const LINK = 'https://g.page/r/exemplo/review';
const LINK_CONFIG_ATUAL = 'https://g.page/r/link-configurado-depois/review';

const ENTRADA = { clinicaId: CLINICA, agendamentoId: AGENDAMENTO, pacienteId: PACIENTE, telefoneNormalizado: '5511999999999', contexto: {} };
const rpcCom = (data: unknown) => new ClienteRpcFalso({ cappia_pos_consulta_recuperar_entrega: { data, error: null } });

const INICIAL = {
  resultado: 'pendente', etapa: 'aguardando_inicio', modo: 'ambos', entrega_id: ENTREGA_ID, claim_token: TOKEN,
  classificacao: null, convite_pendente: false, link_avaliacao_google: LINK, tentativa: 2,
};
const FINAL_COM_CONVITE = { ...INICIAL, etapa: 'finalizando', modo: 'google', classificacao: 'positiva', convite_pendente: true };
const FINAL_SEM_CONVITE = { ...INICIAL, etapa: 'finalizando', modo: 'ambos', classificacao: 'nao_positiva', convite_pendente: false };

test('aguardando_inicio recuperada: redige a PERGUNTA de satisfacao, sem link, com a confirmacao da MESMA entrega', async () => {
  const redator = new ClienteRedatorPosConsultaFalso('Oi! Como foi sua consulta?');
  const r = await processarRecuperacaoPosConsulta(rpcCom(INICIAL), redator, ENTRADA);
  assert.equal(r.tipo, 'entrega_pendente');
  if (r.tipo === 'entrega_pendente') {
    assert.equal(r.etapa, 'aguardando_inicio');
    assert.equal(r.resposta, 'Oi! Como foi sua consulta?');
    assert.deepEqual(r.confirmacao, { agendamentoId: AGENDAMENTO, entregaId: ENTREGA_ID, claimToken: TOKEN });
  }
  assert.equal(redator.chamadas[0]!.fatos.objetivo, 'perguntar_satisfacao');
  assert.equal(redator.chamadas[0]!.fatos.link_avaliacao_google, undefined, 'a primeira entrega nunca leva o link, mesmo com snapshot');
  assert.equal(redator.chamadas[0]!.mensagemPaciente, undefined);
});

test('finalizando recuperada COM convite: objetivo agradecer_e_convidar, link do SNAPSHOT (nunca o da config atual)', async () => {
  const redator = new ClienteRedatorPosConsultaFalso(`Que otimo! Avalie aqui: ${LINK}`);
  const r = await processarRecuperacaoPosConsulta(rpcCom(FINAL_COM_CONVITE), redator, {
    ...ENTRADA,
    contexto: { linkAvaliacaoGoogle: LINK_CONFIG_ATUAL, nomeClinica: 'Clinica Sorriso' },
  });
  assert.equal(r.tipo, 'entrega_pendente');
  assert.equal(redator.chamadas[0]!.fatos.objetivo, 'agradecer_e_convidar_avaliacao_google');
  assert.equal(redator.chamadas[0]!.fatos.link_avaliacao_google, LINK);
  assert.equal(redator.chamadas[0]!.fatos.nome_clinica, 'Clinica Sorriso', 'fatos cosmeticos atravessam');
  if (r.tipo === 'entrega_pendente') {
    assert.equal(r.etapa, 'finalizando');
    assert.equal(r.motivo_fallback, null);
    assert.ok(r.resposta.includes(LINK));
  }
});

test('finalizando recuperada SEM convite: objetivo agradecer_sem_convite, nunca link (mesmo com link no contexto e no snapshot)', async () => {
  const redator = new ClienteRedatorPosConsultaFalso(`Obrigado! Avalie aqui: ${LINK}`);
  const r = await processarRecuperacaoPosConsulta(rpcCom(FINAL_SEM_CONVITE), redator, { ...ENTRADA, contexto: { linkAvaliacaoGoogle: LINK } });
  assert.equal(redator.chamadas[0]!.fatos.objetivo, 'agradecer_sem_convite');
  assert.equal(redator.chamadas[0]!.fatos.link_avaliacao_google, undefined);
  // A redatora tentou incluir o link: a guarda barra e o fallback nao tem URL.
  assert.equal(r.tipo, 'entrega_pendente');
  if (r.tipo === 'entrega_pendente') {
    assert.equal(r.motivo_fallback, 'link_nao_autorizado');
    assert.ok(!r.resposta.includes(LINK));
  }
});

test('a decisao vem SEMPRE do que a jornada gravou: nada do contexto altera o objetivo', async () => {
  for (const [dados, objetivo] of [
    [INICIAL, 'perguntar_satisfacao'],
    [FINAL_COM_CONVITE, 'agradecer_e_convidar_avaliacao_google'],
    [FINAL_SEM_CONVITE, 'agradecer_sem_convite'],
  ] as const) {
    const redator = new ClienteRedatorPosConsultaFalso('texto');
    await processarRecuperacaoPosConsulta(rpcCom(dados), redator, { ...ENTRADA, contexto: { linkAvaliacaoGoogle: LINK_CONFIG_ATUAL, orientacoesClinica: 'seja informal' } });
    assert.equal(redator.chamadas[0]!.fatos.objetivo, objetivo);
    assert.equal(redator.chamadas[0]!.fatos.orientacoes_clinica, 'seja informal');
  }
});

test('sem redator configurado (null) usa o fallback deterministico -- e a recuperacao continua valida', async () => {
  const r = await processarRecuperacaoPosConsulta(rpcCom(FINAL_COM_CONVITE), null, ENTRADA);
  assert.equal(r.tipo, 'entrega_pendente');
  if (r.tipo === 'entrega_pendente') {
    assert.equal(r.motivo_fallback, 'redator_nao_configurado');
    assert.ok(r.resposta.includes(LINK), 'o fallback do convite inclui o link do snapshot');
  }
});

test('nenhum desfecho sem entrega chama o redator: em_andamento, nao_pendente, jornada_nao_encontrada, abandonada', async () => {
  const casos: [unknown, string][] = [
    [{ resultado: 'em_andamento' }, 'em_andamento'],
    [{ resultado: 'nao_pendente', etapa: 'encerrada' }, 'nao_pendente'],
    [{ resultado: 'jornada_nao_encontrada' }, 'jornada_nao_encontrada'],
    [{ resultado: 'abandonada', motivo: 'abandonada_tentativas', etapa_anterior: 'finalizando' }, 'abandonada'],
  ];
  for (const [data, tipo] of casos) {
    const redator = new ClienteRedatorPosConsultaFalso('nao deveria ser chamado');
    const r = await processarRecuperacaoPosConsulta(rpcCom(data), redator, ENTRADA);
    assert.equal(r.tipo, tipo);
    assert.equal(redator.chamadas.length, 0, tipo);
  }
});

test('abandonada devolve o motivo (a jornada foi encerrada SEM mensagem)', async () => {
  const r = await processarRecuperacaoPosConsulta(
    rpcCom({ resultado: 'abandonada', motivo: 'abandonada_janela', etapa_anterior: 'aguardando_inicio' }),
    null,
    ENTRADA
  );
  assert.deepEqual(r, { tipo: 'abandonada', motivo: 'abandonada_janela' });
});

test('B2 -- recuperar NAO confirma: a confirmacao e uma chamada SEPARADA, depois do envio', async () => {
  const rpc = new ClienteRpcFalso({
    cappia_pos_consulta_recuperar_entrega: { data: INICIAL, error: null },
    cappia_pos_consulta_confirmar_entrega: { data: { resultado: 'confirmada' }, error: null },
  });
  const r = await processarRecuperacaoPosConsulta(rpc, new ClienteRedatorPosConsultaFalso('Oi! Como foi?'), ENTRADA);
  assert.deepEqual(rpc.chamadas.map((c) => c.nome), ['cappia_pos_consulta_recuperar_entrega'], 'so a RPC de recuperar foi chamada');
  assert.equal(r.tipo, 'entrega_pendente');
  if (r.tipo === 'entrega_pendente') {
    const conf = await confirmarEntregaPosConsulta(rpc, { clinica_id: CLINICA, agendamento_id: r.confirmacao.agendamentoId, claim_token: r.confirmacao.claimToken });
    assert.equal(conf.tipo, 'confirmada');
  }
});
