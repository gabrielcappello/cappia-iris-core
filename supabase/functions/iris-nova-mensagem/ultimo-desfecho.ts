// Marcador declarativo do desfecho concluido no turno anterior
// (docs/07-arquitetura-v2.md secao 10, Etapa 2).
//
// MODULO PROPRIO porque o conceito tem dois lados em modulos diferentes:
// quem PUBLICA e `contexto-horarios.ts` (fim do turno que concluiu a
// operacao) e quem CONSOME e `aplicar-dados.ts` (o CAS autoritativo do turno
// seguinte). Sem casa propria, um dos dois teria de importar do outro numa
// direcao que nao corresponde a nenhuma dependencia real.
//
// CICLO DE VIDA -- publicar / reivindicar, nunca "expirar":
//
//   turno A conclui  -> PUBLICA o marcador (escrita auxiliar do fim do turno)
//   turno B          -> REIVINDICA no CAS autoritativo: quem vence o CAS
//                       consome o marcador (a coluna volta a NULL) e SO esse
//                       processo pode usa-lo na medicao
//   turno C          -> nao ha mais marcador
//
// Nao ha TTL, nao ha timestamp de validade, nao ha varredura: a expiracao e
// consequencia da reivindicacao, nao de tempo. Um processo que PERDE o CAS
// nao consome e nao mede -- e por isso duas execucoes concorrentes do mesmo
// turno nunca podem medir as duas com o mesmo marcador.

import type { DecisaoOrquestrador } from './orquestrador-tipos.ts';
import type { UltimoDesfecho } from './tipos.ts';

/** Vocabulario FECHADO -- unica fonte da verdade sobre o que a coluna aceita. */
export const TIPOS_ULTIMO_DESFECHO: readonly UltimoDesfecho['tipo'][] = [
  'reserva_criada',
  'remarcacao_criada',
  'cancelamento_criado',
];

/**
 * PURA e exaustiva, mesmo espirito de `derivarAcaoContextoHorarios`: traduz a
 * decisao ja tomada no marcador que o turno SEGUINTE vai reivindicar.
 *
 * Somente os tres desfechos que CONCLUEM uma operacao publicam. Todo o resto
 * devolve `null` -- e nao publicar e a unica forma de "nao marcar": a limpeza
 * do marcador antigo nunca acontece aqui, ela e feita pela reivindicacao no
 * CAS autoritativo.
 *
 * EXAUSTIVA SEM `default`, pelo mesmo motivo de `derivarAcaoContextoHorarios`:
 * uma decisao nova que CONCLUA uma operacao precisa ser classificada
 * conscientemente, nunca entrar calada no grupo "nao concluiu nada".
 */
export function derivarUltimoDesfecho(decisao: DecisaoOrquestrador): UltimoDesfecho | null {
  switch (decisao.tipo) {
    case 'reserva_criada':
    case 'remarcacao_criada':
    case 'cancelamento_criado':
      return { tipo: decisao.tipo };

    // Todo o resto NAO publica. Nenhuma destas concluiu uma operacao: sao
    // perguntas, desfechos conversacionais, recusas ou erros tecnicos.
    case 'saudacao':
    case 'duvida_livre':
    case 'mensagem_nao_compreendida':
    case 'desistencia':
    case 'aguardando_procedimento':
    case 'aguardando_escolha_dentista':
    case 'aguardando_data_horario':
    case 'troca_telefone_pendente':
    case 'troca_telefone_recusada':
    case 'sem_dentista_disponivel':
    case 'combinacao_indisponivel':
    case 'horarios_disponiveis':
    case 'aguardando_confirmacao':
    case 'cadastro_necessario':
    case 'cpf_ja_cadastrado':
    case 'reserva_conflito':
    case 'reserva_falhou':
    case 'sem_agendamento_para_remarcar':
    case 'aguardando_escolha_agendamento':
    case 'aguardando_confirmacao_remarcacao':
    case 'sem_agendamento_para_cancelar':
    case 'aguardando_escolha_agendamento_cancelamento':
    case 'aguardando_confirmacao_cancelamento':
    case 'clinica_sem_catalogo':
    case 'erro_catalogo_dentista':
    case 'duracao_nao_configurada':
    case 'erro_configuracao_duracao':
      return null;
  }
}

/**
 * Fronteira de confianca na LEITURA da coluna.
 *
 * Falha ABERTA para o VALOR (malformado ou de formato futuro vira `null`),
 * mesmo criterio de `validarContextoHorarios`: este campo alimenta
 * exclusivamente a medicao em sombra, e derrubar um turno por causa dele
 * seria a sombra quebrando o atendimento -- o que a Etapa 2 proibe.
 *
 * NAO cobre a AUSENCIA da coluna: ela esta nos SELECTs de `identificacao.ts` e
 * `aplicar-dados.ts`, e SELECT de coluna inexistente e erro do PostgREST,
 * nunca `undefined`. A migration precisa ser aplicada ANTES do deploy.
 */
export function validarUltimoDesfecho(valor: unknown): UltimoDesfecho | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'object' || Array.isArray(valor)) return null;

  const { tipo } = valor as Record<string, unknown>;
  if (typeof tipo !== 'string' || !TIPOS_ULTIMO_DESFECHO.includes(tipo as UltimoDesfecho['tipo'])) {
    return null;
  }
  return { tipo: tipo as UltimoDesfecho['tipo'] };
}
