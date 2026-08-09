// Preferencia de dentista de ponta a ponta -- specs/dentista-semantico-v1.md.
//
// O paciente nunca manda texto de nome: a interpretadora recebe
// `dentistas_disponiveis` e devolve `dentista_id`. O dublê de modelo aqui
// devolve o ID diretamente, que e exatamente o que a IA real produz -- a
// prova de que a IA CONSEGUE produzi-lo esta no runner contra a OpenAI real
// (src/eval/teste-real-dentista-semantico.ts), nunca aqui.
//
// Arquivo separado de orquestrador.test.ts de proposito: a montagem de
// clinica com vinculos por dentista e propria desta frente, e misturar as
// duas tornaria os dois arquivos mais dificeis de ler.
//
// Todos os dados sao sinteticos.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONSULTA_AVALIACAO_ID, processarMensagem } from './orquestrador.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso } from './teste-cliente-rpc-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
const INSTANTE_ATUAL = { data: '2026-08-03', minuto_min: 480 };
const PROCEDIMENTO = 'limpeza-teste';

/** Se a reserva for chamada por engano, o dublê lanca -- prova de isolamento. */
function rpcNuncaChamada(): ClienteRpcFalso {
  return new ClienteRpcFalso({});
}

function clienteModelo(procedimentoId: string, dentistaId?: string): ClienteModeloFalso {
  return new ClienteModeloFalso([
    {
      natureza_mensagem: 'pedido',
      alteracoes: {
        procedimento_id: { acao: 'informar', valor: procedimentoId },
        ...(dentistaId !== undefined ? { dentista_id: { acao: 'informar', valor: dentistaId } } : {}),
      },
    },
  ]);
}

/**
 * Dublê para o SEGUNDO turno em diante: usa `corrigir`, nao `informar`.
 *
 * Nao e detalhe de teste -- e o contrato real. Quando `procedimento_id` ja
 * existe em `dados_atuais`, um `informar` com valor diferente e tratado como
 * conflito por `preAplicar` e NAO e aplicado. A IA real emite `corrigir`
 * nesse caso (regra ja vigente nas instrucoes), e e isso que este dublê
 * reproduz.
 */
function clienteModeloCorrige(procedimentoId: string): ClienteModeloFalso {
  return new ClienteModeloFalso([
    {
      natureza_mensagem: 'resposta',
      alteracoes: { procedimento_id: { acao: 'corrigir', valor: procedimentoId } },
    },
  ]);
}

function itens(ids: readonly string[]) {
  return ids.map((id) => ({ id, nome: id, ativo: true, tempo: 30 }));
}

function dentistaReal(overrides: Record<string, unknown>) {
  return {
    nome: 'Sem Nome',
    titulo: 'Dr.',
    ativo: true,
    modo: 'procedimento',
    inicio: '08:00',
    fim: '12:00',
    sabado: false,
    alm_ini: null,
    alm_fim: null,
    procedimentos: [],
    ...overrides,
  };
}

function semearProcedimento(tabelas: TabelasFalsas, id: string, nomePt: string) {
  tabelas.procedimentos_catalogo.push({
    id,
    nome_pt: nomePt,
    nome_es: null,
    nome_en: null,
    nome_fr: null,
    nome_de: null,
    nome_it: null,
    nome_ru: null,
    nome_ar: null,
    tempo_padrao: 30,
    ativo: true,
  });
}

/**
 * Clinica com dois dentistas ativos e controle fino de vinculos: `fazAna` e
 * `fazBruno` decidem quais procedimentos cada um realiza.
 */
function semearClinica(
  tabelas: TabelasFalsas,
  fazAna: readonly string[],
  fazBruno: readonly string[],
  extras: Record<string, unknown>[] = []
): { clinicaId: string; anaId: string; brunoId: string } {
  const clinicaId = crypto.randomUUID();
  const anaId = crypto.randomUUID();
  const brunoId = crypto.randomUUID();

  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [
      dentistaReal({ id: anaId, nome: 'Ana Souza', titulo: 'Dra.', procedimentos: itens(fazAna) }),
      dentistaReal({ id: brunoId, nome: 'Bruno Lima', titulo: 'Dr.', procedimentos: itens(fazBruno) }),
      ...extras,
    ],
  });
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  semearProcedimento(tabelas, PROCEDIMENTO, 'Limpeza dental');
  semearProcedimento(tabelas, CONSULTA_AVALIACAO_ID, 'Consulta / Avaliação');

  return { clinicaId, anaId, brunoId };
}

