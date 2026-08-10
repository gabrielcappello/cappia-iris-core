// Troca de telefone quando o CPF ja pertence a outra ficha da mesma clinica
// -- specs/cpf-outro-telefone-v1.md, que implementa persistencia-v1.md secao 6.
//
// Arquivo separado de orquestrador-cadastro.test.ts pelo mesmo criterio que
// separou aquele de orquestrador.test.ts: a montagem de cenario aqui exige um
// contexto pendente proprio e um segundo dublê de RPC.
//
// A secao 7 (telefone atual pertencente a outro paciente) NAO e resolvida
// nesta rodada -- so detectada. Os testes abaixo provam a deteccao e a
// ausencia de escrita, nunca uma transferencia.
//
// Todos os dados sao SINTETICOS. As frases seguem o registro real de WhatsApp
// (docs/00-principios.md, principio dos testes realistas): curtas, com a
// pontuacao e a naturalidade de um paciente de verdade.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso, type RespostaRpc } from './teste-cliente-rpc-falso.ts';

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';
const INSTANTE_ATUAL = { data: '2026-08-03', minuto_min: 480 };

const NOME_SINTETICO = 'Gabriel Cappello';
const CPF_SINTETICO_VALIDO = '52998224725';
const NASCIMENTO_SINTETICO = '1985-05-10';

// Ficha que ja possui o CPF, em OUTRO telefone. O Core nunca a le -- ela existe
// so para dar sentido ao id devolvido pela RPC.
const PACIENTE_DONO_DO_CPF = 'c0ffee00-0000-4000-8000-00000000d0c0';

