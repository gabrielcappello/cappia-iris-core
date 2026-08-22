// Consulta do proprio agendamento (specs/consulta-agendamento-conversacional-v1.md).
// Arquivo separado pelo mesmo criterio dos demais fluxos: a montagem exige um
// agendamento ativo pre-existente e o foco e o FATO DO TURNO, nunca uma
// decisao nova -- esta spec nao cria nenhuma.
//
// Todos os dados sao SINTETICOS. As frases seguem o registro real de WhatsApp
// e as medicoes contra a IA real (docs/00-principios.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { derivarFatosAutorizados } from './fatos-autorizados.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso, type RespostaRpc } from './teste-cliente-rpc-falso.ts';

// `HOJE` deliberadamente distante das datas dos casos: a relacao fica
// 'outra' e a data sai absoluta, como sempre saiu. Os casos hoje/amanha tem
// testes proprios em fatos-autorizados.test.ts.
const HOJE = '2026-01-01';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
// 2026-08-03 = segunda-feira (verificado, mesmo instante dos demais testes).
const INSTANTE_ATUAL = { data: '2026-08-03', minuto_min: 480 };

function clienteRpcNuncaChamado(): ClienteRpcFalso {
  return new ClienteRpcFalso({});
}

function montarCenario(tabelas: TabelasFalsas) {
  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const clinicaId = crypto.randomUUID();
  const pacienteId = crypto.randomUUID();

  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [
      {
        id: dentistaId,
        nome: 'Ana',
        titulo: 'Dra.',
        ativo: true,
        modo: 'auto',
        dur: 30,
        inicio: '08:00',
        fim: '18:00',
        sabado: false,
        alm_ini: null,
        alm_fim: null,
        procedimentos: [{ id: procedimentoId, nome: 'Limpeza', ativo: true, tempo: 999 }],
      },
    ],
  });
  tabelas.pacientes.push({
    id: pacienteId,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    nome: 'Marilda Sinval Quadros',
    documento: '52998224725',
    data_nascimento: '1979-06-23',
  });
  tabelas.procedimentos_catalogo.push({
    id: procedimentoId,
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

  return { clinicaId, procedimentoId, dentistaId, pacienteId };
}

function semearConversa(
  tabelas: TabelasFalsas,
  clinicaId: string,
  dados: Record<string, string> = {},
  contextoHorarios: Record<string, unknown> | null = null,
  pacienteId: string | null = null
) {
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados,
    paciente_id: pacienteId,
    contexto_horarios: contextoHorarios,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
}

function semearAgendamentoAtivo(
  tabelas: TabelasFalsas,
  overrides: {
    clinica_id: string;
    paciente_id: string;
    dentista_id: string;
    procedimento_id: string;
    data: string;
    horario: string;
  }
) {
  const id = crypto.randomUUID();
  tabelas.agendamentos.push({
    id,
    status: 'confirmado',
    dentista_nome: 'Dra. Ana',
    procedimento: 'Limpeza',
    ...overrides,
  });
  return id;
}

function entrada(mensagem: string) {
  return {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: [mensagem],
    instante_atual: INSTANTE_ATUAL,
  };
}

/** Saudacao pura -- `natureza=saudacao`, sem alteracoes. */
function clienteModeloSaudacao(): ClienteModeloFalso {
  return new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]);
}

/** Duvida -- vira `duvida_livre` quando nao ha procedimento na conversa. */
function clienteModeloDuvida(): ClienteModeloFalso {
  return new ClienteModeloFalso([{ natureza_mensagem: 'duvida', alteracoes: {} }]);
}

// --- Caminho principal (spec secao 9, testes 1-5) ---

test('1. saudacao com 1 agendamento futuro: fato presente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  const agendamentoId = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, {}, null, pacienteId);

  const resultado = await processarMensagem(
    clienteModeloSaudacao(),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('oi')
  );

  assert.equal(resultado.decisao.tipo, 'saudacao');
  assert.equal(resultado.agendamentos_do_paciente?.length, 1);
  assert.equal(resultado.agendamentos_do_paciente?.[0]?.agendamento_id, agendamentoId);
});

