// Smoke test ISOLADO de compatibilidade: comprova se o schema de
// transporte aprovado da Iris Nova e aceito pelo Structured Outputs da
// OpenAI, usando somente dados sinteticos e ficticios.
//
// NAO E o adaptador real. NAO importa nem toca em nenhum modulo de
// src/core/. NAO altera fluxo de producao, banco, schema SQL, migracao,
// RPC ou Edge Function. NAO escolhe definitivamente um provedor/modelo.
//
// Limites de consumo absolutos (nunca ultrapassados, protegidos em codigo):
//   - provedor unico: OpenAI
//   - modelo unico: gpt-4.1-mini-2025-04-14
//   - maximo absoluto de chamadas reais: 3
//   - chamadas sequenciais, nunca simultaneas
//   - retry: 0 (nenhuma chamada extra em caso de erro)
//   - max_output_tokens: 256 por chamada
//   - timeout: 8000ms por chamada
//
// Credencial: somente via --env-file, nunca lida/impressa por este script.
//   node --env-file="C:\Users\Gabriel\.iris-secrets\iris-model-eval.env" src/eval/smoke-test-openai-structured-outputs.ts
//
// Variavel esperada: IRIS_EVAL_OPENAI_API_KEY (valor nunca impresso,
// logado, incluido em erro ou commitado).

const PROVEDOR = 'openai' as const;
const MODELO = 'gpt-4.1-mini-2025-04-14' as const;
const MAX_CHAMADAS = 3 as const;
const RETRY = 0 as const;
const MAX_OUTPUT_TOKENS = 256 as const;
const TIMEOUT_MS = 8000 as const;
const URL_RESPONSES = 'https://api.openai.com/v1/responses';

// Precos aproximados de gpt-4.1-mini por 1M de tokens (conferir o valor
// oficial atual antes de decidir qualquer coisa com base nesta estimativa
// -- este script so estima, nunca afirma o preco vigente).
const PRECO_USD_POR_1M_INPUT = 0.4;
const PRECO_USD_POR_1M_OUTPUT = 1.6;

// --- Schema exato aprovado (copiado literalmente da tarefa, sem nenhuma alteracao) ---
const SCHEMA_APROVADO = {
  type: 'object',
  properties: {
    alteracoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          campo: {
            type: 'string',
            enum: [
              'intencao',
              'procedimento_texto',
              'dentista_texto',
              'data_texto',
              'periodo',
              'horario_texto',
              'nome',
              'cpf',
              'data_nascimento',
              'email',
            ],
          },
          acao: {
            type: 'string',
            enum: ['informar', 'corrigir', 'remover'],
          },
          valor: {
            type: ['string', 'null'],
          },
        },
        required: ['campo', 'acao', 'valor'],
        additionalProperties: false,
      },
    },
  },
  required: ['alteracoes'],
  additionalProperties: false,
} as const;

// Instrucoes MINIMAS deste smoke test -- nao e o prompt de producao
// (evita gastar tokens com regras nao exercitadas pelos 3 casos abaixo).
const INSTRUCOES_MINIMAS = `
Voce recebe mensagens de um paciente ficticio e o estado atual (ficticio) de dados ja coletados para um agendamento odontologico. Devolva somente o efeito final estruturado, como uma lista de alteracoes.

Regras:
- Campos permitidos: intencao, procedimento_texto, dentista_texto, data_texto, periodo, horario_texto, nome, cpf, data_nascimento, email.
- Acoes permitidas: informar, corrigir, remover.
- informar e corrigir usam "valor" como string.
- remover usa "valor": null.
- Nao infira campos que nao foram mencionados.
- "alteracoes" vazia e uma resposta valida quando nada foi decidido.
- Nao escreva nenhuma explicacao nem resposta ao paciente -- somente o JSON estruturado.
`.trim();

// Casos sinteticos -- todos os nomes, mensagens e dados sao ficticios.
interface CasoSintetico {
  titulo: string;
  mensagens_atuais: string[];
  dados_atuais: Record<string, string>;
}

const CASOS: readonly CasoSintetico[] = [
  {
    titulo: 'dados informados',
    mensagens_atuais: ['Quero fazer uma limpeza na sexta a tarde.'],
    dados_atuais: {},
  },
  {
    titulo: 'nenhuma alteracao',
    mensagens_atuais: ['Ainda nao sei o que quero marcar.'],
    dados_atuais: {},
  },
  {
    titulo: 'remocao',
    mensagens_atuais: ['Pode apagar meu e-mail.'],
    dados_atuais: { email: 'paciente.teste@example.com' },
  },
];