async function processar(modelo: ClienteModeloFalso, tabelas: TabelasFalsas, ...mensagens: string[]) {
  return await processarMensagem(modelo, new ClienteFalso(tabelas), rpcNuncaChamada(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: mensagens,
    instante_atual: INSTANTE_ATUAL,
  });
}

// =====================================================================
// Entrada: o que chega a interpretadora
// =====================================================================

test('dentistas_disponiveis chega a interpretadora com todos os ATIVOS, so dentista_id e nome_exibido', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { anaId, brunoId } = semearClinica(tabelas, [], []);
  const modelo = clienteModelo(PROCEDIMENTO);

  await processar(modelo, tabelas, 'quero uma limpeza');

  const enviado = modelo.chamadas[0].payload.dentistas_disponiveis;
  const ordenado = [...(enviado ?? [])].sort((a, b) => (a.dentista_id < b.dentista_id ? -1 : 1));
  const esperado = [
    { dentista_id: anaId, nome_exibido: 'Dra. Ana Souza' },
    { dentista_id: brunoId, nome_exibido: 'Dr. Bruno Lima' },
  ].sort((a, b) => (a.dentista_id < b.dentista_id ? -1 : 1));

  assert.deepEqual(ordenado, esperado);
});

test('dentistas_disponiveis NAO e filtrada por aptidao -- quem nao faz o procedimento tambem aparece', async () => {
  const tabelas = criarTabelasFalsasVazias();
  // Ana faz limpeza; Bruno nao faz nada. Bruno PRECISA aparecer: senao a IA
  // nao teria como devolver o id dele, e o Core seguiria com Ana em silencio
  // -- exatamente o defeito que esta spec corrige.
  const { brunoId } = semearClinica(tabelas, [PROCEDIMENTO], []);
  const modelo = clienteModelo(PROCEDIMENTO);

  await processar(modelo, tabelas, 'quero uma limpeza');

  assert.ok(modelo.chamadas[0].payload.dentistas_disponiveis?.some((d) => d.dentista_id === brunoId));
});

test('dentista INATIVO nunca entra em dentistas_disponiveis', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const inativoId = crypto.randomUUID();
  semearClinica(tabelas, [PROCEDIMENTO], [], [dentistaReal({ id: inativoId, nome: 'Carlos', ativo: false })]);
  const modelo = clienteModelo(PROCEDIMENTO);

  await processar(modelo, tabelas, 'quero uma limpeza');

  assert.equal(modelo.chamadas[0].payload.dentistas_disponiveis?.some((d) => d.dentista_id === inativoId), false);
});

test('clinica sem nenhum dentista ativo: chave dentistas_disponiveis AUSENTE, nunca array vazio', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = crypto.randomUUID();
  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [dentistaReal({ id: crypto.randomUUID(), ativo: false })],
  });
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  semearProcedimento(tabelas, PROCEDIMENTO, 'Limpeza dental');
  const modelo = clienteModelo(PROCEDIMENTO);

  await processar(modelo, tabelas, 'quero uma limpeza');

  assert.equal('dentistas_disponiveis' in modelo.chamadas[0].payload, false);
});

// =====================================================================
// CASO 1 -- sem preferencia (secao 5)
// =====================================================================

test('CASO 1 -- varios aptos: aguardando_escolha_dentista, nunca escolhe sozinho', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [PROCEDIMENTO], [PROCEDIMENTO]);

  const resultado = await processar(clienteModelo(PROCEDIMENTO), tabelas, 'quero uma limpeza');

  assert.equal(resultado.decisao.tipo, 'aguardando_escolha_dentista');
});

