// Testes de `aguardando-resposta.ts` -- a leitura da pergunta que a Iris fez
// no turno anterior (spec contexto-conversacional-unificado-v2.md secao 14.6).
//
// O QUE ESTES TESTES PROVAM: que as TRES situacoes sao distinguidas, e
// especialmente que `invalido` NUNCA colapsa em `ausente`. Essa distincao e o
// motivo do modulo existir: `ausente` significa "nao ha pergunta em aberto" --
// uma afirmacao factual --, e dado corrompido nao autoriza essa afirmacao.

import test from 'node:test';
import assert from 'node:assert/strict';

import { lerAguardandoResposta, perguntaOuNull } from './aguardando-resposta.ts';

// ── AUSENTE: o caso normal, nunca uma recusa ────────────────────────────

test('coluna nula e AUSENTE -- caso normal, nao e erro', () => {
  assert.deepEqual(lerAguardandoResposta(null), { situacao: 'ausente' });
});

test('coluna indefinida e AUSENTE', () => {
  assert.deepEqual(lerAguardandoResposta(undefined), { situacao: 'ausente' });
});

// ── PRESENTE: valor valido, ja tipado ───────────────────────────────────

test('pergunta simples valida e PRESENTE', () => {
  const r = lerAguardandoResposta({ tipo: 'escolha_dentista' });
  assert.equal(r.situacao, 'presente');
  if (r.situacao !== 'presente') return;
  assert.equal(r.pergunta.tipo, 'escolha_dentista');
});

test('confirmacao de cancelamento com alvo e PRESENTE e preserva os campos', () => {
  const r = lerAguardandoResposta({
    tipo: 'confirmacao',
    operacao: 'cancelar',
    agendamento_id: 'ag-1',
  });
  assert.equal(r.situacao, 'presente');
  if (r.situacao !== 'presente') return;
  assert.equal(r.pergunta.operacao, 'cancelar');
  assert.equal(r.pergunta.agendamento_id, 'ag-1');
});

test('escolha de horario com opcoes e PRESENTE e preserva a lista', () => {
  const r = lerAguardandoResposta({
    tipo: 'escolha_horario',
    opcoes: ['20/08 10:00', '20/08 14:00'],
  });
  assert.equal(r.situacao, 'presente');
  if (r.situacao !== 'presente') return;
  assert.deepEqual(r.pergunta.opcoes, ['20/08 10:00', '20/08 14:00']);
});

// ── INVALIDO: o ponto do modulo -- malformado NUNCA vira ausente ────────

test('MALFORMADO NUNCA VIRA AUSENTE -- e a invariante central da secao 14.6', () => {
  // Cada um destes seria indistinguivel de "sem pergunta" se o modulo
  // degradasse para `null` como faz `contexto_horarios`.
  const corrompidos: unknown[] = [
    {},                                          // objeto sem tipo
    { tipo: 'inventado' },                       // fora do vocabulario
    { tipo: 'confirmacao' },                     // confirmacao exige operacao
    { tipo: 'confirmacao', operacao: 'criar', agendamento_id: 'ag-1' }, // criar proibe alvo
    { tipo: 'confirmacao', operacao: 'consultar' },  // consultar nao confirma
    { tipo: 'escolha_agendamento', operacao: 'criar' }, // criar nao cabe aqui
    { tipo: 'escolha_dentista', extra: 'x' },    // chave desconhecida
    { tipo: 'escolha_dentista', opcoes: 'nao-e-array' },
    'confirmacao',                               // string crua
    42,
    [],
    true,
  ];
  for (const bruto of corrompidos) {
    const r = lerAguardandoResposta(bruto);
    assert.equal(r.situacao, 'invalido', `deveria ser invalido: ${JSON.stringify(bruto)}`);
    assert.equal(r.situacao === 'invalido' && typeof r.motivo, 'string');
  }
});

test('invalido carrega motivo legivel, para o log de desvio', () => {
  const r = lerAguardandoResposta({ tipo: 'inventado' });
  assert.equal(r.situacao, 'invalido');
  if (r.situacao !== 'invalido') return;
  assert.match(r.motivo, /valor desconhecido/);
});

test('nunca lanca excecao, qualquer que seja a entrada', () => {
  for (const bruto of [null, undefined, {}, [], 0, '', NaN, Symbol('x'), () => {}]) {
    assert.doesNotThrow(() => lerAguardandoResposta(bruto as unknown));
  }
});

// ── perguntaOuNull: atalho, com o limite declarado ──────────────────────

test('perguntaOuNull devolve a pergunta quando presente', () => {
  const r = lerAguardandoResposta({ tipo: 'cadastro' });
  assert.equal(perguntaOuNull(r)?.tipo, 'cadastro');
});

test('perguntaOuNull devolve null para ausente E para invalido -- por isso nao serve para decidir rota', () => {
  assert.equal(perguntaOuNull(lerAguardandoResposta(null)), null);
  assert.equal(perguntaOuNull(lerAguardandoResposta({ tipo: 'inventado' })), null);
  // As duas chamadas acima devolvem `null` igual -- e exatamente por isso que
  // a decisao de rota tem que olhar `situacao`, nunca este atalho.
});
