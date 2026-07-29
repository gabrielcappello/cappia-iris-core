// Tipos do modulo de identificacao. Sem dependencia de nenhuma biblioteca externa.

export interface IdentificarConversaInput {
  provider: string;
  instancia_whatsapp: string;
  telefone_normalizado: string;
}

// Os seis estados aprovados em specs/novo-agendamento.md (secao 19) e
// verificados pelo check estado_conversa_estado_valido em
// 20260729_iris_nova_identificacao_v1.sql.
export type EstadoConversa =
  | 'atendimento'
  | 'aguardando_escolha'
  | 'coletando_cadastro'
  | 'aguardando_confirmacao'
  | 'executando'
  | 'concluido';

export interface ResultadoIdentificacao {
  clinica_id: string;
  paciente: {
    encontrado: boolean;
    id: string | null;
  };
  conversa: {
    id: string;
    estado: EstadoConversa;
    dados: Record<string, unknown>;
  };
}

// Interface estrutural minima do cliente de banco usada por este modulo.
// Qualquer implementacao que exponha esses metodos e compativel — tanto o
// SupabaseClient real (@supabase/supabase-js) quanto um dublê de teste.
export interface ConsultaEncadeavel<T = Record<string, unknown>> {
  eq(coluna: string, valor: unknown): ConsultaEncadeavel<T>;
  is(coluna: string, valor: null): ConsultaEncadeavel<T>;
  select(colunas: string): ConsultaEncadeavel<T>;
  maybeSingle(): Promise<{ data: T | null; error: { message: string } | null }>;
}

export interface ClienteBancoDados {
  from(tabela: string): {
    select(colunas: string): ConsultaEncadeavel;
    upsert(
      valores: Record<string, unknown>,
      opcoes: { onConflict: string; ignoreDuplicates: boolean }
    ): ConsultaEncadeavel;
    update(valores: Record<string, unknown>): ConsultaEncadeavel;
  };
}
