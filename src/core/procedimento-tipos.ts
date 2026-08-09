// Tipo do catalogo de procedimentos de UMA clinica.
//
// Contrato: specs/procedimento-semantico-v1.md. Estrutura de DOMINIO, nunca
// schema fisico -- o carregador (carregar-catalogo.ts) traduz o schema real
// para este formato.
//
// Este arquivo tinha 127 linhas ate 2026-08-08, quase todas descrevendo a
// arquitetura de resolucao TEXTUAL de procedimento: `AliasProcedimento`,
// `EntradaResolucaoProcedimento`, `ResultadoResolucaoProcedimento`,
// `MotivoNaoResolvido`, `CodigoErroCatalogoProcedimento`, `alias_normalizado`
// e `eh_consulta_avaliacao`. Tudo removido junto com `resolver-procedimento.ts`:
// quem entende o pedido do paciente agora e a IA interpretadora, que devolve
// `procedimento_id` canonico; o Core so confere existencia, clinica e estado
// ativo. Sem aliases, nao ha ambiguidade textual, alias orfao, alias inativo
// nem texto normalizado a reportar -- nenhum desses conceitos existe mais.
//
// `eh_consulta_avaliacao` saiu por nao ter NENHUM consumidor de decisao: era
// `false` hardcoded no carregador e so trafegava. A IA identifica a consulta/
// avaliacao lendo `nome_pt`, sem precisar de marcador.

/**
 * Procedimento oficial do catalogo de UMA clinica.
 *
 * Identidade completa e sempre o par `(procedimento_id, clinica_id)`: nao
 * existe procedimento global ou compartilhado entre clinicas.
 *
 * `nome_pt` e o nome exibido. Desde specs/procedimento-semantico-v1.md ele
 * tem um segundo papel: e o texto que a IA interpretadora LE para entender a
 * que procedimento o paciente se refere. Continua sem valor de identidade --
 * a autoridade operacional e sempre `procedimento_id`.
 */
export interface ProcedimentoOficial {
  procedimento_id: string;
  clinica_id: string;
  nome_pt: string;
  ativo: boolean;
}
