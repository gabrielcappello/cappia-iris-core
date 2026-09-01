// Testes de correcao-cadastro.ts -- cenarios CC-01..CC-09 da
// specs/correcao-cadastro-conversacional-v1.md.
//
// O caso real (WhatsApp, Cleardent, 2026-09-01): o paciente pediu para
// corrigir o ano de nascimento, a Iris disse que "ficou registrada", e a data
// no banco continuou 1973-08-02.

import test from 'node:test';
import assert from 'node:assert/strict';

import { decidirCorrecaoCadastro } from './correcao-cadastro.ts';
import type { EntradaCorrecaoCadastro } from './correcao-cadastro.ts';
import type { AlteracoesDados } from './tipos.ts';

const PACIENTE = 'b4f426ff-c847-48a0-a206-d58b92f8a0af';
const corrigir = (valor: string) => ({ acao: 'corrigir' as const, valor });

function entrada(parcial: Partial<EntradaCorrecaoCadastro> = {}): EntradaCorrecaoCadastro {
  return {
    pacienteId: PACIENTE,
    alteracoes: {} as AlteracoesDados,
    camposInvalidos: undefined,
    dados: {},
    // Ficha COMPLETA: e o estado em que uma correcao faz sentido. Campo
    // ausente significa que o paciente esta completando o cadastro, nao
    // corrigindo -- caso proprio, testado abaixo.
    cadastroFicha: { nome: 'gabriel cappello', data_nascimento: '1973-08-02', email: 'velho@exemplo.com' },
    ...parcial,
  };
}

test('CC-01 CASO REAL: corrige o ano de nascimento, sem fluxo aberto -> grava', () => {
  const r = decidirCorrecaoCadastro(
    entrada({ alteracoes: { data_nascimento: corrigir('1974-08-02') } as AlteracoesDados })
  );
  assert.deepEqual(r, { tipo: 'corrigir', campos: ['data_nascimento'] });
});

test('CC-02 corrige e-mail, sem fluxo aberto -> grava', () => {
  const r = decidirCorrecaoCadastro(
    entrada({ alteracoes: { email: corrigir('novo@exemplo.com') } as AlteracoesDados })
  );
  assert.deepEqual(r, { tipo: 'corrigir', campos: ['email'] });
});

test('CC-03 corrige os dois no mesmo turno -> grava ambos', () => {
  const r = decidirCorrecaoCadastro(
    entrada({
      alteracoes: {
        data_nascimento: corrigir('1974-08-02'),
        email: corrigir('novo@exemplo.com'),
      } as AlteracoesDados,
    })
  );
  assert.deepEqual(r, { tipo: 'corrigir', campos: ['data_nascimento', 'email'] });
});

test('CC-04 valor IGUAL ao da ficha -> nenhuma escrita, nenhum anuncio', () => {
  const r = decidirCorrecaoCadastro(
    entrada({ alteracoes: { data_nascimento: corrigir('1973-08-02') } as AlteracoesDados })
  );
  assert.deepEqual(r, { tipo: 'nao_se_aplica' }, 'reafirmar o mesmo valor nao e correcao');
});

test('CC-05 data malformada -> nao grava, informa que nao foi aceito', () => {
  // O valor invalido NAO chega em `alteracoes`: descartarCadastroInvalido o
  // removeu antes. Sem este gatilho a decisao nunca dispararia.
  const r = decidirCorrecaoCadastro(entrada({ camposInvalidos: ['data_nascimento'] }));
  assert.deepEqual(r, { tipo: 'invalido', campos: ['data_nascimento'] });
});

test('CC-05 invalido tem PRECEDENCIA sobre valido no mesmo turno', () => {
  // Nunca "atualizei o e-mail" calado sobre a data que nao entrou.
  const r = decidirCorrecaoCadastro(
    entrada({
      alteracoes: { email: corrigir('novo@exemplo.com') } as AlteracoesDados,
      camposInvalidos: ['data_nascimento'],
    })
  );
  assert.equal(r.tipo, 'invalido');
});

// ── CORRIGE SEMPRE, em qualquer ponto da conversa ───────────────────────
// Decisao do Gabriel (2026-09-01), depois do teste real que reprovou a versao
// anterior: "a troca deve funcionar sempre. nao tem que ter um momento
// especifico para poder entender uma msg."
//
// A versao anterior travava a correcao quando havia fluxo de agendamento em
// andamento. Em producao isso reprovou: o paciente acabara de dar os dados do
// cadastro (que ficam em `dados` depois da reserva) e pediu para trocar o ano
// de nascimento -- a correcao nao disparou e ele ouviu "qual procedimento voce
// esta buscando?" duas vezes.

test('CC-06 COM agendamento em andamento -> AINDA ASSIM corrige', () => {
  const r = decidirCorrecaoCadastro(
    entrada({
      alteracoes: { data_nascimento: corrigir('1974-08-02') } as AlteracoesDados,
      dados: { procedimento_id: 'restoration_2', dentista_id: 'd1', horario_texto: '08:00' },
    })
  );
  assert.deepEqual(r, { tipo: 'corrigir', campos: ['data_nascimento'] });
});

