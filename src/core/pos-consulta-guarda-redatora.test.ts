import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verificarRespostaRedatoraPosConsulta } from './pos-consulta-guarda-redatora.ts';
import { derivarFatosAutorizadosPosConsulta } from './pos-consulta-fatos-autorizados.ts';
import type { FatosAutorizadosPosConsulta } from './pos-consulta-fatos-autorizados.ts';

const LINK = 'https://g.page/r/exemplo/review';

test('texto vazio e sempre reprovado', () => {
  const resultado = verificarRespostaRedatoraPosConsulta('   ', { objetivo: 'perguntar_satisfacao' });
  assert.deepEqual(resultado, { aprovado: false, motivo: 'texto_vazio' });
});

test('perguntar_satisfacao com texto normal e aprovado', () => {
  const resultado = verificarRespostaRedatoraPosConsulta('Oi! Como foi sua consulta?', {
    objetivo: 'perguntar_satisfacao',
  });
  assert.deepEqual(resultado, { aprovado: true });
});

test('convite com o link presente e aprovado', () => {
  const fatos: FatosAutorizadosPosConsulta = { objetivo: 'agradecer_e_convidar_avaliacao_google', link_avaliacao_google: LINK };
  const resultado = verificarRespostaRedatoraPosConsulta(`Avalie a gente aqui: ${LINK}`, fatos);
  assert.deepEqual(resultado, { aprovado: true });
});

test('convite com o link seguido de pontuacao de frase ainda e reconhecido', () => {
  const fatos: FatosAutorizadosPosConsulta = { objetivo: 'agradecer_e_convidar_avaliacao_google', link_avaliacao_google: LINK };
  const resultado = verificarRespostaRedatoraPosConsulta(`Avalie a gente aqui: ${LINK}.`, fatos);
  assert.deepEqual(resultado, { aprovado: true });
});

test('convite SEM o link no texto e reprovado (link_ausente)', () => {
  const fatos: FatosAutorizadosPosConsulta = { objetivo: 'agradecer_e_convidar_avaliacao_google', link_avaliacao_google: LINK };
  const resultado = verificarRespostaRedatoraPosConsulta('Ficamos felizes em atender voce!', fatos);
  assert.deepEqual(resultado, { aprovado: false, motivo: 'link_ausente' });
});

// ── B7: correcao da guarda -- QUALQUER URL e barrada quando o objetivo nao
// autoriza convite, mesmo sem o link estar presente nos fatos (o caso real:
// derivarFatosAutorizadosPosConsulta NUNCA inclui link_avaliacao_google
// para este objetivo). ──────────────────────────────────────────────────
test('B7 -- agradecer_sem_convite com URL fabricada pela redatora e reprovado, mesmo sem link nos fatos', () => {
  const fatos: FatosAutorizadosPosConsulta = { objetivo: 'agradecer_sem_convite' };
  const resultado = verificarRespostaRedatoraPosConsulta(`Obrigado! Avalie aqui: ${LINK}`, fatos);
  assert.deepEqual(resultado, { aprovado: false, motivo: 'link_nao_autorizado' });
});

test('B7 -- agradecer_sem_convite com URL DIFERENTE da configurada tambem e reprovado', () => {
  const fatos: FatosAutorizadosPosConsulta = { objetivo: 'agradecer_sem_convite' };
  const resultado = verificarRespostaRedatoraPosConsulta('Obrigado! Avalie aqui: https://outro-dominio.exemplo/x', fatos);
  assert.deepEqual(resultado, { aprovado: false, motivo: 'link_nao_autorizado' });
});

test('B7 -- convite com uma SEGUNDA url alem da configurada e reprovado (nao so a ausencia da correta)', () => {
  const fatos: FatosAutorizadosPosConsulta = { objetivo: 'agradecer_e_convidar_avaliacao_google', link_avaliacao_google: LINK };
  const resultado = verificarRespostaRedatoraPosConsulta(
    `Avalie aqui: ${LINK} ou tambem em https://outro-dominio.exemplo/x`,
    fatos
  );
  assert.deepEqual(resultado, { aprovado: false, motivo: 'link_nao_autorizado' });
});

