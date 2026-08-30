// "Quero um turno para hoje" num DOMINGO, sem dizer o procedimento.
//
// Caso real de producao (v90, 2026-08-30): a Iris respondia "posso comecar
// agendando uma Consulta / Avaliacao... voce gostaria dessa consulta HOJE?" --
// num dia em que a clinica nao atende.
//
// A regra de domingo ja existia, mas so era alcancada em
// `carregar-disponibilidade.ts`, que exige procedimento, dentista e duracao
// resolvidos. Neste desfecho nenhum dos tres existe, entao o fato nunca
// chegava a redatora.
//
// O que estes testes fixam:
//
//   1. o fato do fechamento atravessa como fato ADICIONAL do turno;
//   2. a decisao continua `aguardando_procedimento` -- o procedimento falta;
//   3. a oferta de avaliacao continua acontecendo E sendo persistida;
//   4. nada de disponibilidade, RPC de horarios ou reserva e consultado;
//   5. dia util nao ganha fato nenhum (comportamento atual preservado);
//   6. data ausente/ambigua/invalida NUNCA afirma que a clinica esta fechada.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { derivarFatosAutorizados } from './fatos-autorizados.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste-domingo';
const TELEFONE = '5511988887777';
const ID_AVALIACAO = 'consultation_evaluation';

// 30/08/2026 e DOMINGO; 31/08/2026 e segunda-feira. Verificados de forma
// independente antes de escrever este arquivo.
const DOMINGO = { data: '2026-08-30', minuto_min: 600 };
const SEGUNDA = { data: '2026-08-31', minuto_min: 600 };

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

  return { clinicaId, pacienteId, dentistaId };
}

/** Pede agendamento com uma data, SEM procedimento -- o caso real. */
function clienteModeloPedeData(dataTexto: string) {
  return new ClienteModeloFalso([
    {
      natureza_mensagem: 'pedido',
      alteracoes: {
        intencao: { acao: 'informar', valor: 'novo_agendamento' },
        data_texto: { acao: 'informar', valor: dataTexto },
      },
    },
  ]);
}

/** Pede agendamento SEM nenhum atomo temporal -- controle do custo de leitura. */
function clienteModeloSemData() {
  return new ClienteModeloFalso([
    {
      natureza_mensagem: 'pedido',
      alteracoes: { intencao: { acao: 'informar', valor: 'novo_agendamento' } },
    },
  ]);
}

function entrada(mensagem: string, instante: { data: string; minuto_min: number }) {
  return {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: [mensagem],
    instante_atual: instante,
  };
}

type DecisaoAguardando = {
  tipo: string;
  procedimento_oferecido?: string;
  sem_expediente_na_data_pedida?: { data: string; motivo: string };
};

// --- 1. Domingo: o fato atravessa, a decisao nao muda -------------------

test('DOMINGO sem procedimento: informa o fechamento E continua pedindo o procedimento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);
  const rpc = new ClienteRpcFalso({});

  const resultado = await processarMensagem(
    clienteModeloPedeData('hoje'),
    new ClienteFalso(tabelas),
    rpc,
    entrada('quero um turno para hoje. tem algum horario disponivel?', DOMINGO)
  );

  const decisao = resultado.decisao as DecisaoAguardando;

  // A decisao PRINCIPAL continua sendo pedir o procedimento -- o turno nao
  // vira `sem_expediente_no_dia`, que pressupoe procedimento e dentista.
  assert.equal(decisao.tipo, 'aguardando_procedimento');

  // E o fechamento viaja como fato ADICIONAL do turno.
  assert.deepEqual(
    decisao.sem_expediente_na_data_pedida,
    { data: '2026-08-30', motivo: 'domingo' },
    'o domingo pedido precisa atravessar como fato, senao a redatora oferece avaliacao "para hoje" num dia fechado'
  );

  // A oferta da avaliacao continua acontecendo normalmente.
  assert.equal(decisao.procedimento_oferecido, ID_AVALIACAO);
  assert.equal(resultado.procedimento_avaliacao_disponivel, 'Consulta / Avaliação');

  // E os fatos que a redatora recebe DE FATO neste turno -- derivados do
  // resultado real do orquestrador, nao de uma decisao montada a mao --
  // declaram os dois dados que faltam.
  const fatos = derivarFatosAutorizados(
    resultado.decisao,
    DOMINGO.data,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    resultado.procedimento_avaliacao_disponivel
  );
  assert.deepEqual(fatos.dados_faltantes, ['procedimento', 'data']);
  assert.equal(fatos.objetivo, 'pedir_procedimento', 'o objetivo do turno nao muda');
  assert.equal(fatos.motivo_sem_expediente, 'domingo');
});

