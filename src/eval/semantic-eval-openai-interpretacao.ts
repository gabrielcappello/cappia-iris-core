// Avaliador SEMANTICO, separado do smoke test de compatibilidade
// (src/eval/smoke-test-openai-structured-outputs.ts). Objetivo: verificar,
// no futuro e com nova aprovacao explicita a cada execucao real, a
// qualidade semantica da interpretacao do gpt-4.1-mini-2025-04-14 usando:
//
//   - o contrato completo de interpretacao ja aprovado (INSTRUCOES_EXTRATOR,
//     importado diretamente de src/core/interpretacao-instrucoes.ts, nunca
//     copiado nem resumido);
//   - o schema portatil ja aprovado (formato array de {campo, acao, valor});
//   - somente mensagens e dados sinteticos e ficticios.
//
// NESTA ENTREGA: chamadas reais = 0, tokens = 0, custo = 0. A chave nao e
// acessada, o arquivo de segredo nao e aberto/lido/verificado. Sem
// argumentos (ou sem --execute + --cases explicitos), o script SOMENTE
// roda em modo dry-run: lista os cenarios, valida a configuracao local, e
// encerra -- nenhuma rede e tocada.
//
// Uso desta entrega (dry-run, funciona sem qualquer credencial):
//   node src/eval/semantic-eval-openai-interpretacao.ts
//
// Uso real FUTURO (nao executado nesta entrega, exige --env-file e nova
// aprovacao explicita para rodar):
//   node --env-file="C:\Users\Gabriel\.iris-secrets\iris-model-eval.env" \
//     src/eval/semantic-eval-openai-interpretacao.ts --execute --cases=intencao_novo_agendamento,remocao_explicita
//
// Este arquivo nao importa nada de aplicarDados/interpretarEAplicar/
// preAplicar e nao e conectado ao Core -- a logica de comparacao existe
// somente aqui.
import { INSTRUCOES_EXTRATOR } from '../core/interpretacao-instrucoes.ts';

// --- Compatibilizacao com o transporte portatil ---
//
// INSTRUCOES_EXTRATOR (src/core/) descreve, na sua ultima regra
// estrutural, o formato interno antigo do Core (objeto com acao/valor por
// campo, remover so com acao) -- correto para o Core hoje, mas
// incompativel com o schema portatil (array de {campo, acao, valor},
// remover com valor: null) usado por esta avaliacao. Em vez de manter uma
// segunda versao independente das regras semanticas, substituimos
// EXCLUSIVAMENTE essa unica frase estrutural, preservando o restante de
// INSTRUCOES_EXTRATOR palavra por palavra. Nao alteramos
// src/core/interpretacao-instrucoes.ts -- o Core continua usando o
// contrato interno antigo normalmente.
const FRASE_ESTRUTURAL_FORMATO_INTERNO_ANTIGO =
  'Responda estritamente no formato do schema fornecido — nenhuma propriedade alem de "alteracoes" no nivel principal, nenhuma propriedade alem de "acao"/"valor" (ou somente "acao" para remover) dentro de cada alteracao.';

const FRASE_ESTRUTURAL_TRANSPORTE_PORTATIL =
  'Responda estritamente no formato do schema fornecido — a raiz contem somente "alteracoes"; "alteracoes" e uma lista; cada item da lista contem exatamente "campo", "acao" e "valor"; informar e corrigir usam "valor" como string; remover usa "valor": null; nenhuma propriedade adicional e permitida.';

function construirInstrucoesParaTransportePortatil(): string {
  const ocorrencias = INSTRUCOES_EXTRATOR.split(FRASE_ESTRUTURAL_FORMATO_INTERNO_ANTIGO).length - 1;
  if (ocorrencias !== 1) {
    throw new Error(
      `INSTRUCOES_EXTRATOR nao contem a frase estrutural esperada exatamente uma vez (encontradas: ${ocorrencias}) -- abortando localmente antes de qualquer chamada`
    );
  }
  const substituida = INSTRUCOES_EXTRATOR.replace(
    FRASE_ESTRUTURAL_FORMATO_INTERNO_ANTIGO,
    FRASE_ESTRUTURAL_TRANSPORTE_PORTATIL
  );

  // Prova de que nada alem dessa frase mudou: removendo a frase (antiga de
  // um lado, nova do outro) o restante do texto tem que ficar identico.
  const restanteOriginal = INSTRUCOES_EXTRATOR.replace(FRASE_ESTRUTURAL_FORMATO_INTERNO_ANTIGO, '');
  const restanteSubstituido = substituida.replace(FRASE_ESTRUTURAL_TRANSPORTE_PORTATIL, '');
  if (restanteOriginal !== restanteSubstituido) {
    throw new Error(
      'a substituicao alterou algo alem da frase estrutural -- abortando localmente antes de qualquer chamada'
    );
  }

  return substituida;
}

