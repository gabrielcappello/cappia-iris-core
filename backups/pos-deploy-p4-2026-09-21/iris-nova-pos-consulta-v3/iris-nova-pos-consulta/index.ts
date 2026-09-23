// Entrypoint da Edge Function NOVA de pos-consulta (Disparo A, ratificado
// pelo Gabriel -- reviews/revisao-pos-consulta-conversacional-v1.md,
// segunda e terceira revisao). Transporte minimo, mesmo espirito de
// iris-nova-mensagem/index.ts: parsing/validacao de payload e a chamada ao
// Core -- nenhuma logica de dominio vive aqui.
//
// TRES OPERACOES, discriminadas por `acao` no corpo ("iniciar", "recuperar" e
// "confirmar"). "recuperar" (sexta revisao do Codex, bloqueador 1) reprocessa uma
// entrega PENDENTE cujo lease venceu -- primeira entrega ('aguardando_inicio') ou
// segunda ('finalizando') --, reclamando a MESMA entrega ou encerrando a jornada sem
// mensagem quando ela nao pode mais ser entregue; ver pos-consulta-recuperar-entrega.ts.
// As duas primeiras devolvem o texto e a confirmacao; o n8n envia e chama "confirmar".
// - "iniciar": chamado pelo n8n (que identifica CANDIDATOS elegiveis --
//   quais agendamentos, de qual paciente) por agendamento candidato. Este
//   Core NUNCA confia cegamente no candidato recebido -- CORRECAO C2
//   (terceira revisao): os fatos MUTAVEIS de elegibilidade (status do
//   agendamento, concluido_em, configuracao vigente da clinica -- modo,
//   prazo, link, orientacoes) sao RELIDOS AQUI, em fonte autoritativa
//   (pos-consulta-reler-fatos-agendamento.ts,
//   pos-consulta-carregar-configuracao.ts), nunca aceitos do payload. O
//   "agora" usado no calculo do prazo tambem e do RELOGIO DO SERVIDOR,
//   nunca do payload -- um `agora` enviado pelo chamador poderia estar
//   atrasado ou ser manipulado. O payload so contribui com IDENTIFICADORES
//   (quem candidatar) e fatos puramente COSMETICOS (nomes exibidos, sem
//   nenhum efeito sobre elegibilidade ou autorizacao).
// - "confirmar": chamado pelo MESMO n8n, SOMENTE DEPOIS que o envio real
//   pelo WhatsApp (Evolution API) foi aceito. Nunca antes -- CORRECAO C1
//   (terceira revisao): a segunda entrega (resposta a mensagem mista, ver
//   iris-nova-mensagem/index.ts) tambem usa esta MESMA operacao para
//   confirmar, nunca uma confirmacao automatica dentro do fluxo reativo.
//
// AUTENTICACAO INTERNA DEDICADA (revisao final do Codex, bloqueador 3): a
// chave PUBLISHABLE do Supabase (`Authorization: Bearer ...`) so satisfaz o
// `verify_jwt` da plataforma -- e publica por desenho e NAO e autorizacao
// suficiente para uma funcao que autoriza mensagens de WhatsApp a pacientes.
// O n8n envia, alem dela, o SEGREDO PROPRIO no cabecalho
// `x-iris-pos-consulta-segredo`, comparado (tempo constante) com a variavel de
// ambiente `POS_CONSULTA_SEGREDO_INTERNO` (>= 32 caracteres). Exigido ANTES de
// ler o corpo, de tocar o banco ou de chamar a OpenAI; segredo ausente/curto no
// servidor FALHA FECHADO (500), nunca aceita qualquer chamador. Ver
// pos-consulta-autenticacao-interna.ts e n8n-workflow-minimo.md.
//
// NAO DEPLOYADA. Fluxo novo e minimo, por decisao explicita do Gabriel --
// nao reaproveita o workflow n8n antigo de avaliacao Google (que continua
// vivo e intocado ate o corte ser autorizado separadamente). Workflow n8n
// minimo documentado em ./n8n-workflow-minimo.md (nao publicado).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  autenticarChamadaInternaPosConsulta,
  CABECALHO_SEGREDO_INTERNO_POS_CONSULTA,
  VARIAVEL_SEGREDO_INTERNO_POS_CONSULTA,
} from "./pos-consulta-autenticacao-interna.ts";
import { resolverClinicaPorInstancia } from "./pos-consulta-resolver-clinica.ts";
import { relerFatosAgendamentoPosConsulta } from "./pos-consulta-reler-fatos-agendamento.ts";
import { carregarConfiguracaoPosConsulta } from "./pos-consulta-carregar-configuracao.ts";
import { avaliarEIniciarPosConsulta } from "./pos-consulta-avaliar-e-iniciar.ts";
import { confirmarEntregaPosConsulta } from "./pos-consulta-confirmar-entrega.ts";
import { processarRecuperacaoPosConsulta } from "./pos-consulta-processar-recuperacao.ts";
import { criarClienteRedatorPosConsultaOpenAI, TIMEOUT_REDATOR_POS_CONSULTA_MS_APROVADO } from "./cliente-modelo-redator-pos-consulta-openai.ts";
import { ClinicaNaoEncontradaError, EntradaInvalidaError } from "./erros.ts";
import type { ClienteBancoDados } from "./tipos.ts";
import type { ClienteRpc } from "./mensagens-recebidas-tipos.ts";

