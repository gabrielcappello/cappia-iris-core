// Testes de auditoria-conversas.ts (specs/auditoria-conversas-admin-v1.md).
//
// Dublê mínimo de ClienteBancoDados, só com o necessário para exercitar
// `.from('conversas_auditoria').insert(...)` e `.from('clinicas').select(...)
// .eq(...).eq(...).maybeSingle()` -- as duas únicas operações que este
// módulo realiza. Nenhuma rede real, nenhum banco real.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gravarAuditoriaSucesso, gravarAuditoriaFalha } from './auditoria-conversas.ts';
import type { ClienteBancoDados } from './tipos.ts';

type LinhaClinica = { id: string; provider: string; instancia_whatsapp: string };

class ClienteBancoDadosFalso implements ClienteBancoDados {
  linhasInseridas: Array<Record<string, unknown>> = [];
  clinicas: LinhaClinica[] = [];
  /** Quando true, qualquer operação lança -- simula falha de rede/timeout. */
  falharTudo = false;

  from(tabela: string) {
    if (tabela === 'conversas_auditoria') {
      return {
        select: () => {
          throw new Error('nao usado neste dublê');
        },
        upsert: () => {
          throw new Error('nao usado neste dublê');
        },
        update: () => {
          throw new Error('nao usado neste dublê');
        },
        insert: (valores: Record<string, unknown>) => {
          if (this.falharTudo) throw new Error('falha simulada de escrita');
          this.linhasInseridas.push(valores);
          const encadeavel = {
            eq: () => encadeavel,
            is: () => encadeavel,
            gte: () => encadeavel,
            not: () => encadeavel,
            select: () => encadeavel,
            maybeSingle: async () => ({ data: { id: 'linha-fake' }, error: null }),
          };
          return encadeavel;
        },
      } as unknown as ReturnType<ClienteBancoDados['from']>;
    }
    if (tabela === 'clinicas') {
      const clinicas = this.clinicas;
      const falharTudo = this.falharTudo;
      return {
        select: () => {
          let provider: string | undefined;
          let instancia: string | undefined;
          const encadeavel = {
            eq: (coluna: string, valor: unknown) => {
              if (coluna === 'provider') provider = valor as string;
              if (coluna === 'instancia_whatsapp') instancia = valor as string;
              return encadeavel;
            },
            is: () => encadeavel,
            gte: () => encadeavel,
            not: () => encadeavel,
            select: () => encadeavel,
            maybeSingle: async () => {
              if (falharTudo) throw new Error('falha simulada de rede');
              const achada = clinicas.find((c) => c.provider === provider && c.instancia_whatsapp === instancia);
              return { data: achada ? { id: achada.id } : null, error: null };
            },
          };
          return encadeavel;
        },
        upsert: () => {
          throw new Error('nao usado neste dublê');
        },
        update: () => {
          throw new Error('nao usado neste dublê');
        },
        insert: () => {
          throw new Error('nao usado neste dublê');
        },
      } as unknown as ReturnType<ClienteBancoDados['from']>;
    }
    throw new Error(`tabela nao esperada neste dublê: ${tabela}`);
  }
}

test('gravarAuditoriaSucesso: insere exatamente uma linha, com resultado_turno = sucesso', async () => {
  const cliente = new ClienteBancoDadosFalso();
  await gravarAuditoriaSucesso(cliente, {
    clinicaId: 'clinica-1',
    telefoneNormalizado: '5521988046011',
    mensagemPaciente: 'Olá, bom dia',
    respostaIris: 'Olá! Como posso ajudar?',
    motivoFallback: null,
  });

  assert.equal(cliente.linhasInseridas.length, 1);
  assert.deepEqual(cliente.linhasInseridas[0], {
    clinica_id: 'clinica-1',
    telefone_normalizado: '5521988046011',
    mensagem_paciente: 'Olá, bom dia',
    resposta_iris: 'Olá! Como posso ajudar?',
    motivo_fallback: null,
    resultado_turno: 'sucesso',
  });
});

test('gravarAuditoriaSucesso: motivo_fallback preservado quando o desfecho foi fallback da redatora', async () => {
  const cliente = new ClienteBancoDadosFalso();
  await gravarAuditoriaSucesso(cliente, {
    clinicaId: 'clinica-1',
    telefoneNormalizado: '5521988046011',
    mensagemPaciente: 'Quero remarcar',
    respostaIris: 'Vamos remarcar sua consulta...',
    motivoFallback: 'falha_redatora',
  });

  assert.equal(cliente.linhasInseridas[0].motivo_fallback, 'falha_redatora');
  assert.equal(cliente.linhasInseridas[0].resultado_turno, 'sucesso');
});

