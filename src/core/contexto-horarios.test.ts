// Testes de contexto-horarios.ts (specs/contexto-pendente-interpretacao-v1.md).
// Nenhum acesso a rede ou banco real -- dublê em memoria apenas.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  derivarAcaoContextoHorarios,
  gravarContextoHorarios,
  validarContextoHorarios,
  type AcaoContextoHorarios,
} from './contexto-horarios.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';
import type { ClienteBancoDados, ConsultaEncadeavel } from './tipos.ts';
import type { OpcaoHorario as OpcaoHorarioDisponibilidade } from './disponibilidade-tipos.ts';

function opcao(inicioMin: number): OpcaoHorarioDisponibilidade {
  return {
    clinica_id: 'clinica-1',
    procedimento_id: 'cleaning',
    dentista_id: 'dentista-1',
    data: '2026-08-05',
    fuso: 'America/Sao_Paulo',
    duracao_min: 40,
    inicio_min: inicioMin,
    fim_min: inicioMin + 40,
  };
}

function decisaoHorarios(resultado: Extract<DecisaoOrquestrador, { tipo: 'horarios_disponiveis' }>['resultado']): DecisaoOrquestrador {
  return {
    tipo: 'horarios_disponiveis',
    procedimento_id: 'cleaning',
    dentista_id: 'dentista-1',
    duracao_min: 40,
    resultado,
  };
}

// --- Derivacao: SUBSTITUIR ---

test('substituir: grade de opcoes vira a lista de horarios, na mesma ordem e formatacao do texto', () => {
  const acao = derivarAcaoContextoHorarios(
    decisaoHorarios({ tipo: 'opcoes', opcoes: [opcao(480), opcao(540), opcao(680)] })
  );
  assert.deepEqual(acao, { tipo: 'substituir', horarios: ['08:00', '09:00', '11:20'] });
});

test('substituir: horario_exato_indisponivel com DOIS vizinhos, anterior antes de posterior (ordem do texto)', () => {
  const acao = derivarAcaoContextoHorarios(
    decisaoHorarios({ tipo: 'horario_exato_indisponivel', anterior: opcao(480), posterior: opcao(600) })
  );
  assert.deepEqual(acao, { tipo: 'substituir', horarios: ['08:00', '10:00'] });
});

test('substituir: horario_exato_indisponivel com SO anterior', () => {
  const acao = derivarAcaoContextoHorarios(decisaoHorarios({ tipo: 'horario_exato_indisponivel', anterior: opcao(480) }));
  assert.deepEqual(acao, { tipo: 'substituir', horarios: ['08:00'] });
});

test('substituir: horario_exato_indisponivel com SO posterior', () => {
  const acao = derivarAcaoContextoHorarios(decisaoHorarios({ tipo: 'horario_exato_indisponivel', posterior: opcao(600) }));
  assert.deepEqual(acao, { tipo: 'substituir', horarios: ['10:00'] });
});

test('limpar: horario_exato_indisponivel SEM nenhum vizinho nunca grava snapshot vazio', () => {
  const acao = derivarAcaoContextoHorarios(decisaoHorarios({ tipo: 'horario_exato_indisponivel' }));
  assert.deepEqual(acao, { tipo: 'limpar' });
});

// --- Derivacao: PRESERVAR (os tres desvios de passagem) ---

for (const tipo of ['saudacao', 'duvida_livre', 'mensagem_nao_compreendida'] as const) {
  test(`preservar: ${tipo} nao apaga a pergunta em andamento`, () => {
    assert.deepEqual(derivarAcaoContextoHorarios({ tipo }), { tipo: 'preservar' });
  });
}

// --- Derivacao: LIMPAR (todo o resto) ---

// --- Derivacao: PROPOR (2026-08-06, specs/resposta-conversacional-v1.md secao 5) ---

test('propor: aguardando_confirmacao grava a proposta concreta (data + horario da opcao)', () => {
  const decisao: DecisaoOrquestrador = {
    tipo: 'aguardando_confirmacao',
    procedimento_id: 'cleaning',
    dentista_id: 'dentista-1',
    opcao: opcao(540),
  };
  assert.deepEqual(derivarAcaoContextoHorarios(decisao), { tipo: 'propor', data: '2026-08-05', horario: '09:00' });
});

test('limpar: sem_disponibilidade (a pergunta virou sobre DATA -- lista antiga faria "dia 15" virar 15:00)', () => {
  assert.deepEqual(derivarAcaoContextoHorarios(decisaoHorarios({ tipo: 'sem_disponibilidade' })), { tipo: 'limpar' });
});

