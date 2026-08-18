// Testes do shadow do contrato v2 (`sombra-resultado-iris.ts`).
//
// O QUE ESTES TESTES PROVAM -- e o unico requisito que realmente importa num
// modulo que roda em PRODUCAO ao lado do atendimento:
//
//   1. NUNCA LANCA. Rede caindo, HTTP 500, JSON quebrado, recusa do modelo,
//      timeout: tudo vira um `estado` proprio. Se este modulo lancasse, um
//      turno bem-sucedido viraria erro para o paciente;
//   2. o log NUNCA carrega PII -- so rotulos e contagens;
//   3. a pergunta pendente entra na medicao como ROTULO (o `tipo`), nunca as
//      `opcoes`, que carregam data, horario e nome de profissional.
//
// Nenhuma chamada real de rede: `fetchInjetado` cobre todos os caminhos.

import test from 'node:test';
import assert from 'node:assert/strict';

import { medirResultadoIris, registrarMedicaoIris } from './sombra-resultado-iris.ts';
import type { ContextoUnificadoSemMensagem } from './sombra-contexto-unificado.ts';

const CONTEXTO_BASE = {
  contexto_relevante: {
    dados_conhecidos: {},
    cadastro_paciente: { preenchidos: [] },
    agendamentos_do_paciente: [],
    opcoes_apresentadas: [],
    aguardando_resposta: null,
    procedimentos_disponiveis: [],
    dentistas_disponiveis: [],
  },
} as unknown as ContextoUnificadoSemMensagem;

function comMensagem(contexto: ContextoUnificadoSemMensagem, mensagem: string) {
  return { ...contexto, mensagem_atual: mensagem } as ContextoUnificadoSemMensagem & {
    mensagem_atual: string;
  };
}

function respostaOk(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status: 200 });
}

/** Envelope no formato que a API devolve, com a saida do contrato dentro. */
function envelopeCom(saida: unknown) {
  return {
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(saida) }] }],
  };
}

// ── NUNCA LANCA -- o requisito central ─────────────────────────────────

test('rede caindo vira estado erro_rede, nunca excecao', async () => {
  const r = await medirResultadoIris({
    chaveApi: 'k',
    contexto: comMensagem(CONTEXTO_BASE, 'oi'),
    decisaoAtual: 'saudacao',
    fetchInjetado: () => Promise.reject(new Error('sem rede')),
  });
  assert.equal(r.estado, 'erro_rede');
  assert.equal(r.acao, null);
});

test('HTTP nao-ok vira erro_http', async () => {
  const r = await medirResultadoIris({
    chaveApi: 'k',
    contexto: comMensagem(CONTEXTO_BASE, 'oi'),
    decisaoAtual: 'saudacao',
    fetchInjetado: () => Promise.resolve(new Response('erro', { status: 500 })),
  });
  assert.equal(r.estado, 'erro_http');
});

test('JSON quebrado vira erro_estrutural', async () => {
  const r = await medirResultadoIris({
    chaveApi: 'k',
    contexto: comMensagem(CONTEXTO_BASE, 'oi'),
    decisaoAtual: 'saudacao',
    fetchInjetado: () => Promise.resolve(new Response('nao e json', { status: 200 })),
  });
  assert.equal(r.estado, 'erro_estrutural');
});

test('envelope sem output vira erro_estrutural', async () => {
  const r = await medirResultadoIris({
    chaveApi: 'k',
    contexto: comMensagem(CONTEXTO_BASE, 'oi'),
    decisaoAtual: 'saudacao',
    fetchInjetado: () => Promise.resolve(respostaOk({ status: 'completed' })),
  });
  assert.equal(r.estado, 'erro_estrutural');
});

test('recusa do modelo vira estado recusa, nunca excecao', async () => {
  const r = await medirResultadoIris({
    chaveApi: 'k',
    contexto: comMensagem(CONTEXTO_BASE, 'oi'),
    decisaoAtual: 'saudacao',
    fetchInjetado: () => Promise.resolve(respostaOk({ output: [{ type: 'refusal' }] })),
  });
  assert.equal(r.estado, 'recusa');
});

test('texto que nao e JSON valido vira erro_estrutural', async () => {
  const r = await medirResultadoIris({
    chaveApi: 'k',
    contexto: comMensagem(CONTEXTO_BASE, 'oi'),
    decisaoAtual: 'saudacao',
    fetchInjetado: () =>
      Promise.resolve(respostaOk({ output: [{ content: [{ type: 'output_text', text: '{quebrado' }] }] })),
  });
  assert.equal(r.estado, 'erro_estrutural');
});

test('timeout vira estado timeout', async () => {
  const r = await medirResultadoIris({
    chaveApi: 'k',
    contexto: comMensagem(CONTEXTO_BASE, 'oi'),
    decisaoAtual: 'saudacao',
    timeoutMsInjetado: 5,
    fetchInjetado: (_url, init) =>
      new Promise((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener('abort', () => reject(new Error('abort')));
      }),
  });
  assert.equal(r.estado, 'timeout');
});

