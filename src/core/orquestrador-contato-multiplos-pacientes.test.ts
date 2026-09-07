// Testes de aceite de specs/contato-multiplos-pacientes-v1.md secao 8.
//
// SO os deterministicos (dublês de banco/modelo/RPC): 1, 2, 3, 6, 10, 13,
// 14, 15, 17, 19, 20. Os que exigem IA real (correlacao semantica de "minha
// mae Marta") ou banco real (backfill, FK composta) ficam em
// src/eval/ / integration, apos a migration ser aplicada -- ver o cabecalho
// da spec.
//
// Todos os dados sao SINTETICOS. A prova de que a IA CONSEGUE emitir
// paciente_id/atendimento_para_terceiro esta no runner contra a OpenAI real,
// nunca aqui: aqui o dublê ja entrega o que a interpretadora real produziria.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
const INSTANTE_ATUAL = { data: '2026-08-03', minuto_min: 480 };

function semearClinica(tabelas: TabelasFalsas): string {
  const clinicaId = crypto.randomUUID();
  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
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
  return clinicaId;
}

function semearConversa(tabelas: TabelasFalsas, clinicaId: string, pacienteId: string | null = null) {
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: pacienteId,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
}

function semearContato(tabelas: TabelasFalsas, clinicaId: string, telefone = TELEFONE): string {
  const id = crypto.randomUUID();
  tabelas.contatos_whatsapp.push({ id, clinica_id: clinicaId, telefone_normalizado: telefone });
  return id;
}

function semearPaciente(
  tabelas: TabelasFalsas,
  clinicaId: string,
  contatoId: string,
  extra: Record<string, unknown>,
  telefone = TELEFONE
): string {
  const id = crypto.randomUUID();
  tabelas.pacientes.push({
    id,
    clinica_id: clinicaId,
    contato_id: contatoId,
    telefone_normalizado: telefone,
    nome: 'Paciente Sintetico',
    vinculo: 'titular',
    ...extra,
  });
  return id;
}

function modelo(saida: Record<string, unknown>): ClienteModeloFalso {
  return new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {}, ...saida }]);
}

async function processar(tabelas: TabelasFalsas, m: ClienteModeloFalso, mensagem: string) {
  return await processarMensagem(m, new ClienteFalso(tabelas), new ClienteRpcFalso({}), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: [mensagem],
    instante_atual: INSTANTE_ATUAL,
  });
}

// --- Teste 1: contato com um unico paciente -- comportamento identico ---

test('1: contato com 1 paciente -- nenhuma pergunta nova, pacientes_do_contato ausente do payload', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos' });
  semearConversa(tabelas, clinicaId);

  const m = modelo({ natureza_mensagem: 'saudacao', alteracoes: {} });
  const resultado = await processar(tabelas, m, 'oi');

  // nenhuma decisao de escolha de paciente
  assert.notEqual(resultado.decisao.tipo, 'aguardando_escolha_paciente');
  assert.notEqual(resultado.decisao.tipo, 'pedir_vinculo_paciente_novo');
  // o payload da interpretadora nao levou pacientes_do_contato
  assert.equal('pacientes_do_contato' in m.chamadas[0].payload, false);
});

// --- Teste 2: varios pacientes, mensagem ambigua -> aguardando_escolha_paciente ---

test('2: varios pacientes + atendimento_para_terceiro sem paciente_id -> aguardando_escolha_paciente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Marta', vinculo: 'dependente' });
  semearConversa(tabelas, clinicaId);

  const m = modelo({ natureza_mensagem: 'pedido', alteracoes: {}, atendimento_para_terceiro: true });
  const resultado = await processar(tabelas, m, 'quero marcar uma consulta pra alguem');

  assert.equal(resultado.decisao.tipo, 'aguardando_escolha_paciente');
  if (resultado.decisao.tipo === 'aguardando_escolha_paciente') {
    assert.deepEqual(
      resultado.decisao.pacientes.map((p) => p.nome).sort(),
      ['Carlos', 'Marta']
    );
    // nomes, nunca IDs
    for (const p of resultado.decisao.pacientes) {
      assert.deepEqual(Object.keys(p).sort(), ['nome', 'vinculo']);
    }
  }
  // e a interpretadora recebeu pacientes_do_contato (contato com >1)
  assert.equal('pacientes_do_contato' in m.chamadas[0].payload, true);
});

// --- Teste 3: varios pacientes, mensagem inequivoca (paciente_id emitido) ---

test('3: paciente_id da Marta emitido e valido -> sem pergunta, segue o fluxo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });
  const martaId = semearPaciente(tabelas, clinicaId, contatoId, {
    nome: 'Marta',
    vinculo: 'dependente',
    documento: '52998224725',
    data_nascimento: '1950-01-01',
  });
  semearConversa(tabelas, clinicaId);

  const m = modelo({
    natureza_mensagem: 'pedido',
    alteracoes: { paciente_id: { acao: 'informar', valor: martaId } },
    atendimento_para_terceiro: true,
  });
  const resultado = await processar(tabelas, m, 'quero marcar para minha mae Marta');

  // a selecao foi gravada em estado_conversa.paciente_id
  assert.equal(tabelas.estado_conversa[0].paciente_id, martaId);
  // e NAO caiu em escolha de paciente
  assert.notEqual(resultado.decisao.tipo, 'aguardando_escolha_paciente');
  assert.notEqual(resultado.decisao.tipo, 'pedir_vinculo_paciente_novo');
});

// --- Teste 4 (negativo): paciente_id inventado / de outro contato -> descartado ---

