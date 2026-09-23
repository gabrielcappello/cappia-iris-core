// Composicao "mensagem mista" -- PROPOSTA C (2026-09-16,
// reviews/revisao-pos-consulta-conversacional-v1.md, segunda revisao,
// aprovada pelo Gabriel: "nao aprovar A nem B... Proposta C recomendada").
//
// O problema que resolve: uma mensagem pode responder a pergunta de
// pos-consulta ("foi otimo") E, no mesmo turno, trazer um pedido
// operacional real ("quero marcar uma limpeza"). Nem engolir o pedido
// (proposta A original) nem mandar duas respostas desconexas (proposta B
// original) -- aqui, o Core decide se este turno usa o redator PRINCIPAL
// (com fatos aditivos de pos-consulta) ou o redator PROPRIO de pos-consulta,
// e devolve so essa DECISAO DE ROTEAMENTO + a reivindicacao da entrega. A
// GERACAO do texto final continua sendo responsabilidade do chamador
// (index.ts): usar_redator_principal exige campos de
// GerarRespostaConversacionalEntrada que so o chamador tem (cadastro
// conhecido, clinica conhecida, etc.) -- duplicar isso aqui so para "manter
// tudo num lugar so" acoplaria este modulo a quase todo o contrato do
// redator principal, sem necessidade real.
//
// QUANDO USAR: so quando buscarJornadaAbertaPosConsulta encontrou uma
// jornada aberta para a clinica+telefone da mensagem recebida, e
// processarMensagem (fluxo principal) ja rodou neste MESMO turno -- esta
// funcao nunca decide fluxo, so ROTEIA entre dois redatores ja existentes.
//
// CORRECAO C1 (terceira revisao, reviews/revisao-pos-consulta-conversacional-v1.md):
// este modulo chegou a confirmar a entrega SINCRONAMENTE, logo apos gerar o
// texto -- justificado (errado) como "mesmo risco que o resto do fluxo ja
// aceita". O Codex apontou o defeito real: confirmar antes do envio de fato
// acontecer marca a etapa como concluida (e, no modo 'ambos' com resposta
// positiva, grava `convite_google_em`) mesmo que a Evolution API rejeite o
// envio ou a chamada nunca chegue a acontecer -- exatamente a MESMA classe
// de defeito que B2 corrigiu para a primeira entrega, so que reintroduzida
// aqui para a segunda. `confirmarRoteamentoMensagemMista` foi REMOVIDA
// deste arquivo -- nao existe mais confirmacao automatica em nenhum ponto
// deste modulo. O CHAMADOR (index.ts) devolve `entregaId`/`claimToken` na
// resposta HTTP; SOMENTE depois que o transporte (n8n) confirmar que a
// Evolution aceitou o envio, ele chama
// public.cappia_pos_consulta_confirmar_entrega (via a Edge Function
// iris-nova-pos-consulta, operacao "confirmar") -- nunca este modulo,
// nunca dentro do mesmo turno de geracao de texto.

import { reivindicarRespostaPosConsulta } from './pos-consulta-reivindicar-resposta.ts';
import type { JornadaAbertaParaResposta } from './pos-consulta-reivindicar-resposta.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';
import type { ClienteClassificadorPosConsulta } from './cliente-modelo-classificador-pos-consulta-openai.ts';

// As quatro decisoes CONVERSACIONAIS do fluxo principal -- nenhum pedido
// operacional real. Fora deste conjunto, a mensagem tem um pedido
// operacional concorrente com a resposta de pos-consulta. Lista fechada,
// duplicada aqui de proposito (nao importa DecisaoOrquestrador['tipo'] de
// orquestrador-tipos.ts): manter este modulo sem dependencia estrutural do
// tipo completo de decisao do fluxo principal, mesma disciplina de
// isolamento ja aplicada a pos-consulta-tipos.ts. Se o vocabulario de
// DecisaoOrquestrador mudar, este conjunto precisa ser revisado -- e por
// isso e pequeno e comentado, nunca escondido dentro de uma funcao maior.
const TIPOS_DECISAO_CONVERSACIONAL: ReadonlySet<string> = new Set([
  'saudacao',
  'duvida_livre',
  'mensagem_nao_compreendida',
  'desistencia',
]);

