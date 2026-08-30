// Matriz de `reasoning.effort` na REDATORA (2026-08-30).
//
// A redatora tambem usa a Luna e tem limite MENOR: `max_output_tokens = 300`
// (cliente-modelo-redator-openai.ts). Como ela produz TEXTO LIVRE (sem schema),
// truncar aqui nao gera JSON invalido -- gera frase cortada, ou resposta
// vazia quando o raciocinio consome os 300 tokens sozinho.
//
// Varia UMA coisa: `reasoning.effort`. Instrucoes, fatos, limite e modelo sao
// identicos nas tres configuracoes.
//
// OS FATOS NAO SAO ESCRITOS A MAO. Cada cenario declara uma DECISAO real do
// orquestrador e os fatos saem de `derivarFatosAutorizados` -- a mesma funcao
// que a producao usa. Escrever o JSON a mao mediria um payload que a producao
// nunca envia (foi o primeiro erro desta medicao: `dentista_confirmado` em
// `sem_expediente_no_dia`, campo que `fatos-autorizados.ts` nao produz ali).
//
// Faz chamadas PAGAS. Saida sanitizada: metrica, veredito e flags booleanas --
// nunca o texto livre do modelo.

import { INSTRUCOES_REDATOR } from '../core/redator-instrucoes.ts';
import { MODELO_IRIS_NOVA } from '../core/cliente-modelo-openai.ts';
import { derivarFatosAutorizados, type FatosAutorizados } from '../core/fatos-autorizados.ts';
import type { DecisaoOrquestrador } from '../core/orquestrador-tipos.ts';
import type { NaturezaMensagem } from '../core/interpretacao-tipos.ts';
import type { ParConversa } from '../core/tipos.ts';

const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const MAX_OUTPUT_TOKENS = 300;
const ESFORCOS = ['none', 'low', 'medium'] as const;
type Esforco = (typeof ESFORCOS)[number];

const HOJE = '2026-08-30'; // domingo
const CLINICA = 'Cleardent';
const CADASTRO = { nome: 'Gabriel Cappello' };

type Cenario = {
  nome: string;
  mensagem: string;
  natureza: NaturezaMensagem;
  fatos: FatosAutorizados;
  historico?: ParConversa[];
  /** O que a resposta NAO pode dizer. */
  proibido?: { rotulo: string; padrao: RegExp };
  /** O que a resposta precisa comunicar. */
  exigido?: { rotulo: string; padrao: RegExp };
};

/** Fatos como a producao os monta, a partir de uma decisao real. */
function fatosDe(decisao: DecisaoOrquestrador, extras?: { avaliacao?: string }): FatosAutorizados {
  return derivarFatosAutorizados(
    decisao,
    HOJE,
    undefined, // substituicao por avaliacao
    undefined, // agendamentos do paciente
    CADASTRO,
    undefined, // clinica conhecida
    undefined, // precos
    undefined, // dentistas da clinica
    undefined, // tratamentos aprovados
    undefined, // paciente novo
    undefined, // procedimentos ativos
    extras?.avaliacao
  );
}

// Sem `as`: se a forma da decisao divergir do tipo real, tem que quebrar aqui,
// nao virar um payload silenciosamente diferente do de producao.
const DECISAO_DOMINGO: DecisaoOrquestrador = {
  tipo: 'horarios_disponiveis',
  procedimento_id: 'consultation_evaluation',
  dentista_id: 'dent-diego-perez',
  dentista_nome_exibido: 'Dr. Diego Perez',
  duracao_min: 30,
  resultado: { tipo: 'sem_expediente_no_dia', motivo: 'domingo' },
};

