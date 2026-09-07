// Testes de unidade de identificacao.ts usando o dublê ClienteFalso
// (nenhum acesso a rede ou banco real — dados sinteticos apenas em memoria).
//
// MODELO NOVO (specs/contato-multiplos-pacientes-v1.md, 2026-09-07): a
// identidade do CONTATO de WhatsApp (quem conversa) e separada da identidade
// do PACIENTE (para quem e o atendimento). `identificarConversa` resolve o
// contato por `(clinica_id, telefone_normalizado)`, lista os pacientes
// vinculados a esse contato, e resolve `paciente.id` a partir de:
//   1. a selecao ja gravada em `estado_conversa.paciente_id`, quando ainda
//      aponta para um vinculo valido do contato;
//   2. o unico paciente do contato, quando ha exatamente um;
//   3. `null` caso contrario (0, ou >1 sem selecao valida).
//
// O teste 7 (concorrencia) prova, no nivel do codigo, que duas chamadas
// entrelaçadas resultam em uma unica linha de estado_conversa. A garantia
// no banco real ja foi verificada via SQL direto em
// 20260729_iris_nova_identificacao_v1.sql (teste 8) e reconfirmada em
// 20260729_iris_nova_identificacao_v1_correcao.sql.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClinicaNaoEncontradaError, EntradaInvalidaError } from './erros.ts';
import { gravarSelecaoPaciente, identificarConversa } from './identificacao.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA_A = 'unit-clinica-a';
const INSTANCIA_B = 'unit-clinica-b';
const TELEFONE_VALIDO = '5511999999999';
const TELEFONE_OUTRO = '5511888888888';

function semearClinica(tabelas: TabelasFalsas, instanciaWhatsapp: string) {
  const clinica = { id: crypto.randomUUID(), provider: PROVIDER, instancia_whatsapp: instanciaWhatsapp };
  tabelas.clinicas.push(clinica);
  return clinica;
}

function semearContato(tabelas: TabelasFalsas, clinicaId: string, telefoneNormalizado: string) {
  const contato = { id: crypto.randomUUID(), clinica_id: clinicaId, telefone_normalizado: telefoneNormalizado };
  tabelas.contatos_whatsapp.push(contato);
  return contato;
}

function semearEstadoConversa(
  tabelas: TabelasFalsas,
  clinicaId: string,
  telefoneNormalizado: string,
  estado: string,
  pacienteId: string | null
) {
  const conversa = {
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: telefoneNormalizado,
    estado,
    dados: {},
    paciente_id: pacienteId,
    // `not null default now()` no schema real -- toda linha semeada precisa
    // te-lo, como teria vindo do banco.
    atualizado_em: new Date().toISOString(),
  };
  tabelas.estado_conversa.push(conversa);
  return conversa;
}

function semearPaciente(
  tabelas: TabelasFalsas,
  clinicaId: string,
  contatoId: string,
  telefoneNormalizado: string,
  extra: Record<string, unknown> = {}
) {
  const paciente = {
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    contato_id: contatoId,
    telefone_normalizado: telefoneNormalizado,
    nome: 'Paciente Sintetico',
    vinculo: 'titular',
    ...extra,
  };
  tabelas.pacientes.push(paciente);
  return paciente;
}

/** Semeia contato + 1 paciente titular (o caso 1 telefone = 1 paciente). */
function semearContatoComTitular(
  tabelas: TabelasFalsas,
  clinicaId: string,
  telefoneNormalizado: string,
  extra: Record<string, unknown> = {}
) {
  const contato = semearContato(tabelas, clinicaId, telefoneNormalizado);
  const paciente = semearPaciente(tabelas, clinicaId, contato.id, telefoneNormalizado, extra);
  return { contato, paciente };
}

test('teste1: clinica existente e contato com 1 paciente resolve esse paciente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const { paciente } = semearContatoComTitular(tabelas, clinica.id, TELEFONE_VALIDO);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(resultado.clinica_id, clinica.id);
  assert.equal(resultado.paciente.encontrado, true);
  assert.equal(resultado.paciente.id, paciente.id);
  assert.equal(resultado.pacientes.length, 1);
  assert.equal(resultado.pacientes[0].vinculo, 'titular');
  assert.equal(resultado.conversa.estado, 'atendimento');
});

test('teste2: contato sem nenhum paciente -> paciente.id null, lista vazia', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(resultado.paciente.encontrado, false);
  assert.equal(resultado.paciente.id, null);
  assert.deepEqual(resultado.pacientes, []);
  assert.equal(tabelas.pacientes.length, 0, 'nenhum paciente deve ser criado durante a identificacao');
  // o contato E criado (spec secao 5.1: "resolver/criar")
  assert.equal(tabelas.contatos_whatsapp.length, 1);
});

