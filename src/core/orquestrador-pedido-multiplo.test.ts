// Mais de um procedimento pedido no MESMO turno -- specs/multiplos-procedimentos-mesmo-turno-v1.md.
//
// DEFEITO DE ORIGEM (WhatsApp real, Cleardent, 2026-09-05): o paciente pediu
// dois procedimentos em dois dias ("um pra terca, o outro para quinta"). Os
// campos do agendamento sao SINGULARES -- nao ha onde guardar dois pares
// (procedimento, dia, horario) --, entao a regra generica de "preserve os dois
// valores numa string minima" produzia `data_texto = "terca, quinta"`, que
// nenhum resolvedor sabe ler. Resultado medido: a Iris repetiu a MESMA pergunta
// tres turnos seguidos e, na quarta mensagem, nao respondeu nada.
//
// A correcao nao ensina o sistema a agendar dois de uma vez: ela reconhece a
// condicao e reconduz para um procedimento por vez -- o que uma pessoa
// atendendo tambem faria.
//
// Todos os dados sao SINTETICOS. As frases sao as REAIS da conversa de origem
// (docs/00-principios.md, principio dos testes realistas), com os erros de
// digitacao preservados exatamente como o paciente escreveu.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { derivarAcaoContextoHorarios } from './contexto-horarios.ts';
import { derivarFatosAutorizados } from './fatos-autorizados.ts';
import { gerarRespostaPaciente } from './gerar-resposta-paciente.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
// Sexta-feira -- a terca e a quinta pedidas caem na semana seguinte, como no
// caso real.
const INSTANTE_ATUAL = { data: '2026-09-04', minuto_min: 480 };

/**
 * Dois procedimentos ativos e um dentista que faz os dois -- o cenario minimo
 * em que o pedido multiplo e possivel de verdade.
 */
function montarCenario(tabelas: TabelasFalsas) {
  const cirurgiaId = crypto.randomUUID();
  const restauracaoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const clinicaId = crypto.randomUUID();

  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [
      {
        id: dentistaId,
        nome: 'Pablo Arruda',
        titulo: 'Dr.',
        ativo: true,
        modo: 'auto',
        dur: 30,
        inicio: '08:00',
        fim: '18:00',
        sabado: false,
        alm_ini: null,
        alm_fim: null,
        procedimentos: [
          { id: cirurgiaId, nome: 'Cirurgia de implante', ativo: true, tempo: 60 },
          { id: restauracaoId, nome: 'Restauração / Cárie (1 face)', ativo: true, tempo: 30 },
        ],
      },
    ],
  });
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: null,
    atualizado_em: new Date('2026-09-04T00:00:00.000Z').toISOString(),
  });
  for (const [id, nome, tempo] of [
    [cirurgiaId, 'Cirurgia de implante', 60],
    [restauracaoId, 'Restauração / Cárie (1 face)', 30],
  ] as const) {
    tabelas.procedimentos_catalogo.push({
      id,
      nome_pt: nome,
      nome_es: null,
      nome_en: null,
      nome_fr: null,
      nome_de: null,
      nome_it: null,
      nome_ru: null,
      nome_ar: null,
      tempo_padrao: tempo,
      ativo: true,
    });
  }
  return { clinicaId, cirurgiaId, restauracaoId, dentistaId };
}

const EVENTO_PEDIDO_MULTIPLO = { tipo: 'pedido_multiplo', referencia_textual: null };

/**
 * A IA emitindo o evento e DEIXANDO OS CAMPOS AUSENTES -- exatamente o que a
 * instrucao manda fazer diante de dois pedidos distintos.
 */
function modeloComPedidoMultiplo(): ClienteModeloFalso {
  return new ClienteModeloFalso([
    {
      natureza_mensagem: 'pedido',
      alteracoes: {},
      eventos_candidatos: [EVENTO_PEDIDO_MULTIPLO],
    },
  ]);
}

async function processar(tabelas: TabelasFalsas, modelo: ClienteModeloFalso, mensagem: string) {
  return await processarMensagem(modelo, new ClienteFalso(tabelas), new ClienteRpcFalso({}), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: [mensagem],
    instante_atual: INSTANTE_ATUAL,
  });
}

function linhaConversa(tabelas: TabelasFalsas) {
  return tabelas.estado_conversa[0] as unknown as {
    dados: Record<string, string>;
    contexto_horarios: Record<string, unknown> | null;
  };
}

// --- 1. O turno de origem: o evento precisa vir JA no primeiro pedido ---