function montarCenario(tabelas: TabelasFalsas) {
  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const clinicaId = crypto.randomUUID();

  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas: [
      {
        id: dentistaId,
        nome: 'Ana',
        titulo: 'Dra.',
        ativo: true,
        modo: 'auto',
        dur: 30,
        inicio: '08:00',
        fim: '12:00',
        sabado: false,
        alm_ini: null,
        alm_fim: null,
        procedimentos: [{ id: procedimentoId, nome: 'Limpeza', ativo: true, tempo: 999 }],
      },
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
  tabelas.procedimentos_catalogo.push({
    id: procedimentoId,
    nome_pt: 'Limpeza',
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
  return { clinicaId, procedimentoId, dentistaId };
}

/** Marca a pergunta como pendente, exatamente como o Core a grava. */
function comPerguntaPendente(tabelas: TabelasFalsas): void {
  const linha = tabelas.estado_conversa[0] as unknown as { contexto_horarios: unknown };
  linha.contexto_horarios = { troca_telefone_pendente: true, criado_em: new Date().toISOString() };
}

function linhaConversa(tabelas: TabelasFalsas) {
  return tabelas.estado_conversa[0] as unknown as {
    dados: Record<string, string>;
    contexto_horarios: Record<string, unknown> | null;
  };
}

/**
 * Janela completa: escolha, confirmacao e os tres dados cadastrais. E o estado
 * em que o fluxo realmente alcanca a persistencia -- o cadastro so e pedido
 * DEPOIS da confirmacao do horario.
 */
function clienteModelo(
  procedimentoId: string,
  eventos?: Record<string, unknown>[],
  natureza: string = 'resposta'
): ClienteModeloFalso {
  return new ClienteModeloFalso([
    {
      natureza_mensagem: natureza,
      alteracoes: {
        procedimento_id: { acao: 'informar', valor: procedimentoId },
        data_texto: { acao: 'informar', valor: 'hoje' },
        horario_texto: { acao: 'informar', valor: '10:00' },
        confirmacao: { acao: 'informar', valor: 'sim' },
        nome: { acao: 'informar', valor: NOME_SINTETICO },
        cpf: { acao: 'informar', valor: CPF_SINTETICO_VALIDO },
        data_nascimento: { acao: 'informar', valor: NASCIMENTO_SINTETICO },
      },
      ...(eventos !== undefined ? { eventos_candidatos: eventos } : {}),
    },
  ]);
}

const CPF_JA_CADASTRADO: RespostaRpc = {
  data: { sucesso: false, motivo: 'cpf_ja_cadastrado' },
  error: null,
};

function trocaOk(): RespostaRpc {
  return { data: { sucesso: true, paciente_id: PACIENTE_DONO_DO_CPF }, error: null };
}

function respostaReservaOk(dentistaId: string): RespostaRpc {
  return {
    data: {
      sucesso: true,
      agendamento_id: crypto.randomUUID(),
      dentista_id: dentistaId,
      duracao_min: 30,
      data: '2026-08-03',
      horario: '10:00',
    },
    error: null,
  };
}

async function processar(tabelas: TabelasFalsas, modelo: ClienteModeloFalso, rpc: ClienteRpcFalso, mensagem: string) {
  return await processarMensagem(modelo, new ClienteFalso(tabelas), rpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: [mensagem],
    instante_atual: INSTANTE_ATUAL,
  });
}

// --- A pergunta ---

test('CPF de outra ficha vira PERGUNTA, nunca duplicata: nada e escrito e o marcador fica pendente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  const rpc = new ClienteRpcFalso({ cappia_persistir_paciente: CPF_JA_CADASTRADO });

  const resultado = await processar(
    tabelas,
    clienteModelo(procedimentoId),
    rpc,
    'sou Gabriel Cappello, 529.982.247-25, nasci em 10/05/1985'
  );

  assert.deepEqual(resultado.decisao, { tipo: 'troca_telefone_pendente' });
  assert.deepEqual(
    rpc.chamadas.map((c) => c.nome),
    ['cappia_persistir_paciente'],
    'nem troca nem reserva sao tentadas antes de o paciente responder'
  );
  assert.equal(
    linhaConversa(tabelas).contexto_horarios?.troca_telefone_pendente,
    true,
    'o marcador precisa ficar gravado, senao a resposta do turno seguinte chega sem pergunta declarada'
  );
});

// --- SIM ---

test('SIM: troca exatamente uma ficha, reserva com o paciente_id do dono do CPF', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId } = montarCenario(tabelas);
  comPerguntaPendente(tabelas);
  const rpc = new ClienteRpcFalso({
    cappia_trocar_telefone_paciente: trocaOk(),
    cappia_reservar_agendamento: respostaReservaOk(dentistaId),
  });

  const resultado = await processar(
    tabelas,
    clienteModelo(procedimentoId, [{ tipo: 'aceitar_troca_telefone', referencia_textual: null }]),
    rpc,
    'pode sim, atualiza pro meu numero'
  );

  assert.equal(resultado.decisao.tipo, 'reserva_criada');

  // A ORDEM importa: troca primeiro, reserva depois, no MESMO processamento.
  // `cappia_persistir_paciente` nunca aparece -- o paciente ja existe.
  assert.deepEqual(rpc.chamadas.map((c) => c.nome), [
    'cappia_trocar_telefone_paciente',
    'cappia_reservar_agendamento',
  ]);

  // A troca recebe exatamente clinica + CPF + telefone desta conversa, e nada
  // mais: nenhum paciente_id, nenhum dado da outra ficha (spec secao 4).
  assert.deepEqual(rpc.chamadas[0].parametros, {
    p_clinica_id: clinicaId,
    p_cpf: CPF_SINTETICO_VALIDO,
    p_telefone_normalizado: TELEFONE,
  });

  // O id devolvido pela RPC e o que vai para a reserva -- nunca um id novo,
  // nunca o `paciente_id` (nulo) do estado da conversa.
  assert.equal(rpc.chamadas[1].parametros.p_paciente_id, PACIENTE_DONO_DO_CPF);
});

test('SIM: contexto pendente e limpo depois de resolvido', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId, dentistaId } = montarCenario(tabelas);
  comPerguntaPendente(tabelas);
  const rpc = new ClienteRpcFalso({
    cappia_trocar_telefone_paciente: trocaOk(),
    cappia_reservar_agendamento: respostaReservaOk(dentistaId),
  });

  await processar(
    tabelas,
    clienteModelo(procedimentoId, [{ tipo: 'aceitar_troca_telefone', referencia_textual: null }]),
    rpc,
    'pode sim, atualiza pro meu numero'
  );

  assert.equal(linhaConversa(tabelas).contexto_horarios, null, 'pergunta respondida nao pode continuar pendurada');
});

// --- NAO ---