export function ehDecisaoConversacional(tipoDecisaoPrincipal: string): boolean {
  return TIPOS_DECISAO_CONVERSACIONAL.has(tipoDecisaoPrincipal);
}

export type DecisaoRoteamentoMensagemMista =
  // O pedido operacional NAO deve ser engolido -- o redator PRINCIPAL
  // responde a ele, com estes fatos aditivos de pos-consulta anexados.
  | { tipo: 'usar_redator_principal'; classificacao: 'positiva' | 'nao_positiva' | 'incerta'; linkAvaliacaoGoogle?: string }
  // Sem pedido operacional concorrente -- o redator PROPRIO de pos-consulta
  // responde este turno inteiro, como se nenhuma mensagem mista existisse.
  // Carrega a MESMA classificacao/link (o chamador precisa deles para
  // montar a DecisaoPosConsulta correta -- agradecer_e_convidar_avaliacao_google
  // vs agradecer_sem_convite -- exatamente como pos-consulta-processar-
  // resposta.ts ja faz).
  | { tipo: 'usar_redator_pos_consulta'; classificacao: 'positiva' | 'nao_positiva' | 'incerta'; linkAvaliacaoGoogle?: string };

export interface EntradaReivindicarRoteamentoMensagemMista {
  clinicaId: string;
  jornada: JornadaAbertaParaResposta;
  mensagemPaciente: string;
  /** `DecisaoOrquestrador.tipo` ja calculado pelo chamador neste MESMO turno. */
  decisaoPrincipalTipo: string;
  /** Link configurado para esta jornada -- so usado quando o convite for de fato autorizado. */
  linkAvaliacaoGoogle?: string;
}

export type ResultadoReivindicarRoteamentoMensagemMista =
  // `entregaId`/`claimToken`: o CHAMADOR deve devolve-los ao transporte, que
  // so chama confirmarEntregaPosConsulta DEPOIS do envio real ser aceito
  // (C1) -- nunca dentro desta chamada nem logo em seguida a ela.
  | { tipo: 'roteada'; roteamento: DecisaoRoteamentoMensagemMista; agendamentoId: string; entregaId: string; claimToken: string }
  | { tipo: 'em_andamento' }
  | { tipo: 'ja_processada' }
  | { tipo: 'jornada_nao_encontrada' }
  | { tipo: 'jornada_nao_aguarda_resposta' };

export async function reivindicarRoteamentoMensagemMista(
  clienteRpc: ClienteRpc,
  clienteClassificador: ClienteClassificadorPosConsulta | null,
  entrada: EntradaReivindicarRoteamentoMensagemMista
): Promise<ResultadoReivindicarRoteamentoMensagemMista> {
  const reivindicacao = await reivindicarRespostaPosConsulta(clienteRpc, clienteClassificador, {
    clinicaId: entrada.clinicaId,
    jornada: entrada.jornada,
    mensagemPaciente: entrada.mensagemPaciente,
  });

  if (reivindicacao.tipo !== 'pendente') return { tipo: reivindicacao.tipo };

  const linkQuandoAutorizado =
    reivindicacao.convitePendente && entrada.linkAvaliacaoGoogle !== undefined
      ? { linkAvaliacaoGoogle: entrada.linkAvaliacaoGoogle }
      : {};

  const roteamento: DecisaoRoteamentoMensagemMista = ehDecisaoConversacional(entrada.decisaoPrincipalTipo)
    ? { tipo: 'usar_redator_pos_consulta', classificacao: reivindicacao.classificacao, ...linkQuandoAutorizado }
    : { tipo: 'usar_redator_principal', classificacao: reivindicacao.classificacao, ...linkQuandoAutorizado };

  return {
    tipo: 'roteada',
    roteamento,
    agendamentoId: entrada.jornada.agendamentoId,
    entregaId: reivindicacao.entregaId,
    claimToken: reivindicacao.claimToken,
  };
}
