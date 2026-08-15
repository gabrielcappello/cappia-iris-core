// Testes de resolverFatoDeTurno/resolverFatosDeTurno
// (specs/contexto-conversacional-unificado-v2.md §8).
//
// SEM LIGAÇÃO COM PRODUÇÃO. Usa o mesmo dublê de banco já usado pelos testes
// de `buscar-agendamento-ativo.ts` -- busca real (sobre dados falsos), nunca
// mockada por injeção direta de resultado.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolverFatoDeTurno, resolverFatosDeTurno } from './resultado-iris-fatos-de-turno.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';

const CLINICA_ID = crypto.randomUUID();
const OUTRA_CLINICA_ID = crypto.randomUUID();
const PACIENTE_ID = crypto.randomUUID();
const OUTRO_PACIENTE_ID = crypto.randomUUID();

const HOJE = '2026-08-10';
const INSTANTE = { data: HOJE, minuto_min: 720 }; // 12:00

function agendamento(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    clinica_id: CLINICA_ID,
    paciente_id: PACIENTE_ID,
    status: 'confirmado',
    data: '2026-08-15',
    horario: '09:00',
    dentista_id: crypto.randomUUID(),
    dentista_nome: 'Dra. Ana',
    procedimento_id: 'cleaning',
    procedimento: 'Limpeza',
    duracao_min: 60,
    ...overrides,
  };
}

function entradaBusca() {
  return { clinica_id: CLINICA_ID, paciente_id: PACIENTE_ID, instante_atual: INSTANTE };
}

// ── resolverFatoDeTurno: sem âncora ──────────────────────────────────────────

test('resolverFatoDeTurno: âncora null nunca busca e devolve fato ausente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const resultado = await resolverFatoDeTurno(new ClienteFalso(tabelas), null, entradaBusca());
  assert.equal(resultado, null);
});

// ── resolverFatoDeTurno: âncora presente, busca confirma ───────────────────

test('resolverFatoDeTurno: âncora presente e agendamento único confirma o fato', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const linha = agendamento();
  tabelas.agendamentos.push(linha);

  const resultado = await resolverFatoDeTurno(new ClienteFalso(tabelas), linha.id as string, entradaBusca());
  assert.deepEqual(resultado, { agendamento_id: linha.id });
});

test('resolverFatoDeTurno: âncora presente entre múltiplos agendamentos confirma o fato', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const alvo = agendamento({ data: '2026-08-20', horario: '10:00' });
  const outro = agendamento({ data: '2026-08-22', horario: '11:00' });
  tabelas.agendamentos.push(alvo, outro);

  const resultado = await resolverFatoDeTurno(new ClienteFalso(tabelas), alvo.id as string, entradaBusca());
  assert.deepEqual(resultado, { agendamento_id: alvo.id });
});

// ── resolverFatoDeTurno: âncora presente, busca diverge -- recusa ──────────

test('resolverFatoDeTurno: âncora presente mas paciente sem nenhum agendamento ativo -- fato ausente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const resultado = await resolverFatoDeTurno(new ClienteFalso(tabelas), crypto.randomUUID(), entradaBusca());
  assert.equal(resultado, null);
});

test('resolverFatoDeTurno: âncora não corresponde a nenhum dos agendamentos ativos -- fato ausente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push(agendamento());

  const resultado = await resolverFatoDeTurno(new ClienteFalso(tabelas), crypto.randomUUID(), entradaBusca());
  assert.equal(resultado, null);
});

test('resolverFatoDeTurno: âncora aponta para agendamento de OUTRO paciente -- fato ausente (nunca vaza entre pacientes)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const deOutroPaciente = agendamento({ paciente_id: OUTRO_PACIENTE_ID });
  tabelas.agendamentos.push(deOutroPaciente);

  const resultado = await resolverFatoDeTurno(new ClienteFalso(tabelas), deOutroPaciente.id as string, entradaBusca());
  assert.equal(resultado, null);
});

test('resolverFatoDeTurno: âncora aponta para agendamento de OUTRA clínica -- fato ausente (isolamento multiclínica)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const deOutraClinica = agendamento({ clinica_id: OUTRA_CLINICA_ID });
  tabelas.agendamentos.push(deOutraClinica);

  const resultado = await resolverFatoDeTurno(new ClienteFalso(tabelas), deOutraClinica.id as string, entradaBusca());
  assert.equal(resultado, null);
});

