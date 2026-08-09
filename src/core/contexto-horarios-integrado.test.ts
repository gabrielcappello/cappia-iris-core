// Integracao de contexto_horarios pelo orquestrador real
// (specs/contexto-pendente-interpretacao-v1.md), com dublês em memoria --
// nenhuma rede, nenhum banco real, nenhuma IA real.
//
// Prova o ciclo de vida ponta a ponta (gravar -> ler no turno seguinte ->
// limpar) e as duas garantias de concorrencia: CAS sobre o estado da
// decisao, e operacao obsoleta que nao ressuscita horarios apagados.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { gravarContextoHorarios } from './contexto-horarios.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import type { ContextoHorarios } from './tipos.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
const PROCEDIMENTO_ID = 'cleaning';
// 2026-08-03 = segunda-feira; 08:00 como "agora".
const INSTANTE_ATUAL = { data: '2026-08-03', minuto_min: 480 };

function semearClinicaComAgenda(tabelas: TabelasFalsas): string {
  const clinicaId = crypto.randomUUID();
  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [
      {
        id: crypto.randomUUID(),
        nome: 'Ana',
        titulo: 'Dra.',
        ativo: true,
        modo: 'procedimento',
        inicio: '08:00',
        fim: '12:00',
        sabado: false,
        alm_ini: null,
        alm_fim: null,
        procedimentos: [{ id: PROCEDIMENTO_ID, nome: 'Limpeza', tempo: 30, ativo: true }],
      },
    ],
  });
  tabelas.procedimentos_catalogo.push({
    id: PROCEDIMENTO_ID,
    nome_pt: 'Limpeza',
    nome_es: null,
    nome_en: null,
    nome_fr: null,
    nome_de: null,
    nome_it: null,
    nome_ru: null,
    nome_ar: null,
    tempo_padrao: 30,
    ativo: true,
  });
  return clinicaId;
}

function semearConversa(
  tabelas: TabelasFalsas,
  clinicaId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const conversa: Record<string, unknown> = {
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
    ...overrides,
  };
  tabelas.estado_conversa.push(conversa);
  return conversa;
}

function respostaModelo(natureza: string, alteracoes: Record<string, unknown>) {
  return { natureza_mensagem: natureza, alteracoes };
}

async function rodar(tabelas: TabelasFalsas, clienteModelo: ClienteModeloFalso) {
  return await processarMensagem(clienteModelo, new ClienteFalso(tabelas), new ClienteRpcFalso({}), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['mensagem sintetica'],
    instante_atual: INSTANTE_ATUAL,
  });
}

function contextoDa(tabelas: TabelasFalsas): ContextoHorarios | null {
  return (tabelas.estado_conversa[0].contexto_horarios as ContextoHorarios | null) ?? null;
}

// --- Gravar: a grade oferecida vira snapshot ---

test('integrado: horarios_disponiveis grava o snapshot com os mesmos horarios do texto', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  semearConversa(tabelas, clinicaId);

  const resultado = await rodar(
    tabelas,
    new ClienteModeloFalso([
      respostaModelo('pedido', {
        procedimento_id: { acao: 'informar', valor: PROCEDIMENTO_ID },
        data_texto: { acao: 'informar', valor: 'hoje' },
      }),
    ])
  );

  assert.equal(resultado.decisao.tipo, 'horarios_disponiveis');
  const contexto = contextoDa(tabelas);
  assert.ok(contexto, 'snapshot deveria ter sido gravado');
  assert.ok(contexto.horarios, 'horarios deveria estar presente (decisao substituir)');
  assert.ok(contexto.horarios.length > 0);
  assert.ok(
    contexto.horarios.every((h) => /^[0-9]{2}:[0-9]{2}$/.test(h)),
    'todos no formato HH:MM que horario_texto ja aceita'
  );
});

// --- Ler: o snapshot chega a IA no turno SEGUINTE ---

test('integrado: o snapshot gravado chega a IA como horarios_oferecidos no turno seguinte', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  semearConversa(tabelas, clinicaId, {
    contexto_horarios: { horarios: ['08:00', '09:00', '10:00'], criado_em: '2026-08-03T11:00:00.000Z' },
  });

  const clienteModelo = new ClienteModeloFalso([respostaModelo('resposta', {})]);
  await rodar(tabelas, clienteModelo);

  assert.equal(clienteModelo.chamadas.length, 1);
  assert.deepEqual(clienteModelo.chamadas[0].payload.horarios_oferecidos, ['08:00', '09:00', '10:00']);
});

test('integrado: sem snapshot, horarios_oferecidos nao e enviado a IA', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  semearConversa(tabelas, clinicaId);

  const clienteModelo = new ClienteModeloFalso([respostaModelo('saudacao', {})]);
  await rodar(tabelas, clienteModelo);

  assert.equal('horarios_oferecidos' in clienteModelo.chamadas[0].payload, false);
});

// --- Propor: aguardando_confirmacao grava proposta_pendente, sem merge (2026-08-06) ---

