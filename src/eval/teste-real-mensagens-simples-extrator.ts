// Runner ISOLADO, avulso, chamado manualmente: prova que o adaptador real
// da OpenAI (`src/core/cliente-modelo-openai.ts`) funciona ponta a ponta
// atraves do proprio fluxo de producao do extrator
// (`extrairAlteracoes`, src/core/interpretacao-extrator.ts) -- as mesmas
// instrucoes, o mesmo schema aprovado e a mesma validacao integral de
// entrada/saida que interpretarEAplicar ja usa. Nao integra o adaptador a
// nenhum outro fluxo (WhatsApp, banco, orquestrador) e nao cria nenhuma
// estrutura nova -- so injeta o cliente real onde o Core ja aceitava
// qualquer ClienteModeloEstruturado.
//
// Mensagens: todas sinteticas e ficticias (nenhum paciente real, nenhum
// telefone, nenhuma clinica real). Cobrem, no minimo: procedimento,
// dentista, hoje, amanha, periodo (manha/tarde), horario explicito, e
// confirmacao (tanto o caso explicito "sim" quanto um caso de hesitacao
// que NAO deve gerar confirmacao -- prova negativa da regra contra o
// modelo real, nao so contra o codigo).
//
// Chave: somente via variavel de ambiente OPENAI_API_KEY (a mesma ja
// validada no cofre canonico, .iris-secrets/openai.env), carregada
// exclusivamente por `node --env-file`. Este arquivo nunca abre, le,
// imprime ou edita nada dentro de .iris-secrets.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/teste-real-mensagens-simples-extrator.ts
//
// Nunca imprime, loga ou persiste: valor da chave, header Authorization,
// ou qualquer PII (nao ha PII possivel aqui -- todas as mensagens sao
// sinteticas e os erros exportados por este Core ja sao sanitizados por
// construcao, nunca carregam o conteudo bruto do modelo).

import {
  criarClienteModeloOpenAI,
  ErroClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { extrairAlteracoes } from '../core/interpretacao-extrator.ts';
import { InterpretacaoInvalidaError, EntradaInvalidaError } from '../core/erros.ts';

interface CasoSimples {
  titulo: string;
  categoria: string;
  mensagens_atuais: string[];
}

// Fixo, nunca aceito por argv/stdin/env -- mesmo espirito de
// execucao-real-sintetica-adaptador-openai.ts (payload congelado no
// codigo, para impedir troca acidental por dado real).
const CASOS: readonly CasoSimples[] = Object.freeze([
  { titulo: 'procedimento', categoria: 'procedimento_id', mensagens_atuais: ['Quero fazer uma limpeza.'] },
  // `dentista_id` exige `dentistas_disponiveis` no payload, que este runner
  // (mensagens simples, sem contexto) nao envia -- entao o caso de dentista
  // saiu daqui em 2026-08-09. A cobertura vive em
  // src/eval/teste-real-dentista-semantico.ts.
  { titulo: 'data hoje', categoria: 'data_texto', mensagens_atuais: ['Pode ser hoje?'] },
  { titulo: 'data amanha', categoria: 'data_texto', mensagens_atuais: ['Pode ser amanhã?'] },
  { titulo: 'periodo manha', categoria: 'periodo', mensagens_atuais: ['Prefiro de manhã.'] },
  { titulo: 'periodo tarde', categoria: 'periodo', mensagens_atuais: ['Prefiro à tarde.'] },
  { titulo: 'horario explicito', categoria: 'horario_texto', mensagens_atuais: ['Pode ser às 14h?'] },
  { titulo: 'confirmacao explicita', categoria: 'confirmacao', mensagens_atuais: ['Sim, pode confirmar.'] },
  {
    titulo: 'confirmacao ausente (hesitacao, prova negativa)',
    categoria: 'confirmacao (nao deve aparecer)',
    mensagens_atuais: ['Não sei, deixa eu pensar melhor.'],
  },
]);

interface ResultadoCaso {
  titulo: string;
  categoria: string;
  sucesso: boolean;
  alteracoes: unknown;
  erro: { tipo: string; codigo: string | null; caminho_ou_campo: string | null } | null;
  duracao_ms: number;
}

async function executarCaso(
  cliente: ReturnType<typeof criarClienteModeloOpenAI>,
  caso: CasoSimples
): Promise<ResultadoCaso> {
  const entrada = {
    mensagens_atuais: caso.mensagens_atuais,
    dados_atuais: {},
    campos_cadastrais_preenchidos: [],
  };

  const inicio = Date.now();
  try {
    const saida = await extrairAlteracoes(cliente, entrada);
    return {
      titulo: caso.titulo,
      categoria: caso.categoria,
      sucesso: true,
      alteracoes: saida.alteracoes,
      erro: null,
      duracao_ms: Date.now() - inicio,
    };
  } catch (erro) {
    const duracao_ms = Date.now() - inicio;
    if (erro instanceof ErroClienteModeloOpenAI) {
      return {
        titulo: caso.titulo,
        categoria: caso.categoria,
        sucesso: false,
        alteracoes: null,
        erro: { tipo: 'ErroClienteModeloOpenAI', codigo: `${erro.categoria}/${erro.codigo}`, caminho_ou_campo: null },
        duracao_ms,
      };
    }
    if (erro instanceof InterpretacaoInvalidaError) {
      return {
        titulo: caso.titulo,
        categoria: caso.categoria,
        sucesso: false,
        alteracoes: null,
        erro: { tipo: 'InterpretacaoInvalidaError', codigo: erro.codigo, caminho_ou_campo: erro.caminho },
        duracao_ms,
      };
    }
    if (erro instanceof EntradaInvalidaError) {
      return {
        titulo: caso.titulo,
        categoria: caso.categoria,
        sucesso: false,
        alteracoes: null,
        erro: { tipo: 'EntradaInvalidaError', codigo: null, caminho_ou_campo: erro.campo },
        duracao_ms,
      };
    }
    return {
      titulo: caso.titulo,
      categoria: caso.categoria,
      sucesso: false,
      alteracoes: null,
      erro: { tipo: 'erro_nao_classificado', codigo: null, caminho_ou_campo: null },
      duracao_ms,
    };
  }
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste real: extrator + adaptador OpenAI ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log(`OPENAI_API_KEY: presente (valor nunca exibido)`);
  console.log(`total de casos: ${CASOS.length}`);
  console.log('');

  const cliente = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const resultados: ResultadoCaso[] = [];
  for (const caso of CASOS) {
    const resultado = await executarCaso(cliente, caso);
    resultados.push(resultado);

    console.log(`[${resultado.categoria}] ${resultado.titulo}`);
    console.log(`  mensagem: ${JSON.stringify(caso.mensagens_atuais)}`);
    console.log(`  sucesso: ${resultado.sucesso}`);
    if (resultado.sucesso) {
      console.log(`  alteracoes: ${JSON.stringify(resultado.alteracoes)}`);
    } else if (resultado.erro) {
      console.log(`  erro: ${resultado.erro.tipo} codigo=${resultado.erro.codigo} caminho_ou_campo=${resultado.erro.caminho_ou_campo}`);
    }
    console.log(`  duracao: ${resultado.duracao_ms}ms`);
    console.log('');
  }

  const totalSucesso = resultados.filter((r) => r.sucesso).length;
  console.log('--- resumo ---');
  console.log(`sucesso: ${totalSucesso}/${resultados.length}`);
  process.exitCode = totalSucesso === resultados.length ? 0 : 1;
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
