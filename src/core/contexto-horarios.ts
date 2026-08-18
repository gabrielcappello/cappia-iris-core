// Snapshot minimo dos horarios ja oferecidos ao paciente, para que a IA
// consiga interpretar uma resposta curta no turno seguinte ("15", "15 hrs",
// "quinze horas", "o segundo").
//
// Contrato: specs/contexto-pendente-interpretacao-v1.md (V1, escopo
// estritamente restrito a horario -- nada de dentista, nada de
// generalizacao para outros tipos de opcao) + specs/resposta-conversacional-v1.md
// secao 5 (2026-08-06: acao `propor`, snapshot com `proposta_pendente`).
//
// Duas responsabilidades, deliberadamente separadas:
//
// 1. `derivarAcaoContextoHorarios` -- PURA. Nao le relogio, nao acessa
//    banco, nao decide fluxo: so traduz a decisao ja tomada pelo
//    orquestrador em substituir/preservar/limpar.
// 2. `gravarContextoHorarios` -- efeito. Uma unica instrucao UPDATE, com
//    CAS sobre o `atualizado_em` EXATO do estado sobre o qual a decisao foi
//    calculada. Nunca rele, nunca repete, nunca rebaseia.
//
// O snapshot NUNCA e fonte de disponibilidade e NUNCA autoriza reserva --
// serve so para interpretar a linguagem da proxima mensagem. A
// disponibilidade continua recalculada do zero a cada mensagem, e
// `confirmacao === 'sim'` continua a unica autoridade para reservar.

import { formatarMinutos } from './gerar-resposta-paciente.ts';
import type { ClienteBancoDados, ContextoHorarios } from './tipos.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';
import type { PerguntaPendente } from './contexto-unificado-tipos.ts';

export type AcaoContextoHorarios =
  | { tipo: 'substituir'; horarios: string[] }
  | { tipo: 'propor'; data: string; horario: string }
  | { tipo: 'oferecer'; procedimento_id: string }
  | { tipo: 'perguntar_troca_telefone' }
  | { tipo: 'perguntar_qual_agendamento'; agendamento_ids: string[] }
  | { tipo: 'preservar' }
  | { tipo: 'limpar' };

/**
 * Ciclo de vida do snapshot, por decisao (specs/contexto-pendente-
 * interpretacao-v1.md secao 4 + specs/resposta-conversacional-v1.md secao 5):
 *
 * - SUBSTITUIR: a unica decisao que de fato apresenta uma LISTA de horarios
 *   ao paciente.
 * - PROPOR: `aguardando_confirmacao` -- o Core propos UM horario concreto e
 *   aguarda confirmacao explicita. Substitui o snapshot por inteiro: uma
 *   lista antiga nunca sobrevive junto com uma proposta nova (sem merge).
 *   Ate 2026-08-05 esta decisao gravava `limpar`, por um raciocinio que a
 *   evidencia real invalidou -- ver o comentario junto ao proprio case
 *   abaixo.
 * - PRESERVAR: os tres desvios de passagem -- nao fazem pergunta nova,
 *   entao a pergunta pendente continua sendo a mesma de antes e apagar o
 *   snapshot faria a Iris repetir a lista sem motivo.
 * - LIMPAR: todo o resto. Um snapshot pendurado compete com uma pergunta
 *   que passou a ser sobre outra coisa: com a lista antiga presente, "dia
 *   15" respondido a "quer tentar outra data?" tenderia a virar 15:00 em
 *   vez do dia 15.
 *
 * Pura e exaustiva: uma decisao nova sem `case` correspondente nao compila.
 */