// Computada uma unica vez, no carregamento do modulo: se a frase antiga
// nao existir (ou existir mais de uma vez) em INSTRUCOES_EXTRATOR, o
// modulo inteiro falha ao carregar -- nenhum dry-run e nenhuma chamada
// real conseguem prosseguir.
const INSTRUCOES_PARA_MODELO = construirInstrucoesParaTransportePortatil();

// --- Limites e protecoes de execucao (valem tanto para dry-run quanto para o modo real futuro) ---
const PROVEDOR = 'openai' as const;
const MODELO = 'gpt-4.1-mini-2025-04-14' as const;
const MAX_CASOS_POR_EXECUCAO = 4 as const;
const RETRY = 0 as const;
const MAX_OUTPUT_TOKENS = 512 as const;
const TIMEOUT_MS = 8000 as const;
const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const IDS_SELECAO_PROIBIDOS = ['todos', 'all', '*'] as const;

// --- Schema portatil aprovado (copiado literalmente da tarefa, sem nenhuma alteracao ou enfraquecimento) ---
const SCHEMA_PORTATIL_APROVADO = {
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

// Listas locais (nao importadas de src/core/ -- este avaliador so importa
// INSTRUCOES_EXTRATOR, explicitamente autorizado; tudo o mais fica
// isolado, no mesmo espirito do smoke test anterior).
const CAMPOS_PERMITIDOS = [
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
] as const;
const ACOES_PERMITIDAS = ['informar', 'corrigir', 'remover'] as const;
const PERIODOS_PERMITIDOS = ['manha', 'tarde', 'noite'] as const;
const INTENCOES_PERMITIDAS = ['novo_agendamento'] as const;

interface ItemAlteracaoPortatil {
  campo: string;
  acao: string;
  valor: string | null;
}

interface CenarioSemantico {
  id: string;
  descricao: string;
  mensagens_atuais: string[];
  dados_atuais: Record<string, string>;
  resultado_esperado: ItemAlteracaoPortatil[];
  origem: string;
}

// --- Cenarios: nenhuma regra nova, todos derivados dos testes/instrucoes
// ja aprovados em src/core/interpretacao-extrator.test.ts,
// src/core/interpretar-e-aplicar.test.ts e
// src/core/interpretacao-instrucoes.ts. Nenhuma informacao real de
// paciente -- todos os nomes, mensagens e dados sao ficticios. ---
const CENARIOS: readonly CenarioSemantico[] = [
  {
    id: 'intencao_novo_agendamento',
    descricao: 'Intencao explicita de novo agendamento',
    mensagens_atuais: ['Quero fazer um novo agendamento.'],
    dados_atuais: {},
    resultado_esperado: [{ campo: 'intencao', acao: 'informar', valor: 'novo_agendamento' }],
    origem:
      'INTENCOES_PERMITIDAS (src/core/aplicar-dados.ts) + INSTRUCOES_EXTRATOR ("Valores permitidos para intencao: novo_agendamento") -- unico valor permitido para o campo intencao',
  },
  {
    id: 'procedimento_data_periodo_mesma_mensagem',
    descricao: 'Procedimento, data e periodo mencionados na mesma mensagem',
    mensagens_atuais: ['Quero fazer uma limpeza na sexta a tarde.'],
    dados_atuais: {},
    resultado_esperado: [
      { campo: 'procedimento_texto', acao: 'informar', valor: 'limpeza' },
      { campo: 'data_texto', acao: 'informar', valor: 'sexta' },
      { campo: 'periodo', acao: 'informar', valor: 'tarde' },
    ],
    origem:
      'CAMPOS_PERMITIDOS (procedimento_texto/data_texto/periodo) + INSTRUCOES_EXTRATOR ("datas e horarios sempre preservados como texto"; periodo aceita manha/tarde/noite) -- composicao de campos individualmente aprovados, nenhuma regra nova',
  },
  {
    id: 'multiplos_procedimentos_coexistentes',
    descricao: 'Dois procedimentos coexistentes preservados em uma unica string',
    mensagens_atuais: ['Quero limpeza e clareamento.'],
    dados_atuais: {},
    resultado_esperado: [{ campo: 'procedimento_texto', acao: 'informar', valor: 'limpeza e clareamento' }],
    origem: 'src/core/interpretacao-extrator.test.ts teste3',
  },
  {
    id: 'multiplos_dentistas_coexistentes',
    descricao: 'Dois dentistas alternativos preservados em uma unica string',
    mensagens_atuais: ['Pode ser com Ana ou Carla.'],
    dados_atuais: {},
    resultado_esperado: [{ campo: 'dentista_texto', acao: 'informar', valor: 'Ana ou Carla' }],
    origem: 'src/core/interpretacao-extrator.test.ts teste4',
  },
  {
    id: 'correcao_de_valor_acumulado',
    descricao: 'Correcao explicita de um valor ja acumulado em dados_atuais',
    mensagens_atuais: ['Na verdade quero clareamento, nao limpeza.'],
    dados_atuais: { procedimento_texto: 'limpeza' },
    resultado_esperado: [{ campo: 'procedimento_texto', acao: 'corrigir', valor: 'clareamento' }],
    origem: 'src/core/interpretar-e-aplicar.test.ts teste6',
  },
  {
    id: 'correcoes_sucessivas_na_janela',
    descricao: 'Correcoes sucessivas do mesmo campo dentro da mesma janela resultam em uma unica alteracao final',
    mensagens_atuais: ['Quero limpeza.', 'Na verdade prefiro clareamento.'],
    dados_atuais: {},
    resultado_esperado: [{ campo: 'procedimento_texto', acao: 'informar', valor: 'clareamento' }],
    origem: 'src/core/interpretar-e-aplicar.test.ts teste5',
  },
  {
    id: 'retorno_ao_valor_acumulado',
    descricao: 'O valor final da janela volta a ser igual ao valor ja acumulado -- deve usar informar, nao corrigir',
    mensagens_atuais: ['E o Joao mesmo, deixa como estava.'],
    dados_atuais: { nome: 'Joao' },
    resultado_esperado: [{ campo: 'nome', acao: 'informar', valor: 'Joao' }],
    origem: 'src/core/interpretar-e-aplicar.test.ts teste7',
  },
  {
    id: 'remocao_explicita',
    descricao: 'Pedido explicito de remocao de um dado ja acumulado',
    mensagens_atuais: ['Pode apagar meu e-mail, nao preciso mais dele.'],
    dados_atuais: { email: 'paciente.teste@example.com' },
    resultado_esperado: [{ campo: 'email', acao: 'remover', valor: null }],
    origem:
      'src/core/interpretacao-extrator.test.ts teste23 (remover sem "valor" e a forma valida) + INSTRUCOES_EXTRATOR ("Remocao de um dado so ocorre quando o paciente pedir explicitamente")',
  },
  {
    id: 'duvida_sem_decisao',
    descricao: 'Duvida real do paciente, sem decisao tomada -- alteracoes vazia',
    mensagens_atuais: ['Nao sei ainda o que quero marcar.'],
    dados_atuais: {},
    resultado_esperado: [],
    origem: 'src/core/interpretacao-extrator.test.ts teste15',
  },
  {
    id: 'horario_sem_inferir_periodo',
    descricao: 'Horario mencionado explicitamente nao deve inferir periodo',
    mensagens_atuais: ['Pode ser as 14h?'],
    dados_atuais: {},
    resultado_esperado: [{ campo: 'horario_texto', acao: 'informar', valor: '14h' }],
    origem:
      'src/core/interpretacao-extrator.test.ts teste16 (INSTRUCOES_EXTRATOR: "periodo nunca e inferido a partir de um horario")',
  },
  {
    id: 'campo_nao_mencionado_omitido',
    descricao: 'Somente o campo efetivamente mencionado aparece na saida; os demais ficam ausentes',
    mensagens_atuais: ['Sou o Joao.'],
    dados_atuais: {},
    resultado_esperado: [{ campo: 'nome', acao: 'informar', valor: 'Joao' }],
    origem: 'src/core/interpretacao-extrator.test.ts teste17',
  },
  {
    id: 'resultado_vazio_valido',
    descricao: 'Mensagem sem nenhum conteudo decisorio -- alteracoes vazia e uma saida estruturalmente valida',
    mensagens_atuais: ['Oi, boa tarde!'],
    dados_atuais: {},
    resultado_esperado: [],
    origem: 'src/core/interpretacao-extrator.test.ts teste15 (alteracoes vazio e uma saida valida)',
  },
];

// --- Validador estrutural completo do formato portatil (raiz fechada,
// array, itens fechados, campos/acoes permitidos, coerencia acao/valor,
// periodo/intencao restritos, campo duplicado rejeitado). Nunca conserta
// nem completa -- so reporta problemas. ---
function validarEstruturaPortatil(objeto: unknown): { valido: boolean; problemas: string[] } {
  const problemas: string[] = [];

  if (objeto === null || typeof objeto !== 'object' || Array.isArray(objeto)) {
    return { valido: false, problemas: ['raiz nao e objeto'] };
  }
  const chavesRaiz = Object.keys(objeto as Record<string, unknown>);
  if (chavesRaiz.length !== 1 || chavesRaiz[0] !== 'alteracoes') {
    problemas.push('raiz nao contem somente "alteracoes"');
  }

  const alteracoes = (objeto as { alteracoes?: unknown }).alteracoes;
  if (!Array.isArray(alteracoes)) {
    problemas.push('"alteracoes" nao e array');
    return { valido: false, problemas };
  }

  const camposVistos = new Set<string>();
  alteracoes.forEach((item, indice) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      problemas.push(`item[${indice}] nao e objeto`);
      return;
    }
    const chavesItem = Object.keys(item as Record<string, unknown>).sort();
    if (JSON.stringify(chavesItem) !== JSON.stringify(['acao', 'campo', 'valor'])) {
      problemas.push(`item[${indice}] nao contem somente campo/acao/valor`);
      return;
    }

    const { campo, acao, valor } = item as { campo: unknown; acao: unknown; valor: unknown };

    if (typeof campo !== 'string' || !CAMPOS_PERMITIDOS.includes(campo as (typeof CAMPOS_PERMITIDOS)[number])) {
      problemas.push(`item[${indice}].campo invalido`);
      return;
    }
    if (camposVistos.has(campo)) {
      problemas.push(`item[${indice}].campo "${campo}" duplicado -- ja apareceu antes nesta mesma resposta`);
    }
    camposVistos.add(campo);

    if (typeof acao !== 'string' || !ACOES_PERMITIDAS.includes(acao as (typeof ACOES_PERMITIDAS)[number])) {
      problemas.push(`item[${indice}].acao invalida`);
      return;
    }

    if (acao === 'remover') {
      if (valor !== null) problemas.push(`item[${indice}]: acao remover exige valor null`);
    } else {
      if (typeof valor !== 'string' || valor.trim() === '') {
        problemas.push(`item[${indice}]: valor deve ser string nao vazia para acao "${acao}"`);
      } else {
        if (campo === 'periodo' && !PERIODOS_PERMITIDOS.includes(valor as (typeof PERIODOS_PERMITIDOS)[number])) {
          problemas.push(`item[${indice}]: valor de periodo fora do dominio permitido`);
        }
        if (campo === 'intencao' && !INTENCOES_PERMITIDAS.includes(valor as (typeof INTENCOES_PERMITIDAS)[number])) {
          problemas.push(`item[${indice}]: valor de intencao fora do dominio permitido`);
        }
      }
    }
  });

  return { valido: problemas.length === 0, problemas };
}