test('CASO 1 -- um apto: segue direto, sem perguntar', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [PROCEDIMENTO], []);

  const resultado = await processar(clienteModelo(PROCEDIMENTO), tabelas, 'quero uma limpeza');

  assert.equal(resultado.decisao.tipo, 'aguardando_data_horario');
  assert.equal(resultado.substituicao_por_avaliacao, undefined);
});

test('CASO 1 -- zero aptos COM avaliacao possivel: oferece, e a oferta fica pendente no contexto', async () => {
  const tabelas = criarTabelasFalsasVazias();
  // Ninguem faz limpeza; Ana faz a avaliacao -> a alternativa e real.
  semearClinica(tabelas, [CONSULTA_AVALIACAO_ID], []);

  const resultado = await processar(clienteModelo(PROCEDIMENTO), tabelas, 'quero uma limpeza');

  assert.deepEqual(resultado.decisao, {
    tipo: 'sem_dentista_disponivel',
    procedimento_oferecido: CONSULTA_AVALIACAO_ID,
  });
  const linha = tabelas.estado_conversa[0] as unknown as { contexto_horarios: Record<string, unknown> | null };
  assert.deepEqual(linha.contexto_horarios?.oferta_procedimento_pendente, {
    procedimento_id: CONSULTA_AVALIACAO_ID,
  });
});

test('CASO 1 -- zero aptos SEM avaliacao possivel: nao oferece nada e nao grava oferta (guarda anti-ciclo)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  // Ninguem faz nada -- nem a avaliacao. Oferecer seria prometer o
  // impossivel, e aceitar levaria a oferecer a avaliacao de novo, em ciclo.
  semearClinica(tabelas, [], []);

  const resultado = await processar(clienteModelo(PROCEDIMENTO), tabelas, 'quero uma limpeza');

  assert.deepEqual(resultado.decisao, { tipo: 'sem_dentista_disponivel' });
  const linha = tabelas.estado_conversa[0] as unknown as { contexto_horarios: Record<string, unknown> | null };
  assert.equal(linha.contexto_horarios, null);
});

test('CASO 1 -- pedido que JA e a avaliacao e sem apto: nao oferece a avaliacao de novo (sem ciclo)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [], []);

  const resultado = await processar(clienteModelo(CONSULTA_AVALIACAO_ID), tabelas, 'quero uma avaliacao');

  assert.deepEqual(resultado.decisao, { tipo: 'sem_dentista_disponivel' });
});

test('oferta pendente: chega a interpretadora no turno seguinte', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [CONSULTA_AVALIACAO_ID], []);
  // Turno 1: pede limpeza, ninguem faz -> Iris oferece a avaliacao.
  await processar(clienteModelo(PROCEDIMENTO), tabelas, 'quero uma limpeza');

  // Turno 2: qualquer mensagem -- o que importa e o payload enviado.
  const modelo = clienteModelo(PROCEDIMENTO);
  await processar(modelo, tabelas, 'pode ser');

  // Chega como `true`, SEM o id: o procedimento ofertado fica so no snapshot
  // do Core, que e quem aplica (specs/contexto-pendente-interpretacao-v1.md
  // secao 11). Mandar o id para a IA era o que a puxava a emiti-lo.
  assert.equal(modelo.chamadas[0].payload.oferta_procedimento_pendente, true);
});

test('oferta pendente: uma DUVIDA sobre a oferta nao a destroi -- a aceitacao seguinte ainda funciona', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [CONSULTA_AVALIACAO_ID], []);

  // Turno 1: pede limpeza -> oferta gravada.
  await processar(clienteModelo(PROCEDIMENTO), tabelas, 'quero uma limpeza');

  // Turno 2: "quanto custa a avaliacao?" -- duvida, sem alteracao nenhuma.
  // Nao e recusa: a IA nao aceita, mas tambem nao cancela nada.
  const duvida = new ClienteModeloFalso([{ natureza_mensagem: 'duvida', alteracoes: {} }]);
  await processar(duvida, tabelas, 'quanto custa a avaliação?');

  // A oferta sobrevive -- nao por preservacao, mas porque a situacao nao
  // mudou e o fluxo RE-DERIVA sem_dentista_disponivel, regravando a oferta.
  const modelo = clienteModelo(PROCEDIMENTO);
  await processar(modelo, tabelas, 'pode ser');
  // Chega como `true`, SEM o id: o procedimento ofertado fica so no snapshot
  // do Core, que e quem aplica (specs/contexto-pendente-interpretacao-v1.md
  // secao 11). Mandar o id para a IA era o que a puxava a emiti-lo.
  assert.equal(modelo.chamadas[0].payload.oferta_procedimento_pendente, true);
});