const CENARIOS: Cenario[] = [
  // (a) Dentista JA escolhido -- a regressao da conversa real (item 4).
  //
  // Nota importante do contrato: em `sem_expediente_no_dia` os fatos NAO
  // carregam `dentista_confirmado` (fatos-autorizados.ts:820-825). Entao a
  // redatora sabe do dentista apenas pelo `historico_recente`. E exatamente
  // esse o turno em que a resposta real negou o registro.
  {
    nome: 'a) dentista ja escolhido, paciente reclama ("ja falei diego perez")',
    mensagem: 'já falei diego perez',
    natureza: 'correcao',
    fatos: fatosDe(DECISAO_DOMINGO),
    historico: [
      {
        mensagem_paciente: 'ok pode ser',
        resposta_iris: 'Combinado! Com qual profissional você prefere: Dr. Diego Perez ou Dr. Diego Ramoz?',
        gerada_em: '2026-08-30T12:00:00.000Z',
      },
      {
        mensagem_paciente: 'diego perez',
        resposta_iris: 'Perfeito, Dr. Diego Perez. Para qual dia você gostaria?',
        gerada_em: '2026-08-30T12:01:00.000Z',
      },
    ],
    proibido: {
      rotulo: 'negou o registro ou pediu o dentista de novo',
      padrao:
        /n[ãa]o (foi |consegui |identifi|registr|receb)|qual profissional|com qual dentista|escolh[ae] (um|o) profissional|precis[oa] (que voc[êe] )?(me )?(informe|diga) o (profissional|dentista)/i,
    },
  },

  // (b) Domingo / sem expediente -- fluxo limpo.
  {
    nome: 'b) domingo / sem expediente',
    mensagem: 'pode ser hoje?',
    natureza: 'pedido',
    fatos: fatosDe(DECISAO_DOMINGO),
    exigido: { rotulo: 'informou que nao ha atendimento e pediu outra data', padrao: /domingo|n[ãa]o (h[áa]|tem|atend)|fechad|outro dia|outra data/i },
    proibido: { rotulo: 'repetiu pergunta ja respondida', padrao: /qual procedimento|que tipo de (atendimento|procedimento)|qual profissional/i },
  },

  // (c) Oferta de Consulta/Avaliacao -- o turno 2 da conversa real.
  {
    nome: 'c) oferta de Consulta/Avaliacao',
    mensagem: 'quero um turno para hoje. tem algum horario disponivel?',
    natureza: 'pedido',
    fatos: fatosDe({ tipo: 'aguardando_procedimento' }, { avaliacao: 'Consulta / Avaliação' }),
    exigido: { rotulo: 'ofereceu a avaliacao', padrao: /avalia|consulta/i },
    proibido: { rotulo: 'inventou outro procedimento', padrao: /limpeza|restaura|clareamento|extra[çc][ãa]o|canal|implante|ortodont/i },
  },

  // (d) Escolha de dentista.
  {
    nome: 'd) escolha de dentista',
    mensagem: 'quero marcar avaliação',
    natureza: 'pedido',
    fatos: fatosDe({
      tipo: 'aguardando_escolha_dentista',
      dentistas: [
        { dentista_id: 'a', clinica_id: 'c', nome_exibido: 'Dr. Diego Perez' },
        { dentista_id: 'b', clinica_id: 'c', nome_exibido: 'Dr. Diego Ramoz' },
      ],
    }),
    exigido: { rotulo: 'citou os profissionais reais', padrao: /perez/i },
    proibido: { rotulo: 'inventou profissional', padrao: /dr[a]?\.?\s+(ana|bruno|carlos|joão|joao|maria|paulo|silva)/i },
  },

  // (e) Confirmacao de reserva -- o desfecho executado.
  {
    nome: 'e) confirmacao de reserva criada',
    mensagem: 'pode confirmar',
    natureza: 'resposta',
    fatos: fatosDe({
      tipo: 'reserva_criada',
      agendamento_id: 'ag-1',
      dentista_id: 'dent-diego-perez',
      procedimento_id: 'consultation_evaluation',
      duracao_min: 30,
      data: '2026-09-01',
      horario: '14:00',
      dentista_nome_exibido: 'Dr. Diego Perez',
      procedimento_nome: 'Consulta / Avaliação',
    }),
    exigido: { rotulo: 'anunciou o horario confirmado', padrao: /14:00|14h/i },
    proibido: { rotulo: 'anunciou que vai aguardar', padrao: /aguardando sua confirma|vou aguardar|fico no aguardo|assim que voc[êe] responder/i },
  },

  // (f) Pedido de reformulacao.
  {
    nome: 'f) pedido de reformulacao',
    mensagem: 'aaa bbb ccc',
    natureza: 'nao_compreendida',
    fatos: fatosDe({ tipo: 'mensagem_nao_compreendida' }),
    proibido: { rotulo: 'inventou fato operacional', padrao: /\d{1,2}[:h]\d{2}|confirmad|agendad|marcad/i },
  },
];

type Medida = {
  status: string;
  incomplete_reason: string | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  tokens_visiveis: number | null;
  duracao_ms: number;
  veredito: 'ok' | 'erro' | 'falha_tecnica';
  motivo?: string;
};

