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

// Continua passando apos 2026-09-05, agora pela razao estrutural da secao
// 3.2: `acolher_e_retomar` esta fora do conjunto protegido, entao a checagem
// nao executa -- antes passava porque a fonte cobria o horario citado, o
// resultado e o mesmo mas o motivo mudou.
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

// MUDANCA DE EXPECTATIVA CONSCIENTE (2026-09-05,
// specs/guarda-redatora-fiscal-conversa-v1.md secao 3.3): este teste antes
// provava que a checagem de horario reprovava mesmo com as listas presentes.
// A causa raiz do defeito real (loop de fallback fixo) e que
// `acolher_e_retomar` e puramente conversacional -- a checagem de
// horario/data agora NAO EXECUTA para este objetivo (secao 3.2), entao a
// mesma frase passa a ser aprovada. Isto NAO significa que uma fonte nova
// (`horario_funcionamento`) foi aceita -- nenhuma fonte nova existe (secao
// 3.3); a aprovacao e por ausencia de fiscalizacao neste objetivo, nao por
// "das 8h as 18h" ter sido reconhecido como fato real. O teste seguinte prova
// que, DENTRO de um objetivo protegido, o mesmo horario de funcionamento
// continua reprovado.
test('horario fora das listas, em objetivo conversacional, passa a ser APROVADO -- ausencia de fiscalizacao, nao fonte nova', () => {
  const f = fatos({
    objetivo: 'acolher_e_retomar',
    agendamentos_do_paciente: ['Limpeza com Dra. Ana — segunda-feira, 10/08 às 14:00'],
  });
  assert.deepEqual(
    verificarRespostaRedatora('Funcionamos das 8h às 18h. Sua consulta é 10/08 às 14:00.', f),
    { aprovado: true }
  );
});

test('o MESMO horario de funcionamento continua REPROVADO dentro de um objetivo protegido', () => {
  const f = fatos({
    objetivo: 'apresentar_horarios',
    horarios_disponiveis: ['14:00'],
    clinica_conhecida: { horario_funcionamento: '08:00 as 18:00' },
  });
  assert.deepEqual(
    verificarRespostaRedatora('Tenho 8h disponível.', f),
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
      // Formato REAL de producao (fatos-autorizados.ts sempre chama
      // formatarDataParaRedatora, que devolve DD/MM ou "hoje, DD/MM" --
      // nunca ISO). Usar ISO aqui mascararia o defeito corrigido em
      // 2026-09-05 (ver coletarDatasAutorizadas).
      proposta_pendente: { data: '24/08', horario: '15:00' },
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
      agendamento_confirmado: { data: '24/08', horario: '15:00' },
    } as FatosAutorizados
  );
  assert.equal(r.aprovado, false);
  assert.equal((r as { motivo: string }).motivo, 'data_nao_autorizada');
});

// --- REGRESSAO (2026-09-05): proposta_pendente.data no formato REAL de
// producao (DD/MM, nunca ISO) precisa ser reconhecida como autorizada,
// mesmo quando outro agendamento do paciente (formato de texto) tambem
// aparece nos fatos -- foi exatamente essa combinacao que produzia o falso
// bloqueio medido: proposta em 09/09, outro agendamento em 07/09, a data
// CERTA (09/09) reprovada como se fosse invencao. ---

test('REGRESSAO: proposta em DD/MM passa mesmo SEM outro agendamento nos fatos', () => {
  const r = verificarRespostaRedatora(
    'Encontrei esse horário: 09/09 às 10:30. Posso confirmar?',
    {
      objetivo: 'pedir_confirmacao',
      proposta_pendente: { data: '09/09', horario: '10:30' },
    } as FatosAutorizados
  );
  assert.deepEqual(r, { aprovado: true });
});

test('REGRESSAO: mesma proposta em DD/MM passa MESMO COM outro agendamento do paciente em outra data', () => {
  const r = verificarRespostaRedatora(
    'Encontrei esse horário: 09/09 às 10:30. Posso confirmar?',
    {
      objetivo: 'pedir_confirmacao',
      proposta_pendente: { data: '09/09', horario: '10:30' },
      agendamentos_do_paciente: ['Retratamento de canal — segunda-feira, 07/09 às 08:00'],
    } as FatosAutorizados
  );
  assert.deepEqual(r, { aprovado: true });
});

