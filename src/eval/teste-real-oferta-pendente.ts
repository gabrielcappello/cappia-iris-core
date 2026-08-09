// Runner ISOLADO, avulso: prova contra a OpenAI REAL que a variante
// `oferta_procedimento_pendente` faz a interpretadora entender a aceitacao de
// uma oferta POR SIGNIFICADO -- sem nenhum repertorio de frases.
//
// Contrato: specs/contexto-pendente-interpretacao-v1.md secao 11.
//
// ESTADO REALISTA (licao cara, 2026-08-09): `dados_atuais` traz
// `procedimento_id` JA PREENCHIDO com o pedido original. Uma sonda anterior
// mandou `dados_atuais: {}` e deu 9/9 -- resultado que NAO se sustentou com o
// estado real. Com o campo preenchido, a aceitacao precisa vir como
// `corrigir`; um `informar` com valor diferente e tratado como conflito por
// `preAplicar` e descartado em silencio. Todo caso aqui usa o estado real.
//
// CONTRATO (2026-08-09, revisao final): a IA NAO emite `procedimento_id` para
// aceitar. Ela produz o candidato `aceitar_opcao` (eventos-conversacionais-v1.md);
// o Core, que guarda o id ofertado, e quem aplica. Este runner observa o
// EVENTO -- e verifica, em todos os casos, que nenhum `procedimento_id` sai
// por causa de aceitacao.
//
// ISOLAMENTO: o ultimo caso e o controle A/B -- mesma frase, mesma historia,
// SEM a oferta pendente. Se os dois lados coincidirem, a variante nao teve
// efeito e o teste inteiro nao prova nada.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-oferta-pendente.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { construirEntradaMinimizada, extrairAlteracoes } from '../core/interpretacao-extrator.ts';

const OFERECIDO = 'consultation_evaluation';
const PEDIDO_ORIGINAL = 'whitening';

const CATALOGO = [
  { procedimento_id: OFERECIDO, nome_pt: 'Consulta / Avaliação' },
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental (profilaxia)' },
  { procedimento_id: PEDIDO_ORIGINAL, nome_pt: 'Clareamento em consultório' },
];

const HISTORICO = [
  {
    mensagem_paciente: 'quero clareamento',
    resposta_iris: 'Não encontrei nenhum profissional para clareamento. Posso verificar uma Consulta/Avaliação em vez disso?',
    gerada_em: new Date().toISOString(),
  },
];

interface Caso {
  mensagem: string;
  /** O paciente esta aceitando a oferta pendente? */
  aceita: boolean;
  /** `procedimento_id` esperado pela regra NORMAL (pedido explicito), se houver. */
  procedimentoEsperado?: string;
}

// Poucos e realistas. Nenhuma destas frases aparece na instrucao.
//
// LIMITE CONHECIDO, medido em 2026-08-09 (~1 em 4 execucoes): no ultimo caso
// ("na verdade quero uma limpeza"), o modelo as vezes emite `aceitar_opcao`
// ESPURIO junto da correcao explicita de procedimento -- mesmo padrao do
// "prefiro outra coisa" antes da checagem de sinais incompativeis, so que
// aqui a natureza vem `correcao`, nao `negacao`, entao a guarda de negacao
// nao pega.
//
// Nao e um bug de produto: `aplicarAceitacaoDeOferta` (interpretar-e-
// aplicar.ts) da precedencia ao `procedimento_id` explicito ANTES de olhar
// o evento -- `if (alteracoes.procedimento_id !== undefined) return
// alteracoes`. Verificado manualmente na execucao em que isso ocorreu: o
// resultado aplicado continuou sendo `cleaning`, nunca a oferta. A falha
// deste teste e so do EVENTO diagnostico, nunca do comportamento final.
//
// Registrado e nao "corrigido" no prompt por decisao consciente: seria mais
// uma regra para um caso que o Core ja neutraliza pela propria precedencia
// estrutural (docs/00-principios.md).
const CASOS: readonly Caso[] = Object.freeze([
  { mensagem: 'pode ser', aceita: true },
  { mensagem: 'sim, quero', aceita: true },
  { mensagem: 'prefiro outra coisa', aceita: false },
  // Pedido explicito por outro procedimento: regra normal, e NAO aceitacao.
  { mensagem: 'na verdade quero uma limpeza', aceita: false, procedimentoEsperado: 'cleaning' },
]);

