// Adaptador `informacoes_fornecidas → AlteracoesDados`
// (specs/contexto-conversacional-unificado-v2.md §13, item 1, aprovada por
// Gabriel em 2026-08-15 -- aprovação CONDICIONADA, spec §15; etapas de
// tipos/schema/validação e fatos de turno já aprovadas pelo Codex).
//
// SEM LIGAÇÃO COM PRODUÇÃO. Nenhuma função deste arquivo é chamada por
// `aplicarDados`, pelo orquestrador ou por qualquer decisão de atendimento
// -- não é importado por nenhum módulo de `src/core/` além dos seus
// próprios testes.
//
// PURO: sem I/O, sem relógio, sem rede. Todo o resultado é derivado da
// entrada recebida.
//
// POR QUE ESTE ADAPTADOR EXISTE (spec §13.1): `AlteracoesDados`
// (`tipos.ts`) é o contrato de entrada já aprovado e em produção de
// `aplicarDados` -- um `Record<campo, { acao, valor? }>`. `ResultadoIris`
// produz `informacoes_fornecidas: Informacao[]` -- uma LISTA de
// `{ campo, operacao, valor }`, forma diferente por desenho (spec §2). Este
// módulo só troca a forma; nenhuma regra nova de negócio é criada aqui.
//
// TRADUÇÃO DE OPERAÇÃO (spec §2, já fechada em v1 §4 para o mesmo par
// informou/corrigiu):
// - `informou` (valor sempre não vazio) → `{ acao: 'informar', valor }`;
// - `corrigiu` com valor não vazio → `{ acao: 'corrigir', valor }`;
// - `corrigiu` com `valor: null` → `{ acao: 'remover' }`, sem `valor` --
//   `AlteracoesDados` já usa `remover` para essa mesma semântica
//   (`tipos.ts`); `ResultadoIris` não tem uma terceira operação para isso
//   por decisão de v1 (`corrigiu + null` já significa remoção, sem
//   introduzir um `removeu` que a medição de v1 mostrou redundante).
//
// O QUE ESTE ADAPTADOR NÃO FAZ, DE PROPÓSITO:
// - não valida forma de `Informacao` -- isso é `resultado-iris-validador.ts`
//   (`validarInformacao`/`validarResultadoIris`); este módulo assume uma
//   lista já validada como entrada;
// - não decide qual campo é "permitido nesta etapa" (`CAMPOS_PERMITIDOS` de
//   `aplicar-dados.ts`) -- essa é uma responsabilidade de `aplicarDados`,
//   não deste adaptador; `CampoResultadoIris` já é um subconjunto de
//   `CampoDadosConversa` (`nome | cpf | data_nascimento | email`), então
//   todo campo que este módulo produz é aceito por aquela validação sem
//   ajuste;
// - não normaliza nem completa entrada malformada -- campo duplicado na
//   mesma lista (duas entradas para o mesmo `campo`) é recusado inteiro,
//   nunca resolvido por "última vence" ou "primeira vence" (mesmo princípio
//   de `guarda-contexto-unificado.ts` e de `resultado-iris-validador.ts`);
// - não aplica a guarda estrutural de contaminação de nome (v1 §5.1,
//   `aplicarGuardaEscolhaProfissional` em `guarda-contexto-unificado.ts`) --
//   PENDÊNCIA REGISTRADA PARA A INTEGRAÇÃO FUTURA (Codex, 2026-08-15): a
//   guarda precisa rodar ANTES deste adaptador, para que um `nome`
//   co-ocorrendo com `escolher_dentista` seja interceptado e nunca chegue a
//   virar `AlteracoesDados`. Não é bloqueio deste módulo -- este adaptador
//   só traduz forma e não tem acesso a `Acao`, então não pode aplicar a
//   guarda sozinho.

import type { Informacao } from './resultado-iris-tipos.ts';
import type { AlteracoesDados } from './tipos.ts';

export type ResultadoAdaptarAlteracoes = { ok: true; alteracoes: AlteracoesDados } | { ok: false; erro: string };

/**
 * Traduz `informacoes_fornecidas` (contrato `ResultadoIris`) para
 * `AlteracoesDados` (contrato de `aplicarDados`, já em produção).
 *
 * Recusa (`{ ok: false }`) quando o mesmo `campo` aparece mais de uma vez na
 * lista -- ambíguo sobre qual das duas alterações vale, e nenhuma das duas é
 * escolhida por conta própria. Lista vazia produz `AlteracoesDados` vazio.
 */
export function adaptarInformacoesParaAlteracoes(
  informacoesFornecidas: readonly Informacao[]
): ResultadoAdaptarAlteracoes {
  const alteracoes: AlteracoesDados = {};

  for (const item of informacoesFornecidas) {
    if (item.campo in alteracoes) {
      return { ok: false, erro: `campo duplicado em informacoes_fornecidas: ${item.campo}` };
    }

    if (item.operacao === 'informou') {
      // Garantido por `validarInformacao` (não revalidado aqui): valor não vazio, nunca null.
      alteracoes[item.campo] = { acao: 'informar', valor: item.valor as string };
      continue;
    }

    // operacao === 'corrigiu'
    alteracoes[item.campo] = item.valor === null ? { acao: 'remover' } : { acao: 'corrigir', valor: item.valor };
  }

  return { ok: true, alteracoes };
}
