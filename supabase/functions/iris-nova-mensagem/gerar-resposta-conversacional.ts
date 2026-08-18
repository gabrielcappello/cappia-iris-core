// Orquestracao da resposta conversacional (specs/resposta-conversacional-v1.md).
// Funcao fina: deriva os fatos autorizados da decisao ja tomada pelo
// orquestrador, tenta a redacao natural via IA, verifica o resultado pela
// guarda, e cai no fallback deterministico (gerar-resposta-paciente.ts) em
// qualquer ponto de falha. Nao decide fluxo, nao acessa banco, nao chama o
// orquestrador -- recebe a DecisaoOrquestrador ja pronta, mesmo papel que
// gerar-resposta-paciente.ts sempre teve, so que agora com um caminho
// natural na frente dele.
//
// `motivo_fallback` e SEMPRE interno (telemetria) -- nunca aparece na
// resposta ao paciente, que recebe unicamente o fallback determinístico
// normal do estado (spec secao 4: "os fatos do Core estavam corretos, so a
// redacao falhou").

import { derivarFatosAutorizados } from './fatos-autorizados.ts';
import { verificarRespostaRedatora } from './guarda-resposta-redatora.ts';
import { gerarRespostaPaciente } from './gerar-resposta-paciente.ts';
import { INSTRUCOES_REDATOR } from './redator-instrucoes.ts';
import { historicoValidoParaEnvio } from './historico-conversa.ts';
import type { ClienteModeloRedator } from './cliente-modelo-redator-openai.ts';
import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';
import type { NaturezaMensagem } from './interpretacao-tipos.ts';
import type { CadastroPaciente, HistoricoConversa } from './tipos.ts';
import type { AgendamentoAtivo } from './buscar-agendamento-ativo.ts';

export type MotivoFallbackResposta = 'redator_nao_configurado' | 'falha_redatora' | 'texto_vazio' | 'horario_nao_autorizado';

export interface ResultadoRespostaConversacional {
  resposta: string;
  /** Nunca exposto ao paciente -- so para log/telemetria interna. */
  motivo_fallback: MotivoFallbackResposta | null;
}

import type { ClinicaConhecida } from './clinica-conhecida.ts';
import type { PrecosClinica } from './precos-clinica.ts';

export interface GerarRespostaConversacionalEntrada {
  decisao: DecisaoOrquestrador;
  mensagemPaciente: string;
  naturezaMensagem: NaturezaMensagem;
  nomeClinica?: string;
  /**
   * Dados da propria clinica (nome, endereco, maps_link, telefone, horario).
   * Sem isso a Iris nao sabia para quem trabalhava -- ver clinica-conhecida.ts.
   */
  clinicaConhecida?: ClinicaConhecida;
  /** Precos ja filtrados pelo consentimento da clinica (precos-clinica.ts). */
  precos?: PrecosClinica;
  /**
   * Valor CRU lido no inicio do turno (ResultadoOrquestrador.historico_conversa)
   * -- `null` quando nao ha nenhum turno anterior. O filtro de validade (24h)
   * e aplicado AQUI, no ponto de leitura para a redatora
   * (specs/historico-conversacional-v1.md secao 6), nunca antes.
   */
  historicoConversa: HistoricoConversa | null;
  /**
   * `ResultadoOrquestrador.substituicao_por_avaliacao`, quando presente
   * (specs/dentista-semantico-v1.md secao 5): o procedimento pedido cedeu
   * lugar a Consulta/Avaliacao para preservar o dentista escolhido. Vira
   * fato autorizado -- a troca dispensa nova pergunta de aceitacao, nunca o
   * dever de ser informada.
   */
  substituicaoPorAvaliacao?: { dentista_nome_exibido: string };
  /**
   * `ResultadoOrquestrador.agendamentos_do_paciente`, quando presente
   * (specs/consulta-agendamento-conversacional-v1.md): os agendamentos
   * futuros do paciente, disponibilizados a redatora como CONTEXTO.
   *
   * Mesmo papel de `substituicaoPorAvaliacao` acima -- fato do turno, nunca
   * estado nem decisao. So chega aqui em decisao conversacional; quem filtra
   * e o orquestrador.
   */
  agendamentosDoPaciente?: readonly AgendamentoAtivo[];

  /**
   * Cadastro ja conhecido do paciente -- a visao EFETIVA do turno (ficha do
   * banco combinada com o que ele acabou de informar).
   *
   * 2026-08-17: passa a atravessar ate a redatora, por decisao do Gabriel.
   * Antes ela so sabia QUAIS campos faltavam, entao nao conseguia conferir um
   * dado nem reconhecer quem ja tinha ficha.
   */
  cadastroConhecido?: CadastroPaciente;

  /**
   * `instante_atual.data` do turno (YYYY-MM-DD), a MESMA referencia que o Core
   * usou para resolver "hoje". Obrigatorio de proposito: sem ela a redatora
   * volta a DEDUZIR se a data proposta e hoje ou amanha -- foi assim que, em
   * 2026-08-14, uma proposta para hoje virou "amanha, 14/08".
   */
  dataHoje: string;
}

/**
 * `clienteRedator: null` cobre configuracao ausente (ex.: variavel de
 * ambiente nao definida) sem exigir que o chamador trate isso como erro
 * fatal -- cai direto no fallback deterministico, mesmo comportamento de
 * qualquer outra falha da redatora.
 */
export async function gerarRespostaConversacional(
  clienteRedator: ClienteModeloRedator | null,
  entrada: GerarRespostaConversacionalEntrada
): Promise<ResultadoRespostaConversacional> {
  const fatos = derivarFatosAutorizados(
    entrada.decisao,
    entrada.dataHoje,
    entrada.substituicaoPorAvaliacao,
    entrada.agendamentosDoPaciente,
    entrada.cadastroConhecido,
    entrada.clinicaConhecida,
    entrada.precos
  );
  const historicoParaEnvio = historicoValidoParaEnvio(entrada.historicoConversa, Date.now());

  if (clienteRedator === null) {
    return { resposta: gerarRespostaPaciente(entrada.decisao), motivo_fallback: 'redator_nao_configurado' };
  }

  let textoRedigido: string;
  try {
    textoRedigido = await clienteRedator.redigir({
      instrucoes: INSTRUCOES_REDATOR,
      mensagemPaciente: entrada.mensagemPaciente,
      naturezaMensagem: entrada.naturezaMensagem,
      fatos,
      ...(historicoParaEnvio !== undefined ? { historicoRecente: historicoParaEnvio } : {}),
      ...(entrada.nomeClinica !== undefined ? { nomeClinica: entrada.nomeClinica } : {}),
      // A data de hoje, para a Iris entender "quarta-feira"/"semana que vem"
      // e se situar no calendario (2026-08-17). A relacao que o Core informa
      // nos fatos continua prevalecendo sobre qualquer conta dela.
      dataHoje: entrada.dataHoje,
    });
  } catch {
    return { resposta: gerarRespostaPaciente(entrada.decisao), motivo_fallback: 'falha_redatora' };
  }

  const resultadoGuarda = verificarRespostaRedatora(textoRedigido, fatos);
  if (!resultadoGuarda.aprovado) {
    return { resposta: gerarRespostaPaciente(entrada.decisao), motivo_fallback: resultadoGuarda.motivo };
  }

  return { resposta: textoRedigido.trim(), motivo_fallback: null };
}
