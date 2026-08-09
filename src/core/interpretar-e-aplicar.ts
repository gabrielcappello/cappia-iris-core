import { aplicarDados, buscarEstadoConversa, validarContexto } from './aplicar-dados.ts';
import { EntradaInvalidaError } from './erros.ts';
import {
  construirEntradaMinimizada,
  extrairAlteracoes,
  validarMensagensAtuais,
  validarSnapshotOficial,
} from './interpretacao-extrator.ts';
import { preAplicar } from './pre-aplicacao.ts';
import type { ClienteBancoDados, ContextoConversa, ParConversa, ResultadoAplicarDados } from './tipos.ts';
import type {
  ClienteModeloEstruturado,
  Conflito,
  ResultadoInterpretacao,
  SnapshotOficialConversa,
} from './interpretacao-tipos.ts';

export interface InterpretarEAplicarInput extends ContextoConversa {
  mensagens_atuais: string[];
  /**
   * Horarios ja apresentados ao paciente na ultima pergunta gerada
   * (contexto-horarios.ts). Repassado a IA como contexto de interpretacao;
   * nunca influencia persistencia, disponibilidade ou reserva.
   */
  horarios_oferecidos?: string[];
  /**
   * Proposta concreta (data + horario) que o Core apresentou ao paciente na
   * ultima pergunta gerada, aguardando confirmacao (contexto-horarios.ts,
   * acao `propor`). Repassado a IA para a regra de confirmacao por
   * significado (specs/resposta-conversacional-v1.md secao 5); nunca
   * influencia persistencia, disponibilidade ou reserva.
   */
  proposta_pendente?: { data: string; horario: string };
  /**
   * Ultimos turnos da conversa (contexto-horarios.ts padrao, historico-
   * conversa.ts), ja filtrados por validade. Repassado a IA como contexto de
   * interpretacao (specs/historico-conversacional-v1.md secao 6); nunca
   * influencia persistencia, disponibilidade ou reserva.
   */
  historico_recente?: ParConversa[];
  /**
   * Catalogo ativo minimo da clinica (specs/procedimento-semantico-v1.md).
   * Repassado a IA para que ela resolva o pedido do paciente diretamente
   * para `procedimento_id`; nunca influencia persistencia, disponibilidade
   * ou reserva -- a integridade do ID e conferida depois pelo Core.
   */
  procedimentos_disponiveis?: { procedimento_id: string; nome_pt: string }[];
}

const CHAVES_ENTRADA_INTEGRADA = ['conversa_id', 'clinica_id', 'telefone_normalizado', 'mensagens_atuais'] as const;
const CHAVES_OPCIONAIS_INTEGRADA = [
  'horarios_oferecidos',
  'proposta_pendente',
  'historico_recente',
  'procedimentos_disponiveis',
] as const;

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
  const snapshotOficial = (linhaOficial.dados as SnapshotOficialConversa) ?? {};

  // 4. validar que os dados oficiais respeitam os dez campos do contrato.
  validarSnapshotOficial(snapshotOficial);

  // 5. derivar do snapshot oficial APENAS o contexto autorizado e enviar
  // ao modelo. Os campos operacionais seguem por valor; os cadastrais
  // (nome, cpf, data_nascimento, email) seguem somente como indicacao de
  // presenca -- nenhum valor cadastral atravessa esta fronteira
  // (specs/interpretacao-ia.md, "Entrada e PII"; cenarios INT-11/INT-12).
  // O snapshot completo permanece no servidor, para preAplicar e para a
  // reconciliacao adiante.
  const saida = await extrairAlteracoes(
    clienteModelo,
    construirEntradaMinimizada(
      entrada.mensagens_atuais,
      snapshotOficial,
      entrada.horarios_oferecidos,
      entrada.proposta_pendente,
      entrada.historico_recente,
      entrada.procedimentos_disponiveis
    )
  );

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
    natureza_mensagem: saida.natureza_mensagem,
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

  // Entrada fechada: somente os quatro campos obrigatorios mais
  // `horarios_oferecidos` (opcional). `dados_atuais` (ou qualquer outra
  // chave) e tratado como propriedade extra e rejeitado -- o chamador nunca
  // fornece o snapshot de dados, ele e sempre lido do banco.
  const chaves = Object.keys(entrada as Record<string, unknown>);
  const obrigatorias: readonly string[] = CHAVES_ENTRADA_INTEGRADA;
  const permitidas: readonly string[] = [...CHAVES_ENTRADA_INTEGRADA, ...CHAVES_OPCIONAIS_INTEGRADA];
  if (!obrigatorias.every((chave) => chaves.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada integrada nao contem todas as chaves obrigatorias');
  }
  if (!chaves.every((chave) => permitidas.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada integrada contem propriedade nao permitida');
  }
}
