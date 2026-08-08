import { identificarConversa } from './identificacao.ts';
import { interpretarEAplicar } from './interpretar-e-aplicar.ts';
import { textoAusenteParaResolucao } from './normalizacao-texto.ts';
import { resolverProcedimento } from './resolver-procedimento.ts';
import { resolverDentista } from './resolver-dentista.ts';
import { resolverDuracao } from './resolver-duracao.ts';
import { montarFatosTemporais } from './montar-fatos-temporais.ts';
import { resolverTemporal } from './resolver-temporal.ts';
import { carregarEntradaDisponibilidade } from './carregar-disponibilidade.ts';
import { carregarCatalogo } from './carregar-catalogo.ts';
import { reservarAgendamento } from './reservar-agendamento.ts';
import { derivarAcaoContextoHorarios, gravarContextoHorarios } from './contexto-horarios.ts';
import { historicoValidoParaEnvio } from './historico-conversa.ts';
import type { ClienteBancoDados } from './tipos.ts';
import type { ClienteModeloEstruturado, NaturezaMensagem } from './interpretacao-tipos.ts';
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';
import type { InstanteAtual, ModoConsulta, OpcaoHorario } from './disponibilidade-tipos.ts';
import type { ResolucaoTemporalOficial } from './temporal-tipos.ts';
import type { CatalogoClinica, DecisaoOrquestrador, EntradaOrquestrador, ResultadoOrquestrador } from './orquestrador-tipos.ts';

/**
 * Orquestrador minimo do primeiro fluxo: identificacao -> interpretacao ->
 * resolvedores de dominio ja publicados -> resolucao temporal (fatia minima)
 * -> disponibilidade real -> confirmacao explicita -> reserva
 * (cappia_reservar_agendamento, RPC ja em producao, ver orquestrador-tipos.ts).
 * Ver orquestrador-tipos.ts para o vocabulario temporal exato coberto e o
 * que fica de fora por decisao do Gabriel.
 *
 * Nao gera texto de resposta ao paciente (redacao/NLG e P5, fora de escopo)
 * -- devolve uma decisao estruturada para o chamador formatar. Nao toca
 * remarcacao, cancelamento, consulta de agendamento, outbox nem cadastro de
 * paciente novo (ver decisao 'cadastro_necessario').
 */
