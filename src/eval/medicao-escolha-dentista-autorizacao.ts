// Runner ISOLADO, avulso, chamado manualmente: mede se a INTERPRETADORA real
// reconhece a escolha de profissional na frase exata do defeito observado em
// producao (v93, 31/08/2026, turno das 13:34:04 UTC).
//
// Defeito medido nos logs: com a mensagem
//   "diego perez deve ser... pode marcar com ele mesmo"
// a interpretadora devolveu `dentistas_candidatos = null`. Sem candidatos, o
// Core nao persistiu `dentista_id` e o fluxo ficou preso em
// `aguardando_escolha_dentista` por tres turnos.
//
// O que este runner responde:
//   1. a falha e ESTAVEL ou VARIAVEL? (N repeticoes da mesma frase)
//   2. e a frase inteira, ou algum trecho especifico dela? (variantes de
//      controle, uma variavel por vez)
//
// NAO altera prompt, Core nem nada. So mede. Nenhuma regex, alias ou
// resolucao de nome e proposta aqui -- o objetivo e descobrir o
// comportamento real antes de propor ajuste.
//
// Dados sinteticos: os nomes dos profissionais sao os da clinica de teste.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-escolha-dentista-autorizacao.ts

import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_IRIS_NOVA,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { INSTRUCOES_EXTRATOR, SCHEMA_SAIDA_INTERPRETACAO } from '../core/interpretacao-instrucoes.ts';

const REPETICOES = 5;

const ID_PEREZ = '9c693b86-5113-41d4-b97d-be52a579ae8c';
const ID_RAMOZ = '11111111-2222-3333-4444-555555555555';
const ID_ARRUDA = '66666666-7777-8888-9999-000000000000';

const DENTISTAS = [
  { dentista_id: ID_PEREZ, nome_exibido: 'Dr. Diego Perez' },
  { dentista_id: ID_RAMOZ, nome_exibido: 'Dr. Diego Ramoz' },
  { dentista_id: ID_ARRUDA, nome_exibido: 'Dr. Pablo Arruda' },
];

const PROCEDIMENTOS = [
  { procedimento_id: 'consultation_evaluation', nome_exibido: 'Consulta / Avaliação' },
];

interface Caso {
  titulo: string;
  mensagem: string;
  /** O que a interpretadora DEVERIA devolver em `dentistas_candidatos`. */
  esperado: string[];
}

const CASOS: readonly Caso[] = Object.freeze([
  // O CASO REAL, exatamente como o paciente escreveu.
  {
    titulo: 'REAL: "diego perez deve ser... pode marcar com ele mesmo"',
    mensagem: 'diego perez deve ser... pode marcar com ele mesmo',
    esperado: [ID_PEREZ],
  },
  // Controles: UMA variavel por vez, para isolar o que confunde o modelo.
  {
    titulo: 'controle A: so o nome, sem hesitacao e sem autorizacao',
    mensagem: 'diego perez',
    esperado: [ID_PEREZ],
  },
  {
    titulo: 'controle B: nome + autorizacao, SEM a hesitacao "deve ser"',
    mensagem: 'diego perez, pode marcar com ele mesmo',
    esperado: [ID_PEREZ],
  },
  {
    titulo: 'controle C: nome + hesitacao, SEM a autorizacao final',
    mensagem: 'diego perez deve ser...',
    esperado: [ID_PEREZ],
  },
  {
    titulo: 'controle D: nome completo e afirmativo (linha de base)',
    mensagem: 'quero com o Dr. Diego Perez',
    esperado: [ID_PEREZ],
  },
]);

function montarPayload(mensagem: string) {
  return {
    conversa_id: '00000000-0000-4000-8000-000000000001',
    clinica_id: '00000000-0000-4000-8000-000000000002',
    telefone_normalizado: '5511900000000',
    mensagens_atuais: [mensagem],
    // Estado REAL do turno: procedimento e data ja resolvidos, dentista NAO.
    // E exatamente o payload que o turno das 13:34 recebeu.
    dados_atuais: {
      intencao: 'novo_agendamento',
      procedimento_texto: 'avaliação',
      data_texto: 'amanha',
    },
    procedimentos_disponiveis: PROCEDIMENTOS,
    dentistas_disponiveis: DENTISTAS,
    historico_recente: [
      {
        mensagem_paciente: 'vc não sabe qual é meu dentista que já me atendi antes?',
        resposta_iris:
          'Eu não consigo identificar com segurança qual profissional já te atendeu antes. Entre os dentistas da Cleardent, você se lembra se era o Dr. Diego Perez, o Dr. Diego Ramoz ou o Dr. Pablo Arruda?',
        gerada_em: new Date().toISOString(),
      },
    ],
  };
}

function rotularCandidatos(c: unknown): string {
  if (c === null) return 'null';
  if (!Array.isArray(c)) return String(c);
  if (c.length === 0) return '[] (vazio)';
  return c
    .map((id) => {
      const d = DENTISTAS.find((x) => x.dentista_id === id);
      return d ? d.nome_exibido : String(id);
    })
    .join(', ');
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env.');
    process.exitCode = 1;
    return;
  }

  console.log('--- medicao: escolha de dentista com autorizacao explicita ---');
  console.log(`modelo: ${MODELO_IRIS_NOVA}`);
  console.log(`repeticoes por caso: ${REPETICOES}`);
  console.log('');

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_IRIS_NOVA,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  for (const caso of CASOS) {
    const observados: string[] = [];
    let acertos = 0;

    for (let i = 0; i < REPETICOES; i++) {
      try {
        const saida = await cliente.executar({
          instrucoes: INSTRUCOES_EXTRATOR,
          schema: SCHEMA_SAIDA_INTERPRETACAO,
          payload: montarPayload(caso.mensagem) as never,
        });
        const cand = (saida as { dentistas_candidatos?: unknown }).dentistas_candidatos ?? null;
        observados.push(rotularCandidatos(cand));
        const lista = Array.isArray(cand) ? cand : [];
        if (lista.length === caso.esperado.length && caso.esperado.every((e) => lista.includes(e))) acertos++;
      } catch (erro) {
        observados.push('ERRO: ' + (erro instanceof Error ? erro.message : 'desconhecido'));
      }
    }

    const estavel = new Set(observados).size === 1;
    console.log(caso.titulo);
    console.log(`  mensagem : ${JSON.stringify(caso.mensagem)}`);
    console.log(`  esperado : ${rotularCandidatos(caso.esperado)}`);
    console.log(`  observado: ${observados.join(' | ')}`);
    console.log(`  acertos  : ${acertos}/${REPETICOES}  (${estavel ? 'ESTAVEL' : 'VARIAVEL'})`);
    console.log('');
  }
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
