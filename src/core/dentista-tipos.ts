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
 * REMOVIDO em 2026-08-09 (specs/dentista-semantico-v1.md):
 * `nome_completo_resolucao` e `nome_curto_resolucao`. Os dois existiam
 * exclusivamente como chave de correspondencia textual em
 * `resolverPorPreferencia`, que deixou de existir -- a secao 6 da
 * `dentistas-vinculos-v1.md` ("entradas de resolucao, exatamente duas",
 * match exato, colisoes) foi revogada.
 *
 * `nome_exibido` permanece e agora tem dois usos, ambos de apresentacao:
 * o texto que a IA LE em `dentistas_disponiveis` para correlacionar, e o
 * texto da pergunta de desambiguacao. Nunca tem valor de identidade --
 * exatamente o que aconteceu com `nome_pt` em procedimento.
 */
export interface DentistaOficial {
  dentista_id: string;
  clinica_id: string;
  nome_exibido: string;
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
 * Desde 2026-08-09 este resolvedor calcula SOMENTE aptidao (zero/um/varios)
 * -- nunca recebe preferencia. A preferencia do paciente chega ao Core como
 * `dentista_id` ja resolvido pela interpretadora, e e conferida no
 * orquestrador (identidade, clinica, ativo, vinculo), nunca aqui.
 *
 * Ausencia de preferencia continua NAO equivalendo a "aceitar qualquer
 * profissional" (`dentistas-vinculos-v1.md` secao 4, preservada; evento
 * canonico proprio em `eventos-conversacionais-v1.md`, dormente).
 */
export interface EntradaResolucaoDentista {
  clinica_id: string;
  procedimento_id: string;
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
 * Codigo fechado de erro estrutural de catalogo. Classificacao por CODIGO,
 * nunca por mensagem livre (mesmo padrao de `procedimento-tipos.ts`).
 *
 * REMOVIDOS em 2026-08-09 (specs/dentista-semantico-v1.md secao 6), apos
 * auditoria de alcancabilidade contra o unico produtor de catalogo em
 * producao (`carregarCatalogo`):
 *
 * - `nome_resolucao_ambiguo` -- nao existe mais colisao textual a detectar;
 * - `vinculo_orfao` e `vinculo_clinica_divergente` -- `montarDentistas`
 *   empurra o vinculo no MESMO laco que empurra o dentista, com o mesmo
 *   `dentista_id`/`clinica_id`; o vinculo nunca aponta para alguem ausente;
 * - `vinculo_inconsistente` -- o mesmo laco empurra SEMPRE `ativo: true`,
 *   entao a mesma chave nunca aparece com `ativo` divergente.
 *
 * Sobrou o unico alcancavel: dois registros com o mesmo `id` e conteudo
 * diferente sao gravaveis pelo Painel.
 */
export type CodigoErroCatalogoDentista = 'dentista_id_inconsistente';

/**
 * Resultado tipado: exatamente um dos quatro desfechos. Uniao discriminada
 * por `tipo`.
 *
 * As tres variantes de preferencia (`preferencia_apta`,
 * `preferencia_nao_encontrada`, `preferencia_nao_apta`) foram REMOVIDAS em
 * 2026-08-09 junto com `resolverPorPreferencia` e a recursao de fallback do
 * orquestrador: este resolvedor passou a calcular somente aptidao. A
 * preferencia do paciente e conferida no orquestrador, sobre um
 * `dentista_id` que a interpretadora ja resolveu.
 */
export type ResultadoResolucaoDentista =
  | { tipo: 'nenhum_apto' }
  | { tipo: 'um_apto'; dentista: DentistaApto }
  | { tipo: 'varios_aptos'; dentistas: readonly DentistaApto[] }
  | {
      tipo: 'erro_catalogo';
      codigo: CodigoErroCatalogoDentista;
      /** `dentista_id`s envolvidos, ordenados de forma estavel. Opacos, nunca nome ou texto do paciente. */
      dentista_ids: readonly string[];
    };
