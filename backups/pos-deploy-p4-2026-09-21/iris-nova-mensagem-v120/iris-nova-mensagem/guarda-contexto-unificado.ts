// Guarda estrutural e validação de forma do contrato unificado
// (specs/contexto-conversacional-unificado-v1.md §4 e §5.1).
//
// SOMENTE SHADOW. Nenhuma função deste arquivo é chamada por qualquer decisão
// de atendimento, por qualquer escrita em `estado_conversa` ou pela redatora.
// Ela avalia a saída do contrato NOVO, em paralelo, para medição.
//
// PURO: sem I/O, sem relógio, sem rede. Todo o resultado é derivado da saída
// recebida.

import type {
  InformacaoFornecida,
  PerguntaPendente,
  SaidaContratoUnificado,
} from './contexto-unificado-tipos.ts';

/**
 * FORMA do contrato (spec §4). O schema estrito da OpenAI não expressa
 * restrição condicional por valor de campo -- o que `valor` aceita depende de
 * `operacao` -- então a garantia vive aqui, como dever do Core.
 *
 * String vazia é INVÁLIDA em qualquer operação e **nunca é normalizada**: só
 * `null` representa remoção. Normalizar seria adivinhar a intenção de uma saída
 * malformada, que é o tipo de conserto silencioso que produziu os defeitos da
 * spec §1.
 *
 * Devolve `null` quando a saída está bem formada, ou o motivo da recusa.
 */
export function validarFormaSaida(saida: SaidaContratoUnificado): string | null {
  for (const item of saida.informacoes_fornecidas) {
    const vazio = item.valor === null || item.valor.trim() === '';
    if (item.operacao === 'informou' && vazio) {
      return `${item.campo}: informou com valor vazio ou null`;
    }
    if (item.operacao === 'corrigiu' && item.valor !== null && item.valor.trim() === '') {
      return `${item.campo}: corrigiu com string vazia -- use null para remover`;
    }
  }
  return null;
}

/** Ações em que a mensagem do paciente serve para ESCOLHER um profissional. */
const ACOES_DE_ESCOLHA_DE_PROFISSIONAL: readonly string[] = ['escolher_dentista'];

export interface ResultadoGuarda {
  /** `true` quando a co-ocorrência foi detectada e o nome NÃO pode ser persistido. */
  bloqueou: boolean;
  /**
   * O que a Iris deve perguntar quando a guarda bloqueia. `null` quando não
   * bloqueou. Usa o `aguardando_resposta` genérico -- nunca um marcador novo.
   */
  pergunta: PerguntaPendente | null;
  /**
   * As informações que PODEM seguir para persistência. Idêntica à entrada
   * quando não bloqueou; sem o `nome` quando bloqueou. Os demais campos nunca
   * são tocados: a guarda protege identidade, não descarta dado alheio.
   */
  informacoes_liberadas: readonly InformacaoFornecida[];
}

/**
 * GUARDA ESTRUTURAL (spec §5.1): escolher profissional não identifica paciente.
 *
 * Dispara quando o MESMO turno traz `escolher_dentista` **e** um `nome`. O nome
 * não é persistido e a Iris pergunta qual dos dois papéis a palavra tinha.
 *
 * DETECÇÃO ESTRUTURAL, NUNCA TEXTUAL. O gatilho é a co-ocorrência dos dois
 * campos -- esta função nunca compara `"Pablo"` com `"Dr. Pablo Arruda"`.
 * Comparar exigiria normalizar título, primeiro nome e acento, o que (a) é
 * match de palavra, proibido em `docs/00-principios.md`, (b) foi deliberadamente
 * removido deste código em 2026-08-09 (`specs/dentista-semantico-v1.md`), e (c)
 * é frágil: um apelido faria o match falhar e a contaminação passar em silêncio
 * de novo.
 *
 * PERGUNTAR, NUNCA DESCARTAR. Descartar caladamente trocaria um erro visível
 * por um invisível. A dúvida é do paciente e é ele quem a resolve.
 *
 * POR QUE A GUARDA EXISTE MESMO COM O CONTRATO NOVO: a medição de 2026-08-14
 * mostrou o contrato reduzindo muito a contaminação, mas de forma INSTÁVEL --
 * `"vanesa por favor"` oscilou entre 5/8 e 8/8 em rodadas sucessivas, sem
 * nenhuma mudança de contrato. E o modo de falha é o pior possível: a IA declara
 * o nome com plena confiança, sem sinal de dúvida.
 *
 * CUSTO ACEITO E DECLARADO: `"Vanesa, e meu nome é Gabriel"` dispara uma
 * confirmação desnecessária. Nenhum refinamento é aplicado (por exemplo, aceitar
 * o nome quando vier CPF junto) -- seria regra inventada antes da evidência.
 */
export function aplicarGuardaEscolhaProfissional(saida: SaidaContratoUnificado): ResultadoGuarda {
  const escolheProfissional = ACOES_DE_ESCOLHA_DE_PROFISSIONAL.includes(saida.acao_solicitada.tipo);
  const nomeDeclarado = saida.informacoes_fornecidas.find((i) => i.campo === 'nome');

  if (!escolheProfissional || nomeDeclarado === undefined) {
    return { bloqueou: false, pergunta: null, informacoes_liberadas: saida.informacoes_fornecidas };
  }

  return {
    bloqueou: true,
    pergunta: {
      tipo: 'confirmacao_nome',
      // O valor entra no detalhe para a redatora poder citá-lo na pergunta.
      // Não é comparação: é o próprio valor declarado, devolvido ao paciente.
      ...(nomeDeclarado.valor !== null ? { detalhe: { nome_proposto: nomeDeclarado.valor } } : {}),
    },
    informacoes_liberadas: saida.informacoes_fornecidas.filter((i) => i.campo !== 'nome'),
  };
}
