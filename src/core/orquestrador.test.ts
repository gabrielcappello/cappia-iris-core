import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processarMensagem } from './orquestrador.ts';
import { ClienteFalso, criarTabelasFalsasVazias, type TabelasFalsas } from './teste-cliente-falso.ts';
import { ClienteModeloFalso } from './teste-cliente-modelo-falso.ts';
import { ClienteRpcFalso, type RespostaRpc } from './teste-cliente-rpc-falso.ts';

// Dublê sem nenhuma resposta configurada: usado em todos os testes que nao
// deveriam chegar a reservar -- se `cappia_reservar_agendamento` for chamada
// por engano, o proprio dublê lanca erro, provando o isolamento.
function clienteRpcNuncaChamado(): ClienteRpcFalso {
  return new ClienteRpcFalso({});
}

const PROVIDER = 'evolution';
const INSTANCIA = 'clinica-teste';
const TELEFONE = '5511999999999';

// 2026-08-03 = segunda-feira (verificado); usado como "hoje" nos testes que
// chegam ate a disponibilidade.
const INSTANTE_ATUAL = { data: '2026-08-03', minuto_min: 480 };

function semearClinica(tabelas: TabelasFalsas, dentistas: Record<string, unknown>[] = []): string {
  const clinicaId = crypto.randomUUID();
  tabelas.clinicas.push({
    id: clinicaId,
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    fuso_horario: 'America/Sao_Paulo',
    dentistas,
  });
  return clinicaId;
}

// identificarConversa so cria a linha (upsert) quando nenhuma existe ainda;
// o dublê de banco nao simula default de coluna, entao semeamos aqui com
// atualizado_em ja preenchido -- mesmo padrao de interpretar-e-aplicar.test.ts.
function semearConversa(tabelas: TabelasFalsas, clinicaId: string) {
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: {},
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
}

// Paciente cadastrado COMPLETO (specs/cadastro-conversacional-v1.md secao 2):
// desde 2026-08-10, "existe uma linha de paciente" nao basta para reservar --
// os obrigatorios (nome, CPF, nascimento) precisam estar preenchidos, senao o
// fluxo para no cadastro. Os testes de reserva usam esta funcao justamente
// para NAO cair no cadastro; quem precisa de paciente incompleto usa
// `semearPacienteIncompleto`.
//
// Valores sinteticos; o CPF e valido de proposito (mesmo que a leitura da
// ficha nao revalide) para nao plantar um dado impossivel nos fixtures.
function semearPaciente(tabelas: TabelasFalsas, clinicaId: string): string {
  const pacienteId = crypto.randomUUID();
  tabelas.pacientes.push({
    id: pacienteId,
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    nome: 'Marilda Sinval Quadros',
    documento: '52998224725',
    data_nascimento: '1979-06-23',
  });
  return pacienteId;
}

function semearPacienteIncompleto(
  tabelas: TabelasFalsas,
  clinicaId: string,
  cadastro: Record<string, unknown>
): string {
  const pacienteId = crypto.randomUUID();
  tabelas.pacientes.push({ id: pacienteId, clinica_id: clinicaId, telefone_normalizado: TELEFONE, ...cadastro });
  return pacienteId;
}

// Forma real de procedimentos_catalogo (schema de producao, ja confirmado
// por leitura direta do banco) -- so os campos que este dublê realmente le.
function semearProcedimentoCatalogo(tabelas: TabelasFalsas, id: string, overrides: Record<string, unknown> = {}) {
  tabelas.procedimentos_catalogo.push({
    id,
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
    ...overrides,
  });
}

// Forma real de um item de clinicas.dentistas[i] (ja confirmada por leitura
// direta da ClearDent) -- so os campos que carregar-catalogo.ts/carregar-
// disponibilidade.ts realmente leem.
function dentistaReal(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    nome: 'Ana',
    titulo: 'Dra.',
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

test('procedimento nao resolvido: orquestrador para em aguardando_procedimento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  semearConversa(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    // Nao pode ser saudacao pura (ex.: "oi") -- isso agora tem desfecho
    // proprio ('saudacao', ver testes dedicados abaixo). Mensagem sem
    // conteudo reconhecivel, mas tambem sem ser uma saudacao.
    mensagens_atuais: ['quero marcar uma consulta'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.clinica_id, clinicaId);
  // Sem payload: ID ausente, inexistente, de outra clinica ou inativo caem
  // todos no mesmo desfecho (specs/procedimento-semantico-v1.md secao 4).
  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
});

