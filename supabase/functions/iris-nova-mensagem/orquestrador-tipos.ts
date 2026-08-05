// Tipos do orquestrador minimo do primeiro fluxo (docs/06-roadmap.md,
// passos 1-3). Ver orquestrador.ts para o escopo exato e o que fica de fora
// por decisao explicita (moratoria P4, AGENTS.md "Simplicidade e prioridade
// de entrega").

import type { AliasProcedimento, ProcedimentoOficial, ResultadoResolucaoProcedimento } from './procedimento-tipos.ts';
import type { DentistaApto, DentistaOficial, ResultadoResolucaoDentista, VinculoDentistaProcedimento } from './dentista-tipos.ts';
import type { ConfiguracaoDuracao, ResultadoResolucaoDuracao } from './duracao-tipos.ts';
import type { Conflito } from './interpretacao-tipos.ts';
import type { InstanteAtual, OpcaoHorario, ResultadoDisponibilidade } from './disponibilidade-tipos.ts';
import type { ResultadoResolucaoTemporal } from './temporal-tipos.ts';
import type { MotivoErroReserva } from './reservar-agendamento.ts';

/**
 * Catalogo de UMA clinica. Montado internamente pelo orquestrador, via
 * carregar-catalogo.ts, a partir de clinicas.dentistas + procedimentos_
 * catalogo (schema real) -- nunca mais recebido pronto de fora. Continua
 * sendo so o formato de entrada que os resolvedores de procedimento/
 * dentista/duracao ja exigiam (nenhum dos tres foi alterado).
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
  // Nao deveria ocorrer na pratica (identificarConversa ja confirmou a
  // clinica antes do orquestrador chegar aqui) -- tratado explicitamente,
  // nunca uma excecao nao tratada nem um catalogo vazio inventado.
  | { tipo: 'clinica_sem_catalogo' }
  // Mensagem e uma saudacao pura (oi/ola/bom dia/boa tarde/boa noite, sem
  // mais nenhum conteudo) e ainda nao ha procedimento conhecido nesta
  // conversa -- detectado por texto bruto (detectar-saudacao.ts), nunca
  // pela IA (comportamento conversacional-v1, Gabriel 2026-08-05).
  | { tipo: 'saudacao' }
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
    }
  // O paciente escolheu um horario exato e ele esta livre (resolverDisponibilidade
  // ja devolveu horario_exato_disponivel), mas ainda nao disse "sim" -- nunca
  // reserva sem essa confirmacao explicita (campo `confirmacao`, dados.ts).
  | { tipo: 'aguardando_confirmacao'; procedimento_id: string; dentista_id: string; opcao: OpcaoHorario }
  // Confirmado, horario livre, mas o telefone nao corresponde a nenhum
  // paciente cadastrado -- cappia_reservar_agendamento exige paciente_id;
  // cadastro de paciente novo fica fora desta etapa, por decisao do Gabriel.
  | { tipo: 'cadastro_necessario' }
  | {
      tipo: 'reserva_criada';
      agendamento_id: string;
      dentista_id: string;
      procedimento_id: string;
      duracao_min: number;
      data: string;
      horario: string;
    }
  // O horario estava livre na leitura, mas cappia_reservar_agendamento (trava
  // real, ja testada em producao) recusou por sobreposição -- nunca insiste
  // sozinho, devolve conflito para o chamador pedir uma nova escolha.
  | { tipo: 'reserva_conflito' }
  | { tipo: 'reserva_falhou'; motivo: MotivoErroReserva };

export interface ResultadoOrquestrador {
  clinica_id: string;
  conversa_id: string;
  conflitos: readonly Conflito[];
  decisao: DecisaoOrquestrador;
}
