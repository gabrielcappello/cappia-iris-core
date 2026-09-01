// Corrige um dado cadastral quando o paciente pede isso FORA de um fluxo de
// agendamento.
//
// ── O CASO REAL (WhatsApp, Cleardent, 2026-09-01) ───────────────────────
//   Paciente: "consigo modificar minha data de nascimento? eu nasci em 1974"
//   Iris:     "Claro. Posso corrigir para 1974. Qual e o dia e o mes?"
//   Paciente: "sim, so alterar o ano, dia e mes esta correto"
//   Iris:     "Qual procedimento ou atendimento voce esta buscando?"
//   Iris:     "A alteracao do ano para 1974 ficou registrada."
//
// A data no banco continuou `1973-08-02`. NADA foi alterado -- e a Iris
// afirmou ao paciente que tinha alterado.
//
// ── A CAUSA ────────────────────────────────────────────────────────────
// A IA entendeu (`campos=data_nascimento:corrigiu`, quatro turnos seguidos).
// O Core e que nao tinha o que fazer com isso:
//
//   - `decidirPorNatureza` devolve `null` para `natureza='correcao'`, entao a
//     conversa seguia o caminho normal e, sem procedimento, caia em
//     `aguardando_procedimento` -- dai a pergunta "qual procedimento?" a quem
//     so queria corrigir o ano;
//   - `persistirPaciente` tem UM unico ponto de chamada, dentro da reserva.
//     Sem agendamento em andamento, o dado corrigido nao tinha destino.
//
// ── O QUE ESTE MODULO DECIDE (specs/correcao-cadastro-conversacional-v1.md)
// So DECIDE; nao grava. Quem chama a RPC e o orquestrador -- aqui nao ha
// banco, rede nem efeito. Isso mantem a decisao testavel de forma pura e
// deixa a escrita no lugar onde ela ja acontece.
//
// ESCOPO FECHADO: `data_nascimento` e `email`. `nome` e `cpf` ficam de fora
// por decisao do Gabriel -- CPF colide com ficha alheia (`cpf_ja_cadastrado`,
// specs/cpf-outro-telefone-v1.md) e nome e identidade que ja produziu defeito
// real (2026-08-16, o sobrenome do dentista virou nome do paciente).
//
// DOIS GATILHOS, e o segundo nao e obvio: um valor cadastral INVALIDO nunca
// chega como alteracao. `descartarCadastroInvalido`
// (interpretar-e-aplicar.ts) roda ANTES de qualquer decisao e remove o campo
// de `alteracoes`, mandando o nome dele para `campos_cadastrais_invalidos`.
// Uma decisao que olhasse so as alteracoes aplicadas nunca veria uma data
// malformada -- e o paciente ouviria o mesmo silencio de sempre.

import type { AlteracoesDados } from './tipos.ts';
import type { CadastroPaciente } from './cadastro-paciente.ts';
import type { CampoCadastralInterpretacao } from './interpretacao-tipos.ts';

/**
 * Campos que esta v1 corrige fora do agendamento. Fechado de proposito:
 * `nome` e `cpf` NAO entram (ver cabecalho).
 */
export const CAMPOS_CORRIGIVEIS_FORA_DO_AGENDAMENTO: readonly CampoCadastralInterpretacao[] = [
  'data_nascimento',
  'email',
];

/**
 * Campos cuja presenca em `dados` significa "ha um fluxo de agendamento em
 * andamento" -- e portanto a correcao NAO intercepta a conversa.
 *
 * FURO REAL corrigido em 2026-09-01, antes do commit: a primeira versao olhava
 * SO `procedimento_id`. Mas o paciente pode ter escolhido dentista e data e
 * ainda nao ter dito o procedimento ("quero com a Dra. X amanha"); se ele
 * corrigisse o e-mail no turno seguinte, a correcao sequestrava o fluxo.
 *
 * A lista e mais ampla que o minimo necessario DE PROPOSITO: ela nao depende
 * de ter mapeado corretamente todos os caminhos que produzem cada estado. Um
 * campo operacional presente e sinal suficiente de que a conversa esta no meio
 * de outra coisa -- a correcao pode esperar o proximo turno, o agendamento
 * nao.
 *
 * `aguardando_resposta` (pergunta de cadastro pendente) NAO entra: uma
 * pergunta dessas so existe depois de `procedimento_id`, que ja esta na lista.
 * Proteger duas vezes o mesmo caminho seria a camada sem bloqueio comprovado
 * que `AGENTS.md` manda adiar.
 */
