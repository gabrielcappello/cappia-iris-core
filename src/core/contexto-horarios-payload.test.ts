// Prova que `horarios_oferecidos` (specs/contexto-pendente-interpretacao-v1.md)
// chega intacto ate o corpo REAL da requisicao a OpenAI -- e que continua
// ausente quando nao ha snapshot. Nenhuma chamada de rede: o `fetch` e um
// dublê que so captura o corpo enviado.
//
// Todos os dados sao sinteticos. Nenhum valor real de paciente aqui.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarClienteModeloOpenAI, MODELO_GPT_4_1_MINI } from './cliente-modelo-openai.ts';
import { EntradaInvalidaError } from './erros.ts';
import { construirEntradaMinimizada, extrairAlteracoes } from './interpretacao-extrator.ts';
import { INSTRUCOES_EXTRATOR } from './interpretacao-instrucoes.ts';

interface CorpoCapturado {
  input: Array<{ role: string; content: string }>;
}

function criarFetchCaptor() {
  const corpos: CorpoCapturado[] = [];
  const fetchFalso = (async (_url: string, opcoes: RequestInit) => {
    corpos.push(JSON.parse(opcoes.body as string) as CorpoCapturado);
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({ natureza_mensagem: 'resposta', alteracoes: [], eventos_candidatos: [] }),
              },
            ],
          },
        ],
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;

  return { fetchFalso, corpos };
}

function cliente(fetchFalso: typeof fetch) {
  return criarClienteModeloOpenAI({
    chaveApi: 'chave-sintetica-de-teste',
    modelo: MODELO_GPT_4_1_MINI,
    fetch: fetchFalso,
    timeoutPorTentativaMs: 2000,
    prazoTotalMs: 5000,
    esperaEntreTentativasMs: 0,
  });
}

function payloadEnviado(corpo: CorpoCapturado): Record<string, unknown> {
  const mensagemUsuario = corpo.input.find((m) => m.role === 'user');
  assert.ok(mensagemUsuario, 'corpo enviado deve conter a mensagem role=user');
  return JSON.parse(mensagemUsuario.content) as Record<string, unknown>;
}

test('payload: horarios_oferecidos chega intacto e na ordem exata ate o corpo da requisicao', async () => {
  const { fetchFalso, corpos } = criarFetchCaptor();
  await extrairAlteracoes(
    cliente(fetchFalso),
    construirEntradaMinimizada(['15 hrs'], { procedimento_id: 'cleaning', data_texto: 'hoje' }, [
      '13:00',
      '14:00',
      '15:00',
    ])
  );

  assert.equal(corpos.length, 1);
  assert.deepEqual(payloadEnviado(corpos[0]).horarios_oferecidos, ['13:00', '14:00', '15:00']);
});

test('payload: a chave e OMITIDA (nao `null`, nao `[]`) quando nao ha snapshot', async () => {
  const { fetchFalso, corpos } = criarFetchCaptor();
  await extrairAlteracoes(
    cliente(fetchFalso),
    construirEntradaMinimizada(['quero uma limpeza'], { procedimento_id: 'cleaning' })
  );

  const payload = payloadEnviado(corpos[0]);
  assert.equal('horarios_oferecidos' in payload, false);
});

test('payload: o snapshot nunca contamina dados_atuais nem campos_cadastrais_preenchidos', async () => {
  const { fetchFalso, corpos } = criarFetchCaptor();
  await extrairAlteracoes(
    cliente(fetchFalso),
    construirEntradaMinimizada(['o segundo'], { procedimento_id: 'cleaning' }, ['13:00', '14:00'])
  );

  const payload = payloadEnviado(corpos[0]);
  assert.deepEqual(payload.dados_atuais, { procedimento_id: 'cleaning' });
  assert.deepEqual(payload.campos_cadastrais_preenchidos, []);
});

test('payload: entrada com horarios_oferecidos invalido e rejeitada ANTES de qualquer chamada', async () => {
  const { fetchFalso, corpos } = criarFetchCaptor();
  const clienteModelo = cliente(fetchFalso);

  const entradasInvalidas: unknown[] = [
    { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [], horarios_oferecidos: [] },
    { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [], horarios_oferecidos: 'x' },
    { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [], horarios_oferecidos: [13] },
    { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [], horarios_oferecidos: ['  '] },
  ];

  for (const entrada of entradasInvalidas) {
    await assert.rejects(() => extrairAlteracoes(clienteModelo, entrada), EntradaInvalidaError);
  }
  assert.equal(corpos.length, 0, 'nenhuma requisicao pode ter sido enviada');
});