test('limpar: aguardando_data_horario', () => {
  const decisao: DecisaoOrquestrador = {
    tipo: 'aguardando_data_horario',
    resultado: { tipo: 'incompleto', motivo: 'intencao_ausente' },
  };
  assert.deepEqual(derivarAcaoContextoHorarios(decisao), { tipo: 'limpar' });
});

test('limpar: reserva_criada e desistencia fecham o ciclo', () => {
  const criada: DecisaoOrquestrador = {
    tipo: 'reserva_criada',
    agendamento_id: 'a-1',
    dentista_id: 'dentista-1',
    procedimento_id: 'cleaning',
    duracao_min: 40,
    data: '2026-08-05',
    horario: '09:00',
  };
  assert.deepEqual(derivarAcaoContextoHorarios(criada), { tipo: 'limpar' });
  assert.deepEqual(derivarAcaoContextoHorarios({ tipo: 'desistencia' }), { tipo: 'limpar' });
});

test('limpar: aguardando_procedimento e reserva_conflito', () => {
  const aguardando: DecisaoOrquestrador = { tipo: 'aguardando_procedimento' };
  assert.deepEqual(derivarAcaoContextoHorarios(aguardando), { tipo: 'limpar' });
  assert.deepEqual(derivarAcaoContextoHorarios({ tipo: 'reserva_conflito' }), { tipo: 'limpar' });
});

// --- Gravacao: CAS, sem releitura, sem retry ---

interface InstrucaoRegistrada {
  operacao: 'select' | 'update';
  valores?: Record<string, unknown>;
  condicoes: Array<[string, unknown]>;
}

/**
 * Dublê minimo que REGISTRA cada instrucao emitida -- e o unico jeito de
 * provar "nenhum SELECT extra antes do UPDATE" e "exatamente um UPDATE",
 * que sao afirmacoes sobre as instrucoes, nao sobre o estado final.
 */
function criarClienteRegistrador(linhasAfetadas: number | 'erro') {
  const instrucoes: InstrucaoRegistrada[] = [];

  const encadeavel = (registro: InstrucaoRegistrada): ConsultaEncadeavel => {
    const alvo: ConsultaEncadeavel = {
      eq(coluna: string, valor: unknown) {
        registro.condicoes.push([coluna, valor]);
        return alvo;
      },
      is: () => alvo,
      not: () => alvo,
      select: () => alvo,
      async maybeSingle() {
        if (linhasAfetadas === 'erro') throw new Error('falha tecnica simulada do cliente');
        return { data: linhasAfetadas > 0 ? { id: 'conversa-1' } : null, error: null };
      },
      then(aoResolver: (valor: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(aoResolver);
      },
    } as unknown as ConsultaEncadeavel;
    return alvo;
  };

  const cliente = {
    from() {
      return {
        select: (): ConsultaEncadeavel => {
          const registro: InstrucaoRegistrada = { operacao: 'select', condicoes: [] };
          instrucoes.push(registro);
          return encadeavel(registro);
        },
        update: (valores: Record<string, unknown>): ConsultaEncadeavel => {
          const registro: InstrucaoRegistrada = { operacao: 'update', valores, condicoes: [] };
          instrucoes.push(registro);
          return encadeavel(registro);
        },
        upsert: (): ConsultaEncadeavel => {
          const registro: InstrucaoRegistrada = { operacao: 'update', condicoes: [] };
          instrucoes.push(registro);
          return encadeavel(registro);
        },
      };
    },
  } as unknown as ClienteBancoDados;

  return { cliente, instrucoes };
}

const ENTRADA_BASE = {
  conversa_id: '11111111-1111-4111-8111-111111111111',
  clinica_id: '22222222-2222-4222-8222-222222222222',
  telefone_normalizado: '5511999999999',
  atualizado_em_da_decisao: '2026-08-05T12:00:00.000Z',
};

test('gravacao: preservar nao emite NENHUMA instrucao (nem select, nem update)', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarContextoHorarios(cliente, { ...ENTRADA_BASE, acao: { tipo: 'preservar' } });
  assert.equal(instrucoes.length, 0);
});

// --- Retorno de 3 casos (specs/memoria-conversacional-minima-v1.md, ajuste
// do Segundo Code 2026-08-06): historico-conversa.ts encadeia seu CAS sobre
// este valor, entao ele precisa refletir exatamente o que aconteceu na linha. ---