test('primeiro pedido multiplo vira decisao propria -- nunca segue para o fluxo de agendamento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);

  const resultado = await processar(
    tabelas,
    modeloComPedidoMultiplo(),
    'Quero marcar esses dois procedimentos.. vamos marcar um pra terça pode ser? o outro para quinta. tem horarios pra esos dois dias?'
  );

  assert.deepEqual(
    resultado.decisao,
    { tipo: 'pedido_multiplo_detectado' },
    'o pedido multiplo precisa ser reconhecido no PRIMEIRO turno -- foi a ausencia disso que causou o loop de tres turnos em producao'
  );
});

test('REGRESSAO -- o evento vence o roteamento conversacional, em qualquer natureza', async () => {
  // ACHADO DA REVISAO DO CODEX (2026-09-05): `decidirPorNatureza` retorna
  // ANTES da checagem de pedido multiplo quando `alteracoes` esta vazio.
  //
  // Nao e um canto raro: `alteracoes` VAZIO e o caso NORMAL deste fluxo -- a
  // instrucao manda a IA emitir o evento e deixar os quatro campos ausentes.
  // Basta ela classificar a mensagem como `duvida` (plausivel: "tem horarios
  // pra esos dois dias?" e literalmente uma pergunta) e o evento era
  // descartado em silencio, devolvendo o defeito de origem.
  //
  // As quatro naturezas que `decidirPorNatureza` resolve sozinha:
  for (const natureza of ['duvida', 'saudacao', 'nao_compreendida', 'negacao']) {
    const tabelas = criarTabelasFalsasVazias();
    montarCenario(tabelas);
    const modelo = new ClienteModeloFalso([
      { natureza_mensagem: natureza, alteracoes: {}, eventos_candidatos: [EVENTO_PEDIDO_MULTIPLO] },
    ]);

    const resultado = await processar(tabelas, modelo, 'quero marcar os dois, um na terça e outro na quinta');

    assert.deepEqual(
      resultado.decisao,
      { tipo: 'pedido_multiplo_detectado' },
      `natureza "${natureza}" nao pode engolir o pedido multiplo -- o paciente pediu dois agendamentos`
    );
  }
});

test('a decisao NAO carrega procedimento nenhum -- o Core nao sabe quais foram pedidos', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);

  const resultado = await processar(tabelas, modeloComPedidoMultiplo(), 'quero marcar a cirurgia e a restauração');

  // A decisao e uma so chave. Se um dia alguem acrescentar `procedimentos_
  // mencionados` aqui, este teste falha -- e e essa a intencao: sem saber
  // QUAIS o paciente pediu, qualquer nome que atravesse pode ser o errado.
  assert.deepEqual(Object.keys(resultado.decisao), ['tipo']);
});

test('nenhuma reserva, remarcacao ou cancelamento e tentada no turno do pedido multiplo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);
  const rpc = new ClienteRpcFalso({});

  await processarMensagem(modeloComPedidoMultiplo(), new ClienteFalso(tabelas), rpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero os dois, um na terça e outro na quinta'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.deepEqual(
    rpc.chamadas.map((c) => c.nome),
    [],
    'perguntar qual vem primeiro nao toca a agenda -- nenhuma RPC deve ser chamada'
  );
});

// --- 2. A resposta ao paciente e obrigatoriamente generica ---

test('os fatos entregues a redatora nao contem NENHUM nome de procedimento', () => {
  const fatos = derivarFatosAutorizados({ tipo: 'pedido_multiplo_detectado' }, INSTANTE_ATUAL.data);

  assert.equal(fatos.objetivo, 'pedir_um_procedimento_por_vez');
  // A garantia e ESTRUTURAL, nao textual: sem nome nenhum no pacote, a
  // redatora nao tem o que citar -- nem o procedimento errado, nem um
  // terceiro que o paciente nunca pediu.
  const serializado = JSON.stringify(fatos);
  assert.ok(!serializado.includes('irurgia'), 'nenhum nome de procedimento pode atravessar');
  assert.ok(!serializado.includes('estaura'), 'nenhum nome de procedimento pode atravessar');
});

test('a resposta deterministica pergunta qual vem primeiro, sem citar procedimento', () => {
  const resposta = gerarRespostaPaciente({ tipo: 'pedido_multiplo_detectado' });

  assert.equal(resposta, 'Vamos marcar um procedimento de cada vez. Qual você quer marcar primeiro?');
});

// --- 3. O estado em andamento nao e destruido ---