test('4: paciente_id de OUTRO contato -> validarEscolhaPaciente descarta; cai em aguardando_escolha_paciente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Marta', vinculo: 'dependente' });
  // paciente de outro contato (outro telefone)
  const outroContato = semearContato(tabelas, clinicaId, '5511888888888');
  const forasteiroId = semearPaciente(
    tabelas,
    clinicaId,
    outroContato,
    { nome: 'Forasteiro' },
    '5511888888888'
  );
  semearConversa(tabelas, clinicaId);

  const m = modelo({
    natureza_mensagem: 'pedido',
    alteracoes: { paciente_id: { acao: 'informar', valor: forasteiroId } },
    atendimento_para_terceiro: true,
  });
  const resultado = await processar(tabelas, m, 'marcar pro forasteiro');

  // o id foi descartado -> nenhuma selecao gravada, e ha >1 no contato -> pergunta
  assert.equal(tabelas.estado_conversa[0].paciente_id, null);
  assert.equal(resultado.decisao.tipo, 'aguardando_escolha_paciente');
});

// --- Teste 13: terceiro ja vinculado, nao identificado -> escolha, nunca cadastro ---

test('13: atendimento_para_terceiro + paciente_id ausente + outra_pessoa_alem_das_listadas ausente -> aguardando_escolha_paciente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Marta', vinculo: 'dependente' });
  semearConversa(tabelas, clinicaId);

  const m = modelo({
    natureza_mensagem: 'pedido',
    alteracoes: {},
    atendimento_para_terceiro: true,
    outra_pessoa_alem_das_listadas: false,
  });
  const resultado = await processar(tabelas, m, 'e pra outra pessoa');

  assert.equal(resultado.decisao.tipo, 'aguardando_escolha_paciente');
});

// --- Teste 14: dados cadastrais no mesmo turno de atendimento_para_terceiro nao alteram o titular ---

test('14: atendimento_para_terceiro + nome/data_nascimento no turno -> ficha do titular NAO e tocada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  const carlosId = semearPaciente(tabelas, clinicaId, contatoId, {
    nome: 'Carlos',
    vinculo: 'titular',
    documento: '11144477735',
    data_nascimento: '1980-03-03',
  });
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Marta', vinculo: 'dependente' });
  semearConversa(tabelas, clinicaId, carlosId); // Carlos ja era o selecionado

  const carlosAntes = { ...tabelas.pacientes.find((p) => p.id === carlosId)! };

  const rpc = new ClienteRpcFalso({});
  const m = modelo({
    natureza_mensagem: 'pedido',
    alteracoes: {
      nome: { acao: 'informar', valor: 'Marta Silva' },
      data_nascimento: { acao: 'informar', valor: '1950-07-07' },
    },
    atendimento_para_terceiro: true,
  });
  await processarMensagem(m, new ClienteFalso(tabelas), rpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar pra minha mae, ela e a Marta Silva, nasceu em 07/07/1950'],
    instante_atual: INSTANTE_ATUAL,
  });

  // a ficha do Carlos permanece bit a bit igual
  const carlosDepois = tabelas.pacientes.find((p) => p.id === carlosId)!;
  assert.deepEqual(carlosDepois, carlosAntes);
  // e persistirPaciente nunca foi chamada com os dados da Marta sobre o Carlos
  assert.equal(rpc.chamadas.filter((c) => c.nome === 'cappia_persistir_paciente').length, 0);
});

// --- Teste 17: contato so com o titular, pedido para terceiro -> pergunta de vinculo, sem travar ---

test('17: contato so com o titular + atendimento_para_terceiro -> pedir_vinculo_paciente_novo (nao trava)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });
  semearConversa(tabelas, clinicaId);

  const m = modelo({ natureza_mensagem: 'pedido', alteracoes: {}, atendimento_para_terceiro: true });
  const resultado = await processar(tabelas, m, 'e pra minha mae');

  assert.equal(resultado.decisao.tipo, 'pedir_vinculo_paciente_novo');
  // pacientes_do_contato NAO foi ao payload (contato so tem 1 -- o titular)
  assert.equal('pacientes_do_contato' in m.chamadas[0].payload, false);
});

// --- Teste "outra_pessoa_alem_das_listadas" -> pergunta de vinculo, mesmo com varios no contato ---

test('outra_pessoa_alem_das_listadas: true -> pedir_vinculo_paciente_novo, sem tentar casar contra a lista', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Marta', vinculo: 'dependente' });
  semearConversa(tabelas, clinicaId);

  const m = modelo({
    natureza_mensagem: 'pedido',
    alteracoes: {},
    atendimento_para_terceiro: true,
    outra_pessoa_alem_das_listadas: true,
  });
  const resultado = await processar(tabelas, m, 'nao e a Marta nem o Carlos, e outra pessoa');

  assert.equal(resultado.decisao.tipo, 'pedir_vinculo_paciente_novo');
});

// --- Teste 20 (paridade): objetivo mapeado em fatos-autorizados ---

test('20: aguardando_escolha_paciente mapeia para o objetivo escolher_entre_pacientes com nomes (nunca IDs)', async () => {
  // Exercitado indiretamente: derivarFatosAutorizados e chamado dentro de
  // finalizar(). Aqui provamos pela decisao + inspecao do resultado.
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Marta', vinculo: 'dependente' });
  semearConversa(tabelas, clinicaId);

  const m = modelo({ natureza_mensagem: 'pedido', alteracoes: {}, atendimento_para_terceiro: true });
  const resultado = await processar(tabelas, m, 'pra alguem');

  assert.equal(resultado.decisao.tipo, 'aguardando_escolha_paciente');
  // nenhum campo da decisao carrega paciente_id (so nome + vinculo)
  if (resultado.decisao.tipo === 'aguardando_escolha_paciente') {
    const serial = JSON.stringify(resultado.decisao.pacientes);
    assert.equal(serial.includes('paciente_id'), false);
  }
});

