import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gerarRespostaPosConsultaFallback } from './pos-consulta-gerar-resposta-fallback.ts';

test('perguntar_satisfacao tem texto fixo, nunca vazio', () => {
  const texto = gerarRespostaPosConsultaFallback({ objetivo: 'perguntar_satisfacao' });
  assert.ok(texto.trim().length > 0);
});

// Revisao final do Codex (bloqueador 1): a PRIMEIRA entrega nunca e convite --
// mesmo que os fatos tragam um link, o texto fixo de pergunta nao o inclui.
test('perguntar_satisfacao nunca inclui URL, nem quando os fatos trazem um link', () => {
  const texto = gerarRespostaPosConsultaFallback({
    objetivo: 'perguntar_satisfacao',
    link_avaliacao_google: 'https://g.page/r/exemplo/review',
  });
  assert.ok(!/https?:\/\//i.test(texto));
});

test('agradecer_sem_convite nunca menciona link', () => {
  const texto = gerarRespostaPosConsultaFallback({ objetivo: 'agradecer_sem_convite' });
  assert.ok(!texto.toLowerCase().includes('google'));
});

test('agradecer_e_convidar_avaliacao_google inclui o link quando presente', () => {
  const texto = gerarRespostaPosConsultaFallback({
    objetivo: 'agradecer_e_convidar_avaliacao_google',
    link_avaliacao_google: 'https://g.page/r/exemplo/review',
  });
  assert.ok(texto.includes('https://g.page/r/exemplo/review'));
});
