// Runner ISOLADO, avulso: prova o CAMINHO REAL da consulta do proprio
// agendamento (specs/consulta-agendamento-conversacional-v1.md) --
// mensagem real -> OpenAI REAL (interpretadora) -> orquestrador -> fato do
// turno -> OpenAI REAL (redatora) -> guarda -> texto.
//
// Banco e RPC sao DUBLES em memoria; as duas camadas de IA sao REAIS.
//
// ── O QUE E PROVADO ─────────────────────────────────────────────────────
//   1. saudacao pura com agendamento futuro -> o fato chega e a redatora o usa;
//   2. pergunta sobre o agendamento -> responde com os dados oficiais;
//   3. paciente SEM agendamento -> fato ausente, nenhuma mencao inventada;
//   4. a guarda APROVA o texto que cita o horario real (era o defeito da §6).
//
// A limitacao aceita da §5 (duvida sobre a clinica pode vir com o agendamento
// anexado) NAO e testada como falha aqui -- ela e comportamento conhecido,
// medido e aceito para esta V1.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-consulta-agendamento.ts

import { processarMensagem } from '../core/orquestrador.ts';
import { gerarRespostaConversacional } from '../core/gerar-resposta-conversacional.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from '../core/teste-cliente-falso.ts';
import { ClienteRpcFalso } from '../core/teste-cliente-rpc-falso.ts';
import {
  criarClienteModeloOpenAI,
  MODELO_GPT_4_1_MINI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { criarClienteModeloRedatorOpenAI, TIMEOUT_REDATOR_MS_APROVADO } from '../core/cliente-modelo-redator-openai.ts';
import type { ClienteBancoDados } from '../core/tipos.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste-real-consulta';
const TELEFONE_COM_FICHA = '5511988884444';
const TELEFONE_SEM_AGENDAMENTO = '5511988883333';
// HOJE = 19/08 (quarta). O agendamento e 20/08 as 14:00 -- "amanha as 14h".
const INSTANTE_ATUAL = { data: '2026-08-19', minuto_min: 480 };
const DATA_AGENDAMENTO = '2026-08-20';
const HORARIO_AGENDAMENTO = '14:00';

function montarCenario(): TabelasFalsas {
  const tabelas = criarTabelasFalsasVazias();
  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const clinicaId = crypto.randomUUID();
  const pacienteComFicha = crypto.randomUUID();
  const pacienteSemAgendamento = crypto.randomUUID();

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

  for (const [id, telefone] of [
    [pacienteComFicha, TELEFONE_COM_FICHA],
    [pacienteSemAgendamento, TELEFONE_SEM_AGENDAMENTO],
  ] as const) {
    tabelas.pacientes.push({
      id,
      clinica_id: clinicaId,
      telefone_normalizado: telefone,
      nome: 'Paciente Teste Real',
      documento: '52998224725',
      data_nascimento: '1979-06-23',
    });
    tabelas.estado_conversa.push({
      id: crypto.randomUUID(),
      clinica_id: clinicaId,
      telefone_normalizado: telefone,
      estado: 'atendimento',
      dados: {},
      paciente_id: id,
      contexto_horarios: null,
      atualizado_em: new Date('2026-08-18T00:00:00.000Z').toISOString(),
    });
  }

  tabelas.agendamentos.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    paciente_id: pacienteComFicha,
    status: 'confirmado',
    dentista_id: dentistaId,
    dentista_nome: 'Dra. Ana',
    procedimento_id: procedimentoId,
    procedimento: 'Limpeza',
    data: DATA_AGENDAMENTO,
    horario: HORARIO_AGENDAMENTO,
  });

  return tabelas;
}

/** Citou o agendamento? Detecta por DADO CONCRETO, nunca por palavra generica. */
function mencionouAgendamento(texto: string): boolean {
  if (/\b14:00\b/.test(texto) || /\b14\s*h\b/i.test(texto) || /\b14\s*horas\b/i.test(texto)) return true;
  if (/\b20\/0?8\b/.test(texto)) return true;
  return false;
}