// ── Teste 15: trocar de Carlos para Marta nao transporta cadastro nem
//    dados operacionais (spec secao 4.4, limpeza na troca) ────────────────

test('15: trocar de Carlos para Marta limpa data_texto/horario_texto/procedimento_id/nome de Carlos', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  const carlosId = semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });
  const martaId = semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Marta', vinculo: 'dependente' });
  // Carlos era o selecionado E acumulou dados do assunto dele.
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {
      procedimento_id: 'algum-proc',
      data_texto: 'amanha',
      horario_texto: '10:00',
      nome: 'Carlos Cappello',
    },
    paciente_id: carlosId,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });

  const m = modelo({
    natureza_mensagem: 'pedido',
    alteracoes: { paciente_id: { acao: 'informar', valor: martaId } },
    atendimento_para_terceiro: true,
  });
  await processar(tabelas, m, 'na verdade e pra minha mae Marta');

  // a selecao virou Marta
  assert.equal(tabelas.estado_conversa[0].paciente_id, martaId);
  // e os campos acumulados de Carlos sumiram de dados
  const dados = tabelas.estado_conversa[0].dados as Record<string, unknown>;
  for (const campo of ['procedimento_id', 'data_texto', 'horario_texto', 'nome']) {
    assert.ok(!(campo in dados) || dados[campo] === undefined, `${campo} deveria ter sido limpo na troca`);
  }
});

// ── Teste 16: "numero proprio" num turno e telefone no seguinte, pessoa
//    SEM cadastro no numero informado (spec secao 4.5, passos 4-5) ────────

const TELEFONE_MARTA = '5511777777777';

test('16: vinculo_novo_paciente numero_proprio persistido; ao chegar telefone sem cadastro, pede cadastro (nao INSERT)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });
  // turno 1 ja aconteceu: vinculo_novo_paciente = numero_proprio persistido em dados
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { vinculo_novo_paciente: 'numero_proprio' },
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });

  const rpc = new ClienteRpcFalso({});
  // turno 2: so o telefone da Marta (contato de destino nao existe ainda)
  const m = new ClienteModeloFalso([
    {
      natureza_mensagem: 'resposta',
      alteracoes: { telefone_novo_paciente: { acao: 'informar', valor: TELEFONE_MARTA } },
    },
  ]);
  const resultado = await processarMensagem(m, new ClienteFalso(tabelas), rpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: [TELEFONE_MARTA],
    instante_atual: INSTANTE_ATUAL,
  });

  // persistirPaciente NAO foi chamada -- ainda falta o cadastro da pessoa nova
  assert.equal(rpc.chamadas.filter((c) => c.nome === 'cappia_persistir_paciente').length, 0);
  // e a decisao pede o cadastro (nome/cpf/data)
  assert.equal(resultado.decisao.tipo, 'cadastro_necessario');
  // o telefone da Marta ficou persistido para o proximo turno
  assert.equal((tabelas.estado_conversa[0].dados as Record<string, unknown>).telefone_novo_paciente, TELEFONE_MARTA);
});

test('16b: cadastro completo + telefone -> cria Marta com o contato de DESTINO (nunca o da conversa)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    // ja tem vinculo + telefone + cadastro completo acumulados
    dados: {
      vinculo_novo_paciente: 'numero_proprio',
      telefone_novo_paciente: TELEFONE_MARTA,
      nome: 'Marta Silva',
      cpf: '52998224725',
      data_nascimento: '1950-07-07',
    },
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });

  const novoPacienteId = crypto.randomUUID();
  const rpc = new ClienteRpcFalso({
    cappia_persistir_paciente: { data: { sucesso: true, paciente_id: novoPacienteId }, error: null },
  });
  const m = new ClienteModeloFalso([{ natureza_mensagem: 'resposta', alteracoes: {} }]);
  await processarMensagem(m, new ClienteFalso(tabelas), rpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['ok'],
    instante_atual: INSTANTE_ATUAL,
  });

  const chamada = rpc.chamadas.find((c) => c.nome === 'cappia_persistir_paciente');
  assert.ok(chamada, 'persistirPaciente deveria ter sido chamada');
  // o contato de destino foi criado a partir do telefone da Marta, NAO o da conversa
  const contatoDestino = tabelas.contatos_whatsapp.find((c) => c.telefone_normalizado === TELEFONE_MARTA);
  assert.ok(contatoDestino, 'contato de destino deveria ter sido criado');
  assert.equal(chamada!.parametros.p_contato_id, contatoDestino!.id);
  assert.notEqual(chamada!.parametros.p_contato_id, contatoId);
  assert.equal(chamada!.parametros.p_telefone_normalizado, TELEFONE_MARTA);
  assert.equal(chamada!.parametros.p_vinculo, 'titular');
  // e a selecao passou a apontar para a Marta recem-criada
  assert.equal(tabelas.estado_conversa[0].paciente_id, novoPacienteId);
});

// ── Teste 18: terceiro ja cadastrado com telefone proprio -> reutiliza,
//    nao duplica (spec secao 4.5, passo 4, primeiro ramo) ────────────────

