// Testes de dentistas-da-clinica.ts.
//
// Cenario base: o cadastro REAL da ClearDent em 2026-08-18 -- Diego Ramoz
// ativo com 46 procedimentos, Pablo Arruda INATIVO com 30.

import test from 'node:test';
import assert from 'node:assert/strict';

import { derivarDentistasDaClinica } from './dentistas-da-clinica.ts';
import type { ProcedimentoComEspecialidade } from './dentistas-da-clinica.ts';
import type { DentistaOficial, VinculoDentistaProcedimento } from './dentista-tipos.ts';

const CLINICA = 'clinica-1';

function dentista(id: string, nome: string, ativo: boolean): DentistaOficial {
  return { dentista_id: id, clinica_id: CLINICA, nome_exibido: nome, ativo };
}
function vinculo(dentistaId: string, procedimentoId: string, ativo = true): VinculoDentistaProcedimento {
  return { clinica_id: CLINICA, dentista_id: dentistaId, procedimento_id: procedimentoId, ativo };
}
function procedimento(id: string, nome: string, especialidade?: string, ativo = true): ProcedimentoComEspecialidade {
  return { procedimento_id: id, clinica_id: CLINICA, nome_pt: nome, ativo, ...(especialidade !== undefined ? { especialidade } : {}) };
}

const PROCEDIMENTOS = [
  procedimento('p1', 'Limpeza dental', 'Clínico Geral'),
  procedimento('p2', 'Consulta / Avaliação', 'Clínico Geral'),
  procedimento('p3', 'Canal molar', 'Endodontia'),
  procedimento('p4', 'Colocação de braquetes', 'Ortodontia'),
];

test('CASO REAL: dentista INATIVO nao e oferecido ao paciente', () => {
  // Pablo Arruda esta ativo:false no cadastro real -- oferecer o nome dele
  // levaria o paciente a pedir uma agenda que nao existe.
  const r = derivarDentistasDaClinica(
    [dentista('d1', 'Diego Ramoz', true), dentista('d2', 'Pablo Arruda', false)],
    [vinculo('d1', 'p1'), vinculo('d2', 'p1')],
    PROCEDIMENTOS
  );
  assert.equal(r!.length, 1);
  assert.equal(r![0].nome, 'Diego Ramoz');
  assert.ok(!JSON.stringify(r).includes('Pablo'), 'dentista inativo vazou');
});

test('as especialidades saem dos procedimentos que ele REALMENTE faz, sem repetir', () => {
  const r = derivarDentistasDaClinica(
    [dentista('d1', 'Diego Ramoz', true)],
    [vinculo('d1', 'p1'), vinculo('d1', 'p2'), vinculo('d1', 'p3')],
    PROCEDIMENTOS
  );
  // p1 e p2 sao ambos "Clínico Geral" -- aparece UMA vez.
  assert.deepEqual(r![0].especialidades, ['Clínico Geral', 'Endodontia']);
});

test('vinculo INATIVO nao vira especialidade -- o dono desligou aquele procedimento', () => {
  const r = derivarDentistasDaClinica(
    [dentista('d1', 'Diego', true)],
    [vinculo('d1', 'p1'), vinculo('d1', 'p3', false)],
    PROCEDIMENTOS
  );
  assert.deepEqual(r![0].especialidades, ['Clínico Geral']);
});

test('procedimento inativo na clinica nao conta', () => {
  const r = derivarDentistasDaClinica(
    [dentista('d1', 'Diego', true)],
    [vinculo('d1', 'p1'), vinculo('d1', 'p3')],
    [PROCEDIMENTOS[0], procedimento('p3', 'Canal molar', 'Endodontia', false)]
  );
  assert.deepEqual(r![0].especialidades, ['Clínico Geral']);
});

test('vinculo de OUTRO dentista nao contamina', () => {
  const r = derivarDentistasDaClinica(
    [dentista('d1', 'Diego', true), dentista('d2', 'Ana', true)],
    [vinculo('d1', 'p1'), vinculo('d2', 'p3')],
    PROCEDIMENTOS
  );
  assert.deepEqual(r![0], { nome: 'Diego', especialidades: ['Clínico Geral'] });
  assert.deepEqual(r![1], { nome: 'Ana', especialidades: ['Endodontia'] });
});

test('dentista SEM vinculo ainda aparece -- ele atende, so nao sabemos em que', () => {
  const r = derivarDentistasDaClinica([dentista('d1', 'Diego', true)], [], PROCEDIMENTOS);
  assert.deepEqual(r, [{ nome: 'Diego' }]);
  assert.equal(r![0].especialidades, undefined, 'nunca lista vazia');
});

test('nenhum dentista ativo nao vira fato', () => {
  assert.equal(derivarDentistasDaClinica([dentista('d1', 'X', false)], [], PROCEDIMENTOS), undefined);
  assert.equal(derivarDentistasDaClinica([], [], PROCEDIMENTOS), undefined);
});

test('dentista com nome vazio nao entra -- chip/nome em branco nao ajuda ninguem', () => {
  assert.equal(derivarDentistasDaClinica([dentista('d1', '   ', true)], [], PROCEDIMENTOS), undefined);
});

test('procedimento sem especialidade nao quebra nem inventa', () => {
  const r = derivarDentistasDaClinica(
    [dentista('d1', 'Diego', true)],
    [vinculo('d1', 'p9')],
    [procedimento('p9', 'Sem especialidade')]
  );
  assert.deepEqual(r, [{ nome: 'Diego' }]);
});

test('as 10 especialidades reais do Diego saem na ordem dos procedimentos', () => {
  const nomes = ['Clínico Geral','Endodontia','Ortodontia','Implantodontia','Prótese',
                 'Periodontia','Estética','Odontopediatria','Cirurgia','Radiologia'];
  const procs = nomes.map((n, i) => procedimento(`p${i}`, `Proc ${i}`, n));
  const r = derivarDentistasDaClinica(
    [dentista('d1', 'Diego Ramoz', true)],
    procs.map((p) => vinculo('d1', p.procedimento_id)),
    procs
  );
  assert.deepEqual(r![0].especialidades, nomes);
});
