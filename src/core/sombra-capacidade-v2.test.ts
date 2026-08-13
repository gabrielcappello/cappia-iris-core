// ETAPA 2 da Arquitetura V2 -- garante a propriedade central deste modulo:
// `compararComSombraCapacidadeV2` NUNCA lanca, para NENHUM tipo de falha.
// Cada teste de falha e a prova de que o fluxo real (index.ts) nunca
// precisaria de try/catch ao redor desta chamada.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAPACIDADES_V2,
  compararComSombraCapacidadeV2,
  mapearDecisaoParaCapacidadeV2,
  registrarResultadoSombra,
  type ResultadoComparacaoSombra,
} from './sombra-capacidade-v2.ts';

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}

function envelopeSucesso(capacidade: string, certeza: string): unknown {
  return {
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify({ capacidade, certeza }) }],
      },
    ],
  };
}

const ENTRADA_BASE = {
  chaveApi: 'chave-de-teste',
  mensagemAtual: 'oi',
  historicoConversa: null,
  decisaoAtual: 'saudacao' as const,
};

test('mapearDecisaoParaCapacidadeV2: cobre os quatro grupos operacionais e o indeterminado', () => {
  assert.equal(mapearDecisaoParaCapacidadeV2('saudacao'), 'nenhuma_apenas_conversar');
  assert.equal(mapearDecisaoParaCapacidadeV2('duvida_livre'), 'nenhuma_apenas_conversar');
  assert.equal(mapearDecisaoParaCapacidadeV2('horarios_disponiveis'), 'consultar_disponibilidade');
  assert.equal(mapearDecisaoParaCapacidadeV2('reserva_criada'), 'criar_agendamento');
  assert.equal(mapearDecisaoParaCapacidadeV2('remarcacao_criada'), 'remarcar_agendamento');
  assert.equal(mapearDecisaoParaCapacidadeV2('cancelamento_criado'), 'cancelar_agendamento');
  assert.equal(mapearDecisaoParaCapacidadeV2('clinica_sem_catalogo'), 'indeterminado');
  assert.equal(mapearDecisaoParaCapacidadeV2('erro_configuracao_duracao'), 'indeterminado');
});

test('mapearDecisaoParaCapacidadeV2: toda decisao real do orquestrador tem um mapeamento (nunca lanca)', () => {
  // Lista fechada, replicada do union real de DecisaoOrquestrador['tipo']
  // (orquestrador-tipos.ts) -- garante que nenhum tipo novo passe
  // silenciosamente sem mapeamento (o `switch` sem `default` no modulo
  // faz o TypeScript recusar a compilar se faltar um caso).
  const TODOS_OS_TIPOS = [
    'clinica_sem_catalogo', 'saudacao', 'duvida_livre', 'mensagem_nao_compreendida', 'desistencia',
    'aguardando_procedimento', 'aguardando_escolha_dentista', 'sem_dentista_disponivel',
    'combinacao_indisponivel', 'erro_catalogo_dentista', 'duracao_nao_configurada',
    'erro_configuracao_duracao', 'aguardando_data_horario', 'horarios_disponiveis',
    'aguardando_confirmacao', 'cadastro_necessario', 'cpf_ja_cadastrado', 'reserva_criada',
    'reserva_conflito', 'reserva_falhou', 'sem_agendamento_para_remarcar',
    'aguardando_escolha_agendamento', 'aguardando_confirmacao_remarcacao', 'remarcacao_criada',
    'sem_agendamento_para_cancelar', 'aguardando_escolha_agendamento_cancelamento',
    'aguardando_confirmacao_cancelamento', 'cancelamento_criado', 'troca_telefone_pendente',
    'troca_telefone_recusada',
  ] as const;

  for (const tipo of TODOS_OS_TIPOS) {
    const resultado = mapearDecisaoParaCapacidadeV2(tipo);
    assert.ok(
      resultado === 'indeterminado' || (CAPACIDADES_V2 as readonly string[]).includes(resultado),
      `${tipo} deveria mapear para uma capacidade valida ou 'indeterminado', obteve ${String(resultado)}`
    );
  }
});

test('NUNCA LANCA: falha de rede vira estado=erro_rede', async () => {
  const fetchFalha: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));
  const resultado = await compararComSombraCapacidadeV2({ ...ENTRADA_BASE, fetchInjetado: fetchFalha });
  assert.equal(resultado.estado, 'erro_rede');
  assert.equal(resultado.capacidade_v2, null);
  assert.equal(resultado.concordou, null);
});

