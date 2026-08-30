// Tipos do resolvedor deterministico de duracao.
//
// Contrato: specs/duracao-v1.md. Estruturas de DOMINIO, nunca schema fisico
// -- a spec nao define tabelas (secao 13, pendencia 4: "Onde a configuracao
// de duracao vive fisicamente -- schema fora de escopo"), e o resolvedor
// recebe as configuracoes prontas em vez de consultar banco.

/**
 * Configuracao oficial de duracao de UM DENTISTA, para UM procedimento, em UMA
 * clinica.
 *
 * Fonte oficial (secao 1, revisada em 30/08/2026):
 * `clinica_id + dentista_id + procedimento_id = duracao_min`.
 *
 * A duracao PERTENCE AO DENTISTA escolhido: profissionais diferentes da mesma
 * clinica podem ter duracoes diferentes para o mesmo procedimento, e isso e
 * configuracao valida -- nunca conflito. NAO pertence ao vinculo, e NAO e
 * duracao global compartilhada entre clinicas.
 *
 * **Nenhum campo `ativo`**: a spec nao define estado ativo/inativo para a
 * configuracao de duracao -- so a existencia da chave
 * `(clinica_id, dentista_id, procedimento_id)` e o valor. Criar esse campo aqui seria
 * estrutura antecipada, o que a secao 4 proibe explicitamente ("nao deve
 * gerar estruturas antecipadas nesta versao").
 *
 * **Nenhum campo de modo**: `geral_dentista`, `especifica_vinculo` e
 * qualquer enum de modo estao fora da v1 (secao 4).
 */
export interface ConfiguracaoDuracao {
  clinica_id: string;
  /**
   * De QUEM e esta duracao (2026-08-30, decisao do Gabriel).
   *
   * Ate aqui a configuracao guardava so `(clinica_id, procedimento_id)`, e
   * `carregar-catalogo.ts` empilhava uma entrada POR DENTISTA nessa mesma
   * chave. Dois profissionais com duracoes legitimamente diferentes para o
   * mesmo procedimento viravam dois valores distintos na mesma chave, e
   * `resolverDuracao` -- corretamente, pelo contrato antigo -- devolvia
   * `duracao_conflitante`.
   *
   * Caso real de producao (v91, 2026-08-30, turno 21:40:06 UTC, confirmado nos
   * logs): Diego Perez (auto, 60min) + Diego Ramoz e Pablo Arruda
   * (procedimento, 30min) para a mesma Consulta/Avaliacao. O paciente escolheu
   * o Perez e recebeu "instabilidade tecnica" -- a duracao dos OUTROS
   * profissionais bloqueava a agenda dele.
   *
   * Cada dentista usa exclusivamente a propria duracao. Diferencas entre
   * profissionais sao configuracao valida, nunca conflito.
   */
  dentista_id: string;
  procedimento_id: string;
  /**
   * Duracao em minutos. Tipado como `number`, mas SEMPRE validado em
   * runtime: o dado atravessa fronteira de confianca (vem da configuracao
   * da clinica), e a secao 2 exige que "o Core tambem devera validar o
   * valor recebido da fonte oficial e falhar fechado diante de
   * inconsistencia -- a validacao do painel nao dispensa a validacao do
   * Core".
   */
  duracao_min: number;
}

/**
 * `clinica_id` vem SEMPRE da instancia autenticada, ja resolvida pelo
 * servidor -- nunca do paciente e nunca da IA (docs/03-seguranca.md).
 *
 * `procedimento_id` e a identidade OFICIAL ja resolvida pelo resolvedor de
 * procedimento -- opaca, nunca re-resolvida aqui, nunca substituida por
 * `nome_pt`, alias, especialidade ou texto do paciente (secao 5:
 * "resolucao por nome" e proibida sem excecao).
 *
 * **`dentista_id` e OBRIGATORIO na entrada** (revisado em 30/08/2026, decisao
 * do Gabriel): ele integra a chave da duracao
 * (`clinica_id + dentista_id + procedimento_id`), porque a duracao PERTENCE ao
 * dentista escolhido. E a identidade OFICIAL ja resolvida pelo resolvedor de
 * dentista -- nunca nome, posicao no array ou fallback.
 *
 * Exigi-lo, em vez de aceita-lo opcionalmente, e deliberado: um chamador que o
 * esqueca falha alto, na hora, em vez de voltar em silencio a comparar
 * profissionais diferentes entre si.
 *
 * O vinculo dentista-procedimento continua comprovando aptidao e isolamento,
 * e continua NAO alterando o valor da duracao (secao 1).
 */