const CAMPOS_DE_FLUXO_EM_ANDAMENTO: readonly string[] = [
  'procedimento_id',
  'dentista_id',
  'data_texto',
  'periodo',
  'horario_texto',
  'agendamento_id',
];

export interface EntradaCorrecaoCadastro {
  /** `null` quando nao ha cadastro local para este telefone nesta clinica. */
  pacienteId: string | null;
  /** Alteracoes que sobreviveram a validacao e serao/foram aplicadas. */
  alteracoes: AlteracoesDados;
  /** Campos que o paciente informou NESTE turno e o Core rejeitou. */
  camposInvalidos: readonly CampoCadastralInterpretacao[] | undefined;
  /** Estado acumulado da conversa -- usado so para saber se ha fluxo aberto. */
  dados: Record<string, string | undefined>;
  /** Ficha oficial, para comparar valor igual (nao e correcao). */
  cadastroFicha: CadastroPaciente;
}

export type ResultadoCorrecaoCadastro =
  /** Nao e um turno de correcao fora do agendamento -- segue o fluxo de hoje. */
  | { tipo: 'nao_se_aplica' }
  /** Ha campos validos a gravar. O orquestrador persiste e informa. */
  | { tipo: 'corrigir'; campos: readonly CampoCadastralInterpretacao[] }
  /** O paciente tentou corrigir, mas o valor nao passou na validacao. */
  | { tipo: 'invalido'; campos: readonly CampoCadastralInterpretacao[] };

/**
 * Decide se este turno e uma correcao cadastral fora do agendamento.
 *
 * Nao se aplica quando:
 *   - o paciente nao esta identificado (sem ficha nao ha o que corrigir);
 *   - ha fluxo de agendamento em andamento -- qualquer campo de
 *     CAMPOS_DE_FLUXO_EM_ANDAMENTO presente na conversa; ali o caminho atual
 *     ja persiste o cadastro dentro da reserva;
 *   - o turno nao trouxe `data_nascimento`/`email`, nem como alteracao valida
 *     nem como campo invalido;
 *   - o valor informado e IGUAL ao que ja esta na ficha (nao e correcao:
 *     nenhuma escrita, nenhum anuncio).
 *
 * Campo invalido tem precedencia sobre campo valido no mesmo turno: se o
 * paciente mandou uma data malformada, ele precisa saber disso antes de
 * qualquer confirmacao de sucesso -- nunca "atualizei o e-mail" calado sobre
 * a data que nao entrou.
 */
export function decidirCorrecaoCadastro(entrada: EntradaCorrecaoCadastro): ResultadoCorrecaoCadastro {
  if (entrada.pacienteId === null) return { tipo: 'nao_se_aplica' };

  // FLUXO DE AGENDAMENTO EM ANDAMENTO -- nada muda.
  //
  // QUALQUER campo operacional presente basta (ver
  // CAMPOS_DE_FLUXO_EM_ANDAMENTO): o paciente pode ter escolhido dentista e
  // data sem ainda ter dito o procedimento, e uma correcao ali sequestraria o
  // agendamento em vez de esperar o proximo turno.
  const emAndamento = CAMPOS_DE_FLUXO_EM_ANDAMENTO.some((campo) => {
    const valor = entrada.dados[campo];
    return typeof valor === 'string' && valor.trim() !== '';
  });
  if (emAndamento) return { tipo: 'nao_se_aplica' };

  // GATILHO 2 (o nao obvio): o campo foi descartado antes de chegar aqui.
  const invalidos = (entrada.camposInvalidos ?? []).filter((campo) =>
    CAMPOS_CORRIGIVEIS_FORA_DO_AGENDAMENTO.includes(campo)
  );
  if (invalidos.length > 0) return { tipo: 'invalido', campos: invalidos };

  // GATILHO 1: alteracao valida, e com valor REALMENTE diferente da ficha.
  const corrigir: CampoCadastralInterpretacao[] = [];
  for (const campo of CAMPOS_CORRIGIVEIS_FORA_DO_AGENDAMENTO) {
    const alteracao = entrada.alteracoes[campo];
    if (alteracao === undefined) continue;
    // `remover` nao e correcao de valor: esta v1 nao apaga dado cadastral.
    if (alteracao.acao === 'remover') continue;
    const valor = alteracao.valor;
    if (typeof valor !== 'string' || valor.trim() === '') continue;
    if (entrada.cadastroFicha[campo] === valor) continue; // igual != correcao
    corrigir.push(campo);
  }

  if (corrigir.length === 0) return { tipo: 'nao_se_aplica' };
  return { tipo: 'corrigir', campos: corrigir };
}
