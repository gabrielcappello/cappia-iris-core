// A frase estrutural de INSTRUCOES_EXTRATOR e um PONTO DE INTEGRACAO, nao
// texto livre: `cliente-modelo-openai.ts` a localiza por correspondencia
// EXATA e a substitui antes de montar o prompt
// (`construirInstrucoesPortatil`). Se ela nao existir exatamente uma vez, o
// adaptador aborta antes de qualquer chamada a IA.
//
// POR QUE ESTE ARQUIVO EXISTE (2026-09-02): uma analise externa apontou que a
// frase contradiz o `SCHEMA_SAIDA_INTERPRETACAO` -- ela cita dois campos
// raiz, o schema exige quatro. A contradicao e APARENTE: o schema deste
// arquivo e o formato INTERNO do Core, e a IA recebe a versao substituida,
// que descreve o outro formato. Ao "corrigir" a frase para casar com o
// schema, 112 testes cairam de uma vez, com mensagens que nao apontavam para
// a causa (`categoria: indisponibilidade`, em testes de retry do cliente).
//
// Este teste faz a proxima tentativa falhar AQUI, com o motivo escrito, em
// vez de espalhar falhas por toda a suite.
//
// Ja existe cobertura desta transformacao em
// `src/eval/execucao-real-sintetica-adaptador-openai.test.ts`, mas ela vive
// em `src/eval/` e o script de teste roda somente `core/**` -- entao nunca
// teria alertado. Por isso a guarda vive aqui.

import test from 'node:test';
import assert from 'node:assert/strict';

import { INSTRUCOES_EXTRATOR, SCHEMA_SAIDA_INTERPRETACAO } from './interpretacao-instrucoes.ts';

/**
 * Copia LITERAL de `FRASE_ESTRUTURAL_FORMATO_INTERNO_ANTIGO`
 * (`cliente-modelo-openai.ts`), que e privada. Duplicar aqui e deliberado: e
 * exatamente a divergencia entre as duas copias que este teste precisa
 * detectar. Importa-la faria as duas mudarem juntas e o teste nunca falharia.
 */
const FRASE_ESTRUTURAL_ESPERADA_PELO_ADAPTADOR =
  'Responda estritamente no formato do schema fornecido — nenhuma propriedade alem de "natureza_mensagem" e "alteracoes" no nivel principal, nenhuma propriedade alem de "acao"/"valor" (ou somente "acao" para remover) dentro de cada alteracao.';

test('a frase estrutural existe EXATAMENTE uma vez em INSTRUCOES_EXTRATOR', () => {
  const ocorrencias = INSTRUCOES_EXTRATOR.split(FRASE_ESTRUTURAL_ESPERADA_PELO_ADAPTADOR).length - 1;
  assert.equal(
    ocorrencias,
    1,
    'A frase estrutural foi alterada, duplicada ou removida. `cliente-modelo-openai.ts` a substitui por ' +
      'correspondencia textual EXATA (`construirInstrucoesPortatil`) e aborta antes de chamar a IA se nao achar ' +
      'exatamente uma. Para muda-la, atualize TAMBEM `FRASE_ESTRUTURAL_FORMATO_INTERNO_ANTIGO` no adaptador -- ' +
      'nunca so aqui. Ver o comentario no topo de interpretacao-instrucoes.ts.'
  );
});

test('a contradicao aparente com o schema e ESPERADA -- os dois formatos convivem', () => {
  // O schema INTERNO exige quatro campos raiz; a frase cita dois. Isso NAO e
  // defeito: a IA recebe a versao substituida pelo adaptador, que descreve o
  // formato de transporte. Este teste registra a divergencia como
  // intencional, para que uma leitura futura nao a trate como bug.
  const raizDoSchema = (SCHEMA_SAIDA_INTERPRETACAO as { required?: readonly string[] }).required ?? [];
  assert.deepEqual(
    [...raizDoSchema].sort(),
    ['alteracoes', 'dentistas_candidatos', 'eventos_candidatos', 'natureza_mensagem'],
    'o schema interno mudou -- reveja se a frase estrutural e a substituicao do adaptador ainda fazem sentido'
  );
  assert.ok(
    FRASE_ESTRUTURAL_ESPERADA_PELO_ADAPTADOR.includes('"natureza_mensagem" e "alteracoes"'),
    'a frase descreve o formato INTERNO de proposito -- ver o comentario no topo de interpretacao-instrucoes.ts'
  );
});
