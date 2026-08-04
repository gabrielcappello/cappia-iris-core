import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import type { CatalogoClinica } from './orquestrador-tipos.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso, type RespostaRpc } from './teste-cliente-rpc-falso.ts';

// Dublê sem nenhuma resposta configurada: usado em todos os testes que nao
// deveriam chegar a reservar -- se `cappia_reservar_agendamento` for chamada
// por engano, o proprio dublê lanca erro, provando o isolamento.
function clienteRpcNuncaChamado(): ClienteRpcFalso {
  return new ClienteRpcFalso({});
}

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';

// 2026-08-03 = segunda-feira (verificado); usado como "hoje" nos testes que
// chegam ate a disponibilidade.
const INSTANTE_ATUAL = { data: '2026-08-03', minuto_min: 480 };

function semearClinica(tabelas: TabelasFalsas, dentistas: Record<string, unknown>[] = []): string {
  const clinicaId = crypto.randomUUID();
  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas,
  });
  return clinicaId;
}

// identificarConversa so cria a linha (upsert) quando nenhuma existe ainda;
// o dublê de banco nao simula default de coluna, entao semeamos aqui com
// atualizado_em ja preenchido -- mesmo padrao de interpretar-e-aplicar.test.ts.
function semearConversa(tabelas: TabelasFalsas, clinicaId: string) {
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
}

function semearPaciente(tabelas: TabelasFalsas, clinicaId: string): string {
  const pacienteId = crypto.randomUUID();
  tabelas.pacientes.push({ id: pacienteId, clinica_id: clinicaId, telefone_normalizado: TELEFONE });
  return pacienteId;
}

function catalogoBase(clinicaId: string): CatalogoClinica {
  return { procedimentos: [], aliasesProcedimento: [], dentistas: [], vinculos: [], configuracoesDuracao: [] };
}

test('procedimento nao resolvido: orquestrador para em aguardando_procedimento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  semearConversa(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ alteracoes: {} }]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['oi'],
    catalogo: catalogoBase(clinicaId),
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.clinica_id, clinicaId);
  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
  if (resultado.decisao.tipo === 'aguardando_procedimento') {
    assert.deepEqual(resultado.decisao.resultado, { tipo: 'nao_resolvido', motivo: 'texto_ausente' });
  }
});

test('procedimento + dentista unico apto + duracao configurada, sem data: aguardando_data_horario', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  semearConversa(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    { alteracoes: { procedimento_texto: { acao: 'informar', valor: 'limpeza' } } },
  ]);

  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const catalogo: CatalogoClinica = {
    procedimentos: [
      { procedimento_id: procedimentoId, clinica_id: clinicaId, nome_pt: 'Limpeza', ativo: true, eh_consulta_avaliacao: false },
    ],
    aliasesProcedimento: [{ clinica_id: clinicaId, procedimento_id: procedimentoId, texto: 'limpeza', ativo: true }],
    dentistas: [
      {
        dentista_id: dentistaId,
        clinica_id: clinicaId,
        nome_exibido: 'Dra. Ana',
        nome_completo_resolucao: 'Ana Souza',
        nome_curto_resolucao: 'Ana',
        ativo: true,
      },
    ],
    vinculos: [{ clinica_id: clinicaId, dentista_id: dentistaId, procedimento_id: procedimentoId, ativo: true }],
    configuracoesDuracao: [{ clinica_id: clinicaId, procedimento_id: procedimentoId, duracao_min: 30 }],
  };

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar uma limpeza'],
    catalogo,
    instante_atual: INSTANTE_ATUAL,
  });

  // procedimento/dentista/duracao resolvidos, mas nenhum data_texto/periodo/
  // horario_texto informado -> fatos_temporais vazio -> resolverTemporal
  // (nao alterado) devolve incompleto/intencao_ausente pelo caminho ja
  // existente, nunca um horario inventado.
  assert.deepEqual(resultado.decisao, {
    tipo: 'aguardando_data_horario',
    resultado: { tipo: 'incompleto', motivo: 'intencao_ausente' },
  });
});

