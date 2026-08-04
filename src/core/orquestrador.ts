import { identificarConversa } from './identificacao.ts';
import { interpretarEAplicar } from './interpretar-e-aplicar.ts';
import { resolverProcedimento } from './resolver-procedimento.ts';
import { resolverDentista } from './resolver-dentista.ts';
import { resolverDuracao } from './resolver-duracao.ts';
import type { ClienteBancoDados } from './tipos.ts';
import type { ClienteModeloEstruturado } from './interpretacao-tipos.ts';
import type { CatalogoClinica, DecisaoOrquestrador, EntradaOrquestrador, ResultadoOrquestrador } from './orquestrador-tipos.ts';

/**
 * Orquestrador minimo do primeiro fluxo: identificacao -> interpretacao ->
 * resolvedores de dominio ja publicados, ate o primeiro dado que falta ou
 * ate procedimento+dentista+duracao estarem prontos (`pronto_para_horario`).
 *
 * Escopo explicitamente fora desta funcao, por decisao do Gabriel (moratoria
 * sobre P4 completo): resolucao temporal e disponibilidade. Ver
 * orquestrador-tipos.ts para o motivo exato.
 *
 * Nao gera texto de resposta ao paciente (redacao/NLG e P5, fora de
 * escopo) -- devolve uma decisao estruturada para o chamador formatar.
 */
export async function processarMensagem(
  clienteModelo: ClienteModeloEstruturado,
  clienteBanco: ClienteBancoDados,
  entrada: EntradaOrquestrador
): Promise<ResultadoOrquestrador> {
  const identificacao = await identificarConversa(clienteBanco, {
    provider: entrada.provider,
    instancia_whatsapp: entrada.instancia_whatsapp,
    telefone_normalizado: entrada.telefone_normalizado,
  });

  const interpretacao = await interpretarEAplicar(clienteModelo, clienteBanco, {
    conversa_id: identificacao.conversa.id,
    clinica_id: identificacao.clinica_id,
    telefone_normalizado: entrada.telefone_normalizado,
    mensagens_atuais: entrada.mensagens_atuais,
  });

  // aplicacao.dados so vem preenchido quando houve pelo menos uma alteracao
  // aplicavel (interpretar-e-aplicar.ts); sem isso, o snapshot ja
  // identificado continua sendo o oficial.
  const dados = (interpretacao.aplicacao?.dados ?? identificacao.conversa.dados) as Record<string, string | undefined>;

  return {
    clinica_id: identificacao.clinica_id,
    conversa_id: identificacao.conversa.id,
    conflitos: interpretacao.conflitos,
    decisao: decidir(identificacao.clinica_id, dados, entrada.catalogo),
  };
}

function decidir(
  clinicaId: string,
  dados: Record<string, string | undefined>,
  catalogo: CatalogoClinica
): DecisaoOrquestrador {
  const resultadoProcedimento = resolverProcedimento({
    clinica_id: clinicaId,
    procedimento_texto: dados.procedimento_texto ?? null,
    catalogo: catalogo.procedimentos,
    aliases: catalogo.aliasesProcedimento,
  });

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

  return {
    tipo: 'pronto_para_horario',
    procedimento_id: resultadoProcedimento.procedimento_id,
    dentista_id: resolucaoDentista.dentistaId,
    duracao_min: resultadoDuracao.duracao_min,
  };
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