test('DOMINGO: a oferta de avaliacao continua PERSISTIDA no estado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);

  await processarMensagem(
    clienteModeloPedeData('hoje'),
    new ClienteFalso(tabelas),
    new ClienteRpcFalso({}),
    entrada('quero um turno para hoje', DOMINGO)
  );

  const linha = tabelas.estado_conversa.find((c) => c.telefone_normalizado === TELEFONE) as unknown as {
    contexto_horarios: Record<string, unknown> | null;
  };
  assert.deepEqual(
    linha.contexto_horarios?.oferta_procedimento_pendente,
    { procedimento_id: ID_AVALIACAO },
    'o fato novo do domingo nao pode atrapalhar a gravacao da oferta -- ela precisa continuar existindo no estado'
  );
});

test('DOMINGO: nenhuma consulta de disponibilidade, nenhuma RPC, nenhuma reserva', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);
  const banco = new ClienteFalso(tabelas);
  const rpc = new ClienteRpcFalso({});

  await processarMensagem(
    clienteModeloPedeData('hoje'),
    banco,
    rpc,
    entrada('quero um turno para hoje', DOMINGO)
  );

  // Regra 4 do pedido: nao procurar horarios antes de procedimento e dentista.
  assert.deepEqual(rpc.chamadas, [], 'nenhuma RPC pode ser chamada -- nem horarios, nem reserva');
  assert.equal(tabelas.agendamentos.length, 0, 'nenhuma reserva pode ser criada');
  assert.equal(banco.estatisticas.chamadasSelect.bloqueios ?? 0, 0, 'bloqueios so sao lidos ao montar disponibilidade');
});

// O CUSTO EXATO do caminho novo -- uma leitura do fuso, e so quando ha
// informacao temporal (revisao do Codex, 2026-08-30).
//
// Antes desta correcao, o retorno de `aguardando_procedimento` acontecia ANTES
// de `buscarFusoHorario`; agora `fechamentoDaDataPedida` precisa do fuso para
// chamar `resolverTemporal`. Medido contra o HEAD: `clinicas` passa de 2 para
// 3 leituras QUANDO ha data/periodo/horario, e continua em 2 quando nao ha.
//
// Uma versao anterior deste teste comparava domingo com dia util e concluia
// "nenhuma leitura extra". A comparacao estava errada: os dois lados ja tinham
// a mudanca, entao ela media o custo do DOMINGO, nunca o custo da CORRECAO.
// O eixo certo e "com data" vs "sem data" -- e o custo aparece.
//
// Nada disto e leitura de agenda: jornada, bloqueio e ocupacao continuam
// intocados, e nenhuma RPC e chamada.
test('CUSTO: com informacao temporal ha UMA leitura de fuso a mais; sem ela, nenhuma', async () => {
  async function perfil(
    instante: { data: string; minuto_min: number },
    comData: boolean
  ): Promise<Record<string, number>> {
    const tabelas = criarTabelasFalsasVazias();
    montarCenario(tabelas);
    const banco = new ClienteFalso(tabelas);
    await processarMensagem(
      comData ? clienteModeloPedeData('hoje') : clienteModeloSemData(),
      banco,
      new ClienteRpcFalso({}),
      entrada('quero marcar', instante)
    );
    return banco.estatisticas.chamadasSelect;
  }

  const comData = await perfil(DOMINGO, true);
  const semData = await perfil(DOMINGO, false);

  // `clinicas` e a tabela do fuso (`buscarFusoHorario`). A leitura extra existe
  // e e exatamente UMA -- declarada aqui em vez de negada.
  assert.equal(
    comData.clinicas - semData.clinicas,
    1,
    'resolver a data pedida custa exatamente uma leitura do fuso (buscarFusoHorario)'
  );

  // E o custo para em `clinicas`: nenhuma outra tabela e tocada a mais.
  for (const tabela of Object.keys({ ...comData, ...semData })) {
    if (tabela === 'clinicas') continue;
    assert.equal(
      comData[tabela] ?? 0,
      semData[tabela] ?? 0,
      `"${tabela}" nao pode ser lida a mais por causa da resolucao da data`
    );
  }

  // Sem informacao temporal a funcao retorna antes de tocar no banco.
  assert.equal(semData.clinicas, 2, 'sem data pedida, o caminho novo nao acrescenta leitura nenhuma');
});

