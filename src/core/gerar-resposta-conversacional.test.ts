// Testes de gerar-resposta-conversacional.ts -- fallback determinístico em
// qualquer ponto de falha (specs/resposta-conversacional-v1.md secao 6) e
// historico conversacional recente (specs/historico-conversacional-v1.md).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gerarRespostaConversacional } from './gerar-resposta-conversacional.ts';
import { gerarRespostaPaciente } from './gerar-resposta-paciente.ts';
import { VALIDADE_HISTORICO_MS } from './historico-conversa.ts';
import type { ClienteModeloRedator, EntradaRedator } from './cliente-modelo-redator-openai.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';
import type { HistoricoConversa } from './tipos.ts';

const DECISAO_SAUDACAO: DecisaoOrquestrador = { tipo: 'saudacao' };

// Entrada base para os testes que nao se importam com naturezaMensagem/
// historicoConversa -- explicita em vez de omitida, seguindo a mesma regra
// que a propria redatora segue ("ausencia de fato nao e fato").
// `HOJE` deliberadamente distante das datas dos casos: a relacao fica
// 'outra' e a data sai absoluta, como sempre saiu. Os casos hoje/amanha tem
// testes proprios em fatos-autorizados.test.ts.
const HOJE = '2026-01-01';
const BASE = { naturezaMensagem: 'saudacao' as const, historicoConversa: null, dataHoje: HOJE };

function clienteQueRetorna(texto: string): ClienteModeloRedator {
  return { redigir: async () => texto };
}

function clienteQueFalha(): ClienteModeloRedator {
  return {
    redigir: async () => {
      throw new Error('falha sintetica de rede');
    },
  };
}

function clienteQueCaptura(): { cliente: ClienteModeloRedator; capturada: EntradaRedator[] } {
  const capturada: EntradaRedator[] = [];
  return {
    cliente: {
      redigir: async (entrada: EntradaRedator) => {
        capturada.push(entrada);
        return 'Olá! Como posso te ajudar hoje?';
      },
    },
    capturada,
  };
}

// --- Caminho normal: redacao aprovada ---

test('redacao aprovada pela guarda: usa o texto da IA, sem fallback', async () => {
  const resultado = await gerarRespostaConversacional(clienteQueRetorna('Oi! Tudo bem? Como posso ajudar?'), {
    decisao: DECISAO_SAUDACAO,
    mensagemPaciente: 'oi',
    ...BASE,
  });
  assert.equal(resultado.resposta, 'Oi! Tudo bem? Como posso ajudar?');
  assert.equal(resultado.motivo_fallback, null);
});

// --- redator nao configurado ---

test('clienteRedator null: usa o fallback deterministico direto, nunca tenta chamar nada', async () => {
  const resultado = await gerarRespostaConversacional(null, { decisao: DECISAO_SAUDACAO, mensagemPaciente: 'oi', ...BASE });
  assert.equal(resultado.resposta, gerarRespostaPaciente(DECISAO_SAUDACAO));
  assert.equal(resultado.motivo_fallback, 'redator_nao_configurado');
});

// --- falha da chamada (rede/timeout) ---

test('falha da redatora: cai no fallback deterministico do MESMO estado', async () => {
  const resultado = await gerarRespostaConversacional(clienteQueFalha(), {
    decisao: DECISAO_SAUDACAO,
    mensagemPaciente: 'oi',
    ...BASE,
  });
  assert.equal(resultado.resposta, gerarRespostaPaciente(DECISAO_SAUDACAO));
  assert.equal(resultado.motivo_fallback, 'falha_redatora');
});

// --- reprovacao pela guarda ---

test('guarda reprova (horario nao autorizado): cai no fallback do estado, nunca "problema tecnico" quando o estado nao e falha real', async () => {
  const decisao: DecisaoOrquestrador = {
    tipo: 'horarios_disponiveis',
      dentista_nome_exibido: 'Dra. Ana',
    procedimento_id: 'p1',
    dentista_id: 'd1',
    duracao_min: 40,
    resultado: {
      tipo: 'opcoes',
      opcoes: [
        {
          clinica_id: 'c1',
          procedimento_id: 'p1',
          dentista_id: 'd1',
          data: '2026-08-05',
          fuso: 'America/Sao_Paulo',
          duracao_min: 40,
          inicio_min: 540,
          fim_min: 580,
        },
      ],
    },
  };
  const resultado = await gerarRespostaConversacional(clienteQueRetorna('Tenho 15:00 disponível, que tal?'), {
    decisao,
    mensagemPaciente: 'quero limpeza hoje',
    ...BASE,
  });
  assert.equal(resultado.resposta, gerarRespostaPaciente(decisao));
  assert.equal(resultado.motivo_fallback, 'horario_nao_autorizado');
  assert.ok(!/problema t[eé]cnico/i.test(resultado.resposta), 'estado nao e falha tecnica -- fallback nao pode soar como uma');
});

test('guarda reprova texto vazio: cai no fallback', async () => {
  const resultado = await gerarRespostaConversacional(clienteQueRetorna('   '), {
    decisao: DECISAO_SAUDACAO,
    mensagemPaciente: 'oi',
    ...BASE,
  });
  assert.equal(resultado.motivo_fallback, 'texto_vazio');
});

// --- a Iris nunca fica calada ---