// --- Comparador: nunca conserta a resposta, so classifica. Independente
// da ordem entre campos diferentes; comparacao exata do texto de "valor". ---
function compararComEsperado(
  recebido: ItemAlteracaoPortatil[],
  esperado: ItemAlteracaoPortatil[]
): { aprovado: boolean; motivo: string } {
  const mapaRecebido = new Map(recebido.map((item) => [item.campo, item]));
  if (mapaRecebido.size !== recebido.length) {
    return { aprovado: false, motivo: 'campo duplicado na resposta recebida' };
  }

  const mapaEsperado = new Map(esperado.map((item) => [item.campo, item]));
  const camposEsperados = [...mapaEsperado.keys()].sort();
  const camposRecebidos = [...mapaRecebido.keys()].sort();
  if (JSON.stringify(camposEsperados) !== JSON.stringify(camposRecebidos)) {
    return {
      aprovado: false,
      motivo: `conjunto de campos diferente do esperado (recebido: [${camposRecebidos.join(', ')}], esperado: [${camposEsperados.join(', ')}])`,
    };
  }

  for (const campo of camposEsperados) {
    const itemEsperado = mapaEsperado.get(campo) as ItemAlteracaoPortatil;
    const itemRecebido = mapaRecebido.get(campo) as ItemAlteracaoPortatil;
    if (itemRecebido.acao !== itemEsperado.acao) {
      return { aprovado: false, motivo: `campo "${campo}": acao esperada "${itemEsperado.acao}", recebida "${itemRecebido.acao}"` };
    }
    if (itemRecebido.valor !== itemEsperado.valor) {
      return { aprovado: false, motivo: `campo "${campo}": valor recebido nao corresponde exatamente ao esperado` };
    }
  }

  return { aprovado: true, motivo: 'todos os campos correspondem exatamente ao esperado' };
}

