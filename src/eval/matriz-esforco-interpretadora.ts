// Matriz de `reasoning.effort` na INTERPRETADORA (2026-08-30).
//
// Motivo: a Luna gasta tokens de raciocinio DENTRO de `max_output_tokens`, e o
// adaptador nao declara `reasoning`, entao a API aplica o padrao `medium`. Isso
// trunca a resposta em parte dos turnos com o limite atual de 512.
//
// Antes de mexer no limite, mede-se o esforco: se `none` ou `low` eliminarem o
// truncamento SEM perder qualidade semantica, e a mudanca mais barata.
//
// Varia UMA coisa: `reasoning.effort`. Schema, instrucoes, payload,
// `max_output_tokens` e modelo sao identicos nas tres configuracoes.
//
// Faz chamadas PAGAS. Saida sanitizada: so metrica e veredito, nunca texto
// livre do modelo.

import { INSTRUCOES_EXTRATOR } from '../core/interpretacao-instrucoes.ts';
import { MODELO_IRIS_NOVA, SCHEMA_PORTATIL_APROVADO } from '../core/cliente-modelo-openai.ts';
import { calcularInstrucaoSystemEsperada } from './execucao-real-sintetica-adaptador-openai.ts';

const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const MAX_OUTPUT_TOKENS = 512;
const ESFORCOS = ['none', 'low', 'medium'] as const;
type Esforco = (typeof ESFORCOS)[number];

const INSTRUCOES = calcularInstrucaoSystemEsperada(INSTRUCOES_EXTRATOR);

const PROCEDIMENTOS = [
  { procedimento_id: 'consultation_evaluation', nome_pt: 'Consulta / Avaliação' },
  { procedimento_id: 'limpeza', nome_pt: 'Limpeza dental (profilaxia)' },
];
const DENTISTAS = [
  { dentista_id: 'dent-diego-perez', nome_exibido: 'Diego Perez' },
  { dentista_id: 'dent-diego-ramoz', nome_exibido: 'Diego Ramoz' },
];
const HISTORICO = [
  { autor: 'paciente' as const, texto: 'quero um turno para hoje. tem algum horario disponivel?' },
  { autor: 'iris' as const, texto: 'Posso marcar uma Consulta / Avaliação, pode ser?' },
];

type Caso = {
  nome: string;
  mensagem: string;
  ofertaNoEstado: boolean;
  esperado: 'aceitar_opcao' | 'nao_aceitar' | 'dentista_resolvido';
};

const CASOS: Caso[] = [
  { nome: 'oferta ausente: "ok pode ser"', mensagem: 'ok pode ser', ofertaNoEstado: false, esperado: 'nao_aceitar' },
  { nome: 'oferta presente: "ok pode ser"', mensagem: 'ok pode ser', ofertaNoEstado: true, esperado: 'aceitar_opcao' },
  { nome: 'composta: "pode sim, maishoje esta aberto?"', mensagem: 'pode sim, maishoje esta aberto?', ofertaNoEstado: true, esperado: 'aceitar_opcao' },
  { nome: 'composta: "pode sim, mas hoje abre?"', mensagem: 'pode sim, mas hoje abre?', ofertaNoEstado: true, esperado: 'aceitar_opcao' },
  { nome: 'composta: "ok, e atende hoje?"', mensagem: 'ok, e atende hoje?', ofertaNoEstado: true, esperado: 'aceitar_opcao' },
  { nome: 'composta: "sim, so queria saber se hoje esta aberto"', mensagem: 'sim, só queria saber se hoje está aberto', ofertaNoEstado: true, esperado: 'aceitar_opcao' },
  { nome: 'composta: "pode ser. voces funcionam hoje?"', mensagem: 'pode ser. vocês funcionam hoje?', ofertaNoEstado: true, esperado: 'aceitar_opcao' },
  { nome: 'negativo: "quanto custa?"', mensagem: 'quanto custa?', ofertaNoEstado: true, esperado: 'nao_aceitar' },
  { nome: 'negativo: "nao, quanto custa?"', mensagem: 'não, quanto custa?', ofertaNoEstado: true, esperado: 'nao_aceitar' },
  { nome: 'negativo: "talvez, hoje abre?"', mensagem: 'talvez, hoje abre?', ofertaNoEstado: true, esperado: 'nao_aceitar' },
  { nome: 'dentista: "diego perez"', mensagem: 'diego perez', ofertaNoEstado: false, esperado: 'dentista_resolvido' },
  { nome: 'dentista: "ja falei diego perez"', mensagem: 'já falei diego perez', ofertaNoEstado: false, esperado: 'dentista_resolvido' },
];

/** O caso que truncou na medicao anterior -- usado na repeticao de 20x. */
const CASO_QUE_TRUNCOU = CASOS[7];

type Medida = {
  status: string;
  incomplete_reason: string | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  tokens_visiveis: number | null;
  duracao_ms: number;
  veredito: 'ok' | 'erro' | 'falha_tecnica';
  erro?: string;
};

