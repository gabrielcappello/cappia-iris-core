// Chat LOCAL, interativo, avulso -- conversa de verdade com a Iris (Core +
// as duas IAs reais) sem tocar em NENHUM Supabase (nem o de teste, nem o
// real). O "banco" e o mesmo dublê em memoria usado pelos testes
// (teste-cliente-falso.ts) -- some quando o processo termina.
//
// Objetivo: sentir como a Iris esta respondendo hoje (specs/resposta-
// conversacional-v1.md + specs/historico-conversacional-v1.md), sem
// depender de aplicar migration, dar commit, nem esperar deploy.
//
// Cenario fixo, semeado no início (ver `semearClinicaDemo` abaixo):
//   - 1 clinica, fuso America/Sao_Paulo;
//   - Dra. Ana, atende 08:00-18:00, almoço 12:00-13:00, sem sábado;
//   - 2 procedimentos: Limpeza (30min) e Clareamento (60min);
//   - 1 paciente ja cadastrado no telefone de demonstracao (assim a reserva
//     consegue completar o ciclo -- sem isso, cairia em cadastro_necessario).
//
// A cada mensagem, o fluxo e EXATAMENTE o mesmo do index.ts real: interpreta
// -> decide -> grava contexto_horarios -> redige (guarda incluida) -> grava
// historico_conversa. So o transporte (WhatsApp/Supabase) e trocado por um
// loop de terminal e um dublê em memoria.
//
// Chave: somente via variavel de ambiente OPENAI_API_KEY (a mesma ja
// validada no cofre canonico, .iris-secrets/openai.env), carregada
// exclusivamente por `node --env-file`. Este arquivo nunca abre, le,
// imprime ou edita nada dentro de .iris-secrets.
//
// Comando:
//   node --experimental-strip-types --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" src/eval/conversar-local.ts
//
// Digite "sair" (ou Ctrl+C) para encerrar.

import { createInterface } from 'node:readline/promises';
import { processarMensagem } from '../core/orquestrador.ts';
import { gerarRespostaConversacional } from '../core/gerar-resposta-conversacional.ts';
import { gravarHistoricoConversa } from '../core/historico-conversa.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from '../core/teste-cliente-falso.ts';
import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { criarClienteModeloRedatorOpenAI, TIMEOUT_REDATOR_MS_APROVADO } from '../core/cliente-modelo-redator-openai.ts';
import type { ClienteBancoDados } from '../core/tipos.ts';
import type { ClienteRpc } from '../core/mensagens-recebidas-tipos.ts';
import type { InstanteAtual } from '../core/disponibilidade-tipos.ts';

const PROVIDER = 'local';
const INSTANCIA = 'chat-local';
const TELEFONE = '5511900000000';
const PACIENTE_NOME = 'Gabriel (demo local)';
const PROCEDIMENTO_LIMPEZA = 'limpeza';
const PROCEDIMENTO_CLAREAMENTO = 'clareamento';
// Consulta/Avaliacao desde specs/procedimento-semantico-v1.md (2026-08-08):
// resolve como qualquer outro procedimento, pela compreensao semantica da IA
// sobre o catalogo ativo -- nao ha alias, nao ha fallback tecnico, nao ha
// flag. Um paciente que diz "nao sei o que preciso" chega aqui porque a IA
// leu "Consulta / Avaliação" na lista e entendeu, nao porque alguem
// cadastrou uma palavra-gatilho.
const PROCEDIMENTO_AVALIACAO = 'avaliacao';

const TEMPO_POR_PROCEDIMENTO: Record<string, number> = {
  [PROCEDIMENTO_LIMPEZA]: 30,
  [PROCEDIMENTO_CLAREAMENTO]: 60,
  [PROCEDIMENTO_AVALIACAO]: 20,
};

function semearClinicaDemo(tabelas: TabelasFalsas): string {
  const clinicaId = crypto.randomUUID();
  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [
      {
        id: crypto.randomUUID(),
        nome: 'Ana',
        titulo: 'Dra.',
        ativo: true,
        modo: 'procedimento',
        inicio: '08:00',
        fim: '18:00',
        sabado: false,
        alm_ini: '12:00',
        alm_fim: '13:00',
        procedimentos: [
          { id: PROCEDIMENTO_LIMPEZA, nome: 'Limpeza', tempo: 30, ativo: true },
          { id: PROCEDIMENTO_CLAREAMENTO, nome: 'Clareamento', tempo: 60, ativo: true },
          { id: PROCEDIMENTO_AVALIACAO, nome: 'Avaliação', tempo: 20, ativo: true },
        ],
      },
    ],
  });
  for (const [id, nome] of [
    [PROCEDIMENTO_LIMPEZA, 'Limpeza'],
    [PROCEDIMENTO_CLAREAMENTO, 'Clareamento'],
    [PROCEDIMENTO_AVALIACAO, 'Avaliação'],
  ] as const) {
    tabelas.procedimentos_catalogo.push({
      id,
      nome_pt: nome,
      nome_es: null,
      nome_en: null,
      nome_fr: null,
      nome_de: null,
      nome_it: null,
      nome_ru: null,
      nome_ar: null,
      tempo_padrao: TEMPO_POR_PROCEDIMENTO[id],
      ativo: true,
    });
  }
  tabelas.pacientes.push({ id: crypto.randomUUID(), clinica_id: clinicaId, telefone_normalizado: TELEFONE });
  return clinicaId;
}

