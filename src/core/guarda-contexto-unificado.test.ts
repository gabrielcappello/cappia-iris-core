// SIMULAÇÃO DETERMINÍSTICA da semântica da guarda do contrato unificado
// (specs/contexto-conversacional-unificado-v1.md §5.1 e §6.4).
//
// ESCOPO HONESTO -- ler antes de citar estes resultados:
//
// Este arquivo NÃO é o teste integrado exigido pela revisão. Ele simula o ciclo
// de dois turnos com um estado próprio, criado aqui dentro (`EstadoSombra`).
// NÃO atravessa orquestrador, persistência, banco nem duas requisições reais, e
// a saída do modelo é INJETADA.
//
// O que ele prova: a semântica da guarda e do CAS -- bloqueio por co-ocorrência,
// pergunta pendente resultante, resolução na volta seguinte, e transição
// superada que não escreve.
//
// O que ele NÃO prova: que a saída da volta 1, num atendimento real, atravessa a
// guarda, persiste `aguardando_resposta` e chega à volta 2. Essa prova exige o
// teste integrado de verdade, que depende do armazenamento shadow ainda não
// decidido -- ver a proposta pendente de aprovação.
//
// Todos os dados são SINTÉTICOS.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aplicarGuardaEscolhaProfissional, validarFormaSaida } from './guarda-contexto-unificado.ts';
import type {
  InformacaoFornecida,
  PerguntaPendente,
  SaidaContratoUnificado,
} from './contexto-unificado-tipos.ts';

// ── Simulação MÍNIMA do ciclo de um turno em shadow ──────────────────────────
//
// Guarda apenas o que a spec exige atravessar de um turno para o outro: a
// pergunta pendente e o cadastro acumulado. Nenhuma escrita real -- o shadow
// nunca toca `estado_conversa` (ver `nenhuma alteracao no atendimento real`,
// no fim deste arquivo).

interface EstadoSombra {
  aguardando_resposta: PerguntaPendente | null;
  cadastro: Record<string, string>;
  /** Versão do estado -- base do CAS, como `atualizado_em` no Core real. */
  versao: number;
}

function estadoInicial(): EstadoSombra {
  return { aguardando_resposta: null, cadastro: {}, versao: 1 };
}

/**
 * Aplica um turno: passa a saída pela guarda, persiste o que foi liberado e
 * registra a pergunta pendente resultante.
 *
 * CAS ESTRITO sobre `versao`: se o estado avançou desde que este turno leu, a
 * transição é considerada SUPERADA e nada é escrito. Sem releitura e sem retry
 * -- foi exatamente a falta disso (e a comparação de timestamp como texto) que
 * derrubou a Etapa 2 em 2026-08-13.
 */
function aplicarTurno(
  estado: EstadoSombra,
  saida: SaidaContratoUnificado,
  versaoLida: number
): { estado: EstadoSombra; superado: boolean; bloqueou: boolean } {
  if (versaoLida !== estado.versao) {
    return { estado, superado: true, bloqueou: false };
  }

  const guarda = aplicarGuardaEscolhaProfissional(saida);
  const cadastro = { ...estado.cadastro };
  for (const item of guarda.informacoes_liberadas) {
    if (item.operacao === 'corrigiu' && item.valor === null) delete cadastro[item.campo];
    else if (item.valor !== null) cadastro[item.campo] = item.valor;
  }

  return {
    estado: { aguardando_resposta: guarda.pergunta, cadastro, versao: estado.versao + 1 },
    superado: false,
    bloqueou: guarda.bloqueou,
  };
}

function escolherDentista(nome?: string): SaidaContratoUnificado {
  const infos: InformacaoFornecida[] =
    nome !== undefined ? [{ campo: 'nome', operacao: 'informou', valor: nome }] : [];
  return {
    acao_solicitada: { tipo: 'escolher_dentista', referencia: 'Dr. Pablo Arruda' },
    informacoes_fornecidas: infos,
  };
}

function respostaSobreNome(valor: string | null, operacao: 'informou' | 'corrigiu'): SaidaContratoUnificado {
  return {
    acao_solicitada: { tipo: valor === null ? 'nenhuma' : 'confirmar', referencia: null },
    informacoes_fornecidas: [{ campo: 'nome', operacao, valor }],
  };
}

// ── As três cadeias de duas voltas exigidas pela revisão ─────────────────────

