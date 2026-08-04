// Tipos do orquestrador minimo do primeiro fluxo (docs/06-roadmap.md,
// passos 1-3). Ver orquestrador.ts para o escopo exato e o que fica de fora
// por decisao explicita (moratoria P4, AGENTS.md "Simplicidade e prioridade
// de entrega").

import type { AliasProcedimento, ProcedimentoOficial, ResultadoResolucaoProcedimento } from './procedimento-tipos.ts';
import type { DentistaApto, DentistaOficial, ResultadoResolucaoDentista, VinculoDentistaProcedimento } from './dentista-tipos.ts';
import type { ConfiguracaoDuracao, ResultadoResolucaoDuracao } from './duracao-tipos.ts';
import type { Conflito } from './interpretacao-tipos.ts';

/**
 * Catalogo de UMA clinica, ja carregado pelo chamador. Este modulo nunca
 * consulta banco para obter catalogo -- recebe pronto, mesmo padrao dos
 * cinco resolvedores que compoe (cada um documenta o mesmo principio no
 * proprio cabecalho). Carregar isto a partir do schema real e trabalho
 * separado, ainda pendente de auditoria do legado.
 */
export interface CatalogoClinica {
  procedimentos: readonly ProcedimentoOficial[];
  aliasesProcedimento: readonly AliasProcedimento[];
  dentistas: readonly DentistaOficial[];
  vinculos: readonly VinculoDentistaProcedimento[];
  configuracoesDuracao: readonly ConfiguracaoDuracao[];
}

export interface EntradaOrquestrador {
  provider: string;
  instancia_whatsapp: string;
  telefone_normalizado: string;
  mensagens_atuais: string[];
  catalogo: CatalogoClinica;
}

/**
 * Uniao discriminada por `tipo`. `pronto_para_horario` e o ponto exato onde
 * este orquestrador para hoje: a conversao de `data_texto`/`horario_texto`/
 * `periodo` (texto livre ja aceito por aplicar-dados.ts) para os atomos
 * temporais estruturados que resolverTemporal exige (temporal-tipos.ts)
 * ainda nao existe em nenhum modulo do repositorio -- e uma decisao
 * arquitetural em aberto (o modelo passa a emitir atomos diretamente, ou um
 * parser deterministico separado interpreta os tres campos), nao inventada
 * aqui.
 */
export type DecisaoOrquestrador =
  | { tipo: 'aguardando_procedimento'; resultado: ResultadoResolucaoProcedimento }
  | { tipo: 'aguardando_escolha_dentista'; dentistas: readonly DentistaApto[] }
  | { tipo: 'sem_dentista_disponivel' }
  | { tipo: 'erro_catalogo_dentista'; resultado: ResultadoResolucaoDentista }
  | { tipo: 'duracao_nao_configurada' }
  | { tipo: 'erro_configuracao_duracao'; resultado: ResultadoResolucaoDuracao }
  | { tipo: 'pronto_para_horario'; procedimento_id: string; dentista_id: string; duracao_min: number };

export interface ResultadoOrquestrador {
  clinica_id: string;
  conversa_id: string;
  conflitos: readonly Conflito[];
  decisao: DecisaoOrquestrador;
}