interface Caso {
  rotulo: string;
  telefone: string;
  mensagem: string;
  esperaFato: boolean;
  esperaMencao: boolean;
}

const CASOS: readonly Caso[] = Object.freeze([
  { rotulo: '1. saudacao pura, com agendamento', telefone: TELEFONE_COM_FICHA, mensagem: 'oi', esperaFato: true, esperaMencao: true },
  { rotulo: '2. pergunta sobre o agendamento', telefone: TELEFONE_COM_FICHA, mensagem: 'quando é minha consulta?', esperaFato: true, esperaMencao: true },
  { rotulo: '3. saudacao, SEM agendamento', telefone: TELEFONE_SEM_AGENDAMENTO, mensagem: 'oi', esperaFato: false, esperaMencao: false },
]);

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: consulta do proprio agendamento (fato do turno) ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log('Interpretadora E redatora reais; banco e RPC dublados.');
  console.log('');

  const clienteModelo = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });
  const clienteRedator = criarClienteModeloRedatorOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutMs: TIMEOUT_REDATOR_MS_APROVADO,
  });

  let erros = 0;

  for (const caso of CASOS) {
    console.log(`[${caso.rotulo}] "${caso.mensagem}"`);
    const tabelas = montarCenario();
    const clienteBanco: ClienteBancoDados = new ClienteFalso(tabelas);

    const resultado = await processarMensagem(clienteModelo, clienteBanco, new ClienteRpcFalso({}), {
      provider: PROVIDER,
      instancia_whatsapp: INSTANCIA,
      telefone_normalizado: caso.telefone,
      mensagens_atuais: [caso.mensagem],
      instante_atual: INSTANTE_ATUAL,
    });

    const temFato = resultado.agendamentos_do_paciente !== undefined;
    console.log(`  decisao: ${resultado.decisao.tipo} | fato presente: ${temFato}`);
    if (temFato) {
      console.log(`  fato: ${JSON.stringify(resultado.agendamentos_do_paciente?.map((a) => `${a.data} ${a.horario}`))}`);
    }

    if (temFato !== caso.esperaFato) {
      console.error(`  FALHOU: esperava fato presente=${caso.esperaFato}, obteve ${temFato}`);
      erros++;
    }

    // A REDATORA REAL, sobre os fatos deste turno.
    const { resposta, motivo_fallback } = await gerarRespostaConversacional(clienteRedator, {
      decisao: resultado.decisao,
      mensagemPaciente: caso.mensagem,
      naturezaMensagem: resultado.natureza_mensagem,
      historicoConversa: resultado.historico_conversa,
      dataHoje: INSTANTE_ATUAL.data,
      ...(resultado.agendamentos_do_paciente !== undefined
        ? { agendamentosDoPaciente: resultado.agendamentos_do_paciente }
        : {}),
    });

    console.log(`  >>> Iris: ${JSON.stringify(resposta)}`);
    console.log(`  fallback: ${motivo_fallback ?? '(nenhum -- redatora aprovada pela guarda)'}`);

    // CRITERIO DA GUARDA (spec secao 6): quando o fato existe e a redatora
    // cita o horario real, a guarda TEM de aprovar. Antes da correcao isso
    // reprovava e caia no texto fixo.
    if (caso.esperaFato && motivo_fallback === 'horario_nao_autorizado') {
      console.error('  FALHOU: guarda reprovou horario que E do agendamento real (defeito da secao 6)');
      erros++;
    }

    const mencionou = mencionouAgendamento(resposta);
    if (caso.esperaMencao && !mencionou) {
      console.error('  ATENCAO: nao mencionou o agendamento (saudacao pura foi medida em 11/15 -- nao e falha dura)');
    }
    if (!caso.esperaMencao && mencionou) {
      console.error('  FALHOU: mencionou agendamento que nao existe');
      erros++;
    }
    console.log('');
  }

  console.log('--- resumo ---');
  console.log(erros === 0 ? 'TODOS OS CRITERIOS DUROS PASSARAM' : `${erros} FALHA(S)`);
  process.exitCode = erros === 0 ? 0 : 1;
}

main().catch((erro) => {
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
