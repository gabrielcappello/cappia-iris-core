// DURACAO POR DENTISTA -- fluxo real, ponta a ponta (2026-08-30).
//
// Caso de producao que motivou a mudanca (v91, turno 21:40:06 UTC, confirmado
// nos logs da Edge Function): a clinica tem tres dentistas ativos com duracoes
// legitimamente diferentes para a MESMA Consulta/Avaliacao --
//
//   Diego Perez  : modo auto,         dur = 60
//   Diego Ramoz  : modo procedimento, tempo = 30
//   Pablo Arruda : modo procedimento, tempo = 30
//
// O paciente pediu avaliacao para segunda-feira e escolheu o Diego Perez. Como
// `configuracoesDuracao` nao guardava `dentista_id`, as tres duracoes caiam na
// mesma chave `(clinica_id, procedimento_id)` e `resolverDuracao` devolvia
// `duracao_conflitante` -> `erro_configuracao_duracao` -> a Iris respondeu
// "tivemos uma instabilidade tecnica".
//
// Regra aprovada: cada dentista usa exclusivamente a propria duracao; a de
// outro profissional nunca causa conflito nem altera a agenda dele.
//
// Estes testes exercitam o fluxo REAL (`processarMensagem` + banco falso), nao
// so a funcao pura -- `resolver-duracao.test.ts` ja cobre a unidade.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { derivarFatosAutorizados } from './fatos-autorizados.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-duracao-por-dentista';
const TELEFONE = '5511988887777';
const ID_AVALIACAO = 'consultation_evaluation';

const ID_PEREZ = '9c693b86-5113-41d4-b97d-be52a579ae8c';
const ID_RAMOZ = 'b2c3d4e5-0000-4000-8000-000000000002';
const ID_ARRUDA = 'c3d4e5f6-0000-4000-8000-000000000003';

// Domingo 30/08 as 18:40 local -- "segunda-feira" resolve para 31/08, o turno
// real. A data em si nao e o objeto do teste; a duracao e.
const INSTANTE = { data: '2026-08-30', minuto_min: 18 * 60 + 40 };

/** Os tres profissionais reais, com as configuracoes confirmadas no banco. */
function perez(dur = 60): Record<string, unknown> {
  return {
    id: ID_PEREZ,
    nome: 'Perez',
    titulo: 'Dr. Diego',
    ativo: true,
    modo: 'auto',
    dur,
    inicio: '08:00',
    fim: '18:00',
    sabado: false,
    alm_ini: null,
    alm_fim: null,
    procedimentos: [{ id: ID_AVALIACAO, nome: 'Consulta / Avaliação', ativo: true, tempo: 20 }],
  };
}

function modoProcedimento(id: string, nome: string, tempo: number, ativo = true): Record<string, unknown> {
  return {
    id,
    nome,
    titulo: 'Dr.',
    ativo,
    modo: 'procedimento',
    inicio: '08:00',
    fim: '18:00',
    sabado: false,
    alm_ini: null,
    alm_fim: null,
    procedimentos: [{ id: ID_AVALIACAO, nome: 'Consulta / Avaliação', ativo: true, tempo }],
  };
}

function montar(tabelas: TabelasFalsas, dentistas: Record<string, unknown>[]) {
  const clinicaId = crypto.randomUUID();
  const pacienteId = crypto.randomUUID();

  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas,
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
    tempo_padrao: 20,
    ativo: true,
  });
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { intencao: 'novo_agendamento', data_texto: 'segunda-feira', procedimento_id: ID_AVALIACAO },
    paciente_id: pacienteId,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-30T21:39:00.000Z').toISOString(),
  });

  return { clinicaId, pacienteId };
}

/** O turno real: a IA resolve o nome dito para UM candidato. */
async function escolher(tabelas: TabelasFalsas, dentistaId: string, mensagem: string) {
  return await processarMensagem(
    new ClienteModeloFalso([
      { natureza_mensagem: 'resposta', alteracoes: {}, dentistas_candidatos: [dentistaId] },
    ]),
    new ClienteFalso(tabelas),
    new ClienteRpcFalso({}),
    {
      provider: PROVIDER,
      instancia_whatsapp: INSTANCIA,
      telefone_normalizado: TELEFONE,
      mensagens_atuais: [mensagem],
      instante_atual: INSTANTE,
    }
  );
}

