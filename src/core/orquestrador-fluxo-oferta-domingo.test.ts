// Fluxo COMPLETO da conversa real de 2026-08-30 (Luna), com banco e RPC
// falsos: oferta -> aceitacao -> escolha de dentista -> domingo.
//
// Existe porque os testes anteriores provam PEDACOS: `contexto-horarios.test.ts`
// prova a gravacao, `orquestrador-oferta-avaliacao-persistida.test.ts` prova a
// ligacao orquestrador->estado. Nenhum deles prova que a conversa INTEIRA
// chega ao fim sem repetir pergunta e sem inventar disponibilidade.
//
// O instante e domingo 30/08/2026 de proposito: o desfecho correto e a regra
// determinstica que JA existe (carregar-disponibilidade.ts: diaSemana === 6 ->
// sem_expediente_no_dia/domingo), alcancada pelo fluxo -- nunca uma regra nova.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
const ID_AVALIACAO = 'consultation_evaluation';

// DOMINGO. `diaDaSemanaLocal('2026-08-30') === 6` -- a regra de domingo do
// carregador e o desfecho esperado do ultimo turno.
const DOMINGO = { data: '2026-08-30', minuto_min: 600 };

/** Dois dentistas aptos: escolher "diego perez" tem que ser uma escolha real. */
function montarCenario(tabelas: TabelasFalsas) {
  const clinicaId = crypto.randomUUID();
  const idPerez = crypto.randomUUID();
  const idRamoz = crypto.randomUUID();
  const pacienteId = crypto.randomUUID();

  const procedimentos = [{ id: ID_AVALIACAO, nome: 'Consulta / Avaliação', ativo: true, tempo: 30 }];
  const base = {
    ativo: true,
    modo: 'auto' as const,
    dur: 30,
    inicio: '08:00',
    fim: '18:00',
    sabado: false,
    alm_ini: null,
    alm_fim: null,
    procedimentos,
  };

  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [
      { id: idPerez, nome: 'Perez', titulo: 'Dr.', ...base },
      { id: idRamoz, nome: 'Ramoz', titulo: 'Dr.', ...base },
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
    id: ID_AVALIACAO,
    nome_pt: 'Consulta / Avaliação',
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

  return { clinicaId, pacienteId, idPerez, idRamoz };
}

function entrada(mensagem: string) {
  return {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: [mensagem],
    instante_atual: DOMINGO,
  };
}

function conversa(tabelas: TabelasFalsas) {
  const linha = tabelas.estado_conversa.find((c) => c.telefone_normalizado === TELEFONE);
  assert.ok(linha !== undefined);
  return linha as { dados: Record<string, unknown>; contexto_horarios: Record<string, unknown> | null };
}

test('FLUXO REAL: oferta -> "ok pode ser" -> "diego perez" -> domingo, sem repetir pergunta', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { idPerez } = montarCenario(tabelas);
  const banco = new ClienteFalso(tabelas);
  const rpc = new ClienteRpcFalso({});

  // --- Turno 1: pede horario para hoje, sem dizer o procedimento -----------
  const t1 = await processarMensagem(
    new ClienteModeloFalso([
      {
        natureza_mensagem: 'pedido',
        alteracoes: {
          intencao: { acao: 'informar', valor: 'novo_agendamento' },
          data_texto: { acao: 'informar', valor: 'hoje' },
        },
      },
    ]),
    banco,
    rpc,
    entrada('quero um turno para hoje. tem algum horario disponivel?')
  );

  assert.equal(t1.decisao.tipo, 'aguardando_procedimento');
  assert.equal(t1.procedimento_avaliacao_disponivel, 'Consulta / Avaliação');
  assert.deepEqual(
    conversa(tabelas).contexto_horarios?.oferta_procedimento_pendente,
    { procedimento_id: ID_AVALIACAO },
    'a oferta precisa estar no estado antes da resposta do paciente'
  );

  // --- Turno 2: aceita a oferta -------------------------------------------
  const t2 = await processarMensagem(
    new ClienteModeloFalso([
      {
        natureza_mensagem: 'resposta',
        alteracoes: {},
        eventos_candidatos: [{ tipo: 'aceitar_opcao', referencia_textual: null }],
      },
    ]),
    banco,
    rpc,
    entrada('ok pode ser')
  );

  assert.equal(conversa(tabelas).dados.procedimento_id, ID_AVALIACAO, 'procedimento persistido');
  assert.notEqual(t2.decisao.tipo, 'aguardando_procedimento', 'nunca repetir o pedido de procedimento');

  // Com dois dentistas aptos, o passo natural e escolher o profissional.
  assert.equal(t2.decisao.tipo, 'aguardando_escolha_dentista');

  // --- Turno 3: escolhe o profissional ------------------------------------
  const t3 = await processarMensagem(
    new ClienteModeloFalso([
      { natureza_mensagem: 'resposta', alteracoes: {}, dentistas_candidatos: [idPerez] },
    ]),
    banco,
    rpc,
    entrada('diego perez')
  );

  const depois = conversa(tabelas);

  // 1. o dentista ESCOLHIDO foi persistido -- o certo, nao qualquer um.
  assert.equal(depois.dados.dentista_id, idPerez, 'o dentista escolhido precisa ficar gravado');

  // 2. o procedimento continua la (a escolha de dentista nao apaga o passo anterior).
  assert.equal(depois.dados.procedimento_id, ID_AVALIACAO);

  // 3. a Iris nao repete nenhuma das duas perguntas ja respondidas.
  assert.notEqual(t3.decisao.tipo, 'aguardando_procedimento', 'nunca repetir o pedido de procedimento');
  assert.notEqual(t3.decisao.tipo, 'aguardando_escolha_dentista', 'nunca repetir o pedido de dentista');

  // 4. com procedimento + dentista + "hoje" resolvidos, o fluxo alcanca a
  //    regra de domingo que JA existe -- nao uma regra nova.
  assert.equal(t3.decisao.tipo, 'horarios_disponiveis');
  const resultado = (t3.decisao as { resultado: { tipo: string; motivo?: string } }).resultado;
  assert.equal(resultado.tipo, 'sem_expediente_no_dia');
  assert.equal(resultado.motivo, 'domingo');

  // 5. nenhuma reserva foi criada e nenhum horario foi inventado.
  assert.equal(tabelas.agendamentos.length, 0, 'domingo nunca pode gerar reserva');
});

