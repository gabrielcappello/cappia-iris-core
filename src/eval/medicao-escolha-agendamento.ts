// Sonda ISOLADA de CONTRATO: descobrir a MENOR representacao possivel para o
// paciente escolher entre varios agendamentos ativos, medindo contra a IA
// real em vez de decidir no papel.
//
// Motivo de existir (specs/remarcacao-conversacional-v1.md secao 3): em
// specs/cpf-outro-telefone-v1.md secao 2, o contrato desenhado no papel
// (`recusar_troca_telefone`) teve ZERO emissoes contra a IA real. Contrato de
// evento neste projeto se escolhe por medicao, nunca por suposicao.
//
// TRES CONTRATOS CONCORRENTES, mesma mensagem, mesmo cenario:
//
//   A "id direto"  -- payload leva `agendamentos_ativos: [{agendamento_id,
//                     descricao}]`; a IA devolve `agendamento_id` em
//                     `alteracoes`. E o padrao JA PROVADO de
//                     `procedimentos_disponiveis`/`procedimento_id` e
//                     `dentistas_disponiveis`/`dentista_id`.
//
//   B "evento"     -- mesmo payload; a IA devolve o evento `aceitar_opcao`
//                     com `referencia_textual`, e o CORE resolveria depois.
//                     E a hipotese original da spec.
//
//   C "so a lista" -- payload leva a lista, e a IA NAO tem campo nem evento
//                     proprio para responder: so `natureza_mensagem` e os
//                     campos que ja existem. Mede o piso: quanto dessa
//                     escolha o contrato atual ja resolve sozinho?
//
// O contrato vencedor e o que resolver mais casos com menos mecanismo novo.
//
// NADA DE PRODUCAO E TOCADO: este arquivo nao importa nem altera nenhum
// modulo de src/core/, nao escreve em banco, nao muda schema, migration, RPC
// nem Edge Function.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-escolha-agendamento.ts

const MODELO = 'gpt-4.1-mini-2025-04-14' as const;
const URL_RESPONSES = 'https://api.openai.com/v1/responses';
const TIMEOUT_MS = 20000;
const MAX_OUTPUT_TOKENS = 400;

const CHAVE = process.env.OPENAI_API_KEY;
if (!CHAVE) {
  console.error('OPENAI_API_KEY ausente. Rode com --env-file apontando para o cofre canonico.');
  process.exit(1);
}

// --- Cenario: dois agendamentos ativos, realista (mesma clinica, mesmo
// paciente, procedimentos e dentistas diferentes) ---

const AG_1 = '11111111-1111-4111-8111-111111111111';
const AG_2 = '22222222-2222-4222-8222-222222222222';
const AG_3 = '33333333-3333-4333-8333-333333333333';

const LISTA_2 = [
  { agendamento_id: AG_1, descricao: 'Limpeza dental com Dra. Ana, sexta-feira 15/08 as 14:00' },
  { agendamento_id: AG_2, descricao: 'Canal com Dr. Bruno, sabado 23/08 as 09:00' },
];

const LISTA_3 = [
  ...LISTA_2,
  { agendamento_id: AG_3, descricao: 'Clareamento com Dra. Ana, quarta-feira 27/08 as 16:30' },
];

const RESPOSTA_IRIS_2 =
  'Vi que voce tem dois agendamentos: 1) Limpeza com a Dra. Ana na sexta 15/08 as 14:00; ' +
  '2) Canal com o Dr. Bruno no sabado 23/08 as 09:00. Qual deles voce quer remarcar?';

const RESPOSTA_IRIS_3 =
  'Vi que voce tem tres agendamentos: 1) Limpeza com a Dra. Ana na sexta 15/08 as 14:00; ' +
  '2) Canal com o Dr. Bruno no sabado 23/08 as 09:00; ' +
  '3) Clareamento com a Dra. Ana na quarta 27/08 as 16:30. Qual deles voce quer remarcar?';

// Frases de paciente REAL respondendo a essa pergunta. Nenhuma aparece nas
// instrucoes. Referencia de registro real de WhatsApp (docs/00-principios.md,
// principio dos testes realistas): frases curtas, com erro de digitacao,
// referencia parcial.
interface Caso {
  mensagem: string;
  lista: typeof LISTA_2;
  esperado: string; // agendamento_id que um humano diria ser o escolhido
  como: string; // por que criterio o paciente referenciou
}

