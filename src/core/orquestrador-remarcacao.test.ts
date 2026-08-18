// Fluxo de remarcacao (specs/remarcacao-conversacional-v1.md). Arquivo
// separado de orquestrador.test.ts pelo mesmo criterio que ja separou
// orquestrador-troca-telefone.test.ts: a montagem de cenario aqui exige um
// agendamento ativo pre-existente e a segunda RPC
// (cappia_remarcar_agendamento_v2), nunca cappia_reservar_agendamento.
//
// Todos os dados sao SINTETICOS. As frases seguem o registro real de WhatsApp
// (docs/00-principios.md, principio dos testes realistas).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso, type RespostaRpc } from './teste-cliente-rpc-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
// 2026-08-03 = segunda-feira (verificado, mesmo instante de orquestrador.test.ts).
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
        fim: '12:00',
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

/**
 * Semeia `estado_conversa` diretamente com `dados` ja no estado em que o
 * fluxo de remarcacao precisa (mesma tecnica de orquestrador-troca-
 * telefone.test.ts): o teste foca no PASSO em questao, sem reconstruir todos
 * os turnos anteriores.
 */
function semearConversa(
  tabelas: TabelasFalsas,
  clinicaId: string,
  dados: Record<string, string> = {},
  contextoHorarios: Record<string, unknown> | null = null
) {
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados,
    paciente_id: null,
    contexto_horarios: contextoHorarios,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
}