test('fluxo completo ate horario real: procedimento -> dentista -> duracao -> "hoje" -> horarios_disponiveis', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const clinicaId = semearClinica(tabelas, [
    {
      id: dentistaId,
      ativo: true,
      modo: 'auto',
      inicio: '08:00',
      fim: '12:00',
      dur: 30,
      sabado: false,
      alm_ini: null,
      alm_fim: null,
      procedimentos: [],
    },
  ]);
  semearConversa(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    {
      alteracoes: {
        procedimento_texto: { acao: 'informar', valor: 'limpeza' },
        data_texto: { acao: 'informar', valor: 'hoje' },
        periodo: { acao: 'informar', valor: 'manha' },
      },
    },
  ]);

  const catalogo: CatalogoClinica = {
    procedimentos: [
      { procedimento_id: procedimentoId, clinica_id: clinicaId, nome_pt: 'Limpeza', ativo: true, eh_consulta_avaliacao: false },
    ],
    aliasesProcedimento: [{ clinica_id: clinicaId, procedimento_id: procedimentoId, texto: 'limpeza', ativo: true }],
    dentistas: [
      {
        dentista_id: dentistaId,
        clinica_id: clinicaId,
        nome_exibido: 'Dra. Ana',
        nome_completo_resolucao: 'Ana Souza',
        nome_curto_resolucao: 'Ana',
        ativo: true,
      },
    ],
    vinculos: [{ clinica_id: clinicaId, dentista_id: dentistaId, procedimento_id: procedimentoId, ativo: true }],
    configuracoesDuracao: [{ clinica_id: clinicaId, procedimento_id: procedimentoId, duracao_min: 30 }],
  };

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar uma limpeza hoje de manha'],
    catalogo,
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'horarios_disponiveis');
  if (resultado.decisao.tipo !== 'horarios_disponiveis') return;
  assert.equal(resultado.decisao.procedimento_id, procedimentoId);
  assert.equal(resultado.decisao.dentista_id, dentistaId);
  assert.equal(resultado.decisao.duracao_min, 30);
  assert.equal(resultado.decisao.resultado.tipo, 'opcoes');
  if (resultado.decisao.resultado.tipo === 'opcoes') {
    assert.ok(resultado.decisao.resultado.opcoes.length > 0, 'jornada 08:00-12:00 as 08:00 deve ter horarios livres');
  }
});

test('alias ambiguo no catalogo: erro_catalogo_procedimento, nunca aguardando_procedimento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  semearConversa(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    { alteracoes: { procedimento_texto: { acao: 'informar', valor: 'limpeza' } } },
  ]);

  const procedimentoId1 = crypto.randomUUID();
  const procedimentoId2 = crypto.randomUUID();
  const catalogo: CatalogoClinica = {
    procedimentos: [
      { procedimento_id: procedimentoId1, clinica_id: clinicaId, nome_pt: 'Limpeza', ativo: true, eh_consulta_avaliacao: false },
      { procedimento_id: procedimentoId2, clinica_id: clinicaId, nome_pt: 'Limpeza 2', ativo: true, eh_consulta_avaliacao: false },
    ],
    // mesmo texto normalizado apontando para dois procedimento_id distintos.
    aliasesProcedimento: [
      { clinica_id: clinicaId, procedimento_id: procedimentoId1, texto: 'limpeza', ativo: true },
      { clinica_id: clinicaId, procedimento_id: procedimentoId2, texto: 'limpeza', ativo: true },
    ],
    dentistas: [],
    vinculos: [],
    configuracoesDuracao: [],
  };

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar uma limpeza'],
    catalogo,
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'erro_catalogo_procedimento');
  if (resultado.decisao.tipo === 'erro_catalogo_procedimento') {
    assert.equal(resultado.decisao.resultado.tipo, 'erro_catalogo');
  }
});

test('dois dentistas aptos, sem preferencia: aguardando_escolha_dentista', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  semearConversa(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    { alteracoes: { procedimento_texto: { acao: 'informar', valor: 'limpeza' } } },
  ]);

  const procedimentoId = crypto.randomUUID();
  const dentista1 = crypto.randomUUID();
  const dentista2 = crypto.randomUUID();
  const catalogo: CatalogoClinica = {
    procedimentos: [
      { procedimento_id: procedimentoId, clinica_id: clinicaId, nome_pt: 'Limpeza', ativo: true, eh_consulta_avaliacao: false },
    ],
    aliasesProcedimento: [{ clinica_id: clinicaId, procedimento_id: procedimentoId, texto: 'limpeza', ativo: true }],
    dentistas: [
      {
        dentista_id: dentista1,
        clinica_id: clinicaId,
        nome_exibido: 'Dra. Ana',
        nome_completo_resolucao: 'Ana Souza',
        nome_curto_resolucao: 'Ana',
        ativo: true,
      },
      {
        dentista_id: dentista2,
        clinica_id: clinicaId,
        nome_exibido: 'Dr. Bruno',
        nome_completo_resolucao: 'Bruno Lima',
        nome_curto_resolucao: 'Bruno',
        ativo: true,
      },
    ],
    vinculos: [
      { clinica_id: clinicaId, dentista_id: dentista1, procedimento_id: procedimentoId, ativo: true },
      { clinica_id: clinicaId, dentista_id: dentista2, procedimento_id: procedimentoId, ativo: true },
    ],
    configuracoesDuracao: [{ clinica_id: clinicaId, procedimento_id: procedimentoId, duracao_min: 30 }],
  };

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar uma limpeza'],
    catalogo,
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'aguardando_escolha_dentista');
  if (resultado.decisao.tipo === 'aguardando_escolha_dentista') {
    const ids = resultado.decisao.dentistas.map((d) => d.dentista_id).sort();
    assert.deepEqual(ids, [dentista1, dentista2].sort());
  }
});

// --- Escolha de horario + confirmacao explicita + reserva ---