export async function processarMensagem(
  clienteModelo: ClienteModeloEstruturado,
  clienteBanco: ClienteBancoDados,
  clienteRpc: ClienteRpc,
  entrada: EntradaOrquestrador
): Promise<ResultadoOrquestrador> {
  const identificacao = await identificarConversa(clienteBanco, {
    provider: entrada.provider,
    instancia_whatsapp: entrada.instancia_whatsapp,
    telefone_normalizado: entrada.telefone_normalizado,
  });

  // Filtro de validade (24h) aplicado AQUI, no ponto de leitura para a
  // interpretadora (specs/historico-conversacional-v1.md secao 6) -- o
  // valor cru (sem filtro) e o que segue para ResultadoOrquestrador.historico_conversa,
  // usado depois na gravacao (seção 3 da mesma spec).
  const historicoParaInterpretacao = historicoValidoParaEnvio(identificacao.conversa.historico_conversa, Date.now());

  const interpretacao = await interpretarEAplicar(clienteModelo, clienteBanco, {
    conversa_id: identificacao.conversa.id,
    clinica_id: identificacao.clinica_id,
    telefone_normalizado: entrada.telefone_normalizado,
    mensagens_atuais: entrada.mensagens_atuais,
    // Horarios ja oferecidos na ultima pergunta gerada, quando houver --
    // contexto de interpretacao, nunca fonte de disponibilidade
    // (specs/contexto-pendente-interpretacao-v1.md). `horarios` e opcional
    // no snapshot desde specs/resposta-conversacional-v1.md secao 5 --
    // ausente quando o snapshot representa so uma `proposta_pendente`.
    ...(identificacao.conversa.contexto_horarios?.horarios !== undefined
      ? { horarios_oferecidos: identificacao.conversa.contexto_horarios.horarios }
      : {}),
    // Proposta concreta aguardando confirmacao, quando houver -- e o que
    // permite a IA reconhecer "pode confirmar"/"esse mesmo" como resposta a
    // ELA especificamente (specs/resposta-conversacional-v1.md secao 5).
    ...(identificacao.conversa.contexto_horarios?.proposta_pendente !== undefined
      ? { proposta_pendente: identificacao.conversa.contexto_horarios.proposta_pendente }
      : {}),
    // Ultimos turnos da conversa, quando houver algum dentro da janela de
    // validade -- reversao declarada de memoria-conversacional-minima-v1.md
    // (specs/historico-conversacional-v1.md secao 6): a interpretadora
    // passa a receber contexto, nunca so a mensagem atual isolada.
    ...(historicoParaInterpretacao !== undefined ? { historico_recente: historicoParaInterpretacao } : {}),
  });

  // `atualizado_em` EXATO do estado sobre o qual a decisao desta mensagem
  // sera calculada: o valor apos aplicarDados quando houve aplicacao, ou o
  // lido na identificacao quando nada foi aplicado. Nunca relido antes do
  // UPDATE do snapshot -- reler rebasearia uma operacao obsoleta sobre um
  // estado novo (spec secao 5).
  const atualizadoEmDaDecisao = interpretacao.aplicacao?.atualizado_em ?? identificacao.conversa.atualizado_em;

  // aplicacao.dados so vem preenchido quando houve pelo menos uma alteracao
  // aplicavel (interpretar-e-aplicar.ts); sem isso, o snapshot ja
  // identificado continua sendo o oficial.
  const dados = (interpretacao.aplicacao?.dados ?? identificacao.conversa.dados) as Record<string, string | undefined>;

  // natureza_mensagem (specs/interpretacao-natureza-mensagem-v1.md) so
  // decide a acao comunicativa quando esta mensagem nao produziu nenhuma
  // alteracao -- `alteracoes` sempre tem precedencia sobre
  // `natureza_mensagem` para a evolucao do fluxo (mesma spec, secao 3).
  // Nao consulta catalogo, nao muda `dados`: puramente conversacional.
  // Todo desfecho passa por aqui: grava o snapshot de horarios derivado da
  // decisao final e so entao devolve o resultado. A gravacao e auxiliar e
  // best-effort por contrato -- nunca lanca, nunca altera a decisao ja
  // tomada, nunca afeta a resposta ao paciente.
  const finalizar = async (decisao: DecisaoOrquestrador): Promise<ResultadoOrquestrador> => {
    const atualizadoEmFinal = await gravarContextoHorarios(clienteBanco, {
      conversa_id: identificacao.conversa.id,
      clinica_id: identificacao.clinica_id,
      telefone_normalizado: entrada.telefone_normalizado,
      atualizado_em_da_decisao: atualizadoEmDaDecisao,
      acao: derivarAcaoContextoHorarios(decisao),
    });

    return {
      clinica_id: identificacao.clinica_id,
      conversa_id: identificacao.conversa.id,
      conflitos: interpretacao.conflitos,
      decisao,
      atualizado_em: atualizadoEmFinal,
      natureza_mensagem: interpretacao.natureza_mensagem,
      historico_conversa: identificacao.conversa.historico_conversa,
    };
  };

  if (Object.keys(interpretacao.alteracoes_interpretadas).length === 0) {
    const decisaoConversacional = decidirPorNatureza(interpretacao.natureza_mensagem, dados);
    if (decisaoConversacional !== null) {
      return await finalizar(decisaoConversacional);
    }
  }

  const catalogoCarregado = await carregarCatalogo(clienteBanco, { clinica_id: identificacao.clinica_id });
  if (catalogoCarregado.tipo !== 'carregado') {
    return await finalizar({ tipo: 'clinica_sem_catalogo' });
  }

  return await finalizar(
    await decidir(
      clienteBanco,
      clienteRpc,
      identificacao.clinica_id,
      identificacao.paciente.id,
      entrada.telefone_normalizado,
      dados,
      catalogoCarregado.catalogo,
      entrada.instante_atual
    )
  );
}

/**
 * Traduz `natureza_mensagem` (specs/interpretacao-natureza-mensagem-v1.md)
 * numa decisao conversacional, ou `null` quando a mensagem deve seguir
 * pelo caminho normal de resolucao (nenhuma acao conversacional
 * autorizada para este caso). So chamada quando `alteracoes` desta
 * mensagem ja esta vazio (processarMensagem) -- nunca decide nada sobre
 * procedimento, dentista, duracao, disponibilidade ou reserva.
 */
