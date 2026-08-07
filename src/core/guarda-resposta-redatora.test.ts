// Testes da guarda programatica (specs/resposta-conversacional-v1.md secao 4).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verificarRespostaRedatora } from './guarda-resposta-redatora.ts';
import type { FatosAutorizados } from './fatos-autorizados.ts';

function fatos(overrides: Partial<FatosAutorizados> = {}): FatosAutorizados {
  return { objetivo: 'apresentar_horarios', ...overrides };
}

// --- Horario: aprova o que esta autorizado, reprova o que nao esta ---

test('aprova texto sem nenhum horario citado', () => {
  assert.deepEqual(verificarRespostaRedatora('Qual procedimento você precisa?', fatos()), { aprovado: true });
});

test('aprova horario presente em horarios_disponiveis', () => {
  const f = fatos({ horarios_disponiveis: ['13:00', '14:00'] });
  assert.deepEqual(verificarRespostaRedatora('Tenho 13:00 e 14:00 livres, qual prefere?', f), { aprovado: true });
});

test('reprova horario fora de qualquer fonte autorizada', () => {
  const f = fatos({ horarios_disponiveis: ['14:00'] });
  const resultado = verificarRespostaRedatora('Tenho 15:00 disponível.', f);
  assert.deepEqual(resultado, { aprovado: false, motivo: 'horario_nao_autorizado' });
});

test('aprova horario vindo de proposta_pendente', () => {
  const f = fatos({ proposta_pendente: { data: '05/08', horario: '09:00' } });
  assert.deepEqual(verificarRespostaRedatora('Posso confirmar às 09:00?', f), { aprovado: true });
});

test('aprova horario vindo de agendamento_confirmado', () => {
  const f = fatos({ agendamento_confirmado: { data: '05/08', horario: '09:00' } });
  assert.deepEqual(verificarRespostaRedatora('Prontinho, confirmado para 09:00!', f), { aprovado: true });
});

// --- Normalizacao: mesmo valor, grafias diferentes ---

test('normaliza antes de comparar: 14h, 14:00 e 14 horas sao o mesmo valor autorizado', () => {
  const f = fatos({ horarios_disponiveis: ['14:00'] });
  assert.deepEqual(verificarRespostaRedatora('Que tal 14h?', f), { aprovado: true });
  assert.deepEqual(verificarRespostaRedatora('Que tal 14:00?', f), { aprovado: true });
  assert.deepEqual(verificarRespostaRedatora('Que tal 14 horas?', f), { aprovado: true });
});

test('normalizacao nao aprova por engano um valor vizinho: 15h continua reprovado quando so 14:00 esta autorizado', () => {
  const f = fatos({ horarios_disponiveis: ['14:00'] });
  assert.deepEqual(verificarRespostaRedatora('Que tal 15h?', f), { aprovado: false, motivo: 'horario_nao_autorizado' });
});

// --- Datas nunca sao lidas como horario ---

test('nao reprova numeros dentro de um padrao de data DD/MM', () => {
  const f = fatos({ horarios_disponiveis: ['09:00'] });
  assert.deepEqual(verificarRespostaRedatora('Que tal no dia 15/03?', f), { aprovado: true });
});

test('nao reprova numeros dentro de um padrao de data DD/MM/AAAA', () => {
  const f = fatos({ horarios_disponiveis: ['09:00'] });
  assert.deepEqual(verificarRespostaRedatora('Combinamos para 15/03/2026?', f), { aprovado: true });
});

// --- Variacoes naturais de linguagem sobre confirmacao NAO sao julgadas
// pela guarda (ajuste 2026-08-06, principio "reciprocidade") ---
//
// A guarda tinha uma checagem lexical de afirmacao de reserva (marcado/
// agendado/confirmado/reservado), com deteccao de negacao numa janela de
// texto -- um segundo interpretador de portugues em regex, que cresceu a
// cada frase nova que nao previa (proprio historico deste arquivo: chegou a
// reprovar "Ainda nao esta confirmado, ta?" por conter a palavra
// "confirmado", ate ganhar deteccao de negacao -- que ja era o sintoma do
// problema, nao a solucao). Removida por completo: a guarda so verifica
// agora o que e objetivamente verificavel (horario citado existe nos
// fatos?). Qualquer redacao sobre confirmacao passa por aqui, mesmo
// afirmando ou negando reserva em texto livre -- a garantia de nunca
// afirmar reserva sem fato agora vem do principio operacional do prompt
// (redator-instrucoes.ts), nunca de regex tentando entender a frase.

test('variacao de linguagem sobre confirmacao: qualquer frase passa pela guarda, aprovada ou reprovada SO por horario', () => {
  const semHorarioAutorizado = fatos();
  const frases = [
    'Ainda não está confirmado, tá?',
    'Está confirmado!',
    'Não, está confirmado!',
    'Prontinho, já está marcado!',
    'Ainda não ficou reservado.',
    'Tudo certo, agendado!',
  ];
  for (const frase of frases) {
    assert.deepEqual(verificarRespostaRedatora(frase, semHorarioAutorizado), { aprovado: true }, `esperava aprovado para "${frase}"`);
  }
});

test('afirmar/negar confirmacao nunca aparece como motivo de reprovacao (removido do vocabulario da guarda)', () => {
  const resultado = verificarRespostaRedatora('Está confirmado!', fatos());
  assert.equal(resultado.aprovado, true);
});

// --- Texto vazio ---

test('reprova texto vazio', () => {
  assert.deepEqual(verificarRespostaRedatora('', fatos()), { aprovado: false, motivo: 'texto_vazio' });
});

test('reprova texto so com espacos', () => {
  assert.deepEqual(verificarRespostaRedatora('   ', fatos()), { aprovado: false, motivo: 'texto_vazio' });
});

// --- Nunca edita ---

test('guarda nunca modifica o texto -- so aprova ou reprova (a funcao nunca retorna o texto)', () => {
  const resultado = verificarRespostaRedatora('Tenho 15:00 disponível.', fatos({ horarios_disponiveis: ['14:00'] }));
  assert.equal('texto' in resultado, false);
});
