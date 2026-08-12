// Teste de PARIDADE entre as duas implementacoes de `diaDaSemanaCivil`
// (algoritmo de Howard Hinnant), reimplementadas separadamente em
// orquestrador.ts e fatos-autorizados.ts pela convencao ja documentada do
// projeto (nunca acoplar modulos so para exportar um helper privado de 12
// linhas de aritmetica de calendario -- ver specs/consulta-agendamento-
// conversacional-v1.md secao 10, "risco nao bloqueante").
//
// Este teste NAO exporta nenhum helper privado e NAO muda nenhuma
// arquitetura. As duas implementacoes sao observadas pelas suas SAIDAS
// PUBLICAS ja existentes:
//
//   - fatos-autorizados.ts: diretamente, via `derivarFatosAutorizados` (ja
//     exportada) -- o dia da semana aparece no inicio da descricao do
//     agendamento.
//   - orquestrador.ts: indiretamente, via o payload que `processarMensagem`
//     envia ao cliente de modelo (`ClienteModeloFalso.chamadas[0].payload`)
//     quando ha escolha de agendamento pendente -- mesmo mecanismo de
//     observacao ja usado em orquestrador-remarcacao.test.ts.
//
// Datas do vetor: comuns, virada de ano e ano bissexto (inclusive o caso
// secular 2000, que E bissexto por ser multiplo de 400) -- verificadas
// independentemente antes de escrever este arquivo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { derivarFatosAutorizados } from './fatos-autorizados.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';
import type { AgendamentoAtivo } from './buscar-agendamento-ativo.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste-paridade-dia-semana';
const TELEFONE = '5511977776666';
// Anterior a TODA data do vetor -- inclusive o caso secular 2000-02-29 --
// para que `buscarAgendamentoAtivo` nunca filtre uma delas como passado.
const INSTANTE_ATUAL = { data: '1999-01-01', minuto_min: 480 };

// Vetor de datas: [data, dia da semana esperado] -- verificado
// independentemente (Node Date, ancorado em UTC) antes de escrever este teste.
const VETOR: readonly [string, string][] = [
  // comuns
  ['2026-08-10', 'segunda-feira'],
  ['2026-08-13', 'quinta-feira'],
  ['2026-11-25', 'quarta-feira'],
  // virada de ano
  ['2026-12-31', 'quinta-feira'],
  ['2027-01-01', 'sexta-feira'],
  // ano bissexto (2028 comum; 2000 bissexto secular, multiplo de 400)
  ['2028-02-29', 'terça-feira'],
  ['2024-02-29', 'quinta-feira'],
  ['2000-02-29', 'terça-feira'],
];

