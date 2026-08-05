import { ACOES_PERMITIDAS, CAMPOS_PERMITIDOS, CONFIRMACOES_PERMITIDAS, INTENCOES_PERMITIDAS, PERIODOS_PERMITIDOS } from './aplicar-dados.ts';
import { EntradaInvalidaError, InterpretacaoInvalidaError } from './erros.ts';
import { INSTRUCOES_EXTRATOR, SCHEMA_SAIDA_INTERPRETACAO } from './interpretacao-instrucoes.ts';
import {
  CAMPOS_CADASTRAIS_INTERPRETACAO,
  CAMPOS_OPERACIONAIS_INTERPRETACAO,
  NATUREZAS_MENSAGEM_PERMITIDAS,
} from './interpretacao-tipos.ts';
import type { AcaoAlteracaoDados, CampoDadosConversa } from './tipos.ts';
import type {
  CampoCadastralInterpretacao,
  CampoOperacionalInterpretacao,
  ClienteModeloEstruturado,
  EntradaInterpretacao,
  NaturezaMensagem,
  SaidaInterpretacao,
  SnapshotOficialConversa,
} from './interpretacao-tipos.ts';

/**
 * Extrator estruturado: constroi a solicitacao aprovada (instrucoes +
 * schema fechado + payload), chama o cliente de modelo injetado, e valida
 * INTEGRALMENTE a resposta antes de devolve-la. Nenhuma aceitacao parcial:
 * qualquer violacao do contrato invalida a saida inteira.
 */
export async function extrairAlteracoes(
  cliente: ClienteModeloEstruturado,
  entradaBruta: unknown
): Promise<SaidaInterpretacao> {
  validarEntradaInterpretacao(entradaBruta);

  // Payload construido campo a campo a partir de listas FECHADAS --
  // nunca por spread nem por passagem direta do objeto recebido. Mesmo
  // que algo escapasse da validacao acima, um campo cadastral nao teria
  // por onde entrar em `dados_atuais`.
  const payload: EntradaInterpretacao = {
    mensagens_atuais: [...entradaBruta.mensagens_atuais],
    dados_atuais: selecionarCamposOperacionais(entradaBruta.dados_atuais),
    campos_cadastrais_preenchidos: [...entradaBruta.campos_cadastrais_preenchidos],
  };

  const saidaBruta = await cliente.executar({
    instrucoes: INSTRUCOES_EXTRATOR,
    schema: SCHEMA_SAIDA_INTERPRETACAO,
    payload,
  });

  validarSaidaInterpretacao(saidaBruta);
  return saidaBruta;
}

// --- Construcao minimizada do payload (specs/interpretacao-ia.md,
// "Entrada e PII") ---

/**
 * Deriva a entrada do modelo a partir do snapshot oficial, minimizando
 * PII: os campos operacionais seguem por valor; os campos cadastrais
 * viram apenas a indicacao de PRESENCA. Nenhum valor cadastral -- bruto,
 * formatado, normalizado, truncado ou mascarado -- atravessa esta funcao.
 */
export function construirEntradaMinimizada(
  mensagensAtuais: string[],
  snapshotOficial: SnapshotOficialConversa
): EntradaInterpretacao {
  return {
    mensagens_atuais: [...mensagensAtuais],
    dados_atuais: selecionarCamposOperacionais(snapshotOficial),
    campos_cadastrais_preenchidos: derivarCamposCadastraisPreenchidos(snapshotOficial),
  };
}

function selecionarCamposOperacionais(
  origem: Partial<Record<string, string>>
): Partial<Record<CampoOperacionalInterpretacao, string>> {
  const selecionados: Partial<Record<CampoOperacionalInterpretacao, string>> = {};
  for (const campo of CAMPOS_OPERACIONAIS_INTERPRETACAO) {
    const valor = origem[campo];
    if (typeof valor === 'string' && valor.trim() !== '') {
      selecionados[campo] = valor;
    }
  }
  return selecionados;
}

/**
 * Presenca, nunca valor. Um campo so conta como preenchido quando possui
 * string nao vazia apos trim -- string vazia ou so espacos e tratada como
 * ausente. A ordem segue a lista canonica, para ser deterministica.
 */
export function derivarCamposCadastraisPreenchidos(
  snapshotOficial: Partial<Record<string, string>>
): CampoCadastralInterpretacao[] {
  return CAMPOS_CADASTRAIS_INTERPRETACAO.filter((campo) => {
    const valor = snapshotOficial[campo];
    return typeof valor === 'string' && valor.trim() !== '';
  });
}

// --- Validacao da entrada (payload do modelo) ---

const CHAVES_ENTRADA_INTERPRETACAO = [
  'mensagens_atuais',
  'dados_atuais',
  'campos_cadastrais_preenchidos',
] as const;