test('NUNCA LANCA: timeout vira estado=timeout', async () => {
  const fetchPendente: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  const resultado = await compararComSombraCapacidadeV2({
    ...ENTRADA_BASE,
    fetchInjetado: fetchPendente,
    timeoutMsInjetado: 10,
  });
  assert.equal(resultado.estado, 'timeout');
  assert.equal(resultado.capacidade_v2, null);
});

test('NUNCA LANCA: HTTP nao-ok vira estado=erro_http', async () => {
  const fetchErroHttp: typeof fetch = () => Promise.resolve(new Response('erro interno', { status: 500 }));
  const resultado = await compararComSombraCapacidadeV2({ ...ENTRADA_BASE, fetchInjetado: fetchErroHttp });
  assert.equal(resultado.estado, 'erro_http');
});

test('NUNCA LANCA: corpo nao e JSON valido vira estado=erro_estrutural', async () => {
  const fetchCorpoRuim: typeof fetch = () => Promise.resolve(new Response('nao e json', { status: 200 }));
  const resultado = await compararComSombraCapacidadeV2({ ...ENTRADA_BASE, fetchInjetado: fetchCorpoRuim });
  assert.equal(resultado.estado, 'erro_estrutural');
});

test('NUNCA LANCA: recusa/filtro detectado vira estado=recusa_ou_filtro', async () => {
  const fetchRecusa: typeof fetch = () =>
    Promise.resolve(respostaJson({ status: 'completed', output: [{ type: 'refusal' }] }));
  const resultado = await compararComSombraCapacidadeV2({ ...ENTRADA_BASE, fetchInjetado: fetchRecusa });
  assert.equal(resultado.estado, 'recusa_ou_filtro');
});

test('NUNCA LANCA: status diferente de completed vira estado=erro_estrutural', async () => {
  const fetchIncompleto: typeof fetch = () => Promise.resolve(respostaJson({ status: 'incomplete', output: [] }));
  const resultado = await compararComSombraCapacidadeV2({ ...ENTRADA_BASE, fetchInjetado: fetchIncompleto });
  assert.equal(resultado.estado, 'erro_estrutural');
});

test('NUNCA LANCA: sem item de mensagem no output vira estado=erro_estrutural', async () => {
  const fetchSemMensagem: typeof fetch = () =>
    Promise.resolve(respostaJson({ status: 'completed', output: [{ type: 'reasoning' }] }));
  const resultado = await compararComSombraCapacidadeV2({ ...ENTRADA_BASE, fetchInjetado: fetchSemMensagem });
  assert.equal(resultado.estado, 'erro_estrutural');
});

test('NUNCA LANCA: output_text vazio vira estado=erro_estrutural', async () => {
  const fetchTextoVazio: typeof fetch = () =>
    Promise.resolve(
      respostaJson({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }] })
    );
  const resultado = await compararComSombraCapacidadeV2({ ...ENTRADA_BASE, fetchInjetado: fetchTextoVazio });
  assert.equal(resultado.estado, 'erro_estrutural');
});