test('payload: chave desconhecida continua rejeitada (a entrada segue FECHADA)', async () => {
  const { fetchFalso, corpos } = criarFetchCaptor();
  await assert.rejects(
    () =>
      extrairAlteracoes(cliente(fetchFalso), {
        mensagens_atuais: ['oi'],
        dados_atuais: {},
        campos_cadastrais_preenchidos: [],
        telefone: '5511999999999',
      }),
    EntradaInvalidaError
  );
  assert.equal(corpos.length, 0);
});

// --- proposta_pendente (2026-08-06, specs/resposta-conversacional-v1.md secao 5) ---

test('payload: proposta_pendente chega intacto ate o corpo da requisicao', async () => {
  const { fetchFalso, corpos } = criarFetchCaptor();
  await extrairAlteracoes(
    cliente(fetchFalso),
    construirEntradaMinimizada(['pode confirmar'], { procedimento_id: 'cleaning' }, undefined, {
      data: '05/08',
      horario: '09:00',
    })
  );

  assert.equal(corpos.length, 1);
  assert.deepEqual(payloadEnviado(corpos[0]).proposta_pendente, { data: '05/08', horario: '09:00' });
});

test('payload: proposta_pendente e OMITIDO (nao null) quando nao ha proposta em aberto', async () => {
  const { fetchFalso, corpos } = criarFetchCaptor();
  await extrairAlteracoes(cliente(fetchFalso), construirEntradaMinimizada(['quero uma limpeza'], { procedimento_id: 'cleaning' }));

  const payload = payloadEnviado(corpos[0]);
  assert.equal('proposta_pendente' in payload, false);
});

test('payload: horarios_oferecidos e proposta_pendente convivem no mesmo payload sem se misturar', async () => {
  const { fetchFalso, corpos } = criarFetchCaptor();
  await extrairAlteracoes(
    cliente(fetchFalso),
    construirEntradaMinimizada(['13:00'], { procedimento_id: 'cleaning' }, ['13:00', '14:00'], {
      data: '05/08',
      horario: '13:00',
    })
  );

  const payload = payloadEnviado(corpos[0]);
  assert.deepEqual(payload.horarios_oferecidos, ['13:00', '14:00']);
  assert.deepEqual(payload.proposta_pendente, { data: '05/08', horario: '13:00' });
});

test('payload: entrada com proposta_pendente invalida e rejeitada ANTES de qualquer chamada', async () => {
  const { fetchFalso, corpos } = criarFetchCaptor();
  const clienteModelo = cliente(fetchFalso);

  const entradasInvalidas: unknown[] = [
    { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [], proposta_pendente: 'amanha as 9' },
    { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [], proposta_pendente: { data: '05/08' } },
    { mensagens_atuais: ['oi'], dados_atuais: {}, campos_cadastrais_preenchidos: [], proposta_pendente: { data: '', horario: '09:00' } },
    {
      mensagens_atuais: ['oi'],
      dados_atuais: {},
      campos_cadastrais_preenchidos: [],
      proposta_pendente: { data: '05/08', horario: '09:00', extra: 'x' },
    },
  ];

  for (const entrada of entradasInvalidas) {
    await assert.rejects(() => extrairAlteracoes(clienteModelo, entrada), EntradaInvalidaError);
  }
  assert.equal(corpos.length, 0, 'nenhuma requisicao pode ter sido enviada');
});

test('instrucoes: a regra de confirmacao por significado depende de proposta_pendente, e ele nunca vira data_texto/horario_texto por conta propria', () => {
  assert.match(INSTRUCOES_EXTRATOR, /"proposta_pendente" estiver presente no payload/);
  assert.match(INSTRUCOES_EXTRATOR, /nunca copie proposta_pendente\.data ou proposta_pendente\.horario/);
});

test('instrucoes: a regra de horarios_oferecidos existe e nao autoriza escolha por aproximacao', () => {
  assert.match(INSTRUCOES_EXTRATOR, /Quando "horarios_oferecidos" estiver presente/);
  assert.match(INSTRUCOES_EXTRATOR, /"o segundo" escolhe o segundo item da lista/);
  assert.match(INSTRUCOES_EXTRATOR, /nunca escolha um da lista por aproximacao/);
  assert.match(INSTRUCOES_EXTRATOR, /nao fica restrita a lista/);
});