test('em qualquer cenario de falha, a resposta final e sempre uma string nao vazia', async () => {
  const cenarios: [ClienteModeloRedator | null, DecisaoOrquestrador][] = [
    [null, DECISAO_SAUDACAO],
    [clienteQueFalha(), DECISAO_SAUDACAO],
    [clienteQueRetorna(''), DECISAO_SAUDACAO],
    [clienteQueRetorna('já está marcado!'), DECISAO_SAUDACAO],
  ];
  for (const [cliente, decisao] of cenarios) {
    const resultado = await gerarRespostaConversacional(cliente, { decisao, mensagemPaciente: 'oi', ...BASE });
    assert.equal(typeof resultado.resposta, 'string');
    assert.ok(resultado.resposta.trim().length > 0);
  }
});

// --- o que chega ate a redatora ---

test('a redatora recebe a mensagem crua do paciente e os fatos derivados da decisao', async () => {
  const { cliente, capturada } = clienteQueCaptura();
  await gerarRespostaConversacional(cliente, { decisao: DECISAO_SAUDACAO, mensagemPaciente: 'oi tudo bem?', ...BASE });
  assert.equal(capturada.length, 1);
  assert.equal(capturada[0].mensagemPaciente, 'oi tudo bem?');
  assert.equal(capturada[0].fatos.objetivo, 'cumprimentar_e_oferecer_ajuda');
});

test('a redatora recebe natureza_mensagem repassada sem alteracao', async () => {
  const { cliente, capturada } = clienteQueCaptura();
  await gerarRespostaConversacional(cliente, {
    decisao: DECISAO_SAUDACAO,
    mensagemPaciente: 'oi',
    naturezaMensagem: 'duvida',
    historicoConversa: null,
    dataHoje: HOJE,
  });
  assert.equal(capturada[0].naturezaMensagem, 'duvida');
});

test('motivo_fallback nunca aparece dentro do texto da resposta (e so telemetria interna)', async () => {
  const resultado = await gerarRespostaConversacional(clienteQueFalha(), {
    decisao: DECISAO_SAUDACAO,
    mensagemPaciente: 'oi',
    ...BASE,
  });
  assert.ok(!resultado.resposta.includes('falha_redatora'));
});

// --- historico conversacional recente (specs/historico-conversacional-v1.md) ---

function historicoComIdade(idadeMs: number): HistoricoConversa {
  return [
    {
      mensagem_paciente: 'quero limpeza amanha',
      resposta_iris: 'Perfeito! Tenho 14:00 amanhã, confirmo?',
      gerada_em: new Date(Date.now() - idadeMs).toISOString(),
    },
  ];
}

test('historicoConversa null: nunca chega a EntradaRedator (campo ausente, nunca null)', async () => {
  const { cliente, capturada } = clienteQueCaptura();
  await gerarRespostaConversacional(cliente, { decisao: DECISAO_SAUDACAO, mensagemPaciente: 'oi', naturezaMensagem: 'saudacao', historicoConversa: null, dataHoje: HOJE });
  assert.equal('historicoRecente' in capturada[0], false);
});

test('historicoConversa dentro da janela de validade: chega intacta a EntradaRedator', async () => {
  const { cliente, capturada } = clienteQueCaptura();
  const historico = historicoComIdade(60 * 60 * 1000); // 1h atras
  await gerarRespostaConversacional(cliente, {
    decisao: DECISAO_SAUDACAO,
    mensagemPaciente: 'esse mesmo',
    naturezaMensagem: 'resposta',
    historicoConversa: historico,
    dataHoje: HOJE,
  });
  assert.deepEqual(capturada[0].historicoRecente, historico);
});

test('historicoConversa totalmente expirado (alem da janela de validade): omitido do payload, nunca enviado', async () => {
  const { cliente, capturada } = clienteQueCaptura();
  const historico = historicoComIdade(VALIDADE_HISTORICO_MS + 1000);
  await gerarRespostaConversacional(cliente, {
    decisao: DECISAO_SAUDACAO,
    mensagemPaciente: 'esse mesmo',
    naturezaMensagem: 'resposta',
    historicoConversa: historico,
    dataHoje: HOJE,
  });
  assert.equal('historicoRecente' in capturada[0], false);
});

test('historicoConversa exatamente no limite da janela ainda e enviado (fronteira inclusiva)', async () => {
  const { cliente, capturada } = clienteQueCaptura();
  const historico = historicoComIdade(VALIDADE_HISTORICO_MS);
  await gerarRespostaConversacional(cliente, {
    decisao: DECISAO_SAUDACAO,
    mensagemPaciente: 'esse mesmo',
    naturezaMensagem: 'resposta',
    historicoConversa: historico,
    dataHoje: HOJE,
  });
  assert.deepEqual(capturada[0].historicoRecente, historico);
});

test('historicoConversa com 3 pares dentro da janela e 2 expirados: so os 3 chegam a EntradaRedator, ordem preservada', async () => {
  const { cliente, capturada } = clienteQueCaptura();
  const antigos = [historicoComIdade(VALIDADE_HISTORICO_MS + 1000)[0], historicoComIdade(VALIDADE_HISTORICO_MS + 2000)[0]];
  const recentes = [
    { mensagem_paciente: 'a', resposta_iris: 'resp a', gerada_em: new Date(Date.now() - 3000).toISOString() },
    { mensagem_paciente: 'b', resposta_iris: 'resp b', gerada_em: new Date(Date.now() - 2000).toISOString() },
    { mensagem_paciente: 'c', resposta_iris: 'resp c', gerada_em: new Date(Date.now() - 1000).toISOString() },
  ];
  await gerarRespostaConversacional(cliente, {
    decisao: DECISAO_SAUDACAO,
    mensagemPaciente: 'oi',
    naturezaMensagem: 'resposta',
    historicoConversa: [...antigos, ...recentes],
    dataHoje: HOJE,
  });
  assert.deepEqual(capturada[0].historicoRecente, recentes);
});
