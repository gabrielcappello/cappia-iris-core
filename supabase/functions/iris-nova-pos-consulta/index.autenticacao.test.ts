// Teste de COMPORTAMENTO do handler real de iris-nova-pos-consulta sob Deno --
// autenticacao interna dedicada (revisao final do Codex, bloqueador 3).
//
// Nenhum caso aqui alcanca banco, OpenAI ou rede: todos terminam na
// autenticacao ou na validacao de payload (que vem DEPOIS dela). Segredos
// FICTICIOS. Rodar:  deno test --allow-env --allow-net=jsr.io supabase/functions/iris-nova-pos-consulta/index.autenticacao.test.ts
// (nao e bundlado no deploy: nenhum arquivo da funcao o importa).
import { handler } from "./index.ts";

const SEGREDO = "segredo-de-teste-0123456789-abcdefghijklmnop";
const CABECALHO = "x-iris-pos-consulta-segredo";
const VARIAVEL = "POS_CONSULTA_SEGREDO_INTERNO";
// Payload valido de "confirmar" (so identificadores ficticios).
const PAYLOAD_VALIDO = {
  acao: "confirmar",
  provider: "evolution",
  instancia_whatsapp: "instancia-ficticia",
  agendamento_id: "22222222-2222-2222-2222-222222222222",
  claim_token: "55555555-5555-5555-5555-555555555555",
};

function requisicao(cabecalhos: Record<string, string>, corpo: unknown = PAYLOAD_VALIDO, metodo = "POST"): Request {
  return new Request("https://exemplo.invalid/functions/v1/iris-nova-pos-consulta", {
    method: metodo,
    headers: { "Content-Type": "application/json", ...cabecalhos },
    ...(metodo === "POST" ? { body: JSON.stringify(corpo) } : {}),
  });
}

async function corpoDe(r: Response): Promise<Record<string, unknown>> {
  return (await r.json()) as Record<string, unknown>;
}

function comSegredo(valor: string | undefined, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const anterior = Deno.env.get(VARIAVEL);
    if (valor === undefined) Deno.env.delete(VARIAVEL);
    else Deno.env.set(VARIAVEL, valor);
    try {
      await fn();
    } finally {
      if (anterior === undefined) Deno.env.delete(VARIAVEL);
      else Deno.env.set(VARIAVEL, anterior);
    }
  };
}

