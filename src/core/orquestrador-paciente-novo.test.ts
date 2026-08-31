// Recomendacao de avaliacao para paciente novo (specs/recomendacao-
// avaliacao-paciente-novo-v1.md). Fato do turno `paciente_novo_na_clinica`,
// mesmo padrao de orquestrador-consulta-agendamento.test.ts: o foco e o FATO
// entregue a redatora, nunca uma decisao nova -- esta spec nao cria nenhuma.
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
        fim: '18:00',
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

function semearAgendamento(
  tabelas: TabelasFalsas,
  overrides: { clinica_id: string; paciente_id: string; status: string }
) {
  tabelas.agendamentos.push({
    id: crypto.randomUUID(),
    dentista_nome: 'Dra. Ana',
    procedimento: 'Limpeza',
    data: '2026-01-01',
    horario: '10:00',
    ...overrides,
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

// Paciente ja cadastrado nao recebe recomendacao automatica de avaliacao.
test('paciente cadastrado, mesmo sem agendamento: fato ausente em saudacao', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId);

  const resultado = await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('oi')
  );

  assert.ok(!('paciente_novo_na_clinica' in resultado));
});

test('primeiro turno: tratamento chega a redatora, mas nao a interpretadora, sem autorizar avaliacao', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId, procedimentoId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId);

  const modelo = new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]);
  const rpc = new ClienteRpcFalso({
    iris_nova_tratamentos_aprovados: {
      data: [{ descricao: 'Limpeza', procedimento_id: procedimentoId, para_agendar: true }],
      error: null,
    },
  });

  const resultado = await processarMensagem(
    modelo,
    new ClienteFalso(tabelas),
    rpc,
    entrada('ola, bom dia')
  );

  assert.equal(resultado.decisao.tipo, 'saudacao');
  assert.equal(resultado.tratamentos_aprovados?.length, 1);
  assert.ok(
    !('tratamentos_pendentes' in modelo.chamadas[0].payload),
    'sem historico, a interpretadora nao pode correlacionar mensagem vaga ao tratamento'
  );
  assert.equal(
    rpc.chamadas.filter((chamada) => chamada.nome === 'iris_nova_tratamentos_aprovados').length,
    1,
    'a redatora faz uma unica leitura no primeiro turno'
  );
  assert.ok(!('paciente_novo_na_clinica' in resultado));
});

// Cadastro nesta clinica e a unica referencia; historico em outra clinica
// nao muda esse fato.
test('paciente cadastrado nesta clinica continua conhecido mesmo com concluido apenas em outra', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  const outraClinicaId = crypto.randomUUID();
  semearConversa(tabelas, clinicaId, pacienteId);
  semearAgendamento(tabelas, { clinica_id: outraClinicaId, paciente_id: pacienteId, status: 'concluido' });

  const resultado = await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('oi')
  );

  assert.ok(!('paciente_novo_na_clinica' in resultado));
});

// Cenario 3: paciente com concluido nesta clinica -> fato AUSENTE, nunca `false`.
test('3. paciente com concluido nesta clinica: fato ausente (nunca false)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId);
  semearAgendamento(tabelas, { clinica_id: clinicaId, paciente_id: pacienteId, status: 'concluido' });

  const resultado = await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('oi')
  );

  assert.ok(!('paciente_novo_na_clinica' in resultado));
});

// Cenario 5: decisao `desistencia` -> fato ausente, mesmo criterio de exclusao
// que `agendamentos_do_paciente` ja usa.
test('desistencia: fato ausente para paciente cadastrado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId);

  const resultado = await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'negacao', alteracoes: {} }]),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('deixa pra lá')
  );

  assert.equal(resultado.decisao.tipo, 'desistencia');
  assert.ok(!('paciente_novo_na_clinica' in resultado));
});

// `aguardando_procedimento`: uma das 4 decisoes elegiveis (spec secao 3),
// alem das 3 conversacionais ja cobertas acima.
test('paciente cadastrado, decisao aguardando_procedimento: fato ausente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId);

  // `pedido` sem alteracoes -> caminho operacional, sem procedimento_id
  // resolvido -> `aguardando_procedimento` (mesmo padrao do teste 7b de
  // orquestrador-consulta-agendamento.test.ts).
  const resultado = await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('sinto uma dor, não sei o que é')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
  assert.ok(!('paciente_novo_na_clinica' in resultado));
});

