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
// A checagem lexical voltou depois de uma afirmação falsa da redatora virar
// dado real. Ela diferencia a negação diretamente ligada ao particípio de
// uma afirmação positiva; os testes abaixo preservam essa fronteira.

test('negacao direta passa, mas afirmacao de execucao sem autorizacao e reprovada', () => {
  const semHorarioAutorizado = fatos();
  const negacoes = [
    'Ainda não está confirmado, tá?',
    'O horário não foi confirmado.',
    'O atendimento não está mais agendado.',
  ];
  for (const frase of negacoes) {
    assert.deepEqual(verificarRespostaRedatora(frase, semHorarioAutorizado), { aprovado: true }, `esperava aprovado para "${frase}"`);
  }
  for (const frase of ['Está confirmado!', 'Não, está confirmado!', 'Prontinho, já está marcado!', 'Tudo certo, agendado!']) {
    assert.deepEqual(
      verificarRespostaRedatora(frase, semHorarioAutorizado),
      { aprovado: false, motivo: 'execucao_nao_autorizada' },
      `esperava reprovado para "${frase}"`
    );
  }
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

// ── CASOS REAIS DE 2026-08-20 e 21 ──────────────────────────────────────
// A redatora afirmou execução que o Core não autorizou, três vezes. Num dos
// casos o Core mandou PERGUNTAR qual agendamento remarcar e a resposta saiu
// "está confirmado para 25/08 às 15h" -- e essa frase falsa, no histórico,
// virou um agendamento REAL quatro horas depois.

test('CASO REAL: "esta confirmado" quando o Core mandou PERGUNTAR -> reprova', () => {
  const r = verificarRespostaRedatora(
    'Seu agendamento de limpeza dental *esta confirmado* para 25/08 as 15h.',
    {
      objetivo: 'escolher_entre_agendamentos',
      agendamentos_candidatos: ['segunda-feira, 24/08 as 15:00'],
    } as FatosAutorizados
  );
  assert.equal(r.aprovado, false);
  // Qualquer um dos dois motivos serve: a frase viola AS DUAS regras --
  // afirma execução que não houve E cita 25/08, que não está nos fatos.
  // O que importa é que ela não sai.
  assert.ok(
    ['execucao_nao_autorizada', 'data_nao_autorizada'].includes(
      (r as { motivo: string }).motivo
    )
  );
});

test('o MESMO texto passa quando o Core executou de verdade', () => {
  const r = verificarRespostaRedatora(
    'Seu agendamento *esta confirmado* para 24/08 as 15h.',
    {
      objetivo: 'informar_reserva_criada',
      agendamento_confirmado: { data: '2026-08-24', horario: '15:00' },
    } as FatosAutorizados
  );
  assert.equal(r.aprovado, true);
});

test('afirmacao de execucao e reprovada mesmo quando data e horario estao autorizados', () => {
  const r = verificarRespostaRedatora(
    'Seu agendamento esta confirmado para 25/08 as 15h.',
    {
      objetivo: 'escolher_entre_agendamentos',
      agendamentos_candidatos: ['terça-feira, 25/08 as 15:00'],
    } as FatosAutorizados
  );
  assert.equal(r.aprovado, false);
  assert.equal((r as { motivo: string }).motivo, 'execucao_nao_autorizada');
});

test('PERGUNTA com o mesmo verbo passa -- "posso confirmar?" nao afirma nada', () => {
  const r = verificarRespostaRedatora(
    'Posso confirmar 24/08 as 15h para voce?',
    {
      objetivo: 'pedir_confirmacao',
      proposta_pendente: { data: '2026-08-24', horario: '15:00' },
    } as FatosAutorizados
  );
  assert.equal(r.aprovado, true);
});

test('CASO REAL: data que o Core NAO autorizou -> reprova', () => {
  // O Core executou 24/08; a resposta disse 25/08.
  const r = verificarRespostaRedatora(
    'Seu agendamento *esta confirmado* para 25/08 as 15h.',
    {
      objetivo: 'informar_reserva_criada',
      agendamento_confirmado: { data: '2026-08-24', horario: '15:00' },
    } as FatosAutorizados
  );
  assert.equal(r.aprovado, false);
  assert.equal((r as { motivo: string }).motivo, 'data_nao_autorizada');
});

test('sem nenhuma data nos fatos, a checagem de data NAO reprova', () => {
  // Conversa livre: a redatora pode citar uma data que o paciente mencionou
  // sem que ela esteja nos fatos. Reprovar ali seria falso positivo.
  const r = verificarRespostaRedatora(
    'Voce mencionou 30/09 -- posso ver os horarios desse dia?',
    { objetivo: 'acolher_e_retomar' } as FatosAutorizados
  );
  assert.equal(r.aprovado, true);
});
