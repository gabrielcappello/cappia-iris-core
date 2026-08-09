// Integracao de historico_conversa com o orquestrador real e o CAS
// ENCADEADO sobre gravarContextoHorarios (specs/historico-conversacional-v1.md),
// com dublês em memoria -- nenhuma rede, nenhum banco real, nenhuma IA real.
//
// A gravacao de historico_conversa acontece FORA do orquestrador (a resposta
// final so existe depois que gerarRespostaConversacional roda, no chamador --
// ver index.ts) -- por isso estes testes chamam gravarContextoHorarios/
// processarMensagem e gravarHistoricoConversa em sequencia, exatamente como
// o Edge Function real faz.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { gravarContextoHorarios } from './contexto-horarios.ts';
import { gravarHistoricoConversa } from './historico-conversa.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import type { HistoricoConversa } from './tipos.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
const PROCEDIMENTO_ID = 'cleaning';
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

function semearConversa(tabelas: TabelasFalsas, clinicaId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

function historicoDa(tabelas: TabelasFalsas): HistoricoConversa | null {
  return (tabelas.estado_conversa[0].historico_conversa as HistoricoConversa | null) ?? null;
}

// --- Encadeamento dos dois CAS, no mesmo turno ---

test('encadeado: contexto_horarios grava com sucesso, historico_conversa usa o atualizado_em NOVO devolvido e tambem grava com sucesso', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  const conversa = semearConversa(tabelas, clinicaId);
  const atualizadoEmOriginal = conversa.atualizado_em as string;

  const resultado = await rodar(
    tabelas,
    new ClienteModeloFalso([
      respostaModelo('pedido', {
        procedimento_id: { acao: 'informar', valor: PROCEDIMENTO_ID },
        data_texto: { acao: 'informar', valor: 'hoje' },
      }),
    ])
  );

  // contexto_horarios (horarios_disponiveis -> substituir) grava com sucesso:
  // o atualizado_em devolvido precisa ser NOVO, nunca o original.
  assert.equal(resultado.decisao.tipo, 'horarios_disponiveis');
  assert.notEqual(resultado.atualizado_em, atualizadoEmOriginal);
  assert.equal(tabelas.estado_conversa[0].atualizado_em, resultado.atualizado_em, 'linha real reflete o valor devolvido');

  await gravarHistoricoConversa(new ClienteFalso(tabelas), {
    conversa_id: conversa.id as string,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    atualizado_em_da_resposta: resultado.atualizado_em,
    historico_anterior: resultado.historico_conversa,
    mensagem_paciente: 'quero limpeza hoje',
    resposta_iris: 'Tenho horários disponíveis hoje, qual prefere?',
  });

  const historico = historicoDa(tabelas);
  assert.ok(historico, 'historico_conversa deveria ter sido gravado -- CAS encadeado bem-sucedido');
  assert.equal(historico.length, 1);
  assert.equal(historico[0].resposta_iris, 'Tenho horários disponíveis hoje, qual prefere?');
  assert.notEqual(tabelas.estado_conversa[0].atualizado_em, resultado.atualizado_em, 'atualizado_em avancou de novo');
});

// --- CAS falho de contexto_horarios propaga obsolescencia para historico_conversa ---

