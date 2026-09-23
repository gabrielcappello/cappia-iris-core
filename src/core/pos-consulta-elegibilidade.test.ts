import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  avaliarElegibilidadePosConsulta,
  JANELA_MAXIMA_POS_CONSULTA_MINUTOS,
  type EntradaElegibilidadePosConsulta,
} from './pos-consulta-elegibilidade.ts';

const BASE: EntradaElegibilidadePosConsulta = {
  clinicaIdOrigem: 'clinica-1',
  agendamento: {
    clinicaId: 'clinica-1',
    status: 'concluido',
    telefoneNormalizado: '5511999999999',
    concluidoEm: '2026-09-01T12:00:00.000Z',
  },
  configuracao: { modo: 'satisfacao', prazoMinutos: 60 },
  jornadaJaExiste: false,
  agora: '2026-09-01T13:00:00.000Z', // 60 min depois
};

test('elegivel quando todas as sete condicoes sao satisfeitas (modo satisfacao)', () => {
  const resultado = avaliarElegibilidadePosConsulta(BASE);
  assert.deepEqual(resultado, { elegivel: true });
});

test('clinica do agendamento diferente da instancia autenticada nunca e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    agendamento: { ...BASE.agendamento, clinicaId: 'clinica-2' },
  });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'clinica_divergente' });
});

test('status diferente de concluido nunca e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    agendamento: { ...BASE.agendamento, status: 'confirmado', concluidoEm: null },
  });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'status_nao_concluido' });
});

test('concluido sem concluido_em nunca e elegivel (dado inconsistente falha fechado)', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    agendamento: { ...BASE.agendamento, concluidoEm: null },
  });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'status_nao_concluido' });
});

test('telefone ausente nunca e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    agendamento: { ...BASE.agendamento, telefoneNormalizado: null },
  });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'telefone_ausente' });
});

test('telefone so com espacos nunca e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    agendamento: { ...BASE.agendamento, telefoneNormalizado: '   ' },
  });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'telefone_ausente' });
});

test('modo nenhum nunca e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    configuracao: { modo: 'nenhum', prazoMinutos: 60 },
  });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'pos_consulta_desativado' });
});

test('jornada ja existente para o mesmo agendamento nunca inicia outra', () => {
  const resultado = avaliarElegibilidadePosConsulta({ ...BASE, jornadaJaExiste: true });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'jornada_ja_existe' });
});

test('modo google sem link configurado nunca e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    configuracao: { modo: 'google', prazoMinutos: 60 },
  });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'link_google_ausente' });
});

test('modo google com link em branco nunca e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    configuracao: { modo: 'google', prazoMinutos: 60, linkAvaliacaoGoogle: '   ' },
  });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'link_google_ausente' });
});

test('modo google com link valido e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    configuracao: { modo: 'google', prazoMinutos: 60, linkAvaliacaoGoogle: 'https://g.page/r/exemplo/review' },
  });
  assert.deepEqual(resultado, { elegivel: true });
});

test('B7 -- modo google com esquema inseguro (javascript:) nunca e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    configuracao: { modo: 'google', prazoMinutos: 60, linkAvaliacaoGoogle: 'javascript:alert(1)' },
  });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'link_google_ausente' });
});

test('B7 -- modo google com texto arbitrario (nao-URL) nunca e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    configuracao: { modo: 'google', prazoMinutos: 60, linkAvaliacaoGoogle: 'avalie a clinica' },
  });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'link_google_ausente' });
});

test('B7 -- modo google com esquema nao-http(s) (ftp) nunca e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    configuracao: { modo: 'google', prazoMinutos: 60, linkAvaliacaoGoogle: 'ftp://exemplo.com/arquivo' },
  });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'link_google_ausente' });
});

test('B7 -- modo google com http (nao so https) e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    configuracao: { modo: 'google', prazoMinutos: 60, linkAvaliacaoGoogle: 'http://g.page/r/exemplo/review' },
  });
  assert.deepEqual(resultado, { elegivel: true });
});

test('modo ambos exige link igual ao modo google', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    configuracao: { modo: 'ambos', prazoMinutos: 60 },
  });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'link_google_ausente' });
});

test('modo satisfacao nunca exige link', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    configuracao: { modo: 'satisfacao', prazoMinutos: 60 },
  });
  assert.deepEqual(resultado, { elegivel: true });
});

test('prazo ainda nao atingido nunca e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    agora: '2026-09-01T12:30:00.000Z', // so 30 min, prazo exige 60
  });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'prazo_nao_atingido' });
});

test('prazo exatamente atingido (fronteira) ja e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    agora: '2026-09-01T13:00:00.000Z', // exatamente 60 min
  });
  assert.deepEqual(resultado, { elegivel: true });
});

