// Tipos do resolvedor deterministico de procedimento.
//
// Contrato: specs/procedimentos-v1.md. Estruturas de DOMINIO, nunca schema
// fisico -- a spec nao define tabelas, e o resolvedor recebe o catalogo
// pronto em vez de consultar banco.

/**
 * Procedimento oficial do catalogo de UMA clinica.
 *
 * Identidade completa e sempre o par `(procedimento_id, clinica_id)`
 * (secao 1): nao existe procedimento global ou compartilhado entre
 * clinicas nesta v1.
 *
 * `nome_pt` e o nome exibido -- serve para apresentacao e snapshot
 * historico, e NUNCA tem valor de identidade nem participa da
 * correspondencia (secao 1: "a Iris nunca identifica procedimento pelo
 * nome exibido").
 */
export interface ProcedimentoOficial {
  procedimento_id: string;
  clinica_id: string;
  nome_pt: string;
  ativo: boolean;
  eh_consulta_avaliacao: boolean;
}

/**
 * Entrada explicita de resolucao (secao 5): texto -> `procedimento_id`.
 * Nunca um calculo, sempre um registro auditavel definido no seed.
 *
 * `texto` e armazenado como cadastrado; a normalizacao canonica e aplicada
 * na comparacao, nunca no dado de origem.
 */
export interface AliasProcedimento {
  clinica_id: string;
  procedimento_id: string;
  texto: string;
  ativo: boolean;
}

/**
 * `clinica_id` vem SEMPRE da instancia autenticada, ja resolvida pelo
 * servidor -- nunca do paciente e nunca da IA (docs/03-seguranca.md).
 *
 * `procedimento_texto` e o texto puro extraido pela IA. Pode estar ausente:
 * em duvida real a IA omite o campo, e ausencia resolve como nao resolvido
 * (secao 6).
 */
export interface EntradaResolucaoProcedimento {
  clinica_id: string;
  procedimento_texto: string | null | undefined;
  catalogo: readonly ProcedimentoOficial[];
  aliases: readonly AliasProcedimento[];
}

/**
 * Motivo interno de nao resolucao, para auditoria tecnica.
 *
 * **Todos sao equivalentes perante o paciente.** specs/procedimentos-v1.md
 * secao 7 e specs/atendimento-v1.md secao 5 proibem revelar que um
 * procedimento existe mas esta inativo. O controlador trata os quatro
 * motivos de forma uniforme na conversa; a distincao existe somente para
 * auditoria interna.
 */
export type MotivoNaoResolvido =
  | 'texto_ausente'
  | 'sem_correspondencia'
  | 'alias_inativo'
  | 'procedimento_inativo';

/**
 * Codigos fechados de erro estrutural de catalogo (secao 6: "erro de
 * catalogo/seed... falha tecnica interna, tratada como rede de seguranca,
 * nunca como resultado operacional").
 *
 * Classificacao por CODIGO, nunca por mensagem livre.
 */
export type CodigoErroCatalogoProcedimento =
  /** Mesmo texto normalizado resolve para procedimentos diferentes na mesma clinica (secao 5). */
  | 'alias_ambiguo'
  /** Alias aponta para um `procedimento_id` que nao existe em nenhum catalogo recebido. */
  | 'alias_orfao'
  /** Alias da clinica aponta para procedimento pertencente a outra clinica (secao 1). */
  | 'alias_clinica_divergente'
  /** Mesmo `procedimento_id` aparece na clinica com conteudo divergente. */
  | 'procedimento_id_inconsistente';

// A unicidade de `eh_consulta_avaliacao` por clinica (secao 8) NAO tem
// codigo aqui: ela nao pertence a resolucao texto -> procedimento_id. A
// regra de produto continua valendo, e falhara fechado no componente que
// avaliar o fallback de Consulta/Avaliacao (ou em validador de catalogo
// proprio), quando essa etapa for autorizada.

/**
 * Resultado tipado: exatamente um dos tres desfechos da secao 6.
 * Uniao discriminada por `tipo` -- o chamador nunca precisa inferir.
 */
export type ResultadoResolucaoProcedimento =
  | {
      tipo: 'resolvido';
      /** Identidade oficial. Unica autoridade operacional. */
      procedimento_id: string;
      /** Confirma que o resultado pertence a clinica recebida. */
      clinica_id: string;
      /** Apresentacao e snapshot historico. Nunca identidade. */
      nome_pt: string;
      eh_consulta_avaliacao: boolean;
      /**
       * Texto normalizado que produziu a correspondencia. Corresponde
       * exatamente a um alias do catalogo, entao e texto de catalogo --
       * nao carrega PII do paciente. Serve a auditoria tecnica.
       */
      alias_normalizado: string;
    }
  | {
      tipo: 'nao_resolvido';
      motivo: MotivoNaoResolvido;
    }
  | {
      tipo: 'erro_catalogo';
      codigo: CodigoErroCatalogoProcedimento;
      /**
       * `procedimento_id`s envolvidos, ordenados de forma estavel. Sao
       * identificadores opacos do catalogo, nunca dado do paciente.
       */
      procedimento_ids: readonly string[];
    };