test('18: numero proprio de contato que JA tem Marta -> reutiliza o cadastro, nenhum INSERT', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoCarlos = semearContato(tabelas, clinicaId);
  semearPaciente(tabelas, clinicaId, contatoCarlos, { nome: 'Carlos', vinculo: 'titular' });
  // Marta ja e titular do PROPRIO contato (outro telefone), sem relacao com Carlos
  const contatoMarta = semearContato(tabelas, clinicaId, TELEFONE_MARTA);
  const martaId = semearPaciente(
    tabelas,
    clinicaId,
    contatoMarta,
    { nome: 'Marta', vinculo: 'titular' },
    TELEFONE_MARTA
  );
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { vinculo_novo_paciente: 'numero_proprio', telefone_novo_paciente: TELEFONE_MARTA },
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });

  const rpc = new ClienteRpcFalso({});
  const m = new ClienteModeloFalso([{ natureza_mensagem: 'resposta', alteracoes: {} }]);
  await processarMensagem(m, new ClienteFalso(tabelas), rpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['ok'],
    instante_atual: INSTANTE_ATUAL,
  });

  // nenhum INSERT: a Marta ja existia
  assert.equal(rpc.chamadas.filter((c) => c.nome === 'cappia_persistir_paciente').length, 0);
  // a selecao passou a apontar para a Marta existente (cross-contato)
  assert.equal(tabelas.estado_conversa[0].paciente_id, martaId);
  // e a ficha da Marta continua no contato dela propria
  assert.equal(tabelas.pacientes.find((p) => p.id === martaId)!.contato_id, contatoMarta);
});

// ── Teste 19: "numero proprio" para contato de destino com varios pacientes
//    -> escolha validada contra a lista fresca DESSE contato ──────────────

function cenarioDestinoComDoisPacientes() {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoCarlos = semearContato(tabelas, clinicaId);
  const carlosId = semearPaciente(tabelas, clinicaId, contatoCarlos, { nome: 'Carlos', vinculo: 'titular' });
  const contatoDestino = semearContato(tabelas, clinicaId, TELEFONE_MARTA);
  const martaId = semearPaciente(tabelas, clinicaId, contatoDestino, { nome: 'Marta', vinculo: 'titular' }, TELEFONE_MARTA);
  const joanaId = semearPaciente(
    tabelas,
    clinicaId,
    contatoDestino,
    { nome: 'Joana', vinculo: 'dependente' },
    TELEFONE_MARTA
  );
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { vinculo_novo_paciente: 'numero_proprio', telefone_novo_paciente: TELEFONE_MARTA },
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  return { tabelas, carlosId, martaId, joanaId };
}

test('19: destino com varios pacientes -> a lista FRESCA do destino (Marta/Joana) chega ao payload da interpretadora e a decisao pergunta sobre ela', async () => {
  const { tabelas } = cenarioDestinoComDoisPacientes();

  const m = new ClienteModeloFalso([{ natureza_mensagem: 'resposta', alteracoes: {} }]);
  const resultado = await processarMensagem(m, new ClienteFalso(tabelas), new ClienteRpcFalso({}), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['ok'],
    instante_atual: INSTANTE_ATUAL,
  });

  // PAYLOAD REAL da interpretadora: a lista e a do contato de DESTINO, nunca
  // a do contato de quem conversa (que so tem o Carlos).
  const payload = m.chamadas[0].payload as { pacientes_do_contato?: { nome: string }[] };
  assert.ok(Array.isArray(payload.pacientes_do_contato), 'pacientes_do_contato deve estar no payload');
  assert.deepEqual(payload.pacientes_do_contato!.map((p) => p.nome).sort(), ['Joana', 'Marta']);
  assert.equal(
    payload.pacientes_do_contato!.some((p) => p.nome === 'Carlos'),
    false,
    'o Carlos (contato de quem conversa) NUNCA entra na lista do destino'
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_escolha_paciente');
  if (resultado.decisao.tipo === 'aguardando_escolha_paciente') {
    assert.deepEqual(resultado.decisao.pacientes.map((p) => p.nome).sort(), ['Joana', 'Marta']);
  }
});

test('19b (par A): id de UM paciente do DESTINO e aceito -> vira a selecao (cross-contato)', async () => {
  const { tabelas, martaId } = cenarioDestinoComDoisPacientes();

  const m = new ClienteModeloFalso([
    { natureza_mensagem: 'resposta', alteracoes: { paciente_id: { acao: 'informar', valor: martaId } } },
  ]);
  await processarMensagem(m, new ClienteFalso(tabelas), new ClienteRpcFalso({}), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['a Marta'],
    instante_atual: INSTANTE_ATUAL,
  });

  // aceito: a selecao passou a apontar para a Marta (do contato de destino)
  assert.equal(tabelas.estado_conversa[0].paciente_id, martaId);
});

test('19b (par B): id do contato do CARLOS e REJEITADO -> selecao nao muda, decisao segue pedindo a escolha do destino', async () => {
  const { tabelas, carlosId } = cenarioDestinoComDoisPacientes();

  const m = new ClienteModeloFalso([
    { natureza_mensagem: 'resposta', alteracoes: { paciente_id: { acao: 'informar', valor: carlosId } } },
  ]);
  const resultado = await processarMensagem(m, new ClienteFalso(tabelas), new ClienteRpcFalso({}), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['esse ai'],
    instante_atual: INSTANTE_ATUAL,
  });

  // rejeitado: validarEscolhaPaciente descartou o id do Carlos (nao esta na
  // lista do contato de destino) -- selecao NAO virou Carlos
  assert.notEqual(tabelas.estado_conversa[0].paciente_id, carlosId);
  assert.equal(tabelas.estado_conversa[0].paciente_id, null);
  assert.equal(resultado.decisao.tipo, 'aguardando_escolha_paciente');
});

// ── Selecao LIMPA ao concluir o fluxo (spec secao 4.4) ──────────────────