// --- CLI: modo real exige --execute E --cases explicitos simultaneamente ---
function interpretarArgumentos(argv: string[]): { execute: boolean; casesIds: string[] | null } {
  const execute = argv.includes('--execute');
  const argCases = argv.find((arg) => arg.startsWith('--cases='));
  if (!argCases) return { execute, casesIds: null };

  const ids = argCases
    .slice('--cases='.length)
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return { execute, casesIds: ids };
}

function validarSelecaoDeCasos(ids: string[]): { validos: boolean; motivo?: string } {
  if (ids.length === 0) {
    return { validos: false, motivo: 'nenhum id explicito informado em --cases' };
  }
  if (ids.some((id) => (IDS_SELECAO_PROIBIDOS as readonly string[]).includes(id.toLowerCase()))) {
    return { validos: false, motivo: 'selecao "todos"/"all"/"*" e proibida -- exige ids explicitos, um a um' };
  }
  if (ids.length > MAX_CASOS_POR_EXECUCAO) {
    return { validos: false, motivo: `mais de ${MAX_CASOS_POR_EXECUCAO} ids informados (maximo permitido por execucao)` };
  }
  if (new Set(ids).size !== ids.length) {
    return { validos: false, motivo: 'id repetido em --cases -- cada id pode ser usado somente uma vez por execucao' };
  }
  const idsConhecidos = new Set(CENARIOS.map((cenario) => cenario.id));
  const desconhecidos = ids.filter((id) => !idsConhecidos.has(id));
  if (desconhecidos.length > 0) {
    return { validos: false, motivo: `id(s) desconhecido(s): ${desconhecidos.join(', ')}` };
  }
  return { validos: true };
}

