// Usa o dentista que ja atende o paciente quando ele pede algo novo sem
// dizer com quem.
//
// ── O CASO REAL (2026-08-19) ────────────────────────────────────────────
//   Paciente: "gostaria de uma limpeza para amanha"
//   Iris:     "prefere com o Dr. Diego Ramoz ou com o Dr. Pablo Arruda?"
//
// O paciente tinha DOIS agendamentos, os dois com o Dr. Diego. Perguntar
// quem faz a limpeza ignora o obvio -- e obriga o paciente a repetir uma
// escolha que ele ja fez.
//
// ── POR QUE A INSTRUCAO NAO BASTOU ──────────────────────────────────────
// A regra JA EXISTE na instrucao ("esse profissional e a preferencia
// natural: coloque o dentista_id dele em dentistas_candidatos") e a IA nao
// a seguiu. E uma entre 42 regras.
//
// Quarta vez hoje que a mesma solucao resolve: procedimento, dentista do
// plano, agendamento pela data -- e agora o dentista preferido. Escolher o
// unico profissional que ja atende o paciente e deducao, nao interpretacao
// de linguagem.
//
// ── QUANDO NAO AGE ──────────────────────────────────────────────────────
// - a IA leu um profissional (o paciente nomeou alguem);
// - a conversa ja tem dentista definido;
// - o paciente tem agendamentos com dentistas DIFERENTES -- ai nao ha
//   preferencia unica, e perguntar e o certo;
// - nao ha agendamento nenhum.

import type { AlteracoesDados } from './tipos.ts';

/** O minimo que o Core precisa saber de cada agendamento do paciente. */
export interface AgendamentoComDentista {
  dentista_id?: string;
}

export interface ResultadoDentistaPreferido {
  alteracoes: AlteracoesDados;
  /** `true` quando o dentista preferido foi aplicado -- para log. */
  aplicou: boolean;
}

/**
 * Escreve `dentista_id` com o profissional que ja atende este paciente,
 * quando ha um so e o turno nao trouxe outro.
 */
