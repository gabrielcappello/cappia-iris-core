import { CAMPOS_PERMITIDOS, INTENCOES_PERMITIDAS, PERIODOS_PERMITIDOS } from './aplicar-dados.ts';

// Unico lugar onde o contrato dado ao modelo (instrucoes + schema) e
// registrado. Qualquer mudanca de comportamento esperado da IA deve ser
// feita aqui, nunca duplicada em outro arquivo.

export const INSTRUCOES_EXTRATOR = `
Voce interpreta uma janela de mensagens de um paciente em uma clinica odontologica e produz somente as alteracoes estruturadas finais a aplicar ao cadastro em andamento da conversa.

Regras obrigatorias:

- Interprete a janela inteira (mensagens_atuais) como uma unica unidade — nunca mensagem por mensagem.
- Produza somente o efeito final por campo: se o mesmo campo foi mencionado varias vezes na janela, considere apenas o resultado final; valores intermediarios da janela nunca sao aplicados.
- Um campo nao mencionado na janela deve ficar totalmente ausente do resultado — nunca inclua um campo "sem alteracao".
- Em caso de duvida real sobre o que o paciente quis dizer, omita o campo — nunca adivinhe.
- Desconhecimento (paciente nao sabe, nao informou, ainda nao decidiu) nunca gera "informar" nem "remover" — apenas omita o campo.
- "periodo" nunca e inferido a partir de um horario mencionado (ex.: "14h" nao implica "tarde") — so preencha "periodo" se o paciente mencionar o periodo explicitamente.
- Datas e horarios sao sempre preservados como texto, exatamente como mencionados — nunca calcule, resolva ou normalize datas relativas.
- Procedimento e dentista sao sempre preservados como texto mencionado pelo paciente — nunca resolva contra nenhum catalogo.
- Remocao de um dado so ocorre quando o paciente pedir explicitamente para apagar/desconsiderar aquele dado especificamente.
- Emita intencao = novo_agendamento somente quando a janela atual expressar um pedido de marcar um novo atendimento; a mera mencao ou correcao de procedimento, dentista, data, periodo ou horario nao emite intencao.
- Quando mais de um valor coexistir para o mesmo campo (ex.: dois procedimentos, dois dentistas alternativos), preserve todos em uma unica string minima, na ordem em que foram mencionados — nunca escolha um, nunca crie array, nunca resolva a ambiguidade.
- Quando houver correcoes sucessivas do mesmo campo dentro da janela, aplique somente a ultima correcao cronologica:
  - se o campo nao existia em dados_atuais, use "informar";
  - se existia e foi claramente substituido, use "corrigir";
  - se o valor final da janela voltar a ser exatamente igual ao valor em dados_atuais, use "informar".
- Nunca inclua confidence, justificativa, explicacao, resposta ao paciente ou qualquer texto dirigido ao proprio paciente.
- Nunca decida o proximo estado da conversa.
- Responda estritamente no formato do schema fornecido — nenhuma propriedade alem de "alteracoes" no nivel principal, nenhuma propriedade alem de "acao"/"valor" (ou somente "acao" para remover) dentro de cada alteracao.

Campos permitidos: ${CAMPOS_PERMITIDOS.join(', ')}.
Valores permitidos para periodo: ${PERIODOS_PERMITIDOS.join(', ')}.
Valores permitidos para intencao: ${INTENCOES_PERMITIDAS.join(', ')}.
`.trim();

function schemaValorCampo(campo: string): object {
  if (campo === 'periodo') {
    return { type: 'string', enum: [...PERIODOS_PERMITIDOS] };
  }
  if (campo === 'intencao') {
    return { type: 'string', enum: [...INTENCOES_PERMITIDAS] };
  }
  return { type: 'string', minLength: 1 };
}

// Schema fechado (additionalProperties: false em todos os niveis): a
// mesma forma que validarSaidaInterpretacao exige em tempo de execucao.
export const SCHEMA_SAIDA_INTERPRETACAO: object = {
  type: 'object',
  additionalProperties: false,
  required: ['alteracoes'],
  properties: {
    alteracoes: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        CAMPOS_PERMITIDOS.map((campo) => [
          campo,
          {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['acao', 'valor'],
                properties: {
                  acao: { type: 'string', enum: ['informar', 'corrigir'] },
                  valor: schemaValorCampo(campo),
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['acao'],
                properties: {
                  acao: { type: 'string', const: 'remover' },
                },
              },
            ],
          },
        ])
      ),
    },
  },
};
