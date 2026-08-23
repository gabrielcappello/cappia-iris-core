// Testes de historico-conversa.ts (specs/historico-conversacional-v1.md).
// Nenhum acesso a rede ou banco real -- dublê em memoria apenas.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_PARES_HISTORICO,
  VALIDADE_HISTORICO_MS,
  gravarHistoricoConversa,
  historicoValidoParaEnvio,
  validarHistoricoConversa,
} from './historico-conversa.ts';
import type { ClienteBancoDados, ConsultaEncadeavel, HistoricoConversa, ParConversa } from './tipos.ts';

function par(mensagem: string, resposta: string, geradaEmIso = '2026-08-06T12:00:00.000Z'): ParConversa {
  return { mensagem_paciente: mensagem, resposta_iris: resposta, gerada_em: geradaEmIso };
}

// --- Leitura: fronteira de confianca (falha ABERTA, por ser auxiliar) ---

test('leitura: array de pares validos atravessa intacto, na mesma ordem', () => {
  const historico: HistoricoConversa = [par('oi', 'Oi! Tudo bem?'), par('quero limpeza', 'Perfeito, pra quando?')];
  assert.deepEqual(validarHistoricoConversa(historico), historico);
});

test('leitura: valor malformado vira null em vez de derrubar a identificacao', () => {
  const casos: unknown[] = [
    null,
    undefined,
    'texto',
    42,
    {},
    [], // array vazio nunca e valido -- "nenhum turno anterior" e sempre null, nunca []
    // formato objeto antigo (ultima_troca de 1 par) -- nao e array, invalida
    { mensagem_paciente: 'oi', resposta_iris: 'oi', gerada_em: '2026-08-06T12:00:00.000Z' },
    [{ mensagem_paciente: '', resposta_iris: 'oi', gerada_em: '2026-08-06T12:00:00.000Z' }],
    [{ mensagem_paciente: 'oi', resposta_iris: '  ', gerada_em: '2026-08-06T12:00:00.000Z' }],
    [{ mensagem_paciente: 'oi', resposta_iris: 'oi', gerada_em: 'nao-e-data' }],
    [{ mensagem_paciente: 'oi', resposta_iris: 'oi' }], // gerada_em ausente
    [{ mensagem_paciente: 'oi', gerada_em: '2026-08-06T12:00:00.000Z' }], // resposta_iris ausente
    [{ resposta_iris: 'oi', gerada_em: '2026-08-06T12:00:00.000Z' }], // mensagem_paciente ausente
    [{ mensagem_paciente: 1, resposta_iris: 'oi', gerada_em: '2026-08-06T12:00:00.000Z' }],
  ];
  for (const caso of casos) {
    assert.equal(validarHistoricoConversa(caso), null, `esperava null para ${JSON.stringify(caso)}`);
  }
});

test('leitura: um UNICO par malformado no meio invalida o array INTEIRO -- nunca descarte parcial', () => {
  const valor = [
    par('primeiro', 'resposta 1'),
    { mensagem_paciente: 'segundo', resposta_iris: '', gerada_em: '2026-08-06T12:00:00.000Z' }, // malformado
    par('terceiro', 'resposta 3'),
  ];
  assert.equal(validarHistoricoConversa(valor), null, 'um buraco no meio da conversa e pior que nenhum historico');
});

// --- Leitura: filtro de idade (expiracao SOMENTE na leitura, nunca apaga a coluna) ---

function parComIdade(idadeMs: number, agoraMs: number, texto: string): ParConversa {
  return par(texto, `resposta a ${texto}`, new Date(agoraMs - idadeMs).toISOString());
}

test('idade: null nunca vira valor -- devolve undefined (campo ausente do payload)', () => {
  assert.equal(historicoValidoParaEnvio(null, Date.now()), undefined);
});

test('idade: todos os pares dentro da janela de validade atravessam intactos, na mesma ordem', () => {
  const agoraMs = Date.parse('2026-08-06T12:00:00.000Z');
  const historico = [parComIdade(2 * 60 * 60 * 1000, agoraMs, 'a'), parComIdade(1 * 60 * 60 * 1000, agoraMs, 'b')];
  assert.deepEqual(historicoValidoParaEnvio(historico, agoraMs), historico);
});

test('idade: pares expirados sao filtrados, os validos preservam a ordem original', () => {
  const agoraMs = Date.parse('2026-08-06T12:00:00.000Z');
  const expirado1 = parComIdade(VALIDADE_HISTORICO_MS + 1000, agoraMs, 'velho1');
  const expirado2 = parComIdade(VALIDADE_HISTORICO_MS + 2000, agoraMs, 'velho2');
  const valido1 = parComIdade(60 * 60 * 1000, agoraMs, 'novo1');
  const valido2 = parComIdade(30 * 60 * 1000, agoraMs, 'novo2');
  const historico = [expirado1, expirado2, valido1, valido2];

  assert.deepEqual(historicoValidoParaEnvio(historico, agoraMs), [valido1, valido2]);
});

test('idade: exatamente no limite (VALIDADE_HISTORICO_MS) ainda e valido -- fronteira inclusiva', () => {
  const agoraMs = Date.parse('2026-08-06T12:00:00.000Z');
  const historico = [parComIdade(VALIDADE_HISTORICO_MS, agoraMs, 'a')];
  assert.deepEqual(historicoValidoParaEnvio(historico, agoraMs), historico);
});

