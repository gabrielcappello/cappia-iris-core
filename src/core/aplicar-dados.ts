import { ConflitoConcorrenteError, ConversaNaoEncontradaError, EntradaInvalidaError } from './erros.ts';
import { telefoneNormalizadoValido } from './telefone.ts';
import type {
  AcaoAlteracaoDados,
  AlteracoesDados,
  AplicarDadosInput,
  CampoDadosConversa,
  ClienteBancoDados,
  ResultadoAplicarDados,
} from './tipos.ts';

const CAMPOS_PERMITIDOS: readonly CampoDadosConversa[] = [
  'intencao',
  'procedimento_texto',
  'dentista_texto',
  'data_texto',
  'periodo',
  'horario_texto',
  'nome',
  'cpf',
  'data_nascimento',
  'email',
];

const ACOES_PERMITIDAS: readonly AcaoAlteracaoDados[] = ['informar', 'corrigir', 'remover'];
const PERIODOS_PERMITIDOS = ['manha', 'tarde', 'noite'];
const INTENCOES_PERMITIDAS = ['novo_agendamento'];
const MAX_TENTATIVAS = 5;

interface LinhaEstadoConversa {
  id: string;
  dados: unknown;
  atualizado_em: string;
}

interface CalculoAlteracoes {
  dadosNovos: Record<string, string>;
  camposAdicionados: string[];
  camposCorrigidos: string[];
  camposRemovidos: string[];
  camposPreservados: string[];
}

/**
 * Aproveitamento estruturado dos dados ja interpretados (docs/06-roadmap.md,
 * item 2). Nao interpreta texto livre, nao chama IA, nao resolve
 * procedimento/dentista/data/horario para registros oficiais. So aplica
 * alteracoes ja estruturadas ao campo estado_conversa.dados, preservando o
 * que nao foi explicitamente informado/corrigido/removido nesta chamada.
 *
 * Concorrencia: controle otimista usando `atualizado_em` como versao (sem
 * alterar o schema). Cada tentativa le o estado atual, calcula o novo
 * `dados` e tenta o UPDATE condicionado a `atualizado_em` ainda ser igual
 * ao valor lido; se outra chamada already alterou a linha nesse intervalo,
 * o UPDATE nao afeta nenhuma linha, o estado e relido e as alteracoes sao
 * reaplicadas sobre o valor mais recente, ate MAX_TENTATIVAS.
 */
export async function aplicarDados(
  cliente: ClienteBancoDados,
  entrada: AplicarDadosInput
): Promise<ResultadoAplicarDados> {
  validarContexto(entrada);
  validarAlteracoes(entrada.alteracoes);

  let atual = await buscarEstadoConversa(cliente, entrada);

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const dadosAtuais = (atual.dados as Record<string, string>) ?? {};
    const calculo = calcularNovosDados(dadosAtuais, entrada.alteracoes);

    if (dadosIguais(calculo.dadosNovos, dadosAtuais)) {
      // Nenhuma mudanca real no JSON: nenhum UPDATE e executado, e
      // `atualizado_em` permanece o mesmo (cobre tanto `alteracoes: {}`
      // quanto acoes efetivamente idempotentes, informar repetido ou
      // remocao de campo inexistente).
      return montarResultado(atual.id, dadosAtuais, calculo);
    }

    const timestampLido = atual.atualizado_em;
    const novoTimestamp = proximoTimestamp(timestampLido);

    const { data: atualizado, error: erroUpdate } = await cliente
      .from('estado_conversa')
      .update({ dados: calculo.dadosNovos, atualizado_em: novoTimestamp })
      .eq('id', entrada.conversa_id)
      .eq('clinica_id', entrada.clinica_id)
      .eq('telefone_normalizado', entrada.telefone_normalizado)
      .eq('atualizado_em', timestampLido)
      .select('id, dados')
      .maybeSingle();

    if (erroUpdate) throw new Error(`falha ao atualizar dados da conversa: ${erroUpdate.message}`);

    if (atualizado) {
      const linha = atualizado as { id: string; dados: unknown };
      return montarResultado(linha.id, (linha.dados as Record<string, unknown>) ?? {}, calculo);
    }

    // Outra chamada alterou a conversa entre a leitura e esta tentativa
    // (atualizado_em nao bate mais): reler o estado mais recente e
    // reaplicar as alteracoes na proxima iteracao.
    atual = await buscarEstadoConversa(cliente, entrada);
  }

  throw new ConflitoConcorrenteError(MAX_TENTATIVAS);
}