test('resolverFatoDeTurno: âncora aponta para agendamento CANCELADO -- fato ausente (estado incompatível)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const cancelado = agendamento({ status: 'cancelado' });
  tabelas.agendamentos.push(cancelado);

  const resultado = await resolverFatoDeTurno(new ClienteFalso(tabelas), cancelado.id as string, entradaBusca());
  assert.equal(resultado, null);
});

test('resolverFatoDeTurno: âncora aponta para agendamento já PASSADO -- fato ausente (corte temporal)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const passado = agendamento({ data: '2026-08-01', horario: '09:00' });
  tabelas.agendamentos.push(passado);

  const resultado = await resolverFatoDeTurno(new ClienteFalso(tabelas), passado.id as string, entradaBusca());
  assert.equal(resultado, null);
});

test('resolverFatoDeTurno: nunca escolhe o único agendamento do paciente por eliminação -- âncora errada mesmo com 1 agendamento real', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.agendamentos.push(agendamento());

  // Ancora um ID que não é o do único agendamento existente -- a função
  // nunca deve "corrigir" para o único disponível.
  const resultado = await resolverFatoDeTurno(new ClienteFalso(tabelas), crypto.randomUUID(), entradaBusca());
  assert.equal(resultado, null);
});

// ── resolverFatosDeTurno: os dois fatos numa única passada ─────────────────

test('resolverFatosDeTurno: as duas âncoras null nunca busca e devolve os dois fatos ausentes', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const resultado = await resolverFatosDeTurno(
    new ClienteFalso(tabelas),
    { agendamentoEmRemarcacaoId: null, agendamentoACancelarId: null },
    entradaBusca()
  );
  assert.deepEqual(resultado, { ok: true, fatos: { agendamento_em_remarcacao: null, agendamento_a_cancelar: null } });
});

test('resolverFatosDeTurno: só remarcação ancorada -- cancelamento fica ausente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const linha = agendamento();
  tabelas.agendamentos.push(linha);

  const resultado = await resolverFatosDeTurno(
    new ClienteFalso(tabelas),
    { agendamentoEmRemarcacaoId: linha.id as string, agendamentoACancelarId: null },
    entradaBusca()
  );
  assert.deepEqual(resultado, {
    ok: true,
    fatos: { agendamento_em_remarcacao: { agendamento_id: linha.id }, agendamento_a_cancelar: null },
  });
});

test('resolverFatosDeTurno: só cancelamento ancorado -- remarcação fica ausente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const linha = agendamento();
  tabelas.agendamentos.push(linha);

  const resultado = await resolverFatosDeTurno(
    new ClienteFalso(tabelas),
    { agendamentoEmRemarcacaoId: null, agendamentoACancelarId: linha.id as string },
    entradaBusca()
  );
  assert.deepEqual(resultado, {
    ok: true,
    fatos: { agendamento_em_remarcacao: null, agendamento_a_cancelar: { agendamento_id: linha.id } },
  });
});

test('resolverFatosDeTurno: as duas âncoras não nulas ao mesmo tempo são recusadas ANTES de qualquer consulta ao banco', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const paraRemarcar = agendamento({ data: '2026-08-20', horario: '10:00' });
  const paraCancelar = agendamento({ data: '2026-08-22', horario: '11:00' });
  tabelas.agendamentos.push(paraRemarcar, paraCancelar);
  const cliente = new ClienteFalso(tabelas);
  let chamadas = 0;
  const clienteContado = {
    from(tabela: string) {
      chamadas++;
      return cliente.from(tabela);
    },
  } as unknown as ClienteFalso;

  const resultado = await resolverFatosDeTurno(
    clienteContado,
    { agendamentoEmRemarcacaoId: paraRemarcar.id as string, agendamentoACancelarId: paraCancelar.id as string },
    entradaBusca()
  );

  assert.equal(resultado.ok, false);
  if (resultado.ok) return;
  assert.match(resultado.erro, /não podem ter âncora ao mesmo tempo/);
  assert.equal(chamadas, 0, 'nenhuma consulta ao banco deveria ter ocorrido');
});

test('resolverFatosDeTurno: com exatamente uma âncora não nula, consulta o banco uma única vez', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const linha = agendamento();
  tabelas.agendamentos.push(linha);
  const cliente = new ClienteFalso(tabelas);
  let chamadas = 0;
  const clienteContado = {
    from(tabela: string) {
      chamadas++;
      return cliente.from(tabela);
    },
  } as unknown as ClienteFalso;

  const resultado = await resolverFatosDeTurno(
    clienteContado,
    { agendamentoEmRemarcacaoId: linha.id as string, agendamentoACancelarId: null },
    entradaBusca()
  );
  assert.equal(resultado.ok, true);
  assert.equal(chamadas, 1);
});