const CASOS: Caso[] = [
  { mensagem: 'o segundo', lista: LISTA_2, esperado: AG_2, como: 'ordinal' },
  { mensagem: 'o primeiro', lista: LISTA_2, esperado: AG_1, como: 'ordinal' },
  { mensagem: 'a limpeza', lista: LISTA_2, esperado: AG_1, como: 'procedimento' },
  { mensagem: 'o do canal', lista: LISTA_2, esperado: AG_2, como: 'procedimento' },
  { mensagem: 'o da sexta', lista: LISTA_2, esperado: AG_1, como: 'dia da semana' },
  { mensagem: 'o de 23/08', lista: LISTA_2, esperado: AG_2, como: 'data' },
  { mensagem: 'o do Dr Bruno', lista: LISTA_2, esperado: AG_2, como: 'dentista' },
  { mensagem: 'quero mudar o de agosto 15', lista: LISTA_2, esperado: AG_1, como: 'data invertida' },
  { mensagem: 'o terceiro', lista: LISTA_3, esperado: AG_3, como: 'ordinal (3 itens)' },
  { mensagem: 'o clareamento', lista: LISTA_3, esperado: AG_3, como: 'procedimento (3 itens)' },
  { mensagem: 'o das 16:30', lista: LISTA_3, esperado: AG_3, como: 'horario (3 itens)' },
];

// --- Instrucao base (recorte fiel do que a interpretadora ja recebe hoje) ---

const INSTRUCAO_BASE = `Voce e a camada de interpretacao de uma assistente de clinica odontologica.
Leia a mensagem atual do paciente e devolva SOMENTE dados estruturados, no formato do schema.
Nunca converse, nunca responda ao paciente, nunca invente dado que nao esta na mensagem.

Classifique "natureza_mensagem" com exatamente um destes valores: saudacao, duvida, pedido, resposta, correcao, negacao, nao_compreendida.

Em "alteracoes", cada chave e um campo e o valor tem "acao" ("informar", "corrigir" ou "remover") e "valor".`;

const INSTRUCAO_A = `${INSTRUCAO_BASE}

- Quando "agendamentos_ativos" estiver presente, ele lista os agendamentos que o paciente ja tem, na ordem exata em que foram apresentados a ele. Interprete a mensagem atual como possivel escolha de UM deles — por ordinal ("o segundo"), por procedimento, por dentista, por data ou por horario — e preencha "agendamento_id" com o identificador correspondente da lista. Em duvida real sobre qual o paciente quis dizer, omita "agendamento_id" — nunca escolha por aproximacao.`;

const INSTRUCAO_B = `${INSTRUCAO_BASE}

- Quando "agendamentos_ativos" estiver presente, ele lista os agendamentos que o paciente ja tem, na ordem exata em que foram apresentados a ele. Se a mensagem atual escolher um deles, emita o evento "aceitar_opcao" e preencha "referencia_textual" com a referencia exata que o paciente usou ("o segundo", "a limpeza", "o da sexta"). Use null quando a escolha for deitica, sem referencia propria. Em duvida real, nao emita o evento.`;

const INSTRUCAO_C = `${INSTRUCAO_BASE}

- Quando "agendamentos_ativos" estiver presente, ele lista os agendamentos que o paciente ja tem, na ordem exata em que foram apresentados a ele.`;

// --- Schemas por contrato ---

function schema(contrato: 'A' | 'B' | 'C') {
  const campos: Record<string, unknown> = {
    intencao: campoAlteracao(),
    procedimento_id: campoAlteracao(),
    dentista_id: campoAlteracao(),
    data_texto: campoAlteracao(),
    horario_texto: campoAlteracao(),
    confirmacao: campoAlteracao(),
  };
  if (contrato === 'A') campos.agendamento_id = campoAlteracao();

  const propriedades: Record<string, unknown> = {
    natureza_mensagem: {
      type: 'string',
      enum: ['saudacao', 'duvida', 'pedido', 'resposta', 'correcao', 'negacao', 'nao_compreendida'],
    },
    alteracoes: { type: 'object', properties: campos, required: Object.keys(campos), additionalProperties: false },
  };
  const obrigatorios = ['natureza_mensagem', 'alteracoes'];

  if (contrato === 'B') {
    propriedades.eventos_candidatos = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['aceitar_opcao'] },
          referencia_textual: { type: ['string', 'null'] },
        },
        required: ['tipo', 'referencia_textual'],
        additionalProperties: false,
      },
    };
    obrigatorios.push('eventos_candidatos');
  }

  return {
    type: 'object',
    properties: propriedades,
    required: obrigatorios,
    additionalProperties: false,
  };
}

function campoAlteracao() {
  return {
    type: ['object', 'null'],
    properties: {
      acao: { type: 'string', enum: ['informar', 'corrigir', 'remover'] },
      valor: { type: ['string', 'null'] },
    },
    required: ['acao', 'valor'],
    additionalProperties: false,
  };
}

// --- Chamada ---