function montarResultado(
  conversaId: string,
  dados: Record<string, unknown>,
  calculo: CalculoAlteracoes
): ResultadoAplicarDados {
  return {
    conversa_id: conversaId,
    dados,
    campos_adicionados: calculo.camposAdicionados,
    campos_corrigidos: calculo.camposCorrigidos,
    campos_removidos: calculo.camposRemovidos,
    campos_preservados: calculo.camposPreservados,
  };
}

async function buscarEstadoConversa(
  cliente: ClienteBancoDados,
  entrada: AplicarDadosInput
): Promise<LinhaEstadoConversa> {
  // Os tres identificadores devem casar simultaneamente na mesma linha —
  // nunca aceitar clinica_id vindo da IA ou do paciente: aqui ele e um
  // parametro do contexto ja identificado pelo Core, nunca parte de `alteracoes`.
  const { data, error } = await cliente
    .from('estado_conversa')
    .select('id, dados, atualizado_em')
    .eq('id', entrada.conversa_id)
    .eq('clinica_id', entrada.clinica_id)
    .eq('telefone_normalizado', entrada.telefone_normalizado)
    .maybeSingle();

  if (error) throw new Error(`falha ao buscar estado da conversa: ${error.message}`);
  if (!data) throw new ConversaNaoEncontradaError();
  return data as LinhaEstadoConversa;
}

function calcularNovosDados(dadosAtuais: Record<string, string>, alteracoes: AlteracoesDados): CalculoAlteracoes {
  const dadosNovos: Record<string, string> = { ...dadosAtuais };
  const camposAdicionados: string[] = [];
  const camposCorrigidos: string[] = [];
  const camposRemovidos: string[] = [];
  const camposPreservados: string[] = [];

  for (const [campo, alteracao] of Object.entries(alteracoes)) {
    const acao = alteracao.acao as AcaoAlteracaoDados;
    const jaExiste = Object.prototype.hasOwnProperty.call(dadosAtuais, campo);

    if (acao === 'remover') {
      if (jaExiste) {
        delete dadosNovos[campo];
        camposRemovidos.push(campo);
      } else {
        // nunca informar remocao de algo que nao existia.
        camposPreservados.push(campo);
      }
      continue;
    }

    if (acao === 'corrigir') {
      // corrigir e um sinal explicito e autoritativo: sempre substitui,
      // preservando todos os demais campos acumulados.
      dadosNovos[campo] = alteracao.valor as string;
      camposCorrigidos.push(campo);
      continue;
    }

    // acao === 'informar'
    if (!jaExiste) {
      dadosNovos[campo] = alteracao.valor as string;
      camposAdicionados.push(campo);
    } else {
      // mesmo valor (idempotente) ou valor diferente (nao substituir
      // silenciosamente): em ambos os casos o valor acumulado e preservado.
      camposPreservados.push(campo);
    }
  }

  return { dadosNovos, camposAdicionados, camposCorrigidos, camposRemovidos, camposPreservados };
}

function dadosIguais(a: Record<string, string>, b: Record<string, string>): boolean {
  const chavesA = Object.keys(a);
  const chavesB = Object.keys(b);
  if (chavesA.length !== chavesB.length) return false;
  return chavesA.every((chave) => a[chave] === b[chave]);
}