test('saudacao pura, sem procedimento conhecido: decisao saudacao, a partir da classificacao natureza_mensagem da IA', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  semearConversa(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  // natureza_mensagem vem sempre da IA (specs/interpretacao-natureza-
  // mensagem-v1.md) -- ao contrario da etapa anterior (deteccao por texto
  // bruto, detectar-saudacao.ts, ja removido), o modelo agora e sempre
  // chamado; e a classificacao que ele devolve que decide a saudacao.
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['Boa tarde!'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.deepEqual(resultado.decisao, { tipo: 'saudacao' });
  assert.equal(clienteModelo.chamadas.length, 1);
});

test('saudacao no meio de uma conversa que ja tem procedimento conhecido: nunca interrompe o fluxo em andamento', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  // dados ja tem procedimento_id de uma mensagem anterior -- a nova
  // mensagem ("oi") nao acrescenta nada (alteracoes vazias), entao `dados`
  // continua sendo o snapshot ja persistido (orquestrador.ts).
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { procedimento_id: 'cleaning' },
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'saudacao', alteracoes: {} }]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['oi'],
    instante_atual: INSTANTE_ATUAL,
  });

  // procedimento_id 'limpeza' nao bate em nenhum catalogo desta clinica
  // (nenhum procedimento semeado) -> aguardando_procedimento por
  // sem_correspondencia, nunca 'saudacao' -- a saudacao nao reabre o fluxo.
  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
});

test('duvida sem alteracoes e sem procedimento conhecido: retorna duvida_livre', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  semearConversa(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'duvida', alteracoes: {} }]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['voces atendem convenio X?'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.deepEqual(resultado.decisao, { tipo: 'duvida_livre' });
});

test('duvida sem alteracoes, com procedimento ja conhecido: nao retorna duvida_livre, retoma o estado determinístico pendente', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const clinicaId = semearClinica(tabelas, [
    dentistaReal({
      id: dentistaId,
      procedimentos: [{ id: procedimentoId, nome: 'Limpeza', ativo: true, tempo: 30 }],
    }),
  ]);
  semearProcedimentoCatalogo(tabelas, procedimentoId);
  // procedimento_id ja conhecido de uma mensagem anterior -- a duvida
  // atual ("voces atendem convenio X?") nao acrescenta nada (alteracoes
  // vazias), entao `dados` continua sendo o snapshot ja persistido.
  tabelas.estado_conversa.push({
    id: crypto.randomUUID(),
    clinica_id: clinicaId,
    telefone_normalizado: TELEFONE,
    estado: 'atendimento',
    dados: { procedimento_id: procedimentoId },
    paciente_id: null,
    atualizado_em: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'duvida', alteracoes: {} }]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['voces atendem convenio X?'],
    instante_atual: INSTANTE_ATUAL,
  });

  // nunca duvida_livre -- retoma exatamente a pergunta pendente (aqui,
  // data/horario, ja que procedimento/dentista/duracao ja resolvidos mas
  // nenhuma data foi informada ainda).
  assert.deepEqual(resultado.decisao, {
    tipo: 'aguardando_data_horario',
    resultado: { tipo: 'incompleto', motivo: 'intencao_ausente' },
  });
});

test('clinica sem linha em clinicas.dentistas ainda carrega (array vazio): aguardando_procedimento, nunca excecao', async () => {
  const tabelas = criarTabelasFalsasVazias();
  // clinica existe mas dentistas fica implicitamente [] (default do helper).
  const clinicaId = semearClinica(tabelas);
  semearConversa(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([{ natureza_mensagem: 'pedido', alteracoes: {} }]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar uma consulta'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
});

test('procedimento + dentista unico apto + duracao configurada, sem data: aguardando_data_horario', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const clinicaId = semearClinica(tabelas, [
    dentistaReal({
      id: dentistaId,
      procedimentos: [{ id: procedimentoId, nome: 'Limpeza', ativo: true, tempo: 30 }],
    }),
  ]);
  semearConversa(tabelas, clinicaId);
  semearProcedimentoCatalogo(tabelas, procedimentoId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    { natureza_mensagem: 'pedido', alteracoes: { procedimento_id: { acao: 'informar', valor: procedimentoId } } },
  ]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar uma limpeza'],
    instante_atual: INSTANTE_ATUAL,
  });

  // procedimento/dentista/duracao resolvidos, mas nenhum data_texto/periodo/
  // horario_texto informado -> fatos_temporais vazio -> resolverTemporal
  // (nao alterado) devolve incompleto/intencao_ausente pelo caminho ja
  // existente, nunca um horario inventado.
  assert.deepEqual(resultado.decisao, {
    tipo: 'aguardando_data_horario',
    resultado: { tipo: 'incompleto', motivo: 'intencao_ausente' },
  });
});