// --- Validacao local do schema aprovado (estrutural, sem duplicar o texto inteiro) ---
function validarSchemaAprovadoLocalmente(): void {
  const raiz = SCHEMA_APROVADO;
  const item = raiz.properties.alteracoes.items;
  const campo = item.properties.campo;
  const acao = item.properties.acao;
  const valor = item.properties.valor;

  const falhas: string[] = [];
  if (raiz.additionalProperties !== false) falhas.push('raiz.additionalProperties');
  if (JSON.stringify(raiz.required) !== JSON.stringify(['alteracoes'])) falhas.push('raiz.required');
  if (raiz.properties.alteracoes.type !== 'array') falhas.push('alteracoes.type');
  if (item.additionalProperties !== false) falhas.push('item.additionalProperties');
  if (JSON.stringify(item.required) !== JSON.stringify(['campo', 'acao', 'valor'])) falhas.push('item.required');
  if (
    JSON.stringify(campo.enum) !==
    JSON.stringify([
      'intencao',
      'procedimento_texto',
      'dentista_texto',
      'data_texto',
      'periodo',
      'horario_texto',
      'nome',
      'cpf',
      'data_nascimento',
      'email',
    ])
  )
    falhas.push('campo.enum');
  if (JSON.stringify(acao.enum) !== JSON.stringify(['informar', 'corrigir', 'remover'])) falhas.push('acao.enum');
  if (JSON.stringify(valor.type) !== JSON.stringify(['string', 'null'])) falhas.push('valor.type');

  if (falhas.length > 0) {
    throw new Error(`schema local diverge do aprovado nos campos: ${falhas.join(', ')} -- abortando antes de qualquer chamada`);
  }
}

// --- Guarda de orcamento de chamadas: torna impossivel ultrapassar MAX_CHAMADAS ---
let chamadasRealizadas = 0;

function reservarUmaChamada(): number {
  if (chamadasRealizadas >= MAX_CHAMADAS) {
    throw new Error(`bloqueio local: tentativa de exceder o maximo de ${MAX_CHAMADAS} chamadas`);
  }
  chamadasRealizadas += 1;
  return chamadasRealizadas;
}

// --- Sanitizacao: nunca deixar a chave ou headers vazarem em nenhuma saida ---
function sanitizar(texto: string): string {
  return texto
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}

interface ResultadoChamada {
  numero: number;
  titulo: string;
  statusHttp: number | null;
  sucesso: boolean;
  erroSanitizado: string | null;
  objetoRecebido: unknown;
  duracaoMs: number;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  motivoParada: 'auth_invalida' | 'schema_rejeitado' | null;
}

async function chamarComTimeout(url: string, opcoes: RequestInit, timeoutMs: number): Promise<Response> {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opcoes, signal: controlador.signal });
  } finally {
    clearTimeout(timer);
  }
}

function validarEstruturaResposta(objeto: unknown): { valido: boolean; problemas: string[] } {
  const problemas: string[] = [];
  if (objeto === null || typeof objeto !== 'object' || Array.isArray(objeto)) {
    return { valido: false, problemas: ['raiz nao e objeto'] };
  }
  const chaves = Object.keys(objeto as Record<string, unknown>);
  if (chaves.length !== 1 || chaves[0] !== 'alteracoes') problemas.push('raiz nao contem somente "alteracoes"');

  const alteracoes = (objeto as { alteracoes?: unknown }).alteracoes;
  if (!Array.isArray(alteracoes)) {
    problemas.push('"alteracoes" nao e array');
    return { valido: problemas.length === 0, problemas };
  }
  for (const [indice, item] of alteracoes.entries()) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      problemas.push(`item[${indice}] nao e objeto`);
      continue;
    }
    const chavesItem = Object.keys(item as Record<string, unknown>).sort();
    if (JSON.stringify(chavesItem) !== JSON.stringify(['acao', 'campo', 'valor'])) {
      problemas.push(`item[${indice}] nao contem somente campo/acao/valor`);
    }
  }
  return { valido: problemas.length === 0, problemas };
}

