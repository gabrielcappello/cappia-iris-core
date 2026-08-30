// A REDATORA no cenario real do domingo (revisao do Codex, 2026-08-30).
//
// O teste deterministico de `fatos-autorizados` prova que os INGREDIENTES
// chegam (motivo_sem_expediente, data_referencia, dados_faltantes,
// procedimento_avaliacao_disponivel). Nao prova que a Luna COMBINA os tres
// comportamentos pedidos numa resposta so.
//
// Este runner mede isso contra a IA real.
//
// OS FATOS NAO SAO ESCRITOS A MAO: sai tudo de `derivarFatosAutorizados`, a
// mesma funcao da producao, a partir da decisao que o orquestrador de fato
// produz neste turno. Escrever o JSON a mao mediria um payload que a producao
// nunca envia -- erro ja cometido nesta investigacao.
//
// Classifica cada execucao em seis criterios independentes. NAO ajusta
// instrucao nenhuma: o objetivo e medir o comportamento atual e apresenta-lo.
//
// Saida sanitizada: metricas, vereditos e flags booleanas. O texto do modelo
// nunca e impresso -- nem trecho, nem parafrase.

import { INSTRUCOES_REDATOR } from '../core/redator-instrucoes.ts';
import { MODELO_IRIS_NOVA } from '../core/cliente-modelo-openai.ts';
import { derivarFatosAutorizados } from '../core/fatos-autorizados.ts';
import type { DecisaoOrquestrador } from '../core/orquestrador-tipos.ts';

const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const MAX_OUTPUT_TOKENS = 300;
const ESFORCO = 'none'; // a configuracao aprovada e ja em producao (v90)
const REPETICOES = 12;

const HOJE = '2026-08-30'; // DOMINGO
const CLINICA = 'Cleardent';
const MENSAGEM = 'quero um turno para hoje. tem algum horario disponivel?';
const NOME_AVALIACAO = 'Consulta / Avaliação';

// A decisao EXATA que `decidir` devolve neste turno: procedimento ausente,
// avaliacao oferecivel, e a data pedida caindo em domingo.
const DECISAO: DecisaoOrquestrador = {
  tipo: 'aguardando_procedimento',
  procedimento_oferecido: 'consultation_evaluation',
  sem_expediente_na_data_pedida: { data: '2026-08-30', motivo: 'domingo' },
};

// Fatos como a PRODUCAO os monta -- 12 parametros posicionais, o ultimo sendo
// `procedimentoAvaliacaoDisponivel`, que o orquestrador preenche em
// `aguardando_procedimento`.
const FATOS = derivarFatosAutorizados(
  DECISAO,
  HOJE,
  undefined,
  undefined,
  { nome: 'Gabriel Cappello' },
  undefined,
  undefined,
  undefined,
  undefined,
  true, // paciente novo na clinica -- o caso real
  undefined,
  NOME_AVALIACAO
);

type Criterios = {
  informou_fechamento: boolean;
  nao_ofereceu_para_hoje: boolean;
  conduziu_para_outra_data: boolean;
  seguiu_com_procedimento: boolean;
  nao_inventou_dado: boolean;
};

/**
 * Classificacao LEXICA, deliberadamente conservadora. Nao e a regra do
 * produto -- nada disto entra no Core; serve so para medir texto livre neste
 * runner. Prefere marcar duvida como falha a deixar passar.
 */