test('encadeado: CAS de contexto_horarios falho devolve valor obsoleto -- CAS seguinte de historico_conversa falha e abandona', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  const conversa = semearConversa(tabelas, clinicaId);
  const atualizadoEmOriginal = conversa.atualizado_em as string;

  // Operacao B (concorrente, mais nova) grava primeiro e avanca atualizado_em.
  await gravarContextoHorarios(new ClienteFalso(tabelas), {
    conversa_id: conversa.id as string,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    atualizado_em_da_decisao: atualizadoEmOriginal,
    acao: { tipo: 'substituir', horarios: ['08:00'] },
  });
  const atualizadoEmDepoisDeB = tabelas.estado_conversa[0].atualizado_em as string;
  assert.notEqual(atualizadoEmDepoisDeB, atualizadoEmOriginal);

  // Operacao A (obsoleta, em voo) tenta gravar usando o atualizado_em que
  // ela ainda conhecia -- CAS falha, e o retorno e DELIBERADAMENTE o valor
  // obsoleto (contrato de 3 casos de gravarContextoHorarios).
  const atualizadoEmDevolvidoPorA = await gravarContextoHorarios(new ClienteFalso(tabelas), {
    conversa_id: conversa.id as string,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    atualizado_em_da_decisao: atualizadoEmOriginal,
    acao: { tipo: 'substituir', horarios: ['09:00'] },
  });
  assert.equal(atualizadoEmDevolvidoPorA, atualizadoEmOriginal, 'CAS falho devolve o valor obsoleto recebido');

  // historico_conversa de A encadeia sobre esse valor obsoleto -- tambem falha.
  await gravarHistoricoConversa(new ClienteFalso(tabelas), {
    conversa_id: conversa.id as string,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    atualizado_em_da_resposta: atualizadoEmDevolvidoPorA,
    historico_anterior: null,
    mensagem_paciente: 'mensagem da operacao obsoleta',
    resposta_iris: 'resposta da operacao obsoleta',
  });

  assert.equal(historicoDa(tabelas), null, 'historico_conversa nunca foi gravado -- CAS falhou e abandonou em silencio');
  assert.equal(tabelas.estado_conversa[0].atualizado_em, atualizadoEmDepoisDeB, 'atualizado_em nao foi tocado pela operacao obsoleta');
});

// --- reserva_criada nao limpa historico_conversa (decisao explicita do Gabriel, 2026-08-06) ---

test('reserva_criada nao apaga historico_conversa preexistente -- gravarContextoHorarios nunca toca essa coluna', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  const historicoPreexistente: HistoricoConversa = [
    { mensagem_paciente: 'quero limpeza', resposta_iris: 'Perfeito! Confirma o horário das 08:00?', gerada_em: '2026-08-03T10:00:00.000Z' },
  ];
  const conversa = semearConversa(tabelas, clinicaId, { historico_conversa: historicoPreexistente });

  // decisao 'limpar' para contexto_horarios (reserva_criada) -- so afeta
  // contexto_horarios, nunca historico_conversa.
  await gravarContextoHorarios(new ClienteFalso(tabelas), {
    conversa_id: conversa.id as string,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    atualizado_em_da_decisao: conversa.atualizado_em as string,
    acao: { tipo: 'limpar' },
  });

  assert.deepEqual(historicoDa(tabelas), historicoPreexistente, 'historico_conversa permanece intacto -- nenhuma acao de contexto_horarios o apaga');
});

// --- Acumula ate 10, nunca substitui por inteiro ---

test('gravarHistoricoConversa acumula os pares -- nunca substitui o historico anterior por inteiro', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  const conversa = semearConversa(tabelas, clinicaId, {
    historico_conversa: [{ mensagem_paciente: 'oi', resposta_iris: 'Oi! Como posso ajudar?', gerada_em: '2026-08-03T09:00:00.000Z' }],
  });

  await gravarHistoricoConversa(new ClienteFalso(tabelas), {
    conversa_id: conversa.id as string,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    atualizado_em_da_resposta: conversa.atualizado_em as string,
    historico_anterior: conversa.historico_conversa as HistoricoConversa,
    mensagem_paciente: 'quero limpeza',
    resposta_iris: 'Perfeito! Pra quando você quer?',
  });

  const historico = historicoDa(tabelas);
  assert.ok(historico);
  assert.equal(historico.length, 2, 'o par anterior permanece, o novo e anexado');
  assert.equal(historico[0].mensagem_paciente, 'oi');
  assert.equal(historico[1].mensagem_paciente, 'quero limpeza');
});