export function derivarAcaoContextoHorarios(decisao: DecisaoOrquestrador): AcaoContextoHorarios {
  switch (decisao.tipo) {
    case 'horarios_disponiveis':
      return acaoParaHorariosDisponiveis(decisao.resultado);

    // Ate 2026-08-05, este case gravava 'limpar', com o raciocinio de que o
    // horario ja vive em dados.horario_texto e chega a IA por ai, tornando
    // um snapshot redundante. A evidencia real (WhatsApp, 2026-08-05)
    // invalidou isso: a IA recebe dados_atuais, mas nao sabe que aquele
    // horario e uma PROPOSTA AGUARDANDO RESPOSTA -- e exatamente essa
    // diferenca que fazia "esse mesmo"/"pode confirmar" falharem. Um
    // comentario desatualizado que afirma o oposto do codigo e pior que
    // nenhum comentario -- por isso a explicacao antiga foi substituida
    // aqui, no lugar onde a decisao realmente e tomada, em vez de deixada
    // solta perto de uma funcao nao relacionada.
    case 'aguardando_confirmacao':
      return { tipo: 'propor', data: decisao.opcao.data, horario: formatarMinutos(decisao.opcao.inicio_min) };

    // OFERECER (2026-08-09, specs/contexto-pendente-interpretacao-v1.md
    // secao 11): a Iris acabou de oferecer um procedimento e aguarda
    // resposta. Sem este snapshot, "pode ser" no turno seguinte chega a
    // interpretadora sem nenhuma pergunta pendente declarada e vira
    // `nao_compreendida` -- medido 3/3 contra a IA real.
    //
    // `procedimento_oferecido` so vem preenchido quando a oferta e REAL (a
    // avaliacao existe, esta ativa e tem dentista apto). Ausente = nao houve
    // oferta, e o comportamento continua sendo `limpar`, como antes.
    //
    // Nao ha caso de "preservar" a oferta: ela e RE-DERIVADA a cada turno em
    // que a situacao nao muda. Uma duvida sobre a oferta ("quanto custa?")
    // nao altera procedimento nem aptidao, entao o fluxo recalcula
    // `sem_dentista_disponivel` e regrava a oferta identica.
    case 'sem_dentista_disponivel':
      return decisao.procedimento_oferecido !== undefined
        ? { tipo: 'oferecer', procedimento_id: decisao.procedimento_oferecido }
        : { tipo: 'limpar' };

    // PERGUNTAR_TROCA_TELEFONE (2026-08-10, specs/cpf-outro-telefone-v1.md
    // secao 1): a Iris acabou de perguntar se pode trocar o telefone oficial
    // do dono do CPF e aguarda sim/nao. Sem este marcador, "pode sim,
    // atualiza pro meu numero" chega a interpretadora sem nenhuma pergunta
    // pendente declarada -- exatamente o defeito que
    // `oferta_procedimento_pendente` ja corrigiu para a oferta de
    // procedimento.
    //
    // SUBSTITUI o snapshot por inteiro (nao preserva `proposta_pendente`):
    // o horario confirmado vive em dados.data_texto/horario_texto/
    // confirmacao e e re-derivado a cada turno. Aqui o paciente esta
    // respondendo sobre o TELEFONE, nao sobre o horario.
    //
    // Nao ha caso de "preservar": como a oferta de procedimento, o marcador
    // e RE-DERIVADO a cada turno em que a situacao nao muda. Uma duvida no
    // meio ("por que precisam disso?") nao altera CPF nem ficha, entao o
    // fluxo recalcula e regrava o mesmo marcador.
    case 'troca_telefone_pendente':
      return { tipo: 'perguntar_troca_telefone' };

    // PERGUNTAR_QUAL_AGENDAMENTO (2026-08-11, specs/remarcacao-
    // conversacional-v1.md secao 3): mais de um agendamento ativo, a Iris
    // perguntou qual remarcar. Mesmo motivo das duas variantes acima: sem
    // este marcador, "o segundo" no turno seguinte chega a interpretadora
    // sem nenhuma pergunta pendente declarada.
    //
    // So os IDS sao persistidos, na mesma ordem em que foram apresentados --
    // as descricoes que a IA le sao remontadas a cada turno a partir de uma
    // busca fresca (orquestrador.ts), nunca guardadas aqui.
    case 'aguardando_escolha_agendamento':
      return { tipo: 'perguntar_qual_agendamento', agendamento_ids: decisao.agendamentos.map((a) => a.agendamento_id) };

    // PROPOR (mesma acao de `aguardando_confirmacao`): o Core propos UM
    // horario concreto para a remarcacao e aguarda confirmacao explicita.
    // Decisao separada, mesma acao de contexto -- a diferenca entre as duas
    // e so a REDACAO (de onde para onde), nunca o mecanismo de pergunta
    // pendente.
    case 'aguardando_confirmacao_remarcacao':
      return { tipo: 'propor', data: decisao.opcao.data, horario: formatarMinutos(decisao.opcao.inicio_min) };

    // Nenhum agendamento ativo, ou remarcacao concluida: a pergunta (se
    // havia alguma) deixou de fazer sentido -- nada fica pendurado.
    case 'sem_agendamento_para_remarcar':
    case 'remarcacao_criada':
      return { tipo: 'limpar' };

    // --- Cancelamento (2026-08-11, specs/cancelamento-conversacional-v1.md) ---
    //
    // MESMA acao da escolha de remarcacao, sem nenhum marcador novo (spec
    // secao 5): o marcador so guarda a lista de IDs oferecidos, papel
    // identico nos dois fluxos. Quem diz QUAL fluxo esta em andamento quando
    // o paciente responde "o segundo" e `dados.intencao`, que e persistido e
    // sobrevive ao turno -- nunca este marcador sozinho.
    case 'aguardando_escolha_agendamento_cancelamento':
      return { tipo: 'perguntar_qual_agendamento', agendamento_ids: decisao.agendamentos.map((a) => a.agendamento_id) };

    // PROPOR (mesma acao das outras duas confirmacoes): a Iris mostrou QUAL
    // agendamento sera cancelado e aguarda confirmacao explicita. Reuso
    // deliberado de `proposta_pendente` (spec secao 4, decisao do Gabriel):
    // ele e um sinal DECLARATIVO -- "ha um fato concreto aguardando
    // confirmacao" --, nunca prescritivo sobre o que esse fato significa. A IA
    // nunca soube, e nao precisa saber, se confirma uma reserva, uma
    // remarcacao ou um cancelamento; isso sempre foi do Core.
    //
    // `data`/`horario` vao CRUS do agendamento (nunca reformatados): e contra
    // estes valores exatos que o orquestrador confere a condicao 3 da spec no
    // turno seguinte.
    case 'aguardando_confirmacao_cancelamento':
      return { tipo: 'propor', data: decisao.agendamento.data, horario: decisao.agendamento.horario };

    // Nenhum agendamento ativo, ou cancelamento concluido: nada fica pendurado.
    case 'sem_agendamento_para_cancelar':
    case 'cancelamento_criado':
      return { tipo: 'limpar' };

    case 'saudacao':
    case 'duvida_livre':
    case 'mensagem_nao_compreendida':
    // PRESERVAR desde 2026-08-10 (specs/cadastro-conversacional-v1.md secao 5).
    // Era `limpar`. A coleta de cadastro leva mais de um turno; limpando aqui,
    // a proposta que o paciente JA CONFIRMOU desaparecia e o slot teria de ser
    // re-derivado a cada turno.
    //
    // Preservar NAO reserva, NAO bloqueia e NAO garante o horario: a reserva
    // continua sendo a autoridade final e detecta `horario_ocupado`
    // normalmente se ele for tomado durante a coleta.
    case 'cadastro_necessario':
      return { tipo: 'preservar' };

    case 'clinica_sem_catalogo':
    case 'desistencia':
    case 'aguardando_procedimento':
    case 'aguardando_escolha_dentista':
    case 'combinacao_indisponivel':
    case 'erro_catalogo_dentista':
    case 'duracao_nao_configurada':
    case 'erro_configuracao_duracao':
    case 'aguardando_data_horario':
    case 'cpf_ja_cadastrado':
    // O paciente recusou a troca: a pergunta deixou de existir, entao o
    // marcador some. O fluxo para e encaminha a recepcao
    // (specs/cpf-outro-telefone-v1.md secao 3) -- nada fica pendurado.
    case 'troca_telefone_recusada':
    case 'reserva_criada':
    case 'reserva_conflito':
    case 'reserva_falhou':
      return { tipo: 'limpar' };
  }
}

