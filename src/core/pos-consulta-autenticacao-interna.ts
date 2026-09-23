// Autenticacao INTERNA dedicada entre o n8n e a Edge Function
// iris-nova-pos-consulta (revisao final do Codex, bloqueador 3).
//
// POR QUE EXISTE: a Edge Function e chamada com a chave PUBLISHABLE do
// Supabase (`Authorization: Bearer <publishable>`), que so satisfaz o
// `verify_jwt` da plataforma. Essa chave e PUBLICA por desenho -- qualquer um
// que a tenha (ela vive no front e em workflows) alcancaria a funcao. Como a
// funcao autoriza envio de mensagem de WhatsApp a pacientes, "conhecer a
// publishable key" nao e autorizacao suficiente. Um SEGREDO PROPRIO, que so o
// n8n e a funcao conhecem, viaja num cabecalho dedicado e e exigido ANTES de
// qualquer leitura de corpo, de banco ou de OpenAI.
//
// Contrato:
//   - cabecalho: `x-iris-pos-consulta-segredo`;
//   - segredo esperado: variavel de ambiente da funcao
//     `POS_CONSULTA_SEGREDO_INTERNO` (Supabase secrets), com no MINIMO 32
//     caracteres -- segredo ausente ou curto FALHA FECHADO (a funcao recusa
//     tudo com 500 `configuracao_ausente`, nunca "aceita qualquer um");
//   - comparacao em TEMPO CONSTANTE (hash SHA-256 dos dois lados e XOR
//     acumulado dos 32 bytes), para nao vazar o segredo por diferenca de tempo.
//
// Funcao pura de decisao (sem I/O de banco/rede, sem ler `Deno.env` -- quem
// chama fornece os dois valores); assincrona so por causa do Web Crypto, que
// existe igual no Deno (Edge) e no Node (testes).

/** Cabecalho HTTP que carrega o segredo interno. */
export const CABECALHO_SEGREDO_INTERNO_POS_CONSULTA = 'x-iris-pos-consulta-segredo';

/** Variavel de ambiente (Supabase secret) que guarda o segredo esperado. */
export const VARIAVEL_SEGREDO_INTERNO_POS_CONSULTA = 'POS_CONSULTA_SEGREDO_INTERNO';

/** Tamanho minimo aceito para o segredo configurado (falha fechado abaixo disto). */
export const TAMANHO_MINIMO_SEGREDO_INTERNO_POS_CONSULTA = 32;

export type MotivoFalhaAutenticacaoInterna =
  // Configuracao do SERVIDOR invalida (segredo ausente ou curto) -- nao e culpa
  // do chamador; o handler responde 500 e nunca 401.
  | 'segredo_nao_configurado'
  // O chamador nao enviou o cabecalho.
  | 'cabecalho_ausente'
  // O chamador enviou um valor diferente do esperado.
  | 'segredo_invalido';

export type ResultadoAutenticacaoInterna = { autorizado: true } | { autorizado: false; motivo: MotivoFalhaAutenticacaoInterna };

async function sha256(texto: string): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return new Uint8Array(digest);
}

// XOR acumulado sobre TODOS os bytes -- nunca retorna cedo no primeiro byte
// diferente. Os dois lados ja tem o mesmo tamanho (SHA-256 = 32 bytes).
function iguaisEmTempoConstante(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a[i]! ^ b[i]!;
  return diferenca === 0;
}

/**
 * @param cabecalhoRecebido valor do cabecalho `x-iris-pos-consulta-segredo` da requisicao
 *   (`null`/`undefined` quando ausente).
 * @param segredoEsperado valor da variavel `POS_CONSULTA_SEGREDO_INTERNO` do servidor.
 */
export async function autenticarChamadaInternaPosConsulta(
  cabecalhoRecebido: string | null | undefined,
  segredoEsperado: string | null | undefined
): Promise<ResultadoAutenticacaoInterna> {
  // 1) A configuracao do servidor vem PRIMEIRO: sem segredo forte configurado,
  //    nada e autorizado -- nem mesmo quem "acertaria" um valor vazio.
  const esperado = typeof segredoEsperado === 'string' ? segredoEsperado.trim() : '';
  if (esperado.length < TAMANHO_MINIMO_SEGREDO_INTERNO_POS_CONSULTA) {
    return { autorizado: false, motivo: 'segredo_nao_configurado' };
  }

  // 2) O chamador precisa ter enviado o cabecalho.
  if (typeof cabecalhoRecebido !== 'string' || cabecalhoRecebido.trim() === '') {
    return { autorizado: false, motivo: 'cabecalho_ausente' };
  }

  // 3) Comparacao em tempo constante.
  const [recebido, correto] = await Promise.all([sha256(cabecalhoRecebido.trim()), sha256(esperado)]);
  return iguaisEmTempoConstante(recebido, correto)
    ? { autorizado: true }
    : { autorizado: false, motivo: 'segredo_invalido' };
}
