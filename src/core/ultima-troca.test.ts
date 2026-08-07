// Testes de ultima-troca.ts (specs/memoria-conversacional-minima-v1.md).
// Nenhum acesso a rede ou banco real -- dublê em memoria apenas.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VALIDADE_ULTIMA_TROCA_MS, gravarUltimaTroca, ultimaTrocaValidaParaEnvio, validarUltimaTroca } from './ultima-troca.ts';
import type { ClienteBancoDados, ConsultaEncadeavel, UltimaTroca } from './tipos.ts';

// --- Leitura: fronteira de confianca (falha ABERTA, por ser auxiliar) ---

test('leitura: par valido atravessa intacto', () => {
  const valido: UltimaTroca = {
    mensagem_paciente: 'quero limpeza amanha',
    resposta_iris: 'Perfeito! Tenho 14:00 amanhã, confirmo?',
    gerada_em: '2026-08-06T12:00:00.000Z',
  };
  assert.deepEqual(validarUltimaTroca(valido), valido);
});

test('leitura: valor malformado vira null em vez de derrubar a identificacao', () => {
  const casos: unknown[] = [
    null,
    undefined,
    'texto',
    42,
    [],
    {},
    { mensagem_paciente: '', resposta_iris: 'oi', gerada_em: '2026-08-06T12:00:00.000Z' },
    { mensagem_paciente: 'oi', resposta_iris: '  ', gerada_em: '2026-08-06T12:00:00.000Z' },
    { mensagem_paciente: 'oi', resposta_iris: 'oi', gerada_em: 'nao-e-data' },
    { mensagem_paciente: 'oi', resposta_iris: 'oi' }, // gerada_em ausente
    { mensagem_paciente: 'oi', gerada_em: '2026-08-06T12:00:00.000Z' }, // resposta_iris ausente
    { resposta_iris: 'oi', gerada_em: '2026-08-06T12:00:00.000Z' }, // mensagem_paciente ausente
    { mensagem_paciente: 1, resposta_iris: 'oi', gerada_em: '2026-08-06T12:00:00.000Z' },
  ];
  for (const caso of casos) {
    assert.equal(validarUltimaTroca(caso), null, `esperava null para ${JSON.stringify(caso)}`);
  }
});

// --- Leitura: filtro de idade (expiracao SOMENTE na leitura, nunca apaga a coluna) ---

function troca(geradaEmIso: string): UltimaTroca {
  return { mensagem_paciente: 'oi', resposta_iris: 'oi, tudo bem?', gerada_em: geradaEmIso };
}

test('idade: null nunca vira valor -- devolve undefined (campo ausente do payload)', () => {
  assert.equal(ultimaTrocaValidaParaEnvio(null, Date.now()), undefined);
});

test('idade: dentro da janela de 24h atravessa intacta', () => {
  const agoraMs = Date.parse('2026-08-06T12:00:00.000Z');
  const par = troca(new Date(agoraMs - 60 * 60 * 1000).toISOString()); // 1h atras
  assert.deepEqual(ultimaTrocaValidaParaEnvio(par, agoraMs), par);
});

test('idade: exatamente no limite (VALIDADE_ULTIMA_TROCA_MS) ainda e valida -- fronteira inclusiva', () => {
  const agoraMs = Date.parse('2026-08-06T12:00:00.000Z');
  const par = troca(new Date(agoraMs - VALIDADE_ULTIMA_TROCA_MS).toISOString());
  assert.deepEqual(ultimaTrocaValidaParaEnvio(par, agoraMs), par);
});

test('idade: 1ms alem do limite vira undefined -- omitida, nunca null', () => {
  const agoraMs = Date.parse('2026-08-06T12:00:00.000Z');
  const par = troca(new Date(agoraMs - VALIDADE_ULTIMA_TROCA_MS - 1).toISOString());
  assert.equal(ultimaTrocaValidaParaEnvio(par, agoraMs), undefined);
});

// --- Gravacao: CAS, sem releitura, sem retry ---

interface InstrucaoRegistrada {
  operacao: 'select' | 'update';
  valores?: Record<string, unknown>;
  condicoes: Array<[string, unknown]>;
}

