// Teste de integracao real contra o projeto isolado cappia-iris-core-dev
// (bcmuqautblvjdqzhjfbw). Requer as variaveis de ambiente
// IRIS_NOVA_DEV_SUPABASE_URL e IRIS_NOVA_DEV_SUPABASE_SERVICE_ROLE_KEY
// (cofre canonico: .iris-secrets/cappia-iris-core-dev.env — nunca lido nem
// commitado por este codigo; carregado somente via node --env-file).
//
// Sem essas variaveis, a suite inteira e pulada (test.skip) em vez de falhar.
//
// Uso pretendido:
//   node --env-file="<caminho absoluto do .env no cofre>" --test core/aplicar-dados.integration.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { aplicarDados } from './aplicar-dados.ts';
import type { ClienteBancoDados } from './tipos.ts';

const URL = process.env.IRIS_NOVA_DEV_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.IRIS_NOVA_DEV_SUPABASE_SERVICE_ROLE_KEY;
const CREDENCIAL_DISPONIVEL = Boolean(URL && SERVICE_ROLE_KEY);

const PROVIDER = 'evolution';

async function criarClinicaEEstadoSinteticos(supabase: SupabaseClient) {
  const instanciaWhatsapp = `integracao-dados-${crypto.randomUUID()}`;
  const { data: clinica, error: erroClinica } = await supabase
    .from('clinicas')
    .insert({ provider: PROVIDER, instancia_whatsapp: instanciaWhatsapp })
    .select('id')
    .single();
  if (erroClinica) throw erroClinica;

  const telefone = '5511900000003';
  const { data: conversa, error: erroConversa } = await supabase
    .from('estado_conversa')
    .insert({
      clinica_id: clinica.id,
      telefone_normalizado: telefone,
      paciente_id: null,
      estado: 'atendimento',
      dados: {},
    })
    .select('id')
    .single();
  if (erroConversa) throw erroConversa;

  return { clinicaId: clinica.id as string, conversaId: conversa.id as string, telefone };
}

async function limpar(supabase: SupabaseClient, clinicaId: string) {
  await supabase.from('estado_conversa').delete().eq('clinica_id', clinicaId);
  await supabase.from('clinicas').delete().eq('id', clinicaId);
}

test(
  'integracao: dados sao acumulados ao longo de chamadas sucessivas, preservados e corrigidos corretamente',
  { skip: !CREDENCIAL_DISPONIVEL },
  async () => {
    const supabase = createClient(URL as string, SERVICE_ROLE_KEY as string);
    const { clinicaId, conversaId, telefone } = await criarClinicaEEstadoSinteticos(supabase);

    try {
      const contexto = { conversa_id: conversaId, clinica_id: clinicaId, telefone_normalizado: telefone };

      // 2) aplicar nome e procedimento
      await aplicarDados(supabase as unknown as ClienteBancoDados, {
        ...contexto,
        alteracoes: {
          nome: { acao: 'informar', valor: 'Joao da Silva' },
          procedimento_id: { acao: 'informar', valor: 'limpeza dental' },
        },
      });

      // 3) aplicar data e periodo em nova chamada
      const acumulado = await aplicarDados(supabase as unknown as ClienteBancoDados, {
        ...contexto,
        alteracoes: {
          data_texto: { acao: 'informar', valor: 'sexta-feira' },
          periodo: { acao: 'informar', valor: 'manha' },
        },
      });

      // 4) confirmar que os quatro valores ficaram acumulados
      assert.deepEqual(acumulado.dados, {
        nome: 'Joao da Silva',
        procedimento_id: 'limpeza dental',
        data_texto: 'sexta-feira',
        periodo: 'manha',
      });

      // 5) entrada sem nome -> nome permanece
      const semNome = await aplicarDados(supabase as unknown as ClienteBancoDados, {
        ...contexto,
        alteracoes: { horario_texto: { acao: 'informar', valor: '10h' } },
      });
      assert.equal(semNome.dados.nome, 'Joao da Silva');

      // 6) corrigir somente a data
      const corrigido = await aplicarDados(supabase as unknown as ClienteBancoDados, {
        ...contexto,
        alteracoes: { data_texto: { acao: 'corrigir', valor: 'sabado' } },
      });

      // 7) somente a data foi substituida
      assert.equal(corrigido.dados.data_texto, 'sabado');
      assert.equal(corrigido.dados.nome, 'Joao da Silva');
      assert.equal(corrigido.dados.procedimento_id, 'limpeza dental');
      assert.equal(corrigido.dados.periodo, 'manha');
      assert.equal(corrigido.dados.horario_texto, '10h');
      assert.deepEqual(corrigido.campos_corrigidos, ['data_texto']);

      // 8) estado e paciente_id nao foram alterados
      const { data: linhaFinal, error: erroFinal } = await supabase
        .from('estado_conversa')
        .select('estado, paciente_id')
        .eq('id', conversaId)
        .single();
      if (erroFinal) throw erroFinal;
      assert.equal(linhaFinal.estado, 'atendimento');
      assert.equal(linhaFinal.paciente_id, null);
    } finally {
      // 9) limpar todos os dados sinteticos
      await limpar(supabase, clinicaId);
    }
  }
);

