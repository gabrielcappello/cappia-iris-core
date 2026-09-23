// Guarda programatica da resposta da IA redatora de pos-consulta. Funcao
// pura de texto: nao chama IA, nao acessa banco. Mesmo espirito de
// guarda-resposta-redatora.ts -- so verifica o OBJETIVAMENTE verificavel,
// nunca reinterpreta linguagem (docs/00-principios.md, caso no 2).
//
// CORRECAO B7 (reviews/revisao-pos-consulta-conversacional-v1.md): a versao
// anterior so reprovava quando o TEXTO citava exatamente o valor de
// `fatos.link_avaliacao_google` -- mas esse campo fica AUSENTE dos fatos
// para objetivos que nao autorizam convite (por desenho, ver
// pos-consulta-fatos-autorizados.ts), entao no caminho REAL nao havia nada
// para comparar, e uma URL fabricada pela redatora atravessava sem ser
// detectada. A guarda agora detecta QUALQUER URL http(s) no texto, nao so a
// configurada -- quando o objetivo nao autoriza convite, nenhuma URL pode
// aparecer; quando autoriza, a UNICA URL aceita e exatamente a configurada.

import type { FatosAutorizadosPosConsulta } from './pos-consulta-fatos-autorizados.ts';

export type MotivoReprovacaoGuardaPosConsulta = 'texto_vazio' | 'link_nao_autorizado' | 'link_ausente';

export type ResultadoGuardaPosConsulta =
  | { aprovado: true }
  | { aprovado: false; motivo: MotivoReprovacaoGuardaPosConsulta };

// Revisao final do Codex (bloqueador 1): so existe UM objetivo que convida --
// o que so nasce depois de satisfacao positiva confirmada.
const OBJETIVOS_QUE_CONVIDAM: ReadonlySet<string> = new Set(['agradecer_e_convidar_avaliacao_google']);

// Captura qualquer URL http(s), greedy ate o proximo espaco -- depois
// aparada de pontuacao final comum (".", ",", ")", etc.) para nao falhar a
// comparacao so por causa de pontuacao de frase colada ao link.
const REGEX_URL = /\bhttps?:\/\/[^\s]+/gi;
const PONTUACAO_FINAL = /[).,;:!?\]}'"]+$/;

export function verificarRespostaRedatoraPosConsulta(
  texto: string,
  fatos: FatosAutorizadosPosConsulta
): ResultadoGuardaPosConsulta {
  if (texto.trim() === '') {
    return { aprovado: false, motivo: 'texto_vazio' };
  }

  const convida = OBJETIVOS_QUE_CONVIDAM.has(fatos.objetivo);
  const urlsCitadas = extrairUrls(texto);

  if (!convida) {
    // NENHUMA URL pode aparecer quando o objetivo nao autoriza convite --
    // independente de ela bater ou nao com algum link configurado em outro
    // turno. Objetivamente verificavel: presenca de URL, nunca julgamento
    // de conteudo.
    if (urlsCitadas.length > 0) {
      return { aprovado: false, motivo: 'link_nao_autorizado' };
    }
    return { aprovado: true };
  }

  // Objetivo AUTORIZA convite. Se o Core nao forneceu link (nao deveria
  // ocorrer no caminho real -- a elegibilidade garante link valido antes de
  // a jornada existir --, mas esta funcao nunca presume o caminho feliz):
  // nenhuma URL e autorizada, porque nao ha nada para autorizar.
  if (fatos.link_avaliacao_google === undefined) {
    if (urlsCitadas.length > 0) {
      return { aprovado: false, motivo: 'link_nao_autorizado' };
    }
    return { aprovado: false, motivo: 'link_ausente' };
  }

  const contemOutraUrl = urlsCitadas.some((url) => url !== fatos.link_avaliacao_google);
  if (contemOutraUrl) {
    return { aprovado: false, motivo: 'link_nao_autorizado' };
  }

  const contemLinkConfigurado = urlsCitadas.includes(fatos.link_avaliacao_google);
  if (!contemLinkConfigurado) {
    return { aprovado: false, motivo: 'link_ausente' };
  }

  return { aprovado: true };
}

function extrairUrls(texto: string): string[] {
  const achadas = texto.match(REGEX_URL) ?? [];
  return achadas.map((url) => url.replace(PONTUACAO_FINAL, ''));
}
