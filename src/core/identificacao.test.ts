// Testes de unidade de identificacao.ts usando o dublê ClienteFalso
// (nenhum acesso a rede ou banco real — dados sinteticos apenas em memoria).
//
// O teste 7 (concorrencia) prova, no nivel do codigo, que duas chamadas
// verdadeiramente entrelaçadas (Promise.all, com yields explicitos no
// dublê) resultam em uma unica linha de estado_conversa, porque o upsert
// com ignoreDuplicates + reconsulta trata corretamente o conflito. A
// garantia de que o banco real rejeita a segunda insercao concorrente ja
// foi verificada via SQL direto em 20260729_iris_nova_identificacao_v1.sql
// (teste 8) e reconfirmada em 20260729_iris_nova_identificacao_v1_correcao.sql.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClinicaNaoEncontradaError, EntradaInvalidaError } from './erros.ts';
import { identificarConversa } from './identificacao.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import type { ClienteBancoDados, ConsultaEncadeavel } from './tipos.ts';

const PROVIDER = 'evolution';
const INSTANCIA_A = 'unit-clinica-a';
const INSTANCIA_B = 'unit-clinica-b';
const TELEFONE_VALIDO = '5511999999999';

function semearClinica(tabelas: TabelasFalsas, instanciaWhatsapp: string) {
  const clinica = { id: crypto.randomUUID(), provider: PROVIDER, instancia_whatsapp: instanciaWhatsapp };
  tabelas.clinicas.push(clinica);
  return clinica;
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
  };
  tabelas.estado_conversa.push(conversa);
  return conversa;
}

function semearPaciente(tabelas: TabelasFalsas, clinicaId: string, telefoneNormalizado: string) {
  const paciente = { id: crypto.randomUUID(), clinica_id: clinicaId, telefone_normalizado: telefoneNormalizado };
  tabelas.pacientes.push(paciente);
  return paciente;
}

test('teste1: clinica existente e paciente existente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const paciente = semearPaciente(tabelas, clinica.id, TELEFONE_VALIDO);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(resultado.clinica_id, clinica.id);
  assert.equal(resultado.paciente.encontrado, true);
  assert.equal(resultado.paciente.id, paciente.id);
  assert.equal(resultado.conversa.estado, 'atendimento');
});

test('teste2: clinica existente e paciente novo', async () => {
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
  assert.equal(tabelas.pacientes.length, 0, 'nenhum paciente deve ser criado durante a identificacao');
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
});

test('teste6: reutiliza o mesmo estado em uma nova chamada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, INSTANCIA_A);
  const cliente = new ClienteFalso(tabelas);

  const entrada = { provider: PROVIDER, instancia_whatsapp: INSTANCIA_A, telefone_normalizado: TELEFONE_VALIDO };
  const primeira = await identificarConversa(cliente, entrada);
  const segunda = await identificarConversa(cliente, entrada);

  assert.equal(primeira.conversa.id, segunda.conversa.id);
  assert.equal(tabelas.estado_conversa.length, 1);
});

test('teste7: duas chamadas concorrentes nao criam dois estados', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, INSTANCIA_A);
  const cliente = new ClienteFalso(tabelas);

  const entrada = { provider: PROVIDER, instancia_whatsapp: INSTANCIA_A, telefone_normalizado: TELEFONE_VALIDO };
  const [resultadoA, resultadoB] = await Promise.all([
    identificarConversa(cliente, entrada),
    identificarConversa(cliente, entrada),
  ]);

  assert.equal(tabelas.estado_conversa.length, 1, 'deve existir somente uma linha de estado para a conversa');
  assert.equal(resultadoA.conversa.id, resultadoB.conversa.id);
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
  assert.equal(resultadoA.clinica_id, clinicaA.id);
  assert.equal(resultadoB.clinica_id, clinicaB.id);
  assert.equal(tabelas.estado_conversa.length, 2);
});

test('teste9: paciente encontrado fica vinculado ao estado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const paciente = semearPaciente(tabelas, clinica.id, TELEFONE_VALIDO);
  const cliente = new ClienteFalso(tabelas);

  await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(tabelas.estado_conversa[0].paciente_id, paciente.id);
});

test('teste10: paciente novo permanece com paciente_id nulo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, INSTANCIA_A);
  const cliente = new ClienteFalso(tabelas);

  await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(tabelas.estado_conversa[0].paciente_id, null);
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

test('teste-vinculo1: estado existente com paciente_id nulo e vinculado quando o paciente passa a existir', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const conversa = semearEstadoConversa(tabelas, clinica.id, TELEFONE_VALIDO, 'aguardando_escolha', null);
  // paciente passa a existir DEPOIS que a conversa ja estava em andamento
  const paciente = semearPaciente(tabelas, clinica.id, TELEFONE_VALIDO);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(resultado.paciente.encontrado, true);
  assert.equal(resultado.paciente.id, paciente.id);
  assert.equal(resultado.conversa.id, conversa.id, 'deve ser o mesmo estado, nao um novo');
  assert.equal(resultado.conversa.estado, 'aguardando_escolha', 'o estado nao deve ser alterado pelo vinculo');
  assert.equal(tabelas.estado_conversa.length, 1);
  assert.equal(tabelas.estado_conversa[0].paciente_id, paciente.id);
});