test('oferta pendente: aceitar a oferta consome o snapshot -- a oferta nao fica pendurada', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [CONSULTA_AVALIACAO_ID], []);
  await processar(clienteModelo(PROCEDIMENTO), tabelas, 'quero uma limpeza');

  // A IA aceita: devolve o procedimento oferecido, como `corrigir` (o campo
  // ja tinha o procedimento original).
  await processar(clienteModeloCorrige(CONSULTA_AVALIACAO_ID), tabelas, 'pode ser');

  const linha = tabelas.estado_conversa[0] as unknown as {
    contexto_horarios: Record<string, unknown> | null;
    dados: Record<string, string>;
  };
  assert.equal(linha.dados.procedimento_id, CONSULTA_AVALIACAO_ID);
  assert.equal(linha.contexto_horarios?.oferta_procedimento_pendente, undefined);
});

test('oferta pendente: pedir OUTRO procedimento substitui a oferta, nunca a aceita em silencio', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [CONSULTA_AVALIACAO_ID, 'canal'], []);
  await processar(clienteModelo(PROCEDIMENTO), tabelas, 'quero uma limpeza');

  // A IA resolve o pedido novo pela regra normal de procedimento.
  await processar(clienteModeloCorrige('canal'), tabelas, 'na verdade quero um canal');

  const linha = tabelas.estado_conversa[0] as unknown as { dados: Record<string, string> };
  assert.equal(linha.dados.procedimento_id, 'canal');
});

// =====================================================================
// CASO 2 -- com preferencia explicita (secao 5)
// =====================================================================

test('CASO 2.1 -- o dentista escolhido FAZ o procedimento: segue com o par pedido', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { anaId } = semearClinica(tabelas, [PROCEDIMENTO], [PROCEDIMENTO]);

  const resultado = await processar(clienteModelo(PROCEDIMENTO, anaId), tabelas, 'limpeza com a Ana');

  // Nao caiu em aguardando_escolha_dentista, apesar de haver dois aptos:
  // a preferencia resolveu.
  assert.equal(resultado.decisao.tipo, 'aguardando_data_horario');
  assert.equal(resultado.substituicao_por_avaliacao, undefined);
});

test('CASO 2.3 -- nao faz o procedimento mas faz avaliacao: preserva o dentista e troca o procedimento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { brunoId } = semearClinica(tabelas, [PROCEDIMENTO], [CONSULTA_AVALIACAO_ID]);

  const resultado = await processar(clienteModelo(PROCEDIMENTO, brunoId), tabelas, 'limpeza com o Bruno');

  assert.deepEqual(resultado.substituicao_por_avaliacao, { dentista_nome_exibido: 'Dr. Bruno Lima' });
  assert.equal(resultado.decisao.tipo, 'aguardando_data_horario');
});

test('CASO 2.3 -- a existencia de OUTRO dentista apto nunca autoriza troca silenciosa de profissional', async () => {
  const tabelas = criarTabelasFalsasVazias();
  // Ana esta apta a limpeza pedida. O comportamento antigo (fallback
  // silencioso de resolverDentistaComFallback) seguiria com ela. O novo
  // preserva Bruno e troca o procedimento.
  const { anaId, brunoId } = semearClinica(tabelas, [PROCEDIMENTO], [CONSULTA_AVALIACAO_ID]);

  const resultado = await processar(clienteModelo(PROCEDIMENTO, brunoId), tabelas, 'limpeza com o Bruno', 'amanha');

  assert.equal(
    JSON.stringify(resultado).includes(anaId),
    false,
    'nenhuma parte do resultado pode apontar para o dentista que o paciente NAO escolheu'
  );
  assert.deepEqual(resultado.substituicao_por_avaliacao, { dentista_nome_exibido: 'Dr. Bruno Lima' });
});

