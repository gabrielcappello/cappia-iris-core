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

  // REMOVIDA em 2026-09-01, no mesmo dia em que foi criada, por teste real
  // (WhatsApp, Cleardent): a guarda de "fluxo em andamento" -- primeiro so
  // `procedimento_id`, depois a lista de campos operacionais.
  //
  // O QUE ELA QUEBROU: o paciente agendou, informou nome/CPF/data no cadastro
  // e logo em seguida disse "passei o ano errado, minha data certa e
  // 02-08-1974". A IA entendeu perfeitamente (`data_nascimento:corrigiu`, dois
  // turnos seguidos) -- e a correcao NAO disparou, porque a conversa ainda
  // guardava `nome`/`cpf`/`data_nascimento` do cadastro recem-preenchido.
  // Resultado para o paciente: "Qual procedimento voce esta buscando?", duas
  // vezes, a uma pergunta que nada tinha a ver com procedimento.
  //
  // A DECISAO (Gabriel, 2026-09-01): "a troca deve funcionar sempre. nao tem
  // que ter um momento especifico para poder entender uma msg." Corrigir um
  // dado cadastral e sempre legitimo -- em qualquer ponto da conversa, com ou
  // sem agendamento em andamento. O paciente nao deve precisar terminar de
  // marcar horario para poder consertar o proprio ano de nascimento.
  //
  // Nao ha risco de "sequestrar" o agendamento: os campos operacionais
  // (procedimento, dentista, data, horario) continuam intactos em `dados`, e
  // o proximo turno retoma o fluxo exatamente de onde parou. A correcao grava
  // o dado e a conversa segue.
  //
  // A lista de campos operacionais que a sustentava foi removida junto.

  // COMPLETAR NAO E CORRIGIR (2026-09-01, achado por teste que quebrou).
  //
  // A Iris pede "nome, CPF e data de nascimento" durante a reserva e o
  // paciente responde "nasci em 10/05/1985". Isso e ele PREENCHENDO o que ela
  // pediu, nunca um pedido de troca -- e a reserva tem que continuar no mesmo
  // turno, como sempre fez.
  //
  // A distincao e ESTRUTURAL, nunca leitura do texto: se o campo ainda falta
  // na ficha, ele esta completando; se ja existe e o valor novo e diferente,
  // ele esta corrigindo. O laco abaixo ja exige "diferente do que esta na
  // ficha" -- o que faltava era nao tratar campo AUSENTE como correcao.
  const completandoCadastro = CAMPOS_CORRIGIVEIS_FORA_DO_AGENDAMENTO.some((campo) => {
    const alteracao = entrada.alteracoes[campo];
    if (alteracao === undefined || alteracao.acao === 'remover') return false;
    const naFicha = entrada.cadastroFicha[campo];
    return naFicha === undefined || naFicha.trim() === '';
  });
  if (completandoCadastro) return { tipo: 'nao_se_aplica' };

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
