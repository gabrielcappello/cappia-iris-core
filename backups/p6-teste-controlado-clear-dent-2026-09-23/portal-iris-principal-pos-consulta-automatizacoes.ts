// Pós-consulta: leitura e construção do bloco `pos_consulta_*` dentro de
// `clinicas.automatizacoes` (jsonb, chaves PLANAS -- este é o contrato real,
// confirmado em cappia-iris-core (D1 da quarta revisão de
// reviews/revisao-pos-consulta-conversacional-v1.md), que antes havia sido
// inferido erradamente como um objeto aninhado `automatizacoes.pos_consulta`).
//
// Extraído de AutomacoesSection (dashboard/page.tsx) para poder testar o
// ciclo salvar → recarregar sem renderizar React (D2 da mesma revisão:
// "adicionar verificação do salvamento e recarregamento da configuração").
//
// `pos_consulta_mensagem` é orientação OPCIONAL de tom/estilo para a Iris
// redigir -- nunca uma frase fixa com placeholders. A Iris (cappia-iris-core,
// pos-consulta-redator-instrucoes.ts) já trata este campo assim: "use como
// referência de TOM e ESTILO -- nunca como um roteiro fixo".

export type ModoPosConsulta = 'satisfacao' | 'google' | 'ambos';
export type TempoPosConsulta = '2h' | '4h' | '24h';

export interface EstadoPosConsulta {
  posAtivo: boolean;
  posTipo: ModoPosConsulta;
  posLink: string;
  posTempo: TempoPosConsulta;
  posMensagem: string;
}

const MODOS_VALIDOS: readonly ModoPosConsulta[] = ['satisfacao', 'google', 'ambos'];
const TEMPOS_VALIDOS: readonly TempoPosConsulta[] = ['2h', '4h', '24h'];

function ehModoValido(v: unknown): v is ModoPosConsulta {
  return typeof v === 'string' && (MODOS_VALIDOS as readonly string[]).includes(v);
}

function ehTempoValido(v: unknown): v is TempoPosConsulta {
  return typeof v === 'string' && (TEMPOS_VALIDOS as readonly string[]).includes(v);
}

/** Deriva o estado dos controles do painel a partir do `automatizacoes` salvo. */
export function lerEstadoPosConsulta(automatizacoes: Record<string, unknown> | null | undefined): EstadoPosConsulta {
  const a = automatizacoes || {};
  const tipoBruto = a.pos_consulta_tipo;
  // So os 3 modos do vocabulario fechado ativam -- ausente, vazio, 'nenhum' ou
  // qualquer valor fora de satisfacao/google/ambos cai em desligado (revisao
  // final do Codex, P7: um valor invalido NUNCA pode ligar a automacao).
  const posAtivo = ehModoValido(tipoBruto);

  return {
    posAtivo,
    posTipo: ehModoValido(tipoBruto) ? tipoBruto : 'google',
    posLink: typeof a.pos_consulta_google_link === 'string' ? a.pos_consulta_google_link : '',
    posTempo: ehTempoValido(a.pos_consulta_tempo) ? a.pos_consulta_tempo : '2h',
    posMensagem: typeof a.pos_consulta_mensagem === 'string' ? a.pos_consulta_mensagem : '',
  };
}

/** Monta o `automatizacoes` a gravar, preservando as demais chaves já existentes. */
export function construirAutomatizacoesComPosConsulta(
  automatizacoesAtuais: Record<string, unknown>,
  estado: EstadoPosConsulta
): Record<string, unknown> {
  return {
    ...automatizacoesAtuais,
    pos_consulta_tipo: estado.posAtivo ? estado.posTipo : 'nenhum',
    pos_consulta_google_link: estado.posLink,
    pos_consulta_tempo: estado.posTempo,
    pos_consulta_mensagem: estado.posMensagem,
  };
}