test('CADEIA: "Pablo" -> guarda -> "sim, meu nome e Pablo" -> nome ACEITO', () => {
  let e = estadoInicial();

  // VOLTA 1 -- a IA escolhe o dentista E declara "Pablo" como nome.
  const t1 = aplicarTurno(e, escolherDentista('Pablo'), e.versao);
  e = t1.estado;

  assert.equal(t1.bloqueou, true, 'a guarda precisa disparar na co-ocorrencia');
  assert.equal(e.cadastro.nome, undefined, 'o nome NAO pode ter sido persistido');
  assert.equal(e.aguardando_resposta?.tipo, 'confirmacao_nome');
  assert.equal(e.aguardando_resposta?.detalhe?.nome_proposto, 'Pablo');

  // VOLTA 2 -- o paciente confirma que Pablo e mesmo o nome dele.
  const t2 = aplicarTurno(e, respostaSobreNome('Pablo', 'informou'), e.versao);
  e = t2.estado;

  assert.equal(t2.bloqueou, false, 'sem escolha de dentista, a guarda nao dispara');
  assert.equal(e.cadastro.nome, 'Pablo', 'nome aceito na volta 2');
  assert.equal(e.aguardando_resposta, null, 'a duvida foi resolvida');
});

test('CADEIA: "Pablo" -> guarda -> "nao, meu nome e Gabriel" -> Gabriel, NUNCA Pablo', () => {
  let e = estadoInicial();

  const t1 = aplicarTurno(e, escolherDentista('Pablo'), e.versao);
  e = t1.estado;
  assert.equal(e.cadastro.nome, undefined);

  const t2 = aplicarTurno(e, respostaSobreNome('Gabriel', 'corrigiu'), e.versao);
  e = t2.estado;

  assert.equal(e.cadastro.nome, 'Gabriel');
  assert.notEqual(e.cadastro.nome, 'Pablo', 'Pablo nunca pode sobreviver a correcao');
  assert.equal(e.aguardando_resposta, null);
});

test('CADEIA: "Vanesa, meu nome e Gabriel" -> guarda -> "Gabriel mesmo" -> Gabriel PRESERVADO', () => {
  let e = estadoInicial();

  // CUSTO DECLARADO (spec §5.1): aqui a pergunta e desnecessaria -- Gabriel era
  // mesmo o nome. O que se prova e que ela nao DESTROI o dado.
  const t1 = aplicarTurno(e, escolherDentista('Gabriel'), e.versao);
  e = t1.estado;

  assert.equal(t1.bloqueou, true);
  assert.equal(e.cadastro.nome, undefined, 'bloqueado tambem no caso legitimo');
  assert.equal(e.aguardando_resposta?.detalhe?.nome_proposto, 'Gabriel');

  const t2 = aplicarTurno(e, respostaSobreNome('Gabriel', 'informou'), e.versao);
  e = t2.estado;

  assert.equal(e.cadastro.nome, 'Gabriel', 'o nome legitimo sobrevive a pergunta extra');
});

// ── Concorrência: contexto obsoleto nunca é usado ────────────────────────────

test('CAS: turno que decidiu sobre estado ANTIGO nao escreve nada', () => {
  let e = estadoInicial();
  const versaoLidaPeloTurnoLento = e.versao;

  // Outro turno avanca o estado no meio-tempo.
  const intermediario = aplicarTurno(e, respostaSobreNome('Gabriel', 'informou'), e.versao);
  e = intermediario.estado;
  assert.equal(e.cadastro.nome, 'Gabriel');

  // O turno lento tenta gravar sobre a versao que ele leu -- SUPERADO.
  const lento = aplicarTurno(e, escolherDentista('Pablo'), versaoLidaPeloTurnoLento);

  assert.equal(lento.superado, true, 'transicao superada precisa ser reconhecida');
  assert.equal(lento.estado.cadastro.nome, 'Gabriel', 'o dado do turno vencedor fica intacto');
  assert.equal(lento.estado.versao, e.versao, 'nenhuma escrita, nenhuma versao nova');
});

test('CAS: turno superado nao publica pergunta pendente obsoleta', () => {
  let e = estadoInicial();
  const versaoAntiga = e.versao;
  e = aplicarTurno(e, respostaSobreNome('Gabriel', 'informou'), e.versao).estado;

  const lento = aplicarTurno(e, escolherDentista('Pablo'), versaoAntiga);

  assert.equal(lento.estado.aguardando_resposta, null, 'nunca deixa `confirmacao_nome` pendurada');
});

// ── Fronteiras da guarda ─────────────────────────────────────────────────────