test('selecao volta a null ao concluir a reserva de um paciente selecionado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  const proc = tabelas.procedimentos_catalogo[0].id as string;
  const dent = (tabelas.clinicas[0].dentistas as Record<string, unknown>[])[0].id as string;
  const carlosId = semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });
  const martaId = semearPaciente(tabelas, clinicaId, contatoId, {
    nome: 'Marta',
    vinculo: 'dependente',
    documento: '52998224725',
    data_nascimento: '1950-05-10',
  });
  // Marta ja selecionada (a IA a identificou num turno anterior).
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: martaId,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  void carlosId;

  const agendamentoId = crypto.randomUUID();
  const rpc = new ClienteRpcFalso({
    cappia_reservar_agendamento: {
      data: {
        sucesso: true,
        agendamento_id: agendamentoId,
        dentista_id: dent,
        duracao_min: 30,
        data: '2026-08-03',
        horario: '10:00',
      },
      error: null,
    },
  });
  const m = new ClienteModeloFalso([
    {
      natureza_mensagem: 'resposta',
      alteracoes: {
        procedimento_id: { acao: 'informar', valor: proc },
        data_texto: { acao: 'informar', valor: 'hoje' },
        horario_texto: { acao: 'informar', valor: '10:00' },
        confirmacao: { acao: 'informar', valor: 'sim' },
      },
    },
  ]);
  const resultado = await processarMensagem(m, new ClienteFalso(tabelas), rpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['pode confirmar'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'reserva_criada');
  // a reserva usou a Marta selecionada
  const chamadaReserva = rpc.chamadas.find((c) => c.nome === 'cappia_reservar_agendamento');
  assert.equal(chamadaReserva!.parametros.p_paciente_id, martaId);
  // selecao limpa apos concluir
  assert.equal(tabelas.estado_conversa[0].paciente_id, null);
});

test('campos do fluxo "outra pessoa" (vinculo/telefone) saem de dados ao desistir', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { vinculo_novo_paciente: 'numero_proprio', telefone_novo_paciente: TELEFONE_MARTA },
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });

  const m = new ClienteModeloFalso([{ natureza_mensagem: 'negacao', alteracoes: {} }]);
  const resultado = await processar(tabelas, m, 'deixa pra la');

  assert.equal(resultado.decisao.tipo, 'desistencia');
  const dados = tabelas.estado_conversa[0].dados as Record<string, unknown>;
  assert.ok(!('vinculo_novo_paciente' in dados) || dados.vinculo_novo_paciente === undefined);
  assert.ok(!('telefone_novo_paciente' in dados) || dados.telefone_novo_paciente === undefined);
});

// ── #2: ramo `dependente` envia vinculo: 'dependente' na RPC ────────────

test('dependente: a criacao da ficha envia p_vinculo="dependente" na RPC (nao cai no default titular)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });
  const proc = tabelas.procedimentos_catalogo[0].id as string;
  const dent = (tabelas.clinicas[0].dentistas as Record<string, unknown>[])[0].id as string;
  // fluxo "outra pessoa": ja respondeu "vinculado a este numero", cadastro
  // completo da pessoa nova acumulado, horario ja proposto -> so falta o "sim".
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {
      vinculo_novo_paciente: 'dependente',
      nome: 'Marta Silva',
      cpf: '52998224725',
      data_nascimento: '1950-07-07',
      procedimento_id: proc,
      data_texto: 'hoje',
      horario_texto: '10:00',
    },
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });

  const novoId = crypto.randomUUID();
  const agId = crypto.randomUUID();
  const rpc = new ClienteRpcFalso({
    cappia_persistir_paciente: { data: { sucesso: true, paciente_id: novoId }, error: null },
    cappia_reservar_agendamento: {
      data: { sucesso: true, agendamento_id: agId, dentista_id: dent, duracao_min: 30, data: '2026-08-03', horario: '10:00' },
      error: null,
    },
  });
  const m = new ClienteModeloFalso([
    { natureza_mensagem: 'resposta', alteracoes: { confirmacao: { acao: 'informar', valor: 'sim' } } },
  ]);
  await processarMensagem(m, new ClienteFalso(tabelas), rpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['pode confirmar'],
    instante_atual: INSTANTE_ATUAL,
  });

  const criacao = rpc.chamadas.find((c) => c.nome === 'cappia_persistir_paciente');
  assert.ok(criacao, 'persistirPaciente deveria ter sido chamada para criar a dependente');
  assert.equal(criacao!.parametros.p_vinculo, 'dependente');
  // INSERT (sem p_paciente_id) e no contato DESTA conversa
  assert.ok(!Object.prototype.hasOwnProperty.call(criacao!.parametros, 'p_paciente_id'));
  assert.equal(criacao!.parametros.p_contato_id, contatoId);
});

// ── #4: na troca, dados NOVOS de Marta (fornecidos no turno) sao
//    PRESERVADOS; so o snapshot antigo de Carlos e limpo ──────────────────

