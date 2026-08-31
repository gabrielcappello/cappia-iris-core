// Dentista habitual a partir do historico de atendimento
// (dentistas-historicos.ts + dentista-preferido-do-paciente.ts).
//
// Cobre os casos exigidos na aprovacao do Gabriel (2026-08-31), incluindo o
// caso REAL de producao: `confirmado` no MESMO dia, horario ja passado, um
// unico dentista -- que a busca de agendamentos ativos exclui de proposito.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buscarDentistasHistoricos } from './dentistas-historicos.ts';
import { aplicarDentistaPreferido } from './dentista-preferido-do-paciente.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import type { ClienteBancoDados } from './tipos.ts';

const CLINICA = '11111111-1111-4111-8111-111111111111';
const OUTRA_CLINICA = '22222222-2222-4222-8222-222222222222';
const PACIENTE = '33333333-3333-4333-8333-333333333333';
const OUTRO_PACIENTE = '44444444-4444-4444-8444-444444444444';

const PEREZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RAMOZ = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Terca-feira, 10:32 -- o horario exato da conversa real.
const AGORA = { data: '2026-08-31', minuto_min: 10 * 60 + 32 };

// Snapshot minimo que sinaliza "este turno trata de agendamento" -- o sinal
// estrutural exigido pela terceira guarda (secao 13.5). Sem ele, a deducao
// historica nem e tentada, por mais que as outras condicoes valham.
const EM_AGENDAMENTO = { intencao: 'novo_agendamento' };

function semear(
  tabelas: TabelasFalsas,
  linhas: { data: string; horario: string; status: string; dentista_id: string; clinica_id?: string; paciente_id?: string }[]
) {
  for (const l of linhas) {
    tabelas.agendamentos.push({
      id: crypto.randomUUID(),
      clinica_id: l.clinica_id ?? CLINICA,
      paciente_id: l.paciente_id ?? PACIENTE,
      data: l.data,
      horario: l.horario,
      status: l.status,
      dentista_id: l.dentista_id,
      dentista_nome: 'Dr. Fulano',
      procedimento: 'Limpeza',
    });
  }
}

async function historico(tabelas: TabelasFalsas, pacienteId: string | null = PACIENTE) {
  return await buscarDentistasHistoricos(new ClienteFalso(tabelas) as unknown as ClienteBancoDados, {
    clinica_id: CLINICA,
    paciente_id: pacienteId,
    instante_atual: AGORA,
  });
}

// --- A fonte historica -----------------------------------------------------

// O CASO REAL DE PRODUCAO (v93, 31/08): confirmado, mesmo dia, 08:00, e a
// mensagem chegou 10:32. A busca de ativos exclui; esta precisa incluir.
test('CASO REAL: confirmado no mesmo dia com horario ja passado entra no historico', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semear(tabelas, [{ data: '2026-08-31', horario: '08:00', status: 'confirmado', dentista_id: PEREZ }]);

  assert.deepEqual(await historico(tabelas), [PEREZ]);
});

test('concluido entra sempre, independente do relogio', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semear(tabelas, [{ data: '2026-08-20', horario: '14:00', status: 'concluido', dentista_id: PEREZ }]);

  assert.deepEqual(await historico(tabelas), [PEREZ]);
});

test('confirmado FUTURO nao entra na fonte historica', async () => {
  const tabelas = criarTabelasFalsasVazias();
  // Amanha, e hoje mais tarde: os dois sao compromisso, nao historico.
  semear(tabelas, [
    { data: '2026-09-01', horario: '09:00', status: 'confirmado', dentista_id: PEREZ },
    { data: '2026-08-31', horario: '16:00', status: 'confirmado', dentista_id: RAMOZ },
  ]);

  assert.deepEqual(await historico(tabelas), []);
});

test('cancelado, remarcado e faltou nunca entram', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semear(tabelas, [
    { data: '2026-08-20', horario: '09:00', status: 'cancelado', dentista_id: PEREZ },
    { data: '2026-08-21', horario: '09:00', status: 'remarcado', dentista_id: PEREZ },
    { data: '2026-08-22', horario: '09:00', status: 'faltou', dentista_id: RAMOZ },
  ]);

  assert.deepEqual(await historico(tabelas), []);
});