// --- Concorrencia isolada de historico_conversa (mesmo padrao de contexto_horarios) ---

test('operacao antiga de gravarHistoricoConversa nao sobrescreve um historico mais recente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  const conversa = semearConversa(tabelas, clinicaId);
  const atualizadoEmOriginal = conversa.atualizado_em as string;

  // Operacao B (mais nova) grava primeiro.
  await gravarHistoricoConversa(new ClienteFalso(tabelas), {
    conversa_id: conversa.id as string,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    atualizado_em_da_resposta: atualizadoEmOriginal,
    historico_anterior: null,
    mensagem_paciente: 'mensagem B (mais nova)',
    resposta_iris: 'resposta B (mais nova)',
  });
  const historicoDepoisDeB = historicoDa(tabelas);
  assert.ok(historicoDepoisDeB);

  // Operacao A (antiga, em voo) tenta gravar usando o atualizado_em original,
  // que ja nao corresponde mais a linha -- CAS falha, abandona.
  await gravarHistoricoConversa(new ClienteFalso(tabelas), {
    conversa_id: conversa.id as string,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    atualizado_em_da_resposta: atualizadoEmOriginal,
    historico_anterior: null,
    mensagem_paciente: 'mensagem A (antiga)',
    resposta_iris: 'resposta A (antiga)',
  });

  assert.deepEqual(historicoDa(tabelas), historicoDepoisDeB, 'o historico de B permanece -- A nao sobrescreveu');
});

// --- historico_conversa CHEGA a IA interpretadora (reversao declarada, specs/historico-conversacional-v1.md secao 6) ---

test('historico_conversa presente na conversa, dentro da validade, chega ao payload enviado a IA interpretadora', async () => {
  // ESTE TESTE REVERTE, de proposito, o antigo teste de
  // ultima-troca-integrado.test.ts ("ultima_troca nunca chega a IA
  // interpretadora"). Motivo: evidencia real do WhatsApp em 2026-08-07-- um
  // "Sim" isolado, sem contexto, foi classificado como nao_compreendida.
  // specs/historico-conversacional-v1.md secao 6 reverte esse ponto com
  // justificativa registrada, nao em silencio.
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  semearConversa(tabelas, clinicaId, {
    historico_conversa: [{ mensagem_paciente: 'oi', resposta_iris: 'Oi! Tudo bem?', gerada_em: new Date().toISOString() }],
  });

  const clienteModelo = new ClienteModeloFalso([respostaModelo('saudacao', {})]);
  await rodar(tabelas, clienteModelo);

  assert.equal(clienteModelo.chamadas.length, 1);
  const historicoGravado = historicoDa(tabelas);
  assert.ok(historicoGravado);
  assert.deepEqual(clienteModelo.chamadas[0].payload.historico_recente, [
    { mensagem_paciente: 'oi', resposta_iris: 'Oi! Tudo bem?', gerada_em: historicoGravado[0].gerada_em },
  ]);
});

test('sem historico_conversa na conversa, historico_recente nao e enviado a IA interpretadora', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  semearConversa(tabelas, clinicaId);

  const clienteModelo = new ClienteModeloFalso([respostaModelo('saudacao', {})]);
  await rodar(tabelas, clienteModelo);

  assert.equal('historico_recente' in clienteModelo.chamadas[0].payload, false);
});

test('historico_conversa expirado (> 24h) nao e enviado a IA interpretadora', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinicaComAgenda(tabelas);
  semearConversa(tabelas, clinicaId, {
    historico_conversa: [{ mensagem_paciente: 'oi', resposta_iris: 'Oi! Tudo bem?', gerada_em: '2020-01-01T00:00:00.000Z' }],
  });

  const clienteModelo = new ClienteModeloFalso([respostaModelo('saudacao', {})]);
  await rodar(tabelas, clienteModelo);

  assert.equal('historico_recente' in clienteModelo.chamadas[0].payload, false);
});