function montarCenario(tabelas: TabelasFalsas) {
  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const clinicaId = crypto.randomUUID();
  const pacienteId = crypto.randomUUID();

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
        procedimentos: [{ id: procedimentoId, nome: 'Limpeza', ativo: true, tempo: 999 }],
      },
    ],
  });
  tabelas.pacientes.push({
    id: pacienteId,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    nome: 'Paciente Teste Paridade',
    documento: '52998224725',
    data_nascimento: '1979-06-23',
  });
  tabelas.procedimentos_catalogo.push({
    id: procedimentoId,
    nome_pt: 'Limpeza',
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

  return { clinicaId, procedimentoId, dentistaId, pacienteId };
}

function semearAgendamentoAtivo(
  tabelas: TabelasFalsas,
  overrides: {
    clinica_id: string;
    paciente_id: string;
    dentista_id: string;
    procedimento_id: string;
    data: string;
    horario: string;
  }
) {
  const id = crypto.randomUUID();
  tabelas.agendamentos.push({
    id,
    status: 'confirmado',
    dentista_nome: 'Dra. Ana',
    procedimento: 'Limpeza',
    ...overrides,
  });
  return id;
}

/**
 * Extrai o dia da semana do INICIO da descricao ("segunda-feira, 10/08 às
 * 14:00" -> "segunda-feira"). Mesmo formato produzido pelas duas
 * implementacoes (`descreverAgendamentoAtivo` e `descreverAgendamentoDoPaciente`).
 */
function extrairDiaDaSemana(descricao: string): string {
  const virgula = descricao.indexOf(', ');
  const travessao = descricao.indexOf(' — ');
  assert.ok(travessao !== -1 && virgula > travessao, `descricao sem o formato esperado: ${descricao}`);
  return descricao.slice(travessao + 3, virgula);
}

// --- Lado A: fatos-autorizados.ts, via derivarFatosAutorizados (exportada) ---

test('paridade dia-da-semana [fatos-autorizados.ts]: vetor completo', () => {
  for (const [data, esperado] of VETOR) {
    const agendamento: AgendamentoAtivo = {
      agendamento_id: crypto.randomUUID(),
      data,
      horario: '14:00',
      dentista_id: crypto.randomUUID(),
      dentista_nome: 'Dra. Ana',
      procedimento_id: crypto.randomUUID(),
      procedimento: 'Limpeza',
    };
    const fatos = derivarFatosAutorizados({ tipo: 'saudacao' }, undefined, [agendamento]);
    const descricao = fatos.agendamentos_do_paciente?.[0];
    assert.ok(descricao !== undefined, `fato ausente para ${data}`);
    assert.equal(extrairDiaDaSemana(descricao), esperado, `fatos-autorizados.ts errou ${data}`);
  }
});

// --- Lado B: orquestrador.ts, via o payload enviado ao cliente de modelo ---

async function diaDaSemanaViaOrquestrador(data: string): Promise<string> {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId, pacienteId } = montarCenario(tabelas);
  const agTeste = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data,
    horario: '14:00',
  });
  // Segundo agendamento, fixo e IRRELEVANTE ao teste -- so para que a busca
  // devolva 'multiplos' e a escolha pendente seja processada (o payload com
  // dia da semana so e montado nesse caminho -- ver comentario do cabecalho).
  const agFixo = semearAgendamentoAtivo(tabelas, {
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    data: '2035-06-15',
    horario: '09:00',
  });
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: pacienteId,
    contexto_horarios: {
      escolha_agendamento_pendente: { agendamento_ids: [agTeste, agFixo] },
      criado_em: new Date().toISOString(),
    },
    atualizado_em: new Date('1999-01-01T00:00:00.000Z').toISOString(),
  });

  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'duvida', alteracoes: {} }]);
  await processarMensagem(clienteModelo, new ClienteFalso(tabelas), new ClienteRpcFalso({}), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['oi'],
    instante_atual: INSTANTE_ATUAL,
  });

  const payloadEnviado = clienteModelo.chamadas[0]?.payload as { agendamentos_ativos?: { agendamento_id: string; descricao: string }[] };
  const item = payloadEnviado.agendamentos_ativos?.find((a) => a.agendamento_id === agTeste);
  assert.ok(item !== undefined, `agendamento sob teste (${data}) nao apareceu no payload da IA`);
  return extrairDiaDaSemana(item.descricao);
}

test('paridade dia-da-semana [orquestrador.ts]: vetor completo', async () => {
  for (const [data, esperado] of VETOR) {
    const obtido = await diaDaSemanaViaOrquestrador(data);
    assert.equal(obtido, esperado, `orquestrador.ts errou ${data}`);
  }
});

// --- Paridade direta: as duas implementacoes, lado a lado, mesmo vetor ---

test('PARIDADE: as duas implementacoes concordam para toda data do vetor', async () => {
  for (const [data] of VETOR) {
    const agendamento: AgendamentoAtivo = {
      agendamento_id: crypto.randomUUID(),
      data,
      horario: '14:00',
      dentista_id: crypto.randomUUID(),
      dentista_nome: 'Dra. Ana',
      procedimento_id: crypto.randomUUID(),
      procedimento: 'Limpeza',
    };
    const viaFatos = extrairDiaDaSemana(
      derivarFatosAutorizados({ tipo: 'saudacao' }, undefined, [agendamento]).agendamentos_do_paciente![0]!
    );
    const viaOrquestrador = await diaDaSemanaViaOrquestrador(data);
    assert.equal(viaFatos, viaOrquestrador, `divergencia entre as duas implementacoes em ${data}`);
  }
});