test('isolamento: outra clinica e outro paciente nunca contaminam', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semear(tabelas, [
    { data: '2026-08-20', horario: '09:00', status: 'concluido', dentista_id: PEREZ },
    // Mesmo paciente, OUTRA clinica -- aquele dentista nao e "o dele" aqui.
    { data: '2026-08-20', horario: '09:00', status: 'concluido', dentista_id: RAMOZ, clinica_id: OUTRA_CLINICA },
    // Mesma clinica, OUTRO paciente.
    { data: '2026-08-20', horario: '09:00', status: 'concluido', dentista_id: RAMOZ, paciente_id: OUTRO_PACIENTE },
  ]);

  assert.deepEqual(await historico(tabelas), [PEREZ]);
});

test('paciente sem ficha: nenhuma consulta, conjunto vazio', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semear(tabelas, [{ data: '2026-08-20', horario: '09:00', status: 'concluido', dentista_id: PEREZ }]);

  assert.deepEqual(await historico(tabelas, null), []);
});

// --- A deducao -------------------------------------------------------------

test('um unico dentista no historico: aplicado como habitual', async () => {
  // `intencao` presente: o turno trata de agendamento, entao a deducao e
  // tentada (terceira guarda, specs/dentista-semantico-v1.md secao 13.5).
  const r = await aplicarDentistaPreferido({}, null, undefined, EM_AGENDAMENTO, async () => [PEREZ]);

  assert.equal(r.aplicou, true);
  assert.equal(r.alteracoes.dentista_id?.valor, PEREZ);
});

test('dois dentistas distintos: nao escolhe por conta propria', async () => {
  const r = await aplicarDentistaPreferido({}, null, undefined, {}, async () => [PEREZ, RAMOZ]);

  assert.equal(r.aplicou, false);
  assert.equal(r.alteracoes.dentista_id, undefined);
});

test('historico vazio: nao aplica', async () => {
  const r = await aplicarDentistaPreferido({}, null, undefined, {}, async () => []);

  assert.equal(r.aplicou, false);
});

test('preferencia EXPLICITA do turno prevalece sobre o habitual', async () => {
  // O paciente nomeou RAMOZ neste turno; o historico diz PEREZ. A escolha
  // dele manda, e o Core nao sobrescreve.
  const r = await aplicarDentistaPreferido({}, [RAMOZ], undefined, {}, async () => [PEREZ]);

  assert.equal(r.aplicou, false);
  assert.equal(r.alteracoes.dentista_id, undefined);
});

test('dentista ja definido na conversa prevalece sobre o habitual', async () => {
  const r = await aplicarDentistaPreferido({}, null, undefined, { dentista_id: RAMOZ }, async () => [PEREZ]);

  assert.equal(r.aplicou, false);
});

test('futuro e passado apontando para o MESMO profissional: continua um so', async () => {
  const r = await aplicarDentistaPreferido(
    {},
    null,
    [{ dentista_id: PEREZ }] as never,
    EM_AGENDAMENTO,
    async () => [PEREZ]
  );

  assert.equal(r.aplicou, true);
  assert.equal(r.alteracoes.dentista_id?.valor, PEREZ);
});

test('futuro e passado com profissionais DIFERENTES: nao escolhe', async () => {
  const r = await aplicarDentistaPreferido(
    {},
    null,
    [{ dentista_id: RAMOZ }] as never,
    {},
    async () => [PEREZ]
  );

  assert.equal(r.aplicou, false);
});