// --- 2. Dia util: comportamento atual preservado ------------------------

test('SEGUNDA-FEIRA sem procedimento: nenhum fato de fechamento, comportamento inalterado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);

  const resultado = await processarMensagem(
    clienteModeloPedeData('hoje'),
    new ClienteFalso(tabelas),
    new ClienteRpcFalso({}),
    entrada('quero um turno para hoje', SEGUNDA)
  );

  const decisao = resultado.decisao as DecisaoAguardando;
  assert.equal(decisao.tipo, 'aguardando_procedimento');
  assert.equal(
    decisao.sem_expediente_na_data_pedida,
    undefined,
    'dia util nunca pode carregar fato de fechamento'
  );
  // A oferta segue como sempre foi.
  assert.equal(decisao.procedimento_oferecido, ID_AVALIACAO);
});

// --- 3. Data explicita que cai em domingo -------------------------------

test('DATA EXPLICITA que e domingo: mesmo comportamento de "hoje"', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);

  // Pedido feito numa SEGUNDA, para o domingo 06/09/2026 -- o fechamento vem
  // da data PEDIDA, nunca do dia em que a mensagem chegou.
  const resultado = await processarMensagem(
    clienteModeloPedeData('06/09/2026'),
    new ClienteFalso(tabelas),
    new ClienteRpcFalso({}),
    entrada('queria marcar dia 06/09', SEGUNDA)
  );

  const decisao = resultado.decisao as DecisaoAguardando;
  assert.equal(decisao.tipo, 'aguardando_procedimento');
  assert.deepEqual(decisao.sem_expediente_na_data_pedida, { data: '2026-09-06', motivo: 'domingo' });
});

// --- 4. Data ausente / ambigua / invalida: nunca afirmar fechamento -----

test('SEM data nenhuma: nunca afirma que a clinica esta fechada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);

  // Mesmo turno de domingo, mas o paciente nao disse quando.
  const resultado = await processarMensagem(
    new ClienteModeloFalso([
      {
        natureza_mensagem: 'pedido',
        alteracoes: { intencao: { acao: 'informar', valor: 'novo_agendamento' } },
      },
    ]),
    new ClienteFalso(tabelas),
    new ClienteRpcFalso({}),
    entrada('queria marcar uma consulta', DOMINGO)
  );

  const decisao = resultado.decisao as DecisaoAguardando;
  assert.equal(decisao.tipo, 'aguardando_procedimento');
  assert.equal(
    decisao.sem_expediente_na_data_pedida,
    undefined,
    'sem data pedida nao ha o que afirmar -- dizer "nao atendemos domingo" seria responder a uma pergunta que ele nao fez'
  );
});

