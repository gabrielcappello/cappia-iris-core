// Testes da validacao deterministica dos campos cadastrais.
//
// Regras copiadas de specs/novo-agendamento.md secao 23 e fixadas em
// specs/cadastro-conversacional-v1.md secao 4. Nenhuma regra alem dessas.
//
// TODO valor abaixo e SINTETICO. Os CPFs "validos" foram construidos para
// satisfazer os digitos verificadores; nao pertencem a ninguem.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizarCampoCadastral,
  normalizarCpf,
  normalizarDataNascimento,
  normalizarEmail,
  normalizarNome,
} from './validar-cadastro.ts';

const HOJE = '2026-08-10';

// --- nome ---

test('nome: aceita primeiro nome sozinho -- sobrenome NAO e exigido', () => {
  assert.equal(normalizarNome('Gabriel'), 'Gabriel');
});

test('nome: normaliza espacos (bordas e internos)', () => {
  assert.equal(normalizarNome('  Gabriel   Cappello  '), 'Gabriel Cappello');
});

test('nome: exige ao menos duas letras', () => {
  assert.equal(normalizarNome('A'), undefined);
  assert.equal(normalizarNome('Al'), 'Al');
});

test('nome: rejeita composto so por numeros ou simbolos', () => {
  assert.equal(normalizarNome('12345'), undefined);
  assert.equal(normalizarNome('!!!'), undefined);
  assert.equal(normalizarNome('   '), undefined);
  assert.equal(normalizarNome(''), undefined);
});

test('nome: letra acentuada conta como letra', () => {
  assert.equal(normalizarNome('Ná'), 'Ná');
});

// --- cpf ---

const CPF_VALIDO = '52998224725';
const CPF_VALIDO_2 = '11144477735';

test('cpf: aceita valido e devolve so digitos', () => {
  assert.equal(normalizarCpf(CPF_VALIDO), CPF_VALIDO);
});

test('cpf: remove pontuacao e devolve normalizado', () => {
  assert.equal(normalizarCpf('529.982.247-25'), CPF_VALIDO);
  assert.equal(normalizarCpf('111.444.777-35'), CPF_VALIDO_2);
  assert.equal(normalizarCpf(' 529 982 247 25 '), CPF_VALIDO);
});

test('cpf: rejeita digito verificador invalido', () => {
  // O exemplo que o Gabriel citou -- serve so como caso de REJEICAO.
  assert.equal(normalizarCpf('123.456.789-00'), undefined);
  assert.equal(normalizarCpf('52998224726'), undefined);
});

test('cpf: rejeita quantidade de digitos diferente de 11', () => {
  assert.equal(normalizarCpf('5299822472'), undefined);
  assert.equal(normalizarCpf('529982247250'), undefined);
  assert.equal(normalizarCpf(''), undefined);
});

test('cpf: rejeita sequencia do mesmo digito, mesmo quando fecha a conta', () => {
  for (let d = 0; d <= 9; d++) {
    const sequencia = String(d).repeat(11);
    assert.equal(normalizarCpf(sequencia), undefined, `${sequencia} deveria ser rejeitado`);
  }
});

// --- data_nascimento ---

test('data_nascimento: aceita data real em YYYY-MM-DD', () => {
  assert.equal(normalizarDataNascimento('1985-05-10', HOJE), '1985-05-10');
});

test('data_nascimento: rejeita formato fora de YYYY-MM-DD', () => {
  assert.equal(normalizarDataNascimento('10/05/1985', HOJE), undefined);
  assert.equal(normalizarDataNascimento('1985-5-10', HOJE), undefined);
  assert.equal(normalizarDataNascimento('85-05-10', HOJE), undefined);
});

test('data_nascimento: rejeita data que nao existe no calendario', () => {
  assert.equal(normalizarDataNascimento('2025-02-30', HOJE), undefined);
  assert.equal(normalizarDataNascimento('1985-13-01', HOJE), undefined);
  assert.equal(normalizarDataNascimento('1985-00-10', HOJE), undefined);
});

test('data_nascimento: 29 de fevereiro so em ano bissexto', () => {
  assert.equal(normalizarDataNascimento('2024-02-29', HOJE), '2024-02-29');
  assert.equal(normalizarDataNascimento('2023-02-29', HOJE), undefined);
});

test('data_nascimento: rejeita data futura; hoje e aceito', () => {
  assert.equal(normalizarDataNascimento('2026-08-11', HOJE), undefined);
  assert.equal(normalizarDataNascimento('2030-01-01', HOJE), undefined);
  assert.equal(normalizarDataNascimento(HOJE, HOJE), HOJE);
});

test('data_nascimento: sem data de referencia, a checagem de futuro e pulada e as demais valem', () => {
  // Documenta a degradacao honesta: o Core nunca le relogio, entao sem
  // referencia injetada nao ha como saber o que e futuro.
  assert.equal(normalizarDataNascimento('2030-01-01'), '2030-01-01');
  assert.equal(normalizarDataNascimento('2025-02-30'), undefined);
});

// --- email ---

test('email: aceita endereco estruturalmente valido', () => {
  assert.equal(normalizarEmail('gabriel@exemplo.test'), 'gabriel@exemplo.test');
  assert.equal(normalizarEmail('  gabriel@exemplo.com.br  '), 'gabriel@exemplo.com.br');
});

test('email: rejeita pelas seis checagens estruturais da spec', () => {
  assert.equal(normalizarEmail('gabriel exemplo@teste.test'), undefined, 'espaco');
  assert.equal(normalizarEmail('gabriel@@exemplo.test'), undefined, 'dois arrobas');
  assert.equal(normalizarEmail('gabrielexemplo.test'), undefined, 'nenhum arroba');
  assert.equal(normalizarEmail('@exemplo.test'), undefined, 'sem conteudo antes');
  assert.equal(normalizarEmail('gabriel@'), undefined, 'sem dominio');
  assert.equal(normalizarEmail('gabriel@exemplo'), undefined, 'dominio sem ponto');
  assert.equal(normalizarEmail('gabriel@exemplo.'), undefined, 'nada depois do ponto');
  assert.equal(normalizarEmail('gabriel@.test'), undefined, 'nada antes do ponto');
});

test('email: NUNCA verifica se o endereco existe', () => {
  // Dominio inexistente e estruturalmente valido -> aceito. A spec proibe
  // verificacao de existencia.
  assert.equal(
    normalizarEmail('ninguem@dominio-que-nao-existe-jamais.test'),
    'ninguem@dominio-que-nao-existe-jamais.test'
  );
});

// --- ponto unico de entrada ---

test('normalizarCampoCadastral: despacha por campo e devolve o valor normalizado', () => {
  assert.equal(normalizarCampoCadastral('nome', '  Gabriel   Cappello '), 'Gabriel Cappello');
  assert.equal(normalizarCampoCadastral('cpf', '529.982.247-25'), CPF_VALIDO);
  assert.equal(normalizarCampoCadastral('data_nascimento', '1985-05-10', HOJE), '1985-05-10');
  assert.equal(normalizarCampoCadastral('email', 'a@b.test'), 'a@b.test');
});

test('normalizarCampoCadastral: invalido devolve undefined, nunca lanca', () => {
  for (const [campo, valor] of [
    ['nome', '123'],
    ['cpf', '123.456.789-00'],
    ['data_nascimento', '10/05/1985'],
    ['email', 'sem-arroba'],
  ] as const) {
    assert.equal(normalizarCampoCadastral(campo, valor, HOJE), undefined, `${campo} deveria ser rejeitado`);
  }
});