test('NAO: nenhuma escrita, nenhum paciente novo, e o agendamento NAO continua', async () => {
  // A recusa NAO tem evento proprio (medido contra a IA real: um evento de
  // recusa e emitido em ZERO casos). Ela vem de `natureza_mensagem=negacao`,
  // combinada com a pergunta pendente -- nenhum evento na saida.
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  comPerguntaPendente(tabelas);
  const rpc = new ClienteRpcFalso({});

  const resultado = await processar(
    tabelas,
    clienteModelo(procedimentoId, [], 'negacao'),
    rpc,
    'nao, deixa como esta'
  );

  assert.deepEqual(resultado.decisao, { tipo: 'troca_telefone_recusada' });
  // Zero RPCs: nem troca, nem persistencia, nem reserva. Esta assercao e a
  // REVOGACAO da regra antiga de persistencia-v1.md secao 6, que mandava o
  // agendamento continuar normalmente apos a recusa.
  assert.equal(rpc.chamadas.length, 0);
  assert.equal(tabelas.pacientes.length, 0, 'recusar nunca cria paciente');
  assert.equal(linhaConversa(tabelas).contexto_horarios, null, 'a pergunta deixou de existir');
});

test('SINAIS INCOMPATIVEIS: negacao junto do evento de aceite NUNCA troca telefone', async () => {
  // Medido contra a IA real em 2026-08-10: "nao, deixa como esta" chegou com
  // `natureza=negacao` E `aceitar_troca_telefone` no mesmo turno. Se o evento
  // vencesse, uma recusa explicita viraria troca de telefone -- o unico
  // desfecho inaceitavel desta spec.
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  comPerguntaPendente(tabelas);
  const rpc = new ClienteRpcFalso({});

  const resultado = await processar(
    tabelas,
    clienteModelo(procedimentoId, [{ tipo: 'aceitar_troca_telefone', referencia_textual: null }], 'negacao'),
    rpc,
    'nao, deixa como esta'
  );

  assert.deepEqual(resultado.decisao, { tipo: 'troca_telefone_recusada' });
  assert.equal(rpc.chamadas.length, 0, 'nenhuma escrita: a negacao vence o evento');
});

test('SINAIS INCOMPATIVEIS: duvida junto do evento de aceite NUNCA troca telefone', async () => {
  // Medido contra a IA real em 2026-08-10, ~1 em 5 execucoes: "por que voces
  // precisam disso?" chegou com `natureza=duvida` E `aceitar_troca_telefone`.
  // Sem guarda, uma PERGUNTA trocava o telefone sem a confirmacao explicita
  // que persistencia-v1.md secao 6 exige.
  //
  // Desfecho e `pendente`, nunca `recusada`: quem so quis entender o motivo
  // nao teve o agendamento encerrado -- a Iris repergunta.
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  comPerguntaPendente(tabelas);
  const rpc = new ClienteRpcFalso({ cappia_persistir_paciente: CPF_JA_CADASTRADO });

  const resultado = await processar(
    tabelas,
    clienteModelo(procedimentoId, [{ tipo: 'aceitar_troca_telefone', referencia_textual: null }], 'duvida'),
    rpc,
    'por que voces precisam disso?'
  );

  assert.deepEqual(resultado.decisao, { tipo: 'troca_telefone_pendente' });
  assert.ok(
    !rpc.chamadas.some((c) => c.nome === 'cappia_trocar_telefone_paciente'),
    'uma duvida jamais autoriza alteracao de telefone'
  );
  assert.equal(linhaConversa(tabelas).contexto_horarios?.troca_telefone_pendente, true);
});

test('negacao SEM pergunta pendente nao vira recusa de troca', async () => {
  // O gate vale nos DOIS sentidos: sem marcador, `negacao` e so uma negacao
  // qualquer da conversa, nunca resposta a uma pergunta que nao foi feita.
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  const rpc = new ClienteRpcFalso({ cappia_persistir_paciente: CPF_JA_CADASTRADO });

  const resultado = await processar(tabelas, clienteModelo(procedimentoId, [], 'negacao'), rpc, 'nao, deixa como esta');

  assert.notDeepEqual(resultado.decisao, { tipo: 'troca_telefone_recusada' });
  assert.ok(!rpc.chamadas.some((c) => c.nome === 'cappia_trocar_telefone_paciente'));
});

