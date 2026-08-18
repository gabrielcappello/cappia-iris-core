// Contrato `ResultadoIris` -- schema e instrucao COMPARTILHADOS entre a prova
// isolada (`src/eval/prova-resultado-iris.ts`) e o shadow de producao
// (`sombra-resultado-iris.ts`).
//
// POR QUE COMPARTILHADO, E NAO COPIADO: a prova e o instrumento que produziu
// a evidencia (rodadas 1, 2 e 3, modelo gpt-5.6-luna). Se o shadow rodasse
// com uma copia, as duas poderiam divergir em silencio e a medicao de
// producao deixaria de valer para o contrato medido. Uma fonte so.
//
// Este modulo NAO decide, NAO chama rede e NAO tem estado: so declara a forma
// da saida e o glossario das acoes.
//
// EXTRAIDO SEM ALTERACAO de prova-resultado-iris.ts em 2026-08-16 -- byte a
// byte o mesmo schema e a mesma instrucao com que a evidencia foi produzida.

const ALTERNATIVA_SCHEMA = {
  type: 'object',
  properties: {
    data: { type: ['string', 'null'] },
    horario: { type: ['string', 'null'] },
    periodo: { type: ['string', 'null'], enum: ['manha', 'tarde', 'noite', null] },
  },
  required: ['data', 'horario', 'periodo'],
  additionalProperties: false,
} as const;

const INFORMACAO_SCHEMA = {
  type: 'object',
  properties: {
    campo: {
      type: 'string',
      enum: ['nome', 'cpf', 'data_nascimento', 'email', 'procedimento', 'data', 'periodo', 'horario'],
    },
    operacao: { type: 'string', enum: ['informou', 'corrigiu'] },
    valor: { type: ['string', 'null'] },
  },
  required: ['campo', 'operacao', 'valor'],
  additionalProperties: false,
} as const;

function acaoSchema(tipoLiteral: string, propriedades: Record<string, unknown>, obrigatorios: string[]) {
  return {
    type: 'object',
    properties: { tipo: { type: 'string', enum: [tipoLiteral] }, ...propriedades },
    required: ['tipo', ...obrigatorios],
    additionalProperties: false,
  };
}

const DENTISTA_IDS_SCHEMA = { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] };

const ACOES_SCHEMAS = [
  acaoSchema('conversar', { objetivo: { type: 'string', enum: ['cumprimentar', 'responder_duvida', 'conversa_geral'] } }, [
    'objetivo',
  ]),
  acaoSchema('desistir', {}, []),
  acaoSchema(
    'consultar_disponibilidade',
    {
      procedimento_id: { type: ['string', 'null'] },
      dentista_ids: DENTISTA_IDS_SCHEMA,
      alternativas: { type: 'array', items: ALTERNATIVA_SCHEMA },
    },
    ['procedimento_id', 'dentista_ids', 'alternativas']
  ),
  // NOVA nesta rodada (ver comentario de topo, item 1).
  acaoSchema('consultar_agendamento', { agendamento_id: { type: ['string', 'null'] } }, ['agendamento_id']),
  acaoSchema(
    'pedir_agendamento',
    {
      procedimento_id: { type: ['string', 'null'] },
      dentista_ids: DENTISTA_IDS_SCHEMA,
      alternativas: { type: 'array', items: ALTERNATIVA_SCHEMA },
    },
    ['procedimento_id', 'dentista_ids', 'alternativas']
  ),
  // dentista_ids aceita [] -- ver comentario de topo, item 4. Nenhum minItems.
  acaoSchema('escolher_dentista', { dentista_ids: { type: 'array', items: { type: 'string' } } }, ['dentista_ids']),
  // operacao nova -- ver comentario de topo, item 2.
  acaoSchema(
    'escolher_horario',
    { referencia: { type: 'string' }, operacao: { type: 'string', enum: ['criar', 'remarcar'] } },
    ['referencia', 'operacao']
  ),
  // `escolher_agendamento` REMOVIDA na rodada 2 -- ver comentario de topo,
  // item 7. As tres acoes diretas abaixo (consultar_agendamento, remarcar,
  // cancelar) cobrem o caso, com o `agendamento_id` certo.
  acaoSchema(
    'confirmar',
    { operacao: { type: 'string', enum: ['criar', 'remarcar', 'cancelar'] }, agendamento_id: { type: ['string', 'null'] } },
    ['operacao', 'agendamento_id']
  ),
  acaoSchema('aceitar_oferta', { procedimento_id: { type: 'string' } }, ['procedimento_id']),
  // Nunca aciona efeito por si so -- ver comentario de topo, item 5.
  acaoSchema('cancelar', { agendamento_id: { type: ['string', 'null'] } }, ['agendamento_id']),
  acaoSchema(
    'remarcar',
    { agendamento_id: { type: ['string', 'null'] }, alternativas: { type: 'array', items: ALTERNATIVA_SCHEMA } },
    ['agendamento_id', 'alternativas']
  ),
];