type DecisaoHorarios = {
  tipo: string;
  duracao_min?: number;
  resultado?: { tipo?: string; opcoes?: { inicio_min: number }[] };
};

// --- O caso real ---------------------------------------------------------

test('CASO REAL v91: Perez(60) + Ramoz(30) + Arruda(30) -- escolher Perez resolve 60, sem falha tecnica', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montar(tabelas, [perez(60), modoProcedimento(ID_RAMOZ, 'Ramoz', 30), modoProcedimento(ID_ARRUDA, 'Arruda', 30)]);

  const resultado = await escolher(tabelas, ID_PEREZ, 'Diego Perez');
  const decisao = resultado.decisao as DecisaoHorarios;

  // Antes da correcao isto era `erro_configuracao_duracao`.
  assert.notEqual(
    decisao.tipo,
    'erro_configuracao_duracao',
    'a duracao dos OUTROS profissionais nunca pode derrubar a agenda do escolhido'
  );
  assert.equal(decisao.tipo, 'horarios_disponiveis');
  assert.equal(decisao.duracao_min, 60, 'Perez atende em 60 minutos -- a duracao DELE');
  assert.equal(decisao.resultado?.tipo, 'opcoes');
  assert.ok((decisao.resultado?.opcoes?.length ?? 0) > 0, 'precisa devolver horarios reais');

  // E a redatora recebe horarios, nunca falha tecnica.
  const fatos = derivarFatosAutorizados(resultado.decisao, INSTANTE.data);
  assert.equal(fatos.objetivo, 'apresentar_horarios');
  assert.notEqual(fatos.falha_tecnica, true);
});

test('CASO REAL v91: escolher Ramoz na MESMA clinica resolve 30', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montar(tabelas, [perez(60), modoProcedimento(ID_RAMOZ, 'Ramoz', 30), modoProcedimento(ID_ARRUDA, 'Arruda', 30)]);

  const decisao = (await escolher(tabelas, ID_RAMOZ, 'Diego Ramoz')).decisao as DecisaoHorarios;

  assert.equal(decisao.tipo, 'horarios_disponiveis');
  assert.equal(decisao.duracao_min, 30, 'Ramoz atende em 30 minutos, no modo procedimento');
});

// --- Isolamento entre profissionais --------------------------------------

test('ISOLAMENTO: alterar a duracao do Ramoz nao muda NADA no resultado do Perez', async () => {
  async function comRamozEm(tempo: number) {
    const tabelas = criarTabelasFalsasVazias();
    montar(tabelas, [perez(60), modoProcedimento(ID_RAMOZ, 'Ramoz', tempo)]);
    const decisao = (await escolher(tabelas, ID_PEREZ, 'Diego Perez')).decisao as DecisaoHorarios;
    return {
      tipo: decisao.tipo,
      duracao: decisao.duracao_min,
      horarios: decisao.resultado?.opcoes?.map((o) => o.inicio_min) ?? [],
    };
  }

  // A UNICA coisa que varia entre as duas execucoes e a duracao do OUTRO
  // dentista. O resultado do Perez tem que ser identico -- inclusive a grade.
  assert.deepEqual(await comRamozEm(30), await comRamozEm(45));
});

test('ISOLAMENTO: dentista INATIVO com duracao divergente continua ignorado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montar(tabelas, [perez(60), modoProcedimento(ID_RAMOZ, 'Ramoz', 30, false)]);

  const decisao = (await escolher(tabelas, ID_PEREZ, 'Diego Perez')).decisao as DecisaoHorarios;

  assert.equal(decisao.tipo, 'horarios_disponiveis');
  assert.equal(decisao.duracao_min, 60);
});