async function rodarDryRun(): Promise<void> {
  console.log('=== semantic-eval-openai-interpretacao: DRY RUN (nenhuma chamada de API) ===\n');
  console.log(`provedor fixo: ${PROVEDOR}`);
  console.log(`modelo fixo: ${MODELO}`);
  console.log(`maximo de casos por execucao real: ${MAX_CASOS_POR_EXECUCAO}`);
  console.log(`retry: ${RETRY}`);
  console.log(`max_output_tokens (execucao real): ${MAX_OUTPUT_TOKENS}`);
  console.log(`timeout por chamada: ${TIMEOUT_MS}ms`);
  console.log(`total de cenarios preparados: ${CENARIOS.length}\n`);

  console.log('--- cenarios preparados ---');
  for (const cenario of CENARIOS) {
    console.log(`[${cenario.id}] ${cenario.descricao}`);
    console.log(`  origem: ${cenario.origem}`);
    console.log(`  mensagens_atuais: ${JSON.stringify(cenario.mensagens_atuais)}`);
    console.log(`  dados_atuais: ${JSON.stringify(cenario.dados_atuais)}`);
    console.log(`  resultado_esperado: ${JSON.stringify(cenario.resultado_esperado)}`);
    console.log('');
  }

  console.log('--- validacao local da configuracao (sem nenhuma chamada de rede) ---');

  let algumaFalhaEstrutural = false;
  for (const cenario of CENARIOS) {
    const { valido, problemas } = validarEstruturaPortatil({ alteracoes: cenario.resultado_esperado });
    if (!valido) {
      algumaFalhaEstrutural = true;
      console.error(`[${cenario.id}] resultado_esperado FALHOU na validacao estrutural: ${problemas.join('; ')}`);
    }
  }
  if (!algumaFalhaEstrutural) {
    console.log(`todos os ${CENARIOS.length} resultado_esperado sao estruturalmente validos contra o schema portatil (sem campo duplicado, sem coerencia acao/valor quebrada)`);
  }

  const idsDuplicados = CENARIOS.length !== new Set(CENARIOS.map((c) => c.id)).size;
  console.log(idsDuplicados ? 'FALHA: existem ids de cenario duplicados' : 'ids de cenario: todos unicos');

  console.log(
    `INSTRUCOES_EXTRATOR importado diretamente de src/core/interpretacao-instrucoes.ts (${INSTRUCOES_EXTRATOR.length} caracteres; nao copiado, nao resumido, nao alterado em src/core/)`
  );
  console.log(
    `frase estrutural do formato interno antigo (acao/valor por campo, remover so com acao): encontrada exatamente 1 vez em INSTRUCOES_EXTRATOR e substituida por uma frase compativel com o transporte portatil (raiz so com "alteracoes", lista de {campo, acao, valor}, remover com valor: null)`
  );
  console.log(
    `INSTRUCOES_PARA_MODELO: ${INSTRUCOES_PARA_MODELO.length} caracteres -- identica a INSTRUCOES_EXTRATOR em todo o resto (verificado: remover a frase de cada lado produz o mesmo texto restante), nenhuma outra regra semantica foi modificada`
  );
  console.log('schema portatil local: presente, identico ao aprovado (nenhuma propriedade removida ou enfraquecida)');

  console.log('\n--- confirmacao desta execucao ---');
  console.log('modo: dry-run (padrao -- nenhum argumento de execucao real foi passado)');
  console.log('chamadas reais realizadas: 0');
  console.log('tokens consumidos: 0');
  console.log('custo: US$ 0,00');
  console.log('arquivo de segredo (.iris-secrets/iris-model-eval.env): NAO acessado, NAO aberto, NAO lido, NAO verificado');
  console.log('variavel IRIS_EVAL_OPENAI_API_KEY: NAO consultada neste modo');
  console.log(
    `\nPara execucao real futura (fora desta entrega, com nova aprovacao explicita): --execute --cases=<ids>, ate ${MAX_CASOS_POR_EXECUCAO}, sem repeticao, sem "todos"/"all".`
  );
}

