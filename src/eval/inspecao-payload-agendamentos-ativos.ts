// Runner ISOLADO, avulso: INSPECAO, nao medicao e nao correcao.
//
// Mostra EXATAMENTE o que atravessa a fronteira HTTP em `agendamentos_ativos`
// -- o corpo real da requisicao a OpenAI, nao o objeto de payload interno.
//
// POR QUE A DISTINCAO IMPORTA: este projeto ja teve exatamente esse defeito.
// Em 2026-08-08, `historico_recente` existia no payload interno, passava em
// toda a suite de unidade, e NUNCA era copiado para o corpo HTTP (o corpo e
// montado campo a campo em cliente-modelo-openai.ts). O runner contra a IA
// real passou 7/7 mesmo assim. Origem do principio do teste isolado
// (docs/00-principios.md). Medir comportamento da IA sem inspecionar a
// entrada repete esse erro.
//
// Este arquivo NAO altera prompt, contrato, schema nem nenhum modulo de
// producao. Ele injeta um `fetch` que IMPRIME o corpo e delega para o fetch
// real -- a requisicao acontece de verdade, exatamente como em producao.
//
// Chave: somente via variavel de ambiente OPENAI_API_KEY (cofre canonico,
// .iris-secrets/openai.env), carregada exclusivamente por `node --env-file`.
// Este arquivo nunca abre, le, imprime ou edita nada dentro de .iris-secrets,
// e nunca imprime o header Authorization.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/inspecao-payload-agendamentos-ativos.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { construirEntradaMinimizada, extrairAlteracoes } from '../core/interpretacao-extrator.ts';
import type { SnapshotOficialConversa } from '../core/interpretacao-tipos.ts';

const APOS_INTENCAO: SnapshotOficialConversa = { intencao: 'remarcacao' };

const ID_ALVO = '11111111-1111-4111-8111-111111111111';
const ID_DISTRATOR = '22222222-2222-4222-8222-222222222222';

// Exatamente o mesmo cenario da medicao que deu 0/8 na posicao 1
// (medicao-escolha-por-procedimento.ts): alvo "Limpeza dental" no PRIMEIRO
// item, mensagem "a limpeza".
const AGENDAMENTOS_ATIVOS = [
  { agendamento_id: ID_ALVO, descricao: 'Limpeza dental com Dra. Ana Souza em 14/08 às 14:00' },
  { agendamento_id: ID_DISTRATOR, descricao: 'Consulta / Avaliação com Dr. Bruno Lima em 21/08 às 09:00' },
];

const MENSAGEM = 'a limpeza';

function separador(titulo: string): void {
  console.log('');
  console.log(`===== ${titulo} =====`);
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- inspecao: o que REALMENTE e enviado a OpenAI ---');
  console.log('Nenhum prompt, contrato ou modulo de producao foi alterado por este runner.');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');

  // --- 1. O objeto de payload INTERNO, antes da fronteira ---
  const entrada = construirEntradaMinimizada(
    [MENSAGEM],
    APOS_INTENCAO,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    AGENDAMENTOS_ATIVOS
  );

  separador('1. PAYLOAD INTERNO (EntradaInterpretacao, antes do HTTP)');
  console.log(JSON.stringify(entrada, null, 2));

  separador('1b. agendamentos_ativos NO PAYLOAD INTERNO');
  console.log(JSON.stringify(entrada.agendamentos_ativos, null, 2));

  // --- 2. O corpo HTTP REAL, capturado na fronteira ---
  let corpoCapturado: unknown = null;

  const fetchInspetor: typeof fetch = async (url, opcoes) => {
    // Nunca imprime headers (contem Authorization).
    const corpoBruto = String((opcoes as RequestInit | undefined)?.body ?? '');
    try {
      corpoCapturado = JSON.parse(corpoBruto);
    } catch {
      corpoCapturado = corpoBruto;
    }
    return fetch(url, opcoes);
  };

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
    fetch: fetchInspetor,
  });

  const saida = await extrairAlteracoes(cliente, entrada);

  const corpo = corpoCapturado as { input?: Array<{ role: string; content: string }>; instructions?: string } | null;

  separador('2. CORPO HTTP REAL -- estrutura de nivel superior (chaves)');
  console.log(corpo === null ? '(nada capturado)' : JSON.stringify(Object.keys(corpo), null, 2));

  const mensagemUsuario = corpo?.input?.find((i) => i.role === 'user');
  const conteudoUsuario = mensagemUsuario?.content;

  separador('3. CONTEUDO role=user -- a STRING EXATA que a IA recebe');
  console.log(conteudoUsuario ?? '(ausente)');

  separador('4. agendamentos_ativos DENTRO do corpo HTTP (parseado)');
  if (typeof conteudoUsuario === 'string') {
    try {
      const parseado = JSON.parse(conteudoUsuario) as Record<string, unknown>;
      console.log('chaves presentes no corpo:', JSON.stringify(Object.keys(parseado)));
      console.log('');
      console.log('agendamentos_ativos:');
      console.log(JSON.stringify(parseado.agendamentos_ativos, null, 2));

      separador('5. VERIFICACAO DE FRONTEIRA (payload interno vs. corpo HTTP)');
      const internoSerializado = JSON.stringify(entrada.agendamentos_ativos);
      const corpoSerializado = JSON.stringify(parseado.agendamentos_ativos);
      console.log(`presente no corpo HTTP: ${'agendamentos_ativos' in parseado}`);
      console.log(`identico ao payload interno: ${internoSerializado === corpoSerializado}`);
      if (internoSerializado !== corpoSerializado) {
        console.log('  interno:', internoSerializado);
        console.log('  corpo  :', corpoSerializado);
      }
    } catch (erro) {
      console.log('(nao foi possivel parsear o conteudo como JSON)', erro instanceof Error ? erro.message : '');
    }
  }

  separador('6. ESTRUTURA DE `input` -- quantas mensagens, quais papeis');
  for (const item of corpo?.input ?? []) {
    console.log(`  role=${item.role}  (${String(item.content).length} chars)`);
  }

  separador('7. INSTRUCOES -- as linhas relevantes a esta decisao');
  // As instrucoes NAO vao no campo `instructions` do corpo -- vao como uma
  // mensagem de papel proprio dentro de `input`. Procurar em todas.
  const todasInstrucoes = (corpo?.input ?? [])
    .filter((i) => i.role !== 'user')
    .map((i) => String(i.content))
    .join('\n');

  for (const linha of todasInstrucoes.split('\n')) {
    const l = linha.trim();
    if (
      l.includes('agendamentos_ativos') ||
      l.includes('procedimentos_disponiveis') ||
      l.startsWith('Campos permitidos')
    ) {
      console.log(l);
      console.log('');
    }
  }

  separador('8. RESPOSTA DA IA para esta chamada');
  console.log(JSON.stringify(saida.alteracoes, null, 2));
  console.log(`natureza_mensagem: ${saida.natureza_mensagem}`);

  separador('9. CAMPOS QUE O SCHEMA PERMITE A IA EMITIR');
  const texto = (corpoCapturado as { text?: { format?: { schema?: { properties?: { alteracoes?: { properties?: Record<string, unknown> } } } } } } | null)?.text;
  const propriedadesAlteracoes = texto?.format?.schema?.properties?.alteracoes?.properties;
  console.log(propriedadesAlteracoes === undefined ? '(nao encontrado)' : JSON.stringify(Object.keys(propriedadesAlteracoes), null, 2));
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