test('o contexto pendente e PRESERVADO -- um agendamento em curso nao e apagado', () => {
  // O paciente pode estar no meio de um agendamento (com horario ja proposto)
  // e apenas ter acrescentado um segundo pedido. Limpar aqui apagaria a
  // proposta que ele ainda vai confirmar.
  assert.deepEqual(derivarAcaoContextoHorarios({ tipo: 'pedido_multiplo_detectado' }), { tipo: 'preservar' });
});

test('nada do pedido multiplo e persistido em dados -- o sinal e transitorio', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);

  await processar(tabelas, modeloComPedidoMultiplo(), 'quero marcar os dois, terça e quinta');

  const dados = linhaConversa(tabelas).dados;
  // Nem os campos combinados (que a IA deixou ausentes), nem um "modo pedido
  // multiplo" inventado: o evento morre no turno em que foi lido.
  assert.equal(dados.data_texto, undefined, 'nenhuma data combinada pode ser gravada');
  assert.equal(dados.horario_texto, undefined, 'nenhum horario combinado pode ser gravado');
  assert.equal(dados.procedimento_id, undefined, 'nenhum procedimento pode ser escolhido pelo Core');
  assert.ok(
    !JSON.stringify(dados).includes('multiplo'),
    'nao existe marcador de pedido multiplo persistido -- a IA reemite o evento se a ambiguidade continuar'
  );
});

// --- 4. Isolamento: o caso ANTIGO nao pode ter mudado ---

test('ISOLAMENTO -- dois valores ALTERNATIVOS do mesmo pedido nao viram pedido multiplo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { cirurgiaId } = montarCenario(tabelas);

  // "pode ser as 10 ou as 11" -- UM agendamento com escolha em aberto. A IA
  // NAO emite o evento (a instrucao e explicita), e a regra antiga de
  // preservar os valores continua valendo.
  const modelo = new ClienteModeloFalso([
    {
      natureza_mensagem: 'pedido',
      alteracoes: {
        procedimento_id: { acao: 'informar', valor: cirurgiaId },
        data_texto: { acao: 'informar', valor: 'terça' },
        horario_texto: { acao: 'informar', valor: '10:00, 11:00' },
      },
      eventos_candidatos: [],
    },
  ]);

  const resultado = await processar(tabelas, modelo, 'a cirurgia na terça, pode ser as 10 ou as 11');

  assert.notEqual(
    resultado.decisao.tipo,
    'pedido_multiplo_detectado',
    'alternativas do MESMO pedido seguem o fluxo normal -- a distincao entre os dois casos nao pode se perder'
  );
});

test('ISOLAMENTO -- mencionar dois procedimentos sem pedir para agendar nao dispara o evento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);

  // "quanto custa a restauração e o implante?" -- duvida, nao pedido. A IA
  // classifica como duvida e nao emite evento nenhum.
  const modelo = new ClienteModeloFalso([
    { natureza_mensagem: 'duvida', alteracoes: {}, eventos_candidatos: [] },
  ]);

  const resultado = await processar(tabelas, modelo, 'quanto custa a restauração e o implante?');

  assert.notEqual(resultado.decisao.tipo, 'pedido_multiplo_detectado');
});

// --- 4b. CONTINUIDADE: depois de escolher, SO aquele pedido avanca ---

