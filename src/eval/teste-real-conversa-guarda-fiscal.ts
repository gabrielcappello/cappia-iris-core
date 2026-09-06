// Runner ISOLADO, avulso, chamado manualmente: percorre a CONVERSA REAL do
// caso de origem (specs/guarda-redatora-fiscal-conversa-v1.md secao 1) contra
// a OpenAI REAL, com interpretadora E redatora reais -- mesmo padrao de
// src/eval/teste-real-conversa-pedido-multiplo.ts.
//
// POR QUE ESTE RUNNER EXISTE: a spec exige (secao 7, primeiro item) que a
// CONVERSA REAL COMPLETA seja executada contra o Core corrigido -- os 5
// bloqueios (fallback fixo repetido) nao devem se repetir da mesma forma. Os
// testes de unidade de guarda-resposta-redatora.test.ts provam a LOGICA da
// guarda com fatos sintéticos; só a IA real mostra o que a redatora de fato
// escreve quando tem liberdade para reconhecer preferencia, explicar limitacao
// e responder duvida.
//
// NAO EXIGIDO (fora de escopo, spec secao 1/8): resolver "ultimo dia do mes
// disponivel" -- a IA pode continuar sem saber responder isso. O que este
// runner prova e que ela para de repetir o MESMO fallback fixo cinco vezes.
//
// SIMULADO (nunca rede real): banco (ClienteFalso), RPCs de cadastro/reserva
// (ClienteRpcFalso) e a agenda derivada do catalogo sintetico. REAL: os dois
// modelos, o extrator, o orquestrador, a redatora e a guarda.
//
// Chave: somente via variavel de ambiente OPENAI_API_KEY (cofre canonico,
// .iris-secrets/openai.env), carregada exclusivamente por `node --env-file`.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-conversa-guarda-fiscal.ts

