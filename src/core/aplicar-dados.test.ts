// Testes de unidade de aplicar-dados.ts usando o dublê ClienteFalso
// (nenhum acesso a rede ou banco real — dados sinteticos apenas em memoria).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aplicarDados } from './aplicar-dados.ts';
import { EntradaInvalidaError } from './erros.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';

const CLINICA_ID = crypto.randomUUID();
const TELEFONE = '5511999999999';

function semearEstado(tabelas: TabelasFalsas, dados: Record<string, unknown>, extras: Record<string, unknown> = {}) {
  const conversa = {
    id: crypto.randomUUID(),
    clinica_id: CLINICA_ID,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados,
    paciente_id: null,
    ...extras,
  };
  tabelas.estado_conversa.push(conversa);
  return conversa;
}

function contexto(conversaId: string) {
  return { conversa_id: conversaId, clinica_id: CLINICA_ID, telefone_normalizado: TELEFONE };
}

test('teste1: uma entrada acrescenta varios campos juntos', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  const resultado = await aplicarDados(cliente, {
    ...contexto(conversa.id),
    alteracoes: {
      nome: { acao: 'informar', valor: 'Joao' },
      procedimento_texto: { acao: 'informar', valor: 'limpeza' },
    },
  });

  assert.deepEqual(resultado.dados, { nome: 'Joao', procedimento_texto: 'limpeza' });
  assert.deepEqual(resultado.campos_adicionados.sort(), ['nome', 'procedimento_texto']);
  assert.deepEqual(resultado.campos_corrigidos, []);
  assert.deepEqual(resultado.campos_removidos, []);
  assert.deepEqual(resultado.campos_preservados, []);
});

test('teste2: campos podem chegar em ordens diferentes com o mesmo resultado final', async () => {
  const tabelasA = criarTabelasFalsasVazias();
  const conversaA = semearEstado(tabelasA, {});
  const resultadoA = await aplicarDados(new ClienteFalso(tabelasA), {
    ...contexto(conversaA.id),
    alteracoes: {
      nome: { acao: 'informar', valor: 'Joao' },
      data_texto: { acao: 'informar', valor: 'sexta' },
    },
  });

  const tabelasB = criarTabelasFalsasVazias();
  const conversaB = semearEstado(tabelasB, {});
  const resultadoB = await aplicarDados(new ClienteFalso(tabelasB), {
    ...contexto(conversaB.id),
    alteracoes: {
      data_texto: { acao: 'informar', valor: 'sexta' },
      nome: { acao: 'informar', valor: 'Joao' },
    },
  });

  assert.deepEqual(resultadoA.dados, resultadoB.dados);
  assert.deepEqual(resultadoA.campos_adicionados.sort(), resultadoB.campos_adicionados.sort());
});

test('teste3: mensagens sucessivas acumulam dados', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  await aplicarDados(cliente, {
    ...contexto(conversa.id),
    alteracoes: { nome: { acao: 'informar', valor: 'Joao' } },
  });
  const resultado = await aplicarDados(cliente, {
    ...contexto(conversa.id),
    alteracoes: { procedimento_texto: { acao: 'informar', valor: 'limpeza' } },
  });

  assert.deepEqual(resultado.dados, { nome: 'Joao', procedimento_texto: 'limpeza' });
});

test('teste4: campo ausente preserva o valor anterior e nao aparece nas listas', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao' });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await aplicarDados(cliente, {
    ...contexto(conversa.id),
    alteracoes: { procedimento_texto: { acao: 'informar', valor: 'limpeza' } },
  });

  assert.equal(resultado.dados.nome, 'Joao');
  assert.ok(!resultado.campos_adicionados.includes('nome'));
  assert.ok(!resultado.campos_corrigidos.includes('nome'));
  assert.ok(!resultado.campos_preservados.includes('nome'));
  assert.ok(!resultado.campos_removidos.includes('nome'));
});

test('teste5: informar novamente o mesmo valor e idempotente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao' });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await aplicarDados(cliente, {
    ...contexto(conversa.id),
    alteracoes: { nome: { acao: 'informar', valor: 'Joao' } },
  });

  assert.equal(resultado.dados.nome, 'Joao');
  assert.deepEqual(resultado.campos_preservados, ['nome']);
  assert.deepEqual(resultado.campos_adicionados, []);
  assert.deepEqual(resultado.campos_corrigidos, []);
});