function montarCenarioReserva(tabelas: TabelasFalsas) {
  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const clinicaId = semearClinica(tabelas, [
    {
      id: dentistaId,
      ativo: true,
      modo: 'auto',
      inicio: '08:00',
      fim: '12:00',
      dur: 30,
      sabado: false,
      alm_ini: null,
      alm_fim: null,
      procedimentos: [],
    },
  ]);
  semearConversa(tabelas, clinicaId);

  const catalogo: CatalogoClinica = {
    procedimentos: [
      { procedimento_id: procedimentoId, clinica_id: clinicaId, nome_pt: 'Limpeza', ativo: true, eh_consulta_avaliacao: false },
    ],
    aliasesProcedimento: [{ clinica_id: clinicaId, procedimento_id: procedimentoId, texto: 'limpeza', ativo: true }],
    dentistas: [
      {
        dentista_id: dentistaId,
        clinica_id: clinicaId,
        nome_exibido: 'Dra. Ana',
        nome_completo_resolucao: 'Ana Souza',
        nome_curto_resolucao: 'Ana',
        ativo: true,
      },
    ],
    vinculos: [{ clinica_id: clinicaId, dentista_id: dentistaId, procedimento_id: procedimentoId, ativo: true }],
    configuracoesDuracao: [{ clinica_id: clinicaId, procedimento_id: procedimentoId, duracao_min: 30 }],
  };

  return { clinicaId, procedimentoId, dentistaId, catalogo };
}

function clienteModeloEscolha(confirmacao?: string) {
  const alteracoes: Record<string, { acao: string; valor: string }> = {
    procedimento_texto: { acao: 'informar', valor: 'limpeza' },
    data_texto: { acao: 'informar', valor: 'hoje' },
    horario_texto: { acao: 'informar', valor: '10:00' },
  };
  if (confirmacao !== undefined) alteracoes.confirmacao = { acao: 'informar', valor: confirmacao };
  return new ClienteModeloFalso([{ alteracoes }]);
}

test('paciente escolhe horario livre, sem confirmar: aguardando_confirmacao, nunca reserva', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, catalogo } = montarCenarioReserva(tabelas);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteRpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(clienteModeloEscolha(), clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar limpeza hoje as 10:00'],
    catalogo,
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao');
  if (resultado.decisao.tipo !== 'aguardando_confirmacao') return;
  assert.equal(resultado.decisao.procedimento_id, procedimentoId);
  assert.equal(resultado.decisao.dentista_id, dentistaId);
  assert.equal(resultado.decisao.opcao.inicio_min, 600);
  assert.equal(clienteRpc.chamadas.length, 0, 'nunca reserva sem confirmacao explicita');
});

test('confirmado mas paciente nao cadastrado: cadastro_necessario, nunca reserva', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { catalogo } = montarCenarioReserva(tabelas);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteRpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(clienteModeloEscolha('sim'), clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['sim, confirmo'],
    catalogo,
    instante_atual: INSTANTE_ATUAL,
  });

  assert.deepEqual(resultado.decisao, { tipo: 'cadastro_necessario' });
  assert.equal(clienteRpc.chamadas.length, 0);
});

test('escolha + confirmacao + paciente cadastrado: reserva_criada, chamando cappia_reservar_agendamento com os ids ja resolvidos', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, catalogo } = montarCenarioReserva(tabelas);
  const pacienteId = semearPaciente(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const agendamentoId = crypto.randomUUID();
  const clienteRpc = new ClienteRpcFalso({
    cappia_reservar_agendamento: {
      data: {
        sucesso: true,
        agendamento_id: agendamentoId,
        dentista_id: dentistaId,
        duracao_min: 30,
        data: '2026-08-03',
        horario: '10:00',
      },
      error: null,
    } satisfies RespostaRpc,
  });

  const resultado = await processarMensagem(clienteModeloEscolha('sim'), clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['sim, confirmo'],
    catalogo,
    instante_atual: INSTANTE_ATUAL,
  });

  assert.deepEqual(resultado.decisao, {
    tipo: 'reserva_criada',
    agendamento_id: agendamentoId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    duracao_min: 30,
    data: '2026-08-03',
    horario: '10:00',
  });
  assert.equal(clienteRpc.chamadas.length, 1);
  assert.deepEqual(clienteRpc.chamadas[0].parametros, {
    p_clinica_id: clinicaId,
    p_data: '2026-08-03',
    p_horario: '10:00',
    p_procedimento_id: procedimentoId,
    p_paciente_id: pacienteId,
    p_dentista_id: dentistaId,
    p_telefone: TELEFONE,
  });
});

test('RPC recusa por sobreposicao real (corrida): reserva_conflito, nunca insiste sozinho', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, catalogo } = montarCenarioReserva(tabelas);
  semearPaciente(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteRpc = new ClienteRpcFalso({
    cappia_reservar_agendamento: { data: { sucesso: false, motivo: 'horario_ocupado' }, error: null } satisfies RespostaRpc,
  });

  const resultado = await processarMensagem(clienteModeloEscolha('sim'), clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['sim, confirmo'],
    catalogo,
    instante_atual: INSTANTE_ATUAL,
  });

  assert.deepEqual(resultado.decisao, { tipo: 'reserva_conflito' });
  assert.equal(clienteRpc.chamadas.length, 1, 'chamou a RPC exatamente uma vez, nunca reinsiste sozinho');
});
