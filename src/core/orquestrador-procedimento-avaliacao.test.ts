// Teste de INTEGRACAO do fato `procedimento_avaliacao_disponivel` /
// `procedimentos_ativos_da_clinica` (orquestrador.ts, correcao de
// 2026-08-22). Diferente de teste-real-catalogo-pedir-procedimento.ts (que
// testa so a redatora com fatos MONTADOS A MAO): este arquivo prova que o
// ORQUESTRADOR DE VERDADE produz o fato certo a partir de um cenario real de
// banco (dublê), com o catalogo contendo "Consulta / Avaliação" de fato.
//
// Lacuna encontrada em producao (2026-08-22, WhatsApp real, Cleardent):
// "quero um turno pra terça feira" -> decisao aguardando_procedimento -> a
// Iris respondeu com a LISTA inteira de procedimentos (limpeza, restauracao,
// extracao, avaliacao), quando deveria ter oferecido SO a avaliacao. O teste
// de redatora isolado (com fatos fabricados) nunca teria pego isso, porque
// nunca provou que o orquestrador de fato monta esse fato -- so que a
// redatora se comporta bem QUANDO ele ja existe.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
const INSTANTE_ATUAL = { data: '2026-08-03', minuto_min: 480 };

function clienteRpcNuncaChamado(): ClienteRpcFalso {
  return new ClienteRpcFalso({});
}

// Catalogo com 4 procedimentos, incluindo consultation_evaluation -- mesmo
// recorte real da Cleardent (specs/catalogo-avaliacao-obrigatoria-gratuita-v1.md).
function montarCenarioComAvaliacao(tabelas: TabelasFalsas) {
  const clinicaId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const pacienteId = crypto.randomUUID();
  const idAvaliacao = 'consultation_evaluation';
  const idLimpeza = 'cleaning';
  const idRestauracao = 'restoration_1';
  const idExtracao = 'simple_extraction';

  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [
      {
        id: dentistaId,
        nome: 'Ana',
        titulo: 'Dra.',
        ativo: true,
        modo: 'auto',
        dur: 30,
        inicio: '08:00',
        fim: '18:00',
        sabado: false,
        alm_ini: null,
        alm_fim: null,
        procedimentos: [
          { id: idAvaliacao, nome: 'Consulta / Avaliação', ativo: true, tempo: 30 },
          { id: idLimpeza, nome: 'Limpeza dental (profilaxia)', ativo: true, tempo: 50 },
          { id: idRestauracao, nome: 'Restauração / Cárie (1 face)', ativo: true, tempo: 40 },
          { id: idExtracao, nome: 'Extração simples', ativo: true, tempo: 40 },
        ],
      },
    ],
  });
  tabelas.pacientes.push({
    id: pacienteId,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    nome: 'Gabriel Cappello',
    documento: '52998224725',
    data_nascimento: '1979-06-23',
  });
  for (const [id, nome] of [
    [idAvaliacao, 'Consulta / Avaliação'],
    [idLimpeza, 'Limpeza dental (profilaxia)'],
    [idRestauracao, 'Restauração / Cárie (1 face)'],
    [idExtracao, 'Extração simples'],
  ] as const) {
    tabelas.procedimentos_catalogo.push({
      id,
      nome_pt: nome,
      nome_es: null,
      nome_en: null,
      nome_fr: null,
      nome_de: null,
      nome_it: null,
      nome_ru: null,
      nome_ar: null,
      tempo_padrao: 30,
      ativo: true,
    });
  }

  return { clinicaId, pacienteId, dentistaId, idAvaliacao };
}

function semearConversa(tabelas: TabelasFalsas, clinicaId: string, pacienteId: string) {
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: pacienteId,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
}

function entrada(mensagem: string) {
  return {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: [mensagem],
    instante_atual: INSTANTE_ATUAL,
  };
}

