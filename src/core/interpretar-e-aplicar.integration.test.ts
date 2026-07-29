// Teste de integracao real contra o projeto isolado cappia-iris-core-dev
// (bcmuqautblvjdqzhjfbw). Usa um cliente de modelo FALSO e deterministico —
// nenhum servico real de IA e chamado aqui, isso ainda nao foi aprovado.
//
// Requer as variaveis de ambiente IRIS_NOVA_DEV_SUPABASE_URL e
// IRIS_NOVA_DEV_SUPABASE_SERVICE_ROLE_KEY (cofre canonico:
// .iris-secrets/cappia-iris-core-dev.env — nunca lido nem commitado por
// este codigo; carregado somente via node --env-file). Sem essas
// variaveis, a suite inteira e pulada (test.skip) em vez de falhar.
//
// Uso pretendido:
//   node --env-file="<caminho absoluto do .env no cofre>" --test core/interpretar-e-aplicar.integration.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { InterpretacaoInvalidaError } from './erros.ts';
import { interpretarEAplicar } from './interpretar-e-aplicar.ts';
import type { ClienteBancoDados } from './tipos.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';

const URL = process.env.IRIS_NOVA_DEV_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.IRIS_NOVA_DEV_SUPABASE_SERVICE_ROLE_KEY;
const CREDENCIAL_DISPONIVEL = Boolean(URL && SERVICE_ROLE_KEY);

const PROVIDER = 'evolution';

async function criarClinicaEConversaSinteticas(supabase: SupabaseClient) {
  const instanciaWhatsapp = `integracao-interpretacao-${crypto.randomUUID()}`;
  const { data: clinica, error: erroClinica } = await supabase
    .from('clinicas')
    .insert({ provider: PROVIDER, instancia_whatsapp: instanciaWhatsapp })
    .select('id')
    .single();
  if (erroClinica) throw erroClinica;

  const telefone = '5511900000004';
  const { data: conversa, error: erroConversa } = await supabase
    .from('estado_conversa')
    .insert({
      clinica_id: clinica.id,
      telefone_normalizado: telefone,
      paciente_id: null,
      estado: 'atendimento',
      dados: { procedimento_texto: 'limpeza' },
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
  'integracao: conflito preserva o valor acumulado, alteracao sem conflito e aplicada, e saida invalida nao muda nada',
  { skip: !CREDENCIAL_DISPONIVEL },
  async () => {
    const supabase = createClient(URL as string, SERVICE_ROLE_KEY as string);
    const { clinicaId, conversaId, telefone } = await criarClinicaEConversaSinteticas(supabase);

    try {
      const contextoBase = { conversa_id: conversaId, clinica_id: clinicaId, telefone_normalizado: telefone };

      // 3) cliente falso retorna procedimento_texto informar clareamento + data_texto informar sexta
      const clienteModelo1 = new ClienteModeloFalso([
        {
          alteracoes: {
            procedimento_texto: { acao: 'informar', valor: 'clareamento' },
            data_texto: { acao: 'informar', valor: 'sexta' },
          },
        },
      ]);

      const resultado1 = await interpretarEAplicar(clienteModelo1, supabase as unknown as ClienteBancoDados, {
        ...contextoBase,
        mensagens_atuais: ['tambem quero clareamento', 'pode ser sexta'],
        dados_atuais: { procedimento_texto: 'limpeza' },
      });

      // 4) procedimento_texto vira conflito; clareamento fica no conflito; data_texto e aplicada
      assert.equal(resultado1.conflitos.length, 1);
      assert.equal(resultado1.conflitos[0].campo, 'procedimento_texto');
      assert.equal(resultado1.conflitos[0].valor_atual, 'limpeza');
      assert.equal(resultado1.conflitos[0].valor_informado, 'clareamento');
      assert.equal(resultado1.aplicacao?.dados.data_texto, 'sexta');

      const { data: linhaApos1, error: erro1 } = await supabase
        .from('estado_conversa')
        .select('dados, estado, paciente_id')
        .eq('id', conversaId)
        .single();
      if (erro1) throw erro1;
      // limpeza permanece no estado (nao foi sobrescrita pelo conflito)
      assert.equal(linhaApos1.dados.procedimento_texto, 'limpeza');
      assert.equal(linhaApos1.dados.data_texto, 'sexta');

      // 5) estado e paciente_id intactos
      assert.equal(linhaApos1.estado, 'atendimento');
      assert.equal(linhaApos1.paciente_id, null);

      // 6) cliente falso retorna payload invalido contendo tambem um campo aparentemente valido
      const clienteModelo2 = new ClienteModeloFalso([
        {
          alteracoes: { data_texto: { acao: 'informar', valor: 'sabado' } },
          confidence: 0.95, // propriedade extra no nivel principal invalida tudo
        },
      ]);

      await assert.rejects(
        () =>
          interpretarEAplicar(clienteModelo2, supabase as unknown as ClienteBancoDados, {
            ...contextoBase,
            mensagens_atuais: ['pode ser sabado entao'],
            dados_atuais: { procedimento_texto: 'limpeza', data_texto: 'sexta' },
          }),
        InterpretacaoInvalidaError
      );

      // 7) rejeicao integral: nenhum dado alterado (nem o campo aparentemente valido)
      const { data: linhaApos2, error: erro2 } = await supabase
        .from('estado_conversa')
        .select('dados, estado, paciente_id')
        .eq('id', conversaId)
        .single();
      if (erro2) throw erro2;
      assert.deepEqual(linhaApos2.dados, { procedimento_texto: 'limpeza', data_texto: 'sexta' });
      assert.equal(linhaApos2.estado, 'atendimento');
      assert.equal(linhaApos2.paciente_id, null);
    } finally {
      // 8) limpar todos os dados sinteticos
      await limpar(supabase, clinicaId);
    }
  }
);