// --- ISOLAMENTO: o passado NUNCA vaza para o modelo ------------------------
// Condicao arquitetural do Gabriel (2026-08-31): `agendamentos_do_paciente`
// tem semantica de FUTURO/ATIVO e atravessa ate a redatora. Se um
// atendimento passado entrasse ali, a Iris poderia apresenta-lo como consulta
// marcada. Este teste falha se alguem reaproveitar o campo.
test('ISOLAMENTO: atendimento passado nao entra em agendamentos_do_paciente nem no payload do modelo', async () => {
  const { processarMensagem } = await import('./orquestrador.ts');
  const { ClienteModeloFalso } = await import('./teste-cliente-modelo-falso.ts');
  const { ClienteRpcFalso } = await import('./teste-cliente-rpc-falso.ts');

  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = crypto.randomUUID();
  const pacienteId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const TELEFONE = '5511999998888';

  tabelas.clinicas.push({
    id: clinicaId,
    provider: 'evolution',
    instancia_whatsapp: 'clinica-teste',
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [
      {
        id: dentistaId,
        nome: 'Perez',
        titulo: 'Dr.',
        ativo: true,
        modo: 'auto',
        dur: 30,
        inicio: '08:00',
        fim: '18:00',
        sabado: false,
        alm_ini: null,
        alm_fim: null,
        procedimentos: [{ id: 'limpeza', nome: 'Limpeza', ativo: true, tempo: 30 }],
      },
    ],
  });
  tabelas.pacientes.push({
    id: pacienteId,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    nome: 'Gabriel Cappello',
    documento: '52998224725',
    data_nascimento: '1979-06-23',
  });
  tabelas.procedimentos_catalogo.push({
    id: 'limpeza',
    nome_pt: 'Limpeza',
    nome_es: null, nome_en: null, nome_fr: null, nome_de: null,
    nome_it: null, nome_ru: null, nome_ar: null,
    tempo_padrao: 30,
    ativo: true,
  });
  // Atendimento PASSADO -- o caso real: mesmo dia, 08:00, confirmado.
  tabelas.agendamentos.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    data: '2026-08-31',
    horario: '08:00',
    status: 'confirmado',
    dentista_id: dentistaId,
    dentista_nome: 'Dr. Perez',
    procedimento: 'Canal',
  });

  const modelo = new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]);
  await processarMensagem(modelo, new ClienteFalso(tabelas), new ClienteRpcFalso({}), {
    provider: 'evolution',
    instancia_whatsapp: 'clinica-teste',
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['bom dia'],
    instante_atual: AGORA,
  });

  const payload = modelo.chamadas[0].payload as Record<string, unknown>;

  // 1. o atendimento passado NAO pode aparecer como agendamento do paciente.
  assert.ok(
    !('agendamentos_do_paciente' in payload),
    'atendimento passado nunca pode entrar em agendamentos_do_paciente'
  );

  // 2. e nenhum detalhe do historico pode ter chegado ao modelo -- o Core
  //    deduz sozinho; a IA nao precisa saber data, procedimento nem dentista.
  const serializado = JSON.stringify(payload);
  assert.ok(!serializado.includes('dentistas_historicos'), 'o historico nunca vai ao payload do modelo');
  assert.ok(!serializado.includes('Canal'), 'o procedimento do atendimento passado nunca vai ao modelo');
  assert.ok(!serializado.includes('08:00'), 'o horario do atendimento passado nunca vai ao modelo');
});

// --- LEITURA SOB DEMANDA (specs/dentista-semantico-v1.md secao 13.5) -------
// A consulta historica nao pode acontecer em toda mensagem: um "bom dia"
// ganharia um SELECT extra, e uma falha nessa leitura derrubaria conversa que
// nao envolve dentista nenhum. Estes testes provam as quatro condicoes.

/** Carregador que CONTA chamadas -- prova se a consulta aconteceu ou nao. */
function carregadorEspiao(retorno: readonly string[]) {
  const estado = { chamadas: 0 };
  return {
    estado,
    carregar: async () => {
      estado.chamadas++;
      return retorno;
    },
  };
}

test('SOB DEMANDA: escolha explicita no turno NAO dispara a consulta historica', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  // O paciente nomeou RAMOZ -- nao ha o que deduzir.
  const r = await aplicarDentistaPreferido({}, [RAMOZ], undefined, {}, espiao.carregar);

  assert.equal(r.aplicou, false);
  assert.equal(espiao.estado.chamadas, 0, 'com escolha explicita, o historico nunca deve ser lido');
});

test('SOB DEMANDA: dentista ja definido na conversa NAO dispara a consulta', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  const r = await aplicarDentistaPreferido({}, null, undefined, { dentista_id: RAMOZ }, espiao.carregar);

  assert.equal(r.aplicou, false);
  assert.equal(espiao.estado.chamadas, 0, 'com dentista ja definido, o historico nunca deve ser lido');
});

test('SOB DEMANDA: quando a deducao e necessaria, faz UMA unica consulta', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  const r = await aplicarDentistaPreferido({}, null, undefined, EM_AGENDAMENTO, espiao.carregar);

  assert.equal(r.aplicou, true);
  assert.equal(espiao.estado.chamadas, 1, 'exatamente uma consulta, nunca uma por consumidor');
});