// --- Implementacao do modo real (nao invocada nesta entrega -- pronta
// para uso futuro aprovado). Segue o mesmo padrao ja usado e aprovado no
// smoke test de compatibilidade: guarda de orcamento, timeout, sem retry,
// sem tools, sanitizacao de qualquer texto de erro. ---

let chamadasRealizadas = 0;

function reservarUmaChamada(): number {
  if (chamadasRealizadas >= MAX_CASOS_POR_EXECUCAO) {
    throw new Error(`bloqueio local: tentativa de exceder o maximo de ${MAX_CASOS_POR_EXECUCAO} chamadas`);
  }
  chamadasRealizadas += 1;
  return chamadasRealizadas;
}

function sanitizar(texto: string): string {
  return texto.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
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

async function rodarExecucaoReal(ids: string[]): Promise<void> {
  const chaveApi = process.env.IRIS_EVAL_OPENAI_API_KEY;
  if (!chaveApi || chaveApi.trim() === '') {
    console.error('IRIS_EVAL_OPENAI_API_KEY ausente. Execute com --env-file apontando para o cofre. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }
  console.log('IRIS_EVAL_OPENAI_API_KEY: presente (valor nunca exibido)');

  for (const id of ids) {
    if (chamadasRealizadas >= MAX_CASOS_POR_EXECUCAO) break;
    const cenario = CENARIOS.find((candidato) => candidato.id === id) as CenarioSemantico;
    const numero = reservarUmaChamada();
    const inicio = Date.now();

    const corpo = {
      model: MODELO,
      input: [
        { role: 'system', content: INSTRUCOES_PARA_MODELO },
        {
          role: 'user',
          content: JSON.stringify({ mensagens_atuais: cenario.mensagens_atuais, dados_atuais: cenario.dados_atuais }),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'alteracoes_iris_semantic_eval',
          schema: SCHEMA_PORTATIL_APROVADO,
          strict: true,
        },
      },
      max_output_tokens: MAX_OUTPUT_TOKENS,
    };
    // nenhuma chave 'tools' incluida em nenhuma hipotese.

    let resposta: Response;
    try {
      resposta = await chamarComTimeout(
        URL_RESPONSES,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${chaveApi}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
        },
        TIMEOUT_MS
      );
    } catch (erroRede) {
      const mensagem = erroRede instanceof Error ? erroRede.message : 'erro de rede desconhecido';
      console.log(`[${numero}/${MAX_CASOS_POR_EXECUCAO}] ${cenario.id}: erro de rede/timeout (sanitizado): ${sanitizar(mensagem)}`);
      continue;
    }

    const duracaoMs = Date.now() - inicio;
    const corpoResposta = await resposta.json().catch(() => null);

    if (!resposta.ok) {
      const mensagemErro = sanitizar(JSON.stringify(corpoResposta?.error ?? corpoResposta ?? {}));
      console.log(`[${numero}/${MAX_CASOS_POR_EXECUCAO}] ${cenario.id}: REPROVADO -- erro tecnico ${resposta.status}: ${mensagemErro}`);
      if (resposta.status === 401) {
        console.error('Autenticacao invalida. Encerrando imediatamente, sem repetir, sem chamadas restantes.');
        break;
      }
      continue;
    }

    const uso = corpoResposta?.usage ?? {};
    const itemMensagem = Array.isArray(corpoResposta?.output)
      ? corpoResposta.output.find((item: { type?: string }) => item?.type === 'message')
      : null;
    const conteudo = Array.isArray(itemMensagem?.content) ? itemMensagem.content[0] : null;

    if (conteudo?.type === 'refusal') {
      console.log(`[${numero}/${MAX_CASOS_POR_EXECUCAO}] ${cenario.id}: REPROVADO -- modelo recusou (refusal)`);
      continue;
    }

    const textoBruto: unknown = conteudo?.type === 'output_text' ? conteudo.text : undefined;
    if (typeof textoBruto !== 'string') {
      console.log(`[${numero}/${MAX_CASOS_POR_EXECUCAO}] ${cenario.id}: REPROVADO -- canal estruturado oficial nao encontrado na resposta`);
      continue;
    }

    // Nenhuma tentativa de consertar/reinterpretar: JSON.parse direto.
    let objeto: unknown;
    try {
      objeto = JSON.parse(textoBruto);
    } catch {
      console.log(`[${numero}/${MAX_CASOS_POR_EXECUCAO}] ${cenario.id}: REPROVADO -- resposta nao e JSON valido (nao sera consertada)`);
      continue;
    }

    const { valido, problemas } = validarEstruturaPortatil(objeto);
    if (!valido) {
      console.log(`[${numero}/${MAX_CASOS_POR_EXECUCAO}] ${cenario.id}: REPROVADO -- estrutura invalida: ${problemas.join('; ')}`);
      continue;
    }

    const recebido = (objeto as { alteracoes: ItemAlteracaoPortatil[] }).alteracoes;
    const { aprovado, motivo } = compararComEsperado(recebido, cenario.resultado_esperado);
    console.log(
      `[${numero}/${MAX_CASOS_POR_EXECUCAO}] ${cenario.id}: ${aprovado ? 'APROVADO' : 'REPROVADO'} -- ${motivo} (duracao ${duracaoMs}ms, tokens entrada/saida: ${uso.input_tokens ?? '?'}/${uso.output_tokens ?? '?'})`
    );
  }

  console.log(`\ntotal de chamadas realizadas: ${chamadasRealizadas} (maximo permitido: ${MAX_CASOS_POR_EXECUCAO})`);
  console.log('retries realizados: 0 (fixo, nenhum mecanismo de retry existe neste script)');
}

async function main(): Promise<void> {
  const { execute, casesIds } = interpretarArgumentos(process.argv.slice(2));

  if (!execute || !casesIds) {
    await rodarDryRun();
    return;
  }

  const selecao = validarSelecaoDeCasos(casesIds);
  if (!selecao.validos) {
    console.error(`Selecao de casos invalida: ${selecao.motivo}. Nenhuma chamada foi feita.`);
    process.exitCode = 1;
    return;
  }

  await rodarExecucaoReal(casesIds);
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  console.error(`erro fatal (sanitizado): ${sanitizar(mensagem)}`);
  process.exitCode = 1;
});
