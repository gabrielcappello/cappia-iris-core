// Declara `aguardando_resposta` -- a anotacao "eu perguntei X", gravada no
// fim do turno e lida no turno seguinte (spec
// contexto-conversacional-unificado-v2.md secoes 14.5 e 14.6).
//
// ── O PROBLEMA QUE ISTO RESOLVE ─────────────────────────────────────────
// Hoje a Iris nao tem registro do que ela mesma perguntou. Quando o paciente
// responde "o primeiro", "esse mesmo" ou "pode ser", o unico jeito de saber a
// que ele se refere e deduzir do texto da conversa. Funciona na maior parte
// das vezes -- e falha justamente nas respostas mais curtas, que sao as mais
// comuns.
//
// Esta funcao produz a anotacao explicita. No turno seguinte a IA recebe "voce
// perguntou X" como FATO, em vez de inferir.
//
// ── POR QUE DERIVAR DA DECISAO, E NAO PEDIR A REDATORA ──────────────────
// A spec (secao 14.5) desenhou isto com a redatora DECLARANDO a pergunta
// junto do texto, o que exigiria Structured Outputs na redatora e uma emenda
// a `resposta-conversacional-v1.md` secao 3 ("um unico texto, sem JSON").
//
// Aqui a pergunta e derivada da DECISAO JA TOMADA pelo Core. Tres razoes:
//
// 1. **Quem sabe o fato e o Core.** Foi o orquestrador que decidiu apresentar
//    horarios; a redatora recebe essa decisao e a escreve em portugues.
//    Perguntar a ela "o que voce perguntou?" e pedir que observe algo que ja
//    lhe foi informado.
// 2. **Elimina uma classe inteira de divergencia.** A propria spec reconhece
//    (secao 14.5) que a redatora pode declarar `escolha_horario` e escrever
//    frase que pergunta outra coisa, e que isso "nao e eliminado por este
//    desenho". Derivando da decisao, a divergencia nao existe: a anotacao E a
//    decisao.
// 3. **Nao mexe no contrato da redatora** -- nenhum campo novo, nenhuma
//    emenda, nenhum risco sobre a peca mais sensivel da conversa.
//
// ── E O ACOPLAMENTO QUE A V2 QUERIA REMOVER? ────────────────────────────
// A spec critica `derivarAcaoContextoHorarios` por fazer `switch
// (decisao.tipo)`. Aquela critica e sobre `contexto_horarios`, que mistura
// snapshot de horarios com marcador de pergunta e por isso precisa de um
// `case` por variacao de fluxo.
//
// Aqui o vocabulario de `PerguntaPendente.tipo` e FECHADO e pequeno, e o
// mapeamento e uma tabela direta decisao -> pergunta: nao interpreta
// linguagem, nao inventa estado intermediario, nao cresce com o fluxo. Se um
// dia a redatora precisar declarar algo que o Core nao sabe, esta funcao e
// substituivel sem que nada mais mude -- o formato gravado e o mesmo.
//
// ── O QUE ESTA FUNCAO NUNCA FAZ ─────────────────────────────────────────
// Nao le texto do paciente, nao le o texto da redatora, nao chama IA, nao
// acessa banco, nao le relogio. Funcao pura: decisao entra, anotacao sai.

import { formatarMinutos } from './gerar-resposta-paciente.ts';
import type { PerguntaPendente } from './contexto-unificado-tipos.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';

/**
 * Deriva a anotacao do turno a partir da decisao ja tomada pelo Core.
 *
 * `null` significa "este turno nao deixou pergunta em aberto" -- afirmacao
 * factual, nunca "nao sei". Toda decisao fora dos casos abaixo encerra o
 * fluxo ou nao apresenta escolha resolvivel no turno seguinte.
 */
