// Cadastro conversacional de ponta a ponta -- specs/cadastro-conversacional-v1.md.
//
// Arquivo separado de orquestrador.test.ts pelo mesmo motivo de
// orquestrador-dentista.test.ts: a montagem de cenario com ficha de paciente e
// dublê de persistencia e propria desta frente.
//
// O dublê de modelo entrega os campos cadastrais ja extraidos, que e
// exatamente o que a interpretadora real produz. A prova de que a IA CONSEGUE
// extrai-los esta no runner contra a OpenAI real
// (src/eval/teste-real-cadastro.ts), nunca aqui.
//
// Todos os dados sao SINTETICOS. O CPF do caminho feliz e valido de proposito;
// CPF invalido aparece somente no teste de rejeicao.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso, type RespostaRpc } from './teste-cliente-rpc-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
const INSTANTE_ATUAL = { data: '2026-08-03', minuto_min: 480 };

const NOME_SINTETICO = 'Gabriel Cappello';
const CPF_SINTETICO_VALIDO = '52998224725';
const NASCIMENTO_SINTETICO = '1985-05-10';

function semearClinica(tabelas: TabelasFalsas, dentistas: Record<string, unknown>[], automatizacoes?: unknown): string {
  const clinicaId = crypto.randomUUID();
  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas,
    ...(automatizacoes !== undefined ? { automatizacoes } : {}),
  });
  return clinicaId;
}

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

function semearPaciente(tabelas: TabelasFalsas, clinicaId: string, cadastro: Record<string, unknown>): string {
  const pacienteId = crypto.randomUUID();
  tabelas.pacientes.push({ id: pacienteId, clinica_id: clinicaId, telefone_normalizado: TELEFONE, ...cadastro });
  return pacienteId;
}

function montarCenario(tabelas: TabelasFalsas, automatizacoes?: unknown) {
  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const clinicaId = semearClinica(
    tabelas,
    [
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
    automatizacoes
  );
  semearConversa(tabelas, clinicaId);
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
  return { clinicaId, procedimentoId, dentistaId };
}

/** Escolha + confirmacao, opcionalmente com dados cadastrais na mesma janela. */
function clienteModelo(procedimentoId: string, cadastro: Record<string, string> = {}): ClienteModeloFalso {
  const alteracoes: Record<string, { acao: string; valor: string }> = {
    procedimento_id: { acao: 'informar', valor: procedimentoId },
    data_texto: { acao: 'informar', valor: 'hoje' },
    horario_texto: { acao: 'informar', valor: '10:00' },
    confirmacao: { acao: 'informar', valor: 'sim' },
  };
  for (const [campo, valor] of Object.entries(cadastro)) {
    alteracoes[campo] = { acao: 'informar', valor };
  }
  return new ClienteModeloFalso([{ natureza_mensagem: 'resposta', alteracoes }]);
}

function respostaReservaOk(dentistaId: string, agendamentoId: string): RespostaRpc {
  return {
    data: {
      sucesso: true,
      agendamento_id: agendamentoId,
      dentista_id: dentistaId,
      duracao_min: 30,
      data: '2026-08-03',
      horario: '10:00',
    },
    error: null,
  };
}

async function processar(
  tabelas: TabelasFalsas,
  modelo: ClienteModeloFalso,
  rpc: ClienteRpcFalso,
  mensagem: string
) {
  return await processarMensagem(modelo, new ClienteFalso(tabelas), rpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: [mensagem],
    instante_atual: INSTANTE_ATUAL,
  });
}

// --- Quais campos faltam ---

test('paciente NOVO: pede os tres obrigatorios, nunca persiste nem reserva', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  const rpc = new ClienteRpcFalso({});

  const resultado = await processar(tabelas, clienteModelo(procedimentoId), rpc, 'sim, confirmo');

  assert.deepEqual(resultado.decisao, {
    tipo: 'cadastro_necessario',
    campos_faltantes: ['nome', 'cpf', 'data_nascimento'],
  });
  assert.equal(rpc.chamadas.length, 0);
});

