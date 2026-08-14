// Testes da sombra do contrato unificado.
//
// Nenhuma chamada de rede real: o `fetch` é injetado, e por isso os testes são
// determinísticos. O comportamento da IA real foi medido à parte
// (`src/eval/medicao-contexto-unificado.ts`).
//
// O que estes testes garantem:
//   1. `medirComContextoUnificado` NUNCA lança -- toda falha vira `estado`;
//   2. o log não carrega PII, por construção de tipo;
//   3. o montador usa só fatos reais e nunca deriva `aguardando_resposta`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  completarContextoUnificado,
  medirComContextoUnificado,
  montarContextoUnificado,
  registrarMedicaoUnificada,
  type ResultadoMedicaoUnificada,
} from './sombra-contexto-unificado.ts';
import type { ContextoUnificado } from './contexto-unificado-tipos.ts';

const CONTEXTO: ContextoUnificado = {
  contexto_relevante: {
    dados_conhecidos: { procedimento: 'Consulta / Avaliação' },
    cadastro_paciente: { preenchidos: [] },
    agendamentos_do_paciente: [],
    opcoes_apresentadas: ['Dr. Diego Ramoz', 'Dr. Pablo Arruda'],
    aguardando_resposta: { tipo: 'escolha_dentista', opcoes: ['Dr. Diego Ramoz', 'Dr. Pablo Arruda'] },
    procedimentos_disponiveis: [{ procedimento_id: 'consultation_evaluation', nome: 'Consulta / Avaliação' }],
    dentistas_disponiveis: [{ dentista_id: 'd-1', nome_exibido: 'Dr. Pablo Arruda' }],
  },
  mensagem_atual: 'Pablo',
  historico_recente: [],
};

function respostaOpenAI(saida: unknown): Response {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(saida) }] }],
    }),
    { status: 200 }
  );
}

async function medirCom(fetchInjetado: typeof fetch): Promise<ResultadoMedicaoUnificada> {
  return await medirComContextoUnificado({ chaveApi: 'sk-teste', contexto: CONTEXTO, fetchInjetado });
}

// ── NUNCA LANÇA ──────────────────────────────────────────────────────────────

test('NUNCA LANCA: falha de rede vira estado=erro_rede', async () => {
  const r = await medirCom(() => Promise.reject(new Error('sem rede')));
  assert.equal(r.estado, 'erro_rede');
  assert.equal(r.acao, null);
});

test('NUNCA LANCA: timeout vira estado=timeout', async () => {
  const r = await medirComContextoUnificado({
    chaveApi: 'sk-teste',
    contexto: CONTEXTO,
    timeoutMsInjetado: 1,
    fetchInjetado: (_u, init) =>
      new Promise((_res, rej) => {
        (init as RequestInit).signal?.addEventListener('abort', () => rej(new Error('abortado')));
      }),
  });
  assert.equal(r.estado, 'timeout');
});

test('NUNCA LANCA: HTTP nao-ok vira estado=erro_http', async () => {
  const r = await medirCom(() => Promise.resolve(new Response('erro', { status: 500 })));
  assert.equal(r.estado, 'erro_http');
});

test('NUNCA LANCA: corpo nao-JSON vira estado=erro_estrutural', async () => {
  const r = await medirCom(() => Promise.resolve(new Response('nao e json', { status: 200 })));
  assert.equal(r.estado, 'erro_estrutural');
});

test('NUNCA LANCA: recusa do modelo vira estado=recusa_ou_filtro', async () => {
  const r = await medirCom(() =>
    Promise.resolve(new Response(JSON.stringify({ status: 'completed', output: [{ type: 'refusal' }] }), { status: 200 }))
  );
  assert.equal(r.estado, 'recusa_ou_filtro');
});

test('NUNCA LANCA: saida sem os campos do contrato vira estado=erro_estrutural', async () => {
  const r = await medirCom(() => Promise.resolve(respostaOpenAI({ qualquer: 'coisa' })));
  assert.equal(r.estado, 'erro_estrutural');
});

// ── FORMA do contrato (spec §4) ──────────────────────────────────────────────

test('forma invalida (`informou` vazio) e RECUSADA, nunca normalizada', async () => {
  const r = await medirCom(() =>
    Promise.resolve(
      respostaOpenAI({
        acao_solicitada: { tipo: 'nenhuma', referencia: null },
        informacoes_fornecidas: [{ campo: 'nome', operacao: 'informou', valor: '' }],
      })
    )
  );
  assert.equal(r.estado, 'forma_invalida');
  assert.equal(r.guarda_bloqueou, false);
});

// ── GUARDA aplicada sobre a saída real ───────────────────────────────────────

test('guarda dispara quando a saida traz escolher_dentista E nome', async () => {
  const r = await medirCom(() =>
    Promise.resolve(
      respostaOpenAI({
        acao_solicitada: { tipo: 'escolher_dentista', referencia: 'Dr. Pablo Arruda' },
        informacoes_fornecidas: [{ campo: 'nome', operacao: 'informou', valor: 'Pablo' }],
      })
    )
  );
  assert.equal(r.estado, 'ok');
  assert.equal(r.guarda_bloqueou, true);
  assert.deepEqual(r.campos, ['nome:informou']);
});