async function executarCaso(caso: CasoSintetico): Promise<ResultadoChamada> {
  const numero = reservarUmaChamada();
  const inicio = Date.now();

  const corpo = {
    model: MODELO,
    input: [
      { role: 'system', content: INSTRUCOES_MINIMAS },
      { role: 'user', content: JSON.stringify({ mensagens_atuais: caso.mensagens_atuais, dados_atuais: caso.dados_atuais }) },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'alteracoes_iris_smoke_test',
        schema: SCHEMA_APROVADO,
        strict: true,
      },
    },
    max_output_tokens: MAX_OUTPUT_TOKENS,
  };
  // nenhuma chave 'tools' incluida em nenhuma hipotese.

  const apiKey = process.env.IRIS_EVAL_OPENAI_API_KEY as string;

  let resposta: Response;
  try {
    resposta = await chamarComTimeout(
      URL_RESPONSES,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(corpo),
      },
      TIMEOUT_MS
    );
  } catch (erroRede) {
    const duracaoMs = Date.now() - inicio;
    const mensagem = erroRede instanceof Error ? erroRede.message : 'erro de rede desconhecido';
    return {
      numero,
      titulo: caso.titulo,
      statusHttp: null,
      sucesso: false,
      erroSanitizado: sanitizar(mensagem),
      objetoRecebido: null,
      duracaoMs,
      tokensEntrada: null,
      tokensSaida: null,
      motivoParada: null,
    };
  }

  const duracaoMs = Date.now() - inicio;
  const corpoResposta = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    const mensagemErro = sanitizar(JSON.stringify(corpoResposta?.error ?? corpoResposta ?? {}));
    let motivoParada: ResultadoChamada['motivoParada'] = null;
    if (resposta.status === 401) motivoParada = 'auth_invalida';
    else if (resposta.status === 400 && /schema|strict|json_schema/i.test(mensagemErro)) motivoParada = 'schema_rejeitado';

    return {
      numero,
      titulo: caso.titulo,
      statusHttp: resposta.status,
      sucesso: false,
      erroSanitizado: mensagemErro,
      objetoRecebido: null,
      duracaoMs,
      tokensEntrada: null,
      tokensSaida: null,
      motivoParada,
    };
  }

  const uso = corpoResposta?.usage ?? {};
  const itemMensagem = Array.isArray(corpoResposta?.output)
    ? corpoResposta.output.find((item: { type?: string }) => item?.type === 'message')
    : null;
  const conteudo = Array.isArray(itemMensagem?.content) ? itemMensagem.content[0] : null;

  if (conteudo?.type === 'refusal') {
    return {
      numero,
      titulo: caso.titulo,
      statusHttp: resposta.status,
      sucesso: false,
      erroSanitizado: `modelo recusou (refusal): ${sanitizar(String(conteudo.refusal ?? '').slice(0, 200))}`,
      objetoRecebido: null,
      duracaoMs,
      tokensEntrada: uso.input_tokens ?? null,
      tokensSaida: uso.output_tokens ?? null,
      motivoParada: null,
    };
  }

  const textoBruto: unknown = conteudo?.type === 'output_text' ? conteudo.text : undefined;
  if (typeof textoBruto !== 'string') {
    return {
      numero,
      titulo: caso.titulo,
      statusHttp: resposta.status,
      sucesso: false,
      erroSanitizado: 'canal estruturado oficial nao encontrado na resposta (sem output_text)',
      objetoRecebido: null,
      duracaoMs,
      tokensEntrada: uso.input_tokens ?? null,
      tokensSaida: uso.output_tokens ?? null,
      motivoParada: null,
    };
  }

  // Nenhuma tentativa de consertar/reinterpretar: JSON.parse direto, sem
  // extracao de markdown nem segunda chamada.
  let objeto: unknown;
  try {
    objeto = JSON.parse(textoBruto);
  } catch {
    return {
      numero,
      titulo: caso.titulo,
      statusHttp: resposta.status,
      sucesso: false,
      erroSanitizado: 'texto retornado nao e JSON valido (nao sera consertado)',
      objetoRecebido: null,
      duracaoMs,
      tokensEntrada: uso.input_tokens ?? null,
      tokensSaida: uso.output_tokens ?? null,
      motivoParada: null,
    };
  }

  const { valido, problemas } = validarEstruturaResposta(objeto);

  return {
    numero,
    titulo: caso.titulo,
    statusHttp: resposta.status,
    sucesso: valido,
    erroSanitizado: valido ? null : `estrutura invalida: ${problemas.join('; ')}`,
    objetoRecebido: objeto,
    duracaoMs,
    tokensEntrada: uso.input_tokens ?? null,
    tokensSaida: uso.output_tokens ?? null,
    motivoParada: null,
  };
}

