// Runner ISOLADO, avulso: prova contra a OpenAI REAL que a interpretadora
// extrai os quatro campos cadastrais do jeito que uma pessoa os escreve.
//
// Contrato: specs/cadastro-conversacional-v1.md secao 3.
//
// O QUE ESTE RUNNER PROVA: que a IA ENTENDE e devolve o valor. Ele NAO prova
// validade -- quem confere digito de CPF, data real e formato de e-mail e o
// Core (validar-cadastro.ts), com teste deterministico proprio. Por isso as
// assercoes aqui sao sobre extracao, nunca sobre aceitacao.
//
// FRASES PLAUSIVEIS APENAS (docs/00-principios.md, principio dos testes
// realistas): tudo abaixo e coisa que alguem realmente digitaria no WhatsApp
// ao ser perguntado pelo cadastro. Nada de construcao artificial.
//
// Todos os dados sao SINTETICOS. O CPF usado e valido nos digitos
// verificadores de proposito -- um CPF impossivel nos fixtures seria um dado
// que nunca existiria na vida real.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-cadastro.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { construirEntradaMinimizada, extrairAlteracoes } from '../core/interpretacao-extrator.ts';

const NOME = 'Gabriel Cappello';
const CPF_DIGITOS = '52998224725';

const PROCEDIMENTOS = [
  { procedimento_id: 'cleaning', nome_pt: 'Limpeza dental (profilaxia)' },
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
];

// A Iris acabou de pedir o cadastro -- e o contexto real em que essas
// mensagens aparecem.
const HISTORICO = [
  {
    mensagem_paciente: 'sim, pode confirmar',
    resposta_iris: 'Para confirmar, preciso completar seu cadastro. Pode me passar seu nome, seu CPF e sua data de nascimento?',
    gerada_em: new Date().toISOString(),
  },
];

interface Caso {
  titulo: string;
  mensagem: string;
  /** Campo -> valor esperado. Ausente da lista = nao deve ser emitido. */
  esperado: Partial<Record<'nome' | 'cpf' | 'data_nascimento' | 'email', string>>;
}

const CASOS: readonly Caso[] = Object.freeze([
  {
    titulo: 'nome sozinho, como a pessoa responde',
    mensagem: 'Gabriel Cappello',
    esperado: { nome: NOME },
  },
  {
    titulo: 'CPF com pontuacao',
    mensagem: '529.982.247-25',
    esperado: { cpf: CPF_DIGITOS },
  },
  {
    titulo: 'data no formato brasileiro -> ISO (dia antes do mes)',
    mensagem: '10/05/1985',
    esperado: { data_nascimento: '1985-05-10' },
  },
  {
    titulo: 'data por extenso -> ISO',
    mensagem: 'nasci em 5 de outubro de 1990',
    esperado: { data_nascimento: '1990-10-05' },
  },
  {
    titulo: 'os tres de uma vez, numa frase so',
    mensagem: 'Gabriel Cappello, 529.982.247-25, nascimento 10/05/1985',
    esperado: { nome: NOME, cpf: CPF_DIGITOS, data_nascimento: '1985-05-10' },
  },
  {
    titulo: 'e-mail quando pedido',
    mensagem: 'meu email e gabriel.cappello@exemplo-sintetico.test',
    esperado: { email: 'gabriel.cappello@exemplo-sintetico.test' },
  },
]);

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: extracao cadastral (nome, cpf, data_nascimento, email) ---');
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
    const entrada = construirEntradaMinimizada(
      [caso.mensagem],
      { procedimento_id: 'cleaning', confirmacao: 'sim' },
      undefined,
      undefined,
      HISTORICO,
      PROCEDIMENTOS
    );
    const saida = await extrairAlteracoes(cliente, entrada);

    const obtido: Record<string, string> = {};
    for (const campo of ['nome', 'cpf', 'data_nascimento', 'email']) {
      const alteracao = saida.alteracoes[campo];
      if (alteracao?.valor !== undefined) obtido[campo] = alteracao.valor;
    }

    const bate = Object.entries(caso.esperado).every(([campo, valor]) => obtido[campo] === valor);
    if (bate) ok++;
    else falhas.push(`${caso.titulo} -> ${JSON.stringify(obtido)} (esperado ${JSON.stringify(caso.esperado)})`);

    console.log(`${bate ? 'ok    ' : 'FALHOU'} ${caso.titulo}`);
    console.log(`  mensagem: ${JSON.stringify(caso.mensagem)}`);
    console.log(`  esperado: ${JSON.stringify(caso.esperado)}`);
    console.log(`  obtido:   ${JSON.stringify(obtido)}`);
    console.log('');
  }

  console.log(`--- resumo --- ${ok}/${CASOS.length}`);
  if (falhas.length > 0) {
    console.log('falharam:');
    for (const f of falhas) console.log(`  - ${f}`);
  }
  process.exitCode = ok === CASOS.length ? 0 : 1;
}

main().catch((erro) => {
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${erro instanceof Error ? erro.message : 'desconhecido'}`);
  process.exitCode = 1;
});