test('CC-06b CASO REAL 19:38: cadastro recem-preenchido em `dados` nao bloqueia', () => {
  // Estado EXATO da conversa apos a reserva, lido do banco de producao.
  const r = decidirCorrecaoCadastro(
    entrada({
      alteracoes: { data_nascimento: corrigir('1974-08-02') } as AlteracoesDados,
      dados: { cpf: '06113236722', nome: 'gabriel cappello', data_nascimento: '1973-08-02' },
    })
  );
  assert.deepEqual(r, { tipo: 'corrigir', campos: ['data_nascimento'] }, 'foi este caso que reprovou em producao');
});

test('CC-06c nenhum campo operacional bloqueia a correcao', () => {
  for (const campo of ['procedimento_id', 'dentista_id', 'data_texto', 'periodo', 'horario_texto', 'agendamento_id']) {
    const r = decidirCorrecaoCadastro(
      entrada({
        alteracoes: { email: corrigir('novo@exemplo.com') } as AlteracoesDados,
        dados: { [campo]: 'valor-qualquer' },
      })
    );
    assert.deepEqual(r, { tipo: 'corrigir', campos: ['email'] }, `campo ${campo} nao pode bloquear`);
  }
});

test('CC-06d dado invalido tambem avisa durante o agendamento', () => {
  const r = decidirCorrecaoCadastro(
    entrada({ camposInvalidos: ['data_nascimento'], dados: { dentista_id: 'd1' } })
  );
  assert.deepEqual(r, { tipo: 'invalido', campos: ['data_nascimento'] });
});

test('CC-07 paciente NAO identificado -> comportamento de hoje, inalterado', () => {
  const r = decidirCorrecaoCadastro(
    entrada({
      pacienteId: null,
      alteracoes: { data_nascimento: corrigir('1974-08-02') } as AlteracoesDados,
    })
  );
  assert.deepEqual(r, { tipo: 'nao_se_aplica' });
});

test('CC-08 nome e CPF estao FORA do escopo desta v1', () => {
  const r = decidirCorrecaoCadastro(
    entrada({
      alteracoes: { nome: corrigir('Gabriel Cappello'), cpf: corrigir('12345678909') } as AlteracoesDados,
    })
  );
  assert.deepEqual(r, { tipo: 'nao_se_aplica' });

  const invalido = decidirCorrecaoCadastro(entrada({ camposInvalidos: ['cpf'] }));
  assert.deepEqual(invalido, { tipo: 'nao_se_aplica' }, 'CPF invalido segue por cadastro_necessario, nao por aqui');
});

test('acao "remover" nao e correcao de valor -- esta v1 nao apaga dado', () => {
  const r = decidirCorrecaoCadastro(
    entrada({ alteracoes: { email: { acao: 'remover' } } as AlteracoesDados })
  );
  assert.deepEqual(r, { tipo: 'nao_se_aplica' });
});

test('valor vazio ou so espacos nunca vira correcao', () => {
  for (const valor of ['', '   ']) {
    const r = decidirCorrecaoCadastro(
      entrada({ alteracoes: { email: corrigir(valor) } as AlteracoesDados })
    );
    assert.deepEqual(r, { tipo: 'nao_se_aplica' }, `valor ${JSON.stringify(valor)}`);
  }
});

test('COMPLETAR nao e corrigir: campo ausente na ficha segue o fluxo normal', () => {
  // Defeito real achado por teste (2026-09-01): a Iris pede "nome, CPF e data"
  // durante a reserva, o paciente responde "nasci em 10/05/1985", e a correcao
  // interceptava -- quebrando a reserva no mesmo turno. Preencher o que foi
  // pedido nunca e pedido de troca.
  const r = decidirCorrecaoCadastro(
    entrada({
      alteracoes: { email: { acao: 'informar', valor: 'primeiro@exemplo.com' } } as AlteracoesDados,
      cadastroFicha: { nome: 'gabriel cappello' },
    })
  );
  assert.deepEqual(r, { tipo: 'nao_se_aplica' }, 'campo ausente = completando cadastro, nao corrigindo');
});

test('procedimento_id vazio nao conta como fluxo aberto', () => {
  const r = decidirCorrecaoCadastro(
    entrada({
      alteracoes: { data_nascimento: corrigir('1974-08-02') } as AlteracoesDados,
      dados: { procedimento_id: '   ' },
    })
  );
  assert.equal(r.tipo, 'corrigir');
});

// ── Mapeamento no contexto de horarios ─────────────────────────────────
// `derivarAcaoContextoHorarios` e um switch EXAUSTIVO sem `default`: uma
// decisao nova nao listada devolve `undefined` e quebra
// `gravarContextoHorarios` em runtime -- foi o que aconteceu no primeiro
// commit desta frente, achado por um teste de reserva que passou a falhar.
import { derivarAcaoContextoHorarios } from './contexto-horarios.ts';

test('as tres decisoes novas PRESERVAM o contexto -- nunca undefined', () => {
  const decisoes = [
    { tipo: 'cadastro_atualizado', campos_atualizados: ['data_nascimento'] },
    { tipo: 'correcao_cadastro_invalida', campos_invalidos: ['data_nascimento'] },
    { tipo: 'correcao_cadastro_falhou' },
  ] as const;

  for (const decisao of decisoes) {
    const acao = derivarAcaoContextoHorarios(decisao as never);
    assert.ok(acao !== undefined, `${decisao.tipo} nao pode devolver undefined`);
    // Preservar: corrigir um dado no meio do agendamento nunca pode apagar a
    // proposta de horario pendente.
    assert.equal(acao.tipo, 'preservar', decisao.tipo);
  }
});