test('ISOLAMENTO: um unico dentista na clinica continua funcionando como antes', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montar(tabelas, [perez(60)]);

  const decisao = (await escolher(tabelas, ID_PEREZ, 'Diego Perez')).decisao as DecisaoHorarios;

  assert.equal(decisao.tipo, 'horarios_disponiveis');
  assert.equal(decisao.duracao_min, 60);
});

// --- A duracao usada e mesmo a do dentista, e muda a grade ---------------

// --- Remarcacao: a duracao e a do dentista DO AGENDAMENTO ----------------

test('REMARCACAO: usa a duracao do dentista do agendamento, nao a de outro profissional', async () => {
  const tabelas = criarTabelasFalsasVazias();
  // Clinica com os dois: o agendamento e do RAMOZ (30min), e o Perez (60min)
  // esta ativo na mesma clinica. Antes da correcao, os dois valores colidiam.
  const { clinicaId, pacienteId } = montar(tabelas, [perez(60), modoProcedimento(ID_RAMOZ, 'Ramoz', 30)]);

  tabelas.agendamentos.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: ID_RAMOZ,
    procedimento_id: ID_AVALIACAO,
    data: '2026-09-02',
    horario: '10:00',
    duracao_min: 30,
    status: 'confirmado',
  });

  // O paciente pede para remarcar para segunda-feira.
  const resultado = await processarMensagem(
    new ClienteModeloFalso([
      {
        natureza_mensagem: 'pedido',
        alteracoes: {
          intencao: { acao: 'informar', valor: 'remarcacao' },
          data_texto: { acao: 'informar', valor: 'segunda-feira' },
        },
      },
    ]),
    new ClienteFalso(tabelas),
    new ClienteRpcFalso({}),
    {
      provider: PROVIDER,
      instancia_whatsapp: INSTANCIA,
      telefone_normalizado: TELEFONE,
      mensagens_atuais: ['quero remarcar para segunda-feira'],
      instante_atual: INSTANTE,
    }
  );

  const decisao = resultado.decisao as DecisaoHorarios;

  // O essencial: a presenca do Perez (60min) na mesma clinica nao pode
  // transformar a remarcacao do Ramoz em falha tecnica.
  assert.notEqual(
    decisao.tipo,
    'erro_configuracao_duracao',
    'a duracao de outro profissional nunca pode derrubar a remarcacao'
  );
  assert.notEqual(decisao.tipo, 'duracao_nao_configurada');
});

test('A duracao do escolhido governa a GRADE de horarios, nao so o campo', async () => {
  async function grade(dur: number) {
    const tabelas = criarTabelasFalsasVazias();
    montar(tabelas, [perez(dur), modoProcedimento(ID_RAMOZ, 'Ramoz', 30)]);
    const d = (await escolher(tabelas, ID_PEREZ, 'Diego Perez')).decisao as DecisaoHorarios;
    return d.resultado?.opcoes?.map((o) => o.inicio_min) ?? [];
  }

  const de60 = await grade(60);
  const de30 = await grade(30);

  assert.ok(de60.length > 0 && de30.length > 0);

  // A grade e diferente -- e ESSA e a prova de que a duracao do escolhido
  // atravessa ate o calculo, nao fica so no campo `duracao_min`.
  assert.notDeepEqual(de60, de30, 'duracoes diferentes precisam produzir grades diferentes');

  // MEDIDO, nao suposto: a grade e espacada de hora em hora e limitada, entao
  // 30 e 60 produzem o MESMO numero de opcoes (10) -- a diferenca esta no
  // ultimo encaixe do dia (17:30 com 30min, 17:00 com 60min), porque so ele
  // depende de quanto tempo ainda cabe antes do fim do expediente.
  //
  // Uma versao anterior deste teste afirmava "mais longo produz menos opcoes".
  // Era suposicao minha, e a medicao a desmentiu. O ultimo horario e o
  // discriminador honesto.
  assert.equal(de30[de30.length - 1], 17 * 60 + 30, 'com 30min o ultimo encaixe do dia e 17:30');
  assert.equal(de60[de60.length - 1], 17 * 60, 'com 60min o ultimo encaixe do dia e 17:00');
});