async function medir(chaveApi: string, esforco: Esforco, caso: Caso): Promise<Medida> {
  const payload = {
    mensagens_atuais: [caso.mensagem],
    dados_atuais: caso.esperado === 'dentista_resolvido' ? { procedimento_id: 'consultation_evaluation' } : {},
    campos_cadastrais_preenchidos: [],
    procedimentos_disponiveis: PROCEDIMENTOS,
    dentistas_disponiveis: DENTISTAS,
    historico_recente: HISTORICO,
    ...(caso.ofertaNoEstado ? { oferta_procedimento_pendente: true } : {}),
  };

  const inicio = Date.now();
  const resposta = await fetch(URL_RESPONSES, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chaveApi}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO_IRIS_NOVA,
      store: false,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      reasoning: { effort: esforco },
      text: { format: { type: 'json_schema', name: 'interpretacao', strict: true, schema: SCHEMA_PORTATIL_APROVADO } },
      input: [
        { role: 'system', content: INSTRUCOES },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    }),
  });
  const duracao_ms = Date.now() - inicio;

  const vazio = { status: 'erro', incomplete_reason: null, output_tokens: null, reasoning_tokens: null, tokens_visiveis: null, duracao_ms };
  if (!resposta.ok) return { ...vazio, veredito: 'falha_tecnica', erro: `http_${resposta.status}` };

  const j = (await resposta.json()) as {
    status?: string;
    incomplete_details?: { reason?: string };
    usage?: { output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  };

  const out = j.usage?.output_tokens ?? null;
  const rea = j.usage?.output_tokens_details?.reasoning_tokens ?? null;
  const base = {
    status: j.status ?? 'desconhecido',
    incomplete_reason: j.incomplete_details?.reason ?? null,
    output_tokens: out,
    reasoning_tokens: rea,
    tokens_visiveis: out !== null && rea !== null ? out - rea : null,
    duracao_ms,
  };

  if (j.status !== 'completed') return { ...base, veredito: 'falha_tecnica', erro: `incomplete_${j.incomplete_details?.reason ?? '?'}` };

  const msg = j.output?.find((o) => o?.type === 'message');
  const texto = msg?.content?.find((c) => c?.type === 'output_text')?.text;
  if (texto === undefined) return { ...base, veredito: 'falha_tecnica', erro: 'sem_saida' };

  let saida: { eventos_candidatos?: { tipo?: string }[]; dentistas_candidatos?: string[] | null };
  try {
    saida = JSON.parse(texto);
  } catch {
    return { ...base, veredito: 'falha_tecnica', erro: 'json_invalido' };
  }

  const aceitou = (saida.eventos_candidatos ?? []).some((e) => e?.tipo === 'aceitar_opcao');
  const nCandidatos = saida.dentistas_candidatos == null ? null : saida.dentistas_candidatos.length;
  const acertou =
    caso.esperado === 'aceitar_opcao' ? aceitou : caso.esperado === 'nao_aceitar' ? !aceitou : nCandidatos === 1;

  return { ...base, veredito: acertou ? 'ok' : 'erro' };
}

async function principal(): Promise<void> {
  const chaveApi = process.env.IRIS_EVAL_OPENAI_API_KEY;
  if (chaveApi === undefined || chaveApi.trim() === '') {
    console.log(JSON.stringify({ erro: 'chave_ausente' }));
    return;
  }

  const relatorio: Record<string, unknown> = { max_output_tokens: MAX_OUTPUT_TOKENS, modelo: MODELO_IRIS_NOVA };

  for (const esforco of ESFORCOS) {
    // Passada 1: os 12 casos, uma vez cada.
    const casos: Record<string, unknown>[] = [];
    for (const caso of CASOS) {
      const m = await medir(chaveApi, esforco, caso);
      casos.push({ caso: caso.nome, tipo: caso.esperado, ...m });
    }

    // Passada 2: o caso que truncou, 20 vezes.
    const repeticoes: Medida[] = [];
    for (let i = 0; i < 20; i++) repeticoes.push(await medir(chaveApi, esforco, CASO_QUE_TRUNCOU));

    const completos = repeticoes.filter((r) => r.status === 'completed');
    const incompletos = repeticoes.filter((r) => r.status !== 'completed');
    const media = (ns: number[]) => (ns.length === 0 ? null : Math.round(ns.reduce((a, b) => a + b, 0) / ns.length));

    relatorio[esforco] = {
      doze_casos: {
        ok: casos.filter((c) => c.veredito === 'ok').length,
        erro: casos.filter((c) => c.veredito === 'erro').length,
        falha_tecnica: casos.filter((c) => c.veredito === 'falha_tecnica').length,
        detalhe: casos,
      },
      repeticao_caso_que_truncou: {
        amostra: repeticoes.length,
        // NUMEROS DOS COMPLETOS E DOS INCOMPLETOS, SEPARADOS -- misturar
        // esconderia o truncamento numa media.
        completos: completos.length,
        incompletos: incompletos.length,
        motivos_incompletos: [...new Set(incompletos.map((r) => r.incomplete_reason ?? '?'))],
        completos_output_tokens_medio: media(completos.map((r) => r.output_tokens ?? 0)),
        completos_reasoning_tokens_medio: media(completos.map((r) => r.reasoning_tokens ?? 0)),
        completos_visiveis_medio: media(completos.map((r) => r.tokens_visiveis ?? 0)),
        completos_duracao_ms_media: media(completos.map((r) => r.duracao_ms)),
        incompletos_output_tokens_medio: media(incompletos.map((r) => r.output_tokens ?? 0)),
        incompletos_duracao_ms_media: media(incompletos.map((r) => r.duracao_ms)),
      },
    };
  }

  console.log(JSON.stringify(relatorio, null, 2));
}

await principal();