function decidirPorNatureza(
  natureza: NaturezaMensagem,
  dados: Record<string, string | undefined>
): DecisaoOrquestrador | null {
  switch (natureza) {
    case 'saudacao':
      // So cumprimenta se ainda nao ha procedimento conhecido nesta
      // conversa (de qualquer mensagem anterior) -- uma saudacao no meio
      // de um fluxo em andamento nunca o reabre.
      return textoAusenteParaResolucao(dados.procedimento_texto) ? { tipo: 'saudacao' } : null;
    case 'duvida':
      // So acolhe como duvida livre se ainda nao ha procedimento conhecido
      // nesta conversa -- com procedimento ja conhecido, a duvida nao pode
      // interromper o fluxo em andamento: segue pelo caminho normal, que
      // retoma exatamente a pergunta pendente (data/horario/confirmacao).
      return textoAusenteParaResolucao(dados.procedimento_texto) ? { tipo: 'duvida_livre' } : null;
    case 'negacao':
      return { tipo: 'desistencia' };
    case 'nao_compreendida':
      return { tipo: 'mensagem_nao_compreendida' };
    case 'pedido':
    case 'resposta':
    case 'correcao':
      // Nao ha decisao conversacional propria para estes tres -- segue
      // pelo caminho normal (que, com alteracoes vazio, produz o mesmo
      // desfecho de sempre, ex.: aguardando_procedimento).
      return null;
  }
}

async function decidir(
  clienteBanco: ClienteBancoDados,
  clienteRpc: ClienteRpc,
  clinicaId: string,
  pacienteId: string | null,
  telefoneNormalizado: string,
  dados: Record<string, string | undefined>,
  catalogo: CatalogoClinica,
  instanteAtual: InstanteAtual
): Promise<DecisaoOrquestrador> {
  const resultadoProcedimento = resolverProcedimento({
    clinica_id: clinicaId,
    procedimento_texto: dados.procedimento_texto ?? null,
    catalogo: catalogo.procedimentos,
    aliases: catalogo.aliasesProcedimento,
  });

  if (resultadoProcedimento.tipo === 'erro_catalogo') {
    return { tipo: 'erro_catalogo_procedimento', resultado: resultadoProcedimento };
  }
  if (resultadoProcedimento.tipo !== 'resolvido') {
    return { tipo: 'aguardando_procedimento', resultado: resultadoProcedimento };
  }

  const resolucaoDentista = resolverDentistaComFallback(
    clinicaId,
    resultadoProcedimento.procedimento_id,
    dados.dentista_texto ?? null,
    catalogo
  );
  if ('decisaoAntecipada' in resolucaoDentista) return resolucaoDentista.decisaoAntecipada;

  const resultadoDuracao = resolverDuracao({
    clinica_id: clinicaId,
    procedimento_id: resultadoProcedimento.procedimento_id,
    configuracoes: catalogo.configuracoesDuracao,
  });

  if (resultadoDuracao.tipo === 'nao_configurada') return { tipo: 'duracao_nao_configurada' };
  if (resultadoDuracao.tipo !== 'resolvida') return { tipo: 'erro_configuracao_duracao', resultado: resultadoDuracao };

  // fuso ausente (clinica sem configuracao, ou linha nao encontrada) nao e
  // validado aqui por conta propria -- passa direto pra resolverTemporal,
  // que ja tem o motivo de erro proprio (erro_configuracao/fuso_ausente),
  // em vez de duplicar essa checagem no orquestrador.
  const fuso = await buscarFusoHorario(clienteBanco, clinicaId);

  const resultadoTemporal = resolverTemporal({
    clinica_id: clinicaId,
    fuso: fuso ?? '',
    instante_atual: instanteAtual,
    fatos_temporais: montarFatosTemporais({
      data_texto: dados.data_texto,
      periodo: dados.periodo,
      horario_texto: dados.horario_texto,
    }),
  });

  if (resultadoTemporal.tipo !== 'resolvido') {
    return { tipo: 'aguardando_data_horario', resultado: resultadoTemporal };
  }

  const carregado = await carregarEntradaDisponibilidade(clienteBanco, {
    clinica_id: clinicaId,
    dentista_id: resolucaoDentista.dentistaId,
    procedimento_id: resultadoProcedimento.procedimento_id,
    data: resultadoTemporal.data,
    instante_atual: instanteAtual,
    modo: derivarModoConsulta(resultadoTemporal),
  });

  switch (carregado.tipo) {
    case 'carregado':
      // horario_exato_disponivel = o paciente escolheu um horario especifico
      // (via horario_texto -> montarFatosTemporais -> modo horario_exato) e
      // ele esta livre: e o unico desfecho que pode levar a reserva. Todos
      // os outros (opcoes/sem_disponibilidade/horario_exato_indisponivel/
      // erros de configuracao) so mostram o que ha, nunca reservam.
      if (carregado.resultado.tipo === 'horario_exato_disponivel') {
        return await decidirConfirmacaoOuReserva(
          clienteRpc,
          clinicaId,
          pacienteId,
          telefoneNormalizado,
          resultadoProcedimento.procedimento_id,
          resolucaoDentista.dentistaId,
          resultadoDuracao.duracao_min,
          carregado.resultado.opcao,
          dados.confirmacao
        );
      }
      return {
        tipo: 'horarios_disponiveis',
        procedimento_id: resultadoProcedimento.procedimento_id,
        dentista_id: resolucaoDentista.dentistaId,
        duracao_min: resultadoDuracao.duracao_min,
        resultado: carregado.resultado,
      };
    case 'clinica_nao_encontrada':
      // Nao deveria ocorrer (identificarConversa ja confirmou a clinica
      // antes desta funcao ser chamada) -- tratado como configuracao
      // temporal ausente, nunca uma excecao nao tratada.
      return { tipo: 'aguardando_data_horario', resultado: { tipo: 'erro_configuracao', motivo: 'fuso_ausente' } };
    case 'dentista_nao_encontrado':
      return { tipo: 'sem_dentista_disponivel' };
    case 'duracao_nao_resolvida':
      return carregado.resultado.tipo === 'nao_configurada'
        ? { tipo: 'duracao_nao_configurada' }
        : { tipo: 'erro_configuracao_duracao', resultado: carregado.resultado };
  }
}