test('fluxo completo ate horario real: procedimento -> dentista -> duracao -> "hoje" -> horarios_disponiveis', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const clinicaId = semearClinica(tabelas, [
    dentistaReal({
      id: dentistaId,
      modo: 'auto',
      dur: 30,
      procedimentos: [{ id: procedimentoId, nome: 'Limpeza', ativo: true, tempo: 999 }], // ignorado: modo auto usa `dur`.
    }),
  ]);
  semearConversa(tabelas, clinicaId);
  semearProcedimentoCatalogo(tabelas, procedimentoId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    {
      natureza_mensagem: 'pedido',
      alteracoes: {
        procedimento_id: { acao: 'informar', valor: procedimentoId },
        data_texto: { acao: 'informar', valor: 'hoje' },
        periodo: { acao: 'informar', valor: 'manha' },
      },
    },
  ]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar uma limpeza hoje de manha'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'horarios_disponiveis');
  if (resultado.decisao.tipo !== 'horarios_disponiveis') return;
  assert.equal(resultado.decisao.procedimento_id, procedimentoId);
  assert.equal(resultado.decisao.dentista_id, dentistaId);
  assert.equal(resultado.decisao.duracao_min, 30);
  assert.equal(resultado.decisao.resultado.tipo, 'opcoes');
  if (resultado.decisao.resultado.tipo === 'opcoes') {
    assert.ok(resultado.decisao.resultado.opcoes.length > 0, 'jornada 08:00-12:00 as 08:00 deve ter horarios livres');
  }
});

test('procedimento_id que NAO existe no catalogo da clinica: aguardando_procedimento, nunca prossegue', async () => {
  // Substituiu, em 2026-08-08, o teste de "alias ambiguo": sem aliases nao
  // existe ambiguidade textual. O risco agora e outro -- a IA devolver um id
  // inventado -- e e exatamente isso que a validacao de integridade barra
  // (specs/procedimento-semantico-v1.md secao 4).
  const tabelas = criarTabelasFalsasVazias();
  const clinicaId = semearClinica(tabelas);
  semearConversa(tabelas, clinicaId);
  semearProcedimentoCatalogo(tabelas, 'cleaning', { nome_pt: 'Limpeza dental (profilaxia)' });
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    { natureza_mensagem: 'pedido', alteracoes: { procedimento_id: { acao: 'informar', valor: 'id_que_nao_existe' } } },
  ]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar uma limpeza'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'aguardando_procedimento');
});

