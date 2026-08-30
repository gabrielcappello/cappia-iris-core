// Runner A/B da conversa real de 2026-08-30 (reviews/diagnostico-luna-conversa-2026-08-30.md).
//
// Varia SOMENTE o modelo. Instrucoes, schema, payload, estado e histórico sao
// identicos nos dois lados -- a unica diferenca e o identificador enviado.
//
// O que ele prova, e por que existe:
//
// O defeito nao estava no modelo. Em `aguardando_procedimento` a Iris oferecia
// a Consulta/Avaliacao ao paciente mas NAO gravava a oferta no estado, entao o
// payload do turno seguinte ia sem `oferta_procedimento_pendente`.
//
// MEDIDO: sem a oferta no payload, OS DOIS modelos deixam de emitir
// `aceitar_opcao` -- a instrucao diz "Sem oferta_procedimento_pendente no
// payload, aceitar_opcao nunca e emitido", e ambos obedecem. Nao ha aqui um
// modelo tolerante e outro rigoroso: o estado defeituoso quebra os dois.
//
// Por isso o runner mede os DOIS modelos nos DOIS payloads:
//
//   SEM a oferta (estado defeituoso, como estava em producao)
//   COM a oferta (estado corrigido, como fica depois da correcao)
//
// A correcao e aprovada quando, COM a oferta, os dois modelos aceitam.
//
// Uso:
//   IRIS_EVAL_OPENAI_API_KEY=... node --experimental-strip-types src/eval/ab-conversa-luna-oferta.ts
//
// Faz chamadas PAGAS a API real. Saida sanitizada: so estrutura (campos,
// acoes, eventos), nunca texto livre devolvido pelo modelo.

import { INSTRUCOES_EXTRATOR } from '../core/interpretacao-instrucoes.ts';
import { MODELO_GPT_4_1_MINI, MODELO_IRIS_NOVA, SCHEMA_PORTATIL_APROVADO } from '../core/cliente-modelo-openai.ts';
import { calcularInstrucaoSystemEsperada } from './execucao-real-sintetica-adaptador-openai.ts';

// O adaptador de producao IGNORA o schema recebido e sempre usa o seu portatil,
// e reescreve a frase estrutural das instrucoes. Reproduzir os dois aqui e o
// que faz o A/B medir o contrato REAL, nao um parecido.
const INSTRUCOES_COMO_A_PRODUCAO_ENVIA = calcularInstrucaoSystemEsperada(INSTRUCOES_EXTRATOR);

const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const MAX_OUTPUT_TOKENS = 512;

/** Catalogo sintetico -- nenhum dado de clinica real. */
const PROCEDIMENTOS = [
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
  { procedimento_id: 'limpeza', nome_pt: 'Limpeza dental (profilaxia)' },
];
const DENTISTAS = [
  { dentista_id: 'dent-diego-perez', nome_exibido: 'Diego Perez' },
  { dentista_id: 'dent-diego-ramoz', nome_exibido: 'Diego Ramoz' },
];

/** Historico do turno 2: a Iris ofereceu a avaliacao e perguntou "pode ser?". */
const HISTORICO_APOS_OFERTA = [
  { autor: 'paciente' as const, texto: 'ola. bom dia' },
  { autor: 'iris' as const, texto: 'Bom dia! Como posso ajudar?' },
  { autor: 'paciente' as const, texto: 'quero um turno para hoje. tem algum horario disponivel?' },
  {
    autor: 'iris' as const,
    texto: 'Para agendar preciso saber o que você precisa. Posso marcar uma Consulta / Avaliação, pode ser?',
  },
];

type Caso = {
  nome: string;
  mensagem: string;
  /** `true` = estado CORRIGIDO (a oferta foi gravada). */
  ofertaNoEstado: boolean;
  /**
   * O que este caso mede:
   *
   * - `aceitar_opcao`     -- espera o evento (aceitacao clara);
   * - `nao_aceitar`       -- NEGATIVO: o evento nao pode aparecer;
   * - `dentista_resolvido`-- espera exatamente um candidato a profissional.
   *
   * O criterio de aprovacao e por TIPO: um caso de dentista nunca e avaliado
   * pela aceitacao, e vice-versa. Antes o runner olhava apenas
   * `oferta_no_estado === true`, o que misturava os dois.
   */
  esperado: 'aceitar_opcao' | 'nao_aceitar' | 'dentista_resolvido';
};