function linhaConversa(tabelas: TabelasFalsas) {
  return tabelas.estado_conversa[0] as unknown as {
    dados: Record<string, string>;
    contexto_horarios: Record<string, unknown> | null;
  };
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

/** Resposta minima da IA: sem alteracoes, natureza 'resposta' -- so avanca o fluxo sobre o `dados` ja semeado. */
function clienteModeloSemAlteracoes(): ClienteModeloFalso {
  return new ClienteModeloFalso([{ natureza_mensagem: 'resposta', alteracoes: {} }]);
}

function clienteModeloIntencaoRemarcacao(): ClienteModeloFalso {
  return new ClienteModeloFalso([
    { natureza_mensagem: 'pedido', alteracoes: { intencao: { acao: 'informar', valor: 'remarcacao' } } },
  ]);
}

function respostaRemarcadoOk(overrides: Record<string, unknown> = {}): RespostaRpc {
  return {
    data: {
      sucesso: true,
      agendamento_id: crypto.randomUUID(),
      agendamento_id_antigo: crypto.randomUUID(),
      dentista_id: crypto.randomUUID(),
      duracao_min: 30,
      data: '2026-08-03',
      horario: '10:00',
      ...overrides,
    },
    error: null,
  };
}

test('paciente sem agendamento ativo: sem_agendamento_para_remarcar, RPC nunca chamada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, {});
  const clienteBanco = new ClienteFalso(tabelas);

  const resultado = await processarMensagem(clienteModeloIntencaoRemarcacao(), clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['preciso remarcar minha consulta'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.deepEqual(resultado.decisao, { tipo: 'sem_agendamento_para_remarcar' });
});

test('paciente nao identificado (paciente_id nulo): sem_agendamento_para_remarcar, sem tentar buscar agendamento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId } = montarCenario(tabelas);
  // Mesmo com agendamento no banco para OUTRO telefone, este paciente (nao
  // cadastrado aqui) nunca deveria enxerga-lo -- paciente_id sera nulo.
  semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: crypto.randomUUID(),
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  semearConversa(tabelas, clinicaId, {});
  const clienteBanco = new ClienteFalso(tabelas);

  const resultado = await processarMensagem(clienteModeloIntencaoRemarcacao(), clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['preciso remarcar minha consulta'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.deepEqual(resultado.decisao, { tipo: 'sem_agendamento_para_remarcar' });
});

test('unico agendamento ativo: segue direto para data/horario, sem perguntar qual', async () => {
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
  // paciente_id so entra em estado_conversa depois de um turno com IA --
  // aqui simulamos que o paciente ja foi identificado, semeando diretamente.
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { intencao: 'remarcacao' },
    paciente_id: pacienteId,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  const clienteBanco = new ClienteFalso(tabelas);

  const resultado = await processarMensagem(
    clienteModeloSemAlteracoes(),
    clienteBanco,
    clienteRpcNuncaChamado(),
    {
      provider: PROVIDER,
      instancia_whatsapp: INSTANCIA,
      telefone_normalizado: TELEFONE,
      mensagens_atuais: ['e pra amanha mesmo'],
      instante_atual: INSTANTE_ATUAL,
    }
  );

  // O QUE ESTE TESTE PROVA: com um unico agendamento ativo, o fluxo o usa
  // DIRETO -- jamais pergunta qual (`aguardando_escolha_agendamento`).
  assert.notEqual(resultado.decisao.tipo, 'aguardando_escolha_agendamento');

  // Sem `data_texto`, a data do AGENDAMENTO ATUAL vira o padrao (2026-08-17):
  // quem remarca ja tem uma data, e perguntar "para qual data?" fazia a Iris
  // ignorar o que ela mesma sabia -- em conversa real isso custou tres turnos,
  // com o paciente repetindo "ja falei, mesmo dia". Por isso o fluxo agora
  // alcanca os horarios em vez de parar em `aguardando_data_horario`.
  assert.equal(resultado.decisao.tipo, 'horarios_disponiveis');
});

test('varios agendamentos ativos: aguardando_escolha_agendamento com a lista', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  const ag1 = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  const ag2 = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-15',
    horario: '09:00',
  });
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { intencao: 'remarcacao' },
    paciente_id: pacienteId,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  const clienteBanco = new ClienteFalso(tabelas);

  const resultado = await processarMensagem(clienteModeloSemAlteracoes(), clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['preciso remarcar'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'aguardando_escolha_agendamento');
  if (resultado.decisao.tipo !== 'aguardando_escolha_agendamento') return;
  const ids = resultado.decisao.agendamentos.map((a) => a.agendamento_id).sort();
  assert.deepEqual(ids, [ag1, ag2].sort());

  // O marcador persistido carrega SO os ids, na ordem em que a busca os
  // devolveu (por data/horario) -- prova o ciclo de vida do contexto.
  const linha = linhaConversa(tabelas);
  assert.deepEqual(linha.contexto_horarios, {
    escolha_agendamento_pendente: { agendamento_ids: [ag1, ag2] },
    criado_em: (linha.contexto_horarios as { criado_em: string }).criado_em,
  });
});

test('agendamento_id valido (dentro da lista oferecida): avanca para o agendamento escolhido', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  const ag1 = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-10',
    horario: '14:00',
  });
  const ag2 = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2026-08-15',
    horario: '09:00',
  });
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    // agendamento_id ja escolhido em turno anterior (validado la); este
    // turno so precisa localizar e seguir.
    dados: { intencao: 'remarcacao', agendamento_id: ag2 },
    paciente_id: pacienteId,
    contexto_horarios: { escolha_agendamento_pendente: { agendamento_ids: [ag1, ag2] }, criado_em: new Date().toISOString() },
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = clienteModeloSemAlteracoes();

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['o segundo'],
    instante_atual: INSTANTE_ATUAL,
  });

  // O QUE ESTE TESTE PROVA: `ag2` foi localizado -- NAO volta a perguntar
  // qual agendamento.
  assert.notEqual(resultado.decisao.tipo, 'aguardando_escolha_agendamento');

  // Sem `data_texto`, a data do agendamento escolhido vira o padrao
  // (2026-08-17), entao o fluxo alcanca os horarios em vez de parar pedindo
  // a data que o Core ja conhece.
  assert.equal(resultado.decisao.tipo, 'horarios_disponiveis');

  // O dia da semana e calculado DETERMINISTICAMENTE pelo Core e entra na
  // descricao enviada a IA (contrato fechado por medicao, 2026-08-11:
  // 10/10 em duas rodadas identicas contra a IA real, contra 4/10 sem o dia
  // da semana). 2026-08-10 e segunda-feira, 2026-08-15 e sabado --
  // verificados. A IA nunca calcula isso -- so casa texto ja pronto.
  const payloadEnviado = clienteModelo.chamadas[0]!.payload;
  assert.deepEqual(payloadEnviado.agendamentos_ativos, [
    { agendamento_id: ag1, descricao: 'Limpeza com Dra. Ana — segunda-feira, 10/08 às 14:00' },
    { agendamento_id: ag2, descricao: 'Limpeza com Dra. Ana — sábado, 15/08 às 09:00' },
  ]);
});