// ── Caminho feliz: extrai acao, operacao e contagem ────────────────────

test('saida valida extrai acao, operacao e numero de campos', async () => {
  const r = await medirResultadoIris({
    chaveApi: 'k',
    contexto: comMensagem(CONTEXTO_BASE, 'pode ser'),
    decisaoAtual: 'aguardando_confirmacao',
    fetchInjetado: () =>
      Promise.resolve(
        respostaOk(
          envelopeCom({
            tipo: 'compreendida',
            acao: { tipo: 'confirmar', operacao: 'criar', agendamento_id: null },
            informacoes_fornecidas: [{ campo: 'horario_texto', operacao: 'informou', valor: '10:00' }],
          })
        )
      ),
  });
  assert.equal(r.estado, 'ok');
  assert.equal(r.acao, 'confirmar');
  assert.equal(r.operacao, 'criar');
  assert.equal(r.campos, 1);
  assert.equal(r.decisao_atual, 'aguardando_confirmacao');
});

test('acao null (nao compreendida) e registrada sem quebrar', async () => {
  const r = await medirResultadoIris({
    chaveApi: 'k',
    contexto: comMensagem(CONTEXTO_BASE, '???'),
    decisaoAtual: 'mensagem_nao_compreendida',
    fetchInjetado: () =>
      Promise.resolve(
        respostaOk(envelopeCom({ tipo: 'nao_compreendida', acao: null, informacoes_fornecidas: [] }))
      ),
  });
  assert.equal(r.estado, 'ok');
  assert.equal(r.acao, null);
  assert.equal(r.operacao, null);
});

// ── A pergunta pendente entra como ROTULO, nunca as opcoes ─────────────

test('pergunta pendente entra como TIPO -- opcoes (com data/horario) nunca vazam', async () => {
  const contexto = {
    contexto_relevante: {
      ...(CONTEXTO_BASE as unknown as { contexto_relevante: Record<string, unknown> }).contexto_relevante,
      aguardando_resposta: {
        tipo: 'escolha_horario',
        // Estas opcoes NAO podem aparecer no resultado da medicao.
        opcoes: ['20/08 às 10:00 com Dr. Diego', '22/08 às 14:00 com Dra. Vanesa'],
      },
    },
  } as unknown as ContextoUnificadoSemMensagem;

  const r = await medirResultadoIris({
    chaveApi: 'k',
    contexto: comMensagem(contexto, 'o primeiro'),
    decisaoAtual: 'horarios_disponiveis',
    fetchInjetado: () =>
      Promise.resolve(
        respostaOk(
          envelopeCom({
            tipo: 'compreendida',
            acao: { tipo: 'escolher_horario', referencia: '10:00', operacao: 'criar' },
            informacoes_fornecidas: [],
          })
        )
      ),
  });

  assert.equal(r.pergunta_pendente, 'escolha_horario');
  const serializado = JSON.stringify(r);
  assert.equal(serializado.includes('Diego'), false, 'nome de profissional nao pode vazar');
  assert.equal(serializado.includes('20/08'), false, 'data nao pode vazar');
  assert.equal(serializado.includes('10:00'), false, 'horario nao pode vazar');
});

test('falha tambem preserva o rotulo da pergunta pendente', async () => {
  const contexto = {
    contexto_relevante: {
      ...(CONTEXTO_BASE as unknown as { contexto_relevante: Record<string, unknown> }).contexto_relevante,
      aguardando_resposta: { tipo: 'confirmacao', operacao: 'cancelar', agendamento_id: 'ag-1' },
    },
  } as unknown as ContextoUnificadoSemMensagem;

  const r = await medirResultadoIris({
    chaveApi: 'k',
    contexto: comMensagem(contexto, 'sim'),
    decisaoAtual: 'aguardando_confirmacao_cancelamento',
    fetchInjetado: () => Promise.reject(new Error('sem rede')),
  });
  assert.equal(r.pergunta_pendente, 'confirmacao');
  // O id do agendamento NUNCA entra na medicao, nem no caminho de falha.
  assert.equal(JSON.stringify(r).includes('ag-1'), false);
});

// ── O log nao carrega PII ──────────────────────────────────────────────

test('o log so tem rotulos e contagens -- nunca texto do paciente', () => {
  const linhas: string[] = [];
  const original = console.log;
  console.log = (m: string) => linhas.push(m);
  try {
    registrarMedicaoIris({
      estado: 'ok',
      acao: 'confirmar',
      operacao: 'criar',
      pergunta_pendente: 'confirmacao',
      decisao_atual: 'aguardando_confirmacao',
      campos: 2,
      duracao_ms: 120,
    });
  } finally {
    console.log = original;
  }
  assert.equal(linhas.length, 1);
  assert.match(linhas[0], /^sombra_iris_v2 /);
  assert.match(linhas[0], /acao=confirmar/);
  assert.match(linhas[0], /operacao=criar/);
  assert.match(linhas[0], /pergunta_pendente=confirmacao/);
  assert.match(linhas[0], /decisao_atual=aguardando_confirmacao/);
});
