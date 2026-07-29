import { aplicarDados } from './aplicar-dados.ts';
import { extrairAlteracoes } from './interpretacao-extrator.ts';
import { preAplicar } from './pre-aplicacao.ts';
import type { ClienteBancoDados, ResultadoAplicarDados } from './tipos.ts';
import type { ClienteModeloEstruturado, ResultadoInterpretacao } from './interpretacao-tipos.ts';

export interface InterpretarEAplicarInput {
  conversa_id: string;
  clinica_id: string;
  telefone_normalizado: string;
  mensagens_atuais: string[];
  dados_atuais: Record<string, string>;
}

/**
 * Orquestracao minima: interpreta a janela de mensagens, valida
 * integralmente a saida, pre-aplica os conflitos deterministicamente, e so
 * entao chama aplicarDados (ja existente) com as alteracoes sem conflito.
 * Nao duplica a logica de persistencia/concorrencia — isso continua
 * inteiramente dentro de aplicarDados.
 */
export async function interpretarEAplicar(
  clienteModelo: ClienteModeloEstruturado,
  clienteBanco: ClienteBancoDados,
  entrada: InterpretarEAplicarInput
): Promise<ResultadoInterpretacao> {
  const saida = await extrairAlteracoes(clienteModelo, {
    mensagens_atuais: entrada.mensagens_atuais,
    dados_atuais: entrada.dados_atuais,
  });

  const { alteracoes_aplicaveis, conflitos } = preAplicar(entrada.dados_atuais, saida.alteracoes);

  let aplicacao: ResultadoAplicarDados | null = null;
  if (Object.keys(alteracoes_aplicaveis).length > 0) {
    aplicacao = await aplicarDados(clienteBanco, {
      conversa_id: entrada.conversa_id,
      clinica_id: entrada.clinica_id,
      telefone_normalizado: entrada.telefone_normalizado,
      alteracoes: alteracoes_aplicaveis,
    });
  }

  return {
    alteracoes_interpretadas: saida.alteracoes,
    alteracoes_aplicaveis,
    conflitos,
    aplicacao,
  };
}
