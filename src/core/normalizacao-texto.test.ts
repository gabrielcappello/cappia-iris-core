// Normalizacao canonica -- specs/procedimentos-v1.md secao 4 (as quatro
// transformacoes fechadas). Cobre PRO-02 da matriz transversal.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizarTextoCanonico, textoAusenteParaResolucao } from './normalizacao-texto.ts';

// --- As quatro transformacoes aprovadas ---

test('PRO-02: lowercase', () => {
  assert.equal(normalizarTextoCanonico('LIMPEZA'), 'limpeza');
  assert.equal(normalizarTextoCanonico('Limpeza Dental'), 'limpeza dental');
});

test('PRO-02: remocao de acentos', () => {
  assert.equal(normalizarTextoCanonico('avaliação'), 'avaliacao');
  assert.equal(normalizarTextoCanonico('extração'), 'extracao');
  assert.equal(normalizarTextoCanonico('prótese'), 'protese');
  assert.equal(normalizarTextoCanonico('canal'), 'canal');
  assert.equal(normalizarTextoCanonico('ÁÉÍÓÚÃÕÂÊÔÇ'), 'aeiouaoaeoc');
});

test('PRO-02: trim', () => {
  assert.equal(normalizarTextoCanonico('   limpeza   '), 'limpeza');
});

test('PRO-02: reducao de espacos multiplos a um unico espaco', () => {
  assert.equal(normalizarTextoCanonico('limpeza     dental'), 'limpeza dental');
  assert.equal(normalizarTextoCanonico('limpeza\t\tdental'), 'limpeza dental');
  assert.equal(normalizarTextoCanonico('limpeza\ndental'), 'limpeza dental');
});

test('PRO-02: as quatro transformacoes combinadas', () => {
  assert.equal(normalizarTextoCanonico('  LIMPEZA   Dentária \n'), 'limpeza dentaria');
});

// --- Nenhuma transformacao alem das quatro ---

test('PRO-02: pontuacao NAO e removida (nao esta entre as quatro transformacoes)', () => {
  assert.equal(normalizarTextoCanonico('Dr. limpeza'), 'dr. limpeza');
  assert.equal(normalizarTextoCanonico('limpeza-dental'), 'limpeza-dental');
  assert.equal(normalizarTextoCanonico('limpeza/clareamento'), 'limpeza/clareamento');
});

test('PRO-02: nenhuma correcao ortografica, stemming ou expansao semantica', () => {
  // Erro de digitacao permanece exatamente como esta -- corrigi-lo exigiria
  // fuzzy matching, explicitamente proibido pela secao 4.
  assert.equal(normalizarTextoCanonico('limpesa'), 'limpesa');
  assert.notEqual(normalizarTextoCanonico('limpesa'), normalizarTextoCanonico('limpeza'));
  // Singular/plural nao colapsam (sem stemming).
  assert.notEqual(normalizarTextoCanonico('limpezas'), normalizarTextoCanonico('limpeza'));
});

test('PRO-02: espaco interno significativo e preservado como um espaco', () => {
  assert.notEqual(normalizarTextoCanonico('limpeza dental'), normalizarTextoCanonico('limpezadental'));
});

// --- Propriedades ---

test('propriedade: normalizacao e idempotente', () => {
  const entradas = [
    '  LIMPEZA   Dentária \n',
    'Avaliação',
    'canal',
    '',
    '   ',
    'Dr. Ana / Clareamento',
    'ÁÉÍÓÚÃÕÂÊÔÇ',
  ];
  for (const entrada of entradas) {
    const umaVez = normalizarTextoCanonico(entrada);
    assert.equal(normalizarTextoCanonico(umaVez), umaVez, `nao idempotente para ${JSON.stringify(entrada)}`);
  }
});

test('propriedade: textos distintos nao passam a corresponder por aproximacao', () => {
  const distintos = ['limpeza', 'limpesa', 'limpezas', 'clareamento', 'limpeza dental', 'limpezadental'];
  const normalizados = distintos.map(normalizarTextoCanonico);
  assert.equal(new Set(normalizados).size, distintos.length);
});

test('propriedade: entradas equivalentes so pelas quatro transformacoes colapsam', () => {
  const equivalentes = ['Limpeza Dentária', 'limpeza dentaria', '  LIMPEZA    DENTÁRIA  ', 'LiMpEzA\tDentária'];
  const normalizados = new Set(equivalentes.map(normalizarTextoCanonico));
  assert.equal(normalizados.size, 1);
  assert.equal([...normalizados][0], 'limpeza dentaria');
});

// --- Ausencia de texto ---

test('texto ausente: undefined, null, vazio e somente espacos', () => {
  assert.equal(textoAusenteParaResolucao(undefined), true);
  assert.equal(textoAusenteParaResolucao(null), true);
  assert.equal(textoAusenteParaResolucao(''), true);
  assert.equal(textoAusenteParaResolucao('   '), true);
  assert.equal(textoAusenteParaResolucao('\n\t  '), true);
});

test('texto ausente: valor nao string nunca e tratado como texto valido', () => {
  assert.equal(textoAusenteParaResolucao(42), true);
  assert.equal(textoAusenteParaResolucao({}), true);
  assert.equal(textoAusenteParaResolucao([]), true);
});

test('texto presente: qualquer conteudo apos normalizacao', () => {
  assert.equal(textoAusenteParaResolucao('limpeza'), false);
  assert.equal(textoAusenteParaResolucao('  limpeza  '), false);
});