test('instante malformado falha fechado, nunca vira elegivel por omissao', () => {
  const resultado = avaliarElegibilidadePosConsulta({ ...BASE, agora: 'nao-e-uma-data' });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'prazo_nao_atingido' });
});

// ── Revisao final do Codex, bloqueador 2: janela maxima de idade ─────────────
const MIN = 60_000;
const CONCLUIDO_MS = Date.parse(BASE.agendamento.concluidoEm as string);
const agoraAposMin = (minutos: number) => new Date(CONCLUIDO_MS + minutos * MIN).toISOString();

test('a janela maxima e de 48h (2880 min) e e maior que qualquer prazo configuravel (2h/4h/24h)', () => {
  assert.equal(JANELA_MAXIMA_POS_CONSULTA_MINUTOS, 2880);
  assert.ok(JANELA_MAXIMA_POS_CONSULTA_MINUTOS > 24 * 60);
});

test('dentro da janela (1 min antes do limite) e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({ ...BASE, agora: agoraAposMin(JANELA_MAXIMA_POS_CONSULTA_MINUTOS - 1) });
  assert.deepEqual(resultado, { elegivel: true });
});

test('fronteira -- idade EXATAMENTE igual a janela ja esta fora (mesma regra do banco: concluido_em <= now() - janela)', () => {
  const resultado = avaliarElegibilidadePosConsulta({ ...BASE, agora: agoraAposMin(JANELA_MAXIMA_POS_CONSULTA_MINUTOS) });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'janela_maxima_excedida' });
});

test('agendamento antigo (24/08, semanas atras) nunca e elegivel', () => {
  const resultado = avaliarElegibilidadePosConsulta({
    ...BASE,
    agendamento: { ...BASE.agendamento, concluidoEm: '2026-08-24T12:00:00.000Z' },
    agora: '2026-09-20T12:00:00.000Z',
  });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'janela_maxima_excedida' });
});

test('a janela vale para TODOS os modos, com link valido', () => {
  for (const modo of ['satisfacao', 'google', 'ambos'] as const) {
    const resultado = avaliarElegibilidadePosConsulta({
      ...BASE,
      configuracao: { modo, prazoMinutos: 60, linkAvaliacaoGoogle: 'https://g.page/r/exemplo/review' },
      agora: agoraAposMin(JANELA_MAXIMA_POS_CONSULTA_MINUTOS + 60),
    });
    assert.deepEqual(resultado, { elegivel: false, motivo: 'janela_maxima_excedida' }, modo);
  }
});

test('prazo ainda nao atingido tem precedencia sobre a janela (motivo continua prazo_nao_atingido)', () => {
  const resultado = avaliarElegibilidadePosConsulta({ ...BASE, agora: agoraAposMin(30) });
  assert.deepEqual(resultado, { elegivel: false, motivo: 'prazo_nao_atingido' });
});

// O numero da janela vive em DOIS lugares (Core e banco). Este teste le a
// migration e falha se divergirem -- nunca confiar em manter dois numeros na mao.
test('paridade Core x banco -- a migration define a MESMA janela (minutos) e as duas usam a mesma fronteira', () => {
  const sql = readFileSync(
    new URL('../supabase/migrations/20260920230000_iris_nova_pos_consulta_google_so_apos_satisfacao_e_janela.sql', import.meta.url),
    'utf8'
  );
  const definicao = sql.match(/cappia_pos_consulta_janela_maxima_minutos\(\)[\s\S]*?select\s+(\d+)/);
  assert.ok(definicao, 'a migration precisa definir cappia_pos_consulta_janela_maxima_minutos()');
  assert.equal(Number(definicao[1]), JANELA_MAXIMA_POS_CONSULTA_MINUTOS);
  // Fronteira: candidatos usa "concluido_em > now() - janela" (dentro); iniciar_jornada usa "<= now() - janela" (fora).
  assert.match(sql, /a\.concluido_em > now\(\) - make_interval\(mins => public\.cappia_pos_consulta_janela_maxima_minutos\(\)\)/);
  assert.match(sql, /v_concluido_em <= now\(\) - make_interval\(mins => public\.cappia_pos_consulta_janela_maxima_minutos\(\)\)/);
});

// Par A/B (docs/00-principios.md, teste isolado): mesma entrada, variando
// SOMENTE clinicaId do agendamento -- os dois lados precisam DIFERIR.
test('par A/B -- clinica_id e o unico campo que muda entre elegivel e clinica_divergente', () => {
  const a = avaliarElegibilidadePosConsulta(BASE);
  const b = avaliarElegibilidadePosConsulta({
    ...BASE,
    agendamento: { ...BASE.agendamento, clinicaId: 'outra-clinica' },
  });
  assert.notDeepEqual(a, b);
  assert.equal(a.elegivel, true);
  assert.equal(b.elegivel, false);
});
