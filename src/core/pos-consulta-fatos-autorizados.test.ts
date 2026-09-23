import assert from 'node:assert/strict';
import { test } from 'node:test';
import { derivarFatosAutorizadosPosConsulta } from './pos-consulta-fatos-autorizados.ts';

test('perguntar_satisfacao nunca carrega link do Google', () => {
  const fatos = derivarFatosAutorizadosPosConsulta({ tipo: 'perguntar_satisfacao' }, {});
  assert.equal(fatos.objetivo, 'perguntar_satisfacao');
  assert.equal(fatos.link_avaliacao_google, undefined);
});

// Revisao final do Codex (bloqueador 1): o convite direto (sem satisfacao) foi
// REMOVIDO. Entre TODAS as decisoes possiveis, so UMA carrega o link do
// Google -- a que so nasce depois de satisfacao positiva confirmada.
test('so UM objetivo carrega o link do Google, com o mesmo contexto: o que segue a satisfacao positiva', () => {
  const contexto = { linkAvaliacaoGoogle: 'https://g.page/r/exemplo/review' };
  const decisoes = [
    { tipo: 'perguntar_satisfacao' },
    { tipo: 'agradecer_sem_convite' },
    { tipo: 'agradecer_e_convidar_avaliacao_google' },
  ] as const;
  const comLink = decisoes
    .filter((decisao) => derivarFatosAutorizadosPosConsulta(decisao, contexto).link_avaliacao_google !== undefined)
    .map((decisao) => decisao.tipo);
  assert.deepEqual(comLink, ['agradecer_e_convidar_avaliacao_google']);
});

test('agradecer_sem_convite nunca carrega link mesmo se o contexto tiver um configurado', () => {
  const fatos = derivarFatosAutorizadosPosConsulta(
    { tipo: 'agradecer_sem_convite' },
    { linkAvaliacaoGoogle: 'https://g.page/r/exemplo/review' }
  );
  assert.equal(fatos.objetivo, 'agradecer_sem_convite');
  assert.equal(fatos.link_avaliacao_google, undefined);
});

test('agradecer_e_convidar_avaliacao_google carrega o link', () => {
  const fatos = derivarFatosAutorizadosPosConsulta(
    { tipo: 'agradecer_e_convidar_avaliacao_google' },
    { linkAvaliacaoGoogle: 'https://g.page/r/exemplo/review' }
  );
  assert.equal(fatos.link_avaliacao_google, 'https://g.page/r/exemplo/review');
});

test('fatos ortogonais (procedimento, dentista, clinica, orientacoes) atravessam sem mudar o objetivo', () => {
  const fatos = derivarFatosAutorizadosPosConsulta(
    { tipo: 'perguntar_satisfacao' },
    {
      atendimento: { procedimentoNomeExibido: 'Limpeza', dentistaNomeExibido: 'Dra. Ana' },
      nomeClinica: 'Clinica Sorriso',
      orientacoesClinica: 'seja bem informal',
    }
  );
  assert.equal(fatos.objetivo, 'perguntar_satisfacao');
  assert.equal(fatos.procedimento_confirmado, 'Limpeza');
  assert.equal(fatos.dentista_confirmado, 'Dra. Ana');
  assert.equal(fatos.nome_clinica, 'Clinica Sorriso');
  assert.equal(fatos.orientacoes_clinica, 'seja bem informal');
});

test('orientacoes da clinica em branco nunca vira fato (mesma disciplina de ausencia, nunca vazio)', () => {
  const fatos = derivarFatosAutorizadosPosConsulta({ tipo: 'perguntar_satisfacao' }, { orientacoesClinica: '   ' });
  assert.equal(fatos.orientacoes_clinica, undefined);
});

// Par A/B -- so o objetivo muda entre 'agradecer_e_convidar_avaliacao_google' e
// 'agradecer_sem_convite'; a presenca do link tem que DIFERIR.
test('par A/B -- so o objetivo que convida carrega link, com o mesmo contexto', () => {
  const contexto = { linkAvaliacaoGoogle: 'https://g.page/r/exemplo/review' };
  const convida = derivarFatosAutorizadosPosConsulta({ tipo: 'agradecer_e_convidar_avaliacao_google' }, contexto);
  const naoConvida = derivarFatosAutorizadosPosConsulta({ tipo: 'agradecer_sem_convite' }, contexto);
  assert.notEqual(convida.link_avaliacao_google, naoConvida.link_avaliacao_google);
  assert.equal(convida.link_avaliacao_google, contexto.linkAvaliacaoGoogle);
  assert.equal(naoConvida.link_avaliacao_google, undefined);
});
