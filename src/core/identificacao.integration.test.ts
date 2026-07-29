// Testes de integracao reais contra o projeto isolado cappia-iris-core-dev
// (bcmuqautblvjdqzhjfbw). Requerem as variaveis de ambiente
// IRIS_NOVA_DEV_SUPABASE_URL e IRIS_NOVA_DEV_SUPABASE_SERVICE_ROLE_KEY
// (cofre canonico: .iris-secrets/cappia-iris-core-dev.env — nunca lido nem
// commitado por este codigo; carregado somente via node --env-file).
//
// Sem essas variaveis, a suite inteira e pulada (test.skip) em vez de
// falhar.
//
// Uso pretendido:
//   node --env-file="<caminho absoluto do .env no cofre>" --test core/identificacao.integration.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { identificarConversa } from './identificacao.ts';
import type { ClienteBancoDados } from './tipos.ts';

const URL = process.env.IRIS_NOVA_DEV_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.IRIS_NOVA_DEV_SUPABASE_SERVICE_ROLE_KEY;
const CREDENCIAL_DISPONIVEL = Boolean(URL && SERVICE_ROLE_KEY);

const PROVIDER = 'evolution';

async function criarClinicaSintetica(supabase: SupabaseClient) {
  const instanciaWhatsapp = `integracao-${crypto.randomUUID()}`;
  const { data, error } = await supabase
    .from('clinicas')
    .insert({ provider: PROVIDER, instancia_whatsapp: instanciaWhatsapp })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id as string, instanciaWhatsapp };
}

async function limparClinica(supabase: SupabaseClient, clinicaId: string) {
  await supabase.from('estado_conversa').delete().eq('clinica_id', clinicaId);
  await supabase.from('pacientes').delete().eq('clinica_id', clinicaId);
  await supabase.from('clinicas').delete().eq('id', clinicaId);
}

test(
  'integracao: duas chamadas simultaneas (Promise.all) resultam em um unico estado_conversa em atendimento',
  { skip: !CREDENCIAL_DISPONIVEL },
  async () => {
    const supabase = createClient(URL as string, SERVICE_ROLE_KEY as string);
    const clinica = await criarClinicaSintetica(supabase);
    const telefone = '5511900000001';

    try {
      const entrada = { provider: PROVIDER, instancia_whatsapp: clinica.instanciaWhatsapp, telefone_normalizado: telefone };
      const [resultadoA, resultadoB] = await Promise.all([
        identificarConversa(supabase as unknown as ClienteBancoDados, entrada),
        identificarConversa(supabase as unknown as ClienteBancoDados, entrada),
      ]);

      assert.equal(resultadoA.conversa.id, resultadoB.conversa.id);
      assert.equal(resultadoA.conversa.estado, 'atendimento');
      assert.equal(resultadoB.conversa.estado, 'atendimento');

      const { data: linhas, error } = await supabase
        .from('estado_conversa')
        .select('id')
        .eq('clinica_id', clinica.id)
        .eq('telefone_normalizado', telefone);
      if (error) throw error;
      assert.equal(linhas?.length, 1, 'deve existir exatamente uma linha de estado_conversa');
    } finally {
      await limparClinica(supabase, clinica.id);
    }
  }
);

test(
  'integracao: paciente criado depois do estado e vinculado em uma nova chamada',
  { skip: !CREDENCIAL_DISPONIVEL },
  async () => {
    const supabase = createClient(URL as string, SERVICE_ROLE_KEY as string);
    const clinica = await criarClinicaSintetica(supabase);
    const telefone = '5511900000002';

    try {
      const entrada = { provider: PROVIDER, instancia_whatsapp: clinica.instanciaWhatsapp, telefone_normalizado: telefone };

      // 1) primeira chamada: paciente ainda nao existe -> estado criado com paciente_id nulo.
      const primeira = await identificarConversa(supabase as unknown as ClienteBancoDados, entrada);
      assert.equal(primeira.paciente.encontrado, false);
      assert.equal(primeira.paciente.id, null);

      // 2) paciente sintetico e criado depois, para a mesma clinica + telefone.
      const { data: paciente, error: erroPaciente } = await supabase
        .from('pacientes')
        .insert({ clinica_id: clinica.id, telefone_normalizado: telefone })
        .select('id')
        .single();
      if (erroPaciente) throw erroPaciente;

      // 3) nova chamada: mesmo estado deve ser vinculado ao paciente agora existente.
      const segunda = await identificarConversa(supabase as unknown as ClienteBancoDados, entrada);
      assert.equal(segunda.conversa.id, primeira.conversa.id);
      assert.equal(segunda.paciente.encontrado, true);
      assert.equal(segunda.paciente.id, paciente.id);

      const { data: linhaFinal, error: erroFinal } = await supabase
        .from('estado_conversa')
        .select('id, paciente_id')
        .eq('clinica_id', clinica.id)
        .eq('telefone_normalizado', telefone)
        .single();
      if (erroFinal) throw erroFinal;
      assert.equal(linhaFinal.id, primeira.conversa.id);
      assert.equal(linhaFinal.paciente_id, paciente.id);
    } finally {
      await limparClinica(supabase, clinica.id);
    }
  }
);