test('dois dentistas aptos, sem preferencia: aguardando_escolha_dentista', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const procedimentoId = crypto.randomUUID();
  const dentista1 = crypto.randomUUID();
  const dentista2 = crypto.randomUUID();
  const clinicaId = semearClinica(tabelas, [
    dentistaReal({
      id: dentista1,
      nome: 'Ana',
      procedimentos: [{ id: procedimentoId, nome: 'Limpeza', ativo: true, tempo: 30 }],
    }),
    dentistaReal({
      id: dentista2,
      nome: 'Bruno',
      titulo: 'Dr.',
      procedimentos: [{ id: procedimentoId, nome: 'Limpeza', ativo: true, tempo: 30 }],
    }),
  ]);
  semearConversa(tabelas, clinicaId);
  semearProcedimentoCatalogo(tabelas, procedimentoId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteModelo = new ClienteModeloFalso([
    { natureza_mensagem: 'pedido', alteracoes: { procedimento_id: { acao: 'informar', valor: procedimentoId } } },
  ]);

  const resultado = await processarMensagem(clienteModelo, clienteBanco, clienteRpcNuncaChamado(), {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar uma limpeza'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'aguardando_escolha_dentista');
  if (resultado.decisao.tipo === 'aguardando_escolha_dentista') {
    const ids = resultado.decisao.dentistas.map((d) => d.dentista_id).sort();
    assert.deepEqual(ids, [dentista1, dentista2].sort());
  }
});

// --- Escolha de horario + confirmacao explicita + reserva ---

function montarCenarioReserva(tabelas: TabelasFalsas) {
  const procedimentoId = crypto.randomUUID();
  const dentistaId = crypto.randomUUID();
  const clinicaId = semearClinica(tabelas, [
    dentistaReal({
      id: dentistaId,
      modo: 'auto',
      dur: 30,
      procedimentos: [{ id: procedimentoId, nome: 'Limpeza', ativo: true, tempo: 999 }], // ignorado: modo auto usa `dur`.
    }),
  ]);
  semearConversa(tabelas, clinicaId);
  semearProcedimentoCatalogo(tabelas, procedimentoId);

  return { clinicaId, procedimentoId, dentistaId };
}

// `procedimentoId` e agora OBRIGATORIO: desde
// specs/procedimento-semantico-v1.md a IA devolve a identidade canonica, nao
// o texto do paciente -- um id que nao exista no catalogo semeado cai em
// aguardando_procedimento, como deve.
function clienteModeloEscolha(procedimentoId: string, confirmacao?: string) {
  const alteracoes: Record<string, { acao: string; valor: string }> = {
    procedimento_id: { acao: 'informar', valor: procedimentoId },
    data_texto: { acao: 'informar', valor: 'hoje' },
    horario_texto: { acao: 'informar', valor: '10:00' },
  };
  if (confirmacao !== undefined) alteracoes.confirmacao = { acao: 'informar', valor: confirmacao };
  const naturezaMensagem = confirmacao !== undefined ? 'resposta' : 'pedido';
  return new ClienteModeloFalso([{ natureza_mensagem: naturezaMensagem, alteracoes }]);
}

test('paciente escolhe horario livre, sem confirmar: aguardando_confirmacao, nunca reserva', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId, dentistaId } = montarCenarioReserva(tabelas);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteRpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(clienteModeloEscolha(procedimentoId), clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['quero marcar limpeza hoje as 10:00'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'aguardando_confirmacao');
  if (resultado.decisao.tipo !== 'aguardando_confirmacao') return;
  assert.equal(resultado.decisao.procedimento_id, procedimentoId);
  assert.equal(resultado.decisao.dentista_id, dentistaId);
  assert.equal(resultado.decisao.opcao.inicio_min, 600);
  assert.equal(clienteRpc.chamadas.length, 0, 'nunca reserva sem confirmacao explicita');
});

test('confirmado mas paciente nao cadastrado: cadastro_necessario, nunca reserva', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { procedimentoId } = montarCenarioReserva(tabelas);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteRpc = clienteRpcNuncaChamado();

  const resultado = await processarMensagem(clienteModeloEscolha(procedimentoId, 'sim'), clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['sim, confirmo'],
    instante_atual: INSTANTE_ATUAL,
  });

  // Paciente novo: faltam os tres obrigatorios de Brasil V1. `email` NAO entra
  // porque esta clinica nao tem solicitar_email ligado.
  assert.deepEqual(resultado.decisao, {
    tipo: 'cadastro_necessario',
    campos_faltantes: ['nome', 'cpf', 'data_nascimento'],
  });
  assert.equal(clienteRpc.chamadas.length, 0);
});

