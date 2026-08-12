// Runner ISOLADO, avulso: PROVA CONTRA A REDATORA REAL do desfecho
// "confirmacao ainda nao ficou clara" (specs/cancelamento-conversacional-v1.md
// secao 4, decisao do Gabriel 2026-08-11).
//
// ── O CENARIO EXATO ──────────────────────────────────────────────────────
//   Iris:     "Você quer cancelar sua limpeza de amanhã às 14h?"
//   Paciente: "Pode cancelar."
//   Iris:     <- E ISTO que este runner mede.
//
// "Pode cancelar" foi medido 0/4 contra a IA interpretadora em TODOS os
// formatos de pergunta testados: ela emite `intencao=cancelamento` em vez de
// `confirmacao=sim`. Gramaticalmente ela nao esta errada -- "pode cancelar" e
// um imperativo, nao uma concordancia. O Core, corretamente, NAO executa.
//
// O buraco era o que vinha depois: a Iris repetia a MESMA pergunta, em laco.
// Agora o Core deriva `confirmacao_nao_compreendida` e a redatora recebe esse
// fato para pedir esclarecimento de forma natural.
//
// ── CRITERIOS (todos verificados programaticamente) ──────────────────────
//   1. a RPC nunca e chamada (verificado no caminho de orquestracao, abaixo);
//   2. o texto NAO repete mecanicamente a mesma pergunta anterior;
//   3. o texto nao exige palavra fixa (nao impoe "CONFIRMO" nem equivalente);
//   4. o cancelamento continua pendente (proposta_pendente regravada);
//   5. uma resposta clara depois ("sim"/"confirmo"/"isso mesmo") volta ao
//      MESMO gate e conclui.
//
// Os passos 1, 4 e 5 rodam contra o ORQUESTRADOR real (banco/RPC dublados,
// interpretadora REAL). O passo 2 e 3 rodam contra a REDATORA real.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-esclarecimento-cancelamento.ts

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
import { criarClienteModeloRedatorOpenAI, TIMEOUT_REDATOR_MS_APROVADO } from '../core/cliente-modelo-redator-openai.ts';
import { INSTRUCOES_REDATOR } from '../core/redator-instrucoes.ts';
import { verificarRespostaRedatora } from '../core/guarda-resposta-redatora.ts';
import { derivarFatosAutorizados } from '../core/fatos-autorizados.ts';
import type { ClienteBancoDados } from '../core/tipos.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste-esclarecimento';
const TELEFONE = '5511977775555';
// HOJE = 19/08 (quarta). O agendamento e 20/08 as 14:00 -- "amanha as 14h".
const INSTANTE_ATUAL = { data: '2026-08-19', minuto_min: 480 };
const DATA_AGENDAMENTO = '2026-08-20';
const HORARIO_AGENDAMENTO = '14:00';

const PERGUNTA_TURNO_1 = 'Você quer cancelar sua limpeza de amanhã às 14h?';

function montarCenario(): { tabelas: TabelasFalsas; pacienteId: string; agendamentoId: string } {
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
  // Estado do TURNO 2: a pergunta do turno 1 ja foi feita, o marcador esta
  // gravado, e o historico carrega a frase exata.
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { intencao: 'cancelamento' },
    paciente_id: pacienteId,
    contexto_horarios: {
      proposta_pendente: { data: DATA_AGENDAMENTO, horario: HORARIO_AGENDAMENTO },
      criado_em: new Date().toISOString(),
    },
    historico_conversa: [
      {
        mensagem_paciente: 'Preciso cancelar minha consulta',
        resposta_iris: PERGUNTA_TURNO_1,
        gerada_em: new Date().toISOString(),
      },
    ],
    atualizado_em: new Date('2026-08-18T00:00:00.000Z').toISOString(),
  });

  return { tabelas, pacienteId, agendamentoId };
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Repeticao MECANICA = o texto novo e essencialmente a mesma frase de antes. */
function repeteMecanicamente(textoNovo: string, textoAnterior: string): boolean {
  return normalizar(textoNovo) === normalizar(textoAnterior);
}

/**
 * "Exigir palavra fixa" = mandar o paciente responder uma palavra especifica.
 * Detecta o padrao imperativo ("responda X", "digite X", "escreva X"), nunca a
 * mera presenca da palavra -- "voce confirma?" e legitimo e NAO e exigencia.
 */