test('teste6: informar valor diferente sem correcao nao substitui', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao' });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await aplicarDados(cliente, {
    ...contexto(conversa.id),
    alteracoes: { nome: { acao: 'informar', valor: 'Maria' } },
  });

  assert.equal(resultado.dados.nome, 'Joao', 'nao deve substituir silenciosamente');
  assert.deepEqual(resultado.campos_preservados, ['nome']);
  assert.deepEqual(resultado.campos_corrigidos, []);
});

test('teste7: correcao explicita substitui somente o campo indicado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao', procedimento_texto: 'limpeza' });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await aplicarDados(cliente, {
    ...contexto(conversa.id),
    alteracoes: { nome: { acao: 'corrigir', valor: 'Maria' } },
  });

  assert.equal(resultado.dados.nome, 'Maria');
  assert.equal(resultado.dados.procedimento_texto, 'limpeza');
  assert.deepEqual(resultado.campos_corrigidos, ['nome']);
});

test('teste8: remocao explicita remove somente o campo indicado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao', cpf: '11122233344' });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await aplicarDados(cliente, {
    ...contexto(conversa.id),
    alteracoes: { cpf: { acao: 'remover' } },
  });

  assert.ok(!('cpf' in resultado.dados));
  assert.equal(resultado.dados.nome, 'Joao');
  assert.deepEqual(resultado.campos_removidos, ['cpf']);
});

test('teste9: correcao preserva todos os demais dados', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const dadosIniciais = { nome: 'Joao', procedimento_texto: 'limpeza', periodo: 'manha', cpf: '11122233344' };
  const conversa = semearEstado(tabelas, { ...dadosIniciais });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await aplicarDados(cliente, {
    ...contexto(conversa.id),
    alteracoes: { data_texto: { acao: 'corrigir', valor: 'sexta-feira' } },
  });

  assert.deepEqual(resultado.dados, { ...dadosIniciais, data_texto: 'sexta-feira' });
});

test('teste10: campo desconhecido e rejeitado e nada e persistido', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao' });
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () =>
      aplicarDados(cliente, {
        ...contexto(conversa.id),
        alteracoes: { campo_invalido: { acao: 'informar', valor: 'x' } } as never,
      }),
    EntradaInvalidaError
  );
  assert.deepEqual(tabelas.estado_conversa[0].dados, { nome: 'Joao' });
});

test('teste11: acao desconhecida e rejeitada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () =>
      aplicarDados(cliente, {
        ...contexto(conversa.id),
        alteracoes: { nome: { acao: 'apagar_tudo', valor: 'x' } },
      }),
    EntradaInvalidaError
  );
});

test('teste12: periodo invalido e rejeitado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () =>
      aplicarDados(cliente, {
        ...contexto(conversa.id),
        alteracoes: { periodo: { acao: 'informar', valor: 'madrugada' } },
      }),
    EntradaInvalidaError
  );
});

test('teste13: intencao invalida e rejeitada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () =>
      aplicarDados(cliente, {
        ...contexto(conversa.id),
        alteracoes: { intencao: { acao: 'informar', valor: 'cancelamento' } },
      }),
    EntradaInvalidaError
  );
});

test('teste14: estado da conversa nao e alterado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {}, { estado: 'aguardando_escolha' });
  const cliente = new ClienteFalso(tabelas);

  await aplicarDados(cliente, {
    ...contexto(conversa.id),
    alteracoes: { nome: { acao: 'informar', valor: 'Joao' } },
  });

  assert.equal(tabelas.estado_conversa[0].estado, 'aguardando_escolha');
});

test('teste15: paciente_id nao e alterado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const pacienteId = crypto.randomUUID();
  const conversa = semearEstado(tabelas, {}, { paciente_id: pacienteId });
  const cliente = new ClienteFalso(tabelas);

  await aplicarDados(cliente, {
    ...contexto(conversa.id),
    alteracoes: { nome: { acao: 'informar', valor: 'Joao' } },
  });

  assert.equal(tabelas.estado_conversa[0].paciente_id, pacienteId);
});