function jsonResponse(corpo: unknown, status: number): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

interface PayloadIniciar {
  acao: "iniciar";
  provider: string;
  instancia_whatsapp: string;
  // SO IDENTIFICADORES -- os fatos de elegibilidade (status, concluido_em,
  // telefone oficial, configuracao, prazo) sao relidos pelo servidor (C2).
  agendamento_id: string;
  paciente_id: string;
  // COSMETICOS, sem efeito sobre elegibilidade ou autorizacao -- usados so
  // pela redacao para contextualizar a mensagem.
  procedimento_nome_exibido?: string;
  dentista_nome_exibido?: string;
  nome_clinica?: string;
}

// "recuperar" leva os MESMOS campos de "iniciar" (so identificadores + cosmeticos): quem
// decide se a entrega e recuperavel e a RPC, sob lock, com fatos relidos aqui.
interface PayloadRecuperar extends Omit<PayloadIniciar, "acao"> {
  acao: "recuperar";
}

interface PayloadConfirmar {
  acao: "confirmar";
  provider: string;
  instancia_whatsapp: string;
  agendamento_id: string;
  claim_token: string;
}

function validarComum(valor: Record<string, unknown>): { provider: string; instancia_whatsapp: string } {
  const { provider, instancia_whatsapp } = valor;
  if (typeof provider !== "string" || provider.trim() === "") throw new Error("provider_invalido");
  if (typeof instancia_whatsapp !== "string" || instancia_whatsapp.trim() === "") {
    throw new Error("instancia_whatsapp_invalido");
  }
  return { provider, instancia_whatsapp };
}

function validarPayloadIniciar(valor: Record<string, unknown>): PayloadIniciar {
  const { provider, instancia_whatsapp } = validarComum(valor);
  const { agendamento_id, paciente_id, procedimento_nome_exibido, dentista_nome_exibido, nome_clinica } = valor;

  if (typeof agendamento_id !== "string" || agendamento_id.trim() === "") throw new Error("agendamento_id_invalido");
  if (typeof paciente_id !== "string" || paciente_id.trim() === "") throw new Error("paciente_id_invalido");
  if (procedimento_nome_exibido !== undefined && typeof procedimento_nome_exibido !== "string") {
    throw new Error("procedimento_nome_exibido_invalido");
  }
  if (dentista_nome_exibido !== undefined && typeof dentista_nome_exibido !== "string") {
    throw new Error("dentista_nome_exibido_invalido");
  }
  if (nome_clinica !== undefined && typeof nome_clinica !== "string") throw new Error("nome_clinica_invalido");

  return {
    acao: "iniciar",
    provider,
    instancia_whatsapp,
    agendamento_id,
    paciente_id,
    ...(typeof procedimento_nome_exibido === "string" ? { procedimento_nome_exibido } : {}),
    ...(typeof dentista_nome_exibido === "string" ? { dentista_nome_exibido } : {}),
    ...(typeof nome_clinica === "string" ? { nome_clinica } : {}),
  };
}