const CASOS: Caso[] = [
  // --- A causa raiz: o mesmo turno nos dois estados --------------------------
  {
    nome: 'turno 3 "ok pode ser" -- estado DEFEITUOSO (sem a oferta gravada)',
    mensagem: 'ok pode ser',
    ofertaNoEstado: false,
    esperado: 'nao_aceitar',
  },
  {
    nome: 'turno 3 "ok pode ser" -- estado CORRIGIDO',
    mensagem: 'ok pode ser',
    ofertaNoEstado: true,
    esperado: 'aceitar_opcao',
  },

  // --- Mensagem composta: aceitacao + pergunta adicional ---------------------
  // Variacoes reais, nao a mesma frase repetida. Todas ACEITAM e perguntam
  // outra coisa junto -- o evento tem que sair em todas.
  { nome: 'composta: "pode sim, mais hoje esta aberto?" (frase real do WhatsApp)', mensagem: 'pode sim, maishoje esta aberto?', ofertaNoEstado: true, esperado: 'aceitar_opcao' },
  { nome: 'composta: "pode sim, mas hoje abre?"', mensagem: 'pode sim, mas hoje abre?', ofertaNoEstado: true, esperado: 'aceitar_opcao' },
  { nome: 'composta: "ok, e atende hoje?"', mensagem: 'ok, e atende hoje?', ofertaNoEstado: true, esperado: 'aceitar_opcao' },
  { nome: 'composta: "sim, so queria saber se hoje esta aberto"', mensagem: 'sim, só queria saber se hoje está aberto', ofertaNoEstado: true, esperado: 'aceitar_opcao' },
  { nome: 'composta: "pode ser. voces funcionam hoje?"', mensagem: 'pode ser. vocês funcionam hoje?', ofertaNoEstado: true, esperado: 'aceitar_opcao' },

  // --- NEGATIVOS: sem aceitacao, o evento nao pode aparecer ------------------
  { nome: 'negativo: "quanto custa?" (pergunta SEM aceitacao)', mensagem: 'quanto custa?', ofertaNoEstado: true, esperado: 'nao_aceitar' },
  { nome: 'negativo: "nao, quanto custa?" (recusa)', mensagem: 'não, quanto custa?', ofertaNoEstado: true, esperado: 'nao_aceitar' },
  { nome: 'negativo: "talvez, hoje abre?" (hesitacao)', mensagem: 'talvez, hoje abre?', ofertaNoEstado: true, esperado: 'nao_aceitar' },

  // --- Escolha de profissional ----------------------------------------------
  { nome: 'turno 6 "diego perez"', mensagem: 'diego perez', ofertaNoEstado: false, esperado: 'dentista_resolvido' },
  { nome: 'turno 8 "ja falei diego perez" (repeticao)', mensagem: 'já falei diego perez', ofertaNoEstado: false, esperado: 'dentista_resolvido' },
];

function montarPayload(caso: Caso): Record<string, unknown> {
  return {
    mensagens_atuais: [caso.mensagem],
    dados_atuais: caso.esperado === 'dentista_resolvido' ? { procedimento_id: 'consultation_evaluation' } : {},
    campos_cadastrais_preenchidos: [],
    procedimentos_disponiveis: PROCEDIMENTOS,
    dentistas_disponiveis: DENTISTAS,
    historico_recente: HISTORICO_APOS_OFERTA,
    // A UNICA diferenca entre o estado defeituoso e o corrigido.
    ...(caso.ofertaNoEstado ? { oferta_procedimento_pendente: true } : {}),
  };
}

type Resultado = {
  aceitou_oferta: boolean;
  dentistas_candidatos: number | null;
  natureza: string | null;
  campos: string[];
  erro?: string;
};