test('SOB DEMANDA: erro na consulta historica nao afeta turno com escolha explicita', async () => {
  // Carregador que EXPLODE. Se a guarda funcionar, ele nunca e chamado e o
  // turno segue normalmente -- e a garantia de que uma falha nessa leitura
  // nao alcanca conversas que nao dependem dela.
  const carregarQueFalha = async (): Promise<readonly string[]> => {
    throw new Error('falha ao buscar historico de dentistas: banco indisponivel');
  };

  const r = await aplicarDentistaPreferido({}, [RAMOZ], undefined, {}, carregarQueFalha);

  assert.equal(r.aplicou, false, 'o turno continua, sem propagar a falha');
});

test('SOB DEMANDA: saudacao nao consulta o historico (fluxo real, ponta a ponta)', async () => {
  const { processarMensagem } = await import('./orquestrador.ts');
  const { ClienteModeloFalso } = await import('./teste-cliente-modelo-falso.ts');
  const { ClienteRpcFalso } = await import('./teste-cliente-rpc-falso.ts');

  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = crypto.randomUUID();
  const pacienteId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const TELEFONE = '5511999997777';

  tabelas.clinicas.push({
    id: clinicaId,
    provider: 'evolution',
    instancia_whatsapp: 'clinica-teste',
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [
      {
        id: dentistaId,
        nome: 'Perez', titulo: 'Dr.', ativo: true, modo: 'auto', dur: 30,
        inicio: '08:00', fim: '18:00', sabado: false, alm_ini: null, alm_fim: null,
        procedimentos: [{ id: 'limpeza', nome: 'Limpeza', ativo: true, tempo: 30 }],
      },
    ],
  });
  tabelas.pacientes.push({
    id: pacienteId, clinica_id: clinicaId, telefone_normalizado: TELEFONE,
    nome: 'Gabriel Cappello', documento: '52998224725', data_nascimento: '1979-06-23',
  });
  tabelas.procedimentos_catalogo.push({
    id: 'limpeza', nome_pt: 'Limpeza',
    nome_es: null, nome_en: null, nome_fr: null, nome_de: null,
    nome_it: null, nome_ru: null, nome_ar: null,
    tempo_padrao: 30, ativo: true,
  });
  // Conversa que JA tem dentista definido: a deducao nao e necessaria, entao
  // a consulta historica nao pode acontecer.
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { dentista_id: dentistaId },
    paciente_id: pacienteId,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });

  const clienteBanco = new ClienteFalso(tabelas);
  await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]),
    clienteBanco,
    new ClienteRpcFalso({}),
    {
      provider: 'evolution',
      instancia_whatsapp: 'clinica-teste',
      telefone_normalizado: TELEFONE,
      mensagens_atuais: ['bom dia'],
      instante_atual: AGORA,
    }
  );

  // UMA consulta a `agendamentos` (a de ativos, que todo turno faz) -- nunca
  // duas. A segunda so aparece quando o Core precisa deduzir o profissional.
  assert.equal(
    clienteBanco.estatisticas.chamadasSelect.agendamentos,
    1,
    'com dentista ja definido, a consulta historica nao pode acontecer'
  );
});

// PROVA DO BURACO (antes da correcao): conversa LIMPA, sem dentista definido,
// mensagem "bom dia". As duas guardas passam e o carregador e chamado.
test('BURACO: saudacao em conversa limpa NAO pode consultar o historico', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  // Nenhum candidato da IA, nenhum dentista no snapshot -- exatamente o que
  // um "bom dia" produz numa conversa nova.
  const r = await aplicarDentistaPreferido({}, null, undefined, {}, espiao.carregar);

  assert.equal(espiao.estado.chamadas, 0, 'um "bom dia" nunca pode pagar consulta ao historico');
  assert.equal(r.aplicou, false);
});

// --- A/B PONTA A PONTA: mesma base, so a MENSAGEM muda -------------------
// Prova a terceira guarda (secao 13.5) no fluxo real, nao so na funcao pura.
// Base identica nos dois lados: paciente cadastrado, historico elegivel com
// UM dentista, conversa SEM dentista definido. A unica variavel e a mensagem.

const ID_LIMPEZA_AB = 'limpeza';

