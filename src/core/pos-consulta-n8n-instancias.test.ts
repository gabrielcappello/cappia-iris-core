// E1 (quinta revisao) -- "instancia_whatsapp" x "whatsapp_instancia" no
// workflow n8n do Disparo A, testados com valores DIFERENTES.
//
// POR QUE AQUI E NAO NO RUNNER SQL: ao rodar o runner contra o schema
// operacional (tipos gerados + migrations-legado), descobriu-se que
// `clinicas.instancia_whatsapp` e uma coluna GERADA (= `whatsapp_instancia`)
// -- no banco as duas nunca divergem, entao nao ha como gravar valores
// diferentes nelas. O ponto onde os dois campos PODEM divergir (e onde uma
// troca de campo causaria dano) e o payload do candidato dentro do n8n: este
// teste avalia as expressoes REAIS do JSON entregue, com um candidato cujos
// dois campos tem valores propositalmente distintos.
//
// Regras provadas:
//   - `instancia_whatsapp` (resolve/autentica a clinica na Edge Function) vai
//     nos payloads de "iniciar" e "confirmar" -- nunca `whatsapp_instancia`;
//   - `whatsapp_instancia` so aparece como `instanceName` do node Evolution;
//   - o telefone do envio vem da RESPOSTA da Edge Function (relido, C2), nunca
//     do candidato pre-filtro.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAMINHO = resolve(__dirname, '../../supabase/functions/iris-nova-pos-consulta/n8n-workflow-pos-consulta-iniciar.json');
const workflow = JSON.parse(readFileSync(CAMINHO, 'utf8'));

const NO_CANDIDATOS = 'Buscar candidatos (RPC cappia_pos_consulta_candidatos)';
const NO_INICIAR = 'Chamar iris-nova-pos-consulta (iniciar ou recuperar)';

function no(nome: string) {
  const n = workflow.nodes.find((x: { name: string }) => x.name === nome);
  assert.ok(n, `node "${nome}" nao encontrado no workflow`);
  return n;
}

/** Avalia uma expressao n8n `={{ ... }}` com o contexto dado (so o que estas expressoes usam). */
function avaliar(expressao: string, ctx: { json: unknown; nodes: Record<string, unknown> }): unknown {
  assert.match(expressao, /^=\{\{[\s\S]*\}\}$/, 'esperava uma expressao n8n ={{ ... }}');
  const interna = expressao.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const dollar = (nomeNode: string) => {
    if (!(nomeNode in ctx.nodes)) throw new Error(`expressao referencia node fora do contexto do teste: ${nomeNode}`);
    return { item: { json: ctx.nodes[nomeNode] } };
  };
  return new Function('$json', '$env', '$', `return (${interna});`)(ctx.json, { IRIS_NOVA_PROVIDER: 'evolution' }, dollar);
}

const AUTH = 'AUTH-INSTANCIA-X';
const EVO = 'EVO-INSTANCIA-Y';
assert.notEqual(AUTH, EVO);

const candidato = {
  clinica_id: 'cli-1',
  agendamento_id: 'ag-1',
  paciente_id: 'pac-1',
  instancia_whatsapp: AUTH,
  whatsapp_instancia: EVO,
  nome_clinica: 'Clinica X',
  procedimento_nome_exibido: 'Limpeza',
  dentista_nome_exibido: 'Dra. Ana',
  acao_edge: 'iniciar',
  // Chamariz: se algum node usasse o telefone do candidato, este valor apareceria.
  telefone_normalizado: 'TELEFONE-DO-CANDIDATO-NAO-DEVE-SER-USADO',
};
const respostaIniciar = {
  resultado: 'entrega_pendente',
  resposta: 'Ola! Como foi sua consulta?',
  telefone_normalizado: '5511999990000',
  confirmacao: { agendamentoId: 'ag-1', entregaId: 'en-1', claimToken: 'TOKEN-1' },
};