function exigePalavraFixa(texto: string): boolean {
  return /\b(responda|digite|escreva|envie)\b/i.test(texto);
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: esclarecimento quando a confirmacao nao ficou clara ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log('');
  console.log(`[TURNO 1 -- ja aconteceu] Iris: "${PERGUNTA_TURNO_1}"`);
  console.log('[TURNO 2] Paciente: "Pode cancelar."');
  console.log('');

  const { tabelas, agendamentoId } = montarCenario();
  const clienteBanco: ClienteBancoDados = new ClienteFalso(tabelas);
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

  // === TURNO 2: "Pode cancelar." ===
  const rpcTurno2 = new ClienteRpcFalso({}); // nao deve ser chamada.
  const resultado2 = await processarMensagem(clienteModelo, clienteBanco, rpcTurno2, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['Pode cancelar.'],
    instante_atual: INSTANTE_ATUAL,
  });

  console.log('--- decisao do turno 2 ---');
  console.log(JSON.stringify(resultado2.decisao, null, 2));
  console.log('');

  // CRITERIO 1 -- nao executar RPC.
  if (rpcTurno2.chamadas.length !== 0) {
    console.error('FALHOU [1]: a RPC de cancelamento foi chamada sem confirmacao clara');
    erros++;
  } else {
    console.log('OK [1] nenhuma chamada a RPC');
  }

  if (resultado2.decisao.tipo !== 'aguardando_confirmacao_cancelamento') {
    console.error(`FALHOU: esperava aguardando_confirmacao_cancelamento, obteve ${resultado2.decisao.tipo}`);
    erros++;
    console.log('');
    console.log('--- resumo ---');
    console.log(`${erros} FALHA(S)`);
    process.exitCode = 1;
    return;
  }

  // O fato so existe se a IA de fato NAO confirmou. Se ela tiver confirmado
  // nesta execucao (o caso e instavel por natureza), o cenario medido nao
  // ocorreu -- e isso e reportado com honestidade, nunca mascarado.
  if (resultado2.decisao.confirmacao_nao_compreendida !== true) {
    console.error('INCONCLUSIVO: a interpretadora CONFIRMOU "Pode cancelar." nesta execucao.');
    console.error('O desfecho de esclarecimento nao foi exercitado. Rode de novo para amostrar o caso.');
    console.log('');
    console.log('--- resumo ---');
    console.log('INCONCLUSIVO (nao e falha do Core -- o caso instavel caiu do outro lado)');
    process.exitCode = 2;
    return;
  }
  console.log('OK [derivacao] confirmacao_nao_compreendida = true');

  // CRITERIO 4 -- o cancelamento continua pendente.
  const contexto = (tabelas.estado_conversa[0] as unknown as { contexto_horarios: Record<string, unknown> | null })
    .contexto_horarios;
  const proposta = contexto?.proposta_pendente as { data: string; horario: string } | undefined;
  if (proposta?.data !== DATA_AGENDAMENTO || proposta?.horario !== HORARIO_AGENDAMENTO) {
    console.error(`FALHOU [4]: o cancelamento deixou de estar pendente (${JSON.stringify(proposta)})`);
    erros++;
  } else {
    console.log('OK [4] cancelamento continua pendente (proposta_pendente regravada)');
  }

  // === REDATORA REAL sobre os fatos autorizados deste turno ===
  const fatos = derivarFatosAutorizados(resultado2.decisao);
  console.log('');
  console.log(`fatos autorizados: ${JSON.stringify(fatos)}`);

  const texto = await clienteRedator.redigir({
    instrucoes: INSTRUCOES_REDATOR,
    mensagemPaciente: 'Pode cancelar.',
    naturezaMensagem: resultado2.natureza_mensagem,
    fatos,
    historicoRecente: [
      {
        mensagem_paciente: 'Preciso cancelar minha consulta',
        resposta_iris: PERGUNTA_TURNO_1,
        gerada_em: new Date().toISOString(),
      },
    ],
  });

  console.log('');
  console.log(`>>> Iris respondeu: "${texto}"`);
  console.log('');

  const guarda = verificarRespostaRedatora(texto, fatos);
  if (!guarda.aprovado) {
    console.error(`FALHOU [guarda]: a resposta foi reprovada (${guarda.motivo})`);
    erros++;
  } else {
    console.log('OK [guarda] resposta aprovada');
  }

  // CRITERIO 2 -- nao repetir mecanicamente a mesma pergunta.
  if (repeteMecanicamente(texto, PERGUNTA_TURNO_1)) {
    console.error('FALHOU [2]: a resposta repete mecanicamente a pergunta do turno anterior');
    erros++;
  } else {
    console.log('OK [2] nao repete mecanicamente a pergunta anterior');
  }

  // CRITERIO 3 -- nao exigir palavra fixa.
  if (exigePalavraFixa(texto)) {
    console.error('FALHOU [3]: a resposta exige uma palavra/formato fixo de resposta');
    erros++;
  } else {
    console.log('OK [3] nao exige palavra fixa');
  }

  // === TURNO 3: resposta clara -> volta ao MESMO gate e conclui ===
  console.log('');
  console.log('[TURNO 3] Paciente: "Isso mesmo, pode sim"');
  const rpcTurno3 = new ClienteRpcFalso({
    cappia_cancelar_agendamento_v2: {
      data: { sucesso: true, agendamento_id: agendamentoId, status: 'cancelado' },
      error: null,
    } satisfies RespostaRpc,
  });
  const resultado3 = await processarMensagem(clienteModelo, clienteBanco, rpcTurno3, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['Isso mesmo, pode sim'],
    instante_atual: INSTANTE_ATUAL,
  });

  console.log(`decisao do turno 3: ${resultado3.decisao.tipo}`);

  // CRITERIO 5 -- volta ao mesmo gate e conclui.
  if (resultado3.decisao.tipo !== 'cancelamento_criado') {
    console.error(`FALHOU [5]: esperava cancelamento_criado, obteve ${resultado3.decisao.tipo}`);
    erros++;
  } else if (rpcTurno3.chamadas.length !== 1) {
    console.error(`FALHOU [5]: esperava 1 chamada a RPC, obteve ${rpcTurno3.chamadas.length}`);
    erros++;
  } else {
    console.log('OK [5] resposta clara voltou ao mesmo gate e concluiu o cancelamento');
  }

  console.log('');
  console.log('--- resumo ---');
  console.log(erros === 0 ? 'TODOS OS CRITERIOS PASSARAM' : `${erros} FALHA(S)`);
  process.exitCode = erros === 0 ? 0 : 1;
}

main().catch((erro) => {
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