test('gravarAuditoriaSucesso: nunca lança, mesmo com falha de escrita (best-effort, spec 1.2.2)', async () => {
  const cliente = new ClienteBancoDadosFalso();
  cliente.falharTudo = true;

  await assert.doesNotReject(
    gravarAuditoriaSucesso(cliente, {
      clinicaId: 'clinica-1',
      telefoneNormalizado: '5521988046011',
      mensagemPaciente: 'oi',
      respostaIris: 'oi!',
      motivoFallback: null,
    })
  );
  assert.equal(cliente.linhasInseridas.length, 0);
});

test('gravarAuditoriaFalha: clinica_nao_encontrada nunca consulta clinicas -- clinica_id sempre null', async () => {
  const cliente = new ClienteBancoDadosFalso();
  cliente.clinicas.push({ id: 'clinica-1', provider: 'evolution', instancia_whatsapp: 'inst-1' });

  await gravarAuditoriaFalha(cliente, {
    provider: 'evolution',
    instanciaWhatsapp: 'inst-1',
    telefoneNormalizado: '5521988046011',
    mensagemPaciente: 'oi',
    respostaIris: null,
    resultadoTurno: 'clinica_nao_encontrada',
  });

  assert.equal(cliente.linhasInseridas.length, 1);
  assert.equal(cliente.linhasInseridas[0].clinica_id, null);
  assert.equal(cliente.linhasInseridas[0].resultado_turno, 'clinica_nao_encontrada');
});

test('gravarAuditoriaFalha: entrada_invalida com clinica real resolve clinica_id por provider+instancia (resolução best-effort)', async () => {
  const cliente = new ClienteBancoDadosFalso();
  cliente.clinicas.push({ id: 'clinica-real-1', provider: 'evolution', instancia_whatsapp: 'inst-real' });

  await gravarAuditoriaFalha(cliente, {
    provider: 'evolution',
    instanciaWhatsapp: 'inst-real',
    telefoneNormalizado: '5521988046011',
    mensagemPaciente: 'texto malformado',
    respostaIris: null,
    resultadoTurno: 'entrada_invalida',
  });

  assert.equal(cliente.linhasInseridas[0].clinica_id, 'clinica-real-1');
  assert.equal(cliente.linhasInseridas[0].resultado_turno, 'entrada_invalida');
});

test('gravarAuditoriaFalha: resposta_truncada_apos_retry preserva o texto fixo devolvido ao paciente', async () => {
  const cliente = new ClienteBancoDadosFalso();
  cliente.clinicas.push({ id: 'clinica-1', provider: 'evolution', instancia_whatsapp: 'inst-1' });
  const textoFixo = 'Tive uma dificuldade para entender sua mensagem agora. Você pode repeti-la, por favor?';

  await gravarAuditoriaFalha(cliente, {
    provider: 'evolution',
    instanciaWhatsapp: 'inst-1',
    telefoneNormalizado: '5521988046011',
    mensagemPaciente: 'mensagem qualquer',
    respostaIris: textoFixo,
    resultadoTurno: 'resposta_truncada_apos_retry',
  });

  assert.equal(cliente.linhasInseridas[0].resposta_iris, textoFixo);
});

test('gravarAuditoriaFalha: erro_interno sem clínica correspondente grava clinica_id null, nunca lança', async () => {
  const cliente = new ClienteBancoDadosFalso();
  // Nenhuma clínica cadastrada para este provider/instância -- simula o
  // caso residual descrito na spec (clínica removida, ou dado nunca existiu
  // fora do caso já coberto por 'clinica_nao_encontrada').
  await assert.doesNotReject(
    gravarAuditoriaFalha(cliente, {
      provider: 'evolution',
      instanciaWhatsapp: 'inst-desconhecida',
      telefoneNormalizado: '5521988046011',
      mensagemPaciente: 'oi',
      respostaIris: null,
      resultadoTurno: 'erro_interno',
    })
  );
  assert.equal(cliente.linhasInseridas[0].clinica_id, null);
});

test('gravarAuditoriaFalha: falha na resolução best-effort de clínica não impede a gravação da linha (best-effort, spec 1.2.2)', async () => {
  const cliente = new ClienteBancoDadosFalso();
  cliente.clinicas.push({ id: 'clinica-1', provider: 'evolution', instancia_whatsapp: 'inst-1' });
  cliente.falharTudo = true; // simula timeout tanto na consulta de clínica quanto no insert

  await assert.doesNotReject(
    gravarAuditoriaFalha(cliente, {
      provider: 'evolution',
      instanciaWhatsapp: 'inst-1',
      telefoneNormalizado: '5521988046011',
      mensagemPaciente: 'oi',
      respostaIris: null,
      resultadoTurno: 'entrada_invalida',
    })
  );
  // Com falharTudo, o insert também falha -- nenhuma linha, mas sem exceção.
  assert.equal(cliente.linhasInseridas.length, 0);
});