function afirmar(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERCAO FALHOU: ${msg}`);
}

Deno.test(
  "sem o cabecalho do segredo -> 401 nao_autorizado, mesmo com a publishable key",
  comSegredo(SEGREDO, async () => {
    const r = await handler(requisicao({ Authorization: "Bearer sb_publishable_ficticia" }));
    afirmar(r.status === 401, `esperado 401, veio ${r.status}`);
    afirmar((await corpoDe(r)).erro === "nao_autorizado", "corpo deveria ser nao_autorizado");
  })
);

Deno.test(
  "segredo errado -> 401 nao_autorizado",
  comSegredo(SEGREDO, async () => {
    const r = await handler(requisicao({ [CABECALHO]: SEGREDO.slice(0, -1) + "X" }));
    afirmar(r.status === 401, `esperado 401, veio ${r.status}`);
  })
);

Deno.test(
  "a autenticacao vem ANTES de ler o corpo: corpo invalido sem segredo -> 401, nao 400",
  comSegredo(SEGREDO, async () => {
    const r = await handler(requisicao({}, { qualquer: "coisa" }));
    afirmar(r.status === 401, `esperado 401 (nao 400 de payload), veio ${r.status}`);
  })
);

Deno.test(
  "segredo correto passa da autenticacao: payload invalido -> 400 (prova de que passou)",
  comSegredo(SEGREDO, async () => {
    const r = await handler(requisicao({ [CABECALHO]: SEGREDO }, { acao: "inexistente" }));
    afirmar(r.status === 400, `esperado 400 (acao_invalida), veio ${r.status}`);
    afirmar((await corpoDe(r)).erro === "acao_invalida", "corpo deveria ser acao_invalida");
  })
);

Deno.test(
  "segredo correto + payload valido, mas sem as demais variaveis -> 500 configuracao_ausente (passou da autenticacao, nunca chegou ao banco)",
  comSegredo(SEGREDO, async () => {
    const anteriores = ["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "INSTANCIA_WHATSAPP_AUTORIZADA"].map((n) => [n, Deno.env.get(n)] as const);
    anteriores.forEach(([n]) => Deno.env.delete(n));
    try {
      const r = await handler(requisicao({ [CABECALHO]: SEGREDO }));
      afirmar(r.status === 500, `esperado 500, veio ${r.status}`);
      afirmar((await corpoDe(r)).erro === "configuracao_ausente", "corpo deveria ser configuracao_ausente");
    } finally {
      anteriores.forEach(([n, v]) => v !== undefined && Deno.env.set(n, v));
    }
  })
);

// FALHA FECHADO: servidor sem segredo forte recusa TUDO -- inclusive quem
// "acertaria" o valor vazio ou o proprio segredo curto.
for (const [rotulo, configurado] of [["ausente", undefined], ["vazio", ""], ["curto", "curto123"]] as const) {
  Deno.test(
    `segredo do servidor ${rotulo} -> 500 configuracao_ausente para QUALQUER chamador (falha fechado)`,
    comSegredo(configurado, async () => {
      const cabecalhos: Record<string, string>[] = [{}, { [CABECALHO]: "" }, { [CABECALHO]: configurado ?? "" }, { [CABECALHO]: SEGREDO }];
      for (const cab of cabecalhos) {
        const r = await handler(requisicao(cab));
        afirmar(r.status === 500, `[${rotulo}] esperado 500, veio ${r.status}`);
        afirmar((await corpoDe(r)).erro === "configuracao_ausente", `[${rotulo}] corpo deveria ser configuracao_ausente`);
      }
    })
  );
}

Deno.test(
  "metodo diferente de POST -> 405 (antes da autenticacao; nada de corpo a vazar)",
  comSegredo(SEGREDO, async () => {
    const r = await handler(requisicao({}, undefined, "GET"));
    afirmar(r.status === 405, `esperado 405, veio ${r.status}`);
  })
);

// ── Operacao "recuperar" (sexta revisao do Codex, bloqueador 1): mesma autenticacao
// interna e mesma validacao de payload das demais. ─────────────────────────────
const PAYLOAD_RECUPERAR = {
  acao: "recuperar",
  provider: "evolution",
  instancia_whatsapp: "instancia-ficticia",
  agendamento_id: "22222222-2222-2222-2222-222222222222",
  paciente_id: "33333333-3333-3333-3333-333333333333",
};

Deno.test(
  "recuperar sem o segredo -> 401 (a autenticacao interna vale para todas as acoes)",
  comSegredo(SEGREDO, async () => {
    const r = await handler(requisicao({ Authorization: "Bearer sb_publishable_ficticia" }, PAYLOAD_RECUPERAR));
    afirmar(r.status === 401, `esperado 401, veio ${r.status}`);
  })
);

Deno.test(
  "recuperar com segredo e sem agendamento_id -> 400 agendamento_id_invalido (payload validado como o de iniciar)",
  comSegredo(SEGREDO, async () => {
    const { agendamento_id: _omitido, ...semAgendamento } = PAYLOAD_RECUPERAR;
    const r = await handler(requisicao({ [CABECALHO]: SEGREDO }, semAgendamento));
    afirmar(r.status === 400, `esperado 400, veio ${r.status}`);
    afirmar((await corpoDe(r)).erro === "agendamento_id_invalido", "corpo deveria ser agendamento_id_invalido");
  })
);

Deno.test(
  "recuperar com segredo e sem paciente_id -> 400 paciente_id_invalido",
  comSegredo(SEGREDO, async () => {
    const { paciente_id: _omitido, ...semPaciente } = PAYLOAD_RECUPERAR;
    const r = await handler(requisicao({ [CABECALHO]: SEGREDO }, semPaciente));
    afirmar(r.status === 400 && (await corpoDe(r)).erro === "paciente_id_invalido", `esperado 400 paciente_id_invalido, veio ${r.status}`);
  })
);

Deno.test(
  "recuperar com segredo e payload valido, sem as demais variaveis -> 500 configuracao_ausente (passou da autenticacao, nunca chegou ao banco)",
  comSegredo(SEGREDO, async () => {
    const anteriores = ["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "INSTANCIA_WHATSAPP_AUTORIZADA"].map((n) => [n, Deno.env.get(n)] as const);
    anteriores.forEach(([n]) => Deno.env.delete(n));
    try {
      const r = await handler(requisicao({ [CABECALHO]: SEGREDO }, PAYLOAD_RECUPERAR));
      afirmar(r.status === 500 && (await corpoDe(r)).erro === "configuracao_ausente", `esperado 500 configuracao_ausente, veio ${r.status}`);
    } finally {
      anteriores.forEach(([n, v]) => v !== undefined && Deno.env.set(n, v));
    }
  })
);