function classificar(texto: string): Criterios {
  const t = texto.toLowerCase();

  // 1. disse que domingo/hoje nao ha atendimento.
  const informou_fechamento =
    /domingo/.test(t) &&
    /(n[ãa]o|sem)\s+\w*\s*(atend|funcion|abr|expedien|h[áa] atendimento)|fechad|n[ãa]o abrimos|n[ãa]o temos atendimento/.test(t);

  // 2. NAO ofereceu a consulta para hoje. Procura a oferta amarrada a "hoje".
  const ofertaParaHoje =
    /(hoje|agora)[^.?!]{0,40}(avalia|consulta)/.test(t) || /(avalia|consulta)[^.?!]{0,40}\bhoje\b/.test(t);
  // "hoje e domingo", "hoje nao atendemos" nao sao oferta -- so contam quando
  // a frase realmente propoe o procedimento para hoje.
  const negaHoje = /hoje[^.?!]{0,30}(n[ãa]o|domingo|fechad)/.test(t);
  const nao_ofereceu_para_hoje = !ofertaParaHoje || negaHoje;

  // 3. conduziu para outra data -- SOMENTE de forma EXPLICITA (revisao do
  //    Codex, 2026-08-30).
  //
  // Uma versao anterior deste runner aceitava tambem a conducao "implicita":
  // oferecer a avaliacao logo apos informar o fechamento, no pressuposto de
  // que a proposta so poderia se referir a outro dia. Isso foi REJEITADO, e
  // com razao -- oferecer o procedimento nao deixa explicito qual e o proximo
  // passo temporal, e o paciente fica sem saber o que responder sobre a data.
  //
  // Pior: eu afrouxei o criterio DEPOIS de ver o numero (6/12), o que
  // transforma a regua em funcao do resultado. O criterio agora e um so, fixo,
  // e o numero e o que for.
  const conduziu_para_outra_data =
    /outro dia|outra data|outro momento|nova data|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|amanh[ãa]|pr[óo]xim|qual dia|que dia|quando voc[êe]|dia da semana|durante a semana|dias? [úu]tei?[si]|melhor dia|prefer[êe]ncia de (dia|data|hor[áa]rio)|reagendar para|remarcar para/.test(
      t
    );

  // 4. seguiu pedindo procedimento OU oferecendo a avaliacao.
  const seguiu_com_procedimento = /avalia|consulta|procedimento|atendimento que|o que voc[êe] (precisa|gostaria|deseja)/.test(t);

  // 5. nao inventou horario, dentista ou disponibilidade. Nenhum desses fatos
  //    foi enviado -- entao qualquer um que apareca e invencao.
  const inventouHorario = /\b\d{1,2}[:h]\d{2}\b|\b\d{1,2}\s?h\b/.test(t);
  const inventouDentista = /\bdr[a]?\.?\s+[a-zà-ú]/.test(t);
  const inventouDisponibilidade = /(temos|tenho|h[áa]|dispon[íi]ve[li])[^.?!]{0,30}(vaga|hor[áa]rio)/.test(t);
  const nao_inventou_dado = !inventouHorario && !inventouDentista && !inventouDisponibilidade;

  return {
    informou_fechamento,
    nao_ofereceu_para_hoje,
    conduziu_para_outra_data,
    seguiu_com_procedimento,
    nao_inventou_dado,
  };
}

type Execucao = { ok: boolean; criterios: Criterios; hash: string; tokens: number | null; ms: number; falha?: string };

/** Impressao digital do texto -- mede repeticao sem expor conteudo. */
async function digitalDoTexto(texto: string): Promise<string> {
  const normalizado = texto.toLowerCase().replace(/\s+/g, ' ').trim();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizado));
  return [...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function executar(chaveApi: string): Promise<Execucao> {
  const inicio = Date.now();
  const resposta = await fetch(URL_RESPONSES, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chaveApi}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO_IRIS_NOVA,
      store: false,
      stream: false,
      background: false,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      reasoning: { effort: ESFORCO },
      input: [
        { role: 'system', content: INSTRUCOES_REDATOR },
        {
          role: 'user',
          content: JSON.stringify({
            mensagem_paciente: MENSAGEM,
            natureza_mensagem: 'pedido',
            fatos_autorizados: FATOS,
            nome_clinica: CLINICA,
            data_hoje: HOJE,
          }),
        },
      ],
    }),
  });
  const ms = Date.now() - inicio;

  const vazio = { ok: false, criterios: classificar(''), hash: '-', tokens: null, ms };
  if (!resposta.ok) return { ...vazio, falha: `http_${resposta.status}` };

  const j = (await resposta.json()) as {
    status?: string;
    usage?: { output_tokens?: number };
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  };
  if (j.status !== 'completed') return { ...vazio, falha: `incomplete` };

  const texto = j.output?.find((o) => o?.type === 'message')?.content?.find((c) => c?.type === 'output_text')?.text;
  if (texto === undefined || texto.trim() === '') return { ...vazio, falha: 'resposta_vazia' };

  const criterios = classificar(texto);
  return {
    ok: Object.values(criterios).every(Boolean),
    criterios,
    hash: await digitalDoTexto(texto),
    tokens: j.usage?.output_tokens ?? null,
    ms,
  };
}

