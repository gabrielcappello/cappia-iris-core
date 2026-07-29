import { ACOES_PERMITIDAS, CAMPOS_PERMITIDOS, INTENCOES_PERMITIDAS, PERIODOS_PERMITIDOS } from './aplicar-dados.ts';
import { EntradaInvalidaError, InterpretacaoInvalidaError } from './erros.ts';
import { INSTRUCOES_EXTRATOR, SCHEMA_SAIDA_INTERPRETACAO } from './interpretacao-instrucoes.ts';
import type { AcaoAlteracaoDados, CampoDadosConversa } from './tipos.ts';
import type { ClienteModeloEstruturado, EntradaInterpretacao, SaidaInterpretacao } from './interpretacao-tipos.ts';

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

  const saidaBruta = await cliente.executar({
    instrucoes: INSTRUCOES_EXTRATOR,
    schema: SCHEMA_SAIDA_INTERPRETACAO,
    payload: entradaBruta,
  });

  validarSaidaInterpretacao(saidaBruta);
  return saidaBruta;
}

// --- Validacao da entrada (mensagens_atuais + dados_atuais) ---

export function validarEntradaInterpretacao(entrada: unknown): asserts entrada is EntradaInterpretacao {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new EntradaInvalidaError('entrada', 'entrada deve ser um objeto');
  }

  const { mensagens_atuais, dados_atuais } = entrada as Record<string, unknown>;
  validarMensagensAtuais(mensagens_atuais);
  validarDadosAtuais(dados_atuais);
}

function validarMensagensAtuais(mensagens: unknown): asserts mensagens is string[] {
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

function validarDadosAtuais(dadosAtuais: unknown): asserts dadosAtuais is Record<string, string> {
  if (dadosAtuais === null || typeof dadosAtuais !== 'object' || Array.isArray(dadosAtuais)) {
    throw new EntradaInvalidaError('dados_atuais', 'dados_atuais deve ser um objeto (nao nulo, nao array)');
  }
  for (const [campo, valor] of Object.entries(dadosAtuais as Record<string, unknown>)) {
    if (!CAMPOS_PERMITIDOS.includes(campo as CampoDadosConversa)) {
      throw new EntradaInvalidaError(campo, `campo '${campo}' nao e permitido em dados_atuais`);
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
  if (chavesNivelPrincipal.length !== 1 || chavesNivelPrincipal[0] !== 'alteracoes') {
    throw new InterpretacaoInvalidaError('propriedade_extra', 'saida');
  }

  const { alteracoes } = saida as { alteracoes: unknown };
  if (alteracoes === null || typeof alteracoes !== 'object' || Array.isArray(alteracoes)) {
    throw new InterpretacaoInvalidaError('alteracoes_invalida', 'saida.alteracoes');
  }

  for (const [campo, alteracao] of Object.entries(alteracoes as Record<string, unknown>)) {
    const caminhoCampo = `saida.alteracoes.${campo}`;

    if (!CAMPOS_PERMITIDOS.includes(campo as CampoDadosConversa)) {
      throw new InterpretacaoInvalidaError('campo_desconhecido', caminhoCampo);
    }
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
  }
}

function mesmasChaves(chaves: string[], esperadas: string[]): boolean {
  return chaves.length === esperadas.length && esperadas.every((chave) => chaves.includes(chave));
}