// --- Fatos entregues a redatora -------------------------------------------
//
// Regressao da conversa real: o estado tinha `dentista_id`, mas a resposta ao
// paciente disse que o sistema "nao registrou" o dentista. Se o fato do
// dentista chega a redatora, ela nao tem como afirmar o contrario -- e este
// teste garante que ele chega.
test('FLUXO REAL: os fatos do ultimo turno nunca negam o dentista ja persistido', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { idPerez } = montarCenario(tabelas);
  const banco = new ClienteFalso(tabelas);
  const rpc = new ClienteRpcFalso({});

  await processarMensagem(
    new ClienteModeloFalso([
      {
        natureza_mensagem: 'pedido',
        alteracoes: {
          intencao: { acao: 'informar', valor: 'novo_agendamento' },
          data_texto: { acao: 'informar', valor: 'hoje' },
        },
      },
    ]),
    banco,
    rpc,
    entrada('quero um turno para hoje. tem algum horario disponivel?')
  );
  await processarMensagem(
    new ClienteModeloFalso([
      { natureza_mensagem: 'resposta', alteracoes: {}, eventos_candidatos: [{ tipo: 'aceitar_opcao', referencia_textual: null }] },
    ]),
    banco,
    rpc,
    entrada('ok pode ser')
  );
  const t3 = await processarMensagem(
    new ClienteModeloFalso([
      { natureza_mensagem: 'resposta', alteracoes: {}, dentistas_candidatos: [idPerez] },
    ]),
    banco,
    rpc,
    entrada('diego perez')
  );

  // O estado tem o dentista...
  assert.equal(conversa(tabelas).dados.dentista_id, idPerez);

  // ...e a decisao entregue a redatora tambem o identifica. Sem isto, a
  // redatora nao tem como saber que a escolha ja foi feita -- foi assim que a
  // resposta real acabou dizendo que o dentista nao tinha sido registrado.
  const decisao = t3.decisao as { dentista_id?: string; dentista_nome_exibido?: string };
  assert.equal(decisao.dentista_id, idPerez, 'a decisao precisa carregar o dentista escolhido');
  assert.ok(
    decisao.dentista_nome_exibido !== undefined && decisao.dentista_nome_exibido !== '',
    'o nome exibivel do dentista precisa acompanhar a decisao, para a redatora poder cita-lo'
  );
});