test('CASO 2.3 falho -- nao faz o procedimento NEM a avaliacao: combinacao_indisponivel', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { brunoId } = semearClinica(tabelas, [PROCEDIMENTO], []);

  const resultado = await processar(clienteModelo(PROCEDIMENTO, brunoId), tabelas, 'limpeza com o Bruno');

  assert.deepEqual(resultado.decisao, { tipo: 'combinacao_indisponivel', dentista_nome_exibido: 'Dr. Bruno Lima' });
});

test('CASO 2.2 -- o pedido JA e a avaliacao e o dentista nao tem vinculo com ela: combinacao_indisponivel, sem ciclo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { brunoId } = semearClinica(tabelas, [CONSULTA_AVALIACAO_ID], []);

  const resultado = await processar(clienteModelo(CONSULTA_AVALIACAO_ID, brunoId), tabelas, 'uma avaliacao com o Bruno');

  // Nunca oferece avaliacao de novo (seria ciclo) e nunca sugere a Ana.
  assert.deepEqual(resultado.decisao, { tipo: 'combinacao_indisponivel', dentista_nome_exibido: 'Dr. Bruno Lima' });
  assert.equal(resultado.substituicao_por_avaliacao, undefined);
});

test('CASO 2.3 falho -- avaliacao INATIVA no catalogo tambem produz combinacao_indisponivel', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { brunoId } = semearClinica(tabelas, [PROCEDIMENTO], [CONSULTA_AVALIACAO_ID]);
  const avaliacao = tabelas.procedimentos_catalogo.find((p) => (p as { id: string }).id === CONSULTA_AVALIACAO_ID);
  (avaliacao as { ativo: boolean }).ativo = false;

  const resultado = await processar(clienteModelo(PROCEDIMENTO, brunoId), tabelas, 'limpeza com o Bruno');

  assert.deepEqual(resultado.decisao, { tipo: 'combinacao_indisponivel', dentista_nome_exibido: 'Dr. Bruno Lima' });
});

// =====================================================================
// Integridade: preferencia invalida nunca vira conversa
// =====================================================================

test('dentista_id inexistente colapsa em sem preferencia', async () => {
  for (const idInvalido of [crypto.randomUUID(), 'nao-existe']) {
    const tabelas = criarTabelasFalsasVazias();
    semearClinica(tabelas, [PROCEDIMENTO], [PROCEDIMENTO]);

    const resultado = await processar(clienteModelo(PROCEDIMENTO, idInvalido), tabelas, 'quero limpeza');

    // Dois aptos e nenhuma preferencia valida -> pergunta, como sempre.
    assert.equal(resultado.decisao.tipo, 'aguardando_escolha_dentista');
  }
});

test('id COMPOSTO (dois ids concatenados) colapsa em sem preferencia -- a Iris pergunta, nunca escolhe um dos dois', async () => {
  // Nao e hipotese: contra a OpenAI real, diante de dois candidatos
  // plausiveis ("quero com o Carlos", com dois Carlos na lista), o modelo
  // devolve os dois ids concatenados em vez de omitir -- reproduzido 3/3 em
  // 2026-08-09, ver src/eval/teste-real-dentista-semantico.ts.
  //
  // ESTE teste e a garantia do produto nesse caso: o id composto nao existe
  // no catalogo, a validacao de integridade o rejeita, e o fluxo cai em
  // "sem preferencia" -> dois aptos -> pergunta. O comportamento correto vem
  // do Core, nao da obediencia do modelo.
  const tabelas = criarTabelasFalsasVazias();
  const { anaId, brunoId } = semearClinica(tabelas, [PROCEDIMENTO], [PROCEDIMENTO]);

  const resultado = await processar(clienteModelo(PROCEDIMENTO, `${anaId},${brunoId}`), tabelas, 'quero com o Carlos');

  assert.equal(resultado.decisao.tipo, 'aguardando_escolha_dentista');
});