test('teste3: clinica inexistente e rejeitada de forma controlada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () =>
      identificarConversa(cliente, {
        provider: PROVIDER,
        instancia_whatsapp: 'instancia-nunca-cadastrada',
        telefone_normalizado: TELEFONE_VALIDO,
      }),
    ClinicaNaoEncontradaError
  );
});

test('teste4: telefone fora do formato brasileiro canonico e rejeitado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, INSTANCIA_A);
  const cliente = new ClienteFalso(tabelas);

  const casosInvalidos = ['11999999999', '5511999', '551199999999999', '+55 11 99999-9999'];
  for (const telefone of casosInvalidos) {
    await assert.rejects(
      () =>
        identificarConversa(cliente, {
          provider: PROVIDER,
          instancia_whatsapp: INSTANCIA_A,
          telefone_normalizado: telefone,
        }),
      EntradaInvalidaError
    );
  }
});

test('teste5: cria o estado quando ainda nao existe', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, INSTANCIA_A);
  const cliente = new ClienteFalso(tabelas);

  assert.equal(tabelas.estado_conversa.length, 0);
  const resultado = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(tabelas.estado_conversa.length, 1);
  assert.equal(resultado.conversa.id, tabelas.estado_conversa[0].id);
  assert.deepEqual(resultado.conversa.dados, {});
  // estado recem-criado nasce SEM selecao (spec secao 4.4)
  assert.equal(tabelas.estado_conversa[0].paciente_id, null);
});

test('teste6: reutiliza o mesmo estado e o mesmo contato em uma nova chamada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, INSTANCIA_A);
  const cliente = new ClienteFalso(tabelas);

  const entrada = { provider: PROVIDER, instancia_whatsapp: INSTANCIA_A, telefone_normalizado: TELEFONE_VALIDO };
  const primeira = await identificarConversa(cliente, entrada);
  const segunda = await identificarConversa(cliente, entrada);

  assert.equal(primeira.conversa.id, segunda.conversa.id);
  assert.equal(primeira.contato_id, segunda.contato_id);
  assert.equal(tabelas.estado_conversa.length, 1);
  assert.equal(tabelas.contatos_whatsapp.length, 1);
});

test('teste7: duas chamadas concorrentes nao criam dois estados nem dois contatos', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, INSTANCIA_A);
  const cliente = new ClienteFalso(tabelas);

  const entrada = { provider: PROVIDER, instancia_whatsapp: INSTANCIA_A, telefone_normalizado: TELEFONE_VALIDO };
  const [resultadoA, resultadoB] = await Promise.all([
    identificarConversa(cliente, entrada),
    identificarConversa(cliente, entrada),
  ]);

  assert.equal(tabelas.estado_conversa.length, 1, 'deve existir somente uma linha de estado para a conversa');
  assert.equal(tabelas.contatos_whatsapp.length, 1, 'deve existir somente um contato para o telefone');
  assert.equal(resultadoA.conversa.id, resultadoB.conversa.id);
  assert.equal(resultadoA.contato_id, resultadoB.contato_id);
});

test('teste8: mesmo telefone em clinicas diferentes permanece isolado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaA = semearClinica(tabelas, INSTANCIA_A);
  const clinicaB = semearClinica(tabelas, INSTANCIA_B);
  const cliente = new ClienteFalso(tabelas);

  const resultadoA = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });
  const resultadoB = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_B,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.notEqual(resultadoA.conversa.id, resultadoB.conversa.id);
  assert.notEqual(resultadoA.contato_id, resultadoB.contato_id);
  assert.equal(resultadoA.clinica_id, clinicaA.id);
  assert.equal(resultadoB.clinica_id, clinicaB.id);
  assert.equal(tabelas.estado_conversa.length, 2);
  assert.equal(tabelas.contatos_whatsapp.length, 2);
});

test('teste9: contato com varios pacientes e sem selecao -> paciente.id null, lista completa', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const contato = semearContato(tabelas, clinica.id, TELEFONE_VALIDO);
  semearPaciente(tabelas, clinica.id, contato.id, TELEFONE_VALIDO, { nome: 'Carlos', vinculo: 'titular' });
  semearPaciente(tabelas, clinica.id, contato.id, TELEFONE_VALIDO, { nome: 'Marta', vinculo: 'dependente' });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(resultado.paciente.id, null, 'sem selecao e com >1 paciente, nao resolve sozinho');
  assert.equal(resultado.pacientes.length, 2);
  assert.deepEqual(
    resultado.pacientes.map((p) => p.nome).sort(),
    ['Carlos', 'Marta']
  );
});