test('paciente EXISTENTE INCOMPLETO: pede somente o que falta', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId } = montarCenario(tabelas);
  // Ja tem nome e CPF na ficha -- falta so o nascimento.
  semearPaciente(tabelas, clinicaId, { nome: NOME_SINTETICO, documento: CPF_SINTETICO_VALIDO });
  const rpc = new ClienteRpcFalso({});

  const resultado = await processar(tabelas, clienteModelo(procedimentoId), rpc, 'sim, confirmo');

  assert.deepEqual(resultado.decisao, { tipo: 'cadastro_necessario', campos_faltantes: ['data_nascimento'] });
  assert.equal(rpc.chamadas.length, 0, 'nada e persistido enquanto falta dado');
});

test('paciente EXISTENTE COMPLETO: cadastro nao interrompe e nao gera escrita', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId } = montarCenario(tabelas);
  const pacienteId = semearPaciente(tabelas, clinicaId, {
    nome: NOME_SINTETICO,
    documento: CPF_SINTETICO_VALIDO,
    data_nascimento: NASCIMENTO_SINTETICO,
  });
  const agendamentoId = crypto.randomUUID();
  const rpc = new ClienteRpcFalso({ cappia_reservar_agendamento: respostaReservaOk(dentistaId, agendamentoId) });

  const resultado = await processar(tabelas, clienteModelo(procedimentoId), rpc, 'sim, confirmo');

  assert.equal(resultado.decisao.tipo, 'reserva_criada');
  // Uma unica chamada: a reserva. Paciente que nao mudou nao e reescrito.
  assert.deepEqual(
    rpc.chamadas.map((c) => c.nome),
    ['cappia_reservar_agendamento']
  );
  assert.equal(rpc.chamadas[0].parametros.p_paciente_id, pacienteId);
});

test('email so entra nos faltantes quando solicitar_email = true', async () => {
  const comExigencia = criarTabelasFalsasVazias();
  const cenarioA = montarCenario(comExigencia, { solicitar_email: true });
  semearPaciente(comExigencia, cenarioA.clinicaId, {
    nome: NOME_SINTETICO,
    documento: CPF_SINTETICO_VALIDO,
    data_nascimento: NASCIMENTO_SINTETICO,
  });
  const resultadoA = await processar(
    comExigencia,
    clienteModelo(cenarioA.procedimentoId),
    new ClienteRpcFalso({}),
    'sim, confirmo'
  );
  assert.deepEqual(resultadoA.decisao, { tipo: 'cadastro_necessario', campos_faltantes: ['email'] });

  // Mesma ficha, clinica sem a exigencia: segue direto para a reserva.
  const semExigencia = criarTabelasFalsasVazias();
  const cenarioB = montarCenario(semExigencia, { solicitar_email: false });
  semearPaciente(semExigencia, cenarioB.clinicaId, {
    nome: NOME_SINTETICO,
    documento: CPF_SINTETICO_VALIDO,
    data_nascimento: NASCIMENTO_SINTETICO,
  });
  const agendamentoId = crypto.randomUUID();
  const resultadoB = await processar(
    semExigencia,
    clienteModelo(cenarioB.procedimentoId),
    new ClienteRpcFalso({ cappia_reservar_agendamento: respostaReservaOk(cenarioB.dentistaId, agendamentoId) }),
    'sim, confirmo'
  );
  assert.equal(resultadoB.decisao.tipo, 'reserva_criada');
});

test('automatizacoes ausente ou malformada NAO passa a exigir e-mail', async () => {
  for (const automatizacoes of [undefined, null, 'texto', [], { solicitar_email: 'sim' }, {}]) {
    const tabelas = criarTabelasFalsasVazias();
    const { clinicaId, procedimentoId, dentistaId } = montarCenario(tabelas, automatizacoes);
    semearPaciente(tabelas, clinicaId, {
      nome: NOME_SINTETICO,
      documento: CPF_SINTETICO_VALIDO,
      data_nascimento: NASCIMENTO_SINTETICO,
    });
    const rpc = new ClienteRpcFalso({
      cappia_reservar_agendamento: respostaReservaOk(dentistaId, crypto.randomUUID()),
    });

    const resultado = await processar(tabelas, clienteModelo(procedimentoId), rpc, 'sim, confirmo');
    assert.equal(
      resultado.decisao.tipo,
      'reserva_criada',
      `automatizacoes=${JSON.stringify(automatizacoes)} nao deveria criar obrigacao de e-mail`
    );
  }
});

