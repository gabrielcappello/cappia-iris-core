// Teste de integracao real contra o projeto isolado cappia-iris-core-dev
// (bcmuqautblvjdqzhjfbw). Requer as variaveis de ambiente
// IRIS_NOVA_DEV_SUPABASE_URL e IRIS_NOVA_DEV_SUPABASE_SERVICE_ROLE_KEY
// (cofre canonico: .iris-secrets/cappia-iris-core-dev.env — nunca commitado).
//
// Sem essas variaveis, a suite inteira e pulada (test.skip) em vez de
// falhar — ainda nao ha SERVICE_ROLE_KEY registrada nesta etapa.
//
// Uso pretendido, quando a credencial estiver disponivel:
//   node --env-file="<caminho absoluto do .env no cofre>" --test core/identificacao.integration.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { identificarConversa } from './identificacao.ts';
import type { ClienteBancoDados } from './tipos.ts';

const URL = process.env.IRIS_NOVA_DEV_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.IRIS_NOVA_DEV_SUPABASE_SERVICE_ROLE_KEY;
const CREDENCIAL_DISPONIVEL = Boolean(URL && SERVICE_ROLE_KEY);

const PROVIDER = 'evolution';
const TELEFONE_VALIDO = '5511900000001';

async function limpar(cliente: ReturnType<typeof createClient>, clinicaIds: string[]) {
  if (clinicaIds.length === 0) return;
  await cliente.from('estado_conversa').delete().in('clinica_id', clinicaIds);
  await cliente.from('pacientes').delete().in('clinica_id', clinicaIds);
  await cliente.from('clinicas').delete().in('id', clinicaIds);
}

test('integracao: identifica clinica nova, cria estado, sem duplicar sob chamada repetida', { skip: !CREDENCIAL_DISPONIVEL }, async () => {
  const supabase = createClient(URL as string, SERVICE_ROLE_KEY as string);
  const instanciaWhatsapp = `integracao-${crypto.randomUUID()}`;
  const clinicaIdsParaLimpar: string[] = [];

  try {
    const { data: clinica, error: erroClinica } = await supabase
      .from('clinicas')
      .insert({ provider: PROVIDER, instancia_whatsapp: instanciaWhatsapp })
      .select('id')
      .single();
    if (erroClinica) throw erroClinica;
    clinicaIdsParaLimpar.push(clinica.id as string);

    const entrada = { provider: PROVIDER, instancia_whatsapp: instanciaWhatsapp, telefone_normalizado: TELEFONE_VALIDO };
    const resultado = await identificarConversa(supabase as unknown as ClienteBancoDados, entrada);

    assert.equal(resultado.clinica_id, clinica.id);
    assert.equal(resultado.paciente.encontrado, false);
    assert.equal(resultado.paciente.id, null);
    assert.equal(resultado.conversa.estado, 'atendimento');

    const segundaChamada = await identificarConversa(supabase as unknown as ClienteBancoDados, entrada);
    assert.equal(segundaChamada.conversa.id, resultado.conversa.id);

    const { count } = await supabase
      .from('estado_conversa')
      .select('id', { count: 'exact', head: true })
      .eq('clinica_id', clinica.id)
      .eq('telefone_normalizado', TELEFONE_VALIDO);
    assert.equal(count, 1);
  } finally {
    await limpar(supabase, clinicaIdsParaLimpar);
  }
});
