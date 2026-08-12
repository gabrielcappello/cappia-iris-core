// Runner ISOLADO, avulso: MEDICAO do RISCO DE EXCESSO DE MENCAO pela IA
// REDATORA. Nenhum modulo de producao e alterado por este arquivo.
//
// ── O QUE ESTA SENDO MEDIDO ─────────────────────────────────────────────
// Desenho aprovado (Gabriel, 2026-08-12): os agendamentos futuros do paciente
// entram como FATO DO TURNO -- mesmo canal de `substituicao_por_avaliacao`,
// que ja existe e ja e anexado FORA do switch em `derivarFatosAutorizados`.
// Nao e intencao, nao e decisao, nao e estado.
//
// O `objetivo` NAO muda (`acolher_e_retomar`), e o contrato da redatora ja
// diz que os demais campos sao os que ela PODE mencionar -- permissao, nunca
// obrigacao. A duvida e comportamental, nao estrutural:
//
//   ela usa o agendamento quando a pergunta e sobre ele, e o IGNORA quando a
//   pergunta e sobre outra coisa?
//
// Este e o unico ponto do desenho que depende do comportamento do modelo e
// nao de codigo deterministico -- por isso e a unica coisa medida antes de
// implementar.
//
// ── FIDELIDADE DO INSTRUMENTO (verificado) ──────────────────────────────
// `cliente-modelo-redator-openai.ts:87` serializa `fatos_autorizados` INTEIRO
// (`JSON.stringify(entrada.fatos)`), sem lista de campos. Um campo novo chega
// ao modelo de verdade. Verificado ANTES de rodar -- a medicao anterior
// (campo raiz na interpretadora) foi invalidada justamente por um cliente que
// filtrava chaves, e o erro nao se repete aqui.
//
// ── SEGUNDA MEDICAO EMBUTIDA: A GUARDA ──────────────────────────────────
// `coletarMinutosAutorizados` (guarda-resposta-redatora.ts) NAO le
// `agendamentos_candidatos` nem conheceria o campo novo. Entao toda resposta
// que cite o horario real seria REPROVADA e cairia no texto fixo. O runner
// mede as duas coisas: a guarda ATUAL (que deve reprovar, provando o defeito)
// e a guarda COM A CORRECAO proposta (que deve aprovar).
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/medicao-excesso-mencao-agendamento.ts

import {
  criarClienteModeloRedatorOpenAI,
  TIMEOUT_REDATOR_MS_APROVADO,
} from '../core/cliente-modelo-redator-openai.ts';
import { MODELO_GPT_4_1_MINI } from '../core/cliente-modelo-openai.ts';
import { INSTRUCOES_REDATOR } from '../core/redator-instrucoes.ts';
import { verificarRespostaRedatora } from '../core/guarda-resposta-redatora.ts';
import type { FatosAutorizados } from '../core/fatos-autorizados.ts';

// O agendamento futuro do paciente, no formato que o Core produziria.
const AGENDAMENTO = { data: '20/08', horario: '14:00', descricao: 'Limpeza dental com Dra. Ana Souza' };

// `agendamentos_do_paciente` NAO existe em FatosAutorizados hoje -- e
// exatamente o campo proposto. O cast e local ao runner.
type FatosComAgendamentos = FatosAutorizados & { agendamentos_do_paciente?: string[] };

function fatosComAgendamento(objetivo: FatosAutorizados['objetivo']): FatosComAgendamentos {
  return {
    objetivo,
    agendamentos_do_paciente: [`${AGENDAMENTO.descricao} — ${AGENDAMENTO.data} às ${AGENDAMENTO.horario}`],
  };
}

interface Caso {
  mensagem: string;
  /** true = a resposta DEVE usar o agendamento; false = deve ignora-lo. */
  deveUsar: boolean;
}

// Frases do Gabriel, literais. Todas caem em `duvida` -> `duvida_livre` hoje
// (medido: ~100 chamadas, quatro variantes, sempre `duvida`).
const CASOS: readonly Caso[] = Object.freeze([
  { mensagem: 'quando é minha consulta?', deveUsar: true },
  { mensagem: 'tenho horário marcado?', deveUsar: true },
  { mensagem: 'vocês aceitam convênio?', deveUsar: false },
  { mensagem: 'quanto custa limpeza?', deveUsar: false },
  { mensagem: 'onde fica a clínica?', deveUsar: false },
  { mensagem: 'qual o horário de funcionamento?', deveUsar: false },
]);

const REPETICOES = 4;

/**
 * Mencionou o agendamento? Detecta por DADO CONCRETO do agendamento -- o
 * horario (14:00 / 14h) ou a data (20/08). Nunca por palavra generica como
 * "consulta" ou "agendamento", que aparecem legitimamente em qualquer
 * resposta de clinica odontologica e produziriam falso positivo de deteccao.
 */
function mencionouAgendamento(texto: string): boolean {
  const temHorario = /\b14:00\b/.test(texto) || /\b14\s*h\b/i.test(texto) || /\b14\s*horas\b/i.test(texto);
  const temData = /\b20\/0?8\b/.test(texto);
  return temHorario || temData;
}

