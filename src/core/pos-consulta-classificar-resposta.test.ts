import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classificarRespostaPosConsulta } from './pos-consulta-classificar-resposta.ts';
import {
  ClienteClassificadorPosConsultaFalso,
  ClienteClassificadorPosConsultaFalhoFalso,
} from './teste-cliente-classificador-pos-consulta-falso.ts';

test('cliente ausente (null) degrada para incerta, nunca lanca', async () => {
  const resultado = await classificarRespostaPosConsulta(null, { mensagemPaciente: 'foi otimo, adorei' });
  assert.equal(resultado, 'incerta');
});

test('falha do cliente (rede/timeout/parse) degrada para incerta, nunca propaga excecao', async () => {
  const resultado = await classificarRespostaPosConsulta(new ClienteClassificadorPosConsultaFalhoFalso(), {
    mensagemPaciente: 'qualquer coisa',
  });
  assert.equal(resultado, 'incerta');
});

test('classificacao positiva do cliente atravessa sem alteracao', async () => {
  const resultado = await classificarRespostaPosConsulta(new ClienteClassificadorPosConsultaFalso('positiva'), {
    mensagemPaciente: 'adorei, super recomendo',
  });
  assert.equal(resultado, 'positiva');
});

test('classificacao nao_positiva do cliente atravessa sem alteracao', async () => {
  const resultado = await classificarRespostaPosConsulta(new ClienteClassificadorPosConsultaFalso('nao_positiva'), {
    mensagemPaciente: 'nao gostei, demorou muito',
  });
  assert.equal(resultado, 'nao_positiva');
});

test('cliente recebe a mensagem do paciente', async () => {
  const cliente = new ClienteClassificadorPosConsultaFalso('incerta');
  await classificarRespostaPosConsulta(cliente, { mensagemPaciente: 'tudo bem, e voces fazem clareamento?' });
  assert.equal(cliente.chamadas.length, 1);
  assert.equal(cliente.chamadas[0]!.mensagemPaciente, 'tudo bem, e voces fazem clareamento?');
});