function acaoParaHorariosDisponiveis(
  resultado: Extract<DecisaoOrquestrador, { tipo: 'horarios_disponiveis' }>['resultado']
): AcaoContextoHorarios {
  switch (resultado.tipo) {
    case 'opcoes':
      // Mesma formatacao e mesma ordem que gerarRespostaPaciente usa para
      // montar o texto -- nunca reconstruido a partir do texto, nunca
      // reordenado.
      return { tipo: 'substituir', horarios: resultado.opcoes.map((opcao) => formatarMinutos(opcao.inicio_min)) };

    case 'horario_exato_indisponivel': {
      // Mesma ordem em que os vizinhos aparecem no texto (anterior antes de
      // posterior); qualquer um dos dois pode estar ausente.
      const horarios = [resultado.anterior, resultado.posterior]
        .filter((opcao) => opcao !== undefined)
        .map((opcao) => formatarMinutos(opcao.inicio_min));
      // Nenhum vizinho oferecido = nenhuma lista apresentada: limpar, nunca
      // gravar um snapshot vazio.
      return horarios.length > 0 ? { tipo: 'substituir', horarios } : { tipo: 'limpar' };
    }

    case 'sem_disponibilidade':
    // Nenhum horario foi oferecido nesse dia -- nada a lembrar, como nos irmaos.
    case 'sem_expediente_no_dia':
    case 'horario_exato_disponivel':
    case 'configuracao_invalida':
    case 'erro_intervalos':
      return { tipo: 'limpar' };
  }
}