test('"iniciar" envia instancia_whatsapp (autenticacao) -- e NUNCA whatsapp_instancia', () => {
  const corpo = avaliar(no(NO_INICIAR).parameters.jsonBody, { json: candidato, nodes: {} }) as string;
  const payload = JSON.parse(corpo);
  assert.equal(payload.instancia_whatsapp, AUTH);
  assert.ok(!corpo.includes(EVO), 'o valor de whatsapp_instancia nao pode aparecer no payload da Edge Function');
  assert.equal(payload.acao, 'iniciar');
});

// Sexta revisao do Codex (bloqueador 1): a mesma chamada atende a recuperacao -- a `acao` vem do candidato.
test('a acao enviada a Edge vem do candidato: iniciar (novo) ou recuperar (entrega pendente com lease vencido)', () => {
  for (const acao of ['iniciar', 'recuperar']) {
    const corpo = avaliar(no(NO_INICIAR).parameters.jsonBody, { json: { ...candidato, acao_edge: acao }, nodes: {} }) as string;
    const payload = JSON.parse(corpo);
    assert.equal(payload.acao, acao);
    assert.equal(payload.instancia_whatsapp, AUTH);
    assert.equal(payload.agendamento_id, 'ag-1');
    assert.equal(payload.paciente_id, 'pac-1');
    assert.ok(!corpo.includes(EVO));
  }
});

test('a recuperacao envia SO identificadores e cosmeticos: nunca telefone, link nem decisao do candidato', () => {
  const corpo = avaliar(no(NO_INICIAR).parameters.jsonBody, { json: { ...candidato, acao_edge: 'recuperar' }, nodes: {} }) as string;
  assert.deepEqual(Object.keys(JSON.parse(corpo)).sort(), ['acao', 'agendamento_id', 'dentista_nome_exibido', 'instancia_whatsapp', 'nome_clinica', 'paciente_id', 'procedimento_nome_exibido', 'provider']);
  assert.ok(!corpo.includes('TELEFONE-DO-CANDIDATO-NAO-DEVE-SER-USADO'));
});

test('node Evolution usa whatsapp_instancia como instanceName -- e NUNCA instancia_whatsapp', () => {
  const instanceName = avaliar(no('Enviar via Evolution').parameters.instanceName, {
    json: respostaIniciar,
    nodes: { [NO_CANDIDATOS]: candidato },
  });
  assert.equal(instanceName, EVO);
  assert.notEqual(instanceName, AUTH);
});

test('o telefone do envio vem da RESPOSTA da Edge Function (relido), nunca do candidato pre-filtro', () => {
  const remoteJid = avaliar(no('Enviar via Evolution').parameters.remoteJid, {
    json: respostaIniciar,
    nodes: { [NO_CANDIDATOS]: candidato },
  });
  assert.equal(remoteJid, '5511999990000');
  assert.notEqual(remoteJid, candidato.telefone_normalizado);
  const texto = avaliar(no('Enviar via Evolution').parameters.messageText, { json: respostaIniciar, nodes: {} });
  assert.equal(texto, respostaIniciar.resposta);
});

test('"confirmar" envia instancia_whatsapp (autenticacao), agendamento do candidato e claim_token da resposta de "iniciar"', () => {
  const corpo = avaliar(no('Chamar iris-nova-pos-consulta (confirmar)').parameters.jsonBody, {
    json: {},
    nodes: { [NO_CANDIDATOS]: candidato, [NO_INICIAR]: respostaIniciar },
  }) as string;
  const payload = JSON.parse(corpo);
  assert.equal(payload.acao, 'confirmar');
  assert.equal(payload.instancia_whatsapp, AUTH);
  assert.ok(!corpo.includes(EVO), 'o valor de whatsapp_instancia nao pode aparecer no payload de confirmar');
  assert.equal(payload.agendamento_id, 'ag-1');
  assert.equal(payload.claim_token, 'TOKEN-1');
});

