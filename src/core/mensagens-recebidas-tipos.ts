// Tipos compartilhados para as operacoes de mensagens_recebidas aprovadas em
// specs/interpretacao-ia.md ("Contrato tecnico de banco — Etapa 6"):
// reivindicacao, persistencia atomica da interpretacao, e finalizacao
// condicional (conclusao/falha). Nenhuma RPC ou migration foi aplicada em
// nenhum banco por este modulo — ele so descreve os contratos de entrada e
// saida usados pelos adaptadores em reivindicar-mensagem.ts,
// aplicar-interpretacao-condicional.ts e finalizar-mensagem.ts.
import type { AlteracoesDados } from './tipos.ts';

// Estrutural minima do cliente RPC do Supabase. Nao reaproveita
// ClienteBancoDados porque .rpc() nao pertence a interface .from(tabela) —
// e uma chamada de funcao, nao uma operacao de tabela.
export interface ClienteRpc {
  rpc(nome: string, parametros: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

// -----------------------------------------------------------------------
// reivindicar_mensagem
// -----------------------------------------------------------------------

export interface ReivindicarMensagemEntrada {
  provider: string;
  instancia_whatsapp: string;
  message_id: string;
  clinica_id: string;
  telefone_normalizado: string;
}

export type ResultadoReivindicacao = 'reivindicada_interpretar' | 'reivindicada_resposta_fixa' | 'nao_elegivel';

export interface ReivindicarMensagemSaida {
  resultado: ResultadoReivindicacao;
  mensagem_recebida_id: string | null;
  claim_token: string | null;
  lease_expira_em: string | null;
  interpretacao_persistida_em: string | null;
}

// -----------------------------------------------------------------------
// aplicar_interpretacao_condicional
// -----------------------------------------------------------------------

export interface AplicarInterpretacaoCondicionalEntrada {
  mensagem_recebida_id: string;
  clinica_id: string;
  telefone_normalizado: string;
  claim_token: string;
  conversa_id: string;
  snapshot_atualizado_em: string;
  alteracoes_aplicaveis: AlteracoesDados;
}

export type ResultadoPersistenciaCondicional = 'persistida' | 'autorizacao_invalida' | 'conflito_concorrente';

export interface AplicarInterpretacaoCondicionalSaida {
  resultado: ResultadoPersistenciaCondicional;
  conversa_id: string | null;
  dados: Record<string, unknown> | null;
  atualizado_em: string | null;
}

// -----------------------------------------------------------------------
// Finalizacao condicional (concluirMensagemCondicional / falharMensagemCondicional)
// -----------------------------------------------------------------------

// Identifica o worker/claim para as duas operacoes de finalizacao —
// reutilizado por ambas (mesmo formato de condicao no UPDATE).
export interface ClaimMensagem {
  mensagem_recebida_id: string;
  clinica_id: string;
  claim_token: string;
}

export type ResultadoConclusao = 'concluida' | 'autorizacao_invalida';
export type ResultadoFalha = 'falhou' | 'autorizacao_invalida';