// Cenario 4 (spec secao 6): paciente novo, mas ja nomeou o procedimento --
// nao e interrompido. `procedimento_id` resolvido leva a uma decisao FORA
// das 4 elegiveis (aqui, aguardando_data_horario -- falta so data/horario),
// entao o fato nem chega a ser calculado -- prova que esta spec nao
// atrapalha quem ja sabe o que quer com uma pergunta de avaliacao.
test('4. paciente novo com procedimento ja resolvido: segue fluxo normal, sem interromper', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId, procedimentoId } = montarCenario(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId);

  const resultado = await processarMensagem(
    new ClienteModeloFalso([
      { natureza_mensagem: 'pedido', alteracoes: { procedimento_id: { acao: 'informar', valor: procedimentoId } } },
    ]),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('quero marcar uma limpeza')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_data_horario');
  assert.ok(!('paciente_novo_na_clinica' in resultado));
});

// Paciente sem ficha (`paciente.id === null`): este e o unico paciente novo
// elegivel para a recomendacao de avaliacao inicial.
//
// `identificacao.paciente.id` vem da tabela `pacientes` POR TELEFONE, nunca
// de `estado_conversa.paciente_id` -- por isso o telefone usado aqui e um
// que nao tem ficha nenhuma (mesmo padrao do teste 6 de
// orquestrador-consulta-agendamento.test.ts).
// INVERTIDO em 2026-08-31 (specs/recomendacao-avaliacao-paciente-novo-v1.md
// secao 8). Ate 30/08 este teste EXIGIA `paciente_novo_na_clinica === true`
// para um telefone sem ficha. Essa era exatamente a inferencia revogada:
// cadastro local ausente NAO prova primeira visita -- o caso mais comum e o
// paciente que ja e cliente da clinica, com ficha no sistema anterior ainda
// nao sincronizado.
//
// Agora o teste guarda a regra nova: o fato nao pode existir em NENHUMA
// hipotese. Se alguem reintroduzir a derivacao, este teste falha.
test('telefone sem cadastro: NAO produz fato de paciente novo (inferencia revogada)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);

  const resultado = await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    {
      provider: PROVIDER,
      instancia_whatsapp: INSTANCIA,
      telefone_normalizado: '5511900000009',
      mensagens_atuais: ['oi'],
      instante_atual: INSTANTE_ATUAL,
    }
  );

  assert.ok(!('paciente_novo_na_clinica' in resultado));
});

// --- Regra vigente desde 2026-08-31 -------------------------------------
// specs/recomendacao-avaliacao-paciente-novo-v1.md secao 8.
//
// Guardas contra o retorno da inferencia revogada. Cada teste varia UMA
// variavel e assere a coexistencia dos dois lados, para nao repetir o
// defeito de teste de controle que varia duas coisas ao mesmo tempo.

// PAR A/B DA SAUDACAO -- a lacuna que nao existia antes. O fato de cadastro
// ausente nao pode aparecer numa saudacao simples, com ou sem ficha. Aqui a
// UNICA variavel e a existencia de cadastro.
test('saudacao A/B: com ou sem cadastro, nenhum fato de paciente novo e produzido', async () => {
  async function saudar(telefone: string) {
    const tabelas = criarTabelasFalsasVazias();
    montarCenario(tabelas);
    return await processarMensagem(
      new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]),
      new ClienteFalso(tabelas),
      clienteRpcNuncaChamado(),
      {
        provider: PROVIDER,
        instancia_whatsapp: INSTANCIA,
        telefone_normalizado: telefone,
        mensagens_atuais: ['bom dia'],
        instante_atual: INSTANTE_ATUAL,
      }
    );
  }

  // A: telefone SEM ficha. B: o telefone do cenario, COM ficha.
  const semCadastro = await saudar('5511900000009');
  const comCadastro = await saudar(TELEFONE);

  // Os dois lados coexistem e concordam: o fato nao existe em nenhum deles.
  assert.ok(!('paciente_novo_na_clinica' in semCadastro));
  assert.ok(!('paciente_novo_na_clinica' in comCadastro));
  // E a saudacao continua sendo uma saudacao nos dois casos.
  assert.equal(semCadastro.decisao.tipo, 'saudacao');
  assert.equal(comCadastro.decisao.tipo, 'saudacao');
});

// "Procedimento ainda nao informado" NAO equivale a "nao sabe o
// procedimento": mesmo em aguardando_procedimento, cadastro ausente nao
// pode virar fato de primeira visita.
test('aguardando_procedimento sem cadastro: nenhum fato de paciente novo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);

  const resultado = await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    {
      provider: PROVIDER,
      instancia_whatsapp: INSTANCIA,
      telefone_normalizado: '5511900000009',
      mensagens_atuais: ['queria marcar uma consulta'],
      instante_atual: INSTANTE_ATUAL,
    }
  );

  assert.ok(!('paciente_novo_na_clinica' in resultado));
});
