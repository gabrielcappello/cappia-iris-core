import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ErroTransicaoJornadaPosConsulta,
  iniciarJornada,
  registrarRespostaSatisfacao,
} from './pos-consulta-jornada.ts';

// --- iniciarJornada -------------------------------------------------------

test('modo satisfacao inicia perguntando e fica aguardando_satisfacao', () => {
  const resultado = iniciarJornada({ modo: 'satisfacao' });
  assert.deepEqual(resultado, { etapaInicial: 'aguardando_satisfacao', decisao: { tipo: 'perguntar_satisfacao' } });
});

test('modo ambos inicia perguntando e fica aguardando_satisfacao (criterio de aceite 3)', () => {
  const resultado = iniciarJornada({ modo: 'ambos' });
  assert.equal(resultado.etapaInicial, 'aguardando_satisfacao');
  assert.deepEqual(resultado.decisao, { tipo: 'perguntar_satisfacao' });
});

// Revisao final do Codex (bloqueador 1): o modo 'google' PERGUNTA primeiro,
// como os demais -- nenhum modo envia Google sem satisfacao positiva
// confirmada. O convite direto (etapa 'encerrada' no turno 0) nao existe mais.
test('modo google tambem pergunta primeiro e fica aguardando_satisfacao (nao convida direto)', () => {
  const resultado = iniciarJornada({ modo: 'google' });
  assert.deepEqual(resultado, { etapaInicial: 'aguardando_satisfacao', decisao: { tipo: 'perguntar_satisfacao' } });
});

test('nenhum modo autoriza convite ao Google no turno 0 (a decisao inicial e sempre perguntar_satisfacao)', () => {
  for (const modo of ['satisfacao', 'google', 'ambos'] as const) {
    const resultado = iniciarJornada({ modo });
    assert.equal(resultado.decisao.tipo, 'perguntar_satisfacao', `modo ${modo}`);
    assert.equal(resultado.etapaInicial, 'aguardando_satisfacao', `modo ${modo}`);
  }
});

// --- registrarRespostaSatisfacao -----------------------------------------

test('criterio 1 -- modo satisfacao com resposta positiva nunca envia link', () => {
  const resultado = registrarRespostaSatisfacao({
    etapaAtual: 'aguardando_satisfacao',
    modo: 'satisfacao',
    classificacao: 'positiva',
  });
  assert.deepEqual(resultado, { etapaNova: 'encerrada', decisao: { tipo: 'agradecer_sem_convite' } });
});

test('modo satisfacao com resposta negativa tambem nunca envia link', () => {
  const resultado = registrarRespostaSatisfacao({
    etapaAtual: 'aguardando_satisfacao',
    modo: 'satisfacao',
    classificacao: 'nao_positiva',
  });
  assert.deepEqual(resultado.decisao, { tipo: 'agradecer_sem_convite' });
});

test('criterio 4 -- modo ambos com resposta positiva autoriza convite', () => {
  const resultado = registrarRespostaSatisfacao({
    etapaAtual: 'aguardando_satisfacao',
    modo: 'ambos',
    classificacao: 'positiva',
  });
  assert.deepEqual(resultado, {
    etapaNova: 'encerrada',
    decisao: { tipo: 'agradecer_e_convidar_avaliacao_google' },
  });
});

test('criterio 5 -- modo ambos com resposta negativa nunca envia link', () => {
  const resultado = registrarRespostaSatisfacao({
    etapaAtual: 'aguardando_satisfacao',
    modo: 'ambos',
    classificacao: 'nao_positiva',
  });
  assert.deepEqual(resultado.decisao, { tipo: 'agradecer_sem_convite' });
});

test('criterio 5 -- modo ambos com resposta incerta nunca envia link', () => {
  const resultado = registrarRespostaSatisfacao({
    etapaAtual: 'aguardando_satisfacao',
    modo: 'ambos',
    classificacao: 'incerta',
  });
  assert.deepEqual(resultado.decisao, { tipo: 'agradecer_sem_convite' });
});

// Revisao final do Codex (bloqueador 1): o modo 'google' segue a MESMA regra do
// 'ambos' depois da resposta -- so a positiva convida.
test('modo google com resposta positiva autoriza o convite (unico caminho ate o link)', () => {
  const resultado = registrarRespostaSatisfacao({ etapaAtual: 'aguardando_satisfacao', modo: 'google', classificacao: 'positiva' });
  assert.deepEqual(resultado, { etapaNova: 'encerrada', decisao: { tipo: 'agradecer_e_convidar_avaliacao_google' } });
});

test('modo google com resposta nao positiva ou incerta nunca envia link', () => {
  for (const classificacao of ['nao_positiva', 'incerta'] as const) {
    const resultado = registrarRespostaSatisfacao({ etapaAtual: 'aguardando_satisfacao', modo: 'google', classificacao });
    assert.deepEqual(resultado.decisao, { tipo: 'agradecer_sem_convite' }, classificacao);
  }
});

// Matriz completa modo x classificacao: o link so aparece em (google|ambos) x positiva.
test('matriz modo x classificacao -- o convite so existe com satisfacao POSITIVA em modo com Google', () => {
  const convidam: string[] = [];
  for (const modo of ['satisfacao', 'google', 'ambos'] as const) {
    for (const classificacao of ['positiva', 'nao_positiva', 'incerta'] as const) {
      const r = registrarRespostaSatisfacao({ etapaAtual: 'aguardando_satisfacao', modo, classificacao });
      if (r.decisao.tipo === 'agradecer_e_convidar_avaliacao_google') convidam.push(`${modo}/${classificacao}`);
    }
  }
  assert.deepEqual(convidam, ['google/positiva', 'ambos/positiva']);
});

// Par A/B -- so a classificacao muda entre positiva e nao_positiva no modo
// 'ambos'; os desfechos tem que DIFERIR.
test('par A/B -- no modo ambos, so a classificacao positiva convida', () => {
  const positiva = registrarRespostaSatisfacao({
    etapaAtual: 'aguardando_satisfacao',
    modo: 'ambos',
    classificacao: 'positiva',
  });
  const naoPositiva = registrarRespostaSatisfacao({
    etapaAtual: 'aguardando_satisfacao',
    modo: 'ambos',
    classificacao: 'nao_positiva',
  });
  assert.notDeepEqual(positiva, naoPositiva);
});

test('jornada ja encerrada nunca reprocessa resposta -- erro de programacao explicito', () => {
  assert.throws(
    () =>
      registrarRespostaSatisfacao({
        etapaAtual: 'encerrada',
        modo: 'ambos',
        classificacao: 'positiva',
      }),
    ErroTransicaoJornadaPosConsulta
  );
});

test('jornada em aguardando_inicio nunca aceita resposta de satisfacao', () => {
  assert.throws(
    () =>
      registrarRespostaSatisfacao({
        etapaAtual: 'aguardando_inicio',
        modo: 'satisfacao',
        classificacao: 'positiva',
      }),
    ErroTransicaoJornadaPosConsulta
  );
});