async function chamar(contrato: 'A' | 'B' | 'C', caso: Caso): Promise<Record<string, unknown> | null> {
  const instrucao = contrato === 'A' ? INSTRUCAO_A : contrato === 'B' ? INSTRUCAO_B : INSTRUCAO_C;
  const respostaIris = caso.lista.length === 3 ? RESPOSTA_IRIS_3 : RESPOSTA_IRIS_2;

  const payload = {
    mensagens_atuais: [caso.mensagem],
    dados_atuais: { intencao: 'remarcacao' },
    campos_cadastrais_preenchidos: ['nome', 'cpf', 'data_nascimento'],
    agendamentos_ativos: caso.lista,
    historico_recente: [{ mensagem_paciente: 'preciso remarcar minha consulta', resposta_iris: respostaIris }],
  };

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch(URL_RESPONSES, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${CHAVE}` },
      body: JSON.stringify({
        model: MODELO,
        instructions: instrucao,
        input: JSON.stringify(payload),
        max_output_tokens: MAX_OUTPUT_TOKENS,
        text: {
          format: { type: 'json_schema', name: 'interpretacao', strict: true, schema: schema(contrato) },
        },
      }),
      signal: controlador.signal,
    });
    if (!resposta.ok) {
      console.error(`  [${contrato}] HTTP ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`);
      return null;
    }
    const corpo = (await resposta.json()) as { output?: { content?: { text?: string }[] }[] };
    const texto = corpo.output?.flatMap((o) => o.content ?? []).find((c) => typeof c.text === 'string')?.text;
    return texto ? (JSON.parse(texto) as Record<string, unknown>) : null;
  } catch (erro) {
    console.error(`  [${contrato}] falhou: ${erro instanceof Error ? erro.name : 'desconhecido'}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- Avaliacao por contrato ---

function avaliarA(saida: Record<string, unknown>, caso: Caso): { ok: boolean; obs: string } {
  const alt = saida.alteracoes as Record<string, { acao: string; valor: string | null } | null> | undefined;
  const valor = alt?.agendamento_id?.valor ?? null;
  if (valor === null) return { ok: false, obs: 'agendamento_id ausente' };
  return { ok: valor === caso.esperado, obs: valor === caso.esperado ? 'id correto' : `id ERRADO (${rotulo(valor)})` };
}

function avaliarB(saida: Record<string, unknown>, _caso: Caso): { ok: boolean; obs: string } {
  const eventos = (saida.eventos_candidatos ?? []) as { tipo: string; referencia_textual: string | null }[];
  const aceitou = eventos.some((e) => e.tipo === 'aceitar_opcao');
  if (!aceitou) return { ok: false, obs: 'evento NAO emitido' };
  const ref = eventos.find((e) => e.tipo === 'aceitar_opcao')?.referencia_textual;
  // O evento so e util se a referencia permitir ao Core desambiguar.
  return { ok: true, obs: `evento emitido, referencia_textual=${ref === null ? 'null' : `"${ref}"`}` };
}

function avaliarC(saida: Record<string, unknown>, _caso: Caso): { ok: boolean; obs: string } {
  const alt = saida.alteracoes as Record<string, { acao: string; valor: string | null } | null> | undefined;
  const preenchidos = Object.entries(alt ?? {})
    .filter(([, v]) => v !== null && v?.valor != null)
    .map(([k, v]) => `${k}=${v?.valor}`);
  return {
    ok: false, // C nunca identifica o agendamento por construcao; medimos o RUIDO que ele gera.
    obs: preenchidos.length === 0 ? 'nada preenchido' : preenchidos.join(', '),
  };
}

function rotulo(id: string): string {
  if (id === AG_1) return 'AG_1';
  if (id === AG_2) return 'AG_2';
  if (id === AG_3) return 'AG_3';
  return id.slice(0, 8);
}

// --- Runner ---

async function main() {
  console.log(`Medicao de contrato: escolha entre multiplos agendamentos`);
  console.log(`Modelo: ${MODELO} | casos: ${CASOS.length} | contratos: A, B, C\n`);

  const placar: Record<string, number> = { A: 0, B: 0, C: 0 };

  for (const caso of CASOS) {
    console.log(`"${caso.mensagem}"  (${caso.como}, esperado ${rotulo(caso.esperado)})`);
    for (const contrato of ['A', 'B', 'C'] as const) {
      const saida = await chamar(contrato, caso);
      if (!saida) {
        console.log(`  ${contrato}: SEM RESPOSTA`);
        continue;
      }
      const aval =
        contrato === 'A' ? avaliarA(saida, caso) : contrato === 'B' ? avaliarB(saida, caso) : avaliarC(saida, caso);
      if (aval.ok) placar[contrato]!++;
      const natureza = saida.natureza_mensagem;
      console.log(`  ${contrato}: ${aval.ok ? 'OK ' : '-- '} ${aval.obs}  [natureza=${natureza}]`);
    }
    console.log('');
  }

  console.log('--- PLACAR ---');
  for (const contrato of ['A', 'B', 'C'] as const) {
    console.log(`  ${contrato}: ${placar[contrato]}/${CASOS.length}`);
  }
  console.log('\nA = id direto (padrao procedimento_id/dentista_id)');
  console.log('B = evento aceitar_opcao + referencia_textual (Core resolveria)');
  console.log('C = so a lista, sem campo nem evento (piso: o que o contrato atual ja resolve)');
}

void main();