export function declararPerguntaPendente(decisao: DecisaoOrquestrador): PerguntaPendente | null {
  switch (decisao.tipo) {
    // ── Escolha de horario ─────────────────────────────────────────────
    // So vira pergunta quando ha opcoes REAIS apresentadas. `opcoes` guarda
    // os horarios no mesmo formato em que o paciente os viu, que e o que
    // permite resolver "o primeiro"/"o das 10" no turno seguinte.
    case 'horarios_disponiveis': {
      const opcoes = horariosApresentados(decisao.resultado);
      return opcoes === null ? null : { tipo: 'escolha_horario', opcoes };
    }

    // ── Confirmacoes -- as tres operacoes, cada uma com sua identidade ──
    // `operacao` e o que impede um "sim" destinado a uma operacao autorizar
    // outra (spec secao 14.3). `agendamento_id` acompanha as que incidem
    // sobre agendamento existente; `criar` nunca o carrega.
    case 'aguardando_confirmacao':
      return { tipo: 'confirmacao', operacao: 'criar' };

    case 'aguardando_confirmacao_cancelamento':
      return {
        tipo: 'confirmacao',
        operacao: 'cancelar',
        agendamento_id: decisao.agendamento.agendamento_id,
      };

    case 'aguardando_confirmacao_remarcacao':
      return {
        tipo: 'confirmacao',
        operacao: 'remarcar',
        agendamento_id: decisao.agendamento_atual.agendamento_id,
      };

    // ── Escolha entre agendamentos existentes ──────────────────────────
    // `operacao` diz PARA QUE a escolha serve, e o vocabulario aqui e outro:
    // `consultar` e legitimo (nao produz efeito) e `criar` nao cabe -- nao se
    // escolhe entre agendamentos existentes para criar um novo.
    case 'aguardando_escolha_agendamento':
      return {
        tipo: 'escolha_agendamento',
        operacao: 'remarcar',
        ...opcoesDeAgendamentos(decisao.agendamentos),
      };

    case 'aguardando_escolha_agendamento_cancelamento':
      return {
        tipo: 'escolha_agendamento',
        operacao: 'cancelar',
        ...opcoesDeAgendamentos(decisao.agendamentos),
      };

    // ── Demais perguntas em aberto ─────────────────────────────────────
    case 'aguardando_escolha_dentista':
      return {
        tipo: 'escolha_dentista',
        ...opcoesDeNomes(decisao.dentistas.map((d) => d.nome_exibido)),
      };

    case 'troca_telefone_pendente':
      return { tipo: 'troca_telefone' };

    case 'cadastro_necessario':
      return { tipo: 'cadastro' };

    // ── Desfechos que NAO deixam pergunta ──────────────────────────────
    // Reserva/cancelamento/remarcacao concluidos, desistencia, saudacao,
    // erros de configuracao e as pendencias que nao apresentam opcao
    // resolvivel (`aguardando_procedimento`, `aguardando_data_horario`):
    // nenhum deles deixa uma escolha estruturada que o turno seguinte
    // precise resolver. `null` aqui e afirmacao, nao ausencia.
    default:
      return null;
  }
}

/**
 * Os horarios efetivamente apresentados, no mesmo formato do texto.
 *
 * `null` quando a decisao nao carrega opcao utilizavel -- e nesse caso
 * NENHUMA anotacao e gravada, em vez de gravar uma escolha vazia que o turno
 * seguinte nao conseguiria resolver.
 *
 * Cobre so os dois ramos que apresentam horario ao paciente. Os demais
 * (`sem_disponibilidade`, `sem_expediente_no_dia`, `configuracao_invalida`)
 * nao oferecem escolha.
 */
function horariosApresentados(
  resultado: DecisaoHorariosDisponiveis['resultado']
): readonly string[] | null {
  if (resultado.tipo === 'opcoes') {
    const lista = resultado.opcoes.map((o) => formatarMinutos(o.inicio_min));
    return lista.length > 0 ? lista : null;
  }

  if (resultado.tipo === 'horario_exato_indisponivel') {
    // Vizinhos oferecidos quando o horario pedido nao cabe. Qualquer um dos
    // dois pode faltar (spec de disponibilidade secao 9).
    const lista = [resultado.anterior, resultado.posterior]
      .filter((o): o is NonNullable<typeof o> => o !== undefined)
      .map((o) => formatarMinutos(o.inicio_min));
    return lista.length > 0 ? lista : null;
  }

  // `horario_exato_disponivel` nao e escolha: e proposta, e vira
  // `aguardando_confirmacao` no turno seguinte.
  return null;
}

/** Rotulo estavel de agendamento: "DD/MM HH:MM", igual ao que o paciente ve. */
function opcoesDeAgendamentos(
  agendamentos: readonly { data: string; horario: string }[]
): { opcoes?: readonly string[] } {
  const lista = agendamentos.map((a) => `${formatarDataCurta(a.data)} ${a.horario}`);
  return lista.length > 0 ? { opcoes: lista } : {};
}

function opcoesDeNomes(nomes: readonly string[]): { opcoes?: readonly string[] } {
  const lista = nomes.filter((n) => typeof n === 'string' && n.trim() !== '');
  return lista.length > 0 ? { opcoes: lista } : {};
}

/** `YYYY-MM-DD` -> `DD/MM`. Sem `Date`: aritmetica de string, como no resto do Core. */
function formatarDataCurta(data: string): string {
  const partes = data.split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}` : data;
}

/** Estreitamento local do ramo de horarios, para nao repetir o tipo inteiro. */
type DecisaoHorariosDisponiveis = Extract<DecisaoOrquestrador, { tipo: 'horarios_disponiveis' }>;