import {
  criarClienteModeloOpenAI,
  MODELO_IRIS_NOVA,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import {
  criarClienteModeloRedatorOpenAI,
  TIMEOUT_REDATOR_MS_APROVADO,
} from '../core/cliente-modelo-redator-openai.ts';
import { processarMensagem } from '../core/orquestrador.ts';
import { gerarRespostaConversacional } from '../core/gerar-resposta-conversacional.ts';
import { gravarHistoricoConversa } from '../core/historico-conversa.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from '../core/teste-cliente-falso.ts';
import { ClienteRpcFalso } from '../core/teste-cliente-rpc-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
// Sabado, 21:35 -- mesma relacao temporal do caso real (secao 1): "hoje" e
// sabado a noite, os horarios pedidos para "hoje" ja passaram.
const INSTANTE_ATUAL = { data: '2026-08-08', minuto_min: 21 * 60 + 35 };

const RESTAURACAO = 'bbbbbbbb-2222-4222-8222-222222222222';
const DENTISTA = 'dddddddd-4444-4444-8444-444444444444';
const CLINICA = 'cccccccc-5555-4555-8555-555555555555';

function montarCenario(tabelas: TabelasFalsas): void {
  tabelas.clinicas.push({
    id: CLINICA,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    nome: 'Cleardent',
    dentistas: [
      {
        id: DENTISTA,
        nome: 'Pablo Arruda',
        titulo: 'Dr.',
        ativo: true,
        modo: 'auto',
        dur: 30,
        inicio: '08:00',
        fim: '18:00',
        sabado: true,
        alm_ini: null,
        alm_fim: null,
        procedimentos: [{ id: RESTAURACAO, nome: 'Restauração / Cárie (1 face)', ativo: true, tempo: 30 }],
      },
    ],
  });
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: CLINICA,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: null,
    historico_conversa: [],
    atualizado_em: new Date('2026-08-08T00:00:00.000Z').toISOString(),
  });
  tabelas.procedimentos_catalogo.push({
    id: RESTAURACAO,
    nome_pt: 'Restauração / Cárie (1 face)',
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

/** As mensagens REAIS do paciente, na ordem exata da conversa de origem (spec secao 1). */
const CONVERSA: readonly string[] = Object.freeze([
  'bora marcar os pendentes. vamos fazer a restauração',
  'quero marcar para fin de mes.. na parte da tarde',
  'qual é o ulitmo dia do mes que tem disonivel. fim do mes mesmo.. 16hrs ficaria bem para min',
  'FAlei fim do mes.. agora não entendi porque vc me perguntou se hoje. ou amanha.. hoje e sabado são 21:35 da noite.. vcs estão abertos. ate agora?? amanha domingo tb esta aberto?',
  'vou perguntar novamente.. vc eta aberto hoje??? vai entaõ quero para hoje.. quero ver se tem turno mesmo, já que esta ofercendo',
  'vc e doente??? se já passou pq me pergunta outro horaio hoje..',
  'qual hoario hoje// vc ta louca?',
]);

/** Texto fixo do fallback que causou o loop no caso real (spec secao 4.1.2). */
const FALLBACK_HORARIO_PASSADO = 'Esse horário de hoje já passou. Prefere outro horário hoje, ou outro dia?';
const FALLBACK_PEDIR_DATA = 'Para qual data você gostaria de agendar? Pode ser hoje, amanhã ou uma data específica.';

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error(
      'OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.'
    );
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: CONVERSA da guarda fiscal (specs/guarda-redatora-fiscal-conversa-v1.md secao 1) ---');
  console.log(`modelo (interpretadora e redatora): ${MODELO_IRIS_NOVA}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log('banco, RPCs e agenda: SIMULADOS. IA: real nas duas pontas.');
  console.log('');

  const clienteModelo = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_IRIS_NOVA,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });
  const clienteRedator = criarClienteModeloRedatorOpenAI({
    chaveApi,
    modelo: MODELO_IRIS_NOVA,
    timeoutMs: TIMEOUT_REDATOR_MS_APROVADO,
  });

  const tabelas = criarTabelasFalsasVazias();
  montarCenario(tabelas);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteRpc = new ClienteRpcFalso({});

  const respostasFixasRepetidas: number[] = [];
  let falhas = 0;

  for (const [indice, mensagem] of CONVERSA.entries()) {
    const numero = indice + 1;

    const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpc, {
      provider: PROVIDER,
      instancia_whatsapp: INSTANCIA,
      telefone_normalizado: TELEFONE,
      mensagens_atuais: [mensagem],
      instante_atual: INSTANTE_ATUAL,
    });

    const { resposta, motivo_fallback, resposta_rejeitada_pelo_fiscal } = await gerarRespostaConversacional(
      clienteRedator,
      {
        decisao: resultado.decisao,
        mensagemPaciente: mensagem,
        naturezaMensagem: resultado.natureza_mensagem,
        historicoConversa: resultado.historico_conversa,
        dataHoje: INSTANTE_ATUAL.data,
        cadastroConhecido: resultado.cadastro_conhecido,
        ...(resultado.clinica_conhecida !== undefined ? { clinicaConhecida: resultado.clinica_conhecida } : {}),
        ...(resultado.agendamentos_do_paciente !== undefined
          ? { agendamentosDoPaciente: resultado.agendamentos_do_paciente }
          : {}),
        ...(resultado.dentistas_da_clinica !== undefined
          ? { dentistasDaClinica: resultado.dentistas_da_clinica }
          : {}),
      }
    );

    await gravarHistoricoConversa(clienteBanco, {
      conversa_id: resultado.conversa_id,
      clinica_id: resultado.clinica_id,
      telefone_normalizado: TELEFONE,
      atualizado_em_da_resposta: resultado.atualizado_em,
      historico_anterior: resultado.historico_conversa,
      mensagem_paciente: mensagem,
      resposta_iris: resposta,
    });

    console.log(`── TURNO ${numero} ──`);
    console.log(`  paciente: ${JSON.stringify(mensagem)}`);
    console.log(`  objetivo do turno: ${resultado.decisao.tipo}`);
    console.log(`  Iris:     ${JSON.stringify(resposta)}`);
    if (motivo_fallback !== null) {
      console.log(`  (fallback: ${motivo_fallback})`);
      if (resposta_rejeitada_pelo_fiscal !== null) {
        console.log(`  (texto original da redatora, reprovado pelo fiscal: ${JSON.stringify(resposta_rejeitada_pelo_fiscal)})`);
      }
    }

    if (resposta === FALLBACK_HORARIO_PASSADO || resposta === FALLBACK_PEDIR_DATA) {
      respostasFixasRepetidas.push(numero);
    }
  }

  console.log('');
  console.log('--- verificacao ---');
  console.log(`  turnos que caíram no MESMO fallback fixo do caso real: ${respostasFixasRepetidas.length} de ${CONVERSA.length}`);
  console.log(`  turnos: ${respostasFixasRepetidas.join(', ') || '(nenhum)'}`);

  // O caso real teve 5 dos 5 ultimos turnos presos no mesmo fallback fixo. A
  // correcao nao promete zero fallback (a redatora pode falhar por outros
  // motivos, ou a guarda de execucao pode reprovar por razao legitima) --
  // promete que o MESMO loop de horario/data nao se repete identico. Um
  // limiar de ate 1 (ex.: falha pontual de rede da IA) evita falso negativo
  // por instabilidade externa, sem aceitar o loop de volta.
  if (respostasFixasRepetidas.length >= 2) {
    console.log('  ✖ FALHA: o loop de fallback fixo se repetiu -- a correcao nao resolveu o caso real');
    falhas++;
  } else {
    console.log('  ✔ o loop de fallback fixo do caso real NAO se repetiu');
  }

  console.log('');
  console.log('--- resumo ---');
  console.log(falhas === 0 ? 'APROVADO: conversa real sem o loop de fallback fixo original.' : `REPROVADO: ${falhas} falha(s).`);

  process.exitCode = falhas === 0 ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
