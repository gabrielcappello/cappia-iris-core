// Tipos do orquestrador minimo do primeiro fluxo (docs/06-roadmap.md,
// passos 1-3). Ver orquestrador.ts para o escopo exato e o que fica de fora
// por decisao explicita (moratoria P4, AGENTS.md "Simplicidade e prioridade
// de entrega").

import type { ProcedimentoOficial } from './procedimento-tipos.ts';
import type { DentistaApto, DentistaOficial, ResultadoResolucaoDentista, VinculoDentistaProcedimento } from './dentista-tipos.ts';
import type { ConfiguracaoDuracao, ResultadoResolucaoDuracao } from './duracao-tipos.ts';
import type { Conflito, NaturezaMensagem } from './interpretacao-tipos.ts';
import type { InstanteAtual, OpcaoHorario, ResultadoDisponibilidade } from './disponibilidade-tipos.ts';
import type { ResultadoResolucaoTemporal } from './temporal-tipos.ts';
import type { MotivoErroReserva } from './reservar-agendamento.ts';
import type { HistoricoConversa } from './tipos.ts';

/**
 * Catalogo de UMA clinica. Montado internamente pelo orquestrador, via
 * carregar-catalogo.ts, a partir de clinicas.dentistas + procedimentos_
 * catalogo (schema real) -- nunca mais recebido pronto de fora. Continua
 * sendo so o formato de entrada que os resolvedores de procedimento/
 * dentista/duracao ja exigiam (nenhum dos tres foi alterado).
 */
export interface CatalogoClinica {
  procedimentos: readonly ProcedimentoOficial[];
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
  // Os quatro tipos abaixo (saudacao, duvida_livre, mensagem_nao_compreendida,
  // desistencia) vem da classificacao natureza_mensagem da IA
  // (specs/interpretacao-natureza-mensagem-v1.md), nunca de deteccao por
  // texto bruto -- so disparam quando `alteracoes` desta mensagem esta
  // vazio (a mesma spec: alteracoes sempre tem precedencia sobre
  // natureza_mensagem para a evolucao do fluxo).
  //
  // Mensagem e uma saudacao pura e ainda nao ha procedimento conhecido
  // nesta conversa.
  | { tipo: 'saudacao' }
  // Duvida ou comentario fora do vocabulario de agendamento (situacao
  // "Conversa basica", atendimento-v1.md secao 5).
  | { tipo: 'duvida_livre' }
  // Nao foi possivel classificar a mensagem com seguranca.
  | { tipo: 'mensagem_nao_compreendida' }
  // Recusa ou desistencia explicita, sem outro conteudo acionavel
  // (situacao "Desistencia", atendimento-v1.md secao 5). Nunca cancela
  // agendamento existente.
  | { tipo: 'desistencia' }
  // Sem payload desde 2026-08-08 (specs/procedimento-semantico-v1.md): a IA
  // devolve `procedimento_id` e o Core so confere integridade. ID ausente,
  // inexistente, de outra clinica ou inativo caem todos aqui -- os motivos
  // internos ja eram equivalentes perante o paciente, entao nao ha nuance a
  // transportar. `erro_catalogo_procedimento` foi REMOVIDO junto: sem
  // aliases, nao existe alias ambiguo/orfao/de outra clinica a reportar.
  | { tipo: 'aguardando_procedimento' }
  | { tipo: 'aguardando_escolha_dentista'; dentistas: readonly DentistaApto[] }
  | { tipo: 'sem_dentista_disponivel' }
  | { tipo: 'erro_catalogo_dentista'; resultado: ResultadoResolucaoDentista }
  | { tipo: 'duracao_nao_configurada' }
  | { tipo: 'erro_configuracao_duracao'; resultado: ResultadoResolucaoDuracao }
  // 'resolvido' e excluido do tipo aqui de proposito (2026-08-05): quando
  // resultadoTemporal.tipo === 'resolvido', o orquestrador nunca monta esta
  // decisao (segue para disponibilidade) -- entao 'resolvido' chegando aqui
  // seria inconsistencia interna impossivel, nunca uma situacao real do
  // paciente. O contrato de tipo reflete isso: nenhum gerador de resposta
  // pode inventar um fallback pra um caso que nao deveria poder existir.
  | { tipo: 'aguardando_data_horario'; resultado: Exclude<ResultadoResolucaoTemporal, { tipo: 'resolvido' }> }
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
  /**
   * `atualizado_em` da linha APOS a gravacao do snapshot de horarios desta
   * mensagem -- o valor que `gravarContextoHorarios` devolveu (ver seu
   * comentario para o contrato de 3 casos). Exposto (aditivo,
   * specs/memoria-conversacional-minima-v1.md) para que a gravacao do
   * historico, que so acontece depois que a resposta final existe (fora do
   * orquestrador), encadeie seu CAS sobre este valor exato, sem reler.
   */
  atualizado_em: string;
  /**
   * Classificacao da mensagem atual (interpretacao-tipos.ts). Exposta
   * (aditiva) para a IA redatora -- specs/memoria-conversacional-minima-v1.md
   * secao 3.
   */
  natureza_mensagem: NaturezaMensagem;
  /**
   * Historico conversacional (ate 10 pares), lido no INICIO deste turno
   * (antes de qualquer escrita) -- `null` quando nao ha nenhum turno
   * anterior. SEM filtro de validade aqui: e sobre este valor cru que a
   * gravacao anexa o par novo (specs/historico-conversacional-v1.md secao
   * 3). O filtro de idade (24h) e aplicado no ponto de leitura para os dois
   * modelos (orquestrador.ts, para a interpretadora; gerar-resposta-
   * conversacional.ts, para a redatora), nunca aqui.
   */
  historico_conversa: HistoricoConversa | null;
}