test('escolha + confirmacao + paciente cadastrado: reserva_criada, chamando cappia_reservar_agendamento com os ids ja resolvidos', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId } = montarCenarioReserva(tabelas);
  const pacienteId = semearPaciente(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const agendamentoId = crypto.randomUUID();
  const clienteRpc = new ClienteRpcFalso({
    cappia_reservar_agendamento: {
      data: {
        sucesso: true,
        agendamento_id: agendamentoId,
        dentista_id: dentistaId,
        duracao_min: 30,
        data: '2026-08-03',
        horario: '10:00',
      },
      error: null,
    } satisfies RespostaRpc,
  });

  const resultado = await processarMensagem(clienteModeloEscolha(procedimentoId, 'sim'), clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['sim, confirmo'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.deepEqual(resultado.decisao, {
    tipo: 'reserva_criada',
    agendamento_id: agendamentoId,
    dentista_id: dentistaId,
    procedimento_id: procedimentoId,
    duracao_min: 30,
    data: '2026-08-03',
    horario: '10:00',
  });
  assert.equal(clienteRpc.chamadas.length, 1);
  assert.deepEqual(clienteRpc.chamadas[0].parametros, {
    p_clinica_id: clinicaId,
    p_data: '2026-08-03',
    p_horario: '10:00',
    p_procedimento_id: procedimentoId,
    p_paciente_id: pacienteId,
    p_dentista_id: dentistaId,
    p_telefone: TELEFONE,
  });
});

test('reserva_criada: limpa intencao/procedimento_id/dentista_id/data_texto/periodo/horario_texto/confirmacao de dados', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId } = montarCenarioReserva(tabelas);
  semearPaciente(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const agendamentoId = crypto.randomUUID();
  const clienteRpc = new ClienteRpcFalso({
    cappia_reservar_agendamento: {
      data: {
        sucesso: true,
        agendamento_id: agendamentoId,
        dentista_id: dentistaId,
        duracao_min: 30,
        data: '2026-08-03',
        horario: '10:00',
      },
      error: null,
    } satisfies RespostaRpc,
  });

  const resultado = await processarMensagem(clienteModeloEscolha(procedimentoId, 'sim'), clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['sim, confirmo'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.equal(resultado.decisao.tipo, 'reserva_criada');
  const dadosPersistidos = tabelas.estado_conversa[0]!.dados as Record<string, unknown>;
  for (const campo of [
    'intencao',
    'procedimento_id',
    'dentista_id',
    'data_texto',
    'periodo',
    'horario_texto',
    'confirmacao',
  ]) {
    assert.equal(campo in dadosPersistidos, false, `${campo} deveria ter sido removido de dados apos reserva_criada`);
  }
});

test('mensagem seguinte sem conteudo novo (ex.: "obrigado") apos reserva_criada nao reentra em disponibilidade/reserva', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId, dentistaId } = montarCenarioReserva(tabelas);
  semearPaciente(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const agendamentoId = crypto.randomUUID();
  const clienteRpcReserva = new ClienteRpcFalso({
    cappia_reservar_agendamento: {
      data: {
        sucesso: true,
        agendamento_id: agendamentoId,
        dentista_id: dentistaId,
        duracao_min: 30,
        data: '2026-08-03',
        horario: '10:00',
      },
      error: null,
    } satisfies RespostaRpc,
  });

  await processarMensagem(clienteModeloEscolha(procedimentoId, 'sim'), clienteBanco, clienteRpcReserva, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['sim, confirmo'],
    instante_atual: INSTANTE_ATUAL,
  });

  // Segundo turno, MESMA conversa: "obrigado" -- zero alteracoes extraidas,
  // natureza 'resposta' (sem decisao conversacional propria). Se os campos
  // antigos nao tivessem sido limpos, isto reentraria em disponibilidade
  // sobre o procedimento/horario do agendamento que acabou de ser criado
  // (bug real de producao, incidente 2026-08-12).
  const clienteRpcSegundoTurno = clienteRpcNuncaChamado();
  const clienteModeloAgradecimento = new ClienteModeloFalso([{ natureza_mensagem: 'resposta', alteracoes: {} }]);

  const resultadoSegundoTurno = await processarMensagem(clienteModeloAgradecimento, clienteBanco, clienteRpcSegundoTurno, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['obrigado'],
    instante_atual: INSTANTE_ATUAL,
  });

  // Sem procedimento_id em dados, decidir() para no primeiro passo -- ANTES
  // de resolver dentista, duracao, temporal ou consultar disponibilidade.
  assert.equal(resultadoSegundoTurno.decisao.tipo, 'aguardando_procedimento');
  assert.equal(clienteRpcSegundoTurno.chamadas.length, 0, 'nenhuma RPC de reserva foi chamada para "obrigado"');
});

test('RPC recusa por sobreposicao real (corrida): reserva_conflito, nunca insiste sozinho', async () => {
  const tabelas = criarTabelasFalsasVazias();
  const { clinicaId, procedimentoId } = montarCenarioReserva(tabelas);
  semearPaciente(tabelas, clinicaId);
  const clienteBanco = new ClienteFalso(tabelas);
  const clienteRpc = new ClienteRpcFalso({
    cappia_reservar_agendamento: { data: { sucesso: false, motivo: 'horario_ocupado' }, error: null } satisfies RespostaRpc,
  });

  const resultado = await processarMensagem(clienteModeloEscolha(procedimentoId, 'sim'), clienteBanco, clienteRpc, {
    provider: PROVIDER,
    instancia_whatsapp: INSTANCIA,
    telefone_normalizado: TELEFONE,
    mensagens_atuais: ['sim, confirmo'],
    instante_atual: INSTANTE_ATUAL,
  });

  assert.deepEqual(resultado.decisao, { tipo: 'reserva_conflito' });
  assert.equal(clienteRpc.chamadas.length, 1, 'chamou a RPC exatamente uma vez, nunca reinsiste sozinho');
});