function montarBaseAB() {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = crypto.randomUUID();
  const pacienteId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const TELEFONE = '5511999996666';

  tabelas.clinicas.push({
    id: clinicaId,
    provider: 'evolution',
    instancia_whatsapp: 'clinica-teste',
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [
      {
        id: dentistaId,
        nome: 'Perez', titulo: 'Dr.', ativo: true, modo: 'auto', dur: 30,
        inicio: '08:00', fim: '18:00', sabado: false, alm_ini: null, alm_fim: null,
        procedimentos: [{ id: ID_LIMPEZA_AB, nome: 'Limpeza', ativo: true, tempo: 30 }],
      },
    ],
  });
  tabelas.pacientes.push({
    id: pacienteId, clinica_id: clinicaId, telefone_normalizado: TELEFONE,
    nome: 'Gabriel Cappello', documento: '52998224725', data_nascimento: '1979-06-23',
  });
  tabelas.procedimentos_catalogo.push({
    id: ID_LIMPEZA_AB, nome_pt: 'Limpeza',
    nome_es: null, nome_en: null, nome_fr: null, nome_de: null,
    nome_it: null, nome_ru: null, nome_ar: null,
    tempo_padrao: 30, ativo: true,
  });
  // HISTORICO ELEGIVEL: um unico dentista, atendimento de hoje ja passado --
  // o caso real do Diego Perez.
  tabelas.agendamentos.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    data: '2026-08-31',
    horario: '08:00',
    status: 'confirmado',
    dentista_id: dentistaId,
    dentista_nome: 'Dr. Perez',
    procedimento: 'Canal',
  });
  // Conversa SEM dentista definido.
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: pacienteId,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });

  return { tabelas, clinicaId, pacienteId, dentistaId, TELEFONE };
}

test('A/B [A]: "bom dia" -- zero consultas ao historico e nenhum dentista_id gravado', async () => {
  const { processarMensagem } = await import('./orquestrador.ts');
  const { ClienteModeloFalso } = await import('./teste-cliente-modelo-falso.ts');
  const { ClienteRpcFalso } = await import('./teste-cliente-rpc-falso.ts');

  const { tabelas, TELEFONE } = montarBaseAB();
  const clienteBanco = new ClienteFalso(tabelas);

  await processarMensagem(
    // Saudacao pura: sem intencao, sem procedimento, sem dentista.
    new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]),
    clienteBanco,
    new ClienteRpcFalso({}),
    {
      provider: 'evolution',
      instancia_whatsapp: 'clinica-teste',
      telefone_normalizado: TELEFONE,
      mensagens_atuais: ['bom dia'],
      instante_atual: AGORA,
    }
  );

  // UMA consulta a `agendamentos` -- a de ativos, que todo turno faz. A
  // segunda (historico) NAO pode acontecer numa saudacao.
  assert.equal(
    clienteBanco.estatisticas.chamadasSelect.agendamentos,
    1,
    'um "bom dia" nao pode disparar a consulta historica'
  );

  // E nenhum dentista foi gravado por deducao.
  const linha = tabelas.estado_conversa.find((c) => c.telefone_normalizado === TELEFONE) as unknown as {
    dados: Record<string, unknown>;
  };
  assert.equal(linha.dados.dentista_id, undefined, 'saudacao nunca grava dentista_id por deducao');
});

test('A/B [B]: pedido de agendamento -- UMA consulta ao historico e habitual aplicado', async () => {
  const { processarMensagem } = await import('./orquestrador.ts');
  const { ClienteModeloFalso } = await import('./teste-cliente-modelo-falso.ts');
  const { ClienteRpcFalso } = await import('./teste-cliente-rpc-falso.ts');

  const { tabelas, dentistaId, TELEFONE } = montarBaseAB();
  const clienteBanco = new ClienteFalso(tabelas);

  await processarMensagem(
    // Pedido real: intencao + procedimento, sem nomear profissional nenhum.
    new ClienteModeloFalso([
      {
        natureza_mensagem: 'pedido',
        alteracoes: {
          intencao: { acao: 'informar', valor: 'novo_agendamento' },
          procedimento_id: { acao: 'informar', valor: ID_LIMPEZA_AB },
        },
      },
    ]),
    clienteBanco,
    new ClienteRpcFalso({}),
    {
      provider: 'evolution',
      instancia_whatsapp: 'clinica-teste',
      telefone_normalizado: TELEFONE,
      mensagens_atuais: ['queria marcar uma limpeza'],
      instante_atual: AGORA,
    }
  );

  // DUAS consultas: ativos + historico. Exatamente uma de cada, nunca mais.
  assert.equal(
    clienteBanco.estatisticas.chamadasSelect.agendamentos,
    2,
    'quando a deducao e necessaria, exatamente uma consulta historica'
  );

  // E o dentista habitual foi aplicado -- o defeito real corrigido.
  const linha = tabelas.estado_conversa.find((c) => c.telefone_normalizado === TELEFONE) as unknown as {
    dados: Record<string, unknown>;
  };
  assert.equal(
    linha.dados.dentista_id,
    dentistaId,
    'com pedido de agendamento, o dentista habitual do historico e aplicado'
  );
});