async function principal(): Promise<void> {
  const chaveApi = process.env.IRIS_EVAL_OPENAI_API_KEY;
  if (chaveApi === undefined || chaveApi.trim() === '') {
    console.log(JSON.stringify({ erro: 'chave_ausente' }));
    return;
  }

  // Prova que os fatos vieram da producao, sem PII e sem texto livre.
  console.log('fatos derivados (chaves):', Object.keys(FATOS).sort().join(', '));
  console.log('  objetivo..................:', FATOS.objetivo);
  console.log('  motivo_sem_expediente.....:', FATOS.motivo_sem_expediente);
  console.log('  data_referencia...........:', FATOS.data_referencia);
  console.log('  dados_faltantes...........:', JSON.stringify(FATOS.dados_faltantes));
  console.log('  avaliacao disponivel......:', FATOS.procedimento_avaliacao_disponivel);
  console.log(`\nmodelo=${MODELO_IRIS_NOVA} effort=${ESFORCO} limite=${MAX_OUTPUT_TOKENS} execucoes=${REPETICOES}\n`);

  const execucoes: Execucao[] = [];
  for (let i = 0; i < REPETICOES; i++) execucoes.push(await executar(chaveApi));

  const conta = (f: (c: Criterios) => boolean) => execucoes.filter((e) => e.falha === undefined && f(e.criterios)).length;
  const validas = execucoes.filter((e) => e.falha === undefined).length;
  const hashes = new Set(execucoes.filter((e) => e.falha === undefined).map((e) => e.hash));

  console.log('CRITERIO                                    ACERTOS');
  console.log('informou o fechamento no domingo..........:', conta((c) => c.informou_fechamento) + '/' + validas);
  console.log('NAO ofereceu avaliacao "para hoje"........:', conta((c) => c.nao_ofereceu_para_hoje) + '/' + validas);
  console.log('conduziu para outra data (SO explicito)...:', conta((c) => c.conduziu_para_outra_data) + '/' + validas);
  console.log('seguiu com procedimento/avaliacao.........:', conta((c) => c.seguiu_com_procedimento) + '/' + validas);
  console.log('nao inventou horario/dentista/vaga........:', conta((c) => c.nao_inventou_dado) + '/' + validas);
  console.log('\nTODOS os criterios na mesma resposta.......:', execucoes.filter((e) => e.ok).length + '/' + validas);
  console.log('respostas textualmente distintas..........:', hashes.size + '/' + validas, hashes.size === validas ? '(nenhuma frase fixa)' : '(HA repeticao literal)');

  const falhas = execucoes.filter((e) => e.falha !== undefined);
  if (falhas.length > 0) console.log('falhas tecnicas...........................:', falhas.length, [...new Set(falhas.map((f) => f.falha))].join(','));

  const media = (ns: number[]) => (ns.length === 0 ? 0 : Math.round(ns.reduce((a, b) => a + b, 0) / ns.length));
  console.log('tokens medios / duracao media.............:', media(execucoes.map((e) => e.tokens ?? 0)), '/', media(execucoes.map((e) => e.ms)) + 'ms');

  // Detalhe por execucao, so em flags -- para inspecionar um caso que falhou.
  console.log('\nPOR EXECUCAO (fech|hoje|data|proc|inv):');
  for (const [i, e] of execucoes.entries()) {
    if (e.falha !== undefined) { console.log(` ${String(i + 1).padStart(2)}. FALHA ${e.falha}`); continue; }
    const c = e.criterios;
    const f = [c.informou_fechamento, c.nao_ofereceu_para_hoje, c.conduziu_para_outra_data, c.seguiu_com_procedimento, c.nao_inventou_dado]
      .map((b) => (b ? 'ok' : 'XX')).join(' ');
    console.log(` ${String(i + 1).padStart(2)}. ${f}  #${e.hash}`);
  }
}

await principal();