test('FALHA SEGURA: recusa que a IA nao classificou como negacao apenas repergunta, nunca troca', async () => {
  // Medido 1/15 contra a IA real: uma recusa pode vir com natureza `resposta`.
  // O desfecho tem de ser "pergunta de novo" -- nunca uma troca por engano,
  // que e o unico resultado inaceitavel aqui.
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  comPerguntaPendente(tabelas);
  const rpc = new ClienteRpcFalso({ cappia_persistir_paciente: CPF_JA_CADASTRADO });

  const resultado = await processar(
    tabelas,
    clienteModelo(procedimentoId, [], 'resposta'),
    rpc,
    'prefiro manter o outro'
  );

  assert.deepEqual(resultado.decisao, { tipo: 'troca_telefone_pendente' });
  assert.ok(
    !rpc.chamadas.some((c) => c.nome === 'cappia_trocar_telefone_paciente'),
    'jamais troca telefone quando a resposta nao foi entendida'
  );
  assert.equal(linhaConversa(tabelas).contexto_horarios?.troca_telefone_pendente, true);
});

// --- Sem resposta ---

test('sem responder: a pergunta sobrevive e nada e trocado', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  comPerguntaPendente(tabelas);
  const rpc = new ClienteRpcFalso({ cappia_persistir_paciente: CPF_JA_CADASTRADO });

  // Uma duvida no meio nao responde a pergunta -- e a IA nao emite o evento.
  const resultado = await processar(tabelas, clienteModelo(procedimentoId), rpc, 'por que voces precisam disso?');

  assert.deepEqual(resultado.decisao, { tipo: 'troca_telefone_pendente' });
  assert.ok(
    !rpc.chamadas.some((c) => c.nome === 'cappia_trocar_telefone_paciente'),
    'sem resposta explicita, nenhum telefone e trocado'
  );
  assert.equal(
    linhaConversa(tabelas).contexto_horarios?.troca_telefone_pendente,
    true,
    'o marcador e RE-DERIVADO, nunca perdido enquanto a situacao nao muda'
  );
});

// --- Isolamento (par A/B) ---

test('ISOLAMENTO A/B: a MESMA frase so autoriza a troca quando a pergunta estava pendente', async () => {
  // Par A/B exigido por docs/00-principios.md (principio do teste isolado):
  // mesma mensagem, mesmo evento vindo da IA, variando SO a presenca do
  // marcador oficial. Os dois lados precisam DIFERIR -- se nao diferissem, o
  // teste passaria mesmo com o gate quebrado.
  const eventos = [{ tipo: 'aceitar_troca_telefone', referencia_textual: null }];
  const frase = 'pode sim, atualiza pro meu numero';

  // (A) SEM marcador: o evento chega, mas o Core o ignora. Cai no caminho
  // normal de persistencia, que devolve o conflito e volta a PERGUNTAR.
  const semMarcador = criarTabelasFalsasVazias();
  const cenarioA = montarCenario(semMarcador);
  const rpcA = new ClienteRpcFalso({ cappia_persistir_paciente: CPF_JA_CADASTRADO });
  const resultadoA = await processar(semMarcador, clienteModelo(cenarioA.procedimentoId, eventos), rpcA, frase);

  // (B) COM marcador: o mesmo evento autoriza a troca.
  const comMarcador = criarTabelasFalsasVazias();
  const cenarioB = montarCenario(comMarcador);
  comPerguntaPendente(comMarcador);
  const rpcB = new ClienteRpcFalso({
    cappia_trocar_telefone_paciente: trocaOk(),
    cappia_reservar_agendamento: respostaReservaOk(cenarioB.dentistaId),
  });
  const resultadoB = await processar(comMarcador, clienteModelo(cenarioB.procedimentoId, eventos), rpcB, frase);

  assert.notDeepEqual(resultadoA.decisao, resultadoB.decisao, 'os dois lados PRECISAM diferir');
  assert.deepEqual(resultadoA.decisao, { tipo: 'troca_telefone_pendente' });
  assert.equal(resultadoB.decisao.tipo, 'reserva_criada');
  assert.ok(
    !rpcA.chamadas.some((c) => c.nome === 'cappia_trocar_telefone_paciente'),
    'evento sem pergunta pendente NUNCA troca telefone'
  );
  assert.ok(rpcB.chamadas.some((c) => c.nome === 'cappia_trocar_telefone_paciente'));
});

