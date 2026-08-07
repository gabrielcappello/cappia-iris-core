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

export type AcaoContextoHorarios =
  | { tipo: 'substituir'; horarios: string[] }
  | { tipo: 'propor'; data: string; horario: string }
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

    case 'saudacao':
    case 'duvida_livre':
    case 'mensagem_nao_compreendida':
      return { tipo: 'preservar' };

    case 'clinica_sem_catalogo':
    case 'desistencia':
    case 'aguardando_procedimento':
    case 'erro_catalogo_procedimento':
    case 'aguardando_escolha_dentista':
    case 'sem_dentista_disponivel':
    case 'erro_catalogo_dentista':
    case 'duracao_nao_configurada':
    case 'erro_configuracao_duracao':
    case 'aguardando_data_horario':
    case 'cadastro_necessario':
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
 * `ultima-troca.ts` encadeia seu proprio CAS sobre este valor, entao ele
 * precisa refletir o que REALMENTE aconteceu na linha, nao apenas "terminou
 * sem lancar":
 *
 * - `preservar` (nenhum UPDATE emitido): devolve `atualizado_em_da_decisao`
 *   recebido, inalterado.
 * - UPDATE com CAS bem-sucedido (`.select().maybeSingle()` devolveu uma
 *   linha): devolve exatamente o `proximoTimestamp(...)` que esta funcao
 *   mesma gravou.
 * - CAS falho (`.maybeSingle()` devolveu `null`, zero linhas afetadas) OU
 *   excecao do cliente: devolve `atualizado_em_da_decisao` recebido,
 *   inalterado -- DELIBERADAMENTE obsoleto. Nao e um vazamento de erro: e o
 *   mecanismo pelo qual o CAS seguinte de ultima_troca falha por conta
 *   propria e abandona, exatamente como uma operacao obsoleta deve se
 *   comportar. Nenhuma releitura para "descobrir" o valor novo.
 */
export async function gravarContextoHorarios(
  cliente: ClienteBancoDados,
  entrada: GravarContextoHorariosEntrada
): Promise<string> {
  // Preservar nao emite nenhuma instrucao -- nem UPDATE, nem SELECT.
  if (entrada.acao.tipo === 'preservar') return entrada.atualizado_em_da_decisao;

  const contexto: ContextoHorarios | null =
    entrada.acao.tipo === 'substituir'
      ? { horarios: entrada.acao.horarios, criado_em: new Date().toISOString() }
      : entrada.acao.tipo === 'propor'
        ? { proposta_pendente: { data: entrada.acao.data, horario: entrada.acao.horario }, criado_em: new Date().toISOString() }
        : null;

  const proximoValor = proximoTimestamp(entrada.atualizado_em_da_decisao);

  try {
    const { data } = await cliente
      .from('estado_conversa')
      .update({
        contexto_horarios: contexto,
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

  const { horarios, criado_em, proposta_pendente } = valor as Record<string, unknown>;
  if (typeof criado_em !== 'string') return null;

  // Cada campo, quando PRESENTE, precisa ser valido -- um campo presente
  // porem malformado invalida o snapshot inteiro (nunca aceita um dos dois
  // parcialmente). Um campo AUSENTE simplesmente nao contribui.
  if (horarios !== undefined && !horariosValidos(horarios)) return null;
  if (proposta_pendente !== undefined && !propostaPendenteValida(proposta_pendente)) return null;

  // Pelo menos um dos dois precisa existir -- um snapshot sem nenhum e
  // invalido, nunca vira um objeto "vazio" (specs/resposta-conversacional-v1.md
  // secao 5).
  if (horarios === undefined && proposta_pendente === undefined) return null;

  return {
    ...(horarios !== undefined ? { horarios: horarios as string[] } : {}),
    ...(proposta_pendente !== undefined ? { proposta_pendente: proposta_pendente as { data: string; horario: string } } : {}),
    criado_em,
  };
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
