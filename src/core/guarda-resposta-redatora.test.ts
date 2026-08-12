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

// 2026-08-11 (specs/remarcacao-conversacional-v1.md secao 5): a redatora
// precisa poder mencionar o horario ANTIGO ao propor a troca ("voce esta
// com 14:00, quer passar para 09:00?") -- sem autorizar esse horario, a
// guarda reprovaria uma frase honesta.
test('aprova horario vindo de agendamento_atual (remarcacao)', () => {
  const f = fatos({ agendamento_atual: { data: '10/08', horario: '14:00' } });
  assert.deepEqual(verificarRespostaRedatora('Você está com 14:00 marcado.', f), { aprovado: true });
});

// 2026-08-12 (specs/consulta-agendamento-conversacional-v1.md secao 6): as
// duas fontes de LISTA de agendamento. `agendamentos_candidatos` era um
// DEFEITO REAL ja ativo em producao -- a resposta honesta da redatora na
// escolha entre multiplos agendamentos era reprovada e caia no texto fixo.
test('aprova horarios vindos de agendamentos_candidatos (defeito corrigido)', () => {
  const f = fatos({
    objetivo: 'escolher_entre_agendamentos',
    agendamentos_candidatos: ['10/08 às 14:00', '15/08 às 09:00'],
  });
  assert.deepEqual(
    verificarRespostaRedatora(
      'Você tem dois agendamentos: 10/08 às 14:00 e 15/08 às 09:00. Qual deles quer remarcar?',
      f
    ),
    { aprovado: true }
  );
});

test('aprova horarios vindos de agendamentos_do_paciente (contexto conversacional)', () => {
  const f = fatos({
    objetivo: 'acolher_e_retomar',
    agendamentos_do_paciente: ['Limpeza com Dra. Ana — segunda-feira, 10/08 às 14:00'],
  });
  assert.deepEqual(
    verificarRespostaRedatora('Sua limpeza está marcada para 10/08 às 14:00.', f),
    { aprovado: true }
  );
});

// A correcao NAO afrouxa a guarda: horario que nao esta em nenhuma fonte
// continua reprovado, mesmo com as listas presentes. Este e o caso medido
// da redatora inventando horario de funcionamento ("das 8h as 18h").
test('horario fora das listas continua REPROVADO -- a correcao nao afrouxa', () => {
  const f = fatos({
    objetivo: 'acolher_e_retomar',
    agendamentos_do_paciente: ['Limpeza com Dra. Ana — segunda-feira, 10/08 às 14:00'],
  });
  assert.deepEqual(
    verificarRespostaRedatora('Funcionamos das 8h às 18h. Sua consulta é 10/08 às 14:00.', f),
    { aprovado: false, motivo: 'horario_nao_autorizado' }
  );
});

test('agendamento_atual e proposta_pendente autorizam os DOIS horarios simultaneamente (de onde para onde)', () => {
  const f = fatos({
    agendamento_atual: { data: '10/08', horario: '14:00' },
    proposta_pendente: { data: '20/08', horario: '09:00' },
  });
  assert.deepEqual(verificarRespostaRedatora('Você está com 14:00 no dia 10/08. Quer passar para 09:00 no dia 20/08?', f), {
    aprovado: true,
  });
});

test('reprova horario nao autorizado mesmo com agendamento_atual presente', () => {
  const f = fatos({ agendamento_atual: { data: '10/08', horario: '14:00' } });
  const resultado = verificarRespostaRedatora('Você está com 15:00 marcado.', f);
  assert.deepEqual(resultado, { aprovado: false, motivo: 'horario_nao_autorizado' });
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
