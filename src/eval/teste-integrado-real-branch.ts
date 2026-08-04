// Runner ISOLADO, avulso, chamado manualmente: prova o ciclo completo do
// orquestrador (src/core/orquestrador.ts) contra um Postgres REAL --
// mensagem real -> OpenAI real -> interpretacao -> catalogo do banco ->
// disponibilidade do banco -> confirmacao -> reserva -- numa branch
// descartavel derivada do ambiente isolado da Iris Nova
// (bcmuqautblvjdqzhjfbw). Nunca toca o projeto-base nem a ClearDent.
//
// Dados: exclusivamente o fixture ja aprovado (tests/fixtures/
// fixture-teste-integrado.sql) -- 1 clinica, 1 dentista, 1 paciente
// ficticio ja cadastrado, 2 procedimentos ficticios. Nenhum cadastro novo
// e criado por este script.
//
// Nao integra WhatsApp, nao gera resposta final em portugues (isso
// continua fora do escopo do orquestrador nesta etapa) -- so imprime as
// decisoes estruturadas que o orquestrador ja devolve.
//
// Credenciais: somente via variaveis de ambiente (OPENAI_API_KEY,
// IRIS_NOVA_BRANCH_SERVICE_ROLE_KEY), carregadas por `node --env-file`.
// Este arquivo nunca abre, le, imprime ou edita nada dentro de
// .iris-secrets.
//
// Comando:
//   node --experimental-strip-types \
//     --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" \
//     --env-file="C:\Users\Gabriel\.iris-secrets\iris-nova-branch-teste-integrado.env" \
//     src/eval/teste-integrado-real-branch.ts

import { createClient } from '@supabase/supabase-js';
import { processarMensagem } from '../core/orquestrador.ts';
import { reservarAgendamento } from '../core/reservar-agendamento.ts';
import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import type { ClienteBancoDados } from '../core/tipos.ts';
import type { ClienteRpc } from '../core/mensagens-recebidas-tipos.ts';
import type { InstanteAtual } from '../core/disponibilidade-tipos.ts';

// --- Fixture ja aprovado (tests/fixtures/fixture-teste-integrado.sql) ---
const BRANCH_URL = 'https://gndkxtfpptfhhrgxpsyh.supabase.co';
const PROVIDER = 'evolution';
const INSTANCIA_WHATSAPP = 'TESTE-INTEGRADO-FIXTURE';
const TELEFONE_PACIENTE_FICTICIO = '5511999998888';
const PACIENTE_ID_FICTICIO = '7947bec3-9b33-424e-b724-2247a8c7535c';

function obterInstanteAtual(): InstanteAtual {
  const agora = new Date();
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(agora);
  const mapa = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  return {
    data: `${mapa.year}-${mapa.month}-${mapa.day}`,
    minuto_min: Number(mapa.hour) * 60 + Number(mapa.minute),
  };
}

function imprimir(titulo: string, valor: unknown): void {
  console.log(`--- ${titulo} ---`);
  console.log(JSON.stringify(valor, null, 2));
  console.log('');
}

