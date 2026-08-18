// GUARDA DE FRONTEIRA: os dados da clinica e os precos precisam ATRAVESSAR
// toda a cadeia ate os fatos que a redatora recebe.
//
// ── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────
// O defeito que originou este trabalho foi exatamente esse: `nomeClinica`
// existia em TRES camadas do contrato (EntradaRedator,
// GerarRespostaConversacionalEntrada, corpo HTTP) e era repassado adiante --
// mas ninguem jamais o preenchia a partir do banco. Caminho morto: parecia
// implementado, e a Iris respondia "somos a clinica odontologica".
//
// Mesma classe de falha de `historico_recente` (2026-08-08) e de
// `agendamentos_do_paciente` (2026-08-17). A licao ja custou caro tres
// vezes: um campo so esta ligado quando um teste prova que ele chega na
// ponta.

import test from 'node:test';
import assert from 'node:assert/strict';

import { derivarFatosAutorizados } from './fatos-autorizados.ts';
import { derivarClinicaConhecida } from './clinica-conhecida.ts';
import { derivarPrecosClinica } from './precos-clinica.ts';
import { INSTRUCOES_REDATOR } from './redator-instrucoes.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';

const DECISAO: DecisaoOrquestrador = { tipo: 'saudacao' } as DecisaoOrquestrador;
const HOJE = '2026-08-17';

test('a cadeia INTEIRA entrega os dados da clinica aos fatos autorizados', () => {
  // Ponta a ponta: linha do banco -> derivar -> fatos que a redatora recebe.
  const clinica = derivarClinicaConhecida({
    nome: 'cleardent',
    endereco: 'Rua Admar Pinheiro',
    bairro: 'Jardim Imperial',
    cidade: 'Itaboraí',
    estado: 'Rio de Janeiro',
    maps_link: 'https://www.google.com/maps?q=-22.7364,-42.8537',
    telefone: '976154375',
  });

  const fatos = derivarFatosAutorizados(DECISAO, HOJE, undefined, undefined, undefined, clinica);

  assert.ok(fatos.clinica_conhecida, 'clinica_conhecida NAO chegou aos fatos -- caminho morto de novo');
  assert.equal(fatos.clinica_conhecida.nome, 'cleardent');
  assert.match(fatos.clinica_conhecida.endereco!, /Rua Admar Pinheiro/);
  assert.ok(fatos.clinica_conhecida.maps_link, 'sem maps_link a Iris nao consegue mandar o mapa');
});

test('a cadeia INTEIRA entrega os precos liberados', () => {
  const precos = derivarPrecosClinica([
    { esp: 'Clínico Geral', nome: 'Limpeza', ativo: true, valor: 45, mostrar_valor: true },
  ]);
  const fatos = derivarFatosAutorizados(DECISAO, HOJE, undefined, undefined, undefined, undefined, precos);

  assert.ok(fatos.precos, 'precos NAO chegaram aos fatos');
  assert.deepEqual(fatos.precos.liberados, [{ procedimento: 'Limpeza', valor: 'R$ 45,00' }]);
});

test('PADRAO: com o cadastro real, nenhum valor chega ate a redatora', () => {
  const precos = derivarPrecosClinica([
    { esp: 'Clínico Geral', nome: 'Consulta / Avaliação', ativo: true, valor: 120, mostrar_valor: false },
    { esp: 'Endodontia', nome: 'Canal molar', ativo: true, valor: 1300, mostrar_valor: false },
  ]);
  const fatos = derivarFatosAutorizados(DECISAO, HOJE, undefined, undefined, undefined, undefined, precos);

  assert.equal(fatos.precos!.liberados, undefined);
  assert.equal(fatos.precos!.sob_avaliacao!.length, 2);

  // Nenhum numero pode existir no que a redatora vai ler.
  const serializado = JSON.stringify(fatos);
  for (const proibido of ['120', '1300']) {
    assert.ok(!serializado.includes(proibido), `valor ${proibido} vazou ate os fatos`);
  }
});

test('clinica sem cadastro nao produz fato -- a Iris se comporta como antes', () => {
  const fatos = derivarFatosAutorizados(
    DECISAO, HOJE, undefined, undefined, undefined,
    derivarClinicaConhecida({}), derivarPrecosClinica(null)
  );
  assert.equal(fatos.clinica_conhecida, undefined);
  assert.equal(fatos.precos, undefined);
});

test('os fatos novos nao interferem nos que ja existiam', () => {
  const clinica = derivarClinicaConhecida({ nome: 'X' });
  const fatos = derivarFatosAutorizados(DECISAO, HOJE, undefined, undefined, undefined, clinica);
  // O objetivo continua vindo da decisao, nunca alterado por fato ortogonal.
  assert.ok(fatos.objetivo, 'o objetivo do turno sumiu');
});

test('a INSTRUCAO da redatora documenta os dois campos novos', () => {
  // Um fato que chega mas nao esta descrito na instrucao e um fato que a
  // redatora nao sabe usar -- foi o que aconteceu com nome_clinica.
  assert.match(INSTRUCOES_REDATOR, /clinica_conhecida/);
  assert.match(INSTRUCOES_REDATOR, /maps_link/);
  assert.match(INSTRUCOES_REDATOR, /precos/);
  assert.match(INSTRUCOES_REDATOR, /sob_avaliacao/);
});
