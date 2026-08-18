// Testes de clinica-conhecida.ts -- os dados da propria clinica.
//
// Os casos usam os valores REAIS lidos do banco em 2026-08-17 (clinica
// ClearDent), nunca dados inventados: um teste que passa com dado fabricado
// nao prova que a Iris vai funcionar com o cadastro que existe.

import test from 'node:test';
import assert from 'node:assert/strict';

import { derivarClinicaConhecida } from './clinica-conhecida.ts';

// Linha REAL da ClearDent, como esta no banco (2026-08-17).
const CLEARDENT = {
  nome: 'cleardent',
  endereco: 'Rua Admar Pinheiro',
  bairro: 'Jardim Imperial',
  cidade: 'Itaboraí',
  estado: 'Rio de Janeiro',
  cep: '24800288',
  sala: '',
  referencia: 'frete ao banco bradesco',
  maps_link: 'https://www.google.com/maps?q=-22.736426009547458,-42.85370624470232',
  telefone: '976154375',
  email_clinica: 'clinardent@gmail.com',
  horario_funcionamento: {
    almoco: { fim: '', ativo: true, inicio: '' },
    sabado: { fim: '12:00', ativo: false, inicio: '08:00' },
    domingo: { fim: '12:00', ativo: false, inicio: '08:00' },
    seg_sex: { fim: '19:00', inicio: '07:00' },
  },
};

test('a clinica REAL produz os dados que a Iris precisa para se situar', () => {
  const c = derivarClinicaConhecida(CLEARDENT);
  assert.ok(c);
  assert.equal(c.nome, 'cleardent');
  assert.equal(c.endereco, 'Rua Admar Pinheiro, Jardim Imperial, Itaboraí - Rio de Janeiro');
  assert.equal(c.referencia, 'frete ao banco bradesco');
  assert.equal(c.telefone, '976154375');
  assert.equal(c.email, 'clinardent@gmail.com');
  assert.match(c.maps_link!, /^https:\/\/www\.google\.com\/maps/);
});

test('sala vazia NAO vira "sala " no endereco', () => {
  const c = derivarClinicaConhecida(CLEARDENT);
  assert.ok(!c!.endereco!.includes('sala'), `endereco vazou sala vazia: ${c!.endereco}`);
});

test('sala preenchida entra logo apos a rua', () => {
  const c = derivarClinicaConhecida({ ...CLEARDENT, sala: '302' });
  assert.equal(c!.endereco, 'Rua Admar Pinheiro, sala 302, Jardim Imperial, Itaboraí - Rio de Janeiro');
});

test('CEP fica de fora -- nao ajuda o paciente a chegar', () => {
  const c = derivarClinicaConhecida(CLEARDENT);
  assert.ok(!c!.endereco!.includes('24800288'));
});

test('horario: dias INATIVOS nao sao mencionados', () => {
  const c = derivarClinicaConhecida(CLEARDENT);
  // sabado e domingo estao ativo:false no cadastro real
  assert.equal(c!.horario_funcionamento, 'Segunda a sexta, 07:00 as 19:00');
});

test('horario: sabado ATIVO aparece', () => {
  const c = derivarClinicaConhecida({
    ...CLEARDENT,
    horario_funcionamento: {
      seg_sex: { inicio: '08:00', fim: '18:00' },
      sabado: { inicio: '08:00', fim: '12:00', ativo: true },
      domingo: { inicio: '08:00', fim: '12:00', ativo: false },
    },
  });
  assert.equal(c!.horario_funcionamento, 'Segunda a sexta, 08:00 as 18:00; Sabado, 08:00 as 12:00');
});

test('horario de ALMOCO nunca e anunciado -- quem manda na disponibilidade e a agenda', () => {
  const c = derivarClinicaConhecida(CLEARDENT);
  assert.ok(!/almo/i.test(c!.horario_funcionamento ?? ''));
});

test('clinica sem NENHUM dado preenchido nao vira fato', () => {
  assert.equal(derivarClinicaConhecida({}), undefined);
  assert.equal(derivarClinicaConhecida({ nome: '', endereco: '   ' }), undefined);
  assert.equal(derivarClinicaConhecida(null), undefined);
  assert.equal(derivarClinicaConhecida(undefined), undefined);
});

test('campo vazio NUNCA vira chave -- a Iris nunca anuncia endereco em branco', () => {
  const c = derivarClinicaConhecida({ nome: 'Clinica X', endereco: '', telefone: '   ', maps_link: null });
  assert.deepEqual(c, { nome: 'Clinica X' });
});

test('so a rua preenchida ainda produz endereco util', () => {
  const c = derivarClinicaConhecida({ endereco: 'Av. Central 100' });
  assert.equal(c!.endereco, 'Av. Central 100');
});

test('endereco sem rua nao e montado a partir do resto', () => {
  // Sem a rua, "Jardim Imperial, Itaborai" nao leva ninguem a lugar nenhum.
  const c = derivarClinicaConhecida({ nome: 'X', bairro: 'Jardim Imperial', cidade: 'Itaboraí' });
  assert.equal(c!.endereco, undefined);
});

test('tipos inesperados no jsonb nao quebram nem viram fato', () => {
  const c = derivarClinicaConhecida({
    nome: 123, endereco: { rua: 'x' }, telefone: [], horario_funcionamento: 'texto',
  } as never);
  assert.equal(c, undefined);
});

test('horario com faixa incompleta nao vira texto pela metade', () => {
  const c = derivarClinicaConhecida({
    nome: 'X', horario_funcionamento: { seg_sex: { inicio: '08:00', fim: '' } },
  });
  assert.equal(c!.horario_funcionamento, undefined);
});