test('troca preserva o cadastro de Marta emitido no MESMO turno e apaga so o snapshot de Carlos', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  const carlosId = semearPaciente(tabelas, clinicaId, contatoId, {
    nome: 'Carlos',
    vinculo: 'titular',
    documento: '11144477735',
    data_nascimento: '1980-03-03',
  });
  const martaId = semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Marta', vinculo: 'dependente' });
  // Carlos era o selecionado, com o SNAPSHOT OPERACIONAL do assunto dele
  // acumulado em `dados` (o cadastral dele mora na ficha, nao aqui).
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {
      procedimento_id: 'proc-do-carlos',
      data_texto: 'amanha',
      horario_texto: '09:00',
      // um dado cadastral que Carlos chegou a dar na conversa e que NAO
      // pertence a Marta -- tem de sumir na troca.
      email: 'carlos@antigo.test',
    },
    paciente_id: carlosId,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });

  // ESTE turno: identifica a Marta E ja traz o nome/nascimento DELA.
  const m = modelo({
    natureza_mensagem: 'pedido',
    alteracoes: {
      paciente_id: { acao: 'informar', valor: martaId },
      nome: { acao: 'informar', valor: 'Marta Silva Prado' },
      data_nascimento: { acao: 'informar', valor: '1950-07-07' },
    },
    atendimento_para_terceiro: true,
  });
  await processar(tabelas, m, 'e pra minha mae Marta Silva Prado, nasceu 07/07/1950');

  assert.equal(tabelas.estado_conversa[0].paciente_id, martaId);
  const dados = tabelas.estado_conversa[0].dados as Record<string, unknown>;
  // OPERACIONAIS de Carlos: apagados
  for (const campo of ['procedimento_id', 'data_texto', 'horario_texto']) {
    assert.ok(!(campo in dados) || dados[campo] === undefined, `${campo} (de Carlos) deveria ter sido limpo`);
  }
  // CADASTRAL de Carlos que o turno NAO tocou (email): apagado (era snapshot dele)
  assert.ok(!('email' in dados) || dados.email === undefined, 'o email antigo de Carlos deveria ter sido limpo');
  // CADASTRAIS que o turno emitiu para MARTA: preservados (nao apagados na troca)
  assert.equal(dados.nome, 'Marta Silva Prado');
  assert.equal(dados.data_nascimento, '1950-07-07');
  // a ficha do Carlos no banco: intacta
  const carlos = tabelas.pacientes.find((p) => p.id === carlosId)!;
  assert.equal(carlos.nome, 'Carlos');
  assert.equal(carlos.documento, '11144477735');
  assert.equal(carlos.data_nascimento, '1980-03-03');
});

// ── PERCURSO REAL COMPLETO: Carlos inicia avaliacao para a mae ──────────

test('percurso: Carlos ja informou procedimento/data, cadastra a mae (dependente), reserva usa SO os dados dela; Carlos intacto', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  const carlosId = semearPaciente(tabelas, clinicaId, contatoId, {
    nome: 'Carlos',
    vinculo: 'titular',
    documento: '11144477735',
    data_nascimento: '1980-03-03',
    email: 'carlos@exemplo.test',
  });
  const proc = tabelas.procedimentos_catalogo[0].id as string;
  const dent = (tabelas.clinicas[0].dentistas as Record<string, unknown>[])[0].id as string;
  const carlosAntes = { ...tabelas.pacientes.find((p) => p.id === carlosId)! };

  // Estado apos varios turnos: Carlos ja informou procedimento+data para a mae,
  // ja respondeu "vinculado a este numero", ja completou o cadastro DELA, e o
  // horario ja foi proposto. Este turno e o "pode confirmar".
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {
      vinculo_novo_paciente: 'dependente',
      procedimento_id: proc,
      data_texto: 'hoje',
      horario_texto: '10:00',
      nome: 'Marta Cappello',
      cpf: '52998224725',
      data_nascimento: '1950-11-20',
    },
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });

  const martaId = crypto.randomUUID();
  const agId = crypto.randomUUID();
  const rpc = new ClienteRpcFalso({
    cappia_persistir_paciente: { data: { sucesso: true, paciente_id: martaId }, error: null },
    cappia_reservar_agendamento: {
      data: { sucesso: true, agendamento_id: agId, dentista_id: dent, duracao_min: 30, data: '2026-08-03', horario: '10:00' },
      error: null,
    },
  });
  const m = new ClienteModeloFalso([
    { natureza_mensagem: 'resposta', alteracoes: { confirmacao: { acao: 'informar', valor: 'sim' } } },
  ]);
  const resultado = await processarMensagem(m, new ClienteFalso(tabelas), rpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['pode confirmar'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'reserva_criada');

  // a MARTA foi criada como dependente do contato do Carlos, com O CADASTRO DELA
  const criacao = rpc.chamadas.find((c) => c.nome === 'cappia_persistir_paciente')!;
  assert.equal(criacao.parametros.p_vinculo, 'dependente');
  assert.equal(criacao.parametros.p_contato_id, contatoId);
  assert.equal(criacao.parametros.p_nome, 'Marta Cappello');
  assert.equal(criacao.parametros.p_documento, '52998224725');
  assert.equal(criacao.parametros.p_data_nascimento, '1950-11-20');

  // a RESERVA usou EXCLUSIVAMENTE o paciente_id da Marta e a ficha dela
  const reserva = rpc.chamadas.find((c) => c.nome === 'cappia_reservar_agendamento')!;
  assert.equal(reserva.parametros.p_paciente_id, martaId);
  assert.notEqual(reserva.parametros.p_paciente_id, carlosId);
  assert.equal(reserva.parametros.p_nome, 'Marta Cappello');
  assert.equal(reserva.parametros.p_documento, '52998224725');

  // a ficha do Carlos: bit a bit intacta
  const carlosDepois = tabelas.pacientes.find((p) => p.id === carlosId)!;
  assert.deepEqual(carlosDepois, carlosAntes);

  // selecao limpa ao concluir; campos do fluxo "outra pessoa" tambem
  assert.equal(tabelas.estado_conversa[0].paciente_id, null);
  const dadosFinais = tabelas.estado_conversa[0].dados as Record<string, unknown>;
  assert.ok(!('vinculo_novo_paciente' in dadosFinais) || dadosFinais.vinculo_novo_paciente === undefined);
});

// ── 3a revisao, bloqueador 1: identidade EFETIVA (contato/telefone) do
//    paciente de "numero proprio" chega a persistencia E a reserva ─────────