// CENARIO REAL (WhatsApp, 2026-08-22, Cleardent): paciente diz a data, NAO diz
// o procedimento -> decisao aguardando_procedimento -> o fato entregue a
// redatora tem que ser SO o nome da avaliacao, NUNCA a lista inteira.
test('REAL: "quero um turno pra terça feira" (data sem procedimento) -> so procedimento_avaliacao_disponivel, nunca a lista', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenarioComAvaliacao(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId);

  const resultado = await processarMensagem(
    new ClienteModeloFalso([
      { natureza_mensagem: 'pedido', alteracoes: { data_texto: { acao: 'informar', valor: 'terça-feira' } } },
    ]),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('quero um turno pra terça feira')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
  assert.equal(resultado.procedimento_avaliacao_disponivel, 'Consulta / Avaliação');
  assert.ok(
    !('procedimentos_ativos_da_clinica' in resultado),
    'a lista completa NUNCA deve acompanhar procedimento_avaliacao_disponivel no mesmo turno'
  );
});

// Mesmo cenario, SEM nenhuma mencao de data -- so "quero agendar". Ainda
// aguardando_procedimento, ainda so o nome unico.
test('paciente pede agendamento generico, sem data nem procedimento: mesma regra', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenarioComAvaliacao(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId);

  const resultado = await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('quero agendar uma consulta')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
  assert.equal(resultado.procedimento_avaliacao_disponivel, 'Consulta / Avaliação');
  assert.ok(!('procedimentos_ativos_da_clinica' in resultado));
});

// Pergunta livre explicita sobre as opcoes -> decisao duvida_livre -> AGORA
// sim a lista completa, nunca o fato de avaliacao unica.
test('"quais procedimentos vocês fazem?" (duvida_livre): lista completa, nunca o fato unico', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, pacienteId } = montarCenarioComAvaliacao(tabelas);
  semearConversa(tabelas, clinicaId, pacienteId);

  const resultado = await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'duvida', alteracoes: {} }]),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('quais procedimentos vocês fazem?')
  );

  assert.equal(resultado.decisao.tipo, 'duvida_livre');
  assert.ok(Array.isArray(resultado.procedimentos_ativos_da_clinica));
  assert.ok(resultado.procedimentos_ativos_da_clinica!.includes('Consulta / Avaliação'));
  assert.ok(!('procedimento_avaliacao_disponivel' in resultado));
});

// NEGATIVO: catalogo SEM consultation_evaluation -- o fato fica ausente,
// nunca inventado.
test('catalogo sem Avaliação cadastrada: procedimento_avaliacao_disponivel fica ausente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const pacienteId = crypto.randomUUID();
  const idLimpeza = 'cleaning';

  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [
      {
        id: dentistaId,
        nome: 'Ana',
        titulo: 'Dra.',
        ativo: true,
        modo: 'auto',
        dur: 30,
        inicio: '08:00',
        fim: '18:00',
        sabado: false,
        alm_ini: null,
        alm_fim: null,
        procedimentos: [{ id: idLimpeza, nome: 'Limpeza', ativo: true, tempo: 50 }],
      },
    ],
  });
  tabelas.pacientes.push({
    id: pacienteId,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    nome: 'Gabriel Cappello',
    documento: '52998224725',
    data_nascimento: '1979-06-23',
  });
  tabelas.procedimentos_catalogo.push({
    id: idLimpeza,
    nome_pt: 'Limpeza',
    nome_es: null,
    nome_en: null,
    nome_fr: null,
    nome_de: null,
    nome_it: null,
    nome_ru: null,
    nome_ar: null,
    tempo_padrao: 50,
    ativo: true,
  });
  semearConversa(tabelas, clinicaId, pacienteId);

  const resultado = await processarMensagem(
    new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]),
    new ClienteFalso(tabelas),
    clienteRpcNuncaChamado(),
    entrada('quero agendar um horário')
  );

  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
  assert.ok(!('procedimento_avaliacao_disponivel' in resultado));
});
