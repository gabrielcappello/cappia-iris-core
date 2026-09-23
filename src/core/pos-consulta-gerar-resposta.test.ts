import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gerarRespostaPosConsulta } from './pos-consulta-gerar-resposta.ts';
import {
  ClienteRedatorPosConsultaFalso,
  ClienteRedatorPosConsultaFalhoFalso,
} from './teste-cliente-redator-pos-consulta-falso.ts';

const LINK = 'https://g.page/r/exemplo/review';

test('cliente ausente (null) usa o fallback deterministico', async () => {
  const resultado = await gerarRespostaPosConsulta(null, {
    decisao: { tipo: 'perguntar_satisfacao' },
    contexto: {},
  });
  assert.equal(resultado.motivo_fallback, 'redator_nao_configurado');
  assert.ok(resultado.resposta.trim().length > 0);
});

test('redacao bem-sucedida e aprovada pela guarda atravessa sem fallback', async () => {
  const cliente = new ClienteRedatorPosConsultaFalso('Oi! Como foi sua consulta de limpeza?');
  const resultado = await gerarRespostaPosConsulta(cliente, {
    decisao: { tipo: 'perguntar_satisfacao' },
    contexto: { atendimento: { procedimentoNomeExibido: 'Limpeza' } },
  });
  assert.equal(resultado.motivo_fallback, null);
  assert.equal(resultado.resposta, 'Oi! Como foi sua consulta de limpeza?');
});

test('falha da redatora cai no fallback deterministico', async () => {
  const resultado = await gerarRespostaPosConsulta(new ClienteRedatorPosConsultaFalhoFalso(), {
    decisao: { tipo: 'perguntar_satisfacao' },
    contexto: {},
  });
  assert.equal(resultado.motivo_fallback, 'falha_redatora');
});

test('convite sem o link no texto redigido e reprovado pela guarda e cai no fallback (que sempre inclui o link)', async () => {
  const cliente = new ClienteRedatorPosConsultaFalso('Que bom saber! Muito obrigado.');
  const resultado = await gerarRespostaPosConsulta(cliente, {
    decisao: { tipo: 'agradecer_e_convidar_avaliacao_google' },
    contexto: { linkAvaliacaoGoogle: LINK },
  });
  assert.equal(resultado.motivo_fallback, 'link_ausente');
  assert.ok(resultado.resposta.includes(LINK));
});

test('convite com o link no texto redigido e aprovado, sem fallback', async () => {
  const cliente = new ClienteRedatorPosConsultaFalso(`Avalie a gente aqui: ${LINK}`);
  const resultado = await gerarRespostaPosConsulta(cliente, {
    decisao: { tipo: 'agradecer_e_convidar_avaliacao_google' },
    contexto: { linkAvaliacaoGoogle: LINK },
  });
  assert.equal(resultado.motivo_fallback, null);
  assert.ok(resultado.resposta.includes(LINK));
});

test('a mensagem do paciente chega ao redator quando presente (resposta a satisfacao)', async () => {
  const cliente = new ClienteRedatorPosConsultaFalso('Que otimo! Avalie aqui: ' + LINK);
  await gerarRespostaPosConsulta(cliente, {
    decisao: { tipo: 'agradecer_e_convidar_avaliacao_google' },
    mensagemPaciente: 'foi otimo, adorei o atendimento',
    contexto: { linkAvaliacaoGoogle: LINK },
  });
  assert.equal(cliente.chamadas.length, 1);
  assert.equal(cliente.chamadas[0]!.mensagemPaciente, 'foi otimo, adorei o atendimento');
});

test('a mensagem do paciente fica AUSENTE quando esta e a mensagem que abre a jornada', async () => {
  const cliente = new ClienteRedatorPosConsultaFalso('Oi! Como foi sua consulta?');
  await gerarRespostaPosConsulta(cliente, {
    decisao: { tipo: 'perguntar_satisfacao' },
    contexto: {},
  });
  assert.equal(cliente.chamadas.length, 1);
  assert.equal(cliente.chamadas[0]!.mensagemPaciente, undefined);
});