test('numero proprio + paciente EXISTENTE no destino, com correcao cadastral: UPDATE e reserva usam o contato/telefone DELE, nunca os do Carlos', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const proc = tabelas.procedimentos_catalogo[0].id as string;
  const dent = (tabelas.clinicas[0].dentistas as Record<string, unknown>[])[0].id as string;

  const contatoCarlos = semearContato(tabelas, clinicaId);
  const carlosId = semearPaciente(tabelas, clinicaId, contatoCarlos, { nome: 'Carlos', vinculo: 'titular' });

  // Marta ja e titular do PROPRIO contato (telefone dela), com cadastro
  // INCOMPLETO -- falta CPF. Nenhuma relacao com o contato do Carlos.
  const contatoMarta = semearContato(tabelas, clinicaId, TELEFONE_MARTA);
  const martaId = semearPaciente(
    tabelas,
    clinicaId,
    contatoMarta,
    { nome: 'Marta Souza', vinculo: 'titular', data_nascimento: '1950-07-07' },
    TELEFONE_MARTA
  );

  // Conversa do Carlos: fluxo "numero proprio" ja resolveu para a Marta
  // existente (selecao cross-contato gravada), procedimento/data ja dados,
  // horario ja proposto. ESTE turno traz o CPF que faltava + "sim".
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {
      vinculo_novo_paciente: 'numero_proprio',
      telefone_novo_paciente: TELEFONE_MARTA,
      procedimento_id: proc,
      data_texto: 'hoje',
      horario_texto: '10:00',
    },
    paciente_id: martaId,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });

  const agId = crypto.randomUUID();
  const rpc = new ClienteRpcFalso({
    cappia_persistir_paciente: { data: { sucesso: true, paciente_id: martaId }, error: null },
    cappia_reservar_agendamento: {
      data: { sucesso: true, agendamento_id: agId, dentista_id: dent, duracao_min: 30, data: '2026-08-03', horario: '10:00' },
      error: null,
    },
  });
  const m = new ClienteModeloFalso([
    {
      natureza_mensagem: 'resposta',
      alteracoes: {
        cpf: { acao: 'informar', valor: '52998224725' },
        confirmacao: { acao: 'informar', valor: 'sim' },
      },
    },
  ]);
  const resultado = await processarMensagem(m, new ClienteFalso(tabelas), rpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['o CPF dela e 529.982.247-25, pode confirmar'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'reserva_criada');

  // UPDATE cadastral: por (paciente_id da Marta, contato_id DELA), telefone DELA.
  // Sem isto a RPC real recusaria com paciente_nao_encontrado.
  const upd = rpc.chamadas.find((c) => c.nome === 'cappia_persistir_paciente');
  assert.ok(upd, 'persistirPaciente deveria ter sido chamada para o UPDATE cadastral');
  assert.equal(upd!.parametros.p_paciente_id, martaId);
  assert.equal(upd!.parametros.p_contato_id, contatoMarta);
  assert.notEqual(upd!.parametros.p_contato_id, contatoCarlos);
  assert.equal(upd!.parametros.p_telefone_normalizado, TELEFONE_MARTA);
  assert.notEqual(upd!.parametros.p_telefone_normalizado, TELEFONE);
  assert.equal(upd!.parametros.p_documento, '52998224725');

  // RESERVA: paciente da Marta, telefone da Marta -- nunca o do Carlos.
  const reserva = rpc.chamadas.find((c) => c.nome === 'cappia_reservar_agendamento')!;
  assert.equal(reserva.parametros.p_paciente_id, martaId);
  assert.notEqual(reserva.parametros.p_paciente_id, carlosId);
  assert.equal(reserva.parametros.p_telefone, TELEFONE_MARTA);
  assert.notEqual(reserva.parametros.p_telefone, TELEFONE);

  // a ficha da Marta continua no contato dela; a do Carlos, intacta.
  assert.equal(tabelas.pacientes.find((p) => p.id === martaId)!.contato_id, contatoMarta);
  assert.equal(tabelas.pacientes.find((p) => p.id === carlosId)!.nome, 'Carlos');
});

// ── 3a revisao, bloqueador 2: selecao_gravada === null NAO prova que `dados`
//    e da pessoa nova -- multi-turno real ─────────────────────────────────

test('Carlos ja tinha procedimento/data PROPRIOS; ao dizer "e para minha mae" o snapshot dele NAO acompanha a mae', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const proc = tabelas.procedimentos_catalogo[0].id as string;
  const contatoId = semearContato(tabelas, clinicaId);
  const carlosId = semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });

  // Turno anterior: Carlos, unico paciente do contato, resolvido pelo
  // fallback -- `estado_conversa.paciente_id` NUNCA foi gravado (segue null).
  // Ele ja tinha dado procedimento/data DELE.
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {
      procedimento_id: proc,
      data_texto: 'quinta',
      horario_texto: '09:00',
    },
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });

  // ESTE turno: "na verdade e para minha mae" -- atendimento_para_terceiro,
  // sem paciente_id, sem nada emitido para a terceira pessoa ainda.
  const m = modelo({ natureza_mensagem: 'pedido', alteracoes: {}, atendimento_para_terceiro: true });
  const resultado = await processar(tabelas, m, 'na verdade e para a minha mae');

  // O Core pergunta o vinculo (contato so tem o titular).
  assert.equal(resultado.decisao.tipo, 'pedir_vinculo_paciente_novo');

  // E o SNAPSHOT do Carlos (procedimento/data/horario dele) JA saiu de `dados`
  // NESTE turno -- nao pode sobreviver ate o turno em que a mae for criada.
  const dados = tabelas.estado_conversa[0].dados as Record<string, unknown>;
  for (const campo of ['procedimento_id', 'data_texto', 'horario_texto']) {
    assert.ok(!(campo in dados) || dados[campo] === undefined, `${campo} (de Carlos) deveria ter sido limpo no 1o turno "para minha mae"`);
  }
  // a ficha do Carlos: intacta (nada foi aplicado a ela).
  assert.equal(tabelas.pacientes.find((p) => p.id === carlosId)!.nome, 'Carlos');
});

