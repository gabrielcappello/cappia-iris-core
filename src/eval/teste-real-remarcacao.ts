// Runner ISOLADO, avulso, chamado manualmente: prova o CAMINHO REAL da
// remarcacao (specs/remarcacao-conversacional-v1.md) -- mensagem real ->
// OpenAI REAL -> orquestrador (src/core/orquestrador.ts) -> decisao
// estruturada, em duas mensagens sucessivas de um paciente ficticio com UM
// agendamento ativo.
//
// Banco e RPC sao DUBLES em memoria (ClienteFalso/ClienteRpcFalso) -- so a
// camada de INTERPRETACAO chama a OpenAI de verdade. E o mesmo espirito de
// teste-real-confirmacao-proposta-pendente.ts, estendido para cobrir o
// orquestrador inteiro em vez de so o extrator isolado.
//
// Fluxo provado:
//   1. "Preciso remarcar minha consulta para amanhã às 10h"
//      -> intencao=remarcacao (real), data_texto=amanha, horario_texto=10:00
//      -> unico agendamento ativo localizado -> horario livre ->
//         aguardando_confirmacao_remarcacao
//   2. "Isso, pode confirmar"
//      -> confirmacao=sim (real, via proposta_pendente) ->
//         cappia_remarcar_agendamento_v2 chamada -> remarcacao_criada
//
// Dados: tudo SINTETICO e FICTICIO (nenhuma clinica, paciente ou telefone
// real).
//
// Chave: somente via variavel de ambiente OPENAI_API_KEY (cofre canonico,
// .iris-secrets/openai.env), carregada exclusivamente por `node --env-file`.
// Este arquivo nunca abre, le, imprime ou edita nada dentro de .iris-secrets.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-remarcacao.ts

import { processarMensagem } from '../core/orquestrador.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from '../core/teste-cliente-falso.ts';
import { ClienteRpcFalso, type RespostaRpc } from '../core/teste-cliente-rpc-falso.ts';
import {
  criarClienteModeloOpenAI,
  MODELO_GPT_4_1_MINI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import type { ClienteBancoDados } from '../core/tipos.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste-real-remarcacao';
const TELEFONE = '5511988887777';
// 2026-08-03 = segunda-feira (verificado, mesmo instante ja usado nos testes
// de unidade de remarcacao). "Amanha" cai em 2026-08-04, terca -- dentro do
// horario semanal padrao (08:00-12:00), nunca sabado/domingo.
const INSTANTE_ATUAL = { data: '2026-08-03', minuto_min: 480 };

function montarCenario(): { tabelas: TabelasFalsas; clinicaId: string; procedimentoId: string; dentistaId: string; pacienteId: string; agendamentoId: string } {
  const tabelas = criarTabelasFalsasVazias();
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
        fim: '12:00',
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
    nome: 'Paciente Teste Real',
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
  const agendamentoId = crypto.randomUUID();
  tabelas.agendamentos.push({
    id: agendamentoId,
    clinica_id: clinicaId,
    paciente_id: pacienteId,
    status: 'confirmado',
    dentista_id: dentistaId,
    dentista_nome: 'Dra. Ana',
    procedimento_id: procedimentoId,
    procedimento: 'Limpeza',
    data: '2026-08-20',
    horario: '15:00',
  });
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

  return { tabelas, clinicaId, procedimentoId, dentistaId, pacienteId, agendamentoId };
}

function imprimir(titulo: string, valor: unknown): void {
  console.log(`--- ${titulo} ---`);
  console.log(JSON.stringify(valor, null, 2));
  console.log('');
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: caminho completo de remarcacao (mensagem -> OpenAI real -> orquestrador -> decisao) ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log('');

  const { tabelas, clinicaId, procedimentoId, dentistaId, agendamentoId } = montarCenario();
  const clienteBanco: ClienteBancoDados = new ClienteFalso(tabelas);
  const clienteModelo = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  let erros = 0;

  // --- TURNO 1 ---
  console.log('[TURNO 1] "Preciso remarcar minha consulta para amanhã às 10h"');
  const clienteRpcTurno1 = new ClienteRpcFalso({}); // nao deveria ser chamada neste turno.
  const resultado1 = await processarMensagem(clienteModelo, clienteBanco, clienteRpcTurno1, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['Preciso remarcar minha consulta para amanhã às 10h'],
    instante_atual: INSTANTE_ATUAL,
  });
  imprimir('decisao turno 1', resultado1.decisao);

  if (resultado1.decisao.tipo !== 'aguardando_confirmacao_remarcacao') {
    console.error(`FALHOU: esperava aguardando_confirmacao_remarcacao, obteve ${resultado1.decisao.tipo}`);
    erros++;
  } else {
    console.log(`  agendamento_atual: ${resultado1.decisao.agendamento_atual.data} às ${resultado1.decisao.agendamento_atual.horario}`);
    console.log(`  nova opcao: ${resultado1.decisao.opcao.data} às (minuto ${resultado1.decisao.opcao.inicio_min})`);
    if (resultado1.decisao.opcao.data !== '2026-08-04') {
      console.error(`FALHOU: esperava a nova data 2026-08-04 (amanha), obteve ${resultado1.decisao.opcao.data}`);
      erros++;
    }
  }
  if (clienteRpcTurno1.chamadas.length !== 0) {
    console.error('FALHOU: RPC de remarcacao foi chamada no turno 1, sem confirmacao ainda');
    erros++;
  }
  console.log('');

  // --- TURNO 2 ---
  console.log('[TURNO 2] "Isso, pode confirmar"');
  const clienteRpcTurno2 = new ClienteRpcFalso({
    cappia_remarcar_agendamento_v2: {
      data: {
        sucesso: true,
        agendamento_id: crypto.randomUUID(),
        agendamento_id_antigo: agendamentoId,
        dentista_id: dentistaId,
        duracao_min: 30,
        data: '2026-08-04',
        horario: '10:00',
      },
      error: null,
    } satisfies RespostaRpc,
  });
  const resultado2 = await processarMensagem(clienteModelo, clienteBanco, clienteRpcTurno2, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['Isso, pode confirmar'],
    instante_atual: INSTANTE_ATUAL,
  });
  imprimir('decisao turno 2', resultado2.decisao);

  if (resultado2.decisao.tipo !== 'remarcacao_criada') {
    console.error(`FALHOU: esperava remarcacao_criada, obteve ${resultado2.decisao.tipo}`);
    erros++;
  }
  if (clienteRpcTurno2.chamadas.length !== 1) {
    console.error(`FALHOU: esperava exatamente 1 chamada a cappia_remarcar_agendamento_v2, obteve ${clienteRpcTurno2.chamadas.length}`);
    erros++;
  } else {
    const parametros = clienteRpcTurno2.chamadas[0]!.parametros;
    console.log('parametros enviados a RPC:', JSON.stringify(parametros, null, 2));
    if (parametros.p_agendamento_id !== agendamentoId) {
      console.error('FALHOU: p_agendamento_id nao e o agendamento antigo localizado');
      erros++;
    }
    if (parametros.p_procedimento_id !== procedimentoId || parametros.p_dentista_id !== dentistaId) {
      console.error('FALHOU: procedimento/dentista foram re-resolvidos em vez de herdados do agendamento antigo');
      erros++;
    }
    if (parametros.p_clinica_id !== clinicaId) {
      console.error('FALHOU: clinica_id divergente');
      erros++;
    }
  }
  console.log('');

  console.log('--- resumo ---');
  console.log(erros === 0 ? 'TODOS OS PASSOS PASSARAM' : `${erros} FALHA(S)`);
  process.exitCode = erros === 0 ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