test('dentista de OUTRA clinica nunca vale como preferencia (isolamento)', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [PROCEDIMENTO], [PROCEDIMENTO]);
  const outroId = crypto.randomUUID();
  tabelas.clinicas.push({
    id: crypto.randomUUID(),
    provider: PROVIDER,
    instancia_whatsapp: 'outra-instancia',
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [dentistaReal({ id: outroId, nome: 'Intruso', procedimentos: itens([PROCEDIMENTO]) })],
  });

  const resultado = await processar(clienteModelo(PROCEDIMENTO, outroId), tabelas, 'com o Intruso');

  assert.equal(resultado.decisao.tipo, 'aguardando_escolha_dentista');
  assert.equal(JSON.stringify(resultado).includes('Intruso'), false);
});

test('dentista INATIVO escolhido pela IA nao vale como preferencia', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const inativoId = crypto.randomUUID();
  semearClinica(tabelas, [PROCEDIMENTO], [], [dentistaReal({ id: inativoId, nome: 'Carlos', ativo: false })]);

  const resultado = await processar(clienteModelo(PROCEDIMENTO, inativoId), tabelas, 'com o Carlos');

  // Cai em sem preferencia -> um apto (Ana) -> segue.
  assert.equal(resultado.decisao.tipo, 'aguardando_data_horario');
  assert.equal(resultado.substituicao_por_avaliacao, undefined);
});

// =====================================================================
// A substituicao e do turno, nunca do estado
// =====================================================================

test('a substituicao por avaliacao NAO e persistida em dados.procedimento_id', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { brunoId } = semearClinica(tabelas, [PROCEDIMENTO], [CONSULTA_AVALIACAO_ID]);

  await processar(clienteModelo(PROCEDIMENTO, brunoId), tabelas, 'limpeza com o Bruno');

  const linha = tabelas.estado_conversa[0] as unknown as { dados: Record<string, string> };
  assert.equal(
    linha.dados.procedimento_id,
    PROCEDIMENTO,
    'o que o paciente pediu continua no estado; a troca vale so para este turno e e re-derivada no proximo'
  );
});

// =====================================================================
// aceitar_opcao -- specs/eventos-conversacionais-v1.md (fatia minima)
//
// O evento e CANDIDATO: a IA diz "parece aceitacao"; quem aplica e o Core,
// com o id que ELE guardou. Estes testes cobrem exatamente essa fronteira.
// =====================================================================

/** Dublê que devolve o evento de aceitacao, e NENHUM procedimento_id. */
function clienteModeloAceita(referencia: string | null = null): ClienteModeloFalso {
  return new ClienteModeloFalso([
    {
      natureza_mensagem: 'resposta',
      alteracoes: {},
      eventos_candidatos: [{ tipo: 'aceitar_opcao', referencia_textual: referencia }],
    },
  ]);
}

test('aceitar_opcao COM oferta pendente: o Core aplica o procedimento que ELE guardou', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [CONSULTA_AVALIACAO_ID], []);
  await processar(clienteModelo(PROCEDIMENTO), tabelas, 'quero uma limpeza');

  await processar(clienteModeloAceita(), tabelas, 'pode ser');

  const linha = tabelas.estado_conversa[0] as unknown as { dados: Record<string, string> };
  assert.equal(linha.dados.procedimento_id, CONSULTA_AVALIACAO_ID);
});

test('aceitar_opcao SEM oferta pendente e IGNORADO -- a IA nao aplica procedimento por conta propria', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [PROCEDIMENTO], []);

  // Nenhuma oferta foi feita; o evento chega mesmo assim.
  await processar(clienteModeloAceita(), tabelas, 'pode ser');

  const linha = tabelas.estado_conversa[0] as unknown as { dados: Record<string, string> };
  assert.equal(linha.dados.procedimento_id, undefined);
});