test('2. duvida sobre o agendamento: fato presente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, {}, null, pacienteId);

  const resultado = await processarMensagem(
    clienteModeloDuvida(),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('quando é minha consulta?')
  );

  assert.equal(resultado.decisao.tipo, 'duvida_livre');
  assert.equal(resultado.agendamentos_do_paciente?.length, 1);
});

test('3. paciente SEM agendamento futuro: campo AUSENTE, nunca []', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, {}, null, pacienteId);

  const resultado = await processarMensagem(
    clienteModeloSaudacao(),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('oi')
  );

  assert.equal(resultado.decisao.tipo, 'saudacao');
  assert.ok(!('agendamentos_do_paciente' in resultado));
});

test('4. paciente SEM ficha: campo ausente e NENHUMA consulta a agendamentos', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId } = montarCenario(tabelas);
  // Agendamento de OUTRO paciente existe -- nunca deve ser alcancado.
  semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: crypto.randomUUID(),
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });

  // Telefone SEM linha em `pacientes` -- e a tabela `pacientes` (por telefone)
  // que define `identificacao.paciente.id`, nunca `estado_conversa.paciente_id`.
  const TELEFONE_SEM_FICHA = '5511900000009';
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE_SEM_FICHA,
    estado: 'atendimento',
    dados: {},
    paciente_id: null,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  const clienteBanco = new ClienteFalso(tabelas);

  const resultado = await processarMensagem(clienteModeloSaudacao(), clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE_SEM_FICHA,
    mensagens_atuais: ['oi'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.ok(!('agendamentos_do_paciente' in resultado));
  assert.equal(clienteBanco.estatisticas.chamadasSelect.agendamentos ?? 0, 0);
});

test('5. multiplos agendamentos: TODOS, na ordem da busca, sem pergunta de escolha', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  // Semeados FORA de ordem de propósito -- a ordenacao e da busca, por data
  // e depois por minuto.
  const ag2 = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-15',
    horario: '09:00',
  });
  const ag1 = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, {}, null, pacienteId);

  const resultado = await processarMensagem(
    clienteModeloDuvida(),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('tenho horário marcado?')
  );

  assert.deepEqual(
    resultado.agendamentos_do_paciente?.map((a) => a.agendamento_id),
    [ag1, ag2]
  );
  // Consultar e LEITURA -- nunca vira pergunta de escolha.
  assert.equal(resultado.decisao.tipo, 'duvida_livre');
});

// --- Isolamento (spec secao 9, testes 6-8) ---

test('6. PAR A/B: a MESMA mensagem so traz o fato quando existe agendamento futuro', async () => {
  async function rodar(comAgendamento: boolean) {
    const tabelas = criarTabelasFalsasVazias();
    const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
    if (comAgendamento) {
      semearAgendamentoAtivo(tabelas, {
        clinica_id: clinicaId,
        paciente_id: pacienteId,
        dentista_id: dentistaId,
        procedimento_id: procedimentoId,
        data: '2026-08-10',
        horario: '14:00',
      });
    }
    semearConversa(tabelas, clinicaId, {}, null, pacienteId);
    return await processarMensagem(
      clienteModeloSaudacao(),
      new ClienteFalso(tabelas),
      clienteRpcNuncaChamado(),
      entrada('bom dia')
    );
  }

  const com = await rodar(true);
  const sem = await rodar(false);

  assert.equal(com.agendamentos_do_paciente?.length, 1);
  assert.ok(!('agendamentos_do_paciente' in sem));
  // A decisao e a MESMA nos dois lados -- o fato nao altera o fluxo.
  assert.equal(com.decisao.tipo, sem.decisao.tipo);
});

test('7. desistencia NUNCA recebe o fato, embora venha da mesma decidirPorNatureza', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, {}, null, pacienteId);

  const resultado = await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'negacao', alteracoes: {} }]),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('deixa pra lá')
  );

  assert.equal(resultado.decisao.tipo, 'desistencia');
  // O paciente esta encerrando -- mencionar o agendamento reabriria assunto.
  assert.ok(!('agendamentos_do_paciente' in resultado));
});

