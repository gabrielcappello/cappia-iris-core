// Testes da guarda contra contaminacao de nome por escolha de profissional.
//
// CASO DE ORIGEM (conversa real, WhatsApp, 2026-08-16): o paciente escreveu
// "pode ser o dr. pablo arruda" e a ficha foi criada com `nome: "Arruda"`.
// O primeiro teste abaixo e exatamente esse turno.

import test from 'node:test';
import assert from 'node:assert/strict';

import { descartarNomeDeEscolhaDeDentista } from './guarda-nome-escolha-dentista.ts';
import type { AlteracoesDados } from './tipos.ts';

function alteracoes(campos: Record<string, string>): AlteracoesDados {
  const r: AlteracoesDados = {};
  for (const [campo, valor] of Object.entries(campos)) {
    r[campo] = { acao: 'informar', valor };
  }
  return r;
}

// ── O defeito real ─────────────────────────────────────────────────────

test('REGRESSAO: "pode ser o dr. pablo arruda" NAO grava nome do paciente', () => {
  const r = descartarNomeDeEscolhaDeDentista(
    alteracoes({ nome: 'Arruda', procedimento_id: 'consultation_evaluation' }),
    ['b8942daf-55fb-4129-acaa-da69f118d309']
  );
  assert.equal(r.descartou, true);
  assert.equal(r.alteracoes.nome, undefined, 'o sobrenome do dentista nao pode virar nome do paciente');
  // O resto do turno segue intacto -- a guarda remove SO o nome.
  assert.equal(r.alteracoes.procedimento_id?.valor, 'consultation_evaluation');
});

test('REGRESSAO: lista VAZIA NAO descarta -- nenhum profissional foi identificado', () => {
  // Defeito real (WhatsApp, 2026-08-16): "gabriel cappello cpf ... data ..."
  // fez a IA devolver `[]` (procurou um profissional chamado "Cappello" e
  // nao achou), e a versao anterior desta guarda apagou o nome do PACIENTE.
  //
  // `[]` significa que NINGUEM foi identificado -- nao ha escolha real que
  // possa ter contaminado o campo.
  const r = descartarNomeDeEscolhaDeDentista(alteracoes({ nome: 'gabriel cappello' }), []);
  assert.equal(r.descartou, false);
  assert.equal(r.alteracoes.nome?.valor, 'gabriel cappello');
});

test('REGRESSAO: o turno cadastral completo passa inteiro com lista vazia', () => {
  const r = descartarNomeDeEscolhaDeDentista(
    alteracoes({ nome: 'gabriel cappello', cpf: '06113236722', data_nascimento: '02081973' }),
    []
  );
  assert.equal(r.descartou, false);
  assert.equal(r.alteracoes.nome?.valor, 'gabriel cappello');
  assert.equal(r.alteracoes.cpf?.valor, '06113236722');
});

test('varios candidatos tambem descarta', () => {
  const r = descartarNomeDeEscolhaDeDentista(alteracoes({ nome: 'Vanesa' }), ['d1', 'd2']);
  assert.equal(r.descartou, true);
});

// ── O que a guarda NAO pode atrapalhar ─────────────────────────────────

test('sem mencao a profissional, o nome passa normalmente', () => {
  const r = descartarNomeDeEscolhaDeDentista(alteracoes({ nome: 'Gabriel', cpf: '06113236722' }), null);
  assert.equal(r.descartou, false);
  assert.equal(r.alteracoes.nome?.valor, 'Gabriel');
  assert.equal(r.alteracoes.cpf?.valor, '06113236722');
});

test('escolha de dentista SEM nome nao mexe em nada', () => {
  const entrada = alteracoes({ procedimento_id: 'proc-1' });
  const r = descartarNomeDeEscolhaDeDentista(entrada, ['d1']);
  assert.equal(r.descartou, false);
  assert.deepEqual(r.alteracoes, entrada);
});

test('os demais campos cadastrais NUNCA sao descartados', () => {
  // So `nome` e ambiguo entre paciente e profissional. CPF, nascimento e
  // e-mail nao tem esse risco e precisam continuar passando.
  const r = descartarNomeDeEscolhaDeDentista(
    alteracoes({ nome: 'Arruda', cpf: '06113236722', data_nascimento: '1973-08-02', email: 'a@b.com' }),
    ['d1']
  );
  assert.equal(r.alteracoes.nome, undefined);
  assert.equal(r.alteracoes.cpf?.valor, '06113236722');
  assert.equal(r.alteracoes.data_nascimento?.valor, '1973-08-02');
  assert.equal(r.alteracoes.email?.valor, 'a@b.com');
});

// ── Forma ──────────────────────────────────────────────────────────────

test('funcao e pura: nao muta a entrada', () => {
  const entrada = alteracoes({ nome: 'Arruda', cpf: '1' });
  const copia = JSON.parse(JSON.stringify(entrada));
  descartarNomeDeEscolhaDeDentista(entrada, ['d1']);
  assert.deepEqual(entrada, copia, 'a entrada original nao pode ser alterada');
});

test('entrada vazia nao quebra', () => {
  assert.doesNotThrow(() => descartarNomeDeEscolhaDeDentista({}, ['d1']));
  assert.doesNotThrow(() => descartarNomeDeEscolhaDeDentista({}, null));
});