test('a confirmacao do AGENDAMENTO nunca autoriza a troca de telefone', async () => {
  // `dados.confirmacao === 'sim'` ja esta presente neste ponto do fluxo -- foi
  // o que autorizou o horario. Ler isso como consentimento para alterar
  // cadastro e o caso mais grave que a spec existe para impedir
  // (specs/cpf-outro-telefone-v1.md secao 2).
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  comPerguntaPendente(tabelas);
  const rpc = new ClienteRpcFalso({ cappia_persistir_paciente: CPF_JA_CADASTRADO });

  // Sem o evento de aceite, apesar de confirmacao=sim na janela.
  const resultado = await processar(tabelas, clienteModelo(procedimentoId), rpc, 'isso, pode confirmar');

  assert.equal(linhaConversa(tabelas).dados.confirmacao, 'sim', 'a confirmacao do horario esta mesmo presente');
  assert.deepEqual(resultado.decisao, { tipo: 'troca_telefone_pendente' });
  assert.ok(
    !rpc.chamadas.some((c) => c.nome === 'cappia_trocar_telefone_paciente'),
    'confirmacao de horario NUNCA vira autorizacao de troca de telefone'
  );
});

test('aceitar_opcao nao serve como resposta: nenhum outro evento autoriza a troca', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  comPerguntaPendente(tabelas);
  const rpc = new ClienteRpcFalso({ cappia_persistir_paciente: CPF_JA_CADASTRADO });

  const resultado = await processar(
    tabelas,
    clienteModelo(procedimentoId, [{ tipo: 'aceitar_opcao', referencia_textual: null }]),
    rpc,
    'pode ser'
  );

  assert.deepEqual(resultado.decisao, { tipo: 'troca_telefone_pendente' });
  assert.ok(
    !rpc.chamadas.some((c) => c.nome === 'cappia_trocar_telefone_paciente'),
    'so aceitar_troca_telefone responde a esta pergunta'
  );
});

// --- Desfechos tecnicos terminais ---

test('telefone ja pertence a outro paciente (secao 7): detecta, NAO escreve, encaminha a recepcao', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  comPerguntaPendente(tabelas);
  const rpc = new ClienteRpcFalso({
    cappia_trocar_telefone_paciente: {
      data: { sucesso: false, motivo: 'telefone_de_outro_paciente' },
      error: null,
    },
  });

  const resultado = await processar(
    tabelas,
    clienteModelo(procedimentoId, [{ tipo: 'aceitar_troca_telefone', referencia_textual: null }]),
    rpc,
    'pode sim, atualiza pro meu numero'
  );

  assert.deepEqual(resultado.decisao, { tipo: 'cpf_ja_cadastrado' });
  assert.deepEqual(
    rpc.chamadas.map((c) => c.nome),
    ['cappia_trocar_telefone_paciente'],
    'a reserva nunca acontece, e a secao 7 nao e resolvida nesta rodada'
  );
  assert.equal(linhaConversa(tabelas).contexto_horarios, null);
});

test('CPF sumiu entre a pergunta e a resposta: nao escreve e nao reserva', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  comPerguntaPendente(tabelas);
  const rpc = new ClienteRpcFalso({
    cappia_trocar_telefone_paciente: { data: { sucesso: false, motivo: 'cpf_nao_encontrado' }, error: null },
  });

  const resultado = await processar(
    tabelas,
    clienteModelo(procedimentoId, [{ tipo: 'aceitar_troca_telefone', referencia_textual: null }]),
    rpc,
    'pode sim, atualiza pro meu numero'
  );

  assert.deepEqual(resultado.decisao, { tipo: 'cpf_ja_cadastrado' });
  assert.deepEqual(rpc.chamadas.map((c) => c.nome), ['cappia_trocar_telefone_paciente']);
});

// --- PII ---

test('nenhum dado da outra ficha atravessa a fronteira do modelo', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenario(tabelas);
  comPerguntaPendente(tabelas);
  const rpc = new ClienteRpcFalso({ cappia_persistir_paciente: CPF_JA_CADASTRADO });
  const modelo = clienteModelo(procedimentoId);

  await processar(tabelas, modelo, rpc, 'por que voces precisam disso?');

  const payload = modelo.chamadas[0].payload as unknown as Record<string, unknown>;
  // O marcador e um booleano nu: nem CPF, nem paciente_id, nem telefone
  // anterior, nem nome (specs/cpf-outro-telefone-v1.md secao 4).
  assert.equal(payload.troca_telefone_pendente, true);
  const serializado = JSON.stringify(payload);
  assert.ok(!serializado.includes(CPF_SINTETICO_VALIDO), 'CPF nunca chega ao modelo');
  assert.ok(!serializado.includes(PACIENTE_DONO_DO_CPF), 'paciente_id nunca chega ao modelo');
  assert.ok(!serializado.includes(NOME_SINTETICO), 'nome nunca chega ao modelo');
});
