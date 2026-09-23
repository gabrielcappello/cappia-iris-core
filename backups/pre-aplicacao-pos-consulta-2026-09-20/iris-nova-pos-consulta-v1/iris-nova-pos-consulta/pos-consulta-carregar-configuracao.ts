// Carrega a configuracao VIGENTE de pos-consulta da clinica, em fonte
// autoritativa -- correcao C2 da terceira revisao
// (reviews/revisao-pos-consulta-conversacional-v1.md): a Edge Function
// iris-nova-pos-consulta nao deve mais confiar em `modo`/`prazo_minutos`/
// `link_avaliacao_google` enviados pelo n8n -- a clinica pode ter mudado a
// configuracao entre o n8n ler o painel e esta chamada executar (spec
// secao 5, criterio de aceite 8: "alterar a configuracao apos iniciar uma
// jornada nao muda o modo capturado" -- isso protege jornada JA ABERTA; a
// releitura aqui protege a DECISAO DE ABRIR uma jornada nova).
//
// FONTE E FORMATO -- CORRIGIDO NA QUARTA REVISAO (D1,
// reviews/revisao-pos-consulta-conversacional-v1.md): a primeira versao
// deste arquivo inferiu um objeto aninhado `automatizacoes.pos_consulta.*`
// que NUNCA existiu no painel real. O contrato confirmado, lido direto de
// `portal-iris-principal/src/app/dashboard/page.tsx` (funcao
// `AutomacoesSection`, onde o painel LE e GRAVA `automatizacoes`), sao
// quatro chaves PLANAS dentro do mesmo jsonb `clinicas.automatizacoes`
// (mesma coluna ja usada por `derivarExigirEmail` em carregar-catalogo.ts
// para `solicitar_email` -- continua sendo o precedente do mecanismo, so
// nao do formato aninhado):
//
//   automatizacoes.pos_consulta_tipo          -- 'nenhum' | 'satisfacao' | 'google' | 'ambos'
//   automatizacoes.pos_consulta_tempo         -- STRING '2h' | '4h' | '24h' (nao numero em minutos)
//   automatizacoes.pos_consulta_google_link   -- string (URL), opcional
//   automatizacoes.pos_consulta_mensagem      -- string, OPCIONAL e livre -- orientacao de
//                                                 tom/estilo para a Iris redigir, nunca uma frase
//                                                 fixa a ser inserida literalmente (o painel
//                                                 tratava isso como "mensagem personalizada" com
//                                                 placeholders {nome}/{clinica}/{link}; a decisao
//                                                 da spec e dar liberdade de redacao a Iris -- ver
//                                                 D2 da quarta revisao e a correcao feita em
//                                                 portal-iris-principal na mesma frente). Este
//                                                 campo so chega ao redator como
//                                                 "orientacoes_clinica" (pos-consulta-redator-
//                                                 instrucoes.ts): "use como referencia de TOM e
//                                                 ESTILO -- nunca como um roteiro fixo".
//
// `pos_consulta_tempo` e convertido deterministicamente para minutos
// (PRAZO_MINUTOS_POR_TEMPO abaixo) -- qualquer valor fora do vocabulario
// fechado ('2h'/'4h'/'24h') desliga a configuracao inteira, nunca cai num
// prazo default silencioso.
//
// FALHA PARA 'nenhum' DE PROPOSITO (mesma disciplina de derivarExigirEmail):
// ausente, malformada, ou com QUALQUER campo obrigatorio invalido -> modo
// 'nenhum' inteiro, nunca um valor parcialmente aproveitado. A obrigacao de
// rodar pos-consulta precisa ser AFIRMATIVA e INTEIRA.

import type { ClienteBancoDados } from './tipos.ts';
import type { ModoPosConsulta } from './pos-consulta-tipos.ts';

export interface ConfiguracaoPosConsultaCarregada {
  modo: ModoPosConsulta;
  prazoMinutos: number;
  linkAvaliacaoGoogle?: string;
  orientacoes?: string;
}

const MODOS_VALIDOS: readonly string[] = ['satisfacao', 'google', 'ambos'];
const PRAZO_MINUTOS_POR_TEMPO: Readonly<Record<string, number>> = { '2h': 120, '4h': 240, '24h': 1440 };
const CONFIGURACAO_DESLIGADA: ConfiguracaoPosConsultaCarregada = { modo: 'nenhum', prazoMinutos: 0 };

export async function carregarConfiguracaoPosConsulta(
  cliente: ClienteBancoDados,
  clinicaId: string
): Promise<ConfiguracaoPosConsultaCarregada> {
  const { data, error } = await cliente.from('clinicas').select('automatizacoes').eq('id', clinicaId).maybeSingle();
  if (error) throw new Error(`falha ao carregar configuracao de pos-consulta: ${error.message}`);
  if (!data) return CONFIGURACAO_DESLIGADA;

  return derivarConfiguracaoPosConsulta((data as Record<string, unknown>).automatizacoes);
}

/** Extraida para ser testavel sem banco -- mesma forma de derivarExigirEmail. */
export function derivarConfiguracaoPosConsulta(automatizacoes: unknown): ConfiguracaoPosConsultaCarregada {
  if (automatizacoes === null || typeof automatizacoes !== 'object' || Array.isArray(automatizacoes)) {
    return CONFIGURACAO_DESLIGADA;
  }
  const a = automatizacoes as Record<string, unknown>;
  const modo = a.pos_consulta_tipo;

  // Inclui o caso explicito 'nenhum' que o painel grava quando o toggle esta
  // desligado (page.tsx: `pos_consulta_tipo: posAtivo ? posTipo : 'nenhum'`).
  if (typeof modo !== 'string' || !MODOS_VALIDOS.includes(modo)) {
    return CONFIGURACAO_DESLIGADA;
  }

  const tempo = a.pos_consulta_tempo;
  if (typeof tempo !== 'string' || !Object.prototype.hasOwnProperty.call(PRAZO_MINUTOS_POR_TEMPO, tempo)) {
    return CONFIGURACAO_DESLIGADA;
  }
  const prazoMinutos = PRAZO_MINUTOS_POR_TEMPO[tempo]!;

  const linkAvaliacaoGoogle =
    typeof a.pos_consulta_google_link === 'string' && a.pos_consulta_google_link.trim() !== ''
      ? a.pos_consulta_google_link
      : undefined;
  const orientacoes =
    typeof a.pos_consulta_mensagem === 'string' && a.pos_consulta_mensagem.trim() !== ''
      ? a.pos_consulta_mensagem
      : undefined;

  return {
    modo: modo as ModoPosConsulta,
    prazoMinutos,
    ...(linkAvaliacaoGoogle !== undefined ? { linkAvaliacaoGoogle } : {}),
    ...(orientacoes !== undefined ? { orientacoes } : {}),
  };
}
