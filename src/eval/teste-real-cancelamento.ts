// Runner ISOLADO, avulso, chamado manualmente: prova o CAMINHO REAL do
// cancelamento (specs/cancelamento-conversacional-v1.md) -- mensagem real ->
// OpenAI REAL -> orquestrador (src/core/orquestrador.ts) -> decisao
// estruturada, em duas mensagens sucessivas de um paciente ficticio com UM
// agendamento ativo.
//
// Banco e RPC sao DUBLES em memoria (ClienteFalso/ClienteRpcFalso) -- so a
// camada de INTERPRETACAO chama a OpenAI de verdade. Mesmo espirito de
// teste-real-remarcacao.ts.
//
// Fluxo provado:
//   1. "Preciso cancelar minha consulta"
//      -> intencao=cancelamento (real, SEM nenhuma regra de prompt propria)
//      -> unico agendamento ativo localizado
//      -> aguardando_confirmacao_cancelamento, RPC NUNCA chamada
//   2. "Isso mesmo, pode sim"
//      -> confirmacao=sim (real, via proposta_pendente)
//      -> as TRES condicoes da spec secao 4 satisfeitas
//      -> cappia_cancelar_agendamento_v2 chamada -> cancelamento_criado
//
// A frase do turno 2 e deliberadamente uma concordancia CLARA, nao "pode
// cancelar" isolado -- este ultimo e um caso conhecido e medido de
// AMBIGUIDADE (ver teste-real-esclarecimento-cancelamento.ts): quando a IA
// nao confirma, o Core corretamente NAO executa e pede esclarecimento
// (`confirmacao_nao_compreendida`). Esse comportamento e o CORRETO e ja tem
// prova propria e dedicada no outro runner; este aqui prova o caminho feliz
// de ponta a ponta, com uma frase que confirma de forma inequivoca.
//
// PROVA NEGATIVA INCLUIDA (turno 1): a protecao central da spec -- a intencao
// sozinha NUNCA executa. Se a RPC for chamada no turno 1, o runner falha.
//
// Dados: tudo SINTETICO e FICTICIO. Chave somente via OPENAI_API_KEY
// (cofre canonico), carregada por `node --env-file`. Este arquivo nunca abre,
// le, imprime ou edita nada dentro de .iris-secrets.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-cancelamento.ts

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
const INSTANCIA = 'clinica-teste-real-cancelamento';
const TELEFONE = '5511988886666';
// 2026-08-03 = segunda-feira (verificado, mesmo instante dos demais runners).
const INSTANTE_ATUAL = { data: '2026-08-03', minuto_min: 480 };

const DATA_AGENDAMENTO = '2026-08-20';
const HORARIO_AGENDAMENTO = '15:00';

