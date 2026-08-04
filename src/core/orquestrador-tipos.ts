// Tipos do orquestrador minimo do primeiro fluxo (docs/06-roadmap.md,
// passos 1-3). Ver orquestrador.ts para o escopo exato e o que fica de fora
// por decisao explicita (moratoria P4, AGENTS.md "Simplicidade e prioridade
// de entrega").

import type { AliasProcedimento, ProcedimentoOficial, ResultadoResolucaoProcedimento } from './procedimento-tipos.ts';
import type { DentistaApto, DentistaOficial, ResultadoResolucaoDentista, VinculoDentistaProcedimento } from './dentista-tipos.ts';
import type { ConfiguracaoDuracao, ResultadoResolucaoDuracao } from './duracao-tipos.ts';
import type { Conflito } from './interpretacao-tipos.ts';
import type { InstanteAtual, ResultadoDisponibilidade } from './disponibilidade-tipos.ts';
import type { ResultadoResolucaoTemporal } from './temporal-tipos.ts';

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
  // O orquestrador nunca le relogio -- mesmo principio ja fixo em
  // resolverTemporal/resolverDisponibilidade (nenhum dos dois chama
  // Date.now()). Fornecido pelo chamador (futuro transporte/Edge Function).
  instante_atual: InstanteAtual;
}

/**
 * Uniao discriminada por `tipo`. `aguardando_data_horario` e
 * `horarios_disponiveis` sao os dois desfechos depois de procedimento/
 * dentista/duracao resolvidos -- via montar-fatos-temporais.ts (fatia
 * minima: hoje, amanha, data explicita DD/MM[/AAAA], manha, tarde, horario
 * explicito HH:MM/HHh[MM]) + resolverTemporal + carregarEntradaDisponibilidade
 * (nenhum dos dois alterado). Texto fora desse vocabulario fechado nao
 * produz atomo -- cai naturalmente em `aguardando_data_horario` com motivo
 * `incompleto`, o mesmo caminho que resolverTemporal ja usa pra "faltou
 * dado". Casos complexos (dia da semana, restricao "depois das Xh", datas
 * relativas alem de hoje/amanha) ficam de fora desta etapa, por decisao do
 * Gabriel -- nao inventados aqui.
 */
export type DecisaoOrquestrador =
  | { tipo: 'aguardando_procedimento'; resultado: ResultadoResolucaoProcedimento }
  | { tipo: 'erro_catalogo_procedimento'; resultado: ResultadoResolucaoProcedimento }
  | { tipo: 'aguardando_escolha_dentista'; dentistas: readonly DentistaApto[] }
  | { tipo: 'sem_dentista_disponivel' }
  | { tipo: 'erro_catalogo_dentista'; resultado: ResultadoResolucaoDentista }
  | { tipo: 'duracao_nao_configurada' }
  | { tipo: 'erro_configuracao_duracao'; resultado: ResultadoResolucaoDuracao }
  | { tipo: 'aguardando_data_horario'; resultado: ResultadoResolucaoTemporal }
  | {
      tipo: 'horarios_disponiveis';
      procedimento_id: string;
      dentista_id: string;
      duracao_min: number;
      resultado: ResultadoDisponibilidade;
    };

export interface ResultadoOrquestrador {
  clinica_id: string;
  conversa_id: string;
  conflitos: readonly Conflito[];
  decisao: DecisaoOrquestrador;
}
