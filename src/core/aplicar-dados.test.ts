// Testes de unidade de aplicar-dados.ts usando o dublê ClienteFalso
// (nenhum acesso a rede ou banco real — dados sinteticos apenas em memoria).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aplicarDados } from './aplicar-dados.ts';
import { ConflitoConcorrenteError, EntradaInvalidaError } from './erros.ts';
import type { ClienteBancoDados } from './tipos.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';

const CLINICA_ID = crypto.randomUUID();
const TELEFONE = '5511999999999';

// Narrow minimo para os dados de uma linha do fake (TabelasFalsas tipa cada
// linha como Record<string, unknown> -- nunca confia que um campo seja um
// objeto sem confirmar em runtime).
function comoRegistro(valor: unknown): Record<string, unknown> {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error('dados de teste em formato inesperado (esperado objeto)');
  }
  return valor as Record<string, unknown>;
}

function semearEstado(tabelas: TabelasFalsas, dados: Record<string, unknown>, extras: Record<string, unknown> = {}) {
  const conversa = {
    id: crypto.randomUUID(),
    clinica_id: CLINICA_ID,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados,
    paciente_id: null,
    atualizado_em: new Date('2026-07-01T00:00:00.000Z').toISOString(),
    ...extras,
  };
  tabelas.estado_conversa.push(conversa);
  return conversa;
}

// Envolve o ClienteFalso para forcar deterministicamente um conflito de
// versao: na N-esima chamada a .update() em estado_conversa, muda
// atualizado_em por baixo dos panos (simulando outra chamada concorrente
// que ja escreveu), antes do update real acontecer. Usado para testar a
// releitura + nova tentativa sem depender de timing de Promise.all.
function clienteComConflitoNasPrimeirasNAtualizacoes(
  tabelas: TabelasFalsas,
  numeroDeConflitos: number
): { cliente: ClienteBancoDados; tentativasDeUpdate: () => number } {
  const real = new ClienteFalso(tabelas);
  let tentativas = 0;
  const cliente: ClienteBancoDados = {
    from(nome: string) {
      const base = real.from(nome);
      return {
        ...base,
        update: (valores: Record<string, unknown>) => {
          if (nome === 'estado_conversa') {
            tentativas++;
            if (tentativas <= numeroDeConflitos) {
              const linha = tabelas.estado_conversa[0];
              if (linha) {
                linha.atualizado_em = new Date(Date.now() + tentativas * 1000).toISOString();
              }
            }
          }
          return base.update(valores);
        },
      };
    },
  };
  return { cliente, tentativasDeUpdate: () => tentativas };
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

// --- Correcoes da revisao do Codex sobre 5324dc3 ---

test('revisao1: alteracoes ausente e rejeitado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () => aplicarDados(cliente, { ...contexto(conversa.id) } as never),
    EntradaInvalidaError
  );
});

test('revisao2: alteracoes null e rejeitado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () => aplicarDados(cliente, { ...contexto(conversa.id), alteracoes: null } as never),
    EntradaInvalidaError
  );
});

test('revisao3: alteracoes array e rejeitado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () => aplicarDados(cliente, { ...contexto(conversa.id), alteracoes: [] } as never),
    EntradaInvalidaError
  );
});

test('revisao4: valor numerico e rejeitado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () =>
      aplicarDados(cliente, {
        ...contexto(conversa.id),
        alteracoes: { nome: { acao: 'informar', valor: 42 } } as never,
      }),
    EntradaInvalidaError
  );
});

test('revisao5: valor booleano e rejeitado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () =>
      aplicarDados(cliente, {
        ...contexto(conversa.id),
        alteracoes: { nome: { acao: 'informar', valor: true } } as never,
      }),
    EntradaInvalidaError
  );
});

test('revisao6: valor array e rejeitado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () =>
      aplicarDados(cliente, {
        ...contexto(conversa.id),
        alteracoes: { nome: { acao: 'informar', valor: ['Joao'] } } as never,
      }),
    EntradaInvalidaError
  );
});

test('revisao7: valor objeto e rejeitado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  await assert.rejects(
    () =>
      aplicarDados(cliente, {
        ...contexto(conversa.id),
        alteracoes: { nome: { acao: 'informar', valor: { x: 1 } } } as never,
      }),
    EntradaInvalidaError
  );
});