export function validarEntradaInterpretacao(entrada: unknown): asserts entrada is EntradaInterpretacao {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new EntradaInvalidaError('entrada', 'entrada deve ser um objeto');
  }

  // Entrada fechada: somente as tres chaves do contrato sao aceitas.
  // Qualquer propriedade adicional (telefone, IDs, historico, etc.)
  // invalida a entrada inteira. O nome da propriedade desconhecida nunca e
  // reproduzido no erro.
  const chaves = Object.keys(entrada as Record<string, unknown>);
  const chavesEsperadas: readonly string[] = CHAVES_ENTRADA_INTERPRETACAO;
  if (chaves.length !== chavesEsperadas.length || !chavesEsperadas.every((chave) => chaves.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada contem propriedade nao permitida');
  }

  const { mensagens_atuais, dados_atuais, campos_cadastrais_preenchidos } = entrada as Record<string, unknown>;
  validarMensagensAtuais(mensagens_atuais);
  validarDadosAtuais(dados_atuais);
  validarCamposCadastraisPreenchidos(campos_cadastrais_preenchidos);
}

export function validarCamposCadastraisPreenchidos(
  campos: unknown
): asserts campos is CampoCadastralInterpretacao[] {
  if (!Array.isArray(campos)) {
    throw new EntradaInvalidaError(
      'campos_cadastrais_preenchidos',
      'campos_cadastrais_preenchidos deve ser um array'
    );
  }
  const vistos = new Set<string>();
  for (const campo of campos) {
    // Somente nomes de campo cadastral canonicos. Um valor (ex.: o CPF
    // em si) nunca pertence a esta lista -- e o nome bruto recebido nao e
    // reproduzido no erro, porque poderia ser justamente uma PII.
    if (typeof campo !== 'string' || !CAMPOS_CADASTRAIS_INTERPRETACAO.includes(campo as CampoCadastralInterpretacao)) {
      throw new EntradaInvalidaError(
        'campos_cadastrais_preenchidos',
        'campos_cadastrais_preenchidos contem campo nao permitido'
      );
    }
    if (vistos.has(campo)) {
      throw new EntradaInvalidaError(
        'campos_cadastrais_preenchidos',
        'campos_cadastrais_preenchidos contem campo repetido'
      );
    }
    vistos.add(campo);
  }
}

export function validarMensagensAtuais(mensagens: unknown): asserts mensagens is string[] {
  if (!Array.isArray(mensagens)) {
    throw new EntradaInvalidaError('mensagens_atuais', 'mensagens_atuais deve ser um array');
  }
  if (mensagens.length === 0) {
    throw new EntradaInvalidaError('mensagens_atuais', 'mensagens_atuais deve possuir pelo menos uma mensagem');
  }
  mensagens.forEach((mensagem, indice) => {
    if (typeof mensagem !== 'string') {
      throw new EntradaInvalidaError('mensagens_atuais', `mensagens_atuais[${indice}] deve ser string`);
    }
    if (mensagem.trim() === '') {
      throw new EntradaInvalidaError('mensagens_atuais', `mensagens_atuais[${indice}] nao pode ser vazia`);
    }
  });
  // A ordem recebida e preservada exatamente como esta (nenhuma
  // ordenacao/concatenacao/aplicacao separada acontece aqui nem em
  // extrairAlteracoes) — o array e repassado ao payload sem transformacao.
}

/**
 * Valida `dados_atuais` do PAYLOAD do modelo: somente os seis campos
 * operacionais. Um campo cadastral aqui e violacao do contrato de PII e
 * invalida a entrada inteira.
 */
export function validarDadosAtuais(
  dadosAtuais: unknown
): asserts dadosAtuais is Partial<Record<CampoOperacionalInterpretacao, string>> {
  validarMapaDeCampos(dadosAtuais, 'dados_atuais', CAMPOS_OPERACIONAIS_INTERPRETACAO);
}

/**
 * Valida o SNAPSHOT oficial lido de estado_conversa: os dez campos, com
 * valores cadastrais inclusive. Uso interno do servidor -- este objeto
 * alimenta preAplicar e a reconciliacao, e nunca e entregue ao modelo.
 */
export function validarSnapshotOficial(
  snapshot: unknown
): asserts snapshot is SnapshotOficialConversa {
  validarMapaDeCampos(snapshot, 'dados_atuais', CAMPOS_PERMITIDOS);
}

function validarMapaDeCampos(
  mapa: unknown,
  rotulo: string,
  camposAceitos: readonly string[]
): void {
  if (mapa === null || typeof mapa !== 'object' || Array.isArray(mapa)) {
    throw new EntradaInvalidaError(rotulo, `${rotulo} deve ser um objeto (nao nulo, nao array)`);
  }
  for (const [campo, valor] of Object.entries(mapa as Record<string, unknown>)) {
    // A chave bruta nunca deve aparecer aqui: este validator tambem roda
    // sobre o snapshot oficial do banco, entao uma chave desconhecida
    // poderia conter PII no proprio nome. Identificador generico fixo.
    if (!camposAceitos.includes(campo)) {
      throw new EntradaInvalidaError('campo_desconhecido', `${rotulo} contem campo nao permitido`);
    }
    if (typeof valor !== 'string' || valor.trim() === '') {
      throw new EntradaInvalidaError(campo, `valor de '${campo}' deve ser uma string nao vazia`);
    }
    if (campo === 'periodo' && !PERIODOS_PERMITIDOS.includes(valor)) {
      throw new EntradaInvalidaError(campo, `valor de '${campo}' invalido`);
    }
    if (campo === 'intencao' && !INTENCOES_PERMITIDAS.includes(valor)) {
      throw new EntradaInvalidaError(campo, `valor de '${campo}' invalido`);
    }
    if (campo === 'confirmacao' && !CONFIRMACOES_PERMITIDAS.includes(valor)) {
      throw new EntradaInvalidaError(campo, `valor de '${campo}' invalido`);
    }
  }
}