// --- Encadeamento persistencia -> reserva ---

test('paciente NOVO completa na conversa: persiste e reserva no MESMO processamento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId } = montarCenario(tabelas);
  const pacienteIdNovo = crypto.randomUUID();
  const agendamentoId = crypto.randomUUID();
  const rpc = new ClienteRpcFalso({
    cappia_persistir_paciente: { data: { sucesso: true, paciente_id: pacienteIdNovo }, error: null },
    cappia_reservar_agendamento: respostaReservaOk(dentistaId, agendamentoId),
  });

  const resultado = await processar(
    tabelas,
    clienteModelo(procedimentoId, {
      nome: NOME_SINTETICO,
      cpf: CPF_SINTETICO_VALIDO,
      data_nascimento: NASCIMENTO_SINTETICO,
    }),
    rpc,
    'sou Gabriel Cappello, 529.982.247-25, nasci em 10/05/1985'
  );

  // NAO para em "cadastro concluido" -- nao ha decisao humana pendente aqui.
  assert.equal(resultado.decisao.tipo, 'reserva_criada');

  // Ordem exata: persistir primeiro, reservar depois.
  assert.deepEqual(
    rpc.chamadas.map((c) => c.nome),
    ['cappia_persistir_paciente', 'cappia_reservar_agendamento']
  );

  // Traducao cpf -> p_documento no unico limite de escrita.
  const persistencia = rpc.chamadas[0].parametros;
  assert.equal(persistencia.p_clinica_id, clinicaId);
  assert.equal(persistencia.p_telefone_normalizado, TELEFONE);
  assert.equal(persistencia.p_nome, NOME_SINTETICO);
  assert.equal(persistencia.p_documento, CPF_SINTETICO_VALIDO);
  assert.equal(persistencia.p_data_nascimento, NASCIMENTO_SINTETICO);

  // A reserva usou o id RECEM-CRIADO, nunca null.
  assert.equal(rpc.chamadas[1].parametros.p_paciente_id, pacienteIdNovo);
});

test('paciente EXISTENTE que completa o que faltava: persiste e reserva no mesmo processamento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId } = montarCenario(tabelas);
  const pacienteId = semearPaciente(tabelas, clinicaId, {
    nome: NOME_SINTETICO,
    documento: CPF_SINTETICO_VALIDO,
  });
  const rpc = new ClienteRpcFalso({
    cappia_persistir_paciente: { data: { sucesso: true, paciente_id: pacienteId }, error: null },
    cappia_reservar_agendamento: respostaReservaOk(dentistaId, crypto.randomUUID()),
  });

  const resultado = await processar(
    tabelas,
    clienteModelo(procedimentoId, { data_nascimento: NASCIMENTO_SINTETICO }),
    rpc,
    'nasci em 10/05/1985'
  );

  assert.equal(resultado.decisao.tipo, 'reserva_criada');
  assert.deepEqual(
    rpc.chamadas.map((c) => c.nome),
    ['cappia_persistir_paciente', 'cappia_reservar_agendamento']
  );
  // O nome vai junto mesmo sem ter sido dito neste turno: o Core envia o
  // estado cadastral atual conhecido, nao so o campo digitado agora.
  assert.equal(rpc.chamadas[0].parametros.p_nome, NOME_SINTETICO);
  assert.equal(rpc.chamadas[0].parametros.p_data_nascimento, NASCIMENTO_SINTETICO);
});

// --- Validacao ---

test('CPF invalido nao entra em dados -- o campo continua faltante', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  const rpc = new ClienteRpcFalso({});

  const resultado = await processar(
    tabelas,
    clienteModelo(procedimentoId, {
      nome: NOME_SINTETICO,
      cpf: '12345678900', // digitos verificadores invalidos
      data_nascimento: NASCIMENTO_SINTETICO,
    }),
    rpc,
    'sou Gabriel Cappello, 123.456.789-00, nasci em 10/05/1985'
  );

  // Nome e nascimento entraram; o CPF nao -- entao so ele continua faltando.
  assert.deepEqual(resultado.decisao, { tipo: 'cadastro_necessario', campos_faltantes: ['cpf'] });
  assert.equal(rpc.chamadas.length, 0);
  // E o valor invalido nunca chegou ao estado da conversa.
  const dados = tabelas.estado_conversa[0].dados as Record<string, unknown>;
  assert.equal(dados.cpf, undefined);
  assert.equal(dados.nome, NOME_SINTETICO);
});