test('B7 -- convite sem link algum configurado nos fatos (nao deveria ocorrer no caminho real) nunca aprova cegamente', () => {
  const fatos: FatosAutorizadosPosConsulta = { objetivo: 'agradecer_e_convidar_avaliacao_google' };
  const semUrl = verificarRespostaRedatoraPosConsulta('Ficamos felizes em atender voce!', fatos);
  const comUrl = verificarRespostaRedatoraPosConsulta(`Avalie aqui: ${LINK}`, fatos);
  assert.deepEqual(semUrl, { aprovado: false, motivo: 'link_ausente' });
  assert.deepEqual(comUrl, { aprovado: false, motivo: 'link_nao_autorizado' });
});

test('agradecer_e_convidar_avaliacao_google exige o link no texto', () => {
  const fatos: FatosAutorizadosPosConsulta = {
    objetivo: 'agradecer_e_convidar_avaliacao_google',
    link_avaliacao_google: LINK,
  };
  const aprovado = verificarRespostaRedatoraPosConsulta(`Que otimo! Avalie aqui: ${LINK}`, fatos);
  const reprovado = verificarRespostaRedatoraPosConsulta('Que otimo saber disso!', fatos);
  assert.deepEqual(aprovado, { aprovado: true });
  assert.deepEqual(reprovado, { aprovado: false, motivo: 'link_ausente' });
});

// Par A/B -- so o objetivo muda entre convidar e nao convidar, com o MESMO
// texto (que cita o link); os desfechos tem que DIFERIR.
test('par A/B -- o mesmo texto com link e aprovado quando autorizado e reprovado quando nao', () => {
  const textoComLink = `Obrigado! Avalie aqui: ${LINK}`;
  const autorizado = verificarRespostaRedatoraPosConsulta(textoComLink, {
    objetivo: 'agradecer_e_convidar_avaliacao_google',
    link_avaliacao_google: LINK,
  });
  const naoAutorizado = verificarRespostaRedatoraPosConsulta(textoComLink, { objetivo: 'agradecer_sem_convite' });
  assert.notDeepEqual(autorizado, naoAutorizado);
  assert.equal(autorizado.aprovado, true);
  assert.equal(naoAutorizado.aprovado, false);
});

// ── Caminho REAL, ponta a ponta: decisao -> fatos -> (redatora simulada) ->
// guarda -- exigido pela revisao (B7): "nao um objeto de fatos impossivel
// construido a mao". ──────────────────────────────────────────────────────
test('caminho real -- decisao agradecer_sem_convite produz fatos SEM link, e uma URL fabricada e barrada', () => {
  const fatosReais = derivarFatosAutorizadosPosConsulta(
    { tipo: 'agradecer_sem_convite' },
    { linkAvaliacaoGoogle: LINK } // a clinica TEM um link configurado, mas este objetivo nao o recebe
  );
  assert.equal(fatosReais.link_avaliacao_google, undefined); // confirma a premissa do achado B7

  const textoFabricado = `Obrigado pelo retorno! Se quiser, avalie a clinica aqui: ${LINK}`;
  const resultado = verificarRespostaRedatoraPosConsulta(textoFabricado, fatosReais);
  assert.deepEqual(resultado, { aprovado: false, motivo: 'link_nao_autorizado' });
});

test('caminho real -- decisao agradecer_e_convidar_avaliacao_google produz fatos COM link, e o texto correspondente e aprovado', () => {
  const fatosReais = derivarFatosAutorizadosPosConsulta(
    { tipo: 'agradecer_e_convidar_avaliacao_google' },
    { linkAvaliacaoGoogle: LINK }
  );
  const resultado = verificarRespostaRedatoraPosConsulta(`Avalie a gente aqui: ${LINK}`, fatosReais);
  assert.deepEqual(resultado, { aprovado: true });
});

// Revisao final do Codex (bloqueador 1): a PRIMEIRA entrega nunca e convite,
// em nenhum modo. Nenhuma URL pode passar no objetivo perguntar_satisfacao --
// nem a configurada, nem uma fabricada.
test('perguntar_satisfacao com QUALQUER URL e reprovado (a primeira entrega nunca convida)', () => {
  const comLinkConfigurado = verificarRespostaRedatoraPosConsulta(`Como foi? Avalie aqui: ${LINK}`, {
    objetivo: 'perguntar_satisfacao',
  });
  const comLinkNosFatos = verificarRespostaRedatoraPosConsulta(`Como foi? Avalie aqui: ${LINK}`, {
    objetivo: 'perguntar_satisfacao',
    link_avaliacao_google: LINK,
  });
  assert.deepEqual(comLinkConfigurado, { aprovado: false, motivo: 'link_nao_autorizado' });
  assert.deepEqual(comLinkNosFatos, { aprovado: false, motivo: 'link_nao_autorizado' });
});