test('teste-vinculo2: estado com paciente_id ja preenchido nao e sobrescrito', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const paciente = semearPaciente(tabelas, clinica.id, TELEFONE_VALIDO);
  semearEstadoConversa(tabelas, clinica.id, TELEFONE_VALIDO, 'executando', paciente.id);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await identificarConversa(cliente, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_A,
    telefone_normalizado: TELEFONE_VALIDO,
  });

  assert.equal(resultado.conversa.estado, 'executando');
  assert.equal(tabelas.estado_conversa[0].paciente_id, paciente.id);
  assert.equal(
    cliente.estatisticas.chamadasUpdate['estado_conversa'] ?? 0,
    0,
    'nenhuma tentativa de atualizacao deve ocorrer quando o paciente_id ja esta preenchido'
  );
});

test('teste-vinculo3: duas chamadas concorrentes com paciente encontrado nao causam vinculo inconsistente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinica = semearClinica(tabelas, INSTANCIA_A);
  const paciente = semearPaciente(tabelas, clinica.id, TELEFONE_VALIDO);
  const conversa = semearEstadoConversa(tabelas, clinica.id, TELEFONE_VALIDO, 'coletando_cadastro', null);
  const cliente = new ClienteFalso(tabelas);

  const entrada = { provider: PROVIDER, instancia_whatsapp: INSTANCIA_A, telefone_normalizado: TELEFONE_VALIDO };
  const [resultadoA, resultadoB] = await Promise.all([
    identificarConversa(cliente, entrada),
    identificarConversa(cliente, entrada),
  ]);

  assert.equal(resultadoA.conversa.id, conversa.id);
  assert.equal(resultadoB.conversa.id, conversa.id);
  assert.equal(tabelas.estado_conversa.length, 1, 'nao pode surgir um segundo estado');
  assert.equal(tabelas.estado_conversa[0].paciente_id, paciente.id, 'o vinculo final deve ser consistente para as duas chamadas');
  assert.equal(tabelas.estado_conversa[0].estado, 'coletando_cadastro', 'o estado nao deve ser alterado pelo vinculo');
});

// Dublê minimo (nao ClienteFalso) para forcar deterministicamente a
// reconsulta apos update concorrente em vincularPacienteAoEstado: o UPDATE
// com filtro paciente_id IS NULL retorna 0 linhas (simulando outro worker ja
// tendo vinculado o paciente), e a reconsulta subsequente devolve uma linha
// estruturalmente invalida -- exercita validarLinhaEstadoConversa no unico
// caminho de estado_conversa que ainda usava cast direto.
function clienteParaReconsultaInvalida(
  clinicaId: string,
  pacienteId: string,
  conversaId: string,
  linhaReconsultaInvalida: Record<string, unknown>
): ClienteBancoDados {
  let chamadasSelectEstado = 0;

  function consultaFixa(data: Record<string, unknown> | null): ConsultaEncadeavel {
    const consulta: ConsultaEncadeavel = {
      eq: () => consulta,
      is: () => consulta,
      not: () => consulta,
      select: () => consulta,
      maybeSingle: async () => ({ data, error: null }),
      then: (onfulfilled, onrejected) => Promise.resolve({ data: data ? [data] : [], error: null }).then(onfulfilled, onrejected),
    };
    return consulta;
  }

  return {
    from(nome: string) {
      if (nome === 'clinicas') {
        return { select: () => consultaFixa({ id: clinicaId }), upsert: () => consultaFixa(null), update: () => consultaFixa(null) };
      }
      if (nome === 'pacientes') {
        return { select: () => consultaFixa({ id: pacienteId }), upsert: () => consultaFixa(null), update: () => consultaFixa(null) };
      }
      // estado_conversa: 1a select = linha existente sem paciente vinculado
      // (entra em vincularPacienteAoEstado); update com paciente_id IS NULL
      // nao encontra linha (0 linhas, simulando corrida perdida); 2a select
      // (reconsulta) devolve a linha estruturalmente invalida.
      return {
        select: () => {
          chamadasSelectEstado += 1;
          if (chamadasSelectEstado === 1) {
            return consultaFixa({ id: conversaId, estado: 'atendimento', dados: {}, paciente_id: null });
          }
          return consultaFixa(linhaReconsultaInvalida);
        },
        upsert: () => consultaFixa(null),
        update: () => consultaFixa(null),
      };
    },
  };
}

test('teste-vinculo4: reconsulta apos update concorrente com linha estruturalmente invalida e rejeitada sem reproduzir o payload', async () => {
  const clinicaId = crypto.randomUUID();
  const pacienteId = crypto.randomUUID();
  const conversaId = crypto.randomUUID();
  const estadoInvalido = 'estado_fora_do_vocabulario_canonico';
  const cliente = clienteParaReconsultaInvalida(clinicaId, pacienteId, conversaId, {
    id: conversaId,
    estado: estadoInvalido,
    dados: {},
    paciente_id: pacienteId,
  });

  await assert.rejects(
    () => identificarConversa(cliente, { provider: PROVIDER, instancia_whatsapp: INSTANCIA_A, telefone_normalizado: TELEFONE_VALIDO }),
    (erro: unknown) => {
      assert.ok(erro instanceof Error);
      assert.ok(!erro.message.includes(estadoInvalido), 'erro nao deve reproduzir o payload invalido recebido');
      return true;
    }
  );
});