const SCHEMA = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: ['compreendida', 'nao_compreendida'] },
    acao: { anyOf: [...ACOES_SCHEMAS, { type: 'null' }] },
    informacoes_fornecidas: { type: 'array', items: INFORMACAO_SCHEMA },
  },
  required: ['tipo', 'acao', 'informacoes_fornecidas'],
  additionalProperties: false,
};

export const SCHEMA_RESULTADO_IRIS = SCHEMA;

// ── INSTRUCAO ────────────────────────────────────────────────────────────────
// Glossario minimo das 12 acoes -- nenhuma regra por caso, nenhum exemplo de
// frase (mesma disciplina das medicoes anteriores). Como e a PRIMEIRA medicao
// destas acoes, um glossario curto e necessario -- diferente de reforcar um
// caso especifico.

const INSTRUCOES = `
Voce e a Iris, assistente de uma clinica odontologica, conversando com um paciente pelo WhatsApp.

Leia o contexto e a mensagem atual e devolva um objeto com "tipo" (compreendida ou nao_compreendida), "acao" e "informacoes_fornecidas".

Quando nao compreender o pedido, use tipo=nao_compreendida, acao=null, informacoes_fornecidas=[].

Quando compreender (tipo=compreendida), escolha UMA "acao" entre:
- conversar: cumprimento, duvida ou conversa que nao pede nenhuma operacao.
- desistir: o paciente esta encerrando o assunto em curso.
- consultar_disponibilidade: quer saber horarios, OU indicou um horario/data que AINDA NAO estava entre os oferecidos (precisa ser verificado). alternativas carrega o que ele indicou; procedimento_id/dentista_ids quando conhecidos.
- consultar_agendamento: quer saber sobre um agendamento que ja existe (confirmado? qual o horario? etc.), sem pedir para mudar nada. Use esta acao DIRETAMENTE mesmo quando ha varios agendamentos dele -- a propria mensagem ja diz qual (data, procedimento, dentista); resolva o agendamento_id certo contra a lista, nunca peca desambiguacao a mais.
- pedir_agendamento: quer marcar algo novo, ainda sem horario escolhido.
- escolher_dentista: esta escolhendo ou mencionando um profissional. dentista_ids traz o(s) ID(s) reais correspondentes -- lista vazia se mencionou alguem que nao esta na lista de dentistas disponiveis.
- escolher_horario: esta escolhendo um dos horarios JA OFERECIDOS nesta conversa. operacao="criar" quando o horario e para um agendamento novo em construcao; operacao="remarcar" quando existe um agendamento em processo de remarcacao (contexto trara agendamento_em_remarcacao).
- confirmar: esta confirmando explicitamente uma operacao ja proposta (um "sim"/"pode ser" claro para uma proposta concreta). operacao diz qual: criar (agendamento novo), remarcar ou cancelar -- use o que o contexto mostra estar em aberto (agendamento_em_remarcacao, agendamento_a_cancelar, ou nenhum dos dois = criar).
- aceitar_oferta: aceitou uma oferta de procedimento alternativo (ex.: Consulta/Avaliacao) que a Iris apresentou.
- cancelar: mencionou querer cancelar um agendamento, MAS AINDA NAO confirmou -- essa acao nunca executa nada sozinha, so prepara a pergunta de confirmacao. Nunca use "confirmar" para uma primeira mencao de cancelamento. Use esta acao DIRETAMENTE mesmo com varios agendamentos, se a mensagem ja diz qual.
- remarcar: mencionou querer remarcar um agendamento, com ou sem horario novo ainda. Use esta acao DIRETAMENTE mesmo com varios agendamentos, se a mensagem ja diz qual.

Quando "aguardando_resposta.tipo" for "escolha_agendamento" e trouxer "operacao", e o paciente responder de forma curta apontando uma das opcoes (ex.: "o primeiro", "esse mesmo"), emita DIRETAMENTE a acao terminal correspondente aquela operacao (consultar_agendamento, remarcar ou cancelar) com o agendamento_id resolvido contra "opcoes" -- nunca uma acao separada so para registrar a escolha.

"informacoes_fornecidas" -- fatos que o paciente declarou NESTA mensagem, cada um com "operacao": "informou" (dando o dado agora, valor sempre preenchido) ou "corrigiu" (valor errado -- se disse o certo, preencha valor; se so negou, valor fica null). Uma mencao que serve para ESCOLHER uma opcao apresentada e acao, nunca informacao -- um nome de profissional que voce ofereceu nao e o nome do paciente. Lista vazia quando nao ha nenhum fato novo.
`.trim();

export const INSTRUCOES_RESULTADO_IRIS = INSTRUCOES;