test('aceitar_opcao com referencia_textual preenchida tambem funciona -- a referencia nao vira id', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [CONSULTA_AVALIACAO_ID], []);
  await processar(clienteModelo(PROCEDIMENTO), tabelas, 'quero uma limpeza');

  // A IA nunca resolve a referencia para ID (eventos-conversacionais-v1.md
  // secao 2). Mesmo com um texto arbitrario aqui, o id aplicado e o do
  // snapshot -- este teste falharia se alguem usasse a referencia como id.
  await processar(clienteModeloAceita('essa avaliação aí'), tabelas, 'pode ser essa avaliação aí');

  const linha = tabelas.estado_conversa[0] as unknown as { dados: Record<string, string> };
  assert.equal(linha.dados.procedimento_id, CONSULTA_AVALIACAO_ID);
});

test('pedido explicito na MESMA mensagem vence a oferta -- nunca sobrescreve o que o paciente acabou de dizer', async () => {
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [CONSULTA_AVALIACAO_ID, 'canal'], []);
  await processar(clienteModelo(PROCEDIMENTO), tabelas, 'quero uma limpeza');

  // A IA emite o evento E um procedimento explicito. O explicito prevalece.
  const ambos = new ClienteModeloFalso([
    {
      natureza_mensagem: 'correcao',
      alteracoes: { procedimento_id: { acao: 'corrigir', valor: 'canal' } },
      eventos_candidatos: [{ tipo: 'aceitar_opcao', referencia_textual: null }],
    },
  ]);
  await processar(ambos, tabelas, 'na verdade quero um canal');

  const linha = tabelas.estado_conversa[0] as unknown as { dados: Record<string, string> };
  assert.equal(linha.dados.procedimento_id, 'canal');
});

test('a acao e decidida pelo Core: informar quando nao havia procedimento, corrigir quando havia', async () => {
  // (a) HAVIA outro procedimento -> precisa ser `corrigir`, senao preAplicar
  // trata como conflito e a aceitacao some em silencio.
  const comAnterior = criarTabelasFalsasVazias();
  semearClinica(comAnterior, [CONSULTA_AVALIACAO_ID], []);
  await processar(clienteModelo(PROCEDIMENTO), comAnterior, 'quero uma limpeza');
  await processar(clienteModeloAceita(), comAnterior, 'pode ser');
  const linhaComAnterior = comAnterior.estado_conversa[0] as unknown as { dados: Record<string, string> };
  assert.equal(linhaComAnterior.dados.procedimento_id, CONSULTA_AVALIACAO_ID);

  // (b) NAO havia procedimento: o Core usa `informar`, e aplica igual.
  const semAnterior = criarTabelasFalsasVazias();
  semearClinica(semAnterior, [CONSULTA_AVALIACAO_ID], []);
  const linhaSemAnterior = semAnterior.estado_conversa[0] as unknown as {
    dados: Record<string, string>;
    contexto_horarios: unknown;
  };
  linhaSemAnterior.contexto_horarios = {
    oferta_procedimento_pendente: { procedimento_id: CONSULTA_AVALIACAO_ID },
    criado_em: new Date().toISOString(),
  };
  await processar(clienteModeloAceita(), semAnterior, 'pode ser');
  assert.equal(linhaSemAnterior.dados.procedimento_id, CONSULTA_AVALIACAO_ID);
});

test('aceitar_opcao junto de natureza=negacao NAO aplica -- sinais incompativeis nunca autorizam acao', async () => {
  // Achado real (2026-08-09): "prefiro outra coisa" faz o modelo devolver
  // `negacao` E `aceitar_opcao` ao mesmo tempo. Sem esta checagem, o paciente
  // recusa e acaba com a oferta aplicada.
  const tabelas = criarTabelasFalsasVazias();
  semearClinica(tabelas, [CONSULTA_AVALIACAO_ID], []);
  await processar(clienteModelo(PROCEDIMENTO), tabelas, 'quero uma limpeza');

  const contraditorio = new ClienteModeloFalso([
    {
      natureza_mensagem: 'negacao',
      alteracoes: {},
      eventos_candidatos: [{ tipo: 'aceitar_opcao', referencia_textual: null }],
    },
  ]);
  await processar(contraditorio, tabelas, 'prefiro outra coisa');

  const linha = tabelas.estado_conversa[0] as unknown as { dados: Record<string, string> };
  assert.equal(linha.dados.procedimento_id, PROCEDIMENTO, 'a oferta nao pode ser aplicada quando a mensagem e uma negacao');
});