async function main(): Promise<void> {
  console.log('--- pre-flight (nenhuma chamada real ainda) ---');
  console.log(`provedor: ${PROVEDOR}`);
  console.log(`modelo fixo: ${MODELO}`);
  console.log(`maximo de chamadas: ${MAX_CHAMADAS}`);
  console.log(`retry: ${RETRY}`);
  console.log(`max_output_tokens: ${MAX_OUTPUT_TOKENS}`);
  console.log(`timeout por chamada: ${TIMEOUT_MS}ms`);

  if (!process.env.IRIS_EVAL_OPENAI_API_KEY || process.env.IRIS_EVAL_OPENAI_API_KEY.trim() === '') {
    console.error('IRIS_EVAL_OPENAI_API_KEY ausente. Execute com --env-file apontando para o cofre. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }
  console.log('IRIS_EVAL_OPENAI_API_KEY: presente (valor nunca exibido)');

  validarSchemaAprovadoLocalmente();
  console.log('schema local: validado estruturalmente contra o schema aprovado, nenhuma divergencia encontrada');
  console.log('--- fim do pre-flight ---\n');

  const resultados: ResultadoChamada[] = [];

  for (const caso of CASOS) {
    if (chamadasRealizadas >= MAX_CHAMADAS) break;

    const resultado = await executarCaso(caso);
    resultados.push(resultado);

    console.log(`Chamada ${resultado.numero}/${MAX_CHAMADAS} — ${resultado.titulo}`);
    console.log(`  status tecnico: ${resultado.statusHttp ?? 'sem resposta HTTP (erro de rede/timeout)'}`);
    console.log(`  sucesso: ${resultado.sucesso}`);
    if (resultado.erroSanitizado) console.log(`  erro (sanitizado): ${resultado.erroSanitizado}`);
    if (resultado.sucesso) console.log(`  objeto recebido: ${JSON.stringify(resultado.objetoRecebido)}`);
    console.log(`  duracao: ${resultado.duracaoMs}ms`);
    console.log(`  tokens entrada/saida: ${resultado.tokensEntrada ?? 'nao informado'} / ${resultado.tokensSaida ?? 'nao informado'}`);
    console.log('');

    if (resultado.motivoParada === 'auth_invalida') {
      console.error('Autenticacao invalida detectada. Encerrando imediatamente, sem repetir e sem chamadas restantes.');
      break;
    }
    if (resultado.motivoParada === 'schema_rejeitado') {
      console.error('A API rejeitou o schema/strict mode nesta chamada. Encerrando sem executar as chamadas restantes.');
      console.error(`Detalhe sanitizado da rejeicao: ${resultado.erroSanitizado}`);
      break;
    }
  }

  const totalTokensEntrada = resultados.reduce((soma, r) => soma + (r.tokensEntrada ?? 0), 0);
  const totalTokensSaida = resultados.reduce((soma, r) => soma + (r.tokensSaida ?? 0), 0);
  const custoEstimadoUsd =
    (totalTokensEntrada / 1_000_000) * PRECO_USD_POR_1M_INPUT + (totalTokensSaida / 1_000_000) * PRECO_USD_POR_1M_OUTPUT;

  console.log('--- resumo final ---');
  console.log(`total de chamadas realizadas: ${chamadasRealizadas} (maximo permitido: ${MAX_CHAMADAS})`);
  console.log(`retries realizados: 0 (fixo, nenhum mecanismo de retry existe neste script)`);
  console.log(`total de tokens de entrada: ${totalTokensEntrada}`);
  console.log(`total de tokens de saida: ${totalTokensSaida}`);
  console.log(
    `custo estimado (precos aproximados de gpt-4.1-mini, conferir valor oficial atual): US$ ${custoEstimadoUsd.toFixed(6)}`
  );
  console.log(`chamadas com sucesso: ${resultados.filter((r) => r.sucesso).length}/${resultados.length}`);
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  console.error(`erro fatal (sanitizado): ${sanitizar(mensagem)}`);
  process.exitCode = 1;
});