export interface GravarContextoHorariosEntrada {
  conversa_id: string;
  clinica_id: string;
  telefone_normalizado: string;
  /**
   * `atualizado_em` EXATO do estado sobre o qual esta decisao foi
   * calculada. Nunca um valor relido logo antes do UPDATE: reler
   * rebasearia uma operacao obsoleta sobre um estado novo, e uma operacao
   * antiga de "substituir" poderia ressuscitar horarios ja apagados por uma
   * limpeza mais nova.
   */
  atualizado_em_da_decisao: string;
  acao: AcaoContextoHorarios;
  /**
   * A anotacao "eu perguntei X" deste turno
   * (specs/contexto-conversacional-unificado-v2.md secao 14.6), derivada da
   * decisao por `declararPerguntaPendente`.
   *
   * Vai no MESMO UPDATE de `contexto_horarios`, sob o MESMO CAS: os dois
   * descrevem o mesmo turno, e gravar em instrucoes separadas abriria a
   * janela de um turno concorrente entrar entre as duas -- deixando o
   * snapshot de um turno com a anotacao de outro.
   *
   * `null` e valor legitimo ("este turno nao deixou pergunta em aberto") e e
   * gravado como tal. Omitir o campo (`undefined`) NAO grava nada e preserva
   * o valor anterior -- usado apenas por chamadores que ainda nao derivam a
   * anotacao, para que a mudanca seja aditiva.
   */
  aguardando_resposta?: PerguntaPendente | null;
}

/**
 * Grava o snapshot com CAS. NUNCA lanca: esta escrita e auxiliar e
 * best-effort por contrato (spec secao 5). Perde-la degrada a conversa (a
 * Iris pode repetir a lista) e nunca produz agendamento errado -- a
 * disponibilidade e sempre recalculada do zero antes de qualquer acao.
 *
 * Ao falhar o CAS: abandona imediatamente. Sem reler, sem recalcular, sem
 * reaplicar o candidato, sem retry.
 *
 * Retorno (specs/memoria-conversacional-minima-v1.md, ajuste do Segundo
 * Code 2026-08-06): exatamente um destes tres, nunca um quarto caso --
 * `historico-conversa.ts` encadeia seu proprio CAS sobre este valor, entao
 * ele precisa refletir o que REALMENTE aconteceu na linha, nao apenas
 * "terminou sem lancar":
 *
 * - `preservar` (nenhum UPDATE emitido): devolve `atualizado_em_da_decisao`
 *   recebido, inalterado.
 * - UPDATE com CAS bem-sucedido (`.select().maybeSingle()` devolveu uma
 *   linha): devolve exatamente o `proximoTimestamp(...)` que esta funcao
 *   mesma gravou.
 * - CAS falho (`.maybeSingle()` devolveu `null`, zero linhas afetadas) OU
 *   excecao do cliente: devolve `atualizado_em_da_decisao` recebido,
 *   inalterado -- DELIBERADAMENTE obsoleto. Nao e um vazamento de erro: e o
 *   mecanismo pelo qual o CAS seguinte de historico_conversa falha por conta
 *   propria e abandona, exatamente como uma operacao obsoleta deve se
 *   comportar. Nenhuma releitura para "descobrir" o valor novo.
 */