function validarPayloadConfirmar(valor: Record<string, unknown>): PayloadConfirmar {
  const { provider, instancia_whatsapp } = validarComum(valor);
  const { agendamento_id, claim_token } = valor;
  if (typeof agendamento_id !== "string" || agendamento_id.trim() === "") throw new Error("agendamento_id_invalido");
  if (typeof claim_token !== "string" || claim_token.trim() === "") throw new Error("claim_token_invalido");
  return { acao: "confirmar", provider, instancia_whatsapp, agendamento_id, claim_token };
}

function validarPayload(valor: unknown): PayloadIniciar | PayloadRecuperar | PayloadConfirmar {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
    throw new Error("payload_deve_ser_objeto");
  }
  const objeto = valor as Record<string, unknown>;
  if (objeto.acao === "iniciar") return validarPayloadIniciar(objeto);
  if (objeto.acao === "recuperar") {
    const { acao: _acao, ...resto } = validarPayloadIniciar(objeto);
    return { acao: "recuperar", ...resto };
  }
  if (objeto.acao === "confirmar") return validarPayloadConfirmar(objeto);
  throw new Error("acao_invalida");
}

export function tratarErroDoTurno(erro: unknown): Response {
  if (erro instanceof ClinicaNaoEncontradaError) return jsonResponse({ erro: "clinica_nao_encontrada" }, 404);
  if (erro instanceof EntradaInvalidaError) return jsonResponse({ erro: "entrada_invalida" }, 400);
  const mensagem = erro instanceof Error ? erro.message : "erro desconhecido";
  // Nunca payload bruto nem PII no log -- so o nome/mensagem tecnica do erro
  // (mesma disciplina de iris-nova-mensagem/index.ts).
  console.error(`erro_interno tipo=${erro instanceof Error ? erro.name : typeof erro} mensagem=${mensagem}`);
  return jsonResponse({ erro: "erro_interno" }, 500);
}