test('confirmacao explicita: chama cappia_remarcar_agendamento_v2 com procedimento/dentista do agendamento localizado, nunca re-resolvidos', async () => {
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
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { intencao: 'remarcacao', data_texto: 'hoje', horario_texto: '10:00', confirmacao: 'sim' },
    paciente_id: pacienteId,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteRpc = new ClienteRpcFalso({
    cappia_remarcar_agendamento_v2: respostaRemarcadoOk({ dentista_id: dentistaId, data: '2026-08-03', horario: '10:00' }),
  });

  const resultado = await processarMensagem(clienteModeloSemAlteracoes(), clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['isso, pode mudar'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'remarcacao_criada');
  assert.equal(clienteRpc.chamadas.length, 1);
  assert.deepEqual(clienteRpc.chamadas[0]!.parametros, {
    p_clinica_id: clinicaId,
    p_paciente_id: pacienteId,
    p_agendamento_id: agendamentoId,
    p_dentista_id: dentistaId,
    p_procedimento_id: procedimentoId,
    p_duracao_min: 30,
    p_nova_data: '2026-08-03',
    p_novo_horario: '10:00',
  });
});

test('sem confirmacao ainda: aguardando_confirmacao_remarcacao com o agendamento atual e a opcao nova, RPC nunca chamada', async () => {
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
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { intencao: 'remarcacao', data_texto: 'hoje', horario_texto: '10:00' },
    paciente_id: pacienteId,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  const clienteBanco = new ClienteFalso(tabelas);

  const resultado = await processarMensagem(clienteModeloSemAlteracoes(), clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['pode ser as 10 entao'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao_remarcacao');
  if (resultado.decisao.tipo !== 'aguardando_confirmacao_remarcacao') return;
  assert.equal(resultado.decisao.agendamento_atual.data, '2026-08-10');
  assert.equal(resultado.decisao.agendamento_atual.horario, '14:00');
  assert.equal(resultado.decisao.procedimento_id, procedimentoId);
  assert.equal(resultado.decisao.dentista_id, dentistaId);
});

test('horario_ocupado: reserva_conflito (reutilizada), agendamento antigo permanece intacto no fluxo, intencao preservada', async () => {
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
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { intencao: 'remarcacao', data_texto: 'hoje', horario_texto: '10:00', confirmacao: 'sim' },
    paciente_id: pacienteId,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteRpc = new ClienteRpcFalso({
    cappia_remarcar_agendamento_v2: { data: { sucesso: false, motivo: 'horario_ocupado' }, error: null } satisfies RespostaRpc,
  });

  const resultado = await processarMensagem(clienteModeloSemAlteracoes(), clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['isso, confirma'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.deepEqual(resultado.decisao, { tipo: 'reserva_conflito' });
  // intencao PRESERVADA: nunca limpa em conflito -- so em sucesso ou desistencia.
  const linha = linhaConversa(tabelas);
  assert.equal(linha.dados.intencao, 'remarcacao');
});

test('falha tecnica (motivo != horario_ocupado): reserva_falhou (reutilizada)', async () => {
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
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { intencao: 'remarcacao', data_texto: 'hoje', horario_texto: '10:00', confirmacao: 'sim' },
    paciente_id: pacienteId,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteRpc = new ClienteRpcFalso({
    cappia_remarcar_agendamento_v2: {
      data: { sucesso: false, motivo: 'agendamento_nao_encontrado' },
      error: null,
    } satisfies RespostaRpc,
  });

  const resultado = await processarMensagem(clienteModeloSemAlteracoes(), clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['isso, confirma'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.deepEqual(resultado.decisao, { tipo: 'reserva_falhou', motivo: 'agendamento_nao_encontrado' });
});

test('sucesso: intencao e agendamento_id sao removidos de dados apos remarcacao_criada', async () => {
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
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {
      intencao: 'remarcacao',
      agendamento_id: agendamentoId,
      data_texto: 'hoje',
      horario_texto: '10:00',
      confirmacao: 'sim',
    },
    paciente_id: pacienteId,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteRpc = new ClienteRpcFalso({
    cappia_remarcar_agendamento_v2: respostaRemarcadoOk(),
  });

  const resultado = await processarMensagem(clienteModeloSemAlteracoes(), clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['isso, confirma'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'remarcacao_criada');
  const linha = linhaConversa(tabelas);
  assert.equal('intencao' in linha.dados, false, 'intencao deveria ter sido removida apos o sucesso');
  assert.equal('agendamento_id' in linha.dados, false, 'agendamento_id deveria ter sido removido apos o sucesso');
});

test('desistencia DENTRO da remarcacao (negacao, sem outro conteudo): intencao removida', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId } = montarCenario(tabelas);
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { intencao: 'remarcacao' },
    paciente_id: null,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'negacao', alteracoes: {} }]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['deixa quieto, desisti'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.deepEqual(resultado.decisao, { tipo: 'desistencia' });
  const linha = linhaConversa(tabelas);
  assert.equal('intencao' in linha.dados, false, 'intencao deveria ter sido removida apos a desistencia');
});

test('desistencia FORA da remarcacao (intencao ausente): dados nunca e tocado pela limpeza extra', async () => {
  const tabelas = criarTabelasFalsasVazias();
  // Clinica sem paciente casando este telefone, de proposito: isola o teste
  // do backfill de `paciente_id` que identificacao.ts ja faz por conta
  // propria (um UPDATE preexistente, sem relacao com a limpeza de
  // remarcacao) -- este teste so quer provar que aplicarDados NAO e chamado
  // uma segunda vez para remover intencao/agendamento_id fora do fluxo.
  const clinicaId = crypto.randomUUID();
  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [],
  });
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: null,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'negacao', alteracoes: {} }]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['deixa quieto'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.deepEqual(resultado.decisao, { tipo: 'desistencia' });
  // Exatamente UM update: o de contexto_horarios, feito por
  // gravarContextoHorarios. Sem paciente casando o telefone, nenhum outro
  // UPDATE preexistente (backfill de paciente_id) entra na contagem -- entao
  // "exatamente 1" prova que a limpeza extra de dados nunca disparou.
  assert.equal(clienteBanco.estatisticas.chamadasUpdate.estado_conversa, 1);
});

test('confirmacao remanescente de outro fluxo e limpa ao ENTRAR em remarcacao nesta mensagem', async () => {
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
  // `confirmacao: 'sim'` remanescente de um agendamento concluido antes
  // NESTA MESMA conversa -- intencao ainda nao era 'remarcacao'.
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { confirmacao: 'sim' },
    paciente_id: pacienteId,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  const clienteBanco = new ClienteFalso(tabelas);
  // Esta mensagem ENTRA em remarcacao agora, e ja traz data/horario --
  // se `confirmacao` sobrevivesse, isso executaria a RPC sem ninguem ter
  // confirmado a NOVA proposta.
  const clienteModelo = new ClienteModeloFalso([
    {
      natureza_mensagem: 'pedido',
      alteracoes: {
        intencao: { acao: 'informar', valor: 'remarcacao' },
        data_texto: { acao: 'informar', valor: 'hoje' },
        horario_texto: { acao: 'informar', valor: '10:00' },
      },
    },
  ]);
  const clienteRpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['preciso remarcar pra hoje as 10'],
    instante_atual: INSTANTE_ATUAL,
  });

  // NUNCA remarcacao_criada nem chamada a RPC -- confirmacao foi limpa ao
  // entrar, entao o fluxo para em aguardando_confirmacao_remarcacao.
  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao_remarcacao');
  assert.equal(clienteRpc.chamadas.length, 0);
  const linha = linhaConversa(tabelas);
  assert.equal('confirmacao' in linha.dados, false);
});

test('paciente com consulta marcada pede um SEGUNDO procedimento (sem intencao=remarcacao): segue fluxo normal de novo agendamento, nunca remarcacao', async () => {
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
  const clienteBanco = new ClienteFalso(tabelas);
  // A IA NAO emite intencao=remarcacao aqui -- e um pedido de procedimento
  // novo, e ela so emite remarcacao quando a mensagem pede MUDAR o que ja
  // existe (interpretacao-instrucoes.ts).
  const clienteModelo = new ClienteModeloFalso([
    { natureza_mensagem: 'pedido', alteracoes: { procedimento_id: { acao: 'informar', valor: procedimentoId } } },
  ]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar uma limpeza tambem'],
    instante_atual: INSTANTE_ATUAL,
  });

  // Segue o fluxo NORMAL (novo agendamento): aguardando_data_horario, nunca
  // nenhuma decisao de remarcacao.
  assert.equal(resultado.decisao.tipo, 'aguardando_data_horario');
});