test('CPF com pontuacao e persistido NORMALIZADO (so digitos)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId, dentistaId } = montarCenario(tabelas);
  const rpc = new ClienteRpcFalso({
    cappia_persistir_paciente: { data: { sucesso: true, paciente_id: crypto.randomUUID() }, error: null },
    cappia_reservar_agendamento: respostaReservaOk(dentistaId, crypto.randomUUID()),
  });

  await processar(
    tabelas,
    clienteModelo(procedimentoId, {
      nome: `  ${NOME_SINTETICO}  `,
      cpf: '529.982.247-25',
      data_nascimento: NASCIMENTO_SINTETICO,
    }),
    rpc,
    'sou Gabriel Cappello, 529.982.247-25, nasci em 10/05/1985'
  );

  const dados = tabelas.estado_conversa[0].dados as Record<string, unknown>;
  assert.equal(dados.cpf, CPF_SINTETICO_VALIDO, 'o Core grava o que conferiu, nunca o texto cru');
  assert.equal(dados.nome, NOME_SINTETICO, 'espacos das bordas normalizados');
  assert.equal(rpc.chamadas[0].parametros.p_documento, CPF_SINTETICO_VALIDO);
});

test('data de nascimento futura e recusada -- o campo continua faltante', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  const rpc = new ClienteRpcFalso({});

  const resultado = await processar(
    tabelas,
    clienteModelo(procedimentoId, {
      nome: NOME_SINTETICO,
      cpf: CPF_SINTETICO_VALIDO,
      data_nascimento: '2030-01-01', // depois de INSTANTE_ATUAL
    }),
    rpc,
    'nasci em 01/01/2030'
  );

  assert.deepEqual(resultado.decisao, { tipo: 'cadastro_necessario', campos_faltantes: ['data_nascimento'] });
});

// --- CPF ja cadastrado ---

test('cpf_ja_cadastrado para o fluxo: nao duplica paciente e NUNCA tenta reservar', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  const rpc = new ClienteRpcFalso({
    cappia_persistir_paciente: { data: { sucesso: false, motivo: 'cpf_ja_cadastrado' }, error: null },
  });

  const resultado = await processar(
    tabelas,
    clienteModelo(procedimentoId, {
      nome: NOME_SINTETICO,
      cpf: CPF_SINTETICO_VALIDO,
      data_nascimento: NASCIMENTO_SINTETICO,
    }),
    rpc,
    'sou Gabriel Cappello, 529.982.247-25, nasci em 10/05/1985'
  );

  assert.deepEqual(resultado.decisao, { tipo: 'cpf_ja_cadastrado' });
  assert.deepEqual(
    rpc.chamadas.map((c) => c.nome),
    ['cappia_persistir_paciente'],
    'a reserva nunca e tentada depois desse desfecho'
  );
});

test('motivo estrutural da RPC falha FECHADO, nunca vira decisao conversacional', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  const rpc = new ClienteRpcFalso({
    cappia_persistir_paciente: { data: { sucesso: false, motivo: 'nome_ausente' }, error: null },
  });

  // Invariante do Core violada = bug interno, nao situacao do paciente.
  await assert.rejects(
    () =>
      processar(
        tabelas,
        clienteModelo(procedimentoId, {
          nome: NOME_SINTETICO,
          cpf: CPF_SINTETICO_VALIDO,
          data_nascimento: NASCIMENTO_SINTETICO,
        }),
        rpc,
        'sou Gabriel Cappello, 529.982.247-25, nasci em 10/05/1985'
      ),
    (erro: unknown) => erro instanceof Error
  );

  assert.deepEqual(
    rpc.chamadas.map((c) => c.nome),
    ['cappia_persistir_paciente'],
    'nunca segue para a reserva com estado inconsistente'
  );
});