test('CONTINUIDADE -- escolhido o procedimento, o fluxo avanca so para ele, ate a reserva', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { cirurgiaId, restauracaoId, dentistaId } = montarCenario(tabelas);

  // TURNO 1 -- o pedido duplo e interceptado.
  const turno1 = await processar(
    tabelas,
    modeloComPedidoMultiplo(),
    'Quero marcar esses dois procedimentos.. um pra terça, o outro para quinta'
  );
  assert.deepEqual(turno1.decisao, { tipo: 'pedido_multiplo_detectado' });

  // TURNO 2 -- ele escolhe UM e diz o dia. A IA nao emite mais o evento (ele
  // resolveu a ambiguidade) e preenche normalmente os campos daquele pedido.
  const turno2 = await processar(
    tabelas,
    new ClienteModeloFalso([
      {
        natureza_mensagem: 'resposta',
        alteracoes: {
          procedimento_id: { acao: 'informar', valor: cirurgiaId },
          data_texto: { acao: 'informar', valor: '08/09/2026' },
        },
        eventos_candidatos: [],
      },
    ]),
    'cirugia de implante para terça feira'
  );

  // O fluxo normal retomou: chegou a oferecer horarios reais para a cirurgia.
  assert.equal(
    turno2.decisao.tipo,
    'horarios_disponiveis',
    'depois da escolha, o agendamento precisa avancar normalmente -- a interceptacao nao pode deixar a conversa presa'
  );
  assert.equal(
    turno2.decisao.tipo === 'horarios_disponiveis' ? turno2.decisao.procedimento_id : null,
    cirurgiaId,
    'os horarios sao do procedimento ESCOLHIDO'
  );
  assert.notEqual(
    turno2.decisao.tipo === 'horarios_disponiveis' ? turno2.decisao.procedimento_id : null,
    restauracaoId,
    'o outro procedimento nao pode ter vazado para o pedido em andamento'
  );

  // E o estado guarda exatamente UM procedimento -- nunca os dois.
  const dados = linhaConversa(tabelas).dados;
  assert.equal(dados.procedimento_id, cirurgiaId);
  assert.ok(
    !String(dados.data_texto ?? '').includes(','),
    'a data nao pode ser uma string combinada -- era esse o formato que travava o fluxo'
  );

  // TURNO 3 -- ele escolhe o horario e confirma; a reserva acontece para o
  // procedimento escolhido, com o dentista certo.
  const rpc = new ClienteRpcFalso({
    // A reserva exige cadastro persistido antes -- o fluxo real passa pelos dois.
    cappia_persistir_paciente: {
      data: { sucesso: true, paciente_id: crypto.randomUUID() },
      error: null,
    },
    cappia_reservar_agendamento: {
      data: {
        sucesso: true,
        agendamento_id: crypto.randomUUID(),
        dentista_id: dentistaId,
        duracao_min: 60,
        data: '2026-09-08',
        horario: '10:00',
      },
      error: null,
    },
  });
  const turno3 = await processarMensagem(
    new ClienteModeloFalso([
      {
        natureza_mensagem: 'resposta',
        alteracoes: {
          horario_texto: { acao: 'informar', valor: '10:00' },
          confirmacao: { acao: 'informar', valor: 'sim' },
          nome: { acao: 'informar', valor: 'Carlos Cappello' },
          cpf: { acao: 'informar', valor: '52998224725' },
          data_nascimento: { acao: 'informar', valor: '1973-08-02' },
        },
        eventos_candidatos: [],
      },
    ]),
    new ClienteFalso(tabelas),
    rpc,
    {
      provider: PROVIDER,
      instancia_whatsapp: INSTANCIA,
      telefone_normalizado: TELEFONE,
      mensagens_atuais: ['10 hrs, pode confirmar. Carlos Cappello, 529.982.247-25, 02/08/1973'],
      instante_atual: INSTANTE_ATUAL,
    }
  );

  assert.equal(
    turno3.decisao.tipo,
    'reserva_criada',
    `o fluxo tem de chegar ate a reserva, nao travar -- veio "${turno3.decisao.tipo}"`
  );

  // E a reserva foi feita para o procedimento ESCOLHIDO -- nunca o outro.
  const chamadaReserva = rpc.chamadas.find((c) => c.nome === 'cappia_reservar_agendamento');
  assert.ok(chamadaReserva !== undefined, 'a reserva precisa ter sido chamada de fato');
  const argumentos = JSON.stringify(chamadaReserva.parametros);
  assert.ok(argumentos.includes(cirurgiaId), 'a reserva e do procedimento escolhido');
  assert.ok(
    !argumentos.includes(restauracaoId),
    'o procedimento NAO escolhido nunca pode entrar na reserva -- seria marcar a coisa errada'
  );
});

// --- 5. A ultima mensagem do caso real: dois periodos/horarios, nunca silencio ---

test('CASO REAL -- dois periodos e dois horarios no mesmo turno respondem, sem misturar', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);

  // Esta e a mensagem que ficou SEM RESPOSTA em producao. No fluxo corrigido
  // ela nem deveria ser alcancada (o primeiro pedido ja teria sido
  // interceptado), mas se chegar, precisa responder -- nunca silencio.
  const resultado = await processar(
    tabelas,
    modeloComPedidoMultiplo(),
    'na terça quero de manha. 10 hrs se tiver. e na quinta quero na parte da tarde 16hrs.'
  );

  assert.deepEqual(resultado.decisao, { tipo: 'pedido_multiplo_detectado' });

  const resposta = gerarRespostaPaciente(resultado.decisao);
  assert.ok(resposta.length > 0, 'silencio e o unico desfecho inaceitavel');

  // Nenhum dos dois pares pode ter sido aplicado: aplicar um deles as cegas
  // marcaria o procedimento errado no horario errado.
  const dados = linhaConversa(tabelas).dados;
  assert.equal(dados.horario_texto, undefined);
  assert.equal(dados.periodo, undefined);
});
