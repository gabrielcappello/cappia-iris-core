import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lerEstadoPosConsulta,
  construirAutomatizacoesComPosConsulta,
  type EstadoPosConsulta,
} from "./pos-consulta-automatizacoes.ts";

// D2 (quarta revisão): "adicionar verificação do salvamento e
// recarregamento da configuração" -- o teste central deste arquivo prova
// que salvar e depois reler devolve exatamente o mesmo estado.

test("ciclo salvar -> reler: modo ambos com link e orientação preserva tudo", () => {
  const estado: EstadoPosConsulta = {
    posAtivo: true,
    posTipo: "ambos",
    posLink: "https://g.page/r/exemplo/review",
    posTempo: "4h",
    posMensagem: "seja breve e caloroso",
  };
  const salvo = construirAutomatizacoesComPosConsulta({}, estado);
  const relido = lerEstadoPosConsulta(salvo);
  assert.deepEqual(relido, estado);
});

test("ciclo salvar -> reler: os três modos sobrevivem (satisfacao, google, ambos)", () => {
  for (const posTipo of ["satisfacao", "google", "ambos"] as const) {
    const estado: EstadoPosConsulta = { posAtivo: true, posTipo, posLink: "", posTempo: "2h", posMensagem: "" };
    const relido = lerEstadoPosConsulta(construirAutomatizacoesComPosConsulta({}, estado));
    assert.equal(relido.posTipo, posTipo, `modo ${posTipo} nao sobreviveu ao ciclo`);
    assert.equal(relido.posAtivo, true);
  }
});

test("ciclo salvar -> reler: os três prazos sobrevivem (2h, 4h, 24h)", () => {
  for (const posTempo of ["2h", "4h", "24h"] as const) {
    const estado: EstadoPosConsulta = { posAtivo: true, posTipo: "google", posLink: "", posTempo, posMensagem: "" };
    const relido = lerEstadoPosConsulta(construirAutomatizacoesComPosConsulta({}, estado));
    assert.equal(relido.posTempo, posTempo);
  }
});

test("desligar (posAtivo=false) grava pos_consulta_tipo:'nenhum' e nunca reativa sozinho", () => {
  const estado: EstadoPosConsulta = { posAtivo: false, posTipo: "google", posLink: "https://g.page/r/x", posTempo: "2h", posMensagem: "" };
  const salvo = construirAutomatizacoesComPosConsulta({}, estado);
  assert.equal(salvo.pos_consulta_tipo, "nenhum");
  const relido = lerEstadoPosConsulta(salvo);
  assert.equal(relido.posAtivo, false);
  // link e tempo permanecem gravados (preservados p/ quando o usuario reativar).
  assert.equal(relido.posLink, "https://g.page/r/x");
  assert.equal(relido.posTempo, "2h");
});

test("preserva chaves nao relacionadas ja existentes em automatizacoes", () => {
  const atuais = { lembrete_2h: true, solicitar_email: false };
  const estado: EstadoPosConsulta = { posAtivo: true, posTipo: "google", posLink: "", posTempo: "2h", posMensagem: "" };
  const salvo = construirAutomatizacoesComPosConsulta(atuais, estado);
  assert.equal(salvo.lembrete_2h, true);
  assert.equal(salvo.solicitar_email, false);
});

test("lerEstadoPosConsulta com automatizacoes ausente/vazio: desligado, defaults seguros", () => {
  assert.deepEqual(lerEstadoPosConsulta(undefined), {
    posAtivo: false,
    posTipo: "google",
    posLink: "",
    posTempo: "2h",
    posMensagem: "",
  });
  assert.deepEqual(lerEstadoPosConsulta(null), {
    posAtivo: false,
    posTipo: "google",
    posLink: "",
    posTempo: "2h",
    posMensagem: "",
  });
  assert.deepEqual(lerEstadoPosConsulta({}), {
    posAtivo: false,
    posTipo: "google",
    posLink: "",
    posTempo: "2h",
    posMensagem: "",
  });
});

test("lerEstadoPosConsulta com valores invalidos/corrompidos: cai em defaults, nunca lanca", () => {
  const relido = lerEstadoPosConsulta({ pos_consulta_tipo: "algo_invalido", pos_consulta_tempo: 999, pos_consulta_google_link: 42 });
  assert.equal(relido.posTipo, "google");
  assert.equal(relido.posTempo, "2h");
  assert.equal(relido.posLink, "");
  // P7 (Codex): so o vocabulario fechado (satisfacao/google/ambos) ativa -- um valor
  // fora dele (mesmo nao sendo 'nenhum'/vazio) tem que cair em desligado, nunca ativo.
  assert.equal(relido.posAtivo, false);
});

test("lerEstadoPosConsulta com pos_consulta_tipo 'nenhum': desligado", () => {
  const relido = lerEstadoPosConsulta({ pos_consulta_tipo: "nenhum" });
  assert.equal(relido.posAtivo, false);
});

test("lerEstadoPosConsulta com pos_consulta_tipo vazio: desligado", () => {
  const relido = lerEstadoPosConsulta({ pos_consulta_tipo: "" });
  assert.equal(relido.posAtivo, false);
});