async function executarTurno(chaveApi: string, modelo: string, caso: Caso): Promise<Resultado> {
  const corpo = {
    model: modelo,
    store: false,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    text: { format: { type: 'json_schema', name: 'interpretacao', strict: true, schema: SCHEMA_PORTATIL_APROVADO } },
    input: [
      { role: 'system', content: INSTRUCOES_COMO_A_PRODUCAO_ENVIA },
      { role: 'user', content: JSON.stringify(montarPayload(caso)) },
    ],
  };

  const resposta = await fetch(URL_RESPONSES, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chaveApi}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!resposta.ok) return { aceitou_oferta: false, dentistas_candidatos: null, natureza: null, campos: [], erro: `http_${resposta.status}` };

  const envelope = (await resposta.json()) as {
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  };
  // Seleciona o item `message` como o adaptador de producao faz. A Luna emite
  // um item `reasoning` ANTES do `message`; varrer o output inteiro sem filtrar
  // por tipo fazia este runner ler o item errado e reportar `sem_saida` --
  // defeito do runner, nao do modelo. O adaptador ja usava o filtro correto.
  const itemMensagem = envelope.output?.find((o) => o?.type === 'message');
  const texto = itemMensagem?.content?.find((c) => c?.type === 'output_text')?.text;
  if (texto === undefined) return { aceitou_oferta: false, dentistas_candidatos: null, natureza: null, campos: [], erro: 'sem_saida' };

  let saida: {
    natureza_mensagem?: string;
    alteracoes?: { campo?: string }[];
    eventos_candidatos?: { tipo?: string }[];
    dentistas_candidatos?: string[] | null;
  };
  try {
    saida = JSON.parse(texto);
  } catch {
    return { aceitou_oferta: false, dentistas_candidatos: null, natureza: null, campos: [], erro: 'json_invalido' };
  }

  return {
    aceitou_oferta: (saida.eventos_candidatos ?? []).some((e) => e?.tipo === 'aceitar_opcao'),
    dentistas_candidatos: saida.dentistas_candidatos === null || saida.dentistas_candidatos === undefined
      ? null
      : saida.dentistas_candidatos.length,
    natureza: saida.natureza_mensagem ?? null,
    campos: (saida.alteracoes ?? []).map((a) => a?.campo ?? '?').sort(),
  };
}

/**
 * Veredito de UM turno. Tres estados, nunca dois:
 *
 * - `falha_tecnica` -- HTTP, JSON invalido ou saida ausente. NUNCA se mistura
 *   com "nao aceitou": um 500 nao e uma decisao do modelo, e tratar os dois
 *   como o mesmo `false` escondia erro de infraestrutura dentro de resultado
 *   semantico (achado da revisao do Codex);
 * - `ok`   -- o modelo fez o que este tipo de caso exige;
 * - `erro` -- o modelo respondeu, mas diferente do exigido.
 */
function veredito(caso: Caso, r: Resultado): 'ok' | 'erro' | 'falha_tecnica' {
  if (r.erro !== undefined) return 'falha_tecnica';
  switch (caso.esperado) {
    case 'aceitar_opcao':
      return r.aceitou_oferta ? 'ok' : 'erro';
    case 'nao_aceitar':
      return r.aceitou_oferta ? 'erro' : 'ok';
    case 'dentista_resolvido':
      return r.dentistas_candidatos === 1 ? 'ok' : 'erro';
  }
}

async function principal(): Promise<number> {
  const chaveApi = process.env.IRIS_EVAL_OPENAI_API_KEY;
  if (chaveApi === undefined || chaveApi.trim() === '') {
    console.log(JSON.stringify({ erro: 'chave_ausente' }));
    return 1;
  }

  const linhas: Record<string, unknown>[] = [];
  for (const caso of CASOS) {
    const luna = await executarTurno(chaveApi, MODELO_IRIS_NOVA, caso);
    const mini = await executarTurno(chaveApi, MODELO_GPT_4_1_MINI, caso);
    linhas.push({
      caso: caso.nome,
      tipo: caso.esperado,
      oferta_no_estado: caso.ofertaNoEstado,
      luna: { veredito: veredito(caso, luna), ...luna },
      mini: { veredito: veredito(caso, mini), ...mini },
    });
  }

  const vereditos = (modelo: 'luna' | 'mini') => linhas.map((l) => (l[modelo] as { veredito: string }).veredito);
  const contar = (modelo: 'luna' | 'mini', v: string) => vereditos(modelo).filter((x) => x === v).length;

  const resumo = {
    luna: { ok: contar('luna', 'ok'), erro: contar('luna', 'erro'), falha_tecnica: contar('luna', 'falha_tecnica') },
    mini: { ok: contar('mini', 'ok'), erro: contar('mini', 'erro'), falha_tecnica: contar('mini', 'falha_tecnica') },
    total_casos: CASOS.length,
  };

  // Aprovado = TODOS os casos, nos dois modelos. Qualquer falha tecnica
  // tambem reprova -- ela nunca e silenciada como "o modelo nao aceitou".
  const aprovado =
    resumo.luna.ok === CASOS.length && resumo.mini.ok === CASOS.length;

  console.log(JSON.stringify({ aprovado, resumo, turnos: linhas }, null, 2));
  return aprovado ? 0 : 1;
}

const codigo = await principal();
process.exitCode = codigo;
