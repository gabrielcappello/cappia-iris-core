// Dublê MINIMO de ClienteBancoDados, dedicado a pos-consulta -- so cobre a
// tabela pos_consulta_jornadas e os metodos que pos-consulta-buscar-jornada-
// aberta.ts de fato usa (.select().eq()...). Deliberadamente SEPARADO de
// teste-cliente-falso.ts: aquele dublê e compartilhado por toda a suite de
// agendamento e sua lista fixa de tabelas (TabelasFalsas); estender essa
// lista so para pos-consulta acoplaria um modulo sem nenhuma relacao
// operacional a um dublê usado por centenas de outros testes.
import type { ClienteBancoDados, ConsultaEncadeavel } from './tipos.ts';

class ConsultaPosConsultaFalsa implements ConsultaEncadeavel {
  private readonly linhas: Record<string, unknown>[];

  constructor(linhas: Record<string, unknown>[]) {
    this.linhas = linhas;
  }

  eq(coluna: string, valor: unknown): ConsultaEncadeavel {
    return new ConsultaPosConsultaFalsa(this.linhas.filter((linha) => linha[coluna] === valor));
  }

  is(coluna: string, valor: null): ConsultaEncadeavel {
    return this.eq(coluna, valor);
  }

  gte(): ConsultaEncadeavel {
    throw new Error('ConsultaPosConsultaFalsa: gte nao suportado (nunca usado por este modulo)');
  }

  not(): ConsultaEncadeavel {
    throw new Error('ConsultaPosConsultaFalsa: not nao suportado (nunca usado por este modulo)');
  }

  select(_colunas: string): ConsultaEncadeavel {
    return this;
  }

  async maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> {
    await Promise.resolve();
    if (this.linhas.length > 1) return { data: null, error: { message: 'mais de uma linha encontrada' } };
    return { data: this.linhas[0] ?? null, error: null };
  }

  then<TResult1 = { data: Record<string, unknown>[]; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Record<string, unknown>[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): PromiseLike<TResult1 | TResult2> {
    const resultado = (async () => {
      await Promise.resolve();
      return { data: this.linhas, error: null };
    })();
    return resultado.then(onfulfilled, onrejected);
  }
}

export class ClientePosConsultaFalso implements ClienteBancoDados {
  private readonly jornadas: Record<string, unknown>[];

  constructor(jornadas: Record<string, unknown>[]) {
    this.jornadas = jornadas;
  }

  from(nome: string) {
    if (nome !== 'pos_consulta_jornadas') {
      throw new Error(`ClientePosConsultaFalso: tabela desconhecida '${nome}'`);
    }
    const linhas = this.jornadas;
    return {
      select: (_colunas: string): ConsultaEncadeavel => new ConsultaPosConsultaFalsa(linhas),
      upsert: (): ConsultaEncadeavel => {
        throw new Error('ClientePosConsultaFalso: upsert nao suportado');
      },
      update: (): ConsultaEncadeavel => {
        throw new Error('ClientePosConsultaFalso: update nao suportado (avanco de etapa e via RPC)');
      },
      insert: (): ConsultaEncadeavel => {
        throw new Error('ClientePosConsultaFalso: insert nao suportado (criacao de jornada e via RPC)');
      },
    };
  }
}
