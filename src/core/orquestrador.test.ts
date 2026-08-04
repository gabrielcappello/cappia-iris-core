import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import type { CatalogoClinica } from './orquestrador-tipos.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';

function semearClinica(tabelas: TabelasFalsas): string {
  const clinicaId = crypto.randomUUID();
  tabelas.clinicas.push({ id: clinicaId, provider: PROVIDER, instancia_whatsapp: INSTANCIA });
  return clinicaId;
}

// identificarConversa so cria a linha (upsert) quando nenhuma existe ainda;
// o dublê de banco nao simula default de coluna, entao semeamos aqui com
// atualizado_em ja preenchido -- mesmo padrao de interpretar-e-aplicar.test.ts.
function semearConversa(tabelas: TabelasFalsas, clinicaId: string) {
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
}

function catalogoBase(clinicaId: string): CatalogoClinica {
  return { procedimentos: [], aliasesProcedimento: [], dentistas: [], vinculos: [], configuracoesDuracao: [] };
}

test('procedimento nao resolvido: orquestrador para em aguardando_procedimento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  semearConversa(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ alteracoes: {} }]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['oi'],
    catalogo: catalogoBase(clinicaId),
  });

  assert.equal(resultado.clinica_id, clinicaId);
  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
  if (resultado.decisao.tipo === 'aguardando_procedimento') {
    assert.deepEqual(resultado.decisao.resultado, { tipo: 'nao_resolvido', motivo: 'texto_ausente' });
  }
});

test('procedimento + dentista unico apto + duracao configurada: pronto_para_horario', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  semearConversa(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    { alteracoes: { procedimento_texto: { acao: 'informar', valor: 'limpeza' } } },
  ]);

  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const catalogo: CatalogoClinica = {
    procedimentos: [
      { procedimento_id: procedimentoId, clinica_id: clinicaId, nome_pt: 'Limpeza', ativo: true, eh_consulta_avaliacao: false },
    ],
    aliasesProcedimento: [{ clinica_id: clinicaId, procedimento_id: procedimentoId, texto: 'limpeza', ativo: true }],
    dentistas: [
      {
        dentista_id: dentistaId,
        clinica_id: clinicaId,
        nome_exibido: 'Dra. Ana',
        nome_completo_resolucao: 'Ana Souza',
        nome_curto_resolucao: 'Ana',
        ativo: true,
      },
    ],
    vinculos: [{ clinica_id: clinicaId, dentista_id: dentistaId, procedimento_id: procedimentoId, ativo: true }],
    configuracoesDuracao: [{ clinica_id: clinicaId, procedimento_id: procedimentoId, duracao_min: 30 }],
  };

  const resultado = await processarMensagem(clienteModelo, clienteBanco, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar uma limpeza'],
    catalogo,
  });

  assert.deepEqual(resultado.decisao, {
    tipo: 'pronto_para_horario',
    procedimento_id: procedimentoId,
    dentista_id: dentistaId,
    duracao_min: 30,
  });
});

test('alias ambiguo no catalogo: erro_catalogo_procedimento, nunca aguardando_procedimento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  semearConversa(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    { alteracoes: { procedimento_texto: { acao: 'informar', valor: 'limpeza' } } },
  ]);

  const procedimentoId1 = crypto.randomUUID();
  const procedimentoId2 = crypto.randomUUID();
  const catalogo: CatalogoClinica = {
    procedimentos: [
      { procedimento_id: procedimentoId1, clinica_id: clinicaId, nome_pt: 'Limpeza', ativo: true, eh_consulta_avaliacao: false },
      { procedimento_id: procedimentoId2, clinica_id: clinicaId, nome_pt: 'Limpeza 2', ativo: true, eh_consulta_avaliacao: false },
    ],
    // mesmo texto normalizado apontando para dois procedimento_id distintos.
    aliasesProcedimento: [
      { clinica_id: clinicaId, procedimento_id: procedimentoId1, texto: 'limpeza', ativo: true },
      { clinica_id: clinicaId, procedimento_id: procedimentoId2, texto: 'limpeza', ativo: true },
    ],
    dentistas: [],
    vinculos: [],
    configuracoesDuracao: [],
  };

  const resultado = await processarMensagem(clienteModelo, clienteBanco, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar uma limpeza'],
    catalogo,
  });

  assert.equal(resultado.decisao.tipo, 'erro_catalogo_procedimento');
  if (resultado.decisao.tipo === 'erro_catalogo_procedimento') {
    assert.equal(resultado.decisao.resultado.tipo, 'erro_catalogo');
  }
});

test('dois dentistas aptos, sem preferencia: aguardando_escolha_dentista', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  semearConversa(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    { alteracoes: { procedimento_texto: { acao: 'informar', valor: 'limpeza' } } },
  ]);

  const procedimentoId = crypto.randomUUID();
  const dentista1 = crypto.randomUUID();
  const dentista2 = crypto.randomUUID();
  const catalogo: CatalogoClinica = {
    procedimentos: [
      { procedimento_id: procedimentoId, clinica_id: clinicaId, nome_pt: 'Limpeza', ativo: true, eh_consulta_avaliacao: false },
    ],
    aliasesProcedimento: [{ clinica_id: clinicaId, procedimento_id: procedimentoId, texto: 'limpeza', ativo: true }],
    dentistas: [
      {
        dentista_id: dentista1,
        clinica_id: clinicaId,
        nome_exibido: 'Dra. Ana',
        nome_completo_resolucao: 'Ana Souza',
        nome_curto_resolucao: 'Ana',
        ativo: true,
      },
      {
        dentista_id: dentista2,
        clinica_id: clinicaId,
        nome_exibido: 'Dr. Bruno',
        nome_completo_resolucao: 'Bruno Lima',
        nome_curto_resolucao: 'Bruno',
        ativo: true,
      },
    ],
    vinculos: [
      { clinica_id: clinicaId, dentista_id: dentista1, procedimento_id: procedimentoId, ativo: true },
      { clinica_id: clinicaId, dentista_id: dentista2, procedimento_id: procedimentoId, ativo: true },
    ],
    configuracoesDuracao: [{ clinica_id: clinicaId, procedimento_id: procedimentoId, duracao_min: 30 }],
  };

  const resultado = await processarMensagem(clienteModelo, clienteBanco, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar uma limpeza'],
    catalogo,
  });

  assert.equal(resultado.decisao.tipo, 'aguardando_escolha_dentista');
  if (resultado.decisao.tipo === 'aguardando_escolha_dentista') {
    const ids = resultado.decisao.dentistas.map((d) => d.dentista_id).sort();
    assert.deepEqual(ids, [dentista1, dentista2].sort());
  }
});