test('retorno: preservar devolve atualizado_em_da_decisao recebido, inalterado', async () => {
  const { cliente } = criarClienteRegistrador(1);
  const retorno = await gravarContextoHorarios(cliente, { ...ENTRADA_BASE, acao: { tipo: 'preservar' } });
  assert.equal(retorno, ENTRADA_BASE.atualizado_em_da_decisao);
});

test('retorno: CAS bem-sucedido devolve exatamente o proximoTimestamp gravado (nao o recebido)', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  const retorno = await gravarContextoHorarios(cliente, {
    ...ENTRADA_BASE,
    acao: { tipo: 'substituir', horarios: ['13:00'] },
  });
  const update = instrucoes.find((i) => i.operacao === 'update');
  assert.equal(retorno, update?.valores?.atualizado_em);
  assert.notEqual(retorno, ENTRADA_BASE.atualizado_em_da_decisao);
});

test('retorno: CAS falho (0 linhas) devolve atualizado_em_da_decisao recebido -- DELIBERADAMENTE obsoleto', async () => {
  const { cliente } = criarClienteRegistrador(0);
  const retorno = await gravarContextoHorarios(cliente, {
    ...ENTRADA_BASE,
    acao: { tipo: 'substituir', horarios: ['13:00'] },
  });
  assert.equal(retorno, ENTRADA_BASE.atualizado_em_da_decisao);
});

test('retorno: excecao do cliente devolve atualizado_em_da_decisao recebido, sem lancar', async () => {
  const { cliente } = criarClienteRegistrador('erro');
  const retorno = await gravarContextoHorarios(cliente, {
    ...ENTRADA_BASE,
    acao: { tipo: 'substituir', horarios: ['13:00'] },
  });
  assert.equal(retorno, ENTRADA_BASE.atualizado_em_da_decisao);
});

test('gravacao: substituir emite exatamente UM update e NENHUM select antes dele', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarContextoHorarios(cliente, {
    ...ENTRADA_BASE,
    acao: { tipo: 'substituir', horarios: ['13:00', '14:00'] },
  });

  assert.equal(instrucoes.filter((i) => i.operacao === 'select').length, 0, 'nenhum SELECT extra antes do UPDATE');
  const updates = instrucoes.filter((i) => i.operacao === 'update');
  assert.equal(updates.length, 1, 'exatamente um UPDATE');
  assert.deepEqual((updates[0].valores?.contexto_horarios as { horarios: string[] }).horarios, ['13:00', '14:00']);
});

test('gravacao: a condicao usa o atualizado_em DA DECISAO, e isola por conversa, clinica e telefone', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarContextoHorarios(cliente, { ...ENTRADA_BASE, acao: { tipo: 'substituir', horarios: ['13:00'] } });

  const update = instrucoes.find((i) => i.operacao === 'update');
  assert.ok(update);
  assert.deepEqual(update.condicoes, [
    ['id', ENTRADA_BASE.conversa_id],
    ['clinica_id', ENTRADA_BASE.clinica_id],
    ['telefone_normalizado', ENTRADA_BASE.telefone_normalizado],
    ['atualizado_em', ENTRADA_BASE.atualizado_em_da_decisao],
  ]);
});

test('gravacao: atualizado_em novo e estritamente posterior ao da decisao', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarContextoHorarios(cliente, { ...ENTRADA_BASE, acao: { tipo: 'substituir', horarios: ['13:00'] } });

  const update = instrucoes.find((i) => i.operacao === 'update');
  const novo = Date.parse(update?.valores?.atualizado_em as string);
  assert.ok(novo > Date.parse(ENTRADA_BASE.atualizado_em_da_decisao));
});

test('gravacao: propor grava SOMENTE proposta_pendente, sem merge com horarios anteriores', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarContextoHorarios(cliente, {
    ...ENTRADA_BASE,
    acao: { tipo: 'propor', data: '2026-08-05', horario: '09:00' },
  });

  const updates = instrucoes.filter((i) => i.operacao === 'update');
  assert.equal(updates.length, 1, 'exatamente um UPDATE');
  const contexto = updates[0].valores?.contexto_horarios as Record<string, unknown>;
  assert.deepEqual(contexto.proposta_pendente, { data: '2026-08-05', horario: '09:00' });
  assert.equal('horarios' in contexto, false, 'propor nunca carrega horarios -- substitui o snapshot por inteiro');
});