test('revisao8: objeto de alteracoes vazio nao executa UPDATE', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao' });
  const cliente = new ClienteFalso(tabelas);
  const timestampAntes = tabelas.estado_conversa[0].atualizado_em;

  const resultado = await aplicarDados(cliente, { ...contexto(conversa.id), alteracoes: {} });

  assert.deepEqual(resultado.dados, { nome: 'Joao' });
  assert.deepEqual(resultado.campos_adicionados, []);
  assert.deepEqual(resultado.campos_corrigidos, []);
  assert.deepEqual(resultado.campos_removidos, []);
  assert.deepEqual(resultado.campos_preservados, []);
  assert.equal(cliente.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0);
  assert.equal(tabelas.estado_conversa[0].atualizado_em, timestampAntes, 'atualizado_em nao deve mudar');
});

test('revisao9: operacao totalmente idempotente nao executa UPDATE', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao' });
  const cliente = new ClienteFalso(tabelas);
  const timestampAntes = tabelas.estado_conversa[0].atualizado_em;

  const resultado = await aplicarDados(cliente, {
    ...contexto(conversa.id),
    alteracoes: {
      nome: { acao: 'informar', valor: 'Joao' }, // mesmo valor: idempotente
      cpf: { acao: 'remover' }, // campo inexistente: no-op
    },
  });

  assert.deepEqual(resultado.dados, { nome: 'Joao' });
  assert.equal(cliente.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0);
  assert.equal(tabelas.estado_conversa[0].atualizado_em, timestampAntes);
});

test('revisao10: remocao de campo inexistente entra em campos_preservados', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, { nome: 'Joao' });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await aplicarDados(cliente, {
    ...contexto(conversa.id),
    alteracoes: { cpf: { acao: 'remover' } },
  });

  assert.deepEqual(resultado.campos_preservados, ['cpf']);
  assert.deepEqual(resultado.campos_removidos, [], 'nunca informar remocao de algo que nao existia');
});

test('revisao11: duas chamadas concorrentes acrescentando campos diferentes preservam ambos', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  const [resultadoA, resultadoB] = await Promise.all([
    aplicarDados(cliente, { ...contexto(conversa.id), alteracoes: { nome: { acao: 'informar', valor: 'Joao' } } }),
    aplicarDados(cliente, {
      ...contexto(conversa.id),
      alteracoes: { procedimento_texto: { acao: 'informar', valor: 'limpeza' } },
    }),
  ]);

  assert.equal(resultadoA.conversa_id, conversa.id);
  assert.equal(resultadoB.conversa_id, conversa.id);
  assert.deepEqual(tabelas.estado_conversa[0].dados, { nome: 'Joao', procedimento_texto: 'limpeza' });
});

test('revisao12: concorrencia no mesmo campo nao causa substituicao silenciosa', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  await Promise.all([
    aplicarDados(cliente, { ...contexto(conversa.id), alteracoes: { nome: { acao: 'informar', valor: 'Joao' } } }),
    aplicarDados(cliente, { ...contexto(conversa.id), alteracoes: { nome: { acao: 'informar', valor: 'Maria' } } }),
  ]);

  const nomeFinal = comoRegistro(tabelas.estado_conversa[0].dados).nome;
  assert.ok(nomeFinal === 'Joao' || nomeFinal === 'Maria', 'deve ficar com um dos dois, nunca corrompido/mesclado');
});

test('revisao13: conflito de versao provoca releitura e nova tentativa', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const { cliente, tentativasDeUpdate } = clienteComConflitoNasPrimeirasNAtualizacoes(tabelas, 1);

  const resultado = await aplicarDados(cliente, {
    ...contexto(conversa.id),
    alteracoes: { nome: { acao: 'informar', valor: 'Joao' } },
  });

  assert.equal(resultado.dados.nome, 'Joao');
  assert.equal(tentativasDeUpdate(), 2, 'a primeira tentativa deve falhar por conflito e a segunda ter sucesso');
});

test('revisao14: excesso de conflitos gera erro controlado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const { cliente, tentativasDeUpdate } = clienteComConflitoNasPrimeirasNAtualizacoes(tabelas, 999);

  await assert.rejects(
    () =>
      aplicarDados(cliente, {
        ...contexto(conversa.id),
        alteracoes: { nome: { acao: 'informar', valor: 'Joao' } },
      }),
    ConflitoConcorrenteError
  );
  assert.equal(tentativasDeUpdate(), 5, 'deve respeitar o limite explicito de tentativas');
});

// --- Segunda correcao da revisao do Codex sobre 639b54b: validacao runtime dos identificadores ---

const UUID_VALIDO_EXEMPLO = '123e4567-e89b-12d3-a456-426614174000';

