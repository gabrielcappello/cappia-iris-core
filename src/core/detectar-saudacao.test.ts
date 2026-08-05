import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ehSaudacaoPura } from './detectar-saudacao.ts';

for (const saudacao of ['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite']) {
  test(`"${saudacao}" pura e reconhecida`, () => {
    assert.equal(ehSaudacaoPura([saudacao]), true);
  });
}

test('maiuscula, acento e pontuacao final nao impedem o reconhecimento', () => {
  assert.equal(ehSaudacaoPura(['Boa Tarde!']), true);
  assert.equal(ehSaudacaoPura(['OLÁ.']), true);
  assert.equal(ehSaudacaoPura(['  Bom dia  ']), true);
});

test('duas saudacoes separadas por virgula ainda sao puras', () => {
  assert.equal(ehSaudacaoPura(['oi, boa tarde']), true);
});

test('saudacao com conteudo adicional nao e pura', () => {
  assert.equal(ehSaudacaoPura(['oi, quero limpeza']), false);
  assert.equal(ehSaudacaoPura(['bom dia, gostaria de agendar uma consulta']), false);
});

test('mensagem sem nenhuma saudacao nao e pura', () => {
  assert.equal(ehSaudacaoPura(['quero agendar uma limpeza amanha as 10h']), false);
});

test('mensagem vazia ou so espacos nao e saudacao', () => {
  assert.equal(ehSaudacaoPura(['']), false);
  assert.equal(ehSaudacaoPura(['   ']), false);
  assert.equal(ehSaudacaoPura([]), false);
});

test('varias mensagens na janela, juntas formando so saudacao', () => {
  assert.equal(ehSaudacaoPura(['oi', 'boa tarde']), true);
});

test('varias mensagens na janela, com conteudo alem da saudacao', () => {
  assert.equal(ehSaudacaoPura(['oi', 'quero limpeza']), false);
});
