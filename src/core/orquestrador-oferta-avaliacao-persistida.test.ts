// Teste de INTEGRACAO da oferta de Consulta/Avaliacao: prova que a oferta que
// a Iris FAZ ao paciente e a mesma que o sistema REGISTRA.
//
// Lacuna que este arquivo fecha (conversa real, 2026-08-30, Luna):
// `contexto-horarios.test.ts` prova que `derivarAcaoContextoHorarios` grava a
// oferta QUANDO a decisao traz `procedimento_oferecido`. Nao prova que o
// ORQUESTRADOR de fato preenche esse campo -- e era exatamente ali que faltava.
// Sem esta ligacao, reverter `orquestrador.ts` deixaria os testes verdes com o
// defeito de volta.
//
// O caminho testado e o real: paciente conhecido, intencao de agendar, data
// "hoje", procedimento AUSENTE, com Consulta/Avaliacao ativa e dentista apto.
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

// Segunda-feira -- dia com expediente, para o teste medir a OFERTA e nao
// esbarrar em regra de dia sem atendimento.
const INSTANTE_ATUAL = { data: '2026-08-31', minuto_min: 480 };

function montarCenario(tabelas: TabelasFalsas) {
  const clinicaId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const pacienteId = crypto.randomUUID();

  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
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
        procedimentos: [{ id: ID_AVALIACAO, nome: 'Consulta / Avaliação', ativo: true, tempo: 30 }],
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

  return { clinicaId, pacienteId, dentistaId };
}

function semearConversa(tabelas: TabelasFalsas, clinicaId: string, pacienteId: string) {
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

function linhaConversa(tabelas: TabelasFalsas) {
  const linha = tabelas.estado_conversa.find((c) => c.telefone_normalizado === TELEFONE);
  assert.ok(linha !== undefined, 'a conversa precisa existir');
  return linha as { dados: Record<string, unknown>; contexto_horarios: Record<string, unknown> | null };
}

// --- Turno 1: a Iris oferece a avaliacao E registra a oferta ---------------

test('INTEGRACAO: "quero um turno para hoje" sem procedimento -> oferta feita E gravada no estado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId);

  const resultado = await processarMensagem(
    new ClienteModeloFalso([
      {
        natureza_mensagem: 'pedido',
        alteracoes: {
          intencao: { acao: 'informar', valor: 'novo_agendamento' },
          data_texto: { acao: 'informar', valor: 'hoje' },
        },
      },
    ]),
    new ClienteFalso(tabelas),
    new ClienteRpcFalso({}),
    entrada('quero um turno para hoje. tem algum horario disponivel?')
  );

  // 1. a decisao carrega a oferta -- este e o campo que `orquestrador.ts`
  //    passou a preencher; sem ele o teste falha.
  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
  assert.equal(
    (resultado.decisao as { procedimento_oferecido?: string }).procedimento_oferecido,
    ID_AVALIACAO,
    'a decisao precisa declarar QUE a avaliacao esta sendo oferecida'
  );

  // 2. a redatora recebe o nome -- e o que o paciente ve.
  assert.equal(resultado.procedimento_avaliacao_disponivel, 'Consulta / Avaliação');

  // 3. e a oferta existe no ESTADO OFICIAL. Este e o elo que faltava: a
  //    pergunta que o paciente ve tem que existir tambem aqui.
  const contexto = linhaConversa(tabelas).contexto_horarios;
  assert.ok(contexto !== null, 'contexto_horarios NAO pode ficar null depois de uma oferta');
  assert.deepEqual(
    contexto?.oferta_procedimento_pendente,
    { procedimento_id: ID_AVALIACAO },
    'a oferta precisa estar gravada, senao o turno seguinte chega sem pergunta pendente'
  );
});

// --- Turno 2: "ok pode ser" aceita UMA vez e a oferta e consumida ----------

test('INTEGRACAO: "ok pode ser" aplica a avaliacao uma unica vez e consome a oferta', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId);
  const clienteBanco = new ClienteFalso(tabelas);

  // Turno 1: gera a oferta de verdade (nao fabricada a mao).
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
    clienteBanco,
    new ClienteRpcFalso({}),
    entrada('quero um turno para hoje. tem algum horario disponivel?')
  );

  assert.ok(
    linhaConversa(tabelas).contexto_horarios?.oferta_procedimento_pendente !== undefined,
    'pre-condicao: a oferta do turno 1 precisa ter sido gravada'
  );

  // Turno 2: o paciente aceita. `aceitar_opcao` so e emitido pela IA quando a
  // oferta chega no payload -- e ela so chega porque foi gravada acima.
  const resultado = await processarMensagem(
    new ClienteModeloFalso([
      {
        natureza_mensagem: 'resposta',
        alteracoes: {},
        eventos_candidatos: [{ tipo: 'aceitar_opcao', referencia_textual: null }],
      },
    ]),
    clienteBanco,
    new ClienteRpcFalso({}),
    entrada('ok pode ser')
  );

  const linha = linhaConversa(tabelas);

  // A aceitacao aplicou o procedimento -- uma vez, com o id canonico.
  assert.equal(
    linha.dados.procedimento_id,
    ID_AVALIACAO,
    'aceitar a oferta precisa aplicar consultation_evaluation aos dados da conversa'
  );

  // E a Iris NAO volta a perguntar o procedimento: o turno avancou.
  assert.notEqual(
    resultado.decisao.tipo,
    'aguardando_procedimento',
    'depois de aceita, a Iris nunca pode pedir o procedimento de novo'
  );

  // A oferta foi CONSUMIDA -- nao fica pendurada para ser aceita duas vezes.
  assert.ok(
    linha.contexto_horarios?.oferta_procedimento_pendente === undefined,
    'a oferta precisa ser consumida depois da aceitacao, nunca reaproveitada num turno seguinte'
  );
});