test('DATA AMBIGUA/INVALIDA: nunca afirma que a clinica esta fechada', async () => {
  for (const dataTexto of ['sexta', '31/02/2026', 'qualquer dia desses']) {
    const tabelas = criarTabelasFalsasVazias();
    montarCenario(tabelas);

    const resultado = await processarMensagem(
      clienteModeloPedeData(dataTexto),
      new ClienteFalso(tabelas),
      new ClienteRpcFalso({}),
      entrada(`queria marcar ${dataTexto}`, DOMINGO)
    );

    const decisao = resultado.decisao as DecisaoAguardando;
    assert.equal(decisao.tipo, 'aguardando_procedimento', `"${dataTexto}" deve seguir pedindo o procedimento`);
    assert.equal(
      decisao.sem_expediente_na_data_pedida,
      undefined,
      `"${dataTexto}" nao resolve em data certa -- afirmar fechamento seria inventar fato`
    );
  }
});

// --- 5. A redatora recebe fatos suficientes -----------------------------

test('FATOS: a redatora recebe fechamento + data + pedido de procedimento na MESMA mensagem', () => {
  const fatos = derivarFatosAutorizados(
    {
      tipo: 'aguardando_procedimento',
      procedimento_oferecido: ID_AVALIACAO,
      sem_expediente_na_data_pedida: { data: '2026-08-30', motivo: 'domingo' },
    },
    '2026-08-30',
    undefined,
    undefined,
    { nome: 'Gabriel Cappello' },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'Consulta / Avaliação'
  );

  // Os tres ingredientes que a resposta natural precisa combinar:
  //   "nao atendemos aos domingos" + "podemos procurar outro dia" + "qual procedimento/avaliacao"
  assert.equal(fatos.motivo_sem_expediente, 'domingo', 'o motivo do fechamento');
  assert.equal(fatos.data_referencia, 'hoje, 30/08', 'a data, com a relacao que o Core calculou');
  assert.equal(fatos.procedimento_avaliacao_disponivel, 'Consulta / Avaliação', 'a avaliacao a oferecer');

  // FALTAM DOIS DADOS, nao um (revisao do Codex, 2026-08-30). A data que o
  // paciente deu foi recusada operacionalmente -- entao ela voltou a faltar.
  // O contrato da redatora ja manda pedir TODOS os campos faltantes na mesma
  // mensagem; declarar so `procedimento` escondia o proximo passo temporal.
  assert.deepEqual(
    fatos.dados_faltantes,
    ['procedimento', 'data'],
    'com o dia fechado, faltam procedimento E uma data nova -- declarar so o procedimento omite o passo temporal'
  );

  // O OBJETIVO nao muda: continua sendo obter o procedimento.
  assert.equal(
    fatos.objetivo,
    'pedir_procedimento',
    'o fechamento e fato adicional; o objetivo do turno continua sendo o procedimento'
  );

  // Nenhuma frase pronta atravessa -- so fatos (regra estrutural da spec).
  for (const [chave, valor] of Object.entries(fatos)) {
    if (typeof valor === 'string') {
      assert.ok(
        !/desculpe|infelizmente|não atendemos|podemos/i.test(valor),
        `"${chave}" carrega texto de resposta pronta ("${valor}") -- fatos nunca ditam a frase da Luna`
      );
    }
  }
});

test('FATOS: dia util nao manda motivo de fechamento nem data de referencia', () => {
  const fatos = derivarFatosAutorizados(
    { tipo: 'aguardando_procedimento', procedimento_oferecido: ID_AVALIACAO },
    '2026-08-31',
    undefined,
    undefined,
    { nome: 'Gabriel Cappello' },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'Consulta / Avaliação'
  );

  assert.equal(fatos.objetivo, 'pedir_procedimento');
  assert.equal(fatos.motivo_sem_expediente, undefined);
  assert.equal(fatos.data_referencia, undefined);

  // Sem fechamento, a data que o paciente deu continua valendo -- so o
  // procedimento falta. O par com o teste acima e o que prova que `data` entra
  // POR CAUSA do fechamento, e nao sempre.
  assert.deepEqual(
    fatos.dados_faltantes,
    ['procedimento'],
    'sem fechamento a data segue valida -- pedi-la de novo faria o paciente repetir o que ja disse'
  );
});