test('teste10: contato com varios pacientes e selecao valida -> resolve o selecionado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const contato = semearContato(tabelas, clinica.id, TELEFONE_VALIDO);
  semearPaciente(tabelas, clinica.id, contato.id, TELEFONE_VALIDO, { nome: 'Carlos', vinculo: 'titular' });
  const marta = semearPaciente(tabelas, clinica.id, contato.id, TELEFONE_VALIDO, {
    nome: 'Marta',
    vinculo: 'dependente',
  });
  // estado_conversa ja tem a Marta selecionada
  semearEstadoConversa(tabelas, clinica.id, TELEFONE_VALIDO, 'atendimento', marta.id);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(resultado.paciente.id, marta.id);
  assert.equal(resultado.paciente.cadastro.nome, 'Marta');
});

test('teste11: selecao que aponta para paciente de OUTRO contato e ignorada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  // contato desta conversa: Carlos e Marta
  const contatoConversa = semearContato(tabelas, clinica.id, TELEFONE_VALIDO);
  semearPaciente(tabelas, clinica.id, contatoConversa.id, TELEFONE_VALIDO, { nome: 'Carlos', vinculo: 'titular' });
  semearPaciente(tabelas, clinica.id, contatoConversa.id, TELEFONE_VALIDO, { nome: 'Marta', vinculo: 'dependente' });
  // paciente de OUTRO contato (outro telefone)
  const outroContato = semearContato(tabelas, clinica.id, TELEFONE_OUTRO);
  const forasteiro = semearPaciente(tabelas, clinica.id, outroContato.id, TELEFONE_OUTRO, {
    nome: 'Forasteiro',
    vinculo: 'titular',
  });
  // estado_conversa desta conversa aponta (indevidamente) para o forasteiro
  semearEstadoConversa(tabelas, clinica.id, TELEFONE_VALIDO, 'atendimento', forasteiro.id);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  // a selecao invalida NAO resolve; e ha >1 no contato, entao fica null
  assert.equal(resultado.paciente.id, null);
  assert.deepEqual(
    resultado.pacientes.map((p) => p.nome).sort(),
    ['Carlos', 'Marta']
  );
});

test('teste12: selecao obsoleta com contato de 1 paciente cai no unico paciente do contato', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const { paciente } = semearContatoComTitular(tabelas, clinica.id, TELEFONE_VALIDO, { nome: 'Titular' });
  // selecao aponta para um id que nao existe mais neste contato
  semearEstadoConversa(tabelas, clinica.id, TELEFONE_VALIDO, 'atendimento', crypto.randomUUID());
  const cliente = new ClienteFalso(tabelas);

  const resultado = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(resultado.paciente.id, paciente.id, 'cai no unico paciente do contato (comportamento de hoje preservado)');
});

const ESTADOS_APROVADOS = [
  'atendimento',
  'aguardando_escolha',
  'coletando_cadastro',
  'aguardando_confirmacao',
  'executando',
  'concluido',
] as const;

for (const estado of ESTADOS_APROVADOS) {
  test(`teste-estados: estado existente '${estado}' e devolvido como o valor real (sem forcar atendimento)`, async () => {
    const tabelas = criarTabelasFalsasVazias();
    const clinica = semearClinica(tabelas, INSTANCIA_A);
    semearEstadoConversa(tabelas, clinica.id, TELEFONE_VALIDO, estado, null);
    const cliente = new ClienteFalso(tabelas);

    const resultado = await identificarConversa(cliente, {
      provider: PROVIDER,
      instancia_whatsapp: INSTANCIA_A,
      telefone_normalizado: TELEFONE_VALIDO,
    });

    assert.equal(resultado.conversa.estado, estado);
    assert.equal(tabelas.estado_conversa.length, 1, 'nenhum estado novo deve ser criado quando ja existe um');
  });
}

// --- Selecao MUTAVEL (spec secao 4.4): gravarSelecaoPaciente ---
//
// A protecao write-once (`.is('paciente_id', null)`) foi removida. A selecao
// pode mudar de um assunto para outro e ser limpa (`null`) ao concluir.

test('selecao: gravarSelecaoPaciente escreve a selecao mesmo quando ja havia outra', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const contato = semearContato(tabelas, clinica.id, TELEFONE_VALIDO);
  const carlos = semearPaciente(tabelas, clinica.id, contato.id, TELEFONE_VALIDO, { nome: 'Carlos' });
  const marta = semearPaciente(tabelas, clinica.id, contato.id, TELEFONE_VALIDO, {
    nome: 'Marta',
    vinculo: 'dependente',
  });
  semearEstadoConversa(tabelas, clinica.id, TELEFONE_VALIDO, 'atendimento', carlos.id);
  const cliente = new ClienteFalso(tabelas);

  await gravarSelecaoPaciente(cliente, clinica.id, TELEFONE_VALIDO, marta.id);

  assert.equal(tabelas.estado_conversa[0].paciente_id, marta.id, 'a selecao anterior foi sobrescrita, sem write-once');
});