export interface EntradaResolucaoDuracao {
  clinica_id: string;
  /**
   * O profissional JA ESCOLHIDO para este atendimento (2026-08-30). A
   * resolucao passa a ser por `clinica_id + dentista_id + procedimento_id`:
   * so a configuracao DELE e considerada, e a de outro profissional nunca
   * entra na comparacao.
   */
  dentista_id: string;
  procedimento_id: string;
  configuracoes: readonly ConfiguracaoDuracao[];
}

/**
 * Motivo pelo qual um valor configurado nao cumpre a secao 2. Cada motivo
 * corresponde exatamente a uma das regras publicadas -- nenhum limite
 * inventado.
 *
 * O valor NUNCA e corrigido, arredondado ou truncado (secao 2: "Nao
 * arredondar, truncar ou corrigir automaticamente, em nenhuma camada").
 */
export type MotivoDuracaoInvalida =
  /** Nao e numero real: tipo errado, `NaN`, `Infinity` ou `-Infinity`. String nunca e convertida. */
  | 'nao_numerica'
  /** Numero com parte fracionaria. Nunca truncado para inteiro. */
  | 'nao_inteira'
  /** Abaixo do minimo de 10 minutos -- inclui zero e valores negativos. */
  | 'abaixo_do_minimo'
  /** Acima do maximo de 240 minutos. */
  | 'acima_do_maximo'
  /** Inteiro dentro dos limites, mas nao multiplo de 10. Nunca ajustado. */
  | 'nao_multipla_de_10';

/**
 * Codigos fechados de erro estrutural de configuracao. Classificacao por
 * CODIGO, nunca por mensagem livre (mesmo padrao dos resolvedores de
 * procedimento e de dentista).
 *
 * Existe um unico codigo porque `(clinica_id, dentista_id, procedimento_id)` e
 * a chave: a unica divergencia estruturalmente possivel para a mesma chave e no
 * proprio `duracao_min`. Duracoes diferentes entre DENTISTAS distintos nao sao
 * divergencia -- sao chaves diferentes (revisado em 30/08/2026).
 */
export type CodigoErroConfiguracaoDuracao =
  /** Mesma chave `(clinica_id, dentista_id, procedimento_id)` com valores de duracao divergentes. */
  'duracao_conflitante';

/**
 * Resultado tipado: exatamente um dos quatro desfechos. Uniao discriminada
 * por `tipo` -- o chamador nunca precisa inferir.
 *
 * `nao_configurada` e `invalida` sao ambos falha fechada perante o
 * controlador (secao 6), com motivos internos distintos preservados para
 * auditoria -- mesmo padrao de `dentistas-vinculos-v1.md` secao 4.
 */
export type ResultadoResolucaoDuracao =
  | {
      tipo: 'resolvida';
      clinica_id: string;
      procedimento_id: string;
      /** Valor oficial validado. Nunca ajustado, nunca aproximado. */
      duracao_min: number;
    }
  | { tipo: 'nao_configurada' }
  | {
      tipo: 'invalida';
      motivo: MotivoDuracaoInvalida;
      /**
       * Valor exatamente como recebido, para auditoria tecnica -- somente
       * quando for numero FINITO (ex.: `0`, `15`, `30.5`, `250`).
       *
       * Correcao 0155: campo opcional e restrito a `number`. Quando o valor
       * configurado nao e numero finito (string, objeto, array, `null`,
       * `NaN`, `Infinity`), o campo e OMITIDO -- nunca convertido, nunca
       * serializado, nunca substituido por marcador. Isso impede que
       * conteudo arbitrario vindo da configuracao atravesse a fronteira do
       * resultado publico, e garante que `JSON.stringify` do resultado
       * jamais produza `null` derivado de `NaN`/`Infinity`.
       */
      valor_recebido?: number;
    }
  | {
      tipo: 'erro_configuracao';
      codigo: CodigoErroConfiguracaoDuracao;
      /**
       * `procedimento_id` envolvido. Array por consistencia com os demais
       * resolvedores; na pratica contem sempre exatamente um elemento,
       * porque o escopo desta consulta e um unico procedimento.
       */
      procedimento_ids: readonly string[];
      /**
       * Valores conflitantes encontrados, deduplicados e ordenados
       * numericamente. Sao numeros de configuracao da clinica -- nunca
       * nome de procedimento, catalogo completo ou dado do paciente.
       *
       * Correcao 0155: garantidamente somente numeros FINITOS. O conflito
       * so e avaliado depois que todos os valores correspondentes foram
       * confirmados como numeros finitos -- entao string, objeto, `null`,
       * `NaN` ou infinito nunca podem entrar aqui, e a serializacao JSON
       * preserva exatamente os mesmos valores.
       */
      duracoes_conflitantes: readonly number[];
    };
