import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carregarCatalogo } from './carregar-catalogo.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';

const CLINICA_ID = crypto.randomUUID();

function semearProcedimento(tabelas: TabelasFalsas, overrides: Record<string, unknown> = {}) {
  tabelas.procedimentos_catalogo.push({
    id: 'teste_limpeza',
    nome_pt: 'Limpeza Teste',
    nome_es: 'Limpeza Teste ES',
    nome_en: 'Cleaning Test',
    nome_fr: null,
    nome_de: null,
    nome_it: null,
    nome_ru: null,
    nome_ar: null,
    tempo_padrao: 40,
    ativo: true,
    ...overrides,
  });
}

test('clinica inexistente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const cliente = new ClienteFalso(tabelas);
  const resultado = await carregarCatalogo(cliente, { clinica_id: CLINICA_ID });
  assert.deepEqual(resultado, { tipo: 'clinica_nao_encontrada' });
});

test('clinica sem dentistas: procedimentos carregados, dentistas/vinculos/duracao vazios', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.clinicas.push({ id: CLINICA_ID, dentistas: null });
  semearProcedimento(tabelas);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarCatalogo(cliente, { clinica_id: CLINICA_ID });
  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;

  assert.deepEqual(resultado.catalogo.procedimentos, [
    { procedimento_id: 'teste_limpeza', clinica_id: CLINICA_ID, nome_pt: 'Limpeza Teste', ativo: true, eh_consulta_avaliacao: false },
  ]);
  // 3 idiomas preenchidos no fixture (pt/es/en) -> 3 aliases, um por nome.
  assert.equal(resultado.catalogo.aliasesProcedimento.length, 3);
  assert.ok(resultado.catalogo.aliasesProcedimento.some((a) => a.texto === 'Limpeza Teste'));
  assert.ok(resultado.catalogo.aliasesProcedimento.some((a) => a.texto === 'Cleaning Test'));
  assert.deepEqual(resultado.catalogo.dentistas, []);
  assert.deepEqual(resultado.catalogo.vinculos, []);
  assert.deepEqual(resultado.catalogo.configuracoesDuracao, []);
});

test('dentista modo procedimento: duracao vem do item, nao do tempo_padrao', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const dentistaId = crypto.randomUUID();
  tabelas.clinicas.push({
    id: CLINICA_ID,
    dentistas: [
      {
        id: dentistaId,
        nome: 'Ana Souza',
        titulo: 'Dra.',
        ativo: true,
        modo: 'procedimento',
        procedimentos: [{ id: 'teste_limpeza', nome: 'Limpeza Teste', ativo: true, tempo: 45 }],
      },
    ],
  });
  semearProcedimento(tabelas, { tempo_padrao: 40 });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarCatalogo(cliente, { clinica_id: CLINICA_ID });
  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;

  assert.deepEqual(resultado.catalogo.dentistas, [
    {
      dentista_id: dentistaId,
      clinica_id: CLINICA_ID,
      nome_exibido: 'Dra. Ana Souza',
      nome_completo_resolucao: 'Dra. Ana Souza',
      nome_curto_resolucao: 'Ana Souza',
      ativo: true,
    },
  ]);
  assert.deepEqual(resultado.catalogo.vinculos, [
    { clinica_id: CLINICA_ID, dentista_id: dentistaId, procedimento_id: 'teste_limpeza', ativo: true },
  ]);
  assert.deepEqual(resultado.catalogo.configuracoesDuracao, [
    { clinica_id: CLINICA_ID, procedimento_id: 'teste_limpeza', duracao_min: 45 },
  ]);
});

test('dentista modo auto: duracao vem de dur, nao do item do procedimento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const dentistaId = crypto.randomUUID();
  tabelas.clinicas.push({
    id: CLINICA_ID,
    dentistas: [
      {
        id: dentistaId,
        nome: 'Carlos',
        titulo: 'Dr.',
        ativo: true,
        modo: 'auto',
        dur: 60,
        procedimentos: [{ id: 'teste_limpeza', nome: 'Limpeza Teste', ativo: true, tempo: 45 }],
      },
    ],
  });
  semearProcedimento(tabelas);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarCatalogo(cliente, { clinica_id: CLINICA_ID });
  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.deepEqual(resultado.catalogo.configuracoesDuracao, [
    { clinica_id: CLINICA_ID, procedimento_id: 'teste_limpeza', duracao_min: 60 },
  ]);
});

test('dois dentistas com duracao divergente pro mesmo procedimento: ambas as configuracoes chegam ao resolvedor (que decide o conflito)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const dentista1 = crypto.randomUUID();
  const dentista2 = crypto.randomUUID();
  tabelas.clinicas.push({
    id: CLINICA_ID,
    dentistas: [
      {
        id: dentista1,
        nome: 'Ana',
        ativo: true,
        modo: 'procedimento',
        procedimentos: [{ id: 'teste_limpeza', nome: 'Limpeza Teste', ativo: true, tempo: 45 }],
      },
      {
        id: dentista2,
        nome: 'Carlos',
        ativo: true,
        modo: 'procedimento',
        procedimentos: [{ id: 'teste_limpeza', nome: 'Limpeza Teste', ativo: true, tempo: 50 }],
      },
    ],
  });
  semearProcedimento(tabelas);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarCatalogo(cliente, { clinica_id: CLINICA_ID });
  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  const valores = resultado.catalogo.configuracoesDuracao.map((c) => c.duracao_min).sort();
  assert.deepEqual(valores, [45, 50]);
});