test('7b. decisao OPERACIONAL TAMBEM recebe o fato (2026-08-14)', async () => {
  // Ate 2026-08-13 este fato so chegava em 3 das 30 decisoes, e a Iris
  // respondia sem saber que o paciente tem consulta marcada. Medido em
  // producao: logo apos agendar, "qual o nome do dentista?" foi respondido
  // com "nao tenho essa informacao" -- o dado estava no banco o tempo todo.
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, {}, null, pacienteId);

  // `pedido` sem alteracoes -> cai no caminho OPERACIONAL (`decidir`), nunca
  // no early-return conversacional.
  const resultado = await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('e o meu horario?')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
  assert.equal(resultado.agendamentos_do_paciente?.length, 1);
  assert.equal(resultado.agendamentos_do_paciente?.[0]?.dentista_nome, 'Dra. Ana');
});

test('8. a busca acontece DEPOIS da decisao -- inclui o agendamento criado no proprio turno', async () => {
  // Motivo de a busca viver em `finalizar`, e nao antes: lida antes, ela
  // contradiria o desfecho do turno. Era a objecao registrada na spec
  // original, e e o que permite entregar o fato em todos os desfechos.
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, {}, null, pacienteId);
  const clienteBanco = new ClienteFalso(tabelas);

  await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]),
    clienteBanco,
    clienteRpcNuncaChamado(),
    entrada('oi')
  );

  // UMA consulta de agendamento ATIVO por turno -- nunca uma por consumidor
  // (a busca da interpretadora e reaproveitada aqui, por `finalizar`).
  //
  // A SEGUNDA chamada e de `verificarPacienteNovo`
  // (specs/recomendacao-avaliacao-paciente-novo-v1.md), consulta DIFERENTE
  // e deliberada: filtra `status='concluido'` (historico), nunca
  // `'confirmado'` (agendamento ativo) -- escopos distintos que a busca de
  // agendamento ativo nao cobre, entao nao ha o que reaproveitar. So roda
  // nas 4 decisoes elegiveis (saudacao/duvida_livre/mensagem_nao_
  // compreendida/aguardando_procedimento), nunca nos fluxos operacionais de
  // reserva/remarcacao/cancelamento.
  assert.equal(clienteBanco.estatisticas.chamadasSelect.agendamentos, 2);
});

test('fato entregue a redatora e texto pronto, com dia da semana calculado pelo Core', () => {
  const fatos = derivarFatosAutorizados({ tipo: 'saudacao' }, HOJE, undefined, [
    {
      agendamento_id: crypto.randomUUID(),
      data: '2026-08-10', // 2026-08-10 = segunda-feira (verificado)
      horario: '14:00',
      dentista_id: crypto.randomUUID(),
      dentista_nome: 'Dra. Ana',
      procedimento_id: crypto.randomUUID(),
      procedimento: 'Limpeza',
    },
  ]);

  assert.deepEqual(fatos.agendamentos_do_paciente, ['Limpeza com Dra. Ana — segunda-feira, 10/08 às 14:00']);
  // O objetivo NUNCA muda por causa do fato.
  assert.equal(fatos.objetivo, 'cumprimentar_e_oferecer_ajuda');
});

test('fato degrada com campos nulaveis, nunca exibe null', () => {
  const fatos = derivarFatosAutorizados({ tipo: 'duvida_livre' }, HOJE, undefined, [
    {
      agendamento_id: crypto.randomUUID(),
      data: '2026-08-15', // sabado
      horario: '09:00',
      dentista_id: null,
      dentista_nome: null,
      procedimento_id: null,
      procedimento: null,
    },
  ]);

  assert.deepEqual(fatos.agendamentos_do_paciente, ['atendimento — sábado, 15/08 às 09:00']);
  assert.equal(fatos.objetivo, 'acolher_e_retomar');
});

test('lista vazia nunca vira campo -- ausente, nunca []', () => {
  const fatos = derivarFatosAutorizados({ tipo: 'saudacao' }, HOJE, undefined, []);
  assert.ok(!('agendamentos_do_paciente' in fatos));
});