test('guarda NAO dispara quando a acao nao e escolha de profissional', () => {
  const r = aplicarGuardaEscolhaProfissional({
    acao_solicitada: { tipo: 'confirmar', referencia: null },
    informacoes_fornecidas: [{ campo: 'nome', operacao: 'informou', valor: 'Gabriel' }],
  });
  assert.equal(r.bloqueou, false);
  assert.equal(r.informacoes_liberadas.length, 1);
});

test('guarda NAO dispara quando a escolha vem sem nome', () => {
  const r = aplicarGuardaEscolhaProfissional(escolherDentista());
  assert.equal(r.bloqueou, false);
  assert.equal(r.pergunta, null);
});

test('guarda bloqueia SOMENTE o nome -- nunca descarta os outros campos', () => {
  const r = aplicarGuardaEscolhaProfissional({
    acao_solicitada: { tipo: 'escolher_dentista', referencia: 'Dr. Pablo Arruda' },
    informacoes_fornecidas: [
      { campo: 'nome', operacao: 'informou', valor: 'Pablo' },
      { campo: 'cpf', operacao: 'informou', valor: '52998224725' },
      { campo: 'horario', operacao: 'corrigiu', valor: '15:00' },
    ],
  });

  assert.equal(r.bloqueou, true);
  assert.deepEqual(
    r.informacoes_liberadas.map((i) => i.campo),
    ['cpf', 'horario'],
    'a guarda protege identidade, nunca descarta dado alheio'
  );
});

test('guarda e ESTRUTURAL: dispara mesmo com nome que nao parece o do dentista', () => {
  // Se comparasse texto, "Joao" x "Dr. Pablo Arruda" nao casaria e a
  // contaminacao passaria. A co-ocorrencia basta.
  const r = aplicarGuardaEscolhaProfissional(escolherDentista('Joao'));
  assert.equal(r.bloqueou, true);
});

// ── Forma do contrato (spec §4) ──────────────────────────────────────────────

test('forma: `informou` com valor vazio ou null e recusado', () => {
  for (const valor of [null, '', '   ']) {
    const motivo = validarFormaSaida({
      acao_solicitada: { tipo: 'nenhuma', referencia: null },
      informacoes_fornecidas: [{ campo: 'nome', operacao: 'informou', valor }],
    });
    assert.ok(motivo !== null, `informou com ${JSON.stringify(valor)} deveria ser recusado`);
  }
});

test('forma: `corrigiu` com string vazia e recusado -- so `null` remove', () => {
  const motivo = validarFormaSaida({
    acao_solicitada: { tipo: 'nenhuma', referencia: null },
    informacoes_fornecidas: [{ campo: 'nome', operacao: 'corrigiu', valor: '' }],
  });
  assert.ok(motivo !== null);
});

test('forma: `corrigiu` com null e valido -- e o que representa remocao', () => {
  const motivo = validarFormaSaida({
    acao_solicitada: { tipo: 'nenhuma', referencia: null },
    informacoes_fornecidas: [{ campo: 'nome', operacao: 'corrigiu', valor: null }],
  });
  assert.equal(motivo, null);
});

test('remocao via `corrigiu: null` apaga o campo do cadastro', () => {
  let e = estadoInicial();
  e = aplicarTurno(e, respostaSobreNome('Pablo', 'informou'), e.versao).estado;
  assert.equal(e.cadastro.nome, 'Pablo');

  e = aplicarTurno(e, respostaSobreNome(null, 'corrigiu'), e.versao).estado;
  assert.equal(e.cadastro.nome, undefined, 'corrigiu: null remove, nunca grava ""');
});

// ── Nenhuma alteração no atendimento real ────────────────────────────────────

test('SHADOW: a guarda e pura -- nao escreve, nao le relogio, nao acessa rede', () => {
  const entrada: SaidaContratoUnificado = {
    acao_solicitada: { tipo: 'escolher_dentista', referencia: 'Dr. Pablo Arruda' },
    informacoes_fornecidas: [{ campo: 'nome', operacao: 'informou', valor: 'Pablo' }],
  };
  const copia = structuredClone(entrada);

  aplicarGuardaEscolhaProfissional(entrada);
  aplicarGuardaEscolhaProfissional(entrada);

  // Mesma entrada, nenhuma mutacao: duas chamadas nao podem divergir nem
  // alterar o objeto recebido.
  assert.deepEqual(entrada, copia, 'a guarda nunca muta a entrada');
  assert.deepEqual(
    aplicarGuardaEscolhaProfissional(entrada),
    aplicarGuardaEscolhaProfissional(entrada),
    'pura: mesma entrada, mesmo resultado'
  );
});
