import type { AlteracoesDados } from './tipos.ts';
import type { Conflito, ResultadoPreAplicacao } from './interpretacao-tipos.ts';

/**
 * Funcao pura: nao acessa banco, nao tem efeito colateral. Decide, campo a
 * campo, se uma alteracao interpretada pode seguir para aplicarDados ou se
 * conflita com o valor ja acumulado na conversa.
 *
 * - informar em campo ausente: aplicavel.
 * - informar com o mesmo valor ja acumulado: aplicavel (idempotente).
 * - informar com valor diferente do acumulado: conflito — nunca escolhido
 *   silenciosamente, nunca descartado (o valor novo vai no conflito).
 * - corrigir: sempre aplicavel (autoriza substituicao).
 * - remover: sempre aplicavel (aplicarDados ja trata a idempotencia de
 *   remover campo inexistente).
 */
export function preAplicar(dadosAtuais: Record<string, string>, alteracoes: AlteracoesDados): ResultadoPreAplicacao {
  const alteracoesAplicaveis: AlteracoesDados = {};
  const conflitos: Conflito[] = [];

  for (const [campo, alteracao] of Object.entries(alteracoes)) {
    if (alteracao.acao !== 'informar') {
      // corrigir | remover
      alteracoesAplicaveis[campo] = alteracao;
      continue;
    }

    const existe = Object.prototype.hasOwnProperty.call(dadosAtuais, campo);
    if (!existe) {
      alteracoesAplicaveis[campo] = alteracao;
      continue;
    }

    const valorAtual = dadosAtuais[campo];
    if (valorAtual === alteracao.valor) {
      alteracoesAplicaveis[campo] = alteracao;
    } else {
      conflitos.push({
        campo,
        valor_atual: valorAtual,
        valor_informado: alteracao.valor as string,
      });
    }
  }

  return { alteracoes_aplicaveis: alteracoesAplicaveis, conflitos };
}