test('gravacao: limpar grava null, nunca um snapshot vazio', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(1);
  await gravarContextoHorarios(cliente, { ...ENTRADA_BASE, acao: { tipo: 'limpar' } });

  const update = instrucoes.find((i) => i.operacao === 'update');
  assert.equal(update?.valores?.contexto_horarios, null);
});

test('gravacao: CAS falho (0 linhas) abandona na hora -- sem reler, sem segunda tentativa, sem lancar', async () => {
  const { cliente, instrucoes } = criarClienteRegistrador(0);
  await gravarContextoHorarios(cliente, {
    ...ENTRADA_BASE,
    acao: { tipo: 'substituir', horarios: ['13:00', '14:00'] },
  });

  assert.equal(instrucoes.length, 1, 'uma unica instrucao no total');
  assert.equal(instrucoes[0].operacao, 'update');
});

test('gravacao: falha tecnica do cliente tambem nao lanca (escrita auxiliar nunca vira erro pro paciente)', async () => {
  const { cliente } = criarClienteRegistrador('erro');
  await gravarContextoHorarios(cliente, { ...ENTRADA_BASE, acao: { tipo: 'substituir', horarios: ['13:00'] } });
});

// --- Leitura: fronteira de confianca (falha ABERTA, por ser auxiliar) ---

test('leitura: snapshot valido (so horarios) atravessa intacto', () => {
  const valido = { horarios: ['13:00', '14:00'], criado_em: '2026-08-05T12:00:00.000Z' };
  assert.deepEqual(validarContextoHorarios(valido), valido);
});

// 2026-08-06 (specs/resposta-conversacional-v1.md secao 5): horarios virou
// opcional -- um snapshot so com proposta_pendente e valido.
test('leitura: snapshot valido (so proposta_pendente, sem horarios) atravessa intacto', () => {
  const valido = { proposta_pendente: { data: '2026-08-05', horario: '09:00' }, criado_em: '2026-08-05T12:00:00.000Z' };
  assert.deepEqual(validarContextoHorarios(valido), valido);
});

test('leitura: snapshot com os dois campos presentes atravessa intacto', () => {
  const valido = {
    horarios: ['13:00'],
    proposta_pendente: { data: '2026-08-05', horario: '09:00' },
    criado_em: '2026-08-05T12:00:00.000Z',
  };
  assert.deepEqual(validarContextoHorarios(valido), valido);
});

test('leitura: valor malformado vira null em vez de derrubar a identificacao', () => {
  const casos: unknown[] = [
    null,
    undefined,
    'texto',
    42,
    [],
    {},
    { horarios: [], criado_em: 'x' },
    { horarios: ['13:00'] },
    { horarios: [13], criado_em: 'x' },
    { horarios: ['  '], criado_em: 'x' },
    { horarios: ['13:00'], criado_em: 5 },
    // Nenhum dos dois campos -- snapshot sem sentido, nunca vira objeto "vazio".
    { criado_em: '2026-08-05T12:00:00.000Z' },
    // proposta_pendente presente porem malformada -- invalida o snapshot inteiro.
    { proposta_pendente: { data: '2026-08-05' }, criado_em: 'x' },
    { proposta_pendente: { data: '', horario: '09:00' }, criado_em: 'x' },
    { proposta_pendente: 'amanha as 9', criado_em: 'x' },
    { proposta_pendente: null, criado_em: 'x' },
  ];
  for (const caso of casos) {
    assert.equal(validarContextoHorarios(caso), null, `esperava null para ${JSON.stringify(caso)}`);
  }
});

// --- Exaustividade do contrato ---

test('derivacao: toda decisao produz exatamente uma acao conhecida, nunca undefined', () => {
  const decisoes: DecisaoOrquestrador[] = [
    { tipo: 'clinica_sem_catalogo' },
    { tipo: 'saudacao' },
    { tipo: 'duvida_livre' },
    { tipo: 'mensagem_nao_compreendida' },
    { tipo: 'desistencia' },
    { tipo: 'sem_dentista_disponivel' },
    { tipo: 'duracao_nao_configurada' },
    { tipo: 'cadastro_necessario' },
    { tipo: 'reserva_conflito' },
    { tipo: 'aguardando_confirmacao', procedimento_id: 'cleaning', dentista_id: 'dentista-1', opcao: opcao(540) },
  ];
  const tiposValidos = new Set<AcaoContextoHorarios['tipo']>(['substituir', 'propor', 'preservar', 'limpar']);
  for (const decisao of decisoes) {
    assert.ok(tiposValidos.has(derivarAcaoContextoHorarios(decisao).tipo));
  }
});