test('primeiro turno "para minha mae" que JA traz um campo operacional/cadastral DELA: o que o turno emitiu e preservado; so o snapshot antigo do Carlos sai', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const procCarlos = tabelas.procedimentos_catalogo[0].id as string;
  const contatoId = semearContato(tabelas, clinicaId);
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });

  // Snapshot do Carlos: procedimento + data + horario DELE.
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {
      procedimento_id: procCarlos,
      data_texto: 'quinta',
      horario_texto: '09:00',
    },
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });

  // O turno identifica o terceiro E ja traz dados DELE (a mae): um campo
  // OPERACIONAL que o snapshot do Carlos nao tinha (`periodo`) e um CADASTRAL
  // (`nome`). Ambos descrevem a mae -- a limpeza da troca tem de preserva-los.
  const m = modelo({
    natureza_mensagem: 'pedido',
    alteracoes: {
      periodo: { acao: 'informar', valor: 'manha' },
      nome: { acao: 'informar', valor: 'Marta Prado' },
    },
    atendimento_para_terceiro: true,
  });
  await processar(tabelas, m, 'e para minha mae Marta Prado, de manha');

  const dados = tabelas.estado_conversa[0].dados as Record<string, unknown>;
  // snapshot do Carlos (nao reemitido) -> limpo
  for (const campo of ['procedimento_id', 'data_texto', 'horario_texto']) {
    assert.ok(!(campo in dados) || dados[campo] === undefined, `${campo} (de Carlos) deveria ter sido limpo`);
  }
  // o que o turno emitiu para a mae -> PRESERVADO (operacional e cadastral)
  assert.equal(dados.periodo, 'manha');
  assert.equal(dados.nome, 'Marta Prado');
});

// ── 3a revisao, bloqueador 3: falha ao limpar a selecao ao concluir NAO e
//    silenciada ───────────────────────────────────────────────────────────

// Dublê que faz o UPDATE de `estado_conversa` FALHAR quando ele zera a
// selecao (`paciente_id: null`) -- exatamente a limpeza pos-conclusao. Todo
// o resto do banco funciona normalmente.
class ClienteFalsoSelecaoNaoLimpavel extends ClienteFalso {
  from(nome: string) {
    const base = super.from(nome);
    if (nome !== 'estado_conversa') return base;
    return {
      ...base,
      update: (valores: Record<string, unknown>) => {
        if (Object.prototype.hasOwnProperty.call(valores, 'paciente_id') && valores.paciente_id === null) {
          // reproduz um erro de escrita do PostgREST
          return {
            eq() {
              return this;
            },
            is() {
              return this;
            },
            select() {
              return this;
            },
            async maybeSingle() {
              return { data: null, error: { message: 'falha simulada ao limpar selecao' } };
            },
          } as unknown as ReturnType<typeof base.update>;
        }
        return base.update(valores);
      },
    };
  }
}

test('bloqueador 3: se a limpeza da selecao ao concluir FALHA, o turno NAO conclui em silencio (excecao propaga)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  const contatoId = semearContato(tabelas, clinicaId);
  const proc = tabelas.procedimentos_catalogo[0].id as string;
  const dent = (tabelas.clinicas[0].dentistas as Record<string, unknown>[])[0].id as string;
  semearPaciente(tabelas, clinicaId, contatoId, { nome: 'Carlos', vinculo: 'titular' });
  // Marta dependente do MESMO contato, ja selecionada, cadastro completo.
  const martaId = semearPaciente(tabelas, clinicaId, contatoId, {
    nome: 'Marta',
    vinculo: 'dependente',
    documento: '52998224725',
    data_nascimento: '1950-05-10',
  });
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: martaId,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });

  const rpc = new ClienteRpcFalso({
    cappia_reservar_agendamento: {
      data: { sucesso: true, agendamento_id: crypto.randomUUID(), dentista_id: dent, duracao_min: 30, data: '2026-08-03', horario: '10:00' },
      error: null,
    },
  });
  const m = new ClienteModeloFalso([
    {
      natureza_mensagem: 'resposta',
      alteracoes: {
        procedimento_id: { acao: 'informar', valor: proc },
        data_texto: { acao: 'informar', valor: 'hoje' },
        horario_texto: { acao: 'informar', valor: '10:00' },
        confirmacao: { acao: 'informar', valor: 'sim' },
      },
    },
  ]);

  await assert.rejects(
    processarMensagem(m, new ClienteFalsoSelecaoNaoLimpavel(tabelas), rpc, {
      provider: PROVIDER,
      instancia_whatsapp: INSTANCIA,
      telefone_normalizado: TELEFONE,
      mensagens_atuais: ['pode confirmar'],
      instante_atual: INSTANTE_ATUAL,
    }),
    /limpar selecao|selecao de paciente/i,
    'a falha ao zerar a selecao tem de PROPAGAR -- nunca um catch vazio'
  );

  // A selecao NAO ficou zerada (a limpeza falhou) -- e o codigo nao fingiu
  // que concluiu. Marta continua gravada; o proximo turno nao herda uma
  // conclusao silenciosa.
  assert.equal(tabelas.estado_conversa[0].paciente_id, martaId);
});
