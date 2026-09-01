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
    cadastroFicha: { nome: 'gabriel cappello', data_nascimento: '1973-08-02' },
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

test('CC-06 COM agendamento em andamento -> comportamento de hoje, inalterado', () => {
  const r = decidirCorrecaoCadastro(
    entrada({
      alteracoes: { data_nascimento: corrigir('1974-08-02') } as AlteracoesDados,
      dados: { procedimento_id: 'restoration_2' },
    })
  );
  assert.deepEqual(r, { tipo: 'nao_se_aplica' }, 'a reserva ja persiste o cadastro nesse caminho');
});

// ── FURO REAL, achado na revisao antes do commit (2026-09-01) ───────────
// A primeira versao olhava so `procedimento_id`. O paciente pode ter escolhido
// dentista e data sem ainda ter dito o procedimento -- e uma correcao ali
// sequestrava o agendamento em andamento.
test('CC-06b FURO: dentista e data escolhidos, SEM procedimento_id -> nao intercepta', () => {
  const r = decidirCorrecaoCadastro(
    entrada({
      alteracoes: { email: corrigir('novo@exemplo.com') } as AlteracoesDados,
      dados: { dentista_id: 'd1', data_texto: 'amanha' },
    })
  );
  assert.deepEqual(r, { tipo: 'nao_se_aplica' }, 'correcao nunca sequestra agendamento em andamento');
});

test('CC-06c cada campo operacional, sozinho, ja indica fluxo em andamento', () => {
  for (const campo of ['procedimento_id', 'dentista_id', 'data_texto', 'periodo', 'horario_texto', 'agendamento_id']) {
    const r = decidirCorrecaoCadastro(
      entrada({
        alteracoes: { email: corrigir('novo@exemplo.com') } as AlteracoesDados,
        dados: { [campo]: 'valor-qualquer' },
      })
    );
    assert.deepEqual(r, { tipo: 'nao_se_aplica' }, `campo ${campo} deveria bloquear a correcao`);
  }
});

test('CC-06d fluxo em andamento vence ate sobre campo INVALIDO', () => {
  // O agendamento nao pode ser interrompido nem para avisar de dado invalido:
  // o cadastro sera pedido dentro da propria reserva, com o mesmo aviso.
  const r = decidirCorrecaoCadastro(
    entrada({ camposInvalidos: ['data_nascimento'], dados: { dentista_id: 'd1' } })
  );
  assert.deepEqual(r, { tipo: 'nao_se_aplica' });
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

test('campo ausente na ficha -> informar tambem e correcao (nao havia valor)', () => {
  const r = decidirCorrecaoCadastro(
    entrada({
      alteracoes: { email: { acao: 'informar', valor: 'primeiro@exemplo.com' } } as AlteracoesDados,
      cadastroFicha: { nome: 'gabriel cappello' },
    })
  );
  assert.deepEqual(r, { tipo: 'corrigir', campos: ['email'] });
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