export async function gravarContextoHorarios(
  cliente: ClienteBancoDados,
  entrada: GravarContextoHorariosEntrada
): Promise<string> {
  // Preservar nao emite instrucao -- EXCETO quando ha anotacao a gravar.
  //
  // `preservar` significa "nao mexa no snapshot de horarios", nunca "nao
  // mexa em nada": a coleta de cadastro, por exemplo, preserva a proposta
  // confirmada E faz uma pergunta nova a cada turno. Sem esta excecao, a
  // anotacao desses turnos se perderia e o turno seguinte voltaria a
  // adivinhar pelo texto -- exatamente o que ela existe para evitar.
  if (entrada.acao.tipo === 'preservar' && entrada.aguardando_resposta === undefined) {
    return entrada.atualizado_em_da_decisao;
  }

  const contexto: ContextoHorarios | null =
    entrada.acao.tipo === 'substituir'
      ? { horarios: entrada.acao.horarios, criado_em: new Date().toISOString() }
      : entrada.acao.tipo === 'propor'
        ? { proposta_pendente: { data: entrada.acao.data, horario: entrada.acao.horario }, criado_em: new Date().toISOString() }
        : entrada.acao.tipo === 'oferecer'
          ? {
              oferta_procedimento_pendente: { procedimento_id: entrada.acao.procedimento_id },
              criado_em: new Date().toISOString(),
            }
          : entrada.acao.tipo === 'perguntar_troca_telefone'
            ? { troca_telefone_pendente: true, criado_em: new Date().toISOString() }
            : entrada.acao.tipo === 'perguntar_qual_agendamento'
              ? {
                  escolha_agendamento_pendente: { agendamento_ids: entrada.acao.agendamento_ids },
                  criado_em: new Date().toISOString(),
                }
              : null;

  const proximoValor = proximoTimestamp(entrada.atualizado_em_da_decisao);

  // `preservar` com anotacao: grava SO a anotacao, sem tocar
  // `contexto_horarios` -- e o que "preservar" quer dizer.
  const camposHorarios = entrada.acao.tipo === 'preservar' ? {} : { contexto_horarios: contexto };
  // Chave presente so quando o chamador de fato derivou a anotacao. Ausente
  // (`undefined`) preserva o valor anterior; `null` grava "nenhuma pergunta
  // em aberto", que e afirmacao, nao omissao.
  const campoAnotacao =
    entrada.aguardando_resposta === undefined
      ? {}
      : { aguardando_resposta: entrada.aguardando_resposta };

  try {
    const { data } = await cliente
      .from('estado_conversa')
      .update({
        ...camposHorarios,
        ...campoAnotacao,
        atualizado_em: proximoValor,
      })
      .eq('id', entrada.conversa_id)
      .eq('clinica_id', entrada.clinica_id)
      .eq('telefone_normalizado', entrada.telefone_normalizado)
      .eq('atualizado_em', entrada.atualizado_em_da_decisao)
      .select('id')
      .maybeSingle();

    // `data` presente = a linha foi encontrada e atualizada (CAS bem-
    // sucedido); `null` = zero linhas afetadas (CAS falhou). Nenhuma
    // releitura, nenhuma segunda tentativa em nenhum dos dois casos -- so a
    // escolha de qual timestamp devolver muda.
    return data ? proximoValor : entrada.atualizado_em_da_decisao;
  } catch {
    // Falha tecnica do cliente tambem e abandonada em silencio, pelo mesmo
    // motivo do CAS falho: esta escrita nunca pode transformar uma conversa
    // bem-sucedida em erro para o paciente. Mesmo retorno obsoleto do caso
    // de CAS falho.
    return entrada.atualizado_em_da_decisao;
  }
}

/**
 * Mesma garantia de `aplicar-dados.ts`: timestamp estritamente posterior ao
 * anterior, mesmo sob chamadas em sequencia rapida ou resolucao de relogio
 * limitada. Reimplementado aqui (4 linhas) em vez de exportar do
 * aplicar-dados.ts, para nao alterar aquele modulo -- mesmo criterio ja
 * usado em gerar-resposta-paciente.ts/carregar-disponibilidade.ts.
 */
function proximoTimestamp(anteriorIso: string): string {
  const anteriorMs = new Date(anteriorIso).getTime();
  const agoraMs = Date.now();
  const novoMs = agoraMs > anteriorMs ? agoraMs : anteriorMs + 1;
  return new Date(novoMs).toISOString();
}