// --- NEGATIVOS: cancelamento e remarcacao nunca deduzem o habitual --------
// `INTENCOES_PERMITIDAS` tem tres valores; esta deducao pertence SO ao novo
// agendamento (specs/dentista-semantico-v1.md secao 13.5). Mesma base dos
// testes A/B: historico elegivel com UM dentista, conversa sem dentista
// definido -- so a intencao muda.

test('NEGATIVO: cancelamento com historico elegivel -- zero consulta e nenhum dentista deduzido', async () => {
  const { processarMensagem } = await import('./orquestrador.ts');
  const { ClienteModeloFalso } = await import('./teste-cliente-modelo-falso.ts');
  const { ClienteRpcFalso } = await import('./teste-cliente-rpc-falso.ts');

  const { tabelas, TELEFONE } = montarBaseAB();
  const clienteBanco = new ClienteFalso(tabelas);

  await processarMensagem(
    new ClienteModeloFalso([
      {
        natureza_mensagem: 'pedido',
        alteracoes: { intencao: { acao: 'informar', valor: 'cancelamento' } },
      },
    ]),
    clienteBanco,
    new ClienteRpcFalso({}),
    {
      provider: 'evolution',
      instancia_whatsapp: 'clinica-teste',
      telefone_normalizado: TELEFONE,
      mensagens_atuais: ['quero cancelar minha consulta'],
      instante_atual: AGORA,
    }
  );

  // Contar SELECTs em `agendamentos` NAO serve aqui: `decidirCancelamento`
  // faz a propria busca de agendamento ativo, comportamento pre-existente e
  // legitimo. O que este teste mede e a DEDUCAO -- provada pela ausencia de
  // `dentista_id` deduzido. A prova de "zero consulta historica" no
  // cancelamento esta no teste unitario com carregador espiao, abaixo.
  const linha = tabelas.estado_conversa.find((c) => c.telefone_normalizado === TELEFONE) as unknown as {
    dados: Record<string, unknown>;
  };
  assert.equal(linha.dados.dentista_id, undefined, 'cancelar nao escolhe profissional');
});

test('NEGATIVO: remarcacao com historico elegivel -- nenhum habitual deduzido', async () => {
  const { processarMensagem } = await import('./orquestrador.ts');
  const { ClienteModeloFalso } = await import('./teste-cliente-modelo-falso.ts');
  const { ClienteRpcFalso } = await import('./teste-cliente-rpc-falso.ts');

  const { tabelas, TELEFONE } = montarBaseAB();
  const clienteBanco = new ClienteFalso(tabelas);

  await processarMensagem(
    new ClienteModeloFalso([
      {
        natureza_mensagem: 'pedido',
        alteracoes: { intencao: { acao: 'informar', valor: 'remarcacao' } },
      },
    ]),
    clienteBanco,
    new ClienteRpcFalso({}),
    {
      provider: 'evolution',
      instancia_whatsapp: 'clinica-teste',
      telefone_normalizado: TELEFONE,
      mensagens_atuais: ['preciso remarcar meu horario'],
      instante_atual: AGORA,
    }
  );

  // Mesmo criterio do cancelamento: a remarcacao tambem busca agendamento
  // ativo por conta propria. O que se mede aqui e a DEDUCAO.
  //
  // O profissional da remarcacao vem do CONTRATO dela (o dentista do
  // agendamento remarcado), nunca do habitual deduzido aqui.
  const linha = tabelas.estado_conversa.find((c) => c.telefone_normalizado === TELEFONE) as unknown as {
    dados: Record<string, unknown>;
  };
  assert.equal(linha.dados.dentista_id, undefined, 'remarcacao nao deduz dentista habitual');
});