// Garante um novo `atualizado_em` estritamente diferente e posterior ao
// anterior, mesmo sob chamadas repetidas em sequencia rapida (retries) ou
// resolucao de relogio limitada.
function proximoTimestamp(anteriorIso: string): string {
  const anteriorMs = new Date(anteriorIso).getTime();
  const agoraMs = Date.now();
  const novoMs = agoraMs > anteriorMs ? agoraMs : anteriorMs + 1;
  return new Date(novoMs).toISOString();
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// `entrada` e tratada como `unknown` nos campos abaixo de proposito: sao
// identificadores que virao do contexto ja identificado pelo Core, mas o
// tipo estatico nao protege contra valores realmente invalidos em tempo de
// execucao (numero, boolean, objeto, array, null, undefined) — por isso a
// checagem de `typeof` sempre vem antes de qualquer `.trim()`.
function validarContexto(entrada: AplicarDadosInput): void {
  validarIdentificadorUuid('conversa_id', entrada.conversa_id as unknown);
  validarIdentificadorUuid('clinica_id', entrada.clinica_id as unknown);
  validarTelefoneDoContexto(entrada.telefone_normalizado as unknown);
}

function validarIdentificadorUuid(campo: string, valor: unknown): void {
  if (typeof valor !== 'string') {
    throw new EntradaInvalidaError(campo, `${campo} deve ser uma string`);
  }
  if (valor.trim() === '') {
    throw new EntradaInvalidaError(campo, `${campo} nao pode ser vazio`);
  }
  if (!UUID_REGEX.test(valor)) {
    throw new EntradaInvalidaError(campo, `${campo} deve estar no formato UUID valido`);
  }
}

function validarTelefoneDoContexto(valor: unknown): void {
  if (typeof valor !== 'string') {
    throw new EntradaInvalidaError('telefone_normalizado', 'telefone_normalizado deve ser uma string');
  }
  if (valor.trim() === '') {
    throw new EntradaInvalidaError('telefone_normalizado', 'telefone_normalizado nao pode ser vazio');
  }
  // reutiliza a mesma regra canonica do modulo de identificacao — nunca
  // duplicar o regex do formato brasileiro de telefone.
  if (!telefoneNormalizadoValido(valor)) {
    throw new EntradaInvalidaError(
      'telefone_normalizado',
      'telefone_normalizado fora do formato brasileiro canonico (55 + 10 ou 11 digitos)'
    );
  }
}

// Validacao completa de TODA a entrada antes de qualquer leitura ou
// escrita: se `alteracoes` nao for um objeto valido, ou qualquer campo/
// acao/valor for invalido, a chamada inteira e rejeitada e nada e
// persistido. `alteracoes` e tratado como `unknown` propositalmente aqui —
// e entrada produzida externamente (futuramente pela IA) e o tipo estatico
// nao protege contra valores realmente invalidos em tempo de execucao.
function validarAlteracoes(alteracoes: unknown): asserts alteracoes is AlteracoesDados {
  if (alteracoes === null || typeof alteracoes !== 'object' || Array.isArray(alteracoes)) {
    throw new EntradaInvalidaError('alteracoes', 'alteracoes deve ser um objeto (nao nulo, nao array)');
  }

  for (const [campo, alteracao] of Object.entries(alteracoes as Record<string, unknown>)) {
    if (!CAMPOS_PERMITIDOS.includes(campo as CampoDadosConversa)) {
      throw new EntradaInvalidaError(campo, `campo '${campo}' nao e permitido nesta etapa`);
    }
    if (alteracao === null || typeof alteracao !== 'object' || Array.isArray(alteracao)) {
      throw new EntradaInvalidaError(campo, `alteracao de '${campo}' deve ser um objeto com acao`);
    }

    const { acao, valor } = alteracao as { acao?: unknown; valor?: unknown };
    if (typeof acao !== 'string' || !ACOES_PERMITIDAS.includes(acao as AcaoAlteracaoDados)) {
      throw new EntradaInvalidaError(campo, `acao '${String(acao)}' nao e permitida para '${campo}'`);
    }

    if (acao === 'informar' || acao === 'corrigir') {
      if (typeof valor !== 'string' || valor.trim() === '') {
        throw new EntradaInvalidaError(campo, `valor de '${campo}' deve ser uma string nao vazia para a acao '${acao}'`);
      }
      if (campo === 'periodo' && !PERIODOS_PERMITIDOS.includes(valor)) {
        throw new EntradaInvalidaError(campo, `periodo '${valor}' invalido`);
      }
      if (campo === 'intencao' && !INTENCOES_PERMITIDAS.includes(valor)) {
        throw new EntradaInvalidaError(campo, `intencao '${valor}' invalida`);
      }
    }
  }
}