test('guarda NAO dispara na escolha sem nome', async () => {
  const r = await medirCom(() =>
    Promise.resolve(
      respostaOpenAI({
        acao_solicitada: { tipo: 'escolher_dentista', referencia: 'Dr. Pablo Arruda' },
        informacoes_fornecidas: [],
      })
    )
  );
  assert.equal(r.estado, 'ok');
  assert.equal(r.guarda_bloqueou, false);
});

// ── LOG SEM PII ──────────────────────────────────────────────────────────────

test('o log nunca contem valor de campo, nome nem texto do paciente', () => {
  const linhas: string[] = [];
  const original = console.log;
  console.log = (msg: string) => linhas.push(msg);
  try {
    registrarMedicaoUnificada({
      estado: 'ok',
      acao: 'escolher_dentista',
      campos: ['nome:informou', 'cpf:informou'],
      guarda_bloqueou: true,
      duracao_ms: 812,
    });
  } finally {
    console.log = original;
  }

  const linha = linhas.join('\n');
  // O tipo `ResultadoMedicaoUnificada` não carrega valores -- então nenhum
  // valor pode aparecer aqui, nem por acidente do formatador.
  for (const proibido of ['Pablo', 'Gabriel', '06113236722', 'vanesa']) {
    assert.ok(!linha.includes(proibido), `log nao pode conter "${proibido}"`);
  }
  assert.ok(linha.includes('guarda_bloqueou=true'));
  assert.ok(linha.includes('nome:informou'), 'rotulo de campo pode; valor nao');
});

// ── Montador: só fatos reais, `aguardando_resposta` sempre null ──────────────

test('montador: `aguardando_resposta` e `opcoes_apresentadas` refletem o que existe hoje', () => {
  const c = montarContextoUnificado({
    dados: { procedimento_id: 'cleaning', data_texto: 'hoje', vazio: '  ' },
    cadastro: { nome: 'Gabriel', cpf: '', data_nascimento: '1973-08-02' },
    agendamentos: undefined,
    catalogo: null,
    historico: null,
  });

  // Fiel à spec §3.1: nunca derivado dos marcadores antigos.
  assert.equal(c.contexto_relevante.aguardando_resposta, null);
  assert.deepEqual(c.contexto_relevante.opcoes_apresentadas, []);
  // Campo só de espaços não conta como conhecido.
  assert.deepEqual(Object.keys(c.contexto_relevante.dados_conhecidos), ['procedimento_id', 'data_texto']);
});

test('montador: cadastro leva SO os nomes dos campos preenchidos -- nunca o conteudo', () => {
  const c = montarContextoUnificado({
    dados: {},
    cadastro: { nome: 'Gabriel Cappello', cpf: '06113236722', email: '' },
    agendamentos: undefined,
    catalogo: null,
    historico: null,
  });

  assert.deepEqual(c.contexto_relevante.cadastro_paciente.preenchidos, ['nome', 'cpf']);
  const serializado = JSON.stringify(c);
  for (const pii of ['Gabriel Cappello', '06113236722']) {
    assert.ok(!serializado.includes(pii), `contexto nao pode carregar "${pii}"`);
  }
});

test('montador: agendamentos e historico entram como fato real', () => {
  const c = montarContextoUnificado({
    dados: {},
    cadastro: {},
    agendamentos: [
      {
        agendamento_id: 'a-1',
        data: '2026-08-20',
        horario: '09:00',
        dentista_id: 'd-1',
        dentista_nome: 'Dr. Pablo Arruda',
        procedimento_id: 'cleaning',
        procedimento: 'Limpeza dental (profilaxia)',
      },
    ],
    catalogo: null,
    historico: [{ mensagem_paciente: 'avaliação', resposta_iris: 'Diego ou Pablo?', gerada_em: '2026-08-14T00:00:00.000Z' }],
  });

  assert.equal(c.contexto_relevante.agendamentos_do_paciente.length, 1);
  // Identificadores opacos ficam de fora -- só o que distingue.
  assert.deepEqual(Object.keys(c.contexto_relevante.agendamentos_do_paciente[0]!).sort(), [
    'data',
    'dentista_nome',
    'horario',
    'procedimento',
  ]);
  // A pergunta em aberto chega por AQUI, em texto -- e foi assim que a medição
  // de 10/10 aconteceu.
  assert.equal(c.historico_recente[0]?.resposta_iris, 'Diego ou Pablo?');
});

test('montador NAO carrega a mensagem crua do turno -- quem despacha completa', () => {
  const parcial = montarContextoUnificado({
    dados: {},
    cadastro: {},
    agendamentos: undefined,
    catalogo: null,
    historico: null,
  });

  // A guarda de isolamento varre o resultado inteiro do orquestrador; a
  // mensagem do paciente pode citar um dentista que ele NAO escolheu.
  assert.ok(!JSON.stringify(parcial).includes('mensagem_atual'));
  assert.equal(completarContextoUnificado(parcial, 'com o Intruso').mensagem_atual, 'com o Intruso');
});