// --- Validacao integral da saida do modelo ---
//
// `codigo` e `caminho` sao construidos somente a partir de nomes de campo
// fixos ou nomes de chave recebidos (nunca valores) — nunca incluir o
// conteudo bruto retornado pelo modelo no erro.

export function validarSaidaInterpretacao(saida: unknown): asserts saida is SaidaInterpretacao {
  if (saida === null || typeof saida !== 'object' || Array.isArray(saida)) {
    throw new InterpretacaoInvalidaError('saida_invalida', 'saida');
  }

  const chavesNivelPrincipal = Object.keys(saida as Record<string, unknown>);
  if (!mesmasChaves(chavesNivelPrincipal, ['natureza_mensagem', 'alteracoes'])) {
    throw new InterpretacaoInvalidaError('propriedade_extra', 'saida');
  }

  const { natureza_mensagem, alteracoes } = saida as { natureza_mensagem: unknown; alteracoes: unknown };
  if (
    typeof natureza_mensagem !== 'string' ||
    !NATUREZAS_MENSAGEM_PERMITIDAS.includes(natureza_mensagem as NaturezaMensagem)
  ) {
    throw new InterpretacaoInvalidaError('natureza_mensagem_invalida', 'saida.natureza_mensagem');
  }
  if (alteracoes === null || typeof alteracoes !== 'object' || Array.isArray(alteracoes)) {
    throw new InterpretacaoInvalidaError('alteracoes_invalida', 'saida.alteracoes');
  }

  for (const [campo, alteracao] of Object.entries(alteracoes as Record<string, unknown>)) {
    // A chave bruta `campo` nunca deve aparecer em nenhum erro: se ela nao
    // for um dos dez campos canonicos (fixos, sem PII), usamos um caminho
    // generico em vez de interpolar o nome recebido do modelo.
    if (!CAMPOS_PERMITIDOS.includes(campo as CampoDadosConversa)) {
      throw new InterpretacaoInvalidaError('campo_desconhecido', 'saida.alteracoes.campo_desconhecido');
    }

    const caminhoCampo = `saida.alteracoes.${campo}`;
    if (alteracao === null || typeof alteracao !== 'object' || Array.isArray(alteracao)) {
      throw new InterpretacaoInvalidaError('alteracao_invalida', caminhoCampo);
    }

    const chavesAlteracao = Object.keys(alteracao as Record<string, unknown>);
    const { acao, valor } = alteracao as { acao?: unknown; valor?: unknown };

    if (typeof acao !== 'string' || !ACOES_PERMITIDAS.includes(acao as AcaoAlteracaoDados)) {
      throw new InterpretacaoInvalidaError('acao_desconhecida', `${caminhoCampo}.acao`);
    }

    if (acao === 'remover') {
      if (!mesmasChaves(chavesAlteracao, ['acao'])) {
        throw new InterpretacaoInvalidaError('propriedade_extra', caminhoCampo);
      }
      continue;
    }

    // acao === 'informar' | 'corrigir'
    if (!mesmasChaves(chavesAlteracao, ['acao', 'valor'])) {
      throw new InterpretacaoInvalidaError('propriedade_extra', caminhoCampo);
    }
    if (typeof valor !== 'string' || valor.trim() === '') {
      throw new InterpretacaoInvalidaError('valor_invalido', `${caminhoCampo}.valor`);
    }
    if (campo === 'periodo' && !PERIODOS_PERMITIDOS.includes(valor)) {
      throw new InterpretacaoInvalidaError('valor_fora_do_dominio', `${caminhoCampo}.valor`);
    }
    if (campo === 'intencao' && !INTENCOES_PERMITIDAS.includes(valor)) {
      throw new InterpretacaoInvalidaError('valor_fora_do_dominio', `${caminhoCampo}.valor`);
    }
    if (campo === 'confirmacao' && !CONFIRMACOES_PERMITIDAS.includes(valor)) {
      throw new InterpretacaoInvalidaError('valor_fora_do_dominio', `${caminhoCampo}.valor`);
    }
  }
}

function mesmasChaves(chaves: string[], esperadas: string[]): boolean {
  return chaves.length === esperadas.length && esperadas.every((chave) => chaves.includes(chave));
}
