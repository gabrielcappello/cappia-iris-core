// Guarda programatica da resposta da IA redatora (specs/resposta-
// conversacional-v1.md secao 4). Funcao pura de texto: nao chama IA, nao
// acessa banco. Roda DEPOIS da redacao e ANTES de qualquer envio ao
// paciente -- nunca edita, corrige ou reescreve o texto reprovado, so
// aprova ou reprova.
//
// ACHADO da implementacao (2026-08-06): a deteccao de horario e
// deliberadamente estreita, exatamente como a spec aprovada exige (so
// "HH:MM" e "Nh"/"N horas", nunca "14h30" nem "2:30pm"). Isso significa que
// um horario escrito num formato fora dessa lista escapa da guarda sem ser
// verificado contra as fontes autorizadas -- limitacao conhecida do
// contrato aprovado, nao desta implementacao.
//
// AJUSTE 2026-08-06 (revisao independente, principio "reciprocidade"): a
// guarda tinha uma checagem de afirmacao de reserva (marcado/agendado/
// confirmado/reservado) com deteccao de negacao numa janela de texto --
// um segundo interpretador de portugues feito em regex, crescendo a cada
// frase nova que ele nao previa (ver historico: chegou a reprovar "Ainda
// nao esta confirmado, ta?" por conter a palavra "confirmado", ate a
// correcao de negacao; e a propria correcao de negacao ja era o sintoma do
// problema, nao a solucao). Removida por completo. A guarda so verifica
// agora o que e OBJETIVAMENTE verificavel -- um valor concreto (horario)
// presente ou ausente numa lista de fatos -- nunca a interpretacao de uma
// frase. A garantia de nunca afirmar reserva sem fato passa a vir do
// principio operacional do proprio prompt (redator-instrucoes.ts): "So diga
// que algo esta confirmado ou marcado quando o Core informar que a reserva
// foi criada." -- e do fato de que, sem cancelamento ainda existir, um erro
// ocasional de linguagem e uma decisao de produto aceita pelo Gabriel, nao
// um risco a ser eliminado por codigo.

import type { FatosAutorizados } from './fatos-autorizados.ts';

export type MotivoReprovacaoGuarda = 'texto_vazio' | 'horario_nao_autorizado';

export type ResultadoGuarda = { aprovado: true } | { aprovado: false; motivo: MotivoReprovacaoGuarda };

// Datas primeiro, para excluir essa posicao do texto antes de procurar
// horario (spec secao 4) -- embora nenhum dos dois padroes de horario abaixo
// possa colidir com DD/MM em teoria (nenhum tem '/'), a mascara e aplicada
// exatamente como a spec descreve, por seguranca deliberada.
const REGEX_DATA = /\b(0?[1-9]|[12][0-9]|3[01])\/(0?[1-9]|1[0-2])(\/[0-9]{2,4})?\b/g;
const REGEX_HHMM = /\b([01]?[0-9]|2[0-3]):([0-5][0-9])\b/g;
const REGEX_NH = /\b([01]?[0-9]|2[0-3])\s*h\b/gi;
const REGEX_N_HORAS = /\b([01]?[0-9]|2[0-3])\s*horas\b/gi;

export function verificarRespostaRedatora(texto: string, fatos: FatosAutorizados): ResultadoGuarda {
  if (texto.trim() === '') {
    return { aprovado: false, motivo: 'texto_vazio' };
  }

  const minutosAutorizados = coletarMinutosAutorizados(fatos);
  for (const minutosCitados of extrairHorariosCitados(texto)) {
    if (!minutosAutorizados.has(minutosCitados)) {
      return { aprovado: false, motivo: 'horario_nao_autorizado' };
    }
  }

  return { aprovado: true };
}

function coletarMinutosAutorizados(fatos: FatosAutorizados): Set<number> {
  const minutos = new Set<number>();
  for (const horario of fatos.horarios_disponiveis ?? []) {
    minutos.add(minutosDoHorario(horario));
  }
  if (fatos.proposta_pendente !== undefined) {
    minutos.add(minutosDoHorario(fatos.proposta_pendente.horario));
  }
  if (fatos.agendamento_confirmado !== undefined) {
    minutos.add(minutosDoHorario(fatos.agendamento_confirmado.horario));
  }
  return minutos;
}

// Fontes autorizadas sempre chegam em 'HH:MM' (formatarMinutos) -- parse
// direto, sem tolerancia a outro formato, porque quem produz esse valor e
// sempre o proprio Core.
function minutosDoHorario(horarioHHMM: string): number {
  const [hora, minuto] = horarioHHMM.split(':').map(Number);
  return hora * 60 + minuto;
}

function extrairHorariosCitados(texto: string): number[] {
  const textoSemDatas = texto.replace(REGEX_DATA, (correspondencia) => ' '.repeat(correspondencia.length));

  const minutos: number[] = [];
  for (const m of textoSemDatas.matchAll(REGEX_HHMM)) {
    minutos.push(Number(m[1]) * 60 + Number(m[2]));
  }
  for (const m of textoSemDatas.matchAll(REGEX_NH)) {
    minutos.push(Number(m[1]) * 60);
  }
  for (const m of textoSemDatas.matchAll(REGEX_N_HORAS)) {
    minutos.push(Number(m[1]) * 60);
  }
  return minutos;
}
