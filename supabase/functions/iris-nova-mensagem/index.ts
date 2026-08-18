// Entrypoint da Edge Function. Transporte minimo: recebe o payload minimo
// de n8n, chama o Iris Core (processarMensagem) e devolve so o necessario
// para n8n relayar de volta ao WhatsApp. Nenhuma logica de dominio vive
// aqui -- so parsing/validacao de payload e a chamada a
// gerarRespostaConversacional (IA redatora + guarda + fallback
// deterministico, specs/resposta-conversacional-v1.md), ja pronta.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { processarMensagem } from "./orquestrador.ts";
import { gerarRespostaConversacional } from "./gerar-resposta-conversacional.ts";
import { gravarHistoricoConversa } from "./historico-conversa.ts";
import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_GPT_4_1_MINI,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from "./cliente-modelo-openai.ts";
import { criarClienteModeloRedatorOpenAI, TIMEOUT_REDATOR_MS_APROVADO } from "./cliente-modelo-redator-openai.ts";
import { compararComSombraCapacidadeV2, registrarResultadoSombra } from "./sombra-capacidade-v2.ts";
import {
  completarContextoUnificado,
  medirComContextoUnificado,
  registrarMedicaoUnificada,
} from "./sombra-contexto-unificado.ts";
import { medirResultadoIris, registrarMedicaoIris } from "./sombra-resultado-iris.ts";
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

  // Redator: mesmo modelo da interpretadora (nenhuma decisao de trocar de
  // modelo foi tomada), sem retry (cliente-modelo-redator-openai.ts
  // explica o porque). `chaveApi` ja foi validada acima (openaiKey).
  const clienteRedator = criarClienteModeloRedatorOpenAI({
    chaveApi: openaiKey,
    modelo: MODELO_GPT_4_1_MINI,
    timeoutMs: TIMEOUT_REDATOR_MS_APROVADO,
  });

  try {
    // UMA leitura do instante por turno, compartilhada entre a decisao e os
    // fatos da redatora: e o que garante que a relacao "hoje/amanha" entregue
    // a redatora nunca divirja da data que o Core de fato resolveu.
    const instanteAtual = obterInstanteAtual();
    const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpc, {
      provider: payload.provider,
      instancia_whatsapp: payload.instancia_whatsapp,
      telefone_normalizado: payload.telefone_normalizado,
      mensagens_atuais: [payload.mensagem],
      instante_atual: instanteAtual,
    });

    // specs/resposta-conversacional-v1.md: todo desfecho passa pela IA
    // redatora, com fallback deterministico em qualquer falha -- a Iris
    // nunca fica calada (`resposta` nunca e null). `motivo_fallback' e so
    // telemetria interna, nunca exposto ao paciente.
    const { resposta, motivo_fallback } = await gerarRespostaConversacional(clienteRedator, {
      decisao: resultado.decisao,
      mensagemPaciente: payload.mensagem,
      naturezaMensagem: resultado.natureza_mensagem,
      historicoConversa: resultado.historico_conversa,
      dataHoje: instanteAtual.data,
      // Quando o procedimento cedeu lugar a Consulta/Avaliacao para preservar
      // o dentista escolhido (specs/dentista-semantico-v1.md), a redatora
      // PRECISA informar a troca -- ela dispensa nova aceitacao, nunca a
      // comunicacao.
      ...(resultado.substituicao_por_avaliacao !== undefined
        ? { substituicaoPorAvaliacao: resultado.substituicao_por_avaliacao }
        : {}),
      // Agendamentos futuros do paciente como CONTEXTO da conversa
      // (specs/consulta-agendamento-conversacional-v1.md). So vem preenchido
      // em decisao conversacional -- o orquestrador e quem filtra.
      ...(resultado.agendamentos_do_paciente !== undefined
        ? { agendamentosDoPaciente: resultado.agendamentos_do_paciente }
        : {}),
      // Cadastro ja conhecido (2026-08-17): permite a Iris conferir um dado
      // com o paciente e reconhecer quem ja tem ficha, em vez de pedir de
      // novo o que a clinica ja sabe.
      cadastroConhecido: resultado.cadastro_conhecido,
      // Dados da propria clinica e precos liberados (2026-08-17). Sem isto a
      // Iris nao sabia para quem trabalhava: perguntada "qual e a clinica?
      // fica onde", respondia "somos a clinica odontologica".
      ...(resultado.clinica_conhecida !== undefined
        ? { clinicaConhecida: resultado.clinica_conhecida }
        : {}),
      ...(resultado.precos !== undefined ? { precos: resultado.precos } : {}),
    });
    if (motivo_fallback !== null) {
      console.log(`resposta_conversacional_fallback decisao=${resultado.decisao.tipo} motivo=${motivo_fallback}`);
    }

    // specs/historico-conversacional-v1.md: gravada DEPOIS que a resposta
    // final ja existe, com `resposta_iris` sendo exatamente o que vai ao
    // paciente (aprovado pela guarda ou fallback). CAS encadeado sobre
    // `resultado.atualizado_em` -- o valor que gravarContextoHorarios
    // devolveu para este turno, nunca relido. Auxiliar/best-effort: nunca
    // lanca, nunca altera a resposta ja decidida. Sem sanitizacao nesta V1
    // (spec secao 0.1) -- o texto e gravado exatamente como chegou.
    await gravarHistoricoConversa(clienteBanco, {
      conversa_id: resultado.conversa_id,
      clinica_id: resultado.clinica_id,
      telefone_normalizado: payload.telefone_normalizado,
      atualizado_em_da_resposta: resultado.atualizado_em,
      historico_anterior: resultado.historico_conversa,
      mensagem_paciente: payload.mensagem,
      resposta_iris: resposta,
    });

    // ETAPA 2 da Arquitetura V2 (docs/07-arquitetura-v2.md secao 10) --
    // SHADOW MODE, autorizado pelo Gabriel em 2026-08-12. A resposta ao
    // paciente ja foi decidida e gravada nas linhas acima -- daqui em
    // diante nada mais pode influenciar o atendimento deste turno.
    //
    // `compararComSombraCapacidadeV2` NUNCA lanca (garantia de tipo do
    // proprio modulo, coberta por teste em sombra-capacidade-v2.test.ts) --
    // o `.catch` abaixo e so uma segunda rede de seguranca, para uma
    // excecao que nunca deveria escapar da funcao. Nada aqui e `await`ado
    // antes do `return`: a chamada roda em paralelo, nunca atrasa a
    // resposta ao paciente.
    const promessaSombra = compararComSombraCapacidadeV2({
      chaveApi: openaiKey,
      mensagemAtual: payload.mensagem,
      historicoConversa: resultado.historico_conversa,
      contexto: resultado.contexto_sombra_v2,
      decisaoAtual: resultado.decisao.tipo,
    })
      .then(registrarResultadoSombra)
      .catch(() => {});

    // SEGUNDA SOMBRA, independente da primeira: mede o CONTRATO UNIFICADO
    // (specs/contexto-conversacional-unificado-v1.md). Mesmas garantias --
    // roda depois da resposta ja decidida e gravada, nunca e `await`ada
    // antes do `return`, e `medirComContextoUnificado` NUNCA lanca (coberto
    // em sombra-contexto-unificado.test.ts). Nao le nem escreve estado
    // nenhum; so produz uma linha de log com rotulos, sem PII.
    //
    // A mensagem crua do turno e completada AQUI, e nao dentro do
    // orquestrador -- ver `ContextoUnificadoSemMensagem`.
    const contextoUnificado = resultado.contexto_unificado_sombra;
    const promessaSombraUnificada =
      contextoUnificado === undefined
        ? Promise.resolve()
        : medirComContextoUnificado({
            chaveApi: openaiKey,
            contexto: completarContextoUnificado(contextoUnificado, payload.mensagem),
          })
            .then(registrarMedicaoUnificada)
            .catch(() => {});

    // TERCEIRA SOMBRA: mede o contrato `ResultadoIris`
    // (specs/contexto-conversacional-unificado-v2.md), o contrato de ACOES
    // que substitui o `acao_solicitada` generico da v1.
    //
    // Mesmas garantias das duas anteriores: roda DEPOIS da resposta ja
    // decidida e gravada, nunca e `await`ada antes do `return`, e
    // `medirResultadoIris` NUNCA lanca (coberto em
    // sombra-resultado-iris.test.ts). Nao le nem escreve estado nenhum.
    //
    // REUSA o mesmo contexto ja montado para a sombra v1 -- zero trabalho
    // extra no caminho do paciente, e as duas medicoes descrevem exatamente
    // o mesmo turno, o que torna a comparacao entre elas legitima.
    //
    // MODELO DIFERENTE do de producao (gpt-5.6-luna, nao gpt-4.1-mini): e
    // deliberado. O contrato v2 existe porque este modelo trabalha melhor com
    // acoes parametrizadas, e medir com o modelo antigo nao responderia a
    // pergunta que importa. Custo: uma chamada a mais por turno, so aqui.
    const promessaSombraIris =
      contextoUnificado === undefined
        ? Promise.resolve()
        : medirResultadoIris({
            chaveApi: openaiKey,
            contexto: completarContextoUnificado(contextoUnificado, payload.mensagem),
            decisaoAtual: resultado.decisao.tipo,
          })
            .then(registrarMedicaoIris)
            .catch(() => {});

    // `EdgeRuntime.waitUntil` mantem o isolado vivo ate a promessa acima
    // terminar, mesmo depois da resposta ja ter sido enviada -- sem isso, o
    // runtime pode encerrar o isolado antes do log-sombra rodar. Quando o
    // global nao existe (fora do runtime real da Edge Function), a
    // promessa roda melhor-esforco, sem bloquear nada -- o `return` abaixo
    // nunca espera por ela de nenhuma forma.
    if (typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(promessaSombra);
      EdgeRuntime.waitUntil(promessaSombraUnificada);
      EdgeRuntime.waitUntil(promessaSombraIris);
    }

    return jsonResponse({ resposta }, 200);
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