/**
 * Fronteira de confianca na LEITURA do snapshot (identificacao.ts).
 *
 * Falha ABERTA de proposito: um valor malformado vira `null` e a conversa
 * segue sem contexto, em vez de derrubar a identificacao. E o oposto da
 * disciplina de falha fechada do resto do Core -- justificado porque este
 * campo e puramente auxiliar de interpretacao: nada operacional
 * (disponibilidade, reserva, confirmacao) depende dele, e perde-lo so faz a
 * Iris repetir uma pergunta.
 */
export function validarContextoHorarios(valor: unknown): ContextoHorarios | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'object' || Array.isArray(valor)) return null;

  const {
    horarios,
    criado_em,
    proposta_pendente,
    oferta_procedimento_pendente,
    troca_telefone_pendente,
    escolha_agendamento_pendente,
  } = valor as Record<string, unknown>;
  if (typeof criado_em !== 'string') return null;

  // Cada campo, quando PRESENTE, precisa ser valido -- um campo presente
  // porem malformado invalida o snapshot inteiro (nunca aceita um dos cinco
  // parcialmente). Um campo AUSENTE simplesmente nao contribui.
  if (horarios !== undefined && !horariosValidos(horarios)) return null;
  if (proposta_pendente !== undefined && !propostaPendenteValida(proposta_pendente)) return null;
  if (oferta_procedimento_pendente !== undefined && !ofertaProcedimentoValida(oferta_procedimento_pendente)) return null;
  // Fechado a `true`, nunca `false`: "nao ha pergunta de troca em aberto" se
  // representa pela AUSENCIA da chave, exatamente como as demais variantes.
  if (troca_telefone_pendente !== undefined && troca_telefone_pendente !== true) return null;
  if (escolha_agendamento_pendente !== undefined && !escolhaAgendamentoValida(escolha_agendamento_pendente)) return null;

  // Pelo menos um dos cinco precisa existir -- um snapshot sem nenhum e
  // invalido, nunca vira um objeto "vazio" (specs/resposta-conversacional-v1.md
  // secao 5).
  if (
    horarios === undefined &&
    proposta_pendente === undefined &&
    oferta_procedimento_pendente === undefined &&
    troca_telefone_pendente === undefined &&
    escolha_agendamento_pendente === undefined
  ) {
    return null;
  }

  return {
    ...(horarios !== undefined ? { horarios: horarios as string[] } : {}),
    ...(proposta_pendente !== undefined ? { proposta_pendente: proposta_pendente as { data: string; horario: string } } : {}),
    ...(oferta_procedimento_pendente !== undefined
      ? { oferta_procedimento_pendente: oferta_procedimento_pendente as { procedimento_id: string } }
      : {}),
    ...(troca_telefone_pendente !== undefined ? { troca_telefone_pendente: true as const } : {}),
    ...(escolha_agendamento_pendente !== undefined
      ? { escolha_agendamento_pendente: escolha_agendamento_pendente as { agendamento_ids: string[] } }
      : {}),
    criado_em,
  };
}

function escolhaAgendamentoValida(valor: unknown): valor is { agendamento_ids: string[] } {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const chaves = Object.keys(valor as Record<string, unknown>);
  if (chaves.length !== 1 || chaves[0] !== 'agendamento_ids') return false;
  const { agendamento_ids } = valor as Record<string, unknown>;
  if (!Array.isArray(agendamento_ids) || agendamento_ids.length === 0) return false;
  return agendamento_ids.every((id) => typeof id === 'string' && id.trim() !== '');
}

function ofertaProcedimentoValida(valor: unknown): valor is { procedimento_id: string } {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const chaves = Object.keys(valor as Record<string, unknown>);
  if (chaves.length !== 1 || chaves[0] !== 'procedimento_id') return false;
  const { procedimento_id } = valor as Record<string, unknown>;
  return typeof procedimento_id === 'string' && procedimento_id.trim() !== '';
}

function horariosValidos(valor: unknown): valor is string[] {
  if (!Array.isArray(valor) || valor.length === 0) return false;
  return valor.every((h) => typeof h === 'string' && h.trim() !== '');
}

function propostaPendenteValida(valor: unknown): valor is { data: string; horario: string } {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const { data, horario } = valor as Record<string, unknown>;
  return typeof data === 'string' && data.trim() !== '' && typeof horario === 'string' && horario.trim() !== '';
}