test('selecao: gravarSelecaoPaciente com null limpa a selecao', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const contato = semearContato(tabelas, clinica.id, TELEFONE_VALIDO);
  const carlos = semearPaciente(tabelas, clinica.id, contato.id, TELEFONE_VALIDO, { nome: 'Carlos' });
  semearEstadoConversa(tabelas, clinica.id, TELEFONE_VALIDO, 'atendimento', carlos.id);
  const cliente = new ClienteFalso(tabelas);

  await gravarSelecaoPaciente(cliente, clinica.id, TELEFONE_VALIDO, null);

  assert.equal(tabelas.estado_conversa[0].paciente_id, null);
});

// --- Cadastro do paciente carregado na identificacao (2026-08-09) ---
//
// Contrato: specs/interpretacao-ia.md ("Entrada e PII", segunda origem).
// `pacientes.documento` (coluna fisica) e lido como `cpf` (conceito de
// dominio) NESTE unico ponto de leitura. Todos os valores abaixo sao
// SINTETICOS -- nenhum dado real de paciente.

test('cadastro: paciente do contato carrega nome, cpf, nascimento e email', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  semearContatoComTitular(tabelas, clinica.id, TELEFONE_VALIDO, {
    nome: 'Idalina Prudencio Vasconcelos',
    documento: '52998224725',
    data_nascimento: '1974-03-19',
    email: 'idalina.vasconcelos@exemplo-sintetico.test',
  });

  const resultado = await identificarConversa(new ClienteFalso(tabelas), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.deepEqual(resultado.paciente.cadastro, {
    nome: 'Idalina Prudencio Vasconcelos',
    cpf: '52998224725',
    data_nascimento: '1974-03-19',
    email: 'idalina.vasconcelos@exemplo-sintetico.test',
  });
});

test('cadastro: a coluna fisica `documento` vira `cpf` no dominio, e `documento` nao vaza', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  semearContatoComTitular(tabelas, clinica.id, TELEFONE_VALIDO, {
    nome: 'Reinaldo Bittencourt',
    documento: '11144477735',
  });

  const resultado = await identificarConversa(new ClienteFalso(tabelas), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(resultado.paciente.cadastro.cpf, '11144477735');
  assert.ok(!Object.prototype.hasOwnProperty.call(resultado.paciente.cadastro, 'documento'));
});

test('cadastro: coluna nula, ausente ou so espacos vira CHAVE AUSENTE, nunca null', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  semearContatoComTitular(tabelas, clinica.id, TELEFONE_VALIDO, {
    nome: 'Osvaldina Nepomuceno',
    documento: null,
    data_nascimento: '   ',
    // `email` deliberadamente ausente da linha, nao apenas nulo.
  });

  const resultado = await identificarConversa(new ClienteFalso(tabelas), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.deepEqual(resultado.paciente.cadastro, { nome: 'Osvaldina Nepomuceno' });
  assert.deepEqual(Object.keys(resultado.paciente.cadastro), ['nome']);
});

test('cadastro: contato sem paciente devolve cadastro vazio, nunca undefined', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, INSTANCIA_A);

  const resultado = await identificarConversa(new ClienteFalso(tabelas), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(resultado.paciente.encontrado, false);
  assert.deepEqual(resultado.paciente.cadastro, {});
});

test('cadastro: isolamento por clinica -- contato/paciente de outra clinica nao carrega', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaA = semearClinica(tabelas, INSTANCIA_A);
  const clinicaB = semearClinica(tabelas, INSTANCIA_B);
  // O paciente existe SO na clinica B, com o MESMO telefone.
  semearContatoComTitular(tabelas, clinicaB.id, TELEFONE_VALIDO, {
    nome: 'Nao Deve Vazar Para A Clinica A',
    documento: '52998224725',
  });

  const resultado = await identificarConversa(new ClienteFalso(tabelas), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(resultado.clinica_id, clinicaA.id);
  assert.equal(resultado.paciente.encontrado, false);
  assert.deepEqual(resultado.paciente.cadastro, {});
  assert.deepEqual(resultado.pacientes, []);
});

test('vinculo: valor fora do vocabulario aprovado falha fechado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const contato = semearContato(tabelas, clinica.id, TELEFONE_VALIDO);
  semearPaciente(tabelas, clinica.id, contato.id, TELEFONE_VALIDO, { vinculo: 'primo' });
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () =>
      identificarConversa(cliente, {
        provider: PROVIDER,
        instancia_whatsapp: INSTANCIA_A,
        telefone_normalizado: TELEFONE_VALIDO,
      }),
    /vinculo fora do vocabulario/
  );
});