async function resolver(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  mensagem: string,
  comOferta: boolean
): Promise<{
  acao: string | undefined;
  valor: string | undefined;
  natureza: string;
  aceitouOpcao: boolean;
  referencia: string | null | undefined;
}> {
  const entrada = construirEntradaMinimizada(
    [mensagem],
    { procedimento_id: PEDIDO_ORIGINAL },
    undefined,
    undefined,
    HISTORICO,
    CATALOGO,
    undefined,
    comOferta ? true : undefined
  );
  const saida = await extrairAlteracoes(cliente, entrada);
  const alteracao = saida.alteracoes.procedimento_id;
  return {
    acao: alteracao?.acao,
    valor: alteracao?.valor,
    natureza: saida.natureza_mensagem,
    aceitouOpcao: saida.eventos_candidatos.some((e) => e.tipo === 'aceitar_opcao'),
    referencia: saida.eventos_candidatos.find((e) => e.tipo === 'aceitar_opcao')?.referencia_textual,
  };
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: oferta_procedimento_pendente (aceitacao por significado) ---');
  console.log(`estado realista: dados_atuais.procedimento_id = ${PEDIDO_ORIGINAL}; oferta = ${OFERECIDO}`);
  console.log('');

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  let ok = 0;
  const falhas: string[] = [];
  for (const caso of CASOS) {
    const r = await resolver(cliente, caso.mensagem, true);

    const eventoOk = r.aceitouOpcao === caso.aceita;
    // A IA NUNCA pode emitir procedimento_id por causa de aceitacao. Quando
    // ha pedido explicito, o campo vem pela regra normal -- e so nesse caso.
    const procedimentoOk = r.valor === caso.procedimentoEsperado;
    const bate = eventoOk && procedimentoOk;
    if (bate) ok++;
    else {
      falhas.push(
        `${caso.mensagem} -> aceitar_opcao=${r.aceitouOpcao} (esperado ${caso.aceita}), procedimento_id=${r.valor ?? '(ausente)'} (esperado ${caso.procedimentoEsperado ?? '(ausente)'})`
      );
    }

    console.log(
      `${bate ? 'ok    ' : 'FALHOU'} ${JSON.stringify(caso.mensagem).padEnd(32)} aceitar_opcao=${String(r.aceitouOpcao).padEnd(5)} ref=${r.referencia === undefined ? '-' : JSON.stringify(r.referencia)} procedimento_id=${r.valor ?? '(ausente)'} nat=${r.natureza}`
    );
  }

  const controle = await resolver(cliente, 'pode ser', false);
  const teveEfeito = !controle.aceitouOpcao;
  console.log('');
  console.log('--- controle A/B (mesma frase, mesmo historico, SEM a oferta pendente) ---');
  console.log(`  "pode ser" -> aceitar_opcao=${controle.aceitouOpcao} procedimento_id=${controle.valor ?? '(ausente)'}`);
  console.log(`  A OFERTA TEVE EFEITO: ${teveEfeito}`);

  console.log('');
  console.log(`--- resumo --- ${ok}/${CASOS.length}, controle ${teveEfeito ? 'OK' : 'FALHOU'}`);
  if (falhas.length > 0) {
    console.log('falharam:');
    for (const f of falhas) console.log(`  - ${f}`);
  }
  process.exitCode = ok === CASOS.length && teveEfeito ? 0 : 1;
}

main().catch((erro) => {
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${erro instanceof Error ? erro.message : 'desconhecido'}`);
  process.exitCode = 1;
});