/**
 * A guarda COM a correcao proposta: autoriza os minutos de
 * `agendamentos_do_paciente` (campo novo) e de `agendamentos_candidatos`
 * (defeito ja existente, confirmado). Reimplementada aqui porque o runner nao
 * altera producao -- e a mesma extracao `HH:MM` das fontes autorizadas.
 */
function guardaComCorrecao(texto: string, fatos: FatosComAgendamentos): boolean {
  const minutos = new Set<number>();
  const somar = (hhmm: string) => {
    const m = /(\d{1,2}):(\d{2})/.exec(hhmm);
    if (m) minutos.add(Number(m[1]) * 60 + Number(m[2]));
  };
  for (const d of fatos.agendamentos_do_paciente ?? []) somar(d);
  for (const d of fatos.agendamentos_candidatos ?? []) somar(d);

  const semDatas = texto.replace(/\b(0?[1-9]|[12][0-9]|3[01])\/(0?[1-9]|1[0-2])(\/\d{2,4})?\b/g, ' ');
  const citados: number[] = [];
  for (const m of semDatas.matchAll(/\b([01]?[0-9]|2[0-3]):([0-5][0-9])\b/g)) citados.push(Number(m[1]) * 60 + Number(m[2]));
  for (const m of semDatas.matchAll(/\b([01]?[0-9]|2[0-3])\s*h\b/gi)) citados.push(Number(m[1]) * 60);
  for (const m of semDatas.matchAll(/\b([01]?[0-9]|2[0-3])\s*horas\b/gi)) citados.push(Number(m[1]) * 60);

  return citados.every((c) => minutos.has(c));
}

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- medicao: excesso de mencao do agendamento pela REDATORA ---');
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log(`fato disponivel: "${AGENDAMENTO.descricao} — ${AGENDAMENTO.data} às ${AGENDAMENTO.horario}"`);
  console.log('objetivo INALTERADO (acolher_e_retomar). Nenhuma regra de prompt nova.');
  console.log(`casos: ${CASOS.length} x ${REPETICOES} repeticoes`);

  const cliente = criarClienteModeloRedatorOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutMs: TIMEOUT_REDATOR_MS_APROVADO,
  });

  let usouQuandoDevia = 0;
  let deviaUsarTotal = 0;
  let mencionouSemNecessidade = 0;
  let naoDeviaTotal = 0;
  let reprovadaGuardaAtual = 0;
  let reprovadaGuardaCorrigida = 0;
  let erros = 0;

  for (const caso of CASOS) {
    const fatos = fatosComAgendamento('acolher_e_retomar');
    console.log('');
    console.log(`[${caso.deveUsar ? 'DEVE USAR' : 'NAO DEVE MENCIONAR'}] "${caso.mensagem}"`);

    for (let r = 0; r < REPETICOES; r++) {
      try {
        const texto = await cliente.redigir({
          instrucoes: INSTRUCOES_REDATOR,
          mensagemPaciente: caso.mensagem,
          naturezaMensagem: 'duvida',
          fatos,
        });
        const mencionou = mencionouAgendamento(texto);
        const guardaAtual = verificarRespostaRedatora(texto, fatos);
        const guardaOk = guardaComCorrecao(texto, fatos);

        if (caso.deveUsar) {
          deviaUsarTotal++;
          if (mencionou) usouQuandoDevia++;
        } else {
          naoDeviaTotal++;
          if (mencionou) mencionouSemNecessidade++;
        }
        if (!guardaAtual.aprovado) reprovadaGuardaAtual++;
        if (!guardaOk) reprovadaGuardaCorrigida++;

        const marca = caso.deveUsar ? (mencionou ? 'OK ' : '-- ') : mencionou ? '!!!' : 'OK ';
        console.log(`  ${marca} ${JSON.stringify(texto)}`);
        console.log(`       mencionou=${mencionou} | guarda ATUAL=${guardaAtual.aprovado ? 'aprovou' : `REPROVOU(${guardaAtual.motivo})`} | guarda CORRIGIDA=${guardaOk ? 'aprovou' : 'REPROVOU'}`);
      } catch (erro) {
        erros++;
        console.log(`  ERR  ${erro instanceof Error ? erro.message : 'desconhecido'}`);
      }
    }
  }

  console.log('');
  console.log('--- resumo ---');
  console.log(`  usou quando DEVIA usar        : ${usouQuandoDevia}/${deviaUsarTotal}`);
  console.log(`  MENCIONOU SEM NECESSIDADE     : ${mencionouSemNecessidade}/${naoDeviaTotal}  (o risco medido)`);
  console.log(`  reprovadas pela guarda ATUAL  : ${reprovadaGuardaAtual}  (prova do defeito)`);
  console.log(`  reprovadas pela guarda CORRIGIDA: ${reprovadaGuardaCorrigida}  (deve ser 0)`);
  console.log(`  erros de infra                : ${erros}`);
}

main().catch((erro) => {
  console.error(`erro fatal: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exitCode = 1;
});