// Unitario: `agendamento_id` em foco dispensa a deducao mesmo sem intencao.
test('NEGATIVO: agendamento_id no snapshot (agendamento existente) nao deduz habitual', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  const r = await aplicarDentistaPreferido(
    {},
    null,
    undefined,
    { agendamento_id: '99999999-9999-4999-8999-999999999999' },
    espiao.carregar
  );

  assert.equal(r.aplicou, false);
  assert.equal(espiao.estado.chamadas, 0, 'agendamento existente em foco nunca consulta o historico');
});

// Unitario: intencao de cancelamento SOBREPOE procedimento antigo no snapshot.
test('NEGATIVO: cancelamento sobrepoe procedimento_id antigo -- nao deduz', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  const r = await aplicarDentistaPreferido(
    { intencao: { acao: 'informar', valor: 'cancelamento' } },
    null,
    undefined,
    // Snapshot de uma conversa que ANTES era de agendamento.
    { procedimento_id: 'limpeza', intencao: 'novo_agendamento' },
    espiao.carregar
  );

  assert.equal(r.aplicou, false);
  assert.equal(espiao.estado.chamadas, 0, 'a intencao EFETIVA do turno manda sobre o snapshot antigo');
});

// Prova direta de "zero consulta historica" nos dois fluxos, com o
// instrumento certo: o carregador espiao. Contar SELECTs em `agendamentos`
// nao serve, porque cancelamento e remarcacao fazem a propria busca de
// agendamento ativo -- comportamento pre-existente e legitimo.
test('NEGATIVO (unitario): intencao=cancelamento nunca chama o carregador historico', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  const r = await aplicarDentistaPreferido(
    { intencao: { acao: 'informar', valor: 'cancelamento' } } as never,
    null, undefined, {}, espiao.carregar
  );

  assert.equal(r.aplicou, false);
  assert.equal(espiao.estado.chamadas, 0, 'cancelamento nunca consulta o historico');
});

test('NEGATIVO (unitario): intencao=remarcacao nunca chama o carregador historico', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  const r = await aplicarDentistaPreferido(
    { intencao: { acao: 'informar', valor: 'remarcacao' } } as never,
    null, undefined, {}, espiao.carregar
  );

  assert.equal(r.aplicou, false);
  assert.equal(espiao.estado.chamadas, 0, 'remarcacao nunca consulta o historico');
});

test('POSITIVO (contraste): intencao=novo_agendamento chama uma unica vez e aplica', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  const r = await aplicarDentistaPreferido(
    { intencao: { acao: 'informar', valor: 'novo_agendamento' } } as never,
    null, undefined, {}, espiao.carregar
  );

  assert.equal(r.aplicou, true);
  assert.equal(r.alteracoes.dentista_id?.valor, PEREZ);
  assert.equal(espiao.estado.chamadas, 1);
});

// --- A/B: null vs [] -- os DOIS significados de dentistas_candidatos -------
// Secao 12 da spec (contrato fechado 2026-08-09):
//   null = o paciente NAO mencionou profissional;
//   []   = mencionou alguem que NAO existe nesta clinica.
//
// Base identica; a UNICA variavel e null vs []. Ate 2026-08-31 o codigo
// tratava os dois como iguais e o `[]` aplicava o habitual em silencio --
// o oposto de "a escolha explicita prevalece".

test('A/B candidatos [null]: sem mencao -- deduz o habitual', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  const r = await aplicarDentistaPreferido(
    { intencao: { acao: 'informar', valor: 'novo_agendamento' } } as never,
    null,
    undefined,
    {},
    espiao.carregar
  );

  assert.equal(r.aplicou, true, 'sem mencao, o habitual pode ser deduzido');
  assert.equal(r.alteracoes.dentista_id?.valor, PEREZ);
  assert.equal(espiao.estado.chamadas, 1);
});

test('A/B candidatos [[]]: mencionou alguem inexistente -- NUNCA deduz o habitual', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  const r = await aplicarDentistaPreferido(
    { intencao: { acao: 'informar', valor: 'novo_agendamento' } } as never,
    [],
    undefined,
    {},
    espiao.carregar
  );

  assert.equal(r.aplicou, false, 'preferencia declarada prevalece, mesmo nao localizada');
  assert.equal(r.alteracoes.dentista_id, undefined, 'nunca escolher contra o que o paciente disse');
  assert.equal(espiao.estado.chamadas, 0, 'sem deducao, sem consulta');
});

