// Runner ISOLADO, avulso: prova contra a OpenAI REAL que a variante
// `troca_telefone_pendente` faz a interpretadora entender a resposta a
// pergunta de troca de telefone POR SIGNIFICADO -- sem nenhum repertorio de
// frases no Core.
//
// Contrato: specs/cpf-outro-telefone-v1.md secao 2.
//
// ESTADO REALISTA: `dados_atuais` traz o agendamento JA CONFIRMADO
// (`confirmacao: 'sim'`), porque e exatamente esse o estado em que a pergunta
// acontece -- o cadastro so e pedido depois da confirmacao do horario. Isso
// tambem exercita, contra a IA real, a regra que mais importa aqui: uma
// confirmacao de HORARIO ja presente nunca pode virar autorizacao de troca de
// TELEFONE.
//
// ISOLAMENTO: o controle A/B no fim usa a MESMA frase e o MESMO historico, sem
// a pergunta pendente. Se os dois lados coincidirem, a variante nao teve efeito
// e este runner nao prova nada (docs/00-principios.md, principio do teste
// isolado).
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-troca-telefone.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { construirEntradaMinimizada, extrairAlteracoes } from '../core/interpretacao-extrator.ts';

const PROCEDIMENTO = 'cleaning';

const CATALOGO = [
  { procedimento_id: PROCEDIMENTO, nome_pt: 'Limpeza dental (profilaxia)' },
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
];

const HISTORICO = [
  {
    mensagem_paciente: 'sou Gabriel Cappello, 529.982.247-25, nasci em 10/05/1985',
    resposta_iris:
      'Esse CPF já está cadastrado aqui com outro telefone. Quer que eu passe o cadastro para este número? Ele é o que recebe lembretes, avisos e remarcações.',
    gerada_em: new Date().toISOString(),
  },
];

interface Caso {
  mensagem: string;
  /** `null` = a mensagem NAO responde a pergunta; o evento nao deve ser emitido. */
  esperado: 'sim' | 'nao' | null;
}

// Poucas e realistas. Nenhuma destas frases aparece na instrucao.
//
// As duas primeiras sao as que o Gabriel fixou como obrigatorias. As demais
// existem para cobrir os desfechos que mudam o produto: uma recusa dita de
// outro jeito, e uma mensagem que NAO responde (onde a ausencia do evento e o
// comportamento correto -- ausencia nunca pode virar negacao silenciosa).
const CASOS: readonly Caso[] = Object.freeze([
  { mensagem: 'pode sim, atualiza pro meu número', esperado: 'sim' },
  { mensagem: 'não, deixa como está', esperado: 'nao' },
  // Nao responde: duvida legitima no meio da pergunta. Nao e cenario raro --
  // e a garantia de que AUSENCIA nunca vira negacao silenciosa, o que mandaria
  // o paciente a recepcao sem ele ter recusado nada.
  { mensagem: 'por que vocês precisam disso?', esperado: null },
]);

async function resolver(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  mensagem: string,
  comPergunta: boolean
): Promise<{ resposta: 'sim' | 'nao' | null; natureza: string; confirmacaoEmitida: string | undefined }> {
  const entrada = construirEntradaMinimizada(
    [mensagem],
    // Estado real no momento da pergunta: horario ja confirmado.
    { procedimento_id: PROCEDIMENTO, data_texto: 'hoje', horario_texto: '10:00', confirmacao: 'sim' },
    undefined,
    undefined,
    HISTORICO,
    CATALOGO,
    undefined,
    undefined,
    undefined,
    comPergunta ? true : undefined
  );
  const saida = await extrairAlteracoes(cliente, entrada);
  // MESMA derivacao do Core (`lerRespostaTrocaTelefone`), aplicada aqui sobre
  // a saida real da IA. Reproduzida em vez de importada de proposito: o que
  // este runner precisa observar e o comportamento do MODELO, e uma funcao
  // interna nao exportada nao deve virar API por causa de um runner avulso.
  // MESMA ORDEM DO CORE: negacao vence o evento; duvida tambem nao autoriza.
  // Sem isso, uma recusa OU uma pergunta acompanhada de
  // `aceitar_troca_telefone` (as duas medidas, intermitentes) viraria troca de
  // telefone.
  const aceitou = saida.eventos_candidatos.some((e) => e.tipo === 'aceitar_troca_telefone');
  const resposta = !comPergunta
    ? null
    : saida.natureza_mensagem === 'negacao'
      ? 'nao'
      : saida.natureza_mensagem === 'duvida'
        ? null
        : aceitou
          ? 'sim'
          : null;
  return {
    resposta,
    natureza: saida.natureza_mensagem,
    confirmacaoEmitida: saida.alteracoes.confirmacao?.valor,
  };
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: troca_telefone_pendente (resposta por significado) ---');
  console.log('estado realista: agendamento JA confirmado (confirmacao=sim) no momento da pergunta');
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
    const bate = r.resposta === caso.esperado;
    if (bate) ok++;
    else falhas.push(`${caso.mensagem} -> resposta=${r.resposta ?? '(ausente)'} (esperado ${caso.esperado ?? '(ausente)'})`);

    console.log(
      `${bate ? 'ok    ' : 'FALHOU'} ${JSON.stringify(caso.mensagem).padEnd(40)} resposta=${String(r.resposta ?? '-').padEnd(6)} nat=${r.natureza}`
    );
  }

  const controle = await resolver(cliente, 'pode sim, atualiza pro meu número', false);
  const teveEfeito = controle.resposta === null;
  console.log('');
  console.log('--- controle A/B (mesma frase, mesmo historico, SEM a pergunta pendente) ---');
  console.log(`  "pode sim, atualiza pro meu número" -> resposta=${controle.resposta ?? '(ausente)'}`);
  console.log(`  A PERGUNTA PENDENTE TEVE EFEITO: ${teveEfeito}`);

  console.log('');
  console.log(`--- resumo --- ${ok}/${CASOS.length}, controle ${teveEfeito ? 'OK' : 'FALHOU'}`);
  if (falhas.length > 0) {
    console.log('falharam:');
    for (const f of falhas) console.log(`  - ${f}`);
  }
  process.exitCode = ok === CASOS.length && teveEfeito ? 0 : 1;
}

await main();
