import { aplicarDados, buscarEstadoConversa, validarContexto } from './aplicar-dados.ts';
import { EntradaInvalidaError } from './erros.ts';
import { extrairAlteracoes, validarDadosAtuais, validarMensagensAtuais } from './interpretacao-extrator.ts';
import { preAplicar } from './pre-aplicacao.ts';
import type { ClienteBancoDados, ContextoConversa, ResultadoAplicarDados } from './tipos.ts';
import type { ClienteModeloEstruturado, Conflito, ResultadoInterpretacao } from './interpretacao-tipos.ts';

export interface InterpretarEAplicarInput extends ContextoConversa {
  mensagens_atuais: string[];
}

const CHAVES_ENTRADA_INTEGRADA = ['conversa_id', 'clinica_id', 'telefone_normalizado', 'mensagens_atuais'] as const;

/**
 * Orquestracao minima: valida o contexto (reutilizando a validacao
 * canonica de aplicarDados e do extrator, sem duplicar regex de UUID nem
 * regra de telefone), busca o snapshot OFICIAL de estado_conversa (nunca
 * confia em dados_atuais fornecido pelo chamador — a entrada nem aceita
 * essa chave), interpreta a janela, pre-aplica os conflitos
 * deterministicamente, chama aplicarDados (ja existente) somente com as
 * alteracoes inicialmente aplicaveis, e reconcilia o resultado final com o
 * que aplicarDados realmente persistiu (cobre a janela de concorrencia
 * entre a leitura do snapshot e a chamada a aplicarDados). Nao duplica
 * persistencia nem controle de concorrencia — isso continua inteiramente
 * dentro de aplicarDados.
 */
export async function interpretarEAplicar(
  clienteModelo: ClienteModeloEstruturado,
  clienteBanco: ClienteBancoDados,
  entradaBruta: InterpretarEAplicarInput
): Promise<ResultadoInterpretacao> {
  validarFormaEntradaIntegrada(entradaBruta);
  const entrada = entradaBruta;

  // 1. validar o contexto antes de qualquer consulta ou chamada ao modelo.
  validarContexto(entrada);
  validarMensagensAtuais(entrada.mensagens_atuais);

  // 2-3. buscar estado_conversa oficial e obter dados diretamente da linha
  // (mesma consulta que aplicarDados usa — nunca o dados_atuais do chamador).
  const linhaOficial = await buscarEstadoConversa(clienteBanco, entrada);
  const snapshotOficial = (linhaOficial.dados as Record<string, string>) ?? {};

  // 4. validar que os dados oficiais respeitam os dez campos do contrato.
  validarDadosAtuais(snapshotOficial);

  // 5. enviar o snapshot oficial (nunca o do chamador) ao modelo.
  const saida = await extrairAlteracoes(clienteModelo, {
    mensagens_atuais: entrada.mensagens_atuais,
    dados_atuais: snapshotOficial,
  });

  // 6. pre-aplicacao deterministica usando o mesmo snapshot.
  const preAplicacao = preAplicar(snapshotOficial, saida.alteracoes);
  const conflitos: Conflito[] = [...preAplicacao.conflitos];
  let alteracoesAplicaveis = { ...preAplicacao.alteracoes_aplicaveis };

  // 7. chamar aplicarDados somente com as alteracoes inicialmente aplicaveis.
  let aplicacao: ResultadoAplicarDados | null = null;
  if (Object.keys(alteracoesAplicaveis).length > 0) {
    aplicacao = await aplicarDados(clienteBanco, {
      conversa_id: entrada.conversa_id,
      clinica_id: entrada.clinica_id,
      telefone_normalizado: entrada.telefone_normalizado,
      alteracoes: alteracoesAplicaveis,
    });

    // 8. reconciliar: entre a leitura do snapshot e aplicarDados, outra
    // operacao pode ter alterado a conversa. Um `informar` que o snapshot
    // considerava aplicavel (campo ausente ou com o mesmo valor) pode ter
    // sido preservado por aplicarDados porque o valor oficial mudou nesse
    // meio-tempo. Nesse caso vira conflito agora, com o valor oficial FINAL
    // (nunca o snapshot desatualizado) -- nunca escolhido nem descartado
    // silenciosamente.
    const camposJaEmConflito = new Set(conflitos.map((conflito) => conflito.campo));
    const camposParaRemoverDeAplicaveis: string[] = [];
    const dadosFinais = (aplicacao.dados as Record<string, string>) ?? {};

    for (const [campo, alteracao] of Object.entries(alteracoesAplicaveis)) {
      if (alteracao.acao !== 'informar') continue;
      if (!aplicacao.campos_preservados.includes(campo)) continue;
      if (camposJaEmConflito.has(campo)) continue;

      const valorFinal = dadosFinais[campo];
      if (valorFinal !== alteracao.valor) {
        conflitos.push({ campo, valor_atual: valorFinal, valor_informado: alteracao.valor as string });
        camposParaRemoverDeAplicaveis.push(campo);
      }
    }

    if (camposParaRemoverDeAplicaveis.length > 0) {
      alteracoesAplicaveis = Object.fromEntries(
        Object.entries(alteracoesAplicaveis).filter(([campo]) => !camposParaRemoverDeAplicaveis.includes(campo))
      );
    }
  }

  return {
    alteracoes_interpretadas: saida.alteracoes,
    alteracoes_aplicaveis: alteracoesAplicaveis,
    conflitos,
    aplicacao,
  };
}

function validarFormaEntradaIntegrada(entrada: unknown): asserts entrada is InterpretarEAplicarInput {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new EntradaInvalidaError('entrada', 'entrada deve ser um objeto');
  }

  // Entrada fechada: somente os quatro campos abaixo. `dados_atuais` (ou
  // qualquer outra chave) e tratado como propriedade extra e rejeitado --
  // o chamador nunca fornece o snapshot, ele e sempre lido do banco.
  const chaves = Object.keys(entrada as Record<string, unknown>);
  const chavesEsperadas: readonly string[] = CHAVES_ENTRADA_INTEGRADA;
  if (chaves.length !== chavesEsperadas.length || !chavesEsperadas.every((chave) => chaves.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada integrada contem propriedade nao permitida');
  }
}