// Dublê MINIMO da RPC de reserva, so pra este chat local: sempre sucede,
// devolvendo os proprios parametros recebidos (nunca recalcula nada -- o
// Core ja resolveu tudo antes de chamar). Suficiente pra sentir o ciclo
// completo da conversa; a logica REAL de reserva/conflito ja tem cobertura
// de teste propria em reservar-agendamento.test.ts.
class ClienteRpcLocalDinamico implements ClienteRpc {
  async rpc(nome: string, parametros: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
    if (nome !== 'cappia_reservar_agendamento') {
      throw new Error(`ClienteRpcLocalDinamico: RPC nao suportada neste chat local: ${nome}`);
    }
    return {
      data: {
        sucesso: true,
        agendamento_id: crypto.randomUUID(),
        dentista_id: parametros.p_dentista_id,
        duracao_min: TEMPO_POR_PROCEDIMENTO[parametros.p_procedimento_id as string] ?? 30,
        data: parametros.p_data,
        horario: parametros.p_horario,
      },
      error: null,
    };
  }
}

// Mesmo criterio de index.ts (fuso fixo America/Sao_Paulo) -- reimplementado
// aqui porque obterInstanteAtual nao e exportado do transporte real.
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

async function main(): Promise<void> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    process.exitCode = 1;
    return;
  }

  const tabelas = criarTabelasFalsasVazias();
  semearClinicaDemo(tabelas);
  const clienteBanco = new ClienteFalso(tabelas) as unknown as ClienteBancoDados;
  const clienteRpc = new ClienteRpcLocalDinamico();

  const clienteModelo = criarClienteModeloOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });
  const clienteRedator = criarClienteModeloRedatorOpenAI({
    chaveApi,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutMs: TIMEOUT_REDATOR_MS_APROVADO,
  });

  console.log('--- chat local com a Iris (nada disso toca o Supabase real nem o de teste) ---');
  console.log(`clinica demo: Dra. Ana, Limpeza (30min), Clareamento (60min) e Avaliação (20min), 08:00-18:00, almoço 12:00-13:00, sem sábado`);
  console.log(`paciente demo ja cadastrado: ${PACIENTE_NOME} (telefone ${TELEFONE})`);
  console.log('digite "sair" para encerrar (ou Ctrl+C)');
  console.log('');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      let mensagem: string;
      try {
        mensagem = (await rl.question('você: ')).trim();
      } catch {
        // Entrada fechada (Ctrl+D, ou terminal encerrado) -- encerra a
        // conversa normalmente, nunca como erro fatal.
        break;
      }
      if (mensagem === '') continue;
      if (mensagem.toLowerCase() === 'sair') break;

      try {
        const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpc, {
          provider: PROVIDER,
          instancia_whatsapp: INSTANCIA,
          telefone_normalizado: TELEFONE,
          mensagens_atuais: [mensagem],
          instante_atual: obterInstanteAtual(),
        });

        const { resposta, motivo_fallback } = await gerarRespostaConversacional(clienteRedator, {
          decisao: resultado.decisao,
          mensagemPaciente: mensagem,
          naturezaMensagem: resultado.natureza_mensagem,
          historicoConversa: resultado.historico_conversa,
        });

        await gravarHistoricoConversa(clienteBanco, {
          conversa_id: resultado.conversa_id,
          clinica_id: resultado.clinica_id,
          telefone_normalizado: TELEFONE,
          atualizado_em_da_resposta: resultado.atualizado_em,
          historico_anterior: resultado.historico_conversa,
          mensagem_paciente: mensagem,
          resposta_iris: resposta,
        });

        console.log(`iris: ${resposta}`);
        if (motivo_fallback !== null) {
          console.log(`  (telemetria interna, nunca visível ao paciente: fallback por "${motivo_fallback}", decisão="${resultado.decisao.tipo}")`);
        } else {
          console.log(`  (telemetria interna: decisão="${resultado.decisao.tipo}")`);
        }
        console.log('');
      } catch (erro) {
        const mensagemErro = erro instanceof Error ? erro.message : 'erro desconhecido';
        console.error(`  [erro tecnico local, nao chega ao paciente em produção]: ${mensagemErro}`);
        console.log('');
      }
    }
  } finally {
    rl.close();
  }

  console.log('--- fim da conversa local ---');
}

main().catch((erro) => {
  const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
  console.error(`erro fatal (mensagem tecnica, sem payload nem chave): ${mensagem}`);
  process.exitCode = 1;
});