// ── Sexta revisao do Codex, bloqueador 1: robustez do lote e confirmacao ─────────
test('falha de UM item nao derruba o lote: a chamada a Edge e o envio continuam em erro (sem bloqueio de cabeca de fila)', () => {
  assert.equal(no(NO_INICIAR).onError, 'continueRegularOutput');
  assert.equal(no('Enviar via Evolution').onError, 'continueRegularOutput');
  // o IF que separa "ha entrega pendente" precisa aceitar o item de erro (sem `resultado`)
  assert.equal(no('Ha entrega pendente?').parameters.conditions.options.typeValidation, 'loose');
});

test('um item de erro do envio NUNCA chega a confirmar (o classificador o marca como nao confirmado)', () => {
  const codigo = no('Classificar resultado Evolution').parameters.jsCode as string;
  const classificar = new Function('$json', codigo); // o codigo do node e um corpo de funcao (retorna { json })
  const resultado = (classificar as (j: unknown) => { json: { envio_confirmado: boolean } })({ error: 'Bad Request: exists false' });
  assert.equal(resultado.json.envio_confirmado, false);
});

test('confirmar tem retry (roda DEPOIS do envio: falhar de vez reenviaria na recuperacao)', () => {
  const confirmar = no('Chamar iris-nova-pos-consulta (confirmar)');
  assert.equal(confirmar.retryOnFail, true);
  assert.equal(confirmar.maxTries, 3);
  assert.ok(confirmar.waitBetweenTries >= 1000);
});

test('nenhuma referencia ao nome antigo do node da Edge sobrou no workflow', () => {
  assert.ok(!JSON.stringify(workflow).includes('Chamar iris-nova-pos-consulta (iniciar)'));
});

// ── Setima revisao, item 3: expiracao silenciosa de jornadas sem resposta ────────
const NO_EXPIRACAO = 'Encerrar jornadas sem resposta (RPC cappia_pos_consulta_encerrar_sem_resposta)';

test('o node de expiracao chama a RPC direto (REST), com a credencial REST e limite numerico', () => {
  const n = no(NO_EXPIRACAO);
  assert.ok(String(n.parameters.url).endsWith('/rest/v1/rpc/cappia_pos_consulta_encerrar_sem_resposta'));
  assert.equal(n.parameters.genericAuthType, 'httpHeaderAuth');
  assert.equal(n.credentials.httpHeaderAuth.name, 'Supabase REST (service_role)');
  const corpo = JSON.parse(avaliar(n.parameters.jsonBody, { json: {}, nodes: {} }) as string);
  assert.deepEqual(corpo, { p_limit: 200 });
});

test('a expiracao roda em paralelo a busca de candidatos, NAO alimenta o envio e uma falha dela nao derruba o ciclo', () => {
  const conexoes = workflow.connections;
  const destinosGatilho = conexoes['A cada 15 minutos'].main[0].map((x: { node: string }) => x.node);
  assert.deepEqual(destinosGatilho.sort(), [NO_CANDIDATOS, NO_EXPIRACAO].sort());
  assert.equal(conexoes[NO_EXPIRACAO], undefined, 'o node de expiracao nao tem saida: nunca chega a Edge, ao Evolution nem a confirmar');
  assert.equal(no(NO_EXPIRACAO).onError, 'continueRegularOutput');
});

test('o workflow so envia por UM caminho: a Edge Function (nenhum node de envio recebe dados da expiracao)', () => {
  const alcancaveis = new Set<string>();
  const visitar = (nome: string) => {
    if (alcancaveis.has(nome)) return;
    alcancaveis.add(nome);
    for (const ramo of workflow.connections[nome]?.main ?? []) for (const d of ramo) visitar(d.node);
  };
  visitar(NO_EXPIRACAO);
  assert.deepEqual([...alcancaveis], [NO_EXPIRACAO]);
});

// ── Setima revisao, itens 1 e 2: a selecao de candidatos nao deixa jornada orfa ───
test('a nota do node de candidatos documenta vinculo rompido e automacao desligada', () => {
  const notas = no(NO_CANDIDATOS).notes as string;
  assert.match(notas, /abandonada_vinculo_invalido/);
  assert.match(notas, /abandonada_automacao_desligada/);
  assert.match(notas, /LEFT JOIN/);
});
