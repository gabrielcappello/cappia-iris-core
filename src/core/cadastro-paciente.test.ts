// Testes da composicao da visao efetiva (cadastro-paciente.ts).
//
// Contrato fechado pelo Gabriel em 2026-08-09: a ficha persistida em
// `pacientes` e a retaguarda; o que o paciente disse NESTA conversa
// prevalece; nada e copiado para `estado_conversa.dados`.
//
// Funcao pura -- estes testes nao tocam banco, nao chamam IA e nao dependem
// de ordem. Todos os valores sao SINTETICOS.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calcularCadastroFaltante, comporVisaoEfetivaCadastro } from './cadastro-paciente.ts';
import type { CadastroPaciente } from './tipos.ts';

const FICHA: CadastroPaciente = {
  nome: 'Belarmina Toscano Furtado',
  cpf: '52998224725',
  data_nascimento: '1974-03-19',
  email: 'belarmina.furtado@exemplo-sintetico.test',
};

test('precedencia: o que veio da conversa vence a ficha oficial', () => {
  const efetiva = comporVisaoEfetivaCadastro(FICHA, { email: 'novo.endereco@exemplo-sintetico.test' });

  assert.equal(efetiva.email, 'novo.endereco@exemplo-sintetico.test', 'a correcao explicita do paciente deve vencer');
  // Os demais continuam vindo da ficha.
  assert.equal(efetiva.nome, FICHA.nome);
  assert.equal(efetiva.cpf, FICHA.cpf);
  assert.equal(efetiva.data_nascimento, FICHA.data_nascimento);
});

test('retaguarda: a ficha preenche o que a conversa nao tem', () => {
  const efetiva = comporVisaoEfetivaCadastro(FICHA, {});
  assert.deepEqual(efetiva, FICHA);
});

test('sem ficha: a visao efetiva e exatamente o que a conversa informou', () => {
  const efetiva = comporVisaoEfetivaCadastro(undefined, { nome: 'Anonimo Sintetico' });
  assert.deepEqual(efetiva, { nome: 'Anonimo Sintetico' });
});

test('sem ficha e sem conversa: objeto vazio, nunca undefined', () => {
  assert.deepEqual(comporVisaoEfetivaCadastro(undefined, undefined), {});
  assert.deepEqual(comporVisaoEfetivaCadastro({}, {}), {});
});

test('valor vazio na conversa NAO derruba o valor da ficha', () => {
  // Um campo que a conversa deixou como string vazia (ou so espacos) nao e
  // uma correcao -- e ausencia. Sem esta regra, "nada" venceria o dado
  // oficial e o paciente seria perguntado de novo por algo que ja tem.
  const efetiva = comporVisaoEfetivaCadastro(FICHA, { nome: '   ', cpf: '' });
  assert.equal(efetiva.nome, FICHA.nome);
  assert.equal(efetiva.cpf, FICHA.cpf);
});

test('valor vazio na ficha nao vira chave presente', () => {
  const efetiva = comporVisaoEfetivaCadastro({ nome: '  ', cpf: '52998224725' }, {});
  assert.deepEqual(efetiva, { cpf: '52998224725' });
  assert.ok(!Object.prototype.hasOwnProperty.call(efetiva, 'nome'));
});

test('so campos cadastrais entram: campo operacional da conversa e ignorado', () => {
  const efetiva = comporVisaoEfetivaCadastro(undefined, {
    nome: 'Sintetico Um',
    procedimento_id: 'cleaning',
    dentista_id: 'dent-1',
    confirmacao: 'sim',
  });
  assert.deepEqual(efetiva, { nome: 'Sintetico Um' });
});

test('a funcao e pura: nao muta a ficha nem os dados da conversa', () => {
  const ficha: CadastroPaciente = { nome: 'Original Sintetico', cpf: '11144477735' };
  const dados: Record<string, string> = { nome: 'Corrigido Sintetico' };
  const copiaFicha = { ...ficha };
  const copiaDados = { ...dados };

  const efetiva = comporVisaoEfetivaCadastro(ficha, dados);

  assert.deepEqual(ficha, copiaFicha, 'a ficha nao pode ser mutada');
  assert.deepEqual(dados, copiaDados, 'os dados da conversa nao podem ser mutados');
  // E o resultado e um objeto novo, nunca um alias de nenhum dos dois.
  assert.notEqual(efetiva, ficha);
  assert.notEqual(efetiva, dados);
});

test('valores sao aparados: espaco em volta nunca chega a visao efetiva', () => {
  const efetiva = comporVisaoEfetivaCadastro({ cpf: '  11144477735  ' }, { nome: '  Sintetico Dois  ' });
  assert.deepEqual(efetiva, { nome: 'Sintetico Dois', cpf: '11144477735' });
});

// --- calcularCadastroFaltante (specs/cadastro-conversacional-v1.md secao 2) ---

const COMPLETO: CadastroPaciente = {
  nome: 'Belarmina Toscano Furtado',
  cpf: '52998224725',
  data_nascimento: '1974-03-19',
};

test('faltantes: paciente completo nao interrompe -- lista vazia', () => {
  assert.deepEqual(calcularCadastroFaltante(COMPLETO, false), []);
});

test('faltantes: paciente novo (nada conhecido) pede os tres obrigatorios', () => {
  assert.deepEqual(calcularCadastroFaltante({}, false), ['nome', 'cpf', 'data_nascimento']);
});

test('faltantes: existente incompleto pede SOMENTE o que falta', () => {
  // O caso que o Gabriel citou: ja tem nome e CPF, falta so o nascimento.
  assert.deepEqual(
    calcularCadastroFaltante({ nome: 'Belarmina Toscano Furtado', cpf: '52998224725' }, false),
    ['data_nascimento']
  );
});

test('faltantes: ordem canonica e estavel, independente da ordem das chaves', () => {
  const emOutraOrdem: CadastroPaciente = { email: 'a@b.test', data_nascimento: '', cpf: '', nome: '' };
  assert.deepEqual(calcularCadastroFaltante(emOutraOrdem, true), ['nome', 'cpf', 'data_nascimento']);
});

test('faltantes: email so entra quando a clinica exige', () => {
  assert.deepEqual(calcularCadastroFaltante(COMPLETO, false), [], 'sem exigencia, email nao falta');
  assert.deepEqual(calcularCadastroFaltante(COMPLETO, true), ['email'], 'com exigencia, email falta');
  assert.deepEqual(calcularCadastroFaltante({ ...COMPLETO, email: 'a@b.test' }, true), []);
});

test('faltantes: valor vazio ou so espacos conta como ausente', () => {
  assert.deepEqual(calcularCadastroFaltante({ nome: '   ', cpf: '', data_nascimento: '1974-03-19' }, false), [
    'nome',
    'cpf',
  ]);
});

test('faltantes: opera sobre a VISAO EFETIVA -- dado da conversa completa a ficha', () => {
  // Ficha so com nome; a conversa trouxe CPF e nascimento. Nada mais falta,
  // mesmo que nada tenha sido persistido ainda.
  const efetiva = comporVisaoEfetivaCadastro(
    { nome: 'Belarmina Toscano Furtado' },
    { cpf: '52998224725', data_nascimento: '1974-03-19' }
  );
  assert.deepEqual(calcularCadastroFaltante(efetiva, false), []);
});
