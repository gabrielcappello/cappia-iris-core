// Fallback deterministico de pos-consulta -- mesmo papel que gerar-resposta-
// paciente.ts tem para o fluxo de agendamento: usado quando a IA redatora
// falha, e vazia, ou e reprovada pela guarda. Texto fixo, aprovado, nunca
// gerado por IA.
//
// Recebe FATOS (nao a decisao) porque o link do Google e um FATO deste
// turno (derivado do contexto pelo Core), nunca parte da decisao de fluxo --
// mesma separacao que pos-consulta-fatos-autorizados.ts ja estabelece.

import type { FatosAutorizadosPosConsulta } from './pos-consulta-fatos-autorizados.ts';

export function gerarRespostaPosConsultaFallback(fatos: FatosAutorizadosPosConsulta): string {
  switch (fatos.objetivo) {
    case 'perguntar_satisfacao':
      return 'Oi! Passando para saber: como foi sua experiência na sua última consulta?';

    case 'agradecer_e_convidar_avaliacao_google':
      return montarConviteFallback('Que ótimo saber disso, muito obrigado por compartilhar!', fatos.link_avaliacao_google);

    case 'agradecer_sem_convite':
      return 'Obrigado por compartilhar! Qualquer coisa, estamos à disposição.';
  }
}

// `link_avaliacao_google` SEMPRE presente na pratica neste objetivo
// (garantido pela elegibilidade antes de a jornada comecar) -- a ausencia
// aqui e tratada sem quebrar o turno, mas nunca deveria ocorrer.
function montarConviteFallback(abertura: string, link: string | undefined): string {
  if (link === undefined) return abertura;
  return `${abertura} Se puder, ficaríamos gratos por uma avaliação no Google: ${link}`;
}