test('integrado: aguardando_confirmacao grava proposta_pendente e SUBSTITUI horarios anteriores por inteiro', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  semearConversa(tabelas, clinicaId, {
    dados: { procedimento_id: PROCEDIMENTO_ID, data_texto: 'hoje', horario_texto: '10:00' },
    contexto_horarios: { horarios: ['08:00', '09:00'], criado_em: '2026-08-03T11:00:00.000Z' },
  });

  const resultado = await rodar(tabelas, new ClienteModeloFalso([respostaModelo('resposta', {})]));

  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao');
  const contexto = contextoDa(tabelas);
  assert.ok(contexto, 'snapshot deveria ter sido gravado');
  assert.deepEqual(contexto.proposta_pendente, { data: '2026-08-03', horario: '10:00' });
  assert.equal('horarios' in contexto, false, 'propor substitui o snapshot por inteiro, nunca faz merge');
});

test('integrado: proposta_pendente gravada chega a IA no turno seguinte', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  semearConversa(tabelas, clinicaId, {
    contexto_horarios: { proposta_pendente: { data: '2026-08-03', horario: '08:00' }, criado_em: '2026-08-03T11:00:00.000Z' },
  });

  const clienteModelo = new ClienteModeloFalso([respostaModelo('resposta', {})]);
  await rodar(tabelas, clienteModelo);

  assert.equal(clienteModelo.chamadas.length, 1);
  assert.deepEqual(clienteModelo.chamadas[0].payload.proposta_pendente, { data: '2026-08-03', horario: '08:00' });
  assert.equal('horarios_oferecidos' in clienteModelo.chamadas[0].payload, false, 'snapshot so tem proposta_pendente');
});

// --- Preservar ---

test('integrado: saudacao preserva o snapshot (desvio de passagem nao apaga a pergunta em andamento)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  const original = { horarios: ['08:00', '09:00'], criado_em: '2026-08-03T11:00:00.000Z' };
  semearConversa(tabelas, clinicaId, { contexto_horarios: original });

  const resultado = await rodar(tabelas, new ClienteModeloFalso([respostaModelo('saudacao', {})]));

  assert.equal(resultado.decisao.tipo, 'saudacao');
  assert.deepEqual(contextoDa(tabelas), original);
});

// --- Limpar ---

test('integrado: desistencia limpa o snapshot', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  semearConversa(tabelas, clinicaId, {
    contexto_horarios: { horarios: ['08:00', '09:00'], criado_em: '2026-08-03T11:00:00.000Z' },
  });

  const resultado = await rodar(tabelas, new ClienteModeloFalso([respostaModelo('negacao', {})]));

  assert.equal(resultado.decisao.tipo, 'desistencia');
  assert.equal(contextoDa(tabelas), null);
});

test('integrado: aguardando_procedimento limpa o snapshot (a pergunta deixou de ser sobre horario)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  semearConversa(tabelas, clinicaId, {
    contexto_horarios: { horarios: ['08:00', '09:00'], criado_em: '2026-08-03T11:00:00.000Z' },
  });

  const resultado = await rodar(
    tabelas,
    new ClienteModeloFalso([respostaModelo('pedido', { data_texto: { acao: 'informar', valor: 'hoje' } })])
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
  assert.equal(contextoDa(tabelas), null);
});

// --- Concorrencia ---

test('integrado: operacao obsoleta NAO ressuscita horarios apagados por uma limpeza mais nova', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  const conversa = semearConversa(tabelas, clinicaId, {
    contexto_horarios: { horarios: ['08:00', '09:00'], criado_em: '2026-08-03T11:00:00.000Z' },
  });
  const atualizadoEmAntigo = conversa.atualizado_em as string;

  // Operacao B (mais nova) limpa e avanca atualizado_em.
  await gravarContextoHorarios(new ClienteFalso(tabelas), {
    conversa_id: conversa.id as string,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    atualizado_em_da_decisao: atualizadoEmAntigo,
    acao: { tipo: 'limpar' },
  });
  assert.equal(contextoDa(tabelas), null, 'B limpou');
  const atualizadoEmDepoisDeB = tabelas.estado_conversa[0].atualizado_em as string;
  assert.notEqual(atualizadoEmDepoisDeB, atualizadoEmAntigo);

  // Operacao A (antiga, em voo) tenta substituir usando o atualizado_em que
  // ela conhecia -- o CAS falha e ela abandona, sem ressuscitar nada.
  await gravarContextoHorarios(new ClienteFalso(tabelas), {
    conversa_id: conversa.id as string,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    atualizado_em_da_decisao: atualizadoEmAntigo,
    acao: { tipo: 'substituir', horarios: ['08:00', '09:00'] },
  });

  assert.equal(contextoDa(tabelas), null, 'snapshot permanece limpo');
  assert.equal(tabelas.estado_conversa[0].atualizado_em, atualizadoEmDepoisDeB, 'nem atualizado_em foi tocado');
});

test('integrado: CAS de outra conversa/clinica nunca atinge esta linha (isolamento)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  const original = { horarios: ['08:00'], criado_em: '2026-08-03T11:00:00.000Z' };
  const conversa = semearConversa(tabelas, clinicaId, { contexto_horarios: original });

  await gravarContextoHorarios(new ClienteFalso(tabelas), {
    conversa_id: crypto.randomUUID(), // outra conversa
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    atualizado_em_da_decisao: conversa.atualizado_em as string,
    acao: { tipo: 'limpar' },
  });

  assert.deepEqual(contextoDa(tabelas), original, 'linha desta conversa intocada');
});