if (import.meta.main) {
  Deno.serve(handler);
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ erro: "metodo_nao_permitido" }, 405);
  }

  // ── AUTENTICACAO INTERNA (bloqueador 3) -- ANTES de qualquer outra coisa:
  // nem o corpo e lido, nem banco, nem OpenAI, sem o segredo do n8n. ────────
  const autenticacao = await autenticarChamadaInternaPosConsulta(
    req.headers.get(CABECALHO_SEGREDO_INTERNO_POS_CONSULTA),
    Deno.env.get(VARIAVEL_SEGREDO_INTERNO_POS_CONSULTA)
  );
  if (!autenticacao.autorizado) {
    if (autenticacao.motivo === "segredo_nao_configurado") {
      // Problema do SERVIDOR (segredo ausente/curto): 500, nunca 401 -- e
      // nunca aceitar. Nao loga valor nenhum.
      console.error("pos_consulta_segredo_interno_ausente_ou_curto");
      return jsonResponse({ erro: "configuracao_ausente" }, 500);
    }
    return jsonResponse({ erro: "nao_autorizado" }, 401);
  }

  let payload: PayloadIniciar | PayloadRecuperar | PayloadConfirmar;
  try {
    const corpo = await req.json();
    payload = validarPayload(corpo);
  } catch (erro) {
    const codigo = erro instanceof Error ? erro.message : "payload_invalido";
    return jsonResponse({ erro: codigo }, 400);
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const instanciaAutorizada = Deno.env.get("INSTANCIA_WHATSAPP_AUTORIZADA");

  if (!openaiKey || !supabaseUrl || !supabaseServiceRoleKey || !instanciaAutorizada) {
    return jsonResponse({ erro: "configuracao_ausente" }, 500);
  }

  // docs/03-seguranca.md: mesmo gate de iris-nova-mensagem/index.ts -- a
  // clinica NUNCA vem de um campo enviado pelo chamador; so a instancia
  // autorizada no servidor pode disparar esta funcao, e o clinica_id e
  // resolvido a partir dela (nunca aceito como parametro direto).
  if (payload.instancia_whatsapp !== instanciaAutorizada) {
    return jsonResponse({ erro: "instancia_nao_autorizada" }, 403);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  const clienteBanco = supabase as unknown as ClienteBancoDados;
  const clienteRpc = supabase as unknown as ClienteRpc;

  try {
    const { clinica_id } = await resolverClinicaPorInstancia(clienteBanco, {
      provider: payload.provider,
      instancia_whatsapp: payload.instancia_whatsapp,
    });

    if (payload.acao === "confirmar") {
      const resultado = await confirmarEntregaPosConsulta(clienteRpc, {
        clinica_id,
        agendamento_id: payload.agendamento_id,
        claim_token: payload.claim_token,
      });
      return jsonResponse({ resultado: resultado.tipo }, 200);
    }

    if (payload.acao === "recuperar") {
      // ── RECUPERACAO de entrega pendente com lease vencido ───────────────
      // Quem decide se a automacao da clinica esta ligada e a RPC (chave
      // `pos_consulta_tipo`), SOB LOCK: clinica que desligou NAO recebe mensagem,
      // mas a pendencia e encerrada em silencio (`abandonada_automacao_desligada`)
      // para nao prender o telefone -- por isso esta funcao NAO barra a chamada por
      // conta propria. Aqui so se le a config para as ORIENTACOES (tom); uma config
      // incompleta nao impede a entrega: a jornada usa o modo/link capturados.
      // Telefone e paciente vem de fonte autoritativa, nunca do n8n.
      const configuracaoRecuperacao = await carregarConfiguracaoPosConsulta(clienteBanco, clinica_id);
      const fatosRecuperacao = await relerFatosAgendamentoPosConsulta(clienteBanco, {
        clinica_id,
        agendamento_id: payload.agendamento_id,
      });
      // Sem agendamento/telefone, a RPC ENCERRA a jornada (vinculo invalido) -- nunca envia.
      const telefoneOficial = fatosRecuperacao?.telefoneNormalizado ?? null;

      const clienteRedatorRecuperacao = criarClienteRedatorPosConsultaOpenAI({
        chaveApi: openaiKey,
        modelo: "gpt-5.6-luna",
        timeoutMs: TIMEOUT_REDATOR_POS_CONSULTA_MS_APROVADO,
      });

      const recuperacao = await processarRecuperacaoPosConsulta(clienteRpc, clienteRedatorRecuperacao, {
        clinicaId: clinica_id,
        agendamentoId: payload.agendamento_id,
        pacienteId: payload.paciente_id,
        telefoneNormalizado: telefoneOficial,
        // O link do Google NAO entra aqui: vale o snapshot gravado na jornada.
        contexto: {
          ...(configuracaoRecuperacao.orientacoes !== undefined ? { orientacoesClinica: configuracaoRecuperacao.orientacoes } : {}),
          ...(payload.nome_clinica !== undefined ? { nomeClinica: payload.nome_clinica } : {}),
          ...(payload.procedimento_nome_exibido !== undefined || payload.dentista_nome_exibido !== undefined
            ? {
                atendimento: {
                  ...(payload.procedimento_nome_exibido !== undefined
                    ? { procedimentoNomeExibido: payload.procedimento_nome_exibido }
                    : {}),
                  ...(payload.dentista_nome_exibido !== undefined ? { dentistaNomeExibido: payload.dentista_nome_exibido } : {}),
                },
              }
            : {}),
        },
      });

      if (recuperacao.tipo === "entrega_pendente") {
        // A RPC so devolve 'pendente' quando o telefone oficial relido bate com o snapshot da
        // jornada -- logo nao pode ser nulo aqui. Invariante, nunca um caso de dominio.
        if (telefoneOficial === null) throw new Error("invariante violada: entrega recuperada sem telefone oficial");
        return jsonResponse(
          {
            resultado: "entrega_pendente",
            etapa: recuperacao.etapa,
            resposta: recuperacao.resposta,
            confirmacao: recuperacao.confirmacao,
            // D3: o transporte so envia para o telefone relido em fonte autoritativa.
            telefone_normalizado: telefoneOficial,
          },
          200
        );
      }
      if (recuperacao.tipo === "abandonada") return jsonResponse({ resultado: "abandonada", motivo: recuperacao.motivo }, 200);
      if (recuperacao.tipo === "nao_pendente") return jsonResponse({ resultado: "nao_pendente", etapa: recuperacao.etapa }, 200);
      return jsonResponse({ resultado: recuperacao.tipo }, 200);
    }

    // acao === 'iniciar'
    // ── C2: RELEITURA EM FONTE AUTORITATIVA ────────────────────────────
    // Nada do que decide ELEGIBILIDADE vem do payload -- o candidato do
    // n8n pode estar desatualizado (a clinica pode ter mudado a
    // configuracao, o agendamento pode ter mudado de status, o paciente
    // pode ter trocado de telefone, entre o n8n identificar o candidato e
    // esta chamada executar).
    const fatosAgendamento = await relerFatosAgendamentoPosConsulta(clienteBanco, {
      clinica_id,
      agendamento_id: payload.agendamento_id,
    });
    if (fatosAgendamento === null) {
      return jsonResponse({ resultado: "nao_elegivel", motivo: "agendamento_nao_encontrado" }, 200);
    }
    // O paciente_id relido e quem manda -- se divergir do informado pelo
    // n8n, o candidato esta desatualizado (ex.: agendamento transferido).
    // A propria RPC de iniciar_jornada valida isso de novo, sob lock, mas
    // aqui ja detectamos cedo e sem custo de escrita nenhum.
    if (fatosAgendamento.pacienteId !== payload.paciente_id) {
      return jsonResponse({ resultado: "nao_elegivel", motivo: "paciente_divergente" }, 200);
    }

    const configuracao = await carregarConfiguracaoPosConsulta(clienteBanco, clinica_id);

    // "O horario atual deve vir do servidor, nunca do payload" (C2).
    const agora = new Date().toISOString();

    const clienteRedator = criarClienteRedatorPosConsultaOpenAI({
      chaveApi: openaiKey,
      modelo: "gpt-5.6-luna",
      timeoutMs: TIMEOUT_REDATOR_POS_CONSULTA_MS_APROVADO,
    });

    const resultado = await avaliarEIniciarPosConsulta(clienteRpc, clienteRedator, {
      clinicaId: clinica_id,
      agendamentoId: payload.agendamento_id,
      pacienteId: payload.paciente_id,
      agendamento: {
        clinicaId: clinica_id,
        status: fatosAgendamento.status,
        telefoneNormalizado: fatosAgendamento.telefoneNormalizado,
        concluidoEm: fatosAgendamento.concluidoEm,
      },
      configuracao: {
        modo: configuracao.modo,
        prazoMinutos: configuracao.prazoMinutos,
        ...(configuracao.linkAvaliacaoGoogle !== undefined ? { linkAvaliacaoGoogle: configuracao.linkAvaliacaoGoogle } : {}),
      },
      agora,
      contexto: {
        ...(configuracao.linkAvaliacaoGoogle !== undefined ? { linkAvaliacaoGoogle: configuracao.linkAvaliacaoGoogle } : {}),
        ...(configuracao.orientacoes !== undefined ? { orientacoesClinica: configuracao.orientacoes } : {}),
        ...(payload.nome_clinica !== undefined ? { nomeClinica: payload.nome_clinica } : {}),
        ...(payload.procedimento_nome_exibido !== undefined || payload.dentista_nome_exibido !== undefined
          ? {
              atendimento: {
                ...(payload.procedimento_nome_exibido !== undefined
                  ? { procedimentoNomeExibido: payload.procedimento_nome_exibido }
                  : {}),
                ...(payload.dentista_nome_exibido !== undefined ? { dentistaNomeExibido: payload.dentista_nome_exibido } : {}),
              },
            }
          : {}),
      },
    });

    if (resultado.tipo === "entrega_pendente") {
      return jsonResponse(
        {
          resultado: "entrega_pendente",
          resposta: resultado.resposta,
          confirmacao: resultado.confirmacao,
          // D3 (quarta revisao): o transporte (n8n) NUNCA deve enviar pelo
          // telefone que veio no candidato pre-filtro -- so o que esta
          // funcao releu em fonte autoritativa (C2), agora devolvido aqui.
          telefone_normalizado: fatosAgendamento.telefoneNormalizado,
        },
        200
      );
    }
    if (resultado.tipo === "nao_elegivel") {
      return jsonResponse({ resultado: "nao_elegivel", motivo: resultado.motivo }, 200);
    }
    return jsonResponse({ resultado: resultado.tipo }, 200);
  } catch (erro) {
    return tratarErroDoTurno(erro);
  }
}
