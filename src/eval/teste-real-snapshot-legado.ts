// Runner ISOLADO, avulso: reproduz o INCIDENTE REAL de producao (2026-08-12,
// auditoria da Iris Nova) -- uma conversa com `estado_conversa.dados`
// contendo `procedimento_texto` (campo de uma versao anterior do contrato,
// substituido por `procedimento_id` em procedimento-semantico-v1.md) travava
// TODA mensagem nova com HTTP 400 `entrada_invalida`, mesmo uma saudacao
// pura sem nenhuma relacao com o campo legado.
//
// Mensagem real -> OpenAI REAL (interpretadora) -> orquestrador -> OpenAI
// REAL (redatora) -> texto. Banco e RPC sao dubles em memoria, semeados com
// o EXATO snapshot legado observado no incidente real.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-snapshot-legado.ts

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
const INSTANCIA = 'clinica-teste-real-snapshot-legado';
// Mesmo telefone do incidente real: sem ficha em `pacientes` (paciente nunca
// se cadastrou) -- e exatamente por isso que a hipotese inicial (bug na
// frente de consulta, via buscarAgendamentoAtivo) foi descartada no
// rastreamento estatico: aquele caminho exige paciente_id != null.
const TELEFONE = '5521988046011';
const INSTANTE_ATUAL = { data: '2026-08-12', minuto_min: 900 };

function montarCenario(): TabelasFalsas {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = crypto.randomUUID();

  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [],
  });

  // O SNAPSHOT LEGADO EXATO observado no incidente real: `periodo` e
  // `data_texto` ainda pertencem ao contrato atual; `procedimento_texto` foi
  // substituido por `procedimento_id` e nao existe mais em CAMPOS_PERMITIDOS.
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { periodo: 'manha', data_texto: 'amanhã', procedimento_texto: 'Avaliação né' },
    paciente_id: null,
    contexto_horarios: null,
    atualizado_em: new Date('2026-08-08T01:15:32.847Z').toISOString(),
  });

  return tabelas;
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: conversa com snapshot legado (procedimento_texto) nao trava mais ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log('Interpretadora E redatora reais; banco e RPC dublados, com o snapshot legado real semeado.');
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
  const mensagem = 'ola. boa tarde';
  console.log(`[mensagem real do incidente] "${mensagem}"`);

  const tabelas = montarCenario();
  const clienteBanco: ClienteBancoDados = new ClienteFalso(tabelas);

  try {
    const resultado = await processarMensagem(clienteModelo, clienteBanco, new ClienteRpcFalso({}), {
      provider: PROVIDER,
      instancia_whatsapp: INSTANCIA,
      telefone_normalizado: TELEFONE,
      mensagens_atuais: [mensagem],
      instante_atual: INSTANTE_ATUAL,
    });

    console.log(`  decisao: ${resultado.decisao.tipo} | natureza: ${resultado.natureza_mensagem}`);

    const { resposta, motivo_fallback } = await gerarRespostaConversacional(clienteRedator, {
      decisao: resultado.decisao,
      mensagemPaciente: mensagem,
      naturezaMensagem: resultado.natureza_mensagem,
      historicoConversa: resultado.historico_conversa,
      dataHoje: INSTANTE_ATUAL.data,
    });

    console.log(`  >>> Iris: ${JSON.stringify(resposta)}`);
    console.log(`  fallback: ${motivo_fallback ?? '(nenhum -- redatora aprovada pela guarda)'}`);
    console.log('  RESULTADO: conversa completou sem excecao -- o snapshot legado nao bloqueou o turno.');
  } catch (erro) {
    console.error(
      `  FALHOU: processarMensagem lancou excecao para o snapshot legado -- ${erro instanceof Error ? `${erro.name}: ${erro.message}` : 'erro desconhecido'}`
    );
    erros++;
  }

  console.log('');
  console.log('--- resumo ---');
  console.log(erros === 0 ? 'PASSOU: snapshot legado nao trava mais a conversa' : `${erros} FALHA(S)`);
  process.exitCode = erros === 0 ? 0 : 1;
}

main().catch((erro) => {
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