test('REGRESSAO: resposta citando uma data REALMENTE diferente continua bloqueada', () => {
  const r = verificarRespostaRedatora(
    'Encontrei esse horário: 10/09 às 10:30. Posso confirmar?',
    {
      objetivo: 'pedir_confirmacao',
      proposta_pendente: { data: '09/09', horario: '10:30' },
      agendamentos_do_paciente: ['Retratamento de canal — segunda-feira, 07/09 às 08:00'],
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

// ── GUARDA CONDICIONADA POR OBJETIVO (2026-09-05,
// specs/guarda-redatora-fiscal-conversa-v1.md) ──────────────────────────
// A checagem de horario/data deixa de rodar incondicionalmente e passa a
// depender de `fatos.objetivo` estar no conjunto de 11 protegidos (secao
// 3.2). Os testes abaixo cobrem exatamente a secao 7 (verificacao exigida).

test('TESTE NEGATIVO -- disponibilidade inventada continua bloqueada em objetivo protegido', () => {
  const r = verificarRespostaRedatora(
    'Tenho 15:00 disponível.',
    { objetivo: 'apresentar_horarios', horarios_disponiveis: ['14:00'] } as FatosAutorizados
  );
  assert.deepEqual(r, { aprovado: false, motivo: 'horario_nao_autorizado' });
});

test('TESTE POSITIVO -- 16h como preferencia do paciente e reconhecida, objetivo fora do conjunto protegido', () => {
  const r = verificarRespostaRedatora(
    'Entendi, 16h ficaria bem pra voce. Para qual data voce gostaria de agendar?',
    { objetivo: 'pedir_data_ou_horario' } as FatosAutorizados
  );
  assert.deepEqual(r, { aprovado: true });
});

// Caso real da spec (secao 1): "Esse horário de hoje já passou" -- reconhecer
// que "hoje" ja passou e uma explicacao conversacional, nao uma oferta.
test('CASO REAL -- explicar que o horario de hoje ja passou nao e bloqueado', () => {
  const r = verificarRespostaRedatora(
    'Esse horário de hoje já passou, viu? Hoje e sabado, estamos abertos ate as 18h. Quer marcar pra amanha?',
    { objetivo: 'acolher_e_retomar' } as FatosAutorizados
  );
  assert.deepEqual(r, { aprovado: true });
});

test('par negativo por objetivo protegido -- informar_sem_expediente_e_pedir_outra_data', () => {
  const r = verificarRespostaRedatora(
    'Nao temos expediente nesse dia, mas tenho 10:00 disponível na proxima data.',
    { objetivo: 'informar_sem_expediente_e_pedir_outra_data' } as FatosAutorizados
  );
  assert.deepEqual(r, { aprovado: false, motivo: 'horario_nao_autorizado' });
});

test('par negativo por objetivo protegido -- pedir_confirmacao_remarcacao', () => {
  const r = verificarRespostaRedatora(
    'Voce esta com 14:00. Quer passar para 16:00?',
    {
      objetivo: 'pedir_confirmacao_remarcacao',
      agendamento_atual: { data: '10/08', horario: '14:00' },
    } as FatosAutorizados
  );
  assert.deepEqual(r, { aprovado: false, motivo: 'horario_nao_autorizado' });
});

test('par negativo por objetivo protegido -- informar_horario_indisponivel', () => {
  const r = verificarRespostaRedatora(
    'Esse horário não está livre. Tenho 11:00 disponível.',
    { objetivo: 'informar_horario_indisponivel', horarios_disponiveis: ['10:30', '13:00'] } as FatosAutorizados
  );
  assert.deepEqual(r, { aprovado: false, motivo: 'horario_nao_autorizado' });
});

test('par negativo por objetivo protegido -- escolher_entre_agendamentos_cancelamento', () => {
  const r = verificarRespostaRedatora(
    'Você tem dois agendamentos: 10/08 às 14:00 e 15/08 às 09:00. Qual deles quer cancelar?',
    {
      objetivo: 'escolher_entre_agendamentos_cancelamento',
      agendamentos_candidatos: ['10/08 às 14:00'],
    } as FatosAutorizados
  );
  assert.deepEqual(r, { aprovado: false, motivo: 'horario_nao_autorizado' });
});

test('par negativo por objetivo protegido -- pedir_confirmacao_cancelamento (adicionado nesta revisao)', () => {
  const r = verificarRespostaRedatora(
    'Você quer cancelar sua consulta de 20/08 às 15:00?',
    {
      objetivo: 'pedir_confirmacao_cancelamento',
      agendamento_atual: { data: '20/08', horario: '14:00' },
    } as FatosAutorizados
  );
  assert.deepEqual(r, { aprovado: false, motivo: 'horario_nao_autorizado' });
});

test('par negativo por objetivo protegido -- informar_cancelamento_criado (adicionado nesta revisao)', () => {
  const r = verificarRespostaRedatora(
    'Pronto, cancelei seu agendamento de 21/08 às 14:00.',
    {
      objetivo: 'informar_cancelamento_criado',
      agendamento_confirmado: { data: '20/08', horario: '14:00' },
    } as FatosAutorizados
  );
  assert.deepEqual(r, { aprovado: false, motivo: 'data_nao_autorizada' });
});

test('falsa confirmacao continua bloqueada -- pedir_confirmacao_cancelamento', () => {
  const r = verificarRespostaRedatora(
    'Você quer cancelar sua consulta de 20/08 às 14:00?',
    {
      objetivo: 'pedir_confirmacao_cancelamento',
      agendamento_atual: { data: '20/08', horario: '14:00' },
    } as FatosAutorizados
  );
  assert.deepEqual(r, { aprovado: true });
});

// Os tres objetivos conversacionais NAO fiscalizam data/horario, em nenhum
// caso -- nem quando o horario citado bate com um fato real, nem quando nao
// bate com nada (secao 3.2/7).
for (const objetivo of [
  'cumprimentar_e_oferecer_ajuda',
  'cumprimentar_e_mencionar_tratamento_pendente',
  'acolher_e_retomar',
] as const) {
  test(`objetivo conversacional (${objetivo}) -- horario que BATE com fato real e aprovado`, () => {
    const r = verificarRespostaRedatora(
      'Sua limpeza esta marcada para 10/08 às 14:00.',
      {
        objetivo,
        agendamentos_do_paciente: ['Limpeza com Dra. Ana — segunda-feira, 10/08 às 14:00'],
      } as FatosAutorizados
    );
    assert.deepEqual(r, { aprovado: true });
  });

  test(`objetivo conversacional (${objetivo}) -- horario que NAO BATE com nenhum fato tambem e aprovado (checagem nao executa)`, () => {
    const r = verificarRespostaRedatora(
      'Sua limpeza esta marcada para 20/09 às 16:00.',
      {
        objetivo,
        agendamentos_do_paciente: ['Limpeza com Dra. Ana — segunda-feira, 10/08 às 14:00'],
      } as FatosAutorizados
    );
    assert.deepEqual(r, { aprovado: true });
  });
}

// Guarda de execucao continua ativa nos tres objetivos conversacionais --
// independente do conjunto de horario/data (secao 3.1). Cenarios corrigidos
// (achado do Codex): "esta confirmado" com agendamento existente NAO prova
// nada (afirmaExecucao ja ignora esse participio por design). Os dois
// cenarios abaixo provam a guarda de fato.
test('execucao SEM nenhum agendamento existente -- "esta confirmado" e reprovado mesmo em objetivo conversacional', () => {
  const r = verificarRespostaRedatora(
    'Prontinho, esta confirmado!',
    { objetivo: 'acolher_e_retomar' } as FatosAutorizados
  );
  assert.deepEqual(r, { aprovado: false, motivo: 'execucao_nao_autorizada' });
});

test('execucao COM agendamento existente, particípio fora da excecao -- "foi remarcado" continua reprovado', () => {
  const r = verificarRespostaRedatora(
    'Sua consulta foi remarcado para 10/08 às 14:00.',
    {
      objetivo: 'acolher_e_retomar',
      agendamentos_do_paciente: ['Limpeza com Dra. Ana — segunda-feira, 10/08 às 14:00'],
    } as FatosAutorizados
  );
  assert.deepEqual(r, { aprovado: false, motivo: 'execucao_nao_autorizada' });
});