async function main(): Promise<void> {
  const chaveOpenAI = process.env.OPENAI_API_KEY;
  const chaveSupabase = process.env.IRIS_NOVA_BRANCH_SERVICE_ROLE_KEY;

  if (!chaveOpenAI || chaveOpenAI.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }
  if (!chaveSupabase || chaveSupabase.trim() === '') {
    console.error('IRIS_NOVA_BRANCH_SERVICE_ROLE_KEY ausente. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  console.log('--- teste integrado real: mensagem -> OpenAI -> catalogo -> disponibilidade -> confirmacao -> reserva ---');
  console.log(`branch (project_ref): gndkxtfpptfhhrgxpsyh`);
  console.log(`modelo: ${MODELO_GPT_4_1_MINI}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log('IRIS_NOVA_BRANCH_SERVICE_ROLE_KEY: presente (valor nunca exibido)');
  console.log('');

  const supabase = createClient(BRANCH_URL, chaveSupabase);
  const clienteBanco = supabase as unknown as ClienteBancoDados;
  const clienteRpc = supabase as unknown as ClienteRpc;

  const clienteModelo = criarClienteModeloOpenAI({
    chaveApi: chaveOpenAI,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  const instanteAtual = obterInstanteAtual();
  imprimir('instante_atual (calculado agora, America/Sao_Paulo)', instanteAtual);

  // --- Turno 1: pedido simples de procedimento + amanha + manha ---
  const mensagem1 = 'Quero marcar uma Limpeza Teste para amanhã de manhã.';
  imprimir('turno 1 -- mensagem', mensagem1);
  const resultado1 = await processarMensagem(clienteModelo, clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_WHATSAPP,
    telefone_normalizado: TELEFONE_PACIENTE_FICTICIO,
    mensagens_atuais: [mensagem1],
    instante_atual: instanteAtual,
  });
  imprimir('turno 1 -- resultado (esperado: horarios_disponiveis)', resultado1);
  if (resultado1.decisao.tipo !== 'horarios_disponiveis') {
    console.error(`FALHA DE VALIDACAO -- turno 1: esperado tipo='horarios_disponiveis', recebido tipo='${resultado1.decisao.tipo}'`);
    process.exitCode = 1;
    return;
  }

  // --- Turno 2: escolha de horario explicito ---
  const mensagem2 = 'Prefiro 9h.';
  imprimir('turno 2 -- mensagem', mensagem2);
  const resultado2 = await processarMensagem(clienteModelo, clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_WHATSAPP,
    telefone_normalizado: TELEFONE_PACIENTE_FICTICIO,
    mensagens_atuais: [mensagem2],
    instante_atual: obterInstanteAtual(),
  });
  imprimir('turno 2 -- resultado (esperado: aguardando_confirmacao)', resultado2);
  if (resultado2.decisao.tipo !== 'aguardando_confirmacao') {
    console.error(`FALHA DE VALIDACAO -- turno 2: esperado tipo='aguardando_confirmacao', recebido tipo='${resultado2.decisao.tipo}'`);
    process.exitCode = 1;
    return;
  }

  // --- Turno 3: confirmacao explicita "sim" -> reserva ---
  const mensagem3 = 'Sim, pode confirmar.';
  imprimir('turno 3 -- mensagem', mensagem3);
  const resultado3 = await processarMensagem(clienteModelo, clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA_WHATSAPP,
    telefone_normalizado: TELEFONE_PACIENTE_FICTICIO,
    mensagens_atuais: [mensagem3],
    instante_atual: obterInstanteAtual(),
  });
  imprimir('turno 3 -- resultado (esperado: reserva_criada)', resultado3);
  if (resultado3.decisao.tipo !== 'reserva_criada') {
    console.error(`FALHA DE VALIDACAO -- turno 3: esperado tipo='reserva_criada', recebido tipo='${resultado3.decisao.tipo}'`);
    process.exitCode = 1;
    return;
  }

  // --- Segunda tentativa no MESMO horario: prova a trava real da RPC
  // (cappia_reservar_agendamento, ja em producao) -- chama o mesmo
  // adaptador diretamente, com os MESMOS identificadores ja resolvidos na
  // reserva anterior, para provar o conflito no nivel exato onde ele e
  // resolvido de verdade (a trava dentro da RPC), nao so na leitura previa
  // de disponibilidade. A validacao acima (return antecipado se turno 3
  // nao for 'reserva_criada') garante que resultado3.decisao ja esta
  // estreitado a esse tipo aqui. ---
  const reservaAnterior = resultado3.decisao;
  imprimir('segunda tentativa -- parametros (mesmo horario da reserva ja criada)', {
    procedimento_id: reservaAnterior.procedimento_id,
    dentista_id: reservaAnterior.dentista_id,
    data: reservaAnterior.data,
    horario: reservaAnterior.horario,
  });
  const segundaTentativa = await reservarAgendamento(clienteRpc, {
    clinica_id: resultado3.clinica_id,
    procedimento_id: reservaAnterior.procedimento_id,
    dentista_id: reservaAnterior.dentista_id,
    paciente_id: PACIENTE_ID_FICTICIO,
    data: reservaAnterior.data,
    horario: reservaAnterior.horario,
    telefone_normalizado: TELEFONE_PACIENTE_FICTICIO,
  });
  imprimir('segunda tentativa -- resultado (esperado: conflito)', segundaTentativa);
  if (segundaTentativa.tipo !== 'conflito') {
    console.error(`FALHA DE VALIDACAO -- segunda tentativa: esperado tipo='conflito', recebido tipo='${segundaTentativa.tipo}'`);
    process.exitCode = 1;
    return;
  }

  console.log('--- fim: todas as 4 validacoes passaram (turno 1, turno 2, turno 3, segunda tentativa) ---');
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