/** Mesmo dublê registrador de contexto-horarios.test.ts -- prova instrucoes emitidas, nao so o estado final. */
function criarClienteRegistrador(linhasAfetadas: number | 'erro') {
  const instrucoes: InstrucaoRegistrada[] = [];

  const encadeavel = (registro: InstrucaoRegistrada): ConsultaEncadeavel => {
    const alvo: ConsultaEncadeavel = {
      eq(coluna: string, valor: unknown) {
        registro.condicoes.push([coluna, valor]);
        return alvo;
      },
      is: () => alvo,
      not: () => alvo,
      select: () => alvo,
      async maybeSingle() {
        if (linhasAfetadas === 'erro') throw new Error('falha tecnica simulada do cliente');
        return { data: linhasAfetadas > 0 ? { id: 'conversa-1' } : null, error: null };
      },
      then(aoResolver: (valor: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(aoResolver);
      },
    } as unknown as ConsultaEncadeavel;
    return alvo;
  };

  const cliente = {
    from() {
      return {
        select: (): ConsultaEncadeavel => {
          const registro: InstrucaoRegistrada = { operacao: 'select', condicoes: [] };
          instrucoes.push(registro);
          return encadeavel(registro);
        },
        update: (valores: Record<string, unknown>): ConsultaEncadeavel => {
          const registro: InstrucaoRegistrada = { operacao: 'update', valores, condicoes: [] };
          instrucoes.push(registro);
          return encadeavel(registro);
        },
        upsert: (): ConsultaEncadeavel => {
          const registro: InstrucaoRegistrada = { operacao: 'update', condicoes: [] };
          instrucoes.push(registro);
          return encadeavel(registro);
        },
      };
    },
  } as unknown as ClienteBancoDados;

  return { cliente, instrucoes };
}

const ENTRADA_BASE = {
  conversa_id: '11111111-1111-4111-8111-111111111111',
  clinica_id: '22222222-2222-4222-8222-222222222222',
  telefone_normalizado: '5511999999999',
  atualizado_em_da_resposta: '2026-08-06T12:00:00.000Z',
  mensagem_paciente: 'quero limpeza amanha',
  resposta_iris: 'Perfeito! Tenho 14:00 amanhã, confirmo?',
};

test('gravacao: emite exatamente UM update e NENHUM select antes dele', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarUltimaTroca(cliente, ENTRADA_BASE);

  assert.equal(instrucoes.filter((i) => i.operacao === 'select').length, 0, 'nenhum SELECT extra antes do UPDATE');
  const updates = instrucoes.filter((i) => i.operacao === 'update');
  assert.equal(updates.length, 1, 'exatamente um UPDATE');
});

test('gravacao: ultima_troca gravada e byte a byte a resposta_iris recebida, nunca alterada', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarUltimaTroca(cliente, ENTRADA_BASE);

  const update = instrucoes.find((i) => i.operacao === 'update');
  const gravado = update?.valores?.ultima_troca as UltimaTroca;
  assert.equal(gravado.resposta_iris, ENTRADA_BASE.resposta_iris);
  assert.equal(gravado.mensagem_paciente, ENTRADA_BASE.mensagem_paciente);
});

test('gravacao: a condicao usa atualizado_em_da_resposta, e isola por conversa, clinica e telefone', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarUltimaTroca(cliente, ENTRADA_BASE);

  const update = instrucoes.find((i) => i.operacao === 'update');
  assert.ok(update);
  assert.deepEqual(update.condicoes, [
    ['id', ENTRADA_BASE.conversa_id],
    ['clinica_id', ENTRADA_BASE.clinica_id],
    ['telefone_normalizado', ENTRADA_BASE.telefone_normalizado],
    ['atualizado_em', ENTRADA_BASE.atualizado_em_da_resposta],
  ]);
});

test('gravacao: atualizado_em novo e estritamente posterior ao da resposta', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarUltimaTroca(cliente, ENTRADA_BASE);

  const update = instrucoes.find((i) => i.operacao === 'update');
  const novo = Date.parse(update?.valores?.atualizado_em as string);
  assert.ok(novo > Date.parse(ENTRADA_BASE.atualizado_em_da_resposta));
});

test('gravacao: CAS falho (0 linhas) abandona na hora -- sem reler, sem segunda tentativa, sem lancar', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(0);
  await gravarUltimaTroca(cliente, ENTRADA_BASE);

  assert.equal(instrucoes.length, 1, 'uma unica instrucao no total');
  assert.equal(instrucoes[0].operacao, 'update');
});

test('gravacao: falha tecnica do cliente tambem nao lanca (escrita auxiliar nunca vira erro pro paciente)', async () => {
  const { cliente } = criarClienteRegistrador('erro');
  await gravarUltimaTroca(cliente, ENTRADA_BASE);
});
