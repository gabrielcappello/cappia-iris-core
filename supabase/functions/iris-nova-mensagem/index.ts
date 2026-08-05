// Entrypoint da Edge Function. Transporte minimo: recebe o payload minimo
// de n8n, chama o Iris Core (processarMensagem) e devolve so o necessario
// para n8n relayar de volta ao WhatsApp. Nenhuma logica de dominio vive
// aqui -- so parsing/validacao de payload e mapeamento de decisao -> texto
// (via gerarRespostaPaciente, ja pronto) ou -> "nao coberto ainda".
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { processarMensagem } from "./orquestrador.ts";
import { gerarRespostaPaciente } from "./gerar-resposta-paciente.ts";
import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from "./cliente-modelo-openai.ts";
import { ClinicaNaoEncontradaError, EntradaInvalidaError } from "./erros.ts";
import type { ClienteBancoDados } from "./tipos.ts";
import type { ClienteRpc } from "./mensagens-recebidas-tipos.ts";
import type { InstanteAtual } from "./disponibilidade-tipos.ts";

interface PayloadEntrada {
  provider: string;
  instancia_whatsapp: string;
  telefone_normalizado: string;
  mensagem: string;
}

const CHAVES_PAYLOAD = ["provider", "instancia_whatsapp", "telefone_normalizado", "mensagem"];

function validarPayload(valor: unknown): PayloadEntrada {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
    throw new Error("payload_deve_ser_objeto");
  }
  const chaves = Object.keys(valor as Record<string, unknown>);
  if (chaves.length !== CHAVES_PAYLOAD.length || !CHAVES_PAYLOAD.every((c) => chaves.includes(c))) {
    throw new Error("payload_contem_propriedade_nao_permitida");
  }
  const { provider, instancia_whatsapp, telefone_normalizado, mensagem } = valor as Record<string, unknown>;
  if (typeof provider !== "string" || provider.trim() === "") throw new Error("provider_invalido");
  if (typeof instancia_whatsapp !== "string" || instancia_whatsapp.trim() === "") {
    throw new Error("instancia_whatsapp_invalido");
  }
  if (typeof telefone_normalizado !== "string" || telefone_normalizado.trim() === "") {
    throw new Error("telefone_normalizado_invalido");
  }
  if (typeof mensagem !== "string" || mensagem.trim() === "") throw new Error("mensagem_invalida");
  return { provider, instancia_whatsapp, telefone_normalizado, mensagem };
}

// Fuso fixo (America/Sao_Paulo) -- mesma convencao ja usada nos runners de
// teste real (src/eval/). n8n nao precisa saber de fuso: o transporte
// calcula sozinho.
function obterInstanteAtual(): InstanteAtual {
  const agora = new Date();
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(agora);
  const mapa = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  return {
    data: `${mapa.year}-${mapa.month}-${mapa.day}`,
    minuto_min: Number(mapa.hour) * 60 + Number(mapa.minute),
  };
}

function jsonResponse(corpo: unknown, status: number): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ erro: "metodo_nao_permitido" }, 405);
  }

  let payload: PayloadEntrada;
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

  // docs/03-seguranca.md: "a clinica e derivada da instancia autenticada do
  // WhatsApp -- nunca de um identificador enviado pelo proprio paciente/
  // usuario na mensagem". instancia_whatsapp chega no corpo (nao ha, ainda,
  // verificacao de assinatura de webhook do transporte real), entao o
  // vinculo autorizado vive so no servidor (secret, nunca no cliente) e e
  // comparado aqui, antes de qualquer chamada ao Core -- nunca clinica_id
  // no payload (nao existe em PayloadEntrada) e nunca confianca implicita
  // no valor recebido.
  if (payload.instancia_whatsapp !== instanciaAutorizada) {
    return jsonResponse({ erro: "instancia_nao_autorizada" }, 403);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  const clienteBanco = supabase as unknown as ClienteBancoDados;
  const clienteRpc = supabase as unknown as ClienteRpc;

  const clienteModelo = criarClienteModeloOpenAI({
    chaveApi: openaiKey,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
    prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
    esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  });

  try {
    const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpc, {
      provider: payload.provider,
      instancia_whatsapp: payload.instancia_whatsapp,
      telefone_normalizado: payload.telefone_normalizado,
      mensagens_atuais: [payload.mensagem],
      instante_atual: obterInstanteAtual(),
    });

    switch (resultado.decisao.tipo) {
      case "horarios_disponiveis":
      case "aguardando_confirmacao":
      case "reserva_criada":
      case "reserva_conflito":
      case "saudacao":
      case "aguardando_procedimento":
      case "duvida_livre":
      case "mensagem_nao_compreendida":
      case "desistencia": {
        const resposta = gerarRespostaPaciente(resultado.decisao);
        return jsonResponse({ resposta }, 200);
      }
      default:
        // Um dos outros seis estados -- ainda sem texto em portugues
        // (escopo desta etapa). Nunca inventa texto generico.
        return jsonResponse({ resposta: null, decisao_tipo: resultado.decisao.tipo }, 200);
    }
  } catch (erro) {
    if (erro instanceof ClinicaNaoEncontradaError) {
      return jsonResponse({ erro: "clinica_nao_encontrada" }, 404);
    }
    if (erro instanceof EntradaInvalidaError) {
      return jsonResponse({ erro: "entrada_invalida" }, 400);
    }
    return jsonResponse({ erro: "erro_interno" }, 500);
  }
});
