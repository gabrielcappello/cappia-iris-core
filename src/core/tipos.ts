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

// Formato que um PostgrestFilterBuilder do supabase-js resolve quando
// aguardado diretamente (sem .single()/.maybeSingle()): sempre uma lista,
// nunca uma linha unica.
type ResultadoListagem<T> = { data: T[] | null; error: { message: string } | null };

// Interface estrutural minima do cliente de banco usada por este modulo.
// Qualquer implementacao que exponha esses metodos e compativel — tanto o
// SupabaseClient real (@supabase/supabase-js) quanto um dublê de teste.
//
// Estende PromiseLike (nunca um metodo nomeado tipo `.listar()`): o
// PostgrestFilterBuilder real ja e aguardavel diretamente e resolve para
// { data: T[], error } por padrao -- ele nao tem nenhum metodo com esse
// nome. Consultas que esperam zero ou mais linhas (ex.: bloqueios/
// agendamentos de um dia) terminam a cadeia com `await` puro, nunca com
// `.maybeSingle()` nem com um metodo inventado que so o dublê de teste
// implementaria.
export interface ConsultaEncadeavel<T = Record<string, unknown>> extends PromiseLike<ResultadoListagem<T>> {
  eq(coluna: string, valor: unknown): ConsultaEncadeavel<T>;
  is(coluna: string, valor: null): ConsultaEncadeavel<T>;
  // Espelha PostgrestFilterBuilder.not() do supabase-js. Usado hoje somente
  // para expressar "IS NOT NULL" (ex.: not('interpretacao_persistida_em',
  // 'is', null)), necessario para a conclusao condicional -- nunca faz um
  // SELECT de autorizacao seguido de UPDATE separado.
  not(coluna: string, operador: string, valor: unknown): ConsultaEncadeavel<T>;
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

// Campos de dados interpretados aceitos nesta etapa (aproveitamento
// estruturado). Qualquer chave fora desta lista e rejeitada.
export type CampoDadosConversa =
  | 'intencao'
  | 'procedimento_texto'
  | 'dentista_texto'
  | 'data_texto'
  | 'periodo'
  | 'horario_texto'
  | 'nome'
  | 'cpf'
  | 'data_nascimento'
  | 'email';

export type AcaoAlteracaoDados = 'informar' | 'corrigir' | 'remover';

// `acao` e `valor` sao tipados como string livre (nao a uniao estrita) de
// proposito: a entrada e produzida externamente (futuramente pela IA) e
// precisa ser validada em tempo de execucao, nao apenas confiada ao tipo.
export interface AlteracaoDeCampo {
  acao: string;
  valor?: string;
}

export type AlteracoesDados = Record<string, AlteracaoDeCampo>;

// Os tres identificadores que localizam uma linha de estado_conversa.
// Extraido para ser reutilizado pela validacao canonica (validarContexto)
// tanto por aplicarDados quanto por interpretarEAplicar, sem duplicar
// regex de UUID nem regra de telefone.
export interface ContextoConversa {
  conversa_id: string;
  clinica_id: string;
  telefone_normalizado: string;
}

export interface AplicarDadosInput extends ContextoConversa {
  alteracoes: AlteracoesDados;
}

export interface ResultadoAplicarDados {
  conversa_id: string;
  dados: Record<string, unknown>;
  campos_adicionados: string[];
  campos_corrigidos: string[];
  campos_removidos: string[];
  campos_preservados: string[];
}