/**
 * So chega aqui com um horario ja comprovadamente livre na leitura
 * (resolverDisponibilidade ja devolveu horario_exato_disponivel). Nunca
 * recalcula procedimento/dentista/duracao/horario -- todos os quatro
 * chegam exatamente como ja resolvidos por decidir(), sem nova consulta.
 */
async function decidirConfirmacaoOuReserva(
  clienteRpc: ClienteRpc,
  clinicaId: string,
  pacienteId: string | null,
  telefoneNormalizado: string,
  procedimentoId: string,
  dentistaId: string,
  duracaoMin: number,
  opcao: OpcaoHorario,
  confirmacao: string | undefined
): Promise<DecisaoOrquestrador> {
  // Regra absoluta: nunca reservar sem confirmacao explicita ('sim',
  // vocabulario fechado ja validado por aplicar-dados.ts). Ausencia ou
  // qualquer outro valor -- nunca tratado como confirmacao implicita.
  if (confirmacao !== 'sim') {
    return { tipo: 'aguardando_confirmacao', procedimento_id: procedimentoId, dentista_id: dentistaId, opcao };
  }

  // cappia_reservar_agendamento exige paciente_id (nao tem default) -- sem
  // paciente ja cadastrado pelo telefone, nao ha o que reservar. Cadastro de
  // paciente novo fica fora desta etapa, por decisao do Gabriel.
  if (pacienteId === null) {
    return { tipo: 'cadastro_necessario' };
  }

  const horario = minutosParaHHMM(opcao.inicio_min);
  const resultadoReserva = await reservarAgendamento(clienteRpc, {
    clinica_id: clinicaId,
    procedimento_id: procedimentoId,
    dentista_id: dentistaId,
    paciente_id: pacienteId,
    data: opcao.data,
    horario,
    telefone_normalizado: telefoneNormalizado,
  });

  switch (resultadoReserva.tipo) {
    case 'reservado':
      return {
        tipo: 'reserva_criada',
        agendamento_id: resultadoReserva.agendamento_id,
        dentista_id: resultadoReserva.dentista_id,
        procedimento_id: procedimentoId,
        duracao_min: resultadoReserva.duracao_min,
        data: resultadoReserva.data,
        horario: resultadoReserva.horario,
      };
    case 'conflito':
      // A trava real da RPC (testada em producao) recusou por sobreposicao,
      // mesmo com a leitura anterior indicando livre (corrida real) --
      // nunca insiste sozinho, devolve conflito para pedir nova escolha.
      return { tipo: 'reserva_conflito' };
    case 'falhou':
      return { tipo: 'reserva_falhou', motivo: resultadoReserva.motivo };
  }
}