test(
  'integracao: duas chamadas simultaneas informando campos diferentes preservam ambos, e chamada vazia nao muda atualizado_em',
  { skip: !CREDENCIAL_DISPONIVEL },
  async () => {
    const supabase = createClient(URL as string, SERVICE_ROLE_KEY as string);
    const { clinicaId, conversaId, telefone } = await criarClinicaEEstadoSinteticos(supabase);

    try {
      const contexto = { conversa_id: conversaId, clinica_id: clinicaId, telefone_normalizado: telefone };

      // 2) duas chamadas simultaneas, uma informando nome, outra procedimento_id
      const [resultadoA, resultadoB] = await Promise.all([
        aplicarDados(supabase as unknown as ClienteBancoDados, {
          ...contexto,
          alteracoes: { nome: { acao: 'informar', valor: 'Joao da Silva' } },
        }),
        aplicarDados(supabase as unknown as ClienteBancoDados, {
          ...contexto,
          alteracoes: { procedimento_id: { acao: 'informar', valor: 'limpeza dental' } },
        }),
      ]);
      assert.equal(resultadoA.conversa_id, conversaId);
      assert.equal(resultadoB.conversa_id, conversaId);

      // 3-4) consultar a linha final e confirmar que os dois campos existem
      const { data: linhas, error: erroLinhas } = await supabase
        .from('estado_conversa')
        .select('id, dados, estado, paciente_id, atualizado_em')
        .eq('clinica_id', clinicaId)
        .eq('telefone_normalizado', telefone);
      if (erroLinhas) throw erroLinhas;
      assert.deepEqual(linhas?.[0]?.dados, { nome: 'Joao da Silva', procedimento_id: 'limpeza dental' });

      // 5) confirmar que ha somente uma conversa
      assert.equal(linhas?.length, 1);

      // 6) confirmar que estado e paciente_id continuam inalterados
      assert.equal(linhas?.[0]?.estado, 'atendimento');
      assert.equal(linhas?.[0]?.paciente_id, null);

      // 7) remocao de campo inexistente
      const remocao = await aplicarDados(supabase as unknown as ClienteBancoDados, {
        ...contexto,
        alteracoes: { cpf: { acao: 'remover' } },
      });
      assert.deepEqual(remocao.campos_preservados, ['cpf']);
      assert.deepEqual(remocao.campos_removidos, []);

      // 8) confirmar que atualizado_em nao muda em chamada vazia
      const { data: linhaAntes, error: erroAntes } = await supabase
        .from('estado_conversa')
        .select('atualizado_em')
        .eq('id', conversaId)
        .single();
      if (erroAntes) throw erroAntes;
      const timestampAntes = linhaAntes.atualizado_em;

      await aplicarDados(supabase as unknown as ClienteBancoDados, { ...contexto, alteracoes: {} });

      const { data: linhaDepois, error: erroDepois } = await supabase
        .from('estado_conversa')
        .select('atualizado_em')
        .eq('id', conversaId)
        .single();
      if (erroDepois) throw erroDepois;
      assert.equal(linhaDepois.atualizado_em, timestampAntes, 'atualizado_em nao deve mudar em chamada sem efeito real');
    } finally {
      // 9) limpar todos os dados sinteticos
      await limpar(supabase, clinicaId);
    }
  }
);
