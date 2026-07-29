// Tipos do modulo de identificacao. Sem dependencia de nenhuma biblioteca externa.

export interface IdentificarConversaInput {
  provider: string;
  instancia_whatsapp: string;
  telefone_normalizado: string;
}

export type EstadoConversa = 'atendimento';

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
  };
}