// resolverDisponibilidade opera em minutos locais (secao 2 de
// specs/disponibilidade.md); cappia_reservar_agendamento espera HH:MM
// (auditado). Unica conversao necessaria pra reaproveitar a RPC existente.
function minutosParaHHMM(minutos: number): string {
  const hora = Math.floor(minutos / 60);
  const minuto = minutos % 60;
  return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
}

async function buscarFusoHorario(cliente: ClienteBancoDados, clinicaId: string): Promise<string | null> {
  const { data, error } = await cliente.from('clinicas').select('fuso_horario').eq('id', clinicaId).maybeSingle();
  if (error) throw new Error(`falha ao buscar fuso da clinica: ${error.message}`);
  const fuso = (data as Record<string, unknown> | null)?.fuso_horario;
  return typeof fuso === 'string' && fuso.trim() !== '' ? fuso : null;
}

// Traduz o resultado temporal resolvido pro modo que resolverDisponibilidade
// espera (ja publicado, nao alterado): horario explicito tem prioridade
// (modo 'horario_exato' nao aceita periodo simultaneamente, pelo proprio
// contrato fechado de ModoConsulta); sem horario, usa periodo quando
// informado; sem os dois, grade do dia inteiro.
function derivarModoConsulta(resultado: ResolucaoTemporalOficial): ModoConsulta {
  if (resultado.horario_min !== undefined) {
    return { tipo: 'horario_exato', horario_min: resultado.horario_min };
  }
  if (resultado.periodo !== undefined) {
    return { tipo: 'grade', periodo: resultado.periodo };
  }
  return { tipo: 'grade' };
}

type ResolucaoDentistaComFallback = { decisaoAntecipada: DecisaoOrquestrador } | { dentistaId: string };

/**
 * specs/dentistas-vinculos-v1.md secao 4 + dentista-tipos.ts (comentario de
 * ResultadoResolucaoDentista): quando a preferencia do paciente nao resolve
 * para um apto, o controlador reaplica a resolucao sem preferencia para
 * obter o conjunto de aptos -- comportamento ja documentado, nao inventado
 * aqui. A recursao termina em no maximo uma chamada extra (a segunda
 * chamada sempre usa `dentista_texto: null`, entao a condicao de fallback
 * nunca se repete).
 */
function resolverDentistaComFallback(
  clinicaId: string,
  procedimentoId: string,
  dentistaTexto: string | null,
  catalogo: CatalogoClinica
): ResolucaoDentistaComFallback {
  const resultado = resolverDentista({
    clinica_id: clinicaId,
    procedimento_id: procedimentoId,
    dentista_texto: dentistaTexto,
    dentistas: catalogo.dentistas,
    vinculos: catalogo.vinculos,
  });

  if (dentistaTexto !== null && (resultado.tipo === 'preferencia_nao_encontrada' || resultado.tipo === 'preferencia_nao_apta')) {
    return resolverDentistaComFallback(clinicaId, procedimentoId, null, catalogo);
  }

  switch (resultado.tipo) {
    case 'um_apto':
    case 'preferencia_apta':
      return { dentistaId: resultado.dentista.dentista_id };
    case 'varios_aptos':
      return { decisaoAntecipada: { tipo: 'aguardando_escolha_dentista', dentistas: resultado.dentistas } };
    case 'erro_catalogo':
      return { decisaoAntecipada: { tipo: 'erro_catalogo_dentista', resultado } };
    default:
      // nenhum_apto, e (sem preferencia) preferencia_nao_encontrada/
      // preferencia_nao_apta -- este ultimo par nao deveria ocorrer com
      // dentista_texto null, mas fica coberto por seguranca, nunca como
      // excecao nao tratada.
      return { decisaoAntecipada: { tipo: 'sem_dentista_disponivel' } };
  }
}
