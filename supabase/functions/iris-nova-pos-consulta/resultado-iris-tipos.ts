// Contrato `ResultadoIris`
// (specs/contexto-conversacional-unificado-v2.md, aprovada por Gabriel em
// 2026-08-15 -- aprovação CONDICIONADA: autoriza somente implementação local,
// não autoriza commit, push, migration ou deploy; volta para revisão do Codex
// antes de qualquer integração ou teste em produção; spec §15).
//
// SOMENTE TIPOS. Nenhuma decisão de atendimento, persistência ou resposta ao
// paciente depende deste arquivo ainda -- não é importado por nenhum módulo de
// `src/core/` além deste. O contrato atual (`interpretacao-tipos.ts`) e o
// contrato v1 já em shadow (`contexto-unificado-tipos.ts`) seguem sendo os
// únicos que participam do fluxo real.

/**
 * SAÍDA -- união discriminada por `tipo`, com os TRÊS campos presentes nos
 * dois ramos (spec §2): `compreendida` exige `acao: Acao` (nunca nulo -- não
 * existe "ação ausente" dentro de `compreendida`, inclusive num turno
 * puramente cadastral, onde a ação é `{ tipo: 'conversar', ... }`);
 * `nao_compreendida` exige `acao: null` e `informacoes_fornecidas: readonly
 * []` -- uma saída não compreendida nunca declara fato extraído.
 *
 * O SCHEMA JSON (`RESULTADO_IRIS_SCHEMA`, `resultado-iris-validador.ts`)
 * continua um objeto único e plano na raiz -- Structured Outputs não aceita
 * `anyOf`/`oneOf` de nível superior -- e não muda com este tipo. A
 * correlação entre `tipo`, `acao` e `informacoes_fornecidas` que o schema
 * plano não expressa é responsabilidade de `validarResultadoIris`.
 */
export type ResultadoIris =
  | { tipo: 'compreendida'; acao: Acao; informacoes_fornecidas: readonly Informacao[] }
  | { tipo: 'nao_compreendida'; acao: null; informacoes_fornecidas: readonly [] };

/**
 * Onze ações (spec §2). `escolher_agendamento` foi proposta, medida e
 * removida -- não faz parte deste contrato (spec §3).
 */
export type Acao =
  | { tipo: 'conversar'; objetivo: 'cumprimentar' | 'responder_duvida' | 'conversa_geral' }
  | { tipo: 'desistir' }
  | {
      tipo: 'consultar_disponibilidade';
      procedimento_id: string | null;
      dentista_ids: readonly string[] | null;
      alternativas: readonly Alternativa[];
    }
  | { tipo: 'consultar_agendamento'; agendamento_id: string | null }
  | {
      tipo: 'pedir_agendamento';
      procedimento_id: string | null;
      dentista_ids: readonly string[] | null;
      alternativas: readonly Alternativa[];
    }
  /**
   * Único estado nulável é implícito: a ação só existe quando o paciente
   * mencionou um profissional. `[]` = mencionou e nenhum candidato real
   * corresponde; array não vazio = candidato(s) (spec §5). "Não mencionou"
   * nunca é um estado desta ação -- é a ausência dela.
   */
  | { tipo: 'escolher_dentista'; dentista_ids: readonly string[] }
  | { tipo: 'escolher_horario'; referencia: string; operacao: 'criar' | 'remarcar' }
  /**
   * Dividido em dois ramos (spec §2, invariante de `confirmar.agendamento_id`)
   * para que o TypeScript torne inconstruível a combinação inválida: `criar`
   * nunca carrega `agendamento_id` não nulo; `remarcar`/`cancelar` sempre
   * exigem um.
   */
  | { tipo: 'confirmar'; operacao: 'criar'; agendamento_id: null }
  | { tipo: 'confirmar'; operacao: 'remarcar' | 'cancelar'; agendamento_id: string }
  | { tipo: 'aceitar_oferta'; procedimento_id: string }
  | { tipo: 'cancelar'; agendamento_id: string | null }
  | { tipo: 'remarcar'; agendamento_id: string | null; alternativas: readonly Alternativa[] };

/** Fato do turno, nunca estado durável (spec §6) -- não persistir. */
export interface Alternativa {
  data: string | null;
  horario: string | null;
  periodo: 'manha' | 'tarde' | 'noite' | null;
}

export type CampoResultadoIris = 'nome' | 'cpf' | 'data_nascimento' | 'email';

/**
 * Exclusivamente cadastral (spec §2) -- `procedimento`, `data`, `periodo` e
 * `horario` vivem só em `Acao`/`Alternativa`. `informou`/`corrigiu` seguem a
 * mesma regra de forma já fechada em v1 (string vazia sempre inválida; só
 * `null` representa remoção; `informou` nunca aceita `null`).
 */
export interface Informacao {
  campo: CampoResultadoIris;
  operacao: 'informou' | 'corrigiu';
  valor: string | null;
}
