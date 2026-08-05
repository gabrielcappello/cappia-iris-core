import { CAMPOS_PERMITIDOS, CONFIRMACOES_PERMITIDAS, INTENCOES_PERMITIDAS, PERIODOS_PERMITIDOS } from './aplicar-dados.ts';
import { NATUREZAS_MENSAGEM_PERMITIDAS } from './interpretacao-tipos.ts';

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
- Datas sao sempre preservadas como texto, exatamente como mencionadas — nunca calcule, resolva ou normalize datas relativas.
- Horarios sao normalizados para o formato HH:MM em 24 horas sempre que a expressao for uma referencia de horario inequivoca mencionada pelo proprio paciente (ex.: "15h", "15 hrs", "15 horas", "as 15" e "quinze horas" tornam-se todos "15:00"; "15:30" permanece "15:30") — nunca invente um horario que o paciente nao mencionou, nunca infira um horario ausente a partir de outro dado (ex.: procedimento, periodo ou data nunca implicam horario). Em duvida real sobre qual horario foi mencionado, omita horario_texto — mesma regra de duvida real ja vigente para os demais campos.
- Quando o paciente mencionar "hoje" ou "amanha" como a data desejada, preencha data_texto com esse texto exatamente como mencionado — mesmo quando a mensagem for uma pergunta (ex.: "Pode ser hoje?" preenche data_texto = "hoje"; "Pode ser amanha?" preenche data_texto = "amanha"). Uma pergunta sobre disponibilidade em uma data explicita como essa nao e "duvida real" — a data em si esta clara.
- Procedimento e dentista sao sempre preservados como texto mencionado pelo paciente — nunca resolva contra nenhum catalogo.
- Remocao de um dado so ocorre quando o paciente pedir explicitamente para apagar/desconsiderar aquele dado especificamente.
- Emita intencao = novo_agendamento somente quando a janela atual expressar um pedido de marcar um novo atendimento; a mera mencao ou correcao de procedimento, dentista, data, periodo ou horario nao emite intencao.
- Emita confirmacao = sim somente quando o paciente confirmar afirmativamente de forma clara e explicita (ex.: "sim", "confirmo", "pode marcar", "isso mesmo"). Nunca emita confirmacao diante de duvida, pergunta, hesitacao ou resposta negativa — nesses casos omita o campo por completo, nunca emita um valor diferente de "sim".
- Quando mais de um valor coexistir para o mesmo campo (ex.: dois procedimentos, dois dentistas alternativos), preserve todos em uma unica string minima, na ordem em que foram mencionados — nunca escolha um, nunca crie array, nunca resolva a ambiguidade.
- Quando houver correcoes sucessivas do mesmo campo dentro da janela, aplique somente a ultima correcao cronologica:
  - se o campo nao existia em dados_atuais, use "informar";
  - se existia e foi claramente substituido, use "corrigir";
  - se o valor final da janela voltar a ser exatamente igual ao valor em dados_atuais, use "informar".
- Nunca inclua confidence, justificativa, explicacao, resposta ao paciente ou qualquer texto dirigido ao proprio paciente.
- Nunca decida o proximo estado da conversa.
- Alem de "alteracoes", classifique tambem "natureza_mensagem": o tipo da mensagem atual, sempre um destes valores, nunca mais de um: "saudacao" (cumprimento puro, sem mais nenhum conteudo), "duvida" (pergunta ou comentario fora do vocabulario de agendamento — nunca responda como se fosse um profissional de saude, so classifique), "pedido" (a mensagem avanca o agendamento: procedimento, dentista, data, periodo ou horario), "resposta" (reage a algo que foi perguntado, ex.: escolha de horario, confirmacao, dado cadastral), "correcao" (corrige um dado ja informado antes), "negacao" (recusa ou desistencia explicita, sem pedir outra coisa no lugar), "nao_compreendida" (nao foi possivel classificar com seguranca em nenhuma das categorias acima). Em duvida real entre duas categorias, classifique como "nao_compreendida" — nunca adivinhe. "natureza_mensagem" e "alteracoes" sao preenchidos sempre juntos, na mesma resposta.
- Responda estritamente no formato do schema fornecido — nenhuma propriedade alem de "natureza_mensagem" e "alteracoes" no nivel principal, nenhuma propriedade alem de "acao"/"valor" (ou somente "acao" para remover) dentro de cada alteracao.

Campos permitidos: ${CAMPOS_PERMITIDOS.join(', ')}.
Valores permitidos para periodo: ${PERIODOS_PERMITIDOS.join(', ')}.
Valores permitidos para intencao: ${INTENCOES_PERMITIDAS.join(', ')}.
Valores permitidos para confirmacao: ${CONFIRMACOES_PERMITIDAS.join(', ')}.
Valores permitidos para natureza_mensagem: ${NATUREZAS_MENSAGEM_PERMITIDAS.join(', ')}.
`.trim();

function schemaValorCampo(campo: string): object {
  if (campo === 'periodo') {
    return { type: 'string', enum: [...PERIODOS_PERMITIDOS] };
  }
  if (campo === 'intencao') {
    return { type: 'string', enum: [...INTENCOES_PERMITIDAS] };
  }
  if (campo === 'confirmacao') {
    return { type: 'string', enum: [...CONFIRMACOES_PERMITIDAS] };
  }
  return { type: 'string', minLength: 1 };
}

// Schema fechado (additionalProperties: false em todos os niveis): a
// mesma forma que validarSaidaInterpretacao exige em tempo de execucao.
export const SCHEMA_SAIDA_INTERPRETACAO: object = {
  type: 'object',
  additionalProperties: false,
  required: ['natureza_mensagem', 'alteracoes'],
  properties: {
    natureza_mensagem: { type: 'string', enum: [...NATUREZAS_MENSAGEM_PERMITIDAS] },
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