// O `[]` precisa CHEGAR intacto ao Core, para virar `preferencia_nao_localizada`.
// Esta guarda nao pode consumi-lo nem converte-lo.
test('A/B candidatos [[]]: a lista vazia sobrevive para o fluxo de preferencia nao localizada', async () => {
  const r = await aplicarDentistaPreferido(
    { intencao: { acao: 'informar', valor: 'novo_agendamento' } } as never,
    [],
    undefined,
    {},
    async () => [PEREZ]
  );

  // As alteracoes saem intactas: nada foi adicionado nem removido, entao o
  // `[]` segue para `aplicarCandidatoUnicoDeDentista` e para a decisao do
  // Core, que emite `preferencia_nao_localizada`.
  assert.deepEqual(r.alteracoes, { intencao: { acao: 'informar', valor: 'novo_agendamento' } });
});

// Lista PREENCHIDA: o terceiro significado, ja coberto antes -- confirmado
// aqui no mesmo A/B para os tres valores conviverem no arquivo.
test('A/B candidatos [preenchida]: escolha localizada -- nao deduz habitual', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  const r = await aplicarDentistaPreferido(
    { intencao: { acao: 'informar', valor: 'novo_agendamento' } } as never,
    [RAMOZ],
    undefined,
    {},
    espiao.carregar
  );

  assert.equal(r.aplicou, false);
  assert.equal(espiao.estado.chamadas, 0);
});

// --- REVISAO ADVERSARIAL (2026-08-31): acoes informar/corrigir/remover -----
// Contraprovas: cenarios em que o Core poderia escolher um dentista CONTRA o
// que o paciente disse. As duas primeiras eram defeitos reais, achados nesta
// revisao e corrigidos.

test('CONTRAPROVA: paciente REMOVE o dentista -- o habitual nao pode ser reescrito', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  // "nao quero mais com ele" -- sem dentista no snapshot, so a remocao.
  const r = await aplicarDentistaPreferido(
    {
      dentista_id: { acao: 'remover' },
      intencao: { acao: 'informar', valor: 'novo_agendamento' },
    } as never,
    null, undefined, {}, espiao.carregar
  );

  assert.equal(r.aplicou, false, 'reaplicar o habitual desfaria a remocao que ele pediu');
  assert.equal(r.alteracoes.dentista_id?.valor, undefined);
  assert.equal(espiao.estado.chamadas, 0);
});

test('CONTRAPROVA: paciente REMOVE a intencao -- snapshot antigo nao autoriza deducao', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  const r = await aplicarDentistaPreferido(
    { intencao: { acao: 'remover' } } as never,
    null, undefined,
    // A conversa ERA de agendamento; o paciente desistiu neste turno.
    { intencao: 'novo_agendamento', procedimento_id: 'limpeza' },
    espiao.carregar
  );

  assert.equal(r.aplicou, false, 'intencao retirada nao pode herdar o snapshot superado');
  assert.equal(espiao.estado.chamadas, 0);
});

test('CONTRAPROVA: corrigir dentista para outro -- preferencia corrigida prevalece', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  const r = await aplicarDentistaPreferido(
    {
      dentista_id: { acao: 'corrigir', valor: RAMOZ },
      intencao: { acao: 'informar', valor: 'novo_agendamento' },
    } as never,
    null, undefined, {}, espiao.carregar
  );

  assert.equal(r.aplicou, false);
  assert.equal(r.alteracoes.dentista_id?.valor, RAMOZ, 'o valor corrigido pelo paciente permanece');
  assert.equal(espiao.estado.chamadas, 0);
});

test('CONTRAPROVA: procedimento REMOVIDO nao sustenta a continuacao do fluxo', async () => {
  const espiao = carregadorEspiao([PEREZ]);
  const r = await aplicarDentistaPreferido(
    { procedimento_id: { acao: 'remover' } } as never,
    null, undefined,
    { procedimento_id: 'limpeza' },
    espiao.carregar
  );

  assert.equal(r.aplicou, false);
  assert.equal(espiao.estado.chamadas, 0);
});
