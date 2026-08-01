// Tipos do resolvedor deterministico de dentistas e vinculos.
//
// Contrato: specs/dentistas-vinculos-v1.md. Estruturas de DOMINIO, nunca
// schema fisico -- a spec nao define tabelas, e o resolvedor recebe
// dentistas e vinculos prontos em vez de consultar banco.

/**
 * Dentista oficial do catalogo de UMA clinica.
 *
 * Identidade completa e sempre o par `(dentista_id, clinica_id)` (secao 1):
 * nao existe dentista global nesta v1.
 *
 * Tres campos de texto, com propositos DISTINTOS (secao 1, secao 6, e
 * secao 15 pendencia 1 -- tratados aqui como campos conceitualmente
 * separados, sem presumir que coincidem fisicamente):
 *
 * - `nome_exibido`: texto legivel ao paciente/painel, SEM valor de
 *   identidade e SEM participar de nenhuma correspondencia.
 * - `nome_completo_resolucao`: entrada de resolucao OBRIGATORIA (secao 6).
 * - `nome_curto_resolucao`: entrada de resolucao OPCIONAL (secao 6).
 *
 * "Entradas de resolucao, exatamente duas, nada alem" (secao 6) -- ao
 * contrario do procedimento (que tem uma lista aberta de aliases), o
 * dentista nunca tem mais que essas duas entradas fixas. Explicitamente
 * fora nesta v1: sistema aberto de aliases, apelidos aprendidos.
 */
export interface DentistaOficial {
  dentista_id: string;
  clinica_id: string;
  nome_exibido: string;
  nome_completo_resolucao: string;
  nome_curto_resolucao: string | null;
  ativo: boolean;
}

/**
 * Vinculo explicito entre `dentista_id` e `procedimento_id` (secao 2).
 *
 * `vinculo.clinica_id = dentista.clinica_id = procedimento.clinica_id`;
 * qualquer divergencia invalida o vinculo. Aptidao so existe quando o
 * vinculo existe E esta ativo -- nunca inferida por nome, especialidade ou
 * texto livre.
 */
export interface VinculoDentistaProcedimento {
  clinica_id: string;
  dentista_id: string;
  procedimento_id: string;
  ativo: boolean;
}

/**
 * `clinica_id` vem SEMPRE da instancia autenticada, ja resolvida pelo
 * servidor -- nunca do paciente e nunca da IA (docs/03-seguranca.md).
 *
 * `procedimento_id` e a identidade OFICIAL ja resolvida pelo resolvedor de
 * procedimento (specs/procedimentos-v1.md) -- opaca, nunca re-resolvida
 * aqui, nunca substituida por nome.
 *
 * `dentista_texto` e a preferencia textual do paciente, quando informada.
 * Ausente (null/undefined/vazio/so espacos) significa que o paciente nao
 * expressou preferencia -- nao equivale a "aceitar qualquer profissional"
 * (`dentistas-vinculos-v1.md` secao 4; evento canonico proprio em
 * `eventos-conversacionais-v1.md`).
 */
export interface EntradaResolucaoDentista {
  clinica_id: string;
  procedimento_id: string;
  dentista_texto: string | null | undefined;
  dentistas: readonly DentistaOficial[];
  vinculos: readonly VinculoDentistaProcedimento[];
}

/**
 * Projecao minima de um dentista apto/preferido devolvida nos resultados.
 * `nome_exibido` e dado de catalogo (nao PII do paciente) -- serve so para
 * apresentacao; a identidade operacional continua sendo `dentista_id`.
 */
export interface DentistaApto {
  dentista_id: string;
  clinica_id: string;
  nome_exibido: string;
}

/**
 * Motivo interno de preferencia resolvida-porem-nao-apta, para auditoria.
 *
 * **Equivalentes perante o paciente**, junto com `preferencia_nao_encontrada`
 * (secao 4: "tratamento unificado... os motivos internos... permanecem
 * distintos para auditoria... mas nao autorizam exposicao administrativa
 * desnecessaria ao paciente"). O controlador colapsa esses quatro motivos
 * (inexistente/inativo/sem_vinculo/vinculo_inativo) em uma unica resposta
 * externa; este resolvedor preserva a distincao internamente.
 */
export type MotivoPreferenciaNaoApta = 'dentista_inativo' | 'sem_vinculo' | 'vinculo_inativo';

/**
 * Codigos fechados de erro estrutural de catalogo/vinculo. Classificacao
 * por CODIGO, nunca por mensagem livre (mesmo padrao de
 * `procedimento-tipos.ts`).
 */
export type CodigoErroCatalogoDentista =
  /** Mesmo texto normalizado corresponde a `dentista_id` distintos (secao 6: colisao). */
  | 'nome_resolucao_ambiguo'
  /** Mesmo `dentista_id` aparece na clinica com conteudo divergente. */
  | 'dentista_id_inconsistente'
  /** Vinculo em escopo desta consulta aponta para `dentista_id` que nao existe em catalogo algum. */
  | 'vinculo_orfao'
  /** Vinculo em escopo desta consulta aponta para dentista pertencente a outra clinica (secao 2, secao 11). */
  | 'vinculo_clinica_divergente'
  /** Mesma chave (clinica_id, dentista_id, procedimento_id) aparece com `ativo` divergente. */
  | 'vinculo_inconsistente';

/**
 * Resultado tipado: exatamente um dos sete desfechos definidos no contrato
 * (rodada 0148). Uniao discriminada por `tipo`.
 *
 * **Composicao esperada pelo futuro controlador**: quando a preferencia nao
 * resolve para um dentista apto (`preferencia_nao_encontrada` ou
 * `preferencia_nao_apta`), a spec exige "reaplicar a regra de zero/um/varios
 * aptos" (secao 4). Este resolvedor NAO embute esse conjunto de aptos no
 * mesmo retorno -- a spec nao autoriza esse dado combinado explicitamente
 * (tarefa 0148 secao 7). O controlador deve chamar `resolverDentista`
 * novamente, com `dentista_texto` ausente, para obter o conjunto de aptos a
 * aplicar como fallback.
 */
export type ResultadoResolucaoDentista =
  | { tipo: 'nenhum_apto' }
  | { tipo: 'um_apto'; dentista: DentistaApto }
  | { tipo: 'varios_aptos'; dentistas: readonly DentistaApto[] }
  | { tipo: 'preferencia_apta'; dentista: DentistaApto }
  | { tipo: 'preferencia_nao_encontrada' }
  | { tipo: 'preferencia_nao_apta'; dentista: DentistaApto; motivo: MotivoPreferenciaNaoApta }
  | {
      tipo: 'erro_catalogo';
      codigo: CodigoErroCatalogoDentista;
      /** `dentista_id`s envolvidos, ordenados de forma estavel. Opacos, nunca nome ou texto do paciente. */
      dentista_ids: readonly string[];
    };
