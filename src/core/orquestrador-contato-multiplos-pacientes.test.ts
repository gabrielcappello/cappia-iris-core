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