test('NUNCA LANCA: output_text nao e JSON valido vira estado=erro_estrutural', async () => {
  const fetchJsonRuim: typeof fetch = () =>
    Promise.resolve(
      respostaJson({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{nao fecha' }] }],
      })
    );
  const resultado = await compararComSombraCapacidadeV2({ ...ENTRADA_BASE, fetchInjetado: fetchJsonRuim });
  assert.equal(resultado.estado, 'erro_estrutural');
});

test('NUNCA LANCA: capacidade fora do vocabulario fechado vira estado=erro_estrutural', async () => {
  const fetchForaDoEnum: typeof fetch = () =>
    Promise.resolve(respostaJson(envelopeSucesso('capacidade_inventada', 'alta')));
  const resultado = await compararComSombraCapacidadeV2({ ...ENTRADA_BASE, fetchInjetado: fetchForaDoEnum });
  assert.equal(resultado.estado, 'erro_estrutural');
});

test('NUNCA LANCA: certeza fora do vocabulario fechado vira estado=erro_estrutural', async () => {
  const fetchCertezaRuim: typeof fetch = () =>
    Promise.resolve(respostaJson(envelopeSucesso('nenhuma_apenas_conversar', 'meio-meio')));
  const resultado = await compararComSombraCapacidadeV2({ ...ENTRADA_BASE, fetchInjetado: fetchCertezaRuim });
  assert.equal(resultado.estado, 'erro_estrutural');
});

test('sucesso: concordou=true quando a capacidade V2 bate com a decisao real mapeada', async () => {
  const fetchOk: typeof fetch = () => Promise.resolve(respostaJson(envelopeSucesso('nenhuma_apenas_conversar', 'alta')));
  const resultado = await compararComSombraCapacidadeV2({
    ...ENTRADA_BASE,
    decisaoAtual: 'saudacao', // mapeia para nenhuma_apenas_conversar
    fetchInjetado: fetchOk,
  });
  assert.equal(resultado.estado, 'ok');
  assert.equal(resultado.capacidade_v2, 'nenhuma_apenas_conversar');
  assert.equal(resultado.certeza_v2, 'alta');
  assert.equal(resultado.concordou, true);
});

test('sucesso: concordou=false quando a capacidade V2 diverge da decisao real mapeada', async () => {
  const fetchDivergente: typeof fetch = () => Promise.resolve(respostaJson(envelopeSucesso('cancelar_agendamento', 'baixa')));
  const resultado = await compararComSombraCapacidadeV2({
    ...ENTRADA_BASE,
    decisaoAtual: 'saudacao', // mapeia para nenhuma_apenas_conversar
    fetchInjetado: fetchDivergente,
  });
  assert.equal(resultado.estado, 'ok');
  assert.equal(resultado.capacidade_v2, 'cancelar_agendamento');
  assert.equal(resultado.concordou, false);
});

test('sucesso: decisao real indeterminada nunca produz concordou true/false, so null', async () => {
  const fetchOk: typeof fetch = () => Promise.resolve(respostaJson(envelopeSucesso('nenhuma_apenas_conversar', 'alta')));
  const resultado = await compararComSombraCapacidadeV2({
    ...ENTRADA_BASE,
    decisaoAtual: 'clinica_sem_catalogo', // mapeia para 'indeterminado'
    fetchInjetado: fetchOk,
  });
  assert.equal(resultado.estado, 'ok');
  assert.equal(resultado.capacidade_mapeada_atual, 'indeterminado');
  assert.equal(resultado.concordou, null);
});

test('resultado de falha SEMPRE inclui decisao_atual e capacidade_mapeada_atual, mesmo sem chamar o modelo', async () => {
  const fetchFalha: typeof fetch = () => Promise.reject(new Error('falhou'));
  const resultado = await compararComSombraCapacidadeV2({
    ...ENTRADA_BASE,
    decisaoAtual: 'reserva_criada',
    fetchInjetado: fetchFalha,
  });
  assert.equal(resultado.decisao_atual, 'reserva_criada');
  assert.equal(resultado.capacidade_mapeada_atual, 'criar_agendamento');
});

test('registrarResultadoSombra: log nunca contem texto de mensagem nem historico (sem PII por construcao de tipo)', () => {
  const resultado: ResultadoComparacaoSombra = {
    decisao_atual: 'saudacao',
    capacidade_mapeada_atual: 'nenhuma_apenas_conversar',
    capacidade_v2: 'nenhuma_apenas_conversar',
    certeza_v2: 'alta',
    concordou: true,
    estado: 'ok',
    duracao_ms: 123,
  };

  const linhasCapturadas: string[] = [];
  const logOriginal = console.log;
  console.log = (linha: string) => linhasCapturadas.push(linha);
  try {
    registrarResultadoSombra(resultado);
  } finally {
    console.log = logOriginal;
  }

  assert.equal(linhasCapturadas.length, 1);
  const linha = linhasCapturadas[0]!;
  assert.match(linha, /^sombra_v2 /);
  assert.match(linha, /decisao_atual=saudacao/);
  assert.match(linha, /capacidade_v2=nenhuma_apenas_conversar/);
  assert.match(linha, /concordou=true/);
  // nao ha como a mensagem do paciente aparecer -- ResultadoComparacaoSombra
  // nao tem esse campo -- mas o teste documenta a garantia explicitamente.
  assert.equal(linha.includes('mensagens_atuais'), false);
  assert.equal(linha.includes('historico'), false);
});