test('dentista inativo com duracao divergente: continua listado, mas nunca vira vinculo nem configuracao (achado do Codex)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const dentistaAtivo = crypto.randomUUID();
  const dentistaInativo = crypto.randomUUID();
  tabelas.clinicas.push({
    id: CLINICA_ID,
    dentistas: [
      {
        id: dentistaAtivo,
        nome: 'Ana',
        ativo: true,
        modo: 'procedimento',
        procedimentos: [{ id: 'teste_limpeza', nome: 'Limpeza Teste', ativo: true, tempo: 45 }],
      },
      {
        id: dentistaInativo,
        nome: 'Carlos',
        ativo: false, // inativo, com duracao DIVERGENTE -- nunca pode gerar duracao_conflitante.
        modo: 'procedimento',
        procedimentos: [{ id: 'teste_limpeza', nome: 'Limpeza Teste', ativo: true, tempo: 999 }],
      },
    ],
  });
  semearProcedimento(tabelas);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarCatalogo(cliente, { clinica_id: CLINICA_ID });
  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;

  // o dentista inativo continua no catalogo (resolverDentista decide o resto)...
  assert.equal(resultado.catalogo.dentistas.length, 2);
  assert.ok(resultado.catalogo.dentistas.some((d) => d.dentista_id === dentistaInativo && d.ativo === false));
  // ...mas nunca projeta vinculo nem duracao: so a config do dentista ativo (45), nunca 999.
  assert.deepEqual(resultado.catalogo.vinculos, [
    { clinica_id: CLINICA_ID, dentista_id: dentistaAtivo, procedimento_id: 'teste_limpeza', ativo: true },
  ]);
  assert.deepEqual(resultado.catalogo.configuracoesDuracao, [
    { clinica_id: CLINICA_ID, procedimento_id: 'teste_limpeza', duracao_min: 45 },
  ]);
});

test('procedimento inativo no dentista: nunca vira vinculo nem configuracao', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const dentistaId = crypto.randomUUID();
  tabelas.clinicas.push({
    id: CLINICA_ID,
    dentistas: [
      {
        id: dentistaId,
        nome: 'Ana',
        ativo: true,
        modo: 'procedimento',
        procedimentos: [{ id: 'teste_limpeza', nome: 'Limpeza Teste', ativo: false, tempo: 45 }],
      },
    ],
  });
  semearProcedimento(tabelas);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarCatalogo(cliente, { clinica_id: CLINICA_ID });
  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.deepEqual(resultado.catalogo.vinculos, []);
  assert.deepEqual(resultado.catalogo.configuracoesDuracao, []);
});

// --- sinonimo informal "limpeza" (mecanismo de alias, escopo 2026-08-05) ---

test('procedimento cleaning: alias informal "limpeza" e adicionado, alem dos nomes oficiais', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.clinicas.push({ id: CLINICA_ID, dentistas: null });
  semearProcedimento(tabelas, { id: 'cleaning', nome_pt: 'Limpeza dental (profilaxia)', nome_es: null, nome_en: null });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarCatalogo(cliente, { clinica_id: CLINICA_ID });
  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;

  const alias = resultado.catalogo.aliasesProcedimento.find((a) => a.texto === 'limpeza');
  assert.ok(alias, '"limpeza" deve existir como alias');
  assert.equal(alias?.procedimento_id, 'cleaning');
  assert.equal(alias?.ativo, true);
  // nao substitui os aliases oficiais -- "Limpeza dental (profilaxia)" continua existindo.
  assert.ok(resultado.catalogo.aliasesProcedimento.some((a) => a.texto === 'Limpeza dental (profilaxia)'));
});

test('procedimento cleaning inativo: alias informal "limpeza" tambem fica inativo (mesma regra dos nomes oficiais)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.clinicas.push({ id: CLINICA_ID, dentistas: null });
  semearProcedimento(tabelas, {
    id: 'cleaning',
    nome_pt: 'Limpeza dental (profilaxia)',
    nome_es: null,
    nome_en: null,
    ativo: false,
  });
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarCatalogo(cliente, { clinica_id: CLINICA_ID });
  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;

  const alias = resultado.catalogo.aliasesProcedimento.find((a) => a.texto === 'limpeza');
  assert.equal(alias?.ativo, false);
});

test('procedimento sem sinonimo informal cadastrado (id diferente de "cleaning"): nenhum alias extra e inventado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.clinicas.push({ id: CLINICA_ID, dentistas: null });
  semearProcedimento(tabelas); // id: 'teste_limpeza', 3 nomes oficiais (pt/es/en)
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarCatalogo(cliente, { clinica_id: CLINICA_ID });
  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.equal(resultado.catalogo.aliasesProcedimento.length, 3);
});

test('registro de dentista malformado (sem id): ignorado, nunca inventa identidade', async () => {
  const tabelas = criarTabelasFalsasVazias();
  tabelas.clinicas.push({ id: CLINICA_ID, dentistas: [{ nome: 'Sem ID', ativo: true }, null, 'string solta'] });
  semearProcedimento(tabelas);
  const cliente = new ClienteFalso(tabelas);

  const resultado = await carregarCatalogo(cliente, { clinica_id: CLINICA_ID });
  assert.equal(resultado.tipo, 'carregado');
  if (resultado.tipo !== 'carregado') return;
  assert.deepEqual(resultado.catalogo.dentistas, []);
});