test('idade: 1ms alem do limite fica de fora', () => {
  const agoraMs = Date.parse('2026-08-06T12:00:00.000Z');
  const historico = [parComIdade(VALIDADE_HISTORICO_MS + 1, agoraMs, 'a')];
  assert.equal(historicoValidoParaEnvio(historico, agoraMs), undefined);
});

test('idade: todos os pares expirados -- chave omitida (undefined, nunca [])', () => {
  const agoraMs = Date.parse('2026-08-06T12:00:00.000Z');
  const historico = [parComIdade(VALIDADE_HISTORICO_MS + 1000, agoraMs, 'a'), parComIdade(VALIDADE_HISTORICO_MS + 5000, agoraMs, 'b')];
  assert.equal(historicoValidoParaEnvio(historico, agoraMs), undefined);
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
  historico_anterior: null,
  mensagem_paciente: 'quero limpeza amanha',
  resposta_iris: 'Perfeito! Tenho 14:00 amanhã, confirmo?',
};

test('gravacao: emite exatamente UM update e NENHUM select antes dele', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarHistoricoConversa(cliente, ENTRADA_BASE);

  assert.equal(instrucoes.filter((i) => i.operacao === 'select').length, 0, 'nenhum SELECT extra antes do UPDATE');
  const updates = instrucoes.filter((i) => i.operacao === 'update');
  assert.equal(updates.length, 1, 'exatamente um UPDATE');
});

test('gravacao: historico_anterior null + par novo -- grava array de exatamente 1 elemento', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarHistoricoConversa(cliente, ENTRADA_BASE);

  const update = instrucoes.find((i) => i.operacao === 'update');
  const gravado = update?.valores?.historico_conversa as HistoricoConversa;
  assert.equal(gravado.length, 1);
  assert.equal(gravado[0].mensagem_paciente, ENTRADA_BASE.mensagem_paciente);
  assert.equal(gravado[0].resposta_iris, ENTRADA_BASE.resposta_iris);
});

test('gravacao: mensagem_paciente e resposta_iris gravadas sao byte a byte as recebidas, nunca alteradas', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarHistoricoConversa(cliente, ENTRADA_BASE);

  const update = instrucoes.find((i) => i.operacao === 'update');
  const gravado = update?.valores?.historico_conversa as HistoricoConversa;
  assert.equal(gravado[0].resposta_iris, ENTRADA_BASE.resposta_iris);
  assert.equal(gravado[0].mensagem_paciente, ENTRADA_BASE.mensagem_paciente);
});

test('gravacao: anexa ao historico anterior preservando a ordem cronologica (mais antigo primeiro)', async () => {
  const anterior: HistoricoConversa = [par('turno 1', 'resposta 1'), par('turno 2', 'resposta 2')];
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarHistoricoConversa(cliente, { ...ENTRADA_BASE, historico_anterior: anterior, mensagem_paciente: 'turno 3', resposta_iris: 'resposta 3' });

  const update = instrucoes.find((i) => i.operacao === 'update');
  const gravado = update?.valores?.historico_conversa as HistoricoConversa;
  assert.equal(gravado.length, 3);
  assert.deepEqual(
    gravado.map((p) => p.mensagem_paciente),
    ['turno 1', 'turno 2', 'turno 3']
  );
});

test('gravacao: 10 pares + o 11o -- corta para exatamente 10, o MAIS ANTIGO sai, ordem preservada', async () => {
  const anterior: HistoricoConversa = Array.from({ length: MAX_PARES_HISTORICO }, (_, i) => par(`turno ${i + 1}`, `resposta ${i + 1}`));
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarHistoricoConversa(cliente, {
    ...ENTRADA_BASE,
    historico_anterior: anterior,
    mensagem_paciente: 'turno 11',
    resposta_iris: 'resposta 11',
  });

  const update = instrucoes.find((i) => i.operacao === 'update');
  const gravado = update?.valores?.historico_conversa as HistoricoConversa;
  assert.equal(gravado.length, MAX_PARES_HISTORICO, 'nunca acumula alem do limite');
  assert.deepEqual(
    gravado.map((p) => p.mensagem_paciente),
    Array.from({ length: MAX_PARES_HISTORICO }, (_, i) => `turno ${i + 2}`),
    'turno 1 (mais antigo) saiu; turno 11 (mais novo) entrou; ordem cronologica preservada'
  );
});

test('gravacao: a condicao usa atualizado_em_da_resposta, e isola por conversa, clinica e telefone', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarHistoricoConversa(cliente, ENTRADA_BASE);

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
  await gravarHistoricoConversa(cliente, ENTRADA_BASE);

  const update = instrucoes.find((i) => i.operacao === 'update');
  const novo = Date.parse(update?.valores?.atualizado_em as string);
  assert.ok(novo > Date.parse(ENTRADA_BASE.atualizado_em_da_resposta));
});

test('gravacao: CAS falho (0 linhas) abandona na hora -- sem reler, sem segunda tentativa, sem lancar', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(0);
  await gravarHistoricoConversa(cliente, ENTRADA_BASE);

  assert.equal(instrucoes.length, 1, 'uma unica instrucao no total');
  assert.equal(instrucoes[0].operacao, 'update');
});

test('gravacao: falha tecnica do cliente tambem nao lanca (escrita auxiliar nunca vira erro pro paciente)', async () => {
  const { cliente } = criarClienteRegistrador('erro');
  await gravarHistoricoConversa(cliente, ENTRADA_BASE);
});
