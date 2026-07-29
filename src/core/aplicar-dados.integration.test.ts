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
          procedimento_texto: { acao: 'informar', valor: 'limpeza dental' },
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
        procedimento_texto: 'limpeza dental',
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
      assert.equal(corrigido.dados.procedimento_texto, 'limpeza dental');
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