async function medir(chaveApi: string, esforco: Esforco, c: Cenario): Promise<Medida> {
  const inicio = Date.now();
  let resposta: Response;
  try {
    resposta = await fetch(URL_RESPONSES, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chaveApi}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODELO_IRIS_NOVA,
        store: false,
        stream: false,
        background: false,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        reasoning: { effort: esforco },
        input: [
          { role: 'system', content: INSTRUCOES_REDATOR },
          {
            role: 'user',
            content: JSON.stringify({
              mensagem_paciente: c.mensagem,
              natureza_mensagem: c.natureza,
              fatos_autorizados: c.fatos,
              ...(c.historico !== undefined ? { historico_recente: c.historico } : {}),
              nome_clinica: CLINICA,
              data_hoje: HOJE,
            }),
          },
        ],
      }),
    });
  } catch {
    return { status: 'erro', incomplete_reason: null, output_tokens: null, reasoning_tokens: null, tokens_visiveis: null, duracao_ms: Date.now() - inicio, veredito: 'falha_tecnica', motivo: 'erro_de_rede' };
  }
  const duracao_ms = Date.now() - inicio;

  const vazio = { status: 'erro', incomplete_reason: null, output_tokens: null, reasoning_tokens: null, tokens_visiveis: null, duracao_ms };
  if (!resposta.ok) return { ...vazio, veredito: 'falha_tecnica', motivo: `http_${resposta.status}` };

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

  const texto = j.output?.find((o) => o?.type === 'message')?.content?.find((x) => x?.type === 'output_text')?.text;

  // A producao trata QUALQUER uma destas como falha e cai no fallback
  // deterministico -- entao contam como falha tecnica aqui tambem.
  if (j.status !== 'completed') {
    return { ...base, veredito: 'falha_tecnica', motivo: `incomplete_${j.incomplete_details?.reason ?? '?'}` };
  }
  if (texto === undefined || texto.trim() === '') {
    return { ...base, veredito: 'falha_tecnica', motivo: 'resposta_vazia' };
  }

  if (c.proibido !== undefined && c.proibido.padrao.test(texto)) return { ...base, veredito: 'erro', motivo: c.proibido.rotulo };
  if (c.exigido !== undefined && !c.exigido.padrao.test(texto)) return { ...base, veredito: 'erro', motivo: `nao ${c.exigido.rotulo}` };
  return { ...base, veredito: 'ok' };
}

const media = (ns: number[]) => (ns.length === 0 ? null : Math.round(ns.reduce((a, b) => a + b, 0) / ns.length));

async function principal(): Promise<void> {
  const chaveApi = process.env.IRIS_EVAL_OPENAI_API_KEY;
  if (chaveApi === undefined || chaveApi.trim() === '') {
    console.log(JSON.stringify({ erro: 'chave_ausente' }));
    return;
  }

  const relatorio: Record<string, unknown> = { max_output_tokens: MAX_OUTPUT_TOKENS, modelo: MODELO_IRIS_NOVA, data_hoje: HOJE };

  for (const esforco of ESFORCOS) {
    const linhas: Record<string, unknown>[] = [];
    for (const c of CENARIOS) linhas.push({ cenario: c.nome, ...(await medir(chaveApi, esforco, c)) });

    // Item 4: o caso do dentista, repetido -- uma passada nao prova nada sobre
    // uma falha que aparece de forma intermitente.
    const repetDentista: Medida[] = [];
    for (let i = 0; i < 10; i++) repetDentista.push(await medir(chaveApi, esforco, CENARIOS[0]));

    // Item 5: o domingo ponta a ponta, repetido pelo mesmo motivo.
    const repetDomingo: Medida[] = [];
    for (let i = 0; i < 10; i++) repetDomingo.push(await medir(chaveApi, esforco, CENARIOS[1]));

    const completos = linhas.filter((l) => l.status === 'completed');
    const resumo = (rs: Medida[]) => ({
      amostra: rs.length,
      ok: rs.filter((r) => r.veredito === 'ok').length,
      erro_semantico: rs.filter((r) => r.veredito === 'erro').length,
      falha_tecnica: rs.filter((r) => r.veredito === 'falha_tecnica').length,
      motivos: [...new Set(rs.filter((r) => r.veredito !== 'ok').map((r) => r.motivo ?? '?'))],
      completos_output_medio: media(rs.filter((r) => r.status === 'completed').map((r) => r.output_tokens ?? 0)),
      completos_reasoning_medio: media(rs.filter((r) => r.status === 'completed').map((r) => r.reasoning_tokens ?? 0)),
      completos_visiveis_medio: media(rs.filter((r) => r.status === 'completed').map((r) => r.tokens_visiveis ?? 0)),
      duracao_ms_media: media(rs.map((r) => r.duracao_ms)),
    });

    relatorio[esforco] = {
      seis_cenarios: {
        ok: linhas.filter((l) => l.veredito === 'ok').length,
        erro_semantico: linhas.filter((l) => l.veredito === 'erro').length,
        falha_tecnica: linhas.filter((l) => l.veredito === 'falha_tecnica').length,
        completos_output_medio: media(completos.map((l) => (l.output_tokens as number) ?? 0)),
        completos_reasoning_medio: media(completos.map((l) => (l.reasoning_tokens as number) ?? 0)),
        completos_visiveis_medio: media(completos.map((l) => (l.tokens_visiveis as number) ?? 0)),
        duracao_ms_media: media(linhas.map((l) => l.duracao_ms as number)),
        detalhe: linhas,
      },
      dentista_ja_escolhido_10x: resumo(repetDentista),
      domingo_10x: resumo(repetDomingo),
    };
  }

  console.log(JSON.stringify(relatorio, null, 2));
}

await principal();