export async function aplicarDentistaPreferido(
  alteracoes: AlteracoesDados,
  candidatosDaIA: string[] | null,
  agendamentos: readonly AgendamentoComDentista[] | undefined,
  snapshotOficial: Record<string, string | undefined>,
  /**
   * Carregador PREGUICOSO dos `dentista_id` distintos do historico de
   * atendimento passado elegivel (dentistas-historicos.ts, 2026-08-31).
   *
   * E uma funcao, nao um valor, de proposito
   * (specs/dentista-semantico-v1.md secao 13.5): a consulta so acontece se
   * esta funcao chegar ate ela, isto e, se nenhuma das guardas acima tiver
   * dispensado a deducao. Assim um "bom dia" nao paga consulta ao banco, e
   * uma falha nessa leitura nao alcanca conversas que nao dependem dela.
   *
   * Fonte SEPARADA de `agendamentos`, tambem de proposito: aquele parametro
   * carrega agendamentos futuros/ativos e sua semantica atravessa ate a
   * redatora. Este traz somente IDs do passado, chega apenas aqui, e nunca
   * vai ao modelo -- o Core deduz, a IA nao precisa saber.
   *
   * O defeito que originou: o paciente pediu "o mesmo dentista que sempre me
   * atende" as 10:32, com atendimento as 08:00 do MESMO dia; a busca de
   * ativos ja o havia excluido pelo corte temporal, e a Iris perguntou.
   */
  carregarDentistasHistoricos?: () => Promise<readonly string[]>
): Promise<ResultadoDentistaPreferido> {
  // O paciente MENCIONOU um profissional -- a escolha dele manda. Preferencia
  // explicita do turno prevalece SEMPRE, inclusive sobre o historico.
  //
  // QUALQUER array interrompe, inclusive o VAZIO. `null` e `[]` NAO sao a
  // mesma coisa (secao 12 da spec, contrato fechado em 2026-08-09):
  //
  //   null -- o paciente nao mencionou profissional nenhum;
  //   []   -- ele mencionou alguem que NAO existe nesta clinica.
  //
  // O `[]` que chega aqui ja passou por `descartarListaVaziaSemMencao`, que
  // converte para `null` o caso de lista vazia sem mencao real. Entao um `[]`
  // sobrevivente e uma preferencia declarada e nao localizada, que segue pelo
  // comportamento vigente (`preferencia_nao_localizada`).
  //
  // Ate 2026-08-31 esta condicao era `length > 0`, e o `[]` atravessava:
  // o paciente pedia um profissional que a clinica nao tem e o Core aplicava
  // em silencio o dentista habitual -- o oposto exato de "a escolha explicita
  // prevalece".
  if (candidatosDaIA !== null) {
    return { alteracoes, aplicou: false };
  }
  // O paciente REMOVEU o profissional neste turno ("nao quero mais com ele").
  // Reaplicar o habitual logo em seguida escreveria de volta exatamente o que
  // ele acabou de tirar -- e uma escolha explicita, na direcao contraria.
  //
  // Verificado em 2026-08-31: `acao: 'remover'` esta no schema que a IA pode
  // emitir (interpretacao-instrucoes.ts), e `remover` nao carrega `valor` --
  // por isso a checagem de "ja definido" abaixo, que le `.valor`, nao pega
  // este caso sozinha.
  if (alteracoes.dentista_id?.acao === 'remover') {
    return { alteracoes, aplicou: false };
  }

  // A conversa ja definiu um profissional.
  const jaDefinido = snapshotOficial.dentista_id ?? alteracoes.dentista_id?.valor;
  if (typeof jaDefinido === 'string' && jaDefinido.trim() !== '') {
    return { alteracoes, aplicou: false };
  }

  // A PARTIR DAQUI ninguem foi nomeado e a conversa nao tem profissional
  // definido. Mas isso ainda NAO basta para pagar a consulta ao historico:
  // um "bom dia" numa conversa nova satisfaz as duas guardas acima.
  //
  // TERCEIRA GUARDA (specs/dentista-semantico-v1.md secao 13.5): a deducao so
  // e tentada no fluxo de NOVO AGENDAMENTO. Sinal estrutural ja existente --
  // nenhuma regex, nenhum estado novo, nenhuma taxonomia nova.
  //
  // `INTENCOES_PERMITIDAS` tem TRES valores, e os outros dois nao podem ser
  // contaminados por esta deducao:
  //
  // - `remarcacao`  -- o profissional vem do CONTRATO da remarcacao: e o do
  //   agendamento que esta sendo remarcado (specs/remarcacao-conversacional-
  //   v1.md), nunca o "habitual" deduzido do historico. Deduzir aqui poderia
  //   trocar o dentista de um agendamento que ja existe.
  // - `cancelamento` -- nao ha profissional a escolher; cancelar nao precisa
  //   de dentista nenhum.
  //
  // A intencao EFETIVA (turno sobrepondo snapshot) e quem decide: uma
  // conversa que era de agendamento e virou cancelamento sai por aqui.
  // `remover` NUNCA cai no snapshot antigo: se o paciente retirou a intencao
  // (desistiu do fluxo), a intencao efetiva do turno e ausencia -- e uma
  // conversa sem fluxo de agendamento nao deduz profissional nenhum.
  // Verificado em 2026-08-31: `remover` nao carrega `valor`, entao um `??`
  // simples herdaria silenciosamente o `novo_agendamento` ja superado.
  const intencaoRemovida = alteracoes.intencao?.acao === 'remover';
  const intencao = intencaoRemovida
    ? undefined
    : (alteracoes.intencao?.valor ?? snapshotOficial.intencao);
  if (typeof intencao === 'string' && intencao.trim() !== '' && intencao !== 'novo_agendamento') {
    return { alteracoes, aplicou: false };
  }

  // `agendamento_id` e o marcador estrutural de que a conversa trata de um
  // agendamento QUE JA EXISTE (remarcacao/cancelamento, tipos.ts). Mesmo sem
  // `intencao` explicita, sua presenca dispensa a deducao do habitual.
  const agendamentoEmFoco = alteracoes.agendamento_id?.valor ?? snapshotOficial.agendamento_id;
  if (typeof agendamentoEmFoco === 'string' && agendamentoEmFoco.trim() !== '') {
    return { alteracoes, aplicou: false };
  }

  // Autoriza a deducao: intencao explicita de novo agendamento, ou a
  // continuacao inequivoca desse fluxo -- um `procedimento_id` escolhido sem
  // nenhum agendamento existente em foco (as duas guardas acima ja
  // eliminaram remarcacao e cancelamento).
  //
  // Sem nenhum dos dois, a conversa e basica (saudacao, duvida livre,
  // agradecimento): nao ha profissional a deduzir e nada e consultado.
  // Mesmo tratamento de `remover` para o procedimento: retirado no turno, ele
  // nao pode ser herdado do snapshot como se ainda valesse.
  const procedimentoRemovido = alteracoes.procedimento_id?.acao === 'remover';
  const procedimento = procedimentoRemovido
    ? undefined
    : (alteracoes.procedimento_id?.valor ?? snapshotOficial.procedimento_id);
  const emNovoAgendamento =
    intencao === 'novo_agendamento' ||
    // Um procedimento so autoriza a CONTINUACAO quando a intencao nao foi
    // retirada neste turno -- senao o paciente desiste e o Core deduz assim
    // mesmo, apoiado num procedimento que ficou orfao.
    (!intencaoRemovida && typeof procedimento === 'string' && procedimento.trim() !== '');
  if (!emNovoAgendamento) {
    return { alteracoes, aplicou: false };
  }

  // So agora vale pagar a consulta ao historico -- e este e o unico ponto que
  // a dispara.
  //
  // Duas fontes, uma unica pergunta: "quem ja atende este paciente?".
  // O futuro (agendamentos ativos) e o passado (historico elegivel) somam no
  // mesmo conjunto -- se as duas apontarem para o MESMO profissional, ele
  // continua sendo um so e a deducao vale.
  const dentistas = new Set<string>();
  for (const a of agendamentos ?? []) {
    if (typeof a.dentista_id === 'string' && a.dentista_id.trim() !== '') dentistas.add(a.dentista_id);
  }
  if (carregarDentistasHistoricos !== undefined) {
    for (const id of await carregarDentistasHistoricos()) {
      if (typeof id === 'string' && id.trim() !== '') dentistas.add(id);
    }
  }

  // Zero: nada diz quem atendeu.
  // Varios: o paciente ja foi atendido por profissionais diferentes -- nao
  // ha preferencia unica, e escolher um seria decidir por ele.
  if (dentistas.size !== 1) {
    return { alteracoes, aplicou: false };
  }

  const [preferido] = [...dentistas];
  return {
    alteracoes: { ...alteracoes, dentista_id: { acao: 'informar', valor: preferido } },
    aplicou: true,
  };
}