function montarCenario(): {
  tabelas: TabelasFalsas;
  clinicaId: string;
  pacienteId: string;
  agendamentoId: string;
} {
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
    data: DATA_AGENDAMENTO,
    horario: HORARIO_AGENDAMENTO,
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

  return { tabelas, clinicaId, pacienteId, agendamentoId };
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

  console.log('--- teste real: caminho completo de cancelamento (mensagem -> OpenAI real -> orquestrador -> decisao) ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log('');

  const { tabelas, clinicaId, pacienteId, agendamentoId } = montarCenario();
  const clienteBanco: ClienteBancoDados = new ClienteFalso(tabelas);
  const clienteModelo = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  let erros = 0;

  // --- TURNO 1 --- intencao sozinha NUNCA executa (spec secao 4).
  console.log('[TURNO 1] "Preciso cancelar minha consulta"');
  const clienteRpcTurno1 = new ClienteRpcFalso({}); // nao deveria ser chamada neste turno.
  const resultado1 = await processarMensagem(clienteModelo, clienteBanco, clienteRpcTurno1, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['Preciso cancelar minha consulta'],
    instante_atual: INSTANTE_ATUAL,
  });
  imprimir('decisao turno 1', resultado1.decisao);

  if (resultado1.decisao.tipo !== 'aguardando_confirmacao_cancelamento') {
    console.error(`FALHOU: esperava aguardando_confirmacao_cancelamento, obteve ${resultado1.decisao.tipo}`);
    erros++;
  } else {
    const ag = resultado1.decisao.agendamento;
    console.log(`  agendamento a cancelar: ${ag.procedimento} com ${ag.dentista_nome} -- ${ag.data} as ${ag.horario}`);
    if (ag.agendamento_id !== agendamentoId) {
      console.error('FALHOU: o agendamento localizado nao e o semeado');
      erros++;
    }
  }
  // PROVA NEGATIVA: a protecao central desta spec.
  if (clienteRpcTurno1.chamadas.length !== 0) {
    console.error('FALHOU: RPC de cancelamento foi chamada no turno 1, SEM confirmacao -- violacao da protecao central');
    erros++;
  } else {
    console.log('  OK: nenhuma escrita no turno 1 (intencao sozinha nunca executa)');
  }
  // O contexto precisa ter gravado a proposta pendente CRUA -- e o que o
  // turno 2 confere (condicao 3 da spec secao 4).
  const contexto = (tabelas.estado_conversa[0] as unknown as { contexto_horarios: Record<string, unknown> | null })
    .contexto_horarios;
  const proposta = contexto?.proposta_pendente as { data: string; horario: string } | undefined;
  if (proposta?.data !== DATA_AGENDAMENTO || proposta?.horario !== HORARIO_AGENDAMENTO) {
    console.error(`FALHOU: proposta_pendente gravada nao corresponde ao agendamento (${JSON.stringify(proposta)})`);
    erros++;
  } else {
    console.log(`  OK: proposta_pendente gravada = ${proposta.data} as ${proposta.horario}`);
  }
  console.log('');

  // --- TURNO 2 --- confirmacao natural, sem a palavra "sim" isolada.
  console.log('[TURNO 2] "Isso mesmo, pode sim"');
  const clienteRpcTurno2 = new ClienteRpcFalso({
    cappia_cancelar_agendamento_v2: {
      data: { sucesso: true, agendamento_id: agendamentoId, status: 'cancelado' },
      error: null,
    } satisfies RespostaRpc,
  });
  const resultado2 = await processarMensagem(clienteModelo, clienteBanco, clienteRpcTurno2, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['Isso mesmo, pode sim'],
    instante_atual: INSTANTE_ATUAL,
  });
  imprimir('decisao turno 2', resultado2.decisao);

  if (resultado2.decisao.tipo !== 'cancelamento_criado') {
    console.error(`FALHOU: esperava cancelamento_criado, obteve ${resultado2.decisao.tipo}`);
    erros++;
  }
  if (clienteRpcTurno2.chamadas.length !== 1) {
    console.error(`FALHOU: esperava exatamente 1 chamada a cappia_cancelar_agendamento_v2, obteve ${clienteRpcTurno2.chamadas.length}`);
    erros++;
  } else {
    const parametros = clienteRpcTurno2.chamadas[0]!.parametros;
    console.log('parametros enviados a RPC:', JSON.stringify(parametros, null, 2));
    if (parametros.p_agendamento_id !== agendamentoId) {
      console.error('FALHOU: p_agendamento_id nao e o agendamento localizado');
      erros++;
    }
    if (parametros.p_paciente_id !== pacienteId) {
      console.error('FALHOU: p_paciente_id ausente ou divergente -- e o que impede cancelar agendamento alheio');
      erros++;
    }
    if (parametros.p_clinica_id !== clinicaId) {
      console.error('FALHOU: clinica_id divergente');
      erros++;
    }
    if (clienteRpcTurno2.chamadas.some((c) => c.nome === 'cappia_cancelar_agendamento')) {
      console.error('FALHOU: a RPC LEGADA foi chamada');
      erros++;
    }
  }

  // Ciclo de vida: sucesso limpa intencao e agendamento_id.
  const dadosFinais = (tabelas.estado_conversa[0] as unknown as { dados: Record<string, string> }).dados;
  if ('intencao' in dadosFinais || 'agendamento_id' in dadosFinais) {
    console.error(`FALHOU: intencao/agendamento_id nao foram limpos apos o sucesso (${JSON.stringify(dadosFinais)})`);
    erros++;
  } else {
    console.log('  OK: intencao e agendamento_id limpos apos o sucesso');
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