async function esperarRejeicaoSemAcessoAoBanco(
  tabelas: TabelasFalsas,
  cliente: ClienteFalso,
  entrada: unknown
): Promise<void> {
  const dadosAntes = JSON.parse(JSON.stringify(tabelas.estado_conversa));
  await assert.rejects(() => aplicarDados(cliente, entrada as never), EntradaInvalidaError);
  assert.equal(cliente.estatisticas.chamadasSelect['estado_conversa'] ?? 0, 0, 'nenhuma leitura deve ocorrer');
  assert.equal(cliente.estatisticas.chamadasUpdate['estado_conversa'] ?? 0, 0, 'nenhuma escrita deve ocorrer');
  assert.deepEqual(tabelas.estado_conversa, dadosAntes, 'nada deve ser persistido');
}

const VALORES_INVALIDOS_GENERICOS: Array<{ nome: string; valor: unknown }> = [
  { nome: 'ausente (undefined)', valor: undefined },
  { nome: 'null', valor: null },
  { nome: 'numero', valor: 42 },
  { nome: 'boolean', valor: true },
  { nome: 'objeto', valor: { x: 1 } },
  { nome: 'array', valor: ['a'] },
  { nome: 'string vazia', valor: '   ' },
];

for (const campo of ['conversa_id', 'clinica_id', 'telefone_normalizado'] as const) {
  for (const caso of VALORES_INVALIDOS_GENERICOS) {
    test(`revisao15: ${campo} ${caso.nome} e rejeitado com EntradaInvalidaError, sem TypeError e sem acesso ao banco`, async () => {
      const tabelas = criarTabelasFalsasVazias();
      const conversa = semearEstado(tabelas, {});
      const cliente = new ClienteFalso(tabelas);

      const entrada = {
        ...contexto(conversa.id),
        alteracoes: { nome: { acao: 'informar', valor: 'Joao' } },
        [campo]: caso.valor,
      };

      await esperarRejeicaoSemAcessoAoBanco(tabelas, cliente, entrada);
    });
  }
}

test('revisao16: UUID invalido para conversa_id e rejeitado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  const entrada = {
    ...contexto(conversa.id),
    conversa_id: 'nao-e-um-uuid',
    alteracoes: { nome: { acao: 'informar', valor: 'Joao' } },
  };

  await esperarRejeicaoSemAcessoAoBanco(tabelas, cliente, entrada);
});

test('revisao17: UUID invalido para clinica_id e rejeitado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = semearEstado(tabelas, {});
  const cliente = new ClienteFalso(tabelas);

  const entrada = {
    ...contexto(conversa.id),
    clinica_id: 'nao-e-um-uuid',
    alteracoes: { nome: { acao: 'informar', valor: 'Joao' } },
  };

  await esperarRejeicaoSemAcessoAoBanco(tabelas, cliente, entrada);
});

const TELEFONES_INVALIDOS: Array<{ nome: string; valor: string }> = [
  { nome: 'sem prefixo 55', valor: '11999999999' },
  { nome: 'com pontuacao', valor: '+55 11 99999-9999' },
  { nome: 'curto', valor: '5511999' },
  { nome: 'longo', valor: '55119999999999' },
];

for (const caso of TELEFONES_INVALIDOS) {
  test(`revisao18: telefone_normalizado ${caso.nome} e rejeitado`, async () => {
    const tabelas = criarTabelasFalsasVazias();
    const conversa = semearEstado(tabelas, {});
    const cliente = new ClienteFalso(tabelas);

    const entrada = {
      ...contexto(conversa.id),
      telefone_normalizado: caso.valor,
      alteracoes: { nome: { acao: 'informar', valor: 'Joao' } },
    };

    await esperarRejeicaoSemAcessoAoBanco(tabelas, cliente, entrada);
  });
}

test('revisao19: identificadores validos continuam funcionando normalmente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const conversa = {
    id: UUID_VALIDO_EXEMPLO,
    clinica_id: crypto.randomUUID(),
    telefone_normalizado: '5511988887777',
    estado: 'atendimento',
    dados: {},
    paciente_id: null,
    atualizado_em: new Date('2026-07-01T00:00:00.000Z').toISOString(),
  };
  tabelas.estado_conversa.push(conversa);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await aplicarDados(cliente, {
    conversa_id: conversa.id,
    clinica_id: conversa.clinica_id,
    telefone_normalizado: conversa.telefone_normalizado,
    alteracoes: { nome: { acao: 'informar', valor: 'Joao' } },
  });

  assert.equal(resultado.conversa_id, conversa.id);
  assert.deepEqual(resultado.dados, { nome: 'Joao' });
  assert.deepEqual(resultado.campos_adicionados, ['nome']);
});
